#!/bin/bash
# run-chrome-round.sh <tag> — Chromium 侧单发验证轮（按 turnstile-instrumentation-verify skill 流程）
# 产物: traces/chrome-<tag>.jsonl + reports/chrome-<tag>.{console,chromium,bridge,trace-summary}.log
# 退出码: 0=过(passed-404/success) 1=fail/timeout 2=SKIP(Chromium 被他人占用) 3=守卫未过
# 纪律（lead 规则 2026-10-08）：连败 2 轮 = 优先怀疑插桩错误，停止并报告 lead，
# 不跑 obscura 轮、不回滚；md5 与期望不符 = 停下报告 lead，绝不自行拉取。
# 必须先 export OV2_EXPECTED_MD5=<期望值>（守卫用，脚本绝不更新 ov2）。
set -u
TAG="${1:?usage: run-chrome-round.sh <tag>}"
# 迁移版（权威真身，2026-10-08 自 cf-parity-1007/tools/ 迁入）。
# 产物根默认 /private/tmp/cf-parity-1007，可用 CF_PARITY_ROOT 覆盖；
# 同目录依赖（preflight.sh / trace-summary.py / bridge-drive.py）按 SCRIPT_DIR 解析。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${CF_PARITY_ROOT:-/private/tmp/cf-parity-1007}"
CF5S=/Users/l9h8/macOSShare/cf5s
PROFILE_DIR=/Users/l9h8/chrome-profile
TRACE_FILE="$PROFILE_DIR/Default/tracelog/trace.jsonl"
TARGET_URL="https://www.thelancet.com/123.txt"
SITEKEY="0x4AAAAAAADnPIDROrmt1Wwj"
CHROMIUM="/Users/l9h8/Applications/Chromium.app/Contents/MacOS/Chromium"
UI_STATE="$HOME/.claude/skills/turnstile-instrumentation-verify/scripts/turnstile-ui-state.mjs"
CLEARED_CHECK="$HOME/.claude/skills/turnstile-instrumentation-verify/scripts/cleared-check.mjs"
PREFLIGHT="$SCRIPT_DIR/preflight.sh"
SUMMARY="$SCRIPT_DIR/trace-summary.py"

# ---- md5 守卫（强制，不许静默跳过） ----
if [ -z "${OV2_EXPECTED_MD5:-}" ]; then
  echo "[chrome-round] 未设 OV2_EXPECTED_MD5，拒绝开轮。当前实际值: $(md5 -q "$CF5S/chanllenge/ov2/ov2.js" 2>/dev/null || echo '?')" >&2
  exit 3
fi
echo "[chrome-round] preflight:"; "$PREFLIGHT" "$OV2_EXPECTED_MD5" || { echo "[chrome-round] 守卫未过，退出" >&2; exit 3; }

# ---- Chromium 不误杀检查：已有实例 = 可能是用户自己开的，跳过本轮 ----
PRE="$(pgrep -x Chromium 2>/dev/null || true)"
if [ -n "$PRE" ]; then
  echo "[chrome-round] SKIP tag=$TAG: Chromium 已在运行 (pids: $(echo $PRE | tr '\n' ' '))，非本脚本启动，拒绝触碰。" >&2
  exit 2
fi

CONSOLE="$ROOT/reports/chrome-$TAG.console.log"
exec > >(tee "$CONSOLE") 2>&1
echo "[chrome-round] tag=$TAG start $(date '+%F %T')  ov2-md5=$OV2_EXPECTED_MD5"

# ---- Step 1b 冷 profile + 冷 trace（tracelog sink 在 Default/ 里，必须重建） ----
rm -rf "$PROFILE_DIR/Default"
mkdir -p "$PROFILE_DIR/Default/tracelog"
: > "$TRACE_FILE"

# ---- Step 2 起 Chromium（记 PID，收尾只收拾自己的） ----
nohup "$CHROMIUM" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE_DIR" \
  --profile-directory=Default \
  --proxy-server=http://127.0.0.1:9000 \
  "$TARGET_URL" \
  >/tmp/chromium-verify.log 2>&1 &
disown
CHROMIUM_PID=$!
echo "[chrome-round] chromium pid=$CHROMIUM_PID"

# ---- Step 3 settle ----
sleep 10

# ---- Step 4 bridge 下发（必须从 cf5s cwd 起） ----
pushd "$CF5S" >/dev/null
nohup node bridged-replay/run-live-vmp-replay-bridged.mjs \
  --send --bridge-sitekey="$SITEKEY" \
  >/tmp/bridged-replay-verify.log 2>&1 &
disown
BRIDGE_PID=$!
popd >/dev/null
echo "[chrome-round] bridge pid=$BRIDGE_PID"

# ---- Step 5 ----
sleep 10

# ---- Step 6 轮询到终态（cleared 优先于 widget 状态；触发 URL 过盾 = 源站 404） ----
RESULT=timeout
for i in $(seq 1 15); do
  CLEARED="$(node "$CLEARED_CHECK" 2>/dev/null || echo 'error | probe failed')"
  echo "[poll $i] page: $CLEARED"
  case "$CLEARED" in *cleared*) RESULT=passed-404; break ;; esac
  STATE="$(node "$UI_STATE" 2>/dev/null | tr -d '[:space:]')"
  echo "[poll $i] widget: $STATE"
  case "$STATE" in
    *state:success*) RESULT=success; break ;;
    *state:failed*)  RESULT=failed;  break ;;
    *state:expired*) RESULT=expired; break ;;
  esac
  sleep 2
done
echo "[chrome-round] terminal state: $RESULT"

# ---- Step 7 cooldown（tracelog 写盘是 fire-and-forget，急杀丢尾部） ----
sleep 5

# ---- Step 8 收尸：先 bridge 后 Chromium（本脚本已确认无他人实例，killall 安全） ----
kill -9 "$BRIDGE_PID" 2>/dev/null || true
killall -9 Chromium 2>/dev/null || true

# ---- Step 9 归档 ----
cp "$TRACE_FILE" "$ROOT/traces/chrome-$TAG.jsonl"
cp /tmp/chromium-verify.log "$ROOT/reports/chrome-$TAG.chromium.log" 2>/dev/null || true
cp /tmp/bridged-replay-verify.log "$ROOT/reports/chrome-$TAG.bridge.log" 2>/dev/null || true
python3 "$SUMMARY" "$ROOT/traces/chrome-$TAG.jsonl" | tee "$ROOT/reports/chrome-$TAG.trace-summary.txt"
echo "[chrome-round] tag=$TAG done $(date '+%F %T') result=$RESULT"
case "$RESULT" in passed-404|success) exit 0 ;; *) exit 1 ;; esac
