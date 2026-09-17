# fetch() redirect modes fixture

`Request` recorded `init.redirect` from the day the class was written:

```js
this.redirect = init.redirect || 'follow';   // bootstrap.js
```

and the value went nowhere. The fetch path never passed it to the op, so
`error` and `manual` both silently behaved as `follow`. Asking for a mode and
getting a different one is the shape of defect this project treats as worse
than refusing outright: the caller believes a guarantee it never had.

The visible half is the response the page gets. The half no page-side check can
see is in the server's access log -- `error` and `manual` must never produce a
request for the redirect *target*, and an engine that follows the hop anyway
leaves a footprint on every site that redirects.

## Capture

```bash
node js-repros/fetch-redirect-modes/capture-chrome.mjs > chrome-oracle.json
```

Served over loopback HTTP rather than a `data:` URL, because half the fixture
is about what the server was asked for. `serve.mjs` is imported by both the
capture and any manual Obscura run, so the two cannot drift.

## What Chrome does

`follow` takes every hop and reports the final URL with `redirected: true`.

`error` rejects with a bare `TypeError: Failed to fetch` -- the same message as
any other network failure, carrying no hint about where the hop pointed.

`manual` resolves to an **opaque-redirect** response: `status: 0`,
`statusText: ''`, `ok: false`, `type: 'opaqueredirect'`, an empty header list,
an empty body, and `redirected: false` because no hop was taken.

## What the oracle stopped

Two predictions were wrong, and both would have shipped:

1. **A 3xx with no `Location` is treated differently by the two modes.**
   `error` lets it through as an ordinary 302 response (body and all), because
   no `Location` means no redirect was ever meant. `manual` decides on the
   status code alone and hands back an opaque redirect anyway. The obvious
   implementation -- one "is this a redirect?" test shared by both modes --
   gets one of the two wrong whichever way it is written.

2. **An opaque-redirect response reports the requested URL, not an empty one.**
   The Fetch spec describes the opaque-redirect filter as having an empty URL
   list, which reads as `response.url === ''`. Chrome 146 reports
   `<origin>/redirect-once`.

## Not wired into the gate

The Rust assertions live in `runtime.rs::fetch_redirect_modes_match_chrome`
rather than going through `assert_probe_matches_chrome_oracle`, for the same
reason as the Service Worker fixture: the probe needs a live HTTP server with
scripted responses, and the capture's `headerNames` include `date`,
`connection`, `keep-alive` and `transfer-encoding` from Node's server, which a
hand-rolled test server does not send. The test replays the same routes and
asserts the same semantics, including the request sequence.

One capture field is deliberately not asserted: **`statusText`**. Chrome
reports the reason phrase (`OK`, `Not Found`, `Found`); `op_fetch_url` does not
return it at all, so every Obscura response has `statusText: ''`. That is a
real difference, and a separate one -- it has nothing to do with redirects and
shows up on every response.

Also note `__serverSaw` in the capture contains no second request for
`/redirect-308` even though two cases ask for it: 301 and 308 are permanent,
so Chrome's HTTP cache serves the second. That is a caching artefact of the
capture, not a redirect-mode observable.

## Result

All 20 branches match Chrome 146.0.7680.80 except `statusText`, above.
