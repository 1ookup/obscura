# Canvas strokeText and shadow coverage fixture

`strokeText` lays a band of ink along the glyph outline; the shadow a live
`shadowBlur` casts must spread from the ink that was actually painted. The
probe renders one glyph (`O`, 20px sans-serif, centred pen) under a fixed
scene matrix -- fill vs stroke, lineWidth 1/4/8, shadow off/on -- and reads
the alpha plane of each canvas back through `getImageData`.

## Capture

```bash
node js-repros/canvas-stroke-shadow/capture-chrome.mjs > js-repros/canvas-stroke-shadow/chrome-oracle.json
python3 -m http.server 8738 --directory js-repros/canvas-stroke-shadow
obscura fetch http://127.0.0.1:8738/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.strokeShadowFixtureResult)'
```

## What each scene answers

| field | meaning |
|---|---|
| `alphaSum` | sum of `data[3::4]`, the cross-engine comparable ink total |
| `nz` | pixels with any coverage |
| `bbox` | ink bounding box `[minX, minY, maxX, maxY]` |
| `holeCentre3x3` | raw 3x3 alpha patch at the bbox centre (row major) -- the counter probe |

The `O` counter is the discriminating read. A real stroke keeps it open at
lineWidth 1, half swallows it at 4, and closes it at 8, so a correct engine
reports strictly increasing `alphaSum`/`nz` across the three widths and a
`holeCentre3x3` that walks from all-zero to inked. The shadow scenes repeat
the sweep with `shadowBlur: 4` at 50% alpha: the shadow mask must track the
band, not the solid glyph, so `stroke-lw1-shadow` stays visibly lighter than
`stroke-lw8-shadow` and both stay lighter than `fill-shadow`.

## Known engine state (pre-oracle)

Obscura's `_canvas2dDrawText` reuses the fill coverage for stroke runs, so its
stroke scenes are expected to answer with the solid glyph: `alphaSum`/`nz`
identical for every lineWidth and a counter that never opens. Capturing the
Chromium oracle before changing anything pins which of the band semantics
(line width, AA falloff, shadow reach) actually differ, scene by scene.
