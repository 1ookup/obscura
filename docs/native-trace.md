# Native Trace

Obscura has two opt-in diagnostic streams. They are disabled unless explicitly
requested and do not change normal page behavior.

## API trace

`--trace-api-file <path>` enables the native browser API monitor. It records
getter, setter, query, missing-property and callback events for instrumented
BOM/DOM/WebIDL objects across the main realm and frame realms. Prototype misses
are reported separately so a missing method can be distinguished from an
ordinary undefined value.

The descriptor-trampoline implementation is a diagnostic plane. Anti-tamper
pages can observe replaced function identity even when `Function.prototype.toString`
is masked; in that case enabling API trace may change early page execution. Use
host-op/console tracing for payload capture until transparent V8 IC
instrumentation replaces this path.

The lower-level property/call hooks are fixed directly in the pinned vendored
V8 source, rather than applied by a build-time shell patch. The implementation
is in `vendor/rusty_v8/v8/src/ic/ic.cc`,
`vendor/rusty_v8/v8/src/runtime/runtime-test.cc`, and
`vendor/rusty_v8/v8/src/flags/flag-definitions.h`. The source override in
`vendor/v8-source.toml` selects this checkout, so a source build uses the same
instrumentation every time.

The pinned V8 checkout currently carries commits `e296b664` and `f0f833f5`
(`add native property and call trace hooks`, plus internal-script filtering).
Because the vendored checkout is
a nested repository, this commit is made in `vendor/rusty_v8/v8`, not in the
outer Obscura repository.

Runtime miss probes were added in V8 commit `dc297593`, with a compile fix in
`008aae52`. These cover runtime fallback functions, while generated
`AccessorAssembler` fast/generic paths can bypass them; full named/keyed hit
coverage remains a follow-up.

The subsequent `a9022ec5` commit adds probes to the no-feedback and keyed-has
runtime fallbacks. A smoke page still showed no records for ordinary object
loads, confirming that this V8 revision uses generated fast paths for that case;
the next implementation target is the corresponding AccessorAssembler
load/store/has branches.

The monitor is installed through V8 `ObjectTemplate` handlers and native
callback trampolines. It does not use JavaScript `Proxy` or historical V8 trace
flags. `--trace-api-ignore` filters exact paths. `--trace-api-watch` plus
`--trace-api-devtools` arms an optional debugger pause before recording.

## Host-op trace

`--trace-op-file <path>` records native operations that may not have a visible
JavaScript function frame:

- `fetch`/XHR and redirects
- DOM operations
- WebSocket operations
- IndexedDB operations
- console operations

`console.log` is a bootstrap JavaScript wrapper that ends at `op_console_msg`.
The host-op stream records its complete string argument, including
`payloadJSON`/`fo` challenge payloads. This is the supported way to compare
payloads in `assets/payload`; API trace alone does not contain console arguments.

## Builtin JavaScript calls

The native monitor also wraps selected ECMAScript builtin entry points. Current
coverage includes `Object`, `Reflect`, `JSON`, `RegExp`, `String`, `Function`,
and common `Array.prototype` methods. These calls use the same native callback
envelope and preserve receiver, arguments, return values and exceptions.

## Deliberate boundary

Arbitrary ordinary-object and array element accesses are not currently traced:

```js
obj.field;
obj.missing;
arr[0];
arr.missing;
```

Those objects are created directly by V8 and do not pass through browser
`ObjectTemplate` handlers. Complete tracing would require a separate opt-in V8
property-access instrumentation layer for named loads, indexed loads, stores,
`HasProperty` and enumeration. It must remain separate from the API monitor to
avoid tracing V8 internals and imposing a production cost.

## Reading a trace

Use API trace for browser surface parity, host-op trace for network/console
causality, and payload JSON for field-level comparison. A missing API trace line
does not prove that a JavaScript function did not execute: direct host ops and
unresolved ordinary-object accesses use different instrumentation paths.
