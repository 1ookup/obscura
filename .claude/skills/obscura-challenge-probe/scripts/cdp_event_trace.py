#!/usr/bin/env python3
"""Trace the exact mouse events a CDP click produces inside the widget realm.

Chrome passes the challenge with the very same CDP command sequence obscura
fails with, so the sequence is not the problem -- what those commands turn into
is. This records every mouse/pointer event the widget's document sees, with the
properties Turnstile can inspect (isTrusted, detail, buttons, coordinates,
timeStamp), on both engines for diffing.

Events are streamed through console so the record survives the navigation that
follows a successful pass.

  ./cdp_event_trace.py https://zencare.co/1.txt --port 9223          # obscura
  ./cdp_event_trace.py https://zencare.co/1.txt --port 9222 --oopif  # Chrome
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

TRACE = (
    "(function(){if(globalThis.__evtHooked)return;globalThis.__evtHooked=1;"
    "var tag=String(location.href).indexOf('challenges.cloudflare.com')>=0?'WIDGET':'TOP';"
    "var T=['pointerover','pointerenter','pointermove','mouseover','mouseenter',"
    "'mousemove','pointerdown','mousedown','pointerup','mouseup','click','dblclick',"
    "'change','input','focus','blur'];"
    "T.forEach(function(t){document.addEventListener(t,function(e){try{"
    "console.warn('[evt] '+tag+' '+t"
    "+' tgt='+((e.target&&e.target.tagName)||'?')"
    "+((e.target&&e.target.className)?('.'+String(e.target.className).slice(0,12)):'')"
    "+' trusted='+e.isTrusted"
    "+' btn='+e.button+' btns='+e.buttons+' det='+e.detail"
    "+' xy='+Math.round(e.clientX||0)+','+Math.round(e.clientY||0)"
    "+' scr='+Math.round(e.screenX||0)+','+Math.round(e.screenY||0)"
    "+' ptr='+(e.pointerId===undefined?'-':e.pointerId)+'/'+(e.pointerType||'-')"
    "+' prim='+(e.isPrimary===undefined?'-':e.isPrimary)"
    "+' press='+(e.pressure===undefined?'-':e.pressure)"
    "+' ts='+Math.round(e.timeStamp)"
    "+' comp='+e.composed+' bub='+e.bubbles+' canc='+e.cancelable"
    ");}catch(x){}},true);});})()")

SHADOW = ("(function(){window.__roots=[];var a=Element.prototype.attachShadow;"
          "Element.prototype.attachShadow=function(i){var r=a.apply(this,arguments);"
          "try{window.__roots.push(r);}catch(e){}return r;};})()")

STATUS = ("(function(){var fr=[];(window.__roots||[]).forEach(function(r){try{"
          "var f=r.querySelectorAll('iframe');for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});"
          "var b=null;for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
          "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
          "return JSON.stringify({box:b});})()")


def endpoint_for(port):
    o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(o.open("http://127.0.0.1:%d/json/version" % port,
                             timeout=5).read())["webSocketDebuggerUrl"]


async def run(endpoint, url, start, settle, offset, oopif):
    loop = asyncio.get_event_loop()
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        n = [0]
        pending = {}
        live = []

        async def send(m, p=None, s=None):
            n[0] += 1
            mid = n[0]
            req = {"id": mid, "method": m, "params": p or {}}
            if s:
                req["sessionId"] = s
            await ws.send(json.dumps(req))
            fut = loop.create_future()
            pending[mid] = fut
            return await asyncio.wait_for(fut, timeout=20)

        async def setup(sid, kind):
            if kind in ("page", "iframe"):
                for src in (SHADOW, TRACE):
                    try:
                        await send("Page.addScriptToEvaluateOnNewDocument",
                                   {"source": src}, s=sid)
                    except Exception:
                        pass
                for meth, params in (("Page.enable", {}), ("Runtime.enable", {}),
                                     ("Target.setAutoAttach",
                                      {"autoAttach": True, "waitForDebuggerOnStart": True,
                                       "flatten": True})):
                    try:
                        await send(meth, params, s=sid)
                    except Exception:
                        pass
            # Every target must be resumed, workers included.
            n[0] += 1
            await ws.send(json.dumps({"id": n[0],
                                      "method": "Runtime.runIfWaitingForDebugger",
                                      "sessionId": sid}))

        async def pump():
            while True:
                m = json.loads(await ws.recv())
                if "id" in m and m["id"] in pending:
                    fut = pending.pop(m["id"])
                    if not fut.done():
                        fut.set_result(m)
                    continue
                if m.get("method") == "Runtime.consoleAPICalled":
                    for arg in m["params"].get("args", []):
                        v = arg.get("value")
                        if isinstance(v, str) and v.startswith("[evt] "):
                            live.append(v[6:])
                    continue
                if m.get("method") == "Target.attachedToTarget":
                    p = m["params"]
                    info = p.get("targetInfo", {})
                    asyncio.ensure_future(setup(p["sessionId"], info.get("type")))

        task = asyncio.ensure_future(pump())
        try:
            r = await send("Target.createTarget", {"url": "about:blank"})
            r = await send("Target.attachToTarget",
                           {"targetId": r["result"]["targetId"], "flatten": True})
            s = r["result"]["sessionId"]
            await send("Page.enable", s=s)
            await send("Runtime.enable", s=s)
            if oopif:
                await send("Target.setAutoAttach",
                           {"autoAttach": True, "waitForDebuggerOnStart": True,
                            "flatten": True}, s=s)
            await send("Page.addScriptToEvaluateOnNewDocument", {"source": SHADOW}, s=s)
            await send("Page.addScriptToEvaluateOnNewDocument", {"source": TRACE}, s=s)
            t0 = loop.time()
            await send("Page.navigate", {"url": url}, s=s)
            await asyncio.sleep(start)

            box = None
            for _ in range(14):
                r = await send("Runtime.evaluate",
                               {"expression": STATUS, "returnByValue": True}, s=s)
                try:
                    box = json.loads(r["result"]["result"]["value"]).get("box")
                except Exception:
                    box = None
                if box:
                    break
                await asyncio.sleep(1.0)
            if not box:
                print("!! no widget box")
                return

            mark = len(live)
            x, y = box["x"] + offset[0], box["y"] + offset[1]
            for typ, extra in (("mouseMoved", {}), ("mouseMoved", {}),
                               ("mousePressed", {"button": "left", "buttons": 1,
                                                 "clickCount": 1}),
                               ("mouseReleased", {"button": "left", "buttons": 0,
                                                  "clickCount": 1})):
                p = {"type": typ, "x": x, "y": y}
                p.update(extra)
                await send("Input.dispatchMouseEvent", p, s=s)
                await asyncio.sleep(0.08)
            print(">>> clicked (%.0f,%.0f) at t=%.1fs" % (x, y, loop.time() - t0))

            await asyncio.sleep(settle)
            print("--- events produced by the click (%d) ---" % (len(live) - mark))
            for e in live[mark:]:
                print("   ", e)
        finally:
            task.cancel()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--start", type=float, default=12.0)
    p.add_argument("--settle", type=float, default=4.0)
    p.add_argument("--offset", default="21,31")
    p.add_argument("--oopif", action="store_true",
                   help="Chrome: attach to the widget's out-of-process frame")
    a = p.parse_args()
    ox, oy = (float(v) for v in a.offset.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url, a.start, a.settle, (ox, oy), a.oopif))


if __name__ == "__main__":
    main()
