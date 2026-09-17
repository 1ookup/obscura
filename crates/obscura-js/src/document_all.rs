//! `document.all`, which cannot be built from JavaScript.
//!
//! Its defining behaviour is the spec's `[[IsHTMLDDA]]` slot: `typeof
//! document.all` answers `"undefined"` and the object is falsy, while its
//! properties still resolve and it is still callable. Nothing a script can
//! define makes `typeof` lie, so a JavaScript shim would have to answer
//! `"object"` there -- trading a missing property for a contradictory one,
//! which is worse. V8 exposes the slot as `ObjectTemplate::MarkAsUndetectable`;
//! `vendor/v8-rusty-extras.sh` binds it, because rusty_v8 v137.3.0 does not.
//!
//! Everything the collection actually contains stays in JavaScript. The
//! interceptors here forward to `__obscura_document_all_resolve(kind, key)`,
//! which answers `[value]` to intercept and `undefined` to decline, so that
//! `undefined` remains a value the collection can legitimately hold. Keeping
//! the DOM walk on the JS side means this file never needs to know how
//! elements are stored.

use deno_core::v8;

/// The JS hook the interceptors forward to.
const RESOLVER: &str = "__obscura_document_all_resolve";
/// Where the instantiated collection is left for the bootstrap to pick up.
const INSTALLED: &str = "__obscura_document_all";

/// Ask the realm's resolver about one lookup. `Some(value)` means intercept.
fn resolve<'s>(
    scope: &mut v8::HandleScope<'s>,
    kind: &str,
    key: v8::Local<'s, v8::Value>,
) -> Option<v8::Local<'s, v8::Value>> {
    let context = scope.get_current_context();
    let global = context.global(scope);
    let name = v8::String::new(scope, RESOLVER)?;
    let resolver = global.get(scope, name.into())?;
    let resolver = v8::Local::<v8::Function>::try_from(resolver).ok()?;
    let kind = v8::String::new(scope, kind)?;
    let receiver = v8::undefined(scope).into();
    // A resolver that throws must not propagate: an interceptor is entered
    // from arbitrary property access, including V8's own internal lookups.
    let result = {
        let catcher = &mut v8::TryCatch::new(scope);
        let result = resolver.call(catcher, receiver, &[kind.into(), key]);
        if catcher.has_caught() { None } else { result }
    };
    // Declining is `undefined`; intercepting is a one-element array, so that a
    // collection slot holding `undefined` stays distinguishable from a miss.
    let wrapper = v8::Local::<v8::Array>::try_from(result?).ok()?;
    wrapper.get_index(scope, 0)
}

fn named_getter<'s>(
    scope: &mut v8::HandleScope<'s>,
    name: v8::Local<'s, v8::Name>,
    _args: v8::PropertyCallbackArguments<'s>,
    mut rv: v8::ReturnValue<v8::Value>,
) -> v8::Intercepted {
    // Symbols reach the named interceptor too. Declining leaves
    // `Symbol.toStringTag` and the iterator to the prototype, where the
    // bootstrap puts them.
    if name.is_symbol() {
        return v8::Intercepted::No;
    }
    match resolve(scope, "name", name.into()) {
        Some(value) => {
            rv.set(value);
            v8::Intercepted::Yes
        }
        None => v8::Intercepted::No,
    }
}

fn indexed_getter<'s>(
    scope: &mut v8::HandleScope<'s>,
    index: u32,
    _args: v8::PropertyCallbackArguments<'s>,
    mut rv: v8::ReturnValue<v8::Value>,
) -> v8::Intercepted {
    let key = v8::Number::new(scope, f64::from(index)).into();
    match resolve(scope, "index", key) {
        Some(value) => {
            rv.set(value);
            v8::Intercepted::Yes
        }
        None => v8::Intercepted::No,
    }
}

/// `document.all(id)` and `document.all(index)`: the collection is callable,
/// which no ordinary object is.
fn call_as_function<'s>(
    scope: &mut v8::HandleScope<'s>,
    args: v8::FunctionCallbackArguments<'s>,
    mut rv: v8::ReturnValue<v8::Value>,
) {
    let key = if args.length() > 0 {
        args.get(0)
    } else {
        v8::undefined(scope).into()
    };
    match resolve(scope, "call", key) {
        Some(value) => rv.set(value),
        None => rv.set(v8::null(scope).into()),
    }
}

/// Build the collection and leave it on the realm's global for the bootstrap.
///
/// Returns false when the object could not be created, which is how a build
/// without the vendored bindings behaves: the bootstrap then leaves
/// `document.all` absent rather than substituting something detectably wrong.
pub(crate) fn install(scope: &mut v8::HandleScope, context: v8::Local<v8::Context>) -> bool {
    let template = v8::ObjectTemplate::new(scope);
    template.mark_as_undetectable();
    template.set_call_as_function_handler(call_as_function);
    template.set_named_property_handler(
        v8::NamedPropertyHandlerConfiguration::new().getter(named_getter),
    );
    template.set_indexed_property_handler(
        v8::IndexedPropertyHandlerConfiguration::new().getter(indexed_getter),
    );
    let Some(collection) = template.new_instance(scope) else {
        return false;
    };
    let global = context.global(scope);
    let Some(key) = v8::String::new(scope, INSTALLED) else {
        return false;
    };
    global.set(scope, key.into(), collection.into());
    true
}
