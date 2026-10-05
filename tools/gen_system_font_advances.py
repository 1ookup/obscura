#!/usr/bin/env python3
"""Rewrite the bundled system fonts' advances to the reference values.

The DOM's `system-ui` face shapes from `assets/dejavu-sans.ttf` (and its bold
companion), and cosmic-text's wrap decisions read those glyph advances before
any identity-table correction runs, so a stand-in advance that differs from
macOS Chrome's SF makes "tttt hhhh" wrap onto two lines whenever the cell is
sized to the corrected width. Rewriting the hmtx advances to the measured
SF values makes shaping, wrapping and the identity table agree on one set of
numbers.

Input: the spanW JSON `tools/gen_font_tables.py --spanw-out` writes (ASCII +
Latin-1, both weights, from the same Chrome canvas probe that generates
font_tables.rs). Characters the stand-in lacks a glyph for are skipped; a
zero advance (soft hyphen) is not emitted, keeping the stand-in's own value.

Usage:
  uv run --with fonttools python tools/gen_system_font_advances.py <spanw.json>

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
    # weight=path overrides let the same measurement shape rewrite another
    # family's stand-in (e.g. the Liberation face behind Arial).
    assets = dict(ASSETS)
    for arg in sys.argv[2:]:
        weight, path = arg.split("=", 1)
        assets[weight] = path
    charset = data.get("charset")
    weights = data.get("weights") or data
    for weight, path in assets.items():
        if weight not in weights:
            continue
        chars = weights[weight].get("chars") or weights[weight]["single"]
        font = TTFont(path)
        cmap = font.getBestCmap()
        hmtx = font["hmtx"]
        upem = font["head"].unitsPerEm
        changed = 0
        for ch in (charset or list(chars.keys())):
            entry = chars[ch]
            span_w = entry["spanW"] if isinstance(entry, dict) else entry
            glyph = cmap.get(ord(ch))
            if glyph is None:
                continue
            units = round(span_w / SIZE * upem)
            adv, lsb = hmtx[glyph]
            if adv != units:
                hmtx[glyph] = (units, lsb)
                changed += 1
        font.save(path)
        print(
            "%s: upem=%d changed=%d/%d"
            % (path, upem, changed, len(charset or chars))
        )


if __name__ == "__main__":
    main()
