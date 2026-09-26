# Test gate ledger

Full-workspace release gates that were DEFERRED under the scoped-first policy
(AGENTS.md, "Scoped-first test gating"). Each pending entry is backfilled by
one consolidated `cargo v8-test` + the no-default-features check; entries the
run covers are then removed.

## Pending

- 2026-09-24: working tree, `crates/obscura-net` header order and set
  (`chrome_headers.rs` plus the three build sites in `client.rs` /
  `wreq_client.rs`; tests only elsewhere). No commit yet. Scoped suites ran
  instead of the full gate: `cargo nextest run --release -p obscura-net
  --config vendor/v8-source.toml` = 133/133, `cargo nextest run --release
  --features render -p obscura-browser --no-fail-fast --config
  vendor/v8-source.toml` = 131/131, `cargo check -p obscura-net
  --no-default-features` (clean, no warnings) and `cargo check -p obscura-js
  -p obscura-cli --no-default-features --config vendor/v8-source.toml`
  (passes). The exact release build ran. Does not touch feature gates, build
  config, or unsafe/FFI. Full gate still mandatory before push.

- 2026-09-24: commit `b4a1bf5` (js: gate the font-platform call in the
  offscreen context test). Feature-gate adjacent: the guard restores the
  `--no-default-features` shape. Verified instead of the full gate:
  `cargo check -p obscura-js -p obscura-cli --no-default-features --config
  vendor/v8-source.toml` (passes) and `cargo check --tests -p obscura-js
  --no-default-features` (now compiles; failed with E0433 before). The
  render-shape suites were green at `bfbf226`. Full gate still mandatory
  before push.

- 2026-09-24: commit `bfbf226` (js: cross-realm ops, worker canvas, media
  capabilities, geometry branding). The geometry-branding hunks in that commit
  -- getClientRects() entries are real DOMRect instances, DOMRectList /
  DOMPoint / DOMQuad adopt Chrome's interface shape, visualViewport is a
  VisualViewport instance -- ran scoped suites instead:
  `cargo nextest run --release --features render --no-fail-fast -p
  obscura-js -p obscura-browser -p obscura-cdp -p obscura-render --config
  vendor/v8-source.toml` = **1627 run, 0 failed, 4 skipped**, plus
  `-p obscura-dom` (no render feature) at 93/93; exact release build current
  at `ac5b04146391768c`. Two obscura-js failures seen under parallel load are
  pre-existing flakes (`timing_edits_preserve_identity_...`, already recorded
  below, and `worker_canvas_subsystem_follows_the_creator_gpu_profile`); both
  pass standalone and the suite re-ran 708/708. Deferred full gate plus the
  obstacle course remain mandatory before any push or verdict claim.

- 2026-09-24: commits `6b2acdc` (dom: attribute and text escaping match
  Chrome 153) + `a98a5ef` (js: every realm reports the browser window
  geometry) + `64f6e5a` (browser: frame isolation, storage quota, connection
  rtt, awaited-evaluate frame commits). Scoped suites ran instead:
  `cargo nextest run --release --features render --no-fail-fast -p
  obscura-dom -p obscura-browser -p obscura-js -p obscura-cdp --config
  vendor/v8-source.toml` = **1100/1100 passed, 3 skipped**, exact release
  build current at `6d7fa057e621c5a3`. The changes touch frame realm
  ordering, isolation policy, HTML escaping and the CDP evaluate pump, so
  the deferred full gate plus the obstacle course are mandatory before any
  push or verdict claim.

- 2026-09-23: commits `f07489d` (rtc: icecandidate events are
  RTCPeerConnectionIceEvent instances) + `894598c` (dom: Document.prototype
  stringifies [object Document]). Scoped suite ran instead:
  `cargo nextest run --release --features render -p obscura-js --config
  vendor/v8-source.toml`, 686 tests, 685 pass + 1 pre-existing load flake
  (`timing_edits_preserve_identity_and_pause_holds_then_resumes`, fails on the
  clean tree at b9ef38c under parallel load, passes standalone). Bootstrap-only
  change plus tests; exact release build ran before the verdict rounds.

## Backfilled

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
