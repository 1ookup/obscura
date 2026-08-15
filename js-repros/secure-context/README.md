# Secure context fixture

`isSecureContext` did not exist on the window at all, while `worker.rs:738`
defined it on worker scopes. Two lines of script read both and see an engine
disagreeing with itself:

```js
self.isSecureContext            // in a worker: false
window.isSecureContext          // on the page: undefined
```

It also gates real API surface. Chrome withholds a set of powerful APIs on an
insecure origin; Obscura handed all of them out unconditionally, on every
origin.

## Capture

The origin matters more than usual here. `127.0.0.1` and `localhost` are
**potentially trustworthy**, so a loopback server is a *secure* context and
cannot show what an insecure origin looks like. The capture binds to the host's
LAN address and visits it by IP for the insecure case, then visits the same
server over loopback and over `localhost` for the secure ones.

```bash
node js-repros/secure-context/capture-chrome.mjs > chrome-oracle.json
# LAN_IP=... overrides the auto-detected address
```

## What Chrome does

`isSecureContext` is an enumerable, configurable accessor with no setter, on
both the window and worker scopes, and a worker inherits its creator's status.

Insecure origins lose these entirely -- not set to `undefined`, *removed*:

`crypto.subtle`, `navigator.serviceWorker`, `navigator.mediaDevices`,
`navigator.storage`, `navigator.clipboard`, `navigator.wakeLock`,
`navigator.credentials`, `navigator.locks`, `caches`

## What the oracle stopped

The obvious reading of "gate the powerful APIs" would have removed
`navigator.geolocation` and `Notification` too -- both are on every list of
secure-context-only APIs. **Chrome 146 keeps both on an insecure origin**
(`typeof navigator.geolocation === 'object'`, `typeof Notification ===
'function'`) and refuses at call time instead. Removing them would have
traded one difference for another. This is the second time in this fixture
series that capturing the oracle before editing prevented a regression.

## Timing

The gating cannot be decided when bootstrap runs: at that point the document
URL is still `about:blank`. `isSecureContext` is therefore evaluated on every
read, and the destructive part -- removing the APIs -- runs from
`__obscura_init`, which fires once the real URL is known. A first attempt that
decided at bootstrap time got it exactly backwards, keeping the APIs on the
insecure origin and removing them on loopback.

## Result

72 of 75 observables match Chrome 146.0.7680.80 across all three origins.

The 3 that differ are one issue counted once per origin: **`SharedArrayBuffer`
is still exposed**. Chrome withholds it without cross-origin isolation
(COOP+COEP), which is stricter than a secure context -- it is `undefined` on
loopback too. `delete globalThis.SharedArrayBuffer` inside bootstrap does
succeed (`typeof` reads `undefined` on the next line) and something re-installs
it afterwards; no Rust in the tree mentions the name. Left alone rather than
worked around, because cross-origin isolation is a separate axis from secure
contexts and the re-installation needs finding first.

## Also fixed here

`globalThis.origin` did not exist. It is a `WindowOrWorkerGlobalScope`
attribute Chrome exposes on every global, and its absence was visible on secure
and insecure origins alike.
