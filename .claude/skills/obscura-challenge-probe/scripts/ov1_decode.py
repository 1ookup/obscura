#!/usr/bin/env python3
"""HAR -> ov1/user bytecode, a local re-implementation of decode-ov1.mjs.

Only the published algorithm is used (decoder.mjs header, pristine:1859-1899):
  seed   Uk = 32 xor over charCodeAt of (rayId + "_0")
  stage1 = atob(responseText)
  out[i] = js_mod((255 & s1[i]) - Uk - (i % 65535) + 65535, 255)
  bytecode = atob(out)

Usage: ov1decode.py HAR [--outdir DIR]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys

RAY_FIELD = "TfPFa9"
FO_RE = re.compile(r"/cdn-cgi/challenge-platform/[^/]+/[^/]+/fo/")
BC_RE = re.compile(r"/cdn-cgi/challenge-platform/[^/]+/[^/]+/(?:pat|i|ci|av0)/([0-9a-f]{16})/")


def js_mod(a, m):
    """JS `%` (sign follows dividend)."""
    r = abs(a) % m
    return -r if a < 0 else r


def b64(s):
    s = "".join(s.split())
    pad = (-len(s)) % 4
    return base64.b64decode(s + "=" * pad)


def cf_chl_opt_blocks(html):
    """Yield (dict, index) for every `_cf_chl_opt = {...}` literal."""
    out = []
    for m in re.finditer(r"_cf_chl_opt\s*=\s*\{", html):
        i = m.end() - 1
        depth = 0
        quote = None
        esc = False
        while i < len(html):
            ch = html[i]
            if quote:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == quote:
                    quote = None
            else:
                if ch in "'\"`":
                    quote = ch
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        break
            i += 1
        body = html[m.end():i]
        opt = {}
        for km in re.finditer(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(['\"])((?:\\.|(?!\2).)*)\2", body):
            opt[km.group(1)] = km.group(3)
        out.append(opt)
    return out


def entry_text(e):
    content = (e.get("response") or {}).get("content") or {}
    text = content.get("text") or ""
    if content.get("encoding") == "base64" and text:
        try:
            text = base64.b64decode(text).decode("utf-8", "replace")
        except Exception:
            pass
    return text


def decode_one(resp_text, ray_id):
    seed = 32
    for ch in str(ray_id) + "_0":
        seed ^= ord(ch)
    seed &= 0xFF
    stage1 = b64(resp_text)
    n = len(stage1)
    out = bytearray(n)
    for i in range(n):
        inter = (255 & stage1[i]) - seed - (i % 65535) + 65535
        out[i] = js_mod(inter, 255) & 0xFF
    bytecode = b64(out.decode("latin-1"))
    return seed, stage1, bytes(out), bytecode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("har")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--label", default="our")
    a = ap.parse_args()

    with open(a.har, "rb") as f:
        har = json.load(f)
    entries = (har.get("log") or {}).get("entries") or []

    cfopts = []
    fo = []
    for idx, e in enumerate(entries):
        req = e.get("request") or {}
        url = req.get("url") or ""
        mime = ((e.get("response") or {}).get("content") or {}).get("mimeType") or ""
        text = entry_text(e)
        if "_cf_chl_opt" in text and "text/html" in mime:
            for opt in cf_chl_opt_blocks(text):
                cfopts.append((opt, idx, url))
        if FO_RE.search(url) and req.get("method") == "POST" and text:
            fo.append({
                "entry": idx, "url": url, "text": text,
                "len": len(text),
                "mime": mime,
                "started": e.get("startedDateTime") or "",
                "status": (e.get("response") or {}).get("status"),
            })
    fo.sort(key=lambda d: (d["started"], d["entry"]))

    print(f"HAR entries={len(entries)} cf_chl_opt_blocks={len(cfopts)} fo_POST_responses={len(fo)}")
    for opt, idx, url in cfopts:
        keys = sorted(opt.keys())
        print(f"  cf_chl_opt entry={idx} keys={len(keys)} TfPFa9={opt.get(RAY_FIELD)!r} url={url[:90]}")

    ray = None
    for opt, _, _ in cfopts:
        if RAY_FIELD in opt:
            ray = opt[RAY_FIELD]
            break
    if ray is None:
        print("!! no rayId field in any _cf_chl_opt block; cannot derive seed")
        for d in fo:
            print(f"  fo entry={d['entry']} chars={d['len']} {d['started']} {d['url'][:110]}")
        return 1
    print(f"rayId={ray}")

    if a.outdir:
        os.makedirs(a.outdir, exist_ok=True)
    rows = []
    for i, d in enumerate(fo):
        try:
            seed, stage1, stage2, bc = decode_one(d["text"], ray)
        except Exception as ex:
            print(f"fo#{i} entry={d['entry']} DECODE ERROR {ex}")
            continue
        md5 = hashlib.md5(bc).hexdigest()
        b64ish = sum(1 for c in stage2 if c in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
        print(f"fo#{i} entry={d['entry']} status={d['status']} resp_chars={d['len']} "
              f"stage1={len(stage1)}B stage2={len(stage2)}B b64frac={b64ish/max(1,len(stage2)):.3f} "
              f"bytecode={len(bc)}B md5={md5} {d['started']} {d['url'][:80]}")
        if a.outdir:
            p = os.path.join(a.outdir, f"{a.label}-{i}")
            open(p + "-stage1.bin", "wb").write(stage1)
            open(p + "-stage2.bin", "wb").write(stage2)
            open(p + "-bytecode.bin", "wb").write(bc)
            json.dump({"entry": d["entry"], "url": d["url"], "status": d["status"],
                       "started": d["started"], "rayId": ray, "seed": seed,
                       "resp_chars": d["len"], "stage1_len": len(stage1),
                       "stage2_len": len(stage2), "bytecode_len": len(bc), "md5": md5},
                      open(p + "-meta.json", "w"), indent=1)
        rows.append({"i": i, "entry": d["entry"], "bytecode": len(bc), "md5": md5,
                     "started": d["started"]})
    if a.outdir:
        json.dump(rows, open(os.path.join(a.outdir, f"{a.label}-summary.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
