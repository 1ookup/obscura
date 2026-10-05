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

In Chrome the widget is not an iframe on the page tree: it is a custom element
whose shadow tree holds the real `<input type=checkbox>`, so the pierce walk
finds no frame and no box. A second probe (`probe_box` with `PROBE_JS`) runs
page-side JS that walks every reachable shadow root for an iframe and falls
back to the checkbox's shadow host or a widget-shaped ancestor. The two probes
race per poll: page-side JS first, the CDP walk as fallback (it can see into
closed roots, which page JS cannot). --debug labels the winner with a
`box source:` line.

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


def walk(node, frames, debug=False, depth=0, in_shadow=False, inputs=None, host_node=None):
    """Collect every iframe and checkbox in a pierce=true document tree.

    `pierce` walks shadow roots and frame documents, but the shape varies:
    `contentDocument` is a node object for a frame, not a list, and a closed
    shadow root only appears under `shadowRoots`. Clicking blind because the
    traversal guessed wrong is what this function exists to avoid. The INPUT
    branch covers the Chrome-side widget, where the checkbox lives in a shadow
    tree instead of an iframe; `host_node` tracks the nearest shadow host so
    the caller can measure the widget container, not the 24x24 input.
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
    elif node.get("nodeName") == "INPUT":
        attrs = node.get("attributes") or []
        attr = {attrs[i]: attrs[i + 1] for i in range(0, len(attrs) - 1, 2)}
        if str(attr.get("type", "")).lower() == "checkbox" and inputs is not None:
            inputs.append({"nodeId": node.get("nodeId"), "hostNodeId": host_node,
                           "id": attr.get("id", ""), "name": attr.get("name", ""),
                           "class": attr.get("class", ""), "shadow": in_shadow})
            if debug:
                print(f"    checkbox node={node.get('nodeId')} host={host_node} "
                      f"name={attr.get('name','')!r} shadow={in_shadow}")
    for child in node.get("children", []) or []:
        walk(child, frames, debug, depth + 1, in_shadow, inputs, host_node)
    for shadow in node.get("shadowRoots", []) or []:
        if debug:
            print("    shadowRoot " + " " * depth + f"of <{node.get('nodeName','?').lower()}>")
        walk(shadow, frames, debug, depth + 1, True, inputs, node.get("nodeId"))
    content = node.get("contentDocument")
    if isinstance(content, dict):
        # A frame document is a separate tree: the shadow host tracked so far
        # belongs to this document, not to the frame's.
        walk(content, frames, debug, depth + 1, in_shadow, inputs)
    elif isinstance(content, list):
        for entry in content:
            walk(entry, frames, debug, depth + 1, in_shadow, inputs)


async def node_box(c, session, node_id):
    """The node's border-box rect as (x, y, w, h), or None.

    `DOM.getBoxModel` returns the border quad as eight corner coordinates; the
    axis-aligned min/max are the viewport rect the click needs.
    """
    if node_id is None:
        return None
    box = await c.call("DOM.getBoxModel", {"nodeId": node_id}, session=session)
    quad = (box.get("result", {}).get("model") or {}).get("border")
    if not quad:
        return None
    xs, ys = quad[0::2], quad[1::2]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


async def widget_box(c, session, debug=False):
    """The Turnstile frame's viewport rect, or None.

    Preferred match is the challenge origin; the fallback is the only frame on
    the page shaped like the widget (a ~300x65 strip), which is what the click
    needs when the src is a blob or the attribute is unreadable. On the Chrome
    side no frame matches at all (the checkbox lives in a shadow tree): the
    checkbox found by the pierce walk is used instead, preferring its nearest
    shadow host, which is the widget container the click offset is measured
    from, over the input itself.
    """
    doc = await c.call("DOM.getDocument", {"depth": -1, "pierce": True}, session=session)
    root = doc.get("result", {}).get("root")
    if not root:
        if debug:
            print("    DOM.getDocument returned no root:", json.dumps(doc.get("error", doc))[:120])
        return None
    frames = []
    inputs = []
    walk(root, frames, debug, inputs=inputs)
    if debug:
        print(f"    frames seen: {len(frames)}")
        print(f"    checkboxes seen: {len(inputs)}")
    boxes = []
    for frame in frames:
        box = await node_box(c, session, frame["nodeId"])
        if not box:
            continue
        x, y, w, h = box
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
    for entry in inputs:
        box = await node_box(c, session, entry["hostNodeId"])
        if not box:
            continue
        x, y, w, h = box
        if debug:
            print(f"    checkbox host box {w:.0f}x{h:.0f} at ({x:.0f},{y:.0f}) "
                  f"name={entry['name']!r}")
        if 200 <= w <= 420 and 40 <= h <= 120:
            return x, y, w, h
    for entry in inputs:
        box = await node_box(c, session, entry["nodeId"])
        if not box:
            continue
        x, y, w, h = box
        if debug:
            print(f"    checkbox box {w:.0f}x{h:.0f} at ({x:.0f},{y:.0f}) "
                  f"name={entry['name']!r}")
        if 200 <= w <= 420 and 40 <= h <= 120:
            return x, y, w, h
    return None


PROBE_JS = r'''
(function(){
  var out = [];
  var roots = [document];
  var seen = new Set();
  seen.add(document);
  function addRoot(r) {
    if (r && roots.length < 64 && !seen.has(r)) { seen.add(r); roots.push(r); }
  }
  for (var i = 0; i < roots.length; i++) {
    var all;
    try { all = roots[i].querySelectorAll('*'); } catch (e) { continue; }
    if (all.length > 5000) { continue; }
    for (var j = 0; j < all.length; j++) {
      if (all[j].shadowRoot) { addRoot(all[j].shadowRoot); }
    }
  }
  function shaped(w, h) { return w >= 200 && w <= 420 && h >= 40 && h <= 120; }
  function add(how, el, rect) {
    out.push({how: how, x: rect.left, y: rect.top, w: rect.width, h: rect.height,
              src: (el && el.src) || ''});
  }
  for (var k = 0; k < roots.length; k++) {
    var root = roots[k];
    var fr = root.querySelectorAll('iframe');
    for (var a = 0; a < fr.length; a++) { add('iframe', fr[a], fr[a].getBoundingClientRect()); }
    var cb = root.querySelectorAll('input[type=checkbox]');
    for (var b = 0; b < cb.length; b++) {
      var el = cb[b];
      var node = el.getRootNode ? el.getRootNode() : null;
      var host = (node && node.host) ? node.host : null;
      if (host) { add('checkbox-host', host, host.getBoundingClientRect()); }
      var chain = [];
      var cur = el;
      for (var up = 0; up < 8; up++) {
        var par = cur.parentElement;
        if (!par && cur.getRootNode) {
          var rn = cur.getRootNode();
          if (rn && rn.host) { par = rn.host; }
        }
        if (!par) { break; }
        chain.push(par);
        cur = par;
      }
      for (var ci = 0; ci < chain.length; ci++) {
        var cr = chain[ci].getBoundingClientRect();
        if (shaped(cr.width, cr.height)) { add('checkbox-ancestor', chain[ci], cr); break; }
      }
      add('checkbox', el, el.getBoundingClientRect());
    }
  }
  if (out.length === 0) {
    var cont = document.querySelectorAll('cf-turnstile,.cf-turnstile,[data-sitekey],[class*="turnstile"],[id*="turnstile"]');
    for (var c = 0; c < cont.length && c < 20; c++) { add('container', cont[c], cont[c].getBoundingClientRect()); }
  }
  return JSON.stringify(out);
})()
'''


async def probe_box(c, session, debug=False):
    """Page-side JS probe for the widget box, or None.

    The fast half of the pair: one Runtime.evaluate per poll, which works when
    the widget is a custom element with the checkbox in an open shadow tree.
    Page JS cannot see into closed roots, so the caller still runs the CDP
    pierce walk as fallback.
    """
    try:
        raw = await c.evaluate(PROBE_JS, session)
    except Exception as exc:
        if debug:
            print(f"    js probe failed: {exc}")
        return None
    if not raw:
        if debug:
            print("    js probe: no result")
        return None
    try:
        candidates = json.loads(raw)
    except Exception:
        if debug:
            print(f"    js probe: unparsable {str(raw)[:120]!r}")
        return None
    if debug:
        print(f"    js probe candidates: {json.dumps(candidates)[:300]}")
    # Same preference as the CDP walk: CF origin, then any iframe, then the
    # checkbox host, then a widget-shaped ancestor/container/checkbox.
    for want_cf in (True, False):
        for cand in candidates:
            if cand.get("how") != "iframe" or cand.get("w", 0) <= 100 or cand.get("h", 0) <= 20:
                continue
            if want_cf and "challenges.cloudflare.com" not in (cand.get("src") or ""):
                continue
            return float(cand["x"]), float(cand["y"]), float(cand["w"]), float(cand["h"])
    for how in ("checkbox-host", "checkbox-ancestor", "container", "checkbox"):
        for cand in candidates:
            if cand.get("how") != how:
                continue
            if 200 <= cand.get("w", 0) <= 420 and 40 <= cand.get("h", 0) <= 120:
                return float(cand["x"]), float(cand["y"]), float(cand["w"]), float(cand["h"])
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
        # --start note). The JS probe therefore starts at click_after (>=2s);
        # the CDP walk is browser-side and safe, but the widget has not been
        # created that early anyway.
        while waited < deadline:
            await asyncio.sleep(2.0)
            waited += 2.0
            if waited < click_after:
                continue
            box = await probe_box(c, session, debug)
            if box and debug:
                print("    box source: js probe")
            if not box:
                box = await widget_box(c, session, debug)
                if box and debug:
                    print("    box source: cdp walk")
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
    import urllib.request as _ur, json as _json
    try:
        _v = _json.load(_ur.urlopen("http://127.0.0.1:%d/json/version" % a.port, timeout=3))
        endpoint = _v.get("webSocketDebuggerUrl") or ("ws://127.0.0.1:%d/devtools/browser" % a.port)
    except Exception:
        endpoint = "ws://127.0.0.1:%d/devtools/browser" % a.port
    sys.exit(asyncio.run(run(endpoint, a.url, a.port, a.deadline, a.settle, off, a.debug,
                             a.click_after, a.preload_file)))


if __name__ == "__main__":
    main()
