# Forced-layout cost fixture

Times one forced-layout `getBoundingClientRect` on a churned document, the
shape the Turnstile api.js extra-params census pays in the parent realm
(payload field `uGyjw9` / `timeTiefMs`). Live telemetry (0919 tel1/tel2):
179-244 ms cold (document churned by widget injections since load), <3 ms
warm, Chrome ~4 ms for the whole census window.

The document is interstitial-shaped (census wrapper + ~100 elements) plus a
site-page-sized block (default `?site=6`, ~1900 nodes): the live census reads
the wrapper of a full site page with the challenge overlaid, so the prepare
cost scales with the site page's text, not with the widget itself.

## Phases (all milliseconds, page clock)

- `buildMs`       - construct the document
- `warmReadMs`    - first gBCR right after build
- `churnMs`       - widget-churn shape: node create/remove, class toggles,
                    style/text rewrites; no reads (layout stays dirty)
- `churnedReadMs` - THE number: one gBCR on the churned document; pays a full
                    re-prepare on our engine (text re-shaping dominated)
- `churnedRead2Ms` - second gBCR, no intervening mutation (must be free)
- `churnAndRead10Ms` - 10 mutate->read cycles

Every read returns its rect width checksum so behavior parity is visible.

## Capture

```bash
node js-repros/forced-layout-cost/capture-chrome.mjs   # oracle
node js-repros/forced-layout-cost/capture-obcura.mjs   # obscura serve
```

Or straight from the CLI (same document, local file):

```bash
OBSCURA_ALLOW_PRIVATE_NETWORK=1 ./target/release/obscura fetch \
  "file://$PWD/js-repros/forced-layout-cost/index.html" \
  --eval 'JSON.stringify(globalThis.forcedLayoutResult)'
```

Add `OBSCURA_RENDER_TIMING=1` for the per-prepare phase breakdown
(cascade / build-walk / shape-total / compute / prepare-total).

## Numbers (release build, 0919, same host)

| phase | obscura before | obscura after | chrome |
|---|---|---|---|
| warmRead (first read after build) | 130 | 70-78 | 10 |
| churnedReadMs (one gBCR, churned) | 114-118 | 25 | 0-0.1 |
| churnAndRead10Ms | 1100-1150 | 207 | 0 |
| churnedRead2Ms | 0.1 | 0.1 | 0 |

Per-prepare breakdown at site=6 (OBSCURA_RENDER_TIMING), before -> after the
cross-pass shaping caches: build-walk 86 ms (shape-total 84, 670 runs) ->
5-6 ms (shape-total 3.4); prepare-total ~47 -> ~19-21 ms.

The residual after the fix is the per-pass fixed tree work (retained-style
plan, derived scroll/fixed state) plus the geometry op itself, not shaping.
