---
name: turnstile-verify-obscura
description: >
  验证 cf5s warm-fiddle / ov2 的 `window.external.tracelog` 插桩改动在 obscura
  上仍然能通过 Turnstile 挑战、且新插桩 key 真的落到 obscura 的 tracelog 文件。
  与用户 Chromium 侧的 turnstile-instrumentation-verify 同构（同一验证环，
  驱动端换成 obscura serve + CDP），两者判定独立。当用户说「obscura 侧也验一下
  插桩 / obscura 跑一遍 verify / 插桩改动会不会破坏 obscura 的解题 / obscura 的
  tracelog 落没落盘」时使用；也给刚改完 ov2/warm-fiddle 插桩的自己用。
---

# obscura 侧插桩验证环

与 `~/.claude/skills/turnstile-instrumentation-verify`（用户 Chromium）同构的单发
验证环：起 obscura serve → 经 9000 代理打开 harness 页 → cf5s bridge 下发 render
→ 轮询到终态 → 检查 tracelog。**两边判定独立**：Chromium 过了不代表 obscura 过
（obscura 对拍至今层 2 未过；harness 页是 challenge-exempt、widget 独立解，是
obscura 有成功先例的形态）。

**失败先分「基线本来就不过」还是「插桩破坏」**：首次使用本 skill、或 ov2 大改之后，
先用干净 ov2（cf5s 里临时 stash 插桩）跑一轮 obscura 基线并记下结果；verify 失败时
与基线对照，不许把基线缺陷记到插桩头上。

参考基线（2026-10-07 首测，现网插桩 `23692da`/`96ea15e`）：obscura bridge 形态两轮
一致 `error-callback 600010`（与全页对拍的层 2 状态同源，非插桩破坏、非 flake）；
trace 只落 `csp.gate` / `apicom` / `payloadJSON`，**没有 Chromium 侧那批
`vmp.deobf.*` 插桩 key**——obscura 侧 ov2 VM 的插桩面与 Chromium 不同，判定「新
key 是否落盘」时先看这批 obscura 实际会落的 key，`vmp.deobf.*` 缺失本身不是本轮
失败信号。基线值随对拍推进更新，不要拿这行当永久事实。

## 前置检查（缺一项就停，报告用户，别自行修）

```bash
nc -z 127.0.0.1 9000 && echo proxy-OK        # Reqable 采集层，页面流量都走它
nc -z 127.0.0.1 9001 && echo fiddle-OK       # warm-fiddle node server，bridge 与页面在此会合
pgrep -fl 'obscura serve' || echo no-stale-serve
ls /Users/l9h8/macOSShare/cf5s/bridged-replay/run-live-vmp-replay-bridged.mjs
```

- **9001 不在 = 页面 harness 的 ws 连不上 server**，bridge 下发无人接，本轮必超时。
- **目标端口上有会话外遗留的旧 serve**：新 serve 静默绑定失败，探针打在旧代码上。
  启动后必须用 `/json/version` 的版本号 + 进程 `lstart` 与二进制 mtime 核对（见坑表）。
- **二进制必须是 render + stealth 的 release 构建**（`--features render`，
  `--config vendor/v8-source.toml`，即默认 feature 组合）。非 stealth 构建在 TLS
  握手就被分流，「断点」是构建缺陷不是页面行为。

## 固化轮壳（首选：一键跑完单轮）

下面「单轮验证」的全部步骤已固化为 `scripts/run-obscura-round.sh <tag>`——md5 守卫
preflight、一次性 storage、serve、drive、bridge、fail-fast 收口、归档、判定一次跑完。
Chromium 对拍伴生：`scripts/run-chrome-round.sh <tag>`（同构，按
turnstile-instrumentation-verify 流程，cleared-check 优先于 widget 状态轮询）。
产物：`<产物根>/traces/{obscura,chrome}-<tag>.jsonl` + `<产物根>/reports/` 全套日志
（trace-summary 输出在其中）。

- 必须先 `export OV2_EXPECTED_MD5=<期望值>`；不匹配 = 拒绝开轮（绝不自行拉取 ov2）。
- 产物根默认 `/private/tmp/cf-parity-1007`，可用 `CF_PARITY_ROOT` 覆盖。
- 退出码：0=过（obscura 双信号 / chrome passed-404·success）；1=fail/timeout；2=SKIP（端口或 Chromium 被占）；3=守卫未过。
- 轮壳对**新构建二进制的首次 exec 冷启动**不宽容（serve 就绪窗口 2s）：首次跑失败先看 serve 日志，重跑即过。
- 要改流程或排查细节时，仍按下面「单轮验证」手动逐条执行。

## 单轮验证

固定值（模板可直接用，变了才替换）：

```bash
ROOT=/Users/l9h8/obscura
CF5S=/Users/l9h8/macOSShare/cf5s
BIN=$ROOT/target/release/obscura
DRIVE=$ROOT/.claude/skills/turnstile-verify-obscura/scripts/bridge-drive.py
PORT=9311
TRACE=/tmp/obscura-verify-trace.jsonl
SERVE_LOG=/tmp/obscura-verify-serve.log
BRIDGE_LOG=/tmp/obscura-verify-bridge.log
TARGET_URL="https://www.thelancet.com/123.txt"
SITEKEY=0x4AAAAAAADnPIDROrmt1Wwj
REF_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
```

### Step 1 — 擦 trace（冷 trace）

```bash
: > "$TRACE"        # : > 而非 echo "" >：后者写进的空行会污染 JSONL 解析
```

### Step 1b — 冷存储

obscura 没有 Chromium 那种 profile 目录要擦；对应物是 **每轮一次性 `--storage-dir`**。
harness 逐轮带出 `cf_clearance`、per-site 状态会造成「上轮的余温污染本轮判定」
（Chromium 版用擦 `Default/` 解决，这里用空 storage-dir 解决，二者不可省）：

```bash
STORAGE=$(mktemp -d /tmp/obscura-verify-storage.XXXXXX)
```

### Step 2 — 后台起 obscura serve

```bash
OBSCURA_TRACELOG_FILE="$TRACE" \
SSL_CERT_FILE="$REQABLE_CA" \
OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  nohup "$BIN" serve --port "$PORT" --proxy http://127.0.0.1:9000 --stealth \
    --user-agent "$REF_UA" --storage-dir "$STORAGE" \
    >"$SERVE_LOG" 2>&1 &
disown
SERVE_PID=$!
sleep 2
curl -s "http://127.0.0.1:$PORT/json/version" | head -3   # 起来了、且是本轮这个二进制
grep -m1 'fingerprint\|tracker' "$SERVE_LOG"              # stealth 确认在跑
```

- `OBSCURA_TRACELOG_FILE` 即 `window.external.tracelog` 的 sink（`--tracelog-file`
  flag 的 env 形态，二者等价）。
- `OBSCURA_ALLOW_PRIVATE_NETWORK=1` 必带：harness 页（https）要连 `ws://127.0.0.1:9001`
  回 warm-fiddle server，SSRF 门默认拦 loopback。
- `--user-agent` 必带：默认指纹与参照 Chrome 不同步时，从第一步就在错误基线上跑。
- **verify 轮不开 `--trace` / `--trace-op-file`**：全量 trace 把质询拖出时间窗，
  提交体都拿不到。要落盘的只有 `--tracelog-file` 这一个。

### Step 3 — 后台起页面驱动（导航 + 轮询 + 自动点击）

```bash
cd "$ROOT"
nohup python3 -u "$DRIVE" --port "$PORT" --url "$TARGET_URL" --deadline 120 \
  >"$DRIVE_LOG" 2>&1 &        # DRIVE_LOG=/tmp/obscura-verify-drive.log
disown
DRIVE_PID=$!
sleep 8                       # 页面加载 + api.js 就绪 + harness ws 连上 9001
grep -m2 'harness:' "$DRIVE_LOG"   # 期望 ws: open / turnstile: ready
```

驱动脚本轮询 harness DOM（`#render-count`、`#status`），widget 需要交互时自动点击
（最多 3 次）。`ws:` 始终不是 `open` 说明页面没接上 fiddle server，先修环境再谈插桩。
日志必须逐行实时可读：脚本内置 `flush=True`，且启动固定带 `-u`——二者缺一，
nohup 到文件的 stdout 会块缓冲，live 读起来是空日志，误判成「没跑起来」。

### Step 4 — 后台起 bridge 下发 render

```bash
cd "$CF5S"
nohup node bridged-replay/run-live-vmp-replay-bridged.mjs \
  --send --bridge-sitekey="$SITEKEY" >"$BRIDGE_LOG" 2>&1 &
disown
BRIDGE_PID=$!
```

- **必须从 `$CF5S` 目录起**，别处起是 `MODULE_NOT_FOUND`，页面 `renders: 0`，
  整轮假失败（Chromium 侧 2026-10-07 踩过）。
- bridge 日志的权威信号：`req#N sending render …`（下发）与
  `req#N TOKEN len=… head=…`（token 回流）。
- bridge 会自动把等待 bump 到 ~35s（`THELANCET_TURNSTILE_*_DELAY_MS`），obscura 又
  比 Chrome 慢，所以 Step 3 的轮询预算给 120s 起步。

### Step 5 — 等驱动到终态

```bash
wait "$DRIVE_PID"; DRIVE_RC=$?     # 0 = success（#status 出现 callback token len=）
tail -20 "$DRIVE_LOG"
grep 'TOKEN len=' "$BRIDGE_LOG"    # 双信号：bridge 侧 token 回流
```

两个信号都有才算过：drive 侧看页面（token 真进了 widget callback），bridge 侧看
回流（token 真交回了 harness）。只有 bridge 行而页面没有 → 检查是不是上一轮的
日志没清；只有页面没有 bridge 有 → 不应发生，当 bug 报。

### Step 6 — cooldown 后收尾

tracelog 是后台线程批量写、serve 退出路径上才 `flush()`，**kill -9 会丢尾部记录**：

```bash
sleep 5
kill "$SERVE_PID" 2>/dev/null; sleep 2
kill -9 "$SERVE_PID" "$DRIVE_PID" "$BRIDGE_PID" 2>/dev/null || true
```

### Step 7 — 检查 trace.jsonl

与 Chromium 版同一套看法：别 grep 硬编码 marker，把 k 分布和首尾样本摆出来：

```bash
python3 - "$TRACE" <<'EOF'
import json,sys,collections
data=open(sys.argv[1],'rb').read().decode('utf-8',errors='replace')
dec=json.JSONDecoder(); i=0; recs=[]
while i<len(data):
    while i<len(data) and data[i] in ' \n\r\t': i+=1
    if i>=len(data): break
    try: obj,i=dec.raw_decode(data,i); recs.append(obj)
    except Exception as e: print('parse stop at',i,e); break
print('records:',len(recs))
print('k counts:',dict(collections.Counter(r.get('k') for r in recs)))
print('--- first 3 ---')
for r in recs[:3]: print(json.dumps(r,ensure_ascii=False)[:200])
print('--- last 5 ---')
for r in recs[-5:]: print(json.dumps(r,ensure_ascii=False)[:200])
EOF
```

对调用者声明的「本轮新 key」，确认它出现在 k 分布里。

## 判定

| Step 5 结果 | Step 7 trace 判定 | 结论 |
|---|---|---|
| success（双信号） | 新 key 在、无洪泛 | PASS |
| success | 新 key 缺 / 洪泛 | 解题没坏，但插桩有 bug——标给调用者 |
| timeout / 失败 | 任意 | FAIL——跑第二轮 |

- **单发轮**。失败跑第二轮；**连续两轮失败才**下「插桩破坏了解题」的结论并建议
  回滚，不要自行 `git checkout`（调用者知道改了哪些 hunk）。
- **连续失败先查基线**：obscura 基线轮是否本来就能过？基线不过 → 引擎问题，
  走 obscura-challenge-probe 的诊断流程，不是插桩问题。
- trace 空但解题过了：sink 路径没生效（`OBSCURA_TRACELOG_FILE` 拼错、目录不存在），
  查 `$SERVE_LOG` 开头的 tracelog 初始化行。

## 已知坑（测量盲区，都是踩过的）

| 坑 | 后果 | 对策 |
|---|---|---|
| 目标端口残留旧 serve | 新 serve 静默 bind 失败，探针打旧代码，跨轮对比全错 | 每轮核对 `/json/version` 版本号 + `ps -o lstart` vs 二进制 mtime |
| bridge 从非 cf5s cwd 起 | `MODULE_NOT_FOUND`，`renders: 0`，假失败 | 固定 `cd "$CF5S"`；verify 前置检查里有文件存在性断言 |
| 非 stealth / lean 构建 | TLS 握手即分流，「obscura 过不了」是构建缺陷 | 只用默认 feature 组合的 release 二进制 |
| UA 不对齐参照 | `navigator.userAgent` 从第一步就错，失败原因失真 | `--user-agent "$REF_UA"`，版本跟参照 Chrome 走 |
| verify 轮开全量 `--trace` | 页面任务被 task budget 杀掉，提交体拿不到 | verify 只带 `--tracelog-file` |
| `kill -9` serve | tracelog 后台线程未 flush，尾部记录丢失，误判「新 key 没落盘」 | 先 TERM 等 2s，再 -9 |
| storage 复用 | 上轮 `cf_clearance`/site 状态污染本轮，失败原因失真 | 每轮一次性 `--storage-dir` |
| 9001 的 browser-fiddle 单槽被上一轮死连接占着（`warm-fiddle-bridge.mjs` 是单槽设计、无心跳） | 新页面 `bridge closed code=1000 reason=rejected` 且不重连，`renders: 0`，render 无人接 | 轮间杀干净 serve 后核对 `lsof -i:9001` 无 ESTABLISHED 再开下一轮；仍拒就重启 warm-fiddle-bridge.mjs |
| python 驱动脚本 nohup 到文件 | stdout 块缓冲，live 读是空日志，误判「没跑起来」 | 脚本内 `flush=True` + 启动带 `-u`（已内置） |
| 轮询预算照抄 Chromium 版（30s） | bridge 自带 ~35s 等待 + obscura 更慢，永远超时 | deadline ≥120s |
| 多行表达式 `Runtime.evaluate` | obscura 静默返回 undefined，读作「页面没挂」 | 探针一律单表达式 / 单行 IIFE |

## 与 Chromium 版的分工

| | turnstile-instrumentation-verify（Chromium） | 本 skill |
|---|---|---|
| 驱动端 | 用户 Chromium，CDP 9222 | obscura serve，CDP `--port`（默认 9311） |
| 冷态 | 擦 `Default/` + 建 tracelog 目录 | 一次性 `--storage-dir` + `: > "$TRACE"` |
| 页面探针 | `turnstile-ui-state.mjs` / `cleared-check.mjs` | `scripts/bridge-drive.py`（harness DOM + 自动点击） |
| 成功信号 | widget `state:success` 或触发 URL 404 | `#status` `callback token len=` + bridge `TOKEN len=` 双信号 |
| trace sink | `$PROFILE_DIR/Default/tracelog/trace.jsonl`（固定） | `OBSCURA_TRACELOG_FILE`（自定路径） |
| 基线 | Chromium 基线已知可过 | obscura 基线要单独确认（见顶部） |
