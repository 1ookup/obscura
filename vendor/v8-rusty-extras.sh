#!/usr/bin/env bash
# Bind small V8 APIs rusty_v8 v137.3.0 leaves unbound.
#
# `MarkAsUndetectable` is the only way to build `document.all`. Its defining
# behaviour -- `typeof document.all === "undefined"` while the object is still
# there and still indexable -- is the [[IsHTMLDDA]] slot, a spec-level V8
# feature. It cannot be emulated from JavaScript at all: nothing a script can
# define makes `typeof` lie. Shipping a half version, an ordinary object under
# the name, would answer `"object"` there and trade a missing property for a
# contradictory one.
#
# `SetCallAsFunctionHandler` goes with it: `document.all(id)` and
# `document.all("name")` are callable, which no plain object is.
#
# `StackFrame::GetScriptSource` lets diagnostics read the actual source for a
# frame realm. The upstream header exposes it alongside GetScriptName, but this
# rusty_v8 release binds the name/id methods and omits only the source method.
#
# vendor/rusty_v8 is gitignored (several GB of upstream source), so the change
# lives here as a script rather than as a diff, exactly like
# vendor/v8-property-trace.sh. Re-running is a no-op on an already-patched tree.
#
# Usage:
#   vendor/v8-rusty-extras.sh [vendor/rusty_v8]
#
# NOTE: the bindings exist only in a from-source build. Builds that link the
# prebuilt librusty_v8.a -- which is what Dockerfile and the release workflow
# do -- have no such symbols, so `install_document_all` finds the op absent and
# leaves `document.all` undefined, which is the behaviour those builds have
# today. Nothing regresses; the surface is simply not added there.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V8_DIR="${1:-$ROOT/vendor/rusty_v8}"

if [[ ! -f "$V8_DIR/src/binding.cc" || ! -f "$V8_DIR/src/template.rs" ]]; then
  echo "not a rusty_v8 checkout: $V8_DIR" >&2
  echo "  (expects <path>/src/binding.cc and <path>/src/template.rs)" >&2
  exit 1
fi

python3 - "$V8_DIR/src/binding.cc" "$V8_DIR/src/template.rs" "$V8_DIR/src/exception.rs" <<'PY'
import sys

binding_path, template_path, exception_path = sys.argv[1], sys.argv[2], sys.argv[3]
binding = open(binding_path).read()
template = open(template_path).read()
exception = open(exception_path).read()
dirty = []

# --- binding.cc -------------------------------------------------------------
# Anchored on SetImmutableProto, the last ObjectTemplate shim in the file.
anchor_cc = """void v8__ObjectTemplate__SetImmutableProto(const v8::ObjectTemplate& self) {
  return ptr_to_local(&self)->SetImmutableProto();
}
"""
addition_cc = """
void v8__ObjectTemplate__MarkAsUndetectable(const v8::ObjectTemplate& self) {
  return ptr_to_local(&self)->MarkAsUndetectable();
}

void v8__ObjectTemplate__SetCallAsFunctionHandler(
    const v8::ObjectTemplate& self, v8::FunctionCallback callback,
    const v8::Value* data_or_null) {
  return ptr_to_local(&self)->SetCallAsFunctionHandler(
      callback, ptr_to_local(data_or_null));
}
"""
if "v8__ObjectTemplate__MarkAsUndetectable" not in binding:
    if anchor_cc not in binding:
        sys.exit("binding.cc: SetImmutableProto anchor not found (rusty_v8 v137.3.0?)")
    binding = binding.replace(anchor_cc, anchor_cc + addition_cc, 1)
    dirty.append(binding_path)

stack_anchor_cc = """const v8::String* v8__StackFrame__GetScriptNameOrSourceURL(
    const v8::StackFrame& self) {
  return local_to_ptr(self.GetScriptNameOrSourceURL());
}
"""
stack_addition_cc = """
const v8::String* v8__StackFrame__GetScriptSource(
    const v8::StackFrame& self) {
  return local_to_ptr(self.GetScriptSource());
}
"""
if "v8__StackFrame__GetScriptSource" not in binding:
    if stack_anchor_cc not in binding:
        sys.exit("binding.cc: StackFrame GetScriptNameOrSourceURL anchor not found")
    binding = binding.replace(stack_anchor_cc, stack_anchor_cc + stack_addition_cc, 1)
    if binding_path not in dirty:
        dirty.append(binding_path)

# --- template.rs: extern declarations ---------------------------------------
anchor_extern = "  fn v8__ObjectTemplate__SetImmutableProto(this: *const ObjectTemplate);\n"
addition_extern = """  fn v8__ObjectTemplate__MarkAsUndetectable(this: *const ObjectTemplate);
  fn v8__ObjectTemplate__SetCallAsFunctionHandler(
    this: *const ObjectTemplate,
    callback: FunctionCallback,
    data_or_null: *const Value,
  );
"""
if "v8__ObjectTemplate__MarkAsUndetectable" not in template:
    if anchor_extern not in template:
        sys.exit("template.rs: SetImmutableProto extern anchor not found")
    template = template.replace(anchor_extern, anchor_extern + addition_extern, 1)
    dirty.append(template_path)

# --- template.rs: safe wrappers ---------------------------------------------
anchor_impl = """  #[inline(always)]
  pub fn set_immutable_proto(&self) {
    unsafe { v8__ObjectTemplate__SetImmutableProto(self) };
  }
"""
addition_impl = """
  /// Marks instances as undetectable: `typeof` answers "undefined" and the
  /// object is falsy, while its properties still resolve. This is the
  /// [[IsHTMLDDA]] behaviour `document.all` is defined to have, and there is
  /// no way to produce it from JavaScript.
  #[inline(always)]
  pub fn mark_as_undetectable(&self) {
    unsafe { v8__ObjectTemplate__MarkAsUndetectable(self) };
  }

  /// Makes instances callable, as `document.all(id)` is.
  #[inline(always)]
  pub fn set_call_as_function_handler(&self, callback: impl MapFnTo<FunctionCallback>) {
    unsafe {
      v8__ObjectTemplate__SetCallAsFunctionHandler(
        self,
        callback.map_fn_to(),
        std::ptr::null(),
      )
    };
  }
"""
if "pub fn mark_as_undetectable" not in template:
    if anchor_impl not in template:
        sys.exit("template.rs: set_immutable_proto anchor not found")
    template = template.replace(anchor_impl, anchor_impl + addition_impl, 1)
    if template_path not in dirty:
        dirty.append(template_path)

# --- exception.rs: StackFrame source binding --------------------------------
stack_anchor_extern = """  fn v8__StackFrame__GetScriptNameOrSourceURL(
    this: *const StackFrame,
  ) -> *const String;
"""
stack_addition_extern = """  fn v8__StackFrame__GetScriptSource(
    this: *const StackFrame,
  ) -> *const String;
"""
if "fn v8__StackFrame__GetScriptSource" not in exception:
    if stack_anchor_extern not in exception:
        sys.exit("exception.rs: StackFrame source extern anchor not found")
    exception = exception.replace(
        stack_anchor_extern, stack_anchor_extern + stack_addition_extern, 1)
    dirty.append(exception_path)

stack_anchor_impl = """  pub fn get_function_name<'s>(
    &self,
    scope: &mut HandleScope<'s>,
  ) -> Option<Local<'s, String>> {
    unsafe { scope.cast_local(|_| v8__StackFrame__GetFunctionName(self)) }
  }
"""
stack_addition_impl = """
  /// Returns the complete source text for the script containing this frame.
  #[inline(always)]
  pub fn get_script_source<'s>(
    &self,
    scope: &mut HandleScope<'s>,
  ) -> Option<Local<'s, String>> {
    unsafe { scope.cast_local(|_| v8__StackFrame__GetScriptSource(self)) }
  }
"""
if "pub fn get_script_source<'s>" not in exception:
    if stack_anchor_impl not in exception:
        sys.exit("exception.rs: StackFrame get_function_name anchor not found")
    exception = exception.replace(
        stack_anchor_impl, stack_anchor_impl + stack_addition_impl, 1)
    if exception_path not in dirty:
        dirty.append(exception_path)

if binding_path in dirty:
    open(binding_path, "w").write(binding)
if template_path in dirty:
    open(template_path, "w").write(template)
if exception_path in dirty:
    open(exception_path, "w").write(exception)

print("patched: " + ", ".join(dirty) if dirty else "already patched")
PY
