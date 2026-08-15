# HTTP/2 and proxy fixture

Use an HTTPS origin that advertises ALPN `h2` and a local proxy with
`NO_PROXY=127.0.0.1`. The response trace should report the negotiated protocol
and the local request should bypass the proxy. TLS identity remains supplied by
the configured network client/profile.

The repository does not include a certificate or proxy daemon, and Chrome is
unavailable on the current host. Validation here is compile-time feature
coverage plus the client-side `NO_PROXY` wiring; run the ALPN fixture in an
environment with local HTTPS infrastructure.
