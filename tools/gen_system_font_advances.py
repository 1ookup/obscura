#!/usr/bin/env python3
"""Rewrite the bundled system fonts' ASCII advances to the reference values.

The DOM's `system-ui` face shapes from `assets/dejavu-sans.ttf` (and its bold
companion), and cosmic-text's wrap decisions read those glyph advances before
any identity-table correction runs, so a stand-in advance that differs from
macOS Chrome's SF makes "tttt hhhh" wrap onto two lines whenever the cell is
sized to the corrected width. Rewriting the hmtx advances to the measured
SF values (font-advances-ascii95-systemui14.json, produced by
cf-validator's Chrome probe) makes shaping, wrapping and the identity table
agree on one set of numbers.

Usage:
  uv run --with fonttools python tools/gen_system_font_advances.py <ascii95.json>

Glyph outlines are untouched; only advance widths change. Run from the repo
root; the bundled ttf files are rewritten in place.
"""
import json
import sys

from fontTools.ttLib import TTFont

ASSETS = {
    "400": "crates/obscura-render/assets/dejavu-sans.ttf",
    "700": "crates/obscura-render/assets/dejavu-sans-bold.ttf",
}
SIZE = 14.0


def main():
    data = json.load(open(sys.argv[1]))
    charset = data["charset"]
    for weight, path in ASSETS.items():
        chars = data["weights"][weight]["chars"]
        font = TTFont(path)
        cmap = font.getBestCmap()
        hmtx = font["hmtx"]
        upem = font["head"].unitsPerEm
        changed = 0
        for ch in charset:
            span_w = chars[ch]["spanW"]
            glyph = cmap.get(ord(ch))
            if glyph is None:
                continue
            units = round(span_w / SIZE * upem)
            adv, lsb = hmtx[glyph]
            if adv != units:
                hmtx[glyph] = (units, lsb)
                changed += 1
        font.save(path)
        print("%s: upem=%d changed=%d/%d" % (path, upem, changed, len(charset)))


if __name__ == "__main__":
    main()
