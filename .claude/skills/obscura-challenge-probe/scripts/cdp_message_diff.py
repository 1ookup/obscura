#!/usr/bin/env python3
"""Record the parent<->widget postMessage traffic on both sides, for diffing.

Deliberately passive: it only ADDS a 'message' listener in each realm. Wrapping
postMessage or the contentWindow getter changes what Turnstile does (a previous
round lost translationInit and the heartbeat entirely that way), so nothing is
wrapped here.

Both directions come out of the two realms' inbound logs:
  TOP    <= ...   is widget -> parent
  WIDGET <= ...   is parent -> widget

Preloads run in every frame realm before author script (page.rs:2379), so one
registration covers both sides. Output goes to console (obscura: serve log;
Chrome: read window.__msgs per frame) and is echoed here for the top realm.

  ./cdp_message_diff.py https://zencare.co/1.txt --port 9223 --tag obscura
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

HOOK = ("(function(){if(globalThis.__msgHooked)return;globalThis.__msgHooked=1;"
        "var tag=String(location.href).indexOf('challenges.cloudflare.com')>=0?'WIDGET':'TOP';"
        "window.__msgs=[];window.__t0=Date.now();"
        "window.addEventListener('message',function(e){try{"
        "var d=e.data;var s=(typeof d==='object'&&d!==null)?JSON.stringify(d):String(d);"
        "var rec=(Date.now()-window.__t0)+'ms '+tag+' <= '+(e.origin||'?')+' : '+s.slice(0,4000);"
        "window.__msgs.push(rec);console.warn('[msg] '+rec);}catch(x){}},true);})()")

BOX = ("(function(){var fr=[];(window.__roots||[]).forEach(function(r){try{"
       "var f=r.querySelectorAll('iframe');for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});"
       "var b=null;for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
       "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
       "return JSON.stringify({box:b});})()")

SHADOW = ("(function(){window.__roots=[];var a=Element.prototype.attachShadow;"
          "Element.prototype.attachShadow=function(i){var r=a.apply(this,arguments);"
          "try{window.__roots.push(r);}catch(e){}return r;};})()")

DUMP = "(function(){return JSON.stringify(window.__msgs||[]);})()"


def endpoint_for(port):
    o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(o.open("http://127.0.0.1:%d/json/version" % port,
                             timeout=5).read())["webSocketDebuggerUrl"]


async def run(endpoint, url, cap, start, tag, click):
    loop = asyncio.get_event_loop()
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        n = [0]

        async def call(m, p=None, s=None):
            n[0] += 1
            mid = n[0]
            req = {"id": mid, "method": m, "params": p or {}}
            if s:
                req["sessionId"] = s
            await ws.send(json.dumps(req))
            while True:
                r = json.loads(await ws.recv())
                if r.get("id") == mid:
                    return r

        async def ev(e, s):
            r = await call("Runtime.evaluate",
                           {"expression": e, "returnByValue": True}, s=s)
            v = r.get("result", {}).get("result", {})
            try:
                return json.loads(v.get("value", "null"))
            except (ValueError, TypeError):
                return None

        r = await call("Target.createTarget", {"url": "about:blank"})
        r = await call("Target.attachToTarget",
                       {"targetId": r["result"]["targetId"], "flatten": True})
        s = r["result"]["sessionId"]
        await call("Page.enable", s=s)
        await call("Runtime.enable", s=s)
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": SHADOW}, s=s)
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK}, s=s)
        t0 = loop.time()
        await call("Page.navigate", {"url": url}, s=s)

        # Early Runtime.evaluate empties the document -- never poll before this.
        await asyncio.sleep(start)

        if click:
            for _ in range(12):
                b = (await ev(BOX, s) or {}).get("box")
                if b:
                    x, y = b["x"] + 21, b["y"] + 31
                    for typ, extra in (("mouseMoved", {}), ("mouseMoved", {}),
                                       ("mousePressed", {"button": "left", "buttons": 1,
                                                         "clickCount": 1}),
                                       ("mouseReleased", {"button": "left", "buttons": 0,
                                                          "clickCount": 1})):
                        p = {"type": typ, "x": x, "y": y}
                        p.update(extra)
                        await call("Input.dispatchMouseEvent", p, s=s)
                        await asyncio.sleep(0.08)
                    print("  clicked at (%.0f,%.0f) t=%.1fs" % (x, y, loop.time() - t0))
                    break
                await asyncio.sleep(1.2)

        while loop.time() - t0 < cap:
            await asyncio.sleep(1.0)

        msgs = await ev(DUMP, s) or []
        print("=== [%s] TOP realm inbound (widget -> parent): %d ===" % (tag, len(msgs)))
        for m in msgs:
            print("   ", m[:4000])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--cap", type=float, default=35.0)
    p.add_argument("--start", type=float, default=12.0)
    p.add_argument("--tag", default="obscura")
    p.add_argument("--no-click", action="store_true")
    a = p.parse_args()
    asyncio.run(run(endpoint_for(a.port), a.url, a.cap, a.start, a.tag, not a.no_click))


if __name__ == "__main__":
    main()
