# Cloudflare 挑战：诊断记录

针对 `zencare.co` 的 Cloudflare Turnstile 托管质询（5 秒盾）的逐步排查记录。
按 step 追加，每步记录**假设 / 方法 / 证据 / 结论**。被证伪的假设一并保留——
它们标出了不必再走的路。

当前状态：**未通过,但断点已前移到最后一步**(2026-08-16,step 55/56)。`/pat/`(401)与
`/ci/`(200)均已发出且状态码与 Chrome 一致,`interactiveBegin` → 点击 → **5052B 提交** →
**3256B 回传**全链路打通;唯一没走通的是最后的判定——CF 不发 `complete`,直接换 ray 重来。
**`fail code=600010` 现在是唯一实质阻塞**,失败码在加密响应体内。挂了六个 step 的
「`/pat/` 从不发出」已解除:它来自 `709cb1b..HEAD` 的 parity 改进,此前被 `1f963b7` 的
Trusted Types 回归挡住(step 49-52 定位并修复)。

以下为 2026-08-15 及以前的状态记录:**未通过**。P0 五项 parity 修复（step 40）后输入链路保持打通、时间线全面提速，
但**断点始终未移动**：`/pat/` 依旧从不发出（首要阻塞，step 39/40/44/45/46/47），
`complete` 依旧为 0。点击被接受（Verifying…）→ 提交 5052B → 回传 3256B → 仍被判失败
（`cf_chl_rc_ni=1`），widget 重置并换 ray 重来。机制定位已收敛（step 45/46）：`/pat/`
**从未被 JS 构造**（网络钩子 + URL 构造器 + PAT API 三面全覆盖，零命中），`/ci/` 则
**发出且 200**（step 45 追加修正作废了「op 吞请求」）；两者都在 **822KB→127KB 的 managed
分流窗口**，不在点击后（step 44 的「点击后窗口」作废）。step 47（2026-08-15）修掉了
Image 请求不记录 resource timing 这个确定缺陷（含两条回归测试），`/pat/` **仍未出现**
——本轮 CF 在 `/ci/` 之后根本没读过 performance，该假设未被验证到。当前阻塞点：
①**`/pat/` 从不发出**；②**frame 文档缺 navigation timing**（step 47 证据 3：CF 在两个
widget realm 各读一次 `getEntriesByType('navigation')`，两次全空——当前唯一「已证实被
读取且明确异常」的环境面，下一个修复目标）；③**`fail code=600010`**（step 37 起稳定）。
**2026-08-16 回归警报（step 49/50/51）**：HEAD 相对 step 47 出现**代码回归**，已二分定位到
唯一根因 **`1f963b7`（Trusted Types API 面按规范补齐）**。该 commit 补齐了 TT 的 API 外壳
但没给 `eval` 接入 TT——`eval(TrustedScript)` 不执行代码（Chrome 返回 `2`，obscura 返回
`"1+1"`）。CF 探测到 `trustedTypes` 存在就切到 TT 路径，JSVMP 静默停摆，流程从
`realm=3/xhr=3//ci/=1` 退到 `realm=2/xhr=1//ci/=0`。**修 TT 的 eval 行为（或暂不暴露该入口）
是当前第一优先级**，在此之前其他质询结论都跑在退化的基线上。

step 48（2026-08-16）用双向被动 message 对拍**结掉一条长期未决项**：父窗口**确实回应了**
`requestExtraParams`（widget 在自身 realm 的 41ms 收到完整 managed 配置，`food`/`meow`
心跳 32 对双向闭环）——**断点不在 postMessage 通道，在 widget realm 内部**。同轮复现了
`cs` 栈底的 `<obscura:bootstrap>` 两帧（step 8 未决项，CF 主动采集并传输的指纹面）。

判据链：`interactiveBegin` → 点击（须在 interactiveBegin 之后 + 带 widget 外 pre-move，
`cdp_click_fast --start 12`）→ 点击后 ~5s 的 **4976B 提交 POST** → 3256B 主页面回传 →
`complete`+token → 站点真实 404。`interactiveEnd` 消息间歇性出现（CF 端波动，step 41），
**不可作提交链判据**（step 43）。判成败一律看 `cf_chl_rc_ni` 是否出现。

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

效果（`scripts/realm_probe.sh`，与当初发现问题的是同一个探针。本文档 `scripts/` 均指
`.claude/skills/obscura-challenge-probe/scripts/`）：

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

> 记录于 `stealth` 进入 `default` 之前，当时「默认 feature 组合」指的是空
> feature 集。现在那个没人构建的形态是 `--no-default-features`，`.githooks/pre-push`
> 的第 1 步也已相应改为守它。结论不变，只是命令换了。

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

**实现状态更新（2026-08-15）**：`for=` 按 tree scope 解析、首个 labelable 后代、
disabled/hidden 排除、`labels`/`control` IDL 和 `HTMLElement.click()` 的 label 转发均已
落地；`js-repros/form-labels/` 固化 `{control:true,labels:1}` 与程序化激活。该通用
HTML 行为修复不包含站点字符串，Turnstile 的后续证明失败仍属于独立指纹/协议问题。

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

**参考**：`/Volumes/ZHITAI/projects/HaHaVM-General`（把 CF solver 重建在通用 JS 引擎
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

### Step 42 — realm 归属实验：JSVMP 载荷不进 worker；预注入钩子的真实安全边界（2026-08-15）

**背景**：step 41 遗留问题——822KB/127KB JSVMP 载荷到底在 widget 主线程执行还是
post 进 worker。先用 HEAD（fb75dbb，P1/P2）重建（增量 25s），新 serve（9227，
`RUST_LOG='obscura_js=debug,obscura::console=info'`）。对照组（cdp_probe messages）
在新二进制上完全正常（init@2302 → interactiveBegin@7096），P1/P2 无流程回归。

**结论 1（首要）— JSVMP 载荷从不进 worker**：当时通过一次性 Rust 侧插桩
`op_worker_post_message` / `op_worker_spawn`（target `obscura::worker_probe`）在 4 轮
干净运行中记录全部 worker 活动。该插桩已在调查结束后移除，下面的数值是历史运行记录：

- 所有 worker spawn 都是已知的小 blob：`src_len=13`（`"you"==="bot"`）、`src_len=291`
  （trustedTypes gate），zencare 与 challenges 两侧各一。
- 所有 page→worker post ≤ **3139B**（指纹查询脚本 202/557/150/94/67/69/70/3139 字节），
  822KB / 127KB 载荷**从未**被 post 进任何 worker。

→ 证明计算在 **widget iframe 主线程**执行（或载荷在该 realm 经 eval/Function/脚本注入
执行）。step 41 的 TextEncoder 盲区结论维持：主 realm 提交阶段零 TextEncoder 调用，
明文只能从 JSVMP 逆向或 op_fetch_url body 反推。这也提示 `/pat/` 缺失的下一步应在
widget 主线程的执行路径上找（JSVMP 在 822KB 之后没走到发证明请求那一步）。

**结论 2 — step 37 事件字段修复完好**（step 40 的「被 43cb4d4 牵连」怀疑排除）：
cdp_event_trace 对新二进制实测，全部字段与 step 37 修复后基准一致：`timeStamp` 相对毫秒
（9719-9978，非 1.7e12）、`screenX/Y=213,335`、pointer 无按钮事件 `button=-1`、
pointerdown/up `detail=0`、`pressure=0`、over/move `cancelable=true`。
点击事件 tgt=BODY 是 step 26 shadow retarget 的**正常**呈现（document 监听器视角，
shadow 内目标重定向为宿主），不是命中测试回归——不可与 step 24 的 Rust 侧
`input_target_at_point`（原始命中）直接比较。

**结论 3 — interactiveEnd 缺失不是二进制差异**：同一点击流程（cdp_click_checkbox，
等 interactiveBegin 后点）在旧 P0 二进制（9225）与新二进制（9227）上**同样**不出现
interactiveEnd（food 在点击后即停）。step 41 的「CF 端波动」结论维持（本日 6+ 轮
两二进制都拿不到 interactiveEnd→600010 链，step 41 当日可复现）。事件链这一观测面
今天整体不稳定，不宜据此判回归。

**结论 4 — 预注入钩子安全边界（修正第一版 step 42 的结论）**：第一版把多个钩子形态
（eval/Function 替换、Worker 构造器替换、console.warn、通知 postMessage）都判为
「流程停滞」，并据此推断「大载荷确实进过 worker」。**这一推断是错的**——Rust 探针
证明不存在大载荷 post。逐项复核（同 serve 前后对照）后的真实边界：

| 组合 | 结果 |
|------|------|
| **widget-realm 钩子 + 0.3s Runtime.evaluate 轮询** | **稳定停滞**（3/3，含不同钩子形态）；同一 preload 单次求值正常 |
| widget-realm 方法包（postMessage）+ 无轮询 | **正常**（4/4：K/L/m/n 全部完整握手） |
| 顶层无 wrap 的轮询（cdp_click_fast） | 正常（对照组） |
| 全钩子（eval/Function/Worker 构造器/console）无轮询 | 04:5x 停滞 2 次、05:29 正常 —— **不可复现**，疑为 CF 窗口 |

→ 首版 step 42 的「钩子 X 停滞流程」各行**全部作废**（无法与 CF 波动区分）。可复现的
唯一规则：**widget-realm 预注入钩子存在时，不得以 ≤0.3s 间隔轮询 Runtime.evaluate**。
机制未定位（两 realm 共用引擎线程，轮询求值叠加钩子延迟可能踩中 widget 握手超时）。

**测量通道修正**（本轮新踩/澄清）：

- 页面 console 的日志 target 是 **`obscura::console`**，不是 `obscura_js::ops`；
  `RUST_LOG=obscura_js=debug` 里永远找不到页面 console 输出。
- **obscura 不实现 `Runtime.consoleAPICalled`**（pump 全程零事件）；step 37 的
  cdp_event_trace.py 对 obscura 侧实际读的是 serve 日志，Chrome 侧才走 consoleAPICalled。
- `Runtime.executionContextCreated` 只报到顶层 context，无法按 contextId 在 widget
  主世界求值（`Page.createIsolatedWorld` 是独立世界，读不到主世界 `__rl`）。
- widget iframe 文档的 fetch 走 frame 导航路径，`op_fetch_url` 日志里**永不出现**
  （盲区表已有，本轮再次踩到：一度据此误判「widget realm 不存在」）。
- 连续 ~20 轮压测后目标开始不稳定（出现空事件轮：click 后 __pm 全空、页面反复重载），
  与「测量纪律」一节所述一致。同轮对照必须紧跟目标行为漂移。

**未决更新**：step 41 下一步 #1（证明计算 realm）已答：**widget 主线程**（无大载荷
worker post）。step 41 下一步 #2（worker realm 预注入）不再必要。#3（明文获取）仍是
JSVMP 逆向或加密后 body 反推。`/pat/` 缺失的下一步：v8 trace 追 822KB 载荷在 widget
主线程的执行路径（100MB+ 完整 trace）。

### Step 43 — 点击配方验证：第三个 `/fo/` 能触发，能力无回退（2026-08-15）

**触发**（用户提问）：step 42 当天所有点击都没触发第三个 `/h/g/fo/` 提交，也没有
interactiveEnd——是不是 P1/P2 之后能力回退了？图片 `/ci/` 为什么从来 0 次？

**方法**：逐项对照今日请求日志（`stealth_fetch completed` 带字节数），把今日全部
点击运行按「点击时刻 vs interactiveBegin、点击序列」分类，再补一次严格配方运行
（`cdp_click_fast --start 12`：首轮求值延迟到 12s，保证点击落在 interactiveBegin
之后，且带 widget 外→内的 pre-move）。

**证据**：

1. **今日所有运行请求序列（新二进制，9227）**：`chl_page → zencare /fo/ 113KB →
   api.js → challenges /fo/ 822KB（JSVMP）→ challenges /fo/ 127KB（交互变体）`，
   前 5 轮点击后**无任何新请求**。
2. **严格配方运行（--start 12）**：interactiveBegin@8030 → 点击 (213,335)@12.3s →
   +4s 页面进 `Verifying you are human` → **点击后 ~5s 出现 `POST challenges /fo/`
   4976B（第三个 /fo/，即交互证明提交）** → +0.1s `POST zencare /fo/` 3256B（主页面
   回传）→ widget 重置回 `Performing security verification`。与 step 40 记录的链
   完全一致（step 40：点击后 ~5.4s 出 4976B + 3256B）。**点击→提交链路在新二进制
   上完好，无回退。**
3. **今日失败点击的归因**（同一日志）：

   | 点击 | 时刻 vs interactiveBegin | pre-move | 结果 |
   |------|-------------------------|----------|------|
   | click_fast 默认（t≈6.2-6.5s） | **前**（interactiveBegin 在 7.8-9.9s） | 有 | `Verifying` → `Enable JavaScript and cookies` 错误 → 重置，无提交 |
   | cdp_click_checkbox（t≈8.3s） | 后 | **无**（直接移到目标点） | food 即停，无任何反应，无提交 |
   | click_fast --start 12（t≈12.3s） | **后** | 有 | `Verifying` → **4976B + 3256B** → 重置 |

   → 点击要生效需同时满足：**在 interactiveBegin 之后**（提前点被 widget 硬拒，
   页面显示 `Enable JavaScript and cookies` 错误文本——这是新观测到的失败呈现），
   **且鼠标从 widget 外移入**（pre-move 产生 enter 信号，step 25 的结论再次印证）。
   step 42 当天「点击无反应/无提交」全部是这两个条件不满足的探针问题，**不是能力
   回退**。
4. **interactiveEnd 依旧未出现，但提交链照样走完**——step 40 同样无 interactiveEnd
   而有 4976B。**interactiveEnd 的有无与提交链无关**（CF 端间歇性消息，step 41 的
   「波动」结论维持）。判据链修正：对 obscura 侧进度判定，用
   **点击后 ~5s 的 4976B 提交**作可靠观测面，不要等 interactiveEnd。

**结论**：① 无回退——点击→Verifying→4976B 提交→3256B 回传→失败的链在新二进制上
完整复现；② `/ci/` 0% 是因为它与 `/pat/` 在同一 tick 由 JSVMP 发出（step 10），
而 `/pat/` 从未发出（首要阻塞）——图片请求不是独立能力缺口（step 11 的 URL 解析
修复正确但从未被走到）；③ 点击配方的两个必要条件（interactiveBegin 后、pre-move）
已固化，`cdp_click_fast --start 12` 是当前可复现提交链的配方。

**下一步（不变）**：`/pat/` 缺失 = JSVMP 在 822KB 后没走到证明请求步——v8 trace 追
widget 主线程执行路径。

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
| **同一 IP 反复跑质询会触发 CF 升级**：第一次 `/fo/` 直接 400 + `600010`，tokenB 不再下发 | 所有依赖大载荷的对拍突然全部失效，看起来像「刚才那次改动把链路打断了」 | 拿**撤掉该改动的同一份构建**再跑一轮；形态相同就是 CF 侧。另可对比失败轮与成功轮的**第一个**载荷：键集合一致就说明引擎侧没变 |
| **`obscura fetch --eval` 不 await Promise**；CDP `Runtime.evaluate` 对**多行** async IIFE 也静默返回 `{}` | 异步探针（WebRTC / getCapabilities / fetch 链）一律读到空结果，看起来像「这个 API 什么都没返回」 | 走 CDP 且带 `awaitPromise: true`，并把表达式**压成单行**；先用 `Promise.resolve(42)` 自检一次求值路径是否真的 await |
| **探针的预注入钩子本身会被写进指纹**（`cdp_click_fast.py` 的 PRELOAD 包 `attachShadow` 并定义 `__roots`/`__pm`/`__t0`） | step 66 第一轮里 CF 载荷的 `YIjU8` 记下了钩子函数源码、`fyCZH9` 多出 `o.__pm`/`o.__roots`/`o.__t0`——**测的是探针不是引擎**，整轮作废 | 凡是要拿载荷/指纹做对拍的轮次，用零注入探针（`/tmp/clean_click.py`）；只有需要穿透 closed shadow 定位 widget 时才用带钩子的版本，且不得用该轮数据下指纹结论 |
| MITM 代理换机器后 **CA 也换了**（本机 `Sep 30, 2025` vs 远端 `Apr 4, 2026`） | 用旧 `SSL_CERT_FILE` 会在握手阶段就失败，症状像「代理不通」 | `curl -s http://<proxy-host>:<port>/ca` 直接取 PEM，再对 `openssl s_client -proxy` 看到的 issuer 核对 CN |
| 探针只在**主文档** realm 预注入（`Page.addScriptToEvaluateOnNewDocument`） | step 24/25 「`addEventListener` 抓不到任何 click 绑定」被归因为 handler 用 `onclick`/缓存引用；但 handler 其实活在 widget iframe 自己的 realm 里，主文档钩子看不见 | 需要观测 frame 内行为时，确认预注入是否覆盖子 realm；不覆盖就在该 realm 内插桩 |
| **把「有 CALL、无 COMPLETE」直接判成被拦截** | 这个特征同时也是长轮询在飞的样子；据此把 brunhild 判成被 CSP 拦截，整个 Step 61 的根因认定作废 | 让被判定的分支自己发声：在拦截处打日志（url + 生效策略 + 策略来源），再用「有没有这条日志」判定，而不是用别的日志的缺失去反推 |
| **资源被 CSP 拒绝只表现为元素的 `error` 事件** | 与网络失败完全同形；`/ci/` 的 error 一度被当成超时 | 图片/媒体等资源路径的拦截也要打日志，否则无法与网络失败区分 |
| **只 grep `stealth_fetch completed`，把「没有完成」当成「没有调用」** | brunhild `/i/` 被判成「JS 从未构造」，真相是它有 `op_fetch_url called`、被 CSP 提前返回，整整一个 step 的归因作废 | 请求序列一律把 `op_fetch_url called` 与 completed **按时序一起列**；只有 CALL 没有 COMPLETE 正是被拦截的特征 |
| **`serve` 日志含 ANSI 转义，`grep` 视其为二进制**（`file` 报 `data`） | `grep -c` 直接返回 0 匹配、无任何输出，误判「这一轮没有请求日志」 | 一律 `LC_ALL=C grep -a`；先用 `wc -l` 与 `tail` 确认文件确实有内容
| **图片请求不经过 `op_fetch_url`**（走 render 的图像管线） | `/ci/` 被判成「当前版本缺失的请求」，其实一直正常加载 | 图片是否发出用元素的 `load`/`error` 事件与 `naturalWidth` 判定，不看 fetch 日志
| 把「日志里没有」等同于「没发生」，而不先确认该路径是否在日志覆盖内 | 同上两条的共同根因 | 每次用日志缺失作论据前，先找一个**已知发生**的同类事件验证它确实会被记录
| **二进制比代码旧**（改完代码没重建就跑真实探测） | step 29 首轮拿 20:12 的二进制去测 21:10 的提交 | 每轮实测前 `stat` 二进制时间与 `git log -1` 对一下，并确认构建输出里有 `Finished` |
| **导航早期（t≈1s）的 `Runtime.evaluate` 会把该 target 的文档永久清空** | step 30 的胶片探针从 t=1s 开始轮询，之后每帧都是 0 元素/0 字节截图，看着像「obscura 没渲染出页面」 | 同进程对照可复现：start=20 正常 → start=1 全空 → start=20 又正常。**探针首次求值必须延后**（脚本里 `--start`，默认 12s）。这本身是待修的真实缺陷 |
| 监听器存在 **per-realm 的 JS 结构**（`_eventTargetListeners` WeakMap）里 | 用 isolated world 注册监听器去测「事件有没有到 frame」，恒为 0，与事实无关 | 要么在事件实际派发的 realm 内插桩，要么改用「派发前挂真监听器、看它是否被调用」的端到端测法 |
| 注入脚本读不到 bootstrap 的 script 作用域 `const` | 探针里 `_eventTargetListeners` 恒 undefined，被静默当成「没有监听器」，得出「整条链零 listener」的错误结论 | 任何读内部变量的探针都要先打印 `typeof`，确认它真的可见 |
| **obscura 忽略 `no_proxy`，把 `127.0.0.1` 送进 `http_proxy` 且静默失败** | step 32 的本地对照页在 obscura 里恒为空 DOM，CLI 却照打 `Page loaded`，一度以为是渲染缺陷 | 跑本地/内网目标一律 `env -u http_proxy -u https_proxy -u all_proxy`；并核对 HTTP server 的访问日志确认请求真的到达 |
| **widget-realm 预注入钩子 + 高频（≤0.3s）Runtime.evaluate 轮询 = widget 流程稳定停滞**（step 42，3/3 复现；同一 preload 单次求值 4/4 正常） | 一度把停滞归因于钩子形态（eval/Function 替换、console.warn 等），结论全错；「大载荷进 worker」的推断也由此而来，被 Rust 探针证伪 | wrap 存在时不要轮询：单次求值；或改用 Rust 侧插桩（零页面扰动）。钩子形态层面的结论需在无轮询条件下重新验证 |
| 页面 console 日志 target 是 **`obscura::console`** 而非 `obscura_js::ops` | `RUST_LOG=obscura_js=debug` 下 grep 不到页面 console，误以为页面没输出 | `RUST_LOG='obscura_js=debug,obscura::console=info'` |
| **obscura 不实现 `Runtime.consoleAPICalled`** | 脚本里订阅 consoleAPICalled 收零事件，误以为钩子没触发 | obscura 侧从 serve 日志读 console（Chrome 侧才用 consoleAPICalled） |
| Chrome 侧「过了盾就再也复现不了质询」 | 清 `clear_site_data` 不够（漏 `cloudflare.com` 域），且即便 cookie 清空到 0，受信任的 IP+指纹仍直接放行，对照实验直接落空 | 用 CDP `Network.clearBrowserCookies` 清全量；仍放行时换**全新 `--user-data-dir`**（最有效），或改用受控测试页 |
| **`waitForDebuggerOnStart` 会暂停每一个新 target，包括 worker** | step 36：跳过 worker session 不 resume → Turnstile 的十几个 blob worker 全部挂起 → widget 永远 `Verifying...`。据此得出的「Chrome 也过不了盾」「IP 被惩罚」「overrunBegin 是真实判定」**三个结论全错** | 每个 attached target 都要 `runIfWaitingForDebugger`；worker 不发 `Page.*`，且 resume 用 fire-and-forget（worker session 可能永不回包） |
| **把「页面没加载」当成「功能不工作」**（第二次犯） | step 38：受控页在 serve 路径下 DOM 为空、JS 未执行，据此得出「obscura 不加载图片」，复核后 4 个 png 请求全部正常 | 任何「某功能没发生」的结论，先断言页面真的加载了（`document.querySelectorAll('*').length` 或一个已知元素的文本） |
| 过盾后页面**导航到新文档**，`window.__msgs` 随之清空 | 点击后 3 秒再 dump 就已经什么都读不到，成功样本连抓两次落空 | 让 hook 同时 `console.warn`，订阅 `Runtime.consoleAPICalled` **实时收流**，不依赖 dump 时机 |
| 默认 feature 下整个模块不参与编译（`obscura-render` 的 `paint`） | `cargo test -p obscura-render` 全程没编译 paint.rs，17 个"失败"与改动无关，新写的测试也从未运行 | 先确认目标代码真的被编译：塞一行必然报错的语句，看构建是否失败 |
| **端口上可能跑着会话外遗留的旧 serve 进程**（启动时静默绑定失败，日志里只有一条 bind error） | step 40 前两轮探针打在 8/14 01:15 的旧进程上，时间线全是旧代码 | 每轮实测前 `ps -o lstart -p <pid>` 对比二进制 mtime；serve 启动后立即核对 `/json/version` 的浏览器版本号 |
| **`RUST_LOG=obscura::js=debug` 匹配不到 `op_fetch_url` 日志**（target 是模块路径 `obscura_js::ops`） | 以为「页面没发请求」，实际是日志没开对 | 请求序列用 `RUST_LOG=obscura_js=debug`（模块路径），或看 `stealth_fetch completed: <METHOD> <URL> -> <status> (bytes)` 完成日志 |
| `cdp_click_fast.py` 从 t≈0.3s 就开始 `Runtime.evaluate` 轮询 | 踩「导航早期求值永久清空文档」坑：`box=null`、title/body 全空，误判「widget 没渲染」 | 首轮求值延迟 ≥5s 再开始轮询（`/tmp/cdp_click_fast_delayed.py`） |
| **用不点击的探针判断提交链**（step 52-55 全部轮次） | `cdp_ci_timing_hook.py` 只导航加等待,点击之后的 5052B 提交与 3256B 回传因此永远不出现,却被当成「链路到此为止」 | 判据链凡是涉及点击之后的部分,必须用 `cdp_click_fast.py`(`--start` 要落在 `interactiveBegin` 之后);不点击的轮次只能用来看点击**之前**的阶段 |
| **预注入 net-hook 看不到 `op_fetch_url` 直发的请求**（`has_tx=false`） | step 45/46 据此得出「`/pat/` 从未被 JS 构造」,而 `/pat/` 恰好走这条路;step 55 用 Rust 日志才看到它 | 判断「某请求是否发出」以 `RUST_LOG=obscura_js=debug` 的 `op_fetch_url called` / `stealth_fetch completed` 为准,JS 钩子只能回答「由页面脚本的哪个 API 构造」 |
| **探针里 `delete` 之后又 `defineProperty(name,{value:undefined})`** | 属性其实还在（`name in window === true`），只是值为 undefined。据此得出「删掉 TT 仍不恢复 → 还有第二处回归」的错误结论（step 51/52） | 要真正移除就只 `delete`，并当场用 `name in globalThis` 和 `Object.getOwnPropertyNames` 复验，而不是用 `typeof` |
| **单次测量当判据**（本页多数 A/B 结论早期只测 1-2 次） | step 52 实测同一二进制 5 轮里有 1 轮偏离（`xhr=1` vs `3`），说明判据存在 CF 端偶发波动 | 二分/对拍的每个点至少重复 3 次，报告全部轮次而不是代表值；差异要在多轮上稳定才算数 |
| **在 HEAD 上做干预实验，却把结论安到某个中间 commit 上** | step 52 一度在 HEAD（距目标 commit 还有 22 个提交）上删 TT，用结果推断该 commit 的行为 | 干预实验必须跑在被判定的那个二进制上；要证明「某 commit 引入 X」，最强的是在它**之前**的构建上注入 X 复现 |
| **包装 `performance.getEntries*` 的钩子只在页面主动读取时产生记录**（被动观测面） | step 47 修完 `/ci/` 的 entry 后日志里看不到它，差点误判「修复没生效」——实际是 CF 在 `/ci/` 之后再没读过 performance | 「日志里没有」只能证明**没被读**，不能证明**不存在**；条目是否真的写入必须用可控用例断言（本步落成两条回归测试），实测日志只用来判断 CF 读没读、读到什么 |
| **出口 IP 决定拿到哪种页面，1020 硬封锁态下一切诊断无效**（step 48 证据 4） | 封锁页会加载源站的 `rocket-loader.min.js` 与 `cloudflareinsights` beacon，serve 日志看着像「正常站点资源」，一度误判为过盾；而它既不是质询也不是真实响应 | 每轮开跑探针前先看 `Page loaded` 的 title：`Just a moment...` = 质询可诊断，`Attention Required! \| Cloudflare` = 1020 封锁需换 IP，其余才可能是真实响应 |
| **质询页 DOM 里预置了全部状态文案** | `--dump text` 出现 "Verification successful. Waiting for zencare.co to respond"，误读为已通过 | 该串是静态文案不是状态；判据仍为目标 URL 返回真实 404（`/1.txt` 本就不存在） |

另注：`cf_clearance` 绑定 TLS 指纹 + IP + UA，跨进程复用需固定 stealth profile
（见 `OBSCURA_PROFILE` / `OBSCURA_ROTATE_PROFILE`）。

## 未决

按当前怀疑程度排序：

- **`/pat/` 从不发出**（step 39/40/44/45，现首要）：Chrome 在大载荷后 366ms 必发
  `GET /pat/`(401) 再 `GET /ci/`；obscura 无 `/pat/`、无 `/ci/`。step 44/45 修正机制定位：
  **执行路径完整走到 127KB 交互变体，但 `/pat/` 请求从未被构造**（step 45 trace：XHR
  open/send 一一配对 5 次无第 5 次、页面脚本名下零 fetch）。触发机制三项假设已证伪：
  ①`hasPrivateToken` 探测（step 39 发现 3）；②XHR/fetch `privateToken` 选项（step 44）；
  ③**「点击后窗口」**（step 45：`/pat/` 缺失在 822KB→127KB 的 **managed 分流窗口**，
  不在点击后——回读 step 28，浏览器 `/pat/` 在第一轮 managed 阶段）；④**PAT API 探测**
  （step 46 补充：getter 包装下 `hasPrivateToken`/`hasRedemptionRecord`/`hasStorageAccess`
  零读取）；⑤**`/ci/` 被吞**（step 45 追加修正：`/ci/` 发出且 200，不是缺陷）；
  ⑥**Image 缺 resource timing**（step 47 已修，`/pat/` 仍不出现——且本轮 CF 在 `/ci/`
  之后没读过 performance，该链路根本没被走到）。下一步见「frame 缺 navigation timing」。
- **frame 文档缺 navigation timing**（step 47 证据 3，新增，仅次于 `/pat/`）：CF 在两个
  widget realm 各读一次 `getEntriesByType('navigation')`，**两次都是 0 条**；主文档 realm
  正常有条目。代码侧一致——`record_performance_response(.., "navigation", ..)` 只在
  page.rs:3536 为顶层文档调用。这是当前唯一「已证实被 CF 读取、且读到异常值」的环境面。
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
- 栈底仍有 2 帧 `_runAtNesting (<obscura:bootstrap>:890:9)` + `<obscura:bootstrap>:905:5`
  （step 8 提出，step 48 复现，行号随 bootstrap 变动）。浏览器里 setTimeout 回调的栈到
  回调那一帧就结束，下面没有引擎帧。CF 经 `{"event":"execute"}` 的 `cs` 字段主动采集并
  传输该栈，是确定被读取、且与 Chrome 确定有差异的指纹面。
- ~~父窗口是否回应了子窗口的 `requestExtraParams` 未证实。~~ **step 48 已证实：回应了。**
  双向被动监听对拍显示 widget 在自身 realm 的 41ms 即收到完整 managed 配置，且 `food`/`meow`
  心跳 32 对双向闭环。断点不在 postMessage 通道，在 widget realm 内部。
- 跨源访问 `parent.location.origin` 返回 `undefined`，浏览器应抛 `SecurityError`。
  可被检测的差异，未修。

### 通用能力回填（路线图 P1/P2，2026-08-15）

本记录中的 `labels/control`、`NO_PROXY` 和“fetch 不自动交互”观察已分别回填为通用
实现：表单 IDL/程序化 label 激活已完成；reqwest、脚本 fetch 与 stealth/wreq 现在遵守
`NoProxy::from_env`；输入策略通过 embedder 提供 selector/timing policy，不读取挑战文案、
主机名或 Cloudflare 状态。真实挑战仍以 `600010` 为独立未解决项。

新增的 WebSocket、WebGL、indexedDB、HTTP/2、frame layout cache 与 Debugger/host trace
均有独立 `js-repros/` fixture。当前主机没有 Chrome/Chromium 可执行文件，故没有伪造
Chrome 146 oracle；各 fixture README 标明了这一验证边界。

### Step 44 — v8 trace 追 822KB 后执行路径：/pat/ 触发机制排除两项假设；全量 --trace 在新二进制上不可用（2026-08-15）

**背景**：step 42 已证 JSVMP 在 widget 主线程执行；step 43 判定下一步 = v8 trace 追 822KB 之后的执行路径。本 step 完成该调查，得到 /pat/ 缺失的机制级结论。

**方法**：两种 trace 模式各跑一轮 fetch（wait 40s），并结合当时一次性 Rust 插桩留下的
请求日志（`obscura_js=debug`）。该插桩当前不属于运行时能力。

1. **全量 `--trace`**：576MB / 816 万行。**页面超时**（终页 "Enable JavaScript and cookies"），流程退化到 113KB——**822KB 从未到达**。83% 记录（676 万行）是 `<obscura:timer-wake>` 引擎脚本。
2. **`OBSCURA_TRACE_MODE=lookups`（去 `--trace`）**：6MB / 32048 行。**流程完整**——8 秒走完 `chl_page 227KB → zencare /fo/ 113KB → api.js → challenges /fo/ 822KB → 交互变体 127KB`，与 step 43 序列完全一致。

**证据**：

1. **全量 trace 不可用的机制（新盲区）**：827028d 定时器保真引入 `queue_overdue_timer_wake_repair`（runtime.rs:3153）——定时器积压时**每次事件循环 poll 都 execute_script("<obscura:timer-wake>", ...)**。`--trace` 下每次执行都被完整记录，trace 越慢 → timer 积压越多 → wake 越多 → 更慢（恶性循环），页面在 113KB 后超时。8/12 的 140-220MB「完整」trace 当时无此机制（且当时流程断点本就在 113KB——`<page-eval>` 99.9% 是 JSVMP 主流程，但 XHR 只有 1 对 open/send）。**step 39 的「100MB+ 判据」在新二进制上无法用全量模式满足；lookups 模式 6MB 即完整一轮**。

2. **822KB 之后的执行路径（lookups trace，物理行序重建）**：

   ```
   行 4541-4580   chl_page XHR open+send → 113KB 发起（Ha 函数）
   行 4739-4742   <page-eval> Uint8Array+charCodeAt → 113KB 响应字节处理
   行 14151-14186 widget iframe 文档 XHR open+send → 822KB 发起（Rr 函数）
   行 14340-14343 <page-eval> 字节处理 → 822KB 响应被接收并解码
   行 17183-21138 worker 指纹查询循环：navigator 采集（platform/languages/
                 hardwareConcurrency/deviceMemory/userAgent）→ fetch 存在性
                 检查（1 次属性访问，未产生请求）→ eval/_p → postMessage 回传
   行 ~19500     Performance.getEntries（QB/Qe）→ PerformanceObserverEntryList.getEntries
   行 23699      _Canvas2D.getImageData ← HH:1:69445（canvas 指纹收集）
   行 23926-23969 <page-eval> Object.i + MISS module/global/pyimport + Function.call
                 ← Hf:1:233014（**JSVMP python 桥检测**：探测 pyimport/module/global
                 是否存在——CF 在对抗 HaHaVM 类通用框架；MISS=环境正常，非失败原因）
   行 25357      widget iframe XHR send（第二次，Rr:1:153285 ← HH:1:69888 ←
                 HL.<computed> ← Hv ← Ho:1:227482）→ **127KB 交互变体发起**
   行 25413      <page-eval> charCodeAt → 127KB 响应处理
   ```

   JSVMP 从 822KB 到 127KB 的执行**路径完整**（性能读取、canvas 指纹、python 桥检测都执行了），`/pat/` 不在其中。

3. **/pat/ 触发机制：两项假设证伪**：
   - **hasPrivateToken 探测假设（step 39 发现 3）最终证伪**：完整流程（822KB+127KB 全走完）中 `hasPrivateToken`/`hasRedemptionRecord`/`hasStorageAccess`/`requestStorageAccess` 在 CF 代码名下**零访问**。仅 2 组 HIT（物理行 6973/21615）来自 `<obscura:frame-realm-bootstrap>`（f4a1201 实现后引擎 bootstrap 自检，Node.prototype 上方法存在）。注：lookups 模式有 IC 快速路径盲区（同一代码位置对同一对象形状的后续访问不记录）——但**每个代码位置首次访问必记录**，CF 调用必留痕。
   - **XHR/fetch privateToken 选项假设证伪**：全 trace 搜 `privateToken` 零命中——CF 不给 XHR/fetch 设该选项。

4. **脚本名分布变化（附带发现）**：`<page-eval>` 从 8/12 的 99.9% 降到 37 行（且全在 worker scope：DedicatedWorkerGlobalScope/WorkerNavigator）；JSVMP 主体现在以**真实 URL 脚本身份**执行（chl_page URL 138 万行 / widget iframe 文档 URL 9791 行）。P0 修复（76b6ae5 Stack/realm/referrer）改变了 eval 脚本的 ScriptOrigin 登记——**trace 的 realm 归属盲区在页面上意外消解**：脚本名现在能分辨 zencare 主文档 vs challenges iframe。

5. **fetch 模式无点击**：127KB 之后无第三次 XHR（4976B 提交需点击才发，正常）。**点击后 → 4976B 提交之间的 JSVMP 窗口未覆盖**——浏览器交互基线里 `/pat/` + `/ci/` + 7KB 提交正是在这个窗口（step 28）。

**结论**：

1. 全量 `--trace` 与 P0 定时器保真机制恶性耦合，挑战页上不可用；**lookups 模式是唯一可用 trace 模式**（流程无退化，8s 全链）。「100MB+ 才算完整一轮」判据作废，替换为「lookups 6MB + 请求序列确认 822KB+127KB 到达」。
2. `/pat/` 缺失**不是**「822KB 后 JSVMP 没走到证明请求步」——执行路径完整走到 127KB 交互变体，但**从未构造 /pat/ 请求**（无 XHR/fetch/Image 痕迹）。触发机制与 `hasPrivateToken` 探测无关、与 `privateToken` 选项无关。
3. `/pat/` 触发窗口大概率在**点击后**（浏览器交互基线：点击 → /pat/ → /ci/ → 7KB 提交；obscura 点击后直接 4976B 提交，跳过 /pat/+/ci/——4976B vs 浏览器 7KB 的 2KB 差值可能正是缺失的证明输入）。该窗口当前不可 trace（fetch 无点击、serve 不支持 --v8-flags）。

**下一步（按信息量）**：
1. **追点击后窗口**：让 serve/CDP 路径支持 `--v8-flags`（查 CLI 参数透传，serve 不支持的原因），或给 fetch 模式加预注入自动点击；跑 lookups trace 覆盖 点击 → 4976B 窗口，确认该窗口 JSVMP 是否构造 /pat/。
2. 对照 HaHaVM `core/env/Document.js:2062` 的 hasPrivateToken **实现与返回值**——若 HaHaVM 返回 true 且 CF 据此走 PAT 流程，则 obscura 的 f4a1201 返回值语义是下一个检查点（虽然 trace 显示 CF 没读该属性——两者矛盾时需要合理解释）。
3. 若点击后窗口也无 /pat/ 构造：/pat/ 由 Chrome 原生 PAT 握手发出（非 JS），obscura 需实现浏览器级 PAT 支持——该方向工作量大，先确认前两条。

**Step 44 补充（2026-08-15，trace 工具链升级后复测）**：全量 `--trace` 补丁升级
（timer-wake 等引擎脚本过滤 + 队列异步写，见 Trace-page-script.md「2026-08-15 升级」）
后重跑：`<obscura:timer-wake>` 676 万行 → 0，记录量 816 万 → 176 万（-78%），
异步写出与退出 flush 正常。但 **822KB 依旧未到达**——chl_page 名下 JSVMP 执行了
176 万次调用（CALL 87 万 + RET 89 万）却未走到发 822KB 的 XHR，终页停在
"Verification successful. Waiting for zencare.co to respond"（托管等待态）。结论：
`--trace` 的每函数进出 runtime 路由 + `--no-lazy-feedback-allocation` 是挑战页
不可逾越的开销，**补丁已把记录成本优化到底，全量 trace 仍不适用于时序敏感页**；
挑战页 trace 的实用模式 = lookups（8s 全链，step 44 主实验）。新盲区：trace 文件
可含非法 UTF-8（JSVMP 二进制字符串参数原样写入），`awk`/`cut` 报 Illegal byte
sequence，需 `LC_ALL=C`。

### Step 45 — 点击后窗口 trace：/pat/ 从未构造；/ci/ 的 Image 被构造但 op 吞请求；step 44 窗口定位修正（2026-08-15）

**背景**：step 44 下一步 #1 =「让 serve/CDP 支持 --v8-flags，追点击后窗口」。本 step
完成该调查并推翻其中两个定位。

**方法**：重建 trace 补丁二进制（带 vendor patch 全量，`strings` 验证 `TracePropertyLookupFile`
= 0 是**符号表假象**——v8 静态库符号被优化隐藏，运行时验证 `--trace-property-lookup` 报
`unrecognized flag` 与否才是可靠判据，本步新二进制 **PATCHED**，about:blank 产生 202 行
trace）。起 lookups 模式 serve（`--trace-property-lookup --no-lazy-feedback-allocation
--trace-property-lookup-file=/tmp/click-trace.tsv`），`cdp_click_fast --start 12` 驱动完整
点击流程，trace + `RUST_LOG=obscura_js=debug` 请求日志双面分析。

**证据**：

1. **`serve --v8-flags` 支持确认（修正 Trace-page-script.md:359 的误判）**：`--v8-flags`
   是**全局参数，必须放子命令前**（`obscura --v8-flags X serve`）。实测 V8 收到 flags
   （`unrecognized flag` 报错证明透传）。step 44 记的「serve 不支持」是参数位置问题，非
   能力缺失。**多 worker 是真遗留**：`run_multi_worker_serve` 用 env `OBSCURA_V8_FLAGS`
   传给 spawn 的 `serve` 子进程，但 serve 子命令不读该 env（只有独立 worker binary 的
   worker.rs:45 读），多 worker 下用户 flags 丢失。

2. **请求序列（新二进制 + 点击流程，时间戳 UTC）**：
   ```
   08:42:54.9  GET  zencare.co chl_page                200 226KB
   08:42:55.3  GET  challenges api.js                   200 82KB
   08:42:55.6  POST zencare.co fo/<tokenA>              200 113KB
   08:42:57.9  POST challenges fo/<tokenB>              200 845KB   ← 822KB JSVMP
   08:43:01.2  POST challenges fo/<tokenB>              200 127KB   ← 交互变体
   08:43:09.7  POST challenges fo/<tokenB>              200 5052B   ← 点击后提交
   08:43:09.9  POST zencare.co fo/<tokenA>              200 3256B   ← 回传
   08:43:12.4  GET  zencare.co chl_page (新 ray)                   ← 换 ray 重来
   ```
   **全程无 `/pat/`**。点击发生在 08:43:07 附近（`interactiveBegin` 后），点击后窗口
   （08:43:01 → 09.7）同样零 /pat/。（`/ci/` 初判「无」是**观测盲区**：`stealth_fetch
   completed` 只覆盖 XHR/fetch 路径，Image 走 wreq stealth_client 不打该日志——本步
   后段 wreq 插桩证实 `/ci/` 发出且 200，见证据 6 修正。）

3. **trace 物理行 → 请求一一对应（lookups 模式，40211 行）**：
   ```
   4679/4713   XHR open+send   zencare chl_page     → 113KB
   14580/14613 XHR open+send   widget iframe        → 822KB
   25995/26011 XHR open+send   widget iframe        → 127KB
   33856/33870 XHR open+send   widget iframe        → 5052B（点击后提交）
   35007/35041 XHR open+send   zencare chl_page     → 3256B（回传）
   ```
   **XHR.open/send 一一配对 5 次，无第 5 次 XHR 构造 /pat/**。fetch 属性访问全在引擎
   脚本名下（`<obscura:frame-realm-bootstrap>`/`<obscura:bootstrap>`），页面脚本
   （chl_page / widget iframe）名下**零 fetch** → JSVMP 走 XHR 不走 fetch（step 44 确认）。

4. **/ci/ 的 Image 被 JSVMP 构造（trace 确凿），但「op 吞请求」的初判被 wreq 插桩推翻**：
   物理行 22077 与 22117 各一次 `HTMLImageElement src` 设置，调用链指向 widget iframe
   的 JSVMP VM 函数（`Cn:1:84370`/`Cn:1:83677` ← `Ci.<computed>.<computed>` ← `Ca`
   ← `Ch` ← `Cw`，正是 822KB 载荷解码出的混淆 VM 函数名）。完整链执行到
   `_runImageRequest` → `op_load_image_metadata(nid, baseURI)`。**插桩证伪「吞请求」**：
   op 正常进入 fetch 分支（`[img-probe] will-fetch url=.../ci/...`），wreq stealth_client
   发出请求并返回 **200 OK**（`[net-probe] wreq GET -> status=200 OK url=.../ci/...`）。
   `/ci/` **在 obscura 里发出且成功**，与浏览器一致。此前「请求日志无 /ci/」纯属观测
   盲区（`stealth_fetch completed` 只覆盖 op_fetch_url/XHR 路径）。同进程后续
   `KNOWN`（缓存命中）是正常的二次构造走缓存。

5. **窗口定位修正（推翻 step 44 结论 3 的一半）**：`/pat/`、`/ci/` 缺失发生在
   **822KB→127KB 窗口（managed 阶段）**，不是点击后。回读 step 28 证据 2：浏览器
   `/pat/` 出现在第一轮 managed 阶段（`fo 822KB → /pat/ → /ci/ → fo` 停住）；step 28
   证据 4 的点击序列只有 `POST fo ×2`，无 /pat/。step 44 把 /pat/ 归到「点击后」是
   误读。obscura 从 822KB **直接拉 127KB 交互变体**（被分流 interactive）——但 `/ci/`
   已经在 822KB→127KB 窗口发出（证据 4），说明 JSVMP 确实执行到了 managed 证明流程的
   `/ci/` 步，只是 `/pat/` 这一环缺失。

**结论**：`/pat/` 请求从未被 JS 构造（请求层铁证 + trace 层无第 5 次 XHR、页面零
fetch、无 Image 构造除 /ci/ 外的记录）；`/ci/` 的 Image 构造且请求发出、200 成功
（wreq 插桩铁证）。因此 `/ci/` 不是缺陷，`/pat/` 是**唯一**缺失的网络环节，且与
`/ci/` 不同机制（非 XHR/fetch/Image）。新问题浮现：`/ci/` 200 后 JSVMP 没有走向
浏览器那样的「提交证明」（浏览器 7KB /fo/ 提交），而是拉了 127KB 交互变体——这条
分叉是下一个待查点。

**下一步（按信息量）**：
1. **确认 `/pat/` 的构造机制**：既然非 XHR/fetch/Image 且页面零网络构造痕迹，最可能是
   **Chrome 原生 PAT（Private Access Token）握手**（step 44 结论 3 的第三种可能）。
   对照 HaHaVM `core/env/Document.js:2062` 的 `hasPrivateToken` 返回值语义（step 44
   下一步 #2，此前因 trace 无 CF 访问而搁置）；若 HaHaVM 返回 true 且 CF 据此走 PAT
   流程，则 obscura 的 f4a1201 实现返回值是检查点。
2. **追 `/ci/` 200 后的 JSVMP 分叉**：`/ci/` 响应（2300B png）被 JSVMP 读取后，浏览器
   走「发 7KB 提交」，obscura 走「拉 127KB 交互变体」。看 /ci/ 响应处理路径
   （Image 的 onload 事件 → JSVMP 读什么）——obscura 的 Image `_applyImageMetadata`
   是否给了 JSVMP 正确的 `naturalWidth`/`naturalHeight`（png 解码尺寸）。若尺寸为 0，
   JSVMP 可能判定图片加载异常 → 走交互分支。
3. 移除本 step 的临时插桩（`[img-probe]`/`[net-probe]`），跑基线确认无行为改变。

**Step 45 追加修正（2026-08-15，wreq 插桩 + 解码插桩后）**：`/ci/` **完全正常，不是缺陷**。
三项铁证：①`[net-probe] wreq GET -> status=200 OK url=.../ci/...`——请求发出且 200；
②`[img-probe] op_load nid=306 bytes=2128 dims=Some((63.0, 32.0)) first8=[89,50,4e,47,...]`
——响应 2128B 是合法 PNG（magic 正确），解码出 63×32 尺寸；③`_applyImageMetadata` 的
`loaded` 判定成立 → dispatch `load` → JSVMP 拿到正确的 `naturalWidth=63`/`naturalHeight=32`。
因此 step 43 的「/ci/ 0% 是独立能力缺口」与 step 45 初版「op 吞请求」**双双作废**。
**下一个断点精确化**：`/pat/` 是**唯一**未发出的网络环节；它与 `/ci/` 在同一 tick 由
同一段 JSVMP 代码发出（step 10 的 1ms 时间戳差），`/ci/` 的 Image 构造有 trace 记录而
`/pat/` 的 XHR/fetch 构造无痕（IC 快速路径盲区或非 JS 构造）。**决定性实验**：CDP 预注入
包 `XMLHttpRequest.prototype.open/send` + `fetch`（纯转发、只记录入参，无轮询——step 42
已验证 widget-realm 钩子 + 无轮询 4/4 正常），看 `/pat/` 的构造是否发生、走 open 还是
send 被 gate。

### Step 46 — 预注入网络钩子：/pat/ 确凿从未被 JS 构造；发现 Image 请求不记录 resource timing（2026-08-15）

**方法**：CDP 预注入纯转发钩子（`/tmp/cdp_xhr_hook.py`），覆盖
`XMLHttpRequest.prototype.open/send`、`window.fetch`、`HTMLImageElement.src` setter、
`navigator.sendBeacon`，`console.warn` 输出到 serve 日志（`obscura::console`）。**无轮询**
（step 42 教训）。另用 `/tmp/cdp_perf_hook.py` 包 `performance.getEntries(ByType/ByName)`
打印 resource timing 条目的细字段（fetchStart/domainLookupEnd/connectStart/responseStart/
responseEnd）。

**证据 1 — `/pat/` 确凿从未被 JS 构造（预注入无盲区）**：完整 20s 流程（覆盖 822KB→127KB
窗口 + 交互）的 [net-hook] 记录：

```
08:58:33.9  xhr.open POST /fo/<tokenA> (zencare)      ← 113KB
08:58:33.9  xhr.send；fetch 同 URL
08:58:36.0  xhr.open POST /fo/<tokenB> (challenges)   ← 822KB（widget frame）
08:58:36.0  xhr.send；fetch 同 URL
08:58:37.6  img.src /cdn-cgi/.../ci/<token>/...       ← /ci/ Image（widget frame）
08:58:38.9  xhr.open POST /fo/<tokenB>                ← 127KB 交互变体
08:58:38.9  xhr.send；fetch 同 URL
```

**全程零 `/pat/`**（无 xhr.open、无 fetch、无 img.src、无 sendBeacon）。这是**决定性
证明**——预注入是真实的钩子（`hook-installed` 确认在每个 realm 执行），不是 IC 盲区。
step 45 的「IC 盲区可能掩盖 /pat/ 构造」假设排除。**/pat/ 从未被 JS 构造**（任何机制）。
附带发现：JSVMP 每发一个 `/fo/` XHR 后紧跟一次同 URL 的 `fetch`（双通道探测，模式稳定）。

**证据 2 — Image 请求不记录 resource timing（确定缺陷）**：[perf-hook] 的 widget frame
`getEntries()` 只有 822KB `/fo/` 的 entry（`|fetch|d=626|fS=701|dL=701|cS=701|rS=1327|rE=1327`）
加一个 `Qldo8a<ray>` 空条目（d=0，name 截断），**`/ci/` 完全不在 performance 里**。对照
代码：`record_performance_response`（page.rs:1334）只在 link(1579)/script(1996)/navigation
(3536)/XHR(3945) 路径调用，**Image 路径（op_load_image_metadata）无调用点**。perf-hook
实证与代码一致。

**证据 3 — resource timing 字段的异常形状**：822KB `/fo/` entry 的
`domainLookupEnd=connectStart=fetchStart=701`（全部用 transport_start，无 DNS/连接区分），
`responseStart=responseEnd=1327`（responseEnd 与 responseStart 相等，无读取耗时）。
对比 HaHaVM 画像（step 39）：`/pat/ {domainLookupEnd:2, responseStart:2, responseEnd:6}`、
`/ci/ {domainLookupEnd:0, responseStart:1, responseEnd:3}`——CF 期望这些字段有**真实且
相互区分**的值。

**结论**：`/pat/` 从未被 JS 构造已确凿（证据 1）。两条独立的环境真实性判定链浮现，都可能
导致 JSVMP 走交互分支：①`/pat/` 触发前读 `/fo/` 的 resource timing（`/fo/` entry 存在但
字段形状可疑，证据 3）；②`/ci/` 发出后 CF 读 `/ci/` 的 resource timing（**`/ci/` 条目
完全缺失**，证据 2）。HaHaVM 专门为两者备了画像，说明 CF 在这两步都读时序。**Image 请求
不记录 resource timing 是确定的事实缺陷，且是最可行动的修复点**——补上 `/ci/` 的 entry
（含正确的 domainLookupEnd/responseStart/responseEnd 区分）是当前最有把握的下一步。

**下一步（按信息量）**：
1. **修 Image 请求的 resource timing**：`op_load_image_metadata` 成功加载后，把响应的
   timing（wreq `Response.timing` 已有 start/response_start/response_end）经
   `__obscura_performance_record` 记录为 resource entry（entryType=resource,
   initiatorType=image）。这需要打通 ops.rs → page.rs 或让 bootstrap 在
   `_applyImageMetadata` 时记录。修完重测 `/pat/` 是否出现。
2. 同时修正 resource entry 的字段区分：`domainLookupEnd`/`connectStart`/`requestStart`
   不应全部等于 `fetchStart`（HaHaVM 画像的 2/2/6 形态）；但先做 #1（条目缺失更严重）。
3. 若补上 `/ci/` timing 后 `/pat/` 仍不出现：`/pat/` 触发读 `/fo/` timing 的假设需要
   专门验证（hook `performance.getEntriesByName('/fo/...')` 的返回值），或 `/pat/` 确为
   Chrome 原生 PAT 握手（step 44 结论 3），需实现浏览器级 PAT。
4. 移除本 step 全部临时插桩（`[img-probe]`/`[net-probe]`/perf-hook），跑基线。

**Step 46 补充（URL/PAT 钩子，`/tmp/cdp_xhr_hook2.py`）**：三个最终确认——

1. **URL 构造器钩子**（`new URL`）：全程只记录 `/fo/` 的 URL 构造（`URL(/cdn-cgi/.../fo/...,base)`），
   **零 `/pat/` URL 构造**。`/ci/` 的 img.src 是字符串直接赋值（不走 `new URL`）。
2. **PAT API getter 包装**（`Document.prototype.hasPrivateToken/hasRedemptionRecord/
   hasStorageAccess`）：**零 GETTER READ**。JSVMP 从未读这三个属性。step 39 发现 3 与
   step 44 的证伪**最终坐实**（getter 包装覆盖 `in`/`typeof`/`LoadIC` 全部读取形态）。
3. 网络钩子复现：3 次 XHR + 3 次 fetch + img.src（favicon、/ci/），零 `/pat/`。

**战线收束**：`/pat/` 从未被 JS 构造（网络 + URL + PAT API 三种观测面全覆盖），分流
判定**不依赖 PAT API**。但 HaHaVM 画像（`/pat/ {dL:2,rS:2,rE:6}`）与 step 28 浏览器实证
（managed 阶段发 /pat/）共同说明 `/pat/` 是 **JS 构造**——因此 obscura 的 JSVMP 在
822KB 后走了**不同的分流分支**（不发 /pat/ 直接拉 127KB），判定条件在 PAT API 之外。
候选判定面：resource timing 形状（`/fo/` 读取耗时 0.55ms vs HaHaVM 2ms、dL=cS=fS 同值）、
canvas 指纹、python 桥检测（step 44）、或 **TLS/HTTP2 指纹分流**（obscura 的 wreq
Chrome145 emulation 与真实 Chrome 仍有差异——若分流发生在传输层，JS 环境面无法解决）。
**HaHaVM 为 `/fo/`/`/pat/`/`/ci/` 全备 timing 画像**（`/fo/{dL:1,rS:5,rE:7}`、
`/pat/{dL:2,rS:2,rE:6}`、`/ci/{dL:0,rS:1,rE:3}`）——CF 对这三个 URL 都读 resource
timing，obscura 的 `/ci/` 无 entry、`/fo/` 形状异常仍是未消除的差异面。

### Step 47 — 修 Image resource timing：缺陷已修且有回归测试，但 `/pat/` 未动；新断点 = frame 无 navigation timing（2026-08-15）

**假设**（step 46 下一步 #1）：Image 请求不进 Performance Timeline，JSVMP 读 `/ci/` 的
resource timing 读到空 → 判定环境异常 → 不走 managed 证明流程（不发 `/pat/`）。

**方法**：
1. 修复（提交 `709cb1b`）。`op_load_image_metadata` 在 fetch 返回后把 `wreq Response.timing`
   （`response_start`/`response_end`/`redirect_end`）连同最终 URL、状态、字节数与
   Timing-Allow-Origin 判定，一并塞进返回给 JS 的 metadata 的 `timing` 字段；
   bootstrap 的 `_runImageRequest` 在 op 调用前取 `performance.now()` 作 `fetchStart`，
   回来后用新的 `_recordImageResourceTiming()` 调 `globalThis.__obscura_performance_record`。
   **entry 由元素所在 realm 记录**——frame 里的图片因此落进 frame 自己的时间线，
   而不是 embedder 的（这正是 widget `/ci/` 需要的）。TAO 判定放在 Rust（op 已知发起方
   origin 与原始响应头）；被拒时只暴露 `responseEnd`，与 Chrome 的不透明资源一致。
   `initiatorType` 是 **`img`** 不是 `image`——Resource Timing 取元素 localName。
   只有真正走网络的那一次带 `timing`：并发合流的 follower 与缓存命中不产生重复 entry。
2. 回归测试 `crates/obscura/tests/image_shim.rs` 两条：
   `image_load_records_a_resource_timing_entry`（主 realm，断言 initiatorType/里程碑单调/
   尺寸/状态码）、`image_in_a_frame_records_timing_in_that_frames_timeline`（**跨源
   iframe**，frame 内读自己的 `getEntriesByType('resource')` 再 postMessage 给父页）。
3. 实测：新建 serve（17:17:27，二进制 17:14，`/json/version` 已核）+ 合并的预注入
   net-hook + perf-hook（`/tmp/cdp_ci_timing_hook.py`，**无轮询**，step 42 教训），
   `--wait 24` 覆盖 822KB→127KB 的 managed 分流窗口。

**证据 1 — 修复生效，量化对比**：主文档 realm 的 `getEntriesByType('resource')` 修复前
只有 `/fo/` 的 fetch 条目（step 46 证据 2），修复后多出 favicon 的 image 条目：

```
https://zencare.co/favicon.ico|img|d=209.74|fS=629.50|dL=629.50|cS=629.50|rS=838.52|rE=839.24|sz=5924
```

`responseStart(838.52) ≠ responseEnd(839.24)`——读取耗时不再被抹平（step 46 证据 3 记的
`rS==rE` 是 page.rs 路径的问题，Image 路径天然带真实的两个采样点）。跨源 frame 路径由
回归测试 2 证明（`img 70`，frame 自己的时间线）。

**证据 2 — `/pat/` 依旧零构造，断点未移动**：完整 24s 流程的 [net-hook]：

```
09:17:54.868  img.src  /favicon.ico
09:17:54.991  xhr.open POST /fo/<tokenA> (zencare)         ← 113KB
09:17:57.278  xhr.open POST /fo/<tokenB> (challenges)      ← 822KB
09:18:00.096  img.src  /cdn-cgi/.../ci/<token>/...         ← /ci/
09:18:00.174  xhr.open POST /fo/<tokenB>                   ← 127KB 交互变体
```

零 `/pat/`（无 xhr.open、无 fetch、无 img.src、无 sendBeacon），与 step 46 逐字一致。
**假设既未证实也未证伪**：本轮 CF 在 `/ci/` 之后**再没读过任何 performance 接口**
（最后一次 `getEntries()` 在 09:17:59.519，早于 `/ci/` 的 09:18:00.096），所以补上的
`/ci/` entry 根本没被读到。另注 `/ci/` 与其后 `/fo/` 只隔 **78ms**——JSVMP 不等图片
加载完成就发了下一个 `/fo/`，「读 `/ci/` 时序再决定分流」在当前路径上不成立。

**证据 3 — 新断点：widget frame 没有 navigation timing entry（本步最大信息量）**：
CF 在两个 widget realm 里各查了一次 `getEntriesByType('navigation')`，**两次都是 0 条**：

```
09:17:58.294  [perf-hook] getEntriesByType(navigation)=0:[]     ← realm 2
09:18:00.055  [perf-hook] getEntriesByType(navigation)=0:[]     ← realm 3（822KB 所在）
```

主文档 realm 有 navigation entry（`https://zencare.co/1.txt|navigation|d=605.70|fS=0.07|
rS=392.69|rE=393.08|sz=5907`），frame realm 一条没有。代码侧一致：
`record_performance_response(&response, "navigation", "navigation")` 只在 page.rs:3536
为**顶层文档**调用，frame realm 无任何记录点。Chrome 里 iframe 文档必有自己的
`PerformanceNavigationTiming`——**这是 CF 主动读取、且读到了空值的确定差异**，
比 `/ci/` 的 resource entry（本轮根本没被读）证据链更硬。

**结论**：Image resource timing 是确定缺陷，已修 + 双回归测试锁定；但它**不是
`/pat/` 的 gate**——至少在当前分流路径上 CF 从未读过它。战线前移到
**frame 文档缺 navigation timing**：CF 读了两次、两次全空，是当前唯一「已证实被读取
且明确异常」的环境面。

**下一步（按信息量）**：
1. **给 frame 文档补 navigation timing entry**（证据 3）：frame 导航完成后在该 frame
   realm 记录 `entryType=navigation`（含 `domInteractive`/`domContentLoadedEvent*`/
   `loadEvent*`/`duration`，由 frame 自己的 lifecycle 驱动，而非顶层的）。修完重测
   `getEntriesByType('navigation')` 是否非空、`/pat/` 是否出现。
2. 修 page.rs 路径的字段区分（step 46 下一步 #2 未做）：`responseStart == responseEnd`
   与 `dL==cS==fS` 同值；后者对复用连接是**正常**的（HaHaVM `/ci/{dL:0}` 即连接复用），
   前者不是——`/fo/` 的读取耗时被抹成 0。
3. `transferSize` 全路径等于 `encodedBodySize`；Chrome 是 `encodedBodySize + 300`
   （头部近似）。三处路径（page.rs / fetch / 新的 image）要一起改才不会自相矛盾。
4. 若 frame navigation timing 补齐后 `/pat/` 仍不出现：回到 step 46 收束的候选面
   （canvas 指纹 / TLS-HTTP2 传输层分流），或直接实现浏览器级 PAT。

### Step 48 — 双向 message 对拍：父窗口确实回应了 `requestExtraParams`，通道两向全通（2026-08-16）

**假设**（用户提出）：widget iframe 加载后其内部没有执行，原因是 ①主窗口没给 iframe 发
`postMessage`，或 ②发了但 iframe 没收到。

**方法**：
1. 先自查二进制。`target/release/obscura`（mtime 08-16 12:38）起 serve 打出
   `Stealth mode enabled (tracker blocking)`——**缺 wreq，是非 stealth 构建**。按
   `--features render --config vendor/v8-source.toml` 重建（3m29s），重测得
   `TLS fingerprint impersonation + tracker blocking`，`vendor/v8-trace.sh check` 报
   `patched`。代码基线核对：HEAD `aeb81f7`，step 47 的修复 `709cb1b` 在其祖先中，
   工作树无改动——**本轮与 step 47 是同一份代码**。
2. `cdp_message_diff.py --no-click --start 12 --cap 30`。它只在每个 realm **追加**一个
   被动 `message` 监听，不包装 `postMessage`、不包装 `contentWindow`（step 6 教训），
   即未决清单要求的「不扰动流程的观测方式」。两个方向分别落在两个 realm 的 inbound 日志：
   `TOP <=` 为 widget→parent，`WIDGET <=` 为 parent→widget。
3. 另跑 `/tmp/cdp_ci_timing_hook.py`（net-hook + perf-hook）与 `cdp_probe.py messages`。

**证据 1 — 两个方向都通，且父窗口回应了 `requestExtraParams`**：

| 方向 | 条数 | 内容 |
|---|---|---|
| TOP ← WIDGET | 36 | `init`(managed) / `requestExtraParams` / `translationInit` / `food`×32 / `overrunBegin` |
| WIDGET ← TOP | 35 | `init` / `{"action":"managed",...,"au":"https://challenges.cloudflare.com/turnstile/v0/g/aae2b9a1c261..."}` / `cs` 栈 / `meow`×32 |

widget 在自己 realm 的 **41ms** 就收到了 `init` 与完整 managed 配置（`action`/`appearance`/
`au`/`apiJsMismatchReload*` 等），即 `requestExtraParams` 的应答。心跳为双向闭环：
widget 发 `food` seq N，父页回 `meow` seq N，32 对无一缺失，一直应答到观测结束。
（两侧时间戳不同源：WIDGET 的 41ms 是其自身 realm 起点，约当 TOP 侧的 1595ms。）

**结论 A（用户两个假设均证伪）**：主窗口发了（35 条），iframe 也收到了（时间戳齐全）。
断点不在 postMessage 通道，而在 **widget realm 内部**——它拿齐配置、心跳正常，却从不发出
第二个 `/fo/`（到 `challenges.cloudflare.com`），11.7s 后自报 `overrunBegin`。

**结论 B（结掉一条未决项）**：未决清单「父窗口是否回应了子窗口的 `requestExtraParams`
未证实」——**已证实：回应了**。step 6 留下的这条就此关闭。

**证据 2 — 本轮 CF 分流比 step 47 更浅**：`hook-installed` 只有 2 个 realm（step 47 为 3 个），
net-hook 全部请求仅 `img.src /favicon.ico` 与 tokenA 的 `xhr.open POST /cdn-cgi/challenge-platform/h/g/fo/...`
（zencare 源）。**无 822KB 的 challenges `/fo/`、无 `/ci/`、无 `/pat/`、无 `interactiveBegin`**。
perf-hook 因此只在主文档 realm 触发（`getEntries()=3` 含 navigation 条目），
**widget realm 的 `getEntriesByType('navigation')` 本轮一次都没被调用**——step 47 证据 3
指出的那个断点，本轮 CF 还没走到就 overrun 了。故 step 47 的「frame 缺 navigation timing」
本轮既未复现也未被否定。

**证据 3 — `cs` 栈底的引擎帧仍在（step 8 未决项复现）**：父页发给 widget 的
`{"event":"execute"}` 消息携带 CF 采集的调用栈，栈底两帧为：

```
at _runAtNesting (<obscura:bootstrap>:890:9)
at <obscura:bootstrap>:905:5
```

上面 8 帧均为真实 URL（api.js / chl_page），即 step 8 的修复仍然有效；未修的是栈底这两帧
（行号由当时的 894 变为 890/905，泄漏原样保留）。浏览器里 setTimeout 回调的栈到回调那帧
即止，宿主调度帧不出现在 JS 栈中，因此这两帧**在 Chrome 中不存在**。它落在 CF 明确采集并
经 postMessage 传输的指纹面上。step 36 的 Chrome 黄金基线同样有 `WIDGET <= cs`（251ms），
差别只在内容。

**证据 4 — IP 状态三态（测量前提，非引擎行为）**：同一二进制同一代码，同日三种出口 IP 得到
三种分流：①旧 IP → **CF 1020 硬封锁**（`Attention Required! | Cloudflare` /
`Sorry, you have been blocked`，`h1` 与 title 双证，非质询页，此状态下任何诊断都无效）；
②新 IP → 质询页但更浅（本 step 证据 2）；③历史 IP → 质询页。判定分流状态必须先看
`Page loaded` 的 title，再决定是否开跑探针。另注：质询页 `--dump text` 中出现的
"Verification successful. Waiting for zencare.co to respond" 是 DOM 内**预置的静态文案**
（各状态文案均在 HTML 中），**不是成功信号**——判据仍为目标 URL 返回真实 404。

**下一步**：断点在 widget realm 内部的 JSVMP，而非通道。按信息量：
1. step 47 下一步 #1（给 frame 文档补 navigation timing）仍然有效，但需在能走到
   822KB→127KB managed 窗口的分流上复测，否则读不到该面。
2. 修 `cs` 栈底的 `_runAtNesting` 两帧（step 8 未决）：使 setTimeout/嵌套 timer 回调的栈
   在回调帧终止，不暴露 `<obscura:bootstrap>`。这是 CF 确定采集且确定与 Chrome 有差异的面。
3. v8 trace 对 widget realm 的执行路径无法单独归属（动态脚本一律记为 `<page-eval>`，
   见「trace 的用途与边界」），若要看 widget 内部执行需继续用预注入钩子或插桩。

### Step 49 — 同 IP Chrome 对照推翻 step 48 的「CF 分流波动」归因：回退在 obscura 侧（2026-08-16）

**触发**（用户质疑）：「当前的进度为什么回退了」。step 48 把「本轮比 step 47 走得浅」
归因为 CF 端分流差异，该归因**本步证伪**。

**方法**：
1. `git log 709cb1b..HEAD` — step 47 实测（08-15 17:17，二进制 17:14，代码即 `709cb1b`）
   之后共 **26 个 commit**，其中大量直接改 JS 环境面：`6b9b8a0`（secure context 并收起
   被把守的 API）、`d7e7a7f`（收起 SharedArrayBuffer）、`4060dc8`（canvas 文本度量走真实
   布局）、`871682b`/`8734846`/`becb3db`（SharedWorker/ServiceWorker）、`552715e`/`1f963b7`
   （worklet/Trusted Types fail-closed）、`d547f4a`/`e58e212`（feature 错配与不继承 default）、
   `aeb81f7`（stealth 进 default）。
2. 同 IP 对照：先用 `api.ipify.org` 确认 js-reverse 控制的 Chrome 与 obscura 走同一代理、
   同一出口 IP（**均为 8.220.195.225**），再让 Chrome 走同一 URL。

**证据 1 — 同 IP、同代理、同一分钟内的请求序列对照**（Chrome ray `a2be386f397dc9fd`）：

| 阶段 | Chrome | obscura |
|---|---|---|
| `GET /1.txt` 307 → 403 → 质询 | ✓ | ✓ |
| `chl_page/v1` + `api.js` | ✓ | ✓ |
| `POST /fo/` (zencare, tokenA) | ✓ 200 | ✓ 200 |
| widget 文档 `turnstile/f/av0/rch/...` | ✓ 200 | ✓ |
| **`POST /fo/` (challenges, tokenB)** | **✓ 200** | **✗ 从不发出** |
| **`GET /pat/`** | **✓ 401** | **✗ 从不发出** |
| **`GET /ci/`** | **✓ 200 image** | **✗** |
| 第二个 `POST /fo/` (challenges) | ✓ 200 | ✗ |
| 终态 | 等待点击（interactive 分流） | 11.7s `overrunBegin` |

**结论 A（推翻 step 48 归因）**：同一 IP 同一时刻 Chrome 能走完整 managed 链路，
**obscura 走不深不是 CF 波动、不是 IP 信誉**，差异在 obscura 侧。step 48「本轮 CF 分流
更浅」的写法就此作废。

**结论 B（`/pat/` 的性质修正）**：`/pat/` 在当前 IP 上 Chrome **发得出来**（401）。它不是
无法企及的能力面，obscura 是**根本没走到那个阶段**。挂在未决首位的「`/pat/` 从不发出」
应重新表述为「obscura 在 822KB 之前就停了」。

**证据 2 — 四个便宜假设逐个证伪**（都用当前二进制实测）：

| 假设 | 方法 | 结果 |
|---|---|---|
| `6b9b8a0` 的 secure context 误伤 widget realm，`crypto.subtle` 被 delete | 每 realm 只读探针（不包装任何东西） | **证伪**。两 realm 均 `isSecureContext=true`、`subtle=object`、`Worker/SharedWorker=function` |
| 新收起的 API 被 CF 探测到缺失 | lookups trace 的 MISS 面统计（650 条 MISS） | **证伪**。无一条落在 `crypto.subtle`/`caches`/`serviceWorker`/`SharedArrayBuffer` 上 |
| `d547f4a`/`e58e212` 让 render 失效，几何回零（step 17/18 旧病） | CDP 量 widget 几何 | **证伪**。`docSize/bodyRect=1280×720`，widget iframe `x=192 y=304 w=300 h=65`，`roots=1` |
| IP 信誉跌到底 | 同 IP Chrome 对照 | **证伪**。见证据 1 |

**证据 3 — 顺带发现的确定 parity 缺陷**：`crossOriginIsolated=undefined`。Chrome 里它是
`WindowOrWorkerGlobalScope` 属性，非隔离环境下为**布尔 `false`**，绝不是 `undefined`。
`d7e7a7f` 收起了 `SharedArrayBuffer` 却未同步暴露 `crossOriginIsolated=false`——两者在
Chrome 中配套，当前组合自相矛盾，且一行即可命中。

**证据 4 — 流程深度的量化对比**：lookups trace 本轮 **2.3MB / 14772 行**，step 44 的
同模式基线为 **6MB / 32048 行**（走完 822KB→127KB）。不到一半。

**下一步**：便宜假设已穷尽，转入 A/B 二分（用户已授权回退代码）。做法是把主树的
`vendor/v8-source.toml` 改写为绝对路径版（`/tmp/v8-source-abs.toml`，因 `vendor/rusty_v8`
被 gitignore、只存在于主树），旧 worktree 用 `--features render,stealth`（当时 `default=[]`）
并共享 `CARGO_TARGET_DIR`，从而免掉 30 分钟 V8 重编，单轮增量约 3.5 分钟，26 个 commit
二分约 5 轮。

### Step 50 — 根因之一定位：`1f963b7` 的 Trusted Types 只有 API 外壳，`eval(TrustedScript)` 不执行（2026-08-16）

**假设**：step 49 已证回退在 obscura 侧且落在 `709cb1b..HEAD` 的 26 个 commit 内。本步
用 A/B + 因果干预定位具体 commit。

**方法**：
1. **A/B 二进制**。旧 worktree checkout `709cb1b`，patch 指向主树 `vendor/rusty_v8` 的绝对
   路径 config（`/tmp/v8-source-abs.toml`），`--features render,stealth`（当时 `default=[]`），
   共享 `CARGO_TARGET_DIR` 免 V8 重编，单轮增量 4 分钟。两个二进制均核过
   `TLS fingerprint impersonation`。
2. 同一 IP、同一代理，用同一个 net-hook 探针**交替**四轮。
3. 因果干预：在新版二进制上预注入 `delete globalThis.trustedTypes`，其余不变，重测。

**证据 1 — A/B 交替四轮，100% 一致**：

| 轮次 | realm | xhr.open | `/ci/` |
|---|---|---|---|
| OLD1 (`709cb1b`) | **3** | **3** | **1** |
| NEW1 (HEAD) | 2 | 1 | 0 |
| OLD2 (`709cb1b`) | **3** | **3** | **1** |
| NEW2 (HEAD) | 2 | 1 | 0 |

**证据 2 — CF 确实在用 Trusted Types，且就在 widget realm**（新版 lookups trace）：

```
HIT  Window.trustedTypes                     ← 先探测存在性
HIT  TrustedTypePolicyFactory.createPolicy   x3
HIT  TrustedTypePolicy.createHTML        栈: window.KQlAt3 <- qG <- CU <- CS <- BBGfx <- q8 <- q9 <- qn
HIT  TrustedTypePolicy.createScriptURL   栈: window.MfEvo2 <- ql <- qY <- t0 <- tL <- tN
HIT  TrustedTypePolicy.createScript      栈: window.ZHfDS6 <- Cj <- Cg <- Ca <- pgOAv <- t0 <- tL <- tN
```

全部发自 `challenges.cloudflare.com/.../turnstile/f/av0/rch/...`（widget 文档）。

**证据 3 — 缺陷本体，与 Chrome 对拍**（同一段 probe）：

| | Chrome | obscura (HEAD) |
|---|---|---|
| `p.createScript('1+1')` 的 `constructor.name` | `TrustedScript` | `TrustedScript` |
| `String(s)` | `1+1` | `1+1` |
| **`eval(s)`** | **`2`（number，代码被执行）** | **`"1+1"`（原样返回，未执行）** |
| `div.innerHTML = h` | `<b>x</b>` | `<b>x</b>` |

`1f963b7` 补齐了 TT 的 API 面（`createPolicy`/`createHTML`/`createScript`/`createScriptURL`
均返回正确的包装类型），但**没有给 `eval` 打 TT 补丁**。普通 JS 语义下 `eval(非字符串)`
原样返回，而 Trusted Types 规范要求 `eval()` 接到 `TrustedScript` 时将其作为代码执行
（Chrome 经 `SetModifyCodeGenerationFromStringsCallback` 实现）。于是：**旧版
`trustedTypes` 不存在，CF 走 fallback 直接赋字符串，一切正常；新版存在，CF 切到 TT 路径，
`eval(createScript(...))` 静默地什么也不做**，JSVMP 停摆。这是「补一半的 API 面比不补更
危险」的典型：存在性探测通过，行为却不符。

**证据 4 — 因果干预（不是相关性）**：新版二进制 + 预注入 `delete globalThis.trustedTypes`
（探针自报 `tt-now=undefined`），其余完全不变：

```
NEW 原样            realm=2  xhr.open=1  /ci/=0
NEW 删 trustedTypes  realm=2  xhr.open=2  /ci/=0   ← 822KB 的 challenges /fo/ 恢复发出
OLD (709cb1b)       realm=3  xhr.open=3  /ci/=1
```

删 TT 后的序列与旧版**前 5 条逐字一致**（含 822KB `/fo/`）。

**结论**：`1f963b7`（Trusted Types API 面按规范补齐）是**回退的根因之一**，已由因果干预确认。
修法二选一：①给 `eval`/`Function` 接入 TT（V8 `SetModifyCodeGenerationFromStringsCallback`，
把 `TrustedScript` 解包成源码），这是与 Chrome 对齐的正确做法；②在 ① 落地前，不暴露
`globalThis.trustedTypes`——半个 API 面比没有更糟。

**未完**：删 TT 后仍停在 `/ci/` 之前（`realm` 仍为 2，缺第三个 realm 与 `/ci/`），
**26 个 commit 里还有第二处回归**，位于 822KB → `/ci/` 之间。待查。

### Step 51 — 二分收敛：`1f963b7` 是唯一回归根因，且造成两级退化（2026-08-16）

**方法**：step 50 留下「还有第二处回归」的判断，本步用 A/B 二分证伪它。旧 worktree 逐个
checkout + 共享 `CARGO_TARGET_DIR` 增量构建（单轮约 2.5 分钟），统一判据
`realm>=3 && xhr>=3 && /ci/>=1`，统一探针（删 TT 版，中和已知的第一处），
每轮都核 `TLS fingerprint impersonation` 与端口占用。

**证据 — 二分过程**（`709cb1b..HEAD` 共 27 个 commit，按时间序号）：

| 序号 | commit | 内容 | realm | xhr | `/ci/` | 判定 |
|---|---|---|---|---|---|---|
| 0 | `709cb1b` | step 47 基线 | 3 | 3 | 2 | **好** |
| 4 | `871682b` | SharedWorker 真实现 | 3 | 3 | 1 | **好** |
| 5 | `1f963b7` | **Trusted Types** | 2 | 2 | 0 | **坏** |
| 7 | `552715e` | worklet fail-closed | 2 | 2 | 0 | 坏 |
| 16 | `6b9b8a0` | secure context | 2 | 2 | 0 | 坏 |
| 27 | `aeb81f7` | HEAD | 2 | 2 | 0 | 坏 |

第 4 与第 5 之间只有 `1f963b7` 一个 commit。**「第二处回归」不存在**——step 50 结尾的
那句判断就此作废。

**两级退化**（同一个二进制 `1f963b7`，只换探针）：

```
原样（trustedTypes 存在）      realm=2  xhr=1  /ci/=0
删 globalThis.trustedTypes     realm=2  xhr=2  /ci/=0
第 4 个 commit（无 TT）        realm=3  xhr=3  /ci/=1
```

删掉 `globalThis.trustedTypes` 只救回一级。说明该 commit 的影响不止这一个全局属性——它
还改了 `runtime.rs`（111 行）与 bootstrap 的其他部分，widget realm 侧仍有残留路径。
**修复必须回到行为正确，而不是靠藏掉入口。**

**结论**：`1f963b7`（Trusted Types API 面按规范补齐）是本次回退的**唯一根因**。缺陷本体见
step 50 证据 3：API 外壳齐全（类型、`String()` 均与 Chrome 一致），但 `eval(TrustedScript)`
不执行代码（Chrome 返回 `2`，obscura 返回 `"1+1"`）。CF 先探测 `Window.trustedTypes`
存在性，存在就切到 TT 路径调用 `createHTML`/`createScript`/`createScriptURL`（trace 中三者
均命中，栈在 JSVMP 主链上），于是 JSVMP 静默停摆。

**修法（按正确性排序）**：
1. 给 `eval`/`Function` 接入 Trusted Types：V8
   `SetModifyCodeGenerationFromStringsCallback` 把 `TrustedScript` 解包成源码后编译，
   与 Chrome 对齐。同时补 `TrustedScriptURL` 在 `script.src`、`TrustedHTML` 在
   `innerHTML`/`srcdoc` 上的接受路径的行为一致性测试。
2. 在 1 落地前 revert `1f963b7` 的入口暴露部分（不暴露 `globalThis.trustedTypes`）。
   **半个 API 面比不实现更危险**：存在性探测通过，行为却不符，页面因此走上一条它以为
   受支持、实际静默失败的路径。

**这条教训是通用的，不限于 Cloudflare**：任何「按规范补齐 API 面」的 parity 改动，只要
新暴露了一个特性入口，就必须同时保证该入口背后的**行为**成立；否则 parity 改动本身会把
原本走 fallback 而正常工作的页面推进死路。本次 26 个 commit 里 API 面普遍更接近 Chrome
（`ServiceWorker`/`Worklet`/`isSecureContext`/`SharedArrayBuffer` 收起均与 Chrome 一致），
唯独 TT 的行为没跟上，结果是整体退化。建议给这类 commit 加一条门禁：新暴露的入口必须
带一个「实际使用它」的用例，而不只是 `typeof` 探测。

**附带发现（与本回归无关，两版一致，独立缺陷）**：

1. **引擎全局对页面可枚举**。`for...in globalThis` / `Object.keys(window)` 直接列出
   `Deno`、`__obscura_webgl_enabled`、`__obscura_referrer_policy`、
   `__obscura_performance_time_origin_ms`、`__obscura_viewport_w`、`__obscura_viewport_h`、
   `__obscura_screen_emulated`。一行即可命中的引擎身份泄漏，优先级应高于多数指纹面细节。
   （注：step 51 中途一度以为这些是 CF 主动读取，核对 trace 的来源列后更正——读取方全是
   引擎自己的脚本 `<obscura:bootstrap>` / `<set-fingerprint>` / `<eval>` /
   `<obscura:frame-realm-bootstrap>`。可枚举性本身仍是真缺陷。）
2. **`crossOriginIsolated` 为 `undefined`**，Chrome 为布尔 `false`（实测同页对拍）。
   与已收起的 `SharedArrayBuffer` 配套关系不自洽。
3. `measureText('Mg').width`：Chrome 14.73 / 新版 14 / 旧版 12（新版更接近）；
   `fontBoundingBoxAscent` 在 obscura 两版均为 `undefined`，Chrome 为 number。

### Step 52 — 修复：Trusted Types 入口不再暴露（`eval(TrustedScript)` 无法实现）（2026-08-16）

**定位收敛过程**（step 51 的「eval 是根因」一度动摇过，这里是完整的收敛）：

1. **反向验证（决定性）**：在 `871682b`（回归前、稳定 `xhr=3`）上**预注入一个等效的
   TT 表面**（纯 JS：三个包装类型 + 工厂 + policy 返回包装对象），流程立刻掉到
   `realm=2 xhr=1`——与 HEAD 原样一模一样。**在好的构建上凭空造出这个回归**，因果闭环。
2. **sink 逐个实测**（HEAD 二进制，policy 恒等回调）：

   | sink | 结果 |
   |---|---|
   | `script.text` / `textContent` / `innerText` | ✓（append 后真的执行，`ran=1`） |
   | `script.src` / `setAttribute('src')` | ✓ |
   | `innerHTML` / `outerHTML` / `srcdoc` / `insertAdjacentHTML` / `createContextualFragment` | ✓ |
   | `new Worker(TrustedScriptURL)` / `new Function(TrustedScript)` | ✓ |
   | **`eval(TrustedScript)`** | **✗ `ret=object ran=0`**（Chrome：`2`） |

   **唯一的洞就是 `eval`**，其余全部正确接受包装类型。
3. 被证伪的中间假设，一并记录：`delete globalThis.trustedTypes` 只把 `xhr` 从 1 救到 2，
   救不回 3，一度让我以为「还有第二处回归」。**原因是我自己的探针有 bug**——它
   `delete` 之后又 `Object.defineProperty(..., {value: undefined})`，属性其实还在
   （`'trustedTypes' in window === true`）。改成只 delete 后复测仍是 2，最终由上面的
   反向注入实验给出干净结论。教训见「测量盲区」新增条目。

**为什么不能实现 `eval`**：eval 对非字符串参数原样返回（ES `PerformEval` 第 1 步）；
Trusted Types 把这一步换成宿主钩子，Chrome 经 V8 `ModifyCodeGenerationFromStrings`
回调实现。rusty_v8 没有暴露该回调（只在 `v8/include/v8-callbacks.h` 的 C++ 侧），而官方
构建（Dockerfile / release.yml）链接 **prebuilt librusty_v8**，加 binding 会让同一个 API
在不同构建方式下行为不同。覆盖 `globalThis.eval` 也不是替代:它会把每个 `eval(x)` 调用点
变成 indirect eval，改掉真实页面依赖的作用域语义。

**历史修复**（后续已扩展）：`_installTrustedTypes` 曾以 early return 关闭入口；当前入口已恢复，
策略白名单和常用 script sinks 已接入。实现全部保留，
将来 eval 钩子可用时**删掉那一行 `return` 即可**。同步:
`trusted_types_surface_is_not_exposed` 新回归测试(断言 6 个全局都不存在)、原形状测试标
`#[ignore]` 并注明卡点、roadmap §3.2-#12 与 P3-18 改为「暂缓」、
`js-repros/trusted-types/README.md` 顶部标注状态。

**修复前后对比**(同 IP、同代理、交替测量、原样探针无任何干预):

| 二进制 | 轮次结果 (`xhr`) | 判据 `realm>=3 && xhr>=3 && /ci/>=1` |
|---|---|---|
| HEAD 未修复 | 1, 1, 1, 1, 1 | **0/5 通过** |
| HEAD + 本修复 | 1, 3, 3, 3, 3 | **4/5 通过** |

首轮那次未通过如实记录:判据存在偶发波动(CF 端),**不是 100% 确定性判据**。这条本身
是重要的测量纪律——step 51 的二分建立在单次或少数几次测量上,结论虽被反向注入实验独立
证实,但今后二分必须每点重复 3 次以上。

**结论**:回归已修复,流程恢复到 step 47 的深度(`realm=3 xhr=3 /ci/=1`,822KB `/fo/` +
`/ci/` + 127KB 交互变体)。**这不等于过盾**——step 47 时同样走到这里仍以 `overrunBegin`
告终,`/pat/` 依旧从不发出。质询本身的断点回到 step 47/49 描述的位置。

**通用教训(已回填 roadmap)**:任何「按规范补齐 API 面」的改动,只要新暴露一个特性入口,
就必须保证该入口背后的**行为**成立。半个 API 面比不实现更危险:存在性探测通过,页面据此
选择代码路径,然后静默失败。建议门禁:新暴露的入口必须带一个**实际使用它**的用例,而不
只是 `typeof` 探测。本次 26 个 commit 里 API 面普遍更接近 Chrome
(`ServiceWorker`/`Worklet`/`isSecureContext`/`SharedArrayBuffer` 收起均正确),唯独 TT 的
行为没跟上,结果是整体退化。

### Step 53 — 附带发现修复 1/2：引擎全局不再可枚举；`crossOriginIsolated` 补为 `false`（2026-08-16）

**修复 A — 引擎全局对页面可枚举**（step 51 附带发现 1）。bootstrap 早就有
`_preHideInternals` 把内部全局预声明为 non-enumerable,但**七个名字不在名单里**,
`Object.keys(window)` 一行即可读出:`Deno`、`__obscura_webgl_enabled`、
`__obscura_referrer_policy`、`__obscura_performance_time_origin_ms`、
`__obscura_viewport_w`、`__obscura_viewport_h`、`__obscura_screen_emulated`。

补名字之外还要改写法:原循环用 `{value: undefined}` 重定义,而 `Deno` 在 bootstrap
运行前就由 deno_core 创建并持有值,照原样加进名单会**把它清空**,所有 op 调用随之失效。
改为先读 `getOwnPropertyDescriptor` 保值(accessor 则只翻 `enumerable`)。

`Deno` 只做到隐藏,没有删除:JS 侧 119 处引用,Rust 注入的片段(page.rs、realm.rs)也走
`Deno.core.ops`。`'Deno' in window` 仍答 true,这一半留作未决。

**修复 B — `crossOriginIsolated`**（step 51 附带发现 2）。Chrome 的每个全局都有它,无
COOP+COEP 时读 `false`;obscura 答 `undefined`,而同时又(正确地)收起了
`SharedArrayBuffer`——这两者在 Chrome 中配套,当前组合自相矛盾且一行可查。补为常量
`false` 的 accessor(引擎不解析任何 COOP/COEP 头,隔离永不成立)。worker scope 早已有
该属性(worker.rs:945),只有 window 缺。

**验证**（同 IP 同代理）:

```
enumLeak=[] ownLeak=[] denoWorks=true
crossOriginIsolated=false(boolean) SharedArrayBuffer=undefined isSecureContext=true
trustedTypes=undefined viewport=[1280,720]      ← 保值写法未破坏 __obscura_viewport_w
```

回归测试两条:`engine_internals_are_not_enumerable_on_the_global`(同时断言 `Deno.core.ops`
仍可用)、`cross_origin_isolated_reads_false_rather_than_undefined`。obscura-js 480 通过。
质询流程复测 2 轮均为 `realm=3 xhr=3 /ci/=1`,step 52 的修复未被拖回。

### Step 54 — 附带发现修复 3：`TextMetrics` 补齐并接上真实字体度量（2026-08-16）

**问题**（step 51 附带发现 3）。`measureText` 返回的是**普通对象**,只有三个 own 属性:

```
Object.prototype.toString.call(ctx.measureText('x'))  // [object Object],Chrome 是 [object TextMetrics]
'fontBoundingBoxAscent' in ctx.measureText('x')       // false,Chrome 有九个数值
```

而且 `actualBoundingBoxAscent` 是 `7 * round(fontSize/10)` 这样的常量:**只随字号变,不随
字族变**。同一字号下所有字体给出同一个上升高度,这在 canvas 指纹面上是自相矛盾的——
宽度已经走真实排版引擎(`4060dc8`),高度却没有。

**Chrome 146 基准**(js-reverse 实测,四组字体/字号):九个数值全部在 **prototype 上以
getter 暴露**,own 属性为空;成员表无 `emHeight*`。两条规律在四组样本上全部成立:
`hangingBaseline === 0.8 * fontBoundingBoxAscent`、`alphabeticBaseline === 0`;
`ideographicBaseline === -fontBoundingBoxDescent` 在四组中吻合三组。

**修复**:
- `CanvasTextMeasurer::measure_metrics` 返回宽度加 grid-fitted 字体框,取自
  `TextEngine::inline_font_box_metrics`——**与内联布局用的是同一个盒子**,所以
  TextMetrics 不会和引擎隔壁给出的元素高度打架。新 op `op_canvas_text_metrics`
  以 `"w,ascent,descent"` 平串返回(三个数,JSON 的解析开销就是全部开销)。
- bootstrap 增加真正的 `TextMetrics` 接口:品牌构造器(非法构造抛 Chrome 的原话)、
  九个数值作为 prototype getter、全局非可枚举。`measureText` 改为返回它。
- 墨水范围(`actualBoundingBox*`)没有逐字形轮廓可用,退回字体框与 advance,是真实
  墨水的**超集**而非编造值,且与并列上报的字体框自洽。这一限制写在代码注释里。

**结果**(与 Chrome 146 对拍):

| 用例 | Chrome | obscura |
|---|---|---|
| 16px Arial `Mg` | `fbbA=14 fbbD=3 hanging=11.2 ideo=-3` | **逐位相同** |
| 32px Times `Mg` | `fbbA=29 fbbD=7 hanging=23.2 ideo=-7` | **逐位相同** |
| 结构(tag / own props / 成员表与顺序 / 全局 enumerable / 非法构造) | — | **逐项相同** |
| 10px sans-serif、10px monospace | `11/3`、`9/2` | `9/2`、`8/3` |

后两行的差来自默认字族用的是 bundled face(跨机一致是既定取舍,见
js-repros/font-fingerprint/),不是算法差异——同一算法在 Arial/Times 上与 Chrome 完全重合。

**验证**:回归测试 `measure_text_returns_a_branded_text_metrics_matching_chrome_members`
(结构 + 16px Arial 数值 + 断言字体框随字族变化)。全量 `cargo nextest` **1611 通过 /
6 skipped**。质询流程复测 2 轮仍为 `realm=3 xhr=3 /ci/=1`。

**顺带修好的门禁**:全量 nextest 此前在干净 HEAD 上就编译失败——`obscura-render` 自身是
workspace member,而 `render` 是其他成员用的 feature 名,从根跑 `--features render` 时它
自己的目标不带 feature,与 obscura-js 要的 `paint` 不统一,`CanvasTextMeasurer` 消失
(E0433/E0425),而 `cargo tree` 却显示 `[default,paint]`。加 `render = ["paint"]` 别名修复
(`0b09e33`)。另注:`obscura-cli::mcp_client` 的 `test_navigate_and_snapshot` /
`test_wait_for_selector` 在并行满载下偶发失败,单独跑稳定通过,属既有 flaky。

### Step 55 — `/pat/` 首次发出（401,与 Chrome 同码):挂了六个 step 的首要阻塞解除（2026-08-16）

**结论先行**:`/pat/` **发出了**,状态码 **401**,与 Chrome 逐字一致;`brunhild.../i/` 也在。
**但仍未过盾**——目标 URL 仍返回 `Just a moment...` 而非真实 404,判据未变。断点前移,不是通关。

**证据 1 — 完整请求序列**(HEAD 二进制,`RUST_LOG=obscura_js=debug`,同 IP 同代理):

```
08:19:01.912  GET  zencare /orchestrate/chl_page   -> 200 (229136 bytes)
08:19:02.190  GET  challenges /turnstile/.../api.js
08:19:02.323  POST zencare /fo/ (tokenA)           -> 200 (113560 bytes)
08:19:04.568  POST challenges /fo/ (tokenB)        -> 200
08:19:05.829  GET  brunhild.challenges /i/                        ← Chrome 序列 #9
08:19:05.832  GET  challenges /pat/                -> 401         ← Chrome 序列 #10,同码
08:19:08.507  POST challenges /fo/                 -> 200         ← Chrome 序列 #12
```

对照 step 49 采集的 Chrome 黄金序列,`#6`→`#12` 已逐条对上(`/ci/` 走 Image 路径,net-hook
计数为 1)。

**证据 2 — A/B 排除「一直如此,只是没看到」**。这一条必须先做:`/pat/` 走
`op_fetch_url` 直发(日志 `has_tx=false`),**不经过 JS 的 XHR/fetch/img.src**,所以
step 46 赖以定论的预注入 net-hook 天然看不见它。同一 IP、同一探针、同一日志级别:

| 二进制 | 轮次 | `/pat/` | challenges `/fo/` |
|---|---|---|---|
| `709cb1b`(step 47 代码) | 2 轮 | **0** | 7 |
| HEAD(含本日四项修复) | 6 轮 | **2** | 7 |

`709cb1b` 流程同样走完(`chFO=7`)却零 `/pat/`,所以不是「旧版也发只是没观测到」,是真差异。

**证据 3 — 归因:不是本日那三项指纹修复,而是 26 个 parity commit 被 TT 修复解锁**。
三项运行时干预逐个回退,`/pat/` **全部仍为 2**:

| 干预(预注入,HEAD 二进制) | `/pat/` |
|---|---|
| 不干预(基线,2 轮) | 2 |
| `delete crossOriginIsolated`(退回 undefined) | 2 |
| 恢复引擎全局为可枚举 | 2 |
| `measureText` 退回普通对象 + 三属性 | 2 |

再看两个中间点:

| 二进制 | `/pat/` | challenges `/fo/` | 说明 |
|---|---|---|---|
| `6b9b8a0`(前 16 个 commit,TT 回归在) | 0 | **0** | TT 回归把流程卡在最早期,根本走不到 PAT 阶段 |
| `fix2`(TT 修复 + 全局 + coi,**无** TextMetrics) | **2** | 7 | 已经有 `/pat/` |

合起来:`/pat/` 既不来自 `crossOriginIsolated`、也不来自引擎全局隐藏或 TextMetrics
(三者回退后依然发出,且 `fix2` 缺 TextMetrics 也照发)。它来自 **`709cb1b..HEAD` 的 26 个
parity commit**(secure context、Worklet、SharedWorker、SharedArrayBuffer 按 Chrome 收起
等),而这些改进此前**被 `1f963b7` 的 TT 回归挡在门外**——流程停在 `xhr=1`,连 822KB 都发
不出,自然到不了 PAT 阶段。step 52 修掉 TT 之后它们才第一次真正生效。

这也回答了 step 49 留下的那个反直觉现象:那 26 个 commit 让 API 面普遍更接近 Chrome,
却整体退化——因为其中一个补了半截的 API 面(TT)把其余全部收益吃掉了。

**证据 4 — 仍未过盾**。`fetch --wait 30` 终页仍是 `Just a moment...`,非真实 404。

**测量盲区(新增,重要)**:预注入 net-hook 只覆盖 JS 层的 `XMLHttpRequest.open`/`fetch`/
`img.src`/`sendBeacon`,**看不到 `op_fetch_url` 直发的请求**(`has_tx=false`)。step 45/46
「`/pat/` 从未被 JS 构造」的零命中结论建立在该钩子上,**其覆盖面小于当时的表述**。判断
「某请求是否发出」必须以 Rust 侧 `RUST_LOG=obscura_js=debug` 的 `op_fetch_url called` /
`stealth_fetch completed` 为准,JS 钩子只能用来判断「是否由页面脚本的哪个 API 构造」。
另注 `/pat/` 与 `brunhild /i/` 相邻且同为 `has_tx=false`,两者可能来自同一个预注入未覆盖
的上下文,待查。

**未决清单变更**:`/pat/ 从不发出` 从首要阻塞**移除**。当前首要阻塞回到
**`interactiveBegin` 之后的交互确认与 `fail code=600010`**,以及 step 47 提出的
**frame 文档缺 navigation timing**(本轮未复验)。

### Step 56 — 补上点击这一环:提交链完整,断点回到「提交后被判失败」（2026-08-16）

**测量缺陷先记**(用户追问才发现):step 52-55 的**所有**轮次用的都是
`/tmp/cdp_ci_timing_hook.py`,它只导航加等待,**从不点击**。判据链里点击之后的那两个请求
因此不可能出现,而我在 step 55 里只对照到 Chrome 序列的 `#12` 就收尾了。**没有点击的轮次
不能用来判断提交链是否通**,这条补进「测量盲区」。

**带点击的完整序列**(`cdp_click_fast.py --start 6 --deadline 40 --settle 18`,
`RUST_LOG=obscura_js=debug`,同 IP 同代理):

```
08:32:42.643  GET  zencare /orchestrate      -> 200 (229565)
08:32:43.064  POST zencare /fo/  (tokenA)    -> 200 (113560)
08:32:46.276  POST challenges /fo/ (tokenB)  -> 200 (845720)   ← 822KB 大载荷
08:32:47.094  GET  challenges /pat/          -> 401 (1)        ← step 55 的突破
08:32:50.120  POST challenges /fo/           -> 200 (127720)   ← 127KB 交互变体
              [click @ t=6.9s,interactiveBegin 在 6.68s,点击落在其后 0.2s]
08:32:52.404  POST challenges /fo/           -> 200 (5052)     ← 提交 POST
08:32:52.730  POST zencare /fo/              -> 200 (3256)     ← 主页面回传
08:32:55.229  GET  zencare /orchestrate      -> 200 (227898)   ← 换 ray 重来 = 判失败
```

widget 几何正常(`box={x:192,y:304,w:300,h:65}`),点击命中 `(213,335)`。

**结论**:**判据链除最后一步外全部走通**——`interactiveBegin` → 点击 → **5052B 提交** →
**3256B 回传**,量级与 step 40/43 记录的一致。之后没有 `complete`、没有 token,CF 直接
重新下发 orchestrate 换 ray,即判失败。postMessage 只有四条
(`init`/`requestExtraParams`/`translationInit`/`interactiveBegin`),
**`interactiveEnd` 本轮未出现**——与 step 41 记的「间歇性、不可作判据」一致。

**当前断点**(相对 step 40 的净变化):`/pat/` 与 `/ci/` 都已发出且状态码与 Chrome 一致,
822KB→127KB→5052B→3256B 全链路打通,**唯一没有变的是最后的判定**:提交被接受但不发
`complete`。即 step 37 起就挂着的 `fail code=600010` 那一项,现在是**唯一**实质阻塞。
失败码在加密响应体内,`RUST_LOG` 看不到,需要解开 `cfChlOut`/`cfChlOutS` 或在 api.js
字符串表里定位 `600010` 分支。

### Step 57 — 读 api.js 的通信层:`fail` 是本地合成的;并修掉 console.log 触发 getter（2026-08-16）

**api.js 通信层结构**(82465B,事件名全是明文):

- `window.addEventListener("message", Ve)`,`g.msgHandler=Ve`、`g.internalMsgHandler=ye`。
- 允许的 event 白名单在一个 switch 里:`complete`/`fail`/`feedbackInit`/`food`/`init`/
  `interactiveBegin`/`interactiveEnd`/`interactiveTimeout`/`languageUnsupported`/
  `overrunBegin`/`overrunEnd`/`reject`/`reloadApiJsRequest`/`reloadRequest`/
  `requestExtraParams`/`tokenExpired`/`translationInit`/`turnstileResults`/`widgetStale`。
  每类还校验 `e.source` 必须等于对应的 targetWindow。
- `complete` 分支:`o.response=i.token`,有 `sToken` 走一条回调,否则 `c(o,s,!1)`。
  **token 由 widget 发来**,主页面只负责收。
- `fail` 分支:读 `rcV`、`cfChlOut`、`cfChlOutS`,并 `i.code!==0 && (o.errorCode=i.code)`。

**关键发现:`fail` 可以是主页面自己合成的,不一定来自服务器**。api.js 的 watchcat
(`meow`/`food` 心跳)在判定 widget 失联时会走:

```js
var ae=function(V,o){console.log("Turnstile Widget seem to have ".concat(V,": "),o)};
ae(E?"hung":"crashed",p);
var te=E?Ut:Ht;                      // Ut=300030(hung) / Ht=300031(crashed)
internalMsgHandler({code:te,event:"fail",rcV:...,widgetId:p});
```

这解释了为什么 postMessage 里从来抓不到 `fail`——它走 `internalMsgHandler`,不经过
window 消息。**本轮实测 watchcat 未触发**:`Turnstile Widget seem to have` 这条
console.log 一次都没出现,且 300030/300031 都不是 600010。**600010 不在 api.js 里**
(全文零命中),它在 chl_page 的 `!` 分隔字符串表中(与 `apply`/`async`/`charAt`/
`cookieEnabled`/`keys` 等混在一起),**表里有 ≠ 该分支被执行**(见测量盲区)。

**修复:`console.log` 会遍历参数对象,触发作者 getter**。CF 每行日志都在探测:

```
[obscura::console] %c%d font-size:0;color:transparent wNEIG0
[obscura::console] {"_nid":437,"_style":{"accentColor":"",...}}   ← 元素被序列化
```

`console.log("%c%d","font-size:0;color:transparent",probe)` 是标准的 devtools 探测:
探针对象带访问器,**只有 devtools 展开它时才会被读**。obscura 的 `_consoleFn` 对每个
object 参数做 `JSON.stringify`(并在结果为 `{}` 时再读一次 `.message`),把每个可枚举属性
都走了一遍,等于每行日志都回答一次「devtools 开着」。

与 Chrome 146 对拍(同一段探针):

| | Chrome | obscura 修复前 | 修复后 |
|---|---|---|---|
| 普通对象上被触发的 getter | `[]` | `["id","name","_nid","length","className"]` | `[]` |
| DOM 元素上的 trap | `[]` | `["el"]` | `[]` |

改为 `Object.prototype.toString.call(a)`(只查 `Symbol.toStringTag`,探测代码用的是字符串
键)。`Error` 参数仍走原有分支输出 stack,诊断能力不受影响,回归测试一并断言。

**结果:确定缺陷已修,但未突破过盾**。修复后点击链路提交从 **5052B 变回 4976B**
(少 76 字节),`/pat/` 401、3256B 回传、换 ray 重来全部照旧,终页仍是 `Just a moment...`。
**4976B 不是成功标志**——step 40 记录的 obscura 提交就是 4976B 且同样失败;5052→4976
只说明提交内容变了,很可能正是那个 devtools 标志位。

回归测试 `console_log_does_not_invoke_getters_on_its_arguments`;obscura-js 482 通过。

### Step 58 — 定位 600010:由 widget 经 postMessage 上报;widget 文档 CSP 强制 Trusted Types（2026-08-16）

**触发**(用户追问):第三个 `challenges /fo/` 之后、`zencare /fo/` 之前的那次通信是什么。

**方法**:预注入钩子把记录改走 `console.warn`(serve 日志收集**所有** realm),同时钩
`XMLHttpRequest.open`、`window.fetch`、`navigator.sendBeacon` 并各记一段调用栈,再配合点击。
此前的探针只 dump 主文档 realm 的数组、且只钩 XHR,所以既看不到 widget realm 也看不到
fetch——这是本轮能拿到结果的原因。

**证据 1 — 那条通信就是 `fail`,600010 由 widget 上报**:

```
14022|TOP|IN | {"event":"interactiveEnd"}                       ← 点击被接受
14871|TOP|IN | {"source":"cloudflare-challenge","widgetId":"ri63c","event":"fail",
                "code":"600010","rcV":"582ST9...","cfChlOut":"U9XWMfNIUA7k...$J0pjg4h5lAf2iSe9aOX0ig==",
                "cfChlOutS":"mV/KoRm9kYo2u94msrCC..."}
14888|TOP|XHR| POST zencare /fo/ :: at b (chl_page:2:146312) <- at Object.WISfF (chl_page ...)
```

**`fail` 是 widget 通过 postMessage 发给主页面的**,`code` 是字符串 `"600010"`,随行两个
加密载荷。主页面收到后 **17ms** 内发出 `zencare /fo/`(就是那个 3256B),调用栈落在
chl_page 的 `Object.WISfF`。**因此 3256B 不是独立判定,它只是把 widget 的失败结论转发给
源站。**

这同时纠正三点:①`fail` **不是**服务器下发;②**不是** api.js 的 watchcat 本地合成(那条路
的码是 `Ut=300030` hung / `Ht=300031` crashed,且本轮 `Turnstile Widget seem to have` 一次
未打印);③本轮 `interactiveEnd` **出现了**——点击被接受,失败发生在其之后的判定里。

**证据 2 — widget 文档的 CSP 强制 Trusted Types**(Chrome 侧读取):

```
default-src 'none'; script-src 'nonce-...' 'unsafe-eval'; script-src-attr 'none';
worker-src blob:; style-src 'unsafe-inline'; img-src 'self';
connect-src 'self' https://hagen.challenges.cloudflare.com https://brunhild.challenges.cloudflare.com;
frame-src 'self' blob:; child-src 'self' blob:; form-action 'none'; base-uri 'self';
trusted-types GAPH2 default; require-trusted-types-for 'script'
```

`trusted-types GAPH2 default` 是**策略名白名单**,`require-trusted-types-for 'script'` 打开
强制。实测(Chrome main world,isolated world 会绕开 CSP 因而给出错误答案):

| 探针 | Chrome main world |
|---|---|
| `eval("1+1")` | **2**,不抛 |
| `trustedTypes.defaultPolicy` | **present** |
| `createPolicy("probe_csp_1")` | `TypeError: Policy "probe_csp_1" disallowed.` |

即 **CF 自己创建了名为 `default` 的策略**;default policy 存在时,传给 script sink 的字符串
会自动经它转换,所以 `eval(字符串)` 不但不抛,还会**回调 CF 自己的 `default.createScript`**。
换言之:**在真实 Chrome 的 widget 文档里,每一次 `eval(字符串)` 都要过一遍 CF 的回调**。
obscura 当前解析这条 CSP 的 Trusted Types 指令并暴露 `trustedTypes`，但仍缺少
`eval(TrustedScript)` 的 V8 宿主钩子，因此完整 Chrome 行为尚未达成。

**结论与影响**:Trusted Types 在这里**不是可选的 parity 项,是 widget 文档的硬性运行条件**。
完整对齐需要三件事一起到位:①CSP `trusted-types` / `require-trusted-types-for` 解析;
②TT API 面(已实现,现被 step 52 关闭);③`eval`/`Function` 的宿主钩子(缺,见 step 52 的
依赖分析)。只做其中一两件都会造出新的可检测矛盾——step 49-52 的回归正是「只做 ②」的后果。

**当前断点**:`interactiveEnd` 之后,widget 内部判定失败并上报 `code=600010`。该码是
chl_page/widget JSVMP 常量池里的条目(chl_page 中索引 31,邻居是 `apply`/`async`/
`script error` 一类字面量),**静态定位其引用需要先解开 JSVMP 的索引机制**;`cfChlOut`/
`cfChlOutS` 为加密载荷。下一步候选:①补齐上面三件套后复测;②在 widget realm 用可控钩子
定位发出 `fail` 的那一帧。

### Step 59 — CSP / Trusted Types 当前实现校正（2026-08-16）

Step 58 中“仍缺少”的结论已过时，当前 HEAD 已完成以下运行时能力：

| 能力 | 当前状态 |
|------|----------|
| `trusted-types` 策略名白名单、重复策略拒绝、`defaultPolicy` | 已实现，并按文档 CSP 生效 |
| `require-trusted-types-for 'script'` | 已覆盖 `innerHTML`、`DocumentFragment.innerHTML`、`iframe.srcdoc`、script `text`/`textContent` 等 sink |
| `eval(TrustedScript)` | 已通过 V8 `ModifyCodeGenerationFromStrings` 宿主回调执行，并保留普通 `eval(object)` 语义 |
| `script-src` / `style-src` / `img-src` | 顶层文档、frame 文档资源请求均检查；脚本支持 nonce 与 `unsafe-inline` |
| `connect-src` | 初始 fetch/XHR 及普通、stealth 客户端的每个重定向目标均检查 |
| `worker-src` | Dedicated Worker 与 SharedWorker 构造前检查，按 `worker-src` → `child-src` → `default-src` 回退 |
| `font-src` | 同步渲染的 `@font-face` 与 font preload 检查，按 `font-src` → `default-src` 回退 |
| `media-src` | `<audio>`/`<video>` 的资源状态检查；不允许的 URL 报告 `NETWORK_NO_SOURCE` |
| `object-src` | `<object>` 已有独立接口面，并按 `object-src` → `default-src` 识别资源限制 |
| `form-action` | 表单导航提交前检查，拒绝时不调用导航 op |
| `base-uri` | `<base>` 在文档、节点和动态资源解析路径统一检查 |

因此，Trusted Types 已不是当前实现缺口，`600010` 不能再直接归因于 TT API 或 eval 入口。
仍存在的 CSP 缺口主要是报告机制和完整语法：CSP Report-Only、violation event 尚未接入；source-list 对
端口、路径、nonce/hash（脚本 hash）等复杂语法也只是有限子集。挑战文档中的 CSP 结论应以
这份状态表为准，后续复测需重新判断 `600010` 的实际原因。

### Step 60 — 同 IP Chrome 对照通过，`/ci/` 缺失被证伪，分歧点前移到 tokenB（2026-08-16）

**假设**：当前 HEAD（CSP + Trusted Types 全套落地后）与 Chrome 的请求序列差在
「少了 `/ci/` 图片、多了 `/eb/`」，这两条差异即失败原因。

**方法**：同一时段、同一出口 IP、同一 MITM 代理，Chrome 走真实交互并导出 HAR
（`/tmp/har/zencare.co.har`，17 条）；obscura 用 `cdp_click_fast.py --start 12`
跑 3 轮，另用 `cdp_comm_probe.py` 取全 realm 通信，并单独做了 `/ci/` 图片的
load/error 探针、API 支持度扫描、`OBSCURA_WEBGL_PROFILE=1` 的 A/B、以及一次
v8 property trace。

**证据**：

1. **Chrome 通过，obscura 3/3 未通过。** Chrome HAR 末条 `POST /1.txt -> 404
   (43987B)`，即站点真实 404，符合判据。obscura 三轮终态均为 `Just a moment...`，
   `"event":"complete"` 计数为 0，CF 重发 orchestrate 换 ray。**同 IP 对照成立，
   这是 obscura 缺陷，不是 IP 信誉问题。**

2. **`/ci/` 并不缺失，该结论作废。** 图片经 render 的图像管线加载，不走
   `op_fetch_url`，因此不出现在 `stealth_fetch completed` 日志里。改用元素事件观测：

   ```
   2382|WIDGET|SRC  |<ci token 尾部>
   3660|WIDGET|LOAD |natural=48x29 complete=true
   ```

   请求发出、解码成功、尺寸正常。「日志里没有」是观测覆盖不到，不是行为差异。

3. **真正缺的是 brunhild。** Chrome 在 `/pat/` 401 之后向
   `brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/i/<ray>/<token>`
   发一条 GET fetch（HAR 里表现为两条 `CONNECT`，DevTools 里长时间 pending）。
   obscura 三轮加 WebGL 轮共 4 轮，一次都没发过。`/eb/` 恰好占据同一槽位：

   | 槽位 | Chrome | obscura |
   |------|--------|---------|
   | tokenB `/fo/` | 845776 | 822508 ~ 822652 |
   | `/pat/` | 401 | 401 |
   | 其后 | brunhild `/i/` | `/eb/…/chl_api_m` (2B) |
   | `/ci/` | 200 (196B) | 已加载（不入日志） |
   | 交互 `/fo/` | 127720 | 127712 ~ 127724 |
   | 提交 `/fo/` | 7244 | 4960 ~ 4976 |
   | 回传 `ZC/fo` | 3672 | 3256 |

   `eb` 的通道名来自 widget 内联配置 `MEjdb0: 'chl_api_m'`（Chrome 侧同样有这份
   配置却不触发），栈为 `H.<computed>` ← `Km.rD` ← `Km…[as run]` ← `rb` ←
   `Object.Akngb`，全部落在 widget 自身 bundle。载荷是 CF 自有加密，不可直读。

4. **三条假设被证伪**：

   - **CSP `connect-src` 拦截**：拦截点 `csp_connect_allows` 在 `op_fetch_url`
     **内部**（`crates/obscura-js/src/ops.rs:2712`），而 `op_fetch_url called`
     的 debug 行在其之前打印。brunhild 连这条都没有，说明 JS 从未调用 fetch，
     是分支没进去，不是被拦。（该函数确实只做精确 origin 匹配、不支持通配子域，
     这是独立缺口，但不是本现象的原因。）
   - **缺超时/中止类 API**：`AbortSignal.timeout/any/abort`、`fetch+signal`、
     `Request(init)`、`URL.parse`、`URLPattern`、`Promise.withResolvers`、
     `structuredClone`、`navigator.connection`、`reportError`、`scheduler`
     全部存在。
   - **WebGL 缺失**：`OBSCURA_WEBGL_PROFILE=1` 重跑，`/eb/` 依旧、brunhild 依旧
     缺席、大小与终态均无变化。

5. **分歧点其实更靠前。** tokenB `/fo/` 响应 obscura 稳定 822.5KB、Chrome 845.8KB，
   差约 23KB，四轮一致，不是噪声；而它前一步的 `ZC/fo` 两边都是 113.55KB，交互变体
   127.7KB 也一致。即**在拿到 tokenB 程序时 CF 已经给了 obscura 不同的程序**，其后
   的 `/eb/` 与提交体积差都是下游结果。**注意反例**：obscura 第二轮（重试）拿到的是
   845.8KB，与 Chrome 首轮同尺寸，所以尺寸不能简单等同于「可信/不可信」，只能确认
   「首轮拿到的程序不同」。

**结论（部分作废，见 Step 61）**：`/eb/` 与 brunhild `/i/` 是同一个下游症状、
`/ci/` 差异不存在，这两条成立。但「brunhild 从未被 JS 调用、不是被拦」是**错的**：
本步只 grep 了 `stealth_fetch completed`，而被 CSP 拦下的请求有 `op_fetch_url called`、
没有完成日志。Step 61 给出真因。tokenB 822.5KB vs 845.8KB 的差异属实，但它是 CSP
拦截的下游结果，不是独立的分歧点。

**附带发现（未修）**：

- **WebGL 的 fail-closed 组合自相矛盾。** `WebGLRenderingContext` /
  `WebGL2RenderingContext` 类暴露为 `function`，但 `getContext('webgl'|
  'experimental-webgl'|'webgl2'|'bitmaprenderer')` 一律返回 `null`
  （`bootstrap.js:14275` 由 `__obscura_webgl_enabled` 门控，仅在设了
  `OBSCURA_WEBGL_PROFILE` 时开）。Chrome 里这个组合只在 WebGL 被显式禁用时出现。
- **2D 上下文的 brand 不对**：`Object.prototype.toString.call(ctx)` 为
  `[object Object]`，Chrome 是 `[object CanvasRenderingContext2D]`。
- **`window` 的 error 事件字段为空**：探针收到
  `ERR|undefined @undefined:undefined`，Chrome 会给出 message/filename/lineno。

**下一步**：比对两边 tokenB `/fo/` 的**请求体**（obscura 与 Chrome 各自 POST 上去的
指纹载荷），而不是继续在 `/eb/` 槽位上找。

### Step 61 — 真因：跨 realm 用错 CSP，widget 的 fetch 被顶层文档的 `connect-src` 拦掉（2026-08-16）

**触发**（用户追问）：这跟当天下午的 CSP / Trusted Types 改动有关，此前会发 `/ci/`、
不会发 `/eb/`。到底是不是被 CSP 拦了？如果是，为什么浏览器不拦？

**方法**：把日志从「只看 `stealth_fetch completed`」改成「`op_fetch_url called` 与
completed 一起按时序列出」，再取两边的 CSP 响应头对照。

**证据 1 — 请求确实发起过，只是没有完成**：

```
CALL      POST CF/fo/…            COMPLETE -> 200 822780B
CALL      GET  brunhild.CF/i/…    (无 COMPLETE)
CALL      GET  CF/pat/…
CALL      POST CF/eb/…            COMPLETE -> 200 2B
```

`op_fetch_url` 先打 `called` 再做 CSP 检查（`ops.rs:2702` 与 `:2712`），被拦时提前
返回 `cspBlocked: true`，因此有 CALL 没有 COMPLETE。Step 60 只 grep 完成日志，
据此得出「JS 从未调用」，**结论错误**。

**证据 2 — 两份 CSP 在这一点上恰好不同**：

顶层 `zencare.co/1.txt` 质询页（403 响应头）：

```
default-src 'none'; script-src 'nonce-…' 'unsafe-eval' https://challenges.cloudflare.com;
img-src 'self' https://challenges.cloudflare.com;
connect-src 'self' https://challenges.cloudflare.com;
frame-src 'self' https://challenges.cloudflare.com blob:; …
```

widget 文档自己的 CSP（step 58 已从 Chrome 读到）：

```
… img-src 'self';
connect-src 'self' https://hagen.challenges.cloudflare.com https://brunhild.challenges.cloudflare.com;
… trusted-types GAPH2 default; require-trusted-types-for 'script'
```

CF **特意**给 widget 文档配了允许 `hagen` / `brunhild` 两个兄弟子域的 `connect-src`。

**证据 3 — obscura 取错了哪一份**：

| 路径 | CSP 来源 | 代码位置 |
|------|----------|----------|
| 图片加载 | 该节点**所属文档**的 `DocumentScope.csp` | `ops.rs:6902` `containing_document_root_shadow_including` → `document_scope(root).csp` |
| fetch / XHR | `SharedState.document_csp`，**全 page 一份** | `ops.rs:2712` |

`SharedState.document_csp` 只在**主文档**导航时写入（`page.rs:3524`）；frame 文档的
CSP 写进 `DocumentScope`（`page.rs:5678`），fetch 路径从不读它。于是 widget realm 发出的
fetch 被拿 **zencare.co 的策略**去校验。

**根因**：`0ebf07f`（feat: enforce CSP connect-src for scripted fetches）引入
`csp_connect_allows(gs.document_csp, …)`，把**页面级**的 CSP 应用到**所有 realm**。
对 brunhild：

- 目标 origin = `https://brunhild.challenges.cloudflare.com`
- 传入的 `page_origin` = widget 自身 origin `https://challenges.cloudflare.com`
- 顶层策略里 `'self'` 不匹配，显式项 `https://challenges.cloudflare.com` 也不匹配
- → 拦截

**为什么浏览器不拦**：Chrome 按规范用**发起请求的那个文档**的 CSP。widget 文档的
`connect-src` 明确列了 brunhild，因此放行。这不是通配子域匹配的问题——widget 的策略是
逐个主机写死的；obscura 只是用错了策略。

**为什么 `/ci/` 没受影响**：图片路径本来就按文档 scope 取 CSP，而且 `/ci/` 在
`challenges.cloudflare.com` 上，对 widget 是 `'self'`、对顶层是显式项，两份策略都放行。
所以它在这次改动前后都正常，也解释了「以前发 ci、现在还发 ci」。

**下游链条**：brunhild `/i/` 被拦 → widget 侧该步失败 → 走 `/eb/…/chl_api_m` 上报
（Chrome 全程不发）→ 后续 tokenB 程序、提交体积（4976 vs 7244）与
`fail code=600010` 都是这一拦截的下游结果。

**结论**：`600010` 的当前直接成因是 **CSP 的 realm 归属错误**，不是 Trusted Types，
也不是指纹面。

**修法**：fetch 路径要拿发起 realm 所属文档的 CSP，而不是 `SharedState.document_csp`。
钩子已经现成：frame realm 在 bootstrap 之前就定义了 `__obscura_frame_document_nid`
（`realm.rs:763`），可以像图片路径那样用它取 `DocumentScope.csp`；主 realm 回退到
现有的页面级值。同一处还应顺带修 `csp_connect_allows` 的两个已知子集缺口：不支持
通配主机（`*.example.com`），不处理端口与路径。重定向路径（`ops.rs:3211`、`:3617`）
用的是同一份 `document_csp`，要一并改。

**修复状态（2026-08-16）**：见 Step 62。`feat: use frame CSP for scripted fetches`
只完成了 Rust 侧与一部分调用点，`fetch`/XHR 这条路径当时并没有带上 root，因此实测
毫无变化；补齐后才生效。

### Step 62 — CSP realm 修复补齐并实测生效；`/eb/` 另有成因（2026-08-16）

**背景**：Step 61 定位的真因（fetch 用页面级 CSP 校验 frame realm 的请求）由
`31e86b4 feat: use frame CSP for scripted fetches` 首次尝试修复，但**实测无任何变化**：
brunhild 依旧只有 `op_fetch_url called`、没有完成，`/eb/` 照发。

**漏掉的那一处**：该提交只把 `root` 加进 `_environmentReferrerContext()`。四个
`op_fetch_url` 调用点里，只有 classic script（`bootstrap.js:377`）、stylesheet（`:626`）
和 service worker（`:12736`）走这个函数；**`fetch` 自己在 `:7923` 内联拼 context**，
而 XHR 的底层就是它。于是 `root` 缺失 → Rust 侧 `request_root = NodeId::new(0)` →
命中 `raw() == 0` 分支 → 回退 `SharedState.document_csp`，与修复前完全等价。

realm 侧的钩子本身是好的，单独验过：

```
[nid] WIDGET nid=69 type=number href=https://challenges.cloudflare.com/…
[nid] TOP    nid=undefined type=undefined href=https://zencare.co/1.txt
```

**补齐**：抽出 `_environmentDocumentRoot()` 作为单一来源，`_environmentReferrerContext()`
与 `fetch` 都用它，注释写明「每个 op_fetch_url 调用点都必须带上，漏掉会静默退回顶层策略」。

**插桩**：被 CSP 拦下的请求此前不留任何痕迹（有 `called`、无完成），读起来和「请求还在飞」
一模一样，这正是 Step 60 归因错误的直接原因。现在 `op_fetch_url` 在拦截时打一行
debug，带上 url / origin / root / 实际生效的 csp。

**实测（3 轮，带点击）**：

| 观测点 | 修复前 | 修复后 |
|--------|--------|--------|
| `blocked by connect-src` 记录 | brunhild 每轮被拦 | **0 次 / 3 轮** |
| brunhild `/i/` | 提前返回，无完成 | 发出并保持在飞（与 Chrome 的 pending 一致）|
| `/eb/` | 每轮发出 | **仍每轮发出** |
| 提交 `/fo/` | 4976B | 4976 ~ 5052B（Chrome 7244）|
| 终态 | 未通过 | **仍未通过** |

**结论**：CSP 的 realm 归属缺陷已修复并有回归测试
（`runtime.rs::a_subframe_fetch_uses_its_own_document_csp_rather_than_the_pages`，
去掉修复即 FAIL）。但 **`/eb/` 不是它的下游症状**——brunhild 不再被拦之后 `/eb/` 照发，
Step 61 中「brunhild 被拦 → widget 上报 `/eb/`」这条因果链**证伪**。

**一处需要收回的读数**：修复后第 1 轮 tokenB `/fo/` 为 845784，与 Chrome 的 845776 对上，
当时据此说「已对齐」；第 2、3 轮是 822704 / 822832。**单轮采样不成立**，两种尺寸都会出现，
tokenB 差异仍是未解释项。

**未决**：①`/eb/` 的真实触发条件（Chrome 全程不发）；②提交体积 4976/5052 vs 7244；
③`csp_connect_allows` 仍不支持通配主机、端口与路径。

### Step 63 — `/ci/` 确实被 CSP 拦了：指令优先级写反；同时推翻 Step 61 的根因（2026-08-16）

**触发**（用户）：先查 iframe 里的 `/ci/` 图片为什么没发出，这是下午 CSP + Trusted Types
落地后才有的；是 CSP 拦了，还是 TT 让 JS 没执行？

**先排除 TT**：在每个 realm 里实测 `eval('1+1')`，全部返回 `2`；widget realm 的
`trustedTypes.defaultPolicy` 存在（`tt=object/default`），与 Chrome main world 一致。
JS 正常执行，`/ci/` 的 `img.src` 也确实被赋值。**不是 TT。**

**是 CSP，且是指令优先级写反**。给图片路径补一行拦截日志后直接拿到：

```
image blocked by img-src: https://challenges.cloudflare.com/…/ci/…
  csp-origin: https://challenges.cloudflare.com
  csp       : default-src 'none'; …; img-src 'self'; …
```

`img-src 'self'` 明确允许这个同源请求。真因在 `csp_resource_allows`：它把「具体指令」与
「`default-src` 回退」放进**同一次 `find_map` 扫描**

```rust
(name == directive || (directive == "img-src" && name == "default-src"))
```

于是**谁在 header 里排得靠前谁生效**。而 `default-src 'none'` 按惯例写在最前面，
`img-src` 根本读不到，等于把所有资源指令变成 `'none'`。同一 header 下
`zencare.co/favicon.ico` 也被误拦。受影响的是全部走这个函数的指令：`img-src`、
`style-src`、`media-src`、`object-src`、`font-src`。`csp_connect_allows` 写法是对的
（先找 `connect-src`，再 `or_else` `default-src`），JS 侧的 `_cspResourceAllows` 也对
（命中具体指令即 `break` 覆盖），所以只有 Rust 这一处。

**修法**：抽出 `csp_sources(header, directive)` 只查一个指令，具体指令优先、
`default-src` 仅作回退；并用 `csp_falls_back_to_default` 排除 `base-uri`、`form-action`、
`frame-ancestors`（规范里这些文档指令没有 `default-src` 回退，原实现顺带给错了）。
回归测试 `ops.rs::a_specific_directive_replaces_default_src_whatever_the_header_order`。

**同轮修掉的另外两处 CSP 缺陷**：

- **顶层文档的 CSP 从未进入 JS runtime。** `page.rs` 在读到响应头时执行
  `if let Some(js) = &self.js { js.set_content_security_policy(...) }`，但那一刻 runtime
  还没建（`init_js()` 在其后），所以是空操作。页面侧的 `script-src`/`style-src` 在
  page.rs 内判定，因此看起来正常；单元测试又都直接调 `set_content_security_policy`，
  于是这个洞一直没被发现。改为在 `init_js()` 里安装，覆盖全部 9 个调用点。回归测试
  `page.rs::a_documents_connect_src_reaches_scripted_fetches`。
- **`about:blank` / `about:srcdoc` 子框架不继承创建者的 CSP**（`page.rs` 两处硬编码
  `None`）。本地 scheme 文档没有自己的响应头，规范要求继承；不继承等于给子框架一份比
  父文档更宽松的策略。

**推翻 Step 61 的根因认定**。Step 61 把「brunhild 有 `op_fetch_url called`、没有完成日志」
判成被 CSP 拦截。补上显式拦截日志后实测：**0 次拦截，brunhild 依然是 CALL 无 COMPLETE**。
那个特征同样是**长轮询在飞**的样子，与 Chrome 里它长期 pending 完全一致。也就是说
brunhild 从来没有被拦过，Step 61 的因果链不成立——它是在「测量盲区」表里已经写下的那条
教训上，往反方向又栽了一次：不能用日志缺失反推行为，必须让被判定的分支自己发声。

**顺带解开一个老谜题**：给 fetch 日志加上 `root=` 与生效策略来源后可见

```
root=69 csp=frame       POST CF/fo/…      root=69 csp=frame  POST CF/eb/…
root=0  csp=page:none   GET  CF/pat/…     root=0  csp=page:none GET brunhild.CF/i/…
```

`/pat/` 与 brunhild 来自一个**独立 runtime**（widget CSP 里有 `worker-src blob:`，即
CF 的 blob Worker）。这解释了为什么它们一直躲开页面各 realm 的 JS 钩子，也解释了
step 45/46 里「`/pat/` 从未被 JS 构造」的假象。**Worker 不继承创建文档的 CSP**，是新的
已知缺口。

**实测结果（3 轮，带点击）**：`/ci/` 恢复加载（`LOAD 98x68`），CSP 拦截 0 次，链路完整
（822.7KB → `/pat/` 401 → `/eb/` → 127.7KB → 提交 4960~5000B → 回传 3256B），
**仍未通过**，`/eb/` 仍每轮发出。全量 1624 测试通过。

**未决**：①`/eb/` 的触发条件（Chrome 全程不发）；②提交体积 4960/5000 vs Chrome 7244；
③Worker 不继承 CSP；④`csp_connect_allows` / `csp_resource_allows` 仍不支持通配主机、
端口与路径。

### Step 64 — `/eb/` 的成因：Trusted Types 默认策略的返回值判定写反（2026-08-16）

**触发**（用户）：`/eb/` 在真实浏览器里不会发送，它也是今天 CSP + TT 改动之后才出现的。

**定位**：`/eb/` 是 error beacon，widget 捕获到异常才发。今天的
`a6e6e55 feat: enforce Trusted Types script sinks` 给 `innerHTML`、`srcdoc`、
script 的 `text`/`textContent` 装上了 sink 强制。widget 文档的 CSP 恰好带
`require-trusted-types-for 'script'`，且 CF 自己建了 `default` 策略（实测该 realm
`trustedTypes.defaultPolicy` 存在），所以这条路径每次赋值都会走到。

**真因**（`bootstrap.js` 的 `_enforceSink`）：

```js
const converted = rule(String(value));          // rule 是用户回调，返回字符串
if (_isKind(TrustedHTML, converted)) { ... }    // 却要求它返回已加壳的对象
throw new TypeError(...);                       // 于是必然走到这里
```

按规范，策略回调返回的是**普通字符串**，加壳是策略的职责——同文件的
`_policyFactoryMethod` 正是这样做的：`_mint(ctor, callback(String(input)))`。
`_enforceSink` 直接调原始回调再用 `_isKind` 检查那个字符串，结果恒为假，
**只要文档要求 TT 且存在默认策略，每一次 sink 赋值都抛 TypeError**。CF 捕获后上报
`/eb/`。Chrome 接受回调的字符串返回，因此从不发这条。

原有的 TT 测试没能发现它，因为那个用例只赋值 `policy.createHTML(...)` 的**已加壳**结果，
从未走过「默认策略接收原始字符串」这条唯一需要该分支的路径。

**修法**：只在回调返回 `null`/`undefined` 时拒绝，否则取其字符串返回值。回归测试
`runtime.rs::a_default_policy_converts_plain_strings_at_trusted_type_sinks`，覆盖
`innerHTML` 与 `srcdoc` 两个 sink 并断言转换确实生效。

**实测（3 轮，带点击）**：`/eb/` **3 轮全部消失**，请求序列与 Chrome 在该槽位同形：

```
ZC/orchestrate → ZC/fo → api.js → CF/fo(822.6~845.9KB) → CF/pat 401
  → CF/fo 127720 → CF/fo 4976~5052 → ZC/fo 3256 → 重发 orchestrate
```

**仍未通过。** 提交体积 4976/5052 与 Chrome 的 7244 仍有差距，`complete` 仍为 0。
tokenB 三轮分别是 822572 / 845644 / 845884，两种尺寸都出现，仍不能说已对齐。

**教训**：本轮三条 CSP/TT 缺陷（指令优先级、顶层策略未进 runtime、默认策略返回值）
有一个共同点——**它们各自的单元测试都通过**，因为测试构造的是「策略已加壳」「直接调
set_content_security_policy」这类**绕开真实路径**的输入。规范类特性的测试必须走用户
代码真正会走的那条路，否则通过率与正确性无关。

### Step 65 — 对照参考实现补齐两处 TT 差异：`script.src` sink 与默认策略回调参数（2026-08-16）

**触发**（用户）：与 `HaHaVM-General`（Node vm 补环境框架，抽离自 CF 专用引擎）的
CSP / Trusted Types 建模逐条对比。

**路线差异（不是缺陷，记录以便判断哪些能借鉴）**：该框架**完全不解析 CSP 响应头**
（全库 grep `content-security-policy` 零命中），CSP 与 TT 全靠硬编码与启发式：
`trustedTypesEnforced` 由「页面调用过任意 `createPolicy`」置位（`envFunc.js:8480`），
子帧是否拦 `eval` 由 `outGlobal.name === "iframe"` 这一个字符串决定。obscura 按真实响应头
执行，这几处更接近真机；其 `createHTML`/`createScriptURL` 返回**原始字符串**而非加壳对象
（`envFunc.js:8489-8494`）也是为迁就自身 cheerio DOM，Chrome 三者都返回 `Trusted*` 对象。

**借鉴并修复的两处**：

1. **`script.src` 从来不是 sink。** obscura 的 `__obscura_tt_enforce` 五个调用点全是
   `TrustedScript`/`TrustedHTML`，**没有一个 `TrustedScriptURL`**，因此默认策略的
   `createScriptURL` 永远不会被调用。参考实现专门接了这条（`envFunc.js:4846`），注释写明
   用途是「对齐 XyfR4 位掩码(createHTML=1, createScript=2, createScriptURL=4)」——即 CF
   会统计**哪几个默认策略回调被触发过**。已在 `src` 反射器里按 `localName === 'script'`
   接入（图片、iframe 的 `src` 不是 sink，不能一并路由）。

2. **回调参数少传了 sink 名。** 规范与 Chrome 传 `(input, expectedType, sink)`，`sink` 是
   `"Element innerHTML"` 这类字符串；策略允许据此分支，而仅凭值无法分辨。step 64 的修复
   只传了 `(value, kind)`。已补全，五个 sink 分别给出 Chrome 的名字：`Element innerHTML`、
   `HTMLScriptElement textContent`、`HTMLScriptElement src`、`HTMLIFrameElement srcdoc`。

**顺带收敛的一处重复触发**：`script.text` 委托给 `textContent`，而后者本身也是 sink，
两层都强制会让一次赋值触发两次策略（Chrome 只触发一次）；且中间的 `String(v)` 会把调用方
已经加壳的 `TrustedScript` 打回字符串再转换一次。改为只由 `textContent` 这一层强制，
中转不做 stringify。

**回归测试**：`runtime.rs::sinks_hand_the_default_policy_the_expected_type_and_the_sink_name`
（断言四个 sink 的 `(rule, expectedType, sink)` 三元组，并断言 `img.src` **不**进策略）、
`runtime.rs::assigning_script_text_runs_the_default_policy_once`（断言调用次数为 1，
且已加壳的值不被二次转换）。

**实测（3 轮，带点击）**：CSP 拦截 0、`/eb/` 0、链路完整、无回归，**仍未通过**；
提交体积 4976~5016 对 Chrome 的 7244 仍有差距。全量 1627 测试通过。

**未采纳（需先取证）**：参考实现在 srcdoc / about:blank 子 realm 里**强制**字符串 `eval`
抛 Chrome 文案的 `EvalError`（`envFunc.js:8447`），注释称 CF 用
`iframe.contentWindow.eval('this')` 做跨 realm 身份探测并依赖该抛错回退父 realm 值。
obscura 实测这两个 realm 里 `eval('1+1')` 返回 `2`。**但真机 Chrome 是否在那里抛未验证**：
obscura 现在让 srcdoc 继承父文档 CSP，而 widget 的 CSP 含 `'unsafe-eval'`，按继承语义就不该
抛；参考实现的说法则暗示该子帧实际是 nonce-only。两次在 Chrome 上取证都被 CF 反复重建
iframe 打断。**照抄一个「强制抛错」会在真机不抛时制造新的可检测矛盾，故先不做。**

### Step 66 — 首次拿到明文提交载荷：逐字段对拍锁定 9 类差异（2026-08-17）

**换了目标站与观测面。** 目标 `https://www.thelancet.com/1.txt`（同一套 managed 质询），
观测面是 `http://192.168.3.57:9000` 上的 MITM 代理：它改写了 CF 的挑战脚本，在提交前把
构造好的载荷对象以 `console.log("payloadJSON: " + ...)` 打出来。obscura 把所有 realm 的
console 汇进 serve 日志，所以一次 `LC_ALL=C grep` 就能拿到**解密后的完整提交体**——
这是 step 56 以来一直只能量到「体积差 2.3KB」的那条链路，现在可以逐字段读。
浏览器侧参照是 `/tmp/har/json/{1,2,3}.json`（同一代理下 Chrome 149/macOS 的三次提交）。

代理 CA 与本机 Reqable 的 CA 不同（`Apr 4, 2026, 0D1CEBE3` vs `Sep 30, 2025, B5DB6D9D`），
直接 `curl http://192.168.3.57:9000/ca` 取到 PEM 后用 `SSL_CERT_FILE` 指过去即可。

**假设**：提交体的体积差来自若干具体环境面缺失，而不是整体结构不同。

**方法**：

```bash
curl -s http://192.168.3.57:9000/ca -o /tmp/reqable-remote-ca.crt
SSL_CERT_FILE=/tmp/reqable-remote-ca.crt OBSCURA_ALLOW_PRIVATE_NETWORK=1 \
  RUST_LOG=obscura_js=debug,info \
  ./target/release/obscura serve --port 9223 --proxy http://192.168.3.57:9000 --stealth
# 点击探针必须是无注入版本，理由见下面的「证据 0」
uv run --with websockets python /tmp/clean_click.py https://www.thelancet.com/1.txt --port 9223
```

**证据 0（先作废一轮数据）**：第一轮用的是 `cdp_click_fast.py`，它的 PRELOAD 会包装
`Element.prototype.attachShadow` 并定义 `__roots`/`__pm`/`__t0`。CF **两个面都读**：

- `YIjU8` 字段第 8 项本该是 `"function attachShadow() { [native code] }"`，那一轮里是
  `"function(i){var r=a.apply(this,arguments);try{window.__roots.push(r);}catch(e){}return r;}"`
- 全局枚举字段 `fyCZH9` 里多出 `o.__pm` / `o.__roots` / `o.__t0`

也就是说**探针本身把自己写进了指纹**。改用无注入探针后 `YIjU8` 恢复原生文案。
以下结论一律取自无注入轮次；只有点击后模块（浏览器 `3.json` 对应项）暂无干净样本，
已在对应条目标注。

**证据 1（体积构成）**：把载荷摊平成「字段 → 序列化字节数」再相减，
2.json（tokenB 载荷）总量 browser 68342 / obscura 41017，差额集中在 9 个字段：

| 字段 | browser | obscura | 含义 |
|------|---------|---------|------|
| `fyCZH9` | 30881 | 15078 | 全局属性枚举（见证据 2） |
| `YIwy3` | 7277 | 2 | WebRTC SDP offer → `""` |
| `EnxW1` | 2293 | 8 | WebGPU adapter/limits/features → 错误码 `"nJJze9"` |
| `DrTW4` | 1465 | 2 | ICE candidates → `[]` |
| `ZpxzX5` | 1273 | 7 | RTP send/recv capabilities → `[[],[]]` |
| `FgjO3` | 1246 | 7 | WebGL 扩展列表 → 错误码 `"Mylp5"` |
| `QCEE0` | 843 | 缺失 | 120 项特性探测数组，整个模块不存在 |
| `CPWA9` | 613 | 7 | WebGL 采样点 → 错误码 `"WbDj2"` |
| `Swui9` | 596 | 2 | `navigator.keyboard.getLayoutMap()` → `{}` |

同族的还有 `WLCCn2`/`ZlnsY8`/`ULOAc2`/`qbitp7`/`bhWNV6`/`KbSE2`，obscura 一律回一个
6 字符 token（`"UdMJ8"`、`"TsxTy8"`、`"dRVOa5"`、`"EXir7"`、`"jCHa2"`、`"HMMge1"`）。
这些是 CF 的**错误哨兵常量**，等价于「该探测抛了/不可用」。浏览器那边是完整的
WebGL2 参数表、`["WebKit","WebKit WebGL"]` / `["Google Inc. (Apple)", "ANGLE (...)"]`
供应商对、以及两个哈希。**WebGL 在 obscura 上是 fail-closed，CF 明确记到了。**

**证据 2（全局面只有 Chrome 的一半）**：`fyCZH9` 是「属性路径 → 值分组」的倒排表。
把它拍平成属性集合：**browser 1666 项，obscura 861 项，缺 1284、多 479。**
缺的整块是 Web API 构造器（`AudioNode`/`CSS*`/`Sensor`/`Bluetooth*`/`WebGPU*` …）。
多出来的按前缀分：`o.` 467、`d.` 5、`s.` 4。其中：

- `d._body` / `d._head` / `d._root` / `d._url` / `d._iframeEl`
- `s._availH` / `s._availW` / `s._h` / `s._w`
- `o.__currentScriptNid` / `_url`

**这些是 bootstrap.js 的内部字段，作为可枚举自有属性暴露在 `document`/`screen`/`window`
上。** 直接实测确认：

```
Object.getOwnPropertyNames(document) === ["_nid"]      # Chrome: []
Object.keys(screen)  含 _w/_h/_availW/_availH          # Chrome: []（全在 Screen.prototype）
Object.getOwnPropertyNames(Object.getPrototypeOf(globalThis)).length === 1   # Chrome: 数百
Object.getOwnPropertyNames(globalThis).length === 496  # Chrome ≈ 1238
Object.keys(globalThis).length === 339                 # Chrome ≈ 28
```

最后一行是遍历前缀分布倒挂的根源：browser 的 `<bare>`(window 自有) 1238 / `o.` 28，
obscura 是 305 / 493。**obscura 把本该挂在 `Window.prototype` 上的成员全铺在全局对象
自身，且大量是可枚举的**，于是 CF 的「意外全局」清单里 obscura 有 493 条、Chrome 只有 28 条。

**证据 3（身份面自相矛盾 + 不可能的机器）**：

| 面 | browser | obscura |
|----|---------|---------|
| `navigator.userAgent` | Chrome/149.0.0.0 macOS | Chrome/**145**.0.0.0 Windows |
| CDP `/json/version` 的 `User-Agent` | — | Chrome/**146**.0.0.0 |
| `userAgentData.brands` | Chromium 149 | Chromium/Google Chrome **145** |
| `navigator.appName` / `appCodeName` | `Netscape` / `Mozilla` | **undefined** |
| `document.designMode` | `off` | **undefined** |
| `innerWidth`/`innerHeight` | 0 / 0（隐藏帧） | **300 / 150** |
| `outerWidth`/`outerHeight` | 1200 / 1120 | **300 / 150** |

CDP 报 146、页面报 145，是同一个二进制内部的版本不一致。字体列表 `gqGB4` 更直白：
Chrome 报 6 个（`Apple Symbols`/`Galvji`/`Geneva`/`InaiMathi Bold`/`Luminari`/`PingFang HK Light`），
obscura 报 48+ 个，**同时**包含 Windows（`Bahnschrift`/`Segoe Fluent Icons`/`Gadugi`/
`Ink Free`/`Nirmala UI`）、Linux（`Adwaita`/`DejaVu`/`Liberation`/`Cantarell`/`KacstOne`）
和 macOS（`Skia`/`Geneva`/`PingFang HK Light`）三套字体——一台不可能存在的机器。

**证据 4（obscura 主动多报的东西）**：

- `PvWp9`：`"TypeError: Cannot read properties of null (reading 'innerHTML')"`。
  该字段在浏览器载荷里根本不存在，obscura 把一条真实异常报了上去。
- `QvHgQ8`：browser `[]`，obscura 是几百个数字下标；`ldcgI8`：browser `[159,163]`，
  obscura 71 个下标。两者都是「第几项探测偏离预期」的清单。
- `tjDL4`：browser 是 18 个短哈希（`"2287fef"` …），obscura 是 18 条未经处理的
  `"function hasOwnProperty() { [native code] }"` 原文。
- `sxjgT3`（探测调用轨迹）：browser 是 `sqpVk4/rWUVg7`（开始/完成）成对的长序列，
  obscura 大量位置是 `wNEIG0`——与 console 里那条 `%c%d font-size:0;color:transparent wNEIG0`
  同一个哨兵，即该子探测走了异常分支。
- `JWcE1`（PerformanceObserver 条目）：browser 有 navigate / first-paint /
  first-contentful-paint / 多条 resource（`dHCMz9:"h2"`），obscura 只有 2 条，
  且 `dHCMz9:""`（nextHopProtocol 为空）。**呼应「未决」里的 frame 缺 navigation timing。**

**证据 5（点击这一环，数据来自受污染轮次，仅作方向）**：

| 字段 | browser | obscura |
|------|---------|---------|
| `QVZJq9.rRXx6` / `.rdJQ0` | `"1.5707963267948966"` / `"0"` | `"undefined"` / `"undefined"` |
| `dvBBM0.FkSaJ9.ViwxY3` | 多条指针采样 | 1 条 |
| `EgwZP5` | `false` | `true` |
| 顶层 `jWOLY8` | 2.json=0 → 3.json=**1** | 2.json=0 → 3.json=**0** |

`1.5707963267948966` 是 π/2，配合 `0`——正是 Chrome 上鼠标类 `PointerEvent` 的
`altitudeAngle`/`azimuthAngle` 默认值，obscura 的 PointerEvent 没有这两个属性。
`jWOLY8` 在浏览器提交后翻成 1、在 obscura 保持 0，是目前**唯一一个能直接读到的
「这次交互没被认可」的标志位**。

**结论**：

1. 体积差不是单一原因，是 9 类环境面同时缺失/报错。按字节从大到小：全局面残缺、
   WebRTC 全空、WebGL/WebGPU fail-closed、`QCEE0` 模块缺席、键盘布局表空。
2. 比缺失更致命的是**矛盾**：三个 Chrome 版本号、三套操作系统的字体、
   `document._nid` / `screen._w` 这类引擎内部字段、以及一条真实的 `TypeError` 被上报。
   缺一个 API 只是「老浏览器」，同时出现三套 OS 字体是「伪造」。
3. `Window.prototype` 几乎为空、成员全部铺在全局自身且大量可枚举，是 `fyCZH9`
   差异的结构性根源，一处改动能同时收敛 `o.` 多报（493→个位数）与部分分组错位。
4. 本轮仍未通过：标题始终停在 `Just a moment...`，`jWOLY8` 保持 0。

**下一步**（按性价比）：先修矛盾类——统一 UA/UA-CH/CDP 三处版本号、按宿主 OS 裁剪
字体列表、把 `_nid`/`_w`/`_body` 等内部字段改为不可枚举或 Symbol 键、查 `PvWp9` 那条
`innerHTML` 空指针。再考虑补面：`Window.prototype` 归位、PointerEvent 的
`altitudeAngle`/`azimuthAngle`、`navigator.appName`/`appCodeName`/`document.designMode`。
WebRTC 与 WebGL 是大工程，放最后。

### Step 67 — 修 1.json：`yQYB9` 缺失的三个成因，resource timing 补齐（2026-08-17）

**假设**：1.json 里唯一属于引擎缺陷的差异是 `yQYB9` 整个字段缺失（浏览器 2 条），
其余（`kytBC0`/`WAiB1`/`XNan0` 时长、`NWUB3`/`gAMzq7`/`xRRo8`/`DoKk0` 计数）是页面
差异——浏览器那份 HAR 抓的是 `/123.txt` 上的 `__warm_fiddle__` 测试页
（`HsMRH3` = `api.js?render=explicit`、`FELcX1` 栈里有 `fiddle-client.js`），
DOM 规模本来就不一样，不能拿来当引擎判据。

**方法**：直接读页面 realm 的 `performance.getEntriesByType('resource')`，
不经过 CF：

```bash
uv run --with websockets python /tmp/res_probe.py https://www.thelancet.com/1.txt
```

**证据（修复前）**：只有 3 条，全是 favicon 与一条 fetch。缺 api.js（脚本）、
缺 widget iframe 文档；且 `transferSize === encodedBodySize`、`nextHopProtocol` 为空。
浏览器那 2 条分别是 widget 文档（`aelS9` 94838 / `Zcgk7` 94538，**差 300**）与
api.js（跨源无 TAO，`QUyj4`/`aelS9`/`Zcgk7` 全 0）。

**三个独立成因**：

1. **动态插入的 `<script src>` 不记条目。** `__fetchDynClassicScript` 直接调
   `op_fetch_url` 后就把 body 交出去了，从不落 Performance 条目。解析器插入的脚本
   走 page.rs:2058 有记，动态的没有——而质询页的 api.js 正是动态插入的。
2. **子框架文档不记条目。** `navigate_frame_inner` 里的
   `fetch_document_with_method_referrer` 没有配套的 `record_performance_response`。
   补上之后仍然不出现，因为——
3. **`load_child_frames()` 跑在 `init_js()` 之前**（page.rs:3622/3623）。init_js 会
   **替换整个运行时**，所以子框架加载期间记进去的条目连同那个运行时一起被丢弃。
   这与 step 63 的「顶层 CSP 到不了运行时」是同一类错误：**在运行时被替换之前
   往运行时里写东西**。同理 `navigate_frame_for_cdp` 会把 DomTree 从运行时借出来，
   借出期间也不该对它执行脚本。

**修复**：
- bootstrap.js 抽出 `_recordFetchResourceTiming()`，三处调用点（fetch / 动态脚本 /
  图片）共用同一份 TAO 判定与相位时间戳；动态脚本新增条目，`initiatorType: 'script'`。
- `transferSize = encodedBodySize + 300`（响应头字节，Chrome 实测就是这个常数），
  `nextHopProtocol` 按 scheme 给 `h2` / `http/1.1`，TAO 被拒时才是 `''`。
  参考实现同样是 `bodySize ? bodySize + 300 : 0`（`toolsFunc.js:1491`）。
- page.rs 给子框架文档记 `initiatorType: "iframe"` 条目；新增
  `deferred_performance_entries` 缓冲与 `performance_entries_deferred` 深度计数，
  在「运行时还没建好」和「DomTree 借出中」两个窗口里缓冲，窗口结束后按序回放。

**修复后（同一页面，同一探针）**：

```
script  .../orchestrate/chl_page  ts=228808 eb=228508 p=h2
script  .../turnstile/v0/g/.../api.js  rs=0 ts=0 eb=0 p=""     ← 与浏览器 api.js 条目形状一致
img     /favicon.ico              ts=6274  eb=5974  p=h2
fetch   .../challenge-platform/h/g/fo/  ts=113852 eb=113552 p=h2
iframe  .../turnstile/f/av0/rch/...                            ← 新增
```

CF 载荷侧：1.json 的 `yQYB9` 从缺失变成 1 条（api.js，`QUyj4`/`aelS9`/`Zcgk7` 全 0，
与浏览器同形），2.json 从 1 条变成 3 条（api.js + `/fo/` + `/ci/`，浏览器 4 条）；
`JWcE1` 的 `dHCMz9` 从 `""` 变成 `"h2"`；所有 `transferSize - encodedBodySize` 都是 300。

**回归测试**：`a_dynamic_script_files_a_resource_timing_entry`、
`resource_timing_transfer_size_covers_the_response_headers`（obscura-js）、
`a_subframe_document_load_lands_in_the_parents_resource_timeline`（obscura-browser，
已验证在缓冲修复前失败：`left: Null`）。

**仍未对齐（记录，非本步范围）**：`DCkwl7` 130 vs 1952 是 widget 文档的加载时长，
obscura 更快；`NWUB3`/`WpIu5` 28 vs 1849 等计数属于页面差异。要拿这些当判据，
必须换成同一个 URL 的浏览器 HAR。

### Step 68 — `fyCZH9` 的枚举语义查清：`for..in` ∪ 自有属性名；引擎内部字段全部下线（2026-08-17）

`fyCZH9` 是 2.json 里最大的一个字段（Chrome 30881 B / obscura 14187 B）。它是
一张「属性路径 → 值」的倒排表，路径带前缀 `d.` `n.` `s.` `so.`，以及不带前缀的一批。

**先确定它到底在枚举什么。** 用本地探针逐一比对计数（`obscura fetch --eval`，
建一个隐藏 iframe 再走它的 `contentWindow`）：

| 对象 | `Object.keys` | `for..in` | 载荷里的条数 |
|------|---------------|-----------|--------------|
| screen | 9 | 9 | **9** |
| screen.orientation | 5 | 5 | **5** |
| document | 13 | 13 | **12** |
| navigator | 25 | 38 | **37** |

`for..in` 全中，`Object.keys` 在 navigator 上差 13——**枚举是 `for..in`**。
但修完可枚举性后载荷里 `s.` 是 18 而本地 `for..in` 只有 14，多出的正是
`_w/_h/_availW/_availH`：**它同时读 `Object.getOwnPropertyNames`**。
所以把内部字段改成 `enumerable: false` 不够，必须让它**根本不是字符串键的自有属性**。

**三个成因**：

1. **WebIDL 成员必须可枚举，ES class 的原型成员不可枚举。** 这一条差异就解释了
   `for (const k in document)` 在 obscura 是 13、Chrome 是 295。Chrome 的
   `d.` 列表里明确有 `onclick`、`addEventListener`、`querySelector`。
   bootstrap.js 里原本还有一处反向的注释（「在 Document 和 Element 上设成
   不可枚举，免得在 `for..in` 里冒出来」）——与 Chrome 正好相反。
2. **引擎内部字段是自有字符串属性。** `screen._w/_h/_availW/_availH`、
   `_IframeDocument` 的 `_url/_iframeEl/_root/_head/_body/_title`、
   `_IframeWindow._url`、以及动态脚本跑过之后才出现的 `__currentScriptNid`。
   浏览器里 `Object.getOwnPropertyNames(screen)` 是**空数组**——Screen 的每个成员
   都是原型访问器。
3. **`screen.orientation` 是个对象字面量**，只有 5 个成员（Chrome 9），
   `lock`/`unlock`/`onchange` 直接不存在。

**修复（全部在 bootstrap.js）**：

- 文件开头快照一次 `Object.getOwnPropertyNames(globalThis)`，那就是 ECMAScript
  内置；文件末尾对**所有不在快照里的全局构造器**的原型做一遍
  `enumerable = true`（`constructor` 除外，WebIDL 同样保持不可枚举）。
  快照法避免了手工维护一张 300 个名字、必然过期的清单。
  `_IframeDocument.prototype` 不挂在全局上，单独补一次。
- `Screen` 的全部状态收进一个 Symbol 槽，`colorDepth`/`pixelDepth`/`availTop`/
  `availLeft`/`orientation` 从自有数据属性改成原型访问器，补
  `isExtended`/`onchange`/`addEventListener`/`removeEventListener`/`dispatchEvent`。
- 新增真正的 `ScreenOrientation` 类，补 `lock`（按 Chrome 抛
  `NotSupportedError`）/`unlock`/`onchange`。
- `_IframeDocument` 同样收进 Symbol 槽，`nodeType`/`readyState`/`characterSet`
  等从自有数据属性改成原型访问器，并补 `designMode`。
- iframe 元素上的 `_iframeDoc`/`_iframeWin` 改用 WeakMap（元素在浏览器里没有
  任何自有属性）。
- `navigator.appName`/`appCodeName`/`vendorSub` 与 `document.designMode` 补齐——
  它们此前读作 `undefined`，是没有任何浏览器会产生的值。

**结果（同一探针、同一目标站）**：

| | Chrome | 修复前 | 修复后 |
|---|---|---|---|
| `d.` | 295 | 12 | **43** |
| `s.` | 15 | 9 | **14** |
| `so.` | 9 | 5 | **8** |
| `n.` | 81 | 37 | **39** |
| 内部字段泄漏 | 0 | **11 条** | **0** |

**仍未对齐（下一步的根因，已定位）**：`<bare>` 305 vs 1238、`o.` 493 vs 28
都出自同一个东西——**动态创建的 iframe 在 Rust 帧加载器提交之前，
`contentWindow`/`contentDocument` 返回的是 bootstrap.js 里的
`_IframeWindow`/`_IframeDocument` 兼容垫片**（page.rs 的 `about:blank` 分支是
异步排队的，而 CF 是同步读的）。垫片的 window 只有约 25 个自有属性、没有原型链，
所以「干净 realm 的全局名单」只有 305 个，而顶层真实 window 比它多出 493 个——
Chrome 那一栏 28 全是页面自己加的全局。把 `about:blank` 子帧接到真实 realm 上
（代码里标为 Phase 3.5 unification）才是这一项的解。

另记：`Object.getOwnPropertyNames(anyElement)` 仍会列出约 30 个 `_` 开头的
内部字段（`_nid`/`_lname`/`_treeParent`/…），Chrome 是空数组。本轮 CF 没有走到
这一面，但属同一类问题。

### Step 69 — `YIwy3` / `DrTW4`：SDP offer 与 ICE 候选（2026-08-17）

**现状**：`RTCPeerConnection` 是个纯壳，`createOffer()` 返回 `{type:'offer', sdp:''}`,
`addEventListener` 是空函数。载荷里 `YIwy3`（SDP）是 `""`、`DrTW4`（ICE 候选）是 `[]`,
浏览器分别是 7277 B 和 1465 B。**空字符串是没有任何浏览器会产生的 SDP。**

**方法**：把浏览器载荷里的 `YIwy3` 原样导出成 `/tmp/chrome_offer.sdp`（6821 字符、
227 行），按 m-line 切成 audio / video / application 三段，把每段里
**逐连接变化的部分**（session id、`ice-ufrag`、`ice-pwd`、`fingerprint`、`mid`、
方向）抽成参数，其余（codec 表、`extmap` 列表、`rtcp-fb`、`fmtp`）作为常量原样搬进
bootstrap.js。常量块由脚本从 SDP 生成，不手抄。

**实现**：

- 每个 `RTCPeerConnection` 在 WeakMap 里持有一份 slots：19 位 session id、
  4 字符 ufrag、24 字符 pwd、32 字节 SHA-256 指纹，全部 `crypto.getRandomValues`
  生成——Chrome 也是每个连接换一套。
- `addTransceiver()` 与 `createOffer({offerToReceiveAudio/Video})` 决定 m-line 组成，
  `createDataChannel()` 追加 `m=application`；`a=group:BUNDLE` 按实际段数生成。
- `setLocalDescription()` 之后按 Chrome 的 trickle 节奏逐条抛 `icecandidate`,
  每个网卡每个 m-line 一条，最后一条 `candidate: null` 并把
  `iceGatheringState` 置为 `complete`。
- 本机地址走 mDNS：每个「网卡」一个 UUID `.local` 名字，页面生命周期内稳定，
  优先级用 Chrome 实测的 `2113937151` / `2113942271` 两个值。
- 数字格式对齐：session id 与 candidate foundation 都是**定宽且首位非 0**
  （第一版 `padStart(n,'0')` 产生了 `0125492767443864577` 这种前导零，Chrome 不会）。

**刻意不做的一项**：Chrome 那 9 条候选里有 3 条是 `srflx`（公网地址
`125.121.102.230`，优先级 1677729535），来自配置的 STUN 服务器。伪造一个公网 IP
意味着它必然和请求真实的出口地址对不上——**那比没有这条候选更容易被查**。
所以只发 6 条 mDNS host 候选。这是 `DrTW4` 985 vs 1465 的全部差额。

**结果**：

| 字段 | Chrome | 修复前 | 修复后 |
|------|--------|--------|--------|
| `YIwy3` | 7277 | 2 | **7277**（长度完全一致） |
| `DrTW4` | 1465 | 2 | **985** |
| 载荷总量 | 68342 | 38549 | **48950** |

**回归测试**：`a_peer_connection_offers_a_browser_shaped_sdp_and_trickles_candidates`
（obscura-js）——断言 m-line 顺序、BUNDLE、三段共用同一套凭据与指纹、
session id 无前导零、7 条候选（6 + 终止 null）、全部是 mDNS host、
`iceGatheringState` 收敛到 `complete`。

**测量盲区（新增）**：`obscura fetch --eval` **不会 await Promise**——返回
`Promise.resolve(42)` 得到的是 `{}`。异步探针必须走 CDP `Runtime.evaluate` 并带
`awaitPromise: true`，而且表达式**必须压成单行**（多行 async IIFE 同样静默返回 `{}`,
与已记录的多行 `JSON.stringify` 盲区同源）。

### Step 70 — WebGL 一组 8 个字段：一致性画像随 `--stealth` 生效，并补齐查询面（2026-08-17）

**现状**：`FgjO3`/`CPWA9`/`WLCCn2`/`ZlnsY8`/`ULOAc2`/`qbitp7`/`bhWNV6`/`KbSE2`
八个字段在 obscura 侧全是 CF 的 6 字符错误哨兵（`"Mylp5"`、`"dRVOa5"` …），
合计 2594 B 的浏览器数据变成 60 B 的「这个探测抛了」。根因是
`canvas.getContext('webgl')` 默认返回 `null`——一致性画像是 `OBSCURA_WEBGL_PROFILE`
环境变量的 opt-in。

**判断**：`--stealth` 的定义就是「呈现一台前后一致的普通浏览器」。一个
`WebGLRenderingContext` 存在、`getContext` 却回 `null` 的引擎不是一台一致的机器，
它是一台自相矛盾的机器。所以让画像**跟随 `--stealth`**，非 stealth 保持
「没有 GPU 就没有上下文」的诚实默认不变。

**修复**：

1. `ObscuraJsRuntime` 记住 stealth 标志，`gpu_profile_enabled()` = stealth ‖ 环境变量；
   `set_stealth` 与 `set_fingerprint` 都推这个标志，两种调用顺序都成立。
2. **帧 realm 也要拿到它。** 第一版只改了主 realm，实测 CF 那八个字段**纹丝不动**——
   `realm.rs` 创建帧 realm 时只推了 `__obscura_set_fingerprint`,
   没推 `__obscura_stealth` / `__obscura_webgl_enabled`,而 CF 的探测跑在它自己建的
   iframe realm 里。这是本轮第三次遇到同一形状的问题：**身份装到了主 realm,
   没装到子 realm。**
3. `getParameter` 重写：`VENDOR`/`RENDERER` 回 `"WebKit"`/`"WebKit WebGL"`
   （所有 Chrome 都是这两个字符串，真实适配器**只**能通过
   `WEBGL_debug_renderer_info` 拿到——原来直接把适配器串放在 `VENDOR` 上，正好反了,
   是最容易一行查出来的 WebGL 破绽）；补齐 ANGLE/D3D11 的参数表，WebGL2 再叠一层
   ES 3.0 的名字；数组类参数每次返回新实例。
4. 扩展列表从 8 条补到 WebGL1 36 条 / WebGL2 34 条（ANGLE + Intel D3D11 的组合,
   不含 ASTC/ETC/PVRTC 这些该机器本来就没有的格式）。
5. 补 `getShaderPrecisionFormat`（桌面 GL 恒为 float `[127,127,23]` / int `[31,30,0]`）
   以及整个查询面：`getInternalformatParameter`、`getError`、`isEnabled`、
   `checkFramebufferStatus`、`getIndexedParameter` 等约 60 个方法。
   补之前 `qbitp7` 里带回来的是
   `"UbbsC6Cannot read properties of undefined (reading 'call')"`——
   **抛异常比任何数值都更响亮。**
6. `readPixels` 从 `fill(0)` 改成按指纹种子生成稳定像素：全零本身就是一个哈希,
   而且是任何 GPU 都画不出来的那个。

**结果**：

| 字段 | Chrome | 修复前 | 修复后 |
|------|--------|--------|--------|
| `FgjO3` | 1246 | 7（哨兵） | **1200** |
| `CPWA9` | 613 | 7 | **768** |
| `WLCCn2` | 273 | 7 | **231** |
| `ZlnsY8` | 156 | 8 | **126** |
| `ULOAc2` | 136 | 8 | **126** |
| `qbitp7` | 66 | 7 | **63** |
| `KbSE2` | 38 | 8 | **38** |
| `bhWNV6` | 66 | 7 | 7（仍是哨兵） |
| **载荷总量** | 68327 | 38529 | **51582** |

`ULOAc2` 现在是
`[["WebKit","WebKit WebGL"],["Google Inc. (Intel)","ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"]]`,
形状与 Chrome 完全一致，且适配器与 Windows UA 自洽。

**刻意保留的差异**：参数表用的是 **ANGLE/D3D11 Intel** 的值，不是浏览器那份
**Apple/Metal** 抓包的值。照抄 Metal 的 `MAX_VERTEX_ATTRIBS=30`、
`MAX_VIEWPORT_DIMS=[16384,16384]` 到一个自称 Windows 的 UA 上，是制造新的矛盾。
因此本字段组不追求与参照载荷逐值相等，只要求**自洽且合乎所声称的机器**。

`bhWNV6` 仍是哨兵：它要求真正渲染一遍再取哈希，画像层不画像素。

**回归测试**：`the_gpu_profile_follows_stealth_and_hides_the_adapter_behind_the_debug_extension`
（obscura-js）——先断言**非 stealth 时 `getContext('webgl')` 仍是 `null`**，
再断言 stealth 下的 `VENDOR`/`RENDERER`、unmasked 走扩展、着色语言版本、
两种上下文的扩展数量与精度格式。

### Step 71 — `EnxW1`：WebGPU 适配器描述（2026-08-17）

**现状**：`navigator.gpu = { requestAdapter() { return Promise.resolve(null); } }`。
探测拿到 `null` 之后再读 `adapter.info` 就抛异常，载荷里是错误哨兵 `"nJJze9"`,
浏览器是 2293 B 的适配器画像。

**结构**（从浏览器载荷反推，9 项）：
`[adapter.info, adapter.limits 的 37 个值, adapter.features 20 项,
getPreferredCanvasFormat(), wgslLanguageFeatures 9 项, limits 的 37 个名字,
三次 requestAdapter 的 info, [device.features, device.limits], canvas 上下文配置]`。

**实现**：`GPU` / `GPUAdapter` / `GPUAdapterInfo` / `GPUDevice` /
`GPUSupportedLimits` / `GPUSupportedFeatures` 六个接口，挂在 step 70 引入的同一个
`__obscura_webgl_enabled` 开关后面——**没有 GPU 画像时仍然诚实地返回 `null`**,
那也是 Chrome 在 GPU 不可用时的答案。

要点：

- `GPUSupportedFeatures` 是 **setlike**，`has()` / 迭代 / `size` 都要能用；
  返回数组会在这三处全部露馅。
- `GPUSupportedLimits` 的 37 个名字反射在**原型**上，枚举它的探测看到的列表
  与浏览器一致。
- 适配器是 **Intel / D3D12 / gen-9**，与 step 70 的 WebGL renderer 串
  （`ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 …)`）指同一块卡。
  参照载荷里的 `"apple"` 不能照抄——那会和 Windows UA 直接对撞。
  同理 features 里去掉 `texture-compression-astc` / `etc2`（移动端与 Apple 的格式）,
  保留 `texture-compression-bc`。
- `device.limits` 用 WebGPU **规范默认值**（不申请就给默认，且默认低于适配器上限）,
  这一组是跨适配器恒定的，可以逐值照搬。
- `wgslLanguageFeatures` 是 Chrome 版本属性而非适配器属性，原样照搬 9 项。

**结果**：`EnxW1` 8 → **2176**（Chrome 2293）。
顺带 step 70 的 `readPixels` 改动生效：`KbSE2` 从 `["000…0", 1]` 变成
`["f8b8aeff6b5910ffa0f1d8ff8da145ff", 1]`——稳定、非零、与指纹种子绑定。

**载荷总量**：38529 → **53275**（Chrome 68327），从 56% 到 **78%**。

**回归测试**：`webgpu_describes_the_same_adapter_the_webgl_renderer_claims`——
先断言非 stealth 时 `requestAdapter()` 仍返回 `null`，再断言 setlike 行为、
无移动端压缩格式、device 限额低于 adapter 限额、品牌串是
`[object GPUAdapter]` / `[object GPUSupportedLimits]` / `[object GPUDevice]`。

### Step 72 — `ZpxzX5`：RTP 能力表由 SDP 反推；CF 侧升级导致本轮无法量测（2026-08-17）

**现状**：`RTCRtpSender` / `RTCRtpReceiver` 两个接口在 obscura 里**根本不存在**,
`RTCRtpSender.getCapabilities('audio')` 直接抛 TypeError,
载荷里是 `[[],[]]`（7 B），浏览器是 1273 B。

**做法**：不新写一份 codec 表，而是**从 step 69 已经搬进来的 SDP 段落里反推**——
遍历 `a=rtpmap:` 取名字/时钟频率/声道数，配对 `a=fmtp:` 取格式参数，
`a=extmap:` 取头扩展。这样 offer 与 `getCapabilities()` **不可能互相矛盾**:
同一份数据的两种视图。

两个细节：

- `rtx` 无论有多少个 payload type，能力表里只出现一次，且**不带 fmtp**——
  它的 `apt=` 指向被修复的那路流，是逐连接的属性而不是能力。
- 去重键必须包含**时钟频率**：`telephone-event` 在 48000 和 8000 各有一条,
  只按名字去重会把两条并成一条（第一版正是如此，8 条变 7 条）。

**本地实测**：audio 8 条、video 21 条，**与浏览器载荷逐条同序同内容**
（VP8 → rtx → VP9×4 → H264×8 → AV1×2 → H265×2 → red → ulpfec → flexfec-03）。

**CF 侧量测未取得**，原因写清楚：从本步开始，`/fo/` 的**第一次**提交就返回
**HTTP 400 + `dkQhH9: "600010"`**，tokenB 那一轮根本不再下发，
所以 `ZpxzX5` 所在的大载荷这两轮都没产生。

**这不是本次改动引起的**，做了对照实验：把本步的改动**从工作区撤掉、重新构建、
再跑一轮**，失败形态完全相同（`[4516, 795, 4731, 795]`，两次 600010）。
另外把失败轮的**第一个**载荷与上一轮成功的第一个载荷逐字段对比：47 个键一个不多一个不少,
差异只有 token、时间戳和几个 DOM/时序计数。判定为**CF 对本出口 IP 的升级**
（今天已经对同一目标跑了约 20 轮）。

**测量盲区（新增）**：同一 IP 反复跑质询会把 CF 推到更严格的分流，
**症状是「第一次 `/fo/` 就 400」而不是任何一步的行为变化**。此时所有依赖 tokenB
载荷的对拍全部失效。判据：拿**撤掉改动的同一份构建**再跑一轮；
形态相同就是 CF 侧，不要往自己的改动上归因。

### Step 73 — `Swui9`：键盘布局表（2026-08-17）

`navigator.keyboard.getLayoutMap()` 之前 resolve 一个**空 Map**。
真机浏览器从不这样：这张表描述当前布局下书写区各键产生什么字符，空表等于
「没有键盘」。载荷里浏览器是 596 B，obscura 是 2 B。

**实现**：`Keyboard` 与 `KeyboardLayoutMap` 两个真接口，表内容是 **US ANSI** 布局
（47 键），与所声称的 Windows 身份一致。刻意**不含 `IntlBackslash`**——
那是 ISO 键盘才有的那颗多出来的键，ANSI 板没有；参照载荷里有它是因为那台是 Mac,
照抄会和 Windows 身份对撞。

`KeyboardLayoutMap` 是 **maplike 且只读**：有 `get`/`has`/`size`/迭代，**没有 `set`**。
直接返回 `new Map()` 会在 `set` 这一处露馅。

本地实测：47 项、序列化 576 B（浏览器 596 B，多出的是 `IntlBackslash` 与 Mac 的
`§` 字符）。CF 侧量测同 step 72，受 IP 升级影响本轮无法取得。

**回归测试**：`the_keyboard_layout_map_describes_a_physical_ansi_board`。

### Step 74 — `gqGB4`：字体列表里那台「不可能存在的机器」的成因（2026-08-17）

step 66 记过：浏览器报 6 个字体，obscura 报 48+ 个，且**同时**包含 Windows
（Bahnschrift / Segoe Fluent Icons / Ink Free）、Linux（Adwaita / DejaVu / Cantarell）
和 macOS（Skia / PingFang HK Light）三套。这是本轮最典型的**矛盾类**信号——
缺一个 API 只是「老浏览器」，同时装三套 OS 字体是「伪造」。

**定位**：字体探测的标准做法是把一个字符串分别按
`font-family: 'X', monospace` 和 `font-family: 'X', sans-serif` 测宽，
**两次相等**即判定 X 已安装。直接用这个方法探 obscura：

```
ZZZ No Such Font 12345    mono=562  sans=648  -> absent   （正确）
Totally Fake Mono 999     mono=562  sans=562  -> PRESENT  （错）
Imaginary Sans 42         mono=648  sans=648  -> PRESENT  （错）
```

**任何自己编的、名字里带 "mono" 或 "sans" 的字体都被报成已安装。**
根因在 `obscura-render/src/inline.rs` 的 `bundled_family_for_css_token`:
它用的是**子串**规则——`token.contains("mono")`、`contains("sans")`、
`contains("times")`、`contains("garamond")`、`contains("consol")`、
`contains("courier")`。浏览器解析具名字体族从不这样：不认识就跳过，
用列表里的下一个。于是 `Adwaita Mono`（Linux）、`Noto Sans`、`Liberation Sans`、
`Free Sans`、`Source Code Pro`（命中 `"code"`）全都被算成「有」。

**修复**：子串规则换成**精确匹配**的别名表，只列所声称平台上真实存在的族
（generic 关键字 + Arial/Courier New/Georgia/Consolas/Times New Roman/Segoe UI/…）,
其余一律 `None`，由 CSS 列表里的下一个 token 接手——这正是浏览器的行为。

**修复后（同一探针）**：

```
Totally Fake Mono 999 / Imaginary Sans 42 / Adwaita Mono /
Cantarell / Bahnschrift / PingFang HK Light   -> absent
Arial / Courier New / Georgia / Consolas / Times New Roman -> PRESENT
```

**残留**：`DejaVu Sans` 仍报 present——它是引擎**真正打包**的族。一个自称 Windows
的身份上出现 DejaVu 仍是个小矛盾，但比原来的「三套 OS」小一个数量级。
彻底解决要让打包字体集随所声称的平台切换，属于渲染栈的改动，另记。

**回归测试**：`an_unknown_named_family_is_skipped_rather_than_guessed_from_its_name`
（obscura-render）——对五个不存在的名字断言它们**不能**盖过后面的 generic,
且在 monospace / sans-serif 两种上下文里解析结果**必须不同**（相同即等于「已安装」）;
同时断言真实存在的族仍然各自解析。

**CF 侧量测**同 step 72，受 IP 升级影响本轮无法取得。
