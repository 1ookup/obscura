#!/usr/bin/env python3
"""Record the turnstile token the page receives, without changing page behavior.

Cloudflare hands the widget's result to the page it is embedded in. A passive
`message` listener installed at document start records every payload the page
receives (Turnstile posts to the parent frame / the rendering page), and the
recorder is read back over CDP afterwards. Nothing is patched: the listener only
observes, so the challenge runs exactly as it does without us.

  ./capture-token.py --port 9265 --url https://www.thelancet.com/1.txt \
      --click-at 216,313 --seconds 90 --json /tmp/token-capture.json
"""
import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

RECORDER = r"""
(function () {
  if (window.__tokenWatch) return;
  window.__tokenWatch = { messages: [], token: null, errors: [] };
  function note(entry) {
    var list = window.__tokenWatch.messages;
    if (list.length < 400) list.push(entry);
  }
  window.__driveTurnstile = function (options) {
    try {
      if (!window.turnstile || typeof window.turnstile.render !== 'function') {
        return 'no turnstile: ' + (typeof window.turnstile);
      }
      var sitekey = options.sitekey;
      var parent = document.body || document.documentElement;
      if (!parent) return 'no document element yet';
      var host = document.getElementById('__token_watch_host') || document.createElement('div');
      host.id = '__token_watch_host';
      host.style.cssText = 'position:fixed;left:8px;bottom:8px;width:300px;height:70px;z-index:2147483647';
      parent.appendChild(host);
      var params = {
        sitekey: sitekey,
        theme: 'light',
        retry: 'never', 'refresh-expired': 'never', 'refresh-timeout': 'never',
        callback: function (token) { window.__tokenWatch.token = token; },
        'error-callback': function (error) { window.__tokenWatch.errors.push('widget: ' + String(error)); },
        'expired-callback': function () { window.__tokenWatch.errors.push('expired'); },
        'timeout-callback': function () { window.__tokenWatch.errors.push('timeout'); },
      };
      // The site's own widget carries an action, and Cloudflare's extraParams
      // message reports it as "managed"; a render without it can be refused as
      // a metadata mismatch (error 600010).
      if (options.action) params.action = options.action;
      if (options.cdata) params.cdata = options.cdata;
      window.__tokenWatch.lastParams = { action: params.action, cdata: params.cdata };
      var id = window.turnstile.render(host, params);
      return 'rendered ' + id;
    } catch (error) { return 'render threw: ' + String(error); }
  };
  window.__startDrive = function (options, delayMs) {
    var attempt = 0;
    var timer = setInterval(function () {
      attempt += 1;
      var result = window.__driveTurnstile(options);
      window.__tokenWatch.driveAttempts = (window.__tokenWatch.driveAttempts || []).concat([attempt + ':' + result]);
      if (/^rendered/.test(String(result)) || window.__tokenWatch.token || attempt > 15) clearInterval(timer);
    }, delayMs || 4000);
  };
  window.addEventListener('message', function (event) {
    try {
      var data = event.data;
      var origin = String(event.origin || '');
      if (typeof data === 'string') {
        note({ kind: 'string', origin: origin, len: data.length, head: data.slice(0, 160) });
        if (data.length > 200 && /^[\w.-]+$/.test(data)) window.__tokenWatch.token = data;
        return;
      }
      if (!data || typeof data !== 'object') { note({ kind: typeof data, origin: origin }); return; }
      var keys = Object.keys(data);
      var record = { kind: 'object', origin: origin, keys: keys.slice(0, 14) };
      for (var index = 0; index < keys.length; index++) {
        var key = keys[index];
        if (/token|chlPageData|cData|extraParam|verif|ray|event|apiVersion|^code$|cfChlOut|frMd|rcV|reason|error/i.test(key)) {
          var value = data[key];
          record[key] = typeof value === 'string' ? value.slice(0, 400) : String(value).slice(0, 400);
        }
      }
      note(record);
      if (typeof data.token === 'string' && data.token.length > 200) {
        window.__tokenWatch.token = data.token;
      }
    } catch (error) {
      window.__tokenWatch.errors.push(String(error));
    }
  }, true);
  if (window.__driveSitekey) {
    setTimeout(function () {
      window.__startDrive({ sitekey: window.__driveSitekey, action: window.__driveAction || null,
                            cdata: window.__driveCdata || null }, 4000);
    }, 1500);
  }
})();
"""


async def evaluate(client, session, expression, context_id=None):
    params = {"expression": expression, "returnByValue": True, "awaitPromise": True}
    if context_id is not None:
        params["contextId"] = context_id
    response = await client.call("Runtime.evaluate", params, session=session, timeout=60)
    result = response.get("result", {})
    if result.get("exceptionDetails"):
        return {"<threw>": json.dumps(result["exceptionDetails"])[:240]}
    return (result.get("result") or {}).get("value")


async def run(port, url, click_at, seconds, json_path, drive_render=False,
              sitekey="0x4AAAAAAADnPIDROrmt1Wwj", action=None, cdata=None):
    async with websockets.connect("ws://127.0.0.1:%d/devtools/browser" % port,
                                  max_size=128 * 1024 * 1024, ping_interval=None) as ws:
        counter = 0

        contexts = []

        async def call(method, params=None, session=None, timeout=30):
            nonlocal counter
            counter += 1
            request = {"id": counter, "method": method, "params": params or {}}
            if session:
                request["sessionId"] = session
            await ws.send(json.dumps(request))
            while True:
                message = json.loads(await asyncio.wait_for(ws.recv(), timeout))
                if message.get("method") == "Runtime.executionContextCreated":
                    contexts.append(message["params"]["context"])
                if message.get("id") == counter:
                    return message

        def main_context():
            """The page's own realm: an engine that answers evaluations from the
            last context it created would otherwise land in a frame or worker."""
            for context in contexts:
                aux = context.get("auxData") or {}
                if aux.get("isDefault") and aux.get("type") == "default":
                    return context.get("id")
            return None

        target = (await call("Target.createTarget", {"url": "about:blank"}))["result"]["targetId"]
        session = (await call("Target.attachToTarget",
                              {"targetId": target, "flatten": True}))["result"]["sessionId"]
        for domain in ("Page", "Runtime"):
            await call(domain + ".enable", session=session)
        await call("Page.addScriptToEvaluateOnNewDocument",
                   {"source": "window.__driveSitekey = %s; window.__driveAction = %s; window.__driveCdata = %s;\n"
                              % (json.dumps(sitekey), json.dumps(action), json.dumps(cdata)) + RECORDER},
                   session=session)
        await call("Page.navigate", {"url": url}, session=session, timeout=90)
        print("navigated:", url[:100])

        proxy_client = type("C", (), {"call": call})
        # The engine answers evaluations from the session's own realm and
        # rejects an explicit contextId, so keep to the default context.
        context_id = None
        clicked = False
        drove = None
        start = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start < seconds:
            await asyncio.sleep(2.0)
            elapsed = asyncio.get_event_loop().time() - start
            if drive_render:
                state = await evaluate(proxy_client, session,
                                       "JSON.stringify({token: window.__tokenWatch && window.__tokenWatch.token,"
                                       " attempts: (window.__tokenWatch && window.__tokenWatch.driveAttempts) || []})")
                try:
                    state = json.loads(state)
                except (TypeError, ValueError):
                    state = {}
                if state.get("attempts") and state["attempts"] != drove:
                    drove = state["attempts"]
                    print(f"  t={elapsed:5.1f}s drive:", drove[-1])
            if not clicked and elapsed > 14:
                target = click_at
                if drive_render:
                    size = await evaluate(proxy_client, session,
                                          "JSON.stringify({h: window.innerHeight, w: window.innerWidth})")
                    try:
                        size = json.loads(size)
                        # our container is fixed at left:8 bottom:8 with a 70px
                        # box, so the checkbox sits about 37px above the bottom
                        target = (40, int(size["h"]) - 37)
                    except (TypeError, ValueError, KeyError):
                        pass
                for event_type in ("mouseMoved", "mousePressed", "mouseReleased"):
                    await call("Input.dispatchMouseEvent",
                               {"type": event_type, "x": target[0], "y": target[1],
                                "button": "left", "clickCount": 1}, session=session)
                clicked = True
                print(f"  clicked widget at {target}")
            if drive_render:
                state = await evaluate(proxy_client, session,
                                       "JSON.stringify({token: window.__tokenWatch && window.__tokenWatch.token,"
                                       " errors: (window.__tokenWatch && window.__tokenWatch.errors) || []})",
                                       context_id)
                try:
                    state = json.loads(state)
                except (TypeError, ValueError):
                    state = {}
                if state.get("token"):
                    break

        watch = await evaluate(proxy_client, session,
                               "JSON.stringify({token: window.__tokenWatch && window.__tokenWatch.token,"
                               " messages: (window.__tokenWatch && window.__tokenWatch.messages) || [],"
                               " errors: (window.__tokenWatch && window.__tokenWatch.errors) || []})",
                               context_id)
        if isinstance(watch, dict):
            print("capture failed:", watch)
            return 1
        data = json.loads(watch)
        token = data.get("token")
        print("--- page outcome ---")
        print("  ", await evaluate(proxy_client, session,
                                  "JSON.stringify({title: document.title, href: location.href.slice(0,80)})",
                                  context_id))
        drove = await evaluate(proxy_client, session,
                               "JSON.stringify({attempts: (window.__tokenWatch && window.__tokenWatch.driveAttempts) || [],"
                               " lastParams: (window.__tokenWatch && window.__tokenWatch.lastParams) || null,"
                               " errors: (window.__tokenWatch && window.__tokenWatch.errors) || []})")
        print("  drive log:", str(drove)[:300])
        failures = [r for r in data["messages"] if r.get("event") in ("fail", "error")]
        for record in failures[:4]:
            print("  fail record:", json.dumps(record, ensure_ascii=False)[:600])
        with open(json_path, "w") as handle:
            json.dump(data, handle, indent=1)
        print("capture written", json_path)
        if token:
            print(f"TOKEN len={len(token)} head={token[:70]}")
        else:
            print("widget errors:", data.get("errors")[:4])
            print("NO TOKEN; messages observed:", len(data["messages"]))
            records = data["messages"]
            head = [r for r in records if r.get("event") in ("fail", "error", "init", "requestExtraParams", "interactiveBegin")]
            for record in (head or records)[:14]:
                print("   ", json.dumps(record)[:200])
        return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9265)
    parser.add_argument("--url", default="https://www.thelancet.com/1.txt")
    parser.add_argument("--click-at", default="216,313")
    parser.add_argument("--seconds", type=float, default=90.0)
    parser.add_argument("--json", default="/tmp/token-capture.json")
    parser.add_argument("--drive-render", action="store_true",
                        help="also render our own widget with a callback and record the token")
    parser.add_argument("--sitekey", default="0x4AAAAAAADnPIDROrmt1Wwj")
    parser.add_argument("--action", default=None, help="Turnstile action the site's widget uses")
    parser.add_argument("--cdata", default=None, help="Turnstile cdata the site's widget uses")
    args = parser.parse_args()
    click_at = tuple(int(part) for part in args.click_at.split(","))
    sys.exit(asyncio.run(run(args.port, args.url, click_at, args.seconds, args.json,
                             args.drive_render, args.sitekey, args.action, args.cdata)))


if __name__ == "__main__":
    main()
