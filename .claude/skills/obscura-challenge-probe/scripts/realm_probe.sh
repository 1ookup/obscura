#!/usr/bin/env bash
# Which origin does each API in a cross-origin iframe resolve a relative URL to?
#
# Two local servers on different ports are a cross origin, so each API can fire
# one request and the server logs say where it landed. A same-origin or `data:`
# iframe cannot answer this: `data:` URLs take a legacy same-origin path, which
# is why several rounds of local tests passed while the real page failed.
#
#   ./realm_probe.sh [path-to-obscura]
#
set -euo pipefail

BIN="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/target/release/obscura}"
[[ -x "$BIN" ]] || { echo "obscura not found at $BIN" >&2; exit 1; }

PAGE_PORT=8901
FRAME_PORT=8902
WORK="$(mktemp -d)"
# Job-control notices from the killed servers would otherwise land after the
# report and read as failures.
cleanup() {
  pkill -f "http.server 890" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/page" "$WORK/frame"

cat > "$WORK/frame/frame.html" <<HTM
<!DOCTYPE html><html><body>
<a id="a" href="/probe-anchor">x</a><form id="f" action="/probe-form"></form>
<script>
var r = { locHref: location.href, docURL: document.URL, baseURI: document.baseURI,
          anchorHref: document.getElementById('a').href,
          formAction: document.getElementById('f').action };
try { fetch('/probe-fetch'); } catch (e) {}
try { var x = new XMLHttpRequest(); x.open('POST', '/probe-xhr'); x.send('x'); } catch (e) {}
try { var i = new Image(); i.src = '/probe-img'; } catch (e) {}
try { var s = document.createElement('script'); s.src = '/probe-script';
      document.head.appendChild(s); } catch (e) {}
setTimeout(function () { parent.postMessage(JSON.stringify(r), '*'); }, 700);
</script></body></html>
HTM

cat > "$WORK/page/page.html" <<HTM
<!DOCTYPE html><html><body><script>
window.__r = null;
window.addEventListener('message', function (e) { window.__r = e.data; });
var f = document.createElement('iframe');
f.setAttribute('src', 'http://127.0.0.1:$FRAME_PORT/frame.html');
document.body.appendChild(f);
setTimeout(function () { document.title = String(window.__r); }, 3000);
</script></body></html>
HTM

# Disowned so the shell does not announce their termination after the report.
python3 -m http.server "$PAGE_PORT" --directory "$WORK/page" > "$WORK/page.log" 2>&1 &
disown
python3 -m http.server "$FRAME_PORT" --directory "$WORK/frame" > "$WORK/frame.log" 2>&1 &
disown
sleep 1.5

echo "=== values read inside the frame ==="
OBSCURA_ALLOW_PRIVATE_NETWORK=1 "$BIN" \
  fetch "http://127.0.0.1:$PAGE_PORT/page.html" \
  -e "document.title || 'null'" --wait 5 2>&1 | tail -1 \
  | python3 -c '
import sys, json
raw = sys.stdin.read().strip()
try:
    data = json.loads(raw)
    if isinstance(data, str):
        data = json.loads(data)
except Exception:
    print("  (no report:", raw[:120], ")"); raise SystemExit
for key, value in data.items():
    print("  %-12s %s" % (key, value))
'

echo
echo "=== which server received each request ==="
echo "  page origin  (:$PAGE_PORT) -- anything here resolved against the embedder:"
grep -oE "probe-[a-z]+" "$WORK/page.log" 2>/dev/null | sort | uniq -c | sed 's/^/   /' || echo "     none"
echo "  frame origin (:$FRAME_PORT) -- correct:"
grep -oE "probe-[a-z]+" "$WORK/frame.log" 2>/dev/null | sort | uniq -c | sed 's/^/   /' || echo "     none"
