# SharedWorker fixture

`SharedWorker` was an empty stub: a class whose `port.postMessage` was an empty
function. Messages went nowhere, no reply ever came, and the worker script never
ran at all. This fixture covers the replacement, which runs the script on a real
worker thread and moves messages over real `MessagePort`s.

## Capture

Both the page and the worker script must be same-origin, so the capture script
serves them over loopback HTTP.

```bash
node js-repros/shared-worker/capture-chrome.mjs
```

```bash
python3 -m http.server 8732 --directory js-repros/shared-worker
obscura fetch http://127.0.0.1:8732/ --allow-private-network --wait 5 \
  --eval 'JSON.stringify(globalThis.sharedWorkerFixtureResult)'
```

`chrome-oracle.json` is the Google Chrome 146.0.7680.80 capture. Ports in error
messages are normalised to `<origin>`.

## What is checked

- **Shape**: `[object SharedWorker]`, `instanceof EventTarget`, a `port` that is
  a real `MessagePort`, an `onerror`, and no `terminate` (that is `Worker`).
- **A real round trip**: `port.postMessage` reaches a `connect` handler in the
  worker and the reply comes back. The worker reports its own scope, which must
  be `[object SharedWorkerGlobalScope]` with no `window`, no `document`, and
  `typeof self.postMessage === 'undefined'` -- a shared scope has no
  scope-level postMessage, only ports.
- **Reuse**: two constructions with the same `(url, name)` reach one worker, so
  its connection counter reads 1 then 2 while its state persists; a different
  name gets a separate worker whose counter restarts at 1.
- **start() gating**: a port with only `addEventListener('message')` receives
  nothing until `start()`, then receives.
- **Constructor rejections**: cross-origin script -> `SecurityError`, malformed
  URL -> `SyntaxError`.

## Result

All 40 observables are identical to Chrome, with no known divergence.

## Scope of "shared"

Obscura pages are independent documents that do not share a worker host, so
sharing across pages is not observable here in the first place; within a page
the spec's reuse rule, connection counting and per-port queueing all hold.
Implementation is one worker thread per `(name, resolved URL)` and one
`MessageChannel` per construction, whose far end is bridged to that thread with
a connection id. Reusing `MessagePort` rather than inventing a port type is what
makes `ports[0] instanceof MessagePort`, structured cloning and the
`start()`/queue semantics come out right without reimplementing them.

## Fixed along the way

EventTarget dispatch reached `ShadowRoot`, `Node`, `Document` and `Element` as
bare bindings. Worker scopes delete all four, so *any* `MessagePort` event
dispatch inside a worker threw `ReferenceError: ShadowRoot is not defined` --
a pre-existing defect that no dedicated-worker path happened to reach, because
`self.onmessage` there is dispatched by the worker prep script rather than by
the page bootstrap's EventTarget implementation. The four checks are now
guarded.
