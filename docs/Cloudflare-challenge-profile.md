# Cloudflare 挑战：诊断记录

针对 `zencare.co` 的 Cloudflare Turnstile 托管质询（5 秒盾）的逐步排查记录。
按 step 追加，每步记录**假设 / 方法 / 证据 / 结论**。被证伪的假设一并保留——
它们标出了不必再走的路。

当前状态：**未通过**。已修掉九处真实缺陷（step 4、5、8、11、12、13、19、20、21），
并在 step 26–27 收紧了事件、表单控件和 iframe 的浏览器一致性。frame 的几何、
`innerWidth`、CSS 动画采样全部正确，复选框已正常渲染。step 22 确认：
managed vs interactive 的分流由 **IP 干净程度**决定——obscura 走 Reqable 代理（出口 IP
不干净）被分流到交互分支，822KB 托管载荷后降级拉取 127KB 交互变体、发出
`interactiveBegin`，之后**需要点击 checkbox**。closed shadow 命中测试与 move/click
事件序列已补齐，但 fetch 流程仍不会主动执行交互。下一步：用 CDP 驱动一次确定性的
checkbox 操作，验证点击后的证明链路。

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

### Step 14 — 胶片式截图：确认屏幕上真的出现了「需要点击」

`interactiveBegin` 只是一个事件名。要确认它对应的是不是真的交互控件，直接每 3 秒
截一帧（新增 `scripts/cdp_filmstrip.py`，同时打印 iframe 的位置和尺寸）：

| 时刻 | 画面 | 帧哈希 |
|------|------|--------|
| 3 s | 转圈动画 + `Verifying...` | — |
| 6 s | **`Verify you are human`** | 变化 |
| 9 s → 36 s | 完全不变 | 逐帧相同 |

widget iframe 稳定在 `300x65 @ (192,304)` —— Turnstile 的**交互式**尺寸。

结论：不是流程卡死，是被**降级成了需要人工点击**。真实浏览器的成功链路是 managed
模式 2.1 秒全自动走完，从不进这一步。所以剩下的工作是**打分**，不是补功能。

一个附带观察：交互框里左侧的复选框方框**没有被画出来**，只有文字。尚未确认这是
obscura 的渲染缺口，还是 widget 在未就绪时本就不画。

### 测量纪律：连续压测会让目标改变行为

同一天里连续跑了十几轮之后，请求序列从 5 条掉到 3 条（iframe 都不再创建）。
这不是代码回退——中间没有任何相关改动。**跨轮次比较请求条数前，必须确认目标
没有因为压测而改变策略**；理想做法是换 Ray ID / 换出口 / 拉开间隔再复测。

### Step 15 — 复选框根本没被绘制（渲染缺口，但不是 Turnstile 用的那个）

step 14 的截图里，交互框只有 `Verify you are human` 文字，左边**空白**。先做最小对照，
不碰 Turnstile：

| 控件 | 修复前 |
|------|--------|
| `<input type="checkbox">`（含 `checked`） | **完全不画** |
| `<input type="radio">` | **完全不画** |
| `<input type="text">` / `<button>` / `<select>` | 正常 |
| 自定义样式 span / SVG | 正常 |

成因：`style.rs` 给所有 `input` 一份通用外观（2px 边框 + 白底），随后 `dom.rs` 对
checkbox / radio **显式清空 border 和 padding**（这是对的，复选框不是带框的文本框），
但没有任何代码补上平台自己的画法。于是它们占了 13x13 的布局却什么都不画。

修复：按 `<select>` 画下拉箭头的既有套路，新增 `paint_native_toggle()`——圆角方框 /
圆形、边框、选中时填充强调色并画对勾或圆点，disabled 用灰。同时补上 `appearance`
属性解析（`none` 时不画平台外观），否则站点用 `appearance:none` 自绘时会被叠加两层。

八种状态实测通过：未选 / 选中 / 禁用 / 选中+禁用 / radio 三态 / `appearance:none`
（只显示作者的红框粉底，无叠加）/ 32x32 放大。

回归测试：`crates/obscura-render/src/paint.rs`
（`a_checkbox_and_a_radio_paint_their_platform_look`、
`appearance_none_suppresses_the_platform_checkbox`）。

**但 Turnstile 的框仍然是空的。** 说明 widget 用的不是原生 `<input type=checkbox>`，
而是自绘元素（很可能 `appearance:none` + 自定义 CSS，或 div/svg）。这条修的是一个
真实且独立的渲染缺口，不是 widget 空白的成因——下一步要读到 iframe 内的实际标记。

### 又一次踩到 feature 门控

`obscura-render` 的 `paint` feature **默认关闭**，所以
`cargo check/test -p obscura-render` 从头到尾**没有编译 paint.rs**——期间那 17 个
"既有失败"只是缺 feature 的产物，跟改动无关。带上 `--features paint` 后是
**471 passed / 0 failed**。

确认代码是否真被编译的最快办法：往里塞一行必然编译失败的语句，看构建是否报错。
本次正是靠这一招才发现的。

### Step 16 — 那个复选框画不出来，是因为 iframe 的绘制表面根本不跟随 DOM

step 15 补了原生 checkbox 绘制后，Turnstile 的框**依旧是空的**。于是去读 widget
frame 内部的真实标记——新增 `scripts/cdp_frame_dom.py`，用
`Page.getFrameTree` + `Page.createIsolatedWorld` 在跨源 frame 内部求值（页面自己
够不到，截图只反映画了什么，两者都答不了「那是个什么元素」）。

三个 frame 的实测：

| frame | body 子元素 | 含 `Verify you are human` | 文档大小 |
|-------|------------|--------------------------|---------|
| `zencare.co/1.txt`（父） | 3 | 否 | 27 KB |
| Turnstile widget | **0** | 否 | 266 KB（内联脚本 246 KB + 样式 16 KB） |
| `about:srcdoc` | 0 | 否 | 291 B |

widget 的 body 在 6 s 和 14 s 都是空的，`readyState: complete`，标题
`Checking your Browser…`，`document.body.getBoundingClientRect()` 是 **0×0**。
父页面的 closed shadow root 里也只有那个 iframe（485 字节），同样不含该文案
（用截获 `attachShadow` 的探针读的）。

**这段文字在任何一份 DOM 里都不存在，却被画了出来。** 做因果测试：在 widget frame
的 isolated world 里把 body 换成一个红色方块，确认 DOM 真的改了
（`kids:1`、`innerHTML` 回读到 PROBE div），再截图——**画面纹丝不动**，红块没出现。

与胶片对上了：step 14 里 9 s 到 36 s 的帧**逐帧哈希完全相同**。

结论：**跨源 iframe 的绘制表面是陈旧的，不随��� DOM 更新**。我们一直在看一张早期
快照，所以任何后续变化（包括那个复选框）都不可能出现在截图里。这同时意味着
step 15 之前基于「框是空的」做的推断都不成立——它不是没画，是画的不是当前状态。

未定：那张早期快照本身从何而来（widget 一度建过 UI 又清空？还是首帧合成后就没再
更新？）。下一步应当给 frame surface 的合成路径插桩，而不是继续从截图反推。

第一次做这个因果测试时 `Runtime.evaluate` 返回 `{}`，我差点据此断言「isolated world
看到的不是被绘制的文档」。实际是表达式形式不被支持、求值**根本没执行**。包上
`JSON.stringify(...)` 并回读确认后才拿到真结果——**探针没生效和被测对象没反应，
表现完全一样**。

### Step 17 — 用 js-reverse 对照真实浏览器：推翻 step 16，真因是 body 尺寸 0×0

step 16 断言「跨源 iframe 的绘制表面陈旧、不随 DOM 更新」——**这是错的**。用 js-reverse
连真实 Chrome 对同一 widget 做逐项对照（这是此前缺的一步：真实浏览器基线）：

| 项 | Chrome | obscura |
|----|--------|---------|
| body 挂 closed shadow root | 是（`attachShadow` 抛「已存在」） | 是（同样抛） |
| `body.shadowRoot` | null（closed） | null |
| light DOM 子节点 | 0 | 0 |
| 样式表 / 规则数 | 2 张，183 + 1 | 2 张，183 + 1 |
| `elementFromPoint(复选框处)` | **BODY** | — |
| **`body.getBoundingClientRect()`** | **300×65** | **0×0** |

**整个 Turnstile UI（复选框 + `Verify you are human`）都在挂在 `document.body` 上的
closed shadow root 里。** 所以：

1. 我之前「往 `body.innerHTML` 塞红块、截图不变」的因果测试**什么都没测**——宿主有
   shadow root 时，light DOM 子节点根本不参与渲染，截图不变是正确行为，不是「陈旧表面」。
2. 真因是 **obscura 里这个 body 尺寸是 0×0**（Chrome 是 300×65）。body 没盒子，
   它的 shadow 内容就没地方排，复选框自然画不出来。

frame 布局链路已定位到 `crates/obscura-js/src/runtime.rs` 的 `frame_content_box()`：
它从父布局取 iframe 的 content box 作为子文档 viewport（有 `>=1×1` 的门槛），喂给
`prepare_frame_document`。父布局里 iframe 确实是 300×65，但子文档的 body 最终算成
0×0——**根元素/body 没有按 viewport 撑开**，这层还没查到底，是下一个待定位点。

### 这一轮新增的两个测量坑

- `websockets` 客户端会读 `http_proxy`/`all_proxy` 环境变量，把连本地 CDP server 的
  ws 握手也走了 Reqable（`socks5://127.0.0.1:7897`），直接 `InvalidMessage`。之前
  `cdp_probe.py` 能跑是因为当时这些变量没设。连本地 server 要 `env -u ..._PROXY`。
- js-reverse 的页面会因挑战自动刷新而换 frame，读完一个 frame 后别假设它还停在那儿；
  每次求值前重新 `select_frame` 并核对 URL。

### Step 18 — 真因：frame 内几何查询走的是顶层布局，返回全零

step 17 说「body 0×0」，进一步测量发现比这更广——widget frame 内**所有**元素
（html / head / body / title）`getBoundingClientRect` 全是 0×0，且：

```
window.innerWidth = 1920, innerHeight = 1000   ← 不是 iframe 的 300×65
scrollWidth = 1280, scrollHeight = 720          ← 顶层页面的视口
```

先排除「布局引擎不会给 shadow+body 定尺寸」：写了一个 render 层测试
`a_shadow_host_body_sizes_to_the_viewport_and_its_shadow_content`，body 挂 closed
shadow root + 200×50 内容，viewport 300×65 → body 正确得到 300×50+。**布局引擎本身
没问题。**

真因在两条路径分了家：

| 路径 | 代码 | 用的布局 | 结果 |
|------|------|---------|------|
| 绘制 frame surface | `render_frame_tree_into`（runtime.rs:93） | `prepare_frame_document` 独立布局，画完丢弃 | 正常（spinner 能画） |
| JS 几何查询 | `op_layout_geometry`（ops.rs:6081） | 只有 `gs.prepared_render`（**顶层**文档） | frame 内 nid 查不到 → 返回空 → 全零 rect |

`op_layout_geometry` 只接受一个 nid，不做「这个 nid 属于哪个文档（主文档还是哪个
frame）」的解析，永远查顶层布局。frame 内容只在画 surface 时被临时布局一次，事后
丢弃，几何查询拿不到。

**修复方向**：几何 op 需要按 nid 定位所属 frame，按该 frame 的 content box 尺寸现算
（或缓存）那份 frame 布局再查询；`op_layout_metrics` 同理（innerWidth/scrollWidth
也错了）。这是 frame 布局缓存 + 几何 op 分派两件事，量不小。

对挑战的影响：Turnstile 的 JS 会读 widget 的几何来判定自己是否可见/尺寸是否正确。
全零 rect 会让它认为 widget 塌缩或不可见，很可能就是它走到 `interactiveBegin` 而不是
自动通过的原因——这比「打分」更具体，是功能缺失。

### Step 19 — 修复：frame 几何查询按节点所属文档分派布局

step 18 定位到 `op_layout_geometry` 只查顶层 `prepared_render`。修复落地：

- `op_layout_geometry` / `op_element_scroll_metrics` 先按 nid 用
  `containing_document_root_shadow_including` 解析所属文档；是 frame 就现算那份
  frame 布局再查询。
- `op_layout_metrics`（文档级 client*/scroll*）加了一个 frame root 参数，JS 侧
  `_renderScrollMetrics` 传 `_callingFrameRoot()`。
- 新增 `prepared_for_frame_root`：从宿主 iframe 在父布局里的 content box 取 viewport，
  递归支持嵌套 frame，然后 `prepare_frame_document` 布局该 frame——和绘制用的
  `render_frame_tree_into` 同一套计算，但后者画完就丢弃，所以几何查不到。

效果（同一 widget，修复前后）：

| | 修复前 | 修复后 | Chrome |
|---|--------|--------|--------|
| `body.getBoundingClientRect()` | 0×0 | **300×65** | 300×65 |
| `document.documentElement.scrollWidth/Height` | 1280×720（顶层） | **300×65** | 300×65 |

回归测试：`crates/obscura-js/src/realm.rs`
（`frame_elements_report_their_own_document_geometry`），另在 render 层补了
`a_shadow_host_body_sizes_to_the_viewport_and_its_shadow_content` 证明布局引擎本身
能给 shadow+body 定尺寸。

**挑战仍未通过**：帧几何正确后，widget 依然在 ~14.4 s 进 `interactiveBegin`，没有
`complete`。所以它是必要条件，不是充分条件。

两个遗留项：

1. **`window.innerWidth`/`innerHeight` 在 frame 里仍是屏幕尺寸**（2560×1360，应为
   300×65）。它是 `__obscura_init` 里一次性赋值，frame realm 拿不到 frame viewport，
   回退到 `screen`。与几何 op 是两条路，需单独修。
2. **frame 布局每次几何查询都现算，无缓存**。Turnstile 会轮询几何，每次
   `getBoundingClientRect` 都重跑一遍 CSS 解析 + taffy 布局，可能是这一轮
   `interactiveBegin` 从 4.9 s 拖到 14.4 s 的原因。应按主文档 `prepared_render` 的
   方式加 frame 布局缓存与失效。

### Step 20 — 修复：frame 的 `window.innerWidth`/`innerHeight` 回退到屏幕尺寸

step 19 修了几何 op，但 `window.innerWidth`/`innerHeight` 是**另一条路**：`__obscura_init`
里一次性赋值，取 `__obscura_viewport_w/h`，这两个只对顶层文档设置，frame realm 拿不到，
于是回退到 `screen`（2560×1360）。

修复：`__obscura_init` 里若 `_callingFrameRoot()` 非零，就调 `op_layout_metrics(frame_root)`
（此时已支持 frame）取 `clientWidth/clientHeight` 覆写 `innerWidth`/`innerHeight` 和
`visualViewport`。`op_layout_metrics` 的 frame 分支补了先 `ensure_prepared_geometry`
（frame 初 init 时主文档 `prepared_render` 还没建）。

效果（同一 widget）：

| | 修复前 | 修复后 | Chrome |
|---|--------|--------|--------|
| `window.innerWidth` | 2560 | **300** | 300 |
| `window.innerHeight` | 1360 | **65** | 65 |

回归测试并入 `frame_elements_report_their_own_document_geometry`（加了 innerWidth/
innerHeight 断言）。

**挑战仍未通过**：`interactiveBegin` 仍在 8.9 s 出现，无 `complete`。

### 挑战真正的断点在 JSVMP：`/pat/` 从未发出

把浏览器 HAR 的成功序列和 obscura 现状对齐，断点已经很清楚：

```
浏览器：/fo/<tokenB> → 822KB JSVMP → /pat/<id> 401 → /ci/<id> png → /fo/ → /1.txt 404
obscura：/fo/<tokenB> → 822KB JSVMP → interactiveBegin（没有 /pat/）
```

`/pat/`（proof-of-attention）是 JSVMP 引擎算完证明后发的请求，浏览器发、obscura 不发。
所以真正的问题在 **JSVMP（加密字节码 VM）的执行结果**——它没走到发 `/pat/` 那一步。
之前的 step 8（栈名）、step 13（performance.now 分辨率）都是 JSVMP 会探测的面，但显然
还有更多。

已修的几何类缺陷（step 19、20）是 iframe 挑战的必要条件，但不是充分条件。下一步方向
是追 JSVMP 执行：它到底在读什么、哪个返回值不对，导致没发 `/pat/`。

### Step 21 — 修复：frame 文档的 CSS 动画采样冻结在 T=0，复选框因此不可见

直接看截图回答「复选框渲染出来没有」：没有。文字和 logo 都在，复选框位置一片空白。
用 js-reverse 读真实 Chrome 的 widget CSS，找到复选框：

```css
.yYpYJ6 .DuHyD8 { border: 2px solid rgb(74,74,74); background: #fff; width:24px;
                 animation: 0.4s ... both running scale-up-center; }
@keyframes scale-up-center { 0% { transform: scale(0.01); } 100% { transform: scale(1); } }
```

复选框有个**入场动画**，从 `scale(0.01)` 长到 `scale(1)`。真实浏览器 0.4s 跑完停住；
obscura 的 `prepare_frame_document` 硬编码 `AnimationSample::default()` = T=0，所以
frame 文档的动画永远停在第一个关键帧 `scale(0.01)` —— 复选框「长」不出来，几乎不可见。

修复：把主文档的动画采样时间**传进 frame 准备**。`prepare_frame_document` /
`render_frame_document` 各加一个 `animation_sample` 参数，`render_frame_tree_into`、
`build_frame_surfaces`、`input_hit_in_document`、`prepared_for_frame_root` 都传
`主文档 prepared.animation_sample()`（主文档时间靠 `sample_live_document_animations`
按墙钟推进）。

效果（像素级验证）：

| | 修复前 | 修复后 |
|---|--------|--------|
| 复选框边框 `rgb(74,74,74)` | 0 px | **166 px** |
| 复选框白底 `rgb(255,255,255)` | 0 px | **398 px** |
| ASCII 渲染 | 空白 | 清晰的 24×24 白底深边框方框 |

回归测试：`crates/obscura-render/src/paint.rs`
（`a_frame_samples_its_animations_at_the_document_time`，断言 T=0 时 scale(0) 元素不可见、
1s 时可见）。

这是通用 bug：任何带入场动画的 iframe 内容在 obscura 里都会停在第一帧。复选框是它的
一个具体受害者。

**挑战仍未通过**：`interactiveBegin` 仍在 9.9 s 出现，无 `complete`。复选框、几何、
innerWidth 全部正确之后，剩下的断点仍在 JSVMP——它依旧不发 `/pat/`。

### Step 22 — 关键修正：真实浏览器根本不点击；obscura 是「托管未过→降级交互」而非「没点 checkbox」

**假设**（用户提出）：obscura 卡住是因为没有点击 checkbox。

**方法**：js-reverse 连真实 Chrome 跑同一 URL，清空网络捕获后导航，读完整请求序列，
逐条对齐 HAR；对比 obscura run24/run25 里 `/fo/<tokenB>` 的响应尺寸；追查 obscura
输入命中测试是否穿透 closed shadow root。

**证据**：

1. **真实浏览器全程无点击、自动过盾**（js-reverse 捕获 + HAR 一致）：
   `GET /fo/<tokenB>`(822KB JSVMP) 到达后 **366ms** 自动发 `GET /pat/`(401)，随后
   `GET /ci/`(2300B png)、`POST /fo/<tokenB>`(7088B 提交证明)、`POST /1.txt`(404)。
   中间没有任何 click 事件。
2. **obscura 第二轮 `/fo/` 是「重新拉取挑战」不是「提交证明」**（run24/run25 可复现）：
   822KB 载荷到达后，obscura **不发 `/pat/`**，而是再次 POST 同一个 `/fo/<tokenB>`
   拿回 **127720B** 的新载荷。浏览器第二轮 `/fo/` 是 7088B 的最终提交；obscura 的
   127KB 是另一种挑战载荷——这是**交互式变体**（与 `interactiveBegin` 同源）。几何修复
   之前的旧 run（run15/run21）只有一条 822KB 就停住，修复后才走到这第二轮——证明
   geometry/animation 修复确实让 JSVMP 前进了，但方向是「降级交互」而非「自动通过」。
3. **obscura 的输入命中测试不穿透 closed shadow root**：`input_hit_in_document`
   （`crates/obscura-js/src/runtime.rs:246`）用 `dom.descendants()`，只走
   `first_child`/`next_sibling`，**不跟随 `shadow_roots_by_host`**；渲染路径（paint）
   穿透 shadow。checkbox 挂在 frame 的 body 的 closed shadow root 里，所以**画得出来、
   点不到**（命中会落在 body 而不是 shadow 里的 checkbox）。

**结论**（经用户更正：managed vs interactive 的分流主要由 **IP 干净程度**决定）：

- HAR / js-reverse 里浏览器能一次性自动过，是因为当时出口 IP 干净 → 分流到托管
  （managed）分支，无需点击。obscura 走 Reqable 代理，出口 IP 不干净 → 被分流到
  **交互（interactive）分支、需要点击**。这是 Cloudflare 的正常行为，不是 obscura 的
  JSVMP「执行坏了」。
- 因此「点击 checkbox」**不是兜底，而是代理 IP 场景下必须打通的正路**。用户原假设成立。
- obscura 当前有两个缺口：①它从不发起点击（被动 fetch）；②即使想点也点不到——
  `input_hit_in_document`（`runtime.rs:246`）用 `dom.descendants()`，不穿透 closed
  shadow root，命中落在 body 而非 shadow 里的 checkbox（渲染路径穿透、输入路径不穿透）。
- 下一步：修命中测试穿透 closed shadow root + 在 `interactiveBegin` 时自动点击，
  实测点击后 127KB 交互 JSVMP 是否发出 `/pat/`。

### Step 23 — 命中测试已穿透 shadow，但点击复选框仍不推进（疑似 srcdoc iframe 拦截）

**方法**：修 `input_hit_in_document` 用 `descendants_including_shadow` 穿透 closed
shadow root（commit 80ac9a2）；再补 pointer 事件派发 + `composed:true`（commit 见下）；
用 CDP `Input.dispatchMouseEvent` 在 `interactiveBegin` 后点击复选框，观察消息时间线。

**证据**：

1. 复选框真实位置（截图像素定位）：widget iframe box=(192,304,300×65)，复选框 24×24
   边框 rgb(74,74,74) 位于 (201..224, 325..348)，中心 ≈ (212,336) = iframe 相对 (20.5,32.5)。
   点击 (216,336) 落在复选框内。
2. 点击后消息时间线只有 `food` 心跳继续，**无 `complete`、无 `interactiveEnd`、无 `/pat/`**。
3. `init` 消息确认 `"mode":"managed"`，~10–15s 被 IP 分流到 `interactiveBegin`。
4. frame 树里 widget（frame-page-1-1）内还有一层 **`about:srcdoc` 空 frame**
   （frame-page-1-2，body 为空）——很可能是叠在复选框上的透明 click 捕获层。

**修复**（commit `80ac9a2` 命中测试 + `[pointer 事件]` 事件派发）：

- `DomTree::descendants_including_shadow()` 穿透 native open/closed shadow tree。
- `Input.dispatchMouseEvent` 现在按浏览器顺序派发 `pointerdown→mousedown→pointerup→mouseup→click`，
  `PointerEvent` 改为继承 `MouseEvent`（带 clientX/Y、pointerId/pointerType/isPrimary），
  mouse/click/pointer 事件全部 `composed:true`。各有回归测试。

**结论**：命中测试与事件派发两项真实缺陷已修（各有单测），但**点击复选框仍不推进质询**。
首要怀疑：嵌套的 `about:srcdoc` iframe（空、透明）叠在复选框上，把点击吞进了自己的空
document，复选框的 handler 根本没收到事件。下一步：确认 srcdoc iframe 的位置/尺寸，若
确实覆盖，则命中测试要跳过它（或点击要落到其下层的 checkbox）；顺带确认真实浏览器里
checkbox 的 handler 绑定在哪个元素、监听的是 click 还是 pointer 事件。

### Step 24 — 事件不跨 shadow 边界：`composed` 未实现；已修，但点击仍不推进

**方法**：给 `input_target_at_point` 加临时日志，确认点击命中的真实元素；读
`bootstrap.js` 的事件派发实现；补 `composed` 跨边界并加回归测试。

**证据**：

1. 命中测试日志（临时插桩）确认点击 (216,336) 命中 **frame-page-1-1 里的
   `NodeId(457) tag=span`**（即复选框 `.DuHyD8`，local=(24,32)）——命中测试穿透
   shadow 是正确的，也**不是 srcdoc iframe 拦截**（srcdoc frame 是 body 为空的旁支，
   不在点击路径上）。
2. **真因是事件派发不跨 shadow 边界**：`Element.prototype.dispatchEvent` 用
   `parentNode` 冒泡，但 `ShadowRoot extends DocumentFragment` 走 `Node.dispatchEvent`
   → `_eventTargetDispatch`，只触发 shadow root 自己的监听器、**不继续冒泡到 host**。
   `composed` 标志根本没被派发逻辑使用——所以 host/body/document 上的 handler 收不到
   shadow 内元素发出的 click。
3. 修复：`_eventTargetDispatch` 在事件 `composed && target._host` 时继续
   `host.dispatchEvent(event)`，跨出 shadow 边界。回归测试
   `composed_event_crosses_shadow_boundary_to_the_host`（child 派发 composed click，
   host 的监听器必须收到）。

**结论**：命中测试、pointer 事件、composed 跨边界三项真实缺陷都已修（各有单测），
点击也确认命中复选框 span，但 **`interactiveBegin` 后点击仍无 `interactiveEnd`/
`complete`/`/pat/`**。下一步从「事件派发」转向「handler 到底绑定在哪个元素、怎么绑的」
——预注入包 `addEventListener` 没抓到任何 click/pointer 绑定（可能用 `onclick` 属性、
缓存引用、或监听的是别的 event），需直接读真实浏览器里该 widget 的监听器归属。

### Step 25 — widget 监听 `click`+移动事件，不是 pointerdown；补 mouseMoved 后点击仍不推进

**方法**：从 HAR 抽取 widget HTML（270KB）/api.js/chl_page 的**字符串表**，列出所有
事件名；据此判断 checkbox 到底监听什么。

**证据**：

1. widget 字符串表里的**事件名**：`click`、`keydown`、`mouseenter`、`mouseleave`、
   `mousemove`、`onclick`、`ontouchstart`、`pointermove`、`pointerover`、`touchcancel`、
   `touchend`、`touchmove`、`touchstart`、`wheel`。
   **没有** `pointerdown`/`pointerup`/`mousedown`/`mouseup`——step 23 补的 pointerdown/up
   并不是该 widget 用的面。
2. 它要的是 **`click` + 移动/进入事件（pointermove/pointerover/mousemove/mouseenter）**：
   移动事件是「真人把鼠标挪到 widget 上」的信号，缺失时 click 可能被忽略。
3. 修复：`Input.dispatchMouseEvent` 新增 `mouseMoved`，在按下前派发
   `pointerover→pointerenter→pointermove→mouseover→mouseenter→mousemove`（各有 trusted，
   pointermove/mouseover/mousemove composed）。回归测试
   `mouse_moved_dispatches_pointer_and_mouse_move_events`。

**结论**：event 派发已补到「move + click」完整序列，但点击后**仍无 `interactiveEnd`/
`complete`/`/pat/`**。至此命中测试、pointer、composed、mouseMoved 四条真实缺陷都已修且
单测覆盖，点击仍不触发 handler。剩下的怀疑收敛到两点：①handler 不是用 `addEventListener`
绑的（预注入包 addEventListener 抓不到），而是 `onclick` 属性或**加载时缓存的引用**；
②事件在 frame realm 里经 `_wrap(node)` 派发到 shadow 元素时 wrapper 不对。下一步要直接
插桩 obscura 的 `_eventTargetDispatch` / `_wrap`，看 click 到底有没有落到 handler。

### Step 26 — 修复事件/控件/iframe 一致性后重探：能力面通过，真实质询仍未完成

**假设**：当前分支 review 找到的事件与渲染差异可能直接阻断 interactive widget：实时
checkedness 没进入 paint/`:checked`、hover 边界事件重复、closed shadow retarget 泄漏、
frame animation/viewport 状态陈旧、pointer compatibility mouse 语义和 `CSS.supports`
指纹不一致。

**方法**：逐项修复并加 release 回归测试；用本机 Chromium 校准 `appearance` 支持集合；
运行完整 workspace nextest、release build、33 阶段 obstacle course；按
`obscura-challenge-probe` 先跑跨源 realm probe，再用 Reqable 代理与 stealth 对
`https://zencare.co/1.txt` 做一次 35 秒封顶实测。

**证据**：

1. checkbox/radio 的实时 checkedness 现在由 native DOM 保存，IDL、`:checked` 与 paint
   共用同一状态；radio 按 tree root/form/name 互斥。
2. `mouseMoved` 维护逐 page/realm hover 状态：同 target 只发 move，A→B 才发
   out/leave/over/enter 并填 `relatedTarget`；取消 primary `pointerdown` 仅抑制
   compatibility `mousedown`/`mouseup`，不错误吞掉 `click`。
3. closed shadow 外 listener 的 `event.target` retarget 到 host，closed root 内部不会从
   外部 `composedPath()` 泄漏。
4. iframe stylesheet/animation timeline 按 content root 持久化，导航清理旧 root；
   `innerWidth`/`innerHeight`/`visualViewport` 随 host resize 实时更新，0×0 不再保留
   screen fallback。
5. `new PointerEvent().pointerType === ""`；`appearance`/`-webkit-appearance` 的
   `CSS.supports` 与本机 Chromium allowlist 对齐，`-moz-appearance` 不再误报支持。
6. 验证结果：workspace release nextest **1542/1542**；obstacle course **33/33**；
   render+stealth release build 成功。跨源 realm probe 的 fetch/XHR/image/script 全部落到
   frame origin `:8902`，page origin `:8901` 为零。
7. 真实探测仍以 `Just a moment...` 结束，35 秒内没有得到 `/1.txt` 的真实 404；因此按
   本文判定口径仍是**未通过**，不能把 cookie 或截图生成当成成功。

**结论**：这批修复消除了八类可观测差异且没有引入本地能力回退，但它们不是
interactive challenge 的自动交互策略。当前 fetch 流程仍不会在 `interactiveBegin`
后主动移动并点击 checkbox，所以真实质询不应预期仅靠本批一致性修复自动完成。

### Step 27 — 独立复核初版修复：找到并消除负回归，真实质询状态不变

**假设**：step 26 的定向测试不足以证明改动没有负修正，尤其是 shadow event 尾态、
disabled 控件的物理输入、hover 顺序，以及 iframe 导航/viewport cache 的跨 realm 生命周期。

**方法**：三个独立审查任务按事件、输入、form/render 分组，以本机 Chrome 146 headless
为 oracle；给每个确定差异补 release 回归测试。随后重跑 workspace nextest、render 与
render+stealth release build、33 阶 obstacle course、realm probe 和真实 35 秒质询；另以
`611a72c` 的独立 release binary 与当前工作区交错跑 static、DOM 5000 rows 和三种 framework。

**证据**：

1. 初版确有负回归：disabled checkable 的 `.click()` 会激活，CDP 物理点击还会错误发送
   `mousedown/up`；hover boundary pointer/mouse 顺序与 Chrome 不同。修后 disabled 只收到
   `pointerdown/up`，不激活；hover 初入和 A→B 顺序与 Chrome 一致。
2. shadow dispatcher 补齐 nested host 的 `AT_TARGET`、non-bubbling composed host listener、
   per-listener `relatedTarget` retarget 和同端点 path suppression。派发结束会清理不可暴露的
   internal endpoint；即使内部 `stopPropagation`，composed event 的尾态 target 仍是 host。
3. iframe viewport 的首版 JS cache 使用子 realm 的 mutation epoch，父 realm resize 后稳定
   返回旧 `[300,65]`。改用共享 native activity/task epoch 后返回
   `[180,40,180,40]`，同一 epoch 的四个 getter 仍只复用一份 metrics。
4. browser-driven frame navigation 曾用 `set_dom()` 归还临时借出的同一 DOM，错误清空 sibling
   frame timeline；同时 nested frame state 泄漏。现在同文档归还保留 sibling，旧 parent 与
   nested root 都定向清理，端到端测试覆盖三项断言。
5. 最终门禁：workspace release nextest **1550/1550**（4 configured skipped）；render 和
   render+stealth release build 成功；obstacle course **33/33**，跨阶段 median 3028.7ms；
   realm probe 的 fetch/XHR/image/script 全落在 frame origin，page origin 为零。
6. `611a72c` → 当前的同机三次 median 对照：static 3024.8→3030.8ms（+0.20%），DOM 5000 rows
   3057.9→3057.1ms（-0.03%），React 3041.6→3028.2ms（-0.44%），Preact
   3030.6→3035.3ms（+0.16%），Vue 3040.9→3045.6ms（+0.15%）。全部远低于 ±10% 噪声口径。
7. 真实 zencare 仍停在 `Just a moment...` / `Verify you are human`，35 秒没有得到 `/1.txt`
   的真实 404；截图显示交互 checkbox 已渲染。因此严格判定仍是未通过，并非修复后退化。

**结论**：重新复核证明 step 26 初版不能直接宣称无回归；本 step 已修掉所有本轮确认的
负回归并以 Chrome 对照、1550 个 workspace test、33/33 和性能对照闭环。在已覆盖范围内
未见剩余 correctness 或 >10% 性能负增长。真实 Cloudflare 结果没有改善也没有退化，阻塞点
仍是交互挑战需要调用方/CDP 执行点击，而不是 realm 请求归属或 checkbox 渲染。

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
| 跨源 iframe 的截图是陈旧表面，不反映其当前 DOM | 依据截图推断 widget「没渲染出复选框」，方向全错 | 先做因果测试：改 frame 内的 DOM 看截图是否跟着变 |
| `Runtime.evaluate` 对某些表达式形式静默不执行，只回 `{}` | 把「探针没跑」当成「被测对象没反应」 | 一律 `JSON.stringify(...)` 包住并回读断言，确认求值真的发生 |
| 默认 feature 下整个模块不参与编译（`obscura-render` 的 `paint`） | `cargo test -p obscura-render` 全程没编译 paint.rs，17 个"失败"与改动无关，新写的测试也从未运行 | 先确认目标代码真的被编译：塞一行必然报错的语句，看构建是否失败 |

另注：`cf_clearance` 绑定 TLS 指纹 + IP + UA，跨进程复用需固定 stealth profile
（见 `OBSCURA_PROFILE` / `OBSCURA_ROTATE_PROFILE`）。

## 未决

按当前怀疑程度排序：

- **打通交互分支的点击**（step 22 定为首要方向）：closed shadow 命中测试和完整
  move/click 输入序列已经具备；剩余缺口是 fetch 流程不会在 `interactiveBegin` 后主动
  定位并操作 checkbox。先通过 CDP 驱动一次确定性的人工交互，实测 127KB 交互 JSVMP
  是否发出 `/pat/`，再决定自动化策略应属于调用方还是 CLI 工作流。
- **点击后 127KB 交互 JSVMP 能否算完证明**：未知，需实测。若点击后仍不发 `/pat/`，
  才回到「追 JSVMP 指纹面」这条路。
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
