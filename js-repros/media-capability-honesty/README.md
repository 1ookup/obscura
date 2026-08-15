# Media capability fixture

Obscura decodes no audio or video, and still does not. What this fixture covers
is what it *declares*, which was both wrong and self-contradictory:

- `canPlayType` answered `""` for every type, including `video/mp4`. No Chrome
  build produces that, and it pushes sites into their "your browser cannot play
  video" path.
- `mediaCapabilities.decodingInfo` answered `{supported: true, smooth: true,
  powerEfficient: true}` — claiming *hardware-accelerated* decoding from the
  same engine whose `canPlayType` had just said it could play nothing. Chrome
  itself reports `powerEfficient: false` for software decoding.

One engine, two opposite answers. That internal disagreement is a far stronger
signal than either answer alone.

## Capture

```bash
node js-repros/media-capability-honesty/capture-chrome.mjs
```

```bash
python3 -m http.server 8736 --directory js-repros/media-capability-honesty
obscura fetch http://127.0.0.1:8736/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.mediaFixtureResult)'
```

## Result

All 77 observables are identical to Chrome 146.0.7680.80.

## The line between declaration and behaviour

The direction here was an explicit decision: **capability declarations match
Chrome, playback behaviour stays exactly as absent as it was.**

Declared (now matching Chrome):

- `canPlayType`: `maybe` for a known container, `probably` when the codecs are
  also known, `""` otherwise — including `video/ogg; codecs="theora"` and
  `video/quicktime`, which Chrome also refuses.
- `decodingInfo` / `encodingInfo`: routed through *the same table*, so the two
  APIs cannot disagree again. `powerEfficient` is `false`.
- `MediaSource.isTypeSupported`: same table.

Unchanged (nothing is faked):

- `play()` rejects. It now rejects with `NotAllowedError`, which is what a
  headless Chrome without a user gesture reports, instead of
  `NotSupportedError` — the refusal is a policy, not a missing codec.
- `readyState` stays `HAVE_NOTHING`, `videoWidth`/`videoHeight` stay 0,
  `duration` stays `NaN`, `currentSrc` stays empty, `paused` stays true.
- `buffered` / `played` / `seekable` are empty `TimeRanges` (they simply did
  not exist before), `start(0)` throws `IndexSizeError`, and each read returns
  a fresh object as in Chrome.
- `getVideoPlaybackQuality()` counts zero frames, because zero frames are
  decoded.
- `requestVideoFrameCallback` retains its callback and never invokes it — no
  frame is ever presented, which is also true in Chrome for a video that never
  starts.

`canPlayType` is a static capability query, not a promise that a given file
will play; Chrome answers `probably` for streams it then fails to fetch or
decode. Declaring support the engine has is therefore not a false success —
resolving `play()` would be.
