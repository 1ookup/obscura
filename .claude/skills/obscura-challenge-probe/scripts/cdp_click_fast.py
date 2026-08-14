#!/usr/bin/env python3
"""Click Turnstile's checkbox the moment it renders, then watch for the proof POST.

Timing matters: the challenge page swaps to a fresh ray after ~30-130s, which
voids the current widget's token. A click that lands after the swap hits a dead
realm and looks exactly like "the click did nothing". So this polls fast and
fires as soon as the widget iframe has a box.

The success criterion is NOT the checkbox turning green -- it is a *new*
`POST challenges.cloudflare.com/.../fo/<tokenB>` within ~2s of the click, and
ultimately the target URL returning its own real response.

  ./cdp_click_fast.py https://zencare.co/1.txt --port 9223

Works against both `obscura serve` and a real Chrome (--port 9222).

--start: never run the first Runtime.evaluate before this many seconds after
navigation. A probe that evaluates at t~=1s permanently blanks obscura's
document (a known, unfixed obscura defect; Chrome is unaffected) -- the widget
then never appears and the run reports box=null with an empty title. 3s+ is
safe (verified: cdp_filmstrip has polled from t=3s since step 14 without
trouble); 5s is the default because interactiveBegin never fires before ~6s on
either engine.
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

PRELOAD = "(function(){window.__roots=[];var a=Element.prototype.attachShadow;Element.prototype.attachShadow=function(i){var r=a.apply(this,arguments);try{window.__roots.push(r);}catch(e){}return r;};window.__pm=[];window.__t0=Date.now();window.addEventListener('message',function(e){try{var d=e.data;window.__pm.push((Date.now()-window.__t0)+'|'+((typeof d==='object')?JSON.stringify(d):String(d)).slice(0,200));}catch(x){}});})()"

# NOTE: keep every expression on ONE line and avoid `JSON.stringify(IIFE)` with
# newlines -- obscura's Runtime.evaluate silently returns nothing for some
# multi-line forms, which reads as "the page has no widget" and sends the whole
# investigation down the wrong path. Single-line IIFEs evaluate fine on both.
PROBE = "(function(){var b=null;var it=false;var ev=[];var seen={};(window.__pm||[]).forEach(function(m){if(m.indexOf('food')>=0)return;var k=m.slice(0,60);if(!seen[k]){seen[k]=1;ev.push(m.slice(0,140));}if(m.indexOf('interactiveBegin')>=0)it=true;});var fr=[];(window.__roots||[]).forEach(function(r){try{var f=r.querySelectorAll('iframe');for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});try{var t=document.querySelectorAll('iframe');for(var j=0;j<t.length;j++)fr.push(t[j]);}catch(e){}for(var k2=0;k2<fr.length;k2++){var q=fr[k2].getBoundingClientRect();if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}return JSON.stringify({box:b,interactive:it,events:ev});})()"

STATE = "(function(){return JSON.stringify({url:location.href,title:document.title,text:document.body?document.body.innerText.slice(0,160):''});})()"


def endpoint_for(port):
    """Chrome's browser endpoint carries a UUID; obscura's is a fixed path."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, params=None, session=None):
        self.n += 1
        mid = self.n
        req = {"id": mid, "method": method, "params": params or {}}
        if session:
            req["sessionId"] = session
        await self.ws.send(json.dumps(req))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                return msg

    async def eval(self, expr, session):
        r = await self.call("Runtime.evaluate",
                            {"expression": expr, "returnByValue": True}, session=session)
        v = r.get("result", {}).get("result", {})
        if "value" not in v:
            return None
        try:
            return json.loads(v["value"])
        except (ValueError, TypeError):
            return None


async def run(endpoint, url, offset, deadline, settle, require_interactive, start):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        c = Cdp(ws)
        r = await c.call("Target.createTarget", {"url": "about:blank"})
        target = r["result"]["targetId"]
        r = await c.call("Target.attachToTarget", {"targetId": target, "flatten": True})
        session = r["result"]["sessionId"]
        await c.call("Page.enable", session=session)
        await c.call("Runtime.enable", session=session)
        await c.call("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD},
                     session=session)
        await c.call("Page.navigate", {"url": url}, session=session)

        # Do NOT poll during the first seconds: a Runtime.evaluate landing at
        # t~=1s permanently blanks obscura's document (see --start note).
        await asyncio.sleep(start)
        elapsed = start

        # Poll fast; fire as soon as the widget has a box (and, if asked, has
        # announced interactiveBegin).
        clicked_at = None
        probe = None
        while elapsed < deadline:
            await asyncio.sleep(0.3)
            elapsed += 0.3
            probe = await c.eval(PROBE, session) or {}
            box = probe.get("box")
            if box and (probe.get("interactive") or not require_interactive):
                ox, oy = offset
                x, y = box["x"] + ox, box["y"] + oy
                await c.call("Input.dispatchMouseEvent",
                             {"type": "mouseMoved", "x": x - 30, "y": y - 12},
                             session=session)
                await asyncio.sleep(0.1)
                await c.call("Input.dispatchMouseEvent",
                             {"type": "mouseMoved", "x": x, "y": y}, session=session)
                await asyncio.sleep(0.12)
                await c.call("Input.dispatchMouseEvent",
                             {"type": "mousePressed", "x": x, "y": y, "button": "left",
                              "buttons": 1, "clickCount": 1}, session=session)
                await asyncio.sleep(0.06)
                await c.call("Input.dispatchMouseEvent",
                             {"type": "mouseReleased", "x": x, "y": y, "button": "left",
                              "buttons": 0, "clickCount": 1}, session=session)
                clicked_at = elapsed
                print("clicked at t=%.1fs page=(%.1f,%.1f) box=%s"
                      % (elapsed, x, y, json.dumps(box)))
                break
            if elapsed % 3 < 0.3:
                print("  t=%.1fs box=%s interactive=%s"
                      % (elapsed, json.dumps(box), probe.get("interactive")))

        if clicked_at is None:
            print("NEVER CLICKED (no widget box within %.0fs)" % deadline)

        # Watch what the click produced.
        for i in range(int(settle)):
            await asyncio.sleep(1.0)
            st = await c.eval(STATE, session) or {}
            print("  +%ds title=%r text=%r" % (i + 1, st.get("title"),
                                               (st.get("text") or "")[:70]))

        probe = await c.eval(PROBE, session) or {}
        print("--- postMessage events (deduped, food filtered) ---")
        for e in probe.get("events", []):
            print("  ", e)
        return probe


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--offset", default="21,31",
                   help="checkbox center relative to the widget iframe's top-left")
    p.add_argument("--deadline", type=float, default=30.0)
    p.add_argument("--settle", type=float, default=15.0)
    p.add_argument("--any-widget", action="store_true",
                   help="click as soon as the box exists, without waiting for interactiveBegin")
    p.add_argument("--start", type=float, default=5.0,
                   help="seconds to wait after navigation before the first "
                        "Runtime.evaluate (early evaluation blanks obscura's "
                        "document; Chrome is unaffected)")
    a = p.parse_args()
    ox, oy = (float(v) for v in a.offset.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url,
                    (ox, oy), a.deadline, a.settle, not a.any_widget, a.start))


if __name__ == "__main__":
    main()
