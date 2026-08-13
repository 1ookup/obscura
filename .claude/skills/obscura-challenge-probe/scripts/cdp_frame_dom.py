#!/usr/bin/env python3
"""Read the DOM inside a cross-origin iframe, via an isolated world.

The page cannot reach into a cross-origin frame and the screenshot only shows
what painted, so neither answers "what element is that control, and why is it
blank". `Page.createIsolatedWorld` gives an execution context inside the frame
itself.

  ./cdp_frame_dom.py https://example.com --match challenges.cloudflare.com \
      --expr 'document.body.outerHTML.slice(0, 4000)'

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

# Anything that paints as an empty box is worth describing by its computed
# style, not its tag alone: a div with a background image, an svg, and an
# `appearance:none` input all look identical in a screenshot.
DEFAULT_EXPR = r"""
(function () {
  var out = { url: location.href, controls: [] };
  var nodes = document.querySelectorAll(
    'input, [role=checkbox], [class*=check], [class*=cb], label, svg, canvas');
  for (var i = 0; i < nodes.length && out.controls.length < 25; i++) {
    var el = nodes[i];
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    out.controls.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      cls: (el.getAttribute('class') || '').slice(0, 60),
      role: el.getAttribute('role'),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      appearance: cs.appearance || cs.webkitAppearance,
      display: cs.display,
      bg: cs.backgroundColor,
      bgImage: (cs.backgroundImage || '').slice(0, 70),
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      mask: (cs.maskImage || cs.webkitMaskImage || '').slice(0, 40),
      content: (cs.content || '').slice(0, 40),
    });
  }
  return out;
})()
"""


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


def walk_frames(node, out):
    frame = node.get("frame", {})
    out.append((frame.get("id"), frame.get("url", "")))
    for child in node.get("childFrames", []) or []:
        walk_frames(child, out)


async def run(endpoint, url, match, expr, wait):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        reply = await call(ws, "Target.createTarget", {"url": "about:blank"}, msg_id=1)
        target = reply["result"]["targetId"]
        reply = await call(ws, "Target.attachToTarget",
                           {"targetId": target, "flatten": True}, msg_id=2)
        session = reply["result"]["sessionId"]

        await call(ws, "Page.enable", session=session, msg_id=3)
        await call(ws, "Runtime.enable", session=session, msg_id=4)
        await call(ws, "Page.navigate", {"url": url}, session=session, msg_id=5)
        await asyncio.sleep(wait)

        reply = await call(ws, "Page.getFrameTree", session=session, msg_id=6)
        frames = []
        walk_frames(reply.get("result", {}).get("frameTree", {}), frames)

        results = []
        msg_id = 10
        for frame_id, frame_url in frames:
            if match and match not in (frame_url or ""):
                continue
            msg_id += 1
            world = await call(ws, "Page.createIsolatedWorld",
                               {"frameId": frame_id, "worldName": "probe",
                                "grantUniveralAccess": True},
                               session=session, msg_id=msg_id)
            context = world.get("result", {}).get("executionContextId")
            if context is None:
                results.append((frame_url, {"error": world.get("error") or world.get("result")}))
                continue
            msg_id += 1
            evaluated = await call(ws, "Runtime.evaluate",
                                   {"expression": "JSON.stringify(%s)" % expr,
                                    "returnByValue": True,
                                    "contextId": context},
                                   session=session, msg_id=msg_id)
            value = evaluated.get("result", {}).get("result", {})
            if "value" in value and value["value"]:
                try:
                    results.append((frame_url, json.loads(value["value"])))
                    continue
                except ValueError:
                    results.append((frame_url, value["value"]))
                    continue
            results.append((frame_url, {"error": evaluated.get("result")}))
        return frames, results


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--wait", type=float, default=10.0)
    parser.add_argument("--match", default="",
                        help="only frames whose URL contains this")
    parser.add_argument("--expr", default=DEFAULT_EXPR)
    args = parser.parse_args()

    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    frames, results = asyncio.run(run(endpoint, args.url, args.match, args.expr, args.wait))

    print("--- frames ---")
    for frame_id, frame_url in frames:
        print("  %s  %s" % (frame_id, (frame_url or "")[:100]))
    print("--- results ---")
    for frame_url, payload in results:
        print("  %s" % (frame_url or "")[:100])
        print(json.dumps(payload, indent=1, ensure_ascii=False)[:6000])


if __name__ == "__main__":
    main()
