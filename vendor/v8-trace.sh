#!/usr/bin/env bash
# Build and run the property tracer.
#
# The build needs `V8_FROM_SOURCE=1` and a `--config` override, and the run needs
# three V8 flags in the right combination. Typing either by hand is how the two
# failures this exists to prevent happen:
#
#   * a plain `cargo build` or `cargo nextest` relinks against the prebuilt V8 and
#     silently drops the patch, so tracing stops with no explanation beyond
#     "unrecognized flag";
#   * `--no-use-ic` reads like the flag that would make the trace complete and
#     does the opposite, and `--no-lazy-feedback-allocation` -- which is the one
#     that matters -- is easy to leave off, taking missing-property detection with
#     it and nothing else, so the trace still looks fine.
#
# Usage:
#   vendor/v8-trace.sh build                     patch V8 and build against it
#   vendor/v8-trace.sh run OUT.tsv -- <args...>  run obscura, trace to OUT.tsv
#
# OBSCURA_TRACE_MODE=lookups drops the call/return hooks, which are most of the
# slowdown, and keeps property lookups. Use it when the page's own timing
# matters -- anything gated on network round trips.
#   vendor/v8-trace.sh check                     is the current binary patched?

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V8_DIR="$ROOT/vendor/rusty_v8"
BIN="$ROOT/target/release/obscura"
PATCH_CONFIG='patch.crates-io.v8.path="vendor/rusty_v8"'

# The flag combination, in one place. --trace drives the call and return hooks;
# --no-lazy-feedback-allocation drives the property ones, because V8 withholds a
# feedback vector from a function until it has run several times and loads
# without one bypass the inline caches entirely -- which is most of page script.
#
# --trace is also nearly all of the cost: it routes every function entry and
# exit through the runtime. On a page whose work is gated on network round
# trips that is enough to change what the page does before the deadline -- the
# Cloudflare challenge reached three requests under it and seven without. Pass
# `lookups` as the mode to drop the call hooks and keep the property ones; the
# same page then behaves as it does untraced.
trace_flags() {
  if [[ "${OBSCURA_TRACE_MODE:-full}" == "lookups" ]]; then
    printf -- '--trace-property-lookup --no-lazy-feedback-allocation --trace-property-lookup-file=%s' "$1"
  else
    printf -- '--trace --trace-property-lookup --no-lazy-feedback-allocation --trace-property-lookup-file=%s' "$1"
  fi
}

die() { echo "$*" >&2; exit 1; }

binary_is_patched() {
  [[ -x "$BIN" ]] || return 1
  "$BIN" --v8-flags "--trace-property-lookup" fetch "about:blank" --dump text \
    >/dev/null 2>"$ROOT/.v8trace-probe" || true
  ! grep -q "unrecognized flag" "$ROOT/.v8trace-probe" 2>/dev/null
}

cmd_build() {
  [[ -f "$V8_DIR/v8/src/ic/ic.cc" ]] || die \
"V8 source missing at $V8_DIR/v8.

  git clone --recurse-submodules https://github.com/denoland/rusty_v8 $V8_DIR"

  "$ROOT/vendor/v8-property-trace.sh" "$V8_DIR/v8" >/dev/null
  echo "patched; building (first time takes ~30 minutes)"
  cd "$ROOT"
  V8_FROM_SOURCE=1 cargo build --release -p obscura-cli --bins \
    --features "${OBSCURA_FEATURES:-render}" --config "$PATCH_CONFIG"
  echo "built $BIN"
}

cmd_check() {
  if binary_is_patched; then
    echo "patched: $BIN"
  else
    die "not patched: $BIN
A cargo build or nextest run without --config relinks against the prebuilt V8.
Rebuild with: vendor/v8-trace.sh build"
  fi
}

cmd_run() {
  local out="${1:-}"
  [[ -n "$out" ]] || die "usage: $0 run OUT.tsv -- <obscura args...>"
  shift
  [[ "${1:-}" == "--" ]] && shift

  # Checked before the run rather than after: a silently unpatched binary
  # otherwise produces a successful fetch and an empty file, which reads as "the
  # page did nothing".
  binary_is_patched || die "not patched: $BIN
Rebuild with: vendor/v8-trace.sh build"

  "$BIN" --v8-flags "$(trace_flags "$out")" "$@"
  echo "trace: $out ($(wc -l < "$out" | tr -d ' ') records)" >&2
}

case "${1:-}" in
  build) shift; cmd_build "$@" ;;
  check) shift; cmd_check "$@" ;;
  run)   shift; cmd_run "$@" ;;
  *) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

