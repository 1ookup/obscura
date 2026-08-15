# ServiceWorkerContainer fail-closed fixture

Obscura does not implement Service Workers. The roadmap keeps them fail-closed
(§3.2-#11), and this fixture pins what "fail-closed" has to mean: refusing is
allowed, faking success is not.

The stub this replaced did fake success. `register()` resolved with `undefined`,
so the near-universal `register().then(reg => reg.scope)` threw a TypeError no
browser produces, and `ready` resolved immediately, so a page gated on
`await navigator.serviceWorker.ready` proceeded where Chrome blocks forever.
Both are trivially detectable and neither is a behaviour any engine exhibits.

## Capture

Chrome oracle (needs a real HTTP origin -- `navigator.serviceWorker` is not
exposed on `data:` URLs, so the script serves the probe over loopback):

```bash
node js-repros/service-worker-fail-closed/capture-chrome.mjs
```

Obscura:

```bash
python3 -m http.server 8731 --directory js-repros/service-worker-fail-closed
obscura fetch http://127.0.0.1:8731/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.swFixtureResult)'
```

`chrome-oracle.json` holds the Google Chrome 146.0.7680.80 capture. Ports are
normalised to `<origin>` in error messages; nothing else is post-processed.

## What Chrome does

- The container is a real interface: `[object ServiceWorkerContainer]`,
  `constructor.name === 'ServiceWorkerContainer'`, `instanceof EventTarget`.
- The property is an **accessor on `Navigator.prototype`** (enumerable,
  configurable, no setter), so `navigator` has no own `serviceWorker` property.
- `ready` **never settles** while no registration is active -- still pending
  after 500 ms, and the same promise object on every read.
- `register()` rejects (never throws synchronously) with, in order of checks:
  missing argument -> `TypeError`; non-HTTP(S) script -> `TypeError`;
  cross-origin script -> `SecurityError`; cross-origin scope -> `SecurityError`.
- `getRegistration()` fulfils with `undefined`, cross-origin `documentURL`
  rejects with `SecurityError`, `getRegistrations()` fulfils with `[]`,
  `startMessages()` returns `undefined`, `controller` is `null`.
- `ServiceWorker`, `ServiceWorkerRegistration`, `Worklet` and
  `NavigationPreloadManager` all exist as interface objects that throw
  `Failed to construct 'X': Illegal constructor`.

## Result

83 of 89 observables are byte-identical to Chrome. The six that differ are two
deliberate divergences:

1. **`registerMissingScript` (5 fields)** -- Chrome fetches the script and
   rejects with `TypeError: ... A bad HTTP response code (404) ...`. Obscura
   never fetches, because it has no worker to run, and rejects with
   `SecurityError: Failed to register a ServiceWorker: The user denied
   permission to use Service Worker.` -- the error Chrome itself surfaces when
   site data is blocked, so callers' existing failure paths handle it. This is
   the fail-closed decision, not a defect: every registration is refused, and a
   spec-valid one cannot be distinguished from a 404 without a worker.
2. **`registerInvalidUrl.message`** -- for the input `http://[`, Chrome's URL
   serialiser reports `('http://[/')` and Obscura reports `('http://[')`. A
   URL-parser detail in an error string; not reproduced deliberately.

Every rejection the spec can reach *without* running a worker matches Chrome
exactly.

## Not covered

- `isSecureContext` does not exist in Obscura at all, so the container is
  exposed unconditionally. Chrome gates `navigator.serviceWorker` on a secure
  context and leaves it `undefined` on plain-HTTP origins that are not
  localhost. Closing that gap needs a `isSecureContext` implementation, which
  affects other APIs and is tracked separately.
- Worklets have interface objects only. No worklet can be added, and
  `CSS.paintWorklet` / `audioWorklet` entry points are still absent.
