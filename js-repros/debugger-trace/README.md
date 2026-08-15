# Debugger and host trace fixture

The fixture exercises `Debugger.enable`/`scriptParsed` and the opt-in native
operation stream (`OBSCURA_TRACE_OP_FILE=/tmp/obscura-ops.tsv`). Compare the
event order and stack shape with a Chrome headless capture on a machine that
provides the Chrome oracle.

The current verification host does not provide Chrome/Chromium, so no oracle
JSON is checked in. The Obscura-side trace is deterministic.
