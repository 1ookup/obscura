# Page Script Trace

The current implementation, coverage, output format and verification commands
are maintained in [Native Trace](native-trace.md).

```bash
vendor/v8-trace.sh check
./target/release/obscura --trace-api-file /tmp/properties.tsv \
  --trace-op-file /tmp/operations.log fetch https://example.com --wait 0
```

The active monitor uses directly modified pinned V8 source. The previous
ObjectTemplate descriptor-trampoline monitor is no longer installed. Historical
iv8 text examples and ignore/watch instructions do not describe the active TSV
stream. Property access records must not be confused with complete function
invocation tracing; see the coverage boundaries in the canonical document.
