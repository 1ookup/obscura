#!/usr/bin/env python3
"""Log where the challenge binds click/pointer handlers, via a preload hook.

Wraps EventTarget.prototype.addEventListener before the challenge loads and
writes each pointer/mouse/click/touch binding to console.error, which the
`obscura serve` log captures. This answers: is the Turnstile click handler on
the checkbox itself, its shadow root, the shadow host, or the document?

  ./cdp_event_probe.py https://zencare.co/1.txt

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
  var orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      var t = String(type || '');
      if (/(click|pointer|mouse|touch|down|up)/.test(t)) {
        var where;
        if (this === document) where = 'document';
        else if (this === document.body) where = 'body';
        else if (this && this.host) where = 'shadowRoot(host=' + (this.host.tagName || '?') + ')';
        else if (this && this.tagName) where = '<' + this.tagName.toLowerCase() + '>' + ((this.className && (' .' + this.className)) || '');
        else where = this && this.constructor && this.constructor.name;
        console.error('[EVT] ' + t + '  on  ' + where);
      }
    } catch (e) {}
    return orig.apply(this, arguments);
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


async def run(endpoint, url, wait):
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
        await asyncio.sleep(wait)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--wait", type=float, default=16.0)
    args = parser.parse_args()
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % args.port
    asyncio.run(run(endpoint, args.url, args.wait))
    print("done (check `obscura serve` log for [EVT] lines)")


if __name__ == "__main__":
    main()
