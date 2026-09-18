#!/usr/bin/env bash
# ov2 payload 解密 · 自包含 wrapper（skill: ov2-payload-decrypt）
#
# 用法:
#   ./decrypt.sh <body-file> [key-hex] [ov2js-path] [out-dir]
#
#   body-file   ：抓包导出的 POST body（自定义 base64 密文，纯文本文件）
#   key-hex     ：16 字节 key（32 hex）。缺省用下方 DEFAULT_KEY
#   ov2js-path  ：本机 ov2.js 路径（给它就自动提表，**优先于内置表**）
#   out-dir     ：输出目录（缺省 /tmp/ov2-dec）
#
# 内置默认值（2026-09-18 实机实测；机制见 SKILL.md「固定 key」）:
#   DEFAULT_KEY  = 固定 patch 产出的常量 key（W 常量 ⊕ 垫；垫未轮换时跨 build 稳定）
#   DEFAULT_TABLE= 该日线上 base64 表（**随 build 每 ~2h 轮换**——过期症状：报
#                  「字符不在表中」；处置：传 ov2js-path，或更新本变量）
#   （垫 sGabkxvHwYuNfTtN，仅供 --ot-hex 路线使用，本 wrapper 不用）
#
# 退出码: 0=成功 / 1=不可解（key 不符等） / 2=输入或参数错
set -euo pipefail

DEFAULT_KEY='0954fd238920cb4e832366d227b62cf3'
DEFAULT_TABLE='zg8x2HkFDVWAOyj6-ibGa3KRpXIC7Q4YMLB+Tnmqc1wNvrP5fS0sduJ$tUelZhoE9'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 1 ]; then
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi

BODY="$1"
KEY="${2:-$DEFAULT_KEY}"
OV2JS="${3:-}"
OUT="${4:-/tmp/ov2-dec}"

ARGS=(--body-file "$BODY" --key-hex "$KEY" --out-dir "$OUT" --roundtrip --print json)
if [ -n "$OV2JS" ]; then
  ARGS+=(--ov2js "$OV2JS")
else
  ARGS+=(--alphabet "$DEFAULT_TABLE")
fi

if command -v uv >/dev/null 2>&1; then
  exec uv run python "$HERE/ov2_payload_codec.py" "${ARGS[@]}"
else
  exec python3 "$HERE/ov2_payload_codec.py" "${ARGS[@]}"
fi
