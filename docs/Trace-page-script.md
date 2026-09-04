# V8 Trace — 页面脚本调用监控系统

## Native iv8 API trace

Obscura also supports a native iv8-style access monitor. It is implemented in
the Rust/V8 `ObjectTemplate` and callback layer and does not install JavaScript
Proxy wrappers or instrument page bytecode:

```bash
obscura --trace-api-file /tmp/iv8-api.log fetch https://example.com --dump text
```

Use `--trace-api-ignore navigator.userAgent,window.document` for iv8-style
exact path filtering. The equivalent environment variables are
`OBSCURA_TRACE_API_FILE` and `OBSCURA_TRACE_API_IGNORE`.

The output is line-oriented and follows iv8's monitor format:

```text
实例访问 - navigator.userAgent -> getter -> string:"..."
实例访问 - navigator.__missing__ -> getter -> undefined
实例访问 - navigator.userAgent -> setter -> setter(string:"...") -> undefined
实例访问 - document.querySelector -> call -> (string:"#app") -> [object Element]
```

The monitor is independent of the historical V8 `--trace`/property-trace
patches. It works with the normal V8 binding; a source build is only needed for
the separate `document.all` rusty_v8 extras. `vendor/v8-trace.sh build` is a
convenience source-build wrapper, not a runtime prerequisite.
Browser method calls are emitted by native callback trampolines with
their arguments and return value. `--trace-api-watch` plus
`--trace-api-devtools` follows iv8's two-step watch/breakpoint gate.

When native tracing is enabled, Obscura creates the main and frame contexts
with a native global `Window` template and executes the same bootstrap source
instead of loading the startup snapshot. This is what makes missing
`window.*` names observable without a JavaScript `Proxy`; normal runs retain
the snapshot fast path. Worker contexts use the same global template hook.

Records the browser properties that page script reads or writes, including the
receiver, property name, resolved value, and whether a lookup existed.

## 架构

**核心监控在 native 对象层实现。** Obscura 的 CLI 只负责设置 trace 文件
路径；runtime 在每个 realm 创建带 named getter/setter/query handler 的真实
`ObjectTemplate` 对象，并用 native callback trampoline 记录方法调用。页面
没有收到 Proxy 或字节码注入。

这样做是设计意图而非便利。拦截器安装在真实 V8 `ObjectTemplate` carrier 上，观察的是
页面最终使用的对象，而不是改写页面字节码；native trampoline 保留原 receiver、参数和
返回值。安装只在显式 trace 文件启用时发生，普通运行路径不创建 carrier。

### 涉及文件

| 文件 | 作用 |
|------|------|
| `vendor/v8-trace.sh` | 便利 wrapper，封装 build / run / check 三步，防止 flag 配错或静默降级 |
| `vendor/v8-source.toml` | `--config` 加载的 override 文件，同时携带 `[patch.crates-io]` 的 v8 路径与 `V8_FROM_SOURCE=1` |
| `.cargo/config.toml` | `cargo v8-build` / `v8-build-lean` / `v8-check` / `v8-test` 四个别名，封装上面的 `--config` |
| `.gitignore` | 忽略 `vendor/rusty_v8/`（数 GB 上游源码，仅通过 `--config` override 使用） |
| `docs/Trace-page-script.md` | 本文档 |

## 构建与运行

`vendor/rusty_v8/` 是被忽略的上游源码。只有需要 source-only bindings（例如
`document.all`）时才执行：

```bash
vendor/v8-trace.sh build
```

该命令会运行 `vendor/v8-rusty-extras.sh`，并使用
`--config vendor/v8-source.toml` 从源码编译 V8。普通 native trace 运行不需要
重新 patch 或重新编译。

运行与检查：

```bash
vendor/v8-trace.sh check
vendor/v8-trace.sh run /tmp/iv8-api.log -- \
  fetch https://example.com --dump text
```

也可以直接使用 CLI：

```bash
obscura --trace-api-file /tmp/iv8-api.log \
  fetch https://example.com --dump text
```

`--trace-api-file` 和 `OBSCURA_TRACE_API_FILE` 只打开 native monitor；不修改
V8 flags，也不关闭 inline cache。ObjectTemplate interceptor 在 cache 命中和
缺失路径上都可观察到访问。

## 输出

每行一条有序记录：

```text
实例访问 - navigator.userAgent -> getter -> string:"..."
实例访问 - navigator.missingApi -> getter -> undefined
实例访问 - navigator.userAgent -> query -> exists
实例访问 - navigator.__traceValue -> setter -> setter(number:1) -> undefined
实例访问 - document.querySelector -> call -> (string:"#app") -> [object Element]
```

记录来源于 native ObjectTemplate interceptor 和 callback trampoline。调用期间的参数、
返回值和异常都会记录；`--trace-api-ignore` 支持逗号分隔的精确路径过滤。

## 设计边界

- 不修改页面对象身份，不注入 JavaScript `Proxy` 作为 trace 机制。
- 安装期和引擎内部 helper 调用会被 per-isolate suppression 排除。
- `then` 探测和 ECMAScript 标准对象不会混入 browser API trace。
- native trace 不依赖 V8 source patch；`--config vendor/v8-source.toml` 只决定
  是否使用 source V8 和 `document.all` extras。

## 调试工作流：Stealth + Native Trace + 网络代理 + 截图

本节保留历史诊断记录；当前 trace 入口统一使用上面的 native iv8
`--trace-api-file`/`vendor/v8-trace.sh run`，不再使用旧的
`--trace-property-lookup` 或 `--trace` flags。

完整的反检测页面诊断管线，组合 TLS 指纹伪装、V8 层调用追踪、代理出口、定时截图。

### 前置条件

```bash
# 1. 构建带 stealth feature 的二进制（stealth 是默认 feature，无需显式列出）
cargo build --release -p obscura-cli --bins \
  --features render \
  --config vendor/v8-source.toml

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
  --trace-api-file /tmp/trace.log \
  fetch https://example.com \
  --dump text \
  --proxy http://127.0.0.1:9000 \
  --stealth \
  --timeout 60 \
  --wait 30 \
  --screenshot /tmp/screenshot.png
```

关键参数：
- 全局参数（包括 `--trace-api-file`、`--v8-flags`）放在子命令之前最清晰；CLI 也接受已声明为 global 的参数放在子命令后
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

注：`--v8-flags` 是全局参数，启动 CDP 时使用
`obscura --v8-flags "..." serve ...`。`serve` 的每个页面会继承同一组启动 flags；多 worker
场景也应通过全局参数或 `OBSCURA_V8_FLAGS` 传递。

### Trace 错误分析

native trace 是一行一条的文本，不再是旧 `--trace` 的 TSV。可以这样提取常用信号：

```bash
T=/tmp/trace.log

# 命中、缺失、查询、写入和方法调用
grep -E -- ' -> (getter|query|setter|call) -> ' "$T"
grep -E -- ' -> getter -> undefined$' "$T"                    # 缺失 API
grep -E -- ' -> call -> ' "$T" | grep -Ei 'xhr|fetch|send|post' # 相关方法调用
grep -E -- '^(实例访问|原型访问) - ' "$T" | head -100
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
  --trace-api-file /tmp/zencare-trace.log \
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

## 历史记录：旧 V8 `--trace` writer（不适用于 native iv8 trace）

以下内容只记录旧版本的实验结果。当前实现不再安装这些 `--trace`/TSV writer hook，
请使用本文前面的 `--trace-api-file` 和逐行 native iv8 输出。

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
- 当前 native trace 不使用旧的 `--trace-property-lookup-file` writer。
