#!/bin/bash
# run-obscura-round.sh <tag> — obscura 侧单发验证轮（按 turnstile-verify-obscura skill 流程）
# 产物: traces/obscura-<tag>.jsonl + reports/obscura-<tag>.{console,serve,drive,bridge,trace-summary}.log
# 退出码: 0=过(双信号) 1=fail/timeout 2=SKIP(端口/进程被占) 3=守卫未过
# 必须先 export OV2_EXPECTED_MD5=<期望值>；每轮一次性 --storage-dir；TERM 再 -9 保 flush。
# 纪律（lead 规则 2026-10-08）：fail 确认后 fail-fast 15s 观察窗收口（寿命归一，
# 见 reports/xp3489-tailvalue.md）；md5 与期望不符 = 停下报告 lead，绝不自行拉取。
set -u
TAG="${1:?usage: run-obscura-round.sh <tag>}"
# 迁移版（权威真身，2026-10-08 自 cf-parity-1007/tools/ 迁入）。
# 产物根默认 /private/tmp/cf-parity-1007，可用 CF_PARITY_ROOT 覆盖；
# 同目录依赖（preflight.sh / trace-summary.py / bridge-drive.py）按 SCRIPT_DIR 解析。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${CF_PARITY_ROOT:-/private/tmp/cf-parity-1007}"
CF5S=/Users/l9h8/macOSShare/cf5s
BIN=/Users/l9h8/obscura/target/release/obscura
DRIVE="$SCRIPT_DIR/bridge-drive.py"
PORT=9311
TRACE="$ROOT/traces/obscura-$TAG.jsonl"
TARGET_URL="https://www.thelancet.com/123.txt"
SITEKEY="0x4AAAAAAADnPIDROrmt1Wwj"
REF_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
PREFLIGHT="$SCRIPT_DIR/preflight.sh"
SUMMARY="$SCRIPT_DIR/trace-summary.py"

# ---- md5 守卫（强制） ----
if [ -z "${OV2_EXPECTED_MD5:-}" ]; then
  echo "[obscura-round] 未设 OV2_EXPECTED_MD5，拒绝开轮。当前实际值: $(md5 -q "$CF5S/chanllenge/ov2/ov2.js" 2>/dev/null || echo '?')" >&2
  exit 3
fi
echo "[obscura-round] preflight:"; "$PREFLIGHT" "$OV2_EXPECTED_MD5" || { echo "[obscura-round] 守卫未过，退出" >&2; exit 3; }

# ---- 端口占用检查（残留 serve 会静默 bind 失败，探针打在旧代码上） ----
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .; then
  echo "[obscura-round] SKIP tag=$TAG: port $PORT 已被占用:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 2
fi

CONSOLE="$ROOT/reports/obscura-$TAG.console.log"
exec > >(tee "$CONSOLE") 2>&1
echo "[obscura-round] tag=$TAG start $(date '+%F %T')  ov2-md5=$OV2_EXPECTED_MD5"

# ---- Step 1 冷 trace + Step 1b 冷存储 ----
: > "$TRACE"
STORAGE="$(mktemp -d /tmp/obscura-verify-storage.XXXXXX)"
echo "[obscura-round] fresh storage: $STORAGE"

# ---- Step 2 起 obscura serve（只带 --tracelog 等价的 env，不开全量 --trace） ----
OBSCURA_TRACELOG_FILE="$TRACE" \
SSL_CERT_FILE="$REQABLE_CA" \
OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  nohup "$BIN" serve --port "$PORT" --proxy http://127.0.0.1:9000 --stealth \
    --user-agent "$REF_UA" --storage-dir "$STORAGE" \
    >"$ROOT/reports/obscura-$TAG.serve.log" 2>&1 &
disown
SERVE_PID=$!
sleep 2
echo "[obscura-round] serve pid=$SERVE_PID"
echo "[obscura-round] /json/version: $(curl -s "http://127.0.0.1:$PORT/json/version" | head -c 300)"
echo "[obscura-round] serve lstart: $(ps -p "$SERVE_PID" -o lstart= 2>/dev/null)  | 二进制 mtime: $(stat -f '%Sm' "$BIN")"
grep -m1 -i 'fingerprint\|tracker\|stealth' "$ROOT/reports/obscura-$TAG.serve.log" || echo "[obscura-round] WARN: serve 日志未见 stealth/fingerprint 行"

# ---- Step 3 页面驱动（导航+轮询+自动点击；-u 防 nohup 块缓冲） ----
cd /Users/l9h8/obscura
DRIVE_LOG="$ROOT/reports/obscura-$TAG.drive.log"
# 不能 disown：bash 对 disown 过的 pid wait 立即返回 rc=0（实测），会掐死整轮
nohup python3 -u "$DRIVE" --port "$PORT" --url "$TARGET_URL" --deadline 45 --max-clicks 1 >"$DRIVE_LOG" 2>&1 &
DRIVE_PID=$!
sleep 8
grep -m2 'harness:' "$DRIVE_LOG" || echo "[obscura-round] WARN: 8s 内未见 harness: 行（ws 未连上 9001？）"

# ---- Step 4 bridge 下发（必须从 cf5s cwd 起） ----
pushd "$CF5S" >/dev/null
BRIDGE_LOG="$ROOT/reports/obscura-$TAG.bridge.log"
nohup node bridged-replay/run-live-vmp-replay-bridged.mjs \
  --send --bridge-sitekey="$SITEKEY" >"$BRIDGE_LOG" 2>&1 &
disown
BRIDGE_PID=$!
popd >/dev/null
echo "[obscura-round] drive pid=$DRIVE_PID  bridge pid=$BRIDGE_PID"

# ---- Step 5 fail-fast 收口（批 6 方法固化；v2 改盯 drive 日志） ----
# drive 自己在轮询 harness #status（TOKEN_POLL），其日志里天然出现
# "error-callback ..."（fail 确认）与 "result: success"。独立 detector 进程
# 有抓错 target / 导航断连两个已实测的坑（obscura-v1008 轮），弃用。
# fail 确认后 15s 一致观察窗收口（页面寿命对齐，见 xp3489-tailvalue.md）；
# success 等双信号（drive success + bridge TOKEN）。TERM→2s→-9 保留保 flush。
FF_END=$((SECONDS + 60))
FF_RC=""
DRIVE_RC=""
while [ $SECONDS -lt $FF_END ]; do
  if ! kill -0 "$DRIVE_PID" 2>/dev/null; then break; fi
  if tail -5 "$DRIVE_LOG" 2>/dev/null | grep -qE 'widget error|result: fail'; then
    echo "[obscura-round] fail-fast: challenge fail 确认，8s 观察窗后收口"
    FF_RC=41
    sleep 8
    break
  fi
  if tail -3 "$DRIVE_LOG" 2>/dev/null | grep -q 'result: success'; then
    echo "[obscura-round] fail-fast: drive success，等 bridge TOKEN 双信号"
    FF_RC=0
    for i in $(seq 1 20); do grep -q 'TOKEN len=' "$BRIDGE_LOG" 2>/dev/null && break
      kill -0 "$BRIDGE_PID" 2>/dev/null || break; sleep 1; done
    break
  fi
  sleep 2
done
if [ -z "$DRIVE_RC" ] && ! kill -0 "$DRIVE_PID" 2>/dev/null; then
  wait "$DRIVE_PID" 2>/dev/null; DRIVE_RC=$?
fi
echo "[obscura-round] drive rc=${DRIVE_RC:-running}  fail-fast rc=${FF_RC:-timeout}"
tail -5 "$DRIVE_LOG"
if grep -q 'TOKEN len=' "$BRIDGE_LOG"; then
  echo "[obscura-round] bridge 侧: $(grep 'TOKEN len=' "$BRIDGE_LOG" | head -1)"
else
  echo "[obscura-round] bridge 侧: 无 TOKEN 回流"
fi

# ---- Step 6 cooldown 后收尾（先 TERM 保 flush，再 -9 清死） ----
sleep 3
kill "$SERVE_PID" 2>/dev/null; sleep 2
kill -9 "$SERVE_PID" "$DRIVE_PID" "$BRIDGE_PID" 2>/dev/null || true

# ---- 轮后环境核对 ----
LEFT="$(lsof -nP -iTCP:9001 -sTCP:ESTABLISHED 2>/dev/null | tail -n +2)"
if [ -n "$LEFT" ]; then
  echo "[obscura-round] WARN: 9001 仍有 ESTABLISHED 残留（下一轮会被拒，先清再开）:"
  echo "$LEFT" | sed 's/^/[obscura-round]   /'
fi

# ---- Step 7 归档 ----
python3 "$SUMMARY" "$TRACE" | tee "$ROOT/reports/obscura-$TAG.trace-summary.txt"
echo "[obscura-round] tag=$TAG done $(date '+%F %T') drive_rc=$DRIVE_RC"

# ---- 判定：双信号才算过（drive rc 或 detector rc 任一为 0，且 bridge TOKEN 回流） ----
if grep -q 'TOKEN len=' "$BRIDGE_LOG" && { [ "$DRIVE_RC" -eq 0 ] || [ "${DET_RC:-1}" -eq 0 ]; }; then
  echo "[obscura-round] RESULT: PASS (双信号)"
  exit 0
fi
echo "[obscura-round] RESULT: FAIL"
exit 1
