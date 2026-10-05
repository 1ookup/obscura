#!/usr/bin/env python3
"""Regenerate the system-ui advance tables in font_tables.rs from a Chrome
canvas probe.

The tables answer what the reference browser (Chrome) measures for 14px
system-ui. Values are integer font units at upem 4096 (unit = px * 4096 / 14),
i.e. twice the 2048 units the probe resolves, so the f32 literals are exact.

Usage:
  uv run --no-project python tools/gen_font_tables.py <probe.json> [--apply]
                                [--spanw-out <path.json>]

The probe JSON shape (canonical producer: the t2-canvas4.js run in the CF
parity notes):

  {"reg":  {"singles": {char: px}, "pairs": {"a,b": kern_px}},
   "bold": {...}}

`--spanw-out` writes the spanW JSON tools/gen_system_font_advances.py
consumes (ASCII + Latin-1, both weights), so the bundled stand-in ttfs agree
with the tables. Without --apply the script only reports.
"""
import argparse
import json
import re

SRC = "crates/obscura-render/src/font_tables.rs"
UPEM = 4096.0
SIZE = 14.0
ASCII = [chr(c) for c in range(0x20, 0x7F)]
LATIN1 = [chr(c) for c in range(0xA0, 0x100)]


def to_units(px):
    v = px * UPEM / SIZE
    r = round(v)
    if abs(v - r) > 1e-6:
        raise SystemExit("non-integer unit: %r px -> %r" % (px, v))
    return r


def table_data(entry):
    singles = entry["singles"]
    for ch in ASCII + LATIN1:
        if ch not in singles:
            raise SystemExit("probe missing single for U+%04X" % ord(ch))
    ascii_vals = [to_units(singles[ch]) for ch in ASCII]
    latin1_vals = [to_units(singles[ch]) for ch in LATIN1]
    kern = []
    for key, k in entry["pairs"].items():
        if len(key) != 3 or key[1] != ",":
            raise SystemExit("bad pair key %r" % key)
        a, b = ord(key[0]), ord(key[2])
        for code in (a, b):
            if not 0x20 <= code <= 0x7E and not 0xA0 <= code <= 0xFF:
                raise SystemExit("pair %r out of domain" % key)
        v = to_units(k)
        if not -32768 <= v <= 32767:
            raise SystemExit("kern %r out of i16 range: %d" % (key, v))
        if v == 0:
            raise SystemExit("zero kern survived the probe filter: %r" % key)
        kern.append(((a << 16) | b, v))
    kern.sort()
    return ascii_vals, latin1_vals, kern


def fmt_floats(vals):
    return ", ".join("%d.0" % v for v in vals)


def fmt_kern(kern):
    return ", ".join("(0x%08X, %d)" % (k, v) for k, v in kern)


def spanw(entry):
    chars = {}
    for ch in ASCII + LATIN1:
        u = to_units(entry["singles"][ch])
        if u == 0:
            # No glyph advance (soft hyphen); keep the stand-in's own value.
            continue
        chars[ch] = {"spanW": u * SIZE / UPEM}
    return {"chars": chars}


def anchors_of(lines):
    return [i for i, l in enumerate(lines) if l.strip() == 'family: "system-ui",']


def apply_tables(src_path, tables):
    text = open(src_path, encoding="utf-8").read()
    lines = text.split("\n")
    anchors = anchors_of(lines)
    if len(anchors) != 2:
        raise SystemExit("want 2 system-ui anchors, found %d" % len(anchors))
    for name, ai in zip(("bold", "reg"), anchors):
        ind = "    " if name == "bold" else "        "
        a, l, k = tables[name]
        for off, field in ((1, "upem:"), (2, "ascii:"), (3, "latin1:"),
                           (4, "kern:")):
            if not lines[ai + off].strip().startswith(field):
                raise SystemExit("anchor+%d is not %s: %r"
                                 % (off, field, lines[ai + off][:50]))
        lines[ai + 1] = ind + "upem: 4096.0,"
        lines[ai + 2] = ind + "ascii: &[" + fmt_floats(a) + "],"
        lines[ai + 3] = ind + "latin1: &[" + fmt_floats(l) + "],"
        lines[ai + 4] = ind + "kern: &[" + fmt_kern(k) + "],"

    # Comment edits, highest line numbers first so earlier indexes hold.
    # Other tables carry the same note text, so anchor both to their table.
    bold_ai, reg_ai = anchors

    # Regular table note: the line above its FontTable opening (anchor-2).
    rn = reg_ai - 2
    if not lines[rn].strip().startswith(
            "// measured from the reference browser (tools/measure_oracle_fonts.py)"):
        raise SystemExit("reg table header comment not at anchor-2: %r"
                         % lines[rn][:60])
    lines[rn] = lines[rn].replace("measure_oracle_fonts.py",
                                  "gen_font_tables.py")

    # Bold table header comment (anchor-4): the table is no longer empty.
    bh = bold_ai - 4
    if (not lines[bh].startswith(
            "/// system-ui (the system font, SF) bold advances")
            or "Empty until the measurement lands" not in lines[bh + 1]):
        raise SystemExit("bold table header comment not at anchor-4: %r"
                         % lines[bh][:60])
    lines[bh:bh + 3] = [
        "/// system-ui (the system font, SF) bold advances, measured from the",
        "/// reference browser (tools/gen_font_tables.py).",
    ]

    # File header: scope the regenerate note to the system-ui tables.
    old = "//! bundled stand-in's metrics. Regenerate with `tools/gen_font_tables.py`."
    hit = [i for i, l in enumerate(lines) if l == old]
    if len(hit) != 1:
        raise SystemExit("file header regenerate note: %d hits" % len(hit))
    lines[hit[0]:hit[0] + 1] = [
        "//! bundled stand-in's metrics. The system-ui tables are measured from",
        "//! the reference browser and regenerate with `tools/gen_font_tables.py`.",
    ]

    open(src_path, "w", encoding="utf-8").write("\n".join(lines))

    # Read back and compare value by value.
    lines = open(src_path, encoding="utf-8").read().split("\n")
    for name, ai in zip(("bold", "reg"), anchors_of(lines)):
        a, l, k = tables[name]
        got_a = [float(v) for v in re.findall(r"-?\d+\.\d+", lines[ai + 2])]
        got_l = [float(v) for v in re.findall(r"-?\d+\.\d+", lines[ai + 3])]
        got_k = [(int(h, 16), int(v)) for h, v in
                 re.findall(r"\((0x[0-9A-F]{8}), (-?\d+)\)", lines[ai + 4])]
        if got_a != [float(v) for v in a]:
            raise SystemExit("%s ascii read-back mismatch" % name)
        if got_l != [float(v) for v in l]:
            raise SystemExit("%s latin1 read-back mismatch" % name)
        if got_k != k:
            raise SystemExit("%s kern read-back mismatch" % name)
        print("[%s] written and verified: ascii=%d latin1=%d kern=%d"
              % (name, len(a), len(l), len(k)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("probe")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--spanw-out")
    args = ap.parse_args()
    data = json.load(open(args.probe))

    tables = {"bold": table_data(data["bold"]), "reg": table_data(data["reg"])}
    for name in ("reg", "bold"):
        a, l, k = tables[name]
        print("[%s] ascii=%d latin1=%d kern=%d  kern range [%d, %d]"
              % (name, len(a), len(l), len(k),
                 min(v for _, v in k), max(v for _, v in k)))
        dd = dict(k)
        print("  space=%g d=%g t=%g s=%g h=%g i=%g  's,s'=%d 'd,d'=%d 'T,c'=%d"
              % (a[0], a[ord("d") - 0x20], a[ord("t") - 0x20],
                 a[ord("s") - 0x20], a[ord("h") - 0x20], a[ord("i") - 0x20],
                 dd.get((ord("s") << 16) | ord("s"), 0),
                 dd.get((ord("d") << 16) | ord("d"), 0),
                 dd.get((ord("T") << 16) | ord("c"), 0)))

    if args.spanw_out:
        out = {"weights": {"700": spanw(data["bold"]), "400": spanw(data["reg"])}}
        with open(args.spanw_out, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1)
        print("wrote %s (spanW chars: %d/weight)"
              % (args.spanw_out, len(out["weights"]["400"]["chars"])))

    if not args.apply:
        print("dry run; pass --apply to rewrite %s" % SRC)
        return
    apply_tables(SRC, tables)


if __name__ == "__main__":
    main()
