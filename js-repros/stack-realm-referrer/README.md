# Stack, realm, and referrer fixture

This fixture exercises browser-generic behavior in one deterministic page:

- parser-provided document line numbers for inline and external `Error.stack`;
- cross-origin `WindowProxy` `SecurityError` checks;
- same-origin iframe referrer inheritance;
- an iframe `referrerpolicy="no-referrer"` override;
- same-origin and cross-origin `fetch()` Referer headers.

The capture harness should serve this directory on two different loopback
origins. The root response uses `Referrer-Policy: strict-origin-when-cross-origin`
and includes the checked-in meta policy to verify response metadata precedence.
Replace `__CROSS_ORIGIN__` in `index.html` at serve time with the second origin.

The normalized Chrome 146 oracle is in `chrome-oracle.json`. Origins and the
machine-specific stack URL are normalized to `<origin-a>`, `<origin-b>`, and
`<document>:<line>`; the semantic values are stable across ports.

For an Obscura run, use the release CLI with `--allow-private-network`, wait for
the fixture promise to settle, and inspect `#fixture-result` or evaluate
`globalThis.fixtureResult` through CDP. Keep `RUST_LOG=obscura=debug` enabled so
the navigation, frame, and fetch request records provide trace evidence.
