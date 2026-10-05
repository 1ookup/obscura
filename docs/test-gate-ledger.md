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
