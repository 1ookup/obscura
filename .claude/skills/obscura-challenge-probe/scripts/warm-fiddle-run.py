#!/usr/bin/env python3
"""Drive the warm-fiddle harness on the target origin and report the token.

The harness page `/123.txt` is challenge-exempt, loads
`turnstile/v0/api.js?render=explicit`, and renders the widget into `#ts-container`
with a `callback` that logs the real token length into `#status`. That page is
how the reference trace was produced, so driving it makes a run comparable: same
page, same api.js URL, same explicit render.

  ./warm-fiddle-run.py --port 9261
  ./warm-fiddle-run.py --port 9261 \
      --url 'https://www.thelancet.com/123.txt?autorender=1&sitekey=0x4AAAAAAADnPIDROrmt1Wwj'
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

STATUS = """
JSON.stringify({
  status: (document.getElementById('status') || {}).textContent || '',
  ws: (document.getElementById('ws-state') || {}).textContent || '',
  ts: (document.getElementById('ts-state') || {}).textContent || '',
  renders: (document.getElementById('render-count') || {}).textContent || '',
  turnstile: typeof window.turnstile,
  widget: (function () {
    const c = document.getElementById('ts-container');
    return c ? c.innerHTML.length : -1;
  })(),
  auxBodies: Array.from(document.querySelectorAll('iframe')).length,
})
"""


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.next_id = 0
        self.pending = {}
        self.events = asyncio.Queue()
        self.fail_pattern = None
        self.failed = 0

    async def start(self):
        asyncio.create_task(self._read())

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
            pass

    async def pump_failures(self, session):
        """Answer the blocked requests so the page never sees the mock."""
        while True:
            event = await self.events.get()
            if event.get("method") != "Fetch.requestPaused":
                continue
            url = event["params"].get("request", {}).get("url", "")
            if self.fail_pattern and self.fail_pattern in url:
                self.failed += 1
                await self.call("Fetch.failRequest",
                                {"requestId": event["params"]["requestId"],
                                 "errorReason": "Aborted"}, session=session)

    async def call(self, method, params=None, session=None, timeout=30.0):
        self.next_id += 1
        request = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            request["sessionId"] = session
        future = asyncio.get_running_loop().create_future()
        self.pending[self.next_id] = future
        await self.ws.send(json.dumps(request))
        return await asyncio.wait_for(future, timeout=timeout)


async def evaluate(client, session, expression):
    response = await client.call("Runtime.evaluate",
                                 {"expression": expression, "returnByValue": True,
                                  "awaitPromise": True}, session=session, timeout=60)
    result = response.get("result", {})
    if result.get("exceptionDetails"):
        return {"<threw>": json.dumps(result["exceptionDetails"])[:200]}
    return (result.get("result") or {}).get("value")


async def browser_endpoint(port):
    """Obscura serves /devtools/browser; Chrome publishes its own URL."""
    direct = "ws://127.0.0.1:%d/devtools/browser" % port
    try:
        async with websockets.connect(direct, max_size=1024):
            return direct
    except Exception:
        pass
    import urllib.request
    with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % port, timeout=10) as handle:
        return json.load(handle)["webSocketDebuggerUrl"]


RECORDER = r"""
(function () {
  if (window.__msgWatch) return;
  window.__msgWatch = [];
  window.addEventListener('message', function (event) {
    try {
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (window.__msgWatch.length > 200) return;
      var record = { event: data.event, keys: Object.keys(data).slice(0, 10) };
      if (typeof data.token === 'string' && data.token.length > 100) window.__tokenSeen = data.token;
      if (data.apiVersion !== undefined) record.apiVersion = data.apiVersion;
      window.__msgWatch.push(record);
    } catch (error) {}
  }, true);
})();
"""

TOKEN_POLL = """JSON.stringify({
  token: window.__obscuraToken || null,
  error: window.__obscuraError || null,
  ctx: typeof window.turnstile,
})"""

DRIVE_RENDER = """(function () {
  try {
    var container = document.getElementById('ts-container');
    if (!container) return 'no container';
    var id = window.turnstile.render('#ts-container', {
      sitekey: '0x4AAAAAAADnPIDROrmt1Wwj',
      theme: 'light',
      retry: 'never', 'refresh-expired': 'never', 'refresh-timeout': 'never',
      callback: function (token) { window.__obscuraToken = token; },
      'error-callback': function (error) { window.__obscuraError = String(error); },
      'expired-callback': function () { window.__obscuraError = 'expired'; },
      'timeout-callback': function () { window.__obscuraError = 'timeout'; },
    });
    return 'rendered ' + id;
  } catch (e) { return 'render threw: ' + String(e); }
})()"""


async def run(port, url, click_after, deadline, settle, offset,
              block_mock=False, drive_render=False, capture_messages=False):
    endpoint = await browser_endpoint(port)
    async with websockets.connect(endpoint, max_size=128 * 1024 * 1024, ping_interval=None) as ws:
        client = Client(ws)
        await client.start()
        target = (await client.call("Target.createTarget", {"url": "about:blank"}))["result"]["targetId"]
        session = (await client.call("Target.attachToTarget",
                                     {"targetId": target, "flatten": True}))["result"]["sessionId"]
        for domain in ("Page", "Runtime", "DOM"):
            await client.call(domain + ".enable", session=session)
        if capture_messages:
            # Must be installed before the navigation, or the recorder never
            # sees the page that renders the widget.
            await client.call("Page.addScriptToEvaluateOnNewDocument",
                              {"source": RECORDER}, session=session)
            print("  passive message recorder installed")
        if block_mock:
            client.fail_pattern = "extra-params-mock.json"
            await client.call("Fetch.enable", {"patterns": [
                {"urlPattern": "*extra-params-mock.json*", "requestStage": "Request"}]},
                session=session)
            asyncio.create_task(client.pump_failures(session))
        await client.call("Page.navigate", {"url": url}, session=session, timeout=90)
        print("navigated:", url[:110])

        if drive_render:
            await asyncio.sleep(3.0)
            print("  drive render:", await evaluate(client, session, DRIVE_RENDER))
            token = None
            clicked = False
            waited = 0.0
            while waited < max(deadline, 30.0):
                await asyncio.sleep(2.0)
                waited += 2.0
                state = await evaluate(client, session, TOKEN_POLL)
                try:
                    state = json.loads(state)
                except (TypeError, ValueError):
                    continue
                if state.get("token"):
                    token = state["token"]
                    break
                if state.get("error"):
                    print(f"  t={waited:5.1f}s widget error: {state['error']}")
                    break
                if clicked:
                    continue
                box = await cc.widget_box(client, session)
                if box:
                    x, y = box[0] + offset[0], box[1] + offset[1]
                    print(f"  t={waited:5.1f}s widget box={box} -> click at ({x:.0f},{y:.0f})")
                    await cc.click(client, session, x, y)
                    clicked = True
            if token:
                with open("/tmp/warm-fiddle-token.txt", "w") as handle:
                    handle.write(token)
                print(f"  TOKEN len={len(token)} head={token[:60]}")
                print(f"  token written to /tmp/warm-fiddle-token.txt")
            else:
                print("  NO TOKEN captured")
            print("  blocked extra-params-mock requests:", client.failed)
            if capture_messages:
                seen = await evaluate(client, session,
                                      "JSON.stringify({messages: window.__msgWatch || [],"
                                      " token: window.__tokenSeen || null})")
                try:
                    seen = json.loads(seen)
                except (TypeError, ValueError):
                    seen = {}
                events = [m.get("event") for m in seen.get("messages", [])]
                print("  widget messages:", events[:24])
                if seen.get("token"):
                    print(f"  TOKEN from messages len={len(seen['token'])}")
                    with open("/tmp/warm-fiddle-token.txt", "w") as handle:
                        handle.write(seen["token"])

        clicked = False
        waited = 0.0
        while waited < deadline:
            await asyncio.sleep(2.0)
            waited += 2.0
            if clicked or waited < click_after:
                continue
            box = await cc.widget_box(client, session)
            if box:
                x, y = box[0] + offset[0], box[1] + offset[1]
                print(f"  t={waited:5.1f}s widget box={box} -> click at ({x:.0f},{y:.0f})")
                await cc.click(client, session, x, y)
                clicked = True
            else:
                print(f"  t={waited:5.1f}s no widget box yet")
        await asyncio.sleep(settle)

        print("--- page outcome ---")
        outcome = await evaluate(client, session, "JSON.stringify({href: location.href.slice(0,90),"
                                                   " title: document.title,"
                                                   " body: (document.body && document.body.innerText || '').slice(0,120).replace(/\\s+/g,' ')})")
        print("   ", outcome)
        status = await evaluate(client, session, STATUS)
        print("--- status ---")
        if isinstance(status, dict) and "status" in status:
            for line in status["status"].strip().splitlines():
                print("   ", line[:160])
            print("    ws:", status["ws"], "| ts:", status["ts"], "|", status["renders"],
                  "| turnstile:", status["turnstile"], "| container html:", status["widget"],
                  "| iframes:", status["auxBodies"])
        else:
            print("   ", status)
        return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9261)
    parser.add_argument("--url", default="https://www.thelancet.com/123.txt?autorender=1"
                                       "&sitekey=0x4AAAAAAADnPIDROrmt1Wwj&theme=light")
    parser.add_argument("--offset", default="24,33")
    parser.add_argument("--click-after", type=float, default=12.0)
    parser.add_argument("--deadline", type=float, default=45.0)
    parser.add_argument("--settle", type=float, default=25.0)
    parser.add_argument("--block-mock", action="store_true",
                        help="fail /__warm_fiddle__/extra-params-mock.json so the widget asks "
                             "Cloudflare for this round's extraParams instead of the stale mock")
    parser.add_argument("--capture-messages", action="store_true",
                        help="record the widget's postMessage traffic (passive listener)")
    parser.add_argument("--drive-render", action="store_true",
                        help="call turnstile.render with our own callback and record the token")
    args = parser.parse_args()
    offset = tuple(int(part) for part in args.offset.split(","))
    sys.exit(asyncio.run(run(args.port, args.url, args.click_after, args.deadline,
                             args.settle, offset, args.block_mock, args.drive_render,
                             args.capture_messages)))


if __name__ == "__main__":
    main()
