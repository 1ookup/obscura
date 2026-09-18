#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ov2 build 注册表：自定义 base64 表 + QBLZ6 垫 + 源码件 md5。

为什么需要「注册表」而不是猜：
  每个 ov2 build 的自定义 base64 表都是**同一 65 字符集的一次整体洗牌**
  （字符集 = 标准表 − `/` − `e` + `$` + `-`；下标 0..63 参与编码，下标 64
  是永不取用的诱饵）。相邻 build（例如 0918-15 与 0918-17）的表完全不同，
  且**没有任何命名/时间规律可推**——用错表解出的不是「部分错误」而是垃圾，
  或者干脆在字符集校验处报错。故本模块只认「已知表」，未知一律抛错（不猜）。

实测佐证（本次新增，扫 chanllenge/ov2 下全部 4xx 个 js 件）：
  - 每个 build 件里「65 字符且 65 个字符互不相同」的连续串**恰好唯一**，
    因此 extract_alphabet() 的判定是无歧义的；
  - 例：0916-00 = `ZQCW6toK...$De`（pristine L1559）
        0916-11 = `J1ZRjWCY...dH`  （pristine L398）
        0917-17、0918-15、0918-17 各不相同。

★ 本次跨会话发现（对 team-lead 转述的一处修正）：
  `trace-backups/qblz6-rank-pass*.jsonl`、`stage3*.jsonl` 这批 trace 是
  **0916-00 部署件**产生的，其 base64 表是 0916-00 的 `ZQCW6toK...$De`，
  **不是** 0916-11 的 L398 字面量。两表都真实存在、只是 build 不同；
  用 0916-11 的表去解 0916-00 的 `send.v` 会 0/15 全错。故本表把 0916-00
  也登记进来（BUILDS["0916-00"]），以便对既有 trace 语料做端到端复核。
"""

import hashlib
import os
import re
import sys
from dataclasses import dataclass
from typing import Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # 自定位：与 cwd 无关

__all__ = ["Build", "BUILDS", "QBLZ6_MASK_DEFAULT", "extract_alphabet",
           "match_alphabet", "detect_from_file", "md5_file", "list_builds",
           "TableNotRegistered"]

#: QBLZ6 的固定 16 字节垫（ASCII），数据侧反推所得，见 ov2_crypto.qblz6
QBLZ6_MASK_DEFAULT = b"sGabkxvHwYuNfTtN"

#: 自定义 base64 表的字符合集（65 个）= 标准表 − `/` + `$` + `-`（实测 4 个 build 一致）
_STD_ALPHABET = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                 "abcdefghijklmnopqrstuvwxyz0123456789+/")
ALPHABET_CHARSET = set(_STD_ALPHABET.replace("/", "") + "$-")
#: 65 字符连续串
_ALPHABET_RUN = re.compile(r"[A-Za-z0-9+\-$]{65}")


@dataclass(frozen=True)
class Build:
    """一个 ov2 build 的静态参数。"""
    name: str
    alphabet: str                 # 65 字符（或实测反推得到的 64 字符前缀）
    mask: Optional[bytes]         # QBLZ6 垫；None = 未知，用 --mask-hex 显式给
    src_md5: str                  # 对应源码冻结件 md5；"" = 未知/未登记
    notes: str = ""


BUILDS = {
    # team-lead 指定的 0916-11 主目标：表 = pristine L398 字面量
    "0916-11": Build(
        "0916-11",
        "J1ZRjWCYm8Fsx2k5Sag$hBlPIeVoqnz6DftEOU04ryupb9AN-KvGLQwT7X3Mci+dH",
        b"sGabkxvHwYuNfTtN",
        "6ee30699f97b3e6ab29e7a4b95661187",
        "表取自 ov2-0916-11.pristine.js L398；垫为数据侧反推（未在源码找到定义，"
        "QBLZ6 是外部注入的 IIFE 参数）",
    ),
    "0918": Build(
        "0918",
        "Cui7blsOxR2yQ0+rD4T9$nmFS8AEKNG3JgHZjWXo1pIfvLkYheqz6d5BUtVPcMw-a",
        None,
        "468f3c7422c8f95526a5af5a033dfdaa",
        "表实测等于 ov2-0918-15.js 的字面量（该 build 的 65 字符表唯一）；"
        "★ 键名 `0918` 指的是 **0918-15**：线上 ov2.js 已是另一个 build（见表内 "
        "`0918-17`），两者表不通用。垫未实测（trace 语料里没有 0918 的 keyRaw/"
        "keyQBLZ6 对），故置 None",
    ),
    "0918-17": Build(
        "0918-17",
        "qlrphbA3OdtG0DXRNFmByUYSief+$saECkKL1WZMPjVcuo29-45nQI87wgJHvzTx6",
        None,
        "d6f1c4117580f92bd2d175011c8dc90b",
        "**线上件**：`chanllenge/ov2/ov2.js`（420690 B，md5 d6f1c411…）与冻结件 "
        "`ov2-0918-17.js`（md5 911106ec…）表相同、字节不同 = 同一 build 的两份件。"
        "表有三处独立佐证：本模块 extract_alphabet 对上述两文件各提取一次，"
        "以及 `tools/vectors/ov2-0918.vectors.json` 全 64 条的 alphabet 字段"
        "（该文件 meta.source 亦指向 ov2.js d6f1c411…）。"
        "★ 垫**未反推**（0918 无 trace 的 keyRaw/keyQBLZ6 对）故置 None："
        "ot/window 路径仍按「不猜」报错；--key-hex / --trace 路径可用。"
        "⚠ 上述向量文件的 maskHex 是**占位桩**（其 meta.maskIsStub=true，沿用 0916-11 的 "
        "sGabkxvHwYuNfTtN），**不得据它登记 0918-17 的垫**。"
        "（buildConstants: alphabetSourceLine ov2.js:955 / accessorShift -317 / "
        "rotateChecksum 541024 / rotateIterations 337）",
    ),
    # 既有 trace 语料的实际产生者（本次新增；非 team-lead 原始清单项）
    "0916-00": Build(
        "0916-00",
        "ZQCW6toK7rkV3IAhngasJ9EcSXy1NTGjOBmbqUvdxpLP8-izlYu5FRM24+0fHw$De",
        b"sGabkxvHwYuNfTtN",
        "68d4396a54ab817e3c6a5477b145d89c",
        "trace-backups 全部 payload trace 的产生者；表 = ov2-0916-00.pristine.js "
        "L1559（与文档 ov2-0916-00-payload-closure.md §1.5 的静态确认一致）；"
        "垫 15/15 组实测零反例",
    ),
}  # type: Dict[str, Build]


def md5_file(path):
    """文件 md5（十六进制小写）。"""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_alphabet(text):
    """从源码文本里提取该 build 的自定义 base64 表。

    判定：全文找 65 字符的 `[A-Za-z0-9+\\-$]` 连续串，要求**65 个字符互不相同**
    （真正的表是 65 字符集的一次洗牌；长 base64 字面量里的随机 65 字符窗口几乎
    必然含重复字符）。实测每个 build 件里这样的串**恰好唯一**。

    - 命中 1 个 -> 返回该表；0 个 -> 返回 None（交调用方决定报错）。
    - 命中 >1 个 -> 抛 ValueError（有歧义，不猜）。
    """
    if not isinstance(text, str):
        raise TypeError("extract_alphabet 需要 str")
    cands = []
    seen = set()
    for m in _ALPHABET_RUN.finditer(text):
        s = m.group(0)
        if s in seen:
            continue
        seen.add(s)
        if len(set(s)) == 65:
            cands.append(s)
    if not cands:
        return None
    if len(cands) > 1:
        raise ValueError("提取到 %d 个候选 65 字符表，有歧义（不猜）：%s"
                         % (len(cands), cands[:4]))
    return cands[0]


def match_alphabet(alphabet):
    """按**表指纹**在 BUILDS 里找 build；找不到返回 None（不猜，交调用方报错）。

    判定 = 表字符串**全等**；另外兼容两种「长度差 1」的历史形态（登记表只存了
    64 字符前缀 / 提取到的是 64 字符表）——前缀相等也算同一 build。
    之所以能按表认 build：每个 build 的表都是 65 字符集的一次整体洗牌，实测
    相邻 build 完全不同且无命名/时间规律（见模块 docstring）。
    """
    if not isinstance(alphabet, str):
        raise TypeError("match_alphabet 需要 str")
    for b in BUILDS.values():
        if b.alphabet == alphabet:
            return b
        if len(alphabet) == 65 and b.alphabet == alphabet[:64]:   # 登记表只存 64 字符
            return b
        if len(alphabet) == 64 and b.alphabet[:64] == alphabet:   # 手头只有 64 字符
            return b
    return None


class TableNotRegistered(ValueError):
    """`detect_from_file` 专用：**表提取成功、但不在 BUILDS 注册表内**。

    与其它 ValueError（读文件失败/找不到表/表有歧义）分开，是因为两者的可用性不同：
    表本身从源码直读、**可信**，只是「这个 build 的垫未知」。调用方若只需表
    （按 key-hex/trace 解密）可以放行；若还需垫（ot/window 路线）必须继续拒绝。
    是 ValueError 子类 ⇒ 老的 ``except ValueError`` 行为不变（不猜原则不受影响）。
    """

    def __init__(self, path, alphabet):
        self.path = path
        self.alphabet = alphabet
        ValueError.__init__(
            self,
            "%s：提取到表 %s，但不在 BUILDS 注册表内（不猜）。"
            "已登记：%s；请用 --alphabet 显式给出，或先把该 build 登记进 ov2_builds.py"
            % (path, alphabet, sorted(BUILDS)))


def detect_from_file(path):
    """读源码件 -> 提取表 -> 与 BUILDS 精确匹配，返回 Build。

    未知一律抛错（不猜）：读文件失败/无表/表有歧义 -> ValueError；
    **表在但未登记** -> TableNotRegistered（它携带 .alphabet，供只需表
    的调用方放行——是否放行由调用方按「还需不需要垫」决定）。
    匹配以**表字符串全等**为准；md5 只作旁证，
    因为同一 build 的插桩/部署件（stage1..3 等）表相同而字节不同。
    """
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    alpha = extract_alphabet(text)
    if alpha is None:
        raise ValueError("%s：未找到 65 字符且互不相同的 base64 表" % path)
    b = match_alphabet(alpha)
    if b is not None:
        return b
    raise TableNotRegistered(path, alpha)


def list_builds():
    """返回 (name, alphabet 长度, mask 是否已知, src_md5) 的可打印摘要。"""
    rows = []
    for name in sorted(BUILDS):
        b = BUILDS[name]
        rows.append((name, len(b.alphabet), b.mask is not None, b.src_md5,
                     b.notes))
    return rows


if __name__ == "__main__":
    for name, n, has_mask, md5v, notes in list_builds():
        print("%-10s alphabet=%d chars mask=%s src_md5=%s"
              % (name, n, "yes" if has_mask else "NO", md5v or "(未登记)"))
        if notes:
            print("           %s" % notes)
