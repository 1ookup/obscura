#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ov2 payload 离线解密 —— 密码学原语层（纯标准库 / Python 3.9 兼容）。

本模块只放「可独立单测」的原语：TEA 变体分组密码、基流、轮密钥调度、自定义
base64、QBLZ6 固定垫 XOR、hex 辅助。链路编排见 ov2_payload_codec.py。

源码基准（**必须共用同一份冻结件**）：
  ov2-0916-11.pristine.js  md5=6ee30699f97b3e6ab29e7a4b95661187  12908 行
其余 build 的对应函数常量一致、只是标识符/字符串表被重新混淆，故：
  - 本模块**不含任何 0916-11 专有的标识符或字符串表索引**（表索引每 build 变）；
  - 所有常量（DELTA、轮数、选择子位宽）都从下面标注的源码行逐字抄出。

── 逐行源码复核（行号 = 上述 pristine 件）────────────────────────────
H  基流        L5179-5239   函数 H(K,R,UM,Ud, Uk,Ur, ...)
  L5219-5220  Uf=helper map, UX=0, UG=0; UG<32;
  L5220-5227  Ug = 3.42 & UX          -> ToInt32(3.42)=3  -> Ug = UX & 3
  L5221-5227  out[Ur++] = (UX + T[Ug]) >>> .11
              其中 T = [K,R,UM,Ud]（L5223-5226 三目链），`>>> .11` 的 .11
              ToUint32 -> 0，即 `>>> 0`（ToUint32）
  L5228       UX = (UX + 2654435769) >>> 0
  L5229       Ug = AND(SHR(UX,11), 3) = (UX>>>11)&3   ★ 是 11 不是 14
  L5230-5237  out[Ur++] = (UX + T[Ug]) >>> 0
  => 每轮 2 个 word，32 轮 = 64 word。第二个选择子用**自增后**的 UX。
D  轮密钥调度  L3623-3670   函数 D(K,R,UM,Ud, ...)  K=stream, R=blockIdx,
                             UM=输出数组, Ud=输出偏移
  L3661       Uf=0(游标) UO=0(累加器a) UX=R(累加器b) Ug=0(轮计数)
  L3662-3664  32 轮: UO += (((UX<<4)^(UX>>>5)) + UX) ^ K[Uf++]
                     UX += (((UO<<4)^(UO>>>5)) + UO) ^ K[Uf++]
              （`A + B ^ C` 结合序：+ 紧于 ^；`4.49`->4，`5.81`->5）
  L3665       二段种子: UO=0, UX=(R+1)&255   （R=blockIdx；`255.69`->255）
  L3666-3668  二段同式，但 K 游标 Uf 归 0 重用同一条基流
  L3669       H(Ug, UG, UO, UX, UM, Ud)  -> 用 [一段a,一段b,二段a,二段b] 出 64 轮密钥
P  分组加解密  L6493-6635   函数 P(K,R,UM,Ud,Uk,Ur, ...)  K=输入字节数组,
                             R=字节偏移, UM=基流, Ud=轮密钥表, Uk=输出数组
  开关串 = Kl(1475).split('|') = `12|2|13|6|7|8|9|3|5|10|0|11|1|4`
  （已用 tools/strtab_0916_11.py 的 derotate(261 次旋转) 从该 pristine 件实测解码）
    case12 L6624  Up = (UG = 255 & R>>>3.72, ADD(UG,64))    -> (blockIdx&255)*64
    case2  L6584  rk[Up] === undefined && D(UM, UG, Ud, Up) -> 惰性建轮密钥
    case13 L6627  UM = BE32(K[R..R+3])                      -> v0
    case6  L6595  K  = BE32(K[R+4..R+7])                    -> v1
    case7  L6604  32 轮（步进表达式，空体 for）:
                  UM += (((K<<4)^(K>>>5)) + K) ^ rk[Up++]
                  K  += (((UM<<4)^(UM>>>5)) + UM) ^ rk[Up++]
    case8/9/3/5   out = BE32(v0) 的 4 字节（>>>24, >>>16&255, >>>8&255, &255）
    case10/0/11/1 out = BE32(v1) 的 4 字节
    case4  L6590  return
  => 输出 = BE(v0) ‖ BE(v1)，块长 8 字节；块序号复用 (R>>>3)&255（模 256 回绕）
Q  压缩封装    L11461-11474 函数 Q(K) -> [253, 1, flag] ++ (flag ? deflate(K) : K)
O  deflate     L137-1327（自研 deflate，未逐行读；实测为 raw deflate / -15，
               见 ov2_payload_codec.decompressPayloadFromCompressed 的正反两向证据）
c9 base64      L542-601   自定义表、无填充；余 1/2/3 字节分别 emit 2/3/4 字符
  L586-599     char = X[(v>>>18)&63], X[(v>>>12)&63], X[(v>>>6)&63], X[v&63]
               尾部：余1 -> X[(R>>18)&63], X[(R>>12)&63]（R=byte<<16）
                     余2 -> X[(R>>18)&63], X[(R>>12)&63], X[(R>>6)&63]（R=b0<<16|b1<<8）

── JS 语义坑（已在实现中显式处理）──────────────────────────────────
1) `<<` / `>>>` / `^` / `&` / `|` 在 JS 里是 ToInt32/ToUint32 语义（结果可负），
   而 `+` 是双精度加法。Python 侧统一用「模 2**32 的无符号整数」表示，
   加法后再 & M32；这对 `a + (b^c)` 一类表达式与 JS 逐位等价
   （负数与它的补码在模 2**32 下同余）。
2) 源码里的小数字面量在按位运算中先 ToUint32/ToInt32：
   `4.65`->4、`5.19`->5、`3.42`->3、`255.69`->255、`.11`->0、`4.49`->4、
   `16.7`->16、`255.1`->255、`3.72`->3（本模块的常量已按此写死为整数）。
3) `qblz6` 是 XOR，加密方向与解密方向同为异或。
"""

from typing import Dict, List, Optional, Tuple

__all__ = [
    "M32", "DELTA", "STREAM_WORDS",
    "base_stream", "round_keys", "block_encrypt", "block_decrypt", "tea_ecb",
    "b64_decode", "b64_encode", "qblz6", "bytes_to_hex", "hex_to_bytes",
]

#: 32-bit 掩码（JS ToUint32 的等价物）
M32 = 0xFFFFFFFF
#: H()/D() 的 LCG 增量（源码字面量 2654435769）
DELTA = 2654435769
#: H() 输出的 word 数（32 轮 × 2）
STREAM_WORDS = 64


# ── 内部工具 ────────────────────────────────────────────────────────
def _f(x):
    """轮函数 `(((x<<4) ^ (x>>>5)) + x)`（源码 L3663/3664/6605/6608）。

    注意：JS 里 `(x<<4)` 是 ToInt32、`(x>>>5)` 是 ToUint32，`+ x` 是普通加法。
    本式在 Python 中用无符号模 2**32 表示，结果与 JS 逐位一致。
    """
    return ((((x << 4) & M32) ^ (x >> 5)) + x) & M32


def _be_words(b, nwords):
    need = 4 * nwords
    if len(b) != need:
        raise ValueError("需要 %d 字节，实得 %d" % (need, len(b)))
    return [int.from_bytes(b[i * 4:i * 4 + 4], "big") for i in range(nwords)]


def _stream_from_words(k):
    """H() 主体：给定 4 个 word，产出 64 word 基流。"""
    out = []
    x = 0
    for _ in range(STREAM_WORDS // 2):
        out.append((x + k[x & 3]) & M32)          # L5220-5227, Ug = x & 3
        x = (x + DELTA) & M32                     # L5228
        out.append((x + k[(x >> 11) & 3]) & M32)  # L5229-5237, Ug = (x>>>11)&3
    return out


def _schedule_half(stream, seed):
    """D() 的半程（32 轮），返回 (累加器a, 累加器b)。"""
    a0, a1, p = 0, seed & M32, 0
    for _ in range(32):
        a0 = (a0 + (_f(a1) ^ stream[p])) & M32   # L3663
        p += 1
        a1 = (a1 + (_f(a0) ^ stream[p])) & M32   # L3664
        p += 1
    return a0, a1


# ── 原语 ────────────────────────────────────────────────────────────
def base_stream(key16):
    """H(key16) -> 64 个 32-bit word 的基流（源码 L5179-5239）。

    key16 = 16 字节密钥材料；按大端切成 4 个 word，即 H 的 (K,R,UM,Ud)。
    """
    if len(key16) != 16:
        raise ValueError("base_stream 需要 16 字节密钥，实得 %d" % len(key16))
    return _stream_from_words(_be_words(bytes(key16), 4))


def round_keys(stream, block_idx):
    """D(stream, block_idx) -> 64 个轮密钥（源码 L3623-3670）。

    block_idx 会按源码 `(R>>>3)&255`（L6624）取模 256；同一 stream 下
    模 256 同余的块序号共用同一组轮密钥。
    """
    if len(stream) < STREAM_WORDS:
        raise ValueError("stream 至少需要 %d 个 word，实得 %d"
                         % (STREAM_WORDS, len(stream)))
    b = int(block_idx) & 255
    c0, c1 = _schedule_half(stream, b)          # L3661-3664 一段，种子 = b
    a0, a1 = _schedule_half(stream, (b + 1) & 255)  # L3665-3668 二段，种子 = (b+1)&255
    return _stream_from_words([c0, c1, a0, a1])  # L3669 H(一段a,一段b,二段a,二段b)


def block_encrypt(v0, v1, rk):
    """P 的加密方向：32 轮，返回 (v0, v1)（源码 L6604-6609）。"""
    if len(rk) < 64:
        raise ValueError("rk 至少需要 64 个轮密钥")
    v0 &= M32
    v1 &= M32
    for r in range(32):
        v0 = (v0 + (_f(v1) ^ rk[2 * r])) & M32
        v1 = (v1 + (_f(v0) ^ rk[2 * r + 1])) & M32
    return v0, v1


def block_decrypt(v0, v1, rk):
    """P 的逆向（轮序倒放）：返回 (v0, v1)。

    正向：v0 += f(v1)^rk[2r]; v1 += f(v0)^rk[2r+1]
    逆向：先减 v1（用到的是**正向当轮更新后**的 v0，故倒序时先还原 v1）
    """
    if len(rk) < 64:
        raise ValueError("rk 至少需要 64 个轮密钥")
    v0 &= M32
    v1 &= M32
    for r in range(31, -1, -1):
        v1 = (v1 - (_f(v0) ^ rk[2 * r + 1])) & M32
        v0 = (v0 - (_f(v1) ^ rk[2 * r])) & M32
    return v0, v1


def tea_ecb(data, stream, encrypt):
    """TEA 变体 ECB：每 8 字节一块，块序号 = 字节偏移 // 8。

    encrypt=True -> 加密（block_encrypt），False -> 解密（block_decrypt）。
    返回等长 bytes。轮密钥按 `block_idx & 255` 记忆化（源码 L6584 的惰性建表
    语义：同一基流下，模 256 同余的块共用一组轮密钥）。
    """
    if len(data) % 8 != 0:
        raise ValueError("数据长度必须是 8 的倍数，实得 %d" % len(data))
    out = bytearray(len(data))
    cache = {}  # type: Dict[int, List[int]]
    for i in range(0, len(data), 8):
        idx = i >> 3
        b = idx & 255
        rk = cache.get(b)
        if rk is None:
            rk = round_keys(stream, idx)
            cache[b] = rk
        v0 = int.from_bytes(data[i:i + 4], "big")
        v1 = int.from_bytes(data[i + 4:i + 8], "big")
        if encrypt:
            v0, v1 = block_encrypt(v0, v1, rk)
        else:
            v0, v1 = block_decrypt(v0, v1, rk)
        out[i:i + 4] = v0.to_bytes(4, "big")
        out[i + 4:i + 8] = v1.to_bytes(4, "big")
    return bytes(out)


def _normalize_alphabet(alphabet):
    """表规范化：接受 64 或 65 字符的表，只取前 64 位。

    ov2 每个 build 的表都是「同一 65 字符集的一次整体洗牌」，编码只用到
    下标 0..63，第 65 个字符（下标 64）是**永不取用的诱饵**。因此 64 字符
    的表（= 实测反推得到的形态）与 65 字符的表（= 源码字面量形态）等价。
    """
    if not isinstance(alphabet, str):
        raise TypeError("alphabet 必须是 str")
    a = alphabet
    if len(a) == 65:
        a = a[:64]
    if len(a) != 64:
        raise ValueError("alphabet 必须是 64 或 65 个字符，实得 %d" % len(alphabet))
    if len(set(a)) != 64:
        raise ValueError("alphabet 有重复字符，非法")
    return a


def b64_decode(text, alphabet):
    """自定义 base64 解码（无填充）。

    尾组规则（源码 L590-599）：余 1 字节 -> 2 字符；余 2 字节 -> 3 字符；
    余 3 字节 -> 4 字符。长度为 4k+1 的输入不可能合法 -> 抛错。
    """
    a = _normalize_alphabet(alphabet)
    rev = {c: i for i, c in enumerate(a)}
    s = "".join(text.split())  # 容忍换行/空白（HTTP body 读取常带尾换行）
    if not s:
        return b""
    rem = len(s) % 4
    if rem == 1:
        raise ValueError("base64 长度非法（%%4 == 1）：%d 字符" % len(s))
    out = bytearray()
    full = len(s) - rem
    for i in range(0, full, 4):
        v = 0
        for k in range(4):
            c = s[i + k]
            try:
                v = (v << 6) | rev[c]
            except KeyError:
                raise ValueError("字符 %r 不在该 build 的 base64 表中（位置 %d）"
                                 % (c, i + k))
        out += v.to_bytes(3, "big")
    if rem == 2:
        try:
            v = (rev[s[full]] << 6) | rev[s[full + 1]]
        except KeyError:
            raise ValueError("尾部字符 %r 不在该 build 的 base64 表中" % s[full])
        out.append((v >> 4) & 0xFF)
    elif rem == 3:
        try:
            v = ((rev[s[full]] << 12) | (rev[s[full + 1]] << 6) | rev[s[full + 2]])
        except KeyError:
            raise ValueError("尾部字符不在该 build 的 base64 表中")
        out += ((v >> 2) & 0xFFFF).to_bytes(2, "big")
    return bytes(out)


def b64_encode(data, alphabet):
    """自定义 base64 编码（无填充），与 b64_decode 互逆。"""
    a = _normalize_alphabet(alphabet)
    data = bytes(data)
    n = len(data)
    full = n - (n % 3)
    out = []
    for i in range(0, full, 3):
        v = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
        out.append(a[(v >> 18) & 63])
        out.append(a[(v >> 12) & 63])
        out.append(a[(v >> 6) & 63])
        out.append(a[v & 63])
    r = n - full
    if r == 1:
        v = data[full] << 16                      # 源码 L591：R = R[UM] << 16
        out.append(a[(v >> 18) & 63])
        out.append(a[(v >> 12) & 63])
    elif r == 2:
        v = (data[full] << 16) | (data[full + 1] << 8)   # L595-596
        out.append(a[(v >> 18) & 63])
        out.append(a[(v >> 12) & 63])
        out.append(a[(v >> 6) & 63])
    return "".join(out)


def qblz6(data16, mask16):
    """QBLZ6 的等价实现：与固定 16 字节垫逐字节 XOR（自逆）。

    源码侧 QBLZ6 是外部注入的 IIFE 参数（pristine 件里只有 1 处调用、0 处定义），
    其实现在本仓库不可见；这里用的是**数据侧反推**的等价式：
        after == raw XOR "sGabkxvHwYuNfTtN"(ASCII, 16B)
    证据见 qblz6_pairs.py / qblz6_rank.py（15 组 raw/after 对、去重 13 组、跨 5 会话、
    0 反例）。XOR 自逆，故加解密同一函数。
    """
    if len(data16) != len(mask16):
        raise ValueError("qblz6: 两参数长度必须相同（%d vs %d）"
                         % (len(data16), len(mask16)))
    return bytes(x ^ y for x, y in zip(bytes(data16), bytes(mask16)))


def bytes_to_hex(b):
    """bytes -> 小写十六进制字符串。"""
    return bytes(b).hex()


def hex_to_bytes(s):
    """十六进制字符串 -> bytes（容忍空白、冒号、0x 前缀）。"""
    if isinstance(s, (bytes, bytearray)):
        s = bytes(s).decode("ascii")
    t = "".join(s.split()).replace(":", "")
    if t[:2].lower() == "0x":
        t = t[2:]
    if len(t) % 2 != 0:
        raise ValueError("hex 长度为奇数：%d" % len(t))
    try:
        return bytes.fromhex(t)
    except ValueError as e:
        raise ValueError("非法 hex：%s" % e)
