#!/usr/bin/env python3
"""trace-summary.py <trace.jsonl> — 解析拼接式 JSON 对象流 tracelog，打印
记录数 / 解析错误偏移 / k 分布 / t 跨度 / 首尾样本。供轮壳归档与基线分析用。
"""
import collections
import json
import sys


def load_stream(path):
    """读拼接式 JSON 对象流（非行分隔）。返回 (recs, errors)。"""
    data = open(path, "rb").read().decode("utf-8", errors="replace")
    dec = json.JSONDecoder()
    i, n, recs, errors = 0, len(data), [], []
    while i < n:
        while i < n and data[i] in " \n\r\t":
            i += 1
        if i >= n:
            break
        try:
            obj, i = dec.raw_decode(data, i)
            recs.append(obj)
        except Exception as e:
            errors.append((i, str(e)))
            break
    return recs, errors


def summarize(path, sample_first=3, sample_last=3, max_chars=200):
    recs, errors = load_stream(path)
    lines = []
    lines.append(f"file: {path}")
    lines.append(f"records: {len(recs)}  parse-errors: {len(errors)}")
    for off, msg in errors[:3]:
        lines.append(f"  parse stop at byte {off}: {msg}")
    ks = collections.Counter(r.get("k") for r in recs)
    lines.append("k distribution:")
    for k, c in sorted(ks.items(), key=lambda x: (-x[1], str(x[0]))):
        lines.append(f"  {c:6d}  {k}")
    ts = [r.get("t") for r in recs if isinstance(r.get("t"), (int, float))]
    if ts:
        lines.append(f"timeline: t0={min(ts)} tN={max(ts)} span={max(ts) - min(ts)} (t 的单位/基准未标定，仅作同侧排序参考)")
    lines.append(f"--- first {min(sample_first, len(recs))} ---")
    for r in recs[:sample_first]:
        lines.append("  " + json.dumps(r, ensure_ascii=False)[:max_chars])
    lines.append(f"--- last {min(sample_last, len(recs))} ---")
    for r in recs[-sample_last:]:
        lines.append("  " + json.dumps(r, ensure_ascii=False)[:max_chars])
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    print(summarize(sys.argv[1]))
