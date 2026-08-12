#!/usr/bin/env bash
# Patch V8 to report every property lookup with its receiver and whether it
# resolved.
#
# V8's inline-cache log answers neither question. It carries a Map pointer rather
# than the receiver, so an object can only be named by its hidden class -- and for
# an engine whose DOM is JavaScript classes, that collapses every element type
# onto one base class. It also says nothing about whether a lookup found
# anything, because it is emitted from the cache-update path, which runs only
# when a lookup succeeds in a cacheable way. Reconstructing absence afterwards
# does not work either: roughly 58% of map-details records carry a descriptor
# array and the built-in prototypes are among those that do not, so
# Array.prototype's map never mentions `map` and "unlisted" is indistinguishable
# from "absent".
#
# Both facts are ordinary locals inside LoadIC::Load. `receiver` is the real
# object; `it.IsFound()` is V8's own answer after the lookup completed.
#
# A second hook sits in Runtime_TraceEnter, which V8 already calls on every
# JavaScript function entry under --trace and which is handed the whole frame:
# receiver, callee, and the actual arguments. Between the two, calls and lookups
# are both reported from inside the engine, which is what makes the JavaScript
# side of the tracer unnecessary rather than merely redundant.
#
# Written as an anchored insert rather than a diff because the exact line numbers
# drift between V8 revisions and a rejected hunk is a worse failure than a
# mismatched anchor, which this reports.
#
# Usage:
#   vendor/v8-property-trace.sh vendor/rusty_v8/v8
#
# Verified against v8 rev f68bbb6cda689a14d019a6a60cc93963724e7c35, the revision
# rusty_v8 v137.3.0 pins: applied to that tree, compiled, and run.

set -euo pipefail

V8_DIR="${1:-}"
if [[ -z "$V8_DIR" || ! -f "$V8_DIR/src/ic/ic.cc" ]]; then
  echo "usage: $0 <path-to-v8-source>" >&2
  echo "  (expects <path>/src/ic/ic.cc)" >&2
  exit 2
fi

IC="$V8_DIR/src/ic/ic.cc"
FLAGS="$V8_DIR/src/flags/flag-definitions.h"
RT="$V8_DIR/src/runtime/runtime-test.cc"

# Per-file: rewriting an already-patched file costs a near-full rebuild for
# nothing (flag-definitions.h is included almost everywhere; runtime-test.cc
# compiles into every V8 binary).
if grep -q "trace_property_lookup" "$IC" \
   && grep -q "trace_property_lookup" "$FLAGS" \
   && grep -q "TraceCallEnterEnabled" "$RT"; then
  echo "already patched"
  exit 0
fi

python3 - "$IC" "$FLAGS" "$RT" <<'PY'
import sys

ic_path, flags_path, rt_path = sys.argv[1], sys.argv[2], sys.argv[3]
ic = open(ic_path).read()

# --- 0. validate EVERY anchor before modifying ANY file -----------------------
# If any anchor is missing we report it without leaving partially-applied
# state.  Sections are guarded individually so the script is idempotent even
# when an earlier run was interrupted mid-way.
ANCHORS_OK = True
ic_dirty = False

def check(msg, cond):
    global ANCHORS_OK
    if not cond:
        print("anchor missing: " + msg, file=sys.stderr)
        ANCHORS_OK = False

# ic.cc anchors
check("tracing-category-observer include",
      '#include "src/tracing/tracing-category-observer.h"' in ic)
check("IC::TraceIC definition",
      'void IC::TraceIC(const char* type, DirectHandle<Object> name) {' in ic)
check("LookupForRead call in LoadIC::Load",
      'LookupForRead(&it, IsAnyHas());' in ic)
# flags anchor
fl = open(flags_path).read()
check("trace_temporal flag definition",
      'DEFINE_BOOL(trace_temporal, false, "trace temporal code")' in fl)
# runtime-test.cc anchors
rt = open(rt_path).read()
check("namespace v8 { namespace internal {",
      "namespace v8 {\nnamespace internal {" in rt)
check("Runtime_TraceEnter body",
      'JavaScriptFrame::PrintTop(isolate, stdout, true, false);' in rt)
# Runtime_TraceExit: the v8 13.7 form uses CrashUnlessFuzzing, not CHECK_UNLESS_FUZZING
check("Runtime_TraceExit body",
      'return CrashUnlessFuzzing(isolate);' in rt and 'ShortPrint(obj);' in rt)

if not ANCHORS_OK:
    sys.exit("One or more anchors are missing — this V8 revision may not be "
             "compatible.  The documented target is f68bbb6cda689a14d "
             "(rusty_v8 v137.3.0).  See docs/Trace-page-script.md.")

rt_dirty = False
fl_dirty = False

# --- 1. includes -------------------------------------------------------------
# GetConstructorName lives in js-objects.h; Script::GetPositionInfo in script.h.
# frames.h and ostreams.h are already included by ic.cc.
anchor = '#include "src/tracing/tracing-category-observer.h"'
inc = '#include "src/objects/js-objects.h"'
if inc not in ic:
    ic = ic.replace(
        anchor,
        '#include "src/objects/js-objects.h"\n'
        '#include "src/objects/script.h"\n'
        '#include "src/objects/shared-function-info.h"\n'
        + anchor,
        1,
    )
    ic_dirty = True

# --- 2. the reporter ---------------------------------------------------------
REPORTER = r'''
// Reports one property lookup: the receiver's JavaScript-visible constructor
// name, the property, whether it resolved, and where in the source it happened.
//
// GetConstructorName is what makes this worth doing at all. The IC log's Map
// pointer resolves at best to a hidden class; this returns the name the page
// itself would see.
//
// Deliberately not routed through Logger, whose IC paths hang off the
// cache-update branch below and so do not run for every lookup that reaches
// here.
// Reachable from runtime-test.cc, where the call hook lives. Everything else
// here stays internal.
bool TraceCallEnterEnabled();
void TraceCallEnter(Isolate* isolate);
void TraceCallExit(Isolate* isolate, Tagged<Object> value);

namespace {

// Opened once and never closed: the process exits with it, and closing on a
// last-lookup signal that does not exist would only risk losing the tail.
FILE* TracePropertyLookupFile() {
  static FILE* file = nullptr;
  static bool tried = false;
  if (!tried) {
    tried = true;
    if (v8_flags.trace_property_lookup_file != nullptr) {
      file = fopen(v8_flags.trace_property_lookup_file, "w");
    }
  }
  return file;
}

// Compact, side-effect-free rendering of one value. ShortPrint would be the
// obvious choice but it writes straight to a FILE* and can emit tabs and
// newlines, which the record format cannot carry. Nothing here calls back into
// JavaScript: no toString, no valueOf, no accessor.
void TraceAppendValue(Isolate* isolate, Tagged<Object> value, std::string* out) {
  if (IsString(value)) {
    std::unique_ptr<char[]> c = Cast<String>(value)->ToCString();
    std::string s(c ? c.get() : "");
    if (s.size() > 64) { s.resize(64); s += "..."; }
    for (char& ch : s) {
      if (ch == '\t' || ch == '\n' || ch == '\r') ch = ' ';
    }
    *out += "string:\"" + s + "\"";
  } else if (IsSmi(value)) {
    *out += "number:" + std::to_string(Smi::ToInt(value));
  } else if (IsHeapNumber(value)) {
    *out += "number:" + std::to_string(Cast<HeapNumber>(value)->value());
  } else if (IsTrue(value, isolate)) {
    *out += "boolean:true";
  } else if (IsFalse(value, isolate)) {
    *out += "boolean:false";
  } else if (IsUndefined(value, isolate)) {
    *out += "undefined";
  } else if (IsNull(value, isolate)) {
    *out += "null";
  } else if (IsJSReceiver(value)) {
    DirectHandle<String> ctor = JSReceiver::GetConstructorName(
        isolate, direct_handle(Cast<JSReceiver>(value), isolate));
    std::unique_ptr<char[]> c = ctor->ToCString();
    *out += std::string("object:") + (c ? c.get() : "?");
  } else {
    *out += "other";
  }
}

// Reports one function call with its receiver and arguments.
//
// V8 already emits a call to this on every JavaScript function entry when
// --trace is on; the stock body prints a raw dump to stdout. Replacing that with
// a structured record turns an existing mechanism into a source for the trace
// rather than adding a parallel one.
// Whether the current call was made by page code, and where.
//
// What matters is who called, not where the callee lives. Filtering on the
// callee's script looked right and dropped almost everything worth having:
// getElementById and setAttribute are defined in bootstrap.js, so a page calling
// them is a frame whose callee is engine code. The caller's frame is the one that
// says whether the page did this, and its position is the call site a reader
// wants.
//
// Shared by both hooks so that entries and returns are selected by the same
// predicate; filtering only one of them leaves returns that pair with nothing.
// Describes one frame, or reports that it is engine code.
bool TraceDescribeFrame(Isolate* isolate, JavaScriptFrame* frame,
                        std::string* where, int* line, int* column,
                        std::string* func) {
  DirectHandle<SharedFunctionInfo> shared(frame->function()->shared(), isolate);
  Tagged<Object> script_obj = shared->script();
  if (!IsScript(script_obj)) return false;
  DirectHandle<Script> script(Cast<Script>(script_obj), isolate);

  if (IsString(script->name())) {
    std::unique_ptr<char[]> n = Cast<String>(script->name())->ToCString();
    const char* name = n ? n.get() : "";
    if (name[0] == '\0' || name[0] == '<' || strncmp(name, "ext:", 4) == 0 ||
        strncmp(name, "deno:", 5) == 0) {
      return false;
    }
    *where = name;
  } else {
    // Code the page ran through eval carries no script name of its own.
    *where = "<page-eval>";
  }

  SharedFunctionInfo::EnsureSourcePositionsAvailable(isolate, shared);
  Script::PositionInfo info;
  if (Script::GetPositionInfo(script, frame->position(), &info)) {
    *line = info.line + 1;
    *column = info.column + 1;
  }
  if (func != nullptr) {
    std::unique_ptr<char[]> n = shared->DebugNameCStr();
    *func = n ? n.get() : "";
  }
  return true;
}

// Whether the current call was made by page code, where, and the page frames
// beneath it.
//
// What matters is who called, not where the callee lives. Filtering on the
// callee's script looked right and dropped almost everything worth having:
// getElementById and setAttribute are defined in bootstrap.js, so a page calling
// them is a frame whose callee is engine code. The caller's frame is the one that
// says whether the page did this, and its position is the call site a reader
// wants.
//
// Shared by both hooks so that entries and returns are selected by the same
// predicate; filtering only one of them leaves returns that pair with nothing.
bool TraceCallOrigin(Isolate* isolate, std::string* where, int* line, int* column,
                     std::string* stack) {
  JavaScriptStackFrameIterator frames(isolate);
  if (frames.done()) return false;
  frames.Advance();
  if (frames.done()) return false;
  if (!TraceDescribeFrame(isolate, frames.frame(), where, line, column, nullptr)) {
    return false;
  }
  if (stack == nullptr) return true;

  // Frames above the call site, engine ones skipped rather than ending the walk:
  // page code reaches the DOM through bootstrap, so an engine frame in the middle
  // is the normal case and stopping there would truncate every stack to nothing.
  int kept = 0;
  for (; !frames.done() && kept < 8; frames.Advance()) {
    std::string w, f;
    int l = 0, c = 0;
    if (!TraceDescribeFrame(isolate, frames.frame(), &w, &l, &c, &f)) continue;
    if (kept) *stack += " <- ";
    *stack += (f.empty() ? "<anonymous>" : f) + ":" + std::to_string(l) + ":" +
              std::to_string(c);
    kept++;
  }
  return true;
}

void TraceCallEnterImpl(Isolate* isolate) {
  FILE* out = TracePropertyLookupFile();
  if (out == nullptr) return;

  HandleScope scope(isolate);
  std::string where;
  int line = 0, column = 0;
  std::string stack;
  if (!TraceCallOrigin(isolate, &where, &line, &column, &stack)) return;

  JavaScriptStackFrameIterator frames(isolate);
  JavaScriptFrame* frame = frames.frame();
  std::string owner;
  Tagged<Object> recv = frame->receiver();
  if (IsJSReceiver(recv)) {
    DirectHandle<String> ctor = JSReceiver::GetConstructorName(
        isolate, direct_handle(Cast<JSReceiver>(recv), isolate));
    std::unique_ptr<char[]> c = ctor->ToCString();
    owner = c ? c.get() : "?";
  } else {
    owner = "?";
  }

  // The callee, not the caller whose frame supplied the position.
  DirectHandle<SharedFunctionInfo> callee(frame->function()->shared(), isolate);
  std::unique_ptr<char[]> fname = callee->DebugNameCStr();
  if (!fname || fname.get()[0] == '\0') return;

  std::string args;
  const int count = frame->ComputeParametersCount();
  for (int i = 0; i < count; i++) {
    if (i) args += ", ";
    TraceAppendValue(isolate, frame->GetParameter(i), &args);
  }

  fprintf(out, "CALL\t%s\t%s\t%s\t%d\t%d\t%s\t%s\n", owner.c_str(),
          fname ? fname.get() : "?", where.c_str(), line, column, args.c_str(),
          stack.c_str());
}

void TracePropertyLookup(Isolate* isolate, DirectHandle<JSAny> receiver,
                         DirectHandle<Name> name, bool found) {
  HandleScope scope(isolate);

  std::unique_ptr<char[]> owner;
  if (IsJSReceiver(*receiver)) {
    DirectHandle<String> ctor =
        JSReceiver::GetConstructorName(isolate, Cast<JSReceiver>(receiver));
    owner = ctor->ToCString();
  }

  std::unique_ptr<char[]> prop;
  if (IsString(*name)) {
    prop = Cast<String>(name)->ToCString();
  }

  // Source position. frame->position() reads 0 for an interpreted frame, which
  // is what page script runs as, and every record came out as 1:1 because of it.
  // TraceIC takes the route below instead: ask the frame for its active code and
  // the offset within it, then let the code translate that offset back to a
  // source position. An absent frame is normal for lookups the runtime performs
  // on its own behalf rather than for page code.
  std::unique_ptr<char[]> script_name;
  int line = 0;
  int column = 0;
  JavaScriptStackFrameIterator frames(isolate);
  if (!frames.done()) {
    JavaScriptFrame* frame = frames.frame();
    DirectHandle<SharedFunctionInfo> shared(frame->function()->shared(),
                                            isolate);
    Tagged<Object> script_obj = shared->script();
    if (IsScript(script_obj)) {
      DirectHandle<Script> script(Cast<Script>(script_obj), isolate);
      // Both halves are required and neither is obvious. Source position tables
      // are built lazily, so without EnsureSourcePositionsAvailable the position
      // is 0; and the position has to come from frame->position(), not from
      // translating a code offset, which also yields 0 here. This is exactly what
      // Isolate::GetAbstractPC does.
      SharedFunctionInfo::EnsureSourcePositionsAvailable(isolate, shared);
      int source_pos = frame->position();
      Script::PositionInfo info;
      if (source_pos >= 0 && Script::GetPositionInfo(script, source_pos, &info)) {
        line = info.line + 1;
        column = info.column + 1;
      }
      if (IsString(script->name())) {
        script_name = Cast<String>(script->name())->ToCString();
      }
      // Code the page ran through eval has no script name of its own. Leaving it
      // blank makes it indistinguishable from engine-internal work, and a
      // consumer that treats unnamed as internal throws away exactly the records
      // worth having -- a challenge payload arrives as a dynamically inserted
      // script, which is to say through eval. On a live Cloudflare page 2555 of
      // 4008 records were unnamed, and the one lookup that explained the failure
      // was among them.
    }
  }

  // Written to a file rather than stdout so it can be folded back into the same
  // event stream as every other trace plane, instead of standing up a second
  // reporting channel with its own format. stdout also belongs to --dump.
  FILE* out = TracePropertyLookupFile();
  if (out == nullptr) return;
  const char* where = script_name ? script_name.get()
                                  : (frames.done() ? "" : "<page-eval>");
  std::string stack;
  {
    JavaScriptStackFrameIterator walk(isolate);
    int kept = 0;
    for (; !walk.done() && kept < 8; walk.Advance()) {
      std::string w, f;
      int l = 0, c = 0;
      if (!TraceDescribeFrame(isolate, walk.frame(), &w, &l, &c, &f)) continue;
      if (kept) stack += " <- ";
      stack += (f.empty() ? "<anonymous>" : f) + ":" + std::to_string(l) + ":" +
               std::to_string(c);
      kept++;
    }
  }
  fprintf(out, "%s\t%s\t%s\t%s\t%d\t%d\t\t%s\n", found ? "HIT" : "MISS",
          owner ? owner.get() : "?", prop ? prop.get() : "<symbol>", where,
          line, column, stack.c_str());
}

}  // namespace

bool TraceCallEnterEnabled() {
  return TracePropertyLookupFile() != nullptr;
}

void TraceCallEnter(Isolate* isolate) { TraceCallEnterImpl(isolate); }

// Reports what a call returned. V8 already routes every function exit through
// Runtime_TraceExit under --trace and hands it the value on the top of stack, so
// this is the same borrowed mechanism as the entry hook. Paired by nesting depth
// rather than by identity: a reader matches a RET to the CALL above it, which is
// what the indentation in V8's own output conveys.
void TraceCallExit(Isolate* isolate, Tagged<Object> value) {
  FILE* out = TracePropertyLookupFile();
  if (out == nullptr) return;
  HandleScope scope(isolate);
  std::string where;
  int line = 0, column = 0;
  if (!TraceCallOrigin(isolate, &where, &line, &column, nullptr)) return;
  std::string rendered;
  TraceAppendValue(isolate, value, &rendered);
  fprintf(out, "RET\t\t\t%s\t%d\t%d\t%s\n", where.c_str(), line, column,
          rendered.c_str());
}

'''

anchor = "void IC::TraceIC(const char* type, DirectHandle<Object> name) {"
if "TracePropertyLookupFile()" not in ic:
    ic = ic.replace(anchor, REPORTER.lstrip("\n") + anchor, 1)
    ic_dirty = True

# --- 3. the call site --------------------------------------------------------
# Placed before `if (use_ic)`, not inside it, so it does not depend on the
# cache-update path. Placed after LookupForRead so IsFound() reflects a finished
# lookup.
anchor = """  // Named lookup in the object.
  LookupForRead(&it, IsAnyHas());
"""
if "if (V8_UNLIKELY(v8_flags.trace_property_lookup)) {" not in ic:
    ic = ic.replace(
        anchor,
        anchor
        + """
  if (V8_UNLIKELY(v8_flags.trace_property_lookup)) {
    TracePropertyLookup(isolate(), receiver, name, it.IsFound());
  }
""",
        1,
    )
    ic_dirty = True

if ic_dirty:
    open(ic_path, "w").write(ic)

# --- 3b. the call hook ------------------------------------------------------
# Runtime_TraceEnter is what V8 already calls on every function entry under
# --trace. Its stock body prints a raw dump to stdout; when a record file is
# configured we emit a structured line instead, so this becomes another source
# for the one trace rather than a second channel with its own format.
if "TraceCallEnterEnabled()" not in rt:
    anchor = """RUNTIME_FUNCTION(Runtime_TraceEnter) {
  SealHandleScope shs(isolate);
  PrintIndentation(StackSize(isolate));
  JavaScriptFrame::PrintTop(isolate, stdout, true, false);
  PrintF(" {\\n");
  return ReadOnlyRoots(isolate).undefined_value();
}"""
    # Declared just inside the namespace this file already opens; the definitions
    # live in ic.cc. Anchoring on an include was fragile -- the one first tried is
    # not in this file at all, so the declaration silently went nowhere and the
    # build failed on an undeclared name.
    decl_anchor = "namespace v8 {\nnamespace internal {"
    decl = ("\n\n// Defined in src/ic/ic.cc by the obscura property-trace patch.\n"
            "bool TraceCallEnterEnabled();\n"
            "void TraceCallEnter(Isolate* isolate);")
    rt = rt.replace(decl_anchor, decl_anchor + decl, 1)
    rt_dirty = True

# The TraceExit forward-declaration is added later, after the enter block;
# guard it separately so re-running after a partial apply carries on.
if "void TraceCallExit(Isolate* isolate, Tagged<Object> value);" not in rt:
    decl_full = ("\n\n// Defined in src/ic/ic.cc by the obscura property-trace patch.\n"
                 "bool TraceCallEnterEnabled();\n"
                 "void TraceCallEnter(Isolate* isolate);\n"
                 "void TraceCallExit(Isolate* isolate, Tagged<Object> value);")
    decl_partial = ("\n\n// Defined in src/ic/ic.cc by the obscura property-trace patch.\n"
                    "bool TraceCallEnterEnabled();\n"
                    "void TraceCallEnter(Isolate* isolate);")
    rt = rt.replace(decl_partial, decl_full, 1)
    rt_dirty = True

# Replace Runtime_TraceExit body
if "v8::internal::TraceCallExit(isolate, obj);" not in rt:
    exit_anchor = """RUNTIME_FUNCTION(Runtime_TraceExit) {
  SealHandleScope shs(isolate);
  if (args.length() != 1) {
    return CrashUnlessFuzzing(isolate);
  }
  Tagged<Object> obj = args[0];
  PrintIndentation(StackSize(isolate));
  PrintF("} -> ");
  ShortPrint(obj);
  PrintF("\\n");
  return obj;  // return TOS
}"""
    rt = rt.replace(exit_anchor, """RUNTIME_FUNCTION(Runtime_TraceExit) {
  if (args.length() != 1) {
    return CrashUnlessFuzzing(isolate);
  }
  Tagged<Object> obj = args[0];
  if (v8::internal::TraceCallEnterEnabled()) {
    v8::internal::TraceCallExit(isolate, obj);
    return obj;
  }
  SealHandleScope shs(isolate);
  PrintIndentation(StackSize(isolate));
  PrintF("} -> ");
  ShortPrint(obj);
  PrintF("\\n");
  return obj;  // return TOS
}""", 1)
    rt_dirty = True

# Replace Runtime_TraceEnter body
if "v8::internal::TraceCallEnter(isolate);" not in rt:
    rt = rt.replace(anchor, """RUNTIME_FUNCTION(Runtime_TraceEnter) {
  if (v8::internal::TraceCallEnterEnabled()) {
    v8::internal::TraceCallEnter(isolate);
    return ReadOnlyRoots(isolate).undefined_value();
  }
  SealHandleScope shs(isolate);
  PrintIndentation(StackSize(isolate));
  JavaScriptFrame::PrintTop(isolate, stdout, true, false);
  PrintF(" {\\n");
  return ReadOnlyRoots(isolate).undefined_value();
}""", 1)
    rt_dirty = True

if rt_dirty:
    open(rt_path, "w").write(rt)

# --- 4. the flag -------------------------------------------------------------
if "trace_property_lookup" not in fl:
    anchor = 'DEFINE_BOOL(trace_temporal, false, "trace temporal code")'
    fl = fl.replace(
        anchor,
        anchor
        + """
// Added by obscura. Reports every property lookup that reaches the runtime, with
// the receiver's constructor name and whether the property was found. Pair with
// --no-lazy-feedback-allocation: a function that has not run enough times to be
// given a feedback vector loads properties through a generic runtime path that
// skips this entirely, which is most of page script. Do not pair with
// --no-use-ic, which pushes every load onto that same path and suppresses this.
DEFINE_BOOL(trace_property_lookup, false,
            "trace property lookups with receiver and resolution")
DEFINE_STRING(trace_property_lookup_file, nullptr,
              "file to write property lookup records to")""",
        1,
    )
    open(flags_path, "w").write(fl)
    fl_dirty = True

files = []
if ic_dirty: files.append("src/ic/ic.cc")
if rt_dirty: files.append("src/runtime/runtime-test.cc")
if fl_dirty: files.append("src/flags/flag-definitions.h")
print("patched " + " and ".join(files))
PY

cat <<'EOF'

Build obscura against the patched V8 without modifying Cargo.toml:

  V8_FROM_SOURCE=1 cargo build --release -p obscura-cli --bins \
    --features render \
    --config 'patch.crates-io.v8.path="vendor/rusty_v8"'

Run with both flags. The trace is silent without the first, and blind to page
script without the second:

  obscura --v8-flags "--trace-property-lookup --no-lazy-feedback-allocation" \
    fetch URL --dump text -o page.txt

Output goes to stdout, one line per lookup, so send the page dump elsewhere:

  proplookup HIT  Element.innerHTML             k.html
  proplookup MISS Navigator.__no_such_nav__     k.html
  proplookup MISS Widget.__no_such_widget__     k.html

This is a diagnostic build and nothing else.
EOF
