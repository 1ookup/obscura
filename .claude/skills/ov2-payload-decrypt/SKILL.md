---
name: ov2-payload-decrypt
description: Decrypt Cloudflare ov2 upstream payload (POST body ciphertext) back to the complete JSON plaintext. 解密 ov2 上行 payload / 抓包密文 / "/flow/ov2" 的 POST body，还原完整 JSON 明文（trace 的 payloadJSON 只有 8000 字符截断，密文才是完整数据源）。Use whenever the user says 解密抓包 / 解密 payload / 还原完整 json / payloadJSON 被截断 / 拿 ov2key 解包 / decrypt the payload / decrypt this body / cf challenge payload 解密 / 解 /flow/ov2 的 body. Also use when they hand you a captured request body file or an `ov2key:` hex and ask to decode it. 自包含：脚本与默认 key 已内置于本 skill 的 scripts/ 下，可在任意机器执行（只需 python3.9+）。
---

# ov2-payload-decrypt

把 ov2 上行 POST body（自定义 base64 密文）离线解密为**完整 JSON 明文**。2026-09-18 完成实机闭环（真实抓包 89239 字符 → 109782 字符 JSON，roundtrip 逐字节自证）。

**自包含**：解密器三件 + 默认 key/表已内置 `scripts/` —— 目标机**无需 cf5s 仓库**即可运行。

## 快速开始（一句话）

```bash
~/.claude/skills/ov2-payload-decrypt/scripts/decrypt.sh <body-file>
# 全默认值即可（内置 key + 内置表）→ 解出 /tmp/ov2-dec/payload.json
```

可选参数：`decrypt.sh <body-file> [key-hex] [ov2js-path] [out-dir]`
- `key-hex`：覆盖内置 key（key 变了时用，如垫轮换后从 console 重读）
- `ov2js-path`：给本机 `ov2.js` 路径 → 自动提表，**优先于内置表**（表随 build 轮换时的正解）

## 何时用 / 不用

**用**：用户给你一个抓包 body（文件或粘贴）要求解出明文；用户问「payload 怎么解」「为什么 console 的 payloadJSON 少了」「ov2key 怎么用」；需要核对某个 payload 的完整字段（91 键的指纹 payload）。

**不用 / 明确不可解**：**未 patch 且无同会话 trace 的第三方抓包**——key 派生自 RSA 头里的随机材料 ot，而 ot 只有 CF 私钥能恢复，数学上不可解。工具会**显式报「不可解」退出 1**，不输出猜测明文。这条边界不要绕。

## 核心原理（一句话）

```
key = ot[9*pad+40 : +16] ⊕ 垫          ← pad 从 envelope 第 129 字节读出
密文 = TEA变体( [0xFD,0x01,flag] ++ deflate( [0x20]++JSON++[0x20] ) )
body = 自定义base64( RSA头(128B) ‖ padLen(1B) ‖ 密文 )
```

**固定 key patch**（仓库 `extract_ov2_js.py` 每轮 build 自动施加）：覆写 `ot[40..118]` 为 9 周期常量 ⇒ 任意 pad 派生**同一把 key**，并在 key 派生处注入 `console.log("ov2key:", <hex>)`。垫（QBLZ6 常量 `sGabkxvHwYuNfTtN`）跨 build 未轮换 ⇒ **key 跨 build 稳定**（当前 `0954fd23…`，已内置）。

## 前提条件

1. **body 文件**（必需）：从抓包工具（Reqable :9000 / mitmweb）导出该会话 POST 请求（目标 `challenges.cloudflare.com/cdn-cgi/challenge-platform/.../flow/...`）的 **raw body**——一长串自定义 base64，存为纯文本文件，无 JSON 包装/多余空白。
2. **python3.9+**（必需；纯标准库，无需第三方包）；有 `uv` 则自动走 `uv run`。
3. **（推荐）注入链路在线**——用于：① 拿到/复核 key（console `ov2key:`）② 观察 payloadJSON 完整输出 ③ 拿到新 build 的表。链路：`Chromium → :9000 Reqable → 上游 :8080 mitmweb(-s mitm_inject_ov2_addon.py)`，且 `chanllenge/ov2/ov2.js` 为 patched 版（`grep -c '/\*__OV2FIXEDKEY__\*/' ov2.js` = 1、`grep -c 'window.__OV2FIXEDKEY__' ` = 0）。
   10 秒判定注入是否生效：
   ```bash
   WID=$(python3 -c "import random,string;print(''.join(random.SystemRandom().choice(string.digits+string.ascii_lowercase) for _ in range(5)))")
   curl -sk --proxy http://127.0.0.1:8080 "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/av0/rch/$WID/0x4AAAAAAADnPIDROrmt1Wwj/light/fbE/new/normal?lang=auto" | grep -c __OV2FIXEDKEY__
   # 期望 1；0 = 注入没生效（见故障排查）
   ```

## 三步闭环

1. **取 key**：过一轮挑战 → 浏览器 console 的 **iframe context**（`challenges.cloudflare.com`）看 `ov2key: <32hex>`（同会话多次输出相同）。**若 key 仍是内置的 `0954fd23…`，第 2 步可直接用默认值。**
   备选：`--trace trace.jsonl`（取最后一条 keyQBLZ6.after，候选全列）；`--ot-hex` + `--mask-hex 734761626b7876487759754e6654744e`（垫）。
2. **取 body**：从抓包工具导出 raw body 存文件。
3. **解密**：`scripts/decrypt.sh body.txt`（默认 key+表）→ `/tmp/ov2-dec/payload.json` = 完整 JSON 明文 + 分层 dump（envelope/cipher/compressed/framed）+ roundtrip 自证。

## 自包含与移植

```
~/.claude/skills/ov2-payload-decrypt/
├── SKILL.md
└── scripts/
    ├── decrypt.sh            # wrapper：内置默认 key/表；可覆盖；uv 缺失自动落 python3
    ├── ov2_payload_codec.py  # 解密器（CLI 全参数见下节）
    ├── ov2_crypto.py         # 原语（TEA 变体正逆/H 基流/D 轮密钥/自定义 b64/QBLZ6）
    └── ov2_builds.py         # build 注册表 + 表提取
```

- **打包到其他机器**：
  ```bash
  tar czf ov2-payload-decrypt.tar.gz --exclude='__pycache__' -C ~/.claude/skills ov2-payload-decrypt
  ```
  → 目标机解包到 `~/.claude/skills/`（或任意目录直接跑 `scripts/decrypt.sh`）。**依赖仅 python3.9+**（有 uv 自动走 uv）。`--exclude='__pycache__'` 别省：那是本机运行产物，不该进包（实测未排除时会把 `.pyc` 打进去）。
- **内置默认值（2026-09-18 实测）**：
  - key = `0954fd238920cb4e832366d227b62cf3`（= W 常量窗口 `7a139c41e258bd06f47a139c41e258bd` ⊕ 垫；垫不变则跨 build 稳定）
  - 表 = `zg8x2HkFDVWAOyj6-ibGa3KRpXIC7Q4YMLB+Tnmqc1wNvrP5fS0sduJ$tUelZhoE9`（**随 build 每 ~2h 轮换**）
  - 垫 = `734761626b7876487759754e6654744e`（sGabkxvHwYuNfTtN，仅 ot 路线用）
- **表过期的症状与处置**：报「字符不在表中」/ 表指纹不匹配 ⇒ ① 传 `ov2js-path`（本机有注入链路时最省事）② 用仓库 `tools/ov2_builds.py` 的提取逻辑自 ov2.js 取新表并更新 wrapper 的 `DEFAULT_TABLE` ③ `--alphabet '<65字符>'` 显式给。
- **来源版本**（与本 skill 副本核对用）：仓库 commit `8e9be93`；三件与仓库 `chanllenge/ov2/tools/` 同 md5 —— `ov2_payload_codec.py` `d3a191113c083dee36cad76a7015e66b`、`ov2_crypto.py` `44922281cd71cf064bc3a5518338c04d`、`ov2_builds.py` `8ed5ea1e394e5743673f0092f85fe2c3`。仓库版更新后副本会落后，可用这组 md5 判断。

## 命令参考（`ov2_payload_codec.py` 直调）

| 参数 | 说明 |
|---|---|
| `--body-file PATH` / `--body-stdin` | body 来源（二选一） |
| `--key-hex HEX` | 16 字节 baseKey（console 的 `ov2key:`）——主路线，不需要垫 |
| `--ot-hex HEX` / `--ot-window HEX` | 从 ot（128B）或固定窗口（79B）推 key，需配 `--mask-hex` |
| `--trace PATH` | 从 trace.jsonl 取 keyQBLZ6.after（取最后一条，候选全列） |
| `--alphabet STR` / `--ov2js PATH` / `--build NAME` | 表来源三选一；`--ov2js` 对未登记 build 按「这层是否需要垫」分层放行 |
| `--mask-hex HEX` | 垫（ot/window 路线必需） |
| `--out-dir DIR` | 落 envelope.bin / cipher.bin / compressed.bin / framed.bin / payload.json |
| `--roundtrip` | 解密后重建密文比对（**建议总是带上**，逐字节相等才自证通过） |
| `--print json\|all` | 输出粒度 |

**退出码**：`0` 全链成功；`1` 不可解（缺 key / magic 校验失败 = key 不对）；`2` 输入或参数错。

## 故障排查

| 症状 | 原因 | 处置 |
|---|---|---|
| exit 1「magic 校验失败」 | key 与该 body 不属同一会话/build | 从该会话 console 重取 key；或 `--trace` 用**同会话** trace（候选里换一条） |
| 「字符不在表中」/ 表指纹不符 | 表随 build 轮换、内置表过期 | 传 `ov2js-path` 或更新 `DEFAULT_TABLE`（见「自包含」节） |
| 「表未登记」（提示行） | 线上表未进 BUILDS | **key-hex 路线无需处理**；ot 路线需 `--mask-hex` |
| console 无 `ov2key:` / payloadJSON | ①mitmweb 实例没在执行注入 ②ov2.js 非 patched | 先跑上面 curl 探针；marker=0 → 重启 mitmweb（`-s` 用绝对路径）；再查 `__OV2FIXEDKEY__` 注释计数 |
| 探针 marker=0 但刚重启过 | addon 加载失败 | 看 mitmweb **启动终端前 10 行**；对照 `~/.mitmproxy/` 无 config.yaml、cwd 正确 |
| 同一 payload 两次密文不同 | 会话**未** patch（ot 随机） | 确认走注入链路；patched 会话密文固定 |

## 边界与纪律

- **不可解边界**：未 patch 且无 trace 的第三方抓包只能解到 envelope 层（工具会明说）。
- **key 的时效**：内置 key 在「垫不变 + patch 的 W 常量不变」时跨 build 稳定；**每轮 build 后复核一次** `ov2key:`（变 ⇒ 传新 key 给 wrapper）。
- **隐私**：body 与解出的 JSON 是**用户真实会话数据**——不要写入仓库、不要外发；留存需征求用户意见。
- **配套文档**（仓库侧）：`chanllenge/ov2/ov2-payload-offline-decrypt.md`（完整链路/验证/R6 步骤）、`chanllenge/ov2/tools/README.md`（md5 表 + `check_md5.py` 闸门）。
