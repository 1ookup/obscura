# CF 挑战 payload 构造说明

> **知识库定位**：本文描述的是**静态求解路线**——不执行 JS/VM，由独立求解器
> （Rust）直接构造并提交 payload。文内 `文件:行号` 引用（`vm_parser.rs`、`task.rs`、
> `task_client.rs`、`waf_task.rs`、`reverse/` 及 `docs/update-0616.md` 等）均指向
> 那个求解器仓库，不在 obscura 本仓库内，仅作机制溯源；对照本仓库时以机制为准，
> 不以行号为准。引擎真执行路线（Obscura 自身跑赢挑战）见
> [Cloudflare-challenge-profile.md](Cloudflare-challenge-profile.md)，两条路线互补。

静态求解器不执行 JS/VM，最终提交的 payload 是 Rust 直接填表的产物。本文记录完整链路：
**key 提取 → JSON 构造 → 压缩加密 → POST 提交**，以及各环节的**构造约束**
（违反任何一条 → 400 或被 flag）。

## 1. 整体结构

```
顶层 payload（serde_json::Map, preserve_order）
├── 公共键：entries_count / prev_count / chl_dyn / turnstile_u / worker blob / NlRV3 尾部键组…
└── "1".."N"：指纹条目格子（每格一个对象，顺序 = 真实浏览器采集顺序）
```

提交前序列化 → LZ 压缩 → RSA 派生 + XTEA 加密 → 自定义 base64（§6）。

## 2. 条目内部结构（每格固定骨架 + 条目特有对）

每个条目按固定顺序填入（`vm_parser.rs:120-177` `make_vm_payload_entry`）：

| # | 槽位 | 当前硬编码键名（b/7c8a194018aa） | 值来源 |
|---|------|------|--------|
| 1 | fp_id | `UWzOy4` | 字节码字面量（case 签名 token，含 `-ts-1.2.1.1-`） |
| 2 | fp_unknown | `COOTO5` | 字节码字面量（token，`-1.3.1.1-`） |
| 3 | fp_unknown_2 | `PgMzZ7` | 字节码字面量 |
| 4 | fp_stage | `wwpZ5` | 常量 `3`（`generate_parse_status`，PC 恒成功） |
| 5 | fp_unknown_3 | `BXxp5` | 常量 `""`（pow_click 分支跳过） |
| … | 条目特有对 | 各 Entry 各异 | 见 §3.4 |
| 尾1 | start ts | `sgcb2` | 计算：`max(prev_end+1, now)` |
| 尾2 | end ts | `IEjuB2` | 计算：start + timing |
| 尾3 | 耗时 | `ZauiY3` | 随机：各条目类型有自己的区间 |

> 样本中另一版本的键名对照：`pafm1`=fp_id、`uwPn4`=fp_unknown、`IEyJ3`=fp_unknown_3、
> `Vtvy6`/`TPpkV4`/`hCfV6`=时间戳三件套。版本滚动即全换（§5 约束 8）。

## 3. key 的提取

键名无一是猜的，全部来自脚本/字节码，分五个来源：

### 3.1 挑战页参数（`challenge.rs` / `cf_chl_opt.rs`）

正则定位 `window._cf_chl_opt = {...}` 块，**按位置索引**逐个提取字段
（cType / cvId / cRay / ch / time / md / chlApiSitekey…）。字段数随版本漂移，
0616 版整体后移——这是每次版本适配的必查项。

### 3.2 初始 payload 键名（`parser/payload.rs` `PayloadKeyExtractor`）

在反混淆后的主脚本 AST 上收集**有序**的 `l8["k"]=v` 赋值序列，产出：

- `initial_keys`：初始 payload 的键名有序表（新版对象字面量形式由
  `expand_payload_object` pass 展开回逐条赋值后收集）；
- `initial_keys_values`：脚本里这些键自带的初值；
- `initial_obj_keys` / `last_key` / `browser_keys_key` 等。

`InitPayloadKeys::new`（`keys.rs:57-108`）把这串键名**按固定语义顺序逐位消费**
到 45 个槽位（cType、cvId、entries_count、perf、user_input、chl_dyn、
site_key、action、c_data、u、url…）。位次即语义——脚本键序一变即全错。

### 3.3 条目头部 8 键（硬编码）

原始设计是从 case 头部字面量按位提取（机制 A），0616 后提取结果被丢弃，
`vm_parser.rs:448-458` 直接返回硬编码 8 键（UWzOy4/COOTO5/PgMzZ7/BXxp5/
wwpZ5/sgcb2/IEjuB2/ZauiY3），版本轮换时人工换表（旧表见 docs/update-0616.md:50-61）。

### 3.4 条目内部键（锚点 + offset，仍在自动适配）

`get_string_at_offset`（`entries/mod.rs:204-220`）：在 VM 字符串表里找明文锚点，
按相对偏移取键名。示例：

| 锚点 | offset | 取到的键 | 写入的值 |
|------|--------|------|------|
| `var n=self.navigator;postMessage({ ` | -3 / -2 | message_result / message_object | `0` / navigator 对象 |
| `location` | -1 | location_href | `true` |
| `onchange` | -1（撞 `"document"` 回退 -2） | document lengths | `[0,0,0,0]` |
| `onload` | +1 / +2 | events / title | `["object"×6]` / `true` |
| `revokeObjectURL` / `terminate` | +1 / -1 | worker blob URL / worker 对象 | `blob:https://{zone}/{uuid4}` / `{}` |

Worker 模板被拆成多段字符串时，从含 `postMessage({` 的段拼到含 `});setTimeout`
的段重建，再解析出内部键名与顺序（`browser_data.rs:46-85`）。

### 3.5 值的三种命运

1. **字面量/常量**（占大头）：token、stage=3、`""`、`0`、`21`（static_value.rs:104）、
   `[0,0,0,0]`、`["object"×6]`、worker 计时 `0.09999...`、顶层 8 key 值等——直接写死；
2. **指纹档案顶包**（真实浏览器要现场测的）：platform / languages / hardwareConcurrency /
   deviceMemory / userAgent → 取自本地伪造的 Chrome 指纹档案；
3. **编造但需连贯**（时间敏感值）：时间戳三件套、各条目随机耗时。

## 4. JSON 构造到 POST 提交全流程

```
[0] 下载  GET /cdn-cgi/challenge-platform/h/{branch}/orchestrate/chl_api/v1?ray=…
          （task_client.rs:173，rquest Chrome136 TLS 指纹）
     ├─ 挑战页正则提取 _cf_chl_opt（cRay/ch/sitekey…）
     └─ deobfuscate(orchestrate) → parse_script_interpreter → 反汇编 bootstrap VM
        → PayloadKeyExtractor 提键 → InitPayloadKeys 逐位消费

[1] POST1 init   body = compress(build_init_payload)
     ├─ build_init_payload（task.rs:879-909）：chl_opt 值 + 常量
     │   （perf=2/27/27、counts=0、unknown_3=1）+ 脚本自带初值 + encrypted_entry 8 元组
     ├─ URL: /cdn-cgi/challenge-platform/h/{branch}/flow/ov1{init_arg}/{c_ray}/{ch}
     │   （task_client.rs:341-344；init_arg 是 VM 里的正则形常量）
     └─ 响应 = (性能采样, 加密的 main VM 字节码, init_url)

[2] 解密 main VM     decrypt_cloudflare_response（§6.3），再反汇编 → parse_vm
     → extract_entries（case 三循环）+ SIGNAL_PATTERNS 语义映射 → 40+ 条 FingerprintEntry

[3] POST2 main   body = compress(build_second_payload)
     ├─ 逐条 make_vm_payload_entry 填 "1".."N" 格子（shift_insert 按位）
     ├─ 尾部：chl_dyn / turnstile_u / encrypted_entry / worker blob / LKUs2 / NlRV3 键组
     ├─ URL: /cdn-cgi/challenge-platform/h/{branch}{post_url_path}
     │   （post_url_path 取自 VM 字符串表里的 "/flow…" 串，task.rs:443-450）
     └─ 响应 200 文本 = 加密 response VM → read_encoded_vm → extract_turnstile_result 取 token

[4] POST3（仅 interactive/managed）再 parse_vm + 填表 + compress → post_payload 同 [3]
```

HTTP 细节（`task_client.rs:401-427`）：`Content-Type: text/plain;charset=UTF-8`，
头序固定，带 `cf-chl` / `cf-chl-ra: 0` / `Origin` / `Sec-Fetch-*` / `Referer` /
`Priority: u=1, i`；body 就是密文字符串，无 JSON 包装。

## 5. 构造约束（重点）

1. **键序即协议**。CF 的 VM 按*位置*消费 payload 字段，不是按名字查。顶层格子顺序、
   尾部键顺序必须与真实抓包逐位一致。序错 → 400。
2. **保序操作纪律**。serde_json 开 preserve_order：插入用 `shift_insert(下标,…)`
   （task.rs:362-366）；删除**必须** `shift_remove`——普通 `.remove` 是 swap 删除，
   会把末尾键甩飞（NlRV3 修复的教训，task.rs:694-767）。
3. **尾部键按抓包顺序配对**。`remove(0)` 从队首逐个弹出、两个一组写成键值对；
   `NlRV3` = 其后所有"cookie 名形态"串（含 `_` 或长度 <4），无则空数组。
   WAF 流程 `NlRV3` 固定 `[]`（实测 `[]` 75/75 成功，带值 15/15 全失败，waf_task.rs:266-269）。
4. **头部键名跨条目一致**。所有条目共用同一套 fp_* 键名，不一致说明解析错位，直接 bail。
5. **时间戳链必须连贯**。fp_start = max(上一条 end+1, now)；fp_end = start + timing；
   timing 用各条目类型固有权重区间（如 document 4..=5、worker_timing 10..=25、
   canvas 150..=250）。整体表现为真实采集的递增时间线。
6. **数组是位置语义**。数组第 i 个元素含义定死：`click_user_input=[0,67,2,0,67,1,0,137]`、
   performance 18 值（3 个一组循环 + 噪声）、encrypted_entry 8 元组等，错一位即串位。
7. **计数同步**。entries_count 提交前 = 旧值 + 本阶段条目数，prev_count 记录旧值
   （task.rs:311-333）；interactive 分支的 `TmRbu7` 会被位置消费污染，需手动改回数字。
8. **版本轮换清单**。每次 CF 更新需人工核对：`_cf_chl_opt` 字段索引、初始键位序
   （PayloadKeyExtractor）、8 个头部键名（vm_parser.rs:448-458）、顶层 8 key 值、
   rsa mask `XAO_P6_MASK`、SIGNAL_PATTERNS 特征串、version.json。
   锚点排布不变时 §3.4 自动适配；§3.2/§3.3 的位序与硬编码必换。
9. **未知即失败**。BrowserData 只认 5 个 navigator 属性，Worker 模板拼不齐/属性名陌生
   直接 bail——宁可失败不可交错表。
10. **格式可验、内容不可验**。blob URL 只需格式合法（CF 回读不了 blob 内容）；
    worker 对象写 `{}`；`window.name` 恒 `""`。凡 CF 服务端无法回读的，伪造即可；
    凡参与哈希/签名的（token、时间戳链），必须真实或连贯。
11. **密文不可复现约束**。每次 `compress` 重新随机 128 字节（compress.rs:13），
    同一 JSON 两次加密结果不同——不要缓存密文，且随机字节派生参数
    （`random_bytes[0]=0`、key index=padding*9+40）必须与 CF 派生算法逐位一致。

## 6. 压缩与加密流程（`reverse/`）

### 6.1 encrypt_payload（`rsa_encryption.rs:17-51`）

输入：JSON 字符串 + charset（自定义 base64 表）+ 128 随机字节。

1. `random_bytes[0] = 0`（派生算法需要）；
2. **LZ 压缩**：`lz_compress`（`lz.rs`）——LZW 变体，字典码从 2/3 起、
   位宽自适应、16 位累加器写位流；
3. **补齐**：尾部补 0 到 8 的倍数，记录 padding 数（0..8）；
4. **RSA 派生包头**：random_bytes 视作大整数，`^65537 mod N`
   （1024 位公钥硬编码于 `:108-113`），得 128 字节 derived 写入输出头
   ——CF 用私钥解开即可还原 random_bytes，从而派生出同一把 XTEA key；
5. 追加 1 字节 padding 值；
6. **XTEA key 派生**：取 `random_bytes[padding*9+40 .. +16]` 共 16 字节，
   逐字节 XOR `XAO_P6_MASK`（16 字符版本常量，0616: `ENdhiMvjWPEYrXrp`；
   旧版 `kzaFIqgowZmeSoka`，版本滚动必换）；
7. **分块加密**（`turnstile_xtea :57-81`）：对每个 8 字节块 i，先用 XTEA(key)
   加密两个全零块（末字节分别为 i、i+1）拼成 16 字节*块密钥*，再 new 一个
   XTEA 实例用该块密钥加密数据块——每块独立密钥；
8. **自定义 base64**：charset 取自 VM 字节码里的 65 字符压缩字符表
   （`parser/vm.rs` 提取，含 `$ - +`），取前 64 字符、无 padding（`:86-92`）。

入口 `Compressor`（`compress.rs`）：每次 `compress()` 重新随机 128 字节。

### 6.2 上行密文形态

三次 POST 的 body 都是 `Compressor::compress(serde_json::to_string(&payload))`
（task.rs:221 / 277 / 437），WAF 流程同构（waf_task.rs:85 / 311）。

### 6.3 下行解密（`encryption.rs`）

- **main VM 解密** `decrypt_cloudflare_response`（`:47-69`）：key = `"{c_ray}_0"`，
  `h` = key 全字节异或 32；解密公式
  `dec = ((byte - h - i%65535) mod 255 + 255) mod 255`——是**减法流**不是 XOR，
  i 取全局下标（每 65535 归零）。
- **CloudflareXorEncryption**（`:3-45`）：key = `c_ray[0..3] + xor_key + c_ray[3..]`
  （xor_key 取自含 `"cp-n-"` 的函数 values[2]，task.rs:1030-1053），
  循环 XOR + 标准 base64。**当前主流程未启用**（task.rs:249 已注释）。

## 7. 条目 → Entry 映射速查

| 特征 | Entry | 样本例 |
|------|-------|--------|
| `postMessage({` + navigator 属性 | BrowserData（Worker navigator） | 条目 1（zIyO8 五件套） |
| 无特有对 + `21` | StaticValue | 条目 2（qAxn4:21） |
| `onchange`/`onload` 锚点 | DocumentObjectChecks | 条目 18（uyQdN2/FigOh5/YqJb8） |
| `relatedTarget` | POWClick | — |
| `the force is not strong with this one` | POW | — |
| `readPixels`+`toDataURL` | Canvas | — |
| `performance.now();`+`postMessage` | WorkerPerformanceTiming | — |
| 完整表见 `vm_parser.rs` SIGNAL_PATTERNS（40+ 条） | | |
