#!/usr/bin/env python3
"""Click the checkbox as soon as it renders, then film the result. 35s hard cap.

Two rules learned the hard way:
  - never run past ~35s: the page swaps to a fresh ray and everything after that
    is a different challenge, not more data about this one;
  - click the moment the widget has a box -- a late click lands on a dead realm
    and is indistinguishable from "the click did nothing".

Frames land in /tmp/probe/<tag>-tNN.png every 2s, with a one-line state dump.

  ./cdp_click_filmstrip.py https://zencare.co/1.txt --tag run1
"""
import argparse
import asyncio
import base64
import json
import sys
import urllib.request

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

# Single-line only: obscura's Runtime.evaluate silently drops some multi-line forms.
BOX = ("(function(){var fr=[];(window.__roots||[]).forEach(function(r){try{"
       "var f=r.querySelectorAll('iframe');for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});"
       "try{var t=document.querySelectorAll('iframe');for(var j=0;j<t.length;j++)fr.push(t[j]);}catch(e){}"
       "var b=null;for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
       "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
       "return JSON.stringify({box:b});})()")

STATE = ("(function(){return JSON.stringify({t:document.title,"
         "x:document.body?document.body.innerText.replace(/\\s+/g,' ').slice(0,80):''});})()")

PRELOAD = ("(function(){window.__roots=[];var a=Element.prototype.attachShadow;"
           "Element.prototype.attachShadow=function(i){var r=a.apply(this,arguments);"
           "try{window.__roots.push(r);}catch(e){}return r;};})()")


def endpoint_for(port):
    o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(o.open("http://127.0.0.1:%d/json/version" % port,
                             timeout=5).read())["webSocketDebuggerUrl"]


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

    async def ev(self, expr, session):
        r = await self.call("Runtime.evaluate",
                            {"expression": expr, "returnByValue": True}, session=session)
        v = r.get("result", {}).get("result", {})
        if "value" not in v:
            return {}
        try:
            return json.loads(v["value"])
        except (ValueError, TypeError):
            return {}


async def run(endpoint, url, cap, every, tag, offset, start):
    loop = asyncio.get_event_loop()
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        c = Cdp(ws)
        r = await c.call("Target.createTarget", {"url": "about:blank"})
        r = await c.call("Target.attachToTarget",
                         {"targetId": r["result"]["targetId"], "flatten": True})
        s = r["result"]["sessionId"]
        await c.call("Page.enable", session=s)
        await c.call("Runtime.enable", session=s)
        await c.call("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD}, session=s)
        t0 = loop.time()
        await c.call("Page.navigate", {"url": url}, session=s)

        # Do NOT poll during the first seconds: a Runtime.evaluate that lands
        # around t=1s permanently empties this target's document (verified:
        # start=20 ok, start=1 empty, start=20 ok again on the same process).
        # Polling early therefore destroys the very page being measured.
        await asyncio.sleep(start)

        clicked = None
        frame = 0
        while True:
            t = loop.time() - t0
            if t >= cap:
                break
            if clicked is None:
                box = (await c.ev(BOX, s)).get("box")
                if box:
                    x, y = box["x"] + offset[0], box["y"] + offset[1]
                    for typ, extra in (("mouseMoved", {}), ("mouseMoved", {}),
                                       ("mousePressed", {"button": "left", "buttons": 1,
                                                         "clickCount": 1}),
                                       ("mouseReleased", {"button": "left", "buttons": 0,
                                                          "clickCount": 1})):
                        p = {"type": typ, "x": x, "y": y}
                        p.update(extra)
                        await c.call("Input.dispatchMouseEvent", p, session=s)
                        await asyncio.sleep(0.08)
                    clicked = loop.time() - t0
                    print("  >>> CLICKED at t=%.1fs  (%.0f,%.0f) box=%s"
                          % (clicked, x, y, json.dumps(box)))
            st = await c.ev(STATE, s)
            shot = await c.call("Page.captureScreenshot", {"format": "png"}, session=s)
            data = shot.get("result", {}).get("data")
            size = 0
            if data:
                raw = base64.b64decode(data)
                size = len(raw)
                open("/tmp/probe/%s-t%02d.png" % (tag, int(t)), "wb").write(raw)
            print("  t=%5.1fs %7dB %-22r %s"
                  % (t, size, st.get("t"), (st.get("x") or "")[:72]))
            frame += 1
            await asyncio.sleep(max(0.0, every - 0.4))
        if clicked is None:
            print("  !! never clicked (widget never got a box within %.0fs)" % cap)

        # cf_clearance is HttpOnly, so document.cookie cannot see it. Cloudflare
        # also hands one out on FAILED paths, so its presence proves nothing --
        # the result codes (cf_chl_rc_*) and an actual re-fetch are the judges.
        r = await c.call("Network.getAllCookies", session=s)
        cookies = (r.get("result") or {}).get("cookies") or []
        print("--- cookies (%d) ---" % len(cookies))
        for ck in cookies:
            name = ck.get("name", "")
            if not (name.startswith("cf") or name.startswith("__cf")):
                continue
            print("  %-18s len=%-5s domain=%-16s httpOnly=%s secure=%s sameSite=%s val=%s"
                  % (name, len(str(ck.get("value", ""))), ck.get("domain"),
                     ck.get("httpOnly"), ck.get("secure"), ck.get("sameSite"),
                     str(ck.get("value", ""))[:48]))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--cap", type=float, default=35.0, help="hard cap in seconds")
    p.add_argument("--every", type=float, default=2.0)
    p.add_argument("--tag", default="film")
    p.add_argument("--offset", default="21,31")
    p.add_argument("--start", type=float, default=12.0,
                   help="delay before the first poll; polling earlier empties the doc")
    a = p.parse_args()
    ox, oy = (float(v) for v in a.offset.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url, a.cap, a.every, a.tag, (ox, oy), a.start))


if __name__ == "__main__":
    main()
