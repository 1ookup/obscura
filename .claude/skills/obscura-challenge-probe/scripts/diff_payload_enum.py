#!/usr/bin/env python3
"""从 Chrome 解密 payload 提取 CF 读取的属性名清单，逐一 typeof 对拍 obscura。

加密的 fo 提交体无法直接 diff，但 Chrome 的**解密** payload（用 DevTools 在加密前
截下的 fo 对象）里，`fyCZH9` 桶表把「值 -> 属性路径」都列了出来。本脚本提取这份
清单，经 CDP 在 obscura 里逐个求 `typeof`，输出「缺失集合」与「值类型差异」。

属性路径前缀 → 宿主对象：
  n.  → navigator
  d.  → document
  s.  → screen
  so. → screen.orientation
  无前缀的裸标识符 → globalThis（window）
  o.  → widget 自己的混淆全局（CF 代码设的，obscura 不跑 CF 代码就没有，跳过）

用法：
  diff_payload_enum.py payload-2.json payload-3.json --port 9223
  diff_payload_enum.py payload-2.json --port 9223 --obj navigator

依赖 websockets（uv venv /tmp/probe-venv 里装好，见 SKILL.md 前置）。
"""
import argparse
import asyncio
import json
import re
import sys
import urllib.request

try:
    import websockets
except ImportError:
    sys.exit("pip3 install websockets")

# 各前缀对应的宿主对象表达式（在页面 realm 里可达）。
HOSTS = {
    "n": "navigator",
    "d": "document",
    "s": "screen",
    "so": "(screen.orientation || {})",
    "bare": "globalThis",
}

# navigator 上值得和 payload 值桶逐字对拍的关键属性。
KEY_NAV_FIELDS = [
    "vendor", "appCodeName", "appName", "appVersion", "platform", "product",
    "userAgent", "language", "languages", "hardwareConcurrency", "deviceMemory",
    "maxTouchPoints", "cookieEnabled", "onLine", "pdfViewerEnabled", "webdriver",
]

_IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")


def collect_fy(fy, paths):
    """把 fyCZH9 桶表里的每个字符串路径按前缀归类。"""
    for bucket, arr in fy.items():
        if not isinstance(arr, list):
            continue
        for item in arr:
            if not isinstance(item, str):
                continue
            for prefix in ("n.", "d.", "s.", "so.", "o."):
                if item.startswith(prefix):
                    paths[prefix.rstrip(".")].add(item[len(prefix):])
                    break
            else:
                # 无前缀的裸标识符是 window/globalThis 属性；跳过其它字符串值
                # （如 "Google Inc."、"Mozilla/5.0 ..."、"about:blank"）。
                if _IDENT.fullmatch(item):
                    paths["bare"].add(item)


def extract_paths(payload_files):
    paths = {"n": set(), "d": set(), "s": set(), "so": set(), "o": set(), "bare": set()}
    for fn in payload_files:
        with open(fn, encoding="utf-8") as f:
            data = json.load(f)

        def walk(node):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k == "fyCZH9" and isinstance(v, dict):
                        collect_fy(v, paths)
                    else:
                        walk(v)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(data)
    return paths


def endpoint_for(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    raw = opener.open("http://127.0.0.1:%d/json/version" % port, timeout=5).read()
    return json.loads(raw)["webSocketDebuggerUrl"]


def typeof_expr(host_expr, names):
    names_js = json.dumps(sorted(names))
    return (
        "JSON.stringify(Object.fromEntries(%s.map(function(p){"
        "var v; try { v = %s[p]; } catch (e) { v = 'THROW'; }"
        "return [p, typeof v];})))" % (names_js, host_expr)
    )


async def run(endpoint, paths, targets):
    async with websockets.connect(endpoint, max_size=16 * 1024 * 1024) as ws:
        n = [0]

        async def call(method, params=None, session=None):
            n[0] += 1
            mid = n[0]
            req = {"id": mid, "method": method, "params": params or {}}
            if session:
                req["sessionId"] = session
            await ws.send(json.dumps(req))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == mid:
                    return m

        r = await call("Target.createTarget", {"url": "about:blank"})
        tid = r["result"]["targetId"]
        r = await call("Target.attachToTarget", {"targetId": tid, "flatten": True})
        s = r["result"]["sessionId"]

        for key in targets:
            names = paths[key]
            if not names:
                continue
            label = {"n": "navigator", "d": "document", "s": "screen",
                     "so": "screen.orientation", "bare": "window/globalThis"}[key]
            r = await call("Runtime.evaluate",
                           {"expression": typeof_expr(HOSTS[key], names),
                            "returnByValue": True}, s)
            val = json.loads(r["result"]["result"]["value"])
            missing = [p for p, t in val.items() if t == "undefined"]
            throwing = [p for p, t in val.items() if t == "THROW"]
            present = [p for p, t in val.items() if t not in ("undefined", "THROW")]
            print("=== %s：Chrome 读 %d 个，obscura 缺失 %d，存在 %d%s ===" % (
                label, len(names), len(missing), len(present),
                ("，抛错 %d" % len(throwing)) if throwing else ""))
            if missing:
                print("  缺失（typeof undefined）: %s" % " ".join(sorted(missing)))
            if throwing:
                print("  抛错（宿主对象不可达）: %s" % " ".join(sorted(throwing)))
            if key == "n":
                # navigator 的关键值，便于和 payload 值桶逐字对拍。
                r = await call("Runtime.evaluate",
                               {"expression": "JSON.stringify(Object.fromEntries(%s.map(function(p){var v;try{v=navigator[p];}catch(e){v='THROW';}return [p, typeof v==='object'||typeof v==='function' ? typeof v : String(v)]; })))"
                                % json.dumps(KEY_NAV_FIELDS),
                                "returnByValue": True}, s)
                kv = json.loads(r["result"]["result"]["value"])
                print("  关键值: %s" % json.dumps(kv, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(description="从 Chrome payload 提取属性清单并对拍 obscura 枚举面")
    p.add_argument("payload", nargs="+", help="Chrome 解密 payload json（一个或多个）")
    p.add_argument("--port", type=int, default=9223)
    p.add_argument("--obj", default="all",
                   help="对拍对象：all / navigator / document / screen / orientation / window")
    a = p.parse_args()

    paths = extract_paths(a.payload)
    mapping = {"all": ["n", "d", "s", "so", "bare"],
               "navigator": ["n"], "document": ["d"], "screen": ["s"],
               "orientation": ["so"], "window": ["bare"]}
    targets = mapping.get(a.obj)
    if targets is None:
        sys.exit("--obj 必须是 %s" % " / ".join(mapping))

    print("payload 提取：n=%d d=%d s=%d so=%d bare=%d o(widget 跳过)=%d" % (
        len(paths["n"]), len(paths["d"]), len(paths["s"]),
        len(paths["so"]), len(paths["bare"]), len(paths["o"])))
    asyncio.run(run(endpoint_for(a.port), paths, targets))


if __name__ == "__main__":
    main()
