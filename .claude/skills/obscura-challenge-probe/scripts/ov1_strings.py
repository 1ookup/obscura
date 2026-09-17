#!/usr/bin/env python3
"""Readable string pool out of an ov1 bytecode blob.

The VM stores strings as `ch[Uk ^ ((b + 245) & 255) ^ 120]` with `ch[i] =
String.fromCharCode(i)` and a per-string key `Uk`. Sweeping all 256 keys and
extracting printable runs recovers the pool without executing anything.

The reference build's pool is where property names live, so this is the cheapest
way to see what a program does: `_cf_chl_opt`, `postMessage`, `widgetId` and the
obfuscated per-session field names all come out of it.

Usage: ov1_strings.py BLOB [--min-len N] [--ident-only]
"""
import argparse
import re
import sys

PRINTABLE = re.compile(rb"[ -~]{4,}")
IDENT = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")

# Noise the sweep cannot avoid: base64-looking runs and long digit strings show
# up under the wrong key. Keep them out of the default view unless asked for.
B64ISH = re.compile(r"^[A-Za-z0-9+/=]{20,}$")


def sweep(blob, min_len=6):
    """(offset, key, text) for every printable run under every key."""
    for key in range(256):
        table = bytes(((key ^ 120 ^ c) - 245) & 0xFF for c in range(256))
        decoded = blob.translate(table)
        for m in re.finditer(rb"[ -~]{%d,}" % min_len, decoded):
            yield m.start(), key, m.group().decode("latin-1")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("blob")
    ap.add_argument("--min-len", type=int, default=6)
    ap.add_argument("--ident-only", action="store_true")
    ap.add_argument("--show-noise", action="store_true")
    a = ap.parse_args()
    blob = open(a.blob, "rb").read()
    seen = {}
    for off, key, text in sweep(blob, a.min_len):
        if a.ident_only and not IDENT.match(text):
            continue
        if not a.show_noise and B64ISH.match(text):
            continue
        seen.setdefault(text, (off, key))
    print(f"{a.blob}: {len(blob)} B, {len(seen)} distinct runs")
    for text, (off, key) in sorted(seen.items(), key=lambda kv: kv[1][0]):
        print(f"  @{off:7d} key=0x{key:02x} {text!r}")


if __name__ == "__main__":
    sys.exit(main())
