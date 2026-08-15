# V8 Trace — 页面脚本调用监控系统

Records what page script asks the browser for: which object, which method, the
arguments, what came back, and whether a property existed at all.

## 架构

**完全是 V8 层面的补丁，不涉及 Obscura 自身代码的修改。** Obscura 的 Rust/JS 源码
（`crates/`）未被触碰——没有 `bootstrap.js` wrapper、没有 ops、没有 CLI flags。Trace
通过 Obscura 已有的 `--v8-flags` 透传机制启用。

这样做是设计意图而非便利。JS 层的 instrumentation 与被观测的代码处于同一层，需要做
反检测并证明其不可见性；V8 内部的 hook 对页面脚本无可发现之物。同时消除了 JS wrapper
改变引擎观测值的问题——两套系统并存时，wrapper 会把 `Document.getElementById("a")`
报告成 `Document.m`，参数全部丢失。

### 涉及文件

| 文件 | 作用 |
|------|------|
| `vendor/v8-property-trace.sh` | **核心。** 以锚点插入方式直接修改 V8 源码（3 个 hook 点 + 2 个 flag） |
| `vendor/v8-trace.sh` | 便利 wrapper，封装 build / run / check 三步，防止 flag 配错或静默降级 |
| `.gitignore` | 忽略 `vendor/rusty_v8/`（数 GB 上游源码，仅通过 `--config` override 使用） |
| `docs/Trace-page-script.md` | 本文档 |

## 从零重建

### 1. 获取 V8 源码

```bash
git clone --recurse-submodules https://github.com/denoland/rusty_v8 vendor/rusty_v8
cd vendor/rusty_v8 && git checkout v137.3.0 && git submodule update --init --recursive
```

约 800 MB 源码。必须锁定 v137.3.0：项目的 `deno_core 0.350.0` 要求 `v8 = "^137.1.0"`，
而 `cargo [patch]` 必须满足原 semver 约束。默认分支（目前 v152.x）落在范围外，
Cargo 拒绝解析 patch；同时补丁锚点在 v152 上有两处失配。

验证版本：此补丁在 V8 rev `f68bbb6cda689a14d019a6a60cc93963724e7c35`
（`rusty_v8` v137.3.0 所引用的版本）上编译运行通过。

### 2. 打补丁

```bash
vendor/v8-property-trace.sh vendor/rusty_v8/v8
```

脚本用 **锚点字符串匹配** 而非行号来定位插入位置。这是故意的——不同 V8 修订版之间
行号漂移，`git apply` 会因行号对不上而拒绝；锚点在漂移后要么依然命中，要么报告清晰的
失败信息（anchor missing）。每个文件幂等：重复运行直接输出 `already patched`。

修改的三个位置：

#### a) `src/ic/ic.cc`

**插入 reporter 函数**（~300 行 C++）在 `IC::TraceIC` 定义之前。核心函数：

- `TracePropertyLookup(isolate, receiver, name, found)` — 将一次属性查找格式化为 TSV 行：
  receiver 的 JavaScript 可见构造函数名（通过 `JSReceiver::GetConstructorName`），属性名，
  HIT 或 MISS，源码位置，调用链
- `TraceCallEnter(isolate)` / `TraceCallExit(isolate, value)` — 记录函数调用和返回
- `TraceCallOrigin(isolate, ...)` — 遍历 JavaScript 栈帧，跳过引擎帧，构造调用链
- `TraceDescribeFrame(isolate, frame, ...)` — 描述单个帧：脚本名、行、列、函数名
- `TraceAppendValue(isolate, value, out)` — 无副作用的值渲染（不调用 toString/valueOf/accessor）
- `TracePropertyLookupFile()` — 惰性打开输出文件，进程退出时自动关闭

**插入调用点**在 `LoadIC::Load` 中，`LookupForRead` 之后、`use_ic` 分支之前：

```cpp
if (V8_UNLIKELY(v8_flags.trace_property_lookup)) {
  TracePropertyLookup(isolate(), receiver, name, it.IsFound());
}
```

放在 `use_ic` 之前使得它不依赖 cache-update 路径——V8 的 IC log 只在 cache-update 时
触发，因此无法记录 MISS 也无法覆盖所有 HIT。`it.IsFound()` 是 V8 完成查找后的内部答案，
从外部无法获取。

#### b) `src/runtime/runtime-test.cc`

替换 `Runtime_TraceEnter` 和 `Runtime_TraceExit` 的默认实现。V8 在 `--trace` 下本就
会调用这两个函数；默认实现打印原始 dump 到 stdout。补丁版本在配置了输出文件时写入
结构化 TSV，否则退回到原始行为。

入口和出口通过**嵌套深度**配对而非函数标识——读者将 RET 匹配到其上方的 CALL，与 V8
自身输出中缩进传达的信息相同。

#### c) `src/flags/flag-definitions.h`

添加两个新 flag：

```
DEFINE_BOOL(trace_property_lookup, false,
            "trace property lookups with receiver and resolution")
DEFINE_STRING(trace_property_lookup_file, nullptr,
              "file to write property lookup records to")
```

### 3. 编译

```bash
V8_FROM_SOURCE=1 cargo build --release -p obscura-cli --bins \
  --features render \
  --config 'patch.crates-io.v8.path="vendor/rusty_v8"'
```

首次编译约 30 分钟。`--config` 是临时的：`Cargo.toml` 不变，普通构建继续使用预编译 V8。

**这是最容易踩的坑：** 任何不带 `--config` 的 `cargo build` 或 `cargo nextest` 会
重新链接预编译 V8，**静默丢弃补丁**。此时 `obscura fetch` 仍然成功，trace 输出文件
为空——读起来像"页面什么都没做"，而不是"二进制已降级"。

### 4. 验证二进制

```bash
# 方法一：wrapper 脚本
vendor/v8-trace.sh check

# 方法二：手动
./target/release/obscura --v8-flags "--trace-property-lookup" fetch "about:blank" \
  --dump text >/dev/null 2>.v8trace-probe
grep -q "unrecognized flag" .v8trace-probe && echo "NOT PATCHED" || echo "PATCHED"
```

建议在每次 trace 运行**之前**验证而非之后——未打补丁的二进制静默生成空文件，读起来像
页面什么都没做。

### 5. 运行

```bash
# 方法一：wrapper 脚本（自动验证二进制 + 组合正确的 flags）
vendor/v8-trace.sh run /tmp/trace.tsv -- fetch https://example.com --dump text

# 方法二：手动（完整 flags）
obscura --v8-flags "--trace --trace-property-lookup --no-lazy-feedback-allocation \
  --trace-property-lookup-file=/tmp/trace.tsv" \
  fetch https://example.com --dump text -o page.txt
```

输出写入 `--trace-property-lookup-file` 指定的文件（不在 stdout，因为 stdout 属于
`--dump`）。页面内容用 `--dump text -o` 分流。

## Flag 参考

| Flag | 控制范围 | 缺失后果 |
|------|---------|---------|
| `--trace` | CALL + RET | 丢失所有函数调用和返回记录 |
| `--trace-property-lookup` | HIT + MISS | 丢失所有属性查找记录。trace 输出为空 |
| `--no-lazy-feedback-allocation` | HIT + MISS 的完整性 | CALL/RET 不受影响；属性命中从 5 降到 3，MISS 从 1 降到 0——缺失属性检测完全消失 |
| `--trace-property-lookup-file` | 输出目标 | 记录写入 `/dev/null`，trace 静默为空 |

### 不要加的 flag

**`--no-use-ic`** — 读起来像是补全 trace 的 flag，实际上做相反的事：禁用 inline cache
把所有属性加载推上 bypass 路径，完全抑制 `LoadIC::Load`。实测：30 个属性中 0 个被记录。

### `OBSCURA_TRACE_MODE=lookups`

当页面自身时序敏感时（例如等待网络往返的 challenge 页面），设置此环境变量只启
用属性查找 hook，去掉 `--trace`（call/return hook）。`--trace` 几乎占了全部性能开销——
它把每次函数进入和退出都路由到运行时。在一个 Cloudflare challenge 页面上，`--trace`
开启时页面在 deadline 前只发了 3 个请求，关闭后发了 7 个。

```bash
OBSCURA_TRACE_MODE=lookups vendor/v8-trace.sh run /tmp/trace.tsv -- \
  fetch https://example.com --dump text
```

等效于手动去掉 `--trace`：

```bash
obscura --v8-flags "--trace-property-lookup --no-lazy-feedback-allocation \
  --trace-property-lookup-file=/tmp/trace.tsv" \
  fetch https://example.com --dump text
```

## 输出格式

Tab 分隔，每行一条记录：

| 列 | 内容 |
|----|------|
| 1 | `CALL` / `RET` / `HIT` / `MISS` |
| 2 | receiver 的构造函数名（RET 上为空） |
| 3 | 属性或方法名（RET 上为空） |
| 4 | 脚本名，或 `<page-eval>`（页面通过 eval 执行的代码） |
| 5 | 行号 |
| 6 | 列号 |
| 7 | CALL 上为参数，RET 上为返回值，HIT/MISS 上为空 |
| 8 | 调用链 `func:line:col <- func:line:col`（RET 上无此列，只有 7 列） |

```
CALL  Document  getElementById  a.html  3  21  string:"a"     inner:3:21 <- outer:9:26
RET                             a.html  3  21  object:Element
MISS  Element   __missing_x__   a.html  5  14                 inner:5:14 <- outer:9:26
```

### 过滤页面记录

`HIT` 和 `MISS` 不过滤，数据量反映了这一点——一个 4 行的页面产生了 198 条引擎记录
对 46 条页面记录。因为属性 hook 没有 caller 可供筛选（call hook 通过 caller 帧判断是否
来自页面代码），bootstrap 会替页面执行大量属性查找。用第 4 列过滤：

```bash
awk -F'\t' '$4 !~ /obscura|^ext:/' trace.tsv
```

### `<page-eval>` 的含义

动态插入的脚本（challenge 和 fingerprinting payload 的传递方式）通过 eval 运行，不带
脚本名。在一个 Cloudflare 页面上 4448 条记录中有 2610 条来自 `<page-eval>`。如果
消费者将无脚本名的帧视为引擎内部帧而丢弃，恰好丢掉了最有价值的记录。

## 三个 hook 的设计理由

### 为什么必须在 V8 内部做

不存在的属性没有 accessor 可包装，所以任何 JS 层的 instrumentation 都无法看到对它的
读取。V8 的 inline-cache log 也不行：`map-details` 记录只有约 58% 携带 descriptor
array，内置原型（如 `Array.prototype`）属于不携带的那部分——`Array.prototype` 的 map
里根本没有 `map` 这个描述符。事后重构时，"描述符里没列出"和"日志从未描述那个 map"
是无法区分的。

在 `LoadIC::Load` 内部，`receiver` 和 `it.IsFound()` 是普通的局部变量。前者是真实对象，
后者是 V8 完成查找后的内部答案。

### 为什么用 `Runtime_TraceEnter/Exit` 而非自己加

V8 在 `--trace` 下已经对每次函数进入和退出调用这两个 runtime 函数，并传入整个帧
（receiver、callee、实际参数）。接管其函数体是把已有机制变成 trace 的数据源，而非
添加一个平行机制。

### 为什么按 caller 而非 callee 筛选

`getElementById` 和 `setAttribute` 定义在 `bootstrap.js` 中，所以页面调用它们时 callee
是引擎代码。如果按 callee 的脚本来筛选，几乎所有有价值的 DOM 调用都会被丢弃。
Caller 的帧才能判断"是不是页面发起的调用"。入口和出口共用同一个筛选谓词——只筛选
一个会导致 RET 与 CALL 无法配对。

## 性能代价

`--trace` 把每次函数进入和退出路由到运行时，`--no-lazy-feedback-allocation` 强制每个
函数分配 feedback vector。在 20k 元素 DOM 负载上实测：1312 ms（无 trace）vs 3207 ms
（完整 trace）。**这是诊断构建，不是生产配置。**

使用 `OBSCURA_TRACE_MODE=lookups` 去掉 `--trace` 可以大幅降低开销，代价是丢失
CALL/RET 记录。

## 限制

- **重复访问不计数** — 同一属性对同一对象形状（hidden class）的后续查找走 IC 快速路径，
  不经过 `LoadIC::Load`
- **属性读取没有值** — 值来自函数返回（RET）。一个属性被读取但从不变为调用，trace
  中没有其值
- **完全不接触属性或调用函数的页面不可见**
- **源码位置依赖 lazily-built source position tables** — 必须调用
  `EnsureSourcePositionsAvailable`，且位置来自 `frame->position()` 而非 code offset。
  两者缺一都不是 0 就是 1:1

## 故障排查

| 现象 | 原因 | 排查 |
|------|------|------|
| `unrecognized flag: --trace-property-lookup` | 二进制链接了预编译 V8，不是打过补丁的 | `vendor/v8-trace.sh check`，重新 `build` |
| trace 文件为空 | 同上；或忘了 `--trace-property-lookup-file` | 先验证二进制，再检查 flag |
| 有 CALL/RET 但没有 HIT/MISS | 漏了 `--no-lazy-feedback-allocation` | 加上该 flag |
| HIT/MISS 全都没有 | 加了 `--no-use-ic` | 去掉该 flag |
| 所有记录 line:col 都是 1:1 | 漏了 `EnsureSourcePositionsAvailable` 或用了 code offset 而非 `frame->position()` | 检查补丁是否正确应用 |
| 页面行为与无 trace 时不同 | `--trace` 开销改变了页面时序 | 使用 `OBSCURA_TRACE_MODE=lookups` |

## 调试工作流：Stealth + Trace + Proxy + 截图

完整的反检测页面诊断管线，组合 TLS 指纹伪装、V8 层调用追踪、代理出口、定时截图。

### 前置条件

```bash
# 1. 构建带 stealth feature 的二进制
V8_FROM_SOURCE=1 cargo build --release -p obscura-cli --bins \
  --features render,stealth \
  --config 'patch.crates-io.v8.path="vendor/rusty_v8"'

# 2. 代理证书。Reqable 等 MITM 代理用自签证书，需传入根证书路径。
#    证书路径取决于代理工具：
#      Reqable: ~/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt
#      其他代理: 导出 CA 证书后指定路径
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
```

### 单次抓取 + 截图 + 全量 trace

```bash
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura \
  --v8-flags "--trace --trace-property-lookup --no-lazy-feedback-allocation \
    --trace-property-lookup-file=/tmp/trace.tsv" \
  fetch https://example.com \
  --dump text \
  --proxy http://127.0.0.1:9000 \
  --stealth \
  --timeout 60 \
  --wait 30 \
  --screenshot /tmp/screenshot.png
```

关键参数：
- `--v8-flags` 必须在 `fetch` 子命令**之前**（全局选项）
- `SSL_CERT_FILE` 指向代理的 CA 证书，解决 TLS 验证
- `OBSCURA_ALLOW_PRIVATE_NETWORK=1` 允许连接 `127.0.0.1` 代理
- `--stealth` 启用浏览器指纹伪装和 TLS 指纹匹配
- `--timeout 60` 加大超时：反检测页面持续有脚本活动，需更长时间
- `--wait 30` 停留 30 秒观察页面状态变化

### CDP 定时截图（每秒一张 × 30 秒）

单张 `--screenshot` 只在等待终点截图。需要时序截图时，通过 CDP 协议控制：

```bash
# 1. 启动 CDP server
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura serve --port 9223 --proxy http://127.0.0.1:9000 --stealth &

# 2. 通过 CDP WebSocket 控制页面
#    连接浏览器级 WebSocket，用 Target.createTarget 创建页面，
#    再用 Target.attachToTarget 获取 sessionId，
#    然后循环 Page.captureScreenshot（每秒 1 次，共 30 次）
```

Python 示例：

```python
import asyncio, json, base64, websockets

BROWSER_WS = "ws://127.0.0.1:9223/devtools/browser"

async def capture_timeline(url, out_dir, count=30, interval=1.0):
    async with websockets.connect(BROWSER_WS, max_size=10*1024*1024) as ws:
        resp = await cmd(ws, "Target.createTarget",
                         {"url": "about:blank"}, msg_id=1)
        tid = resp["result"]["targetId"]
        resp = await cmd(ws, "Target.attachToTarget",
                         {"targetId": tid, "flatten": True}, msg_id=2)
        sid = resp["result"]["sessionId"]

        await cmd(ws, "Page.enable", session_id=sid, msg_id=3)
        await cmd(ws, "Page.navigate", {"url": url}, session_id=sid, msg_id=4)

        import time
        for i in range(count):
            resp = await cmd(ws, "Page.captureScreenshot",
                           {"format": "png"}, session_id=sid, msg_id=100 + i)
            data = resp["result"]["data"]
            with open(f"{out_dir}/shot-{i+1:02d}.png", "wb") as f:
                f.write(base64.b64decode(data))
            if i < count - 1:
                await asyncio.sleep(interval)
```

注：`serve` 命令不支持 `--v8-flags`。如需同时 trace 和 CDP 截图，用 `fetch --screenshot`+ `--v8-flags`（单张），或用定时截图后分析单次 trace。

### Trace 错误分析

从 trace 中提取反检测页面的错误信号：

```bash
T=/tmp/trace.tsv

# 1. 错误关键字
grep "RET" "$T" | awk -F'\t' '$4=="<page-eval>"' \
  | grep -iE "error|turnstile|fail|unsupported" \
  | awk -F'\t' '{print $7}' | sort | uniq -c | sort -rn

# 2. 不存在属性（环境探测）
awk -F'\t' '$1=="MISS" && $4=="<page-eval>"' "$T" \
  | while IFS=$'\t' read type rcv prop script ln col val stack; do
      echo "recv=$rcv  prop=$prop  line=$ln:$col  stack=$stack"
    done

# 3. 资源加载记录
grep "set src" "$T" | awk -F'\t' '$1=="CALL"' \
  | awk -F'\t' '$4 !~ /obscura|^ext:/' | awk -F'\t' '{print $7}'

# 4. 网络请求（XHR/fetch）
grep -E "XMLHttpRequest|open.*POST|send" "$T" \
  | awk -F'\t' '$4=="<page-eval>" && $1=="CALL"'

# 5. Turnstile/Cloudflare 挑战状态码
grep "cf_chl" "$T" | awk -F'\t' '$1=="RET"' \
  | awk -F'\t' '{print $7}' | sort | uniq -c | sort -rn

# 6. 统计脚本来源
cut -f4 "$T" | sort | uniq -c | sort -rn | head -15
```

### 诊断信号对照表

| Trace 信号 | 含义 | 排查方向 |
|-----------|------|---------|
| `script error` | 跨域脚本异常，通常由 TLS 指纹不匹配导致资源加载失败 | 确认 `--stealth` 已启用 |
| `[Turnstile] Unhandled error:` | Turnstile widget 未初始化 | TLS 层已过，检查 JS 环境 |
| `Window.turnstile` MISS | Turnstile API 未挂载到全局 | `api.js` 加载后环境检测拒绝初始化 |
| `orc-onerror` | Turnstile Orchestrator 错误回调 | 挑战流程在某阶段失败 |
| `cf_chl_rc_ni` | Cloudflare 判定 "Not Interested" | 挑战彻底未通过 |
| `unsupportedbrowser` | Cloudflare 标记浏览器不支持 | 检查 User-Agent 和 feature detection |
| `challenge.supported_browsers` 高频出现 | 挑战在反复验证浏览器兼容性 | 页面持续轮询等待通过 |
| `<page-eval>` 占主导 (>99%) | 几乎所有代码通过 eval 注入 | 反检测 payload 的正确形态 |
| 截图持续不变 | 页面卡在某一状态 | 挑战未通过，脚本阻塞或死循环 |

### 实战：zencare.co Cloudflare 5 秒盾

```bash
# 全量诊断命令
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura \
  --v8-flags "--trace --trace-property-lookup --no-lazy-feedback-allocation \
    --trace-property-lookup-file=/tmp/zencare-trace.tsv" \
  fetch https://zencare.co/1.txt \
  --dump text \
  --proxy http://127.0.0.1:9000 \
  --stealth \
  --timeout 60 \
  --wait 30 \
  --screenshot /tmp/zencare.png
```

非 Stealth vs Stealth 对比：

| 维度 | 无 Stealth | 带 Stealth |
|------|-----------|-----------|
| TLS 指纹 | 不匹配 | 匹配 |
| 关键错误 | `script error`, `Turnstile Unhandled error` | `Window.turnstile` MISS, `cf_chl_rc_ni` |
| 挑战资源加载 | 未加载 | 已加载（`api.js` 等全部 fetch 成功） |
| iframe | 创建但未 append 到 DOM | 创建但 Turnstile 初始化失败 |
| 截图 | 32KB，转圈动画 | 56KB，widget 部分渲染 |
| 失败层 | TLS | Javascript 环境检测 |
| XHR 验证请求 | 未发送 | 已发送 POST `/cdn-cgi/.../fo/...` |
| 结论 | TLS 指纹被拦截 | Stealth 过了 TLS，但 JS 环境仍被拒绝 |

这表明 Cloudflare 的检测分**两层**：
1. **TLS 层** — `--stealth` 可以解决
2. **JS 环境层** — 即使 TLS 和 API 调用都正确，Turnstile 内部的环境检测仍可能拒绝非标准浏览器

## 2026-08-15 升级：引擎脚本过滤 + 异步写队列

补丁 v2（`TraceEnqueueLine` 特征）：两个改动，兼容旧树（升级重打就地拼接，见脚本内
"Pre-queue patch present" 分支）。

### 1. 全量 `--trace` 模式自动跳过引擎脚本

`--trace` 开启时，HIT/MISS 记录跳过以 `<` 开头（timer wakeups、frame bootstraps、
注入 shim）及 `ext:`/`deno:` 前缀的脚本——CALL/RET 早已通过 `TraceDescribeFrame`
的同款谓词过滤，HIT/MISS 此前没有。效果（zencare 挑战页实测）：816 万行 → 176 万行
（-78%），`<obscura:timer-wake>` 从 676 万行 → 0。

**lookups 模式（`--trace` 关）不过滤**：引擎证据（如 PAT-API 的 bootstrap 自检）量小
且有时正是排查目标。

### 2. 队列异步写

记录行在主线程 append 到 1 MiB 分块缓冲，满块 swap 给后台 writer 线程 fwrite；
writer 落后时主线程条件变量等待（背压，内存有界）；`atexit` 注册 flush + join。
格式化仍在主线程（V8 对象只能在 isolate 线程渲染）。

实现注意（重打补丁时易踩）：

- 全局锁/条件变量必须 **`new` 成指针**——全局对象触发 Chromium
  `-Wexit-time-destructors` 编译失败
- `condition_variable::wait` 需要 `unique_lock`，不是 `lock_guard`
- 前向声明 `TraceWriterLoop`/`TraceShutdown`（`TraceEnqueueLine` 引用它们）
- `TraceCallEnterEnabled`/`TraceCallEnter`/`TraceCallExit` 定义在匿名 namespace 之外，
  升级替换时以 `\n\nbool TraceCallEnterEnabled()` 为尾锚点拼接，避免与旧尾部重复

### 3. 边界（实测确认）

- **挑战页的全量 `--trace` 依然不可用**：过滤后 chl_page JSVMP 仍执行 176 万次调用
  而未走到 822KB 请求（对比 lookups 模式 8s 全链）。瓶颈是 V8 `--trace` 的每函数进出
  runtime 路由 + `--no-lazy-feedback-allocation`，非补丁写入成本。时序敏感页面的
  trace 仍用 lookups 模式。
- **trace 文件可能含非法 UTF-8 字节**（JSVMP 的二进制字符串参数经 `TraceAppendValue`
  原样写入）。`awk`/`cut` 会报 `Illegal byte sequence`，用 `LC_ALL=C` 或 `grep -a`。
- 队列在 `--trace-property-lookup-file` 未配置时不启动 writer（gate 不变）。
