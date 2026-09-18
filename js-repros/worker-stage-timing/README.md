# Worker stage timing fixture

Turnstile's widget pipeline creates a dedicated Worker from a blob URL, posts
it a task, the worker fetches a same-origin resource and posts the result
back. That stage is what the challenge payload reports as `uGyjw9`
(`timeTiefMs`): 268 ms on this engine against Chrome's 4 ms in the 0919
capture rounds, the largest single worker-side timing tell.

The fixture measures the same shape locally (loopback, no external network):

- `workerBootMs` - `new Worker(blobUrl)` to the first message delivered.
- `workerFetchMs` - one fetch round trip measured inside the worker.
- `pingPongMs` - median message round trip through the worker (21 samples).
- `totalMs` - constructor to the last reply (the `uGyjw9` analogue).

Capture the Chrome oracle with:

```bash
node js-repros/worker-stage-timing/capture-chrome.mjs
```

Run the Obscura capture with:

```bash
python3 -m http.server 8931 --directory js-repros/worker-stage-timing
obscura fetch http://127.0.0.1:8931/index.html --allow-private-network --wait 6 \
  --eval 'JSON.stringify(globalThis.workerFixtureResult)'
```

Interpretation, measured on the 0919 host before/after the reply-wake fix:

- Before: boot 8-16 ms, worker fetch 3-5 ms, but the first worker->page
  reply to an otherwise idle page waited ~100 ms for the next pump phase and
  each subsequent round trip cost another 10-100 ms: `totalMs` 319-1133 ms.
  The recv promise was unref'd, so a reply arriving while the page was
  parked had no event-loop wake of its own.
- After: same boot/fetch costs, pings at ~0.1 ms each, `totalMs` ~113 ms,
  of which ~100 ms is one settle-policy gap between CLI load phases (not
  message latency). Under `serve`/CDP the pump is continuous and per-hop
  latency stays sub-millisecond.
- Chrome oracle: boot 15-40 ms (thread pool), fetch 5-12 ms, ping-pong 0 ms,
  total 25-54 ms.
