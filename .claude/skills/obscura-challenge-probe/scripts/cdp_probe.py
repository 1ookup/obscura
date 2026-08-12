#!/usr/bin/env python3
"""Drive an obscura CDP session with a preload script and report what a page did.

Preload injection is the point. A challenge payload caches native references
while it loads, so a hook installed afterwards (obscura's `--eval`, a DevTools
console) sees nothing. `Page.addScriptToEvaluateOnNewDocument` runs first.

  ./cdp_probe.py messages https://example.com          # postMessage timeline
  ./cdp_probe.py shadow   https://example.com          # iframes incl. closed shadow roots
  ./cdp_probe.py eval     https://example.com --expr 'document.title'

Assumes `obscura serve` is already listening (see SKILL.md).
"""
import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

# Records every message from a cross-origin sender with its arrival time. The
# V8 trace cannot answer this: argument capture reads the JS frame, and
# postMessage is a native binding with no parameters there.
PRELOAD_MESSAGES = r"""
(function () {
  window.__t0 = Date.now();
  window.__pm = [];
  window.__err = [];
  window.addEventListener('message', function (e) {
    var d = e.data;
    var s = (typeof d === 'object') ? JSON.stringify(d) : String(d);
    window.__pm.push({ t: Date.now() - window.__t0, origin: e.origin, data: s.slice(0, 400) });
  });
  window.addEventListener('error', function (e) {
    window.__err.push({ t: Date.now() - window.__t0, m: String(e.message || '').slice(0, 160) });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    window.__err.push({ t: Date.now() - window.__t0,
                        m: 'reject: ' + String((r && r.message) || r).slice(0, 160) });
  });
})();
"""

# `querySelectorAll` stops at a shadow boundary and a closed root is not
# reachable through `el.shadowRoot`, so an iframe placed in one is invisible to
# every ordinary probe. Capturing the root as it is created is the way in.
PRELOAD_SHADOW = r"""
(function () {
  window.__roots = [];
  var attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    var root = attach.apply(this, arguments);
    try { window.__roots.push({ mode: init && init.mode, host: this.tagName, root: root }); }
    catch (e) {}
    return root;
  };
})();
"""

REPORT_MESSAGES = "JSON.stringify({pm: window.__pm, err: window.__err, title: document.title})"

REPORT_SHADOW = r"""
JSON.stringify((function () {
  var out = { roots: [], lightIframes: document.querySelectorAll('iframe').length };
  (window.__roots || []).forEach(function (entry) {
    var frames = entry.root.querySelectorAll ? entry.root.querySelectorAll('iframe') : [];
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var d = { mode: entry.mode, host: entry.host,
                src: String(f.getAttribute('src') || '').slice(0, 110),
                connected: f.isConnected, hasContentWindow: !!f.contentWindow };
      // Cross-origin `contentDocument` is null, not a throw -- reading a
      // document here would be the leak. (`contentWindow.document` is the one
      // that throws, and is checked separately.)
      try { d.contentDocument = f.contentDocument ? 'READABLE(leak!)' : 'null(correct)'; }
      catch (e) { d.contentDocument = 'threw: ' + String(e.message || e).slice(0, 40); }
      try { void f.contentWindow.document; d.crossOriginGuard = 'MISSING(leak!)'; }
      catch (e) { d.crossOriginGuard = 'throws(correct)'; }
      out.roots.push(d);
    }
  });
  return out;
})())
"""


async def call(ws, method, params=None, session=None, msg_id=1):
    request = {"id": msg_id, "method": method}
    if params:
        request["params"] = params
    if session:
        request["sessionId"] = session
    await ws.send(json.dumps(request))
    while True:
        reply = json.loads(await ws.recv())
        if reply.get("id") == msg_id:
            return reply


async def run(endpoint, url, preload, report, wait):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        reply = await call(ws, "Target.createTarget", {"url": "about:blank"}, msg_id=1)
        target = reply["result"]["targetId"]
        reply = await call(ws, "Target.attachToTarget",
                           {"targetId": target, "flatten": True}, msg_id=2)
        session = reply["result"]["sessionId"]

        await call(ws, "Page.enable", session=session, msg_id=3)
        if preload:
            await call(ws, "Page.addScriptToEvaluateOnNewDocument",
                       {"source": preload}, session=session, msg_id=4)
        await call(ws, "Runtime.enable", session=session, msg_id=5)
        await call(ws, "Page.navigate", {"url": url}, session=session, msg_id=6)

        await asyncio.sleep(wait)
        reply = await call(ws, "Runtime.evaluate",
                           {"expression": report, "returnByValue": True},
                           session=session, msg_id=7)
        result = reply.get("result", {}).get("result", {})
        if "value" not in result:
            return {"error": reply.get("result")}
        return json.loads(result["value"])


def print_messages(data):
    if "error" in data:
        print("evaluate failed:", data["error"])
        return
    print("title:", data.get("title"))
    print("--- messages ---")
    repeated = {}
    for entry in data.get("pm", []):
        text = entry["data"]
        # Heartbeats repeat by design; count them instead of listing them.
        if '"event":"food"' in text:
            repeated["food"] = repeated.get("food", 0) + 1
            continue
        print("  %7d ms  %-34s %s" % (entry["t"], entry["origin"][:34], text))
    for name, count in repeated.items():
        print("  (%s x%d)" % (name, count))
    errors = data.get("err", [])
    print("--- errors ---")
    for entry in errors:
        print("  %7d ms  %s" % (entry["t"], entry["m"]))
    if not errors:
        print("  none")


def print_shadow(data):
    if "error" in data:
        print("evaluate failed:", data["error"])
        return
    print("iframes in the light DOM:", data.get("lightIframes"))
    print("--- iframes reachable only through a captured shadow root ---")
    for frame in data.get("roots", []):
        print(" ", json.dumps(frame, ensure_ascii=False))
    if not data.get("roots"):
        print("  none")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=["messages", "shadow", "eval"])
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--wait", type=float, default=35.0,
                        help="seconds to observe before reporting (default 35)")
    parser.add_argument("--expr", default="document.title",
                        help="expression for `eval` mode")
    args = parser.parse_args()

    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    if args.mode == "messages":
        preload, report, show = PRELOAD_MESSAGES, REPORT_MESSAGES, print_messages
    elif args.mode == "shadow":
        preload, report, show = PRELOAD_SHADOW, REPORT_SHADOW, print_shadow
    else:
        preload, report, show = None, "JSON.stringify(%s)" % args.expr, \
            lambda d: print(json.dumps(d, indent=1, ensure_ascii=False))

    show(asyncio.run(run(endpoint, args.url, preload, report, args.wait)))


if __name__ == "__main__":
    main()
