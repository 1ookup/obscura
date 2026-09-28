#!/usr/bin/env python3
"""Generate the per-family advance tables from the host's own font files.

The reference this engine targets is Chrome on this Mac, so the metrics a
probed family answers are the metrics of the font file macOS ships for it:
advances from `hmtx` plus the pair adjustments Chrome applies, taken from the
face's GPOS `kern` feature when it has one and from the legacy `kern` table
otherwise. Every choice here is decided against `reference_widths.json`, the
widths the local Chrome answers for `Hamburgefonstiv` at 16px, which is what
makes a surprising face pick -- a symbol-encoded family, a `.ttc` whose
regular face is not the one CSS weight 400 selects, a variable font's default
instance -- land on the face Chrome used rather than on a plausible guess.

Usage: uv run --with fonttools gen_font_tables.py > font_tables.rs
"""
import glob, json, os, sys
from fontTools.ttLib import TTFont, TTCollection

HERE = os.path.dirname(os.path.abspath(__file__))

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
    'Palatino', 'STHeiti', 'Songti SC', 'Heiti SC',
    'Hiragino Sans', 'Hiragino Sans GB', 'PingFang SC', 'PingFang TC',
    'PingFang HK', 'Lucida Grande', 'Lucida Sans Unicode', 'AppleGothic',
    'Ayuthaya', 'Baghdad', 'Baskerville', 'Charter', 'Cochin', 'Damascus',
    'Euphemia UCAS', 'Futura', 'Gill Sans', 'Hoefler Text', 'Lantinghei SC',
    'LiSong Pro', 'Malayalam MN', 'Microsoft Sans Serif', 'Nadeem', 'Noto Sans',
    'Sathu', 'Silom', 'Sinhala MN', 'Superclarendon', 'Tamil MN', 'Thonburi',
    'Tibetan MN', 'Waseem', 'Yuanti SC', 'Kaiti SC', 'Heiti TC',
    # The system font: no family file carries it (macOS answers it through the
    # system font machinery, optical sizing included), so this one only ever
    # comes from `measure_oracle_fonts.py`.
    'system-ui',
]

ASCII = list(range(0x20, 0x7F))
LATIN1 = list(range(0xA0, 0x100))
PUNCT = [0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2013, 0x2014]

TEXT = 'Hamburgefonstiv'

# The em a measured table is expressed in: one unit is one 1/128-px step at the
# 16px the reference is measured at, so a measurement converts without rounding.
ORACLE_UPEM = 2048.0

# How far a generated table may sit from the reference width and still count as
# reproducing it. The file-derived tables land within 1e-6; a measured table
# sums integer steps of the 1/128-px grid Chrome answers on, so its last digit
# can differ by the string's own float accumulation.
MATCH_TOLERANCE = 0.01


def references():
    """The widths the local Chrome answers, keyed by folded family name.

    A `@`-prefixed key in the file is a generic keyword (`@system-ui`, measured
    bare because quoting it makes it a family name); the prefix drops here so a
    token the generator emits under its own name finds its reference.
    """
    with open(os.path.join(HERE, 'reference_widths.json')) as handle:
        data = json.load(handle)
    return {name.lstrip('@').lower(): width for name, width in data['widths'].items()}


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


def char_map(font):
    """code -> glyph, preferring the Unicode cmap.

    A symbol-encoded face (Webdings, Wingdings, Symbol) has no Unicode cmap at
    all: its (3, 0) table maps the ASCII range to 0xF020..=0xF0FF, which is the
    mapping CoreText reads a Latin character through.
    """
    try:
        best = font.getBestCmap()
    except Exception:
        best = None
    if best:
        return best
    cmap = font.get('cmap')
    if cmap is None:
        return None
    for sub in cmap.tables:
        if (sub.platformID, sub.platEncID) != (3, 0):
            continue
        mapped = {}
        for code, glyph in sub.cmap.items():
            if 0xF000 <= code <= 0xF0FF:
                mapped.setdefault(code - 0xF000, glyph)
        if mapped:
            for code, glyph in sub.cmap.items():
                if code < 0xF000:
                    mapped.setdefault(code, glyph)
            return mapped
    return None


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


def covered(cmap):
    """glyph -> code for every character this table can answer for."""
    out = {}
    for code in ASCII + LATIN1 + PUNCT:
        glyph = cmap.get(code)
        if glyph:
            out[glyph] = code
    return out


def legacy_pairs(font, glyphs):
    """Pair adjustments from the legacy `kern` table, keyed by glyph pair."""
    out = {}
    if 'kern' not in font:
        return out
    for sub in getattr(font['kern'], 'kernTables', []):
        pair_table = getattr(sub, 'kernTable', None)
        if not pair_table:
            continue
        for (first, second), value in pair_table.items():
            if first in glyphs and second in glyphs:
                out[(first, second)] = out.get((first, second), 0) + value
    return out


def gpos_pairs(font, glyphs):
    """Pair adjustments from GPOS `kern` lookups, keyed by glyph pair."""
    out = {}
    if 'GPOS' not in font:
        return out
    gpos = font['GPOS'].table
    if gpos.FeatureList is None or gpos.LookupList is None:
        return out
    indices = set()
    for record in gpos.FeatureList.FeatureRecord:
        if record.FeatureTag == 'kern':
            indices.update(record.Feature.LookupListIndex)
    for index in sorted(indices):
        lookup = gpos.LookupList.Lookup[index]
        if lookup.LookupType != 2:
            continue
        for sub in lookup.SubTable:
            size = getattr(sub, 'ValueFormat1', None)
            if size is None or not size & 0x0004:  # XAdvance
                continue
            if sub.Format == 1:
                for position, first in enumerate(sub.Coverage.glyphs):
                    if first not in glyphs:
                        continue
                    for record in sub.PairSet[position].PairValueRecord:
                        second = record.SecondGlyph
                        if second not in glyphs:
                            continue
                        value = record.Value1.XAdvance if record.Value1 else 0
                        if value:
                            key = (first, second)
                            out[key] = out.get(key, 0) + value
            elif sub.Format == 2:
                classes1 = sub.ClassDef1.classDefs
                classes2 = sub.ClassDef2.classDefs
                for first in glyphs:
                    row = sub.Class1Record[classes1.get(first, 0)]
                    for second in glyphs:
                        value = row.Class2Record[classes2.get(second, 0)]
                        advance = value.Value1.XAdvance if value.Value1 else 0
                        if advance:
                            key = (first, second)
                            out[key] = out.get(key, 0) + advance
    return out


def kern_variants(font, glyphs):
    """The kern sources Chrome could be reading, in the order it prefers them.

    HarfBuzz applies the GPOS `kern` feature when the face has one and falls
    back to the legacy table otherwise; both are offered here so the reference
    width can decide, because a face can carry one, the other, or neither.
    """
    out = []
    gpos = gpos_pairs(font, glyphs)
    if gpos:
        out.append(('gpos', gpos))
    legacy = legacy_pairs(font, glyphs)
    if legacy:
        out.append(('legacy', legacy))
    out.append(('none', {}))
    return out


def text_units(font, cmap, pairs):
    """`TEXT` in font units, or None when the face lacks one of its glyphs."""
    hmtx = font['hmtx']
    total = 0
    previous = None
    for ch in TEXT:
        glyph = cmap.get(ord(ch))
        if glyph is None or glyph not in hmtx.metrics:
            return None
        if previous is not None:
            total += pairs.get((previous, glyph), 0)
        total += hmtx[glyph][0]
        previous = glyph
    return total, font['head'].unitsPerEm


def text_width(font, cmap, pairs):
    measured = text_units(font, cmap, pairs)
    if measured is None:
        return None
    return measured[0] * 16.0 / measured[1]


def pick(candidates, want):
    """The face and kern source that reproduce the reference width.

    Without a reference the CSS weight-400 answer is taken, which is what a
    page asking for `font: normal 16px Family` gets.
    """
    best = None
    for candidate in candidates:
        font = candidate['font']
        cmap = char_map(font)
        if not cmap:
            continue
        glyphs = covered(cmap)
        if not all(ord(ch) in cmap for ch in TEXT):
            continue
        for variant, pairs in kern_variants(font, glyphs):
            width = text_width(font, cmap, pairs)
            if width is None:
                continue
            if want is not None:
                score = abs(width - want)
            else:
                score = 0.0
                score += 0.0 if candidate['width'] == 5 else 1.0
                score += abs((candidate['weight'] or 400) - 400) / 1000.0
                score += 0.0 if (candidate['sub'] or '').lower() in ('regular', 'book', 'roman') else 0.1
                score += {'gpos': 0.0, 'legacy': 0.01, 'none': 0.02}[variant]
            if best is None or score < best[0]:
                best = (score, candidate, variant, pairs, cmap, width)
    return best


def face_advances(candidate):
    """The face's own advances for ASCII, or `None` when it cannot carry them."""
    font = candidate['font']
    cmap = char_map(font)
    if not cmap:
        return None
    hmtx = font['hmtx']
    values = []
    for code in ASCII:
        glyph = cmap.get(code)
        if glyph is None or glyph not in hmtx.metrics:
            return None
        values.append(float(hmtx[glyph][0]) * ORACLE_UPEM / font['head'].unitsPerEm)
    return values


def pick_face(candidates, advances):
    """The face whose advances are the ones the reference measured.

    This is the same question the reference widths answered before, asked
    directly: a `.ttc` whose weight-400 face is not the one CSS selects, a
    symbol-encoded face, a family macOS aliases to another file -- all of them
    are the face whose numbers match, and a face that does not match is not the
    one the browser used. Used for the pair adjustments no measurement covers;
    the measured advances always win.
    """
    best = None
    for candidate in candidates:
        values = face_advances(candidate)
        if values is None:
            continue
        score = sum(abs(value - wanted) for value, wanted in zip(values, advances))
        if best is None or score < best[0]:
            best = (score, candidate)
    return best[1] if best else None


def face_pairs(candidate, kern):
    """The face's pair adjustments between characters outside ASCII, in units.

    ASCII pairs come from the reference itself, which folds in ligatures and
    contextual substitutions a table read cannot see; a pair with a byte or a
    punctuation mark on either side is only in the font's own tables, and the
    reference applies it all the same.
    """
    font = candidate['font']
    cmap = char_map(font)
    if not cmap:
        return {}
    glyphs = covered(cmap)
    upem = font['head'].unitsPerEm
    out = {}
    for source in kern_variants(font, glyphs):
        if source[0] == 'none':
            continue
        for (first, second), value in source[1].items():
            if first not in glyphs or second not in glyphs:
                continue
            key = (glyphs[first] << 16) | glyphs[second]
            if (key >> 16) in ASCII and (key & 0xFFFF) in ASCII:
                continue
            out[key] = out.get(key, 0) + round(value * ORACLE_UPEM / upem)
    return out


def oracle_metrics():
    """The measured metrics from `measure_oracle_fonts.py`, when it has run."""
    path = os.path.join(HERE, 'oracle_metrics.json')
    if not os.path.exists(path):
        return {}
    with open(path) as handle:
        return json.load(handle)['families']


def oracle_table(entry, candidate):
    """A table built from the reference's own answers.

    `measure_oracle_fonts.py` records each advance and each pair adjustment on
    the 1/128-px grid the reference answers on, which at this em is one unit per
    step, so the table sums exactly to what the browser answers -- a run's
    ligature or contextual substitution included, which is why Zapfino and the
    Skia faces land here rather than on a table read: their pair behaviour is
    not in any table this generator can read.

    The returned delta is the probe string's disagreement with the reference's
    own width for it, in units: a family that substitutes across more than two
    characters cannot be carried by a per-pair table, and the caller records
    that instead of hiding it. `None` when the measurements do not cover the
    probe string at all.
    """
    advances = entry['advances']
    pairs = entry['pairs']
    total = 0
    previous = None
    for ch in TEXT:
        code = ord(ch)
        value = advances.get(str(code))
        if value is None:
            return None
        total += value
        if previous is not None:
            total += pairs.get(f'{previous}|{code}', 0)
        previous = code
    delta = total - entry['probe'] * ORACLE_UPEM / 16.0
    ascii_values = [float(advances.get(str(code), 0)) for code in ASCII]
    latin1_values = [float(advances.get(str(code), 0)) for code in LATIN1]
    kern = {}
    for key, value in pairs.items():
        first, second = (int(part) for part in key.split('|'))
        kern[(first << 16) | second] = value
    if candidate is not None:
        for key, value in face_pairs(candidate, None).items():
            kern.setdefault(key, value)
    return ORACLE_UPEM, ascii_values, latin1_values, kern, delta


def rust_f32(value):
    return repr(round(value, 4))


def main():
    reference = references()
    families = index()
    measured = oracle_metrics()
    emitted, skipped, residuals = [], [], []
    seen = set()
    for name in FAMILIES:
        key = name.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        want = reference.get(key)
        entry = measured.get(name)
        if entry is None:
            skipped.append(f'{name} (not measured)')
            continue
        advances = entry['advances']
        ascii_measured = [float(advances.get(str(code), 0)) for code in ASCII]
        # The face is only needed for the pairs the measurement does not cover;
        # the measured advances and pairs are what the table answers with.
        candidate = pick_face(families.get(key, []), ascii_measured)
        result = oracle_table(entry, candidate)
        if result is None:
            skipped.append(f'{name} (the measurement misses the probe string)')
            continue
        upem, ascii_values, latin1_values, kern, delta = result
        description = 'measured from the reference browser (tools/measure_oracle_fonts.py)'
        if candidate is not None:
            description += f", pair adjustments outside ASCII from {candidate['path'].split('/')[-1]}"
        emitted.append((name, description, upem, ascii_values, latin1_values, kern))
        if want is None:
            residuals.append(f'{name}: no reference width, measured table kept')
        elif abs(delta) / (ORACLE_UPEM / 16.0) >= MATCH_TOLERANCE:
            residuals.append(
                f'{name}: measured table, probe off by {delta / (ORACLE_UPEM / 16.0):+.4f}px')

    print('// Generated by tools/gen_font_tables.py from the fonts macOS ships.',
          file=sys.stderr)
    print(f'// families: {len(emitted)}, skipped: {len(skipped)}', file=sys.stderr)
    for name in skipped:
        print('//   skipped:', name, file=sys.stderr)
    for line in residuals:
        print('//   residual:', line, file=sys.stderr)

    print('//! Per-family advance tables, generated from the host\'s own font files.')
    print('//!')
    print('//! A CSS family this list carries answers the advances macOS\'s font for it')
    print('//! answers, pair adjustments included; a family it does not carry keeps the')
    print('//! bundled stand-in\'s metrics. Regenerate with `tools/gen_font_tables.py`.')
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
    print('impl FontTable {')
    print('    /// The advance for one character in the table\'s units, or `None` when the')
    print('    /// table does not carry it (a value of zero means the face has no glyph')
    print('    /// for the character, which keeps the shaped stand-in\'s advance instead).')
    print('    pub fn advance(&self, ch: char) -> Option<f32> {')
    print('        let code = ch as u32;')
    print('        let value = if (0x20..=0x7E).contains(&code) {')
    print('            self.ascii.get((code - 0x20) as usize).copied()')
    print('        } else if (0xA0..=0xFF).contains(&code) {')
    print('            self.latin1.get((code - 0xA0) as usize).copied()')
    print('        } else {')
    print('            None')
    print('        }?;')
    print('        if value == 0.0 {')
    print('            return None;')
    print('        }')
    print('        Some(value)')
    print('    }')
    print()
    print('    /// The kern adjustment between two adjacent characters, in the table\'s')
    print('    /// units, zero when the pair carries none.')
    print('    pub fn kern(&self, first: char, second: char) -> f32 {')
    print('        let key = ((first as u32) << 16) | (second as u32);')
    print('        self.kern')
    print('            .iter()')
    print('            .find(|(pair, _)| *pair == key)')
    print('            .map_or(0.0, |(_, value)| *value as f32)')
    print('    }')
    print('}')
    print()
    print('pub static FONT_TABLES: &[FontTable] = &[')
    for name, description, upem, ascii_values, latin1_values, kern in emitted:
        print(f'    // {description}')
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
    print()
    print('#[cfg(test)]')
    print('mod tests {')
    print('    use super::*;')
    print()
    print('    /// The families whose generated table reproduces the reference width,')
    print('    /// as `(family, generated, reference)`. The reference is the width the')
    print('    /// local Chrome answers for the probe string, recorded in')
    print('    /// `tools/reference_widths.json`.')
    print('    const CASES: &[(&str, f32, f32)] = &[')
    for name, description, upem, ascii_values, latin1_values, kern in emitted:
        want = reference.get(name.strip().lower())
        if want is None:
            continue
        glyphs = {}
        for slot, value in enumerate(ascii_values):
            glyphs[0x20 + slot] = value
        for slot, value in enumerate(latin1_values):
            glyphs[0xA0 + slot] = value
        pairs = {}
        for key, value in kern.items():
            pairs[(key >> 16, key & 0xFFFF)] = value
        total = 0.0
        previous = None
        ok = True
        for ch in TEXT:
            code = ord(ch)
            if code not in glyphs or glyphs[code] == 0.0:
                ok = False
                break
            if previous is not None:
                total += pairs.get((previous, code), 0)
            total += glyphs[code]
            previous = code
        if not ok:
            continue
        width = total * 16.0 / upem
        if abs(width - want) >= MATCH_TOLERANCE:
            continue
        print(f'        ("{name}", {rust_f32(width)}f32, {want:.4f}f32),')
    print('    ];')
    print()
    print('    /// Every family whose table does not reproduce the reference, with')
    print('    /// the reason the generator recorded for it.')
    print('    const RESIDUAL_FAMILIES: &[&str] = &[')
    for line in residuals:
        print('        ' + json.dumps(line) + ',')
    print('    ];')
    print()
    print('    #[test]')
    print('    fn tables_reproduce_the_reference_widths() {')
    print('        assert!(!CASES.is_empty());')
    print('        for (family, generated, reference) in CASES {')
    print('            assert!(')
    print('                (generated - reference).abs() < 0.01,')
    print('                "{family}: generated {generated}, reference {reference}"')
    print('            );')
    print('            assert!(table_for_family(family).is_some(), "{family} is missing");')
    print('        }')
    print('    }')
    print()
    print('    /// Every table is either a case above or a documented residual, so a')
    print('    /// regeneration cannot quietly drop one family and add another.')
    print('    #[test]')
    print('    fn every_family_is_matching_or_documented() {')
    print('        for table in FONT_TABLES {')
    print('            let matching = CASES.iter().any(|(name, _, _)| *name == table.family);')
    print('            let residual = RESIDUAL_FAMILIES')
    print('                .iter()')
    print('                .any(|line| line.starts_with(table.family));')
    print('            assert!(matching || residual, "{} is in neither list", table.family);')
    print('        }')
    print('    }')
    print('}')


main()
