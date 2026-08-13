#!/usr/bin/env python3
"""Same message capture as cdp_message_diff.py, but for a real Chrome.

In Chrome the Turnstile widget is an OOPIF with its own target, so
Page.addScriptToEvaluateOnNewDocument on the page target never reaches it.
This uses Target.setAutoAttach(waitForDebuggerOnStart) to install the hook in
every child target before its scripts run, then reads each realm back.

  ./cdp_message_diff_chrome.py https://zencare.co/1.txt --port 9222
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
        "window.__msgs.push((Date.now()-window.__t0)+'ms '+tag+' <= '+(e.origin||'?')+' : '"
        "+s.slice(0,4000));}catch(x){}},true);})()")

SHADOW = ("(function(){window.__roots=[];var a=Element.prototype.attachShadow;"
          "Element.prototype.attachShadow=function(i){var r=a.apply(this,arguments);"
          "try{window.__roots.push(r);}catch(e){}return r;};})()")

BOX = ("(function(){var fr=[];(window.__roots||[]).forEach(function(r){try{"
       "var f=r.querySelectorAll('iframe');for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});"
       "var b=null;for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
       "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
       "return JSON.stringify({box:b});})()")

DUMP = "(function(){return JSON.stringify({url:location.href,msgs:window.__msgs||[]});})()"


def endpoint_for(port):
    o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(o.open("http://127.0.0.1:%d/json/version" % port,
                             timeout=5).read())["webSocketDebuggerUrl"]


async def run(endpoint, url, cap, start, click):
    loop = asyncio.get_event_loop()
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        n = [0]
        pending = {}
        sessions = []

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

        async def setup_target(sid, kind="page"):
            """Install the hook and only THEN resume: resuming first races the
            page's own scripts and the hook lands too late to see anything."""
            if kind in ("page", "iframe"):
                for src in (SHADOW, HOOK):
                    try:
                        await send("Page.addScriptToEvaluateOnNewDocument",
                                   {"source": src}, s=sid)
                    except Exception:
                        pass
            if kind in ("page", "iframe"):
                for meth, params in (("Page.enable", {}), ("Runtime.enable", {}),
                                     ("Target.setAutoAttach",
                                      {"autoAttach": True, "waitForDebuggerOnStart": True,
                                       "flatten": True})):
                    try:
                        await send(meth, params, s=sid)
                    except Exception:
                        pass
            # Fire-and-forget: a worker session may never answer, and waiting
            # on it would delay the resume that unblocks the page.
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
                if m.get("method") == "Target.attachedToTarget":
                    p = m["params"]
                    info = p.get("targetInfo", {})
                    sessions.append((p["sessionId"], info.get("type"),
                                     info.get("url", "")[:70]))
                    # Workers get no hook: Page.enable never answers on a
                    # worker session, and a dozen 20s timeouts starve the
                    # dump phase (which is how the last run came back empty).
                    # EVERY attached target must be resumed. waitForDebugger
                    # OnStart pauses workers too, and Turnstile runs its proof
                    # in a dozen blob workers -- leaving them paused hangs the
                    # widget on "Verifying..." forever and looks exactly like a
                    # Cloudflare timeout.
                    asyncio.ensure_future(setup_target(p["sessionId"], info.get("type")))

        task = asyncio.ensure_future(pump())
        try:
            r = await send("Target.createTarget", {"url": "about:blank"})
            r = await send("Target.attachToTarget",
                           {"targetId": r["result"]["targetId"], "flatten": True})
            s = r["result"]["sessionId"]
            sessions.append((s, "page", "about:blank"))
            await send("Page.enable", s=s)
            await send("Runtime.enable", s=s)
            await send("Target.setAutoAttach",
                       {"autoAttach": True, "waitForDebuggerOnStart": True,
                        "flatten": True}, s=s)
            await send("Page.addScriptToEvaluateOnNewDocument", {"source": SHADOW}, s=s)
            await send("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK}, s=s)
            t0 = loop.time()
            await send("Page.navigate", {"url": url}, s=s)
            await asyncio.sleep(start)

            if click:
                for _ in range(14):
                    r = await send("Runtime.evaluate",
                                   {"expression": BOX, "returnByValue": True}, s=s)
                    try:
                        b = json.loads(r["result"]["result"]["value"]).get("box")
                    except Exception:
                        b = None
                    if b:
                        x, y = b["x"] + 21, b["y"] + 31
                        for typ, extra in (("mouseMoved", {}), ("mouseMoved", {}),
                                           ("mousePressed", {"button": "left", "buttons": 1,
                                                             "clickCount": 1}),
                                           ("mouseReleased", {"button": "left", "buttons": 0,
                                                              "clickCount": 1})):
                            p = {"type": typ, "x": x, "y": y}
                            p.update(extra)
                            await send("Input.dispatchMouseEvent", p, s=s)
                            await asyncio.sleep(0.08)
                        print("  clicked at (%.0f,%.0f) t=%.1fs" % (x, y, loop.time() - t0))
                        break
                    await asyncio.sleep(1.0)

            while loop.time() - t0 < cap:
                await asyncio.sleep(1.0)

            print("--- sessions ---")
            for sid, typ, u in sessions:
                print("   %-8s %s" % (typ, u))
            for sid, typ, u in sessions:
                if typ not in ("page", "iframe"):
                    continue
                try:
                    r = await send("Runtime.evaluate",
                                   {"expression": DUMP, "returnByValue": True}, s=sid)
                    val = json.loads(r["result"]["result"]["value"])
                except Exception:
                    continue
                if not val.get("msgs"):
                    continue
                print("=== realm %s : %d msgs ===" % (val["url"][:70], len(val["msgs"])))
                for m in val["msgs"]:
                    print("   ", m[:4000])
        finally:
            task.cancel()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9222)
    p.add_argument("--cap", type=float, default=35.0)
    p.add_argument("--start", type=float, default=6.0)
    p.add_argument("--no-click", action="store_true")
    a = p.parse_args()
    asyncio.run(run(endpoint_for(a.port), a.url, a.cap, a.start, not a.no_click))


if __name__ == "__main__":
    main()
