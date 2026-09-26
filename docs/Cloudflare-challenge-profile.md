# Cloudflare 挑战：诊断记录

> **阅读约定（2026-09-24 起）**
>
> 本文是**活文档**。历史 step 1–353 的正文已归档到
> [Cloudflare-challenge-profile-archive.md](Cloudflare-challenge-profile-archive.md)。
>
> **每条主张都必须带 `证据:`（可复跑的命令或实测数字）与 `状态:`。没有证据的陈述一律视为未复验，不得当作前提。**
> 被推翻的结论**不删除**，在台账里标 `已证伪` 并指明推翻者——历史上被数据推翻的判断（本轮就有 6 条）比结论本身更省后来人的时间。

## 当前状态（2026-09-24）

**目标**：`https://www.thelancet.com/1.txt` 经代理走 Cloudflare Turnstile 托管质询，
以真实的 `POST /1.txt → 404` 为**唯一**通过判据。

**结果：仍未通过。**

> **本节的每一条都经过一次独立的对抗式复核**（由另一个 agent 只从原始产物重新推导，
> 不许信摘要、不许调他人写的结论脚本、要求主动找反例）。复核**推翻了 1 条、把 6 条从
> "已验证"降级或改写了数字**——降级后的措辞就是下面写的。**凡是本节没列的，请到归档里
> 查其 step 的原始证据并自行判断。**

### A. 已证伪：不要再拿这些当前提

| # | 曾主张 | 推翻它的实测 |
|---|---|---|
| A1 | 「headless 类客户端被 CF 普遍敌对」 | **实为 UA 里的 `HeadlessChrome` 标记**：同 headless 换干净 153 UA 后通过；两族 payload 的 175 个探针键里**只有 `zIyO8.jKeeJ4`(UA) 一个不同**，platform/languages/screen/cores 逐字节相同。**注意**：干净 UA 的那条臂也有 1 轮因点击过早而失败，对照 n 很小（2/2 vs 2/2） |
| A2 | 「我们从不发 `/ci/` 请求」 | 误读：`/ci/` 走 `Image()`，**`--trace-op-file` 不记录 Image 加载** |
| A3 | 「`OjmeV1` 空串＝原始文本元素序列化」 | 修复已进二进制，**实弹 payload 的七个下标一字未变** |
| A4 | 「点击必须落在 TS#2 响应后 +2.27~+2.83s」 | 那是 **harness 常数**（旧脚本固定 `fo-click-delay=3.0`） |
| A5 | 「Chrome 934 vs Obscura 847 是引擎级分离，且我方 run-1 与真实参考逐位一致」 | 复核**部分**成立：`87 = 29 个不同 pc × 3` 这个"常量"在 **934/986 臂与 Obscura 臂之间**成立（我方 pc 序列是它的子序列）。**但** ① `ours/tl1` 走另一分支、连子序列都不是（18/19 而非 19/19）；② 我用作"参考"的 `ref0924.jsonl` **是拼接产物**——12 个 `.new` 里 **4 个是我们自己 session（`a1=32`）**；③ 与它比时 **op 差 890/899、st 差 896/899**，逐位一致**只在 pc 上成立**；④ Chrome 934 与那个"参考"之间**不是**偏移（diff=35） |
| A6 | 「`pc=415` 的分岔是判据执行现场」 | 我方 4 轮里 **3 轮与 Chrome 走同一侧** ⇒ 会话数据决定 |

### B. 仍可作为前提（均已复核；数字已按复核改正）

| # | 结论 | 证据 / 复核后的数字 |
|---|---|---|
| B1 | **上行 payload 明文可解** | 固定 key `0954fd238920cb4e832366d227b62cf3`（注入版 ov2.js 把 `ot[40..118]` 覆写成 9 周期常量派生得到）＋**当轮** base64 表（`--ov2js <本轮 ov2probe.js>`）。`--roundtrip` 自证 + 与 console `payloadJSON` 长度逐字节相同。页面层走未打补丁的真 CF 脚本、key 不可控，**解不开** |
| B2 | **同 epoch 四方判决** | headed 通过；headless（自然 UA）失败；clean-UA headless 通过；obscura 失败。**复核用 HAR 逐轮重判，与 `summary` 一致** |
| B3 | **payload 字段内容不是判据——但证据强度比原先写的弱** | 复核：产物里**找不到"53"**（cfg 112 条规则/52 个 key；最完整的 swap-everything 声明 35 条，我核对解密后上行**只落地 32/35**）；**payload#1 那条线三次运行"widget not found / no click"、零触发**。判决确实未翻转，**但空注入对照本身也失败** ⇒ 在"Obscura 从不通过"的前提下，这个实验**检不出翻转**，只能算弱证据 |
| B4 | **时序不是判据——但存在上界** | 复核从 `round.json` 重算：delay 0 = PASS 5/5、+1s = 2/2、+2s = 2/3、+4s = 1/1、**+6s = 0/1（失败）**。"拖到比我们更慢仍通过"在 **+4s 档位**成立（该轮第 3 个 `/fo/` 响应 19.04s vs 我们约 9.5-10.7s），**但 +6s 就翻了** |
| B5 | **点击时机不是 Obscura 的 blocker** | 17/17 通过轮的 `click − FO#3 响应` 跨 **+0.733 ~ +12.415s**；下限由 `early-ctl`(−0.11s FAIL) 与 `b2-time`(−2.42s FAIL) 支撑。**注意措辞**：+12.42s 只是**已测过的最大点**，"无上界"是"未找到上界"，不是"不存在" |
| B6 | **大量环境值不是判据** | 复核重算：**18 项降级、36 轮、36/36 通过**（device metrics/DPR、screen(含我们的 `3440x1440`)、platform 双向、时区、locale、hc 1/2/64、geolocation、WebGL→SwiftShader、全部叠加）。**原写的"40/40"是错的**——要凑 40 轮得再加两项，那就成了 20 项 |
| B7 | **`navigator.languages` 是判据（B6 的例外）** | 改成 `['zh-CN']` **0/5**、`[]` **0/4**；同一 getter 返回原值 `['zh-CN','zh']` **5/5**（realm 回读确认注入落地）。**复核：无反例。** 我方当前 binary 测得 `["zh-CN","zh"]` ✓ |
| B8 | **`cf-chl` / `cf-chl-ra` 在 widget 的 `/fo/` POST 上是硬要求——`Origin` 那条被复核削弱** | cf-chl **0/4**、cf-chl-ra **0/4**、widget Origin **0/4**、page Origin **0/4**、widget content-type **0/2**。**复核的削弱**：① topdoc 的 `Origin` **2/4 通过**，它的两个 FAIL **全是 `clicked=False` 的轮次**（harness 没点到，不是头的效应）；② 这 20 轮的 `applied` 不含 header op，**落地无法独立核验**；③ `hdr-matrix.txt` 自相矛盾（"HARD REQUIREMENTS" 只列 4 条，漏掉同等失败的几条）。**我方满足**：ops.tsv 显示 `cf-chl`/`cf-chl-ra` 在；本机 fixture 实测同源 POST 头列表含 `origin` |
| B9 | **UA 不一致足以失败；但"判决在边缘+顶层文档请求"这一定位未成立** | `hdr-topdoc-set-user-agent-headless` **0/5**（5 轮全 `clicked=True`，realm 回读 UA 干净）。**复核推翻定位**：同一向量在 **page 0/2、widget 0/2、`ua-headless-topdoc` 0/2、`ua-headless-widget` 0/2、`ua-headless` 0/3** 也全败 ⇒ 六路同强，**没有任何 scope 特异性**。数据只支持"**任何单点 UA 不一致都足以失败**" |
| B10 | **通过 ⇒ 1 个 VM 生命周期（可靠）；被拒 ⇒ 2（不可靠）** | 复核：chrome **15/15 (life=1, pass)**；control 208 条里 pass⇒life=1 **128/128**；obscura 15/15 trace 为 life=2。**但"被拒⇒2"有 12 个反例**（都正常点击、wall 32-33s，非截断）——该断言只能单向用 |
| B11 | **代理现在走 `:8080`（mitmdump）；`:9000`（Reqable）卡死** | `:9000` → `000`（`netstat` 显示在听但不服务）；`:8080` → `403`。链路本为 `客户端 → :9000 → :8080 mitmdump → CF`，**带注入 addon 的是 mitmdump**，直连 `:8080` 对 CF 侧透明 |
| ~~B12~~ | ~~「opcode id 每次加载随机置换，只有 pc 稳定」~~ | **已证伪（见 A7）** |

### A7（复核新增的证伪项）

**「VM 的 opcode id 每次加载随机置换」是错的，而且方向相反。** 复核在 **220 次加载**（control 189 + chrome 16 + obscura 15）里只数出 **3 个不同的 op 标签字母表**；**全部 16 条 Chrome trace 与全部 15 条 Obscura round 共用同一个**。若真按 33! 每加载置换，220 次只出现 3 个字母表的概率约 1e-8。⇒ **op id 在 Chrome 与 Obscura 两臂之间恰恰是可比的**。`pc 稳定` 这一半成立（只有 2 个 pc 集合，551 个 pc 出现在 209 次加载里）。

### C. 未决

| # | 问题 | 已有边界 |
|---|---|---|
| C1 | **剩余判据在哪** | 已排除：payload 内容（弱证据）、时序（有上界）、点击、绝大多数环境值、大多数请求头。**未建立**：任何 scope 定位（B9 已被推翻） |
| C2 | 参考机 `mid=10` 而本机 stock Chrome `mid=13` 的成因 | 对几何/DPR/UA/headed/throttle/全部页面可见环境值均不变。首要嫌疑：参考机跑的是**插桩过的 Chrome**（原生 tracelog 后端）。**另需注意**：作为"参考"的 `ref0924.jsonl` 是**拼接文件**，含我们自己的 session，引用它时必须按 `a1` 过滤 |
| C3 | `OjmeV1[118]`、`HPcn5`（差 1px）、`lgWCE7`（差 80px） | 各自已验证为确定性差异，根因未定位 |
| C4 | Obscura 多出的 `run 4`（`bc=3868`，0 步） | 在任何 Chrome trace 里都不出现 |
| C5 | 失败路径是否下发 `cf_clearance` | 归档 step 262 有此主张，**本轮无 cookie 采集，未复验** |

### D. 本轮（step 354）已提交的引擎修复

全部带 Chrome oracle 逐格对照与回归测试，详见各 §354.x：子帧窗口几何（根因是指纹播种时序）、per-realm 隔离继承、DOM 属性转义、原始文本元素序列化、`storage.estimate().quota`、`connection.rtt`、CDP awaited-evaluate 帧提交、`Sec-Ch-Ua` 品牌表**顺序**（Chromium 是 scatter、我们实现成 gather）、`Cache-Control` 过度发送、preload arming、跨 realm op 扇出（−45% op）、worker 内整族 canvas WebGL 返回 null、`MediaCapabilities` 字典校验、`DOMRect`/`DOMRectList`/`DOMPoint`/`DOMQuad`/`VisualViewport` 品牌泄漏、**Trusted Types 跨 realm brand + 解析重入 sink**、**DOM 变更路径的二次复杂度**、请求头顺序随机化。

## 复现

**代理**：现在必须用 `:8080`（`:9000` 的 Reqable 卡死）。

```bash
# 一落实弹轮（30s 预算）：刷新当轮探针 → serve → 点击 → 解密全段 /fo/ → 三方对拍
PROXY_URL=http://192.168.3.57:8080 bash /tmp/cf-parity/verify_round.sh <run> 14
```

对拍与解密工具（都在 `/tmp/cf-parity/`，**不在仓库内**）：
`threeway.py`（只报"两个通过臂一致、与我方不同"的字段）、`align_diff.py`（按条目标签名对齐）、
`vmp_compare2.py`（VM trace 会话感知解析）、`decrypt.sh` / `ov2_payload_codec.py`（见 `.claude/skills/ov2-payload-decrypt/`）。

## 基线：浏览器 vs obscura（thelancet）

真实 Chrome 153（本机、同代理、同 URL）：**约 10 秒通过**，以 `POST /1.txt → 404` 收尾
（body = `Missing resource /1.txt`）。

Obscura 同链路：走完 `page → TS#1 → pat401 → ci → TS#2 → TS#3 → main#2` 后被**重开一轮**
（VM 生命周期 2），**从不发出 `POST /1.txt`**。

| 段间隔 | Obscura | Chrome |
|---|---|---|
| page → TS#1 | 2.0-2.1s | 2.67s |
| TS#1 → TS#2 | **7.0-7.2s** | 3.06s |
| TS#2 → TS#3 | **6.3-6.8s** | 2.13s |
| TS#3 → main#2 | 0.18s | 0.21s |

单轮 `/fo/` 提交次数的实测分布：`{7: 23, 8: 6, 3: 5, 9: 1, 10: 1, 12: 2}`
（**众数是 7，不是早期文档写的"稳定 8 次"**；3 次是流程中途停住）。

## Step 记录

### 索引：Step 1–353（历史归档，354 条）

Step 1–353 的正文已原文搬入 [Cloudflare-challenge-profile-archive.md](Cloudflare-challenge-profile-archive.md)（逐字未改，仅 step 标题层级由 `###` 降为 `##`），点每行的「归档」列进入该 step；Step 354 及其子节仍留在本文下方。上方 `## 当前状态` 一节写于 step 297，其后 step 298–353 的记录已归档、step 354 及子节在本文内，状态以最新的 step 为准。

`原文标注` 列是**机械摘录**：只列出该 step 的标题或正文里出现过的原词（证伪 / 推翻 / 更正 / 作废 / 传说 / 已修正），词后带 `(正文)` 表示该词只出现在正文、没有出现在标题里。**这不是本表作者的判定**，某步结论是否仍然成立以主文档正文为准。

| Step | 标题 | 日期 | 归档 | 原文标注 |
|---|---|---|---|---|
| Step 1 | V8 watchdog 假设：**证伪** |  | [归档](Cloudflare-challenge-profile-archive.md#step-1--v8-watchdog-假设证伪) | 证伪 |
| Step 2 | 五个结构性假设：**全部证伪** |  | [归档](Cloudflare-challenge-profile-archive.md#step-2--五个结构性假设全部证伪) | 证伪 |
| Step 3 | 插桩定位：找到真因 |  | [归档](Cloudflare-challenge-profile-archive.md#step-3--插桩定位找到真因) |  |
| Step 4 | 修复：shadow 子树中的 iframe 拿不到 browsing context |  | [归档](Cloudflare-challenge-profile-archive.md#step-4--修复shadow-子树中的-iframe-拿不到-browsing-context) |  |
| Step 5 | iframe 内 JS 确实执行，但相对 URL 解析到了顶层页面 |  | [归档](Cloudflare-challenge-profile-archive.md#step-5--iframe-内-js-确实执行但相对-url-解析到了顶层页面) |  |
| Step 6 | CDP 预注入：完整消息内容，与父→子通道的验证 |  | [归档](Cloudflare-challenge-profile-archive.md#step-6--cdp-预注入完整消息内容与父子通道的验证) | 作废(正文) |
| Step 7 | 先补上被吞掉的异常，否则看不见任何东西 |  | [归档](Cloudflare-challenge-profile-archive.md#step-7--先补上被吞掉的异常否则看不见任何东西) |  |
| Step 8 | 修复：页面脚本的栈里带着引擎自己的文件名 |  | [归档](Cloudflare-challenge-profile-archive.md#step-8--修复页面脚本的栈里带着引擎自己的文件名) |  |
| Step 9 | 早期 timer 迟发 2.5 秒：目前最可疑的未修项 |  | [归档](Cloudflare-challenge-profile-archive.md#step-9--早期-timer-迟发-25-秒目前最可疑的未修项) |  |
| Step 10 | Performance Timeline 整体为空（实测） |  | [归档](Cloudflare-challenge-profile-archive.md#step-10--performance-timeline-整体为空实测) |  |
| Step 11 | 修复：iframe 内的 `<img>` 按页面源解析（step 5 遗留项） |  | [归档](Cloudflare-challenge-profile-archive.md#step-11--修复iframe-内的-img-按页面源解析step-5-遗留项) |  |
| Step 12 | 找到真正的阻塞点：Worker 收到的消息不是 trusted |  | [归档](Cloudflare-challenge-profile-archive.md#step-12--找到真正的阻塞点worker-收到的消息不是-trusted) |  |
| Step 13 | `performance.now()` 是整毫秒，worker 里还是 Unix 纪元 |  | [归档](Cloudflare-challenge-profile-archive.md#step-13--performancenow-是整毫秒worker-里还是-unix-纪元) |  |
| Step 14 | 胶片式截图：确认屏幕上真的出现了「需要点击」 |  | [归档](Cloudflare-challenge-profile-archive.md#step-14--胶片式截图确认屏幕上真的出现了需要点击) |  |
| Step 15 | 复选框根本没被绘制（渲染缺口，但不是 Turnstile 用的那个） |  | [归档](Cloudflare-challenge-profile-archive.md#step-15--复选框根本没被绘制渲染缺口但不是-turnstile-用的那个) |  |
| Step 16 | （已删除）「跨源 iframe 的绘制表面陈旧、不随 DOM 更新」（结论错误） |  | [归档](Cloudflare-challenge-profile-archive.md#step-16-已删除跨源-iframe-的绘制表面陈旧不随-dom-更新结论错误) | 推翻(正文) |
| Step 17 | 用 js-reverse 对照真实浏览器：推翻 step 16，真因是 body 尺寸 0×0 |  | [归档](Cloudflare-challenge-profile-archive.md#step-17--用-js-reverse-对照真实浏览器推翻-step-16真因是-body-尺寸-00) | 推翻 |
| Step 18 | 真因：frame 内几何查询走的是顶层布局，返回全零 |  | [归档](Cloudflare-challenge-profile-archive.md#step-18--真因frame-内几何查询走的是顶层布局返回全零) |  |
| Step 19 | 修复：frame 几何查询按节点所属文档分派布局 |  | [归档](Cloudflare-challenge-profile-archive.md#step-19--修复frame-几何查询按节点所属文档分派布局) |  |
| Step 20 | 修复：frame 的 `window.innerWidth`/`innerHeight` 回退到屏幕尺寸 |  | [归档](Cloudflare-challenge-profile-archive.md#step-20--修复frame-的-windowinnerwidthinnerheight-回退到屏幕尺寸) |  |
| Step 21 | 修复：frame 文档的 CSS 动画采样冻结在 T=0，复选框因此不可见 |  | [归档](Cloudflare-challenge-profile-archive.md#step-21--修复frame-文档的-css-动画采样冻结在-t0复选框因此不可见) |  |
| Step 22 | 关键修正：真实浏览器根本不点击；obscura 是「托管未过→降级交互」而非「没点 checkbox」 |  | [归档](Cloudflare-challenge-profile-archive.md#step-22--关键修正真实浏览器根本不点击obscura-是托管未过降级交互而非没点-checkbox) | 推翻(正文)、更正(正文) |
| Step 23 | 命中测试已穿透 shadow，但点击复选框仍不推进（疑似 srcdoc iframe 拦截） |  | [归档](Cloudflare-challenge-profile-archive.md#step-23--命中测试已穿透-shadow但点击复选框仍不推进疑似-srcdoc-iframe-拦截) |  |
| Step 24 | 事件不跨 shadow 边界：`composed` 未实现；已修，但点击仍不推进 |  | [归档](Cloudflare-challenge-profile-archive.md#step-24--事件不跨-shadow-边界composed-未实现已修但点击仍不推进) |  |
| Step 25 | widget 监听 `click`+移动事件，不是 pointerdown；补 mouseMoved 后点击仍不推进 |  | [归档](Cloudflare-challenge-profile-archive.md#step-25--widget-监听-click移动事件不是-pointerdown补-mousemoved-后点击仍不推进) |  |
| Step 26 | 修复事件/控件/iframe 一致性后重探：能力面通过，真实质询仍未完成 |  | [归档](Cloudflare-challenge-profile-archive.md#step-26--修复事件控件iframe-一致性后重探能力面通过真实质询仍未完成) |  |
| Step 27 | 独立复核初版修复：找到并消除负回归，真实质询状态不变 |  | [归档](Cloudflare-challenge-profile-archive.md#step-27--独立复核初版修复找到并消除负回归真实质询状态不变) |  |
| Step 28 | 黄金基线：真实浏览器同代理下，点击 checkbox 是过盾的**唯一**触发条件 |  | [归档](Cloudflare-challenge-profile-archive.md#step-28--黄金基线真实浏览器同代理下点击-checkbox-是过盾的唯一触发条件) | 作废(正文) |
| Step 29 | （已删除）「点击命中却零反应，怀疑预注入/观测注入错了 realm」（归因错误） |  | [归档](Cloudflare-challenge-profile-archive.md#step-29-已删除点击命中却零反应怀疑预注入观测注入错了-realm归因错误) | 证伪(正文) |
| Step 30 | 真因：缺 `<label>` 激活行为，点击到不了 Turnstile 绑 handler 的 `<input>` |  | [归档](Cloudflare-challenge-profile-archive.md#step-30--真因缺-label-激活行为点击到不了-turnstile-绑-handler-的-input) | 证伪(正文)、推翻(正文) |
| Step 31 | 确认：拿到了 `cf_clearance`，但它是失败路径的无效票（`cf_chl_rc_ni=1`） |  | [归档](Cloudflare-challenge-profile-archive.md#step-31--确认拿到了-cf_clearance但它是失败路径的无效票cf_chl_rc_ni1) |  |
| Step 32 | 双向 message 对比：找到 `cs` 栈指纹，并测出 inline script 行号偏移 |  | [归档](Cloudflare-challenge-profile-archive.md#step-32--双向-message-对比找到-cs-栈指纹并测出-inline-script-行号偏移) |  |
| Step 33 | 修正 step 22：分流不是由 IP 决定的 |  | [归档](Cloudflare-challenge-profile-archive.md#step-33--修正-step-22分流不是由-ip-决定的) |  |
| Step 34 | obscura vs Chrome 的 message/worker 逐项对比 |  | [归档](Cloudflare-challenge-profile-archive.md#step-34--obscura-vs-chrome-的-messageworker-逐项对比) | 更正(正文)、作废(正文) |
| Step 35 | `cs` 栈逐帧对比：api.js 段完全一致，chl_page 段结构不同 |  | [归档](Cloudflare-challenge-profile-archive.md#step-35--cs-栈逐帧对比apijs-段完全一致chl_page-段结构不同) |  |
| Step 36 | 探针挂起了 worker：推翻本轮三个结论，并拿到成功样本的黄金基线 |  | [归档](Cloudflare-challenge-profile-archive.md#step-36--探针挂起了-worker推翻本轮三个结论并拿到成功样本的黄金基线) | 推翻、更正(正文)、作废(正文) |
| Step 37 | 修复：鼠标事件字段与 Chrome 对齐，`interactiveEnd` 首次出现 |  | [归档](Cloudflare-challenge-profile-archive.md#step-37--修复鼠标事件字段与-chrome-对齐interactiveend-首次出现) |  |
| Step 38 | UA 分裂：JS 侧与 HTTP 头两个来源，`serve` 路径不同步 |  | [归档](Cloudflare-challenge-profile-archive.md#step-38--ua-分裂js-侧与-http-头两个来源serve-路径不同步) |  |
| Step 39 | `/pat/` 缺失调查：参考 HaHaVM-General，假设未被 trace 证实 |  | [归档](Cloudflare-challenge-profile-archive.md#step-39--pat-缺失调查参考-hahavm-general假设未被-trace-证实) | 证伪(正文) |
| Step 40 | P0 五项 parity 修复后的基线：断点未移动，`/pat/` 依旧从不发出 |  | [归档](Cloudflare-challenge-profile-archive.md#step-40--p0-五项-parity-修复后的基线断点未移动pat-依旧从不发出) | 更正(正文) |
| Step 41 | TextEncoder 拦截实验：`/fo/` 明文不走 TextEncoder.encode；interactiveEnd 回归疑云澄清 |  | [归档](Cloudflare-challenge-profile-archive.md#step-41--textencoder-拦截实验fo-明文不走-textencoderencodeinteractiveend-回归疑云澄清) |  |
| Step 42 | realm 归属实验：JSVMP 载荷不进 worker；预注入钩子的真实安全边界（2026-08-15） | 2026-08-15 | [归档](Cloudflare-challenge-profile-archive.md#step-42--realm-归属实验jsvmp-载荷不进-worker预注入钩子的真实安全边界2026-08-15) | 作废(正文) |
| Step 43 | 点击配方验证：第三个 `/fo/` 能触发，能力无回退（2026-08-15） | 2026-08-15 | [归档](Cloudflare-challenge-profile-archive.md#step-43--点击配方验证第三个-fo-能触发能力无回退2026-08-15) |  |
| Step 44 | v8 trace 追 822KB 后执行路径：/pat/ 触发机制排除两项假设；全量 --trace 在新二进制上不可用（2026-08-15） | 2026-08-15 | [归档](Cloudflare-challenge-profile-archive.md#step-44--v8-trace-追-822kb-后执行路径pat-触发机制排除两项假设全量---trace-在新二进制上不可用2026-08-15) | 证伪(正文)、推翻(正文)、更正(正文)、作废(正文) |
| Step 45 | 点击后窗口 trace：/pat/ 从未构造；/ci/ 的 Image 被构造但 op 吞请求；step 44 窗口定位修正（2026-08-15） | 2026-08-15 | [归档](Cloudflare-challenge-profile-archive.md#step-45--点击后窗口-tracepat-从未构造ci-的-image-被构造但-op-吞请求step-44-窗口定位修正2026-08-15) | 证伪(正文)、推翻(正文)、作废(正文) |
| Step 46 | 预注入网络钩子：/pat/ 确凿从未被 JS 构造；发现 Image 请求不记录 resource timing（2026-08-15） | 2026-08-15 | [归档](Cloudflare-challenge-profile-archive.md#step-46--预注入网络钩子pat-确凿从未被-js-构造发现-image-请求不记录-resource-timing2026-08-15) | 证伪(正文) |
| Step 47 | 修 Image resource timing：缺陷已修且有回归测试，但 `/pat/` 未动；新断点 = frame 无 navigation timing（2026-08-15） | 2026-08-15 | [归档](Cloudflare-challenge-profile-archive.md#step-47--修-image-resource-timing缺陷已修且有回归测试但-pat-未动新断点--frame-无-navigation-timing2026-08-15) | 证伪(正文) |
| Step 48 | 双向 message 对拍：父窗口确实回应了 `requestExtraParams`，通道两向全通（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-48--双向-message-对拍父窗口确实回应了-requestextraparams通道两向全通2026-08-16) | 证伪(正文)、推翻(正文)、更正(正文) |
| Step 49 | 同 IP Chrome 对照推翻 step 48 的「CF 分流波动」归因：回退在 obscura 侧（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-49--同-ip-chrome-对照推翻-step-48-的cf-分流波动归因回退在-obscura-侧2026-08-16) | 推翻、证伪(正文)、作废(正文) |
| Step 50 | 根因之一定位：`1f963b7` 的 Trusted Types 只有 API 外壳，`eval(TrustedScript)` 不执行（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-50--根因之一定位1f963b7-的-trusted-types-只有-api-外壳evaltrustedscript-不执行2026-08-16) |  |
| Step 51 | 二分收敛：`1f963b7` 是唯一回归根因，且造成两级退化（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-51--二分收敛1f963b7-是唯一回归根因且造成两级退化2026-08-16) | 证伪(正文)、更正(正文)、作废(正文) |
| Step 52 | 修复：Trusted Types 入口不再暴露（`eval(TrustedScript)` 无法实现）（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-52--修复trusted-types-入口不再暴露evaltrustedscript-无法实现2026-08-16) | 证伪(正文) |
| Step 53 | 附带发现修复 1/2：引擎全局不再可枚举；`crossOriginIsolated` 补为 `false`（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-53--附带发现修复-12引擎全局不再可枚举crossoriginisolated-补为-false2026-08-16) |  |
| Step 54 | 附带发现修复 3：`TextMetrics` 补齐并接上真实字体度量（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-54--附带发现修复-3textmetrics-补齐并接上真实字体度量2026-08-16) |  |
| Step 55 | `/pat/` 首次发出（401,与 Chrome 同码):挂了六个 step 的首要阻塞解除（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-55--pat-首次发出401与-chrome-同码挂了六个-step-的首要阻塞解除2026-08-16) |  |
| Step 56 | 补上点击这一环:提交链完整,断点回到「提交后被判失败」（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-56--补上点击这一环提交链完整断点回到提交后被判失败2026-08-16) |  |
| Step 57 | 读 api.js 的通信层:`fail` 是本地合成的;并修掉 console.log 触发 getter（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-57--读-apijs-的通信层fail-是本地合成的并修掉-consolelog-触发-getter2026-08-16) |  |
| Step 58 | 定位 600010:由 widget 经 postMessage 上报;widget 文档 CSP 强制 Trusted Types（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-58--定位-600010由-widget-经-postmessage-上报widget-文档-csp-强制-trusted-types2026-08-16) |  |
| Step 59 | CSP / Trusted Types 当前实现校正（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-59--csp--trusted-types-当前实现校正2026-08-16) |  |
| Step 60 | 同 IP Chrome 对照通过，`/ci/` 缺失被证伪，分歧点前移到 tokenB（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-60--同-ip-chrome-对照通过ci-缺失被证伪分歧点前移到-tokenb2026-08-16) | 证伪、更正(正文)、作废(正文) |
| Step 61 | fetch 的 CSP realm 缺陷：页面级策略被应用到所有 realm（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-61--fetch-的-csp-realm-缺陷页面级策略被应用到所有-realm2026-08-16) | 推翻(正文)、更正(正文) |
| Step 62 | CSP realm 修复补齐并实测生效；`/eb/` 另有成因（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-62--csp-realm-修复补齐并实测生效eb-另有成因2026-08-16) | 证伪(正文) |
| Step 63 | `/ci/` 确实被 CSP 拦了：指令优先级写反；同时推翻 Step 61 的根因（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-63--ci-确实被-csp-拦了指令优先级写反同时推翻-step-61-的根因2026-08-16) | 推翻 |
| Step 64 | `/eb/` 的成因：Trusted Types 默认策略的返回值判定写反（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-64--eb-的成因trusted-types-默认策略的返回值判定写反2026-08-16) |  |
| Step 65 | 对照参考实现补齐两处 TT 差异：`script.src` sink 与默认策略回调参数（2026-08-16） | 2026-08-16 | [归档](Cloudflare-challenge-profile-archive.md#step-65--对照参考实现补齐两处-tt-差异scriptsrc-sink-与默认策略回调参数2026-08-16) |  |
| Step 66 | 首次拿到明文提交载荷：逐字段对拍锁定 9 类差异（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-66--首次拿到明文提交载荷逐字段对拍锁定-9-类差异2026-08-17) | 作废(正文) |
| Step 67 | 修 1.json：`yQYB9` 缺失的三个成因，resource timing 补齐（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-67--修-1jsonyqyb9-缺失的三个成因resource-timing-补齐2026-08-17) |  |
| Step 68 | `fyCZH9` 的枚举语义查清：`for..in` ∪ 自有属性名（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-68--fyczh9-的枚举语义查清forin--自有属性名2026-08-17) | 推翻(正文)、更正(正文) |
| Step 69 | `YIwy3` / `DrTW4`：SDP offer 与 ICE 候选（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-69--yiwy3--drtw4sdp-offer-与-ice-候选2026-08-17) |  |
| Step 70 | WebGL 一组 8 个字段：一致性画像随 `--stealth` 生效，并补齐查询面（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-70--webgl-一组-8-个字段一致性画像随---stealth-生效并补齐查询面2026-08-17) |  |
| Step 71 | `EnxW1`：WebGPU 适配器描述（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-71--enxw1webgpu-适配器描述2026-08-17) |  |
| Step 72 | `ZpxzX5`：RTP 能力表由 SDP 反推（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-72--zpxzx5rtp-能力表由-sdp-反推2026-08-17) | 更正(正文) |
| Step 73 | `Swui9`：键盘布局表（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-73--swui9键盘布局表2026-08-17) |  |
| Step 74 | `gqGB4`：字体列表里那台「不可能存在的机器」的成因（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-74--gqgb4字体列表里那台不可能存在的机器的成因2026-08-17) |  |
| Step 75 | `gqGB4` 的真正探测路径：`FontFace` 的 `local()` 源（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-75--gqgb4-的真正探测路径fontface-的-local-源2026-08-17) |  |
| Step 76 | `qOeu1`：引擎自己的内部选择器泄漏进了页面的观测（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-76--qoeu1引擎自己的内部选择器泄漏进了页面的观测2026-08-17) |  |
| Step 77 | 追 `PvWp9` / `QCEE0`：找到并修掉 `outerHTML` setter 与 `offsetParent`（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-77--追-pvwp9--qcee0找到并修掉-outerhtml-setter-与-offsetparent2026-08-17) |  |
| Step 78 | `document.all`：只能在 V8 层做的那一个（2026-08-17） | 2026-08-17 | [归档](Cloudflare-challenge-profile-archive.md#step-78--documentall只能在-v8-层做的那一个2026-08-17) |  |
| Step 79 | `fyCZH9`：先把这个字段的**结构**搞清楚，之前的读法是错的（2026-08-18） | 2026-08-18 | [归档](Cloudflare-challenge-profile-archive.md#step-79--fyczh9先把这个字段的结构搞清楚之前的读法是错的2026-08-18) | 推翻(正文) |
| Step 80 | CF 实测：`fyCZH9` 枚举的是 **iframe 的** window/document，不是页面的（2026-08-18） | 2026-08-18 | [归档](Cloudflare-challenge-profile-archive.md#step-80--cf-实测fyczh9-枚举的是-iframe-的-windowdocument不是页面的2026-08-18) | 推翻(正文) |
| Step 81 | iframe 初始 about:blank 文档改由 Rust 同步提交（2026-08-18） | 2026-08-18 | [归档](Cloudflare-challenge-profile-archive.md#step-81--iframe-初始-aboutblank-文档改由-rust-同步提交2026-08-18) |  |
| Step 82 | `o.` 那 316 项是「JS 包装过不了 CF 的原生检测」，两个假设被证伪（2026-08-19） | 2026-08-19 | [归档](Cloudflare-challenge-profile-archive.md#step-82--o-那-316-项是js-包装过不了-cf-的原生检测两个假设被证伪2026-08-19) | 证伪 |
| Step 83 | 同步建 frame realm：`o.` 339 → 165，裸名 `f` 314 → 5（2026-08-19） | 2026-08-19 | [归档](Cloudflare-challenge-profile-archive.md#step-83--同步建-frame-realmo-339--165裸名-f-314--52026-08-19) | 证伪(正文) |
| Step 84 | 藏干净 frame realm 的内部字段：跨 realm 枚举 131 项 → 0（2026-08-25） | 2026-08-25 | [归档](Cloudflare-challenge-profile-archive.md#step-84--藏干净-frame-realm-的内部字段跨-realm-枚举-131-项--02026-08-25) |  |
| Step 85 | WindowProxy 方法标 native：裸名 `f` 剩下的 4 个方法清掉（2026-08-25） | 2026-08-25 | [归档](Cloudflare-challenge-profile-archive.md#step-85--windowproxy-方法标-native裸名-f-剩下的-4-个方法清掉2026-08-25) |  |
| Step 86 | WindowProxy 的 constructor 身份：返回 frame 自己的 Window（2026-08-25） | 2026-08-25 | [归档](Cloudflare-challenge-profile-archive.md#step-86--windowproxy-的-constructor-身份返回-frame-自己的-window2026-08-25) |  |
| Step 87 | thelancet.com 实测：窗口已藏干净，document 的 `_*` 自有属性仍泄漏（2026-08-26） | 2026-08-26 | [归档](Cloudflare-challenge-profile-archive.md#step-87--thelancetcom-实测窗口已藏干净document-的-_-自有属性仍泄漏2026-08-26) |  |
| Step 88 | document 的 `_*` 自有属性改 Symbol 键：`getOwnPropertyNames(document)` 泄漏归零（2026-08-26） | 2026-08-26 | [归档](Cloudflare-challenge-profile-archive.md#step-88--document-的-_-自有属性改-symbol-键getownpropertynamesdocument-泄漏归零2026-08-26) |  |
| Step 89 | 重验证：document 泄漏归零，但默认 UA 错配 + navigator 缺 42 属性才是更大错配（2026-08-27） | 2026-08-27 | [归档](Cloudflare-challenge-profile-archive.md#step-89--重验证document-泄漏归零但默认-ua-错配--navigator-缺-42-属性才是更大错配2026-08-27) |  |
| Step 90 | 全三轮明文对拍：N 桶缺 773 构造器 + UA-CH/WebGPU/iframe 几何错配（2026-08-27） | 2026-08-27 | [归档](Cloudflare-challenge-profile-archive.md#step-90--全三轮明文对拍n-桶缺-773-构造器--ua-chwebgpuiframe-几何错配2026-08-27) | 证伪(正文) |
| Step 90 | 补充 — `/ci/` 打点「消失」调查：无回归，是时机波动 + 一个真 iframe 缺陷（2026-08-27） | 2026-08-27 | [归档](Cloudflare-challenge-profile-archive.md#step-90-补充--ci-打点消失调查无回归是时机波动--一个真-iframe-缺陷2026-08-27) | 推翻(正文) |
| Step 91 | B0-B7 全批次落地：核心指纹面收敛到 149 基线（2026-08-28） | 2026-08-28 | [归档](Cloudflare-challenge-profile-archive.md#step-91--b0-b7-全批次落地核心指纹面收敛到-149-基线2026-08-28) | 证伪(正文) |
| Step 92 | thelancet 三 payload + console + V8 trace 复核（2026-08-28） | 2026-08-28 | [归档](Cloudflare-challenge-profile-archive.md#step-92--thelancet-三-payload--console--v8-trace-复核2026-08-28) |  |
| Step 93 | `jdnfg5` 缺 iframe：entry 已写入 timeline 的时序证据（2026-08-28） | 2026-08-28 | [归档](Cloudflare-challenge-profile-archive.md#step-93--jdnfg5-缺-iframeentry-已写入-timeline-的时序证据2026-08-28) | 证伪(正文)、更正(正文) |
| Step 94 | jdnfg5 iframe item：补 frame realm navigation timing（2026-08-28） | 2026-08-28 | [归档](Cloudflare-challenge-profile-archive.md#step-94--jdnfg5-iframe-item补-frame-realm-navigation-timing2026-08-28) | 证伪(正文) |
| Step 95 | 隐藏 Error.stack 的 Obscura/deno 内部帧（2026-08-29，完成） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-95--隐藏-errorstack-的-obscuradeno-内部帧2026-08-29完成) |  |
| Step 96 | payload-2 缺 hGgWW0/lNCr3：DOMParser HTML document 无 body（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-96--payload-2-缺-hggww0lncr3domparser-html-document-无-body2026-08-29验证中) | 证伪(正文) |
| Step 97 | 从 frame StackFrame 导出当轮 JSVMP source（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-97--从-frame-stackframe-导出当轮-jsvmp-source2026-08-29验证中) | 证伪(正文) |
| Step 98 | UA-CH brands/fullVersionList 对齐 Chrome 149 macOS（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-98--ua-ch-brandsfullversionlist-对齐-chrome-149-macos2026-08-29验证中) |  |
| Step 99 | ZokK1已存在接口的类型/native分类修复（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-99--zokk1已存在接口的类型native分类修复2026-08-29验证中) |  |
| Step 100 | 当前请求链复核与下一缺口选择（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-100--当前请求链复核与下一缺口选择2026-08-29验证中) |  |
| Step 101 | ZokK非N桶对象/状态长尾（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-101--zokk非n桶对象状态长尾2026-08-29验证中) |  |
| Step 102 | `IMOh8` audio RED codec投影（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-102--imoh8-audio-red-codec投影2026-08-29验证中) |  |
| Step 103 | qSsL2/nMlxj2当前源码受控复现（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-103--qssl2nmlxj2当前源码受控复现2026-08-29验证中) |  |
| Step 104 | 当前有效challenge直连链路与低开销op trace（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-104--当前有效challenge直连链路与低开销op-trace2026-08-29验证中) |  |
| Step 105 | 更新代理后的条件点击与明文payload复测（2026-08-29，验证中） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-105--更新代理后的条件点击与明文payload复测2026-08-29验证中) | 证伪(正文) |
| Step 106 | payload恢复后的top主VM register关联（2026-08-29，证伪同步产出边界） | 2026-08-29 | [归档](Cloudflare-challenge-profile-archive.md#step-106--payload恢复后的top主vm-register关联2026-08-29证伪同步产出边界) | 证伪 |
| Step 107 | frame classifier真实执行边界（2026-08-30，验证中） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-107--frame-classifier真实执行边界2026-08-30验证中) | 证伪(正文) |
| Step 108 | hG外层汇总的异步callback边界（2026-08-30，验证中） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-108--hg外层汇总的异步callback边界2026-08-30验证中) |  |
| Step 109 | HaHaVM环境参考：StorageManager与OPFS通用语义（2026-08-30，验证中） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-109--hahavm环境参考storagemanager与opfs通用语义2026-08-30验证中) |  |
| Step 110 | URL与URLSearchParams internal slots（2026-08-30，验证中） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-110--url与urlsearchparams-internal-slots2026-08-30验证中) |  |
| Step 111 | MouseEvent/PointerEvent标准字段与internal slots（2026-08-30，验证中） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-111--mouseeventpointerevent标准字段与internal-slots2026-08-30验证中) |  |
| Step 112 | WorkerNavigator StorageManager与OPFS（2026-08-30，验证中） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-112--workernavigator-storagemanager与opfs2026-08-30验证中) |  |
| Step 113 | `uRcJs7` worker源码边界（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-113--urcjs7-worker源码边界2026-08-30完成) |  |
| Step 114 | Navigator.getGamepads四槽返回（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-114--navigatorgetgamepads四槽返回2026-08-30完成) |  |
| Step 115 | 跨源frame权限状态与Permissions Policy（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-115--跨源frame权限状态与permissions-policy2026-08-30完成) |  |
| Step 116 | NetworkInformation desktop公开面与internal slots（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-116--networkinformation-desktop公开面与internal-slots2026-08-30完成) |  |
| Step 117 | CSSStyleDeclaration named/computed枚举面（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-117--cssstyledeclaration-namedcomputed枚举面2026-08-30完成) | 证伪(正文) |
| Step 118 | WebGL RGBA/UNSIGNED_BYTE标准常量（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-118--webgl-rgbaunsigned_byte标准常量2026-08-30完成) | 证伪(正文) |
| Step 119 | WebGL完整标准常量公开面（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-119--webgl完整标准常量公开面2026-08-30完成) | 证伪(正文) |
| Step 120 | WebGL1扩展启用状态参数语义（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-120--webgl1扩展启用状态参数语义2026-08-30完成) |  |
| Step 121 | Apple WebGL2 uniform-buffer capability一致性（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-121--apple-webgl2-uniform-buffer-capability一致性2026-08-30完成) |  |
| Step 122 | WEBGL_compressed_texture_astc标准扩展对象（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-122--webgl_compressed_texture_astc标准扩展对象2026-08-30完成) |  |
| Step 123 | CDP输入状态移出window字符串公开面（2026-08-30，完成） | 2026-08-30 | [归档](Cloudflare-challenge-profile-archive.md#step-123--cdp输入状态移出window字符串公开面2026-08-30完成) | 作废(正文) |
| Step 124 | WebRTC四组能力数组的无扰动归因（2026-08-31，完成） | 2026-08-31 | [归档](Cloudflare-challenge-profile-archive.md#step-124--webrtc四组能力数组的无扰动归因2026-08-31完成) | 证伪(正文) |
| Step 125 | `console.memory`通用Chrome公开面（2026-08-31，完成） | 2026-08-31 | [归档](Cloudflare-challenge-profile-archive.md#step-125--consolememory通用chrome公开面2026-08-31完成) |  |
| Step 126 | 完整Chrome console方法面（2026-08-31，完成） | 2026-08-31 | [归档](Cloudflare-challenge-profile-archive.md#step-126--完整chrome-console方法面2026-08-31完成) |  |
| Step 127 | Blob/File internal slots与UTF-8替换语义（2026-08-31，完成） | 2026-08-31 | [归档](Cloudflare-challenge-profile-archive.md#step-127--blobfile-internal-slots与utf-8替换语义2026-08-31完成) |  |
| Step 128 | XMLHttpRequest公开面与internal slots（2026-09-01，完成） | 2026-09-01 | [归档](Cloudflare-challenge-profile-archive.md#step-128--xmlhttprequest公开面与internal-slots2026-09-01完成) |  |
| Step 129 | iframe embedded CSP与Trusted Types继承（2026-09-01，调查中） | 2026-09-01 | [归档](Cloudflare-challenge-profile-archive.md#step-129--iframe-embedded-csp与trusted-types继承2026-09-01调查中) | 作废(正文) |
| Step 130 | Blob URL 本地 fetch 的二进制 GET/HEAD、Response 元数据与 revoke 生命周期（存档回填） |  | [归档](Cloudflare-challenge-profile-archive.md#step-130---blob-url-本地-fetch-的二进制-getheadresponse-元数据与-revoke-生命周期存档回填) |  |
| Step 131 | `Allow-CSP-From` 的通用 origin 比较（存档回填） |  | [归档](Cloudflare-challenge-profile-archive.md#step-131---allow-csp-from-的通用-origin-比较存档回填) |  |
| Step 132 | 独立 `HTMLIFrameElement` 原型（存档回填） |  | [归档](Cloudflare-challenge-profile-archive.md#step-132---独立-htmliframeelement-原型存档回填) |  |
| Step 133 | `crossOriginIsolated` 落到每个 Document（存档回填） |  | [归档](Cloudflare-challenge-profile-archive.md#step-133---crossoriginisolated-落到每个-document存档回填) |  |
| Step 134 | iframe 原型清理与 frame-level isolation 的 release 复测（存档回填） |  | [归档](Cloudflare-challenge-profile-archive.md#step-134---iframe-原型清理与-frame-level-isolation-的-release-复测存档回填) |  |
| Step 135 | Chrome 152 长尾接口面收敛（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-135--chrome-152-长尾接口面收敛2026-09-02完成) |  |
| Step 136 | 请求头/事件/worker 环境收尾与外部网络盲区（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-136--请求头事件worker-环境收尾与外部网络盲区2026-09-02调查中) |  |
| Step 137 | frame 文档 `script-src` 执行门（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-137--frame-文档-script-src-执行门2026-09-02完成) |  |
| Step 138 | CSP 脚本门后的真实站复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-138--csp-脚本门后的真实站复测2026-09-02调查中) |  |
| Step 139 | 动态 frame script CSP sink（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-139--动态-frame-script-csp-sink2026-09-02完成) |  |
| Step 140 | frame ES module graph CSP（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-140--frame-es-module-graph-csp2026-09-02完成) |  |
| Step 141 | frame render warmup 的资源 CSP（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-141--frame-render-warmup-的资源-csp2026-09-02完成) |  |
| Step 142 | frame `<img>` renderer fallback 的 CSP（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-142--frame-img-renderer-fallback-的-csp2026-09-02完成) |  |
| Step 143 | frame 图片的同步 renderer loader CSP（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-143--frame-图片的同步-renderer-loader-csp2026-09-02完成) |  |
| Step 144 | frame `<img>` root 归属与 renderer fallback 修复（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-144--frame-img-root-归属与-renderer-fallback-修复2026-09-02完成) |  |
| Step 145 | 真实站传输层状态复核（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-145--真实站传输层状态复核2026-09-02调查中) |  |
| Step 146 | frame `unsafe-eval` 与 V8 code-generation policy（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-146--frame-unsafe-eval-与-v8-code-generation-policy2026-09-02完成) |  |
| Step 147 | frame CSP 完整代码生成门验证（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-147--frame-csp-完整代码生成门验证2026-09-02完成) |  |
| Step 148 | codegen 修复后的真实站复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-148--codegen-修复后的真实站复测2026-09-02调查中) |  |
| Step 149 | CSP 代码生成门的最终回归（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-149--csp-代码生成门的最终回归2026-09-02完成) |  |
| Step 150 | `script-src-attr` inline handler CSP（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-150--script-src-attr-inline-handler-csp2026-09-02完成) |  |
| Step 151 | `script-src-attr` 修复后的真实站复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-151--script-src-attr-修复后的真实站复测2026-09-02调查中) |  |
| Step 152 | external script nonce 反射与真实挑战链恢复（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-152--external-script-nonce-反射与真实挑战链恢复2026-09-02完成) |  |
| Step 153 | nonce 修复后的无注入真实点击证据（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-153--nonce-修复后的无注入真实点击证据2026-09-02调查中) |  |
| Step 154 | nonce/CSP 修复后的最终代码门禁（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-154--noncecsp-修复后的最终代码门禁2026-09-02完成) |  |
| Step 155 | Brunhild 请求归属与最终网络断点（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-155--brunhild-请求归属与最终网络断点2026-09-02调查中) |  |
| Step 156 | nonce 后真实链路与代码门禁汇总（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-156--nonce-后真实链路与代码门禁汇总2026-09-02调查中) |  |
| Step 157 | HaHaVM-General 内存上限与 Window 常量（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-157--hahavm-general-内存上限与-window-常量2026-09-02完成) |  |
| Step 158 | frame Worker 继承 creator CSP（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-158--frame-worker-继承-creator-csp2026-09-02完成) |  |
| Step 159 | Brunhild 真实网络路径恢复（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-159--brunhild-真实网络路径恢复2026-09-02调查中) |  |
| Step 160 | 干净点击与硬件指纹 A/B（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-160--干净点击与硬件指纹-ab2026-09-02调查中) |  |
| Step 161 | Navigator 自有属性迁移（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-161--navigator-自有属性迁移2026-09-02完成) | 证伪(正文)、推翻(正文)、更正(正文)、作废(正文) |
| Step 162 | Navigator 收尾后的真实-IP A/B（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-162--navigator-收尾后的真实-ip-ab2026-09-02调查中) |  |
| Step 163 | scripted POST 的 Content-Type 保真（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-163--scripted-post-的-content-type-保真2026-09-02完成) |  |
| Step 164 | Headers/Request/Response internal slots（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-164--headersrequestresponse-internal-slots2026-09-02完成) |  |
| Step 165 | Fetch 对象修复后的真实站复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-165--fetch-对象修复后的真实站复测2026-09-02调查中) |  |
| Step 166 | Fetch redirect 边界与最终代码门禁（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-166--fetch-redirect-边界与最终代码门禁2026-09-02完成) | 已修正(正文) |
| Step 167 | 最终 release 无注入复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-167--最终-release-无注入复测2026-09-02调查中) |  |
| Step 168 | Fetch bodyUsed 生命周期与最终回归（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-168--fetch-bodyused-生命周期与最终回归2026-09-02完成) |  |
| Step 169 | Accept-CH/Critical-CH 客户端提示（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-169--accept-chcritical-ch-客户端提示2026-09-02完成) |  |
| Step 170 | Client Hints 修复后的真实复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-170--client-hints-修复后的真实复测2026-09-02调查中) |  |
| Step 171 | Client Hints 最终门禁（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-171--client-hints-最终门禁2026-09-02完成) |  |
| Step 172 | Permissions-Policy 文档策略传播（2026-09-02，完成代码修复） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-172--permissions-policy-文档策略传播2026-09-02完成代码修复) |  |
| Step 173 | Permissions-Policy 修复后的直接复测（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-173--permissions-policy-修复后的直接复测2026-09-02调查中) |  |
| Step 174 | Live Document own-key 与 HTMLDocument 反射面（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-174--live-document-own-key-与-htmldocument-反射面2026-09-02完成) |  |
| Step 175 | FeaturePolicy 默认表与 allowlist 对齐（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-175--featurepolicy-默认表与-allowlist-对齐2026-09-02完成) |  |
| Step 176 | 最新 release 真实验收复测（2026-09-02，未通过） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-176--最新-release-真实验收复测2026-09-02未通过) |  |
| Step 177 | 最终 release 复测（2026-09-02，未通过） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-177--最终-release-复测2026-09-02未通过) |  |
| Step 178 | 最终 release 真实-IP CONNECT 点击链（2026-09-02，未通过） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-178--最终-release-真实-ip-connect-点击链2026-09-02未通过) |  |
| Step 179 | Chrome payload 文件格式与 enum 工具适配（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-179--chrome-payload-文件格式与-enum-工具适配2026-09-02完成) |  |
| Step 180 | Chrome 149 payload 缺失集合修复（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-180--chrome-149-payload-缺失集合修复2026-09-02完成) |  |
| Step 181 | 最新 release V8 trace（2026-09-02，完成观测） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-181--最新-release-v8-trace2026-09-02完成观测) |  |
| Step 182 | Chrome payload 类型面清零（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-182--chrome-payload-类型面清零2026-09-02完成) |  |
| Step 183 | Chrome 149 surfaces 与 link DOM 面（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-183--chrome-149-surfaces-与-link-dom-面2026-09-02完成) |  |
| Step 184 | 代理 V8 trace 与 console.log 结论（2026-09-02，完成观测） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-184--代理-v8-trace-与-consolelog-结论2026-09-02完成观测) |  |
| Step 185 | 三份 Chrome payload 结构对比（2026-09-02，完成观测） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-185--三份-chrome-payload-结构对比2026-09-02完成观测) |  |
| Step 186 | 同步 nested iframe 的 sandbox 继承（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-186--同步-nested-iframe-的-sandbox-继承2026-09-02调查中) |  |
| Step 187 | 语言 fingerprint 跨 frame/worker 与请求头同步（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-187--语言-fingerprint-跨-frameworker-与请求头同步2026-09-02调查中) |  |
| Step 188 | 响应 CSP `sandbox` directive（2026-09-02，完成代码修复） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-188--响应-csp-sandbox-directive2026-09-02完成代码修复) |  |
| Step 189 | CSP/语言修复后的最终真实轮（2026-09-02，未通过） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-189--csp语言修复后的最终真实轮2026-09-02未通过) |  |
| Step 190 | 本轮代码门禁（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-190--本轮代码门禁2026-09-02完成) |  |
| Step 191 | 当前代理 Brunhild 可达性复核（2026-09-02，外部阻塞） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-191--当前代理-brunhild-可达性复核2026-09-02外部阻塞) |  |
| Step 192 | Brunhild 真实-IP CONNECT A/B（2026-09-02，完成观测） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-192--brunhild-真实-ip-connect-ab2026-09-02完成观测) |  |
| Step 193 | navigator language 与 V8/ICU 默认 locale（2026-09-02，完成代码修复） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-193--navigator-language-与-v8icu-默认-locale2026-09-02完成代码修复) |  |
| Step 194 | 本轮最终门禁（2026-09-02，完成） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-194--本轮最终门禁2026-09-02完成) |  |
| Step 195 | locale 改动后的 workspace 复核（2026-09-02，完成门禁） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-195--locale-改动后的-workspace-复核2026-09-02完成门禁) |  |
| Step 196 | frame 动态 stylesheet 的 CSP sink（2026-09-02，调查中） | 2026-09-02 | [归档](Cloudflare-challenge-profile-archive.md#step-196--frame-动态-stylesheet-的-csp-sink2026-09-02调查中) |  |
| Step 197 | wreq Client-Hints 重复头（2026-09-03，代码修复完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-197--wreq-client-hints-重复头2026-09-03代码修复完成) |  |
| Step 198 | emulation 默认头与 HTTP/2 wire 去重（2026-09-03，代码修复完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-198--emulation-默认头与-http2-wire-去重2026-09-03代码修复完成) |  |
| Step 199 | frame 点击屏幕坐标与 proof 轮（2026-09-03，部分完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-199--frame-点击屏幕坐标与-proof-轮2026-09-03部分完成) |  |
| Step 200 | Client-Hints 最终 wire 验证与 404 续测（2026-09-03，部分完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-200--client-hints-最终-wire-验证与-404-续测2026-09-03部分完成) |  |
| Step 201 | closed-shadow widget 命中与 proof 事件链（2026-09-03，部分完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-201--closed-shadow-widget-命中与-proof-事件链2026-09-03部分完成) |  |
| Step 202 | CDP click 的 PointerEvent 语义（2026-09-03，代码修复完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-202--cdp-click-的-pointerevent-语义2026-09-03代码修复完成) |  |
| Step 203 | 组合 CA、Body brand 与 Chrome click 坐标（2026-09-03，调查中） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-203--组合-cabody-brand-与-chrome-click-坐标2026-09-03调查中) |  |
| Step 204 | closed-shadow label sibling activation（2026-09-03，调查中） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-204--closed-shadow-label-sibling-activation2026-09-03调查中) |  |
| Step 205 | pointer activation 与真实代理 Cookie 闭环（2026-09-03，调查中） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-205--pointer-activation-与真实代理-cookie-闭环2026-09-03调查中) |  |
| Step 206 | payload 事件整数化、硬件画像 A/B 与 V8 lookup trace（2026-09-03，调查中） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-206--payload-事件整数化硬件画像-ab-与-v8-lookup-trace2026-09-03调查中) |  |
| Step 207 | Critical-CH 的 UA 别名补齐（2026-09-03，调查中） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-207--critical-ch-的-ua-别名补齐2026-09-03调查中) |  |
| Step 208 | iframe 窗口几何残差复核（2026-09-03，未决） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-208--iframe-窗口几何残差复核2026-09-03未决) |  |
| Step 209 | 可配置 iframe/窗口 screen metrics（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-209--可配置-iframe窗口-screen-metrics2026-09-03代码完成) |  |
| Step 210 | wreq Critical-CH 低熵头去重（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-210--wreq-critical-ch-低熵头去重2026-09-03代码完成) |  |
| Step 211 | 初始跨源 iframe 的隔离状态（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-211--初始跨源-iframe-的隔离状态2026-09-03代码完成) |  |
| Step 212 | 嵌套 iframe 初始隔离位继承（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-212--嵌套-iframe-初始隔离位继承2026-09-03代码完成) |  |
| Step 213 | screen.availTop/availLeft 宿主指标（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-213--screenavailtopavailleft-宿主指标2026-09-03代码完成) |  |
| Step 214 | 初始 about:blank 的 BackCompat 时序（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-214--初始-aboutblank-的-backcompat-时序2026-09-03代码完成) |  |
| Step 215 | compatMode 修复后的真实点击验收（2026-09-03，外部阻塞） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-215--compatmode-修复后的真实点击验收2026-09-03外部阻塞) |  |
| Step 216 | widget 嵌套 srcdoc origin 测量边界（2026-09-03，未决） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-216--widget-嵌套-srcdoc-origin-测量边界2026-09-03未决) |  |
| Step 217 | frame Fetch Metadata 与 stealth 传输（2026-09-03，代码完成） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-217--frame-fetch-metadata-与-stealth-传输2026-09-03代码完成) |  |
| Step 218 | frame profile 真实站复测（2026-09-03，外部阻塞） | 2026-09-03 | [归档](Cloudflare-challenge-profile-archive.md#step-218--frame-profile-真实站复测2026-09-03外部阻塞) |  |
| Step 219 | 当前 release 早期求值与 Brunhild DNS 复核（2026-09-05，外部阻塞） | 2026-09-05 | [归档](Cloudflare-challenge-profile-archive.md#step-219--当前-release-早期求值与-brunhild-dns-复核2026-09-05外部阻塞) |  |
| Step 220 | Brunhild edge-IP A/B（2026-09-05，外部阻塞） | 2026-09-05 | [归档](Cloudflare-challenge-profile-archive.md#step-220--brunhild-edge-ip-ab2026-09-05外部阻塞) |  |
| Step 221 | SecurityPolicyViolationEvent WebIDL 对齐（2026-09-05，代码完成） | 2026-09-05 | [归档](Cloudflare-challenge-profile-archive.md#step-221--securitypolicyviolationevent-webidl-对齐2026-09-05代码完成) |  |
| Step 222 | 初始空白文档的 origin、domain 与 referrer（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-222---初始空白文档的-origindomain-与-referrer2026-09-06代码完成) |  |
| Step 223 | Document.adoptedStyleSheets枚举描述符（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-223---documentadoptedstylesheets枚举描述符2026-09-06代码完成) |  |
| Step 224 | fetch传输错误类型（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-224---fetch传输错误类型2026-09-06代码完成) |  |
| Step 226 | XHR timeout取消底层请求（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-226---xhr-timeout取消底层请求2026-09-06代码完成) |  |
| Step 227 | Brunhild 通信归属与 timeout 分支（2026-09-06，调查中） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-227---brunhild-通信归属与-timeout-分支2026-09-06调查中) |  |
| Step 231 | 最新 release 代理复测（2026-09-06，调查中） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-231---最新-release-代理复测2026-09-06调查中) |  |
| Step 232 | Brunhild 请求头 CDP 对拍（2026-09-06，证据完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-232---brunhild-请求头-cdp-对拍2026-09-06证据完成) |  |
| Step 233 | iframe allow="cross-origin-isolated"（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-233---iframe-allowcross-origin-isolated2026-09-06代码完成) |  |
| Step 234 | iframe allow origin-list 解析（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-234---iframe-allow-origin-list-解析2026-09-06代码完成) |  |
| Step 235 | allow 修复后的真实 challenge 轮（2026-09-06，调查中） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-235---allow-修复后的真实-challenge-轮2026-09-06调查中) |  |
| Step 236 | isolated frame cpuPerformance（2026-09-06，代码完成） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-236---isolated-frame-cpuperformance2026-09-06代码完成) |  |
| Step 237 | cpuPerformance 后真实 challenge 复测（2026-09-06，未通过） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-237---cpuperformance-后真实-challenge-复测2026-09-06未通过) |  |
| Step 238 | 第三个 payload 点击事件对拍（2026-09-06，修复中） | 2026-09-06 | [归档](Cloudflare-challenge-profile-archive.md#step-238---第三个-payload-点击事件对拍2026-09-06修复中) |  |
| Step 239 | `gsLi5.o` Window/Navigator/Document 顺序与 named property（2026-09-07，代码完成） | 2026-09-07 | [归档](Cloudflare-challenge-profile-archive.md#step-239---gsli5o-windownavigatordocument-顺序与-named-property2026-09-07代码完成) |  |
| Step 240 | 最新 Chrome 149 `gsLi5` 全量顺序复核（2026-09-08，代码完成） | 2026-09-08 | [归档](Cloudflare-challenge-profile-archive.md#step-240---最新-chrome-149-gsli5-全量顺序复核2026-09-08代码完成) |  |
| Step 241 | 事件循环运行期间的 frame->main `postMessage`（2026-09-08，代码完成） | 2026-09-08 | [归档](Cloudflare-challenge-profile-archive.md#step-241---事件循环运行期间的-frame-main-postmessage2026-09-08代码完成) |  |
| Step 242 | `chrome-2-fo.har` 与失败消息内容对拍（2026-09-08，调查中） | 2026-09-08 | [归档](Cloudflare-challenge-profile-archive.md#step-242---chrome-2-fohar-与失败消息内容对拍2026-09-08调查中) |  |
| Step 243 | `/ci/` 当前请求统计与底层边界（2026-09-08，证据完成） | 2026-09-08 | [归档](Cloudflare-challenge-profile-archive.md#step-243---ci-当前请求统计与底层边界2026-09-08证据完成) |  |
| Step 244 | `/fo` 同源 POST 的 Origin 与最终导航 initiator（2026-09-08，代码完成） | 2026-09-08 | [归档](Cloudflare-challenge-profile-archive.md#step-244---fo-同源-post-的-origin-与最终导航-initiator2026-09-08代码完成) |  |
| Step 245 | 指定 `/1.txt` 的 clean payload、postMessage 和 V8 trace 复核（2026-09-08，调查中） | 2026-09-08 | [归档](Cloudflare-challenge-profile-archive.md#step-245---指定-1txt-的-clean-payloadpostmessage-和-v8-trace-复核2026-09-08调查中) |  |
| Step 246 | HaHaVM-General 直连 `/123.txt` 对拍（2026-09-10，完成） | 2026-09-10 | [归档](Cloudflare-challenge-profile-archive.md#step-246---hahavm-general-直连-123txt-对拍2026-09-10完成) |  |
| Step 247 | HaHaVM 窗口指标对拍与 Obscura 修复（2026-09-10，部分完成） | 2026-09-10 | [归档](Cloudflare-challenge-profile-archive.md#step-247---hahavm-窗口指标对拍与-obscura-修复2026-09-10部分完成) |  |
| Step 248 | HaHaVM TextEncoder CSS map A/B（2026-09-10，证据完成） | 2026-09-10 | [归档](Cloudflare-challenge-profile-archive.md#step-248---hahavm-textencoder-css-map-ab2026-09-10证据完成) |  |
| Step 249 | 正确 timezone 与完整 UA-CH 画像复测（2026-09-10，证据完成） | 2026-09-10 | [归档](Cloudflare-challenge-profile-archive.md#step-249---正确-timezone-与完整-ua-ch-画像复测2026-09-10证据完成) |  |
| Step 250 | HaHaVM Chrome148 TLS platform A/B（2026-09-10，证据完成） | 2026-09-10 | [归档](Cloudflare-challenge-profile-archive.md#step-250---hahavm-chrome148-tls-platform-ab2026-09-10证据完成) |  |
| Step 251 | HaHaVM 无点击成功轮 + payload 语义对拍 + 请求序列定点（2026-09-11，证据完成） | 2026-09-11 | [归档](Cloudflare-challenge-profile-archive.md#step-251---hahavm-无点击成功轮--payload-语义对拍--请求序列定点2026-09-11证据完成) | 证伪(正文) |
| Step 252 | 反机器人探测面暴露的常量桩与通用修复（2026-09-11，代码完成 / 真实 404 未达成） | 2026-09-11 | [归档](Cloudflare-challenge-profile-archive.md#step-252---反机器人探测面暴露的常量桩与通用修复2026-09-11代码完成--真实-404-未达成) |  |
| Step 253 | 反机器人探测面第二批通用修复（2026-09-11，代码完成 / 真实 404 仍未达成） | 2026-09-11 | [归档](Cloudflare-challenge-profile-archive.md#step-253---反机器人探测面第二批通用修复2026-09-11代码完成--真实-404-仍未达成) | 证伪(正文) |
| Step 254 | widget 的 `reloadApiJsRequest` 被拒：卡点从"proof 被拒"上移到"widget 从未完成"（2026-09-11，证据完成） | 2026-09-11 | [归档](Cloudflare-challenge-profile-archive.md#step-254---widget-的-reloadapijsrequest-被拒卡点从proof-被拒上移到widget-从未完成2026-09-11证据完成) | 证伪(正文) |
| Step 255 | OfflineAudioContext 原型链丢失导致 widget VM 崩溃（2026-09-13，修复完成） | 2026-09-13 | [归档](Cloudflare-challenge-profile-archive.md#step-255---offlineaudiocontext-原型链丢失导致-widget-vm-崩溃2026-09-13修复完成) |  |
| Step 256 | SVG 几何方法归属对齐（2026-09-13，验证完成） | 2026-09-13 | [归档](Cloudflare-challenge-profile-archive.md#step-256---svg-几何方法归属对齐2026-09-13验证完成) |  |
| Step 257 | Cross-origin isolated frame policy delegation (2026-09-13) | 2026-09-13 | [归档](Cloudflare-challenge-profile-archive.md#step-257---cross-origin-isolated-frame-policy-delegation-2026-09-13) |  |
| Step 258 | Post-fix environment surface audit (2026-09-13) | 2026-09-13 | [归档](Cloudflare-challenge-profile-archive.md#step-258---post-fix-environment-surface-audit-2026-09-13) |  |
| Step 259 | Chromium-151 fingerprint trace as the oracle; blob workers are real (2026-09-16) | 2026-09-16 | [归档](Cloudflare-challenge-profile-archive.md#step-259---chromium-151-fingerprint-trace-as-the-oracle-blob-workers-are-real-2026-09-16) | 证伪(正文)、更正(正文) |
| Step 260 | 插桩构建让 Obscura 产出 ov2 tracelog；payload 边界的无侵入捕获（2026-09-16） | 2026-09-16 | [归档](Cloudflare-challenge-profile-archive.md#step-260---插桩构建让-obscura-产出-ov2-tracelogpayload-边界的无侵入捕获2026-09-16) |  |
| Step 261 | 当轮新鲜（in-flight）插桩：两个 realm 都在原位打点（2026-09-16） | 2026-09-16 | [归档](Cloudflare-challenge-profile-archive.md#step-261---当轮新鲜in-flight插桩两个-realm-都在原位打点2026-09-16) | 证伪(正文) |
| Step 262 | 判定发生在加密交换内部：我们拿到的是「更短」的 clearance（2026-09-16） | 2026-09-16 | [归档](Cloudflare-challenge-profile-archive.md#step-262---判定发生在加密交换内部我们拿到的是更短的-clearance2026-09-16) | 证伪(正文) |
| Step 263 | 引擎内部全局经 `for..in` 泄漏：19 个 `__obscura_*` 在 window 上可枚举（2026-09-16，已修） | 2026-09-16 | [归档](Cloudflare-challenge-profile-archive.md#step-263---引擎内部全局经-forin-泄漏19-个-__obscura_-在-window-上可枚举2026-09-16已修) |  |
| Step 264 | `/fo/` 的载荷是「加密的 VM 字节码」，所以主机侧永远看不到程序（2026-09-16） | 2026-09-16 | [归档](Cloudflare-challenge-profile-archive.md#step-264---fo-的载荷是加密的-vm-字节码所以主机侧永远看不到程序2026-09-16) |  |
| Step 265 | （已删除）"the /fo/ responses decode without a session key, and our build is not the operator's"（两个核心结论均被推翻） |  | [归档](Cloudflare-challenge-profile-archive.md#step-265---已删除the-fo-responses-decode-without-a-session-key-and-our-build-is-not-the-operators两个核心结论均被推翻) | 推翻 |
| Step 266 | a probe the challenge does not detect, the worker realm, and a correction to step 265 |  | [归档](Cloudflare-challenge-profile-archive.md#step-266-a-probe-the-challenge-does-not-detect-the-worker-realm-and-a-correction-to-step-265) |  |
| Step 267 | the compute probe is workload, not a slow realm |  | [归档](Cloudflare-challenge-profile-archive.md#step-267-the-compute-probe-is-workload-not-a-slow-realm) |  |
| Step 268 | the worker-isolate path is adopted, and seven tests come with it |  | [归档](Cloudflare-challenge-profile-archive.md#step-268-the-worker-isolate-path-is-adopted-and-seven-tests-come-with-it) |  |
| Step 269 | the payload plaintext is in the console log, and the field-level diff |  | [归档](Cloudflare-challenge-profile-archive.md#step-269-the-payload-plaintext-is-in-the-console-log-and-the-field-level-diff) |  |
| Step 270 | resource timing is not inflated, worker timers fire, and the local proxy hop is not it |  | [归档](Cloudflare-challenge-profile-archive.md#step-270-resource-timing-is-not-inflated-worker-timers-fire-and-the-local-proxy-hop-is-not-it) |  |
| Step 271 | （已删除）"the stall is one statement after `new Worker`, measured in both realms"（核心观测被推翻） |  | [归档](Cloudflare-challenge-profile-archive.md#step-271---已删除the-stall-is-one-statement-after-new-worker-measured-in-both-realms核心观测被推翻) | 推翻 |
| Step 272 | the duplicate widget document is a Critical-CH retry, and it is not the stall |  | [归档](Cloudflare-challenge-profile-archive.md#step-272-the-duplicate-widget-document-is-a-critical-ch-retry-and-it-is-not-the-stall) |  |
| Step 273 | the caller returns — program-side measurement of the `new Worker` stop |  | [归档](Cloudflare-challenge-profile-archive.md#step-273-the-caller-returns--program-side-measurement-of-the-new-worker-stop) | 推翻(正文)、更正(正文) |
| Step 274 | the OPFS flush is a no-op, and the stall is the norm (not a proxy artefact) |  | [归档](Cloudflare-challenge-profile-archive.md#step-274-the-opfs-flush-is-a-no-op-and-the-stall-is-the-norm-not-a-proxy-artefact) |  |
| Step 275 | a runtime `(pc, key)` trace from our own session, and why the operator's spec cannot read our blob |  | [归档](Cloudflare-challenge-profile-archive.md#step-275-a-runtime-pc-key-trace-from-our-own-session-and-why-the-operators-spec-cannot-read-our-blob) |  |
| Step 276 | the worker handoff works, the OPFS sync access handle did not (fixed), and where the flow now ends |  | [归档](Cloudflare-challenge-profile-archive.md#step-276-the-worker-handoff-works-the-opfs-sync-access-handle-did-not-fixed-and-where-the-flow-now-ends) |  |
| Step 277 | the reference's OPFS timings, a correction to step 274, and where the decision is actually made |  | [归档](Cloudflare-challenge-profile-archive.md#step-277-the-references-opfs-timings-a-correction-to-step-274-and-where-the-decision-is-actually-made) |  |
| Step 278 | two probe candidates cleared by direct two-engine comparison, one left |  | [归档](Cloudflare-challenge-profile-archive.md#step-278-two-probe-candidates-cleared-by-direct-two-engine-comparison-one-left) |  |
| Step 278a | the PAT candidate is closed too, and so is the request inventory |  | [归档](Cloudflare-challenge-profile-archive.md#step-278a-the-pat-candidate-is-closed-too-and-so-is-the-request-inventory) |  |
| Step 279 | the widget instrumentation re-based on host surface, and a live Chrome run that stops earlier than we do |  | [归档](Cloudflare-challenge-profile-archive.md#step-279-the-widget-instrumentation-re-based-on-host-surface-and-a-live-chrome-run-that-stops-earlier-than-we-do) |  |
| Step 280 | the reference payload values, and two storage fields fixed from them |  | [归档](Cloudflare-challenge-profile-archive.md#step-280-the-reference-payload-values-and-two-storage-fields-fixed-from-them) |  |
| Step 281 | payload field diff, and two prototype surfaces fixed from a two-engine enumeration |  | [归档](Cloudflare-challenge-profile-archive.md#step-281-payload-field-diff-and-two-prototype-surfaces-fixed-from-a-two-engine-enumeration) |  |
| Step 282 | cpuPerformance was gated, SharedStorage was invented, and a test caught my first fix |  | [归档](Cloudflare-challenge-profile-archive.md#step-282-cpuperformance-was-gated-sharedstorage-was-invented-and-a-test-caught-my-first-fix) |  |
| Step 283 | the environment still blocks Chrome, and screen metrics are now self-consistent |  | [归档](Cloudflare-challenge-profile-archive.md#step-283-the-environment-still-blocks-chrome-and-screen-metrics-are-now-self-consistent) |  |
| Step 284 | `document.location` placed exactly as Chrome places it |  | [归档](Cloudflare-challenge-profile-archive.md#step-284-documentlocation-placed-exactly-as-chrome-places-it) |  |
| Step 285 | two fixes from objective-directed comparison (timer delivery at DCL, macOS default font metrics) |  | [归档](Cloudflare-challenge-profile-archive.md#step-285-two-fixes-from-objective-directed-comparison-timer-delivery-at-dcl-macos-default-font-metrics) |  |
| Step 286 | offset* no longer include transforms; the atomic-only strut gap characterized |  | [归档](Cloudflare-challenge-profile-archive.md#step-286-offset-no-longer-include-transforms-the-atomic-only-strut-gap-characterized) |  |
| Step 287 | the line-box strut reaches atomic-only runs; p6/p7 parity |  | [归档](Cloudflare-challenge-profile-archive.md#step-287-the-line-box-strut-reaches-atomic-only-runs-p6p7-parity) |  |
| Step 288 | summary marker parity (p5 now exact); map_rect saturation |  | [归档](Cloudflare-challenge-profile-archive.md#step-288-summary-marker-parity-p5-now-exact-map_rect-saturation) |  |
| Step 289 | instrumenting the geometry op fixed p1 — the matrix folded origin overflowed |  | [归档](Cloudflare-challenge-profile-archive.md#step-289-instrumenting-the-geometry-op-fixed-p1--the-matrix-folded-origin-overflowed) |  |
| Step 290 | caption-only tables join the grid, and tables shrink-to-fit |  | [归档](Cloudflare-challenge-profile-archive.md#step-290-caption-only-tables-join-the-grid-and-tables-shrink-to-fit) |  |
| Step 291 | doc re-check and a post-rotation flow round |  | [归档](Cloudflare-challenge-profile-archive.md#step-291-doc-re-check-and-a-post-rotation-flow-round) |  |
| Step 292 | pacing comparison against the reference HAR |  | [归档](Cloudflare-challenge-profile-archive.md#step-292-pacing-comparison-against-the-reference-har) |  |
| Step 293 | full-trace round is flow-degrading as documented; verdict stable |  | [归档](Cloudflare-challenge-profile-archive.md#step-293-full-trace-round-is-flow-degrading-as-documented-verdict-stable) |  |
| Step 294 | the caption's vertical border was never missing — the gap is shaping-font metrics |  | [归档](Cloudflare-challenge-profile-archive.md#step-294-the-captions-vertical-border-was-never-missing--the-gap-is-shaping-font-metrics) |  |
| Step 295 | caption border confirmed counted; fast-path leaves carry the strut; identity shaping fonts scoped |  | [归档](Cloudflare-challenge-profile-archive.md#step-295-caption-border-confirmed-counted-fast-path-leaves-carry-the-strut-identity-shaping-fonts-scoped) |  |
| Step 296 | identity-aware PingFang loading landed — inert on this host by absence of the file |  | [归档](Cloudflare-challenge-profile-archive.md#step-296-identity-aware-pingfang-loading-landed--inert-on-this-host-by-absence-of-the-file) |  |
| Step 297 | the overdue-timer repair now re-arms deno_core's sleep — PWGF4 delivery at 5 ms |  | [归档](Cloudflare-challenge-profile-archive.md#step-297-the-overdue-timer-repair-now-re-arms-deno_cores-sleep--pwgf4-delivery-at-5-ms) | 证伪(正文)、推翻(正文)、作废(正文) |
| Step 298 | the TS#2 "park" was the proxy's injected replay build, not the engine (2026-09-17) | 2026-09-17 | [归档](Cloudflare-challenge-profile-archive.md#step-298-the-ts2-park-was-the-proxys-injected-replay-build-not-the-engine-2026-09-17) |  |
| Step 299 | debugger 探针任务被静默丢弃 + 页面可见 console 探针（2026-09-17） | 2026-09-17 | [归档](Cloudflare-challenge-profile-archive.md#step-299-debugger-探针任务被静默丢弃--页面可见-console-探针2026-09-17) |  |
| Step 300 | 完整 payload 离线解密对拍——普查面实锤一批 + 计数器/变体分岔定位（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-300-完整-payload-离线解密对拍普查面实锤一批--计数器变体分岔定位2026-09-19) |  |
| Step 301 | 修复批次 13 落地——普查面 7 项 + atob/btoa 原生化 + worker 隔离位（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-301-修复批次-13-落地普查面-7-项--atobbtoa-原生化--worker-隔离位2026-09-19) |  |
| Step 302 | 批次 13 验证——结构面全对齐，TS#3 从 2.9KB 变 92KB（2026-09-19 03:0x） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-302-批次-13-验证结构面全对齐ts3-从-29kb-变-92kb2026-09-19-030x) | 作废(正文) |
| Step 303 | 修复批次 14A 落地——哈希探针测量面 + battery/downlink/quota 值面 + dir 分岔定位（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-303-修复批次-14a-落地哈希探针测量面--batterydownlinkquota-值面--dir-分岔定位2026-09-19) |  |
| Step 304 | 批次 14B——worker 阶段 268ms 修复（消息管线）+ ZMSOw0 残差剖析（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-304-批次-14bworker-阶段-268ms-修复消息管线-zmsow0-残差剖析2026-09-19) |  |
| Step 305 | 批次 14 验证——worker 唤醒修复解开注入版停摆，时序再降（2026-09-19 05:1x） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-305-批次-14-验证worker-唤醒修复解开注入版停摆时序再降2026-09-19-051x) |  |
| Step 306 | 修复批次 15A——哈希探针测量面两处 Chrome 语义差（未渲染测量 + 几何接口品牌），槽位映射证据闭环（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-306-修复批次-15a哈希探针测量面两处-chrome-语义差未渲染测量--几何接口品牌槽位映射证据闭环2026-09-19) |  |
| Step 307 | 批次 15B——两个活体时序残差本地闭环：空闲页 worker 回复搁浅 + 准备路径克隆churn（2026-09-19 07:xx） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-307-批次-15b两个活体时序残差本地闭环空闲页-worker-回复搁浅--准备路径克隆churn2026-09-19-07xx) |  |
| Step 309 | 修复批次 16-SVG——`<text>` 元素接入 Chrome 的 SVG 文本接口晶格，探针形 fixture 20/20 ctl + extent 首次可达（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-309-修复批次-16-svgtext-元素接入-chrome-的-svg-文本接口晶格探针形-fixture-2020-ctl--extent-首次可达2026-09-19) |  |
| Step 308 | 修复批次 16-性能——强制 re-prepare 的文本重整形跨 pass 缓存，churn 后单次 gBCR 118→23ms（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-308-修复批次-16-性能强制-re-prepare-的文本重整形跨-pass-缓存churn-后单次-gbcr-11823ms2026-09-19) |  |
| Step 310 | 修复批次 17——哈希探针活体两道叠门（WebIDL 索引转换 + 几何对象内部槽），extent 首次在实弹应答 SVGRect；判决轮仍重启（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-310-修复批次-17哈希探针活体两道叠门webidl-索引转换--几何对象内部槽extent-首次在实弹应答-svgrect判决轮仍重启2026-09-19) |  |
| Step 311 | 批次 16 全量验证——哈希探针实弹关闭，判决仍 fail（2026-09-19 12:0x） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-311-批次-16-全量验证哈希探针实弹关闭判决仍-fail2026-09-19-120x) |  |
| Step 314 | 修复批次 18——窗口表面函数 toString 全量原生化，四 realm 探针 1558→0（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-314-修复批次-18窗口表面函数-tostring-全量原生化四-realm-探针-155802026-09-19) |  |
| Step 313 | /ci/ PrivateToken 假说证伪，/ci/ 门的真实形状定位，HTML 接口晶格修复（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-313-ci-privatetoken-假说证伪ci-门的真实形状定位html-接口晶格修复2026-09-19) | 证伪、更正(正文)、作废(正文) |
| Step 312 | 修复批次 17-性能——deferred-surface frame realm boot，空 about:blank 帧启动 62ms→7ms（2026-09-19） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-312-修复批次-17-性能deferred-surface-frame-realm-boot空-aboutblank-帧启动-62ms7ms2026-09-19) |  |
| Step 315 | 批次 17/18 验证——1558→0 native 泄漏关闭，探针失败标记消失（2026-09-19 22:0x） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-315-批次-1718-验证15580-native-泄漏关闭探针失败标记消失2026-09-19-220x) | 证伪(正文)、更正(正文) |
| Step 316 | console 回归排查证伪、console 模块核心面固化 + Chrome 形序列化，cons21 槽位对拍（2026-09-19 22:2x） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-316-console-回归排查证伪console-模块核心面固化--chrome-形序列化cons21-槽位对拍2026-09-19-222x) | 证伪 |
| Step 317 | 前置记录：ver21 揭示批次 17/18 的时序回归（2026-09-19 23:1x） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-317-前置记录ver21-揭示批次-1718-的时序回归2026-09-19-231x) |  |
| Step 317 | 修复批次 20——惰性深扫退役 + core-surface 原型交换快路径（2026-09-19 深夜） | 2026-09-19 | [归档](Cloudflare-challenge-profile-archive.md#step-317-修复批次-20惰性深扫退役--core-surface-原型交换快路径2026-09-19-深夜) |  |
| Step 318 | 前置：批次 20 验证 + final22（2026-09-20 01:2x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-318-前置批次-20-验证--final222026-09-20-012x) |  |
| Step 318 | 修复批次 21——frame realm 的 snapshot 级表面模板，水合 115-213ms→16-25ms（2026-09-20 凌晨） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-318-修复批次-21frame-realm-的-snapshot-级表面模板水合-115-213ms16-25ms2026-09-20-凌晨) |  |
| Step 319 | 探针块解码（第五轮）+ /ci/ 生产解锁（2026-09-20 04:5x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-319探针块解码第五轮-ci-生产解锁2026-09-20-045x) | 证伪(正文) |
| Step 320 | 标记检查修复（批次 22）——console 计数 + 绑定函数毒丸 + 子 realm 链对照（2026-09-20 06:3x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-320标记检查修复批次-22console-计数--绑定函数毒丸--子-realm-链对照2026-09-20-063x) |  |
| Step 321 | brunhild 传输缺口——ClientHello 对齐 Chrome 151 + 路由残差（2026-09-20 08-10） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-321brunhild-传输缺口clienthello-对齐-chrome-151--路由残差2026-09-20-08-10) |  |
| Step 321 | 补充：final26/27 判决 + brunhild 路由窗口（2026-09-20 10:0x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-321-补充final2627-判决--brunhild-路由窗口2026-09-20-100x) | 更正(正文) |
| Step 322 | 批次 24——"解释器派发 6-7x"假设证伪：V8 面全对齐，残差钉在强制 re-prepare 面（2026-09-20 11:0x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-322批次-24解释器派发-6-7x假设证伪v8-面全对齐残差钉在强制-re-prepare-面2026-09-20-110x) | 证伪 |
| Step 323 | 修复批次 25——强制 re-prepare 的趟次合并 + 属性增量化重建，attr-churn prepare 20→12ms（2026-09-20 13:5x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-323修复批次-25强制-re-prepare-的趟次合并--属性增量化重建attr-churn-prepare-2012ms2026-09-20-135x) |  |
| Step 324 | 修复批次 26——树损结构化 resync：树突变原位拼接保留 taffy 树，decode gBCR 份额 61.2→38.5ms（2026-09-20 16:5x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-324修复批次-26树损结构化-resync树突变原位拼接保留-taffy-树decode-gbcr-份额-612385ms2026-09-20-165x) |  |
| Step 325 | 批次 24-26 验证汇总（2026-09-20 17:1x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-325批次-24-26-验证汇总2026-09-20-171x) |  |
| Step 326 | 修复批次 27——Step 323 后续项②③落地：derived-state 六趟并两趟 + clean-subtree 几何复用 + 全文档扫描闩锁，decode gBCR 份额 39.2→28.3ms（2026-09-20 20:0x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-326修复批次-27step-323-后续项②③落地derived-state-六趟并两趟--clean-subtree-几何复用--全文档扫描闩锁decode-gbcr-份额-392283ms2026-09-20-200x) |  |
| Step 327 | 修复批次 28——Step 326 后续项①②落地：gBCR op 桥接砍到微秒级 + cascade fresh 链剪枝 + resync 期望子列表 memo 拼接，decode gBCR 份额 28.3→26.0ms（配对，负载期）（2026-09-20 21:5x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-327修复批次-28step-326-后续项①②落地gbcr-op-桥接砍到微秒级--cascade-fresh-链剪枝--resync-期望子列表-memo-拼接decode-gbcr-份额-283260ms配对负载期2026-09-20-215x) |  |
| Step 328 | 修复批次 29——网络面：AAAA-only 域名在无全局 IPv6 的机器上即时失败（family gate），替代慢速连接死亡（2026-09-20 22:4x） | 2026-09-20 | [归档](Cloudflare-challenge-profile-archive.md#step-328修复批次-29网络面aaaa-only-域名在无全局-ipv6-的机器上即时失败family-gate替代慢速连接死亡2026-09-20-224x) |  |
| Step 329 | 修复批次 30——console 指纹电池解码与 shadowed-stack 修复：信标 Qssv3 20→2（Chrome 精确值），判决仍 fail（2026-09-21 凌晨） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-329修复批次-30console-指纹电池解码与-shadowed-stack-修复信标-qssv3-202chrome-精确值判决仍-fail2026-09-21-凌晨) | 作废(正文) |
| Step 330 | 修复批次 31——跨 realm console 原生串化修复：活体电池 ODxGu4 探针槽翻成 Chrome 形（原生函数源），判决仍 fail（2026-09-21 凌晨） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-330修复批次-31跨-realm-console-原生串化修复活体电池-odxgu4-探针槽翻成-chrome-形原生函数源判决仍-fail2026-09-21-凌晨) |  |
| Step 331 | 修复批次 32——跨 realm toString cross 表自递归修复（每探针一次栈溢出周期），count 行实为挑战轮换回归，fold NaN 路径与 TBNgK7 旗源仍开放；判决三连 fail（2026-09-21 凌晨） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-331修复批次-32跨-realm-tostring-cross-表自递归修复每探针一次栈溢出周期count-行实为挑战轮换回归fold-nan-路径与-tbngk7-旗源仍开放判决三连-fail2026-09-21-凌晨) | 作废(正文) |
| Step 332 | 修复批次 33——wrapper 内部槽全面非枚举化（435 处 `_hset`）+ 事件 init 槽/NodeList/location 形状对齐：ver42 判决首轮 POST /1.txt 404（历史首次过线），复验两轮 GET 403；判决判定为间歇，未稳定翻转（2026-09-21 凌晨） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-332修复批次-33wrapper-内部槽全面非枚举化435-处-_hset-事件-init-槽nodelistlocation-形状对齐ver42-判决首轮-post-1txt-404历史首次过线复验两轮-get-403判决判定为间歇未稳定翻转2026-09-21-凌晨) |  |
| Step 333 | 里程碑——final41 首次通过（POST /1.txt → 404），通过率 1/6（2026-09-21 06:4x） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-333里程碑final41-首次通过post-1txt--404通过率-162026-09-21-064x) |  |
| Step 334 | 修复批次 34——unhandled rejection 引擎面修复：worker 回包分类族解码完成，判决轮 5/5 全过（final44-48 连续 POST /1.txt → 404），通过率 1/6 → 5/5（2026-09-21 上午） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-334修复批次-34unhandled-rejection-引擎面修复worker-回包分类族解码完成判决轮-55-全过final44-48-连续-post-1txt--404通过率-16--552026-09-21-上午) |  |
| Step 335 | 批次 34 复核——5/5 真实但限旧 build；轮换后 0/3 为 epoch 评分（2026-09-21 11:2x） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-335批次-34-复核55-真实但限旧-build轮换后-03-为-epoch-评分2026-09-21-112x) |  |
| Step 336 | 批次 35——旗标写点解码半程：电池卫兵/探针闭包/worker 回包帧槽通道解码完成，worker eval 形状本机实锤对平；当前 build 引擎内四处 methodCall 派发钩子全不命中，活体旗值未读到；判决 0/3 维持（2026-09-21 午后） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-336批次-35旗标写点解码半程电池卫兵探针闭包worker-回包帧槽通道解码完成worker-eval-形状本机实锤对平当前-build-引擎内四处-methodcall-派发钩子全不命中活体旗值未读到判决-03-维持2026-09-21-午后) |  |
| Step 337 | 批次 36——电池派发实锤（SU/Sp/Q0）+ 抛点图谱（三连探针 + eval 拒绝），b35 零命中系日志级别假象；无修复落盘，判决维持 0/3（2026-09-21 午后） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-337批次-36电池派发实锤suspq0-抛点图谱三连探针--eval-拒绝b35-零命中系日志级别假象无修复落盘判决维持-032026-09-21-午后) |  |
| Step 338 | 批次 37——eval 门决策表全 allow（ver46 一轮定位），b36 引擎当轮被替换（ov2 周转 a7533ef6），Chrome 实测推翻两项嫌疑、落两处静态保真修复，判决 0/5（2026-09-21 夜） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-338批次-37eval-门决策表全-allowver46-一轮定位b36-引擎当轮被替换ov2-周转-a7533ef6chrome-实测推翻两项嫌疑落两处静态保真修复判决-052026-09-21-夜) | 推翻 |
| Step 339 | 批次 38——a7533ef6 工具链重推（新 VM 常量 + 112 连发活体验证），键链断裂主因系多实例交错，抛点图谱更新（164/164/155），epoch 判决 0/5（2026-09-21 午后） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-339批次-38a7533ef6-工具链重推新-vm-常量--112-连发活体验证键链断裂主因系多实例交错抛点图谱更新164164155epoch-判决-052026-09-21-午后) |  |
| Step 340 | 批次 39——三连抛点操作数全解（setPrototypeOf(X,X) / fn['arguments'] / X.toString.call(X)，探针语义与 Chrome 一致），ov2 周转 58800b74 全套工具链重推，G3 跳转+二次 LCG 黑盒钉死，Worker.prototype 11→5 收敛，判决 0/5（2026-09-21 夜） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-340批次-39三连抛点操作数全解setprototypeofxx--fnarguments--xtostringcallx探针语义与-chrome-一致ov2-周转-58800b74-全套工具链重推g3-跳转二次-lcg-黑盒钉死workerprototype-115-收敛判决-052026-09-21-夜) | 推翻(正文) |
| Step 341 | 批次 40——ver48 完成 beacon 解密成功，完成轮字段级对拍全谱（38 组一一对应，SbVZ3 91 vs 14 仍是最大缺口），四处已证面修复落盘（Worker/SharedWorker 实例零 own、when 移除、键盘布局 48 项），TS#1 400/600010 短路新失败面（注入件过期即被切，A/B 实证非本批回归），判决 0/5（2026-09-21 深夜） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-341批次-40ver48-完成-beacon-解密成功完成轮字段级对拍全谱38-组一一对应sbvz3-91-vs-14-仍是最大缺口四处已证面修复落盘workersharedworker-实例零-ownwhen-移除键盘布局-48-项ts1-400600010-短路新失败面注入件过期即被切ab-实证非本批回归判决-052026-09-21-深夜) |  |
| Step 342 | 批次 41——fddfbf79 工具链全套重推（取指/LCG 活体 8/8 链验证），电池卫兵块解码（互反 NOT 旗标 + worker 状态帧读），根因落定：Chrome 对 %c%d 格式替换会触发探针 toString 而我方从不触碰，修复后 beacon 14 → 78（块 8/9 方法到位，trio 5 条与第 9 方法 8 条仍缺），判决 0/5（2026-09-21 深夜） | 2026-09-21 | [归档](Cloudflare-challenge-profile-archive.md#step-342批次-41fddfbf79-工具链全套重推取指lcg-活体-88-链验证电池卫兵块解码互反-not-旗标--worker-状态帧读根因落定chrome-对-cd-格式替换会触发探针-tostring-而我方从不触碰修复后-beacon-14--78块-89-方法到位trio-5-条与第-9-方法-8-条仍缺判决-052026-09-21-深夜) | 证伪(正文) |
| Step 343 | 批次 42——轮换模板 ov2key 残留清除（patch_fixed_key 新增 none sink 设为默认 + served 件强制重打 055f45dc），残差 13 条解码：第 9 方法=console.dir（QLaZp6），dir fold 被挑战载体 Error（stack=Qssv3、name/message 毒 getter）占用；console 面触发数与 Chrome 153 逐项对平无引擎面可修，干净 ver52 beacon 78，判决 0/5（2026-09-22 凌晨） | 2026-09-22 | [归档](Cloudflare-challenge-profile-archive.md#step-343批次-42轮换模板-ov2key-残留清除patch_fixed_key-新增-none-sink-设为默认--served-件强制重打-055f45dc残差-13-条解码第-9-方法consoledirqlazp6dir-fold-被挑战载体-errorstackqssv3namemessage-毒-getter占用console-面触发数与-chrome-153-逐项对平无引擎面可修干净-ver52-beacon-78判决-052026-09-22-凌晨) |  |
| Step 344 | 批次 43——8587b07f 全套工具链重推（strtab 2015 项旋转 342、Wz 寄存器 XOR、双取指模 +115/+141、LCG ×31843+31841），载体调度全解（臂进 throw→catch 帧恢复→臂体→T 返回载体；catch 帧随工作队列、T=RET），我方 vs Chrome VM 层逐项对称无分歧面，干净 ver53 beacon 78，判决 0/5（2026-09-22 凌晨） | 2026-09-22 | [归档](Cloudflare-challenge-profile-archive.md#step-344批次-438587b07f-全套工具链重推strtab-2015-项旋转-342wz-寄存器-xor双取指模-115141lcg-3184331841载体调度全解臂进-throwcatch-帧恢复臂体t-返回载体catch-帧随工作队列tret我方-vs-chrome-vm-层逐项对称无分歧面干净-ver53-beacon-78判决-052026-09-22-凌晨) |  |
| Step 345 | 全量插桩对拍——1,920 圈空白画布扫描循环定位（2026-09-22 深夜） | 2026-09-22 | [归档](Cloudflare-challenge-profile-archive.md#step-345全量插桩对拍1920-圈空白画布扫描循环定位2026-09-22-深夜) |  |
| Step 346 | fillText 空白根因落定——textBaseline 缺失，修复上线（2026-09-23 凌晨） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-346filltext-空白根因落定textbaseline-缺失修复上线2026-09-23-凌晨) |  |
| Step 347 | textBaseline 修复实弹确认——扫描循环塌缩 67 倍（2026-09-23 00:1x） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-347textbaseline-修复实弹确认扫描循环塌缩-67-倍2026-09-23-001x) |  |
| Step 348 | 批次 45——指令级差分循环再开即遭遇 serve 侧换代（stage4v3 件轮换消失、mitmproxy 被 Reqable 接管），gate 级对拍仍锁出两处引擎面分歧并修复（RTC icecandidate 事件对象、Document.prototype toStringTag），判决期主程序恢复下发，SbVZ3 78 持平，判决 0/5（2026-09-23 凌晨） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-348批次-45指令级差分循环再开即遭遇-serve-侧换代stage4v3-件轮换消失mitmproxy-被-reqable-接管gate-级对拍仍锁出两处引擎面分歧并修复rtc-icecandidate-事件对象documentprototype-tostringtag判决期主程序恢复下发sbvz3-78-持平判决-052026-09-23-凌晨) |  |
| Step 349 | 批次 46——candidate 群体按 Chrome 153 对拍定形（foundation 按接口共用、srflx 逐 section）、HTMLDocument 静态链翻正；canvas 富配置区在换代件下仍未观测（www 主程序零 canvas 读、TS widget 侧 TextMetrics 探针已实名运行），判决 0/6 全为 retry 环（2026-09-23 凌晨） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-349批次-46candidate-群体按-chrome-153-对拍定形foundation-按接口共用srflx-逐-sectionhtmldocument-静态链翻正canvas-富配置区在换代件下仍未观测www-主程序零-canvas-读ts-widget-侧-textmetrics-探针已实名运行判决-06-全为-retry-环2026-09-23-凌晨) |  |
| Step 350 | 批次 47——retry 环 A/B 归因（8b7381c 无罪，CF 臂方差），TextMetrics 数值与 Chrome 153 位形全对齐，判决 0/6 仍全 retry（2026-09-23 凌晨） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-350批次-47retry-环-ab-归因8b7381c-无罪cf-臂方差textmetrics-数值与-chrome-153-位形全对齐判决-06-仍全-retry2026-09-23-凌晨) |  |
| Step 351 | 批次 48——fresh 对拍全谱（obK TS#2+TS#3 双解，39 号臂定位为 PoW 基准臂：完成槽位插入、位次后移实锤但引擎面无干净排序修），window 几何键序 + srcdoc referrer 两处引擎面修复，信标字母表按构建轮换、判决轮改配同窗 rch probe，判决 0/5（3 停滞 + 2 retry 环）（2026-09-23 上午） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-351批次-48fresh-对拍全谱obk-ts2ts3-双解39-号臂定位为-pow-基准臂完成槽位插入位次后移实锤但引擎面无干净排序修window-几何键序--srcdoc-referrer-两处引擎面修复信标字母表按构建轮换判决轮改配同窗-rch-probe判决-053-停滞--2-retry-环2026-09-23-上午) |  |
| Step 352 | 批次 49——Step 351 引擎面候选逐项落锤：三处 Chrome 153 oracle 实修（media 默认变体、帧名浏览器上下文语义、Range 内容搬移），gPOK0 实弹 1→3 命名帧，其余候选按证据定类（机器方差/未解），判决 0/5（5 retry 环, 全流程+cycle2）（2026-09-23 下午） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-352批次-49step-351-引擎面候选逐项落锤三处-chrome-153-oracle-实修media-默认变体帧名浏览器上下文语义range-内容搬移gpok0-实弹-13-命名帧其余候选按证据定类机器方差未解判决-055-retry-环-全流程cycle22026-09-23-下午) |  |
| Step 353 | 批次 50——gPOK0 帧游走续攻：CDP 全程对拍推翻 boot 计数差假说，实锤帧名自视图缺陷并引擎侧落锤（frame_context_names），实弹编号进入 21/22 带但组成仍未及参考，native trace 仪器轮读出 aQgx8 为 orchestrate 侧 beacon 组装 GET，判决 0/5（5 retry 环，臂型不变）（2026-09-23 傍晚） | 2026-09-23 | [归档](Cloudflare-challenge-profile-archive.md#step-353批次-50gpok0-帧游走续攻cdp-全程对拍推翻-boot-计数差假说实锤帧名自视图缺陷并引擎侧落锤frame_context_names实弹编号进入-2122-带但组成仍未及参考native-trace-仪器轮读出-aqgx8-为-orchestrate-侧-beacon-组装-get判决-055-retry-环臂型不变2026-09-23-傍晚) | 推翻、证伪(正文) |
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
| 把「改 light DOM 后截图不变」当成「绘制表面陈旧」(step 16,被 step 17 推翻) | Turnstile UI 全挂在 body 的 closed shadow root 里,light DOM 子节点本就不参与渲染,截图不变是正确行为;据此把方向带偏到「表面不随 DOM 更新」,还据此作废了 step 15 前的正确推断 | 有 shadow root 时因果测试要改 shadow 内容而非 light DOM;尽早拉真实浏览器基线(js-reverse/Chrome)逐项对照,不要只从截图反推 |
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

### 本轮（2026-09-24）新增的观测盲区

| 盲区 | 后果 | 正确做法 |
|------|------|----------|
| **`--trace-op-file` 不记录 `Image`/`srcset`/CSS 资源加载** | 误判「我们从不发 `/ci/` 请求」，据此写了一整节错误分析 | 网络证据要用 `performance.getEntriesByType('resource')`（含 `initiatorType`）或 `img` 的 `onload/onerror`；**凡「某请求 0 次」的结论，必须先排除这条通道** |
| **在多人/多 agent 共享工作区跑 `git stash`** | 把**所有**并行 agent 的未提交工作一起卷走、工作区被清空 | 验证「没有修复时测试会失败」用**可开关的形式**、仓库外副本或隔离 worktree；**绝不用 `git stash`**。同类：不带路径的 `git commit` 会把别人预先 staged 的文件一起提交 |
| **harness 常数伪装成「窗口」** | 旧点击脚本把 `fo-click-delay` 固定为 3.0s，于是每个通过轮都落在同一常量偏移，被误读成 CF 的点击窗口（+2.27~+2.83s） | 扫参数时要**扫一个区间**，不要只改一个值就宣称发现了边界；对照实验必须同形 |
| **「Chrome 替身」≠ 参考机的 Chrome** | 本地 stock Chrome（本机几何）与参考机（插桩）Chrome 在同一程序上跑出不同步数（934 vs 847），据此得到「Chrome vs Obscura」的假分离 | 跨机器对拍前先证明**你的对照装置能复现参考的基线值**；不能复现就不要拿它当基准 |
| **VM 的 opcode id 每次加载随机置换** | 按 `op` 值做 Chrome-vs-Obscura 对比等于**在比一个置换** | `(op,pc,st)` 里只有 **`pc`** 稳定可比；一切逐指令对齐都用 pc |
| **CDP 注入 shim 的 drain 时机** | 在点击**之后**才开始 drain，widget OOFIF 已被拆除 ⇒ 记录 0 条，被误读成「注入没生效」 | drain 必须与点击在**同一个循环**里；先确认 `records > 0` 再谈结论 |
| **复用 `--user-data-dir`** | 上一轮的 `cf_clearance` 被带过去，下一轮直接 404 ——**根本没走挑战**，却被记成「通过」 | 每轮全新 profile；并在轮内检查 `location.href`，异常轮标 `invalid` 且**不消耗轮次** |
| **代理链路可能中途挂掉**（本次 `:9000` Reqable 卡死：端口在听但不服务） | 连接超时被记成「挑战失败」 | 轮内检测 `chrome-error://` / `location.href`；链路是多段时（本例 `:9000 → :8080`）**换一段直连即可绕过**，先测哪一段活着 |


## 未决

**已迁至顶部「当前状态 → C. 未决」（2026-09-24 重写）。**

原始清单（写于 Step 39–47 时代，首要项「`/pat/` 从不发出」已修复）已逐字移入
[归档](Cloudflare-challenge-profile-archive.md)。

### Step 354：批次 51——**固定 key 解密打通上行 payload 明文**，同 epoch 四方对拍（headed 过 / headless 败于 UA / 干净 UA headless 过 / 我们败），首次拿到 payload#2 逐字段分岔表；实锤两项引擎缺陷（子帧窗口几何恒 0、window 缺 SharedArrayBuffer）+ 一项 harness 陈旧身份（UA 151/15 核），判决 0/1（轮次未走完，见 §354.7）（2026-09-24 凌晨）

#### 354.1 方法突破：上行 payload 明文可解

此前 §10.14/10.19 判定「上行密文不可解，只能靠远程 replay 引擎再生」——**该结论作废**。

- 现行 ov2.js（注入链路服务的那份，`patch_fixed_key` 形态）把 `ot[40..118]` 覆写成 9 周期常量
  `W=[0x7a,0x13,0x9c,0x41,0xe2,0x58,0xbd,0x06,0xf4]`，于是任意 `pad` 派生同一把 key：
  `key = (W 重复 16B) ⊕ 垫 734761626b7876487759754e6654744e = 0954fd238920cb4e832366d227b62cf3`。
  实测 W⊕垫 逐字节等于该常量（§7 旧文档的 `__OV2FIXEDKEY__` 注释标记已不再写出，**不要用 mark 计数判定补丁是否生效**，要看 `vy[40+i]=W[i%9]` 这行）。
- 字母表随 build 轮换，且**分两层**：
  - Turnstile 层：`ov2.js` 里 `v3 = \`<65 字符>\``（本轮 `tAwLxfRr…IeNDmj`）
  - 页面层（`www.thelancet.com/…/h/b/orchestrate/chl_page`）：脚本里同形态 65 字符串，**与 Turnstile 层不同**
- 解密命令（本轮实际使用，`--ov2js` 指本轮抓的 ov2probe.js 可自动提表）：

```bash
python3 .claude/skills/ov2-payload-decrypt/scripts/ov2_payload_codec.py \
  --body-file <fo_N_host_LEN.txt> \
  --key-hex 0954fd238920cb4e832366d227b62cf3 \
  --ov2js <本轮 ov2probe.js> --out-dir <dir> --roundtrip --print json
```

- **边界**：页面层 `/fo/` 解不开（`magic 校验失败 0148 vs fd01`）——主页 `orchestrate/chl_page` 是**未 patch 的真 CF 脚本**，注入只在 `/turnstile/…/rch/` 生效，其 key 不可控。判决面在 Turnstile 三段落（TS#1/2/3）内，故不影响。
- 交叉自证：headed Chrome 的 `payloadjson_02/03.txt`（console 明文，113821/117619 字符）与解密出的 `payload.json` **长度逐字节相同**，roundtrip 通过。

#### 354.2 同 epoch 四方（本机 Chrome 153.0.8010.48，同代理 http://192.168.3.57:9000，同 URL）

| 轮 | 模式 / UA | 点击 | 最终 `POST /1.txt` | 判定 |
|---|---|---|---|---|
| headed | 有头，自然 UA | 9s | **404** | **通过** |
| headless | `--headless=new`，自然 UA（含 `HeadlessChrome`） | 9s | 无 | 失败（重开一环） |
| headless-cleanua | `--headless=new` + 干净 153 UA | 9s | **404** | **通过** |
| headless-cleanua-r3 | 同上（复现） | 9s | **404** | **通过** |
| ours（r01） | obscura，`--user-agent …Chrome/151` | 14s | 无 | 失败（重开一环，2 ray） |

`/fo/` 段数与体长（host 序列：page → ts → ts → ts → page）：
- headed（5 段）：2370 / 4695 / **90487** / **93698** / 9090
- cleanua（5 段）：2370 / 4716 / **91586** / **94850** / 9068
- ours（7 段，重开）：2370 / 4716 / **90807** / **94274** / 7863 / 2370 / 4930

**§10.22 的决定性推论被推翻**：「headless Chrome 也败 ⇒ 判决不在 payload#1」——实际 headless 的失败源于 **UA 里的 `HeadlessChrome` 标记**（`zIyO8.jKeeJ4` 在 payload#2 里明文记录了 UA），换成干净 UA 后 headless **三次全过**。故 headless 不是有效对照臂；**「headless 类客户端普遍敌对」（§10.6/10.11）的归因是错的，应记为 UA 明文 tell**。

#### 354.3 响应字节码（W3 解，Turnstile 层）

| 段 | 我方 r01 | 参考（0916 会话） |
|---|---|---|
| TS#1 | 475814 | 462724 |
| TS#2 | **71569** | 71564 |
| TS#3 | **2943** | **4029** |
| main#2 | 1960 | 2056 |

TS#2 程序**几乎等长**（差 5B）⇒ 服务端在 TS#2 **没有**给我们不同程序；TS#3 变短（失败变体）。裁决发生在 TS#2 报文被消费之后。

#### 354.4 对拍器（新增，仓库外）

- `/tmp/cf-parity/threeway.py <passA.json> <passB.json> <ours.json>`：**只报「两个通过臂互相一致、与我方不同」的字段**，把臂间噪声（会话随机）单独归类。这是本轮最有用的工具——它把 20+ 条候选压成一张确定性差异表。
- `/tmp/cf-parity/align_diff.py A.json B.json`：按**条目标签名**（非头部键的排序连接）对齐，不按数组下标——探针完成顺序在两个引擎间会漂移（§10.21），按下标比会得到「几乎每个索引都不同」的假象。
- 关键前提：**必须同 epoch**。payload 条目键名随 build 轮换；跨小时的两轮键名全不同，逐字段比无意义。

#### 354.5 payload#2 确定性分岔表（headed == cleanua == cleanua-r3 == headless(UA) 四方一致，我方全部偏离）

顶层：

| 字段 | 四方（Chrome） | 我方 | 备注 |
|---|---|---|---|
| `TzZRB1` | 2 | 18 | |
| `uGyjw9` | 2 | 310 | §10.20 同族（worker 进度消息洪泛） |
| `WHTpH6` | 3 | 18 | |
| `aQgx8` | **不存在** | 1 | 我方多一个顶层键 |

条目内：

| 字段 | Chrome | 我方 | 疑似语义 |
|---|---|---|---|
| `PlZqY9` | `["zh-CN","zh"]` | `["zh-CN"]` | navigator.languages（harness 传参） |
| `zIyO8.TpsmW1` | 12 | 15 | worker navigator.hardwareConcurrency（harness 传参） |
| `zIyO8.jKeeJ4` | `…Chrome/153.0.0.0…` | `…Chrome/151.0.0.0…` | worker navigator.userAgent（harness 传参） |
| `dsKPy6` | 1 | 0.99 | |
| `RPKTR7` | 10737418240 | 10737418728 | 10 GiB 整 vs +488 |
| `uUOw3` | 0.5/0.625/0.565/0.51（各轮不同） | 0.5999… | **噪声**（Chrome 各轮自变） |
| `kPEvW6` | false | true | 字体条目内布尔 |
| `zYUn5` | 100 | 50 | |
| `knVv1` | 7 | 5 | |
| `HDEX5` | 12 | 9 | |
| `wikEk8` | `[3,1,2,0]` | `[0,2,1,3]` | 置换 |
| `zfym0` | `[2,0,0]` | `[1,0,0]` | |
| `IGBuA2` | `[159,163]` | `[0,76,125,126,127,128,159,163,171,173,174]` | 扫描基准 |
| `oHIQ6` | `[]` | `[27,43,59,…,517,518,…]`（1162+ 字符） | 扫描基准 |
| `lgWCE7` | `"280|1168"` | `"280|1088"` | widget 帧几何（差 80px） |
| `Ozfs8` | `"UGOeP6"` | `"WoUrS0"` | **四方同值** ⇒ 非随机，我们算错 |
| `HPcn5` | `bZnfT3/McSd5=28.9375` | `27.9375` | 文本度量（差 1px） |
| `XqEQ3` | `[…,[7,0,0,7,7,7,7,7],null]` | `[…,[3,0,0,3,3,3,3,3],[3,3,…]]` | 媒体能力矩阵 |
| `Jpzg5` | `ANGLE Metal Renderer: Apple **M2 Max**` | `Apple **M2**` | WEBGL_debug_renderer_info |
| `OYbs6[10]` | `"low-power"` | `"default"` | getContextAttributes().powerPreference |
| `xkNI3`/`uHNG9`/`KnOhl5` | 长 +1311 / +1831 / +7785 | +1141 / +1354 / +7137 | 编解码/ICE/SDP |
| `kRQwh3` | `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`（= **sha256("0")**） | 其它 | 哈希探针 |
| `JRzmw6`/`RKUE0`/`oSIr8`/`CZUP6`/`MnIr8`/`NNZHC4`/`ZkTjK2`/`OyfhW8`/`ZwhIC5`/`auHG6`/`gAtz0`/`tUxL6` | — | 各不相同 | 各哈希探针 |
| `XYvy9` | `…,192,192,192,…244,244,244,…53,53,53,…` | `…,191,191,191,…239,239,239,…48,48,48,…` | canvas 像素（已知光栅化低位差） |
| `jyDXx2`（TS#3 条目 40） | `"0.004999876022338867"` | `"0.09999999999990905"` | 计时（我方是**硬编码字面量**，见 payload 构造文档 §3.5） |

**计数器类**（`NnqX6` 9485 vs 4548/4175/5009/4414、`ZMSOw0`/`twvE0` 426 vs 124-133、`eaaP6`/`tZwbF3`/`wOvYJ5` 我方均约 1.3-1.5x）四方一致地低于我方 ⇒ 也是确定性差，不是时长缩放（§10.22 已记「不随时长收敛」）。

#### 354.6 实锤引擎缺陷（可复现、已派修）

**(A) 非顶层 realm 的浏览器窗口几何恒 0。** 复现命令与输出见 §354.7 的 eval；实测：
- `document.createElement('iframe').contentWindow` → **null**（Chrome 返回 about:blank Window）
- 已插入 iframe / srcdoc iframe / `frames[0]` 的 `outerWidth`/`screenX` → **0**，而 `screen.width`(=3440)/`devicePixelRatio`(=1) 正常
- 顶层 frame 正常（`outerWidth=1440, screenX=22`，与 fingerprint 一致）

真实浏览器窗口 outer 尺寸恒非零，`outerWidth:0` 是经典 headless tell，且该值确实进了 CF 普查（`gsLi5` 的 bucket `'0'` 里裸名 `outerWidth/screenX/screenLeft…`）。

**(B) `window` 缺 `SharedArrayBuffer`。** `Object.getOwnPropertyNames(window)` 1238 项、`window===globalThis`、`FontFaceSet`/`HTMLUserMediaElement`/`InteractionContentfulPaint`/`PerformanceSoftNavigation` 都在，**唯独 `SharedArrayBuffer` 既非 own 也不 `in`**。Chrome 普查里有。线索：`crossOriginIsolated` 在我方 payload 里同时落 `F` 桶（裸名）与 `T` 桶（`o.` 前缀），即 per-realm COI 状态不对称——SAB 很可能是其下游（§10.20 ③ 的复现）。

**(C) `colorDepth` 与 DPR 不一致。** DPR=1 时 Chrome 报 **24**，我们恒报 30（Retina 面板档）。同批已并入 (A) 的修复单。

**(D) `getContextAttributes().powerPreference` 忽略请求值**（`webgl.js:412` 读自身默认而非调用者请求）。Chrome 回 `"low-power"`（挑战请求的值），我们回 `"default"`。

#### 354.7 复现命令

```bash
# (A) 子帧几何 + (B) window 面
FP='{"language":"zh-CN","languages":["zh-CN","zh"],"browserVersion":"153.0.0.0","hardwareConcurrency":12,"deviceMemory":32,"screen":{"width":3440,"height":1440,"availWidth":3440,"availHeight":1312,"availTop":30,"availLeft":0,"deviceScaleFactor":1,"outerWidth":1440,"outerHeight":900,"screenX":22,"screenY":52}}'
./target/release/obscura fetch https://example.com --stealth \
  --user-agent 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36' \
  --fingerprint "$FP" --eval '<见 skills/obscura-challenge-probe 的 census 探针>'

# 实弹对拍轮（注入链路在线时）
bash /tmp/cf-parity/ours/run2.sh <run> <click-after>   # 点击须晚于 TS#2，10s 太早→停在 TS#2
```

#### 354.8 harness 身份陈旧（本轮 0/1 的直接成因之一）

`/tmp/cf0919/capture_round75.sh` 用的身份来自**旧文档的参考机**，与当前比对机不符：

| 项 | 旧 harness | 当前机 Chrome 实测 |
|---|---|---|
| UA | Chrome/151.0.0.0 | **Chrome/153.0.0.0** |
| hardwareConcurrency | 15 | **12** |
| languages | `["zh-CN"]` | **`["zh-CN","zh"]`** |
| screen | 1512×982 DPR2 | **3440×1440 avail 1312 top 30 DPR1** |
| outer | 1200×816 @44,77 | **1440×900 @22,52** |
| colorDepth | 30 | **24** |

（`availTop` 30 两边一致。）已生成 `/tmp/cf-parity/ours/run2.sh` 使用对齐后的身份。
注意：`--fingerprint` 的 `screen.outerWidth/outerHeight/screenX/screenY` 在**顶层**已确认生效（实测 1440/900/22/52），所以 (A) 的 0 是子帧取值路径问题，不是 fingerprint 解析问题。

#### 354.9 判决与下一批入口

本轮实弹轮 r01（旧身份）走完 main#1→TS#1→pat401→TS#2→TS#3→main#2 后重开一环；r02（新身份，点击 10s）**停在 TS#2**（点击早于 TS#2，符合 §10.6 的已知窗口，非引擎分岔）。**本轮 0/1 不构成对引擎状态的判决**——修复批次在飞，收口后需按 §354.7 重跑。

下一批入口（按证据强度）：
1. **(A)(B)(C)(D) 修复落地后重跑**，用 `threeway.py` 复算分岔表，看还有多少残留。
2. **哈希探针群**（`kRQwh3 = sha256("0")` 等）：Chrome 的值简单（sha256("0")），说明我们在这些探针上喂了**不同的输入**。逐个找出输入源后极易对齐。
3. **扫描基准 `IGBuA2`/`oHIQ6`**：Chrome `oHIQ6=[]`、`IGBuA2=[159,163]`，我方是大数组 ⇒ 我们的扫描**扫到了不该扫到的项**（很可能是 (B) 的同源：对象面/原型链差异）。
4. **GPU/媒体面**：`Jpzg5` 走 `--fingerprint.gpu.renderer` 传参即可；`XqEQ3`/`xkNI3`（媒体能力矩阵）需要按 Chrome oracle 重算。
5. **计数器族** `TzZRB1`/`uGyjw9`/`WHTpH6`/`NnqX6`/`ZMSOw0`：真实事件量差，需当轮 build 的 jsvmp 反编译定位（远程管线）。
6. `Ozfs8`（四方同值 `UGOeP6`）：非随机值的算错，优先级高——它四方一致说明输入确定。
7. 几何/渲染残差（`XYvy9` 像素、`HPcn5` 文本度量、`lgWCE7` 80px）：与 §10.19 同族，软信号。

#### 354.10 纠错与新增实锤（同日复核）

**纠错三条**（都用 Chrome 153 oracle 逐格对照过，避免把错误结论写进修复单）：

1. **游离 iframe 的 `contentWindow`/`contentDocument` 返回 `null` 是 Chrome 的正确行为**，我方与之**一致**——§354.6(A) 里把它列为缺陷是错的。已撤销该项修复要求，并改为在测试里钉住"与 oracle 一致"。
2. **`getContextAttributes().powerPreference` 我们是对的。** 12 种组合（webgl / webgl2 / experimental-webgl × 不传 / `default` / `low-power` / `high-performance`）与 Chrome **逐格相同**。§354.6(D) 系误读 `OYbs6[10]` 所致，已撤销。
3. **`srcdoc` 内容是异步解析的**（同 tick 读回 Chrome 也是空串），不是缺陷。测试必须等一个 task。

**新增实锤三条**（已派修）：

**（E）`srcdoc` 解析丢掉带属性的元素。** 矩阵探针（srcdoc 写入 → 等 120ms → 读 `contentDocument.body.innerHTML`）：

| srcdoc 内容 | Chrome | Obscura |
|---|---|---|
| `<p>EnIF0</p><p>ikyR0</p>` | ✅ | ✅ |
| `<div data-foo="x"></div>` | ✅ | **`''`（元素消失）** |
| `<div data-foo="&quot;"></div>` | ✅ | **`''`** |
| `<img alt="&quot;">` | ✅ | **`''`** |
| `<a href="?a=&quot;b">z</a>` | ✅ | **`''`** |

即**只要元素带任意属性，srcdoc 解析后就整个消失**；无属性元素正常。innerHTML 路径不受影响。影响面大：挑战用 `srcdoc.set(TrustedHTML)` 实例化 `about:srcdoc`（§5.3）。这解释了 `OjmeV1[85]/[86]/[103]/[104]` 四个分岔。

**（F）属性值序列化不转义 `<`、`>`、NBSP。** `innerHTML` 读回时 Chrome 输出 `&lt;` / `&gt;` / `&nbsp;`，我们输出裸 `<` / `>` / U+00A0（`&` 与 `"` 我们已正确）。这解释了 `OjmeV1` 的其余部分。

**（G）`navigator.storage.estimate().quota` 不等于 10 GiB。** 真实 Chrome 153 在本机任意源上返回 **`10737418240`**（恰好 10 GiB，`usage: 0`）；我方两次运行得到 `10737418472` / `10737418728`——**既非 10 GiB 整，还随运行浮动**。这正是分岔项 `RPKTR7`（Chrome `10737418240` vs 我 `10737418728`）。

同批复核为**一致**（写进测试当正向证据）：`performance.memory.jsHeapSizeLimit`=4395630592、`storage.persisted()`=false、`StorageManager` 原型 own 键 `["estimate","getDirectory","persist","persisted"]`、`storageBuckets`/`getDirectory` 在真实 https 源上 present、WebGPU limits 全套与 `info={apple,metal-3}`、WebGL `unmaskedRenderer` 前缀（差异仅在机型串，见 §354.8 的 `gpu.renderer` 传参）。

#### 354.11 配置修正的干净验证（r03）

用对齐后的身份（§354.8）重跑一轮，与两个通过臂做同一套三方对拍：

- **消失的两项**：`PlZqY9`（`navigator.languages` 缺 `"zh"`）与 `zIyO8`（worker navigator 的 hc/UA）——证明确实是 harness 传参问题，已闭环。
- **其余 37 项全部保留**（`HDEX5`/`XqEQ3`/`Ozfs8`/`knVv1`/`lgWCE7`/`dsKPy6`/`zYUn5`/`RPKTR7`/`kPEvW6`/`Jpzg5`/`OYbs6`/`OjmeV1`/`IGBuA2`/`oHIQ6`/哈希群/计数器群…）——证明它们与身份无关，是纯引擎/环境缺陷。
- 注意 r03 因**机器负载 7.5（三个修复 agent 并发编译）**停在 TS#2：§10.9 的时序失真警告仍然适用，**验证轮必须与构建错开**。该轮只用于读 payload#2，不作为判决轮。

**载荷键名未随 build 轮换**（r03 与参考臂的条目键名完全相同），但 **base64 表轮换了**（`qFcPNV8X2…`）。固定 key 补丁仍在，只是变量名轮换（`vy`→`Ek`）——**判定补丁存在不能靠变量名或注释标记 grep，要按 `Ek[40 + i] = W[i % 9]` + W 数组值识别**。

#### 354.12 payload#1 与结构差异（Chrome 臂全解出）

headed 臂的 `fo_02`（TS#1，4695B）与 `fo_04`（TS#3，93698B）**用旧表**解出（旧表 `tAwLxfRr…IeNDmj`，02:01 后 build 轮换为新表 `qFcPNV8X2…`）。TS#1 解出 4928 字符，与 console 的 `payloadjson_01.txt` 逐字节等长。

**结构差异（重要）**：`aQgx8` 在**双方的 payload#1 都存在且为 `0`**；但 **Chrome 的 payload#2/#3 里该键不存在**（92/94 键），我们仍带着它（93/95 键，值翻成 `1`）。即：payload#2 阶段该键应被移除。参考构造文档 §5.2 的「删除必须 shift_remove（保序）」——若 CF 按位置消费，多出的键会顶掉后续位次。

**payload#1 的确定性差异**（headed `payloadjson_01` 4928 vs 我们同轮）：

| 字段 | Chrome | 我方 | 备注 |
|---|---|---|---|
| `TzZRB1` | 2 | 18 | §354.5 同族 |
| `uGyjw9` | 2 | 310 | worker 进度消息量（§10.21/§10.22 追过，未收敛） |
| `ZMSOw0` / `twvE0` | 133 | 426 | 同族 |
| `WHTpH6` | 3 | 18 | |
| `NnqX6` | 235 | 529 | |
| `Blsob5` | 2 | 3 | |
| `tZwbF3` | 1055 | 1599 | 耗时类（我们慢） |
| `wOvYJ5` | 858 | 1333 | 同上 |
| `eaaP6` | 853 | 1019 | 同上 |
| `PWGF4[0].t` | **197** | 266 | **Chrome 自己也抛约 200 条**——错误洪泛是常态，非我方独有（修正 §10.20「Chrome=1」的口径：那是另一处统计） |

其余 37 个非数字键（含 `WqxKW9`/`jvYQh4`/`HEywW9`/`OqAoN4`=managed/`KXkx2`=new/`vXDzj6`/`VnGsz1` 等）与 `rPXg2` 资源清单在 TS#1 阶段**逐值一致**。

#### 354.13 (A) 项根因落定与修复（引擎侧，已验证）

**(A) 子帧窗口几何恒 0** 的根因**不是** page-init 的取值为 0，而是**指纹播种与帧初始化的时序**：

- `crates/obscura-js/src/realm.rs:1103` —— `ensure_frame_world_realm` 用 `execute_in_context` 播种指纹，而该函数**先 hydrate 再跑脚本体**（`execute_in_context_at` 首行 `hydrate_frame_realm_if_pending`）。于是 deferred-surface 的 `<obscura:init>`（page-init）在指纹播种**之前**执行，`_fingerprint()` 只能拿到硬编码兜底（1920×1080 / avail 1920×1080 / outer 0）→ 六项 = 1920/1080/0/0/0/0。
- 同步路径（`spawn_frame_realm`，`run_script` 不 hydrate）在 facade 首次读取时才 hydrate，指纹已就位，所以 `appendChild` 后立即读是**对的**——这正是"顶层对、子帧错"的分岔来源。
- **后果面**：所有经异步 loader 建 realm 的帧——**真正的 `src` 导航帧、srcdoc 提交帧、CF widget 帧**——几何全是兜底值。CF 的普查读到的就是这些。

修复：`page-init.js` 删除"非顶层写 0"分支（统一取 fingerprint 窗口指标）；`realm.rs` 新增 `run_in_realm_before_hydration`，把指纹播种移到 `<obscura:frame-realm-init>` **之前**，保证 page-init 看到的是运行时身份；`screen.js` 的 `colorDepth/pixelDepth` 改为 `mac && DPR>=2 ? 30 : 24`（缓存键 `platform|dpr`）。

验证（Chrome oracle 逐字段）：子帧六项修复后 = 顶层值（1440/900/22/52）；`display:none` 帧 `{ow:1440,sx:22,iw:0,cd:24}` 与 Chrome 逐字段一致；网络加载的 300×65 widget 形状帧同样命中。回归测试 4 条 + 全工作区门 1928/1928。

**遗留（未修，另开）**：① `iframe.remove()` 之后 Chrome 回到 `contentWindow=null`，我们仍返回 WindowProxy（需动帧文档生命周期）；② 未设尺寸的 iframe（默认 300×150 盒）Chrome 报 `innerWidth=300`，我们在无布局路径报 764（显式 `width:300px` 正确）——属渲染/布局回退路径。两条都与本批分岔无直接关系。

**关于 colorDepth 的物理含义**：Chrome 位深跟**物理面板**，不跟随 `--force-device-scale-factor`（实测 DSF=2 仍 24）。故 `DPR>=2 → 30` 只是"Retina Mac"的代理规则，已加 macOS 门限，避免 Windows 200% 缩放身份被误报 30。

#### 354.14 又一项实锤：`navigator.connection.rtt`

分岔表里的 `zYUn5`（Chrome `100` / 我方 `50`）属条目 `CYsxg7+CoJas5+DaNP8+LfzX7+axjt2+zYUn5`，该条目同含 `DaNP8="4g"`（`effectiveType`）⇒ 这是一条 **NetworkInformation** 探针。双引擎实测：

```
Chrome : {"downlink":1.8,  "effectiveType":"4g", "onchange":null, "rtt":100, "saveData":false}
Obscura: {"downlink":1.55, "effectiveType":"4g", "onchange":null, "rtt":50,  "saveData":false}
原型 own 键两边一致：["downlink","effectiveType","onchange","rtt","saveData"]；实例 own 键均为空
```

⇒ **`zYUn5` = `navigator.connection.rtt`，应为 100，我们给 50。** `downlink` 偏低（Chrome 1.8 vs 我们 1.55），且我方言次间会变（该轮 payload 里是 5.575，探针里是 1.55）——Chrome 侧是**测量值**，对拍口径应为同量级而非等值。已派回环境 API 批次。

哈希探针群（`JRzmw6`/`RKUE0`/`oSIr8`）的输入**扩展爆破未果**（`kRQwh3 = sha256("0")` 已确认，其余三条跨四个 Chrome 会话恒定但输入非平凡字符串），仍归字节码反编译管线。

#### 354.15 环境 API 批次落地（B/C/G/I 项）

**（B）`crossOriginIsolated` / `SharedArrayBuffer` —— 真因是子帧隔离判定错。**

Chrome 153 oracle（自建 COOP/COEP 双端口 fixture，CDP 逐 realm）定出的规则：

| 场景 | coi | typeof SAB |
|---|---|---|
| about:blank（新标签，opaque） | false | undefined |
| http 普通 / 仅 COOP / 仅 COEP require-corp / COEP credentialless | false | undefined |
| **COOP same-origin + COEP require-corp** | **true** | **function** |
| COOP unsafe-none + COEP require-corp | false | undefined |

**父已隔离时**的子帧：同源 + 自身 COEP（require-corp 或 credentialless）⇒ **true/function**；**子文档自己的 COOP 与 `crossOriginIsolated` 无关**（COOP 只决定顶层 browsing context group）；跨源还需 `allow="cross-origin-isolated"`。

根因：`page.rs:13679 frame_response_grants_cross_origin_isolation` 复用了专为顶层写的判定，要求子响应**同时**带 COOP 与 COEP。拆出 `response_requires_cross_origin_embedding`（只看 COEP）与 `response_denies_cross_origin_isolation`（`Permissions-Policy: cross-origin-isolated=()`），判定改为「父已隔离 && 同源 && COEP(非 unsafe-none) && 未被 PP 拒绝」。**没有**无条件挂 SAB——SAB 仍按每个文档的隔离位安装，只是这个位现在按 Chrome 规则算。测试 2 条（单元逐格 + 端到端起真 server 导航）。

**（C）`o.` 前缀之谜解开 + 一条真分岔。**

`gsLi5` 桶表的键是**值**，值是「产生该值的属性**路径**」列表；前缀是**宿主对象**：`n.`=navigator、`d.`=document、`s.`=screen、`so.`=screen.orientation、裸名=**普查 realm 自己的 window**、`o.`=**第二个窗口（Turnstile widget realm）**。判据：`o.innerWidth`=300/`o.innerHeight`=65（widget 尺寸）而裸 `innerWidth`=0；`o.runProgram`/`o._cf_chl_opt` 是 CF 注入 widget realm 的混淆全局。**普查跑在 widget 内部一个隐藏的 same-origin about:blank 子帧里**（`d.URL=about:blank`、`d.domain=challenges.cloudflare.com`、`d.referrer`=widget URL）。

真分岔：四个 Chrome 参考轮**全部**只有一条**裸** `crossOriginIsolated`（桶 T）与一条**裸** `SharedArrayBuffer`（桶 N），`o.crossOriginIsolated`/`o.SharedArrayBuffer` 出现 0 次；我们 r01 恰好相反（裸的 `crossOriginIsolated` 落 F 桶、裸 `SharedArrayBuffer` 缺失、两者都出现在 `o.` 下），且我们 `o.` 条目 36 vs Chrome 30，多出的 6 个正是 `bootstrap.js` 的 `_nonIsolatedFrameHiddenNames` 那 4 个实验接口 + SAB + COI。⇒ **引擎自相矛盾：`o` 那侧既被当成"非隔离跨源帧"的缩减反射面，又报 `crossOriginIsolated===true`。**

**未定案**：真实 Turnstile iframe 是否带 `allow="cross-origin-isolated"`、我们是否读到它。需要一次带网轮次的探针（widget realm 内读该 iframe 的 `allow` 属性 + 我们侧 `frame_container_info`/`document_scope_info` 的 `crossOriginIsolated`）。

**（G）`storage.estimate().quota`。** 根因 `ops.rs:7027`：返回 `10 GiB + (200 + 宿主剩余空间 % 800)`。那套"Chrome 报 10 GiB + 小 delta"的注释**被 oracle 推翻**——Chrome 三个源 × 复用/全新 profile × 多次调用，**恒为 10737418240**。已改为固定 10 GiB，并删除因此成为死代码的 `host_free_bytes()`。

**（I）`navigator.connection.rtt`。** Chrome oracle（`Network.emulateNetworkConditions` 各档）证明 `rtt` 是**测量值**（跟随实际/模拟时延并量化到 50ms：offline→0、150ms→150、50ms→50、333ms→350），**无观测时答 100**。我们硬编码 50 → 改为 100。`downlink` 同样是测量值（Chrome 1.65–1.8 之间浮动），**对拍口径为同量级而非等值**。

**同批复核为一致（已写进测试当正向证据）**：`storage.persisted()`=false、`getDirectory`/`storageBuckets` present、`estimate()` 键 `["quota","usage","usageDetails"]`、`performance.memory.jsHeapSizeLimit`=4395630592、`effectiveType="4g"`、`saveData=false`、`onchange=null`。

**两处已知系统差（未修，记录在案）**：① `constructor` 在原型 own 键中的**位次**（Chrome 把 `constructor` 排在中间/末尾，我们排首位）——全 WebIDL 接口系统性差异，非 storage 特有；② 隔离父下的同源子帧若自身无 COEP，Chrome 会拦成 `chrome-error://chromewebdata/`，我们照常加载只是不隔离。

#### 354.16 批次 51 收口：3 个修复批次落地、判决仍 0/1

**落地（4 个提交）**：`6b2acdc`（DOM 属性/文本转义）、`a98a5ef`（每 realm 的窗口几何 + colorDepth 面板规则）、`64f6e5a`（子帧隔离继承 COEP、quota 恒 10 GiB、rtt 默认 100、awaited evaluate 提交其创建的帧）。Scoped 门禁 `obscura-dom + obscura-browser + obscura-js + obscura-cdp` = **1100/1100 通过 / 3 跳过**；全量门与障碍课程按纪律记入 `docs/test-gate-ledger.md` 待回填。

**配置层收口**：身份对齐（§354.8）+ GPU 机型串经 `--fingerprint.gpu.renderer` 传入。

**判决轮 v1/v2（修复后二进制 02:32）**：分岔项 **38 → 35**。已消：`RPKTR7`（quota）、`zYUn5`（rtt）、`Jpzg5`（GPU 串）。**判决仍为 retry 环，未拿到 `POST /1.txt → 404`。**

**B1 纠错（重要）**：§354.10(E) 的「srcdoc 带属性就丢元素」判断**被推翻**。真因是 **CDP `Runtime.evaluate` 的 await 期间，其表达式新建 iframe 的导航提交被推迟到 evaluate 返回之后**——探针本身触发了这条路径，`<div></div>`（无属性）同样复现，`Page.getFrameTree` 显示帧确实提交、只是读得早，页面自身脚本建 srcdoc 帧则一直正常。已修（真缺陷：影响任何 CDP 驱动流程）。**但 `OjmeV1[85]/[86]/[103]/[104]` 的页面侧根因因此仍未定**，需在页面脚本路径（非 CDP await）下重新验证。

**剩余 35 项分岔（v2）**：
`HDEX5 XqEQ3 xkNI3 Ozfs8 knVv1 lgWCE7 dsKPy6 CzUP6 MnIr8 DqomM2 kPEvW6 OYbs6 OyfhW8 XYvy9 ZwhIC5 auHG6 etmnR7 gAtz0 lDUiR4 tUxL6 zfym0 HPcn5 IGBuA2 oHIQ6 JRzmw6 RKUE0 kRQwh3 oSIr8 wikEk8 NNZHC4 OjmeV1 SbVZ3 hCfV6 ZkTjK2 jyDXx2`

**下一批入口（按可操作性重排）**：
1. **`OYbs6[10]`**（Chrome `"low-power"` / 我们 `"default"`）：已证 `getContextAttributes().powerPreference` 12/12 组合与 Chrome 一致 ⇒ 该位置**不是** context attributes，需重新识别 `OYbs6` 的结构（序列含 `16, 4352, false, 1, null, 1, 1, 1, 0, 0, …`，疑为 WebGL 参数 + 扩展枚举的混合转储）。
2. **哈希探针群**：Chrome 侧跨四会话恒定 ⇒ 输入是常量。`kRQwh3 = sha256("0")` 已确认，其余三条扩展爆破未果。判定「极易对齐」（语义文档语）但需要输入源，走字节码管线。
3. **`IGBuA2`/`oHIQ6`**：Chrome `oHIQ6=[]` / 我们千字符等差数组 ⇒ 我们的扫描**多检出**。疑与 §354.15(C) 的 per-realm 反射面差异同源（多了 6 个条目）。
4. **`OjmeV1`**：页面脚本路径重验（见上），另 `[79]`/`[118]` 是批次 49 的既有未决项。
5. **`HPcn5` 文本度量差 1px**、**`lgWCE7` widget 帧高差 80px**、**`XqEQ3`/`xkNI3` 媒体矩阵**：需要按 Chrome oracle 重算，各自独立。
6. **`wikEk8`/`wopX8`/`hCKCP8`/`jBVrk8`（bench 臂）**：次序与耗时都随相对性能漂移，属性能对齐问题。
7. **计数器族**（`TzZRB1`/`uGyjw9`/`WHTpH6`/`NnqX6`/`ZMSOw0`）：真实事件量差，需当轮 build 的 jsvmp 反编译定位。

#### 354.17 新假设：`IGBuA2`/`oHIQ6` 是画布/字形的"一致性扫描"

条目 `IGBuA2+bLvQ6+oHIQ6`（hCfV6 约 1.4-1.5s，是慢探针）：

```
Chrome : IGBuA2=[159, 163]                                   oHIQ6=[]                       bLvQ6=[]
Obscura: IGBuA2=[0,76,125,126,127,128,159,163,171,173,174]    oHIQ6=[27,43,59,…,2731,2757,2758,2763,2767]（233 项）  bLvQ6=[]
```

结构观察：`oHIQ6` 的相邻差**绝大多数是 16**，其间夹着规律的三元组 `10,1,5` 与偶发 `17/15/1`；最大 2767。`IGBuA2` 的取值是 `oHIQ6` 同族的小整数（我们在 159/163 之外多报 9 个）。

**假设**：这是一条**画布字形一致性扫描**——把字形/文本画到画布上再按列（或按固定步长 16）扫描像素，**上报"实际墨迹与 `measureText()` 报告的 advance 不一致"的位置**。支持证据：① Chrome 上报**空**，我们上报 233 个位置 ⇒ 形态是"差异清单"而非"检出清单"；② 步长 16 像扫描粒度；③ 如果是差异清单，那么"两台真实 Mac 都会通过"（度量与光栅来自同一套字体/引擎），因此**它可能是硬 tell，而不属于 §10.13 判为软信号的"机间像素差"**——这一点与本条目的判读优先级直接相关，值得优先确认。

**待验证**：① 该条目的输入究竟是哪些 API（`CanvasRenderingContext2D.fillText` + `getImageData` + `measureText` 的组合最有可能）；② 我们的 `measureText().width` 与实际光栅墨迹是否**自洽**（若不自洽，差异清单自然非空）。验证方式：双引擎画同一组字形，逐列取 `getImageData` 求墨迹范围，与同引擎的 `measureText().width` 比对——**自洽性检查与机器无关，可跨机对拍**。

已派给度量/布局批次的下一轮（当前批次三个 agent 在跑：媒体/WebGL 面、`OjmeV1`+度量+布局、VM 计数器洪泛）。

#### 354.18 参考臂复核：`OjmeV1` 稳定性与 `[75]` 剔除

用 5 个 Chrome 参考会话（headed×2 / clean-UA headless×2 / 带 HeadlessChrome UA 的 headless×1）逐下标复核 `OjmeV1`（120 元素）：

| 下标 | headed-0143 | cleanua-0144 | cleanua3-0148 | hlUA-0144 | headed-0241 | OURS-v2 |
|---|---|---|---|---|---|---|
| 75 | 12 | 12 | **13** | **13** | **13** | 13 |
| 79 | false ×5 | | | | | **true** |
| 82 | false ×5 | | | | | **true** |
| 85 / 103 | `<p>EnIF0</p><p>ikyR0</p>` ×5 | | | | | **`''`** |
| 86 / 104 | `<div data-foo="&quot;"></div>` ×5 | | | | | **`''`** |
| 118 | `EBlFw4611` ×5 | | | | | **`EBlFw4[object Object]`** |

⇒ **真分岔只有 79/82/85/86/103/104/118 七个**；**`[75]` 是噪声**（Chrome 自身在 12/13 漂移，我们的 13 落在范围内），已从修复单剔除。§354.17 里把 `[75]` 列为分岔是错的。

**方法论警示（新）**：跨 build 的参考臂之间，**条目签名（非头部键的排序连接）会漂移**，按签名对齐的对拍器会**静默丢掉条目**——症状是 `hCfV6` 这类头部键被当成普通字段反复报出。故：① 对拍只用**同一 build** 的参考臂；② 条目键集稳定的臂改用**逐下标直接比对**（上表即此法）。

**epoch 复核**：02:41 重跑 headed Chrome，仍 **10 秒通过**（body = `Missing resource /1.txt`，`/fo/` 五段 2370/4706/89676/92887/9015），说明当前 epoch 未变、参考基线有效。

#### 354.19 下一阶段提案：用「字段置换」实验直接定出被判字段

**动机**：批次 51 把分岔集从 40+ 收敛到 35 项，但**没有任何一项被证明是 CF 的判据**。继续按"看起来可疑"排序去修是一条长尾；需要一次能直接定案实验。

**实验设计（差分置换）**：

注入链路的 ov2.js VM 在序列化上行 payload 前有一处现成的钩子：

```js
C4 = function (Y, …) { console.log("payloadJSON:", JSON.stringify(Y)); … }
```

即 payload 对象 `Y` 在加密前必经一次 `JSON.stringify`。因此可以**在 widget realm 里包一层 `JSON.stringify`**（命中带该形状的调用时，把 `Y` 上指定的字段改写成 Chrome 参考臂的值，再交给原函数），从而在**不改引擎**的前提下，逐字段/逐组地把我们的 payload 改成"Chrome 的值"。

判据：**若把某字段（或某组字段）换成 Chrome 值后判决翻转为 `POST /1.txt → 404`，该字段即判据**（或判据集的一部分）。可对 35 项做二分/分组置换，约 6-8 轮即可定位。

**风险与对冲**：
1. **注入本身可能成为新 tell**（`Function.prototype.toString` 身份、可枚举性）。对冲：跑一次**空注入对照**（包一层等价但什么都不改的 `JSON.stringify`），若空注入对照也失败，才把"置换后通过"当作有效信号；若空注入对照直接变好或变坏，说明注入本身干扰判决，实验作废。
2. **字段值的"形状"必须先对齐**：置换只改值不改结构（键名/键序/类型），否则会引入新的协议错。
3. **会话噪声字段**（已识别的：`uUOw3`、`xWWV8`、`Ozfs8` 的部分分量、`wikEk8`、时间戳三件套、`pafm1`/`uwPn4` 密文串）**不要置换**——把参考臂的会话值搬过来只会引入不一致。
4. 置换必须**按 build 对齐**：参考臂与当轮必须是同一 build（见 §354.18 的警示）。

**先做哪几组（按怀疑度）**：
- G1：哈希探针群（`CzUP6`/`MnIr8`/`JRzmw6`/`RKUE0`/`kRQwh3`/`oSIr8`/`NZHC4`/`ZkTjK2`/`OyfhW8`/`ZwhIC5`/`auHG6`/`gAtz0`/`tUxL6`）
- G2：扫描基准 `IGBuA2`/`oHIQ6`（§354.17 的"一致性扫描"假设若成立，这组最可能是硬 tell）
- G3：`OjmeV1` 的七个真分岔下标
- G4：计数器族 `TzZRB1`/`uGyjw9`/`WHTpH6`/`NnqX6`/`ZMSOw0`/`twvE0`
- G5：`OYbs6`/`XqEQ3`/`xkNI3`/`HPcn5`/`lgWCE7`（媒体与度量）

落盘位置建议：`js-repros/` 下新增 `cf-field-swap/`（探针 + 驱动脚本），产物写 `/tmp/cf-parity/swap/`。

#### 354.20 计数器族定性更正 + 跨 realm op 扇出（批次 52 线索）

**定性更正（推翻 §10.20/§10.21 的读法）**：`uGyjw9`/`TzZRB1`/`WHTpH6`/`ZMSOw0`/`twvE0`/`eaaP6`/`tZwbF3`/`wOvYJ5`/`Blsob5` 在**同一轮的 payload#1/#2/#3 中逐字节相同**（我方与 Chrome 都是）⇒ 它们是**引导期一次性定型的常量**，不是运行中的计数器。只有 `NnqX6` 随条目数增长（尺寸代理）。

⇒ **§10.20/§10.21 的「`uGyjw9` = worker 进度消息洪泛」与 §10.22 的「不随时长收敛 ⇒ 真实事件量差」都应改写为：引导阶段的内部工作量代理**。引导期根本没有 worker 流量，所以那两类归因都不适用。各字段倍率差异极大（1.2x ↔ 155x）⇒ **不是单一 API 造成**，而是按各引导阶段内部工作量的比例放大。

**H2（事件重复投递）证伪**（双引擎本机 fixture）：`setTimeout(0)`×200、`Promise.then`×500、`MessageChannel`×200、`Worker.postMessage`×300 —— 两引擎**均零重复、零乱序**。另排除：frame realm 启动慢（8 个 srcdoc 帧 42.7ms vs 48.6ms）、digest 更快（100ms 预算 Chrome 57,610 次 > 我方 45,203 次，**我们更慢**）、worker 往返延迟量级不符。

**H3（`aQgx8` 结构差）成立**：顶层键集精确差一项——`ours#2 = ref#2 ∪ {aQgx8}`、`ours#3 = ref#3 ∪ {aQgx8}`；键数 `ref = 47/53/54` vs `ours = 47/54/55`。Chrome 的 `aQgx8` 是**一次性引导标志**：#1 写 `0`，#2/#3 **整个不写**；我方 #2/#3 写 `1`。

**H1（API 异常触发重试）未有直接证据**，但找到**唯一量化到该量级的引擎侧差异：跨 realm 属性读的 op 扇出**。

`--trace-op-file` 复算（118,370 op）：`iframe_content_document_root` 60,485、`iframe_scopes_same_origin` 30,818、`document_scope_info` 2,698、`query_selector_scoped(…,'base[href]')` 1,033-1,454，全部来自 `challenges.cloudflare.com/.../rch/...` 两个 realm；集中在四个爆段，每 20ms 437 op、op 间距 17-22μs，**合计约 2.1s**。对照 Chrome 同挑战 trace：`contentWindow` 读 8 次、`contentDocument` 7 次、`baseURI` 1 次。

双引擎单次读成本（非顶层 realm）：

| API | Chrome | Obscura | 倍率 |
|---|---|---|---|
| `document.baseURI` | 0.033μs | **3.97μs** | **120x** |
| `element.baseURI` | 0.067μs | 4.13μs | 62x |
| `location.href` | 0.20μs | **7.70μs** | 38x |
| `parent.document.URL` | 0.23μs | 4.53μs | 19x |
| `iframe.contentWindow.document.URL` | 0.27μs | 5.90μs | 22x |

根因：`env/window/location.js:74 _internalBaseHref()` 每次读都跑 `query_selector_scoped(doc,'base[href]')` + `get_attribute`，而同文件 `:7` 的 `_environmentSettings()` 依赖 `document.baseURI` ⇒ 每次 `location.href`/fetch/URL 解析都付这笔钱；`env/dom/node-object.js:58 Node.prototype.baseURI` 再叠一次 `document_scope_info`；`env/frame/realms.js:612 _frameWindowProxyFor()` 的 `contentRoot()`/`sameOrigin()` 每访问一次 frame WindowProxy 属性各跑一次。

**未断言**：这条扇出**尚未证明**就是那些引导期常量的测量对象。已派修（缓存 + 失效键走一个只读 op，语义保真要求：动态增删/改 `<base href>` 后 `baseURI`/`location.href`/相对 URL 解析必须立即反映）。

**另一条独立确定性值差**：条目 `[BMnw0+Ozfs8+UYbIv2+bzNje2+knVv1+xWWV8]` 中 Chrome **四轮一致** `UYbIv2 == Ozfs8 == "UGOeP6"`、`knVv1=7`（`hCfV6` 143），我方 `Ozfs8="WoUrS0"`、`knVv1=5`（`hCfV6` 1170）。同条目 `UYbIv2` 我们**与 Chrome 相同**，所以是"同一值的两个槽位有一个算错"，可能比计数器更容易定位。

**批次 52 补充线索：`SbVZ3` 是结构性差（缺项，非值差）**

`SbVZ3` 是一条按 token 平铺的报告（Chrome 90 项 / 我方 78 项），Chrome 稳定多出：

| token | Chrome | 我方 |
|---|---|---|
| `lzDF4` | 2 | **0** |
| `TBNgK7` | 2 | **0** |
| `QLaZp6` | 4 | **0**（我方同位置是 `QqPF4`） |
| `PhWMD5` | 20 | **18** |
| `AecW7` | 20 | **18** |

其余全部逐项一致（含开头 `TKyxg5/PhWMD5/AecW7/Qssv3/cnrU5/ODxGu4/mfiL4/21`）。⇒ 我方在这条报告里**少了 2 组记录**，且有一组用了不同的键名。形态是"少记了 2 次某类事件"，不是"某值算错"——与 §354.20 的 `aQgx8` 同属**结构/路径差**类，优先级应高于纯值差（结构差更容易被判为"客户端行为不同"）。

#### 354.21 结构性缺失实锤：我们从不发 `/ci/` 请求

通过的 Chrome 153（本机、同代理、同 URL）HAR：

```
GET  /pat/<ray>/<ts>/<hash>/…                         → 401
GET  brunhild.challenges.cloudflare.com/…/i/<ray>/…    → status 0（无响应；参考与我们一致）
GET  /ci/<ray>/<ts>/<token>-<ts>-1.3.1.1-<长串>        → 200
```

Chrome payload#2 的 `rPXg2`（PerformanceResourceTiming 清单）**4 条**，第 4 条即 `/ci/`：

```json
{"PhWMD5":"…/h/g/ci/a3fb5a31fd548d31/1790185414…","EazF1":0,"dtkfB9":101,"gtlhH0":102,"nXUeQ6":4032,"FoGsT1":3732}
```

我方 payload#2 的 `rPXg2` **3 条**，无 `/ci/`。且**所有**实弹轮的 ops.tsv 里：

```
grep -aP "\tfetch\t" /tmp/cf-parity/ours/r01/run/ops.tsv | grep -ac '/ci/'   # 0
grep -aP "\tfetch\t" /tmp/cf-parity/ours/v2/run/ops.tsv  | grep -ac '/ci/'   # 0
```

而 `/pat/` 我方**有**（`worker(4)[script@…/rch/…] fetch GET …/pat/<ray>/…` → 401）。

对照 §5.1 的参考墙钟：`TS#1(49.418) → pat401(50.360) → **ci200(50.816)** → TS#2(52.474)`。**缺的正是夹在 TS#1 与 TS#2 之间的这一步**，而这两段之间的载荷恰恰是服务端下判决的地方（§354.3）。⇒ **这是目前最强的结构性线索**，优先级高于所有纯值差。

同族的另一条短缺：payload#2 的 `SbVZ3` 里 Chrome 多 4 个 token（`lzDF4`×2、`TBNgK7`×2、`QLaZp6`×4），且 `PhWMD5`/`AecW7` 各少 2 次。已合并派查。

（注：`/ci/` 在 §10.3 的 Run A 描述里出现过——"走完 main#1→TS#1→pat401→ci→TS#2"，需确认那是参考流程还是当时我方确实发过；若是后者，说明是本轮次引入的回归。）

#### 354.22 纠正 §354.21：`/ci/` **有**发出，缺的是它的 resource-timing 条目

§354.21 的"我们从不发 `/ci/`"是**误读**，本文件自身在 line 1825 早已记过原因：

> `/ci/` 的日志 0% 是**观测盲区**而非能力缺口：Image 走 wreq stealth_client、「Step 45 wreq 插桩证实 `/ci/` 实际发出且 200、解码出正确尺寸」

即 `/ci/` 走 **`Image().src`**（`sec-fetch-dest: image` + `no-cors`），而 `--trace-op-file` 只记录 JS `fetch`/XHR 这类宿主 op，**不记录 Image 加载**。line 1549 还留有一处 `/ci/` 的 resource-timing 特判痕迹（`if (url.indexOf("/ci/") !== -1) return { domainLookupEnd: 0, responseStart: 1, responseEnd: 3 }`），说明历史上我们确实对它的计时做过 shim。

**实测（本机 fixture，Obscura serve + CDP，`--allow-private-network`）**：我们的 resource timing **能**正确记录三种 initiator：

```
{"start":[],"afterFetch":["px.png|fetch"],
 "afterImg":["px.png|fetch","px.png|img"],
 "afterXhr":["px.png|fetch","px.png|img","px.png|xmlhttprequest"]}
```

⇒ 真问题**收窄为**：`/ci/` 的条目没有出现在我方 payload#2 的 `rPXg2` 里（Chrome 4 条含 `/ci/`，我方 3 条不含）。候选：① 条目在但被挑战的选取条件过滤（Chrome 那条 `EazF1=0`/`dtkfB9=101`/`gtlhH0=102` 数值极小，若我方给 0/未定义就很可能被丢）；② 挑战页的 CSP/跨源/no-cors 条件下 Image 条目确实没进。已按此重新定向追查。

**教训（记进测量盲区）**：`--trace-op-file` **不是**网络全量记录——Image/`srcset`/CSS 资源不走该通道。凡"某请求 0 次"的结论，必须先排除该盲区（本文件 line 1821-1827 已记一次同类错误，这是第二次）。

#### 354.23 `/ci/` 实测：确实发出，但响应体只有 Chrome 的 1/10，且不进 `rPXg2`

用实弹轮 + 跨 realm 取数（widget realm 里 dump `performance.getEntriesByType('resource')`，经 `--tracelog-file` 的 `window.external.tracelog` 引出）：

| initiatorType | duration | transferSize | encodedBodySize |
|---|---|---|---|
| `xmlhttprequest`（TS#1 `/fo/`） | 639 | 823180 | 822880 |
| **`img`（即 `/ci/`）** | **2191** | **632** | **332** |
| `xmlhttprequest`（TS#2 `/fo/`） | 218 | 127528 | 127228 |

Chrome 的 `/ci/` 真实响应（三份 HAR 全查，均为 `image/png`）：

| 轮 | status | size |
|---|---|---|
| headed-r4 | 200 | **2415** |
| headed-0143 | 200 | **3810** |
| cleanua | 200 | **3196** |

⇒ ① `/ci/` **确实发出**（有 `img` 类型的 resource-timing 条目）；② 但**响应体只有 332 字节，Chrome 是 2415-3810 字节，差约 10 倍**，且 `duration` 2191ms（Chrome 侧是毫秒级）；③ 它**没有出现在 payload#2 的 `rPXg2` 里**（Chrome 4 条含 `/ci/`，我方 3 条不含）。

**注意复现抖动**：两次实弹轮里只一次出现 `img` 条目——`/ci/` 不是每轮都触发，判定时不要用单次结果。

**测量盲区补记**：`--trace-op-file` 不记录 Image/`srcset`/CSS 资源加载，凡"某请求 0 次"的结论必须先排除该盲区（本文件 line 1821、§354.21 各栽过一次，这是第三次同类教训）。

#### 354.24 请求头级实锤：`Sec-Ch-Ua` 品牌表**顺序**与真实 Chrome 不符

双引擎逐字对照（本机，经 `https://httpbin.org/headers` 回显；Chrome 侧用 CDP `fetch()`）：

| | `Sec-Ch-Ua` |
|---|---|
| **真实 Chrome 153** | `"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"` |
| **Obscura** | `"Chromium";v="153", "Google Chrome";v="153", "Not_A Brand";v="8"` |

三项内容相同、**顺序不同**。GA 品牌 `Not_A Brand`（GREASE 名/版本）与 `Chromium`/`Google Chrome` 的版本号都对——**只有排列错**。

根因：`crates/obscura-net/src/fingerprint.rs:601 chromium_brands()` 用 `PERMUTATIONS[major % 6]` 重排 `[grease, chromium, chrome]`；`major=153` 得 `PERMUTATIONS[3] = [1,2,0]` → `[Chromium, Google Chrome, Not_A Brand]`，而真实需要 `[2,0,1]`。该 `major % 6` 映射是一处**未经验证的近似**。

**为什么这条优先级高**：`Sec-Ch-Ua` 是 **CF 在每个请求上都能直接读到**的头。若它与真实 Chrome 不符，CF 可以在**流程极早期**（首个请求）就把我们归类——这与 §354.23 观察到的「`/ci/` 响应只有 332B（Chrome 2415-3810B）」自洽：**判定可能发生在 `/ci/` 之前**，而 payload 里的 35 项分岔也许是结果而非原因。已派修（要求按公开源码或 oracle 实测确定真实排列规则，不接受猜测；并顺带核对同批请求头）。

同批复核一致：`Sec-Ch-Ua-Mobile: ?0`、`Sec-Ch-Ua-Platform: "macOS"`、`Accept-Language: zh-CN,zh;q=0.9`、`Accept-Encoding: gzip, deflate, br, zstd`、导航 `Priority: u=0, i` / fetch `u=1, i`。

**另一条待核**：`Accept` 在导航上下文我们发 `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7`（Chrome 导航同为该串），fetch 上下文两边都是 `*/*`——已列入顺带核对表，暂未发现差异。

#### 354.25 原始文本元素序列化修复（`OjmeV1` 空串的根因）+ 一次工作区事故

**修复**（`a7576a7`）：`is_raw_text_element` 由 `script|style|textarea|title` 改为

```
script | style | xmp | iframe | noembed | noframes | plaintext | noscript
```

即 **HTML 片段序列化的 "do not escape" 名单**，而不是分词器的 raw-text/RCDATA 集合：`textarea`/`title` 在**解析**时是 RCDATA，所以**序列化**时要转义；`listing`/`pre` 两侧都是普通元素。Chrome 153 oracle 对 `textarea`/`title` 答转义形态、对其余六个答字面形态。

**这解释了 §354.5 的 `OjmeV1[85]/[86]/[103]/[104]` 四个空串**：挑战的 **round-trip 探针**把标记写进容器、**只在回读等于输入时才保留**；我们那六个原始容器回读不等，于是变空。⇒ §354.10(E) 与 §354.16 对这几项"根因未定"的状态**结案**（不是 srcdoc 解析，也不是 CDP await 提交时序——那是另一个真缺陷）。带 22 用例的 `raw_text_containers_serialize_like_chrome_153` 测试钉住全表；`obscura-dom` 93/93 通过。

**工作区事故（过程教训，务必记住）**：某 agent 为了验证"没有修复时新测试会失败"，在**多 agent 共享工作区**里跑了 `git stash` → **六个 agent 的全部未提交工作被一起卷进 `stash@{0}`**，工作区被清空；随后它的 `git stash pop` **中止**（未合并任何东西，stash 保留），未造成额外损失。各 agent 察觉后自行写回，我从 stash 补回了当时仍未回写的 `serialize.rs`（即上面那条修复）。

- **无工作永久丢失**：stash 已做两份独立备份（`/tmp/agent-stash-backup.patch`、`/tmp/cf-parity/wsbackup/stash0-030210.patch`），14 个文件已逐个核对全部回到工作区。
- **纪律（对后续所有并行 agent 生效）**：共享工作区内**禁止**任何改动工作区/历史的 git 命令——`stash`/`pop`/`apply`/`drop`/`clear`、`reset`、`checkout -- <path>`、`restore`、`clean`、`commit`、`add -A`、`rebase`、`merge`、`switch`、`branch -D`；只读的 `status`/`diff`/`log`/`stash list`/`stash show` 可用。
- **"验证没有修复会失败"的正确做法**：写成可开关的形式、在仓库外副本上验证，或用隔离 worktree —— **绝不能用 `git stash`**。

#### 354.26 `OjmeV1` 结案 + `Sec-Ch-Ua` 根因 + 两处新泄漏

**`OjmeV1` 结案（`a7576a7`，§354.25 的进一步确证）**：前一个 agent 用 **232 例容器矩阵**（8 种输入 × 24 标签 + range/shadow/implDoc/domParser/xhtml × 2 realm）双引擎对照，修复前 **72 例不同**、修复后**只剩 8 例**（全在 `application/xhtml+xml` 路径，属另一条独立面）。差异全部落在**片段序列化的"原文元素"名单**：`textarea`/`title` 应转义（解析是 RCDATA），`noscript`/`xmp`/`plaintext`/`iframe`/`noembed`/`noframes` 应字面。**解析侧我们本来就是对的**（`textContent`/`childNodes` 与 Chrome 逐位相同），只有序列化错。

**直接代理实验**（`keep = (readback===input) ? input : ''`，13 容器 × 2 输入）：修复后两引擎 **26/26 相同**，修复前那六个容器我方全为 `''`——与 payload 签名逐位吻合，且**同时解释 `[79]`/`[82]`**（同一探针的"回读不等"布尔）。`[75]` 经 6 份参考 payload 独立复核确认是噪声。

**`[118]`（Chrome 数字 `611` / 我方 `[object Object]`）仍未定**：93 条表达式差分 + 303 个共有属性类型差分扫描，**没有**找到任何"Chrome 给数字、我方给普通对象"的 API。

**`HPcn5` 部分定位**：该臂是 10 元素 × 8 字段，**8 个 Chrome 会话逐字节相同**（整个数组都是确定性分歧）。差 +1.0 的两处（`elem0` 的 `bZnfT3/McSd5`、`elem1` 的 `bZnfT3/OJxVr7/giwB1`）指向一个**常量 +1px 的宽度量**；`elem2..9` 差得很大且有结构（Chrome `±3.4028232737618185e+32` vs 我方 `33554430 = 0x1FFFFFE`，float32 饱和形态）。**根因未定**。`lgWCE7` 80px 未定位（挑战 UI 在 closed shadow root 里，页面侧枚举看不到）。

**`Sec-Ch-Ua` 根因（`c01351c`）**：Chromium 的 `ShuffleBrandList` 是 **scatter**（`shuffled[order[i]] = list[i]`），输入序为 `{grease, "Chromium", brand}`；Rust 侧把同一张表读成了 **gather**。仅 residue 3/4 (mod 6) 会分歧，故既有 146/149 断言不受影响。三路交叉验证：Chromium 源码 + 其自带单测 golden（4 元素路径两行）+ 本机 Chrome 153 oracle 逐字。顺带发现并修了**无品牌 size-2 分支**（Chromium 是 `{seed%2, (seed+1)%2}`，偶数大版本 grease 在前；旧实现写死 `[Chromium, grease]`，CfT 154 实测证实）。

**同批请求头核对**：16/16 字段在导航与 `fetch` 两种上下文逐字一致。**唯一不一致**：`Cache-Control: max-age=0` 我们**每次导航都发**，Chrome 只在 reload 时发（`wreq_client.rs:505` / `client.rs:1915`，其注释里的理由与 oracle 相反）。已派修——这行会出现在 CF 看到的**第一个请求**上。

**两处新泄漏（已派修）**：① `getClientRects()[0]` / `.item(0)` 返回**带自有可枚举属性的普通对象**而非 branded `DOMRect`；② `window.visualViewport` 是 `Object.prototype` 的普通对象、自有可枚举键，Chrome 是 branded `VisualViewport`（原型访问器、自有键为空）。

**另记三处帧生命周期真分岔（未修，已排除与 85/86 的因果）**：① `iframe.remove()` 后 Chrome 回 `contentDocument=null`、我方仍返回活的 `about:srcdoc` 文档；② `adoptNode` 进另一文档后 Chrome 为 null、我方仍是活文档；③ **父 srcdoc 尚未提交时，在其初始 `about:blank` 里创建的子 srcdoc 帧，我方导航永久丢失**（Chrome 直接销毁该元素）——独立的 realm/帧时序竞态。

#### 354.27 **决定性负结果**：35 项 payload 分岔**全都不是判据**

用注入链路的 VM 在加密上行前必经的 `JSON.stringify` 做钩子（Proxy 包装、保持 `name/length/toString` 原生形状、只处理「自身数字键 ≥ 20」的对象、跨 realm 中继回顶层），把**指定字段的值换成 Chrome 参考臂的值**，再跑实弹轮看判决是否翻转为 `POST /1.txt → 404`。

**有效前提已成立**：① 钩子只命中真 payload（同 realm 另一个 1211 键对象被正确放过）；② **空注入对照轮仍然失败**（只包不改），说明注入本身没有翻转判决；③ 解密后核验（`verify_swap.py`）确认被改字段**确实以 Chrome 的值落到了上行报文**。

**结果（9 轮，全部失败）**：

| 轮 | 规则 | 落到线上 | 判决 |
|---|---|---|---|
| control（空注入） | 0 | — | 失败 |
| g1 哈希探针群 | 13 | 13/13 | 失败 |
| g2 扫描基准 `IGBuA2`/`oHIQ6` | 2 | 2/2 | 失败 |
| g3 `OjmeV1` | 1 | 1/1 | 失败 |
| g4 计数器族 | 8 | 6/8 | 失败 |
| g5 媒体/度量/顶层 | 11 | 11/11 | 失败 |
| g6 余项 | 3 | 1/3 | 失败 |
| g7 按键定位补齐 | 2 | 2/2 | 失败 |
| **everything（34 条全上）** | 34 | 32/34 | **失败** |

`everything` 轮把共识分岔**从 35 压到 5**，直接证明钩子改的就是真 payload——**判决依然不变**。

⇒ **在 `3-frame-req` 阶段，CF 不依据这 ~35 项 payload 字段做裁决。** 这推翻了 §354.9 起"按分岔表排优先级"的整个前提：那些确实是**真缺陷**（几何、隔离、转义、quota、rtt、`Sec-Ch-Ua`、preload arming 都已修），但**不是判据**。

**会话噪声表**（判据改为"三个通过臂**互不相同**"，而非"看起来可疑"）排除 54 键，含头部/时间戳三件套、顶层会话令牌、漂移计数器、条目内漂移键。**两处与先前的判断不符**：`Ozfs8` **不是**漂移键（三臂一致 `"UGOeP6"`，我方 `"WoUrS0"`，是确定性差）；`OjmeV1` **是**漂移键（R1==R2≠R3），故 G3 从根上失去意义。

**已明确排除的方向**：payload 字段内容（本轮）、`/ci/` 是否发出（§354.22，且约半数轮次 `rPXg2` 本来就带它）。

**尚未覆盖、因此仍可能是判据的**：① **更晚的阶段**——每轮实际产生 5-8 份 `/fo/` 上行，只有 `3-frame-req` 做过三方对拍与置换；② **请求/传输层**（头部、时序、连接复用）；③ **会话级行为**（网络请求的序列与时刻本身）；④ 交叉一致性校验（把某值与其派生哈希一起换成**别的会话**的值，本身制造了新的不一致，故不能完全排除 CF 做内部一致性校验）。

#### 354.28 两条相关更正与进展

**`/ci/` 的 `rPXg2` 缺失是非确定性**（又一次纠正我）：清点 13 轮的 `3-frame-req`，**7 轮带 `/ci/`、6 轮不带**。我们的 `/ci/` 条目字段形状与 Chrome 一致（`EazF1:0, dtkfB9:112, gtlhH0:112, nXUeQ6:3784, FoGsT1:3484`）。

**`/ci/` 的真根因（已修，`06adea9`）**：preload `<link>` 的 arming **只在 `HTMLLinkElement` 的 JS setter 里触发**，而**解析器建的 link**（`innerHTML`、`insertAdjacentHTML`、`<template>`+cloneNode、初始文档解析）从不经过 setter ⇒ **完全不发请求**，只剩晚一步的 `Image.src`。这正是我测到 `duration 2191ms` 的成因，也解释了约 50% 的缺失率（快照时条目还没落地）。修复把 sweep 挂到 DOM 已有的 JS 侧 post-parse 记账点（含穿 shadow 的子树遍历）。**修复后实测 `/ci/` 条目：`transfer 632 → 6908`、`enc 332 → 6608`、`duration 2191 → 527ms`**（Chrome 三份 HAR 为 2415/3810/3196）。

**残余保真缺口（未修）**：preload 驱动的条目我们报 `initiatorType: "img"`，Chrome 报 `"link"`（fixture 实证）。

**流程事故（我的失误，已修复）**：我用不带路径的 `git commit`（`76cf924`）把另一个 agent **预先 staged 的 7 个源文件**一起提交了，而定义 `_armPreloadImageLinks` 的 `link.js` 当时未 staged ⇒ **HEAD 的 bootstrap 会抛 `ReferenceError`**（任何 `element.innerHTML =` 都失败，全新 checkout 大面积失效）。已用 `06adea9` 补齐定义与调用点，HEAD 恢复自洽。**纪律更正：任何提交必须显式带上路径（`git commit -- <paths>`），绝不用裸 `git commit`。**

#### 354.29 媒体/WebGL 面：`OYbs6` 识别、`XqEQ3`/`xkNI3` 修复、worker canvas 全缺

**`OYbs6` 是什么（不再是猜测）**：把 wrapper 注入真实 Chrome（拦截所有 target 的 `Debugger.scriptParsed` + `Page.addScriptToEvaluateOnNewDocument` + `waitForDebuggerOnStart`），记录挑战期间**每一次 WebGL/GPU/media 调用的实参与返回值**，再逐格对上。结论：CF 在 **`new OffscreenCanvas(1,1).getContext('webgl')`（WebGL1，未传 attributes）** 上跑探针，35 个元素是一条扁平 dump——下标 5-13 是 `getContextAttributes()` 的 9 字段（布尔转数字）、0-2 与 16-32 是 `getParameter` 各枚举、14/15 是 `ALIASED_POINT_SIZE_RANGE`/`ALIASED_LINE_WIDTH_RANGE`、33/34 是 `drawingBufferColorSpace`/`unpackColorSpace`。

**`OYbs6[10]` 的机制（值得记住）**：那次 context **没传任何 attributes**，Chrome 仍回 `"low-power"`。同一进程内对照：**顶层 frame 回显正确**（`default`/显式 `high-performance` 各自正确），而**任何跨站 iframe（OOPIF）渲染进程一律回 `low-power`**（CF 挑战 iframe 与一个中立的 iana.org iframe 都是）。⇒ 这是 **Chromium 按渲染进程的行为，不是 API 语义、也不按源**。未修：复刻它需要「realm 相对顶层是否**跨站**」这一信号，Chrome 的边界是 **site(eTLD+1)** 而非 origin，用现成的 `iframe_scopes_same_origin`（origin 比较）会在同站不同子域上答错；且 `realms.js` 正被大改。建议路径：Rust 侧暴露 per-realm 的 "cross-site to top" 布尔。

**`XqEQ3` 修复**：四个元素依次是 `MediaSource.isTypeSupported`×8(audio) / ×10(video)、`mediaCapabilities.decodingInfo`×8 / `encodingInfo`×10。两处根因（`media-capabilities-behavior.js`）：① `powerEfficient` 恒 `false`（Chrome 按平台解码器答：Apple/Metal 下 H.264/HEVC/VP9 与全部音频 `true`，AV1/VP8 `false`）⇒ 第三数组 `3` vs `7`；② **完全没有字典校验**，`encodingInfo({type:'file'})` 会 resolve（Chrome 抛 `TypeError`，CF 因此写 `null`）⇒ 第四元素 `[3,3,…]` vs `null`。顺带补齐 `MediaDecodingType`/`MediaEncodingType` 与必填成员规则。

**`xkNI3`/`KnOhl5` 修复**：video 编解码清单缺第 16/17 位两条 H.264 `profile-level-id=64001f`（来自 `RTCRtpSender.getCapabilities('video')`，由 `webrtc.js` 的 SDP 派生）。补进 SDP 后 audio 8/8、video **23/23 与 `xkNI3` 逐元素一致（含顺序）**。

**新发现，优先级高（已派修）**：**worker 作用域里 `OffscreenCanvas` 的 WebGL 是空的**——`new Worker(blob)` 内 `new OffscreenCanvas(1,1).getContext('webgl2', {powerPreference:'low-power'})` 我们返回 **`null`**（Chrome 正常返回 context）。这**不只是某个字段值不同，而是一整块 API 缺失**，会改变 VM 走的代码路径（CF 调用栈里 `Worker.constructor` 17 次、`OffscreenCanvas` 12 次）。另一条同族：`OffscreenCanvas.getContext('experimental-webgl')` Chrome 抛 `TypeError`、我们返回 context。

#### 354.30 请求头面收口：`Cache-Control` 过度发送已修

**Chrome 的真实规则（读线上头测的，不是读回显）**：用 `Network.requestWillBeSentExtraInfo`（**必须用它**——reload 时 `requestWillBeSent` 报 `Cache-Control: None`，线上其实是 `max-age=0`），测了 11 种导航：

| 导航种类 | 线上 `Cache-Control` |
|---|---|
| 全新 URL 的 `Page.navigate` | **无** |
| 同一 URL 的 `Page.reload` | **`max-age=0`** |
| 重访已访问过的 URL | 无 |
| 地址栏式新 URL 导航 | 无 |
| JS `document.location = location.href`（同 URL） | **无**（这条最关键：它确实发网络请求，但仍不带） |
| `history.back()` / `forward()` | 无请求（BFCache） |
| 跨源往返后的 `Page.reload` | `max-age=0` |

⇒ **只有显式 reload 带它**。两个独立 oracle 实例复现一致，reload 行另经 httpbin 回显三方确认。

**Obscura 无 reload 语义**：`RequestMode` 只有 `Navigate | NoCors | Cors | SameOrigin`，`RequestMode::Navigate` 同时被首次导航与 reload 使用 ⇒ 无法区分。故**直接去掉发射**，并在注释里写明「reload 语义未接线，故一律不发；接线后按上表只为 reload 恢复」。旧的注释理由（"没有它的导航不是浏览器会发的"）与 oracle 相反，已更正。**fetch/XHR 路径未动**（Chrome 那边本就不带）。

改动 2 文件（`wreq_client.rs` 隐身路径 + `client.rs` 明文路径，两条独立代码路径各自覆盖），新增 2 条回归测试，`obscura-net` **120/120**。端到端 httpbin 双引擎对照：导航与 fetch 两种上下文 **0 DIFF**。

**纠正我先前的一条观察**：我报告的「两条 baseURI 测试正在失败」是**快速变动的树里的瞬时状态**，并不可复现；该批工作**不是**该 agent 写的（它只动了 `obscura-net`）。当前 `-p obscura-js` 为 708 项、唯一失败是台账已记录的既有负载 flake（`timing_edits_preserve_identity_and_pause_holds_then_resumes`，单独跑通过）。

#### 354.31 更正 §354.25/354.26：`OjmeV1` 的空串**不是**原始文本序列化造成的，根因仍未定

**实弹验证（v3，二进制已含 `a7576a7`）**：`OjmeV1` 的七个下标 [79]/[82]/[85]/[86]/[103]/[104] **一字未变**。已确认修复确实在二进制里（`strings` 命中 `noembed`）。⇒ **原始文本序列化是第三个被证伪的解释**（前两个：srcdoc 带属性丢元素、CDP await 提交时序）。它是**真保真修复**（232 例容器矩阵 72→8），但**不是这项的根因**。

**用 `innerHTML` 钩子直接读出探针的真实操作**（钩 `Element.prototype.innerHTML`，经 `window.external.tracelog` 跨 realm 引出）：

```
s/HTML/challenges.cloudflare.com   '<p>EnIF0</div><p>ikyR0</p>'      ← 写 <html>
g/BODY/challenges.cloudflare.com   '0|'                              ← 读 <body>，长度 0（空串）
s/HTML/challenges.cloudflare.com   '<div data-foo="&#34;"></div>'
g/BODY/challenges.cloudflare.com   '0|'
```

⇒ 探针是「**把畸形/带实体转义的标记写进 `document.documentElement.innerHTML`，再读 `document.body.innerHTML`**」，并且**只在回读等于输入时才保留**。Chrome 把 `<p>EnIF0</div><p>ikyR0</p>` 解析成 `<p>EnIF0</p><p>ikyR0</p>`（多余的 `</div>` 被忽略），`body.innerHTML` 回读即该串；**我们的 `body.innerHTML` 是空串**。这同时解释了 [79]/[82] 两个「回读不等」布尔。

**最小复现尝试失败**（说明它是上下文相关的）：在 `example.com` 顶层文档、以及自建 iframe 文档上，同样的「设 `documentElement.innerHTML` → 读 `body.innerHTML`」**两引擎逐字一致**（我们同样得到 `<head></head><body><p>EnIF0</p><p>ikyR0</p></body>`，`body` 回读正确）。差异只在挑战那个 `challenges.cloudflare.com/.../rch/...` realm 里出现。**待查方向**：该 realm 里 `document.body` 是否返回了一个**已被 innerHTML 设置分离（detached）的旧 body**（其子节点已被搬走 ⇒ 回读空），而新解析出的 body 没有被 `document.body` 解析到；或该文档的 `<html>`/`<body>` 有特殊属性/处于特殊模式。

**已按此证据移交修复**（附上面两条日志与复现脚本）。

**方法论**：这是 `OjmeV1` 的**第四个**解释尝试。前三个都被"实弹 payload 直接观测"推翻——**只有注入链路里的实测才算数**，代理实验（自建等价探针）可能重建出错误的模型。

#### 354.32 **负结果扩大**：payload#1 的字段也全部排除（累计 53 个字段）

把置换钩子的识别判据放宽为**双判据、互斥设计**（键名不硬编码，全按形态）：

- ① `numeric`：自身数字键 ≥ 20 —— 命中 payload#2/#3（以及那个 1211 键的非 payload 大对象，始终 `changed=0`）；
- ② `flat`：顶层键 ≥ 30 **且**数字键 = 0 **且** ≥1 个长度 5-12 的短 token（`chl_api_m` 形态）**且** ≥3 个长度 ≥40 的 base64-ish 串 —— 命中 payload#1。

实弹命中日志确认两段都被命中（`ctx 2 nkeys=49 crit=flat` / `nkeys=100 crit=numeric`）。**方法学修正**：先前几轮「没点到 widget」的轮次**不是证据**（挑战根本没推进）；修正后只采纳出现 `-> click` 的轮次。

**payload#1 置换结果（全部失败）**：

| 轮 | 规则 | 落到 payload#1 | 判决 |
|---|---|---|---|
| `control2r-t1`（空注入） | 0 | — | 失败 |
| `p1-clean`（两个 Chrome 臂**一致**的 3 个字段：`TzZRB1`/`uGyjw9`/`Blsob5`） | 3 | **3/3** | 失败 |
| `p1-all`（全部 18 个差异字段） | 18 | **18/18** | 失败 |
| `p1-noise`（15 个臂间漂移计数器，目标=臂 1） | 15 | **15/15** | 失败 |

⇒ **累计 53 个确定性分岔字段（payload#2/#3 的 35 个 + payload#1 的 18 个）全部排除。** 其中 payload#1 只有 3 个是两臂一致的（其余在两份 headed 臂之间本身就漂移），这 3 个单独和整体置换都无效。

**剩余空间（该 agent 的压缩结论）**：

1. **更晚的阶段**——**这个缺口无法闭合**：通过臂只产生 5 份 `/fo/`（它们很快通过），第 4-11 阶段**根本不存在参考臂**。故 payload 侧的可对拍空间已探尽。
2. **请求传输层**：TLS/JA3/JA4、HTTP/2 帧序与 SETTINGS、header 顺序与大小写、body 的 RSA 头/padLen 分布、证书与 ALPN。钩子触不到这一层。（注意 §10.11/§10.13 曾断言该层因 mitmproxy 终结重发而"两边一致"，但那只覆盖了 TLS 与部分头部——**header 顺序、body 的 RSA 头/padLen 分布从未核过**。）
3. **会话行为**：点击前后的时序、事件序列、`/fo/` 请求间隔与并发、cookie jar 演化、`cf_clearance` 的签发条件。空注入对照排除了"单次注入本身"，但没有排除**时序统计量**。

**另一处未覆盖的 payload 缺口**：**页面层 `1-page-req` 从未被置换过**——它在**全部 15 轮里恒为 2370 字节**（说明不是帧层那个 flat 对象的同一实例）。要解它需要**页面层专属的 65 字符表**：裸 `curl` 拿挑战页返回 403，01:43 抓的 `chl_page*.js` 的表已随 build 轮换失效，而 obscura 的 CDP `Debugger.scriptParsed` 只暴露自身内部脚本、拿不到页面脚本。**这是唯一剩下的 payload 侧缺口，且它是"把页面层脚本的表取回来"这个具体、可解的问题。**

#### 354.33 干净负载对照：负载/时序混淆排除

在负载 **3.2** 下连跑两轮（c1/c2，二进制 `ac5b0414`，身份已对齐）：

- **两轮都完整走完流程**（`1-page → 2-frame → 3-frame → 4-frame → 5-page`），即 TS#1→pat→ci→TS#2→TS#3→main#2 全通；
- **判决仍然失败**，分岔稳定在 **33**。

⇒ **负载/时序不是判决因素**。此前所有实弹轮都在 load 6-39 下跑、部分轮次停在 TS#2，那确实是时序噪声；但负载降到 3.2、流程完整后判决不变，这条混淆项正式排除。

#### 354.34 请求头**顺序**差异（最后一个未被检验的层）

裸 TCP 回显（按**收到顺序**打印头名），上下文已对齐（两引擎都在 `https://example.com` 页面内 `fetch('<local>', {mode:'cors'})`）：

| # | Obscura | Chrome 153 |
|---|---|---|
| 1 | `user-agent` | `Host` |
| 2 | `accept-encoding` | `Connection` |
| 3 | `priority` | `sec-ch-ua-platform` |
| 4 | `sec-ch-ua` | `User-Agent` |
| 5 | `sec-ch-ua-mobile` | `sec-ch-ua` |
| 6 | `sec-ch-ua-platform` | `sec-ch-ua-mobile` |
| 7 | `sec-fetch-site` | `Accept` |
| 8 | `accept` | `Origin` |
| 9 | `origin` | `Sec-Fetch-Site` |
| 10 | `accept-language` | `Sec-Fetch-Mode` |
| 11 | `sec-fetch-dest` | `Sec-Fetch-Dest` |
| 12 | `sec-fetch-mode` | `Accept-Encoding` |
| 13 | `host` | `Accept-Language` |

**集合基本相同，顺序几乎完全不同**。另有两处集合差：我方 fetch 多 `priority`（Chrome 的 h1 fetch 无、h2 有），Chrome h1 有 `Connection` 我方无——属 h1/h2 差异，需按 h2 基准判定。

**为什么这可能重要**：HTTP 头的**顺序**是已知的客户端指纹向量，CF 的 **JA4H** 就包含它。此前 §10.13 只核过头的**取值**，从未核过顺序。已派修（要求先搭出可信的 **h2** 观测手段——因为经代理打 CF 走的是 h2，h1 的回显不能直接当基准——再按 Chrome 的 h2 行为对齐，且不得为排序引入每请求分配）。

#### 354.35 `OjmeV1` 空串**结案**（第五次尝试命中）：Trusted Types 跨 realm brand + 解析重入 sink

前一版的「detached 旧 body」假设**被证伪**——该 agent 把真实现场的 op 级 trace 挖出来（`ours/rt3/run/ops.tsv`，57k 行），探针真身是：

```
create_element html → set_inner_html 241 arg2='' → create head/body → 读 inner_html(body) → ''
```

即 **`document.implementation.createHTMLDocument()` 造空文档 → `documentElement.innerHTML = <TrustedHTML>` → 回读 `body.innerHTML`**。失败条件是 **realm 进入 Trusted Types 强制**（rch 页 CSP 里就有 `require-trusted-types-for 'script'`）。两个真缺陷：

1. `DOMParser.parseFromString` 是 **JS 实现**，内部用 `root.innerHTML = html` 走**公开 sink**；TT 强制下该赋值抛错并被 `catch` 吞掉 ⇒ 解析结果为空文档。Chrome 的解析在引擎内部，**只有 `parseFromString` 的实参是 sink**。
2. **Trusted Types brand 注册表是每 realm 一个 WeakMap，而 Chrome 的 brand 是 per-agent**（同一 renderer 内跨 realm 通用）⇒ 跨 realm 传来的 TrustedHTML 在 sink 上被判未授权而抛错 ⇒ 写入不落地。这正是 `createHTMLDocument()` 回读为空的机理。

修复：拆出 `_parseMarkupFromString()`（引擎内部解析，不走 sink）；brand 注册表搬到 `Deno[Symbol.for('obscura.trustedTypesRegistry')]`（沿用 `eventStateRegistry`/`nativeFunctionRegistry` 的既有跨 realm 模式），按 **kind 字符串**判定而非每 realm 的构造器身份；同族的 `template.innerHTML` 与 `document.open()` 一并修。3 条新测试均验证过「关掉修复即失败」（用仓库外备份 + 就地开关，未用任何 git 写命令）。`obscura-js` **711/711**。

**实弹兑现**（轮次 t1，二进制 `3e14b849`）：`OjmeV1` 的 **`[85]/[86]/[103]/[104]` 四个空串全部消失**。剩余 `[75]`（已确认噪声）、`[79]`、`[82]`（同一探针的"回读不等"布尔，**未随之翻转**，说明另有原因）、`[118]`（Chrome 数字 `611` / 我方 `[object Object]`，仍未定）。

**方法论**：这是该项的**第五次**解释尝试，也是第一次**既有机制、又在实弹 payload 上兑现**的一次。前四次的教训一致：**先用仪器在注入链路里读出探针的真实 op 序列，再谈根因**。

#### 354.36 探针阶段耗时差距（当前最有支撑的判据候选）

**动机**：置换实验排除了全部 53 个 payload 字段、干净负载对照排除了时序噪声——那么"**服务端观测到的实际到达时刻**"最能同时解释这两个负结果（改报文里的字段不改变请求的实际到达时刻）。

**阶段间隔（我方 vs 通过臂 Chrome，同机同代理）**：

| 间隔 | 我方 | Chrome | 倍率 |
|---|---|---|---|
| page → TS#1 | 2.0-2.1s | 2.67s | 0.8x ✓ |
| **TS#1 → TS#2** | **7.0-7.2s** | **3.06s** | **2.3x** |
| **TS#2 → TS#3** | **6.3-6.8s** | **2.13s** | **3.0x** |
| TS#3 → main#2 | 0.18s | 0.21s | 0.9x ✓ |

**逐条目耗时**（payload#2 每个条目自带 `hCfV6`；合计我方 5895ms vs Chrome 3405ms）：

| 条目签名 | 我方 | Chrome | 差 |
|---|---|---|---|
| `XCvwf5+gsLi5`（窗口普查） | **670** | **28** | **+642（24x）** |
| `SbVZ3`（console/资源报告） | 581 | 84 | +497 |
| `BMnw0+Ozfs8+UYbIv2+bzNje2+knVv1+xWWV8` | 580 | 143 | +437 |
| `Aqcaj8+…`（WebRTC/媒体） | 329 | 54 | +275 |
| `OjmeV1`（innerHTML 臂） | 239 | 44 | +195 |
| `ZkTjK2+gzWZ6`（CSS） | 248 | 74 | +174 |
| `DdIVt1+RPKTR7+…` | 152 | 32 | +120 |

**注意**：`gsLi5` 这一项在 §10.21 被追过一次（文档记 "census 探针 794ms vs 21ms"，批次 12 做了布局预热）。本轮实测仍是 **670ms vs 28ms**——即**当时并未收敛**，只是从 794 降到 670。已派专项压缩探针阶段耗时（目标：`gsLi5` ≤50ms、`SbVZ3` ≤90ms，并给出改动前后同 fixture 的 min-of-3 对照）。

**若这条成立**，此前所有 payload 级"优化"（包括已修的那些真实缺陷）对本判据**天然无效**——这正好解释了 `everything`（34 条规则全上、分岔压到 5）仍然失败的实验结果。

#### 354.37 页面层 payload 缺口：表能取到，但 payload 不可解（缺口实际不可闭合）

**表是可取的**：用我方引擎经代理抓页面层脚本即可——

```bash
RAY=$(grep -ao 'ray=[a-f0-9]*' /tmp/cf-parity/ours/<run>/run/ops.tsv | head -1 | cut -d= -f2)
obscura fetch "https://www.thelancet.com/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=$RAY" \
  --proxy http://192.168.3.57:9000 --stealth --user-agent '<干净 153 UA>' --dump original > page_layer.js
```

实测拿到 **236,838 字节**，其中含 65 字符表 `r$Y248tALRGxb6kmw7aeOSj0-XCT9dN1EFfUZIQJyi5hVcnK3qvpoPs+MHuDWgzBl`。

**但 payload 不可解**：两件事同时成立——
1. 该表**随 build 轮换**（用它解 01:43 的参考臂 body 直接报「字符 'l' 不在表中」）；
2. 更根本的是：**页面层走的是未打补丁的真 CF 脚本，加密 key 不可控**（注入只在 `/turnstile/…/rch/` 生效）。所以页面层上行**对谁都无法解密**（我方与 Chrome 皆然），替换值的来源不存在。

⇒ §354.32 的缺口 ③ **实际不可闭合**。唯一可能的迂回是在**不解密**的前提下做形状匹配与置换（钩子能拿到活的 JS 对象、也能知道字段名——页面层字段名可从这份 236KB 脚本的字符串表里提），但**替换成什么值**无从得知（`1-page-req` 两引擎恒为 2370 字节，说明结构同形、内容不可比）。

**结论**：payload 侧的可对拍空间**到此为止**。剩余候选只有请求/传输层（头顺序，正在修）与探针阶段耗时（正在修）。

#### 354.38 请求头顺序对齐落地（`b5c76af`）——判决未翻转

**最强的一条信号其实不是"顺序不一致"**：我们的**脚本化 fetch 头顺序是每次请求随机的**——caller headers 靠遍历 `HashMap` 重放，而 `HashMap` 的 hasher **每个 map 都带随机种子**，四次完全相同的 fetch 给出**四种顺序**。真实 Chrome 的顺序是确定的。

**观测方法与可信度**（该 agent 自建，含三项对照）：Node `http2.createSecureServer({allowHTTP1:true})` 记录**到达顺序**的头名；① 乱序回显对照（含 POST body）逐字节保序；② **伪头对照**（保住 `:method,:scheme,:authority,:path` 的次序，正因有它才没有误判下面的伪头发现）；③ pcap 序交叉验证。**一个坑**：首版读的是每个场景**最后一条**请求（`/favicon.ico`，子资源，顺序完全不同）→ 得出错表；最终表按请求路径过滤。

**Chrome 真实形状是两套**（不是一套）：**导航**（`sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, upgrade-insecure-requests, user-agent, accept, sec-fetch-site, sec-fetch-mode, sec-fetch-user, sec-fetch-dest, referer, accept-encoding, accept-language, cookie, priority`）与**子资源**（`sec-ch-ua-platform, user-agent, sec-ch-ua, sec-ch-ua-mobile, accept, origin(仅跨源), sec-fetch-*, sec-fetch-storage-access(仅跨站且带凭据), referer, accept-encoding, accept-language, cookie, priority(仅 h2)`）；表单 POST 是**第三个**变体（`content-length` 打头、`content-type` **交错在 `sec-ch-ua` 与 `sec-ch-ua-mobile` 之间**）。**纠正我一处**：Chrome 的 h1 GET 导航**没有** `upgrade-insecure-requests`（只有 POST 有），这点我们本来就是对的。

**落地**：新增 `chrome_headers.rs`（固定顺序表 + 在 Chrome 自己的槽位里替换值、而不是追加），三处接线；顺带修了 `sec-fetch-storage-access`（Chrome 在跨站带凭据的脚本请求上**确实发**）与 caller 自带 `referer` 时产生**重复 Referer**。**性能净减少分配**。

**改后**：h2 导航与脚本化 fetch **逐字节一致**；POST body 的 `content-length`/`content-type` 位置也一致。

**判决轮 h1/h2（二进制 `3e14b849`）：仍然失败**，分岔 35/34。

**唯一残留的线级差异**：h2 **伪头顺序**（我们 POST 是 `:method,:scheme,:authority,:path`，Chrome 是 `:method,:authority,:scheme,:path`；GET 我们已对）。它由 `wreq` 依赖的 profile 发出，**不在本仓库**，要改需上游或打补丁。**这条落在 CF 会看到的 POST 路径上**，已记入未决项。

#### 354.39 **决定性负结果**：时序假设被推翻；但挖出真正的判别式是「点击相对 TS#2 响应的位置」

**实验**：用 CDP `Fetch` 域在**通过臂 Chrome** 的 `/fo/` 请求上注入延迟（纯客户端，不碰代理），把它的节奏拖到我们的水平甚至更慢。

**结果（13 轮）**：

| 轮 | Δ | TS#1→TS#2 | TS#2→TS#3 | 点击相对 FO#3 响应 | 最终 POST | 判决 |
|---|---|---|---|---|---|---|
| `base-r1/r2` | 0 | 4.60 / 4.40 | 2.85 / 3.33 | +2.27 / +2.70 | **404** | PASS |
| `b1-r1/r2` | 1.0 | 5.73 / 6.17 | 4.41 / 4.37 | +2.77 / +2.78 | **404** | PASS |
| `b2-r1/r2` | **2.0** | **7.65 / 7.30** | 5.21 / 5.38 | +2.56 / +2.81 | **404** | PASS |
| `b3-r1` | **4.0** | **9.01** | **7.35** | +2.75 | **404** | PASS |
| `early-ctl` | **0** | 4.29 | – | **−0.11** | 无 | FAIL（点击过早） |
| `b2-time` | 2.0 | 7.07 | – | **−2.42** | 无 | FAIL（点击过早） |

**`b3-r1` 是决定性的**：它的节奏在**每个间隔上都比 Obscura 慢**（TS#1→TS#2 9.01s vs 我们 7.0-7.2s；TS#2→TS#3 7.35s vs 6.3-6.8s；page→TS#1 5.80s vs 2.0-2.1s），**仍然拿到 404**。载荷、UA、头部、顺序全未改动，只改了到达时刻。

⇒ **服务端观测的时序不是判据。** §354.36 的假设**被推翻**（探针耗时压缩因此从"判据候选"降级为纯性能改进，仍在做）。

**但同一组数据挖出了真正的判别式**：13 轮里区分成败的**不是 Δ，而是点击相对于 `FO#3`（TS#2）响应的位置**——所有通过轮都落在响应**之后 +2.27 ~ +2.83s**；两个失败轮落在响应**之前**（−0.11 / −2.42）。`early-ctl`（Δ=0）证明这与延迟无关。

**对 Obscura 的直接含义**：我们用**固定 14s** 点击，实测落在 TS#2 响应**之后约 +4.2s**——**比任何已知通过的 Chrome 轮都晚**，而这个位置从未被测过。已派实验：先在 Chrome 上二分出通过窗口的**两端**（`fo-click-delay` 0.5/1.0/2.6/4.0/6.0/9.0/12.0，关键档 ≥3 轮、每轮全新 profile），再给 Obscura 做一个**同样锚定**的点击器（靠 preload 在 widget realm 计数 `/fo/` 响应并经 `postMessage` 中继到顶层，CDP 轮询后点击），在同一组档位上跑，并带空注入对照。

**两处方法学坑（该 agent 记录）**：① `Fetch.enable` 打在 OOPIF 会话上**会返回 ok 但静默不拦截**，除非 `Target.setAutoAttach` 用 `waitForDebuggerOnStart: true` + `Runtime.runIfWaitingForDebugger`——否则 `challenges.cloudflare.com` 的 `/fo/` POST 全部逃逸，延迟只打到了 `thelancet.com` 的两条；② **复用的 `--user-data-dir` 会把 clearance 带过去、下一轮 GET 直接 404 而根本没走挑战**，每轮必须全新 profile（早期有一轮 `base` 因此作废）。

#### 354.40 探针耗时的真因是**两个量级级别的 DOM 缺陷**（`3f70892`）

耗时压缩 agent 自己复算了 `hCfV6`（按签名配对，不按下标），确认 §354.36 的表，并把根因挖到了宿主 op 层——**不是"探针本身慢"，而是 DOM 变更路径本身是坏的**：

- **每次 DOM 变更都跑一次全文档 iframe 查询**：`_syncWindowFrameIndices`（`env/dom/node.js:187` 经 `__prepareInsertedSubtree`、`env/css/cssom.js:158` 经 `_subtreeDisconnected`）用 `querySelectorAll('iframe')` **从 document** 回答 Window 的索引帧属性。3.6k 节点的页面上每次变更约 **62µs**，且成本**随文档增长**。
- **`document.body` / `document.head` 是整个文档的选择器查询**（`env/dom/document.js:46-47`）⇒ `document.body.appendChild(x)` 每次都是 O(文档)，**整个循环是二次的**（op trace：500 次 append 发出 **501 次 `query_selector_all_scoped 0 body`**）。

**修复**：帧索引重同步只在**被连接的子树真的含 browsing context** 时才跑（该扫描 `__prepareInsertedSubtree` 里已经算过）；样式表侧改为扫描**自身子树**而非整个文档并合并两条选择器查询；`body`/`head` 改由**树形**在 O(1) 内解析（规范口径：root `html` 的子元素，`body` 兼匹配 `frameset`），对不合规文档回退到选择器。

**实测（同 fixture，min of 3）**：

| 形状 | 改前 | 改后 | Chrome |
|---|---|---|---|
| `appendChild` ×300（3.6k 节点） | 20.4ms | **2.5ms** | 0.0 |
| 经 `document.body` create+append ×20k | 2916ms | **282ms** | 4.6 |
| 预建后 append ×20k | 5270ms | **148ms** | 3.3 |
| `remove` ×20k | 2695ms | **97ms** | 3.0 |
| 5×2000 分批 append | 60→266（**增长**） | **27（持平）** | 0.4 持平 |

**诚实声明**：该 agent **没有达成**我给的 `hCfV6` 目标（`gsLi5 ≤50ms` 等），并明确说"不能诚实地声称在这些数字上有进展"——因为普查的残余是**另一个独立问题**：帧 realm 的 `innerWidth`/`innerHeight` 是访问器，会调 `op_layout_metrics` → `ensure_prepared_geometry` → **整个顶层文档的全量 re-prepare**；实测同一形状改前改后都是 31ms vs Chrome 1.2ms（26x，与线上的 24x 吻合）。**这是 `gsLi5` 的下一个、也是最有价值的线索**，属 profile 已记的独立工程（多趟全树遍历合并/增量化）。

**判决轮 p1/p2（`1cd84403`）**：仍失败（时序假设既已证伪，这项从"判据候选"降级为纯性能改进，但它是**真缺陷**、值得留）。

**同批记录的其他发现**（未修）：`querySelectorAll('*')` 比 Chrome 慢 26x、`querySelectorAll('iframe')` 慢 8.7x（节点 id 列表的急切 JSON 序列化 + 遍历）；**500 层嵌套会让进程 Rust 栈溢出**（改前即可复现，未查）。

#### 354.41 **决定性负结果**：点击时机假设被推翻（含一个 harness 假象的更正）

**Chrome 的通过范围是单边的，不是窗口**。17 轮（每轮全新 profile、Fetch 关闭、锚点=**第 3 个 `/fo/` 的响应**）：

| `fo_click_delay` | 轮数 | 判决 |
|---|---|---|
| 0.5 / 1.0 / 2.6 / 4.0 / 6.0 / 9.0 / 12.0 | 2-3 | **全部 PASS（17/17）** |

点击距 FO#3 **响应**跨 **+0.73s ~ +12.42s**，**测试范围内没有上界**；唯一的规则是**下界**（点击早于该响应会失败，见 §354.39 的 `early-ctl`/`b2-time`）。

**更正 §354.39 的判读**：先前那个「+2.27~+2.83s 窄带」是**harness 假象**——旧 harness 把 `--fo-click-delay` 固定成 3.0s 且锚在 FO#3 的**发送**上，于是每个通过轮都落在同一个常量偏移。窄带是 harness 常数，不是 Cloudflare 期限。（`b4-r1` 的"6.0 秒失败"也是它自己的 `--delay-req 6.0` 把每条 `/fo/` 拉长 6 秒、多产生一条 `/fo/` 的混淆。）

**Obscura 在同一组档位上 0/20**，扫描范围**完全覆盖** Chrome 的通过范围。而且**方向是反的**：我们实际发布的固定 14s 点击落在自己第 3 个 `/fo/` 完成之后 **+3.66/+4.26s**——**正落在 Chrome 每次都通过的带里**（Chrome 同位置 `+4.30/+4.31/+4.46` 全 PASS）。⇒ **点击时机不是 Obscura 的 blocker，改动它是在追一个非原因。**

**失败也不是"点击过早停住"那个签名**：点击后流程继续跑（widget 的 `/fo/` 在 17.53s、页面层在 17.71s），只是**永远到不了 `POST /1.txt`**。

**空注入对照**（三级 preload：无注入 / 只有中继管道与两个非枚举全局 / 完整计数中继）**不可区分**——注入对判决透明。

**两处方法学坑**：① **从 t=3.0s 开始轮询会永久清空 obscura 的文档**（首轮只记录到 1 条 `/fo/`、widget realm 不再 post、标题正文皆空），改到 6.0s 起始才拿到完整的 `[page, widget, widget]` 序列——`cdp_click_fast.py` 里记的 3s 下限在这个 build 上不安全；② **ray 切换会重建顶层文档并重置 window 作用域计数器**，轮末读取描述的是**新**文档、静默少报 `/fo/`，驱动改为在锚点时刻快照。

**该 agent 的结论**：这里没有任何东西解释**为什么 obscura 从不 POST `/1.txt`**。

#### 354.42 收敛：已排除与剩余（含一个会推翻整个头部层的待核问题）

**已用实验排除（每条都有实测支撑，非推断）**：

| 候选 | 结论 | 依据 |
|---|---|---|
| payload 字段内容（53 个确定性分岔） | **排除** | 逐字段置换，含 `everything` 轮把分岔从 35 压到 5，判决不翻转（§354.27/§354.32） |
| 更晚的 `/fo/` 阶段 | **不可测** | 通过臂只产生 5 份 `/fo/`，第 4-11 阶段无参考臂 |
| 负载 / 时序噪声 | **排除** | 负载 3.2 下流程完整走完，判决不变（§354.33） |
| 服务端观测的到达时序 | **排除** | 把通过臂拖到 **每个间隔都比我们慢**（TS#1→TS#2 9.01s vs 我们 7.0-7.2s）仍拿到 404（§354.39） |
| 点击时机 | **排除** | Chrome 通过范围单边（+0.73~+12.42s，17/17）；我们 0/20，而**我们的实际点击正落在 Chrome 全通过的那个带里**（§354.41） |
| 页面层 `1-page-req` payload | **不可解** | 页面层走未打补丁的真 CF 脚本，key 不可控（§354.37） |

**待核（可能推翻整个头部层）**：注入链路是 `Obscura/Chrome → :9000 代理（Reqable→上游 mitmdump）→ CF`。**代理会终结并重发**，因此 CF 看到的**头顺序与 h2 伪头顺序可能是代理自己构造的**、对两个客户端同为一份——若如此，§354.38 的全部头部顺序工作对判据**天然无效**（仍然是把行为改正确的正当改动，但不是判据）。这一点**尚未直接观测**，但它与"§10.11 记 TLS/HTTP 指纹因 mitmproxy 终结重发而两边一致"是同一个机制，**很可能同真**。

⇒ 若头部层同样不可见，则**所有可观测面都已对齐或排除，而判据仍未定位**。此时唯一剩余的入口是**服务端侧逻辑本身**（加密载荷内 VM 计算出的检测值 + CF 的裁决规则），而这需要当轮 build 的 jsvmp 反编译管线（远程 `cf-ov2-replay`）。

#### 354.43 **VM tracelog 对拍通道打通**（用户指定的方向）

**通道**：注入链路的 ov2.js 被 AST 插装器加了 `vmp-instrument: fulltrace` helper（`/*__OV2T_HELPER_BEGIN__*/` 段），在 VM 每步调用

```js
window.external.tracelog("vmp.deobf.0924.exec", { n, b:[op,pc,st, …] })   // 每 3000 三元组一批
window.external.tracelog("vmp.deobf.0924.new",  { run, bc, a0, a1 })      // VM 实例边界
```

而 `crates/obscura-js/src/tracelog.rs` 的模块文档写明：**「被对拍的插桩 Chrome 构建把 `window.external.tracelog` 暴露给页面代码……Obscura 实现同一契约，使打过补丁的挑战脚本能在两个引擎上不改动地运行」**——这就是为本对拍设计的通道。实测：`obscura serve --tracelog-file` 一轮产出 **3.3MB / 256 行 / 7 个 VM 实例**。

**VM 现场（从 ov2.js 读出）**：

```js
A.runProgram = function (S, rP, xb) { … __ov2t_…_n(S.length, 0, 32), new LF(S).run(0, 32, []); }
switch (…) { case 14: La.call(this); break; case 77: LK.call(this); break; … }   // 两处 dispatch
```

即 `bc` 是 `S.length`（该实例的字节码长度），dispatch 传 `(op, pc = yU[yf]-1, st = yU[yQ])`。

**首次对拍（我方 0924 vs 用户的 0923 参考 `trace.jsonl`）**——会话感知归一化后，每会话 4 个 VM 实例：

| run | 我方 `bc` | 参考 session0 | 参考 session1 |
|---|---|---|---|
| 1 | 6944 | 6944 | 6944 |
| 2 | 634336 | 634688 | 634396 |
| 3 | **95424** | 95428 | **95424** |
| 4（TS#3） | **3920** | **5432** | **5488** |

**op 分布份额高度吻合**（run 2：我方 `[0.130,0.088,0.066]` vs 参考 `[0.130,0.088,0.067]`），说明两条 trace 对齐可比。**run 4 的 `bc` 我方明显更小**——即"失败变体"的短程序，在 VM 实例层面再次确证（与 §10.13 的 TS#3 长度观测同源）。

**最干净的发现**：run 1 两边 `bc` **相同（6944）**，`pc` 序列**前 694 步逐位一致**，第 694 步在 **pc=415** 分岔——参考跳到 **pc=186（往回）**、我方跳到 **pc=1030（前进）**；参考共 1107 步、我方 847 步。**形状是参考多做了一轮循环。**

**但有一个必须声明的保留**：`st`（寄存器 `yU[yQ]`）**从第 0 步就不同**（118 vs 32），因为 **0924 的 `runProgram` 硬编码 `a1=32`、0923 的 helper 传的是别的常量**——这是 **helper 版本差异**，不是引擎差异。因此 **`st` 不可跨 build 比**；而既然寄存器初值不同，**那个 pc 分岔有可能是 instrumentation 假象**。⇒ **必须有同 build 的 0924 Chrome trace 才能定论**（已派：用 CDP 在 main world 注入 `window.external.tracelog`，配合 OOPIF 的 `Target.setAutoAttach` + `waitForDebuggerOnStart` 才能覆盖 widget realm）。

**run 2/3 只对齐 19 步**（共享序言），之后是**恒定偏移**（run2 差 44、run3 差 2）——说明服务端下发的程序是同源变体（有插入/删除），跨会话的程序本就不同。

#### 354.44 **同 build VM tracelog 对拍命中：同一程序、同一寄存器状态，走了不同分支**

**关键前提**：远程 `trace.jsonl` 在 09-24 09:28 被更新（15.88MB），**同时含 0923 与 0924 两个 build 的记录**——其中 `vmp.deobf.0924.*`（4 个 `.new` + 128 个 `.exec`）就是**同 build 的真实浏览器参考**。这解除了 §354.43 的保留。

**注意：§354.43 里"第 694 步分岔"当时被判为可能的 instrumentation 假象——同 build 复核后，那个分岔点（pc 415 → 186 vs 1030）**依然存在且完全成立**；只是当时无法排除 `st` 的跨版本污染，现在排除了。

**实例级对照（均为 0924、`a1=32`）**：

| run | 参考 `bc` | 参考步数 | 我方 `bc` | 我方步数 |
|---|---|---|---|---|
| 0 | 6944 | **847** | 6944 | **847** |
| 1 | 617204 | 121297 | 634336 | 119756 |
| 2 | **95424** | **4505** | **95424** | **3491** |
| 3 | **5428** | 0 | **3920** | 0 |

**run 0 完全一致**（bc 与步数都为 847）——但**内部仍有一个分岔**：

```
[691] ref op=146 pc=402 st=160  |  ours op=146 pc=402 st=160
[692] ref op=42  pc=412 st=164  |  ours op=42  pc=412 st=164
[693] ref op=246 pc=415 st=172  |  ours op=246 pc=415 st=172     ← 完全相同
[694] ref op=84  pc=186 st=162  |  ours op=14  pc=1030 st=175    ← 分岔
```

即：**同一份程序（`bc` 同为 6944）、前 694 步 `(op,pc,st)` 三元组逐位完全相同**（同 build 下连 op/st 都可比），到 **pc=415** 之后参考跳 **pc=186（往回）**、我方跳 **pc=1030（前进）**；两条分支**长度相同**（各 153 步，总数都是 847）。⇒ 这是同一程序里一个**数据相关的二选一分支**。

**run 2（`bc` 同为 95424）同样**：前 211 步三元组一致，在 **pc=22291** 分岔（`st` 同为 188、`op` 参考 118 / 我方 42 —— 说明喂给 op 解码的**别的寄存器**不同）；之后 pc 相差 1 字节量级并持续。

**结论（本轮最强的定位）**：**分歧不是"程序不同"，而是"同一程序里读取到的宿主/环境值不同"，导致数据相关分支走了另一侧**。run 0 是脚本自身的 bootstrap（6944 字节），它在 pc=415 处做的这次二选一，**很可能就是在探测环境**——这就是判据候选的执行级现场。

**待办**：读 pc=415 那条指令在读什么。程序是运行时解码的（`runProgram(S, …)`，`S = yB.ZiAhg(Z, yX)` 之类的解码产物，非字面量数组），需静态或运行时取到这份 6944 字节程序再反查该 pc 的语义；或按"同一程序 + 三元组前缀完全相同"这一极强约束做**受控环境置换搜索**（改一个环境值，看分岔是否翻到参考那一侧）。已派。

#### 354.45 **撤回 §354.44**：那个分岔是会话数据决定的，不是引擎差异

补跑我方 3 轮 trace 后：

| 会话 | run0 步数 | 第 694 步（op,pc,st） | run2 步数 | 第 211 步 |
|---|---|---|---|---|
| 参考（Chrome 0924） | 847 | (84, **186**, 162) | 4505 | (118, 22291, 188) |
| 我方 tl1 | 847 | (14, **1030**, 175) | 3491 | (42, 22291, 188) |
| 我方 tl2 | 899 | (84, **186**, 162) | 3441 | (42, 22290, 188) |
| 我方 tl3 | 847 | (84, **186**, 162) | 3312 | (42, 22292, 188) |
| 我方 tl4 | 847 | (84, **186**, 162) | 1000 | (118, 22290, 188) |

⇒ **我方 4 轮里 3 轮与 Chrome 走同一侧（pc=186）**，1 轮走另一侧（pc=1030）。**该分岔由会话数据决定，两个引擎都能走两侧**——§354.44 把它当作"判据执行现场"是**错的，予以撤回**。

**由此得出本通道的能力边界（重要）**：

- 服务端**按会话**下发程序与数据，所以**跨会话的 `pc`/`op`/步数序列不能逐位对齐**（run 0 的 `bc=6944` 是唯一跨会话固定的程序，而它的分岔也是数据驱动的）。
- 能成立的形态是：**同一份程序（`bc` 相同）下比较"分布"，而不是比较"某一步"**。参考侧样本：Chrome 在 run2（`bc=95424`）的步数为 **4505**（0924）/ **4001**（0923 session1）/ 2603（0923 session0）；我方为 **3491 / 3441 / 3312**——**区间重叠**，单看步数**分不开**。
- 要在这条通道上取得统计意义上的结论，需要**每类各若干十轮的分布**（不是一两轮），以及一个**能在同 build 下批量产出参考轮**的手段。

**结论**：tracelog 通道确实是**设计好的对拍通道**（同 build、同契约、指令级），但**"跨会话逐指令对齐"这条路不通**——它的正确用法是**分布对比**，而这需要把样本量做上去。

#### 354.46 本地 run-1 fixture（5 秒/轮，可复用的对拍资产）+ 一处必须核实的误判

**误判（已核实并纠正）**：某 agent 报告"插桩 helper 只对 obscura 生效、Chrome 拿到的页面里没有 tracer"，据此认为 Chrome 侧参考 trace 无法采集。**核实后是它的 harness 漏了代理**——`chrome_rounds.py` 的 argparse 里没有任何 `--proxy` 参数，那些轮次是**直连**跑的。经 **:9000 代理 + Chrome UA** 重新抓 rch 文档：**337,078 字节，含 `__OV2T_HELPER`(2) / `vmp.deobf`(4) / `payloadJSON`(1) / `runProgram`(4)** ⇒ **注入对任何客户端都生效**，用户那份参考 trace 里的 `vmp.deobf.0924.*` 也正是这么来的。已让该 agent 补上 `--proxy-server=http://192.168.3.57:9000` 重跑。

**本地 fixture（真正有价值的成果）**：`/tmp/cf-parity/vmp/fixture/`，**约 5 秒一轮、完全不打 Cloudflare**：

- 驱动原理：`S.ScvHT(runProgram, '<b64>')` 等价于 `runProgram('<b64>')`，而那个 **base64 字面量正好 6944 字符 = `bc`** —— 即 **run 1 的程序是页面内嵌字面量，不是服务端下发的**；`runProgram` 是**可达的页面全局**，返回 continuation（`yg = runProgram(yX, A); typeof yg === "function" && yg(x, Er)`）。
- **实测：`bc=6944`，前 847 步与 0924 浏览器参考逐位一致，`s694 = (84,186,162)`；42/42 干净轮 + 12/12 负载轮都成立。**
- 注入通道本身也被证过是有效的（覆盖 `runProgram` → 0 步；覆盖 `String.fromCharCode`/`JSON.parse` → 第 234 步分岔）。
- 能力边界：**只覆盖 run 1**（bootstrap），不覆盖服务端下发的 run 2/3，也不含真实点击与流程推进。

**34 项单变量环境扫描全部无效**（navigator 全家 / 几何全家 / 时钟与 RNG / cookie-referrer-时区 / visibility-focus-window.name / canvas 与 WebGL 置空 / Intl 置空 / 26 项一次性全改）——`s694` **恒为 `(84,186,162)`**。⇒ **第 694 步的分支不由这些宿主面驱动**，与 §354.45 的"会话数据决定"结论一致。

**新的引擎线索：一个罕见非确定性**。54 轮本地 fixture 里抓到 **1 次** `DIVERGE@694 ours=(14,1030,175)`（与 tl1 完全同形）；而**真实轮次 4 轮就有 1 次**——**真实环境下的翻转率明显高于 fixture**。同一程序、同一寄存器、偶发走另一分支，指向未初始化状态 / 迭代顺序 / 时序相关的真 bug。已让该 agent 用 fixture 做高频循环把触发条件逼出来。

#### 354.47 分布对比：出现"完美分离"，但被一条自身数据推翻，不可采信

**Chrome 侧采集已可用**（16/16 通过；run 1 `bc=6944`、`s694=(84,186,162)` 与参考一致；且该 agent 纠正了它自己先前两处误判——代理其实一直在链路上，`records=0` 的真因是**它在点击之后才开始 drain，那时 widget OOPIF 已被拆除**）。

**分布对比（15 通过 Chrome + 15 Obscura，同一份 run-1 程序）**：

| 统计量 | Chrome n=16 | Obscura n=15 | 可分离 |
|---|---|---|---|
| `bc` | 6944 (16/16) | 6944 (15/15) | 否 |
| **`steps`** | **934×11, 986×4, 1038×1** | **847×11, 899×4** | **是，区间不重叠** |
| **`op_top1` 份额** | 0.1898–0.1959 | 0.2013–0.2054 | **是** |
| **`op_top2` 份额** | 0.1320–0.1424 | 0.1235–0.1287 | **是** |
| `ops_distinct` / `pc_distinct` / `pc_max` / `st_distinct` | 33 / 551 / 5205 / 69 | 33 / 551 / 5205 / 69 | 否 |

程序**可证同源**（`bc`、distinct-op、pc 覆盖规模、最大 pc、st 取值数全部一致），差的只有**执行长度与 op 混合**。

**但该分离不可采信，依据是它自己报告的一条数据**：**"Chrome's run 1 runs to 934 dispatches, the reference stops at 847"**——即

- **用户那份真实插桩 Chrome 参考 = 847**
- 该 agent 的 Chrome（CDP 注入 shim + UA override）= 934–1038
- 我方 tl1/tl3/tl4 = **847**、tl2 = 899

⇒ **用户自己的真实 Chrome 落在我们这一侧（847）**，而 agent 的"Chrome 替身"跑到 934+。**两个 Chrome 之间差 10-23% 的 dispatch 数**，说明差异来自**采集条件**（shim、UA override、headed/headless、几何、挑战变体），不是"Chrome vs 我们"的引擎差异。**这个"完美分离"很可能是 harness 假象**——与 §354.41 的"点击窗口"同类的坑，不予采信。

**⇒ 瓶颈精确落在参考侧**：参考目前只有 **1 个 0924 会话（847 步）**，单样本无法判断 847 是常态还是偶然。**需要 N≥15 的真实插桩 Chrome 轮次**才能下结论。

**顺带查出的两条（非判据，留档）**：
- **我方引擎真缺陷**：同一进程开**两个 tab 会让两边都失败**（`__nsteps=0`，0/157）——独立问题。
- **run 2/3 的步数在现有采集里不可比**：最后那个实例的步数恒为 1000 的整数倍（16/16 Chrome、15/15 我方），因为 helper 只在 3000 个数或下一个实例边界 flush，**尾部无人 flush**。要比较 run 2/3 需在 Chrome 页里加 tail-flush shim。

**关于那个 1/54 非确定性（§354.46 续）**：654 轮累计 16 次翻转（2.4%），**形态恒为 `(84,186,162) → (14,1030,175)`**；一次 6.5% 的campaign 未复现（重复 0.5%），且 13 次命中里 6 次挤在 24 轮窗口内（≈30 秒）——指向**时间相关的外部条件**而非逐轮可调旋钮。未找到可靠触发。

#### 354.48 独立复算：分离是**常量偏移**造成的，且我方与真实参考一致

从原始 trace 直接复算（不经任何 summary、不受 agent 结论影响）：

| 来源 | run-1 步数分布 |
|---|---|
| 用户真实插桩 Chrome（`reftrace2/ref0924.jsonl`） | **847**（n=1） |
| Obscura（`ours/tl*/run/trace.jsonl`，n=4） | **847×3, 899×1** |
| agent 的本地 Chrome（`vmp/chrome/**`，n=16） | **934×11, 986×4, 1038×1** |

**结构**：我方 `847 → 899` 差 **52**；agent Chrome `934 → 986 → 1038` 每档也差 **52**。

⇒ **两边共享同一个 `52` 步量子**（同一段循环的迭代次数，随会话浮动），而**基线之间是常量差 `87`**。

⇒ **`934 − 847 = 87` 是常量，不是分布差异。** 结合"我方与**真实参考**同为 847、而 agent 的 Chrome 为 934"，**§354.47 那个"完美分离"几乎可以断定是采集条件差**——最可能是**几何/身份**（我方模拟参考机的 1512×982 / DPR 2 / outer 1200×816，而 agent 的 headless Chrome 用本机真实几何 3440×1440 / DPR 1）。

**已把靶子收窄并转给复算 agent**：不再是"解释 847 vs 934"，而是「**在 agent 的 Chrome harness 里找出让基线从 934 回到 847 的那一项**（先单变量试几何，尤其 **DPR 2 vs 1**，再看 UA 与 headed/headless）」。每项 ≥3 轮、看众数，以排除 `52` 量子的抖动。

**同时已开阳性对照**（另一个 agent）：用 CDP **逐项降级通过臂 Chrome 直到它失败**，从而第一次拿到"**已知会失败的参照**"——这是把此前所有"相关性"升级为"因果"的唯一手段。若全部降级都不失败，那本身是强结论：**这些环境值不是判据**。

#### 354.49 **run-1 分离的定论：不是采集条件，是平台差异——而我方与真实参考逐位一致**

**精确分解**（该 agent 从全部来源的原始 trace 得出）：

```
run-1 steps = 557 + 29 × mid + 52 × tail
```

| 来源 | n | `mid` |
|---|---|---|
| 参考机（`reftrace2/ref0924.jsonl`，2 会话 + 2 代 helper） | 2 | **10** |
| Obscura 实弹（`ours/*/run/trace.jsonl`） | 7 | **10** |
| Obscura 本地 fixture | 241 | **10** |
| agent 本机 stock Chrome（历史 16 + 本轮 36） | 55 | **13** |
| agent 本机 Chrome 的**本地 fixture** | 7 | **13** |

- `base = 557` **在所有来源的每一条 trace 里都相同**；
- `tail` 是**时间驱动的旋转器**（8× CPU 节流下速率不变 ⇒ 计时器/事件节拍驱动），即那个 52 量子，**纯采样噪声** ⇒ **只有 `tail=0` 的值才可比**；
- **`87 = 3 × 29`**，即 **pc 186–415 那段循环多做 3 次迭代**。用 `difflib` 对齐 55 条 Chrome trace：**全部等于 `ref847 + insert(87) + insert(52k)`**，即前 788 步与参考逐位相同。

**单变量扫描（实弹，每项 3 轮，几何从 widget realm 读回）全部无效**：`dpr2` / `viewport(1512×982)` / `screen(1512×982 @44,77)` / `identity`（几何+DPR2+hc15+dm32+colorDepth30）/ `headed` / `win1200` / `comboid`（headed+win1200+full identity）/ `throttle2|4|8`（已先验证 `Emulation.setCPUThrottlingRate` 真的生效：忙循环 16.3→34.3→65.5→127.6 ms）——**`mid` 恒为 13**。另有本地 Chrome fixture（无代理、无实弹、无点击）**同样 mid=13**，以及**一次性伪造全部页面可见环境值**（探针确认补丁落进了 widget realm）**仍是 13**。

⇒ **`mid` 对一切页面可见层的东西不变**，它是**执行该程序的引擎/宿主自身的属性**：本机 Chrome 153.0.8010.48 恒 13、Obscura 恒 10、参考机的（插桩）Chrome 恒 10（两个会话、两代 helper）。

**⇒ 定论（比"排除一个候选"更强）**：

- **"Chrome 934 vs Obscura 847" 不是引擎差异，而是「本机 stock Chrome vs 参考机 Chrome」的平台差**，**Obscura 站在参考那一侧**；
- 而且证据不止步数：**Obscura 复现参考的 run-1 是逐位一致的全部 847 步**（`fixture847 == ref847` 为 True；241/241 本地实例、7/7 实弹轮共享同一 847 步前缀）——**这是整轮排查里最强的一次 parity 结果**；
- 因此**步数总量在两个方向上都不能当判据**（同一引擎在两地给出 10 与 13，原因在页面可见层之下）。

**顺带**：`ua-natural`（不覆盖 UA）的 3 轮**全部失败**——与先前"headless 自带 `HeadlessChrome` 标记即败"一致，判据与步数无关。

**未定**：参考机 `mid=10` 的成因。首要嫌疑是**参考那台机器跑的是插桩过的 Chrome（原生 tracelog 后端）而非 stock Chrome 153**；Chrome 版本或 macOS 版本差异同样未排除。**这意味着我们的"参考臂"并非 stock Chrome**，这一点必须记住。

#### 354.50 run 2 也不可比 ⇒ tracelog 通道的结论收口

把 run 2（挑战主程序）按三元组与参考对齐：

| 会话 | 我方 `bc` | 参考 `bc` | 逐三元组前缀 | 首个分岔 |
|---|---|---|---|---|
| tl1 | 95424 | 95424 | **211/3491** | pc 22291 两侧**相同**，但 `op` 参考 118 / 我方 42（`st` 同为 188） |
| tl2 | 95424 | 95424 | 19/3441 | pc **恒定 +1 偏移**（ref 71563 vs 71564），之后一直保持 |
| tl3 | 95432 | 95424 | 19/3312 | 同上（偏移 +6） |
| tl4 | 95424 | 95424 | 19/1000 | 同上（+1） |

⇒ **服务端按会话下发的是同尺寸的"程序变体"**（±1 到 ±6 字节的插入），所以 **run 2 跨会话同样不可比**。tl1 那种"pc 相同而 op 不同、st 相同"只能说明喂给 op 解码的**别的寄存器**不同——而寄存器不在 trace 的三个字段里。

**⇒ tracelog 通道的结论收口（干净且正面）**：

1. **唯一跨会话可比的程序是 run 1（页面内嵌的固定 bootstrap），而我方在它上面与通过臂参考逐位一致（847/847 步）。** 这是整轮排查里最强的一次 parity 结果。
2. **run 2/3 由服务端按会话下发变体，跨会话不可对齐** ⇒ 该通道**无法**用于定位我们与通过臂在挑战主程序上的行为差异。
3. 于是这条线的产出是：**"bootstrap 层的执行我们与通过臂完全一致"** + **"主程序层无法用 trace 对拍"**。判据不在这条通道能触及的范围内。

**后续只剩两条**：① 正在跑的**阳性对照**（降级通过臂 Chrome 直到失败，建立因果关系）；② **用户在真实插桩 Chrome 上跑 ≥15 轮**，把参考从 n=1 做成分布。**不再对 trace 通道投入更多样本**——它已给出它能给的全部结论。

#### 354.51 **阳性对照成功：第一次有了"已知会失败"的参照；环境值被硬性排除**

**① 找到能翻转判决的降级**：**UA 里的 `HeadlessChrome` 产品标记**——3/3 失败（`ua-headless-topdoc` / `ua-headless-widget` / `ua-headless-nocli` 三个作用域变体各 2/2 失败）。**只有这个标记有决定权**：`Chrome/90`、Windows-Chrome/153、Firefox UA **全部通过**。且它**至少在两处独立被判定**：只把**顶层文档请求**的 UA 换成 headless 会失败；只把 **widget 会话**的 UA 换成 headless 也会失败（任一作用域单独足够）。

**② 我们的失败在粗结构上与已知坏样本一致**：

| | VM 生命周期数 |
|---|---|
| 通过臂 Chrome（44 轮） | **1** |
| `HeadlessChrome` 失败轮（9 轮） | **2**（被拒后重开一轮） |
| **Obscura（15/15）** | **2** |

⇒ **我们确实在被"拒绝"，形态与被拒的 Chrome 完全一致。** 但**细结构不吻合**：该失败轮的 run-1 程序与同批**通过轮逐字节相同**（pc 前缀 986/986、551 个 pc 集合相同）⇒ **run-1 不编码判决**，我们的偏差也不是这类失败的指纹；同理，**run-1 层的 step/pc 证据无法支持或反驳任何关于 Obscura 的假设**。

**③ 环境值被硬性排除**：**18 项降级、40 轮、40/40 全过**——device metrics/DPR、各种 screen（**含刻意设成 Obscura 那套 `screen 3440x1440` + `innerWidth 1440` 窗口**）、platform 双向错配、时区（两种做法）、locale、hardwareConcurrency 1/2/64、geolocation、WebGL→SwiftShader、以及**全部一次性叠加**。每项都验证过补丁**确实落地**（realm 回读 `hc=2/hc=64/tz=UTC/cal=de-DE/dpr=3/gl=Google SwiftShader/scr=3440x1440/inner=800x600`）⇒ "无效果"不是"没生效"。**注意**：通过臂基线本身就带 screen/window 错配（`screen 800x600` vs `innerWidth 1440`），所以"错配"本身不是门槛。

**④ 方法学更正（重要，影响此前所有 op 值对比）**：**VM 的 opcode id 每次加载随机置换**——同一份 run-1 的份额向量在不同 trace 里表现为 `{42,14,84,…}` 与 `{87,252,131,…}`（pc 集合双向包含度 1.00）。⇒ **此前所有"按 op 值"的 Chrome-vs-Obscura 比较都在比一个置换**。`(op,pc,st)` 里**只有第二个字段（字节码 PC）稳定可比**，应以它为准。

**⑤ 其他**：`a1` 在"插桩参考 Chrome 与 Obscura"读 32、"stock Chrome + shim"读 27——**非判决相关的 harness artifact**（该 agent 自己的失败轮也是 27），记录以免被误读为跨臂相关性。**Obscura 多出一个 `run 4`（`bc=3868`，0 步），在任何 Chrome trace 里都不出现，未解释。**

**⑥ 判决位置仍未定**：`HeadlessChrome` 的失败被判定在**被追踪的 VM 程序之外**——该实验只能说"边缘按请求头拒"与"widget 内拒"**各自都足够**，无法区分是哪一边。

#### 354.52 环境事故：代理 `:9000`（Reqable）卡死 → 改走 `:8080`（mitmdump）

**现象**：某一 agent 报告 `192.168.3.57:9000` 自 ~12:11 起不可用、持续 95 分钟以上；它把此后所有轮次标为 INVALID（并加了 `location.href` 检测 + 30s 等待 + **不消耗轮次地重跑同一 index**，避免把故障记成发现）。

**我复核（三处对照）**：

| 通路 | 结果 |
|---|---|
| 远程自身 → `127.0.0.1:9000`（Reqable） | **`000` 卡死**（`netstat` 显示 `*.9000 LISTEN`、Reqable 进程在，但**监听在、不服务**） |
| 远程自身 → `127.0.0.1:8080`（mitmdump） | **403** ✓ |
| **本机 → `192.168.3.57:8080`** | **403 ✓ 可用** |

**解法**：链路本是 `客户端 → :9000 Reqable → :8080 mitmdump → CF`，而**带 ov2 注入 addon 的是 mitmdump**；CF 看到的请求本来就是 mitmdump 重发的。**绕过 Reqable 直连 `:8080` 对 CF 侧透明**（TLS 仍由 mitmdump 终结；我们本就用 `OBSCURA_INSECURE_TLS` / `--ignore-certificate-errors`，不需要换 CA）。

**已验证**：用 `:8080` 跑通一整轮实弹（五段 `/fo/` 全走完、体照常解密）。`verify_round.sh` 已改为读 `${PROXY_URL:-…}`（默认仍 9000，可覆盖）；已通知相关 agent 把 harness 与自动恢复脚本一起改到 `:8080`。

#### 354.53 请求头矩阵（部分）：目前**未发现**任何头是 CF 边缘的硬要求

**方法**：`Fetch.enable` + `requestPaused` → `continueRequest` 重写头列表，按作用域施加（`topdoc` = URL 等于目标的文档请求；`page` = 顶层会话的其它请求；`widget` = challenges.cloudflare.com OOPIF 会话）。**先做了对照**：`hdr-noop`（拦截全开但不改任何东西）**2/2 通过、生命周期 1** ⇒ 拦截本身中性。

**有效结果（每项 2 轮，用 VM 生命周期数佐证：1=通过、2=被拒）**：删掉顶层文档请求的 `sec-ch-ua` / `sec-ch-ua-mobile` / `sec-ch-ua-platform` / `Accept` —— **全部 2/2 通过**。⇒ **客户提示头族与 `Accept` 不是这条路径上的边缘要求。**

**一条限制必须带着看**：`Fetch.requestPaused` **只能看到渲染进程提供的头**；`accept-language`、`accept-encoding`、`sec-fetch-*`、`priority` 是**网络服务在其后加的**（header dump 与 "was-absent" 的 op 都证实了），**在这条路径上删不掉** ⇒ 它们"无效果"**不构成证据**。

**`hdr-noop` 观察到的正常 Chrome 请求（按作用域）**：

```
topdoc  Document  [accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, upgrade-insecure-requests, user-agent]
page    Script    [accept, referer|origin, sec-ch-ua*, user-agent]
page    XHR       [accept, cf-chl, cf-chl-ra, content-type, origin, referer, sec-ch-ua*, user-agent]
widget  XHR       [accept, cf-chl, cf-chl-ra, content-type, origin, referer, sec-ch-ua*, user-agent]
widget  Image     [accept, referer, sec-ch-ua*, user-agent]
```
线路上还有但对 Fetch 不可见：`accept-language`、`accept-encoding`、`sec-fetch-site/mode/dest/user`、`priority`。**`user-agent` 出现在每一个作用域**。**CF 自己的 `cf-chl` / `cf-chl-ra` 同时出现在 widget 的 XHR 与页面层的 XHR 上**——尚未与我们的对拍过，值得优先核。

**仍未定**：判决在**边缘**还是 **widget 内**（现在只能说"两者各自都够"）。能一次回答的实验是 `hdr-{topdoc,widget,page}-set-user-agent-headless`——**只在文档请求上注入 `HeadlessChrome`**（widget 与其它的头保持干净）：若失败⇒判决在**边缘、文档请求**上；若通过而 widget-only 失败⇒判决在 **widget 内**。

#### 354.54 **判决位置定案：在 CF 边缘、由顶层文档请求做出** + 三条硬要求 + 一个新环境判据

**方法**：`Fetch` 域在暂停请求上重写头列表，按作用域施加；基线对照 `hdr-noop`（拦截全开、不改任何东西）**10/10 通过**，故拦截本身中性。

**① 判决位置（此前悬而未决的问题，已答）**

`hdr-topdoc-set-user-agent-headless`——**只**在**顶层文档请求**上注入 `HeadlessChrome`，widget realm、widget 的所有请求、页面层所有子资源**都保持干净** ⇒ **0/5 失败（生命周期 2）**。

⇒ **裁决在边缘、从顶层文档请求做出，早于 widget 参与。**（widget-only 与 page-only 也各自足以失败，说明各作用域独立充分；但 topdoc 单独已被证明充分。）

**② 三条"删掉即败"的硬要求**（基线 10/10 通过）

| 要求 | 作用域 | 结果 |
|---|---|---|
| `/fo/` POST 带 `cf-chl` | widget | **0/4 失败** |
| `/fo/` POST 带 `cf-chl-ra` | widget | **0/4 失败** |
| **带 `Origin`** | widget | **0/4 失败** |
| **带 `Origin`** | page | **0/4 失败** |
| UA 产品标记 ≠ `HeadlessChrome` | topdoc | 0/5 失败 |

（`cf-chl`/`cf-chl-ra` 只在 `challenges.cloudflare.com/…/h/g/fo/…` 上被删；其它请求本来就没有。对照：`hdr-widget-drop-accept` 重写了**同一条带 body 的 POST** 的头列表却 2/2 通过 ⇒ `cf-chl` 的失败是这两个头特有的，不是"重写列表"造成的。`content-type` 也 2/2 失败，但从带 body 的 POST 上删它是协议破坏，**不计为证据**。）

**③ 无效果的头（边界）**：topdoc 上删 `sec-ch-ua`/`sec-ch-ua-mobile`/`sec-ch-ua-platform`/`Accept`/`Upgrade-Insecure-Requests`/`Origin`/`Priority` **全部通过**；值替换也通过（`sec-ch-ua-platform`→`"Windows"` 4/4、`sec-ch-ua`→Chrome/90 品牌、`Referer` 置空、`Sec-Fetch-Site`→`cross-site`、`Accept-Language`→`fr-FR`）。widget 与 page 上删 `Accept`/`Referer`/`sec-ch-ua*` 亦通过。

**限制（每一行都带着）**：`Fetch.requestPaused` **只暴露渲染进程提供的头**；`accept-language`/`accept-encoding`/`sec-fetch-*`/`priority` 由网络服务在其后添加，**该路径上删不掉** ⇒ 这些行全部 `was-absent`，**零结果不构成证据**。

**④ 新环境判据：`navigator.languages` 必须多项**（此前 40/40 的"环境值不是判据"出现例外）

| 干预 | 结果 |
|---|---|
| JS 改 `navigator.languages = ['zh-CN']`（头不动） | **0/5 失败** |
| JS 改 `= []` | **0/4 失败** |
| 同一个 JS getter 返回**原值** `['zh-CN','zh']` | **5/5 通过**（⇒ 不是反对"篡改"，而是读**值**） |
| CDP `acceptLanguage:'zh-CN'` / `'fr-FR'` / `'en-US'` / … | 全失败 |
| CDP `acceptLanguage:''`（no-op） | 2/2 通过 |
| 仅改 `Accept-Language` **头**为 `fr-FR`（JS 不动） | 2/2 通过 |

现有数据与"**`navigator.languages.length ≥ 2`**"一致（CDP 各取值都会把 JS 侧变成单元素 ⇒ 全败）；"仅改头通过"那一行需注意 Accept-Language 是网络服务添加的、Fetch 改不动，**该行可能本身是 no-op**。

**⑤ 我方复核（当前 binary，逐项）**：

| 要求 | 我方 |
|---|---|
| `navigator.languages` | **`["zh-CN","zh"]`**（`language="zh-CN"`）✓ |
| 同源 POST 带 `Origin` | ✓（本机 fixture 实测头列表含 `origin`） |
| `/fo/` POST 带 `cf-chl`/`cf-chl-ra` | ✓（ops.tsv 记录） |

⇒ **已发现的三条硬要求我方全部满足。** 结合 §354.51 的"环境值被 40/40 排除"，**剩余的判据仍未定位**，但**边界已收窄到：CF 边缘 + 顶层文档请求 + 尚未被测的那些属性**。

**⑥ 正常 Chrome 的发包（按端点，供交叉核对）**：`cf-chl` 在**两个** `/fo/` 端点上都带同一 token、`cf-chl-ra: 0`；widget 的 `brunhild /i/` 只带 `accept, origin, user-agent`；`/pat/` 只带 `accept, user-agent`。

#### 354.55 重建实验：09-21「5/5 通过」的代码**今天跑出的是与现在完全相同的失败**（推翻"回退"假说）

**背景（此前被整轮排查忽略的事实）**：归档里 **Step 333/334（2026-09-21）** 记载 Obscura **确实通过过**——
`final41` 首次 `POST /1.txt → 404`（1/6），修了 unhandled rejection 后 **`final44-48` 连续 5/5 通过**；
随后 **`7effb4b` 记「post-rotation 0of3 is epoch scoring」**，即 build 轮换后立刻归零，此后三天全是 0/5。
⇒ **"Obscura 从不通过"是本轮多个 agent（包括我）只看近期轮次得出的错误前提。**

**实验**：把那个提交 `184340e` 签出到独立 worktree（`/tmp/cf-passing`，独立 target，需从主树软链被 gitignore 的
`vendor/rusty_v8`），构建 16m21s，用**当年的身份**（UA 151 / hc 15 / screen 1512×982 DPR2）在今天跑 6 轮。

**结果（0/6）**：

| 轮 | 点击 | 结果 |
|---|---|---|
| o1 / d1 | 16s / 26s | 停在 TS#2（3 段 `/fo/`） |
| o24 / o30 / a1 / a2 / c1 | 24-26s | **完整流程 8 段 `/fo/`，最终仍是 `请稍候…` 插页、重开一轮** |

⇒ **同一份代码，09-21 5/5 通过、今天 0/6**，且今天的形态（8 段 `/fo/` 重试环 + 插页）**与当前 HEAD 的失败轮毫无区别**。
**「代码回退」假说被推翻**；作者当时「epoch/build 窗口」的判断**这次站得住**。

**顺带一条对后续所有排查有约束力的事实**：旧代码的日志里反复出现
**`ReferenceError: MutationObserver is not defined`**——**09-21 那个 5/5 通过的版本连 `MutationObserver` 都没实现**。
⇒ **"引擎缺陷"与"能否通过"之间没有我们一直默认的那层因果关系**；把任意一项引擎差异当作判据候选，
都必须先解释这条反例。

**未决**：窗口由什么决定。CF 的 build 轮换很快（base64 表每 ~2h 一换），但 5/5 只持续了约 10 分钟，
比一次轮换窗口短得多；**是什么在 09-21 10:4x 那十分钟里对我们有利，仍未定位**。

#### 354.56 `cf_chl_rc_ni`：CF 自己的失败标记，可当每轮的判决 oracle

用 `obscura serve --storage-dir <dir>` 落盘 cookie jar，与通过臂 Chrome 的 `cookies.txt` 对照：

| 轮次 | `cf_chl_rc_ni` |
|---|---|
| Chrome **通过**轮（headed / headed-r4 / headless-cleanua ×3） | **无** |
| Chrome **失败**轮（带 `HeadlessChrome` UA 的两轮） | **有** |
| **Obscura**（失败） | **有**（值 `1`，1 小时过期） |

⇒ **`cf_chl_rc_ni`（"Not Interested"）与判决完全对应**：出现即失败，不出现即通过。这是 CF 亲口给出的信号，
**比读页面文案（`请稍候…` vs `Missing resource /1.txt`）可靠得多**，建议从下一轮起作为每轮的辅助判据。

**其他 cookie 差异（未判明因果）**：我方还持有 `cf_clearance`@`cloudflare.com`（853 字符，一年期），
通过臂 Chrome 没有；Chrome 通过后另持有 `JSESSIONID`（32）。`cf_clearance`@`thelancet.com` 两侧都是 **597**
——与 §10.11「失败路径同样下发 cf_clearance 且可以等长」一致，故**长度不构成通过证据**。

**未定**：`cf_chl_rc_ni` 的下发**时机**。单次导航（不点击）不落 jar，且 Obscura 的 CDP 不实现 `Network.getAllCookies`
（恒返回 0），所以暂时无法在轮内分时刻观察。**若能确定它是在第一个 403 就下发**，则说明 CF 在**边缘一次**就判定了；
若在流程末段，则是失败的下游标记。这个区分对"判据在哪一层"很关键。

### Step 355：当前二进制 + `:9000`（Reqable，已恢复）+ 指定身份跑满 3 轮点击 + 1 轮不点击对照，
tracelog 覆盖全流程（1736 条 / 6 个 VM 生命周期），`cf_chl_rc_ni` 独立复现；并补一条自己踩到的测量盲区（2026-09-25）

**背景**：§354.52 记录 `:9000` 卡死、改走 `:8080`。本轮开始时**两台都换了状态**（复测：`:9000` → `200`，
`:8080` → `502`），故按用户指定改回 `:9000`。这是环境事实，不是代码差异。

**方法**（全部可复跑）：

```bash
REF_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
FP='{"language":"zh-CN","languages":["zh-CN","zh"],"hardwareConcurrency":6,
     "screen":{"width":1440,"height":900,"availWidth":1440,"availHeight":900,"deviceScaleFactor":1}}'
OBSCURA_INSECURE_TLS=1 RUST_LOG=obscura_js=debug,obscura=info \
./target/release/obscura --tracelog-file "$RUN/tracelog.jsonl" \
  serve --port 9265 --proxy http://192.168.3.57:9000 --stealth \
  --user-agent "$REF_UA" --fingerprint "$FP" --storage-dir "$RUN/storage"
python3 .claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py \
  https://www.thelancet.com/1.txt --port 9265 --deadline 42 --settle 20 --click-after 10
```

`--fingerprint` 里的 `languages` **必须显式写成两项**：只给 `"language":"zh-CN"` 时 realm 回读得到
`["zh-CN"]`（单元素），而 §354.54 ④ 已测出单元素是 0/5 的失败形态。显式给 `["zh-CN","zh"]` 后回读一致。

**① 二进制自查通过**：`RUST_LOG=info ... serve --stealth` 打印
`Stealth mode enabled (TLS fingerprint impersonation + tracker blocking)`（不是仅 `(tracker blocking)`）。

**② 三轮点击轮：3/3 仍未通过。**

| 轮 | 点击 | 终态 | `title` |
|---|---|---|---|
| 1 | t=12s，box=(192,280,300,65) → (216,313) | 停在挑战 | `请稍候…` |
| 2 | t=10s，同一 box | 停在挑战 | `请稍候…` |
| 3 | t=10s，同一 box | 停在挑战 | `请稍候…` |

点击走 `cdp_click_clean.py`：**零页面注入**，用 `DOM.getDocument(pierce=true)` 穿 closed shadow root
找到 widget iframe、`DOM.getBoxModel` 取框、`Input.dispatchMouseEvent` 下发（`isTrusted=true`）。
三轮日志都有 `widget box=… -> click at (216,313)`，点击确实下发。

**③ 一轮不点击对照（`--click-after 999`）结局相同**：同样是 `b/fo#1 → g/fo#1 → pat(401) → g/fo#2`
三次 POST 后停住。⇒ 仅凭这 4 个样本，**点击不改变结局**；这与 §B5「点击时机不是 Obscura 的 blocker」一致，
不是新证据。**该对照是单侧证据**：轮末 WebSocket 被服务端 1011 关闭，`document.title` 没取到。

**④ 请求序列（点击轮，服务端日志，`op_fetch_url` / `stealth_fetch`，时刻为轮内相对值）**：

```
+0.9s  GET  .../h/b/orchestrate/chl_page/v1?ray=…                  -> 200 (246136 B)
+1.2s  GET  challenges.cloudflare.com/turnstile/v0/b/…/api.js      -> 200 (85104 B)
+1.3s  POST www.thelancet.com/…/h/b/fo/3650149894:…                 -> 200 (106876 B)   # b/fo#1
+16.4s POST challenges.cloudflare.com/…/h/g/fo/3941058214:…         -> 200 (845884 B)   # g/fo#1
+18.2s GET  …/h/g/pat/a408624fef70d0a1/…                            -> 401 (1 B)
+18.2s GET  brunhild.challenges.cloudflare.com/…/h/g/i/…            -> 失败
+18.2s GET  …/h/g/ci/a408624fef70d0a1/…                             # Image() 路径
+22.5s POST challenges.cloudflare.com/…/h/g/fo/3941058214:…         -> 200 (127240 B)   # g/fo#2
```

轮 2 走到 6 次 POST（多出 `g/fo#3`、`b/fo#2`），并在 `[Cloudflare Turnstile] Cannot find Widget …` 之后
由**页面自己**再导航一轮（服务端日志里 `Page.navigate (id=0)`，与客户端发起的 `id=6` 可区分）。
与「被拒后重开一轮」的既有形态一致。

**⑤ tracelog：1736 条 / 6 个 VM 生命周期 / 10.0 MB（覆盖全流程）。**
本轮上游注入的是 **`vmp.deobf.0925`** 这一支（不是 `ov2.*`），键只有两个：
`vmp.deobf.0925.new`（VM 程序加载）与 `vmp.deobf.0925.exec`（执行轨迹，占 99.7% 字节）。

| 轮 | `.exec` 条数 | 程序 `(run, bc)` |
|---|---|---|
| 1 | 126 | (1, 6944) (2, 634412) (3, 95428) |
| 2 | 122 | (1, 6944) (2, 617180) (3, 95424) **(4, 3868)** |
| 3 | 123 | (1, 6944) (2, 617152) (3, 95428) |
| 4 | 126 | (1, 6944) (2, 634460) (3, 95424) **(4, 3924)** |
| 5 | 120 | (1, 6944) (2, 617120) (3, 95428) |
| 6 | 1099 | (1, 6944) (2, 617244) (3, 95428) |

`run=1` 恒为 `bc=6944`；`run=2` 在 617k/634k 两档之间摆动；**`run=4` 只在两轮出现**
（`bc=3868/3924`、`a0=0/a1=135`），与 §C4 记的「Obscura 多出的 run 4」同形。
轮 6 的 1099 条比其他轮高一个量级，成因未查（对应页面自我重开后的那一段）。

**⑥ 判决复核：`cf_chl_rc_ni = 1` 出现 ⇒ 失败。** §354.56 的 oracle 本轮独立复现：

| cookie | 域 | 长度 | expires |
|---|---|---|---|
| `cf_clearance` | `cloudflare.com` | 831 | 1821858184（一年期） |
| `cf_clearance` | `thelancet.com` | **597** | 1821858184 |
| **`cf_chl_rc_ni`** | `www.thelancet.com` | `1` | 1790325784（+1h） |

`cf_clearance`@`thelancet.com` 长度 **597** 与 §354.56 记的两侧同值一致 ⇒ 仍然只有 `cf_chl_rc_ni` 有判别力。

**⑦ 测量盲区（本轮自己踩到，应进表）**：**`--storage-dir/cookies.json` 不是实时落盘的。**
轮中途读它得到 `[]`，据此一度写成「本轮一条 cookie 都没有、拿不到 oracle」；实际是
**页关闭/进程退出时才写**。同一份数据在 `serve` 退出后读就拿到上面那张表。
⇒ cookie 相关结论**只能在轮结束、进程退出之后读**；轮内取样要么走 CDP `Network.getCookies`
（本引擎未实现 `getAllCookies`），要么不取样。

**⑧ 另记一条**：对同一 URL 走 `fetch --dump cookies`，单次导航（不点击）结束时 jar 为 `[]`。
`curl -x :9000` 显示首个 403 响应**根本没有任何 `set-cookie`**（只有 `cf-mitigated: challenge`），
所以这一格是预期行为，不是缺陷。

**结论**：本轮把「出口是 `:9000`、身份是 macOS Chrome 153 + `["zh-CN","zh"]`、点击确实下发」
三条前提固定下来，结局仍是失败；`cf_chl_rc_ni=1` 与 §354.56 一致。**未产生新的判据候选**，
§C1「剩余判据在哪」仍未决。

### Step 356：payload 明文对拍通道打通（零解密）+ 首张 0926 代分岔清单，`aQgx8` 协议级残留与 7 项 P0 实锤（2026-09-26）

**背景**：远程（`ssh l9h8@192.168.3.57`）的 ov2 研究线当天完成了 payloadJSON 逐 key 反推
（`ov2-0926-01-payload-{genchain,key-taxonomy,annotated}.md`，91 键全量语义表）。其注入链
（`:9000` Reqable → `:8080` mitmdump，`ov2_inject_enabled=true`，在线插桩件 md5 `37d5bf8b`）
把**打满插桩的 ov2.js** 发给任何客户端，widget 里的 CF 脚本会把完整 payloadJSON 明文
`console.log` 出来。obscura 的 `--tracelog-file` 通道直接接到它——**不需要解密请求体**。

**方法**（全部可复跑，30s 预算）：

```bash
RUN=/tmp/cf-goal-0926/run-b1
OBSCURA_INSECURE_TLS=1 OBSCURA_CAPTURE_FO=$RUN/fo RUST_LOG=obscura=info \
./target/release/obscura --tracelog-file $RUN/tracelog.jsonl \
  serve --port 9351 --proxy http://192.168.3.57:9000 --stealth \
  --user-agent "$REF_UA" --fingerprint "$FP" --storage-dir $RUN/storage
python3 .claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py \
  https://www.thelancet.com/1.txt --port 9351 --click-after 16 --deadline 30 --settle 12
# tracelog.jsonl 里 k=="payloadJSON" 的 v 即三段 beacon 的完整明文 JSON
```

参考件：远程 `/tmp/goal/fo{1,2,3}-payloadjson.json`（r1 会话，终端 success/token 837）+
当晚 21:25 的 `~/chrome-profile/Default/tracelog/trace.jsonl`（2-run 短流程）。
对拍脚本与台账：本机 `/tmp/cf-goal-0926/`（DIVERGENCE.md、family-diff.txt、elem-diff.txt）。

**① 判决**：`cf_chl_rc_ni=1`，失败（基线复现）。轮内 3 次 `/fo/` 完成（2370B 页面层、
4716B→822684B、88631B→127232B），第 4 次（TS#3）在 30s 截止时在途。

**② 结构面对拍（fo1/fo2/fo3 顶层）**：

| 层 | 我方 | 参考 r1 | 判定 |
|---|---|---|---|
| fo1 | 47 键 | 47 键 | 键集合+顺序全等；`WzICl1=false`、`aQgx8=0`（位置 17）双侧一致 |
| fo2 | **92 键**/38 块 | **91 键**/38 块 | 差一个 `aQgx8`；其余键顺序一致；内容键族 35/35 匹配 |
| fo3 | **94 键**/39 块 | **93 键**/39 块 | 同上，差 `aQgx8` |

块序逐会话重排（genchain 已定案：块身份=键族指纹），骨架代数
`hCfV6 == TPpkV4 - Vtvy6` 双侧 0 违例、Vtvy6 严格单调。**无缺失的测量族。**

**③ P0（协议/形态级，确定性）**：

1. **`aQgx8`**：参考侧它是 fo1-only 键（fo2 起被删除，序列化省略）；我方 fo2/fo3 残留且
   `=1`（位置 87/88）。CF 按位消费 payload 字段（payload-construction §5.1），多一个序列化键
   会把后续键整体后移——协议级分岔，当前最优先候选。
2. **`OjmeV1[118]`**：我方 `"EBlFw4[object Object]"` vs 参考 `"EBlFw4611"`——§C3 悬案的
   root cause 浮出：拼接值我方是对象、参考是 `611`。
3. **`OjmeV1[79]`**：~120 项布尔探针唯一翻转项（true vs false）。
4. **widget frame `document.referrer`**：`RotPR2` 我方 `""` vs 参考 `https://www.thelancet.com/`；
   census 的 `d.referrer` 我方落 widget-URL 桶。10.3 时代已知缺口，仍在。
5. **widget frame `crossOriginIsolated=true`**（census 桶T 我方含 `o.crossOriginIsolated`，
   参考不含）——step 53 只修了顶层，frame realm 未覆盖/回归；连带桶N 多出
   `o.SharedArrayBuffer`。
6. **`when` 属性**：参考 census 桶N 有 `when`/`d.when`/`so.when`/`s.when`，我方全无。
7. **`Pdbt7`（performance entries）**：参考 13 条 vs 我方 6 条；参考 6 条无字段条目
   `{"nPmE7":"Lcfc8"}` 我方全缺，另缺 initiatorType=link 资源条。

**④ P1/P2**（详见对拍台账）：storage.estimate 组 `ryJGE4:null`、WebRTC `XqEQ3[3]` 应 null、
video codec 表多项、`xWWV8` 激励-响应我方恒定（参考第 10 位起随机化）、`SbVZ3` 少尾部 12 项、
blk24 哈希原像（参考 `kRQwh3=sha256("0")`）、HPcn5 字体度量缺 float32 化+1px、WebGPU
`architecture` 我方 `metal-3` vs 参考 `""` + limits 38 vs 37 + powerPreference、
`maNnU6` widget 查询日志分岔（`option`×5 vs `script[nonce]`）、`DqomM2` 2 项 1-ULP、
`jyDXx2` 缺 float32 舍入、**`uGyjw9` 我方 315 vs 参考 7（当晚 Chrome=6，跨会话最稳）**。

**⑤ VM/worker 层**：`slot.snap`（Chrome 3 条/我方 0）**排除**——是远程 r20 诊断钩子，
当前在线件已无该串。worker blob 复用我方 [1,3,6] 在 0916 史料包络内。
**§C4 再审**：0916 HAR 显示 Chrome 收到第三段响应（7164→4029B 字节码）并执行出 token，
但 r1 Chrome trace 无第 4 个 `.new` ⇒ 「run4 仅我方」很可能是 Chrome 侧插桩盲区，
**在核实前不得把 run4 当我方异常修**。

**⑥ 当晚 Chrome 交叉验证**：其 payload#2 同为 92 键/39 块；顶层 DOM 走查同为
`main`/无 dir（两个 Chrome 会话一致，我方一致拿到 div+dir 变体）——插页变体差是
**稳定的客户端相关差**；`NnqX6`/`myWtu3` 会话浮动大，单独不构成分岔；Chrome 自身
payload#3 形态也逐会话变（93 键 vs 4 键），flow-shape 不是判据（B10 一致）。

**⑦ 下一步**：4 路验证 agent 并行定位（census/探针原像/事件流/DOM 走查），定位后按文件
分批修复+回归测试+commit，再以同一 30s 形态复跑判决。

#### 356.1 验证轮定案（4 路并行，全部带 fixture 实测）

- **P1-10 顶层 DOM 走查差=判决失败的下游**：`dir=ltr` 是 CF orchestrate i18n 在 t≈4s 自写
  （Step 303 已判非缺陷，本机 Chrome 同形）；参考侧 VHsEp9 的文档不是插页而是**通过后重载的
  真实页面**（`<main>`+格式化 HTML+`meta charset` 三特征）。连带归并 xDith4/lgWCE7/OaTs4/
  wTQAz9/VwLIk3/pTTI9/TjPV9/gPOK0/Vhmq4-dir。**证据**：归一化后我方收到的插页与 0916 HAR
  模板同族（只差 `cFPWv` 'b'/'g'）；obscura 解析同一字节后不加 dir 不丢元素（fixture 双向）。
- **XCvwf5 破案**：`QBlqQ3`=encodedBodySize（参考 77937=rPXg2[0].FoGsT1 精确相等）、
  `bYTbg6`=decodedBodySize（brotli 4.33x）；我方两字段同值=wreq 透明解压后 encoded 填了
  decoded 长度。`ryJGE4`=**serverTiming**（CF 头 `server-timing: <name>;dur=`，我方恒 []）。
- **Pdbt7 缺的 6 条=long-animation-frame**：Chrome 的 LoAF 进 getEntries；我方只包 timer/rAF。
- **`wopX8`=5 个 PoW worker 回复之和**（132230 逐字节精确吻合）=固定 100ms 预算内完成量
  ⇒ **我方快 2.3-3.3x**（digest 同栈结算，不跨任务边界）。
- **`when`=EventTarget.prototype.when（Observable API）**：我方实现层按过时的
  「Chrome 151 没有」oracle 故意不实现（event-target-object.js），键序模型里早就有它。
- **`uGyjw9`=引导/普查窗口 wall-clock ms**（fo1 即定型、三段恒定、负载漂移）；315 vs 7 的
  主体=frame realm 水合+每 context WebIDL sweep+跨 realm 读扇出。
- **aQgx8 写点=挑战 VM 自己**（opcode 5182:26，t≈+10s，`window.aQgx8=1`）；payload 经
  **window 自身可枚举键枚举+je 白名单**取数（trap 设不可枚举 ⇒ 91/93 键与参考全同形）。
- **blk24 四哈希原像**：sha256("433.6700134277344"/"52.94…"/"17.94…"(参考="0")/"0.0537…")
  ——确定性几何/像素统计值，极可能出自 OffscreenCanvas/WebGL 链（r10 时间线）。
- **`dsKPy6`=battery.level**（Step 303 的 0.99 人格已过期，现参考=1）。
- **select shim 泄漏**：value/options/selectedIndex 用页面可见 `querySelectorAll('option')`
  实现（6 处），被 CF 的 QSA 钩子记走。
- **`maNnU6`/`xWWV8`/`SbVZ3`**：maNnU6=select 泄漏（已修）；xWWV8 非随机性（参考 fo2/fo3
  逐字节同），判决下游；SbVZ3 我方是参考的严格子序列（少 QLaZp6 组+前置对），疑 API 面差
  的条件探针，待 COI/全局修复后复测。
- **测量盲区新增**：`--trace-api-file` 覆盖不到 widget frame；`window['qmk…']` 标记读不产生
  API trace；Object.prototype 数值面访问器引发页面 RangeError（r8 报废）。

#### 356.2 修复批次（13 项，~20 commits，全部带回归测试）

| commit | 内容 | 实弹验证 |
|---|---|---|
| `93b2899` | encodedBodySize=线上字节数（wreq/reqwest 自动解码会删 Content-Encoding/Length 头，隐身客户端自行解码并保留 wire 计数） | v1/v2/v4 payload：ebs≠dbs，比值 4.31x vs 参考 4.33x ✓ |
| `11860ac` | referrer：客户端给空串仍回退祖先链（widget referrer=""→页面 URL） | fixture 8 形态 ✓ |
| `1cc7d99`/`9c3d07d` | TextMetrics：空字形不入 ink union；对齐框过 f32（泄漏 45/10000→0） | ✓ |
| `ee49993` | supportedEntryTypes=Chrome 153 的 15 项（原 13） | census 對齐 ✓ |
| `9ad55f4`+`0ae2938` | **COI**：set_document_scope/about:blank 不再借顶层位；**跨源子帧一律不隔离**（Chrome 153 八变体全 false，allow="cross-origin-isolated" 不构成委派——FIX-6 的 true 格是 COEP 拦截错误页的测量混淆） | v2/v4 payload 桶T/桶N 干净 ✓✓ |
| `30db16b` | link rel=preload 全目的地真实 fetch+initiatorType="link" | fixture ✓ |
| `cdeec71` | battery.level=1 | payload dsKPy6 ✓ |
| `0ef7c68` | select 表面 0 次页面可见 QSA（child 走查） | maNnU6 无 option ✓ |
| `2016e62` | 8 单例 toStringTag+featurePolicy→PermissionsPolicy | ✓ |
| `295a8f4` | 移除 Chrome 153 没有的 10 全局+chrome.runtime+modelContext | ✓ |
| `87a63fc` | EventTarget.prototype.when（复用既有 Observable）+Observable.from | census 四前缀有 when ✓ |
| `1827851` | LoAF 按任务源测量（classic-script/event-listener/MessagePort/Mutation/Resize/Intersection+timer 词汇修正）；`468b490` worker 时钟量子过 fround（保持 float32 步进类，不锁死时钟） | fixture LoAF 2→6 条，invokerType 词汇=Chrome ✓ |
| `098b72e` | serverTiming 解析（27 个 oracle 头形态逐格；TAO 门） | v1 payload ryJGE4=95492（参考量级）✓ |
| `44bfb5f` | OffscreenCanvas==canvas 共享 measureText 入口 pin（否定性结论：无接线分叉；😍/🏯 不在 emoji 表无 oracle，未编造） | 1080 组 bit 级一致 ✓ |
| `c9d0b62` | worker async-op 正常结算/digest 吞吐不变量 pin（**P1 前提被配对实验推翻**：bench5 停滞=微任务风暴，真 Chrome 同形；digest 边界化会把偏差从快 2.4x 变成慢 9x 且破坏 PoW，先决条件=每-turn 成本 ≤4µs） | 防回归 ✓ |
| `d544a99` | **Deno 移出页面/worker 可见面**（词法捕获+快照帧模板符号钩子；Rust 注入点 7 处迁移；sloppy-mode 泄漏一并修） | 三 realm typeof/in 干净，引擎功能零回归 ✓ |
| （进行中） | `__bootstrap` 全局同机制隐匿 | 待验 OjmeV1[79] |

**门禁**：全 workspace release nextest 1999/1999（d544a99 树）+ `--no-default-features`
check 干净；ledger 已记。obstacle course 仓库不在本机，留待有检出的主机（多处已记 pending）。

#### 356.3 收官判决轮（2026-09-27 凌晨，新二进制）

| 轮 | 二进制 | beacon | 判决 |
|---|---|---|---|
| v1 | FIX-1~9 | 5 | fail（rc_ni=1）；XCvwf5 闭合生效 |
| v2/v4 | +FIX-11/Deno | 2（截断，~40% 瞬态） | rc_ni 缺席（判决未定型，**不构成通过证据**） |
| v3/v5/v6 | 完整流 | 5（0.5/4.2/13.6/19.0/22.5s，click@14s） | **fail（rc_ni=1）** |

**已闭合（活体 payload 复核）**：XCvwf5 三字段、COI 桶T/桶N+SAB、`when`×4、battery、
select/QSA、品牌串、多余全局、LoAF+2、link initiatorType、ebs/dbs、worker 时钟 f32。

**剩余分岔（= §C1 的当前候选池）**：
1. `OjmeV1[79]`=true（Deno 排除[v4 实测]、COI/SAB/已移除全局排除；`__bootstrap` 修复在途）
2. `aQgx8`+`OjmeV1[118]`+blk24 四哈希=OffscreenCanvas/WebGL 像素统计链（光栅化保真级，
   与 §10.13 像素墙同族；aQgx8 写点紧跟 blk24 后 0.42s=该链判定标记）
3. `uGyjw9` 288 vs 7=引导窗口 wall-clock（frame realm 水合+WebIDL sweep，Step 318 级工程）
4. `wopX8`=digest 每-turn 成本（16µs vs Chrome 1.7µs，先决条件同上）
5. `Pdbt7` 8 vs 13 残差=微任务排空段 LoAF（realm 不可见检查点）
6. 顶层 COEP 阻塞语义（Chrome 拒载 COEP 不兼容子帧，我方非隔离加载；既有记录差异）
