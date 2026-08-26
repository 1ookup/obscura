#!/usr/bin/env python3
"""Capture obscura's Turnstile challenge payloads (full, untruncated).

Preloads a passive hook in every frame realm that records:
  - full postMessage data (widget <-> parent)
  - XHR method/url/body
  - fetch url/body
  - sendBeacon url/body

Every record also goes out through console.warn, which obscura funnels from
all realms into the serve log (one grep sees widget + top). After settle it
also dumps the TOP realm's window.__cap for easy reading.

Chrome's full challenge is THREE submissions: the render (chl_api_m) + an
initial /fo/ + a post-click proof /fo/. A passive run only sees the pre-click
ones. Add --click to wait for interactiveBegin, click the checkbox, and keep
capturing the proof POST -- that is what reproduces Chrome's third payload.

  ./capture_challenge.py https://www.thelancet.com/1.txt --port 9223 --wait 35
  ./capture_challenge.py https://www.thelancet.com/1.txt --port 9223 --click --wait 45
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
  if (globalThis.__capHooked) return;
  globalThis.__capHooked = 1;
  var cap = [];
  window.__cap = cap;
  var t0 = Date.now();
  function rec(kind, detail) {
    var o = { t: Date.now() - t0, kind: kind, d: detail };
    try { cap.push(o); console.warn('[CAP] ' + JSON.stringify(o)); } catch (e) {}
  }
  // shadow-root capture, so the click probe can see the widget iframe inside
  // Turnstile's closed shadow root.
  window.__roots = [];
  var _ash = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (i) {
    var r = _ash.apply(this, arguments);
    try { window.__roots.push(r); } catch (e) {}
    return r;
  };
  // passive postMessage listener (does NOT wrap postMessage/contentWindow)
  window.addEventListener('message', function (e) {
    var d = e.data;
    var s;
    try { s = (typeof d === 'object' && d !== null) ? JSON.stringify(d) : String(d); }
    catch (x) { s = String(d); }
    rec('PM', { origin: e.origin, data: s });
  });
  function str(x) {
    try { return (typeof x === 'object' && x !== null) ? JSON.stringify(x) : String(x); }
    catch (e) { return String(x); }
  }
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__m = m; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    try { rec('XHR', { method: this.__m, url: String(this.__u), body: (b === undefined || b === null) ? null : str(b) }); } catch (e) {}
    return _send.apply(this, arguments);
  };
  var _f = window.fetch;
  if (typeof _f === 'function') {
    window.fetch = function (u, o) {
      try { rec('FETCH', { url: String((u && u.url) || u), body: (o && o.body !== undefined) ? str(o.body) : null }); } catch (e) {}
      return _f.apply(this, arguments);
    };
  }
  var _b = navigator.sendBeacon;
  if (typeof _b === 'function') {
    navigator.sendBeacon = function (u, d) { try { rec('BEACON', { url: String(u), body: str(d) }); } catch (e) {} return _b.apply(this, arguments); };
  }
  rec('READY', String(location.href));
})();
"""

DUMP = "JSON.stringify({url: String(location.href), cap: window.__cap || []})"

# Finds the widget iframe box (through shadow roots) and whether interactiveBegin
# has fired (from the recorded postMessages). Single-line IIFE -- obscura's
# Runtime.evaluate silently drops some multi-line forms.
PROBE = ("(function(){var b=null;var it=false;"
         "try{(window.__cap||[]).forEach(function(o){if(o.kind==='PM'&&o.d&&o.d.data&&"
         "o.d.data.indexOf('interactiveBegin')>=0)it=true;});}catch(e){}"
         "var fr=[];"
         "try{(window.__roots||[]).forEach(function(r){var f=r.querySelectorAll('iframe');"
         "for(var i=0;i<f.length;i++)fr.push(f[i]);});}catch(e){}"
         "try{var t=document.querySelectorAll('iframe');for(var j=0;j<t.length;j++)fr.push(t[j]);}catch(e){}"
         "for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
         "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
         "return JSON.stringify({box:b,interactive:it});})()")


def endpoint_for(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


async def run(endpoint, url, wait, click, offset, deadline):
    async with websockets.connect(endpoint, max_size=256 * 1024 * 1024) as ws:
        n = [0]

        async def call(method, params=None, session=None):
            n[0] += 1
            mid = n[0]
            req = {"id": mid, "method": method, "params": params or {}}
            if session:
                req["sessionId"] = session
            await ws.send(json.dumps(req))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == mid:
                    return msg

        async def evaluate(expr, session):
            r = await call("Runtime.evaluate",
                           {"expression": expr, "returnByValue": True}, session=session)
            v = r.get("result", {}).get("result", {})
            if "value" not in v:
                return None
            try:
                return json.loads(v["value"])
            except (ValueError, TypeError):
                return None

        r = await call("Target.createTarget", {"url": "about:blank"})
        r = await call("Target.attachToTarget", {"targetId": r["result"]["targetId"], "flatten": True})
        s = r["result"]["sessionId"]
        await call("Page.enable", session=s)
        await call("Runtime.enable", session=s)
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD}, session=s)
        await call("Page.navigate", {"url": url}, session=s)

        t = 0.0
        if click:
            # Do NOT evaluate in the first seconds: a Runtime.evaluate landing at
            # t~=1s permanently blanks obscura's document (known defect).
            await asyncio.sleep(5.0)
            t = 5.0
            clicked = False
            while t < deadline and not clicked:
                await asyncio.sleep(0.3)
                t += 0.3
                probe = await evaluate(PROBE, s) or {}
                box = probe.get("box")
                if box and probe.get("interactive"):
                    ox, oy = offset
                    x, y = box["x"] + ox, box["y"] + oy
                    await call("Input.dispatchMouseEvent",
                               {"type": "mouseMoved", "x": x - 30, "y": y - 12}, session=s)
                    await asyncio.sleep(0.1)
                    await call("Input.dispatchMouseEvent",
                               {"type": "mouseMoved", "x": x, "y": y}, session=s)
                    await asyncio.sleep(0.12)
                    await call("Input.dispatchMouseEvent",
                               {"type": "mousePressed", "x": x, "y": y, "button": "left",
                                "buttons": 1, "clickCount": 1}, session=s)
                    await asyncio.sleep(0.06)
                    await call("Input.dispatchMouseEvent",
                               {"type": "mouseReleased", "x": x, "y": y, "button": "left",
                                "buttons": 0, "clickCount": 1}, session=s)
                    clicked = True
                    print("clicked at t=%.1fs box=%s" % (t, json.dumps(box)))
            if not clicked:
                print("NEVER CLICKED (no widget box + interactiveBegin within %.0fs)" % deadline)

        # Settle to `wait`, then dump the top realm's capture.
        remaining = wait - t
        if remaining > 0:
            await asyncio.sleep(remaining)

        r = await call("Runtime.evaluate", {"expression": DUMP, "returnByValue": True}, session=s)
        val = r.get("result", {}).get("result", {}).get("value")
        try:
            data = json.loads(val)
        except (ValueError, TypeError):
            print("DUMP failed:", json.dumps(r)[:500])
            return
        print("=== TOP realm %s : %d records ===" % (data["url"][:70], len(data["cap"])))
        for rec in data["cap"]:
            print(json.dumps(rec, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--wait", type=float, default=35.0)
    p.add_argument("--click", action="store_true",
                   help="wait for interactiveBegin, click the checkbox, capture the proof POST")
    p.add_argument("--offset", default="21,31",
                   help="checkbox center relative to the widget iframe's top-left")
    p.add_argument("--click-deadline", type=float, default=40.0)
    a = p.parse_args()
    ox, oy = (float(v) for v in a.offset.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url, a.wait, a.click, (ox, oy), a.click_deadline))


if __name__ == "__main__":
    main()
