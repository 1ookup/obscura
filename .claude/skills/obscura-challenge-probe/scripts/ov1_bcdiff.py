#!/usr/bin/env python3
"""Byte-level diff of two ov1 bytecode blobs, with printable-run extraction."""
import re
import sys


def load(p):
    return open(p, "rb").read()


def common_prefix(a, b):
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def common_suffix(a, b):
    n = min(len(a), len(b))
    i = 0
    while i < n and a[len(a) - 1 - i] == b[len(b) - 1 - i]:
        i += 1
    return i


def runs(buf, minlen=4):
    """Printable ASCII runs (the bytecode's string table is plaintext)."""
    out = []
    for m in re.finditer(rb"[ -~]{%d,}" % minlen, buf):
        out.append((m.start(), m.group().decode("latin-1")))
    return out


def main():
    ra, rb = sys.argv[1], sys.argv[2]
    a, b = load(ra), load(rb)
    print(f"A {ra} {len(a)}B\nB {rb} {len(b)}B")
    p, s = common_prefix(a, b), common_suffix(a, b)
    print(f"common prefix={p} suffix={s}")
    if p + s >= min(len(a), len(b)):
        print("=> B is a prefix/suffix variant of A (one is contained in the other)")
    wa, wb = a[p:len(a) - s], b[p:len(b) - s]
    print(f"\n--- A window @{p} len={len(wa)} ---")
    for off, txt in runs(wa, 5):
        print(f"  A+{p+off}: {txt[:200]!r}")
    print(f"\n--- B window @{p} len={len(wb)} ---")
    for off, txt in runs(wb, 5):
        print(f"  B+{p+off}: {txt[:200]!r}")


if __name__ == "__main__":
    main()
