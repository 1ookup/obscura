#!/usr/bin/env python3
"""Install listeners in the widget frame's MAIN world and see what a click fires.

Why not an isolated world: obscura keeps JS wrapper objects per realm, so a
listener registered from an isolated world may simply not be on the same object
the dispatcher walks -- an empty result would then say nothing about whether the
click arrived. So this collects `Runtime.executionContextCreated` events, picks
the frame's own main-world context, and installs there.

It also self-tests the probe: after installing, it dispatches a synthetic click
from inside that same context. If the self-test doesn't fire, the probe is
broken and the real click's result is meaningless.

  ./cdp_frame_mainworld_events.py https://zencare.co/1.txt --wait 20
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

TYPES = ("pointerover pointerdown pointerup mouseover mousedown mouseup click "
         "mousemove pointermove").split()

INSTALL = ("(function(){window.__hits=[];var T=%s;T.forEach(function(t){"
           "document.addEventListener(t,function(e){try{window.__hits.push(t+'@'+"
           "((e.target&&e.target.tagName)?e.target.tagName.toLowerCase():'?')+"
           "'|tr='+e.isTrusted);}catch(x){window.__hits.push(t+'@err');}},true);});"
           "return JSON.stringify({ok:1,n:T.length,url:location.href,"
           "all:document.querySelectorAll('*').length,"
           "doc:document.documentElement?document.documentElement.outerHTML.length:-1});})()"
           % json.dumps(TYPES))

SELFTEST = ("(function(){try{var e=new MouseEvent('click',{bubbles:true});"
            "document.body.dispatchEvent(e);return JSON.stringify({dispatched:1,"
            "hits:(window.__hits||[]).length});}catch(x){"
            "return JSON.stringify({error:String(x)});}})()")

READ = ("(function(){return JSON.stringify({n:(window.__hits||[]).length,"
        "hits:(window.__hits||[]).slice(0,40)});})()")

RESET = "(function(){window.__hits=[];return JSON.stringify({reset:1});})()"


def endpoint_for(port):
    o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(o.open("http://127.0.0.1:%d/json/version" % port,
                             timeout=5).read())["webSocketDebuggerUrl"]


class Cdp:
    def __init__(self, ws):
        self.ws, self.n, self.contexts = ws, 0, []

    async def call(self, method, params=None, session=None):
        self.n += 1
        mid = self.n
        req = {"id": mid, "method": method, "params": params or {}}
        if session:
            req["sessionId"] = session
        await self.ws.send(json.dumps(req))
        while True:
            m = json.loads(await self.ws.recv())
            if m.get("method") == "Runtime.executionContextCreated":
                self.contexts.append(m["params"]["context"])
            if m.get("id") == mid:
                return m

    async def pump(self, seconds):
        """Drain events (so executionContextCreated gets collected)."""
        try:
            end = asyncio.get_event_loop().time() + seconds
            while True:
                left = end - asyncio.get_event_loop().time()
                if left <= 0:
                    return
                m = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=left))
                if m.get("method") == "Runtime.executionContextCreated":
                    self.contexts.append(m["params"]["context"])
        except asyncio.TimeoutError:
            return

    async def ev(self, expr, session, context=None):
        p = {"expression": expr, "returnByValue": True}
        if context is not None:
            p["contextId"] = context
        r = await self.call("Runtime.evaluate", p, session=session)
        v = r.get("result", {}).get("result", {})
        if "value" not in v:
            return {"__raw": str(r.get("result") or r.get("error"))[:200]}
        try:
            return json.loads(v["value"])
        except (ValueError, TypeError):
            return {"__raw": str(v["value"])[:200]}


async def run(endpoint, url, match, wait, xy):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        c = Cdp(ws)
        r = await c.call("Target.createTarget", {"url": "about:blank"})
        r = await c.call("Target.attachToTarget",
                         {"targetId": r["result"]["targetId"], "flatten": True})
        s = r["result"]["sessionId"]
        await c.call("Page.enable", session=s)
        await c.call("Runtime.enable", session=s)
        await c.call("Page.navigate", {"url": url}, session=s)
        await c.pump(wait)

        print("--- execution contexts seen ---")
        for ctx in c.contexts:
            aux = ctx.get("auxData") or {}
            print("  id=%-4s frame=%-15s name=%-10r origin=%s"
                  % (ctx.get("id"), aux.get("frameId"), ctx.get("name"),
                     (ctx.get("origin") or "")[:60]))

        targets = [ctx for ctx in c.contexts
                   if match in (ctx.get("origin") or "")
                   or match in ((ctx.get("auxData") or {}).get("frameId") or "")]
        if not targets:
            print("!! no main-world context for %r -- cannot install in frame" % match)
            return

        installed = []
        print("--- install (frame main world) ---")
        for ctx in targets:
            cid = ctx["id"]
            res = await c.ev(INSTALL, s, cid)
            print("  ctx=%s -> %s" % (cid, json.dumps(res)[:220]))
            if res.get("ok"):
                installed.append(cid)

        print("--- probe self-test (synthetic click in same context) ---")
        for cid in installed:
            print("  ctx=%s -> %s" % (cid, json.dumps(await c.ev(SELFTEST, s, cid))))
            await c.ev(RESET, s, cid)

        x, y = xy
        for typ, extra in (("mouseMoved", {}),
                           ("mouseMoved", {}),
                           ("mousePressed", {"button": "left", "buttons": 1, "clickCount": 1}),
                           ("mouseReleased", {"button": "left", "buttons": 0, "clickCount": 1})):
            p = {"type": typ, "x": x, "y": y}
            p.update(extra)
            await c.call("Input.dispatchMouseEvent", p, session=s)
            await asyncio.sleep(0.12)
        print("--- real CDP click at (%.0f,%.0f) ---" % (x, y))
        await asyncio.sleep(2.0)

        print("--- what fired in the frame's main world ---")
        for cid in installed:
            print("  ctx=%s -> %s" % (cid, json.dumps(await c.ev(READ, s, cid),
                                                      ensure_ascii=False)[:400]))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--wait", type=float, default=20.0)
    p.add_argument("--match", default="challenges.cloudflare.com")
    p.add_argument("--xy", default="213,335")
    a = p.parse_args()
    x, y = (float(v) for v in a.xy.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url, a.match, a.wait, (x, y)))


if __name__ == "__main__":
    main()
