# Empty about:blank iframe boot cost fixture

Creates 8 sandboxed `about:blank` iframes back to back and touches each
`contentWindow`/`contentDocument` (createElement + appendChild), reporting the
per-iframe and total wall time. This is the shape the challenge's bootstrap
ladder runs right after TS#1, and the realm-boot cost was the dominant
residual of the payload timing field `ZMSOw0`.

## Run

```bash
# engine
OBSCURA_BIN=./target/release/obscura js-repros/iframe-boot-bench/capture-obcura.mjs
# Chrome oracle on the same page
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  js-repros/iframe-boot-bench/capture-chrome.mjs
```

Both scripts print `{each: [...], total: ...}` JSON.

## Numbers (macOS arm64, release build, 0919)

| boot | each (ms) | first (ms) | total 8 (ms) |
| --- | --- | --- | --- |
| Chrome headless oracle | 1-3 | ~2 | 16 |
| engine 0919 morning (Step 311 base, unsplit) | 78-93 | 142 | 719 |
| engine after Step 312 (deferred-surface realm boot, unloaded) | 8-12 | 40-55 | 100-125 |
| engine after Step 312, under parallel build load (load avg 9-30) | 8-12.5 | 50-54 | 118-125 |

The deferred-surface boot splits the bootstrap at
`@obscura-deferred-surface` (js/bootstrap.js): a frame realm's first boot runs
only the core half (document/element machinery, proxy facades) plus
`__obscura_core_init`, and the surface half (fingerprint, interface tables,
surface-finalize, webidl branding) hydrates on the first WindowProxy
operation or the first script routed into the realm. Realms that run scripts
pay the same total work as before; scriptless frames that only get touched
through `contentDocument` pay the core half.

## Gate status

Under the parallel-load conditions of the 0919 afternoon session (load
average 9-30 from concurrent builds and capture rounds), the fixture measures
118-125 ms total against the paired inline-baseline build (marker disabled,
same modules) at 586-668 ms measured back to back: 4.9x. The unloaded 40 ms
total gate is documented as pending a quiet-machine re-measurement; the
remaining per-frame cost is the core-half bootstrap execution
(`config/core-surface-finalize.js` enumerability promotion ~1.3 ms, plus
~5 ms across the retained core modules), which needs the promotion itself
re-engineered (V8-side or per-member lazy) to reach Chrome's 2 ms.
