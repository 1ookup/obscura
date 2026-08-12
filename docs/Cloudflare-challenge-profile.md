# Cloudflare 挑战：诊断记录

针对 `zencare.co` 的 Cloudflare Turnstile 托管质询（5 秒盾）的逐步排查记录。
按 step 追加，每步记录**假设 / 方法 / 证据 / 结论**。被证伪的假设一并保留——
它们标出了不必再走的路。

当前状态：**未通过**，但 step 12 让流程第一次真正前进：请求序列 4 条 → 5 条。
已修掉六处真实缺陷（step 4、5、8、11、12、13）。失败模式已从「超时」
变为「被判定需要交互」（`interactiveBegin`，见 step 13 末尾）。

## 复现

```bash
REQABLE_CA="$HOME/Library/Application Support/com.reqable.macosx/certificate/reqable-root.crt"
SSL_CERT_FILE="$REQABLE_CA" OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  obscura --v8-flags "--trace --trace-property-lookup --no-lazy-feedback-allocation \
    --trace-property-lookup-file=/tmp/trace.tsv" \
  fetch https://zencare.co/1.txt \
  --dump text --proxy http://127.0.0.1:9000 --stealth --timeout 90 --wait 40
```

封装见 `vendor/zencare-test.sh`（`run` / `report`）。trace 格式与 flag 语义见
[Trace-page-script.md](Trace-page-script.md)。

## 基线：浏览器 vs obscura

真实浏览器 HAR：**15 个请求，2.1 秒**，以 `POST /1.txt → 404` 收尾（404 即过盾成功，
该路径本就不存在）。

```
#2  GET  zencare.co/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1
#3  GET  challenges.cloudflare.com/turnstile/v0/g/<sitekey>/api.js
#5  POST zencare.co/cdn-cgi/challenge-platform/h/g/fo/<tokenA>
#6  GET  challenges.cloudflare.com/.../turnstile/f/av0/rch/<widget>   ← iframe 文档
#7  POST challenges.cloudflare.com/.../fo/<tokenB>                    ← 发自 iframe 内
#9  GET  .../pat/...  → 401
#10 GET  .../ci/...   → 200 image/png
#12 POST .../fo/<tokenB>  → 200
#13 POST zencare.co/.../fo/<tokenA>  → 200
#14 POST zencare.co/1.txt → 404
```

obscura 只发出前三个，且 `<tokenB>` 的 POST 发往了 `zencare.co` 而非
`challenges.cloudflare.com`——相对路径解析到了错误的源。

widget 的 postMessage 时间线（CDP 预注入钩子采集）：

| 事件 | 含义 |
|------|------|
| `init` / `requestExtraParams` / `translationInit` | 握手，正常 |
| `food` seq N | 心跳，持续到等待结束 |
| `overrunBegin` | **Turnstile 自报验证超时** |
| `complete` | 从未出现 |

## Step 记录

### Step 1 — V8 watchdog 假设：**证伪**

假设 obscura 的 `V8 watchdog fired: terminated a synchronous overrun` 打断了挑战计算，
与 `overrunBegin` 是同一事件。

用 CDP 采集 widget 事件时间戳，对齐 obscura 日志：该次运行 watchdog **完全没有触发**，
而 `overrunBegin` 照常在 13.4s 出现。两者无因果关系。

### Step 2 — 五个结构性假设：**全部证伪**

每个都用本地最小用例复现，全部正常加载，不是阻塞原因：

| 假设 | 用例 | 结果 |
|------|------|------|
| closed shadow root 阻断导航 | light / open / closed 三种插入 | 全部加载 |
| `sandbox` / `display:none` / `allow` 属性阻断 | 逐个加回 Turnstile 的属性 | 全部加载 |
| 跨源 iframe 导航未实现 | 两个本地端口构造跨源 | 加载 |
| CSP `frame-src` 误拦 | 同形状 CSP + 跨源 | 加载 |
| 加载后才创建（3s）导致丢失 | setTimeout 内创建 | 加载 |

### Step 3 — 插桩定位：找到真因

结构性猜测穷尽后改用插桩，给 `op_queue_iframe_navigation` 与
`process_pending_frame_navigations` 加临时日志（已在提交前移除）。

关键在于构造出**中间隔着一次 process pass** 的复现：

```js
var host = document.createElement('div');          // 游离
var root = host.attachShadow({mode: 'closed'});
var f = document.createElement('iframe');
f.setAttribute('src', '<cross-origin>');           // 入队（此时 host 未连接）
root.appendChild(f);
setTimeout(function () { document.body.appendChild(host); }, 800);  // ← 任务边界
```

修复前 iframe 不加载，这是此前所有用例都缺的一环——它们全在同一同步块内完成，
队列项一直留到 host 连接之后才被消费。

### Step 4 — 修复：shadow 子树中的 iframe 拿不到 browsing context

需要两件事同时成立：

1. 设 `src` 会入队导航，但消费端在 host 尚无 browsing context 时**静默丢弃**
   （`continue`）——子树游离时它就是没有
2. 本该在子树连接时补上入队的插入步骤，用 `querySelectorAll` 枚举 iframe，
   **不穿透 shadow 边界**

于是队列项在 host 连接前被消费掉，之后无人补位，frame 永远是空壳。

修复：把已有的穿透 shadow 的遍历
（`iframe_hosts_in_shadow_including_subtree`）暴露给插入步骤，并修正它自身的缺陷
——它从 root 的**子节点**开始播种，因而跳过 root 自己的 shadow tree，而插入步骤
传入的 root 恰恰就是 shadow host。

效果（同一 widget，CDP 时间线）：

| 事件 | 修复前 | 修复后 |
|------|--------|--------|
| `requestExtraParams` → `translationInit` | 3417 ms（空档 2.9 s） | 1229 ms（0.67 s） |
| `overrunBegin` | 13408 ms | 11576 ms |
| 完成 | 否 | 否 |

提交 `3e36fbe`。回归测试见 `crates/obscura-dom/src/tree.rs`
（`browser_iframe_discovery_enters_the_roots_own_shadow_tree`）。

### Step 5 — iframe 内 JS 确实执行，但相对 URL 解析到了顶层页面

step 4 之后 obscura 自己的抓包显示 iframe 文档已被拉取
（`GET .../turnstile/f/av0/rch/<widget>` → 200 text/html，268 KB），随后出现一条
**400**：

```
POST zencare.co/cdn-cgi/challenge-platform/h/g/fo/<tokenB>   → 400
     请求头 origin: https://challenges.cloudflare.com
```

`Origin` 头是对的——**iframe 内的脚本确实在自己的 realm 里执行**，不是没执行、
也不是报错后 postMessage 通知父窗口。错的只是主机：浏览器把同一 `<tokenB>`
POST 到 `challenges.cloudflare.com` 并得到 200。

用跨源 iframe 逐个 API 发一次请求、看哪个服务器收到，定位到基准 URL 的分歧：

| API | 修复前落点 | 修复后 |
|-----|-----------|--------|
| `location.href` / `document.URL` / `baseURI` | iframe 源 | — |
| `fetch('/x')`、`<script src>` | iframe 源 | — |
| `XMLHttpRequest.open(m, '/x')` | **页面源** | iframe 源 |
| `<a href>` | **页面源** | iframe 源 |
| `<form action>` | **页面源** | iframe 源 |
| `new Image().src` | **页面源** | 仍是页面源，见 step 11 |

成因：这几处都以 Rust 侧的 `document_url`（顶层页面 URL）为基准，而 `fetch`
用的是 `location`，每个 frame realm 各有其一。挑战用 XHR 发 `/fo/` POST，于是
打到了 embedder。提交 `d0043eb`。

Image 当时未修：它走 `op_load_image_metadata`，在 Rust 侧由 `document_base_url()`
按页面 URL 解析。已在 step 11 修掉。

### v8 trace 取不到 postMessage 内容

trace 的参数捕获靠 `frame->GetParameter(i)`，只对普通 JS 函数帧有效。
`globalThis.postMessage` 是 native 绑定，帧上没有参数：

```
CALL  Window  globalThis.postMessage  pm.html  4:8   args=[]
CALL  XMLHttpRequest  open  ...  string:"POST", string:"/cdn-cgi/..."   ← 对照，普通 JS 方法
```

对象负载即使被捕获也只会渲染成 `object:Object`（`TraceAppendValue` 不调用
`toString`/accessor，无副作用是刻意的）。字符串负载同样为空——实测三种形态
（对象 / 字符串 / JSON 字符串）在 trace 中均无内容。

**要拿 postMessage 内容用 CDP 预注入**，本文件多处时间线即由此采集：

```js
// Page.addScriptToEvaluateOnNewDocument
window.addEventListener('message', function (e) {
  window.__pm.push({ t: Date.now() - window.__t0, origin: e.origin, data: e.data });
});
```

这能拿到完整内容，例如
`{"source":"cloudflare-challenge","widgetId":"...","event":"overrunBegin"}`。

### Step 6 — CDP 预注入：完整消息内容，与父→子通道的验证

step 5 之后重跑，用预注入拿到完整负载：

```
  617 ms  {"source":"cloudflare-challenge","widgetId":"ievvq","event":"init",
           "mode":"managed","nextRcV":"..."}
  619 ms  {"source":"cloudflare-challenge","widgetId":"ievvq","event":"requestExtraParams"}
 2786 ms  {"source":"cloudflare-challenge","widgetId":"ievvq","event":"translationInit",
           "displayLanguage":"en-us",...}
13008 ms  {"source":"cloudflare-challenge","widgetId":"ievvq","event":"overrunBegin"}
 food x42 ；无 complete；页面无任何错误事件
```

`requestExtraParams` 是**子窗口向父窗口要参数**，其后的 2.2 s 空档正卡在这里。

想抓父→子方向时包装了 `HTMLIFrameElement.prototype.contentWindow` 的 getter，
结果 `translationInit` 与 food 心跳一并消失——**钩子本身扰动了流程，该次测量作废**。
在真实页面上包装 DOM 访问器要先确认它不改变被测行为。

改用可控用例验证父→子通道，三项均正常：

```
IN   child→parent   {"source":"child","event":"requestExtraParams"}
OUT  parent→iframe  未抛异常
IN   child→parent   {"reply":"via-e.source"}      ← 子窗口收到并经 e.source 回复
     子窗口 got[0].from = <父窗口 origin>          ← origin 归属正确
```

投递、`e.source`、origin 三者都对。所以真实场景中父窗口若未回应
`requestExtraParams`，原因在 api.js 自身的逻辑路径，而非通道不通——**这一点尚未证实**。

### Step 7 — 先补上被吞掉的异常，否则看不见任何东西

step 6 之后的断点是：iframe 内的 XHR 取回 822 KB 的 JSVMP 载荷（`POST
challenges.cloudflare.com/.../fo/<tokenB>` → 200）之后，32 秒内再无任何请求。

第一轮排查全是空手而归，原因是**三条报错路径全被静默 catch 掉了**：

| 位置 | 原代码 | 后果 |
|------|--------|------|
| XHR `_fireEvent` 的监听器与 `on*` 属性 | `catch(e) {}` | 处理器抛异常等同于「页面自己不发请求了」 |
| XHR `_setReadyState` 的 `onreadystatechange` | `catch(e) {}` | 同上 |
| `onunhandledrejection` | 只 `preventDefault()` | promise 链断裂无痕 |

按规范，处理器抛出的异常不中断派发，但要**被上报**。改成上报后（`console.error`
→ `op_console_msg`）重跑，确认：**没有任何 JS 异常**。这是个否定结论，但它把
「代码报错了」这条线彻底排除，比继续猜有价值。

配套确认（避免又一次被自己的探针骗）：先用 `nonexistent.invalid` + 抛异常的
`onerror` 做对照，证明这条日志通道确实会打印，再采信真实页面上的「零输出」。

顺带查明的事实，各自用探针实测：

- 载荷**确实送达 JS**：给 stealth 路径补了完成日志，`POST .../fo/<tokenB> → 200
  (822544 bytes)`。
- `onreadystatechange` 是函数并被调用；`onload` 为 `null`（`typeof null ===
  "object"`，不是缺失）。
- 载荷到达后 iframe realm **一直在跑**：550 ms 的自续定时器链持续到测试结束，
  nesting 一路涨到 59。所以不是「卡死」，是「在等」。

### Step 8 — 修复：页面脚本的栈里带着引擎自己的文件名

用 CDP 之外的办法看父子通道：直接在 `op_post_to_frame` / `op_post_to_parent` /
接收循环三处打印完整载荷（不包装任何 DOM 访问器，避免 step 6 的翻车）。父窗口发给
widget 的 `extraParams` 里有一项 `cs`——**Cloudflare 采集的调用栈**，原样是：

```
"cs":[[0,40,"Error
    at ki (eval at execute (<obscura:bootstrap>:374:28), <anonymous>:1:19216)
    at ke (eval at execute (<obscura:bootstrap>:374:28), <anonymous>:1:19347)
    ... 共 10 帧，全部如此
```

引擎自己的文件名被页面收集后发回 Cloudflare。成因：外部脚本走
`(0, eval)(body)`，V8 会给 eval 出来的脚本的每一帧打上 eval origin。

**修法的两次转折，都由测试逼出来：**

1. `Deno.core.evalContext(source, url)` 能给出干净的 script origin，栈立刻正确。
   但它**永远在主 realm 求值**——既有测试
   `frame_realm_timer_callback_fires_in_its_realm` 当场变红。实测确认：frame 内调用
   它，`var` 落到了**顶层页面的全局对象**上（`main.FRAMEVAR=number`，
   `inFrame=undefined`）。这既是功能错误，也是跨 realm 泄漏。
2. 于是新增 `op_run_classic_script(source, url, globalThis)`。要点是**不能用 scope
   的当前 context**：`Deno.core.ops` 跨 realm 共享，op 回调作用域报的是 op 函数对象
   的创建 context（主 realm），与调用方无关。改为由调用方传入自己的 `globalThis`，
   取其 `get_creation_context()` 再 `ContextScope` 进去编译执行。

三处 `(0, eval)` 全部改用它：外部脚本（用脚本 URL）、动态内联脚本、字符串定时器
（后两者用本 realm 的 document URL，与浏览器一致）。

效果（同一页面，`cs` 字段实测）：

| | 修复前 | 修复后 |
|---|--------|--------|
| 属于页面脚本的帧 | 10 帧全是 `eval at execute (<obscura:bootstrap>…), <anonymous>` | 全部是真实 URL，如 `at ki (https://challenges.cloudflare.com/turnstile/v0/g/…/api.js:1:19216)` |
| `eval at` 注解 | 有 | 无 |
| 栈底 | — | 仍有 2 帧 `_runAtNesting (<obscura:bootstrap>:894:9)`（见未决） |

跨 realm 归属实测：`inFrame=number`、`who=<frame 的 document.URL>`、
`main.FRAMEVAR=undefined`，异常按值透传（`TypeError: boom`）。

回归测试：`crates/obscura-js/src/runtime.rs`
（`a_fetched_script_stack_names_its_url_and_not_the_engine`、
`a_throwing_xhr_handler_is_reported_and_does_not_stop_the_others`）。

**但流程没有推进**——修复后重跑，请求序列仍是同样 4 条。所以栈泄漏是真缺陷，
不是（至少不是唯一的）阻塞点。

### Step 9 — 早期 timer 迟发 2.5 秒：目前最可疑的未修项

给 `setTimeout` 的调度与触发两端各打一条日志（只记 ≥300 ms 的），得到：

```
17:02:32.804 SCHED id=5 delay=1000     →  17:02:34.006 FIRE id=5     实际 1202 ms
17:00:08.774 SCHED id=5 delay=1000     →  17:00:11.287 FIRE id=5     实际 2513 ms
17:00:08.784 SCHED id=8 delay=550      →  17:00:11.286 FIRE id=8     实际 2502 ms
（同一次运行的稍后阶段）
17:00:12.546 SCHED id=15 delay=550     →  17:00:13.099 FIRE id=15    实际 553 ms  ✓
```

**迟发只发生在页面早期，之后恢复正常。** 而空白页对照组完全准确：
`50→53 100→102 250→252 550→553 1000→1003 2000→2003`。

这段迟发与卡顿一一对应：父窗口收到 `requestExtraParams`（09.179）到发出
`extraParams`（11.286）之间 2.11 秒里**所有 realm 一个定时器都没触发**，而
Cloudflare 自己测出的 `timeTiefMs` 就是 **2137**。迟发的定时器一旦触发，
`extraParams`、`translationInit`、心跳同一毫秒内全部涌出。

`sample` 主线程 1 秒（窗口对齐到卡顿区间）：**56% 停在 `kevent`（park），42% 在跑
JS**，其中 `op_layout_geometry → ensure_prepared_geometry` 占 11%。所以既不是纯 CPU
打满，也不是纯空转——是「跑一阵、park 一阵，但到期的 JS 定时器没被取走」。

**尚未定位到具体成因。** `settle_for_duration` 按 100 ms 切片轮转，单看它最多迟
100 ms，解释不了 650–2500 ms。下一步应当给 `run_cooperative_event_loop_tick` 的
每次 poll 与 park 时长插桩，而不是继续猜。

### Step 10 — Performance Timeline 整体为空（实测）

一次性把相关面全测了：

```
{"poerr":null, "poEntries":[], "getEntries":0, "resource":0, "navigation":0,
 "paint":0, "supported":"none", "timeOrigin":"number"}
```

- `PerformanceObserver` 存在、`observe()` 不抛，但**永不触发**
- `getEntries()` / `resource` / `navigation` / `paint` 全为 0
- **`PerformanceObserver.supportedEntryTypes` 不存在**——这是 2019 年起每个真实浏览器
  都有的静态属性，一行即可检测

浏览器流程里 `/pat/` 与 `/ci/` 的 URL 各自带一个 `Date.now()` 时间戳
（`…/1786538477841/…` 与 `…/1786538477842/…`，相差 1 ms，同一 tick 内发出），
其中 `/ci/` 的请求头是 `sec-fetch-dest: image` + `no-cors`——即 `new Image().src`，
正好撞上 step 5 未修的那条。

### Step 11 — 修复：iframe 内的 `<img>` 按页面源解析（step 5 遗留项）

浏览器流程里 `/ci/` 那张图（`sec-fetch-dest: image` + `no-cors`，即 `new Image().src`）
发自 widget iframe 内部。obscura 把它解析到了**顶层页面**的源上。

成因与 step 5 同源但另一条路径：`img.src` 的 **getter** 早就用 `this.baseURI`
（按节点的 ownerDocument 算）返回了正确的绝对 URL，但真正发请求的
`op_load_image_metadata` / `op_image_metadata` 在 Rust 侧**重新解析一遍**，用的是
`document_base_url()` —— 它读 `state.url`，也就是页面 URL。

修法：两个 op 各加一个 `node_base` 参数，JS 侧传 `this.baseURI`；Rust 侧新增
`node_base_url()`，非空时用它，为空退回原行为。请求的 initiator（决定 Referer /
Origin）同样改用它——Chrome 发的 `/ci/` 请求 Referer 是 widget 文档，不是嵌入页。

效果（`scripts/realm_probe.sh`，与当初发现问题的是同一个探针）：

| | 修复前 | 修复后 |
|---|--------|--------|
| `new Image().src` | **页面源** :8901 | frame 源 :8902 |
| 落在页面源的探针 | `probe-img` | **none** |

回归测试：`crates/obscura-js/src/realm.rs`
（`a_frames_image_resolves_against_the_frame_not_the_page`），同时断言
`getAttribute('src')` 仍是作者写的字面值。

**流程仍未推进**——请求序列还是同样 4 条。`/ci/` 在浏览器流程里排在 `/pat/` 之后，
而 obscura 连 `/pat/` 都没走到，所以这条路径目前还没有机会被执行。修的是真缺陷，
但它排在阻塞点的下游。

顺带查到的构建陷阱：`node_base_url` 忘了加 `#[cfg(feature = "render")]`，
默认 feature 下编译不过。`cargo build --features render,stealth` 是绿的，
**必须另跑一次 `cargo check` 的默认 feature 组合**才会暴露。

### Step 12 — 找到真正的阻塞点：Worker 收到的消息不是 trusted

方向来自一条早先采样时瞥见、当时没追的线索：进程里有 `obscura-worker-2` /
`obscura-worker-4` 线程。空白页对照组是 **0 个** —— 这些 worker 是挑战页建的。

给 worker 生命周期四处打探针（spawn / page→worker / worker→page / error），
一眼看出问题：

```
worker SPAWN  blob:https://zencare.co/…  srcLen=13   src="you"==="bot"
worker SPAWN  blob:https://zencare.co/…  srcLen=291  src=var _p=null;if(self.trustedTypes)…
page->worker#4 {"v":"var n=self.navigator;postMessage({KzOg4:n.platform,…})"}
（worker→page：0 条。error：0 条。）
```

挑战把**指纹采集代码作为字符串发进 worker 让它 eval**，worker 一条都没回，
也没有任何报错。取出那 291 字节的 worker 源码，最后一行就是答案：

```js
onmessage = function(e){
  e.isTrusted && '' === e.origin && null === e.source && eval(_p ? _p.createScript(e.data) : e.data)
}
```

直接量一下 obscura 投给 worker 的 `MessageEvent`：

```
{"isTrusted":false, "origin":"", "source":"null", "gate":false}
                ↑ Chrome 是 true
```

`origin` 和 `source` 都对，**`isTrusted` 是 false**，短路发生在第一项。于是
`eval` 从不执行 —— 没有回复、没有异常、没有任何可观测的痕迹，父窗口就一直等，
550 ms 心跳跑满直到 `overrunBegin`。

成因：worker 模板里 `new MessageEvent('message', {data})` 是**构造**出来的，
构造出来的事件 `isTrusted` 必为 false（这是对的，见 issue #303）。缺的是把
用户代理自己派发的那一份标记为 trusted —— 主 realm 的跨文档投递早就在用
`__obscura_markTrusted`，worker 这条路径漏了。

一并补上其余四处同样由用户代理派发却没标记的：`MessagePort` 投递、
worker→page、`BroadcastChannel`、WindowProxy 的 postMessage 回退路径。

效果（同一页面）：

| | 修复前 | 修复后 |
|---|--------|--------|
| worker 的 gate | `false` | `true` |
| worker→page 消息 | **0 条** | 6 条 |
| 请求序列 | 4 条 | **5 条** |

新出现的第 5 条正是浏览器 HAR 的 #13：`POST challenges.cloudflare.com/…/fo/<tokenB>`
→ 200（127 KB）。**这是本次排查第一次让流程真正往前走。**

worker 回传的内容也确认了指纹链路是通的：

```
worker#4 ->page {"KzOg4":"Win32","TzEx3":["en-US","en"],"Bwko4":8,"ycmYm0":8,
                 "EhUAu5":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)…"}
worker#5 ->page {"aacHi5":"Wgniq7"}      ← eval("debugger") 的探测，正常返回
worker#4 ->page {"vKfw0":1}              ← performance.now() 分辨率探测
```

回归测试：`crates/obscura-js/src/worker.rs`
（`a_workers_incoming_message_is_trusted_like_the_user_agent_dispatched_it`），
直接断言那三项闸门。

**下一个断点已经暴露出来**，就在同一批 worker 消息里：

```
page->worker#4 {"v":"try{fetch(\"https://brunhild.challenges.cloudflare.com/…\")…"}
worker#4 ->page {"pmsnv8":1,"glWf6":"Error: Network error: https://brunhild…"}
```

worker 里对 `brunhild.challenges.cloudflare.com` 的 `fetch` 失败。浏览器 HAR 里
这个主机以两条 `CONNECT`（#9、#12）出现，正夹在 `/pat/` 前后。待查：是 worker 的
fetch 没走 `--proxy` / 没带 CA，还是别的原因。

### Step 13 — `performance.now()` 是整毫秒，worker 里还是 Unix 纪元

step 12 打通 worker 后，回传里有一条一眼可疑的数据：

```
page->worker#4 {"v":"for(var a=1,b=1,c,d=0;5E3>d;d++){var e=performance.now(),
                     f=performance.now();e<f&&(c=f-e,c>a&&c<b?b=c:c<a&&(b=a,a=c))}
                     postMessage({vKfw0:a});"}
worker#4 ->page {"vKfw0":1}
```

这段代码跑 5000 轮，取**两次连续 `performance.now()` 之间最小的正差值**——就是在测
时钟分辨率。obscura 答 `1`。Chrome 在非 cross-origin-isolated 下把
DOMHighResTimeStamp 向下取整到 **100 微秒**，答案是 `0.1`（带浮点误差）。

直接量：

```
修复前  main   min=1                  samples=[11,11,11,11,11,11]
        worker min=1  now=1786556774710          ← Unix 纪元毫秒
修复后  main   min=0.09999999999999987 samples=[2.3000000000000003,2.4000000000000004,…]
        worker min=0.09999999999999998 now=1
```

两个独立缺陷：

1. `performance.now()` 由 `Date.now() - timeOrigin` 推导。`Date.now()` 是整毫秒，
   于是每次读数都是整数。新增 `op_monotonic_ms()`（`Instant` 基准，f64 毫秒），
   按 0.1 ms 向下取整，保持单调不减。
2. `timeOrigin` 默认值是 `0`，而它只在 `__obscura_init` 里被赋值——**worker 从不跑
   那段**，所以 worker 里 `now()` 直接返回 Unix 纪元毫秒。默认值改为 `Date.now()`，
   并让每个 realm 首次读数时确立自己的单调起点。

顺带修掉一处方向错误：时间原点原本按 `Date.now() + rand*100 - 50` 抖动，有一半概率
落在**未来**。`performance.timeOrigin` 是导航开始时刻，任何浏览器都不会晚于
`Date.now()`；落在未来会让页面上所有「已过去多久」的计算变成负数。改为只向过去抖。
既有测试 `performance_now_does_not_outrun_elapsed_time` 正是被这一条抓出来的。

回归测试：`crates/obscura-js/src/runtime.rs`
（`performance_now_has_a_browsers_sub_millisecond_resolution`、
`performance_time_origin_is_in_the_past_and_now_counts_from_it`）。

**请求序列没有变化，仍是 5 条。** 这是一处被对方明确测量的指纹缺陷，修它是必要的，
但它不是当前的阻塞点。

### 当前断点：`interactiveBegin` 而不是 `complete`

step 12 之后用 CDP 预注入重测 widget 时间线，失败模式**变了**：

```
  465 ms  init
  466 ms  requestExtraParams
 1150 ms  translationInit
 4859 ms  interactiveBegin        ← 新出现
 (food x31)；30 s 内没有 overrunBegin，也没有 complete
```

此前是等到超时（`overrunBegin`）；现在 Turnstile 在 4.9 s 主动判定「需要交互」。
浏览器的成功链路是 managed 模式全自动、2.1 s 走完，从不进交互。所以现在是**被打分
判定可疑**，而不是流程卡住——问题从「跑不下去」变成了「跑得下去但不被信任」。

另外确认 `brunhild.challenges.cloudflare.com` 的 `fetch` 失败**不是**断点：浏览器
HAR 里这个主机的两条 `CONNECT` 状态同样是 **0**（没连上），而 obscura 已经把
`Error: Network error…` 如实回传给挑战。同源对照实测：worker 内
`fetch("https://challenges.cloudflare.com/turnstile/v0/api.js")` → **200**，
说明 worker 的网络栈本身通。

## 测量盲区

排查中多次因为观测手段本身失真而得出错误结论，逐条记下：

| 盲区 | 后果 | 正确做法 |
|------|------|----------|
| `querySelectorAll` 不穿透 shadow；closed 模式下 `el.shadowRoot` 为 `null` | 误判「iframe 从未插入 DOM」 | CDP `Page.addScriptToEvaluateOnNewDocument` 预注入钩子截获 `attachShadow`，保留 root 引用 |
| frame 导航路径**不打印 URL**（只有 `op_fetch_url` 打印） | 误判「iframe 文档从未被请求」 | 看 `starting new connection` / `Cookie header for <host>`，或直接插桩 |
| 混淆代码的字符串解码表会「返回」大量错误字符串 | 把 `unsupportedbrowser` / `invalidsitekey` 等误当作被触发的错误 | 看调用形态：`CALL Window.g(<数字>)` → `RET object:Array` → `RET string:"..."` 是查表，不是触发 |
| trace 的脚本名列对动态脚本一律记为 `<page-eval>` | 无法区分主页面代码与 iframe 内挑战代码；`challenges.cloudflare.com` 名下 0 条不代表没执行 | 该列不可用于分辨 realm；需要 realm 内注入 |
| Cloudflare 在**失败路径上也会下发** `cf_clearance` | 误判「过盾成功」 | 判据是 `cf_chl_rc_ni`（Not Interested）等结果码，以及复用该 cookie 能否拿到真实内容 |
| 页面脚本会在加载时缓存原生方法引用 | `--eval` 阶段（页面脚本之后）挂的钩子无效 | 用 CDP 预注入，在页面脚本之前挂 |
| 包装 DOM 访问器（如 `contentWindow` getter）会改变被测行为 | step 6 中 `translationInit` 与心跳一并消失，整次测量作废 | 先用可控用例验证同一机制，再决定是否需要在真实页面上挂钩 |
| 事件处理器里的异常被 `catch(e) {}` 静默吞掉 | 整整一轮排查看不到任何错误，误以为「代码没报错」 | 先把上报补上（step 7），再采信「零错误」这个结论 |
| stealth 模式的 fetch/XHR 走 `stealth_fetch_all`，它**没有** `op_fetch_url` 的完成日志 | 看不到响应状态与大小，无法判断载荷是否送达 | 两条路径都要有完成日志 |
| `console.error` 可被页面覆盖，但上报路径直接调内部格式化函数 | 测试里改 `console.error` 收不到消息，误判上报没生效 | 在 `op_console_msg` 这一层挂钩 |
| `cargo build` 的输出用 `grep -E "^error"` 过滤会漏掉真正的失败行 | 拿着**没构建成功**的旧二进制跑了一轮，结论全错 | 过滤时必须同时匹配 `Finished` / `could not compile`，确认构建真的成功 |

另注：`cf_clearance` 绑定 TLS 指纹 + IP + UA，跨进程复用需固定 stealth profile
（见 `OBSCURA_PROFILE` / `OBSCURA_ROTATE_PROFILE`）。

## 未决

按当前怀疑程度排序：

- **Turnstile 在 4.9 s 判定需要交互**（`interactiveBegin`），浏览器则全自动走完。
  说明剩下的是打分问题，需要继续找被判为可疑的指纹面。
- **早期 timer 迟发 600–2500 ms**（step 9），与 Cloudflare 自测的 `timeTiefMs`
  吻合。成因未定位，下一步给事件循环的 poll/park 插桩。
- **Performance Timeline 全空**（step 10），且 `PerformanceObserver.supportedEntryTypes`
  缺失——后者是一行即可命中的检测点。
- 栈底仍有 2 帧 `_runAtNesting (<obscura:bootstrap>:894:9)`（step 8）。浏览器里
  setTimeout 回调的栈到回调那一帧就结束，下面没有引擎帧。
- `overrunBegin` 仍出现，挑战不完成。
- `/pat/` 请求仍未出现。
- 父窗口是否回应了子窗口的 `requestExtraParams` 未证实。父→子通道本身已验证可用
  （step 6），需要一种不扰动流程的观测方式。
- 跨源访问 `parent.location.origin` 返回 `undefined`，浏览器应抛 `SecurityError`。
  可被检测的差异，未修。
