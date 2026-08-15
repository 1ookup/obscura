# Font fingerprint fixture

Font enumeration is one of the most common anti-bot probes: a page cannot list
installed fonts, so it measures a string in a candidate family against a generic
fallback and infers the font resolved if the width differs. Canvas
`measureText` is the other half of the same probe.

## Capture

```bash
node js-repros/font-fingerprint/capture-chrome.mjs
python3 -m http.server 8737 --directory js-repros/font-fingerprint
obscura fetch http://127.0.0.1:8737/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.fontFixtureResult)'
```

## What this fixture corrected — and what it saved

`document.fonts.check()` returns `true` for every family in Obscura, including
`NonexistentFontXYZ123`. That looks like a false success, and the first read of
this data was that it needed fixing. **The Chrome oracle says otherwise**:
Chrome 146 also returns `true` for a nonexistent family, because per spec
`FontFaceSet.check()` asks whether the *`@font-face` fonts required to render*
are loaded — system fonts need no loading, so the answer is always `true`.
Obscura was already right. Capturing the oracle before changing anything is the
only reason a correct behaviour did not get "fixed" into a wrong one.

The real defect was next door.

## Fixed: canvas text metrics were perfectly flat

`measureText` computed `text.length * 6 * scale` and never looked at the font.
Every family measured identically:

| font | Chrome | Obscura before | Obscura after |
|---|---|---|---|
| `monospace` | 780.26 | 756 | 778 |
| `"Arial", monospace` | 948.87 | 756 | 949 |
| `"NonexistentFontXYZ123", monospace` | 780.26 | 756 | 778 |
| `"Menlo", monospace` | 780.26 | 756 | 778 |

Two things were wrong: a canvas font fingerprint with zero variance, and a
direct contradiction with the same engine's element measurement, which *did*
distinguish families. `measureText` now lays the run out through the real text
engine — the same path element widths use — so the two agree by construction,
unresolvable families fall back to the generic, and the numbers land within
~0.15px of Chrome for shared families.

## Remaining, and honest

Obscura ships embedded fonts rather than scanning system ones, so a width sweep
finds 3 distinct values where Chrome on this host finds 16. Families that are
not embedded (`Segoe UI`, `Zapfino`) resolve to a generic instead of themselves.
That is what a browser with few fonts installed looks like — it is a smaller
fingerprint surface, not a fabricated one. Closing it means optional system-font
scanning with the exposed set tied to the advertised platform (§3.5-#22), which
is not done here.
