# Test gate ledger

> **已迁移到 Notion**：[Test gate ledger](https://app.notion.com/p/3e9ea41ebc4881eaad16d321e040b5b7) —— 后续维护以 Notion 版本为准；本文件保留作为开发参考。

Full-workspace release gates that were DEFERRED under the scoped-first policy
(AGENTS.md, "Scoped-first test gating"). Each pending entry is backfilled by
one consolidated `cargo v8-test` + the no-default-features check; entries the
run covers are then removed.

## Pending

(none)

## Backfilled

- 2026-09-27: backfill executed at HEAD `38f6f84`,
  `cargo nextest run --release --features render --no-fail-fast --config
  vendor/v8-source.toml` = **2000/2000 passed** (4 skipped), plus
  `cargo check -p obscura-js -p obscura-cli --no-default-features --config
  vendor/v8-source.toml` (clean). Covers every pending entry below this line
  as it stood before this run (the 09-23 through 09-27 batches, whose full
  gates were deferred), the 09-27 `__bootstrap` working-tree batch committed
  as `c606d18`, and two push-driven fixes from today: `eb0c3ce` (render:
  cfg-gate the paint-only timing probes and the retained engine binding --
  the pre-push hook's default-feature render shape had rotted; default
  372/372, paint 609/609 scoped) and `38f6f84` (worker: dispatch the
  stashed in-poll batches before the post-poll drain -- the root cause of
  the "pre-existing" worker ordering flakes: a reply posted between the
  in-poll collect and the post-poll `drain_worker_messages` overtook the
  stashed batch, reordering onmessage; the two flaky round-trip tests now
  pass 20/20 standalone). The push-hook gate re-runs the
  js/browser/cdp/render suites at push time. Obstacle course still
  outstanding (the `obscura-benchmark` companion repo is absent on this
  host).

- 2026-09-27: backfill executed, `cargo nextest run --release --features
  render --no-fail-fast --config vendor/v8-source.toml` = **1996/1996
  passed** (1 leaky, 4 skipped) at HEAD `c9d0b62`, plus `cargo check -p
  obscura-js -p obscura-cli --no-default-features --config
  vendor/v8-source.toml` (passes). Covers the two 2026-09-27 deferred
  entries below (`ee49993`/`30db16b`/`1827851`/`468b490` and `098b72e`) and
  `c9d0b62` (worker async-op settle + digest throughput regression tests).
  Event-loop semantics were probed for that batch; no engine change shipped.
  Obstacle course still outstanding for the covered batches and for
  `c9d0b62`: the `obscura-benchmark` companion repo is absent on this host.
- 2026-09-23: backfill executed 13:58, `cargo nextest run --release
  --features render --no-fail-fast --config vendor/v8-source.toml` =
  **1925/1925 passed** (1 leaky, 4 skipped) at HEAD d4a5352. Ledger clear.
- 2026-09-22: baseline. All code commits through `280cf2b` carried full
  workspace gates inside their batches (latest: 1914/1914 at the batch-41
  fix `f12dee4`; `6ac3488`/`280cf2b` are docs-only). Ledger starts empty.

## Deferred

- 2026-09-27: obstacle course only (full workspace gate covered by the
  backfill above) for `ee49993` `30db16b` `1827851` `468b490`, `098b72e`,
  and `c9d0b62`. The `obscura-benchmark` companion repo is absent on this
  host, so the run has to happen where it is checked out.

- 2026-09-27: `a0626a7`/`ab8cc87` successor (color-emoji zero-advance,
  glyph-less stack) scoped to the same obscura-js shape as below, 735/735
  and the no-default check clean; full gate rides the same backfill.
- 2026-09-27: `ab8cc87` (color-emoji bitmap-strike advance) scoped to
  `cargo nextest run --release --features render -p obscura-js
  --config vendor/v8-source.toml` 735/735 and
  `cargo check -p obscura-js --no-default-features
  --config vendor/v8-source.toml` clean. Full workspace gate deferred to the
  next backfill; obstacle course absent on this host as above.

- 2026-09-28: `ad9d37a` (client-hints delegation) scoped to
  `cargo nextest run --release -p obscura-net --config vendor/v8-source.toml`
  134/134 (`obscura-net` has no `render` feature) and
  `cargo nextest run --release --features render -p obscura-js
  --config vendor/v8-source.toml` 739/739. Full workspace gate deferred to the
  next backfill.

- 2026-09-28: `9f63826` (window interface set) and the CSS namespace batch,
  scoped to `cargo nextest run --release --features render -p obscura-js`
  739/739 and `-p obscura-browser` 139/139, plus `-p obscura-net` 134/134 for
  the client-hints commit. Full workspace gate deferred to the next backfill.

- 2026-09-28: client-hints target-origin gate, scoped to
  `cargo nextest run --release -p obscura-net` 135/135 and
  `cargo nextest run --release --features render -p obscura-browser` 139/139.
  Full workspace gate deferred to the next backfill; the fixture comparisons
  (three local fixtures, both engines) are in the commit message.

- 2026-09-28: parser-script transport and page-path storage-access, scoped to
  `cargo nextest run --release -p obscura-net` 135/135,
  `-p obscura-browser` 139/139 and `-p obscura-js` 739/740 (one animation
  timing test flaked under parallel load, passes alone). Full workspace gate
  deferred to the next backfill.

- 2026-09-28: gsLi5 surface (document/doctype/implementation/featurePolicy),
  scoped to `cargo nextest run --release --features render -p obscura-js`
  739/740 (one animation timing test flakes under parallel load, passes
  alone) and `-p obscura-browser` 139/139. Full workspace gate deferred to
  the next backfill.

- 2026-09-28: worker realm surface (WorkerGlobalScope.prototype member set and
  order, the interface-name sweep, `self.fonts`, the dedicated-scope storage
  constants), scoped to `cargo nextest run --release --features render
  -p obscura-js -p obscura-browser` 880/880. Full workspace gate deferred to
  the next backfill.

- 2026-09-28: font surface (FontFace/FontFaceSet prototypes, instance shapes,
  source status rules, worker FontFaceSet fallback order), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser` 880/880. Full workspace gate deferred to the next
  backfill.

- 2026-09-28: canvas 2D surface (context slots into a WeakMap, internals to
  module scope, Chrome's 74/73 member order and the 28 measured attributes),
  scoped to `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser -p obscura-render` 1489/1489. Full workspace gate deferred
  to the next backfill.

- 2026-09-28: canvas alpha rules and createImageBitmap crop/resize, scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser -p obscura-render` 1489/1489. Full workspace gate deferred
  to the next backfill.

- 2026-09-28: East Asian wide characters measure one em in every family, and a
  long-animation-frame entry's startTime clamps at zero, scoped to
  `cargo nextest run --release --features render -p obscura-render
  -p obscura-js -p obscura-browser` 1489/1489. Full workspace gate deferred to
  the next backfill.

- 2026-09-28: navigator host facts (hardwareConcurrency from the host,
  deviceMemory removed, userAgentData secure-context gated in both realms),
  scoped to `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser -p obscura-render -p obscura-net` 1624/1624. Full
  workspace gate deferred to the next backfill.

- 2026-09-28: storage.estimate usageDetails shape and the quota formula
  comment, scoped to `cargo nextest run --release --features render
  -p obscura-js -p obscura-browser -p obscura-render -p obscura-net`
  1624/1624. Full workspace gate deferred to the next backfill.

- 2026-09-28: per-family font tables generated from the host's fonts (data and
  a pinning test only, no behaviour change yet), scoped to
  `cargo nextest run --release --features render -p obscura-render
  -p obscura-js -p obscura-browser` 1491/1491. Full workspace gate deferred to
  the next backfill.

- 2026-09-28: canvas text metrics answer each family's own font (measured
  tables from the reference browser, per-family advance and pair data, the
  identity-face ligature override, cluster-internal pairs, the LayoutUnit snap
  on element widths), scoped to `cargo nextest run --release --features render
  -p obscura-render -p obscura-js -p obscura-browser -p obscura-net`
  1628/1628. Full workspace gate deferred to the next backfill.

- 2026-09-28: cross-origin isolation follows the container's grant (frame COI
  rule, container permissions policy for `cross-origin-isolated`, the COEP
  embedded-document gate, worker SharedArrayBuffer), scoped to
  `cargo nextest run --release --features render -p obscura-render
  -p obscura-js -p obscura-browser -p obscura-net` 1629/1629, plus the
  two-host isolation fixture against the reference Chrome, 11/11 routes.
  Full workspace gate deferred to the next backfill.

- 2026-09-28: font reference data re-measured from the reference browser's
  current version (Chrome 153), which answers Hiragino Sans with its W3 face
  where 149 answered W4, scoped to `cargo nextest run --release --features
  render -p obscura-render -p obscura-js -p obscura-browser -p obscura-net`
  1629/1629. Full workspace gate deferred to the next backfill.

- 2026-09-28: secure-context gating batch (`654ad05` opaque-origin
  isSecureContext, `081bb49` deviceMemory 16 + gate, `dd5e490` full 253-name
  insecure window gate, `b598962` worker secure-context interface set,
  `17fe980` worker caches onto the prototype, `83107d3` navigator member
  gate, `69189da` tests on a secure origin), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser -p obscura-net --no-fail-fast
  --config vendor/v8-source.toml` = **1016/1016 passed** at HEAD `69189da`.
  Full workspace gate deferred to the next backfill.

- 2026-09-29: host-locale default language (`8fe3e1b`) and the worker
  FontFaceSet.check semantics (`0cbdb03`), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser -p obscura-net --no-fail-fast
  --config vendor/v8-source.toml` = **1017/1017 passed** at HEAD `8fe3e1b`.
  Full workspace gate deferred to the next backfill.

- 2026-09-29: the COI-following clock (`120b792`), the offer without the
  high-profile H264 pair (`84b2216`), the console prototype shell
  (`8524ec0`), the lagging quota accounting (`2496bc9`), the worker event
  methods off the global's own surface (`d43dc89` + `30af415`), and the
  CORP-shaped require-corp embed check (`93ffc4d`), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser -p obscura-net --no-fail-fast
  --config vendor/v8-source.toml` = **1018/1018 passed** at HEAD `30af415`.
  Full workspace gate deferred to the next backfill.

- 2026-09-29: the canvas/render batch behind the Turnstile parity work --
  `a98c186` (CoreText glyph rasterization on by default), `24205bc`
  (off-canvas coverage kept in shadow masks), `9a5e4af` (lineCap in stroke
  geometry), `2e80498` (zero-alpha pixels colourless), `9469888` (stroke
  style sampled for gradient strokeText), `586a772` (CoreText glyphs drawn
  at a single text position) -- scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-render --config vendor/v8-source.toml` = **1365/1365 passed**
  (1 skipped) at HEAD `586a772`. Full workspace gate deferred to the next
  backfill. `a98c186` makes an existing FFI path (CoreText through
  `coretext.rs`) the default rather than changing the boundary itself, so
  the backfill must still cover it; the obstacle course has to run where
  `obscura-benchmark` is checked out, absent on this host as above.

- 2026-09-30: `3a084e6` (`difference` through the module-scope blend table),
  scoped to `cargo nextest run --release --features render -p obscura-js
  -p obscura-render --config vendor/v8-source.toml` = **1365/1365 passed**
  (1 skipped) at HEAD `3a084e6`. Full workspace gate deferred to the next
  backfill.

- 2026-09-30: `0efac30` (intersection MutationObserver wiring guarded for
  frame realms, with a retry from the deferred half), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-render --config vendor/v8-source.toml` = **1365/1365 passed**
  (1 skipped) at HEAD `c90dfdb`. Full workspace gate deferred to the next
  backfill. Bootstrap-surface change only: no feature gate, build config, or
  FFI boundary is touched.

- 2026-09-30: the WebRTC ICE material off the page-visible crypto RNG
  (`webrtc.js` `_rtcRandomHex`/`_rtcRandomBase64`/`_rtcRandomUint` and the
  candidate port now draw from `op_random_bytes`, the same internal op
  `subtle.js` uses; a real Chrome generates these bytes natively so page-side
  `crypto.getRandomValues` stays untouched), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast
  --config vendor/v8-source.toml` = **883/883 passed** at the worktree with the
  new `webrtc_offer_generation_never_touches_the_page_visible_crypto_rng` test
  (wraps `crypto.getRandomValues` and asserts the whole offer/candidate path
  calls it zero times while the SDP shape assertions hold). Full workspace
  gate deferred to the next backfill.

- 2026-09-30: the canvas interface prototype key order fixups (CanvasGradient
  main+offscreen, TextMetrics, ImageData, Path2D relative order,
  MutationObserver minus the leaked `_notify`, and the DOMMatrix prototype
  rebuilt as a clean interface shape), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast
  --config vendor/v8-source.toml` = **884/884 passed** with the new
  `canvas_interface_prototypes_order_keys_like_chrome` test; the live
  bench8 proto-order scan moved from 4/15 to 10/15 interfaces byte-equal to
  the reference Chrome (remaining five are member-set gaps queued as L3).
  Full workspace gate deferred to the next backfill.

- 2026-09-30: the gradient argument validation Chrome answers with
  (addColorStop: missing-arg and non-finite offset as TypeErrors, the
  out-of-range offset as IndexSizeError, unparsable stop colours as
  SyntaxError DOMExceptions through a wide legality grammar covering the
  named-colour table and the hsl()/hwb()/lab() spellings the painter
  approximates; createLinear/RadialGradient: non-finite arguments as
  TypeErrors and negative radii as IndexSizeError, all carrying the
  context's own interface name), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast
  --config vendor/v8-source.toml` = **885/885 passed** with the new
  `canvas_gradient_arguments_throw_like_chrome` test; the live bench9
  exception scan now answers identically to the reference Chrome on all
  sixteen cases. Full workspace gate deferred to the next backfill.

- 2026-09-30: the native-method `prototype` shape (addColorStop, the canvas
  element getContext, performance.now, Object.keys/getOwnPropertyNames and
  Reflect.ownKeys wrappers redefined as method shorthand, which owns no
  `prototype`; a function expression cannot match -- its `prototype` is
  non-configurable, and a Proxy violates the invariant by hiding it),
  scoped to `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast
  --config vendor/v8-source.toml` = **886/886 passed** with the new
  `native_methods_own_no_prototype` test; the live bench11 scan reads
  identically to the reference Chrome on all twenty probes. Full workspace
  gate deferred to the next backfill.

- 2026-09-30: the constructor-message and DOMMatrix stringification shapes
  (ctorMode-0 shells raise the bare 'Illegal constructor' when called
  without new and the long "Failed to construct" form under new, as the
  reference splits them; Performance's constructor takes the long form;
  DOMMatrixReadOnly answers toString with the CSS "matrix(a, b, c, d, e, f)"
  form instead of "[object DOMMatrix]"), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast
  --config vendor/v8-source.toml` = **886/886 passed**; the live bench13
  constructor scan reads identically to the reference Chrome on all
  thirteen cases. Full workspace gate deferred to the next backfill.

- 2026-09-30: the blob URL uuid off the page-visible crypto rng
  (`_blobUrlId` draws its 16 bytes through op_random_bytes, copied into the
  calling realm before the v4 version bits land, because a real browser
  mints the blob URL natively and the live vmcall count read 1 on the
  reference against 4 here -- three blob workers plus the VM's own call),
  scoped to `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast
  --config vendor/v8-source.toml` = **887/887 passed** with the new
  `blob_url_ids_never_touch_the_page_visible_crypto_rng` test (wraps
  crypto.randomUUID, mints a blob URL, asserts zero calls and the uuid-v4
  shape). Full workspace gate deferred to the next backfill.

- 2026-09-30: `c6b8701` (the remaining five prototypes read in Chrome's
  order: Text, HTMLCanvasElement, Performance, Path2D, Uint8Array --
  constructor-tail ordering, the canvas resize coupling moved to the
  Element-layer attribute mutators, transferControlToOffscreen,
  Performance through the shared EventTarget, the full Path2D segment
  recorder, and the ES2025 base64/hex shims), scoped to
  `cargo nextest run --release --features render -p obscura-js
  -p obscura-browser --no-fail-fast --config vendor/v8-source.toml` =
  **888/888 passed** (0 skipped) at HEAD `c6b8701`, with the new
  `interface_prototypes_the_proto_scan_reads_as_chrome` test pinning the
  five own-key orders plus the Text node-minting, resize-coupling,
  transfer-state, EventTarget dispatch and base64/hex round-trip
  behaviours. Full workspace gate deferred to the next backfill.

- 2026-09-30: pump-cancellation split (`crates/obscura-browser/src/page.rs`,
  `crates/obscura-cdp/src/server.rs`) scoped to
  `cargo nextest run --release --features render -p obscura-cdp
  --config vendor/v8-source.toml --lib` (5 server/page pump and screencast
  tests, incl. the new
  `command_wait_cannot_cancel_a_pending_frame_navigation`, red on the old
  combined pump) and
  `cargo nextest run --release --features render -p obscura-browser
  --config vendor/v8-source.toml -E 'test(frame) | test(autonomous) |
  test(pending_navigation)'` 58/58. Exact release build passed and a live
  paired round kept the top DOM (frame blank is the DOM.getDocument
  observation gap, fixed separately). No unsafe/FFI or feature-gate changes.
  Full workspace gate deferred to the next backfill.

- 2026-10-01: the duplicate `#[test]` the `7b0a01d` revert left before
  `frame_window_proxy_methods_read_as_native_code` (one line removed from
  `crates/obscura-js/src/realm.rs`; test-only, no behaviour change), scoped to
  `cargo nextest run --release --features render -p obscura-js
  frame_window_proxy_methods_read_as_native_code
  --config /tmp/obscura-prebuilt-v8.toml` = **1/1 passed** against the
  pinned prebuilt-V8 archive (source build lacks Xcode on this host). Full
  workspace gate deferred to the next backfill.
- b8393a7 (10-02): nav referrer fix; scoped: obscura-js+obscura-browser nextest 889/890 (1 pre-existing fail worker_canvas_subsystem_follows_the_creator_gpu_profile, from efeb16d WebGL pin, unrelated to this change); full gate deferred
- f/u (10-02): initiator fix; scoped: obscura-net nextest 136/136
- media accelerated (10-02): scoped: obscura-js media tests 15/15
- digest probe (10-02): scoped: crypto tests 4/4
- aqgx8 trap (10-02): scoped: crypto tests 4/4
- intl locale (10-02): scoped: build ok
- origin-trial surfaces (10-02): scoped: build ok, live payload carries sharedStorage
- sandbox COI gate (10-02): scoped: obscura-browser 140/140
- navigator modelContext rank (10-02): scoped: navigator tests 11/11; live gsLi5 o-group 122/122 aligned
- IFC 1/64 snap (10-02): scoped: render+browser+js 1517/1517
- geom probe (10-02): scoped: build ok; live capture maps HPcn5[0]
- transform saturation (10-02): scoped: render+browser 767/767; live r40 HPcn5[2] still 33554430 (reads a clamped property, not gBCR)
- map_rect corner saturation (10-02 eve): scoped: render 628/628 (new unit test locks corner-consistency); live r44 gBCR matches Chrome bitwise (x=-3.4e32 w=6.8e32); payload HPcn5[2] still 33554430 (VM-side normalization, under investigation)
- clampBox passthrough (10-02 eve): scoped: render 628/628 (from corner commit); live r47 fo2 -> cf-chl-out + cf-chl-out-s + cf_clearance issued (first full pass with clampBox fix); HPcn5[2] bitwise == Chrome
- clampBox followup (10-02 eve): scoped js 750/750 (one timing-flake passed on rerun), browser 140/140; ov2 rotated 20:04 (md5 3fe2ea87) and the pass reproduced on the new build (r48/r49)
- session batch 10-02/10-03 (22 commits, HEAD 585f7bc): full workspace gate 2042 passed / 0 failed (render+all crates, no-fail-fast); opt-out check (no-default-features) blocked by host CLT-shim env — needs CI or full-Xcode host; live acceptance trail r47-r85 (HPcn5 +39→±9, exception face clean, EvalError+Illegal zero)
- COI CSP token-list fix (10-03): scoped: obscura-browser 141/141, obscura-render 637/637 (1 skipped); Chrome 149 eight-cell COI fixture 8/8 (v1-v5 true, v6-v8 false; was v4-only before the fix)
- ownKeys v4 alignment (10-04): scoped: obscura-js 750/750 (render shape); runtime capture census/plain six-key positions+descriptors match k981
- SDP video section transcription (10-04): scoped: obscura-js 750/750; captured offer matches Chrome ref with session lines normalized
- frame-realm insertion-time materialization (10-04): scoped: obscura-js 750/750; rt-phase same-tick contentWindow read 3.0-6.1ms -> 0.1-0.3ms (zero-read fixture still materializes), first-touch hydration band 16-22ms unchanged
