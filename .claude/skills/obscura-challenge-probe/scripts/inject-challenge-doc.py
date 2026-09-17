#!/usr/bin/env python3
"""Run the challenge with the recovered instrumented Turnstile challenge
document served locally, so a run yields a tracelog fragment without the probe
touching the page.

The proxy that used to rewrite the challenge JS no longer applies its patch (its
current flow history has zero instrumented bodies), and Cloudflare rolled the
challenge build since the instrumented capture: today the widget document is a
~87 KB `rch/ctseg` variant, where the captured instrumented one is the older
~443 KB `rch/<sid>/<sitekey>/light/fbE/new/` build. The instrumentation is woven
into the VM (117 call sites across the whole file), so it cannot be re-applied
to the new build; the only way to run instrumented code is to serve the captured
document in the position it came from, the widget's own document request.

Everything else goes to the network untouched through the proxy, so the traffic
probe stays out of the page.

  ./inject-challenge-doc.py https://www.thelancet.com/1.txt --doc /tmp/api-patched.js
"""
import argparse
import asyncio
import importlib.util
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

spec = importlib.util.spec_from_file_location(
    "cc", ".claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py")
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)

DOC_RESOURCE_TYPES = {"document", "subframe", "iframe", "other"}
MAX_LOGGED = 40


class Client:
    """CDP client that both answers calls and dispatches events."""

    def __init__(self, ws):
        self.ws = ws
        self.next_id = 0
        self.pending = {}
        self.events = asyncio.Queue()
        self.contexts = {}
        self.reader = None

    async def start(self):
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        try:
            while True:
                message = json.loads(await self.ws.recv())
                if "id" in message:
                    future = self.pending.pop(message["id"], None)
                    if future and not future.done():
                        future.set_result(message)
                else:
                    await self.events.put(message)
        except Exception:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(RuntimeError("ws closed"))
            self.pending.clear()

    async def call(self, method, params=None, session=None, timeout=30.0):
        self.next_id += 1
        message_id = self.next_id
        request = {"id": message_id, "method": method, "params": params or {}}
        if session:
            request["sessionId"] = session
        future = asyncio.get_running_loop().create_future()
        self.pending[message_id] = future
        await self.ws.send(json.dumps(request))
        return await asyncio.wait_for(future, timeout=timeout)

    async def wait_event(self, method, timeout=30.0):
        while True:
            event = await asyncio.wait_for(self.events.get(), timeout=timeout)
            if event.get("method") == method:
                return event


def is_widget_document(event):
    """True for the widget document request, false for everything else.

    The captured build names itself inside _cf_chl_opt, so the request must look
    like a document load of an rch URL rather than a script fetch of it.
    """
    params = event["params"]
    url = params.get("request", {}).get("url", "")
    kind = (params.get("resourceType") or "").lower()
    return "/rch/" in url and kind in DOC_RESOURCE_TYPES


async def run(endpoint, url, doc_path, match, offset, click_after, deadline, settle,
              as_document=False):
    body = open(doc_path, "rb").read()
    print(f"serving {len(body)} bytes of instrumented challenge document for {match!r}")
    async with websockets.connect(endpoint, max_size=256 * 1024 * 1024) as ws:
        client = Client(ws)
        await client.start()
        target = (await client.call("Target.createTarget", {"url": "about:blank"}))["result"]["targetId"]
        session = (await client.call("Target.attachToTarget",
                                     {"targetId": target, "flatten": True}))["result"]["sessionId"]
        for domain in ("Page", "Runtime", "DOM", "Fetch"):
            await client.call(domain + ".enable", session=session)
        patterns = [{"urlPattern": match, "requestStage": "Request"}]
        if as_document:
            patterns.append({"urlPattern": url, "requestStage": "Request"})
        await client.call("Fetch.enable", {"patterns": patterns}, session=session)

        served = 0
        logged = 0
        seen_docs = []

        async def answer_requests(stop):
            nonlocal served, logged
            while not stop.is_set():
                try:
                    event = await client.wait_event("Fetch.requestPaused", timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                params = event["params"]
                request_id = params["requestId"]
                request_url = params.get("request", {}).get("url", "")
                kind = params.get("resourceType") or ""
                if logged < MAX_LOGGED:
                    logged += 1
                    print(f"  {kind:9} {request_url[:104]}")
                if is_widget_document(event) or (as_document and request_url == url):
                    await client.call("Fetch.fulfillRequest", {
                        "requestId": request_id,
                        "responseCode": 200,
                        "responseHeaders": [
                            {"name": "Content-Type", "value": "text/html; charset=utf-8"},
                            {"name": "Cache-Control", "value": "no-store"},
                        ],
                        # Obscura's Fetch domain passes `body` through as the
                        # response body, where the CDP spec has it base64.
                        "body": body.decode("utf-8"),
                    }, session=session)
                    served += 1
                    seen_docs.append(request_url)
                    print(f"  -> served instrumented document ({len(body)} bytes)")
                else:
                    await client.call("Fetch.continueRequest", {"requestId": request_id}, session=session)

        stop = asyncio.Event()
        pump = asyncio.create_task(answer_requests(stop))
        navigator = asyncio.create_task(
            client.call("Page.navigate", {"url": url}, session=session, timeout=90))
        await navigator
        print(f"  navigation done, instrumented documents served: {served}")

        clicked = False
        waited = 0.0
        while waited < deadline:
            await asyncio.sleep(2.0)
            waited += 2.0
            if waited < click_after:
                continue
            box = await cc.widget_box(client, session)
            if box and not clicked:
                x, y = box[0] + offset[0], box[1] + offset[1]
                print(f"  t={waited:5.1f}s widget box={box} -> click at ({x:.0f},{y:.0f})")
                await cc.click(client, session, x, y)
                clicked = True
                break
        await asyncio.sleep(settle)
        stop.set()
        pump.cancel()
        print("--- final ---")
        print("  url:   ", await evaluate(client, session, "location.href"))
        print("  title: ", await evaluate(client, session, "document.title"))
        print("  body:  ", (await evaluate(client, session,
                                          "(document.body && document.body.innerText || '').slice(0,160)") or "").replace("\n", " "))
        print("  instrumented documents served:", served)
        print("  clicked:", clicked)
        print("  doc size:", await evaluate(client, session, "document.documentElement.outerHTML.length"))
        print("  __ov2tl:", await evaluate(client, session, "typeof window.__ov2tl"))
        print("  external.tracelog:", await evaluate(client, session, "typeof external.tracelog"))
        print("  cf ray:", await evaluate(client, session,
                                        "window._cf_chl_opt && window._cf_chl_opt.JWTz7"))
        return 0


async def evaluate(c, session, expression):
    response = await c.call("Runtime.evaluate",
                            {"expression": expression, "returnByValue": True}, session=session)
    return (response.get("result", {}).get("result") or {}).get("value")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--doc", default="/tmp/api-patched.js")
    parser.add_argument("--match", default="*challenge-platform*")
    parser.add_argument("--offset", default="24,33")
    parser.add_argument("--as-document", action="store_true",
                        help="also serve the captured body as the target URL's own document, "
                             "which is the only position left for a plaintext instrumented build")
    parser.add_argument("--click-after", type=float, default=14.0)
    parser.add_argument("--deadline", type=float, default=45.0)
    parser.add_argument("--settle", type=float, default=25.0)
    args = parser.parse_args()
    offset = tuple(int(part) for part in args.offset.split(","))
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    sys.exit(asyncio.run(run(endpoint, args.url, args.doc, args.match, offset,
                             args.click_after, args.deadline, args.settle, args.as_document)))


if __name__ == "__main__":
    main()
