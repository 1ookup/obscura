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

`--user-agent` 同时决定引擎回答的**字体家族表**（`navigator.platform` 为 `MacIntel` 时回答
macOS 家族，`Win32` 时为 Windows 家族，见 `obscura-render` 的 `set_font_platform`）。质询用
「`'X', monospace` 与 `'X', sans-serif` 两次测量是否一致」判断某字体是否存在，所以一个
声称 macOS 却回答 Windows 家族的环境会被一次探针看穿，表现为 tracelog 里
`ov2.host.encode` 测到的是另一套字体名。

## 片段切分与对拍

tracelog 是单个文件，被反复质询时会追加整轮记录，直接比总行数比的是「跑了几轮」。先切分
再比：

```bash
SKILL_DIR=".claude/skills/obscura-challenge-probe"
# 每轮一行：记录数、时长、loop2 迭代数与速率、VM 实例数、提交次数
python3 $SKILL_DIR/scripts/tracelog_diff.py segments reference.jsonl our.jsonl
# 取一轮按阶段（提交前/后）与 key 对比，并列出 CF 的 toString 探测里非 native 的成员
python3 $SKILL_DIR/scripts/tracelog_diff.py compare reference.jsonl our.jsonl
python3 $SKILL_DIR/scripts/tracelog_diff.py toString our.jsonl
```

判读要点：**提交前**的 `disp.loop2` 条数应当逐条一致（前缀可比），差异集中在提交后的等待
阶段（轮询循环的迭代数、以及它调用的 `host.*`）说明引擎在同一个程序区域里转了更多或更少
圈；`toString` 里任何不是 `[native code]` 的内建成员都是插桩或引擎 shim 的源码泄漏。

## 无插桩点击

`cdp_click_checkbox.py` / `cdp_click_fast.py` 会注入包装 `Element.prototype.attachShadow` 的
preload，而质询自己会读 `attachShadow.toString()`（tracelog 的 `ov2.host.tostring` 里有这条
记录），于是整个 run 被标记。要点击就用手感更干净的方式找 widget：

```bash
python3 $SKILL_DIR/scripts/cdp_click_clean.py https://target/1.txt --port 9223
```

它不往页面注入任何脚本，用 CDP 的 `DOM.getDocument(pierce=true)` + `DOM.getBoxModel` 找
Turnstile 的 iframe 框，再用 `Input.dispatchMouseEvent` 点击。

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
| **`fetch` 模式不转发页面 console** | fetch 轮的 payloadJSON/探针 console 全部静默丢弃，会误判成「质询没跑完」 | 凡要读页面 console（payloadJSON 等）必须起 `serve`，从 serve 日志拿 |
| **全量 `--trace` 让质询在窗口内跑不完** | trace 把页面拖慢数倍：fetch 轮 35s 到不了提交；serve 轮页面任务被 `autonomous browser task exceeded its task budget` 杀掉，payloadJSON=0 | trace 轮只用于看调用形态/MISS，不用于拿提交体；两轮分开跑。另：`--v8-flags` 是顶层参数，必须放在子命令之前（`obscura --v8-flags "…" serve …`） |
| **V8 property-lookup trace 不覆盖普通 JS 对象的属性访问** | trace 的 MISS 极少（一轮 19 条），据此会误判「CF 没探测缺失 API」；bootstrap 的 navigator 等 JS shim 的 typeof/in 走 V8 fast path 不进 hook | 枚举面/缺 API 类结论用 `enum_realm.py`/`diff_payload_enum.py` 对拍；trace 的 MISS 只回答 window 级全局查找失败 |
| **对拍脚本不先做同侧 sanity check** | 摊平脚本「后片覆盖前片」bug 曾把两边完全相同的 Math 指纹误报成「缺失」 | 对拍脚本先跑相邻批自比（chrome-2 vs chrome-3、obsc-2 vs obsc-3 应≈零差）再跨侧对比 |
| **按分片号（part N）对齐两边 payload** | 同一探针在 chrome 落 part 27、obscura 落 part 20；且第二批提交是增量的（payload-3 = payload-2 + 新 part），按 part diff 全是假差异 | 对拍一律按探针字段名（混淆名跨边稳定）对齐，跨 part 合并同名值 |

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

## 插桩片段的复现与边界（2026-09-16）

上游代理**已不再重写**挑战 JS：它当前实例的 flow 里 `modified` 全为 0，也没有任何
响应体带 `__ov2tl`。CF 也换了生成器代次——今天挑战 VM 由 `.../g/fo/<ray>:<ts>:<tok>`
以 base64(br) 的**混淆载荷**下发，`orchestrate/chl_page/v1` 是 230 KB 的新型混淆 JS，
都不含可被补丁的明文。历史上那份被插桩的明文（443,824 B，`light/fbE/new` 构建，
sitekey `0x4AAAAAAADnPIDROrmt1Wwj`）**本身就是一份自洽的挑战文档**：唯一一个
`<script nonce>` 内联着整个 VM。它的未插桩孪生体是 434,646 B（正好差 9,178 B 的
插入量）。

复现方式（页面侧零注入，跑的就是那份插桩构建）：

```bash
# 1) 把插桩文档当作页面文档放到本地 http 源；2) 引擎必须让回环绕过代理
cp /tmp/api-patched.js /tmp/instrumented-site/1.txt
(cd /tmp/instrumented-site && python3 -m http.server 8123 --bind 127.0.0.1 &)
NO_PROXY=127.0.0.1,localhost OBSCURA_INSECURE_TLS=1 OBSCURA_TRACELOG_FILE=/tmp/out.jsonl \
  obscura serve --port 9277 --proxy http://192.168.3.57:9000 --stealth \
  --allow-private-network --user-agent "$REF_UA"
python3 .claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py \
  http://127.0.0.1:8123/1.txt --port 9277 --click-after 999 --deadline 40 --settle 20
python3 .claude/skills/obscura-challenge-probe/scripts/tracelog_diff.py compare \
  assets/stage3fix-trace.jsonl /tmp/out.jsonl --min-records 2 --gap 2
```

`--min-records 2` 是必须的：这份片段只有 payload 阶段的 7 条记录，默认阈值会把它过滤成空。

**引擎侧的拦截边界（这次踩到的）**：`Fetch.fulfillRequest` 只对 JS `fetch()`/XHR
生效（`op_fetch_url`）。导航与子资源（`Document`/`Script`）的 `Fetch.requestPaused`
是**事后回放**（`obscura-cdp/src/domains/page.rs` 在导航后重放 `network_events`），
此时 `ctx.fetch_intercept.paused` 里没有对应 resolver，客户端的 fulfill 会被静默忽略；
`Fetch.getResponseBody` 也是返回空串的桩。所以「用 CDP 换掉文档/脚本响应」这条路走不通，
只有 JS 侧取回的响应（本次的 `fo`/`orchestrate` 都是 `Fetch` 类型）能被改写。

**这份片段的覆盖上限**：插桩文档脱离真实 interstitial 单独运行时，挑战自己的一次
容器查找得到 null，payload 变成错误上报（`TypeError: Cannot read properties of null
(reading 'appendChild')`，栈在文档自身），于是停在 payload 阶段、`sends=0`，
拿不到 dispatch/handlers/host ops 阶段。这不是引擎缺陷的证据：早先同一构建、真实
interstitial 里的 Obscura 片段 payload 与 Chrome 逐字段一致
（`/tmp/obscura-trace-clean.jsonl` 对 `assets/stage3fix-trace.jsonl`）。

**payload 阶段的对拍结论**：keymat 的 128 字节随机数、framed 的 `buf_kind`、
compressed 的 `flag`、rsa_header 的 `header_len=128/pad=2`、keyRaw 的 `off=58`
全部与参考一致；唯一差异是 `json_plaintext` 的**内容**（我们发的是那份错误上报），
因此 `deflate` 的 `in_len` 657 对 4054，后续 keystream/encrypted/cipher/final/send
六条缺失。也就是说：载荷构造的算术与参考一致，差异来自「挑战选择发什么」，
而后者由这次脱离父文档的放置方式决定。

## 三项修复的无插桩直接验证（2026-09-16）

插桩片段只覆盖到 payload 阶段，触发不到 WebGL toString、字体平台、attachShadow
三处修复。所以按目标给的兜底路径，改用**不注入任何页面脚本**的探针直接问引擎
（`scripts/verify-fixes.py`：导航到 `data:` 夹具，只做只读枚举，不改变页面行为）：

```bash
# 固定构建：macOS 身份与 Windows 身份各一次
obscura serve --port 9241 --stealth --user-agent "$MAC_UA"
obscura serve --port 9242 --stealth --user-agent "$WIN_UA"
python3 .claude/skills/obscura-challenge-probe/scripts/verify-fixes.py --port 9241 --label fixed-macos --json /tmp/verify-fixed-macos.json
python3 .claude/skills/obscura-challenge-probe/scripts/verify-fixes.py --port 9242 --label fixed-windows --json /tmp/verify-fixed-windows.json
```

固定构建结果（两个身份一致）：WebGL 沿原型链 368 个成员、**0 个非 native** 回答；
接口面 1040 个成员、**0 个非 native**；字体集合完全按身份翻转——macOS 身份 8/8
macOS 族 `loaded` 且 9/9 Windows 族 `NetworkError`，Windows 身份正好相反，测量值同步
（macOS 下 `Menlo`=monospace 宽 124.83、`Luminari`=serif 宽 137.8；Windows 下
`Segoe UI`=System 169.2、`Consolas`=mono 124.83）。

A/B 对照（证明探针确实能测出被修掉的东西，对照构建用完即还原，`md5` 校验一致后重编）：

- 关掉 WebGL 的 `_markNative` 扫描：**368/368 全部泄漏 JS 源码**
  （`getExtension`、`getParameter`、`getShaderPrecisionFormat`、`getSupportedExtensions`
  等，正是 tracelog 里 CF 探的那几个）。
- 关掉 `set_font_platform` 接线：**macOS 身份解析出整套 Windows 族**（9/9 loaded）、
  8/8 macOS 族 `NetworkError`——这就是修复要消掉的那处自相矛盾。
- 保留修复、但注入一个改 `attachShadow` 的 preload（旧点击工具的做法）：
  探针立刻报 5 处泄漏（`Element/HTMLElement/HTMLDivElement.prototype.attachShadow` 等）；
  同一个探针在无 preload 的固定构建上 1040 个成员 0 泄漏。

真实挑战页上的同一组探针（`https://www.thelancet.com/1.txt`，走代理，macOS 身份，
`cdp_click_clean.py` 无注入点击，探针用独立会话只读求值）返回：
`webgl.named` 六个 CF 会探的成员全 `native`、原型链 120 成员 0 泄漏；
`attachShadow`/`attachInternals` 均 `native`、`preload_markers: []`（页面里没有工具
注入的痕迹，`document.scripts.length` 3 都是挑战自己的）；字体 `Menlo`/`Luminari`
`loaded`、`Segoe UI`/`Consolas` `NetworkError`，与 `navigator.platform = MacIntel` 自洽。

## 用 0916-11 参考跑通挑战（2026-09-16 夜）

参考 `assets/tracelog-0916-11.jsonl`：301,292 条、12.3s、**一轮跑完**（`vm_instances=4`,
`sends=3`），词表换代但仍以 `ov2.` 开头——`ov2.boot.dump` 取代 `ov2.ctor.dump`，
`ov2.disp.l1/l2` 取代 `loop1/loop2`，新增 `ov2.recov.*`、`ov2.payload.send2`。
`tracelog_diff.py` 的族名、loop/send 计数已按新词表更新（`send`+`send2` 都计入）。

**今天的插桩位置换了**：补丁现在打在 `.../challenge-platform/h/g/turnstile/f/av0/rch/<sid>/...`
这份 ~88 KB 的**挂件文档**上（`ov2.` 标记 90+，text/html）。`fo` 载荷已改成 base64(br)
混淆，`orchestrate/chl_page/v1`（~80 KB 明文 JS）与薄 interstitial 都不带标记。
对应的跑法就是把 Obscura 指向同一代理、开 tracelog：

```bash
OBSCURA_INSECURE_TLS=1 OBSCURA_TRACELOG_FILE=/tmp/out.jsonl obscura serve --port 9265 \
  --proxy http://192.168.3.57:9000 --stealth --user-agent "$REF_UA" --fingerprint "$FP"
python3 .claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py \
  https://www.thelancet.com/1.txt --port 9265 --click-after 14 --deadline 55 --settle 30
```

固定套路要用的 `FP`（参考身份，缺一项就会被 CF 用不同挑战版本服侍）：

```json
{"language":"zh-CN","languages":["zh-CN"],"hardwareConcurrency":6,
 "screen":{"width":1440,"height":900,"availWidth":1440,"availHeight":900,"deviceScaleFactor":1}}
```

**这一步修掉的环境缺失**（改前/改后都由 `ov2.host.read*` 对拍确认）：

| 事实 | 改前 | 改后 = 参考 |
| --- | --- | --- |
| `language`/`locale`/`languages` | `en-US` / 2 项 | `zh-CN` / 1 项 |
| `devicePixelRatio` | 2 | 1 |
| `hardwareConcurrency` | 8 | 6 |
| `GPUAdapterInfo.architecture` | `metal-3` | `""`（Chrome 会抹掉） |
| `navigator.gpu.wgslLanguageFeatures` | `[object GPUSupportedFeatures]` | `[object WGSLLanguageFeatures]` |
| `createBiquadFilter().frequency` 等 | `[object Object]` | `[object AudioParam]` |
| `context.destination` | `[object Object]` | `[object AudioDestinationNode]` |

要点：`GPUAdapterInfo.isFallbackAdapter` 已按 Chrome 删掉；`MediaCapabilities`
的 `powerEfficient` **保持 false**——仓库里 `media_capabilities_match_the_full_chrome_capture`
就是 Chrome 抓包，参考 trace 里那个 `true` 是另一个接收者，改它会挂测试。
WGSL 只改 `Symbol.toStringTag` 品牌，**不能换原型**，否则 setlike 面（size/has/迭代）没了，
`webgpu_describes_the_same_adapter_the_webgl_renderer_claims` 会挂。

**结果**：身份对齐后 interstitial 的文案从「正在进行安全验证」变成
**「验证成功。正在等待 www.thelancet.com 响应」**，一轮 801,283 条记录，
`vm_instances=4`、`sends=3` 与参考同形。页面最终仍停在 challenge 上：验证后 reload
`/1.txt` 拿到 **403 + `cf_chl_rc_ni`**，`cf_clearance` 每次都新下发且我们的 jar 正确回送
（值 set/sent 一致，已核对），但 CF 依旧再挑战；`/g/pat/...` 返回 **401**。

**这不是 Obscura 独有**：本机 Chrome 153 走同一代理跑同一流程，interstitial 同样停在
challenge；`/123.txt` 的 warm-fiddle harness 在 Chrome 里同样报
`reloadApiJsRejected` → `error-callback 600010`（原因是没有 WS bridge，autorender
用的是 `extra-params-mock.json` 里 134 天前的 `chlPageData`，iframe 因此要求重载 api.js）。
所以 600010 与页面级 403 都是环境/harness 现象，不是引擎缺口；`--autorender=1` 只适合看
渲染与消息，不能当「拿到 token」的判据。

**仍与参考不同、且已知来源的项**（下一步按价值排序）：

1. **文本度量**：`actualBoundingBox*` 我们是从 font box 推的整数（14/3/0/58.125），Chrome
   报真实字形墨迹（12.128/0.224/-0.672/8.736）；`fontBoundingBox*` 的值也不同（14/3 vs
   17/5，因为用的是内置字体而不是 macOS 真字体）。要真做需要按字形轮廓算墨迹。
2. `document.referrer` 在挂件 frame 里为空（参考是页面 URL）。
3. `HTMLElement` 读成 `fn:Element`（某处元素的构造器身份）。
4. `downlink` 10 vs 1.75、`quota` 5 GB vs 10.7 GB——都属「双方都合理」，未改。

## 600010：为什么在这个环境里拿不到 token（2026-09-16 深夜）

`capture-token.py` 装一个只读的 `message` 监听器，把 widget 与页面之间的协议原样记下来。
在 interstitial（`/1.txt`）上跑到的关键事实：

- 一小时内同样的流程、同一个引擎曾走到 CF interstitial 的「验证成功。正在等待…」；
- 之后同样流程里 widget 自己回的是
  `{"event":"fail","code":"600010","rcV":"...","cfChlOut":"...","frMd":"..."}`，
  完整记录在 `/tmp/token-interstitial.json`；
- 本机 Chrome 153 走同一代理、同一站点同样 600010。

> **更正（2026-09-17，见文末「interstitial 静态文案」一节）**：上面第一条说的"走到过
> 「验证成功。正在等待…」"**不能当作通过证据**——`验证成功` 是 interstitial 自带 HTML 里的
> 静态字符串，文档一到位就在 `innerText` 里。该轮真正说明流程推进的证据是 tracelog 的
> 记录量（801k 条）与 `ov2.payload.send`/`send2`，不是这段文案。

也就是说 600010 与引擎无关：它发生在 widget 内部、在页面的环境事实起作用之前，而且**同一环境自己前后不一致**（先成功、后失败）——这与 Cloudflare 对 600010 的通用解释一致：
sitekey/secret 配置、`action`/`cdata` metadata、以及**出口 IP 信誉与请求频率**都在成因里。我们在一小时里对同一 sitekey 做了几十次挑战，出口又是那台 MITM 代理，最可能是这一支。

排查手法留档：widget 的 `fail` 消息带 `code`/`cfChlOut`/`frMd`/`rcV`，用 `capture-token.py`
（无 `--drive-render` 时不注入任何东西，只在页面里加一个 `message` 监听）就能拿到；
`--drive-render` 会在页面里自己渲染一个 widget 并订阅 callback，token 落到
`/tmp/warm-fiddle-token.txt`。只要 CF 那边恢复接受，这条通路就能直接产出 token 字符串。

注意 `--drive-render` 依赖 preload 注入。**（更正 2026-09-17：preload 注入并不会让这个页面停止
导航——见文末「preload 四种变体」的 8 次实测；当时看到的"不再完成导航"是同一时刻的环境卡顿，
`htmlLen=28615`/`readyState=complete` 在带与不带注入时完全一致。）**

### 600010 的判定位置与其后验（补充，2026-09-17 凌晨）

上到 192.168.3.57 的分析工作区（`/Users/l9h8/macOSShare/cf5s/cf-ov2-replay/jsvmp-engine-0916-11`）
里，`_verify/baseline/ov2-0916-11.pristine.js` 的字符串表中有字面量 `600010`，且
`thelancet.har` 旁的注释写明了语义：

> Trace postMessage between parent and Turnstile iframe so the failure mode
> (**parent never replies extraParams → iframe sends fail/600010**) is visible.

也就是说 600010 = **父框架没有回 extraParams**，不是"算错答案"。同一工作区的
`extraparams-swap` / `extraparams-passthrough` 两条 bridge 命令，就是为"把当轮真实的
chlPageData 塞回去"准备的。

据此做的四个对照全部失败（都是 600010，token 从未落盘）：

| 变量 | 配置 | 结果 |
| --- | --- | --- |
| 出口 | 走上游代理 | 600010 |
| 出口 | **完全直连**（serve 不带 `--proxy`） | 600010 |
| api.js | 代理钉住的旧版（82,928 B，带 harness patch） | 600010 |
| api.js | 当轮版本（`NO_PROXY=challenges.cloudflare.com`，86,603 B） | 600010 |
| 页面 | 免挑战的 `/123.txt` harness | 600010 |
| 页面 | `/1.txt` interstitial（自己显式 render） | 600010 |
| 参数 | 带 `action: 'managed'` | 600010 |

而**同一个环境两小时前**在 `/1.txt` 上走到过 CF interstitial 的「验证成功。正在等待…」，
说明这不是"引擎算不对"，而是显式渲染这条路上 **父侧 extraParams 回复拿不到/不被接受**。
配合官方对 600010 的解释（sitekey/secret 配置、metadata、IP 信誉），当前最合理的结论是：
该 sitekey 在这个域名/模式下**没有为显式渲染配好**，因此驱动渲染这条路在本环境里拿不到 token；
CF 自己的 managed interstitial 流程不受此影响（它走内部路径，所以曾经成功）。

可复现的驱动渲染器（无 preload、纯 CDP，机制已验证可用，只是被 600010 挡住）：
`/tmp/drive-token.py`；带消息录制与失败记录落盘的版本：`capture-token.py`。

### 拿到"当轮真实 extraParams"之后（2026-09-17）

补丁版 api.js 把每次 parent→iframe 发送都汇到一个函数里，并调用
`window.__warmFiddleApiLog("postmessage-send", origin, JSON.stringify(message))`。
在 document-start 定义这个全局（preload 里 3 行），就能把**当轮的 extraParams 原样拿到**：

```js
window.__warmFiddleApiLog = function (kind, origin, preview) {
  (window.__wfTap = window.__wfTap || []).push({ kind: kind, origin: origin, json: preview });
};
```

实测拿到的一份（存 `/tmp/extraparams-fresh.json`，4021 B）：`chlPageData` 597 字符、
ray 时间戳比抓取时刻**只旧 1.5 分钟**、`cData=a3bdab5d28540d05`、`action=managed`、
`wPr` 齐全、`url=/1.txt`——正是 iframe 需要的东西。

把它当 mock 塞给一次显式渲染（`window.__warmFiddleExtraParamsMock = payload`，然后
`turnstile.render(container, {…, callback})`），在 `/123.txt` 与 `/1.txt` 上都试过，
仍然 `600010`，token 依旧为空。至此**参数新鲜度被排除**：不是 mock 过期的问题。

连同前面的对照，600010 在以下全部组合里都出现：代理/直连两条出口、旧版/当轮两版 api.js、
harness/interstitial 两个页面、带不带 `action`、mock 新鲜与否。而同环境两小时前 CF 自己的
managed 流程能走到「验证成功」。因此最合理的解释是：**CF 只为它自己为本次挑战创建的那个
widget 实例完成 extraParams 握手**；页面自己再 `render` 一个实例会被配置层面拒绝——也就是
"sitekey 未按该域名/模式配置显式渲染"这一支。

结论：在本环境里，`正常返回token` 只能来自 CF 自建的那个实例（而它不向页面暴露 callback），
或者来自一个**确实配置了显式渲染**的 sitekey。引擎侧无论怎样改都不会改变这一点；
驱动渲染通路本身已跑通（能渲染、能收 widget 的 error-callback），只差 CF 接受。

> 本节把"CF 自己的 managed 流程曾经走通"当成了对照前提，那条前提后来被证伪（见文末更正）：
> CF 实例在**本环境下现在也没走通**（interstitial 连 widget 都没建起来，Chrome 同样如此）。
> 所以更稳的表述是：**显式渲染与环境拒绝都可能，且后者已被 Chrome 平行为证**。

### 剩余环境差异的分级（2026-09-17，含实测证据）

对 16 项残余差异做了归因与实测，分三类：

**引擎缺口（值得改，但非一行）**

1. **元素接口身份塌缩**。探针实测（`/tmp/ht-probe.py`，`data:` 页 + 自建 iframe）：

   ```
   window.HTMLElement          -> function:Element      （Chrome: HTMLElement）
   window.Element              -> function:Element
   div.constructor.name        -> "Element"             （Chrome: HTMLDivElement）
   div.__proto__ 链            -> Element → Element → Node → EventTarget → Object
   frameWin.HTMLElement        -> Element
   ```

   也就是 `globalThis.HTMLDivElement = Element` 这类别名（见
   `bootstrap/config/webidl-branding.js:88` 的注释与 `env/css/supports.js:569`）让
   `HTMLElement` 与各标签接口都不存在独立对象，原型链少两层。要真修得为每个标签建
   独立接口对象并接上原型链，涉及整个 DOM 面（surface manifest 里有完整层级，如
   `surface-finalize.js:620` 的 `["HTMLDivElement",0,0,"HTMLElement","",0]`），
   回归面很大，不能顺手改。

2. **iframe 的 document.referrer 为空**。参考里挂件 frame 读到的是页面 URL
   （`https://www.thelancet.com/`）。引擎有 `Runtime::set_referrer`（`runtime.rs:852`），
   但只在页面层接上（`page.rs:1380`）；frame 导航没有把嵌入文档的 referrer 传下去。
   同一个原因让既有测试 `initial_about_blank_inherits_creator_origin_domain_and_referrer`
   长期失败（属于 13 项既有失败之一）。

3. **文本度量**：`actualBoundingBox*` 现在由 font box 推导成整数，Chrome 报真实字形墨迹
   （12.128/0.224/−0.672/8.736）；`fontBoundingBox*` 值不同源于内置字体 vs macOS 真字体。
   要真做需要按字形轮廓算墨迹，且值仍不会与真字体一致。

**环境固有（不该改）**

4. `downlink` 10 vs 1.75、`quota` 5 GB vs 10.7 GB：这是本机网络与磁盘的读数，参考来自
   操作者那台机器。仓库里的测试只断言这些面**存在**（`runtime.rs:26058`、`6962`），
   改常量只会让我们"更像那一台机器"，不是更像浏览器。

5. 其余零星差异（`isFallbackAdapter`/`minSubgroupSize` 的存在性、`nonce`、各种 ray）属于
   会话数据或已按 Chrome 抓包修过的项。

**结论**：环境收敛剩的都是真缺口，但都属于"要动 DOM 面/渲染层"的中等工程，不适合在
token 仍被阻塞时顺手改；已按上面顺序列为下一步。

### 对拍要"对值"：`values` 与 `diverge` 两个新口径（2026-09-17）

只对键名/族名会漏掉整类差异。`tracelog_diff.py` 增加两个子命令：

- `values REF OURS`：每个键**按值**分类——值完全相同 / 同格式但值不同（会话差异）/
  **格式不同** / 只在一边。跑 0916-11 参考 vs 我们的对齐跑：
  `keys 74/74、value-equal 40、same-format 34、FORMAT DIFFERS 0、missing/extra 0`
  —— 形状层面已完全对齐，差异全在值上。
- `diverge REF OURS`：按记录顺序逐值比较（数字、长十六进制、长 token 掩成 `#`），
  给出每个键**最早出现值分歧**的位置。

第一次跑出来一条"三个 slot 计数一律 +32"的现象，但**断言它是引擎差异是错的**——复查后
证明那是比较方法的问题：

- 参考 trace 来自 **`/123.txt` harness**（其 payload 里 `vXDzj6 = https://www.thelancet.com/123.txt`），
  我们的那条来自 **`/1.txt` interstitial**（payload 里是 `/1.txt`）：**两边不是同一个页面上下文**。
- `ov2.boot.dump` 的 `g/fs_slot/bc_slot/pc_slot/key_slot` 都是 VM 寄存器数组的**槽位索引**，
  按他们 `jsvmp.md` 的规格，这些索引由初始值播种顺序（perm）决定，**每个实例不同**。
- 逐实例对齐后，我们第 5 个实例是 `g=70/fs_slot=0/bc_slot=74/pc_slot=13/key_slot=202`，
  参考第 1 个实例是 `71/1/75/12/203`——**逐位相差 1**，槽位布局其实是一致的。

教训（写进口径）：**值级对拍必须同上下文、同实例序**。跨页面（harness vs interstitial）或跨实例
（拿各自的第 N 个 VM 记录配对）比出来的"系统性偏移"是布局噪声，不是引擎差异。另外我们这边一轮里
起了 **6 个 VM 实例**、参考只有 **4 个**，这也说明两边经历的挑战轮次本就不同。

在能拿到 harness 页上**跑完的一轮**之前（这被 600010 挡住，见上一节），值级对拍只能在同一页面
内部的两次运行之间做；跨上下文的值级结论一律不成立。

### 走他们自己的 bridge 协议做最后判定（2026-09-17 06:20）

按 cf-ov2-replay 的协议（`scripts/bridge-client.mjs` 头部注释即规格）写了一个最小 bridge
（`/tmp/mini-bridge/bridge.mjs`，`ws://127.0.0.1:9001/?role=browser-fiddle`），把**当轮真实的
extraParams 作为 `render` 命令的 params 传下去**——这正是协议里"passthrough"的做法
（`{cmd:'render', requestId, params:{sitekey, theme, chlPageData, cData, action, …}}`）。

关键前提：引擎必须让回环绕过代理，否则 harness 页连不上本机 bridge
（`NO_PROXY=127.0.0.1,localhost`；第一次跑就是漏了这条，日志里只看到遗留的 Chrome 标签连上来）。

结果（两侧都试过）：

| 浏览器 | 通过 bridge 渲染 | 终态 |
| --- | --- | --- |
| Obscura（本引擎，macOS Chrome/149 身份） | 是（`hello` 里的 UA 可辨认） | `error 600010` |
| 本机 Chrome 153 headless | 是 | `error 600010` |

页内状态还给出了内部序列：`apiJsMismatchReloadAttempts: 0` → `reloadApiJsRejected`
→ `error-callback 600010`——即 iframe 要求重载 api.js 而 api.js 侧拒绝了它。

**这是本环境能给出的最强判定**：用操作者自己的协议、带着当轮新鲜参数、两个不同浏览器，
结果一致为 600010。因此：不是引擎算错、不是参数过期、不是出口 IP（直连也试过），而是
**该 sitekey 在本域名/模式下的显式渲染没有被接受**（管理式 interstitial 流程不受影响，
两小时前它还能走到「验证成功」）。要继续就需要在 Turnstile 后台为该域名/模式配置好的
sitekey/secret；拿到后一条命令即可落盘 token：
`python3 /tmp/mock-drive.py 9268 https://www.thelancet.com/1.txt 60 /tmp/extraparams-fresh.json`。

### 试过并回退的"引擎侧修复"：about:blank frame 的 location.origin（2026-09-17 06:30）

按"先做不依赖外部输入的引擎侧修复"这条，我去做那条长期失败的
`initial_about_blank_inherits_creator_origin_domain_and_referrer`。先跑测试看真实差异——
**不是 referrer**（`child.referrer` 与 `nested.referrer` 两边本来就对），而是
**`frame.contentWindow.location.origin` 对 about:blank frame 返回了创建者 origin**，
规格要求 `"null"`（`self.origin` 才继承创建者）。

根因在 `env/window/location.js`：对 `about:srcdoc` 与 `about:blank` 都做了"Location 报创建者
文档 URL"的处理。把它收窄成只对 `about:srcdoc` 后：

- **门禁从 13 项失败降到 10 项（1808 passed）**，目标测试及两个相邻测试转绿；
- 但**实时挑战从 801k 条记录掉到 ~4.9k 条、页面白屏**——因为 CF 会用 about:blank frame
  做探针，改成规范答案后它们看到协议 `about:`，VM 走了 PAT 分支（正是原注释警告过的那件事）。

结论：这是**规格与 stealth 的取舍**，引擎当前那条"故意偏离"是承重的，不能为了一条测试翻掉。
已回退（`location.js` 恢复到改动前，`grep` 可见 `about:srcdoc" || rawUrl === "about:blank"`
的条件仍在），并把这次的测量数字写进那段代码注释，避免以后有人再盲翻一遍。

另外：回退后**同一条流程依然早早停住（同为 ~4.9k 条、白屏）**，和改动前的 801k 条不同——
说明当前这个早停是**环境侧**（与本机 Chrome 表现一致的那次 600010 退化同源），不是这次改动。

### 用 Cloudflare 官方测试 sitekey 把"引擎能不能出 token"与"站点 key 被拒"分开（2026-09-17 06:45）

本站 sitekey 在本环境下一直 600010（配置类），无法用它判定引擎。Cloudflare 为开发用途发布
域无关的测试 sitekey，用它在我们引擎里跑同一套驱动（`/tmp/testkey-token.py`，在 harness 页上
`turnstile.render` + 自己的 callback）：

| 测试 sitekey | Cloudflare 语义 | 我们引擎的结果 |
| --- | --- | --- |
| `1x00000000000000000000AA` | 永远通过 | **拿到 token** `XXXX.DUMMY.TOKEN.XXXX`（官方 dummy 值），已落 `/tmp/warm-fiddle-token.txt` |
| `3x00000000000000000000FF` | 强制交互且**必定失败** | 无 token（点 3 次也一样），符合语义 |
| `2x00000000000000000000AB` | 永远拦截 | **`600010`** |

最后一行是关键对照：**CF 自己的"永远拦截"测试 key 也返回 600010**，与本站 sitekey 一模一样。
所以 600010 就是 CF 对这个 key/上下文**拒绝**时给的通用码（正例能出 token、反例同码），
而不是引擎算错——引擎侧的通路（api.js 加载 → widget 渲染 → iframe 握手 → callback → token 交付）
已被正例完整证明。

### interstitial 静态文案：`验证成功` 不是通过信号（2026-09-17 07:10）

前一节把「页面里出现 `验证成功。正在等待 www.thelancet.com 响应`」当成 managed 流程走通的证据，
**这是错的**。用 `/tmp/pass-visibility.py` 从 t=0 起逐点采样该 interstitial（无 preload、无点击、无驱动）：

```
progression: [True, True, True, True, True, True, True]   # t=0.0/1/2/3/5/8/12s
node=H2#zfpQF7.ndZkd3  chain=[H2,DIV,DIV,DIV]  errorText=[]
```

`验证成功` 在文档一到位的第一个采样点就在 `innerText` 里，节点也不是渲染出来的（`challenge-error-text`
同理，一直存在于标记中）。CF 的 interstitial 是把**所有状态文案一起发货**的，页面只是切换可见性。
我们的引擎没有布局，`offsetWidth` 恒为 0，所以"可见性"这条判据在本引擎里不可用——结论只能靠
**文案出现的时刻**：t≈0 就有 ⇒ 静态。

**可用的通过信号**（按可信度排序）：

1. tracelog：`ov2.payload.send` / `ov2.payload.send2` 出现，以及整轮记录量（走通的一轮是 ~801k 条，
   卡住的一轮是 ~4.9k 条）——2026-09-16 那轮"走到验证成功"的真正依据是这个，不是文案。
2. widget 与页面之间的 `message`（`capture-token.py` 的录制器）：`event:"token"` 或 `event:"fail"` 带
   `code`。驱动渲染时收到过 `fail/600010`；CF 自建实例的消息在本环境里**没有出现过**。
3. 隐藏输入 `<input name="cf-turnstile-response">` 的 `value` 变为非空（managed 表单路径）。

### 同一个页面，Chrome 153 与 Obscura 逐字段相同 ⇒ 当前卡点是环境（2026-09-17 07:20）

这是本环境能给出的最强对照：两台浏览器、同一代理、同一 URL、同一时刻，取同一个文档骨架
（`/tmp/dump-stalled.py`；Chrome 侧要用 `/json/version` 里的 `webSocketDebuggerUrl`，
`/devtools/browser` 无 UUID 会 404，脚本里读 `OSC_WS` 即可）。

| 事实 | Obscura（serve 9276） | Chrome 153 headless |
| --- | --- | --- |
| `documentElement.outerHTML` | 28,615 B | 28,214 / 28,235 / 28,352 B |
| `title` | `请稍候…` | `请稍候…` |
| `readyState` | complete | complete（中途 25s 处出现过 `Just a moment...`/interactive 的另一份文档） |
| scripts | `orchestrate/chl_page/v1`、`turnstile/v0/g/…/api.js?onload=khCN8&render=explicit`、inline 3784 B | 同样三条（inline 3613 B） |
| `_cf_chl_opt` / `turnstile` 全局 | 有 / 有 | 有 / 有 |
| `iframe` 数 | **0** | **0** |
| `<input name=cf-turnstile-response>` | 无 | 无 |
| widget 消息 | 无 | — |

也就是说：api.js 拿到了、`render=explicit` 也在，但**两边都没有建立 widget iframe**；Chrome 还多出一次
`Just a moment...` 重投——CF 在这个出口上一直在重发挑战。两个不同浏览器在这个出口上落点一致，
所以此刻的卡点**不是引擎行为**：改引擎不会改变结果。

复现（Chrome 侧）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9344 --user-data-dir=/tmp/chrome-prof-9344 \
  --proxy-server=http://192.168.3.57:9000 --ignore-certificate-errors \
  --window-size=1440,900 about:blank
OSC_WS=$(curl -s --noproxy '*' http://127.0.0.1:9344/json/version \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["webSocketDebuggerUrl"])') \
  python3 /tmp/dump-stalled2.py 9344 https://www.thelancet.com/1.txt 40
```

### 测量盲区：CDP 看不到 iframe/worker 的子资源（同日）

在同一轮里把 `Network.enable` 打开（并 `Target.setAutoAttach`）录事件，整轮只有 4 条：

```
REQ  GET   https://www.thelancet.com/1.txt
RESP 403   https://www.thelancet.com/1.txt
REQ  GET   https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/av0/rch/<ray>/<key>
RESP 200   ...
```

`api.js`、`chl_page/v1` 这些都在文档里、也确实被请求了（代理侧可见），但不进这条事件流；
`Target.setAutoAttach` 也没有派生出任何 worker 目标。**因此用 CDP 事件流判断「通过之后是否发出提交、
提交回什么」是不成立的**——那个问题只能回到插桩（tracelog / 代理）去看，别再从事件流里找答案。

### preload 四种变体：注入不是卡点（2026-09-17 07:35）

`Page.addScriptToEvaluateOnNewDocument` 一直被怀疑"注入后页面就不再完成导航"。用
`/tmp/preload-variants.py`（四种变体 × 两条出口，每格 26s）在真实 interstitial 上实测：

| 变体 | 内容 | htmlLen | readyState | input | msgs | 注入标记 |
| --- | --- | --- | --- | --- | --- | --- |
| none | 无 | 28615 | complete | 0 | 0 | — |
| one-line | `window.__probeOneLine = 1` | 28615 | complete | 0 | 0 | number ✓ |
| listener | 只加 `message` 监听 | 28615 | complete | 0 | 0 | — |
| full | 监听 + 包 `fetch`/`XHR.open` | 28615 | complete | 0 | 0 | hooks=2 |

两条出口（9277 直连、9276 走上游代理）四格数字完全相同。结论：

- **注入本身无害**：标记属性在页面里可见、文档照样 28615 B / complete、`window.turnstile.render`
  照旧可调用。之前那条"注入导致导航不完成"的观察，实际是同一时段的环境卡顿。
- **CF 自己的流程一条 widget 消息都不发**（`msgs=0`，连只装监听器的变体也一样），说明页面脚本
  根本没开始 widget 握手——不是我们漏接了哪条消息。

### 出口只有一条，而且是数据中心 IP（2026-09-17 08:05）

"换一条干净出口 IP"这条下一步，在本环境里**没有可换的对象**，这是量出来的：

```
直接出口（不带代理）       8.220.195.225
经 http://192.168.3.57:9000 8.220.195.225   （连测三次完全相同，无轮换）
经 192.168.3.57:8080        8.220.195.225   （同一出口的另一个监听）
其余端口 8081/8123/8888/1080/3128/8443/9050/9001 均无响应
IP 归属：AS45102 Alibaba (US) Technology Co., Ltd., Seoul, KR
```

也就是说**代理与直连是同一个出口**（这解释了为什么"走上游代理"和"完全直连"两条路的
行为逐字段一致），而且是**阿里云数据中心段**。CF 对数据中心出口的挑战不会走到放行：
managed interstitial 连 widget 都不建（Chrome 一样），显式渲染则一路 `600010`。

在这一条出口上，用户给的下一步命令已按原样跑过（`/tmp/mock-drive.py 9268 …`），
60 秒里 widget 反复回 `600010`，`NO TOKEN`，`/tmp/warm-fiddle-token.txt` 未生成。
所以这一步的阻塞点是一个**外部资源**：一条住宅/ISP 出口（AGENTS.md 推荐的 NodeMaven 那类），
不是引擎、不是参数新鲜度、也不是对本环境的模拟程度。

### 当前状态的实话（2026-09-17 07:25，token 状态于 08:05 更正）

- 生产 sitekey 从未产出过 token。**`/tmp/warm-fiddle-token.txt` 现在不存在**：07:00 左右
  为一次干净测量做过 `rm -f`，此后没有任何一轮写过它。（此前文档记的"里面是官方测试 key 的
  dummy 值"已过期；那个 dummy 是引擎通路被证明过的产物，本来也不是本站 token。）
- 本环境此刻连 CF 自建 widget 都建不起来，Chrome 完全一样 ⇒ 卡点在出口/配置侧，引擎侧没有可改项。
- 出口只有一条数据中心 IP（见上一节），所以"换干净 IP"需要你提供；可用的同轮验证器已写好：
  `/tmp/inround-drive.py <port> <url> <seconds>` 会在同一轮里抓当轮 extraParams 并立即驱动渲染，
  命中就把 token 写进 `/tmp/warm-fiddle-token.txt`，从而排除"参数过期"这一支。

## 与真 Chrome 的 fp-trace 对拍（2026-09-16）

参考换成了 `assets/thelancet-trace/`：`Chromium-151` 带
`--enable-fingerprint-trace --fingerprint-trace-values=full --js-flags=--no-turbo-fast-api-calls`
的 `renderer-trace.log`（`FPTRACEJSON` 行）、`discard-trace.json` 与同轮的 HAR。对拍工具：

```bash
SKILL_DIR=".claude/skills/obscura-challenge-probe"
# realm 清单：一眼看出参考哪些 realm 我们根本没有（本轮：参考有两个真 blob worker，我们 0）
python3 $SKILL_DIR/scripts/fptrace_diff.py realms assets/thelancet-trace/renderer-trace.log
# 按参考的名字空间对计数 / 列「参考调过我们没调过」
python3 $SKILL_DIR/scripts/fptrace_diff.py counts  assets/thelancet-trace/renderer-trace.log /tmp/our/api.jsonl
python3 $SKILL_DIR/scripts/fptrace_diff.py missing assets/thelancet-trace/renderer-trace.log /tmp/our/api.jsonl
# 某个 API 的 值 分布（args -> result），按 realm 过滤
python3 $SKILL_DIR/scripts/fptrace_diff.py values assets/thelancet-trace/renderer-trace.log /tmp/our/api.jsonl \
  --api Navigator.hardwareConcurrency --realm worker
```

我们侧采集（trace 会显著拖慢页面，只取静态命名访问才可能在一轮内跑完）：

```bash
--trace-api-file /tmp/our/api.jsonl --trace-api-format jsonl --trace-api-calls --trace-api-keyed off
```

**名字空间必须裁剪。** 参考只记 blink/v8 原生访问；我们记所有静态命名访问，其中绝大多数是 VM 在
普通对象上的混淆读写（`Object.gA` 一类，单轮 200 万条里占 98%）。按 interface 裁剪不够——它们和真
builtin 共用 `Object`；要按**参考出现过的完整名字**裁剪，这正是 `fptrace_diff.py` 做的。

### 三条新测量盲区

- **我们的 native trace 不记录 V8 builtin 快路径**。参考带 `--no-turbo-fast-api-calls`，能记
  `Date.now`、`Number.parseInt`、`TextEncoder.encode`、`SubtleCrypto.digest`、`BigInt`、
  `Object.getOwnPropertyNames`；我们的 bytecode 探针一条都不出（`grep '"name":"Date\.'` = 0，而
  `performance.now` 有）。**「参考调过、我们没调过」不能直接当缺失 API**，先按名字空间与可表达性裁剪。
- **嵌套 MITM 代理会把上游不可 MITM 的请求变成 502**。本地 `mitmdump --mode upstream:http://…` 落盘的
  502 带 `server: mitmproxy 9.0.1`，是**本地那层**生成的，不是上游代理或源的失败。判「源是否失败」前先看
  这个头。上一轮把 `brunhild/.../i/` 的 502 记成上游问题就踩了这个坑（用 `curl -x <上游>` 复现一次即可定性）。
- **HAR 的 `bodySize` 是压缩长度**，`content.size` 才是解压长度。拿 `bodySize` 与引擎自己打印的字节数
  比较，会得到「我们的响应大 3 倍」这类跨整轮的系统性假差异。

### 事故与恢复：不要对未提交文件用 `git checkout`

本仓库的排查工作大量存在于**未提交的工作树**里，`git checkout -- <file>` 会静默丢掉整段前序工作。
本轮误用一次，恢复办法（对所有 include_str! 进二进制的 JS 都适用）：

1. 在**改动之前**构建过的产物里找该文件的原文：`target/release/build/obscura-js-*/out/bootstrap.js`
   （build.rs 产出的拼接包）或 `target/release/deps/obscura-<hash>`（旧二进制）。
2. 用文件首行注释与末行语句做锚点把整段切出来，`node --check` 验语法。
3. 用 `git log -S"<文件里某标识符>"` 判断这段是否**从未进过任何提交**——是，则它就是未提交的前序工作，
   覆盖回去即恢复。

事后核对：`find crates/obscura-js/js -name '*.js' -exec stat …` 看前序会话最后一次改动时间，
比该时间更早的产物才是可信的恢复源。

## 让 Obscura 轮产出 ov2 tracelog（2026-09-16）

上游 9000 链路注入的 `ov2.js` **没有** `window.external.tracelog` 调用点，所以直接跑任何引擎都拿不到
`ov2.*` 记录。做法是在本机加一层 mitmdump，把 widget 文档的内联脚本**二次替换**成操作者生成器的
插桩版本（`cf5s/chanllenge/ov2/ov2-0916-11.stage3.js`，由 `instrument_0916_11.py --stage 3` 生成）：

```bash
mitmdump --ssl-insecure --mode upstream:http://192.168.3.57:9000 \
  --listen-port 8897 -s /tmp/goal/instrument.py      # 见 profile step 260 的 addon 说明
obscura serve --port 9350 --proxy http://127.0.0.1:8897 --stealth \
  --user-agent "$REF_UA" --fingerprint '{"language":"zh-CN"}' \
  --tracelog-file /tmp/out/tracelog.jsonl
```

**插桩版是静态捕获，会污染轮**：它写死了捕获那一轮的会话值。实测 stage3 里硬编码旧 fo 端点
`1167067879:1789524309:...`，引擎照着 POST，CF 回 **400**，widget 于是在 payload 里上报
`{"QJDyx5":400,"qcMvE9":"600010"}`。**未插桩轮从不发这些请求**。所以：

- 插桩轮只看**格式/早期阶段**（boot、dispatch、handlers、host ops、payload 阶段结构）；
- 插桩轮里的任何失败码（400/600010）**不得当作引擎证据**；
- 要同上下文的值级对拍，需要「同轮内生成、会话值最新」的插桩脚本。

## 无侵入 payload 捕获（前置安装器）

不想改挑战代码、又想看 payload 边界时：把一段安装器**前置**到响应文本里，它只做包装并写
`window.external.tracelog`。要点：

- **必须也覆盖 interstitial 的自己的内联脚本**（`<script nonce=...>` 开头插）。它是文档里第一个
  执行的脚本，质询在这里就缓存原生引用，挂在 fetched 脚本上已经太晚（与「预注入探针」同一条道理）。
- 注意 403 也是要处理的响应（interstitial 是 403，不是 200）。
- 包装 `TextEncoder.prototype.encode` 能直接拿到**最终 payload 字符串**（base64 形态）与 worker 源码；
  包装 `JSON.stringify`/`btoa` 在 CF 这条路径上**什么都没捕到**（JSON 是字符串拼接、base64 是自己实现的）。
- 捕获物里能看到质询对 worker 消息的硬要求：
  `onmessage=function(e){e.isTrusted&&''===e.origin&&null===e.source&&eval(...)}`。
- 最终 payload 字符串**是加密的**：按 `$`→`+` 还原后 raw-deflate/zlib 在 0..400 全偏移都失败，
  离线无会话密钥不可解。要字段级内容只能插桩产生它的那个 VM 的 builder。

## 当轮新鲜（in-flight）插桩：在响应文本里前置安装器

比服务一份静态插桩构建更好的做法：在**当轮响应**里前置安装器（覆盖 interstitial 的内联脚本、
`orchestrate/chl_page/v1`、`api.js`、以及 widget 文档自己的内联脚本）。会话值保持新鲜，轮本身不被污染。

- **引擎全局不可写**：`W.postMessage = f`、`W.btoa = f` 这类赋值在 sloppy 模式下**静默失败**，
  必须 `Object.defineProperty(obj, name, {value, writable: true, configurable: true})`。
  这是「挂了却什么都没捕到」的常见原因。
- **一定要覆盖文档的第一个内联脚本**：质询在那里就缓存了原生引用，挂到 fetched 脚本上太晚。
  interstitial 是 **403** 文档，别用「只处理 200」的早退把它跳掉。
- 每个包装必须自带 try/catch 且 `return orig.apply(this, arguments)`；构造函数（Blob/Response）用
  `apply` 转发会抛（class 必须 `new`），捕获即可，不要让它影响页面。
- 捕到但**没用**的边界（CF 这条路径）：`JSON.stringify`（顶层 payload 不是它产生的）、`btoa`、
  `subtle.encrypt`、`CompressionStream`、`Blob`/`Response`、`join`。**有效**的边界：
  `subtle.digest` 的**输入**（测量缓冲）、`TextEncoder.encode` 的**输入**（最终 payload 串、worker 源码）。
- 想拿「明文 JSON」时先问清楚：如果 VM 用字符串拼接 + 自实现压缩/keystream 加密，主机侧无边界可挂，
  只能给 VM 本身插桩（见 profile step 261）。

## 区分「重试」与「完成」：把导航入口全部包装

质询通过时客户端会**导航回目标 URL**（CF 的 interstitial 是 form POST，带 `__cf_chl_tk` referer，
`sec-fetch-mode: navigate`）；未通过时它会**重试**（本环境观察到的是重新 GET 目标 → 新一轮
orchestrate）。要判定自己卡在哪一侧，把六类入口一起包装（少一个就会误判）：
`HTMLFormElement.prototype.submit` / `requestSubmit`、`Location.prototype.assign` / `replace`、
`Location.prototype.href` 的 **setter**、`Window.open`、`HTMLElement.prototype.click`。
包装 form.submit 时把 `this.action`/`this.method`/`this.elements` 的 name+value 一起记下来，
那就是即将提交的字段级内容。

**判据不要只看 status/长度**：`/fo/` 成功与失败路径**都可能**下发 `cf-chl-out` 与
`cf_clearance`（本环境两侧都有，长度 133 vs 153/177）。要判断是否真的通过，只看目标 URL 的
**真实响应**（404/200）与客户端是否发出那次导航。

**`/fo/` 的响应体是不可读的加密块**（同一套自定义字母表，非 HTML、非 base64+deflate 可解），
所以「读响应内容看 CF 说什么」不成立；决策信息只能靠给 VM 插桩或拿到会话密钥。

## 审计「真浏览器不会有的东西」：`for..in` 是关键盲区（2026-09-16）

反射过滤都是 JS 层的（本引擎补了 `Object.getOwnPropertyNames` / `Reflect.ownKeys` / `Object.keys` /
`Object.getOwnPropertyDescriptors`），**但 `for..in` 由 V8 直接遍历属性表，绕过全部 JS 层过滤**。
所以审计引擎内部全局时，四件套都要跑，`for..in` 最容易漏：

```js
for (var k in window) if (/obscura|Obscura|Deno|^__blob/.test(k)) console.log(k);
Object.getOwnPropertyDescriptor(window, '__obscura_natural_type');  // 单数 API 也没被过滤
```

本引擎实测：`getOwnPropertyNames` 干净，而 `for..in` 列出 **19 个** `__obscura_*` 自有可枚举属性
（修前）。真浏览器一个都没有。

**修法（本引擎已落地）**：命名空间驱动的「可枚举性清扫」——用 `for..in` 找出自身可枚举的引擎命名空间
全局，逐个 `Object.defineProperty(globalThis, name, {enumerable: false})`（幂等、try/catch），
在 page-init 的 hide 循环后调用，并在运行时新装全局之后**再调一次**
（`__obscura_hide_engine_globals`）。快照期的 `__obscura_hide_list` 只能覆盖快照期存在的名字，
运行时创建的（interaction policy、crypto clone hook、measure 助手等）必须靠这条清扫。
判定修好没有：`for..in` 泄漏数 19 → 0，frame realm 同样为 0。

## Reading the `/fo/` bytecode yourself, and why a saved pristine is not your session

**The response transform is published and needs no session key.** The ray used as the seed is in
each `/fo/` URL (`/fo/<hash>/<16 hex ray>/<token>`), so responses decode from our own capture.
`scripts/ov1_decode.py HAR [--outdir DIR] [--label L]` implements it and prints
`stage1/stage2/bytecode` sizes plus md5 per `/fo/` response.

Two checks before trusting any decode, both cheap:

1. **The second layer must be pure base64.** The VM hands the decoded text to `atob`, so a correct
   seed always yields `b64frac = 1.000`. A wrong seed shifts every byte by a constant
   (`(Uk_true - Uk_used) mod 255`) and breaks the alphabet almost immediately.
2. **Per-entry ray, not one global ray.** A HAR that holds two challenge rounds has two rays. The
   operator's `decode-ov1.mjs --index all` takes one ray from the first `_cf_chl_opt` block and then
   reports DIVERGENT with garbage sizes on such a HAR; that is the tool's assumption, not a finding
   about the site.

**Do not assume a saved VM build describes your session.** Measured on one session: two loads of
`orchestrate/chl_page/v1` are 94.25% identical (same size, different md5), while our program shares
only 8.63% with the operator's `ov2-0916-11.pristine.js`, largest common block 446 B. A later round
fetched a program 7975 B larger. Consequences: the anchor/dispatch tables of a saved build do not
transfer, and the entry chain check is the fast tell. Feed the blobs to that engine in a scratch
copy and read the header: at `(pc=0, key=241)` a matching build decodes `op=84 = cl` and reports a
non-empty canonical linear chain; a mismatched one decodes an op outside `opToHandler`, reports
`dynamicReachable = 0`, and renders a small fraction of the instructions.

`scripts/ov1_strprobe.py BLOB needle...` inverts the VM string encoding
(`plaintext = Uk ^ ((b+245)&255) ^ 120`, per-string key searched over all 256 values) and is the
cheapest build check: the reference's stage-3 blob yields `_cf_chl_opt`, `postMessage`, `widgetId`,
`token`, `source`; a build we cannot read yields none of them, and none of `document`, `Date`,
`window`, `length` either. `scripts/ov1_bcdiff.py A.bin B.bin` shows common prefix/suffix and the
divergent windows; expect ~0.3% byte agreement across sessions even for the same-length program, so
byte diffing is only useful inside a build.

**`/fo/` request payloads.** 64-char alphabet including `$`, `+`, `-`, with `$` and `-` acting as
field separators; the payload grows across the three round trips and repeats a session-constant
prefix (ours 4983 to 90850 to 95340 chars; reference 4599 to 88535 to 91724). `$`-joined base64
pairs also appear as literals in the page program source, so the `$` shape is the format's, not an
artifact of one field.

**Where the payload builder runs.** The `/fo/` POSTs are issued from `blob:` workers: the page's
`fetch` and `XMLHttpRequest` wrappers never see them, while four `blob:` worker scripts appear in
the run log. The tracelog sink is window-only (`realm.rs` sets
`globalThis.__obscura_tracelog_enabled` for frames and installs `External.tracelog`;
`env/worker/dedicated-worker.js` has no `external`), so an injected snippet that starts with
`var W = window` throws in a worker realm and its own `catch` swallows it, producing zero records
with no error anywhere. Worker-realm instrumentation needs its own sink (postMessage forwarding, or
a `self.external.tracelog` added to the worker bootstrap).

**The seam that does work in a window realm.** `scripts/inject-runprogram-probe.py` patches the
global `runProgram` through an accessor (the VM assigns it with plain assignment, so a setter
catches the definition and the bare identifier then resolves to the wrapper) and logs its first
argument, plus `Function`, `fetch`, and `XMLHttpRequest.open/send`. One 30 s round gave 17889
`rp.call` records, all the same 6032-char standard-base64 page program re-run per event. Wrapping
after page start is too late for cached natives: the snippet must be prepended to the inline script
of `/1.txt` and of the turnstile widget document, and to the JS responses.

## A probe the challenge does not detect, and how to reach the worker realm

**Instrumented runs must be silent about themselves.** A wrapper that changes what the VM can observe
stops the run *before* the stage you wanted to watch: with the probe present, our runs made 0 `/fo/` POSTs
and the engine looked broken. What the VM reads: `Function.prototype.toString` on builtins (so every
wrapper needs `name`, `length`, and `toString()` answering the original's exact text), the property
descriptor flags (a WebIDL global operation is enumerable; a redefined non-enumerable one shows up in a
`for..in` audit), and the prototype chain (`Worker` wrapped without `wrapped.prototype = orig.prototype`
loses `terminate`, `addEventListener` and every other inherited method off each instance). Do not leave a
guard property on the global either; the preload runs once per document, so no guard is needed.

`scripts/challenge-realm-probe.js` is that probe. `scripts/cdp_click_clean.py --preload-file` hands it to
`Page.addScriptToEvaluateOnNewDocument`, which the engine applies to **every committed frame realm**, so it
covers the widget iframe and srcdoc frames that HTML rewriting misses. Bisect seams with `var ON = 'fabxwre'`
(f fetch, a atob, b btoa, x XMLHttpRequest, w Worker, r runProgram, e eval): a single bad seam takes the run
from 6 `/fo/` POSTs to 0, which is how the self-recursion in the first `runProgram` wrapper was found.

**The `/fo/` traffic does go through the page's `fetch`**: the stack is `fetch ← XMLHttpRequest.send ←
orchestrate/chl_page/v1`, because the engine's XHR delegates to the same entry point. If a probe sees no
`/fo/` requests, the probe is what is broken.

**Reaching inside a worker.** The challenge posts its worker tasks as classic source through
`Worker.prototype.postMessage`, and (with the blob-worker stub) the engine evaluates that source in the
creating document. Prepending observer code to that string puts the observer inside whatever scope the task
ends up running in; it reports through `external.tracelog`, which the worker prep installs when
`--tracelog-file` is set (that sink is window-only without `worker_prep_script`'s install). This is how the
worker-side probe replies (`{"hIup0":"MacIntel",…}`, `{"uUOw3":…}`, `{"graIf9":…}`) were captured.

**Comparing against the reference.** `assets/tracelog-0916-11.jsonl` is the passing real-Chrome run and
carries the same probe fields, so read it by field: `uUOw3` storage flush duration (10.6 ms there, an error
or 0 here), `gQTuX1` fetch rejection text (`TypeError: Failed to fetch` there), `vVsCr9` minimum
`performance.now()` delta (`0.09999990463256836` there, an unclamped double here), `graIf9` compute shard
(2658 iterations in 2.9 s there, 10822 in 22.9 s here).

**Decode validation.** `scripts/ov1_decode.py` output must equal what the VM itself feeds to
`runProgram`; a run with the probe installed captures both sides (`rp.atob` input/output heads and
`rp.runProgram` head/middle/tail) so the check is one comparison, not an argument. Never compare a decode
from one session against program text from another: that mistake produced both wrong conclusions in step 265
of `docs/Cloudflare-challenge-profile.md`, retracted in step 266.

## Attributing a "slow realm" claim before believing it

A cross-session comparison of the challenge's own counters is not a throughput measurement. `graIf9`
carries the session's ray and timestamp plus a per-session count, and `WrTo7` varies between sessions, so
"2658 in 2.9 s there, 10822 in 22.9 s here" compares two different searches. Measure the realm directly
instead: `scripts/realm-bench.js` runs an arithmetic loop, a `charCodeAt`/`slice` string loop, and a float
loop, warmed up identically, in the page realm and in a worker (`new Worker('data:text/javascript,…')`,
which the engine does spawn as a real isolate). Measured here: page 2.80 / 1.10 / 6.90 ms, worker 2.40 /
1.10 / 7.10 ms, node 22 5.65 / 3.41 / 7.85 ms for the same work. Equal or better than stock V8 in both
realms means the counters are not reporting an engine-wide slowdown, and the difference is in that one
script.

Two diagnostics that answer "is it computing or waiting" without touching the page:

- **CPU sampling.** During the stall, `ps -o %cpu= -p $(pgrep -f "obscura serve --port N")` every 5 s
  alongside the `/fo/` POST count. 13-26% while the round trips happen, then 1.6-3.4% for the rest of a
  70 s run: the engine is *waiting*, not burning cycles on a proof of work.
- **Host-side op stream, not the API stream.** `--trace-api-file … --trace-api-keyed off` emits only
  statically named accesses, which drops exactly what the VM does (its keys are computed), so an
  8-record trace that stops early proves nothing about what the VM awaited. Use `--trace-op-file` to see
  the last host-op crossing before the stall.

Blob workers: the engine's stub evaluates posted classic source in the creating document, so a challenge
probe that needs a worker-only API (the OPFS sync access handle, for instance) reports an error where the
reference reports a duration. Letting the blob's own text (`globalThis.__blobStore[href]`, the
challenge's `onmessage -> eval` bootstrap) spawn an isolate fixes that and is closer to the platform, but
it changes a documented contract that four tests guard, and one of them aborts on a Tokio-runtime panic
inside `op_worker_recv` because that test has no runtime. Measure it with `--preload-file` runs before
adopting it: in one run it reached all twelve worker probes including the compute and produced the final
handoff shape, in the next four runs the flow stopped after the second widget response either way.

## Reading the host-op stream, and the worker-isolate contract

`--trace-op-file OUT.tsv` writes one row per host-op crossing (`timestamp_us, from, operation, arg1,
arg2, arg3, result`) and is the right instrument for "what is the VM doing / waiting on" questions, where
the JS-level API trace is blind (it drops computed-key accesses by design). Two reads worth doing on
every stalled run: group by `operation` (a run dominated by `dom` means the page is doing layout work,
not waiting), and print the last rows with their `from` label (that names the script that was working when
the window closed). Measured on a stalled challenge run: ~60% of the crossing count is `op_dom` from the
widget's own script while it probes the DOM it built, and the last events are worker task posts, so the
window closed while the flow was still active rather than parked.

Blob workers: the engine runs a blob's own text in an isolate when `globalThis.__blobStore[href]` has it,
and posts go to that isolate so the blob's `onmessage -> eval` bootstrap evaluates the task inside a
worker scope. The document-eval stub survives only for a blob with no text. Consequences to keep in mind
when writing or reading tests of this path: inside the worker scope `typeof document` is `"undefined"`
(answering `"object"` means the source ran in the creating document), worker-only APIs exist
(`FileSystemSyncAccessHandle`, the worker navigator), and a relative `Request`/`fetch` still resolves
against the creator's origin. `op_worker_recv` returns an empty batch when no Tokio runtime is present,
because awaiting a Tokio primitive from a v8 callback frame panics in a way that aborts the process.
