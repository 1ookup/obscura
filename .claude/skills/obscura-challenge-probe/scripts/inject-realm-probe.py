"""Inject /tmp/goal/probe.js as the first statement of every JS response and of
the challenge documents' inline scripts, so the probe runs in every realm even
without CDP preload support."""
_log = open("/tmp/goal/preloadwrap.log", "a")


def _note(m):
    _log.write(m + "\n")
    _log.flush()


def response(flow):
    try:
        with open("/tmp/goal/probe.js", "r", encoding="utf-8") as handle:
            snippet = handle.read()
        if flow.response is None:
            return
        if "/fo/" in flow.request.pretty_url:
            import os
            os.makedirs("/tmp/goal/fobodies4", exist_ok=True)
            body = flow.response.content or b""
            if body:
                with open(f"/tmp/goal/fobodies4/{len(flow.request.content or b'')}-{len(body)}.bin", "wb") as h:
                    h.write(body)
        if flow.request.method.upper() != "GET" or flow.response.status_code not in (200, 403):
            return
        ctype = (flow.response.headers.get("content-type", "") or "").lower()
        url = flow.request.pretty_url
        if "javascript" in ctype or "ecmascript" in ctype:
            body = flow.response.get_text(strict=False)
            if body:
                flow.response.set_text(snippet + "\n" + body)
                _note(f"[preloadwrap] js {len(body)} at {url[:90]}")
            return
        if "html" in ctype and ("/1.txt" in url or "/turnstile/f/" in url):
            body = flow.response.get_text(strict=False)
            marker = "<script nonce="
            at = body.find(marker)
            if at == -1:
                _note(f"[preloadwrap] no nonce script in {url[:70]}")
                return
            gt = body.find(">", at)
            if gt == -1:
                return
            flow.response.set_text(body[: gt + 1] + snippet + body[gt + 1:])
            _note(f"[preloadwrap] inline at {url[:70]}")
    except Exception as exc:
        _note(f"[preloadwrap] error: {exc}")
