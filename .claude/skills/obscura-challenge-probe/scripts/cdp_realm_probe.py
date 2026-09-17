#!/usr/bin/env python3
"""Detect large page->worker postMessages from the Turnstile widget realm.

Question (step 41/42): does the 822KB/127KB JSVMP payload get posted INTO a
worker, or does it execute in the widget iframe's main thread? Answer from
step 42's Rust-side probe (op_worker_post_message instrumentation): the
payload NEVER goes into a worker -- all page->worker posts are <=3139B
fingerprint queries. This script re-observes the same thing from the page
side, without a rebuild.

Method: preload (runs in every frame realm) wraps
`Worker.prototype.postMessage` in the widget origin only. When a message
larger than --threshold bytes is posted INTO a worker, the wrap posts one
notification line to the parent:

    {"__obscuraProbe": "big-worker-post", "size": N, "kind": "..."}

which the top realm's message listener records into window.__pm.

IMPORTANT (step 42 finding): do NOT combine widget-realm hooks with frequent
Runtime.evaluate polling -- that combination reliably stalls the widget flow
(3/3 in testing) while the same preload with a single evaluate is fine
(4/4). Hence this script never polls: it waits a fixed time, evaluates once,
and reports.

  ./cdp_realm_probe.py https://zencare.co/1.txt --port 9227 --wait 25 \
      --threshold 10240
"""
import argparse
import asyncio
import json
import sys
import urllib.request

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

PRELOAD = r"""
(function () {
  var t0 = Date.now();
  window.__pm = window.__pm || [];
  window.addEventListener('message', function (e) {
    var d = e.data;
    var s = (typeof d === 'object') ? JSON.stringify(d) : String(d);
    window.__pm.push({ t: Date.now() - t0, origin: e.origin, data: s.slice(0, 200) });
  });
  if (location.hostname !== 'challenges.cloudflare.com') return;
  var TH = (typeof window.__obscuraProbeThreshold === 'number')
              ? window.__obscuraProbeThreshold : 10240;
  var W = window.Worker;
  if (W && W.prototype && W.prototype.postMessage) {
    var origPost = W.prototype.postMessage;
    W.prototype.postMessage = function (data) {
      var size = -1, kind = '?';
      try { kind = Object.prototype.toString.call(data); } catch (e) {}
      try { size = JSON.stringify(data).length; } catch (e) {
        try { size = data.byteLength; } catch (e2) {}
      }
      if (size >= TH) {
        try {
          window.parent.postMessage({ __obscuraProbe: 'big-worker-post',
                                      size: size, kind: kind }, '*');
        } catch (e) {}
      }
      return origPost.apply(this, arguments);
    };
  }
})();
"""

# Single-line IIFE only -- obscura's Runtime.evaluate silently returns nothing
# for some multi-line forms (measurement blind spot, step 29). Entries in
# window.__pm may be strings (click_fast-style preload) or objects
# (cdp_probe-style preload); normalize before string ops.
REPORT = ("(function(){var ev=[];var big=[];var seen={};(window.__pm||[]).forEach(function(m0){"
          "var m=(typeof m0==='string')?m0:JSON.stringify(m0);"
          "if(m.indexOf('food')>=0)return;if(m.indexOf('__obscuraProbe')>=0){big.push(m.slice(0,200));return;}"
          "var k=m.slice(0,60);if(!seen[k]){seen[k]=1;ev.push(m.slice(0,140));}});"
          "return JSON.stringify({big:big,events:ev,title:document.title});})()")


def endpoint_for(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


async def call(ws, method, params=None, session=None, msg_id=1):
    req = {"id": msg_id, "method": method}
    if params:
        req["params"] = params
    if session:
        req["sessionId"] = session
    await ws.send(json.dumps(req))
    while True:
        reply = json.loads(await ws.recv())
        if reply.get("id") == msg_id:
            return reply


async def run(endpoint, url, wait, threshold):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        target = None
        try:
            reply = await call(ws, "Target.createTarget", {"url": "about:blank"})
            target = reply["result"]["targetId"]
            reply = await call(ws, "Target.attachToTarget",
                               {"targetId": target, "flatten": True})
            session = reply["result"]["sessionId"]
            await call(ws, "Page.enable", session=session)
            await call(ws, "Runtime.enable", session=session)
            source = "window.__obscuraProbeThreshold = %s;\n%s" % (
                json.dumps(threshold), PRELOAD)
            await call(ws, "Page.addScriptToEvaluateOnNewDocument",
                       {"source": source}, session=session)
            await call(ws, "Page.navigate", {"url": url}, session=session)
            # No polling: wait a fixed window, then a few well-spaced report
            # attempts (the target is occasionally flaky and returns value=None;
            # retry instead of re-running the whole session).
            await asyncio.sleep(wait)
            for attempt in range(3):
                reply = await call(ws, "Runtime.evaluate",
                                   {"expression": REPORT, "returnByValue": True},
                                   session=session)
                result = reply.get("result", {}).get("result", {})
                value = result.get("value")
                if isinstance(value, str):
                    try:
                        return json.loads(value)
                    except ValueError:
                        pass
                await asyncio.sleep(5)
            return {"error": "report evaluate returned no value after 3 attempts",
                    "raw": result}
        finally:
            if target is not None:
                try:
                    await call(ws, "Target.closeTarget", {"targetId": target},
                               msg_id=1000)
                except Exception:
                    # The websocket may already be closing after a CDP error.
                    pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9227)
    p.add_argument("--wait", type=float, default=25.0,
                   help="seconds to observe before the single report")
    p.add_argument("--threshold", type=int, default=10240,
                   help="minimum serialized message size to report")
    a = p.parse_args()
    if a.threshold < 0:
        p.error("--threshold must be non-negative")
    data = asyncio.run(run(endpoint_for(a.port), a.url, a.wait, a.threshold))
    if "error" in data:
        print("evaluate failed:", data["error"])
        sys.exit(1)
    print("title:", data.get("title"))
    print("--- big worker-post notifications (>=%d bytes into a worker) ---" %
          a.threshold)
    for e in data.get("big", []):
        print("  ", e)
    if not data.get("big"):
        print("   (none -- nothing above the threshold was posted into a worker)")
    print("--- postMessage events (deduped, food filtered) ---")
    for e in data.get("events", []):
        print("  ", e)


if __name__ == "__main__":
    main()
