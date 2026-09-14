# 进度日志

> 当前状态：未通过。请求头与 frame 导航环境已修复并通过回归；真实 `/1.txt` 仍卡在代理到
> `brunhild.challenges.cloudflare.com` 的 challenge `/i` 路径（当前 `502`/无完成响应）。
>
> 未决：代理恢复后重新执行物理点击，必须观察第二次 `/1.txt` 导航并确认真实 `404`。

## 会话：2026-08-28

### 阶段 1：诊断
- **状态：** complete
- **开始时间：** 2026-08-28 23:00 +08:00
- 执行的操作：
  - 三层插桩确认 iframe entry 构造、写入 timeline、observer 交付顺序。
  - 解码 btnGW2/MhAgV7 表达式。
- 创建/修改的文件：
  - `docs/Cloudflare-challenge-profile.md` step 93

### 阶段 2：实现
- **状态：** complete
- 执行的操作：
  - 读取 runtime/page 的 microtask、frame navigation、message ordering 实现。
  - PO-LIST 插桩证伪 checkpoint 根因。
  - Chrome 151 双端口 oracle 确认 payload item 来自 child navigation timing。
  - BrowsingContext 增加 generation-scoped navigation_timing。
  - 网络 frame commit 生成完整 child navigation entry。
  - frame realm 创建后、preload/author scripts 前安装 entry。
- 创建/修改的文件：
  - `crates/obscura-browser/src/frames.rs`
  - `crates/obscura-browser/src/page.rs`

### 阶段 3：回归测试
- **状态：** complete
- 执行的操作：
  - 扩展现有 frame resource timing 测试，新增 child navigation timing 断言。
- 创建/修改的文件：
  - `crates/obscura-browser/src/page.rs`

## 测试结果
| 测试 | 输入 | 预期结果 | 实际结果 | 状态 |
|------|------|---------|---------|------|
| 实现前真实站 | thelancet payload-1 | jdnfg5 含 iframe | 仅 api.js | fail（基线） |
| Chrome oracle | 双端口跨源 iframe | 区分 parent resource / child navigation | parent sizes=0；child sizes=body+300 | pass |
| focused nextest | frame timing 单测试 | child navigation timing 完整 | 1 passed | pass |
| crate nextest | obscura-browser release+render | 无 frame/browser 回归 | 106 passed | pass |
| release build | obscura-cli bins render+stealth | 精确构建成功 | Finished release | pass |
| thelancet r2 | payload-1.jdnfg5 | rch item 非零 | 2 items；440041/439741 B | pass |
| thelancet r3 | payload-1.jdnfg5 | rch item 非零 | 2 items；440020/439720 B | pass |
| thelancet r4 | payload-1.jdnfg5 | rch item 非零 | 2 items；440041/439741 B | pass |
| workspace nextest | release+render+stealth | 全量通过 | 1656 passed，4 skipped | pass |
| feature opt-out | obscura-js + obscura-cli no-default | 编译检查通过 | Finished dev check | pass |
| obstacle course | companion repo | 33/33 | 仓库不存在，未运行 | unavailable |
| final binary smoke | thelancet payload-1 | rch item 非零 | 2 items；440020/439720 B | pass |

## 错误日志
| 时间戳 | 错误 | 尝试次数 | 解决方案 |
|--------|------|---------|---------|
| 23:44 | 8s 三轮 payload-1 提取命令 exit 4 | 1 | 检查各轮日志与页面状态后调整等待窗口 |
| 23:55 | 合并小修与 findings 的 patch 上下文不匹配 | 1 | 拆分并按实际表格位置更新；失败尝试未改文件 |
| 00:08 | final smoke jq 摘要管道上下文错误 | 1 | 改用 object 构造与显式括号；确认 payload 顶层 object |
| 00:10 | check-complete.sh 未识别中文模板，显示 0/0 phases | 1 | 人工核对 task_plan 六阶段均为 complete；脚本退出码 0 |

## 五问重启检查
| 问题 | 答案 |
|------|------|
| 我在哪里？ | 阶段 6，交付检查 |
| 我要去哪里？ | 已完成，交付结果 |
| 目标是什么？ | child frame realm 有 navigation entry，jdnfg5 收到 rch item |
| 我学到了什么？ | 见 findings.md |
| 我做了什么？ | 实现 child navigation timing，完成本地/全量/真实站验证 |

---
*每个阶段完成后或遇到错误时更新此文件*

## 会话：阶段 186（HaHaVM iframe/CSP 与真实 404）

- 读取 HaHaVM-General 的 `createBrowserEnv.js`、README 和 iframe 资源模型。
- 发现 Obscura native trace 占用 V8 embedder slot 0，修复为 slot 1；dynamic import、worker、iframe 相关崩溃全部消失。
- 当前进入 iframe CSP、错误响应文档提交和真实 404 验收对照阶段。

## 会话：2026-09-03 阶段 67

## 会话：2026-09-05 真实 thelancet 404 推进

- 基线 release + native trace 请求 `https://www.thelancet.com/1.txt` 仍停在 Cloudflare
  `Just a moment...`，错误为 `Cannot convert undefined or null to object`（inline loader
  `:1:3861`），trace 111 条，未出现 `navigator.*`/`screen.*` 采集阶段。
- 尝试修复：在 `op_run_classic_script` 和 `execute_classic_script_at` 执行作者脚本期间
  临时隐藏 `Deno`，分别提交 `c55970d`、`51945ec`。
- 复测证明该假设错误：Cloudflare inline loader 依赖 `Deno.core` 加载 challenge 脚本；隐藏
  后错误变为 `Cannot read properties of undefined (reading 'core')`，仍未到达 404。
- 已用 `da958a4`、`b38b198` 两个 revert 提交撤销上述行为修改。保留提交历史作为否证证据，
  当前代码恢复基线。
- 结论：`window.Deno` trace 行不能直接作为首要修复目标；下一步必须在保留内部
  `Deno.core` loader 能力的前提下定位真正的 null/undefined 访问，并确认 native trace 对
  unresolved global/instance miss 的记录是否覆盖该调用路径。
- 新一轮 `RUST_LOG=obscura_js=debug` 证据：`chl_page` 返回 200（约 234 KB），顶层 `/fo`
  返回 200（约 113 KB），Turnstile frame `/fo` 返回 200（约 823 KB），随后
  `GET https://brunhild.challenges.cloudflare.com/.../i/...` 返回 **401**；后续 frame `/fo`
  仍返回 200。请求的 `Origin=https://challenges.cloudflare.com` 已发送，`credentials=omit`，
  API trace 不记录它是预期行为，因为该请求直接走 `op_fetch_url`；应使用 `--trace-op-file`。
- 结论：当前 404 阻断点已从 JS 初始化推进到 brunhild `/i` 网络响应；在没有 Chrome 同请求
  的 headers/代理响应对照前，不应把 401 归因到缺少 DOM 属性或方法。
- 追加对照：同一代理直接 `curl https://brunhild.challenges.cloudflare.com/` 返回 502
  （mitmproxy `connection closed`）；本机 Chrome headless 经同一代理在约 45 秒内无 DOM 输出。
  这说明代理/上游会话本身不稳定，不能据此修改 credentials、Origin 或 Referer 语义。
- 已提交的诊断增强 `c46b11b` 保留，native host-op trace 可记录请求边界；当前没有新的行为修复
  可安全提交，下一步需要代理提供可重复的 Chrome `/i` 响应对照或稳定会话。
- `e5a7c28` 后的 35s 交互实测：第一次点击后触发 proof `/fo`（200，约 846 KB）和新的顶层
  `Page.navigate`；页面短暂进入空文档后重新创建 challenge，随后第二次点击仍回到
  `Enable JavaScript and cookies to continue`。未出现最终 404，且服务端记录
  `Cannot find Widget ...` 清理警告。blob Referer 修复已越过最初的 `/i` 401，但 proof
  仍未被 Cloudflare 接受，下一步需对点击事件字段/iframe widget 生命周期与 Chrome 对拍。

- 读取并对比 `/Volumes/ZHITAI/projects/iv8` 的 `AccessMonitor`、README 和 `fork_trace.py`；确认目标契约为 debug API access monitor。
- 确认当前 Obscura 已有 trace-patched V8 的 lookup/call hook，但没有 iv8 风格 debug monitor 入口。
- 当前状态：准备在现有 V8 hook 上增加兼容输出模式，并接入 CLI/serve。
- 已完成：`--trace-api-file` / `--trace-api-ignore`、`OBSCURA_TRACE_API_FILE` / `OBSCURA_TRACE_API_IGNORE`，bootstrap 根对象 getter/miss/setter/query 监控，Rust 文件 sink，worker 环境继承和文档。
- 验证：CLI release nextest 66/66；`cargo check -p obscura-js -p obscura-cli --config vendor/v8-source.toml` 通过；精确 render+stealth release build 通过；`vendor/v8-trace.sh check` 为 patched；release smoke 产出 iv8 兼容 getter/miss/setter 行。
- 已知测试缺口：`obscura-js::realm::tests::frame_elements_report_their_own_document_geometry` 在无 trace 环境下稳定复现 1440x820 vs 180x40，与本改动无直接关联；记录但未改动其行为。
- 用户追问确认：当前新能力不依赖历史 V8 trace，但也不能把 Proxy 方案宣称为 DOM/BOM 全量 iv8 等价；全量 global/prototype/独立实例 miss 需要新的运行时 interceptor 方案。
- 用户进一步要求禁止 Proxy、改为 iv8 全量 native 等价；已撤销阶段 67 的 Proxy/op/CLI 实现，进入阶段 68 的 V8/deno_core context interceptor 可行性审计。
- 阶段 68 审计：`ContextOptions.global_template` 只能在创建 Context 时生效；主运行时由 deno_core startup snapshot 创建 Context，frame 由 `Context::new` 创建，但现有 Navigator/Document/Element 均已由 bootstrap 作为普通 JS 对象实例化，公共 V8 API 无法事后追加 named interceptor。全量 iv8 等价必须先改 deno_core snapshot/context 创建和 browser interface 建对象路径，再覆盖 generic lookup/call；当前没有继续保留 Proxy 近似实现。
- 阶段 68 实现：加入 `vendor/v8-iv8-trace.sh` native patch，接入 `vendor/v8-trace.sh build`；V8 直接输出 iv8 格式 getter/miss/query/setter/global lookup，CLI `--trace-api-file` 自动启用 feedback allocation，未改 bootstrap/页面对象。release smoke 已得到 `navigator.userAgent`、`navigator.__missing_iv8__`、`in`、setter 与 `typeof MissingApi` 记录；CLI nextest 66/66 通过。
- native patch 自包含审计通过：脚本不再引用旧 property-trace reporter 符号；`bash -n`、重复应用幂等、`cargo check -p obscura-js --config vendor/v8-source.toml` 通过。最新 CLI smoke 输出 6 行目标记录（getter/miss/query/setter/document/global miss），无 Proxy trace 代码。
- workspace release nextest 已启动并完成编译，但在既有 `runtime::tests::shadow_root_identity_and_children_are_native_tree_backed` 处运行约 5 分钟无子进程，按仓库已知 hang 记录并终止残留 nextest；不能把该轮视为全量通过。
- 最新 release native smoke：无需旧 `--trace-property-lookup` 参数即可输出 `navigator.userAgent` getter、缺失方法、`in` query、setter、`typeof MissingApi` global miss；`--trace-api-ignore navigator.userAgent` 只过滤目标路径。prototype 分类代码已编入，但直接 `Document.prototype` 的共享原型形状仍需进一步对齐。
- 最终门禁：release render+stealth build、`vendor/v8-trace.sh check`、`cargo check -p obscura-js -p obscura-cli --no-default-features --config vendor/v8-source.toml`、CLI nextest 67/67 通过；workspace nextest 在已知 shadow identity hang 处运行约 5 分钟后停止。目标仍保持 active，prototype 分类/真实 context suppress/watch breakpoint 未完成，不能标记 goal complete。
- native call hook 复核：`Runtime_TraceEnter/Exit` 入口已维护 per-thread call stack，但 bootstrap snapshot 预编译函数不产生该 runtime 回调；最新 smoke 未看到 `-> call` 行。该缺口是当前全量 iv8 等价的下一项，不以 getter 行冒充 call 记录。
- startup snapshot 重编译实验因 deno_core GothamState 缺失已撤销；当前 runtime 始终使用 snapshot，native API trace 默认不自动启用 `--trace`，避免破坏运行时状态和性能。DOM call 仍需独立 Builtins/native callback 方案。
- 进一步验证：V8 `Runtime_TraceEnter/Exit` call hook 在手工 `--trace` 下会触发 teardown fatal，已从默认 CLI 路径关闭；native lookup 仍稳定。修正 deno_core state slot 覆盖（Rust user slot 1 对应 V8 raw slot 3）后，最新 release API smoke 无 `op_dom`/GothamState panic；CLI nextest 单测重试通过。
- 当前实现阶段性覆盖：native getter/miss/query/setter、global miss、prototype receiver 分类、per-isolate setup suppress、exact ignore path；未完成：安全的 Builtins call 入口和 watch breakpoint，目标保持 active。
- 最新回归：slot 3 修复后的 release smoke `RC=0`，`--trace-api-ignore navigator.userAgent` 精确过滤，仅保留 `navigator.__missing_iv8__`；`cargo nextest` focused `test_wait_for_selector`/`test_evaluate_math` 2/2 通过。完整 CLI 首轮只剩网络 fixture `test_navigate_and_snapshot` 偶发失败，重试通过。
- 当前轮最终状态：恢复 startup snapshot 后，native API trace release smoke `RC=0`，稳定输出 `window.document`、`document.createElement`、`document.body`、`body.appendChild`、`navigator.userAgent`、global miss 与 prototype getter；未再出现 GothamState/teardown fatal。`vendor/v8-iv8-trace.sh` 幂等复放、`git diff --check` 通过。全量 iv8 call result/watch breakpoint 仍未完成，goal 保持 active。

## 会话：2026-09-02 环境收尾与真实站复测

### 阶段 44：验证与交付检查
- **状态：** in_progress
- **完成：** 按 `obscura-challenge-probe` 读取并执行 trace-patched V8/stealth 验证流程。
- **focused nextest：** `window_event_is_current_only_during_dispatch` 1/1；worker creator/frame origin 3/3；
  `scripted_fetch_site_distinguishes_origin_and_site_boundaries` 1/1。
- **完整回归：** 未排除项在 `shadow_root_identity_and_children_are_native_tree_backed` 超时后中止；排除该已知
  hang 的 workspace 为 1697 passed、1 flaky failure、5 skipped。`test_navigate_and_snapshot` 单独 `--retries 2` 通过。
- **构建：** 精确 release render+stealth build 成功，`vendor/v8-trace.sh check` 为 patched；no-default check 通过。
- **真实站：** 最终 release serve 确认 stealth TLS、Chrome 149 macOS UA。当前代理直接返回 Cloudflare 403，
  `cdp_click_fast` 40s 无 widget，未产生 proof 或 `/1.txt` 真实404。该结果记录为外部网络盲区，不归因代码。

### 阶段 45：iframe CSP 脚本执行门
- **状态：** complete
- **发现：** frame `execute_frame_scripts_for` 读取了自身 CSP 供 fetch/style 使用，但 classic/module/inline/import map
  脚本路径没有 `script-src`/nonce 校验。
- **实现：** 外部 frame script/module 在请求前按 `script-src-elem`/`script-src`/`default-src` gate；inline classic、
  module、import map 按 nonce/`unsafe-inline` gate。
- **验证：** 新增 `frame_document_csp_gates_inline_nonce_and_external_scripts` 通过；相关 frame CSP/module/external
  focused 4/4；`obscura-browser` release+render 111/111。真实 `/1.txt` 404 尚未因代理 403 完成。

### 阶段 46：CSP 修复后的真实验收
- **状态：** in_progress
- **复测：** 使用最新 trace-patched release、stealth、Chrome 149 macOS UA、零注入 `cdp_click_fast`。
- **结果：** 连续 40s 无 widget，服务端导航约 60s 后关闭；代理直接返回 Cloudflare 403 challenge，未产生
  proof/complete/目标 404。外部上游状态仍是当前唯一已验证阻塞。

### 阶段 47：动态 iframe script CSP
- **状态：** complete
- **实现：** `__prepareInsertedScript` 按 frame `DocumentScope.csp` gate 动态 classic/module/import map，
  支持来源列表、nonce 与 `unsafe-inline`，在 fetch/eval 之前阻断。
- **验证：** 动态 CSP fixture、frame CSP/module/external focused 均通过；workspace（排除已知 shadow hang）
  1699/1699，no-default check 与 trace-patched release build 通过。真实站仍因代理 403 无法取得404。

### 阶段 48：iframe module graph CSP
- **状态：** complete
- **实现：** 新增 `FrameModuleCsp`，将 frame header/origin 传入 module loader；静态及重写 dynamic import
  依赖按 script-src 指令优先级、scheme/host/port/self/wildcard 校验，阻断依赖不发请求。
- **验证：** module CSP precedence/scheme focused 通过；workspace（排除已知 shadow hang）`1700/1700`
  （1 leaky、5 skipped），no-default、release build 和 trace patch 通过。真实站仍未获得404。

### 阶段 49：iframe render warmup CSP
- **状态：** complete
- **实现：** render warmup 保留各 frame document root 的 CSP/origin，按 `img-src`/`font-src` 过滤 speculative
  图片/字体请求，避免在 frame realm 外绕过策略。
- **验证：** `frame_csp_blocks_render_warmup_resource_prefetch` 通过；其余 frame CSP focused 保持通过。真实
  目标仍返回 Cloudflare 403 challenge，尚未取得 `/1.txt` 404。

### 阶段 50：frame image renderer CSP
- **状态：** complete
- **发现：** 首次布局的 renderer 同步 image loader 绕过了 JS image op，frame `<img>` 在 `img-src 'none'` 下仍
  可能请求资源。
- **实现：** RenderResourceCache 维护当前 document CSP/origin，在同步 loader 前执行 img-src/default-src；pending
  image candidate 携带所属 root，避免跨 frame policy 错误去重。
- **验证：** image loader 与 frame warmup fixture 均通过；workspace（排除已知 shadow hang）`1702/1702`，release、
  no-default、trace patch、diff check 通过。真实目标仍未返回404。

### 阶段 51：同步 renderer 图片 CSP
- **状态：** complete
- **发现：** 首次布局的 `collect_image_intrinsics` 通过同步 `RenderResourceCache` loader 取图，绕过 JS image
  op 的 frame `img-src` 检查。
- **实现：** cache 保存当前 document CSP/origin；同步 image loader 在取 bytes 前 gate `img-src`/`default-src`，
  pending image candidates 携带所属 root。
- **验证：** loader 计数与真实 frame `<img>` warmup fixture 均通过；随后完整 workspace、release/no-default 与
  trace patch 复核通过。真实 `/1.txt` 仍因 Cloudflare 403 未取得404。

### 阶段 52：frame image root ownership
- **状态：** complete
- **发现：** pending image candidates 丢失所属 frame root，统一 transport 和首次 renderer layout 无法使用正确
  CSP。
- **实现：** 候选携带 root nid；page transport 与 RenderResourceCache 均按 root 的 `img-src`/`default-src` gate，
  并避免把禁止资源写入共享 cache。
- **验证：** frame `<img>`/CSS warmup fixture、workspace `1702/1702`、release/no-default/trace patch 全部通过。
  真实目标仍处于 Cloudflare 403 challenge，未取得404。

### 阶段 53：真实站传输层复核
- **状态：** in_progress
- **证据：** 最新 release 直连因 Reqable CA 不匹配失败于 TLS；经 `192.168.3.57:9000` 代理在 20s navigation
  deadline 超时且无 challenge body。此前 curl 可见的 403 不能作为 Obscura 页面执行证据。
- **下一步：** 代理恢复稳定响应后重做零注入 widget/proof/404 验收；当前不继续从无页面响应推断 frame API 根因。

### 阶段 54：frame unsafe-eval CSP
- **状态：** complete
- **发现：** V8 Context 默认允许 string codegen，普通 `eval`/`new Function` 绕过了 frame `script-src`；原 callback
  只处理 TrustedScript。
- **实现：** main/frame/isolated contexts 禁用默认 codegen；realm init 写入 CSP flag，V8 callback 按 flag gate，
  保留 TrustedScript 和 direct-eval 语义，flag 纳入 pre-hide。
- **验证：** top/frame CSP focused 2/2，workspace（排除已知 shadow hang）`1702/1702`，release/no-default/trace
  patch 通过。最新真实 fetch 仍 20s proxy navigation timeout，尚未取得404。

### 阶段 55：CSP codegen realm coverage
- **状态：** complete
- **复核：** main、frame main world 与 isolated world 均设置 `AllowCodeGenerationFromStrings(false)`；各 realm
  的 bootstrap flag 按自身 CSP 决定 callback 放行/拒绝，且 flag 纳入 pre-hide。
- **验证：** top/frame focused 2/2；workspace release（排除已知 shadow identity hang）`1702/1702`、5 skipped；
  release/no-default/trace patch 通过。真实目标仍为代理 navigation timeout，未取得404。

### 阶段 56：最新二进制真实站复测
- **状态：** in_progress
- **结果：** 包含 V8 codegen 与 frame CSP 修复的最新 release 经 `192.168.3.57:9000` 请求目标仍在 20s
  navigation deadline 超时，没有 challenge body/widget/proof/complete/404。真实验收继续等待外部上游恢复。

### 阶段 57：CSP codegen 最终回归
- **状态：** complete
- **复核：** main/frame/isolated contexts 均禁用默认 string codegen；V8 callback 按 realm CSP flag gate，
  TrustedScript、无 CSP direct-eval 和 flag pre-hide 行为保持。
- **验证：** top/frame focused 2/2，workspace release（排除已知 shadow identity hang）`1702/1702`、5 skipped，
  release/no-default/trace patch/diff check 通过。真实站仍因代理 timeout 未取得404。

### 阶段 58：script-src-attr inline handler CSP
- **状态：** complete
- **实现：** `Element._resolveInlineHandler` 读取当前 realm CSP，按 `script-src-attr`、`script-src`、`default-src`
  gate event-handler attributes；`unsafe-inline` 放行，其余阻断。
- **验证：** top/frame focused 3/3；workspace release（排除已知 shadow identity hang）`1703/1703`、5 skipped；
  release/no-default/trace patch/diff check 通过。真实目标仍因代理 timeout 未取得404。

### 阶段 59：最新 inline-handler 修复真实复测
- **状态：** in_progress
- **结果：** 最新 release 经代理仍在 20s navigation deadline 超时，直连 curl 仍为 Cloudflare 403 challenge；
  无 body/widget/proof/complete/404。外部上游状态未改变，真实验收继续保持未完成。

### 阶段 60：external script nonce 与真实挑战链
- **状态：** in_progress
- **修复：** 增加 HTML element `nonce` 反射，并让 dynamic CSP gate 对带 nonce 的 external script 放行；目标
  HTML 的 `a.nonce = ...` 形态已由本地 fixture 覆盖。
- **真实证据：** 最新 release 零注入 CDP 点击 `t=5.3s`，收到 `interactiveBegin`；`chl_page` 200、api.js 200、
  top/frame `/fo` 200、`/pat` 401、proof/top 3256B 均出现。当前仅 `brunhild.../i` Connect 失败，真实 `/1.txt`
  404 尚未出现。
- **回归：** workspace release（排除已知 shadow identity hang）`1703/1703`、5 skipped；release/no-default/
  trace patch/diff check 通过。

### 阶段 61：nonce 修复后的真实无注入点击
- **状态：** in_progress
- **证据：** 最新 release 直连 CDP 零注入点击在 5.3s 命中 300x65 widget，收到 `interactiveBegin`；
  `chl_page`、api.js、top/frame `/fo`、`/pat` 401、点击后 proof/top 3256B 均成功。
- **断点：** `brunhild.challenges.cloudflare.com/.../i` 在约1.1s Connect 失败，Chrome 同条件也无 response；
  目标仍未真实返回 `/1.txt` 404，等待该外部 host/fake-DNS 可达。

### 阶段 62：最终代码门禁复核
- **状态：** in_progress
- **验证：** nonce/CSP/unsafe-eval 全部修复后，workspace release（排除已知 shadow identity hang）
  `1703/1703 passed, 5 skipped`；精确 release、no-default、trace patch、diff check 全部通过。
- **真实状态：** 无注入点击仍 5.3s 命中并进入 interactiveBegin，随后仅 Brunhild `/i` Connect 失败；真实
  `/1.txt` 404 尚未出现，外部 host 可达性是当前未决条件。

### 阶段 63：Brunhild 请求归属审计
- **状态：** in_progress
- **证据：** Brunhild `/i` 由 frame challenge 触发，Origin 为 `https://challenges.cloudflare.com`、无 Referer；
  约1.1s 后 Connect 失败。198.18.0.157 fake-DNS 路由和当前代理 host down 均可复现，Chrome 同条件也无 response。
- **结论：** frame/CSP/request metadata 已排除，真实 `/1.txt` 404 仍等待外部网络恢复。

### 阶段 64：nonce 后最终链路汇总
- **状态：** in_progress
- **真实链路：** 最新 release 无注入点击 5.3s，进入 `interactiveBegin`；top/frame `/fo`、proof、`/pat` 401、
  `Verification successful` 均可观测。
- **门禁：** workspace（排除已知 shadow identity hang）`1703/1703`、5 skipped；release/no-default/trace patch/
  diff check 通过。
- **未决：** Brunhild `/i` 仍 Connect/TLS 无 response，目标 `/1.txt` 404 未取得。

## 会话：2026-08-29

### 阶段 7：内部栈泄漏诊断
- **状态：** complete
- **开始时间：** 2026-08-29
- 执行的操作：
  - 对照 live QqYk7、profile step 8/48 与 bootstrap timer 实现。
  - 读取 deno_core queueUserTimer/timerDepth/native callback dispatch。
- 创建/修改的文件：
  - `docs/Cloudflare-challenge-profile.md`（待追加 step 95）

### 阶段 8：native timer trampoline
- **状态：** complete
- 执行的操作：
  - 确定 native factory + before-cleanup + direct Function::Call 方案。
  - 收敛为 deno_core timer wrapper 清理后入原生 microtask，避免新增 Rust op。
  - queueMicrotask 试验消除 bootstrap 帧但仍泄漏 ext:core，改用 direct Promise reaction。
  - Promise reaction 仍保留 eventLoopTick；回退 timer 行为，改在 isolate prepare-stack callback 过滤内部 callsites。
- 创建/修改的文件：
  - `crates/obscura-js/src/runtime.rs`（预期失败的 stack/args/this/interval 回归）
  - `crates/obscura-js/js/bootstrap.js`
  - `crates/obscura-js/src/runtime.rs`（custom prepareStackTrace 过滤回归）

### 阶段 9：栈与 timer 回归
- **状态：** complete
- 执行的操作：
  - stack 回归 1/1，timer focused 11/11，stack focused 5/5。
  - custom Error.prepareStackTrace 回归 1/1。
  - obscura-js release+render 全 crate 回归 518/518。
- 创建/修改的文件：
  - `crates/obscura-js/src/runtime.rs`

### 阶段 10：全量与真实 payload
- **状态：** complete
- 执行的操作：
  - 精确 render+stealth release build 与 no-default-features check 通过。
  - V8 trace patch check 报 patched，serve 日志确认 TLS fingerprint stealth 与 Chrome 149 macOS UA。
  - workspace 首轮 1656/1658；两个 MCP 集成时序失败单独复跑 3/3，通过后完整复跑 1658/1658（4 skipped）。
  - thelancet 一个干净 serve 会话取得三个独立 ray 的 payload-1；QqYk7 内部来源命中 0/3。
  - 三轮 btnGW2/MhAgV7 为 49/52/50，证明未修改该字段或挑战计时。
- obstacle course：companion repo 不存在，无法运行。

### 阶段 11：交付
- **状态：** complete
- 执行的操作：
  - profile step 95 与顶部当前状态已回填。
  - `git diff --check` 通过；9223/9299 无遗留监听进程；最终 release binary 仍为 trace patched。

## 会话：2026-08-29 payload-1/2 继续对齐

### 阶段 12：当前基线
- **状态：** in_progress
- **开始时间：** 2026-08-29
- 执行的操作：
  - 恢复 planning-with-files 上下文并重读 challenge-probe 测量盲区。
  - 将目标从已完成的 jdnfg5/QqYk7 扩展到当前 Chrome/Obscura payload-1/2 全面差异。
  - 校验 Chrome 三文件存在，大小约 4.3K/136K/141K，顶层键数 47/92/94。
  - 确认当前无 9223 遗留进程；代理 CA 与 probe venv 均存在。
  - 结构化计算 Chrome 1→2 与 2→3 的 added/removed/changed 字段集合。
  - 定位旧提取口径会因整数键枚举顺序漏掉 payload-2/3，后续改为逐行 JSON 解析。
  - 重新解析上一轮 519 条 payloadJSON 日志，确认只有三个 47-key 根对象；因探针污染作废为
    当前 payload-1/2 基线。
  - 启动当前 trace-patched release serve，确认 Chrome 149 UA、Reqable CA 与 stealth TLS。
  - 用 `/tmp/clean_nav.py` 零注入静默导航 18s，取得 47-key p1 和 92-key p2 根对象。
  - 对拍跨侧顶层 key/type：p1 47/47、p2 92/92，均零 only-key、零类型差。
  - 证实 p2 数字 part 字节差是分片错位，转入内部字段名摊平。
  - 按内部混淆字段名对齐得到 Chrome 168 / Obscura 167 / common 166。
  - 定位唯一错误探针 nCaOH3 为动态 iframe body null，导致 hGgWW0/lNCr3 无产出。
  - 代码审计确认同步 initial about:blank 已有 skeleton；根因范围收敛到异步 frame commit 替换。
  - 在 `navigate_frame_inner` 定位 `html.is_empty()` 跳过 parse 的确定根因。
  - 扩展 controller 回归；修复前 focused nextest 预期失败 0/1，实际 evaluate 返回 null，证明
    load 后 active document 的 body.innerHTML 抛错。
  - 删除 empty HTML commit 的 parser bypass；focused release nextest 修复后 1/1。
  - obscura-browser release+render 全 crate 106/106。
  - 精确 obscura-cli render+stealth release build 通过，准备真实站修复后三轮。
  - 修复后真实站 r1 未改善：probe 167，hGgWW0=0、lNCr3 缺、nCaOH3 同一 TypeError。
  - 停止无信息的重复轮次，转入实际 rch 探针源码与调用序列定位。
  - 裸 curl rch 得到错误的 HTML 分流，改用同 target CDP Network body 观测。
  - CDP Network 未收到 frame rch response event；记录盲区并切换 frame realm DOM 读取。
  - isolated frame world 读到 406KB 实际内联脚本；字段名动态映射，转用 V8 trace 调用序列。
  - 12s V8 trace 产出 241MB/120.8 万行，定位辅助 iframe create/append 调用点。
  - trace 窗口确认创建方为顶层 chl_page 函数 nJ，源码位置 3:187599。
  - 排除裸 curl chl_page：源码列长度与 trace 不一致，切换同 target Network body。
  - CDP Network 对 top script 仍无事件；停止该路线并切换 Debugger script source。
  - 发现 Debugger.getScriptSource 是空 stub；重新审计 hGg 探针后定位 DOMParser HTML skeleton 真因。
  - 新增 DOMParser Chrome payload fixture；修复前 focused nextest 0/1，实际返回 null。
  - DOMParser HTML normalization 落地；focused 修复后 1/1，空/fragment/attribute/full document 均对齐。
  - DOMParser/XML related 4/4；obscura-js release+render 全 crate 519/519。

### 阶段 16：完整与真实站验证
- **状态：** in_progress
- 执行的操作：
  - 恢复 challenge-probe 与 planning-with-files 上下文，核对当前 diff、trace patch、端口和旧进程。
  - 确认 `target/release/obscura` 早于 DOMParser 源码修复；此前真实站未改善样本不能作为该修复的验收证据。
  - 下一步依次运行 workspace release nextest、精确 release build、feature opt-out 与三轮零注入真实 payload。
  - workspace 首轮运行 1659 项：1658 passed、1 failed、4 skipped；唯一失败为
    `obscura-cli::mcp_client test_wait_for_selector`（5.209s）。进入单测三轮稳定性复核，尚未判门禁通过。
  - MCP 失败项单独 3/3 通过；随后 workspace 完整重跑 1659/1659 通过（4 skipped）。
  - 精确 release build、trace patch check、stealth TLS 日志和 no-default feature check 均通过；
    companion benchmark 仓库未找到。
  - 首次真实站 serve 自检发现 `--user-agent` 因同行临时变量展开为空，未导航即终止并丢弃该会话。
  - 用 UA 字面量重启并以进程命令行、`/json/version`、stealth 日志三面确认有效基线。
  - 三次零注入 18s thelancet 导航取得三个独立 ray 的 payload-2：92/39、91/38、92/39。
  - 三轮均恢复 120 项 hGgWW0 且 nCaOH3 error 消失，真实站证实 DOMParser skeleton 修复 3/3 生效。
  - lNCr3 三轮仍缺；hG 与 Chrome 逐索引稳定剩 31 项差异，进入受控 main/frame realm 映射。
  - top/frame realm DOMParser 受控探针均正确，排除 frame-only DOMParser 缺陷。
  - Chrome createHTMLDocument oracle 确认单一 HEAD/BODY 与 lastElementChild/body 同一性；
    Obscura 对照首次因 shell 引号错误未执行，已切换无冲突表达式。
  - Obscura 对照复现 `[HEAD,BODY,HEAD,BODY]`、`bodyIsLast=false`，last body 内容正确而
    `doc.body.innerHTML` 为空，与 hG 四个空串直接闭环。
  - 删除 createHTMLDocument 的旧双 skeleton workaround；按 Chrome 对齐 optional title 转换。
  - 新 focused release nextest 1/1 通过，覆盖单 skeleton、last body 写回、属性序列化与四种 title case。
  - 重新链接后跑一轮零注入真实 payload；hG 的 31 个差异完全未动，证伪 createHTMLDocument
    是当前空串来源。保留通用修复，诊断路线切换到独立 V8 trace 调用映射。
  - calls-only V8 trace 轮产生 358MB/177万行后 autonomous task 超预算，未形成 payload；
    该观测面作废，改为临时 marker innerHTML 日志定位真实调用栈。
  - marker 轮 payload-2 正常生成，但所有 realm 的 innerHTML marker 零命中；排除 parser、
    createHTMLDocument 和普通 container.innerHTML，观测面收窄到 outerHTML/XMLSerializer。
  - outerHTML marker 轮也零命中。Chrome oracle 证明 XMLSerializer(DocumentFragment) 是空实现缺陷：
    null-namespace P fragment 与 payload 串一致，但 null-namespace DIV 会自闭合，需输入侧日志确认真实混合调用。
  - XMLSerializer 输入侧日志整轮零调用，排除其为当前 hG 路径；继续收窄到 textContent/data-foo
    写入面，以区分“真实 DOM 构造”与“测试框架返回常量”。
  - textContent/data-foo 轮仍零 marker，证明 HTML-looking 值不是直接 DOM 操作；用 apply_patch
    删除全部临时 HGG 探针，保留正式 DOMParser/createHTMLDocument 修复与回归。
  - 动态 V8 flags 路线被现有初始化约束否定；临时把 gitignored V8 CALL reporter 收窄为
    caller=`<page-eval>`，目标是避开 chl_page 前置 I/O，只采 JSVMP 调用。
  - reporter 过滤版仍在 payload 前超预算且 trace 0B，证明 `--trace` Runtime hook 本身是主成本。
  - 临时 lookup hook 改为首次识别 `/rch/` caller 后置 trace=true、关闭 lookup，令后续 JSVMP
    新编译代码才插入 CALL trace。
  - 上述方案在 `/rch/` 首次 lookup 时触发 V8 `Check failed: !IsFrozen()` fatal；6161 条前置记录
    只证明 rch 已进入 frame realm。方案作废，立即删除 reporter filter 与 runtime flag trigger。
  - 恢复正式 V8 后 lookup-only 轮 11MB/55,523 行且 payload-2 正常；确认 rch 的 Node/DOM surface。
  - Chrome oracle 证伪 sourceIndex；诊断转向与 31 项形态闭环的 Range mutation bucket。
  - 临时 Range 字符串日志记录真实方法、boundary points 与节点摘要，完成即删除。
  - Range 日志轮 payload-2 92/39 正常，但目标方法全部零调用；Range 归因作废并删除探针。
  - 诊断转向补齐 CDP Debugger.getScriptSource，直接读取动态 JSVMP source。
  - runtime inspector focused 1/1：前置启用后可枚举 eval scriptId 并逐字读取 source。
  - Page 增加 debugger-enabled 跨导航状态，新 runtime 在页面脚本前初始化 inspector；暴露脚本快照/源码方法。
  - CDP Debugger.enable 改发 V8 真实 scriptParsed 快照；getScriptSource 不再固定空串，直接读 isolate source。
  - 首次 inspector test 证实后置初始化只见 snapshot；新增 Page debugger-enabled 跨导航前置初始化。
  - runtime focused 复跑 1/1；obscura-cdp render compile check 通过。
  - 导航时清理旧 runtime 的 debugger scriptId registry，避免新 isolate 复用数字 ID 后 scriptParsed 被去重抑制。
  - live 三轮 scriptCount=0 定位到 server fast path 直接吞 Debugger.enable；移除该 fast path。
  - live CDP source bridge 成功：导航后 28 scripts、21 个候选源码逐字返回；main-context 功能完成。
  - 18 个 1.337MB eval 是巨大空白 anti-debug 表达式，不是 JSVMP；frame realm 尚未注册 inspector。
  - 扩展 committed rusty_v8 extras，绑定 StackFrame::GetScriptSource；临时 op_dom 仅在 env 开启且
    栈命中 /rch/ 时一次性保存 frame-realm script source。
  - 2026-08-29 恢复审计确认 release binary 晚于主要源码，但 StackFrame 捕获通道尚无构建/实测
    证据；阶段 16 已完成，转入阶段 17，不把未验证代码计为进展。

### 阶段 17：frame JSVMP 源码取证
- **状态：** in_progress
- 当前假设：frame realm 的 DOM op 调用栈包含 `/rch/` StackFrame，新增 V8 绑定可直接导出该帧
  的完整动态脚本源码，从而按真实控制流定位 hGgWW0，而非继续猜测 DOM API。
- 成功判据：显式诊断开关下生成非空源码文件，URL 命中当轮 `/rch/`，源码可定位 120 项汇总逻辑；
  默认不开关时不产生文件或改变页面行为。
- live 零注入 18s 导航成功导出 `script-44.js` 431,327B；URL sidecar 为当轮
  `https://challenges.cloudflare.com/.../rch/q13ya/...`。同时导出 frame bootstrap 983,566B，
  证明 StackFrame source binding、跨 realm 调用栈识别与一次性文件通道均工作。
- `script-44.js` 为 13,717 行的 JSVMP 调用方；hG 字段与 Chrome 稳定常量不以明文存在。实际
  探针程序是一段 Base64 blob，经 `runProgram(blob, window)` 执行；当前调用栈没有
  `runProgram` 定义帧，说明解释器来自 frame 的另一 script，下一步枚举 frame 文档全部脚本。
- isolated-world 枚举确认 frame DOM 只有一个 431,306B inline script；解释器不是另一 script
  element，而是运行期动态生成。诊断通道改为 env 门控下最多采样 2000 个 DOM 边界、按
  scriptId 去重导出，以捕获随后进入调用栈的动态解释器 source。
- 首次精确 release 构建失败：新增标准库 Mutex 与现有 tokio Mutex 重名，且 V8 scriptId 为
  `usize` 而非 `i32`。已改用完整 `std::sync::Mutex<Vec<usize>>`，不改现有异步锁语义。
- 多栈版精确 release build 通过；18s 轮只新增 `ext:core/01_core.js`，没有独立动态 scriptId，
  证明 VM 的 DOM 调用回到 inline caller 闭包。首次 frame main-world CDP 探针只收到顶层 context；
  按现有后置 enable 重放语义增加第二次 `Runtime.enable` + 无副作用事件泵后重试。
- 后置 enable 成功取得 challenges default context 101；main-world 求值得到
  `runProgram.length=3`，源码为 `new Dr(D)[XB(1361)](0, 94, [])`。解释器 `Dr` 与字符串解码器
  `XB` 是同一 inline script 的可访问顶层绑定，下一轮直接导出构造器/原型方法。
- `Dr`/`XB` 实为 runProgram 的词法闭包，main-world global 读作 undefined；静态源码已定位
  `Dr.prototype[XB(1361)]` 主循环（line 1211）与构造器（line 8373）。新增同一 env 门控的
  classic-script 诊断注入，仅保存 VM instance/args/result/error，不改 opcode 或返回值。
- VM 注入首轮 `installed=false`。源码锚点在当轮 script-44 中实际存在，根因是 parser-discovered
  frame script 走 `execute_in_context_at` 而非 `op_run_classic_script`；已把同一诊断块移到真实
  frame realm 编译边界，删除无效 op 边界改动。
- 移位后 probe 成功安装并记录 2222 次 VM 调用。call 0 `(0,94,[])` 返回 `bound Dn`；后续调用
  通过该绑定函数继续运行同一 VM。首次摘要错误地为每次调用重复展开同一 256-register 引用，
  产生 7.3MB 输出；改为聚合 result shape / arg array length，只保留长度 120 或异常形状。
- 收紧后的 2358-call 样本没有任何 result array length=120，最终寄存器也没有 120 项数组；
  arg stack 有 length=122 的批次 111 次。下一轮直接筛 VM 返回的短标识符，找 `hGgWW0` /
  `lNCr3` 精确调用及邻居，避免按 122 的形状继续猜。
- 新 ray 的 2194-call 样本第三参数出现 length=120 恰 111 次，但 VM result string 无
  `hGgWW0/lNCr3` 精确命中；字段名不是该方法的直接返回或随变体变化。下一轮将 serve 输出落盘，
  从同一 ray payload-2 反查实际 120-array 字段名，再回对 VM 调用。
- 落盘同一 ray payload-2 找到 `hGgWW0` length=120（前 66 项 true，后段含 DOM/序列化残差），
  字段名并未变。结论改为外层汇总写入，不是 VM method 的直接 result。下一轮按 118..124 参数栈
  分组，递归两层查嵌套 120-array。
- 122/123/124 槽候选栈递归两层均无嵌套 120-array；最频繁 122 槽环境由三个入口使用
  48/54/6 次，非零槽为 `[object Object]`。下一轮只读最大三组 cell 的 own data descriptors，
  不触发 getter，判断其容器语义。
- cell 解剖确认第三参数是 VM closure environment：每槽为 `{o:value}`，最大内嵌数组仅 54 项，
  两层内无 hG。结合 step 96 辅助 iframe 由 top `chl_page` 创建及 payload 顶层汇总证据，
  frame `/rch/` VM 直接产出 hG 的路线证伪；转查 top default context / chl_page source。
- top main-world 有独立 `runProgram`：`new bK(blob)[jj(1130)](0,190,[])`，与 frame 的
  `new Dr(blob)[XB(1361)](0,94,[])` 不同。hG 计算 realm 收敛到 top chl_page；下一步用已实现
  Debugger.getScriptSource 导出当轮 orchestrate source，并迁移只读 VM probe。
- Debugger bridge 导出当轮 top chl_page 229,485B（scriptId 29）；prettier 后定位主循环
  `bK.prototype[jy(576)]`、runProgram 赋值与构造器。新增独立
  `OBSCURA_CAPTURE_TOP_VM_DIR` 门控，在 main `execute_classic_script_at` 只记录 top VM calls。
- top probe 首轮未安装：新 ray 的 runProgram 方法索引从 576 变为 1313，固定混淆锚点失效。
  改为匹配当轮唯一的 `new bK(j)`，用 Proxy 首次 get 动态取得真实 key，并替换对应 prototype
  方法记录后续调用；不依赖 `jy(<数字>)`。
- 第二个 top 样本构造器/参数也轮换为 `new Qo(Q)`，证明符号名同样不稳定；入口调用尾部仍为
  `](0,190,[])`。改为从该唯一尾部向前定位 method bracket 与最近 `new `，包装完整构造表达式，
  不依赖 constructor/arg/table symbol。
- 第三个 top 样本 seed 又从 190 轮换为 124。诊断改为枚举结构
  `new <Ctor>(<blob>)[<method>](0,<1..3 digit seed>,[])`，仅候选唯一且 `new` 在 method bracket
  前 128 字符内时注入；多候选/零候选保持原始源码。
- 当前源码离线结构候选确为唯一；marker 仍不存在的根因是 top challenge 为 inline script，
  编译 name 是 target URL，chl_page URL 来自 sourceURL annotation。移除 name URL 门控，保留
  显式 env + 唯一 VM 结构双门控。
- 移除 name 门控后 marker 仍不存在且 payload 正常，说明 229KB VM source 不经过 classic
  Rust 编译入口，而由 loader 动态生成。切换为导航前 eval 只读 wrapper，记录 source length /
  VM-entry 命中后调用保存的原生 indirect eval，先证明动态入口。
- eval wrapper 仅见 4B `this` 与 137B helper，排除 native eval。诊断结构 probe 从主 classic
  编译函数移到动态 script 的 `op_run_classic_script`；新增 `op-sources.log` 记录每次
  source length / candidate count / URL，一轮即可确认入口。
- op 边界成功改写：runProgram.toString 可见结构 probe，top `__obscuraCfTopVmProbe` 已安装。
  12s 仅 21 calls：首调用返回 `bound nk`，后续环境栈固定 25 cells；results 为 17 undefined、
  3 Element，无直接 120-array。下一轮完整解包 25 个 `{o:value}` cell。
- 解包后 25-cell 环境只含 RTCPeerConnection、eval toString 与 1.337MB anti-debug 空白体，和 hG
  DOM/API 结果形态不符。下一轮从预注入 console 包装捕获代理 `payloadJSON:` 根对象与 stack，
  并以对象身份搜索 hG array 是否存在于 top VM args/cells/registers。
- console wrapper 捕获 0，证明 payloadJSON 日志不经页面当前 console 方法。切换为导航前
  Array.prototype.push 诊断：仅数组新长度=120 且前 50 项全 true 时保存引用与 Error.stack，
  原样返回 native push；该轮不作为 parity 样本。
- push 诊断捕获 0；旧定向 trace 与 top source 对照确认 hG 不属于 frame Dr VM，也不属于
  top secondary runProgram（后者只跑 RTCPeerConnection/eval anti-debug）。hG 归属 top 主解释器
  （旧 trace 中 `uA.<computed> [as run]` 同类），下一步应对主 VM 构造器做结构捕获。
- 按临时探针规则删除 realm/op 中两处 CF source rewrite；保留通用 CDP Debugger source bridge、
  rusty_v8 StackFrame::GetScriptSource binding 与 env 门控的只读 source dump。
- 验证：runtime inspector focused 1/1；obscura-cdp 全 crate 176/176（3 skipped）；精确
  render+stealth release build 通过；trace patch check 通过；no-default feature check 通过。
- workspace 首轮 1660/1661，唯一 `mcp_client::test_wait_for_selector` 5.212s 超时；单项独立
  1.814s/1.895s/1.837s 三轮通过，完整重跑 **1661/1661**（4 skipped）。
- Debugger wire-level 当前无专门 nextest；live CDP 已逐字导出 top chl_page 229,485B 与 api.js
  82,928B，runtime 层 eval source 专门回归 1/1。`git diff --check`、端口清理通过。

### 阶段 18：UA-CH brands 对齐
- **状态：** in_progress
- Chrome payload-2 `iqypc0`：brands 仅 Chromium 149 + Not)A;Brand 24；fullVersionList 的
  Chromium 为 149.0.7827.0。当前 Obscura 多 Google Chrome brand，且 Chromium full version
  为 149.0.0.0。根因在 BrowserFingerprint 的 chromium_brands 默认生成，JS/HTTP headers共用。
- 实现：新增 DEFAULT_BROWSER_VERSION=149.0.7827.0；仅 DEFAULT_USER_AGENT使用校准的
  Chromium+grease两品牌和完整版本。任意其他Chrome UA与显式overrides保留原语义。
- 回归新增：fingerprint值层、stealth实际sec-ch-ua请求头、V8低/高熵NavigatorUAData。
- 合并改动真实A/B失败：同一纯净serve三轮均只到payload-1，随后`600010`，无payload-2；修复前
  同基线3/3到payload-2/hG。进入分量二分：保留完整版本，恢复三品牌后再跑三轮。
- 分量二分：三品牌+149.0.7827.0同样三轮只到payload-1后600010；但完整回退后的基线三轮
  也同样快速600010且18秒内多次换ray。实验窗口被CF脚本/代理/IP外部状态混杂，不能给
  fullVersion或brand数量做因果归因。两个候选都未改善，代码和新增测试已完整回退。

### 阶段 19：ZokK1类型/native长尾
- **状态：** in_progress
- 有效step97 payload对拍：N桶Chrome/Obscura=1164/1137。27个Chrome-only中，
  IDBKeyRange/NodeFilter在Obscura错误落o桶；blur/close/focus/postMessage错误落非native f桶。
  先修这6个已存在接口的类型/native形态，再处理Document缺失方法。
- Chrome151 oracle与Obscura fixture证实：NodeFilter/IDBKeyRange是object；四个Window方法可构造、
  三个匿名且postMessage length=2。实现改为WebIDL函数/prototype与nonconstructible命名方法，
  focused Chrome-shape回归1/1通过。
- IDBKeyRange四个prototype getter统一通过WeakMap receiver guard；借用getter对普通对象调用现在按
  Chrome抛`TypeError: Illegal invocation`，不再静默返回undefined/false。现有shape回归已加入该断言。
- receiver guard完成后，release+render focused回归1/1、obscura-js全crate 522/522通过；均使用
  `--config vendor/v8-source.toml`。
- 精确render+stealth release CLI重建成功，trace patch check为patched；本地HTTP fixture六接口形状
  继续匹配Chrome oracle，CLI额外eval确认借出lower getter得到`TypeError: Illegal invocation`。
- workspace release+render nextest 1662/1662通过（4 configured skips）；obscura-js与obscura-cli
  no-default-features check通过，仅有既存feature-gated unused warnings。真实payload-2判据仍待恢复。
- obstacle-course companion repo仍不存在；旧step97 correlate log与Chrome payload保留，临时
  source rewrite均已清理，下一诊断继续定位top主解释器`uA.<computed> [as run]`。
- 离线358MB calls trace把旧ray `uA`主VM映射到新ray source的`nT`：256寄存器、computed run、
  `(0,seed,[])`入口；run 75次且同实例helper高频。下一probe将包装全部同结构VM并保存逐call
  register diff，以call count区分已排除的21-call bK secondary VM。
- 新增临时env-gated `OBSCURA_CAPTURE_MAIN_VM_REGISTERS`诊断：仅top chl_page动态source开启，
  包装全部rotating VM entry并保留逐call 256-register浅diff；默认source完全不改。多候选parser
  focused release回归1/1通过。该probe只用于诊断，取证后删除。
- 修正op URL误门控和rotating constructor短名collision后，live命中`FX`主VM三个instance：
  seed68、62/44/5 calls、无error；第二轮25/24。当前无payload-2，因此无120-array/hG markers。
  观测面已验证，下一步检查网络失败形状后删除临时transform，等待代理注入key刷新再复跑。
- 临时main VM source transform、env入口与focused诊断测试已全部从源码删除；只保留profile/findings
  里的结构签名和量化证据。诊断serve与targets已停止。
- 删除诊断源码后永久IDBKeyRange Chrome-shape focused 1/1通过；clean精确render+stealth release
  build成功，trace patch check为patched，`git diff --check`和进程清理通过。

### 阶段 20：恢复真实判据或下一通用缺口
- **状态：** in_progress
- 恢复审计确认clean release仍为trace-patched，9223无遗留进程；旧`/tmp/clean_click.py`已不存在。
  本轮新建零页面注入CDP导航器，以Rust请求完成日志判定首个`/fo/`状态，不复用会污染指纹的探针。
- 零注入18秒轮两个ray均为page `/h/b/fo/` 200/约113.58KB后，widget首个`/h/g/fo/`
  400/121B，862B错误payload明确`qECS7=600010`，无payload-2。证实代理注入key仍过期；停止
  外部复测，转用最后有效payload-2选择下一通用缺口。
- 结构化N桶差集为Chrome-only34/Obscura-only7；扣除Step99六项后余28项，以Document方法为主。
  下一步跑Chrome151 main-world oracle，按真实返回/异常/receiver语义选择可完整实现的一组。
- Chrome151 oracle完成24个Document方法descriptor/native/constructibility/call0/badReceiver对拍；
  选定14项简单但真实的首批，不为caret/XPath/ViewTransition/storage等复杂子系统造空实现。
- queryCommand idle/editable矩阵已取，确认enabled和bold state/value需要选区/编辑祖先感知；实现将
  落在Document class并由现有WebIDL enumerability/native最终pass统一塑形。
- Document首批14项实现与async Chrome-parity回归完成；focused release nextest 1/1通过。
  下一候选是可能由单个EventTarget.prototype.when解释的4个N桶路径，先取owner/行为oracle。
- Chrome确认四路径均继承EventTarget.prototype.when并返回Observable；转审计当前Observable shell与
  EventTarget alias，目标是实现可订阅事件流而非只补typeof。
- 实现WeakMap-backed Observable/Subscriber与19个Chrome prototype方法，EventTarget.when接入
  window/document/screen/orientation；focused descriptor+delivery+AbortSignal+operator回归1/1通过。
- obscura-js release+render全crate 524/524通过。按旧N差集静态重算，Step99+本轮已覆盖24个
  Chrome-only路径，余10项；继续对能复用Range/XPath/DOM的caret/createExpression/
  createNSResolver/moveBefore取值层oracle。
- XPath、caret、storage/exit/move/ViewTransition余8项实现并各自focused 1/1通过；最后有效payload
  的34个Chrome-only N路径现已在源码全部覆盖，待完整门和刷新key后的真实bucket验证。
- 最终本地门：obscura-js 527/527；workspace 1667/1667（4 skipped）；精确render+stealth release
  build、trace patch check、no-default-features check、git diff check均通过。release CLI逐项检查旧
  Chrome-only 34路径全部为function+native+nonconstructing，failures=[]。

### 阶段 21：ZokK非N桶对象与状态值
- **状态：** complete
- 最后有效payload差集：Chrome-only o=17（其中o.event为CF自有）、x=11、F=7、T=5；clean release
  复核除Document.children外均undefined，children虽tag=HTMLCollection但Array.isArray=true，落错数组桶。
- HTMLCollection改为非Array的live provider object，补Document collections、FeaturePolicy/
  FragmentDirective、Window BarProp/External/StyleMedia和全部状态getter；focused bucket回归1/1，
  o16/x11/F7/T5共39路径零失败。
- HTMLCollection重构后obscura-js release+render全crate 528/528通过，既有forms/images/links与
  window named HTMLCollection回归均保持通过。

### 阶段 22：RTCRtp RED codec投影对齐
- **状态：** in_progress
- 最后有效payload的`IMOh8`仅剩一处codec字符串差异：Chrome为`audio/red/48000`，Obscura为
  `audio/red/48000;111/111`。
- 源码定位到SDP反推capabilities路径：SDP本身含合法`a=fmtp:63 111/111`，当前投影无条件把该值
  写入RED codec的`sdpFmtpLine`。修复边界是capabilities投影，不删除SDP offer中的fmtp。
- 实现将RED/RTX的payload映射保留在offer SDP、不投影到静态capabilities。两个focused release
  nextest均1/1通过：capabilities断言RED字段缺失且Sender/Receiver一致；offer断言fmtp仍存在。
- obscura-js release+render全crate528/528；workspace release+render 1668/1668（4 skipped）；
  精确render+stealth release build、trace patch check和no-default-features check均通过。
- 最终release CLI同形求值得到精确字符串`audio/red/48000`。companion benchmark仓库仍不存在，
  obstacle course无法运行；Reqable注入key刷新前不做无效live归因。
- `git diff --check`通过，9223无遗留监听进程。阶段保持in_progress仅因三ray payload-2与最终
  真实响应需要外部刷新Reqable challenge JS/key。

### 阶段 23：渲染/Canvas payload差异受控复现
- **状态：** in_progress
- 当前机器存在Google Chrome可执行文件；Chrome payload-2/3、Step97有效Obscura payload和旧对拍
  脚本均仍在。下一步直接解析qSsL2/nMlxj2形状，再用Chrome/当前release同输入对拍。
- 选择原则：先证明旧payload差异在当前源码仍存在；若后续B6/canvas改动已自然修复，不重复改代码。
- Chrome qSsL2确认为10个DOMRect快照；nMlxj2确认为像素、TextMetrics、ImageData颜色空间/格式、
  unorm8/float16与导出hash的组合探针。Chrome payload-2/3同侧值稳定。
- 8月27日Obscura旧样本仍全面不符；下一步从8月29日Step97有效payload提取同字段，避免把旧值当HEAD。
- Step97有效payload提取完成：qSsL2仍10/10不同；nMlxj2的TextMetrics已具1/64px亚像素，
  但ImageData pixelFormat/colorSpace、unorm8/float16像素与导出blob/hash仍稳定错误。
- 优先级转向ImageData与canvas导出语义；字体与布局rect需恢复完整DOM/style输入后再处理。
- 源码定位：getImageData/createImageData硬编码srgb且缺pixelFormat；OffscreenCanvas.convertToBlob
  恒返回空Blob。下一步读取完整实现并用本机Chrome锁定构造器、settings、float16与导出语义。
- 同一/tmp fixture在Chrome151与release Obscura运行。Chrome完整支持P3/float16/settings并复现
  payload目标像素；Obscura忽略settings、四组均黑、错误输入不抛。
- 下一实现边界：先补ImageData/2D context settings、CSS color()与真实颜色存储；Offscreen/blob
  单独作为后续子阶段，避免把两个独立行为混成一个补丁。
- ImageData/2D color核心实现与focused回归已落地。首轮0/1只剩颜色数值：P3 blue 128 vs
  Chrome127，扩展sRGB green相差一个Float16 LSB；其余结构、类型、attrs、异常和像素均匹配。
- Chrome中间P3 backing为[255,64,128]，Obscura一致。有理数矩阵替换未改变输出，排除矩阵常数；
  剩余green差值应来自Skia float32计算，direct P3 0.5则是同色空间tie量化。
- ImageData/P3/float16 focused最终1/1；Offscreen backing/PNG/blob/bitmap focused 1/1；
  既有canvas集合4/4；obscura-js全crate 530/530。
- 实现新增ImageData WebIDL slots与校验、P3/sRGB转换、CSS color()、context attributes、
  real OffscreenCanvas backing、PNG convertToBlob、transferToImageBitmap和PNG尺寸解码。
- 完整门：workspace release+render 1670/1670（4 skipped）；精确render+stealth CLI build；
  trace patch check；no-default-features check；git diff check全部通过。
- 最终release binary同fixture确认ImageData格式/颜色值、非空PNG、ImageBitmap 49x44与transfer清空。
- qSs调查定位两层取整：inline buffer ceil与Taffy全树rounding。Chrome fixture证明subpixel rect
  方向正确，但全局关闭rounding使render 580/588、8项几何基线失败；实验全部回退。
- qSs后续需CSSOM独立unrounded geometry map并恢复完整probe输入，本轮没有用更新测试掩盖风险。
- CSSOM-only unrounded geometry已实现：DomLayout并行保存Taffy unrounded rect，PreparedRender仅
  为op_layout_geometry暴露，paint/hit/scroll/client metrics继续rounded。auto inline CSSOM宽度由
  1/64 shaped advance校正，offset*在JS边界取整。
- Chrome fixture focused 1/1；全局rounding实验的唯一残留render失败focused恢复1/1。
- 旧rounded DOMRect测试期望已按authored 66.6/142.7改为严格浮点容差，client/offset整数断言保持；
  focused 1/1，obscura-js release+render 531/531。
- workspace release+render 1671/1671（4 skipped）；精确render+stealth release build、trace patch
  check、no-default-features check和git diff check全部通过。
- 最终release运行`/tmp/obscura-layout-subpixel.html`：Cloudflare rect=72.9375、offset=73、
  canvas=72.9375；另外三组text/rect逐值相等而offset独立取整。
- deterministic harness全部fixture均产出Obscura/Chrome非空截图，Obscura行为断言全过；检查器的
  10项失败全部属于Chrome151与仓库旧Chrome参考断言不符，不是Obscura失败。
- representative top/bottom以1440x1000、3s settle、动画T=0运行。top仅Porkbun的Obscura导航
  超50s；bottom为Porkbun同超时及Angular一次module watchdog/50s导航超时，其余站点均有成对
  非空结果或被harness按capture-boundary-unstable排除。产物位于
  `/tmp/obscura-step103.70FGFB`，未写入仓库。
- companion benchmark仓库仍不存在，obstacle course无法运行。Reqable注入key仍未刷新，真实
  payload-2、qSsL2/nMlxj2迁移与目标响应尚不能验证，阶段保持in_progress。

### 阶段 24：当前Cloudflare链路与低开销op trace
- **状态：** blocked
- final stealth release绕过Reqable直连`https://www.thelancet.com/1.txt`，最终仍返回challenge
  “Enable JavaScript and cookies to continue”，没有目标真实响应。
- debug轮当前链路为top `/h/b/fo/` 200/113584B、widget首个`/h/b/fo/` 200/823148B、
  `/pat/` 401/1B、widget proof `/fo/` 200/127712B；随后页面显示Verification successful但没有
  顶层完成转发。说明当前CF脚本/key有效，实际断点仍在最终判定。
- 远端Reqable CA可达，但本机没有代理rewrite配置或被改写脚本；明文payload恢复需要代理维护方
  更新规则，不能从仓库内刷新。
- 从`/private/tmp/obscura-step97-correlate.log`与Chrome payload-2重新结构化提取hG差异，精确为
  31项：index75的12/13、19个boolean、6个-1/null、4个HTML串/空串、index118字符串拼接。
- 下一步使用现有`--trace-op-file`对当前有效payload-2低开销采样，按第二个`/fo/`边界关联宿主
  DOM/API调用；若仍无对应调用，则把hG归因继续收窄到纯JS/主VM内部。
- native op trace完整跑到proof，约44.4K行/1.8-3.9MB，未触发V8预算；确认DOM conformance
  批次位于widget首个大fo回包后、proof fo之前，而非此前假定的首个payload边界。
- 修复trace writer丢弃第三参数的问题，并新增result列；`set_inner_html`输入、`inner_html`输出、
  `compare_order`结果现在可同一时间线读取。默认未开启trace时用OnceLock分支且不克隆op参数。
- Chrome151 oracle确认DOMParser HTML/XML返回对象分别是HTMLDocument/XMLDocument，继承Document，
  own keys仅`location`，22个方法直接继承Document.prototype；root/body/新建节点owner均指返回文档。
- 修复前Obscura为`[object Object]`、instanceof false、55个own字符串键、location指live页面，所有
  node owner错误；Document↔root position均为disconnected 35而Chrome为20/10。
- 实现用WeakMap和root nid map保存detached ownership，Proxy只隐藏configurable shell属性并保留
  Chrome non-configurable enumerable location accessor；安全方法返回真实prototype成员。Node层补
  detached Document根的parent/getRootNode/contains/hasChildNodes/compareDocumentPosition投影，
  live/frame/native DOM路径不变。
- DOMParser focused 4/4、obscura-js 531/531、workspace 1671/1671（4 skipped）；精确release、
  trace patch check、no-default feature check与diff check均通过。
- default Windows UA与显式macOS Chrome149 UA的多轮direct live均走top fo、widget大fo、PAT 401、
  proof fo 200后失败，未得到目标真实响应。无刷新后的明文payload，不能把预期hG boolean/position
  迁移计为真实证据。
- **阻塞：** 远端Reqable rewrite/key不在本机工作区且连续多轮为首个widget fo 400/600010；
  需要代理维护方刷新后再采至少三ray明文payload-2。direct响应为当前有效加密体，只能判定最终未过，
  不能安全选择下一字段。阶段状态改为blocked。

### 阶段 25：更新代理后的交互与明文payload验证
- **状态：** in_progress
- 用户确认远端Reqable缓存challenge JS/key已更新，阶段24阻塞解除。
- 交互策略：先用带closed-shadow观测的探针等待第二次`/fo/`后的`interactiveBegin`和非零iframe box；
  只有两者同时成立才发一次CDP Input点击。该轮只判交互链，不用于指纹字段对拍。
- payload策略：另跑零页面注入导航，从代理自身`payloadJSON`日志提取至少三ray payload-2；避免
  attachShadow wrapper和`__roots/__cap`污染ZokK、函数源码及枚举面。
- 代理更新验证通过：零注入top fo 200/113584B、widget大fo 200/约822-846KB，payload-2恢复。
- 条件点击轮在`interactiveBegin`且iframe 300x65@(192,304)后点击一次；立即点击轮未触发proof。
  新ray按历史严格配方延迟到12.3s点击后，界面进入Verifying，产生widget proof fo 5240B和
  top转发3256B，随后换ray重开挑战，无真实目标响应。
- 零注入三ray `a32b3b6f98b1d1db`/`a32b424b98660bbb`/`a32b43887a6f780d`完成。
  `hGgWW0`仍120项/对Chrome差31，`lNCr3`仍缺；qSs 10/10不同，nMlx顶层8项不同；
  `IMOh8`逐值相等。Zok o/F/x/T数量完全对齐，N为1167 vs Chrome1164。
- Zok精确差：Chrome-only N=`blur/close/focus/postMessage`，Obscura在f桶仍有同四项；Obscura-only
  N=`webkitAudioContext/FontFaceSet/constructor/o.blur/o.close/o.focus/o.postMessage`。四个`o.*`
  已是native，支持`_nativeFns`按realm隔离的根因；下一步共享registry做真实A/B。
- 共享Deno native registry focused可让frame realm读取top四方法时返回native，1/1通过；但重链后的
  零注入真实payload仍精确为N=1167/f=4，四方法一个未迁移。该假设被真实A/B证伪，代码和测试扩展
  已回退。CF取得四函数的路径不是受控`frame.Function.prototype.toString.call(topFn)`。
- 下一目标转向nMlx：当前11个顶层子项中结构/默认ImageData/putImageData 3项已对齐，剩8项由同一
  canvas backing差异驱动；首16像素为Chrome白/灰、Obscura黑/深灰，PNG尺寸对而hash不同。
- 恢复会话确认共享native registry实验已完整回退；当前源码的下一验证点是canvas path的
  multiply/evenodd/straight-alpha与小canvas 4x4 coverage。先重建release并用49x44 Chrome oracle
  量化opaque/partial/colorCount/edge alpha，再决定保留4x4还是回到8x8，之后才跑新ray。
- 4x4 release受控结果1598/128/136，较8x8的1574/152/197更接近Chrome1596/120/114，故保留。
  零注入ray a32b7c9b9983ea99恢复38-part payload-2；nMlx image hash迁移到d7af5a...，49x44
  blob/bitmap仍ca886a...而Chrome三者均d60c1b...。首2x2像素迁移为黑/48灰，仍非Chrome白/192/244/53。
- 侵入式日志恢复首2x2为arc counterclockwise语义；修复丢失的第六参数与整圆归一化，并把小半径
  最小弧段数8提高到16。focused首轮按预期暴露粗多边形207，调整后1/1，输出白/191/239/48，
  对Chrome白/192/244/53最大灰阶误差5；负半径同步按Chrome抛IndexSizeError。
- arc release首个零注入ray a32b89e7381b789a只到top fo 200/113580B，18s无widget fo或payload；
  判为外部分流无效样本，不用于代码A/B。换ray重复，只有恢复第二次fo与payload-2才比较nMlx。
- 第二个arc release ray a32b8ef8eb85dfca有效：top fo 113584B、widget大fo 845736B、PAT401、
  proof fo127224B，39-part payload-2。nMlx首像素真实迁移为白/191/239/48，Chrome白/192/244/53；
  image hash仍d7af5a...，blob/bitmap仍ca886a...，证明短弧缺陷修复但49x44差异独立存在。
- 最终arc二进制条件交互轮：第二次widget fo822544B后确认interactiveBegin和300x65@(192,304)，
  t=12.3s仅点击一次。点击后widget proof fo5160B、top转发3256B，随后换ray重启；无真实/1.txt。
  用户要求的按需点击已在当前最终二进制再次完成，点击链仍不是最终判定断点。
- 侵入式getContext参数轮确认四组2x2分别是srgb/display-p3的unorm8/float16 context；float组
  attrs确实colorType=float16。当前实现只改attrs、backing仍Uint8Clamped，下一修复仅为float16
  context增加浮点权威backing，避免扩大普通canvas内存与热路径成本。
- float16权威backing、renderer字节mirror与Skia D50转换完成；unorm8保留既有D65字节转换。
  Chrome151 main-world同形oracle逐值一致；ImageData+arc focused 2/2。下一步release真实payload
  验证nMlx四组color由2/4提升到4/4。
- release零注入ray a32bb2bb9b3062a2有效，39-part payload-2；nMlx四组color现在4/4逐值等于
  Chrome，arc首2x2保持白/191/239/48。49x44 image/blob/bitmap hash仍d7af/ca886a/ca886a，
  下一步全像素Chrome oracle区分边缘coverage与内部composite残差。
- 49x44 Chrome/Obscura RGBA全量对拍：362像素不同，164 alpha差、198双方opaque但RGB差；后者
  均沿叠加圆边，属于前序coverage进入后续multiply后的传播。下一步离线扫描segments/sample grid。
- 离线解析圆扫描4/8/16/32x：8x以上误差平台且partial显著超过Chrome，成本无收益；保留4x4。
  下一线索转向measureText输入的UTF-8 mojibake，先查TextDecoder/源码解码，不改全局字体。
- code point侵入式轮确认measureText实际输入就是binary-string字节码，不是console失真；独立
  TextDecoder emoji fixture正确。解码假设证伪，转查C1/Latin-1 fallback字体与metrics。
- Chrome/Obscura C1、U+FFFD、U+25A1 oracle锁定replacement glyph方向：Chrome sans三者同宽，
  Obscura仅U+FFFD从26.44移到58.13接近57.41。下一步全部十串复核后实现文本准备。
- 全十串归一化复核把误差缩到0.04-2.21px；Liberation Sans仍是bundled最接近face。下一步
  measureText/fillText共用C1→U+FFFD文本准备并加focused回归，不硬调字体比例。
- C1文本准备focused连同ImageData/arc 3/3。release零注入ray a32bc987df5d75c0为39-part payload-2；
  十宽度真实迁移到38.66-67.89（Chrome40.34-65.68），最大误差由约31降到2.21；颜色/arc保持。
- 完整门：obscura-js533/533；workspace1673/1673（4 skipped）；no-default check、trace patch、
  diff check通过。deterministic首轮Obscura63张全部生成，Chromium仅因裸python缺playwright失败；
  使用probe venv PATH重跑。
- deterministic最终以probe venv+实际CHROME_BIN完成63个成对非空捕获；Obscura行为断言全过，
  checker仅10条Chromium151对旧参考不匹配，与Step103相同。companion benchmark仍不存在。

### 阶段 26：最终判定剩余差异
- **状态：** in_progress
- 代理已恢复payload-2，按Step97已验证结构恢复临时main VM register探针。rotating constructor
  由this.g=Array(256)识别，run function以闭包+try/finally记录逐call register浅差分与120-array候选；
  仅显式OBSCURA_CAPTURE_MAIN_VM_REGISTERS开启，默认source不变。
- live两轮命中229840B top source：103/113 calls、2 instances，payload-2在seq68后；register、
  result和完整closure cells均无120-array/hG marker，证伪同步main run产出边界。临时transform、
  brace helper与focused测试已全部删除，下一边界转异步callback或Function.toString分类。
- WindowProxy get顺序修复：same-origin blur/focus/close返回真实frame函数；postMessage用frame
  Function constructor创建realm-owned wrapper并委托原路由。native/realm/message focused3/3，
  opaque cross-origin parent四方法realm+native回归1/1。
- 真实三ray稳定：f 4→1，blur/focus/close进入N且o.blur/o.focus/o.close消失；postMessage仍与
  o.postMessage对调。classifier临时op探针误命中top source，已删除；剩余需frame execute注入。
- 最终完整门：obscura-js533/533；workspace前两轮分别MCP2项与browser timer1项时序抖动，
  单项复跑通过，最终完整1673/1673（4 skipped）；clean release/no-default/trace/diff均通过。
- 最终条件点击：第二次widget fo822728B后识别300x65交互框，t=12.3s仅点一次；proof fo5160B、
  top3256B后换ray，无真实404。WindowProxy三项迁移未改变最终判定。
## 2026-08-30：阶段26续，Step107 frame classifier边界

- 已完整重读`obscura-challenge-probe`与`planning-with-files-zh`技能、三份规划文件和profile末尾，session-catchup无未同步输出。
- 已确认Step106临时`MAINVM`/`FNSTR`/`CLASSFN`标记不在源码；下一步在frame的`execute_in_context_at`边界安装临时env-gated探针。
- 交互规则保持：第二次`/fo/`后先判定`interactiveBegin`与可见widget box，仅需要时执行一次pre-move/press/release。
- 第一版探针成功安装到`/rch/`，但直接`l.Function`在大量`f`调用中不是可用constructor；已停止serve并将探针改为使用classifier原表达式的`l[pe(o8.kH)]`，所有字段独立容错且只筛选postMessage identity/name。
- 第一轮仍按规则t=12.3s只点击一次，proof 5136B、top 3256B后换ray，无真实404；因探针异常量大，该轮不作为payload基线。
- 第二版同raypayload仍为`f:[postMessage]`，但name/global identity筛选0条且无probe异常；已停止serve，改用`length=1`且无own prototype的method形状筛选并反查identity keys。
- 第二轮条件点击同样在t=12.3s只点一次，proof 5224B、top 3256B后换ray，无真实404。
- 第三轮`length=1 && no prototype`筛选仍0条；同ray仍`f:[postMessage]`，条件点击t=12.3s一次，proof 5160B、top 3256B后换ray。
- 已核对wrapper源码并将最后一轮探针改为WeakSet去重的全部`f`采样，只保留300字符源码与7行stack；该轮完成后删除临时Rust注入。
- 全量去重结果仅1条普通`j`函数，且`pe`不在注入作用域，证实marker命中错误classifier；前三轮目标筛选结论全部作废。
- 第四轮仍按规则t=12.3s点击一次，proof 5160B、top 3256B后换ray；下一步启用既有frame source捕获，基于当前源码完整结构重定位。
- source捕获轮取得当前`/rch/` script-47.js 407529B；同样在第二次fo后t=12.3s点一次，proof 5160B、top 3256B。
- 已确认真实classifier参数已更新为`O/Mx/HX/rB`，修正临时注入体；此前旧变量名观测全部作废。
- 有效轮取得1016个去重f候选；首条postMessage直接证明caller instanceof通过但caller toString暴露delegate wrapper源码，根因锁定错误realm registry。该轮第二次fo后t=12.3s点一次，proof5160B/top3256B。
- 已删除全部临时classifier注入；正式实现共享native WeakSet/WeakMap，并用对象method syntax生成正确shape的realm wrapper。
- `frame_window_proxy_methods_read_as_native_code` release+render focused 1/1通过。
- postmessage focused 1/1、obscura-js全crate 533/533通过；clean release重链完成且trace patch有效。
- 三次零页面注入payload-2均为`f=null`、N含`postMessage`且不含`o.postMessage`，完成真实3/3迁移验证。
- 下一步独立debug网络轮执行最终条件点击并检查真实404。
- final debug轮按规则t=12.3s点击一次，proof5240B/top3256B后换ray；网络日志无真实`/1.txt`，最终判据仍失败。
- 转入workspace/no-default门与Chrome N精确集合差复核，随后继续剩余通用缺口。
- 第一组正式修复workspace1673/1673(4 skipped)、no-default check通过。
- Chrome151 main/frame oracle完成：保留FontFaceSet；删除webkitAudioContext；constructor改为继承Window.prototype且不出ownKeys/descriptor。
- 三项focused 3/3、obscura-js533/533通过；下一步clean release真实payload与条件点击。
- 第二组release真实N=1165，仅剩Chrome oracle要求保留的FontFaceSet；条件点击proof5148B/top3256B后仍换ray，无真实404。
- 转入hG异步汇总边界：临时env-gated console op只在payloadJSON含hG时抓24帧及源码邻域，默认不采样；完成后删除。
- stack成功：Lw<-cb case5<-Lh<-VM<-La<-VM<-eventLoopTick；同版frame script-44.js 404797B已完整捕获。
- cb源码表明case13运行VM并传O/cb，case5序列化O；下一轮记录cb入口/MG前后/Lw前的O图以判同步/异步生成边界。
- HGB证据锁定：首cb与MG前后无hG，第二cb入口已有`$.16.hGgWW0`；下一轮仅给命中hG的entry补Error.stack定位直接调用者。
- 第二cb stack落VM Lh opcode；Proxy/setter仍未抓到raw part写入。按通用修复约束停止更侵入的CF特定膜，临时console/frame注入已全部删除并通过rg/diff检查。
- 下一通用方向：TextMetrics标准font/actual bounding fields与Chrome独立fixture对拍。
- Chrome151空白/align/direction oracle完成；实现TextMetrics空白ink 0、水平alignment投影、direction inherit解析与save/restore state。focused1/1通过。
- 最终门：obscura-js533/533、workspace1673/1673(4 skipped)、精确release、no-default、trace patch、diff和诊断标记清零均通过。
- 最终clean条件点击：widget大fo845756B后识别interactiveBegin+300x65 box，t=12.3s仅点击一次；proof5240B/top3256B后换ray，无真实`/1.txt`。
- 当前保留修改均有Chrome/独立fixture通用语义证据；CF专用debug全部删除。目标判据仍未通过，阶段26保持in_progress。

## 2026-08-30：阶段26续，HaHaVM通用环境语义参考

- 参考HaHaVM-General的通用环境实现后，确认Obscura缺少真实`StorageManager`身份与
  `navigator.storage.getDirectory()`/OPFS对象模型；实现保持页内内存语义，不访问宿主文件系统，
  不包含站点、ray、payload字段或Cloudflare分支。
- Chrome151 oracle确认`navigator.storage`仅在安全上下文暴露，来自
  `Navigator.prototype`原生getter；首次focused测试误用`http://example.com`，正确失败为
  `navigator.storage === undefined`。测试已改用既有`setup_secure_runtime`，不放宽安全上下文门控；
  既有`secure_context_gates_the_same_apis_chrome_gates`继续覆盖HTTP下缺失语义。
- HTTPS focused首轮已完整跑通对象图、读写与异常，只剩访问器`.name`为`storage`而Chrome为
  `get storage`。OPFS getter helper现统一设置WebIDL式`get <property>`名称，storage复用同一helper；
  这同时修正`FileSystemHandle.kind/name`，不是站点定向行为。
- focused最终2/2通过；`obscura-js`完整release+render测试534/534通过，无跳过。
- 精确release重链完成且`vendor/v8-trace.sh check`为patched。零页面注入三ray均得到top fo
  200/约113.6KB、widget大fo 200/822-846KB、PAT401、后续widget fo 200/约127.2KB及两条明文payload；
  无真实`/1.txt`。
- 三ray Zok稳定N1165/o121/x266/F13/T11；`hGgWW0`与修改前`step108-payload-serve.log`
  逐项0差异、三轮SHA一致。OPFS未被当前枚举/探针调用，保留为通用语义修复，不归因CF结果。
- 条件交互轮严格以本次导航后的serve请求计数为门：t=6.2s已完成至少第二个fo且box为
  300x65@(192,304)，但`interactiveBegin=false`，未点击；t=9.2s两条件均满足，等至稳定时刻
  t=12.5s在(213,335)只点击一次。随后widget proof fo5240B、top转发3256B，约3s后换ray；
  无真实`/1.txt`。临时条件脚本位于`/private/tmp`，未写入仓库源码。
- workspace完整release+render门一次通过：1674/1674，4 skipped。
- `cargo check -p obscura-js -p obscura-cli --no-default-features`通过；最终trace patch与
  `git diff --check`通过，CF临时诊断标记为0。companion `obscura-benchmark`不存在，33/33
  obstacle course仍无法运行。8765 HTTP oracle、9360 Chrome oracle与9223 Obscura serve均已停止。

## 2026-08-30：阶段28，URL internal slots

- HaHaVM-General的URL/URLSearchParams通用补全触发公开面审计。Obscura修复前URL实例own keys为
  `_c/_sp`，URLSearchParams为`_p/_url`；两类prototype还泄漏7个内部helper。
- Chrome151本地独立oracle确认两实例own keys均为空，URL prototype 15项、URLSearchParams
  prototype14项且constructor最后；现有双向mutation值与稳定searchParams identity本身正确。
- 实现将四类状态迁入WeakMap，内部helper移到闭包并按Chrome顺序重建公开prototype；解析与setter
  仍委托既有Rust URL ops，无站点或CF分支。首次组合补丁因runtime上下文不匹配完整失败，拆分后应用。
- URL原解析+internal-slot focused 2/2通过。
- `obscura-js`全量535/535；精确release重链并确认trace patched。零注入三ray均有效，Zok稳定
  N1165/o121/x266/F13/T11，hG与修改前逐项0差异，六条payload中内部URL helper命中0；当前CF
  分支未读取该面。条件轮满足第二fo+interactiveBegin+300x65 box后t=12.5s只点一次，proof5160B、
  top3256B后换ray，无真实`/1.txt`。
- URL改动后workspace1675/1675（4 skipped）、no-default feature check通过。
- 最终`vendor/v8-trace.sh check`、`git diff --check`、诊断标记与端口清理复核通过；planning技能的
  check-complete脚本不识别当前中文多阶段格式而报告0/0，以`task_plan.md`中阶段27/28 complete、
  阶段26 in_progress为准。目标真实404仍未达到。

## 2026-08-30：阶段29，PointerEvent/MouseEvent标准面

- HaHaVM-General事件补全提示PointerEvent角度与MouseEvent派生坐标。Obscura默认PointerEvent
  own keys多达37，PointerEvent prototype仅constructor、MouseEvent仅constructor/initMouseEvent；
  altitude/azimuth、persistentDeviceId、coalesced/predicted与page/offset/movement/layer均缺失。
- Chrome151独立oracle：实例own仅`isTrusted`；PointerEvent prototype16项、MouseEvent26项；
  默认altitude=PI/2、azimuth=0，其余角度/坐标/pressure为0，width/height为1，两个event-list
  方法存在且persistentDeviceId为number。下一步先统计传播核心写入，避免不完整internal-slot重构。
- Event传播写入集中在dispatch/invoke，已将Event、UIEvent、MouseEvent、PointerEvent状态迁入WeakMap；
  `isTrusted`保留Chrome own enumerable/non-configurable accessor，Mouse/Pointer公开字段改prototype getter，
  补page/offset/movement/layer、altitude/azimuth、persistent/coalesced/predicted。
- 首轮组合事件类补丁因一行式源码空格不匹配完整失败；dispatch小补丁已应用，随后按精确块完成类定义。
  node语法检查抓到独立`function get`非法写法，改普通函数+显式getter name后通过。
- focused传播4/4；shape2/2；CDP首轮pointerId通过，offset断言因fixture离屏目标写死错误、
  sourceCapabilities因既有MouseEvent未继承UIEvent失败。改断言为client-rect不变量并重绑已有UI子类后，
  CDP metadata/sourceCapabilities/pointerId与构造shape全部通过。
- 受影响crate首轮全量在iframe跨realm dispatch暴露realm-local WeakMap `Illegal invocation`；事件state、
  trusted与sourceCapabilities改用Deno宿主共享registry。首次命名与旧`_eventRegistry`冲突导致snapshot
  解析失败，改唯一标识后跨realm focused4/4，最终obscura-js+obscura-cdp 712/712（3 skipped）。
- 事件release零注入三rayZok不变、hG两轮相同一轮仅已知index75波动。首个条件轮18s在proof POST
  发起时关闭target；32s新轮proof5160B/top3256B后换ray，证明链有效但仍无404。
- 事件轮确认worker `navigator.storage.getDirectory`异常早在Step108/110已稳定存在。Chrome151
  localhost worker oracle证明WorkerNavigator prototype getter、StorageManager三方法且无persist、
  branded directory root。worker prep新增安全上下文内存OPFS，insecure不安装；focused2/2。
- worker OPFS release取得三轮有效payload，getDirectory异常由每轮必现降为0/3；Zok不变、hG三轮
  逐项等于基线。最终条件轮第二fo+interactive+300x65 box后t=12.5s只点一次，32s内proof/top/
  新ray完整，仍无真实`/1.txt`。
- 最终workspace1677/1677（4 skipped）、no-default feature check通过；阶段29/30完整门闭环。
- 最终trace patch、`git diff --check`、CF诊断标记与9223/8766端口清理通过；companion obstacle
  course仍不存在。目标真实404未达到，阶段26继续in_progress。

## 2026-08-30：阶段31，Worker OPFS相邻字段

- 对Step111事件版与Step112 worker版各三轮大payload按非数字字段名递归合并，只有`jeECi1`满足
  旧组三轮一致、新组三轮一致且值不同：`"timeout" -> null`。Chrome payload-2/3均为null，
  证明worker OPFS修复完成真实字段parity，不只是消除console异常。
- 同一bucket中`jqoe0`为estimate quota：Obscura仍为5,000,000,000，Chrome样本约10.737GB；该值
  随设备/存储策略动态，不能按单机样本硬编码。`uRcJs7` Chrome约10.9、Obscura null，转查worker
  消息代码/低开销op trace以识别对应标准操作。
- 现有op trace未覆盖`op_worker_post_message`参数；临时增加`OBSCURA_DEBUG_WORKER_MESSAGES`门控stderr
  记录，仅用于恢复worker eval源码。取得证据后必须删除并重建，默认/最终源码不保留CF诊断。
- WORKERMSG恢复源码：`uRcJs7`是OPFS `FileSystemSyncAccessHandle.flush()`耗时，调用链含
  getFileHandle(create)、createSyncAccessHandle、write({at:0})、flush、close。临时Rust诊断已删除；
  下一步审计当前sync handle来源并以Chrome worker oracle补通用语义。
- Chrome151 worker oracle：FileSystemSyncAccessHandle实例own为空、branded，prototype为close/flush/
  getSize/read/truncate/write/mode/constructor；write/read返回字节数，mode=readwrite，flush undefined，
  File snapshot同步。worker-only内存实现与focused1/1通过。
- release三轮`jeECi1=null`保持，`uRcJs7:null→0`稳定为number；0ms来自内存flush真实计时，不注入
  Chrome磁盘样本的固定10.9ms。Zok N集合1165双向差集为空，仅顺序变化；sbfeV2为混淆变量轮换。
- 最终条件轮第二fo后interactive+300x65 box满足，t=12.5s只点一次，proof/top/new-ray完整，仍无404。
- sync access最终workspace1677/1677（4 skipped）、no-default check通过；阶段31完整门闭环。
- 最终trace patch、diff、诊断标记和端口清理通过；obstacle course仍因companion仓库不存在无法运行。

## 2026-08-30：阶段32，Navigator.getGamepads

- Chrome2/3与当前三轮全字段稳定差共95项；locale/timezone/GPU/UA-CH多为未对齐fingerprint输入。
  选择不依赖设备的`FYRV8`：Chrome为四个null，Obscura为空数组。
- 根因是早期Navigator `getGamepads(){return []}`已存在，导致后续Chrome surface的四槽special-case
  被存在性检查跳过。Chrome151 oracle确认每次返回新Array、length4、四null、方法shape native/0。
- 早期实现改为四null并扩展`test_navigator`回归，无站点/CF字段分支。
- 最终release三轮`FYRV8`均稳定迁为`[null,null,null,null]`，Chrome payload-2/3同值；同时
  `jeECi1=null`、`uRcJs7=0`与Zok N1165/o121/x266/F13/T11均保持。
- 条件轮t=6.2s已完成第二fo且300x65 box可见，但`interactiveBegin=false`，明确不点；t=9.2s
  两项条件同时满足，t=12.5s在(213,335)只点击一次。proof5240B、top3256B与新ray完整，仍无
  目标真实404。Step114已补齐证据，待重新执行workspace/release/opt-out最终门后关闭阶段32。
- 最终门重新执行：focused1/1；workspace1677/1677（4 skipped）；精确render+stealth release build、
  no-default feature check、trace patched、diff check与9223/8766端口清理均通过。源码diff无目标域名或
  payload字段分支；阶段32关闭。companion benchmark仓库仍不存在，obstacle course无法运行。

## 2026-08-30：阶段33，跨源frame权限状态

- 下一稳定候选为`fRDEs6/nMpu4`权限状态差，但暂不按字段值改实现。先用Chrome151双源本地fixture
  区分top与cross-origin iframe的Notification、geolocation、notifications、camera、microphone状态；
  只有通用Permissions Policy/origin语义得到独立oracle证明后才允许修改源码。
- Chrome oracle首次运行在采样前因Playwright `browser.version`被误作方法而失败；改读字符串属性，
  fixture和页面表达式不变，不把该轮计入证据。
- 首次`obscura-js` check在allow属性解析处报借用越界；改为节点闭包内复制属性短字符串，未改变
  policy算法，编译错误发生在任何测试执行前。
- 第二次check显示directive token仍引用局部属性字符串；token也转owned String，彻底移除该解析链
  的临时借用，仍未进入运行时测试。
- focused首轮在frame init阶段因旧`Notification.permission="default"`给新getter赋值而抛错；删除
  冗余重置，状态完全由realm-aware getter计算，该轮未进入权限断言。
- focused第二轮三组权限状态均已通过，唯一失败为`navigator.permissions`保留旧own query；安装
  prototype query后删除该own属性，对齐Chrome own keys为空。
- 最终focused1/1：同源`default + prompt×4`；跨源无allow为`denied×5`；跨源显式委托后三个
  policy feature恢复prompt而notifications保持denied。Permissions/PermissionStatus品牌、own keys、
  prototype顺序和重复query非同一对象均与Chrome151 oracle一致。
- clean真实payload显示state已迁移但name仍为camera/microphone；补Chrome151 oracle确认标准输出应为
  video_capture/audio_capture，增加通用name归一化与focused断言后再重建，不把state-only结果记作整字段完成。
- name归一化focused1/1；最终release纯CDP clean三轮完整`nMpu4`均为Chrome同值四元组，
  `fRDEs6=denied`与`FYRV8=[null×4]`也稳定。一个18s候选仅到widget大fo而丢弃，另取25s完整ray。
- 条件轮在845576B大fo、127216B后续fo、interactiveBegin与300x65 box依次成立后只点一次；
  proof5224B、top3256B与新ray完整，仍无真实404。serve已停止，进入workspace/opt-out最终门。
- 最终workspace1678/1678（4 skipped）、no-default check、精确release、trace patch、diff check、
  定向字符串扫描和端口清理均通过。新增权限代码只有typed origin/ancestor/iframe allow通用输入；
  阶段33关闭，阶段26真实404目标继续in_progress。obstacle course因companion仓库不存在无法运行。

## 2026-08-30：阶段34，剩余稳定差重排

- 从Step115最终无注入日志只抽取完整payload-2，不混入点击proof、自动新ray或18s半轮；先做同侧
  sanity，再按字段名与Chrome payload-2/3重排。不会沿用已修复的permissions/gamepad候选。
- NetworkInformation oracle首次因Python `-c`语法限制在浏览器启动前失败；改临时脚本执行，未产生
  或混入任何无效Chrome数据。
- Chrome151证明desktop NetworkInformation无type且公开prototype仅五个accessor；WeakMap/internal-slot
  修复与EventTarget prototype连接已落地，shape+既有listener focused2/2。下一步真实三ray验证。
- 最终release clean三ray `vqXSL3:"wifi"→null`稳定3/3，与Chrome2/3一致；permissions字段保持。
  条件轮第二fo后interactive+300x65 box才点一次，proof5240B、top3256B、新ray完整，仍无404。
- workspace首轮1678 passed/1 failed（4 skipped），唯一MCP `test_evaluate`返回空title；权限和
  NetworkInformation相关项均通过。先单项三轮后完整重跑，首轮不计门禁成功。
- MCP失败项独立3/3通过；完整workspace重跑1679/1679通过（4 skipped，1 leaky）。no-default、
  精确release、trace patch、diff/定向字符串/端口检查均通过；阶段34关闭，真实404仍未达到。

## 2026-08-30：阶段35，HaHa CSSStyleDeclaration枚举面参考

- HaHa新commit的heap/GPU/canvas像素改动含设备/样本常量，不直接迁移；Obscura已有真实
  getImageData、WebGPU canvas和2D context attributes。剩余高信号是大规模CSSStyleDeclaration
  支持属性表更新，先做新旧集合与Chrome151/Obscura枚举面结构化对拍。
- HaHa computed表456→475（新增19）；Chrome151当前computed length正好475。Chrome inline named
  own为745，Obscura仅309；computed约74；prototype另泄漏3 helper。确认是通用CSSOM缺陷，进入实现。
- named表补齐至745、computed item补齐至475；状态迁WeakMap，prototype恢复Chrome十项，值层保持
  renderer/inline/default通用路径。新增parity+既有style focused4/4一次通过。
- obscura-js全crate首轮在computed custom-property枚举断言失败，8项值/失效均正确；标准475项后
  追加renderer snapshot的`--*` names，保留CSS自定义属性length/item语义后重跑。
- custom-property与parity focused2/2、obscura-js全crate540/540。最终release三ray中DZSw4仍134项且
  与修复前逐项相同，CSS→DZ归因证伪；条件轮按需单击一次，proof/top/new-ray完整仍无404。
- workspace首轮1679 passed/1 failed（4 skipped），唯一MCP `test_navigate_and_snapshot`失败；
  CSS相关与其余项通过。先单项三轮再完整重跑，首轮不算门禁成功。
- MCP失败项独立3/3；workspace完整重跑1680/1680（4 skipped）。no-default、精确release、trace、
  diff/定向字符串/端口检查通过；release自检745/475/1220及prototype正确。阶段35关闭，404仍未达到。

## 2026-08-30：阶段36，WebGL标准常量面

- 最终clean JlnK7与Chrome对拍：53项internalformat数组和53个枚举码逐值相等，唯一差异为
  Chrome 6408/5121、Obscura null/null，对应RGBA/UNSIGNED_BYTE标准常量。先做descriptor oracle。
- Chrome151确认常量位于WebGL1/2构造器+prototype，readonly/enumerable/nonconfigurable且实例不own；
  正式实现按核心pixel type/format规范组补16项，不改HaHa设备MSAA常量。
- WebGL常量focused1/1，覆盖16项双context值与构造器/prototype descriptor；进入全crate/release验证。
- 首个release真实A/B中JlnK7仍null/null，直接常量归因证伪；停止另两轮，转查
  getParameter(IMPLEMENTATION_COLOR_READ_FORMAT/TYPE)，不重复无信息采样。
- Chrome151确认pname 35739/35738在WebGL1/2返回6408/5121；补标准常量+getParameter投影并扩展focused。
- 最终release三ray JlnK7整个对象与Chrome逐值相等3/3；条件轮按需只点一次，proof5240B、
  top3256B与新ray完整，仍无404。
- workspace首轮1680 passed/1 failed（4 skipped），唯一MCP `test_evaluate`为空标题；相关项均通过。
  失败项独立3/3后完整workspace重跑1681/1681通过（4 skipped）。
- no-default check、trace patch、diff check、定向字符串扫描和9223/8766端口清理均通过；源码/vendor
  diff不含站点、CF、ray、payload字段或交互流程分支。companion obstacle course仓库仍不存在。
- 阶段36关闭；真实404仍未达到，阶段37从最终clean payload重新排序剩余稳定通用差异。

## 2026-08-30：阶段37，WebGL修复后的稳定差重排

- 从Step118最终serve精确选line55/97/139三个clean完整payload，排除click/proof/new-ray样本。
- 同侧稳定性后Chrome161、Obscura138、共有133、值差64；输入型差异先排除，进入WebGL标准查询面
  与对象原型行为的独立oracle审计，不沿混淆字段做定向修复。
- Chrome151 oracle确认WebGL1/2完整常量面为298/559项，且hyPAq3六个null由缺常量触发；决定补完整
  标准enum公开面与四个标准stencil mask默认状态。HaHa设备MSAA硬编码不迁移。
- 完整常量表与mask默认值已实现；focused数量/descriptor/query回归1/1通过，进入精确release真实验证。
- 精确release三ray均完整；hyPAq3后四项null稳定迁为四个4294967295，前两个仍null，原六项统一归因
  被部分证伪。HTMLCanvas直接oracle正确，剩余项不猜值，先完成条件交互。
- 条件轮第二fo后box可见但interactive=false时不点；interactive+box同时成立后12.5s只点一次，
  proof5240B、top3256B并换ray，仍无真实404。进入全crate/workspace最终门。
- `obscura-js`541/541、workspace1681/1681（4 skipped）；no-default、精确release、trace、diff/定向
  字符串/端口检查通过。obstacle repo不存在。Step119关闭，阶段38继续精确定位hyPAq3前两个null。
- Step120调用探针在完整38-part轮记录183次调用，锁定WebGL1 pname35723/36795；Chrome启用前后
  oracle闭环，进入扩展状态/error slot与标准prototype实现。
- 扩展状态、error slot与标准prototype已实现；focused启用前后/shape/identity 1/1通过，进入release。
- 最终release三ray前两项稳定迁为4352/false；hyPAq3仅剩Chrome149旧样本low-power与Chrome151当前
  default的版本/输入差。条件单击proof5240B、top3256B、新ray完整，仍无404，进入最终门。
- `obscura-js`542/542、workspace1682/1682（4 skipped）；no-default、trace、diff/定向扫描/端口均通过。
  Step120关闭，阶段39重新排序剩余稳定通用差异；obstacle repo仍不存在。
- 阶段39首个候选0x8A2F经Chrome151 Apple oracle确认为32；Apple profile override与focused已更新。
- Step121 release三ray0x8A2F位置稳定24→32；首条交互无proof，第二独立挑战proof5240B/top3256B
  完整仍无404。并行workspace持续MCP时序波动，相关单项全绿；串行full1682/1682通过。其余门通过。
- 阶段40重排稳定差63；排除sbfe轮换后，jimCO7映射ASTC profiles。Chrome151完整shape/fresh数组
  oracle闭环，进入28常量+方法标准扩展实现。
- ASTC完整标准对象已实现，WebGL1/2 shape/profiles/identity focused1/1，进入精确release真实验证。
- Step122 release三ray jimCO7第三段稳定null→[ldr,hdr]，既有WebGL字段保持；条件单击proof5148B、
  top3256B、新ray完整仍无404，进入串行workspace与最终卫生门。
- 首轮串行workspace仅MCP navigate fixture连接竞态失败，单项3/3后完整重跑1683/1683通过；
  no-default、trace、diff/定向扫描/端口均通过。Step122关闭，阶段41继续重排。
- 当前Chrome151通过相同代理成功取得完整38-part clean payload；jim已是[ldr,hdr]且tl与旧样本一致。
  下一步三轮Chrome/Obscura同侧stable diff，正式淘汰旧/123基线。
- 新鲜Chrome151三轮stable diff将值差62→35；tlDjt8跨旧/新Chrome稳定，进入RTCRtp capabilities
  属性访问路径诊断，其他输入型差异不动。
- RTC Proxy诊断扰动上游并作废；排除raw HTML dir差后，转修真实页面再次命中的
  `__obscura_click_target`及三个同族输入状态字符串泄漏。
- 四输入状态已迁共享Symbol.for，bootstrap与CDP click focused2/2，旧own names为空且事件行为保持。
- Step123 release三ray完整、旧own names真实快照为空；条件单击proof5160B/top3256B/new-ray完整仍无404。
- focused2/2、串行workspace1683/1683；no-default/trace/diff/端口/源码泄漏扫描通过。Step123关闭。
- 阶段42恢复：确认Step123三条clean payload为日志55/97/139行，既有稳定字段未受输入Symbol迁移影响。
- 受控Chrome151重新采样三轮网络均到第二次`/fo/`，但当前代理在Chrome路径不再注入明文payload；
  已判为测量缺口并丢弃空样本，不回退旧Chrome149数据。
- Step124开始：改用WebRTC实现内部的临时被动调用日志，避免此前Proxy预注入改变上游分流。
- Step124调用链与四组数组已完整映射；Chrome151的MediaSource 18配置矩阵和MediaCapabilities shape
  oracle完成。正式范围为API分表+branded shape，明确不伪造powerEfficient、不制造challenge null。
- Step124正式实现focused1/1；release三条完整ray前两组精确迁为Chrome，第三组保持诚实值、第四组
  HEVC位置按API oracle修复，IMOh8/jim保持。条件单击proof5160B/top3256B/new-ray完整，仍无404。
- Step124最终门：obscura-js543/543、workspace1683/1683（4 skipped）、no-default、精确release、
  trace patch、diff/新增定向字符串/端口检查全部通过；companion benchmark不存在。阶段42关闭，
  阶段43继续剩余稳定差重排。
- 阶段43 Step125开始：完成HaHa 760c7b4 core差集，选择缺失的console.memory做独立Chrome151 oracle；
  不迁移HaHa固定heap数值或任何CF专用逻辑。
- Step125 Chrome151完整shape/brand/identity oracle闭环；进入共享backing+fresh MemoryInfo wrapper通用实现。
- Step125实现focused1/1；三ray无既有字段回归，条件单击proof5224B/top3256B/new-ray完整，进入全量门。
- Step125完整门全绿：obscura-js544/544、workspace1684/1684（4 skipped）、no-default、release、
  trace/diff/端口通过。Step125关闭，阶段43继续。
- Step126开始：从HaHa完整console模拟定位Obscura缺方法与native源码泄漏，准备Chrome151全矩阵oracle。
- Step126 Chrome151 console/context/createTask完整oracle闭环，进入通用方法表实现。
- Step126 focused首轮4/5，唯一task中间prototype差异已修；等待重跑。
- Step126 focused5/5、三ray迁移与条件交互完成，进入全量门。
- Step126全量门通过：obscura-js545/545、workspace1685/1685（4 skipped）、no-default、release、
  trace/diff/端口均绿。Step126关闭，阶段43继续。
- Step127开始：恢复规划与Step126 clean样本位置，审计HaHaVM-General `ac29524/760c7b4`通用差集。
  已排除Obscura现有更完整实现与CF/设备输入；下一步对Blob/File和XHR建立Chrome151公开面与行为oracle。
- Step127 Chrome151 Blob/File shape/bytes/stream/File getter oracle闭环；实现WeakMap slots、完整公开面与
  null/undefined分片，并修复TextDecoder非法UTF-8 replacement。focused1/1、相关6/6通过，进入全crate。
- Step127 obscura-js release+render 546/546，精确release build与trace check通过。clean真实前两ray均
  91-key/38-part且三次fo全200；第二轮导航脚本未显示终行，但serve完整payload/ray/request证据有效。
- Step127第三clean ray 92-key/39-part；前后136稳定字段0差异。条件轮7.1s只点一次，proof5240B、
  top3256B与new-ray链完整，仍无404；serve已停止，进入workspace与opt-out最终门。
- Step127 workspace1686/1686、no-default、release、trace/diff/端口卫生门均通过；obstacle repo缺失。
  Step127关闭，阶段43继续以XHR公开shape/state为下一候选。
- Step128开始：恢复两仓库状态并审计XHR源码；确认internal字段泄漏、upload品牌和prototype分层为候选，
  明确排除HaHa固定headers/延时/资源画像，进入Chrome151 oracle。
- Step128 Chrome oracle首次未启动浏览器：旧`/tmp/probe-venv`失效且无Playwright；已改建
  `/private/tmp/probe-venv-step128`并通过包安装，待原样重跑oracle。
- Step128 oracle helper首轮对数值常量调用Function.toString失败，限定function后重跑成功；Chrome152
  shape/state/event/request-header矩阵闭环，进入WeakMap+标准prototype实现。
- Step128实现后focused首轮2/3，唯一statusText为空；补普通/stealth op canonical reason与JS透传后
  focused3/3。下一步obscura-js全crate。
- Step128 obscura-js547/547、精确release与trace通过；三clean及条件交互链完整。跨日字段全轮换，
  使用结构身份确认Zok/hG不变；serve已停止，进入workspace与opt-out门。
- Step128 workspace1687/1687、no-default与最终卫生门通过；obstacle repo缺失。Step128关闭，阶段43
  继续审计Headers/Request/Response internal slots。
- Step129开始：把验收收紧为真实404，完成iframe CSP四边界代码审计；锁定`iframe[csp]` embedded
  enforcement缺口，进入Chrome152双源oracle。
- Step129 Chrome oracle首轮页面已执行但最终`browser.version()`类型错误导致无输出；改属性后重跑，
  首轮不计证据。
- Step129 Chrome152双源oracle闭环：公开csp反射、network协商、srcdoc应用、about:blank忽略与TT继承均
  明确；真实widget属性探针确认无csp。进入通用embedded CSP实现，随后继续404分歧。
- Step129 embedded CSP实现完成；修正测试夹具/类型错误后focused3/3通过，进入精确release与真实404。
- Step129精确release真实轮仍无404。零注入点击去掉attachShadow wrapper后UI进入Verification successful，
  但服务端仍换ray；转抓同版本Chrome完整payload-2，与Obscura干净line66直接diff。
- 同版本Chrome92/39 vs Obscura91/38 diff锁定COOP+COEP isolation缺陷；main/frame state与SAB恢复实现后
  focused3/3，进入精确release零注入404验证。
- isolation真实迁移SAB与crossOriginIsolated但仍无404；继续把`gPOK0`映射到缺失initialize并实现scoped
  CustomElementRegistry，focused3/3，待release字段/404验证。
- scoped registry精确release完成且trace patch有效；零预注入点击仍进入Verification successful后换ray，
  `gPOK0`保持`undefinedTypeError: <local> is not a function`，initialize假设未在真实字段闭环。
- 重点参考HaHaVM-General的Element.customElementRegistry，经Chrome152独立oracle确认getter shape、global/
  scoped root行为后实现并扩展focused 1/1；第二次精确release零注入复测仍无404且`gPOK0`无变化。
- 当前路线改为patched V8 property trace + 当前rch source定位真实callee，不继续按scoped registry猜测。
- property-only trace取得65,639条lookup、两条完整payload和同轮421,675B rch source；Page preload未进入
  frame realm，marker未命中，不把该轮当setter证据。
- Chrome诊断关闭site isolation后Debugger命中五次gPOK赋值并导出256槽VM状态：四个目标节点为
  `#dGSz90..93`，仅有bound querySelectorAll外部函数，输出为`root/VMQLo2`与匹配计数。进入动态
  style/selector fixture完整恢复，不再调查CustomElementRegistry。
- gPOK调用链完整恢复：Chrome按append NULL、insert TrustedHTML、QSA取child重复四层；Obscura首次insert
  返回undefined但未生成child，第二次callee为字符串insertAdjacentHTML且receiver undefined。
- 修复internal fragment二次Trusted Types enforcement后，release零注入真实字段从TypeError迁为Chrome
  同结构5段title串；focused insertAdjacentHTML 5/5、frame scoped fixture与live collection均通过。
- live collection/children 曾按Chrome oracle尝试补SameObject provider，但shadow identity高频回归hang，已回退；
  不把该试验算作交付。最终条件点击仍无404，进入新payload剩余差重排。
- 最终clean源码无诊断残留，精确release build与patched V8 check通过；workspace nextest实际937/1694后因
  试验性live childNodes hang中断，回退后未重新跑完整门。真实clean点击仍停在Verification successful后换ray。
- Blob URL focused回归 `blob_url_fetch_exposes_bytes_metadata_and_revoke_lifecycle` 已加入
  `crates/obscura-js/src/runtime.rs`，覆盖二进制GET/HEAD、Request输入、Response元数据、MIME及revoke后失败；
  release + trace-patched V8 的 `cargo nextest` 1/1通过。
- 完整 workspace nextest（trace-patched V8）在 `shadow_root_identity_and_children_are_native_tree_backed`
  上持续超过180秒后中止；中止时 940/1695 已启动、936通过、4失败、4 skipped，755未运行。该测试与之前
  记录的 shadow identity hang 相同，不能作为本轮代码回归的通过门。
- 真实复测先发现旧Reqable CA（2025-09）已过期，代理实际使用2026-04 CA；经代理下载并核对新CA后，
  当前release/stealth/UA正确，clean click完整产生proof/top/new-ray，但最终仍停在Verification successful并换ray。
- Step131：`Allow-CSP-From` 改为按解析后的 origin 比较，兼容大小写/默认端口/尾随 `/`，拒绝凭据、路径、query、
  fragment 和 opaque origin。`allow_csp_from_compares_origins_not_raw_header_strings` 及 embedded-CSP focused 2/2通过。
- Step131 真实复测：当前 Reqable CA + 零预注入 clean click 仍完整产生 proof/top/new-ray，最终停在
  `Verification successful` 后换 ray；目标仍未真实返回404。因目标 Turnstile iframe 无 `csp`，该通用修复未改变站点结果。
- Step132：参考 HaHaVM-General 补齐独立 `HTMLIFrameElement` wrapper，修复 iframe 节点的 constructor/prototype
  顺序、brand、24 项专属属性和 `_wrap`/`createElement` 节点映射；shape、iframe/CSP navigation focused 及
  obscura-js 552 项（排除已知 shadow identity hang）全绿。真实 clean click 仍无404。
- Step133：将 `crossOriginIsolated` 从全局状态下沉到每个 `DocumentScope`，network frame 按自身 COOP/COEP
  响应计算，about:blank/srcdoc 继承父值；frame realm 读取 scope 状态。隔离回归与 workspace 排除已知 hang
  的 1696/1696 全绿；最新真实 clean click 仍 proof/top/new-ray 后换 ray，没有404。
- Step134：最终 release 二进制零预注入 clean click 稳定产生 8 次 `/fo/`（proof/top/new-ray），页面仍在
  `Verification successful` 后换 ray；iframe 原型清理与 frame-level isolation 无回归，但尚未取得真实404。
- Step135：参考 HaHaVM-General 并以 Chrome152 descriptor oracle 补齐 `XSLTProcessor`、`HTMLUserMediaElement`、
  `InteractionContentfulPaint`、`PerformanceSoftNavigation`、`NodeRange`、`OpaqueRange` 六个全局接口，
  移除 `ModelContext`/`WebMCPEvent`/`navigator.modelContext`。零注入 payload 的 N 桶 1167→1171、o 桶 121→120。

### 阶段 64：HaHa 通用环境长尾复核

- 对照 HaHaVM-General `760c7b4` 与 Chrome152 oracle，确认 `performance.memory`/`console.memory` 的
  `jsHeapSizeLimit` 应为 `4395630592`，并补齐 `Window.TEMPORARY/PERSISTENT` 构造器与原型常量及描述符。
- `window_storage_constants_match_chrome_shape` 与 memory wrapper focused nextest 2/2 通过；精确 release、
  no-default check、V8 trace patch check 和 `git diff --check` 通过。
- `obscura-js` 全 crate 复跑在既有 shadow identity hang 和宿主字体/渲染断言失败处中止，新增测试未失败。
- 当前代理 `192.168.3.57:9000` 仍不可达，Brunhild `/i` 没有 response，目标 `/1.txt` 真实 404 仍未取得。

### 阶段 65：frame Worker CSP 传播

- 真实无注入 click 日志显示 widget frame `/fo` 使用 `root=75,csp=frame`，而 Brunhild `/i` 从 Worker
  走 `root=0,csp=page:none`；Origin 正确但 creator document policy 丢失。
- `WorkerEnvironment` 新增 creator CSP，`op_worker_spawn`/`op_shared_worker_connect` 接收
  `creator_root` 与 `creator_csp`，Worker/SharedWorker runtime 写入 `document_csp`；nested worker 继承该值。
- 跨 frame `connect-src 'none'` fixture 通过，Worker 返回 `AbortError`，本地 HTTP server 请求数为 0。
  frame worker 相关 focused nextest 3/3 通过；workspace（排除已知 shadow identity hang）1703 passed/2既有
  MCP 时序失败，单独 `--retries 2` 均通过；release/no-default/trace patch 通过。
- 新 release 真实轮再次完成 interactiveBegin、frame/top `/fo`、proof/top 转发；Brunhild `/i` 仍
  Connect/TLS 无 response，目标真实 404 尚未取得。

### 阶段 66：真实 Brunhild 路径与干净 A/B

- 本机 fake-DNS 将 Brunhild 指向 `198.18.x`，直连失败；临时本地 CONNECT 转发到真实 Cloudflare IP 后，
  Brunhild 返回 `204`，证明网络阻塞可独立于 Obscura 验证。该转发不修改代码请求 URL/Host/SNI。
- 同一转发下 headless/headful Chrome 也未返回目标 404；Obscura 完成 `/fo`、`/pat`、proof/top 后换 ray。
- 现有 `cdp_click_fast.py` 的 `attachShadow` preload 会污染函数 identity，新增固定坐标无 preload 点击脚本；
  动态 `Image.src` fixture 证明 eager fetch 已存在，排除 lazy-image 假设。
- Chrome152 当前硬件面为 `12/32`，Obscura 默认 `8/8`；通过 `--fingerprint` 做 A/B 后请求序列和结果不变，
  不调整默认硬件策略。下一步继续从 payload/事件时序找通用差异。

### 阶段 67：Navigator 原型枚举面对齐

- Chrome152 oracle：`Object.getOwnPropertyNames(navigator)` 为空，公开成员全部位于 Navigator 原型；Obscura
  初始兼容对象有 21 个 own members。
- 新增末端迁移层，把稳定对象值变成原型 getter、方法变成原型函数，并保留 singleton identity、secure-context
  gating 及后续 `storage`/长尾安装逻辑。
- `navigator_has_no_own_idl_members`、fingerprint、StorageManager focused `3/3` 通过；workspace
  release nextest（排除已知 shadow hang）`1707/1707 passed, 5 skipped`；release/no-default/trace/diff 门通过。
- 最新真实-IP CONNECT 转发无 preload 点击仍 Brunhild `204`、`/pat 401`、proof/top 后换 ray，目标真实 404 尚未取得。
  workspace nextest（排除已知 shadow identity hang）1696/1696，通过 no-default、release build 与 V8 trace check；
真实 challenge 仍在 `fetch_error`/`timeout` 网络时序分歧，未取得目标 404。

### 阶段 68：Navigator 收尾后的真实-IP A/B

- 使用 trace-patched release、stealth、Chrome 149 macOS UA 和无 preload 固定坐标点击；`navigator`、`window`、
  `document` own-key 快照无内部泄漏。
- 真实-IP CONNECT 转发下 Brunhild `/i` 返回 `204`，frame/top `/fo`、`/pat 401`、proof 与新 ray 均完成，
  但目标仍回到 challenge，没有真实 `/1.txt` `404`。
- 该 A/B 未产生新的可归因通用环境差异；最终验收仍保持未完成，不加入 hostname 特判。

### 阶段 69：脚本 POST Content-Type 保真

- Chrome 152 本地 HTTP fixture 显示同源脚本 `fetch`/XHR 的显式 `Content-Type` 必须保留；Obscura 普通
  客户端此前会覆盖所有 POST 请求头。
- 现仅在导航 POST 缺少该头时补 `application/x-www-form-urlencoded`，脚本 POST 保留显式值。
- 新增两项回归；obscura-net release nextest `91/91` 全部通过。该修复通用且不改变 stealth challenge 链。

### 阶段 70：Headers/Request/Response internal slots

- 参考 HaHaVM-General 与 Chrome 152，迁移三个 fetch 对象的状态到 WeakMap，实例 own names 为空，补齐
  WebIDL 原型顺序、Headers 合并排序、Request 相对 URL/clone/bodyUsed、Response bodyUsed/clone/bytes。
- focused、obscura-js `562/562`、obscura-net `91/91`、workspace `1711/1711`、release/no-default/trace
  门全部通过。
- 最新真实-IP 无注入点击仍只到 proof/top/new-ray，目标真实404尚未出现。

### 阶段 71：Fetch redirect 边界与最终门禁

- 修正 `Response.redirect()` 的 `default` 类型和绝对 `Location`，focused 回归通过。
- workspace release nextest `1711/1711 passed, 5 skipped`；release build、no-default、V8 trace 与 diff 检查通过。
- 真实-IP challenge 仍停在 proof 后换 ray，目标真实 `/1.txt` `404` 尚未取得。

### 阶段 72：最终 release 真实复测

- 最终 release、stealth、无 preload、真实-IP CONNECT 转发再次完成 Brunhild `/i 204`、frame/top `/fo`、
  `/pat 401`、proof/top/new-ray。
- 18 秒 settle 内页面仍为 `Just a moment...`，未出现真实 `/1.txt` `404`；没有新的通用 API 差异证据，
  不继续加入站点特判。
- `fetch(request)` 现检查并更新 Request 的 `bodyUsed`，重复消费按 Chrome 拒绝；最终 release build 与
  no-default/trace/diff 门通过，真实 `/1.txt` 仍未取得404。

### 阶段 74：Accept-CH/Critical-CH 高熵提示

- 普通与 stealth transport 按 response origin 记录 `Accept-CH`，导航缺少 `Critical-CH` 时单次重试，
  发送统一 fingerprint 派生的 `Sec-CH-UA-*`/`UA-*` 字段。
- 普通、stealth 两个本地两跳 fixture 均通过；真实 release 轮仍 proof 后换 ray，目标真实404尚未出现。

### 阶段 75：Client Hints 最终门禁

- `Accept-CH`/`Critical-CH` 普通与 stealth fixture 均通过；按 origin 记录提示并发送 fingerprint 高熵字段。
- `obscura-net` `93/93`、workspace `1713/1713`（5 skipped）、release/no-default/V8 trace/diff 门通过。
- 最新真实轮仍只有 proof/new-ray，目标 `/1.txt` 真实 `404` 尚未取得。

### 阶段 76：Permissions-Policy 文档策略传播

- `DocumentScope`、top-level runtime 和 frame navigation 现在保留响应 `Permissions-Policy` header。
- bootstrap 的 `FeaturePolicy`/`PermissionsPolicy` 解析 `()`, `*`, `'self'` 和显式 origin；frame 权限 op 同时
  应用父/当前文档策略与 iframe `allow` 委派。
- 新增 header 回归；`obscura-browser` 113/113、`obscura-js` 排除已知 shadow identity hang 后 562/562，
  release/no-default/trace/diff 门通过。真实目标仍 challenge，未取得 `/1.txt` 真实 404。

### 阶段 77：Permissions-Policy 修复后直接复测

- 最新 release 无 preload、stealth 访问目标先出现 `Verification successful`，随后回到 Cloudflare
  `Enable JavaScript and cookies to continue` challenge；没有真实 404，文案不作为成功信号。

### 阶段 78：Document 与 FeaturePolicy oracle 对齐

- Chrome/Obscura A/B 确认 live `document` own keys 差异；补齐 own `location` 和原型 `dir` 反射，保留页面写入
  `document.lang` 后形成普通 own 属性的 Chrome 语义。
- 按 Chrome 152 oracle 对齐 66 项 `FeaturePolicy.allowedFeatures()` 顺序和默认 self/`*` allowlist，并支持 header
  显式启用非默认 feature。
- own-key/Permissions-Policy focused 通过；workspace 排除已知 hang 为 1715/1715；
  release/no-default/trace/diff 门通过。Chrome 与 Obscura 同代理仍未到真实 404。

### 阶段 79：最新 release 验收

- 最新 release 无注入访问目标仍为 `Verification successful` 后的 `Enable JavaScript and cookies to continue`，
  Ray `a34c08cb4c6f3bfd`；真实 404 尚未出现，继续保持未完成判定。

### 阶段 80：最终 release 复测

- 刚重建 release 无注入访问目标仍回到 Cloudflare challenge（Ray `a34c15e86c838ace`），未取得真实 404。

### 阶段 81：最终 release 真实-IP 点击链

- 标准 probe 点击后 frame `/fo`、Brunhild `/i 204`、PAT、proof/top 与新 ray 均出现，页面仍 challenge，未取得真实 404。

### 阶段 82：Chrome 149 payload 对拍与 V8 trace

- `assets/payload/1..3.json` 的属性桶确认在 `1.gsLi5`；enum 工具已支持混淆桶名，并排除
  `document.all`/`undefined`/`event` 的标准 `typeof undefined` 特例。
- 对拍初次发现的 `navigator.modelContext`、`ModelContext`、`WebMCPEvent`、`document.designMode` 已补齐；
  navigator 81/81、document 295/295、screen 15/15、orientation 9/9、window 1238/1238 无真实缺失。
- 最新 release + 192.168.3.57:9000 + 远程 Reqable CA 的 full V8 trace 为 1,587,025 条；`console` 只读到属性，
  未发现实际 `console.log` 调用。真实目标仍 challenge，未取得 404。

### 阶段 84：三份 Chrome payload 结构对比

- payload-1 为 `chl_api_m` 渲染提交；payload-2/3 的 `1.gsLi5` 均为 62 桶，属性路径集合完全一致。
- 2→3 仅出现 proof 阶段计数/长度与 token/timestamp 变化，没有新的属性集合差异。

### 阶段 83：payload 驱动 surfaces 与 link DOM

- `assets/payload/2..3.json` 的 `1.gsLi5` 路径面已全部对拍：n=81、d=295、s=15、so=9、bare=1238，缺失为 0。
- 补齐 Chrome 149 payload 暴露的 `modelContext`/`ModelContext`/`WebMCPEvent`/`designMode`；`HTMLLinkElement`
  独立原型、URL/媒体反射和 DOM wrapper 内部字段反射隐藏已完成。
- 最终 workspace `1717/1717 passed, 5 skipped`，release/no-default/trace/diff 门通过；full trace 1,587,025 条，
  payload 仅读取裸 `console`，未调用 `console.log`。真实 404 仍未取得。

### 阶段 85：Client-Hints 重复头与最新真实轮

- 修复 stealth `wreq` 的 Client-Hints append 重复。显式 fingerprint、CDP extra headers 与 `Accept-CH`
  追加现在按同名字段去重；原始 HTTP fixture 回归 3/3 通过，platform/full-version/arch/bitness 使用带双引号
  值，mobile 保持 `?0/?1`。
- 使用 `/123.txt` 参考 profile（Chromium + Not)A;Brand、`149.0.7827.0`、`zh-CN,zh`、arm/64、6/16）
  真实复测。payload 已反映配置，top/frame `/fo`、PAT、proof/top 与 Brunhild `/i` 均可见，但最终仍为
  `Enable JavaScript and cookies to continue`，无真实 `/1.txt` 404；未添加目标域名特判。

### 阶段 86：HTTP/2 Client-Hints wire 去重

- 保留 wreq emulation 的 TLS/HTTP2 指纹，关闭其默认 headers，改由 Obscura 单点生成浏览器请求头。
- `extra_headers` 与 request headers 按大小写不敏感归一化，请求级值覆盖 extra；HTTP/2 `httpbin.org/headers`
  实测 `Sec-Ch-Ua`、`Sec-Ch-Ua-Mobile`、`Sec-Ch-Ua-Platform` 各只有一条，双引号和值正确。

### 阶段 87：跨 frame 点击坐标与真实 proof 轮

- frame 输入事件保留 local `clientX/Y`，`screenX/Y` 改用页面坐标；CDP iframe 回归通过。
- 多段 mouseMoved 轨迹加点击可触发 frame proof `/fo` 和 PAT；最新轮仍无顶层 proof/404，challenge 继续
  作为未完成状态，不加入域名特判。

### 阶段 89：CDP click PointerEvent 语义

- 物理 `Input.dispatchMouseEvent` 的 `click` 现在使用完整 `PointerEvent`，填充 pointerId/type、isPrimary、
  角度、压力、tilt/twist 和正确的 frame/page 坐标。
- 完整 `input_mouse_event_parity` release nextest `19/19 passed`；真实轮在正确 input 命中后产生 frame proof
  与顶层转发，但 Cloudflare clearance 仍未给出 `/1.txt` 真实 404。

### 阶段 88：closed-shadow widget 命中链

- 证实固定 `(214,335)` 在不同 ray 会落到 frame body；等待 child frame 后按当前 300×65 容器计算
  `(20,31)`，命中 `frame-page-1-1` node=453。
- 修复后的真实轮产生 frame `/fo`、PAT、约 5.1KB proof frame 与约 3.2KB 顶层转发；body target 和
  `-9,-20.5` 坐标不再作为当前点击输入，最终仍未获得 `/1.txt` 404。

### 阶段 90：组合 CA 与 Chrome click payload 对齐

- wreq 自定义 CA 现在与系统公网 roots 合并，旁路直连 `brunhild` 从 TLS `CERTIFICATE_VERIFY_FAILED`
  恢复为 `/i` `204`，不再因 Reqable CA 覆盖系统 roots。
- 新增独立 `HTMLBodyElement` brand；使用 Chrome payload-3 的 frame-local `(29,28)` 点击后，
  `client/offset/pointer` 字段与 Chrome 对齐，目标为 `[object HTMLInputElement]`。
- 真实链完整出现 frame proof、Brunhild `204`、PAT `401`、第二个 frame proof 和 top proof，但页面仍
  未返回真实 `1.txt` `404`；当前状态继续限定为 Cloudflare clearance 判定，未加入域名特判。

### 阶段 91：closed-shadow label sibling activation

- debug hit-test 证实 `span[aria-hidden]` 的 composed parent 是 `label`，实际 input 位于 sibling 链，
  不在 label 的普通 children/querySelector 结果中；新增通用 sibling labelable 控件解析。
- 最新 release 轮 click target 已稳定为 `[object HTMLInputElement]`，Chrome payload-3 坐标与 pointer
  字段对齐，frame proof、Brunhild `204`、PAT、top proof 链完整；Cloudflare 仍未返回真实 `404`。

### 阶段 92：pointerId 激活周期与真实代理 Cookie 闭环

- 修复首次 `mouseMoved` 预先分配 pointerId 后，`mousePressed` 错误递增为 2 的问题；首次 hover/press
  共享 ID=1，释放后下一次按下才递增。pointerId 专项回归通过。
- 使用 `http://192.168.3.57:9000` 统一访问所有挑战主机，确认 `cf_clearance` 写入 CookieJar，后续
  `/1.txt` 导航携带 `cf_clearance` 与 `cf_chl_rc_ni`；PAT 仍为 401，与 Chrome 参考一致。
- Chrome payload-3 的 `(29,28)` frame-local 点击已对齐，click `isPrimary=false` 实验仍在
  `interactiveEnd -> fail 600010`，未取得真实 `1.txt` 404。临时 payload/事件响应探针已清理。

### 阶段 93：事件 layer/offset 对拍与 V8 lookup trace

- `MouseEvent.layerX/Y` 与 `offsetX/Y` 不再共享同一浮点值：layer 使用 floor，offset 使用四舍五入；
  Chrome payload-3 的 `(20,7)/(20,8)` 已与 Obscura 一致，click metadata focused 测试通过。
- V8 property-lookup trace（`--trace-property-lookup`，未启用高开销全量 call trace）确认 widget
  读取的 `eventPhase/isPrimary/pointerId/pressure/geometry` 均有对应 getter 命中，没有新的事件 API 缺失。
- 以 `--fingerprint` 固定 Chrome payload 的两品牌、149.0.7827.0、arm/64、macOS 26.4.0、硬件 `6/16`
  复测，仍是 frame proof、PAT 401、top proof 后换 ray，未返回真实 404。
- 导航 `Accept-Encoding` 顺序改为 `gzip, deflate, br, zstd`；httpbin 验证三个 `Sec-Ch-Ua*` 头单条且引号正确。
- 本机 Chrome 152 使用同一代理和 `(29,28)` CDP 点击，35 秒内同样只到 `interactiveBegin`，没有
  `interactiveEnd` 或真实 `/1.txt` 响应；说明当前远端代理/Cloudflare 会话状态本身会阻塞 404 验收。

### 阶段 94：Critical-CH UA 别名补齐

- 目标响应要求的 `UA-Full-Version-List` 现在映射到 fingerprint 的完整版本列表，与 `Sec-CH-UA-Full-Version-List`
  共用格式化和去重逻辑。
- wreq Critical-CH fixture 已覆盖该别名，断言重试请求包含 Chromium/Not)A;Brand 完整版本值；focused nextest 通过。
- 真实代理复测仍执行 frame proof/PAT/top proof 后换 ray，未取得真实 `1.txt` 404；Chrome 同代理对照也未通过。

### 阶段 95：iframe 窗口几何残差复核

- 当前 release fresh `gsLi5` 仍显示 widget realm 的 screen 原点与 inner viewport 为 0，outer/screen 为
  `1440/900`；Chrome payload-3 为原点 `22/51`、outer `1200x1120`、screen `1720x1284`。
- 该差异已确认仍存在，但窗口位置/显示器尺寸属于宿主事实，不能把一次 Chrome 常数硬编码进默认环境。
  后续应通过 CDP/window metrics 或显式 fingerprint schema 提供配置，并验证 screen/client 不变式。
- 本轮未新增站点特判；真实 challenge 仍在 proof 后换 ray，404 验收保持未完成。

### 阶段 96：可配置 iframe/窗口 screen metrics

- `ScreenFingerprint` 新增 `outerWidth`、`outerHeight`、`screenX`、`screenY`，缺省零值保持历史回退，
  显式 fingerprint 可传入真实宿主窗口 metrics。
- bootstrap 将 metrics 应用到主 realm 与 frame realm，并保持 `screenLeft/screenTop` 与原点一致；runtime
  fingerprint contract focused 测试通过。
- 该通用修复尚未改变 Cloudflare proof 后换 ray 的外部结果，真实 `1.txt` 404 仍未取得。

### 阶段 97：wreq Critical-CH 低熵头去重

- 修复 wreq 在 `Accept-CH/Critical-CH` 重试时重复追加已由 fingerprint 生成的
  `sec-ch-ua`、`sec-ch-ua-mobile`、`sec-ch-ua-platform`；独立 `ua` 别名仍正常发送。
- Critical-CH fixture 覆盖 `Sec-CH-UA` 与 `UA`，重试请求各一条；obscura-net release nextest `95/95` 通过。
- trace-patched release build 与 no-default check 通过；httpbin 经代理实测三个 `Sec-Ch-Ua*` 头各一条且双引号正确。
- 真实目标仍受上游条件限制：`brunhild.challenges.cloudflare.com` 经 `192.168.3.57:9000` 返回 `502`，
  `/1.txt` 尚未取得真实 `404`。完整 workspace nextest 本轮在既有 shadow-root 测试运行超过 5 分钟后中断，
  此前已完成的 960 个测试均通过。

### 阶段 98：跨源 iframe 初始 crossOriginIsolated 时序

- 对拍 `assets/payload/3.json` 发现 widget 早期 realm 的 `crossOriginIsolated` 应为 false；Chrome 最小跨源
  iframe 复现确认，即使子响应带 COOP/COEP，跨源子 frame 仍为 false。
- 修复 frame 响应和初始 `about:blank` 的隔离判定：网络子 frame 只有同源且父文档已隔离时才可为 true；初始
  iframe 使用实际 `parent_scope.cross_origin_isolated`，跨源 `src`、data/blob/opaque 目标不再泄漏顶层 true。
- `obscura-js` 初始 frame 回归、`obscura-browser` frame/CSP 回归均通过；最新目标 payload 的 widget 位由
  `T` 对齐为 `F`，frame proof/PAT/top proof 仍可执行。
- 真实 `/1.txt` 仍未取得 `404`，代理 `192.168.3.57:9000` 下 Brunhild proof 服务返回 `502`。

### 阶段 99：screen.availTop/availLeft 宿主指标

- `ScreenFingerprint` 新增可选 `availTop`/`availLeft`，Screen 原型通过 symbol slots 暴露，主 realm、frame
  realm 和 worker 共享同一值，默认仍为 0。
- runtime fingerprint contract 用 `availTop=30`、`availLeft=0` 回归通过；Screen 自有属性枚举面不变。
- 显式 Chrome 参考画像现在可同时对齐窗口尺寸、原点、工作区偏移和 DPR；真实目标仍因 Brunhild 代理 `502`
  未取得 `/1.txt` `404`。

### 阶段 100：初始 about:blank BackCompat 时序

- `create_blank_iframe_document` 不再把同步初始文档标成 `quirks=false`；无 doctype 的 `about:blank` 从插入
  时即暴露 `document.compatMode === "BackCompat"`。
- 新增同步回归 `initial_about_blank_iframe_is_back_compat_synchronously`，与跨源隔离/frame CSP 回归通过；
  最新目标 payload 的 `d.compatMode` 已从 `CSS1Compat` 对齐为 `BackCompat`。
- 真实目标 challenge 仍能执行 proof 链，但 Brunhild 代理 `502` 未改变，`/1.txt` 真实 `404` 尚未取得。

### 阶段 101：compatMode 修复后的真实点击验收

- 完整 Chrome 参考画像和原始代理下，CDP 物理点击仍可触发 frame proof `200` 与 PAT 请求；最新
  `crossOriginIsolated=F`、`compatMode=BackCompat`、`availTop=30` 均已进入 payload。
- Brunhild `/i` 仅记录 `op_fetch_url called`，没有完成响应；CDP 只收到初始 `/1.txt` `403`，没有二次
  `/1.txt` 请求或真实 `404`。外部 proof 服务路由仍是唯一未决条件。

### 阶段 102：widget 嵌套 srcdoc origin 测量边界

- CDP frame tree 确认网络 widget frame 为 `https://challenges.cloudflare.com`，其 closed-shadow 内嵌
  `about:srcdoc` 不能由普通 `querySelectorAll` 枚举；独立 frame context 的 origin/compatMode 读取为
  `null`/`BackCompat`。
- payload 中 `o.origin` 与 `d.compatMode` 来自多 realm、多时刻采集，不能直接归属到某一层 frame；未发现
  足够证据修改现有 sandbox/opaque-origin 规范语义。
- 真实 404 阻塞仍是 Brunhild proof 服务经代理 `502`，无新增代码改动。

### 阶段 103：wreq emulation 默认头去重

- 假设：`sec-ch-ua` 重复来自 wreq emulation 的默认头与 Obscura 显式头叠加。检查 wreq 源码确认
  `ClientBuilder::default_headers` 是合并操作，而 `RequestBuilder::header` 使用 append 语义；传入空
  `HeaderMap` 并不会清除 emulation 头。
- 修复：wreq 导航与脚本请求均调用 `default_headers(false)`，保留 TLS/HTTP2 emulation，只由
  `wreq_client.rs` 生成请求头；脚本请求补齐 `accept-encoding`。现有低熵 UA-CH、Critical-CH 和
  extra-header 去重回归通过（3/3 focused tests）。
- 真实验证：代理下 `/1.txt` 首次 403，chl_page/Turnstile/fo 均完成；物理点击后 proof `200` 并写入
  `cf_clearance`，随后页面仍因上游 challenge 会话换 ray，尚未获得真实 `/1.txt` 404。头部重复的代码侧
  根因已消除，剩余断点是 proof 后导航/代理条件，不加入站点特判。

### 阶段 104：frame 导航 Fetch Metadata profile

- 假设：Cloudflare proof 后仍换 ray 的代码侧残差之一是网络 iframe 导航被当作顶层 document 请求；当前
  `ResourceRequest::navigation()` 没有 initiator，导致 `Sec-Fetch-Site: none`，`destination()` 固定为
  `document`，并无条件发送 `Sec-Fetch-User: ?1`。
- 方法：对照 HaHaVM-General `envFunc.js` 的 iframe loader（`sec-fetch-site`、`sec-fetch-dest: iframe`、
  无 `sec-fetch-user`），为 Obscura 增加仅供 frame 导航使用的 request profile，保持顶层导航的既有头部。
- 当前结论：尚未修改代码；下一步实现 frame API 并用受控请求 fixture 断言三项 Fetch Metadata，再重新跑
  `/1.txt` 物理点击观察 Brunhild/proof 链。

### 阶段 105：stealth frame 导航传输

- 修复：新增 `fetch_frame_document_with_method_referrer_headers` 与 wreq 对应的 GET frame API；frame
  导航携带父文档 initiator、`Sec-Fetch-Dest: iframe`，并跳过 `Sec-Fetch-User`。stealth 模式下 GET
  网络 frame 现在和其脚本共用 wreq TLS/HTTP2 指纹及 cookie jar，POST frame 保留 reqwest 路径。
- 回归：`obscura-net::frame_navigation_uses_iframe_fetch_metadata`、obscura-browser 6 项 frame
  navigation 测试全部通过。
- 待验证：需重新构建 CLI 并对 `/1.txt` 观察 Brunhild 请求是否从挂起进入明确响应；若仍为代理 `502`，
  该外部条件仍不能通过代码规避。

### 阶段 106：frame profile 真实站复测

- release CLI 已按 trace-patched V8 重新构建；`/1.txt` 物理点击后仍能完成 frame/top `fo`（均 `200`，
  目标站下发 `cf_clearance`），但 PAT 仍为 `401`，Brunhild `/i` 经指定代理无完成响应，页面继续换 ray。
- frame 导航改走 wreq 后未改变代理侧失败，说明该代码侧残差已修复但当前外部 proof 服务仍未恢复；没有证据
  可以在不伪造响应或加入 hostname 特判的前提下生成真实 `404`。

### 阶段 107：frame profile 回归完成

- `obscura-net` release nextest 现为 `96/96`，新增 frame metadata 测试通过；trace-patched CLI release
  已重新构建。
- 同代理复测仍为 frame/top `fo=200`、PAT `401`、Brunhild `/i` 无完成响应并换 ray。该结果确认新
  frame 传输路径没有引入回归，但真实 `1.txt` `404` 仍取决于代理能否连通 Brunhild。

### 阶段 108：stealth frame 头部回归

- 新增 wreq stealth frame fixture，确认实际 wreq wire 请求为 `Sec-Fetch-Dest: iframe` 且没有
  `Sec-Fetch-User`；测试通过。
- frame 导航相关网络测试现覆盖 reqwest 与 wreq 两条传输路径；未发现新的代码侧重复头或顶层头泄漏。

### 阶段 109：frame stealth 传输构建验证

- 新增的 wreq frame 回归通过；trace-patched release CLI 已重新构建，`vendor/v8-trace.sh check` 与
  `git diff --check` 通过。
- 真实页面复测仍观察到 frame/top `fo=200`、PAT `401`，Brunhild `/i` 在代理侧无完成响应；因此目标
  `/1.txt` 仍未得到真实 `404`，外部代理条件尚未改变。

### 阶段 110：代理协议路径复核

- 对同一 Brunhild `/i` 端点分别使用代理 HTTP/1.1 与 HTTP/2 请求，均由 mitmproxy `9.0.1` 返回
  `502 Bad Gateway`；目标站 `/1.txt` 同一代理仍返回 Cloudflare `403` challenge。
- 结论：阻断不是 Obscura 的 HTTP/2 header 序列或 wreq/reqwest 分支选择造成；当前没有新的代码侧
  可验证路径能生成真实 `404`，需代理上游恢复或更换可访问 Brunhild 的出口。

### 阶段 111：PAT origin 诊断

- 假设：PAT 的 `401` 可能来自 `op_fetch_url` 在顶层 `root=0` 请求中携带了错误的 realm origin；现有日志
  只记录 URL/root，没有记录传入的 `origin` 与 fetch mode，无法区分调用侧丢失和传输侧重写。
- 方法：扩展现有 debug 行，记录 `origin`、`mode`、`credentials`，不改变请求行为；使用同一代理和 trace-patched
  CLI 复测 PAT 请求，再决定是否需要修复 origin 传播。
- 证据：顶层 `location.href/document.URL/location.origin` 仍为 `https://www.thelancet.com/1.txt`；初始
  `chl_page`/API/顶层 `fo` 的 `root=0, origin=https://www.thelancet.com`，frame `fo` 为
  `root=74, origin=https://challenges.cloudflare.com`。PAT 与 Brunhild 请求为 `root=0,
  origin=https://challenges.cloudflare.com`，说明该 origin 由 challenge 调用链显式落入顶层 op，不能仅凭
  `location` 读数判定为 runtime 覆盖。
- 结论：当前没有足够证据修改 realm origin 传播；PAT 仍返回 `401`，Brunhild 仍受代理 `502` 阻断。

### 阶段 112：PAT worker origin 归因

- 进一步 debug 显示初始 top `chl_page`/API/fo 为 `root=0, origin=https://www.thelancet.com`，frame fo
  为 `root=74, origin=https://challenges.cloudflare.com`；PAT 与 Brunhild 为 `root=0,
  origin=https://challenges.cloudflare.com`，但此时它们来自无 DOM 的 challenge worker，worker 使用
  `root=0` 是既有约定，不能据此修改顶层 realm。
- 独立 CDP 读取同一轮顶层 `location.href`、`document.URL`、`location.origin` 均保持 `www.thelancet.com`。
  `cargo check -p obscura-js -p obscura-cli --no-default-features --config vendor/v8-source.toml` 通过。

### 阶段 113：目标重新唤醒后的 blocked audit

- 新一轮代理复核仍为 Brunhild `/i` `502`、目标 `/1.txt` `403`；当前 proxy 状态没有恢复。
- 使用当前服务和 `assets/payload/2.json`、`assets/payload/3.json` 做属性枚举：Chrome payload 引用的
  navigator/document/screen/orientation/window 属性均已存在（允许的 `document.all`/legacy undefined
  除外），未发现新的可直接修复缺失集合。
- 结论：本轮没有新增代码修改；保留目标为 active，等待后续 blocked audit 轮次或代理外部状态变化。

### 阶段 114：blocked audit 第二轮

- 重新检查代理后 Brunhild `/i` 仍为 `502`，目标 `/1.txt` 仍为 Cloudflare `403`；状态与上一轮一致。
- 对照 HaHaVM-General 的 iframe/CSP 代码未发现新的、可由当前 challenge 证据支持的环境缺口；当前
  frame 请求 profile、stealth 传输、CSP、realm 与 worker origin 均已有回归覆盖。
- 结论：本轮无安全的代码侧修复可继续推进，目标保持 active，待下一轮外部状态变化或达到 blocked audit
  阈值后处理。

### 阶段 115：blocked audit 第三轮

- 代理复核仍为 Brunhild `/i` `502`，目标 `/1.txt` `403` challenge；HTTP/1.1、HTTP/2 和 Obscura
  wreq 路径此前均已得到相同结果。
- 当前工作树的 trace-patched 二进制、`git diff --check` 和 V8 patch 检查通过；没有新的代码侧证据
  能绕过上游 Brunhild 连接失败。
- 结论：同一外部阻断已连续三轮复现，目标进入 blocked 状态。代理恢复后从物理点击复测，验收仍要求
  第二次 `/1.txt` 导航返回真实 `404`。

### 阶段 186：iframe 404 验收审计

- HaHaVM-General 的 iframe 资源由宿主 `loadResource(..., { type: "iframe" })` 处理，并为每个 iframe 建立独立 realm；Obscura 已具备独立 frame realm、frame-local CSP/origin/sandbox 和 worker creator CSP 传播。
- Obscura 网络客户端会保留非 2xx response body，顶层导航也会解析并记录 404；frame 导航当前只写入 performance timing，未将 response status/body 写入 Page.network_events。
- 下一步补充带 frame identity 的 Network event 和本地 top-200 + iframe-404 fixture，验证文档树、DocumentScope、CDP status/body 与真实错误页面内容。

### 阶段 186 续：frame network event 与 meta CSP

- `NetworkEvent` 增加可选 `frame_id`；frame 导航现在保留真实 response status/headers/body，并由 CDP 按 child frame 的 loader/frame id 发射，不再冒充顶层请求。
- 新增本地 HTTP fixture：顶层 200 页面嵌入 `/missing`，子文档返回 `404 Not Found`、真实 HTML body、response CSP 和 meta CSP；断言 `contentDocument.URL/title/body`、合并后的 scope CSP、network status/body 和请求顺序均通过。
- 顶层 HTTP 404 fixture 同样通过，证明 `Page.navigate` 对非 2xx 仍提交真实文档并保存 body。
- 补齐主文档和 frame 的 `meta http-equiv=Content-Security-Policy` 解析；多个 meta 与 response header 的源列表按限制交集合并。
- 验证：iframe/top 404 focused `2/2`，meta-CSP frame focused `1/1`，CDP child-frame network attribution focused `1/1`，obscura-browser/obscura-cdp 编译与 focused event test 通过；完整 workspace 串行门禁 `1737/1737 passed, 4 skipped`。真实 Cloudflare 404 仍受 Brunhild 外部连接条件阻断。
- 继续补齐 CDP `Page.navigate(frameId)` 路径：直接子 frame 导航现在发出 `Network.requestWillBeSent`、`Network.responseReceived`、`Network.loadingFinished` 和真实 response body；现有 `navigate_with_frame_id_navigates_a_single_frame` 已扩展 404 + `Network.getResponseBody` 断言并通过。
- 最新提交 `b31c979` 已包含该 CDP 路径；其后串行全量 nextest `1738/1738 passed, 4 skipped`，release build、no-default-features check、V8 trace capability check 均通过。真实 Cloudflare `/1.txt` 仍只能在 Brunhild 上游可达后复验。
- `df7ce4a` 进一步给 frame 外部脚本和 stylesheet network event 标记所属 frame；相关 frame script/style/404 focused 均通过。最新串行全量 nextest 仍为 `1738/1738 passed, 4 skipped`，release、no-default、trace check 全部通过。
- 2026-09-05 复核：当前系统代理关闭，直接请求目标 `/1.txt` 仍为 Cloudflare `403`、`cf-mitigated: challenge`；未观察到 Brunhild 请求完成或真实 404。没有新的代码侧差异可安全归因，阶段 186 仅保留真实站验收项未完成。
- 新增 `be63ca2`：meta CSP `sandbox` 在 frame 文档解析后会真正合并到 sandbox/origin，缺少 `allow-same-origin` 时使用 opaque origin 并关闭 cross-origin isolation；meta sandbox focused 通过。最新全量串行 nextest `1739/1739 passed, 4 skipped`，release/no-default/trace 门禁通过。
- 当前继续审计确认 meta sandbox 的 frame security context 已有独立回归；真实目标复核仍为 Cloudflare challenge，未出现 Brunhild 完成响应或 `/1.txt` 404。阶段 186 保持 in_progress，不将外部 challenge 文案视为成功。
- `44fe5b6` 将动态 script 与 inline-handler sink 接入 frame sandbox `allowScripts` gate，防止 preload 在 sandbox frame 中重新插入可执行代码；sandbox focused 通过。最新 full nextest `1739/1739 passed, 4 skipped`，release/no-default/trace smoke（86 records）通过。

### 阶段 188：reload API JS 复核

- `cdp_comm_probe` 记录 widget 发送 `reloadApiJsRequest` 后收到 `reloadApiJsRejected`，随后才发送
  `interactiveBegin`；点击后 proof `/fo` 与二次导航仍发生，但最终回到 challenge。
- 当前 ResourceTiming 对无 TAO 的跨源 API JS 隐藏 `nextHopProtocol` 和阶段字段，符合浏览器规则，
  不能仅凭空字段修改。暂无 Chrome 同请求对照支持 timing/reload 行为修复，目标仍未到达 404。

### 阶段 189：当前代理复测

- 使用 `e5a7c28` release 和真实点击流程复测：blob creator `Referer` 已稳定发送为
  `https://challenges.cloudflare.com/`；Turnstile frame `/fo` 返回 200，随后 brunhild `/i`
  仍返回 401，页面保持 `Performing security verification`/challenge，未出现 404。
- 点击后 host-op trace 能看到 proof `/fo`、`/i`、后续 `/fo` 和顶层重导航；native API trace
  对这些直达 `op_fetch_url` 请求不记录属于设计行为，能力由 `--trace-op-file` 覆盖。
- 使用同一会话 URL、同一代理、相同 Origin/Referer/Chrome UA 直接 curl 重放 brunhild `/i`，
  得到 `HTTP/2 502`（mitmproxy `connection closed`）。该结果独立复现代理上游失败，当前
  401/502 不是可由 Obscura 属性或方法修复的证据。

### 阶段 190：忽略 brunhild 背景请求后的判据

- 按用户说明，不再把 brunhild `/i` 的 401/502 作为失败判据。
- 当前交互复测中，点击后 proof `/fo` 返回 200，并触发顶层 `Page.navigate`；日志只到
  `INTERCEPTION navigate`，未出现顶层最终响应或真实 404。下一观测目标是顶层 proof 成功
  后的导航请求/响应，而非 brunhild 背景请求。

### 阶段 191：顶层导航 URL 观测

- 新提交 `eccd152` 让 CDP interception 日志记录导航 URL。
- 交互复测确认 proof 后第二次导航的 URL 仍为 `https://www.thelancet.com/1.txt`，不是隐藏的
  404 URL 或其他错误地址；当前代理会话随后继续进入 challenge，未产生顶层 404 响应。

### 阶段 192：CDP 注入栈泄漏修复

- payload 栈明确泄漏 `<cdp-input>`，属于环境伪造差异。扩展 bootstrap/native prepare-stack 过滤，
  覆盖所有 realm 的预格式化 Error.stack 字符串。
- 提交 `4486704` 增加脚本名过滤和 focused 回归；提交 `1c7d834` 增加 native 返回字符串的最终
  过滤，focused nextest 通过。
- release smoke 点击后 payload 中 `<cdp-input>` 泄漏数降为 0；proof 后仍触发 `/1.txt` 二次导航，
  但未出现最终 404。native trace 能力保持可用。

### 阶段 193：环境伪造复测

- 按用户说明忽略 brunhild `/i` 状态；proof `/fo` 仍返回 200，二次顶层导航 URL 保持
  `https://www.thelancet.com/1.txt`，但页面继续 challenge。
- `1c7d834` 后真实 payload 中 `<cdp-input>` 泄漏为 0，确认 native prepare-stack 过滤覆盖
  widget realm 的预格式化 Error.stack。当前未出现新的环境字段差异或 404 响应。

### 阶段 194：console payload native trace

- 结论：原有 `--trace-api-file` 不能捕获 `console.log` 的参数；`console.log` 是 bootstrap JS
  包装，最终进入 `op_console_msg`，且原有 `--trace-op-file` 未记录该 op。
- 提交 `dce41f9`：`op_console_msg` 接入 host-op trace，完整保留 console 字符串，不走普通
  host-op 的 2048 字符截断。因此 `payloadJSON` 可从 trace 文件直接恢复。
- release smoke 解析结果：live payload-1 为 47 键，与 `assets/payload/1.json` 同键同类型；
  live payload-2 为 92 键、39 个数字分片，与 `assets/payload/2.json` 结构和类型一致，数字
  分片数量属于挑战动态波动。

### 阶段 187：blob referrer 与交互复测

- `e5a7c28` 修复 blob 文档 referrer：`blob:https://challenges.cloudflare.com/...` 现在发送
  `Referer: https://challenges.cloudflare.com/`；obscura-net 全量 `100/100` 通过。
- 真实交互复测确认 `/i` 401 已越过：点击后 proof `/fo` 返回 200（约 846 KB），并触发新的
  顶层导航；页面仍回到 challenge，尚未得到最终 404。
- debug hit-test 命中 `frame-page-1-1`, node 452，press/release 使用同一 frame/generation；
  payload 已包含 click、坐标、checked 和 proof 数据。事件探针只在 isolated/default realm
  监听，frame 命中为 0 不能证明事件未到达。当前未发现新的可安全归因的 DOM/API 缺口。

### 阶段 195：字节码属性探针 (2026-09-06)

- 续跑阶段196已开始：当前二进制 trace check 通过；指定代理实际请求和 console payload 采集完成，仍为 challenge。Chrome 本地 oracle 确认初始 about:blank 三项继承错误，已添加失败回归，等待 focused 编译结果。
- 阶段196修复验证：focused13/13；workspace首次1751/1752，MCP selector单独复跑通过，双槽全量1752/1752、4 skipped；精确release和trace check通过。三轮payload全部确认origin/domain/referrer迁移；aligned无preload点击后Document仍403→403，未取得404。
- companion已恢复可用并实跑31/33，IntersectionObserver及Win32固定期望两项均在修复前二进制复现。性能交错各6轮wall中位0.49→0.495秒，RSS范围重叠。待提交继承修复；下一项descriptor问题已保存oracle证据。
- 继承修复已提交 aad1e58；目标继续保持active，下一项为Document/ShadowRoot adoptedStyleSheets描述符。
- Step223只修改Document的enumerable/configurable（ShadowRoot实际已正确）；adoption focused3/3通过，本地trace属性读取和descriptor对照通过。首轮aligned payload路径1645→1646，d.adoptedStyleSheets恢复空字符串桶，对旧参考差12→11，仍未取得404。
- Step223最终workspace1752/1752、4 skipped；精确release与trace check通过。三轮aligned payload均为1646路径、11差；无preload点击后顶层403→403。最终obstacle31/33，失败项与旧版和Chrome oracle一致。下一步需要完整payload行为差分，不能把8项Chrome152也存在的全局API直接删除。
- Step223已提交d7378e7。最终binary额外固定10秒点击轮截图仍为Verifying，不能计作有效点击；临时CDP探针改为读取widget isolated-world文本，确认Verify you are human再点击，避免时机误判。
- Step224：固定私网拒绝端口 Chrome oracle/规范预期为TypeError/Failed to fetch；Obscura修复transport op异常归一化为同样的TypeError。focused `scripted_fetch_transport_failure_is_a_type_error` 通过，待release重建、提交和真实payload A/B。
- Step224真实A/B：重建release后指定代理仍`tQcZu4=fetch_error`，Brunhild GET无completion日志且页面超时分支先完成；保留原始错误分类，不伪造timeout。修复已提交d9f5000，workspace门禁待完成。
- Step225：本地延迟响应+AbortController Chrome oracle确认 fetch signal 需在响应前拒绝；实现 Promise.race 与 abort listener cleanup，默认 reason 改为 Chrome 文案。focused transport/abort 2/2 通过，尚未提交和跑完整门禁。
- Step225完成：提交c24378a；workspace1754/1754、4 skipped，release与trace check通过。指定代理新鲜轮仍tQcZu4=fetch_error，Brunhild GET保持pending，页面超时先结束，AbortSignal修复未改变challenge字段或最终403状态。
- Step226：XHR timeout/abort 现在创建并取消底层 AbortController；延迟响应 focused 3/3通过（transport、fetch signal、XHR timeout）。待提交、完整workspace和代理A/B。
- Step226完成：提交14cdec8；workspace1755/1755、4 skipped，release和trace check通过。指定代理新轮仍tQcZu4=fetch_error，Brunhild GET无completion，页面超时先结束，目标仍403 challenge。
- Step227：serve+cdp_comm_probe全realm观测到widget XHR/fetch（t0.75s、5.86s）、interactiveBegin（8.87s）、点击后proof/top新ray链；Brunhild只在direct op_fetch_url日志出现且无completion。排除XHR timeout根因，下一步转向direct op请求头/取消时序HAR对拍。
- Step228：Chrome历史headful click HAR中Brunhild曾返回204；当前指定代理对同类URL直接curl返回HTTP/2 502（mitmproxy），Obscura日志表现为pending且无completion。确认外部proof路由状态，禁止hostname特判/伪造响应。
- Step229：真实Cloudflare frame isolation读数为true/function，Obscura为false/undefined；本地HTTPS双端口top/child均COOP+COEP（child CORP）Chrome child仍false/undefined。证据不足以放宽frame同源规则，继续跨站fixture归因。
- Step230：Chrome CDP Network.requestWillBeSent 点击轮本次未产生Brunhild事件，证明当前代理/挑战状态波动；不把无事件当作请求头差异证据。此前Chrome历史HAR的Brunhild 204与当前代理直接502仍分别保留。
- Step231：最新release指定代理无注入轮取得2个payload；Brunhild GET无completion，PAT401、/fo链存在，tQcZu4仍fetch_error，目标403。与Step227/228一致，外部路由阻断持续，未加入伪造响应。
- Step232：Chrome CDP ExtraInfo对拍可控Brunhild fetch，Origin/Referer/Sec-Fetch/UA-CH均存在；Obscura stealth_fetch_all对应生成。Chrome实际152与显式UA149混用，视为基线差异，不修改header。
- Step233：Chrome frame owner有allow="cross-origin-isolated; fullscreen; autoplay"；Obscura FrameNavigationRequest未保存allow。已接入allow委托与isolation条件，保持无allow跨源false；browser focused helper/分支通过，待提交、全量和真实payload。
- Step233完成：提交31f82fc；workspace1755/1755、release和trace check通过。真实点击后crossOriginIsolated/SharedArrayBuffer差异消失，payload路径1646→1647，proof/fo 200；页面等待Brunhild，目标仍无404。
- Step234：补充iframe allow origin-list（裸src、*、'src'、'self'、显式origin、父策略deny）解析；focused与完整workspace1755/1755、release/trace通过。真实payload isolation保持对齐，目标仍403；obstacle仍31/33既有fixture失败。
- Step235：最终release条件点击轮确认owner allow传播后frame isolation/SharedArrayBuffer差异归零，payload路径1647，proof/fo 200与top new-ray链完整；Brunhild direct op无completion，目标未404。代码无新改动。
- Step236：Chrome frame `navigator.cpuPerformance` 为number/in prototype且payload值4，top realm缺失；Obscura此前缺失。已按isolated frame和hardwareConcurrency安装getter，focused1/1通过，待提交/完整门禁/真实payload。
- Step236完成：提交fb217c0；workspace1756/1756、4 skipped，release/trace通过。指定代理同UA/viewport/hardware payload中cpuPerformance差异归零，路径1647→1648，tQcZu4仍fetch_error。
- Step237：最新release两payload与direct op Brunhild pending、PAT401、/fo200/new-ray链一致，目标仍403，无404；剩余动态URL/时间和三个版本接口不据旧样本修改。
- Step238：Chrome第三payload事件trace含focus/input/blur，Obscura缺失；两边pointer/mouse/click顺序、trusted、frame-local坐标(21,31)一致，gIBpo1两项计数各少1。已补focus/blur trusted composed和checkable input/change composed，CDP input focused8/8通过，待提交/完整门禁/新payload。
- c24378a 后最终 obstacle course 仍为 31/33；失败仍是 fixture 预期不匹配的 IntersectionObserver 与 Win32 平台指纹，不是 AbortSignal 回归。当前工作树代码干净，未提交规划文件保持为本地记录。
- 额外readiness探针的isolated-world读取连续返回空，未执行点击；该轮只证明最终仍为challenge，不能证明交互链失败。后续需记录完整Runtime.evaluate响应并校验frame/context归属，避免把读取盲区当引擎缺陷。此前截图确认复选框后的有效点击轮403→403仍保留。

- author-script data URL 复现普通对象 HIT/MISS，每次冷读取重复两条；不能再用被过滤的 `<eval>` 零记录判定 IC 路径不生效。
- 直接编辑 V8 bytecode-array-builder 与 runtime helper，移除 AccessorAssembler/IC 重复探针；关闭时不生成属性探针字节码。
- GET/SET/HAS 共用 side-effect-free lookup；Proxy/interceptor/access check 与 object-key coercion 标 UNKNOWN。
- 新增 CLI 端到端测试，覆盖 hot/cold 计数、数组空洞/越界、getter/setter、Proxy、console 长字符串及文件名空格。
- source release 构建进行中。companion benchmark 默认路径不存在，历史记录亦注明该门无法运行。
- 构建前指定代理真实请求完成，console 恢复 47/91 键 payload。gsLi5 使用 path->Set(bucket) 合并且排除 o.*：参考 2/3 同侧零差，当前 77 差（新增55/参考独有3/变值19）；记录为未对齐样本，不等于77个引擎缺陷。
- Chrome headless oracle：EventTarget!==Node，Node.prototype 继承 EventTarget.prototype，Window 无 nodeType/appendChild；Obscura 旧二进制反例稳定复现。修复为独立 EventTarget 基类，Node/XHR 分别继承，保留事件 helper；新增 shape 回归。
- 文档归一到 docs/native-trace.md，明确 GET 不等于 CALL，已停用的 ignore/watch CLI 参数改为显式错误。
- 编译期间追加 ic.cc 字段分隔符转义与非法 in receiver 的 UNKNOWN 分类；首轮构建后必须再次增量构建再测试，避免测到早于本次追加的对象文件。
- 首轮 source release 完成（34m36s），最后的 ic.cc 自动重编译已进入库。新版二进制确认 EventTarget 独立、Window 无 Node 成员、new EventTarget own names 为空。
- Window 自身访问初测被 AccessCheck 分类为 UNKNOWN；按 V8 现有 LookupForRead 规则只跳过当前 realm 已连接的 global proxy check，外部 realm 仍 UNKNOWN，并新增 BOM MISS 断言。
- 首轮 CLI focused 4/4 通过，含强制 TurboFan 165 次计数与默认/no-use-ic/jitless 各4000次计数。追加 BOM MISS 后第二轮进行中。
- EventTarget 修复后真实 payload 移除全部47项额外全局 Node 属性，路径1690->1643，对参考差异77->30；仍为 challenge，未通过。
- 最终 CLI focused 4/4（含 BOM MISS）与 JS 事件/XHR/Window focused 67/67 通过。V8 提交 59ee73ae。
- 三轮 post-fix 实测均恢复47/91键payload，gsLi5均1643条路径、对参考30差、全局Node泄漏0；开始全量workspace门禁和完整属性trace实测。
- 完整trace实测500850条（HIT478381/MISS22439/UNKNOWN30；GET464576/SET35364/HAS33/GLOBAL877），坏TSV行0、internal行0。但触发同步V8 watchdog，payloadJSON=0；该轮不可用于payload对拍，未放宽watchdog。
- 阶段195完成：V8 `59ee73ae`、外层 `336a7b8`；workspace 1750/1750（4 skipped）、obscura-js focused 67/67、CLI focused 4/4、release/no-default/check 通过。最终 release smoke 的 HIT/MISS 与 `<eval>` 过滤回归通过。
- 追加清理提交 `9ea95aa` 删除 Rust descriptor monitor、`op_trace_object`、isolate state、worker/frame install 和 suppression guard；cleanup 后 obscura-js 67/67、CLI 4/4、当前源码 workspace 1750/1750（4 skipped）均通过，release/check smoke 仍通过。
## 2026-09-08：HaHaVM 风格 JS 结构重构启动

- 用户要求参考 HaHaVM 的“一文件一个对象”结构，评估并在可行时对当前 Obscura JS 做全量重构。
- 当前代码已存在 `js/bootstrap.js` manifest 和 `js/bootstrap/{config,tools,env}` 分层；`build.rs` 在构建期按清单拼接成单一 classic script，以满足 V8 snapshot 和跨 realm 复用。
- 下一步对比 HaHaVM 的 `src/frameworkCode.js`、`core/config/env.manifest.json` 与对象文件，盘点当前文件是否真正按对象边界组织，以及哪些共享词法状态阻止直接改成 ES module/独立闭包。

## 2026-09-08：对象级拆分与回归

- 保留 classic-script + manifest 拼接模型，按 HaHaVM 的对象文件方式拆出 89 个对象模块；新增对象覆盖 MessagePort/MessageChannel、Observable/Subscriber、DOM 节点层、DOMParser/XMLSerializer、Range/Selection、CSSOM、事件类、媒体类、WebRTC、WebGPU、Streams、自定义元素和键盘接口等。
- 共享 WeakMap、私有 symbol、解析器/调度 helper 保留在 support 模块；对象模块只包含对应构造器及其紧邻的 WebIDL descriptor/native 标记，避免 IIFE 改变全局 lexical binding 和 V8 snapshot 语义。
- 修正 CSS helper 原先错误地位于 `message-channel.js` 的跨能力依赖；现在 `_cssCamelToKebab`/`_cssKebabToCamel` 位于 `style-declaration.js`。
- focused release nextest：消息端口 6/6、Observable 1/1、DOM/节点 31/31、事件 9/9、CSS/Shadow 13/13、媒体 5/5、Streams 3/3、自定义元素/Shadow 3/3 均通过。
- `obscura-js` 全量 release nextest：490 tests run，485 passed，5 failed；失败为既有宿主字体/渲染差异（`frame_elements_report_their_own_document_geometry`、字体 source、canvas text metrics、subpixel rect、measureText），非本次对象拆分新增失败。需要继续执行 workspace 门禁并保留这些已知失败证据。
- workspace release render nextest：1762 tests run，1759 passed（1 leaky），3 failed：`autonomous_event_loop_delivers_timers_after_a_cancelled_navigation_poll` 单独复跑通过，`dynamic_import_map_uses_live_document_base_at_insertion` 仍因既有 import-map URL 解析得到 `%22/app/later.js` 失败，`obscura-cli::mcp_client::test_navigate_and_snapshot` 单独复跑通过。未观察到对象拆分相关的 snapshot/realm/DOM shape 回归。
- `cargo check -p obscura-js -p obscura-cli --no-default-features --config vendor/v8-source.toml` 通过；精确 release render build 通过；`vendor/v8-trace.sh check` 通过并确认 trace-capable release binary。
- 进一步清理跨文件闭包边界：`build.rs` 统一包裹 manifest，新增 `config/webidl-branding.js` 作为最后模块；`config/surface-finalize.js` 不再以 `})();` 开头或结尾。wrapper 变更后的 snapshot、focused WebIDL/window tests、release build、no-default check 和 trace check 均通过。最终 workspace 复跑为 1758/1762 passed、4 failed；其中 3 个失败单独复跑通过，持久失败仍是既有 dynamic import-map URL `%22/app/later.js` 问题。
- 逐文件语法审计暴露并修正 `element.js` 中段片段和 `media-source-worklet.js`/`trusted-types.js` 跨文件闭包；全部 bootstrap JS 独立 `node --check` 通过，custom-element/worklet/media/WebIDL focused 5/5通过，snapshot 重新生成通过。
- 最终门禁后重新执行精确 release render build、no-default-features check、`vendor/v8-trace.sh check` 和 `git diff --check`，全部通过；生成的 release binary 仍被识别为 trace-capable。

## 2026-09-08：全量 Window surface 分析

- 用户明确目标扩展为整个 Window 下的对象，而非仅 `Performance`。对比 HaHaVM 后确认：HaHaVM 的 env 文件负责 shape，`toolsFunc.dispatch`/`envFunc` 负责行为；Obscura 当前聚合文件的问题是职责混合，但其行为依赖 Rust op、V8 realm、WeakMap/private symbols、CSP/frame scope 和 native trace，不能直接套通用 Proxy/string dispatch。
- 可行的全量方向是继续采用“每个对象一个 shape 文件 + support/behavior 文件”的混合架构。现有对象拆分已经覆盖事件、DOM、CSSOM、媒体、WebGPU/WebRTC、Streams 等；剩余 Window surface 应继续按同一规则拆分，保留共享 bridge/state support，不引入 HaHaVM 的 runtime dispatch 热路径。
- 当前仅完成分析，未对 performance 或其他 Window surface 做新的代码改动。

## 2026-09-08：并发全量 Window surface 重构启动

- 用户要求开始实际重构，并发拆分事件/DOM、媒体/图形、Performance 三个独立领域。
- Agent 约束：只修改负责目录，不改 `bootstrap.js` manifest、`build.rs` 或规划文件；主线程统一收集新增 object/support 文件、维护顺序、跑验证。

## 2026-09-09：并发领域拆分完成首轮集成

- 事件/DOM agent：抽出 event state/listener/input-dispatch、DOM collection/window-named/range support；旧聚合入口改为兼容占位。focused event/DOM/shadow/collection/range 65/65通过。
- 媒体 agent：抽出 SpeechSynthesis/MediaStream behavior+shape、WebRTC state support、WebGPU collections/constants、Streams readable/writable/transform/text behavior；shape 文件通过 support 委托保留外部接口。
- Performance agent：拆出 clock、Performance shape、MemoryInfo、Timeline state、Entry/Mark/Measure/Resource/Navigation/Paint/Observer objects、user-timing 和 lifecycle hooks。
- 主线程接入 manifest 顺序，全部 bootstrap JS 独立 `node --check`，`cargo nextest list` snapshot smoke 通过。
- `obscura-js` release render 全量：`582 passed, 0 skipped`。这是首轮并发拆分后的领域级门禁证据，workspace 全量仍待继续执行。
- CDP iframe event focused：`3 passed, 0 skipped`。Performance agent 7 focused tests、event/DOM agent 65 focused tests均通过；媒体/Streams 相关行为已包含在 `obscura-js` 582/582 门禁中。
- 媒体 agent 后续补齐 input MediaCapabilities、Screen state、WebGL profile support；focused media/WebGPU/input/screen/Streams 6/6通过，全部新增 JS 语法检查通过。
- workspace render nextest：`1759 passed, 3 failed, 4 skipped`；失败为既有 dynamic import-map URL 问题和两个偶发 MCP client 测试，相关 MCP 测试此前单独复跑通过。

## 2026-09-09：并发重构最终交付

- 第二轮 manifest 集成后 workspace render nextest：`1761 passed, 1 failed, 4 skipped`；唯一失败为既有 `dynamic_import_map_uses_live_document_base_at_insertion` 的 `%22/app/later.js` URL 解析问题。
- 最终 release build、no-default-features check、`vendor/v8-trace.sh check`、全部 bootstrap JS `node --check` 和 `git diff --check` 均通过。
- 提交：`cb154f3 refactor: split window surface behavior modules`、`3f9d541 refactor: split remaining window surface objects`、`ff58454 build: wire split window surface modules`。

## 2026-09-09：HaHaVM 环境差异并发审计启动

- 启动 DOM/Events/CSS/Security 与 Media/Graphics 两个并发 agent；DOM agent 额外派生清单子 agent，因此当前并发槽已满，Window/Performance/Network agent 待槽位释放后启动。
- 筛选原则：HaHaVM 只作为候选来源，Chrome oracle/现有 shape tests 才是修复依据；不复制通用 Proxy/string dispatch、站点值或虚构硬件能力。

## 2026-09-09：HaHaVM 环境差异修复

- 三个 agent 完成 DOM/CSS、Media/Streams、Window/Performance/Navigator 分域审计；DOM agent 的 inventory 子 agent 完成静态差异清单。
- 新增/修复：TreeWalker、NodeIterator、StyleSheet、CanvasRenderingContext2D、MediaDevices、ReadableStream、MediaQueryList、Performance prototype、BatteryManager、draggable/spellcheck、WebGL2 drawingBufferFormat。
- 本机 Chrome headless 或既有 Chrome oracle为 shape/数值依据；新增 focused 8项与相关既有矩阵通过。
- 最终 `obscura-js` release render 全量：`590 passed, 0 skipped`。workspace/release/no-default/trace 最终门禁待执行。
- 第二批 HaHaVM/Chrome 差异 focused：MediaQueryList 3/3、Battery 1/1、draggable/spellcheck 1/1、WebGL drawingBufferFormat 回归 1/1、Traversal/CSS/Canvas/MediaDevices/Performance shape 全部通过；最终 `obscura-js` 全量更新为 `590/590`。
- workspace 最终复跑：`1767 passed, 3 failed, 4 skipped`；dynamic import-map 为持续已知失败，两个 MCP 测试单独复跑均通过。release build、no-default check、trace check、全 JS syntax/diff check 均通过。

## 2026-09-09：HaHaVM 对比修复交付

- 追加提交 `6848656 fix: align environment shapes with Chrome and HaHaVM`。
- 本轮完整 `obscura-js` release render：`590 passed, 0 skipped`；workspace：`1767 passed, 3 failed, 4 skipped`，失败为已知 dynamic-import-map 和并发 MCP 波动，MCP 单测复跑通过。
- 最终 release build、no-default-features check、`vendor/v8-trace.sh check`、全部 bootstrap JS syntax/diff check 通过。

## 2026-09-09：HaHaVM 全量 env/envFunc 对照矩阵启动

- 新目标转为完整矩阵审计：env 对象/原型属性集合、envFunc 行为键集合、Chrome oracle 行为对拍三条路径。
- 已启动三个并发 agent，分别负责静态 env 清单、envFunc 行为清单、Chrome oracle 候选；修复只接受通用证据，不复制 HaHaVM 的 Proxy/string dispatch 或站点化值。

## 2026-09-09：HaHaVM 全量 env/envFunc 对照完成

- HaHaVM env 清单：311 个文件；Obscura bootstrap：238 个当前 manifest 模块；Obscura surface table：1110 个接口条目。静态差异已分类为 singleton/重复 realm 文件、Chrome 不暴露接口、可验证缺口和无 oracle 候选。
- envFunc 全量解析：1548 个行为键，806 getter、194 setter、548 method，涉及 112 个接口对象；21 组无对应 behavior 的接口已分类，未盲目复制固定值或硬件行为。
- Chrome/HaHaVM 证据修复提交 `9004eec fix: complete HaHaVM environment shape audit`，新增/修复 BatteryManager、VirtualKeyboard、PerformanceTiming、MediaQueryList、WebGL2 drawingBufferFormat、TreeWalker/NodeIterator、StyleSheet、CanvasRenderingContext2D、MediaDevices、ReadableStream、draggable/spellcheck 等 shape/behavior。
- 全量 `obscura-js`：`590/590`；workspace：`1767 passed, 3 failed, 4 skipped`，失败为既有 dynamic-import-map URL 解析和并发 MCP 波动；MCP 单测单独复跑通过。相关 focused tests、release/no-default/trace 门禁通过。

## 2026-09-09：第二轮并发 Window surface 拆分

- 事件/DOM agent：拆出 geometry、HTML input/body/form/SVG shapes、permissions/view-transition、resize/intersection objects，并修复 Screen support 的 `_applyScreenSize` bridge alias；frame image focused 1/1通过。
- 媒体 agent：拆出 Canvas/TextMetrics/HTMLCanvasElement/WebAudio objects，WebGL profile support，媒体输入/Screen support；Canvas/TextMetrics/ImageData 5/5、Worklet/AudioContext 2/2、媒体/WebGPU/Screen 6/6通过。
- Performance agent：拆出 EventSource/WebSocket/BroadcastChannel/MediaQueryList 与 socket listener support；Broadcast focused 3/3通过。
- 主线程 manifest 已接入 231 个模块，全部 bootstrap JS 独立语法检查通过；Performance timeOrigin 单测、所有领域 focused 和 `obscura-js` 582/582通过。

## 会话：2026-09-10 HaHaVM-General trace 对照

- 已读取目标仓库 AGENTS/README，确认当前分支 `trace-method-calls`，保留其用户工作树改动。
- 已确认 HaHaVM trace 的核心入口是 `hahavm.toolsFunc.dispatch`，输出是带来源、参数、结果/异常和 miss 的 JSONL/内存记录。
- 下一步：运行 HaHaVM offline smoke，读取实现关键段；再与 Obscura V8 property/op/CALL trace 做契约和覆盖矩阵。

- 已完成双方静态实现对照：HaHaVM 是 `dispatch` 级统一调用记录；Obscura 是 V8 property、host-op、可选 CALL/RET 三条分层流。
- 已运行 HaHaVM `npm run smoke`（通过）和 `npm run trace`（通过，输出 3150 行，顶层 traceLog 受 2000 条环形上限约束）。
- 初步判断：当前 Obscura 足够做低侵入属性/宿主诊断，但若目标是 HaHaVM 的完整调用记录字段和 sink/file/filter 生命周期，需要增加独立 API-call trace 层，不能只扩展现有 native property TSV。
- 验证脚本第 1 次读取 `/tmp/hahavm-trace-small.jsonl` 时错误地将 `\\n` 作为分隔符，导致多行 JSONL 合并解析失败；trace 文件本身已成功生成，下一次改用实际换行分隔读取。
- Obscura 最小 trace 命令第 1 次包含 `rm -f`，被执行工具的安全策略拒绝；改用带 PID 的新临时路径，不删除既有文件。
- 修正后的 HaHaVM JSONL 小样本成功：6 条筛选记录，首条 `Navigator_userAgent_get` 含 `frame/src/args/result`，末条 `Element_getAttribute` 返回 `"1"`；`document.body.noSuchMethod()` 异常按预期抛出但不产生一条未路由 miss 记录。
- Obscura 最小 source-trace 生成 8 行 TSV（属性 HIT/MISS/GLOBAL）；op trace 生成 `dom`/`console.log` 记录，字段契约与 HaHaVM API-call JSONL 不同。
- Obscura 接入点审计完成：`_markNative` 仅做 native `toString` 伪装；Web API 没有统一 dispatch，直接移植 HaHaVM dispatch/Proxy 会影响真实 class、brand、snapshot/realm 和性能。
- 发现跨进程文件风险：`serve --workers` 转发同一 `OBSCURA_TRACE_API_FILE`，而 vendored V8 使用 `fopen(path, "w")`，存在 worker 互相截断 property trace 的风险；纳入改造清单。

- 阶段结论：Obscura 当前已经能提供低侵入的 V8 属性访问、宿主操作/console、部分 JS CALL/RET 三类诊断；但不等价于 HaHaVM 的统一 dispatch-level API-call trace。
- 若只需要定位属性命中/缺失、DOM/网络宿主调用和页面源位置，不需要重构；若要求 HaHaVM 的完整 `args/result/error/self/frame/src/miss` JSONL 契约，需要新增独立 API-call trace 层，保留现有 native property trace 作为另一条证据流。
- 工作树复核更正：最新 HaHaVM trace 当前只输出 `t/src/name/args/result`，点号调用名和 300 字节浅摘要；此前完整字段结论对应已被工作树覆盖的提交版本，不能作为当前分支能力描述。
- 最新工作树 `npm run trace` 再次通过（3146 行，traceLog 2000）；自定义 JSONL 记录键集合确认只有 `t/src/name/args/result`。
- 版本边界已核对：`HEAD=33f1ece` 仍包含完整 trace 实现，当前未提交工作树把 `core/tools/toolsFunc.js` 等文件改为轻量 trace；最终判断以用户要保留的版本为准，并明确标注二者差异。

## 2026-09-10：trace 阶段对拍继续

- 生成 `/tmp/trace_compare_20260910.json`，把 HaHaVM 成功轮的 forward/net 序列与 Obscura 正确 profile + Asia/Shanghai 轮的 `serve.log` 归一化。
- 公共请求阶段直到 target proof `/fo` 基本一致；HaHaVM 后续 GET `/123.txt` 返回 404，Obscura 后续导航重新进入 challenge。
- widget 初始 `/fo` 体积差异为 HaHaVM 约 822KB、Obscura 846KB，Chrome HAR 约 846KB，确认这是 challenge variant 差异，不能按 HaHaVM 字节数硬编码。
- 当前首次可定位分叉仍在 proof payload/会话判定；继续实现诊断轮的 JS API method trace，默认运行路径不启用。

## 2026-09-12：apiJsMismatch 结论更正 + 脚本属性面修复

### 一、`reloadApiJsRequest` 不是卡点（结论更正）

上一轮 Step 254 把 `reloadApiJsRequest` → `reloadApiJsRejected` 判为「参照侧从不发生、Obscura 每个 widget 都发生的唯一异常」。本轮用静态反混淆 + Chrome 参考 HAR 把这条线索关闭：

- widget 帧脚本（`assets/har/chrome-2-fo.har` entry 4）反混淆后，`reloadApiJsRequest` 的唯一发送点是消息处理器里 `extraParams` 分支的一次字符串比较：
  `VR.ch !== VT`（`VT = sQ`），且 `!Vr && !Nw("yVaLj3")`。
- `sQ` 由 raw line 825 的 `(seed + 56136325351260.toString(16)).slice(-12)` 算出 = `"330e41bb475c"`，即该部署的 api.js URL 分组段。
- api.js（entry 2）里 `ch:"aae2b9a1c261"` 是构建常量。直接 `curl .../turnstile/v0/g/330e41bb475c/api.js` 确认 CF **不按 token 个性化**，字节数与 HAR 相同。
- **因此参照 HAR 自身也满足 `ch !== sQ`**；而父窗口 `ri()` 的第一道 `Qa()`（任一 widget 的 `chlPageData` 非空，而 chlPageData 在 `turnstile.render()` 时即已由 chl_page.js 传入）恒为真，`reloadApiJsRejected` 必然发生且**不产生任何网络请求**（`_o()` 才是发 `?_upgrade=true` 的那条）。
- 结论：`reloadApiJsRejected` 是两端都发生的正常拒绝路径，widget 收到后会用暂存的 extraParams 继续 `Vf()/Vb()`，**不是分叉点**。卡点回到「widget proof 被 CF 判回 `cf-chl-gen`」。

### 二、已定位并修复的两个通用缺陷（Chrome 逐项定标）

用本机 headless Chrome 对 `script` 元素的属性面定标，Obscura 有两处真实偏离：

| 操作 | Chrome | Obscura（修复前） |
|---|---|---|
| `s.async = true` | 创建 `async` 内容属性 | 无属性（只写了 own 属性） |
| `s.defer = true` | 创建 `defer` 内容属性 | 无属性 |
| `s.nonce = 'x'` | 内部槽，**不创建**属性；`getAttribute("nonce")` 返回 `null`；`attributes` 不含它 | 直接写内容属性，`attributes` 可见 |

这两处正好解释参照侧 DOM outline（CF 自己算的 `wPr.pi.pfp`）的差异：

- Chrome：`...scr_sr>sty>scr_sr_as_de_cr...`
- Obscura（修复前）：`...scr_no_sr>sty>scr_no_sr_cr...`

缩写规则已核实为「标签取前 3 字符、属性取前 2 字符」，因此 `sr`=src、`as`=async、`de`=defer、`cr`=crossorigin、`no`=nonce。该 outline 经 `extraParams.wPr.pi.pfp` 送到 widget 并进入 proof payload。

**修复**（`env/dom/node.js`、`env/dom/element-object.js`、`env/dom/named-node-map.js`）：

1. `Element` 增加 `async`/`defer` 访问器（`localName === "script"` 时反射到内容属性，其它元素落回 own data property，与既有 `srcdoc`/`csp` 的写法一致）。
2. `nonce` 改为内部槽（`_idlNonce`）：getter 优先读槽，setter 只写槽；内容属性仍镜像一份供 Rust CSP nonce gate 使用，但 `NamedNodeMap._names()` 在槽存在时过滤掉 `nonce`，因此 JS 侧 `attributes` 与 Chrome 一致。
3. `async` 显式赋 `false` 的 opt-out 改由 `_scriptAsyncOptOut` 记录（原来靠 `hasOwnProperty('async')`，反射后会失效），`__prepareInsertedScript` 的 `explicitlyInOrder` 改读该集合。

**验证**：本地探针在 Obscura 上得到 `attrs=[async=,defer=,crossorigin=anonymous]`，与 Chrome 逐字段一致；`obscura-js` release 全量 `597/597` 通过（含 `dynamic_classic_scripts_are_async_by_default_but_honor_async_false_order`）。

**残留**：Obscura 的 `getAttribute("nonce")` 仍返回 IDL 值（Chrome 返回 `null`）。这是为内部 CSP gate（`tools/script-loader.js` 与 Rust `inline_script_allows`）保留的，暂不改。

**仍未达成**：真实 `/1.txt` 404。

### 三、同轮证伪（避免后续重走）

- **「widget realm 的 HTML sink 返回空」不是缺陷。** 上一轮 agent 用 HaHaVM 参考 payload 得出 `OjmoV1[85/86/103/104]`（`new DOMParser().parseFromString(...).body.innerHTML`）在 Obscura 为 `""`、参照为非空，判为「真浏览器绝不会产生的值」。本机 headless Chrome 实测证伪：只要 CSP 含 `require-trusted-types-for 'script'` 且存在 `createHTML` 返回 `''` 的 default policy（CF 在 widget realm 建的就是这个），Chrome 的 `DOMParser.parseFromString` **同样产出空文档**（`body.children.length === 0`），Obscura 表现完全一致。HaHaVM 有真值是因为它不实现 TT 强制。
  **推论：凡是「HaHaVM 有值而 Obscura 没有」的差异，都必须先用 Chrome 实测再定性；HaHaVM 不是 TT/规范行为的 oracle。**

- **`async/defer/nonce` 修复已端到端验证。** 用新二进制对真实挑战跑一轮，payload 里的 DOM outline 从
  `...scr_no_sr>sty>scr_no_sr_cr...` 变为 `...scr_sr>sty>scr_sr_as_de_cr...`，**与参照逐字符一致**。
  该轮仍产出 widget proof payload（108 KB），即反射改动没有破坏挑战流程。

**仍未达成**：真实 `/1.txt` 404。

### 四、Trusted Types `default` 唯一性修复

Chrome 实测（无 `trusted-types` 指令时）：同名策略**允许**重复（`createPolicy('dupX')` 三次全 ok），但 **`default` 只允许注册一个**，第二次抛
`TypeError: Failed to execute 'createPolicy' on 'TrustedTypePolicyFactory': Policy with name "default" already exists.`
Obscura 修复前第二次静默成功。已在 `env/security/trusted-types.js` 加上该判定，复测与 Chrome 逐字符一致。
（同轮证伪：上一轮「Chrome 对同名策略恒定抛 already exists、Obscura 顶层不校验」的结论**是错的**——Chrome 在无 `trusted-types` 指令时同样允许重名；真正的差异只在 `default`。）

**门禁**：`obscura-js` release 全量 `597/597` 通过（含四个 TT 测试）。

### 五、trace 证据（本轮）

`--trace-api-file /tmp/cf-trace/api.jsonl --trace-api-format jsonl --trace-api-calls` +
`--trace-op-file /tmp/cf-trace/op.tsv`，对 `https://www.thelancet.com/1.txt` 的一次完整访问：

- `api.jsonl`：570,540 条，键为 `{t,src,name,args,result}` —— **与 HaHaVM-General 的 trace 契约同构**，因此方法级对拍现在直接可行（此前结论是两者契约不同、无法逐调用对拍）。
- `op.tsv`：445 条宿主 op（`dom` / `fetch` 等），表头 `timestamp_us operation arg1 arg2 arg3 result`。
- 覆盖：570,453 条记录带 `thelancet` 源位置。
- `vendor/v8-trace.sh check` = `trace-capable` / `trace-capable (jsonl)`。

### 六、Chrome oracle 与诊断更正（本轮最关键）

用**真实 headful Chrome 153**（同一代理、`--ignore-certificate-errors`）跑通了同一挑战 4/4 次，并通过 CDP `Target.setAutoAttach` 挂到 widget 的 OOPIF 上抓到它 `console.log` 的**明文 payloadJSON**（`/tmp/cf-chrome/payload-{1,2,3}.json`）。

**诊断更正（推翻上一轮的核心前提）**：Chrome 第二次 widget POST 收到的响应也是 **127,240 B**，与 Obscura 完全相同。因此 127,240 **不是拒绝**，`cf-chl-gen` 不等于「proof 被拒」。真正的差异在后续流程（Chrome 之后还会再发一次 widget 提交，再重新 POST 主 `/fo/`、最后读 `/1.txt`）。

**Chrome 侧实测「有真值而 Obscura 为空/零」的项**（全部由真实 Chrome 确认，非 HaHaVM）：
1. `PerformanceResourceTiming.initiatorType`：Chrome `"xmlhttprequest"`，Obscura `"fetch"`（CF 读回自己那次提交的类型）。**已修**。
2. 缺 `first-paint` / `first-contentful-paint` paint 条目（Chrome 7 条，Obscura 3 条）。
3. `RTCPeerConnection` 缺 `typ srflx`（公网 IP）候选，只有 host/mDNS。
4. **Obscura 暴露了真实 Chrome 没有的全局**：`SharedStorage*`（7 个）、`ModelContext`、`WebMCPEvent`、`navigator.modelContext` —— 真实 Chrome 153 实测全部 **ABSENT**。
5. `navigator.keyboard.getLayoutMap()` 缺 `IntlBackslash`（47 vs 48）。
6. 枚举/注册表基数系统性偏大（约 2×）。
7. 反向：Chrome 有而 Obscura 无 —— `XSLTProcessor`、`PermissionsPolicy`、`FontFaceSet`、`SharedArrayBuffer`、`navigator.cpuPerformance` 等。

### 七、本轮落地的通用修复（全部有 Chrome 逐项定标）

| # | 修复 | 文件 | 验证 |
|---|---|---|---|
| 1 | 脚本 `async`/`defer` 反射到内容属性 | `env/dom/element-object.js` + `env/dom/node.js` | pfp 由 `scr_no_sr>scr_no_sr_cr` 变为 `scr_sr>scr_sr_as_de_cr`，与参照逐字符一致 |
| 2 | `nonce` 改为 IDL 内部槽（不出现在 `attributes`） | `element-object.js` + `named-node-map.js` | `attrs=[async=,defer=,crossorigin=anonymous]`，与 Chrome 相同 |
| 3 | Trusted Types `default` 策略唯一性 | `env/security/trusted-types.js` | 与 Chrome 报错逐字符一致 |
| 4 | 时区默认值由常量 `Europe/Berlin` 改为**宿主时区** | `crates/obscura-cli/src/main.rs` | `Asia/Shanghai` / offset `-480`，与 Chrome 相同 |
| 5 | CSSOM `!important` 语义（IDL 值形式丢弃、priority 参数校验、`getPropertyValue` 去 priority、`getPropertyPriority` 返回） | `env/css/style-declaration.js` | 六项用例 A–F 与 Chrome 逐字段一致 |
| 6 | `getExtentOfChar` 返回真实字形原点（原恒为 `x:0`） | `env/media/canvas.js` | `x` 与 Chrome 一致 |
| 7 | Permissions 默认态（`granted` 收敛为 Chrome 的 `prompt`/`granted` 表） | `env/window/plugins.js` | 与 Chrome 实测表一致 |
| 8 | `getBoundingClientRect()` 返回真正的 `DOMRect` 实例（保留 `__obscuraViewportFixed` 标记） | `config/webidl-branding.js` | `[object DOMRect]`，与 Chrome 相同 |
| 9 | `resource-timing` 的 `initiatorType`：XHR 报 `xmlhttprequest` | `env/network/xhr.js` + `fetch.js` | 实测 `a.txt:xmlhttprequest` |

**门禁**：`obscura-js` release 全量 `597/597`；workspace 见本轮最终复跑。

**仍未达成**：真实 `/1.txt` 404。

### 八、本轮最终门禁与真实验证

- release render build、`--no-default-features` check（`obscura-js` + `obscura-cli`）、`vendor/v8-trace.sh check`（`trace-capable` / `trace-capable (jsonl)`）全部通过。
- workspace nextest：**1784/1784 passed, 4 skipped**。
- 真实站复跑（零注入，`--stealth --proxy`）：请求序列仍为
  `chl_page 200 (234874)` → 顶层 `/fo/ 200 (113772)` → `api.js 200 (82928)` → widget `/fo/ 200 (822872)` → `/pat/ 401` → widget `/fo/ 200 (127240)` → **停止**。
  与 Chrome 对照：Chrome 在同一跳同样收到 **127,240**，随后**继续**发下一次 widget 提交（body 91,959 B）→ 主 `/fo/` → `POST /1.txt → 404`。
  **所以 Obscura 的缺口是「收到 127,240 之后没有继续走完流程」，不是「被 CF 拒绝」。**

### 九、下一步（按证据强度排序）

1. **定位 Obscura 在 127,240 响应之后停住的原因**。该响应体是 CF 的 JSVMP 程序（widget 侧 `case 5` 的 `onreadystatechange`：`status===200` 时按 `sl(responseText).startsWith("window._")` 分流到 `new Function(...)(Y,Ni)` 或 `runProgram(Vz,S)`）。用 `--trace-api-calls` 对着这一跳做方法级 trace，检查程序是否执行、在哪里提前返回。
2. `PerformanceResourceTiming.initiatorType` **已修**，回归确认 widget 那次提交现在报 `xmlhttprequest`。
3. 补 `first-paint` / `first-contentful-paint` paint 条目。
4. 移除 Obscura 暴露而真实 Chrome 没有的全局：`SharedStorage*`(7)、`ModelContext`、`WebMCPEvent`、`navigator.modelContext`（`config/surface-finalize.js` 的接口表与 `_chromePayloadBareFunctionOrder` 等顺序表要同步改，注意顺序表是「参照 payload 顺序」，改前先确认目标 Chrome 版本）。
5. `RTCPeerConnection` 缺 `typ srflx` 候选；`navigator.keyboard.getLayoutMap()` 缺 `IntlBackslash`；枚举基数偏大约 2×。
6. 反向缺口：`XSLTProcessor`、`PermissionsPolicy`、`FontFaceSet`、`SharedArrayBuffer`、`navigator.cpuPerformance`。

### 十、按 HaHaVM trace 继续对齐（用户指定基准）

用户明确要求以 **HaHaVM-General 的 trace**（而非 Chrome）作为对齐基准。据此重新组织对拍：

**方法级逐调用对拍目前取不到信号。** Obscura 的 `--trace-api-format jsonl --trace-api-calls` 虽然与 HaHaVM trace 的键集合同构，但 widget 帧的 JSVMP 全部通过**计算键**访问属性，V8 侧报出的接收者是 `Object`（trace 里是 `Object.U`/`Object.WK` 这类名字），不是 `Interface.member`；加 `--trace-api-filter` 后整轮只剩 263 条，而 HaHaVM 是 33,531 条。两侧覆盖度不可比，不是行为差异。

**改用 payload 逐字段对拍**（payload 是 trace 的输出，也是 CF 实际判定的东西）。对 91 个桶按**字段名集合**对齐（桶下标每次运行都会置换），公共叶子路径分类：

- 「HaHaVM 有真实值、Obscura 空/零/假」61 条
- 「Obscura 有、HaHaVM 空」39 条
- 两侧都非空但不同 1,930 条（绝大多数是 token/时间戳/随机 id 与 Math ULP）

其中最大的结构性一块 `.XYvy9[5][*]`：HaHaVM trace 的原文给出了精确参照
`CanvasRenderingContext2D.measureText("😀") -> TextMetrics {width: 116.39990234375, actualBoundingBoxLeft: -0.5920000076293945, …, fontBoundingBoxAscent: 17, fontBoundingBoxDescent: 5}`。
Obscura 的 `actualBoundingBoxLeft` 恒为 0、若干项为 `null`。字段本身齐全（实测），差异来自**字形 overhang 未计算**，属渲染器深度问题，本轮未动。

**本轮完成的对齐项**（全部与 HaHaVM 同时与 Chrome 实测一致）：

| 项 | 结果 |
|---|---|
| 14 项缺失 IDL 反射：`isContentEditable`、`autocapitalize`、`enterKeyHint`、`inputMode`、`writingSuggestions`、`virtualKeyboardPolicy`、`currentCSSZoom`、`clientTop`、`clientLeft`、`part`、`prefix`、`minLength`、`size`、`dirName` | 逐项与 Chrome 一致（payload 里 `OjmeV1` 的布尔位） |
| `GPUAdapterInfo.architecture` 对 Apple 档由空串改为 `metal-3` | 与 HaHaVM/Chrome 一致（`.lDUiR4[0][1]`） |

**HaHaVM trace 里确认的请求头**：widget 的 XHR 带 `cf-chl: <token>` 与 `cf-chl-ra: 0`（widget 脚本 `Nj = 0`），第二次 POST 后 `getResponseHeader('cf-chl-out')` 成功。Obscura 走同一份脚本、同一取值。

## 2026-09-12：用户基线更正 + 停顿点证据归档（会话暂停）

### 用户指令（必须遵守）
- **对拍基准是 HaHaVM-General，不是 Chrome。** Chrome HAR/payload 一律降级为参考，非必要不使用。
- 会话目标当前为 paused 状态；恢复后继续按 HaHaVM trace 对拍路线推进。

### 本轮已确认的证据（恢复后直接使用，不要重跑）
- Obscura 完整链路（`/tmp/stall4/serve.log`，[stall] preload 探针轮）：
  `widget XHR #1 (4,919B) → 822,512 响应` → `XHR #2 (88,695B 全量 payload) → 127,232 响应`
  → `runProgram(95,424B 代码) 返回 undefined` → `XHR.DONE#2 cf-chl-out=null` →
  widget 向 TOP 发 `interactiveBegin` → **静默**（无第三次 widget 提交、无 /ci/、无 blob worker）。
- HaHaVM 成功轮（基准）：同阶段后继续 `widget proof /fo → target proof /fo → GET /123.txt → 404`。
  参照材料：`/tmp/trace_compare_20260910.json`、HaHaVM 成功轮 JSONL（33,811 条、828 个 API 名）。
- 已知观测约束：Obscura `--trace-api-calls` 全量 jsonl 开销过大（570K 条），挑战流程会被拖慢导致更早
  分叉（widget3 轮在 POST #1 后即停）；低开销组合是 `--trace-op-file` + 轻量 preload 探针。
- `interactiveBegin` 疑似 widget 的降级分支（HaHaVM/成功路径在此处不等待交互，直接继续 proof）。
  恢复后的对拍切入点：**第二次 widget /fo/ 响应（127KB JSVMP）执行期间，HaHaVM trace 与 Obscura
  trace 的方法级分叉**（同一 JSONL 契约 `{t,src,name,args,result}`，逐调用可比）。

## 2026-09-12 下午：指针轨迹突破 + 最终 GET/403 分叉定位（会话暂停前证据）

### 已确认的突破（恢复后直接用）
1. **交互门已打通**：interactiveBegin 后注入 CDP 鼠标轨迹（8 次 move 到 widget 300x65@(192,304) 区
   域 + click）→ widget 立即 Worker burst → `interactiveEnd` → widget POST #3（proof）→ top `/fo/` #2。
   驱动脚本：`/tmp/pointer_probe.py`（fixed 坐标版），证据：`/tmp/fix8/serve.log`。
2. **CF 已在链路上向 Obscura 下发 cf_clearance（CK）**（mitmproxy /flows.json 实证）：
   - fix8 轮 t-479s：`POST thelancet /fo/` → `Set-Cookie: cf_clearance=6N5CrHYG...`
   - fix9 轮 t-354s：同上 `cf_clearance=Ix9D4UH3...`
   - HaHaVM 成功轮 t-2020s 的 clearance 同源。
3. 对照表：fix8（无 600010，interactiveEnd，proof 接受）与 fix9（widget POST#4 后报
   `event:"fail",code:"600010"`）**都以 GET /1.txt → 403 → 换 ray 收场**。

### 当前最强假设（用户指示的验证方向）
- top `/fo/` #2 XHR 响应的 `Set-Cookie: cf_clearance` **未持久化进 cookie jar**（或 document.cookie
  不可见）→ 最终程序（codeLen=2428）读不到 clearance → 走"未完成→刷新"GET 分支；
  Chrome 同位置 cookie 可见 → form POST `/1.txt`（body `<sha256>=<token>`）→ 404。
- 本地最小复现 fixture 已写好：`/tmp/cookie-srv.py`（XHR POST 响应 Set-Cookie → 后续 fetch 是否带
  cookie），被会话暂停中断，恢复后先跑它。
- 600010 → TOP 收 fail → 清理 widget 重开挑战，是另一条同样以 GET 收场的失败分支（用户假设，
  fix9 证实；fix8 证明即使无 600010 也 GET，两者统一到 cookie/分支假设）。

### 用户指示（恢复后必须遵守）
- **继续对拍 HaHaVM-General trace，直到 iframe 内可以返回 token 给主 window**：重点窗口是 HaHaVM
  成功轮 top `/fo/` #2 响应后到 `solve.done`（t≈13289-13457）之间的全部调用/消息（graIf9、
  widget→TOP 完成事件、document.cookie 读取、form 构建），对照 Obscura fix8 同窗口缺什么。

### 本轮已落地修复（待完整门禁）
- `env/crypto/subtle.js`：generateKey 密钥 material 跨 realm re-wrap（frame 内 generateKey 产生的
  密钥此前无法 encrypt/decrypt/sign，报 "Argument is not a valid CryptoKey"）；
  focused 回归 `frame_realm_subtle_generate_key_material_is_realm_local` 1/1 通过，release 已重建。

## 2026-09-12 晚：非交互路径发现 + 四项引擎修复落地（fix8~fix30 轮）

### 里程碑突破
1. **环境指针活动改变 CF 变体选择**：从页面加载起持续顶层鼠标移动（ambient drift）→ 挑战走
   **非交互路径**（widget 完全不出现，Chrome headful 4/4 同款）；无漂移 → 交互路径（widget+
   interactiveBegin）。证据：fix23/fix30（drift → 0 widget 事件）vs fix8~21（无 drift → widget 正常）。
2. **交互路径可达 clearance**：录制轨迹（HaHaVM TraceTemplate 移植 `/tmp/pointer_probe7.py`）+
   checkbox 落点，多轮拿到 top /fo/ #2 → 3,240B + cf_clearance（mitmproxy 实证）。
3. **gIBpo1=0 根因**：CF 交互证据计数（Chrome=16/16/34，HaHaVM=19/19/39，Obscura=0/0/0）来自
   **顶层指针遥测**（经 extraParams 通道转发 widget），非 widget 内事件。晚于遥测快照的移动不计。
   CDP 事件路由本身正确（嵌套 turnstile iframe frame-page-1-1 收到 29 moves+click）。
4. **点击陷阱**：无 widget 的 interstitial 上 (209,337) 是 "Cloudflare Privacy Policy" 链接，
   提前点击会导航走、杀掉后台验证中的挑战（fix23/24/30 三次复现）。
5. HaHaVM 基准复验仍通过（12:32 与 15:5x 两轮 verify 404×2）；mitmproxy 无改写（modified=0），
   600010 是 CF 真实判决。

### 已落地修复（证据充分，门禁进行中）
| 修复 | 文件 | 证据 |
|---|---|---|
| frame realm crypto.subtle.generateKey 跨 realm 密钥不可用 | env/crypto/subtle.js | 本地 iframe fixture 复现 "Argument is not a valid CryptoKey"；focused 1/1 |
| 字体平台矛盾：捆绑 Linux 字体名可被探测（Windows UA 下报 DejaVu/Liberation/Noto） | render inline.rs（Windows-only 识别表 + LoadedFamily.is_webfont 门控）+ fonts.js（Windows 列表） | payload peEN1 实证；本地探测 fixture 现报纯 Windows 集 |
| 非 stable 全局 ModelContext/WebMCPEvent/navigator.modelContext 暴露 | surface-finalize.js | Chrome 148 无、通过基准无、UA 自洽 |
| WebGL MAX_VIEWPORT_DIMS 32767 与自报 Intel UHD630(FL11) 矛盾 | fingerprint/webgl.js → 16384 | payload qydV6 实证 |
相关测试更新：chrome149_payload_interfaces（153 origin-trial 全局改为断言不存在）、webidl name
列表、render 测试 LoadedFamily 初始化。SAB 保持原语义（仓库自有 Chrome oracle：secure 非隔离
也扣留；基准多余的 SAB 被容忍，不追）。

### 门禁状态
- obscura-render(paint)：589/589 通过
- obscura-js(render)：598/598 通过
- workspace 全量：后台运行中（结果待记录）
- release 精确构建：已含全部修复

### 对拍结论修正（重要，防重蹈）
- payload gsLi5.N 枚举序：**Obscura 与真实 Chrome 捕获（assets/payload/2.json）完全一致**
  （alert@0/Object@52）；HaHaVM 是 Node vm 序偏离且被容忍。agent 报告的 C3 排序嫌疑不成立。
- Chrome-vs-Obscura payload 对拍仅 91 处过滤后差异，最大可操作项即 gIBpo1 全零。

### 下一步（按证据强度）
1. **非交互路径收尾**：ambient drift 全程持续（不止前 3.5s）+ 不点击 + 等待 30s+，观察后台验证
   是否完成（fix29 曾见第二次 GET /1.txt=403，说明有 re-request 环节）；配合 2~3 轮重试。
2. **交互路径收尾**：早期(0-3.5s)漂移喂顶层遥测 + 停手让 widget 出现（fix30 证明早期漂移也会抑制
   widget——需要找"喂遥测但不出信号"的窗口：漂移只在 extraParams 快照前极短窗口，或漂移坐标避开
   挑战容器区域）+ 录制轨迹点击。
3. trace 日志交付：--trace-op-file + 探针日志已覆盖全程（每轮 serve.log 即 trace 证据）。

### 关键工件索引
- 驱动：/tmp/pointer_probe7.py(录制轨迹) /tmp/pointer_probe15.py(漂移+轨迹) /tmp/driver_pure.py(纯漂移)
- 探针链：/tmp/stall_probe9.py（计数器+fid+md/hov 标记）；日志 /tmp/fix8..fix30/serve.log
- HaHaVM 基准：/tmp/haha-base-123243/（33,901 行 trace + console.jsonl payload 明文）
- Chrome 真值 payload：assets/payload/{2,3}.json；对拍报告：/tmp/pdiff/report.md

## 门禁终态（本轮收尾）
- obscura-render(paint) 589/589；obscura-js(render) 598/598；workspace render 1785/1785（4 skipped）
- no-default check 通过；精确 release 重建完成，`vendor/v8-trace.sh check` = trace-capable (jsonl)
- obstacle course（重新克隆 github.com/h4ckf0r0day/obscura-benchmark）31/33，与既有基线一致；
  两个失败仍是基准自身过期期望（IntersectionObserver fixture、Win32/Europe-Berlin 硬编码
  fingerprint——时区默认今晨已按 Chrome 对齐改为宿主时区，基准未跟上）。
- fix33 补充：2-6s 移动同样抑制 widget → CF 变体选择对前几秒指针存在持续敏感，结论已并入上文。

## 2026-09-12 深夜：gIBpo1 遥测突破 + CDP input 死锁发现（fix35~fix55 轮）

### 三项决定性新发现
1. **CDP Input 死锁（引擎 bug，待修）**：挑战 85KB 程序执行窗口（约 1.2~2.2s，各轮浮动）内派发
   Input.dispatchMouseEvent 会死锁 input 派发路径与 XHR 完成路径（定时器不受影响）；驱动端表现为
   call 超时/移动停止计数。复现轮：fix28/40/41/42。规避：完全不用 CDP input 做环境移动。
2. **合成事件流（HaHaVM 同款，已验证有效）**：preload 里用 `__obscura_markTrusted` + dispatchEvent
   派发 PointerEvent/MouseEvent——顶层与 frame realm 均可计数，零死锁。fix52：widget realm 计数
   pointermove:89；**gIBpo1 历史上首次非零**（PklU5/WtOKC4=6，gFvyY1=12，Chrome=16/16/34）。
   驱动：/tmp/driver_v9.py（纯净可用版）。
3. **修复路径确认**：gIBpo1 计数器在 **widget 内容 realm（frame-page-1-3）自己的 window**；
   CDP 轨迹点击落在 frame-page-1-1（嵌套 turnstile/blank realm）不计入。Chrome/HaHaVM 的点击发生在
   构建 payload 的同一 realm → 修复=在 widget realm 内合成点击自己的 checkbox（HaHaVM 正是这么做的）。

### 卡点（下一迭代从这里开始）
- v10（fix54）：widget realm 里 `document.querySelectorAll('input').length===0`——点击时刻
  checkbox 未在当前 realm 出现（可能 UI 在另一个嵌套 realm 或时序晚）。需要先弄清 checkbox input
  到底在哪个 realm/何时创建（用 op trace 的 create_element input 对应 frame id）。
- v11 的 JS 改写有语法/结构问题（SYNCLICK 全静默）——重写时把 PRELOAD 单独存文件并
  `node --check` 验证，别再字符串手术。
- ambient 已喂到 89 moves 但收集器只计 6——收集窗口/条件待定（HaHaVM 19 大概率来自其
  install() 的帧内 pointermove 重放；可对拍 HaHaVM trace 中 widget realm 的 pointer 事件时序）。

### 本轮工具与工件
- 驱动：/tmp/driver_v9.py（合成 ambient 全 realm，可用）；v10/v11 需修复
- 复现死锁：驱动在 0-4s 内发 CDP move 即可触发（概率性）
- fix44 证明当前二进制无回归（老驱动正常出 widget 342 事件）
- fix43 证明存在"背景评估"变体（top /fo/ 后 widget 永不出现、页面闲置）——CF 会话方差

### v12 终局确认（fix56）
- ambient 合成流稳定工作（widget realm 94 moves）；gIBpo1 已非零（2~6/轮）但点击计数仍 0。
- **checkbox input 在 preload 可达的所有 frame realm 中从未出现**（v10 allInputs=0、v12 轮询静默未中）。
  结论：checkbox UI 位于更深层的嵌套 realm（widget 内的 turnstile iframe），其创建路径可能不应用
  addScriptToEvaluateOnNewDocument preload。
- 下一迭代精确任务：
  1. 带 --trace-op-file 跑一轮，把 `create_element input`（checkbox）的 root/frame 归属到具体
     frame id（对齐 probe 的 fid 日志）；
  2. 确认该 realm 是否收到 preload；若没有，找到 frame realm 创建路径中 preload 的应用点
     （frames.rs / navigate_frame_inner / create_blank_iframe_document 链），补齐；
  3. preload 到达后，v12 的轮询合成点击应能命中 checkbox → gIBpo1.EeyrI1（click）非零 → verdict。
- 次要观察：挑战重负载阶段 serve 的 WS keepalive 会饿死（FINAL eval 断连）——引擎健壮性观察项。

## 2026-09-12 收尾（fix57~fix65）：checkbox 在 closed shadow root + 计数窗口 + v18 最佳配方

### 新确认的事实链
1. **checkbox 在 closed shadow root 内**：v15/60 在全链路畅通轮对 4 个 frame realm（1-1~1-4）在
   4/7/9/11/13/16/20s 普查，`querySelectorAll('input')` 全程 0——DOM 查询根本看不见它。
   CDP 命中测试证明 UI 在 frame-page-1-1 本地 (17,33)。
2. **合成坐标点击不触发激活**：在坐标 (21,32.5) 对 elementFromPoint 结果派发完整 pointer/mouse/click
   序列（v16/61），interactiveEnd 不来；CDP 轨迹点击（引擎 input.rs 的 label/checkbox 激活路径，
   翻转 checked）则可靠触发 interactiveEnd（fix59/61/65）。→ CDP 点击仍不可替代。
3. **gIBpo1 计数窗口实证**：早窗（~0.4-5.6s）合成移动被计入（每轮 2~6 个，派发 14 个），
   9.5s 后的合成 click 不计（EeyrI1=0），CDP 点击（落在 1-1 realm）也不计。
4. **widget-realm 持续 ambient 会破坏 payload-2 采集**（fix57/58 停滞于 XHR#2 前），有界早窗则安全。
5. **当前最佳配方 = v18**（/tmp/driver_v18.py + /tmp/v18_frame_script.js）：
   - preload：frame realm 0.4-5.6s 有界早窗合成移动（~3/s）
   - CDP：13s 录制轨迹 + checkbox 点击
   - 结果：interactiveBegin → interactiveEnd → verdict（fix65: gIBpo1=6/6/12，仍 fail 600010）

### 对拍缺口表（Chrome / HaHaVM / Obscura-v18）
| 指标 | Chrome | HaHaVM(通过) | Obscura v18 |
|---|---|---|---|
| gIBpo1.PklU5/WtOKC4（move 计数） | 16/16 | 19/19 | 6/6 |
| gIBpo1.EeyrI1（click 计数） | 1 | 1 | **0** |
| gIBpo1.gFvyY1（合计） | 34 | 39 | 12 |

### 下一迭代任务（按序）
1. 提高早窗移动密度到 ~3.5/s 且窗口 0.3-6s（目标 PklU5≥16）：v18_frame_script.js 调参即可。
2. EeyrI1 归零：在计数窗口内（≤5s）派发一次合成 click（坐标同 checkbox），interaction 激活仍由
   13s 的 CDP 点击完成——先验证计数器是否计入窗口内合成 click；若不计，对拍 HaHaVM trace 中
   `EventTarget.addEventListener`/click 事件在挑战 frame 的接收序列，找它的 click 计数来源。
3. 若 move/click 计数到位 verdict 仍 fail：剩余差异回到 /tmp/pdiff/report.md 的 D 类清单
   （网络探针 jyDXx2/tQcZu4/RotPR2、qEwJM8 全零测量）逐项修。

### v19 终局数据（fix66）
- 加密早窗（48 次派发 0.3-6s + 窗口内合成 click@checkbox 坐标）：gIBpo1 仍精确 =6/6/12，EeyrI1=0。
- **结论 A**：move 计数是采样型（~1/s 封顶于窗口秒数），非事件率——加密无效；要达 Chrome 的 16
  需要更长（~16s）的活动窗口，但窗口>6s 会侵入 payload-2 采集（fix57 风险）——需要实验定界。
- **结论 B**：合成 click 永不计入 EeyrI1。原因：closed shadow root 的分发方向——从 host/坐标
  dispatchEvent 只会向上冒泡，不会进入 shadow tree；challenge 的 click 计数监听器在 shadow root
  内部。CDP 点击之所以触发激活，是引擎 input 管线直接命中 shadow 内节点。
- **下一迭代的关键实验**：在 widget realm 里探测 `document.elementFromPoint(21,32)` 返回什么
  （host 还是内部节点）+ 尝试 `host.shadowRoot`（closed，预期 null）；若引擎能让 preload 拿到
  shadow 内部节点引用（例如通过 engine 暴露的 debug 钩子或 hit-test op），在内部节点上 dispatch
  click 即可同时解决 EeyrI1 与激活，从而摆脱对 CDP 点击的依赖。
- 若该路不通：对拍 HaHaVM trace 里 challenge frame 的 click 接收序列（33,901 行基准中
  `EventTarget.addEventListener` 后的 click 处理），确认其 click 计数监听器的挂载点与判定条件。

## 2026-09-12 终盘（fix67~fix68）：shadow root 捕获成功 + 遥测非判据结论

### v20/v21 成果
- **attachShadow 包装捕获 closed root 成功**：3 个 shadow root，checkbox FOUND，rect=(9,20.5,183x24)，
  在内部节点上合成 click 成功（checked=true 翻转）——"拿 shadow 内节点引用"任务完成。
- 早窗移动 11s + 左侧聚集（v21）：PklU5 仍 5~7，**与坐标分布无关**——计数为 ~1/s 采样型；
  HaHaVM 的 19=1:1 因其绕过事件分发直接调用 listener（memory.asyncEvent.listener 注册表）。
- EeyrI1 在内部节点 click 后仍 =0：click 计数另有来源（可能采样窗口或 userActivation 相关，未定）。

### 关键否定结论（防重走）
- **gIBpo1 很可能不是 verdict 判据**：0/0/0 与 5~7/14 两档下 verdict 均 fail 600010，无变化。
- **twvE0/ZMSOw0 非判据**：HaHaVM=65（通过）、Obscura=87~90、Chrome=1181——65→1181 全被容忍。
- 600010 与旧"注入 key 过期"同码，方向应转向 **rcV/api.js 版本链**（top→widget init 的
  nextRcV、apiJsResourceTiming 名、reloadApiJs 链）或 /tmp/pdiff/report.md 的 D 类网络探针
  （jyDXx2 'status_401'vs'T'、tQcZu4 'fetch_error'vs'timeout'、RotPR2 iframe referrer 空）。
- 注意：tQcZu4 我们的 fetch_error 可能反而更像真实 Chrome（v6 不可达快速失败），
  HaHaVM 的 'timeout' 是伪造——修这项前必须先确认 CF 期望值，禁止盲改。

### 下一迭代建议（信息密度排序）
1. 反混淆 widget 的 3,868B 判决程序（fix8 静默轮）/5,160B 响应程序：定位 600010+rcV 的产生
   条件（rcV 从哪读、和什么比较）。已有 RP.SRC 捕获管道（stall_probe5）可取程序明文。
2. 对拍 D 类网络探针：先在 HaHaVM trace 里找 jyDXx2/tQcZu4 探针的真实 JS 调用（哪个 URL、
   什么条件下记 'T'/'timeout'），再决定是否需要引擎侧改 fetch 失败分类。
3. 若以上均闭环仍 fail：按 /tmp/pdiff/report.md 剩余 C 类清单（qEwJM8 全零测量、
   FEahy0 precision 形状）继续。

## 2026-09-12 补充（fix69 + 排除法）：qEwJM8 全零的测量技术定位

### 逐项排除（全部本地实测通过，非 qEwJM8 来源）
- closed shadow root 内 span offsetWidth/getBoundingClientRect：非零（209/208.8）
- iframe realm 内 shadow root + checkbox rect：正常（209/13/300x65）
- canvas measureText（Cambria/Segoe 72px）：514.5/581.0
- **Worker 内 OffscreenCanvas + measureText**：正常（w=514.5469, font 正确反射）
  ——注意 fetch 模式下 worker 异步回传被抑制，验证必须用 serve 模式
- document.fonts API：forEach/size(=0)/load 正常；**check('12px "不存在字体"') 返回 true 是缺陷**
  （Chrome 返回 false；fonts.js check() 的正则/列表逻辑需修，暂未改）
- performance.now()：分数值+100µs 量化（与 Chrome 非隔离页一致）；短任务耗时可为 0（同 Chrome）

### qEwJM8=[0,0,0] 剩余假设（按可能性）
1. **耗时三元组**：HaHaVM [124, 12.71875, 674.0369873046875] 均为 Chrome 风格分数时间戳形态；
   若为探针耗时，我们的引擎执行太快（<100µs→0）或探针早退（异常被吞）。Chrome 同探针耗时
   应为毫秒级非零。需要 hook widget realm 的 performance.now 调用序列（1-6s 窗口）看探针模式。
2. 探针在我们环境抛异常被 catch → 记 0：hook 方案同上（包裹 try/catch 不可见，改 hook
   各候选 API 的抛错：document.fonts.load reject？check？）。
3. fonts.js check() 误报 true 导致探针走异常分支 → 修复 check() 语义（Chrome：族在系统可用
   才 true）应先做——这是已确认偏离 Chrome 的缺陷，风险低。

### 下一迭代（合并 verifier 指令）
1. 修 fonts.js check()（不存在的族返回 false）+ 重跑挑战看 qEwJM8/gbIrx9 是否离开 0。
2. 若仍 0：preload hook performance.now 调用日志（widget realm 1-6s）定位探针调用序列。
3. 反混淆路线保留：fix10 的 RP.SRC 已存 12 份程序 blob（2-fo/3-fo 阶段），配合 617KB rch
   脚本（早期会话已提取 script-44.js 形态）可做 VM 字节码层对照。

### 更正与补充（本轮末）
- **tools/fonts.js 的 document.fonts shim 是死代码**：live 实现是 env/network/sockets.js 的
  FontFaceSet（Document.prototype.fonts getter 后定义者胜）。其 check() `matches.length===0||…`
  语义符合 CSS Font Loading 规范（Chrome 对系统字体/不存在字体均返回 true）——**不是缺陷，勿修**。
  字体可用性的 live 路径=渲染器 family 表（inline.rs，已按 Windows 修复）+ sockets.js 的
  _localFontAvailable（canvas 双 generic 比宽测量法）。
- 本轮无需任何代码改动（纯诊断排除轮）；死代码 fonts.js 的 Windows 列表改动保留无害。

### 下一迭代最优路径（收敛后）
qEwJM8/gbIrx9 全零仍是最强未解释差异（真 Chrome 不会全零）。剩余假设=探针在 widget realm
早期执行时**抛异常被吞或提前 return**。最快定位法：preload 在 frame realm 包一层
`window.addEventListener('error')` 已有——补 hook `document.fonts.load` 的 reject 与
`FontFaceSet.prototype.load` 抛错日志（1-6s 窗口），一轮即可见分晓；若仍无线索，
走 RP.SRC blob + 617KB rch 脚本的 VM 反混淆（fix10 已存 12 份 blob）。

## 2026-09-12 最终排除轮（fix69 后）：qEwJM8 假设全部证伪，VM 反混淆是唯一剩余路径

### 本轮新增排除（全部本地实测）
- OffscreenCanvas 在 **iframe 派生 worker** 中正常（w=226.01563；首测"p0"是 fixture 时序问题）
- frame worker 消息路由正常
- live check()/FontFaceSet 在 sockets.js，语义合规（前轮已记）
- CanvasRenderingContext2D.prototype.measureText 在页面 realm 被 hook 后**零调用**——挑战的
  字体探测不经过页面 canvas（综合排除：非 span/非 shadow/非 iframe/非 worker OffscreenCanvas/
  非 perf.now/非 fonts API）

### qEwJM8=[124,12.71875,674.04] 新解读（待验证）
桶内 Vtvy6→TPpkV4 间隔=hCfV6（任务耗时对），qEwJM8 三个数可能不是字体而是 **UI 布局测量**
（124=某元素宽、12.71875=行高、674.04=scrollWidth——挑战自身 widget UI 的几何）。
HaHaVM 伪造 widget 几何（__cbRect 等）；我们的 widget shadow 内布局若因挑战 CSS 解析不全
而塌缩（如 flex/grid/特定单位未支持→元素 0 宽），测量即 0。可用 v20 的 shadow 捕获在
挑战轮 dump root 内各元素 rect 对照 HaHaVM 数值验证。

### 结论与下一步（唯一剩余决定性路径）
所有"廉价"假设已穷尽。剩余两条：
A. **VM 反混淆**（决定性）：fix10 已存 12 份 RP.SRC blob + XHR.BODY（含 5,160B 判决响应）；
   617KB rch 主程序早期会话已可导出（script-44.js 形态）。工作量=天级，跨会话。
B. **UI 几何对拍**（快速验证新解读）：v20 shadow 捕获 + 元素 rect dump 一轮，与
   HaHaVM trace 中 getBoundingClientRect 调用值（33,901 行里有）对照，差在哪修哪。
建议下轮先 B（一轮可完成），无果再启动 A。

### fix70：widget UI 几何 dump（GEO 探针，/tmp/driver_geo.py）
- widget frame UI 布局完好：HTML/BODY 300x65、checkbox 行 DIV/LABEL/INPUT 183x24@(9,21)、
  checkbox 框 SPAN 24x24、文字 SPAN 151x16@(41,25)——与 HaHaVM __cbRect(9,20.5,24x24) 量级一致。
- qEwJM8 的 [124,12.7,674] 与 widget 内任何宽度不匹配（183/24/151/300）——更可能是**顶层页面**
  挑战元素的测量（674 像素宽的元素只可能在 1440 宽的顶层）。Chrome dump 曾见 787.89x28.94 盒。
- 至此所有单轮可验证假设穷尽。剩余决定性路径=VM 反混淆（天级）或顶层页面元素几何对拍
  （下轮一轮可做：在 TOP realm dump 挑战容器 rect 对照 HaHaVM trace 中 Element.innerHTML/
  getBoundingClientRect 记录）。

### 收官备注
- HaHaVM trace 的 gBCR 记录值为 `DOMRect {}`（其 trace 序列化不含 rect 字段）——几何对拍
  只能对 Chrome 实测（非必要不用）或反混淆。B 路线至此信息枯竭，下轮起转入 A（VM 反混淆）。

## 2026-09-12 VM 反混淆启动（agent 后台执行中）
- 工件准备完成：rch 明文脚本提取自 HAR 捕获 iframe 文档 → /tmp/rch_script_0.js（421,699B）；
  fix10 的 12 份 RP.SRC + 8 份 XHR.BODY 落盘 /tmp/vm/（rp_3868_5=判决程序、xhrbody_5160_15=判决响应、
  rp_2428_6+xhrbody_3240_16=顶层收尾程序 POST-vs-GET 分支）。
- agent 任务书：定位 base64 变体解码器/runProgram 入口/操作码分派/常量池 → 解码 3,868B →
  输出判决分支的环境值读取清单与比较伪代码 + 600010/rcV 拼接点；报告落 /tmp/vm/REPORT.md。
- 收到报告后：按比较条件做针对性修复 → driver_v18 配方重跑 → 验证 verdict=complete → /1.txt 404。

## 2026-09-12 晚 VM 反混淆结果 + 新一轮决定性线索（fix71~fix78）

### A. VM 反混淆（agent，/tmp/vm/REPORT.md）关键结论
1. **600010 的来源**：它不是校验计算结果，而是 widget 的 `/fo/` 加载器 `mB` 在
   `status===400` 分支里的**默认码**：
   `yo="600010"; if(ct===application/json){d=JSON.parse(); if(d.err) yo=d.err}` →
   `postMessage({event:"fail", rcV:_cf_chl_opt.JWTz7, code:yo, ...})`。即 **CF 对我们的
   `/fo/` POST 回了错误状态/无效响应**，rcV 只是会话里原样读出的 `_cf_chl_opt.JWTz7`。
2. 解释器已跑通（bootstrap 程序 136/136 操作码全已知）；引导程序读取的环境面：`navigator.gpu`、
   `RTCPeerConnection`、`Function.prototype.toString` 原生性、隐藏同源 iframe(sandbox=allow-same-origin)
   + contentWindow 内 eval、`_cf_chl_opt.NOtMO3`，以及经 eval 注入的 `LgNW7`/`QBLZ6` 助手。
3. `/fo/` 载荷在 `D()` 与 `atob()` 之间还有一层按会话变换（自定义 base64 变体），本次未还原；
   2428 收尾程序 POST-form vs GET 不在可读前缀内。

### B. 本轮新证据（我做的）
1. **代理已坏**：`curl -x 代理 https://www.thelancet.com/1.txt` → 502 connection closed（多轮），
   这是 fix72~fix76 全部停滞的原因（mitm 里我们对 thelancet 只有 status=None 的 GET）。
   **直连可用**（403 挑战页），符合 §6"验证请求必须直连"。改用直连后挑战流程完整跑通。
2. crypto 全量 KAT（frame realm，vs Node）：HKDF/PBKDF2/HMAC/SHA-256/AES-GCM(含 AAD/70KB 大块/
   tag)/AES-CBC(含填充)/AES-CTR/HKDF→deriveKey 全部**逐字节一致** → 排除加密实现问题。
3. 仅 `crypto.subtle.digest` 被页面调用（871 次全 OK）→ 挑战的分组加密在 worker/VM 内自实现。
4. `Function.prototype.toString` 形态正确（`function NAME() { [native code] }`，仅 fetch/setTimeout 匿名）。
5. **XHR 字符串体缺省 Content-Type 缺陷（已修）**：Chrome 的 proof POST 带
   `content-type: text/plain;charset=UTF-8`（HAR 实证），我们的 XHR 不发该头。按 XHR 规范在
   `env/network/xhr.js` send() 补默认 `text/plain;charset=UTF-8`（作者已设则不覆盖），release 已重建。
   该修复正确但**未单独改变 verdict**（fix78 仍 5,196B fail 体）。
6. **任务桶键签名对拍（决定性结构差异）**：存在一个指针/交互遥测任务——
   - 真实 Chrome payload-3 桶39、HaHaVM payload-3 桶40 均输出 **16 字段**
     （IaAd4, LgSq1, MGOb8, NMxVQ0, RXaIh7, VXYW3, WohxC0, foeE3, hizUH3, jBVrk8, jyDXx2,
      mqdfc6, sDepp7, ttar5, uAvml7, wopX8；hizUH3≈24 键含 π/2 与计数；sDepp7=Error 栈）；
   - 我们只有 **6 字段变体**（MfOHt6,hCKCP8,jBVrk8,qdVjJ1,wikEk8,wopX8）。
   → 我们的采集**提前中断**，缺 14 字段。这是目前最强的"通过侧有、我方无"结构差异。
7. 已据此向 VM agent 追问：该任务的字段写入条件、6→16 的判据、最可能的失败点
   （报告将落 /tmp/vm/REPORT2.md）。

### C. 下一迭代
1. 收 REPORT2 → 按判据补齐被中断的采集路径（优先检查事件序列/rAF/hasFocus/screenX-Y/
   userActivation/performance entries/Permissions 等采样依赖）。
2. 每轮用**直连**（代理坏了）+ driver_v24 跑，检查 16 字段是否出现 → verdict 是否 complete。
3. 代理恢复后再跑代理路径与 mitm 头对拍。

## 2026-09-12 深夜（fix79~fix81）：VM 报告2 的机制结论 + 2 项引擎修复 + 交互计数对齐

### A. VM agent 报告2（/tmp/vm/REPORT2.md）决定性机制
1. **`gIBpo1` 的真正定义**：由 rch 脚本的 `w7()`（rch_decoded2.js:11060）创建（8 个计数器置 0），
   `wd()`（11373）在 **widget 自己的 `window.document`** 上注册 7 个 passive 监听器
   （keydown/pointermove/pointerover/touchstart/mousemove/wheel/click），处理器 `yM`（11456）
   按类型自增：pointermove→PklU5、pointerover→EeyrI1、mousemove→WtOKC4、touchstart→vlmO8、
   keydown→ouIbQ0、wheel→xaje4、click→XzKHN7，总数 gFvyY1=wm。
   `wd()` 调用点在 **POST /fo/ 之前**（9627），payload 序列化在 9667——**事件必须落在这两点之间**。
2. **16 字段 vs 6 字段是"同一任务槽的两套字面量分支"**，不是渐进补齐（字段名集不相交、同名字段
   类型不同、且只有交互非零的 payload 才有 16 字段版）。16 字段版 = gIBpo1 的富化形式
   （hizUH3 实为 **69 键**，含事件命中的 HTMLInputElement/HTMLBodyElement、控件几何 300×65 /
   168×24、computed style、Math.PI/2）。
3. **通过侧交互序列**：pointerover×1 → pointermove×16 + mousemove×16 → click×1；
   不要求 keydown/touchstart/wheel。事件必须落在 **widget iframe 自己的 document**。
4. **最可能失败点**：不是 API 缺失，而是"没有任何输入事件送达 widget document"（我们的
   payload-2fo 里 gIBpo1 存在但 8 计数全 0 = 监听器挂了但零事件）。
5. 澄清：`TzZRB1` 不是交互窗口而是 w7() 自身初始化耗时（13-16ms）；`jBVrk8`/`wopX8`/`jyDXx2`
   是跨任务复用的通用槽名，不能单独用于跨 payload 对齐。

### B. 本轮引擎修复（2 项，均有 Chrome/规范证据）
1. **XHR 字符串体缺省 Content-Type**（`env/network/xhr.js`）：Chrome 的 proof POST 带
   `content-type: text/plain;charset=UTF-8`（HAR 实证），我们原样不发。按 XHR 规范补默认值
   （作者已设则不覆盖）。
2. **未捕获异常不派发 error 事件**（`env/events/error-event.js` + `tools/timers.js`）：
   原实现对 timer/rAF 回调异常只 `console.error` 吞掉；现按 HTML "report the exception" 语义
   先调 `window.onerror`（返回 true 视为已处理）再在全局派发 `ErrorEvent`；同时 ErrorEvent 补齐
   `filename/lineno/colno` 字段（原先只有 message/error）。
   验证：本地 fixture 从 `["start","t1-before-throw","t3:2"]` 变为
   `["start","t1-before-throw","onerror:...","evt:...","t3:4"]`。

### C. 交互对齐实验（v25，/tmp/driver_v25.py）
早期（3.8-4.4s）在捕获到的 shadow checkbox 上合成完整序列（pointerover×1 + 16×(pointermove+
mousemove) + click），**widget realm 计数达到 pointermove:16 mousemove:16 pointerdown:1
pointerup:1 click:1 pointerover:1——与 Chrome 参考完全一致**，但 verdict 仍 fail 600010。
→ 说明判决还取决于 payload 内其它字段（16 字段分支的富化内容），而非仅计数。

### D. 观测受阻
- **代理 192.168.3.57:9000 对 thelancet 持续 502**（多次 curl 确认），mitm 里我们对该站只有
  status=None 的 GET。直连可用（403 挑战页）→ 现用直连跑。
- payload 明文原先靠代理注入的 `payloadJSON:` console 输出获得；代理坏后该观测面消失。
  尝试用 preload 包装 `JSON.stringify` 自采（钩子在测试页命中 1 次，证明可用），但挑战轮
  **零命中** → 挑战不使用 JSON.stringify 序列化 payload，此路径不可行。

### E. 门禁（本轮结束时）
- obscura-js(render) 598/598；workspace(render) 1785/1785（4 skipped）；no-default check 通过；
  精确 release 重建通过。改动文件 9 个（未提交）。

### F. 下一迭代（按可行性）
1. 代理恢复后：用 v25 配方跑并读 payload，确认 16 字段分支是否出现、以及新出现的字段值差异。
2. 若代理长期不可用：考虑在**服务器侧**不可见的前提下，用直接观测替代——例如在 widget realm
   记录 `wd()` 注册后的事件计数（已有）并比对 CF 期望序列（已对齐），把剩余工作转向 payload
   其它任务桶（pdiff 的 C/D 类）逐项修。
3. 每次改动后跑：obscura-js + workspace + release + no-default（本轮已全绿）。

## 2026-09-12 深夜续（fix84~fix92）：payload 结构追平 Chrome + 4 项新引擎修复 + 微观交互对齐

### 决定性对拍进展
用代理恢复后的 payload 明文 + Chrome 真值（assets/payload/3.json）逐层对拍：
1. **交互计数已达 Chrome 精确值**（PklU5=16/WtOKC4=16/XzKHN7=1/gFvyY1=34）。
2. **全局枚举 N=1163**（=HaHaVM 通过轮；此前 1167 是**探针自身污染**——v2x 脚本拼接在
   IIFE 外，`var cb/__isFrame`、`function findCb/interact/__fire` 成为 globalThis 自有属性。
   v27 起全部包进 IIFE，node vm 验证零泄漏）。教训：**探针必须验证零全局污染**。
3. **hizUH3（69 键交互证据字典）逐键对拍**找到微观差异并修复：
   - 点击点：Chrome x=17（checkbox 框左侧）vs 我们 input 中心 100.5 → v28 改为框内左侧；
   - 移动节奏：Chrome 事件间隔 8-9ms（快速滑动）vs 我们 91ms → v28 改 5-15ms 间隔；
   - screenX/Y：Chrome (285,365) 非零 vs 我们 (0,0)=headless 特征 → desktop_screen 默认
     改为 (674,25)；实测点击 screen 坐标变为 (691,58)=(674+17, 25+33) ✓；
   - 事件间隔修复后 jwfT9: 91→8（Chrome=9）✓。

### 本轮新落地引擎修复（4 项，全有证据，门禁全绿）
5. **渲染器图片子资源传输**（paint.rs + lib.rs + runtime.rs set_fingerprint 接线）：
   `http_get_bytes` 原用 ureq 直连（无视 --proxy、UA=Chrome/145 硬编码、非 stealth TLS）——
   `/ci/` 挑战图片从本机 IP 直连而 `/fo/` 走代理 = **同会话双客户端**。现在
   `set_image_transport(proxy, UA)` 由 set_fingerprint 注入，ureq agent 按代理+页面 UA 重建。
6. **frame document.referrer origin 下限**（page.rs navigate_frame_inner）：响应头
   `Referrer-Policy: same-origin` 下我们把跨源 iframe 的 scope referrer 置空；Chrome 实测
   （HAR 头 + payload 值双证据）仍报 origin。加 StrictOrigin 下限回退。实测 RotPR2
   ''→'https://www.thelancet.com/'（=Chrome 精确值）。
7. **navigator.userActivation 完整语义**（input-dispatch.js）：原先只是空壳对象；
   现在由 markTrusted 的激活类事件（keydown/mousedown/pointerdown/touchend/click）驱动
   hasBeenActive（粘性）+ isActive（5s 窗口），每读返回新 UserActivation 实例。
8. **桌面 screen_x/screen_y 默认 (674,25)**（fingerprint.rs）：非零窗口位置（所有通过侧
   会话均非零；(0,0) 是 headless 特征，且交互遥测直接记录 screen 坐标）。

### 门禁（本轮结束时全绿）
- obscura-js+browser+net 824/824；workspace 1785/1785（2 leaky, 4 skipped）；no-default 通过；
  release 重建通过；obstacle course 31/33（=既有基线）。

### 仍未解（下一迭代入口）
- verdict 仍 fail 600010。hizUH3 剩 28 键差：12 个 "undefined"（非 userActivation——已实现
  且仍 undefined；候选：pointerType/角度等从特定事件属性读取，但 click 在 Chrome 也是
  MouseEvent，来源待 VM 层定位）+ 几何组（168/34/177 vs 183/33/192——**mac Chrome 参考的
  文本宽度**，我们 UA=Windows，像素几何不该按 mac 定标，谨慎处理）+ idBTu5（末事件目标
  BODY vs INPUT，已加点击后 body 漂移但未生效——漂移可能发生在序列化之后）。
- 下一步优先：用已验证的解释器 harness（/tmp/vm/work/harness.js，bootstrap 136/136 跑通）
  定位判决程序读取 12 个 undefined 键的确切属性（wD 钩子法）；几何组需 Windows Chrome 参考
  或跳过。

## 2026-09-12 夜末（fix93~fix94）：12 个 undefined 键的机制收窄 + 全量程序捕获

### 新证据
1. **HaHaVM 通过轮几何=24（伪造）vs Chrome=168**——两者都过 → **几何键非判据**（降优先级，
   且 mac Chrome 参考与 Windows UA 矛盾，不追像素几何）。
2. 判据级差异最终收敛为 4+8 键：JalB8='mouse'/mqVhU5=π/2/uTVC8=1/idBTu5=BODY（两边通过侧
   一致）+ 8 个 0/false 键，我们全 undefined。
3. **mqVhU5=π/2 = PointerEvent.altitudeAngle 规范默认值**（W3C：鼠标 pointer altitude=π/2、
   azimuth=0；agent REPORT3.md）→ 12 键 = 一次 PointerEvent 扩展面转储。
4. 本地实测**排除引擎缺口**：PointerEvent 经 dispatch 扩展面全可读；window.event 在监听器内
   正确指向当前事件（isSame=true）；userActivation 语义完整（构造测试 hb=true/isa=true）。
   v30 显式传 altitudeAngle 等 init 字段仍 undefined → 挑战读的不是我们派发的事件对象，
   转储代码的条件执行分支在我们环境没走到，或读了其它来源。
5. **全量程序捕获完成**（stall_probe10 分块 + 重组）：/tmp/vm/full_634260.txt（采集器）、
   full_95424.txt（判决）、full_85324/6944/6032/3920/3868/3860/2428 全部无截断落盘。
   agent 已带着完整程序 + wD Proxy 钩子做最终定位（REPORT4.md 待出）。

### 引擎侧新增（本轮，已验证）
- v27+ 探针全 IIFE 零全局污染（node vm 验证；教训固化：**探针必须验证零泄漏**）。
- 交互微观对齐驱动 /tmp/driver_v29.py（点击点=checkbox 框左、5-15ms 快速移动、
  movementX/Y、点击后 body 漂移）。

### 待办
- 收 REPORT4 → 定位转储分支 → 针对性修复 → verdict=complete → /1.txt 404。

## 2026-09-12 收官（fix95~fix98）：trace 判决实验 + 第 9 项修复 + 门禁全绿

### 判决实验（filtered V8 api trace，+PointerEvent 过滤）
整轮挑战只有 1 条记录（`get PointerEvent.prototype`，rch 脚本 feature-detect）——
**采集器从未读过任何指针扩展属性**（pointerType/altitudeAngle/... 零命中）→
12 个 undefined 键的根因是 **dump 代码分支在我们环境从未执行**（不是读错对象；
与 body 直发 pointerdown 的 v31 实验互证）。

### VM 反混淆最终轮（agent REPORT4.md，/tmp/vm/）
- 13 份 full_* 均为合法 base64；已验证解释器穷举 K0/pc/会话 XOR/base64 置换全失败。
- 还原出密钥装载器机制：`LgNW7(<key>)→QBLZ6`（bootstrap charset 流中密钥串
  `sGabkxvHwYuNfTtN`），但字节层 repeating-XOR 仍解不开 → **逐会话流密码，密钥由
  bootstrap 闭包运行时装载**；离线 harness 卡在 DOM 完整性探测（appendChild 处）。
- 引擎内三钩方案已备（wB 输出侧 / window.LgNW7 setter 陷阱 / wD charset 代理），
  加上重放器 harness_full.js + rch_fullrun.js。
- dump 分支不执行的剩余解释：(a) 上游"捕获到 pointer 事件"条件未满足；(b) 监听器
  挂在 document 之外。最快判决 = charset 代理在通过侧/fail 侧各跑一轮 diff 属性名流。

### 第 9 项引擎修复：PointerEvent.getCoalescedEvents 语义
- 旧：恒 []；新：**trusted 输入管线事件返回 [this]（spec+Chrome），合成事件返回 []**。
- 派生测试更新：CDP click parity 的 coalesced 0→1（CDP 输入=真实管线）；Chrome slot-shape
  测试原样通过（合成事件仍 0）。obscura-js 598/598、workspace 1785/1785、release 重建、
  trace-capable(jsonl)、no-default 全部通过；obstacle 31/33 基线一致。

### 最终未决
- verdict 仍 fail 600010（60+ 轮）。已排除：payload 结构/计数/几何参考值/加密 KAT/
  事件表面/cookies/头。剩余唯一分叉：采集器的 pointer 扩展 dump 分支不执行，其前置
  条件需要 charset 代理或 wB 输出侧取证（下一迭代第一动作）。

## 2026-09-12 终局（fix99~fix100）：第 10 项修复 Event Timing + 判据排除汇总

### 第 10 项引擎修复：Event Timing API（标准缺口）
- 缺口实证：trusted 指针/点击事件 **零 PerformanceEventTiming 条目**（Chrome 为每次离散
  交互生成带 interactionId 的 'event' 条目 + 一次性 'first-input'）。
- 实现（env/performance/event-timing.js 新模块 + event-target.js dispatch 收尾处钩子）：
  PerformanceEventTiming 类（interactionId/processingStart/processingEnd/cancelable，
  [object PerformanceEventTiming]）、离散激活类事件（click/pointerdown/keydown/...）入
  timeline、首个交互追加 'first-input' 条目；内部全局 __obscura_queue_event_timing 由
  hide list 自动隐藏。本地验证：observer+getEntriesByType 均可见 2 条、interactionId 非零。
- 门禁：obscura-js 598/598、workspace 1785/1785（1 leaky, 4 skipped）、no-default 通过。

### 判据排除汇总（本轮全部实测否定）
Event Timing 实现后 12 个 undefined 键仍未消失 → 非唯一前置条件。已排除的前置候选：
Event Timing、userActivation、getCoalescedEvents、movementX/Y、window.event、
PointerEvent 扩展面、body 直发 pointerdown、显式 init 字段、探针污染。
**结合 fix96 的 V8 trace（零指针扩展读取），结论维持：12 键由 VM 内部槽位写出（初始化
undefined），填充代码的前置条件在采集器字节码内，离线反混淆被逐会话流密码阻断。**

### 下一迭代（唯一决定性路径，工具全备）
1. 引擎内挂 REPORT4 三钩之一拿采集器明文/读取流：
   - wB 输出侧（mL 构造器 rch_decoded2.js:4655 yC[247^yv]=wB(Q)）——需在引擎里包装
     runProgram 输出或对该行下断（可在 preload 重定义 runProgram 后 inspect 返回值属性）；
   - window.LgNW7 密钥 setter 陷阱（preload defineProperty 即可，无需引擎改动）；
   - wD charset 代理（String.fromCharCode 包装仅捕初始构建，价值低）。
2. Node 重放器已备：/tmp/vm/work/harness_full.js + rch_fullrun.js。
3. 拿到分支前置条件 → 修复 → verdict=complete → /1.txt 404 验收。

### 引擎修复累计 10 项（全部规范/Chrome 证据、门禁全绿、未提交）
1. crypto.subtle frame realm 密钥  2. 字体平台矛盾  3. ModelContext/WebMCPEvent 移除
4. WebGL viewport 自洽  5. XHR 缺省 Content-Type  6. 未捕获异常 ErrorEvent
7. 图片子资源代理+UA  8. referrer origin 下限+screenX/Y 非零+userActivation
9. getCoalescedEvents trusted 门控  10. Event Timing API

## 2026-09-13 凌晨（fix101~fix108）：流密码破解成功，采集器明文字节码到手

### 取证突破（按 verifier 指定路线执行）
1. **QBLZ6 密钥侧 setter 陷阱**（preload defineProperty，零全局污染）在真实引擎命中：
   - QBLZ6 全源码：`o[i]=k[i]^s.charCodeAt(i%s.length)` —— **16 字节重复 XOR 流密码**；
   - SET 时用全零输入调原函数**直接提取密钥流**：`sGabkxvHwYuNfTtN`（16B，34B 验证全对，
     /tmp/vm/session_key.txt）。
2. **同会话密钥+密文配对解密**（此前离线失败的正因：密文来自不同会话）：
   - /tmp/vm/plain_634268.bin（475,699B 采集器）
   - /tmp/vm/plain_95428.bin（71,569B 判决器）
   - plain_85324/6944/6032.bin
   解密头部 hex 与 agent 识别的采集器/判决器两族头完全吻合（解密正确性自证）。
3. agent（REPORT5 进行中）正用已验证解释器 + 重放器执行采集器明文，wD 代理记录属性名流，
   定位 12 个 hizUH3 键的写入点与前置条件。

### 工件索引
- 密钥：/tmp/vm/session_key.txt；明文：/tmp/vm/plain_*.bin；同轮密文：/tmp/vm/sess_*.txt
- 取证驱动：/tmp/driver_forensic2.py（QBLZ6 陷阱+全量 RP.P 捕获）
- 判据轮证据：/tmp/fix108/serve.log（13 key 行 + 5 程序 602 chunk）

## 2026-09-13 凌晨续（fix109~fix112）：同会话三件套取证完成（密钥+密文+当轮 rch）

### 取证链闭环（REPORT5 §3/§4 执行结果）
1. **addEventListener 判决实验**（fix109/110）：挑战每轮 /fo/ 后在 document 重挂同 7 个
   passive 监听器（click/keydown/mousemove/pointermove/pointerover/touchstart/wheel），
   注册时刻全部早于我们的合成交互 → 监听器时序/目标/isTrusted 判据排除；
   无任何额外 pointer-dump 监听器 → 12 键确由 VM 序列化路径写自内部槽位。
2. **同会话三件套**（fix112，JSON 转义修复 rch 换行截断后）：
   - 密钥：sGabkxvHwYuNfTtN（16B，QBLZ6 全零提取）
   - 当轮 rch 源码：/tmp/vm/s3_rch.js（400,358B 完整）
   - 同轮 5 份程序密文+解密明文：/tmp/vm/s3_prog_*.txt + s3_plain_*.bin
     （采集器 462,923B、判决器 71,567B，族头自证）
3. agent（REPORT6 待派）：用 s3_rch.js 提取本轮字符串表+取指魔数（管线现成），
   重放 s3_plain_617232（采集器）→ wD 流给出 12 键读取表达式与 dump 分支前置条件。

### 判据实验新增否定结论
- 挑战监听器注册时机/目标正常（不晚于交互）；无隐藏 dump 监听器。
- rch 捕获需 JSON 转义（源码含换行，裸输出被行解析截断为 24K/400K）。

## 2026-09-13（REPORT6）：VM 反混淆管线全线打通 + 重大方向纠正

### agent 管线成果（/tmp/vm/REPORT6.md，材料 = fix112 同会话三件套）
1. **字符串表 1,802 项全解**（校验和 383712，185 次旋转，解码器 q(J)=arr[J-251]），
   s3_rch.js 的 4,413 处引用全部明文化 → /tmp/vm/s3_decoded.js。
2. **构建常数证实逐轮换**：本轮入口 run(0,194,[])、取指 op=((raw+248)&255)^key、
   键链 key=((key+op)*28882+52737)&255（与 build-1 四项全不同）。
3. **方向纠正（关键）**：VM 的真实输入是 **atob(密文)**（family 头 08 07 fb 57...），
   在本轮常数下完美执行；XOR 明文（s3_plain_*）不是 VM 输入——QBLZ6 的 XOR 另有用途
   （疑程序内部数据加密）。后续分析全部切换为 atob(密文)。
4. **采集器已执行到信封区**：真实信封调用后 355 dispatch、34,741 字符常量流
   （/tmp/vm/collector_stream.txt），逐字段读 _cf_chl_opt（含 gIBpo1 创建），
   停在缺一个 rch 全局函数（J[n6(...)]），dump 段在其后。流中零 pointer 属性名，
   与引擎侧 V8 trace 判据一致（dump 分支未执行）。

### 我方判决实验（同期）
addEventListener 包装轮（fix109/110）：挑战每轮 /fo/ 后在 document 重挂同 7 个 passive
监听器，注册早于我们的交互，无额外 dump 监听器 → 12 键确由 VM 序列化路径写自内部槽位。

### 进行中
agent 迭代补缺失 rch 全局函数，直到 dump 段执行；届时 collector_stream 里 12 键名与
pointer 属性名的第一次出现 + 分支 pc 序列 = dump 前置条件（Chrome 通过 vs 我们 undefined
的对照判定）。拿到后做针对性引擎修复 → 完整挑战轮 → /1.txt 404。

## 2026-09-13 晚（fix113 + filter 语义判定）：dump 分支判据最终收窄

### Filter 语义判定（本地标定 + 真实轮）
- `--trace-api-filter` 支持全名匹配（本地 `Object.pointerType` 标定捕获 1 行）。
- 真实挑战轮以 `+Object.pointerType,+Object.altitudeAngle,+Object.pointerId,
  +Object.isPrimary,+Object.getCoalescedEvents` 过滤：**0 行**（挑战正常跑完，326 stall 事件）。
- 结合 HaHaVM 通过轮 trace 同样零 pointer 扩展 API 读取 → **12 个 undefined 键在我们引擎
  是"VM 槽位未填充"，且不是属性读取缺失**（快照对象读取也会被 V8 trace 捕获，零命中）。
  填充发生在交互期的事件处理（VM 内 handler 写槽），触发条件在采集器字节码内。

### HaHaVM 通过轮交互窗口 API 直方图（新参照）
interactiveBegin→interactiveEnd（10727-11344ms）：screenX/screenY 各 38 次（交互监控轮询）、
DOM 更新（setAttribute/classList/innerHTML 14/13/5）、DocumentFragment.querySelector 9、
setTimeout 3、Worker.onmessage/postMessage 各 1。无任何 pointer 扩展读取。
（我们引擎在该窗口的对应行为已对齐：screenX/Y 可读（674,25）、UI 构建、心跳。）

### 状态
- agent（REPORT7 迭代）22:29 限额重置后继续：补缺失 rch 全局函数 → dump 段执行 →
  12 键写入点/分支前置条件。这是最后一环。
- 本轮引擎无新改动；全部证据与工具已固化。

## 2026-09-13 夜（REPORT7）：采集器同步段全线贯通，dump 段锁定在异步门后

### agent 迭代成果（/tmp/vm/REPORT7.md）
- **采集器 1,876 dispatch 完整跑通同步段**（355→1876，常量流 34,741→93,737 字符）；
  判决器同环境 1,284 dispatch 同步段也完整。零异常。
- 6 项 crash 根因修复（harness 层）：字符串表旋转 185（去混淆 pass 的根因级 bug）、
  top/self iframe 语义、NOtMO3=closed ShadowRoot、Node 方法面、uxtN4 处理器、
  m5 receiver-void 回退。
- 同步段完成内容（流中按序可读）：41 个 _cf_chl_opt 字段信封、DOM 完整性序列
  （outerHTML→head→NOtMO3.mode→compareDocumentPosition→attachShadow→URL/Blob）、
  Worker 源码构建（navigator 五元组 + 5s qmxM8）、window message/error 监听（isTrusted/origin 检查）。
- **判定：dump 段在异步门后**（worker/消息回调之后）；采集器自身不挂 document 监听
  （印证 fix109/110）；同步段零 pointer 读取（印证 fix113）。
- 剩余 3 项前置（REPORT7 §4 #6-8）：gIBpo1 计数器（w7，需 init 完整跑）、Worker 真实可用、
  rch JI 消息协议（source/widgetId/isTrusted/origin 校验）。

### 已发 REPORT8 任务
agent 实现消息协议驱动 → init 完整（装 wd()/w7()/uxtN4）→ new Worker → worker 回复 +
完整交互序列 → 流中 12 键首次出现处 = 填充条件与机制 → 最终判定清单。

## 2026-09-13 深夜（REPORT8 收口）：dump 段机制完全定位

### agent 收口判定（/tmp/vm/REPORT8.md）
1. **消息协议打通**：config 消息要求 event='extraParams' 且 data.ch==='330e41bb475c'
   （hex(56136325351260)，s3_decoded.js:1762）；ch 匹配后 widget init 完整跑完，
   gIBpo1/lSKCv5/xZLH1 由真实代码创建。
2. **runner 自装链揭示**：HZGAc5→ohAU5→Worker.addEventListener→xVQL7→NIsa2→eval→
   LgNW7(XOR 工厂)→**Function.toString(原生性检查)**→createElement→appendChild→remove
   →String.repeat→now——与 build-1 同构。
3. **最终判定**：12 键不从 PointerEvent getter 读（双证据：V8 trace 零 + VM 链零）；
   hizU3 = gIBpo1 计数器的富化快照，由**最后一轮 /fo/ 程序在交互后读取非零 gIBpo1** 走
   16 字段分支序列化。**我们引擎 undefined 的机制 = dump 轮从未执行（挑战轮在反篡改链
   中断），首要嫌疑 Function.prototype.toString 原生性检查（注入函数暴露）与 Worker/Blob/URL 链**。
4. 引擎验收法：包 9 个 API（eval/Function.toString/createElement('iframe')/appendChild/
   remove/new Worker/Blob/URL.createObjectURL/String.repeat）记录调用与返回——第一个失败
   或未出现的环节即断点。

### 我方下一步（引擎断点定位法）
1. preload 包装 9 API（零全局泄漏、透传语义）跑真实挑战轮；
2. 定位 VM runner 链在我们引擎的第一个中断点（toString 检查/Worker 链）；
3. 修复（引擎通用语义，非站点特判）→ 完整挑战轮 → verdict=complete → /1.txt 404。

## 2026-09-13 深夜续（本轮会话）：toString 全原生呈现 + 600010 双因定位 + 12 键值级收窄

### A. 引擎修复（已重建，待门禁）
1. **`_markRemainingBuiltinsNative` 终扫**（webidl-branding.js 尾部新增）：构造器**静态成员**
   （URL.createObjectURL/revokeObjectURL/parse/canParse 原先直接暴露 bootstrap 源码！）、
   window 自有访问器（location/scrollX/... 现为 `function get X() { [native code] }`）、
   迟到安装（SVG 方法）。对拍 HaHaVM-General 全部一致（createObjectURL/parse 名形全对）。
2. **`document.all` getter 安装点自标记**（postlude.js）：每次导航重装的 getter 现自带
   _markNative（终扫之后重装导致的漏标根因）。
3. 剩余已知非链差异（未修）：HTMLAnchorElement 等 31 个别名类 `.name==='Element'`（HaHaVM
   为各自正确名）；off-chain，记档待后续。

### B. 方法论修正（重要，避免再次误判）
1. **UA 必须用 Windows Chrome/148**（与引擎指纹全套自洽：字体/screen/webgl）。macOS UA 轮
   行为完全不同（widget 静默、privacy 链接误点）。
2. **CDP Input.dispatchMouseEvent 在 1.4-2.2s 程序窗内会死锁帧路径**（此前已知，本轮复证）：
   交互必须用 v31 预载合成法（shadow-root checkbox 定位 + markTrusted 合成序列）。
3. v31 合成点击后 CDP 模板点击 (209,337) 会误中 widget 的 Privacy Policy 链接——第二轮起
   禁用 CDP 点击（--move-at 999）。

### C. 600010 双因裁决（关键）
1. **传输因（代理路径）**：~90KB proof POST 在 mitmproxy 复用 h2 连接上触发 python-h2
   `Flow control window shrunk below 0` → 连接被杀 → 挑战自动重试 → CF 拒绝重试载荷。
   **直连（fix77-81 实证 + 本轮 dir1 复证）#3 POST 恒 200** → 引擎 wreq/h2 发送侧无罪，
   mitmproxy 入站流控为公认薄弱点。wreq-proto 0.2.5/0.2.6 的 send 循环（capacity>0 即整块
   send_data）虽不优雅但 h2 crate 会按窗缓冲，非本案根因。
2. **载荷因（直连也在）**：dir1 直连 #3→200 仍 600010 → 载荷内容仍被判否。

### D. 载荷收窄到值级（v31new 代理轮，payloadJSON 注入可见）
- **dump 轮已跑**：task-40 hizUH3 **69 键全现、结构=Chrome**（此前 6 字段/12 键缺失时代结束）。
- 剩余差异 28 项分三类：
  a. **12 键值为字符串 `'undefined'`**（BCSl5/CKKj8/JalB8/mMcSd5/cRTQ6/eCWJ1/gMXoS1/gYJnV9/
     goGiB6/jjZMA4/mqVhU5/uTVC8；Chrome=0/false/'mouse'/1/π/2/1/0）——末指针事件快照类字段；
  b. 点击坐标/计数 off-by-small（192/183 vs 177/168、33 vs 34、12 vs 13、8 vs 9）：v31 合成
     点击 (17,33) vs Chrome (29,28) 及 move 计数微差；
  c. idBTu5 末事件目标 INPUT vs BODY、oujg8/OSfrq2 时长类、zXVve9 1/0。
- 下一步：V8 trace（--trace-api-filter Object.pointerType 等 18 项）跑代理轮，看 dump 序列化
  前 12 键的真实读取路径与返回值（此前 trace 为零是因为 dump 轮根本没跑）。

### E. v32 CDP 原生输入驱动 + 直连完整轮（本轮核心实验）
1. **v32 驱动**：预载报告 CBRECT（checkbox 框内几何）+ IFRECT（iframe 页坐标）；python 侧
   tail serve.log 等 interactiveBegin，再以 CDP Input.dispatchMouseEvent 回放 HaHaVM 模板扫
   + 点击（绕开 1.4-2.2s 死锁窗，交互发生在 ~8s）。
2. **CDP 原生输入使 12 键全部填充**（v32b 代理轮 payload 实证：hizUH3 69 键 0 个
   'undefined'）——预载合成事件（构造器填充字段）不足以填充，引擎真实输入管线状态才行。
3. 直连 v32c：POST#3 干净 200、11s 人类节奏、69 键全填、点击点=Chrome 参考 (29,28)
   → 仍 600010。剩余值差 21 项（大多会话变量：时间戳/坐标/计数微差；系统性：
   idBTu5 末目标 INPUT vs BODY——v32 无点击后漂移；zXVve9 1 vs 0）。
4. **对照**：HaHaVM rust_tls_forward 服务（本机 :3000）持有历史有效 cf_clearance，
   同代理直取 1.txt → **404**（源站真实响应）——环境/IP 未被封，验收路径已验证可行。

### F. 门禁（marking 修复后）
- obscura-js：597/598（唯一失败 service_worker_container 为环境性网络测试：example.com/sw.js
  在引擎内取到 "unknown error"，改回旧 bootstrap 复跑同样失败 → 与本轮改动无关）。
- workspace：1784/1785（同上 1 例）；no-default check 通过；release render 重建通过。
- obstacle course：31/33 = 既有基线（fingerprint/Win32-Europe-Berlin 硬编码期望过期）。

### G. REPORT9（子 agent，/tmp/vman/REPORT9.md）+ 后续引擎修复 + HaHaVM 当日对照
1. **12 键数据源裁决**：12 键 = **click 事件本身的 PointerEvent 扩展面**（pointerType/altitudeAngle/
   pressure/tiltX/Y/twist/tangentialPressure/azimuthAngle=0×6、pointerId/width/height=1×3、
   **isPrimary=false（Chrome click 特有）**），由 ~95KB dump 程序自注册的 click 监听器读取。
   v31 预载把 click 建成 MouseEvent（`T.indexOf('pointer')===0?PointerEvent:MouseEvent`）→ 12 键
   undefined。旧"V8 trace 零读取"结论是滤波伪影（MouseEvent 上读 .pointerType 无 accessor 可记）。
2. **事件 screen 坐标不变式修复（引擎，已落地）**：真实浏览器 event.screenX-clientX==window.screenLeft；
   我们 window=(674,25) 但事件 screenX=clientX → 每个事件违反 674px。input.rs 7 处事件模板改为
   `+globalThis.__obscura_window_origin_x/y()`（input-dispatch.js 新增 helper）。本地验证 774-100=674 ✓。
   40/40 input/screen 相关测试通过。
3. **HaHaVM 当日新鲜对照（关键实验）**：另起 rust_tls_forward 实例（:3007，未动原服务）→ HaHaVM
   经同代理新鲜解题 **成功拿到 cf_clearance**（= 网络/IP/wreq TLS 栈全部无罪，我们引擎的 wreq 与
   其同库）；复访 403 是 clearance 绑出口 IP + 复访缺伴随 cookie（非阻塞）。旧 clearance 直取 1.txt=404
   已证验收路径。
4. **三向 hizUH3 对拍（HaHaVM-pass vs 我们-fail vs Chrome-ref）**：69 键全同；12 个 pointer 键
   **三方逐字一致**；zXVve9=1 双方一致（排除）；剩余差异全部是交互遥测族（计数 8-9 vs 14-15/17、
   坐标族 192/183 vs 33/24——widget 布局位置、点击/末事件坐标、elapsed ms）——两通过方的这些值
   彼此也大不相同 → 均在会话方差内。payload#2 任务桶仅逐轮置换，结构等价。
5. **本轮已排除**：worker 纯算力（224ms vs Node 221ms 持平）、微 op 全套（performance.now/Date.now/
   charCodeAt/Math/数组/对象/JSON 全持平）、55ms×100 定时链（5718 vs 5619ms 持平）、
   round-1 envelope 亚毫秒计时（Chrome 参考 16/17/9/4/2 与我们 4/5/2/9/1 同量级）。
6. **下一迭代最高价值路径**：HaHaVM 的通过环境契约就在 `examples/cloudflare/lib/cfPatches.js`（可读），
   与我们 bootstrap 逐值对拍（字体/WebGL/perf 画像/任何值级补丁）；新鲜 10MB trace
   （/tmp/haha_fresh/trace.log）可继续挖 Worker 分片值与 api.js 装载路径差异（eval vs http 栈形态）。
7. 环境维护注记：原 rust_tls_forward(:3001/:3056) 被误杀后已原端口重启（cookie jar 清空，
   旧 thelancet clearance 随之失效；服务本身恢复正常）。pan2(:3000) 未受影响。

### H. 门禁（screen 不变式修复后）
- input/mouse/screen 相关：40/40 ✓；workspace 1784/1785（唯一失败=环境性 example.com 网络测试）；
  no-default check ✓；release render 重建 ✓；obstacle 31/33=基线。

## 2026-09-13 续（cfPatches 逐值对拍轮）：CSSOM/几何/LoAF/连接面五项引擎修复 + 任务桶值级 diff
### A. 引擎修复（本轮落地，workspace 1785/1785 全绿后两项又改）
1. **CSS 枚举补全**（HaHaVM cfPatches 的 TextEncoder 表 = Chrome 抓取表）：
   - getComputedStyle 索引取值修复（get 陷阱数字键回名称，原返回 ''）；
   - 枚举表换成 Chrome 精确 456 名 + 694 camelCase 键（`_CSS_COMPUTED_CAMEL_KEYS`）；
   - 694 键 Chrome 新鲜元素缺省值层（`_CHROME_COMPUTED_DEFAULTS`，仅末端回退）；
   - JSON.stringify(getComputedStyle(el)) 键集 **1150/1150** 与 Chrome 一致，值差 506→14（余 14 为
     对方会话环境值：PingFang SC/8px margin 等，未照搬）；
   - CSSKeyframesRule/CSSKeyframeRule 真类（.name/.cssRules/appendRule），规则工厂接入。
2. **窗口几何**：默认 desktop_screen 改为 HaHaVM 通过配置同款——3440×1440、avail 3440×1326@top25、
   窗口 2309×1326@(674,25)。dpr=2 试装后因渲染翻倍破坏截图字节测试回退为 1（3440@100% 同样自洽）。
3. **toStringTag**：visualViewport（geometry+page-init 两处定义都要补）/navigation/speechSynthesis/
   indexedDB 由裸对象补为 [object VisualViewport] 等。
4. **LoAF/visibility-state 时间线条目**（新模块 long-animation-frame.js + timers/rAF 任务计量包装）：
   >50ms 真实任务时长产出 PerformanceLongAnimationFrameTiming；初始 VisibilityStateEntry('visible')。
   含 CSSOM/CSS 相关测试更新（枚举计数 456/1150、timeline 含 visibility-state）。
5. **连接面**：NetworkInformation.type='wifi'（探针曾读 null）；storage.estimate quota 5GB→
   200-300GB 带（_fpRand 每安装稳定）。
### B. 任务桶值级 diff（v38 代理轮 payloadJSON vs HaHaVM 新鲜通过轮）——核心结论
1. **HaHaVM 通过轮携带大量自不洽值**（Apple M5 GPU 配 Windows UA、zh-CN Intl、瑞士键盘、
   eval 栈 api.js）→ CF 不做这些交叉硬校验；**空值/占位符才是硬伤**。
2. 我们已修复的空值：fonts 探针（此前整桶 null→今有值）、connection.type、storage quota。
3. 仍开放的差异：task19 分片聚合哈希其一 = sha256('')（某探针输出空）+ 一槽为字符串表名（异步
   结果未到）；task9.qEwJM8 [0,0,0] vs [124,12.7,674.037]；task24.TWIqp9 '' vs 有值；
   task1.XCvwf5 多出 zThuI4='denied' 键；task36 阴影结构 token 串不同。
4. trace 实测：V8 --trace-api（全名 836 项过滤）在交互轮会让 loader 后续超时（509-1931 行即死）
   ——重窗内 trace 不可用，改用静态重放对拍路线。
### C. 子 agent（REPORT10）进行中
   全量 836 成员接收者感知重放 vs 我们引擎，产出完整分岔表（/tmp/replay/REPORT10.md）。

### D. REPORT10 落地 + 传输层平台/h1 双修复 + 驱动去泄漏（本轮收尾）
1. **REPORT10（/tmp/replay/REPORT10.md）836 成员重放对拍**，落地引擎修复：
   元素/文档 [object HTMLDivElement]/[object HTMLDocument] 每实例 toStringTag getter
   （~120 标签映射表）；WebGL 41 个 getParameter 常量补齐 + VIEWPORT/SCISSOR_BOX 随
   drawingBuffer；SAMPLE_BUFFERS/SAMPLES 1/4（与 antialias 默认自洽）；压缩机 -24/30/12
   规范定值（原每次上下文随机=自相矛盾）；speechSynthesis 21 声（Windows+Google 集）；
   Plugin↔MimeType 双向链接（原插件 0 mime=无头形态）。canvas 6 键为 Chrome 148 正确
   形态（colorType/toneMapping），试删后回退。
2. **传输层**：TLS 仿真 Platform::MacOS 硬编码 → 按指纹 UA 动态（Windows）；
   **代理路径 http1_only()**（mitmproxy 对 ~90KB h2 上传的入站流控会计 bug 杀连接——
   修复后 POST#3 代理路径首次即 200，v42/v44 两轮 /fo/ 响应开始下发 cf_clearance
   Set-Cookie，为当日首次；但 curl 复验该 cookie 直连/代理均 403——verdict 内核仍是
   600010，cookie 下发≠判定通过）。
3. **驱动去泄漏**：诊断预载 window.__xid/window.__dumpCnt 在 window 枚举探针
   （task1.gsLi5 组1 出现 o.__xid）暴露——改为闭包计数；v50 驱动同时带 acceptance
   观察器（CF verdict=complete 后自动轮询 1.txt 复访状态）。
4. **仍未解**：verdict=600010。剩余可测分岔：**window 自有键插入顺序**（gsLi5 组'o'
   我们 window,self,document… vs Chrome globalThis,JSON,Math,…,document 完全不同序——
   CF 哈希窗口枚举顺序）；任务时长画像（hCfV6）；残余微差。window 键序对齐=深改
   bootstrap 插入序/枚举归一化器，风险面大，留待下一轮。
5. 门禁：workspace 1785/1785（含本轮 4 个测试期望随 Chrome 正确形态更新）。

### E. 2026-09-13 凌晨（v46/v47）：worker 时钟根因修复 + sha256('') 消除
1. **worker 时钟根因**（本轮最重要发现）：分片 worker 回包 PySu2 第 4 字段（计算时长）
   恒为 19072ms = 进程 uptime——worker 隔离体从启动快照继承 `_perfOriginMono`
   （进程启动时的单调基线），而页面域每次导航都经 `__obscura_rebasePerformanceOrigin`
   重基准，worker 的 prep 模板从不调用（clock.js 注释自证）。CF 服务端对 100 次哈希
   迭代"耗时 19 秒"的证明直接拒绝。**修复**：WORKER_PREP_TEMPLATE 顶部对 worker
   创建时刻重基准 + 设 timeOrigin。v47 实测：PySu2=10535（≈worker 创建至分片应答
   的真实时长，与通过侧 3007/4011/9348 同形态）；**payload 中 sha256('') 空哈希槽
   消失**（此前 RKUE0 恒为空串哈希）。
2. v47 轮 verdict 仍 600010。任务记录对比（同 build 槽名可比）：
   - 字体任务 14 键齐全，XdgW5 真哈希 ✓；peEN1/mrxg2 差异=平台字体集（合理方差）；
   - **残余硬分岔 2 项**：qEwJM8 [0,0,0] vs [124,12.71875,674.0369]（某几何探针在我们
     环境量得全零——疑似文本量宽/元素盒测量）；JRzmw6='bOHv4'/ZwhIC5='SbFJC2' 短名
     槽 vs 通过侧 64/32-hex（两个哈希槽从未被写入，疑与 qEwJM8 同源：探针产出空）。
3. v46 加装 TextEncoder.encode 实参记录器（driver_v51）：widget 轮完整探针串流已可
   与 HaHaVM trace 逐串对拍（CSS 表 29237B ✓、keyframes 20234B ✓、字体串 ✓、
   '0'/'16.6875'/'0.07697' 时序值 ✓、NUL/pixel 串 ✓）。
4. 门禁：workspace 1785/1785（worker+performance 45/45）、no-default ✓、release ✓。
   环境注记：worker_bench 空闲页不投递 worker 消息（unref 语义），诊断需保持主线程
   忙或用引擎自测（35/35 过）——勿再被该假象误导。

### F. 2026-09-13 凌晨收口：内联几何分岔（qEwJM8 根因）——精确定位但暂不落地
1. **根因定位（完整证据链）**：`flatten_boxless_inline_children`（dom.rs:13412）把无盒内联
   （`<span>` 裸内联）在 build 分类前拍平成其文本子节点（`is_flattenable_inline`：inline/无
   bg/border/position/float/pseudo 即拍平）。后果：块级混合 run 的 collect_node_spans 只见
   文本不见 span 元素 → 无 owner box → `synthesize_shaped_inline_fragments` 不产出 →
   `getBoundingClientRect`=0×0、`getClientRects`=0（本地 fixture 双复现：body 直挂 span
   [0,0,0]；p 内 span 正常 [70.85,17,1]）。**这就是 payload qEwJM8 [0,0,0] vs
   [124,12.7,674.03] 的机制**。
2. **修复尝试与回退**：限制拍平条件（只拍 display:contents/块包裹内联）后 CSSOM 全对
   （span 96.08×17 ✓）——但 `rotate_and_scale_paint_complete_mixed_subtrees` 失败：
   transform 子树内的 run 文本不再光栅化（scale(2) 下 span 文本完全消失，与整树深改的
   paint 管线耦合：绝对定位+transform 的 div 走 whole-IFC/absolute 路径，run item 的
   finalize/anon_rects 不吃 transforms）。**已回退**，render 589/589、workspace 1785/1785
   恢复全绿。
3. **下一轮正确修法（已论证）**：保留拍平（paint 不动），在 flatten 时记录
   文本节点→被拍平内联元素 的 owner 映射，collect_node_spans 的 text 分支按映射
   begin_owner(被拍平的 span)——owner 链恢复后 synthesize_shaped_inline_fragments 自然
   给 span 产出 CSSOM 盒，paint 路径零改动。
4. 环境注记：OBSCURA_DEBUG_INLINE_OWNERS 临时日志已全部剥离；diag 假象再记一条——
   fetch 的 stderr 重定向单次偶发丢 eprintln（用 2>> 累积多次可靠）。

### G. 2026-09-13 晨（v48/v49）：内联 owner 链修复落地（全绿）——widget 内 qEwJM8 仍 [0,0,0]
1. **修复落地**：`flatten_boxless_inline_chained`（dom.rs）拍平时记录每个幸存后代节点的
   被拍平内联祖先链（外层在前，存 IfcRegistry.flattened_owner_chains）；
   `try_build_run`（inline.rs）对 run 内带链子节点按链 begin_owner/end_owner。
   效果：混合块直挂 span 恢复 CSSOM 盒（fixture：body>span [0,0,0]→[96.08,17,1]，
   p>span 不回归 [70.85,17]，scale(2) 子树 span [79.97,28] 且文本光栅化正常
   （此前尝试限制拍平时此景回归，owner 链法零回归）。
2. **门禁**：obscura-render 589/589（含 rotate_and_scale_paint_complete_mixed_subtrees）、
   workspace 1785/1785、no-default ✓、release ✓。
3. **挑战轮（v48 直连 / v49 代理）**：verdict 仍 600010；**widget 内 qEwJM8 仍 [0,0,0]**
   （peEN1 字体键正常有值）——即 widget 探针测量的元素处于本修复未覆盖的布局路径：
   候选 = flex-row 近似回退路径的 run（未折叠时的逐子构建）、闭 shadow DOM 内文本、
   或测量时点早于帧布局重prepare。qEwJM8 值非 HaHaVM 伪造（其源码无此数），
   是通过侧真实测量（124, 12.71875, 674.0369=screenX+亚像素）。
4. **下一锚点**：在 widget 真轮里对 [0,0,0] 探针做元素级定位（预载包装
   getBoundingClientRect 记录首次返回全零的元素选择器/路径），再对应补
   flex 回退路径/shadow DOM 的 owner 覆盖。

### H. v50：zero-rect 元素级定位（widget 探针仍未见）
- 预载包装 getBoundingClientRect 记录全零首 40 个：只有 TOP 域 12 个（HEAD 无盒元素 +
  一个空 DIV.YYXc3），**WIDGET 域零记录** → qEwJM8 的 [0,0,0] 不来自 widget 内
  connected 元素的 getBoundingClientRect。候选改判：SVG 文本几何（getStartPositionOfChar/
  getComputedTextLength 族，通过侧值 12.71875=字号系）、getClientRects/offsetWidth 路径、
  或非元素测量（如 range）。下轮包装上述族再定位。

## 2026-09-13 午后（本轮会话）：对拍流程升级 + 五项引擎修复（Chrome oracle 全证）

### 用户指正（流程级）
- 早前对拍是按怀疑家族点名，不是全量 API 调用名 diff；AudioBuffer.getChannelData
  这类缺口是从 payload [enc] 字符串（0|0|0 流）倒查发现的，流程缺陷被点名。
- 本轮建立全量对拍工具：WRAPALL 预载（按 HaHaVM 通过轮 trace 的 830 个
  Interface.member 包 call 层）→ 我方调用名集 → 与 HaHaVM call-only 名集 diff。
- 结论固化：**对拍必须全量名 diff，不能点名**。我方 V8 原生 --trace-api 只记
  get/set（call 层是已知缺口），call 级对拍用 WRAPALL 预载。

### 本轮修复（全部 Chrome/HaHaVM 证据 + 门禁）
1. **SVG fragment 几何**（新模块 env/html/svg-geometry.js）：
   - getCTM/getScreenCTM（own transform×祖先×viewBox；+root 原点+窗口原点）
   - SVG 子元素 gBCR/gCRs = bbox 角点经 viewport CTM 映射（rotate 换宽高）
   - getBBox 容器 union + text x/y 属性定位
   - SVGGeometryElement.getTotalLength/getPointAtLength（路径全命令 + 基本形状）
   - chrome headless 双 fixture 对拍：CTM/screenCTM/映射值逐项相等；
     focused test svg_fragment_geometry_matches_chrome_mapping 绿。
   - 修复过两处自坑：computed-style↔gBCR 重入死循环（_measuringFragment 守卫）；
     arc→bezier 控制点符号（圆周长 132.8→125.66）。
2. **LayoutUnit 溢出钳制**：width 8e37px/-8e37px/8e37%/1e39em → Chrome 精确值
   "3.35544e+07px"（computed-style clampAuthoredDimension + chromeLengthPx
   科学计数法序列化；gBCR/client metrics 同步 ±33554430 钳制）。
   动因：widget 字体探针 div（"WW ssss tttt"）computed width=8.00000045411289e+37px
   ——Chrome 不可能产生的值（zl 调用点捕获 48 次）。
3. **OfflineAudioContext 真实 DSP 渲染**（audio-context-behavior.js）：
   - 旧实现 [4500,5000) 求和窗口在 length=1000 的 CF 探针上下文里 sum=0 →
     全零（[enc] "0|0|..." 500×2 流的根因）。
   - 新实现：WeakMap 图连接 + Web Audio spec 振荡器四波形 + spec 软膝
     DynamicsCompressor（峰值包络+dB 曲线+Chrome makeup -(θ+κ/2)/ρ）。
   - 实测 CF 同形探针（triangle 10kHz→compressor→render 1000样本）：
     1000/1000 非零、结构化波形、reduction=-14.6dB。
   - HaHaVM trace 证实探针图：2×triangle osc→默认参数 compressor→
     OfflineAudioContext(1,1000,44100) startRendering×3→getChannelData×4。
4. **音频接口形状**：AudioScheduledSourceNode→AudioNode 等原型链 + 工厂对象
   _bindInterface；AudioContext/OfflineAudioContext.prototype→BaseAudioContext
   （webidl-branding 晚绑定，surface shells 之后）。instanceof 全绿。
5. **AI 接口静态**：Summarizer/LanguageDetector/Translator/Writer/Proofreader/
   Prompt .availability()→Promise.resolve('unavailable')（HaHaVM 同值）+ .create()。
   之前 CF 调 Summarizer.availability 直接 TypeError。
   CanvasGradient/SpeechSynthesis 实例 setPrototypeOf（instanceof 补齐）。

### 对拍名 diff 的三分类教训
- 89 个 HaHaVM-call-only 名中：多数为包装器盲区（我们方法在 Element.prototype
  继承链上 / URL.createObjectURL 是 static / 本轮 ray 未跑该批任务）；
  真缺口=音频接口形状 + Summarizer.availability + （WGSLLanguageFeatures 类壳）。
  均已修或形状已补。

### 挑战轮状态（svg9，全部修复后）
- interactiveBegin/CBRECT/CDP click 链路正常；verdict 仍 600010；
  qEwJM8 仍 [0,0,0]；JRzmw6 仍 'bOHv4'（短名槽）；PySu2/XdgW5 正常有值。
- 全量 call 对拍轮（apidiff3）里 widget 域从未调用 SVG 家族（getBBox×0）——
  但包装器 own-descriptor 盲区使其不可见，需换 in-chain 包装再验。

### 门禁
- focused svg_fragment_geometry 1/1；obscura-js 全 crate 599/599；
  no-default check ✓；release render 重建 ✓；workspace 门后台运行中。

### 下一迭代入口
1. **widget 内部视口宽度**：widget 元素布局 800 宽（KlEi0 w=800），Chrome 应为
   iframe 尺寸（~300-400，turnstile 展开面板）；YYXc3 0×0 疑与 body 宽度链
   相关。下轮预载记录 W 域 innerWidth/documentElement.clientWidth。
2. qEwJM8 元素定位：用已解密采集器重放器（/tmp/vm 管线）跑任务 9 的读取流，
   或 WRAPALL 修 in-chain 包装后在真轮抓首个 [0,0,0] 三元组调用。
3. JRzmw6 'bOHv4' 短名槽：与 qEwJM8 疑同源（任务早退），定位后同修。

### 本轮末决定性发现（下一迭代第一优先）
[vp] 视口探针（svg10 轮）：
- t3s：turnstile iframe 视口 300×65（正确）；
- t8s：**同一 iframe innerWidth=0/innerHeight=0、body clientWidth/gBCR=0**，
  而 documentElement.clientWidth 仍报 1280（疑似错误回退到顶层视口）。
- 这就是 qEwJM8=[0,0,0] 的直接机制：挑战在 t8s 后测量的所有几何都在
  0 宽布局里。Chrome 同期 widget 保持可见（通过侧值 [124,12.71875,674.0]）。
- 下一步（顺序）：
  1. TOP 域记录 iframe 元素 gBCR+style+outerHTML@3s/8s/13s，判断是
     TOP 侧样式/布局把 iframe 折成 0×0，还是 frame 视口更新逻辑没跟上
     iframe 尺寸（两修法不同）；
  2. 顺带查 documentElement.clientWidth 为何仍 1280（应随 frame 视口）。

### 2026-09-13 晚（续）：widget 坍缩根因链——已收敛到引擎侧 DOM 替换
证据链（svg10-29 共 12 轮，全部复现）：
1. **坍缩形态**（[shif] host 链观察）：ray1 的 widget 容器链
   `host(div)>div>div#lVJB5>…>body` 健康（896×65，iframe 300×65）→
   交互转换瞬间（t≈6-8s，第二轮 /fo/ 提交窗口）变为
   `host(div 0×0)>div(0×0)>parentElement=NULL 且 root 无 host` =
   子树处于无宿主游离树；iframe computed 样式仍 300px/65px 但盒子 0×0。
   坍缩后 rch frame（采集器所在域）innerWidth=0 → qEwJM8 全零测量。
2. **JS 侧全部排除**（v66-v71 五层钩子，零命中）：
   appendChild/insertBefore/removeChild/replaceChild/remove/before/after/
   replaceWith/append/prepend（含 shadow-host 祖先感知过滤）、
   Element.innerHTML/outerHTML/textContent setter、
   DocumentFragment/ShadowRoot.innerHTML/replaceChildren、
   apiJsMismatchReload（全程 attempts=0）。
   双 [ft] T 系列是 ray1+ray2 重启（正常），非中途导航。
3. **本地复现全部与 Chrome 逐值一致**（未复现坍缩）：light/shadow 内移动、
   嵌套 shadow 移动、before/after/replaceWith、fragment 五种插入
   （Chrome 同样 shadow 直子 parentElement=NULL）、iframe 导航、
   二次 attachShadow（我们正确 throw）。
4. **结论**：detach/替换发生在 Rust 引擎侧，JS 不可见。首要嫌疑：
   page.rs:3905 附近 frame loader 的 nid 记账（"host nids belong to the
   replaced tree… nids restart per document"）——rch frame 内层文档提交时
   误动 top 侧 wrapper 子树；或 renderer 对 shadow 子树的布局记账丢失。
5. **下一迭代第一动作**：给 Rust 树 detach/替换路径加 OBSCURA_DEBUG 级
   日志（op_dom remove/replace、document replace、frame loader nid 重挂），
   一轮真跑抓到引擎侧 detach 的确切调用点；随后最小修复 + 全量门禁 +
   挑战轮验收（qEwJM8 填充 → verdict → /1.txt 404）。
工具：driver v62-v71（[shif]/[mut]/[hset]/[ft]/[vp] 预载族）已留存 /private/tmp。

### 2026-09-13 深夜（续二）：Rust 侧取证完成——坍缩=CF api.js 验证拒绝循环（非引擎 detach bug）
1. **Rust 插桩落地**（OBSCURA_DEBUG_TREE_DETACH=1 门控，默认零开销）：
   - tree.rs detach_for_reparent 单点：记录被 detach 的已连接元素（id/class/
     parent/子树是否含 iframe，含 backtrace）；page.rs 顶层文档替换/init_js 标记；
   - ops.rs op_post_to_frame + runtime.rs drain_frame_messages：跨域 postMessage
     排队/丢弃（no-frame/dropped/generation-gone）全量记录。
2. **坍缩"凶手"抓到（微秒级对齐）**：n=7 健康(17.107) → chl_page 的 j0 对
   div#lVJB5 执行 textContent=''（18.002，op_dom remove_child，node65=widget 容器，
   经 Node.prototype.textContent setter 直调 _dom —— JS 钩子盲区）→ n=8 坍缩(18.113)。
   随后 ray2 重渲染（23.8s）= clear+retry 循环。**不是引擎自发 detach。**
3. **触发器链**：top→widget 只发过 init/meow/reloadApiJsRejected（87 条 pmsg 全部
   queued，零丢弃）；**extraParams 从未发出** —— CF 的 api.js 装载验证拒绝了
   重载申请（reloadApiJsRejected），握手停摆 → j0 清容器重试。
4. **api.js 资源时序对拍（关键差异）**：
   - 我们：TOP 时间线 api.js 条目 = 全零+proto=""（跨源无 TAO，形状对），
     但 payload rPXg2 的 api.js 条目 = EazF1(responseStart)=2563 暴露 + sizes=0
     （来源未定位：widget 域 t9s 时间线只有 4 条 XHR，无 api.js 条目）；
   - HaHaVM 通过轮同字段：EazF1=0, dtkfB9=1, gtlhH0=1, nXUeQ6=49570,
     FoGsT1=49270（**sizes 非零 + responseStart 隐藏**——与我们的形状正好相反）；
   - 真实响应无 timing-allow-origin 头（curl 证实），content-length=82928。
5. **下一迭代（按优先级）**：
   a. 定位 payload 里 api.js 条目（rs>0 + sizes=0 混合形状）的产生源：
      检查 widget 域 NavigationTiming/_cf_chl_opt 注入路径与
      _recordImageResourceTiming/其余 record 调用点；
   b. 以 HaHaVM 通过形状为基准修 resource timing 暴露（rs 隐藏/sizes 非零的
      语义到底是什么字段映射——可用 HaHaVM envFunc 资源时序实现直接对读）；
   c. 修复后一轮验证：extraParams 是否发出 → j0 不再清 → widget 不坍缩 →
      qEwJM8 真实值 → verdict → /1.txt 404。
工件：driver v62-v74（/private/tmp），诊断轮 svg30-35（RUST_LOG=info +
OBSCURA_DEBUG_TREE_DETACH=1 的 [treedetach]/[pmsg] 全程日志）。
## 2026-09-13 附件目标恢复：当前状态重验

- Step A 已修改 opt-in 的 frame-message stderr 日志：去掉 120 字符截断，记录 payload_bytes 与完整 JSON；未修改消息派发行为。待 rebuild/local message/full gates。
- 初始直连 curl 返回 403（5423B），目标当前确实处在挑战页；错误沙箱 DNS 重试后完成，原始文件保留。

- HaHaVM 临时 direct TLS forward 源码副本 `/private/tmp/lancet-direct-forward-src`，服务 3002/3057；随后用同一指定代理 `192.168.3.57:9000` 运行 HaHaVM，成功捕获目标域 CK 并直连/forward 两次得到 404，证据为 `/private/tmp/hahavm-proxy-full-20260913.stderr`、`.jsonl`、`.console.jsonl`。
- Obscura 代理轮 `lancet-goal-proxy-02` / `profile-01` / `final-02` 均仍 challenge；完整 pmsg 已证实 `extraParams` 与 `reloadApiJsRejected` 存在。`apiJsResourceTiming` 中 api.js 跨源 TAO 关闭时为 responseStart/sizes=0；HaHaVM 的非零 size 来自其 Cloudflare 专用 `hooks.performanceProfile`/body-size 注入，不能未经 oracle 复制到通用引擎。
- 参考与 Obscura 初始 API trace 的首个结构差异是 HaHaVM 的 CF-specific install 预先写入 VirtualKeyboard/HID/MediaSession 等字段；Obscura trace 从目标脚本的 `window.document` 开始。该差异尚未证明是通用缺陷，未据此乱改。
- 新 exact filter 轮 `/private/tmp/lancet-goal-final-01` 记录 2892 条后因当前 CDP page task budget 在点击阶段超时；它覆盖 target→chl_page→api.js→target/Turnstile proof 请求和完整 pmsg，不能作为通过证据。
- 最终 release build `lancet-goal-final-build-20260913c.log` 通过；no-default check `lancet-goal-nodefault-20260913.log` 通过；workspace full `lancet-goal-final-workspace-20260913.log` 1786/1786 通过（其后坐标实验失败后已撤回，iframe 单项 1/1 复验通过）。
- 提交：外层 `9649f02`（完整 pmsg 日志、exact filter 回归、trace 文档），V8 nested checkout `9c637f09`（exact filter）。
- 用户验收链：HaHaVM fresh2 先成功取得 CK 并直连/forward 返回 404；Obscura storage 导入该 CK 后页面请求返回正文 `Missing resource /1.txt`（24B）。Obscura 独立 challenge 求解仍反复被 CF 拒绝，不能声称独立求解已通过。

- 读取用户附件；本轮验收 URL 是 `/1.txt`，联网冲突已提问，答复前仅进行本地检查。
- HEAD 为 `d2ba223`；原有唯一 tracked diff 是 resource-timing.js 中换行变化，未擅自覆盖。HaHaVM 工作树已有多处 trace/network 修改，同样保留。
- `vendor/v8-trace.sh check`：TSV 和 JSONL 均 trace-capable。
- Herdr 初始只发现主 agent，未发现此前仍在运行的子 agent；已启动 `cf-reference` 做有限参考审计。
- 历史状态记录存在相互矛盾结论：progress 1842 附近已经证明 reloadApiJsRejected 可为正常路径，末尾再次把它当作根因。现作为待验证假设。
- 发现 `/tmp/driver_v77.py` 的 PRLOG 会硬写 api.js transfer/encoded/decoded sizes，且有多个方法包装；不能直接用于无行为改写的验收。
- 新增 frame input strategy 传播：`Page::execute_frame_scripts_for` 在每个新 frame realm 安装已有 opt-in `__obscura_input_strategy`。page focused frame/navigation 58/58 通过。新增后的 full nextest 编译完成但 nextest 调度器无子测试进程且无 summary，保留 `/private/tmp/lancet-goal-full-final-20260913.log`；上一轮同等源码 full 1786/1786 通过，新增 page focused 证明本改动覆盖路径。
- interaction.js 已补充 opt-in pointerover/move/down/up/click 与 MutationObserver 晚插入重试；node syntax、obscura-js input/pointer focused 4/4 通过。live `/private/tmp/lancet-goal-observer-live-01` 仍只到 widget proof，无目标 404；因此未声称独立求解完成。提交 `d9d2ba3`、`f82c569`。
- observer live payload `/private/tmp/lancet-goal-observer-live-01/serve.log` 将配置的 `input[type=checkbox]` 记录进 `maNnU6`，且仍无 clearance；这证明该自动 selector 不是无痕的 CF 求解手段，保留为通用 opt-in API，不作为验收路径。
- 仅修改 api.js ResourceTiming 形状的 preload 因果轮 `/private/tmp/lancet-goal-timing-probe-01` 仍停在 challenge，排除 timing 单项是充分修复。selector trace `/private/tmp/lancet-goal-selector-trace-01` 证明 frame realm 可观测到 `getBoundingClientRect`，但未生成 click payload。

## 2026-09-13 OfflineAudioContext 崩溃根因与修复

- 最新真实轮捕获 widget VM 的精确失败：`createOscillator` 查找发生在
  `[object OfflineAudioContext]` 上，但晚绑定把 `OfflineAudioContext.prototype`
  直接设为当时为空的 `BaseAudioContext.prototype`，丢失了 `AudioContext` 的共享工厂方法。
- 在 `webidl-branding.js` 晚绑定阶段将 `create*`/`decodeAudioData` 方法复制到
  `BaseAudioContext.prototype` 后再 rebasing，新增 `offline_audio_context_inherits_base_audio_factories`
  回归测试，focused nextest 通过。
- 修复后二进制真实轮不再出现该 `TypeError`；目标代理仍返回 challenge，尚无独立 404 证据。

## 2026-09-13 SVG 几何接口归属对齐

- 窄 V8 trace 记录到 frame 中真实的 `Node.getBBox`/`Node.getComputedTextLength` 调用，
  而 HaHaVM 成功轮记录为 `SVGGraphicsElement.getBBox`/`SVGSVGElement.getComputedTextLength`。
- 在保留 `Element.prototype` 回退的前提下，将几何方法发布到对应 SVG 原型，避免改变实现行为，
  并扩展 frame SVG focused test 检查原型归属和非零测量。
- 本轮窄 trace (`/private/tmp/svgtrace9799.jsonl`) 实测 frame 中 `getBBox` 1 次、
  `getComputedTextLength` 20 次，返回值均非零（16.6875、23.375、约 528–561）；
  因此 qEwJM8 的零值来自另一条测量/布局快照路径，暂不再扩大 SVG 实现。
- 新一轮 `--any-widget` trace (`/private/tmp/trace-any9807.jsonl`) 同时确认
  `BaseAudioContext.createOscillator` 2 次、`OfflineAudioContext.startRendering` 3 次、
  `AudioBuffer.getChannelData` 4 次，且 SVG 文本测量返回同样的非零值；当前失败点仍是
  Cloudflare 侧 challenge 结果，不再是此前的音频 `undefined.call`。

## 2026-09-13 Step 257：跨源 frame isolation 委派修复

- 环境对拍发现 HaHaVM 成功 payload 的 `crossOriginIsolated=true`，而 Obscura widget frame 为 false；目标和 widget 响应均带 COOP same-origin + COEP require-corp，iframe allow 委派 cross-origin-isolated。
- Chrome 双端口 fixture 子 frame 返回 `true/function`；Obscura 修复前为 `false/undefined`。
- `frame_document_isolation` 现在要求父文档已隔离、子响应自身 COOP/COEP，并允许同源或显式 allow 委派跨源隔离。focused isolation nextest 2/2、精确 release build、Obscura 本地 frame fixture 均通过。
- 修复后真实轮 `/private/tmp/lancet-goal-isolation-20260913g` 仍为 `/1.txt` 403、PAT 401、无独立 404；低开销环境 trace `/private/tmp/lancet-goal-coi-trace-20260913h/api.jsonl` 的 widget `window.crossOriginIsolated` 两次均为 true。继续忽略 Brunhild/PAT 网络分支，寻找下一个环境差异。

## 2026-09-13 Step 258：修复后全 realm 环境面核验

- `/private/tmp/lancet-goal-env-live-20260913i/serve.log` 的 top、Turnstile frame、重试 frame、about:srcdoc 均实测 `crossOriginIsolated=true`、SAB/XSLTProcessor/CSSPseudoElement 为 function，languages 与 DPR 稳定。
- payload 中相关桶差异归为枚举/辅助 realm 采样差异，当前无新的可安全修复项；继续按用户指令忽略 Brunhild/PAT，环境面审计完成到此轮。

## 2026-09-13 深夜续三：Chrome 真实数据过滤 + /ci/ 图片双取根因 + frame timeOrigin 修复

### Chrome 真实 payload/HAR 过滤（多数 HaHaVM 差异是假环境产物）
- gsLi5.N 桶顺序：Chrome 真实捕获（/private/tmp/cf-chrome/payload-2.json）就是 alert 打头、Object 第 52 位；我们的 _chromePayloadBareFunctionOrder 正确，HaHaVM（内建打头）才是偏离。不修。
- rPXg2 映射（解码 :11755-11794 Jg）：PhWMD5=name, EazF1=⌊re−rs⌋, dtkfB9=⌊rs−rqs⌋, gtlhH0=⌊duration⌋, nXUeQ6=transferSize, FoGsT1=encodedBodySize。我们与 Chrome 形状一致。不修。
- PWGF4 eval 栈、sha256("")（kRQwh3）、qEwJM8=[0,0,0]、缺失批次 {MfOHt6,hCKCP8,jBVrk8,qdVjJ1,wikEk8,wopX8}+neil9+vqXep1：全部在 Chrome 真实数据中同形/不存在。不修。
- cssText 序列化：用 textEncoderPatch.js 内嵌的 Chrome 参考串（24751B）做字节级对拍，185/185 规则一致（输入带 | 时的空规则是测试污染）。不修。
- brunhild：CORS 拒绝路径在 ops.rs "completed" 日志之前提前返回（corsBlocked 早退），轮里其实是快速 settle，与 Chrome 同形。不修。

### 真实 bug 1：warmup 预取毒化 /ci/ 图片（已修复）
- 诊断轮 [ciflow] preload 证实：widget 里 img.src=/ci/ 已设置，但 Chrome/HaHaVM 都有的 /ci/ 网络请求从不出现；engine 侧 "image served from cache as failure"。
- 根因：prepare_screenshot_resources 对 pending（元素驱动）图片预取用顶层文档 URL 作 initiator（错误 Referer）→ CF 会话绑定 /ci/ 返回 4xx → outcome=None 无条件 seed missing（负缓存）→ 元素自己的加载命中中毒缓存 onerror；且与元素 fetch 竞争一次性 URL。
- 修复（page.rs/runtime.rs）：pending 图片预取改用 frame root 的 base_url+referrer policy 作 initiator；pending 图片失败不再 seed（只有成功入缓存）；in-flight 的 URL 跳过预取（render_image_in_flight 检查）。
- 验证：cifix-01 轮两 ray /ci/ 图片均加载（33x85 / 4x69）；focused 5/5。

### 真实 bug 2：frame realm performance.timeOrigin=创建时刻（已修复）
- Chrome：frame realm 的 timeOrigin=导航开始；脚本启动时 now() 已含网络耗时。我们=realm 创建 → widget nav 条目 duration(34)<responseStart(2677) 自相矛盾，且 widget 全部 now() 时间戳基点错位。
- 修复（frames.rs/page.rs）：frame 记录 navigation_start_ms（now−response_end），execute_frame_scripts_for 在注入 nav entry 前 rebase（__obscura_rebasePerformanceOrigin）。
- 验证：慢子页(1.5s)脚本启动 now()=1643ms、nav duration=1510.65≥responseStart=1510.64；focused 61/61、obscura-js 601/601。

## 2026-09-13 深夜续四：Chrome 全功能 oracle 建立 + 真实分歧清单收敛

### Chrome 同变体捕获（关键基础设施）
- /tmp/chrome_payload_capture4.py：本机 Chrome（headless，无 --disable-gpu）经代理跑挑战，Target.setAutoAttach 抓 OOPIF console，点击后捕获 payloadJSON。
- 产物：/private/tmp/chrome-fresh-payloads.jsonl（47/92 键两条）。教训：第一版带 --disable-gpu 导致全部 WebGL 任务名字回退，是伪 oracle。
- HaHaVM 参考侧在同变体窗口重跑通过（fresh3，forward 复访 404）。

### 已修复（本段）
1. NetworkInformation：移除 type→'wifi' 与 downlinkMax（Chrome 桌面均无；上会话误对齐 HaHaVM）。CYsxg7=downlink(Chrome 动态 1.5/1.6 vs 我们 10=常见上限，保留)、LfzX7=downlinkMax 已消失、CoJas5=null ✓。test 更新后 2/2。
2. wreq 代理会话默认 h2（OBSCURA_PROXY_H1_ONLY 环境变量回退）：mitmproxy 9.0.1 下 8 个大 /fo/ POST 稳定完成；计时簇 eaaP6 4114→3320（Chrome 1271，curl api.js 170-560ms vs 我们 1.3s——传输仍慢但 h2 严格优于 h1，保留）。

### Chrome oracle 确认的真实剩余分歧（两 agent 修复中）
- WebGL 簇：OYbs6[10] powerPreference 需回显请求值 "low-power"（我们 "default"）、[14] [1,511]vs[1,1024]；KMUh5 特性位图位 2-5/12 + ["ldr","hdr"]（我们 null）；FEahy0 shader precision 矩阵形状（Chrome [4,2]+大量 null vs 我们 [8,4,2,1]+多非 null）；etmnR7 limits 位 10+（4,128,4,8,4,16,16,32,32 vs 我们 120,120,1）；qydV6 扩展数 39 vs 36；IGBuA2 [159,163] 待识别；lDUiR4 limits 待逐项。
- 标量：MlWrD5="unavailable"（Chrome 确认）、Aqcaj8 true vs null、HDEX5 6 vs 0、uUOw3 0.545(float32) vs 0、dsKPy6 1 vs 0.549、ppMls5/thhSb9 数字字符串 vs 名字回退、JRzmw6 sha vs 名字回退、Pdbt7 导航条目须排首位（我们 XHR 在前）、RotPR2=页面 URL vs 空。
- maNnU6/gIBpo1：Chrome 采集与我们同形（此前怀疑解除；Chrome 轮未点中 so 计数 0）。

### 工件索引
- Chrome oracle：/private/tmp/chrome-fresh-payloads.jsonl、chrome-gpu-payload-{0,1}.json
- 我们同变体：/private/tmp/lancet-h2-01/serve.log（h2 轮 payload）
- CIFLOW 诊断 preload：/tmp/probe_ci_flow2.js（IMG onload/onerror/naturalWidth 追踪）

## 2026-09-14 凌晨：批量 parity 修复落地 + 门禁 + reloadApiJs 流定位

### 本批修复（全部 Chrome oracle 证据 + 门禁 1796/1796、no-default 0 err、trace check ✓）
1. OffscreenCanvas WebGL 家族支持（sockets.js）：此前 getContext('webgl'|'webgl2') 恒 null，挑战探针回退到丢 attrs 的 canvas 路径。现缓存 context/家族互斥/WebIDL enum 校验，与 canvas 元素同语义；focused test 2/2。
2. （agent W）canvas WebGL context 缓存 + powerPreference 回显 + internalformatParameter SAMPLES 格式类矩阵 + 0x8C80→4/0x9111→0/0x80AA→1 + Intel 列表移除 provoking_vertex 与 3 个 draft 扩展；profile 合法差异保留（[1,1024]/astc null/[8,4,2,1]）。
3. （agent S）Pdbt7 导航条目插入表头；Aqcaj8=canTrickleIceCandidates（setRemote 后 true）；HDEX5=SDP 候选折叠计数（6==Chrome）；RotPR2=跨源 frame referrer 按嵌入页策略裁剪（""==fresh Chrome）；MlWrD5 已被 _installAiStatics 覆盖（"unavailable"==Chrome）。
4. NetworkInformation 移除 type/downlinkMax（Chrome 桌面无）；CoJas5=null、LfzX7=null 与 Chrome 一致。
5. stealth_fetch completed 日志加 elapsed ms（诊断）。

### reloadApiJs 流（当前主嫌疑，agent 解码中）
- 我们每轮：parent 发 ch='aae2b9a1c261'（跨会话稳定 12-hex，同 payload IPeXW2），widget 回 reloadApiJsRequest，parent 回 reloadApiJsRejected，widget 降级继续。
- HaHaVM 通过轮：无 reload 流。headless Chrome 失败轮：有 reload 流（chrome_ch_capture.py 证实）。
- rch 体内含种子 56136325351260 → hex='330e41bb475c'（api.js g-token）= s3 变体的 Jf（widget 期望 ch）。
- 传输计时：curl 并发不受影响（171ms），我们轮内请求 0.3-2s 波动（单线程事件循环上 rch 解析/JS 阻塞网络 future 轮询的架构性延迟）。822KB POST：h1 511ms vs h2 1482ms（OBSCURA_PROXY_H1_ONLY 可切回）。
- OYbs6 pos10 powerPreference："default"（Windows persona 默认）vs 两参考 "low-power"（Mac 默认）——降级为 profile 合法差异。

### 未归因遗留（记录不乱改）
ppMls5/thhSb9（"drsi8" 回退）、JRzmw6（sha 桶源对象 undefined）、uUOw3/dsKPy6（字节码内派生比率）——需当前变体 rch 解码（agent 进行中）。IGBuA2/tUxL6=渲染像素 hash，依赖真实光栅化，明确保留。

### reload 流反转结论（agent R 解码，双变体验证，9/14 凌晨）
- ch 比较方向修正：widget 处理器是 `K !== ch` 时发 reloadApiJsRequest（K=hex(56136325351260)='330e41bb475c'，与 api.js g-token 同值但纯属巧合）。
- 当前线上 api.js 硬编码 ch='aae2b9a1c261'（构建字面量，非运行时推导）→ 与 rch 的 K 天然不匹配 → **真 Chrome 现在也每轮走 reloadApiJsRequest**。
- 父侧 managed challenge（chlPageData 非空）从不真正 reload（Qa() 检查），直接回 reloadApiJsRejected；widget 降级路径调用与匹配路径完全相同的 on() 完整初始化 + oK() 补跑 execute——零步骤差异、不跳任务、不标记会话。
- payload 的 IPeXW2 = parent 发的 ch 的原样回显（无计算）；真 Chrome payload 同样 attempts=0/completed=0/IPeXW2='aae2b9a1c261'，与 HaHaVM 被接受 payload 一致。**reload 流整体排除为 verdict 嫌疑。**
- 解码产物：/tmp/vm/new/cur_decoded.js（当前变体全量）、cur_table.js（2041 项表）、cur_script.js。

### 剩余真分歧（唯一线索，agent P 解码 /fo/ 程序中）
ppMls5/thhSb9（"1"/"31" vs 回退名）、JRzmw6（真 sha vs 回退名）、uUOw3（0.545f32 vs 0）、dsKPy6（1 vs 0.549）——内容型，需程序级归因。

## 2026-09-14 凌晨续：HaHaVM 反向差分实验矩阵（用户指示的因果验证法）

方法：在 HaHaVM 通过侧用 HAHA_EXP 环境变量门控的可逆 patch（cfPatches.js EXPERIMENT_PATCH，默认空=零改动）破坏单个候选因素，观察由通过变失败与否。

| 实验 | 扰动 | 结果 | 结论 |
|---|---|---|---|
| E0 | 默认（验证通道） | token 到手 9.8s ✓ | 通道完好（watchdog 是成功后直连复验超时） |
| E1 | battery level 1→0.5 | token 9.3s ✓ 通过 | battery 非决定性 |
| E2 | 取消 setTimeout 压缩（真实延时） | token 10.7s ✓ 通过 | **挑战时长非决定性**（计时假设证伪） |
| E3 | storage quota→0 | token 10.0s ✓ 通过 | storage 非决定性 |
| E4 | connection getters→undefined | token 9.7s ✓ 通过 | connection 非决定性 |

含义：CF 服务端对这些维度宽容（与 Chrome 自身方差一致）；我们的失败原因收窄到内容级分叉。

### getter+方法全量调用对拍（v58_wrap_get.js 预载）
- 7531 条 get + 4834 call 记录；名字级 diff：HaHaVM 调过的名字我们全有（0 缺失）。
- 值形状 diff 仅 4 嫌疑（shadowRoot/parentNode null 探针常态、两个构造器 THREW 是 wrapper 伪影）。
- 结论：分叉不在 API 存在性/读取形状层，在生产者 VALUE/分支层（与 agent P 的"drsi8/bOHv4 是 VM 内部名、生产者分叉"结论一致）。

### 最后的大线索（agent Q 攻坚中）
采集器程序重放（4210g build 全解码已就绪）+ s3 容错三件套移植 → 定位 ppMls5/thhSb9/JRzmw6 生产者链。thhSb9 与 cHIoX8 同值成对（String 化 vs 原值），随机器变，像 elapsed/计数类。

### agent Q 攻坚结果（4210g 重放，120min 时间盒）
- 管线修正：/fo/ 响应体是 brotli+base64（cap2/*_fo_200.b64 已全解）；z7=atob 非 M 解码；前序"18 dispatch 崩"结论是损坏程序上的伪影；指令集 69 case（op2case.json）。
- 容错三件套+138 case try/catch+寄存器快照全移植（s4210_tol.js）；widget init 与 execute 阶段零错误跑通。
- **主卡点精确定位**：runner 程序（rp_prog_0.b64）pc1126→1246 的 18-op 探测循环不退出（~440K dispatch/s，0 错误 0 环境读）。循环前 10 个环境读：navigator.gpu、RTCPeerConnection、eval×2、document、_cf_chl_opt.NOtMO3、iframe.contentWindow(→__CFElement)、Date。
- **三字段生产者链收敛**：drsi8/bOHv4 是 VM 内部名，由更早的 runner/任务程序产出；循环每次迭代两次采样 Date.now（相隔~1ms），值随机器变（Chrome 1/31、HaHaVM 77/99）——极度像轮询循环的耗时/迭代计数。Obscura 侧这些面原生性已验证全部干净（querySelector/querySelectorAll/eval/Date/Function.toString 均 [native code]）。
- 引擎含义：我们 runner 已安装（/fo/ 有发、payload 完整），分叉在循环路径/中间值使 drsi8/bOHv4 生产者未建。下一步=解码 zK 跳转公式+zu/zf/zE 操作数格式（agent Q 续命中）。

### agent Q 第二轮（循环完整破解）+ 引擎侧自旋实测
- 操作数公式修正（post-update key 解码操作数）：zK/zM 跳转、zj/zu/zf/zp/zr 全套反汇编器 disasm_loop.js。
- 1126-1246 = 标定/自旋计数循环：scope[6] 迭代计数（基准 Date.now），退出块读终值调 Date 方法。第一探针（eval toString 逐字符常量比较）我们引擎通过（native ✓）。
- 三字段=同族"计数/耗时测量"任务产物；drsi8/bOHv4 为 VM 内部名。
- **引擎实测（lancet-dl-02）**：我们 widget realm Date.now ~140 次/8s、perf.now ~265 次——自旋标定任务从未运行；任务 19 其它字段正常（lnAQF6='4g'）→ 任务跑了、测量子路径被入口条件跳过。
- 下一步（agent Q 第三轮进行中）：植桩第三解释器副本 → 重放到 drsi8/bOHv4 创建 → spin loop 入口条件（10 个环境读之一）。

### agent Q 第三轮：门控破解（根因链闭合到引擎行级）
- spin loop 入口三级门控（runner 程序 pc2717-3063）：门A navigator.gpu（真值→WebGPU 测量路径）→ 门B RTCPeerConnection → 门C JS 自旋兜底。
- 引擎侧行级证据：gpu.js:16 `navigator.gpu = Object.create(GPU.prototype)`（真值）→ 我们与 Chrome 同走 WebGPU 路径；requestAdapter 续体（adapter→requestDevice→getContext('webgpu')）经 [gpu] preload 实测**全链完整无错**（requestAdapter resolved adapter / requestDevice resolved device / canvas.getContext webgpu 全触发）。
- 微任务投递语义本地验证正常（栈退出即投递；2.7ms 为 JIT 后忙等时长）。
- 结论：分叉收窄到 WebGPU 测量续体的**内部逻辑**（requestAdapter resolve 延迟在轮内观测为 ~700ms——单线程循环上 VM 同步段的自然结果，与 Chrome 的 1-31ms 差异是否被测量逻辑用作门限待重放确认）。GATE_ANALYSIS.md 记录了修复方向二选一：(a) 对齐 WebGPU 测量续体的 timing 语义；(b) widget realm 移除 navigator.gpu/RTC 落 JS 自旋路径（先在 Node 重放补自旋自然退出的 NIsa2/eval 自检语义再动引擎）。

## 2026-09-14 上午：payload 形状对齐达成 + 失败信号定位 + 代理/传输差异分析

### 里程碑：payload 任务覆盖与 Chrome 完全一致
- WebGPU 设备面修复（gpu-command.js：Texture/Buffer/Encoder/Pass/Queue + CPU 光栅化回读）→ ppMls5/thhSb9/cHIoX8 从 "drsi8" 回退变真值（cHIoX8==thhSb9 关系与两参考一致）。
- AnalyserNode 补 getFloatTimeDomainData/getByteTimeDomainData → 缺失整批 6 字段（MfOHt6/hCKCP8/jBVrk8/qdVjJ1/wikEk8/wopX8）全部产出；wopX8 与 Chrome float 位模式高度接近，wikEk8 同为 4 排列。
- 与 Chrome 对拍 219 个任务输出：**形状差异 0**，仅 JRzmw6 一个值仍是名字回退；EPRH3/ppMls5/thhSb9/cHIoX8 等关系全部对齐。
- 提交：gpu-command.js+gpu-device.js+runtime.rs（549750b）、audio-context-behavior.js+runtime.rs（cf4cd84）。

### 失败信号（用户判定信号）已直接捕获
- frame→parent 日志（ops.rs，OBSCURA_TREE_DETACH 门控）捕获 widget 消息：`{"event":"fail","code":"600010","aC":...}`。
- 解码源码（/tmp/vm/new/cur_decoded.js）：600010 默认码在 /fo/ 加载器；case5 需 status===400；另有 status 0（传输失败）→ 加载器重试/失败路径；以及响应程序自身发出的判定。
- XHR 探针实测：h2 轮第三个 widget /fo/ POST（93KB 上传）出现 `ERROR status=0`（mitmproxy h2 大上传），随后重试 200 → fail(600010)。h1 轮传输失败为 0，但仍 1 次 fail → 说明除传输外还有服务端判定路径。

### 传输身份差异（回答"同代理为何 HaHaVM 成功"）
- HaHaVM：挑战流量不经页面引擎，由独立 Rust 服务 `lancet_direct_forward`（同一 wreq 6.0.0-rc.29 + Emulation::Chrome148 + 同一代理）转发；单请求串行；**未 pin h1** → ALPN 协商 h2（Chrome 同款）；5 个 /fo/ POST（含大包）零传输错误。
- Obscura：请求来自真实页面管线（并发子资源、frame 导航、图片、/fo/），且我们为规避 mitmproxy h2 大上传问题**长期 pin h1**（wreq 默认是 All/ALPN 双协商，我们覆盖为仅 http/1.1）→ HTTP 版本与真 Chrome 不同。
- 已回退我此前把 h2 设为默认的改动（恢复 h1 pin，commit）；下一步实验：h2 + 串行化挑战提交，检验 HTTP 版本是否判定因素。
