#!/usr/bin/env python3
"""Screenshot a page on an interval while it loads, and report what changed.

A challenge that ends in a checkbox looks identical, from the network, to one
that is still thinking: both go quiet. A filmstrip separates them.

  ./cdp_filmstrip.py https://example.com --every 3 --for 35

Assumes `obscura serve` is already listening (see SKILL.md).
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

# Widgets that want a click are usually inside a cross-origin iframe, so the
# screenshot is the only view of them. Record the iframe box too, so a still
# frame can be tied back to a widget rather than guessed at.
REPORT = r"""
JSON.stringify((function () {
  var out = { title: document.title, frames: [] };
  var seen = [];
  (window.__roots || []).forEach(function (entry) {
    if (entry.root && entry.root.querySelectorAll) {
      var found = entry.root.querySelectorAll('iframe');
      for (var i = 0; i < found.length; i++) seen.push(found[i]);
    }
  });
  var light = document.querySelectorAll('iframe');
  for (var j = 0; j < light.length; j++) seen.push(light[j]);
  seen.forEach(function (f) {
    var r = f.getBoundingClientRect ? f.getBoundingClientRect() : null;
    out.frames.push({
      src: String(f.getAttribute('src') || '').slice(0, 70),
      x: r ? Math.round(r.left) : null, y: r ? Math.round(r.top) : null,
      w: r ? Math.round(r.width) : null, h: r ? Math.round(r.height) : null,
    });
  });
  return out;
})())
"""

PRELOAD = r"""
(function () {
  window.__roots = [];
  var attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    var root = attach.apply(this, arguments);
    try { window.__roots.push({ mode: init && init.mode, root: root }); } catch (e) {}
    return root;
  };
})();
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


async def run(endpoint, url, every, duration, outdir, start):
    os.makedirs(outdir, exist_ok=True)
    async with websockets.connect(endpoint, max_size=256 * 1024 * 1024) as ws:
        reply = await call(ws, "Target.createTarget", {"url": "about:blank"}, msg_id=1)
        target = reply["result"]["targetId"]
        reply = await call(ws, "Target.attachToTarget",
                           {"targetId": target, "flatten": True}, msg_id=2)
        session = reply["result"]["sessionId"]

        await call(ws, "Page.enable", session=session, msg_id=3)
        await call(ws, "Page.addScriptToEvaluateOnNewDocument",
                   {"source": PRELOAD}, session=session, msg_id=4)
        await call(ws, "Runtime.enable", session=session, msg_id=5)
        await call(ws, "Page.navigate", {"url": url}, session=session, msg_id=6)

        msg_id = 10
        shots = []
        elapsed = 0.0
        while elapsed <= duration:
            # Never evaluate in the first seconds after navigation: a
            # Runtime.evaluate landing at t~=1s permanently blanks obscura's
            # document (known, unfixed obscura defect; Chrome is unaffected).
            # So the first frame is delayed to max(every, start), not `every`
            # -- a small --every (e.g. 1s) would otherwise land in the danger
            # window.
            await asyncio.sleep(every if elapsed > 0.0 else max(every, start))
            elapsed += every
            msg_id += 1
            shot = await call(ws, "Page.captureScreenshot", {"format": "png"},
                              session=session, msg_id=msg_id)
            data = shot.get("result", {}).get("data")
            msg_id += 1
            meta = await call(ws, "Runtime.evaluate",
                              {"expression": REPORT, "returnByValue": True},
                              session=session, msg_id=msg_id)
            value = meta.get("result", {}).get("result", {}).get("value")
            info = json.loads(value) if value else {}
            if not data:
                shots.append((elapsed, None, None, info))
                continue
            raw = base64.b64decode(data)
            path = os.path.join(outdir, "t%05.1fs.png" % elapsed)
            with open(path, "wb") as handle:
                handle.write(raw)
            shots.append((elapsed, path, hashlib.sha256(raw).hexdigest()[:12], info))
        return shots


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--every", type=float, default=3.0)
    parser.add_argument("--for", dest="duration", type=float, default=35.0)
    parser.add_argument("--out", default="/tmp/filmstrip")
    parser.add_argument("--start", type=float, default=3.0,
                        help="seconds to wait after navigation before the first "
                             "evaluation (early evaluation blanks obscura's "
                             "document; Chrome is unaffected)")
    args = parser.parse_args()

    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    shots = asyncio.run(run(endpoint, args.url, args.every, args.duration, args.out, args.start))

    previous = None
    for elapsed, path, digest, info in shots:
        # Identical bytes mean the page is not repainting -- the usual look of
        # a widget waiting for a click, and of one that has simply stalled.
        mark = "same " if digest == previous else "CHANGED"
        previous = digest
        frames = ", ".join(
            "%sx%s@%s,%s %s" % (f["w"], f["h"], f["x"], f["y"], f["src"])
            for f in info.get("frames", [])
        ) or "(no iframe)"
        print("%6.1fs %s  %-28s %s" % (elapsed, mark, (info.get("title") or "")[:28], frames))
        if path:
            print("        %s" % path)


if __name__ == "__main__":
    main()
