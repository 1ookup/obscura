# Test gate ledger

> **已迁移到 Notion**：[Test gate ledger](https://app.notion.com/p/3e9ea41ebc4881eaad16d321e040b5b7) —— 后续维护以 Notion 版本为准；本文件保留作为开发参考。

Full-workspace release gates that were DEFERRED under the scoped-first policy
(AGENTS.md, "Scoped-first test gating"). Each pending entry is backfilled by
one consolidated `cargo v8-test` + the no-default-features check; entries the
run covers are then removed.

## Pending

(none)

## Backfilled
- 2026-10-10: backfill executed at HEAD `992b3a1`, `cargo nextest run
  --release --features render --no-fail-fast --config
  vendor/v8-source.toml` = **2076/2084 passed** (8 failed, 6 skipped), log
  `/tmp/fullgate-clean.log`, plus `cargo check -p obscura-js -p obscura-cli
  --no-default-features --config vendor/v8-source.toml` (clean after
  `992b3a1`). Covers every Deferred entry below through the 10-10
  own-surface batches (`ef9f025` `59d2701` `2fcc828` `3fdec1f` `992b3a1`).
  The eight failures, all pre-existing at `ef9f025` or load-flaky:
  `obscura-browser blob_url_iframe_navigation_commits_the_stored_document`
  and `obscura-cdp
  mouse_events_enter_iframe_realm_with_local_client_coordinates` (both
  A/B-confirmed red at `ef9f025`, the 10-09 frame batches, iframe
  URL/geometry parity); the emoji-metrics family (`obscura-js
  canvas_text_preparation...`, `challenge_svg_probe_emoji...`,
  `obscura-render ink_tests::macos_emoji_split...`) from the
  fallback-font constant line; the two webgpu subgroup-null expectations
  from the Apple-profile line; and one frame-timer-floor test that is
  parallel-load flaky (the family passes isolated 3/3). Load discipline:
  a concurrent cargo build poisons a dozen timing-family tests, so the
  full gate runs alone; the clean single run shows exactly the eight
  above. `992b3a1` fixed the opt-out shape (three render-only items had
  leaked past the gate in recent batches). Obstacle course still
  outstanding (counterpart repo absent on this host).

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

(none)

- Cross-origin window writes (10-10, fcPost setcast finding from cfov2): the frame-side and ancestor-side WindowProxy facades gated sets on an allowlist that let an allowlisted own member through -- a cross-origin caller assigning parent.postMessage got a plain success where Chrome refuses with SecurityError (the challenge's fcPost hook reads exactly that). Cross-origin sets now accept location only (it navigates) and refuse every other member; the allowlist Set had no other reader. Local two-port fixture: cross-origin SecurityError with the member intact and callable, same-origin unchanged. Scoped: obscura-js + obscura-browser + obscura-cdp (7 pre-existing reds unchanged). Full gate deferred to the next backfill.

- Frame-fetch pump slicing (10-10, fork-A freeze finding): frame-document
  fetches now run in 25ms slices with a bounded realm pump turn between
  them, and the frame-navigation drain returns the borrowed DOM to the
  realm for each slice. Scoped: obscura-browser + obscura-dom +
  obscura-js (1014: 5 pre-existing/environment reds -- blob iframe nav
  reproduced red at 03d271a; canvas emoji/SVG/webgpu reds in a crate with
  no dependency edge to the change). no-default-features check passed.
  obstacle course unavailable in this environment (companion repo absent;
  render-repros fixture suite renders 63/63 on the obscura side, chromium
  baseline capture missing playwright). Full workspace run deferred to
  the next backfill.
