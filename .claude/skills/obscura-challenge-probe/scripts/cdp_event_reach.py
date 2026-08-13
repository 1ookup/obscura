#!/usr/bin/env python3
"""Does a CDP click actually reach the DOM inside the widget's cross-origin frame?

Everything upstream of this has been verified (hit-test, composed, mouseMoved,
the checkbox paints, the coordinates land on it) and the challenge still doesn't
advance. That leaves two possibilities, and they need different fixes:

  A. the event never reaches the frame's document  -> input routing bug
  B. it reaches, but Turnstile's own handler ignores it -> binding/condition bug

So: install capture-phase listeners on the *frame's* document via an isolated
world, click, and read back what fired. Also instrument the top document, to
show the click was dispatched at all.

  ./cdp_event_reach.py https://zencare.co/1.txt --port 9223 --wait 14

Compare against a real Chrome with --port 9222.
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

TYPES = ("pointerover pointerenter pointermove pointerdown pointerup "
         "mouseover mouseenter mousemove mousedown mouseup click").split()

# One line on purpose: obscura's Runtime.evaluate silently returns nothing for
# some multi-line forms (see the profile's blind-spot table).
INSTALL = ("(function(){window.__hits=[];var T=%s;T.forEach(function(t){"
           "document.addEventListener(t,function(e){try{window.__hits.push("
           "t+'@'+(e.target&&e.target.tagName?e.target.tagName.toLowerCase():'?')"
           "+(e.target&&e.target.className?'.'+String(e.target.className).slice(0,18):'')"
           "+'|trusted='+e.isTrusted);}catch(x){window.__hits.push(t+'@err');}},true);});"
           "return JSON.stringify({installed:T.length,url:location.href,"
           "html:document.body?document.body.innerHTML.length:-1});})()"
           % json.dumps(TYPES))

READ = ("(function(){return JSON.stringify({hits:(window.__hits||[]).slice(0,40),"
        "n:(window.__hits||[]).length});})()")


def endpoint_for(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


def walk(node, out):
    f = node.get("frame", {})
    out.append((f.get("id"), f.get("url", "")))
    for c in node.get("childFrames", []) or []:
        walk(c, out)


class Cdp:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def call(self, method, params=None, session=None):
        self.n += 1
        mid = self.n
        req = {"id": mid, "method": method, "params": params or {}}
        if session:
            req["sessionId"] = session
        await self.ws.send(json.dumps(req))
        while True:
            m = json.loads(await self.ws.recv())
            if m.get("id") == mid:
                return m

    async def ev(self, expr, session, context=None):
        p = {"expression": expr, "returnByValue": True}
        if context is not None:
            p["contextId"] = context
        r = await self.call("Runtime.evaluate", p, session=session)
        v = r.get("result", {}).get("result", {})
        if "value" not in v:
            return {"__raw": r.get("result") or r.get("error")}
        try:
            return json.loads(v["value"])
        except (ValueError, TypeError):
            return {"__raw": v["value"]}


async def run(endpoint, url, match, wait, click_xy):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        c = Cdp(ws)
        r = await c.call("Target.createTarget", {"url": "about:blank"})
        t = r["result"]["targetId"]
        r = await c.call("Target.attachToTarget", {"targetId": t, "flatten": True})
        s = r["result"]["sessionId"]
        await c.call("Page.enable", session=s)
        await c.call("Runtime.enable", session=s)
        await c.call("Page.navigate", {"url": url}, session=s)
        await asyncio.sleep(wait)

        r = await c.call("Page.getFrameTree", session=s)
        frames = []
        walk(r.get("result", {}).get("frameTree", {}), frames)
        print("--- frames ---")
        for fid, furl in frames:
            print("  %-14s %s" % (fid, (furl or "")[:88]))

        # Instrument the top document (main world) and every matching frame
        # (isolated world).
        print("--- install ---")
        print("  top(main world)   ->", json.dumps(await c.ev(INSTALL, s)))
        worlds = []
        for fid, furl in frames:
            if not fid or (match and match not in (furl or "")):
                continue
            w = await c.call("Page.createIsolatedWorld",
                             {"frameId": fid, "worldName": "probe",
                              "grantUniveralAccess": True}, session=s)
            ctx = w.get("result", {}).get("executionContextId")
            if ctx is None:
                print("  %-17s -> createIsolatedWorld FAILED %s"
                      % (fid, json.dumps(w.get("error") or w.get("result"))[:120]))
                continue
            worlds.append((fid, furl, ctx))
            print("  %-17s -> %s" % (fid + "(ctx%s)" % ctx,
                                     json.dumps(await c.ev(INSTALL, s, ctx))))

        x, y = click_xy
        await c.call("Input.dispatchMouseEvent",
                     {"type": "mouseMoved", "x": x - 30, "y": y - 12}, session=s)
        await asyncio.sleep(0.1)
        await c.call("Input.dispatchMouseEvent",
                     {"type": "mouseMoved", "x": x, "y": y}, session=s)
        await asyncio.sleep(0.12)
        await c.call("Input.dispatchMouseEvent",
                     {"type": "mousePressed", "x": x, "y": y, "button": "left",
                      "buttons": 1, "clickCount": 1}, session=s)
        await asyncio.sleep(0.06)
        await c.call("Input.dispatchMouseEvent",
                     {"type": "mouseReleased", "x": x, "y": y, "button": "left",
                      "buttons": 0, "clickCount": 1}, session=s)
        print("--- clicked at (%.0f,%.0f) ---" % (x, y))
        await asyncio.sleep(2.0)

        print("--- what fired ---")
        print("  top(main world)   ->", json.dumps(await c.ev(READ, s), ensure_ascii=False))
        for fid, furl, ctx in worlds:
            print("  %-17s -> %s" % (fid + "(ctx%s)" % ctx,
                                     json.dumps(await c.ev(READ, s, ctx), ensure_ascii=False)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--wait", type=float, default=14.0)
    p.add_argument("--match", default="challenges.cloudflare.com")
    p.add_argument("--xy", default="213,335")
    a = p.parse_args()
    x, y = (float(v) for v in a.xy.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url, a.match, a.wait, (x, y)))


if __name__ == "__main__":
    main()
