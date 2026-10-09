# Test gate ledger

> **已迁移到 Notion**：[Test gate ledger](https://app.notion.com/p/3e9ea41ebc4881eaad16d321e040b5b7) —— 后续维护以 Notion 版本为准；本文件保留作为开发参考。

Full-workspace release gates that were DEFERRED under the scoped-first policy
(AGENTS.md, "Scoped-first test gating"). Each pending entry is backfilled by
one consolidated `cargo v8-test` + the no-default-features check; entries the
run covers are then removed.

## Pending

(none)

## Backfilled

- 2026-10-05: backfill executed at HEAD `4d7192e`, `cargo nextest run
  --release --features render --no-fail-fast --config
  vendor/v8-source.toml` = **2049/2051 passed** (2 failed, 4 skipped),
  log `/private/tmp/cf-parity-1002/fullgate_4d7192e.log`. Covers every
  Deferred entry below through the 10-05 latin1 batch (`1b6af20`,
  `90a6596`, `4d7192e`) including the frame-realm chain. Both failures
  are resolved: (1)
  `obscura-js runtime::tests::offscreen_context_interface_owns_its_members`
  still expected the old units-derived 5.590000152587891; `b7f2c2a`
  updates it to the raw 16px table reading chain,
  f32(8.943984985351562 * 10 / 16) = 5.589990615844727 (obscura-js scoped
  750/750 after). The chain start matters: the tables store the raw
  oracle reading, 16 ULP away from f32(559 * 16 / 1000) =
  8.944000244140625. (2) `obscura-cli::mcp_client test_wait_for_selector`
  is a pre-existing load-sensitive timeout flake: idle 9/9 pass at
  3.3-3.7s, 1/2 pass immediately after a full-load run, and the failures
  are the plain five-second window expiring on `Timeout waiting for
  'h1'` (introduced `bce055f`, the `640839f` fixture hardening did not
  fully settle it; this batch touches no navigation or MCP surface).
  Opt-out check (`cargo check -p obscura-js -p obscura-cli
  --no-default-features --config vendor/v8-source.toml`): the
  pre-existing ops.rs render-gate gap, 15 errors, all in `ops.rs`, none
  in the files this batch touched (`inline.rs`, `runtime.rs`, `tools/`);
  same count as the 10-04 entry below. Obstacle course still has to run
  where `obscura-benchmark` is checked out, absent on this host.
  Calibration for the font-table path: the stored tables are 16px
  bit-exact; non-16px sizes can differ from the old units-derived chain
  by up to 1 ulp and the 1/64px quantization absorbs every difference,
  so end-to-end output stays bit-identical. Do not run bitwise
  old-vs-new regression comparisons at non-16px sizes, they will produce
  false positives. The instrumented challenge round's measureText log
  (20 records) shows a single distinct font, '16px sans-serif',
  throughout, so the non-16px band is unreachable from the CF
  measurement channel and the 22.5% non-bit-identical simulation rate
  carries no live risk. Scoped-run lesson: shared table or shared behaviour
  changes must scope the downstream consumer crates too; `1b6af20` ran
  `obscura-render` alone and missed the `obscura-js` expectation, caught
  only in this full gate.

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
- frame-realm tracelog install (10-04): scoped: obscura-js 750/750; live F2-CF round reads layer-2 tracelog from the template-restored frame realm; full-path negative control vs the pre-change binary byte-identical on stdout/op/trace except the accepted +1 hidden global; opt-out lib check still fails on the pre-existing ops.rs render-gate gap (15 errors, none in the touched files); full gate deferred to the next backfill
- frame-realm gate A-prime (10-04): scoped: obscura-js 750/750; _isCfShapedFrame keys on allow-same-origin alone (src condition dropped), so any allow-same-origin sandboxed frame pays at connect; rt-shape five-cell: S3/S4 append 0.10 -> 6.10/2.80ms with the contentWindow read down to 0.10, S1/S2 flat, S5 (no allow-same-origin) negative control flat at 0.10; live F2-CF-2 (obs-a2): four checks pass, sync realm groups 14 -> 16, Blsob5 direct read 2-3 -> 4-5, verdict still 600010; full gate deferred to the next backfill
- frame snapshot-surface flag removal (10-04): scoped: obscura-js 750/750; E1 fixture re-run on the fix binary reads snap boolean -> undefined while every other field deep-equals the head arm (exec/realms/A/C/mo/iframeLoad/events rsc=0/rsAtExec/rsSeen/fe/rounds); full gate deferred to the next backfill
- frame readyState transitions (10-04): scoped: obscura-browser+obscura-js 891/891; frame realms now fire readystatechange at interactive and complete (E1 re-run: events.rsc 0 -> 2, rsAtExec complete -> loading, rsSeen exec:loading/interactive/complete; every other field deep-equals the head arm except the two A/rounds entries the fixture pushes per event); main-document negative control byte-matches Chrome (two rsc, bubbles/cancelable false, document target, zero on window); full gate deferred to the next backfill
- latin1 width tables as raw 16px oracle readings (10-05, 1b6af20): scoped: obscura-render 637/637; five table values bitwise-equal to the stored oracle artifact, latin1 byte-channel measurements unchanged on a dual-engine run; live round judge verdict structurally identical to the pre-commit baseline (600010); full gate deferred to the next backfill
- 49x44 canvas table re-pin to the Chrome 154 read-back (10-05, 94bf044 + c62b1ff): scoped: obscura-js + obscura-render 1387/1387 (1 skipped); the ring probe expectation tracks the new table (pixel (16, 16) R 34 -> 40 and the first edge pixel [255, 34, 255, 15] -> [255, 36, 255, 7], both raw table readings); the a2 experiment ran this exact table with engine XYvy9 [3] == Chrome d60c and all 11 elements aligned; one worker timing-flake (250ms turn timeout) under the full parallel run, standalone 3/3 green; table source is a single 154 read-back round, cross-round constancy rests on indirect evidence; full gate deferred to the next backfill
- performance.now Chrome-154 ring quantization (10-05, c3966d1): scoped: obscura-js 750/750 + obscura-render 637/637 (1 skipped); decode probe six checks green in both realms (chain/ident/OFF table/chain construction/anchor spacing/block sums); live round judge structurally identical to the fix5i-aqrealm baseline (both 600010), jyDXx2 byte-identical at 0.004999999888241291 (the Chrome deficit form did not appear, so that value does not read the non-isolated ring) and the three digest-probe inputs unchanged; two worker timing-flakes under full parallel loads, standalone and third run 750/750; full gate deferred to the next backfill
- performance.now isolated 5us lattice (10-05, c36a50c): scoped: obscura-js 750/750; the isolated smallest step pins bit-exact to 83886*2^-24 (0.004999995231628418) on a 25-slot 0.125 ms lattice (23 narrow + 2 wide steps, the wide pair a 12/13-step gap apart); local COI fixture probe: page and worker both read min == the Chrome 154.0.8037.93 dense-probe value, wide-step fraction 0.079 ~ 2/25, gaps dominate {12,13}, every coalesced sample an exact k*L+m*H sum; live round and second-segment verification pending; full gate deferred to the next backfill
- CSSOM inline advance on the LayoutUnit grid (10-05, 9b1419a): scoped: obscura-render 637/637 (1 skipped) + obscura-js 750/750; the cssom-advance write snaps the shaped advance to the nearest 1/64 (ties away from zero) before adding padding and border, so the 16px Arial Cloudflare probe rect reads 72.9375 like Chrome while canvas stays 72.9296875 and offsetWidth 73; interleaved benchmark on a 5000 inline-block page: e2e p50 0.320 -> 0.322s, cssom-advance block p50 11.61 -> 11.69ms, both inside the +/-10% band; full gate deferred to the next backfill
- negative length snap toward zero (10-05, d928ae2): scoped: obscura-render 637/637 (1 skipped); snap_to_layout_unit floor -> trunc toward zero so negative margins land on the LayoutUnit at or above the authored value (Chrome 154 1x: margin-top:-0.51px -> -0.5 (-32/64), -0.49px -> -0.484375 (-31/64), -350.552px -> -350.546875 (-22435/64), all one 1/64 above floor); the fix6 battery margin items (6-9) drop from a +1/64 residual to zero; the non-negative cases from the original floor measurement (123.4 -> 123.390625, 12.12 -> 12.109375) unchanged; full gate deferred to the next backfill
- system-ui advance tables from the Chrome 154 canvas probe (10-05, f642d7f): scoped: obscura-render 637/637 (1 skipped) + obscura-js 750/750 (one timer flake on the first parallel run, timers_keep_their_deadline_after_an_interrupted_event_loop_poll: the 100ms timer fired at 160.1ms against the +35ms tolerance; standalone green and the no-fail-fast rerun 750/750); both system-ui identity tables regenerate at upem 4096 with integer advances and re-probed kern pairs (bold latin1 filled from empty, both bundled ttf hmtx rewritten to match), and the element advance now ceils onto the 1/64 LayoutUnit grid instead of rounding to nearest (51-point 14px probe: 51/51 ceil, 38 distinguishing; regular 's' element 7.1875 while canvas stays 7.177734375); three-way 164-leaf compare: 39 in-scope = 25 aligned + 14 known low-priority family, 25 residual = 11 pre-existing + 14 of the same family, zero regressions (both WORSE labels are 1/64-level artifacts); t2-spot 16/16 CLEAN against the canvas model and both element references, adsorption laws hold on both sides; full gate deferred to the next backfill
- WebGPU D3D12 adapter feature order (10-05, 516132a): scoped: obscura-js 751/751 (two timer flakes under parallel loads, self_requeueing_animation_frame_yields_to_timer_tasks and intersection_observer_tracks_viewport_threshold_crossings, standalone green, third run 751/751); the intel list replays the reference capture order minus the Apple-only trio (texture-compression-astc-sliced-3d, texture-compression-astc, texture-compression-etc2), residual [] on the subsequence check; runtime probes on the rebuilt binary: apple profile 20/20 reference order, intel override 17/17 target order, negative control null-adapter; full gate deferred to the next backfill
- WebGPU apple feature and WGSL table sizes (10-05, 566de56): scoped: obscura-js 751/751 (one timing flake on the first parallel run, standalone 3/3 green; the adapter consistency test was a real expectation drift, its wgslCount moved 9 -> 13 with the table); the apple profile now replays 21 adapter features and 13 WGSL language features in reference order, residual [] on both positional checks; runtime probes on the rebuilt binary navigate an https page first (an about:blank target never hydrates the deferred surface, so navigator.gpu reads undefined there): apple 21/21 and 13/13, intel override 17/17 and 13/13 (the intel override needs the full gpu object, vendor and renderer are required fields), negative control null adapter; full gate deferred to the next backfill

- reference feature-order drift note (10-05): the two Chrome 154 dec captures
  differ from each other in two adjacent swaps, elem[2] features 21 (13:15
  reads clip-distances,texture-formats-tier2,shader-f16; 228-3 reads
  clip-distances,shader-f16,texture-formats-tier2) and elem[4] WGSL 13 (13:15
  subgroup_id,linear_indexing; 228-3 linear_indexing,subgroup_id), while the
  other seven lDUiR4 elements are byte-equal (node md5 13:15 65ce7f80f392,
  228-3 0a3f8117a1b6); our 21-item set equals both captures and its order is a
  third arrangement, so set alignment stays the working criterion and the
  order itself is a reference-side non-stable quantity

- live order readings without stored samples (10-05): the earlier order
  comparisons also cite two live Chrome machines (9712 tail sf16,tier2,clip;
  9273 tail tier2,clip,sf16) that exist only as session reports, no stored
  capture artifact, so they are ledger context and not independent samples;
  the two dec files above remain the replayable references

- rehang three-profile probe runbook (10-05): scripts in
  /private/tmp/cf-parity-1002/ (run-rehang.sh starts all three). Profiles:
  obscura serve --port 9522 --stealth --storage-dir /tmp/obs-storage-rehang-a
  (apple); --port 9524 --stealth --storage-dir /tmp/obs-storage-rehang-i with
  OBSCURA_FINGERPRINT_JSON carrying the full gpu object (vendor and renderer
  required, else the whole override is silently dropped) (intel); --port 9526
  --storage-dir /tmp/obs-storage-rehang-n without --stealth (null control).
  Probe per port: uv run --no-project --with websockets python
  cdp_eval_fix4.py PORT expr-gpu-kick.js expr-gpu-read.js https://example.com,
  then uv run python probe-check.py. The probe must Page.navigate to an https
  page first (about:blank never hydrates the deferred surface), and a freshly
  built binary cold-exec can exceed the 3s startup wait, poll /json/version
  before the first probe

- WebGPU apple limits maxImmediateSize sync (10-05, 03a546f): _GPU_APPLE.limits
  gains maxImmediateSize 64 at position 33 (37 -> 38 keys, one insertion);
  scoped: obscura-js 751/751 on the third run. The first parallel run carried
  one real expectation drift on top of four timer flakes: the tier test still
  pinned the old single-tier maxImmediateSize (adapter None, device 64), so
  both tiers now sit in the ADAPTER_VERSUS_DEVICE_LIMITS pair table as 64/64
  and the stale single-field assertions are gone; the four flakes (posted
  task timer floor, image lifecycle cors, intersection observer clip, timing
  edits pause) were standalone green, and a second run left one throughput
  flake, also standalone green. Oracle checks against the lDUiR4 node of dec
  13:15: names 38/38 positional-diffs 0, values 38/38 value-diffs 0. Rebuilt
  binary probes on all three profiles: apple maxImmediateSize present with
  value 64 and maxSubgroupSize still null, intel reads 64 from the
  pre-existing _GPU_LIMITS row, null control still has no adapter;
  probe-check all green. Full gate deferred to the next backfill

- img.width returns the rendered content-box width (10-05, 10aca8f): scoped:
  obscura-js 751/751 plus obscura image_shim 5/5. The two worker-filtered
  sweeps before the full run each left one digest single-fail
  (worker_dense_digest_loop_keeps_its_throughput, a throughput threshold
  test reading 11057 per 100ms against the 63000-66000 normal band,
  standalone reruns 2/2 green) under load 28.68/70.27/44.08 on a 6-core
  host = load jitter; the full sweep at load 3.10 ran 751/751 zero
  failures. The image_shim red was a disk-full stub: the 16:29 ENOSPC link
  left a 2240-byte non-executable unit-hash stub (plus its .d) that nextest
  still selected and failed EACCES on, fixed by deleting the stub pair plus
  two stale test bins (~213M) and relinking (101.7MB), then 5/5. Probe
  triple check: A) fix4 -> fix5 full-field diff changes exactly one value,
  H.bw 500 -> 250; B) fix5 vs the Chrome image row bw/bh/csw/csh
  value-equal, only the four pre-existing E/F/G/H_o csw 1280-vs-1185
  viewport artifacts left (unrelated to the image IDL); C) fix4 vs Chrome
  carried exactly those 5 mismatches, fix5 removes the target one with
  zero new; height side untouched. Full gate deferred to the next backfill

- stealth identity sync to the Chrome 154 reference (10-05, bd9737f): scoped:
  obscura-js + obscura-cdp + obscura-browser 1074/1074 (3 skipped,
  --no-fail-fast); the default identity moves to Chrome/154.0.0.0 with
  fullVersionList 154.0.8037.93 and the Chromium-first brands order carrying
  the "Not A(Brand";v="99" grease, and navigator.languages gains the
  base-language fallback (["zh-CN","zh"]) the Accept-Language header already
  serialized; one real expectation drift in obscura-js (the
  fingerprint_language realm test pinned the old one-entry list), everything
  else green; acceptance on the gold-config round: the decrypted widget
  payload byte-equal to the reference Chrome capture (Yyepi7 UA-CH triple,
  PlZqY9 languages) and the sec-ch-ua header byte-equal on both the
  navigation GET and the fo POST; full gate deferred to the next backfill

- navigator.cpuPerformance restored as the constant 3 (10-05, 69b4d28):
  scoped: obscura-js 751/751; the Step 300 removal read a Chrome 151 renderer
  trace as absent, but a live Chrome 154 direct read answers typeof=number,
  `in`=true, value=3 in the top document and in a cross-origin frame alike,
  and the reference dec bucket carries n.cpuPerformance in its '3' slot; the
  navigator getter returns the constant 3 with no SecureContext gate, and the
  flipped test pins number/true/3 in both the main and the frame realm; full
  gate deferred to the next backfill

- realm key tables realigned to the Chrome 154 census (10-05):
  scoped: obscura-js 751/751; _chromeWindowKeyOrder,
  _chromeDocumentKeyOrder, _chromeScreenKeyOrder and
  _chromeScreenOrientationKeyOrder were regenerated from a fresh
  frame/top census of the local Chrome 154 (window 1236 entries
  including the ten removed invented tokens and eleven added 154 names,
  document 250, screen 16, orientation 10), the difflib against the
  census now reads zero order edits in all four tables, and the stale
  screen.orientation order assertion flipped to angle-first; full gate
  deferred to the next backfill

- Chrome 154 surface realignment (10-05): scoped: obscura-js 751/751;
  the WebMCP/SharedStorage family (ten names) is removed from every realm
  (the storage and agent installers return early, the origin-gated extras
  block is gone, the surface and navigator-order lists drop their entries),
  and the eleven 154 names (PermissionsPolicy, FontFaceSet, XSLTProcessor,
  the camera/microphone element pair, NodeRange/OpaqueRange, the paint
  timeline entries, window.requestResize) join the surface as
  native-shaped stubs; the stale non-isolated hidden-name gate is emptied
  (Chrome 154 carries the four on a plain localhost page) with the worker
  scope strip extended instead; the census, persona, webidl and screen
  orientation tests flip to the 154 answers; full gate deferred to the
  next backfill

- document.requestStorageAccessFor removed (10-05): scoped: obscura-js
  750/751 with the known load-jitter digest flake (worker_dense_digest_loop
  passes in isolation, 0.42s); the live Chrome 154 probe answers
  `in document` false in the top document and in a cross-origin frame while
  requestStorageAccess and hasStorageAccess both answer true, so the name
  leaves the Document prototype and its behavior test pins the absence;
  full gate deferred to the next backfill

- all six high-entropy client hints pinned in the scripted fetch test
  (10-06, 8ee8b3d): test-only, no behaviour change; scoped:
  cargo nextest run --release -p obscura-net --config vendor/v8-source.toml =
  137/137 (obscura-net carries no render feature, stealth rides default); the
  new scripted_accept_ch_sends_all_six_high_entropy_hints seeds the accepted
  set with the full nine names and asserts each of the six high-entropy hints
  is sent exactly once; full gate deferred to the next backfill

- revert the Oct-5 Chrome 154 alignment to the Chromium 149 baseline and pin
  the baseline host geometry (10-06): the live baseline browser is the local
  Chromium 149.0.7827.0 (profile step 358), so the 154 identity sync
  (bd9737f), both realm census realignments (a6cbb36, 520fe3a), the
  requestStorageAccessFor drop (eedbd38) and the cpuPerformance restore
  (69b4d28) are content-reverted; the SharedStorage/ModelContext/WebMCPEvent
  family and document.requestStorageAccessFor return, the eleven 154 stubs
  (PermissionsPolicy, FontFaceSet, XSLTProcessor, the camera/microphone pair,
  NodeRange/OpaqueRange, the paint entries, requestResize) leave, and
  navigator.languages returns to the single authored entry (the live 149
  payload reads n.language and n.languages into the bare zh-CN bucket
  alike). New, not a revert: the default macOS screen identity becomes the
  baseline host's desktop measured from the passing-round gsLi5 reverse
  table (1720x1260, avail 1720x1140 top 30, DPR 1 so colorDepth/pixelDepth
  derive to 24, windowed outer 1720x1119 at screenY 51); the resize-observer
  device-box fixture pins DPR 2 explicitly so its conversion assertion keeps
  its discriminating power. Scoped: obscura-net 137/137, obscura-js 751/751
  (--features render); a7254de (low-entropy header order) and 8ee8b3d
  (six-hint emission test, value-free) stay; the milestone-table brands(154)
  rows predate this batch and stay. Full gate deferred to the next backfill

- unbranded two-entry brand lists (10-06): the baseline browser is an
  unbranded Chromium build, whose wire carries the two-entry grease pair
  (149 -> `{Chromium, Not)A;Brand}` v24, Chromium first) instead of the
  three-entry Google Chrome set; the derivation drops the UA-based branded
  guess (UA cannot distinguish a Chromium build) so every platform derives
  the unbranded shape and a Google Chrome persona is a brands override.
  Scoped: obscura-net 137/137, obscura-js 751/751 (--features render);
  the branded permutation oracle stays as a direct chromium_brands(153,
  true) call. Full gate deferred to the next backfill

- WebGPU tables re-pinned to the live 149 baseline and the utterance gains
  its event face (10-06): the apple adapter limits and the default limits
  drop maxImmediateSize (37 entries on the live payload, the slot between
  maxInterStageShaderVariables and maxColorAttachments is newer-build
  only), the adapter features return to the captured 20-name order with no
  subgroup-size-control, and the WGSL language list drops
  immediate_address_space/swizzle_assignment/buffer_view/texture_formats_
  tier1 (nine names, captured order); SpeechSynthesisUtterance extends
  EventTarget with the Blink handler set and the real defaults (voice null,
  lang "") -- `u instanceof EventTarget` was false on the engine against a
  true on the reference, the strongest remaining sAMar8 candidate. Scoped:
  obscura-js 751/751 (--features render). Full gate deferred to the next
  backfill

- navigator secure-context gate: 14 more members (10-06): the insecure
  prototype answered 57 names against the reference's 36; the gate had
  covered 27 members and missed 14 [SecureContext] ones -- modelContext,
  windowControlsOverlay, clearAppBadge/setAppBadge, requestMIDIAccess,
  getInstalledRelatedApps (gate-removed rather than physically deleted:
  the insecure about:blank fixture cannot tell "removed in 149" from
  "secure-gated", and a https-side check or a Chromium removal version is
  needed for the physical cut) and the eight interest-group/FLEDGE
  methods. Engine now answers 43; the seven-name residue
  (doNotTrack/scheduling/userActivation/webkitTemporaryStorage/
  webkitPersistentStorage/requestMediaKeySystemAccess candidates) needs
  the reference's full 36-name list before it can be aligned without
  guessing. Scoped: obscura-js 752/752 (--features render, one new gate
  probe test). Full gate deferred to the next backfill

- userAgentData regression report investigated, no engine fault found
  (10-06): the report claimed navigator.userAgentData went undefined after
  1fe592a/b5253f1 on an about:blank fixture and that the round-5 payload's
  Yyepi7 bucket lost brands/fullVersionList. Both halves check out the
  other way: NavigatorUAData is [SecureContext], so an opaque/http origin
  answers undefined the way Chrome does (the gate's insecure behavior,
  present since before this batch -- measured 149), and the round-5
  payload's Yyepi7 carries both lists in the new two-entry shape
  (brands {Chromium,149}/{Not)A;Brand,24}, fullVersionList
  {Chromium,149.0.7827.0}/{Not)A;Brand,24.0.0.0}). Two regression tests
  added: the secure/insecure userAgentData pair, and a statement-level
  replay of the uach_probe.js fixture on the challenge origin (two-entry
  lists through getHighEntropyValues). Scoped: obscura-js 754/754
  (--features render). Full gate deferred to the next backfill

- hidden documents fire no animation frames (10-06): the engine pumped
  requestAnimationFrame at a fixed 16ms in every document, and
  document.hidden/visibilityState were hardcoded false/visible even for a
  frame whose host iframe has no rendering box -- where the live 149
  payload reads the challenge widget's document as hidden and the
  reference browser fires no rAF callbacks at all, which is exactly the
  oHIQ6 family's shape (71 paired readings at a 16ms cadence here, empty
  on every reference round). A frame now derives its visibility slot from
  the same layout answer innerWidth already uses (rendered=false ->
  hidden), the getters read the slot, and the rAF pump holds its pending
  callbacks while hidden, re-arming on visibilitychange. Rendered frames
  and top-level documents stay visible; Pdbt7's Lcfc8 count was checked
  against this first -- performance.measure buffers correctly, so that
  count is challenge-call-volume, not a dropped-entry bug. Scoped:
  obscura-js 755/755 (--features render, one new two-frame probe test).
  Full gate deferred to the next backfill

- utterance members move to the prototype (10-06): the fixture measured
  prototype own names 1 vs 14 against the reference. The members had been
  installed as per-instance data properties; WebIDL ships them as
  prototype accessors -- the prototype now carries the six attributes and
  seven Blink handlers over one per-instance symbol slot (14 names with
  the constructor, constructor-first), an instance answers no own
  string-keyed names, and accessors convert on write (handler set to a
  non-function stays null). The voices list is deliberately untouched:
  the passing-round payloads read mZLmS3 as the same 32-name list on both
  sides, so an empty-array alignment would move a matched key; the
  fixture's empty getVoices is an environment reading (voices load
  asynchronously from the system TTS service) and needs a ruling on which
  browser state the verdict compares before the table changes. Scoped:
  obscura-js 756/756 (--features render, one new shape test). Full gate
  deferred to the next backfill

- hidden-frame timers run at the background minimum (10-06): the rAF hold
  of the previous entry did not reach the oHIQ6 heartbeat -- the round-7
  readings are byte-identical across rounds (517,518,652,... on r2/r6/r7),
  which rules out a live clock entirely, and a per-source matrix in a
  display:none frame showed rAF at 0 but a 16ms interval at full cadence
  (23 ticks in a 370ms window) with a nested chain right behind it. The
  missing piece is Chromium's background timer throttling
  (kBackgroundTimerMinimumInterval 1000ms for a hidden frame's timers):
  setTimeout and every interval re-schedule now clamp to that minimum
  while the document is hidden, re-evaluated per (re)schedule. The same
  matrix after the clamp reads interval 1, chain 0, raf 0 -- matching the
  reference shape (IGBuA2 sparse at ~1s, oHIQ6 empty because a
  adjacent-sample-difference collector never sees a small gap). Scoped:
  obscura-js 757/757 (--features render, the matrix pinned as a test).
  Full gate deferred to the next backfill

- SVG text measurement path pinned in the reference cost band (10-06):
  fixture timing on the current engine reads a 16ms first pass over 23
  SVG text elements (2.9-4.2ms one-time layout warm-up on the first
  element, 0.5-1.1ms steady state per element -- inside the reference's
  0.35-1.5ms band) and a same-parameter repeat pass at 1.1-1.3ms total
  (~15x under the first pass, sub-millisecond per element), so the
  geometry heat path already holds and no caching change was needed; the
  3-6.6ms-per-element fixture reading was taken on an earlier binary.
  The timing probe is pinned as a regression test asserted as a ratio
  (repeat under a quarter of the first pass) plus a catastrophic
  per-element bound, because absolute milliseconds move with parallel
  test load. Scoped: obscura-js 759/759 (--features render). Full gate
  deferred to the next backfill

- OjmeV1[118] diagnosis hook landed (10-06): OBSCURA_DEBUG_TOSTRING arms
  (runtime run_page_init for the main realm, frame hydration injection for
  every frame realm) a wrap of Object.prototype.toString that reports any
  page object stringifying to the default "[object Object]" tag --
  constructor name, own keys, caller stack -- through console.warn into
  the trace-op channel, deduplicated by stack head and capped at 300.
  First live round hit: the mystery object is ctor=Object keys=[] (a bare
  empty instance), produced inside the widget runner's mQ.Gp/mQ.my
  methods; the stack offsets move per session with the runner's rch path
  segment. The runner source itself needs a response-body capture on the
  script load path (diag_capture covers only scripted /fo/ fetches) or a
  verdict-round body dump to read the String(X) expression. Scoped:
  obscura-js 759/759 (--features render, arm is env-gated and inert when
  unset). Full gate deferred to the next backfill

- supportedEntryTypes back to the 149 thirteen (10-06, verifier offline
  cross-check vfix-pA-perf.json): our 15 carried the 10-05 154-only pair --
  interaction-contentful-paint and soft-navigation -- which the 149
  reference does not publish. Both leave the supported list, their
  interface rows (InteractionContentfulPaint,
  PerformanceSoftNavigation) and member shims leave the surface, and the
  non-isolated hidden-name gate drops the two entries (nothing left to
  hide). N-bucket our-only residue of both names goes with them.
  Recorded, not fixed here: Pdbt7's Lcfc8 family reads as
  long-animation-frame entries (reference top document 1 LoAF, ours 2,
  with navigation 1484ms vs 344ms) -- engine-speed class, tracked
  separately.

- toString-diag frame regression fixed (10-06): the previous batch's
  frame-realm wrap rode the hydration injection unconditionally, and its
  guard flip (from the arm-flag check to the __obscuraDiag mark) made the
  wrap install on every frame hydration even with the diagnosis unset --
  frame_environment_uses_its_url_origin_cookies_and_storage_area and
  frame_blob_worker_eval_fetch_empty_hits_frame_origin failed on it (the
  wrap raced the post-hydration surface restore). The wrap now installs
  only from realm_init_src() -- the REALM_INIT common point all three
  frame creation paths execute -- under the env condition, and the
  hydration injection carries the arm flag only. Both frame tests pass
  again. Scoped: obscura-js 759/759 (--features render). Full gate
  deferred to the next backfill

- LoAF recorder verified healthy at 7/7 (10-06): the Pdbt7 frame count
  (widget LoAF 7 on the reference vs 2 here) was suspected to be the
  recorder dropping consecutive entries through the overlap guard. A
  seven-blocking-task probe in a hidden frame records exactly seven
  entries (now pinned as a regression test with load-tolerant bounds --
  count >= 5, monotonic starts, durations at/over threshold), so the
  recording side is healthy and the live count difference is the
  challenge's own task durations on the engine (speed class, already
  tracked separately). Round-24 note: oHIQ6's shape changed with the
  hidden-frame holds -- 243 readings at a 16ms cadence (11 -> 2795, the
  main document's visible rAF, whose firing is correct behavior), IGBuA2
  unchanged at the same 7 values, bLvQ6 gained a single [1043]. The
  family remains a challenge-flow-branch reading; the engine has no
  wrong behavior to fix on it. Scoped: obscura-js 760/760 (--features
  render). Full gate deferred to the next backfill

- sAMar8 candidates fixed (10-06, speech-family fixture on both sides of
  the https page): `'onvoiceschanged' in SpeechSynthesis.prototype`
  answered false against the reference's true -- the handler accessor now
  installs on the interface prototype (in webidl-branding's late
  compensation pass, because the media module that owns speechSynthesis
  runs before the interface shells exist; the handler slot stays
  non-enumerable so instances carry no own key), and
  SpeechSynthesisUtterance.length answers 0 (the constructor reads
  arguments[0]; Chrome's optional DOMString text carries no required
  argument). The synth instance's own onvoiceschanged data property is
  gone with it. Scoped: obscura-js 760/760 (--features render, the
  utterance shape test extended with the ctor length and the handler
  accessor assertions). Full gate deferred to the next backfill

- Speech voice table extended 32 to 68 (10-06, reference host Chrome 149
  getVoices() dump, names/langs/order/flags per row): the challenge payload's
  BKkj0/zXuvs9 pair reads speechSynthesis.getVoices().length (reference 68,
  ours 32), and the sorted-name list it also reports is the first 32 names of
  the same table, so the count itself is a consumed fingerprint field. The
  old 32-row table also carried five languages shifted between rows (Alva
  sv-SE not pt-BR, Amira ms-MY not ar-001, Daria bg-BG not sv-SE, Geeta
  te-IN not en-IN, Lana hr-HR not ru-RU); the full table now replicates the
  measured dump (68 rows, all localService, Tingting default, reference
  order, so the sorted first-32 slice is byte-identical to before). Note:
  `say -v '?'` lists 72 on this host; Chrome exposes 68 (the
  AVSpeechSynthesisVoice set) and the table replicates Chrome's dump, not
  say's. Fixture on the https page: our engine now answers 68 (was 32).
  Scoped: obscura-js 761/761 (--features render, new
  voice_table_matches_the_reference_host_dump pins count 68, the head and
  tail rows, all-local, and the single default). Full gate deferred to the
  next backfill

- performance.eventCounts.size/get/has landed (10-06 evening): the
  PerformanceEventCounts view was an empty frozen object, so .size answered
  undefined and the first-report field serialized away (the reference's
  first 47-key report carries size=36; ours carried nothing). The dispatch
  choke point (_eventTargetDispatchNow) now keeps a type ledger for
  Node/document/window targets only, and the view answers live size/get/has
  off that ledger through _markNative-wrapped members (the premark surface
  census rejects unmarked mint-site functions). Counts are flow-dependent
  truth, not a pinned 36: the bare-interstitial fixture answers 5. Scoped:
  obscura-js 762/762 (--features render, new
  event_counts_tracks_document_dispatched_event_types pins size growth,
  per-type counts, bare-EventTarget exclusion, and the [object EventCounts]
  tag). Full gate deferred to the next backfill

- frame visibility goes live (10-06, solo): the frame-realm init snapshot froze document.visibilityState at the pre-layout moment (op_layout_metrics answers rendered:false while the main prepared render is not built, per the code comment), so a widget that gains its host box after realm init stayed hidden forever and every timer schedule clamped to the background minimum. The getters now re-derive per read through the epoch-cached frame-metrics reader (__obscuraDocumentVisibility, added to the internal-names list); the snapshot stays as the fallback. Live-verified with a vis probe round: the widget answers hidden/iw0 for ~200ms then visible/iw300 for the rest of the run and a 100ms probe interval runs at full cadence. display:none frames keep the hidden+clamped shape (heartbeat test still pins it); a new regression test pins the flip. Scoped: obscura-js 763/763. NOTE the init window did NOT shrink (chl_page->fo#1 still ~6.0s): the +2s block attributed to clamped boot stages in step 368.1 has another source -- attribution reopened. Full gate deferred to the next backfill

- DCL must not wait for child frames: failing-acceptance test pinned (10-07, solo): Chrome fires DOMContentLoaded (87ms) and first-paint (128ms) while a 2s child iframe is still loading (measured on Chromium 149 with the exact local fixture); only the load event waits. The engine awaits each child frame navigation inline during main-document setup (load_child_frames -> navigate_frame(...).await), so DCL and first paint inherit the slowest subframe -- measured 2268.5ms in the new ignored test dom_content_loaded_does_not_wait_for_a_slow_child_frame. On the Cloudflare interstitial this is the +1-2s init-window source (the widget-visibility flip lands seconds late and every boot timer rides the background clamp), i.e. the reopened +2s attribution from step 368/369 is now THIS bug. Fix shape: move child-frame loads off the parent DCL/paint critical path (async progress instead of inline await in load_child_frames). Scoped: obscura-browser 141/141 green (test is #[ignore] until the fix lands).

- page-owned WebSockets survive client disconnect (10-07, solo): root cause of the "silent socket death" was connection-scoped page lifetime — run_connection aborted cdp_processor the moment handle_connection_ws returned, destroying pages, sockets, and the runtime with them; a second defect was the pump's full turn parking inside deno_core forever on a live recv with nobody left to cancel it, so a parked page could neither observe park TTL/shutdown nor deliver late frames. Fix: rx-closed now parks the connection while a page has live JS (OBSCURA_SERVE_PAGE_PARK_SECS, default 600, 0=until shutdown); park arms the page's V8 watchdog with the TTL so expiry terminates the isolate and returns the turn for clean teardown (close_all_websockets sends close frames, peers see 1001 not 1006); a page-activity notify (ops.rs) re-arms the pump so WS frames reach JS while parked. Semantics test page_runtime_advances_while_cdp_client_is_silent updated to the new contract (park while live, shutdown still exits). Pre-existing on this branch, unrelated: input_mouse_event_parity::mouse_events_enter_iframe_realm_with_local_client_coordinates fails on the clean tree too (stash-arbitrated), and obscura-js --no-default-features does not compile (16 render-gate errors on the clean tree). Scoped: obscura-js 946/946 incl. new websocket_frame_wakes_parked_owner_and_delivers_to_js, obscura-cdp green except the pre-existing mouse failure, obscura-browser 141/141. End-to-end verified: driver exits, bridge --send dispatch lands on the parked page minutes later, payloadJSON lands in the tracelog. Full gate deferred to the next backfill

- background timer clamp keys on page visibility, not frame visibility (10-08, timerfix1): the 3d92bc1 clamp read the frame document's visibilityState, so every timer under 1000ms in a display:none or 0x0 iframe of a VISIBLE page ran at the 1s background minimum -- exactly the ddiv1 divergence (Chromium entered the widget's 550ms `bound Xb` beat first; obscura trailed one round, +4.6% total steps). Chromium 149 measured: setTimeout(550) in a display:none cross-origin iframe of a visible page fires at ~556ms with a 16ms interval at ~245 ticks/4s, and document.visibilityState there is the page's 'visible' (same-origin display:none and visibility:hidden iframes too). kBackgroundTimerMinimumInterval is a page-level decision; the clamp now reads a new op_page_hidden (ObscuraState.page_hidden, embedder-flippable via op_set_page_hidden), and the top-level document.visibilityState shares that source through a new install in page-init; a hidden page still hides every frame document and clamps every frame's timers. The 3d92bc1 heartbeat test is replaced by two: visible_page_hidden_frame_timers_keep_authored_cadence (550ms fires in-window, interval >=5/900ms, raf still 0) and hidden_page_clamps_timers_to_the_background_minimum (550 does not clear a 400ms window, interval ticks once, visibilityState hidden on top and frame, authored cadence resumes after flip). Live CDP probe before/after on the same fixture: hidf 1000.5ms -> 551.2ms, 16ms interval 4 -> 228 ticks; main 550.6 -> 550.9ms; Chromium reference 556.3ms/244. Frame visibilityState itself is left per-frame (rAF hold stays layout-keyed); NOTE modern Chromium reports a nested document's visibilityState as the page's -- surface question flagged, unchanged here. Harness round timerfix1: render ok -> error-callback 600010, same terminal as the documented obscura base state (the ddiv1 fork stays server-side past layer 1). Scoped: obscura-js 765/765 (--features render). Full gate deferred to the next backfill

- frame window ownKeys drop the EventTarget surface (10-08, wk3): the frame-realm branch of _normalizeWindowObjectEnumerability re-minted addEventListener/dispatchEvent/removeEventListener/when as own enumerable window properties after finalize had moved the three to Window.prototype (when rides EventTarget.prototype) -- 1287 vs Chrome 1283 own keys, the exact surface the challenge's ownKeys reflection (gsLi5 input) carried. Chromium 149 ground truth: an iframe contentWindow has fourOwn=[] and all four resolve through the prototype chain. Mint (born 10a8009 "align iframe payload enumeration with Chrome") removed; the enumerability normalization for page-assigned own names stays. New test frame_window_ownkeys_carry_no_eventtarget_surface pins both realms. wk3 live census: 1283/1284, key set AND order equal to chrome-wk2, no only-obscura keys; the mid-run PmusQ9 addition is symmetric across both engines (challenge session global, not engine leakage). Harness terminal unchanged: render ok -> error-callback 600010 (documented obscura base state). Scoped: obscura-js 766/766 (--features render). Full gate deferred to the next backfill

- about:blank/srcdoc frames report their spec Location (10-08, B1): the 2026-09-17 creator-URL answer (location.href = the embedding document's URL for inherited-origin about:blank/srcdoc frames) is contradicted by Chromium 149 measured (href about:blank/about:srcdoc, location.origin "null", protocol "about:", host "", pathname blank/srcdoc, ancestorOrigins = the ancestor origin chain, window.origin still inherited) and is exactly what the challenge's window enumerator sampled (callret valuediff B1). The deliberate branches are gone from _environmentSettings; relative-URL resolution keeps the creator base via the untouched baseUrl slot. ancestorOrigins: the WindowProxy facade's location gained the member (it had none -- the empty {} the collector saw on pre-realm frame probes), the walker takes an explicit root and falls back to the document URL's origin when the scope origin is unset, and page-init rebinds the hydrated realm's ancestorOrigins getter with the live captured root (template-restored realms resolve the lexical globalThis to the snapshot-era global -- stale nid; full fix needs a realm.rs identity hook on the internalNamespace pattern, left as a marked #[ignore] in-realm test). Scoped: obscura-js 766/766 (--features render, 1 skipped). Full gate deferred to the next backfill

- window placement fingerprint screenX 22 / screenY 52 (10-08, B2): the callret valuediff's "depth-bucket" groups are window-property VALUE groups, not prototype depths (bucket 0 = the zero-valued props incl. the 0x0 widget frame's innerWidth, 22 = the window origin x, 52 = y, 1 = devicePixelRatio/PERSISTENT). Chrome answers window.screenX/screenLeft 22 and screenY/screenTop 52 in every captured round (10-06..10-08, ~15 traces); obscura answered the stale 10-06 fingerprint reading 0/51. The default macOS ScreenFingerprint placement is updated to 22/52 (fingerprint.rs + its default-identity test); engine code untouched -- page-init already prefers the configured screen_x/screen_y. Live probe: 22/22/52/52, outer 1720x1119, availTop 30, availLeft 0. Scoped: obscura-js 766/766 + obscura-net 137/137 (--features render, 1 skipped). Full gate deferred to the next backfill

- WebGPU objects JSON to an empty own surface (10-08, B3): GPUShaderModule carried label and the full WGSL source as own enumerable properties, so createRenderPipeline's descriptor serialized the shader source into the challenge's call-arg capture (valuediff B3: module {"code": "..."} vs Chrome {}). All GPU classes in gpu-command.js that kept label (and the query set's type/count) on the instance now hold them in WeakMap state behind prototype accessors, the GPUTexture/GPUBuffer house pattern; module.code stays readable through the prototype for the encoder's capture path. New test webgpu_objects_json_to_an_empty_own_surface pins {} for module/pipeline/texture/sampler, empty own keys, readable code, and the descriptor round-trip. Scoped: obscura-js 767/767 (--features render, 1 skipped). Full gate deferred to the next backfill

- Keyboard surface trims to the measured Chrome interface + Event Timing entries leave the global timeline (10-08, B6/entries): Keyboard.prototype carried three event methods (addEventListener/removeEventListener/dispatchEvent) Chrome's Keyboard does not have (Chromium 149: exactly constructor/getLayoutMap/lock/unlock -- Keyboard is not an EventTarget), and KeyboardLayoutMap instances exposed a _entries own property where Chrome answers [] (entries now live in a WeakMap behind the same prototype API; iteration order and 48-entry membership unchanged). Event Timing entries were pushed into the global performance timeline -- getEntriesByType('event') returned five entries per click where Chromium 149 answers [] (they are observer-scoped: delivered to PerformanceObservers incl. buffered replay from a dedicated 150-cap buffer, never to getEntries; 'first-input' stays global). Live probe after: obscura {event:[], first-input:[pointerdown]} == Chromium. The observer-scoped surplus was the challenge context's ~2x performance-entry count (批 24 event x5/first-input x1). Also named but not fixed here: iframe-document subresources fetched by the host (e.g. a frame stylesheet) are fetched but file no resource-timing entry in the frame timeline -- under-recording, opposite direction of the批 24 surplus. Scoped: obscura-js 768/768 (--features render, 1 skipped). Full gate deferred to the next backfill

- getHighEntropyValues answers the formFactors hint (10-08, B8): the B8 existence sweep found getBattery/getGamepads/getHighEntropyValues already implemented and byte-equal to Chromium 149 on every measured member (battery charging/chargingTime/dischargingTime/level + prototype + event handlers; gamepads [null x4]; all Client Hints hints) -- the only delta was the formFactors hint, which Chrome 130+ answers from the device class and obscura omitted. Now returned from the device class (mobile -> ["Phone"], else ["Desktop"]); low-entropy brands/mobile/platform always present as Chrome does. New test uach_high_entropy_values_answer_the_form_factors_hint. Scoped: obscura-js 769/769 (--features render, 1 skipped). Full gate deferred to the next backfill

- WebGL1 context stops answering WebGL2-only parameters; UNMASKED strings gated behind the extension (10-08, B4): a 50-enum dual-engine census (main + iframe canvas, obscura serve vs Chromium 149) found 17 parameter diffs -- 15 WebGL2-only enums (uniform blocks, transform feedback, draw buffers, combined component counts, UNIFORM_BUFFER_OFFSET_ALIGNMENT) answered with values from the D3D11-era WebGL1 table where Chromium answers null in a webgl1 context, plus UNMASKED_VENDOR/RENDERER_WEBGL readable before WEBGL_debug_renderer_info is enabled (Chrome: null until getExtension). The 15 enums left the WebGL1 table (webgl2 table keeps them); the UNMASKED read now gates on the extension and sets INVALID_ENUM, matching the OES_standard_derivatives door shape. Extension list/order (39=39), all 12 shader precision combos, and context attributes were already equal. Post-fix census: 0 param diffs, main and frame. New test webgl1_context_answers_null_for_webgl2_only_parameters. Scoped: obscura-js 770/770 (--features render, 1 skipped). Full gate deferred to the next backfill

- WebGLShader/WebGLProgram become inert interface instances (10-08, B5): _WebGLContext.createShader returned a plain {type,source,compiled} literal (and programs {shaders,linked}), so the shader object serialized as {"type":35632,"source":"","compiled":true} in the challenge's shaderSource call-arg capture where Chrome's shader object answers {} (valuediff B5). State moved to WeakMaps behind WebGLShader/WebGLProgram interface classes (Illegal constructor + toStringTag); getShaderSource reads the state map; getShaderParameter(COMPILE_STATUS) now correctly answers false before compileShader (was true at creation). New test webgl_shader_objects_serialize_to_an_empty_surface. The console/math 46-name divergence attributed same batch: the ddiv.prop streams are identical for 101 entries, then chrome's postMessage promise chain carries one more .then link and takes the console/math/SVG main-path census while obscura falls into the media/codec/storage fallback (storage estimate/getDirectory, Intl, decodingInfo, getCapabilities, isTypeSupported) -- no missing globals; attribution of the branch flip needs promise-settlement instrumentation on that chain (instrumentor side). Scoped: obscura-js 771/771 (--features render, 1 skipped). Full gate deferred to the next backfill

- Window prototype chain aligns to the Chromium five-level shape; Math.sumPrecise filled (10-08, 批 56/B-direction): the census probe (window ownKeys + 5-level prototype chain + fn names + navigator/console/Math/performance surfaces, main + cross-origin iframe, obscura serve vs Chromium 149) found the window own-keys already byte-equal (1235/1235), Math.sumPrecise missing (the vendored V8 predates it -- filled with a native-marked accumulator: Numbers only, empty -> -0, TypeError on non-numbers), an extra WindowProperties prototype level absent (Chromium's chain is window / Window.prototype / WindowProperties.prototype / EventTarget.prototype / Object.prototype -- obscura ran Window.prototype straight to EventTarget), and Window.prototype carrying the three realm-targeting EventTarget wrappers plus named-element accessors (page ids leaked onto the prototype; the iframe named accessor threw on read). Now: Window.prototype = the Chrome 149 three-member set; the wrappers live on the WindowProperties level (realm-targeting preserved); named accessors install on the level too (a plain object -- a proxy was tried and reverted: its has trap flipped strict-mode global assignments, caught by the secondary-realm test; the level's own names are a bounded known divergence where Chromium serves named props dynamically). Event receiver defaulting (undefined -> globalThis) in the shared listener helpers keeps bare calls working from engine-evaluated scripts. Post-fix census: window own 1235=1235, chain depth1/depth3/depth4 clean, depth2 carries exactly the six level names. Scoped: obscura-js 773/773 (--features render, 1 skipped). Full gate deferred to the next backfill

- Screen prototype chain and scoped-document prototype cleanup (10-08, 批 59): Screen.prototype now sits directly on EventTarget.prototype (the intermediate 3-member base object that lacked constructor/when is gone -- Chromium 149 screen chain L2 = EventTarget.prototype with exactly [addEventListener, constructor, dispatchEvent, removeEventListener, when]); and the scoped frame document no longer leaks `_scopeInfo` (now the module helper _scopeInfoFor(doc)) -- the frame document census had it beside Chrome's lone `constructor`. interaction.js's frame-root probe follows the same helper. Known bounded residues: the frame document level also carries `domain` (a real WebIDL accessor obscura needs frame-anchored), and EventTarget.prototype member ORDER differs (constructor first vs addEventListener first) -- member-set is aligned, order left for a memberOrder entry. Scoped: obscura-js 773/773 (--features render, 1 skipped). Full gate deferred to the next backfill

- EventTarget interface proto links for WebSocket/AbortSignal/RTCPeerConnection/Notification; DOMException keeps its constructor (10-08, 批 59/P0): the interface prototypes chained straight to Object.prototype where Chromium chains them to EventTarget.prototype (measured 149: WebSocket.prototype -> EventTarget.prototype -> Object.prototype, same for AbortSignal/Notification/RTCPeerConnection/Screen). Proto links added (WebSocket/AbortSignal/RTCPeerConnection after their class guards; Notification now extends EventTarget with the static maxActions = 2 per the reference). A DOMException constructor removal was attempted from a misread census and reverted -- DOMException.prototype.constructor stays (the abort-path error test pins constructor.name === "DOMException"). Known bounded residues: AbortSignal keeps its functional add/remove/dispatch as own members (they back the controller abort registry), WebSocket/RTCPeerConnection keep instance-owned state accessors, and the frame document level carries domain. Screen's EventTarget.prototype order (constructor first vs addEventListener first) is a positional difference -- member set aligned, sorted-parity pinned in the test. Scoped: obscura-js 774/774 (--features render, 1 skipped). Full gate deferred to the next backfill

- CacheStorage/IDBFactory/SpeechSynthesis instance surfaces move to the interface prototypes (10-08, 批 56 P0-4): caches, indexedDB and speechSynthesis carried every member as instance owns (Chromium 149 instances answer [] with the members on CacheStorage.prototype / IDBFactory.prototype / SpeechSynthesis.prototype). The interface objects are minted where absent (CacheStorage/IDBFactory with Illegal-constructor guards + toStringTag), the members defined on the prototypes, and the singletons rebuilt via Object.create. speechSynthesis's tri-state members (speaking/pending/paused) become prototype get-accessors over the no-op host state; the boot-order cover (surface built after the singleton) is handled by an idempotent hoist from surface-finalize. Census: caches/indexedDB/subtle/speech all byte-equal to Chromium 149. Scoped: obscura-js 774/774 (--features render, 1 skipped). Full gate deferred to the next backfill

- navigator.bluetooth / navigator.serial / Location.prototype.valueOf (10-08, 批 48 P1): bluetooth and serial were absent (only surface-table names) -- added with the honest headless shapes (Bluetooth.getAvailability -> Promise<false>, getDevices -> Promise<[]>, Serial.getPorts -> Promise<[]>, requestPort -> rejected NotFoundError, both EventTarget-shaped with toStringTag); Location.prototype.valueOf added on the interface prototype (the location instance's own surface stays byte-equal to the chrome oracle; valueOf resolves through the chain as Chrome carries it). history.length cold-start (1 vs 2) deferred -- the fix needs the navigation-commit hook into the History stack (cross-module). Census: main-scope surfaces aligned. Scoped: obscura-js 774/774 (--features render, 1 skipped). Full gate deferred to the next backfill

- WindowProperties level reduced to named accessors only (10-08, 批 60): the realm-targeting event wrappers rode the level as three extra own names a deep prototype census reads (Chromium's WindowProperties.prototype is own-empty -- named properties served dynamically). They now resolve through EventTarget.prototype's receiver-aware methods, with the shared listener helpers defaulting an undefined receiver to the realm global (bare calls from engine-evaluated scripts). Bluetooth/serial moved off the global object into navigator members. Census: main+frame window ownKeys and prototype levels byte-equal to Chromium 149 except the level's named accessors (f/s/t ids from the fixture page -- Chromium serves named props dynamically; full parity needs a V8 template interceptor, documented). Scoped: obscura-js 774/774 (--features render, 1 skipped). Full gate deferred to the next backfill

- StmH7 UA-CH brands order: Chromium first, parity-independent (10-08, 批 60/StmH7): the unbranded two-entry derivation answered grease-first for even majors (obscura 154-sim = [Not A(Brand, Chromium]) while the chrome-side payload for the same simulated major answers [Chromium, Not)A;Brand] (grease second) -- the StmH7 order divergence. The old `{seed % 2, (seed + 1) % 2}` scatter branch of the two-entry derivation is replaced by unconditional Chromium-first (measured wire: Chromium 149 reference payload AND Chromium 149 binary simulating 154 both answer Chromium-first, parity-independent); the sec-ch-ua header and navigator.userAgentData.brands share the same fingerprint source so both surfaces move together. FullVersionList parity holds (both entries share major-only versions except full). Tests: derived_fingerprint/stealth_request/unbranded_chromium_orders expectations updated to the measured shape. Scoped: obscura-net 137/137. Full gate deferred to the next backfill

- Worker fingerprint contract follows the parity-independent brands order (10-08, StmH7 follow-up): worker_inherits_the_creator_fingerprint_contract's Linux/146 expectation updated from grease-first to Chromium-first to match the measured two-entry wire shape (same derivation source as the sec-ch-ua header fix). obscura-net 137/137 after the same change; obscura-js scoped rerun 774/774 (--test-threads=2; timing-sensitive tests flake under machine load at default parallelism -- non-implicated).

- screen.isExtended/onchange removed; getVoices answers the RE-149 empty oracle (10-08, awzl9 probe-semantics): the reference Chromium 149 answers screen.isExtended === undefined and carries no screen.onchange (existence-probe divergence AWZLk9[79], first-cause hypothesis with the flip experiment pending); both accessors and their marking entries are removed from Screen.prototype. speechSynthesis.getVoices reverses to the reference oracle: the RE-149 cold profile answers an EMPTY voice list (the earlier 68-row table was the local macOS dump, not the reference) -- getVoices stays a prototype method returning a fresh []. voice_table test rewritten to the oracle shape (total 0, fresh array each call, instance own []). Scoped: obscura-js 774/774 (--test-threads=2, 1 skipped). Full gate deferred to the next backfill

- WindowProperties level carries only named accessors; event wrappers resolve through EventTarget.prototype (10-08, 批 60): the three realm-targeting event wrappers rode the level as three own names a deep prototype census reads (Chromium's WindowProperties.prototype is own-empty -- named properties served dynamically). They resolve through EventTarget.prototype's receiver-aware methods now, with the shared listener helpers defaulting an undefined receiver to the realm global (bare calls from engine-evaluated scripts hit this path -- the LoAF test's WeakMap.set(undefined) was the same class). Proxy shapes for the level are ruled out: V8 stops LookupIterator at any proxy in the global prototype chain and the default [[Set]] flips strict-mode undeclared assignments (both has-trap and get-only variants caught by the secondary-realm test). Census: main+frame window ownKeys byte-equal; depth2 reduced to the level's named accessors (f/s/t from the fixture page ids -- Chromium serves named props dynamically; full parity needs a V8 template interceptor, documented). Scoped: obscura-js 774/774 (--test-threads=2, 1 skipped; default-parallelism timing tests flake under machine load, non-implicated). Full gate deferred to the next backfill

- document.activeElement retargets focus to the shadow host; ShadowRoot.activeElement reports the tree-scoped element (10-09, eiLB1 click-record parity): the challenge click collector reads document-level activeElement, which Chrome retargets to the host (a closed shadow checkbox off body reads body) while we returned the element itself. Both getters walk getRootNode chains with a seen-set; ShadowRoot.activeElement scopes to its tree and reports the inner host for deeper trees. Scoped: obscura-js + obscura-cdp 958 run, 957 pass; the one red (obscura-cdp mouse_events_enter_iframe_realm_with_local_client_coordinates) is pre-existing on pristine dev (verified by stash-run), non-implicated. Full gate deferred to the next backfill.

- Frame-realm HTML timers carry an optional dispatch-latency floor (10-09, phase-time direction 1): OBSCURA_TIMER_DISPATCH_FLOOR_MS (+ _JITTER_MS uniform jitter), parsed once per process and applied only to setTimeout/setInterval inside frame realms (the iframe scheduler-IPC latency a multiprocess browser pays and this single-process engine does not); top-page timers, the rAF pump, and posted-task wakes keep authored delays, unset env stays byte-identical. Scoped: obscura-js 779/779 release (3 new pacing tests: floor scoping, off-state identity, jitter bounds). Obstacle course not run (obscura-benchmark not present on this machine). Full gate deferred to the next backfill.

- Subresource header order re-measured on the production reference (Chromium 149) and the no-initiator client-hint leak closed (10-09, b47 reqable evidence): the /fo/ POST order places accept-language second and user-agent after sec-ch-ua-mobile (both differ from the 154 observatory measurement the table pinned), the frame navigation carries accept-language before Upgrade-Insecure-Requests plus a Sec-Fetch-Storage-Access slot; the challenge's same-origin image and worker fetch carried six high-entropy hints through may_send_accepted_client_hints' no-initiator escape hatch (Chrome 149 sends none) - the escape now only opens for navigations. obscura-net 137/137. Full gate deferred to the next backfill.
