# Timer fidelity fixture

This fixture checks browser task ordering, one-shot delay buckets, interval
rescheduling, and the HTML nested-timeout delay floor. Values are measured from
`performance.now()` and are compared as ranges because wall-clock scheduling is
not deterministic.

Capture the Chrome oracle with:

```bash
node js-repros/timer-fidelity/capture-chrome.mjs
```

Run the Obscura capture with:

```bash
python3 -m http.server 8000 --directory js-repros/timer-fidelity
obscura fetch http://127.0.0.1:8000/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.timerFixtureResult)'
```

Chrome's expected semantics are: the microtask is first, the zero-delay timer
is a later task, timers fire in due-time and insertion order, the interval runs
three times, and a nested zero-delay chain has a roughly 4 ms floor after the
fifth nesting level. The checked lateness bound is 35 ms so loaded CI hosts do
not turn real scheduler noise into a false failure.
