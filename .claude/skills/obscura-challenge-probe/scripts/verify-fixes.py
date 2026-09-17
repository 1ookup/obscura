#!/usr/bin/env python3
"""Instrumentation-free verification of the three shim fixes.

No probe script is injected into the challenge: this navigates to a fixture page
and asks the engine the same questions Cloudflare's own probe asks, then reports
whether the answers are the ones a browser gives.

Three checks, one per fix:

  webgl   every WebGL member's Function.prototype.toString answer. An engine
          shim that leaks its JS source is a fingerprint no browser produces.
  shims   the same answer swept across the element/shadow and standard
          interfaces, including Element.prototype.attachShadow, which the old
          click tool leaked by patching it from a preload script.
  fonts   which named families resolve through local() under the claimed
          platform, plus the text measurements a cross-check compares. A
          macOS identity resolving the Windows family set is the inconsistency.

  ./verify-fixes.py --port 9223 --label fixed-macos
  ./verify-fixes.py --port 9224 --label fixed-windows --json /tmp/verify-win.json
"""
import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

FIXTURE = "data:text/html,<html><body><div id=host></div></body></html>"

PROBE = r"""
(async () => {
  const NATIVE = /\[native code\]/;
  const out = { webgl: { total: 0, leaks: [] }, shims: { total: 0, leaks: [] }, fonts: {}, measure: {} };

  const sweep = (target, label, bucket) => {
    if (!target) return;
    let names;
    try { names = Object.getOwnPropertyNames(target); } catch (e) { return; }
    for (const name of names) {
      if (name === 'constructor' || name === 'caller' || name === 'arguments') continue;
      let desc;
      try { desc = Object.getOwnPropertyDescriptor(target, name); } catch (e) { continue; }
      if (!desc || typeof desc.value !== 'function') continue;
      let text;
      try { text = Function.prototype.toString.call(desc.value); } catch (e) { text = '<threw>'; }
      bucket.total++;
      if (!NATIVE.test(text)) bucket.leaks.push(label + '.' + name + ' -> ' + text.slice(0, 70));
    }
  };

  // 1. WebGL member surface. Every method lives on one prototype in the chain,
  // so walk it instead of trusting the leaf.
  const sweepChain = (start, label, bucket) => {
    let node = start, depth = 0;
    while (node && node !== Object.prototype && depth < 5) {
      sweep(node, depth === 0 ? label : label + '^' + depth, bucket);
      node = Object.getPrototypeOf(node);
      depth++;
    }
  };
  sweepChain(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype,
             'WebGLRenderingContext.prototype', out.webgl);
  sweepChain(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype,
             'WebGL2RenderingContext.prototype', out.webgl);
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
  if (gl) {
    sweepChain(gl, 'gl', out.webgl);
    for (const m of ['bufferData', 'getExtension', 'getParameter', 'getShaderPrecisionFormat',
                     'getSupportedExtensions', 'readPixels', 'texImage2D', 'drawArrays']) {
      if (typeof gl[m] !== 'function') continue;
      const text = Function.prototype.toString.call(gl[m]);
      out.webgl.total++;
      if (!NATIVE.test(text)) out.webgl.leaks.push('gl.' + m + ' -> ' + text.slice(0, 70));
    }
  }

  // 2. Element/shadow and the standard interface sweep.
  const targets = [
    'Element.prototype', 'HTMLElement.prototype', 'HTMLDivElement.prototype',
    'HTMLCanvasElement.prototype', 'HTMLImageElement.prototype', 'HTMLInputElement.prototype',
    'HTMLScriptElement.prototype', 'HTMLLinkElement.prototype', 'HTMLTemplateElement.prototype',
    'ShadowRoot.prototype', 'Document.prototype', 'DocumentFragment.prototype', 'Node.prototype',
    'EventTarget.prototype', 'Event.prototype', 'CustomEvent.prototype',
    'CanvasRenderingContext2D.prototype', 'Navigator.prototype', 'Screen.prototype',
    'Location.prototype', 'History.prototype', 'Storage.prototype', 'Performance.prototype',
    'Crypto.prototype', 'SubtleCrypto.prototype', 'Worker.prototype', 'WebSocket.prototype',
    'XMLHttpRequest.prototype', 'RTCPeerConnection.prototype', 'MutationObserver.prototype',
    'IntersectionObserver.prototype', 'ResizeObserver.prototype', 'Blob.prototype',
    'File.prototype', 'FileReader.prototype', 'URL', 'URLSearchParams.prototype',
    'Headers.prototype', 'Request.prototype', 'Response.prototype', 'FontFace.prototype',
    'FontFaceSet.prototype', 'Permissions.prototype', 'MediaDevices.prototype',
    'CustomElementRegistry.prototype', 'DOMParser.prototype', 'CSSStyleDeclaration.prototype',
    'Function.prototype', 'Object.prototype', 'Array.prototype', 'String.prototype',
  ];
  for (const path of targets) {
    let target = window;
    for (const part of path.split('.')) { target = target && target[part]; if (!target) break; }
    sweep(target, path, out.shims);
  }

  // 3. Named families and the measurements that cross-check them.
  const local = async family => {
    try { await new FontFace('p', `local("${family}")`).load(); return 'loaded'; }
    catch (error) { return error.name; }
  };
  const macFamilies = ['Menlo', 'Monaco', 'Luminari', 'InaiMathi Bold', 'Hoefler Text',
                       'Avenir Next', 'Geneva', 'Chalkboard'];
  const winFamilies = ['Segoe UI', 'Consolas', 'Calibri', 'Cambria', 'Candara',
                       'Franklin Gothic Medium', 'Sylfaen', 'Sitka Text', 'Malgun Gothic'];
  out.fonts = { mac: {}, win: {} };
  for (const family of macFamilies) out.fonts.mac[family] = await local(family);
  for (const family of winFamilies) out.fonts.win[family] = await local(family);
  const ctx = document.createElement('canvas').getContext('2d');
  const measure = family => { ctx.font = '16px ' + family; return Math.round(ctx.measureText('mmmmmmmmmmlli').width * 100) / 100; };
  for (const family of ['monospace', 'sans-serif', 'serif', '"Segoe UI"', '"Menlo"', '"Luminari"', '"Consolas"'])
    out.measure[family] = measure(family);

  out.webgl.missing = !gl;
  return JSON.stringify(out);
})()
"""


SHIM = """
(() => {
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow(init) {
    const root = original.call(this, init);
    (window.__probeRoots = window.__probeRoots || []).push(root);
    return root;
  };
})();
"""


async def run(port, label, json_path, preload_shim=False):
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % port
    async with websockets.connect(endpoint, max_size=64 * 1024 * 1024, ping_interval=None) as ws:
        counter = 0

        async def call(method, params=None, session=None, timeout=30):
            nonlocal counter
            counter += 1
            request = {"id": counter, "method": method, "params": params or {}}
            if session:
                request["sessionId"] = session
            await ws.send(json.dumps(request))
            while True:
                message = json.loads(await asyncio.wait_for(ws.recv(), timeout))
                if message.get("id") == counter:
                    return message

        target = (await call("Target.createTarget", {"url": "about:blank"}))["result"]["targetId"]
        session = (await call("Target.attachToTarget", {"targetId": target, "flatten": True}))["result"]["sessionId"]
        await call("Page.enable", session=session)
        await call("Runtime.enable", session=session)
        if preload_shim:
            # Control for the click tool's leak: a preload that patches a
            # builtin from script is what made Element.prototype.attachShadow
            # answer with JS source instead of [native code]. The clean clicker
            # injects nothing, which is the fix; this flag reproduces the leak
            # so the probe is shown to detect it.
            await call("Page.addScriptToEvaluateOnNewDocument", {"source": SHIM}, session=session)
        await call("Page.navigate", {"url": FIXTURE}, session=session, timeout=40)
        await asyncio.sleep(1.5)
        response = await call("Runtime.evaluate",
                              {"expression": PROBE, "awaitPromise": True, "returnByValue": True},
                              session=session, timeout=60)
        result = response.get("result", {})
        if result.get("exceptionDetails"):
            detail = result["exceptionDetails"]
            raise RuntimeError("probe threw: " + json.dumps(detail)[:400])
        report = json.loads(result["result"]["value"])

    print(f"=== {label} (port {port}) --- instrumentation-free, fixture page only")
    webgl, shims = report["webgl"], report["shims"]
    print(f"webgl members probed: {webgl['total']}   non-native answers: {len(webgl['leaks'])}"
          + ("   (no context created)" if webgl.get("missing") else ""))
    for leak in webgl["leaks"][:8]:
        print("    LEAK", leak)
    print(f"interface members probed: {shims['total']}   non-native answers: {len(shims['leaks'])}")
    for leak in shims["leaks"][:12]:
        print("    LEAK", leak)
    print("fonts, macOS-only families:", report["fonts"]["mac"])
    print("fonts, Windows-only families:", report["fonts"]["win"])
    print("measurements:", report["measure"])
    mac_loaded = all(v == "loaded" for v in report["fonts"]["mac"].values())
    win_loaded = all(v == "loaded" for v in report["fonts"]["win"].values())
    print(f"platform verdict: macOS set loaded={mac_loaded}  windows set loaded={win_loaded}"
          f"  (a consistent identity loads exactly one of them)")
    if json_path:
        with open(json_path, "w") as handle:
            json.dump(report, handle, indent=1, sort_keys=True)
        print("wrote", json_path)
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--label", default="run")
    parser.add_argument("--json")
    parser.add_argument("--preload-shim", action="store_true",
                        help="inject a preload that patches Element.prototype.attachShadow, "
                             "reproducing the click tool leak this verification rules out")
    args = parser.parse_args()
    asyncio.run(run(args.port, args.label, args.json, args.preload_shim))


if __name__ == "__main__":
    main()
