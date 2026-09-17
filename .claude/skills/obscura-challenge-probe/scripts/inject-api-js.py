#!/usr/bin/env python3
"""Run the challenge with the recovered instrumented Turnstile api.js served
locally, so the run produces a tracelog fragment without any page-side
instrumentation from the probe itself.

The proxy that used to rewrite /turnstile/v0/g/<hash>/api.js no longer matches
the current body (same URL, no tracelog/ov2 markers), so the fragment stopped
being produced. The instrumented body is still in the proxy's own flow history,
and Obscura's Fetch domain can fulfil that one request with it: everything else
goes to the network untouched, and the page never sees a probe script.

  ./inject-api-js.py https://www.thelancet.com/1.txt --api /tmp/api-patched.js
"""
import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

sys.path.insert(0, ".claude/skills/obscura-challenge-probe/scripts")
import importlib.util

spec = importlib.util.spec_from_file_location(
    "cc", ".claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py")
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


class Client:
    """CDP client that both answers calls and dispatches events."""

    def __init__(self, ws):
        self.ws = ws
        self.next_id = 0
        self.pending = {}
        self.events = asyncio.Queue()
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


async def run(endpoint, url, api_path, match, offset, click_after, deadline, settle, port):
    body = open(api_path, "rb").read()
    print(f"serving {len(body)} bytes of instrumented script for URLs matching {match!r}")
    async with websockets.connect(endpoint, max_size=128 * 1024 * 1024) as ws:
        client = Client(ws)
        await client.start()
        target = (await client.call("Target.createTarget", {"url": "about:blank"}))["result"]["targetId"]
        session = (await client.call("Target.attachToTarget",
                                     {"targetId": target, "flatten": True}))["result"]["sessionId"]
        for domain in ("Page", "Runtime", "DOM", "Fetch"):
            await client.call(domain + ".enable", session=session)
        await client.call("Fetch.enable",
                          {"patterns": [{"urlPattern": match, "requestStage": "Request"}]},
                          session=session)

        served = 0
        navigating = asyncio.create_task(
            client.call("Page.navigate", {"url": url}, session=session, timeout=90))

        async def answer_requests(stop):
            nonlocal served
            while not stop.is_set():
                try:
                    event = await client.wait_event("Fetch.requestPaused", timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                params = event["params"]
                request_id = params["requestId"]
                request_url = params.get("request", {}).get("url", "")
                if "turnstile/v0/g/" in request_url and "api.js" in request_url:
                    await client.call("Fetch.fulfillRequest", {
                        "requestId": request_id,
                        "responseCode": 200,
                        "responseHeaders": [
                            {"name": "Content-Type", "value": "application/javascript"},
                            {"name": "Cache-Control", "value": "no-store"},
                        ],
                        # Obscura's Fetch domain passes `body` through as the
                        # response body, where the CDP spec has it base64. Raw
                        # text is what this engine serves.
                        "body": body.decode("utf-8"),
                    }, session=session)
                    served += 1
                    print(f"  served instrumented api.js ({len(body)} bytes): {request_url[:90]}")
                else:
                    await client.call("Fetch.continueRequest", {"requestId": request_id}, session=session)

        stop = asyncio.Event()
        pump = asyncio.create_task(answer_requests(stop))
        await navigating
        print(f"  navigation done, instrumented responses served so far: {served}")

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
        title = await evaluate(client, session, "document.title")
        body_text = await evaluate(client, session, "(document.body && document.body.innerText || '').slice(0,160)")
        location = await evaluate(client, session, "location.href")
        print("--- final ---")
        print("  url:   ", location)
        print("  title:", title)
        print("  body: ", (body_text or "").replace("\n", " ")[:160])
        print("  instrumented api.js served:", served)
        return 0


async def evaluate(c, session, expression):
    response = await c.call("Runtime.evaluate",
                            {"expression": expression, "returnByValue": True}, session=session)
    return (response.get("result", {}).get("result") or {}).get("value")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--api", default="/tmp/api-patched.js")
    parser.add_argument("--match", default="*turnstile/v0/g/*/api.js*")
    parser.add_argument("--offset", default="24,33")
    parser.add_argument("--click-after", type=float, default=12.0)
    parser.add_argument("--deadline", type=float, default=45.0)
    parser.add_argument("--settle", type=float, default=30.0)
    args = parser.parse_args()
    offset = tuple(int(part) for part in args.offset.split(","))
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    sys.exit(asyncio.run(run(endpoint, args.url, args.api, args.match, offset,
                             args.click_after, args.deadline, args.settle, args.port)))


if __name__ == "__main__":
    main()
