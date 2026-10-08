#!/bin/bash
# preflight.sh — cf-parity-1007 双侧对拍环境守卫
# 用法: preflight.sh <expected-ov2-md5>
#       (或环境变量 OV2_EXPECTED_MD5)
# 期望 md5 由参数/环境传入，绝不自动拉新版 ov2；不匹配 = 立即报错退出。
# 退出码: 0 = 全清；1 = 有 FAIL 项，禁止开轮。
set -u

EXPECTED_MD5="${1:-${OV2_EXPECTED_MD5:-}}"
OV2="/Users/l9h8/macOSShare/cf5s/chanllenge/ov2/ov2.js"
OBSCURA_BIN="/Users/l9h8/obscura/target/release/obscura"
CHROMIUM="/Users/l9h8/Applications/Chromium.app/Contents/MacOS/Chromium"
FAIL=0

die()  { echo "[preflight] FAIL: $*"; FAIL=1; }
ok()   { echo "[preflight] ok: $*"; }
warn() { echo "[preflight] WARN: $*"; }

# ---- 1. ov2.js 完整性守卫（另一个工程师在编辑它，我们只校验不触碰） ----
if [ -z "$EXPECTED_MD5" ]; then
  die "未提供期望 md5（用法: preflight.sh <md5> 或 export OV2_EXPECTED_MD5=…）。当前实际值: $(md5 -q "$OV2" 2>/dev/null || echo '<unreadable>')"
elif [ ! -f "$OV2" ]; then
  die "ov2.js 不存在: $OV2"
else
  ACTUAL="$(md5 -q "$OV2")"
  if [ "$ACTUAL" != "$EXPECTED_MD5" ]; then
    die "ov2.js md5 不匹配: 期望 $EXPECTED_MD5 实际 $ACTUAL —— 停下报告 lead，不要自行执行任何拉取；受控拉取（extract_ov2_js.py --variant g --instr-deploy --instr-mode=fulltrace）只有 lead 批准后执行，拉完全员同步新 md5"
  else
    ok "ov2.js md5 == $ACTUAL"
  fi
fi

# ---- 2. 代理链端口 ----
for p in 9000 9001; do
  if nc -z 127.0.0.1 "$p" 2>/dev/null; then ok "port $p listening"; else die "port $p 未监听"; fi
done

# ---- 3. 9001 单槽占用检查（warm-fiddle-bridge 单槽、无心跳，死连接会拒新页面） ----
ESTB="$(lsof -nP -iTCP:9001 -sTCP:ESTABLISHED 2>/dev/null | tail -n +2)"
if [ -n "$ESTB" ]; then
  warn "port 9001 存在 ESTABLISHED 连接，下一轮可能 code=1000 rejected；开轮前应清掉或重启 warm-fiddle-bridge.mjs:"
  echo "$ESTB" | sed 's/^/[preflight]       /'
else
  ok "port 9001 无 ESTABLISHED 连接（单槽空闲）"
fi

# ---- 4. 残留进程 ----
if pgrep -fl 'obscura serve' >/dev/null 2>&1; then
  die "残留 obscura serve: $(pgrep -fl 'obscura serve' | tr '\n' ' ')"
else ok "无残留 obscura serve"; fi

CHROME_PIDS="$(pgrep -x Chromium 2>/dev/null || true)"
if [ -n "$CHROME_PIDS" ]; then
  die "Chromium 已在运行 (pids: $(echo $CHROME_PIDS | tr '\n' ' ')) —— 可能是用户自己开的实例，轮壳拒绝触碰"
else ok "无 Chromium 进程"; fi

if pgrep -f 'run-live-vmp-replay-bridged' >/dev/null 2>&1; then
  die "残留 bridge 进程: $(pgrep -f 'run-live-vmp-replay-bridged' | tr '\n' ' ')"
else ok "无残留 bridge 进程"; fi

# ---- 5. 必需文件 ----
REQ_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
for f in \
  "$OBSCURA_BIN" \
  /Users/l9h8/obscura/.claude/skills/turnstile-verify-obscura/scripts/bridge-drive.py \
  /Users/l9h8/macOSShare/cf5s/bridged-replay/run-live-vmp-replay-bridged.mjs \
  /Users/l9h8/.claude/skills/turnstile-instrumentation-verify/scripts/turnstile-ui-state.mjs \
  /Users/l9h8/.claude/skills/turnstile-instrumentation-verify/scripts/cleared-check.mjs \
  "$CHROMIUM" \
  "$REQ_CA"; do
  if [ -e "$f" ]; then ok "存在: $f"; else die "缺失: $f"; fi
done

# ---- 6. 二进制新鲜度提示（供人工核对 serve lstart == 该 mtime） ----
ok "obscura 二进制 mtime: $(stat -f '%Sm' "$OBSCURA_BIN" 2>/dev/null || echo '?')"

if [ "$FAIL" -eq 0 ]; then echo "[preflight] ALL CLEAR"; else echo "[preflight] 环境不干净 —— 修完再开轮"; fi
exit "$FAIL"
