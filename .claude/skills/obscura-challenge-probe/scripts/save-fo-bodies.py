import os
_log = open("/tmp/goal/savefo.log", "a")
def _note(m):
    _log.write(m + "\n"); _log.flush()
def response(flow):
    try:
        if flow.response is not None and "/fo/" in flow.request.pretty_url:
            os.makedirs("/tmp/goal/fobodies5", exist_ok=True)
            body = flow.response.content or b""
            if body:
                with open(f"/tmp/goal/fobodies5/{len(flow.request.content or b'')}-{len(body)}.bin", "wb") as h:
                    h.write(body)
            _note(f"fo req={len(flow.request.content or b'')} resp={len(body)} status={flow.response.status_code}")
    except Exception as exc:
        _note(f"err {exc}")
