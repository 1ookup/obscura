# Native Trace

## Architecture

`--trace-api-file FILE` selects the property instrumentation in the pinned
vendored V8. The CLI enables `--trace-property-lookup` before isolate creation
and supplies the filename separately through `OBSCURA_TRACE_API_FILE`, including
filenames containing spaces. This requires a source-built binary.

The active path does not install ObjectTemplate descriptor trampolines or JS
Proxy wrappers. It does not replace page-visible methods or descriptors. The
old Rust descriptor-monitor code remains dormant; its install calls have been
removed. Its ignore/watch/devtools CLI options now fail explicitly instead of
silently doing nothing. Their environment equivalents are not implemented by
the V8 monitor either.

The implementation is edited directly in `vendor/rusty_v8/v8`, a nested Git
repository. There is no build-time V8 trace patch script:
The bytecode migration is committed in that checkout as `59ee73ae`.

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
