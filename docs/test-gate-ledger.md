# Test gate ledger

Full-workspace release gates that were DEFERRED under the scoped-first policy
(AGENTS.md, "Scoped-first test gating"). Each pending entry is backfilled by
one consolidated `cargo v8-test` + the no-default-features check; entries the
run covers are then removed.

## Pending

- 2026-09-23: commits `f07489d` (rtc: icecandidate events are
  RTCPeerConnectionIceEvent instances) + `894598c` (dom: Document.prototype
  stringifies [object Document]). Scoped suite ran instead:
  `cargo nextest run --release --features render -p obscura-js --config
  vendor/v8-source.toml`, 686 tests, 685 pass + 1 pre-existing load flake
  (`timing_edits_preserve_identity_and_pause_holds_then_resumes`, fails on the
  clean tree at b9ef38c under parallel load, passes standalone). Bootstrap-only
  change plus tests; exact release build ran before the verdict rounds.

## Backfilled

- 2026-09-23: backfill executed 13:58, `cargo nextest run --release
  --features render --no-fail-fast --config vendor/v8-source.toml` =
  **1925/1925 passed** (1 leaky, 4 skipped) at HEAD d4a5352. Ledger clear.
- 2026-09-22: baseline. All code commits through `280cf2b` carried full
  workspace gates inside their batches (latest: 1914/1914 at the batch-41
  fix `f12dee4`; `6ac3488`/`280cf2b` are docs-only). Ledger starts empty.
