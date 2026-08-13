#!/usr/bin/env python3
"""Click the Turnstile checkbox once interactive mode appears, then report.

The checkbox lives inside a closed shadow root inside a cross-origin iframe.
This script captures shadow roots as they attach (in every frame's main world),
waits for `interactiveBegin`, locates the checkbox's viewport box through the
frame's default execution context, and dispatches a real CDP click so obscura's
own (now shadow-piercing) hit-test resolves it to the checkbox.

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
    window.__pm.push({ t: Date.now() - window.__t0, origin: e.origin, data: s.slice(0, 300) });
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
        host: entry.host,
        src: String(frames[i].getAttribute('src') || '').slice(0, 80),
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  });
  return out;
})())
"""

FRAME_REPORT = r"""
JSON.stringify((function () {
  var out = { url: location.href, roots: 0, controls: [] };
  (window.__roots || []).forEach(function (entry) {
    out.roots++;
    var nodes = entry.root.querySelectorAll
      ? entry.root.querySelectorAll('input, [role=checkbox], [class*=check], [class*=cb], label, div')
      : [];
    for (var i = 0; i < nodes.length && out.controls.length < 60; i++) {
      var el = nodes[i];
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.controls.push({
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type'),
        role: el.getAttribute('role'),
        cls: (el.getAttribute('class') || '').slice(0, 50),
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  });
  return out;
})())
"""


class Session:
    def __init__(self, ws, session):
        self.ws = ws
        self.session = session
        self.msg_id = 0
        self.contexts = {}  # frame_id -> default contextId

    async def call(self, method, params=None):
        self.msg_id += 1
        mid = self.msg_id
        request = {"id": mid, "method": method, "sessionId": self.session}
        if params:
            request["params"] = params
        await self.ws.send(json.dumps(request))
        while True:
            reply = json.loads(await self.ws.recv())
            if reply.get("id") == mid:
                return reply
            # Capture context events that obscura flushes ahead of the reply.
            if reply.get("method") == "Runtime.executionContextCreated":
                c = reply["params"]["context"]
                aux = c.get("auxData", {})
                if aux.get("type") == "default" and aux.get("frameId"):
                    self.contexts[aux["frameId"]] = c["id"]


def walk_frames(node, out):
    frame = node.get("frame", {})
    out.append((frame.get("id"), frame.get("url", "")))
    for child in node.get("childFrames", []) or []:
        walk_frames(child, out)


async def run(endpoint, url, wait, offset, settle):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        reply = await _call(ws, "Target.createTarget", {"url": "about:blank"}, None, 1)
        target = reply["result"]["targetId"]
        reply = await _call(ws, "Target.attachToTarget",
                            {"targetId": target, "flatten": True}, None, 2)
        s = Session(ws, reply["result"]["sessionId"])

        await s.call("Page.enable")
        await s.call("Runtime.enable")
        await s.call("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD})
        await s.call("Page.navigate", {"url": url})

        await asyncio.sleep(wait)

        # One more command flushes any context events that piled up during the
        # sleep; the frame's default context id is what we evaluate against.
        parent = await s.call("Runtime.evaluate",
                              {"expression": PARENT_REPORT, "returnByValue": True})
        parent_val = parent.get("result", {}).get("result", {})
        iframes = []
        if "value" in parent_val:
            try:
                iframes = json.loads(parent_val["value"]).get("iframes", [])
            except ValueError:
                pass

        tree = await s.call("Page.getFrameTree")
        frames = []
        walk_frames(tree.get("result", {}).get("frameTree", {}), frames)

        checkbox = None
        for frame_id, frame_url in frames:
            if "challenges.cloudflare.com" not in (frame_url or ""):
                continue
            context = s.contexts.get(frame_id)
            if context is None:
                continue
            evaluated = await s.call("Runtime.evaluate", {
                "expression": FRAME_REPORT, "returnByValue": True,
                "contextId": context,
            })
            val = evaluated.get("result", {}).get("result", {})
            if "value" in val:
                try:
                    payload = json.loads(val["value"])
                    for c in payload.get("controls", []):
                        if 10 <= c.get("w", 0) <= 40 and 10 <= c.get("h", 0) <= 40:
                            checkbox = c
                            break
                except ValueError:
                    pass
            break

        frame_rect = iframes[0] if iframes else None
        if frame_rect is None:
            return {"error": "no iframe found", "iframes": iframes,
                    "contexts": s.contexts}

        if checkbox is not None:
            click_x = frame_rect["x"] + checkbox["x"] + checkbox["w"] / 2
            click_y = frame_rect["y"] + checkbox["y"] + checkbox["h"] / 2
        else:
            ox, oy = offset
            click_x = frame_rect["x"] + ox
            click_y = frame_rect["y"] + oy

        await s.call("Input.dispatchMouseEvent", {
            "type": "mousePressed", "x": float(click_x), "y": float(click_y),
            "button": "left", "buttons": 1, "clickCount": 1})
        await s.call("Input.dispatchMouseEvent", {
            "type": "mouseReleased", "x": float(click_x), "y": float(click_y),
            "button": "left", "buttons": 0, "clickCount": 1})

        await asyncio.sleep(settle)

        timeline = await s.call("Runtime.evaluate",
                                {"expression": "JSON.stringify(window.__pm || [])",
                                 "returnByValue": True})
        tl_val = timeline.get("result", {}).get("result", {})
        pm = []
        if "value" in tl_val:
            try:
                pm = json.loads(tl_val["value"])
            except ValueError:
                pass

        return {"iframes": iframes, "checkbox": checkbox,
                "click": [float(click_x), float(click_y)], "messages": pm,
                "contexts": {k: v for k, v in s.contexts.items()}}


async def _call(ws, method, params, session, msg_id):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--wait", type=float, default=14.0)
    parser.add_argument("--offset", type=str, default="24,32")
    parser.add_argument("--settle", type=float, default=6.0)
    args = parser.parse_args()

    ox, oy = (float(v) for v in args.offset.split(","))
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    data = asyncio.run(run(endpoint, args.url, args.wait, (ox, oy), args.settle))

    if "error" in data:
        print("error:", data["error"])
        print("contexts:", data.get("contexts"))
        return
    print("--- iframes (parent viewport) ---")
    for f in data["iframes"]:
        print("  %s  %s  box=(%s,%s %sx%s)" %
              (f["host"], f["src"], f["x"], f["y"], f["w"], f["h"]))
    print("--- frame default contexts ---")
    for fid, cid in data["contexts"].items():
        print("  %s -> context %s" % (fid[:24], cid))
    print("--- checkbox (frame main world) ---")
    print(" ", data["checkbox"])
    print("--- click dispatched at ---")
    print("  %.1f, %.1f" % tuple(data["click"]))
    print("--- messages (last 24) ---")
    for entry in data["messages"][-24:]:
        print("  %7d ms  %s" % (entry["t"], entry["data"][:200]))


if __name__ == "__main__":
    main()
