# 浏览器通用能力对齐路线图(Web Platform Parity Roadmap)

> 状态:评审稿 · 日期:2026-08-14 · 分支:`test/cf-challenge-overrun`
> 相关文档:[Cloudflare challenge 诊断记录](Cloudflare-challenge-profile.md)、[Trace 页面脚本](Trace-page-script.md)、[Anti-detection: real engine vs. JS patching](Anti-detection-vs-js-environment-patching.md)、[Iframe 设计](Iframe-support-design.md)
> 外部参考:[HaHaVM-General](https://github.com/)(通用补环境框架,含 `examples/cloudflare/` 外置模式)

## 1. 背景与动机

Cloudflare 质询攻关推进了 39 步(2026-08-13 至今),把 `interactiveEnd` 之前输入链路全部打通,当前阻塞在 `600010` 与 `/pat/` 两个点上。回看这 39 步,**几乎每一步暴露的都是通用浏览器能力缺口**,而不是 Cloudflare 特有问题:

- step 10:Performance Timeline 全空(2019 年起真实浏览器必有)
- step 39:`hasPrivateToken` / `hasRedemptionRecord` / `hasStorageAccess` 零实现
- step 32:inline script 栈行号偏移;step 8:栈底残留引擎帧
- step 30:缺 `<label>` 激活行为;step 37:鼠标事件字段缺失
- step 38:UA 分裂(JS 侧与 http_client 两个来源)
- step 9:早期 timer 迟发 600–2500ms

当前修法是"为一个站点补一个面"(补丁式、围绕 CF 转),代价是每次都要人工对拍 Chrome、且补丁彼此不通用。`HaHaVM-General` 项目(自 CF 专用引擎抽离的通用补环境框架)给了相反的范式:**引擎保持通用,CF 业务全部外置到注入点**(`loadResource` / `hooks` / `install`,见其 `examples/cloudflare/`)。

本路线图的目标:把已暴露与可预见的缺口**按浏览器通用能力为单元**补齐,CF 降级为验证样本之一。所有补法遵循 §5 的通用化原则,不再围绕 Cloudflare 打洞。

## 2. 现状对照:obscura vs HaHaVM-General

两个项目能力互补,对照表是缺口清单的第一手来源:

| 能力域 | obscura(真浏览器内核) | HaHaVM-General(纯 JS 补环境) |
|---|---|---|
| JS 引擎 | 真 V8(deno_core 0.350),多 realm / Worker 真隔离 | Node `vm` 沙箱,iframe=全新 vm 上下文重自举 |
| DOM | 真 Rust DOM 树 + html5ever + 真 CSS 布局/渲染 | cheerio 惰性包装 + 静态表,无布局 |
| 行为保真 | 真:事件、几何、动画、定时器由引擎实现 | 伪造但**面极全**:311 对象原型、1600+ `envFunc`、native 伪装、UA→指纹推导 |
| 时序 | 真网络栈可给真实 resource timing —— **有优势未用** | 无网络,只能伪造时序画像(`cfPerfProfiles` 外置) |
| 指纹 | profiles.rs 8 个固定 profile;WebGL 空 class | UA 驱动全表面自洽推导(navigator/UA-CH/sec-ch-ua-*/GPU) |
| 诊断 | V8 源码补丁 trace(HIT/MISS + CALL/RET)+ CDP 预注入 —— **独有优势** | 无 |
| 网络 | 完整 HTTP/1.1 + 代理 + TLS 指纹 + CookieJar | 零 I/O,全走宿主注入 |
| 特化残留 | 无 CF 业务(干净) | core 残留 turnstile 自动点击、joep1 push 劫持、rect 表(见其盘点) |

结论:**obscura 的"引擎真实性"远超 HaHaVM,但"JS 可观测面"的完整度不如它**;HaHaVM 恰好是"真实浏览器该长什么样"的对照目录。下文缺口大多能从它的 `envFunc` 清单 + 我们自己的 trace 证据双向印证。

## 3. 缺口全景(证据驱动)

标注:`[证据]` 后的编号对应 Cloudflare-challenge-profile.md 的 step,或 HaHaVM-General 文件位置。

### 3.1 JS 可观测行为保真(最高优先级)

| # | 缺口 | 现状 | 证据 | 通用化方案 |
|---|---|---|---|---|
| 1 | **Performance Timeline 全空** | `getEntries` 全 0,`PerformanceObserver.supportedEntryTypes` 不存在 | step 10;HaHaVM `cfPerfProfiles` 需伪造画像 | 网络层记录真实时序(连接/ttfb/传输),生命周期打 navigation/paint 条目;observer 全类型支持。obscura 有真网络栈,**真数据直接可用**,比 HaHaVM 伪造更优 |
| 2 | **Private State Token 一族 API** | `hasPrivateToken` / `hasRedemptionRecord` / `hasStorageAccess` 零实现 | step 39:`/pat/` 从不发出 | 按 Chrome Privacy Sandbox 规范实现 API 壳,**redemption/record 状态由配置驱动**(per-origin 策略),不做 CF 特化判断 |
| 3 | **Stack/行号保真** | inline script 用脚本内相对行号(Chrome 用文档绝对行号);栈底残留 `_runAtNesting` 2 帧;eval 栈名曾泄漏(已修) | step 32、step 8 | 统一"文档绝对行号"来源;清理自举帧;对齐 `Error.stack` 与 `EvalError` 语义 |
| 4 | **跨 realm 安全语义** | 跨源 `parent.location.origin` 返回 undefined 而非抛 `SecurityError`;`<page-eval>` 不辨 realm | step 未编号,iframes 调试实测 | 按 origin 检查统一抛 SecurityError;trace/CDP 记录 realm 归属(见 §3.4) |
| 5 | **定时器/事件循环时序** | 早期 timer 迟发 600–2500ms 未定位,与 CF 的 timeTiefMs 吻合 | step 9 | 引擎级 timer 调度基准(事件循环 tick 保真),不做任何站点的快进/延时白名单 |
| 6 | **表单与 label 激活剩余** | 主路径已修(click 转发、for=/tree scope),`labels`/`control` IDL 与程序化 `HTMLElement.click()` 转发未做 | step 30 待办 | 按 HTML 规范补全 IDL 与程序化激活路径 |
| 7 | **指纹推导引擎** | profiles.rs 8 个固定 profile;UA 分裂已修(step 38)但仍是"选表"而非"推导" | step 38;HaHaVM `config.js` 从 UA/sec-ch-ua 推导全表面 | 单一指纹输入源(UA)→ 自洽推导 navigator/platform/userAgentData/sec-ch-ua-*/GPU/DPR,替换固定表;对所有出站头/JS 面使用同一派生值 |
| 8 | **Referrer 语义对齐** | 出站 `Referer` 头近似 `origin-when-cross-origin`(`request_referrer`,client.rs:424:同源全 URL/跨源仅 origin/HTTPS→HTTP 不发),但**无 `Referrer-Policy` 响应头解析、无 meta/`referrerpolicy` 属性、无 `rel=noreferrer`**;iframe 内容文档 `referrer` 硬编码空串(bootstrap.js:6334,Chrome 中同源 iframe 应继承父链);主文档与 DOMParser 文档(referrer=空,符合规范)正确 | HaHaVM `cfPatches.js` 给挑战页强制空 referrer(值级特化);反爬高频探测点 | 按 Fetch/HTML 规范的 Referrer Policy 实现:响应头/meta/attribute/`rel=noreferrer` 全路径 + 默认 `strict-origin-when-cross-origin`;iframe 继承语义。**自检:CF 挑战页的空 referrer 应是策略的自然结果,而非特判** |

### 3.2 Web 平台 API 完整性

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 8 | **WebSocket 纯桩** | 构造即 open、send 丢弃、无真实 socket | obscura-net 增加 ws 实现(socket2 + rustls 已有),走同一代理/TLS 栈;桩是目前通用爬虫最大露馅点 |
| 9 | **WebGL/WebGL2 空 class** | 无后端,明确不伪造 GL 数据 | 二选一:轻量 GL(如 glow 软件渲染)或一致性指纹层(参照 HaHaVM `parameter_dic`:getParameter/getExtension/精度表全表面自洽,值级进配置) |
| 10 | **indexedDB 不持久化** | 内存 Map,spec 形状正确 | 接 `--storage-dir` 持久化(与 cookies.json 同级),规范对齐 |
| 11 | **Service Worker / SharedWorker / worklet** | 设计 non-goal(Iframe 文档),但现代站点普遍 | 中期补 SharedWorker(与 dedicated Worker 同构);SW/worklet 长期,保持 fail-closed |
| 12 | **Trusted Types 建模** | 待核实(存疑项) | HaHaVM 有完整 TT(createPolicy/default policy/eval 闸门,CSP 抛错语义);按规范补齐,不做 CF 特化文案 |
| 13 | **媒体/WebRTC/Notification** | 全桩(假实现或拒绝) | 保持桩但**保证行为稳定可预期**(不报假成功),指纹面与 Chrome 一致(如 audio 指纹已有校准) |

### 3.3 网络与传输

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 14 | **HTTP/2** | 仅 HTTP/1.1(reqwest 未开 h2,wreq 未显式启用) | 开 h2(h2 feature + ALPN),现代站点占比高;完成后 TLS 指纹 profile 需重验 |
| 15 | **no_proxy / 代理健壮性** | 不尊重 `no_proxy`,本机地址被送进代理且静默失败 | 标准 NO_PROXY 语义 + 代理失败可观测化(不吞错) |
| 16 | **自动点击/自然输入策略** | fetch 流程不会在 interactiveBegin 后自动点击;现靠 CDP 驱动 | 通用输入合成器:仿人轨迹/时序库**配置化**(HaHaVM 轨迹模板外置为数据),"何时模拟点击"由策略 hook 决定,不做文案匹配 |
| 17 | TLS 指纹 | wreq/BoringSSL Chrome145 已有 | 保持;随 h2 增加重验 |

### 3.4 诊断与调试(obscura 独有优势区,当前最薄弱)

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 18 | **CDP Debugger/Profiler/HeapProfiler 域** | 全部 no-op(dispatch.rs:574);`runIfWaitingForDebugger` 空实现 | rusty_v8 `inspector.rs` 有完整 V8Inspector 绑定(现成),接 `Debugger.enable→scriptParsed`、`setBreakpointByUrl`、`schedulePauseOnNextStatement`;realm 隔离已有 ContextScope 支撑 |
| 19 | **trace 增强** | 无 realm 区分、无时间戳、IC 快速路径盲区、native 绑定参数抓不到 | ① TSV 加 realm 列(GetScriptOrigin)与单调时钟列;② 条件属性断点(属性名/receiver 匹配即 DebugBreak,替代 140MB 全量 trace);③ **Rust op 层 API 序列日志**:171 个 op 是页面所有 host API 必经点,天然带 realm/参数,可覆盖 native 绑定死角 |
| 20 | **trace 与 CDP 同跑** | `serve` 不支持 `--v8-flags`,两者互斥 | CLI 层打通,一条管线:preload 探针 + trace + 截图 + consoleAPICalled 收流 |
| 21 | **frame 布局缓存** | 几何轮询(如 Turnstile)每次重跑 CSS+布局 | 按 (frame, doc generation) 缓存布局结果,无效化信号已具备 |

### 3.5 渲染与媒体

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 22 | 系统字体对齐 | cosmic-text 内嵌字体、确定性布局,不扫系统字体 | 长期:可选扫描系统字体接入,注意字体指纹面要与 Chrome 对齐或可配置 |
| 23 | video 解码 | 无 | 长期(封面帧/几何先支持) |
| 24 | PDF 结构 | raster PDF,无可选文本/大纲 | 长期 |

## 4. 优先级路线图

原则:P0/P1 必须是**完全通用**且**当前主线(CF 攻关)直接受益**;每项独立可合入,不互相阻塞。

### P0 — 平台底座(先做,每项 ≤1 周)

| 序 | 能力 | 关键收益 | 方案要点 | 状态 |
|---|---|---|---|---|
| 1 | Performance Timeline 真实现(§3.1-#1) | 解锁 step 10;任何现代站点必查;真数据直接替换 HaHaVM 式伪造画像 | 网络层 timing 采集 → resource/navigation/paint 条目 → `getEntries*`/observer;`supportedEntryTypes` 全类型 | ✅ 完成(`COMMIT_P0_1`) |
| 2 | PAT API 族(§3.1-#2) | 当前主线阻塞点之一(step 39 `/pat/`);规范 API,一补永逸 | 按规范实现 + per-origin 配置驱动 redemption 状态;补齐后回填 step 39 验证 | 待开始 |
| 3 | 指纹推导引擎(§3.1-#7) | 防检测核心;消除"选表"与分裂风险;8 profile → 单推导器 | 单一输入(UA)→ 推导全表面;JS 面/出站头同源;吸收 HaHaVM config.js 设计(仅设计,不引代码) | 待开始 |
| 4 | Stack/行号 + realm 安全语义 + Referrer(§3.1-#3/4/8) | 栈指纹、跨源语义、referrer 是高频探测面;工作量小 | 文档绝对行号统一;清理 `_runAtNesting`;SecurityError 语义;Referrer Policy 全路径解析 + iframe 继承 | 待开始 |
| 5 | 定时器保真(§3.1-#5) | step 9 时序异常;时间戳堆叠是通用 bot tell | 定位迟发根因(事件循环基准),不做快进白名单 | 待开始 |

#### P0-1 实施记录:Performance Timeline 真实现

- **状态**:✅ 完成(`COMMIT_P0_1`)。
- **实现**:普通与 stealth 传输统一记录请求起点、响应头到达和 body 完成时间;导航、脚本、样式、图片、字体及 fetch/XHR 生成真实 `navigation`/`resource` 条目。JS 层实现 Performance Timeline、User Timing、Resource Timing、Paint Timing 与 `PerformanceObserver`,并按 Timing-Allow-Origin 隐藏跨源细粒度数据。连接池未暴露的 DNS/connect 分段合并到真实 fetch 起点,不生成画像值。
- **确定性验证**:`js-repros/performance-timeline/` 固化同一行为 probe;Google Chrome 146.0.7680.80 oracle 输出为 navigation/resource 各 1 条、阶段有序、HTTP 200、measure `[4,6]`,Obscura 输出一致。
- **测试与门禁**:`obscura-net` 77/77、`obscura-js` 448/448、`obscura-browser` 99/99 release nextest 通过;`render,stealth` 编译检查通过;release CLI build 通过;obstacle course 33/33。workspace 全量 nextest 的二进制已编译完成,但 `obscura-cdp::input_label_activation --list` 在当前机器被系统 SIGKILL;未进入测试执行,相关三 crate 已分别全量通过。
- **诊断证据**:`obscura::performance` 日志可见 navigation 与 resource 的 `start_time_ms`、`response_start_ms`、`response_end_ms`、URL 与 body size;本地 fixture 实测分别记录导航 `0/3.12/3.34ms` 与脚本资源 `7.42/8.22/8.41ms`。

### P1 — 诊断底座 + 常见桩(次做,每项 1–2 周)

| 序 | 能力 | 关键收益 |
|---|---|---|
| 6 | CDP Debugger 域 + trace 增强(§3.4-#18/19) | 后续一切缺口定位从"几天对拍"降到"分钟级";Debugger 也是 Puppeteer 生态的硬需求 |
| 7 | trace/CDP 同跑(§3.4-#20) | 一条管线完成排查,消除互斥绕路 |
| 8 | WebSocket 真实现(§3.2-#8) | 通用爬虫最大露馅点;走既有网络栈 |
| 9 | 自动点击/自然输入策略(§3.3-#16) | 输入合成通用化;CF 交互挑战自动过(当前主线) |

### P2 — API 完整性(每项 1–2 周)

| 序 | 能力 |
|---|---|
| 10 | WebGL 一致性层(§3.2-#9) |
| 11 | indexedDB 持久化(§3.2-#10) |
| 12 | HTTP/2(§3.3-#14)+ TLS profile 重验 |
| 13 | no_proxy/代理健壮性(§3.3-#15) |
| 14 | 表单 IDL 剩余:labels/control、程序化 click 转发(§3.1-#6) |
| 15 | frame 布局缓存(§3.4-#21) |

### P3 — 长尾(待命)

Trusted Types 补全(§3.2-#12)、SharedWorker(§3.2-#11)、系统字体/媒体(video)/PDF 结构(§3.5)、ServiceWorker/worklet(长期,fail-closed 保持)。

## 5. 通用化方法论(六原则)

1. **规范优先,CF 只是验证样本**。能力按 WHATWG/W3C/Chrome 行为实现;判据 = 规范 + Chrome 实测(js-reverse oracle),不是 CF 某版脚本。CF 挑战页面只充当回归样本之一。
2. **真数据优先于伪造**。obscura 有真网络/布局/渲染/时序,能真实现就真实现(Performance Timeline 即例)。伪造只留给"浏览器自身也不让 JS 看到的内部"(WebGL 驱动串、GPU 名等),且值级进配置。延续 [Anti-detection 文档](Anti-detection-vs-js-environment-patching.md) 的立场。
3. **数据与行为分离**。值级指纹(时序画像、computed style 常量、rect 表、字体表)全部走配置/profile/策略层注入;**行为语义(事件、安全、生命周期、realm)进内核**。HaHaVM 的教训:CF 值级数据烙进 core 后既不能复用又成维护负担。
4. **注入点契约化**。每个特化需求收敛为一个通用 hook/通道:对应 HaHaVM 的 `loadResource`/`hooks`/`install` ↔ obscura 的 CDP intercept 通道、`addScriptToEvaluateOnNewDocument`、profile 配置层。新增能力若存在"站点可定制"需求,先定义契约再实现。
5. **诊断先行**。Debugger/trace(op 层 API 日志)优先于排障:任何新缺口能在分钟级拿到"页面问了什么、谁回答的、在哪回答的"。这是 HaHaVM 没有、obscura 独有的杠杆。
6. **Chrome oracle 对照验证**。新增/修改的每个 JS 可观测面,用真实 Chrome(js-reverse MCP 或 headless Chrome)做行为 diff;`render-repros` 的 fixture 模式扩展到 JS 环境面(见 §6)。

## 6. 验证体系

- **行为对照 fixture 库**:`render-repros/` 模式扩展为 `js-repros/`(或并入现有),每个能力一个确定性 fixture + Chrome 对照输出(值/事件序列/stack),`check.py` 自动化。
- **Chrome oracle**:js-reverse MCP(已在 CF 攻关中使用)固化进对照流程:同一 fixture 先在真实 Chrome 跑出期望,再对 obscura diff。
- **CF 挑战降级为回归**:`Cloudflare-challenge-profile.md` 中的每步判据(事件序列、trace 信号、`cf_chl_rc_ni` 判成败)变为回归用例;新能力合入后回填对应 step 的结论,不再单独为 CF 加逻辑。
- **trace 基线**:P1 完成后,每个新能力都要求"trace 里能看见"——诊断面与实现面同步演进。

## 7. 与现有工作的衔接

- `Cloudflare-challenge-profile.md` 继续作为诊断记录;`600010` 根因待查(不归入本路线图,但预计会落在 §3.1 行为保真域)。
- 每补一个 P0/P1 能力,回填 profile 文档对应 step(如 step 10 → Performance Timeline;step 39 → PAT API)。
- 新 Web API / CDP 方法仍走 [Adding-a-CDP-method-or-Web-API](Adding-a-CDP-method-or-Web-API.md) 流程,本路线图只定优先级与形态。
- 验收口径:每个 P0 能力合入时附"通用性自检"——去掉所有 CF 上下文后该能力是否依然成立(即:实现里不出现 challenge-platform 等站点字符串)。
