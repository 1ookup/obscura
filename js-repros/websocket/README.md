# WebSocket fixture

Serve an RFC 6455 echo endpoint on `127.0.0.1:8765`, then evaluate
`websocketFixture`. The expected sequence is `open`, `message:hello`, and a
clean close. The endpoint is local test infrastructure, not a page-specific
allowlist.

Chrome 146 comparison is pending because Chrome is unavailable on the current
host. The local RFC 6455 echo run is the deterministic transport check.
