# DOM op cost fixture

Microbench for the API-touch shapes the Turnstile bootstrap VM program uses
through its JSVMP dispatch loop: element creation/mutation, querySelector,
layout reads, and the window/DOM shim property surface. The challenge census
(Step 300) counted ~1500 host DOM ops during the bootstrap program, so these
per-op costs bound how much of the ZMSOw0 residual the op bridge can explain.

Each number is milliseconds for 10k iterations. Capture the Chrome oracle:

```bash
node js-repros/dom-op-cost/capture-chrome.mjs
```

Run the Obscura capture:

```bash
python3 -m http.server 8933 --directory js-repros/dom-op-cost
obscura fetch http://127.0.0.1:8933/index.html --allow-private-network --wait 3 \
  --eval 'JSON.stringify(globalThis.domBenchResult)'
```

0919 results (ms per 10k ops, obscura/chrome ratio in brackets):

| shape | chrome | obscura | ratio |
|---|---|---|---|
| createElement+appendChild | 1.5 | 25.6 | 17x |
| setAttribute | 1.5 | 7.5 | 5x |
| querySelector (50-node tree) | 1.3 | 20.1 | 15x |
| getAttribute | 0.3 | 0.6 | 2x |
| getBoundingClientRect | 3.0 | 52.8 | 17.6x |
| window shim gets (5 props) | 3.7 | 3.2 | 1x |
| getElementById | 0.4 | 3.7 | 9x |
| classList.toggle | 1.1 | 11.5 | 10x |
| createNodeIterator | 1.1 | 2.8 | 2.5x |

The window shim surface is at parity; the per-op bridge cost of the DOM ops
is not. With the census' ~1500 ops the bridge still only accounts for
single-digit milliseconds of the bootstrap wall clock (Step 304).
