# Worklet entry points fixture

The `Worklet` interface object existed with nothing hanging off it: no
`CSS.paintWorklet`, no `audioWorklet` on an AudioContext. Chrome exposes both,
and both are one-line feature detections.

## Capture

```bash
node js-repros/worklet-entrypoints/capture-chrome.mjs
```

```bash
python3 -m http.server 8734 --directory js-repros/worklet-entrypoints
obscura fetch http://127.0.0.1:8734/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.workletFixtureResult)'
```

`chrome-oracle.json` is the Google Chrome 146.0.7680.80 capture.

## Result

All 39 observables are identical to Chrome:

- `CSS.paintWorklet` is `[object Worklet]`, `instanceof Worklet`, with
  `addModule.length === 1`, and is the same object on every read.
- `new AudioContext().audioWorklet` is `[object AudioWorklet]`, also
  `instanceof Worklet`, stable per context, and each context owns its own.
- `AudioWorklet` throws `Failed to construct 'AudioWorklet': Illegal
  constructor`.
- `addModule()` with no argument rejects `TypeError`.
- `addModule(url)` rejects `AbortError: Unable to load a worklet's module.`

## Why that rejection is the honest one

No worklet module can run here -- there is no worklet runtime. Chrome raises
exactly this `AbortError` for any module it cannot fetch or evaluate, which the
oracle confirms for both a 404 and a cross-origin URL. Every module is in that
state for Obscura, so the failure Obscura reports is one Chrome also produces,
and callers' existing `.catch` paths handle it. Resolving `addModule` would be
the lie: the caller would then register a paint class or audio processor that
never runs.
