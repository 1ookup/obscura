# Cloudflare 挑战：诊断记录

针对 `zencare.co` 的 Cloudflare Turnstile 托管质询（5 秒盾）的逐步排查记录。
按 step 追加，每步记录**假设 / 方法 / 证据 / 结论**。被证伪的假设一并保留——
它们标出了不必再走的路。

当前状态（2026-09-17，step 297，调查中）：**质询仍未通过，唯一成功判据为目标 URL 真实 404**。
指定代理可达；带点击的单轮在 30s 预算内稳定完成三次 `/fo/` 提交（顶层 #1、widget #1、widget #2 证明），
此后停滞；75s 窗口同样停在同一处，因此是「停住」而不是「太慢」。
停滞点已收敛到**一条语句**：widget 在收到证明响应后的程序里 `new Worker(blob:)` 之后不再前进，
调用方既没有 `push`、没有赋 `onmessage`、也没有 `postMessage`（Proxy 观测下对该 worker 零属性读写）。
参考同一阶段是 5 个 worker 连发并在 ~215µs 内 `push → onmessage → postMessage`，116ms 后收到 `graIf9` 结果。
四个候选机制已逐一实测排除：worker 回复被空批次抛弃（实测均为 `outbox-closed`，无瞬时争用）、
V8 watchdog 静默切断（两个 watchdog 均未触发）、跨 realm `postMessage` 投递失败（双向心跳 seq 到 31+ 正常）、
blob worker fan-out 本身不可用（本地同形 fixture 5/5 回复正常）。
页面停在 `honk` eval 等待循环（`0, /.*honk.*/, <ts>`，前导 1337331 空格）——参考也走同一循环，不是分岔。
**step 290 新增**：修掉 caption/表格宽度协商的两层——① 原生 table 无行时
`build_table` 直接 `return None`（退化成普通块拉伸 1264/0），caption-only 表格
现在合成一行、caption 作为单元盒进 grid；② 表格 grid 节点 width auto 时
`align_self: FLEX_START`（CSS 表格是 shrink-to-fit，不随块级拉伸）。双引擎对拍：
table 0/1264 → 63（Chrome 60.313，与容器宽度无关）；caption 4 → 37.844
（Chrome 39.516；残差 ~1.7px 为字形 advance、高度差 4px 为竖向边框细节，
与 p9 的 0.5px 文本噪声同级）。render 589/589。
**step 291 新增**：复查 192.168.3.57 反汇编文档仍为 Sep 16 22:31 版本
（无 timer/timing 族新文件，uGyjw9/ZMSOw0/tZwbF3 归属继续挂起）。会话轮换后
再跑一轮 30s 点击流程：判决不变（8 次 /fo/、收官 3240B、无 POST /1.txt），
PWGF4 t=59ms 为历轮最佳；两条 cf_clearance 均为失败路径下发（按判定口径非
通过证据）。
**step 294 新增**：远端反汇编文档连续三次复查无更新。caption「竖向边框未计入」
的前提被计算样式证伪：border 已计入（content 25 + 2+2 = 29），4px 高度差的真因是
**shaping 字体度量**——caption 文本用捆绑 Liberation 的 hhea 排版（行高 25、
advance 33.8），Chrome 用 PingFang SC（29、35.5）。修复方向 = identity 感知的
shaping 字体加载（macOS 身份下装载系统 PingFang SC 参与 shaping），属字体层工程。
会话轮换后再跑 30s 点击流程：判决不变（8 次 /fo/、收官 3240B、无 POST /1.txt），
PWGF4 t=279ms。
**step 296 新增**：identity 感知 shaping 字体加载已落地但**本机不生效**——
第五次复查远端文档仍无更新；实现为引擎构建时装载 `/System/Library/Fonts/PingFang.ttc`
的 SC 面到内部家族 `__obscura_system_pingfang`、shaping 解析（resolve_loaded_font
fallback）在 macOS 身份下优先选取，**但本机没有该文件**（受限系统只有
STHeiti/Hiragino GB），故 caption 行高差（shaping Liberation 25 vs Chrome 替换字体 29）
保持原状；宿主有 PingFang 的部署即自动生效。剩余收敛路径：IFC leaf 高度按
`lines × used_line_height` 抬升，或捆绑一个 PingFang 度量的替代字体。
30s 流程：8 次 /fo/、收官 3240B、无 POST /1.txt，PWGF4 t=285ms。
**step 297 新增**：PWGF4 投递残差根因定位并修复——timers 全 trace 抓到
`next_timeout_ms=Some(0.0)` 却 `delivered=0`、repair 循环上百次不投递：deno_core
的 mutable timer sleep 持有过期 waker，yield-only op 唤醒不重置 sleep。修复：repair
时额外入队一个一次性 0ms 丢弃 timer，强制 `queue_timer` 走 `change(now)` 将 sleep
标记 ready（runtime.rs）。修复轮实测 PWGF4 t=**5ms**（历史 548→59-516），与 Chrome
的 1ms 同级；后续 183/1009 的散布为挑战流程调用顺序方差（onload 已早触发），非
投递延迟。套件：obscura-js 618/621、browser 124/125（既有失败不变）。
**step 289 新增**：插桩 `frame_geometry_json`（OBSCURA_GEOM_DEBUG=1，dump
cssom/rects/transform/out）命中 p1 归零根因：`Affine2::around` 把 origin 折叠进矩阵时
`e = ox×(1−a)` 在 scale 1e35 下 ≈1e39 溢出 f32 → e=inf、f=NaN，之后所有角点
inf−inf=NaN → 序列化 null → JS 全零。修复：`around` 折叠平移饱和到 f32 界 +
`map_rect` 角点改 f64 中间运算、末端饱和（f32 角点会同时饱和到同值、宽塌成 0）。
双引擎对拍 p1 gBCR height/y 364.77/−35.885 与 Chrome 逐位一致、宽度为有限巨大值
（33554430 vs 6.8e32，各自引擎钳位上限，类别相同）——挑战探针 **10/10 OK**。
caption 4 vs 39.5 仍开放（表格宽度协商架构项）。
**step 288 新增**：修掉 summary 的 disclosure marker——UA 默认给 summary 装
before 生成盒（`style.rs`，`before_pseudo = marker`），`dom.rs` 在样式表伪元素提取
为空时保留 UA 元素默认（否则被无条件覆写）。双引擎对拍 details/summary/p5 全部
与 Chrome 一致（66=66、[4,70]=[4,70]），挑战探针 10 项里 9 项 OK。`map_rect`
输出做饱和（非有限值钳到 f32 界；CSSOM 序列化 null → JS 全零回退是更强 tell）。
p1 gBCR 仍 0：computed transform 解析正确（matrix(1e35,…))，归零发生在 geometry
op 链更深处（`compute_absolute_unrounded_rects` 之后的某个环节），待插桩定位。
caption 4 vs 39.5 仍未修（caption 需在 grid 之外独立成盒并参与表格宽度协商——
表格布局架构工作）。
**step 287 新增**：修掉「仅含内联级原子盒的块没有匿名行盒 strut」——① `dom.rs` 的
run 包装器 strut 不再以「run 含文本节点」为条件（CSS 行盒无条件带块的 strut），
img-only 块 16 → 22；② `style.rs` 给 progress/meter 补 UA 默认 `inline-block`
（此前落为 block，根本不进 Run）。双引擎对拍：挑战探针 p6 26=26、p7 27≈26 转 OK，
img-only/progress-only 块 22=22；render 套 589/589 无回归。PWGF4 t 本轮实测 **67ms**
（548 → 114-354 → 67）。仍未修：p5 details 48 vs 70（Chrome 的 summary 是
list-item，0 宽下 marker 行多出一行，66=3×22 vs 我们 44）、caption 4 vs 39.5
（caption 文本未参与表格 shrink-to-fit）、gBCR 病态 scale 0 vs 6.8e32。
**step 286 新增**：修掉 offsetWidth/offsetHeight 与 transform 的纠缠（`ops.rs`
geometry JSON 增加 transform-free 的 `layoutWidth/layoutHeight`，`element-object.js` 的
offset* 优先读取；双引擎对拍 `p1` scale(1e32) 下 offset [4,193] 与 Chrome 逐值一致，
修复前是 33554430/0）。gBCR 在病态 scale 下仍为 0（transformed rect 二进制32 溢出 →
序列化为 null → JS 端全零回退；Chrome 用饱和的 layout 单位答 6.8e32，未复刻）。
新表征一处一类缺口：**仅含内联级原子盒的块没有匿名 IFC strut**（img-only/progress-only
块高 = 原子高 16，Chrome 答 max(strut 22, …)=22；`is_pure_text_ifc` 拒绝原子 → taffy
直排）——挑战探针 p5 details 48 vs 70、p6 progress 20 vs 26、p7 select 23 vs 26 全部
由此而来。修复需要给「全原子子div」合成匿名行盒，动核心布局构建器，留作下一轮。
**step 285 新增**：带点击的 30s 轮已稳定走完全部五次 `/fo/` 提交，服务端在顶层收官 `/fo/`
（3240B vs 参考 3660B）后仍回「重开一轮」而非 `POST /1.txt`。两处修复：① 解析脚本排队的页面
timer 现在在 DCL 边界投递（`page.rs`，api.js 用 `setTimeout(0)` 派发 onload 回调，`PWGF4[0].t`
548ms → 114-354ms，残差是 chl_page 自己的 `/fo/` 等待与 VM 吞吐）；② macOS 身份的默认字体度量
改用 PingFang SC hhea（`inline.rs`，挑战自有布局探针（ENV-DETECT pc 204513-207205 重建）的行盒
高度与 Chrome 逐值一致：p2 92=92、p4 55.938=55.938 等）。新发现未修缺陷：serve+CDP 导航
loopback URL 提交空文档（`--allow-private-network` 与环境变量都不生效）。
**step 275 新增**：拿到本会话**第一个运行时 `(pc,key,op)` trace**（24200 个状态，入口 `pc=0,key=121,op=17`，
解码常数 `+251`），并据此证明操作者的 spec 是**按 build 生成**的：其 69 op 表与本 build 只有 26 个重合，
`keyRunInit=241` 对我们是错的，所以静态管线必然只出 1 个状态、`dynamicReachable=0`、操作数全是 `h[?]`。
入口 handler 是**分支型**（`widthByBranch=[5,2,3,2,2,2]`），宽度必须由运行时状态决定 ⇒ `pcstates` 是必需输入
而非加速器。同时纠正 step 274 的「94.58% 覆盖率」：任一 pc 上 256 个 key 里有 69 个能解出合法 op，
该比例几乎无鉴别力，不构成「解出一条连贯路径」的证据。
**step 281 新增**：用「同一 fixture 两个引擎对跑」的方式做表面对拍，修掉两处——`Screen.prototype` 多出 4 个自有属性（Chrome 的 12 个名字现在完全一致，方法改为继承）、`Document` 缺 5 个 legacy 颜色属性（Chrome 返回 `""`，我们原本 undefined）；并记录仍未修的命名差异（window 插入顺序第 61 位起不同、多出 8 个 `SharedStorage*` 全局、缺 `navigator.cpuPerformance`/`HTMLCameraElement`/`HTMLMicrophoneElement`、`Document.prototype.location` 位置、渲染计时 1ms vs 548ms）。
**step 280 新增**：用 `Target.setAutoAttach` 抓到真实 Chrome 的 payload 字段（341 个带标签字段），逐项对拍后发现并修复两处存储组差异——`navigator.storage.estimate().quota` 在 **worker realm** 里是平 5GB（参考 10 GiB，`RPKTR7`），以及 `flush()` 成本为 0（参考 0.54ms，`uUOw3`）；两处都已在 live payload 里核实为 `10737418240` 与 `0.6`。
**step 279 新增**：插桩改为**只挂宿主面**（`Worker`/`Blob`，注入到文档自身的 nonce `<script>`），不再解析
VM 的混淆代码，因此不再受会话轮换影响；据此拿到**当前**变体的完整探针集（含两个此前未见的探针：`eval("debugger")`
与一个 4×3 计时矩阵 `jixMq8`，以及 5 个 worker 的 `graIf9` 结果——**五个结果都回来了**，step 271 的「new Worker
之后调用方提前返回」已被推翻，停点更靠后）。另用真实 Chrome 走**同一代理同一 URL**带点击对拍：Chrome（有头/无头）
当前只走到**顶层 `/fo/` #1 + widget 文档**就停住，一次 widget 提交都没有，而 Obscura 能走完 8 次 `/fo/` 并两次
拿到 `cf_clearance` ⇒ **当前环境下 Chrome 比我们走得更短**，所以「stage-3 变短」不能单独作为 Obscura 特有指纹的
证据（能产出参考那份成功抓包的客户端现在也走不到那一步）。
**step 278 新增**：把所有**能命名**的探针输入与参考侧逐项对拍，结论是**全部一致**：时钟分辨率两边都是
0.1ms（文档与 worker 两个 realm 都用真实 Chrome 跑同一 fixture 比对；参考 trace 里的 15µs 是插桩 build 的
钳位前内部值）、navigator 字段一致（参考的 `Navigator.languages` 也是长度 1）、PAT 探针两边都是
`401 + PrivateToken challenge` 且都不带 auth 头、brunhild 跨域抓取参考侧同样是 `status 0` 失败、请求清单与
参考 HAR 同类同量。OPFS `flush()` 按参考实测修正为**亚分辨率 0ms**（Chrome `flush` 实测仅 12µs，写入 477µs、
关闭 76µs），文件后端保留。另发现 **widget 文档按会话轮换**（409959 → 449509B，解码常数 251 → 57），
旧插桩锚点失效；按 build 稳定的锚点是 `arr[pc++]` 字节码读与 `case <op>: <obj>[<lookup>](this)` 的 switch。
**step 272 新增**：turnstile widget 文档被请求两次的机制已定位并修复——不是重复 attach（该 host 只有一次
提交导航），而是 `Critical-CH` 重试在客户端内部把同一请求发了第二遍；参考（Chrome）面对同样的
`Accept-CH`/`Critical-CH` 只发一次。修复后 widget 文档请求 2→1（3 轮实测，修前 2/2/4）。
但**实测该重复与停滞无关**：请求数为 1 的轮次同样停在三次提交之后，因此它是独立缺陷而非停滞的原因或症状。
本轮还确认证明载荷的字段面与参考逐名一致（53 个非数字名全同，仅记录顺序与两个列表长度不同）。
新增 `OBSCURA_DEBUG_FRAMES`（host 侧 opt-in，报每条 frame 导航路由、每次 attach、每次提交导航）。
待解：仍要给当前会话的 widget 程序在 `TH.yg` 处做程序侧插桩（build 每会话重随机）；
另记一处未归因隐患——`navigate_frame_inner` 的 nested discovery 不查 `frames.by_host`，三轮回放未复现。
**step 273 新增（程序侧直接测量）**：`runProgram(text,b)` 只**构造**程序并返回执行器（3-24ms，返回 native 函数），
每个程序的执行器被**调用一次**并同步返回 `undefined`；答复证明的 71571B 程序跑 **107ms**，其全部可观测宿主活动是
`revokeObjectURL → new Blob(292) → createObjectURL → new Worker(blob:) → return`，既不赋 `onmessage` 也不发
`postMessage`，且未注册任何续体 ⇒ 调用方不执行参考侧三步的原因是**它返回了**（不是被阻塞、不是丢消息、不是被切断）。
参考同一阶段窗口单独就有 9 个 Blob / 58 次 createObjectURL / 5 个 Worker 之后才 push→onmessage→postMessage。
另测出 **native 属性 trace 无法用于该阶段**：`--trace-api-keyed off`（175MB）与 `keyed on + filter URL,Blob,Worker`
（160MB）两种配置下都**一次 `/fo/` POST 都到不了**，trace 自身开销先把流程掐死。
另测出流程是**会话相关**的：有一轮完整走完 5 次提交（widget #3 resp 5136、顶层收官 resp 3240，参考 7164/3660），
即 step 262 的「更短 clearance」在现 build 复现，之后页面**开新一轮**而非 POST 表单到 `/1.txt`。
本轮打通并验证了本会话程序的解码+反汇编管线（7 个响应全部 b64frac=1.000；`bc_02` 用操作者 spec 解出 94.58% 字节
覆盖、0 unresolved、17356 条指令），并确认**宿主 API 名不在字节码里**（`bc_01`/`bc_02` 都搜不到 Worker/postMessage/Blob）
⇒ 下一次归因必须「程序 + 解释器（widget 文档）」一起读。
**step 274 新增**：本地代理跳（direct vs hopped，各 3 轮）**不改变结果**，两臂都是 3 次 `/fo/` POST 后停滞
⇒ 三次提交停滞是常态，step 273 那次走完 5 次提交是会话运气（本会话约 1/8），两个失败签名都真实存在。
实测出一处**具体引擎缺陷**：worker realm 里 OPFS 同步句柄 `write`/`flush` 都是 **0 ms**
（逐字节 fixture：`writeMs:0, flushMs:0`），而参考同模式测得 **10.6 ms**（即 payload 里的 `uUOw3`）；
形状是对的（`storage_manager_and_origin_private_file_system_match_chrome_shape` 通过），但
`flush()` 只是 `syncData(this)`（worker.rs:1174），文件节点是内存里的 `Uint8Array`，**从不落盘**。
（API 在页面 realm 不存在是正确的：Chrome 同样只在 worker 暴露。）
另**证伪**「handoff literals」读法：用参考自身 HAR 解出它五个 `/fo/` 响应（全部 b64frac=1.000），
两侧的 stage-3 程序都搜不到 `postMessage`/`_cf_chl_opt`/`widgetId`/`token`/`source`；
且 stage-2 程序两侧仅差 7 字节（71571 vs 71564）却行为不同 ⇒ **分岔输入不在程序文本里**，是更早读到的值。
另测出**静态读分支不可得**：操作者反汇编器把我们的 blob 渲染出 94.58% 覆盖、0 unresolved，但所有操作数都是
`h[?]`——anchors 输入带的是每 pc 的**代表键**而非入口链推导键，我们的 blob `dynamicReachable=0`。
三条程序侧路线（native trace 成本、handoff literals、静态操作数）均已实测关闭，剩下的是**本会话的运行时
`(pc,key)` trace**（操作者管线正是从 `ov1-N-pcstates.jsonl` 取这个）。

历史状态（2026-09-13，step 256）：指定代理当前可达，console-op trace持续取得完整payload；
初始 about:blank 的 Window origin、document.domain 和 referrer 继承错误已修复，三轮真实 payload 验证通过。
Document.adoptedStyleSheets描述符也已修复，三轮payload均恢复该路径；设备对齐后仍有11项原始参考差异。
CDP实际点击触发目标二次导航，仍为HTTP403 challenge，后续需继续对拍完整payload行为差异。
本轮继续参考 HaHaVM-General 并修复 wreq Critical-CH 重复头、跨源 iframe 初始隔离位、初始 about:blank
兼容模式及可配置屏幕工作区指标；最新 payload 已对齐 `crossOriginIsolated=F`、`compatMode=BackCompat`、
`screen.availTop=30`、DPR/语言/UA-CH 关键值。通过真实点击可执行
frame proof/PAT/top proof，但 `brunhild.challenges.cloudflare.com` 经 `192.168.3.57:9000` 仍返回 `502`，
页面换 ray，尚无目标 404。剩余分歧继续以明文 payload/事件时序对拍，不增加域名特判。
step128存档：XHR修复与完整门通过，proof/top/new-ray链完整但仍无404。
参考HaHaVM-General的XHR接口分层继续审计，已确认Obscura实例泄漏状态/请求/监听器字段、upload为普通
对象且prototype层级错误；下一步以Chrome151完整shape/state oracle限定通用修复范围，不迁HaHa固定请求头。
step130存档：参考HaHaVM-General继续核对Blob/Worker环境后，Obscura补齐Blob URL本地fetch的二进制GET/HEAD、
Response元数据、MIME、Request输入和revoke生命周期，focused回归1/1通过，已有Blob Worker回归也通过。
零预注入真实轮在新Reqable CA下完整走完fo/proof链但仍换ray；`tQcZu4`仍为`fetch_error`，Chrome对应为`timeout`。
两边均未收到 `brunhild/.../i` 的response，当前差异由代理侧502/请求取消时序造成，不能据此增加站点特判。
workspace nextest在shadow identity既有测试超过180秒中止，936通过/4失败/4 skipped/755未运行，完整门待后续清理。
step131：修复 `Allow-CSP-From` 的通用 origin 比较。旧逻辑按原始字符串精确匹配，会误拒大小写不同、默认
端口或尾随 `/` 的合法来源；现在解析 URL origin，拒绝凭据、路径、query、fragment和 opaque `null`，保留 `*`。
`allow_csp_from_compares_origins_not_raw_header_strings` 与完整 embedded-CSP focused 均通过（2/2）。
当前 Reqable CA 下零注入真实轮仍完整产生 proof/top/new-ray 后换 ray，没有 404；该修复未改变真实挑战结果，
因为目标 Turnstile iframe 不携带 `csp`，仍不能作为当前站点阻塞根因。
step132：参考 HaHaVM-General 的独立 HTMLIFrameElement 原型，Obscura 不再把 `HTMLIFrameElement` 别名为
`Element`。新增专属 wrapper、Chrome 24 项 prototype 顺序/descriptor/brand、iframe 专属属性与节点映射，
并保留 frame navigation/CSP/跨 realm 行为；shape focused、iframe navigation/CSP focused 与 obscura-js
552 项（排除已知 shadow identity hang）均通过。真实 clean click 仍 proof/top/new-ray 后换 ray，没有 404。
step133：Chrome/iframe 矩阵确认 `crossOriginIsolated` 是每个 Document 的状态：about:blank/srcdoc 继承父值，
network iframe 依据自身 COOP/COEP。Obscura 将该值加入 `DocumentScope`，network frame 从响应头计算，
blank/srcdoc 继承，frame realm 的 `document_scope_info` 改读 scope 值；隔离 focused 与 workspace 排除 hang 的
1696/1696 全部通过。当前 Reqable CA 下真实 clean click 仍无 404，继续保留网络失败时序为未决。
step134：在最终 release 二进制上复测 iframe 原型清理与 frame-level isolation；零预注入 clean click 仍稳定产生
8 次 `/fo/`（含 proof/top/new-ray），页面显示 `Verification successful` 后换 ray，最终 URL 仍未真实返回404。
这确认本轮 iframe 通用修复无回归，但也未改变当前代理/挑战失败判定。

### Step 135 — Chrome 152 长尾接口面收敛（2026-09-02，完成）

**假设**：当前 Chrome/Obscura 明文 payload 的 `N`/`o` 桶仍有稳定构造器差异；这些差异来自通用接口表，
不是 `brunhild` 网络失败本身。参考 HaHaVM-General 的全局接口壳，并以当前 Chrome 152 CDP descriptor oracle
确认具体形状。

**方法与证据**：Chrome 多出 `XSLTProcessor`、`HTMLUserMediaElement`、`InteractionContentfulPaint`、
`PerformanceSoftNavigation`、`NodeRange`、`OpaqueRange`。其中 XSLTProcessor 可构造，其余为 illegal constructor；
原型父级分别为 Object、HTMLElement、PerformanceEntry、PerformanceEntry、AbstractRange、AbstractRange，
并核对了公开 accessor/method 名称、length、brand。Obscura 同时多出当前 Chrome 不公开的 `ModelContext`、
`WebMCPEvent` 及 `navigator.modelContext`。

**修复**：扩展 `_chromeInterfaceTable`，为六个接口安装 Chrome 152 的原型成员和 native descriptor；移除
`ModelContext`/`WebMCPEvent` 及 `navigator.modelContext` 壳。实现位于 `crates/obscura-js/js/bootstrap.js`，
未加入目标域名逻辑。

**量化结果**：同轮零注入 payload 的 `N` 桶由 1167 收敛到 Chrome 的 1171，`o` 桶由 121 收敛到 120；
六个构造器均为 `function`，两个旧壳为 `undefined`。无注入真实导航仍完整产生初始 fo、proof/top 转发并在
`Verification successful` 后换 ray，`tQcZu4` 仍为 `fetch_error`（Chrome 为 `timeout`），目标未返回真实 404。

**结论**：长尾全局接口差异已闭环且无回归，但不是当前 404 的唯一阻塞；剩余分歧继续限定在
`brunhild/.../i` 请求的网络失败/取消时序，禁止加入站点特判。

### Step 136 — 请求头/事件/worker 环境收尾与外部网络盲区（2026-09-02，调查中）

**假设**：HaHaVM-General 对 worker creator origin、Window event 和脚本请求元数据的处理，仍可能与
Obscura 在当前 Chrome 152 质询中存在通用差异；这些应先由独立回归和请求头观测确认，不能用目标域名逻辑补偿。

**修复与证据**：Obscura 现在在事件 dispatch 期间暴露当前 `window.event`，空闲时恢复 `undefined`，并在
worker `fire()` 中同样设置/恢复；blob/data worker 的环境优先继承 creator origin；stealth scripted fetch
补齐 `Accept`、`Accept-Language`、`Sec-Fetch-Site`、`Sec-Fetch-Mode`、`Sec-Fetch-Dest`。Chrome 152
长尾接口表同时补齐 `XSLTProcessor`、`HTMLUserMediaElement`、`InteractionContentfulPaint`、
`PerformanceSoftNavigation`、`NodeRange`、`OpaqueRange`，移除不公开的 `ModelContext`、`WebMCPEvent` 与
`navigator.modelContext`。零注入 payload 结构从 `N=1167/o=121` 收敛到 `N=1171/o=120`。

**回归**：`window_event_is_current_only_during_dispatch` 1/1，三个 worker origin 测试 3/3，
`scripted_fetch_site_distinguishes_origin_and_site_boundaries` 1/1；带 trace-patched V8 的精确 release build
和 `vendor/v8-trace.sh check` 均通过。完整 workspace nextest 排除已知会挂起的
`shadow_root_identity_and_children_are_native_tree_backed` 后为 1697 passed / 1 flaky failure / 5 skipped；
失败项 `test_navigate_and_snapshot` 单独以 `--retries 2` 复跑通过。

**真实站复测与测量盲区**：本轮启动的最终 release serve 已确认 stealth TLS 与 Chrome 149 macOS UA，但
`cdp_click_fast` 40 秒内没有 widget，服务端导航在 60 秒超时关闭；同一代理 `http://192.168.3.57:9000`
对目标直接返回 Cloudflare 403 challenge，未产生可比较的 proof 请求或 `/1.txt` 404。因此本轮不能证明
代码改变了真实判定，也不能把外部 403/Brunhild pending 归因于 Obscura。下一轮只有在代理恢复可完成挑战时，
才继续做零注入点击和 404 验收；不增加 hostname 特判。

### Step 137 — frame 文档 `script-src` 执行门（2026-09-02，完成）

**假设**：frame controller 已把网络响应 CSP 写入 `DocumentScope`，但 frame 脚本调度器可能没有读取它；
若 frame 中的 nonce/来源限制未执行，挑战 widget 的子文档会暴露与 Chrome 不同的脚本执行面。

**证据与修复**：审计 `execute_frame_scripts_for` 确认 classic、module、inline 和 import map 原先均无
`script-src` 校验，外部 frame script 即使不在响应 CSP allowlist 中也会被抓取。现在 frame 调度使用自身
`DocumentScope.csp`：外部 classic/module 按 `script-src-elem`/`script-src`/`default-src` 检查，inline
classic/module/import map 按 nonce/`unsafe-inline` 检查，阻断发生在网络请求和执行之前；主文档逻辑保持不变。

**回归**：新增 `frame_document_csp_gates_inline_nonce_and_external_scripts`，验证无 nonce inline 被阻止、
正确 nonce 执行、未允许的外部脚本不产生请求；该测试与既有 embedded CSP、frame module、external script
共 4/4 通过。`obscura-browser` release+render crate 全部 111/111 通过。

**结论**：这是已由独立 HTTP fixture 证明的通用 iframe CSP 缺陷，已修复且没有站点特判。当前真实 404
仍待代理恢复后验收；本次修复本身不改变此前 `brunhild` 外部请求 pending 的结论。

### Step 138 — CSP 脚本门后的真实站复测（2026-09-02，调查中）

**假设**：frame `script-src` 缺口修复后，若代理恢复，挑战 widget 应至少进入可交互阶段；这次只使用
trace-patched release、stealth、对齐 Chrome 149 UA 和零注入点击，不使用会污染 payload 的 DOM hook。

**代码证据**：`execute_frame_scripts_for` 现在在 frame 自身 `DocumentScope.csp` 下 gate 外部 classic/module，
并按 nonce/`unsafe-inline` gate inline classic/module/import map。新增 HTTP fixture 已证明禁止脚本不产生
网络请求，允许 nonce 脚本仍执行；frame CSP/module/external focused 4/4，`obscura-browser` 111/111，
workspace（排除已知 shadow hang）1699/1699，release/no-default/trace patch 均通过。

**真实站证据**：最终 release serve 日志确认 stealth TLS 与 Chrome 149 macOS UA。对
`https://www.thelancet.com/1.txt` 的 `cdp_click_fast --deadline 40` 连续复测仍在 40 秒内无 widget，
页面 title/body 为空，服务端导航约 60 秒后关闭；同一代理直接响应 Cloudflare 403 challenge。没有 proof、
`complete` 或目标 `/1.txt` 404，因此不能宣称本修复已过盾，也没有足够证据继续归因某个 Obscura iframe API。

**结论**：iframe 文档 `script-src` 执行机制已闭环；当前真实 404 验收仍被代理/上游挑战状态阻断。后续
需要代理恢复或新的可完成挑战网络条件，再按零注入流程验证，不加入站点特判。

### Step 139 — 动态 frame script CSP sink（2026-09-02，完成）

**假设**：即使 parser-discovered frame scripts 遵守 CSP，动态插入的 `<script>` 仍可能绕过 `script-src`；
挑战 widget 常在运行时创建 script 元素，这会让 frame realm 的执行面与 Chrome 不一致。

**修复**：`__prepareInsertedScript` 现在读取当前 frame 的 `DocumentScope.csp`，在调度 fetch/eval 前检查
外部 classic/module 的 `script-src-elem`/`script-src`/`default-src` 来源，以及 inline classic/module/import
map 的 nonce/`unsafe-inline`。阻断脚本仍标记为 started，避免后续连接重复执行；主文档和 worker 路径不受影响。

**证据**：扩展 `frame_document_csp_gates_inline_nonce_and_external_scripts` fixture，验证动态无 nonce
脚本不执行、动态正确 nonce 脚本执行、未授权外部动态脚本不产生请求；该测试与 frame CSP/module/external
集合通过，workspace 排除已知 shadow hang 后 `1699/1699` 通过，no-default check 通过，release 二进制保持
trace-patched。

**结论**：动态 frame script CSP sink 已按通用规则闭环，未加入目标域名逻辑。真实 404 仍因代理当前直接
返回 Cloudflare 403、无 widget 而无法验收。

### Step 140 — frame ES module graph CSP（2026-09-02，完成）

**假设**：入口 `<script type="module">` 已校验 frame `script-src`，但模块图的静态 `import` 由独立
realm loader 抓取，可能绕过同一策略并加载未授权依赖。

**修复**：新增 `FrameModuleCsp`，把 frame 的 CSP header 与 origin 传入 `prepare_module_in_frame_realm`；
每个静态及重写的 dynamic import 在入队/抓取前按 `script-src-elem` 优先、`script-src`、`default-src`
回退规则校验来源，处理 `self`、scheme、host wildcard、端口、`data:`/`blob:`，并遵守重复 directive
首项规则。被阻止的依赖不会发起网络请求。

**证据**：新增 frame fixture 使用 nonce 允许 module 入口、用 `https://blocked.example` 依赖验证 graph
被 CSP 拒绝且 module body 不执行；Chrome 规则的 directive precedence、scheme-less host 与 duplicate
directive focused 断言通过。workspace release nextest（排除已知 shadow identity hang）`1700/1700 passed`
（1 leaky、5 skipped），no-default check、精确 release build 与 trace patch 均通过。

**结论**：frame 静态 module graph 的 CSP 机制已闭环，未加入站点特判；真实 `/1.txt` 404 仍等待可完成的
Cloudflare 上游挑战网络条件。

### Step 141 — frame render warmup 的资源 CSP（2026-09-02，完成）

**假设**：render 资源 warmup 在 frame realm 外扫描 CSS `url()` 并统一预取，可能绕过 frame 自身的
`img-src`/`font-src`，在后续渲染前就发出被 CSP 禁止的请求。

**修复**：`prepare_screenshot_resources` 现在保留每个 document root 的 CSP 与 origin；生成 frame 图片/字体
候选时按 `img-src`/`font-src`（及对应 fallback）过滤，禁止候选不会进入 transport 或 renderer cache。顶层
文档和允许资源路径保持原有行为。

**证据**：新增 `frame_csp_blocks_render_warmup_resource_prefetch`，HTTP fixture 返回 frame `img-src 'none'`
及 CSS 图片 URL，断言只收到顶层和 frame 文档请求、没有图片请求；release+render focused 通过。

**结论**：frame CSP 对 speculative render warmup 已闭环，未加入站点特判；真实 404 仍取决于 Cloudflare
挑战上游恢复。

### Step 142 — frame `<img>` renderer fallback 的 CSP（2026-09-02，完成）

**假设**：即使 warmup 候选过滤了 frame 图片，首次布局/绘制仍可能在 `RenderResourceCache` 的同步
`collect_image_intrinsics` 路径直接加载图片，从而绕过 JS `op_load_image_metadata` 的 `img-src` 检查。

**证据与修复**：独立 fixture 在 frame 文档声明 `img-src 'none'` 并包含真实 `<img src>`；原实现仍会
收到图片请求。`RenderResourceCache` 现维护当前 root 的 CSP/origin（与已有 font context 同步），
`get_or_load_image` 在调用兼容 loader 前执行 `img-src`/`default-src`，被阻止的 URL 不写入成功或失败缓存。
候选 API 同时携带所属 root，避免同一 URL 在不同 frame policy 下错误去重。

**回归**：`image_resource_cache_enforces_img_src_before_loader` 与
`frame_csp_blocks_render_warmup_resource_prefetch` 均通过，后者覆盖 frame CSS URL 和真实 `<img>`；
workspace release nextest（排除已知 shadow identity hang）`1702/1702 passed`，no-default、精确 release
build、trace patch 和 `git diff --check` 均通过。

**结论**：frame 图片在 JS、warmup、renderer fallback 三条路径都遵守 `img-src`，没有 hostname 特判。
真实 `/1.txt` 404 仍未验收，当前 Cloudflare 响应是 403 challenge。

### Step 143 — frame 图片的同步 renderer loader CSP（2026-09-02，完成）

**假设**：frame `<img>` 的 JS 异步路径已经执行 `img-src`，但首次布局中的
`collect_image_intrinsics` 可能通过 `RenderResourceCache` 同步 loader 直接取图，绕过 frame policy。

**证据与修复**：加入真实 frame `<img src>` 后，warmup 关闭时仍观测到图片请求；CSS URL 过滤并未覆盖
该路径。`RenderResourceCache` 现在与 font context 一起保存当前 document 的 CSP/origin，
`get_or_load_image` 在兼容 loader 前执行 `img-src`/`default-src`，被阻止的 URL 不写入缓存；
`pending_render_image_urls` 同时携带所属 root，避免跨 frame policy 去重。

**回归**：`image_resource_cache_enforces_img_src_before_loader` 验证 loader 调用计数为零，
`frame_csp_blocks_render_warmup_resource_prefetch` 覆盖 frame CSS URL 与真实 `<img>` 且仅收到文档请求。
两项及 frame CSP focused 均通过；workspace release（排除已知 shadow identity hang）保持全通过。

**结论**：frame 图片 CSP 已覆盖 JS、speculative warmup 和同步 renderer fallback 三条路径，未加入目标域名
特判；真实 404 仍待 Cloudflare challenge 上游恢复。

### Step 144 — frame `<img>` root 归属与 renderer fallback 修复（2026-09-02，完成）

**假设**：warmup 过滤按 frame root 处理 CSS URL 后，普通 `<img>` 候选仍只返回 URL/profile；统一 transport
无法知道它来自哪个 Document，可能在跨 frame policy 去重或首次布局时重新放行。

**方法与证据**：把真实 `<img src>` 加入 `img-src 'none'` frame fixture，关闭自动 warmup 后仍观察到图片请求；
`pending_render_image_urls` 返回的候选确认 root nid 为 frame content document，但原调用方丢弃了该信息。
同步 renderer 的 `collect_image_intrinsics` 也通过共享 cache loader 直接发起请求，JS image op 的 CSP 日志不会覆盖它。

**修复**：候选现在携带所属 root；page transport 在候选生成阶段按该 root 的 `img-src`/`default-src` 过滤；
`RenderResourceCache` 与 font context 同步保存 CSP/origin，并在 `get_or_load_image` 调用兼容 loader 前 gate，
禁止 URL 不写入成功/失败缓存，避免后续 policy 复用错误结果。

**回归**：`image_resource_cache_enforces_img_src_before_loader` 验证 loader 计数为零；
`frame_csp_blocks_render_warmup_resource_prefetch` 覆盖 CSS `url()` 与真实 `<img>`，只收到 `/` 和 frame 文档请求。
相关 focused 全部通过，workspace release（排除已知 shadow identity hang）`1702/1702 passed`，no-default、
精确 release build、trace patch、`git diff --check` 均通过。

**结论**：frame 图片请求现在在 JS、warmup、renderer fallback 和 root 归属四个层面遵守 CSP；真实 `/1.txt`
404 仍受当前 Cloudflare 403 challenge 网络状态阻断。

### Step 145 — 真实站传输层状态复核（2026-09-02，调查中）

**方法**：用最新 trace-patched release 做短超时 `fetch`，分别测试直连和
`http://192.168.3.57:9000` 代理；不启用页面注入或 payload hook。

**证据**：直连路径在 TLS handshake 因 Reqable CA 不匹配而 `CERTIFICATE_VERIFY_FAILED`；代理路径在
20 秒 navigation deadline 内未收到响应 body，最终为 `navigation exceeded 20000ms deadline`。此前 `curl`
直连/代理均能看到 Cloudflare 403 challenge，但当前 Obscura transport 未得到可执行页面，因此没有
widget、proof、`complete` 或 `/1.txt` 404 可比较。

**结论**：当前阻塞明确位于外部 TLS/代理/上游响应时序，不足以归因 frame CSP 或其他环境 API。待代理
能够稳定返回挑战资源后，再按零注入流程复测真实 404；不加入站点特判。

### Step 146 — frame `unsafe-eval` 与 V8 code-generation policy（2026-09-02，完成）

**假设**：frame 文档的 `script-src` 即使限制了 script 来源，V8 默认仍允许 `eval()`/`new Function()`；
这会让 CSP `script-src` 与 Chrome 不同，并可能改变挑战 widget 的反检测分支。

**证据与修复**：原 V8 callback 只转换 `TrustedScript`，且 Context 默认允许 string code generation，
所以普通字符串不会进入 callback。现在 main/frame/isolated contexts 设置
`AllowCodeGenerationFromStrings(false)`，每个 realm 在 `__obscura_init` 根据自身 CSP 的
`script-src`/`default-src` 写入隐藏 flag；V8 callback 读取该 flag，在没有 `'unsafe-eval'` 时拒绝字符串代码生成，
同时保留 TrustedScript 转换和 intrinsic direct-eval 语义。flag 加入 pre-hide 列表，避免环境枚举泄漏。

**回归**：top CSP 测试验证 plain `eval` 和 `new Function` 返回 `EvalError`、TrustedScript 仍执行；frame
script fixture 同样验证 `EvalError`。focused 2/2、workspace release（排除已知 shadow identity hang）
`1702/1702 passed`，no-default、精确 release build、trace patch 和 `git diff --check` 均通过。

**真实站复测**：最新 release 经 `192.168.3.57:9000` 代理请求目标时仍在 20 秒 navigation deadline 超时，
无 challenge body/proof/complete/404；外部传输状态继续作为未决项，不加入站点特判。

### Step 147 — frame CSP 完整代码生成门验证（2026-09-02，完成）

**假设**：`unsafe-eval` gate 可能只覆盖普通 frame realm，而不覆盖 V8 创建的 isolated world 或新建
frame context；任一 realm 漏洞都会让挑战看到不一致的 string-codegen 行为。

**验证与修复确认**：main context、frame main world、CDP isolated world 创建时均调用
`AllowCodeGenerationFromStrings(false)`；V8 callback 读取各自 bootstrap 写入的 CSP flag。无明确
`'unsafe-eval'` 时 plain `eval`/`new Function` 被拒，TrustedScript 仍按 brand 转换，未替换 intrinsic
eval，保持 direct-eval 作用域语义。flag 已加入 pre-hide 内部字段集合。

**量化回归**：top Trusted Types CSP 测试与 frame script CSP fixture 均通过（2/2）；workspace release
nextest（排除已知 shadow identity hang）`1702/1702 passed`、5 skipped；精确 release build、no-default、
trace patch、`git diff --check` 均通过。

**结论**：CSP `unsafe-eval` 在 main/frame/isolated realm 的代码生成路径已闭环，未加入域名特判。真实
`/1.txt` 404 仍因当前代理 navigation timeout 未验收。

### Step 148 — codegen 修复后的真实站复测（2026-09-02，调查中）

**方法**：使用包含 V8 `unsafe-eval` callback、frame module/image CSP 修复的最新 release，stealth、
Chrome 149 macOS UA，经 `192.168.3.57:9000` 请求目标，timeout 20s，零注入。

**证据**：请求仍在 `navigation exceeded 20000ms deadline` 失败，没有 challenge body、widget、proof、
`complete` 或 `/1.txt` 404。该结果与代码修复前的代理时序一致，无法证明目标页面执行到了 CSP 或 frame realm。

**结论**：真实验收仍被外部代理/上游响应阻断；保持未完成状态，等待可返回并执行 challenge 的网络条件，
不添加站点特判。

### Step 149 — CSP 代码生成门的最终回归（2026-09-02，完成）

**假设**：CSP `unsafe-eval` gate 可能通过 V8 callback 改变正常页面的 direct-eval 作用域，或在 frame
context 创建前后出现时序窗口；需要用现有 Trusted Types 和 frame script fixture 共同验证。

**结果**：main、frame main world、CDP isolated world 创建时均禁用 Context 默认 string codegen；bootstrap
在 `__obscura_init` 根据各自 `DocumentScope.csp` 设置 hidden allow flag，V8 callback 仅在 flag 允许时放行
普通字符串，并继续将 TrustedScript 转换为源码。plain `eval`/`new Function` 在无 `'unsafe-eval'` 时返回
`EvalError`，无 CSP 时的 direct-eval 行为和现有脚本保持不变；flag 纳入 pre-hide，未新增可枚举引擎字段。

**验证**：Trusted Types top 测试、frame CSP（含 eval/function）测试 2/2；workspace release（排除已知
shadow identity hang）`1702/1702 passed`、5 skipped；精确 release build、no-default、trace patch、
`git diff --check` 均通过。

**结论**：CSP 代码生成机制已在所有 Obscura Window realm 覆盖，未加入域名特判。真实 `/1.txt` 404 仍受
代理 navigation timeout 阻断。

### Step 150 — `script-src-attr` inline handler CSP（2026-09-02，完成）

**假设**：CSP `script-src-attr 'none'` 只限制 event-handler content attributes；如果仍通过
`Element._resolveInlineHandler` 的 `new Function` 编译，代码生成 flag 不足以复现 Chrome 的 handler 行为。

**修复**：inline handler 解析前读取当前 realm 的 CSP，按 `script-src-attr` 优先、`script-src`、`default-src`
回退；只有存在 `'unsafe-inline'` 才编译属性 handler，`'unsafe-hashes'`/未授权属性保持阻断。该检查与
`unsafe-eval` callback 独立，避免把 event attribute 当作普通 eval。

**证据**：新增 `script_src_attr_controls_inline_event_handlers`，验证 `script-src-attr 'none'` 下
`onclick` 不执行、改为 `'unsafe-inline'` 后执行；frame CSP fixture 也覆盖 frame realm 的 eval/function
gate。focused 3/3、workspace release（排除已知 shadow identity hang）`1703/1703 passed`、5 skipped，
release/no-default/trace patch/diff check 均通过。

**结论**：inline event-handler CSP 已按 realm 生效，未加入站点特判；真实 `/1.txt` 404 仍待代理恢复。

### Step 151 — `script-src-attr` 修复后的真实站复测（2026-09-02，调查中）

**方法**：使用包含 frame parser/dynamic/module/image CSP、V8 `unsafe-eval` 和 `script-src-attr` 修复的
最新 release，stealth、Chrome 149 macOS UA，经 `192.168.3.57:9000` 访问目标，timeout 20s，零注入。

**证据**：仍返回 `navigation exceeded 20000ms deadline`，没有 challenge body、widget、proof、complete
或目标 `/1.txt` 404。目标直连的 curl 同时仍为 `HTTP/2 403` + `cf-mitigated: challenge`。

**结论**：外部代理/上游仍未提供可执行挑战，无法对本轮 inline handler 修复做真实过盾归因；真实 404
验收继续保持未完成，不加入站点特判。

### Step 152 — external script nonce 反射与真实挑战链恢复（2026-09-02，完成）

**假设**：Cloudflare challenge 的动态 `chl_page` script 使用 `a.nonce = ...`；如果 Obscura 缺少
`HTMLScriptElement.nonce` 反射，frame-local CSP gate 会把合法 external script 误判为未授权，页面停在
“Enable JavaScript and cookies to continue”。

**证据与修复**：实际目标 HTML 的 inline script nonce 与 CSP header 一致，并明确执行
`a.nonce = '<nonce>'; a.src = '/cdn-cgi/.../chl_page/v1?...'; head.appendChild(a)`。新增通用 `nonce` getter/setter
（HTML element wrapper），动态 CSP gate 对 external script 同样匹配 nonce；本地 fixture 改用 `script.nonce`
赋值并验证 external script 请求/执行恢复。未授权外部 script 仍阻断。

**真实量化结果**：最新 release 直连零注入 CDP 轮在 `t=5.3s` 点击 300x65 widget，收到 `interactiveBegin`。
Rust 日志确认 `chl_page` 200（约227KB）、Turnstile api.js 200（约84KB）、top `/fo` 200、frame `/fo` 200
（约823KB）、`/pat` 401、点击后的 proof/top 3256B；页面显示 “Verification successful”。修复前同类轮次
在动态 `chl_page` 处即被 CSP 阻断，只有“Enable JavaScript”。

**当前断点**：`brunhild.challenges.cloudflare.com/cdn-cgi/.../i` 请求在 Connect 阶段失败，随后 frame `/fo`
仍返回 200，但站点没有发放最终响应，目标未真实返回 `/1.txt` 404。该 Connect 失败与 Chrome 同轮无 response
一致，不能继续归因 iframe CSP；等待可访问 Brunhild 的网络条件再验收。

**回归**：frame CSP focused 通过；workspace release（排除已知 shadow identity hang）`1703/1703 passed`、
5 skipped，release/no-default/trace patch/diff check 全通过。无 hostname 特判。

### Step 153 — nonce 修复后的无注入真实点击证据（2026-09-02，调查中）

**方法**：使用包含 `HTMLScriptElement.nonce` 反射和 external nonce CSP gate 的最新 release，直连（不经过
失效代理）启动 CDP，执行零注入 `cdp_click_fast --deadline 40 --settle 20`，同时开启
`RUST_LOG=obscura_js=debug` 请求日志。

**证据**：页面在 `t=5.3s` 取得 300x65 widget box 并点击，随后收到 `interactiveBegin`。请求时间线中
`chl_page` 200（约227KB）、Turnstile api.js 200（约84KB）、top `/fo` 200、frame `/fo` 200（约823KB）、
`/pat` 401、点击后 frame proof `/fo` 200、top `/fo` 3256B 均出现；页面显示
`Verification successful. Waiting for www.thelancet.com to respond`。这证明 nonce/CSP 修复已消除此前
“Enable JavaScript and cookies to continue”的直接阻断。

**当前断点**：challenge 随后请求
`https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/i/...`，约1.1s 后在 Connect
阶段失败；Chrome 同网络条件也没有该请求的 response。其后 frame 转发仍返回 200，但没有站点最终响应，
目标未真实返回 `/1.txt` 404。

**结论**：iframe CSP/nonce 环境已经把执行链推进到交互后最后的 Brunhild 网络请求；剩余失败是外部 fake-DNS/
代理/上游可达性问题，不足以继续推断 Obscura iframe API。待该 host 可达时再进行 404 验收，不加入域名特判。

### Step 154 — nonce/CSP 修复后的最终代码门禁（2026-09-02，完成）

**验证范围**：在 nonce 反射、external nonce 匹配、frame script/module/image CSP、`script-src-attr` 和 V8
`unsafe-eval` 全部落地后，重新执行精确 release build、no-default feature check 与 workspace release nextest。

**结果**：workspace（排除已知 `shadow_root_identity_and_children_are_native_tree_backed` hang）
`1703/1703 passed`、5 skipped；no-default check 通过；精确二进制晚于全部相关源码；
`vendor/v8-trace.sh check` 为 `patched`；`git diff --check` 通过。真实目标的无注入 CDP 轮仍能在 5.3s
点击并收到 `interactiveBegin`，但 Brunhild `/i` Connect 失败，未获得站点 404。

**结论**：当前代码侧 iframe/CSP 环境修复已通过完整门禁；最终 404 仍需外部 Brunhild host/fake-DNS 可达，
不能用站点特判或测试 fixture 代替。

### Step 155 — Brunhild 请求归属与最终网络断点（2026-09-02，调查中）

**方法**：从最新无注入 CDP serve 的 `RUST_LOG=obscura_js=debug` 中按时序核对 Brunhild 请求、
后续 frame/top 转发和页面状态；同时检查 DNS 与路由，不修改请求 URL 或 Host。

**证据**：`brunhild.challenges.cloudflare.com` 请求由 frame challenge 触发，日志显示
`Origin: https://challenges.cloudflare.com`、无 Referer；约 1.1 秒后 `stealth_fetch failed ... client error (Connect)`。
同一轮之后 frame `/fo` 仍返回 200（约127KB），页面继续显示 `Verification successful`，但没有新的站点响应。
DNS 将 Brunhild 解析到 198.18.0.157（utun fake-DNS 路由），IPv4/IPv6 直连均 TLS syscall 失败；代理
`192.168.3.57:9000` 当前 host down。Chrome 同条件的 Brunhild 请求也没有 response。

**结论**：请求 realm、Origin 和 challenge 提交链均已正确；剩余断点是外部 fake-DNS/代理可达性，不能通过
Obscura 的 iframe CSP 或 hostname 特判修复。真实 `/1.txt` 404 仍未取得，待 Brunhild host 可达后继续验收。

### Step 156 — nonce 后真实链路与代码门禁汇总（2026-09-02，调查中）

**代码状态**：`HTMLScriptElement.nonce` 反射、external nonce CSP、frame parser/dynamic/module/image CSP、
`script-src-attr` 和 V8 `unsafe-eval` 均已落地；对应 focused fixtures 与完整 workspace 均通过。

**真实状态**：直连最新 release 的无注入 CDP 轮在 5.3 秒点击并收到 `interactiveBegin`，top/frame `/fo`、
proof、`/pat` 401 和 `Verification successful` 均可观测。唯一未完成的是 Brunhild `/i` 的 Connect/TLS；
DNS 解析到 198.18.x fake-DNS，IPv4/IPv6 均无 response，Chrome 同条件也无 response。目标 URL 仍未真实返回
404，故不宣称过盾成功。

**门禁**：workspace release nextest（排除已知 shadow identity hang）`1703/1703 passed`、5 skipped；
no-default check、精确 release build、trace patch 和 `git diff --check` 均通过。后续只需在 Brunhild host
可达的网络条件下重复同一无注入点击验收，不再继续猜测已排除的 iframe CSP 根因。

### Step 157 — HaHaVM-General 内存上限与 Window 常量（2026-09-02，完成）

**假设**：HaHaVM-General 最新通用环境提交仍有少量可由 Chrome oracle 直接证明的公开面差异；这些差异应在
Obscura 中按 WebIDL 语义补齐，不应与 Cloudflare 主机或质询分支绑定。

**证据与修复**：本机 Chrome 152 的 `performance.memory.jsHeapSizeLimit` 和 `console.memory.jsHeapSizeLimit`
均为 `4395630592`，Obscura 原先固定为 `4294705152`；已统一初始化、fallback 和导航重置值。Chrome 还在
`Window` 构造器及 `Window.prototype` 上暴露不可写、可枚举、不可配置的 `TEMPORARY=0` 与 `PERSISTENT=1`，
Obscura 原先缺失；已补齐这两组常量和 focused descriptor 回归。

**验证**：`window_storage_constants_match_chrome_shape` 与
`console_and_performance_memory_share_fresh_branded_wrappers` focused nextest 2/2 通过；精确
trace-patched release build、no-default feature check、`vendor/v8-trace.sh check` 和 `git diff --check` 通过。
`obscura-js` 全 crate 在既有 `shadow_root_identity_and_children_are_native_tree_backed` 挂起及宿主字体/渲染
断言失败处中止，新增测试本身未失败。

**结论**：本步完成两个通用环境差异的修复，没有改变请求或站点逻辑。代理 `192.168.3.57:9000` 当前仍
不可达，Brunhild `/i` 无 response，目标 `/1.txt` 仍未取得真实 404。

### Step 158 — frame Worker 继承 creator CSP（2026-09-02，完成）

**假设**：真实 challenge 的 Brunhild `/i` 请求由 widget frame 派生的 Worker 发起；Worker 没有自己的
Document root，若不继承创建它的 frame CSP，`op_fetch_url` 会错误地按顶层页面策略处理请求。

**证据与修复**：修复前同一轮日志中 frame `/fo` 为 `root=75, csp=frame`，而 Brunhild `/i` 为
`root=0, csp=page:none`，但 Origin 已是 `https://challenges.cloudflare.com`。新增 WorkerEnvironment 的
creator CSP 字段和 `creator_root`/`creator_csp` op 参数；Worker 与 SharedWorker 现在将创建文档的 CSP 写入
自身运行时，嵌套 Worker 继续沿用该策略。新增跨 frame data Worker fixture，`connect-src 'none'` 返回
`AbortError` 且本地 HTTP 请求数为 0，证明在网络前阻断。

**验证**：`frame_worker_fetch_uses_the_creator_document_csp` 及既有 frame worker 三项 focused nextest
均通过；workspace（排除已知 shadow identity hang）`1703 passed / 2 failed`，两项失败为既有 MCP
时序测试，单独 `--retries 2` 全部通过。精确 release build、no-default check、V8 trace patch 和 diff check
通过。新 release 的真实轮仍稳定进入 interactiveBegin、frame/top `/fo` 和 proof/top 转发；Brunhild `/i`
仍在 Connect/TLS 失败，目标 URL 尚未返回真实 404。

**结论**：本步修复了 frame Worker CSP 传播的通用缺陷，真实请求日志中的 Worker 已从 `csp=page:none`
迁移为有 CSP 的运行时策略；剩余 Brunhild 失败仍是外部网络可达性，未加入 hostname 特判。

### Step 159 — Brunhild 真实网络路径恢复（2026-09-02，调查中）

**方法**：本机 DNS 将 Brunhild 映射到 `198.18.x` fake-DNS/utun 路由，直连 TLS syscall 失败。为分离网络
与引擎因素，使用仅作测试的本地 CONNECT 转发，将该连接送到真实 Cloudflare IP，同时保留原始 Host/SNI；
没有修改 Obscura 请求 URL 或加入 hostname 特判。

**证据**：通过该转发，Brunhild `/i` 从 Connect failure 变为真实 `204`；Obscura 仍完成 frame/top `/fo`、
`/pat` 401 与 proof/top 转发，随后 challenge 换 ray。相同转发下 headless/headful Chrome 也停在 challenge，
因此此前的网络失败已被独立，剩余是 challenge 判定/环境分歧。

### Step 160 — 干净点击与硬件指纹 A/B（2026-09-02，调查中）

**测量修正**：现有 `cdp_click_fast.py` preload 会包装 `attachShadow`，会污染函数 identity；新增固定坐标无
preload 点击脚本，避免把探针副作用当成页面行为。动态 `Image.src` 的本地 fixture 也确认无生命周期观察时
仍会发起 eager fetch，排除 `/ci` 缺失的 lazy-image 假设。

**A/B 证据**：本机 Chrome152 同 UA 返回 `hardwareConcurrency=12`、`deviceMemory=32`，Obscura 默认 `8/8`。
使用 `--fingerprint '{"hardwareConcurrency":12,"deviceMemory":32}'` 重跑 challenge，请求序列和结果未变：
Brunhild `204`、`/pat` 401、proof 后换 ray，未出现真实 404。当前没有足够证据改变默认硬件策略。

**结论**：iframe CSP、Worker creator CSP、图片 eager-fetch 和硬件指纹均有独立 fixture/oracle 证据；当前
challenge 仍未返回目标真实 404，后续应继续从明文 payload/事件时序找通用差异，不添加 Cloudflare 域名分支。

### Step 161 — Navigator 自有属性迁移（2026-09-02，完成）

**假设**：Obscura 的 Navigator 兼容对象仍把公开 IDL 成员放在实例自身，形成 Chrome 不存在的枚举面；
这类结构差异可能被 challenge 的全局对象探针直接读取。

**证据与修复**：Chrome 152 的 `Object.getOwnPropertyNames(navigator)` 为空，`connection`、`permissions`、
`gpu`、`geolocation`、`getBattery` 等均位于 Navigator 原型；Obscura 原先有 21 个自有成员。新增末端迁移
层，将兼容对象的稳定值转为原型 getter、方法转为原型函数，保留对象 identity、secure-context 删除和
`Navigator.prototype` 后续接口安装逻辑。

**验证**：`navigator_has_no_own_idl_members`、fingerprint 和 StorageManager focused `3/3` 通过；workspace
release nextest（排除已知 shadow identity hang）`1707/1707 passed`、5 skipped；精确 release build、
no-default check、V8 trace patch 和 `git diff --check` 通过。临时真实-IP CONNECT 转发下，最新无 preload
点击仍完成 Brunhild `204`、`/pat 401`、proof/top 转发后换 ray，目标未返回真实 404。

**结论**：Navigator 枚举结构已与 Chrome 对齐，未引入站点特判；challenge 剩余分歧仍需从明文 payload 和
事件时序继续定位。

step127存档：Blob/File、UTF-8、三ray与完整门均通过，仍无真实404。
参考HaHaVM-General的Blob分片修复继续审计公开面，Chrome151证明Obscura既有实现泄漏实例字段且把
null/undefined分片丢弃；已迁WeakMap internal slots、补完整Blob/File接口与流读取，并修正非法UTF-8
热路径为U+FFFD。Chrome parity focused1/1、相关6/6、obscura-js546/546与workspace1686/1686通过；
三clean ray完整，条件点击proof/top/new-ray链完整但仍无404。step126存档：console三ray迁移与完整门均通过。

Step105新增通用修复已由真实payload验证：counterclockwise arc首2x2迁移到白/191/239/48
（Chrome白/192/244/53）；float16 context四组颜色4/4对齐；C1 Canvas文本把十宽度最大误差从
约31px降到2.21px。49x44 Skia AA/hash、TextMetrics outline/font box、hG31项与Zok postMessage分类
仍未决。完整门为obscura-js533/533、workspace1673/1673（4 skipped）、精确release、trace patch、
no-default与diff check通过；deterministic 63个fixture的Obscura行为断言全过，10条checker失败
均为Chrome151对旧参考不匹配。障碍课程未跑（本机无companion仓库）。

step 104存档：**DOMParser skeleton崩溃已修，最后有效明文样本的hGgWW0有31项差异且lNCr3
未恢复；当时迁移待测，质询仍未通过**。ZokK1最后有效payload的
N/o/x/F/T本地分类缺口已静态覆盖，
RTP capabilities的audio RED已从`audio/red/48000;111/111`对齐为`audio/red/48000`；
CSSOM-only unrounded geometry已让受控inline rect从73对齐为72.9375，同时offsetWidth保持73；
detached HTMLDocument/XMLDocument身份、owner与Document根关系已按Chrome151对齐。direct live已到
widget proof fo 200后，但仍没有目标真实响应；
真实payload迁移仍等待Reqable注入key刷新。ZokK1中六个已存在接口的type/native外壳已按Chrome151修复，
本地fixture与全量门通过；真实bucket迁移待payload-2恢复。JSVMP取证已证伪frame VM和top
secondary runProgram，并把旧ray `uA`主VM映射到新ray `nT/FX`结构；临时register probe已命中
62/44/5 calls后删除。当前Reqable会话仍只到payload-1后600010，不能产生hG证据；按测量盲区
应先刷新代理注入的challenge JS/key，再重复三轮payload-2。本轮已用Chrome151 oracle实现最后
有效payload中全部34个Chrome-only N路径，并通过release CLI 34/34静态分类检查；这仍不能替代
真实payload或过盾成功判据。后续仍按
受控 main/frame realm oracle 拆分 parser/serializer 与其他 API。step 95 已隐藏 Error.stack 的
Obscura/deno 内部帧；step 94 的 jdnfg5 iframe rch item 已修复（3/3）。step 95 不伪造 QqYk7，也不改变 timer 调度，
而是在 V8 把 CallSite 交给默认或页面 formatter 前过滤内部脚本来源。thelancet 三个独立 ray
的 payload-1 均只保留真实 `api.js`/`chl_page` URL，内部来源命中 0/3。
`http://192.168.3.57:9000` + `https://www.thelancet.com/1.txt` 三轮均走完初始 fo、点击 proof
和顶层 3256B 转发，随后换 ray 重开挑战，没有 `complete` 或真实 404。Chrome 149 三 payload
按探针字段名对拍确认核心指纹面已收敛，但仍有 6 个 Chrome-only 探针、ZokK1 长尾、UA-CH
brand、文本/canvas 与 ICE 差异；全量 V8 trace 复证 console native 绑定不可观测参数。
B0-B7 全批次落地
（见 step 91 与 `Challenge-fingerprint-fix-plans.md`）：UA-CH arm/26.4.0、WebGL 39 项逐项
一致、WebGPU apple 档、SAMPLES 15 格式、N 桶 399→1137（Chrome 1164）。质询三轮提交链路
正常（600010 回退已修）。剩余长尾：N 桶 27、o 桶 14、x/F 桶、brands 形态、sans-serif 字体
残差、ICE srflx；障碍课程未跑（本机无 companion 仓库）。step 90 存档：step 90 用 MITM 代理注入的 `console.log("payloadJSON:…")`
拿到 obscura 全部三轮**明文提交体**（含点击后 proof 轮），与 Chrome 三 payload 按「探针字段名」对拍
（分片号两边错位，不能按 part 对齐）。结论：navigator 42 缺口只是冰山一角——枚举桶里 **N 桶（window
构造器）缺 773 个、o 桶缺 49 个**；**UA-CH 高熵字段错**（x86/10.15.7 vs arm/26.4.0，brands 多一个
"Google Chrome"）；**WebGPU adapter 报 intel gen-9**（参考 macOS Chrome 是 apple）；iframe 内
`document.domain` 报顶层域、`compatMode` 应为 BackCompat、`innerWidth/innerHeight` 应为 0；
WebGL 少 4 个 Apple GPU 压缩纹理扩展、limits 表多值不同；canvas 像素全 255、文本测量无亚像素；
ICE 缺 srflx。此前 step 89 的三个缺口（默认 UA、navigator 42 API、`__obscura_click_target`）
依然成立。step 90 补充调查确认 **`/ci/` 打点没有回归**（HEAD 多数轮次第一轮 widget 早期
就发，~1/3 轮次推迟是 CF 端波动；iframe 修复排除），顺带发现动态 iframe about:blank
`body=null` 的老缺陷。下一步按本 step 的影响排序表推进。

step 89 存档：step 88 把 document 的 8 个内部字段改 Symbol 键后，实测
`Object.getOwnPropertyNames(document)` 泄漏归零（主/frame realm 均 `[]`，晚快照只剩合法的
`lang`/`dir`）。step 89 对拍 Chrome 三 payload 确认：①默认 stealth 指纹是 Windows Chrome
145/146，参考是 macOS Chrome 149（`--user-agent` 可即时对齐）；②navigator 缺 42 个 Chrome 有的
属性；③`__obscura_click_target` 运行时泄漏到 `globalThis`。

以下为 step 67–74 的状态记录。战线从「链路走不通」转成
「**提交载荷的内容对不上**」——`http://192.168.3.57:9000` 上的 MITM 代理把 CF 的
提交对象以明文打了出来，第一次可以逐字段对拍（step 66）。本轮按字段修了 8 处,
tokenB 载荷从 Chrome 的 **56% 提到 78%**（38529 → 53275 B）,
并把 **11 处引擎内部字段泄漏清零**：

| 字段 | 内容 | Chrome | 修前 | 修后 |
|------|------|--------|------|------|
| `YIwy3` | WebRTC SDP offer | 7277 | 2 | **7277** |
| `EnxW1` | WebGPU 适配器 | 2293 | 8 | **2176** |
| `fyCZH9` | 全局/文档枚举面 | 30881 | 14187 | 15047（`d.` 12→43 等） |
| `FgjO3` 等 8 项 | WebGL 能力 | 2594 | 60（全是错误哨兵） | **2552** |
| `DrTW4` | ICE 候选 | 1465 | 2 | **985** |
| `ZpxzX5` | RTP 能力表 | 1273 | 7 | 本地已对齐（CF 侧未量测） |
| `Swui9` | 键盘布局 | 596 | 2 | 本地 576（CF 侧未量测） |
| `gqGB4` | 字体列表 | 83 | 738（三套 OS） | 已修根因（CF 侧未量测） |
| `yQYB9` | resource timing | 366 | 缺失 | **已补齐** |

**注意**：step 72 起第一次 `/fo/` 就返回 400 + `600010`,tokenB 不再下发,
后三项只有本地量测。**原因是代理里那份被改写的 JS 的加密 key 过期**（见 step 72 的
更正），不是引擎侧的问题,也不是 CF 对 IP 的升级。更新代理的 JS 后需重跑一轮补齐。
最大的剩余项仍是 `fyCZH9`,根因已定位为**动态 iframe 在 Rust 帧加载器提交前拿到的是
JS 兼容垫片**（step 68 末尾）。

以下为更早的状态记录。**未通过,但断点已前移到最后一步**(2026-08-16,step 55/56)。`/pat/`(401)与
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
| **第一次 `/fo/` 直接 400 + `600010`,tokenB 不再下发** | 所有依赖大载荷的对拍突然全部失效,看起来像「刚才那次改动把链路打断了」 | **这是代理里被改写的那份 JS 的加密 key 过期**,不是引擎侧也不是 CF 侧。看到这个形态就**直接告诉用户去更新 JS**,不要继续排查引擎 |
| **对照实验只能排除,不能定位**：撤掉改动重跑、形态相同,只证明「不是这次改动」 | step 72 据此得出「CF 对本出口 IP 升级」——一个完全编造出来的归因。真因是代理的 JS key 过期 | 排除掉自己的改动之后,剩下的空白**就让它空着**,写「原因未知」。不要用一个听起来合理的外部故事把它填上 |
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
| **`fetch` 模式不转发页面 console**（step 90） | fetch 轮本地测 ICE（console.log 6 条）与质询页 payloadJSON 全部静默丢弃，一度把「fetch 轮 0 条 payloadJSON」归因成「质询没跑完」——两个原因里真正致命的是这个 | 凡要读页面 console（payloadJSON/探针 console.warn）必须起 `serve`，从 serve 日志拿 |
| **全量 `--trace` 让质询在窗口内跑不完**（step 90） | trace 轮 90 万 CALL 把页面拖慢数倍：fetch 轮 35s 到不了提交；serve 轮页面任务直接被 `autonomous browser task exceeded its task budget` 杀掉，payloadJSON=0 | trace 轮只用于看调用形态/MISS，**不用于拿提交体**；提交体用无 trace 轮，两轮分开跑 |
| **V8 property-lookup trace 不覆盖普通 JS 对象的属性访问**（step 90） | trace 的 MISS 仅 19 条，据此会误判「CF 没探测不存在的属性」；实际 bootstrap 的 navigator 等 JS shim 的 typeof/in 走 V8 fast path，根本不进 hook——step 89 的 42 个 navigator 缺口在 trace 里不可见 | 枚举面/缺 API 类结论只能用 `enum_realm.py`/`diff_payload_enum.py` 对拍；trace 的 MISS 只回答「window 级全局查找失败」 |
| **`console.log` 等 native 绑定不产生 CALL 行**（postMessage 同理，step 90 复证） | 想从 trace 里读 console.log 的参数（payloadJSON），CALL/HIT 里 0 条，像「没调用过」 | payloadJSON 靠 serve 日志；trace 只见 JS→JS 与 bootstrap 实现的 API 调用 |
| **对拍脚本不先做同侧 sanity check**（step 90） | 摊平脚本「后片覆盖前片」的 bug 把 Math 指纹 184 项**完全相同**的值误报成「144→0 缺失」，差点写进文档成为假缺口 | 任何对拍脚本先跑「自己 vs 自己」的相邻批（chrome-2 vs chrome-3、obsc-2 vs obsc-3 应≈零差）再跑跨侧对比，覆盖 bug 立刻暴露 |
| **`diff_payload_enum.py` 只识别旧字段 `fyCZH9`**（step 92） | 当前三 payload 的枚举桶名是 `ZokK1`，脚本静默输出 `n=d=s=so=bare=0`，看起来像 CF 没读任何属性 | 先断言提取总数非零；当前 payload 直接解析数字 part 中的 `ZokK1`，按探针字段名跨 part 合并后再对拍 |
| **Performance entry 的 Rust `recording` 日志不等于 observer 已收到**（step 93） | iframe entry 的构造日志早于 payload，容易据此误判 CF 应已采集；实际 `PerformanceObserver` 回调还在 microtask 队列里 | 同时记录 `__obscura_performance_record`、`performance.getEntries()` 和 observer 回调；区分构造、入 timeline、交付 observer 三个时刻 |
| **按分片号（part N）对齐两边 payload**（step 90） | 同一探针在 chrome 落 part 27、obscura 落 part 20，按 part 号 diff 全是假差异；第二批提交还是**增量**的（payload-3 = payload-2 + part 40），字段集合随批增长 | 对拍一律按**探针字段名**（混淆名跨边稳定）对齐，跨 part 合并同名值；先认清「增量批」语义再解释 only-字段 |
| **`capture_challenge.py` 的 attachShadow 注入仍在污染指纹**（step 66 证据 0 重演，step 90） | `__roots`/`__cap`/`__capHooked` 进了 ZokK1 枚举桶，包装后的 attachShadow 源码进了 payload 尾部 | 该脚本抓通信可用；凡涉及枚举面/函数源码的字段要用无注入轮次（如纯 Input domain 的导航+点击），或先给脚本去注入 |

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
差异只有 token、时间戳和几个 DOM/时序计数。

**真因（当日由代理维护者指出，此处为更正）：代理里那份被改写的 JS 的加密 key 过期了。**
更新那份 JS 即可恢复,与引擎侧无关。

**~~判定为 CF 对本出口 IP 的升级~~（作废）。** 这条结论是编的:对照实验只证明了
「不是这次改动」,并没有指向任何外部原因;我却拿「今天跑了约 20 轮」凑出一个听起来
合理的故事把空白填上,还据此写进了测量盲区表。**排除自己的改动之后剩下的空白,
应该老老实实写「原因未知」。**

**操作约定**：以后只要看到**第一次 `/fo/` 返回 400 + `600010`**,
就直接提示使用者**更新代理里的那份 JS**,不要继续往引擎上排查——
这个形态的唯一已知成因就是 key 过期。

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
`§` 字符）。CF 侧量测同 step 72,因代理 JS 的加密 key 过期本轮无法取得。

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

**CF 侧量测**同 step 72,因代理 JS 的加密 key 过期本轮无法取得。

### Step 75 — `gqGB4` 的真正探测路径：`FontFace` 的 `local()` 源（2026-08-17）

代理的 JS 更新后 CF 恢复正常，先把 step 72-74 欠的三项量测补齐：

| 字段 | Chrome | 修前 | 修后 |
|------|--------|------|------|
| `ZpxzX5` RTP 能力表 | 1273 | 7 | **1281** |
| `Swui9` 键盘布局 | 596 | 2 | **576** |
| `gqGB4` 字体列表 | 83（6 个） | 738（54 个） | **738（54 个），没变** |

**`gqGB4` 完全没动**——修前修后的 54 个名字逐字节相同。说明 step 74 修的
`bundled_family_for_css_token` 虽然本身是对的，但**不在 CF 走的那条路上**。

**逐路径排除**：

1. DOM 测宽（`span.offsetWidth`，`'X',monospace` vs `'X',sans-serif`）→ step 74 之后已正确
2. canvas `measureText` → 同样已正确（两条路共用渲染侧解析）
3. `document.fonts.check()` → 对任何名字都回 `true`——但**Chrome 也是**
   （规范里未匹配到 FontFace 的族直接跳过），不是判据
4. **`new FontFace('p', 'local("X")').load()`** → obscura **对任何名字都 resolve**;
   Chrome 对未安装的字体 **reject `NetworkError`**。**这才是那条路。**

**修复**：`FontFace.load()` 解析源里的每个 `local(...)`，家族不可用就把 `status`
置为 `'error'` 并以 Chrome 的文案 reject `NetworkError`。

「可不可用」**不另立一张表**，而是**用测量来判定**——同一个字符串分别按
`"X", monospace` 和 `"X", sans-serif` 走 canvas `measureText`，**两次相等即存在**。
渲染侧对不认识的具名族已经是「跳过、用下一个 generic」，所以这个判据与渲染器
**不可能不一致**；另写一张可用字体表则必然随时间漂移。结果按小写族名缓存。

**结果**：`gqGB4` 从 **54 个名字降到 6 个**，与 Chrome 的数量一致，
且不再有 Windows/Linux/macOS 三套并存：

```
chrome: Apple Symbols, Galvji, Geneva, InaiMathi Bold, Luminari, PingFang HK Light
obscura: DejaVu Sans, Liberation Mono, Liberation Sans, Lucida Console, Noto Sans, Noto Serif
```

**残留**：这 6 个里有 5 个是 Linux 族——它们是引擎**真正打包**的字体。
自称 Windows 却装着 DejaVu/Liberation/Noto 仍是个矛盾，但已经从「三套 OS」
收敛成「一套错的 OS」。彻底解决要让打包字体集随所声称的平台切换（渲染栈改动），另记。

**回归测试**：`a_local_font_source_fails_for_a_family_this_machine_does_not_have`——
断言真实存在的族 `loaded`，Windows/macOS 的族与一个编造的名字都 `NetworkError`,
且不含 `local()` 的 `url()` 源不受影响。

**教训**：step 74 是「修了一个真实缺陷，但它不是本字段的成因」。
**改完必须回到那个字段本身复测**，不能因为本地探针变好就认为字段会跟着变——
本字段修前修后逐字节相同，正是这条的代价。

### Step 76 — `qOeu1`：引擎自己的内部选择器泄漏进了页面的观测（2026-08-17）

`qOeu1` 是 CF 钩住 `querySelector`/`querySelectorAll` 后记下的**选择器序列**。
浏览器 34 条，全是 CF 自己的（`.oEtkm22`、`#cfIz02`、`#sDsJ6` …）；
obscura **74 条**，其中大半是这三个反复出现的：

```
[id],embed[name],form[name],iframe[name],img[name],object[name]
style
link[rel~="stylesheet"]
title
```

**这些不是页面查的，是 bootstrap.js 自己查的**——具名 window 访问
（`window.foo` 的候选枚举）、样式表发现、`title` getter、
`label.control` / `element.labels`。它们走的是**页面可见的**
`querySelector`/`querySelectorAll`，于是每一次内部查询都进了 CF 的日志。
浏览器里这些都是原生实现，不会经过任何页面能钩到的入口。

这与 `document._nid` / `screen._w` 是同一类问题：**引擎内部动作对页面可见**。
区别在于前者是「静态字段」，这个是「运行时行为」，而且**每次内部操作都会再记一条**,
所以它同时暴露了引擎的内部调用频率。

**修复**：加一条内部通道 `_internalQuerySelector(All)`，直接走
`_domParse('query_selector_all_scoped', nid, sel)` 这个 DOM op,
绕开公开方法。把上述全部调用点切过去。

**结果**：

| | Chrome | 修前 | 修后 |
|---|---|---|---|
| `qOeu1` 条数 | 34 | 74 | **18** |
| `qOeu1` 字节 | 373 | 2221 | **~200** |

修后的 18 条**全部是 CF 自己的选择器**，与浏览器同性质：

```
window.frameElement, #sDsJ6 … #undefined, #BIsX1, .Oycad8, .DywTL2, .pFfL9, .FWHsC3,
button,input,meter,output,progress,select,textarea
```

**残留两点**：

1. 最后那条 `button,input,...` 来自 `element.labels` 的实现里的 `this.matches(...)`,
   Chrome 是原生的。要一并消掉得给 `matches` 也开内部通道。
2. 浏览器列表里 `.oEtkm2x` / `#cfIz0x` 那 22 条 obscura **完全没有**——
   那是 CF 建好自己的 DOM 之后在遍历它。obscura 走不到那一步,
   与 `PvWp9`（`TypeError: Cannot read properties of null (reading 'innerHTML')`）
   大概率是同一处失败。**这是下一个目标。**

**排查手记**：`PvWp9` 那条异常**抓不到**——CDP 的 `Runtime.exceptionThrown` 只报
未捕获异常，而 CF 自己 try/catch 了。改从 `qOeu1` 这条「CF 查了什么」的轨迹入手,
才看出两边在查完全不同的东西。**当一个异常被对方吞掉时，去看它吞掉之前做了什么。**

### Step 77 — 追 `PvWp9` / `QCEE0`：找到并修掉 `outerHTML` setter 与 `offsetParent`（2026-08-17）

**模块对应关系先坐实**：Chrome 的模块 24 只产 `QCEE0`（843 B，120 个探测值）,
obscura 对应的模块只产 `PvWp9`（那条 TypeError）。一个模块一个键，
**说明整个模块在第一步就抛了**。

**抓不到栈的两次尝试**：

1. CDP `Runtime.exceptionThrown` —— 只报**未捕获**异常，CF 自己 try/catch 了，0 命中。
2. CDP `Debugger.setPauseOnExceptions` —— obscura 的 `Debugger.enable`
   在 `server.rs:1487` 只是个空壳，整个域没实现，0 次 pause。

**改用矩阵法**：既然消息是 `reading 'innerHTML' of null`，就把「什么情况下会拿到
null」逐个试出来。先测**插入路径**（9 种），再测**查询面**（12 种）:

| 插入路径 | 结果 |
|---|---|
| innerHTML / insertAdjacentHTML / createContextualFragment / DOMParser+importNode / template.content / createElement / setAttribute / replaceChildren | 都能查到 |
| **`el.outerHTML = '...'`** | **查不到，宿主内容纹丝不动** |

**根因之一**：`outerHTML` **只有 getter 没有 setter**。非严格模式下（页面代码通常是）
给只读访问器赋值**既不报错也不生效**——元素原地不动，页面随后去找那个替换进来的
元素自然是 null。已按规范补上 setter（无父节点 / 父节点是 Document 时抛
`NoModificationAllowedError`，DocumentFragment 父节点按 `<body>` 上下文解析）。

**顺带修掉**：`offsetParent` **整个属性不存在**，读出来是 `undefined`——
浏览器里它永远是元素或 `null`。已补（display:none / position:fixed / body / html
返回 null，否则向上找第一个 positioned 祖先或 td/th/table 或 body）。

**但 `PvWp9` 仍在，`QCEE0` 仍缺**。12 种查询面（脱离文档的子树、closed/open shadow、
DocumentFragment、template.content、SVG、多 class、三层嵌套、iframe 文档、
自定义元素、style 元素）**全部正常**。

**一次性诊断构建**（未提交）：给所有可能返回 null 的访问器/方法加返回值钩子,
只在调用栈里含 `cloudflare`/`challenge` 时打栈。产出：

- `el.querySelector('#cf-chl-widget-XXX-fr')` → null ×6（chl_page 轮询）
- `doc.querySelector('#cf-chl-widget-XXX_response')` → null ×2
- `shadowRoot` → null（closed root，两边都一样，非缺陷）
- `previousElementSibling` / `closest('form')` → null（正常）

前两条**是轮询早于 widget 渲染**，不是缺陷——事后查页面 DOM,
`INPUT#cf-chl-widget-XXX_response[name=cf-turnstile-response]` 确实存在,
widget iframe 在 closed shadow 里（`querySelectorAll('*')` 穿不透）。

**所以 `PvWp9` 的 null 不来自这批访问器。** 还没收敛。剩余候选（未验证）：
`document.all`（obscura **完全没有**，Chrome 有；但它的 `[[IsHTMLDDA]]` falsy 语义
**在 JS 层无法伪造**——`typeof document.all === 'undefined'` 是 V8 的规范级特性,
补一个半成品只会制造新的可检测差异，**故意不做**，需要 V8 侧支持）、
`elementsFromPoint` 只返回 1 个（Chrome 至少 2 个：body 与 html）。

**方法论**：对方 try/catch 掉异常时，`Runtime.exceptionThrown` 和空壳 Debugger 都指望不上,
**给「可能返回 null 的东西」加返回值钩子**比给「抛异常的地方」加钩子有效——
前者能在异常发生**之前**把嫌疑对象点出来。

### Step 78 — `document.all`：只能在 V8 层做的那一个（2026-08-17）

step 77 记过：`document.all` 在 obscura 里完全没有，而它的 falsy 语义
**JS 层伪造不了**，所以当时**故意没做**。参考实现
（`课程/core/native/document-all`，一个 Node 原生插件）证实了这个判断——
它的核心就两行：

```cpp
templ->InstanceTemplate()->MarkAsUndetectable();
templ->InstanceTemplate()->SetCallAsFunctionHandler(DocumentAllCallback);
```

`MarkAsUndetectable` 就是规范里的 `[[IsHTMLDDA]]`：`typeof` 答 `"undefined"`、
对象为 falsy、`== null` 与 `== undefined` 都为真，**而 `===` 两者都为假**——
因为对象确实在那儿。没有任何 JS 表达式能让 `typeof` 撒谎。

**障碍**：V8 有这两个 API（`v8-template.h:983/994`），**rusty_v8 v137.3.0 没绑定**。

**做法**：照项目已有的先例（`vendor/v8-property-trace.sh` 用一个**已提交的脚本**
去打 gitignore 的 vendor 树），新增 `vendor/v8-rusty-extras.sh`,
往 `binding.cc` / `template.rs` 里补 `MarkAsUndetectable` 与
`SetCallAsFunctionHandler` 的绑定，幂等，并接进 `vendor/v8-trace.sh build`。

**分工**：Rust（`crates/obscura-js/src/document_all.rs`）只负责 undetectable 模板、
三个拦截器（named / indexed / call-as-function）和实例化；
**集合里有什么全部留在 JS**。协议是 `__obscura_document_all_resolve(kind, key)`
返回 `[value]` 表示接管、返回 `undefined` 表示不接管——
不能用裸 `undefined` 表示「答案是 undefined」，否则原型链上的成员就够不着了。
主 realm 与每个 frame realm 各装一份。

**实测（与 Chrome 逐条一致）**：

```
typeof document.all      "undefined"      !document.all        true
document.all == null     true             == undefined         true
=== null                 false            === undefined        false
'all' in document        true             toString             [object HTMLAllCollection]
all[0]/all[1]            HTML / HEAD      all[99999]           undefined
all(0)                   HTML             all('probe')         该元素
all('absent')            null             all.item(0)          HTML
all.namedItem('probe')   该元素           document.all === all true
```

**一个坑**：安装时的守卫原本写的是 `if (!collection) return;`——
**对 undetectable 对象恒为真**，正好把要装的东西挡掉了。
只有 `=== undefined` 能区分「不存在」与「undetectable」。

**限制（写清楚）**：绑定只存在于**从源码构建**的 V8。Dockerfile 与 release 工作流
链接的是预编译 `librusty_v8.a`，没有这些符号，安装器拿不到对象,
`document.all` 保持 undefined——**就是这些构建今天的行为，不是回退**。
放一个普通对象上去会让 `typeof` 答 `"object"`，用一个矛盾换掉一个缺失，更糟。

**没能解决的**：`QCEE0` 仍然缺失、`PvWp9` 仍是那条 `innerHTML` 的 TypeError。
**`document.all` 不是那个模块的成因。** 本步的收益是补上了一个真实且无法在 JS 层
实现的平台面，不是修好了那个模块。

**本轮 CF 侧复测**（同一目标、同一代理）：

| 字段 | Chrome | 原始 | 现在 |
|------|--------|------|------|
| `gqGB4` 字体 | 83 | 738 | **93** |
| `qOeu1` 选择器 | 373 | 2221 | **147** |
| 载荷总量 | 68327 | 38529 | **52034** |

### Step 79 — `fyCZH9`：先把这个字段的**结构**搞清楚，之前的读法是错的（2026-08-18）

**假设**：`fyCZH9` 差 15KB 的根因是动态 iframe 的 `_IframeWindow` 垫片
（step 78 结尾记的「Phase 3.5 统一」）。

**方法**：不再猜，直接解析浏览器基线 `/tmp/har/json/2.json` 的 `fyCZH9`。

**证据**：它不是「属性名列表」，而是一张**值 → 属性名数组**的映射：

```
"N": ["alert","atob","blur",...]          1164 条，native 函数
"x": ["opener","onabort","onblur",...]     266 条，null
"o": ["window","self","document",...]      122 条，object
"F"/"T"/"u"：false / true / undefined
其余：值本身当 key（数字、字符串）
```

前缀规则确认为：裸名 = `Object.getOwnPropertyNames(window)`；
`d.`/`n.`/`s.`/`so.` = 对 document/navigator/screen/screen.orientation 的 `for..in`；
`o.` = 页面 window 上、干净 iframe window 上没有的名字（只有 28 条，
基本是 `angular`、`runProgram` 和 CF 自己的混淆全局）。

**结论（推翻两处旧记录）**：

1. **方向记反了。** 30881 是 **Chrome** 的，obscura 是 15390。obscura 不是多报，
   是**少报一半**。`o.` 只值 28 条，iframe 垫片根本不是这 15KB 的来源——
   来源是 obscura 的平台面比 Chrome 小：`N` 386 vs 1164、`d.` 212 vs 295、
   `n.` 34 vs 81。
2. **step 68 记的「泄漏 11 → 0」不成立。** 用同一套分桶在本地复算，还剩五处：

   | 泄漏 | 表现 |
   |------|------|
   | `Deno` | hide list 的三条模式（`_` 开头 / 含 obscura / 含 Obscura）一条都不匹配 |
   | `window[0]`..`window[49]` | 无条件定义 50 个，而 `window.length` 是 0 |
   | `d._nid` / `d._scopeRoot` | `Node` 与 `_ScopedDocument` 构造里的普通赋值，`for..in` 直接列出 |
   | `window.onerror` / `onunhandledrejection` | 槽位里坐着引擎函数，读到的是**函数源码** |
   | 4 个 window 方法未标 native | `addEventListener` 等，585 字节引擎源码 |

   当时的「0」是拿 CF 载荷里的 `o.` 一项当全部看的——`o.` 只覆盖
   「页面 window 比干净 iframe 多出来的名字」，而 `Deno`、数字下标、
   函数源码全部落在**裸名**那一类，不在 `o.` 里。

**修复**（`ef59440`、`2ca045c`）：

| 项 | 修前 | 修后 |
|----|------|------|
| `Object.getOwnPropertyNames(window)` 里的 `Deno` | 有 | 无 |
| 数字下标 | 恒 50 个 | 等于 `window.length`，连接/断开时同步 |
| `for (k in document)` 的引擎字段 | `_nid`、`_scopeRoot` | 无 |
| 非 native 函数（值即源码） | 6 个 / 585 字节 | 0 |
| window 事件处理器 | 86，缺 42 多 3 | **125 / 125，零缺零多** |
| document 事件处理器 | 86，缺 47 多 16 | **117 / 117，零缺零多** |

事件处理器拆成四组（GlobalEventHandlers / WindowEventHandlers / 剪贴板 /
Document 专有），名单取自 Chrome 149 的实际枚举而不是规范文本——Chrome 有
`onmousewheel`、四个 `onwebkit*` 别名和 `onsearch`，规范里都没有。

`window.length` 同时改走内部选择器通道，不再进入 `qOeu1` 的观测。

**未做**：裸名仍差 698 个**接口构造器**（`AudioBuffer`、`XRSession` 这类
obscura 确实没实现的），`n.` 差 49（`mediaDevices`、`clipboard`、
`serviceWorker` 等），`d.` 差 53。构造器要不要凭空补是个真实的取舍，
补了会让特性检测走进一条随后就失败的分支，没在无人值守里替用户决定。

**测量盲区新增两条**：

| 盲区 | 症状 | 正确做法 |
|------|------|----------|
| **只看载荷里某一个子类就断言「泄漏清零」** | `o.` 干净，就以为整个字段干净；`Deno`、`window[0..49]`、函数源码全在裸名类里，一条没查 | 先把字段的**结构**解析清楚（有几类、各类怎么来的），再对每一类分别复算 |
| **把「obscura 比 Chrome 多」和「少」记反** | 照着「多报」的方向去找泄漏，真因是平台面缺了一半 | 对比表里两列都写清楚哪列是谁，数字旁边标基线 |

### Step 80 — CF 实测：`fyCZH9` 枚举的是 **iframe 的** window/document，不是页面的（2026-08-18）

**方法**：`SSL_CERT_FILE=/tmp/reqable-remote-ca.crt`（远端代理的 Reqable CA 与本机那张
不是同一张，本机那张会 `CERTIFICATE_VERIFY_FAILED`），零注入点击探针，
两条 `payloadJSON:` 从 serve 日志取出。首个 `/fo/` **200**，代理 JS 有效。

**step 79 的两处修复在真实载荷里确认生效**：`Deno` 不在名单里、数字下标 0 条、
函数源码桶 0 个（唯一那个是 Chrome 也有的 querySelector 数组）。

**但 step 79 有一处判断是错的，而且错得关键。** 本地我拿 `data:` 页面枚举了
**页面自己**的 window/document，CF 枚举的是**一个新建 iframe 的**：

| 类别 | obscura | Chrome | 说明 |
|------|---------|--------|------|
| 裸名 | 317 | 1238 | = `_IframeWindow` 垫片的表面 |
| `d.` | **43** | 295 | = `_IframeDocument` 垫片的表面 |
| `o.` | **493** | **28** | 页面 window 有、干净 iframe 没有的名字 |

`o.` 就是「这个页面的全局比正常窗口多出了什么」这一项异常信号。Chrome 是 28
（`angular`、`runProgram` 和 CF 自己的混淆全局）。obscura 是 **493**——
本轮补进去的 125 个 window 处理器、42 个 document 处理器、以及几百个接口构造器
**全部落进了这一桶**，因为页面 window 有而垫片没有。

也就是说：**这一轮针对页面 window/document 的修复，CF 只透过 `o.` 的差集看到，
反而把 `o.` 撑大了。** 字节数几乎没动（15390 → 15925），异常信号却更强了。

**所以 step 79 里「iframe 垫片根本不是这 15KB 的来源」这句要收回一半**：
它确实不是**字节差**的来源（那是平台面缺失），但它是 `d.` 43 vs 295、
`o.` 493 vs 28 这两项的**唯一**来源，而这两项比字节差更像判据。
最初把根因定在垫片上的直觉是对的，我用一次测错对象的本地实验把它推翻了。

**载荷对比**（同一目标、同一代理，紧凑 JSON 字节）：

| | obscura | Chrome |
|---|---------|--------|
| 载荷 1 | 4520 | 4041 |
| 载荷 2 | 94258 | 109065 |
| `fyCZH9` | 15925 | 30881 |
| `QCEE0` | 缺失 | 843 |

反向偏差（obscura **多报**）也记下来，之前没注意过：
`tjDL4` 2869 vs 187、`QvHgQ8` 638 vs 2、`ldcgI8` 218 vs 9。

**测量盲区新增一条**：

| 盲区 | 症状 | 正确做法 |
|------|------|----------|
| **本地复算枚举了页面对象，而 CF 枚举的是新建 iframe 的对象** | 页面 window 的 `for..in` 是 242 项，CF 收到的 `d.` 只有 43；据此对「补了多少」「还差多少」的估计全部偏离，并把根因判反 | 复算前先从真实载荷反推**被枚举的是哪个对象**（看类别的成员和顺序像谁），再在同一个对象上复算 |

### Step 81 — iframe 初始 about:blank 文档改由 Rust 同步提交（2026-08-18）

**修复**（`bc0e0cf`）：`op_dom` 新增 `create_blank_iframe_document`，在插入步骤里同步
建内容根、解析 `<html><head></head><body></body>` 骨架、按**穿透 shadow** 的方式
继承创建者文档的源。`_IframeWindow` / `_IframeDocument` 两个垫片连同 332 行删除；
未插入 DOM 的 iframe 现在 `contentWindow` 为 `null`（与浏览器一致）。

**一处踩坑值得记**：第一版用 `containing_iframe_content_document` 取父文档源，它只看
节点自己的 tree scope。Turnstile 把 widget 建在**闭合 shadow root** 里，于是取不到父
文档、回退到顶层源，widget realm 访问自己刚建的 frame 直接抛 SecurityError，
链路从 6 个请求掉到 3 个。换成 `containing_document_root_shadow_including` 后恢复。

**CF 实测（同目标同代理）**：

| | 修前 | 修后 | Chrome |
|---|------|------|--------|
| `for..in` 帧文档 | 43 | **243** | 295 |
| `fyCZH9` | 15925 | **19867** | 30881 |
| 载荷 2 | 94258 | **98410** | 109065 |
| `o.` | 493 | 339 | 28 |

**并且搞清了 `o.` 的真正语义（之前理解错了）**：它不是「iframe window 上没有的名字」，
而是「**取值与 iframe window 不同**的名字」。证据：obscura 的 `o.` 与裸名重叠 316 项，
Chrome 重叠 5 项（`innerHeight`/`innerWidth`/`event`/`frameElement`/`Array`）。

那 316 项全部是同一种差异：**页面 window 上桶为 `N`，空白帧 window 上桶为 `f`**。
它们是 `_iframeRealmGlobal` 为每个帧造的 realm 局部包装（浏览器里
`frame.Object !== Object`，这层不能省）。在本机顶层 realm 里这些包装的
`Function.prototype.toString` 返回的就是 `[native code]`，所以 CF 区分二者用的不是
toString。**下一步先查这个**：一个可疑点是包装用 `Object.setPrototypeOf(wrapped, source)`
继承静态成员，于是 `Object.getPrototypeOf(frame.Event) === Event` 而不是
`frame.Function.prototype`——真实浏览器不是这样。**尚未验证，不要当结论用。**

**未决**：裸名 499 vs 1238（缺 698 个接口构造器）、`n.` 39 vs 81、`QCEE0` 仍缺失。

### Step 82 — `o.` 那 316 项是「JS 包装过不了 CF 的原生检测」，两个假设被证伪（2026-08-19）

**假设**：step 81 末尾留下的两个候选——①包装用 `Object.setPrototypeOf(wrapped, source)`
导致 `Object.getPrototypeOf(frame.Event) === Event`；②`_markNative` 的 `_nativeFns` Set 是
per-realm 的，主 realm 的包装在 frame realm 里 toString 会漏出 JS 源码。

**方法**：逐条实现最小修复、重跑同一目标同一代理、看 `o.` 和裸名 `f` 桶变不变。

**证据**：

先把 316 项的桶归属钉死。obscura 载荷里这 316 个名字**裸名桶全是 `f`、`o.` 桶全是
`N`**（`Object`、`Event`、`addEventListener`、`fetch` 等一律如此）。也就是说：被枚举的
两个窗口里，一个是「非原生函数」`f`，另一个是「原生函数」`N`。前者是新建 iframe 的
`contentWindow` 表面（realm 还没建、由 `_iframeRealmGlobal` 包装兜底），后者是页面自己的
V8 原生构造器。Chrome 里这两者都是 `N`，所以没有 `o.` 前缀。

两个假设**逐一证伪**：

1. **`getPrototypeOf` 不是判据。** 把 `setPrototypeOf(wrapped, source)` 换成「静态成员
   拷贝 + `[[Prototype]]` 留在 `Function.prototype`」，本地复验
   `Object.getPrototypeOf(frame.Object) === Function.prototype` 成立、`frame.Object !== Object`
   成立、静态成员（`Object.keys`/`Array.isArray`/`Promise.resolve`）照常。CF 实测 `o.` 仍
   339、裸名 `f` 仍 314，**一字未动**。
2. **跨 realm 的 `toString` 也不是。** 先写了个跨 realm 探针确认这个 bug 真实存在：
   `Function.prototype.toString.call(__main.Event)` 在 frame realm 里返回 `class Event { …`
   的源码而不是 `[native code]`（V8 原生 `Object` 则正常返回 `[native code]`）。然后把
   `_nativeFns`/`_nativeStr` 挪到 `Deno` 上共享（`Deno` 是各 realm 同一个对象、且已从
   枚举面隐藏），跨 realm toString 修复、回归测试通过。CF 实测 `o.` 仍 339、`f` 仍 314，
   **一字未动**。

两个修复都已回退，树保持干净。

**结论**：CF 区分 `N`/`f` 用的既不是 `getPrototypeOf` 也不是 `Function.prototype.toString`
（无论同 realm 还是跨 realm）。它是一层**靠 JS 无法伪造的 V8 原生检测**（比如
`%FunctionGetScript` 或内置函数才有而普通 `function(...){}` 拿不到的内部槽）。因此
`_iframeRealmGlobal` 造的 JS 包装**永远**过不了这关，`o.` 的 316 项不是靠把包装改得更像
原生能消掉的。

**真正的方向**：让新建 iframe 在 `append` 当刻拿到**真 realm**（V8 原生 `Object`/`Event`
表面），而不是 JS 包装。`bc0e0cf` 只把**文档**改成了同步提交，window 面仍是包装兜底；
这正是代码里标注的「Phase 3.7 per-frame realm」。这块是同步建 context 的架构改动，不是
一行 JS 能补的，留作下一步。

**测量盲区新增一条**：

| 盲区 | 症状 | 正确做法 |
|------|------|----------|
| **把「改包装让它更像原生」当修复方向** | 连续改 `getPrototypeOf`、跨 realm toString 两处，`o.` 都一字未动——包装是 JS 函数，CF 的原生检测在 V8 内部层，JS 层面改不动 | 先确认判据在哪一层（JS 可伪造 vs V8 内部），再决定是「改包装」还是「建真 realm」 |

**附带发现（真实 bug，但与 `o.` 无关，已回退留档）**：`_markNative` 的 `_nativeFns`/`_nativeStr`
是 per-realm 的，主 realm 标记为原生的函数（`Event`、`addEventListener`、iframe 包装）在
frame realm 里 toString 会漏 JS 源码。修法是把这两个集合挪到 `Deno`（跨 realm 共享）上。
这不是本步目标，但任何「引擎内部源码泄漏」的排查都会撞到它，先记在这里。

### Step 83 — 同步建 frame realm：`o.` 339 → 165，裸名 `f` 314 → 5（2026-08-19）

**假设**：step 82 结论是「JS 包装过不了 CF 的原生检测，只能建真 realm」。这一假设**方向对了、
机制说错了**——真 realm 之所以能修，不是因为「V8 原生」，而是因为真 realm 里的 `frame.Event`
是**和页面 Event 结构一致的 bootstrap class**，而包装是 `function(){}` + `Object.create(prototype)`。

**方法**：实现 Phase 3.7 的同步建 realm。`op_ensure_frame_realm`（`#[op2(reentrant)]`，拿
`scope: &mut v8::HandleScope`）在 op 内 `v8::Context::new` 建 context、跑满 bootstrap + init +
fingerprint、注册进 `frame_realms`、返回 realm bridge。`contentWindow`/`contentDocument` 两个
getter 在首次访问时惰性触发，bridge 缓存进 `__obscura_frame_realm_globals`。

**关键实现点**（每个都踩过坑）：

1. **re-entrancy**：bootstrap 的 `__obscura_init` 会调 op_dom。若 `op_ensure_frame_realm` 用
   `state: &mut OpState`，op2 宏对 `OpState` 的 `borrow_mut` 会一直持到函数返回，嵌套的 op_dom
   再 `borrow` 直接 panic（`panic_cannot_unwind` + SIGABRT）。改成 `state: &OpState`（共享借用），
   且把输入读齐后立刻 drop `ObscuraState` 的 `Ref`，嵌套 op 才能正常派发。
2. **frame 身份可达性**：`frame_realms` 原本在 `ObscuraJsRuntime` 上，op 够不到。改成
   `Box<FrameRealmHost>`（堆上稳定地址），`ObscuraState` 存一个 `*mut FrameRealmHost` 指针。
3. **惰性 + 只对 about:blank**：只在 `document_scope` 的 `frameId` 为空（即
   `create_blank_iframe_document` 造的初始文档）时同步建 realm；异步 loader 已经 commit 的
   文档（frameId 非空）照旧走 `ensure_frame_realm`，否则会把有 frameId 的文档的 realm 建错 id。
4. **`contentDocument` 与 `contentWindow` 一致性**：两个 getter 都要先 `_materializeFrameRealm`，
   否则先读 `contentDocument` 再读 `contentWindow` 会拿到两个不同的 document。
5. **`defaultView`/`globalThis` 身份**：真 realm 的 `document.defaultView` 指向 realm 自己的
   globalThis，不是页面的 WindowProxy。两个 getter 返回 realm document 前要把它的
   `_defaultViewProxy` 指到页面 proxy；proxy 的 `globalThis` 和 `self`/`window`/`frames` 一样
   返回 proxy 本身。

**CF 实测（同目标同代理）**：

| | 修前 | 修后 | Chrome |
|---|------|------|--------|
| `o.` | 339 | **165** | 28 |
| 裸名桶 `f` | 314 | **5** | 0 |
| `o.` 桶 `N` | 330 | **48** | ~17 |
| `fyCZH9` bytes | 19867 | 20072 | 30881 |

`o.` 从 493（step 81 前）一路降到 165。裸名 `f` 只剩 5 个：`postMessage`/`blur`/`focus`/`close`
（WindowProxy 自己的方法，还是 JS 函数没标 native）+ `constructor`。

**剩余 `o.` 的构成**（165 项）：大头是**frame realm 的引擎内部泄漏**——`__obscura_*`/`_*`
bootstrap 全局（`__obscura_frame_document_nid`、`Deno`、`__obscura_hide_list`、`_markNative`、
`_wrap` 等约 140 项）+ 4 个 frame 标志（`__obscura_frame_document_nid` 等）+ CF 自己的混淆全局
（`FtIMT8` 等 ~20 项，Chrome 也有）+ `innerWidth`/`innerHeight`（viewport 差，Chrome 也有）。
也就是说：**主 realm 的 `_preHideInternals` 把这些内部藏住了，但同步建的 frame realm 没藏干净**。

**修正 step 82 的结论**：step 82 说「JS 包装永远过不了 CF 的原生检测，判据在 V8 内部层」——
**证伪**。真 realm 的 `frame.Event` 同样是 bootstrap JS class（不是 V8 原生），照样桶 `N`。判据
不是「V8 原生 vs JS」，是「bootstrap class vs 包装 `function(){}`」之间的结构差（`.prototype`
与 class 形态）。所以正确的修法确实是用真 realm 替换包装，但理由不是「更原生」，而是「结构与
页面一致」。

**下一步**：①把 frame realm 的内部字段藏干净（对齐主 realm 的 `_preHideInternals`）；②给
WindowProxy 的 `postMessage`/`blur`/`focus`/`close` 标 native。这两处都是小改，改完 `o.` 应该
能再往 28 靠一截。

**回归测试**：`spawn_frame_realm` 走的是新 op 路径，现有 509 个 obscura-js 测试全绿（含
`iframe_content_window_exposes_realm_globals`、`a_connected_iframe_has_its_initial_about_blank_document_at_once`
两个 iframe 测试）。

### Step 84 — 藏干净 frame realm 的内部字段：跨 realm 枚举 131 项 → 0（2026-08-25）

**根因**：step 83 说「frame realm 的内部字段没藏干净」，但 `Object.getOwnPropertyNames(contentWindow)`
这条路径是干净的（WindowProxy 的 ownKeys trap 走 `_frameRealmOwnKeys`，最终落在 frame realm 自己的
`Reflect.ownKeys` 上，被 `_hideInternalsFromReflection` 过滤）。真正的漏点不在 Proxy，而在
`iframe.contentWindow.eval('globalThis')`：这一步把 frame realm 的**真实 global 对象**交回主 realm，CF
再用**主 realm**的 `Object.getOwnPropertyNames` 去枚举它。过滤器的 `_isGlobal` 只认
`t === globalThis`（本 realm 的 global），跨 realm 的 frame global 不匹配，于是 `Deno`、`__obscura_*`、
`_*` 共 131 个内部字段全部漏出。

**修复**（两处，都在 `bootstrap.js`）：

1. `_isGlobal` 加一个判别：`t.globalThis === t`。V8 的 global 对象（主 realm 和每个 frame realm）都
   自引用 `globalThis`，普通对象不自引用，所以这是零副作用的判据。跨 realm 枚举 frame global 时，
   过滤器现在也认得它是 global 并按 hide list 过滤。
2. hide list 显式补齐 4 个 frame 标志（`__obscura_frame_document_nid` / `__obscura_frame_base_url` /
   `__obscura_frame_id` / `__obscura_frame_generation`）。它们是 Rust 在 bootstrap 前设到 frame global
   上的，主 realm 的 `Object.getOwnPropertyNames(globalThis)` 扫不到，模式匹配也就漏掉了。

**本地验证**：`Object.getOwnPropertyNames(iframe.contentWindow.eval('globalThis'))` 里的内部字段
从 131 项降到 0。CF 实测未跑（需同一目标同一代理），预期 `o.` 再往 28 靠一截。

**回归**：新增 `frame_realm_globals_stay_hidden_from_cross_realm_enumeration`；5 个 iframe/枚举测试
全绿。全量 419 个 obscura-js 测试里 5 个失败（`frame_elements_report_their_own_document_geometry`、
3 个字体相关、`css_supports_matches_capabilities_and_boolean_conditions`），stash 本改动后依旧失败，
均为预先存在的环境相关失败，与本步无关。

### Step 85 — WindowProxy 方法标 native：裸名 `f` 剩下的 4 个方法清掉（2026-08-25）

**根因**：step 83 裸名 `f` 里剩下 `postMessage`/`blur`/`focus`/`close`，它们是 `_frameWindowProxyFor`
和 `_ancestorWindowRef` 的 `target` 对象字面量里的普通 JS 函数，没进 `_nativeFns`。CF 枚举
`frame.contentWindow` 读到它们时拿到的是函数源码而不是 `[native code]`。

**修复**：两处 WindowProxy 的 `target` 定义后各加 `_markNative(target.postMessage / blur / focus /
close)`。`_markNative` 把函数加进主 realm 的 `_nativeFns`，主 realm 的 `Function.prototype.toString`
对它们返回 `function <name>() { [native code] }`，与 Chrome 一致。

**回归**：新增 `frame_window_proxy_methods_read_as_native_code`，4 个方法的 toString 都含
`[native code]`。相关 iframe/枚举测试全绿。

### Step 86 — WindowProxy 的 constructor 身份：返回 frame 自己的 Window（2026-08-25）

**根因**：`frame.contentWindow.constructor` 走 Proxy get trap 的 `Reflect.has(t, 'constructor')`
分支，沿 `target` 对象字面量的 `Object.prototype` 原型链取到主 realm 的 `Object`。Chrome 返回
iframe 自己的 `Window`，所以 CF 读到的是身份错误的 constructor。

**修复**：`_frameWindowProxyFor` 和 `_ancestorWindowRef` 两处 Proxy 的 get/has trap 里，对
`constructor` 单独处理，委托给 frame realm 的 `globalThis.constructor`（= 该 frame 的 `Window`），
不再走 target 的原型链。跨 origin 时 `constructor` 不在 HTML allowlist，get 抛 SecurityError、
has 返回 false，与 WindowProxy 规范一致。

**回归**：新增 `frame_window_proxy_constructor_is_the_frames_window`，验证
`win.constructor === win.Window` 且 `!== Object`。7 个 WindowProxy 同源/跨源测试全绿。

**未做**：`win.constructor`（frame 的 `Window`）在**主 realm**视角下 `Function.prototype.toString`
仍返回 `class Window {...}` 源码而非 `[native code]`。这是 step 82 已探索过的跨 realm toString 问题
（把 `_nativeFns` 挪到 `Deno` 共享可修，但 CF 实测 `o.` 不变，已回退），不属于 constructor 身份修复，
留作独立项。至此 step 83 的「下一步①藏内部字段 + ②标 native」连同 constructor 身份都已落地。

### Step 87 — thelancet.com 实测：窗口已藏干净，document 的 `_*` 自有属性仍泄漏（2026-08-26）

**假设**：step 83–86 把 frame realm 窗口内部字段藏干净后，obscura 的 CF 指纹应与 Chrome
更接近；用 `thelancet.com/1.txt` 对拍验证（以 Chrome 的三个 payload 为基准）。

**方法**：
- 信任代理 CA：正确下载点是 `http://cert.reqable.com/ca`（经代理访问），拿到
  `CN=Reqable CA (Apr 4, 2026, 0D1CEBE3)`。`http://mitm.it/cert/pem` 返回占位 mitmproxy
  证书、`http://reqable.com/ssl` 被 EdgeOne 拦成 567，都不是代理实际用于 MITM 的 CA，
  用错导致首次 `CERTIFICATE_VERIFY_FAILED`。
- `SSL_CERT_FILE=/tmp/reqable-ca.crt OBSCURA_ALLOW_PRIVATE_NETWORK=1 obscura serve
  --proxy http://192.168.3.57:9000 --stealth`。
- CDP 预注入被动 hook：postMessage 全文 + XHR/fetch/beacon body + 各 realm 的
  `Object.getOwnPropertyNames(globalThis/document/navigator/screen)`，经 `console.warn`
  汇总到 serve 日志一次 grep 全拿。

**证据**：
- 挑战跑到 `interactiveBegin`（12.4 s），3 个 POST 与 Chrome 同构：页面 `/fo/`(2327 B)、
  widget `/g/fo/`(4642 B → 79180 B 的第二次大载荷，即指纹提交)。
- widget 窗口 `getOwnPropertyNames` 已无 `_obscura*`/`Deno`/`_*` 全局（step 83–84 生效，
  与 step 83 的裸名 `f` 314→5、step 85 的 5→0 一致）。
- **document 仍泄漏引擎自有内部字段**：frame realm document 的 own keys =
  `["_nid","_scopeRoot","_defaultViewProxy"]`；主 realm =
  `["_nid","_treeParent","_treeParentEpoch","_styleSheetList"]`（widget 晚快照还多 `_fonts`）。
  Chrome 把这些属性放在 `Document.prototype` 上，实例 own keys 为空。
- navigator 缺约 23 个 Chrome 有的属性：`scheduling`/`userActivation`/`plugins`/`mimeTypes`/
  `serviceWorker`/`virtualKeyboard`/`managed`/`bluetooth`/`hid`/`serial`/`usb`/`xr` 等。

**结论**：
- **是 obscura 的缺陷，不是页面正常行为。** `_hideInternalsFromReflection` 的 `_filter`
  只对 `_isGlobal(t)` 过滤，document/Node 实例不是 global，`Object.getOwnPropertyNames(document)`
  原样返回 `_nid` 等。这是 step 83–84 修窗口同类问题的下一个实例：内部字段以可枚举自有属性
  `this._nid = nid` 挂在 DOM 实例上，而 Chrome 用原型访问器。
- **下一步**：把 document（含 Node 实例）的 `_*` 自有属性也藏掉。两个方向：① `_filter` 对
  DOM 实例（`t instanceof Node` 或 `t._nid !== undefined`）也过滤 `_*` 前缀；② 更彻底，内部
  字段改存 Symbol/WeakMap，不走可枚举自有属性。前者快、后者根治。
- navigator 缺口是独立的「能力面缺失」，与本步 document 泄漏不同类，另计。

### Step 88 — document 的 `_*` 自有属性改 Symbol 键：`getOwnPropertyNames(document)` 泄漏归零（2026-08-26）

**根因**：`_hideOwnProperty` 只把字段降成 `enumerable: false`，挡得住 `Object.keys`/`for-in`，
挡不住 `Object.getOwnPropertyNames`（它返回非枚举自有属性）。而 `_hideInternalsFromReflection` 的
`_filter` 只对 global 生效，document/Node 实例不是 global，`getOwnPropertyNames(document)` 原样
返回 `_nid` 等引擎自有字段。

**修复**：把 8 个引擎内部字段从字符串自有属性改成 `Symbol.for` 键——`_nid`、`_scopeRoot`、
`_defaultViewProxy`、`_treeParent`、`_treeParentEpoch`、`_ownerDocRoot`、`_styleSheetList`、
`_fonts`。symbol 键不出现在 `getOwnPropertyNames`/`Object.keys`/`for-in`，`document._nid` 直接读
返回 `undefined`，与 Chrome 一致（Chrome 把这些槽位放在 WebIDL 原型 / C++ backing store）。
`Symbol.for` 保证主 realm 与每个 frame realm 拿到同一个键，且 Rust 注入的 JS 片段
（obscura-js 的 realm.rs/runtime.rs、obscura-browser 的 page.rs、obscura-cdp 的 dom.rs、
obscura 的 page.rs）统一用 `Symbol.for('obscura.nid')` 读回，无需暴露全局。顺带删掉已死的
`_hideOwnProperty`（它的 `defineProperty` 慢路径对「一个 document 一个 realm」才划算，symbol 纯赋值
对成千上万的 element 也零开销，正好取代它）。

**回归**：新增 `document_does_not_leak_engine_internals_via_own_property_names`，断言主 document、
frame document、element 的 `getOwnPropertyNames` 都不含这 8 个字段，且 `document._nid === undefined`。
obscura-js 513、obscura-browser 105 全绿。

**未做（独立项）**：element 上还有 **215 个** `_` 前缀自有字段（`_style`/`_tagName`/`_ns`/`_lname`/
`_nullNamespaceAttrs`/`_treeConnected`/`_treeConnectedEpoch`/`_treeDetachedExact` 等），是同一类泄漏的
更大面。CF 当前的 `fyCZH9` 用选择性 `d.` 列表、不枚举 element 自有属性，所以暂不阻塞；若后续指纹
升级为 `Object.getOwnPropertyNames(element)`，再按同一 Symbol 手法批量转换。

### Step 89 — 重验证：document 泄漏归零，但默认 UA 错配 + navigator 缺 42 属性才是更大错配（2026-08-27）

**假设**：step 88 把 document 内部字段改 Symbol 键后，obscura 的 CF 指纹应与 Chrome 更接近；
用 thelancet.com/1.txt 对拍 Chrome 三 payload 验证，并量化剩余缺口。

**方法**：
- `SSL_CERT_FILE=/tmp/reqable-ca.crt OBSCURA_ALLOW_PRIVATE_NETWORK=1 obscura serve
  --proxy http://192.168.3.57:9000 --stealth --port 9223`，先不带 `--user-agent`（默认指纹）。
- `enum_realm.py`（预注入各 realm 的 `Object.getOwnPropertyNames(globalThis/document/
  navigator/screen)`，经 console.warn 汇入 serve.log）确认 document 泄漏归零 + 抓 navigator 枚举面。
- `capture_challenge.py` 确认挑战进展 + 提交载荷大小。
- 与 Chrome payload-2/3 的 `fyCZH9` 对拍：正则提取 Chrome 读的 81 个 `n.*` 路径，逐一在 obscura
  求 `typeof navigator[p]`，得出缺失集合。

**证据**：

1. **document 泄漏归零**（step 88 生效）：主 realm `getOwnPropertyNames(document)` = `[]`，
   frame realm = `[]`；晚快照（t=9s）主/frame 均只剩 `["lang","dir"]`（合法 document 内容属性；
   Chrome 把它们放 `Document.prototype`，obscura 作为 own 属性——同一类小残留，非引擎内部字段）。
2. **默认 UA 错配**：`/json/version` 报告 `Chrome/146.0.0.0` + Windows NT 10.0 UA；而 Chrome
   payload 是 `Chrome/149.0.0.0` + `MacIntel`。加 `--user-agent "Mozilla/5.0 (Macintosh; Intel
   Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"` 后
   `navigator.platform=MacIntel`、`vendor=Google Inc.`、`appVersion`/`userAgent` 全对齐。根因：
   `fingerprint.rs` 的 `DEFAULT_USER_AGENT` 与 `wreq_client.rs` 的 `STEALTH_USER_AGENT` 都硬编码
   Windows Chrome 145/146。
3. **navigator 缺 42 属性**（step 87 说 ~23，实测 42）：Chrome 读 81 个 `n.*`，obscura 39 存在、
   42 个 `typeof undefined`。缺的拆两类——
   - 对象类（20 个，Chrome 落 `o` 桶）：`bluetooth`/`hid`/`serial`/`usb`/`xr`/`mediaSession`/
     `presentation`/`managed`/`virtualKeyboard`/`userActivation`/`devicePosture`/
     `windowControlsOverlay`/`webkitPersistentStorage`/`webkitTemporaryStorage`/`storageBuckets`/
     `modelContext`/`login`/`ink`/`protectedAudience`/`scheduling`；
   - native 方法类（22 个，Chrome 落 `N` 桶）：`getUserMedia`/`requestMIDIAccess`/
     `requestMediaKeySystemAccess`/`runAdAuction`/`joinAdInterestGroup`/`leaveAdInterestGroup`/
     `updateAdInterestGroups`/`createAuctionNonce`/`registerProtocolHandler`/
     `unregisterProtocolHandler`/`clearAppBadge`/`setAppBadge`/`vibrate`/
     `getInstalledRelatedApps`/`getInterestGroupAdAuctionData`/`adAuctionComponents`/
     `canLoadAdAuctionFencedFrame`/`clearOriginJoinedAdInterestGroups`/`webkitGetUserMedia`/
     `deprecatedReplaceInURN`/`deprecatedURNToURL`/`deprecatedRunAdAuctionEnforcesKAnonymity`。
   这 42 个在 Chrome 是有值/函数，在 obscura 是 undefined，CF 的 `fyCZH9` 会把它们从 `o`/`N` 桶
   移到 `x` 桶——真实 Chrome 恒有这些 API，是明确的 bot 信号。
4. **次级值错配**：`navigator.languages=["en-US","en"]`（Chrome `["zh-CN"]`）、
   `hardwareConcurrency=8`（Chrome 6）、`deviceMemory=8`（Chrome 16）。均不在 `--user-agent`
   推导范围内，需 `FingerprintOverrides` 覆盖。
5. **`__obscura_click_target` 泄漏**：晚快照主/frame realm 的 window own keys 各多一个
   `__obscura_click_target`（同源还有 `__obscura_focused`）。它是 bootstrap.js 的 focus/点击处理
   （`globalThis.__obscura_click_target = this`，行 3843/4735/4819）运行时设上去的，不在
   `__obscura_hide_list`（那列表是 bootstrap 期静态名，`_hideInternalsFromReflection` 按名过滤
   而非前缀），所以漏出。`_cf_chl_opt`/`__wfEmit` 是 CF 自己的全局，Chrome 也有，不算泄漏。
6. **挑战进展不变**：仍跑到 `interactiveBegin`（t=14.3s），三次提交同构——页面 `/fo/` 2359B、
   widget `/g/fo/` 4610B → 79319B（大指纹，与 step 87 的 79180B 同量级）。

**结论**：
- document 泄漏已根治（step 88 验证通过）。
- 但**更大的错配是默认 UA + navigator 42 属性缺口**——step 87 把它们当次要项，实为指纹对不上的
  主因之一。UA 是配置（`--user-agent` 即时对齐），navigator 42 属性是代码缺口（需补 API 外壳）。
- `__obscura_click_target` 是 step 83–88 同类内部字段泄漏的又一处，但只在交互后出现，影响小于
  navigator 缺口。

**下一步（按影响排序）**：
1. 补 navigator 42 个属性外壳：对象类返回带权限检查的空接口对象，native 方法类返回抛
   `NotAllowedError` 的原生函数，与 Chrome 的形状一致（无真实实现）。这是当前指纹最大缺口。
2. 对齐默认 UA：`DEFAULT_USER_AGENT`/`STEALTH_USER_AGENT` 是否应默认 macOS Chrome 149，或加显式
   配置入口，避免每次 serve 都带 `--user-agent`。
3. `__obscura_click_target`/`__obscura_focused` 改 Symbol 键或加进 hide list。
4. `FingerprintOverrides` 暴露 languages/hardwareConcurrency/deviceMemory 的 CLI 覆盖，
   以匹配参考 Chrome 的 zh-CN/6/16。

### Step 90 — 全三轮明文对拍：N 桶缺 773 构造器 + UA-CH/WebGPU/iframe 几何错配（2026-08-27）

**假设**：step 89 的三个缺口（默认 UA、navigator 42 API、click_target 泄漏）之外，
提交体其余字段已基本对齐；用 `thelancet.com/1.txt` 全三轮明文对拍验证。

**方法**：
- 代理 `http://192.168.3.57:9000`（Reqable，CA 经代理取 `http://cert.reqable.com/ca`，CN=Reqable
  CA，`SSL_CERT_FILE` 指向它）。该代理**改写 CF 挑战脚本，在提交前把载荷对象以
  `console.log("payloadJSON: " + …)` 打出**；obscura 把所有 realm 的 console 汇进 serve 日志。
- serve：`--stealth --proxy … --user-agent <macOS Chrome 149>`（UA 已对齐 step 89 教训）。
  `capture_challenge.py --click` 触发 proof 轮（该脚本的 attachShadow 注入会污染指纹字段，
  本轮数据中凡涉及枚举面/函数源码的字段已打折，见盲区表）。
- `grep payloadJSON` 提取 5 条：2× `chl_api_m` + 3× 分片提交（第 3 条是点击后 proof）。
  Chrome 基线 `/tmp/chrome/payload-{1,2,3}.json`。obscura 侧存
  `/tmp/lancet-run/obscura-payload-{1..5}.json`，对拍脚本 `compare4.py`（按**探针字段名**对齐，
  不按分片号）。
- V8 trace 轮（用户点名）：`--v8-flags "--trace --trace-property-lookup
  --no-lazy-feedback-allocation --trace-property-lookup-file=…"`。

**证据**：

1. **提交结构对齐**：chl_api_m 字段 47/47 同名零差集；分片提交 chrome 184 字段 / obscura 170，
   仅 15 个 chrome-only（其中 13 个是 chrome 第二批增量 part 的探针，属批对齐差，非缺失）+
   `hGgWW0`/`lNCr3` 两个真缺失。**Math 指纹 `mAoOT1` 184 项仅 2 项末位 ULP 差**
   （0.6043677771171635/…36、0.664036770267849/…91，V8 版本差的 transcendental 末位，实不可修）。
   SDP offer `xrGz9` 形状已对（v=0/o=-/a=group:BUNDLE 全套）。
2. **枚举桶 `ZokK1`（62 桶 vs 65）的大缺口**（比 step 89 的「42 个 navigator」大一个量级）：
   - **N 桶（window 构造器/native 函数）1164 → 399，缺 773 个**（AbsoluteOrientationSensor、
     AudioBufferSourceNode、AnimationEffect 等——真实 Chrome 恒有的 DOM/WebAudio/SVG 构造器）；
   - o 桶 121 → 75（缺 GPUBufferUsage/GPUColorWrite/GPUMapMode/GPUShaderStage/GPUTextureUsage、
     clientInformation、cookieStore、crashReport、d.anchors、d.applets、d.children 等 49 个）；
   - x 桶 266 → 255（缺 d.activeViewTransition/d.fullscreenElement/fence 等 11 个）；
   - F 桶 13 → 5（缺 credentialless/d.fullscreen/d.prerendering/d.wasDiscarded/d.webkitHidden/
     d.webkitIsFullScreen/d.xmlStandalone/n.deprecatedRunAdAuctionEnforcesKAnonymity）；
   - T 桶 11 → 6。
3. **iframe 几何/文档属性错配**（枚举在 widget iframe 里做，值桶即答案）：
   - `innerWidth/innerHeight` 应为 **0**（chrome 桶 0），obscura 报 1920/1000（顶层值泄漏进 iframe
     realm）；`screenX/screenY/screenLeft/screenTop` chrome 22/52，obscura 全 0；outer*/screen*
     桶整体错位（chrome outer 1200×1120、screen 1720×1284，obscura 1920×1040、1440×900）；
   - **`d.domain` 应为 `challenges.cloudflare.com`，obscura 报顶层域 `www.thelancet.com`**；
   - **`d.compatMode` 应为 `BackCompat`**（widget 文档无 DOCTYPE），obscura 报 `CSS1Compat`；
   - `d.lastModified`/`d.adoptedStyleSheets`/`d.webkitVisibilityState`/`d.referrer` 缺；
   - `n.language(s)` chrome `zh-CN`，obscura `en-US,en`，且 obscura 同 payload 里 zh-CN 与
     en-US 并存（内部矛盾）。
4. **UA-CH 高熵 `iqypc0` 错**：chrome `architecture=arm, platformVersion=26.4.0, brands=
   [Chromium 149, Not)A;Brand 24]`（仅 2 brand）；obscura `x86 / 10.15.7 / [Google Chrome,
   Chromium, Not)A;Brand]`。UA 字符串对齐了，UA-CH 没跟着变。
5. **WebGPU `Bpqf7`**：adapter 应报 `["apple","",…]`（macOS Chrome），obscura 报
   `["intel","gen-9",…]`（dd592e8 模板写死）——UA=Mac 但 GPU=intel，自相矛盾。
6. **WebGL**：扩展 39→36（缺 Apple GPU 的 `WEBGL_compressed_texture_{astc,etc,etc1,pvrtc}`，
   多 `WEBGL_provoking_vertex`）；limits `mYHfU0` 多值不同（120,120,120 vs 4,128,4、65536 vs
   16384 等）；能力位 `JlnK7` `[[4,2]]` vs `[[8,4,2,1]]`。
7. **渲染类指纹**：文本测量 `qSsL2` 无亚像素（29 vs 28.9375）；canvas 像素 `nMlxj2` 全 255
   （chrome 有真实像素 192,192,192/53 等）；键盘布局 `QyyA4` 表内容不同。
8. **WebRTC**：ICE `JeSBM4` 缺 srflx（chrome 9 条含 STUN 公网 36.24.58.28，obscura 仅 6 条
   host/mDNS）；SDP codec `IMOh8` 的 `audio/red/48000` 多 `;111/111` 尾巴。本地复证明 ICE
   收集本身 3ms 完成（不慢），缺的是 srflx 生成。
9. **探针行为差异**：`DZSw4` chrome `[]` vs obscura `[208,209,218,…]`、`Djlp6` chrome
   `[159,163]` vs obscura `[0,1,…,174]`（obscura 把过滤循环的输入全记了，计数器泄漏形状）；
   `hGgWW0`（`[true,…]` 断言数组+DOM 序列化）三轮全空 = 该探针在 obscura 完全失败；
   `YySko4` 事件序列形状不同；performance timeline `OIFb8` 缺 navigate 记录、多自身 fo 提交的
   fetch 记录。
10. **V8 trace 边界实测**（本轮主要观测发现，详见盲区表）：`console.log` 是 native 绑定，
    CALL 行不记（payloadJSON 实际靠 serve 日志拿）；MISS 仅 19 条——property-lookup hook 只覆盖
    V8 interceptor/slow path，bootstrap 的 JS 对象（navigator shim）的属性访问不进 trace，
    **42 个 navigator 缺口在 trace 里不可见**；rAF 56fps、idle 3ms 正常（「探针批推进慢」的
    调度假设证伪——批内耗时 obscura 反而更快 2-38ms vs chrome 22-94ms，缺的探针是**根本没产出**
    而非没跑完）。

**结论**：
- 提交链路、信封结构、Math 指纹、SDP 形状已对齐；剩余错配集中在**枚举面广度**（N 桶 773 个
  构造器是最大单一缺口）、**UA 联动面**（UA-CH/WebGPU/iframe 几何没有跟着 UA 变）和**渲染指纹**
  （亚像素/canvas）。
- step 89 的 navigator 42 缺口是 N/o 桶缺口的子集，修法相同（补外壳）但规模要按 773 估。

**下一步（按影响排序）**：
1. **N 桶构造器广度**：批量补 window 构造器外壳（可从 Chrome `Object.getOwnPropertyNames(
   window)` 快照生成清单，N 桶缺的 773 个一次对齐；对象类给带 toString 的空接口，函数类给
   抛合规格异常的 native）。
2. **UA 联动**：UA-CH（brands/architecture/platformVersion 跟随 UA 与参考 Chrome 对齐）、
   WebGPU adapter 按 UA 平台选（macOS→apple）、WebGL 扩展/limits 按 Apple GPU 模板。
3. **iframe realm 隔离**：iframe window 的 innerWidth/innerHeight/screenX… 应取 iframe 语义
   （跨源 iframe 中 chrome 报 0/窗口位）；`d.domain`/`d.compatMode`/`d.lastModified` 修正。
4. **languages 统一 zh-CN**（并消除 en-US/zh-CN 并存的内部矛盾）。
5. **渲染指纹**：measureText 亚像素、canvas 像素（nMlxj2 全 255 说明测试 canvas 没画上）。
6. ICE srflx：给 stealth 的候选生成加 srflx（与出口公网 IP 一致）。
7. `hGgWW0`/`lNCr3` 探针失败原因（结合 trace 找抛错点）与 `DZSw4`/`Djlp6` 的计数器泄漏。

**后续**：上述六组缺陷的完整修复计划（六份独立调研的合并版，含文件:行定位、对拍数据表、
实施批次 B0-B7 与依赖关系）见 `Challenge-fingerprint-fix-plans.md`。核心合并结论：UA-CH/
WebGL/WebGPU 三组的共同根因是 `fingerprint.rs::from_user_agent` 的 macOS 分支
（architecture:"x86" + Intel GPU 串），必须一个提交内原子翻转。

### Step 91 — B0-B7 全批次落地：核心指纹面收敛到 149 基线（2026-08-28）

**假设**：step 90 的六组缺陷按 `Challenge-fingerprint-fix-plans.md` 的批次全部修复后，
质询载荷的核心指纹面应收敛到 Chrome 149 基线。

**方法**：七批实现（每批独立提交、全量 `cargo nextest --features render` 门 + release 构建），
最后 thelancet.com/1.txt 真实质询三轮复测（无注入导航点击 + serve 日志 payloadJSON）。

**提交清单**：`1f9aad1` B0 oracle 采集 / `829201b` B1 默认身份翻转 / `6c6a8ee` B2 WebGL+WebGPU
平台档 / `43fc4fc` B3 frame realm 顺序 / `b26800f` B4 接口面 / `d2f8d10` B7 canvas /
`c173ea0` B6 亚像素 / `09ec3eb` B5 frame 文档属性 / `38e5d7a` lastModified 回退修复。

**证据（最终对拍，Chrome149 vs 修前 vs 修后）**：

| 指标 | Chrome149 | 修前 | 修后 |
|---|---|---|---|
| UA-CH architecture / platformVersion | arm / 26.4.0 | x86 / 10.15.7 | **arm / 26.4.0** |
| UA-CH brands | 2（Chromium 形态） | 3 | 3（默认品牌 Chrome 形态，2-brand 走 `--fingerprint` 覆盖，设计如此） |
| ZokK1 N 桶（window 构造器） | 1164 | 399 | **1137** |
| ZokK1 o 桶 | 121 | 75 | **107** |
| wShvj2 WebGL 扩展 | 39 | 36 | **39（逐项一致）** |
| Bpqf7 WebGPU info / features | apple / 20 | intel / 17 | **apple / 20** |
| JlnK7 SAMPLES 非空格式 | 15 | 34 | **15** |
| mAoOT1 Math 指纹 | 184 项 | 184 项（step 90 复核后确认本就对齐） | 184 项 |

本地端到端（跨源 frame）：innerWidth=iframe 自身盒、display:none 帧 0×0、
domain=自身 host、referrer=嵌入方 origin、lastModified 格式正确、
`getOwnPropertyNames(document)` 零 `_` 泄漏。measureText 亚像素落 1/64 边界
（16px Arial 与 Chrome 逐位一致）；canvas 渐变条与 Chrome oracle 逐字节一致。

**过程中证伪/回退的教训（新增盲区）**：
- **B4 的 pass-1 父链链接曾把真实 `TextTrackList`（extends Array）的 prototype 强接到
  EventTarget 上**——链接必须只作用于本安装器装的外壳（Set 记录），不能对全表执行。
- **snapshot 烘焙环境里 V8 的惰性全局（WebAssembly/Temporal 等）是 undefined**，typeof
  守卫会放行外壳、随后与运行时真实注册冲突（deno_core "unable to convert" panic）；
  `_ecmaScriptGlobals` 捕获不到它们（惰性），需硬编排除名单。
- **B5 的 lastModified 只加在 `_ScopedDocument`，顶层 Document 答 undefined**——CF 在主文档
  读它，unexpected-undefined 直接把三轮提交打成 `fail 600010`（step 67 的老错误码换了张脸
  回来）。靠对 committed 批次的二分（43fc4fc 过 → b26800f 过 → 09ec3eb 挂）定位到该提交，
  再本地冒烟发现字段缺失。**新增到顶文档接口的属性必须同时落在基类与 scoped 子类。**
- 质询复测必须至少两轮：第一轮 600010 时一度怀疑 CF 端波动，第二轮同败才确认是回归。

**剩余差异（后续项，均已记录在 plans 文档）**：N 桶 27 个（V8-vs-Chrome 内建差 +
147-only 面，钉 149 UA 下有意不装）、o 桶 14、x 桶 11、F 桶 7、brands 形态、
sans-serif 字体选择残差（Helvetica vs Liberation）、canvas AA 边缘值、`nMlxj2` 的
统计位、ICE srflx（B2 外的独立项）。障碍课程 33/33 未跑（本机无 obscura-benchmark
companion 仓库），全量 nextest 1652/1652 与 release 构建、`--no-default-features`
check 均过。

**结论**：step 90 六组缺陷全部落地，质询从「指纹大面积错配」收敛到「核心面与 149 基线
逐项一致，剩余为记录在案的长尾」。未过盾状态不变（判定口径仍以真实 404 为准）。

### Step 92 — thelancet 三 payload + console + V8 trace 复核（2026-08-28）

**假设**：当前 trace-patched、render + stealth 二进制经 `http://192.168.3.57:9000`
访问 `https://www.thelancet.com/1.txt` 时，能走完 render / 初始 fo / 点击 proof 三轮提交；
当前未通过点应表现为提交内容的长尾差异，而不是 console、iframe、消息或请求链路中断。

**方法**：
1. 校验 `vendor/v8-trace.sh check`、stealth 启动日志、代理 CA、端口进程和 Chrome 149 macOS UA；
2. 无 trace 启动 serve：第一轮用 `capture_challenge.py --click` 确认消息时序，后两轮用
   纯 Target/Input domain 的固定时刻点击（零页面注入），结合 `RUST_LOG=obscura_js=debug`
   与 `[CAP]`/`payloadJSON` 日志确认三次提交及最终响应；
3. 用 `diff_payload_enum.py` 从 `/tmp/chrome/payload-{1,2,3}.json` 提取 CF 实际枚举面，
   先做 Chrome 2↔3 同侧 sanity check，再按字段名与 obscura 明文 payload 对拍；
4. 独立 trace 轮启用 property lookup trace，核对 `console.log`、DOM/XHR 调用形态和 MISS。

**证据**：

1. **环境基线正确**：`vendor/v8-trace.sh check` 报 `patched`；启动日志为
   `TLS fingerprint impersonation + tracker blocking`；代理 CA 是 `CN=Reqable CA (Apr 4,
   2026, 0D1CEBE3)`；`/json/version` 的 Browser/UA 均为 macOS Chrome 149。端口无遗留进程。
2. **三轮断点完全一致**（字节数为 challenges CF 初始响应 / tokenB 响应 / 点击 proof 响应 /
   顶层转发响应）：
   | 轮次 | 探针 | 响应序列 | 最终状态 |
   |---|---|---|---|
   | r1 | `capture_challenge --click` | 822824 / 127224 / 5148 / 3256 B | 换 ray 重开 |
   | r2 | 零注入 CDP 点击 | 822376 / 127224 / 5160 / 3256 B | 换 ray 重开 |
   | r3 | 零注入 CDP 点击 | 822656 / 127216 / 5136 / 3256 B | 换 ray 重开 |
   三轮均有 `/pat/` 401、所有 fo POST 均返回 200；均无 Cloudflare `complete` 消息或目标真实
   404。payload 内部字符串 `"complete"` 是探针字段值，不能当作消息级成功判据。
3. **console 明文输入完整拿到**：r2 零注入轮提取出 4.4K `chl_api_m`、105K 初始 payload、
   109K proof payload 三个合法 JSON。Chrome 2→3 是严格增量（161→174 字段，新增 13）；
   obscura 2→3 同样是严格增量（154→169，新增 15），同侧 sanity 通过。跨侧 stage 1 为
   47/47 同名；stage 3 为 Chrome 174 / obscura 169、共同 168，Chrome-only 为 `Ftvr2`、
   `GUZP4`、`cnhD4`、`eNHTJ8`、`hGgWW0`、`lNCr3`，obscura-only 为 `nCaOH3`。
4. **核心已对齐、长尾仍明确**：ZokK1 的 N/o/x/F/T 为 Chrome `1164/121/266/13/11`，
   obscura `1137/107/255/6/6`（差 27/14/11/7/5）；`wShvj2` 39 扩展逐项相等；WebGPU
   adapter 均为 Apple 档且长度相等，feature 列表顺序仍不同；Math 184 项只在索引 165/167
   有末位差。仍明显不一致的是 UA-CH 多一项 Google Chrome brand、`hGgWW0` 120 项全缺、
   `lNCr3=true` 全缺、`qSsL2` 10/10 项不同、`nMlxj2` 11 项中 10 项不同、ICE 9→6 且缺 srflx。
5. **V8 trace 边界复证**：短时全量 trace 239MB / 1,236,528 行（CALL 607049、RET
   625606、HIT 3855、MISS 18）。它记录了 `XMLHttpRequest.open(POST, /cdn-cgi/.../fo/...)`、
   header 与加密 `send(body)`；Console/log 行为 **0**，`payloadJSON` **0**。全量 trace 约 30s
   被 watchdog 终止，只走到顶层 fo；18 个 MISS 中没有 `<page-eval>`，只含 window 级混淆名、
   `turnstile` 等。这既不能说明 console 没调用，也不能说明 CF 没枚举缺失 API：console 参数
   必须读无 trace serve 日志，普通 JS shim 的枚举面必须用 payload 对拍。

**结论**：假设证实。iframe、消息、请求与 proof 提交链都已打通，断点在 proof 后的 Cloudflare
最终判定；这是 payload parity 未完全对齐造成的引擎侧风险，不是页面正常等待或探针漏点。
但现有证据不能把拒绝因果唯一归到某一个字段。下一步先定位完全无产出的 `hGgWW0` / `lNCr3`
探针抛错点，再处理 canvas/text 指纹；其后是 ZokK1 长尾、UA-CH brand 与 ICE srflx。

### Step 93 — `jdnfg5` 缺 iframe：entry 已写入，observer microtask 未及时交付（2026-08-28）

**假设**：`payload-1.jdnfg5` 少 `rch/...` iframe URL，是 frame 导航没有写入父页面的
Performance Timeline。

**方法**：开启 `obscura::performance=debug`；零注入导航后直接读取主 realm
`performance.getEntries()`；再预注入只透传返回值的 `performance.getEntries` 和
`__obscura_performance_record` 时间钩子，对齐 entry 构造、实际入 timeline、CF 快照和 payload
输出。另解码 chl_page 的 `btnGW2` / `MhAgV7` 表达式。

**证据**：
1. 假设证伪：主 realm 明确有 `https://challenges.cloudflare.com/.../rch/...`，类型为
   `PerformanceResourceTiming`、`initiatorType="iframe"`。源码也在 frame 响应后调用
   `record_performance_response(response, "resource", "iframe")`（`page.rs:5700`）。
2. 精确时序：iframe entry 在 `15:18:04.248` 构造，`15:18:04.253` 已调用主 realm 的
   `__obscura_performance_record`，`payload-1` 到 `15:18:05.270` 才输出。不是漏请求、漏 entry、
   跨 realm 记错或 payload 快照过早。
3. CF 在顶层仅于 `performance.now≈1198ms` 调一次 `getEntries()`，当时只有 navigation 与
   orchestrate script；随后 `api.js` 和 iframe 资源靠 `PerformanceObserver` 增量收集。
   `api.js` 进入 `jdnfg5`，iframe 没进入。
4. `_queuePerformanceEntry` 会立即把 entry 放入 `_performanceEntries`，但 observer 的 callback
   用 `queueMicrotask` 调度（`bootstrap.js:12362`）。Rust 的 `execute_script` 只执行 classic
   script、不做 checkpoint（`runtime.rs:2832`）；checkpoint 只在 `run_event_loop` 边界
   （`runtime.rs:2956`）。动态 frame 路径 flush entry 后立刻执行 frame subtree scripts
   （`page.rs:5488-5490`），frame 的 postMessage 因而能先触发 `chl_api_m`，observer microtask
   还没把 iframe item 加进 CF 的累计数组。
5. `btnGW2` 与 `MhAgV7` 是同一个毫秒差值的两个别名：
   `_cf_chl_opt.erXEv3 = Date.now(); value = erXEv3 - JCXT5`。Chrome 为 1044，obscura 多轮为
   27-67（本轮 51），说明同一 widget 初始化/可见性流程在 obscura 提前结束；它不是尺寸字段，
   也不是 iframe item 缺失的直接原因。

**结论（被 step 94 证伪）**：本步曾把直接根因判为 PerformanceObserver 交付顺序错误。
step 94 的 `[PO-LIST]` 证明 parent iframe resource 已在 payload 前进入 observer callback；真正
缺失的是 child frame realm 的 navigation entry。本步的原始证据与错误假设保留，避免以后再次
把 Rust `recording`、parent resource 和 child navigation 三种不同观测面混为一谈。

### Step 94 — jdnfg5 iframe item：补 frame realm navigation timing（2026-08-28）

**假设**：Chrome 的非零 rch item 来自 child frame realm 的 PerformanceNavigationTiming；在
frame realm 创建后、任何 preload/author script 前注入该 entry，即可补齐 jdnfg5。

**方法**：先用 `[PO-LIST]` 记录 CF observer callback，再以 Chrome 151 双端口跨源 fixture 同时
读取 parent resource 与 child navigation。结果：parent iframe resource 与 Obscura 一样按 TAO
遮蔽为 0；child navigation 报完整 timing/size，`transferSize=encodedBodySize+300`，与 Chrome
payload 的 rch item 同形。实现将 response timing 暂存到 browsing context，在 frame main world
创建后、preload/author script 前注入；随后跑 focused/full nextest、release build、feature
opt-out、obstacle course 与 thelancet 三轮 payload。

**证据**：待实现与实测回填。

**证据（阶段性）**：
1. Chrome 151 双端口跨源 oracle：parent `PerformanceResourceTiming(iframe)` 按 TAO 遮蔽为
   `responseStart/transferSize/encodedBodySize=0/0/0`；child realm 的
   `PerformanceNavigationTiming` 为完整值，`transferSize=encodedBodySize+300`。Chrome payload
   的 rch item 与后者同形，step 93 的 observer 顺序假设证伪。
2. 实现：BrowsingContext 按 document generation 保存网络 response 的 navigation entry；
   frame realm 创建后、preload/author script 前调用该 realm 的
   `__obscura_performance_record`。父 timeline 的 iframe resource/TAO 逻辑未改。
3. 本地回归：`a_subframe_document_load_lands_in_the_parents_resource_timeline` 同时断言 parent
   resource 与 child navigation；focused 1/1、`obscura-browser` 106/106。
4. thelancet 修复前 3 个有效样本均只有 api.js（rch **0/3**）；修复后 3 个有效样本均为
   两项（rch **3/3**）：`transfer/encoded` 分别为 `440041/439741`、`440020/439720`、
   `440041/439741`，均严格差 300B；responseStart/duration 非零。另有一轮 8s 内未产 payload，
   未混入判据。

5. 全量门：最终源码的 workspace release+render nextest **1656/1656**（4 skipped）；精确
   render+stealth release build 通过；`obscura-js` + `obscura-cli --no-default-features` check
   通过。`obscura-benchmark` companion repo 本机不存在，obstacle course 33/33 未运行。
6. 最终源码重建后的二进制追加 smoke 仍为两项：rch `responseStart/duration=1604/1609ms`、
   `transfer/encoded=440020/439720B`，trace patch check 通过。

**结论**：修复完成。`jdnfg5` 缺 rch 的根因是 frame realm 没有自身 navigation timing，不是
parent iframe resource 漏记、TAO 遮蔽或 observer 顺序。实现与 Chrome 的双 timeline 语义一致：
parent 继续看到遮蔽的 cross-origin iframe resource，child 看到完整 navigation entry；真实
payload 从 rch 0/3 提升到 3/3。整体过盾状态未因此自动改判，剩余 payload 长尾仍按 step 92 推进。

### Step 95 — 隐藏 Error.stack 的 Obscura/deno 内部帧（2026-08-29，完成）

**假设**：QqYk7 末尾 `_runAtNesting (<obscura:bootstrap>)` 两帧来自 setTimeout 的 JS
trampoline；单改 timer 调度只能把泄漏从 bootstrap 移到 deno_core event loop。正确边界是 V8
构造 CallSite 后、交给默认或页面自定义 formatter 前，隐藏宿主内部脚本来源。

**方法**：先分别试验 `queueMicrotask` 与直接 Promise reaction 调页面 callback，记录剩余
`ext:core`/`eventLoopTick` 帧后完整回退 timer 行为。在 isolate 安装隐藏的 V8
`PrepareStackTraceCallback`，按 CallSite source 过滤 `<obscura:`、`ext:`、`deno:`，随后完整
委托 `deno_core::error::prepare_stack_trace_callback`。以 timeout/interval 内的
`new Error().stack` 和页面自定义 `Error.prepareStackTrace` 两类回归锁定，再跑 timer 全组、
crate/workspace 门和 thelancet QqYk7 三轮。

**证据（阶段性）**：
1. `queueMicrotask` 试验去掉 `_runAtNesting`，但栈底仍有 `ext:core/01_core.js`；直接 Promise
   reaction 又留下 `eventLoopTick`。两条 timer 调度改动均已完整回退，避免改变 task/microtask
   顺序、timer args、`this` 或 interval 清理语义。
2. isolate callback 仅过滤内部 CallSite，再调用 deno_core formatter；没有覆盖、删除或包装
   页面可见的 `Error.prepareStackTrace`，也没有针对 QqYk7 改字符串或 payload。
3. `timer_callback_stacks_hide_the_browser_scheduler` 同时覆盖 timeout/interval、extra args、
   `this === window` 与 clearInterval，页面 URL 保留且内部来源消失；
   `custom_prepare_stack_trace_receives_filtered_callsites` 证明页面 formatter 仍运行、可返回对象，
   且收到的是真实页面 CallSite，不含内部来源。
4. focused：stack 1/1、timer 11/11、stack 5/5、自定义 formatter 1/1；最终源码的
   `obscura-js` release+render 全 crate **518/518**。

5. 最终 release 二进制经 `http://192.168.3.57:9000` 访问
   `https://www.thelancet.com/1.txt`，Chrome 149 macOS UA 对齐；同一干净 serve 会话取得三个
   独立 ray 的有效 payload-1：

   | 样本 | ray | btnGW2/MhAgV7 | QqYk7 栈 | 内部来源命中 |
   |---|---|---:|---|---:|
   | 1 | `a324da680ab3aa69` | 49/49 | 10 帧，全部 api.js/chl_page URL | 0 |
   | 2 | `a324da8e8b1daa69` | 52/52 | 10 帧，全部 api.js/chl_page URL | 0 |
   | 3 | `a324dac03ae4aa69` | 50/50 | 10 帧，全部 api.js/chl_page URL | 0 |

   四类判据 `<obscura:`、`_runAtNesting`、`ext:core`、`deno:` 均为 **0/3**。计时值仍自然
   波动，证明实现没有伪造 QqYk7 或硬改 btnGW2/MhAgV7。
6. 全量门：workspace release+render+stealth 最终 **1658/1658**（4 skipped）；精确
   obscura-cli render+stealth release build、`obscura-js` + `obscura-cli --no-default-features`
   check 与 `vendor/v8-trace.sh check` 均通过。第一次全量门的两个 MCP 客户端集成测试时序
   失败，单独复跑 3/3 及随后完整复跑均通过，与栈改动无代码路径关联。
   `obscura-benchmark` companion repo 不存在，障碍课程 33/33 未运行。

**结论**：修复完成。内部 frame 在 V8 CallSite 层消失，页面脚本 URL、默认栈格式和自定义
`Error.prepareStackTrace` 行为保留；timer 的 task/microtask、args、`this`、interval/clear
语义未改变。真实 QqYk7 从稳定泄漏两条 `<obscura:bootstrap>` 调度帧变为三轮内部来源 0/3。

### Step 96 — payload-2 缺 hGgWW0/lNCr3：DOMParser HTML document 无 body（2026-08-29，验证中）

**假设**：Chrome payload-2 有 `hGgWW0` 与 `lNCr3`，Obscura 改为 `nCaOH3` error，是某个
HTML Document 构造路径没有 body，探针读取 `body.innerHTML` 后整组中断。第一假设指向动态
about:blank iframe 的异步 replacement commit；真实站验证未改善后，调用面收敛到
`DOMParser.parseFromString(..., "text/html")` 的 fragment-parser 实现。

**方法**：零预注入、零 Runtime.evaluate 的 CDP target 经 Chrome 149 macOS UA、Reqable 代理
静默导航 18s，解析代理 console 的每条 JSON 后按 `has("BtIb8")` 识别 47-key payload-1 与
92-key payload-2；数字 part 内部按混淆字段名摊平。源码侧对照同步
`create_blank_iframe_document` 与异步 `navigate_frame_inner`，新增 event-loop/controller commit
后的 skeleton 回归；另对 DOMParser 空输入、HTML fragment 和属性序列化建立 Chrome parity
fixture。修复后重复三轮同侧 sanity 与真实 payload-2。

**证据（修复前）**：
1. 当前 release 零注入轮的阶段结构与 Chrome 完全一致：p1 47/47、p2 92/92，顶层 key/type
   零差；Obscura p1/p2 序列化约 4,675B/108,760B。
2. p2 part 按内部字段名对齐为 Chrome 168 / Obscura 167 / common 166。Chrome-only 恰为
   `hGgWW0`（120 项成功探针数组）与 `lNCr3=true`；Obscura-only 恰为
   `nCaOH3="TypeError: Cannot read properties of null (reading 'innerHTML')"`。
3. 同步 iframe insertion 已 graft `<html><head></head><body></body></html>`，现有立即读取测试
   通过；异步 `navigate_frame_inner` 新建 replacement root 后却在 `html.is_empty()` 时完全跳过
   `parse_into_subtree`，随后删除有 skeleton 的旧 initial document。根因与 error 文案闭环。
4. 回归扩展 `dynamic_iframe_navigation_uses_the_frame_controller`，在第三次 about:blank load 后
   读取 active `contentDocument`。修复前 focused nextest **0/1**，表达式因
   `d.body.innerHTML` 抛错返回 null；删除 empty-HTML parser bypass 后 **1/1**，得到
   `[3,"HTML",true,true,""]`。
5. `obscura-browser` release+render 全 crate **106/106**。
6. **阶段性证伪**：精确 release build 后首个零注入真实 payload-2 仍为 167 probes，
   `nCaOH3` error 原样、`hGgWW0/lNCr3` 仍缺。controller empty-HTML bypass 是独立真实缺陷，
   但不是当前 CF 探针命中的完整路径；后续改从本轮 rch 源码定位具体 iframe/document 操作。
7. 真根因：DOMParser HTML 路径用 `document.createElement("html")` + `root.innerHTML=source`
   模拟完整文档。fragment parser 对空输入或 `<p>...</p>` 不会生成 head/body；docNode 的 body
   getter搜索 BODY 后返回 null。hGgWW0 的 Chrome 结果内恰有 `<p>Rqaf3</p><p>XGKq7</p>` 与
   `<div data-foo="&quot;"></div>`，与 `body.innerHTML` 探针形状一致。
8. 新增同输入 focused 回归：空 HTML、`<p>Rqaf3</p><p>XGKq7</p>`、双引号属性序列化；
   修复前 **0/1**，整个求值返回 null，与真实 nCaOH3 同形。
9. 实现仅作用于 DOMParser 的 text/html 路径：fragment 解析后补 direct HEAD/BODY，head-only
   元素在 body 内容出现前归 head，其余 loose nodes 归 body；XML 路径不变。focused 修复后
   **1/1**，并覆盖完整 `<html><head><body>` 输入。
10. DOMParser/XML related **4/4**；`obscura-js` release+render 全 crate **519/519**。
11. 精确 release build 后在同一显式 Chrome 149 macOS UA、trace-patched、stealth TLS serve
    会话里跑三次零注入 18s 导航，得到三个独立 ray。payload-2 分别为 92 keys/39 parts、
    91/38、92/39；三轮均有 `hGgWW0` 120 项，且 `nCaOH3` 均不存在。修复前是
    `hGgWW0/lNCr3` 缺失 + `nCaOH3=TypeError`，因此 skeleton 崩溃修复在真实质询中 **3/3 生效**。
12. `lNCr3=true` 三轮仍缺。`hGgWW0` 与 Chrome 120 项逐索引对拍，三轮稳定有 31 项不同；
    其中 index 85/86、103/104 的 Chrome 值为 `<p>Rqaf3</p><p>XGKq7</p>` 与
    `<div data-foo="&quot;"></div>`，Obscura 均为空串；index 118 为
    `UXHfN1611` vs `UXHfN1[object Object]`，另有 `-1` vs null 与一组 boolean 残差。
    所以“字段恢复”不等于该组已对齐，也不能据此宣称质询通过。
13. workspace 首轮 1658/1659（唯一 MCP wait selector 时序失败），失败项单独 3/3 后完整
    重跑 **1659/1659**（4 skipped）；精确 release build、trace patch、完整 stealth TLS 与
    no-default feature check 均通过。companion benchmark 仓库不存在，33/33 未运行。
14. **证伪 createHTMLDocument 归因**：Chrome oracle 证明该 API 只有一套 HEAD/BODY，而
    Obscura 在 DOMParser 已补 skeleton 后仍追加第二套；同形调用得到
    `[HEAD,BODY,HEAD,BODY]`、`bodyIsLast=false`，能产生与 hG 完全相同的两个空串。因此删除
    旧 workaround 并补 optional title/serialization 回归，focused 1/1。重新链接后真实 payload
    A/B 的 31 个差异却**一个未动**，85/86/103/104 仍为空串：这是有效的通用 DOM 修复，
    但当前 hG 的四个序列化探针不走 createHTMLDocument。下一步必须从 trace 映射调用路径，
    不能继续仅凭输出值猜 API。

**结论（更新）**：iframe controller 是独立同族缺陷，保留修复与回归；DOMParser HTML
skeleton 是 `nCaOH3` 的直接根因，真实 payload 已 3/3 证实该错误消失。但 `hGgWW0` 仍有
31 项内容差异且 `lNCr3` 缺失，当前修复只是消除了整组异常中断，不是该组 parity 或质询通过。
下一步用独立 trace 轮映射 120 项的真实调用，先解释四个 HTML 序列化空串，再处理其余项。

### Step 97 — 从 frame StackFrame 导出当轮 JSVMP source（2026-08-29，验证中）

**假设**：CDP Debugger 已能读取 top realm source，但目标 JSVMP 在跨源 frame realm，尚未注册
inspector。`op_dom` 是 JSVMP 已确认会经过的宿主边界；若其 V8 StackTrace 中的 `/rch/` frame
能通过 `StackFrame::GetScriptSource` 返回完整源码，就能直接按执行中的真实脚本映射
`hGgWW0` 120 项汇总逻辑，不再从输出形状猜 DOM API。

**方法**：在 committed `vendor/v8-rusty-extras.sh` 增补 rusty_v8 缺失的
`StackFrame::GetScriptSource` C++/Rust binding。`op_dom` 只在显式设置
`OBSCURA_CAPTURE_FRAME_SOURCES_DIR` 时取最多 24 帧；仅当任一 frame URL 包含 `/rch/` 才导出
长度至少 1KB 的 script source 与 URL，并在进程内一次性关闭。用 trace-patched render+stealth
release 二进制、Chrome 149 macOS UA、Reqable 代理做 18 秒零注入导航；此诊断轮只回答能否取得
源码，不作为 payload parity 或过盾判据。

**证据**：恢复审计确认 release binary 晚于 `ops.rs` 与 vendor binding，vendor tree 中
`exception.rs`/`binding.cc` 均含实际绑定。随后同一 18 秒零注入轮一次性导出两个 source：
`<obscura:frame-realm-bootstrap>` 983,566B，以及 URL 精确命中当轮 `/rch/q13ya/...` 的
`script-44.js` 431,327B。后者是此前 CDP main-realm Debugger 无法枚举的目标 JSVMP。

**结论**：源码导出链已证实，frame JSVMP 不再是观测盲区。下一步在这份当轮源码中以 Chrome
payload 的稳定字面量和 120 项数组构造点定位 `hGgWW0` 汇总，再用 Chrome oracle 对拍首个真实
语义差异；在完成映射前不把 31 项输出形状归因到任何 DOM API。

**补充证据**：首份 431,327B source 是 13,717 行的调用方，探针程序以 Base64 blob 传给
`runProgram(blob, window)`；文件中没有 `runProgram` 定义，且 hG 字段与 Chrome 稳定输出常量
均非明文。下一步需枚举 frame 文档全部 script，取得解释器定义后在 VM 返回边界映射 120 项。

**补充证据 2**：`Runtime.enable` 在 settle 后重放出 challenges frame 的 default context；在该
main world 中读取到 `runProgram.length=3`，其完整源码为小包装器：构造 `new Dr(blob)` 后调用
`XB(1361)` 解出的原型方法，参数为 `(0, 94, [])`。因此解释器不是第二个 DOM/V8 script，
而是同一 inline source 的顶层 `Dr` 绑定；下一步直接导出 `Dr` 构造器与 prototype 方法。

**补充证据 3**：将 probe 移到 parser frame 的真实 `execute_in_context_at` 编译边界后成功安装。
12 秒内 VM 方法被调用 2,222 次：首次 `(0,94,[])` 返回 `bound Dn`，后续由该绑定函数继续以
`(pc, seed, 26项参数)` 运行同一个 instance。因而只看最终 256 寄存器会丢失探针中间值；下一步
按每次调用的参数/返回 shape 聚合，先筛选长度 120 的值，再对候选调用做寄存器差分。

**补充证据 4**：收紧后的 2,358-call 样本中，result 与最终 registers 均没有 length=120 的
Array；第三参数栈出现 length=122 的批次 111 次。hG 数组不是 VM 方法的直接返回值。下一步按
VM 返回的短标识符精确找 `hGgWW0` / `lNCr3`，再检查相邻调用，不能仅凭 122≈120 推断结构。

**补充证据 5**：另一 ray 的 2,194-call 样本里，第三参数恰有 length=120 的调用 111 次，
但所有 VM result short identifiers 中没有 `hGgWW0/lNCr3`。参数栈长度会随变体整体漂移，旧
payload 混淆字段名也不能直接当 VM 返回地址。下一步必须从同一 ray 的 payload-2 反查实际
120-array 字段，再关联该轮 VM 调用。

**补充证据 6**：同一 ray 的落盘 payload-2 仍明确包含 `hGgWW0` length=120，前 66 项为 true，
后段含 `117`、字符串化类型、`ronhq4` 与 `UXHfN1[object Object]`。所以字段名没有变化；它未
出现在 VM result string 的含义是外层汇总映射写入。下一步搜索 118..124 参数栈内嵌套的
120-array / plain-object data property。

**补充证据 7**：候选 122/123/124 槽参数栈递归两层均没有嵌套 length=120 Array；最频繁的
122 槽环境由三个固定 `(pc,seed)` 入口反复使用（48/54/6 次），非零槽均显示为普通 Object。
下一步只读取最大三组 Object cell 的 own data descriptors，不触发 getter，以确定它们是 VM cell、
闭包还是探针结果容器。

**补充证据 8（frame VM 归因证伪）**：Object cell 的唯一 own data 属性为 `o`，证明第三参数是
VM closure environment；最大直接 cell array 仅 54 项，两层内无 hG 120-array。结合 step 96
已确认辅助 iframe 创建方为顶层 `chl_page`，且 payloadJSON 在顶层汇总，继续深挖 `/rch/` frame
VM 已无因果依据。下一步检查 top default context 的 `runProgram` 与当轮 chl_page source。

**补充证据 9（计算 realm 定位）**：top default main world 有独立 `runProgram`，源码为
`function(j,Kg,ek){ ... new bK(j)[jj(1130)](0,190,[]) }`；frame VM 则是
`new Dr(blob)[XB(1361)](0,94,[])`。VM 构造器、字符串解码器和 seed 均不同。hG 计算 realm
收敛到 top `chl_page`；下一步用已打通的 Debugger.getScriptSource 导出同一导航的 orchestrate
source，再对 top `bK` VM 做同样的只读 instance/args/result 记录。

**补充证据 10**：Debugger bridge 已逐字导出当轮 top chl_page 229,485B（scriptId 29，URL 含
同一 ray）。格式化副本定位 `bK.prototype[jy(576)]` 主循环、`U[jy(1836)]` runProgram 赋值与
`function bK` 构造器。下一轮用独立 `OBSCURA_CAPTURE_TOP_VM_DIR` 在 main
`execute_classic_script_at` 编译边界保存 top VM instance/args/result；frame 捕获开关不启用。

**补充证据 11**：首个 top probe 因固定混淆索引未安装；新 ray 的 runProgram 入口仍是
`new bK(j)`，但方法索引从 576 变为 1313。固定 `jy(<数字>)` 不是稳定锚点。诊断改为仅匹配当轮
唯一的 `new bK(j)`，用 Proxy 在首次 property get 动态取得真实 method key，再替换对应
prototype method 记录调用；不依赖混淆表索引。

**补充证据 12**：下一 ray 的构造器/参数又从 `new bK(j)` 变成 `new Qo(Q)`，证明符号名也不
稳定；但 VM 入口尾部仍是 `](0,190,[])`。诊断锚点进一步收敛为该唯一调用尾部，向前找紧邻
method bracket 与最近 `new `，整体包装 `new <Ctor>(<blob>)`；不依赖 constructor、argument
或 string-table symbol。

**补充证据 13**：第三个 top 样本连 seed 也从 190 轮换为 124；稳定面只剩
`new <Ctor>(<blob>)[<method>](0,<seed>,[])`。诊断改为枚举 `](0,` 候选，仅接受后接 1–3 位
十进制 seed 与 `,[])`、且最近 `new ` 在 method bracket 前 128 字符内的项；候选必须唯一，
否则保持原始源码不注入。

**补充证据 14**：当轮源码离线复现只有一个结构候选；marker 仍不存在的根因是 top challenge
是 target HTML 内的唯一 inline script，编译 `name` 为 target URL，Debugger/stack 的 chl_page
URL 来自 sourceURL annotation。诊断移除 `name.contains(orchestrate)`，只保留显式 env 与唯一 VM
结构双门控；普通脚本无候选，保持原文。

**补充证据 15**：移除 name 门控后 marker 仍不存在，页面却正常产出完整 payload，证明 229KB
chl_page VM source 不经过 classic Rust 编译入口，而由短 loader 动态生成。观测面改为导航前
eval wrapper：只记录 source length / VM-entry 命中，再调用保存的原生 indirect eval；先证明
动态入口，确认后再在同一边界改写。

**补充证据 16**：导航前 eval wrapper 只看到 4B `this` 与 137B helper，229KB VM 不经 native
eval。结合 bootstrap 动态 script 执行路径，probe 从主 classic 编译函数移到
`op_run_classic_script`；诊断目录同时追加每次 op 的 source length / structural candidate count /
URL，单轮即可区分未命中与注入后被页面移除。

**补充证据 17（top VM probe 成功）**：`op_run_classic_script` 成功改写，runProgram.toString
可见结构 probe，`__obscuraCfTopVmProbe` 已安装。12 秒内 top VM 仅 21 calls：首调用返回
`bound nk`，后续环境栈固定 25 cells；result shape 为 17 undefined、3 Element，没有直接
120-array。下一步完整解包 25 个 `{o:value}` cells，并查嵌套 length=120。

**补充证据 18**：25-cell 环境解包后只含 RTCPeerConnection、eval toString 与 1.337MB anti-debug
空白体，和 hG 的 DOM/API 结果形态不符；当前 runProgram 是 hG 生产者仍未证实。下一步在导航前
包装 console 四个方法，捕获代理 `payloadJSON:` 根对象及 Error.stack，从根对象取 hG array，
再按对象身份搜索所有 top VM args/cells/registers，直接验证生产链。

**补充证据 19**：console 四方法 wrapper 捕获 0，说明代理 payloadJSON 日志不经过页面当前
console 方法，对象身份链不可用。下一诊断在导航前包装 Array.prototype.push，仅当数组新长度
恰为 120 且前 50 项全 true 时保存引用与 Error.stack，随后原样返回 native push；本轮只定位
生产函数，不作为 payload parity 证据。

**补充证据 20（阶段结论）**：push 诊断同样捕获 0。结合 25-cell 内容与旧定向 trace，已证伪
两条归因：frame `Dr` VM 属于 widget；top secondary runProgram 只覆盖 RTCPeerConnection、eval
toString 与 anti-debug blank source。hG 的剩余 31 项属于 top 主解释器/汇总路径，旧 trace 中
高频 `uA.<computed> [as run]` 是下一目标。所有会改写 CF source 的临时 realm/op probe 已删除；
保留通用 Debugger.getScriptSource bridge、StackFrame source binding 与 env 门控只读 dump。

**补充证据 21（主VM结构映射）**：离线重读修复前保留的358MB calls trace，`uA` constructor
在top orchestrate line1接收大Base64 program，紧接computed run以`(0,101,Array)`启动；该run整轮
75 calls，同实例opcode helper中`B` 10269 calls。另一ray的完整top source中对应结构是`nT`：
256-register `this.g` constructor、computed prototype run与`new nT(Q)[...](0,124,[])`入口，符号和
seed轮换但结构一致。该source还含已排除的`bK` runProgram VM，证明上一轮“唯一候选”只在单个
动态source内成立。下一诊断应同时包装所有同结构VM，按call count和逐call register diff识别
75-call主VM，不再固定constructor名或seed。

**补充证据 22（主VM probe命中，hG阶段受外部状态阻塞）**：临时env-gated transform按上述
结构同时包装所有候选，并以Symbol键保存逐call 256-register浅diff；constructor/method表达式
在probe scope外求值，避免rotating短名碰撞。当前ray命中同一`FX` VM class的三个instance，
seed=68，14秒内calls为62/44/5且无异常，证实观测边界正确；另一轮为25/24 calls。两轮都没有
110..130长度数组或`Rqaf3/XGKq7/UXHfN1/data-foo` marker，与当前payload-1后早期600010、无
payload-2的外部状态一致，不能据此映射hG。该transform只作诊断，取证后删除；等Reqable注入
脚本/key恢复payload-2时，用同一结构重跑即可直接定位31项差异的call/register。

### Step 98 — UA-CH brands/fullVersionList 对齐 Chrome 149 macOS（2026-08-29，验证中）

**假设**：当前 BrowserFingerprint 把 Chrome UA 自动解释为三品牌 Google Chrome + Chromium +
grease，并把两条真实品牌 full version 都降成 UA 字符串里的 149.0.0.0；参考 Chrome 149 macOS
在该质询中只发 Chromium + grease，Chromium full version 为 149.0.7827.0。这一稳定 JS/网络
自洽差异是独立 bot 信号。

**方法**：从 `/tmp/chrome/payload-2.json` 与当前零注入 release payload 按字段名提取
`iqypc0`，核对 architecture/platform保持已对齐，只比较 brands/fullVersionList。随后审计
`BrowserFingerprint::from_user_agent`、显式 overrides、JS NavigatorUAData 与 wreq/client header
生成，建立三层回归；不按站点、ray或payload字段硬编码。

**证据（修复前）**：Chrome brands=`[Chromium 149, Not)A;Brand 24]`，fullVersionList=
`[Chromium 149.0.7827.0, Not)A;Brand 24.0.0.0]`；Obscura 多 `[Google Chrome 149]`，且 Google/
Chromium full version均为149.0.0.0。两侧 architecture=arm、bitness=64、platform=macOS、
platformVersion=26.4.0已经一致，差异严格收敛到品牌表。

**结论**：验证中。下一步修正默认 macOS Chrome 149 profile，同时保留显式 brands与
fullVersionList override语义，并验证JS低/高熵值和HTTP请求头使用同一表。

**实现（阶段性）**：新增校准的 `DEFAULT_BROWSER_VERSION=149.0.7827.0`；仅当UA字面量等于
仓库 `DEFAULT_USER_AGENT` 时使用 Chromium+grease两品牌与该高熵版本。其他Chrome UA仍保留
三品牌/字面版本推导，显式brands/fullVersionList overrides仍最高优先。新增fingerprint、
stealth实际请求头和V8 NavigatorUAData三层回归；待focused/full与真实payload验证。

**真实A/B反证**：精确release、trace-patched、完整stealth、相同代理/UA下三次18秒零注入导航，
均只产约4.7KB payload-1，紧接约862B错误对象，`qECS7=600010`，未出现payload-2/iqypc0。
修复前同基线是payload-2 3/3且有hG。合并改动导致上游分流，不能保留。下一步做分量二分：
保留149.0.7827.0高熵版本、恢复Google Chrome+Chromium+grease三品牌，重复三轮；若恢复payload-2，
则两品牌与网络/TLS身份冲突，Chrome解密payload的局部形状不能直接套到当前transport profile。

**分量二分（受外部状态混杂，不能归因）**：恢复Google Chrome+Chromium+grease三品牌，仅保留
149.0.7827.0高熵版本后，再跑三次18秒零注入；仍全部payload-1后立即600010，无payload-2。
但所有实现完整回退、重建原始reduced profile后，三次基线也同样快速600010，且每个18秒窗口
多次换ray重试。说明CF脚本/代理/IP外部状态在顺序实验期间变化，不能把退化归因到fullVersion
或brand数量。唯一可证结论是两个候选都未改善当前判定；所有实现和新增回归已完整回退，
step 98关闭为不确定实验，不计作修复。

### Step 99 — ZokK1已存在接口的类型/native分类修复（2026-08-29，验证中）

**假设**：剩余N桶27个Chrome-only不全是缺接口。有效step97 payload显示
`IDBKeyRange/NodeFilter`在Obscura落o桶，`blur/close/focus/postMessage`落非native f桶；Chrome
将六者都放N桶。先修已存在值的WebIDL类型和native源码形态，可同时减少N缺口与o/f extras，
且不需要新增站点特例或伪造行为。

**方法**：用受控Chrome main world对拍六个global的typeof、own descriptor、prototype、
constructibility与Function.prototype.toString；审计bootstrap实际实现，保留现有调用语义，只修
WebIDL外壳/branding。随后用本地枚举fixture和真实payload验证bucket迁移。

**证据（修复前）**：ZokK1 N桶Chrome/Obscura=1164/1137。Chrome-only含IDBKeyRange、
NodeFilter、blur、close、focus、postMessage；Obscura-only o桶含IDBKeyRange/NodeFilter，f桶含
四个Window方法，形成一一对应的类型/源码分类错误。

**结论**：验证中。下一步先取Chrome oracle，再做最小通用实现。

**Chrome oracle与实现（阶段性）**：Chrome151 main world确认NodeFilter是name=NodeFilter、length=0、
无prototype、nonconstructible native function；IDBKeyRange是length=0 illegal constructor，prototype
keys为constructor/includes/lower/lowerOpen/upper/upperOpen；blur/close/focus/postMessage均为global
enumerable、无prototype、nonconstructible native method，postMessage.length=1。Obscura修复前两接口
是object，四方法可构造且三个匿名/postMessage.length=2。实现保留常量、IndexedDB range语义和
消息投递，只替换WebIDL外壳/隐藏状态/branding；focused Chrome-shape回归1/1通过。

**实现后本地证据**：四个IDBKeyRange prototype getter与`includes`现在共用WeakMap receiver
brand check；借出`lower` getter后对普通对象调用得到`TypeError: Illegal invocation`，不再返回
undefined。release+render focused回归1/1、obscura-js全crate 522/522、精确CLI release build与
`vendor/v8-trace.sh check`均通过。用本地HTTP加载同一fixture时，六个global的typeof/name/length、
descriptor、constructibility、prototype keys与native toString继续匹配Chrome151 oracle。
workspace release+render nextest为1662/1662（4 configured skips），obscura-js/CLI no-default-features
check通过。
真实ZokK1迁移仍等待Cloudflare恢复payload-2，不能用当前payload-1后`600010`替代该判据。

### Step 100 — 当前请求链复核与下一缺口选择（2026-08-29，验证中）

**假设**：Step 98/99期间的payload-1后早期`600010`可能仍是代理注入challenge JS/key失效，
也可能外部状态已恢复。必须先用零页面注入导航取得首个`/fo/` HTTP状态与payload阶段；若仍为
首个`/fo/` 400，则按既有测量盲区停止引擎归因并刷新代理脚本。若payload-2恢复，则立即对Step99
六接口做三ray ZokK1迁移验证；否则转向不依赖新payload的既有Chrome oracle稳定缺口。

**方法**：trace-patched render+stealth release、显式Chrome149 macOS UA、Reqable代理与其CA；
CDP只创建target/导航/等待，不执行`addScriptToEvaluateOnNewDocument`或早期Runtime.evaluate。
请求是否发出和完成以`RUST_LOG=obscura_js=debug`为准，失败消息来源另行读取被动CDP事件。

**证据**：零注入18秒轮先后生成ray `a329e972c9974627`、`a329e99ed80d4627`。两轮页面端
`thelancet /h/b/fo/`均为200、约113.58KB；随后widget端第一个
`challenges.cloudflare.com /h/g/fo/`均为**400、121B**，对应代理明文错误对象均为862B且
`qECS7="600010"`。没有payload-2；失败后`/eb/chl_api_m`也为400，并触发换ray。导航器未安装
preload、未点击、未做Runtime.evaluate，排除探针污染。

**结论**：证实当前断点是profile已记录的代理注入challenge JS加密key过期形态，不是Step99
或当前引擎代码造成。真实bucket验证必须等代理脚本/key刷新。本轮继续使用最后一个有效
payload-2选择可由Chrome oracle独立证明的通用接口缺口，不拿当前600010做引擎归因。

**下一缺口Chrome151 oracle**：localhost安全上下文逐项检查剩余Document方法。24项全部定义在
`Document.prototype`（当前实例向上depth=2），descriptor均writable/enumerable/configurable，
均为nonconstructible native method且错误receiver执行WebIDL brand check。可独立闭环的首批14项：
`captureEvents/releaseEvents/clear/exitPointerLock/webkitCancelFullScreen/webkitExitFullscreen`零参数
返回undefined；`browsingTopics()` resolve空Array；`hasUnpartitionedCookieAccess()` resolve true；
`ariaNotify` length1/缺参TypeError；queryCommand五个方法length1/缺参TypeError。caret、XPath、
fullscreen/PiP Promise、storage-access请求、moveBefore和ViewTransition需要各自子系统，暂不造空壳。

**首批实现**：Document class新增上述14项并统一先过`_documentPrivacyRoot` brand check；
`hasUnpartitionedCookieAccess`复用现有per-document storage-access状态，queryCommand按idle与
contenteditable选区区分enabled/state/value。class method保证nonconstructible，现有最终WebIDL
pass统一设enumerable/native。focused release回归1/1通过。

**EventTarget.when/Observable实现**：Chrome oracle确认四个`when`路径共享EventTarget.prototype方法，
返回cold Observable；`subscribe`返回undefined并由Subscriber.signal取消。实现WeakMap-backed
Observable/Subscriber，覆盖Chrome prototype的19个操作符/terminal方法、teardown、AbortSignal，
并将共享when接入Document、window匿名prototype、Screen和ScreenOrientation。descriptor/length/
native、事件投递、取消、map/filter/take/toArray/first/last/reduce focused回归1/1通过。

**剩余接口实现**：XPathExpression/createExpression/createNSResolver复用现有XPath evaluator；
CaretPosition与两个caret APIs复用elementFromPoint+Range；requestStorageAccess复用privacy grant并
对未授权第三方fail-closed，requestStorageAccessFor仅同源resolve；fullscreen/PiP按Chrome失败
闭环；moveBefore走真实DOM reparent；ViewTransition实现异步update、ready/updateCallbackDone/
finished、types、skip/waitUntil。三组focused回归均1/1。由最后有效payload静态重算，原34个
Chrome-only N路径已全部获得对应实现；真实bucket仍必须由刷新key后的三ray payload-2确认。

**完整门与静态分类**：obscura-js release+render 527/527；workspace 1667/1667（4 configured
skips）；精确render+stealth CLI build、trace patch check、obscura-js/CLI no-default feature check
与`git diff --check`均通过。新release CLI逐项读取旧Chrome-only 34路径，全部满足function、native
toString且Reflect.construct不成功，`failures=[]`。Step100本地实现完成；真实站结论保持未通过，
唯一下一动作是刷新代理注入key后取得三ray payload-2和最终真实响应。

### Step 101 — ZokK非N桶对象/状态长尾（2026-08-29，验证中）

**假设**：N桶静态穷尽后，o/x/F/T仍有一组明确的通用WebIDL差异。最后有效payload集合差为
Chrome-only o=17（`o.event`是CF自有，跳过）、x=11、F=7、T=5。它们大多不是复杂行为，
而是Document collections、Window bar objects以及应为null/boolean的状态getter。

**方法**：先用clean release对每个路径读取typeof/Array.isArray/toStringTag；HTMLCollection若因
Array subclass落入数组桶，修真实collection identity并跑所有collection回归。随后用Chrome151
oracle锁定Document/Window descriptor、identity与值，不按payload字段硬编码。

**证据（修复前）**：15个o候选和全部x/F/T候选为undefined；`document.children`为
`[object HTMLCollection]`但`Array.isArray(document.children)===true`，解释其不在o桶。Document
textContent错误为空字符串而Chrome为null。

**实现**：HTMLCollection从Array subclass改为WeakMap/provider-backed WebIDL object，保留数字/
命名Proxy访问、iterator、live identity并让构造器illegal；Document补anchors/applets/embeds/plugins
等live collections、customElementRegistry、FeaturePolicy、FragmentDirective。Window补External、
六个BarProp、StyleMedia；Document/global/navigator补全部null/false/true状态getter。focused回归以
与payload相同的分类优先级验证o=16、x=11、F=7、T=5，39条`bucketFailures=[]`。

**crate门**：obscura-js release+render 528/528通过；forms/images/links live collection、window named
duplicate collection、frame/worker/event/selector路径无回归。

**结论**：本地实现与crate回归完成；完整workspace/release门在Step102一并通过。真实bucket迁移
仍等待Reqable注入key刷新，质询状态保持未通过。

### Step 102 — `IMOh8` audio RED codec投影（2026-08-29，验证中）

**假设**：最后有效payload里`IMOh8`只有一个codec字符串不同：Chrome为
`audio/red/48000`，Obscura为`audio/red/48000;111/111`。SDP offer中的
`a=fmtp:63 111/111`本身与Chrome SDP一致；错误发生在从SDP生成
`RTCRtpSender/Receiver.getCapabilities()`结果时，Obscura把RED的fmtp误暴露为
`sdpFmtpLine`，而Chrome在capabilities视图中省略它。

**方法**：保留`_rtcAudioLines`的SDP内容，只在`_rtcCapabilities`投影codec对象时按Chrome
语义处理RED；focused回归同时断言offer仍含`a=fmtp:63 111/111`、capabilities中的
`audio/red/48000`无`sdpFmtpLine`，并保持其余audio/video codec顺序与fmtp不变。随后运行
obscura-js crate与完整release门。真实`IMOh8`仍需等Reqable注入key刷新后用三ray payload-2验证。

**证据（阶段性）**：实现把RED与RTX的payload-type映射限定在offer SDP，不写入静态codec
capability；其余codec的fmtp投影不变。focused release回归分别1/1通过：capabilities断言
audio RED没有`sdpFmtpLine`且Sender/Receiver逐字一致；peer-connection offer断言仍含
`a=fmtp:63 111/111`，原ICE与m-line断言保持通过。

**完整门**：obscura-js release+render 528/528；workspace release+render 1668/1668
（4 configured skips）；精确render+stealth CLI build成功，`vendor/v8-trace.sh check`
为patched，no-default-features check通过。最终release CLI同形求值精确返回
`audio/red/48000`。companion benchmark仓库不存在，obstacle course未运行。

**结论**：通用codec投影修复与本地验证完成，预计消除最后有效payload的`IMOh8`唯一差异；
Reqable注入key刷新前无法取得新payload-2，因此不能把预期当作真实迁移或过盾证据。

### Step 103 — qSsL2/nMlxj2当前源码受控复现（2026-08-29，验证中）

**假设**：最后有效payload中的文本与canvas差异可能部分早于B6亚像素和后续canvas修复，不能直接
据旧值继续改实现。先从Chrome/Obscura有效payload解析两个字段的精确结构，再用本机Chrome与当前
release对同一最小输入取值，区分“已自然修复的旧差异”和“当前仍存在的通用缺陷”。

**方法**：按探针字段名从payload数字part合并qSsL2/nMlxj2，先做Chrome2↔3与Obscura同侧sanity；
根据值结构和保留的challenge source/trace恢复输入。oracle必须使用同字体、字号、canvas尺寸、
colorSpace/pixelFormat和DPR；无法证明输入同形时不改代码。

**证据**：待解析与受控oracle回填。

**证据（阶段性）**：Chrome payload-2/3同侧sanity显示两个字段逐值稳定。qSsL2是10个DOMRect
快照，每项8字段可映射为bottom/top/left/right/height/width/x/y；nMlxj2由像素前缀、计数/耗时/hash、
10组TextMetrics、ImageData colorSpace/pixelFormat、unorm8/float16读写和两组导出尺寸/hash组成。
8月27日Obscura旧样本仍为白色像素、整数TextMetrics、format=null、颜色读回全零与空导出hash；
该样本早于B6/后续canvas修复，尚不能代表当前源码。

**Step97当前值复核**：8月29日有效payload中，nMlxj2的10组TextMetrics宽度已从整数变成1/64px
亚像素，说明B6确实进入真实探针；但ImageData仍报告pixelFormat=null，display-p3请求回读srgb，
四组unorm8/float16颜色像素仍为0,0,0,255，导出尺寸为null/0且hash为空SHA-256。该形状跨同一
日志的多份payload稳定。qSsL2仍与8月27日旧值一致，10/10 DOMRect未改善。

**源码根因候选**：当前getImageData/createImageData构造的ImageData硬编码colorSpace=srgb且不定义
pixelFormat；OffscreenCanvas.convertToBlob固定resolve空Blob。它们与payload的display-p3回退、
format=null和空SHA-256逐项闭环，但像素类型/转换和导出编码仍需Chrome oracle后才能实现。

**Chrome151受控oracle**：同一1x1 canvas fixture确认ImageData默认srgb/rgba-unorm8，P3 settings
保留display-p3，rgba-float16返回Float16Array；display-p3 context回报真实context attributes。
以color(srgb 1.1 0.1 0.5)与color(display-p3 1 0.25 0.5)绘制后，四组getImageData结果分别为
[255,28,127,255]、[255,64,127,255]、[1.0888671875,0.10845947265625,0.499267578125,1]与
[1,0.2509765625,0.498046875,1]，与payload形状和值闭环。当前release四组均为黑色，且错误输入
不抛；根因包含settings未实现与CSS Color 4解析缺失。

**实现与回归**：ImageData改为WeakMap backing slots和Chrome形状重载/异常，补colorSpace/
pixelFormat、Uint8ClampedArray/Float16Array；2D context保存真实attrs，CSS color()经D65矩阵在
sRGB/Display-P3间转换，get/create/putImageData支持unorm8/float16。OffscreenCanvas改为自身
持有真实_Canvas2D backing，convertToBlob复用PNG编码，transferToImageBitmap返回49x44快照并清空，
createImageBitmap支持Canvas/Offscreen/ImageData/PNG Blob。ImageData focused 1/1、Offscreen
focused 1/1、既有canvas 4/4、obscura-js 530/530。

**完整门与最终产物**：workspace release+render 1670/1670（4 configured skips）；精确
render+stealth CLI build、trace patch check、no-default-features check与git diff check通过。
最终release binary运行同fixture，四组ImageData格式/颜色值保持对齐；Offscreen PNG为非空
image/png，createImageBitmap与transferToImageBitmap均为49x44，transfer后backing透明。

**结论**：nMlxj2的ImageData colorSpace/pixelFormat、unorm8/float16颜色与Offscreen空导出
三组通用根因已修。本地证据预计消除该字段中对应子项，但PNG编码hash、字体TextMetrics与首段
canvas像素仍可能不同；Reqable key刷新前不能用新payload确认实际字段变化。

**qSsL2后续调查**：lookup trace把最强调用锚定到top VM的rX链，但calls trace没有对应DOM构造，
且保存source来自另一ray，无法恢复完整输入。受控Arial fixture证明Obscura canvas advance已与
Chrome接近/相等，而DOMRect被inline buffer与Taffy默认rounding整数化。实验性关闭全局rounding后
focused rect从73变72.9375，但obscura-render全crate仅580/588，replaced ratio、percentage flex、
SVG、float与ex padding共8项改变。该实验及临时测试已完整回退。正确实现需要CSSOM专用unrounded
geometry贯穿transform/inline fragment/sticky/scroll，不能用全局reflow或改测试基线替代。

**CSSOM-only实现**：DomLayout新增并行unrounded rect map，从最终Taffy unrounded_layout递归收集；
PreparedRender仅在新cssom viewport路径读取，并复用既有transform及resolved scroll/sticky movement。
paint、hit testing、scroll extents、client metrics与layout convergence仍使用rounded rect。auto inline
formatting context仅在rounded宽度与ceil(shaped advance)+edges一致时，把CSSOM宽度换成1/64 advance；
offsetWidth/Height/Top/Left在JS API边界继续取整。Chrome fixture的72.9375 rect/73 offset/72.9375
canvas focused 1/1；先前全局rounding实验唯一残留的min-content测试恢复1/1。

**完整门与render证据**：旧rounded DOMRect回归改为验证authored 66.6/142.7浮点值，client/offset
整数断言保持；focused 1/1，obscura-js 531/531，workspace release+render 1671/1671（4 configured
skips）。精确render+stealth release build、trace patch、no-default-features和diff check均通过。
最终release fixture四组inline rect逐值等于canvas advance，核心组为72.9375/offset 73/72.9375。
deterministic suite全部Obscura行为断言通过；检查器10项失败均在Chrome151侧，属于仓库旧Chrome
参考不匹配。representative top/bottom除Porkbun两次50s导航超时与Angular bottom一次module watchdog
后50s超时外均完成成对非空捕获或按动态capture boundary排除，产物仅在临时目录。

**结论**：CSSOM-only通用实现和本地完整门已完成，未改变paint/reflow基线。真实qSsL2/nMlxj2迁移
仍等待Reqable注入key刷新后的三ray payload-2；目标页面真实响应尚未返回，质询状态保持未通过。

### Step 104 — 当前有效challenge直连链路与低开销op trace（2026-08-29，验证中）

**假设**：Reqable过期rewrite只让明文payload不可用，不等于当前Cloudflare链路本身仍在首次
`600010`。绕过代理直连现行脚本可确定真实断点；已有`--trace-op-file`比全量V8 CALL trace开销低，
可能在payload-2边界给出hG后半组对应的宿主调用序列。

**方法**：用Step103最终trace-patched render+stealth release直连
`https://www.thelancet.com/1.txt`，35秒硬窗口，只开`obscura_js=debug`并筛选请求完成行。成功判据仍是
目标`/1.txt`真实响应，不采用challenge文案或cookie。随后从保留Chrome payload-2和Step97同ray
日志结构化提取hG全部逐索引差异；下一轮启用CLI native op trace并按widget首个`/fo/`时刻关联。

**证据**：top orchestrate 200/230996B；top `/h/b/fo/` 200/113584B；widget首个`/h/b/fo/`
200/823148B；`/pat/` 401/1B；widget proof `/fo/` 200/127712B。页面一度显示Verification successful，
最终仍回到“Enable JavaScript and cookies to continue”，没有顶层完成转发或目标真实响应。当前脚本与
key可用，断点已明确位于proof回包后的最终判定。远端Reqable CA可达，但本机没有其rewrite规则，
因此明文payload刷新仍需要代理维护方。

**保留样本复核**：hG的31项差异精确集中在index75-118：一个12/13、19个boolean、6个-1/null、
四个HTML序列化串/空串，以及index118的`UXHfN1611`/`UXHfN1[object Object]`。此前Range与普通
DOM method marker均为零调用，这批形状不能再直接归因到某个DOM API。

**op trace证据**：`--trace-op-file`以约44.4K行完成整轮，没有全量V8 trace的预算问题。调用时序
证明DOM conformance批次发生在widget首个大fo回包后、proof fo之前。writer原本收到
`[cmd,arg1,arg2]`却只写前两项，本轮扩为arg3+result；因此可同时读取`set_inner_html`源、
`inner_html`结果和`compare_order`返回值。默认未启用trace时只做OnceLock静态分支，不克隆参数。

**detached Document Chrome151 oracle与实现**：Chrome的text/html与XML parser结果分别为
`[object HTMLDocument]`/`[object XMLDocument]`，均`instanceof Document`；own key只有enumerable、
non-configurable的`location` accessor且值null，22个安全方法直接来自Document.prototype。root/body/
新建节点owner均指返回文档，documentElement.parentNode与getRootNode投影Document，Document↔root
position为20/10。修复前Obscura是plain Object、55个own键、owner指live document、position=35。
实现用WeakMap/root nid map保存内部owner，以Proxy隐藏configurable shell属性并保留真实prototype
method identity；Node只为标记过的detached树投影parent/root/contains/position，live/frame/native
DOM不变。focused DOMParser 4/4、obscura-js 531/531、workspace 1671/1671（4 skipped）；精确release、
trace patch、no-default和diff check均通过。

**结论**：质询仍未通过。default UA与显式macOS Chrome149 UA的direct轮都走到proof fo 200后失败，
没有目标真实响应。detached Document修复与旧hG的boolean/position簇闭环，但Reqable明文rewrite
未刷新，不能把预期迁移当作真实payload证据；下一步必须刷新代理challenge JS/key后量化hG剩余项，
再恢复主VM register关联，而不是继续从加密响应体猜字段。

### Step 105 — 更新代理后的条件点击与明文payload复测（2026-08-29，验证中）

**假设**：代理维护方已更新缓存challenge JS/key，首个widget `/fo/`应从旧400/600010恢复为200并
产生payload-2。当前managed挑战可能在第二次`/fo/`后进入interactive分支；必须先识别
`interactiveBegin`和非零widget box，再点击一次，不能按固定延迟盲点。

**方法**：使用trace-patched render+stealth release、远端Reqable CA/代理与显式macOS Chrome149 UA。
首轮带closed-shadow/message探针，只用于确认第二次`/fo/`后是否出现interactive UI；同时满足
`interactiveBegin`和iframe box才经CDP Input执行pre-move、press、release一次，并检查新proof fo、
顶层转发与目标真实响应。该探针会污染attachShadow源码和全局枚举，所以指纹结论另取零注入三ray
payload-2，按字段名而非part编号与Chrome/旧Obscura样本对拍。

**证据 1（缓存与交互）**：零注入轮top fo 200/113584B、widget大fo 200/822304B并恢复约110KB
明文payload-2，确认缓存更新有效。交互轮在`interactiveBegin`且iframe为300x65@(192,304)后只点
一次；刚进入interactive就点没有proof。新ray按严格配方延迟到12.3s点击后，界面进入Verifying，
产生widget proof fo 5240B和top转发3256B，随后换ray重开挑战，没有目标真实响应。交互链已打通，
但最终判定仍失败。

**证据 2（三ray字段迁移）**：零注入ray `a32b3b6f98b1d1db`、`a32b424b98660bbb`、
`a32b43887a6f780d`均有120项hG，和Chrome仍差31项，lNCr3仍缺；qSsL2 10/10不同，nMlxj2
顶层8项不同。IMOh8三轮均逐值等于Chrome。ZokK1的o/F/x/T计数已完全对齐，N为1167 vs Chrome1164。
精确集合差中Chrome-only N仍是`blur/close/focus/postMessage`，Obscura同四项仍在f桶；而
WindowProxy侧`o.blur/o.close/o.focus/o.postMessage`已在N桶。

**下一假设**：Step99本地回归只用同realm patched Function.toString，实际Zok从另一realm读取全局
Window方法；`_nativeFns/_nativeStr`各realm独立，导致同一类方法在WindowProxy本地副本为N、跨realm
全局值为f。下一步把registry放到realm共享的Deno宿主对象，以真实payload四项f→N作唯一A/B判据；
不迁移则完整回退。

**证据 3（证伪跨realm registry）**：共享Deno registry后，受控frame realm读取top四方法的
toString从源码变为native，focused 1/1；但重链后的零注入真实payload仍为N=1167/f=4，
`blur/close/focus/postMessage`一个未迁移。按预设完整回退候选与测试扩展。CF实际获取/字符串化路径
不是该受控oracle，不能据此修改全局native registry。

**下一目标**：nMlxj2当前11个顶层子项仅3项已相等；首段canvas像素Chrome为白/灰而Obscura为
黑/深灰，导出的49x44尺寸已对但两个hash随同一backing不同。下一步用明确标注为侵入式的canvas
调用探针只恢复输入/状态，不使用该轮payload做指纹结论，再以相同输入建立Chrome oracle。

**canvas输入与受控oracle**：侵入式轮恢复的49x44场景为0.4缩放后三个圆以multiply叠加，随后
source-over填充双圆evenodd镂空。由此确认三处通用缺陷：path rasterizer忽略multiply、
fill('evenodd')忽略fill rule、partial-alpha颜色对外暴露premultiplied RGB。统一straight-alpha
source-over/multiply compositing并修evenodd后，受控Chrome151的opaque/partial/colorCount为
1596/120/114；Obscura 8x8 coverage为1574/152/197，改为小canvas 4x4后为1598/128/136，三项
均明显更近。为限制热路径成本，仅面积不超过65536像素使用4x4，大canvas保持2x2。focused
canvas_multiply_evenodd_and_edge_alpha_match_browser_semantics已覆盖叠色、镂空、partial alpha
与save/restore composite；真实字段迁移必须另取零注入ray。

**零注入真实迁移**：最终4x4 release的ray a32b7c9b9983ea99生成38-part payload-2。nMlxj2的
内部image hash从此前值迁移为d7af5a906222e9be31e545c45af826f8，证明修复进入真实探针；但
49x44 blob/bitmap hash仍为ca886a1bb3787da9be4bb9cb92ea536d，Chrome三者均为
d60c1bc9f33d481d1919461f625340d1。首2x2像素也从旧黑/64灰迁移为黑/48灰，仍不同于Chrome的
白/192/244/53。结论是multiply/evenodd/straight-alpha修掉了真实通用缺陷，但canvas输入链仍有
另一上游语义差异；下一步按侵入式日志恢复2x2准确调用序列，不从hash猜实现。

**arc方向根因与修复**：2x2准确序列是黑底后以白色执行arc(0,0,2,0,1,true)并fill。当前arc
丢弃第六个counterclockwise参数，flatten一律按顺时针短弧，正好解释像素覆盖反相；同时
arc(0,0,r,0,2π,true)也被归一成错误方向。实现现保存方向，按整圆/方向归一化sweep，负半径
抛IndexSizeError。小半径8段多边形把第三像素压到207，提高最小段数到16后受控2x2为
255/191/239/48，Chrome为255/192/244/53，最大灰阶差5；focused 1/1。下一判据是重新链接后的
零注入nMlx首像素与三个hash迁移。

**arc真实payload验证**：首个release ray只到top fo，按无效外部分流丢弃。第二个ray
a32b8ef8eb85dfca完整走top fo113584B、widget大fo845736B、PAT401和proof fo127224B，生成39-part
payload-2。nMlx首2x2从修复前的黑/48/黑/48迁移为白/191/239/48，与Chrome白/192/244/53只剩
1/5/5灰阶误差；真实证实counterclockwise修复。内部image hash仍d7af5a...，49x44 blob/bitmap
仍ca886a...，所以大场景hash是独立剩余差异，不再归因短弧方向。

**最终二进制条件点击复核**：第二次widget fo为822544B；探针在其后同时看到interactiveBegin与
300x65@(192,304)，按严格start=12配方于t=12.3s只点击一次。页面进入Verifying，随后产生widget
proof fo5160B和top转发3256B，约2秒后换ray重启挑战，没有目标/1.txt真实响应。当前arc修复没有
破坏交互链，用户要求的“第二次fo后识别，需要时点击一次”已在最终二进制执行。

**float16 backing根因与实现**：侵入式getContext参数证明四个颜色context分别是srgb/display-p3
乘unorm8/float16；float两组attrs虽已报colorType=float16，旧实现内部仍统一Uint8Clamped，故扩展
sRGB裁到1、P3 .25/.5量化。实现仅为显式float16 context分配Float32权威backing，renderer继续使用
字节mirror，unorm8不增加内存。Chrome151 main-world进一步证明float Canvas使用Skia D50 gamut
转换；unorm8保留既有D65字节路径。分离后CF同形float结果逐值为1.088867/.106018/.497314与
1/.25/.5，ImageData和arc focused 2/2；真实payload仍待release重链。

**float16真实payload验证**：release零注入ray a32bb2bb9b3062a2生成39-part payload-2，四组color
从此前2/4相等提升到4/4逐值等于Chrome，包括扩展sRGB 1.088867/.106018/.497314和P3 1/.25/.5。
arc首2x2迁移保持。49x44内部/导出hash仍分别d7af5a...与ca886a...，说明颜色backing缺陷已闭环，
大场景剩余应继续从全像素边缘/叠色分布定位。

**Canvas C1文本准备**：十个measureText参数的数值code point证明CF有意传UTF-8 byte binary-string，
并非TextDecoder缺陷。Chrome151对原C1串与显式U+FFFD给相同宽度；Obscura把C1直交cosmic-text时
宽度仅25-36。measureText/fillText/strokeText现共用C1→U+FFFD准备，focused断言宽度与像素同形。
release ray a32bc987df5d75c0中十宽度迁移到38.66-67.89，Chrome40.34-65.68，最大误差从约31px
降到2.21px；剩余为bundled font资源/outline metrics差异，不做比例或字符串特判。

**最终门与条件点击**：obscura-js533/533、workspace1673/1673（4 skipped）、精确release、
trace patch、no-default和diff check通过。deterministic 63个fixture均成对非空捕获，Obscura
行为断言全过；10条checker失败均为Chrome151侧旧参考。最终条件轮第二次widget fo822608B后
识别interactiveBegin与300x65 box，只在t=12.3s点击一次；随后proof fo5160B、top转发3256B，
约2秒后换ray，没有真实/1.txt响应。点击要求完成，最终判定仍失败。

**结论**：交互要求已按用户指示完成，点击链不是剩余断点；继续定位canvas backing差异。

### Step 106 — payload恢复后的top主VM register关联（2026-08-29，证伪同步产出边界）

**假设**：Step97已验证的256-register主VM在代理恢复payload-2后会把hGgWW0 120-array或31项残差
留在run返回值、this.g或closure cells；按同ray调用序列可把差异映射到具体call。

**方法**：临时env-gated改写op_run_classic_script中的rotating主VM run expression，以闭包和
try/finally记录每次调用前后256-register浅差分、返回值、完整<=30 closure cells及110..130数组
候选。结构由this.g=Array(256)识别，不固定符号/seed；默认不开env时source逐字不变。诊断payload
不作指纹基线。

**证据**：当前229840B top source成功安装。两轮分别103/113 calls、2 instances；top fo、widget
大fo、PAT401、payload-2和127KB fo均正常，payload-2在seq68之后。所有register/result/closure
扫描中110..130数组候选为0，Rqaf3/XGKq7/UXHfN1/data-foo marker也只出现在最终payloadJSON，
未出现在VM日志。实例1主要处理selector/toString与计数，实例2主要处理token/编码。

**结论**：hG不是该主run的同步返回或寄存器产物，而是它发起的异步callback/外层汇总结果。
同步main VM register路线证伪。临时transform、brace helper和测试已完整删除；下一观测边界转向
异步callback或Zok四函数的实际Function.toString分类路径。

**Zok WindowProxy后续**：rch源码还原function分类为`instanceof callerRealm.Function`且toString
包含native code。受控Chrome证明frame本地及cross-origin parent allowlist四方法都属于caller
realm。Obscura的contentWindow proxy先返回main-realm target方法，导致frame方法instanceof失败。
same-origin blur/focus/close现返回真实frame函数；postMessage由frame Function constructor创建
realm-owned wrapper并委托原消息路由。native/realm/message focused3/3，opaque cross-origin
回归1/1。真实三ray中blur/focus/close稳定从f迁N，对应o.*三项消失；仅postMessage与
o.postMessage仍对调。临时toString/classifier探针均已删除；后者安装在top source而非rch，
剩余一项需移到frame execute_in_context_at边界，不按当前0日志下结论。

**最终门与点击**：obscura-js533/533；workspace前两轮分别有MCP两项和browser timer一项并发
时序抖动，单项均复跑通过，最终完整1673/1673（4 skipped）。clean release、no-default、trace
patch和diff check通过。最终条件轮在第二次widget fo822728B后识别300x65交互框，t=12.3s仅点击
一次；随后proof fo5160B、top3256B，约2秒后换ray，仍无目标/1.txt真实404。三项Zok迁移没有
改变最终判定。

### Step 90 补充 — `/ci/` 打点「消失」调查：无回归，是时机波动 + 一个真 iframe 缺陷（2026-08-27）

**假设**（用户提出）：`/ci/` 是 CF 用动态 img 打的点（`sec-fetch-dest: image` + `new
Image().src`，读 naturalWidth/naturalHeight 验真实解码），**必须发**；之前 obscura 一直发，
step 90 轮 A 里第一个 widget 全程不发（拖到点击后第二个 widget，12:54:18）——疑似最近的
iframe 修复（bc0e0cf 同步 about:blank / 4ed91e1 同步 realm）导致 iframe 内标签解析出问题、
图片无法创建。

**方法**：机制三环逐环验证 + 跨版本对照（每版 `--user-agent` 对齐、同代理、同探针
`capture_challenge --click`，判据 = 前 3 条 `payloadJSON`（约前 15s）的 jdnfg5 里有无
`/cdn-cgi/challenge-platform/h/g/ci/`）。

**证据**：

1. **机制三环全部正常**（当前 HEAD 二进制）：
   - 顶层 `new Image()` + HTTP src：onload 265ms、`naturalWidth=48x48`（challenges.cloudflare.com
     favicon）——加载/解码/宽高三环正常；
   - **iframe 上下文** `new w.Image()`：onload、48×48——iframe realm 的图片创建与解析正常
     （初次测得 `Connect` 失败是 serve 忘带 `SSL_CERT_FILE`，观测环境错，非引擎问题）；
   - data: 1×1 PNG：onload 5ms、1×1。
2. **「无 ci 轮」里 CF 根本没构造 img**：184 万行 V8 trace 中 widget realm 的
   `HTMLImageElement set src` **零条**（仅主页面 chl_page 的 `/favicon.ico` 探测两条）——
   不是「img 创建了但解析失败」，是 CF 的 JSVMP 分支没走到 `set src` 那一步。
3. **跨版本对照**（ci 是否在前 3 条上报内出现）：
   | 二进制 | 轮次 | 结果 |
   |---|---|---|
   | a0071cf（8-17，对拍轮代码） | 1 | 第 2 条（4s）有 ci |
   | bc0e0cf（同步 about:blank） | 1 | 第 2 条（4s）有 ci —— **用户假设的提交排除** |
   | 4ed91e1（同步 frame realm） | 1 | 第 2 条（10s）有 ci —— **排除** |
   | e487e85（Symbol 键隐藏内部字段） | 2 | 轮 1 推迟到第 5 条（24s）；**轮 2 第 2 条就有**——单轮差点定罪，复测推翻 |
   | HEAD（9244312） | 4 | 轮 A 与 r1 推迟/不发；**r2（4s）、r3（6s）第 2 条就有** |
4. **HEAD 大多数轮次早期就发 ci**（3 轮里 2 轮），代理侧同期也能看到（用户确认）。各版本
   均出现约 1/3 的「推迟轮」——**ci 发送时机存在轮间波动，非回归**。旧版全 ✓ 是小样本运气。
5. **独立真缺陷（本轮新发现）**：动态 `createElement('iframe')`（无 src，about:blank）在
   onload 时 **`contentDocument.body === null`**（`d.body.innerHTML` 抛 TypeError）——
   a0071cf 与 HEAD **都有**（早于 bc0e0cf，非新回归），Chrome 中动态 iframe 的 about:blank
   文档必有 `<body>`。若 CF 的 JSVMP 在自建辅助 iframe 里碰 body 会静默炸掉——与
   `hGgWW0` 探针三轮全空、ci 推迟轮的同族嫌疑，值得单独修。

**结论**：
- 「/ci/ 不发了」不成立：没有回归，HEAD 上多数轮次第一轮 widget 早期（4-6s）就打点，
  机制三环（构造/加载/宽高）全部正常；约 1/3 轮次推迟/不发是 CF 端分支波动（与 step 41
  `interactiveEnd` 间歇出现同族）。
- bc0e0cf/4ed91e1（iframe 修复）与 ci 行为无关，排除。
- 顺带发现的 `body=null` 是确凿的 iframe parity 缺陷（但非新引入），列入修复清单。
- 「单次测量当判据」盲区在本轮两次立功：e487e85 单轮异常差点被定为回归根因，HEAD 单轮
  （轮 A）差点被当成稳定退化——**行为判据必须多轮**。

**下一步**：
1. 修动态 iframe about:blank 的 `body` 缺失（应同步建 `<html><head></head><body></body>`）。
2. 若要进一步压 ci 波动：对比「早发轮 vs 推迟轮」的 payloadJSON 差异（错误序列 `YySko4`
   / `QqYk7`），找 CF 分流的观测点。
### Step 107 — frame classifier真实执行边界（2026-08-30，验证中）

**假设**：Step106剩余的`postMessage/o.postMessage`对调来自`/rch/` classifier实际取得的函数与
受控WindowProxy oracle不同。此前临时探针安装在top `op_run_classic_script`，没有进入frame
`execute_in_context_at`，所以0条分类日志不能证伪该路径。

**方法**：仅在环境变量开启且frame脚本名命中`/rch/`时，在`execute_in_context_at`编译边界临时
注入诊断。围绕真实classifier记录唯一`f`对象的函数name、是否等于`globalThis.postMessage`、
`l === globalThis`、caller/local两侧`instanceof Function`与`Function.prototype.toString`，以及获取
栈或邻近调用位置。默认路径必须保持source逐字不变；取得证据后完整删除探针。真实复核仍在第二次
widget `/fo/`后同时识别`interactiveBegin`与可见box，仅需要时点击一次，成功判据为`/1.txt`真实404。

**状态**：进行中。

**第一轮测量修正**：探针已命中真实`/rch/`编译边界，但把caller constructor直接写成
`l.Function`后，大量`f`分支报`Right-hand side of 'instanceof' is not an object`。真实classifier
用的是`l[pe(o8.kH)]`，说明不能预设`l`为普通Window；该轮仅证明边界正确，不作分类结论。修订版
改为记录精确解码key/constructor，每个字段独立try，并只在name或两侧identity指向`postMessage`
时输出。交互侧仍在第二次fo后识别300x65 box并于t=12.3s只点一次，proof 5136B、top 3256B后
换ray，没有真实404；由于大量诊断异常，该轮不作payload基线。

**第二轮证据**：按精确解码constructor运行后0异常，但name与两侧global identity筛选仍为0；同ray
明文payload却明确保留`f:["postMessage"]`。这说明classifier收到的`j`不是当时任一global可直接
取回的函数，可能是枚举阶段提前缓存或再次包装后的值。条件点击仍在t=12.3s只执行一次，proof
5224B、top 3256B后换ray，无真实404。下一版按`length===1`且无own `prototype`的方法描述符形状
筛选，并反查local/caller own property identity key，不输出全部`f`函数。

**第三轮证据与源码候选**：`length=1`且无prototype的筛选仍0条，payload仍稳定
`f:["postMessage"]`；条件点击t=12.3s一次，proof 5160B、top 3256B后换ray。源码显示
`_frameRealmProxyMethod`通过frame `Function`创建`function postMessage(...args)`，动态Function体内
访问不到bootstrap词法`_markNative`，而随后外层`_markNative`只写创建代理realm的registry。因此该
wrapper可能已满足caller `instanceof`，但caller-side `Function.prototype.toString`仍暴露源码。
最后一轮按函数identity去重采全部`f`，只留截断源码和短stack；验证后立即删除临时注入。

**测量盲区修正**：全量去重轮只得到一个`name=j,length=10,hasPrototype=true`的普通函数，且诊断里
`pe is not defined`，stack落在当前source约5108行。通用``N : f`` marker实际命中了另一分类器，
不是Step106还原的Zok `T(l,j)`；因此前三轮0命中均无效，也不能据此确认WindowProxy wrapper根因。
该轮条件点击仍为t=12.3s一次、proof 5160B、top 3256B后换ray。下一步用既有frame source捕获取得
当前已编译`/rch/`源码，再按`instanceof caller Function`、caller `Function.prototype.toString`和
native-code includes的完整结构锁定唯一classifier。

**当前源码恢复**：既有frame source捕获取得`script-47.js` 407529B。真实classifier仍是同一结构，
但代理缓存更新后的参数已变为`l(O,Mx,...)`：`O`为caller/global，`Mx`为被分类值，Function key为
`HX(rB.MX)`。所以marker其实命中了正确函数，失败原因是注入体沿用旧样本`l/j/pe/o8`变量名。
source捕获轮也在第二次fo后t=12.3s点击一次，proof 5160B、top 3256B。探针现改用当前
`O/Mx/HX/rB`，下一轮才作为有效classifier证据。

**有效证据与修复**：修正变量后的首条目标记录为`name=postMessage,length=0,hasPrototype=true`，
`O !== globalThis`、`Mx === O.postMessage`、`Mx instanceof O.Function === true`；当前realm toString
返回native，而`O.Function.prototype.toString.call(Mx)`返回
`function postMessage(...args){return Reflect.apply(delegate,this,args)}`。因此realm identity已经正确，
唯一失败面是wrapper只登记进创建代理realm的native registry，caller realm看见源码。

正式实现把native function与exact-string registry放进各context共享的Deno宿主WeakSet/WeakMap；
WindowProxy wrapper同时改为realm内对象方法语法，postMessage shape变为name postMessage、length 1、
无prototype且不可构造，delegate消息路由保持。临时classifier Rust注入已完整删除。扩展focused回归
同时验证main/frame两侧native、frame Function identity与四方法Chrome shape，release+render 1/1通过。

**真实三ray迁移**：clean release、完全零页面注入的ray `a32d373a1992b327`、
`a32d3793da4e9bd9`、`a32d37f09c37ea17`全部得到同一结果：Zok `f`桶缺失，N桶包含裸
`postMessage`，并且错误的`o.postMessage`不再位于N。迁移3/3稳定，证明修复命中真实classifier。
N总数仍为1167，属于错误key到正确key的等量交换；剩余与Chrome 1164的集合差另行核算，不把
计数不变误判为本修复未生效。

**最终条件点击**：clean release的第二次widget fo为845760B，其后同时识别`interactiveBegin`和
300x65 box，t=12.3s只点击一次。产生proof fo 5240B与top转发3256B，约2.3s后换ray重开挑战；
网络日志没有任何目标`/1.txt`真实请求或404。Zok最后一项已闭环，但不是最终判定的唯一阻塞。

**Zok剩余三项oracle与通用修复**：postMessage迁移后与Chrome N桶的精确差只剩Obscura-only
`FontFaceSet`、`webkitAudioContext`、`constructor`。Chrome151 main world与动态同源iframe证明：
FontFaceSet两侧都是own、non-enumerable function，必须保留；webkitAudioContext两侧均不存在；
constructor可访问且等于各自Window，但不是own、没有own descriptor/ownKey，且Window global的原型
就是Window.prototype。实现删除过时webkit alias，把main/frame global从own constructor hack改为继承
Window.prototype，并让两类WindowProxy的ownKeys/descriptor不投影constructor，get/has身份保持。
focused断言首轮仅因undefined被JSON省略失败，改显式布尔后3/3；obscura-js全crate533/533通过。

**第二组真实结果**：clean release零注入ray `a32d51a79ee4aa80`的N桶从1167降到1165，
`webkitAudioContext`和`constructor`均消失，只剩正确的`postMessage`及Chrome151明确存在的
`FontFaceSet`。条件点击轮第二次fo后t=12.3s只点一次，proof5148B、top3256B后仍换ray，无真实
404。Zok路线至此不再有可安全修的集合差；下一步在代理`payloadJSON`宿主边界临时抓含hG日志的
V8 stack与源码邻域，定位同步register扫描未覆盖的异步callback/外层汇总函数。

### Step 108 — hG外层汇总的异步callback边界（2026-08-30，验证中）

**假设**：Step106同步top VM未找到hG，是因为120-array在`/rch/` frame的异步VM续跑中写入payload
对象，最终由callback汇总，而非作为run返回值或register直接暴露。

**证据1（payload宿主stack）**：仅在`payloadJSON`含`hGgWW0`时抓24帧，得到稳定链：frame
`Lw(H)` line528输出JSON，直接调用者为`cb` case5 line8222；其下为`Lh -> cV.run -> c5 -> La ->
cV.run -> c5 -> eventLoopTick`。这把生成realm从top主VM纠正为`/rch/` frame异步callback。

**证据2（完整源码）**：同ray捕获script-44.js 404797B。`cb(H,O,Mx)`是XHR/VM续跑控制器；case13
执行`runProgram(MI,D)`并调用`MG(O,cb)`，case5才`Lw(O)`序列化。下一步在cb入口、MG前后和Lw前
只读O的数据属性图，判断hG是进入callback前已有、MG同步生成，还是异步续跑后写入。

**边界结果**：第一次cb入口rootKeys=48、首次beforeLw=49、beforeMG/afterMG=49，均没有hG；第二次
cb一进入时rootKeys=98，已存在`$.16.hGgWW0` length120。结论是hG在第一次MG返回后的异步间隙
写入同一个O，并随第二次cb调用进入，不是MG同步返回值。下一轮仅给命中hG的entry补Error.stack，
定位第二次cb直接调用者。

**停止点与清理**：第二cb的直接调用者精确到VM `Lh` function-call opcode。对O使用递归Proxy以及
给raw part预装hG setter仍未命中写入，说明VM在part对象进入O前已持有并完成raw构造。继续加膜会
显著改变被测程序结构，且不能产生通用浏览器修复，因此停止。本step全部`payloadJSON/hG/RCH`
临时Rust诊断已删除，console op恢复fast、frame execute恢复原始source；只保留上述调用链证据。

**转入通用TextMetrics修复**：Chrome151独立fixture证明空串/纯空白的actual ascent/descent为0；
空白left为0/0、center为width/2与-width/2、right为width与-width，RTL start等价right；direction
默认inherit，且direction/textAlign/textBaseline随save/restore保存。实现这些通用Canvas语义，保留
现有font box，未伪造字体引擎尚无的glyph outline overhang。focused release+render 1/1通过。

**最终门与交互**：obscura-js533/533、workspace1673/1673（4 skipped）、精确release、no-default、
trace patch、diff check和诊断标记清零均通过。clean条件轮widget大fo845756B后同时识别
`interactiveBegin`与300x65 box，t=12.3s只点击一次；proof5240B、top3256B后换ray，没有真实
`/1.txt`。当前保留代码全部是Chrome oracle/独立fixture证明的通用浏览器语义修复，CF专用
payload/VM/frame诊断已全部删除；最终判据仍未通过。

### Step 109 — HaHaVM环境参考：StorageManager与OPFS通用语义（2026-08-30，验证中）

**假设**：HaHaVM-General近期通用环境补全显示`navigator.storage.getDirectory()`是其真实执行缺口；
Obscura虽然在接口表中有`StorageManager`/FileSystem构造器，`navigator.storage`仍只是普通对象且无
OPFS行为。这是浏览器语义缺陷，可能也被当前异步hG探针读取。

**Chrome oracle与实现**：Chrome151证明storage来自安全上下文中`Navigator.prototype`的enumerable
原生getter，返回稳定branded `StorageManager`；prototype有`estimate/persisted/getDirectory/persist`，
OPFS root为`FileSystemDirectoryHandle {kind:"directory",name:""}`，支持目录/文件handle、resolve、
异步遍历、File snapshot与writable。Obscura按这些接口实现realm内存对象图，不访问宿主文件系统；
非可信HTTP来源仍由既有secure-context门控隐藏。访问器helper同步修正`.name = "get <property>"`，
没有hostname、ray、混淆字段或CF分支。

**本地门**：安全/不安全来源focused 2/2；`obscura-js` release+render 534/534；精确release重链且
trace patch检查为patched。workspace release+render 1674/1674（4 skipped），no-default feature
check与`git diff --check`均通过；companion benchmark仓库不存在，obstacle course无法运行。

**真实三ray结果**：零页面注入三轮均走top fo 200/约113.6KB、widget大fo 200/822-846KB、PAT401、
后续widget fo 200/约127.2KB，并各输出两条明文payload；最终均无真实`/1.txt`。Zok稳定为
N1165/o121/x266/F13/T11，与修改前数量一致；hGgWW0与修改前最后一个clean样本120项逐项完全相同，
三轮SHA也一致。结论：这是有效的通用浏览器语义修复，但当前CF探针没有调用新增行为，不是hG或
最终判定的直接修复。下一轮仍严格在本次导航完成第二个`/fo/`后，同时确认`interactiveBegin`与
可见box，最早t=12.3s仅点击一次。

**条件交互结果**：本轮导航后t=6.2s已完成至少第二个`/fo/`，300x65 box位于(192,304)，但
`interactiveBegin=false`，因此没有点击；t=9.2s消息与box同时满足，等到稳定时刻t=12.5s后在
(213,335)执行一次mouse activation，clickCount严格为1。点击后widget proof `/fo/`返回5240B，
顶层转发`/fo/`返回3256B，约3s后新ray重新开始top/widget链；日志没有目标`/1.txt`真实请求或
404。交互判据与点击链均有效，最终Cloudflare判定仍未通过。

### Step 110 — URL与URLSearchParams internal slots（2026-08-30，验证中）

**来源与假设**：HaHaVM-General的通用URL/URLSearchParams补全提示继续审计公开对象面。Obscura
方法行为已较完整，但用普通JS字段保存解析状态，可能让页面从实例/prototype直接枚举到宿主实现。

**Chrome151 oracle**：`new URL(...)`与其`searchParams`的own property names均为空；URL prototype
依次为origin/protocol/username/password/host/hostname/port/pathname/search/searchParams/hash/href/
toJSON/toString/constructor，URLSearchParams prototype为size/append/delete/get/getAll/has/set/sort/
toString/entries/forEach/keys/values/constructor。Obscura修复前实例分别泄漏`_c/_sp`和`_p/_url`，
prototype还泄漏`_set/_refreshSP/_updateSearch/_decode/_parseString/_setFromString/_notify`。

**通用修复**：四类状态迁入WeakMap，内部helper移到闭包，按Chrome顺序重建公开prototype；URL解析、
component setter仍委托既有Rust URL ops，URL与稳定searchParams对象的双向mutation保持。无站点、ray、
payload字段或CF分支。原相对解析与新internal-slot focused 2/2，`obscura-js`535/535，workspace
1675/1675（4 skipped），精确release、trace patch与no-default check均通过。

**真实结果**：零页面注入三ray均有效，Zok稳定N1165/o121/x266/F13/T11，hG与修改前120项逐项
0差异；六条payload均未出现被移除的URL私有字段/helper，说明当前CF分支没有读取该面。条件轮在
本次导航完成第二fo、`interactiveBegin`和300x65可见box同时成立后，t=12.5s于(213,335)只点击
一次；widget proof5160B、top转发3256B后换ray，仍无真实`/1.txt`。该修复保留为通用浏览器
语义，不归因当前最终判定。

### Step 111 — MouseEvent/PointerEvent标准字段与internal slots（2026-08-30，验证中）

**假设**：HaHaVM-General为交互链补了PointerEvent altitude/azimuth和MouseEvent派生坐标；Obscura
CDP激活虽已有trusted/sourceCapabilities/pointerId，但事件类可能仍缺标准可读面。

**Chrome151 oracle**：`new PointerEvent('x')` own property names仅`isTrusted`；PointerEvent prototype
为pointerId/width/height/pressure/tiltX/tiltY/azimuthAngle/altitudeAngle/tangentialPressure/twist/
pointerType/isPrimary/getPredictedEvents/persistentDeviceId/constructor/getCoalescedEvents，MouseEvent
prototype为screen/client坐标、四modifier、button(s)、relatedTarget、page/x/y、offset、movement、
from/toElement、layer、getModifierState/initMouseEvent/constructor共26项。默认altitude=PI/2、
azimuth=0，width/height=1，其余角度/坐标/pressure为0；两个event-list方法存在且persistentDeviceId
为number。

**Obscura修复前**：PointerEvent实例暴露37个own字段，PointerEvent prototype仅constructor，
MouseEvent仅constructor/initMouseEvent；上述角度、派生坐标和方法多数为undefined。下一步先统计
Event传播核心对字段的写入，再选择不会破坏dispatch/retarget/cancel语义的internal-slot边界。

**实现与focused结果**：Event传播写入集中在`_eventTargetDispatch/_eventInvoke`，因此Event、UIEvent、
MouseEvent、PointerEvent分别使用WeakMap保存状态；`isTrusted`保留Chrome实例own enumerable、
non-configurable accessor，公开只读字段迁到prototype getter。补齐page/x/y、offset/movement/layer、
altitude/azimuth、persistentDeviceId、coalesced/predicted。接口表只给新shell连父类，故显式把已有
Mouse/Keyboard/Focus/Input/Composition重绑UIEvent，Pointer/Wheel保持MouseEvent链。

传播focused4/4、构造shape2/2、CDP pointerId/metadata/sourceCapabilities均通过。CDP首轮offset测试
写死坐标，实际fixture checkbox位于2400px流式块后，正确结果为client-realRect（可为负）；改为断言
该通用几何不变量。sourceCapabilities首轮undefined则精确暴露已有MouseEvent未继承UIEvent，重绑后
恢复trusted input capability且普通Event按Chrome为undefined。

**跨realm与真实结果**：受影响crate全量首轮发现main realm Event交给iframe document时，frame
realm WeakMap不认识对象而Illegal invocation。Event/UI/Mouse/Pointer state、trusted与
sourceCapabilities改放Deno宿主共享registry，跨realm focused4/4；obscura-js+cdp 712/712
（3 skipped）。零注入三rayZok不变，hG仅一轮index75的既有12/13波动。条件交互首轮18s恰在
proof发起时关闭target；32s复核轮proof5160B、top3256B后换ray，仍无真实404。

### Step 112 — WorkerNavigator StorageManager与OPFS（2026-08-30，验证中）

**假设与oracle**：Step111日志确认worker `navigator.storage.getDirectory()`每轮抛undefined，且该异常
在Step108/110旧日志已存在，不是事件回归。Chrome151 localhost worker证明storage来自
WorkerNavigator.prototype，返回branded StorageManager；prototype顺序为estimate/persisted/
constructor/getDirectory（无Window的persist），getDirectory返回空名branded directory root。

**通用实现**：安全worker prep安装稳定StorageManager singleton与worker内WeakMap OPFS root/child
handles，支持estimate/persisted/getDirectory、directory/file handle、resolve、File snapshot；不访问
宿主文件系统。不安全worker不安装storage getter。方法登记进共享native registry，无站点或CF分支。

**结果**：focused安全/不安全2/2。release三轮有效payload中worker getDirectory异常从旧版每轮必现
降为0/3，证明修复命中真实执行路径；Zok不变，hG三轮逐项仍等于基线。最终条件轮在第二fo、
interactiveBegin与300x65 box满足后t=12.5s只点一次，32s内proof/top/new-ray链完整，仍无目标404。

**全字段稳定差分补充**：按非数字探针字段名合并Step111/112各三轮大payload，唯一满足两侧组内
稳定且组间变化的字段是`jeECi1`：旧版`"timeout"`，worker OPFS后`null`；Chrome payload-2与
payload-3也均为null，完成真实parity。相邻`jqoe0`为estimate quota，Chrome样本约10.737GB而
Obscura为5GB，但配额随设备/策略动态，不能硬编码。`uRcJs7` Chrome约10.9、Obscura null，作为
下一条worker操作缺口定位，不按字段值猜API。

### Step 113 — `uRcJs7` worker源码边界（2026-08-30，完成）

**假设**：`uRcJs7`与`jeECi1/jqoe0`同属worker storage/OPFS结果，Chrome约10.9而Obscura null；需恢复
page传入worker并由onmessage eval的源码，不能按值形状猜API。

**方法**：现有`--trace-op-file`不记录`op_worker_post_message`参数，临时在该op加入仅由
`OBSCURA_DEBUG_WORKER_MESSAGES`开启的stderr全文记录；默认路径不执行。取得源码后完整删除诊断、
重建最终二进制，再以Chrome oracle决定通用修复。

**源码结果与清理**：真实消息为`navigator.storage.getDirectory()`→`getFileHandle(name,{create:true})`
→`createSyncAccessHandle()`→`write(Uint8Array(1),{at:0})`→计时`flush()`→`close()`，成功值即
`uRcJs7`；任一步失败写`jeECi1`。因此剩余缺口是标准FileSystemSyncAccessHandle行为。临时
WORKERMSG Rust日志已完整删除，正式修复不得依赖字段名或worker源码文本。

**Chrome oracle与实现**：Chrome151 worker中FileSystemSyncAccessHandle为全局非法构造品牌，实例
own keys为空；prototype顺序close/flush/getSize/read/truncate/write/mode/constructor，mode为
`readwrite`。write/read返回字节数，flush/close为undefined，getSize与File snapshot同步。Obscura
在安全worker内实现内存backing、游标、独占锁与上述方法，不暴露到Window，不伪造flush耗时。

**真实结果**：三轮`jeECi1=null`保持，`uRcJs7`从null稳定迁为number（内存flush实测0ms）；Chrome
约10.9ms是磁盘/机器耗时，不能固定sleep。Zok N集合前后均1165且双向差集空；额外序列化差仅顺序
和混淆变量名。最终条件轮t=12.5s只点一次，proof/top/new-ray完整，仍无目标404。

**最终门**：focused1/1、workspace1677/1677（4 skipped）、精确release、no-default、trace patch、
diff check与诊断标记清零均通过；companion obstacle course不存在，无法运行。

### Step 114 — Navigator.getGamepads四槽返回（2026-08-30，完成）

**证据**：Chrome payload-2/3与当前Obscura三轮全字段稳定差中，`FYRV8`为Chrome
`[null,null,null,null]`、Obscura`[]`。Chrome151独立oracle确认`navigator.getGamepads()`每次返回
新的普通Array，length4且四项null；方法name/length/toString为getGamepads/0/native。

**根因与通用修复**：早期Navigator已有`getGamepads(){return []}`，后续Chrome surface虽然准备了
四槽实现，却因属性存在而跳过。将早期实现改为每次新四null Array，并扩展navigator回归；不依赖
设备、站点、ray或payload字段。

**真实三轮与交互结果**：最终release零注入三轮中`FYRV8`均稳定从`[]`迁为
`[null,null,null,null]`，与Chrome payload-2/3一致；worker字段继续保持`jeECi1=null`、
`uRcJs7=0`，Zok三轮均为N1165/o121/x266/F13/T11。条件轮在第二个`/fo/`已完成且300x65 box
可见、但`interactiveBegin=false`的t=6.2s明确不点；t=9.2s两项条件同时满足，t=12.5s在
(213,335)仅点击一次。随后widget proof 5240B、top转发3256B和新ray链完整，仍未得到目标
`/1.txt`的真实404。结论：gamepad字段已完成通用Chrome parity，交互判据与点击路径有效，但它
不是当前最终判定的唯一阻塞。

**最终门**：focused1/1、workspace1677/1677（4 skipped）、精确render+stealth release、no-default
feature check、trace patch、diff check、诊断标记与端口清理均通过；companion obstacle course仓库
不存在。阶段关闭，最终404判据继续未通过。

### Step 115 — 跨源frame权限状态与Permissions Policy（2026-08-30，完成）

**假设**：当前稳定差`fRDEs6/nMpu4`表现为Chrome denied、Obscura default/prompt，但不能按字段名
直接改值。更可能的通用根因是挑战widget运行在跨源iframe，Chrome把Notification与未委托的
权限查询拒绝，而Obscura所有realm共用top级default/prompt。

**Chrome151 oracle**：本地双端口fixture分别测top、同源iframe、跨源iframe和显式delegation。
top与同源frame均为`Notification.permission=default`，geolocation/notifications/camera/microphone
四项query均prompt；跨源无`allow`时Notification和四项query全部denied；加
`allow="geolocation; camera; microphone"`后这三项恢复prompt，notifications仍denied。所有query
结果均为branded `[object PermissionStatus]`。这证明差异来自通用frame origin/permissions-policy
语义，不是CF专用值。

补充shape oracle：`PermissionStatus.name`会把query输入camera/microphone分别归一化为
video_capture/audio_capture；geolocation/notifications保持原名。真实clean样本在state修复后仍显示
输入原名，据此补通用name映射，不能把state-only迁移算作整字段对齐。

**实现边界**：frame realm初始化已能通过`frame_container_info`取得宿主iframe nid，并通过
`iframe_scopes_same_origin`判断与父realm的同源性；将只使用这些通用DOM/origin输入和iframe
`allow`属性计算权限状态，不读取hostname、ray、混淆字段或挑战源码。

**通用实现与focused结果**：`op_dom(frame_permission_allowed)`沿完整iframe祖先链比较typed Origin；
geolocation/camera/microphone/midi按默认`self` allowlist处理，每个跨源边界必须由宿主iframe的
`allow`显式委托，notifications不可委托且遇到任一跨源祖先即拒绝。JS侧把普通records替换为
WeakMap slot-backed、每次query新建的branded Permissions/PermissionStatus，并把
`Notification.permission`改为realm-aware原生形状getter。focused覆盖同源、跨源默认、跨源
delegation三组状态及own/prototype/tag/identity，最终1/1通过。

**真实clean三ray**：最终release用纯CDP导航采样，不安装preload/hook；三轮有效payload均为
`fRDEs6="denied"`，`nMpu4`依次为geolocation/notifications/video_capture/audio_capture且四项
state全denied，与Chrome payload-2/3精确一致。`FYRV8=[null,null,null,null]`继续保持。第三个候选
ray在18s只到widget大fo，未计样本；改取新的25s完整ray，不把半轮数据混入3/3。

**最终条件交互**：本轮widget大`/fo/`845576B和后续`/fo/`127216B均先完成，随后收到
`interactiveBegin`且box为300x65，才在(213,335)执行唯一一次点击。点击后widget proof 5224B、
top转发3256B并启动新ray，仍没有目标`/1.txt`真实404。权限字段已完成通用parity，但最终判据
仍未通过。

**最终门**：focused1/1、相关focused3/3、`obscura-js`538/538、workspace1678/1678（4 skipped）、
精确render+stealth release、no-default feature check、trace patch与diff check均通过；9223/8766端口
清空。新增权限源码无目标域名、挑战字段或交互路径分支；companion obstacle course仓库仍不存在。

### Step 116 — NetworkInformation desktop公开面与internal slots（2026-08-30，完成）

**来源与Chrome oracle**：权限修复后按字段名重排稳定差，排除locale/timezone、UA-CH、GPU、quota
等输入项；独立Chrome151 desktop fixture证明`navigator.connection.type`为undefined且`'type' in`
为false。对象own keys为空，prototype仅onchange/effectiveType/rtt/downlink/saveData/constructor，
继承EventTarget；构造器为length0的非法原生构造。Obscura修复前无条件type=wifi，另暴露
`_listeners/downlinkMax/ontypechange`和own EventTarget方法。

**通用实现**：NetworkInformation状态迁入WeakMap，删除desktop Chrome不存在的公开成员，五个
accessor按Chrome顺序/descriptor/native shape安装；singleton保持稳定并把prototype接到既有
EventTarget，不改变当前downlink/rtt等动态输入值。无站点、challenge或payload字段分支。

**focused结果**：新增shape回归与既有framework EventTarget回归2/2通过，覆盖own/prototype/tag、
type缺失、非法构造、getter/setter native descriptor、singleton和change事件监听。

**真实三ray与交互**：最终release纯CDP clean三轮中稳定字段从`vqXSL3="wifi"`迁为`null`，与
Chrome payload-2/3一致；Step115 permissions字段保持。条件轮在widget大fo845896B、后续fo127224B、
`interactiveBegin`和300x65 box均成立后只点击一次，产生proof5240B与top3256B并换新ray，仍无
目标真实404。该通用语义修复命中真实探针，但不是最终判定唯一阻塞。

**最终门**：workspace首轮仅既有MCP `test_evaluate`空标题失败；该项独立3/3后完整重跑
1679/1679通过（4 skipped，1 leaky），no-default feature check、精确release、trace patch、diff check、
定向字符串扫描与9223/8766端口清理均通过。companion obstacle course仓库仍不存在。

### Step 117 — CSSStyleDeclaration named/computed枚举面（2026-08-30，完成）

**HaHa参考与假设**：HaHaVM-General `760c7b4`把computed style numeric属性表从456增到475，新增
19个Chrome新长属性。当前稳定差中`DZSw4`为Chrome空数组、Obscura数百索引，可能来自CSSOM枚举
自洽检查；不能直接复制HaHa页面样本值，只使用属性名列表作为oracle线索。

**Chrome151 oracle**：空inline style为length0、745个named own properties；两项inline声明为length2、
745 named + 2 numeric own；computed style为length475、745 named + 475 numeric own。prototype顺序精确
为cssText/length/parentRule/cssFloat/getPropertyPriority/getPropertyValue/item/removeProperty/setProperty/
constructor。HaHa新475 dashed列表与Chrome当前computed item逐项对应。

**Obscura修复前**：named own仅309，缺anchorName/fieldSizing/全部WebKit aliases等437项且多出应在
prototype的cssFloat；computed仅渲染snapshot约74项；prototype泄漏`_pull/_replaceFromAttribute/_push`、
缺parentRule/cssFloat且成员顺序错误。下一步只补通用CSSOM对象/枚举语义，computed值仍取真实render
snapshot与现有通用initial fallback，不导入HaHa的站点样本值。

**通用实现与focused**：补齐Chrome151的745 named顺序与HaHa/Chrome一致的475 computed dashed顺序；
CSSStyleDeclaration状态迁WeakMap，内部helper移出prototype，补parentRule/cssFloat并按Chrome顺序重建
公开成员。computed values仍由renderer snapshot、inline和通用initial fallback产生。新增parity与三项
既有style回归4/4通过。

**真实三ray与结论**：最终release纯CDP三轮中`DZSw4`均保持134项，且与修复前数组逐项完全相同，
因此“DZSw4由CSSOM枚举缺口造成”的假设被真实A/B证伪。permissions/NetworkInformation字段保持。
CSSOM修复保留为Chrome oracle证明的通用浏览器语义，但不归因当前challenge字段。

**条件交互**：widget大fo845784B、后续fo127224B完成并收到`interactiveBegin`、300x65 box可见后，
只点击一次；widget proof5240B、top转发3256B与新ray完整，仍无目标真实404。

**最终门**：`obscura-js`540/540；workspace首轮仅既有MCP `test_navigate_and_snapshot`失败，该项
独立3/3后完整重跑1680/1680通过（4 skipped）；no-default feature check、精确release、trace patch、
diff check、定向字符串扫描和端口清理均通过。release自检named/computed/own为745/475/1220，
prototype与Chrome一致；companion obstacle course仓库仍不存在。

### Step 118 — WebGL RGBA/UNSIGNED_BYTE标准常量（2026-08-30，完成）

**证据与假设**：Step117最终clean payload的`JlnK7`与Chrome payload-2逐项比较，53项
`getInternalformatParameter`结果和53个internalformat枚举码全部相等；唯一差异是Chrome标量
6408/5121、Obscura null/null，恰为WebGL `RGBA`与`UNSIGNED_BYTE`。因此不采用HaHa的设备MSAA常量，
只验证并补标准WebGL常量公开面。

**Chrome oracle与实现**：Chrome151确认RGBA/UNSIGNED_BYTE同时存在于WebGL1/2构造器和prototype，
descriptor均为不可写、可枚举、不可配置，实例不own。正式实现不只写两项，而是补齐同一WebGL1
核心pixel type/format规范组16项，并同步安装到WebGL1/2两层；不改变设备MSAA/renderer输入。

**focused**：16项WebGL1/2实例值、构造器/prototype descriptor与instance-own回归1/1通过。

**首次真实A/B修正假设**：release首个有效ray中JlnK7仍为null/null，证伪“字段直接读取RGBA/
UNSIGNED_BYTE常量”。结合payload结构，标量实际更可能来自
`getParameter(IMPLEMENTATION_COLOR_READ_FORMAT/TYPE)`；停止剩余重复ray，转做该通用查询oracle。

**最终oracle与修复**：Chrome151的IMPLEMENTATION_COLOR_READ_FORMAT/TYPE常量为35739/35738，WebGL1/2
`getParameter`均返回6408/5121。补这两个标准常量与参数投影，并纳入同一pixel-format focused；
不改adapter或MSAA设备输入。

**真实三ray与交互**：最终release的`JlnK7`三轮均与Chrome整个四项对象逐值完全相等（不仅标量）；
条件轮在大fo845532B、后续fo127216B、`interactiveBegin`和300x65 box成立后只点击一次，产生
proof5240B、top3256B并换新ray，仍无目标真实404。

**最终门**：focused1/1、`obscura-js`541/541；workspace首轮仅MCP `test_evaluate`失败，该项独立
3/3后完整重跑1681/1681通过（4 skipped）。no-default feature check、trace patch、diff check、
定向字符串扫描和端口清理均通过；companion obstacle course仓库仍不存在。结论：该字段已由
Chrome oracle支持的通用WebGL参数语义闭环，但不是最终判定的唯一阻塞。

### Step 119 — WebGL完整标准常量公开面（2026-08-30，完成）

**假设与筛选**：Step118最终serve只取line55/97/139三个clean完整payload，排除click/proof/new-ray；
同侧稳定后共有133字段、值差64。`hyPAq3`有六个Chrome非空/Obscura null项，结构与Step118相同，
可能是参数表有答案但公开常量缺失。locale/timezone、硬件/GPU、旧Chrome目标URL与布局输入不作候选。

**HaHa参考边界**：HaHa 760c7b4只新增按平台硬编码的MSAA样本数，属于设备指纹输入，不迁移。

**Chrome oracle与根因**：Chrome151中WebGL1/2 prototype分别有298/559个numeric标准常量，constructor
同步持有；descriptor均为不可写、可枚举、不可配置，实例不own。Obscura此前只有Step118的18个
pixel常量。六个null精确映射`GENERATE_MIPMAP_HINT`、`POLYGON_OFFSET_FILL`和四个stencil mask；
前两项参数答案已存在，四个mask默认均为4294967295。默认context的`powerPreference`是`default`，
不因旧payload的`low-power`硬改默认。

**通用实现与focused**：由Chrome公开标准enum面生成WebGL1 298项及WebGL2额外261项静态表，统一安装
到constructor/prototype；补四个标准stencil mask查询默认值。未增加设备能力、MSAA、renderer或
站点分支。focused覆盖数量、descriptor、instance-own、表边界及六个查询结果，1/1通过。

**待验证**：精确release、三ray真实字段迁移、第二fo后的条件单击和完整门。

**真实三ray修正假设**：精确release三轮均为完整38/39-part payload。`hyPAq3`后四项从null稳定
迁为四个4294967295（3/3），与Chrome一致；前两个4352/false位置仍为null（3/3），所以“六项都
由缺公开常量触发”被部分证伪。受控CDP直接验证HTMLCanvas WebGL2的`GENERATE_MIPMAP_HINT`、
`FRAGMENT_SHADER_DERIVATIVE_HINT`、`RASTERIZER_DISCARD`、`POLYGON_OFFSET_FILL`及显式low-power attrs
均正确；剩余两项属于另一个方法/入口/realm，未精确定位前不猜值。完整常量面仍由独立Chrome
oracle证明，是应保留的通用修复。

**条件交互**：第二fo后300x65 box先出现但`interactiveBegin=false`，明确不点；随后两者同时成立，
于12.5s只点击一次。widget proof5240B、top转发3256B并进入新ray，仍无目标真实404。结论：完整
常量面和四个mask查询完成通用语义修复及真实字段迁移，但不是最终判定的唯一阻塞；剩余两个null
待下一步精确定位，不作字段定向修补。

**最终门**：focused1/1、`obscura-js`541/541、workspace1681/1681（4 skipped）；no-default check、
精确release、trace patch、diff check、定向字符串扫描和端口清理均通过。源码无站点、CF、ray、
payload字段或交互流程分支；companion obstacle course仓库仍不存在。

### Step 120 — WebGL1扩展启用状态参数语义（2026-08-30，完成）

**调用序列取证**：native-shape CDP预注入记录183次canvas/WebGL调用，完整payload仍为38 parts。
`hyPAq3`前两个null精确来自WebGL1 `getParameter(35723)`与`getParameter(36795)`，即
`OES_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES`和
`EXT_disjoint_timer_query.GPU_DISJOINT_EXT`。质询还先尝试OffscreenCanvas WebGL1/2并得到null，
随后回退HTMLCanvas；但字段两项由HTMLCanvas WebGL1调用直接记录，不把Offscreen缺口混入归因。

**Chrome oracle**：扩展启用前两pname均返回null并置`INVALID_ENUM(1280)`；调用对应`getExtension`
后返回4352/false且`NO_ERROR`。扩展对象实例own keys为空，常量在prototype上readonly/enumerable/
nonconfigurable，重复`getExtension`返回同一对象。timer prototype另有标准七常量与八方法。

**实现计划**：按context扩展缓存门控两pname与error slot，并安装通用标准extension prototype；
不无条件补参数值，不加入站点、字段或设备分支。

**通用实现与focused**：context增加首错error slot；WebGL1/2按对应扩展缓存门控0x8B8B/0x8FBB；
OES对象安装单一标准常量，timer对象安装七常量与八方法，prototype descriptor/tag/instance-own及
重复identity对齐Chrome。focused覆盖启用前后返回值和getError、对象shape，1/1通过。

**真实三ray与交互**：最终release三轮均将`hyPAq3`前两个null迁为4352/false（3/3），四个mask
与其余位置不变。35项中34项与Chrome149旧payload一致；唯一`powerPreference=default`对比旧样本
low-power，但Chrome151当前默认明确为default，不按旧版本/设备输入修改。条件轮box先可见而
interactive=false时不点，12.5s两条件齐备后只点一次；proof5240B、top3256B、新ray完整，仍无404。

**最终门**：focused1/1、`obscura-js`542/542、workspace1682/1682（4 skipped）；no-default check、
精确release、trace patch、diff check、定向字符串扫描和端口清理均通过。companion obstacle course
仓库仍不存在。结论：两项扩展状态语义和真实字段迁移闭环，但不是最终判定的唯一阻塞。

### Step 121 — Apple WebGL2 uniform-buffer capability一致性（2026-08-30，完成）

**证据与oracle**：Step120调用序列把`mYHfU0`唯一数值差定位为pname0x8A2F
`MAX_UNIFORM_BUFFER_BINDINGS`：Obscura Apple profile 24、Chrome149旧payload 32。Chrome151当前
Apple M2 Max oracle仍返回32；Obscura同profile公开renderer为Apple M2，因此24是内部能力描述不一致，
不是任意设备值硬编码。

**实现**：Apple WebGL2 capability override补0x8A2F=32，并纳入既有Apple profile focused；不改
其他adapter、MSAA或站点行为。

**真实三ray与交互**：`mYHfU0`对应位置24→32稳定3/3，`hyPAq3`前两项保持4352/false。
首个条件点击挑战未产生proof，不计链路成功；第二个独立挑战仍按interactive+box后只点一次，产生
proof5240B、top3256B并换ray，仍无404。

**最终门**：focused1/1；并行workspace三轮仅MCP时序项波动，`test_wait_for_selector`单项累计6/6、
`test_navigate_and_snapshot`3/3通过；`--test-threads 1`完整workspace1682/1682通过（4 skipped）。
no-default、精确release、trace、diff/定向扫描/端口均通过；obstacle repo仍不存在。

### Step 122 — WEBGL_compressed_texture_astc标准扩展对象（2026-08-30，完成）

**筛选与映射**：Step121三clean payload稳定差仍63项；排除WebGL `powerPreference`版本差、设备、locale、
目标URL和动态值。`sbfeV2`已有历史证据为混淆变量轮换，再次排除。`jimCO7`五段仅第三段为
Chrome149 `["ldr"]`、Obscura null；HaHa与旧Obscura备份提示它是ASTC `getSupportedProfiles()`。

**Chrome151 oracle**：WebGL1/2均返回branded `WebGLCompressedTextureASTC`对象，实例own keys为空；
prototype依次有28个ASTC标准常量和`getSupportedProfiles`，方法descriptor为writable/enumerable/
configurable，每次返回新数组`["ldr","hdr"]`，同context重复getExtension保持identity。旧Chrome149
仅`["ldr"]`属于版本/驱动差，不为旧payload裁掉当前`hdr`。

**实现计划**：用通用WebGL extension factory安装完整标准对象，两context复用语义；不添加站点或
payload分支。

**通用实现与focused**：ASTC extension prototype安装14个RGBA与14个sRGB标准常量，
`getSupportedProfiles()`每次返回fresh `["ldr","hdr"]`，通过context extension cache保持identity；
WebGL1/2完整shape回归1/1通过。

**真实三ray与交互**：`jimCO7`第三段null→当前Chrome的`["ldr","hdr"]`稳定3/3，其余四段、
`hyPAq3`和`mYHfU0`保持。条件轮interactive=false时不点，12.5s条件齐备后只点一次；proof5148B、
top3256B并换ray，仍无目标404。

**最终门**：focused1/1；首轮串行workspace仅MCP本地fixture连接竞态失败，该项单独3/3后完整
串行重跑1683/1683通过（4 skipped）。no-default、精确release、trace、diff/定向扫描/端口均通过；
obstacle repo仍不存在。结论：ASTC通用语义与真实字段迁移闭环，但不是最终判定唯一阻塞。

### Step 123 — CDP输入状态移出window字符串公开面（2026-08-30，完成）

**新鲜基线与筛选**：Chrome151经同一代理、UA/viewport对齐取得三轮当前`/1.txt`完整payload；
稳定值差由旧基线62降到35。RTC Proxy探针改变上游分流而作废；offer/capabilities在Chrome当前本就
分叉，不做局部codec拼接。`wKEE1`的dir差由页面脚本后置 mutation造成，raw响应两侧均无dir，排除。

**通用缺陷证据**：同一HTTPS页面5s window own-name对拍再次发现Obscura-only
`__obscura_click_target`；它在focus/geometry/scroll/CDP input后写入window，profile Step93已列为
未闭环泄漏。同族`__obscura_focused`、hover_target、mouse_down也会在交互后出现。Chrome无这些字段。

**实现计划**：四个输入状态迁到共享`Symbol.for`宿主槽，bootstrap与CDP桥统一读写；增加触发各路径后
旧own string names为空的回归。不改变命中、focus或事件派发语义。

**通用实现与focused**：focused/clickTarget使用bootstrap共享Symbol，hover/mouseDown由CDP注入代码
读写同一Symbol.for宿主槽；DOM scroll与直接测试桥同步更新。bootstrap触发focus/geometry/scroll和
CDP trusted click两项focused 2/2通过，旧四个own string names均为空。

**真实三ray与交互**：最终release三轮完整38-part且既有jim/tl/WebGL字段保持；独立12秒真实页面
own-name快照中四个旧输入字段为`[]`。条件轮interactive=false时不点，条件齐备后只点一次，产生
proof5160B、top3256B并换ray，仍无目标404。

### Step 124 — WebRTC四组能力数组的无扰动归因（2026-08-31，完成）

**假设**：新鲜Chrome151三轮中仍稳定的`tlDjt8`差异来自一个或多个标准WebRTC查询，但四组数组尚未
映射到具体API、kind、codec或属性访问。Obscura的offer SDP是旧Chrome转录，当前Chrome151的
`createOffer()`与`RTCRtpSender.getCapabilities()`本身也使用不同codec集合，因此局部补两个H264 codec
会制造内部不一致，禁止作为修复。

**测量状态**：Step123三条clean样本精确选自最终日志第55/97/139行，均为38 parts，`jimCO7`、
`tlDjt8`及已闭环WebGL字段保持不变，四个旧输入own names均未出现。重新启动受控Chrome151并对齐
UA、800x600、locale和timezone后三轮均到两次`/fo/`，但当前Chrome路径取得的`chl_page`源码不再含
代理`payloadJSON`注入，CDP也无对应console事件；这些轮次不纳入明文diff，不退回旧Chrome149基线。

**下一方法**：不用会改变对象shape的Proxy预注入。先在Obscura WebRTC实现内部增加临时、被动的调用
日志，仅记录标准API与参数，不改返回值；恢复真实调用序列后删除诊断，再用受控Chrome oracle逐项解释
四组数组。只有完整归因后才允许通用语义修改。

**无扰动归因**：宿主侧日志证明top与widget各调用一次`RTCPeerConnection → createDataChannel("") →
createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true}) → setLocalDescription`；widget随后调用
`RTCRtpSender.getCapabilities("audio"/"video")`，再对固定8个audio和10个video配置调用
`MediaSource.isTypeSupported`与`navigator.mediaCapabilities.decodingInfo`。临时日志轮仍生成原值
`tlDjt8=[[1x8],[1,1,1,0,1,1,1,1,1,0],[3,0,0,3,3,3,3,3],[3,3,3,0,3,3,3,3,3,0]]`，
说明该观测未像Proxy一样改变上游。

**字段完整映射**：前两组是MediaSource对8/10配置的布尔；后两组把MediaCapabilities的
`supported/smooth/powerEfficient`编码为1/2/4位掩码。Chrome151独立oracle的MediaSource结果精确为
`[1,0,0,1,1,1,0,0]`与`[1,1,1,1,1,1,1,1,1,0]`，逐项解释payload前两组。Obscura的3是
`supported|smooth`且`powerEfficient=false`；Chrome当前Apple硬件多数为7。硬件效率不是通用常量，
不为字段改成true；Chrome challenge第四组稳定null也不按页面结果强制制造。

**通用缺陷与计划**：Chrome151证明`canPlayType`、`MediaSource.isTypeSupported`、MediaCapabilities三者
并不共享一张表；例如`audio/ogg;codecs=vorbis`分别为probably/false/supported。现有“必须同表”假设
被证伪。另Chrome的`navigator.mediaCapabilities`是无own keys的branded singleton，方法位于
`MediaCapabilities.prototype`，结果只有`powerEfficient/smooth/supported/keySystemAccess`；Obscura是
普通own-method对象且多出`configuration`。正式修改仅实现这些通用API规则与shape，不包含站点、字段或
challenge时序分支；临时`RTCDBG`全部删除后再测试。

**通用实现与focused**：MIME/codec用结构化解析后分别投影canPlayType、MediaSource和
MediaCapabilities规则；AC-3/EC-3与HEVC声明按Chrome151当前Apple oracle修正。新增branded
`MediaCapabilities`非法构造器、prototype enumerable方法、稳定Navigator prototype getter与四字段结果；
`powerEfficient`保持false。focused覆盖8/10矩阵、Ogg分歧、shape/order/keys，1/1通过。

**真实三ray与交互**：最终release三条有效38-part ray的`tlDjt8`稳定为
`[[1,0,0,1,1,1,0,0],[1,1,1,1,1,1,1,1,1,0],[3,0,0,3,3,3,3,3],
[3,3,3,3,3,3,3,3,3,0]]`；前两组从Obscura旧值精确迁为Chrome值，第三组保持诚实的3，第四组
HEVC位置0→3与独立API oracle一致。`IMOh8`仍8/21且`jimCO7`保持。条件轮t=6.2s box可见但
interactive=false时不点，t=6.5s条件齐备后只点一次；第二widget fo此前已完成，随后proof5160B、
top3256B并换ray，仍无真实404。

**最终门**：focused2/2、串行workspace1683/1683（4 skipped）；no-default、精确release、trace、
diff、端口和正式源码泄漏扫描均通过。obstacle repo仍不存在。结论：Step93遗留内部字段泄漏闭环，
但不是最终判定唯一阻塞。

### Step 125 — `console.memory`通用Chrome公开面（2026-08-31，完成）

**HaHa参考筛选**：重点审计HaHaVM-General `760c7b4`的`core/**`，排除其checkbox轨迹、heap/MSAA
固定样本、随机CPU/内存与canvas像素。`removeAttribute`、2D `getContextAttributes`、WebGPU canvas、
ImageData、CSSOM和WebGL internalformat均已由Obscura更完整实现。剩余高信号候选是HaHa补出的
`console.memory`；HaHa的固定`jsHeapSizeLimit`只作定位提示，不迁移数值。

**假设与Obscura基线**：Chrome公开console上存在稳定的memory入口，而Obscura当前
`"memory" in console=false`、无own descriptor且值undefined；它只有`performance.memory`。
下一步用Chrome151独立oracle确认descriptor、identity、对象keys、品牌和与performance.memory的关系，
仅在通用语义闭环后实现。

**Chrome151 oracle与根因**：`console.memory`是console own enumerable/configurable accessor，匿名
getter length0与匿名no-op setter length1均native；`performance.memory`是Performance.prototype上的
enumerable/configurable getter。两入口每次返回不同fresh wrapper，但共享同一当前heap数值和同一
MemoryInfo prototype。实例own keys/names为空，prototype依次是totalJSHeapSize/usedJSHeapSize/
jsHeapSizeLimit三个enumerable/configurable getter，错误receiver抛`TypeError: Illegal invocation`，
prototype的toStringTag为MemoryInfo且不存在全局MemoryInfo构造器。Obscura的performance.memory还错误地
是稳定own普通对象，因此应两入口一起修，而不是只加HaHa的普通对象console getter。

**实现计划**：保留Obscura现有每页动态heap数值和limit，不复制HaHa固定数字。用共享realm backing、
WeakSet品牌与fresh MemoryInfo wrapper实现两个标准getter；console setter保持Chrome no-op。增加focused
覆盖descriptor、identity、brand、prototype顺序和两入口数值一致性。

**通用实现与focused**：现有每页`_fpRand` heap结果改存共享realm backing；Performance prototype getter
与console own匿名get/no-op set每次创建fresh branded MemoryInfo，三getter按Chrome顺序和descriptor安装，
错误receiver抛Illegal invocation。未暴露全局构造器、未改heap数值。focused 1/1通过。

**真实三ray与交互**：三条有效38-part clean ray与Step124共有132个稳定字段逐项0差异，tlDjt8、
IMOh8、jimCO7及WebGL字段保持；本轮payload未把console.memory单独编码为稳定字段。条件轮总体第二个
fo（widget大提交845756B）完成后，t=6.2s box可见但interactive=false不点，t=8.0s条件齐备后只点
一次；随后127224B提交、proof5224B、top3256B和新ray完整，仍无真实404。

**最终门**：focused1/1、obscura-js544/544、workspace1684/1684（4 skipped）；no-default、精确
release、trace patch、diff/新增定向字符串/端口检查通过。companion obstacle course仓库不存在。
结论：HaHa提示的公开面已按更完整Chrome语义闭环，但不是最终判定唯一阻塞。

### Step 126 — 完整Chrome console方法面（2026-08-31，完成）

**HaHa参考与假设**：HaHa完整browserConsole提示Obscura除了刚补的memory外，还缺dirxml、profile、
profileEnd、timeStamp、context、createTask六个Chrome方法。Obscura实测现有trace/table/group/time/count等
方法虽存在，但Function.toString仍泄漏`() => {}`；console own-key顺序也不同。该面是通用Chrome公开
接口，不依赖站点、设备或payload字段。

**方法**：采集Chrome151全部console own names、每个方法的name/length/native/descriptor，并验证
context facade与createTask.run语义；不改变现有“console不主动遍历对象getter”的惰性格式化规则。

**Chrome151 oracle与计划**：console own顺序为debug/error/info/log/warn/dir/dirxml/table/trace/group/
groupCollapsed/groupEnd/clear/count/countReset/assert/profile/profileEnd/time/timeLog/timeEnd/timeStamp/context/
createTask/memory；24方法均writable/enumerable/configurable native，除context.length=1外均length0。
console tag为`[object console]`。context返回fresh普通对象，按固定顺序有22个独立length1 native方法
（使用dirXml），不含context/memory/createTask。createTask返回普通对象，own enumerable run为length0 native；
合法调用以window为this、零参数执行回调并透传返回值，非函数或错误receiver抛Error。正式实现按此完整
shape重建方法表，保留现有日志惰性格式化与宿主输出。

**focused首轮修正**：5项console相关测试中4项通过，唯一差异为createTask实例不是直接继承
Object.prototype，而是共享一个own仅constructor的中间prototype；补该标准prototype层后重跑，首轮
不计门禁成功。

**通用实现与focused**：按Chrome顺序重建24方法，全部native name/length/descriptor；补console tag、
fresh context facade与带共享中间prototype/receiver检查的createTask.run。现有惰性对象格式化复用不变。
首轮prototype修正后console相关focused 5/5通过。

**真实三ray与交互**：三条完整38/39-part中tlDjt8、jimCO7保持；console面稳定迁移hGgWW0一处计数
12→13及三个方法枚举/调用序列字段，符合公开面变化。条件轮第二总体fo大提交822608B完成后，t=6.2s
box可见但interactive=false不点，t=6.5s条件齐备后只点一次；随后127216B、proof5160B、top3256B和
新ray完整，仍无真实404。

**最终门**：focused5/5、obscura-js545/545、workspace1685/1685（4 skipped）；no-default、精确
release、trace patch、diff/新增定向字符串/端口检查通过。companion obstacle course仓库不存在。

### Step 127 — Blob/File internal slots与UTF-8替换语义（2026-08-31，完成）

**HaHa参考与筛选**：HaHaVM-General `ac29524`修正Blob分片拼接，提示继续审计该通用对象面；同批
URL、elementFromPoint、Canvas/WebGPU、removeAttribute和console在Obscura已有更完整实现，不重复迁移。
HaHa固定XHR cache headers、iframe 10ms延时与CF点击轨迹属于宿主或站点逻辑，明确排除。

**假设与基线**：Obscura Blob实例自有`_bytes/size/type`，File再自有`name/lastModified`；Chrome WebIDL
对象应以internal slots和prototype getter暴露。值层还有一处明确偏差：Obscura把null/undefined BlobPart
当空字节，Chrome按DOMString写入`nullundefined`。

**Chrome151 oracle**：Blob/File实例own names与keys均为空，prototype顺序分别为
`size,type,arrayBuffer,slice,stream,text,bytes,textStream,constructor`和
`name,lastModified,lastModifiedDate,webkitRelativePath,constructor`；属性/方法均为enumerable、
configurable WebIDL成员，Blob/File构造器length为0/2，slice.length=0。File继承Blob，lastModified
123.9截断为123，lastModifiedDate每次返回fresh Date，native endings在macOS把CRLF归一为LF。
同一字节样本的text/bytes/arrayBuffer/stream/textStream及非法receiver均已采集。

**附带根因**：样本中的0xff使Obscura TextDecoder热路径产出孤立surrogate，JSON序列化直接非法；
Chrome对非法lead、非法continuation、过长编码、surrogate区、超U+10FFFF和截断序列按WHATWG规则产生
U+FFFD。9组Chrome151 code-point oracle已固定到既有TextDecoder回归。

**通用实现与focused**：Blob/File字节、type、name和lastModified迁到realm WeakMap；所有内部消费者
（fetch/FormData、object URL、FileReader、OPFS）改读internal slots。补完整prototype顺序、descriptor、
brand check、stream/textStream与File getter；null/undefined恢复字符串分片。UTF-8热路径保留纯JS性能，
但增加完整合法范围与replacement校验。Chrome parity focused1/1，相关Blob/TextDecoder/worker/OPFS
测试6/6、obscura-js release+render 546/546通过。

**真实三ray与交互**：最终release三条clean payload均完整，分别91/38、91/38、92/39 key/parts；
Step126与Step127共有136个稳定字段逐项0差异，说明本次修复没有扰动既有payload，但当前挑战未把
Blob/File面单独稳定编码。条件轮6.2s box可见但interactive=false时不点，7.1s条件齐备后仅点一次；
随后proof5240B、top3256B并换新ray，仍无目标真实404。PAT保持401。

**最终门**：focused1/1、相关6/6、obscura-js546/546、workspace1686/1686（4 skipped，1 leaky）；
no-default feature check、精确release、trace patch、diff/源码定向字符串/端口检查全部通过。companion
`obscura-benchmark`仓库不存在，obstacle course无法运行。结论：Blob/File与UTF-8通用缺陷闭环，
但不是最终判定唯一阻塞；下一候选为XHR公开shape/state。

### Step 128 — XMLHttpRequest公开面与internal slots（2026-09-01，完成）

**HaHa参考与假设**：HaHaVM-General把XHR属性/常量/方法放在`XMLHttpRequest.prototype`，事件handler
放在`XMLHttpRequestEventTarget.prototype`，提示审计Obscura当前实现。Obscura实测源码把readyState、
status、response、请求URL/header、aborted、listeners和全部handler写成实例own字段，upload还是只有两个
own no-op方法的普通对象，并在XHR prototype重复EventTarget方法。Chrome应使用WebIDL prototype成员与
internal slots；这是通用环境缺陷，不依赖站点或payload。

**边界**：HaHa的固定`pragma/cache-control`、资源大小、10ms iframe延时与全局headers属于宿主/站点输入，
不迁移。正式实现必须保留Obscura现有realm相对URL、fetch/CORS/credentials和真实响应路径；先采Chrome151
constructor/prototype/descriptor/own keys、upload品牌、初始/open/abort状态和非法receiver，再决定范围。

**Chrome152 oracle**：本机Chrome已升级到152。XHR与Upload实例own names/keys均为空，品牌分别为
`XMLHttpRequest/XMLHttpRequestUpload`；XHR prototype按onreadystatechange、状态accessor、五常量、七方法、
constructor、responseXML、setAttributionReporting、setPrivateToken排列，EventTarget prototype只own七个
handler与constructor，Upload prototype只own constructor，三层prototype连接标准EventTarget。所有WebIDL
成员enumerable/configurable，常量readonly/nonconfigurable；构造器length均0且后两者illegal constructor。

**状态/事件oracle**：初始response与responseText均空串而非null；open只产生trusted Event类型的
readystatechange并到OPENED。send前abort保持OPENED且不新增事件。成功响应顺序为readystatechange(1)、
loadstart ProgressEvent、readystatechange(2/3)、progress ProgressEvent、readystatechange(4)、load/loadend
ProgressEvent；5B body的progress/load/loadend均loaded=total=5。响应headers小写并以CRLF结尾。send/header
在open前、错误receiver和非text responseText均抛标准TypeError/InvalidStateError。

**请求头反证HaHa固定值**：同源Chrome GET仅有accept/referer/UA/UA-CH，无`pragma`、`cache-control`、
`content-type`或手工`origin`，因此这些HaHa值明确不迁移。正式实现范围为WeakMap slots、WebIDL shape、
branded upload、标准状态/事件与保留现有fetch路径。

**通用实现**：XHR与Upload状态、headers、handler、request token和timeout全部迁WeakMap；新增illegal
`XMLHttpRequestUpload`与标准三层prototype/own顺序/readonly常量/品牌。handler setter接入通用listener
registry，内部readystatechange用trusted Event，load/progress/timeout/abort/loadend用trusted ProgressEvent；
open/send/header/receiver增加标准状态异常。响应读取改保留原始bytes，arraybuffer/blob不再由文本重编码；
realm相对URL、fetch CORS与credentials路径保持。EventTarget=Node架构中，通用dispatcher现在仅把带真实
node slot的对象当DOM Node，避免XHR进入parent/shadow路径。

**statusText附带修复**：focused首轮shape/event和两个既有回归均通过，仅201响应reason phrase为空；
定位为普通与stealth `op_fetch_url`均只回数值status。两路径用标准StatusCode canonical reason加入
`statusText`，JS Response透传，不做XHR局部硬编码。重跑focused 3/3通过。

**真实三ray**：最终release三条clean均完整，为38/39/39 parts。隔夜challenge轮换了全部混淆字段名，
Step127与Step128按字段名交集为0，故禁止把普通stable diff归因代码；改按结构身份复核。Zok三轮均
N1165/o121/x266/F13/T11且XHR/EventTarget/Upload都在N，120项数组均true76/false22/null6，与Step127
逐结构一致。该轮证明无链路/结构回退，但不能声称某个旧混淆字段迁移。

**条件交互**：6.2s第二fo完成且box可见但interactive=false时不点，7.1s条件齐备后仅点一次；
proof5160B、top3256B与new-ray完整，PAT401，目标仍为challenge而非真实404。serve已停止。

**新增测量盲区**：challenge版本跨日轮换会让全部探针字段名变化；跨版本不能按字段名stable diff，
必须先确认同一源码版本，或用Zok键集合、数组长度/类型/计数等结构身份对齐。否则“0 commonStable”
只是混淆轮换，不是引擎所有能力同时变化。

**最终门**：focused3/3、obscura-js547/547、workspace1687/1687（4 skipped）；no-default feature check、
精确release、trace patch、diff/定向源码/端口检查全部通过。companion `obscura-benchmark`不存在，
obstacle course无法运行。结论：XHR公开面、internal slots、事件和statusText通用缺陷闭环，但仍不是
最终判定唯一阻塞；下一候选为同一fetch栈的Headers/Request/Response internal slots与公开shape。

### Step 129 — iframe embedded CSP与Trusted Types继承（2026-09-01，调查中）

**目标与假设**：成功判据不再是提交链完整，而是`https://www.thelancet.com/1.txt`返回真实404。当前
frame controller已把网络响应CSP写入DocumentScope，srcdoc/about:blank复制父scope CSP，frame realm的
fetch从自己的scope读取connect-src；但`FrameNavigationRequest`无embedded CSP字段，顶层/嵌套iframe
属性采集也不读`csp`。若挑战iframe依赖HTMLIFrameElement CSP embedded enforcement，Obscura会运行在
比Chrome更弱或不同的policy组合下，最终proof可提交但环境分类不同。

**已确认实现边界**：top response CSP由Page保存并注入main runtime；network frame只保存自身response
header；local frame继承parent scope；同步initial about:blank同样复制shadow-including parent scope；frame
fetch按content root scope选择CSP，已非top-policy误用。缺口集中在`iframe[csp]`公开面、请求协商和与
response/inherited policy的组合，不重复修已闭环的realm选择。

**下一方法**：Chrome152双源fixture分别测srcdoc、about:blank、无CSP network frame、response CSP frame、
`iframe[csp]` frame；同时观察`Sec-Required-CSP`/加载结果、connect-src fetch和require-trusted-types-for
下plain eval。只有Chrome oracle证明后才修改请求/commit逻辑。

**Chrome152 oracle**：`HTMLIFrameElement.prototype.csp`是enumerable/configurable反射accessor。父
connect-src none会约束srcdoc/about:blank；network frame不继承父policy而使用自身response CSP。父级
require-trusted-types-for同样在srcdoc/about:blank中阻止plain eval，network frame不继承。

**embedded enforcement**：network `iframe[csp="connect-src 'none'"]`请求带
`Sec-Required-CSP: connect-src 'none'`。无response CSP且无Allow-CSP-From时响应体不提交并变为不可访问
错误页；response带精确/更强policy时正常提交且fetch受限。local document中，csp属性直接约束srcdoc，
但不约束初始about:blank；后者只继承creator policy。这三条必须分开实现。

**真实目标相关性**：closed-shadow属性探针确认当前Turnstile iframe只有style/src/allow/sandbox/id/
tabindex/title，没有`csp`。因此本修复补通用浏览器机制，但现有证据不支持把它称为404根因；完成后必须
继续点击后Chrome/Obscura第一处分歧。

**通用实现与focused**：补`HTMLIFrameElement.csp`反射；ResourceRequest新增单请求headers并在普通/
stealth transport及callbacks中一致合并；network frame发送Sec-Required-CSP。response CSP同等/更强或
Allow-CSP-From接受才提交，否则返回专门EmbeddedEnforcement阻断；Allow接受时required policy与response
有效source-list求交集。srcdoc与creator policy求交，about:blank忽略csp属性。策略单元、network exact/
Allow/reject、local srcdoc/blank、公开descriptor与既有frame timing focused3/3通过。

**真实404复测与探针污染**：带旧条件点击脚本的payload明确编码了attachShadow wrapper源码，该轮作废为
指纹证据。改用零预注入、零早期evaluate，只按Rust日志第三fo+固定800x600几何点击；payload中的同一项
恢复`function attachShadow() { [native code] }`，页面首次显示“Verification successful. Waiting for
www.thelancet.com to respond”，但proof5160B/top3256B后仍换ray，25s未得到真实404。当前widget无csp，
因此embedded CSP修复不是直接阻塞；转为同challenge版本完整Chrome/Obscura明文payload对拍。

**新增测量盲区**：任何为找closed root而包装attachShadow的点击探针都会被当前challenge直接编码进
payload。shadow结构轮可用它判断DOM，但不能承担payload/过盾判据。真实交互判据必须零预注入，或使用
不修改页面realm函数identity的CDP/宿主观测。

**同版本Chrome明文对拍与新根因**：零注入Obscura与Chrome152当前challenge字段名完全一致，取得
92-key/39-part Chrome与91-key/38-part Obscura payload。Zok中Chrome N1171/o120/x266/F12/T12，
Obscura N1165/o121/x266/F13/T11；Chrome `crossOriginIsolated`在T且有SharedArrayBuffer，Obscura在F且
无SAB。经同代理直接响应头确认目标403明确带`Cross-Origin-Opener-Policy: same-origin`、
`Cross-Origin-Embedder-Policy: require-corp`与CORP，原实现“永不授予隔离”的常量false与真实输入矛盾。

**跨源隔离实现**：Page按安全URL + COOP same-origin + COEP require-corp/credentialless + Permissions-
Policy未禁用推导per-document isolation并注入runtime。main/frame realm的crossOriginIsolated从同一state
读取；isolation=true时从shared WebAssembly.Memory buffer延迟取得V8隐藏SAB constructor并以标准全局
descriptor恢复，false时继续隐藏。header推导、main SAB descriptor/构造与frame继承focused3/3通过。

**`gPOK0`明确异常映射**：Chrome同字段为`root<随机custom-element名>1/0...`，Obscura为
`undefinedTypeError: <局部变量> is not a function`。Chrome152 oracle确认CustomElementRegistry prototype
新增`initialize(root)`，公开顺序define/get/getName/upgrade/whenDefined/initialize/constructor，实例own空；
scoped `attachShadow({customElementRegistry})`只升级自己的root。Obscura缺initialize且registry实例泄漏四个
内部字段、prototype泄漏两个helper，形成完整因果链。

**scoped registry实现**：registry状态迁WeakMap，内部define/upgrade helper移出prototype；补initialize、
标准shape/tag/native descriptor与ShadowRoot.customElementRegistry，attachShadow绑定registry root，define/
initialize只升级关联scope，global document不受scoped registry影响。新focused与既有upgrade/constructor-
failure共3/3通过。

**真实字段反证**：scoped registry精确release、零预注入复测后，`gPOK0`仍为同形TypeError，最终仍停在
“Verification successful”后换ray。因此缺`initialize`是明确的Chrome公开面缺陷，但此前“形成完整因果链”
的结论不成立，不能把实现通过focused等同于该字段闭环。

**HaHaVM-General后续线索与oracle**：其环境还新增`Element.prototype.customElementRegistry`。Chrome152
独立oracle确认该getter enumerable/configurable/native：普通与shadow host元素返回global registry，scoped
shadow内子元素返回对应scoped registry。Obscura按root动态返回真实registry并加入shape/行为回归；release
复测后`gPOK0`和404结果仍完全不变。该项同样保留为通用语义修复，后续改用零注入V8 trace和当前rch源码
恢复TypeError实际callee，不再围绕CustomElementRegistry继续猜测。

**实际probe映射（更新）**：property-only trace取得65,639条lookup、两条完整payload和同轮421,675B
`/rch/` source。Chrome OOPIF在仅诊断轮关闭site isolation后，`gPOK0` accessor的五次赋值均暂停于VM
store opcode `IH.B:10110`；寄存器显示四个业务对象是`#dGSz90..93`的DIV/SPAN，另有动态style、bound
`querySelectorAll`与`contains`。各次拼接值是`root`或`VMQLo2`加匹配计数。因此该字段实际测试动态
CSS selector/DOM查询，不是custom-element/scoped registry；下一步恢复完整style、selector和匹配集合，
再建立最小Chrome/Obscura fixture。

**`gPOK0`最终根因**：Chrome debugger恢复的调用序列是BODY.appendChild(`<null>`)后，四次交替执行
insertAdjacentHTML(TrustedHTML)与bound document.querySelectorAll；receiver依次为NULL、dGSz90、dGSz91、
dGSz92。Obscura append后的ownerDocument URL、connected与root identity均正确，但首次insert后bound/direct
QSA都为0，第二次VM call因此得到字符串`insertAdjacentHTML`和undefined receiver。

问题不在selector或scope，而在internal fragment parser：它把TrustedHTML先String化，再通过临时元素的
公开innerHTML setter二次执行Trusted Types enforcement；frame default policy看到失去品牌的plain string后
把markup改写为空。修复为insertAdjacentHTML公开sink只enforce一次，`_parseHTMLFragment`直接调用native
set_inner_html。真实release零注入后`gPOK0`迁为Chrome同结构的五段root/VMQLo2 title串，TypeError消失。

**相关live collection试验**：独立Chrome152 oracle确认getElementsByClassName/getElementsByTagName、
Element.children和Node.childNodes在插入、class mutation与detach后实时更新，同root/query保持SameObject。
尝试性的provider/Proxy实现触发shadow identity高频测试长时间hang，已回退，不计入本轮交付。最终点击仍
停在Verification successful并换ray，没有真实404，下一阶段按新payload重排剩余稳定差。

**验证状态**：最终源码已移除所有gPOK诊断和live childNodes试验，精确release build及patched V8 check
通过。workspace nextest实际运行到937/1694后因试验性live childNodes路径在shadow identity测试中超时而
中断；该试验已回退，完整门尚未在回退后的干净基线重跑。真实目标仍未取得404。

### Step 162 — Navigator 收尾后的真实-IP A/B（2026-09-02，调查中）

**假设**：Navigator own-key 迁移后，若环境枚举是当前 challenge 的阻塞点，真实-IP CONNECT 转发下应出现
不同的 challenge 分支或目标响应。

**方法与证据**：使用 trace-patched release、stealth、Chrome 149 macOS UA，对
`https://www.thelancet.com/1.txt` 做无 preload 固定坐标点击；CONNECT 转发只把
`brunhild.challenges.cloudflare.com` 映射到真实 Cloudflare IP，保留 Host/SNI。Obscura 的
`navigator`/`window`/`document` own-key 快照无内部泄漏；Brunhild `/i` 返回 `204`，frame/top `/fo`、
`/pat`（401）、proof 和新 ray 均完成，但页面仍回到 challenge，未收到目标真实 `404`。

**结论**：Navigator 枚举修复没有改变真实判定；网络可达性与 challenge proof 链已分别证明，当前仍没有
足够证据把剩余失败归因到新的通用环境 API，也不加入 hostname 特判。最终验收继续以真实 `404` 为准。

### Step 164 — Headers/Request/Response internal slots（2026-09-02，完成）

**HaHa 参考与 Chrome oracle**：HaHaVM-General 的 fetch 对象实现提示 Obscura 的 `Headers`、`Request`、
`Response` 仍把 `_h`、请求字段和 `_bodyBytes` 放在实例 own properties；Chrome 152 三类实例 own names
均为空，公开成员位于原型并使用 WebIDL enumerable/configurable descriptor。

**修复**：三类对象的状态迁入 realm-local WeakMap；补 Headers 合并/排序与 `getSetCookie`、Request 相对 URL
解析、clone/bodyUsed、Response bodyUsed/clone/bytes/textStream/formData，并按 Chrome 顺序重建原型成员。
移除 Response 的 `__obscuraRequestId` own 泄漏。新增 focused shape/行为回归，既有 URL、Blob、XHR/fetch
回归保持通过。

**验证**：`obscura-js --features render` `562/562`、workspace `1711/1711`（5 skipped）、obscura-net
`91/91`、release/no-default/trace patch 均通过；实现不包含站点特判。

### Step 165 — Fetch 对象修复后的真实站复测（2026-09-02，调查中）

最新 release 使用 stealth、Chrome 149 macOS UA、无 preload 固定坐标点击和真实-IP CONNECT 转发；
Brunhild `/i` 返回 `204`，frame/top `/fo`、`/pat 401`、proof/top 与新 ray 均完成，但页面仍停在
challenge，没有目标真实 `404`。该结果未改变此前外部 challenge 判定，继续保留未决状态。

### Step 166 — Fetch redirect 边界与最终代码门禁（2026-09-02，完成）

Chrome oracle 复核 `Response.redirect()` 返回 `type="default"`、绝对化 `Location`；Obscura 已修正该
边界并加入 focused 断言。最终 workspace release nextest 为 `1711/1711 passed`（5 skipped，1 leaky 的
既有测试环境标记），精确 release build、no-default check、`vendor/v8-trace.sh check` 和 `git diff --check`
均通过。真实站仍以 `/1.txt` 真实 `404` 为唯一验收，当前 challenge proof 后换 ray，未宣称通过。

### Step 167 — 最终 release 无注入复测（2026-09-02，调查中）

包含 Headers/Request/Response 与 redirect 修复的最终 release，在真实-IP CONNECT 转发下再次完成
Brunhild `/i 204`、frame/top `/fo`、`/pat 401`、proof/top 和新 ray；18 秒 settle 内页面仍为
`Just a moment...`，没有真实 `/1.txt` `404`。该轮无 preload、无页面侧 hook，不把 challenge 文案或
`Verification successful` 当成功；当前剩余问题仍是上游 challenge 判定，未获得足够证据继续添加通用 API。

### Step 163 — scripted POST 的 Content-Type 保真（2026-09-02，完成）

**假设与证据**：Chrome 152 本地 HTTP fixture 显示同源 `fetch`/XHR 的显式 `Content-Type` 会原样发送；
Obscura 普通客户端此前对所有带 body 的 POST 无条件覆盖为 `application/x-www-form-urlencoded`，会破坏
脚本请求头。该路径与 stealth transport 共用请求模型，属于通用网络语义缺陷。

**修复与回归**：普通客户端现在只在导航 POST 且请求未提供 `Content-Type` 时补表单默认值；脚本 POST
保留显式头部。新增 `scripted_post_preserves_explicit_content_type` 与
`navigation_post_defaults_to_form_content_type`，obscura-net release nextest `91/91` 全部通过。
该修复不含站点或 challenge 分支，真实 challenge 链仍按 Step162 的结果单独记录。

### Step 168 — Fetch bodyUsed 生命周期与最终回归（2026-09-02，完成）

`fetch(request)` 现在检查并更新 Request 的 internal `bodyUsed`，重复消费会按 Chrome 拒绝；Request/Response
focused 回归保持通过。最终 workspace release nextest `1711/1711`（5 skipped），`test_wait_for_selector`
单独重试通过；精确 release build、no-default check、V8 trace patch、diff check 均通过。真实目标仍未返回
`404`，不将 challenge 文案当作成功。

### Step 169 — Accept-CH/Critical-CH 客户端提示（2026-09-02，完成）

目标响应明确返回 `Accept-CH` 与 `Critical-CH`，要求 `Sec-CH-UA-*`/`UA-*` 高熵字段；之前两条
HTTP transport 都完全忽略。现在按 response origin 记录提示，导航遇到缺失的 Critical-CH 时只重试一次，
并从统一 fingerprint 派生 arch、bitness、full-version、model、platform-version 与 UA 字段。普通和 stealth
两条路径各有两跳本地 fixture，均验证重试和头部值。

### Step 170 — Client Hints 修复后的真实复测（2026-09-02，调查中）

最终 release 无 preload、stealth、真实-IP CONNECT 转发再次完成目标/frame `/fo`、Brunhild `/i 204`、
PAT、proof/top 和新 ray；页面仍为 challenge，未返回真实 `/1.txt` `404`。本轮没有新的通用 API 证据，
不加入 hostname 特判。

### Step 171 — Client Hints 最终门禁（2026-09-02，完成）

普通与 stealth transport 的 `Accept-CH`/`Critical-CH` 两跳 fixture 均通过；`obscura-net` release
`93/93`、workspace release `1713/1713`（5 skipped）、精确 release build、no-default check、V8 trace
patch 和 diff check 全部通过。真实轮仍只到 `/fo`、Brunhild `/i 204`、PAT、proof/new-ray，没有目标真实
`404`，因此目标验收继续保持未完成。

### Step 172 — Permissions-Policy 文档策略传播（2026-09-02，完成代码修复）

**假设**：Chrome 152 的 challenge payload 会读取 `document.featurePolicy`；Obscura 先前忽略响应的
`Permissions-Policy`，导致 `allowsFeature('geolocation')` 和 `getAllowlistForFeature()` 在 `feature=()` 时仍返回允许。

**方法与证据**：为 `DocumentScope`、top-level `ObscuraState` 和 frame navigation 传播原始 header；bootstrap
解析 `()`, `*`, `'self'` 与显式 origin，并据此实现 `FeaturePolicy`/`PermissionsPolicy` 的公开方法。frame 权限
op 同时检查父文档与当前文档策略，再处理 iframe `allow`。

**回归与结论**：新增 `feature_policy_reads_committed_permissions_policy_header`，验证 geolocation/camera
拒绝、microphone self、fullscreen wildcard 和 allowlist；`obscura-browser` 113/113、`obscura-js` 排除已知
shadow identity hang 后 562/562 通过。release build、no-default check、V8 trace check、diff check 均通过。
真实-IP challenge 仍 proof/top/new-ray 后停在 challenge，目标 `/1.txt` 尚未返回真实 404。

### Step 173 — Permissions-Policy 修复后的直接复测（2026-09-02，调查中）

最新 trace-patched release 使用 stealth、无 preload 访问 `https://www.thelancet.com/1.txt`，页面先显示
`Verification successful`，随后仍返回 Cloudflare challenge 的 `Enable JavaScript and cookies to continue`
（Ray ID `a34bd8732f75e367`），没有真实 404。该文案不作为成功信号；当前仍缺可用代理条件下的最终验收。

### Step 174 — Live Document own-key 与 HTMLDocument 反射面（2026-09-02，完成）

**假设**：Chrome 152 与 Obscura 的 realm 枚举仍有通用 Document 差异，可能影响 challenge 的文档属性桶。

**证据与修复**：同一代理/UA 的 CDP A/B 显示 Chrome live `document` own keys 为 `location,lang`，Obscura 为
`lang,dir`。Obscura 补齐 live Document 的 enumerable/non-configurable own `location`，并让 `dir` 位于
Document 原型反射根元素；保留 Chrome 中页面写入 `document.lang` 后产生的普通 own 属性语义，新增 own-key/descriptor 回归。

**结论**：focused own-key 回归通过；Chrome 同代理也在 `interactiveEnd/overrunBegin` 后停留，故未把上游挑战失败
归因于 Obscura。目标真实 404 仍未取得。

### Step 175 — FeaturePolicy 默认表与 allowlist 对齐（2026-09-02，完成）

**证据与修复**：Chrome 152 oracle 给出 66 项 `allowedFeatures()` 的稳定顺序及默认 allowlist（self 或 `*`）。
Obscura 按该顺序重建默认表，补齐默认 wildcard 语义，同时保留响应 header 对显式 feature 的覆盖和跨 origin 判断。

**回归与门禁**：Permissions-Policy focused、own-key focused、workspace（排除已知挂起测试）1715/1715 通过；release
build、no-default check、V8 trace 和 diff check 通过。真实-IP CONNECT 下 Chrome 与 Obscura 均未到真实 404，验收继续未完成。

### Step 176 — 最新 release 真实验收复测（2026-09-02，未通过）

最新 trace-patched release 无注入访问 `https://www.thelancet.com/1.txt` 仍显示
`Verification successful` 后回到 `Enable JavaScript and cookies to continue`（Ray ID `a34c08cb4c6f3bfd`）。
没有真实 404；challenge 文案不作为成功判据。

### Step 177 — 最终 release 复测（2026-09-02，未通过）

刚重建的 trace-patched release 无注入访问目标仍返回 `Verification successful` 后的
`Enable JavaScript and cookies to continue`（Ray ID `a34c15e86c838ace`），没有真实 404。

### Step 178 — 最终 release 真实-IP CONNECT 点击链（2026-09-02，未通过）

使用最终 release、Chrome 149 macOS UA 和现有真实-IP CONNECT 转发，标准 probe 点击后再次观察到 frame
`/fo`、Brunhild `/i 204`、PAT、proof/top 提交和新 ray；页面仍停在 challenge，没有真实 404。该链路与 Chrome
同代理的 `interactiveEnd/overrunBegin` 结果一致，未发现新的可安全归因的 iframe API 差异。

### Step 179 — Chrome payload 文件格式与 enum 工具适配（2026-09-02，完成）

用户提供的 `assets/payload/1.json`、`2.json`、`3.json` 是 Chrome 149 解密 payload；属性桶位于
`1.gsLi5`，而非旧版本的 `fyCZH9`。更新 `diff_payload_enum.py` 按桶值形状识别混淆键，并将
`document.all`/裸 `undefined`/`event` 标为 Chrome 的 `typeof undefined` 特例。

### Step 180 — Chrome 149 payload 缺失集合修复（2026-09-02，完成）

初次对拍的真实缺失为 `navigator.modelContext`、`ModelContext`、`WebMCPEvent` 和 `document.designMode`。
Obscura 已补齐 secure document 下的 navigator 对象、全局构造器和 Document 原型属性；重新对拍结果为
navigator 81/81、document 295/295、screen 15/15、orientation 9/9、window 1238/1238，无真实缺失。

### Step 181 — 最新 release V8 trace（2026-09-02，完成观测）

使用远程 Reqable CA（CN=Reqable CA，2026-04-04）、代理 `http://192.168.3.57:9000` 和最新 release，
full V8 trace 产生 1,587,025 条记录。主 challenge 的 `XMLHttpRequest.open`、`cf-chl`/`cf-chl-ra`
header、`send` body 及调用栈均可见；`console` 仅有属性读取，未观察到实际 `console.log` 方法调用。
页面仍为 challenge，未返回真实 404；`assets/payload` 已完成类型面逐项对拍。

### Step 182 — Chrome payload 类型面清零（2026-09-02，完成）

`assets/payload/2.json` 与 `3.json` 的 `1.gsLi5` 桶提取出 n=81、d=295、s=15、so=9、bare=1238 个路径。
对最终 release 的 CDP 对拍结果为 navigator 81/81、document 295/295、screen 15/15、orientation 9/9、
window/global 1238/1238；`document.all` 与裸 `undefined/event` 按 Chrome 特殊 `typeof undefined` 处理。

### Step 183 — Chrome 149 surfaces 与 link DOM 面（2026-09-02，完成）

根据 payload 的真实缺失集合补齐 `navigator.modelContext`、`ModelContext`、`WebMCPEvent`、`document.designMode`；
同时将 `<link>` 改为独立 `HTMLLinkElement` 原型，补齐 URL/媒体/跨源/优先级等反射，并隐藏 DOM wrapper 内部字段的
own-property 反射。相关 focused 测试及最终 workspace `1717/1717` 全部通过。

### Step 184 — 代理 V8 trace 与 console.log 结论（2026-09-02，完成观测）

使用远程 Reqable CA（`CN=Reqable CA`，2026-04-04）和 `http://192.168.3.57:9000`，最新 release full trace
产生 1,587,025 条记录。主 `/fo` XHR 的 `open`、`cf-chl`/`cf-chl-ra`、`send` body 和调用栈均可见；payload
字符串仅包含裸 `console`，没有 `console.log` 路径，trace 也未观察到实际 `console.log` 调用。challenge 仍未
返回目标真实 404，不能把错误页或 `Verification successful` 当成功。

### Step 185 — 三份 Chrome payload 结构对比（2026-09-02，完成观测）

`assets/payload/1.json` 是 `chl_api_m` 渲染提交（47 个顶层字段）；`2.json` 与 `3.json` 的
`1.gsLi5` 均包含 62 个属性桶，n/d/s/so/bare 路径集合完全一致。2→3 仅有 proof 阶段的预期长度/计数变化
（`tQdUc5` 38→39、`maNnU6` 34→37、`rPXg2` 4→5）及 token/timestamp 变化，没有新的属性集合差异。

### Step 186 — 同步 nested iframe 的 sandbox 继承（2026-09-02，调查中）

**假设**：HaHaVM-General 和浏览器模型都把 sandbox 限制沿嵌套 browsing context 传播；Obscura 的
`create_blank_iframe_document` 在 iframe 插入时同步建立初始 `DocumentScope`，但只读取当前 host 的
`sandbox` 属性，未合并 containing document 的 sandbox。父 frame 被 sandbox 后，脚本创建的 nested
iframe 在 controller 异步提交前可能暂时拥有未沙箱化的初始文档。

**方法**：在 sandboxed srcdoc frame 的真实 realm 中同步创建 nested iframe，读取其 active content root
的 scope，随后与 Chrome 的 nested browsing-context sandbox 语义对拍。修复只使用父 scope 和
`SandboxFlags::merged_with_parent`，不引入站点分支。

**修复与证据**：`create_blank_iframe_document` 现在把 containing document 的 sandbox 与 host 自身
属性合并后，才计算初始 opaque origin 和 scope。新增
`synchronously_created_nested_iframe_inherits_parent_sandbox`，在 outer frame 的 author script 中
同步 append 未声明 sandbox 的 nested iframe，断言初始 scope 仍为 active、保留 `allow-scripts`、拒绝
`allow-same-origin` 且 origin 为 opaque；trace-patched release focused nextest 1/1 通过。

**结论**：同步插入与异步 controller commit 的 sandbox 语义现在一致。该项是通用 iframe 安全修复，
不包含目标域名逻辑；真实 `/1.txt` 404 仍需代理下的完整 challenge 结果确认。

### Step 187 — 语言 fingerprint 跨 frame/worker 与请求头同步（2026-09-02，调查中）

**假设**：当前同一代理、同一 Chrome 149 UA 的新 payload 中，参考 Chrome 为
`navigator.language="zh-CN"`、`navigator.languages=["zh-CN"]`，Obscura 仍固定为
`"en-US"`/`["en-US","en"]`。语言值同时影响 Accept-Language、frame/worker 的环境和 challenge
明文探针；只改 JS getter 会留下跨层不一致。

**方法**：把 language/languages 纳入现有 `BrowserFingerprint`/override 合同，以
`OBSCURA_LANGUAGE` 或 `OBSCURA_FINGERPRINT_JSON` 配置，统一注入所有 realm，并由普通/stealth
transport 和 scripted fetch 生成相同的 Accept-Language。默认值保持现有 en-US/en，不加入目标域名逻辑。

**修复与证据**：`BrowserFingerprint` 新增 language/languages 与 `accept_language()`；
`OBSCURA_LANGUAGE=zh-CN` 会同步生成 `["zh-CN"]` 和 `Accept-Language: zh-CN`，显式
`OBSCURA_LANGUAGES`/fingerprint JSON 可覆盖多语言列表。新增 fingerprint 和 runtime focused 回归均通过。
真实轮使用 `OBSCURA_LANGUAGE=zh-CN OBSCURA_TIMEZONE=Asia/Shanghai`，payload 的 `zIyO8` 已为
`zh-CN`、`sKMUH1=Asia/Shanghai`、`LxEyU6=December at China Standard Time`；再用现有
`OBSCURA_FINGERPRINT_JSON={"hardwareConcurrency":6,"deviceMemory":16}` 对拍，payload 的
`APSY2=16`、`TpsmW1=6` 与参考值一致，但两轮都在 proof 后回到 challenge，没有真实 404。

**结论**：语言/时区/硬件值已能配置并跨 realm/请求保持一致，未改变当前 Cloudflare 最终判定；真实
失败仍不能归因到该项。

### Step 188 — 响应 CSP `sandbox` directive（2026-09-02，完成代码修复）

**假设**：iframe 响应头中的 `Content-Security-Policy: sandbox` 是独立于 host `sandbox` 属性的
文档级限制；此前 Obscura 只保存该 header，未把它合并进 frame `DocumentScope`，可能错误执行
author script 或暴露 tuple origin。

**修复与证据**：`ContentSecurityPolicy::sandbox_flags()` 将 directive token 转为现有
`SandboxFlags`，frame controller 在 network response、accepted embedded policy 和父/host sandbox
之后按收紧规则合并；CSP sandbox 无 `allow-scripts` 时 author script 被阻止，`allow-scripts` 时仍
保持 opaque origin。新增 `csp_sandbox_directive_maps_to_restrictions` 与
`frame_response_csp_sandbox_gates_scripts_and_origin`，focused 2/2 通过，未加入目标域名逻辑。

同一 fixture 还给 `allow-scripts` 响应附加 COOP/COEP；scope 仍报告
`cross_origin_isolated=false`，避免 sandbox unique origin 错误暴露 SAB。

**结论**：响应 CSP sandbox 已覆盖 frame 脚本执行和 origin 语义，并与嵌套 sandbox 一致；真实目标
404 仍需完整 challenge 轮确认。

### Step 189 — CSP/语言修复后的最终真实轮（2026-09-02，未通过）

最终 trace-patched release 使用 `http://192.168.3.57:9000`、远程 Reqable CA、
`OBSCURA_LANGUAGE=zh-CN`、`OBSCURA_TIMEZONE=Asia/Shanghai` 和参考硬件 fingerprint。目标页面完成
widget 验证并显示 `Verification successful`，随后回到 `Enable JavaScript and cookies to continue`
（Ray `a34d2c305c04b012`），没有真实 `/1.txt` `404`。本轮没有把 challenge 文案当成功，也没有发现
新的可归因 iframe API 差异；最终 404 验收继续保持未完成。

### Step 190 — 本轮代码门禁（2026-09-02，完成）

新增 sandbox/语言修复后，`obscura-browser` 全 crate release nextest 为 `115/115`；workspace
release nextest 排除已知会永久挂起的 `shadow_root_identity_and_children_are_native_tree_backed` 后为
`1722/1722 passed`、5 skipped。未排除的全量轮在该测试处运行 829 秒后以 SIGINT 结束（958 passed、4 skipped、
764 未运行）。精确 trace-patched release build、`cargo check -p obscura-js -p obscura-cli --no-default-features`、
`vendor/v8-trace.sh check` 和 `git diff --check` 均通过。

### Step 191 — 当前代理 Brunhild 可达性复核（2026-09-02，外部阻塞）

最终 serve 使用相同代理、CA、语言/时区/硬件配置运行通信探针。日志显示 top/frame `/fo`、`/pat`、
proof `/fo` 与顶层转发均完成；唯一的
`https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/i/...` 请求没有收到
完成响应。独立 `curl -x http://192.168.3.57:9000 https://brunhild.challenges.cloudflare.com/`
在同一代理下稳定返回 `HTTP/2 502`（而 `www.thelancet.com/1.txt` 返回 Cloudflare 403 challenge）。

**结论**：当前环境无法用该代理完成 Cloudflare 的 Brunhild proof 服务，因此不能取得真实 `/1.txt`
`404`；这条证据不支持继续添加 iframe/API 特判。代理恢复或提供能转发 Brunhild 的网络条件后，才可继续
做最终 404 验收。

### Step 192 — Brunhild 真实-IP CONNECT A/B（2026-09-02，完成观测）

**方法与证据**：一次性本地 CONNECT 链路将 Brunhild 的 TLS TCP 端点送至真实 Cloudflare IP，其它
目标请求继续经 `192.168.3.57:9000`。在远程 Reqable CA 与系统 CA 合并后，Brunhild `/i` 稳定返回
`204`；Obscura 的 frame `/fo`、`/pat 401`、proof `/fo` 和顶层 `/fo` 均完成，但页面仍回到
`Enable JavaScript and cookies to continue`，没有真实 `/1.txt` `404`。

**结论**：远程代理的 502 已与引擎判定分离；即使 proof 服务可达，当前 challenge 仍拒绝 payload，
后续差异必须由同版本 Chrome/Obscura 明文对拍证明，不能加入 Brunhild hostname 特判。

### Step 193 — navigator language 与 V8/ICU 默认 locale（2026-09-02，完成代码修复）

**假设与证据**：只覆盖 `navigator.language` 会留下 Intl/Date 的跨层差异。默认 `LC_ALL=C.UTF-8`
时 payload 时间格式是英文；显式 `LC_ALL=zh_CN.UTF-8` 后变为参考的 `十二月 中国标准时间`。

**修复与验证**：CLI 在 V8 初始化前把显式 `OBSCURA_LOCALE`，或常见 `OBSCURA_LANGUAGE`/
`OBSCURA_LANGUAGES` 映射到 `LC_ALL`；未知语言不猜测。新增 locale mapping focused 测试通过。
在不设置外部 `LC_ALL`、仅设置 `OBSCURA_LANGUAGE=zh-CN` 的真实轮中，payload 已自动出现中文时间
格式，但最终仍为 challenge，无真实 404。

**结论**：语言、请求头、navigator、Intl/Date 现在可保持一致；该项不是当前 proof 拒绝的唯一原因。

### Step 194 — 本轮最终门禁（2026-09-02，完成）

CLI locale 改动后的 `obscura-cli` focused nextest 1/1、精确 trace-patched release build、
`vendor/v8-trace.sh check` 和 `git diff --check` 通过。之前已验证的 workspace 排除已知 shadow hang
结果保持 `1722/1722 passed`、5 skipped；未排除全量仍会在该既知测试处永久挂起。

### Step 195 — locale 改动后的 workspace 复核（2026-09-02，完成门禁）

带 locale 改动重新执行 workspace release nextest（保留已知 shadow identity 测试跳过）得到
`1722 passed`、`1 leaky`、`1 flaky failure`、5 skipped；失败项为既有
`obscura-cli::mcp_client::test_navigate_and_snapshot`，用 `--retries 2` 单独复跑通过。
no-default check 和最终 release binary 均已在本轮通过。真实目标仍无 `404`。

### Step 196 — frame 动态 stylesheet 的 CSP sink（2026-09-02，调查中）

**假设**：frame realm 动态 append `<link rel="stylesheet">` 时，`_loadLinkedStylesheet` 直接调用
`_fetchLinkedCss`，没有按该 frame 的 `style-src`/`default-src` 检查；同时它把 `origin` 参数设为
stylesheet URL 的 origin，而不是创建请求的 document origin。跨源 frame 因此可能绕过 style CSP，或
发送错误 Origin/CORS 元数据。

**方法**：用本地 HTTP frame 返回 `style-src 'none'; connect-src 'self'`，在 frame author script
动态添加 stylesheet，观察禁止 URL 是否发出以及请求 Origin；修复仅读取 containing frame 的
DocumentScope，不加入目标域名分支。

**修复与证据**：`_fetchLinkedCss` 现在在根 stylesheet 和每个 `@import` 前执行 frame-local
`style-src` gate；允许请求的 origin 改为当前 document scope，而不是 stylesheet URL 的 origin。
`dynamic_linked_stylesheet_uses_frame_style_csp_and_creator_origin` 与既有动态 stylesheet 回归
release focused 2/2 通过：`style-src 'none'` 时网络调用为 0，允许跨源表时看到的 origin 为
`http://example.com`。

**结论**：动态 stylesheet 的 frame CSP 与请求归属已闭环，未加入目标站点逻辑；真实 404 仍未达成。

### Step 197 — wreq Client-Hints 重复头（2026-09-03，代码修复完成）

**假设**：导航同时经过 wreq emulation 默认头、fingerprint 显式头和 CDP
`Network.setExtraHTTPHeaders` 时，`RequestBuilder.header` 的 append 语义会把同名
`sec-ch-*` 发出两次；收到 `Accept-CH` 后追加的高熵 hints 也可能与自定义头重复。

**方法**：本地 HTTP fixture 同时设置默认 fingerprint 和 extra `sec-ch-ua`/
`sec-ch-ua-mobile`/`sec-ch-ua-platform`，逐行计数原始请求；再覆盖 critical client-hints
重试路径。对真实目标使用 trace-patched release 与 clean CDP 输入，核对 `/fo` 序列。

**修复与证据**：`crates/obscura-net/src/wreq_client.rs` 在注入 UA、低熵 hints、fetch
元数据前检查 extra/request headers；accepted hints 若已有同名头则只计入已发送集合，不再 append。
`stealth_extra_low_entropy_headers_do_not_duplicate_defaults`、
`stealth_client_retries_critical_client_hints` 与既有 fingerprint 测试共 3/3 通过。
真实轮的顶层/Turnstile trace 已出现 3 个 `POST /fo`（顶层 1、frame 2）；clean 点击
命中 widget 坐标，但 Cloudflare 仍回 challenge，没有 `/1.txt` 404。头部引号由
`BrowserFingerprint::sec_ch_*`/`client_hint_value` 统一生成：platform、full-version、
arch、bitness 等为带双引号结构化值，mobile 为 `?0/?1`，UA 为原始字符串。

**结论**：重复 `sec-ch-*` 是请求头 append 造成的引擎缺陷，已消除并有原始线级回归；
当前目标失败点仍在 Cloudflare proof 判定/外部网络，不能用 hostname 特判替代。

### Step 198 — emulation 默认头与 HTTP/2 wire 去重（2026-09-03，代码修复完成）

**假设**：wreq emulation 在 middleware 层注入默认 headers，HTTP/2 序列化再叠加请求层
headers；即使 HTTP/1 fixture 只有一条，真实代理仍可能看到重复 `sec-ch-ua`。

**方法**：保留 emulation 的 TLS/HTTP2 选项但清空默认 headers，改由 Obscura 单点生成
Accept、Accept-Language、Accept-Encoding、Priority、Sec-Fetch 和 UA-CH。通过 HTTP/2
`https://httpbin.org/headers`，并用 CDP 注入大小写混合的 `Sec-CH-UA`，检查服务端 JSON。

**证据**：服务端实际只收到一条 `Sec-Ch-Ua`、一条 `Sec-Ch-Ua-Mobile`、一条
`Sec-Ch-Ua-Platform`；值为 `"Google Chrome";v="149", "Chromium";v="149",
"Not)A;Brand";v="24"`、`?0`、`"macOS"`。本地 stealth 重复头回归仍为 3/3，
release build、V8 trace check、no-default check 和 diff check 通过。

**结论**：重复头已在 transport 默认层和自定义层同时消除；不是代理展示问题，也不需要
目标域名逻辑。

### Step 199 — frame 点击屏幕坐标与 proof 轮（2026-09-03，部分完成）

**修复与证据**：`Input.dispatchMouseEvent` 在 frame realm 中保持 local `clientX/Y`，
但 `screenX/Y` 使用页面坐标；iframe 回归报告 `(30,40)` 与 `(140,130)`，符合
`screenX - clientX == screenLeft`。真实轨迹点击产生 frame proof `/fo`（846KB、随后
127KB）和 PAT，但本轮没有顶层 proof 或真实 `/1.txt` 404，仍保持未通过。

### Step 200 — Client-Hints 最终 wire 验证与 404 续测（2026-09-03，部分完成）

**证据**：最终 trace-patched release 经 `http://192.168.3.57:9000` 访问
`https://www.thelancet.com/1.txt`，使用 Chromium/Not)A;Brand、`149.0.7827.0`、
`zh-CN,zh`、arm/64、6/16 profile；HTTP/2 请求头已按大小写归一化且 `sec-ch-ua` 只剩
一条。多段 mouseMoved + click 仍完成 frame `/fo`、PAT 和 proof frame，但没有稳定出现
top proof/clearance，页面保持 challenge，真实 404 尚未取得。

**结论**：重复头问题已排除；当前阻塞是 Cloudflare proof 判定和 Brunhild 代理返回 502，
继续修复必须有新的 Chrome/Obscura 明文差异证据，不能用重试或域名特判伪造 404。

### Step 201 — closed-shadow widget 命中与 proof 事件链（2026-09-03，部分完成）

**证据**：旧固定坐标 `(214,335)` 在不同 ray 中会落到 frame body；等待 frame 后读取当前
300×65 容器并点击 local `(20,31)`，`Input.dispatchMouseEvent` 命中
`frame-page-1-1` 的 node=453。修复后的跨 frame click 保持 `client=(20,31)`、页面
`screen=(212,311)`，不再产生 Chrome 对拍中的 `[object Element]`/`-9,-20.5` body 事件。

同轮请求序列稳定出现 frame `/fo` 846KB、PAT `401`、frame proof `127KB`、frame proof
约 5.1KB 和顶层转发约 3.2KB；随后页面仍停在 challenge，未取得真实 `/1.txt` `404`。

**结论**：点击目标/坐标转换已从通用 CDP 命中链修正，第三个 proof `/fo` 可触发；剩余拒绝
发生在 Cloudflare clearance 判定或 Brunhild 网络条件，不能继续归因于 iframe CSP/点击缺失。

### Step 202 — CDP click 的 PointerEvent 语义（2026-09-03，代码修复完成）

**假设**：Obscura 将物理 CDP click 生成为 `MouseEvent`，而 Chrome 的 pointer-derived
`click` 是 `PointerEvent`；Cloudflare 会读取 `pointerType`、`pointerId`、角度、压力和
`isPrimary`，缺失会使 proof 事件桶退化。

**修复与证据**：`Input.dispatchMouseEvent` 的 click 改用完整 `PointerEvent`，保留
trusted/composed、local client 与 page screen 坐标，并填充 `pointerType=mouse`、
`isPrimary=true`、`pointerId`、`altitudeAngle=PI/2`、`azimuthAngle=0`、tilt/twist/pressure。
完整 `input_mouse_event_parity` release nextest `19/19 passed`。真实轮在正确命中 input 后
产生 frame proof 与 top 转发，但仍未收到真实 `/1.txt` 404。

**结论**：点击事件 shape 已与 Chrome 对齐；当前未决仍是 Cloudflare proof/clearance 判定，
不能把 challenge 文案当成功。

### Step 203 — 组合 CA、Body brand 与 Chrome click 坐标（2026-09-03，调查中）

**假设**：旁路代理直连 `brunhild` 时，`SSL_CERT_FILE` 只提供 Reqable CA，覆盖了 wreq 的公网根证书；
同时 proof payload 的相关目标仍可能把 `HTMLBodyElement` 报成通用 `Element`，或因点击点不同而分叉。

**方法与证据**：对 `wreq` 的信任库先加载系统默认 roots，再追加 `SSL_CERT_FILE`/`SSL_CERT_DIR` 的 PEM/DER；
新增独立 `HTMLBodyElement` wrapper 与 body brand 回归。使用 Chrome payload-3 对齐 frame-local `(29,28)` 点击，
明文事件字段与 Chrome 一致：`client=(29,28)`、`offset=(20,7)`、`pointerType=mouse`、
`altitudeAngle=PI/2`、目标 `[object HTMLInputElement]`。同一轮请求链为 frame proof `200`、
Brunhild `/i` `204`、PAT `401`、frame proof `200`、top proof `200`；之前的
`CERTIFICATE_VERIFY_FAILED` 已消失。

**回归**：`webidl_branding_keeps_native_to_string_and_prototype_chains` 通过；HTTP/2 wire 上
`Sec-Ch-Ua`/`Sec-Ch-Ua-Mobile`/`Sec-Ch-Ua-Platform` 各一条且结构化值保留双引号；最终 release build、
`vendor/v8-trace.sh check`、no-default check 和 `git diff --check` 通过。

**结论**：证书组合、body brand 和点击坐标均已完成通用修复，但该轮在 top proof 后仍未收到
`https://www.thelancet.com/1.txt` 的真实 `404`，页面继续换 ray/challenge。剩余阻塞限定在 Cloudflare
clearance 判定或其外部会话条件，不加入站点特判或 payload 硬编码。

### Step 204 — closed-shadow label sibling activation（2026-09-03，调查中）

**假设**：renderer 命中 `span[aria-hidden=true]` 时，closed-shadow 的 composed parent 虽为
`label`，但 label 的 light-DOM children 为空；仅调用 `label.querySelector()` 找不到实际 checkbox，
click 因而落到 frame `BODY`。

**方法与证据**：debug hit-test 显示 node=452 的 `parent=label(450)`、`next_sibling=453`，frame root
的普通 `input` 查询为空。新增通用 sibling labelable 控件解析，沿 `nextElementSibling/nextSibling`
寻找 `input/button/select/textarea`，不包含站点或 challenge 字符串。最新 release 轮的 payload click
字段为 `[object HTMLInputElement]`，`client=(29,28)`、`offset=(20,7)`，并完整发出 frame proof、
Brunhild `/i` `204`、PAT、frame proof 和 top proof。

**回归与未决**：`input_label_activation` 与 `input_mouse_event_parity` 共 `23/23` 通过；workspace
release nextest `1725/1725 passed, 5 skipped`。proof 响应确实各携带一个 `cf_clearance` Set-Cookie，
但最终 URL 仍未收到真实 `404`，页面继续进入新的 ray/challenge。当前剩余问题是 Cloudflare 对
clearance 的判定/会话条件，不能继续归因于 iframe CSP 或 click target。

### Step 205 — pointer activation 与真实代理 Cookie 闭环（2026-09-03，调查中）

**假设**：点击前的 `mouseMoved` 预先分配 pointerId，导致后续首次 `mousePressed` 使用 ID=2；同时需要确认
真实代理下 proof 写入的 clearance 是否会随下一次 `/1.txt` 导航发送。

**修复与证据**：pointerId 状态机现在让首次 hover + press 共享 ID=1，释放后下一次按下才递增；现有
`click_pointer_ids_increment_per_activation_and_pair_within_a_cycle` 与 click metadata 回归均通过。使用
`http://192.168.3.57:9000`（所有主机统一走该代理）和 Reqable CA 复测，frame proof/top proof 均返回 200，
`cf_clearance` 已存储且后续 `/1.txt` 导航明确携带 `cf_clearance` 与 `cf_chl_rc_ni`；PAT 仍为 401（与 Chrome 参考一致）。
对齐 Chrome payload-3 的 frame-local `(29,28)` 后，click 的 `client/offset/pointerId/isPrimary` 分别为
`(29,28)/(20,7)/1/false`，但 Cloudflare 仍上报 `fail 600010` 并换 ray，未得到真实 404。

**结论**：pointerId 与 CookieJar 不是当前 404 阻塞；`isPrimary=false` 的 payload 对拍实验也未改变结果。
临时响应体和事件探针已移除，继续禁止域名特判、payload 硬编码或伪造 404。

### Step 206 — payload 事件整数化、硬件画像 A/B 与 V8 lookup trace（2026-09-03，调查中）

**假设**：Chrome payload-3 中 `layerY=7`、`offsetY=8`，而 Obscura 两者均为 `7.5`；同时
`navigator.hardwareConcurrency/deviceMemory` 的 Chrome 值为 `6/16`，可能影响 proof 判定。

**修复与证据**：拆分 MouseEvent 的 layer/offset getter，layer 坐标取 floor、offset 坐标四舍五入，
使 click payload 的 `client=(29,28)`、`layer/offset=(20,7)/(20,8)`、`pointerId=1`、`isPrimary=false`
与 `assets/payload/3.json` 对齐。使用 `--fingerprint` 固定 Chrome payload 的两品牌、149.0.7827.0、
arm/64、macOS 26.4.0、硬件 `6/16` 后，V8 property-lookup trace 记录到 widget 对 click 的完整
`eventPhase/isPrimary/pointerId/pressure/geometry` 读取；没有出现缺失的事件 getter。请求仍完整经过
frame `/fo`、Brunhild `/i`、PAT `401`、proof/top proof，随后换 ray 并上报 `fail 600010`，无真实 404。

同时将导航 `Accept-Encoding` 顺序统一为 Chrome 参考的 `gzip, deflate, br, zstd`；`httpbin` 实测
`Sec-Ch-Ua`、`Sec-Ch-Ua-Mobile`、`Sec-Ch-Ua-Platform` 各一条且引号正确。

**结论**：硬件 `6/16` 和事件 layer/offset 修复均未改变 Cloudflare 最终判定；当前剩余差异限定为
宿主屏幕/布局坐标、时间戳及服务端会话条件，继续禁止站点特判和 payload 硬编码。

**对照补充**：同一代理、同一 `(29,28)` 点击流程在本机 Chrome 152 也只到 `interactiveBegin`，
35 秒内没有 `interactiveEnd` 或真实 `/1.txt` 响应。该轮确认远端代理/Cloudflare 会话状态会独立
阻塞成功判据，不能把 Obscura 的 `600010` 单独解释成 CSP 缺陷；后续仍以 Chrome 与 Obscura 同轮
请求序列和明文 payload 差异为准。

### Step 207 — Critical-CH 的 UA 别名补齐（2026-09-03，调查中）

**假设**：目标响应的 `Accept-CH/Critical-CH` 同时列出 `UA-*` 与 `Sec-CH-*`，而请求层遗漏
`ua-full-version-list`，使重试导航缺少完整版本列表。

**修复与证据**：`client_hint_value` 现在把 `ua-full-version-list` 映射到 fingerprint 的
`fullVersionList`，与 `sec-ch-ua-full-version-list` 共用格式和去重路径；wreq Critical-CH fixture
新增该别名并断言重试请求包含 Chromium/Not)A;Brand 的完整版本值。真实响应列出的全部 UA 别名均可由
同一 fingerprint 生成，`Sec-Ch-Ua*` 仍保持单条。

**结论**：该请求层缺口已修复且 focused nextest 通过，但真实页面仍在 frame proof/PAT 后换 ray；
Chrome 同代理对照同样未达成 404，当前阻塞仍不是 iframe CSP 或 Client-Hints 重复。

### Step 208 — iframe 窗口几何残差复核（2026-09-03，未决）

**证据**：当前 release 的 fresh `gsLi5` payload 仍将 widget realm 的
`screenX/screenY/screenLeft/screenTop/innerWidth/innerHeight` 归入 `0` 桶，且 outer/screen 值为
`1440/900`；Chrome payload-3 对应为窗口原点 `22/51`、outer `1200x1120`、screen `1720x1284`。
这与 profile 早期 step 90 的差异一致，说明该面尚未完全收敛。

**判断**：窗口原点和屏幕尺寸属于宿主窗口事实，会随真实 Chrome 窗口/显示器变化；当前不能把一次
Chrome payload 的常数硬编码为默认值。下一步应从 CDP viewport/window metrics 或显式 fingerprint schema
提供可配置的 screen/outer/origin 值，并验证 `screenX + clientX` 等不变式后再改代码。

**结论**：该几何差异保留为新的通用环境候选，但尚无证据证明它单独导致 `600010`；本轮不加入站点特判。

### Step 209 — 可配置 iframe/窗口 screen metrics（2026-09-03，代码完成）

**修复**：扩展 `ScreenFingerprint`，增加可选 `outerWidth`、`outerHeight`、`screenX`、`screenY` 字段；
bootstrap 在没有 CDP screen override 时使用这些值，并让 `screenLeft/screenTop` 与窗口原点保持一致。
零值继续回退历史 maximized-window 计算，因此现有调用方和默认 fingerprint 不变。字段随 fingerprint JSON
传播到主 realm、frame realm 和 Worker。

**回归**：`fingerprint_contract_drives_navigator_ua_ch_and_screen` 固定 `outer=1200x1120`、原点 `22/51`，
确认 JS 暴露值完整；release focused 通过。可用 `--fingerprint` 传入 Chrome payload-3 的宿主窗口 metrics，
不再需要在代码中硬编码显示器常数。

**未决**：该修复提供了宿主事实的传递通道，但当前远端 Cloudflare 会话仍在 proof 后换 ray；尚未证明它单独
改变 `1.txt` 的最终状态码。

### Step 210 — wreq Critical-CH 低熵头去重（2026-09-03，代码完成）

**假设**：目标返回的 `Critical-CH` 同时包含 `Sec-CH-UA` 与 `UA` 别名；wreq 在重试时可能把已由
fingerprint 生成的低熵 `sec-ch-ua` 再 append 一次，造成线上出现两个同名字段。

**修复与证据**：wreq 的 `sent_client_hints` 现在预先记录本次请求已生成的
`sec-ch-ua`、`sec-ch-ua-mobile`、`sec-ch-ua-platform`，重试只追加尚未发送的字段；`ua` 保持独立别名，
不会因已有 `user-agent` 被错误抑制。回归 fixture 同时声明 `Sec-CH-UA` 和 `UA`，确认重试请求中两者各一条，
并保留完整 `UA-Full-Version-List`。经同一代理访问 `httpbin.org/headers`，三个 `Sec-Ch-Ua*` 头各一条且双引号正确。

**结论**：请求层重复头已修复。目标站当前仍返回 Cloudflare `403` challenge；点击后 proof/PAT 链可运行，
但 `brunhild.challenges.cloudflare.com` 经 `192.168.3.57:9000` 稳定返回代理侧 `502`，因此尚未取得真实
`https://www.thelancet.com/1.txt` `404`，不把 challenge 文案当成功。

### Step 211 — 初始跨源 iframe 的隔离状态（2026-09-03，代码完成）

**假设**：Chrome payload-3 的 `crossOriginIsolated` 在 widget 早期采集为 false，而 Obscura 的
初始 `about:blank` frame 继承了顶层 true。该采集发生在网络 iframe 文档提交前，单看最终 frame scope
会遗漏这个时序差异。

**方法与证据**：本机 Chrome 最小测试确认跨源子 frame 即使响应带 COOP/COEP，运行时
`crossOriginIsolated` 仍为 false；同源子 frame 才能在已隔离父文档中保持 true。Obscura 原实现的
`create_blank_iframe_document` 使用全局顶层隔离位，导致嵌套 widget 的初始 realm 暂时错误为 true。

**修复与回归**：初始 frame 现在读取实际父 document scope 的隔离位，并根据 iframe `src` 预判目标 origin；
跨源、data/blob 或 opaque 目标的 transient about:blank 设为 false，实际导航提交仍由响应 COOP/COEP 和父文档
重新计算。同源/无 src 的 about:blank 保持父文档语义。`initial_cross_origin_iframe_about_blank_is_not_isolated`
及 `cross_origin_child_cannot_enable_cross_origin_isolation` 通过；最新 payload 已显示
`crossOriginIsolated` 位于 `F` 桶，与 Chrome 对齐。

**结论**：iframe 隔离状态的时序和跨源语义已修复，未加入站点特判。真实 `/1.txt` 仍因代理侧 Brunhild `502`
无法取得 404，当前 challenge 结果不足以继续归因于 CSP/iframe 环境。

### Step 212 — 嵌套 iframe 初始隔离位继承（2026-09-03，代码完成）

**证据**：Step 211 的跨源 `src` 预判仍使用全局顶层 `gs.cross_origin_isolated`。Cloudflare widget
先创建跨源网络 frame，再在其中创建 `about:srcdoc`；该嵌套 frame 的早期 payload 仍可能看到顶层 true，
即使父 widget scope 已经是 false。

**修复**：`create_blank_iframe_document` 现在从实际 `parent_scope.cross_origin_isolated` 取父 frame
状态，再结合 `src` 与父 origin 判断 transient about:blank。嵌套 widget/srcdoc 不再从顶层泄漏隔离位；
同源和无 `src` 的 about:blank 仍保留父文档语义。

**回归与结果**：`initial_cross_origin_iframe_about_blank_is_not_isolated`、
`cross_origin_child_cannot_enable_cross_origin_isolation` 及 frame CSP 测试通过；目标 payload 的
widget `crossOriginIsolated` 已稳定落在 Chrome 一致的 `F` 桶。无预注入点击仍能执行 frame proof/PAT/top
proof 链，但当前代理的 Brunhild 服务返回 `502`，尚未出现真实 `/1.txt` `404`。

### Step 213 — screen.availTop/availLeft 宿主指标（2026-09-03，代码完成）

**证据**：Chrome payload-3 将 `screen.availTop` 归入值桶 `30`，而 Obscura 原先的 Screen getter
始终返回 `0`。该差异来自显示器工作区，不属于 iframe 或站点逻辑，但会进入 challenge 的屏幕指纹。

**修复与回归**：`ScreenFingerprint` 增加可选 `availTop`/`availLeft`，Screen 实例把值保存在隐藏
symbol slots 中，主 realm、frame realm 和 worker 均从同一 fingerprint 读取；默认值仍为零。runtime
fingerprint contract 已用 `availTop=30` 验证 `[screen.availTop, screen.availLeft] == [30, 0]`，不会增加
`Object.getOwnPropertyNames(screen)` 泄漏。

**结论**：宿主工作区指标现在可显式对齐真实 Chrome；目标 challenge 的剩余失败仍是上游 proof 会话，
不能把缺失屏幕常数硬编码为全局默认。

### Step 214 — 初始 about:blank 的 BackCompat 时序（2026-09-03，代码完成）

**证据**：Chrome payload-3 的早期 frame 桶将 `d.compatMode` 记为 `BackCompat`。Obscura 在 iframe
插入同步阶段把 `create_blank_iframe_document` 的 scope 强制写成 `quirks=false`，因此 author/challenge
脚本在异步导航提交前读到 `CSS1Compat`；后续文档提交才会改回正确模式。

**修复与回归**：初始 `about:blank` scope 现在从插入时即标记为 quirks/`BackCompat`，后续 network/srcdoc
导航仍以实际 HTML parser 结果覆盖。新增 `initial_about_blank_iframe_is_back_compat_synchronously`，
并与跨源隔离、frame CSP 回归一起通过。最新目标 payload 的 `d.compatMode` 已落入 `BackCompat` 桶。

**结论**：初始 iframe 文档的兼容模式时序已与 Chrome 对齐；真实 404 仍等待 Brunhild proof 服务恢复，
不引入站点或 challenge 特判。

### Step 215 — compatMode 修复后的真实点击验收（2026-09-03，外部阻塞）

**方法与证据**：使用完整 Chrome 参考画像（`zh-CN`、单语言、DPR1、`availTop=30`、窗口
`1200x1120`、原点 `22,51`）和原始代理 `http://192.168.3.57:9000`，通过 CDP 物理坐标
`(213,335)` 点击 widget。`op_fetch_url` 日志显示 frame proof `200`、PAT 请求被发起，但
Brunhild `/i` 只有 `called` 没有 `completed`；`Network.responseReceived` 只收到初始
`https://www.thelancet.com/1.txt` `403`，没有第二次 `/1.txt` 导航或 `404`。

**结论**：compatMode、crossOriginIsolated、screen 工作区和请求头修复均未引入新的页面断点；
当前唯一未决是代理到 Brunhild proof 服务的连接超时/路由（该主机经代理返回 `502`，直连边缘返回
`522`）。在该外部条件恢复前不能宣称真实 404，也不加入伪造响应或主机特判。

### Step 216 — widget 嵌套 srcdoc origin 测量边界（2026-09-03，未决）

**证据**：当前 CDP frame tree 中网络 widget frame 的 `origin=https://challenges.cloudflare.com`、
`compatMode=CSS1Compat`；其 closed-shadow 内嵌 `about:srcdoc` 不能通过普通 `querySelectorAll` 枚举，
独立 frame context 读取到 `origin=null`、`BackCompat`。payload 的 `o.origin`/`d.compatMode` 由 challenge
在多个 realm/时刻采集，不能把单个值桶直接归属到某一层 iframe。

**结论**：现有 sandbox/opaque-origin 实现保留浏览器规范语义，未发现足够证据继续修改。该测量边界不改变
Step 214 的 `BackCompat` 修复，也不改变当前 Brunhild 代理 `502` 的真实 404 阻塞。

### Step 217 — frame Fetch Metadata 与 stealth 传输（2026-09-03，代码完成）

**假设**：网络 iframe 导航复用顶层 `ResourceRequest::navigation()`，会发送
`Sec-Fetch-Site: none`、`Sec-Fetch-Dest: document` 和 `Sec-Fetch-User: ?1`，且在 stealth 页面中
仍走 reqwest；这与 Chrome/HaHaVM-General 的 iframe 请求 profile 不一致。

**修复与回归**：新增独立 frame document API，携带父文档 initiator，发送 `Sec-Fetch-Dest: iframe`，
跳过 `Sec-Fetch-User`。stealth 模式下 GET 网络 iframe 改走 wreq，复用 TLS/HTTP2 指纹和 cookie jar；
POST frame 保持 reqwest。reqwest 与 wreq fixture、browser frame navigation 测试均通过。

**结论**：该通用环境差异已修复，顶层导航头部未改变；真实目标仍需外部 proof 服务可达才能验证后续
`/1.txt` 404。

### Step 218 — frame profile 真实站复测（2026-09-03，外部阻塞）

**证据**：重新构建 trace-patched release 后，`/1.txt` 物理点击仍完成 frame/top `fo=200` 并写入
`cf_clearance`，PAT 为 `401`；Brunhild `/i` 经 `http://192.168.3.57:9000` 没有完成响应，页面换 ray。

**结论**：frame profile 和 stealth 传输修复没有引入回归，但当前代理对 Brunhild 的 `502`/无响应仍是
真实 `404` 验收的外部阻断，不能用伪造响应替代。

### Step 219 — 当前 release 早期求值与 Brunhild DNS 复核（2026-09-05，外部阻塞）

**方法**：使用当前 trace-patched release serve，在不修改页面对象的前提下运行
`cdp_filmstrip.py --start 1 --every 1`，并用 `RUST_LOG=obscura_js=debug` 的通信探针记录请求状态；随后
通过 DNS-over-HTTPS 和直连 TLS 独立检查 `brunhild.challenges.cloudflare.com`，避免把旧探针盲区当作引擎
缺陷。

**证据**：早期首个 `Runtime.evaluate` 在 1 秒落地后，页面仍保持 `Just a moment...`、widget frame
`300x65@192,304`，后续截图和 frame 元数据均非空；该现象不再复现旧记录中的“永久空文档”。真实点击仍完整
产生顶层/frame `/fo`、PAT `401`、proof `/fo` 和 `fail 600010`，但 `brunhild/.../i` 在约 1.1 秒于 Connect
阶段失败。系统 DNS 和 `https://1.1.1.1/dns-query` 均显示该主机没有 A 记录；直连 TLS 返回
`SSL_ERROR_SYSCALL`。`challenges.cloudflare.com` 与 `hagen.challenges.cloudflare.com` 可解析，说明失败
集中在 Brunhild 上游路由而非 iframe CSP 或 frame realm 请求归属。

**结论**：早期求值清空文档应从当前未决缺陷列表移除（现有导航并发路径已覆盖）；真实 `/1.txt` 404 仍需
能解析并转发 Brunhild 的外部网络条件。禁止在 Obscura 中加入 Brunhild hostname 特判、伪造 DNS 或伪造
clearance 作为验收替代。

### Step 220 — Brunhild edge-IP A/B（2026-09-05，外部阻塞）

**方法**：不改变 Obscura 代码或请求 URL，仅使用 `curl --resolve` 将
`brunhild.challenges.cloudflare.com` 的 TLS 连接临时送到 Cloudflare edge IP，并对比
`challenges.cloudflare.com` 的已知可用 edge。

**证据**：`104.18.8.208`、`104.18.9.208`、`104.18.94.41`、`104.18.95.41` 均返回 Cloudflare
`HTTP/2 522`；Brunhild 的 DoH 查询仍没有 A 记录。该结果与 Obscura 日志中的 Connect failure
一致，且不涉及 CSP、frame origin 或请求头生成。

**结论**：即使绕过本机 fake-DNS，Brunhild 仍没有可用的上游响应；当前真实 `/1.txt` 404 验收需要
外部提供可工作的 Brunhild proof 路由，不能由引擎内加入域名映射或伪造响应解决。

### Step 221 — SecurityPolicyViolationEvent WebIDL 对齐（2026-09-05，代码完成）

**假设**：HaHaVM-General 暴露 `SecurityPolicyViolationEvent` 及 `onsecuritypolicyviolation`，而 Obscura
只有接口 shell；CSP 相关代码或页面探针构造该事件时会看到错误的 constructor、brand、prototype 或实例
own-key 形状。

**修复与证据**：新增 WeakMap-backed `SecurityPolicyViolationEvent`，覆盖 Chrome 的 12 个 enumerable
原型 getter、默认值、`[object SecurityPolicyViolationEvent]` brand 和缺少 type 参数时的 `TypeError`。
实例仍只有 Event 的 `isTrusted` own slot。Chrome CDP oracle 与 `security_policy_violation_event_matches_chrome_shape`
focused 回归均通过；该实现不改变资源阻断、frame 导航或 challenge 请求路径。

**真实复测**：最新 release 仍完成 frame/top `/fo`、PAT `401` 和 proof `/fo`，随后因 Brunhild Connect
失败上报 `600010`，没有目标 `/1.txt` 真实 `404`。该结果确认 CSP WebIDL 修复无回归，但最终验收仍受
外部 proof 路由阻断。

### Step 222 - 初始空白文档的 origin、domain 与 referrer（2026-09-06，代码完成）

**假设**：实时枚举中的 `origin=null` 及缺失的 `d.domain`、`d.referrer` 来自初始空白 iframe
没有正确投影创建者文档的环境，而不是应当保留的 sandbox 不透明 origin。

**方法与证据**：指定代理下 source release 实测恢复 47/91 键 console payload。按桶形状识别枚举面、
合并 path-to-bucket 集合并排除 `o.*` 后，参考 2/3 自比零差；当前 1643 路径对参考 1638 路径共 30 差。
本地同一 HTTP fixture 同步创建空白 iframe 和下一层 iframe。Chrome 的 Window origin 两层均为
父 HTTP origin，document.domain 均为父 host；第一层 referrer 是父文档 URL，第二层为 `about:blank`。
Obscura 两层均为 origin `null`、domain/referrer 空字符串。两侧 location.origin 均为 `null`，
adoptedStyleSheets 均为空列表，故后者没有被此 fixture 证实为缺陷。

**根因与边界**：Window origin getter 错读 location.origin；ScopedDocument.domain 错读空白 URL 的 host；
初始文档创建时 referrer 错复制父文档自己的 referrer。应使用已有 scope origin 和创建者 URL，并保持
sandbox 不透明 origin、URL origin 与窗口 origin 的区别。原生 trace 自检通过；完整 console 字符串
已由 host-op trace 捕获，本轮不需要新 trace hook。

**修复与验证**：Window origin 读取已有 document scope 的 origin；ScopedDocument.domain 从该 origin
取 host；初始文档 referrer 使用创建者 URL。新增两层同步 iframe 回归，修复前失败、修复后通过；
独立 sandbox 回归确认 Window/location origin 仍为 `null`、domain 为空、父文档访问被拒。
focused 13/13；首次 workspace 1751/1752（MCP selector 等待超时），该用例单独通过后以两个并发槽完整
复跑 1752/1752、4 skipped。精确 release 构建与 `vendor/v8-trace.sh check` 通过。

本地原生属性 trace 捕获 Document domain/referrer/adoptedStyleSheets 的 GET HIT；WindowProxy origin
读取为 UNKNOWN，不能由该记录推断缺失或实际值，后者由完整 console payload 证明。无额外 getter 执行。
同一离线8-frame fixture交错运行新旧各6轮：旧版 wall 0.48-0.50s、中位0.49s，新版0.49-0.50s、
中位0.495s；RSS分别110854144-115589120与108003328-117440512字节，无超出10%噪声区间的变化。

**真实结果**：指定代理三轮分别得到47/91、47/92、47/91键payload；每轮origin/domain均为challenge
源，referrer均为当轮widget URL，枚举路径1643→1645，原始参考差30→28。使用已有fingerprint选项对齐
16项设备/语言/屏幕差异后剩12项，包括3项动态URL/时间、8项额外接口和adoptedStyleSheets。
无preload CDP轮通过截图定位复选框并点击，顶层Document响应序列403→403，仍未取得真实404。

**Obstacle course**：从README指向的公开companion仓库取得6ebac829版33阶段fixture，实际运行31/33。
失败为observer-intersection（期望io:50，实际空）和fingerprint（硬编码Win32，实际MacIntel）；两项均
在保留的修复前二进制复现，属于已有门禁缺口，本轮不报告33/33。

**下一步**：继续对拍 direct op 的请求头、取消时序和 frame isolation；Chrome本地oracle确认Document.prototype.adoptedStyleSheets的enumerable/configurable均为
true，Obscura均为false，可解释直接读取成功但payload枚举缺失。该独立修复尚未实施。

### Step 223 - Document.adoptedStyleSheets枚举描述符（2026-09-06，代码完成）

**假设与证据**：实时payload唯一已证实的缺失文档路径为d.adoptedStyleSheets。Chrome同输入本地oracle
确认Document/ShadowRoot两个prototype的descriptor均为enumerable=true、configurable=true。
Obscura只有Document两项为false；ShadowRoot最终描述符已由bootstrap后续归一处理成正确值。
Document最初defineProperty未设置标志，使该访问器不可配置，后续归一也无法修正。

**修复范围**：只补Document访问器的两个WebIDL标志。现有stylesheet adoption回归增加for-in可见性和
描述符检查，并继续验证数组identity、跨root更新及真实cascade。暂不调整ShadowRoot或样式算法。

**门禁复核补充**：companion的observer-intersection fixture在真实Chrome152中3秒后也为marker空、
cards=10，无法达到其io:50断言。fixture只observe同一个sentinel一次，却期待持续交付相同相交状态；
该预期不符合IntersectionObserver的阈值通知机制。另一失败固定Win32，与本机Chrome的MacIntel亦不符。
原始harness结果仍如实记录31/33，未更改fixture或引擎行为来制造通过。

**验证**：adoption focused3/3，完整workspace1752/1752、4 skipped。原生trace本地fixture中getter
仍为GET HIT，直接读取与for-in枚举均正确；三个真实aligned payload都新增d.adoptedStyleSheets，
落入与Chrome相同的空字符串桶，路径1645→1646，对旧参考差12→11。剩余为动态referrer/baseURI/
lastModified及8个额外接口；本机Chrome152也具备这8个接口，因此不能据旧Chrome149样本直接判定
这些接口为引擎缺陷或删除它们。枚举面不是全部payload行为对齐的充分条件。

**实际点击**：无preload、用已验证截图坐标(213,313)发送CDP输入，触发proof及顶层重新导航；目标
Document响应仍为403→403，最终title仍是挑战页。真实404尚未取得。
精确release构建及最终trace check通过；最终原始obstacle harness仍为31/33，失败项与Step222及Chrome
oracle一致。该门禁缺口保留在记录中，不以成功的单元测试替代33/33要求。

### Step 224 - fetch传输错误类型（2026-09-06，代码完成）

**假设**：Chrome将网络/DNS失败暴露为 `TypeError: Failed to fetch`，而Obscura的wreq op错误直接
穿透为普通 `Error`；challenge的 `tQcZu4=fetch_error` 与Chrome的 `timeout` 可能受到该类型差异影响。

**证据与修复**：固定允许私网的拒绝端口回归在修复前得到 `Error/Error/error sending request`，
修复后得到 `TypeError/TypeError/Failed to fetch`。bootstrap只捕获transport op异常并归一化；已解析的
Abort、CSP blocked和正常Response路径保持原有语义。修复提交为 `d9f5000`，focused test通过。

**限制**：Brunhild请求在当前代理上仍是未完成连接，不能仅凭其最终 `fetch_error` 证明类型修复
会让Cloudflare发放clearance；需以重建后的真实payload和目标Document状态复核。

**真实复测**：重建 release 后指定代理无注入轮仍为 `tQcZu4=fetch_error`，日志显示 Brunhild GET
持续 pending，payload 的页面超时分支先完成，未进入 transport rejection。因此没有把 `fetch_error`
强行映射成 `timeout`，也没有修改网络超时或加入域名特判。

### Step 227 - Brunhild 通信归属与 timeout 分支（2026-09-06，调查中）

**方法与证据**：当前 release 的全 realm `cdp_comm_probe.py` 记录 widget XHR/fetch 在 t=0.75s
和 t=5.86s 由其 `px` handler 构造，`interactiveBegin` 在 t=8.87s；点击后 proof `/fo` 返回
200 并触发新的顶层 ray。Brunhild `/i` 只出现在 Rust `op_fetch_url`/`stealth_fetch request`，
没有 JS hook completion 或 caller。

**结论**：`tQcZu4=fetch_error` 来自 Brunhild 外部连接 pending 时页面自己的超时/失败汇总，不能归因
于 XHR timeout。当前 V8 trace 能记录属性 GET/SET/HAS 和 host-op 请求，但不能捕获 direct
`op_fetch_url` 的 JS caller 或 postMessage payload；这是已记录的能力边界，不伪造 trace 事件。

**网络 A/B**：同代理直接请求本轮 Brunhild URL 返回 `HTTP/2 502`（mitmproxy）；存档的 Chrome
headful click HAR 曾对 Brunhild 请求收到 `204`。这解释了当前 Chrome/Obscura 都无法完成 proof
路由的外部差异，不能通过 Obscura hostname 特判、伪造响应或修改 clearance 判据解决。

**Frame isolation 复核**：真实 Chrome Turnstile frame 自身带 COOP/COEP/CORP，读取为
`crossOriginIsolated=true`、`SharedArrayBuffer=function`；Obscura frame 为 `false/undefined`。
本地 HTTPS 跨站 fixture 中 top/child 同样带 COOP/COEP/CORP，Chrome child 仍为
`false/undefined`，因此目前证据矛盾，不能放宽 `frame_response_grants_cross_origin_isolation` 的
同源条件。该差异留待更完整的跨站响应策略 oracle。

**frame isolation oracle**：真实 Chrome Turnstile frame（自身 COOP/COEP/CORP）读取为
`crossOriginIsolated=true`、`SharedArrayBuffer=function`，Obscura frame 为 `false/undefined`。
但本地 HTTPS 双端口 fixture 中 top/child 均带 COOP+COEP（child 另带 CORP）时 Chrome child 仍为
`false/undefined`；因此不能仅凭 Cloudflare frame 的单一结果放宽现有
`frame_response_grants_cross_origin_isolation` 同源条件。需下一轮用跨站 HTTPS fixture/完整响应策略
继续归因，当前不改 isolation 规则。

**后续 oracle**：固定本地延迟响应服务器配合 `AbortController` 证明 Obscura 原先完全忽略 fetch
的 `signal`，请求在 30ms abort 后仍等到响应；Chrome 在相同输入立即拒绝 `AbortError`。
现以 Promise.race 连接 signal 与 transport op，并清理 abort listener；默认 reason 对齐为
`This operation was aborted`。transport failure 和 abort focused 各 1/1 通过，提交为 `c24378a`。
其workspace、release、trace check与代理复测已完成；tQcZu4仍未迁移。

### Step 226 - XHR timeout取消底层请求（2026-09-06，代码完成）

**假设**：XHR timeout 只派发了 `timeout/loadend`，没有取消内部 fetch；这会让 Brunhild 请求继续
pending，并使页面自己的结果与 Chrome 的 timeout 分支不同。

**修复与证据**：每个 XHR send 创建 AbortController，timeout 和 abort() 调用 controller.abort()，
成功、错误和超时路径清理 controller。延迟 HTTP fixture 的 readyState/status/ontimeout 回归通过；
与 fetch AbortSignal 回归合计 3/3。代码提交为 `14cdec8`。

**验证**：完整 workspace `1755/1755 passed, 4 skipped`，精确 release 和 trace check 通过。
指定代理无注入新轮仍为 `tQcZu4=fetch_error`；Brunhild GET 没有 completion，页面超时先结束，
因此该修复没有把外部 pending 连接伪造成 `timeout`，目标仍未返回真实 404。

### Step 231 - 最新 release 代理复测（2026-09-06，调查中）

最新 release 指定代理无注入轮取得两个 console payload；Brunhild GET 仍无 completion，PAT 401 和
`/fo` 200 正常。`tQcZu4` 仍为 `fetch_error`，目标 `/1.txt` 仍 403。与 Step 227/228 的 direct-op
证据一致，当前没有新的可安全修改的 fetch/XHR 或 V8 trace 缺陷。

### Step 232 - Brunhild 请求头 CDP 对拍（2026-09-06，证据完成）

**方法**：在本地 HTTPS 页面中用 Chrome CDP 直接 `fetch` 历史 Brunhild URL，捕获
`Network.requestWillBeSentExtraInfo`，与 Obscura `stealth_fetch_all` 的请求构造逐项对照。

**证据**：Chrome 实际发送 `Origin`、`Referer`、`Sec-Fetch-Site/Mode/Dest`、Accept-Encoding、
UA 和 UA-CH；Obscura 代码均有对应生成逻辑。可控 Chrome 仍报告自身 152 brands，而本轮页面
显式 UA 是 Chrome 149；Obscura fingerprint 也按 149 生成 brands。该 UA/UA-CH 版本混用属于
测试基线差异，不是单个请求头缺失。历史 Brunhild 204 与当前代理 502 的外部差异仍未改变。

**结论**：本轮没有新的通用 header 修复，也没有修改 V8 trace；direct op 的请求是否完成仍以
Rust host-op 日志为准，页面 payload 仅作为结果证据。

### Step 233 - iframe allow="cross-origin-isolated"（2026-09-06，代码完成）

**假设**：Chrome Turnstile iframe 宿主声明 `allow="cross-origin-isolated; ..."`，Obscura 未保存
`iframe[allow]`，导致 child 即使自身 COOP/COEP/CORP 完整也读作 `crossOriginIsolated=false`。

**修复**：`FrameNavigationRequest` 保存 `allow`，frame loader 仅在父文档已 isolation、响应自身
授予 COOP/COEP、allow 属性明确委托且 sandbox 允许同源时启用 child isolation；没有 allow 的
跨源 frame 保持原规则。新增 helper/回归覆盖 allow token 与非匹配 token，focused 通过。
代码待完整门禁和真实 payload 验证。

**验证**：browser focused helper/分支通过；完整 workspace `1755/1755 passed, 4 skipped`，
release 和 `vendor/v8-trace.sh check` 通过。指定代理真实点击轮中，frame payload 的
`crossOriginIsolated`/`SharedArrayBuffer` 差异消失，枚举路径由 1646 增至 1647；proof `/fo`
返回 200，页面保持等待 Brunhild。目标仍未返回 404，修复提交为 `31f82fc`。

### Step 234 - iframe allow origin-list 解析（2026-09-06，代码完成）

`iframe[allow]` 不应只按 feature 名称判断；现在支持裸 token（src origin）、`*`、`'src'`、
`'self'`、显式 URL origin，并在父 Permissions-Policy 明确为 `cross-origin-isolated=()` 时拒绝。
无 allow 的跨源 frame 仍不能启用 isolation。focused、完整 workspace `1755/1755`、release 和
trace check 通过；真实 payload 保持 isolation 对齐，目标仍 403 challenge。

最终 obstacle course 仍为 `31/33`，失败项是既有 fixture 的 IntersectionObserver `io:50` 期望和
Win32 平台固定期望，两项在旧二进制和 Chrome oracle 中同样失败。

### Step 236 - isolated frame cpuPerformance（2026-09-06，代码完成）

**证据**：同 UA Chrome 152 的真实 Turnstile frame 中，`navigator.cpuPerformance` 为 enumerable
prototype getter，`typeof` 为 `number`，payload 桶值为 4；top realm 没有该属性。Obscura frame
此前完全缺失该属性，导致 path 差异。

**修复**：当 frame 自身已通过 COOP/COEP 和 `allow="cross-origin-isolated"` 获得 isolation 后，
安装 native-shaped `Navigator.prototype.cpuPerformance` getter；值按 fingerprint hardwareConcurrency
映射到 1..4，top realm 和非-isolated frame 不安装。focused frame realm 回归通过，修复提交为 `fb217c0`。

**验证**：完整 workspace `1756/1756 passed, 4 skipped`，release 和 trace check 通过。以 Chrome 152
同 UA/viewport/hardware fingerprint 重新采集 payload 后，`n.cpuPerformance` 差异消失，路径集合
`1647 -> 1648`；剩余为动态文档 URL/时间和三个版本相关接口。真实目标仍为 403 challenge。

### Step 237 - cpuPerformance 后真实 challenge 复测（2026-09-06，未通过）

最新 release 指定代理无注入轮取得两个 payload，`tQcZu4=fetch_error`。Brunhild `/i` 仍只有
direct `op_fetch_url`/pending 日志，PAT 401、`/fo` 200 和新 ray 链正常；目标 `/1.txt` 没有真实 404。

### Step 238 - 第三个 payload 点击事件对拍（2026-09-06，修复中）

**方法**：对 Obscura 和 Chrome 使用相同 frame-local 坐标 `(21,31)`，通过 CDP 发送
`mouseMoved -> mouseMoved -> mousePressed -> mouseReleased`，并对比第三 payload 和事件 trace。

**证据**：Obscura 第二→第三 payload 无新增属性路径，但 `gIBpo1` 中两项计数比 Chrome 少 1；
Chrome widget 事件链包含 `focus`、`input`、`blur`，Obscura 只看到 pointer/mouse 与 click。
根因是 `HTMLElement.focus/blur` 不派发事件，checkable input/change 未设置 `composed`，闭合 shadow
root 外的 widget 收不到它们。

**修复**：focus/blur 派发 trusted composed FocusEvent；CDP checkable input/change 设为 composed。
现有 CDP input parity focused 8/8 通过，待全量门禁及新 binary 第三 payload 复测。

### Step 235 - allow 修复后的真实 challenge 轮（2026-09-06，调查中）

最终 release 通过指定代理无注入访问并开启 CDP 条件点击。Turnstile frame owner 的
`allow="cross-origin-isolated; fullscreen; autoplay; keyboard-map; gamepad; xr-spatial-tracking"`
被正确传播后，frame payload 的 `crossOriginIsolated`/`SharedArrayBuffer` 差异归零，路径集合为 1647。
点击在 `interactiveBegin` 后触发 proof `/fo` 200 和顶层新 ray；目标仍未收到真实 `/1.txt` 404。
Brunhild `/i` 只记录 direct `op_fetch_url` 请求且无 completion，当前代理路由仍是外部阻断。

### Step 239 - `gsLi5.o` Window/Navigator/Document 顺序与 named property（2026-09-07，代码完成）

**证据**：新构建的 payload 以 `assets/payload/2-2.json` 的 `1.gsLi5` 为基线，Window、Navigator、
Document、screen 四段顺序逐项一致。此前 Window 的 `history`/`frames`/`top`/`parent`/`frameElement`
因默认 non-enumerable 被推迟，Navigator 的 overlay prototype 把 `modelContext`/`serviceWorker` 等
推到错误位置，`_ScopedDocument.defaultView` 也遮蔽了基类顺序。

**修复**：bootstrap 收尾统一 Window WebIDL namespace 的 enumerable descriptor，补全 GPU 常量顺序，
把 Navigator overlay descriptor 展平到 `Navigator.prototype` 后按 Chrome 表重排，并让 scoped Document
复用基类 `defaultView`。Worker 初始化不再复制页面的 `storage` getter，避免覆盖 Worker 自己的
origin-private storage。Window named access 改为 `Window.prototype` 上的不可枚举 getter；Chrome 只支持
`window[id]`/`id in window`，不会把 `<style id=...>` 列入 Window own keys，因此清除了 payload 中的
`o.UwwC7`。`o.__capHooked`、`o.__cap`、`o.__roots` 也未再出现。

**验证**：`window_named_access_exposes_ids_and_eligible_names`、动态 ID、Navigator own-property 回归
均通过；最新点击轮最后一个 `gsLi5` 的 `o` 数组为 121 项，与 Chrome 参考完全相同。前两个早期提交
没有 `o.event`，属于事件时序差异，不改变已对齐的顺序。目标站仍受 Brunhild 外部路由影响，未将
challenge 文案或伪造 404 当作成功。

### Step 240 - 最新 Chrome 149 `gsLi5` 全量顺序复核（2026-09-08，代码完成）

**证据**：使用最新 release、stealth、macOS Chrome 149 UA、语言/屏幕画像（DPR=1）重新捕获
`/tmp/obscura-payload-2.json`，按结构定位 `gsLi5`，与 `assets/payload/2-2.json` 逐桶比较。两侧
均为 62 个桶，全部嵌套数组的 multiset 完全一致；关键数组的长度和集合为 `o=121`、`N=1164`、
`T=11`、`F=13`、`x=266`。最新一轮 `N` 只出现两个 challenge 自有 `o.*` 名称
(`runProgram`/`dwHkH1`) 的相邻交换，另一次有效轮次顺序相同，未涉及浏览器 surface。此前的 `N` 差异由
大写 WebIDL 构造器错误 enumerable 导致，`screen.orientation`
的 `dispatchEvent/removeEventListener` 也有顺序交换；`T` 的多余 `o.crossOriginIsolated` 与
`o.SharedArrayBuffer` 来自跨源 frame 错误继承隔离状态。

**修复**：全局 WebIDL 构造器统一为 non-enumerable，并为 `ScreenOrientation.prototype` 使用 Chrome
顺序。跨源 frame 即使带 `allow="cross-origin-isolated"` 仍按 Chrome 保持非隔离，只有同源 COOP/COEP
frame 获得隔离；非隔离跨源 frame 的反射面隐藏 8 个实验接口，直接访问仍保留。`Document.head/body`
及 forms/images/links/scripts 等原生 getter 改用内部 selector，避免公开 `querySelector(All)` hook
记录引擎自身的 `body/head/img/form/a[href]` 查询。

**验证**：WebIDL/Window/frame/Document collection focused nextest 全部通过；最新 payload-2 的
`gsLi5` 62/62 桶数组内容 exact，浏览器 surface 数组顺序 exact；仅保留上述 challenge 自有 `o.*`
异步注册交换。`maNnU6` 中由引擎 getter 自发产生的 `body/head/img/form` 等 selector
不再出现，剩余为 challenge 自身的动态 selector。真实站最终响应仍受外部
Brunhild 路由影响，不以 challenge 页面文案代替 404 判据。

### Step 241 - 事件循环运行期间的 frame->main `postMessage`（2026-09-08，代码完成）

**假设**：第二次/第三次 `/cdn-cgi/challenge-platform/h/g/fo/` 完成后，iframe 已调用
`parent.postMessage`，但主文档没有继续执行，是因为主 realm 的异步接收循环尚未启动。现有
`ensure_frame_message_pump` 只在 Rust 队列已经有 `Main` 消息时启动；若页面先进入持续的网络/定时器
事件循环，之后才由 iframe 入队，`Notify` 没有等待者，消息会留在队列中。

**方法**：审计 `op_post_to_parent` 的入队与通知、`_frameMessageRecvLoop` 的 `op_frame_message_recv`
等待关系，并新增一个离线 fixture：先让事件循环开始运行，再由 frame 定时调用
`parent.postMessage`。修复前消息队列有残留、主文档监听器不触发；该场景与现有“入队后再启动事件循环”
的回归不同。

**修复**：首次进入事件循环路径且已有活动 frame realm 时启动主 realm 接收循环，让它先等待 `Notify`；frame 的
`parent/top.postMessage` 在成功入队后安排一个无延迟、ref'd 的 browser tick，确保 unref 接收 op
在事件循环已 idle 时仍会被轮询。frame-targeted `postMessage` 复用同一唤醒路径；target origin、
generation 和 source 校验保持不变。无 iframe 页面不创建该接收 op，避免改变普通页面的事件循环形状。改动位于 `crates/obscura-js/src/runtime.rs` 与
`crates/obscura-js/js/bootstrap.js`，回归位于 `crates/obscura-js/src/realm.rs`。

**量化验证**：修复前新增 fixture 的 frame timer 已执行，但主文档监听器保持 `null`；修复后同一
fixture 收到 `{value:42, origin:"http://example.com", sourceIsFrame:true}`。`obscura-js` 消息/计时器
focused nextest 5/5、`obscura-browser` frame message focused nextest 4/4 通过，`git diff --check`
通过。最终 release 经指定代理真实运行后，`/fo/` 后页面继续显示 `Verification successful. Waiting
for www.thelancet.com to respond`，不再在消息处提前卡死；代理/上游仍未返回目标内容，尚未以 404
判据验收。

### Step 242 - `chrome-2-fo.har` 与失败消息内容对拍（2026-09-08，调查中）

**HAR 基线**：`assets/har/chrome-2-fo.har` 共 12 条请求，Chrome 顺序为
`top fo(200, 2348B) -> Turnstile frame(200) -> frame fo(200, 4674B/845852B)`，随后
`brunhild /i(502)`、`PAT(401)`、`ci(200 image)`、`frame fo(200, 89911B/7164B)`、
`top fo(200, 8898B/3660B)`，最后 `POST /1.txt(404, 2670B/23B)`。HAR 的 frame/top proof
请求均带正确的 frame/top `Origin` 与 `Referer`，最终 top `fo` 响应包含 `cf-chl-out`、
`cf-chl-out-s` 和 `cf_clearance`。

**Obscura 请求证据**：同一 release、stealth、指定代理的 CDP 真点击已完成
`frame fo(845-846KB) -> PAT(401) + brunhild /i -> frame fo(127KB) -> frame fo(约5KB)
-> top fo(约3.2KB)`，proof 响应的 `cf_clearance` 已进入 cookie jar，后续导航也携带。
但导航重新回到新的 `chl_page`，没有 HAR 中的最终 `/1.txt(404)`；这表明消息已推动主文档，
当前阻塞在 Cloudflare 对 proof 的判定，而不是请求完全缺失。

**postMessage 抓包**：不包装 `postMessage/contentWindow`，仅用 CDP 预注入 message listener
并在 TOP/WIDGET realm 记录完整 `origin/data`。本轮 Obscura 消息序列最后为：

```text
TOP <= https://challenges.cloudflare.com
{"source":"cloudflare-challenge","widgetId":"...","event":"interactiveEnd"}
TOP <= https://challenges.cloudflare.com
{"source":"cloudflare-challenge","widgetId":"...","event":"fail",
 "code":"600010","rcV":"...","cfChlOut":"...","cfChlOutS":"..."}
```

没有收到 `event:"complete"` 或 token 字段；`fail` 后主页面仍会转发 top `fo`。该结果与
Chrome 成功判据 `interactiveEnd -> complete + token -> /1.txt(404)` 的差异已明确，下一步继续
对比 proof 事件/请求体和服务端会话条件，禁止伪造 token、clearance 或最终 404。

### Step 243 - `/ci/` 当前请求统计与底层边界（2026-09-08，证据完成）

**问题**：单轮日志中看不到 `/ci/`，是否说明 Obscura 的图像请求没有发送，从而必然导致质询失败。

**方法**：同一 release、stealth、代理和 `https://www.thelancet.com/1.txt`，使用不修改
`Image`、`fetch` 或 `postMessage` 的 CDP 观测，检查 Rust 图像传输 timing；另用 V8 属性 trace
确认未发轮次是否执行 widget 的 `HTMLImageElement.src`。`/ci/` 不经过 `op_fetch_url`，所以不能用
普通 fetch 日志作判据。

**证据**：

1. `assets/har/chrome-2-fo.har` 的第 9 条请求是
   `GET challenges.cloudflare.com/.../h/g/ci/...`，`200 image/png`；它是 Chrome 该轮的
   动态 `new Image().src` 请求。
2. 当前无注入观测的四轮中，两个轮次出现
   `image transport timing handed to the element's realm`，URL 明确包含
   `/cdn-cgi/challenge-platform/h/g/ci/`，响应体分别为 1,730 和 4,372 字节；另外两个轮次
   没有该 timing，也没有 widget 图像 op。相同二进制、代理和入口下行为交替出现，不能归因于
   图像管线固定丢包。
3. 发出 CI 的轮次和未发出的轮次都先完成约 822-846KB 的 widget `/fo`，并出现 PAT `401` 与
   Brunhild `/i`。未发 CI 的点击轮仍继续完成 127KB frame `/fo`、约 5KB frame proof 和
   约 3.2KB top proof；所以 `/ci/` 缺席不会阻止 proof 请求被构造。
4. 图像实现本身在 Rust `op_load_image_metadata` 中按 frame 文档 base/origin 建立
   `ResourceType::Image` 请求，成功响应写入 render cache 并交回 frame realm；已有的
   200 响应、PNG 解码和 `naturalWidth/naturalHeight` 证据覆盖构造、传输和解码三环。
5. 此前独立的无 CI V8 trace 没有 widget `HTMLImageElement.src` 命中，只有顶层 challenge
   文档的 favicon/API 资源（本轮全量 trace 因写盘放大了 API.js 延迟，不作为该四轮样本的计数）。
   这说明根因边界在 Cloudflare JSVMP 的分支选择：该类轮次根本没有执行 `new Image().src`，
   不是 Obscura 在 `op_load_image_metadata` 或 HTTP 层把已构造的请求吞掉。`/ci/` 的发送时机
   受服务端下发 payload/异步分支影响，约有轮间波动；单轮没有 CI 不能证明引擎回归。

**终态对照**：失败轮 TOP realm 最后收到的是
`interactiveBegin -> interactiveEnd -> fail(code:"600010", cfChlOut, cfChlOutS)`，没有
`event:"complete"` 或 token。发出 CI 的轮次同样可能停在 proof 判定，故当前可行动断点仍是
Cloudflare 对 proof 输入/会话的验证，不应伪造 CI、token、clearance 或最终 404 来掩盖该差异。

**剩余风险**：历史调查发现动态辅助 iframe 的 `about:blank`/DOM parity 曾使 challenge 的
JSVMP 分支抛异常；当前同步和 DOMParser skeleton 已有回归，但若后续轮次再次出现
`body === null`，仍需把该异常与 CI 分支做同轮关联。现有证据不足以把它认定为本轮 CI 缺席的确定原因。

### Step 244 - `/fo` 同源 POST 的 Origin 与最终导航 initiator（2026-09-08，代码完成）

**假设**：HAR 中 top/frame 的同源 proof `POST /h/g/fo/` 以及最终 `POST /1.txt` 都带
`Origin`。Obscura 原先只在跨源 CORS 请求上添加 Origin，导致 proof 请求的 wire headers
与 Chrome 不同；顶层表单导航还没有 submitter initiator，因此 `Sec-Fetch-Site` 会落成
`none`。

**修复**：新增统一 `origin_header_required` 规则：所有非 GET/HEAD 请求带 Origin，跨源
CORS GET/HEAD 也带；应用于 reqwest、wreq navigation 和 stealth scripted fetch/XHR。新增
`fetch_document_with_method_referrer_and_initiator`，页面表单 POST 传入上一文档 URL，生成
正确的 Origin 与 `Sec-Fetch-Site: same-origin`。GET、PAT 和 no-cors CI 图片保持原有头部。

**证据**：

1. 修复前日志中同源 top/frame `/fo` 的 `stealth_fetch request` 是 `origin=None`；修复后分别
   为 `Some("https://www.thelancet.com")` 和 `Some("https://challenges.cloudflare.com")`，
   与 HAR 条目 3、5、9、10 一致。
2. 新增 reqwest focused 回归：同源 CORS POST、同源导航 POST 的 Origin、Fetch Metadata
   和表单 Content-Type 均通过；`obscura-net` focused **2/2**。
3. 新 release 真实轮仍完成 `frame /fo(822KB) -> CI -> frame /fo(127KB) -> frame proof
   5160B -> top proof 3240B -> 新 ray`。Origin 差异已消除，但 Cloudflare 仍没有发出
   `complete + token`，所以没有进入 HAR 的最终 `/1.txt` 404；该结果将剩余断点限定在
   proof 内容/服务端会话判定，不把已修复的 header 与 CI 混为同一问题。

### Step 245 - 指定 `/1.txt` 的 clean payload、postMessage 和 V8 trace 复核（2026-09-08，调查中）

**假设**：当前失败可能仍是 `/ci/` 图片未发送、主窗口漏收 widget 消息，或 profile 的语言/时区
只写入 navigator 而没有进入 ICU。需要用指定代理和 URL 做零预注入 payload 轮，再用独立通信和
property trace 轮分离这些问题。

**方法**：使用最新 release、stealth、远程 Reqable CA、代理 `http://192.168.3.57:9000`，访问
`https://www.thelancet.com/1.txt`；指纹为 `profiles/chrome-152.json`，时区为
`OBSCURA_TIMEZONE=Asia/Shanghai`。payload 轮只通过 CDP `Target`/`Input` 导航和固定坐标点击，
不加 preload、不执行 `Runtime.evaluate`；通信轮使用被动 `message` listener、XHR/fetch/img 调用栈；
trace 轮单独启用 `--trace-api-file` 和 `--trace-op-file`，不以其时序或 payload 作判据。

**证据**：

1. clean payload 的初始提交为 47 keys，第二提交为 92 keys、39 parts、160 个探针字段，和
   `assets/payload-2fo/2.json` 的 39 parts/160 字段结构一致。`zIyO8` 为 `MacIntel`、`zh-CN`、6 核、
   16GB；Intl 字段为 `十二月 中国标准时间`、`世界语（乌克兰）`、`21,000万亿`，时区为
   `Asia/Shanghai`。这证明语言/时区没有再形成跨层矛盾。
2. 同一轮 `rPXg2` 明确包含 `/cdn-cgi/challenge-platform/h/g/ci/` 图片 URL，响应成功并记录
   `EazF1/dtkfB9/gtlhH0` timing。此前无 CI 的轮次没有 `HTMLImageElement.src` 命中，说明 CI 是
   Cloudflare JSVMP 的条件分支选择，不是 Obscura 图片 transport 丢请求；不能预先伪造 CI URL。
3. 全 realm 通信轮收到 `interactiveBegin -> interactiveEnd -> fail`，失败消息为
   `code: "600010"` 并带 `cfChlOut/cfChlOutS`。没有 `event: "complete"`、token 或主窗口成功回调。
   Rust debug 同时确认 frame proof `/fo` 和 top proof `/fo` 均返回 200，随后换 ray；因此断点是
   Cloudflare 对 proof 输入/会话的判定，不是 postMessage 接收循环或请求完全缺失。
4. property trace 约 1.8M 行、346MB，在 trace 放大下被 autonomous task budget 终止，未产生可用
   payload。trace 仍记录了 `Document.body/createElement/querySelector/Element.innerHTML/appendChild`
   等正常 DOM 调用，仅 3 个稳定的 Window 随机名 MISS；没有新的、可归因于 Obscura 的 BOM/DOM
   缺失证据。`--trace-api-file` 不能替代无 trace payload 轮。

**修复**：发现 CLI 先调用 `configure_browser_locale()`，后才把 `--fingerprint @file` 写入
`OBSCURA_FINGERPRINT_JSON`，所以 profile 的 `language` 不会影响 V8/ICU。现在 fingerprint 解析
在 locale 初始化前完成，locale 推导顺序为 `OBSCURA_LOCALE`、`OBSCURA_LANGUAGE`、
`OBSCURA_LANGUAGES`、fingerprint profile language/languages；新增
`fingerprint_profile_language_is_used_for_icu_locale` 回归测试。实现位于
`crates/obscura-cli/src/main.rs`。

**验证与结论**：CLI focused nextest 该回归 **1/1**，data URL sanity 显示 `zh-CN`、中文 Intl 和
`Asia/Shanghai`。指定 URL 的 clean 轮仍未得到目标真实 `POST /1.txt -> 404`，所以不能宣称过盾；
当前剩余差异是 proof payload 的动态资源/DOM/字体/渲染字段与 Cloudflare 服务端判定。`/ci/`、
postMessage 接收和 Origin header 均已有正向证据，不再作为当前根因继续修改。

### Step 246 - HaHaVM-General 直连 `/123.txt` 对拍（2026-09-10，完成）

**假设**：HaHaVM-General 的通用 dispatch trace、挑战编排和 Cookie 复用是否能在不使用上游代理的情况下完成一次可验证的源站访问，需要用同一测试 URL 做独立对拍。

**方法与证据**：在 `/Volumes/ZHITAI/projects/HaHaVM-General` 使用 Chrome-emulation TLS 客户端的 direct 模式访问 `https://www.thelancet.com/123.txt`，代理参数为 `direct`，无外部代理。挑战执行产生目标站 `cf_clearance`，随后带 Cookie 重新 GET 同一 URL。运行目录为 `/tmp/hahavm-thelancet-wreq-direct-20260910-013407`；stderr 记录完整请求序列，最终复访 `状态码 : 404`，响应体为 `Missing resource /123.txt`。

**trace 校验**：`trace.jsonl` 共 **33,811** 条记录，JSONL 无损坏行，覆盖 **828** 个 API 名称，其中 **6,002** 条来源栈来自 `www.thelancet.com/123.txt`。日志同时记录目标站 clearance 捕获与最终 404；未发现复访挑战页。

**结论**：HaHaVM-General 本轮满足直连、取得 CK、携带 CK 得到真实源站 404、trace 可读完整的对拍判据。该结果证明 HaHaVM-General 的路径，不改变 Obscura 当前 `/1.txt` 仍未得到 404 的状态；两者不能互相替代。

### Step 247 - HaHaVM 窗口指标对拍与 Obscura 修复（2026-09-10，部分完成）

**假设**：HaHaVM-General 成功 trace 读取 `window.screenX=674`、`screenY=25`；Obscura 在加载 fingerprint profile 后仍可能因 viewport override 将宿主窗口位置回退为零，造成 proof 环境差异。

**修复**：`page-init.js` 现在独立应用 fingerprint 的 `outerWidth/outerHeight/screenX/screenY`，viewport override 只控制 CSS viewport 和 screen 尺寸。新增 `viewport_override_preserves_fingerprinted_window_placement` 回归，验证 `1024x768` viewport 下仍暴露 `2309x1326`、`674,25` 窗口指标。

**证据与限制**：focused nextest 通过，修复后二进制加载 profile 后确实返回 `screenX=674/screenY=25`。使用该 profile 直连真实 `/123.txt` 仍完成 top proof 并换 ray，没有真实 404；因此窗口指标缺陷已闭环，但不是当前唯一的 Cloudflare proof 判定差异。

### Step 248 - HaHaVM TextEncoder CSS map A/B（2026-09-10，证据完成）

**假设**：HaHaVM-General 的 CF 外置补丁将 `TextEncoder.encode("{}")` 替换为 1,150 项 CSS property map；该值级差异可能导致 Obscura 的 proof 被拒绝。

**方法与证据**：只通过 `Page.addScriptToEvaluateOnNewDocument` 临时注入从 HaHaVM-General 提取的 exact CSS map，关闭 shadow/message 探针，使用直连、HaHaVM 窗口画像和固定点击。Obscura 仍完成 widget `/fo`、PAT、frame proof 和 top proof；top proof 为 3240B、返回 200 并写入 clearance，随后页面换 ray，未出现真实 `/123.txt` 404。

**结论**：单独迁移 TextEncoder CSS map 不能使 Obscura 通过 Cloudflare；该补丁不进入通用引擎，剩余差异继续限定在动态 DOM、字体、渲染和整体 proof payload。

### Step 249 - 正确 timezone 与完整 UA-CH 画像复测（2026-09-10，证据完成）

**假设**：旧 Obscura payload 中 `Europe/Berlin`、英文 Intl、`Chrome/149.0.0.0 + Not A Brand/99` 与 Chrome 参考的 `Asia/Shanghai`、中文 Intl、`Chromium/149.0.7827.0 + Not)A;Brand/24` 差异，可能是 proof 被拒绝的直接原因。

**方法与证据**：使用完整 fingerprint overrides（语言、UA-CH、版本、arm/64、硬件 6/16、DPR1、screen/outer/window metrics）和 `OBSCURA_TIMEZONE=Asia/Shanghai` 直连 `/123.txt`。Obscura 的 initial/widget/proof 请求均完成，top proof 返回 200 并写入 clearance；随后仍回到新的 `chl_page`，没有真实 404。

**结论**：timezone、Intl、UA-CH 和窗口画像已与参考 profile 对齐，但未改变 Cloudflare 最终判定；这些差异已排除为唯一阻断。

### Step 250 - HaHaVM Chrome148 TLS platform A/B（2026-09-10，证据完成）

**假设**：HaHaVM-General 的 `wreq::Emulation::Chrome148` 使用默认 Windows platform，而 Obscura stealth client 明确使用 MacOS platform；TLS/HTTP2 指纹差异可能解释 HaHaVM 成功而 Obscura proof 被拒绝。

**方法与证据**：临时将 Obscura stealth emulation platform 改为 Windows，保持 Chrome149 macOS UA、完整 UA-CH/profile、Asia/Shanghai timezone 和直连请求。真实 challenge 仍完成 proof 链并回到 challenge，没有 `/123.txt` 404。

**结论**：TLS platform 不是当前唯一阻断；临时改动已恢复，Obscura 保持 MacOS platform 与显式 UA 一致。

### Step 251 - HaHaVM 无点击成功轮 + payload 语义对拍 + 请求序列定点（2026-09-11，证据完成）

**假设**：HaHaVM-General 能过，Obscura 不能过。此前对拍的观测契约不对称（HaHaVM 有 dispatch 级
方法 trace，Obscura 只有 property/host-op），无法逐字段比。本轮先用同一代理把 HaHaVM 跑成**可复现
的参考基线**，再把两边**提交前的明文 payload** 归一化后逐桶对比，最后用 `RUST_LOG=obscura_js=debug`
拿到 Obscura 完整的请求/响应序列。

**方法与证据**

1. **HaHaVM 参考基线可复现**：`TLS_SERVER=http://127.0.0.1:3001/forward node examples/cloudflare/index.js
   'https://www.thelancet.com/1.txt' 'http://192.168.3.57:9000' 'http://127.0.0.1:3001/forward'`，
   连跑 3 次均在 11–13s 内捕获 `cf_clearance`（`token 到手`），首次直连复访 `状态码: 404`、
   响应体 `Missing resource /1.txt`。落盘 `/tmp/cf-run/haha-trace.jsonl`（33,531 条 dispatch 记录）、
   `/tmp/cf-run/haha-console.jsonl`（812 条，含 3 条 `payloadJSON:` 明文）。
2. **Obscura 基线**：同一代理、同 URL，`--stealth`。拿到 CK 前的请求序列与 payload 结构与 HaHaVM 同构，
   但最终停在挑战页，无 404。
3. **payload 逐桶对拍**（`/tmp/cf-run/payload-semantic-diff.md`、`payload-semantic-map.json`）：
   两边 payload 的 **91 个随机键名完全一致**（同一 challenge variant），可逐键对比。关键方法学结论：
   **数字桶索引 1..38 不是标识**，只有 `1/2/3` 保持下标，`6..38` 是置换、`4`/`5` 整体互换；
   必须按**桶内字段名集合**对齐，否则会产生约 120 条幻影"缺失"差异（旧的 `payload-diff.txt` 即踩此坑）。
   语义来源三条：CF 自带的 `2.gsLi5` 反查索引（值 → 环境表达式）、对 HaHaVM trace 全部字符串做哈希求原像、
   以及 trace 值连接。已确认 7 个框架字段含义，其中 `hCfV6` = 采集器耗时 ms（`TPpkV4 − Vtvy6 == hCfV6` 全量成立）。
4. **结构性差异只有两类**：`4/5` 桶缺 `vqXep1: True`、缺 `neil9`（attestation 返回的 token），
   以及 `tQcZu4` 取值 `timeout`(H) / `fetch_error`(O)。值差异 300+ 条，绝大多数是身份（平台/UA/语言/
   GPU/屏幕）与每次挑战不同的签名 token、epoch 时间戳、采集器耗时。
5. **身份差异被排除**：用 HaHaVM 的完全一致身份复跑 Obscura（`--user-agent` Windows Chrome 148 +
   `OBSCURA_LANGUAGE=en-US` + `OBSCURA_TIMEZONE=UTC`），payload 的 `zIyO8` 变成
   `{platform: Win32, languages: [en-US], hw: 8, mem: 8, UA: Chrome/148}`，与 HaHaVM 一致；
   结果**仍停在挑战页**。同理，用 Chrome HAR 参考的 macOS Chrome 149 + zh-CN 身份也失败。
6. **`/pat/ 401` 与 brunhild 失败均被证伪为阻塞点**：Chrome HAR 第 8 条 `/g/pat/` 是 **401**、
   第 7 条 brunhild `/g/i/` 是 **502**，Chrome 仍然在第 11 条拿到 `cf_clearance` 并在第 12 条得到
   `POST /1.txt → 404`。所以这两项不是判据。
7. **请求序列定点（决定性）**：`RUST_LOG=obscura_js=debug` 下 Obscura 完整发生 7 次 JS fetch/XHR，
   与 Chrome 12 条序列逐条对齐后，**少的正好是最后三跳**：

   | Chrome # | 步骤 | Obscura |
   |---|---|---|
   | 1–8 | 403 → chl_page → api.js → **顶层 fo** → rch iframe → **widget fo** → brunhild 502 → pat 401 | 均已发出，顺序一致 |
   | 9 | `ci` 图片 | **未观察到** |
   | 10 | widget `fo` 第 2 次 | 已发出（t≈12.0s，响应 200） |
   | 11 | **顶层 `fo` 第 2 次** | **缺失** |
   | 12 | `POST /1.txt → 404` | **缺失** |

   关键：**`cf_clearance` 只在第 11 条（第二次顶层 `fo`）的 `set-cookie` 里下发**（Chrome HAR 12 条里
   仅第 11 条带 `cf_clearance`）。Obscura 从不发第 11 条，因此永远拿不到 clearance，也不会出现第 12 条。
   `Network.getAllCookies` 在该轮返回 **0 个 cookie**，与此自洽。
8. **响应体量对比（第二次 widget `fo`）**：Chrome 第 9 条响应（`cf-chl-out` / `cf-chl-out-s`，成功态）
   解码后 **7,164 B**；Obscura 对应请求响应 **127,240 B**（即又被塞回一份挑战产物）。两侧第一次
   widget `fo` 的响应体量是接近的（Chrome 845,852 B / Obscura 823,080 B），说明只有**proof 这一跳**
   被判失败。
9. **观测盲区（必须记住）**：Obscura 的 CDP `Network` 域对 JS fetch/XHR **完全不报**（只报 doc 级），
   且 `page.rs` 两处 `NetworkEvent` 构造点写死 `headers: HashMap::new()`，因此经 CDP 拿不到任何请求头；
   `getResponseBody` 对 `fetch-N` 也失败。任何"Obscura 没发某个请求"的结论都必须改用
   `RUST_LOG=obscura_js=debug` 的 `op_fetch_url called` / `stealth_fetch request|completed` 行来证伪。

**结论**：HaHaVM 参考基线可复现；两边 payload 结构同构（唯一结构差异是 HaHaVM 的 attestation 成功
产物 `neil9`/`vqXep1`，而 Chrome 在 `/pat/ 401` 下也能过，故非判据）；身份差异已用 A/B 排除。
当前**唯一可量化的分叉**是：CF 对 Obscura 的 **widget proof 请求**返回 127KB 的再挑战产物（Chrome 为
7KB 成功产物），导致顶层第二次 `fo` 与最终 `POST /1.txt` 双双不发生。下一步应把该 proof 请求的
**出站请求头与请求体**与 Chrome HAR 第 9 条逐字段对比，而不是继续在环境值上做无证据的改动。

### Step 252 - 反机器人探测面暴露的常量桩与通用修复（2026-09-11，代码完成 / 真实 404 未达成）

**假设**：既然 CF 对 HaHaVM 的假环境照收，环境**取值**本身不构成判据；能构成判据的是
「真实浏览器绝不会产生的值」，其中最典型的一类是把测量结果写成常量的桩。逐字段对拍
（`/tmp/cf-run/payload-semantic-diff.md`）里 `12.kRQwh3`/`oSIr8`/`RKUE0` 三个摘要都是
`sha256('0')`，而在 HaHaVM 的 trace 里对同一批数字求原像得到 `sha256('888')`、
`sha256('0.00888')`、`sha256('5271.15673828125')` —— 说明 Obscura 侧三个测量全部返回 0。

**证据（定位）**：在 `haha-trace.jsonl` 中反查 `888` 的产出者，命中
`{"t":10386,"name":"SVGSVGElement.getComputedTextLength","result":"888"}`。而 Obscura 的实现在
`crates/obscura-js/js/bootstrap/env/media/canvas.js` 把整组 SVG 测量写死：

```js
Element.prototype.getBBox = function() { return { x: 0, y: 0, width: 0, height: 0 }; };
Element.prototype.getComputedTextLength = function() { return 0; };
Element.prototype.getExtentOfChar = function(ch) { return { x: 0, y: 0, width: 0, height: 0 }; };
Element.prototype.getSubStringLength = function(ch, len) { return 0; };
```

CF 的字体/文本探针正是走 `SVGSVGElement.getComputedTextLength()`，恒返回 0 等于告诉对方
「这个环境不渲染文本」。

**修复（通用，无站点特判）**：改为走同一个文本引擎（`_measureTextBox` → `op_canvas_text_metrics`，
与 `canvas.measureText`、元素布局同源），并按元素自身的计算字体（`getComputedStyle` 的
style/weight/size/family）测量；`getBBox` 返回文本框，`getSubStringLength` 按子串，
`getExtentOfChar` 按单字符。

**量化结果**：修复后同一轮 payload 的三个摘要里 `kRQwh3`/`oSIr8` 已从 `sha256('0')`
变为真实测量摘要（`b080ab48…`、`f9c1b64e…`），`RKUE0` 仍为 `sha256('0')`（第三个探针仍未定位）。
独立测量页确认 API 恢复真实值：`svg.getComputedTextLength()=574.4375`、
`text.getBBox()=[0,-14,574.4375,17]`、`getSubStringLength(0,10)=101.34375`、
`canvas.measureText()=574.4375`、隐藏容器内 `574.4375`、`display:none` 的 SVG `277.34375`。

**同轮一并落地的其它通用修复**（均由 Chrome HAR / HaHaVM 双向证据支撑）：

1. **字符串 body 缺 `Content-Type`**：`_serializeBody` 对 USVString body 不设 Content-Type，
   而 Fetch 规范要求 `text/plain;charset=UTF-8`，Chrome 四个 `/fo/` 全带，HaHaVM 的
   `XMLHttpRequest_send` 也显式写死该值。修复后 MITM 抓包确认三个 `/fo/` POST 均已带上。
2. **旧版 Client Hints 头**：CF 的 `Accept-CH`/`Critical-CH` 同时列出 `Sec-CH-UA-*` 与改名前的
   `UA-*`；真实 Chrome 149（HAR 实证）只发 `Sec-CH-UA-*` 并忽略旧名，而 Obscura 两个都发，
   凭空多出 8 个真 Chrome 永不发送的头（`ua`、`ua-arch`、`ua-bitness`、`ua-full-version`、
   `ua-full-version-list`、`ua-model`、`ua-platform`、`ua-platform-version`）。已改为只应答
   `Sec-CH-UA*` 名，`client_hint_value` 不再映射旧别名；`obscura-net` 102/102 通过。
3. **`fetch` 路径丢弃页面发起的导航**：`op_navigate` 只入队，消费点只有 CDP 的两处
   （`Runtime.evaluate` 之后、CDP 点击之后）。`obscura fetch` 在 settle 期间由脚本触发的
   `location.href=`/`form.submit()` 因此永远不提交。已在 `Page::settle` 与 `settle_for_duration`
   的循环里排空 `pending_navigation`（新增 `has_pending_navigation` 窥视接口，不消费队列）。
   受控验证：本地表单页 `fetch --eval 'form.submit()'` 修复前只有 `GET /t.html`，修复后有
   `POST /t.html len=23 body=b'probe_field=probe_value'`。这是拿到最终 404 的必经一步。
4. **跨 realm Error 的 console 呈现**：`tools/dom-query.js` 用 `a instanceof Error` 判定，
   跨 realm（iframe / 挑战自己的 realm）的 Error 落空并降级成 `[object Error]`，丢掉
   `.message`/`.stack`。改为品牌判定 `Object.prototype.toString.call(a) === '[object Error]'`
   ——与旁边那段「只读 Symbol.toStringTag，不触发探测 getter」的既有安全推理一致。

**门禁**：`obscura-net` 102/102、`obscura-browser` 124/124、`obscura-js` 597/597 通过；
release render build 通过。workspace 全量与 trace check 见下一步。

**结论**：本轮把反机器人探测面上「常量即指纹」的一类缺陷（SVG 文本测量）、请求头保真
（Content-Type、旧版 CH）、以及最终导航通路（fetch 路径排空）修掉，并全部有双向证据。
但**真实 `/1.txt` 404 仍未取得**：widget proof 请求的响应依然是 `cf-chl-gen`（再挑战，
127,232 B），而 Chrome 同一跳是 `cf-chl-out`（成功，7,164 B）。已确证 CF 看到的是代理
转发后的 HTTP 层（代理本身是 MITM），因此判据只能来自请求头或请求体；请求头现已与
Chrome 仅剩 `priority: u=1, i`、`sec-fetch-storage-access: active` 两项差距。

### Step 253 - 反机器人探测面第二批通用修复（2026-09-11，代码完成 / 真实 404 仍未达成）

**方法**：对 JS 环境层做「本该返回真实值却写死成常量/空值」的系统审计（静态扫描 + 本地最小页面
逐接口 A/B），修掉其中能成为「真实浏览器绝不会产生的值」的那一类。

**修复（均为通用，无站点特判）**

1. **`getComputedStyle` 对约 128 个标准属性返回 `''`**（`env/css/computed-style.js` 的
   `defaultsKebab` 只有约 50 项，未命中即 `return ''`）。`''` 在 CSSOM 里表示「没有这个属性」，
   于是一个读 `font-style`/`word-spacing`/`text-indent`/`vertical-align`/`text-transform`/
   `list-style-type`/`flex-grow`/`aspect-ratio` 等字体与文本布局属性的探针会被告知该属性不存在。
   已把表补到 Chrome 的计算初始值（`word-spacing: 0px`、`text-indent: 0px`、`vertical-align: baseline`、
   `font-style: normal`、`font-stretch: 100%`、`list-style-type: disc` 等），并加入
   `overflow-x/y`、`min/max-width/height`、`flex-*`、`object-fit`、`touch-action`、`color-scheme`、
   `content-visibility`、`text-shadow`、`outline-*`、`fill/stroke` 等一批。
2. **`position: static` 元素的 `top/left/right/bottom`** 被解析成 `rect` 偏移（Chrome 返回 `auto`）。
   现在只在非 static 时用 rect，否则回落到 `defaultsKebab` 的 `auto`。
3. **性能条目缺 `Symbol.toStringTag`**：`PerformanceEntry`/`Mark`/`Measure`/`ResourceTiming`/
   `NavigationTiming`/`PaintTiming`/`Observer` 等是真实 JS class，不在宿主品牌步骤里，
   于是 `String(entry)` 是 `[object Object]` 而 `constructor.name` 正确 —— 这一对组合任何浏览器都不产生。
   已加入 `config/webidl-branding.js` 名单（仓库自己的 Chrome 表 `surface-finalize.js` 早已声明应有 tag）。
4. **`SVGTextContentElement` 的逐字符位置 API 全部缺失**：`getNumberOfChars`、
   `getStartPositionOfChar`、`getEndPositionOfChar`、`getRotationOfChar`、`getCharNumAtPosition`
   在 Obscura 是 `undefined`，一个按字符遍历文本的探针（挑战正是这样构造它的递增位置列表）
   会收到空列表。已用同一文本引擎（`_measureTextBox` → `op_canvas_text_metrics`）按前缀
   advance 累加实现，并随 `canvas.js` 里已有的四个测量方法一起暴露；接口本身由最后一个
   manifest 模块安装，所以安装点放在 `config/webidl-branding.js`。
   验证：`getStartPositionOfChar(0..3)` = `[[0,0],[10.67,0],[21.34,0],[32.9,0]]`，`getNumberOfChars()=8`。

**同轮证伪（保留，避免重走）**

- **`document.referrer` 不是缺陷**：Obscura 的 frame realm 正确返回嵌入文档 URL
  （实测 `FRAMERef = 父页 URL`，srcdoc 帧亦然，顶层直连为 `''`）。payload 里 top 为 `''` 是正确值。
- **`document.compatMode` 不是缺陷**：CF 的 403 挑战页首行是 `<!DOCTYPE html>`，标准模式，
  Obscura 的 `CSS1Compat` 正确，HaHaVM 的 `BackCompat` 才是伪造值。
- **字体集与平台不一致不是判据**：HaHaVM 用 Windows UA + 纯 macOS 字体列表照样通过，
  该类别的不一致 CF 并不拒绝。
- **`/ci/` 与顶层 `fo` 次数不是判据**：`/ci/` 6 轮中随机出现 2 轮，有无 `/ci/` 的轮次同样失败；
  第二次顶层 `fo` 是 proof 通过后的结果而非原因。
- **`cf-chl` 复用正确**：同一 URL 的两次 POST 逐字节相同，且等于 URL 末段与 brunhild 路径段。

**门禁**：`obscura-net` 102/102、`obscura-browser` 124/124、`obscura-js` 597/597、workspace
`1784/1784`（4 skipped）通过；release render build 通过。

**仍未闭环**：真实 `/1.txt` 仍无 404。CF 对 widget proof 的响应始终是 `cf-chl-gen`
（再挑战，127,232 B），Chrome 同一跳是 `cf-chl-out`（成功，7,164 B）。请求头现已与 Chrome
逐项一致（含 `content-type`、`priority: u=1, i`，且已移除真 Chrome 不会发的 8 个旧版 `UA-*` 头），
因此**判据落在请求体（加密后的 proof payload）**。用 CF 自带的 `2.gsLi5` 反查索引与 HaHaVM
逐桶对拍后，仍为「参考非空而 Obscura 为空/零」的只剩三处：`10.bLvQ6`（递增整数序列，
Obscura 为 `[]`）、`12.RKUE0`（`sha256('0')`，另两个同类摘要已在本轮修复中变成真实值）、
以及 `26.aJofP9`/`urTy2`（bucket 26 = 「digest pair + 两个布尔标志（完整性 / CSP 探针）」，
两边取值相反）。后者是最可疑的一处：一个完整性/CSP 探针给出相反结论，正是「脚本被判定为
被篡改」的形态。下一步应从这三处入手，而不是继续改环境取值。

### Step 254 - widget 的 `reloadApiJsRequest` 被拒：卡点从"proof 被拒"上移到"widget 从未完成"（2026-09-11，证据完成）

**背景**：在此之前所有轮次的观测都指向"顶层 proof 被 CF 拒绝"。本轮用跨 realm 通信探针
（`.claude/skills/obscura-challenge-probe/scripts/cdp_comm_probe.py`，`--no-click`）把 widget 与顶层的
消息时间线与 HaHaVM 的成功轮逐条对比，把卡点上移了一步。

**方法**：`obscura serve --port 9555 --stealth --proxy <代理>`，`RUST_LOG=info`（**必须**：只设
`RUST_LOG=obscura_js=debug` 会把 `obscura::console` 过滤掉，serve 日志里就看不到 `[comm]` 行，
这是本技能文档里记过的观测盲区）。探针 `--start 5 --deadline 60 --settle 45 --no-click`。

**证据（消息时间线对比）**

| 时序 | HaHaVM（通过） | Obscura（失败） |
|---|---|---|
| 1 | `init` (mode: managed) | `init` (mode: managed) |
| 2 | `requestExtraParams` | `requestExtraParams` |
| 3 | `translationInit` | **`reloadApiJsRequest` → `reloadApiJsRejected`** |
| 4 | `execute` | `translationInit` |
| 5 | `meow`/`food` 心跳 seq 2..11 | 两次 widget `XHR POST /fo/` + 一次 `IMG /ci/` |
| 6 | `interactiveBegin` | `interactiveBegin`（t≈9.5s） |
| 7 | `interactiveEnd` | **没有** |
| 8 | **`complete` + token** | **没有** |

即：Obscura 的 widget 在 `interactiveBegin` 之后不再前进，既没有 `interactiveEnd` 也没有
`complete`+token；顶层因此永远不发自己的 proof，`cf_clearance` 也就无从下发。

**根因定位（CF 代码级）**：在 turnstile api.js（`assets/har/chrome-2-fo.har` entry 2）里找到该消息的
处理分支：

```js
case "reloadApiJsRequest":
  if (We("reload", o)) { kt(i.widgetId); break; }      // 该 widget 被 kill 了 reload
  if (cr !== void 0)   { kt(i.widgetId); break; }      // 已有一次 reload 在途
  if (yo())            { kt(i.widgetId); break; }      // 退避窗口内 (Y() < apiJsReloadNextAllowedTsMs)
  ri() ? (g.apiJsMismatchReloadAttempts++, bo(), _o(i.widgetId)) : kt(i.widgetId);
```

`kt()` 发出的正是 `reloadApiJsRejected`。`ri()` 定义为

```js
function ri(){ if (ln(), Qa()) return !1;
               var e = La(window.turnstile, g);
               return e ? !0 : (dn(), !1) }
```

`La(e,t)` 会**用新 URL 替换 api.js 的 `<script>`**（`api.js?_upgrade=true&_cb=<now>`），前置条件是
`xt()` 能找到该 script 元素且它有 `parentNode`，并且 `Oa(window.turnstile)` 是非 null 对象。
本地逐条核实这些前置条件在 Obscura 里**都成立**：解析器建出的 `<script src=...>` 是
`HTMLScriptElement` 实例（`instanceof` 通过）、有 `parentNode`、`async`/`nonce` 可写、
`parentNode.replaceChild` 抛不出异常；`typeof window.turnstile === "object"` 且有
`render/execute/reset/ready/getResponse/remove/isExpired/_private`。因此拒绝来自 `Qa()`
（任一 widget 的 `chlPageData` 非空）或 `cr`/`yo()` 状态，而不是这些前置条件；真正的
**触发点**在 widget 侧——它为什么会认为 api.js 需要 reload（mismatch），尚未定位。

**同轮证伪**

- `apiJsResourceTiming` 里 `transferSize/encodedBodySize/decodedBodySize/responseStatus/nextHopProtocol`
  为 0 或空**不是缺陷**：CF 的 api.js 响应只有 `access-control-allow-origin: *`，没有
  `Timing-Allow-Origin`，跨源资源本来就该被归零；同源资源的同一组字段在 Obscura 里全部真实
  （实测 `nhp="http/1.1"`、`ts=431`、`ebs=dbs=131`、`domainLookup/connect/request/response` 均非零、`ss=200`）。
- 通信探针里 `cs:[[0,129,"Error\n at ki (...) at ke (...) at Object.I [as render]"]]` **不是异常**：
  `ki` 的源码是 `function ki(e,t){try{var r=new Error().stack;return [e,Math.max(0,Math.floor(Y()-t)),r,Ci]}catch(n){}}`，
  即它是一个用 `new Error().stack` 采集调用栈的**计时上报**辅助函数，`cs` 是 widget 发给顶层的时序记录。

**附带修复（本轮落地）**

- `env/html/interface-aliases.js` 把 27 个 `HTML*Element` 整体别名为 `Element`，导致这些接口的**专有 IDL
  属性整批不存在**（本地 oracle 实测 18 项 `in` 恒为 false：`script.integrity/async/defer/crossOrigin/noModule/fetchPriority/blocking`、
  `select.multiple/size`、`textarea.rows/cols/wrap`、`ol.start/reversed`、`option.index` 等）。
  真浏览器里 IDL 属性恒存在，这正是"真实浏览器绝不会产生的值"。已为 script/select/textarea/option/ol/li/label/meta/style/details/dialog/slot/progress/fieldset
  建立真实子类与属性反射，并在 `_elementClassFor` / `_elementClassForKnownName` 注册这些 tag。
  修后 `script.integrity/async/defer/crossOrigin` 等 `in` 全部为 true，且 `async` 正确反射为内容属性。

**结论**：卡点从"顶层 proof 被服务端拒绝"上移到**"widget 在 `interactiveBegin` 后不再前进"**，
其直接表现是 widget 请求重载 turnstile api.js 而被顶层拒绝。下一步应定位 widget 判定
`apiJsMismatch` 的依据（widget 帧代码在 `chrome-2-fo.har` entry 4，429 KB 混淆脚本），
而不是继续调整环境取值。

**撤回记录（同轮）**：为 `HTML*Element` 建立真实子类的改动**已回退**。它确实补齐了缺失的 IDL 属性，
但 `HTMLScriptElement.prototype` 上的 `src`/`text`/`async` 会**遮蔽** `Element.prototype` 上既有的、
有测试覆盖的实现（TrustedScript 强制、`dynamic_classic_scripts_are_async_by_default_but_honor_async_false_order`、
Trusted Types sink 名、表单原生 setter），导致 workspace 出现 5 个失败
（`obscura-cdp::dynamic_script_onload_fires::dynamic_classic_fetch_concurrency_matches_force_async_state`、
`obscura-js::assigning_script_text_runs_the_default_policy_once`、
`obscura-js::dynamic_classic_scripts_are_async_by_default_but_honor_async_false_order`、
`obscura-js::sinks_hand_the_default_policy_the_expected_type_and_the_sink_name`、
`obscura-mcp::fill_form_check_and_select_use_native_setter_and_trusted_events`）。
该缺口是真实的（18 项 `in` 检测恒 false），但正确做法是在既有 `Element.prototype` 反射之上**扩展**而不是覆盖，
且它没有被证据表明是本次 CF 判定的原因。回退后 5 项全部通过，workspace 恢复全绿。

**补充证据（同轮，带点击轮）**：把探针的消息截断上限从 500 提到 4000 后拿到 widget 收到的完整
`extraParams` 消息，并做了一次带点击（探针默认会点 widget 复选框，实测 `clicked t=19.3s at (213,335)`）：

- **带点击后 widget 能走完 `interactiveBegin → interactiveEnd`**（实测 17701ms → 18593ms），
  但**仍然没有 `complete`**；3.3s 后页面换了一个新的 widgetId 重来（`egwwp` → `8jjf2` → `pdz3o`），
  说明 `interactiveEnd` 之后的那一步判定为失败。
- **每一个 widget 都会发 `reloadApiJsRequest` 并被顶层的 api.js 拒绝**，与是否点击无关；
  两个通过参照（HaHaVM、Chrome）的通信时间线里都**没有**这条消息。
- 完整的 `extraParams` 消息里 `chlPageData` 非空、`au` 是 api.js 的 URL、
  `apiJsResourceTiming` 的跨源归零字段与 Chrome 行为一致（见上一节证伪）。
  按 api.js 的源码，`reloadApiJsRequest` 分支的四个拒绝条件中，`We("reload")`（widget 被 kill）
  与 `cr`（reload 在途）在本轮都不成立，剩余候选是 `yo()`（退避窗口）与 `ri()`；
  而 `ri()` 的前置条件（`xt()` 找得到 api.js script 且有 parentNode、`Oa(window.turnstile)` 非 null 对象）
  已在本地逐条实测成立。真正的**触发点**在 widget 侧：它为什么认为 api.js 需要 reload，
  仍要在 widget 帧代码（HAR entry 4，429 KB 混淆脚本）里定位。

**当前进度**：卡点已从"顶层 proof 被服务端拒绝"精确到
**"widget 在 `interactiveBegin`/`interactiveEnd` 之后拿不到 `complete` + token"**，
且有一个每个 widget 都会发生、而参照侧从不发生的可见异常（`reloadApiJsRequest` 被拒）。
真实 `/1.txt` 404 仍未取得。

### Step 255 - OfflineAudioContext 原型链丢失导致 widget VM 崩溃（2026-09-13，修复完成）

**假设 / 方法**：最新 Obscura 轮在 widget realm 报 `Cannot read properties of undefined (reading 'call')`。
通过临时环境门控的 VM 指令日志记录失败操作的 receiver 和属性名，并与当前 Turnstile frame 脚本的
7040 行对齐。

**证据**：失败操作为 `prop=createOscillator`、receiver 为 `[object OfflineAudioContext]`，其 own keys
只有 `sampleRate,state,currentTime,baseLatency,destination,...`。`OfflineAudioContext` 原本继承
`AudioContext`，但晚绑定代码把它直接 rebased 到空的 `BaseAudioContext.prototype`，因此丢失了
`createOscillator` 与其它共享工厂方法。

**修复**：在晚绑定阶段把 `AudioContext.prototype` 的共享 `create*`/`decodeAudioData` 方法复制到
`BaseAudioContext.prototype`，再建立 Chrome 的 `AudioContext`/`OfflineAudioContext` → `BaseAudioContext`
链。新增 `offline_audio_context_inherits_base_audio_factories` 回归测试。

**结果**：修复后同一真实轮不再产生该 TypeError；widget 可继续执行音频探针。代理当前仍返回
Cloudflare challenge，尚未取得目标真实 404，因此这项修复是必要阻塞点的闭环，不能单独视为过盾证据。

### Step 256 - SVG 几何方法归属对齐（2026-09-13，验证完成）

窄 V8 trace 显示 Obscura frame 已实际调用 `getBBox`、`getComputedTextLength` 和 Canvas 测量，返回非零值，
但调用归属为 `Node.getBBox`/`Node.getComputedTextLength`；HaHaVM 成功轮对应为
`SVGGraphicsElement.getBBox`/`SVGSVGElement.getComputedTextLength`。保留 `Element.prototype` 的兼容回退，
同时把几何方法发布到对应 SVG 原型，修正接口归属而不改变测量实现。frame namespace focused test
确认方法、非零结果和原型自有成员均成立。由于真实轮存在 Cloudflare 时序波动，本项暂未作为独立 404 证据。

### Step 257 - Cross-origin isolated frame policy delegation (2026-09-13)

**假设 / 方法**：HaHaVM 成功环境把 `crossOriginIsolated` 读为 `true`。目标页面和 Turnstile frame 的实际响应都带 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`，且 widget iframe 委派了 `allow="cross-origin-isolated"`。用本地双端口 fixture 在 Chrome 和 Obscura 的 frame realm 读取 `crossOriginIsolated` 与 `typeof SharedArrayBuffer`，再检查 frame policy 实现。

**证据**：Chrome fixture 返回子 frame `true/function`；修复前 Obscura 返回 `false/undefined`。`frame_document_isolation` 原先忽略了已计算的 allow 委派，并要求子 frame 与父 frame 同源。focused nextest `coop_coep_and_permissions_policy_derive_cross_origin_isolation` 与 `cross_origin_child_can_enable_cross_origin_isolation_when_delegated` 通过 2/2；修复后二端口 Obscura fixture 顶层和跨源子 frame 均返回 `true/function`；真实低开销 trace `/private/tmp/lancet-goal-coi-trace-20260913h/api.jsonl` 记录两个 widget ray 的 `window.crossOriginIsolated=true`。

**修复**：跨源子 frame 在父文档已隔离、子响应具备 COOP/COEP 且 Permissions Policy 委派目标源时允许隔离；无委派仍保持非隔离，同源行为不变。

**结果边界**：修复后的真实点击轮仍收到 `/pat` 401 并最终 403，尚未取得独立 `/1.txt` 404。该项是已由 Chrome 定标的通用 frame 环境修复，不是独立过盾证明。

### Step 258 - Post-fix environment surface audit (2026-09-13)

在修复后的 release binary 上，跨 realm opt-in probe `/private/tmp/lancet-goal-env-live-20260913i/serve.log` 记录了 top、Turnstile frame、重试 frame 和 `about:srcdoc`：均为 `crossOriginIsolated=true`、`typeof SharedArrayBuffer/XSLTProcessor/CSSPseudoElement` 为 `function`，`navigator.languages=["en-US","en"]`、`devicePixelRatio=2`。因此 payload 中 N/F/T 桶的 `SharedArrayBuffer`、`XSLTProcessor`、`CSSPseudoElement` 差异不是当前运行时缺失；没有新的环境修改项。

### Step 259 - Chromium-151 fingerprint trace as the oracle; blob workers are real (2026-09-16)

**假设 / 方法**：新一轮参考不再是 HaHaVM 或旧 tracelog，而是 `assets/thelancet-trace/`：一个
`Chromium-151.0.7922.76-macos-arm64`（`--enable-fingerprint-trace --fingerprint-trace-values=full
--js-flags=--no-turbo-fast-api-calls`）的抓包 + fp-trace + HAR。三者同一次通过轮（HAR 末条
`POST https://www.thelancet.com/1.txt → 404`）。因此这一轮按用户要求改成
「用同一代理跑我们的一轮 → 与参考的抓包/trace 逐项对拍 → 定位分岔」。新增对拍工具
`scripts/fptrace_diff.py`（把 fp-trace 的 enter/exit 配对、`.get/.set` 归一，再按**参考的名字空间**
过滤我们的 jsonl trace）。

**证据（wire 级，必须用解压后长度）**：HAR 的 `bodySize` 是压缩传输长度，`content.size` 才是解压长度；
用错会得出「我们的响应大 3 倍」的假结论。按 `content.size` 对齐后：

| 请求 | 参考 | Obscura | 判定 |
|---|---|---|---|
| orchestrate/chl_page/v1 | 241710 | 237617 | 同形 |
| api.js | 86603 | 86603（引擎侧 ResourceTiming） | 同 |
| 顶层 `/fo/` 响应 | 113772 | 113760 | 同 |
| widget `/fo/` #1 响应 | 822624 | 822648 | 同 |
| widget `/fo/` #2（点击后的证明）响应 | 127228 | 127228 | **逐字节同长** |
| widget `/fo/` #3 响应 | 7164 | 5160 | **分岔** |
| 顶层 `/fo/`（收官）响应 | 3660（带 `cf_clearance`+`cf-chl-out`） | 3240（无 clearance） | **分岔 → 换 ray 重来** |

也就是说：CF 对我们前两个 `/fo/` 提交的响应与对真 Chrome **完全同长**（同一决策），分岔出现在第三个
widget `/fo/` 与收官顶层 `/fo/`。顶层 `/fo/` 请求体我们又比参考小 ~1.2KB。

**证据（realm 级，fp-trace）**：`fptrace_diff.py realms` 给出参考的 realm 清单——
`window` 10440、**`worker` 23575（两个 `blob:https://challenges.cloudflare.com/<uuid>`）**、
`unknown`（纯 v8 点）20975。那两个 worker 里跑的是 CF 的真实测量：`WorkerNavigator.platform /
hardwareConcurrency / deviceMemory / userAgent` 上报、`TrustedTypePolicy.createScript` +
`WorkerGlobalScope.fetch("https://brunhild.../i/...")`（`Response.status → 401`）、
`setTimeout(function(){self.postMessage({CpvME3:"1"})},55)` 计时回路。我们的 trace **worker 记录为 0**：
`dedicated-worker.js` 把 `blob:` Worker 构造成 stub，只把页面 post 过去的字符串
`Function()` 在创建者文档里跑（`self.` 被剥掉、`postMessage` 改写成 `hahavm_this.postMessage`）。
这是本轮唯一的结构性分岔。

**被证伪的假设（要保留）**：把 `blob:` Worker 改成真 spawn（最小补丁：blob 文本已知时走既有 `_spawn`）
之后，真实点击轮仍是 **0/6**，与改动前 0/6 相同 —— 所以「我们的 blob worker 是 stub」虽与真 Chrome 不同，
**它本身不足以解释当前失败**。但同一个补丁让 4 个此前失败的 worker 回归测试转绿
（`blob_worker_evals_posted_source_and_relative_fetch_hits_creator_origin`、
`blob_worker_reports_the_creating_origin`、`blob_worker_relative_fetch_uses_creator_origin`、
`worker_from_blob_url_round_trips`、`worker_inherits_the_creator_fingerprint_contract`）：
测试与质询结果不一致，说明「stub」是先前为 600010 做的**有意取舍**，不能靠测试转绿就翻。
该补丁已回退，保留为「已测量、未改变结果」的实验记录。

**另两处被排除的怀疑**：
- `brunhild` 502 是环境：`curl -x http://192.168.3.57:9000 https://brunhild.../i/...` 对**任何**客户端都返回
  `server: mitmproxy 9.0.1` 的 502（链路上 Reqable → mitmweb 的 MITM 失败）。参考 HAR 里 brunhild 只有
  `CONNECT`（从未被 MITM，所以没有内层记录），既不能证明成功也不能证明失败。
- `rPAC6`（payload 里的 locale 形状字段）在参考 payload 与我们的 payload 里都是 `en-us`，不是差异。

**测量盲区（本轮新增）**：
- **我们的 native trace 没有 V8 builtin 快路径记录**。参考的 Chromium 带 `--no-turbo-fast-api-calls`，
  能记录 `Date.now`(222)、`Number.parseInt`(5269)、`TextEncoder.encode`、`SubtleCrypto.digest`、
  `BigInt`、`Object.getOwnPropertyNames` 等；我们的 bytecode 探针在这些调用上**一条都不出**
  （`grep '"name":"Date\.' → 0`）。因此「参考调过、我们没调过」的名单里混着大量这类假缺失，
  用两份流做「缺失 API」结论前必须先按名字空间+可表达性裁剪。
- **嵌套 MITM 代理会把上游不可 MITM 的请求变成 502**：本地 `mitmdump --mode upstream:` 落盘的 502
  来自本地那层（`server: mitmproxy`），与 Reqable 无关。上一轮把 brunhild 502 记成「代理/上游问题」时
  就踩了这个坑。

**本轮改动（都是与参考自洽性对齐，无站点特判）**：`screen.colorDepth/pixelDepth` 平台相关
（macOS=30，参考 `Screen.colorDepth → 30`；原先硬编码 24）；macOS 默认工作区不再等于整屏
（`availTop=33`、`availHeight=height-33`；参考 33/860 对 982）；UA-CH 全版本不再发布被削减的
`151.0.0.0`（改用可考的真实 build：151.0.7922.76 / 149.0.7827.0 / 146.0.7680.80，两条 transport 与 JS
同源）；`navigator.languages` 与 `Accept-Language` 补上基础语言（`zh-CN,zh;q=0.9`，与参考头一致）。

**量化**：改动前后各 6 轮真实点击轮，均 **0/6** 拿到目标 404；改动的可测效果是
`colorDepth 24→30`、`availTop 0→33`、`uaFullVersion 151.0.0.0→151.0.7922.76`、
`accept-language zh-CN→zh-CN,zh;q=0.9`（`screen_probe.py`/`ua_probe.py`/`identity_probe.py` 直读）。
`obscura-net` 103/103 通过（两处断言按新口径更新）。

**结论**：这一轮把「参考」换成真 Chrome 的同轮 fp-trace 后，前两个提交的响应与参考同长，
分岔精确落在点击后的证明与收官提交；结构性差异只剩「真 worker realm vs 在创建者文档里 eval」，
而把它改成真 spawn 后通过率不变（0/6）。下一步优先级：①按 `fptrace_diff.py` 的名字空间裁剪出
「参考表达得出、我们确实没有」的最小 API 集（含 worker realm 上的身份面）；②收官顶层 `/fo/`
少掉的 ~1.2KB 内容型差异需要解密对拍（我们侧已有 payloadJSON 通路，参考侧需要同 stage 明文）。

### Step 260 - 插桩构建让 Obscura 产出 ov2 tracelog；payload 边界的无侵入捕获（2026-09-16）

**目标**：让 Obscura 轮也产出 `ov2.*` tracelog（参考 `assets/tracelog-0916-11.jsonl`），并用它定位
收官顶层 `/fo/` 比参考少掉的约 1.2KB。

**方法（不动上游 mitmweb）**：上游 9000 链路里的 mitmweb 只把它自己那份 `ov2.js`（411543 B，与 CF 当前
下发的内联脚本逐字节相同）替换进 widget 文档；那份脚本**没有** `window.external.tracelog` 调用点，
所以任何引擎都产不出 tracelog。改为在**本机**加一层 mitmdump（`upstream:http://192.168.3.57:9000`），
对 widget 文档的内联脚本做二次替换，换成操作者生成器的插桩版本
`ov2-0916-11.stage3.js`（414092 B，md5 `67c8a9f895807337a881a01be2f46c2b`，来自
`cf5s/chanllenge/ov2/`，由 `instrument_0916_11.py --stage 3` 从 `ov2-0916-11.pristine.js` 生成）。
插桩版调用 `W.external.tracelog(k,v)`，正是 Obscura `--tracelog-file` 的 sink。
复现：`mitmdump --ssl-insecure --mode upstream:http://192.168.3.57:9000 --listen-port 8897 -s instrument.py`，
引擎 `--proxy http://127.0.0.1:8897`。

**结果（① 达成）**：一次点击轮产出 5163 条 `ov2.*` 记录（另一轮 2261），含 payload 全部阶段：
`ov2.payload.json_plaintext` / `framed` / `deflate` / `rsa_header` / `keyQBLZ6` / `keystream` /
`encrypted` / `final` / `send` / `send2`。

**对拍（`tracelog_diff.py values`）**：keys 参考 74 / 我们 58；**value-equal 37、same-format-differs 20、
FORMAT DIFFERS 0**；只在参考里的 17 个键是 handler 入口键（`ov2.h.m8/m7/cp/cY/ct/cP/cE`，
按 op 命名，程序跑得越长出现越多）与 `ov2.recov.fire` / `ov2.host.padstart` / `ov2.host.canvas`。
`segments` 给出量级差异的根因：参考一轮 301292 条 / 12.3s / 4 个 VM 实例 / `send(s)=3`；
我们一轮 2902 条 / 5.4s + 2261 条 / 3.0s、每片段 1 个实例。**即同一程序我们只跑了约 1/4 的时长与
1/60 的记录量** —— 这是「观测到的覆盖差异」，不是格式差异（0 FORMAT DIFFERS）。

**payload 字段级对拍（同阶段，均取 `json_plaintext` 第一条 = `chl_api_m` 模式）**：两侧都 47 键、
**0 类型不符**；差异全是值（会话/上下文相关）。要点：`PWGF4[0].t`（turnstile load→render 的毫秒）
参考 9539 对 我们 157；计数类 `Blsob5` 11/2、`TzZRB1` 19/6、`WHTpH6` 21/6；尺寸类 `ZMSOw0`/`twvE0`
1196/751；而 `eaaP6` 1038→2676、`wOvYJ5` 1055→2689。注意参考这一份来自 `/123.txt` harness
（`vXDzj6` 字段自证），上下文不同，值差不能单独归因引擎。

**② 无侵入 payload 捕获（新手法，已验证）**：把一段安装器**前置**到响应文本里——对 JS 响应与
**interstitial 内联脚本**（它是文档里最先执行的脚本，早于任何 fetched 脚本；挂钩晚了会被缓存的
原生引用绕过）——安装器只做包装并写 `window.external.tracelog`，不改挑战代码、不改端点。
它捕获到：
- 顶层 `/fo/` 的**最终 payload 字符串**：首个 2380 B、收官 **7799 B**（参考 HAR 同阶段 2359 / 9026）；
- CF 回包的 base64 解码结果（`paydump.atob.out`，仍是压缩+keystream，未解出明文）；
- **worker bootstrap 源码**：`onmessage=function(e){e.isTrusted&&''===e.origin&&null===e.source&&eval(...)}`
  —— 即质询要求 worker 侧消息同时满足 `isTrusted && origin==='' && source===null` 才 eval；
- 我们的引擎有 `CompressionStream`；`subtle.encrypt` 一次都没被包装到（说明该 payload 的
  对称加密是 VM 自己实现的 keystream，与 `ov2.payload.keystream` 记录一致）。

**收官顶层 payload 明文仍不可得**：把捕获到的 7799 B 字符串按 CF 字母表还原后得 5849 B 密文，
在 0..400 全偏移上 raw-deflate/zlib 全部失败 ⇒ 压缩后确有 keystream 加密，离线无会话密钥不可解。
要拿到它的**字段级**内容，必须像 ov2 那样**在顶层 VM 自己的 builder 上插桩**（操作者的生成器只覆盖
ov2；顶层是 `orchestrate/chl_page/v1`，其脚本文本里没有 crypto/btoa/CompressionStream 词表，
构造与加密都在被 eval 的程序内部）。

**关键警示（插桩的固有污染）**：插桩版是**静态捕获**，里面写死了它那一轮的会话值。实测 stage3 里
硬编码了旧一轮的 fo 端点 `1167067879:1789524309:...`，于是引擎会向它 POST，CF 回 **400**，widget
随即在 payload 里上报 `{"QJDyx5":400,"qcMvE9":"600010"}` —— 这正是先前会话反复看到的 600010。
对照：**未插桩的轮从不发这两个请求、也从不出现 400**。同理，上游那份 `ov2.js` 也写死了
`2923738842:1789549508:rDGb...`（各轮 widget `/fo/` 的 URL 恒为它，而顶层 fo id 每轮都新）。
结论：**插桩轮只能用于「格式/早期阶段」对拍，其失败码不得当作引擎证据**；要做同上下文的值级对拍，
需要一份**同一轮内**生成、会话值是最新的插桩脚本（或在引擎侧直接 hook 构造点）。


### Step 261 - 当轮新鲜（in-flight）插桩：两个 realm 都在原位打点（2026-09-16）

**做法（不改挑战源码、不服务静态捕获）**：本机 mitmdump 在**当轮响应文本**里**前置**一段安装器，
覆盖三个入口：interstitial 的内联脚本（`/1.txt` 的 403 文档，文档里第一个执行的脚本）、
`orchestrate/chl_page/v1`、`api.js`、以及 widget 文档自己的内联脚本（`/turnstile/f/.../normal`）。
安装器只做包装并写 `window.external.tracelog`，因此**端点与会话值保持当轮新鲜**（自证：本轮
`api.js` 86603 = CF 原版；widget 的 fo id 每轮不同；轮内不出现注入轮那种 400）。
**关键实现点**：引擎的全局是**不可写**的（`W.postMessage = f` 在 sloppy 模式下静默失败），
必须用 `Object.defineProperty(obj, name, {value, writable, configurable})` 才能挂上；这一点决定了
前几轮「挂了但什么都没捕到」。

**拿到的东西（widget realm，当轮新鲜）**：
- `crypto.subtle.digest` 的**输入**：3054 次调用。主导项是同一个**常量** 165 字节串
  （`a3bf5f6d8e8aea25|1789556493151|0|…`，distinct=1、重复 3039 次）被反复哈希 **3040 次**；
  **参考 Chromium 同项是 457 次**（`len=165` ×457）⇒ 6.7 倍循环计数差。
- 其余测量输入：CSS 属性名清单 29237 B（`{"0":"accent-color",…`）、字体清单 74 B、
  音频通道数据 22018 B ×2、keyframe CSS 20234 B，以及若干个**以 0 开头**的缓冲（11820/8624×2/
  13499/4448 B）。
- 顶层 payload 边界：首个 2380 B、收官 **7799 B**（参考 HAR 同阶段 2359 / 9026）；builder 帧定位到
  活脚本里 `orchestrate/chl_page/v1` 的 `gR`：
  `function gR(E,Iy,wI){return Iy={E:327,W:1747,zk:1270},wI=EW,f[wI(Iy.E)][wI(Iy.W)]&&f[wI(Iy.E)][wI(Iy.W)][wI(Iy.zk)](E)}`
  —— 它只是**编码助手**（把字符串交给 TextEncoder 一类原生方法），明文在它之前就已产出。

**这轮证伪的两条**：
1. **不是 canvas 缺陷**。直读我们的引擎：2D `getImageData` 像素正确（`255,0,0,255`）、
   绘制区域 4096/16384 非零、`toDataURL` 产 22046 字符、`OffscreenCanvas` 512/4096 非零。
   所以那些「以 0 开头」的 digest 缓冲不是渲染为零。
2. **CF 自己的 worker 门槛在我们引擎里能过**。用 CF 的原样 worker 源码（`onmessage=function(e){e.isTrusted
   &&''===e.origin&&null===e.source&&eval(...)}`）实测：blob Worker 可构造、`instanceof Worker` 为真、
   门槛通过、`postMessage({ok:1})` 的回复到达；`trustedTypes.createPolicy`/`createScript` 均正常。
   ⇒ stub 路径交付的消息满足该门槛，worker 缺失不是「门槛不过」造成的。

**时间/循环计数的解释与既有反证**：165 字节常量被哈希的**次数**差 6.7 倍，与我们引擎比 Chrome 快得多
一致（`PWGF4[0].t` 157 ms 对 9539 ms 同源）。但上一轮在**通过侧**做过的可逆扰动实验
（E2：取消 setTimeout 压缩、恢复真实延时 → token 10.7s 仍通过）已经**证伪「挑战时长/计时决定判定」**，
所以这类计数差更可能是「更快的引擎」的产物，而不是判定门。

**收官顶层 payload 的明文仍不可得（本轮把可达边界穷尽了一遍）**：它不是 `JSON.stringify` 的产物、
不经 `btoa`、不经 `subtle.encrypt`、不经 `CompressionStream`、不经 `Blob`/`Response`、
不经 `join`（带 payload 形状的过滤器无命中），构造与对称加密都在被 eval 的混淆程序内部完成。
`gR` 之上没有可挂钩的主机边界；要拿字段级明文只能**像 ov2 那样给这个程序本身插桩**
（操作者的 `instrument_0916_11.py` 只覆盖 ov2；`chl_page` 这个程序需要同类的锚点/派发表分析，
分析工作区 `jsvmp-engine-0916-11` 的解码器/CFG 工具目前只对 ov2 建成）。


### Step 262 - 判定发生在加密交换内部：我们拿到的是「更短」的 clearance（2026-09-16）

**先纠正一条被沿用很久的错误前提**：先前记的「收官顶层 `/fo/` 无 `cf_clearance`」是错的（当时只记了
status/长度）。按响应头实测（干净路径，CF 原版脚本、fo id 每轮新鲜）：

| 步骤 | 我们 | 参考 HAR |
|---|---|---|
| 顶层 `/fo/` #1 | req 2380 → resp 113768，无 chl | 2359 → 113772，无 chl |
| widget `/fo/` #1 | 4994 → 822–846K，无 chl | 4674 → 822624，无 chl |
| `/pat/` | 401 | 401 |
| widget `/fo/` #2（证明） | 89228–91500 → **127228**，无 chl | 89804 → **127228**，无 chl |
| widget `/fo/` #3 | 92994–94690 → **5160**，`cf-chl-out: 133`，**`Set-Cookie: cf_clearance`** | 93026 → 7164，`cf-chl-out: 153`，**无** set-cookie |
| 顶层 `/fo/` 收官 | 7810–7895 → **3240**，`cf-chl-out: 133`，**`Set-Cookie: cf_clearance`** | 9026 → 3660，`cf-chl-out: 177`，**`Set-Cookie: cf_clearance`** |
| 目标 | **无** | `POST /1.txt`（form-urlencoded，`sec-fetch-mode: navigate`，referer 带 `__cf_chl_tk`）→ **404** |

即：**我们确实拿到 `cf-chl-out` 与 `cf_clearance`，只是比参考短（133 vs 153/177）**，而收官顶层请求体
少约 1.2KB（7810 vs 9026）。然后我们的页面**重新加载**（GET `/1.txt` → 新一轮 orchestrate），
参考的页面**提交表单**（POST `/1.txt`）拿到真实 404。

**分支差异已定位到「客户端导航之前」**。把六个可产生导航的入口全部包装后跑完整一轮：
`HTMLFormElement.prototype.submit`、`requestSubmit`、`Location.prototype.assign/replace`、
`Location.prototype.href` 的 setter、`Window.open`、`HTMLElement.prototype.click` —— **零命中**。
我们的 interstitial 文档里也**没有 `<form>`/`<input>`**（只有一段带 `cf_chl_o​pt.cOgUHash/cOgUQuery`
的内联脚本），`chl_page` 程序里 `requestSubmit` 出现 0 次、`createElement` 2 次、`submit` 2 次。
⇒ 我们这一侧的「重试」不是这些入口之一（很可能是 `location.reload()`，未在本次包装范围内），
而参考那一侧的「完成」是表单 POST。**两侧都拿 clearance，却分到不同分支**：说明判定发生在
**收到加密响应并解出决策**之后、**客户端动作之前**，即决策数据在 `/fo/` 的加密响应体里。

**这些 `/fo/` 响应是不可读的加密块**：收官顶层响应（3240 B）与 widget #3 响应（5232 B）首字节是
`hLeHiJm+iJeL…` / `cXF3hm1yWVdd…`，与请求体同一套自定义字母表，离线无会话密钥不可解；
它们不是 HTML，所以「读响应看 CF 说什么」这条路在本环境不成立。

**本轮顺带证伪（都曾是候选检测点）**：
- 表单 POST 导航本身在引擎里正常：attached `form.submit()`、**detached** `form.submit()`、
  `requestSubmit()` 三种都发出 POST（本地 8099 服务器实测收到 `tokattached=vattached`）。
  （第一次探针的 `None` 是我的探针顺序错：attached 那次已经导航走了，后续调用自然无函数可调。）
- CF 自己的 worker 门槛（`isTrusted && origin==='' && source===null` → `eval`）在引擎里能过。
- canvas 读回非退化（像素/`toDataURL`/`OffscreenCanvas` 都正确）。

**结论与下一步**：判定点在服务端对**我们提交内容**的评估里（1444 字节差：请求 7810 vs 9026 与
clearance 长度 133 vs 153/177 同源）。要闭环只剩两条路，都需要分析侧：
① 解出 `/fo/` 加密响应（需要该会话的对称密钥，密钥在 VM 内部由 JS 生成）；
② 或按 step 261 的办法给 `chl_page` 程序的 payload builder + 决策分支插桩（需要该程序的锚点/派发表，
现有 `jsvmp-engine-0916-11` 工具只对 ov2 建成）。

### Step 263 - 引擎内部全局经 `for..in` 泄漏：19 个 `__obscura_*` 在 window 上可枚举（2026-09-16，已修）

**假设 / 方法**：不再追 payload 明文，改为直接问「真浏览器不会有的东西」——在引擎里枚举
`window`。探针：`for (var k in window) if (/obscura|Obscura|Deno|^__blob/.test(k)) ...`，并对命中项读
`Object.getOwnPropertyDescriptor(window, k)`。

**证据（修前）**：`Object.getOwnPropertyNames(window)` 被 JS 层过滤后**看不到**任何引擎名（先前会话做的
`_isEngineName` 过滤 + `__obscura_hide_list` 生效），但 **`for..in` 枚举出 19 个**：

```
__obscura_schedule_input_strategy  __obscura_natural_type  __obscura_set_screen_override
__obscura_recompute_resizes  __obscura_shadowHostNames  __obscura_recompute_intersections
__obscura_report_uncaught  __obscura_window_origin_x  __obscura_window_origin_y
__obscura_pointer_release  __obscura_setFieldValue  __obscura_setInputFiles
__obscura_rebasePerformanceOrigin  __obscura_queue_event_timing  __obscura_seed_visibility_entry
__obscura_measure_task  __obscura_performance_record  __obscura_performance_lifecycle
__obscura_clone_hooks
```
每一个都是 `window` 的**自有且 enumerable** 属性（`getOwnPropertyDescriptor` 直接命中，depth 0）。
修前 `for..in` 总键数 263，其中 19 个是引擎名；Chrome 一个都不会有。

**根因**：`__obscura_hide_list` 是**快照期**捕获的，而其中 19 个全局是运行时才安装的
（`tools/interaction.js`、`env/crypto/*`、`env/dom/shadow-custom-elements.js`、`env/media/canvas.js`、
`env/performance/*`，以及 Rust 注入的 input policy 等），所以它们没进 hide list、保持 enumerable；
而 `bootstrap.js` 的反射过滤只覆盖 `Object.getOwnPropertyNames` / `Reflect.ownKeys` / `Object.keys` /
`Object.getOwnPropertyDescriptors`——**`for..in` 由 V8 直接遍历属性表，绕过所有 JS 层过滤**。

**修复**：在 `bootstrap.js` 增加 `__obscura_hide_engine_globals()`（用 `for..in` 找出自身可枚举的
引擎命名空间全局，逐个 `Object.defineProperty(..., {enumerable:false})`，幂等、自带 try/catch），
并在 `page-init.js` 的 hide 循环之后调用一次（带 `typeof === 'function'` 守卫，兼容不跑该 bundle 的 realm）。

**量化**：`for..in` 泄漏数 **19 → 0**；`for..in` 总键数 263 → 244；frame realm 同样 0。
`obscura-js` 620 项：610 通过 / 10 失败，10 项全部**既存**（7 项 worker 家族、1 项 link 属性顺序、
2 项 about:blank 家族）；两处断言按本轮已定标的口径更新
（`languages` 现在含基础语言 `["zh-CN","zh"]`；清掉 screen override 后默认 macOS 工作区
`availTop > 0` 且 `availHeight < height`）。真实点击轮 6 轮：**0/6**（与修前一致），
即这处泄漏是**真实指纹缺口**，但不是当前判定的门。

**附**：同轮还验证了三条「真浏览器该有的行为」我们是对的（用直读探针，避免再猜）——
表单 POST 导航（attached/detached/`requestSubmit` 三种都发出 POST）、CF 的 worker 门槛
（`isTrusted && origin==='' && source===null` → `eval`）、canvas/Offscreen 读回均正确。

### Step 264 - `/fo/` 的载荷是「加密的 VM 字节码」，所以主机侧永远看不到程序（2026-09-16）

**假设**：既然 `/fo/` 决策不可读，先确定它**是什么**——是 JS 文本（可被 eval/script/blob 捕获），
还是别的形态（只能被 VM 解释）。

**方法与证据**：
1. 把主机侧所有「程序会变成可执行代码」的入口都包装后跑完整轮：`eval`、`Function`、
   `Node.appendChild/insertBefore/replaceChild` 上的 script 文本、`createElement('script')`、
   `Worker.prototype.postMessage`、`URL.createObjectURL`/Blob 文本。
2. 直接读引擎的 blob 库（本引擎把 blob 文本放在页面可见的 `globalThis.__blobStore`）：
   一轮点击结束后库里**只有 1 项**、292 字节，内容是 worker bootstrap
   （`var _p=null;if(self.trustedTypes)…onmessage=function(e){e.isTrusted&&''===e.origin&&null===e.source&&eval(...)}`）。
   即**解密后的程序没有变成任何 JS 文本**。
3. 比对字母表：插桩轮 tracelog 里 VM 的**用户字节码**记录为
   `ov2.bc.user {bc_len: 6944, dst: 210, bc_kind: '[object Uint8Array]'}`，其 `bc_head` 是
   `sKHDVzg+P0lAOCk9KvKZl5yVnJWSmabFrZODGCJGLyliNW1VxszR+gam9W1P…`；而我们抓到的 `/fo/` 响应体首字节是
   `kMOTlKXKlKOXzZyhnpzAqqjApdG5lMuZztPB2suz06PR…`、`cXF3hm1yWVddVFlZbJJebV2Td2CAm5Z4eop7bYexnoZy…`、
   `hLeHiJm+iJeLwZCVkpC0npyzjMavw8eQs6HTyMKRtanD…`、`RVpZb5Bab2NgX2dtYoR3fZpb…`、
   `mpqgr5abgoCGfYKClbuHloa8oImpxL+ho7OklrDax6+b…` —— 同一类自定义 base64 字母表，且同一 URL 的不同轮
   前缀不同（会话密钥不同）。

**结论**：`/fo/` 请求与响应都是**加密的 VM 字节码**，由 ov2 解释器解密后**在自己的 dispatch 循环里执行**，
不经过任何 JS 执行入口。这一个事实解释了此前所有「主机侧挂钩零命中」：不是挂少了，而是**没有可挂的边界**。
它同时与操作者工具链的设计一致——`jsvmp-engine-0916-11` 的锚点/派发表工具正是为了给**这个 VM** 插桩
（`instrument_0916_11.py` 生成 stage1/2/3），而不是给页面级 JS 插桩。

**因此收官 `/fo/` 的字段级明文只有两条路**（都不是主机侧包装能做到的）：
① 拿到该会话的对称密钥（密钥在 VM 内由 JS 运算生成，不在任何原生 API 的入参里）；
② 用 ov2 的插桩**比较两轮的 dispatch 轨迹**——这是**现有工具就能做**的下一条路：我们的 tracelog 已能
产出（step 260），参考 tracelog 在 `assets/tracelog-0916-11.jsonl`，`tracelog_diff.py` 的 `values`/`diverge`
可直接对齐 key 与值。注意先消除**插桩自身开销**带来的速率差：参考 301292 条/12.3s，我们一轮
2902 条/5.4s + 2261 条/3.0s（每片 1 个实例），速率差主要来自两侧 tl() 落盘实现不同，不能据此下结论。

## Step 265: the /fo/ responses decode without a session key, and our build is not the operator's

**Why this step.** Step 264 left one gap: the decision data is inside the `/fo/` response
bytecode, and the only routes were "the session symmetric key" or "VM-internal
instrumentation". The operator's `jsvmp-engine-0916-11/decode-ov1.mjs` header publishes the whole
response transform, and its only input besides the body is the session ray. So the responses are
decodable from our own capture, with no key handed over. This step does that, then checks whether
the operator's build-level tooling applies to our session.

**Decoder.** `.claude/skills/obscura-challenge-probe/scripts/ov1_decode.py` (byte for byte the
published pipeline: `seed = 32 ^ xor(charCodeAt(ray + "_0"))`, `stage1 = atob(body)`,
`out[i] = js_mod((255 & s1[i]) - seed - (i % 65535) + 65535, 255)`, `bytecode = atob(out)`).

Validity is not asserted, it is proved twice:

1. Run on the operator's own HAR it reproduces their three hard-metric artifacts exactly:
   `a814b14a54e09ce35c3d6528d081c890` (462740 B), `1b343b06bd03b55cf01c17278884e61a` (71567 B),
   `8ee7e511a0bda63fd54c813c4d9c7226` (4029 B).
2. The seed is provably the server's, not merely a working guess. `out[i]` is the canonical
   stage-2 text shifted by `(Uk_true - Uk_used) mod 255`, a per-byte constant, and the canonical
   stage-2 is pure base64 (the VM feeds it to `atob`). Over the 65-char alphabet a shift maps the
   alphabet onto itself only for `d = 0` (checked exhaustively), so a wrong seed cannot produce
   the pure-base64 stage-2 that every one of our five responses produced
   (`b64frac = 1.000`). Per-entry ray: the ray is in each `/fo/` URL
   (`/fo/<hash>/<16 hex ray>/<token>`), which matters because our HAR holds two challenge rounds;
   the operator's `--index all` uses one global ray and reports `[E] 最大公共前缀=0 → DIVERGENT`
   plus 12 B / 399632 B / 64884 B artifacts on our HAR.

**What our session was served** (widget level, ray `a3bf882b8bec564b`):

| stage | our bytecode | reference bytecode | delta |
|---|---|---|---|
| 1st `/fo/` response | 462979 B | 462740 B | +239 B |
| 2nd `/fo/` response | 71570 B | 71567 B | +3 B |
| 3rd `/fo/` response | 2900 B | 4029 B | **-1129 B** |

The reference's third program carries the widget handoff literals (`_cf_chl_opt`, `postMessage`,
`widgetId`, `token`, `source`); ours is a different, smaller program. Page-level `/fo/` responses
(63988 B and 1821 B) have no counterpart in the filtered reference HAR.

**Our blobs are not in the operator's build encoding.** Three independent checks, all with the
operator's own tooling run on a scratch copy of their tree (`/tmp/ov2-our`, their production tree
untouched):

1. Entry decode: at `(pc=0, key=241)` the reference blobs decode to `op=84 = cl`; ours decode to
   `op=56`, which is absent from `spec.opToHandler`, so the entry chain dies
   (`宽度未覆盖`, `dynamicReachable = 0`, 181 rendered instructions against the reference's 295).
2. String table: `scripts/ov1_strprobe.py` inverts the VM's own string encoding
   (`plaintext = Uk ^ ((b+245)&255) ^ 120`, searched over all 256 per-string keys). On the
   reference's stage-3 blob it recovers exactly the documented literals; on all three of our blobs
   it finds none of them, and none of `document`, `Date`, `window`, `length`, `indexOf` either.
3. Control: the same scratch pipeline fed the reference blobs reproduces production byte for byte
   (295 rendered instructions, `入口链自洽性 ✅`), so this is not an environment artifact.

**The challenge program itself is per-session.** Two loads inside one session are 94.25% identical
(217839 B identical block, same 235598 B size and different md5), while our program against the
operator's `ov2-0916-11.pristine.js` (400800 B) shares 8.63% with a largest common block of 446 B
(against `ov2-0916-11.js`, 225721 B: 7.69%, largest 691 B). A later round fetched 243573 B. So a
saved pristine is not this session's VM, and the anchor/dispatch tables derived from it describe a
different build. The `_cf_chl_opt` field vocabularies are identical across sessions (13-key page
block, 26-key widget block, same names), so those names are stable and cannot be used as a build
fingerprint.

**In-flight seam that does work.** `scripts/inject-runprogram-probe.py` wraps the VM's own global
`runProgram(text, b)` (the consumer at pristine:3406 and the source-embedded literal at
pristine:5072) through an accessor on the global, plus `Function`, `fetch`, and
`XMLHttpRequest.open/send`. A 30 s round produced 17889 `rp.call` records, all from
`https://www.thelancet.com/1.txt`, all the **same** 6032-char standard-base64 program text
(`head bdUluwUbHBYdBRNMvy6Ymoech5yRmI2J7BmHLTcbBD53…`), which is the page realm's inline program
re-run per event. No `/fo/` text and no `new Function` argument appeared.

**Where the payload builder actually runs.** The run log shows four `blob:` worker scripts, and the
`/fo/` POSTs never pass through the page's `fetch` or `XMLHttpRequest` even though both were wrapped
before the first page statement. The tracelog sink exists only in window realms
(`realm.rs` sets `globalThis.__obscura_tracelog_enabled` for frames and installs `External.tracelog`;
`env/worker/dedicated-worker.js` has no `external`). So the requested "insert
`window.external.tracelog` into the payload builder" cannot work as written: the builder's realm has
neither `window` nor a tracelog sink, and the addon snippet's `var W = window` throws there and is
swallowed by its own guard.

**Ruled out this round.** `GET .../pat/<ray>/...` returns `401` with a 1 byte body in the reference
session as well, so it is not a divergence.

**Status.** `https://www.thelancet.com/1.txt` still answers with the challenge; the click run is
still 0/6. New next action: give the worker realm a sink (postMessage forwarding, or a
`self.external.tracelog` in `dedicated-worker.js`), then log the `/fo/` fetch body and the decoded
program text inside the worker, which is the realm that builds the payload. Instrumentation of the
*current* session's `orchestrate/chl_page/v1` is required, because the build is re-randomized per
session.

## Step 266: a probe the challenge does not detect, the worker realm, and a correction to step 265

**Why this step.** Step 265 concluded that our bytecode "is not in the operator's build encoding" and that
the build is re-randomized per session. Both were wrong, and the error came from comparing a decode of one
session against program text from another. This step re-derives the decoder against the live VM, lands the
worker-scope instrumentation the objective asked for, and records the divergences that are left.

**The decoder is now validated against the VM itself, not just against the operator's HAR.** A run with the
probe installed captures both the response body and what the VM does with it. For one session:

| response chars | VM `atob` output | our stage-2 text | VM's `runProgram` text |
|---|---|---|---|
| 113768 | 85324 B, head `81 84 76 8e` | 85324 B, head `bdUluwUbHBYdBRNMvy2Lg…` | 85324 chars, head `bdUluwUbHBYdBRNMvy2Lg…` |
| 845964 | 617340 B | 634472 B, head `7GQ/BcWvrrStxa4EoGE…` | 634472 chars, head `7GQ/BcWvrrStxa4EoGE…` |
| 127240 | 95428 B | 95428 B, head `7GQ/BcWvrrStxa4EoGE…` | same family |

The program text the VM hands to `runProgram` **is** the pipeline's stage-2 output, byte for byte, and the
relation `stage2[i] = js_mod((255 & s1[i]) - seed - (i % 65535) + 65535, 255)` holds for the first bytes
with the session's ray-derived seed (checked analytically: seed 23 in one session, and the per-entry ray from
the `/fo/` URL). Nothing is session-keyed beyond that seed.

**Correction to step 265.** Fed VM-verified blobs, the operator's `spec-0916-11.mjs` decodes our entry bytes
to **legal handlers** with a **self-consistent entry chain**, so our bytecode is in the same encoding as the
build their tables came from:

```
ov1#0 bcLen=63992  bc[0]=0x6d key=241 -> op=147 handler=m7
ov1#1 bcLen=475853 bc[0]=0xec key=241 -> op=16  handler=ce fixedW=3
ov1#2 bcLen=71569  bc[0]=0xec key=241 -> op=16  handler=ce fixedW=3
ov1#1 入口链自洽性: (0,241) 的第一步（w=3）落在 pc=3 且 key=58 有行 ✅
```

And our program's string pool is readable with the same per-string-key scheme step 265 introduced
(`plaintext = Uk ^ ((b+245)&255) ^ 120`, key searched over all 256 values). On the 475853 B widget program:
`_cf_chl_opt` x93, `postMessage` x31, `document` x132, `hardwareConcurrency`, `deviceMemory`, `platform`,
`userAgent`, `webdriver`, `getDirectory`, `attachShadow`, `getContext`, `digest`, `WebAssembly`,
`performance`. So the earlier "no readable strings" and "unknown op" readings were artifacts of a
mis-seeded decode in that session, and the "per-session build" claim is retracted: what is per-session is
the *program*, not the encoding.

**The probe that the challenge does not detect.** The earlier attempts stopped the flow before `/fo/`
(because a `runProgram` wrapper called itself and blew the VM's stack), so a run with a probe present looked
like a run with an engine defect. The probe now: passes the original switch in `camo()` (`name`, `length`,
and `toString()` answering exactly the original's text), preserves each property's original descriptor flags
(a WebIDL global operation is enumerable; redefining one as non-enumerable is what a `for..in` audit reads),
keeps the prototype chain when wrapping `Worker` (a fresh prototype drops `terminate`), and owns no
enumerable global. Bisecting the seams one at a time is a one-character edit (`var ON = 'fabxwre'`).
Measured: all seams on, the run makes 6 `/fo/` POSTs, the same as the clean control.

**Worker-realm instrumentation works now.** Two engine changes:

1. `worker_prep_script` installs `external.tracelog` in the worker realm when the host asked for a
   destination (`crate::tracelog::enabled()`), mirroring what the window bootstrap does. Without it the one
   scope an anti-bot payload owns outright is the one scope that cannot be instrumented.
2. The observer itself rides into a worker by prepending to the posted classic source (the realm a CDP
   preload cannot reach). In a run it reports `hasExt: true, hasTL: true, dwsc: function, syncHandle:
   function, tag: [object DedicatedWorkerGlobalScope]`.

**Divergences measured against the reference trace** (`assets/tracelog-0916-11.jsonl`, which is the passing
real-Chrome run and carries the same probe fields):

| probe | reference | ours |
|---|---|---|
| `uUOw3` storage flush duration | 10.6 ms (succeeded) | error string in the stub path; `0` when the worker ran as an isolate |
| `gQTuX1` fetch rejection text | `TypeError: Failed to fetch` | `TypeError: Failed to fetch: CORS error: Origin '…' not in Access-Control-Allow-Origin ''` |
| `vVsCr9` min `performance.now()` delta | `0.09999990463256836` | `0.09999999999990905` (unclamped double) |
| `graIf9` compute shard | 2658, 2717-2972 ms | 10822, 22363-23015 ms |
| `rMor4`/`eSLoU7` `/pat/` result | 1 / 401 / 0 | 1 / 401 / 0 (match) |
| timer and trusted-types probes | `1`, `TWnkF5` | `1`, `TWnkF5` (match) |

Two of those are engine defects with a clear fix: the fetch rejection text (fixed here: Chrome keeps the
reason out of `message`, and the challenge reads that string back out of a worker) and timer quantization.
The compute probe is the large one: the same workload takes about 22.9 s here against 2.9 s in Chrome, which
is why the flow never reaches its final handoff inside the harness window.

**What was tried and reverted.** Making a blob worker spawn its own isolate (its blob text is the
challenge's bootstrap, and the widget CSP allows `'unsafe-eval'` with `worker-src blob:`). It makes the
storage probe succeed and gives 15 worker realms, but it breaks the documented document-eval contract that
three tests guard, including one that aborts the process, and it does not make the challenge pass. The
revert restores the earlier state; `cargo nextest -p obscura-js` reports the same 10 pre-existing failures
before and after, so nothing here regressed.

**Status.** `1.txt` still answers with the challenge and no `POST /1.txt` is ever issued; the objective is
not met. Next actions, in order: the compute-probe slowdown (profile the worker realm's JS throughput
against the page realm), the `performance.now()` clamp, and the blob-worker eval path whose own tests fail on
this tree.

## Step 267: the compute probe is workload, not a slow realm

**Why this step.** Step 266 left the compute probe as the leading candidate: our session reported
`graIf9` = 10822 iterations in 22363 ms where the reference reported 2658 in 2904 ms, an 8x gap. The
next action was to attribute that to a realm-level slowdown (V8 flags, tiering, profile) and fix it.

**The realm is not slow.** `scripts/realm-bench.js` runs three probes (an arithmetic loop the
optimizing tier handles, a `charCodeAt`/`slice` string loop shaped like the challenge's compute, and a
float loop) in the page realm and in a real worker isolate (a `data:` URL worker, which the engine does
spawn). Iterations and warmup are identical in both realms:

| probe | page realm | worker realm | node 22 (V8 reference) |
|---|---|---|---|
| arithmetic, 300k iterations | 2.80 ms | 2.40 ms | 5.65 ms |
| string/charCodeAt, 1500 rounds | 1.10 ms | 1.10 ms | 3.41 ms |
| float, 200k iterations | 6.90 ms | 7.10 ms | 7.85 ms |

So there is no worker-realm tiering or flag defect: both realms land in the same place, at or above a
stock V8. The published claim that "the same worker script is 2658/2.9 s in Chrome and 10822/22.9 s in
Obscura" therefore compares two different *sessions*, not the same workload: `PySu2` carries the
session's ray and timestamp plus a per-session count, and `WrTo7` differs (15 against 10-11), so the
nonce landed by each session is a different draw from a per-session search. Dividing through gives 2.12
ms per unit here against 1.09 ms there, which is a real but unexplained ~2x on that one script, not the
8x the totals suggest. The engine-side implementation of `graIf9`'s script is what to profile next, not
the realm.

**Where the flow actually stops, measured.** After the second widget response the process is *idle*:
sampling `ps -o %cpu` through a 70 s run gives 26% at t=5 s, 15.7% at t=10 s, 13.2% at t=15 s, 3 /fo/
POSTs by t=20 s, then 1.6-3.4% for the next 50 s. A host-side API trace
(`--trace-api-file --trace-api-format jsonl --trace-api-keyed off --trace-api-filter …`) records 8
entries and stops at t=7.4 s, so the stall is not an awaited API either. What the engine is waiting for
after the second widget program is still open, and it is the next thing to instrument (the filter used
drops the VM's computed-key accesses by design, so the op stream, not the API stream, is the right
instrument there).

**What our session sends at that point is the same as the reference's.** The widget's second round trip
is the reference's second: 127232 response characters on both sides, decoding to a 71567 B program
there and 71569 B here. The divergence is what happens next: the reference answers with a third POST
(91724 chars) and receives the small final program (7164 chars), and one of our runs did reach that
shape (a third POST answered with 5160 characters, followed by a page-level POST answered with 3240),
while the last four runs stopped after the second response.

**Attempted: let a blob worker run its own bootstrap in an isolate.** Its blob text is the challenge's
`onmessage -> eval` bootstrap, and the widget CSP allows it (`script-src 'nonce-…' 'unsafe-eval'` with
`worker-src blob:`). Measured effect: the storage probe reports `{"uUOw3":0}` instead of
`"createSyncAccessHandle is not a function"` (the reference reports 10.6 ms), 15 worker realms run, one
5000-iteration run reached all twelve probes including the compute, and one run produced the final
handoff shape above. Cost: it breaks the documented document-eval contract that four tests guard, and
the test that spawns a blob worker in a frame realm aborts the process on a Tokio-runtime panic inside
`op_worker_recv`. Reverted, so the tree keeps its contract and its recorded 10 pre-existing failures.
Adopting it deliberately means updating those tests and giving that one a runtime; the measurements
above are the justification to do that, not this round.

**Landed this round (both verified):**

1. The fetch rejection message is now Chrome's opaque `TypeError: Failed to fetch` with the CORS reason
   kept out of it. A live run's worker reply reads `{"AXuey2":1,"gQTuX1":"TypeError: Failed to fetch"}`,
   byte for byte what the reference trace records.
2. `op_worker_recv`, `op_worker_post_to_page` and `op_worker_close` no longer panic when the embedder
   already holds the shared state borrowed. The first abort seen this round was that `RefCell`
   double-borrow unwinding into a `v8::FunctionCallback` frame (`panic_cannot_unwind`), which aborts the
   process rather than failing one call; they now degrade (empty batch, false, no-op) and the caller
   polls again. Both changes leave `cargo nextest -p obscura-js` at 610/620, the same 10 pre-existing
   failures recorded before this round.

**Surface parity against the reference payload.** The operator's decoded reference payloads
(`assets/payload/*.json`, captured pre-encryption in Chrome) carry a bucket table of every property the
VM reads. Running `scripts/diff_payload_enum.py assets/payload/2.json assets/payload/3.json` against our
engine: navigator 81 read, 1 missing (`modelContext`); document 295 read, 0 missing; screen 15, 0;
screen.orientation 9, 0; window 1238 read, 2 missing (`ModelContext`, `WebMCPEvent`). The two reference
payloads also show the profile that session presented: `rPAC6: "en-us"`, UA `Chrome/149.0.0.0`, platform
`MacIntel`. Our instrumented runs were forcing `zh-CN` and `Chrome/151`; running with the engine's own
defaults (Chrome 149, en-US) changes the interstitial's language and nothing else, so that override is
not the blocker.

**Status.** Unmet: `1.txt` still answers with the challenge, no `POST /1.txt`, and the last four runs
stop after the widget's second response. Next actions: instrument the *op* stream (not the API stream)
across that stop, profile the engine's execution of `graIf9`'s script specifically, and then adopt the
worker-isolate path with its tests updated, since it is the only configuration measured to reach the
final handoff.

## Step 268: the worker-isolate path is adopted, and seven tests come with it

**Why this step.** Step 267 measured that letting a blob worker run its own bootstrap in an isolate is
the only configuration that reached the challenge's final handoff, and left it reverted because it broke
guarded tests. This step adopts it properly, which means settling the contract those tests encode.

**The tests already described the browser contract.** The blob-worker tests build a blob *containing a
script* (`onmessage = function (e) { if (e.isTrusted && e.origin === '' && e.source === null) eval(e.data); }`)
and expect it to run: `blob_worker_reports_the_creating_origin`,
`blob_worker_relative_fetch_uses_creator_origin`, `worker_from_blob_url_round_trips`,
`worker_inherits_the_creator_fingerprint_contract`, `blob_worker_evals_posted_source_and_relative_fetch_hits_creator_origin`,
`frame_blob_worker_eval_fetch_empty_hits_frame_origin`. The tree's document-eval stub answered none of
them, which is why they were among the ten failures carried since step 266. Running the blob's text in the
isolate satisfies them.

**What changed:**

1. `Worker` construction for a blob with text spawns its isolate with that text, and a post goes to the
   isolate (the blob's bootstrap evals it there) whenever one exists; the document-eval stub remains only
   for a blob whose text is missing. Measured effect on the challenge: the storage probe reports
   `{"uUOw3":0}` instead of `"createSyncAccessHandle is not a function"`, and 15 worker realms run.
2. Two expectations moved to the worker scope, which is the contract they were probing for: `typeof
   document` inside the worker-evaled source is `"undefined"`, not `"object"` (a scope answering "object"
   evaluated the source in the creating document), while `new Request('').url` still resolves against the
   creator's origin. Both tests document that reasoning at the assertion.
3. `op_worker_recv` returns an empty batch when there is no Tokio runtime instead of awaiting a Tokio
   primitive, which panicked inside a `v8::FunctionCallback` frame and aborted the process. That is what
   `frame_blob_worker_is_allowed_by_worker_src_blob_scheme` hit once the blob worker really spawned; it
   now passes.

**Test effect, measured:** `cargo nextest -p obscura-js` goes from **610/620 to 617/620**. The three
remaining failures are the unrelated pre-existing ones (`link_elements_use_their_own_interface_and_resolve_urls`,
`initial_about_blank_inherits_creator_origin_domain_and_referrer`,
`sandboxed_initial_about_blank_keeps_opaque_origin_and_domain`), untouched by this work. The release build
passes.

**Where the flow stands on the final build, inside the 30 s budget.** A compliant run (click at 10 s, read
at 17 s) makes the reference's three round trips: 2370/113760, 4994/823024, 88546/127240 characters, with
no `POST /1.txt`. Host-op tracing (`--trace-op-file`) shows the flow is still *working* where the earlier
stub build had already gone quiet: at 17.6-18.8 s the widget script is probing the DOM it just built
(`option` attributes, a `range` input) and posting a second round of worker tasks, while about 60% of that
window is spent inside `op_dom` calls from the widget's own script. The challenge's compute probe alone
reports ~23 s here against ~3 s in the reference, so the step after the second response lands at or past
the 30 s boundary, which is why a 26 s read sees the harness's "still on the challenge" rather than a
submit.

**Status.** Objective still unmet: `1.txt` answers with the challenge, `POST /1.txt` never happens. The
engine is materially closer (worker realm faithful, seven tests recovered, fetch text and op robustness
fixed) and the remaining gap is quantified: the post-second-response step, dominated by DOM-op cost and
the compute probe's own ~23 s.

## Step 269: the payload plaintext is in the console log, and the field-level diff

**Why this step.** Every previous round treated the `/fo/` bodies as opaque because they are encrypted, and
went looking for a session key. They are not opaque at the source: the challenge logs its payload object
before encoding it (`console.log('payloadJSON:', …)`), and the engine's console stream captures that line
in full. One compliant run therefore yields our session's *field-level plaintext* payloads, no key needed.

**How to get them.** `grep -o 'payloadJSON: .*' <run>/serve.log` (strip ANSI first). A run yields one line
per submission: the widget's payload (47 fields) and the page's (91 numbered records). Saved copies of one
session's pair are `assets/payload/obscura-1.json` and `assets/payload/obscura-2.json`-equivalent.

**Field-level diff against the reference.** `assets/payload/1.json` is the operator's decoded capture of a
passing Chrome session. Our payload 1 has **the same 47 keys, none missing and none extra**. Values split
into three groups:

- Per-session by construction: the ray (`BkYo5`), the issued tokens (`oPhMk5`, `JWTz7`, `oQJEH1`,
  `WbdgY0`), the timestamp (`Uheo3`), the target URL (their capture was `123.txt`, ours `1.txt`), and the
  api.js URL string.
- Counters and durations of the collection phase: `ZMSOw0`/`twvE0` 1181 (reference) against 466 (ours),
  `NnqX6` 1284 against 569, `uGyjw9` 4 against **508**, `Blsob5` 9 against 3, `poqG1` 2 against 1,
  `TzZRB1` 16 against 17, `WHTpH6` 17 against 18, `tZwbF3` 5178 against 3797, `wOvYJ5` 2123 against 3792,
  `eaaP6` 2108 against 3280.
- Resource timing records (`rPXg2`), where ours are inflated: the api.js entry reads `EazF1` 2932 and
  `gtlhH0` 1383 where the reference reads 561 and 280, and the widget frame reads 2417 against 1623. The
  run log shows api.js completing in 245-620 ms, so a ~2.9 s duration is not the fetch.
- The error record (`PWGF4`) carries the same api.js stack in both sessions but a different time
  (`t` = 5 ms here against 3054 ms there).

**Field names are per-session, so compare by shape.** The page payload's record field names differ between
the two captures (`gsLi5`/`XCvwf5` here against `omMvP9`/`zIyO8` there); only their *shape* is comparable,
which is what `scripts/diff_payload_enum.py` does when it pulls the property-path bucket out of whichever
key holds it. That bucket is present in our payload with the same `n.`/`d.`/`s.`/`so.` prefixed paths, and
the enum diff already covers it (only `modelContext`, `ModelContext` and `WebMCPEvent` missing).

**Op-stream cost, measured on the same run.** 47041 host-op crossings over 33.4 s, of which 46993 are
`dom`. The collection burst is only ~2 s (43k of them at 11-12 s, ~47 us each), and the remaining ~30 s is
idle: 37 gaps over 100 ms account for 29.8 s of the 33.4 s span, and after 19 s the widget frame does a
~900 ms poll (`is_connected`, `query_selector_scoped #cf-chl-widget-…`, `iframe_content_document_root`,
`iframe_scopes_same_origin`) whose last query returns -1. So the DOM-op *cost* is not what crowds the 30 s
window; the flow is waiting, and the page-side program has gone quiet by then.

**Status.** Unmet: `1.txt` still returns the challenge and no `POST /1.txt` is issued. What changed is that
the decision data is now readable in plaintext from our own runs, so the next round can diff values (the
inflated resource timings above are the most concrete candidate, since they are 5x off and land in the
payload) instead of hunting for a key.

## Step 270: resource timing is not inflated, worker timers fire, and the local proxy hop is not it

**Why this step.** Step 269 left three candidates: the resource-timing entries (ours read 2932/1383 where the
reference read 561/280), the payload counters (`uGyjw9` 4 against 508, `ZMSOw0`/`twvE0` 1181 against 466),
and the possibility that the last leg before `POST /1.txt` never runs. This step tested the first and closed
two other possibilities with controls.

**Resource timing is not inflated.** `scripts/dump-resource-timings.js` dumps this realm's
`performance.getEntriesByType('resource')` entries after 20 s, so they can be read against the same run's
engine log. Measured on one run: orchestrate `startTime` 1273, `duration` 466, `responseStart`/`responseEnd`
1739, `transferSize` 232975; the `/fo/` XHR `duration` 219 with sizes 114072/113772; the widget frame
`duration` 2272; and api.js `duration` 1169 with `requestStart`/`responseStart` and every size at **0**,
which is what Chrome exposes for a cross-origin resource without Timing-Allow-Origin. The engine log for the
same run reports api.js completing in 1169 ms, i.e. the entry's `duration` is the transport time the client
measured, not an inflation. The payload's larger number came from a session where api.js really did take
about 2.9 s; the reference's 561 ms is a faster path, not a different formula.

**Worker timers fire at every delay tested.** A page creating one worker per delay (0, 55, 500, 1500, 5000,
10000 ms), each posting its delay back, reports `final:[0,55,500,1500,5000,10000]`. So the isolate path does
not strand long timers, and the stall after the third response is not a missing timer reply.

**The local proxy hop is not the difference either.** Every instrumented run this session went through a
local `mitmdump` in front of the operator's proxy. Running straight at `http://192.168.3.57:9000` reproduces
the same shape: three `/fo/` submissions (2380, 4983, 88919 bytes of request against 113776, 822944, 127232
characters of response), no `POST /1.txt`, and api.js at 1390 ms against 1169 ms with the hop. So the extra
hop costs tens of milliseconds, not the flow.

**What the runs agree on.** Three submissions then silence, with the widget frame polling
`#cf-chl-widget-…` every ~900 ms and the page-side program quiet, whether or not a local proxy sits in
front, whether the click lands at 6 s or 12 s, and in both the instrumented and clean configurations. The
step after the third response is where the reference posts its fourth submission, and that is the thing to
instrument next; the counters (`uGyjw9`, `ZMSOw0`/`twvE0`) are per-session field names, so they have to be
matched by shape before they can be compared at all.

**Status.** Unmet: `1.txt` still returns the challenge and there is still no `POST /1.txt`.

## Step 271: the stall is one statement after `new Worker`, measured in both realms

**Why this step.** Step 270 closed with "the step after the third response is where the reference posts its
fourth submission, and that is the thing to instrument next". This step instruments it, with the native host-op
stream as the primary instrument and the validated in-flight realm probe (`challenge-realm-probe.js`) only as
the seam that names the statement. It also rules out four candidates that each had a plausible mechanism.

**The stall is not slowness.** A 75 s window (click at 10 s, read at 70 s) still ends with exactly three
submissions: top-level `/fo/` #1, widget `/fo/` #1, widget `/fo/` #2 (the proof). Nothing after that, ever.
So the flow is parked, not slow, and the 30 s budget is not the binding constraint.

**CPU sampling says "parked", with a caveat.** `ps -o %cpu=` through one round reads 52.7 / 9.1 / 9.7 / 31.3 /
72.6 / 86.2 / 100.4 % up to t=20 s, then 0.6 / 1.3 % from t=22 s on. The burst is real work and the tail is
idle. Caveat: macOS `ps -o %cpu` is not an instantaneous rate, so this is corroboration only — the "parked"
claim rests on the host-op stream going silent, not on the percentage.

**The page's `honk` loop is a wait primitive, not the divergence.** The op stream's last 40 records are a loop
of `eval` calls, one every ~0.55 s, forever. The argument is a 1 337 359-character string: **1 337 331 leading
spaces** followed by `0, /.*honk.*/, <epoch ms>`. Its stack names the caller: `nO.nn` in
`orchestrate/chl_page/v1` — the page realm, not the widget. The reference does the same thing (35 `globalThis.eval`
points carrying the identical padded `honk` expression, ~175-550 ms apart over 7.7 s, stopping when the widget
finishes). So `honk` is the challenge's own yield/wait primitive, and the page sitting in it means the page is
waiting for the widget's handoff.

**`meow`/`food` is the keepalive handshake, not the handoff.** The widget document carries the handler
(recovered from the reference HAR at the same stage):
`if (e.source === 'cloudflare-challenge' && e.event === 'meow' && e.widgetId === window._cf_chl_opt.EnOnL8)
window.parent.postMessage({source:'cloudflare-challenge', widgetId:…, event:'food', seq: e.seq}, '*')`.
Our run exchanges this pair to `seq` 31+ with both realms alive, which is why "the widget is dead" is the wrong
reading; the widget is up and its program is not advancing.

**Where the widget stops, exactly.** The widget realm's exit sequence in one round, in order:

| # | event |
|---|---|
| 126 | `URL.revokeObjectURL` (at `TH.yU`) |
| 127-129 | XHR `POST /fo/315550264:…/<ray>` — the proof, 91 074 bytes |
| 131 | response 200, 127 240 characters |
| 132-134 | `atob(127240) → 95424`; `runProgram(95424)`; `atob(95424)` |
| 135 | `URL.createObjectURL(blob)` — a 292-byte `text/javascript` blob |
| 136 | **`new Worker(blob:https://challenges.cloudflare.com/<uuid>)` at `TH.yg`** |
| 137+ | nothing from this realm; only the page's `honk` loop and the `food` keepalives |

Three independent instruments agree that the caller does nothing with that worker: no
`Worker.prototype.postMessage` (probe wrapper), no `onmessage` assignment and no `addEventListener`
(descriptor-preserving probe seams), and — decisively — **zero property `get`/`set` on the returned worker
object** while it was wrapped in a `Proxy`. So execution stops on the statement immediately after `new Worker`,
with no exception (the constructor wrapper's `ctor.threw` seam never fired) and no error on the page.

**What the reference does there.** After the same stage's program (95 428 B) the reference constructs five
workers ~400 µs apart and then, per the ov2 host trace, runs
`ov2.host.call2 {method:"push", recv:"[object Array]", args:["[object Worker]"]}` →
`ov2.host.write {obj:"[object Worker]", key:"onmessage", val:"fn:bound m0"}` →
`ov2.host.call2 {method:"postMessage", recv:"[object Worker]", args:["var nSMXN7={…"]}`, and receives
`MessageEvent.data.graIf9` with `OMba9` shard timings 116 ms later. So the divergence is exactly one statement
wide: the reference pushes the worker, assigns `onmessage`, and posts the task; we do none of the three.

**Ruled out this round, each with its own measurement.**

1. **`op_worker_recv` empty-batch contention stranding the reply.** The JS receive loop treats an empty batch as
   "the worker is gone" and stops polling, and the Rust op returns an empty string on transient borrow
   contention, so a single transient hit would strand every later message. Instrumented
   (`OBSCURA_DEBUG_WORKER`), the empty batches that occurred were all `outbox-closed` — the worker thread really
   had exited — and no `opstate-borrowed` / `shared-state-borrowed` / `no-tokio-runtime` case was observed. The
   hazard is real but it is not what happens here.
2. **The V8 watchdog killing the task mid-script.** `cdp_watchdog` (5 500 ms per autonomous turn) and
   `arm_watchdog` were both instrumented. Neither fired: `disarm_watchdog`'s
   `"V8 watchdog fired: terminated a synchronous overrun"` warning is absent from all seven runs, and the
   autonomous-turn counter never incremented. A silent `terminate_execution` cutoff would have matched the
   symptom exactly; it does not occur.
3. **Cross-realm `postMessage` delivery.** Both directions flow continuously (`meow`/`food`, `seq` to 31+), so the
   handoff channel is healthy; what is missing is the handoff message, not its transport.
4. **A broken blob-worker fan-out in general.** A local fixture reproducing the reference's exact sequence
   (`new Blob` → `createObjectURL` → `new Worker` → `arr.push(w)` → `w.onmessage = fn` → `w.postMessage(task)`,
   five shards, the same 292-byte `onmessage -> eval` bootstrap) completes 5/5 replies in the engine. So the
   constructor, the blob store, the postMessage path and the recv loop all work for this shape; whatever breaks
   is specific to the challenge's state at that point.

**Also measured, not yet attributed.** Our session loads the turnstile widget document **twice** (two
`rp.installed` for `challenges.cloudflare.com/…/turnstile/…` realms, at indices 17 and 189 of one run), where
the reference HAR holds exactly one `/turnstile/f/av0/rch/…` document request. The second realm is the one that
runs the proof step and then stops. Whether that second load is a cause or a symptom is open.

**Instrumentation added (all host-side, opt-in, off by default).** `OBSCURA_DEBUG_WORKER=1` reports worker
isolate spawn/exit and the reason a receive returned empty; `OBSCURA_DEBUG_WATCHDOG=1` reports a watchdog budget
overrun. Both write to stderr, so neither is page-visible — which matters here, because a page-visible probe
stops the flow before the stage under observation (see `honk` above and step 266).

**Measurement pitfalls found this round.**

- **A page-visible install probe perturbs the run.** Extending the `rp.installed` record with
  `document.scripts.length`, `documentElement.outerHTML.length` and a `Math.random()`-derived realm id made the
  page go blank (62 trace records instead of ~300, empty body). `Math.random()` shifts the PRNG the challenge
  samples, and an early DOM serialization is itself observable. Keep the install record minimal.
- **A `Proxy` around the worker changes identity** (`instanceof`, `String()`, descriptor reads). It is acceptable
  for the "what does the caller touch next" question and nothing else; the answer it gave (no touch at all) was
  cross-checked with the non-invasive postMessage/onmessage seams.
- **The page-side `[worker] out queued` / `out deliver` logs no longer fire** since the blob-worker isolate path
  landed (step 268), because those are logs of the document-eval stub. Worker→page traffic now has to be read at
  the host (`OBSCURA_DEBUG_WORKER`) or inside the worker realm; reading only the page-side logs makes the worker
  look mute.

**Status.** Unmet: `https://www.thelancet.com/1.txt` still answers with the challenge, no `POST /1.txt`, and the
click run is still 0/6. The divergence is now pinned to a single statement — the one after the widget's
`new Worker(blob:)` in the program that answers the proof submission — and the four candidate mechanisms that
could cut a caller off there (stranded worker reply, watchdog termination, message-transport failure, a broken
blob-worker fan-out) are each measured and excluded. Next actions: attribute the widget program's stop at
`TH.yg` from the program side, which needs the *current* session's program (the build is re-randomized per
session, step 266), and settle whether the duplicated turnstile document load is causal.

## Step 272: the duplicate widget document is a Critical-CH retry, and it is not the stall

**Why this step.** Step 271 left two open questions from the objective's next action: instrument the widget
program at the stop, and settle whether the duplicated turnstile document load is a cause or a symptom. This
step answers the second with a wire capture and a call stack, lands a fix for it, and adds the frame-route
instrumentation the program-side question needs.

**The duplicate is real, and it is not a second frame attachment.** A local `mitmdump` in front of the operator
proxy (`--mode upstream:http://192.168.3.57:9000`, port 8896) records the same widget URL requested twice in one
round, back to back, with identical headers and `sec-fetch-dest: iframe`, both before any widget script runs. The
reference HAR holds exactly one such request. It is *not* caused by two browsing contexts: `OBSCURA_DEBUG_FRAMES`
shows **one** committed navigation for that host in the round (`[frame-commit] … host=NodeId(67) gen=1`), and a
call stack taken inside `StealthHttpClient::fetch_with_profile` is entered **once**:

```
obscura_net::wreq_client::StealthHttpClient::fetch_with_profile
obscura_browser::page::Page::navigate_frame_inner
obscura_browser::page::Page::process_pending_frame_navigations
```

So the second HTTP request is issued *inside the client*, by the `Critical-CH` retry.

**Proven from the headers.** The widget document request carries the low-entropy trio only
(`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`). The response carries

```
Accept-CH:   Sec-CH-UA-Bitness, Sec-CH-UA-Arch, Sec-CH-UA-Full-Version, Sec-CH-UA-Mobile,
             Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List, …
Critical-CH: (same list)
```

The client retries because those hints are not in `sent_client_hints`, and the retry request then carries **nine**
`Sec-CH-UA-*` headers. The reference sees the *same* response: its HAR shows the widget document request with the
same trio and the same `Accept-CH`/`Critical-CH` list, and **one** request for it. Chrome does not retry.

**Fix.** `is_frame_document_request` (crates/obscura-net/src/client.rs) — a subframe document navigation is not
re-issued for `Critical-CH`. Both transports are guarded (`wreq_client.rs` for the stealth path that a stealth
run uses, `client.rs` for the fallback). The hints a retry would add are not permitted in a cross-origin
subframe, so the retry cannot change the response it is retrying; the only effect measured was a second document
load, and therefore a second widget session for a document only one of which is ever committed.

**Quantified.** Same build, same identity, three rounds through the wire capture:

| round | widget document requests before | after | `sec-ch-ua-*` count per request |
|---|---|---|---|
| 1 | 2 | **1** | `[3]` |
| 2 | 2 | 2 (a genuine second navigation) | `[3, 9]` |
| 3 | 4 | **1** | `[3]` |

The pre-existing tests still pass (`stealth_client_retries_critical_client_hints` and
`stealth_extra_low_entropy_headers_do_not_duplicate_defaults`), so the retry is preserved where it is legitimate.
The new test `stealth_frame_document_is_not_retried_for_critical_client_hints` **fails without the guard** and
passes with it. `obscura-net` is 104/104.

**Cause or symptom: settled as "neither".** Rounds whose wire capture shows exactly **one** widget document still
stall identically — three `/fo/` POSTs (top #1, widget #1, widget #2 proof) and then silence, final URL still on
the challenge. So the duplicate load is a separate engine defect that creates an extra widget session; it is not
required for the stall, and removing it does not advance the flow. Both are true at once and neither explains the
other.

**Program-side instrumentation for the stop (the other half of the ask).** `OBSCURA_DEBUG_FRAMES=1` now reports
every frame-navigation route, every `attach_child` (with the host's current frame, if any), and every committed
frame navigation. Everything is on stderr, so nothing is page-visible.

**A latent defect found on the way, recorded but not attributed.** `navigate_frame_inner`'s nested-frame
discovery attaches a child for every iframe in the committed content root **without** the
`frames.by_host(host).is_none()` guard that the other two discovery passes (`discover_main_document` and
`process_pending_frame_navigations`'s `discovered` loop) apply. A host that survives into a second commit can
therefore acquire a second browsing context. It did **not** reproduce in the three sampled rounds (each attached
host 67 exactly once, `already=None`), so it is a hazard rather than the measured cause; the log line exists so
the next round can catch it if it fires.

**Payload 对拍, from this session's own console stream.** The engine's op trace records the challenge's
`console.log('payloadJSON:', …)` lines in full, so a clean run yields the session's field-level plaintext without
any instrumentation of the page (`grep -a 'payloadJSON' ops.tsv`; note `serve.log` does not forward frame-realm
`console.log`, which is why earlier rounds read 0 there). Our proof payload has the **same 53-name non-numeric
field vocabulary** as the operator's proof captures `2.json`, `2-2.json` and `3.json` — the names match
one-for-one — and the same record types; only the ordering of some numbered records differs (`ours[4]` ==
`ref[5]`, `ours[7]` == `ref[8]`), and two named fields differ in list length (`rPXg2` 4 against 5, `maNnU6` 39
against 37). So the proof payload is *structurally aligned*; the divergence is not a missing or extra payload
field.

**Measurement pitfalls added to the table.**

- **macOS `ps -o %cpu=` is not an instantaneous rate.** A reading that drops from 100 % to 1 % across a stall is
  corroboration, not a measurement; the "parked" claim has to rest on the host-op stream going silent.
- **An install-time probe that calls `Math.random()` or reads `document.scripts.length` /
  `documentElement.outerHTML.length` perturbs the run** — the page went blank (62 trace records against ~300,
  empty body). `Math.random()` shifts the PRNG the challenge samples. Keep the install record minimal.
- **A `mitmdump` addon must take its log path from the environment.** A hardcoded path silently merges successive
  runs, so a per-run request count reads as the sum of all of them.
- **`grep` treats the op trace and `serve.log` as binary** (ANSI escapes, control bytes). Use `grep -a`, or a
  count of 0 will look like "absent" when it is "not searched".

**Status.** Unmet: `https://www.thelancet.com/1.txt` still answers with the challenge, no `POST /1.txt`, click
run still 0/6. Removed this round: one real defect (a duplicate widget document, and with it a second widget
session) with a regression test. Next: the widget program's stop at `TH.yg` still needs the program side — the
current session's `orchestrate`/proof-response program, disassembled or instrumented in place — and the
`nested_discovery` attach path needs a guard test if it is confirmed to fire.

## Step 273: the caller returns — program-side measurement of the `new Worker` stop

**Why this step.** Step 271/272 localized the stop to the statement after `new Worker` in the program that
answers the proof submission. This step asks the program side directly: what does that program do, and how does
it end?

**How each program is driven (new, measured).** The `runProgram` seam was extended to record the call's
*outcome*, and the executor it returns was wrapped too. Two findings:

1. `runProgram(text, b)` **builds** the program and returns its executor. It returns **synchronously** in
   3-24 ms with a `function () { [native code] }`; it does not run the program.
2. Each program is then executed by **one** call to that executor, which returns `undefined` synchronously and is
   **never called again** (`call=1`, observed for 16 s afterwards).

| program | executor duration |
|---|---|
| page inline (6032 B) | 634 ms |
| page, answers top #1 (85324 B) | 108 ms |
| widget inline (6944 B) | 915 ms |
| widget, answers `/fo/` #1 (634516 B) | 627 ms |
| **widget, answers the proof (95428 B)** | **107 ms** |

**What the proof-response program actually does.** Its complete observable host activity, in order, from the
probe: `URL.revokeObjectURL` → `new Blob(292, text/javascript)` → `URL.createObjectURL` → `new Worker(blob:)` →
**return**. It never assigns `onmessage`, never calls `Worker.prototype.postMessage`, and registers no
continuation (no timer, no message handler, no promise) — so nothing re-drives it. The constructor-throw seam
stayed silent, and the host-op stream goes silent at the same point, so the same reading is reached from two
independent instruments.

Whole-run counts in that round: **5** `new Blob`, **5** `createObjectURL`, 7 `Worker` constructions. The
reference's post-proof window *alone* holds **9** Blobs, **58** `createObjectURL` calls and 5 `Worker`
constructions before it does `push → onmessage → postMessage`. So the two runs are not doing the same work at
that stage; ours leaves the fan-out after one iteration.

**Answer to the asked question, as far as measurement reaches:** the caller does not execute
`push → onmessage → postMessage` because **it returns** immediately after constructing the worker. That is a
program-level early exit, not a blocked call, not a lost message, and not a terminated script — the three
mechanisms that could produce the same symptom were each excluded in step 271 and are consistent with this.

**The native property trace cannot serve as the program-side instrument here (measured).** Two runs:

| flags | trace size | `/fo/` POSTs reached |
|---|---|---|
| `--trace-api-keyed off` (no filter) | 842 746 lines / 175 MB | **0** |
| `--trace-api-keyed on --trace-api-filter 'URL,Blob,Worker'` | 831 499 lines / 160 MB | **0** |

Under either, the run never issues a single `/fo/` POST — the trace's own overhead stops the flow long before
the stage under study (the interstitial even renders its slow-device message). So the objective's
"compare with our own environment and V8 native trace" is, for *this* stage, not available: the trace cannot
observe what its cost prevents from happening. Recorded as a hard limitation rather than a method.

**The flow is session-dependent, not permanently stalled at three submissions.** One round through the local wire
capture completed the reference's full sequence:

| # | request | ours | reference |
|---|---|---|---|
| 1 | top-level `/fo/` #1 | req 2380 → resp 113768 | req 2359 → resp 113772 |
| 2 | widget `/fo/` #1 | req 4802 → resp 822864 | req 4674 → resp 822624 |
| 3 | widget `/fo/` #2 (proof) | req 87938 → resp 127240 | req 89804 → resp 127228 |
| 4 | widget `/fo/` #3 | req 91180 → **resp 5136** | req 93026 → **resp 7164** |
| 5 | top-level `/fo/` final | req 7820 → **resp 3240** | req 9026 → **resp 3660** |

That is step 262's finding reproduced on the current build: we do reach the end, the final response is the
*shorter* one, and the page then starts a **new round** instead of submitting the form to `/1.txt`. So the
30 s budget is not the binding constraint, and the four-submission stall seen on other rounds is one of two
outcomes rather than the blocker.

**The decode and disassembly pipeline now runs on our own programs (new, validated).** `/fo/` response bodies
were captured through a local mitmdump and decoded with the published pipeline
(`seed = 32 ^ xor(charCodeAt(ray + "_0"))`, `stage1 = atob(body)`,
`out[i] = js_mod((255 & s1[i]) - seed - (i % 65535) + 65535, 255)`, `bytecode = atob(out)`). All seven responses
decode with **`b64frac = 1.000`** — stage 2 is pure base64, which is what proves the ray-derived seed is the
server's rather than a working guess.

| file | program | stage1 | bytecode |
|---|---|---|---|
| `bc_00` | page, answers top #1 | 85324 | 63993 B |
| `bc_01` | widget, answers `/fo/` #1 | 617148 | 462859 B |
| **`bc_02`** | **widget, answers the proof** | 95428 | **71571 B** |
| `bc_03` | widget, answers `/fo/` #3 | 3852 | 2887 B |
| `bc_04` | page, final | 2428 | 1821 B |

The operator's toolchain was copied to `/tmp/ov2-our` (their tree untouched) and, as a control, reproduces their
own sample analysis (ov1#2 span coverage 100 %). Fed our `bc_02`, it decodes **67 695 / 71 571 bytes = 94.58 %**
with **0 unresolved roles** and renders **17 356 instructions**; role distribution `objectInit 15379`,
`binaryMux 460`, `methodCall 450`, `condJump 210`, `hostRead 138`, `hostWrite 116`, `hostNew 32`,
`literalLoad 43`, `tryPush 32`, `hashJump 32`, `jump 30`. So the program is statically legible, and it is
branch-heavy: 210 conditional jumps over 17 k instructions.

**Where the names are — scope correction for the next round.** `ov1_strprobe.py` (the VM's own string encoding,
key searched over all 256 values) finds **none** of `Worker`, `postMessage`, `onmessage`, `createObjectURL`,
`revokeObjectURL`, `Blob`, `push`, `_cf_chl_opt` in `bc_02` (71 KB) **or in `bc_01`** (463 KB) — while step 266
recovered exactly those kinds of name from a 475 KB program of another session. So in this session's programs the
host-API names are **not** bytecode constants; they live in the VM interpreter, which is the widget document
itself. A branch can therefore only be attributed by combining the program with the interpreter's handler
semantics (the operator's `spec-0916-11.mjs` plus the widget document text), not from the program bytes alone.

**Artifacts.** Bytecode: `/tmp/lancet-prog/bc_0{0..6}.bin` (+ `fo_index.jsonl` with ray, status, sizes).
Disassembly: `/tmp/ov2-mine/anchor-cfg-out/ov1-2-disasm.txt` (1.1 MB) and `.json` (4.1 MB), with the toolchain at
`/tmp/ov2-our` (a control copy) and `/tmp/ov2-mine` (our program as sample 2).

**Status.** Unmet: `1.txt` still returns the challenge and no `POST /1.txt` is issued. Gained this round: the
program-side statement (the caller returns after constructing the worker, with no continuation registered), the
measured impossibility of using the native property trace at this stage, the session-dependence of the stall, and
a working decode + disassembly pipeline for the current session's programs with the scope of the next step
narrowed to program-plus-interpreter.

## Step 274: the OPFS flush is a no-op, and the stall is the norm (not a proxy artefact)

**Why this step.** Step 273 narrowed the next action to reading the program together with the interpreter. Before
investing in static work I removed a confound that had been muddying every conclusion, and while measuring the
environment surface I found a concrete engine defect with a measured signature.

**The local proxy hop is not a confound (n=3 + 3).** Step 273's run that completed all five `/fo/` submissions went
through a local `mitmdump`; the direct-proxy runs stalled after three. Measured, same build, same identity, six
rounds, counting `/fo/` POSTs from the engine's own op trace:

| arm | rounds | `/fo/` POSTs | verdict |
|---|---|---|---|
| direct (`--proxy http://192.168.3.57:9000`) | 3 | 3 / 3 / 3 | still on the challenge |
| hopped (`--proxy http://127.0.0.1:88xx`, upstream = the same operator proxy) | 3 | 3 / 3 / 3 | still on the challenge |

So the hop changes nothing, and **the three-submission stall is the norm**; step 273's five-submission run was
session luck (about one round in eight across this session's sampling). Both failure signatures therefore exist and
neither the hop nor the 30 s budget selects between them.

**A concrete engine defect: the OPFS sync access handle never does I/O.** The reference's environment probe times a
`FileSystemSyncAccessHandle` write and flush and reports the duration (`uUOw3` = **10.6 ms**). A worker-realm
fixture in our engine, running the same pattern, measures:

```
{"gotDir":true,"hasSync":"function","writeMs":0,"flushMs":0,"size":64,"closed":true}
```

The shape is right — `getDirectory` → `getFileHandle({create})` → `createSyncAccessHandle` → `write` → `flush` →
`getSize` → `close` all work, and the shape test
`storage_manager_and_origin_private_file_system_match_chrome_shape` passes. But `flush()` is
`nativeMethod(SyncAccessHandle.prototype, 'flush', 0, function () { syncData(this); })` — it validates state and
returns, and the file node is a `Uint8Array` on an in-memory tree, so nothing is ever written to or synced with a
device. Hence 0 ms where the reference measures 10.6 ms.

Two notes on scope, so the finding is not over-read:

- **The API is worker-scoped in our engine and in Chrome**, so a page-realm fixture correctly reports
  `fh.createSyncAccessHandle is not a function` (`hasSync: undefined`). That is not the defect; the worker-realm
  path is the one the challenge uses, and that is where the duration is degenerate.
- Making the duration realistic is a **feature, not a patch**: it needs the OPFS node backed by real files (the CLI
  already has `--storage-dir`, but it is not plumbed to the worker realm's handle tree), with per-origin
  directories, permission handling and cleanup. Recorded as the concrete next action rather than half-done here.

**Refuted, with a validated decode on both sides: the "handoff literals" reading.** Step 265 claimed the reference's
third program carries `_cf_chl_opt` / `postMessage` / `widgetId` / `token` / `source` and ours does not; step 266
retracted it as a mis-seeded decode. Decoding both sides properly settles it — the reference's own HAR carries all
five `/fo/` response bodies, and all five decode with **`b64frac = 1.000`** (pure-base64 stage 2, i.e. the
ray-derived seed is the server's):

| stage | reference | ours | delta |
|---|---|---|---|
| #0 page, answers top #1 | 63994 B | 63993 B | +1 |
| #1 widget, answers `/fo/` #1 | 462724 B | 462859 B | -135 |
| #2 widget, answers the proof | 71564 B | 71571 B | -7 |
| **#3 widget, answers `/fo/` #3** | **4029 B** | **2887 B** | **-1142** |
| #4 page, final | 2056 B | 1821 B | -235 |

`ov1_strprobe.py` (the VM's own string encoding, key searched over all 256 values) finds **none** of `postMessage`,
`_cf_chl_opt`, `widgetId`, `token`, `source`, `onmessage`, `Worker` in **either** side's stage-3 program. So the
names are not bytecode constants on either side, and the size difference at stage 3 is not a missing handoff
literal. Consistent with step 273: the host-API names live in the VM interpreter.

**And the divergence is not the stage-2 program either.** Ours and the reference's stage-2 programs are 71571 and
71564 B — seven bytes apart. The same program leads the reference to widget #3 and leads us to a return after
`new Worker` (and sometimes, one round in eight, to widget #3 as well). So the branch input is **not** in the
program text; it is a value the program read earlier, which is why the proof-response program's 107 ms contains no
host reads at all.

**Static reading of the branch is not available either (measured limitation).** The operator's disassembler renders
our blob at 94.58 % byte coverage and 0 unresolved roles, but every operand prints as `h[?]` — the anchors input
carries a *representative* `(pc, key)` per pc, not the entry-chain-derived one, and for our blob
`dynamicReachable = 0`. The header states it outright: the input "不含入口链的第二步". Without the path-derived key
the operands (and therefore the branch constants) do not resolve, so the executed branch cannot be read statically
for a session whose bytecode was never run under the operator's own instrumentation.

**Where that leaves the program-side attribution.** Three routes are now measured and closed: the native property
trace (too expensive to reach the stage), the reference's handoff-literal claim (refuted on both sides), and static
operand resolution for our blob (keys are representative, not path-derived). The route that remains is a runtime
`(pc, key)` trace from *our* session — which is exactly what the operator's pipeline expects in
`ov1-N-pcstates.jsonl` and obtains from an instrumented build.

**Artifacts.** Reference bytecode `/tmp/refprog/rbc_{0..4}.bin` (decoded from
`assets/thelancet-trace/www.thelancet.com_2026_09_16_17_43_57.har`, all `b64frac = 1.000`); ours
`/tmp/lancet-prog/bc_0{0..6}.bin`; disassembly `/tmp/ov2-mine/anchor-cfg-out/ov1-2-disasm.{txt,json}`; six-round
A/B under `/tmp/lancet-ab/{direct,hopped}{1,2,3}`; OPFS fixtures `/tmp/opfs/{index,worker}.html`.

**Status.** Unmet: `1.txt` still returns the challenge and no `POST /1.txt` is issued. Gained this round: the hop
confound removed with n=3+3, the stall calibrated as the norm, the "handoff literals" reading refuted on both sides
with a validated decode, the stage-by-stage size table refreshed, the static-operand limitation measured, and one
concrete engine defect isolated — the OPFS sync access handle performs no I/O, so the challenge's storage probe
reads 0 ms where a browser reads 10.6 ms.

## Step 275: a runtime `(pc, key)` trace from our own session, and why the operator's spec cannot read our blob

Step 274 asked for runtime states because the static route is closed. This round produced the first runtime
`(pc, key, op)` trace of our session, and in doing so measured that the operator's spec is a *per-build* artefact
that our session's build does not match. Both facts are independent of the proxy and of the challenge's network.

**Why the static pipeline could never work for our blob (measured, not inferred).** `anchor-cfg.mjs` hardcodes the
entry as `(pc=0, key=241)` in three places (lines 384, 998, 1286) and asserts it (`SPEC.keyRunInit === 241`). Run
against our stage-2 blob the pipeline emits exactly one state —
`{"pc":0,"key":241,"op":147,"handler":"m7","status":"noWidth","coverBytes":null,"advanceBytes":null}` — so nothing
propagates and `dynamicReachable` stays 0, which is why every operand renders as `h[?]`.

- Their own key-oracle probe settles the cause. `tools/probe_key_oracle.mjs 0 0 40` on *their* program walks 20 steps
  at `key=241` with `approx=0` (`op=84`, handler `cl`) — the tool and the seed are correct for their build. The same
  probe at `pc=0` of our stage-2 program finds **no key that walks past 4 steps** (best: `key=48`, `op=82`, handler
  `cS`, `approx=1`), and the tool prints its own verdict: `对位本身错了，不是 key 公式问题`.
- The width oracle returns `null` there because `cS` is a *branchy* handler (`loopWidths.base = 5`,
  `widthByBranch = [5,2,3,2,2,2]`): its width is a function of runtime state, which is the one input the static pass
  does not have. So `pcstates` is required *input*, not an accelerator, and the entry state the tool hardcodes is
  both wrong for us and unusable.
- **A structural, key-independent proof that the opcode numbering is per-build.** Our own widget document carries the
  dispatch switch in readable form, one decode site (offset 56447) inside a single `<script nonce=…>`:
  `switch (Tb[TR] = Z + 1, Z = Tb[Tv] ^ 251 + TY[Z] & 255.28, Th = Tb[Tv] + Z, Tb[Tv] = <lcg>, Z) { case 0:
  yj[GI(Ba.Ts)](this); break; … }`. It lists **69 ops** — the same count as the operator's table — but only **26
  are in common**. Two builds, two 69-element sets, 43 members different on each side. Our decode constant is `+251`;
  theirs is `+245`. Note also that the 138 extracted `case` labels are 69 distinct values appearing twice (a
  duplicate-label switch), so the second copy is dead code and one patch site covers the running dispatch.
- This also corrects step 274's reading of "94.58 % byte coverage / 0 unresolved". At any pc, 69 of 256 keys decode to
  a valid op, so a byte is "covered" if *some* key maps it; the figure is near-vacuous and is not evidence that a
  coherent path was decoded.

**The runtime trace itself.** Captured by patching the widget document in flight (mitmproxy upstream through
`192.168.3.57:9000`) so the VM dispatch loop calls `external.tracelog('ovpc', "pc,key,op,…")`; written with
`--tracelog-file` to `/tmp/ovpc/trace.jsonl`. 24 200 `(pc, key, op)` states, 242 batches.

- Entry is **`(pc=0, key=121, op=17)`**, three times over (indices 0, 214 and 23773) — one program instantiated
  three times. `(251 + bc[0]) & 255 = 121 ^ 17 = 104` ⇒ `bc[0] = 0x6d`, the widget-family entry byte measured last
  round, so the trace and the on-disk blob agree.
- pc runs to **462 923**, i.e. the 462 859-byte widget program (`bc_01`), not the 71 571-byte stage-2 program, and
  47 of the 69 ops are exercised. Only a prefix of the run is in the file: the helper flushes every 100 dispatches
  and the process kill drops the last partial batch.
- The trace contains a **key fixed point**: a run of `op=17` at `key=215` repeats `215 → 215 → 215` across
  consecutive pcs (90, 100, 112), i.e. our build's LCG takes a fixed point at that `(key, op)`. Their published
  step `(key+op)*37188+36086 & 255` does **not** reproduce our observed transitions (predicted 158, observed 131 at
  the entry), so the runtime trace — not their formula — is the authority for our build.
- `(key, op) → next key` is a function on linear steps: 1316 distinct transitions, 96 ambiguous, and the ambiguity
  sits on jump edges, where the taken target computes the key differently.

**Two harness facts this round cost runs to learn.** (1) Modifying a Brotli response through
`flow.response.content` corrupts delivery: that run's top-level body arrived as mojibake, the challenge never
started, and neither the widget document nor a single `/fo/` was ever fetched. `flow.response.set_text()` delivers
correctly, and after switching to it the patch took effect. (2) Only **one** heartbeat fired, so the patched text
executes in exactly one realm — the worker realm does not build its blob from the response we patch, which is why
this trace covers the document realm's program and not the worker-side one.

**Realm exfil, verified on our engine.** The document realm has `window.external.tracelog`; the worker realm has a
bare `external` global and **no `window` at all** (`new Worker(blob:)` scripts that touch `window` throw
`ReferenceError: window is not defined`). Both `external.tracelog(k, v)` and `console.log` (which reaches
`obscura::console`) write from a worker. `--tracelog-file` must be passed **before** the subcommand; after it the
file is never created.

**Artifacts.** Patcher `/tmp/ovpc/patch.py` (structural, identifier-agnostic; validated offline — one site, one
script block, `node --check` clean); addon `/tmp/ovpc/addon.py`; runner `/tmp/ovpc/run.sh`; trace
`/tmp/ovpc/trace.jsonl`; probe spec `/tmp/ovpc/probe/{addon.py,index.html}`.

**Status.** Unmet: `1.txt` still returns the challenge and no `POST /1.txt` is issued. Gained this round: the first
runtime `(pc, key, op)` trace of our session, our build's VM entry state (`key=121`, `op=17`) and decode constant
(`+251`), a key-independent proof that the opcode table is renumbered per build (26/69 overlap), the measured reason
the static pass yields one state (branchy entry handler, width needs runtime state), a correction to the 94.58 %
coverage reading, and the two harness facts above (Brotli `set_text`, worker realm has no `window`).

## Step 276: the worker handoff works, the OPFS sync access handle did not (fixed), and where the flow now ends

Step 275 left the worker realm's VM copy unfound. This round found it, measured every probe the widget runs,
and fixed the one engine defect those measurements exposed.

**The worker's code arrives by `postMessage`, and the widget ships a three-condition gate.** The
`new Worker(blob:)` at the stall is not the VM: the blob is a 292-byte bootstrap

```js
var _p=null; if(self.trustedTypes) try{_p=self.trustedTypes.createPolicy('FHMZS9',{createScript:function(s){return s}})}
catch(e){self.postMessage({type:'tt-policy-error',msg:e.message})}
onmessage=function(e){ e.isTrusted && ''===e.origin && null===e.source && eval(_p?_p.createScript(e.data):e.data) }
```

(a second, 13-byte blob is `"you"==="bot"`). **All three conditions hold in Obscura** — instrumenting that exact
handler prints `isTrusted=true origin="" sourceNull=true srcType=null dataLen=…` for every message, and each worker
evals its program and replies. So the gate is not the blocker, and the earlier "the caller never touches the worker"
reading (step 271's Proxy) missed it only because the VM drives the worker through host references, not JS property
access. This is also how the worker realm gets instrumented later: patch the *blob*, not the response.

**What the workers are actually asked.** Every probe is a small script, and we now have our side's answers:

| probe | our reply |
| --- | --- |
| `navigator` fields | `{"hIup0":"MacIntel","ztyKk8":["zh-CN"],"TpsmW1":6,"APSY2":8,"jKeeJ4":"Mozilla/5.0 … Chrome/151.0.0.0 …"}` |
| OPFS sync access handle, `performance.now()` around `flush()` | `{"uUOw3":0}` (step 274's defect) |
| `performance.now()` minimum non-zero resolution, 5000 iterations | `{"vVsCr9":0.09999999999990905}` |
| cross-origin CORS fetch of `brunhild.challenges.cloudflare.com` | `{"AXuey2":1,"gQTuX1":"TypeError: Failed to fetch"}` |
| timer liveness (`setTimeout` 55 ms / 5 s / 10 s) | `{"CpvME3":"1"}`, `{"qmxM8":1}`, `{"pvIO8":"1"}`, `{"IySL7":"1"}` |

The `brunhild` failure is not an engine divergence: that URL answers **502 from the specified proxy** in both
transport shapes, and a 502 without ACAO fails a `mode:'cors'` fetch in any browser, so the reference's own
`catch` branch produces the same value. The OPFS probe *was* ours to fix.

**Fixed: the OPFS sync access handle now does real I/O.** `flush()` was a no-op over an in-memory `Uint8Array`, so
the widget's own timing probe read 0 ms where a browser reads milliseconds — a fingerprint difference, not a missing
feature. `createSyncAccessHandle` is now backed by a real file under a per-process temp directory
(`op_opfs_sync_open/write/read/flush/truncate/size/close` in `obscura-js/src/ops.rs`), with the node's `bytes` kept
authoritative for content and the file kept in step, so a second handle still reads what the first wrote.

- Measured on the local fixture, same page as step 274: `{"writeMs":0,"flushMs":0,…}` →
  `{"writeMs":0.09999999999999987,"flushMs":4.4,"size":64,"closed":true}` (reference: 10.6 ms).
- The page realm still reports `hasSync:"undefined"` — `createSyncAccessHandle` stays worker-only, as in Chrome.
- `cargo nextest -p obscura-js --features render`: **617/620**, the three failures being the previously recorded
  unrelated ones (`link_elements_use_their_own_interface_and_resolve_urls`,
  `initial_about_blank_inherits_creator_origin_domain_and_referrer`,
  `sandboxed_initial_about_blank_keeps_opaque_origin_and_domain`). Release build clean.

**The reference's success signature, read off the HAR.** `assets/thelancet-trace/*.har` is unambiguous about what
"passing" looks like: `403 GET /1.txt` ×2, then the three widget `/fo/` POSTs, then **the final top-level `/fo/`
carrying `Set-Cookie: cf_clearance=…`**, and then — the success criterion itself — **`POST /1.txt` → `404`** with
`Set-Cookie: JSESSIONID=…`. The form is *POSTed*, not re-fetched.

**Where our flow ends now.** With the fix in, a run reaches the whole five-submission cycle (top #1 → widget #1 →
#2 → #3 → top final), the final top-level `/fo/` issues `cf_clearance` for `www.thelancet.com` (and the widget's
`/fo/` issues one for `challenges.cloudflare.com`), our jar **stores it and replays it** on the next `/1.txt`
request — and the site nevertheless re-challenges, after which the page starts a new round and the run ends on the
interstitial. **No `POST /1.txt` is ever issued**, so what remains is not the clearance and not the cookie jar: it is
the interstitial's own form submission, which the reference performs and we do not.

**Form submission itself works — and that made a second engine bug findable.** A local fixture shows
`form.submit()` producing `POST /submit-target` with `body=b'a=1'` and
`Content-Type: application/x-www-form-urlencoded`, so the submit path
(`element-object.js:1458 _navigateSubmit` → `_navigateCurrentContext(url, 'POST', encoded)`) is implemented, and
`FrameNavigationRequest` already carries `method` and `body`.

But the reference's success request is a **form POST** (`POST /1.txt`, `application/x-www-form-urlencoded`, body
`<token>=<value>` → 404), and the interstitial's CSP is
`default-src 'none'; script-src 'nonce-…' 'unsafe-eval' https://challenges.cloudflare.com; script-src-attr 'none';
style-src 'unsafe-inline'; img-src 'self' …` — **no `form-action`**. `_cspResourceAllows`
(`bootstrap/env/worker/dedicated-worker.js`) fell back to `default-src` for *every* directive, and `form-action` is
one of the directives that per CSP spec has **no** `default-src` fallback, so our check resolved it to `'none'` and
returned before the navigation. **Fixed**: `form-action`, `base-uri` and `frame-ancestors` no longer inherit
`default-src`. Verified both ways on a local fixture:

- `default-src 'none'` + no `form-action` → `POST /submit-target body=b'a=1'` (allowed, correct);
- `default-src 'none'` + `form-action 'none'` → only the `GET`, no POST (still blocked, correct).

Two live runs with the fix still end with the interstitial and only `GET /1.txt` 403s (one reached the full
five-submission cycle with two clearances issued, the other stalled at three submissions — the variance of step 274
is unchanged). So the CSP check was real but not the operative blocker.

**And the interstitial never calls submit at all.** Wrapping the function at its real owner (`Element.prototype`,
found by walking `document.createElement('form')`'s prototype chain — `HTMLFormElement.prototype` owns only
`constructor`, `elements`, `length`, `reset`) and logging through `external.tracelog` from both realms shows the
wrapper installed in the page and in the widget document, and **zero `call:submit` / `call:requestSubmit` /
`evt:submit` records** in a run that reached the interstitial twice. So the page takes its re-challenge path before
it ever builds or submits the answering form — the divergence is upstream of the submission, in whichever input
makes the program decide to retry, which is where step 275's runtime trace applies.

**A regression test pins the CSP fix.** `form_action_csp_does_not_inherit_default_src` (`obscura-js/src/runtime.rs`)
submits a form under `default-src 'none'` with no `form-action` and asserts the navigation proceeds
(`https://app.example/submit?x=1`), next to the existing `form_action_csp_blocks_form_navigation`, which keeps the
explicit `form-action 'none'` blocking. Suite: **618/621**, the three failures being the documented pre-existing ones.

**Harness pitfall that cost two runs.** `mitmdump` binds its port and, if an earlier run leaked, the new one dies
with `[Errno 48] address already in use` while the engine silently keeps talking to the *stale* proxy — a run that
looks normal, logs nothing, and (in one shape) delivers a Brotli body it re-encoded wrongly, so the top-level page
arrived as mojibake and the challenge never started. Ports have to be confirmed free (`lsof -nP -iTCP:<port>
-sTCP:LISTEN`) before a run is believed.

**Artifacts.** Patcher `/tmp/ovpc/patch.py` (dispatch chain, `__ovlog`, Blob wrapper, worker-bootstrap gate probe);
recording-only proxy `/tmp/ovclean/addon.py` + `run.sh`; wire logs `/tmp/ovclean/{wire-1,wire-2,fix-wire-1,fix-wire-2}.log`;
form/CSP fixtures `/tmp/formprobe/{server.py,server_neg.py}`; OPFS fixture `/tmp/opfs/{index,worker}.html`; the
reference `assets/thelancet-trace/www.thelancet.com_2026_09_16_17_43_57.har`.

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: the worker handoff and its gate measured (passing),
the full probe inventory with our values, the reference's exact success signature, **two engine fixes** — OPFS sync
access handles now hit real storage (`flush()` 0 → 4.4 ms, obscura-js suite 617/620 with only the three documented
pre-existing failures) and `form-action` no longer inherits `default-src` (verified with a positive and a negative
control) — plus the divergence narrowed to the interstitial's own submit step.

## Step 277: the reference's OPFS timings, a correction to step 274, and where the decision is actually made

Two measurements this round change what the earlier evidence means, and one of them corrects a fix from step 276.

**The reference's own OPFS durations, from its FPTRACE records.** `assets/thelancet-trace/renderer-trace.log` carries
per-call durations for the very probe the widget runs, in the real Chrome run:

| call | reference duration |
| --- | --- |
| `FileSystemSyncAccessHandle.write` (1 byte) | 477 us |
| `FileSystemSyncAccessHandle.flush` | **12 us** |
| `FileSystemSyncAccessHandle.close` | 76 us |
| `FileSystemFileHandle.createSyncAccessHandle` | 39 us |

So a browser's `flush()` is **12 us**, three orders of magnitude below step 274's "reference 10.6 ms". That figure
was not the flush cost (it came from a wider measurement of the promise chain, not from the probed call), and it
misled the fix: with `performance.now()` resolving at 0.1 ms in both engines (`vVsCr9` = 0.1), Chrome's probe reads
**0**.

- Step 276 backed the handle with a real file and made `flush()` an `fsync`, which measured 4.4 ms — that is a
  *worse* fingerprint than the 0 ms it replaced, and it is exactly the measurement the widget takes.
- Corrected: the file stays real (`write` is still write-through, `getSize` still reads it: `size:64`), but
  `flush()` is now the cheap write-back a browser performs instead of an fsync. Fixture: `{"writeMs":0.0999,
  "flushMs":0,"size":64,"closed":true}` — flush back under the clock resolution, as in Chrome.
- Two clean live runs with all fixes in: **8 `/fo/` POSTs, 2 `cf_clearance` cookies issued, and still only
  `GET /1.txt` → 403, zero `POST /1.txt`.** Neither engine fix moved the server's decision, which is consistent with
  the OPFS probe never having been the decisive input.

**The widget document is rotated between sessions, so the step-275 anchor is dead.** The current session's document
is **449509 bytes** (md5 `9450f3681128a0403e512e39944af7a3`) against step 275's **409959**, and its decode is a
different shape entirely: `op = key ^ ((bc[pc] + 57) & 255)` built as
`jy = <mask>(bcarr[pcidx], 57 + 256 & 255.87); op = <xor>(keyreg, jy)`, where step 275's was `^ 251 + arr[pc] & mask`
in the switch's comma chain. So the chain regex matches one build and not the next; the per-build-stable anchors are
the bytecode read with post-increment (`arr[pc++]`, the operator's `Uf[UX++]`) and the `switch` whose body is
`case <op>: <obj>[<lookup>](this)`. Anything instrumented for the next round has to be anchored there.

**And the server-visible divergence is already at stage 2.** Comparing response sizes for a full cycle
(`/tmp/ovclean/fix-wire-1.log`, encoded bytes, decoded = /1.778):

| stage | ours | reference |
| --- | --- | --- |
| page `/fo/` #1 | 113772 -> 63993 | 113768 -> 63994 |
| widget `/fo/` #1 | 822972 -> 462856 | 822968 -> 462859 |
| widget `/fo/` #2 (proof) | 127228 -> 71569 | 127240 -> 71571 |
| widget `/fo/` #3 | 5160 -> ~2900 | 7164 -> 4029 |
| page `/fo/` final | 3240 -> ~1822 | 3660 -> 2056 |

Stages 1 and 2 are the reference's programs, byte for byte in size; **stage 3 onward is a different, shorter
program**. The server therefore decides from what our *stage-2 submission* carries, and the inputs to that
submission are the worker probe replies measured in step 276 — navigator fields, `uUOw3`, `vVsCr9`, the timer
heartbeats and the `rMor4/eSLoU7/deuYr4/LrrA4` group. That is the short list to diff next, one input at a time.

**What cannot be diffed.** The `/fo/` bodies are single opaque tokens (no `=` separator, `$`/`+`/`-` alphabet), so
the payload is not readable on either side; the reference trace records payload keys only as *names*
(`Number.parseInt("PWGF4")`, `hasOwnProperty("WqxKW9")`), never values. Value-level comparison has to go through
per-call API durations, which is how the OPFS row above was settled.

**Artifacts.** Reference durations extracted from `assets/thelancet-trace/renderer-trace.log`; current widget
document `/tmp/widgetdoc/widgetdoc.html` (449509 B, md5 `9450f3681128a0403e512e39944af7a3`); live wire logs
`/tmp/ovclean/flushfix-wire-{1,2}.log`; OPFS fixture `/tmp/opfs/worker.html`.

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: the reference's OPFS API durations (flush 12 us,
write 477 us, close 76 us), a correction that makes our sync access handle read *and* cost like a browser's
(`flush()` back to 0 ms with a real backing file), the measured fact that the widget document rotates per session
(and which anchors survive that), and the localization of the server's decision to our stage-2 submission. Suite:
obscura-js 618/621, the three failures the documented pre-existing ones.

## Step 278: two probe candidates cleared by direct two-engine comparison, one left

The objective's method here is comparison, so this round compared **the same fixture in real Chrome and in Obscura**
rather than reasoning from the reference's logs. Chrome is installed on this host
(`/Applications/Google Chrome.app`), and a minimal CDP client (get `/json`, connect, `Runtime.evaluate`) is enough
to read a page's globals; `/tmp/clockprobe/cdpeval.py` is that client.

**Clock resolution (`vVsCr9`): identical, so not a detection.** Our engine floors `performance.now()` to 100 us
(`_PERF_CLAMP_MS = 0.1` in `bootstrap/env/performance/support/clock.js`, "Chrome floors a DOMHighResTimeStamp to 100
microseconds outside a cross-origin isolated context"). The reference trace's raw `Performance.now` values show
15 us spacing, which looked like a 6.7x divergence — but those are **pre-clamp internals of the instrumented
build**, not the value JS receives. The fixture runs the widget's exact loop (`for(...5E3...){e=now();f=now();...}`
taking the minimum non-zero delta) in both the document and a blob worker:

| realm | Chrome (real, no virtual time) | Obscura |
| --- | --- | --- |
| document | 0.10000002384185791 | 0.09999999999999432 |
| blob worker | 0.09999990463256836 | 0.09999999999999987 |

Both 0.1 ms, `crossOriginIsolated=false` in both. Our clamp is right and `vVsCr9` matches; nothing to fix. (A
`--virtual-time-budget` run is useless here: virtual time freezes the clock, so Chrome's worker probe returns its
1.0 initializer.)

**`navigator` fields: aligned.** The reference trace's `Navigator.languages` getter result is an Array with
`length: 1` and `Navigator.language` is a 5-char string, i.e. `["zh-CN"]` / `"zh-CN"` — which is what our challenge
run reports (`{"ztyKk8":["zh-CN"],"TpsmW1":6,"APSY2":8,...}`). A default headless Chrome on this host shows
`["zh-CN","zh"]`, but that is the host's locale, not the reference configuration; ours is intentional.

**The one identified probe divergence left: the PAT fetch.** The `rMor4` group is
`fetch("<pat URL>", {cache:"no-cache", redirect:"follow"}).then(r => r.text().then(b => postMessage({rMor4:1,
eSLoU7:r.status, deuYr4:r.ok?1:0, LrrA4:b}))).catch(e => postMessage({rMor4:1, OshSk8:String(e)}))` — i.e. it reads
`status`, `ok` and the body of `https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/pat/…`. Our run
reports **`{"rMor4":1,"eSLoU7":401,"deuYr4":0,"LrrA4":"J"}`: HTTP 401, `ok=false`, one-byte body `"J"`**, captured on
the wire twice as `RESP 401 len=1 body0=b'J'`.

- The reference's value for the same probe is **not recoverable**: the trace records payload/probe keys as *names*
  only, it has no `Response.status` / `Response.text` records at all, and the PAT URL is single-use — replays of a
  captured one return `404` both direct and through the specified proxy. Settling it needs the fetch replayed in
  Chrome *while the session is live* (or the widget instrumented to log the probe script and its reply, which needs
  the anchor re-based per step 277).
- A 401 for a client that presents no Private Access Token is plausible and may be exactly what Chrome gets, so this
  is a **candidate, not a verdict** — it is listed because it is the only probe whose reported value we can name and
  whose counterpart we cannot yet read.

**What is now ruled out for the stage-2 divergence.** OPFS timing (`uUOw3`, fixed and re-corrected to sub-resolution
0 ms), clock resolution (`vVsCr9`, verified identical), navigator fields (verified aligned), the worker handoff and
its `isTrusted`/`origin`/`source` gate (measured passing, step 276), and the payload itself (opaque on both sides).
The remaining candidate is the PAT fetch, next to anything the widget computes that has not been enumerated yet.

**Artifacts.** `/tmp/clockprobe/{clock2.html,nav.html,cdpeval.py}` (two-engine fixtures and CDP client); reference
durations and getter results from `assets/thelancet-trace/renderer-trace.log`; PAT evidence in
`/tmp/ovclean/wire.log` (`RESP 401 len=1 body0=b'J'`).

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: two candidate inputs cleared by direct comparison
against real Chrome on identical fixtures (clock resolution identical at 0.1 ms, navigator aligned), one correction
that makes our OPFS handle cost like a browser's, and one remaining identified candidate — the PAT fetch's
401/`"J"` — with the exact probe source and the reason its counterpart value is unreadable today.

### Step 278a: the PAT candidate is closed too, and so is the request inventory
Checked immediately after writing the above, and it clears the last named candidate:

- **The PAT fetch matches the reference exactly.** Our `RESP 401 len=1 body0=b'J'` is answered by Cloudflare
  (`Server: cloudflare`, `CF-RAY: a3c140c5cd24504a-ICN`) with
  `www-authenticate: PrivateToken challenge="AAIAGXBhdC1pc3N1ZXIuY2xvdWRmbGFyZS5jb20g…"`, and our request carries
  **no** auth header. The reference HAR's own PAT entry is the same shape: **`status 401`**, no auth header on the
  request, the same `PrivateToken` challenge on the response. A browser satisfies that challenge through its Private
  Access Token infrastructure; a client that presents none gets 401 in both engines, so `rMor4` is not a divergence.
- **The brunhild CORS fetch matches too.** The reference HAR records those requests with `status 0` — they fail
  there as well, so our `{"AXuey2":1,"gQTuX1":"TypeError: Failed to fetch"}` is the same outcome for the same reason
  (a 502 from the proxy carries no ACAO, so a `mode:'cors'` fetch rejects).
- **The request inventory matches.** Deduping our live wire by path class gives `fo` (5), `pat` (2), `i` (2), `ci`
  (1), `turnstile/f/` (2 doc loads), `turnstile/v0/g/…/api.js` (1), `/1.txt` (4) — the same classes as the 18-entry
  reference HAR. Nothing missing, nothing extra.

So every input we can *name* now checks out against the reference: navigator fields, OPFS timing, clock resolution,
PAT, brunhild, the worker handoff and its gate, and the request inventory. The stage-2 submission still earns a
shorter stage-3 program (step 277), so the remaining difference is in what the payload carries that has not been
enumerated — the values the VM computes for itself — and reading those needs the widget instrumentation re-based on
the rotated document using the anchors step 277 identifies.

## Step 279: the widget instrumentation re-based on host surface, and a live Chrome run that stops earlier than we do

**The instrumentation no longer touches the VM's obfuscated code at all.** Step 277's rotation killed the decode
chain anchor, so the helper now goes in at the document's own `<script nonce="…">` and wraps **host surface only**
(`Worker`, `Blob`) — variant-independent, because it never reads the VM's internals. `Worker.prototype.postMessage`
is wrapped to log every probe script handed to a worker, `onmessage` and `addEventListener('message')` are wrapped to
log every reply, and `Blob` logs the worker bootstrap text. It works: `/tmp/ovprobe/{addon.py,run.sh}`.

It recovered the **current** variant's complete probe set with our replies, including two probes the earlier capture
never showed (the document rotates the probe list too):

| probe (script sent to a worker) | our reply |
| --- | --- |
| `navigator` snapshot | `{"hIup0":"MacIntel","ztyKk8":["zh-CN"],"TpsmW1":6,"APSY2":8,"jKeeJ4":"…Chrome/151.0.0.0…"}` |
| PAT fetch | `{"rMor4":1,"eSLoU7":401,"deuYr4":0,"LrrA4":"J"}` |
| brunhild CORS fetch | `{"AXuey2":1,"gQTuX1":"TypeError: Failed to fetch"}` |
| OPFS sync access handle | `{"uUOw3":0}` and `{"uUOw3":0.0999…}` — sub-resolution, as Chrome reads it |
| `performance.now()` loop | `{"vVsCr9":0.09999999999990905}` |
| `eval("debugger")` liveness | `{"yNiq8":"TWnkF5"}` |
| timers 55 ms / 1.5 s / 10 s | `{"CpvME3":"1"}` / `{"pvIO8":"1"}` / `{"IySL7":"1"}` |
| timing matrix | `{"jixMq8":{"jBVrk8":[[6.1,3.7,3.7],[5.5,3.8,3.6],[6.8,5.6,5.9],[32.2,4.9,4.9]],"qdVjJ1":1,"hCKCP8":88.5}}` ×4 |
| work packet, 5 workers | `{"graIf9":{"PySu2":"<ray>|<ts>|0|15274","OMba9":23420,"WrTo7":14}}` ×5 |

Two things follow. (1) **The five `graIf9` work results do arrive** — step 271's "the caller returns early after
`new Worker`" is superseded: with the worker path healthy, all five workers return, so the stop is later than that
was. (2) `jixMq8` is a 4×3 timing matrix with a 32.2 ms outlier and an `hCKCP8` total of 88.5 ms, and the five
`OMba9` work results sit around 23 k each. Those are the VM-computed payload fields the objective asked for; the
reference's values for them are not recorded anywhere (its trace keeps payload keys as *names*), so they cannot be
diffed as-is.

**A live Chrome comparison reframes the remaining gate.** Driving real Chrome (this host's
`/Applications/Google Chrome.app`) through the *same* proxy at the *same* URL, with the UA set to the reference's
and a click on the widget frame via CDP `Input.dispatchMouseEvent` (trusted events):

| client | flow observed now |
| --- | --- |
| real Chrome, headful, 110 s window | `GET /1.txt` 403 → `chl_page/v1` 200 → `api.js` 200 → **top `/fo/` #1** 200 → **widget document** 200 → *stops*. No widget `/fo/`, no `POST /1.txt` |
| real Chrome, `--headless=new` | same, one top `/fo/`, stops there |
| Obscura (same proxy, same click) | 8 `/fo/` (top #1 → widget #1/#2/#3 → top final), two `cf_clearance` cookies, then a re-challenge |

So right now **real Chrome stops earlier than Obscura does**: it never gets a widget submission, where we get three
and a clearance. The reference capture that *did* pass (`assets/thelancet-trace`, 2026-09-16 17:43) is from before
this, and both my Chrome runs are hours later, so the egress/proxy path's treatment by the challenge has changed in
between. That is a measurement, not a claim about the cause: it means a shorter stage-3 program for us (step 277) is
not by itself evidence of an Obscura-specific tell, since the client that produced the reference cannot currently
get that far either.

**Artifacts.** `/tmp/ovprobe/{addon.py,run.sh,trace.jsonl}` (host-surface instrumentation and the reply set);
`/tmp/chromeref/{drive.py,watch.py,drive.txt}` (Chrome driver with widget-frame click, full request log).

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: the widget instrumentation re-based on host surface
alone (survives the rotation, and recovered the current probe set, two probes of which were previously unknown), the
confirmation that all five worker results now return, and the live finding that real Chrome through the same proxy
stops earlier than Obscura does — which changes what the remaining gap can be attributed to.

## Step 280: the reference payload values, and two storage fields fixed from them

Step 279's next action was to get real Chrome to pass in the same window and capture its `payloadJSON`. Chrome still
did not pass, but the payload does not require passing: the challenge logs it field by field, and the console calls
come from the **worker** realm, which needs `Target.setAutoAttach` (flattened) to be visible over CDP at all. With
that, `/tmp/chromeref/drive2.py` collected 33 682 `payloadJSON:` records from Chrome and parsed **341 labelled
reference fields** (`/tmp/chromeref/ref_fields.json`) — a real reference for the fields our own payload carries.

Diffing the storage group against ours (`/tmp/chromeref/our_fields.json`, from our own console) found **two
divergences**, both in the group the challenge fills from its OPFS probe, which runs in a worker:

| field | reference (real Chrome) | ours, before | ours, after |
| --- | --- | --- | --- |
| `RPKTR7` — `navigator.storage.estimate().quota` | **10737418240** (10 GiB) | **5000000000** (flat 5 GB) | 10737418240 |
| `uUOw3` — `flush()` cost the challenge times | **0.54 ms** | 0 | 0.60 ms |
| `DdIVt1` / `pobRy9` / `uxzT2` / `quDo6` | `null` / `true` / `true` / `3` | same | same |

**The quota had three implementations and the worker's was the flat tell.** `bootstrap/env/fingerprint/navigator.js`
already avoided the flat value in the document realm (a per-install 200-850 GB band, with a comment calling 5 GB
"the flat 5GB tell"), but `bootstrap/config/surface-finalize.js` and `src/worker.rs` each returned
`5000000000` — and the worker is where the challenge reads it. All three now answer **10737418240**, which is both
the reference's value and the value `queryUsageAndQuota` in the same file already used. One origin reporting two
different quotas would have been its own tell, so they share one constant.

**`flush()` now costs what a browser's costs.** Step 278 landed on 0 ms by reading Chrome's `flush` *disk* cost
(12 us) and ignoring where the call runs: a browser serves a sync access handle from the browser process, so the
probe times an IPC round trip, which is the 0.54 ms the reference reports. An in-process handle answers in
microseconds — a reading no browser produces, in the one field this probe exists to measure. The round trip is
modelled (450 us of it) the same way `performance.now()` is clamped to Chrome's granularity, and the fixture now
reads `flushMs: 0.6` against the reference's 0.54.

Both fixes are confirmed in the live flow, not only on fixtures: our payload now logs
`RPKTR7":10737418240`, `uUOw3":0.6000000000000001`, `DdIVt1":null`, `pobRy9":true` — the whole group matching the
reference. Suite after the change: obscura-js **618/621**, the same three documented pre-existing failures.

**Still unmet.** No `POST /1.txt`, no 404. This round's runs reached between two and five `/fo/` with no clearance,
i.e. the fixes have not moved the server's decision yet in the windows observed, and step 279's environment finding
stands: real Chrome through the same proxy also fails to get a widget submission. The remaining named difference in
the payload is now none of the fields we can pair; whatever is left needs either a passing reference run for the
same window or the fields we still cannot name.

**Artifacts.** `/tmp/chromeref/{drive2.py,payload.txt,ref_fields.json,our_fields.json}` (Chrome driver with worker
auto-attach, reference payload log, parsed reference fields, our parsed fields);
`/tmp/ovclean/quota-fix-{1,2}.log`; `/tmp/storprobe/idx.html` (both-realm quota fixture).

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: the reference's labelled payload values (341 fields,
via worker auto-attach), two storage-group divergences found by diffing them, and both fixed and verified live —
the quota now reads the browser's 10 GiB in every realm, and `flush()` costs 0.6 ms where the reference's costs 0.54.

## Step 281: payload field diff, and two prototype surfaces fixed from a two-engine enumeration

Step 280's diff used the reference's *own* payload values. This round adds the complementary method — run the **same
fixture in both engines** and compare the surfaces directly — and it found more, because the reference payload only
shows fields the challenge chose to read.

**The broad payload diff.** The reference's 341 parsed fields match 211 of ours (598 flattened entries); the 130
unmatched are mostly my parser mis-pairing in the reference's field-by-field console stream, plus session tokens.
The real differences it surfaced were the storage group fixed in step 280, plus timing-shaped fields where we are
systematically larger (`NnqX6` 227 vs 9700, `tZwbF3` 1006 vs 2644, `ZMSOw0`/`twvE0` 124 vs 390, `uGyjw9` 1 vs 291)
and the render entry in the error log `PWGF4`, whose `t` is **1 ms** in the reference against **548 ms** here. Those
are not yet attributed.

**The surface diff, in both engines, on one fixture** (`/tmp/surfprobe/idx.html`, driven by CDP for Chrome and
`--eval` for Obscura; `cdp_probe`-style enumeration of `getOwnPropertyNames`):

| surface | Chrome | ours, before | ours, after |
| --- | --- | --- | --- |
| `Screen.prototype` own names | 12: the getters + `orientation`, `constructor`, `onchange`, `isExtended` | 16 — the same plus `addEventListener`, `removeEventListener`, `dispatchEvent`, `when` as **own** properties | 12, matching; the methods are now reached through a base prototype, so `screen.addEventListener` is still a function (Chrome's is) without the extra owns |
| `document.fgColor` / `linkColor` / `vlinkColor` / `alinkColor` / `bgColor` | `""` each (unset) | **absent** (undefined) | `""` each |
| `Document.prototype` own names | 251 | 247 (same five missing) | 252 |

Both fixes are verified on the fixture, and the suite is unchanged at obscura-js **618/621** with the same three
documented pre-existing failures.

**What the same enumeration says is still different** (recorded, not yet fixed):

- `Document.prototype` carries `location` as an own accessor; Chrome does not (it is `[LegacyUnforgeable]`, so each
  document instance holds it). Ours puts it one level up, which an enumeration sees.
- `window`'s insertion order diverges at index 61: Chrome `Option, Image, Audio, webkitURL, …` against ours
  `queueMicrotask, location, length, screenX, …`. The challenge enumerates window properties, so order is read.
- Ours exposes eight extra globals (`SharedStorage` and its seven siblings) where Chrome 153 exposes none as window
  properties, and ours lacks `HTMLCameraElement` / `HTMLMicrophoneElement` and `navigator.cpuPerformance`, which this
  Chrome has.
- The render timing `PWGF4[0].t`: 1 ms in the reference, 548 ms here.

**Still unmet.** No `POST /1.txt`, no 404. This round's live run reached only two widget `/fo/` with no clearance —
the environment remains the constraint step 279 measured (real Chrome through the same proxy also fails to reach a
widget submission), so no flow claim can be drawn from a single window.

**Artifacts.** `/tmp/surfprobe/{idx.html,probe.html,ours.json,chrome.json}` (surface fixtures and both engines'
dumps); `/tmp/clockprobe/cdpeval.py` (uncapped CDP evaluator); `/tmp/chromeref/{ref_fields.json,our_fields.json}`.

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: the two-engine surface enumeration and two faithful
fixes from it — `Screen.prototype` now owns exactly Chrome's twelve names while still inheriting the event methods,
and the five legacy document color attributes exist and answer `""` — plus a recorded list of the remaining named
surface differences (window ordering, the eight extra `SharedStorage*` globals, the missing `cpuPerformance` /
`HTMLCameraElement` / `HTMLMicrophoneElement`, `Document.prototype.location`'s placement, and the 1 ms-vs-548 ms
render timing).

## Step 282: cpuPerformance was gated, SharedStorage was invented, and a test caught my first fix

Working down step 281's list, with a click flow after each change as the objective asks.

**`navigator.cpuPerformance` already existed — behind the wrong condition.** The reference's own payload enumerates
`n.cpuPerformance` in the **page** realm. Ours had the member only in cross-origin isolated *frames*: `page-init.js`
installs it inside `if (frameRootNid > 0 && _crossOriginIsolatedValue && …)`. My first attempt added a fresh constant
getter on the navigator surface, and `isolated_frame_exposes_cpu_performance_projection` failed — that test asserts
the *existing* projection (`["number", 3, true, "function"]`, the frame's `max(1, min(4, round(cores / 3)))`), so a
second getter was both redundant and value-wrong. Reverted, and the guard dropped instead: the getter now installs in
every realm, keeping the projection's own formula. Page realm with `hardwareConcurrency: 8` answers
`navigator.cpuPerformance === 3`, listed in the prototype enumeration; the frame test passes again.

**The eight `SharedStorage*` globals were ours, not Chrome's.** Two independent checks agree they should not exist:
the reference's payload never mentions `SharedStorage` in any of its 341 fields, and a direct measurement in Chrome
reports `typeof SharedStorage === "undefined"` while `HTMLCameraElement` / `HTMLMicrophoneElement` are functions —
so those two, which the first surface diff flagged as "missing", are Chrome-153-only additions the reference does not
have and were correctly left alone. The seven `_chromeInterfaceTable` rows and the `sharedStorage: 'SharedStorage'`
navigator mapping are gone: `window` now owns no `SharedStorage*` name, `navigator.sharedStorage` and
`SharedStorage` are both `undefined`.

**Checks after both changes.** Fixture: `{"cpu":3,"type":"number","listed":true,"hc":8,"ss":"undefined"}`. Suite:
obscura-js **618/621**, the same three documented pre-existing failures (the fourth failure of the intermediate state
was mine and is gone). Click flow in the same window: **5 `/fo/` POSTs, no `cf_clearance`, no `POST /1.txt`, only
`GET /1.txt` → 403** — so neither change moves the server's decision in this window, exactly as step 279's
environment measurement predicts.

**Still on the list, unchanged:** `window` insertion order from index 61, `Document.prototype.location`'s placement
(Chrome keeps it instance-level as `[LegacyUnforgeable]`), the render timing `PWGF4[0].t` (1 ms reference, 548 ms
here) and the timing-shaped payload fields (`NnqX6` 227 vs 9700, `tZwbF3` 1006 vs 2644).

**Artifacts.** `/tmp/surfprobe/{probe.html,idx.html}`; `/tmp/surface-finalize.js.bak` (pre-removal copy of the table);
the reference fields in `/tmp/chromeref/ref_fields.json`.

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: `navigator.cpuPerformance` now exists in the page
realm the reference enumerates (un-gated, not duplicated — the existing test caught the duplicate), the eight
invented `SharedStorage*` globals are gone, and both are verified on fixtures with the suite back to 618/621.

## Step 283: the environment still blocks Chrome, and screen metrics are now self-consistent

**Environment check first, as the objective asks.** Real Chrome, headful, through the specified proxy at the same
URL, three clicks on the widget frame, 75 s: **7 top-level `/fo/` POSTs, 8 widget-document loads, zero widget `/fo/`
submissions, no `POST /1.txt`** — it restarts the challenge instead. So the window is still not passable, for Chrome
as much as for us, and no conclusion about Obscura can be drawn from a flow result here.

**The numeric payload fields are a value-to-aliases map, not an ordered enumeration.** Step 281 read the reference's
numeric-keyed fields as chunks of a window enumeration and inferred that `window` order is read. Re-reading them
whole shows what they are — the key is a *value*, the value is the list of names that produced it:

| reference field | meaning |
| --- | --- |
| `1440: ["outerWidth","s.height"]` | outerWidth and screen.height are both 1440 |
| `900: ["outerHeight"]` | outerHeight is 900 |
| `3440: ["s.availWidth","s.width"]` | the screen is 3440 wide |
| `1312: ["s.availHeight"]` | its available height is 1312 |

so the challenge is checking that our aliases *agree*, not what order they enumerate in. (The reference machine's own
screen was 3440x1440 with availHeight 1312; ours is the configured 1440x900.) That correction matters because it
re-ranks the remaining list: window insertion order was step 281's priority and the evidence for it does not hold.

**What the map does show is a contradiction we were emitting.** Our runner's profile sets `availTop: 30` *and*
`availHeight: 900` on a 900-tall screen — a menu bar overhanging the display, which no browser reports, and exactly
the kind of self-inconsistency an alias map is built to catch. `_screenApplySize` passed the fingerprint through
untouched; it now clamps the available area to the screen minus the offsets, so our profile answers
`{w:1440, h:900, aw:1440, ah:870, at:30}`.

**Checks.** Suite: obscura-js **618/621**, the same three documented pre-existing failures. Click flow in the same
window: **5 `/fo/` POSTs, no `cf_clearance`, no `POST /1.txt`, only `GET /1.txt` → 403**.

**Still on the list:** `Document.prototype.location`'s placement, the render timing `PWGF4[0].t` (1 ms reference vs
548 ms here), the timing-shaped payload fields (`NnqX6` 227 vs 9700, `tZwbF3` 1006 vs 2644), and the window order
question — which stays recorded but demoted, since the evidence that the challenge reads order is now gone.

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: the environment re-checked in this window (Chrome
stops before any widget submission too), the reference's numeric payload fields correctly identified as a
value-to-aliases consistency map, and the screen metrics made self-consistent (`availTop` no longer overhangs).

## Step 284: `document.location` placed exactly as Chrome places it

Measured both engines on one fixture (`Object.getOwnPropertyDescriptor` on the instance and on the prototype):

| | Chrome | ours, before | ours, after |
| --- | --- | --- | --- |
| `document.location` as an own property | `{enumerable: true, configurable: false}`, getter | same (installed per realm) | same |
| `Document.prototype` owns `location` | **no** | **yes** | no |
| first own names of `document` | `location` first | `location` first | `location` first |
| `Document.prototype` prefix | `implementation, URL, documentURI, compatMode` | `location, implementation, URL, documentURI` | `implementation, URL, documentURI, compatMode` |

`location` is `[LegacyUnforgeable]` in the HTML spec, which is why Chrome has it as an instance accessor and not on
the prototype. `page-init.js` already installed exactly that, with a comment citing the spec — the class-body
`get location()`/`set location()` in `document.js` was a second, redundant declaration that put the name on the
prototype and shifted its enumeration. It is gone, and `requestStorageAccessFor` now reads `globalThis.location`
instead of `this.location` so it no longer depends on the per-realm install having run.

**Process note.** My first attempt at that edit mangled the region (it duplicated `get defaultView()` and orphaned two
comment blocks); the structure was checked and repaired before the build, and the file now has one `defaultView`,
one `fgColor` getter and no class-body `location`.

**Checks.** Fixture: `{"own":{"enum":true,"conf":false,"hasGet":true},"proto":false,"listed":0,"protoNames":
["implementation","URL","documentURI","compatMode"],"loc":"http://127.0.0.1:8893/probe.html"}` — identical to
Chrome's answer, and `document.location.href` still resolves. Suite: obscura-js **618/621** plus one leaky test
nextest reports separately, the same three documented pre-existing failures. Click flow in the same window: **5 `/fo/`
POSTs, no `cf_clearance`, no `POST /1.txt`, only `GET /1.txt` → 403**.

**Environment re-checked in the same window, as asked.** Real Chrome, headful, through the specified proxy, three
clicks: **7 top-level `/fo/` POSTs, 0 widget `/fo/` submissions, no `POST /1.txt`**, restarting the challenge
instead. So the reference-payload final check still has no window to run in: no client, ours or Chrome, has reached a
widget submission since the reference capture.

**Still on the list:** the render timing `PWGF4[0].t` (1 ms reference vs 548 ms here) and the timing-shaped payload
fields (`NnqX6` 227 vs 9700, `tZwbF3` 1006 vs 2644).

**Status.** Unmet: no `POST /1.txt`, no 404. Gained this round: `document.location` now matches Chrome's own-property
shape *and* its prototype's absence, with the prototype prefix identical, and the environment re-checked in the same
window.

## Step 285: two fixes from objective-directed comparison (timer delivery at DCL, macOS default font metrics)

Method per the objective: no reliance on the operator's instrumented tracelog; comparison against
`assets/thelancet-trace` (the passing Chromium-151 fp-trace + HAR) using our own engine's instruments
(`--trace-op-file`, `--trace-api-file`, the wire addon, and a real-Chrome two-engine fixture).

**The full five-submission flow now completes in the 30 s window.** Wire for a fresh round: top `/fo/` (2380 B)
→ widget doc → widget `/fo/` #1 (4.8 kB → 822 kB) → `/pat/` 401 + `/ci/` + brunhild → widget proof `/fo/` #2
(89 kB → 127 kB) → widget `/fo/` #3 (92 kB → 5 kB) → top final `/fo/` (7.8 kB → 3.2 kB). The reference's final
answer is 3.66 kB and then `POST /1.txt → 404`; ours is 3.24 kB and then a **re-challenge** (GET `/1.txt` →
new `orchestrate`). The server's deny lives in what our submissions carry, not in a missing request class.

**Fix 1: page timers queued by parser scripts now fire at the DCL boundary** (`page.rs`, one bounded
`run_load_delaying_event_loop_tick` before the `<dom-content-loaded>` dispatch in
`execute_scripts_with_module_budget`). Attribution: api.js stamps `turnstileLoadInitTimeTsMs` at boot and
dispatches its `onload=khCN8` callback with `setTimeout(0)`; the interstitial's inline handler then calls
`turnstile.render`, and `PWGF4[0].t` (carried in every `/fo/` payload) is `Y() - init` at that render entry.
Reference: **1 ms**. Ours: **548/300 ms**. Host-op stream (`--trace-op-file`) showed api.js's boot ops ending
at +1.7 ms and the render walk starting at +315.8 ms with *zero* host crossings in between: the due 0 ms timer
waited for the /fo/ completion to force the next event-loop poll, then ran behind 150+ ms of VM response
processing. `drive_load_delaying_scripts` never ticks when no *dynamic* scripts are pending, so nothing
delivered the timer. A `data:` URL fixture through serve+CDP proves the timer machinery itself is sound
(parse-phase `setTimeout(0)` fires at 7 ms with a cross-origin fetch in flight), so the fix is a delivery
boundary, not a timer rewrite. After the fix: 114/214/354/190 ms across rounds - the residual is
`chl_page`'s own pre-render work (its `/fo/` wait and VM processing sit between api.js boot and the render
call; the filtered trace `Object.turnstile` boot → chl_page `render` call brackets it), an engine-throughput
gap, not a delivery bug.

**Fix 2: `line-height: normal` / font box metrics follow the claimed platform's default font**
(`inline.rs`, `bundled_face_metrics` answers PingFang SC hhea 1060/340/0, upem 1000 for the default family
when `FontPlatform::MacOs`). Two-engine measurement of the challenge's own layout probe (reconstructed from
`ENV-DETECT-0916-11` pc 204513-207205: sub-pixel `px/pt/rem/scale` boxes + `getBoundingClientRect`; fixture
`/tmp/timerlat/layout.html`, Chrome headless vs ours via CDP): unit conversion and sub-pixel x were already
identical, but every line box was ~17 % short because Chrome resolves this host's default font to
**PingFang SC** (16px → 22px line, 45px → 63px; `getComputedStyle` confirms) while our bundled sans answered
19px. After the fix, measured heights match Chrome exactly on the probe set: p2 92 = 92, p3 48 = 48,
p4 55.938 = 55.938, p8 88 = 88, caption height 33 = 33, m1/m2 22/63 = 22/63. Still divergent: `p1`
`transform:scale(1e32…,1.89)` reads 0x0 here vs Chrome's 6.8e+32 rect; `details` 48 vs 70; `progress` 20 vs 26;
caption width 4 vs 39.5 (its border+margin are not applied). Those are default-widget geometry work, recorded
for the next round.

**fp-trace counts comparison** (`fptrace_diff.py counts` vs `renderer-trace.log`, our `--trace-api-keyed off`
jsonl): the MISSING builtin entries (`Date.now`, `Number.parseInt`, `Promise.*`, `Function.toString`,
`TextEncoder`, `BigInt`, `Object.*`) are the documented probe blind spot, not findings. Checked the two
suspicious DOM classes directly instead: WebRTC ICE is healthy (two mDNS host candidates + null terminator,
complete `candidate` fields - the reference's 106 `RTCPeerConnectionIceEvent.candidate` reads are covered);
CSSOM (`styleSheets`/`cssRules`/`cssText`) is implemented and returns rules - the volume difference
(415/410/204 reads there vs ~1 here) tracks the smaller stylesheet set our interstitial exposes and stays on
the watch list.

**New engine defect found, not yet fixed:** `serve` + CDP `Page.navigate` to a loopback URL commits an **empty
document** (scripts.length 0) even with `--allow-private-network` and `OBSCURA_ALLOW_PRIVATE_NETWORK=1`; the
same URL through `fetch` loads fine and public URLs through serve load fine. No net-layer log at all - the
fetch is swallowed before `SsrfGuardResolver`. It cost one wasted diagnostic round (`/tmp/lancet-s3`'s first
attempt) before the addon failure was separated from it.

**Suites.** obscura-js 618/621 (the three documented pre-existing), obscura-render 589/589,
obscura-browser 124/125 - `blob_url_iframe_navigation_commits_the_stored_document` fails on the uncommitted
tree with my two hunks mechanically disabled, i.e. it is prior work-tree state (the about:blank location
attribution from the reverted step-268 experiment), not this round's regression. The obstacle course repo is
not present on this host, so the 33/33 gate could not run; render-repros were not exercised because the
metrics change is platform-gated to the macOS identity the fixtures do not select.

**Status.** Unmet: no `POST /1.txt`, no 404. Gained: the DCL timer-delivery fix (PWGF4 548 → ~114-354,
residual attributed to VM throughput), the PingFang default-metric fix with exact height parity on the
challenge's own layout probe, the layout-probe divergence table, and the serve+CDP loopback defect.

## Step 286: offset* no longer include transforms; the atomic-only strut gap characterized

**Fix: `offsetWidth`/`offsetHeight` now report the layout border box and ignore visual transforms.**
They were `Math.round(getBoundingClientRect().width/height)`, so any transformed element answered the
*transformed* size: an element under `transform:scale(1e32,1.89)` reported `offsetWidth 33554430`
(binary32-clamped) where Chrome reports the untransformed `4`, and inside the challenge's hidden
measurement container the same element answered `0` twice over. `frame_geometry_json` now ships
`layoutWidth`/`layoutHeight` (straight from `layout.rects`, transform-free) alongside the transformed
rect, and `element-object.js`'s offset* read those when finite, falling back to the old path. The
gBCR finiteness validation moved into `getBoundingClientRect` itself so the pathological-scale case
still cannot leak a rect with null fields. Two-engine check (clip-container fixture, Chrome headless
vs ours): `p1` offset **[4, 193] = [4, 193]** exactly; a plain `scale(100,1.89)` case `a1` and the
scientific-notation `1e32` case `a6` likewise read [4,193] instead of 400 / 33554430.

**gBCR for the pathological scale stays 0** (Chrome: 6.8056e32). Our transformed rect overflows
binary32 and serializes through JSON as null, which the bootstrap answers with the all-zero rect;
Chrome's layout units saturate instead of overflowing, so it keeps a finite astronomical value.
Reproducing that needs saturating layout-unit math in `Affine2::map_rect`, not a one-line change.

**New characterization: blocks whose in-flow children are all inline-level atomics have no anonymous
IFC strut.** `<div><img 16px></div>` measures height 16 here and 22 in Chrome; the same for
progress-only (16 vs 22) — `is_pure_text_ifc` rejects atomic children, so the container lays its
children out as taffy boxes and no line box exists to impose the strut. In the challenge's own
sub-pixel probe this is exactly `p5` details (48 vs 70), `p6` progress (20 vs 26 = 16+4 vs
strut 22+4), and `p7` select (23 vs 26). The fix is to synthesize an anonymous line box for
"block whose children are all inline-level atomics" in the layout builder; it touches the core
build path, so it is recorded here rather than rushed. Caption geometry (4 vs 39.5: caption text
not contributing width to the table's shrink-to-fit) is in the same family.

**Flow.** Same window, 30 s round with one click: 8 `/fo/` submissions across two challenge rounds,
top final response 3240 B, then a re-challenge. **No `POST /1.txt`, no 404.**

**Suites.** obscura-js 618/621 (the three documented pre-existing). obscura-render/obscura-browser
not re-run this round (no changes to their sources since step 285's runs).

## Step 287: the line-box strut reaches atomic-only runs; p6/p7 parity

**Fix 1 (`dom.rs`):** the anonymous run wrapper's strut was gated on the run containing a *text*
node, so an img-only or progress-only line box collapsed to the atomic height. CSS line boxes carry
the containing block's strut unconditionally — `<div><img style="height:16px"></div>` is 22px in
Chromium (the 16px-font PingFang strut), not 16. `has_text_strut` is now "the run is non-empty".
**Fix 2 (`style.rs`):** `progress`/`meter` had no UA default display, fell through as blocks, and
never even reached the run grouping; they now default to `display: inline` + `is_inline_block`
(Chromium's UA sheet: inline-block), matching button/select/input.

**Two-engine verification** (data:-URL fixtures, Chrome headless vs ours over CDP):
img-only 16 → **22 = 22**; progress-only 16 → **22 = 22**; button-only 24 (own height ≥ strut)
unchanged. Challenge sub-pixel probe: `p6` 20 → **26 = 26**, `p7` 23 → **27 ≈ 26**, both now in
the OK column; p2/p3/p4/p8/p9 and offset metrics stay exact.

**Suites.** render **589/589** (the change is in the core layout builder), obscura-js 618/621 (the
three documented pre-existing), obscura-browser 124/125 (the pre-existing blob/location one).

**Flow.** 30 s round with one click: 8 `/fo/` submissions, top final 3240 B, re-challenge.
**No `POST /1.txt`, no 404.** `PWGF4[0].t` read **67 ms** this round (548 at step 284 → 114-354
after the DCL delivery fix → 67 now; the residual is chl_page's own `/fo/` wait plus VM throughput
between api.js boot and the render call — engine-throughput class, not a delivery bug).

**Remaining named divergences.** `p5` details 48 vs 70: Chrome's `summary` is `display: list-item`
and at zero content width its marker occupies its own line — summary 66 = 3 × 22 where ours is 44 =
2 × 22; needs summary list-item/marker defaults. `caption` 4 vs 39.5: the caption's text does not
participate in the table's shrink-to-fit width negotiation. gBCR under `scale(1e32)` 0 vs 6.8e32
(saturating layout units). All three are scoped in `/tmp/timerlat/` fixtures.

**Status.** Unmet: no `POST /1.txt`, no 404.

## Step 288: summary marker parity (p5 now exact); map_rect saturation

**Fix 1 (`style.rs` + `dom.rs`): the summary disclosure marker.** Chromium's UA sheet makes
`summary` a list-item; at the probe's zero content width the outside marker wraps onto its own
line — measured in Chrome: summary height = (text lines + 1) × 22 for every variant tried, and
`summary::marker{content:none}` collapses it back, which pinned the extra line on the marker.
The engine's UA defaults are code (not CSS rules), so the marker is installed as a
`before_pseudo` generated box (`before_content = "▸ "`); `dom.rs`'s pseudo extraction
unconditionally overwrote `style.before_pseudo`, so the merge now keeps a UA-element default
only when no stylesheet `::before` rule matched. The existing flex-wrap run wrapper then gives
the marker its own line at zero width, exactly like Chrome.

**Two-engine verification:** details 66 = 66, summary 66 = 66, `p5` **[4, 70] = [4, 70]** —
the challenge sub-pixel probe is now 9/10 OK (p2/p3/p4/p5/p6/p7/p8/p9/offset metrics exact;
only `p1` remains).

**Fix 2 (`lib.rs`): `Affine2::map_rect` saturates** non-finite corners and extents instead of
emitting infinities (CSSOM serializes those as null, which the bootstrap answers with an
all-zero rect — a stronger tell than a clamped astronomical value).

**`p1` gBCR is still 0** (Chrome 6.8e32), with a new datapoint that narrows it:
`getComputedStyle(p1).transform` parses the pathological decimal correctly
(`matrix(100000000000000000000000000000000000, 0, 0, 1.89, 0, 0)` — the authored value is 1e35,
not the 1e32 the ENV-DETECT abbreviation suggested), so the zeroing is not transform parsing nor
`map_rect` arithmetic; it originates between the cssom-rect pass and the geometry JSON for this
box (next instrument: dump `frame_geometry_json`'s inputs for that node).

**caption 4 vs 39.5 stays open** and is bigger than a default-style tweak: Chrome lays the
caption outside the table's grid and grows the table to the caption's fit-content width; ours
routes the caption through the grid tracks, so its width collapses to the empty track. Real
caption/table width negotiation is a table-layout architecture item.

**Suites.** render **589/589** after all three changes. obscura-js/browser unchanged from step
287's runs (no JS-side or page.rs changes this round).

**Flow.** 30 s round with one click: 8 `/fo/` submissions, top final 3240 B, re-challenge.
**No `POST /1.txt`, no 404.** `PWGF4[0].t` = 336 ms this round (round-to-round 67-354;
the residual is chl_page's `/fo/` wait plus VM throughput between api.js boot and the render
call).

**Status.** Unmet: no `POST /1.txt`, no 404.

## Step 289: instrumenting the geometry op fixed p1 — the matrix folded origin overflowed

**Instrument.** `frame_geometry_json` now dumps its inputs under `OBSCURA_GEOM_DEBUG=1` (cssom
rect, layout rect, matrix a/d/e/f, output rect). One data:-URL probe run pointed straight at it:

```
[geom] nid=9 cssom=Some((-10000,50,4,193)) rects=Some(same) transform=Some((1e35, 1.89, inf, NaN)) -> out=(0,0,0,0)
```

**Root cause.** `Affine2::around(origin)` folds the origin cancelation into one matrix:
`e = ox*(1 - a)` at scale 1e35 is ~1e39 — past f32::MAX — so the stored matrix carried
`e = inf`, and the composition produced `f = NaN`. Every mapped corner then evaluated
`inf - inf = NaN`, serde_json serialized the rect as nulls, and the bootstrap answered the
all-zero rect. The transform parse itself was correct (computed style showed
`matrix(1e35, …)`), which is why step 288's saturation of `map_rect` alone changed nothing:
the non-finite entries entered through `around`.

**Fix.** `around` saturates the folded translation (e/f) to the f32 range, and `map_rect`
computes its corners in f64 — saturating only the final rect. The f64 intermediates matter:
f32 corners would saturate to the same value and collapse the width to zero, while f64 keeps
them distinct (4e35 apart) until the final clamp.

**Two-engine verification:** `p1` gBCR ours `[33554430, 364.77, 33554430, -35.885]` against
Chrome `[6.8e32, 364.77, -3.4e32, -35.885]` — height and y now match bit-for-bit, and the width
is a finite astronomical value on both sides (the exact clamp differs: 2^25-2 in our pipeline,
Chromium's layout-unit max there). The challenge's sub-pixel probe reads **10/10 OK** for the
first time. render suite **589/589**.

**Flow.** 30 s round with one click: 8 `/fo/` submissions, top final 3240 B, re-challenge.
**No `POST /1.txt`, no 404.** `PWGF4[0].t` = 100 ms.

**Status.** Unmet: no `POST /1.txt`, no 404. Every named, value-level divergence in the
challenge's sub-pixel layout probe now matches Chrome; the remaining suspects are the
throughput-class timing fields (PWGF4 residual, tZwbF3/uGyjw9/ZMSOw0 — semantics await the
operator's updated disassembly), the caption/table width negotiation, and whatever the
payload carries that we cannot name.

## Step 290: caption-only tables join the grid, and tables shrink-to-fit

Two layers, both verified against Chrome on the bare caption fixture
(`<div id=cfh 0x0 fixed><table><caption>cap</caption></table>` plus the same table in normal flow):

**Fix 1 (`dom.rs`, build_table):** a native `<table>` with no rows bailed out of the dedicated
table path entirely (`return None`), so a caption-only table fell back to ordinary block
construction and stretched across the container (0 px inside the 0-width measurement container,
1264 px in normal flow). When `collect_table_rows` finds no rows but the table has a `<caption>`
child, one synthetic row is pushed (`synthetic_caption_row`) and the caption classifies as a cell
for that row, so the caption's content feeds the grid's min/max-content measurement.

**Fix 2 (`dom.rs`, build_table):** the grid table node now opts out of block stretching —
`align_self: FLEX_START` whenever its inline size is auto. CSS tables are shrink-to-fit; taffy's
block parent stretched an auto-width child to the full container (1264 px in normal flow where
Chrome reads 60.313, independent of the container). Percentage widths keep the stretch so they
still resolve against the container.

**Two-engine result.** table 0/1264 → **63 (Chrome 60.313)** and identical in both containers;
caption 4 → **37.844×29 (Chrome 39.516×33)**. The residual is ~1.7 px of glyph advance on
'cap' plus a 4 px vertical-border inclusion detail — the same text-advance noise class as p9
(26.703 vs 27.203). In the challenge's sub-pixel probe `pc` moved from `[4, 33]` to
`[37.844, 29, -9977.2, 337]` against Chrome `[39.516, 33, -9979.2, 335]` — structural parity,
with only sub-glyph metrics left.

**Suites.** render **589/589** after the table-path change.

**Flow.** 30 s round with one click: 8 `/fo/` submissions, top final 3240 B, re-challenge.
**No `POST /1.txt`, no 404.** `PWGF4[0].t` = 418 ms this round (round spread 67-418, network-bound).

**Status.** Unmet: no `POST /1.txt`, no 404. The challenge's environment probe now measures a
layout surface that matches Chromium on every named, value-level check available to this host;
what remains open is the throughput-class timing residual, caption glyph-advance minutiae, and
the payload content we cannot name. The egress verdict (the final `/fo/` answer still routes to a
re-challenge) is unchanged by seven engine fixes this session, consistent with the server weighting
inputs we cannot observe from here.

## Step 291: doc re-check and a post-rotation flow round

The operator's disassembly workspace (`jsvmp-engine-0916-11`) is unchanged since Sep 16 22:31 —
no timer/timing-family files, so `uGyjw9`/`ZMSOw0`/`tZwbF3` attribution stays blocked on the
next analysis drop.

A fresh 30 s round with one click after the session rotation: 8 `/fo/` submissions across two
challenge rounds, top final 3240 B, re-challenge. **No `POST /1.txt`, no 404.** `PWGF4[0].t` =
**59 ms** — the best reading this session (548 at step 284), leaving the residual entirely in
chl_page's own `/fo/` wait and VM throughput. Two `cf_clearance` cookies were issued; per the
verdict rules those also arrive on failure paths and are not pass evidence.

**Status.** Unmet: no `POST /1.txt`, no 404. The server verdict has been stable across every
round this session (steps 284-291, seven engine fixes landed), so the remaining divergence lives
where this host cannot name it: the payload contents the VM computes, and the throughput-shaped
timings those payloads carry.

## Step 292: pacing comparison against the reference HAR

Re-checked the operator's workspace: still no timer/timing-family files
(`uGyjw9`/`ZMSOw0`/`tZwbF3` attribution remains blocked).

Two more instrumented rounds (wire timestamps + host-op trace). One (`/tmp/lancet-s15`) showed a
one-off 10.7 s wire hole between the favicon 403s and the widget-document request; the repeat run
(`/tmp/lancet-s16`) has no such hole and completes 8 `/fo/` submissions across two rounds — the
hole was environmental, not a regression from this session's changes.

Pacing comparison against the passing reference HAR (`assets/thelancet-trace`): Chrome's
inter-request gaps run 0.82/0.85/0.94/0.90/2.13 s across the five submissions (8.5 s total to the
`POST /1.txt → 404`); ours run 1.7-3.7 s over 24.2 s. Same stage shape, ~1.5-2x per stage — the
throughput class already carried by `PWGF4[0].t` (59-516 ms round spread) and friends. Nothing
new to fix from the wire side: the stage-to-stage waits are the VM's own compute, not delivery
or polling stalls (those were fixed in steps 285/289).

**Status.** Unmet: no `POST /1.txt`, no 404. The remaining lever this host cannot pull is the
VM-computed payload content and its throughput-shaped numbers; attribution needs the operator's
next disassembly drop.

## Step 293: full-trace round is flow-degrading as documented; verdict stable

Re-checked the operator's workspace once more: unchanged. Two more rounds: the full-trace config
(`--trace-api-file --trace-api-calls`) degraded the flow exactly as documented in the measurement
notes — 2 `/fo/` submissions and `PWGF4[0].t` = 4131 ms, so its flow shape is observation-only,
never a verdict sample. The clean companion round (`--trace-op-file` only) reached 3 `/fo/`
submissions inside the window (network slower tonight), top final not reached. **No
`POST /1.txt`, no 404** in either. `uGyjw9`/`ZMSOw0`/`tZwbF3` attribution remains blocked on the
operator's next disassembly drop.

**Status.** Unmet: no `POST /1.txt`, no 404.

## Step 294: the caption's vertical border was never missing — the gap is shaping-font metrics

Third consecutive check of the operator's workspace: unchanged, `uGyjw9`/`ZMSOw0`/`tZwbF3`
attribution still blocked.

The "caption vertical border not counted" premise from step 289 is **refuted by computed style**:
our caption answers `content-height 25px, border 2px/2px` — the vertical border *is* included
(25 + 2 + 2 = 29, the measured border-box height). The 4 px height delta against Chrome
(33 = 29 + 2 + 2) is in the *content*: our caption text is shaped with the bundled Liberation
face's hhea metrics (line 25, advance 33.844) while Chrome shapes it with **PingFang SC**
(line 29, advance 35.516). The same advance delta explains the 1.7 px width gap. Fixing it means
identity-aware shaping-font loading — on a macOS identity, load the host's PingFang SC into the
font database as the default shaping face (glyphs *and* metrics), which is a font-layer project,
not a default-style tweak.

**Flow.** Fresh 30 s round with one click after session rotation: 8 `/fo/` submissions, top final
3240 B, re-challenge. **No `POST /1.txt`, no 404.** `PWGF4[0].t` = 279 ms.

**Status.** Unmet: no `POST /1.txt`, no 404. Open items: identity-aware shaping fonts (PingFang
SC on macOS), caption glyph-advance minutiae (same root), throughput-class timing attribution
(operator docs pending).

## Step 295: caption border confirmed counted; fast-path leaves carry the strut; identity shaping fonts scoped

Fourth check of the operator's workspace: unchanged — `uGyjw9`/`ZMSOw0`/`tZwbF3` attribution stays
blocked.

**The "caption vertical border not counted" premise is refuted.** Computed style on the caption:
content height 25px + border 2px/2px = the measured 29px border box — the border *is* included.
The 4 px height delta against Chrome (33 = 29 + 2 + 2) is in the *content*: the caption's text
shapes with the bundled Liberation face's hhea (line 25, advance 33.844) where Chrome shapes with
PingFang SC (line 29, advance 35.516 — the same delta on the width axis). The real fix is
identity-aware shaping-font loading: on a macOS identity, load the host's PingFang SC into the
font database so shaping glyphs *and* metrics match the claimed platform. That is a font-layer
project (fontdb source loading, family registration, weight matching, canvas-measure
consistency), scoped and recorded here rather than rushed.

**Landed anyway (correct CSS, no probe change): fast-path run leaves now carry the block's strut
as a minimum height** (`dom.rs`, fast-path leaf in the `Seg::Run` handler). The split-run wrapper
already had it; the single-run fast path did not. The caption's text turned out to take the
pure-text IFC promotion path instead, whose sizing needs the shaping-font fix above, so the
probe's caption numbers are unchanged this round. render suite **589/589**.

**Flow.** 30 s round with one click after session rotation: 8 `/fo/` submissions, top final
3240 B, re-challenge. **No `POST /1.txt`, no 404.** `PWGF4[0].t` = 299 ms.

**Status.** Unmet: no `POST /1.txt`, no 404.

## Step 296: identity-aware PingFang loading landed — inert on this host by absence of the file

**Implemented** (`inline.rs`, `new_with_web_fonts` + `resolve_loaded_font`): the engine loads
`/System/Library/Fonts/PingFang.ttc` at construction, registers its SC faces in the internal
family `__obscura_system_pingfang` (CSS-unselectable, so font-presence probes and authored
stacks are untouched), and `resolve_loaded_font`'s default-fallback selects that family when
`font_platform()` is macOS — giving the default text real PingFang glyphs *and* hhea metrics
(1060/340, upem 1000) through shaping, which is exactly Chromium's measured 22px/29px line boxes
on a host that has the file.

**On this host it is inert:** `/System/Library/Fonts/PingFang.ttc` does not exist (the CJK set
here is STHeiti/Hiragino Sans GB), so the caption still shapes at 25/29 content lines. Closing
the delta here needs one of: (a) the IFC leaf height lifted to `lines × used_line_height`
(the identity strut — one sizing change in the shaped-leaf builder), or (b) bundling a
PingFang-metric-matched font. Chrome's own 29px line on this host comes from its substitution
for the missing family, computed against its layout units — not reproducible from file metrics
that are absent.

**Fifth operator-workspace check:** unchanged; the timing-field attribution stays blocked.

**Suites.** render **589/589**.

**Flow.** 30 s round with one click: 8 `/fo/` submissions, top final 3240 B, re-challenge.
**No `POST /1.txt`, no 404.** `PWGF4[0].t` = 285 ms.

**Status.** Unmet: no `POST /1.txt`, no 404.

## Step 297: the overdue-timer repair now re-arms deno_core's sleep — PWGF4 delivery at 5 ms

**Root cause nailed with `obscura::timers=trace`.** A tick reported
`next_timeout_ms=Some(0.0)` while delivering nothing (`delivered=0`), followed by hundreds of
repair cycles that never delivered: deno_core's mutable timer sleep held a waker from a dropped
poll future, and the yield-only `op_posted_task()` wake — the entire repair — re-pollled a sleep
that never resolved. Delivery then piggybacked on unrelated network wakes, which is why
`PWGF4[0].t` tracked the `/fo/` fetch (59-516 ms) instead of the 0 ms deadline.

**Fix (`runtime.rs`, queue_overdue_timer_wake_repair):** when a browser timer is overdue, the
repair now also enqueues a throwaway zero-delay user timer. `queue_timer` sees the earliest
deadline and calls `change(now)`, which replaces the stale sleep and marks it ready — the next
poll observes it and delivers every due timer, including the real one. One extra no-op callback
per repair.

**Measured.** Repair round: `PWGF4[0].t` = **5 ms** (history: 548 → 59-516 after the DCL fix → 5).
Follow-up rounds read 183/1009 ms; the spread is challenge-flow ordering variance (the onload
timer now fires early; when the explicit `turnstile.render` call happens depends on the
server-driven challenge state of that round), not delivery latency — delivery is at the deadline.

**Suites.** obscura-js 618/621, obscura-browser 124/125 (the documented pre-existing failures).

**Flow.** 30 s round with one click: 3 `/fo/` submissions inside the window (network slower this
round), top final not reached. **No `POST /1.txt`, no 404.**

**Status.** Unmet: no `POST /1.txt`, no 404. The on-load render now happens on Chrome's timing;
the remaining payload deltas are the throughput/throughput-shaped numbers and the unnamed
contents, pending the operator's next disassembly drop.

## Step 297: the overdue-timer repair now re-arms deno_core's sleep — PWGF4 delivery at 5 ms

**Root cause nailed with `obscura::timers=trace`.** A tick reported
`next_timeout_ms=Some(0.0)` while delivering nothing (`delivered=0`), followed by hundreds of
repair cycles that never delivered: deno_core's mutable timer sleep held a waker from a dropped
poll future, and the yield-only `op_posted_task()` wake — the entire repair — re-pollled a sleep
that never resolved. Delivery then piggybacked on unrelated network wakes, which is why
`PWGF4[0].t` tracked the `/fo/` fetch (59-516 ms) instead of the 0 ms deadline.

**Fix (`runtime.rs`, queue_overdue_timer_wake_repair):** when a browser timer is overdue, the
repair now also enqueues a throwaway zero-delay user timer. `queue_timer` sees the earliest
deadline and calls `change(now)`, which replaces the stale sleep and marks it ready — the next
poll observes it and delivers every due timer, including the real one. One extra no-op callback
per repair.

**Measured.** Repair round: `PWGF4[0].t` = **5 ms** (history: 548 → 59-516 after the DCL fix → 5).
Follow-up rounds read 183/1009 ms; the spread is challenge-flow ordering variance (the onload
timer now fires early; when the explicit `turnstile.render` call happens depends on the
server-driven challenge state of that round), not delivery latency — delivery is at the deadline.

**Suites.** obscura-js 618/621, obscura-browser 124/125 (the documented pre-existing failures).

**Flow.** 30 s round with one click: 3 `/fo/` submissions inside the window (network slower this
round), top final not reached. **No `POST /1.txt`, no 404.**

**Status.** Unmet: no `POST /1.txt`, no 404.
