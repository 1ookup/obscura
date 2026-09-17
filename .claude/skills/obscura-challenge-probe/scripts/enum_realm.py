#!/usr/bin/env python3
"""Capture each frame realm's window/document/navigator/screen enumeration.

The widget (challenges.cloudflare.com) iframe is a separate frame realm that
obscura's Runtime.evaluate on the top session cannot reach; records go out
through console.warn, which obscura funnels from every realm into serve.log.
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
  if (globalThis.__enumHooked) return;
  globalThis.__enumHooked = 1;
  function names(o) { try { return Object.getOwnPropertyNames(o); } catch (e) { return []; } }
  function snapshot() {
    var out = {
      href: String(location.href),
      win: names(globalThis),
      doc: names(document),
      nav: names(navigator),
      screen: names(screen),
      ctor: (function(){ try { return String(globalThis.constructor && globalThis.constructor.name); } catch(e){ return 'err'; } })(),
      hasWindow: (function(){ try { return String(typeof globalThis.Window); } catch(e){ return 'err'; } })()
    };
    try { console.warn('[ENUM] ' + JSON.stringify(out)); } catch (e) {}
  }
  snapshot();
  // snapshot again once the frame document settles
  setTimeout(snapshot, 9000);
})();
"""


def endpoint_for(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


async def run(endpoint, url, wait):
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
                m = json.loads(await ws.recv())
                if m.get("id") == mid:
                    return m

        r = await call("Target.createTarget", {"url": "about:blank"})
        r = await call("Target.attachToTarget", {"targetId": r["result"]["targetId"], "flatten": True})
        s = r["result"]["sessionId"]
        await call("Page.enable", session=s)
        await call("Runtime.enable", session=s)
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD}, session=s)
        await call("Page.navigate", {"url": url}, session=s)
        await asyncio.sleep(wait)
        print("captured (see serve.log [ENUM] lines)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--wait", type=float, default=14.0)
    a = p.parse_args()
    asyncio.run(run(endpoint_for(a.port), a.url, a.wait))


if __name__ == "__main__":
    main()
