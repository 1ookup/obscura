#!/usr/bin/env python3
"""Wait for Turnstile's interactiveBegin, click the checkbox, report the result.

The checkbox lives inside a closed shadow root inside a cross-origin iframe.
This script polls the parent's postMessage timeline until `interactiveBegin`,
then dispatches a CDP click at the iframe's top-left plus the checkbox's known
frame-local offset (a ~30x30 control near the left edge of the 300x65 widget),
and watches for `interactiveEnd` / `complete` / `/pat/`.

  ./cdp_click_checkbox.py https://zencare.co/1.txt

Assumes `obscura serve` is already listening (see SKILL.md).
"""
import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

PRELOAD = r"""
(function () {
  window.__roots = [];
  var attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    var root = attach.apply(this, arguments);
    try { window.__roots.push({ mode: init && init.mode, host: this.tagName, root: root }); }
    catch (e) {}
    return root;
  };
  window.__t0 = Date.now();
  window.__pm = [];
  window.addEventListener('message', function (e) {
    var d = e.data;
    var s = (typeof d === 'object') ? JSON.stringify(d) : String(d);
    window.__pm.push({ t: Date.now() - window.__t0, origin: e.origin, data: s.slice(0, 400) });
  });
})();
"""

PARENT_REPORT = r"""
JSON.stringify((function () {
  var out = { iframes: [] };
  (window.__roots || []).forEach(function (entry) {
    var frames = entry.root.querySelectorAll ? entry.root.querySelectorAll('iframe') : [];
    for (var i = 0; i < frames.length; i++) {
      var r = frames[i].getBoundingClientRect();
      out.iframes.push({
        src: String(frames[i].getAttribute('src') || '').slice(0, 80),
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  });
  return out;
})())
"""

TIMELINE_REPORT = "JSON.stringify(window.__pm || [])"


async def call(ws, method, params=None, session=None, msg_id=1):
    request = {"id": msg_id, "method": method}
    if params:
        request["params"] = params
    if session:
        request["sessionId"] = session
    await ws.send(json.dumps(request))
    while True:
        reply = json.loads(await ws.recv())
        if reply.get("id") == msg_id:
            return reply


async def timeline(ws, session, msg_id):
    reply = await call(ws, "Runtime.evaluate",
                       {"expression": TIMELINE_REPORT, "returnByValue": True},
                       session=session, msg_id=msg_id)
    val = reply.get("result", {}).get("result", {})
    if "value" not in val:
        return []
    try:
        return json.loads(val["value"])
    except ValueError:
        return []


async def run(endpoint, url, offset, timeout, settle):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        reply = await call(ws, "Target.createTarget", {"url": "about:blank"}, msg_id=1)
        target = reply["result"]["targetId"]
        reply = await call(ws, "Target.attachToTarget",
                           {"targetId": target, "flatten": True}, msg_id=2)
        session = reply["result"]["sessionId"]
        await call(ws, "Page.enable", session=session, msg_id=3)
        await call(ws, "Runtime.enable", session=session, msg_id=4)
        await call(ws, "Page.addScriptToEvaluateOnNewDocument",
                   {"source": PRELOAD}, session=session, msg_id=5)
        await call(ws, "Page.navigate", {"url": url}, session=session, msg_id=6)

        # Poll the timeline until interactiveBegin (or timeout).
        began = False
        msg_id = 10
        for _ in range(int(timeout)):
            await asyncio.sleep(1.0)
            msg_id += 1
            events = [e.get("data", "") for e in await timeline(ws, session, msg_id)]
            if any('"event":"interactiveBegin"' in d for d in events):
                began = True
                break

        msg_id += 1
        parent = await call(ws, "Runtime.evaluate",
                            {"expression": PARENT_REPORT, "returnByValue": True},
                            session=session, msg_id=msg_id)
        parent_val = parent.get("result", {}).get("result", {})
        iframes = []
        if "value" in parent_val:
            try:
                iframes = json.loads(parent_val["value"]).get("iframes", [])
            except ValueError:
                pass

        click_x = click_y = None
        if iframes and iframes[0].get("w", 0) > 0:
            ox, oy = offset
            click_x = float(iframes[0]["x"] + ox)
            click_y = float(iframes[0]["y"] + oy)

        if click_x is not None:
            await call(ws, "Input.dispatchMouseEvent", {
                "type": "mouseMoved", "x": click_x, "y": click_y}, session=session, msg_id=39)
            await call(ws, "Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": click_x, "y": click_y,
                "button": "left", "buttons": 1, "clickCount": 1}, session=session, msg_id=40)
            await call(ws, "Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": click_x, "y": click_y,
                "button": "left", "buttons": 0, "clickCount": 1}, session=session, msg_id=41)

        await asyncio.sleep(settle)
        msg_id += 1
        final = await timeline(ws, session, msg_id)

        return {"began": began, "iframes": iframes, "click": [click_x, click_y],
                "messages": final}


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--offset", type=str, default="24,33")
    parser.add_argument("--timeout", type=float, default=40.0)
    parser.add_argument("--settle", type=float, default=8.0)
    args = parser.parse_args()

    ox, oy = (float(v) for v in args.offset.split(","))
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    data = asyncio.run(run(endpoint, args.url, (ox, oy), args.timeout, args.settle))

    print("interactiveBegin seen:", data["began"])
    print("--- iframes ---")
    for f in data["iframes"]:
        print("  box=(%s,%s %sx%s) %s" % (f["x"], f["y"], f["w"], f["h"], f["src"]))
    print("--- click at ---", data["click"])
    print("--- events ---")
    for entry in data["messages"]:
        d = entry["data"]
        if '"event":"food"' in d:
            continue
        print("  %7d ms  %s" % (entry["t"], d[:200]))
    print("--- last food seq ---")
    foods = [e for e in data["messages"] if '"event":"food"' in e["data"]]
    if foods:
        print("  ", foods[-1]["data"][:120], "at", foods[-1]["t"], "ms")


if __name__ == "__main__":
    main()
