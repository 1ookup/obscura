#!/usr/bin/env python3
"""Capture the postMessage traffic of a SUCCESSFUL click-through, in Chrome.

The point is the messages *after* the click on a run that actually passes --
that is the reference obscura's failing run has to be diffed against.

Two things this gets right that the earlier capture did not:
  - it waits for `interactiveBegin` before clicking. Clicking earlier means the
    run was a managed-branch run that never wanted a click, and it ends in
    `overrunBegin` -- a failure sample dressed up as a success.
  - it reports the final page state, so "passed" is judged by the site's real
    response, not by the widget looking happy.

Needs a FRESH --user-data-dir Chrome: a profile that already passed twice gets
waved through and never shows a widget again.

  ./cdp_capture_success.py https://zencare.co/1.txt --port 9222
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

SHADOW = ("(function(){window.__roots=[];var a=Element.prototype.attachShadow;"
          "Element.prototype.attachShadow=function(i){var r=a.apply(this,arguments);"
          "try{window.__roots.push(r);}catch(e){}return r;};})()")

# box + whether interactiveBegin has arrived, in one round trip
STATUS = ("(function(){var fr=[];(window.__roots||[]).forEach(function(r){try{"
          "var f=r.querySelectorAll('iframe');for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});"
          "var b=null;for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
          "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
          "var it=false,ov=false;(window.__msgs||[]).forEach(function(m){"
          "if(m.indexOf('interactiveBegin')>=0)it=true;"
          "if(m.indexOf('overrunBegin')>=0)ov=true;});"
          "return JSON.stringify({box:b,interactive:it,overrun:ov,n:(window.__msgs||[]).length});})()")

STATE = ("(function(){return JSON.stringify({title:document.title,"
         "text:document.body?document.body.innerText.replace(/\\s+/g,' ').slice(0,100):''});})()")

DUMP = "(function(){return JSON.stringify({url:location.href,msgs:window.__msgs||[]});})()"


def endpoint_for(port):
    o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(o.open("http://127.0.0.1:%d/json/version" % port,
                             timeout=5).read())["webSocketDebuggerUrl"]


async def run(endpoint, url, wait_interactive, settle, offset):
    loop = asyncio.get_event_loop()
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        n = [0]
        pending = {}
        sessions = []
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

        async def setup(sid, kind="page"):
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
                if m.get("method") == "Runtime.consoleAPICalled":
                    for arg in m["params"].get("args", []):
                        v = arg.get("value")
                        if isinstance(v, str) and v.startswith("[msg] "):
                            live.append(v[6:])
                    continue
                if m.get("method") == "Target.attachedToTarget":
                    p = m["params"]
                    info = p.get("targetInfo", {})
                    sessions.append((p["sessionId"], info.get("type"), info.get("url", "")[:70]))
                    # EVERY attached target must be resumed. waitForDebugger
                    # OnStart pauses workers too, and Turnstile runs its proof
                    # in a dozen blob workers -- leaving them paused hangs the
                    # widget on "Verifying..." forever and looks exactly like a
                    # Cloudflare timeout.
                    asyncio.ensure_future(setup(p["sessionId"], info.get("type")))

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
                       {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True}, s=s)
            await send("Page.addScriptToEvaluateOnNewDocument", {"source": SHADOW}, s=s)
            await send("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK}, s=s)
            t0 = loop.time()
            await send("Page.navigate", {"url": url}, s=s)

            async def status():
                r = await send("Runtime.evaluate",
                               {"expression": STATUS, "returnByValue": True}, s=s)
                try:
                    return json.loads(r["result"]["result"]["value"])
                except Exception:
                    return {}

            # Wait for interactiveBegin -- clicking before it means this run was
            # never an interactive one.
            clicked_at = None
            while loop.time() - t0 < wait_interactive:
                await asyncio.sleep(1.0)
                st = await status()
                if st.get("interactive") and st.get("box"):
                    b = st["box"]
                    x, y = b["x"] + offset[0], b["y"] + offset[1]
                    for typ, extra in (("mouseMoved", {}), ("mouseMoved", {}),
                                       ("mousePressed", {"button": "left", "buttons": 1,
                                                         "clickCount": 1}),
                                       ("mouseReleased", {"button": "left", "buttons": 0,
                                                          "clickCount": 1})):
                        p = {"type": typ, "x": x, "y": y}
                        p.update(extra)
                        await send("Input.dispatchMouseEvent", p, s=s)
                        await asyncio.sleep(0.08)
                    clicked_at = loop.time() - t0
                    print(">>> interactiveBegin seen; CLICKED at t=%.1fs (%.0f,%.0f)"
                          % (clicked_at, x, y))
                    break
                if st.get("overrun"):
                    print("!! overrunBegin at t=%.1fs -- managed run, not interactive"
                          % (loop.time() - t0))
                    break
            if clicked_at is None:
                print("!! never clicked (no interactiveBegin within %.0fs)" % wait_interactive)

            async def dump_realms(tag):
                print("--- realms (%s) ---" % tag)

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
                    print("=== %s : %d msgs ===" % (val["url"][:70], len(val["msgs"])))
                    for m in val["msgs"]:
                        if '"food"' in m or '"meow"' in m:
                            continue
                        print("   ", m[:1500])

            # Passing navigates away and the fresh document resets __msgs, so
            # the post-click window has to be read before that happens.
            if clicked_at is not None:
                await asyncio.sleep(3.0)
                await dump_realms("3s after click, before navigation")

            end = loop.time() + settle
            while loop.time() < end:
                await asyncio.sleep(2.0)
                r = await send("Runtime.evaluate",
                               {"expression": STATE, "returnByValue": True}, s=s)
                try:
                    st = json.loads(r["result"]["result"]["value"])
                except Exception:
                    st = {}
                print("   t=%5.1fs %-24r %s"
                      % (loop.time() - t0, st.get("title"), (st.get("text") or "")[:60]))

            print("--- realms ---")
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
                print("=== %s : %d msgs ===" % (val["url"][:70], len(val["msgs"])))
                for m in val["msgs"]:
                    if '"food"' in m or '"meow"' in m:
                        continue
                    print("   ", m[:1500])
                if clicked_at is not None:
                    tail = [m for m in val["msgs"]
                            if ('"food"' in m or '"meow"' in m)][-2:]
                    for m in tail:
                        print("    (last heartbeat)", m[:120])
            print("--- live console stream: %d messages ---" % len(live))
            for m in live:
                if '"food"' in m or '"meow"' in m:
                    continue
                print("   ", m[:1600])
            hb = [m for m in live if '"food"' in m or '"meow"' in m]
            if hb:
                print("   (heartbeats: %d, last: %s)" % (len(hb), hb[-1][:90]))
        finally:
            task.cancel()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9222)
    p.add_argument("--wait-interactive", type=float, default=26.0)
    p.add_argument("--settle", type=float, default=20.0)
    p.add_argument("--offset", default="21,31")
    a = p.parse_args()
    ox, oy = (float(v) for v in a.offset.split(","))
    asyncio.run(run(endpoint_for(a.port), a.url, a.wait_interactive, a.settle, (ox, oy)))


if __name__ == "__main__":
    main()
