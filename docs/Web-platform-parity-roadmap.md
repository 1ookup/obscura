# 浏览器通用能力对齐路线图(Web Platform Parity Roadmap)

> 状态:评审稿 · 日期:2026-08-14 · 分支:`feat/web-platform-parity`
> 相关文档:[Cloudflare challenge 诊断记录](Cloudflare-challenge-profile.md)、[Trace 页面脚本](Trace-page-script.md)、[Anti-detection: real engine vs. JS patching](Anti-detection-vs-js-environment-patching.md)、[Iframe 设计](Iframe-support-design.md)
> 外部参考:[HaHaVM-General](https://github.com/1ookup/HaHaVM-General)(通用补环境框架,含 `examples/cloudflare/` 外置模式)

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
| 6 | **表单与 label 激活剩余** | `HTMLLabelElement.control`、labelable `.labels`、嵌套/显式关联和 `label.click()` 激活已实现 | step 30 | 按 tree scope 查找并排除 hidden/disabled 控件;取消 label click 时不转发 |
| 7 | **指纹推导引擎** | profiles.rs 8 个固定 profile;UA 分裂已修(step 38)但仍是"选表"而非"推导" | step 38;HaHaVM `config.js` 从 UA/sec-ch-ua 推导全表面 | 单一指纹输入源(UA)→ 自洽推导 navigator/platform/userAgentData/sec-ch-ua-*/GPU/DPR,替换固定表;对所有出站头/JS 面使用同一派生值 |
| 8 | **Referrer 语义对齐** | 出站 `Referer` 头近似 `origin-when-cross-origin`(`request_referrer`,client.rs:同源全 URL/跨源仅 origin/HTTPS→HTTP 不发),但**无 `Referrer-Policy` 响应头解析、无 meta/`referrerpolicy` 属性、无 `rel=noreferrer`**;iframe 内容文档 `referrer` 硬编码空串(bootstrap.js,Chrome 中同源 iframe 应继承父链);主文档与 DOMParser 文档(referrer=空,符合规范)正确 | HaHaVM `cfPatches.js` 给挑战页强制空 referrer(值级特化);反爬高频探测点 | 按 Fetch/HTML 规范的 Referrer Policy 实现:响应头/meta/attribute/`rel=noreferrer` 全路径 + 默认 `strict-origin-when-cross-origin`;iframe 继承语义。**自检:CF 挑战页的空 referrer 应是策略的自然结果,而非特判** |

### 3.2 Web 平台 API 完整性

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 8 | **WebSocket 纯桩** | 已接入真实 RFC 6455 socket;消息、错误、关闭事件与 `ws`/`wss` URL 校验已覆盖 | `tokio-tungstenite` 连接器、异步事件队列、同 fetch 的私网校验;代理 CONNECT/TLS 指纹复用仍是后续工作 |
| 9 | **WebGL/WebGL2 空 class** | 默认仍诚实返回 `null`;显式 profile 开关提供一致性值层 | `OBSCURA_WEBGL_PROFILE=1` 从 fingerprint GPU 策略派生 vendor/renderer、扩展和基础对象生命周期;不声称真实 GPU 后端 |
| 10 | **indexedDB 不持久化** | 已实现 origin/name-keyed JSON 持久化 | `--storage-dir` 与 cookies 同级;版本升级、object store、基本 CRUD、deleteDatabase/databases 走异步 request 形状 |
| 11 | **Service Worker / SharedWorker / worklet** | SharedWorker 已真实现(真 worker 线程 + MessagePort);ServiceWorkerContainer 已改 fail-closed(此前 register 报假成功);worklet 入口已补(`CSS.paintWorklet`/`audioWorklet`) | SharedWorker 与 dedicated Worker 同构已落地;SW 与 worklet 保持 fail-closed,但形状与 Chrome 逐项对齐,失败用 Chrome 自己的错误形态 |
| 12 | **Trusted Types 建模** | **暂缓,入口不暴露**(实现保留在 `_installTrustedTypes` 内,以 early return 关闭)。卡点是 `eval(trustedScript)` | 工厂/策略/三个包装类型/sink 表已按 Chrome 146 对齐,除 `eval` 外所有 sink 实测正确;`eval` 需要 V8 `ModifyCodeGenerationFromStrings` 宿主钩子,rusty_v8 未暴露且官方构建链接 prebuilt librusty_v8,覆盖 `globalThis.eval` 会把所有调用点变成 indirect eval。**暴露半个面已实测造成真实回归**(见 Cloudflare-challenge-profile step 49-52):页面只凭 `window.trustedTypes` 存在性就切到 TT 路径,其 `eval(policy.createScript(...))` 随后静默失效。CSP `require-trusted-types-for` 同样未实现 |
| 13 | **媒体/WebRTC/Notification** | 媒体能力声明已自洽并对齐 Chrome(`3a61507`);WebRTC/Notification 仍是全桩 | 保持桩但**保证行为稳定可预期**(不报假成功),指纹面与 Chrome 一致(如 audio 指纹已有校准);WebRTC/Notification 尚未按此复核 |

### 3.3 网络与传输

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 14 | **HTTP/2** | reqwest h2/ALPN feature 已开启;本机无 HTTPS/Chrome oracle,需外部 ALPN fixture 重验 | 开 h2(h2 feature + ALPN),现代站点占比高;完成后 TLS 指纹 profile 需重验 |
| 15 | **no_proxy / 代理健壮性** | reqwest、脚本 fetch 和 stealth/wreq 显式使用 `NoProxy::from_env`;非法显式代理告警 | 标准 NO_PROXY 语义 + 代理失败可观测化(不吞错) |
| 16 | **自动点击/自然输入策略** | fetch 流程不会在 interactiveBegin 后自动点击;现靠 CDP 驱动 | 通用输入合成器:仿人轨迹/时序库**配置化**(HaHaVM 轨迹模板外置为数据),"何时模拟点击"由策略 hook 决定,不做文案匹配 |
| 17 | TLS 指纹 | wreq/BoringSSL Chrome145 已有 | 保持;随 h2 增加重验 |

### 3.4 诊断与调试(obscura 独有优势区,当前最薄弱)

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 18 | **CDP Debugger/Profiler/HeapProfiler 域** | 全部 no-op(dispatch.rs);`runIfWaitingForDebugger` 空实现 | rusty_v8 `inspector.rs` 有完整 V8Inspector 绑定(现成),接 `Debugger.enable→scriptParsed`、`setBreakpointByUrl`、`schedulePauseOnNextStatement`;realm 隔离已有 ContextScope 支撑 |
| 19 | **trace 增强** | 无 realm 区分、无时间戳、IC 快速路径盲区、native 绑定参数抓不到 | ① TSV 加 realm 列(GetScriptOrigin)与单调时钟列;② 条件属性断点(属性名/receiver 匹配即 DebugBreak,替代 140MB 全量 trace);③ **Rust op 层 API 序列日志**:171 个 op 是页面所有 host API 必经点,天然带 realm/参数,可覆盖 native 绑定死角 |
| 20 | **trace 与 CDP 同跑** | `serve` 不支持 `--v8-flags`,两者互斥 | CLI 层打通,一条管线:preload 探针 + trace + 截图 + consoleAPICalled 收流 |
| 21 | **frame 布局缓存** | 几何轮询(如 Turnstile)每次重跑 CSS+布局 | 按 (frame, doc generation) 缓存布局结果,无效化信号已具备 |

### 3.5 渲染与媒体

| # | 缺口 | 现状 | 通用化方案 |
|---|---|---|---|
| 22 | 系统字体对齐 | cosmic-text 内嵌字体、确定性布局,不扫系统字体;**canvas `measureText` 已改走真实布局**(`4060dc8`),不再方差为零 | ⏸ 暂缓(见 P3-22):扫描会牺牲确定性对拍,需做成默认关闭的 opt-in 且与所声称平台绑定 |
| 23 | video 解码 | 无解码;**能力声明已对齐 Chrome 且与 decodingInfo 自洽**(`3a61507`),几何/readiness 保持空 | ⏸ 暂缓(见 P3-22):真解码需引入解码器依赖;封面帧仍未支持 |
| 24 | PDF 结构 | raster PDF,无可选文本/大纲 | ⏸ 暂缓(见 P3-22):无阻塞点,纯增量工程 |

## 4. 优先级路线图

原则:P0/P1 必须是**完全通用**且**当前主线(CF 攻关)直接受益**;每项独立可合入,不互相阻塞。

### P0 — 平台底座(先做,每项 ≤1 周)

| 序 | 能力 | 关键收益 | 方案要点 | 状态 |
|---|---|---|---|---|
| 1 | Performance Timeline 真实现(§3.1-#1) | 解锁 step 10;任何现代站点必查;真数据直接替换 HaHaVM 式伪造画像 | 网络层 timing 采集 → resource/navigation/paint 条目 → `getEntries*`/observer;`supportedEntryTypes` 全类型 | ✅ 完成(`79e1238`) |
| 2 | PAT API 族(§3.1-#2) | 当前主线阻塞点之一(step 39 `/pat/`);规范 API,一补永逸 | 按规范实现 + per-origin 配置驱动 redemption 状态;补齐后回填 step 39 验证 | ✅ 完成(`f4a1201`) |
| 3 | 指纹推导引擎(§3.1-#7) | 防检测核心;消除"选表"与分裂风险;8 profile → 单推导器 | 单一输入(UA)→ 推导全表面;JS 面/出站头同源;吸收 HaHaVM config.js 设计(仅设计,不引代码) | ✅ 完成(`43cb4d4`) |
| 4 | Stack/行号 + realm 安全语义 + Referrer(§3.1-#3/4/8) | 栈指纹、跨源语义、referrer 是高频探测面;工作量小 | 文档绝对行号统一;清理 `_runAtNesting`;SecurityError 语义;Referrer Policy 全路径解析 + iframe 继承 | ✅ 完成(`76b6ae5`) |
| 5 | 定时器保真(§3.1-#5) | step 9 时序异常;时间戳堆叠是通用 bot tell | 定位迟发根因(事件循环基准),不做快进白名单 | ✅ 完成(本提交) |

#### P0-1 实施记录:Performance Timeline 真实现

- **状态**:✅ 完成(`79e1238`)。
- **实现**:普通与 stealth 传输统一记录请求起点、响应头到达和 body 完成时间;导航、脚本、样式、图片、字体及 fetch/XHR 生成真实 `navigation`/`resource` 条目。JS 层实现 Performance Timeline、User Timing、Resource Timing、Paint Timing 与 `PerformanceObserver`,并按 Timing-Allow-Origin 隐藏跨源细粒度数据。连接池未暴露的 DNS/connect 分段合并到真实 fetch 起点,不生成画像值。
- **确定性验证**:`js-repros/performance-timeline/` 固化同一行为 probe;Google Chrome 146.0.7680.80 oracle 输出为 navigation/resource 各 1 条、阶段有序、HTTP 200、measure `[4,6]`,Obscura 输出一致。
- **测试与门禁**:`obscura-net` 77/77、`obscura-js` 448/448、`obscura-browser` 99/99 release nextest 通过;`render,stealth` 编译检查通过;release CLI build 通过;obstacle course 33/33。workspace 全量 nextest 的二进制已编译完成,但 `obscura-cdp::input_label_activation --list` 在当前机器被系统 SIGKILL;未进入测试执行,相关三 crate 已分别全量通过。
- **诊断证据**:`obscura::performance` 日志可见 navigation 与 resource 的 `start_time_ms`、`response_start_ms`、`response_end_ms`、URL 与 body size;本地 fixture 实测分别记录导航 `0/3.12/3.34ms` 与脚本资源 `7.42/8.22/8.41ms`。

#### P0-2 实施记录:PAT API 族

- **状态**:✅ 完成(`f4a1201`)。
- **实现**:`Document.prototype.hasPrivateToken`、`hasRedemptionRecord`、`hasStorageAccess` 按 Chrome 的 Promise、WebIDL 参数、descriptor/native toString、fully-active Document 与异常语义实现,main realm、iframe realm 共用同一内核路径。Private State Token issuer 只接受 potentially trustworthy HTTP(S) origin,URL path/默认端口归一到 origin;`hasPrivateToken` 的两 issuer 信息限制按顶层 origin 保存在 BrowserContext,跨同源导航持续,不同上下文隔离。
- **策略契约**:`PrivacyPolicy` 以 `(top-level origin,document origin,issuer origin)` 分区 token/redemption 状态,以 `(top-level origin,document origin)` 分区 storage-access grant;Rust embedder 通过 `set_private_token`、`set_redemption_record`、`set_storage_access_grant` 注入已知事实。空策略不伪造状态:token/record 与第三方 grant 均为 false,first-party `hasStorageAccess()` 由规范语义自然返回 true。
- **确定性验证**:`js-repros/private-state-and-storage-access/` 固化 API shape、Promise、非法 issuer、detached Document、两 issuer 配额和 first-party storage access。Google Chrome 146.0.7680.80 使用全新 profile 执行同一 `probe.js`,与 Obscura 的 JSON 全量一致;Rust 测试另覆盖配置为 true 的 token/record、iframe 跨源 grant 与策略快照隔离。
- **测试与门禁**:`obscura-js` 455/455、`obscura-browser` 99/99 release nextest 通过;workspace release nextest 1564/1564(4 skipped)通过;精确 release CLI build 通过;obstacle course 33/33。
- **诊断与通用性证据**:`obscura::privacy` debug 日志记录 API、top-level/document/issuer origin、返回值与 quota 状态。实现差异自检未出现 `challenge-platform`、`turnstile`、`cf_` 等站点字符串,所有值级状态均位于通用策略层。

#### P0-3 实施记录:指纹推导引擎

- **状态**:✅ 完成(`43cb4d4`)。
- **实现**:`BrowserFingerprint` 从 UA 与显式 `FingerprintOverrides` 推导 UA、appVersion、navigator/platform、UA-CH 低/高熵 brands、移动端标记、screen/DPR、硬件并发度、device memory 与 GPU 策略值;覆盖 Windows、macOS、Linux、Android 及未知 UA,使用 Chromium GREASE brands/order。BrowserContext 保有 context 级默认输入,Page 保有页级身份以支持 CDP/嵌入器 override;HTTP、stealth/wreq、JS fetch/XHR、module graph、main/iframe/dedicated worker 均从同一契约读取,连接池与资源缓存仍按 context/page fork 共享。WebGL 在无真实 backend 时保持 `null`,不声称 GPU 能力。
- **策略边界**:身份值由 `obscura-net` 派生器和配置策略提供,realm 安全、生命周期与网络行为仍由内核实现;`Network.setUserAgentOverride` 的 platform/metadata 同步更新 live JS 与页级网络头,新建 frame realm 继承并同步 live fingerprint。无站点字符串、无固定 profile 选择表,日志 target `obscura::fingerprint` 记录 user agent、navigator/UA platform、browser version 与 mobile。
- **确定性验证**:`js-repros/fingerprint-derivation/` 固化主 realm、同源 iframe、dedicated worker、screen/DPR、UA-CH 与 WebGL fixture。Google Chrome 146.0.7680.80 native headless oracle 固化跨 realm 一致性、Chromium 146/Not-A.Brand 24/Google Chrome 146 顺序及 `--disable-gpu` 下 WebGL 不可用;Obscura fixture 实测 `childMatchesMain=true`、`workerMatchesLowEntropy=true`、Windows Chrome 146 identity、1920x1080 DPR1、WebGL false。
- **测试与门禁**:`obscura-net` 83/83、`obscura-js` 457/457、`obscura-browser` 99/99、`obscura-cdp` 174/174 release nextest 通过;普通 `render` 与 `render,stealth` release CLI build 通过。新增网络 trace/debug 字段记录 fingerprint user agent/platform/version/mobile;fixture 输出为确定性 JSON。workspace 全量 nextest 与 obstacle course 将在 P0-3 提交前的统一门禁阶段执行。

#### P0-4 实施记录:Stack/行号 + realm 安全语义 + Referrer

- **状态**:✅ 完成(`76b6ae5`)。
- **实现**:html5ever tokenizer 行号写入 DOM parser 元数据,inline classic/module 脚本和 iframe realm 通过 `ScriptOrigin` 使用文档绝对行号;跨源 WindowProxy 的 `document`、location 读属性和 `frameElement` 统一抛 `SecurityError`,同源 iframe 保留真实 realm 与 `document.referrer`。网络层实现八种 Referrer-Policy,默认 `strict-origin-when-cross-origin`,响应头优先于 meta,并贯穿主导航、重定向、iframe、脚本/样式/module、fetch/XHR 及 stealth 客户端。值级策略仅来自文档元数据与 embedder 输入,没有站点特判。
- **确定性验证**:`js-repros/stack-realm-referrer/` 覆盖 parser 行号、inline/external stack、同源继承、跨源安全异常、iframe `referrerpolicy` 和同源/跨源 fetch Referer;本地双 origin capture 成功,服务端收到两组真实 Referer,debug trace 含 navigation/frame/fetch 记录。`chrome-oracle.json` 固化 Google Chrome 146 的归一化实测语义;当前机器没有 Chrome 可执行文件,因此未重复本地 Chrome capture,限制已记录在 fixture README。
- **测试与门禁**:`obscura-dom` 89/89、`obscura-net` 84/84、`obscura-js` 458/458、`obscura-browser` 100/100 release nextest 通过;普通 `render` release CLI build 通过,stealth 构建作为本项提交前门禁执行。新增 DOM source-line、stack、Referrer-Policy 矩阵与 document scope fixture 测试均为确定性断言。

#### P0-5 实施记录:定时器保真

- **状态**:✅ 完成(本提交)。
- **实现**:定位到 deno_core 可变 timer sleep 在导航/协议抢占取消 run-to-idle poll 后保留旧 waker 的根因;所有浏览器 timer 在 Rust 状态层登记真实单调 deadline,新的 cooperative/autonomous event-loop turn 只在已有 timer 到期时通过 yield-only async op 重建唤醒路径。deadline、排序、HTML nested timer 4ms floor 和 callback 语义仍由 deno_core/bootstrap 内核实现,没有按 URL 或页面内容快进。
- **确定性验证**:`js-repros/timer-fidelity/` 覆盖 microtask→timer 任务边界、0/1/50/100/250/550/1000ms 桶、interval 重排与 nested timeout floor;Chrome 146 headless oracle 的到期顺序与 Obscura 一致,修复前 50/100ms 在约 103ms 批量交付,修复后约 52/103ms 且不再跨 100ms settle slice。固定 settle 与 CDP autonomous pump 均有本地 HTTP 导航 fixture。
- **测试与门禁**:`obscura-js` 459/459、`obscura-browser` 102/102、`obscura-cdp` 174/174(3 skipped) release nextest 通过;workspace release nextest 1580/1580(4 skipped)通过;精确 release CLI build 通过;obstacle course 33/33。最终 Obscura fixture 的 50/100/250/550/1000ms timer 分别约 51/103/252/553/1002ms。
- **诊断证据**:`RUST_LOG=obscura::timers=trace` 记录 `queued overdue timer wake repair`、park/wake/tick 边界;修复后 overdue tick 的 wake 返回约 0.04–0.4ms,修复前同一 tick 约 101–102ms,与 fixture 的 50/100ms 聚集一一对应。

### P1 — 诊断底座 + 常见桩(次做,每项 1–2 周)

| 序 | 能力 | 关键收益 | 状态 |
|---|---|---|---|
| 6 | CDP Debugger 域 + trace 增强(§3.4-#18/19) | 后续一切缺口定位从"几天对拍"降到"分钟级";Debugger 也是 Puppeteer 生态的硬需求 | ✅ 协议状态、scriptParsed 生命周期、Profiler/HeapProfiler 合同和 host-op TSV;rusty_v8 原生断点桥接待后续 |
| 7 | trace/CDP 同跑(§3.4-#20) | 一条管线完成排查,消除互斥绕路 | ✅ `--trace-op-file` 与 `--v8-flags` 在单 worker 与多 worker 下均贯通(`resolve_v8_flags`);父进程导出 `OBSCURA_V8_FLAGS`,子进程读它 —— 此前只有 `obscura-worker` 这个 bin 读,而它并不是 `--workers` 所 spawn 的那个 |
| 8 | WebSocket 真实现(§3.2-#8) | 通用爬虫最大露馅点;走既有网络栈 | ✅ 本地 RFC 6455 echo fixture 通过;代理 CONNECT/TLS profile 复用待后续 |
| 9 | 自动点击/自然输入策略(§3.3-#16) | 输入合成通用化;CF 交互挑战自动过(当前主线) | ✅ selector/timing policy、可信 pointer/mouse/click 序列和自然逐字符 input |

### P2 — API 完整性(每项 1–2 周)

| 序 | 能力 | 状态 |
|---|---|---|
| 10 | WebGL 一致性层(§3.2-#9) | ✅ 显式 profile 的值级一致性层;默认 fail-closed |
| 11 | indexedDB 持久化(§3.2-#10) | ✅ profile 目录 JSON 持久化和基本异步 CRUD |
| 12 | HTTP/2(§3.3-#14)+ TLS profile 重验 | ✅ feature/ALPN 已开启;外部 HTTPS fixture 重验待有环境时执行 |
| 13 | no_proxy/代理健壮性(§3.3-#15) | ✅ reqwest、脚本 fetch、stealth/wreq 使用环境 NO_PROXY |
| 14 | 表单 IDL 剩余:labels/control、程序化 click 转发(§3.1-#6) | ✅ |
| 15 | frame 布局缓存(§3.4-#21) | ✅ paint、geometry、scroll metrics 共用 generation/viewport/sample cache |

### P3 — 长尾

原本记为"待命",但其中三项在核实时发现不是"尚未做",而是**做错了**:实现存在且在报假成功,
违反 §3.2-#13 自己写的"不报假成功"与 §3.2-#11 的"保持 fail-closed"。已按能力单元补齐。

| 序 | 能力 | 状态 |
|---|---|---|
| 16 | ServiceWorker fail-closed(§3.2-#11) | ✅ 完成(`8734846`) |
| 17 | SharedWorker 真实现(§3.2-#11) | ✅ 完成(`871682b`) |
| 18 | Trusted Types API 面(§3.2-#12) | ⏸ **暂缓**:实现完成(`1f963b7`)但入口不暴露,卡在 `eval(trustedScript)` 需要引擎级宿主钩子;暴露半个面已实测造成回归,详见 §3.2-#12 与 Cloudflare-challenge-profile step 49-52 |
| 19 | worklet 入口(§3.2-#11) | ✅ 完成(`552715e`) |
| 20 | 媒体能力声明自洽(§3.5-#23 起步 / §3.2-#13) | ✅ 完成(`3a61507`) |
| 21 | canvas 文本度量走真实布局(§3.5-#22 起步) | ✅ 完成(`4060dc8`) |
| 22 | 系统字体扫描(§3.5-#22) / video 真解码(§3.5-#23) / PDF 结构(§3.5-#24) | ⏸ **暂缓**——等出现强依赖再做,见下方说明 |

#### P3-16 实施记录:ServiceWorker fail-closed

- **状态**:✅ 完成(`8734846`)。
- **问题**:`navigator.serviceWorker` 是个对象字面量,且在**报假成功**——`register()`
  resolve(undefined),于是几乎所有站点都写的 `register().then(reg => reg.scope)` 抛出一个
  真实浏览器永远不会抛的 TypeError;`ready` 立即 resolved,于是靠
  `await navigator.serviceWorker.ready` 把关的代码,在 Chrome 会永久阻塞的地方径直往下走。
- **实现**:Service Worker 仍然不实现,补的是「没有 worker 也能被观测到」的那一整面。容器成为
  真正的 `ServiceWorkerContainer`(@@toStringTag、constructor.name、`instanceof EventTarget`,
  走 `Performance` 同款 setPrototypeOf 而不继承 Node 的监听器管线);属性改为 `Navigator.prototype`
  上的 accessor,navigator 不再有自有属性;`ready` 是永不 settle 的缓存 promise;`register`
  按 Chrome 的检查顺序 reject。`ServiceWorker`/`ServiceWorkerRegistration`/`Worklet`/
  `NavigationPreloadManager` 补上 interface object。
- **验证**:`js-repros/service-worker-fail-closed/` 固化 Chrome 146.0.7680.80 oracle。
- **续修(见下)**:首版把「取脚本」和「跑 worker」混为一谈,在取脚本之前就拒绝,漏掉了 5 类判定。

#### P3-16 续:register 必须真的去取脚本

- **状态**:✅ 完成。
- **问题**:首版实现的注释写着「Every rejection the spec can reach without running a worker has
  been checked」——这句话是错的。Chrome 的 `register()` 有 7 步,**只有最后一步(求值并安装脚本)
  需要 worker**;取脚本、状态码、MIME、重定向、scope 上限全部不需要。首版在第 2 步就放弃,把 6 个
  可判定的结果坍缩成一个错误答案。
- **更重的那一半在服务端**:Chrome 取脚本时发的是 `GET /sw.js`,带 `Service-Worker: script` 与
  `Sec-Fetch-Dest: serviceworker`——这组头没有任何其它请求类型会带。不发这个请求,等于在**每一个
  部署了 SW 的站点**的访问日志里留下一个洞,而且**不需要页面侧任何检测代码**就能看见。这比 JS 侧的
  错误字符串差异强得多。
- **实现**:补齐 `%2f`/`%5c` 转义检查(本地),然后真的 fetch 脚本,按 Chrome 实测的优先级判定——
  重定向 > 状态码 > MIME > scope 上限(含 `Service-Worker-Allowed`)。MIME 白名单用 fetch 规范的
  JavaScript 集合,大小写不敏感、剥参数。fail-closed 的拒绝**移到全部检查之后**,只在「脚本确实取到
  且合法可用」时触发。`op_fetch_url` 增加 fetch 的 `redirect` 语义:SW 脚本用 `error`,不跟随跳转
  ——否则会在服务端日志里多出一个 Chrome 不会发的请求(参数挂在已是 JSON 的 `referrer_context` 上,
  因为 deno_core 的 async op codegen 上限是 9 个参数)。
- **顺序怎么定的**:不是照规范读的,是喂给 Chrome「同时违反两项检查」的输入试出来的——重定向到 404
  报重定向,404 且无 MIME 报 404,scope 超范围且 MIME 错报 MIME。
- **验证**:oracle 从 89 个观测点扩到 175,其中 150 个逐字一致,且**服务端收到的请求序列完全一致**
  (`__serverSawScriptFetches` 已进 oracle,成为可回归断言而非一次性观察)。剩余 25 个:24 个是三处
  「Chrome 会成功」的用例——这就是 fail-closed 本身,且现在精确收敛到这一个点(此前它连 404 路径
  一起吞了,而那是每个 SW URL 过期的站点都会走的路径);1 个是 `http://[` 的 URL 序列化细节,只有
  4 个数据点,猜测式复刻会用一个已知差异换来若干未知差异,故保持原样。新增 Rust 测试
  `service_worker_registration_fetches_the_script_before_refusing` 用本地 server 覆盖整条判定链,
  并断言 `/sw-ok.js` **不出现**在请求列表里(重定向未被跟随)。
- **已知缺口**:已在下一节修复。

#### P3-23:secure context——引擎自相矛盾

- **状态**:✅ 完成。
- **问题**:`isSecureContext` 在 worker scope 上**有**(`worker.rs:738`),在 window 上**完全没有**。
  两行脚本就能读出引擎在自我矛盾:`self.isSecureContext` 返回 false,`window.isSecureContext`
  返回 undefined。它还把着一批真实 API:Chrome 在非安全源上收起 `crypto.subtle`、
  `navigator.serviceWorker`/`mediaDevices`/`storage`/`clipboard`/`wakeLock`/`credentials`/`locks`
  和 `caches`,Obscura 在任何源上都无条件发放。顺带发现 `globalThis.origin` 也整个不存在。
- **oracle 拦下的错误**:「把 secure-context API 全收起」的直觉会连 `navigator.geolocation` 和
  `Notification` 一起删——这两个出现在每一份 secure-context-only 清单上。**Chrome 146 在非安全源
  上保留这两个接口**,只在调用时拒绝。删了就是拿一个差异换另一个差异。这是本系列第二次「先采
  oracle 再动手」拦住了回归。
- **采集的坑**:`127.0.0.1` 和 `localhost` 本身就是 potentially trustworthy,所以 loopback fixture
  **测不出**非安全源。oracle 必须从本机 LAN 地址采。
- **时机的坑**:bootstrap 执行时 `location.href` 还是 `about:blank`,真实 URL 之后才到。首版在
  bootstrap 顶层一次性判定,结果**完全反了**——LAN 源上不收起、loopback 上反而收起。改为
  `isSecureContext` 每次读时求值,破坏性的收起动作推迟到 `__obscura_init`(URL 已知)。
- **验证**:`js-repros/secure-context/` 固化 Chrome 146 oracle,三种源共 108 个观测点全部一致。
  新增 `secure_context_gates_the_same_apis_chrome_gates`。
- **续:`SharedArrayBuffer`(跨源隔离,另一条轴)**。它要的是 COOP+COEP,比 secure context 更严,
  Chrome 在 loopback 上也不给。此前记为「delete 成功但之后被某处重新装回,全仓库没有 Rust 代码
  提到这个名字」——成因是 **V8 自己**:bootstrap.js 是在 startup snapshot **创建时**执行的,而
  `Genesis::InitializeGlobal_sharedarraybuffer`(`v8/src/init/bootstrapper.cc`)会给它构建的每个
  context 都装上这个属性,包括从 snapshot **反序列化**出来的那个。所以没有 Rust 提到它。
  用陷阱抓现行时 V8 的 `DCHECK(!it.IsFound())` 直接崩掉,反而坐实了机制。
  扩采 oracle 又纠正了一处更要紧的预判:**Chrome 并没有移除构造器**,只是不装全局绑定 ——
  `new WebAssembly.Memory({shared:true})` 在非隔离源上成功,其 `buffer.constructor.name` 仍是
  `SharedArrayBuffer`、`toString` 仍是 `[object SharedArrayBuffer]`,只有
  `constructor === globalThis.SharedArrayBuffer` 为 false。`delete` 会对上第一条、错开后三条。
  正解是 V8 为此提供、Chrome 自己也在用的开关:`--enable-sharedarraybuffer-per-context` 把安装
  改为询问 `SetSharedArrayBufferConstructorEnabledCallback`,不注册回调即为「不给」。在
  `v8_flags.rs` 里于第一个 isolate 之前无条件施加。新增
  `shared_array_buffer_is_withheld_the_way_chrome_withholds_it`。
- **暴露出的既有问题**:4 个测试因此失败,原因是**整个测试套件都跑在 `http://example.com`(非安全源)
  上却假设所有 API 可用**——此前根本没有 secure context 概念。新增 `setup_secure_runtime` 供需要
  安全源的测试使用;worker 测试的 `caches` 消失是正确的(其创建者是 http)。另有一个真实泄漏被
  `same_origin_window_proxy_targets_the_live_frame_global` 抓到:我加的
  `globalThis.__obscuraApplySecureContextGating__` 会出现在 `Object.getOwnPropertyNames(window)`
  里,任何页面都能读到「obscura」字样。已改为闭包变量。

#### P3-17 实施记录:SharedWorker 真实现

- **状态**:✅ 完成(`871682b`)。
- **问题**:`SharedWorker` 是空壳类,`port.postMessage` 是空函数——消息发出去就没了,回复永远
  不来,worker 脚本根本没有执行过。
- **实现**:跑在真实 worker 线程上,由 `BrowserContext` 按创建者 origin、name、解析后 URL 和 worker type
  注册并复用一个线程;每个页面构造一条 `MessageChannel`,
  远端桥接到该线程并带连接 id。**直接复用 `MessagePort`** 是关键:`ports[0] instanceof MessagePort`、
  结构化克隆、`start()`/队列门控三件事因此天然正确。worker 侧 scope 品牌为
  `SharedWorkerGlobalScope`,暴露 `onconnect` 而非 `onmessage`,并删掉 scope 级 `postMessage`。
- **验证**:`js-repros/shared-worker/` 固化 Chrome 146 oracle,**40 个观测点全部一致,无已知差异**
  ——覆盖形状、真实消息往返、scope 品牌、同名复用的连接计数、start() 前不投递/后投递,以及跨源
  SecurityError 与非法 URL SyntaxError。
- **顺带修掉的预先存在缺陷**:EventTarget 派发路径把 `ShadowRoot`/`Node`/`Document`/`Element`
  当裸绑定引用,而 worker scope 删除这四个,于是 worker 里**任何 MessagePort 事件派发**都抛
  `ReferenceError: ShadowRoot is not defined`。dedicated worker 从没踩到,是因为它的
  `self.onmessage` 由 worker prep 脚本自己派发,不走页面 bootstrap 的 EventTarget 实现。
- **"共享"的范围**:同一 `BrowserContext` 内跨页面共享;不同 context 保持隔离。连接 id 在 native
  registry 中路由到各页面，页面关闭时自动移除连接。

#### P3-22:系统字体 / video 解码 / PDF 结构——暂缓(2026-08-16)

这三项**不是被遗漏,是明确决定放一放**,等实际出现强依赖(某个必须过的站点真的卡在这里)再完善。
记录各自的卡点,免得将来重新调研一遍:

- **系统字体扫描(§3.5-#22)**:卡在一条有充分理由的既有约束——`crates/obscura-render/src/inline.rs`
  的 `new_with_web_fonts` 明确注释「Never call load_system_fonts: a host's font set would make
  layout differ machine to machine and add a multi-millisecond startup scan」。打开系统字体会让
  布局随机器变化,`render-repros` 的 61 个确定性对拍将集体失效。要做的话正确形态是仿照 WebGL 的
  `OBSCURA_WEBGL_PROFILE=1`,**默认关闭的显式 opt-in**,并接受开启后确定性对拍不适用;
  暴露的字体集合还需与所声称平台绑定(现在 UA 是 Windows,而本机是 macOS 字体)。
  当前状态已不是「方差为零」:canvas 度量已走真实布局(P3-21),内嵌字体给出 3 个 distinct 宽度,
  是「装了很少字体的浏览器」的诚实样子。
- **video 真解码(§3.5-#23)**:需要引入解码器依赖,是新的供应链与二进制体积决策。
  能力**声明**面已对齐 Chrome 且自洽(P3-20),缺的是真解码与封面帧。
- **PDF 结构(§3.5-#24)**:无阻塞点,纯增量工程——需要 PDF 内容流解析出文本层与大纲,
  规模较大。raster 渲染现已可用。

#### P3-21 实施记录:canvas 文本度量走真实布局引擎

- **状态**:✅ 完成(`4060dc8`)。§3.5-#22 的起步。
- **问题**:`measureText` 算的是 `text.length * 6 * scale`,**从不看 font**——每种字体族测出来
  一模一样,canvas 字体指纹方差为零;而且与同一引擎的元素测量直接矛盾(元素测量是区分字体族的)。
  字体枚举是反爬最常用的探测之一,canvas `measureText` 是它的另一半。
- **实现**:`measureText` 通过真实文本布局引擎排版(与元素宽度同一条路径),两者按构造一致;
  无法解析的字体族正确回退到 generic;共有字体的数值落在 Chrome 的 ~0.15px 内
  (`"Arial", monospace`:Chrome 948.87 / obscura 949,修复前 756)。
- **oracle 救回一个正确行为**:`document.fonts.check()` 对包括 `NonexistentFontXYZ123` 在内的
  所有字体返回 true,初看像假成功,差点被「修」掉。Chrome 146 实测同样返回 true——按规范
  `FontFaceSet.check()` 问的是「渲染所需的 `@font-face` 字体是否已加载」,系统字体无需加载所以
  恒为 true。**先采 oracle 再动手,是这个正确行为没有被改错的唯一原因。**
- **未解决且如实记录**:obscura 用内嵌字体而非扫描系统字体,宽度扫描得到 3 个不同值而本机
  Chrome 得到 16 个;未内嵌的字体族解析为 generic。这是「装了很少字体的浏览器」的样子——
  指纹面更小,但不是伪造的。

#### P3-20 实施记录:媒体能力声明自洽

- **状态**:✅ 完成(`3a61507`)。这是 §3.5-#23 的起步(路线图原话「封面帧/几何先支持」),
  同时兑现 §3.2-#13 的「不报假成功」。
- **问题(自相矛盾)**:`canPlayType` 对包括 `video/mp4` 在内的每种类型返回 `""`——没有任何
  Chrome 构建会这样,且会把站点推进「你的浏览器不能播放视频」的降级路径;而
  `mediaCapabilities.decodingInfo` 却返回 `supported`/`smooth`/`powerEfficient` **全 true**,
  宣称硬件加速解码(Chrome 对软件解码报 `powerEfficient: false`)。**同一个引擎两套相反答案,
  比其中任何一个单独看都更像机器人。**
- **方向(经确认)**:能力声明对齐 Chrome,播放行为一如既往地不发生。
  - 声明侧:`canPlayType` 已知容器 → maybe、连 codecs 也已知 → probably、其余 → `""`
    (含 Chrome 同样拒绝的 `video/ogg;codecs="theora"` 与 `video/quicktime`);
    `decodingInfo`/`encodingInfo`/`MediaSource.isTypeSupported` 全部走**同一张表**,
    两个 API 不可能再分家。
  - 行为侧:`play()` 仍 reject(改用 `NotAllowedError`——拒绝是策略而非缺编解码器,也正是
    无用户手势的 headless Chrome 报的错);`readyState` 仍 HAVE_NOTHING,几何仍 0。
- **补齐的缺失成员**:`buffered`/`played`/`seekable`(此前属性根本不存在)、
  `getVideoPlaybackQuality`、`requestVideoFrameCallback`、`MediaSource`。值都是空/零,
  与「不解码」一致。TimeRanges/VideoPlaybackQuality 的属性按 WebIDL 设为 enumerable。
- **验证**:`js-repros/media-capability-honesty/` 固化 Chrome 146 oracle,**77 个观测点全部一致**。
  新增回归测试专门锁「canPlayType 与 decodingInfo 不得再分家」。

#### P3-19 实施记录:worklet 入口

- **状态**:✅ 完成(`552715e`)。
- **问题**:`Worklet` interface object 存在,但下面什么都没挂——没有 `CSS.paintWorklet`,
  `AudioContext` 上也没有 `audioWorklet`。两者在 Chrome 都存在,且都是一行就能做的特征检测。
- **实现**:`CSS.paintWorklet`(稳定单例)、`AudioWorklet` 接口、`AudioContext.prototype` 上的
  `audioWorklet` 访问器(按 context 各自持有,`OfflineAudioContext` 继承同一访问器)。
  `addModule.length` 为 1,无参 reject TypeError。
- **fail-closed 的形态**:这里没有 worklet 运行时,所以 `addModule` 永远失败,用的是 Chrome 对
  「取不到或无法求值的模块」给出的 `AbortError: Unable to load a worklet's module.`(oracle 确认
  404 与跨源两种情况 Chrome 都是它)。让它 resolve 才是撒谎:调用方会就此注册一个永远不会运行的
  paint class 或 audio processor。
- **验证**:`js-repros/worklet-entrypoints/` 固化 Chrome 146 oracle,**39 个观测点全部一致**。

#### P3-18 实施记录:Trusted Types API 面

- **状态**:✅ 完成(`1f963b7`)。**CSP 强制未实现**。
- **核实结果**:§3.2-#12 原记「待核实(存疑项)」——核实为全库零实现,`window.trustedTypes`
  是 undefined,那是 Firefox/Safari 的答案,与这个构建发出的其他每一个 Chrome 信号矛盾。
- **实现**:工厂、策略、三个包装类型和 sink 类型表。brand check 用 WeakMap 成员关系而非原型判定,
  所以 `isHTML(Object.create(TrustedHTML.prototype))` 返回 false——与 Chrome 一致,而这正是这类
  类型存在的意义。策略选项按 WebIDL dictionary 语义在 `createPolicy` 时读取一次。
- **验证**:`js-repros/trusted-types/` 固化 Chrome 146 oracle,**101 个观测点全部一致,无差异**。
- **未实现的部分(不伪装)**:`require-trusted-types-for` 与 `trusted-types` 指令都不生效,因为
  引擎里没有任何 CSP 指令被解析或执行(响应头只是存进 `DocumentInfo.csp` 就结束了)。对不发这类
  策略的文档不可观测——Chrome 那时的 sink 同样宽松,fixture 已确认双方一致。补上它需要 CSP 解析器
  加 sink 插桩。

### P1/P2 实施记录(序 6–15)

- **序 6–7, Debugger/trace 管线**: `crates/obscura-cdp/src/domains/debugger.rs` now owns per-session Debugger, Profiler and HeapProfiler protocol state, emits `Debugger.scriptParsed` on enable/navigation, and returns the common breakpoint/coverage/heap contracts expected by CDP clients. `--trace-op-file` adds a timestamped TSV for DOM, fetch, indexedDB and WebSocket host operations; `--v8-flags` is forwarded to multi-worker serve processes. This is a protocol and diagnostics layer, not a claim that every breakpoint pauses the V8 isolate: the rusty_v8 inspector session bridge remains a follow-up because the current CdpContext dispatch is not inspector-session aware.
- **序 8, WebSocket**: `tokio-tungstenite` provides asynchronous `ws`/`wss` connections, text/binary/close/error event queues, ready-state checks, client close events, and the same private-network host gate used by scripted fetch. The deterministic local echo fixture reports `open`, `message:hello`, and clean close. WebSocket proxy CONNECT and stealth TLS emulation are intentionally documented as remaining work rather than silently bypassing the configured proxy.
- **序 9, configurable input**: `InputStrategy` is an embedder policy (`selector`, activation delay, per-character delay), with no hostname or visible-text matching. It emits trusted pointer/mouse activation and natural input events; `OBSCURA_AUTO_CLICK_SELECTOR` is the CLI default hook. The fixture serializes `pointerdown,click` after DOM-content-loaded scheduling.
- **序 10–11, WebGL/indexedDB**: WebGL stays fail-closed (`null`) unless `OBSCURA_WEBGL_PROFILE=1` opts into a fingerprint-derived value layer. IndexedDB uses origin/name-keyed JSON files under `--storage-dir`, with asynchronous requests, version upgrades, object stores, basic CRUD, `deleteDatabase`, and `databases`.
- **序 12–13, transport**: reqwest is built with HTTP/2 support and explicit proxy builders use `NoProxy::from_env`; the same bypass is applied to scripted fetch and stealth/wreq. Invalid explicit proxy URLs are surfaced as warnings. ALPN/TLS packet-level comparison requires an HTTPS fixture and Chrome oracle unavailable on this host.
- **序 14–15, forms/layout**: label `control` and control `labels` follow tree scope and labelability rules, and uncanceled programmatic label activation forwards to the control. Retained frame `PreparedRender` snapshots are reused by paint, geometry and scroll metrics and invalidated by document generation, viewport, animation sample, or connected DOM mutation.

**Verification boundary**: Chrome/Chromium executables are not installed on the current host, so the new `js-repros` READMEs explicitly mark Chrome 146 oracle capture as pending. Deterministic Obscura fixture probes and release `nextest` remain the local evidence; no synthetic Chrome oracle JSON is claimed.

> **更新(P3 阶段)**:本机现已装有 Google Chrome 146.0.7680.80
> (`/Applications/Google Chrome.app`),P3 的三个 fixture 均已用它采到真实 oracle。
> 上面这条边界是 P1/P2 提交当时的事实,其 fixture 的 oracle 仍标记为 pending——**它们现在可以补采了**,
> 这是一项明确的后续工作。P0-4 记录(§P0-4)里"当前机器没有 Chrome 可执行文件"同理。
>
> 采集方式见 `js-repros/*/capture-chrome.mjs`:headless Chrome + CDP,
> 需要真实 origin 的能力(ServiceWorker、SharedWorker)由脚本自带 loopback HTTP server。

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

### 门禁盲区(P3 阶段发现)

1. **默认 feature 集从未被编译验证**。门禁只跑 `render` 与 `render,stealth` 两种组合,于是
   `obscura-js` 在不带任何 feature 时编译失败(`ReferrerPolicy` 的导入挂在 `#[cfg(feature = "render")]`
   下,而用它的 `op_fetch_url` 不受门控)长期无人发现。已修(`86151f8`);建议门禁补一条
   `cargo check -p obscura-js`(无 feature)。
2. **带 stealth 时 `obscura-net` 有两条测试稳定失败**:`stealth_client_decodes_gzip_response` 与
   `stealth_request_uses_the_same_derived_low_entropy_identity`,报
   `Access to private/internal IP address 127.0.0.1 is not allowed`——它们用 loopback fixture server,
   而 `wreq_client.rs:253` 的 `validate_url(url, false)` 硬编码拒绝私网。此前记录的
   "obscura-net 83/83 通过"是**不带 stealth feature**跑出来的,那时这两条根本没被编译进去。
   与 P3 改动无关,但需要单独处理。
3. ~~**时序测试在并发负载下不稳**~~ **已修**。`autonomous_event_loop_delivers_timers_after_a_cancelled_navigation_poll`
   全量并发下约三次失败一次。抓到的失败形态是决定性的:
   `events: [[50, 163.2], [100, 163.2]]`、`chain: [2.1, 2.8, 163.1]`——两个 timer 落在**同一时刻**、
   嵌套链从 2.8ms 直接跳到 163ms,这不是 timer 迟到,是整个线程被抢占约 160ms 后所有 timer 一起补发。
   放宽 35ms 容差会正好盖住这些测试要抓的回归(§3.1-#5 的 600–2500ms 迟发),所以修的是竞争而不是断言:
   `.config/nextest.toml` 把时序敏感测试归入 `threads-required = "num-test-threads"` 的组,让它们独占机器。
   连跑三次全量 744/744,代价是总耗时 8.5s → 11s。
4. **本地门禁已落地(仓库无 CI 跑测试)**。`.github/workflows/` 只有 `docker.yml` 与 `release.yml`,
   两者都只 `cargo build`,**没有任何自动化跑过这 744 个测试**。已加 `.githooks/pre-push`,一次安装:

   ```bash
   git config core.hooksPath .githooks
   ```

   它跑四件事:①`--no-default-features` 的 `cargo check`(第 1 条那个错误能长期存活的唯一原因;
   `stealth` 进入 `default` 后,没人构建的形态从「默认」变成了「显式关掉默认」,这一步已相应
   反转);②obscura-js/browser/cdp 全量 nextest;③**obscura-render 的两种 feature 形态**(见下);
   ④`Cargo.lock` 前后哈希比对(第 5 条那个坑,本轮我自己踩了两次)。hook 内所有 cargo 命令都带
   `--config vendor/v8-source.toml`——否则门禁本身就成了改写 `Cargo.lock` 的元凶。
   `SKIP_OBSCURA_PREPUSH=1 git push` 可显式跳过。

   **feature 形态错配(与第 1 条同源,方向相反)**。obscura-render 有 28 个测试断言真实文字排版
   几何,而形状化(cosmic-text)在 `paint` feature 后面、默认关闭。它们没加 `#[cfg(feature = "paint")]`,
   于是在默认构建里被编译并运行,量到的是 fallback advance,必然失败——`canonical_inline_fragments_
   shape_with_the_loaded_webfont` 的报错原文就是「the loaded face's advances must drive fallback
   inline geometry / left: 176.0 right: 176.0」(断言的是 `!=`)。第 1 条是「某个 feature 组合从没
   被构建过,于是编译错误存活」;这一条是「某个 feature 组合从没被构建过,于是测试常年红着」。
   两者的根因同一个:没有任何东西按 feature 矩阵跑。
   补 cfg 后默认 372/372、`paint` 586/586。而 `paint` 形态**从来没被跑过**这件事本身还藏着一个真
   bug:`paint::tests::a_checkbox_and_a_radio_paint_their_platform_look` 的谓词写作 `b > r + 40`,
   `r` 是 `u8`,扫到白像素就 `attempt to add with overflow`——debug 下 panic,release 下更糟,
   wrap 成 39 之后这个谓词会匹配上它本该排除的像素,测试假通过。改用 `b.saturating_sub(r) > 40`。
   hook 现在两种形态都跑,只跑一种会让另一半继续烂。

   **把 render 加进门禁后立刻换来的第二个发现**:`page_transport_prefetches_once_and_capture_
   reuses_the_bytes` 在并发下约每 10 次失败 1 次。它的 fixture 是个手写的 TCP 服务器,读一次、
   写一次、`return`。三个独立缺陷叠在一起,失败形态都是 `loaded == 0`:
   ① 一次 `read` 在忙机器上可能只拿到半个请求头,而带着未读字节 close socket,内核发的是 RST
   不是 FIN,客户端于是把一个服务器确实应答了的请求报成失败(`prefetch connection: Ok(())` 但
   `loaded` 0);② hyper 可能在同一连接上再发一个请求,而「应答一次之后只 drain」会让它收到
   `received unexpected message from connection`;③ 非阻塞 `accept` 在忙机器上会返回 EINTR,而
   `Err(_) => return` 在这个 errno 上把 listener 也丢了 —— 连带丢掉 backlog 里那个已经完成握手
   的连接,客户端读到 EOF(`connection closed before message completed`),而服务器侧计数还是 0。
   三个都修掉之后 40 轮 0 失败(修之前 40 轮 4 次)。定位靠的是把断言信息从 `loaded` 一个数字
   扩成「服务器收到几个请求 / prefetch 用掉了 1000ms 预算里的多少」——1.6ms 用掉 1000ms 预算这
   一条直接排除了「超时」这个最省事的解释。诊断信息已留在断言里。
   **另有两个既有 flaky 未修,均未拿到失败输出,因此不臆断成因、也不往 timing-sensitive 组里
   塞**(那个文件的注释明确警告过:不要为了消音而加豁免):
   - `autonomous_event_loop_delivers_timers_after_a_cancelled_navigation_poll`:40 轮里 2 次;
     它**已经**在 timing-sensitive 组里,说明 `threads-required` 这一手没能完全消除竞争。
     单独复现 25 轮未中。
   - `intersection_observer_tracks_viewport_threshold_crossings`:一次 pre-push 里撞到 1 次。
     它用 `setTimeout` 25/50/80ms 编排三个阶段,形态上像抢占(两次 scroll 合并进一次调度会让
     中间那条 record 消失),但 obscura-js 单跑 12 轮、js+browser+cdp 同跑 10 轮都未复现,
     没有输出就没有定论。
5. **js-repros fixture 已部分接入门禁**。12 个 fixture 共 577 个 Chrome 观测点,此前**没有任何代码
   读过它们**——是「碰巧含有数据的文档」,只在有人记得照 README 敲命令时才被验证过(对比:
   `render-repros` 是被 `layout_test.rs:314` 真正 `include_str!` 的)。已加
   `assert_probe_matches_chrome_oracle`,直接 `include_str!` probe 与 oracle 并逐字段递归比对,
   已接入 5 个 fixture 共 **248 个观测点**(trusted-types 96、media-capability 77、worklet 39、
   shared-worker 22、private-state 14),耗时 &lt;1s。helper 同时兼容两代 fixture 约定(早期把观测值
   包在 `result` 里、外裹 `browser`/`captured` 元数据,后期直接放顶层),并会在「某条
   known_difference 已经和 Chrome 一致」时报错,防止豁免清单变成回归的藏身处。shared-worker 需要
   HTTP 提供 `/shared-worker.js`(blob URL 测的是另一回事 —— 连接计数只有在同一个 URL 到达同一个
   worker 时才证明复用),用内联 TCP server 供给,零 known difference 一次通过。
   另有 timer-fidelity 以另一种方式接入:它的 `elapsed`/`chain` 是一次真实墙钟抓取,oracle 自己的
   `note` 就写明不做精确比对——逐字段相等等于断言「这台机器和录制那台一样快」。改为读它真正固化的
   性质:回调顺序与各自的 deadline、迟到上界(35ms,从 capture 里读出而非写死在测试里)、以及
   嵌套零延迟地板的跳变位置。引擎与 Chrome 都在第 6 层之后开始被 clamp。该测试已加入
   `.config/nextest.toml` 的 timing-sensitive 组。
   仍未接入的 4 个各有具体原因(已写进代码注释,不是「以后再说」):font-fingerprint 需要数值容差
   (内嵌字体 vs 系统字体,98 个值全部差 ~2px,是设计决定);fingerprint-derivation 需要真实
   iframe realm;service-worker 需要能按需返回特定状态码/MIME/重定向的 HTTP server(其判定链已由
   `service_worker_registration_fetches_the_script_before_refusing` 覆盖);secure-context 需要一次
   运行里三种不同源(已由 `secure_context_gates_the_same_apis_chrome_gates` 与
   `shared_array_buffer_is_withheld_the_way_chrome_withholds_it` 覆盖)。stack-realm-referrer 横跨
   四个文档(same.html/cross.html/外部脚本/样式表),performance-timeline 需要「被服务的页面 + 被
   服务的子资源」才能让 resource entry 有真实网络分段可报,且没有可 await 的 promise 全局。
6. **构建必须带 V8 补丁配置**。任何不带 `--config vendor/v8-source.toml` 的
   `cargo build`/`nextest` 会静默把 `target/release/obscura` 换成非 patched V8,trace 输出随之
   变空(见 `Trace-page-script.md`)。同时它会改写 `Cargo.lock` 里 `v8` 的 source/checksum——
   那两行的缺失是有意的,不要提交回去。该文件同时带 `[patch.crates-io]` 和 `V8_FROM_SOURCE=1`,
   两者必须成对出现:只给 patch 不给环境变量会以 `gen/src_binding_release_<target>.rs` 缺失
   报错,而那个报错和真实原因毫无关系。

## 7. 与现有工作的衔接

- `Cloudflare-challenge-profile.md` 继续作为诊断记录;`600010` 根因待查(不归入本路线图,但预计会落在 §3.1 行为保真域)。
- 每补一个 P0/P1 能力,回填 profile 文档对应 step(如 step 10 → Performance Timeline;step 39 → PAT API)。
- 新 Web API / CDP 方法仍走 [Adding-a-CDP-method-or-Web-API](Adding-a-CDP-method-or-Web-API.md) 流程,本路线图只定优先级与形态。
- 验收口径:每个 P0 能力合入时附"通用性自检"——去掉所有 CF 上下文后该能力是否依然成立(即:实现里不出现 challenge-platform 等站点字符串)。
