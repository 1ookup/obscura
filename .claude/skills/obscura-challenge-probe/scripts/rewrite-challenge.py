"""Proxy-side rewrite that puts the recovered instrumented challenge document
back in front of the browser.

This is the patch the upstream proxy used to apply: it replaced the challenge
document body with the instrumented build, so the challenge VM ran with its
tracelog call sites and a run produced a fragment. The upstream instance lost
that addon (its current flow history has no instrumented body, and the live
build no longer ships plaintext VM code at all), so the rewrite is restored
locally: mitmdump chains to the upstream proxy and swaps the document body in
flight, leaving the page untouched.

  mitmdump --mode upstream:http://192.168.3.57:9000 --ssl-insecure -p 8899 \
           -s .claude/skills/obscura-challenge-probe/scripts/rewrite-challenge.py

Then point Obscura at http://127.0.0.1:8899 instead of the upstream proxy.
"""
import os

from mitmproxy import http

BODY_PATH = os.environ.get("OBSCURA_REWRITE_BODY", "/tmp/api-patched.js")
HOST = os.environ.get("OBSCURA_REWRITE_HOST", "www.thelancet.com")
PATH = os.environ.get("OBSCURA_REWRITE_PATH", "/1.txt")

with open(BODY_PATH, "rb") as handle:
    BODY = handle.read()

rewritten = 0


def response(flow: http.HTTPFlow) -> None:
    global rewritten
    request = flow.request
    if request.pretty_host != HOST or request.path.split("?")[0] != PATH:
        return
    if flow.response is None or "text/html" not in flow.response.headers.get("content-type", ""):
        return
    flow.response.content = BODY
    flow.response.headers["content-length"] = str(len(BODY))
    flow.response.headers.pop("content-encoding", None)
    rewritten += 1
    print(f"[rewrite] challenge document at {request.pretty_url[:80]} -> {len(BODY)} bytes (n={rewritten})")


def done() -> None:
    print(f"[rewrite] served the instrumented document {rewritten} time(s)")
