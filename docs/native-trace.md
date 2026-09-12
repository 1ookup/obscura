# Native Trace

## Architecture

`--trace-api-file FILE` selects the property instrumentation in the pinned
vendored V8. The CLI enables `--trace-property-lookup` before isolate creation
and supplies the filename separately through `OBSCURA_TRACE_API_FILE`, including
filenames containing spaces. This requires a source-built binary.

The active path does not install ObjectTemplate descriptor trampolines or JS
Proxy wrappers. It does not replace page-visible methods or descriptors. The
old Rust descriptor-monitor implementation has been deleted. Its
ignore/watch/devtools CLI options now fail explicitly instead of silently doing
nothing. Their environment equivalents are not implemented by the V8 monitor.

The implementation is edited directly in `vendor/rusty_v8/v8`, a nested Git
repository. There is no build-time V8 trace patch script:
The bytecode migration is committed in that checkout as `59ee73ae`, and the
API-call layer on top of it as `4632570d`, which is the tip of the local
`obscura-trace` branch. That checkout sits on a detached HEAD, so keep the
branch: without it those commits are reachable only from HEAD and a checkout
of another ref would leave them to be collected. The outer cleanup is committed
as `9ea95aa`.

Two build notes. Nothing watches the V8 source tree: `vendor/rusty_v8/build.rs`
re-runs on `.gn`, `BUILD.gn` and `src/binding.cc`, so an edit under
`vendor/rusty_v8/v8/src` is picked up only after one of those is touched, or
ninja will report the object files up to date and the binary will silently
keep the old trace. And a V8 rebuild is incremental once the build script
does re-run; only the first source build is the long one.

| V8 source | Responsibility |
| --- | --- |
| `src/interpreter/bytecode-array-builder.cc` | One GET/SET/HAS runtime probe per supported property bytecode |
| `src/ic/ic.cc` | Side-effect-free resolution, filtering, formatting, async writer; cold global fallback |
| `src/runtime/runtime.h` | Diagnostic runtime intrinsic |
| `src/runtime/runtime-test.cc` | Optional historical JS CALL/RET hooks |
| `src/flags/flag-definitions.h` | Compile-time opt-in flag |

Probe bytecodes are emitted only when the property flag is enabled. Normal
compilation emits none. Overlapping AccessorAssembler and IC-miss probes were
removed. Traced runs compile bootstrap instead of loading Obscura's untraced
startup snapshot. Configure trace before creating any isolate.

## Coverage

Supported operations include ordinary Object and Array named/computed reads,
numeric indices, array holes, typed-array bounds, symbols, named/computed
assignments, `in`, and enumerated keyed reads. BOM/DOM shims are ordinary JS
objects, so explicit property accesses use the same mechanism. The probe is
emitted with bytecode, independently of the selected IC fallback. It preserves
the accumulator and does not evaluate getters, Proxy traps or object-key
coercions for logging.

Property records have eight tab-separated fields:
Property record fields escape backslashes, tabs and line breaks. V8 diagnostic
string conversion normalizes embedded NUL to a space; this is not a lossless
serialization of arbitrary JS strings.

```text
resolution  receiver  property  script  line  column  operation  stack
HIT         Object    present   page.js 1     12      GET        ...
MISS        Object    absent    page.js 1     24      GET        ...
UNKNOWN     Object    proxied   page.js 1     36      GET        ...
```

- `HIT`: a data property or accessor exists, including present-but-undefined.
- `MISS`: lookup reached absence or a typed-array invalid index.
- `UNKNOWN`: resolving would require a Proxy, interceptor, access check, object
  key coercion, or an invalid receiver. Do not treat it as a missing API.
- `GET`, `SET`, `HAS`: attempted operation. SET resolution is measured before
  the write; it does not say the write succeeded.
- `GLOBAL`: legacy cold global lookup evidence, not complete global coverage.

A missing method invocation first produces a missing property GET, then JS may
throw. A MISS alone does not prove a bug: feature detection intentionally probes
absent properties too. Numeric keys are rendered as names; symbols currently
share the `<symbol>` label. Object keys use `<unresolved-key>` rather than
running ToPropertyKey twice.

Engine `ext:`, `deno:` and internal `<...>` scripts are filtered. User evaluation
labels such as `<eval>` and `<eval-remote>` are explicitly allowed. Anonymous
page eval is labelled `<page-eval>`. Script labels are not reliable realm IDs.

## JSON Records And Filtering

`--trace-api-format jsonl` writes one record per API access instead of one
property resolution, in the shape a HaHaVM `dispatch` trace uses:

```json
{"t":76.4,"src":"call Document.createElement (<obscura:bootstrap>:7425:16) <- <page-eval>:1:38","name":"Document.createElement","args":["div"],"result":"<div>"}
{"t":78.1,"src":"set Element.id (<obscura:bootstrap>:4361:9) <- <page-eval>:12:37","name":"Element.id","args":["probe-id"],"result":"undefined"}
```

The record is a contract both sides implement, not an engine-specific dump.
HaHaVM's `core/tools/toolsFunc.js` writes the same five fields under the same
rules, so a diff of two runs is a diff of the pages:

- `t` is milliseconds since this stream's first record, one decimal. The two
  streams start at different events, so only deltas within one stream are
  meaningful; alignment is by record sequence, not by `t`.
- `src` is `<operation> <name> (<definition>) <- <call site>`, `operation` in
  `{get, set, call, new}`. Both halves are always present: `<native>` marks a
  member with no JS source position, `<engine>` an access the engine made
  rather than the page. Eval'd page code is `<page-eval>:line:column` on both
  sides.
- `name` is `Interface.member`, in WebIDL spelling: `window` for the global
  object, `constructor` for a construct.
- `args` is one entry per argument, empty for a read. `result` is the value
  read, the call's return value, the constructed object, or the string
  `"undefined"` for a write, whose assigned value travels in `args`.
- Values keep the reference's spellings: `undefined` is the string
  `"undefined"`, a callable is `"ƒ name"`, a DOM element is its tag
  (`"<div>"`), any other receiver is summarized as `"<Ctor> {…}"` with its own
  enumerable data properties. Every field is cut at the same UTF-8 byte budget
  including the `...[truncated]` marker (`OBSCURA_TRACE_LIMIT`, default 4096),
  so a field under the budget is byte-identical on both sides and a longer one
  is cut in the same place.
- Reads are probed after the load, so a record carries the value the page
  received. Nothing renders a value by running page code: no getter, no
  toString, no proxy trap. A value with an accessor on it renders that
  property as `<accessor>` rather than evaluating it. Reads are the only
  records emitted after their operation; writes (`set`) are probed before the
  store, where the value is still in the register the store will use. `has`
  has no counterpart in the reference contract and is not emitted.
- `--trace-api-calls` adds one record per call, emitted at exit so a single
  record holds both the arguments and the return value. The count is what the
  caller actually passed, not the callee's formal count. Accessor calls
  (`get x`/`set x`) are skipped: the property record for the same access
  already names it and carries the value. A class constructor is entered only
  through `new`, and its record carries that operation and the object it
  produced. A call is recorded only when the callee is reachable as a member
  of its receiver, which is what makes it an API call rather than the engine
  reaching into its own helpers through a native accessor.
- A call into a host function the engine bound anonymously (`setTimeout`,
  `setInterval`, `clearTimeout`) has no name of its own. Its record is named
  from a table the READ probe fills: the probe already has both the member name
  and the value, so a member read records "this function is window.setTimeout",
  and the exit hook then does one lookup. Nothing is enumerated at call time,
  which is what makes the path safe: recovering the name at call time meant
  enumerating the global object inside the exit hook, and that crashed live
  runs (allocation, and a stack overflow when the global proxy's interceptor
  re-entered the trace). A call whose name was never read is left unrecorded,
  and `OBSCURA_TRACE_ANON_CALLS=0` turns the path off. A `fetch` call is never
  recorded either way: `fetch` is a native host function with no JS frame for
  the exit hook to fire on. The reference does not record `fetch` either, so
  only the scheduling gap is asymmetric.
- A read whose value is a function is a method reference rather than a
  property read, so no record is written for it: the reference records nothing
  for one either, its environment members being plain data properties, and the
  call record that follows names the same member with the same arguments.
- Records whose call site is engine code are dropped, and so are accesses to
  members the page defined itself: a page-local helper is not an API event,
  and the reference trace has no counterpart for one. Bootstrap reads its own
  API members constantly while it builds the document, and those records
  describe the implementation, not what the page observed.
  `OBSCURA_TRACE_API_ENGINE_CALLS=1` keeps the engine-origin ones, with
  `<engine>` as their call site, for a reader who wants both streams.

`--trace-api-filter SPEC` keeps the run affordable. SPEC is a comma-separated
list of substrings of `Interface.member`; `+entry` or a bare entry includes,
`-entry` excludes, and a record must match an include (if any) and no exclude.
For an access whose name is known at compile time the filter is applied while
the bytecode is emitted, so a filtered access carries no probe at all: this is
what lets a traced run reach a challenge frame, where the unfiltered property
trace did not. Keyed and iterator accesses have no static name and are only
filtered at runtime; `--trace-api-keyed off` drops them, which is the bulk of a
page-internal trace.

Turning a reference trace into a filter is what makes the two comparable:
derive the include list from the reference's own names so both sides record the
same API surface.

**A filter built from one side silently drops the other side's records.** The
filter matches names as substrings, so a member the two engines spell under
different interfaces — `HTMLElement.nonce` on one, `Element.nonce` on the
other — does not match, and a dropped record is indistinguishable from an
access that never happened. That has already produced one wrong conclusion
("the engine never set the script element's src") in a real comparison. Pass
BOTH traces to the deriver and let it take the union:

```bash
trace_derive_filter.py reference.jsonl --also engine-side.jsonl -o /tmp/spec.txt
```

The deriver warns on stderr when it is given only one trace. When a name still
differs, compare at member level (`trace_compare.py --key member`) rather than
concluding from absence.
`.claude/skills/obscura-challenge-probe/scripts/trace_derive_filter.py` does
that, and `trace_compare.py` in the same directory aligns the two JSONL files
by phase and reports the first divergence.

```bash
SPEC="$(python3 .claude/skills/obscura-challenge-probe/scripts/trace_derive_filter.py \
  reference.jsonl -o /tmp/filter.txt && cat /tmp/filter.txt)"
obscura --trace-api-file /tmp/api.jsonl --trace-api-format jsonl \
  --trace-api-filter "$SPEC" --trace-api-calls \
  fetch https://example.com --proxy http://host:9000 --stealth
python3 .claude/skills/obscura-challenge-probe/scripts/trace_compare.py \
  reference.jsonl /tmp/api.jsonl --json /tmp/trace-compare.json
```

Known boundaries: a call that throws leaves no record, and a keyed or iterator
access has no pre-load resolution record. On the reference side a construct
produces no record at all: HaHaVM
exposes each interface constructor as a plain function, and the only place to
hook them centrally would be to replace the global binding, which would make
`x.constructor === Interface` false. Trace only what the page did, not what
the harness had to change to see it; drop `new` records with
`--trace-api-filter -constructor` when comparing against that side.

A call whose callee carries an inferred name (an anonymous function expression
stored under a computed key, which V8 spells as a path such as
`s.<computed>`) is now named by the member the read probe remembers it under,
falling back to the old owner-prefixed spelling when nothing was remembered.
That is what lets a dispatch that reaches an interface member through a
computed key line up with the member it invoked; previously every such call
was either named under an inferred path no comparison can match or dropped.

The bound on that fix is worth stating: it only recovers a name for a callee
that was itself read through a traced property access. A page that reads the
environment once and then drives everything off its own state objects shows
its dispatch as reads of those objects, under whatever member names it chose,
and no trace setting turns those into the environment reads that produced
them. The challenge widget is exactly this shape, which is why a traced widget
frame reports far fewer environment members than the reference does even when
both run the same script.

**A traced live challenge that does not finish is expected, not a crash.**
Traced runs compile bootstrap instead of loading the startup snapshot and pay
the probe cost, which is enough to trip the V8 termination watchdog on a page
whose own synchronous work is near the limit: the observable symptom is
`V8 watchdog fired: terminated a synchronous overrun` on stderr and a run that
stops partway through the challenge. Compare the phases both sides reached
instead of treating the short run as evidence about the page. The reference
side is not a fair pace comparison either: the CF example compresses the
challenge's timer delays to 550 ms on purpose, so it finishes a round the
traced engine cannot. Two related traps: the CLI's process-wide hard deadline
can kill a run before the trace writer flushes its tail, which loses the WHOLE
file rather than the last chunk — keep `--wait` under the deadline — and a run
killed that way leaves a zero-byte trace that reads as "the page did nothing".

Worker realms are covered. A worker runs its own isolate in the same process,
so it shares the armed state and the record file, and its author code is page
code: a `postMessage`, `crypto.subtle` or `TextEncoder.encode` from inside a
Worker is recorded. The realm is part of `src`, so a worker record is not read
as a frame's or the top-level document's:

| call site in `src` | realm |
| --- | --- |
| `https://...` | that document (top-level or frame) |
| `<worker #n>` | the worker's own script, and code a worker evals |
| `<page-eval>` | eval'd code in a document realm |

`#n` numbers worker isolates in the order their author scripts first appear, so
records can be attributed to one worker instance. Without it a terminated
worker, its replacement and a live one all read the same tag, and a worker that
stopped producing records cannot be told from one that never spoke. An id is
never reused, except that an isolate freed and reallocated at the same address
would inherit a number; that direction can only make a dead worker look alive,
so a missing record is still a real absence.

A worker's message handler evals the command it is sent on a live challenge,
which is the common case; the eval carries the worker tag because the script it
was called from is the worker's own. Engine code inside the worker
(`<obscura:worker-prep>`, `<obscura:worker-message>`) is still filtered, as it
is in a document realm.

### Mid-flight arming

A trace that runs from process start pays for its probes inside the setup phase
a comparison depends on, and on a live challenge that changes the page: with
the trace on from the first byte, the run no longer reaches the proof request
the untraced run sends. The arm gate keeps every record path at its cheapest
until a trigger fires, so the early phase runs at close to untraced speed while
the trace still covers the phase of interest.

| Variable | Effect |
| --- | --- |
| `OBSCURA_TRACE_ARM_AT_MS=<ms>` | arm once the trace clock (ms since the first traced event) passes this value |
| `OBSCURA_TRACE_ARM_FILE=<path>` | arm once this path exists; polled at most once per 5 ms per process |

Both may be set; whichever fires first arms the trace. With neither set the
trace is armed from the start, which is what existing callers expect. While
unarmed a probe costs one runtime call plus one relaxed load: no name
rendering, no constructor-name lookup and no stack walk. On a microbenchmark of
3M named and 3M keyed reads that is 268 ms and 186 ms against 9150 ms and
2521 ms with the gate open, versus 4 ms and 143 ms untraced. In JSON mode with
`--trace-api-keyed off`, keyed reads now emit no probe at all: the pre-load
probe has nothing to record in that mode, and paying a runtime call per keyed
read was the largest remaining cost.

Measured on the Cloudflare Turnstile challenge (2026-09-11): an armed run
(`OBSCURA_TRACE_ARM_AT_MS=3000`, `--trace-api-keyed off`) issued the widget
proof request `/fo` #2 at 11.75 s, the request an untraced run issues at
10.2 s; the same filter traced from process start never issued it.

Keep `--trace-api-keyed off` for a comparison run. Keyed probes are what a
minified script actually uses -- a challenge reads its API members through
computed keys -- but arming early with them on diverges the flow: measured on
the same challenge, `--trace-api-keyed on` with `OBSCURA_TRACE_ARM_AT_MS=2500`
produced no widget-worker records and none of the second-render positions a
keyed-off round of the same period reaches. The cost of a keyed probe is paid
per access, and the JSVMP in the widget frame makes those accesses by the
hundred thousand. This is a measurement dilemma, not a tuning knob: the probe
that would explain the branch is the probe that changes it.

## Calls And Console

A `GET Array.map` proves the method was read, not that it was called. Optional
`--v8-flags "--trace"` adds historical JS function CALL/RET records, including
bootstrap functions called directly by page JS. It is not universal native
builtin/callback invocation tracing, and it can substantially change timing.
Call arguments/returns use compact previews, not full object serialization.

`--trace-op-file FILE` is the separate host-operation stream: DOM ops, requests,
WebSocket, IndexedDB and console. `console.log` reaches `op_console_msg`, which
records complete strings, including long `payloadJSON` output. This works in
`fetch` as well as `serve`. Objects still undergo normal console formatting;
serialize deliberately when a structured payload is needed.

Neither stream is zero-cost when enabled. Property records are queued in 1 MiB
chunks and drained by a background thread; normal process exit flushes the
tail. Abrupt termination can lose buffered records. Separate timing-sensitive
payload collection from full trace, and retain a trace-off comparison.

## Usage And Verification

```bash
CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 cargo build --release -p obscura-cli --bins \
  --features render --config vendor/v8-source.toml
vendor/v8-trace.sh check
./target/release/obscura --trace-api-file /tmp/properties.tsv \
  --trace-op-file /tmp/operations.log fetch https://example.com --wait 0
cargo nextest run --release --features render -p obscura-cli \
  --test native_trace --config vendor/v8-source.toml
```

`check` executes a real author-script HIT/MISS smoke. The presence of a CLI
option alone is not evidence that the linked V8 contains the instrumentation.
The integration fixture checks exact hot/cold counts, forced TurboFan optimization, IC-disabled and interpreter
execution, array indices, getter/setter and Proxy side effects, key coercion,
CLI evaluation visibility, filenames containing spaces, and console strings.

Current unimplemented boundaries: universal native builtin CALL/RET, exception
events, full global loads, `super`/private access, reflection builtin internals,
delete/define/enumeration events, stable symbol/realm IDs, and watch/ignore gates.
Do not describe this as full iv8-equivalent coverage yet.

## Migration Evidence (2026-09-06)

Focused CLI verification passed all four tests, including 165 reads before
and after forced TurboFan optimization and 4,000 reads in each IC/interpreter
mode, plus current-realm Window MISS. EventTarget/XHR/Window/event focused
coverage passed 67 tests. The workspace gate is still being verified.
The pre-migration author-script smoke recorded
ordinary-object HIT/MISS twice per cold read. Earlier zero-record `<eval>`
experiments were hidden by name filtering, not proof that IC hooks never ran.

A pre-rebuild proxy run captured complete console payloads (47 and 91 top-level
keys). `gsLi5` comparison, excluding `o.*` and merging path-to-bucket sets without
overwriting, found 77 differences: 55 live-only paths, 3 reference-only paths,
19 changed buckets. Reference payloads 2 and 3 had zero differences under the
same comparison. Device, locale, viewport, dynamic URLs and document state were
not aligned, so these are not 77 proven engine defects. Equal top-level key
counts do not establish environment parity or explain the final challenge result.

Chrome oracle identified one independent defect: EventTarget and Node must be
distinct, with Node inheriting EventTarget. Obscura aliased them and consequently
exposed Node members on Window. The correction changes the shared inheritance
rather than hiding individual properties from enumeration. Event dispatch and
subclass behavior are covered by runtime regression tests.

Three post-fix live payloads each removed exactly 47 extra global Node paths.
The same comparison dropped from 77 differences to 30 (1,690 live paths to
1,643, versus 1,638 reference paths), in all three runs. The page still returned
a challenge.

The full-property proxy run recorded 500,850 events: 478,381 HIT, 22,439 MISS,
and 30 UNKNOWN; 464,576 GET, 35,364 SET, 33 HAS and 877 GLOBAL. It produced zero
malformed TSV rows and zero engine-internal script rows. It also triggered the
synchronous V8 watchdog before any payloadJSON output. This trace is a partial
execution record, not payload-parity evidence. The watchdog was not weakened;
the three complete payload samples used console-op tracing alone.
