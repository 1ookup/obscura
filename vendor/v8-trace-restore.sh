#!/usr/bin/env bash
# Restore the native trace sources in a fresh vendor/rusty_v8 clone.
#
# The trace implementation lives as a patch series in vendor/v8-trace-patches/
# (exported with format-patch from the nested v8 repository's obscura-trace
# branch, base f68bbb6cda -- the v8 submodule pinned by rusty_v8 v137.3.0).
# A fresh clone of vendor/rusty_v8 carries none of it, so run this once after
# cloning and before vendor/v8-trace.sh build:
#
#   git clone --recurse-submodules --shallow-submodules --depth 1 \
#     --branch v137.3.0 https://github.com/denoland/rusty_v8 vendor/rusty_v8
#   vendor/v8-trace-restore.sh
#   vendor/v8-rusty-extras.sh vendor/rusty_v8
#   vendor/v8-trace.sh build
#
# v8-trace.sh build alone is not enough on a fresh checkout: it runs the
# extras script (document.all bindings) but knows nothing about this series.
# The branch tip after restore also carries the jsonl "from" realm label that
# was recovered uncommitted from the machine that originally wrote the
# series; without the restore the --trace-property-lookup flag is unknown to
# V8 and every traced run dies with "unrecognized flag".
#
# Idempotent: re-running detects an already-patched tree and exits 0.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V8_DIR="$ROOT/vendor/rusty_v8/v8"
PATCHES="$ROOT/vendor/v8-trace-patches"

die() { echo "$*" >&2; exit 1; }

[[ -d "$V8_DIR/.git" || -f "$V8_DIR/.git" ]] || die \
"no nested v8 git repository at $V8_DIR
  clone rusty_v8 with --recurse-submodules first"

if git -C "$V8_DIR" log --oneline -1 2>/dev/null | grep -q "realm from label"; then
  echo "trace patches already present ($(git -C "$V8_DIR" log --oneline -1 | cut -c1-60))"
  exit 0
fi

# The series sits directly on the pinned submodule commit; refuse to apply it
# anywhere else rather than producing a tree nobody has ever built.
BASE="$(git -C "$V8_DIR" rev-parse HEAD)"
if [[ "$BASE" != f68bbb6cda* ]]; then
  echo "nested v8 HEAD is ${BASE:0:12}, expected f68bbb6cda (rusty_v8 v137.3.0)" >&2
  echo "  the patch series is anchored on that commit; check out the pinned" >&2
  echo "  submodule state first (git -C vendor/rusty_v8/v8 checkout f68bbb6cda)" >&2
  exit 1
fi

git -C "$V8_DIR" am "$PATCHES"/*.patch
echo "applied $(ls "$PATCHES" | wc -l | tr -d ' ') patches; obscura-trace tip:" $(git -C "$V8_DIR" log --oneline -1 | cut -d' ' -f1)
echo "next: vendor/v8-trace.sh build  (the first build recompiles the touched V8 files)"
