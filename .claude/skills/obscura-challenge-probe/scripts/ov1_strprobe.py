#!/usr/bin/env python3
"""Read the VM string table out of an ov1 bytecode blob.

Encoding (pristine, per the operator's cx-payload-check notes):
    plaintext_char = (Uk ^ ((b + 245) & 255) ^ 120) & 255      # ch[] is fromCharCode(i)
so for a per-string key Uk the stored bytes are
    b = ((Uk ^ 120 ^ char) - 245) & 255
Searching for a known plaintext over (offset, key) recovers both the string and
its key. Zero execution, pure byte arithmetic.

Usage: strprobe.py BLOB needle [needle...]
"""
import sys


def find(blob, needle, key):
    """Return offsets where needle occurs under this key."""
    want = bytes((((key ^ 120 ^ c) - 245) & 0xFF) for c in needle.encode())
    out, start = [], 0
    while True:
        i = blob.find(want, start)
        if i < 0:
            return out
        out.append(i)
        start = i + 1


def decode_at(blob, off, key, maxlen=80):
    """Decode a plausible string starting at off under this key."""
    s = []
    k = key
    for i in range(off, min(off + maxlen, len(blob))):
        c = (k ^ ((blob[i] + 245) & 0xFF) ^ 120) & 0xFF
        if c == 0 or not (32 <= c < 127):
            break
        s.append(chr(c))
    return "".join(s)


def main():
    path, needles = sys.argv[1], sys.argv[2:]
    blob = open(path, "rb").read()
    print(f"{path}: {len(blob)} B")
    for needle in needles:
        hits = []
        for key in range(256):
            for off in find(blob, needle, key):
                hits.append((off, key))
        if hits:
            for off, key in hits:
                ctx = decode_at(blob, off - 8 if off >= 8 else 0, key, 90)
                print(f"  FOUND {needle!r} @{off} key=0x{key:02x} full={ctx!r}")
        else:
            print(f"  {needle!r}: not found under any of 256 keys")


if __name__ == "__main__":
    main()
