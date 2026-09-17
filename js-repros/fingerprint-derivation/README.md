# Fingerprint derivation fixture

`probe.js` reads the same navigator, UA-CH, screen, iframe, worker, and WebGL
surfaces in Chrome and Obscura. The checked-in oracle was captured with Google
Chrome 146.0.7680.80 on arm64 macOS using a fresh profile:

```bash
CHROME_NATIVE=1 node js-repros/fingerprint-derivation/capture-chrome.mjs
```

The native oracle establishes Chrome's cross-realm invariants. Hardware, OS
patch version, screen, DPR, and GPU are machine facts rather than values which
can be recovered from a reduced User-Agent. Obscura therefore gives them
deterministic UA-derived defaults and an explicit `FingerprintOverrides`
policy; Rust tests install the measured Chrome values and compare the full
shape. Running the capture script without `CHROME_NATIVE=1` additionally
records Chrome's CDP user-agent metadata override behavior.

WebGL remains fail-closed in Obscura. The fixture does not claim a GPU backend;
Chrome is launched with `--disable-gpu` so the oracle records the same honest
absence while GPU identity stays policy data for a future WebGL implementation.
