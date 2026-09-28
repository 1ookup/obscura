#!/usr/bin/env python3
"""Generate the per-family advance tables from the host's own font files.

The reference this engine targets is Chrome on this Mac, so the metrics a
probed family answers are the metrics of the font file macOS ships for it:
advances from `hmtx` plus the `kern` pairs between them. Both were verified
against the reference widths recorded in the challenge tracker before this
generator was written (a family with kern pairs, Times New Roman, differs from
the plain advance sum by exactly its 'rg' pair).

Usage: uv run --with fonttools gen_font_tables.py > font_tables.rs
"""
import glob, os, sys
from fontTools.ttLib import TTFont, TTCollection

DIRS = ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts',
        '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/*/AssetData',
        '/System/Library/AssetsV2/com_apple_MobileAsset_Font7/*/AssetData',
        '/System/Library/AssetsV2/com_apple_MobileAsset_Font6/*/AssetData']

# The families the challenge probes that exist on this host, plus the macOS
# families the reference resolves with their own metrics. Names absent from the
# host resolve to the fallback face, which this engine already matches.
FAMILIES = [
    'Helvetica', 'Helvetica Neue', 'Arial', 'Arial Black', 'Arial Narrow',
    'Arial Unicode MS', 'Times', 'Times New Roman', 'Courier', 'Courier New',
    'Menlo', 'Monaco', 'Geneva', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia',
    'Comic Sans MS', 'Impact', 'Webdings', 'Wingdings', 'Symbol', 'Zapfino',
    'Papyrus', 'Copperplate', 'Optima', 'Futura', 'Baskerville', 'Didot',
    'Chalkboard', 'Skia', 'Apple Symbols', 'Galvji', 'Luminari', 'InaiMathi',
    'Apple Chancery', 'Apple LiGothic', 'Herculanum', 'Kokonor', 'Marker Felt',
    'Palatino', 'Papyrus', 'Skia', 'STHeiti', 'Songti SC', 'Heiti SC',
    'Hiragino Sans', 'Hiragino Sans GB', 'PingFang SC', 'PingFang TC',
    'PingFang HK', 'Lucida Grande', 'Lucida Sans Unicode', 'AppleGothic',
    'Ayuthaya', 'Baghdad', 'Baskerville', 'Charter', 'Cochin', 'Damascus',
    'Euphemia UCAS', 'Futura', 'Gill Sans', 'Hoefler Text', 'Lantinghei SC',
    'LiSong Pro', 'Malayalam MN', 'Microsoft Sans Serif', 'Nadeem', 'Noto Sans',
    'Sathu', 'Silom', 'Sinhala MN', 'Superclarendon', 'Tamil MN', 'Thonburi',
    'Tibetan MN', 'Waseem', 'Yuanti SC', 'Kaiti SC', 'Heiti TC',
]

ASCII = list(range(0x20, 0x7F))
LATIN1 = list(range(0xA0, 0x100))
PUNCT = [0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2013, 0x2014]


def files():
    out = []
    for d in DIRS:
        for pat in ('*.ttf', '*.otf', '*.ttc', '*.otc'):
            out.extend(glob.glob(os.path.join(d, pat)))
    return sorted(set(out))


def faces(path):
    if path.lower().endswith(('.ttc', '.otc')):
        try:
            return TTCollection(path).fonts
        except Exception:
            return []
    try:
        return [TTFont(path)]
    except Exception:
        return []


def meta(font):
    try:
        name = font['name']
        family = (name.getDebugName(16) or name.getDebugName(1) or '').strip()
        sub = (name.getDebugName(17) or name.getDebugName(2) or '').strip()
        weight = font['OS/2'].usWeightClass if 'OS/2' in font else 400
        width_class = font['OS/2'].usWidthClass if 'OS/2' in font else 5
        return family, sub, weight, width_class
    except Exception:
        return '', '', None, None


def index():
    out = {}
    for path in files():
        for font in faces(path):
            family, sub, weight, width_class = meta(font)
            if not family:
                continue
            out.setdefault(family.lower(), []).append(
                {'path': path, 'font': font, 'sub': sub, 'weight': weight, 'width': width_class})
    return out


def css400(candidates):
    """CSS font matching at weight 400 and normal width."""
    for wanted in ((5, 400),):
        for candidate in candidates:
            if candidate['width'] == wanted[0] and candidate['weight'] == wanted[1]:
                return candidate
    for candidate in candidates:
        if candidate['width'] == 5 and 'regular' in (candidate['sub'] or '').lower():
            return candidate
    normal = [c for c in candidates if c['width'] == 5]
    if normal:
        return sorted(normal, key=lambda c: abs((c['weight'] or 400) - 400))[0]
    return candidates[0]


# Reference widths for `Hamburgefonstiv` at 16px, recorded from the passing
# Chrome sessions (the challenge tracker's font table). A family with several
# faces on this host -- Times New Roman's Italic, Hiragino's W3..W9, Skia's
# light and regular -- is resolved by the face that reproduces the reference,
# which is the CSS weight-400 answer in every case checked. Families without a
# recorded reference fall back to CSS font matching.
REFERENCE_WIDTHS = {
    'helvetica': 120.945, 'helvetica neue': 122.24, 'arial': 120.945,
    'times': 111.695, 'times new roman': 111.688, 'courier': 144.023,
    'courier new': 144.023, 'menlo': 144.492, 'monaco': 144.023,
    'geneva': 131.734, 'verdana': 137.578, 'tahoma': 120.023,
    'trebuchet ms': 121.25, 'georgia': 124.148, 'comic sans ms': 128.18,
    'impact': 113.109, 'webdings': 232.938, 'wingdings': 207.563,
    'zapfino': 156.12, 'papyrus': 121.344, 'copperplate': 142.256,
    'optima': 117.968, 'futura': 122.938, 'baskerville': 111.734,
    'didot': 124.864, 'chalkboard': 119.266, 'apple symbols': 93.5391,
    'galvji': 138.4922, 'luminari': 130.2399, 'skia': 125.3359,
    'inaimathi': 106.7199, 'hiragino sans': 140.9599, 'pingfang sc': 126.5119,
    'hiragino sans gb': 137.248, 'stheiti': 132.448, 'songti sc': 114.4,
    'heiti sc': 132.448, 'arial unicode ms': 120.945, 'system-ui': 124.813,
    'blinkmacsystemfont': 124.813, 'segoe ui': 144.492,
}


def width_in_units(font, text='Hamburgefonstiv'):
    try:
        cmap = font.getBestCmap()
        hmtx = font['hmtx']
        upem = font['head'].unitsPerEm
    except Exception:
        return None
    if not cmap:
        return None
    glyphs = []
    for ch in text:
        glyph = cmap.get(ord(ch))
        if glyph is None:
            return None
        glyphs.append(glyph)
    total = sum(hmtx[glyph][0] for glyph in glyphs)
    if 'kern' in font:
        for sub in getattr(font['kern'], 'kernTables', []):
            pair_table = getattr(sub, 'kernTable', None)
            if not pair_table:
                continue
            for i in range(len(glyphs) - 1):
                total += pair_table.get((glyphs[i], glyphs[i + 1]), 0)
    return total * 16.0 / upem


def table_for(entry):
    font = entry['font']
    cmap = font.getBestCmap()
    hmtx = font['hmtx']
    upem = font['head'].unitsPerEm
    if not cmap or not all(cmap.get(code) for code in range(0x41, 0x5B)):
        raise ValueError('no Latin coverage')
    ascii_values, latin1_values = [], []
    for code in ASCII:
        glyph = cmap.get(code)
        ascii_values.append(float(hmtx[glyph][0]) if glyph else 0.0)
    for code in LATIN1:
        glyph = cmap.get(code)
        latin1_values.append(float(hmtx[glyph][0]) if glyph else 0.0)
    kern = {}
    if 'kern' in font:
        for sub in getattr(font['kern'], 'kernTables', []):
            pair_table = getattr(sub, 'kernTable', None)
            if not pair_table:
                continue
            # Only the pairs between characters this table can answer for.
            covered = {}
            for code in ASCII + LATIN1 + PUNCT:
                glyph = cmap.get(code)
                if glyph:
                    covered[glyph] = code
            for (first, second), value in pair_table.items():
                if first in covered and second in covered:
                    key = (covered[first] << 16) | covered[second]
                    kern[key] = kern.get(key, 0) + value
    return upem, ascii_values, latin1_values, kern, entry['path'], entry['sub']


def rust_f32(value):
    return repr(round(value, 4))


def main():
    families = index()
    emitted, skipped = [], []
    seen = set()
    for name in FAMILIES:
        key = name.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        candidates = families.get(key)
        if not candidates:
            skipped.append(name)
            continue
        entry = css400(candidates)
        want = REFERENCE_WIDTHS.get(key)
        if want is not None:
            for candidate in candidates:
                if candidate['width'] != 5:
                    continue
                measured = width_in_units(candidate['font'])
                if measured is not None and abs(measured - want) < 0.002:
                    entry = candidate
                    break
        try:
            upem, ascii_values, latin1_values, kern, path, sub = table_for(entry)
        except Exception as error:
            skipped.append(f'{name} ({error})')
            continue
        emitted.append((name, upem, ascii_values, latin1_values, kern, path, sub))
    print('// Generated by tools/gen_font_tables.py from the fonts macOS ships.',
          file=sys.stderr)
    print(f'// families: {len(emitted)}, skipped: {len(skipped)}', file=sys.stderr)
    for name in skipped:
        print('//   skipped:', name, file=sys.stderr)

    print('//! Per-family advance tables, generated from the host\'s own font files.')
    print('//!')
    print('//! A CSS family this list carries answers the advances macOS\'s font for it')
    print('//! answers, kerning included; a family it does not carry keeps the bundled')
    print('//! stand-in\'s metrics. Regenerate with `tools/gen_font_tables.py`.')
    print()
    print('/// One family: advances in font units for ASCII and Latin-1, plus the kern')
    print('/// pairs between the covered characters keyed as `(first << 16) | second`.')
    print('pub struct FontTable {')
    print('    pub family: &\'static str,')
    print('    pub upem: f32,')
    print('    pub ascii: &\'static [f32],')
    print('    pub latin1: &\'static [f32],')
    print('    pub kern: &\'static [(u32, i16)],')
    print('}')
    print()
    print('pub static FONT_TABLES: &[FontTable] = &[')
    for name, upem, ascii_values, latin1_values, kern, path, sub in emitted:
        print('    FontTable {')
        print('        family: "' + name.replace('"', '\\"') + '",')
        print(f'        upem: {float(upem):.1f},')
        print('        ascii: &[' + ', '.join(rust_f32(v) for v in ascii_values) + '],')
        print('        latin1: &[' + ', '.join(rust_f32(v) for v in latin1_values) + '],')
        if kern:
            pairs = ', '.join(f'(0x{key:08X}, {value})' for key, value in sorted(kern.items()))
            print(f'        kern: &[{pairs}],')
        else:
            print('        kern: &[],')
        print('    },')
    print('];')
    print()
    print('/// The table for a CSS family name, matched case-insensitively.')
    print('pub fn table_for_family(family: &str) -> Option<&\'static FontTable> {')
    print('    FONT_TABLES.iter().find(|table| table.family.eq_ignore_ascii_case(family))')
    print('}')


main()
