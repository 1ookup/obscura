#!/usr/bin/env python3
"""Click the Turnstile checkbox with NO page-side injection at all.

Every other clicker in this directory installs a preload that wraps
`Element.prototype.attachShadow` to reach inside the widget's closed shadow
root. Cloudflare's own VM calls `attachShadow.toString()` while it collects
telemetry (`ov2.host.tostring` in the tracelog), so that wrapper is visible to
the challenge as a non-native function and marks the run. This script finds the
widget through CDP instead: `DOM.getDocument(pierce=true)` walks shadow roots
in the browser, and `DOM.getBoxModel` gives the frame's viewport rect, so the
page never sees a patched builtin.

  ./cdp_click_clean.py https://www.thelancet.com/1.txt --port 9223
"""
import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, params=None, session=None, timeout=30.0):
        self.n += 1
        mid = self.n
        req = {"id": mid, "method": method, "params": params or {}}
        if session:
            req["sessionId"] = session
        await self.ws.send(json.dumps(req))
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=timeout))
            if msg.get("id") == mid:
                return msg

    async def evaluate(self, expr, session):
        r = await self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True},
                            session=session)
        return r.get("result", {}).get("result", {}).get("value")


def walk(node, frames, debug=False, depth=0, in_shadow=False):
    """Collect every iframe in a pierce=true document tree.

    `pierce` walks shadow roots and frame documents, but the shape varies:
    `contentDocument` is a node object for a frame, not a list, and a closed
    shadow root only appears under `shadowRoots`. Clicking blind because the
    traversal guessed wrong is what this function exists to avoid.
    """
    if not isinstance(node, dict):
        return
    if node.get("nodeName") == "IFRAME":
        attrs = node.get("attributes") or []
        attr = {attrs[i]: attrs[i + 1] for i in range(0, len(attrs) - 1, 2)}
        frames.append({"nodeId": node.get("nodeId"), "src": attr.get("src", ""),
                       "id": attr.get("id", ""), "class": attr.get("class", ""),
                       "shadow": in_shadow})
        if debug:
            print(f"    iframe node={node.get('nodeId')} id={attr.get('id','')!r} "
                  f"class={attr.get('class','')!r} src={attr.get('src','')[:80]!r}")
    for child in node.get("children", []) or []:
        walk(child, frames, debug, depth + 1, in_shadow)
    for shadow in node.get("shadowRoots", []) or []:
        if debug:
            print("    shadowRoot " + " " * depth + f"of <{node.get('nodeName','?').lower()}>")
        walk(shadow, frames, debug, depth + 1, True)
    content = node.get("contentDocument")
    if isinstance(content, dict):
        walk(content, frames, debug, depth + 1, in_shadow)
    elif isinstance(content, list):
        for entry in content:
            walk(entry, frames, debug, depth + 1, in_shadow)


async def widget_box(c, session, debug=False):
    """The Turnstile frame's viewport rect, or None.

    Preferred match is the challenge origin; the fallback is the only frame on
    the page shaped like the widget (a ~300x65 strip), which is what the click
    needs when the src is a blob or the attribute is unreadable.
    """
    doc = await c.call("DOM.getDocument", {"depth": -1, "pierce": True}, session=session)
    root = doc.get("result", {}).get("root")
    if not root:
        if debug:
            print("    DOM.getDocument returned no root:", json.dumps(doc.get("error", doc))[:120])
        return None
    frames = []
    walk(root, frames, debug)
    if debug:
        print(f"    frames seen: {len(frames)}")
    boxes = []
    for frame in frames:
        box = await c.call("DOM.getBoxModel", {"nodeId": frame["nodeId"]}, session=session)
        quad = (box.get("result", {}).get("model") or {}).get("border")
        if not quad:
            continue
        xs, ys = quad[0::2], quad[1::2]
        x, y = min(xs), min(ys)
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        boxes.append((frame, x, y, w, h))
        if debug:
            print(f"    box {w:.0f}x{h:.0f} at ({x:.0f},{y:.0f}) shadow={frame['shadow']} "
                  f"src={frame['src'][:50]!r}")
    for frame, x, y, w, h in boxes:
        if "challenges.cloudflare.com" in frame["src"] and w > 100 and h > 20:
            return x, y, w, h
    # The widget sits in a closed shadow root, so a shadow-rooted frame wins a
    # tie: a page banner iframe of the same size would otherwise be clicked.
    for frame, x, y, w, h in boxes:
        if 200 <= w <= 420 and 40 <= h <= 120 and frame["shadow"]:
            return x, y, w, h
    for frame, x, y, w, h in boxes:
        if 200 <= w <= 420 and 40 <= h <= 120:
            return x, y, w, h
    return None


async def click(c, session, x, y):
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        params = {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1}
        if kind != "mouseMoved":
            params["buttons"] = 1
        await c.call("Input.dispatchMouseEvent", params, session=session)
        await asyncio.sleep(0.06)


async def run(endpoint, url, port, deadline, settle, offset, debug=False, click_after=10.0,
              preload_file=None):
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024) as ws:
        c = Cdp(ws)
        r = await c.call("Target.createTarget", {"url": "about:blank"})
        session = (await c.call("Target.attachToTarget",
                                {"targetId": r["result"]["targetId"], "flatten": True})
                   )["result"]["sessionId"]
        await c.call("Page.enable", session=session)
        await c.call("Runtime.enable", session=session)
        await c.call("DOM.enable", session=session)
        # No addScriptToEvaluateOnNewDocument by default: the page must stay
        # untouched, because the challenge reads `attachShadow.toString()` and
        # other builtin identities while it collects telemetry. --preload-file
        # is an explicit opt-in that trades that fidelity for visibility in
        # every realm (the CDP preload runs in each committed frame), so a run
        # that used it is observation, not evidence about the engine.
        if preload_file:
            with open(preload_file, "r", encoding="utf-8") as handle:
                source = handle.read()
            got = await c.call("Page.addScriptToEvaluateOnNewDocument",
                               {"source": source, "runImmediately": False}, session=session)
            print(f"  preload installed: {len(source)} bytes id="
                  f"{got.get('result', {}).get('identifier')}")
        await c.call("Page.navigate", {"url": url}, session=session)

        clicked = False
        waited = 0.0
        # No polling during the first seconds: a Runtime.evaluate landing at
        # t~=1s permanently blanks obscura's document (see cdp_click_fast.py's
        # --start note). DOM domain calls are browser-side and safe, but the
        # widget has not been created that early anyway.
        while waited < deadline:
            await asyncio.sleep(2.0)
            waited += 2.0
            if waited < click_after:
                continue
            box = await widget_box(c, session, debug)
            if box and not clicked:
                x, y = box[0] + offset[0], box[1] + offset[1]
                print(f"  t={waited:5.1f}s widget box={box} -> click at ({x:.0f},{y:.0f})")
                await click(c, session, x, y)
                clicked = True
                break
        await asyncio.sleep(settle)

        title = await c.evaluate("document.title", session)
        body = await c.evaluate("(document.body && document.body.innerText || '').slice(0,120)",
                                session)
        location = await c.evaluate("location.href", session)
        print("--- final ---")
        print("  url:  ", location)
        print("  title:", title)
        print("  body: ", (body or "").replace("\n", " ")[:120])
        ok = title is not None and "404" in str(title) + str(body)
        print("  verdict:", "404 (passed)" if ok else "still on the challenge")
        return 0 if ok else 1


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--offset", default="24,33", help="checkbox centre within the widget frame")
    p.add_argument("--deadline", type=float, default=30.0)
    p.add_argument("--settle", type=float, default=20.0)
    p.add_argument("--click-after", type=float, default=10.0,
                   help="seconds to wait before clicking; the widget asks for interaction after ~10s")
    p.add_argument("--debug", action="store_true", help="print every frame and box seen")
    p.add_argument("--preload-file", default=None,
                   help="JS handed to Page.addScriptToEvaluateOnNewDocument before navigation; "
                        "visible to the page, so instrumented runs are observation only")
    a = p.parse_args()
    off = tuple(int(part) for part in a.offset.split(","))
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % a.port
    sys.exit(asyncio.run(run(endpoint, a.url, a.port, a.deadline, a.settle, off, a.debug,
                             a.click_after, a.preload_file)))


if __name__ == "__main__":
    main()
