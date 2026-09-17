#!/usr/bin/env python3
"""Capture obscura's full CDP network sequence for a Cloudflare managed challenge.

Goal: produce the request/response evidence needed to answer "why does obscura
not get through, where exactly does its sequence diverge from Chrome's".

Method: drive a real CDP session -- Target.createTarget -> attach -> Network.enable
-> Page.navigate -- and record every Network.requestWillBeSent /
responseReceived / loadingFinished with headers. Zero injection during the
observation window: no Page.addScriptToEvaluateOnNewDocument, no
Runtime.evaluate until collection is over. A preload would change what the
challenge payload can see, which is exactly what we are trying to measure.

  ./cf_net_capture.py --port 9223 --wait 85 --out /tmp/cf-run/obscura-cdp-net.json

Assumes `obscura serve` is already listening, or pass --launch to start one with
the stealth/proxy/CA environment the challenge needs.

Known measurement blind spot, reported in the output: obscura populates the
request-side `headers` of its NetworkEvents with an empty map
(obscura-browser/src/page.rs, both NetworkEvent construction sites), so
Network.requestWillBeSent.request.headers is `{}` for every request. Request
headers (Cookie / Accept-Language / sec-ch-ua* / sec-fetch-*) therefore cannot
be read from CDP alone; this script records the fact and supplements with the
cookie jar (Network.getAllCookies) and response set-cookie headers instead.
"""
import argparse
import asyncio
import json
import os
import re
import signal
import sys
import time
from collections import OrderedDict
from urllib.parse import urlsplit

try:
    import websockets
except ImportError:
    sys.exit("websockets missing; use /tmp/probe-venv/bin/python (see SKILL.md)")

DEFAULT_URL = "https://www.thelancet.com/1.txt"
DEFAULT_PROXY = "http://192.168.3.57:9000"
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
DEFAULT_CA = "/tmp/reqable-ca.crt"
DEFAULT_HAR = "assets/har/chrome-2-fo.har"

# --- CDP plumbing -----------------------------------------------------------


class CDP:
    """One websocket, one reader task; requests resolve by id, everything else
    is appended to self.events in arrival order."""

    def __init__(self, ws):
        self.ws = ws
        self._next_id = 0
        self._pending = {}
        self._pump = None
        self.events = []

    async def start(self):
        self._pump = asyncio.create_task(self._run_pump())

    async def _run_pump(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self._pending.pop(msg["id"], None)
                    if fut is not None and not fut.done():
                        fut.set_result(msg)
                else:
                    self.events.append(msg)
        except Exception:  # socket closed / task cancelled
            pass

    async def call(self, method, params=None, session=None, timeout=30.0):
        self._next_id += 1
        rid = self._next_id
        req = {"id": rid, "method": method}
        if params is not None:
            req["params"] = params
        if session:
            req["sessionId"] = session
        fut = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        await self.ws.send(json.dumps(req))
        msg = await asyncio.wait_for(fut, timeout)
        if "error" in msg:
            raise RuntimeError("%s -> %s" % (method, msg["error"]))
        return msg.get("result", {})


# --- sequence classification -------------------------------------------------

FO_RE = re.compile(r"/h/g/fo/")
PAT_RE = re.compile(r"/h/g/pat/")
CI_RE = re.compile(r"/h/g/ci/")
RCH_RE = re.compile(r"/turnstile/f/av0/rch/")


def classify(url):
    """Collapse a token-bearing challenge URL to a stable step label, so an
    obscura sequence can be aligned with a Chrome HAR entry by step instead of
    by nonce."""
    parts = urlsplit(url)
    host, path = parts.netloc, parts.path
    low = url.lower()
    if path == "/1.txt" and "thelancet.com" in host:
        return "origin /1.txt (DOC)"
    if "orchestrate/chl_page" in low:
        return "orchestrate/chl_page"
    if "turnstile/v0/g" in low and "api.js" in low:
        return "turnstile api.js"
    if RCH_RE.search(url):
        return "turnstile rch (iframe)"
    if host.startswith("brunhild."):
        return "brunhild /g/i/"
    if FO_RE.search(url):
        return "fo (top)" if "thelancet.com" in host else "fo (widget)"
    if PAT_RE.search(url):
        return "pat"
    if CI_RE.search(url):
        return "ci"
    if "/cdn-cgi/challenge-platform" in path:
        return "cf-other"
    return "other %s%s" % (host, path)


def derive_requests(events):
    """Fold the raw event stream into one record per requestId."""
    reqs = OrderedDict()
    order = []
    for msg in events:
        method = msg.get("method")
        if not method or not method.startswith("Network."):
            continue
        p = msg.get("params") or {}
        rid = p.get("requestId")
        if rid is None:
            continue
        if rid not in reqs:
            reqs[rid] = {"requestId": rid, "sessionId": msg.get("sessionId"),
                         "sent": None, "response": None, "finished": None,
                         "type": None, "frameId": None}
            order.append(rid)
        rec = reqs[rid]
        if method == "Network.requestWillBeSent":
            rec["sent"] = p
            rec["type"] = p.get("type")
            rec["frameId"] = p.get("frameId")
            req = p.get("request") or {}
            rec["url"] = req.get("url")
            rec["method"] = req.get("method")
            rec["requestHeaders"] = req.get("headers") or {}
        elif method == "Network.responseReceived":
            rec["response"] = p
            resp = p.get("response") or {}
            rec["status"] = resp.get("status")
            rec["responseHeaders"] = resp.get("headers") or {}
        elif method == "Network.loadingFinished":
            rec["finished"] = p
            rec["encodedDataLength"] = p.get("encodedDataLength")
    return [reqs[r] for r in order]


def summarize(recs):
    """One human line per request: status, method, step label, url."""
    rows = []
    for r in recs:
        rows.append({
            "status": r.get("status"),
            "method": r.get("method") or "?",
            "step": classify(r.get("url") or ""),
            "type": r.get("type"),
            "url": r.get("url"),
            "requestId": r.get("requestId"),
        })
    return rows


# --- capture ----------------------------------------------------------------


async def capture(port, url, wait, out_path, read_state, log, drain=8, probe_bodies=14):
    endpoint = "ws://127.0.0.1:%d/devtools/browser" % port
    async with websockets.connect(endpoint, max_size=128 * 1024 * 1024,
                                  open_timeout=20) as ws:
        cdp = CDP(ws)
        await cdp.start()

        target = (await cdp.call("Target.createTarget", {"url": "about:blank"}))["targetId"]
        session = (await cdp.call("Target.attachToTarget",
                                  {"targetId": target, "flatten": True}))["sessionId"]
        log("target=%s session=%s" % (target, session))

        await cdp.call("Page.enable", session=session)
        await cdp.call("Network.enable", session=session)
        await cdp.call("Network.setCacheDisabled", {"cacheDisabled": True}, session=session)
        # Runtime.enable is not an injection: it only turns on console/exception
        # events. No Runtime.evaluate runs until the window below has closed.
        await cdp.call("Runtime.enable", session=session)

        t0 = time.time()
        await cdp.call("Page.navigate", {"url": url}, session=session)
        log("navigated at t=0; observing %ss with zero injection" % wait)

        # Observation window. Events land in cdp.events via the reader task.
        deadline = t0 + wait
        while time.time() < deadline:
            await asyncio.sleep(1.0)
            n = len([e for e in cdp.events
                     if e.get("method") == "Network.requestWillBeSent"])
            if int(deadline - time.time()) % 10 == 0:
                log("  t=%3ds requests=%d" % (int(time.time() - t0), n))

        # Post-window flush. Receiving a CDP message is what re-arms obscura's
        # autonomous page-event-loop pump, and that pump is also what drains
        # script-initiated fetch/XHR network events into CDP (server.rs
        # sync_live_page_network_events). Poke with a harmless read-only
        # command a few times so any JS-side request events reach us before the
        # snapshot; without this the capture can miss every fetch() the
        # challenge made. Not an injection: no evaluate, no page script.
        for _ in range(drain):
            try:
                await cdp.call("Network.getAllCookies", session=session)
            except Exception:
                pass
            await asyncio.sleep(1.0)
        log("post-window flush done (%ds); capturing page state" % drain)

        # Collection is over; only now may we touch the page.
        page_state = {}
        if read_state:
            expr = (
                "(function(){try{return JSON.stringify({"
                "href:location.href,readyState:document.readyState,"
                "title:document.title,"
                "body:(document.body&&document.body.innerText||'').slice(0,600),"
                "htmlLen:(document.documentElement&&document.documentElement.outerHTML||'').length,"
                # Frame realm shape. A cross-origin iframe must throw on
                # contentWindow.location access; if it is readable the realm
                # boundary collapsed and widget JS ran with the top origin.
                "frames:[].map.call(document.querySelectorAll('iframe'),function(f){"
                "var o={src:String(f.getAttribute('src')||'').slice(0,120),"
                "connected:f.isConnected,hasContentWindow:!!f.contentWindow};"
                "try{o.cwHref=String(f.contentWindow.location.href).slice(0,120);"
                "o.realmBoundary='READABLE(leak!)';}"
                "catch(e){o.realmBoundary='throws(correct): '+String(e.name);}"
                "try{o.cwOrigin=String(f.contentWindow.origin).slice(0,80);}"
                "catch(e){o.cwOrigin='throws';}"
                "try{o.hasSrcdoc=!!f.srcdoc;}catch(e){}"
                "return o;})"
                "});}catch(e){return JSON.stringify({error:String(e)});}})()"
            )
            res = await cdp.call("Runtime.evaluate",
                                 {"expression": expr, "returnByValue": True},
                                 session=session)
            value = (res.get("result") or {}).get("value")
            try:
                page_state = json.loads(value) if value else {"raw": res}
            except Exception:
                page_state = {"raw": res}

        # Script-initiated fetches never surface as Network events through
        # obscura's CDP, but their response bodies are still stored under the
        # `fetch-{N}` ids the JS runtime assigns in call order. Probing those
        # ids directly recovers what the challenge server actually answered,
        # which the request sequence alone cannot tell us.
        bodies = {}
        for n in range(1, probe_bodies + 1):
            rid = "fetch-%d" % n
            try:
                resp = await cdp.call("Network.getResponseBody",
                                      {"requestId": rid}, session=session, timeout=10)
                body = resp.get("body", "")
                bodies[rid] = {"len": len(body),
                               "base64Encoded": resp.get("base64Encoded"),
                               "body": body[:4000]}
            except Exception as exc:
                bodies[rid] = {"error": str(exc)[:160]}

        # Cookie jar reflects what a Cookie header would carry (the request
        # headers themselves are not observable through obscura's CDP).
        cookies = None
        try:
            cookies = await cdp.call("Network.getAllCookies", session=session)
        except Exception as exc:
            cookies = {"error": str(exc)}

        frames = []
        for e in cdp.events:
            if e.get("method") == "Page.frameNavigated":
                f = (e.get("params") or {}).get("frame") or {}
                frames.append({"url": f.get("url"), "parentId": f.get("parentId"),
                               "loaderId": f.get("loaderId")})

        reqs = derive_requests(cdp.events)
        navigations = [r for r in reqs if r.get("type") == "Document"]

        result = {
            "meta": {
                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "targetUrl": url,
                "port": port,
                "observationSeconds": wait,
                "postWindowFlushSeconds": drain,
                "injection": "none (no addScriptToEvaluateOnNewDocument; "
                             "Runtime.evaluate only after the window closed)",
                "runtimeEnabled": True,
                "note_request_headers": (
                    "obscura populates NetworkEvent.headers with an empty map, so "
                    "requestWillBeSent.request.headers is {} for every request; "
                    "request-side Cookie/Accept-Language/sec-ch-ua are NOT "
                    "observable via obscura CDP"),
            },
            "totals": {
                "requests": len(reqs),
                "events": len(cdp.events),
                "documentNavigations": len(navigations),
                "responses": len([r for r in reqs if r.get("status") is not None]),
            },
            "sequence": summarize(reqs),
            "navigations": [{"url": r.get("url"), "method": r.get("method"),
                             "status": r.get("status"),
                             "frameId": r.get("frameId"),
                             "requestId": r.get("requestId")} for r in navigations],
            "frameNavigated": frames,
            "pageState": page_state,
            "jsFetchBodies": bodies,
            "cookies": cookies,
            "requests": reqs,
            "events": cdp.events,
        }

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        # The challenge flow is nondeterministic run to run; keep every capture
        # so a stalled run cannot overwrite a complete one.
        stamp = time.strftime("%Y%m%d-%H%M%S")
        sidecar = "%s.run-%s" % (out_path, stamp)
        result["meta"]["sidecar"] = sidecar
        for path in (out_path, sidecar):
            with open(path, "w") as fh:
                json.dump(result, fh, indent=1)
        return result


# --- reporting ---------------------------------------------------------------


def load_har(path):
    with open(path) as fh:
        har = json.load(fh)
    out = []
    for e in har["log"]["entries"]:
        req, resp = e["request"], e["response"]
        out.append({"status": resp["status"], "method": req["method"],
                    "url": req["url"], "step": classify(req["url"]),
                    "requestHeaders": {h["name"]: h["value"] for h in req.get("headers", [])},
                    "responseHeaders": {h["name"]: h["value"] for h in resp.get("headers", [])}})
    return out


def print_table(title, rows):
    print("\n== %s ==" % title)
    print("  #  status  method  step                          url")
    for i, r in enumerate(rows, 1):
        print(" %2d  %6s  %-6s  %-28s  %s" % (
            i, r.get("status") if r.get("status") is not None else "----",
            r["method"], r["step"][:28], (r.get("url") or "")[:110]))


def print_diff(obscura_rows, har_rows):
    print("\n== step alignment: Chrome HAR vs obscura ==")
    obs_by_step = OrderedDict()
    for r in obscura_rows:
        obs_by_step.setdefault(r["step"], []).append(r)
    har_by_step = OrderedDict()
    for r in har_rows:
        har_by_step.setdefault(r["step"], []).append(r)

    print("  Chrome-only (missing in obscura):")
    any_missing = False
    for step, rs in har_by_step.items():
        have = len(obs_by_step.get(step, []))
        if have < len(rs):
            any_missing = True
            for r in rs[have:]:
                print("    - [%s] %s %s" % (r["status"], r["method"], r["url"][:110]))
    if not any_missing:
        print("    (none)")
    print("  obscura extras (not in Chrome HAR):")
    extras = False
    for step, rs in obs_by_step.items():
        have = len(har_by_step.get(step, []))
        if len(rs) > have:
            extras = True
            for r in rs[have:]:
                print("    + [%s] %s %s" % (r["status"], r["method"], r["url"][:110]))
    if not extras:
        print("    (none)")

    print("  per-step status side by side:")
    for step in list(dict.fromkeys(list(har_by_step) + list(obs_by_step))):
        h = har_by_step.get(step, [])
        o = obs_by_step.get(step, [])
        hs = ",".join(str(x["status"]) for x in h) or "-"
        os_ = ",".join(str(x["status"]) for x in o) or "-"
        flag = "" if hs == os_ else "   <-- DIFF"
        print("    %-28s chrome=[%s] obscura=[%s]%s" % (step[:28], hs, os_, flag))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=9223)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--wait", type=float, default=85.0,
                    help="observation seconds with zero injection (default 85)")
    ap.add_argument("--out", default="/tmp/cf-run/obscura-cdp-net.json")
    ap.add_argument("--har", default=DEFAULT_HAR,
                    help="Chrome reference HAR to diff against ('' to skip)")
    ap.add_argument("--drain", type=int, default=8,
                    help="post-window flush seconds; each poke re-arms obscura's "
                         "event-loop pump so pending JS fetch events reach CDP "
                         "(0 disables)")
    ap.add_argument("--bodies", type=int, default=14,
                    help="probe Network.getResponseBody for fetch-1..fetch-N "
                         "(JS fetches CDP never announced); 0 disables")
    ap.add_argument("--no-state", action="store_true",
                    help="skip the post-capture Runtime.evaluate page read")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    def log(m):
        if not args.quiet:
            print("[cap %s] %s" % (time.strftime("%H:%M:%S"), m), flush=True)

    result = asyncio.run(capture(args.port, args.url, args.wait, args.out,
                                 not args.no_state, log, drain=args.drain,
                                 probe_bodies=args.bodies))

    size = os.path.getsize(args.out)
    print("\nwrote %s (%d bytes, %.1f KB)" % (args.out, size, size / 1024))
    print("requests=%d events=%d documentNavigations=%d" % (
        result["totals"]["requests"], result["totals"]["events"],
        result["totals"]["documentNavigations"]))

    print_table("obscura CDP sequence", result["sequence"])

    print("\n== navigations (Document requests) ==")
    for n in result["navigations"]:
        print("  %s %s -> %s" % (n["method"], n["url"], n["status"]))
    if not result["navigations"]:
        print("  none recorded")
    print("== Page.frameNavigated ==")
    for f in result["frameNavigated"]:
        print("  %s" % f["url"])

    print("\n== final page state ==")
    print(json.dumps(result["pageState"], indent=1, ensure_ascii=False)[:1500])

    print("\n== request headers as seen through obscura CDP (sample) ==")
    for r in result["requests"][:4]:
        print("  %s %s -> %s" % (r.get("method"), (r.get("url") or "")[:80],
                                 r.get("requestHeaders")))

    bodies = result.get("jsFetchBodies") or {}
    if bodies:
        print("\n== script fetch bodies recovered via Network.getResponseBody ==")
        for rid, b in bodies.items():
            if "error" in b:
                print("  %-8s %s" % (rid, b["error"]))
            else:
                print("  %-8s len=%-6d %s" % (rid, b["len"],
                                              b["body"][:160].replace("\n", " ")))

    cookies = result.get("cookies") or {}
    cls = (cookies.get("cookies") if isinstance(cookies, dict) else None) or []
    print("\n== cookie jar after run (%d cookies) ==" % len(cls))
    for c in cls:
        name = c.get("name")
        if name in ("cf_clearance", "cf_chl_2", "cf_chl_rc_ni", "__cf_bm", "cf_chl_rc_m"):
            print("  %s domain=%s path=%s expires=%s secure=%s httpOnly=%s" % (
                name, c.get("domain"), c.get("path"), c.get("expires"),
                c.get("secure"), c.get("httpOnly")))
    names = sorted({c.get("name") for c in cls})
    print("  all names: %s" % ", ".join(n for n in names if n))

    if args.har and os.path.exists(args.har):
        try:
            har_rows = load_har(args.har)
            print_table("Chrome HAR reference sequence", har_rows)
            print_diff(result["sequence"], har_rows)
            print("\n== key request headers (Chrome HAR, for reference) ==")
            for r in har_rows:
                if r["step"] in ("origin /1.txt (DOC)", "fo (top)", "fo (widget)",
                                 "orchestrate/chl_page"):
                    rh = r["requestHeaders"]
                    keep = {k: rh[k] for k in rh if k.lower() in (
                        "cookie", "accept-language", "user-agent", "origin",
                        "content-type", "accept", "referer", "sec-ch-ua",
                        "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-fetch-site",
                        "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user",
                        "cf-chl", "priority")}
                    print("  [%s] %s %s" % (r["status"], r["method"], r["step"]))
                    for k, v in keep.items():
                        print("      %s: %s" % (k, str(v)[:160]))
        except Exception as exc:
            print("HAR diff failed: %s" % exc)
    elif args.har:
        print("\n(no HAR at %s; skipped diff)" % args.har)


if __name__ == "__main__":
    main()
