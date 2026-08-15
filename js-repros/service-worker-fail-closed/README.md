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

Obscura (`serve.mjs`, not a static file server: half the checks are decided by
the *response* -- a 500, a 302, a missing `Content-Type`, a
`Service-Worker-Allowed` header -- and both sides import it so they cannot
drift apart):

```bash
node js-repros/service-worker-fail-closed/serve.mjs 8731 &
obscura fetch http://127.0.0.1:8731/ --allow-private-network --wait 6 \
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
- `register()` rejects (never throws synchronously) with, in this order --
  pinned by feeding Chrome inputs that fail two checks at once, not read off
  the spec: missing argument -> `TypeError`; non-HTTP(S) script -> `TypeError`;
  cross-origin script -> `SecurityError`; cross-origin scope -> `SecurityError`;
  `%2f`/`%5c` in either URL -> `TypeError`; then the script is fetched, and
  a redirect -> `SecurityError` outranks a bad status -> `TypeError`, which
  outranks a bad MIME type -> `SecurityError`, which outranks an over-broad
  scope -> `SecurityError`.
- The accepted MIME types are the fetch spec's JavaScript set, matched
  case-insensitively with parameters stripped. A `Content-Type` that is absent
  or not a MIME type at all gets a different message than a wrong one.
- `getRegistration()` fulfils with `undefined`, cross-origin `documentURL`
  rejects with `SecurityError`, `getRegistrations()` fulfils with `[]`,
  `startMessages()` returns `undefined`, `controller` is `null`.
- `ServiceWorker`, `ServiceWorkerRegistration`, `Worklet` and
  `NavigationPreloadManager` all exist as interface objects that throw
  `Failed to construct 'X': Illegal constructor`.

## Fetching the script is not part of running it

The first version of this fixture refused *before* the network, on the grounds
that "every rejection the spec can reach without running a worker has been
checked". That was wrong, and the fixture recorded it as a deliberate
divergence for a while. Chrome's `register()` is seven steps, and only the last
one needs a worker:

| step | needs a worker? |
|---|---|
| URL / origin checks | no |
| `%2f` / `%5c` escape check | no |
| **fetch the script** | no |
| redirect refused | no |
| HTTP status | no |
| MIME type | no |
| scope cap / `Service-Worker-Allowed` | no |
| evaluate and install the script | **yes** |

Refusing at step one collapsed six decidable outcomes into one wrong answer,
and skipped the fetch entirely. That last part does not need a page-side check
to detect at all: Chrome sends `GET /sw.js` with `Service-Worker: script` and
`Sec-Fetch-Dest: serviceworker`, headers no other request carries. An engine
that never sends it leaves a hole in every access log of every site that ships
a Service Worker. `__serverSawScriptFetches` in the oracle pins that sequence,
so it is a regression test and not a one-off observation.

The script is now fetched for real, `redirect` is `error` so the hop is never
taken, and the refusal sits after every check that the response can decide.

## Result

150 of 175 observables are byte-identical to Chrome 146.0.7680.80, including
the full request sequence the server sees. The 25 that differ are:

1. **24 fields across `registerMimeWithParams`, `registerScopeAllowedByHeader`
   and `registerValidScript`** -- the three cases where the script is fetched,
   correctly typed and legally scoped, so Chrome resolves with a
   `ServiceWorkerRegistration`. Obscura rejects with `SecurityError: ... The
   user denied permission to use Service Worker.`, the error Chrome itself
   surfaces when site data is blocked, so callers' existing failure paths
   handle it. **This is the fail-closed decision, and it is now the only place
   it applies** -- previously it swallowed the 404 path too, which every site
   with a stale worker URL hits.
2. **`registerInvalidUrl.message`** -- for `http://[`, Chrome's URL serialiser
   reports `('http://[/')` and Obscura reports `('http://[')`. Chrome's
   behaviour on invalid input is its own: `https://` serialises to `https:`
   and `http://:80/` to `http:///`. Four data points are not enough to
   reimplement that without guessing, and guessing wrong would trade one known
   difference for several unknown ones, so it stays as it is.

Every rejection the spec can reach without *running* a worker now matches
Chrome exactly.

## Not covered

- `isSecureContext` does not exist in Obscura at all, so the container is
  exposed unconditionally. Chrome gates `navigator.serviceWorker` on a secure
  context and leaves it `undefined` on plain-HTTP origins that are not
  localhost. Closing that gap needs a `isSecureContext` implementation, which
  affects other APIs and is tracked separately.
- Worklets have interface objects only. No worklet can be added, and
  `CSS.paintWorklet` / `audioWorklet` entry points are still absent.
