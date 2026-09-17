#!/usr/bin/env python3
"""Diff a Chromium `--enable-fingerprint-trace` stream against Obscura's
`--trace-api-file --trace-api-format jsonl` stream.

The two engines write different schemas for the same fact ("this realm touched
this API member, with these arguments, and got this value"):

  reference  fp-trace/v1: one `enter` and one `exit` record per blink call
             (paired by `callId`), plus one `point` record per v8-level
             property access; `api`, `args`, `result`, `receiver`, `realm`.
  obscura    dispatch contract: one record per access, `src` carries the
             operation and the definition/call-site halves, `from` carries the
             realm label.

Neither side can be diffed raw. Two normalizations make the comparison sound:

1. **Pair and flatten.** blink `enter`/`exit` collapse into one call record so a
   call is one row on both sides, like obscura's `--trace-api-calls`.
2. **Restrict to the reference's interface set.** The reference traces only
   accesses that resolve into blink/v8 (DOM, Web API, realm builtins), while
   obscura traces every statically named property access including plain JS
   objects. Comparing raw counts therefore compares "how much internal
   bookkeeping the page did", not the API surface. Interfaces the reference
   never names are dropped on both sides by default.

    fptrace_diff.py realms REF                      realm inventory
    fptrace_diff.py counts REF OURS [-n N]          per-API counts, both sides
    fptrace_diff.py missing REF OURS                APIs the reference used, we did not
    fptrace_diff.py values REF OURS --api X         value/argument distributions
    fptrace_diff.py trace REF --api X [--realm R]   print one side's records

`REF` is `renderer-trace.log` (FPTRACEJSON lines) or a `.json`. `OURS` is the
jsonl stream. Values are summarized, never evaluated: no getter runs here.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys

VALUE_LIMIT = 60

# `<op> <name> (<def>) <- <callsite>`; the definition half may be <native>.
SRC_RE = re.compile(r"^(get|set|call|new)\s+(.*?)\s+\((.*?)\)\s+<-\s+(.*)$")


def op_of(src: str) -> tuple[str, str]:
    """`(operation, Interface.member)` from an obscura `src` field."""
    m = SRC_RE.match(src or "")
    if not m:
        return "", ""
    return m.group(1), m.group(2)


def interface_of(api: str) -> str:
    """`Document.createElement` -> `Document`; `Object.prototype.hasOwnProperty`
    -> `Object.prototype`. Property reads on a prototype read
    `HTMLElement.style.get`, so a trailing `.get`/`.set` is stripped first."""
    name = api
    for suffix in (".get", ".set"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    head, _, _tail = name.rpartition(".")
    return head or name


def summarize_value(v, depth: int = 0) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        s = v if len(v) <= VALUE_LIMIT else v[:VALUE_LIMIT] + "…"
        return json.dumps(s, ensure_ascii=False)
    if isinstance(v, dict):
        if "type" in v:
            t = v.get("type")
            if t == "undefined":
                return "undefined"
            if "value" in v:
                return summarize_value(v["value"], depth + 1)
            if t == "function":
                return f"ƒ {v.get('name') or ''}".strip()
            itf = v.get("interface") or v.get("subtype") or v.get("type")
            return f"<{itf}>"
        if depth > 1:
            return "{…}"
        return "{" + ",".join(sorted(v)[:6]) + "}"
    if isinstance(v, list):
        if depth > 1:
            return "[…]"
        return "[" + ",".join(summarize_value(x, depth + 1) for x in v[:4]) + "]"
    return str(v)[:VALUE_LIMIT]


def _split_suffix(api: str) -> tuple[str, str]:
    """`Interface.member.get` -> (`Interface.member`, `get`).

    The reference names property reads and writes with a `.get`/`.set` suffix
    on both the blink and the v8 record paths; obscura carries the same
    distinction in `src` instead. Normalizing here is what makes the two
    name spaces comparable.
    """
    for suffix, op in ((".get", "get"), (".set", "set")):
        if api.endswith(suffix):
            return api[: -len(suffix)], op
    return api, ""


def ref_records(path: str):
    """Yield one normalized record per reference API access."""
    pending: dict[int, dict] = {}
    opener = open(path, "r", errors="replace")
    for line in opener:
        if not line.startswith("FPTRACEJSON "):
            continue
        try:
            fp = json.loads(line[12:]).get("fp") or {}
        except ValueError:
            continue
        raw_api = fp.get("api") or ""
        api, suffix_op = _split_suffix(raw_api)
        realm = fp.get("realm") or {}
        phase = fp.get("phase")
        source = fp.get("source")
        if phase == "enter":
            pending[fp.get("callId")] = fp
            continue
        if phase == "exit":
            enter = pending.pop(fp.get("callId"), None)
            if enter is None:
                continue
            yield {
                "src": source,
                "api": api,
                "op": suffix_op or ("call" if source == "blink" else "get"),
                "realm_kind": (enter.get("realm") or {}).get("kind", "?"),
                "realm_url": (enter.get("realm") or {}).get("url", ""),
                "args": [summarize_value(a) for a in (enter.get("args") or [])],
                "result": summarize_value(fp.get("result")),
                "error": fp.get("error"),
                "stack": (enter.get("stack") or [{}])[0].get("url", ""),
            }
            continue
        # point: a v8-level access with no blink call behind it
        yield {
            "src": source,
            "api": api,
            "op": suffix_op or "point",
            "realm_kind": realm.get("kind", "?"),
            "realm_url": realm.get("url", ""),
            "args": [summarize_value(a) for a in (fp.get("args") or [])],
            "result": summarize_value(fp.get("result")),
            "error": fp.get("error"),
            "stack": (fp.get("stack") or [{}])[0].get("url", ""),
        }


def our_records(path: str):
    opener = open(path, "r", errors="replace")
    for line in opener:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        frm = d.get("from") or ""
        op, name = op_of(d.get("src", ""))
        if not name:
            name = d.get("name") or ""
            op = op or "get"
        kind = "window"
        url = frm
        if frm.startswith("script@"):
            kind, url = "script", frm[len("script@"):]
        elif frm.startswith("iframe"):
            kind, url = "iframe", frm
        elif frm.startswith("worker"):
            kind, url = "worker", frm
        yield {
            "t": d.get("t"),
            "src": "obscura",
            "api": name,
            "op": op,
            "realm_kind": kind,
            "realm_url": url,
            "args": [summarize_value(a) for a in (d.get("args") or [])],
            "result": summarize_value(d.get("result")),
        }


def ref_interfaces(path: str, exclude_bootstrap: bool = True) -> set[str]:
    out: set[str] = set()
    for r in ref_records(path):
        api = r["api"]
        if not api or api.startswith("<"):
            continue
        if exclude_bootstrap and "obscura" in r["realm_url"]:
            continue
        out.add(interface_of(api))
    return out


def cmd_realms(args):
    kinds = collections.Counter()
    urls: dict[tuple[str, str], int] = collections.Counter()
    for r in ref_records(args.ref):
        kinds[r["realm_kind"]] += 1
        urls[(r["realm_kind"], r["realm_url"][:100])] += 1
    print("realm kinds:", dict(kinds))
    for (kind, url), n in urls.most_common(20):
        print(f"  {n:8d}  {kind:8s} {url}")


def load_ours(path: str, names: set[str]) -> collections.Counter:
    """Count our accesses, keeping only names the reference traced.

    Filtering by interface is not enough: the challenge VM reads obfuscated
    properties off plain objects (`Object.gA`), and those share the `Object`
    interface with real builtins. Only the reference's exact name space
    separates "an API the page touched" from "the VM going through its own
    bookkeeping".
    """
    ours: collections.Counter = collections.Counter()
    for r in our_records(path):
        if r["api"] in names:
            ours[r["api"]] += 1
    return ours


def cmd_counts(args):
    ref = collections.Counter()
    for r in ref_records(args.ref):
        ref[r["api"]] += 1
    ours = load_ours(args.ours, set(ref))
    print(f"{'ref':>9} {'ours':>9}  api")
    for api, n in ref.most_common(args.top):
        o = ours.get(api, 0)
        flag = "" if o else "   <-- MISSING"
        print(f"{n:9d} {o:9d}  {api}{flag}")
    print()
    print(f"names compared: {len(ref)}")
    print(f"reference accesses: {sum(ref.values())}, ours on those names: {sum(ours.values())}")


def cmd_missing(args):
    ref = collections.Counter()
    for r in ref_records(args.ref):
        ref[r["api"]] += 1
    ours = load_ours(args.ours, set(ref))
    missing = [(n, api) for api, n in ref.items() if ours.get(api, 0) == 0]
    missing.sort(reverse=True)
    print(f"{len(missing)} api(s) the reference exercised and we never did "
          f"(of {len(ref)}):")
    for n, api in missing[: args.limit]:
        print(f"  {n:8d}  {api}")


def cmd_values(args):
    def show(label, path, loader):
        dist = collections.Counter()
        for r in loader(path):
            if r["api"] != args.api:
                continue
            if args.realm and args.realm not in (r["realm_kind"] + " " + r["realm_url"]):
                continue
            dist[(tuple(r["args"]), r["result"])] += 1
        print(f"--- {label}: {sum(dist.values())} record(s), "
              f"{len(dist)} distinct (args -> result)")
        for (a, res), n in dist.most_common(args.top):
            print(f"  {n:8d}  ({', '.join(a)}) -> {res}")
    show("reference", args.ref, ref_records)
    if args.ours:
        show("ours", args.ours, our_records)


def cmd_trace(args):
    loader = ref_records if args.ref else our_records
    path = args.ref or args.ours
    shown = 0
    for r in loader(path):
        if args.api and args.api not in r["api"]:
            continue
        if args.realm:
            if args.realm not in (r["realm_kind"] + " " + r["realm_url"]):
                continue
        if args.op and r["op"] != args.op:
            continue
        print(f"{r.get('t', '')}\t{r['realm_kind'][:10]:10s}\t{r['op']:5s}\t"
              f"{r['api']:44s}\t({', '.join(r['args'])}) -> {r['result']}")
        shown += 1
        if args.limit and shown >= args.limit:
            break
    print(f"# {shown} record(s)", file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, need_ref=True, need_ours=False, optional_ours=False):
        if need_ref:
            sp.add_argument("ref")
        if need_ours:
            sp.add_argument("ours", nargs="?" if optional_ours else None)
        sp.add_argument("-n", "--top", type=int, default=40)

    sp = sub.add_parser("realms"); common(sp); sp.set_defaults(fn=cmd_realms)
    sp = sub.add_parser("counts"); common(sp, True, True); sp.set_defaults(fn=cmd_counts)
    sp = sub.add_parser("missing"); common(sp, True, True); sp.set_defaults(fn=cmd_missing)
    sp.add_argument("--limit", type=int, default=80)
    sp = sub.add_parser("values"); common(sp, True, True)
    sp.add_argument("--api", required=True); sp.add_argument("--realm")
    sp.set_defaults(fn=cmd_values)
    sp = sub.add_parser("trace"); common(sp, True, True, True)
    sp.add_argument("--api")
    sp.add_argument("--realm"); sp.add_argument("--op"); sp.add_argument("--limit", type=int, default=40)
    sp.set_defaults(fn=cmd_trace)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
