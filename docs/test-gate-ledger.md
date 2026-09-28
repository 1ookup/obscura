# Test gate ledger

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
