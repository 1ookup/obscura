# 挑战指纹缺陷修复计划（step 90 缺陷 1-6）

来源：step 90（见 `Cloudflare-challenge-profile.md`）对拍发现的六组缺陷，由 6 个并行代码调研产出
（2026-08-27，分支 `feat/challenge-fingerprint-parity`）。每份计划含现状定位（文件:行）、根因、
方案、分步实施、验证、风险；本文开头是跨计划的合并结论。

## 总览：依赖关系与实施批次

### 共同根因（三份计划收敛到同一处，必须原子落地）

`crates/obscura-net/src/fingerprint.rs::from_user_agent` 的 **macOS 分支（161-192 行）**：
`architecture:"x86"`（172 行，UA-CH 错）+ `gpu = Intel Iris Metal`（188-191 行，WebGL
UNMASKED 错）。UA=Mac + GPU=Intel + arch=x86 的自相矛盾同时污染 UA-CH（iqypc0）、WebGL
（GisI3）、WebGPU（Bpqf7）三个面。**architecture/GPU 串/WebGL 模板档位必须一个提交内一致
翻转，分半落地会造成更糟的中间态**（三份计划独立得出同一警告）。

模板侧的统一机制：WebGL 计划的 `_webglProfile()` 与 WebGPU 计划的 `_gpuProfile()` 是同一
设计（读 `_fingerprint().uaPlatform` 选数据档，macOS→apple、Windows→d3d11/intel），实施时
合并为**一个 profile 选择器 + 各自的数据表**。帧/worker realm 的指纹种子化已就绪
（realm.rs:816-820/1724），选择器天然生效，Rust 侧无需新传播管线。

### 前置采集（三个计划都需要，合并做一次）

在参考 Chrome（同一台 PV 虚拟 Mac，与 payload 基线同机同版本）跑全量 dump：
1. window 构造器面（N 桶计划 Step 1：descriptor/构造行为/prototype 父链/navigator 面）；
2. GPU 面（WebGL/WebGPU 计划 Step 1：扩展全序、全常量 getParameter、53 格式 SAMPLES、
   getContextAttributes 变体、requestAdapter().info/features）；
3. iframe 几何基准（iframe 计划第 0 步：双源复现页的每属性取值）。
铁律：**只认基准机实测**（VM 的 UNIFORM_BUFFER_OFFSET_ALIGNMENT=16 与网传 256 相反，已证明
网络数值不可用）；扩展/features 的**迭代顺序是可观测面，逐字转录不排序**。

### 实施批次（按依赖与收益排序）

| 批次 | 内容 | 依赖 |
|------|------|------|
| B0 | 前置采集（上面三项） | 无 |
| B1 | fingerprint.rs macOS 分支原子翻转（arm/Apple GPU/26.4.0）+ UA-CH 三档拆分 + `--fingerprint` overrides CLI 面 + 默认 UA 收敛 149（UA-CH 计划 Step 1-3） | B0（GPU 串取值） |
| B2 | WebGL/WebGPU 模板挂 profile 选择器 + Apple 档落表（WebGL 计划 Step 2-7 + WebGPU 计划 2-6） | B0、B1 |
| B3 | iframe realm 构建顺序修复（指纹注入先于 `__obscura_init`）+ 窗口级几何全 realm 共享 + 隐藏帧 innerWidth=0（iframe 计划第 1-3 步） | 无（可并行） |
| B4 | N 桶批量外壳：oracle 数据表 + 通用安装器 + navigator 42 属性 + 伴生缺陷（N 桶计划 Step 2-6） | B0（oracle） |
| B5 | iframe 文档属性：domain/compatMode/lastModified/webkit 别名/adoptedStyleSheets/referrer（iframe 计划第 4-7 步） | B3 |
| B6 | measureText 亚像素 + 1/64 量化（渲染计划路线 1） | 无 |
| B7 | canvas 渐变/路径填充/AA 相位 A-B（渲染计划） | 无 |

B6/B7 完全独立可随时插入；B4 工作量最大（约 722 接口 + 42 navigator + 数据表基建），
建议与 B1-B3 并行推进。每批独立提交、独立过验证门。

### 跨计划风险合并

1. **中间态一致性**：B1 必须原子；B2 的 Apple 档与 B1 的 GPU 串要同批或紧随。
2. **数据换汤**：Apple 档抄错一项就是新错配；全部逐字转录基准机 dump。
3. **773 外壳的构造行为**：Chrome 自身两档（Sensor 系可构造、AudioNode 系 Illegal
   constructor），必须逐名采自 oracle，不能一刀切；Proxy/惰性方案已被否决
   （getOwnPropertyNames + getOwnPropertyDescriptor 一眼识穿，必须 eager 真实安装）。
4. **measureText ≠ 元素宽度的 <1px 新不一致**（B6 固有代价）：canvas 通道分数、布局保持
   ceil；若日后证据表明 CF 交叉校验两者，再启动路线 2（全语料重基线，本次明确不做）。
5. **性能门**：B4 的 frame realm 每帧 +2-3ms（773 个外壳安装，噪声带内）；B7 的 canvas JS
   光栅是新增逐像素循环，需单列 canvas 页基准。均按 CLAUDE.md 交错基准验证。
6. **验证判据**：质询复测一律按探针字段名对拍（分片号两边错位）、多轮取判据、不用带
   attachShadow 注入的探针拿枚举类字段（盲区表）。

---

## 计划 1：N 桶 window 构造器批量外壳

### 现状定位
- 外壳原生标记基础设施：bootstrap.js:191-206（`_markNative`/`Function.prototype.toString`
  覆写）；`_illegalConstructor`（13514-13534，现有 4 名在用，即批量外壳原型）；
  `_applyWebIdlEnumerability`（19646-19692）；`_pristineGlobalNames`（19694，新 frame 枚举面
  来源，新增全局必须在它之前安装）。
- 现状 399 个 N 桶条目 = V8/deno_core ES 内建 + bootstrap 手写 ~190 接口；缺失 722 个裸名中
  **696 个在 bootstrap.js 完全没出现过**（纯未实现）。
- navigator：bootstrap.js:7879-7981（own 数据属性）+ 7986-8034（`_navProto`）。
- realm：realm.rs:38 `BOOTSTRAP_SRC` include_str!；797（异步）/1714（同步，4ed91e1）完整重
  执行 bootstrap → **顶层安装对主 realm 与每个 frame realm 自动生效**；主 realm 走 build.rs
  snapshot 烘焙（runtime.rs:560），零新增 JS 执行成本。
- 伴生缺陷：`_ScopedDocument`（6887-6897）own 方法遮蔽致 f 桶 7 项；7871 `ContentIndex` 等
  8 个 obscura-only 多出项；3 处 `new DOMException("NotAllowedError")` 单参调用（name 错成
  "Error"，shim 签名是 `(message, name)`）。

### 方案选型
**快照数据表 + 通用安装器**（否决手写 773 定义与 Proxy/惰性——后者被 CF 的
getOwnPropertyNames/getOwnPropertyDescriptor 直读路径识穿，必须 eager 真实安装）。数据表为
bootstrap.js 底部定界段（`_chromeInterfaceTable`），oracle 存
`js-repros/window-surface/chrome-oracle.json`（同 secure-context 惯例），采集脚本进
`.claude/skills/obscura-challenge-probe/scripts/chrome_window_surface.py`。Chrome 的接口全局
enumerable:false（bootstrap.js:20-109 已验证）。

### 分步
1. Chrome oracle 采集（每名字的 descriptor/`fn.name`/`length`/prototype 父链/`new X()` 结果
   三档/tag/secureOnly；navigator 同法；用 CF 的 1164 N + 121 o 清单交叉校验）。
2. 生成数据段（~722 接口 + 42 navigator + ~20 对象）。
3. 安装器（顶层、`_pristineGlobalNames` 前）：接口类 `{writable:true, enumerable:false,
   configurable:true}`，构造行为按表三档，prototype 接父链，全部 `_markNative`，
   **`typeof undefined` 才装**（不遮蔽 RTCPeerConnection:15441、Worker 等真实实现）；window
   函数类（fetchLater/queryLocalFonts/show*Picker 等 ~15 个手写行为表）；o 桶对象
   （BarProp 系/external/styleMedia/cookieStore/GPU 常量表等）。
4. navigator 42：对象类走 `_navProto` getter 返回缓存单例（prototype 指向对应外壳，
   `getPrototypeOf(navigator.bluetooth)===Bluetooth.prototype` 自洽）；方法类 Chrome 对齐拒绝
   语义。
5. 伴生缺陷（f 桶 7 项、obscura-only 8 项、3 处 DOMException 双参）。
6. 测试：主/frame realm `getOwnPropertyNames(globalThis)` 对 oracle 差集为空/白名单；descriptor
   抽样；new 三档；跨 realm 外壳不等。
7. 端到端：enum_realm.py 对拍 + capture_challenge 复测（N 桶 ≥1160、f 桶归零、无新增
   obscura-only）+ 交错基准（frame realm +2-3ms 预期，噪声带内）+ obstacle 33/33 + 双形态
   （stealth / no-default-features）。
8. profile 文档记 step。

### 风险
构造行为错配（最大）、深度探针（fn.length/name/父链由表承载）、版本耦合（oracle 与 UA 149
锁死，升 UA 重采）、secure context 反向指纹（http 页不暴露 bluetooth/caches，接
`_applySecureContextGating`）、只补 CF 并集不超卖（ContentIndex 教训）、skip-if-undefined
双保险、snapshot 体积微增。

## 计划 2：UA-CH 与 UA 联动

### 现状定位
- JS 壳已完全参数化（bootstrap.js:7873-7916 全从 `_fingerprint()` 取值，无需改）；
  `__obscura_set_fingerprint`（772-788）冻结安装；Rust 注入 runtime.rs:834-863（主+全部 frame
  realm）。
- 唯一派生点 `from_user_agent`（fingerprint.rs:86-244），所有入口走它（serve cdp
  server.rs:233-240 → browser context.rs:129-132；fetch cli main.rs:787-789；mcp lib.rs:858/
  1674；CDP Network.setUserAgentOverride network.rs:58-93 已支持 userAgentMetadata）。
- worker 继承 worker.rs:1315 已验证。

### 根因
UA 里 `Intel Mac OS X 10_15_7` 是冻结残渣（Apple Silicon 也这么写），`architecture`/
`platformVersion` 从 UA token 推导**方法上不可能对**（fingerprint.rs:172 的 "x86"、162-164 的
token 解析）；brands 是否含 "Google Chrome" 是品牌二进制 vs Chromium 之别，UA 不携带此信息
（95-97 行启发式必错）；grease 算法本身已逐字正确（"Not)A;Brand"/24 与参考机一致），只缺
独立开关。默认值三处漂移：DEFAULT_USER_AGENT=146（fingerprint.rs:73-74）、
STEALTH_USER_AGENT=145（wreq_client.rs:28-29）、wreq 仿真钉 Chrome145+Windows（166-169）、
`/json/version` Browser=146 硬编码（cdp server.rs:651）。`with_overrides`（246-281）单独覆盖
brands 不重导 fullVersionList 会产混合形状。

### 方案
字段三档拆分：可推导（platform/mobile/model/wow64/bitness/grease）保持联动；平台可定值
不可推导（architecture mac→arm、platformVersion mac→常量 26.4.0、Win NT10.0→15.0.0、GPU）
改平台默认常量；完全不可推导（brands 形状、reduced UA 的完整版本）只走 overrides。
`FingerprintOverrides` 加 serde derive，新增全局 `--fingerprint <JSON|@file>` +
`OBSCURA_FINGERPRINT_JSON`（多 worker serve 走 env 转发，main.rs:585-605 必须带上）。
默认身份改 macOS Chrome 149（DEFAULT/STEALTH 收敛同一常量；wreq 仿真 Chrome148+MacOS，
rc.12 无 149；`/json/version` 从指纹派生）。

### 分步
1. fingerprint.rs 平台默认修正（mac arm/26.4.0/Apple GPU、Win 15.0.0、with_overrides 的
   brands 一致性、测试 380-453 更新）。
2. overrides CLI/env 暴露（fetch/serve/scrape/mcp 四入口 + 多 worker 转发）。
3. 默认身份对齐 149（wreq_client.rs 166-169、server.rs:650-657、波及测试与
   Configure-stealth 文档）。
4. 验证：`fingerprint_contract_drives_navigator_ua_ch_and_screen`（runtime.rs:8734-8795）更新；
   CDP 对拍 `userAgentData.brands`/getHighEntropyValues 与 payload iqypc0 逐字段 diff（iframe
   realm 也测）；wire 层 sec-ch-ua 头实测；thelancet 三轮复测 iqypc0 零差；TLS 对拍
   （tls.peet.ws，145-Win→148-Mac）；全量门 + obstacle 33/33。

### 风险
wreq 仿真重钉需 echo 实测；默认翻转改变所有不带 --user-agent 用户的行为面（step 89 明确
意图）；arm/26.4.0 是主张非推导（overrides 逃生口 + 文档写明）；多 worker 转发遗漏会静默丢
失（--workers 2 验收）。

## 计划 3：WebGPU adapter（Bpqf7）

### 现状定位
全部硬编码于 bootstrap.js:15906-16081（dd592e8）：`_GPU_LIMITS`（15914-15952）、
`_GPU_ADAPTER_FEATURES`（15979-15986，17 项无 astc/etc2）、`GPUAdapterInfo` vendor='intel'/
architecture='gen-9'（16035-16045）、`requestAdapter` 忽略 options（16071-16076）、
`getContext('webgpu')` 不存在（14854-14871 落 return null）。WebGL 先例（14866、8220-8223）
已联动 `_fingerprint().gpu`，WebGPU 没有。

### 对拍差集（9 子元素中 6 处）
info 元组 `["apple","","","",0]` vs intel/gen-9；limits 37 项中 8 项（maxSampledTextures
48/16、maxBufferSize 4294967292/2147483648、maxVertexAttributes 30/16、subgroup null/8-32
等）；features 20/17（+astc/+astc-sliced-3d/+etc2，顺序不同）；requestAdapter 变体
forceFallbackAdapter 应回 null；device 默认 limits subgroup null；canvas WebGPU 上下文探针
`["bgra8unorm",16,"premultiplied","srgb","standard",[]]` vs obscura null。

### 分步
1. 真实 Chrome 探针定准 null vs undefined、getConfiguration 默认值、GPU 常量值。
2. `GpuFingerprint` 加 `webgpu_profile`（serde default 兼容旧 JSON；mac→apple、win/linux→
   intel、Android TODO）。
3. bootstrap.js 建 `_GPU_PROFILES`（intel=现值搬移、apple=逐字转录），getter 访问时解析
   profile（三级兜底 webgpuProfile→uaPlatform→intel），不能类定义期固定（frame realm 的
   bootstrap 先于指纹脚本执行）。
4. `requestAdapter(options)` 处理 forceFallbackAdapter→null；apple 档 subgroup null。
5. `getContext('webgpu')` 最小 GPUCanvasContext（configure/unconfigure/getConfiguration/
   getCurrentTexture，默认 usage=16/toneMapping 'standard'/viewFormats []）。
6. 伴随：GPU{BufferUsage,ColorWrite,MapMode,ShaderStage,TextureUsage} 5 个常量对象（o 桶
   缺口）。
7. 测试更新 runtime.rs:18919 + 新 macOS 用例；非 stealth 仍答 null；真实质询 Bpqf7 9/9 对拍。

### 风险
Set 迭代顺序逐字转录；null vs undefined 以真实探针为准；只修 WebGPU 不修 WebGL 字符串则
矛盾残留（并入 B1/B2 批次）；嵌入方旧 JSON 兼容（serde default + JS 三级兜底）。

## 计划 4：iframe realm 几何与文档属性

### Ground truth（先定标准）
innerWidth/innerHeight 取本 frame 视口，**与跨源无关**——「无布局/不渲染 → 0」（step 19/20：
可见 300×65 widget 报 300/65；step 89/90：隐藏编排 iframe 报 0）。screenX/Y/outer*/screen.*
是浏览环境组属性，所有 realm 同值。domain=本 realm 文档 host；compatMode 按解析模式；
lastModified 来自 Last-Modified 头；referrer 跨源子帧报嵌入方 origin。

### 现状定位与根因
1. **frame realm 构建顺序**（最核心）：realm.rs:797-822/1714-1726 是 bootstrap →
   REALM_INIT → `__obscura_init()` → **之后**才注指纹；主 realm 相反（runtime.rs:860 先
   setter、1478-1488 后 init）。`__obscura_init`（bootstrap.js:18705-18817）以默认指纹
   （screen 1920×1080）算出 inner=1920/1000、outer=1920×1040，之后 `__obscura_apply_
   fingerprint`（8471-8485）只刷 screen.* 为 1440×900——精确复现 step 90 的矛盾组合。
2. **innerWidth 兜底语义**：op_layout_metrics（ops.rs:7796-7850）frame root 失效时走顶层
   gs.viewport（7840-7844 顶层泄漏另一路径）；`frame_content_box_from_parent` 的
   `>=1.0` 判定（ops.rs:7415-7433）使隐藏帧必然 None → bootstrap 回退屏幕值
   （bootstrap.js:18740-18816），Chrome 应为 0。
3. **domain**：基类 getter（5307-5312）读顶层 URL（`_documentUrlHost`→`document_url` op→
   gs.url）；`_ScopedDocument` 覆写了 URL/compatMode/referrer 却漏 domain。
4. **compatMode**：顶层基类恒返 "CSS1Compat"（5369），DomTree 顶层 quirks 标志
   （tree.rs:564-571）无 op 暴露；frame 侧 quirks 链路健全但 widget 报 CSS1Compat，疑点在
   sync about:blank 路径硬编码 `quirks:false`（ops.rs:1659-1677）与 realm 生命周期错位，
   需第 0 步诊断钉死。
5. 其余：lastModified 无实现；webkitVisibilityState/webkitHidden 无别名；referrer 链路在但
   widget 值缺需实测；adoptedStyleSheets 的 `_adoptedStyleSheets` 等仍是字符串键自有属性
   （违背 e487e85 Symbol.for 政策）。
6. **窗口级几何无指纹联动**：ScreenFingerprint（fingerprint.rs:35-43）无窗口位置/outer 尺寸
   字段；screenX/Y 全 realm 硬编码 0（bootstrap.js:12776-12777）。

### 分步
0. 双源复现页（127.0.0.1:A 父 + :B 子跨源，禁止 data: 旁路；可见/hidden/0×0/嵌套 iframe；
   带/不带 DOCTYPE 子页）+ 参考 Chrome 基准 + 钉死两个未决诊断（innerWidth 走哪条泄漏路径、
   widget quirks 为何 false）。
1. realm.rs 两条路径指纹注入移到 `__obscura_init()` 之前（`_fpSeed` 重置顺序对调后反而使
   frame 与主 realm 伪随机序列同构）。
2. ScreenFingerprint 增 outer_width/outer_height/window_left/window_top（进
   FingerprintOverrides；确定性默认，不允许随机）；`__obscura_init` 的 outer*/screenX/
   avail* 全取指纹 + 引擎窗口状态；stealth 下默认视口从指纹屏幕推导（消除 1920×1000 >
   1440×900 不可能组合；显式 set_viewport 仍优先）。
3. op_layout_metrics 隐藏帧返回显式零值（`rendered:false` JSON，参照 7898-7902 的 hasBox
   模式）；readFrameMetric 零值语义；审计 `_renderScrollMetrics`（4610-4621）等消费方。
4. `_ScopedDocument` 补 domain getter/setter（scope URL host；opaque origin 返 ""）。
5. compatMode：document_scope_info root-0 分支补 quirks；about:blank 继承创建者 quirks。
6. lastModified（DocumentScope 加 last_modified_ms，page.rs 提交时解析响应头；格式
   MM/DD/YYYY HH:MM:SS）；webkit 别名；adoptedStyleSheets 改 Symbol.for 键。
7. referrer 闭环验证。

### 风险
op_layout_metrics 返回形状变化的消费方需原子同改；指纹前置对 `__obscura_init` 内依赖
_fingerprint 分支（secure gating/UA-CH/canvas 伪随机）的 realm 专属假设需全量测试；默认视口
推导改变无显式 viewport 时的基线（仅 stealth 路径，文档写明）；不可上 hostname 特判。

## 计划 5：WebGL（wShvj2/mYHfU0/JlnK7）

### 现状定位
模板全在 bootstrap.js：`_WEBGL1_EXTENSIONS`（8081，36 项）、`_WEBGL2_EXTENSIONS`（8097）、
`_WEBGL1_PARAMETERS`（8116）、`_WEBGL1_ARRAY_PARAMETERS`（8160）、`_WEBGL2_PARAMETERS`
（8165）；`_WebGLContext`（8211）的 getContextAttributes（8216 硬编码 antialias:false）、
getParameter（8219，UNMASKED 已读 `_fingerprint().gpu`）、getInternalformatParameter（8310
对 SAMPLES 无条件 `Int32Array([8,4,2,1])`）；getContext（14854）丢弃 attrs。

### 对拍解码（关键成果）
- **wShvj2**（15 元素）：[0]数量 [1]列表 [2]差集 [3-8]limits [9]precision（已逐项一致）
  [10]含 MAX_VIEWPORT_DIMS（16384² vs 32767²）[12]SHADING_LANGUAGE_VERSION（模板只登记
  桌面 GL 常量 0x1F03，**WebGL 规范常量是 0x8B8C**，真 bug）[13]MAX_VERTEX_UNIFORM_VECTORS
  （1024 vs 4096）。
- **mYHfU0**（37 元素 16 处差）按值考古映射：MAX_TRANSFORM_FEEDBACK_* 120/120→4/128、
  MAX_VERTEX/FRAGMENT_UNIFORM_BLOCKS 12→16、MAX_COMBINED_* 24→32、MAX_UNIFORM_BLOCK_SIZE
  65536→16384、MAX_COMBINED_*_UNIFORM_COMPONENTS 212992→69632（16块×4096+4096 自洽）、
  MAX_SERVER_WAIT_TIMEOUT 2147483647→0、MAX_ELEMENT_INDEX null→4294967294（模板缺 0x856F）、
  UNIFORM_BUFFER_OFFSET_ALIGNMENT 256→16（**基准机实测，网传 256 是错的**）、
  IMPLEMENTATION_COLOR_READ_FORMAT/TYPE（模板缺 0x8B90/0x8B91）、idx32=0x8B8C、idx33 未识
  列表探针、idx34 getContextAttributes（Chrome antialias:true 且回显 powerPreference:
  'low-power'）、idx35/36 drawingBufferColorSpace/unpackColorSpace "srgb"（Chrome 129+，
  obscura 无此属性）。
- **JlnK7**：getInternalformatParameter(RENDERBUFFER,fmt,SAMPLES) 探针；[3] 是探针自己的 53
  格式候选表（两侧相同）；Chrome 仅 15 格式非空且全 `[4,2]`（R8/RG8/RGB8/RGBA8/
  SRGB8_ALPHA8/RGB10_A2/RGBA4/RGB5_A1/RGB565/DEPTH_COMPONENT16/24/32F/STENCIL_INDEX8/
  DEPTH24_STENCIL8/DEPTH32F_STENCIL8），obscura 34 格式全 `[8,4,2,1]`。修法=按格式查表，
  非继续无条件返回。

### 分步
1. 基准机全量 dump（扩展全序/全常量/53 格式 SAMPLES/getContextAttributes 变体/
   requestAdapter），与 payload 交叉验证定案 pname 映射。
2. 模板重构 `_WEBGL_PROFILES = {d3d11: 现值, apple: 新表}` + `_webglProfile()` 选择器（读
   uaPlatform；Linux 暂 d3d11 注明；D3D11 档现值不动——无 Windows 基准 capture 不瞎改）。
3. Apple 档落表（36−provoking_vertex+4 压缩纹理按实际顺序、limits 逐项、SAMPLES 15 格式
   查表、MAX_VIEWPORT_DIMS 16384²、MAX_VERTEX_UNIFORM_VECTORS 1024）。
4. 平台无关修正（独立提交）：0x8B8C/0x8B90/0x8B91 补常量；getContextAttributes 回显 attrs
   （getContext 需存储）；drawingBufferColorSpace/unpackColorSpace "srgb"。
5. fingerprint.rs macOS 分支（并入 B1 批次）。
6. WebGPU 挂同一选择器（并入 B2）。
7. 测试拆两档（默认 Windows 断言现值；macOS+stealth 断言 Apple 档全项）。

### 风险
数据换汤（只用基准机 dump）；扩展顺序错=全错；Step5 波及四面必须一个提交；D3D11 档
SAMPLES 查表化会让 Windows 档行为变（保持现行为，查表按 profile 供给）；GL 枚举常量挂
prototype 另开提交。

## 计划 6：渲染指纹（qSsL2 亚像素 + nMlxj2 canvas）

### 现状定位（含本地复现实证）
- measureText：bootstrap.js:14692 → `_measureTextBox`（14488）→ `op_canvas_text_metrics`
  （ops.rs:5797）；Rust 测量 inline.rs:1212 `measure_canvas_text` → `measure`（1453）→
  `measure_text_with_wrap`（1465）→ **`buffer_size` 的 `w.ceil()`（inline.rs:2410）唯一取整层**。
  shaping 本身是浮点（cosmic-text shape.rs:275）；`measure_word`（1486-1516）已有分数先例。
  实验证实 ceil 而非 round（1px 'i' advance≈0.2227 返回 1）。
- Chrome 观测值全是精确 1/64 倍数（28.9375=1852/64、12.109375=775/64、787.890625=50425/64）
  ——Skia 26.6 定点逐 glyph 量化形态。
- canvas：`_Canvas2D`（bootstrap.js:14548-14822）。本地复现：fillRect 正常；**渐变填充零
  效果**（createLinearGradient:14808 是不存 stop 的空壳，`_parseColor` 收渐变对象返
  [0,0,0,0] 全透明）；多边形 fill（'L' 段忽略）、stroke（14802）、transform（14806-14807）、
  ellipse（14818）全不绘制；fillText 画 `_fpRand` 伪随机点阵；getImageData（14723-14740）
  返回普通对象非 branded ImageData。
- 非 render 构建：ops 全 `#[cfg(feature="render")]`；bootstrap.js:14502-14504 回退
  `length*6*scale`。

### 方案
**路线 1（选定）**：只在 canvas 测量通道返回亚像素——`measure_canvas_text` 改为直接遍历
`layout_runs()` 取分数行宽（仿 measure_word，canvas 文本单行 Pre、无 indent/tab，first_line_
offset/line_edge_advance 均 0），逐 glyph advance 做 1/64 量化（`(a*64).round()/64.0`）求和，
具有 Chrome N/64 形态（f32 对 1/64 精确）。**布局保持 ceil，零热路径开销**；代价是 canvas
宽度与 getBoundingClientRect 出现 <1px 差（改 runtime.rs:4231 断言为 ceil 一致性）。
路线 2（全布局亚像素）明确不做：换行翻转、全语料重基线，无证据 CF 探测元素宽度。
canvas 按相位：A 渐变（stops 存储+逐像素 t 插值 sRGB 非预乘）、B 路径填充+AA（多边形/
带角度弧/ellipse，扫描线+超采样产灰阶边缘）、C stroke/transform（按复测证据决定）、D
native fillText op（复用 paint.rs:7020 draw_text 覆盖度光栅；非 render 保留点阵回退）；
顺手 getImageData 返回 branded ImageData。

### 验证
`js-repros/canvas-fingerprint/`（capture-chrome.mjs + oracle + probe，仿 font-fingerprint 惯
例）measureText 矩阵与 canvas 读回对拍（非整数、N/64 形态、灰阶过渡；Liberation≈Arial 残差
留容差不逐位承诺）；真实质询 qSsL2/nMlxj2 复测（多轮）；render-repros **像素零差是关键回归
信号**（路线 1 不触碰布局，截图变了就是改坏了）；canvas 页性能单列；`--no-default-features`
回退路径行为合理。

### 风险
canvas≠元素宽度的新不一致（路线 2 逃生口）；字体残差与 1/64 tie 差（容差断言）；JS 光栅
成本（紧循环+damage 合并）；native fillText 的合成语义必须与 _setPixel 单点一致（直 alpha
vs 预乘）；toDataURL 字节级差异永存（若 nMlxj2 hash 输入是 dataURL 只能形态收敛）；8/6 与
0.0065/0.0046 若复测证明源自 AudioContext 则另行处理（bootstrap.js:799-803）。
