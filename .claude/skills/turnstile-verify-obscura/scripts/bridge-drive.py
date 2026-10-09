#!/usr/bin/env python3
"""Drive the bridge-mode warm-fiddle harness on obscura and report the token.

Same role as the Chromium-side `turnstile-ui-state.mjs`, but speaking obscura's
CDP: navigate to the harness page (served through the 9000 proxy by the
mitm addon), poll the harness DOM until the bridge-driven render resolves, and
auto-click the widget checkbox when it asks for interaction. The authoritative
token signal is the bridge's own `req#N TOKEN len=...` line; this script's
verdict comes from the harness `#status` panel (`callback token len=...`).

  ./bridge-drive.py --port 9311
  ./bridge-drive.py --port 9311 --deadline 120
"""
import argparse
import asyncio
import functools
import importlib.util
import json
import sys

# nohup/redirect makes stdout block-buffered; without this the caller reads an
# empty log while the run is live and misreads it as "did not start".
print = functools.partial(print, flush=True)

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

spec = importlib.util.spec_from_file_location(
    "cc", ".claude/skills/obscura-challenge-probe/scripts/cdp_click_clean.py")
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)

# Single-expression forms only: obscura's Runtime.evaluate silently returns
# nothing for some multi-line strings, which reads as "no harness" and sends
# the whole pass down the wrong path.
STATUS = """JSON.stringify({
  ws: (document.getElementById('ws-state') || {}).textContent || '',
  ts: (document.getElementById('ts-state') || {}).textContent || '',
  renders: (document.getElementById('render-count') || {}).textContent || '',
  widget: (function(){var c=document.getElementById('ts-container');return c?c.innerHTML.length:-1;})(),
  status: (document.getElementById('status') || {}).textContent || ''
})"""

TOKEN_RE = "callback token len="

# Seconds to wait before the single interaction click. The reference's click
# lands after the first two proof rounds (its fo1/fo2 CsJSj9 counters are all
# zero and the third POST carries the click); clicking at the widget shell's
# first render stamped those counts into fo2 instead and the deep program
# answered with a re-prompt (b47-o6). 16s clears the measured fo2 checkpoint
# (deep program captured ~t+13s) with margin against the 45s deadline.
FIRST_CLICK_WAIT = 16.0


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.next_id = 0
        self.pending = {}

    async def _read(self):
        try:
            while True:
                message = json.loads(await self.ws.recv())
                if "id" in message:
                    future = self.pending.pop(message["id"], None)
                    if future and not future.done():
                        future.set_result(message)
        except Exception:
            pass

    async def call(self, method, params=None, session=None, timeout=30.0):
        self.next_id += 1
        request = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            request["sessionId"] = session
        future = asyncio.get_running_loop().create_future()
        self.pending[self.next_id] = future
        await self.ws.send(json.dumps(request))
        return await asyncio.wait_for(future, timeout=timeout)

    async def evaluate(self, expr, session):
        response = await self.call("Runtime.evaluate",
                                   {"expression": expr, "returnByValue": True,
                                    "awaitPromise": True}, session=session, timeout=60)
        result = response.get("result", {})
        if result.get("exceptionDetails"):
            return {"<threw>": json.dumps(result["exceptionDetails"])[:200]}
        return (result.get("result") or {}).get("value")


async def run(port, url, deadline, offset, max_clicks):
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % port
    async with websockets.connect(endpoint, max_size=128 * 1024 * 1024,
                                  ping_interval=None) as ws:
        c = Cdp(ws)
        asyncio.create_task(c._read())
        target = (await c.call("Target.createTarget", {"url": "about:blank"}))["result"]["targetId"]
        session = (await c.call("Target.attachToTarget",
                                {"targetId": target, "flatten": True}))["result"]["sessionId"]
        for domain in ("Page", "Runtime", "DOM"):
            await c.call(domain + ".enable", session=session)
        await c.call("Page.navigate", {"url": url}, session=session, timeout=90)
        print("[drive] navigated:", url[:110])

        clicks = 0
        waited = 0.0
        last = {}
        while waited < deadline:
            await asyncio.sleep(1.0)
            waited += 1.0
            state = await c.evaluate(STATUS, session)
            if isinstance(state, str):
                # returnByValue hands back the JSON.stringify output as a string.
                try:
                    state = json.loads(state)
                except ValueError:
                    pass
            if not isinstance(state, dict):
                print("[drive] t=%5.1fs status eval failed: %s" % (waited, str(state)[:120]))
                continue
            last = state
            if waited <= 4.0:
                print("[drive] harness: ws=%r ts=%r %r" % (state.get("ws"), state.get("ts"),
                                                           state.get("renders")))
            if "open" not in str(state.get("ws", "")) and waited >= 20.0:
                print("[drive] harness never reached the fiddle server (ws=%r) — "
                      "check the 9001 node and OBSCURA_ALLOW_PRIVATE_NETWORK" % state.get("ws"))
                break
            renders = str(state.get("renders", "renders: 0"))
            status_text = str(state.get("status", ""))
            if TOKEN_RE in status_text:
                head = status_text.strip().splitlines()[-1][:120]
                print("[drive] t=%5.1fs TOKEN SEEN: %s" % (waited, head))
                print("[drive] result: success")
                return 0
            if "error-callback" in status_text:
                # bridge mode: the fiddle-client writes the widget's error-callback
                # into #status as a timestamped log line -- the only in-process
                # fail signal (window.__obscuraError is drive-render mode only).
                head = status_text.strip().splitlines()[-1][:120]
                print("[drive] t=%5.1fs FAIL SEEN: %s" % (waited, head))
                print("[drive] result: fail")
                return 41
            if "renders: 0" not in renders:
                # Render dispatched by the bridge; interact when the widget is
                # up AND the first two proof rounds have completed. The
                # reference's interaction record lands at the third POST: its
                # fo1/fo2 payloads carry all-zero CsJSj9 counters and the click
                # happens after the deep program prompts, not when the widget
                # shell first renders. An early click stamped interaction
                # counts into fo2, and the deep program answered with a
                # re-prompt instead of a submission (b47-o6).
                if clicks < max_clicks and waited >= FIRST_CLICK_WAIT:
                    box = await cc.widget_box(c, session)
                    if box:
                        x, y = box[0] + offset[0], box[1] + offset[1]
                        print("[drive] t=%5.1fs %s widget box=%s -> click (%.0f,%.0f)"
                              % (waited, renders.strip(), box, x, y))
                        await cc.click(c, session, x, y)
                        clicks += 1
                        await asyncio.sleep(6.0)
                        waited += 6.0
                    elif clicks == 0 and waited % 10.0 < 2.0:
                        print("[drive] t=%5.1fs %s but no widget box yet" % (waited, renders.strip()))

        print("[drive] t=%5.1fs DEADLINE, no token" % waited)
        if last:
            print("[drive] last harness state: ws=%r ts=%r %r widget=%s"
                  % (last.get("ws"), last.get("ts"), last.get("renders"), last.get("widget")))
            print("[drive] last #status tail:")
            for line in str(last.get("status", "")).strip().splitlines()[-6:]:
                print("   ", line[:160])
        print("[drive] result: timeout")
        return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9311)
    parser.add_argument("--url", default="https://www.thelancet.com/123.txt")
    parser.add_argument("--deadline", type=float, default=45.0,
                        help="challenge resolves or fails within ~10-25s; 45s is generous")
    # Click where the Chromium-side driver (turnstile-ui-state.mjs) clicks: it
    # resolves the widget checkbox and clicks its box center, measured at
    # iframe-local (93,33) on the 2026-10 build. The old (24,33) lands on the
    # focusable control itself, which the challenge click record flags
    # (wbeQI0.eiLB1 input vs the accepted body). Keep both point and record
    # shape identical to the accepted side.
    parser.add_argument("--offset", default="93,33")
    parser.add_argument("--max-clicks", type=int, default=3)
    args = parser.parse_args()
    offset = tuple(int(part) for part in args.offset.split(","))
    sys.exit(asyncio.run(run(args.port, args.url, args.deadline, offset, args.max_clicks)))


if __name__ == "__main__":
    main()
