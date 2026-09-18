#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ov2 上行 payload 离线解密链：POST body -> 明文 JSON（纯标准库 / Python 3.9）。

链路（源码锚点 = ov2-0916-11.pristine.js，md5 6ee30699f97b3e6ab29e7a4b95661187）：

    body  --自定义 base64 解码(L586-599)-->  raw
    raw   = rsaHeader(128B)  ‖  padLen(1B)  ‖  cipher          (c9 编码器 L542-556)
    key16 = ot[9*padLen+40 : +16] ⊕ mask                      (c9 L556-560 + QBLZ6)
            或 window[9*padLen : +16] ⊕ mask                  (window = 原 T[40..119))
    cipher --TEA⁻¹--> paddedCompressed                        (P L6493-6635 / D L3623 / H L5179)
          再砍掉尾部 padLen 字节（那只是 8 字节对齐的补零）

    ★ P 是**加密方向**的轮函数（v0 += f(v1)^rk[64b+2i]; ...，见 ov2_crypto.block_encrypt），
      本模块要的是它的逆（轮序倒放 + 减法，见 block_decrypt）；两者已在 64 条真值向量上
      双向逐字节验证（解密 64/64；用它加密重建 body 亦 64/64 相等）。
    compressed = [0xFD,0x01,flag] ‖ (flag ? O(framed) : framed)   (Q, L11461-11474)
    framed = 0x20 ‖ 手写 JSON ‖ 0x20
    json   = json.loads(framed[1:-1])

★ 三处「照字面/照名字猜就会错」的点（已逐行复核，见 ov2_crypto 顶部注释）：
  1. H 的第二个 selector 是 ``(x>>>11)&3``，**不是** ``x>>>14``。源码 L5229：
     ``Ug = UO[AG(ZB.Ur)](UO[AG(ZB.Uf)](UX, 11), 3)``，而 Kl(ZB.Ur)=Kl(1174) 解出的
     是 ``&``、Kl(ZB.Uf)=Kl(652) 解出的是 ``>>>``（索引名 ZB.Ur 与 ZB.R 长得像
     兄弟、语义却不同）=> ``((UX>>>11)&3)``。实测 keystream.sample 4/4 逐位吻合。
  2. padLen 不是明文长度，只是补零个数；``padLen=0`` 时 Python 的 ``data[:-0]``
     会得到**空串**，必须特判（源码是 ``length-pad`` 语义）。
  3. 本模块的 Envelope.cipher **不含** RSA 头；而 trace 里 ``ov2.payload.cipher``
     的 ``len`` **含** RSA 头（同名异义，对拍前先对齐口径）。

CLI 退出码：0 = 全链成功；1 = 不可解（缺 key / 断言失败）；2 = 输入或参数错误。
"""

import argparse
import json
import os
import sys
import zlib
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # 自定位：与 cwd 无关

import ov2_builds
import ov2_crypto

__all__ = [
    "Envelope", "InputError", "DecodeError",
    "envelopeFromRaw", "decodeEnvelopeFromBody", "deriveBaseKey",
    "decryptCompressedFromEnvelope", "encryptCompressedToEnvelope",
    "decompressPayloadFromCompressed", "unframe", "frame",
    "decodeRequestBody", "encodeRequestBody",
    "iter_trace_records", "keys_from_trace",
    "SENTINEL", "MAGIC", "RSA_HEADER_LEN", "PAD_LEN_OFFSET", "PAD_LEN_STRIDE",
]

# ── 常量 ────────────────────────────────────────────────────────────────
SENTINEL = 0x20                 # framed 首尾哨兵（= 空格）
MAGIC = b"\xfd\x01"             # compressed 前两字节（Q, L11466: Uf = [253, 1, Uk]）
RSA_HEADER_LEN = 128            # envelope 前的 128 字节 RSA 头（c6.slice()）
PAD_LEN_OFFSET = 40             # off = 9*padLen + 40（c9 L556）
PAD_LEN_STRIDE = 9
OT_LEN = 128                    # ot = keymat.rand128（keyRaw 的来源数组）
WINDOW_LEN = 79                 # 等价窗口 = 原数组的 [40, 119)，即 79 字节
FLAG_PLAIN = 0                  # Q: flag=0 -> 原样（framed）
FLAG_DEFLATE = 1                # Q: flag=1 -> raw deflate
MAX_PAD_LEN = 7                 # UM = (8 - len%8) % 8，取值恒 0..7

TRACE_KEY_QBLZ6 = "ov2.payload.keyQBLZ6"
DEFAULT_BUILD = "0916-11"

EXIT_OK = 0
EXIT_UNDECRYPTABLE = 1
EXIT_INPUT = 2

_UNDECRYPTABLE_HINT = "不可解——缺 baseKey/ot"


class InputError(ValueError):
    """输入/参数层面的错误（body 与 alphabet/key 明显不匹配等）-> exit 2。"""


class DecodeError(ValueError):
    """已拿到 envelope 但解不开（magic 不符、长度非 8 倍数、inflate 失败等）-> exit 1。"""


# ── envelope ────────────────────────────────────────────────────────────
@dataclass
class Envelope:
    """解密前的信封：raw = rsaHeader ‖ padLen(1B) ‖ cipher。

    ``cipher`` **不含** RSA 头（与 trace 里 ``ov2.payload.cipher.len`` 的口径不同，
    后者含头）。``pad_len`` 是尾部补零个数，不是明文长度。
    """
    raw: bytes
    rsa_header: bytes
    pad_len: int
    cipher: bytes


def envelopeFromRaw(raw):
    """bytes -> Envelope。长度不足或 padLen 异常 -> InputError/DecodeError。"""
    raw = bytes(raw)
    if len(raw) < RSA_HEADER_LEN + 1:
        raise InputError("envelope 只有 %d 字节，不足 RSA 头(128)+padLen(1)" % len(raw))
    pad_len = raw[RSA_HEADER_LEN]
    cipher = raw[RSA_HEADER_LEN + 1:]
    if pad_len > MAX_PAD_LEN:
        raise DecodeError(
            "padLen = %d 越界（合法 0..%d）——alphabet/key 大概率不对"
            % (pad_len, MAX_PAD_LEN))
    return Envelope(raw, raw[:RSA_HEADER_LEN], pad_len, cipher)


def decodeEnvelopeFromBody(body, alphabet):
    """body(自定义 base64 文本) -> Envelope。**不校验** RSA 头内容。

    字符不在表内 / 长度 %%4 == 1 -> InputError（多半是 alphabet 给错了）。
    """
    if isinstance(body, (bytes, bytearray)):
        text = bytes(body).decode("utf-8", "replace")
    elif isinstance(body, str):
        text = body
    else:
        raise TypeError("body 必须是 str 或 bytes")
    try:
        raw = ov2_crypto.b64_decode(text, alphabet)
    except ValueError as e:
        raise InputError("base64 解码失败（alphabet 与 body 不匹配？）：%s" % e)
    return envelopeFromRaw(raw)


# ── baseKey 派生 ────────────────────────────────────────────────────────
def deriveBaseKey(*, key=None, ot=None, window=None, pad_len=None, mask=None):
    """派生 16 字节 baseKey/TEA key。四个来源**必须且只能给一个**。

    - ``key``    : 16 字节，直接使用（= QBLZ6 之后的最终 key，trace 的 after 即此）
    - ``ot``     : 128 字节，取 ``ot[9*pad_len+40 : +16]`` 再 ⊕ mask
    - ``window`` : 79 字节，取 ``window[9*pad_len : +16]`` 再 ⊕ mask
                   （= 原 128 字节数组的 [40,119) 切片，省得带整块 ot）
    - ``mask``   : QBLZ6 的 16 字节垫（ot/window 路径必给）
    """
    given = [("key", key), ("ot", ot), ("window", window)]
    picked = [(n, v) for n, v in given if v is not None]
    if len(picked) != 1:
        raise ValueError("baseKey 来源必须恰好给一个，实得 %d 个：%s"
                         % (len(picked), [n for n, _ in picked]))
    name, val = picked[0]
    if name == "key":
        k = _as_bytes(val, "key")
        if len(k) != 16:
            raise ValueError("key 必须是 16 字节，实得 %d" % len(k))
        return k
    if pad_len is None:
        raise ValueError("给 ot/window 时必须同时给 pad_len")
    if mask is None:
        raise ValueError("给 ot/window 时必须同时给 mask（QBLZ6 垫）")
    m = _as_bytes(mask, "mask")
    if len(m) != 16:
        raise ValueError("mask 必须是 16 字节，实得 %d" % len(m))
    src = _as_bytes(val, name)
    want = OT_LEN if name == "ot" else WINDOW_LEN
    if len(src) != want:
        raise ValueError("%s 必须是 %d 字节，实得 %d" % (name, want, len(src)))
    # ot 是原数组，切片基准 = 9*pad+40；window 是原数组 [40,119) 的切片，
    # 基准已少掉那 40，故 = 9*pad。
    off = PAD_LEN_STRIDE * int(pad_len) + (PAD_LEN_OFFSET if name == "ot" else 0)
    piece = src[off:off + 16]
    if len(piece) != 16:
        raise ValueError("%s[%d:%d] 越界（pad_len=%d 过大）"
                         % (name, off, off + 16, pad_len))
    return ov2_crypto.qblz6(piece, m)


def _as_bytes(x, what):
    """bytes/bytearray/hex 文本/list[int] -> bytes。"""
    if isinstance(x, (bytes, bytearray)):
        return bytes(x)
    if isinstance(x, str):
        try:
            return ov2_crypto.hex_to_bytes(x)
        except ValueError as e:
            raise ValueError("%s 解析失败：%s" % (what, e))
    if isinstance(x, (list, tuple)):
        try:
            return bytes(bytearray(x))
        except ValueError as e:
            raise ValueError("%s 元素必须都在 0..255：%s" % (what, e))
    raise TypeError("%s 类型不支持：%r" % (what, type(x)))


# ── 解密 / 加密 ─────────────────────────────────────────────────────────
def decryptCompressedFromEnvelope(env, key16):
    """Envelope + 16B key -> compressed（已砍掉尾部 padLen 个补零字节）。

    padLen=0 时**不能**写 ``dec[:-0]``（那是空串，源码语义是 length-0）。
    """
    key16 = _as_bytes(key16, "key16")
    if len(key16) != 16:
        raise ValueError("key16 必须是 16 字节，实得 %d" % len(key16))
    ct = env.cipher
    if not ct:
        raise DecodeError("cipher 为空")
    if len(ct) % 8 != 0:
        raise DecodeError(
            "cipher 长度 %d 不是 8 的倍数——key/alphabet 大概率不对" % len(ct))
    stream = ov2_crypto.base_stream(key16)
    dec = ov2_crypto.tea_ecb(ct, stream, False)
    if env.pad_len > len(dec):
        raise DecodeError("padLen(%d) > 解密长度(%d)" % (env.pad_len, len(dec)))
    compressed = dec[:len(dec) - env.pad_len] if env.pad_len else dec
    if not compressed:
        raise DecodeError("去掉 pad 后 compressed 为空")
    return compressed


def encryptCompressedToEnvelope(compressed_padded, key16, rsa_header, pad_len):
    """compressed(已含 pad 补零) + key16 + rsaHeader -> envelope bytes（未 base64）。

    与 c9 的 ``R = c6.slice(); R[128] = UM; R.length += Ud`` 同序。
    """
    key16 = _as_bytes(key16, "key16")
    hdr = _as_bytes(rsa_header, "rsa_header")
    if len(key16) != 16:
        raise ValueError("key16 必须是 16 字节，实得 %d" % len(key16))
    if len(hdr) != RSA_HEADER_LEN:
        raise ValueError("rsa_header 必须是 %d 字节，实得 %d"
                         % (RSA_HEADER_LEN, len(hdr)))
    data = _as_bytes(compressed_padded, "compressed_padded")
    if len(data) % 8 != 0:
        raise ValueError("compressed_padded 长度 %d 不是 8 的倍数" % len(data))
    pad_len = int(pad_len)
    if not 0 <= pad_len <= MAX_PAD_LEN:
        raise ValueError("pad_len 必须在 0..%d，实得 %d" % (MAX_PAD_LEN, pad_len))
    stream = ov2_crypto.base_stream(key16)
    ct = ov2_crypto.tea_ecb(data, stream, True)
    return hdr + bytes(bytearray([pad_len])) + ct


# ── 解压 / 帧 ───────────────────────────────────────────────────────────
def decompressPayloadFromCompressed(compressed):
    """compressed -> framed（未解压时原样返回）。断言 magic 与 flag。"""
    c = bytes(compressed)
    if len(c) < 3:
        raise DecodeError("compressed 只有 %d 字节，不足 [0xFD,0x01,flag]" % len(c))
    if c[:2] != MAGIC:
        raise DecodeError("magic 校验失败：实得 %s，应为 fd01（key 不对？）"
                          % c[:2].hex())
    flag = c[2]
    payload = c[3:]
    if flag == FLAG_PLAIN:
        return payload
    if flag == FLAG_DEFLATE:
        d = zlib.decompressobj(-15)      # raw deflate（windowBits = -15）
        try:
            out = d.decompress(payload) + d.flush()
        except zlib.error as e:
            raise DecodeError("raw inflate 失败（key 不对或数据截断）：%s" % e)
        return out
    raise DecodeError("未知 flag = %d（只见过 0/1）" % flag)


def unframe(framed):
    """framed -> JSON 字节串。校验首尾都是 0x20 哨兵。"""
    f = bytes(framed)
    if len(f) < 2:
        raise DecodeError("framed 只有 %d 字节" % len(f))
    if f[0] != SENTINEL or f[-1] != SENTINEL:
        raise DecodeError("framed 哨兵校验失败：首=0x%02x 尾=0x%02x（应为 0x20）"
                          % (f[0], f[-1]))
    return f[1:-1]


def frame(json_bytes):
    """JSON 字节串 -> framed（首尾各补一个 0x20）。"""
    b = bytes(json_bytes)
    return bytes(bytearray([SENTINEL])) + b + bytes(bytearray([SENTINEL]))


# ── 总入口 ──────────────────────────────────────────────────────────────
def decodeRequestBody(body, key16, alphabet):
    """完整解密链。返回 dict：

    ``{json, jsonText, framed, serialized, compressed, envelope}``
    （``serialized`` = 输入 body 原文；``envelope`` = Envelope 对象）
    """
    if isinstance(body, (bytes, bytearray)):
        body_text = bytes(body).decode("utf-8", "replace")
    elif isinstance(body, str):
        body_text = body
    else:
        raise TypeError("body 必须是 str 或 bytes")
    env = decodeEnvelopeFromBody(body_text, alphabet)
    compressed = decryptCompressedFromEnvelope(env, key16)
    framed = decompressPayloadFromCompressed(compressed)
    json_text = unframe(framed).decode("utf-8")
    try:
        obj = json.loads(json_text)
    except ValueError as e:
        raise DecodeError("JSON 解析失败（明文可能不是 JSON）：%s" % e)
    return {
        "json": obj,
        "jsonText": json_text,
        "framed": framed,
        "serialized": body_text,
        "compressed": compressed,
        "envelope": env,
    }


def encodeRequestBody(compressed_padded, key16, rsa_header, pad_len, alphabet):
    """decodeRequestBody 的逆：compressed(含 pad) -> body 文本。

    ★ pad 字节内容：源码里是数组空洞（JS holes），加密路径读到 undefined，
    ``undefined & 255 === 0``，故**补零**。可用 --roundtrip 在真实向量上自证。
    """
    env = encryptCompressedToEnvelope(compressed_padded, key16, rsa_header, pad_len)
    return ov2_crypto.b64_encode(env, alphabet)


# ── trace 解析（拼接 JSON，无换行；流式 raw_decode）─────────────────────
def iter_trace_records(path, chunk_size=1 << 20):
    """流式迭代 trace 里的记录（dict）。

    trace 是**首尾相接、无分隔符**的 JSON 对象流（形如 ``{...}{...}``），
    因此按行 split 不行，必须用 ``JSONDecoder.raw_decode`` 逐条推进；
    读到的半条记录留在缓冲区等下一块。EOF 仍有残渣 -> ValueError。
    """
    dec = json.JSONDecoder()
    buf = ""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            buf += chunk
            while True:
                s = buf.lstrip()
                if not s:
                    buf = ""
                    break
                try:
                    obj, end = dec.raw_decode(s)
                except ValueError:
                    break            # 半条记录，继续读
                buf = s[end:]
                yield obj
    s = buf.strip()
    if s:
        try:
            dec.raw_decode(s)
        except ValueError as e:
            raise ValueError("trace 尾部有无法解析的残留（%d 字符）：%s" % (len(s), e))


def keys_from_trace(path):
    """读 trace，返回**全部** ``ov2.payload.keyQBLZ6`` 记录 [(off, key16), ...]。

    ``after`` 是 QBLZ6 的**输出**，即最终 TEA key（源码 L560 ``Ur = QBLZ6(Ur)``
    原地改写后再喂给 H），故**不需要**再解一次 XOR。
    """
    out = []
    for rec in iter_trace_records(path):
        if not isinstance(rec, dict) or rec.get("k") != TRACE_KEY_QBLZ6:
            continue
        v = rec.get("v")
        if isinstance(v, dict):
            after, off = v.get("after"), v.get("off")
        elif isinstance(v, list):
            after, off = v, None
        else:
            continue
        if not isinstance(after, (list, tuple)) or len(after) != 16:
            continue
        out.append((off, bytes(bytearray(after))))
    return out


# ── CLI ─────────────────────────────────────────────────────────────────
def _build_parser():
    ap = argparse.ArgumentParser(
        prog="ov2_payload_codec",
        description="ov2 上行 payload 离线解密：POST body -> 明文 JSON",
        epilog="退出码：0=成功；1=不可解（缺 key/断言失败）；2=输入或参数错误",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--body-file", metavar="PATH", help="从文件读 body（base64 文本）")
    src.add_argument("--body-stdin", action="store_true", help="从 stdin 读 body")
    src.add_argument("--verify-vectors", metavar="PATH", nargs="+", default=None,
                     help="批量对拍向量文件（七层断言 + 自逆；路径显式给出，"
                          "可给多个文件。换 build 的回归判据）")

    key = ap.add_mutually_exclusive_group()
    key.add_argument("--key-hex", metavar="HEX", help="16 字节 baseKey（32 hex）")
    key.add_argument("--ot-hex", metavar="HEX", help="128 字节 ot（256 hex），需配 --mask-hex")
    key.add_argument("--ot-window", metavar="HEX", help="79 字节窗口（158 hex），需配 --mask-hex")
    key.add_argument("--trace", metavar="PATH", help="trace JSONL；取最后一条 keyQBLZ6 的 after")

    alp = ap.add_mutually_exclusive_group()
    alp.add_argument("--alphabet", metavar="STR", help="自定义 base64 表（64 或 65 字符）")
    alp.add_argument("--ov2js", metavar="PATH",
                     help="源码件；自动提取表并匹配 BUILDS。表未登记也可用（表来自源码直读）："
                          "key-hex/trace 路线照常；ot/window 路线仍需该 build 已登记 mask "
                          "或显式 --mask-hex")

    ap.add_argument("--build", metavar="NAME", default=None,
                    help="已登记 build（默认 %s）；提供表，且在其登记了 mask 时作为默认垫"
                         % DEFAULT_BUILD)
    ap.add_argument("--mask-hex", metavar="HEX", help="QBLZ6 的 16 字节垫（32 hex）")
    ap.add_argument("--out-dir", metavar="DIR",
                    help="落盘 envelope.bin/cipher.bin/compressed.bin/framed.bin/payload.json")
    ap.add_argument("--print", dest="print_mode", choices=("json", "all"), default=None,
                    help="json=只打印明文 JSON；all=连各层 hex 样本一起打印")
    ap.add_argument("--roundtrip", action="store_true",
                    help="用解出的结果反向重建 body，与输入逐字节比对（pad 补零的自证）")
    return ap


def _build_by_name(name):
    b = ov2_builds.BUILDS.get(name)
    if b is None:
        raise InputError("build %r 未登记（不猜）。已登记：%s"
                         % (name, sorted(ov2_builds.BUILDS)))
    return b


def _resolve_alphabet(args):
    """返回 (alphabet, build_or_None, 描述)。未知一律抛 InputError（不猜）。

    返回的 build 语义 = **QBLZ6 垫的来源**，优先级：显式 --build > 表指纹匹配。
    三条表来源（--alphabet / --ov2js / --build|默认）任一都给一个 build 或 None；
    None 只在 ot/window 路径下是错误（key-hex/trace 不需要垫）。

    ★ 「--ov2js 自动沿用它匹配到的 build 的 mask」就是靠这里返回 build 实现的：
      匹配到就表、垫同源；**匹配不到（表未登记）时表仍可用、垫为 None**——放行与否
      交给调用方按路径判定（main：key-hex/trace 放行，ot/window 拒绝）。判据是
      「这层需不需要垫」，不是「表可不可信」（表来自源码直读，可信）。
    """
    if args.alphabet:
        a = args.alphabet
        if args.build:                      # 显式 --build 优先（其表可能与之不符）
            b = _build_by_name(args.build)
            same = (b.alphabet == a or b.alphabet[:64] == a or b.alphabet == a[:64])
            if not same:
                return a, b, ("--alphabet（显式；**与 --build %s 的登记表不一致**，"
                              "垫仍按 --build 取——若表才是对的请去掉 --build）" % b.name)
            return a, b, "--alphabet（显式；表 == build %s）" % b.name
        m = ov2_builds.match_alphabet(a)    # 指纹匹配；匹配不到不是错误（表可能未登记）
        if m is not None:
            return a, m, "--alphabet（显式；表指纹匹配到 build %s）" % m.name
        return a, None, "--alphabet（显式；表不匹配任何已登记 build）"
    if args.ov2js:
        try:
            b = ov2_builds.detect_from_file(args.ov2js)
        except ov2_builds.TableNotRegistered as e:
            # 表提取成功、只是该 build 未登记：表来自源码直读（可信）=> 只需表的路
            # 线照用；垫为 None，ot/window 路线由 main 的 mask 检查照旧拒绝（不猜）。
            if args.build:
                raise InputError(
                    "--ov2js 与 --build 冲突：%s 的表未登记，无法确认它与 --build %s "
                    "是否同一个 build（不猜）。去掉 --build 即用该表解码"
                    "（表未登记时 --build 也提供不了垫）。" % (args.ov2js, args.build))
            return (e.alphabet, None,
                    "--ov2js %s -> **表未登记**（%s…%s）"
                    % (args.ov2js, e.alphabet[:8], e.alphabet[-6:]))
        except (OSError, ValueError) as e:
            raise InputError("--ov2js 解析失败：%s" % e)
        if args.build:
            b2 = _build_by_name(args.build)
            if b2.name != b.name:
                raise InputError(
                    "--ov2js 与 --build 冲突：%s 的表指纹指向 build %s，而 --build 给的是 %s"
                    "（两个表来源矛盾，不猜）。去掉 --build 即用 %s。"
                    % (args.ov2js, b.name, b2.name, b.name))
        return b.alphabet, b, "--ov2js %s -> build %s" % (args.ov2js, b.name)
    name = args.build or DEFAULT_BUILD
    b = _build_by_name(name)
    return b.alphabet, b, "build %s%s" % (b.name, "（默认）" if not args.build else "")


def _resolve_key(args, pad_len, mask):
    """返回 (key16, 描述, extra)。mask 由 _mask_for 统一解析（含 build 兜底）。

    key-hex / trace 路径不需要 mask；ot/window 路径需要，缺失时 deriveBaseKey 报错。
    """
    if args.key_hex:
        k = ov2_crypto.hex_to_bytes(args.key_hex)
        if len(k) != 16:
            raise InputError("--key-hex 必须是 32 个 hex 字符（16 字节），实得 %d 字节" % len(k))
        return k, "--key-hex", None
    if args.trace:
        cands = keys_from_trace(args.trace)
        if not cands:
            raise InputError("trace 里没有 %s 记录：%s" % (TRACE_KEY_QBLZ6, args.trace))
        off, k = cands[-1]                     # 契约：取最后一条
        note = None
        if len(cands) > 1:
            note = ("trace 里有 %d 条 keyQBLZ6，按约定取最后一条 off=%s；"
                    "其余候选 off=%s（若 body 不是这一条对应的请求，请换候选）"
                    % (len(cands), off, [o for o, _ in cands[:-1]]))
        if off is not None:
            pad_from_trace = (off - PAD_LEN_OFFSET) // PAD_LEN_STRIDE
            if (off - PAD_LEN_OFFSET) % PAD_LEN_STRIDE or pad_from_trace != pad_len:
                note = ((note + "；" if note else "")
                        + "trace.off=%s 推出 padLen=%s，而 body 里是 %d（不匹配，key 可能不属于该 body）"
                        % (off, pad_from_trace, pad_len))
        return k, "--trace（最后一条 keyQBLZ6 的 after）", note
    if args.ot_hex:
        ot = ov2_crypto.hex_to_bytes(args.ot_hex)
        if len(ot) != OT_LEN:
            raise InputError("--ot-hex 必须是 %d 字节（%d hex），实得 %d 字节"
                             % (OT_LEN, OT_LEN * 2, len(ot)))
        return deriveBaseKey(ot=ot, pad_len=pad_len, mask=mask), "--ot-hex", None
    if args.ot_window:
        w = ov2_crypto.hex_to_bytes(args.ot_window)
        if len(w) != WINDOW_LEN:
            raise InputError("--ot-window 必须是 %d 字节（%d hex），实得 %d 字节"
                             % (WINDOW_LEN, WINDOW_LEN * 2, len(w)))
        return deriveBaseKey(window=w, pad_len=pad_len, mask=mask), "--ot-window", None
    return None, None, None


def _mask_for(args, build):
    """QBLZ6 垫：--mask-hex 优先，否则取 build 登记值；都没有 -> None。

    ★ 调用方（main）在 ot/window 路径下必须把 None 当错误处理（不猜）。
    """
    if args.mask_hex:
        m = ov2_crypto.hex_to_bytes(args.mask_hex)      # 可能是 ValueError
        if len(m) != 16:
            raise InputError("--mask-hex 必须是 32 个 hex 字符（16 字节），实得 %d 字节" % len(m))
        return m
    if build is not None and build.mask is not None:
        return build.mask
    return None


def _print_all_chunks(env, compressed, framed):
    print("  envelope.raw      : %d B" % len(env.raw))
    print("  envelope.rsaHeader: %s ... (%d B, 未校验)" % (env.rsa_header[:16].hex(), len(env.rsa_header)))
    print("  envelope.padLen   : %d" % env.pad_len)
    print("  envelope.cipher   : %s ... (%d B)" % (env.cipher[:32].hex(), len(env.cipher)))
    print("  compressed        : %s ... (%d B, flag=%d)"
          % (compressed[:24].hex(), len(compressed), compressed[2]))
    print("  framed            : %s ... %s (%d B)"
          % (framed[:32].hex(), framed[-8:].hex(), len(framed)))


# ── --verify-vectors：向量文件分层对拍（换 build 时的回归判据）──────────
# 判据的期望值全部取自**向量文件本身**（由 tools/oracle/ 真实执行产出），
# 不取自本实现——这正是它能验出本实现错误、而自检做不到的原因。
# 分母纪律：每层都印「申请了多少条 / 通过多少 / 跳过多少（原因）」，跳过的是
# 「该向量缺对应字段」，不许静默算通过（跳过整层会在结尾作为覆盖缺口列出）。
_VERIFY_REQUIRED = (
    ("L1.envelope", "envelope 结构：body 长度公式 / padLen 字节 / cipher 为 8 倍数 / cipherLen 字段"),
    ("L2.rsaHeader", "RSA 头 128 B 逐字节"),
    ("L3.padLen", "padLen 字段"),
    ("L4.compressed", "compressed（含 FD 01 flag 前缀）逐字节"),
    ("L5.framed", "framed（加哨兵后）逐字节"),
    ("L6.json", "明文 JSON 与 jsonObj 结构相等"),
    ("L7.selfInverse", "自逆：本实现解出的 compressed 重新加密 == cipher 逐字节"),
)
_VERIFY_AUX = (
    ("A1.key.otPath", "key 派生：ot 全数组路径 == keyHex"),
    ("A2.key.windowPath", "key 派生：79 B 窗口路径 == keyHex"),
    ("A3.key.otSlice", "ot[9*padLen+40 : +16] == keyRawHex"),
    ("A4.key.xorMask", "keyRawHex XOR maskHex == keyHex"),
    ("A5.b64.reencode", "b64_encode(raw) == body（含尾部 rem 规则与无填充）"),
    ("A6.reencrypt.vector", "用向量的 compressedHex 重新加密 == cipherHex"),
)
_VERIFY_ORDER = tuple(lid for lid, _ in _VERIFY_REQUIRED + _VERIFY_AUX)
_VERIFY_DEC_IDS = ("L4.compressed", "L5.framed", "L6.json", "L7.selfInverse")


class _Tally(object):
    """一层一条流水账：分母 n / 通过 ok / 跳过 skip（记原因）/ 失败明细。"""

    def __init__(self, lid, desc):
        self.lid = lid
        self.desc = desc
        self.n = self.ok = self.skip = 0
        self.skip_why = set()
        self.fails = []

    def hit(self, ok, detail=""):
        self.n += 1
        if ok:
            self.ok += 1
        else:
            self.fails.append(detail)

    def miss(self, why):
        self.n += 1
        self.skip += 1
        self.skip_why.add(why)

    @property
    def asserted(self):
        return self.ok + len(self.fails)


def _vec_pick(v, *names):
    """按名取向量字段；缺失返回 None（兼容别名字段）。"""
    if not isinstance(v, dict):
        return None
    for n in names:
        val = v.get(n)
        if val is not None:
            return val
    return None


def _vec_hex(v, *names):
    s = _vec_pick(v, *names)
    if not isinstance(s, str):
        return None
    try:
        return ov2_crypto.hex_to_bytes(s)
    except ValueError:
        return None


def _verify_one(v, tag, tal, fallback_alphabet):
    """对一条向量做全部层断言，记账进 tal。"""
    def hit(lid, ok, detail=""):
        tal[lid].hit(ok, "%s  %s" % (tag, detail))

    def miss(lids, why):
        if isinstance(lids, str):
            lids = (lids,)
        for lid in lids:
            tal[lid].miss(why)

    body = _vec_pick(v, "body")
    if not isinstance(body, str) or not body.strip():
        miss(_VERIFY_ORDER, "向量无 body 字段")
        return
    body = body.strip()
    alpha = _vec_pick(v, "alphabet") or fallback_alphabet
    if not isinstance(alpha, str) or len(alpha) < 64:
        miss(_VERIFY_ORDER, "向量无 alphabet 字段，且未给 --alphabet/--ov2js/--build")
        return
    try:
        raw = ov2_crypto.b64_decode(body, alpha)
    except Exception as e:                     # 表不符 / 表外字符 / 尾部非法
        miss(_VERIFY_ORDER, "反 base64 失败（%s）" % e)
        return
    if len(raw) < RSA_HEADER_LEN + 1:
        miss(_VERIFY_ORDER, "解出 raw 仅 %d B，不足 RSA 头 %d B + padLen 1 B"
             % (len(raw), RSA_HEADER_LEN))
        return
    pad_byte = raw[RSA_HEADER_LEN]
    cipher = raw[RSA_HEADER_LEN + 1:]
    want_pad = _vec_pick(v, "padLen")
    want_clen = _vec_pick(v, "cipherLen")

    # ---- L1：envelope 结构（不做任何解密就能验的那部分）----
    det = []
    if want_pad is not None and pad_byte != want_pad:
        det.append("padLen 字节 %d != 向量 %s" % (pad_byte, want_pad))
    if pad_byte > MAX_PAD_LEN:
        det.append("padLen 字节 %d 超出 0..%d" % (pad_byte, MAX_PAD_LEN))
    if len(cipher) % 8:
        det.append("cipher %d B 不是 8 的倍数" % len(cipher))
    if want_clen is not None and len(cipher) != want_clen:
        det.append("cipher %d B != cipherLen %s" % (len(cipher), want_clen))
    ch = _vec_pick(v, "cipherHex")
    if isinstance(ch, str) and cipher.hex() != ch.lower():
        det.append("cipher 逐字节 != cipherHex")
    n_exp = (4 * len(raw) + 2) // 3
    if len(body) != n_exp:
        det.append("body 长度 %d != ceil(4*%d/3) = %d" % (len(body), len(raw), n_exp))
    hit("L1.envelope", not det, "；".join(det))

    # ---- L2 / L3 ----
    rh = _vec_pick(v, "rsaHeaderHex")
    if not isinstance(rh, str):
        miss("L2.rsaHeader", "向量无 rsaHeaderHex 字段")
    else:
        hit("L2.rsaHeader", raw[:RSA_HEADER_LEN].hex() == rh.lower(),
            "RSA 头不符：实得 %s… 期望 %s…" % (raw[:16].hex(), rh[:32]))
    if want_pad is None:
        miss("L3.padLen", "向量无 padLen 字段")
    else:
        hit("L3.padLen", pad_byte == want_pad,
            "padLen 实得 %d 期望 %s" % (pad_byte, want_pad))

    # ---- key 与 mask（L4~L7 / A 组都要用）----
    kh = _vec_pick(v, "keyHex")
    key16 = None
    if not isinstance(kh, str):
        miss(_VERIFY_DEC_IDS, "向量无 keyHex 字段（无需 key 的层不受影响）")
    else:
        try:
            key16 = ov2_crypto.hex_to_bytes(kh)
        except ValueError as e:
            miss(_VERIFY_DEC_IDS, "keyHex 非法：%s" % e)
        else:
            if len(key16) != 16:
                miss(_VERIFY_DEC_IDS, "keyHex 不是 16 字节（实得 %d）" % len(key16))
                key16 = None
    mask = _vec_hex(v, "maskHex")
    ot = _vec_hex(v, "otHex")
    keyraw = _vec_hex(v, "keyRawHex")
    key_ids = ("A1.key.otPath", "A2.key.windowPath", "A3.key.otSlice", "A4.key.xorMask")

    # A1：ot 全数组路径（切片基准 9*pad + 40）
    if key16 is None:
        miss(key_ids, "向量无可用 keyHex，无法比对派生结果")
    else:
        if ot is None:
            miss("A1.key.otPath", "向量无 otHex 字段")
        elif mask is None:
            miss("A1.key.otPath", "向量无 maskHex 字段（本工具不猜垫）")
        else:
            try:
                k = deriveBaseKey(ot=ot, pad_len=pad_byte, mask=mask)
            except ValueError as e:
                hit("A1.key.otPath", False, "deriveBaseKey(ot=…) 抛错：%s" % e)
            else:
                hit("A1.key.otPath", k == key16,
                    "ot 路径派生 %s != keyHex %s" % (k.hex(), kh))
        # A2：79 B 窗口路径。★ 窗口是**固定补丁区** ot[40:119]（79 B）本身，
        # 不是「从 key 起点起的 79 B」——9*pad 的位移由 deriveBaseKey 内部加，
        # 这里若先位移一次就会算成 40+18*pad（p>0 全错）。
        win = _vec_hex(v, "otWindowHex", "windowHex")
        if win is None and ot is not None and len(ot) >= PAD_LEN_OFFSET + WINDOW_LEN:
            win = ot[PAD_LEN_OFFSET:PAD_LEN_OFFSET + WINDOW_LEN]
        if win is None:
            miss("A2.key.windowPath",
                 "向量无 window 字段且 otHex 不足 %d B（ot[%d:%d]）"
                 % (PAD_LEN_OFFSET + WINDOW_LEN, PAD_LEN_OFFSET, PAD_LEN_OFFSET + WINDOW_LEN))
        elif mask is None:
            miss("A2.key.windowPath", "向量无 maskHex 字段（本工具不猜垫）")
        else:
            try:
                k = deriveBaseKey(window=win, pad_len=pad_byte, mask=mask)
            except ValueError as e:
                hit("A2.key.windowPath", False, "deriveBaseKey(window=…) 抛错：%s" % e)
            else:
                hit("A2.key.windowPath", k == key16,
                    "window 路径派生 %s != keyHex %s" % (k.hex(), kh))
        # A3 / A4
        if ot is None or keyraw is None:
            miss("A3.key.otSlice", "向量缺 otHex 或 keyRawHex 字段")
        else:
            off = PAD_LEN_STRIDE * pad_byte + PAD_LEN_OFFSET
            piece = ot[off:off + 16]
            hit("A3.key.otSlice", piece == keyraw,
                "ot[%d:%d] = %s != keyRawHex %s" % (off, off + 16, piece.hex(), keyraw.hex()))
        if keyraw is None or mask is None:
            miss("A4.key.xorMask", "向量缺 keyRawHex 或 maskHex 字段")
        else:
            hit("A4.key.xorMask", ov2_crypto.qblz6(keyraw, mask) == key16,
                "keyRaw XOR mask = %s != keyHex %s"
                % (ov2_crypto.qblz6(keyraw, mask).hex(), kh))

    # A5：无填充 base64 逆（表与尾部 rem 规则）
    hit("A5.b64.reencode", ov2_crypto.b64_encode(raw, alpha) == body,
        "b64_encode(raw) != body")

    # ---- L4~L7：走 CLI 同一条解链 ----
    if key16 is not None:
        try:
            res = decodeRequestBody(body, key16, alpha)
        except Exception as e:
            for lid in _VERIFY_DEC_IDS:
                hit(lid, False, "解链失败：%s" % e)
        else:
            comp = res["compressed"]
            ch2 = _vec_pick(v, "compressedHex")
            if not isinstance(ch2, str):
                miss("L4.compressed", "向量无 compressedHex 字段")
            else:
                hit("L4.compressed", comp.hex() == ch2.lower(),
                    "compressed 不符：实得 %s… 期望 %s…" % (comp[:12].hex(), ch2[:24]))
            fh = _vec_pick(v, "framedHex")
            if not isinstance(fh, str):
                miss("L5.framed", "向量无 framedHex 字段")
            else:
                hit("L5.framed", res["framed"].hex() == fh.lower(),
                    "framed 不符：实得 %s… 期望 %s…"
                    % (res["framed"][:16].hex(), fh[:32]))
            if "jsonObj" not in v:
                miss("L6.json", "向量无 jsonObj 字段")
            else:
                hit("L6.json", res["json"] == v["jsonObj"],
                    "JSON 不等：实得 %r" % (res["json"],))
            pad_bytes = bytes(bytearray(pad_byte))
            try:
                rebuilt = encryptCompressedToEnvelope(comp + pad_bytes, key16,
                                                      raw[:RSA_HEADER_LEN], pad_byte)
            except ValueError as e:
                hit("L7.selfInverse", False, "重加密抛错：%s" % e)
            else:
                hit("L7.selfInverse", rebuilt == raw,
                    "解出结果重加密 != 原 envelope（%d vs %d B）"
                    % (len(rebuilt), len(raw)))
    # A6：用**向量的** compressedHex 重加密（正方向独立于本实现的解密）
    ch3 = _vec_hex(v, "compressedHex")
    if ch3 is None or key16 is None:
        miss("A6.reencrypt.vector", "向量缺 compressedHex 或 keyHex 字段")
    else:
        try:
            rebuilt = encryptCompressedToEnvelope(ch3 + bytes(bytearray(pad_byte)), key16,
                                                  raw[:RSA_HEADER_LEN], pad_byte)
        except ValueError as e:
            hit("A6.reencrypt.vector", False, "重加密抛错：%s" % e)
        else:
            want_ct = ch.lower() if isinstance(ch, str) else cipher.hex()
            hit("A6.reencrypt.vector",
                rebuilt[RSA_HEADER_LEN + 1:].hex() == want_ct,
                "重加密 cipher != cipherHex（实得 %s… 期望 %s…）"
                % (rebuilt[RSA_HEADER_LEN + 1:RSA_HEADER_LEN + 13].hex()[:24], want_ct[:24]))


def _verify_load(path):
    """读向量文件 -> (向量列表, 说明, meta)。结构错误抛 ValueError。

    meta 原样带出：本闸门要用它自报的 `maskIsStub` / `maskNote` 来界定结论强度
    （垫是占位桩时，mask 系层的"通过"不构成真垫证据）——产物的自我声明必须
    进入判据，否则闸门会对一份自述"垫未反推"的文件打出干净的绿。
    """
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        doc = json.load(f)
    meta = {}
    if isinstance(doc, dict):
        vecs = doc.get("vectors")
        note = ""
        m = doc.get("meta")
        if isinstance(m, dict):
            meta = m
            if m.get("producer"):
                note = "meta.producer = %s" % m["producer"]
    else:
        vecs = doc
        note = ""
    if not isinstance(vecs, list):
        raise ValueError("顶层既不是数组也没有 vectors 数组")
    if not vecs:
        raise ValueError("vectors 为空（0 条）")
    return vecs, note, meta


def verify_vectors(paths, args, out=None):
    """--verify-vectors 入口。返回退出码（0 全过 / 1 有失败 / 2 文件或参数错误）。"""
    out = out if out is not None else sys.stdout
    # 兜底表：只认显式来源，**不套默认 build**（避免拿 0916-11 的表去解未知文件）
    fallback, fb_desc = None, "(无)"
    try:
        if args.alphabet:
            fallback, fb_desc = args.alphabet, "--alphabet"
        elif args.ov2js:
            fallback = ov2_builds.detect_from_file(args.ov2js).alphabet
            fb_desc = "--ov2js %s" % args.ov2js
        elif args.build:
            fallback = _build_by_name(args.build).alphabet
            fb_desc = "--build %s" % args.build
    except (OSError, ValueError, InputError) as e:
        sys.stderr.write("[输入错误] %s\n" % e)
        return EXIT_INPUT

    tal = dict((lid, _Tally(lid, desc)) for lid, desc in _VERIFY_REQUIRED + _VERIFY_AUX)
    total_vecs = 0
    inert = []
    fatal = []
    stubs = []          # 自述「垫是占位桩」的文件（其 mask 系层的绿要降级解读）
    for path in paths:
        try:
            vecs, note, meta = _verify_load(path)
        except (OSError, ValueError) as e:
            fatal.append("%s：%s" % (path, e))
            continue
        # 每文件的表指纹（换 build 时最先要看的一行）
        fps = []
        for v in vecs:
            a = _vec_pick(v, "alphabet")
            if isinstance(a, str) and a not in [x[0] for x in fps]:
                m = ov2_builds.match_alphabet(a)
                fps.append((a, m.name if m else None))
        out.write("== 文件 %s ==\n" % path)
        out.write("   向量 %d 条%s\n" % (len(vecs), ("；" + note) if note else ""))
        for a, name in fps:
            out.write("   表指纹 %s…%s（%d 字符）-> %s\n"
                      % (a[:10], a[-6:], len(a),
                         ("build %s" % name) if name else "**不在 BUILDS 注册表内**"))
        # 产物自述的桩声明：必须进判据（见 _verify_load docstring）
        if meta.get("maskIsStub"):
            stubs.append("%s（%d 条）" % (path, len(vecs)))
            out.write("   ★ maskIsStub = true：本文件的 maskHex 是**占位值**，"
                      "不是该 build 线上真正的垫\n")
            mn = meta.get("maskNote")
            if isinstance(mn, str) and mn.strip():
                out.write("     meta.maskNote = %s\n" % " ".join(mn.split()))
        for i, v in enumerate(vecs):
            total_vecs += 1
            name = _vec_pick(v, "name") or ("#%d" % i)
            before = tal["L1.envelope"].asserted
            _verify_one(v, str(name), tal, fallback)
            if tal["L1.envelope"].asserted == before:
                inert.append(str(name))      # 连 envelope 都没验成 -> 该条空转
        out.write("\n")

    if fatal:
        for f in fatal:
            sys.stderr.write("[输入错误] %s\n" % f)
        return EXIT_INPUT
    if total_vecs == 0:
        sys.stderr.write("[输入错误] 没有可验的向量\n")
        return EXIT_INPUT

    out.write("── 分层结果（分母 = 该层被申请的向量数）──\n")
    for lid in _VERIFY_ORDER:
        t = tal[lid]
        # 三态：N/A = 该层一条都没断言（全跳过）——不许打成 OK（空转假绿）
        mark = "FAIL" if t.fails else ("N/A " if t.asserted == 0 else "OK ")
        line = "  %-19s %s  %d/%d 通过" % (lid, mark, t.ok, t.n)
        if t.skip:
            line += "，跳过 %d（%s）" % (t.skip, "、".join(sorted(t.skip_why)))
        out.write(line + "\n")
    n_all = sum(tal[lid].n for lid in _VERIFY_ORDER)
    ok_all = sum(tal[lid].ok for lid in _VERIFY_ORDER)
    skip_all = sum(tal[lid].skip for lid in _VERIFY_ORDER)
    fails = [(lid, d) for lid in _VERIFY_ORDER for d in tal[lid].fails]
    out.write("\n向量 %d 条；断言 %d 项：通过 %d，失败 %d，跳过 %d\n"
              % (total_vecs, n_all, ok_all, len(fails), skip_all))
    caveat = ("；**其中 %d 个文件的垫是占位桩**（maskIsStub=true）" % len(stubs)) if stubs else ""
    out.write("结果：%d/%d 通过（含自逆层；跳过项不计通过，逐层跳过数见上表%s）\n"
              % (ok_all, n_all, caveat))
    if stubs:
        out.write("!! 桩：%s —— 其上 A1/A2/A4 与全部 keyHex 系层（L4-L7、A6）只证明"
                  "「与 oracle 同用一个占位垫时链自洽」，\n"
                  "   **不构成该 build 真垫已确认的证据**；不受影响（仍是真断言）："
                  "L1/L2/L3/A3/A5（A3 比的是 keyRawHex，按该文件 meta 声明它是真实派生值）。\n"
                  % "、".join(stubs))
    out.write("注：垫的真伪不在本闸门能力内——maskHex 由向量自身提供，"
              "闸门验的是「给定垫时的链自洽」。\n")

    gaps = [lid for lid, _ in _VERIFY_REQUIRED if tal[lid].asserted == 0]
    if gaps:
        out.write("!! 覆盖缺口：必需层 %s 在本批向量上**一条都没断言**"
                  "（原因见上表「跳过」列）——这些层的结论不可用\n" % ", ".join(gaps))
    if inert:
        out.write("!! 空转：%d/%d 条向量连 envelope 层都没断言（%s%s）——"
                  "本批结论不可用。多半是向量缺 body/alphabet 字段，或表来源不对"
                  "（可用 --alphabet/--build 兜底）。\n"
                  % (len(inert), total_vecs, "、".join(inert[:5]),
                     " …" if len(inert) > 5 else ""))
        return EXIT_UNDECRYPTABLE
    if fails:
        out.write("\n失败明细：\n")
        for lid, d in fails:
            out.write("  [%s] %s\n" % (lid, d))
        return EXIT_UNDECRYPTABLE
    return EXIT_OK


def main(argv=None):
    ap = _build_parser()
    args = ap.parse_args(argv)

    # ---- 向量对拍模式（与单条解密互斥）----
    if args.verify_vectors:
        return verify_vectors(args.verify_vectors, args)

    # ---- 读 body ----
    try:
        if args.body_stdin:
            body_text = sys.stdin.read()
            body_src = "--body-stdin"
        else:
            with open(args.body_file, "r", encoding="utf-8", errors="replace") as f:
                body_text = f.read()
            body_src = args.body_file
    except OSError as e:
        sys.stderr.write("[输入错误] 读 body 失败：%s\n" % e)
        return EXIT_INPUT

    # ---- 表 / build ----
    try:
        alphabet, build, alp_desc = _resolve_alphabet(args)
    except InputError as e:
        sys.stderr.write("[输入错误] %s\n" % e)
        return EXIT_INPUT

    # --ov2js 的表未登记：表来自源码直读（可信）故照用，但垫不可得。只提示，不拒绝——
    # 真正需要垫的路径（ot/window）在下面按 mask is None 拒绝（语义分层，不是放松校验）。
    if args.ov2js and build is None:
        sys.stderr.write(
            "[注意] --ov2js %s 的表**未登记**进 BUILDS：表照用于解码（源码直读，可信），"
            "但**取不到该 build 的垫**。\n"
            "       如需 ot/window 路线：请把该 build 登记进 ov2_builds.py，"
            "或显式给 --mask-hex。\n" % args.ov2js)

    # ---- envelope（需要 pad_len 才能派生 key）----
    try:
        env = decodeEnvelopeFromBody(body_text, alphabet)
    except (InputError, DecodeError) as e:
        sys.stderr.write("[输入错误] %s\n" % e)
        sys.stderr.write("  （字母表来源：%s；若 body 来自别的 build，请用 --build/--ov2js/--alphabet 指定）\n" % alp_desc)
        return EXIT_INPUT

    # ---- QBLZ6 垫：--mask-hex 优先，否则取 build 登记值 ----
    try:
        mask = _mask_for(args, build)
    except (InputError, ValueError) as e:
        sys.stderr.write("[输入错误] %s\n" % e)
        return EXIT_INPUT

    # ---- key ----
    try:
        if (args.ot_hex or args.ot_window) and mask is None:
            sys.stderr.write(
                "[输入错误] 需要 QBLZ6 垫（mask）：%s，且未给 --mask-hex。**不猜**。\n"
                % ("build %s 未登记 mask" % build.name if build
                   else "表来源未匹配到任何已登记 build"))
            sys.stderr.write("  （字母表来源：%s）\n" % alp_desc)
            if args.ov2js and build is None:
                sys.stderr.write("  （--ov2js 的表未登记 ⇒ 无垫可兜底：key-hex/trace 路线不受影响，"
                                 "ot/window 路线请登记该 build 或显式给 --mask-hex）\n")
            return EXIT_INPUT
        key16, key_desc, key_note = _resolve_key(args, env.pad_len, mask)
    except (InputError, ValueError) as e:
        sys.stderr.write("[输入错误] %s\n" % e)
        return EXIT_INPUT

    if key_note:
        sys.stderr.write("[注意] %s\n" % key_note)

    # ---- 缺 key：只报 envelope 级信息 ----
    if key16 is None:
        print("== envelope（未解密）==")
        print("  body        : %d 字符（%s）" % (len(body_text.strip()), body_src))
        print("  alphabet    : %d 字符表（%s）前 16 = %r" % (len(alphabet), alp_desc, alphabet[:16]))
        print("  raw         : %d B = rsaHeader %d B + padLen 1 B + cipher %d B"
              % (len(env.raw), len(env.rsa_header), len(env.cipher)))
        print("  padLen      : %d" % env.pad_len)
        print("  cipher 头部 : %s ..." % env.cipher[:32].hex())
        print("  %s" % _UNDECRYPTABLE_HINT)
        sys.stderr.write("[无法解密] %s（请给 --key-hex / --ot-hex / --ot-window / --trace）\n"
                         % _UNDECRYPTABLE_HINT)
        return EXIT_UNDECRYPTABLE

    # ---- 解密链 ----
    try:
        res = decodeRequestBody(body_text, key16, alphabet)
    except (DecodeError, InputError, ValueError) as e:
        sys.stderr.write("[不可解] %s\n" % e)
        sys.stderr.write("  envelope: raw=%d B cipher=%d B padLen=%d；key 来源 %s\n"
                         % (len(env.raw), len(env.cipher), env.pad_len, key_desc))
        if args.trace:
            try:
                cands = keys_from_trace(args.trace)
                if len(cands) > 1:
                    sys.stderr.write("  trace 候选（off, key16）：\n")
                    for off, k in cands:
                        sys.stderr.write("    off=%s padLen=%s %s\n"
                                         % (off,
                                            (off - PAD_LEN_OFFSET) // PAD_LEN_STRIDE if off is not None else "?",
                                            k.hex()))
            except ValueError:
                pass
        return EXIT_UNDECRYPTABLE

    # ---- 输出 ----
    if args.print_mode == "json":
        print(res["jsonText"])
    else:
        jt = res["jsonText"]
        top = res["json"]
        kind = "dict(%d 键)" % len(top) if isinstance(top, dict) else (
            "list(%d 项)" % len(top) if isinstance(top, list) else type(top).__name__)
        print("== ov2 payload 解密 ==")
        print("  body        : %d 字符（%s）" % (len(body_text.strip()), body_src))
        print("  alphabet    : %d 字符表（%s）前 16 = %r" % (len(alphabet), alp_desc, alphabet[:16]))
        print("  key         : %s -> %s" % (key_desc, key16.hex()))
        print("  envelope    : raw=%d B = rsaHeader %d B + padLen 1 B + cipher %d B"
              % (len(env.raw), len(env.rsa_header), len(env.cipher)))
        print("  padLen      : %d" % env.pad_len)
        print("  compressed  : %d B（flag=%d: %s）"
              % (len(res["compressed"]), res["compressed"][2],
                 "raw deflate" if res["compressed"][2] == FLAG_DEFLATE else "明文帧"))
        print("  framed      : %d B（首尾 0x20 哨兵 OK）" % len(res["framed"]))
        print("  json        : %d 字符，顶层 %s" % (len(jt), kind))
        if args.print_mode == "all":
            _print_all_chunks(env, res["compressed"], res["framed"])
        if isinstance(top, dict) and top:
            keys = list(top.keys())
            print("  顶层键      : %s%s"
                  % (", ".join(repr(k) for k in keys[:8]), " ..." if len(keys) > 8 else ""))

    # ---- 落盘 ----
    if args.out_dir:
        try:
            os.makedirs(args.out_dir, exist_ok=True)
            blobs = [("envelope.bin", env.raw),
                     ("cipher.bin", env.cipher),
                     ("compressed.bin", res["compressed"]),
                     ("framed.bin", res["framed"]),
                     ("payload.json", res["jsonText"].encode("utf-8"))]
            for name, data in blobs:
                p = os.path.join(args.out_dir, name)
                with open(p, "wb") as f:
                    f.write(data)
                if args.print_mode != "json":
                    print("  wrote %s (%d B)" % (p, len(data)))
        except OSError as e:
            sys.stderr.write("[输入错误] 写 --out-dir 失败：%s\n" % e)
            return EXIT_INPUT

    # ---- roundtrip ----
    if args.roundtrip:
        pad_bytes = bytes(bytearray(env.pad_len))          # 源码里是空洞 -> &255 -> 0
        padded = res["compressed"] + pad_bytes
        try:
            rebuilt = encodeRequestBody(padded, key16, env.rsa_header, env.pad_len, alphabet)
        except ValueError as e:
            sys.stderr.write("[不可解] roundtrip 重建失败：%s\n" % e)
            return EXIT_UNDECRYPTABLE
        ok = rebuilt == body_text.strip()
        if args.print_mode != "json":
            print("  roundtrip   : %s（重建 %d 字符 vs 输入 %d 字符）"
                  % ("OK 逐字节相等" if ok else "FAIL 不等", len(rebuilt), len(body_text.strip())))
            if not ok:
                for i, (a, b) in enumerate(zip(rebuilt, body_text.strip())):
                    if a != b:
                        print("    首个差异 @%d: 重建 %r vs 输入 %r" % (i, a, b))
                        break
        if not ok:
            return EXIT_UNDECRYPTABLE

    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
