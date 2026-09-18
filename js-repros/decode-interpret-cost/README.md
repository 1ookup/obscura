# Decode + interpret cost fixture

Feeds the real TS#1 response bytes through the challenge's decode chain and a
representative bootstrap-VM interpret workload, in a fresh page realm. This is
the shape the payload reports as `ZMSOw0` (`twvE0`, bootstrap program wall-ms):
385 ms on this engine against Chrome's 127 ms in the 0919 ver14 capture.

The decode chain (assets/thelancet-trace/CF-FLOW-PARITY-0916.md section 7):

```
response text -> atob -> W3 bytewise unshift (key = rayId + "_0") -> atob -> bytecode
W3: out[i] = (in[i] - (32 ^ xor(key chars)) - (i % 65535) + 65535) % 255
```

The interpret pass is a switch-dispatch loop over the bytecode string whose
width distribution matches the disassembled ov1-0 average (~20.6 bytes per
instruction) and whose host surface mirrors the census (~750 DOM ops over
~39k steps in this fixture: createElement/setAttribute/appendChild/
querySelectorAll/classList/createTextNode/getBoundingClientRect/textContent).

## Setup

The captured response is session-specific and is not committed. Copy it in
from a capture round and point `rayKey` in `index.html` at that round's
widget ray id (the `/pat/<ray>/...` URL in the same round's ops.tsv):

```bash
cp /tmp/cf0919/ver14/fo/2-frame-resp.bin js-repros/decode-interpret-cost/ts1-resp.txt
# ver14: ray a3d354667f8e3d84 (already the default in index.html)
```

## Capture

```bash
node js-repros/decode-interpret-cost/capture-chrome.mjs   # oracle
node js-repros/decode-interpret-cost/capture-obcura.mjs   # obscura serve
```

Both drive the same CDP flow (navigate, Runtime.evaluate + awaitPromise).

## Reading the output

Every layer reports an FNV-1a checksum (`checksumLayer0..3`) plus the VM
accumulator (`interpretAcc`); all four must match across engines byte for
byte, so an optimization that changes behavior is visible immediately.
`opMs` splits the interpret phase per host-op type.

0919 values (release build, loopback, obscura serve vs Chrome 149 headless):

| phase | obscura before | obscura after | chrome |
|---|---|---|---|
| atob 846 KB | 1.1 | 1.1 | 0.4 |
| W3 unshift loop | 5.7 | 5.9 | 6.2 |
| atob 634 KB | 0.8 | 0.7 | 0.4 |
| 15 sha256 digests | 0.3 | 0.7 | 0.3 |
| interpret (39k steps, 744 DOM ops) | 103 | 81.5 | 11 |
| TextEncoder 200x1 KiB | 1.9 | 1.9 | 0.3 |
| 5x setTimeout(0) chain | 6.9 | 7.0 | 1.0 |

The interpret-phase residual is forced full-document re-prepares: every
geometry read after a mutation re-runs prepare_document, and profiling the
per-prepare work shows text shaping (~70 percent of build after the
NodeData-clone removal in this batch) as the remaining dominator. A shaped-
run cache needs to outlive one render pass (TextEngine is created per
prepare), which is a separate project.
