# Cloudflare 挑战：诊断记录

针对 `zencare.co` 的 Cloudflare Turnstile 托管质询（5 秒盾）的逐步排查记录。
按 step 追加，每步记录**假设 / 方法 / 证据 / 结论**。被证伪的假设一并保留——
它们标出了不必再走的路。

当前状态：**未通过**。P0 五项 parity 修复（step 40，2026-08-15 实测）后输入链路保持打通、
时间线全面提速，但**断点未移动**：`/pat/` 依旧从不发出（首要阻塞，step 39 结论维持），
`complete` 依旧为 0。点击被接受（Verifying…）后证明仍被判失败，widget 重置并换 ray 重来；
点击后的 4976B 提交与 3256B 主页面回传已出现（比 step 22 时代前进一步），但仍无 `/pat/`、
无 `/ci/`、无 `interactiveEnd`。新可疑项：**`interactiveEnd` 消失**（step 37–38 时代稳定复现，
怀疑被 43cb4d4 的 bootstrap.js 重写牵连）。当前阻塞点：①**`/pat/` 从不发出**（step 39/40）；
②**`interactiveEnd` 缺失回归**（step 40 新发现）。

判据链：`interactiveBegin` → 点击 → `interactiveEnd` → `complete`+token → 站点真实 404。
判成败一律看 `cf_chl_rc_ni` 是否出现。

关键结论演进（被推翻的假设就地标记，详见各 step）：

| step | 当时结论 | 后来 |
|------|----------|------|
| 22 | 分流由 IP 干净程度决定 | 被 step 33 推翻（同 IP 下 Chrome 免质询而 obscura 被拦） |
| 29 | 怀疑预注入/观测停在主文档 realm | 被 step 30 证伪（真因是缺 `<label>` 激活行为） |
| 34 | 「心跳停止 = 失败信号」 | 被 step 36 作废（成功路径同样停止） |
| 36 | 断点是交互确认失败 | step 37 修事件字段后 `interactiveEnd` 首次出现 |
| 37 | 断点 = 错误码 `600010` | 现唯一实质阻塞（排在 `/pat/` 之后） |

时序约束：**检测到复选框就要立刻点**。该页 129 秒会自动换 ray（用户经验 30s+ 即可能刷新），
刷新会作废当前 widget 的 token，迟到的点击落在死 realm 上，表现和「点了没反应」一模一样。

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

#### Step 9 回填(通用修复,2026-08-14)

已定位并修复:导航或 CDP 命令取消 deno_core 的 run-to-idle poll 后,可变 timer
sleep 会保留已失效的旧 waker。下一次 event-loop turn 看到已到期的真实单调 deadline
时,内核通过 yield-only async op 重建当前 poll 的唤醒路径;timer deadline、任务排序与
HTML nested floor 仍由通用 timer queue 决定。固定导航 fixture 中修复前 50/100ms
均在约 103ms 批量触发,修复后分别约 52/103ms;autonomous CDP 路径同样覆盖。`RUST_LOG=obscura::timers=trace`
可见 repair、park、wake 和 tick 边界证据。

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

> **本步的 IP 归因已被 step 33 推翻**：同一出口 IP 下 Chrome 免质询而 obscura 被拦，
> 分流不由 IP 决定，差异只能来自客户端指纹。本步保留的价值：「需要点击」的结论经
> step 28 量化证实成立；命中测试不穿透 shadow 的缺口经 step 23 修复。

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

### Step 28 — 黄金基线：真实浏览器同代理下，点击 checkbox 是过盾的**唯一**触发条件

**假设**（用户原假设，step 22 已定为首要方向）：obscura 不再向后推进，就是因为没有点击
checkbox。此前一直缺一个「点击确实能过」的正对照——不能排除 interactive 分支在这个出口 IP
上本身就是死路。

**方法**：用 js-reverse 连一个**走同一 Reqable 代理**（同一"脏"出口 IP）的独立 Chrome 146
（`--user-data-dir=/tmp/jsrev-profile --proxy-server=http://127.0.0.1:9000`），对
`https://zencare.co/1.txt` 做三次对照：

1. **实验组**：等 checkbox 出现 → CDP `Input.dispatchMouseEvent` 派发 move→press→release。
2. **对照组**：等 checkbox 出现 → **不点击**，静置 199 秒。
3. **同 ray 前后对照**（最强）：在对照组已经卡死 120 秒的那一个 ray 上补一次点击。

checkbox 坐标由截图定位：viewport 1200×739、dpr=2，widget 复选框中心 CSS ≈ (173, 311)。

**证据**：

1. **真实浏览器在同一代理下同样被分流到 interactive**——出现「请验证您是真人」复选框。
   这独立复现了 step 22 的分流结论，且排除了「只有 obscura 会被降级」的可能。
2. **第一轮 managed 阶段浏览器是走完的**：`POST /fo/<tokenB>` → `GET /pat/`(401) →
   `GET /ci/`(200 png) → `POST /fo/<tokenB>`，然后**停住**并显示 checkbox。
   对比 obscura：从不发 `/pat/`、不发 `/ci/`（step 22 证据 2），这是**另一处独立差异**。
3. **对照组：不点击就永远不过**。ray `a2a80336` 起于 t=1786627178，最后一条质询请求在
   t+3s，此后 **106 秒零新请求**；t+129s 页面自动换到新 ray `a2a8065c` 重来一轮，
   同样走到 `fo→pat(401)→ci→fo` 后停住，到 t+199s 仍是「正在进行安全验证」。
   → **自动二次刷新本身不会过盾**。
4. **同 ray 前后对照（决定性）**：ray `a2a8065c` 自 t=1786627307 起静止 **120 秒零请求**；
   t=1786627427 派发点击后：

   | 相对点击 | 事件 |
   |---|---|
   | +0s | `Input.dispatchMouseEvent` move→press→release @ (173,311) |
   | ~+1s | `POST challenges.cloudflare.com/.../fo/<tokenB>` ×2（提交交互证明） |
   | ~+2s | `POST zencare.co/.../fo/<tokenA>`（回传主页面） |
   | +8s | 页面标题 = `Find The Best Therapists & Psychiatrists Near You — Zencare`，正文 `404 Oops! We can't seem to find the page...` |

   按本文判定口径，`/1.txt` 返回站点自己的真实 404 页 = **过盾成功**（不是靠 `cf_clearance`
   出现来判定）。

**结论**：**用户原假设成立且已量化证实**。在这个出口 IP 上，interactive 分支不是死路，
点击 checkbox 是过盾的**唯一**触发条件——不点则 120 秒零请求、二次刷新也无用；一点则
2 秒内提交证明并放行。因此 obscura 卡住的直接原因就是**它从不发起这个点击**。

由此得到两条可直接用于 obscura 侧的判据与约束：

- **成功判据（点击是否真的落到 handler）**：点击后 ~2 秒内必须出现一条**新的**
  `POST challenges.cloudflare.com/.../fo/<tokenB>`。没有这条，就是事件没送达 handler，
  与「点击了但被拒绝」无关。
- **时序约束（用户提示 + 实测）**：**检测到 checkbox 渲染就必须立即点**，不能先等待观测。
  实测该页 129 秒会自动换 ray 重来（用户经验是 30s+ 即可能刷新），刷新会作废当前
  widget 的 token，迟到的点击落在已失效的 realm 上，看起来就像"点了没反应"。

**遗留**：step 22 曾把「浏览器 HAR 一次过、无需点击」当作基线，那是**干净 IP** 下的
managed 分支。本 step 起，代理场景的正确基线是「managed 走完 → 停在 checkbox → 点击 →
放行」这条 interactive 链路。

### Step 29 — 同一探针对 obscura：点击命中却零反应（最新二进制复测）

> **本步的归因已被 step 30 证伪**：「点击无效」的观察是对的（三张截图字节恒等），但
> 「怀疑 realm 注入/观测错位」不成立——派发链路本身完全正常，真因是缺 `<label>` 激活行为。

**假设**：step 26/27 的一致性修复之后，同样的 CDP 点击应当能在 obscura 上复现 step 28
的放行链路。

**方法**：先 `V8_FROM_SOURCE=1 cargo build --release ... --features render,stealth` 重建
（**注意**：工作区里的二进制比 `0d58c6c` 旧了一小时，直接跑会测到旧代码——这正是
本文「测量盲区」里记过的坑，本轮先撞了一次）。然后用 step 28 在真实 Chrome 上验证过的
同一个探针 `scripts/cdp_click_fast.py` 打 `obscura serve --stealth --proxy`。

**证据**：

1. **探针在真实 Chrome 上是好的**：t=6.3s 点击 →+2s 就拿到 Zencare 真实 404。
2. **同一探针对 obscura 全程 `box=null`**——但这是**探针失真，不是 obscura 没渲染**。
   单独诊断（单行表达式）证明 obscura 侧一切正常：closed shadow root 1 个、其中 iframe
   1 个、**box=[192,304,300,65]**（与 step 23 一致）、`[id^=cf-chl-widget]` 存在、
   27 条 postMessage（含 `init/mode:"managed"`）。真因是 obscura 的 `Runtime.evaluate`
   对**多行 `JSON.stringify((function(){...})())` 形式静默不返回值**；改单行 IIFE 后正常。
   已补进「测量盲区」。
3. **改用截图做观测面**（不依赖 JS 求值）：等 14s 后 obscura 确实渲染出
   `Verify you are human` 复选框，widget 在 (192,304)–(492,368)，复选框中心 ≈ (212,336)。
4. **点击 (213,335) 后完全无反应**：`before` / `after4s` / `after10s` 三张 PNG
   **字节数完全相同（32492）**，像素级零变化。对照 step 28 的真实浏览器：同样的点击
   2 秒内就发出证明 POST 并放行。

**结论**：**两件事都成立，必须分开说**——

- 卡住的**直接原因**确实是没有点击（step 28 已量化证实：不点则静止，点则 2 秒放行）。
- 但**光是「让 obscura 去点」并不够**：obscura 在正确坐标上派发完整
  move→press→release 之后，Turnstile 零反应。命中测试（step 23）、composed
  （step 24）、mouseMoved（step 25）都已修且有单测，事件也确认命中了 frame 内的
  复选框 span（step 24 插桩），却仍然驱动不了 handler。

**下一步（收敛后的首要怀疑）**：step 24/25 说「预注入包 `addEventListener` 抓不到任何
click 绑定」，当时归因为 handler 用了 `onclick` 或缓存引用。但更可能是**注入错了 realm**
——`Page.addScriptToEvaluateOnNewDocument` 只作用于主文档，而复选框的 handler 活在
**widget iframe（challenges.cloudflare.com）自己的 realm** 里，主文档的钩子根本看不见它。
所以要先验证 obscura 的预注入是否覆盖子 frame realm；若不覆盖，就在 frame realm 内插桩
`addEventListener` / `_eventTargetDispatch`，直接看点击有没有走到 handler。

**判据（沿用 step 28）**：点击后 ~2 秒内出现新的
`POST challenges.cloudflare.com/.../fo/<tokenB>` 才算事件真正送达。

### Step 30 — 真因：缺 `<label>` 激活行为，点击到不了 Turnstile 绑 handler 的 `<input>`

**假设链**（本 step 连续证伪了三个自己的探针结论，过程比结论值钱）：

1. 「事件没进 frame realm」——**证伪**。
2. 「frame realm 里一个 listener 都没有」——**证伪，且是探针假象**。
3. 「Turnstile 没注册 click handler」——**证伪**。

**方法**：CDP 外部探针连续失真后转为 Rust 侧插桩（`OBSCURA_INPUT_PROBE` 门控），在
**事件实际派发的那个 realm 内**打印 target 祖先链、派发结果，并在派发前挂真监听器做
端到端验证；再用 `Page.addScriptToEvaluateOnNewDocument` 注入 `addEventListener` hook
（page.rs:2379 确认 preload **会**在每个 frame realm、author script 之前执行）。

**证据**：

1. **事件派发链路完全正常**（推翻假设 1/2）：

   ```
   registryVisible=undefined
   PROBE_LISTENERS_FIRED=[doc:pointerdown@#document target:pointerdown@SPAN win:pointerdown@?
                          doc:mousedown@#document   target:mousedown@SPAN   win:mousedown@?]
   pointerAllowed=true suppressMouse=false disabled=false  defaultView=self ownerDoc=self
   ```

   capture→target→bubble 三站齐全、顺序正确、未被取消。step 23–27 修的东西都生效了。
   `registryVisible=undefined` 同时证明：先前那版探针读的 `_eventTargetListeners` 在
   `<cdp-input>` 脚本里**根本不可见**（它是 bootstrap 的 script 作用域 `const`），所以
   「整条链零 listener」是**纯假象**。

2. **Turnstile 注册得很完整**（推翻假设 3）。widget realm 的 addEventListener hook：

   ```
   Element/HTMLElement + click on INPUT          ← click 绑在 <input> 上
   HTMLElement + pointerdown/mousedown/pointerup/mouseup on SPAN.DuHyD8   ← span 上没有 click
   Document + click on #document / mousemove on #document
   window + click/mousedown/mouseup/pointerdown/pointerup/message/error
   ```

3. **错配就在这里**：命中的是 `span.DuHyD8`，它在 `label.yYpYJ6` 里；而 `click` handler
   绑在 label 关联的 `<input type=checkbox>` 上。`input.rs` 的 click 派发路径处理了
   checkbox/radio 自身、`a[href]`、`button`、`input[submit]`——**唯独没有 `<label>` 的
   激活行为**（规范：点击 label 内的元素要对 labeled control 跑 synthetic click
   activation steps）。bootstrap.js 那边 `get labels()` 也恒返回空列表（:9516）。
   于是 INPUT 的 click handler 永远不被调用。

4. **一次性验证**（`OBSCURA_LABEL_ACTIVATION` 门控，非正式修复）：click 派发后把激活
   转发给 label 关联控件。日志 `[label-activation] forwarding to INPUT type=checkbox`，
   页面**第一次动了**——此前每轮三张截图字节数恒等：

   | t | 状态 |
   |---|---|
   | 14.2s | 点击 (213,335)，box=(192,304,300×65) |
   | 17.4s | **`Verifying you are human. This may take a few seconds.`** ← 复选框被接受 |
   | 19.6s | 退回 `Performing security verification`，widget 重置 |
   | 21–34s | 稳定不再变化 |

**结论**：**真因是 obscura 没有实现 `<label>` 的激活行为。** 这是一条规范级缺口，
与 Cloudflare 无关，任何「label 包着自定义控件、handler 绑在隐藏 input 上」的页面都会
中招——Turnstile 的复选框正是这个结构。

断点因此前移了一格：不再是「点击驱动不了 handler」，而是**「点击已被接受、Turnstile 进入
verifying、但证明未通过而重置」**。这正是 step 22 预留的那条路——回到 JSVMP 指纹面。

**待办**：正式实现已落地（commit `7521680`：`for=` 按 tree scope 解析、否则首个 labelable
后代，含 interactive content 例外、labeled control 自身不重复、disabled/hidden 跳过，
回归测试见 `crates/obscura-cdp/tests/input_label_activation.rs`）。仍缺：`labels`/`control`
IDL 补真（`htmlFor` 已有实现），以及 `HTMLElement.click()` 路径的 label 转发（程序化点击
仍到不了 input）。

### Step 31 — 确认：拿到了 `cf_clearance`，但它是失败路径的无效票（`cf_chl_rc_ni=1`）

**假设**（用户提出）：obscura 现在已经拿到 `cf_clearance`，只是这张票无效，所以最终访问
又是 403。

**方法**：`cf_clearance` 是 HttpOnly，`document.cookie` 看不见，改用 CDP
`Network.getAllCookies`。又因为它绑定 TLS 指纹 + IP + UA，用 curl 重放什么也证明不了，
所以复访必须在**同一个 obscura session** 内 re-navigate。三步：①点击前/后各 dump 一次
cookie 定位下发时机；②同 session 复访 `/1.txt`；③与真实 Chrome 成功那次的 Set-Cookie
流对照（js-reverse `list_network_requests --cookieName`）。

**证据**：

1. **下发时机 = 点击提交之后**，且与失败码同时到达：

   ```
   t=12s (点击前)     (none)
   widget 渲染后      (none)
   clicked
   click +6s          cf_clearance@zencare.co(597) + cf_chl_rc_ni@zencare.co(=1)
                      + cf_clearance@cloudflare.com(810)
   ```

2. **同 session 复访仍被拦**：带着这份 cookie 重新 navigate `/1.txt`，得到的仍是
   `Just a moment...`（46 个元素的质询页），不是站点真实 404。CF 的质询页本身就是
   HTTP 403，所以表现就是「再次 403」。

3. **与成功路径对照**（真实 Chrome，走同一代理）：

   | | `cf_clearance` | `cf_chl_rc_ni` |
   |---|---|---|
   | Chrome 成功 | 597 字节，由 `POST zencare.co/.../fo/<tokenA>` 下发 | **0 条，从不出现** |
   | obscura 失败 | 597 字节，**长度完全相同** | **=1** |

   Chrome 那次卡住的第一轮（reqid 97，ray `a2a80336`）**同样**下发了 `cf_clearance`——
   再次印证本文判定口径：**cf_clearance 的存在与长度都不是过盾判据**。

**结论**：**用户的判断正确。** obscura 确实拿到了 `cf_clearance`，长度与成功时一模一样，
但它是**失败路径下发的无效票**，同批还带着 `cf_chl_rc_ni=1`；拿它复访照样被质询。

因此现在的链路是：点击（需 label activation）→ Turnstile 接受 → 提交证明 →
**CF 判定失败** → 下发无效 clearance + `cf_chl_rc_ni=1` → widget 重置。
阻塞点确定落在**证明内容本身（JSVMP 指纹面）**，与输入链路、cookie 处理都无关。

**判据更新**：今后一律用 `cf_chl_rc_ni` 是否出现来判成败，比「有没有 cf_clearance」
可靠得多，也比等页面跳转快。

### Step 32 — 双向 message 对比：找到 `cs` 栈指纹，并测出 inline script 行号偏移

**方法**：只**添加** `message` 监听器、不包装 `postMessage`/`contentWindow`（step 6 的教训：
包装会让握手消息整批消失）。preload 在每个 frame realm 都跑（page.rs:2379），一次注册即可
覆盖两侧：`TOP <=` 即 widget→parent，`WIDGET <=` 即 parent→widget。

**证据 1：完整的双向流量**（obscura，35s 封顶）

| 方向 | 事件 |
|---|---|
| widget→parent | `init(mode:managed)` → `requestExtraParams` → `translationInit` → `food` seq 1..15 → **`interactiveBegin`@9019ms** |
| parent→widget | `meow` seq 1..N（父侧心跳）、`init`、`extraParams`、`execute` |

点击后 **没有任何新事件**，`food` 心跳在 seq 15 停止 —— 与 step 31 的
`cf_chl_rc_ni=1` 对得上：证明被判失败，widget 直接收摊。

**证据 2：父页面向 widget 发的 `cs` 就是 `Error.stack` 指纹**

```
{"cs":[[0,68,"Error
    at ki (…/turnstile/v0/g/<ch>/api.js?onload=…&render=explicit:1:19216)
    at ke (…api.js:1:19347)
    at Object.I [as render] (…api.js:1:62948)
    at Al.AV (…/chl_page/v1?ray=…:3:178541)
    at Al.<computed>.<computed> [as run] (…:1:19257)
    at AO (…:3:115818)
    … 共 10 帧",1]], "event":"extraParams" }
```

10 帧全是页面自己的脚本，**没有 obscura 引擎帧**——step 8 的修复确实生效。

**证据 3：受控对照（19 种栈形态，obscura vs Chrome 146）**

真实 Chrome 在同一代理下已**不再触发质询**（cookie 用 `Network.clearBrowserCookies`
清到 `total=0` 仍直接返回真实 404），拿不到实时 `cs` 对照，因此改用受控测试页：

- **函数名/别名格式逐字一致**：`Object.I [as render]`、`Cls.<computed> [as k1]`、
  `C2.k1`、`Array.map (<anonymous>)`、`JSON.stringify (<anonymous>)`、
  `eval (eval at <anonymous> (FILE:41:41), <anonymous>:1:1)`、`Object.get` 全部相同。
  `Error.toString`/`stackTraceLimit`/`prepareStackTrace`/`captureStackTrace` 也一致。
  → 先前怀疑的 `Al.<computed>.<computed> [as run]` 是 **Turnstile 自身代码结构**导致的，
  不是 obscura 的缺陷。
- **唯一差异：inline script 的行号**。列号完全相同，行号 obscura 一律偏小，
  偏移量 == `<script>` 标签前的 HTML 行数。专门构造的验证（`<script>` 在第 11 行）：

  | | 栈帧 |
  |---|---|
  | Chrome | `at ki (FILE:12:23)` ← 文档**绝对**行号 |
  | obscura | `at ki (FILE:2:23)` ← script **内部相对**行号 |

**结论**：obscura 的 inline `<script>` 栈帧行号用的是脚本内相对行号，Chrome 用的是文档
绝对行号（起始行 = `<script>` 所在行）。这是**一行代码即可检测**的指纹差异，且正落在
Cloudflare 明确采集的 `Error.stack` 面上。

**诚实边界**：本次 `cs` 里的 10 帧**全部来自外部脚本**（`api.js`、`chl_page/v1`），
外部脚本行号从 1 起算、不受此偏移影响。所以这个差异是**真实且可检测的缺陷**，但
**尚未证明**它就是本次判失败的直接原因。要坐实还需在质询页里找到一处 inline 栈采集。

**修法**：V8 编译 inline script 时应传入起始行/列偏移（`ScriptOrigin` 的
`resource_line_offset` / `resource_column_offset`），值取 `<script>` 标签在文档中的位置。

### Step 33 — 修正 step 22：分流不是由 IP 决定的

**证据**：真实 Chrome 与 obscura 走**同一个 Reqable 代理、同一出口 IP**。把 Chrome 的
cookie 清到 `total=0` 后重新访问，Chrome **直接拿到真实 404，完全不触发质询**；而 obscura
在同一时间、同一 IP 上仍被质询并分流到 interactive 分支。

**结论**：step 22 记的「managed vs interactive 由 IP 干净程度决定」**不成立**，至少现在不是
主因。同一 IP 下两者待遇不同，差异只能来自**客户端指纹**（TLS/HTTP2 指纹、JS 环境、
Error.stack 这类面）。这把战线从"换个干净 IP"重新拉回到指纹一致性上。

**副作用**：这也意味着 Chrome 侧暂时无法复现质询，实时对照要么换未被信任的出口，要么
改用受控测试页（step 32 的做法）。

### Step 34 — obscura vs Chrome 的 message/worker 逐项对比

**方法**：Chrome 用全新 `--user-data-dir` 重启才重新触发质询（老 profile 即使 cookie 清到
0 也直接放行，见 step 33）。OOPIF 侧用 `Target.setAutoAttach(waitForDebuggerOnStart)` 注入，
且**必须等注入返回再 resume**——先 resume 会让 hook 落在页面脚本之后，什么都抓不到。
worker session 一律跳过：`Page.enable` 在 worker 上永不返回，十几个 20s 超时会把 dump 阶段
饿死（前一次整轮空结果就是这么来的）。

**对比结果**：

| 观测项 | obscura | Chrome 146 | 差异 |
|---|---|---|---|
| widget→parent 事件序列 | `init(managed)` → `requestExtraParams` → `translationInit` → `food` → `interactiveBegin` | 完全相同 | 无 |
| `interactiveBegin` 时刻 | 9019ms | 6896ms | 无实质 |
| parent→widget | `meow` 心跳、`init`、`extraParams`、`execute`（含 `cs` 栈） | 同类（`cs` 全文未取到） | — |
| **点击后 `food` 心跳** | **seq 15 后停止** | **继续到 seq 25+（23.6s 仍在跳）** | **有** |
| worker spawn | 24 次；同一 `src_len=291` blob 实例化 12 次 | 13+ session；同一 blob 实例化 11 次 | 无 |
| `Error.stack` 19 种形态 | 与 Chrome 逐字一致 | — | 仅 inline 行号（step 32） |
| `translationInit.displayLanguage` | `en-us` | `zh-cn` | 次要（Accept-Language 不同） |

**结论**：握手、事件序列、worker 并行度这三块**都不是差异点**——obscura 在这些面上与 Chrome
一致。真正的行为差异只有一处：**点击提交后 obscura 的 widget 心跳停了，Chrome 的还在跳**。
结合 step 31 的 `cf_chl_rc_ni=1`，这说明 obscura 提交的证明被**当场判失败**、widget 随即收摊；
Chrome 则继续保持会话。心跳停止因此是一个**比截图更快的失败信号**（点击后 ~2s 即可判定）。

> **本判据已被 step 36 作废**：成功路径里 `food` 心跳同样在 `complete` 前后停止
> （最后一次 7571ms），「心跳停止 = 失败信号」不成立。正确判据是
> `interactiveEnd → complete`+token 链。

**取 Chrome `cs` 的可复现配方**（第一次尝试失败，第二次成功）：每次都要**全新
`--user-data-dir`**（旧 profile 捕获两次质询后即被放行）；OOPIF 注入必须**等
`addScriptToEvaluateOnNewDocument` 返回再 `runIfWaitingForDebugger`**；worker session 全部
跳过。满足这三条才能拿到 `=== realm challenges.cloudflare.com… : 35 msgs ===`。

### Step 35 — `cs` 栈逐帧对比：api.js 段完全一致，chl_page 段结构不同

| | 帧数 | 栈底 |
|---|---|---|
| Chrome 146 | **9** | 回到 `api.js` 的两个匿名帧（`:1:40905`、`:1:81642`） |
| obscura | **11** | 停在 `chl_page` 的 `Al.A8` |

**完全一致的部分**（逐字，含行列号）：

```
Error
  at ki (…/api.js?onload=mlyM5&render=explicit:1:19216)
  at ke (…/api.js:1:19347)
  at Object.I [as render] (…/api.js:1:62948)
```

→ obscura 在 **api.js 这一层的执行路径与 Chrome 完全相同**。

**不同的部分**（`chl_page/v1` 段）：

```
chrome : at yD.yy (…chl_page:3:27206)
         at yD.<computed>.<computed> [as run] (…:2:6925)
         at yE (…:3:49754)
         at …/api.js:1:40905          ← 回到 api.js
         at …/api.js:1:81642
obscura: at Al.AV (…chl_page:3:178541)
         at Al.<computed>.<computed> [as run] (…:1:19257)
         at AO (…:3:115818)
         at Al.AV (…:3:178787)        ← 同一组三元组又来一轮
         at Al.<computed>.<computed> [as run] (…:1:19257)
         at AO (…:3:115818)
         at Al.A8 (…:3:145297)
```

**重要限定**：`chl_page/v1` 是**每个 ray 重新混淆生成**的，函数名（`yD/yE` vs `Al/AO`）与
行列号本来就不可比，**不能**据此直接判定 obscura 有问题。可比的是**结构**：

1. `Al.<computed>.<computed> [as run]` 这种双 `<computed>` 格式 **Chrome 也产出**
   （`yD.<computed>.<computed> [as run]`）→ 彻底排除 step 32 遗留的这个怀疑，是正常 V8 格式。
2. obscura 的 `AV → run → AO` 三元组**重复了两轮**，Chrome 只有一轮；且 Chrome 的栈**回到
   api.js**（说明是从 api.js 的回调进入），obscura 的栈**停在 chl_page 内部**。
3. `cs` 的第二个字段（`[0,N,"Error…"]`）：**Chrome=1，obscura 观测到 7 / 68 / 116**。若它是
   计数器或耗时，两边差一到两个数量级。

**结论**：栈**内容**层面 obscura 与 Chrome 在可比的 api.js 段上一致；差异集中在
chl_page 的调用结构——obscura 多一层重复调用、入口来源不同、`cs` 的 N 值大得多。这三者都
指向「obscura 在 chl_page 里走了重试/额外一轮」，但**尚未证明**，因为混淆脚本每 ray 不同。

**下一步验证**：同一侧多次采样，看 `N` 值与重复三元组是否稳定出现；若稳定，再用 v8 trace
定位 `AV/AO` 对应的实际 API 调用，找出被重试的那一步。

### Step 36 — 探针挂起了 worker：推翻本轮三个结论，并拿到成功样本的黄金基线

**触发**（用户观察）：「Chrome 一直转圈」。

**真因**：采集脚本对子 target 用了
`Target.setAutoAttach(waitForDebuggerOnStart: true)`，它会**暂停每一个新 target**；
后来为了躲开 worker session 上 `Page.enable` 永不返回的超时，我把 worker **整类跳过**
——于是那十几个 `blob:challenges.cloudflare.com` worker **全部被挂起，永远没人 resume**。
Turnstile 的证明就跑在这些 worker 里，它们不动，widget 自然永远停在 `Verifying...`。

**被这个 bug 污染的结论，逐条更正**：

| 之前写的 | 实际 |
|---|---|
| 「Chrome 在当前 IP 上也过不了盾了」 | **错**。修复后同一 IP、同一代理，Chrome 稳定过盾 |
| 「出口 IP 已被 CF 惩罚到连真实浏览器都拦」 | **错**。是探针挂起 worker |
| 多次 `overrunBegin` 是 CF 的真实判定 | **错**。是 worker 被挂起导致的超时 |

**正确做法**：`waitForDebuggerOnStart` 下，**每个** attached target 都必须
`Runtime.runIfWaitingForDebugger`；只是 worker 不要发 `Page.*`，且 resume 要
fire-and-forget（worker session 可能永不回包，等它会拖死后续请求）。

**成功样本（黄金基线）**：修复后 Chrome 稳定复现「等 `interactiveBegin` → 点击 → 过盾」：

```
1830ms  TOP    <= init (mode:managed)
 251ms  WIDGET <= init / extraParams / cs(栈指纹)
2865ms  TOP    <= translationInit
6122ms  TOP    <= interactiveBegin          ← 要求点击
        [click @ 7.9s]
7379ms  TOP    <= interactiveEnd            ← 点击被接受
8047ms  TOP    <= complete + token=1.4TM7ap…  ← 验证通过
        → 导航 → 站点真实 404
```

**判据修正**：成功路径里 `food` 心跳最后一次在 7571ms，也在 `complete` 前后停止。
所以 step 34 写的「心跳停止 = 失败信号」**不成立**，就此作废。正确判据是
**`interactiveEnd` → `complete`+`token`** 这条链。

**obscura 对照**（正式 label activation 版本，点击 t=14.5s）：

| 事件 | Chrome 成功 | obscura |
|---|---|---|
| `interactiveBegin` | ✓ 6122ms | ✓ 9369ms |
| **`interactiveEnd`** | **✓ 7379ms** | **✗ 从未出现** |
| **`complete` + token** | **✓ 8047ms** | **✗ 从未出现** |

**结论**：断点从「证明失败」精确到了**「交互确认失败」**——obscura 的点击让 widget 进入了
`Verifying`（step 30 截图），但 Turnstile **从不发 `interactiveEnd`**，即它没有把这次点击
认定为一次完成的人类交互。所以下一步该查的是**交互本身的可信度**（鼠标轨迹只有 2 个
move、按下/抬起间隔、事件时序），而不是 JSVMP 的指纹面。

### Step 37 — 修复：鼠标事件字段与 Chrome 对齐，`interactiveEnd` 首次出现

**假设**（step 36 收敛出的方向）：Chrome 用**完全相同**的 CDP 命令序列能过盾，obscura 不能，
所以问题不在点击序列，而在这些命令**变成了什么样的事件**。

**方法**：新脚本 `cdp_event_trace.py` 在 widget realm 内记录每个鼠标/指针事件及 Turnstile
能读到的全部属性，两个引擎各跑一次逐字段对比（obscura 的 console 落在 serve 日志，
Chrome 的经 `Runtime.consoleAPICalled` 实时收流）。

**证据**：6 处差异，其中一处是全局性的：

| 字段 | Chrome | obscura（修复前） | 修复后 |
|---|---|---|---|
| `timeStamp` | 4769 / 4857 / 4940 / 5022 | **1786637618868** | 8502 / 8588 / 8677 / 8764 |
| `screenX/Y` | 195,453 | 0,0 | 213,335 |
| `button`（pointer move/over/enter） | **-1** | 0 | -1 |
| `button`（对应的 MouseEvent） | 0 | 0 | 0 |
| `detail`（pointerdown/up） | 0 | 1 | 0 |
| `pressure`（pointerdown） | 0 | 0.5 | 0 |
| `cancelable`（over/move） | true | false | true |

`Event.timeStamp` 是相对 time origin 的 `DOMHighResTimeStamp`，obscura 却用了
`Date.now()`——**每个事件都带着 ~1.7e12 的时间戳**，而浏览器报的是几千。这是一行代码
即可命中的破绽，且 Turnstile 恰好用事件时间戳判断交互时序。改走 `performance.now()`。

其余是派发侧：没有按钮变化的 PointerEvent 报 `button:-1`（其兼容 MouseEvent 仍为 0）、
pointerdown/up 不带 click 计数、over/move 可取消、`screenX/Y` 给页面坐标而非常量 0。

**回归**：workspace 719 / obscura-js 446 / obscura-cdp 173，全绿。修复过程中发现兼容
MouseEvent 的 init 不能提前快照——快照发生在 `relatedTarget` 赋值之前，会把边界事件的
relatedTarget 悄悄丢掉（`consecutive_mouse_moves_only_cross_boundaries_when_the_target_changes`
当场抓到）。

**实测结果（决定性）**：

```
widget d14sy: init → requestExtraParams → translationInit
            → interactiveBegin
            → interactiveEnd                    ← 首次出现，此前恒缺失
            → fail code="600010" + cfChlOut/cfChlOutS
```

**结论**：这批字段修复让 Turnstile **第一次把 obscura 的点击认定为一次完成的人类交互**
（`interactiveEnd`）。断点随之从「交互确认失败」推进到**明确的失败码 `600010`**，
且 Turnstile 现在会返回 `cfChlOut`/`cfChlOutS` 两个加密载荷。

**下一步**：查 `600010` 的含义（api.js 字符串表里应有对应分支），它是目前唯一的阻塞点。

### Step 38 — UA 分裂：JS 侧与 HTTP 头两个来源，`serve` 路径不同步

**触发**（用户从 Reqable HAR 发现）：同一次运行里请求的 User-Agent 不一致。

**证据**（`/tmp/3.har`，8 条请求）：

| UA | 请求 |
|---|---|
| `Windows NT 10.0; Win64; x64 … Chrome/143.0.0.0` | 文档导航：`GET /1.txt`、widget iframe 文档 |
| `X11; Linux x86_64 … Chrome/145.0.0.0` | chl_page、api.js、3 个 `POST /fo/` |

操作系统与大版本都不同。后者正是 `obscura-net/src/client.rs:1058` 里
`ObscuraHttpClient` 的**硬编码默认值**（`/json/version` 报的也是它）。

**根因**（`obscura-browser/src/page.rs:1149-1166`）：

```rust
if self.stealth_client.is_some() {
    rt.set_user_agent(obscura_net::STEALTH_USER_AGENT);   // JS 侧
} else {
    if let Ok(ua) = self.http_client.user_agent.try_read() {
        rt.set_user_agent(&ua);                            // 非 stealth 才跟随 http_client
    }
}
```

stealth 模式下 JS 侧改用 `STEALTH_USER_AGENT`，而 `http_client.user_agent` **从不同步**。
`obscura fetch` 看不出问题，是因为 CLI 在 `main.rs:740` / `1090` 另外调了
`page.http_client.set_user_agent(ua)` 把两边对齐；**`obscura serve`（CDP）没有这一步**，
只有客户端显式调 `Network.setUserAgentOverride` 才会设置
（`obscura-cdp/src/domains/network.rs:61`）。

于是在 CDP 模式下：`navigator.userAgent` 报 stealth UA，而部分 HTTP 请求头报默认 UA。
比对这两者是最基础的反自动化检查之一。

**与最近改动的关系：无关。** 最近 6 个提交只碰了 `input.rs`、`bootstrap.js`、
`input_label_activation.rs` 与文档/脚本，未触碰任何 UA / HTTP client / net 代码
（`git log -6 -p` 对 `user_agent`/`client.rs` 零命中）。这是既有缺陷，只是此前一直用
`obscura fetch` 跑、被 CLI 的对齐掩盖了；这几轮为了驱动点击改用 `serve`，才暴露出来。

**尚未隔离的一步**：本地 http（无代理）测试里所有请求 UA 一致，HAR 里的分裂发生在
https + 代理路径。说明至少有两条 HTTP 出口，其 UA 来源不同；具体分叉点待确认。

**根因（精确到两处，均已修 · commit 86bb258）**：

1. `obscura-js/src/ops.rs` 的 `op_fetch_url` **硬编码**了
   `X11; Linux x86_64 … Chrome/145`，与页面 UA 无关。它当初是为了补上"脚本请求没有
   UA"而加的，但取了常量而非客户端的值 —— 这就是 HAR 里 XHR 那一组的来源。
2. stealth 模式下 JS 侧报 `STEALTH_USER_AGENT`（Chrome145/Windows，与 wreq 的 TLS
   模拟一致），而 `BrowserContext` 仍按 `select_profile()` 取轮换 profile 的 UA 写进
   `http_client` —— 两者描述的浏览器不同，且 profile UA 还与 TLS 指纹自相矛盾。

修法：`fetch()`/XHR 改读 HTTP 客户端的 UA；stealth context 直接采用
`STEALTH_USER_AGENT`。于是 JS 侧、请求头、TLS 模拟三者同源。

**验证**：本地受控页（导航 + fetch + XHR + script + img）五条请求与
`navigator.userAgent` 完全一致；obscura-browser 82 / obscura-js 353 / obscura-cdp 173 全绿。

**修复后的真实质询**：`interactiveEnd` **稳定复现**（两次独立运行都有，此前从未出现），
但仍以 `fail code=600010` 结束，`complete` 依旧为 0。即 UA 分裂不是 600010 的成因。

### Step 39 — `/pat/` 缺失调查：参考 HaHaVM-General，假设未被 trace 证实

**背景**：step 38 的 HAR 时序对齐显示，Chrome 的成功链路里 `POST /fo/`(822KB) 之后
**366ms** 就发 `GET /pat/`(401)，再 `GET /ci/`(png)，最后 7KB 提交。obscura 从未发过
`/pat/`；第二轮虽然发了 `/ci/`，也延迟到 2.24s（Chrome 366ms）。`/pat/` 是链路上更靠前
的一环，因此优先于 `600010` 排查。

**参考**：`/Users/l9h8/reverse/web/HaHaVM-General`（把 CF solver 重建在通用 JS 引擎
框架上的项目）及其 `examples/cloudflare/`。

**发现 1：obscura 缺 Private Access Token 一族 API**

| API | HaHaVM | obscura |
|---|---|---|
| `document.hasPrivateToken` | 有（`core/env/Document.js:2062`） | **0 处** |
| `document.hasRedemptionRecord` | 有 | **0 处** |
| `document.hasStorageAccess` | 有（`Document.js:2155` 同组列出） | **0 处** |

HaHaVM 是照真实 Chrome 的 Document 接口补齐的，这三个是同一组。这是确认的接口面差距。

**发现 2：HaHaVM 为 `/pat/` 专门准备了 resource-timing 画像**

```js
// examples/cloudflare/lib/cfPerfProfiles.js
if (url.indexOf("/pat/") !== -1) return { domainLookupEnd: 2, responseStart: 2, responseEnd: 6 };
if (url.indexOf("/ci/")  !== -1) return { domainLookupEnd: 0, responseStart: 1, responseEnd: 3 };
```

它与 `/fo/`、widget 文档并列。说明在那个 solver 跑通的流程里 `/pat/` **确实会发生**，
且 CF 会读它在 `performance.getEntriesByType('resource')` 里的时序 —— 这同时呼应了
step 10 的未决项「Performance Timeline 全空」。

**发现 3（证伪自己的假设）**：假设「CF 通过 `document.hasPrivateToken` 探测 PAT 支持，
不存在就跳过 `/pat/`」。用 v8 trace 实测（`--trace-property-lookup`）：

```
hasPrivateToken 0   hasRedemptionRecord 0   hasStorageAccess 0   requestStorageAccess 0
```

**CF 这次运行根本没查过这些属性**，假设不成立。也提示 `/pat/` 可能不是 JS 显式发起的，
否则 trace 里应能看到对应调用。

**证据强度限定**：这次 trace 只有 **6MB**，而本文档记录的完整质询 trace 是
**140–220MB**，差两个数量级 —— 说明这轮远没跑到该跑的阶段就结束了。因此「0 次探测」
不足以排除该假设，需要一次能产出 100MB+ trace 的完整运行再验。

**下一步（按信息量排序）**：

1. 读 HaHaVM `examples/cloudflare/lib/forwardLoader.js`：它既然为 `/pat/` 备了画像，
   那份代码最可能直接说明该请求由谁、在什么条件下发起。
2. 补齐 `hasPrivateToken`/`hasRedemptionRecord`/`hasStorageAccess`：成本低、是已确认的
   接口差距，与 `/pat/` 是否相关都该做。
3. 重跑一次完整质询（wait 40s+、确保走完交互分支）拿到 100MB+ trace 再验发现 3。

**旁注**：HaHaVM 的 README 记了一条与本文 step 4 同源的经验 —— Turnstile 跑在子帧里，
补丁必须注入**每一帧**，只在顶层打补丁会导致子帧崩溃、父页面收不到 token、不发最终
提交。obscura 的 frame realm 预注入（page.rs:2379）已满足这一点。

### Step 41 — TextEncoder 拦截实验：`/fo/` 明文不走 TextEncoder.encode；interactiveEnd 回归疑云澄清

**假设**（用户提出）：参考 HaHaVM 的 TextEncoder hook（`envFunc.TextEncoder_encode` 覆盖），
用 v8 trace 拿到 `/fo/` POST 加密前的原始 JSON 字符串。

**先澄清 HaHaVM 的 hook 本意**：`lib/data/textEncoderPatch.js` 只特判 `value === "{}"`
（把空对象替换成 CSS 属性名列表）——那是 **CSS.supports 探测输入的指纹对抗**，与 `/fo/`
载荷明文无关。真正有价值的是它的拦截机制（hook 数据流入口），不是它拦截的内容。

**v8 trace 结论：不可行，实测三个证据**：

1. `String(TextEncoder.prototype.encode)` 实测 = `"function encode() { [native code] }"`
   ——deno_core 注入的原生绑定，bootstrap.js:8408 的 JS 类分支（`typeof TextEncoder ===
   'undefined'`）不生效。
2. trace 参数捕获靠 `frame->GetParameter(i)`，只对普通 JS 函数帧有效；native 绑定帧
   参数为空（postMessage 前例 `args=[]`）。TextEncoder.encode 同机制。
3. 当前二进制**没有 trace 补丁**（`strings` 对 `TracePropertyLookupFile` 零命中、
   `--trace-property-lookup-file` 报 unrecognized flag）——补丁构建必须带
   `--config 'patch.crates-io.v8.path="vendor/rusty_v8"'`，且 vendor 构建缓存为空，
   重建需全量编译 ~30 分钟。

**替代方案（HaHaVM 思路的 obscura 等价物）：预注入包装 `TextEncoder.prototype.encode`**
——纯转发不改行为，只记录入参。实测：

| 实验 | 结果 |
|------|------|
| 本地 enc.html：包装后 title 不变（`enc:32`），捕获完整明文 `{"proof":"hello-obscura","n":42}` | 包装无副作用、捕获有效 |
| 真实目标完整流程（等 interactiveBegin → 点击 → 4s 后 dump） | `encCount=4`，**全在交互前**：`"you"==="bot"`（worker 探测）、trustedTypes worker 源码（72+214B）、`GAPH2`；**点击后提交阶段零调用** |

**附带收获：interactiveEnd 回归疑云澄清**。点击时机修正（等 interactiveBegin 再点）后，
事件链完整出现：

```
interactiveBegin@7326 → interactiveEnd@9361 → fail code="600010"@10056
```

step 40 记的「interactiveEnd 消失」是 **CF 端波动**（不同 ray 的 widget 版本差异），
不是代码回归。`600010` 稳定复现，仍是唯一失败码。

**结论**：`/fo/` 提交载荷的加密前明文在**主 realm 不走 TextEncoder.encode**——JSVMP
用自实现的字符串→字节转换（混淆代码内部），没有标准 API hook 点。**已知盲区**：预注入
（`Page.addScriptToEvaluateOnNewDocument`）只覆盖文档 realm，**worker realm 未覆盖**
——若明文在 worker 里构造，本实验看不到。证明计算（822KB JSVMP）的归属（widget iframe
主线程 vs 其 worker）尚未确认。

**下一步（按信息量）**：
1. 确认证明计算跑在哪个 realm：worker 消息流（step 12 的探针）或 Rust 插桩
   `op_worker` 创建点看 JSVMP 是否把载荷 post 进 worker。
2. 若在 worker：引擎侧给 worker realm 加预注入（worker.rs 的 blob 执行前），重跑本实验。
3. 若确认两条路径都不走 TextEncoder：明文只能从 JSVMP 逆向或 op_fetch_url body
   （加密后）+ 内存关联反推；或等 P1 #6（CDP Debugger 域）按帧读栈。

## 测量盲区

### Step 40 — P0 五项 parity 修复后的基线：断点未移动，`/pat/` 依旧从不发出

**背景**：`feat/web-platform-parity` 分支合入五项 P0 修复（79e1238 Performance Timeline、
f4a1201 PAT API 族、43cb4d4 指纹推导引擎、76b6ae5 Stack/realm/referrer、827028d 定时器保真），
逐条对应本文「未决」清单（step 10 / 39 / 38 / 32 / 9）。roadmap 明确要求「补齐后回填
step 39 验证」——本 step 就是回填。

**方法**：`V8_FROM_SOURCE=1 cargo build --release --features render,stealth` 重建后，
起新 serve（端口 9225，proxy+stealth）跑 messages 探针 + 点击探针 + `RUST_LOG=obscura_js=debug`
请求日志。

**证据**：

1. **时间线全面提速，但形状不变**（旧进程 vs 新二进制，同一 URL）：

   | 事件 | 旧二进制（8/14 构建） | 新二进制（P0 修复后） |
   |------|----------------------|----------------------|
   | `init` | 4803 ms | **2333 ms** |
   | `translationInit` | 5381 ms | 2912 ms |
   | `interactiveBegin` | 10614 ms | **7420 ms** |

   定时器修复（step 9 回填）生效，但流程仍停在 interactive 分支，无 `complete`。

2. **请求序列（点击流程，P0 修复后）**——与浏览器基线的差异一目了然：

   ```
   42.6s  GET  zencare.co/.../chl_page/v1 → 200 (230KB)
   42.9s  GET  challenges.cloudflare.com/.../api.js → 200 (82KB)
   43.0s  POST zencare.co/.../fo/<tokenA> → 200 (113KB)
   45.3s  POST challenges.cloudflare.com/.../fo/<tokenB> → 200 (822KB JSVMP)
   46.6s  GET  brunhild.challenges.cloudflare.com/.../i/...      ← worker fetch（预期失败，浏览器同）
   50.3s  POST challenges.cloudflare.com/.../fo/<tokenB> → 200 (127KB 交互变体)   ← interactiveBegin 后拉取（step 22 归因）
   54.1s  POST challenges.cloudflare.com/.../fo/<tokenB> → 200 (4976B)             ← 点击后 ~5.4s
   54.6s  POST zencare.co/.../fo/<tokenA> → 200 (3256B)          ← 回传主页面（结构对应成功链路的最后一步）
   57.3s  GET  zencare.co/.../chl_page/v1（新 ray）              ← 换 ray 重来
   ```

   **`GET /pat/` 与 `GET /ci/` 依旧零出现。** 对比 step 28 浏览器交互基线
   （`/fo/` 822KB → `/pat/` 401 → `/ci/` png → `/fo/` 7KB 提交）：P0 五项修复后 obscura
   比 step 22 时代前进了一步（当时 127KB 交互变体后停滞；现在多出 4976B 提交与 3256B
   主页面回传——后者结构上对应浏览器成功链路的回传步，但结果仍是失败），**证明仍被判
   失败**（widget 重置 → 换 ray 重来），且 `/pat/` 这条链路上的前置环节依旧缺失。

3. **`interactiveEnd` 未出现**（可疑回归）：step 37–38 时代旧二进制在点击后稳定出现
   `interactiveEnd`（随后 `fail code=600010`）；本步点击后 postMessage 事件列表停在
   `interactiveBegin`，无任何新事件——但页面状态确实进入了 `Verifying you are human`
   （点击被接受，label activation 生效）再重置。43cb4d4 指纹推导引擎重写了 bootstrap.js
   241 行，step 37 修的鼠标事件字段（timeStamp/screenX/button/detail/pressure/cancelable）
   是否被牵连，待查。

**测量坑（本轮新踩）**：

- **9223 端口上是 8/14 01:15 启动的旧进程**（会话外遗留），我启动 serve 时静默绑定失败，
  前两轮探针实际打在旧代码上。判据：`ps -o lstart -p <pid>` 与二进制 mtime 对比。
  **这又是一次「进程比二进制旧」的盲区变体，已补进测量盲区表。**
- `cdp_click_fast.py` 从 t≈0.3s 就开始 `Runtime.evaluate` 轮询——踩中「导航早期 t≈1s
  求值永久清空文档」的坑（测量盲区表已有），表现为 `box=null`、title/body 全空。改法：
  首轮求值延迟 5s（`/tmp/cdp_click_fast_delayed.py`），随后一切正常。
- `RUST_LOG=obscura::js=debug` 匹配不到 `op_fetch_url` 的日志——它的 target 是模块路径
  `obscura_js::ops`，不是 `obscura::js`。请求序列要用 `RUST_LOG=obscura_js=debug`。
- 图片加载三模式对照（fetch / serve / MCP 同二进制）：本地页实测三者请求序列完全一致
  （index.html + red.png + green.png，`naturalWidth: 64`）。**图片不加载与模式无关**，
  是流程深度问题（`/ci/` 排在 `/pat/` 之后）。唯一真实的差异渠道是独立构建的 MCP
  二进制不带 `--features render`（obscura-mcp `default = []`，图片 op 整组不注册）。
  另：serve 不带 `OBSCURA_ALLOW_PRIVATE_NETWORK=1` 时本地导航直接被拒（
  `Access to private/internal IP address`），会伪装成「serve 模式不加载」。

**结论**：P0 五项修复（PAT API、Performance Timeline、指纹推导、栈/行号、定时器）
**没有移动断点**——`/pat/` 依旧从不发出（首要阻塞，step 39 结论维持），`complete` 依旧为 0。
`interactiveEnd` 的消失是新的可疑项（排在 `/pat/` 之后）。HaHaVM 侧确认：`/pat/` 由
Turnstile widget JSVMP 自身发起（`sec-fetch-mode: cors, dest: empty`，即 fetch/XHR），
HaHaVM 只负责让请求走通并提供 resource-timing 画像，没有显式的 `/pat/` 打补丁——
因此 `/pat/` 缺失 = JSVMP 在 822KB 载荷之后没走到「发证明请求」那一步。

**下一步（按信息量）**：
1. 重跑 `cdp_event_trace.py` 对比 Chrome/obscura 事件字段，确认 step 37 修复是否被
   43cb4d4 的 bootstrap.js 重写牵连（interactiveEnd 缺失的根因）。
2. v8 trace 追 JSVMP：822KB 载荷执行期间页面读到的差异面（trace 需 100MB+ 才算完整
   一轮，step 39 的 6MB 不算数）。
3. 用 `RUST_LOG=obscura_js=debug` 的请求序列作为后续每轮的固定观测面（URL+字节数，
   比 postMessage 更直接）。

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
| **obscura 的 `Runtime.evaluate` 对多行 `JSON.stringify((function(){...})())` 静默不返回值**（同一表达式在 Chrome 上正常） | step 29 一度读到 `box=null`、`title=''`，差点判成「obscura 没渲染出 widget」，实际 widget 一直都在 | 探针表达式一律压成**单行 IIFE**；换观测面前先用已知非空的值（如 `document.title`）自检一次 |
| 探针只在**主文档** realm 预注入（`Page.addScriptToEvaluateOnNewDocument`） | step 24/25 「`addEventListener` 抓不到任何 click 绑定」被归因为 handler 用 `onclick`/缓存引用；但 handler 其实活在 widget iframe 自己的 realm 里，主文档钩子看不见 | 需要观测 frame 内行为时，确认预注入是否覆盖子 realm；不覆盖就在该 realm 内插桩 |
| **二进制比代码旧**（改完代码没重建就跑真实探测） | step 29 首轮拿 20:12 的二进制去测 21:10 的提交 | 每轮实测前 `stat` 二进制时间与 `git log -1` 对一下，并确认构建输出里有 `Finished` |
| **导航早期（t≈1s）的 `Runtime.evaluate` 会把该 target 的文档永久清空** | step 30 的胶片探针从 t=1s 开始轮询，之后每帧都是 0 元素/0 字节截图，看着像「obscura 没渲染出页面」 | 同进程对照可复现：start=20 正常 → start=1 全空 → start=20 又正常。**探针首次求值必须延后**（脚本里 `--start`，默认 12s）。这本身是待修的真实缺陷 |
| 监听器存在 **per-realm 的 JS 结构**（`_eventTargetListeners` WeakMap）里 | 用 isolated world 注册监听器去测「事件有没有到 frame」，恒为 0，与事实无关 | 要么在事件实际派发的 realm 内插桩，要么改用「派发前挂真监听器、看它是否被调用」的端到端测法 |
| 注入脚本读不到 bootstrap 的 script 作用域 `const` | 探针里 `_eventTargetListeners` 恒 undefined，被静默当成「没有监听器」，得出「整条链零 listener」的错误结论 | 任何读内部变量的探针都要先打印 `typeof`，确认它真的可见 |
| **obscura 忽略 `no_proxy`，把 `127.0.0.1` 送进 `http_proxy` 且静默失败** | step 32 的本地对照页在 obscura 里恒为空 DOM，CLI 却照打 `Page loaded`，一度以为是渲染缺陷 | 跑本地/内网目标一律 `env -u http_proxy -u https_proxy -u all_proxy`；并核对 HTTP server 的访问日志确认请求真的到达 |
| Chrome 侧「过了盾就再也复现不了质询」 | 清 `clear_site_data` 不够（漏 `cloudflare.com` 域），且即便 cookie 清空到 0，受信任的 IP+指纹仍直接放行，对照实验直接落空 | 用 CDP `Network.clearBrowserCookies` 清全量；仍放行时换**全新 `--user-data-dir`**（最有效），或改用受控测试页 |
| **`waitForDebuggerOnStart` 会暂停每一个新 target，包括 worker** | step 36：跳过 worker session 不 resume → Turnstile 的十几个 blob worker 全部挂起 → widget 永远 `Verifying...`。据此得出的「Chrome 也过不了盾」「IP 被惩罚」「overrunBegin 是真实判定」**三个结论全错** | 每个 attached target 都要 `runIfWaitingForDebugger`；worker 不发 `Page.*`，且 resume 用 fire-and-forget（worker session 可能永不回包） |
| **把「页面没加载」当成「功能不工作」**（第二次犯） | step 38：受控页在 serve 路径下 DOM 为空、JS 未执行，据此得出「obscura 不加载图片」，复核后 4 个 png 请求全部正常 | 任何「某功能没发生」的结论，先断言页面真的加载了（`document.querySelectorAll('*').length` 或一个已知元素的文本） |
| 过盾后页面**导航到新文档**，`window.__msgs` 随之清空 | 点击后 3 秒再 dump 就已经什么都读不到，成功样本连抓两次落空 | 让 hook 同时 `console.warn`，订阅 `Runtime.consoleAPICalled` **实时收流**，不依赖 dump 时机 |
| 默认 feature 下整个模块不参与编译（`obscura-render` 的 `paint`） | `cargo test -p obscura-render` 全程没编译 paint.rs，17 个"失败"与改动无关，新写的测试也从未运行 | 先确认目标代码真的被编译：塞一行必然报错的语句，看构建是否失败 |
| **端口上可能跑着会话外遗留的旧 serve 进程**（启动时静默绑定失败，日志里只有一条 bind error） | step 40 前两轮探针打在 8/14 01:15 的旧进程上，时间线全是旧代码 | 每轮实测前 `ps -o lstart -p <pid>` 对比二进制 mtime；serve 启动后立即核对 `/json/version` 的浏览器版本号 |
| **`RUST_LOG=obscura::js=debug` 匹配不到 `op_fetch_url` 日志**（target 是模块路径 `obscura_js::ops`） | 以为「页面没发请求」，实际是日志没开对 | 请求序列用 `RUST_LOG=obscura_js=debug`（模块路径），或看 `stealth_fetch completed: <METHOD> <URL> -> <status> (bytes)` 完成日志 |
| `cdp_click_fast.py` 从 t≈0.3s 就开始 `Runtime.evaluate` 轮询 | 踩「导航早期求值永久清空文档」坑：`box=null`、title/body 全空，误判「widget 没渲染」 | 首轮求值延迟 ≥5s 再开始轮询（`/tmp/cdp_click_fast_delayed.py`） |

另注：`cf_clearance` 绑定 TLS 指纹 + IP + UA，跨进程复用需固定 stealth profile
（见 `OBSCURA_PROFILE` / `OBSCURA_ROTATE_PROFILE`）。

## 未决

按当前怀疑程度排序：

- **`/pat/` 从不发出**（step 39/40，现首要）：Chrome 在大载荷后 366ms 必发 `GET /pat/`(401)
  再 `GET /ci/`；obscura 无 `/pat/`、无 `/ci/`（step 40 P0 修复后实测确认）。`hasPrivateToken`
  探测假设已被 trace 证伪（但该 trace 仅 6MB，证据不足）。HaHaVM 侧已确认 `/pat/` 由 widget
  JSVMP 自身发起（`sec-fetch-mode: cors, dest: empty`），HaHaVM 无显式打补丁——缺失 =
  JSVMP 没走到发证明请求那一步。下一步：v8 trace 追 822KB 载荷执行期间的差异面（需
  100MB+ 完整 trace），或先查 `interactiveEnd` 回归（见下）。
- **`interactiveEnd` 疑云已澄清**（step 41）：step 40 记的「消失」是 CF 端波动——点击
  时机修正（等 interactiveBegin 再点）后事件链完整出现（interactiveEnd@9361 →
  fail 600010@10056）。**不是代码回归**。
- **`/fo/` 明文获取**（step 41）：v8 trace 不可行（TextEncoder 是 deno_core native，
  参数捕获只对 JS 帧有效）；预注入包装 TextEncoder.encode 实测主 realm 提交阶段零调用
  ——明文不走 TextEncoder。待确认：证明计算是否跑在 worker（预注入不覆盖 worker realm）。
- **缺 PAT 一族 Document API**（step 39）：`hasPrivateToken`/`hasRedemptionRecord`/
  `hasStorageAccess` 均未实现（grep 确认 0 处），HaHaVM 照 Chrome 接口补齐了这一组。
- **`fail code=600010`**（step 37）：`interactiveEnd` 稳定后仍以此码失败，并返回
  `cfChlOut`/`cfChlOutS` 两个加密载荷。下一步查 `600010` 在 api.js 字符串表对应的分支。
  判据链：`interactiveEnd` ✓ → `complete`+token（仍缺）。
- **inline script 栈帧行号偏移**（step 32，指纹面首个确凿差异）：obscura 用 script 内相对
  行号，Chrome 用文档绝对行号，偏移 == `<script>` 标签所在行。落在 Cloudflare 明确采集的
  `Error.stack` 面上，一行代码即可检测。修法：V8 `ScriptOrigin` 传 inline script 的起始
  行/列偏移。（注意：本次 `cs` 的 10 帧全是外部脚本，尚未证明它就是判失败的直接原因。）
- **label activation 剩余项**（step 30，正式实现已落地 `7521680`）：`labels`/`control`
  IDL 补真（`htmlFor` 已有），`HTMLElement.click()` 路径的 label 转发（程序化点击仍到不了
  input）。
- **导航早期 `Runtime.evaluate` 清空文档**（step 30 发现）：可复现、与质询无关的真实
  缺陷，但会持续毒化任何早期轮询的探针，值得单独修 + 回归测试。
- **obscura 不尊重 `no_proxy`/`NO_PROXY`**（step 32 顺带发现）：设了 `no_proxy='*'` 仍会把
  `127.0.0.1` 的请求送进 `http_proxy`，且**静默失败**——CLI 照样打印 `Page loaded`，只是
  内容为空。只能靠 `env -u http_proxy -u https_proxy -u all_proxy` 绕开。
- **自动点击策略**（step 28 时序约束）：一旦上一条打通，fetch 流程需要在复选框渲染的
  **第一时间**点击，不能先等待观测——129s 会换 ray，token 作废。归属（调用方 / CLI
  工作流 / `--solve-interactive` 之类开关）待定。
- **obscura `Runtime.evaluate` 的多行表达式静默失败**（step 29 发现）：与质询无关，但
  会持续毒化探针，且是真实的 CDP 一致性缺陷，值得单独修 + 回归测试。
- **早期 timer 迟发 600–2500 ms**（step 9），与 Cloudflare 自测的 `timeTiefMs`
  吻合。成因未定位，下一步给事件循环的 poll/park 插桩。
- **Performance Timeline 全空**（step 10），且 `PerformanceObserver.supportedEntryTypes`
  缺失——后者是一行即可命中的检测点。
- 栈底仍有 2 帧 `_runAtNesting (<obscura:bootstrap>:894:9)`（step 8）。浏览器里
  setTimeout 回调的栈到回调那一帧就结束，下面没有引擎帧。
- 父窗口是否回应了子窗口的 `requestExtraParams` 未证实。父→子通道本身已验证可用
  （step 6），需要一种不扰动流程的观测方式。
- 跨源访问 `parent.location.origin` 返回 `undefined`，浏览器应抛 `SecurityError`。
  可被检测的差异，未修。
