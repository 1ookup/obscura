---
name: obscura-challenge-probe
description: >
  诊断 obscura 跑不通某个页面的原因——尤其是 Cloudflare Turnstile / 5 秒盾这类
  依赖 iframe、closed shadow root、跨源 postMessage 与 realm 隔离的反检测质询。
  提供带 stealth + 代理 + V8 trace 的复现命令、CDP 预注入探针（拿 postMessage
  完整内容、穿透 closed shadow root 找 iframe）、frame realm 相对 URL 归属探针，
  以及与浏览器 HAR 逐条对比的方法。当用户问「obscura 为什么过不了这个盾 /
  iframe 里的 JS 有没有执行 / 挑战卡在哪一步 / 帮我分析这个 HAR / 用 v8 trace
  看看页面在干什么」时使用本技能。
---

# obscura 质询页诊断

回答三个问题：**①卡在哪一步？②是 obscura 的缺陷还是页面的正常行为？③下一步查什么？**

方法论比脚本重要——这类排查里**最容易出错的是观测手段本身**，本文档大半篇幅在讲
怎样不被自己的探针骗到。完整案例见 `docs/Cloudflare-challenge-profile.md`。

## 前置

```bash
# 必须带 stealth feature 构建
V8_FROM_SOURCE=1 cargo build --release -p obscura-cli --bins \
  --features render,stealth \
  --config 'patch.crates-io.v8.path="vendor/rusty_v8"'

# MITM 代理的 CA 证书；不给这个则 TLS 校验失败，整轮观测为空
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
```

## 第一步：与浏览器 HAR 对比

**先做这一步。** 拿真实浏览器过一遍同一 URL 导出 HAR，再让 obscura 跑一遍，
逐条比请求序列。差异出现的位置就是断点，比任何猜测都准。

```bash
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura fetch <URL> --dump text --proxy http://127.0.0.1:9000 --stealth \
  --timeout 90 --wait 40 --screenshot /tmp/run.png
```

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
scripts/cdp_probe.py messages <URL> --wait 35

# 穿透 closed shadow root 列出 iframe（普通查询看不到）
scripts/cdp_probe.py shadow <URL> --wait 25

# 任意表达式
scripts/cdp_probe.py eval <URL> --expr 'document.querySelectorAll("iframe").length'
```

`messages` 模式能拿到 `{"source":"cloudflare-challenge","event":"overrunBegin",...}`
这类完整负载。心跳类消息（`food`）自动折叠计数。

## 第三步：frame realm 相对 URL 归属

跨源 iframe 里每个 API 发一次请求，看落到哪个服务器：

```bash
scripts/realm_probe.sh
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
| 某请求发出没有 | frame 导航路径不打印 URL，只有 `op_fetch_url` 打印 |

## 测量盲区（这一节最重要）

以下每条都实际导致过错误结论：

| 盲区 | 症状 | 正确做法 |
|------|------|----------|
| `querySelectorAll` 不穿透 shadow；closed root 的 `el.shadowRoot` 为 `null` | 误判「iframe 从未插入 DOM」 | 预注入截获 `attachShadow` 保留 root 引用（`cdp_probe.py shadow`） |
| frame 导航不打印 URL | 误判「iframe 文档从未被请求」 | 看 `starting new connection` / `Cookie header for <host>`，或直接插桩 |
| 混淆代码的字符串表会「返回」错误字符串 | 把 `unsupportedbrowser`、`invalidsitekey` 当成被触发的错误 | 看调用形态：`CALL Window.g(<数字>)` → `RET object:Array` → `RET string:"..."` 是查表 |
| **包装 DOM 访问器会改变被测行为** | 包了 `contentWindow` getter 后握手消息直接消失，整轮数据作废 | 先用可控用例验证同一机制是否正常，再决定要不要在真实页面上挂钩 |
| Cloudflare 失败路径也下发 `cf_clearance` | 误判「过盾成功」 | 判据是 `cf_chl_rc_ni` 等结果码，以及复用该 cookie 能否拿到真实内容 |
| 自己加的日志截断字段 | 把截断后的 src 当成完整 URL，误判是另一个元素 | 日志里带上长度，或不截断关键字段 |

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
5. 若怀疑 URL 解析：`realm_probe.sh`
6. 结构性假设穷尽后**改用插桩**，不要继续猜

第 6 步的教训：一轮排查里连续五个结构性假设（shadow root、iframe 属性、跨源、
CSP、创建时机）全部用本地用例复现通过，真因是靠给队列入队/消费两端加日志找到的。
猜三次不中就该插桩。
