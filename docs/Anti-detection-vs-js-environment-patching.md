# Anti-detection: real engine vs. JS environment patching

This page compares how Obscura approaches anti-detection against a well-known
alternative: **pure-JS browser-environment patching** (the "hahavm" style of
JS reverse-engineering frameworks, as seen in `cloudflare-solver-node`'s
`solver/js/output.js`).

The two are not competing implementations of the same idea. They are two
fundamentally different routes:

| | Obscura | JS environment patching (`output.js`) |
|---|---|---|
| Body of work | Rust engine (9 crates) + `bootstrap.js` (~14.6k lines) | Single JS file (~58.6k lines / 2.5 MB) |
| Runtime | Embedded V8; DOM, layout, and network implemented in Rust | Node.js `vm` sandbox + V8 natives |
| DOM | Real Rust DOM tree (`obscura-dom`) | HTML parsed with **cheerio**, nodes wrapped in `Proxy` |
| Engine | Real CSS engine (`obscura-render`): layout, paint, PDF | No layout or paint — values only |
| Forgery style | Real behavior, forged only where it must hide | Hand-written getters returning canned values |
| Target | General headless browser; stealth is generic hardening | Purpose-built for Cloudflare Turnstile/challenge |

## What the JS patcher does

`output.js` is a hahavm framework: a global `hahavm` object with `toolsFunc`
(plugin/hook helpers), `envFunc` (one getter/function per simulated API),
`config`, and `memory` state. It registers roughly **1,679 `envFunc`
implementations** that make browser globals "exist" to fingerprinting scripts,
then hooks objects and prototypes so property reads return believable values.

The coverage is broad but **shallow**. Representative examples:

```js
// WebGL getParameter — looks up a canned value, never runs real GL
hahavm.envFunc.WebGLRenderingContext_getParameter = function (pname) {
    let parameter_dic = hahavm.toolsFunc.getProtoArr.call(this, "parameter_dic");
    return parameter_dic[pname]
}
```

- **WebGL / WebGL2** (hundreds of references): value lookups from a
  `parameter_dic`; zero real GL calls.
- **Canvas 2D**: a fake context, no pixels are ever produced.
- **DOM**: cheerio nodes wrapped by `toolsFunc.getProtoArr` /
  `createProxyObj`; properties *look* right but carry no browser semantics.
- **Fonts**: a hardcoded `fontList` (`SimHei`, `SimSun`, ...), not real metrics.
- The tail of the file is Cloudflare-specific: it detects the
  `challenges.cloudflare.com/turnstile/v0/api.js` script and reverse-derives
  `document.currentScript`, and it supports `challenge` / `turnstile` solver
  modes with TLS fingerprint forwarding through a local Go service.

## What Obscura does instead

Obscura makes surfaces **actually work** wherever it can, and only forges where
a real value would give away that the page is not running in Chrome:

- **Canvas** renders through the real `obscura-render` paint path; in stealth
  mode the fingerprint result is perturbed (`bootstrap.js`, canvasFingerprint).
- **Fonts** are shaped with real metrics (ab_glyph + Liberation), aligned to
  Chrome measurements.
- `getComputedStyle`, `getBoundingClientRect`, and `matchMedia` are computed by
  the layout engine — not looked up from a table.
- **WebGL** is exposed as *unavailable without a backend* (an empty
  `WebGLRenderingContext` class) rather than pretending to have a GL
  implementation that returns fake data — closer to real Chrome behavior on
  such systems.
- `getBattery`, `permissions.query`, and audio contexts return fingerprint-
  driven values rather than hand-maintained constants.

## Surfaces both forge

The two converge on the classic anti-bot tells. Both:

| Surface | JS patcher | Obscura `bootstrap.js` |
|---|---|---|
| `event.isTrusted` | forced to `true` | trusted-event set + getter |
| `Function.prototype.toString()` → `[native code]` | yes | `_markNative`, including accessors |
| `navigator.webdriver` | set to `undefined` | getter returning `false` |
| `Object.keys(window)` hides internal state | `filterProxyProp` | enumeration-safe internals |
| UA / sec-ch-ua / userAgentData | injected from CLI args | profile-derived, consistent across surfaces |
| battery / permissions | canned or `null` | `_fp()` randomized per session |

## The real difference

- **Depth**: the JS patcher wins on *narrow, deep* forgery. It is a CF
  specialist: challenge and Turnstile modes, `currentScript` spoofing, TLS
  fingerprint forwarding. Obscura's stealth is generic and ships no CF solving
  flow.
- **Breadth and realism**: Obscura wins. It runs whole pages — real layout,
  screenshots, PDF, screencast, CDP, MCP, a real network stack (rustls, or
  BoringSSL in the stealth build). Values are produced by the engine, so there
  is no table of constants to drift out of date as Chrome updates.
- **Maintenance**: every `envFunc` in the patcher is hand-maintained; a new
  challenge checkpoint means human patching. Obscura's real implementations
  cover the long tail automatically.

## Conclusion

- **JS environment patching forges existence, not behavior.** It covers 1,600+
  interfaces with values, tailored to a specific challenge. For defeating
  Cloudflare Turnstile this is a complete, self-contained solution.
- **Obscura is a real browser that forges only the seams.** DOM, layout,
  rendering, and network are genuine; the stealth layer concentrates on
  fingerprint realism. What it lacks is the *solving workflow* — the Turnstile
  interaction, TLS spoofing, and token extraction that the patcher's project
  implements in its Rust/Go side, not in `output.js` itself.

> If the goal is to pass Cloudflare interactive challenges, the missing piece
> is not forgery capability — it is the challenge-solving pipeline. Obscura
> currently documents Cloudflare interactive challenges as out of scope (see
> [Configure stealth and proxies](Configure-stealth-and-proxies.md)).
