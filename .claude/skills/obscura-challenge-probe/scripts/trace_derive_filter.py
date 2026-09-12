#!/usr/bin/env python3
"""Derive an Obscura --trace-api-filter spec from a reference trace.

The reference trace (HaHaVM, JSONL of {t,src,name,args,result}) is the list of
API members the page actually touches on the side that passes the challenge.
Feeding that list back as Obscura's include filter has two effects:

  * the traced run records the same API surface instead of every property
    access inside the page's own code, which is what makes the run fast enough
    to reach a challenge frame at all;
  * the two sides become comparable name for name.

Usage:
  trace_derive_filter.py REFERENCE.jsonl [--also OBSCURA.jsonl] [-o FILTER.txt]
                          [--mode full|member] [--min-count N]
                          [--drop-suffix S]

  --also         another trace whose names join the union (the engine-side
                 run). The filter matches names as substrings, so a member the
                 two sides spell under different interfaces -- Element.nonce
                 here, HTMLElement.nonce there -- matches a filter built from
                 the other side alone and is then DROPPED WITHOUT A WORD. Pass
                 the second side and the union covers both spellings.
  --mode full    one entry per full "Interface.member" name (default)
  --mode member  one entry per member name, ignoring the interface
  --min-count    skip names seen fewer than N times in the reference
  --drop-suffix  skip names ending in this text, repeatable (e.g. ".length")

Prints the spec on stdout (or writes it with -o). The spec is comma-separated
and is meant for OBSCURA_TRACE_API_FILTER / --trace-api-filter.

A single trace is accepted, because that is enough to make a run affordable,
but it is not enough to make it COMPLETE: see --also.
"""

import argparse
import collections
import json
import sys


def load_names(path):
    counts = collections.Counter()
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            name = record.get("name")
            if isinstance(name, str) and name:
                counts[name] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference")
    parser.add_argument(
        "--also", action="append", default=[],
        help="another trace whose names join the union (the engine-side run)",
    )
    parser.add_argument("-o", "--output")
    parser.add_argument("--mode", choices=("full", "member"), default="full")
    parser.add_argument("--min-count", type=int, default=1)
    parser.add_argument("--drop-suffix", action="append", default=[])
    parser.add_argument("--drop-name", action="append", default=[])
    args = parser.parse_args()

    counts = load_names(args.reference)
    for extra in args.also:
        counts.update(load_names(extra))
    if not args.also:
        print(
            "# warning: one trace only. A member the other side spells under a "
            "different interface (Element.nonce vs HTMLElement.nonce) does not "
            "match this filter and is DROPPED SILENTLY. Pass --also "
            "OTHER.jsonl to take the union of both sides.",
            file=sys.stderr,
        )

    entries = []
    seen = set()
    for name, count in counts.most_common():
        if count < args.min_count:
            continue
        if any(name.endswith(suffix) for suffix in args.drop_suffix):
            continue
        if name in args.drop_name:
            continue
        entry = name if args.mode == "full" else name.rsplit(".", 1)[-1]
        # A comma separates clauses and a leading +/- changes their meaning.
        if not entry or "," in entry or entry[0] in "+-":
            continue
        if entry in seen:
            continue
        seen.add(entry)
        entries.append(entry)

    spec = ",".join(entries)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(spec + "\n")
    else:
        print(spec)
    print(
        f"# {len(entries)} entries from {len(counts)} reference names",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
