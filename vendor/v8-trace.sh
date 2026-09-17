#!/usr/bin/env bash
# Build and run the pinned V8 property tracer.
#
# Native tracing is implemented directly in the vendored V8 source. This script
# only builds and verifies it; it does not patch V8 source.
#
#   * a fresh source checkout still needs the rusty_v8 extras if document.all is
#     part of the page contract;
#   * the CLI enables the V8 property flag for `OBSCURA_TRACE_API_FILE`.
#
# Usage:
#   vendor/v8-trace.sh build                     build against vendored V8
#   vendor/v8-trace.sh run OUT.log -- <args...>  run obscura, trace to OUT.log
#
# Property tracing does not enable V8's optional `--trace` CALL/RET stream.
#   vendor/v8-trace.sh check                     is the current binary trace-capable?
#
# OBSCURA_NO_DEFAULT=1 builds without the default features -- no stealth, hence
# no BoringSSL. Only useful when the traced page does not care about the
# transport; challenge scripts usually do.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V8_DIR="$ROOT/vendor/rusty_v8"
# Bindings rusty_v8 leaves unbound that the engine needs; see the script.
RUSTY_EXTRAS="$ROOT/vendor/v8-rusty-extras.sh"
BIN="$ROOT/target/release/obscura"
# Carries both the [patch.crates-io] entry and V8_FROM_SOURCE=1; the same file
# backs the cargo aliases and .githooks/pre-push, so the override is defined once.
PATCH_CONFIG="vendor/v8-source.toml"

die() { echo "$*" >&2; exit 1; }

binary_is_trace_capable() {
  [[ -x "$BIN" ]] || return 1
  local probe
  probe="$(mktemp "${TMPDIR:-/tmp}/obscura-trace-check.XXXXXX")" || return 1
  local status=1
  if "$BIN" --trace-api-file "$probe" fetch \
      'data:text/html,<script>(()=>{const o={traceCheck:1};o.traceCheck;o.traceAbsent;})();</script>' \
      --wait 0 --timeout 5 --quiet >/dev/null 2>&1 &&
      grep -q $'^HIT\tObject\ttraceCheck\t' "$probe" &&
      grep -q $'^MISS\tObject\ttraceAbsent\t' "$probe"; then
    status=0
  fi
  rm -f -- "$probe"
  return "$status"
}

cmd_build() {
  [[ -f "$V8_DIR/v8/src/ic/ic.cc" ]] || die \
"V8 source missing at $V8_DIR/v8.

  git clone --recurse-submodules https://github.com/denoland/rusty_v8 $V8_DIR"

  # Independent of API tracing: these are ObjectTemplate bindings the engine
  # needs (document.all), and they live in rusty_v8 rather than in V8.
  "$RUSTY_EXTRAS" "$V8_DIR" >/dev/null
  echo "building pinned V8 trace binary (first time takes ~30 minutes)"
  cd "$ROOT"

  # --features adds to the default set rather than replacing it, and `default`
  # now carries `stealth`, so OBSCURA_FEATURES=render means render AND stealth.
  # That is the right default for tracing -- challenge scripts branch on the
  # transport -- but OBSCURA_NO_DEFAULT=1 gives back the lean shape, which also
  # skips the BoringSSL build.
  local feature_args=(--features "${OBSCURA_FEATURES:-render}")
  if [[ "${OBSCURA_NO_DEFAULT:-0}" == "1" ]]; then
    feature_args=(--no-default-features "${feature_args[@]}")
  fi

  # V8_FROM_SOURCE=1 comes from the --config file (force = true).
  cargo build --release -p obscura-cli --bins \
    "${feature_args[@]}" --config "$PATCH_CONFIG"
  echo "built $BIN"
}

# The JSONL contract is the one a HaHaVM comparison needs: one record per API
# access with t/src/name/args/result, reads carrying the value they returned.
# Checked separately from the TSV smoke because the two modes are emitted from
# different probe sites and a binary can have one without the other.
json_trace_is_capable() {
  [[ -x "$BIN" ]] || return 1
  local probe
  probe="$(mktemp "${TMPDIR:-/tmp}/obscura-trace-json.XXXXXX")" || return 1
  local status=1
  if "$BIN" --trace-api-file "$probe" --trace-api-format jsonl \
      --trace-api-filter 'userAgent,setAttribute,title' --trace-api-calls \
      fetch 'data:text/html,<script>document.title="t";document.body.setAttribute("x","1");void navigator.userAgent;</script>' \
      --wait 0 --timeout 5 --quiet >/dev/null 2>&1 &&
      grep -q '"name":"[A-Za-z]*\.userAgent"' "$probe" &&
      grep -q '"src":"set ' "$probe" &&
      grep -q '"name":"[A-Za-z]*\.setAttribute"' "$probe"; then
    status=0
  fi
  rm -f -- "$probe"
  return "$status"
}

cmd_check() {
  if binary_is_trace_capable; then
    echo "trace-capable: $BIN"
  else
    die "trace API unavailable: $BIN
Rebuild with: cargo build --release -p obscura-cli --config vendor/v8-source.toml"
  fi
  if json_trace_is_capable; then
    echo "trace-capable (jsonl): $BIN"
  else
    echo "jsonl records unavailable: rebuild with vendor/v8-trace.sh build" >&2
    exit 1
  fi
}

cmd_run() {
  local out="${1:-}"
  [[ -n "$out" ]] || die "usage: $0 run OUT.log -- <obscura args...>"
  shift
  [[ "${1:-}" == "--" ]] && shift

  # Checked before the run rather than after: a silently unpatched binary
  # otherwise produces a successful fetch and an empty file, which reads as "the
  # page did nothing".
  binary_is_trace_capable || die "trace API unavailable: $BIN
Rebuild with: vendor/v8-trace.sh build"

  OBSCURA_TRACE_API_FILE="$out" "$BIN" "$@"
  echo "trace: $out ($(wc -l < "$out" | tr -d ' ') records)" >&2
}

case "${1:-}" in
  build) shift; cmd_build "$@" ;;
  check) shift; cmd_check "$@" ;;
  run)   shift; cmd_run "$@" ;;
  *) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
