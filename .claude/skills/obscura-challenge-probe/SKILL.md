---
name: obscura-challenge-probe
description: >
  诊断 obscura 跑不通某个页面的原因——尤其是 Cloudflare Turnstile / 5 秒盾这类
  依赖 iframe、closed shadow root、跨源 postMessage 与 realm 隔离的反检测质询。
  提供带 stealth + 代理 + V8 trace 的复现命令、CDP 预注入探针（拿 postMessage
  完整内容、穿透 closed shadow root 找 iframe）、跨 realm 的通信与请求钩子
  （XHR/fetch/sendBeacon + 调用栈，定位「哪条消息触发了哪个请求」）、frame realm
  相对 URL 归属探针、与浏览器 HAR 逐条对比，以及把 Chrome 解密 payload 的枚举面
  （navigator/document/screen 属性名清单）与 obscura 逐一对拍的方法。当用户问「obscura 为什么
  过不了这个盾 / iframe 里的 JS 有没有执行 / 挑战卡在哪一步 / 这个请求是谁发的 /
  帮我分析这个 HAR / 用 v8 trace 看看页面在干什么」时使用本技能。
---

# obscura 质询页诊断

回答三个问题：**①卡在哪一步？②是 obscura 的缺陷还是页面的正常行为？③下一步查什么？**

方法论比脚本重要——这类排查里**最容易出错的是观测手段本身**，本文档大半篇幅在讲
怎样不被自己的探针骗到。完整案例见 `docs/Cloudflare-challenge-profile.md`。

## 维护 profile 文档（边查边写）

每个目标站维护一份 profile 文档（模板即 `docs/Cloudflare-challenge-profile.md`），
它是这次排查的**唯一事实源**，不是收尾时补的总结。规则：

- **逐 step 追加，不要攒到最后写。** 每个 step 记四样：**假设 / 方法 / 证据 / 结论**。
  当前正在验证的假设也先落成一个 step，结果出来再补「证伪 / 证实」——过程本身就是资产。
- **每次有效修复立刻写入。** 定位到真因并改掉后，新开一个 step 记：改了什么、
  提交号、修复前后的可量化对比（如 CDP 时间线的事件时刻）、以及配套回归测试的位置。
  没有量化对比的「修复」不算数——它可能只是换了个症状。
- **被证伪的假设一律保留**，标注「证伪」。它们标出了不必再走的路，比结论更省后人时间。
- **观测手段自身的坑记进「测量盲区」表。** 凡是因为探针失真得出过错误结论的，
  连同正确做法一起记——这是本类排查最高频的返工来源。
- **文档顶部维护「当前状态」一行**（通过 / 未通过 + 卡在哪一步），和「未决」清单，
  让任何时候接手的人一眼看到战线在哪。

一句话：**修复先进文档，再进代码**——先把「假设→证据→结论」写清楚，改动才算闭环。

## 前置

```bash
# 探针脚本实际位于 .claude/skills/obscura-challenge-probe/scripts/。
# 以下命令均从仓库根执行，用 $SKILL_DIR 定位脚本：
SKILL_DIR=".claude/skills/obscura-challenge-probe"

# 本技能只在 render + stealth 上有效，也就是当前的默认 feature 组合。
# stealth 已在 default 里，所以 --features render 就拿到两者；--config 一并
# 带上 V8 patch 与 V8_FROM_SOURCE=1（等价于别名 `cargo v8-build`）。
cargo build --release -p obscura-cli --bins \
  --features render \
  --config vendor/v8-source.toml

# MITM 代理的 CA 证书（本机 Reqable 路径；换工具/机器时替换为你的 CA）
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
```

**代理跑在别的机器/端口时，先信任代理 CA。** 本机 Reqable 的 CA 就是 `REQABLE_CA`。若代理在
局域网另一台机器（如 `http://192.168.3.57:9000`），正确下载点是**经该代理访问**
`http://cert.reqable.com/ca`（拿到 `CN=Reqable CA`）。两个坑：`http://mitm.it/cert/pem` 返回
占位 mitmproxy 证书、`http://reqable.com/ssl` 会被 EdgeOne 拦成 567，都不是代理实际用于 MITM
的 CA，用错会 `CERTIFICATE_VERIFY_FAILED`。下载后装进 keychain，并把 `SSL_CERT_FILE` 指过去：

```bash
curl -x http://192.168.3.57:9000 http://cert.reqable.com/ca -o /tmp/reqable-ca.crt
openssl x509 -in /tmp/reqable-ca.crt -noout -subject   # 确认 CN=Reqable CA，而非 mitmproxy
security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain-db /tmp/reqable-ca.crt
export SSL_CERT_FILE=/tmp/reqable-ca.crt
```

**不要用 `cargo v8-build-lean`、`--no-default-features` 或任何去掉 stealth 的
变体做质询诊断。** 质询在握手阶段就看 TLS 指纹，在首个请求就看 User-Agent：
非 stealth 二进制走的是 rustls + `DEFAULT_USER_AGENT`，根本到不了质询逻辑本身。
那种构建跑出来的「断点」是构建缺陷，不是页面行为——按它去改代码，改的是不
存在的问题。

**每轮实测前先自查当前二进制**（这行日志默认不打印，必须显式开 `RUST_LOG`；
target 是 bin 名 `obscura`，写 `obscura_cli` 匹配不到）：

```bash
RUST_LOG=info ./target/release/obscura serve --port 9299 --stealth 2>&1 | grep 'Stealth mode'
```

```
Stealth mode enabled (TLS fingerprint impersonation + tracker blocking)   ← 正确
Stealth mode enabled (tracker blocking)                                   ← 缺 stealth，重新构建
```

两行都由 `--stealth` 触发，差别只在编译期：后者说明二进制里没有 wreq 传输，
此时 `--stealth` 只剩 tracker 拦截。`target/release/obscura` 常被其他构建（Docker
验证、release 变体、`v8-build-lean`）覆盖成非 stealth 版本，且覆盖后毫无提示，
所以这一步不能省。

**探针脚本用 Python `websockets` 连 CDP。** 仓库根没有固定 Python 环境，用 uv 建临时 venv
（`uv venv /tmp/probe-venv --python 3.13 && uv pip install --python /tmp/probe-venv/bin/python websockets`），
之后所有脚本用 `/tmp/probe-venv/bin/python` 跑；裸 `python3` 会 `ModuleNotFoundError`。

**质询诊断前必须对齐 UA 到参考 Chrome。** 默认 stealth 指纹硬编码 Windows Chrome 145/146
（`fingerprint.rs` 的 `DEFAULT_USER_AGENT`、`wreq_client.rs` 的 `STEALTH_USER_AGENT`），而参考
Chrome（你导 HAR/payload 的那台）很可能是 macOS Chrome 149。UA 错配会让 `navigator.platform`
/`userAgent`/`appVersion` 从第一步就对不上，后续对拍全跑在错误基线上。`serve` 与 `fetch` 都
支持 `--user-agent`，显式对齐：

```bash
REF_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
obscura serve --port 9223 --proxy http://127.0.0.1:9000 --stealth --user-agent "$REF_UA"
```

对拍前用 `Runtime.evaluate` 自查 `navigator.platform`/`navigator.userAgent` 与参考一致，
否则你看到的差异是 UA 没对齐，不是引擎行为。

## 第一步：与浏览器 HAR 对比

**先做这一步。** 拿真实浏览器过一遍同一 URL 导出 HAR，再让 obscura 跑一遍，
逐条比请求序列。差异出现的位置就是断点，比任何猜测都准。

```bash
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura fetch <URL> --dump text --proxy http://127.0.0.1:9000 --stealth \
  --timeout 35 --wait 35 --screenshot /tmp/run.png
```

**超时封顶 35s，别等更久。** Cloudflare 在首轮质询没过时会触发一次二次刷新
（重新导航、重发质询），把 wait 拉到 40s+ 只会等到这一轮无意义的重来，既不产生
新信息，还让每次观测多花一倍时间。首轮 35s 内没出结果，就是没过——去看断点，
而不是加时间。

对每条差异请求看三样：**主机对不对、状态码、Origin 头**。

- Origin 正确但主机错 → 代码在正确的 realm 里跑，但相对 URL 解析基准错了
- 请求整条缺失 → 上游某步没触发（iframe 没导航、脚本没执行、回调没来）

## 第二步：CDP 预注入探针

`--eval` 在页面脚本**之后**运行，而质询代码加载时就缓存了原生方法引用，
那时挂钩已经晚了。必须用 `Page.addScriptToEvaluateOnNewDocument`。

```bash
# 起 CDP server
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura serve --port 9223 --proxy http://127.0.0.1:9000 --stealth &

# postMessage 完整内容 + 时间线 + 页面错误
$SKILL_DIR/scripts/cdp_probe.py messages <URL> --wait 35

# 穿透 closed shadow root 列出 iframe（普通查询看不到）
$SKILL_DIR/scripts/cdp_probe.py shadow <URL> --wait 25

# 每 N 秒截一帧 + iframe 位置尺寸，判断是「还在算」还是「等你点」
$SKILL_DIR/scripts/cdp_filmstrip.py <URL> --every 3 --for 33

# 读跨源 iframe 内部的真实 DOM（isolated world；页面自己够不到）
$SKILL_DIR/scripts/cdp_frame_dom.py <URL> --match challenges.cloudflare.com

# 交互分支：等 interactiveBegin → 立刻点复选框 → 观察证明 POST 与事件链
# （成功判据：点击后 ~2s 内出现新的 POST .../fo/<tokenB>）
$SKILL_DIR/scripts/cdp_click_fast.py <URL> --port 9223 --deadline 40 --settle 20

# 点击前后事件字段对拍（timeStamp/screenX/button/detail/pressure/cancelable）
$SKILL_DIR/scripts/cdp_event_trace.py <URL> --port 9223

# 任意表达式
$SKILL_DIR/scripts/cdp_probe.py eval <URL> --expr 'document.querySelectorAll("iframe").length'
```

`messages` 模式能拿到 `{"source":"cloudflare-challenge","event":"overrunBegin",...}`
这类完整负载。心跳类消息（`food`）自动折叠计数。

## 与 Chrome 解密 payload 对拍枚举面

加密的 `fo` 提交体无法直接 diff（opaque body）。但如果你有 Chrome 的**解密** payload（用
DevTools 在加密前截下的 `fo` 对象），就能反向提取 CF 实际读取的属性名清单，把「载荷不可 diff」
转成「枚举面可 diff」——这是本类排查里最高杠杆的一步：

1. **正则提取 CF 读的属性名**：payload 里的 `fyCZH9` 桶表把「值 → 属性路径」都列出来了，
   前缀 `n.` = navigator、`d.` = document、`s.` = screen、`so.` = screen.orientation，
   无前缀裸标识符 = window/globalThis；`o.` = widget 自己的混淆全局（CF 代码设的，跳过）。
   提取去重后就是 CF 逐一对拍的那份清单（如 Chrome 读 81 个 `n.*`）。
2. **逐一 `typeof` 对拍 obscura**：对每个提取的属性，在 obscura 里求 `typeof navigator[p]`
   （或 `document[p]`/`screen[p]`），分「存在 / `typeof undefined` / 值类型」三档。`undefined`
   的那批就是缺失集合——真实 Chrome 恒有这些 API（WebBluetooth/WebHID/WebSerial/WebUSB/WebXR
   等），obscura 缺了会被 CF 从 `o`/`N` 桶挪到 `x` 桶，是明确的 bot 信号。
3. **顺便量内部字段泄漏**：`enum_realm.py` 抓各 realm 的
   `Object.getOwnPropertyNames(globalThis/document/navigator/screen)`，一眼看出 `_nid`/
   `_scopeRoot`/`__obscura_*` 这类 Chrome 没有的自有字段——验证「内部字段改 Symbol 键」这类
   修复有没有生效的直接手段。

```bash
# 抓各 realm 的枚举面（window/document/navigator/screen 的 own keys），经 console.warn 汇入 serve.log
/tmp/probe-venv/bin/python $SKILL_DIR/scripts/enum_realm.py <URL> --port 9223 --wait 14
grep '\[ENUM\]' /tmp/serve.log        # 注意 serve stdout 有缓冲，grep 前等一下让它落盘

# 抓挑战载荷全文（postMessage + XHR/fetch/sendBeacon body），看挑战跑到哪一步、提交了多大的 fo
/tmp/probe-venv/bin/python $SKILL_DIR/scripts/capture_challenge.py <URL> --port 9223 --wait 35
# Chrome 的完整挑战是三个提交（render + 初始 fo + 点击后的 proof fo）；不点击只抓到前两个。
# 要复现第三个（proof）fo，加 --click：等 interactiveBegin 后点复选框再继续抓
/tmp/probe-venv/bin/python $SKILL_DIR/scripts/capture_challenge.py <URL> --port 9223 --click --wait 45

# 从 Chrome 解密 payload 提取属性名清单，逐一 typeof 对拍 obscura，直接得「缺失集合」
/tmp/probe-venv/bin/python $SKILL_DIR/scripts/diff_payload_enum.py \
  /tmp/chrome/payload-2.json /tmp/chrome/payload-3.json --port 9223 --obj navigator
# --obj 可选 all / navigator / document / screen / orientation / window；默认 all
```

`enum_realm.py` 的晚快照（t=9s）再打一轮，区分「导航早期」与「settle 后」两个时刻。`capture_challenge.py`
的 stdout dump 只有 TOP realm，widget realm 的记录走 serve.log 的 `[CAP]` 行。`diff_payload_enum.py`
不导航、只连已经起来的 serve 逐个 `typeof` 对拍，跑之前 serve 得先起着（且带对齐过的 `--user-agent`）。

## 通信内容与请求钩子：拿"哪条消息触发了哪个请求"

要把「这两件事先后发生」变成「这个 handler 发起了那个请求」，三件事必须同时做到，
少一件就会静默地看不见东西：

```bash
# 全 realm 通信 + 请求 + 调用栈，配合点击
$SKILL_DIR/scripts/cdp_comm_probe.py <URL> --port 9223 --start 5 --settle 15
grep -o '\[comm\].*' /tmp/serve.log        # 所有 realm 汇成一条时间线
```

1. **记录走 `console.warn`，不要 dump 每个 realm 的数组。**
   `window.__ev` + `Runtime.evaluate` 只能取回**你 dump 的那一个 realm**，widget 侧的
   事件完全不出现；而 obscura 把每个 realm 的 console 都汇进 serve 日志，一次 grep 全有。
2. **XHR、fetch、sendBeacon（必要时 `img.src`）要一起钩。** 只钩 `XMLHttpRequest.open`
   会漏掉页面直接用 `fetch` 发的那些，两者不重叠——实测点击后的请求因此一条都没抓到。
3. **每个请求记一段 JS 调用栈**（`new Error().stack` 取 2..7 帧）。因果链就是靠它定的：

```
14871|TOP|IN | {"event":"fail","code":"600010","cfChlOut":"..."}      ← widget 上报
14888|TOP|XHR| POST zencare /fo/ :: at b (chl_page:2:146312) <- at Object.WISfF (...)
```

17ms 的间隔加上落在 `chl_page` 的栈，才能断定后者是前者的转发，而不是各自独立。

**钩子本身要挑安全的面**：`postMessage` 与 `contentWindow` 不要包装（包过一次，握手消息
直接消失，整轮作废）；被动 `message` 监听、`XHR.open`、`fetch` 实测不扰动。传给
`console.warn` 的必须是**字符串**——传对象会被质询的 getter 探针反过来利用。

**这类 JS 钩子有一条硬边界**：直接从 `op_fetch_url` 发出的请求（debug 日志里
`has_tx=false`）根本不经过这些 JS 入口，钩子永远看不到。判断「请求发出没有」只能用
`RUST_LOG=obscura_js=debug` 的 `op_fetch_url called` / `stealth_fetch completed`；
JS 钩子只回答「由页面脚本的哪个 API 构造」。

**失败消息可能有两个来源，别只盯一个**：质询自身的 `fail`（带 `code`/`cfChlOut`）确实走
postMessage；而 api.js 的看门狗（`meow`/`food` 心跳失联）会**在主页面本地合成**一个
`fail` 交给 `internalMsgHandler`，那条不经过 window 消息，钩子看不到，只能靠它同时打的
`console.log("Turnstile Widget seem to have hung/crashed")` 认出来。

## 第三步：frame realm 相对 URL 归属

跨源 iframe 里每个 API 发一次请求，看落到哪个服务器：

```bash
$SKILL_DIR/scripts/realm_probe.sh
```

正确的结果是所有 probe 都落在 frame 源。落在页面源的那些，说明该 API 的 URL
解析基准取的是顶层文档而不是本 realm。

**用 `data:` URL 的 iframe 测不出这个** —— 它走同源旁路，会全部通过。必须用两个
不同端口构造真正的跨源。

## V8 trace 的用途与边界

trace 用法见 `docs/Trace-page-script.md`。在这类排查里它能回答的：

- 页面调用了哪些 DOM API、参数是什么（`XMLHttpRequest.open` 的 method 和 URL）
- 探测了哪些不存在的属性（MISS 记录，反检测指纹的直接证据）

**答不了的**：

| 问题 | 原因 |
|------|------|
| postMessage 的内容 | 参数捕获读 JS 帧，`postMessage` 是 native 绑定，帧上无参数；对象也只会渲染成 `object:Object` |
| 某段代码属于主页面还是 iframe | 动态脚本一律记为 `<page-eval>`，脚本名列不能分辨 realm |
| 某请求发出没有 | frame 导航路径不打印 URL，只有 `op_fetch_url` 打印。注意预注入 JS 钩子同样答不了这个问题——`op_fetch_url` 直发的请求不经过 XHR/fetch/beacon，两者都只能靠 `RUST_LOG=obscura_js=debug` |

## 测量盲区（这一节最重要）

以下每条都实际导致过错误结论：

| 盲区 | 症状 | 正确做法 |
|------|------|----------|
| **默认 stealth 指纹是 Windows Chrome 145/146，没对齐参考 Chrome 的 UA** | `navigator.platform`/`userAgent`/`appVersion` 从第一步就错，后续对拍跑在错误基线，看起来像「引擎缺一堆属性」 | `serve`/`fetch` 都加 `--user-agent` 显式对齐参考 Chrome；对拍前 `Runtime.evaluate` 自查 `navigator.platform` 与参考一致 |
| **二进制不带 stealth**（`--no-default-features` / `v8-build-lean` 构建） | 质询在 TLS 握手阶段就分流，请求序列比浏览器短一大截，看起来像「上游某步没触发」——而那个「断点」纯属构建缺陷 | 只用默认的 render + stealth 构建；起 serve 时确认日志是 `TLS fingerprint impersonation + tracker blocking` 而非仅 `tracker blocking` |
| `querySelectorAll` 不穿透 shadow；closed root 的 `el.shadowRoot` 为 `null` | 误判「iframe 从未插入 DOM」 | 预注入截获 `attachShadow` 保留 root 引用（`cdp_probe.py shadow`） |
| frame 导航不打印 URL | 误判「iframe 文档从未被请求」 | 看 `starting new connection` / `Cookie header for <host>`，或直接插桩 |
| 混淆代码的字符串表会「返回」错误字符串 | 把 `unsupportedbrowser`、`invalidsitekey` 当成被触发的错误 | 看调用形态：`CALL Window.g(<数字>)` → `RET object:Array` → `RET string:"..."` 是查表 |
| **包装 DOM 访问器会改变被测行为** | 包了 `contentWindow` getter 后握手消息直接消失，整轮数据作废 | 先用可控用例验证同一机制是否正常，再决定要不要在真实页面上挂钩 |
| Cloudflare 失败路径也下发 `cf_clearance` | 误判「过盾成功」 | 判据是 `cf_chl_rc_ni` 等结果码，以及复用该 cookie 能否拿到真实内容 |
| 自己加的日志截断字段 | 把截断后的 src 当成完整 URL，误判是另一个元素 | 日志里带上长度，或不截断关键字段 |
| **导航早期（t≈1s）的 `Runtime.evaluate` 会把该 target 的文档永久清空**（obscura 缺陷，Chrome 无此行为） | 轮询类探针首轮求值落在危险窗口 → `box=null`、title/body 全空，误判「widget 没渲染」 | 首轮求值必须延迟到导航后 ≥3s（`cdp_click_fast.py --start`、`cdp_filmstrip.py --start` 默认已内置；不要用 `--start 0` 或 `--every 1` 试探边界）。此缺陷本身待修 |
| **端口上可能跑着会话外遗留的旧 serve 进程**（新 serve 启动时静默绑定失败，日志只有一条 bind error） | 探针打在旧代码上，时间线/行为全是旧版，跨轮比较得出错误结论 | 每轮实测前核对 `/json/version` 的浏览器版本号与 `ps -o lstart -p <pid>`，和二进制 mtime 对比 |
| `RUST_LOG=obscura::js=debug` 匹配不到请求日志（`op_fetch_url` 的 target 是模块路径 `obscura_js::ops`） | 以为「页面没发请求」，实际是日志没开对 | 请求序列用 `RUST_LOG=obscura_js=debug`，或看 `stealth_fetch completed: <METHOD> <URL> -> <status> (bytes)` 完成日志 |
| **预注入 JS 钩子看不到 `op_fetch_url` 直发的请求**（日志里 `has_tx=false`） | 据此得出「某请求从未被 JS 构造」的结论——`/pat/` 正是这样被误判了六个 step，直到用 Rust 日志才看到它一直在发 | 「是否发出」以 `RUST_LOG=obscura_js=debug` 为准；JS 钩子只回答「由哪个 API 构造」。两个问题不要混用同一份证据 |
| **只 dump 单个 realm 的数组**（`window.__ev` + `Runtime.evaluate`） | widget realm 的消息与请求完全不出现，误判「没有这条通信」 | 记录走 `console.warn`，obscura 把所有 realm 的 console 汇进 serve 日志 |
| **只钩 `XMLHttpRequest`，漏掉 `fetch`/`sendBeacon`** | 点击后的请求一条都抓不到，误判「点击没有触发任何请求」 | 三个入口一起钩（必要时加 `img.src`），见 `cdp_comm_probe.py` |
| **用不点击的探针判断提交链** | 点击之后的提交 POST 与回传永远不出现，却被当成「链路到此为止」 | 判据链凡涉及点击之后的部分，必须用会点击的探针；`--no-click` 的轮次只能看点击**之前**的阶段 |
| **用模拟点击（`element.click()`/`dispatchEvent`，或 obscura `Input.dispatchMouseEvent` 的 JS 合成后端）过不了 CF 的真实输入检测** | 点击后 proof fo 不出现，被误判为「点击链路断了」；实际是 `isTrusted=false` 或缺 `sourceCapabilities`，CF 判定非真实输入而忽略 | 点击必须走 CDP `Input.dispatchMouseEvent`（Chrome 里 `isTrusted=true`）。注意 obscura 的 Input 后端是 JS 合成 + `__obscura_markTrusted` 伪造 `isTrusted`；`sourceCapabilities`（含 `InputDeviceCapabilities` 全局）与按激活周期递增的 `pointerId` 已在 e0fe83f 实现，脚本自建事件仍报 `null`，与 Chrome 一致 |
| **拿 Chrome 对拍时用了 isolated world** | isolated world 不受页面 CSP 约束：同一页面 `trustedTypes.defaultPolicy` 在 isolated 里读作 `null`、main world 里是 `present`，据此会得出完全相反的结论 | 凡是与 CSP、TT、nonce 相关的对拍，必须 `mainWorld: true` |
| **探针里 `delete` 之后又 `defineProperty(name,{value:undefined})`** | 属性其实还在（`name in window === true`），只是值为 undefined；据此得出「移除了也没变化」的错误结论 | 要移除就只 `delete`，并当场用 `name in globalThis` 和 `getOwnPropertyNames` 复验，而不是用 `typeof` |
| **在 HEAD 上做干预实验，却把结论安到某个中间 commit 上** | HEAD 与目标 commit 之间还隔着几十个提交，干预结果说明不了那个 commit 的行为 | 干预实验跑在被判定的那个二进制上；要证明「某 commit 引入 X」，最强的是在它**之前**的构建上注入 X 并复现 |
| **单次测量当判据** | 同一二进制多轮里可能有一轮偏离（CF 端波动），单次结果会把二分带偏 | 二分/对拍的每个点至少重复 3 次，报告全部轮次而不是代表值 |

## 判定口径

**过盾成功**：目标 URL 返回其真实响应（原本 404 的路径就该返回 404），而不是
`cf_clearance` cookie 出现——失败路径同样会下发它，同时带 `cf_chl_rc_ni`。

**iframe 内 JS 是否执行**：看它发出的请求的 `Origin` 头。Origin 是 iframe 的源，
就说明脚本在自己的 realm 里跑起来了，不必再猜。

## 排查顺序

1. HAR 对比定位第一处差异
2. 差异处的请求：主机 / 状态码 / Origin
3. 若涉及 iframe：`cdp_probe.py shadow` 确认它是否真的加载了文档
4. 若涉及消息：`cdp_probe.py messages` 拿完整内容与时间线
5. 若要问「**哪条消息触发了哪个请求**」：`cdp_comm_probe.py`（全 realm + 三类请求入口
   + 调用栈）。先用 `RUST_LOG=obscura_js=debug` 确认请求到底发没发，再用它定位构造方——
   两个问题用两份证据
6. 若怀疑 URL 解析：`realm_probe.sh`
7. 结构性假设穷尽后**改用插桩**，不要继续猜
8. 每验证一个假设、每修掉一处阻塞，立刻按上面「维护 profile 文档」追加 step——
   全程边查边写，不要留到最后补

第 6 步的教训：一轮排查里连续五个结构性假设（shadow root、iframe 属性、跨源、
CSP、创建时机）全部用本地用例复现通过，真因是靠给队列入队/消费两端加日志找到的。
猜三次不中就该插桩。
