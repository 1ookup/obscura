# Iframe support: design document

> Status: **design only — not yet implemented.** This page records the planned
> architecture for complete `<iframe>` support. It is a forward-looking design
> doc, not a description of current behavior.
>
> Revised four times. The fourth revision makes browser-like navigation and
> JavaScript realm semantics requirements rather than optional follow-ons. See
> *Revision notes* at the bottom. Line numbers were accurate at review time but
> drift — resolve by symbol name when implementing.

## Why

Obscura has no real iframe support. `<iframe>` content today is a JS shim
(`_IframeDocument` / `_IframeWindow`, `crates/obscura-js/js/bootstrap.js:11359`
and `:11574`):

- The document is faked by regex: DOCTYPE, `<html>` and the **entire
  `<head>`** are stripped and the remainder is assigned via `innerHTML`
  (bootstrap.js:11376-11384). Nodes are created with the *parent* document's
  `createElement` (11371-11375, 11421-11426), so `ownerDocument` points at the
  top document (bootstrap.js:1856 returns `globalThis.document`
  unconditionally). No scripts run, no sub-resources load. Because the head is
  discarded, `contentDocument.title` is always `''` and `styleSheets` is always
  `[]` (11387-11390, 11433).
- The synthesized subtree is never appended to the document, so it is invisible
  to style collection and layout. That isolation is accidental, not designed.
- The render engine paints an empty box. `iframe` is already a replaced element
  with a 300×150 intrinsic size (`inline.rs:2729/2753/2763`), but the only
  replaced-content paint branches are `canvas` (`paint.rs:4308`) and
  `img | video` (`paint.rs:4358`).
- CDP `Page.getFrameTree` hardcodes `childFrames: []`
  (`crates/obscura-cdp/src/domains/page.rs:1167`), and `securityOrigin` holds a
  full URL rather than an origin (`:1163`). `Page.frameAttached` /
  `frameDetached` do not exist anywhere in the crate.
- Cross-document messaging is entirely broken: `globalThis.postMessage` is
  `function() {}` (bootstrap.js:12619), and `_IframeWindow` sets
  `top = parent = globalThis` (11578-11579), so `parent.postMessage(...)` from
  inside a frame lands on the no-op.
- `_loadIframeSrc` (bootstrap.js:3792, called from
  `crates/obscura-browser/src/page.rs:2615`) models the frame load as a
  CORS-shaped subresource fetch (`mode: 'no-cors'`, opaque-type special-casing
  at 3798-3799). Per spec an iframe load is a **navigation request**: CORS
  never applies to it, and the actual gates — `X-Frame-Options` and CSP
  `frame-ancestors` — are checked nowhere today. The `!url.includes('://')`
  relative-URL test (3794) also misclassifies `data:` and `blob:` as relative
  and joins them onto the document URL.

Target behavior: `srcdoc` / `src` / `about:blank` iframes with a real document
subtree, inline + remote `<script>` execution, correct `contentDocument` /
`contentWindow` with cross-origin blocking, working `postMessage`, shadow DOM
and custom elements inside iframes, resources that load and render, iframe
content painted into the page, and a CDP frame model that Playwright can
actually evaluate into. Each frame document has a browser-like Window realm;
classic scripts, modules, direct and indirect `eval`, `Function`, string timers
and CDP evaluation all execute in that realm rather than in a scoped facade over
the top page. Dedicated Workers get a persistent Worker realm and task queue.

## Non-goals for this round

Stated up front so the phases stay honest:

- **Addressing nodes inside a frame from CDP.** `DOM.getBoxModel` /
  `getContentQuads` (`crates/obscura-cdp/src/domains/dom.rs:293`, `:331`)
  evaluate a `getBoundingClientRect()` JS string against the main document, and
  `_wrap()` only resolves main-document NodeIds. See Phase 6.6.
- **Out-of-process iframe isolation (OOPIF).** Child Window realms may share the
  page's V8 isolate, as same-process Chromium frames do. Cross-origin access is
  still enforced by WindowProxy; process boundaries are not the security model.
- **Full session history and BFCache.** Cross-document and same-document frame
  navigation, `location.assign` / `replace` / `reload`, redirects and lifecycle
  events are in scope. Traversing a retained frame history and restoring frozen
  documents is a follow-on.
- **SharedWorker, ServiceWorker and worklets.** This design covers dedicated
  `Worker`; the other worker families need separate lifetime and registration
  models.
- **Every sandbox, Permissions Policy, COOP and COEP feature.** The security
  subset implemented in Phase 3 is explicit. Unsupported flags must fail closed
  when they protect script or same-origin access; they must not silently grant
  a capability.
- **Complete iframe accessibility and input routing.** Basic scrolling, focus
  and hit testing needed by Playwright are in scope; accessibility-tree merging,
  drag-and-drop and browser UI integration are follow-ons.

## Chosen architecture

Three decisions, each with a different rationale. The first draft bundled them
into one and drew the wrong conclusion for rendering.

### 1. One `DomTree`, many document scopes

The iframe content document lives *inside* the parent's single `DomTree` as an
out-of-band owned subtree — the pattern shadow roots already use
(`shadow_roots` / `shadow_roots_by_host`, `crates/obscura-dom/src/tree.rs:259`).
The content root is a `NodeData::Document` node with `parent = None`, so it is
unreachable from `descendants(document())` by construction.

Why: DOM ops stay on one arena, so the `_dom` bridge needs no tree routing and
no NodeId namespace; node identity is stable across the JS boundary; shadow DOM,
custom elements and `<template>` inside frames work with no extra plumbing.

Note that "shadow DOM works for free" is *not* an argument against a second
`DomTree` — a second tree would support shadow DOM just as well. The real
argument is the `_dom` bridge and NodeId identity.

### 2. Per-document **render root**, not a flattened render tree

Rendering does **not** merge iframe content into the parent's render tree.
Instead the render pipeline is parameterized by a root `NodeId`, and each
document scope gets its own layout and its own pixmap, composited into the
parent as replaced content. Full rationale and the evidence against flattening
are in Phase 5.

### 3. One Window realm per document, one realm per isolated world

Every active frame document gets a real V8 context for its main world. Each CDP
isolated world gets another context associated with the same frame and document
generation. Classic scripts are compiled as scripts in the target context, and
modules are instantiated there; neither path uses `new Function` or `with` to
simulate a global. This is required for global declarations, `globalThis`,
top-level `this`, strict mode, direct/indirect `eval`, `Function`, timers and
cross-realm prototypes to behave like a browser.

The contexts may live in one isolate, but realm-local state is keyed by
`(frame_id, document_generation, world_id)`. A stable WindowProxy belongs to the
browsing context and forwards to the active Window global after access checks.
Cross-document navigation replaces the Window, Document and worlds while
preserving WindowProxy identity. Dedicated Workers use a separate persistent
runtime/realm rather than borrowing either the parent or child Window realm.

## Implementation phases

### Phase 0 — Fix the pre-existing `remove_child` owned-subtree gap

**Files:** `crates/obscura-dom/src/tree.rs`

`remove_child` (`tree.rs:844`) collects ids with light-only
`self.descendants(node_id)`, so removing a shadow host leaves that host's shadow
descendants registered in `id_index` and leaves `shadow_roots` /
`shadow_roots_by_host` entries behind. `remove` (`tree.rs:874-906`) gets this
right via `inclusive_owned_subtrees` (`tree.rs:923`).

Phase 1 adds a second kind of owned subtree and Phase 6.4 hooks this exact code
path to emit `frameDetached`. Landing on top of the bug doubles it. Small,
independently testable, do it first.

### Phase 1 — Document scopes in `DomTree`

**Files:** `crates/obscura-dom/src/tree.rs`, `tree_sink.rs`,
`crates/obscura-browser/src/page.rs`

1. Registries mirroring shadow roots (`tree.rs:259-260`):
   `iframe_content_documents: HashMap<NodeId, NodeId>` (host → content root) and
   `iframe_content_documents_by_root` (content root → host). Content root =
   `NodeData::Document` with `parent = None`.
2. **`document_scopes: HashMap<NodeId, DocumentScope>`**, keyed by content root:
   ```
   Origin = Tuple { scheme, host, port } | Opaque(OpaqueOriginId)
   DocumentScope {
       url, origin: Origin, base_url, sandbox: SandboxFlags,
       csp: Option<String>, frame_id, document_generation
   }
   ```
   This was Phase 4 in the first draft, which was a dependency inversion: Phase 3
   cannot fetch an iframe's external scripts without its base URL and cannot make
   a same-origin decision without its origin. Origin inheritance rules live here
   too: `about:blank`, `srcdoc` and `javascript:` inherit the host document's
   origin; tuple URLs take the origin of the final response URL; `data:` and
   sandbox without `allow-same-origin` get a fresh opaque origin; `blob:` uses
   the origin carried by the blob URL/store entry. Opaque origins serialize as
   `"null"` but are never same-origin merely because their serialization is
   equal. Same-origin tests compare `Origin`, not strings or `URL.origin`.
3. Methods parallel to the shadow-root methods (`tree.rs:323/411/419`):
   `attach_iframe_content_document(host, root)`, `iframe_content_document(host)`,
   `iframe_host(root)`, `is_iframe_content_document(node)`, plus an
   `AttachIframeError` mirroring `AttachShadowError` (`tree.rs:49`).
   Unlike shadow roots, **re-attachment is legal, because frames navigate**:
   when the host already has a content root, `attach_iframe_content_document`
   atomically makes the new root active and returns the old root id. The old
   root is removed from the active render/query registries and its execution
   contexts are destroyed, but JS wrappers are not blindly neutered: if script
   retains the old `Document`, the detached document and its nodes remain usable
   until their wrappers become unreachable. A generation-owned arena entry
   provides this lifetime; collection then calls the Phase 0 removal path and
   drops its `document_scopes` entry. `AttachIframeError` covers structural
   misuse (host is not an iframe element, a cycle would form), not navigation.
4. Extend the traversals that already know about shadow boundaries:
   - `inclusive_owned_subtrees` (`tree.rs:923`) is the single definition of
     "owned subtree" — extend it there and `remove` (`tree.rs:874`) follows,
     including the double-map cleanup that guards against NodeId slot reuse
     (`tree.rs:895-906`).
   - `shadow_including_root` (`tree.rs:446`) hops content root → host and
     continues up.
   - `set_subtree_connected` (`tree.rs:473`), `would_create_host_including_cycle`
     (`tree.rs:535`) via `host_including_parent` (`tree.rs:523`),
     `detach_for_reparent` (`tree.rs:791`, must refuse content roots the same way
     it refuses shadow roots at `:796`).
   - `get_element_by_id` (`tree.rs:1297`): the existing
     `containing_shadow_root(node).is_none()` check becomes a general
     "does this node's tree scope match the requested one" check.
     `tree_scope_root` **already exists** at `tree.rs:426`.
5. `parse_into_subtree(tree, content_root, html)`:
   `parse_html(html)` (`tree_sink.rs:353`, which enables declarative shadow roots
   — correct for a document) into a temp tree, then
   `import_children_from(content_root, &tmp, tmp.document())`.
   **No new deep-copy code is required.** `import_children_from`
   (`tree.rs:1397`) → `import_node_from` (`tree.rs:1471`) already performs an
   iterative cross-tree copy with `template_contents` remapping (issue #463).
   The first draft called deep-copy "the highest-risk Rust change"; that work is
   already done and tested.
6. No selector work. `query_selector_from` / `query_selector_all_from` already
   exist (`selector.rs:698`, `:760`) and scope correctly because `descendants`
   does not cross tree scopes. The `#id` fast path (`selector.rs:703-722`) falls
   through to a full scan for non-document scopes — same as shadow today,
   acceptable.
7. Add a browser-core `BrowsingContext` registry on `Page`, rather than making
   CDP own the frame model:
   ```
   BrowsingContext {
       frame_id, parent_frame_id, host_nid, window_proxy,
       active_document_root, document_generation, navigation_generation,
       loader_id, children
   }
   ```
   CDP Phase 6 is a projection of this registry. A frame id and WindowProxy stay
   stable across navigation; Document, Window and execution worlds do not.
8. A navigation obtains a monotonically increasing `navigation_generation`.
   Fetch, parse and script work carries it, and may commit only if it is still
   current. Starting B aborts or supersedes A, so a slow response for an old
   `iframe.src` cannot overwrite a newer navigation. Removal invalidates the
   generation before detaching the subtree.

Note on `id_index` (`tree.rs:255`): it is tree-global and first-wins
(`tree.rs:577-584`). The scope check in (4) is what keeps an iframe's ids from
answering the parent's `getElementById`, exactly as it does for shadow today.

### Phase 2 — Real Document / Window bindings

**Files:** `crates/obscura-js/src/ops.rs`, `runtime.rs`, `js/bootstrap.js`,
`crates/obscura-browser/src/page.rs`

1. New `op_dom` commands (in `op_dom_inner`, `ops.rs:1134`), all against the
   single `dom`: `create_iframe_content_document(host)`,
   `iframe_content_document_root(host)`, `parse_into_subtree(root, html)`,
   `document_root(nid)` (= `tree_scope_root`, main document = 0),
   `query_selector_scoped` / `query_selector_all_scoped`,
   `document_scope_info(root)` (url / origin / sandbox flags).
2. Wrapper routing is per V8 world, not process-global. Each world has a NodeId
   cache and a Document wrapper for its active document. A Node wrapper records
   its native NodeId, owning document generation and wrapper world. Same-origin
   cross-frame access returns a wrapper with the node's correct owner realm and
   prototype; isolated worlds may have their own wrappers, matching browser
   world separation. Do not manufacture an iframe node with top-frame
   constructors merely because the caller is in the top frame.
3. **`ownerDocument` needs a cache, not an op call per access.** It is
   `return globalThis.document` today (bootstrap.js:1856) — a constant on one of
   the hottest properties in the DOM. Stamp the scope onto the wrapper when it is
   created (the creating call site always knows its scope), invalidate on the
   mutation paths that can move a node across scopes, and call `document_root`
   only on a cache miss. Benchmark before and after: a regression here shows up
   on every page, iframes or not.
4. Add the same-origin helper that does not exist. Every check today is an
   inline IIFE (e.g. bootstrap.js:3822-3827), and the Rust one is `pub(crate)`
   (`crates/obscura-net/src/client.rs:312`), invisible across crates. The
   authoritative comparison uses Phase 1's `Origin` enum in Rust. JS receives
   only serialized origins for APIs such as `MessageEvent.origin`; it must never
   compare two serialized `"null"` opaque origins as equal.
5. Replace the shim with a stable WindowProxy. `contentDocument`
   (bootstrap.js:3819) returns the real Document only when the caller and target
   are same-origin, otherwise `null`. `contentWindow` (`:3835`) always returns
   the WindowProxy, but every property access goes through an incumbent-origin
   access check. Cross-origin callers get only the HTML cross-origin Window
   allowlist (`window`, `self`, `frames`, `length`, `top`, `parent`, `opener`,
   `closed`, indexed child access, `postMessage`, `blur`, `focus`, `close` and a
   write-only/navigable `location` surface); `document`, arbitrary expandos and
   reading `location.href` throw `SecurityError`. Checking only
   `HTMLIFrameElement.contentDocument` is not a security boundary.

   Set `frameElement`, `top` and `parent` to the real WindowProxies, subject to
   the same access checks. Retire `_IframeDocument` and the realm-facade portion
   of `_IframeWindow`; keep a WindowProxy host object whose target can change.
   On navigation it points to the new Window global while retained references to
   the old Document remain detached but usable until collected.
6. Make `Document` methods scope-aware for non-zero roots (`querySelector`,
   `getElementById`, `documentElement`, `head`, `body`, `title`, `styleSheets`);
   root 0 keeps its existing code path unchanged.
7. Make URL- and origin-sensitive Web APIs consume the calling realm's
   `DocumentScope`, not top-level `gs.url`: `document.cookie`, fetch/XHR base
   URL and credentials, `localStorage`, `sessionStorage`, Cache-like shims and
   security errors. `localStorage` is keyed by tuple origin; `sessionStorage` is
   keyed by top-level browsing-context group plus origin. Opaque origins throw
   where the platform requires it. HTTP cookies remain in the shared cookie jar
   but cookie reads/writes use the frame document URL and sandboxed origin.
8. Cross-document node operations follow DOM semantics. `adoptNode` changes the
   owner document and wrapper ownership without cloning; `importNode` clones.
   `compareDocumentPosition` for nodes in different documents returns
   `DOCUMENT_POSITION_DISCONNECTED | DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC`
   plus a stable implementation-specific order, rather than pretending the raw
   arena NodeId establishes document order.

### Phase 3 — Content loading and script execution

**Files:** `crates/obscura-browser/src/page.rs`,
`crates/obscura-js/js/bootstrap.js`, `src/runtime.rs`, `src/module_loader.rs`,
`src/ops.rs`

1. **Give frame loading navigation semantics.** An iframe load is a navigation
   request, not a CORS-gated subresource fetch: no `mode: 'no-cors'`, no CORS
   requirement on the response, no opaque-type special-casing — the load goes
   through the Rust path in 3.5 with no CORS filtering, gated instead by
   `X-Frame-Options` / `frame-ancestors` / `frame-src` (3.2). Rejecting
   cross-origin responses that lack CORS headers would be wrong-by-spec and
   would break exactly the embeds Phase 4 exists for — payments, OAuth and
   players are all cross-origin frames. The response body entering the shared
   native DomTree for rendering does not put its scripts in the top Window
   realm and is not a reason to apply CORS. Also replace the
   `!url.includes('://')` relative-URL test
   (3794), which misclassifies `data:` and `blob:` as relative and joins them
   onto the document URL. Carry a real `FrameNavigationRequest` containing URL,
   GET/POST method and body, initiator frame/origin, referrer/referrer policy,
   history mode and user-activation bit. Emit browser-shaped navigation request
   metadata (`Sec-Fetch-*`, cookies/credentials, UA/client hints) through the
   same interception and network-event path as top-level navigation.
2. Honour `X-Frame-Options` and CSP `frame-ancestors` on the iframe response,
   and the embedding document's `frame-src`. Evaluate `frame-ancestors` against
   the complete ancestor-origin chain and implement XFO `DENY`/`SAMEORIGIN`
   with browser precedence when an enforced `frame-ancestors` policy is present.
   Apply the embedding policy before request/redirect where possible and the
   response policy to the final response before commit. A blocked navigation
   must not expose or execute its response body and emits a consistent failed
   navigation/load outcome. Today nothing loads so it does not matter; from this
   phase on it does.
3. Parse `sandbox` into flags captured for each navigation. Implement at least
   `allow-scripts`, `allow-same-origin`, `allow-forms`, `allow-popups`,
   `allow-top-navigation`, `allow-top-navigation-by-user-activation` and
   `allow-popups-to-escape-sandbox`, because they directly affect script and
   navigation. Missing permission fails closed. Sandbox flags propagate to
   nested browsing contexts; absence of `allow-same-origin` creates a fresh
   opaque origin rather than the shared string `"null"`.
4. Create the initial `about:blank` Document synchronously when a connected
   iframe browsing context is created, before any async `src` navigation.
   `srcdoc`, when present, takes precedence over `src`; adding, changing or
   removing either attribute schedules the correct replacement navigation.
   `srcdoc` and initial/explicit `about:blank` inherit the creator origin unless
   sandbox forces an opaque origin. `javascript:` executes in the target realm;
   a string completion replaces the document while retaining the target origin
   and URL rules, and a non-string completion leaves it unchanged.
5. **One navigation path.** Rust-side loading replaces the pre-scan at
   `page.rs:2615`: `navigate_frame(frame_id, FrameNavigationRequest)` → fetch via
   `ObscuraHttpClient` with navigation semantics (3.1; gated by 3.2) → validate
   the final response and commit a new Window/Document/main world → run matching
   preload/init scripts → parse with script checkpoints → settle defer/module
   scripts and blocking sub-resources → fire `DOMContentLoaded`/`load` and the
   iframe host's `load`.
   All entry points invoke the same browser-core navigation controller: parser
   insertion, `src`/`srcdoc`
   mutation, `contentWindow.location`, frame code's `location.href` /
   `assign` / `replace` / `reload`, `_self` links and forms, named targets and
   CDP `Page.navigate(frameId)`. They do not retain parallel JS fetch paths.
   Resolve redirects before committing URL, origin, base URL and loader id.
   Distinguish same-document fragment navigation from a new Document.

   Every async step carries Phase 1's navigation generation. A newer navigation
   aborts/supersedes the old request and stale work cannot commit, parse, execute
   script or emit lifecycle events. Response commit atomically fires supported
   unload/pagehide steps, destroys the old worlds, swaps in the new Document and
   Window/main world plus registered isolated worlds, and preserves
   WindowProxy/frame identity. Parsing and post-commit tasks continue to check
   the generation so a subsequent navigation can cancel them.
   - **Loader-level recursion guard.** `navigate_frame` starts navigations for
     iframes found in the fetched content, so a self-embedding page would
     loop at the fetch layer — the Phase 5.6 cap is paint-side and runs too
     late to help. Browser behavior: refuse to load a frame whose URL equals
     an ancestor document's URL in its own frame chain, and enforce the depth
     cap here, not only at paint.
   - **Parent `load` gating.** Each Document has its own load-delay counter.
     Parser-created child navigations delay that document's `load` recursively;
     a dynamically inserted frame after `load` does not retroactively delay an
     event that already fired. Do not approximate this with one page-global
     pending-resource set.
6. **Sub-resources of frame content — stylesheets are not free.** External CSS
   today loads through `linked_stylesheet_requests` (`page.rs:812`), which
   queries the main document only, and is installed by a materialization
   script (`page.rs:729`) that walks the top-level `document.querySelectorAll`
   — neither reaches a content root. Both need a content-root variant (query
   via `query_selector_all_from`, materialize against the frame's Document
   wrapper), resolving URLs against the frame's scope. Without this, frame
   content renders unstyled and the Phase 5 pixel tests fail immediately.
   Images *should* come for free once 5.1 lands — intrinsics collection is
   driven from the render root (`paint.rs:8891`) and fetching goes through
   `pending_render_image_urls` (`runtime.rs:806`) — but verify with a test
   rather than assuming.
7. **Create real Window realms before executing any frame script.** Add a realm
   registry in `obscura-js` keyed by
   `(frame_id, document_generation, world_id)`. Use deno_core's supported realm
   API if it installs extensions and ops correctly; otherwise build the needed
   V8 contexts explicitly and add a realm-aware op dispatcher. Installing the
   bootstrap is not sufficient by itself: timers, microtasks, module state,
   `currentScript`, URL resolution, wrapper caches, event callbacks and pending
   fetches must all carry the realm key. Navigating or detaching a frame cancels
   its pending tasks and destroys all contexts for that document generation.

   Do not use `new Function(..., code)` or `with` as a fallback for frame
   scripts. Besides leaking the true global, that changes Script grammar and
   breaks top-level `var`/`function`, global lexical bindings, strict-mode
   directives, top-level `this`, `globalThis`, syntax errors and sharing between
   consecutive scripts.
8. Extend `execute_scripts` (`page.rs:1453`; thin wrapper at `:1407`) with a
   target realm/content root. Discovery uses `query_selector_all_from`; the
   `<base>` pre-scan and already-started flags are document-local; dynamic
   scripts remember their preparation-time document and realm. Compile classic
   scripts with V8's Script goal in the frame main-world context and execute
   them once, setting and restoring that realm's `document.currentScript`.

   A full-tree parse followed by a script scan is not browser parser semantics:
   it exposes later nodes to early scripts and cannot implement `document.write`.
   Add parser checkpoints so a parser-blocking inline/external classic script
   runs before tokenization continues; feed `document.write` input back into the
   active tokenizer; run `defer` and parser-inserted modules after parsing and
   before `DOMContentLoaded`; run `async` when ready; preserve dynamic-script
   ordering rules. Two script elements share the frame's global variable and
   lexical environments exactly as normal browser scripts do. Reuse this
   parser/script coordinator for the main document later instead of maintaining
   divergent semantics.
9. Native realm execution supplies dynamic-code semantics. Direct `eval` sees
   the caller's lexical environment; indirect eval and `Function` use the
   frame's global environment; `this` and `globalThis` are the frame Window;
   declarations bind in the correct environment. A string timer records the
   scheduling realm and compiles as script in that realm when its task runs.
   Function callbacks also enter their creation realm. No proxy-based evaluator
   is permitted on the browser-parity path.
10. Modules: `ObscuraModuleLoader.base_url` (`module_loader.rs:70`) is an
    immutable per-runtime singleton that `set_url` (`runtime.rs:328`) does not
    touch. Replace singleton assumptions with a module map/fetch context keyed
    by realm/document environment settings. Instantiate and evaluate modules in
    the importing frame's realm. Static and dynamic imports resolve against the
    importing module URL; CORS and credentials use the importing document's
    origin, not the top document's. Navigation discards that document's module
    map after outstanding jobs are cancelled.
11. **Dedicated Worker is a persistent execution environment.** Replace the
    `new Function` Worker shim (`bootstrap.js:12484`) with a worker controller
    owning a persistent Worker realm, event loop/task queue and watchdog. A
    separate `JsRuntime`/isolate is preferred so `terminate()` and runaway code
    do not terminate the page isolate. The worker source executes exactly once;
    later messages dispatch to retained `onmessage`/listeners.

    Resolve the constructor URL against the creator frame document's base URL,
    but expose the final worker script URL as `WorkerLocation.href`. The worker
    environment's origin derives according to the Worker specification from
    the creator and script URL; it is not simply the frame's `location` object.
    Enforce classic-worker same-origin rules, module-worker CORS/credentials,
    `worker-src`, `type`, `credentials` and `name`. `postMessage` in both
    directions uses structured clone and transfer/detachment semantics. Worker
    `fetch`, dynamic imports and `importScripts` resolve from the worker script
    environment, not the top page. Blob/data URL origin is taken from the URL
    store/creation environment.

### Phase 4 — Cross-document messaging

**Files:** `crates/obscura-js/js/bootstrap.js`, `src/runtime.rs`, `src/ops.rs`

This phase was missing from the first draft and is the one most real embeds
need — payments, OAuth, players and ad frames are all `postMessage`-driven.

Current state is unusable in both directions:

- iframe → parent: `top` and `parent` are `globalThis` (bootstrap.js:11578-11579)
  and `globalThis.postMessage` is `function() {}` (bootstrap.js:12619), so the
  message is silently dropped.
- parent → iframe: `_IframeWindow.prototype.postMessage`
  (bootstrap.js:11617-11626) fills `origin` with the *receiver's* origin and
  `source` with the *receiver*, ignores `targetOrigin` entirely, skips
  structured cloning, and dispatches on `globalThis` rather than the frame.

Plan: one realm-aware
`deliver_message(target_context, source_context, message, transfer, targetOrigin)`
implemented below the author-visible bootstrap:

- use the same tested structured-clone/transfer primitive as `MessagePort`,
  including transferable detachment and `DataCloneError`;
- set `origin` from the sender's typed origin serialization and `source` to the
  sender browsing context's WindowProxy;
- resolve the default `'/'` against the sender origin, accept `'*'`, and compare
  exact target origins using Phase 1's typed origins rather than serialized
  strings;
- enqueue a message task owned by the target realm/document generation. Drop it
  if that generation is destroyed before delivery.

Wire `window.parent`, `window.top`, `window.frames[i]` and `contentWindow`
through it. `window.length` / `window[0..49]` (bootstrap.js:6005-6019) then
return real frame proxies instead of shims.

### Phase 5 — Rendering: per-document render root

**Files:** `crates/obscura-render/src/dom.rs`, `paint.rs`,
`crates/obscura-browser/src/page.rs`, `crates/obscura-cdp/src/domains/input.rs`

#### Why not flatten the render tree

The first draft proposed overriding `rendered_children` (`dom.rs:9066`) and
`rendered_parent` (`dom.rs:9115`) so iframe content joins the parent's render
tree, on the theory that "the render engine walks one tree, so it reaches iframe
content naturally". It does not work:

- **Computed style does not travel through `rendered_children`.** Inheritance
  walks a *different* function, `style_children` (`dom.rs:9046`), reached from
  only two call sites (`dom.rs:4937`, `:5721`). Flattening the render tree
  leaves iframe content with no computed style at all — nothing paints. Adding
  it to `style_children` instead makes the parent's `color`, `font-size`,
  `direction` and the rest of `Inherited` (`dom.rs:4660-4707`) cross the document
  boundary, which CSS forbids.
- **Author CSS is collected globally.** `dom.rs:4250` walks
  `tree.descendants(tree.document())` and compiles one `Stylesheet`
  (`dom.rs:4269`). Shadow DOM has a per-root mechanism
  (`collect_shadow_stylesheets`, `dom.rs:4182`, whose doc comment at
  `:4176-4181` explains the isolation comes from `descendants` being
  tree-scoped). The draft proposed no iframe equivalent, so parent rules would
  match frame content and frame `<style>` would leak into the parent.
- **The layout root is global.** `rendered_descendants(tree, tree.document())`
  drives `ScrollTree` construction (`dom.rs:1184`, whose root container is
  hardcoded to the parent viewport at `:1195-1203`), `viewport_fixed_nodes`
  (`:1144`), `reparent_inset_positioned_nodes` (`:8186`) and
  `synthesize_row_rects` (`:9907`). Canvas background comes from
  `query_selector("html")` / `("body")` (`paint.rs:3190`, `:3195`), which returns
  the first match in document order. The `rem` base is `styles[root_id]`
  (`dom.rs:4760`).
- **`rendered_parent` reads the real DOM parent field** (`dom.rs:9116`), and the
  stacking-context walk climbs it (`paint.rs:3067-3074`). An iframe branch there
  would let z-index leak across the frame boundary; a frame must be an atomic
  stacking unit.
- The draft's own 5.1 (flatten into the parent's box tree) and 5.2 (rasterize at
  the content viewport size) are two different layout models applied at once.

#### 5.1 Parameterize the render pipeline by root

Everything the layout pipeline needs is already a parameter **except the root**.
`viewport` is passed by value all the way down to `vw` / `vh`
(`dom.rs:4758-4759`), media-query evaluation (`:4256-4260`) and the taffy
available space (`:6174`). Only `tree.document()` is hardcoded, in a small,
enumerable set of places:

| Site | Purpose |
|---|---|
| `dom.rs:4270` | `<style>` collection |
| `dom.rs:4584` | quirks-mode doctype probe |
| `dom.rs:4591` | `cascade_walk` entry |
| `dom.rs:4630` | taffy tree root |
| `dom.rs:4176` | `collect_shadow_stylesheets` stack seed |
| `dom.rs:1184`, `:1144`, `:8186`, `:9907` | scroll tree, fixed set, abspos reparent, table rows |
| `paint.rs:8891` | `collect_image_intrinsics` |
| `paint.rs:3190`, `:3195` | canvas background source |

Thread a `root: NodeId` through `layout_dom_once` (`dom.rs:4552`),
`layout_dom_with_web_fonts_pass_limit_at_animation_time` (`dom.rs:4233`),
`prepare_dom*` (`paint.rs:2481`) and `paint_laid_dom_scrolled`
(`paint.rs:3332`), replacing each of those. Passing `tree.document()` reproduces
today's behavior exactly, so **this lands as a behavior-preserving refactor with
the entire existing test suite as its oracle** — which is why it is scheduled
early, before anything depends on it.

`rendered_children`, `rendered_parent` and `style_children` are **not** touched.
Isolation comes from `descendants(root)` being tree-scoped, the same property
`collect_shadow_stylesheets` already relies on.

Main-document NodeIds and content-root NodeIds are disjoint (a content root has
`parent = None` and is not in `descendants(document())`), so the resulting
`DomLayout`s coexist without a NodeId namespace.

#### 5.2 Per-root caches

| Cache | Where | Requirement |
|---|---|---|
| `StylesheetCache` | `css.rs:2420`, single slot keyed by `(sources, viewport, media)` (`:2442-2450`) | One instance per render root. The key is exact so sharing is *correct*, but a single slot means parent and child evict each other on every alternation. |
| `RetainedStyleMaps` | `dom.rs:575`, NodeId-keyed | Separate instances. The keys are disjoint, but the planner (`dom.rs:3774`) should never be asked to reason across documents. Compare the existing shadow guard at `dom.rs:4368-4381`. |
| `RenderResourceCache` | `paint.rs:137`, URL-keyed | Shareable, and sharing is desirable for same-origin resources — except `content_image_intrinsics` (`paint.rs:143`), which is NodeId-keyed. |
| `AnimationTimelineState` | NodeId-keyed | Separate instance per root. |

There is no global mutable state to worry about: `obscura-render` has exactly
three `static`s, all `OnceLock` (`paint.rs:7251`, `:10005`), no `thread_local!`,
no `static mut`.

#### 5.3 Sizing needs no fixpoint

`iframe` is already in `is_replaced` and `has_replaced_sizing`
(`inline.rs:2729`, `:2753`) with a constant 300×150 intrinsic size
(`inline.rs:2763`), and `dom.rs:12101-12121` turns it into a taffy leaf with that
context before any content-dependent path runs. **Iframe content therefore never
changes the parent's layout.** The dependency order is strictly one-way:

```
parent layout  →  iframe content box size  →  child layout (that size as viewport)
               →  child paint → Pixmap  →  parent paint blits it
```

No second parent pass, unlike `content:url()` (`paint.rs:2555-2578`). CSS
`width` / `height` on the iframe element work as they do today.

#### 5.4 Compositing

Paint each content root into its own `Pixmap` and composite it as replaced
content alongside the `canvas` branch (`paint.rs:4308-4339`), which already
handles content-box insets, `object-fit`, `object-position` and the
border-radius clip. Keep the child Pixmap exactly the content-box size
(`ObjectFit::Fill`, 1:1) so no scale factor enters the coordinate math later.

One trap: `paint_canvas_surface` (`paint.rs:9285`) converts straight alpha to
premultiplied at `:9308-9314`, but a `tiny_skia::Pixmap` is already
premultiplied. Either add a flag to `CanvasSurface` or split out a
`paint_replaced_pixmap` that skips that loop. Feeding a Pixmap through the
canvas path unchanged double-multiplies alpha.

Surfaces reach paint through a source trait, as canvas already does
(`CanvasSurfaceSource`, `paint.rs:635`; the js-side implementation is
`RuntimeCanvasSurfaceSource`, `crates/obscura-js/src/runtime.rs:22`). Extending
that trait is much cheaper than adding a 28th parameter to
`paint_laid_dom_scrolled` and updating its eight call sites.

#### 5.5 Load and repaint timing

Phase 3's navigation controller is the only iframe fetcher. Do not introduce a
second `pending_iframe_urls()` screenshot-time loader. A successful child
Document commit and later child resource completion mark that frame render root
dirty and enqueue a `RetainedStyleMutation::Resource` (`dom.rs:556`) for parent
compositing. Screenshot/PDF preparation waits on the same per-Document load and
resource state; it does not re-fetch the iframe URL. Because iframe intrinsic
size is constant, a child-only resource completion normally rebuilds/repaints
the child surface and composites it without relaying out the parent.

#### 5.6 Nesting

Recurse. The depth cap is enforced at the loader (Phase 3.5) — by paint time a
self-embedding page has already fetch-looped. Note the first draft's "≈8,
Chromium-like" is not Chromium-like — Blink's `kMaxFrameDepth` is on the order
of 100. Pick a cap that does not break real ad and embed stacks; paint a
placeholder for content past it.

#### 5.7 Print and PDF

Screenshots and PDF no longer get frame content "for free" — that claim depended
on flattening. Both go through the same explicit blit, and the child must be
rendered with the parent's media type (`prepare_dom_..._for_media_...`,
`ops.rs:4315`; PDF sets it at `crates/obscura-browser/src/pdf.rs:313`).

#### 5.8 Basic interactivity and coordinate routing

Hit testing starts in the parent layout. If the hit lands in an iframe content
box, translate the point into the child viewport, apply the child's scroll
offset and recurse. Route pointer/mouse events, click default actions and focus
to that frame Document; event propagation stops at its Document and does not
bubble through the iframe element. Keyboard events go to the focused browsing
context. `window.scroll*`, element scrolling and CDP input use the child
`ScrollTree` when their target context is a child frame. Focus updates
`document.activeElement` to the iframe element in the parent and to the actual
focused element in the child. This is the minimum needed for Playwright
`frameLocator().click()`/typing; accessibility-tree merging remains out of
scope.

### Phase 6 — CDP frame projection and execution-context routing

**Files:** `crates/obscura-cdp/src/domains/page.rs`, `runtime.rs`, `dispatch.rs`,
`crates/obscura-browser/src/page.rs`

The first draft's Phase 6 would have made Playwright *worse*. `page.frames()`
returning child frames is only useful if `frame.evaluate()` works, and today
`Runtime.evaluate` validates `contextId` and then discards it — the tracing at
`domains/runtime.rs:413-419` literally says "single-isolate routing" — while
every `executionContextCreated` fills `auxData.frameId` with the same
`page.frame_id` (`domains/page.rs:806`, `:823`, `:1180`). A client that
discovers a child frame and evaluates into it would silently run against the
main document. That is worse than today's honest `childFrames: []`. Phase 3's
real realms and the routing below are therefore prerequisites of advertising a
child frame.

1. Project Phase 1's browser-core `BrowsingContext` registry into CDP rather
   than maintaining a second source of truth. Keep `iframe_host_to_frame_id` as
   an index if useful. Stable `frame-<page>-<n>` ids identify browsing contexts;
   loader ids and document generations change on cross-document navigation.
2. Maintain an execution-context table:
   ```
   contextId -> {
       frame_id, document_generation, world_id, v8_context_handle,
       is_default, unique_id
   }
   objectId -> { context_id, v8_object_handle }
   ```
   Emit `Runtime.executionContextCreated` only after the real Phase 3 context
   exists. Emit `executionContextDestroyed` for every main or isolated world on
   navigation/detach, invalidate its object handles, cancel pending evaluations
   and reject later use with Chrome-shaped errors. A numeric id registered in
   `valid_context_ids` without a V8 context is not an execution context.

   Route all context-sensitive Runtime operations, not only
   `Runtime.evaluate`: at minimum `evaluate`, `callFunctionOn`, `getProperties`,
   `releaseObject`, `releaseObjectGroup`, promise awaiting and bindings. An
   `objectId` implicitly selects its owning context; supplying arguments or an
   explicit context from another world is rejected unless CDP permits a
   by-value transfer. Async continuations and post-evaluation navigation drain
   against the same frame/document generation.
3. **`Page.createIsolatedWorld` creates a real realm.** Today the frameId is
   echoed into `auxData` (`domains/page.rs:1217`) while evaluation still reaches
   the main global. Create a distinct Phase 3 context for the requested
   `(frame_id, document_generation, world_name)`, with independent globals and
   DOM wrappers but access to the same native DOM. It must not leak Playwright's
   utility globals into the page main world.

   `Page.addScriptToEvaluateOnNewDocument` sources carry their world name and
   run in every matching new frame world after Window/Document bootstrap and
   before author script. Implement `runImmediately` for existing matching
   worlds. Playwright's utility script therefore executes in its isolated world,
   not in the frame main world under a different bookkeeping id.
4. `Page.frameAttached` / `Page.frameDetached` — neither exists today. Build
   `childFrames` recursively in `getFrameTree` (`domains/page.rs:1152`), and fix
   `securityOrigin`, which currently holds a full URL (`:1163`). The main frame's
   `frameId` stays equal to the targetId (Chromium convention — breaking it
   breaks Playwright).
5. `Page.navigate` with an optional `frameId` (`do_navigate`,
   `domains/page.rs:1039`) reuses the browser-core `navigate_frame` controller
   and emits child
   `frameNavigated` / `lifecycleEvent` / `frameStartedLoading` /
   `frameStoppedLoading` with `parentFrameId`. iframe element removal emits
   `frameDetached` and cleans both registries, hooking the `remove_child` path
   fixed in Phase 0.
6. Explicitly out of scope: addressing nodes *inside* a frame over CDP (see
   *Non-goals*). Note that `getBoundingClientRect()` called from script inside a
   frame is correct by construction, because the child's `DomLayout` is already
   expressed in the child's own viewport coordinates.

## Constraints and known compromises

- **Shared isolate, separate realms.** Window contexts may share one V8 isolate,
  so this does not reproduce Chromium OOPIF process isolation. Realm-visible JS
  semantics and cross-origin WindowProxy checks must nevertheless match the
  browser. The isolate watchdog remains the page-level backstop: a runaway child
  frame may terminate the page's isolate, while a Worker uses a separate runtime
  so it can be terminated independently.
- **Cross-realm DOM wrappers are implementation work, not free.** A NodeId in
  Rust does not by itself provide Web IDL wrapper identity, realm-correct
  prototypes or cross-origin checks. Wrapper caches are per world, ownership is
  tied to the node's document, and all entry points to a WindowProxy perform the
  caller/target origin check. The raw `_dom` bridge must not be exposed to author
  script in a way that bypasses those checks.
- **CSP and sandbox are an explicit subset.** Phase 3 covers embedding policy,
  script permission, origins and navigation-related sandbox flags. Other CSP
  directives and Permissions Policy remain follow-ons. Unknown security flags
  do not silently grant script, origin or top-navigation capability.
- **No BFCache or full joint session history.** The active Document replacement
  and same-document navigation behavior are implemented, but traversing and
  restoring historical frame documents is not.
- **Dedicated Worker is not a browser process.** Its persistent separate runtime
  supplies realm, task, message and termination isolation. OS scheduling and
  resource accounting need not match Chromium exactly.

## Risks

| Risk | Where | Mitigation |
|---|---|---|
| Render-root refactor regresses the main document | Phase 5.1, ~11 call sites | Passing `tree.document()` is a no-op by construction; land it alone, ahead of any dependent work, and gate on the full existing render suite |
| `ownerDocument` becomes a bridge round-trip | Phase 2.3, bootstrap.js:1856 | Scope cached on the wrapper; op call only on miss; benchmark gate |
| Alpha double-multiplication in the blit | Phase 5.4, paint.rs:9308-9314 | Dedicated `paint_replaced_pixmap`, pixel test against a known-alpha fixture |
| Per-frame contexts erase Obscura's startup/memory advantage | Phase 3.7 | Reuse a prepared snapshot, create a context lazily until script/Window/CDP observability requires it, destroy by generation, and benchmark 0/1/10/100-frame pages for latency and RSS |
| Playwright regression from a frame tree it cannot evaluate into | Phases 3 / 6 | Do not advertise child frames until real main/isolated realms plus all Runtime routing in 6.2-6.4 ship together |
| Frame loads modeled as CORS fetches break cross-origin embeds | Phase 3.1, bootstrap.js:3798 | Navigation semantics via the Rust loader; XFO / `frame-ancestors` as the gate; regression test: a cross-origin frame with no CORS headers loads and renders while `contentDocument` is `null` |
| Self-embedding page loops at the fetch layer | Phase 3.5 | Ancestor-URL check + depth cap in `navigate_frame`, not only at paint |
| Frame content renders unstyled | Phase 3.6, page.rs:812 / :729 | Content-root variant of the stylesheet pipeline; pixel test with an external stylesheet inside the frame |
| Re-navigation leaks roots, scopes, wrappers, contexts | Phases 1.3 / 2.5 / 6.2 | Active registries and contexts shrink immediately; retained old Document stays detached and is collected only after its wrappers become unreachable |
| Isolated worlds silently target the main frame | Phase 6.3, domains/page.rs:1217 | Require a real world context; test that utility-world globals are absent from the frame main world |
| Frame script or dynamic code runs in the top global | Phase 3.7-3.9 | Compile in a real frame context; test global declarations, strict mode, `this`, `globalThis`, direct/indirect eval and string timers across multiple scripts |
| Old navigation commits after a newer `src` | Phases 1.8 / 3.5 | Navigation generation on every async step; slow-A/fast-B deterministic regression test |
| Cross-origin `contentWindow.document` bypass | Phase 2.5 | WindowProxy access checks on every property operation, not only `contentDocument`; adversarial same/cross/opaque-origin tests |
| CDP object handle crosses worlds or survives navigation | Phase 6.2 | Bind object ids to context and document generation; reject cross-world/stale handles and clear them on context destruction |
| Worker facade leaks page globals or reports frame URL | Phase 3.11 | Persistent separate runtime, WorkerLocation from final script URL, structured-clone messaging and creator-origin policy tests |
| One isolate per Worker is too expensive | Phase 3.11 | Start lazily, reuse the startup snapshot, enforce worker count/memory limits with browser-shaped failures, and benchmark creation/message/termination distributions |
| Frame registry leaks on element removal | Phase 0 + 6.4 | Fix `remove_child` first; assert active maps empty after detach and retained detached documents are not render-reachable |
| `StylesheetCache` thrashing between parent and child | Phase 5.2 | Per-root instances; assert cache hit counts in a nested-iframe test |

## Implementation order

Ordered by dependency, with the two de-risking items first:

1. **Realm feasibility gate** — prove that a second Window context can install
   ops/bootstrap, execute a Script with correct globals, wrap one shared DOM
   NodeId and be destroyed without leaking. Also prove a separate Worker
   runtime can exchange structured-clone messages. Do not build a scope-proxy
   fallback if this gate exposes integration work; update the realm host layer.
2. **Phase 0** — `remove_child` owned-subtree fix (independent, small)
3. **Phase 5.1** — render-root parameterization (behavior-preserving, unblocks
   everything in Phase 5 and can land in parallel with Phases 1-2)
4. **Phase 1** — document scopes, typed origins, browsing-context/navigation
   generations, registries and `parse_into_subtree`
5. **Phase 2** — realm-correct Document/Node wrappers, WindowProxy access
   checks, origin-scoped storage/cookies and same-origin APIs
6. **Phase 3.1-3.6** — unified navigation, sandbox/XFO/CSP, redirects,
   sub-resources and load lifecycle
7. **Phase 3.7-3.10** — real Window/isolated realms, classic scripts, dynamic
   code and modules. Keep child-frame discovery disabled until this is complete.
8. **Phase 3.11** — persistent dedicated Worker runtime and messaging
9. **Phase 4** — cross-document `postMessage`
10. **Phase 5.2-5.8** — per-root caches, blit, nesting, print and basic input
11. **Phase 6** — CDP frame projection, real isolated worlds and complete
    Runtime context/object routing

## Verification

Per phase:

- `cargo nextest run --release -p obscura-dom` — Phase 0 removal/cleanup;
  scope-aware traversal and ids; `parse_into_subtree`; tuple and unique opaque
  origins; initial/about:blank/srcdoc inheritance; active-root replacement; an
  externally retained old Document staying detached and usable until release.
- `cargo nextest run --release --features render -p obscura-js` — real realm
  tests must cover two classic scripts sharing top-level `var`, `function`,
  `let` and `const`; `globalThis === window`; top-level `this`; strict-mode
  directives and Script-goal syntax errors; realm-correct constructors and
  `instanceof`; direct eval seeing a local lexical binding; indirect eval and
  `Function` binding to the frame global; string timers and callbacks retaining
  their creation realm; module/static/dynamic import isolation; `currentScript`;
  same-origin DOM access; cross-origin and opaque-origin WindowProxy denials;
  origin-scoped storage/cookies; and stale-realm task cancellation.

  Navigation tests cover synchronous initial `about:blank`, srcdoc precedence,
  dynamic attributes, `location`/link/form entry points, redirect final URL,
  same-document fragments, nested load gating and deterministic slow-A/fast-B
  cancellation. A cross-origin frame with no CORS headers must load and render
  while `contentDocument === null` and `contentWindow.document` throws.

  Worker tests cover constructor URL resolution against the frame base,
  `WorkerLocation.href` equal to the final worker script URL, creator-derived
  origin, persistent globals and handlers, body execution exactly once,
  classic/module loading policy, structured clone and transferable detachment,
  `importScripts`/fetch bases, `terminate()` and a runaway-worker watchdog that
  leaves the page realm usable. Phase 4 tests cover both message directions,
  sender `origin`/`source`, `targetOrigin` and structured cloning.
- `cargo nextest run --release --features paint -p obscura-render` — Phase 5.1
  first passes the existing suite unchanged. New tests cover CSS isolation in
  both directions; child `vh`/`rem` and media queries; semi-transparent blit;
  external CSS/images; fixed/sticky and clipping; nested frames; print/PDF
  media; child scrolling; hit-test coordinate translation and focus routing.
- `cargo nextest run --release --features render -p obscura-cdp` — recursive
  frame tree and lifecycle ordering; child `Page.navigate`; distinct main and
  isolated contexts; preload world selection; `Runtime.evaluate` and
  `callFunctionOn` in the child; `getProperties`/object handles remaining bound
  to their world; rejection of cross-world and post-navigation stale handles;
  context destruction; promise continuations; and input through a nested
  `frameLocator`. Extend `iframe_event_dispatch.rs` and
  `execution_context_pruned_on_navigation.rs`.
- **A real Playwright end-to-end test.** None exists today; the CDP suite only
  references Playwright in comments. Exercise `page.frames()`, nested
  `frameLocator()`, `frame.evaluate()`, element handles/click/type, navigation,
  utility-world isolation and handles invalidated by frame navigation against
  local same-origin and cross-origin fixtures.
- CLI: `obscura fetch <fixture-with-iframe> --screenshot out.png` and
  `--pdf out.pdf` — confirm frame content appears, clipped to the border box.
- Regression gates before completion:
  ```bash
  cargo nextest run --release --features render --no-fail-fast
  CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 cargo build --release -p obscura-cli --bins --features render
  OBSCURA_BIN=./target/release/obscura python3 obstacle-course/run.py --runs 1 --warmup 0
  ```
  The obstacle course remains 33/33. For render changes, run the deterministic
  fixtures and representative top/bottom captures from `AGENTS.md`. Expect
  iframe screenshot baselines and `window.length` / `window[0]` behavior to
  change intentionally.

## Revision notes

These notes are historical. Later revisions supersede architecture described by
earlier entries; the implementation phases above are authoritative.

### First revision (code audit)

What changed against the first draft of this document, after auditing the code:

- **`_loadIframeSrc` is not a dead placeholder.** It exists at
  bootstrap.js:3792 and is reachable. The real defect is the `no-cors` /
  opaque-body handling, which is a security issue rather than a missing feature.
- **`parse_into_subtree`'s deep copy already exists.** `import_children_from`
  (`tree.rs:1397`) and `import_node_from` (`tree.rs:1471`) do iterative
  cross-tree copying with `template_contents` remapping. The draft named
  deep-copy correctness the highest risk in the project; it is not a risk at all.
- **`tree_scope_root` (`tree.rs:426`), `query_selector_from` /
  `query_selector_all_from` (`selector.rs:698`, `:760`) and
  `parse_fragment_with_context` (`tree_sink.rs:375`) already exist.** Those
  Phase 1/2 line items were removed.
- **Phase 5 was rewritten.** Flattening `rendered_children` does not reach the
  style pipeline, which walks `style_children`; and it would have merged the two
  documents' cascades, viewports, scroll trees and stacking contexts. Replaced
  with per-document render roots, which is a smaller change *and* a correct one.
- **Base URLs and origins moved from Phase 4 into Phase 1.** Phase 3 depends on
  them, so the original ordering was inverted.
- **A messaging phase was added.** The draft never mentioned `postMessage`,
  which is how nearly every real embed communicates.
- **Phase 6 gained per-frame execution contexts.** Shipping a frame tree without
  them would regress Playwright rather than improve it.
- **Phase 0 was added** for the pre-existing `remove_child` owned-subtree gap
  that Phase 6.4 would otherwise build on.
- `sandbox`, `X-Frame-Options` / `frame-ancestors`, `srcdoc` and origin
  inheritance were added; storage/cookie partitioning, CDP addressing into
  frames, and frame interactivity were named as explicit non-goals rather than
  left unstated.
- The nesting-depth figure was corrected: Blink's limit is around 100, not 8.

### Second revision (implementation review)

A review spot-verified the code references against the tree (all held; some
line numbers had drifted) and found one contradiction and three gaps:

- **Phase 3.1 contradicted Phase 4.** "Stop accepting opaque responses" would
  have refused any cross-origin frame served without CORS headers — but an
  iframe load is a navigation request that CORS never applies to, and the
  embeds Phase 4 exists for (payments, OAuth, players) are exactly such
  frames. Rewritten as navigation semantics through the Rust loader with
  `X-Frame-Options` / `frame-ancestors` as the gate; the body-in-shared-realm
  concern moved to *Constraints* as inherent to the single-realm architecture.
  The dynamic-`src` JS fetch path was folded into the Rust loader — the
  previous draft kept two divergent loaders that would have applied XFO and
  sandbox checks inconsistently.
- **Frame re-navigation was unspecified.** `iframe.src` reassignment and
  `Page.navigate(frameId)` need a replace path: old-subtree removal, scope and
  wrapper cleanup, WindowProxy identity preservation,
  `executionContextDestroyed`. Added to Phases 1.3, 2.5 and 6.2.
- **The recursion cap was paint-side only.** A self-embedding page would loop
  in `load_iframe_content` before paint ever ran. Moved to the loader:
  ancestor-URL check plus depth cap (Phase 3.5).
- **Frame stylesheets had no loading path.** The stylesheet pipeline
  (`linked_stylesheet_requests`, `page.rs:812`; materialization script,
  `page.rs:729`) queries and installs against the main document only. Added
  Phase 3.6; the following items renumbered 3.6-3.8 → 3.7-3.9.
- **Phase 6's Playwright acceptance had unstated dependencies.**
  `frame.evaluate()` / `frameLocator()` run through `createIsolatedWorld`
  (whose frameId is currently echoed but never routed) and
  `addScriptToEvaluateOnNewDocument` utility-script injection into every
  frame. Both added to Phase 6.2.
- Parent-`load` gating on child frame loads and a test pinning the
  event-bubbling boundary at the frame document were added to Phase 3.5 and
  *Verification*.

### Third revision (scope-fidelity plan)

A follow-up asked whether iframe-internal `eval` and `Worker` behave like a
real browser. Verified against the code: the item 7 wrapper scopes lexical
references only, and four hatches (indirect `eval`, `new Function`, string
timers via `_coerceTimerFn` at bootstrap.js:795-808, and `new Worker` at
bootstrap.js:12428/12474) escape to the top global. The binding is one
`deno_core` `JsRuntime` / single main context (`runtime.rs:2413`). Added
Phase 3.10 with a tiered plan — `Worker` strictly fixed now, `eval`/`Function`
approximated now via a `with`-proxy with a documented gap, full strictness via
a per-content-root `v8::Context` behind the existing `contentWindow` seam —
and threaded it into *Constraints*, *Non-goals*, *Risks* and *Verification*.

### Fourth revision (browser-parity correction)

A further review found that the third revision scoped the problem too narrowly.
`new Function` changes the semantics of ordinary frame scripts before dynamic
code is involved: top-level declarations, global lexical bindings, strict mode,
Script-goal syntax, `this`, `globalThis` and sharing across script elements all
differ. A `with` proxy cannot repair direct eval's lexical environment or strict
mode. Real per-document/per-world V8 contexts are therefore a Phase 3
prerequisite, not a Tier-B follow-on; proxy-based script execution was removed.

The same review corrected four related areas:

- A dedicated Worker shim is not strictly browser-like merely after URL and
  re-execution fixes. The plan now requires a persistent separate runtime,
  WorkerLocation based on the final worker script URL, loading policy, structured
  clone/transfer, task lifetime and independent termination.
- The browser-core model now has stable browsing contexts/WindowProxies plus
  replaceable Document generations and navigation generations. All navigation
  entry points share one controller, and stale async work cannot commit.
- Cross-origin security moved from a `contentDocument` getter check to typed
  tuple/opaque origins and access checks on every WindowProxy operation.
  Origin-sensitive storage, cookies and fetch bases moved into scope.
- CDP context ids now name real V8 contexts. Runtime evaluation, function calls,
  properties, promises and object handles are bound to a frame, world and
  document generation; isolated worlds are real realms rather than labels.

Verification was changed from unsupported `cargo test` commands to focused
release-mode `cargo nextest`, the full render-feature nextest gate, the exact
release build and the 33/33 obstacle course required by `AGENTS.md`.
