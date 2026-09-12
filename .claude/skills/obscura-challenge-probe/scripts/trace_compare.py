#!/usr/bin/env python3
"""Align an Obscura API trace with the HaHaVM reference trace.

Both sides are JSONL records of {t, src, name, args, result}: one record per API
access or call. They are produced by different engines, so the comparison
normalizes what the engines spell differently and then answers two questions:

  1. per phase, which API members does each side touch, and how often?
  2. walking the record sequences in time order, where is the first place the
     two sides stop agreeing?

The alignment is name-based, not timestamp-based. The two clocks start at
different events, and a challenge run spends a variable amount of time before
the interesting phase, so wall-clock offsets carry no information. Phase
membership (from the call-site URL in src) is what makes the sequences
comparable.

Usage:
  trace_compare.py REFERENCE.jsonl OBSCURA.jsonl [--json OUT.json] [--limit N]
                   [--key canonical|member|exact] [--context N]
  trace_compare.py REFERENCE.jsonl OBSCURA.jsonl --structural [--show N]

Exit status is 0 when a report was produced, 1 when a trace could not be read.

Canonical record form
---------------------
Both engines emit one JSON object per line with exactly these fields:

  t       milliseconds since this stream's first record, one decimal. The two
          streams start at different events, so only deltas within a stream are
          meaningful; cross-side alignment is by record sequence, not by t.
  src     "<op> <name> (<definition>) <- (<call site>)", op in
          {get, set, call, new}. "<native>" marks a member with no JS source
          position, "<engine>" an access the engine made rather than the page.
          Both halves are always present, on both sides.
  name    "<Interface>.<member>", WebIDL interface spelling ("window" for the
          global object, "constructor" for a construct).
  args    JSON array, one entry per argument; empty for a read.
  result  the read value, a call's return value, the constructed object, or
          the string "undefined" for a write (the assigned value is in args).

Value spelling: undefined is the string "undefined", null is null, numbers and
booleans are JSON natives, strings are JSON strings, a callable is "ƒ name", a
DOM element's class tag stands in for the element, any other receiver is
"<Ctor> {…}". Every field is cut at the same UTF-8 byte budget including the
"...[truncated]" marker, so a field under the budget is byte-identical on both
sides and a longer one is cut in the same place.

--structural pairs records by (op, name, call site) and compares the remaining
fields, which is how a controlled fixture is checked: same logical event, same
record structure, no truncation. Definition sites are reported but never
required to match, because the two engines implement the same member in
different source files.
"""

import argparse
import collections
import difflib
import json
import re
import sys

# Engine-specific spellings that mean the same API member.
INTERFACE_PREFIXES = ("html", "svg")
OP_PREFIXES = ("get", "set", "new", "fetch", "call", "has")

# The canonical src grammar. Both sides build this string by construction; the
# parse is tolerant so a trace written before the contract still loads.
SRC_GRAMMAR = re.compile(
    r"^(?P<op>\w+) (?P<name>\S+) \((?P<definition>.*)\) <- (?P<call_site>.*)$"
)
# "HTMLDivElement" / "DivElement" -> the tag a reference trace writes as <div>.
ELEMENT_TAG = re.compile(r"^(?:HTML)?([A-Z][A-Za-z0-9]*)Element$")
# An object's rendered body: everything is summarized by its class tag.
OBJECT_BODY = " {"
# An engine whose generic element class stores the tag on the instance.
TAG_IN_BODY = re.compile(r'_tagName:\s*"([A-Za-z0-9]+)"')

PHASE_RULES = (
    ("turnstile", re.compile(r"challenges\.cloudflare\.com|/rch/|/cdn-cgi/")),
    ("blob", re.compile(r"^blob:")),
    ("top", re.compile(r"thelancet\.com")),
)


def parse_record(line):
    line = line.strip()
    if not line:
        return None
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(record, dict):
        return None
    name = record.get("name")
    src = record.get("src")
    if not isinstance(name, str) or not isinstance(src, str):
        return None
    return record


def operation_of(src):
    head = src.split(" ", 1)[0]
    if head in OP_PREFIXES:
        # "call" and HaHaVM's unprefixed method records are the same thing.
        return "call" if head in ("call",) else head
    return "call"


def phase_of(record):
    src = record["src"]
    # The call site is the right half of "<definition> <- <call site>".
    call_site = src.rsplit("<-", 1)[-1]
    for phase, pattern in PHASE_RULES:
        if pattern.search(call_site):
            return phase
    return "other"


def normalize_name(name, key):
    if key == "exact":
        return name
    interface, _, member = name.rpartition(".")
    if not member:
        return name.lower()
    if key == "member":
        return member
    interface = interface.lower()
    if interface == "window":
        interface = "window"
    for prefix in INTERFACE_PREFIXES:
        if interface.startswith(prefix) and len(interface) > len(prefix):
            interface = interface[len(prefix):]
            break
    return f"{interface}.{member}"


def parse_src(src):
    """Split the canonical src into its four parts.

    Both sides build this string by construction. A trace written before the
    contract still parses, with the parts left empty, so a comparison against
    an older file degrades to the whole-string mode instead of failing.
    """
    match = SRC_GRAMMAR.match(src)
    if match is None:
        return {
            "op": operation_of(src),
            "name": "",
            "definition": "",
            "call_site": src,
        }
    return match.groupdict()


def canonical_value(value):
    """One spelling per logical value across the two engines.

    A DOM element is its tag: the reference writes <div>, having read tagName,
    where the engine-side trace cannot evaluate a getter and carries the class
    tag (and, for its generic Element class, the tag as an own property). Any
    other object is summarized by its class tag alone, because the two engines
    hold different properties on the same object and the bodies would never
    compare equal.
    """
    if not isinstance(value, str):
        return value
    text = value
    if text.startswith("ƒ ") or text == "undefined":
        return text
    if text.startswith("<") and text.endswith(">") and " " not in text:
        return text
    cut = text.find(OBJECT_BODY)
    tag = text[:cut] if cut != -1 else text
    element = ELEMENT_TAG.match(tag)
    if element:
        return f"<{element.group(1).lower()}>"
    inner_tag = TAG_IN_BODY.search(text)
    if inner_tag:
        return f"<{inner_tag.group(1).lower()}>"
    if cut != -1:
        return f"{tag} {{}}"
    return text


def canonical_args(record):
    return [canonical_value(value) for value in record.get("args") or []]


def record_key(record):
    """The identity of a logical event: what was done, to what, from where."""
    parts = parse_src(record["src"])
    return (parts["op"], record["name"], parts["call_site"])


def page_records(records):
    """Only the accesses the page itself made.

    A record whose call site is <engine> describes the engine building its own
    document, which has no counterpart on the other side and no page line to
    compare against.
    """
    return [r for r in records if parse_src(r["src"])["call_site"] != "<engine>"]


def field_differences(left, right):
    """Which fields of two records for the same event disagree.

    Definitions are reported as a difference but never as a failure: the two
    engines implement the same member in different source files, so the sites
    can only ever differ. Everything else is required to match.
    """
    differences = []
    left_args = canonical_args(left)
    right_args = canonical_args(right)
    if left_args != right_args:
        differences.append(("args", left_args, right_args))
    left_result = canonical_value(left.get("result"))
    right_result = canonical_value(right.get("result"))
    if left_result != right_result:
        differences.append(("result", left_result, right_result))
    left_definition = parse_src(left["src"])["definition"]
    right_definition = parse_src(right["src"])["definition"]
    if left_definition != right_definition:
        differences.append(("definition", left_definition, right_definition))
    return differences


def structural_report(reference, obscura, show):
    """Pair records by logical event and compare the remaining fields.

    This is the controlled-fixture check: the two sides ran the same page, so
    every event the page performed is one record on each side and those two
    records have to agree field by field.
    """
    buckets = collections.defaultdict(lambda: ([], []))
    for record in page_records(reference):
        buckets[record_key(record)][0].append(record)
    for record in page_records(obscura):
        buckets[record_key(record)][1].append(record)

    paired = []
    only_reference = []
    only_obscura = []
    for key in sorted(buckets):
        left_records, right_records = buckets[key]
        for index in range(max(len(left_records), len(right_records))):
            if index >= len(left_records):
                only_obscura.append(right_records[index])
            elif index >= len(right_records):
                only_reference.append(left_records[index])
            else:
                paired.append((left_records[index], right_records[index]))

    counts = collections.Counter()
    for left, right in paired:
        for field, _, _ in field_differences(left, right):
            counts[field] += 1

    print(f"events on both sides: {len(paired)}")
    print(
        f"events only in the reference: {len(only_reference)}   "
        f"only in obscura: {len(only_obscura)}"
    )
    if paired:
        print(
            "field agreement: "
            f"args {len(paired) - counts['args']}/{len(paired)}, "
            f"result {len(paired) - counts['result']}/{len(paired)}, "
            f"definition {len(paired) - counts['definition']}/{len(paired)} "
            "(definition is engine-specific by construction)"
        )
    for label, records in (("reference", only_reference), ("obscura", only_obscura)):
        if records:
            print(f"\nunmatched on the {label} side:")
            for record in records[:show]:
                print(f"  {record_key(record)}  {describe(record)[:200]}")

    print("\nevent-by-event:")
    for index, (left, right) in enumerate(paired):
        if show and index >= show:
            print(f"  ... {len(paired) - show} more")
            break
        differences = field_differences(left, right)
        verdict = "same" if not differences else "differs: " + ", ".join(
            field for field, _, _ in differences
        )
        print(f"\n  [{index}] {record_key(left)[0]} {record_key(left)[1]} "
              f"@ {record_key(left)[2]}  -> {verdict}")
        print(f"      ref  {describe(left)[:220]}")
        print(f"      obs  {describe(right)[:220]}")
        for field, left_value, right_value in differences:
            if field == "definition":
                continue
            print(f"      {field}: ref={json.dumps(left_value, ensure_ascii=False)[:120]}")
            print(f"      {field}: obs={json.dumps(right_value, ensure_ascii=False)[:120]}")
    return counts


def load(path, key):
    records = []
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            record = parse_record(line)
            if record is None:
                continue
            record["_phase"] = phase_of(record)
            record["_op"] = operation_of(record["src"])
            record["_key"] = normalize_name(record["name"], key)
            records.append(record)
    return records


def equivalent(a, b, key):
    if a == b:
        return True
    if key == "exact":
        return False
    a_interface, _, a_member = a.rpartition(".")
    b_interface, _, b_member = b.rpartition(".")
    if a_member != b_member or not a_member:
        return False
    return a_interface.endswith(b_interface) or b_interface.endswith(a_interface)


def alias_symbols(left, right, key):
    """Collapse keys that mean the same thing into one symbol per side."""
    symbols = {}
    left_ids = {}
    right_ids = {}
    for index, key_value in enumerate(left):
        symbols.setdefault(("L", key_value), index)
    for index, key_value in enumerate(right):
        symbols.setdefault(("R", key_value), index)
    # Union equivalent keys across the two sides.
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    left_keys = sorted({k for _, k in symbols if _ == "L"})
    right_keys = sorted({k for _, k in symbols if _ == "R"})
    for a in left_keys:
        for b in right_keys:
            if equivalent(a, b, key):
                union(("L", a), ("R", b))
    return {side_key: find(side_key) for side_key in symbols}


def sequence(records):
    return [r["_key"] for r in records]


def describe(record):
    args = record.get("args")
    result = record.get("result")
    text = f"{record['_op']} {record['name']}"
    if args:
        text += f" args={json.dumps(args, ensure_ascii=False)[:160]}"
    text += f" -> {json.dumps(result, ensure_ascii=False)[:80]}"
    text += f"   [{record['src'][:200]}]"
    return text


def first_divergence(left, right, key, context, align):
    """First index where the two sequences stop being matchable in order.

    With align="common" the comparison first drops every record whose name does
    not appear on the other side at all. A member one engine never touches is a
    surface gap, not an ordering divergence, and leaving those in makes the
    first divergence always the first record.
    """
    if not left or not right:
        return None
    if align == "common":
        left_keys = {r["_key"] for r in left}
        right_keys = {r["_key"] for r in right}
        shared = {
            a for a in left_keys for b in right_keys
            if equivalent(a, b, key)
        }
        if not shared:
            return None
        left = [r for r in left if any(
            equivalent(r["_key"], s, key) for s in shared
        )]
        right = [r for r in right if any(
            equivalent(r["_key"], s, key) for s in shared
        )]
        if not left or not right:
            return None
    symbols = alias_symbols(sequence(left), sequence(right), key)
    matcher = difflib.SequenceMatcher(
        None,
        [symbols[("L", r["_key"])] for r in left],
        [symbols[("R", r["_key"])] for r in right],
        autojunk=False,
    )
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        report = {
            "tag": tag,
            "left_index": i1,
            "right_index": j1,
            "left_phase": left[i1]["_phase"] if i1 < len(left) else "?",
            "right_phase": right[j1]["_phase"] if j1 < len(right) else "?",
            "missing_on_obscura": [describe(r) for r in left[i1:min(i2, i1 + 8)]],
            "missing_on_reference": [describe(r) for r in right[j1:min(j2, j1 + 8)]],
            "before_left": [describe(r) for r in left[max(0, i1 - context):i1]],
            "before_right": [describe(r) for r in right[max(0, j1 - context):j1]],
        }
        return report
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference")
    parser.add_argument("obscura")
    parser.add_argument("--json", dest="json_out")
    parser.add_argument("--key", choices=("canonical", "member", "exact"),
                        default="canonical")
    parser.add_argument("--context", type=int, default=6)
    parser.add_argument(
        "--align", choices=("all", "common"), default="common",
        help="compare every record, or only the names both sides touch",
    )
    parser.add_argument("--top", type=int, default=25,
                        help="how many per-name differences to print")
    parser.add_argument(
        "--structural", action="store_true",
        help="pair records by logical event and compare fields, for two runs "
             "of the same fixture",
    )
    parser.add_argument("--show", type=int, default=40,
                        help="--structural: how many events to print")
    args = parser.parse_args()

    try:
        left = load(args.reference, args.key)
        right = load(args.obscura, args.key)
    except OSError as error:
        print(f"cannot read trace: {error}", file=sys.stderr)
        return 1

    if args.structural:
        if not left or not right:
            print(
                f"empty trace: reference={len(left)} obscura={len(right)}",
                file=sys.stderr,
            )
            return 1
        print(f"reference: {args.reference} ({len(left)} records)")
        print(f"obscura:   {args.obscura} ({len(right)} records)\n")
        structural_report(left, right, args.show)
        return 0

    if not left or not right:
        print(
            f"empty trace: reference={len(left)} obscura={len(right)}",
            file=sys.stderr,
        )
        return 1

    phases = sorted({r["_phase"] for r in left} | {r["_phase"] for r in right})
    report = {
        "reference": args.reference,
        "obscura": args.obscura,
        "key": args.key,
        "reference_records": len(left),
        "obscura_records": len(right),
        "phases": {},
    }

    print(f"reference: {len(left)} records   obscura: {len(right)} records")
    for phase in phases:
        left_phase = [r for r in left if r["_phase"] == phase]
        right_phase = [r for r in right if r["_phase"] == phase]
        left_counts = collections.Counter(r["_key"] for r in left_phase)
        right_counts = collections.Counter(r["_key"] for r in right_phase)
        differences = []
        for name in sorted(set(left_counts) | set(right_counts)):
            delta = right_counts[name] - left_counts[name]
            if delta:
                differences.append(
                    {
                        "name": name,
                        "reference": left_counts[name],
                        "obscura": right_counts[name],
                        "delta": delta,
                    }
                )
        differences.sort(key=lambda item: -abs(item["delta"]))
        divergence = first_divergence(
            left_phase, right_phase, args.key, args.context, args.align
        )
        report["phases"][phase] = {
            "reference_records": len(left_phase),
            "obscura_records": len(right_phase),
            "reference_names": len(left_counts),
            "obscura_names": len(right_counts),
            "differences": differences,
            "first_divergence": divergence,
        }
        print(
            f"\nphase {phase}: reference {len(left_phase)} records / "
            f"{len(left_counts)} names, obscura {len(right_phase)} records / "
            f"{len(right_counts)} names"
        )
        if divergence is None:
            print("  no sequence divergence: one side's records are a "
                  "subsequence-compatible match of the other's")
            continue
        print(
            f"  first divergence at reference#{divergence['left_index']} "
            f"(phase {divergence['left_phase']}) / "
            f"obscura#{divergence['right_index']} "
            f"(phase {divergence['right_phase']}), kind={divergence['tag']}"
        )
        print("  last records both sides agree on:")
        for line in divergence["before_left"][-args.context:]:
            print(f"    ref  {line}")
        for line in divergence["before_right"][-args.context:]:
            print(f"    obs  {line}")
        if divergence["missing_on_obscura"]:
            print("  present in the reference, absent in obscura:")
            for line in divergence["missing_on_obscura"]:
                print(f"    ref  {line}")
        if divergence["missing_on_reference"]:
            print("  present in obscura, absent in the reference:")
            for line in divergence["missing_on_reference"]:
                print(f"    obs  {line}")

    print("\nlargest per-name differences:")
    for phase in phases:
        differences = report["phases"][phase]["differences"]
        for item in differences[:args.top]:
            print(
                f"  {phase:10s} {item['name']:50s} "
                f"ref={item['reference']:6d} obs={item['obscura']:6d} "
                f"delta={item['delta']:+d}"
            )

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
        print(f"\nreport: {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
