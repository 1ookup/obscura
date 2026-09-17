#!/usr/bin/env python3
"""Segment a tracelog stream into challenge rounds and diff two of them.

The tracelog is one flat file: a page that is re-challenged appends a whole new
round of VM records, and the isolate's own startup records are indistinguishable
from a round's. Comparing totals therefore compares *how many rounds happened*
rather than what the engines did. This tool splits a stream where the records
skip in time (`--gap`), which is what separates rounds and sessions, then
compares one round against another by phase:

  segments FILE                     one line per fragment
  compare REF OURS [--ref-frag N]   phase and key-level diff of two rounds
  toString FILE [FILE...]           every Function.prototype.toString probe CF
                                    made, grouped by the member it probed

The reference stream comes from the instrumented build; a new run of the engine
under test only has to be *the same round*, which is what `segments` is for.
See docs/native-trace.md for the stream's own contract.
"""
import argparse
import collections
import json
import re
import sys

GAP_US = 2_000_000
PHASE_FAMILIES = (
    ("setup", None),         # ov2.boot.*, ov2.bc.*, ov2.h.globalThis
    ("dispatch", None),      # ov2.disp.*
    ("handlers", None),      # ov2.h.*
    ("host ops", None),      # ov2.host.*
    ("z.load", None),        # ov2.z.*
    ("payload", None),       # ov2.payload.*
    ("frame", None),         # ov2.frame*
    ("recovery", None),      # ov2.recov.*
)


def family(key):
    if key.startswith(("ov2.boot.", "ov2.bc.")) or key == "ov2.h.globalThis":
        return "setup"
    if key.startswith("ov2.recov."):
        return "recovery"
    if key.startswith("ov2.disp."):
        return "dispatch"
    if key.startswith("ov2.h."):
        return "handlers"
    if key.startswith("ov2.host."):
        return "host ops"
    if key.startswith("ov2.z."):
        return "z.load"
    if key.startswith("ov2.payload."):
        return "payload"
    if key.startswith("ov2.frame"):
        return "frame"
    return "other"


def records(path):
    with open(path, errors="replace") as handle:
        for raw in handle:
            if '"k":"' not in raw:
                continue
            try:
                yield json.loads(raw), len(raw)
            except ValueError:
                continue


def segments(path, gap_us=GAP_US):
    """Split a stream where the records skip forward in time.

    Every isolate (document, frames, workers) flushes its own batches, so a
    stream interleaves stamps that go backwards. Only a *forward* jump past
    `gap_us` starts a new round; a backwards stamp is just another writer and
    stays in the round it belongs to. `end` is therefore the high-water mark,
    not the last record's stamp.
    """
    out = []
    current = None
    high = 0
    for record, size in records(path):
        stamp = record.get("t", 0)
        if current is None or stamp - high > gap_us:
            if current:
                out.append(current)
            current = dict(start=stamp, high=stamp, count=0, bytes=0,
                           keys=collections.Counter(), first=[])
            high = stamp
        high = max(high, stamp)
        current["high"] = high
        current["count"] += 1
        current["bytes"] += size
        key = record.get("k", "?")
        current["keys"][key] += 1
        if len(current["first"]) < 4:
            current["first"].append(key)
    if current:
        out.append(current)
    return out


def round_summary(fragment):
    span = (fragment["high"] - fragment["start"]) / 1e6
    loop2 = fragment["keys"].get("ov2.disp.loop2", 0) or fragment["keys"].get("ov2.disp.l2", 0)
    return dict(
        records=fragment["count"],
        bytes=fragment["bytes"],
        span=span,
        bytes_per_record=fragment["bytes"] / max(fragment["count"], 1),
        loop2=loop2,
        loop2_per_s=loop2 / span if span > 0 else 0.0,
        vm_instances=fragment["keys"].get("ov2.ctor.dump", 0) or fragment["keys"].get("ov2.boot.dump", 0),
        sends=fragment["keys"].get("ov2.payload.send", 0) + fragment["keys"].get("ov2.payload.send2", 0),
        keymat=fragment["keys"].get("ov2.payload.keymat", 0),
        first=fragment["first"],
    )


def collect(path, gap_seconds=GAP_US / 1e6, min_records=200):
    """Fragments big enough to be a round, largest first. `gap_seconds` is the
    silence that separates two rounds; stamps are microseconds, so it is scaled
    here rather than at each comparison."""
    fragments = [f for f in segments(path, gap_seconds * 1e6) if f["count"] >= min_records]
    return sorted(fragments, key=lambda f: -f["count"])


def compare(path):
    """(key counts, byte counts) before and after the first payload submission."""
    pre, post = collections.Counter(), collections.Counter()
    pre_keys, post_keys = collections.Counter(), collections.Counter()
    sent = False
    for record, size in records(path):
        key = record.get("k", "?")
        target = post if sent else pre
        target[family(key)] += 1
        (post_keys if sent else pre_keys)[key] += 1
        if key == "ov2.payload.send":
            sent = True
    return pre, post, pre_keys, post_keys


def pc_profile(path):
    """What the interpreter spent the post-submission phase on."""
    pcs, ops = collections.Counter(), collections.Counter()
    sent = False
    max_pc = 0
    for record, _ in records(path):
        key = record.get("k")
        if key in ("ov2.payload.send", "ov2.payload.send2"):
            sent = True
            continue
        if key not in ("ov2.disp.loop2", "ov2.disp.l2", "ov2.disp.l1", "ov2.disp.loop1") or not sent:
            continue
        value = record.get("v") or {}
        if isinstance(value.get("pc"), int):
            pcs[value["pc"]] += 1
            max_pc = max(max_pc, value["pc"])
        if value.get("op") is not None:
            ops[value["op"]] += 1
    return pcs, ops, max_pc


def native_probes(path):
    """member -> set of Function.prototype.toString answers CF received.

    `ov2.host.tostring` records the member the challenge asked about (`recv`)
    and what came back. A member whose answer is not `[native code]` for a
    builtin is the engine's own JS source, which no browser exposes.
    """
    answers = collections.defaultdict(collections.Counter)
    for record, _ in records(path):
        if record.get("k") != "ov2.host.tostring":
            continue
        value = record.get("v") or {}
        recv = value.get("recv")
        if isinstance(recv, str) and recv.startswith("fn:"):
            answers[recv[3:]][str(value.get("result"))[:60]] += 1
    return answers


def environment_reads(path):
    reads = collections.Counter()
    for record, _ in records(path):
        if record.get("k") != "ov2.host.ua":
            continue
        value = record.get("v") or {}
        reads[json.dumps(value, sort_keys=True)] += 1
    return reads



# --- value-level comparison -------------------------------------------------
#
# Name parity is only half of a trace diff: two engines can probe the same key
# and answer a value of the same shape while differing in the value itself, or
# answer the same value in a different format. `values` classifies both.

def value_class(value):
    """A coarse format fingerprint: what kind of thing the value is."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "num"
    if isinstance(value, list):
        return f"arr[{len(value)}]"
    if isinstance(value, dict):
        return "obj{" + ",".join(sorted(value.keys())[:6]) + "}"
    if isinstance(value, str):
        text = value
        if text == "":
            return "str[0]"
        if text.isdigit():
            return f"digits[{len(text)}]"
        if all(c in "0123456789abcdefABCDEF" for c in text) and len(text) >= 8:
            return f"hex[{len(text)}]"
        if text.startswith(("http://", "https://")):
            return f"url[{len(text)}]"
        if "," in text and text.count(",") == text.count("-") + 1 and len(text) == 36:
            return "uuid"
        if text[:1] in "[{" and text[-1:] in "]}":
            return f"json[{len(text)}]"
        alphabet = set(text)
        if alphabet <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=._-") and len(text) >= 16:
            return f"token[{len(text)}]"
        return f"str[{len(text)}]"
    return type(value).__name__


def value_samples(path, limit=4):
    """key -> (count, ordered distinct values, sample) for every record value."""
    table = {}
    for record, _ in records(path):
        key = record.get("k")
        if not isinstance(key, str):
            continue
        entry = table.setdefault(key, {"count": 0, "values": [], "seen": set(), "samples": []})
        entry["count"] += 1
        value = record.get("v")
        compact = json.dumps(value, sort_keys=True, ensure_ascii=False)
        if compact not in entry["seen"]:
            entry["seen"].add(compact)
            if len(entry["samples"]) < limit:
                entry["samples"].append(value)
        entry["values"].append(value_class(value))
    return table


def cmd_values(args):
    ref = value_samples(args.reference)
    ours = value_samples(args.ours)
    equal, varying, reformat, missing, extra = [], [], [], [], []
    for key in sorted(set(ref) | set(ours)):
        a, b = ref.get(key), ours.get(key)
        if a is None:
            extra.append((key, b))
            continue
        if b is None:
            missing.append((key, a))
            continue
        set_a = {json.dumps(v, sort_keys=True, ensure_ascii=False) for v in a["samples"]}
        set_b = {json.dumps(v, sort_keys=True, ensure_ascii=False) for v in b["samples"]}
        class_a = sorted(set(a["values"]))
        class_b = sorted(set(b["values"]))
        if set_a == set_b:
            equal.append((key, a, b))
        elif class_a == class_b:
            varying.append((key, a, b))
        else:
            reformat.append((key, a, b))
    print(f"keys: reference {len(ref)}, ours {len(ours)}")
    print(f"  value-equal        {len(equal)}")
    print(f"  same format, value differs (session-varying) {len(varying)}")
    print(f"  FORMAT DIFFERS      {len(reformat)}")
    print(f"  only in reference   {len(missing)}")
    print(f"  only in ours        {len(extra)}")

    def show(entry, limit=110):
        return json.dumps(entry["samples"][:2], ensure_ascii=False)[:limit]

    if reformat:
        print("\nformat differences (value class per side):")
        for key, a, b in sorted(reformat, key=lambda row: -(row[1]["count"] + row[2]["count"]))[:args.top]:
            print(f"  {key:26} ref={sorted(set(a['values']))[:3]} ours={sorted(set(b['values']))[:3]}")
            print(f"      ref  {show(a)}")
            print(f"      ours {show(b)}")
    if missing:
        print("\nonly in the reference:")
        for key, entry in sorted(missing, key=lambda row: -row[1]["count"])[:args.top]:
            print(f"  {key:26} n={entry['count']:<7} {show(entry, 90)}")
    if extra:
        print("\nonly in ours:")
        for key, entry in sorted(extra, key=lambda row: -row[1]["count"])[:args.top]:
            print(f"  {key:26} n={entry['count']:<7} {show(entry, 90)}")
    if varying:
        print("\nsame format, session-varying values (first few):")
        for key, a, b in sorted(varying, key=lambda row: -(row[1]["count"] + row[2]["count"]))[:min(args.top, 8)]:
            print(f"  {key:26} {sorted(set(a['values']))[:2]}")
            print(f"      ref  {show(a, 90)}")
            print(f"      ours {show(b, 90)}")



SESSION_VARYING = re.compile(r"\d+|\b[0-9a-fA-F]{8,}\b|[A-Za-z0-9+/=_.-]{24,}")


def mask(value):
    """Blank the parts that legitimately differ per session (rays, clocks, ids).

    Two engines in the same round should agree on everything else, so a masked
    mismatch is a real divergence while an unmasked one is usually noise.
    """
    if isinstance(value, str):
        return SESSION_VARYING.sub("#", value)
    if isinstance(value, list):
        return [mask(item) for item in value]
    if isinstance(value, dict):
        return {key: mask(item) for key, item in value.items()}
    return value


def sequence(path, key_filter="ov2."):
    """key -> list of masked values, in record order."""
    sequences = {}
    for record, _ in records(path):
        key = record.get("k")
        if not isinstance(key, str) or not key.startswith(key_filter):
            continue
        sequences.setdefault(key, []).append(
            json.dumps(mask(record.get("v")), sort_keys=True, ensure_ascii=False))
    return sequences


def cmd_diverge(args):
    ref = sequence(args.reference)
    ours = sequence(args.ours)
    rows = []
    for key in sorted(set(ref) & set(ours)):
        left, right = ref[key], ours[key]
        for index, (a, b) in enumerate(zip(left, right)):
            if a != b:
                rows.append((index, key, a, b))
                break
    identical = [key for key in set(ref) & set(ours) if ref[key] == ours[key]]
    print(f"keys compared {len(set(ref) & set(ours))}: sequences identical {len(identical)}, "
          f"first-value divergence {len(rows)}")
    if not rows:
        print("no value divergence under masking")
        return
    print("\nearliest value divergences (masked; # = session-varying part):")
    for index, key, a, b in sorted(rows)[:args.top]:
        print(f"  [{index:>5}] {key}")
        print(f"        ref  {a[:150]}")
        print(f"        ours {b[:150]}")


def cmd_segments(args):
    for label, path in (("REFERENCE", args.reference), ("OURS", args.ours)):
        print("=" * 12, label, path)
        fragments = collect(path, args.gap, args.min_records)
        print(f'  {"frag":>4} {"records":>9} {"MB":>7} {"span":>8} {"B/rec":>6} '
              f'{"loop2":>8} {"loop2/s":>8} {"VM":>3} {"send":>4}  first keys')
        for index, fragment in enumerate(fragments, 1):
            summary = round_summary(fragment)
            print(f'  {index:>4} {summary["records"]:>9} {summary["bytes"]/1e6:>7.1f} '
                  f'{summary["span"]:>7.1f}s {summary["bytes_per_record"]:>6.1f} '
                  f'{summary["loop2"]:>8} {summary["loop2_per_s"]:>8.0f} '
                  f'{summary["vm_instances"]:>3} {summary["sends"]:>4}  {summary["first"][:3]}')
        print()


def cmd_compare(args):
    ref = collect(args.reference, args.gap, args.min_records)[args.ref_frag - 1]
    our = collect(args.ours, args.gap, args.min_records)[args.our_frag - 1]
    ref_path, our_path = args.reference, args.ours
    print(f'reference round {args.ref_frag}: {round_summary(ref)}')
    print(f'ours      round {args.our_frag}: {round_summary(our)}')
    print()

    ref_pre, ref_post, ref_prek, ref_postk = compare(ref_path)
    our_pre, our_post, our_prek, our_postk = compare(our_path)
    print(f'{"phase":10} {"family":10} {"ref pre":>8} {"our pre":>8} | {"ref post":>9} {"our post":>9}')
    for name in [f[0] for f in PHASE_FAMILIES] + ["other"]:
        print(f'{"":10} {name:10} {ref_pre[name]:>8} {our_pre[name]:>8} | '
              f'{ref_post[name]:>9} {our_post[name]:>9}')
    print()

    print("key-level deltas, post-submission (ours minus reference):")
    rows = []
    for key in set(ref_postk) | set(our_postk):
        delta = our_postk[key] - ref_postk[key]
        if abs(delta) >= args.threshold:
            rows.append((delta, key, ref_postk[key], our_postk[key]))
    for delta, key, a, b in sorted(rows, key=lambda r: -abs(r[0]))[:args.top]:
        print(f'  {key:26} ref={a:>8} ours={b:>8} {delta:+9}')
    print()

    ref_pcs, ref_ops, ref_max = pc_profile(ref_path)
    our_pcs, our_ops, our_max = pc_profile(our_path)
    print(f'post-submission interpreter: distinct pc ref={len(ref_pcs)} ours={len(our_pcs)}  '
          f'max pc ref={ref_max} ours={our_max}')
    print(f'  ref top pc: {ref_pcs.most_common(4)}')
    print(f'  our top pc: {our_pcs.most_common(4)}')
    print(f'  ref top op: {ref_ops.most_common(6)}')
    print(f'  our top op: {our_ops.most_common(6)}')
    print()

    ref_native, our_native = native_probes(ref_path), native_probes(our_path)
    print("toString probes that did NOT answer [native code]:")
    for label, probes in (("ref", ref_native), ("ours", our_native)):
        bad = {name: dict(answers) for name, answers in probes.items()
               if not all("native code" in answer for answer in answers)}
        print(f'  {label}: {len(bad)} of {len(probes)} probed members')
        for name, answers in sorted(bad.items())[:args.top]:
            preview = sorted(answers.items(), key=lambda kv: -kv[1])[0]
            print(f'     {name:24} -> {preview[0][:88]}  (x{preview[1]})')
    print()

    ref_env, our_env = environment_reads(ref_path), environment_reads(our_path)
    print("environment reads (ov2.host.ua):")
    for label, reads in (("ref", ref_env), ("ours", our_env)):
        print(f'  {label}: {sorted(reads)}')


def cmd_tostring(args):
    for path in args.files:
        print("=" * 12, path)
        probes = native_probes(path)
        bad = {name: dict(answers) for name, answers in probes.items()
               if not all("native code" in answer for answer in answers)}
        print(f'  probed members: {len(probes)}, non-native: {len(bad)}')
        for name, answers in sorted(bad.items()):
            preview = sorted(answers.items(), key=lambda kv: -kv[1])[0]
            print(f'    {name:24} -> {preview[0][:100]}  (x{preview[1]})')


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p):
        p.add_argument("--gap", type=float, default=GAP_US / 1e6,
                       help="seconds of silence that separate two rounds")
        p.add_argument("--min-records", type=int, default=200,
                       help="fragments smaller than this are noise and dropped")

    segments_parser = sub.add_parser("segments", help="fragment table for two streams")
    segments_parser.add_argument("reference")
    segments_parser.add_argument("ours")
    common(segments_parser)

    compare_parser = sub.add_parser("compare", help="diff one round against another")
    compare_parser.add_argument("reference")
    compare_parser.add_argument("ours")
    compare_parser.add_argument("--ref-frag", type=int, default=1)
    compare_parser.add_argument("--our-frag", type=int, default=1)
    compare_parser.add_argument("--top", type=int, default=12)
    compare_parser.add_argument("--threshold", type=int, default=1500)
    common(compare_parser)

    tostring_parser = sub.add_parser("toString", help="non-native toString answers")
    tostring_parser.add_argument("files", nargs="+")

    diverge_parser = sub.add_parser("diverge",
                                    help="earliest masked value divergence per key, in record order")
    diverge_parser.add_argument("reference")
    diverge_parser.add_argument("ours")
    diverge_parser.add_argument("--top", type=int, default=10)

    values_parser = sub.add_parser("values",
                                   help="value-level parity: same value, or same attribute/format")
    values_parser.add_argument("reference")
    values_parser.add_argument("ours")
    values_parser.add_argument("--top", type=int, default=14)

    args = parser.parse_args()
    {"segments": cmd_segments, "compare": cmd_compare, "toString": cmd_tostring,
     "values": cmd_values, "diverge": cmd_diverge}[args.command](args)


if __name__ == "__main__":
    main()
