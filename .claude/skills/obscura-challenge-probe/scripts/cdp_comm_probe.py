#!/usr/bin/env python3
"""Capture the full cross-realm conversation: messages, requests, and who fired them.

Answers "which message triggered that request", which needs three things at once
and fails silently if any is missing:

  1. Records go out through console.warn, not a per-realm array read back with
     Runtime.evaluate. `window.__ev` only ever holds the realm you dumped, so a
     widget-side event is invisible; obscura funnels every realm's console into
     the serve log, so one grep sees them all.
  2. XHR *and* fetch *and* sendBeacon are hooked. Hooking only XMLHttpRequest
     misses whatever the page sends through fetch, and the two do not overlap.
  3. Each request records a short JS stack, which is what turns "these two
     things happened in this order" into "this handler called that request".

Not covered here, by design: requests issued straight from `op_fetch_url`
(`has_tx=false` in the debug log) never touch these JS entry points. `/pat/` is
one of them. Use RUST_LOG=obscura_js=debug to decide whether a request was sent
at all; use this probe to decide which page code constructed it.

Nothing is wrapped that the challenge reads back: postMessage and contentWindow
are left alone (wrapping them has silently killed the handshake before), and
console.warn is handed a string so it cannot trip getter-based devtools probes.

  ./cdp_comm_probe.py https://target/path --port 9223 --start 5 --settle 15
  grep -o '\\[comm\\].*' /tmp/serve.log        # all realms, one timeline
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

PRELOAD = r"""(function(){try{
var tag=String(location.href).indexOf('challenges.cloudflare.com')>=0?'WIDGET':'TOP';
var t0=Date.now();
var rec=function(kind,detail){try{console.warn('[comm] '+(Date.now()-t0)+'|'+tag+'|'+kind+'|'+detail);}catch(e){}};
window.__roots=[];var _as=Element.prototype.attachShadow;
Element.prototype.attachShadow=function(i){var r=_as.apply(this,arguments);try{window.__roots.push(r);}catch(e){}return r;};
window.__ev=[];
window.addEventListener('message',function(e){try{var d=e.data;
 var s=(typeof d==='object'&&d!==null)?JSON.stringify(d):String(d);
 window.__ev.push(s);
 if(s.indexOf('"food"')<0&&s.indexOf('"meow"')<0) rec('IN','from='+(e.origin||'?')+' '+s.slice(0,500));
}catch(x){}},true);
var stk=function(){var st='';try{st=(new Error()).stack||'';}catch(e){}
 return String(st).split('\n').slice(2,7).map(function(l){return l.trim();}).join(' <- ').slice(0,380);};
var _o=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){rec('XHR',String(m)+' '+String(u).slice(-55)+' :: '+stk());return _o.apply(this,arguments);};
var _f=window.fetch;
if(typeof _f==='function'){window.fetch=function(u){rec('FETCH',String((u&&u.url)||u).slice(-55)+' :: '+stk());return _f.apply(this,arguments);};}
var _b=navigator.sendBeacon;
if(typeof _b==='function'){navigator.sendBeacon=function(u){rec('BEACON',String(u).slice(-55)+' :: '+stk());return _b.apply(this,arguments);};}
try{var _img=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(_img&&_img.set){Object.defineProperty(HTMLImageElement.prototype,'src',{
  set:function(v){rec('IMG',String(v).slice(-55));_img.set.call(this,v);},get:_img.get});}}catch(e){}
rec('READY','');
}catch(e){try{console.warn('[comm] init-error '+e);}catch(x){}}})();"""

BOX = ("(function(){var b=null,it=false;(window.__ev||[]).forEach(function(m){"
       "if(m.indexOf('interactiveBegin')>=0)it=true;});var fr=[];"
       "(window.__roots||[]).forEach(function(r){try{var f=r.querySelectorAll('iframe');"
       "for(var i=0;i<f.length;i++)fr.push(f[i]);}catch(e){}});"
       "try{var t=document.querySelectorAll('iframe');for(var j=0;j<t.length;j++)fr.push(t[j]);}catch(e){}"
       "for(var k=0;k<fr.length;k++){var q=fr[k].getBoundingClientRect();"
       "if(q.width>100&&q.height>20){b={x:q.left,y:q.top,w:q.width,h:q.height};break;}}"
       "return JSON.stringify({box:b,interactive:it});})()")


def endpoint_for(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


async def run(endpoint, url, start, deadline, settle, click):
    loop = asyncio.get_event_loop()
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
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

        async def ev(expr, session):
            r = await call("Runtime.evaluate",
                           {"expression": expr, "returnByValue": True}, session=session)
            try:
                return json.loads(r.get("result", {}).get("result", {}).get("value", "null"))
            except (ValueError, TypeError):
                return None

        r = await call("Target.createTarget", {"url": "about:blank"})
        r = await call("Target.attachToTarget",
                       {"targetId": r["result"]["targetId"], "flatten": True})
        session = r["result"]["sessionId"]
        await call("Page.enable", session=session)
        await call("Runtime.enable", session=session)
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD},
                   session=session)
        t0 = loop.time()
        await call("Page.navigate", {"url": url}, session=session)

        # Never evaluate before this: an early Runtime.evaluate empties the document.
        await asyncio.sleep(start)
        if not click:
            await asyncio.sleep(max(0.0, deadline - (loop.time() - t0)))
            print("no-click run finished", flush=True)
            return
        clicked = False
        while loop.time() - t0 < deadline:
            state = await ev(BOX, session) or {}
            if state.get("box") and state.get("interactive") and not clicked:
                b = state["box"]
                x, y = b["x"] + 21, b["y"] + 31
                for typ, extra in (("mouseMoved", {}), ("mouseMoved", {}),
                                   ("mousePressed", {"button": "left", "buttons": 1,
                                                     "clickCount": 1}),
                                   ("mouseReleased", {"button": "left", "buttons": 0,
                                                      "clickCount": 1})):
                    p = {"type": typ, "x": x, "y": y}
                    p.update(extra)
                    await call("Input.dispatchMouseEvent", p, session=session)
                    await asyncio.sleep(0.08)
                print("clicked t=%.1fs at (%.0f,%.0f)" % (loop.time() - t0, x, y), flush=True)
                clicked = True
                await asyncio.sleep(settle)
                break
            await asyncio.sleep(0.7)
        if not clicked:
            print("NOT CLICKED (no widget box, or interactiveBegin never arrived)", flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--start", type=float, default=5.0,
                   help="delay before the first evaluate (early evaluate empties the document)")
    p.add_argument("--deadline", type=float, default=40.0)
    p.add_argument("--settle", type=float, default=15.0,
                   help="how long to keep recording after the click")
    p.add_argument("--no-click", action="store_true",
                   help="observe only; cannot be used to judge the post-click submit chain")
    a = p.parse_args()
    asyncio.run(run(endpoint_for(a.port), a.url, a.start, a.deadline, a.settle,
                    not a.no_click))


if __name__ == "__main__":
    main()
