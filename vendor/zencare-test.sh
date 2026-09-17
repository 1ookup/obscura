#!/usr/bin/env bash
# 端到端测试：zencare.co Cloudflare 5秒盾
#
# 用法:
#   vendor/zencare-test.sh run    运行测试（stealth + proxy + trace + 截图）
#   vendor/zencare-test.sh report 分析最近一次 trace
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/target/release/obscura"
OUTDIR="/tmp/zencare-test"
TRACE="$OUTDIR/trace.log"
SCREENSHOT="$OUTDIR/screenshot.png"

# 代理证书（根据实际代理工具修改）
REQABLE_CA="${REQABLE_CA:-$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt}"
PROXY="${PROXY:-http://127.0.0.1:9000}"
URL="${URL:-https://zencare.co/1.txt}"
WAIT="${WAIT:-30}"
TIMEOUT="${TIMEOUT:-60}"

die() { echo "$*" >&2; exit 1; }

cmd_run() {
  mkdir -p "$OUTDIR"
  rm -f "$TRACE" "$SCREENSHOT"

  echo "=== zencare Cloudflare Challenge Test ==="
  echo "URL:      $URL"
  echo "Proxy:    $PROXY"
  echo "CA Cert:  $REQABLE_CA"
  echo "Wait:     ${WAIT}s"
  echo "Timeout:  ${TIMEOUT}s"
  echo "Output:   $OUTDIR"
  echo

  [[ -x "$BIN" ]] || die "obscura binary not found at $BIN. Build first."
  [[ -f "$REQABLE_CA" ]] || die "Proxy CA cert not found at $REQABLE_CA"

  SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
    "$ROOT/vendor/v8-trace.sh" run "$TRACE" -- \
    fetch "$URL" \
    --dump text \
    --proxy "$PROXY" \
    --stealth \
    --timeout "$TIMEOUT" \
    --wait "$WAIT" \
    --screenshot "$SCREENSHOT" 2>&1

  echo
  echo "=== Results ==="
  ls -lh "$SCREENSHOT" 2>/dev/null || echo "(no screenshot)"
  echo "Trace: $(wc -l < "$TRACE" 2>/dev/null || echo 0) records"
}

cmd_report() {
  [[ -f "$TRACE" ]] || die "No trace file at $TRACE. Run 'vendor/zencare-test.sh run' first."

  echo "========== zencare Trace Report =========="
  echo "Records: $(wc -l < "$TRACE")"

  echo
  echo "--- API Records ---"
  grep -E -- '^(实例访问|原型访问) - ' "$TRACE" | head -30 || true

  echo
  echo "--- Missing API Probes ---"
  grep -E -- ' -> getter -> undefined$' "$TRACE" | head -50 || true

  echo
  echo "--- API Calls ---"
  grep -E -- ' -> call -> ' "$TRACE" | head -50 || true

  echo
  echo "--- Screenshot ---"
  ls -lh "$SCREENSHOT" 2>/dev/null || echo "(no screenshot)"
}

case "${1:-}" in
  run)    shift; cmd_run "$@" ;;
  report) shift; cmd_report "$@" ;;
  *)
    echo "usage: $0 {run|report}"
    echo "  run     — fetch zencare.co with stealth + proxy + trace"
    echo "  report  — analyze the last trace"
    exit 2
    ;;
esac
