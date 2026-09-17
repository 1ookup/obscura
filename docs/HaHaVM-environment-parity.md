# HaHaVM environment parity ledger

This document records the parts of HaHaVM-General that are intentionally not
copied into Obscura. It is a handoff ledger for future browser-surface parity
work, not a promise that every HaHaVM value or implementation is correct.

The comparison uses the sibling checkout at
`../HaHaVM-General` (the absolute path used for the audit was
`/Volumes/ZHITAI/projects/HaHaVM-General`) and the Obscura bootstrap manifest
at [`crates/obscura-js/js/bootstrap.js`](../crates/obscura-js/js/bootstrap.js).
The baseline is the `9004eec` environment-shape audit.

## Audit scope

| Source or surface | Inventory | Obscura counterpart |
| --- | ---: | --- |
| `core/config/env.manifest.json` | 311 manifest entries (312 files on disk; generated `globalThis.js` is outside the manifest) | 238 ordered bootstrap modules |
| `core/tools/envFunc.js` | 1,548 unique `hahavm.envFunc.*` keys; the audit classifier recorded 806 getters, 194 setters, and 548 methods across 112 interface groups | object files, support/behavior files, Rust ops, and realm initialization |
| `core/tools/toolsFunc.js` | dispatch, Proxy/state storage, descriptor/native helpers, resource and hook helpers | WebIDL object files, `WeakMap`/private-symbol slots, Rust-backed DOM/network/render paths, and local native-marking helpers |
| Obscura public surface table | 1,110 interface rows | Chrome/WHATWG shape and behavior, with explicit fail-closed stubs where a backend is absent |

The counts are intentionally kept here so a later audit can detect source
drift before comparing individual properties. To refresh them, inspect the
HaHaVM manifest and count unique assignments matching
`hahavm.envFunc.<name>` in `core/tools/envFunc.js`; do not infer behavior from
the filename alone because keys such as `Performance_getEntriesByType_get`
mix a method name with the historical `_get` suffix.

## Status vocabulary

* **aligned**: the surface is already represented by an Obscura object,
  support module, Rust hook, or an existing Chrome oracle.
* **oracle-fixed**: a concrete shape or behavior difference was reproduced in
  Chrome and fixed in the `9004eec` audit (or an earlier linked change).
* **intentionally-not-ported**: the HaHaVM implementation is a runtime,
  fingerprint value, or site-specific hook that would change Obscura semantics.
* **oracle-needed**: HaHaVM exposes a candidate, but there is not yet enough
  Chrome/standard evidence to choose a value, constructibility rule, or failure
  mode.
* **backend-limited**: the API can have a correct shape, but implementing its
  real behavior requires a browser subsystem that Obscura does not currently
  provide. It must remain honest and fail closed rather than report a fake
  success.

## Runtime mechanisms not directly ported

These are the important differences between HaHaVM's shape/behavior split and
Obscura's implementation. The *responsibility* is retained, but the runtime
mechanism is deliberately different.

| HaHaVM mechanism | Why it is not copied | Obscura replacement |
| --- | --- | --- |
| `toolsFunc.dispatch(self, obj, objName, funcName, args, defaultValue)` (`toolsFunc.js:1025`) | String concatenation and a global lookup on every call lose native receiver identity, make cross-realm branding ambiguous, and add a hot-path dispatch cost. | A method/accessor is installed directly on the correct WebIDL prototype; shared behavior is called through a local support helper or a Rust op. |
| `createProxyObj` and `toolsFunc.proxy` (`toolsFunc.js:646-789`) | A generic Proxy cannot reproduce Rust DOM wrapper identity, live collections, CSP/frame checks, async lifecycle, or native call stacks. It also makes `ownKeys` and descriptor behavior policy-dependent. | Real Rust-backed wrappers, ordinary JS objects where appropriate, and explicit fail-closed stubs. No page-visible Proxy is used as the universal API layer. |
| `memory.symbolData` plus `getProtoArr`/`setProtoArr` (`toolsFunc.js:187-201`) | One mutable global bucket is not a safe substitute for per-object, per-realm state. It would leak state between frames and workers and bypass WebIDL brand checks. | `WeakMap`/private `Symbol` slots, realm-local registries, and Rust DOM arena IDs. |
| `memory.symbolProxy` and `filterProxyProp` | Hiding implementation fields through a Proxy is fragile under `Reflect`, descriptors, `Object.keys`, and cross-realm inspection. | Non-enumerable private state, explicit descriptor installation, and the existing pre-hide/internal-name boundary. |
| `toolsFunc.defineProperty`, `safeFunc`, `setNative`, and the replacement `Function.prototype.toString` | The goal of native-looking descriptors and source text is useful, but replacing the global descriptor pipeline would change V8 identity and snapshot behavior. | Local `_markNative`/descriptor helpers and the pinned native trace/runtime support, used only for the functions that need them. |
| `toolsFunc.hook`/`hookObj`/`hookProto` | Runtime wrapping changes call stacks, `this` checks, exception timing, and function identity. | CDP/preload hooks for diagnostics, direct implementation at the API boundary, and native trace instrumentation outside page-visible objects. |
| `memory.loadResource`, `createContext_run`, and CF-specific hooks | These are host-injection and challenge-solver contracts, not browser semantics. Copying them would couple the engine to HaHaVM's Node/cheerio host. | Obscura's `op_fetch_url`, page/frame loader, request interception, CSP, and CDP preload contracts. |
| HaHaVM `config.js` profiles, font/device/GPU constants, and `cfPatches.js` | Values are tied to a machine, UA, or challenge sample. They are not a portable definition of Chrome and can contradict real layout, transport, or hardware availability. | Fingerprint derivation from one profile input, real layout/network timing where available, and Chrome oracle tests for any value that is intentionally projected. |

The separation that *is* portable is the ownership boundary: a shape file owns
the constructor, prototype chain, descriptors, and public names; a support file
owns shared state, parsing, scheduling, Rust calls, and lifecycle behavior. The
bootstrap remains one classic script assembled in manifest order. Independent
IIFEs or ES modules would break shared lexical bindings, V8 snapshots, and
cross-realm brands.

## Deliberately deferred interface groups

The following groups were present in HaHaVM's object/behavior inventory but did
not have sufficient Chrome evidence for a safe direct port at the end of the
audit. Most currently have a generic Obscura shape or a backend-limited shell;
the listed behavior must not be filled with HaHaVM's fixed values without an
oracle.

| Interface group | HaHaVM behavior keys or area | Current Obscura disposition | What is needed before alignment |
| --- | --- | --- | --- |
| `AudioBufferSourceNode`, `AudioNode`, `AudioParam`, `AudioScheduledSourceNode`, `BaseAudioContext` | graph construction, `connect`, scheduling, parameter getters/setters | `AudioContext`/WebAudio shape and support exist; several node behaviors remain shells | Chrome shape, illegal-invocation, graph lifetime, and audible/rendering oracle |
| `CanvasGradient` | `addColorStop` and gradient state | Canvas renderer owns the real paint path; no separate public gradient behavior parity proof | Chrome 2D state/error/pixel oracle |
| `DevicePosture` | `type`, `onchange` | navigator surface is present where appropriate; event/lifecycle behavior is inert | secure-context and posture-change oracle |
| `DynamicsCompressorNode` | compressor parameter getters | generic WebAudio shape only | Chrome default values, node graph, and parameter mutability oracle |
| `HID` | `onconnect`, `ondisconnect` and device operations | shape/fail-closed surface only | permission, event, and device-availability oracle |
| `MediaSession` | `metadata`, `playbackState`, action handlers | navigator surface exists; no media-session backend | Chrome descriptor and action/lifecycle oracle |
| `NavigatorUAData` | brands/mobile/platform and high-entropy values | profile-derived UA-CH surface is implemented separately | version-pinned Chrome oracle for every requested hint and serialization order |
| `OscillatorNode` | `frequency`, `type` | generic WebAudio shell | Chrome defaults, setters, and render output oracle |
| `Presentation` | `defaultRequest` | shape only | secure-context constructor and request failure oracle |
| `SVGRect` | `x`, `y`, `width`, `height` | geometry objects cover the supported SVG surface; this legacy standalone shape is not independently proven | Chrome constructor/prototype/descriptor oracle |
| `Serial` | connection event properties and port lifecycle | fail-closed navigator surface | permission, event, and no-device behavior oracle |
| `SpeechSynthesis` | queue, voices, pause/resume/cancel, event | shape/support is inert and deterministic | Chrome voice list and queue/event oracle; do not copy host voice names |
| `Summarizer` | `availability` | no backend; constructor surface may be exposed by the window table | Chrome availability and secure-context failure oracle |
| `USB` | connection events and device methods | fail-closed navigator surface | permission, event, and no-device behavior oracle |
| `VirtualKeyboard` advanced behavior | geometry changes and `overlaysContent` mutation | shape and inert zero geometry are aligned; no virtual keyboard backend | Chrome geometry/event oracle under an actual virtual keyboard |
| `WGSLLanguageFeatures` | set-like iteration and feature names | shape is present; feature list is not a hardware claim | Chrome version/platform oracle and WebGPU adapter capability policy |
| `XRSystem` | `isSessionSupported`, `requestSession`, device events | fail-closed shape | secure-context, permission, and no-device rejection oracle |

These rows are a queue, not a list of bugs. A future implementation should add
the relevant Chrome probe and focused regression to the same change. A shape
fix without an oracle is not sufficient, and a backend-limited API must not be
made to report success merely to match a static HaHaVM value.

## HaHaVM entries that are not window globals in Chrome

HaHaVM's manifest is intentionally broader than a Chrome `Window` realm. The
audit found these categories where adding the file solely because it exists in
`core/env` would be incorrect:

* `MemoryInfo` and `WindowProperties` are not exposed as standalone globals by
  the current Chrome window oracle. `performance.memory`/`console.memory` are
  separate surfaces with their own descriptors and were handled independently.
* Lowercase singleton files such as `document__2.js`, `location__2.js`,
  `navigator__2.js`, `history__2.js`, `localStorage.js`, and
  `sessionStorage.js` describe instances, not new constructors. Obscura keeps
  one realm-scoped instance and does not create duplicate global names.
* The generated `globalThis.js` contains a large registration list and host
  shims. It is an assembly artifact, not a reason to duplicate every name in
  Obscura's `surface-finalize.js`; exposure is selected by the Chrome surface
  table and by secure-context/frame policy.

## What was aligned in the audit

The following items were copied only at the *shape/semantic* level after a
Chrome probe, not by importing HaHaVM's runtime:

`TreeWalker`/`NodeIterator` branding and slots; `StyleSheet` to
`CSSStyleSheet` inheritance; `CanvasRenderingContext2D` public prototype and
illegal constructor behavior; branded/stable `MediaDevices`; `ReadableStream`
private state, `locked`, `values`, and async iteration; live branded
`MediaQueryList`; stable branded `BatteryManager`; prototype-owned
`Performance` members; legacy `PerformanceTiming` prototype shape;
`VirtualKeyboard` shape; `HTMLElement.draggable`/`spellcheck` reflection; and
WebGL2 `drawingBufferFormat === 32856`.

The focused shape tests and the `obscura-js` release suite are the regression
gate for these changes. The workspace still has an independent dynamic import
map failure under investigation; it is not evidence that the HaHaVM inventory
should be copied more broadly.

## Follow-up procedure

For each deferred row:

1. Write a minimal main-realm and, when relevant, frame/worker Chrome probe for
   constructor, prototype chain, own keys, descriptors, `toString`, illegal
   receiver, and failure behavior.
2. Decide whether the behavior belongs in an object file, a support module, a
   Rust op, or an explicit fail-closed stub. Keep shared state in the support
   layer and keep manifest order stable.
3. Add the Chrome oracle and an Obscura focused regression before changing a
   value or exposing a new global.
4. Update this ledger from **oracle-needed/backend-limited** to
   **oracle-fixed/aligned**, including the commit and evidence path.

The source inventory remains external by design. This ledger records the
non-portable decisions in-tree, while the exact 311-file and 1,548-key source
lists remain reproducible from the pinned HaHaVM checkout instead of becoming a
second stale copy in Obscura.
