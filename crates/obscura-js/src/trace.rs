//! Native iv8-style browser API call monitor.
//!
//! The page surface in Obscura is mostly implemented by JavaScript functions
//! baked into the startup snapshot.  iv8 records calls in the native WebIDL
//! callback, so a V8 `--trace` entry/exit hook cannot see those functions.  This
//! module installs a native callback trampoline on the real API descriptors
//! after a realm has been initialized.  The trampoline keeps the original
//! function and delegates to it with the original receiver and arguments.  It
//! is deliberately not a Proxy and does not add a visible property or
//! prototype layer.

use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use deno_core::v8;

// deno_core owns embedder data slot 0 for JsRuntimeState. Keep the trace
// monitor in a separate slot so native module/worker callbacks see the real
// runtime state instead of the trace state pointer.
pub(crate) const NATIVE_TRACE_DATA_SLOT: u32 = 1;

/// A process-wide append sink lets page and worker isolates write one trace
/// stream without truncating each other's records.  Each write is one line
/// under the mutex, so records from concurrent workers cannot interleave.
fn sink(path: &PathBuf) -> Option<Arc<Mutex<File>>> {
    static SINKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<File>>>>> = OnceLock::new();
    let sinks = SINKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut sinks = sinks.lock().ok()?;
    if let Some(file) = sinks.get(path) {
        return Some(file.clone());
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()?;
    let file = Arc::new(Mutex::new(file));
    sinks.insert(path.clone(), file.clone());
    Some(file)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
enum ReflectionKind {
    ObjectKeys,
    ObjectGetOwnPropertyNames,
    ObjectGetOwnPropertySymbols,
    ObjectGetOwnPropertyDescriptor,
    ObjectGetOwnPropertyDescriptors,
    ObjectHasOwn,
    ObjectDefineProperty,
    ObjectDefineProperties,
    ObjectGetPrototypeOf,
    ObjectSetPrototypeOf,
    ReflectHas,
    ReflectGet,
    ReflectOwnKeys,
    ReflectGetOwnPropertyDescriptor,
    ReflectGetPrototypeOf,
    ReflectSetPrototypeOf,
    JsonParse,
    JsonStringify,
    RegExpTest,
    RegExpExec,
    StringMatch,
    StringSearch,
    FunctionToString,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
enum EntryKind {
    Call,
    Reflection(ReflectionKind),
}

/// Metadata passed to the V8 callback through `v8::External`.  Entries live in
/// a `Vec<Box<_>>`, so the pointee address remains stable while the vector
/// grows.  They are retained until isolate teardown because a V8 function may
/// outlive the descriptor that originally held it.
struct TraceEntry {
    state: *mut NativeTraceState,
    original: v8::Global<v8::Function>,
    kind: EntryKind,
    /// Exact path for globals/nested objects, or the interface name for a
    /// prototype method (e.g. `Document`).
    base: String,
    property: String,
    prototype: bool,
    holder_hash: i32,
}

pub(crate) struct NativeTraceState {
    sink: Option<Arc<Mutex<File>>>,
    ignore: HashSet<String>,
    watches: HashSet<String>,
    devtools_enabled: bool,
    /// `(holder identity hash, property, kind)` slots already replaced.
    wrapped: HashSet<(i32, String, EntryKind)>,
    seen_holders: HashSet<i32>,
    entries: Vec<Box<TraceEntry>>,
    /// Own string fields written to ObjectTemplate-backed browser instances.
    /// V8's ordinary define/set path re-enters a named interceptor and cannot
    /// materialize an unresolved store on these objects, so keep those fields
    /// in native slots and expose them through the same getter/query hooks.
    slots: HashMap<(i32, String), v8::Global<v8::Value>>,
    /// Own names grouped by the interface whose prototype was visited, plus
    /// the parent interface relation used for fast receiver checks.
    interface_properties: HashMap<String, HashSet<String>>,
    interface_parents: HashMap<String, String>,
    /// A pointer to the runtime-owned per-isolate suppression byte. The byte
    /// is stable for the isolate's lifetime and is shared by native callbacks
    /// while bootstrap and internal formatting are running.
    suppressed: *mut u8,
}

impl NativeTraceState {
    pub(crate) fn from_environment(suppressed: *mut u8) -> Self {
        let path = std::env::var_os("OBSCURA_TRACE_API_FILE").map(PathBuf::from);
        let ignore = std::env::var("OBSCURA_TRACE_API_IGNORE")
            .ok()
            .into_iter()
            .flat_map(|value| value.split(',').map(str::to_string).collect::<Vec<_>>())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let watches = std::env::var("OBSCURA_TRACE_API_WATCH")
            .ok()
            .into_iter()
            .flat_map(|value| value.split(',').map(str::to_string).collect::<Vec<_>>())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let devtools_enabled = std::env::var_os("OBSCURA_TRACE_API_DEVTOOLS").is_some();
        Self {
            sink: path.as_ref().and_then(sink),
            ignore,
            watches,
            devtools_enabled,
            wrapped: HashSet::new(),
            seen_holders: HashSet::new(),
            entries: Vec::new(),
            slots: HashMap::new(),
            interface_properties: HashMap::new(),
            interface_parents: HashMap::new(),
            suppressed,
        }
    }

    pub(crate) fn enabled(&self) -> bool {
        self.sink.is_some()
    }

    fn should_record(&self, path: &str) -> bool {
        self.enabled()
            && !self.ignore.contains(path)
            && path != "window.window"
            && path != "window.navigator"
            && !path.starts_with("window.__obscura_")
    }

    fn instance_path(
        &self,
        scope: &mut v8::HandleScope,
        receiver: v8::Local<v8::Object>,
        hint: &str,
        property: &str,
    ) -> String {
        if hint != "node" {
            return format!("{hint}.{property}");
        }
        let constructor = receiver.get_constructor_name().to_rust_string_lossy(scope);
        let mut owner = interface_instance_name(&constructor, "Node");
        if owner == "element" {
            if let Some(key) = v8::String::new(scope, "localName") {
                let local = self.with_suppressed(|| receiver.get(scope, key.into()));
                if let Some(local) = local.filter(|value| value.is_string()) {
                    let name = local.to_rust_string_lossy(scope);
                    if !name.is_empty() {
                        owner = name.to_ascii_lowercase();
                    }
                }
            }
        }
        format!("{owner}.{property}")
    }

    fn native_get<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        key: v8::Local<'s, v8::Name>,
        args: v8::PropertyCallbackArguments<'s>,
        mut rv: v8::ReturnValue<v8::Value>,
    ) -> v8::Intercepted {
        if !self.enabled() || !key.is_string() {
            return v8::Intercepted::No;
        }
        let property = key.to_rust_string_lossy(scope);
        let suppressed = !self.suppressed.is_null() && unsafe { *self.suppressed != 0 };
        if suppressed || !Self::called_from_page(scope) {
            // Accessors invoked while a native trampoline runs often read the
            // private slots initialized by the same constructor (for example
            // Element.style -> this._style). Expose only those slots during
            // suppression; all other names continue through V8's ordinary
            // lookup without generating trace records.
            if suppressed {
                let slot_key = (args.this().get_identity_hash().get(), property);
                if let Some(slot) = self.slots.get(&slot_key) {
                    rv.set(v8::Local::new(scope, slot));
                    return v8::Intercepted::Yes;
                }
            }
            return v8::Intercepted::No;
        }
        if property.starts_with("__obscura_") || is_ecma_method(&property) {
            return v8::Intercepted::No;
        }
        let hint = args.data().to_rust_string_lossy(scope);
        let receiver = args.this();
        let path = self.instance_path(scope, receiver, &hint, &property);
        let category = if hint.ends_with(".prototype") {
            "原型访问"
        } else {
            "实例访问"
        };
        let slot_key = (receiver.get_identity_hash().get(), property.clone());
        if let Some(slot) = self.slots.get(&slot_key) {
            let value = v8::Local::new(scope, slot);
            if self.should_record(&path) && !value.is_function() {
                self.trigger_watch(scope, &path);
                self.write(&format!(
                    "{category} - {path} -> getter -> {}",
                    Self::render_value(scope, value)
                ));
            }
            rv.set(value);
            return v8::Intercepted::Yes;
        }
        let value = self.with_suppressed(|| receiver.get_real_named_property(scope, key));
        let Some(value) = value else {
            if self.should_record(&path) {
                self.trigger_watch(scope, &path);
                self.write(&format!("{category} - {path} -> getter -> undefined"));
            }
            if !hint.ends_with(".prototype") {
                self.record_prototype_misses(scope, receiver, &property);
            }
            return v8::Intercepted::No;
        };
        // iv8 emits browser method calls at the callback, not as a generic
        // function-valued getter. Keep the function itself unchanged and let
        // the native trampoline below record the eventual invocation.
        if self.should_record(&path) && !value.is_function() {
            self.trigger_watch(scope, &path);
            self.write(&format!(
                "{category} - {path} -> getter -> {}",
                Self::render_value(scope, value)
            ));
        }
        rv.set(value);
        v8::Intercepted::Yes
    }

    fn record_prototype_misses(
        &self,
        scope: &mut v8::HandleScope,
        receiver: v8::Local<v8::Object>,
        property: &str,
    ) {
        // Do not walk or invoke arbitrary prototype accessors from inside a
        // V8 named-property callback. The receiver's constructor is enough to
        // reproduce iv8's browser interface miss layers and keeps the miss
        // path strictly side-effect free.
        let constructor = receiver.get_constructor_name().to_rust_string_lossy(scope);
        let owner = interface_instance_name(&constructor, &constructor);
        let mut owners = Vec::new();
        if owner == "element" {
            owners.extend(["Element", "Node"]);
        } else if constructor == "Window" || constructor == "Global" {
            owners.push("Window");
        } else if !constructor.is_empty()
            && constructor != "Object"
        {
            owners.push(constructor.as_str());
        }
        let mut seen = HashSet::new();
        for owner in owners {
            let path = format!("{owner}.prototype.{property}");
            if seen.insert(path.clone()) && self.should_record(&path) {
                self.trigger_watch(scope, &path);
                self.write(&format!("原型访问 - {path} -> getter -> undefined"));
            }
        }
    }

    fn native_set<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        key: v8::Local<'s, v8::Name>,
        value: v8::Local<'s, v8::Value>,
        args: v8::PropertyCallbackArguments<'s>,
        _rv: v8::ReturnValue<()>,
    ) -> v8::Intercepted {
        if !self.enabled() || !key.is_string() {
            return v8::Intercepted::No;
        }
        let suppressed = !self.suppressed.is_null() && unsafe { *self.suppressed != 0 };
        if suppressed || !Self::called_from_page(scope) {
            // Suppressed calls are the original browser implementation being
            // executed from a native trampoline. Do not call any V8 property
            // lookup or CreateDataProperty path on an interceptor receiver:
            // unresolved stores there raise a conversion TypeError. The
            // original browser implementation only uses this path for its
            // private string slots, so retain every suppressed string store
            // natively and claim it explicitly.
            let property = key.to_rust_string_lossy(scope);
            if self.interface_property_exists(scope, args.this(), &property) {
                // Let the actual WebIDL setter on the prototype run. This is
                // essential for reflection-backed fields such as id, width,
                // and style; claiming the store here would only shadow the
                // accessor with a native slot and skip its DOM mutation.
                return v8::Intercepted::No;
            }
            self.slots.insert(
                (args.this().get_identity_hash().get(), property),
                v8::Global::new(scope, value),
            );
            return v8::Intercepted::Yes;
        }
        let property = key.to_rust_string_lossy(scope);
        if property.starts_with("__obscura_") || is_ecma_method(&property) {
            return v8::Intercepted::No;
        }
        let hint = args.data().to_rust_string_lossy(scope);
        if hint.ends_with(".prototype") {
            return v8::Intercepted::No;
        }
        // ObjectTemplate interceptors receive stores for both inherited
        // accessors (for example `element.id`) and brand-new implementation
        // fields (for example the `_style` slot initialized by Element's
        // constructor). `Object::set` is correct for the former, but on an
        // interceptor-backed object V8 cannot complete the unresolved store
        // for the latter and reports "Cannot convert undefined or null to
        // object". Resolve the distinction before recording and use a direct
        // own-data definition for a missing property.
        let receiver_hash = args.this().get_identity_hash().get();
        let property_exists = self.slots.contains_key(&(receiver_hash, property.clone()))
            || self.interface_property_exists(scope, args.this(), &property);
        let path = self.instance_path(scope, args.this(), &hint, &property);
        if self.should_record(&path) {
            self.trigger_watch(scope, &path);
            self.write(&format!(
                "实例访问 - {path} -> setter -> setter({}) -> undefined",
                Self::render_value(scope, value)
            ));
        }
        // Claim the store after applying ordinary data/accessor semantics under
        // suppression. Returning kYes is required for ObjectTemplate setters
        // on a missing name; returning kNo leaves V8 with an unresolved
        // interceptor store and surfaces a spurious TypeError.
        if !property_exists {
            // A named setter that reports `kNo` hands the store back to V8's
            // ordinary property path. On an ObjectTemplate with an
            // interceptor that path is unresolved and raises a conversion
            // TypeError. With the native definer installed, direct definition
            // preserves ordinary own-property enumeration. Keep a native slot
            // fallback for V8 revisions that still decline the definition.
            let defined = self.with_suppressed(|| {
                args.this().define_own_property(
                    scope,
                    key,
                    value,
                    v8::PropertyAttribute::NONE,
                )
            });
            if defined != Some(true) {
                self.slots.insert(
                    (args.this().get_identity_hash().get(), property),
                    v8::Global::new(scope, value),
                );
            }
            return v8::Intercepted::Yes;
        }
        if self
            .slots
            .contains_key(&(args.this().get_identity_hash().get(), property.clone()))
        {
            self.slots.insert(
                (args.this().get_identity_hash().get(), property),
                v8::Global::new(scope, value),
            );
            return v8::Intercepted::Yes;
        }
        let stored = self.with_suppressed(|| args.this().set(scope, key.into(), value));
        if stored == Some(true) { v8::Intercepted::Yes } else { v8::Intercepted::No }
    }

    fn native_query<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        key: v8::Local<'s, v8::Name>,
        args: v8::PropertyCallbackArguments<'s>,
        _rv: v8::ReturnValue<v8::Integer>,
    ) -> v8::Intercepted {
        if !self.enabled()
            || (!self.suppressed.is_null() && unsafe { *self.suppressed != 0 })
            || !Self::called_from_page(scope)
            || !key.is_string()
        {
            return v8::Intercepted::No;
        }
        let property = key.to_rust_string_lossy(scope);
        if property.starts_with("__obscura_") || is_ecma_method(&property) {
            return v8::Intercepted::No;
        }
        let hint = args.data().to_rust_string_lossy(scope);
        if hint.ends_with(".prototype") {
            return v8::Intercepted::No;
        }
        let path = self.instance_path(scope, args.this(), &hint, &property);
        let receiver = args.this();
        let property = key.to_rust_string_lossy(scope);
        let exists = self.slots.contains_key(&(receiver.get_identity_hash().get(), property.clone()))
            || self.interface_property_exists(scope, receiver, &property);
        if exists {
            if self.should_record(&path) {
                self.trigger_watch(scope, &path);
                self.write(&format!("实例访问 - {path} -> query -> exists"));
            }
        }
        v8::Intercepted::No
    }

    fn native_global_query<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        key: v8::Local<'s, v8::Name>,
        args: v8::PropertyCallbackArguments<'s>,
        rv: v8::ReturnValue<v8::Integer>,
    ) -> v8::Intercepted {
        self.native_query(scope, key, args, rv)
    }

    fn native_global_set<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        key: v8::Local<'s, v8::Name>,
        value: v8::Local<'s, v8::Value>,
        args: v8::PropertyCallbackArguments<'s>,
        rv: v8::ReturnValue<()>,
    ) -> v8::Intercepted {
        if !self.enabled() || !key.is_string() {
            return v8::Intercepted::No;
        }
        let suppressed = !self.suppressed.is_null() && unsafe { *self.suppressed != 0 };
        if suppressed || !Self::called_from_page(scope) {
            return v8::Intercepted::No;
        }
        let property = key.to_rust_string_lossy(scope);
        if property.starts_with("__obscura_") || is_ecma_method(&property) {
            return v8::Intercepted::No;
        }
        let path = format!("window.{property}");
        if self.should_record(&path) {
            self.trigger_watch(scope, &path);
            self.write(&format!(
                "实例访问 - {path} -> setter -> setter({}) -> undefined",
                Self::render_value(scope, value)
            ));
        }
        // The global object has a real default store path. Leave the actual
        // assignment to V8 so global own-property descriptors and setters keep
        // their ordinary semantics; this callback is observation-only.
        let _ = (args, rv);
        v8::Intercepted::No
    }

    pub(crate) fn global_template_middleware<'s>(
        scope: &mut v8::HandleScope<'s, ()>,
        template: v8::Local<'s, v8::ObjectTemplate>,
    ) -> v8::Local<'s, v8::ObjectTemplate> {
        let Some(data) = v8::String::new(scope, "window") else {
            return template;
        };
        template.set_named_property_handler(
            v8::NamedPropertyHandlerConfiguration::new()
                .getter(native_global_get)
                .setter(native_global_set)
                .query(native_global_query)
                .data(data.into()),
        );
        template
    }

    fn interface_property_exists(
        &self,
        scope: &mut v8::HandleScope,
        object: v8::Local<v8::Object>,
        property: &str,
    ) -> bool {
        let constructor = object.get_constructor_name().to_rust_string_lossy(scope);
        let mut interface = if constructor == "_ScopedDocument" {
            "Document".to_string()
        } else if constructor.is_empty() {
            "Object".to_string()
        } else {
            constructor
        };
        for _ in 0..32 {
            if self
                .interface_properties
                .get(&interface)
                .is_some_and(|names| names.contains(property))
            {
                return true;
            }
            let Some(parent) = self.interface_parents.get(&interface) else {
                break;
            };
            interface = parent.clone();
        }
        false
    }

    pub(crate) fn new_native_object<'s>(
        scope: &mut v8::HandleScope<'s>,
        path: &str,
    ) -> Option<v8::Local<'s, v8::Object>> {
        let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
            as *mut NativeTraceState;
        if state.is_null() {
            return None;
        }
        // SAFETY: slot 0 is set to the Box-owned state for this isolate and
        // the object can only be created while that isolate is entered.
        if unsafe { !(*state).enabled() } {
            return None;
        }
        let data = v8::String::new(scope, path)?.into();
        let template = v8::ObjectTemplate::new(scope);
        template.set_named_property_handler(
            v8::NamedPropertyHandlerConfiguration::new()
                .getter(native_instance_get)
                .setter(native_instance_set)
                .query(native_instance_query)
                .definer(native_instance_define)
                .data(data),
        );
        template.new_instance(scope)
    }

    fn native_define<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        key: v8::Local<'s, v8::Name>,
        descriptor: &v8::PropertyDescriptor,
        args: v8::PropertyCallbackArguments<'s>,
        _rv: v8::ReturnValue<()>,
    ) -> v8::Intercepted {
        if !self.enabled() || !key.is_string() {
            return v8::Intercepted::No;
        }
        // The nested DefineOwnProperty call below reaches this same callback.
        // Returning kNo in the suppressed pass asks V8 to perform its ordinary
        // own-property definition, while the outer pass claims the request.
        if !self.suppressed.is_null() && unsafe { *self.suppressed != 0 } {
            return v8::Intercepted::No;
        }
        let stored = self.with_suppressed(|| {
            args.this().define_property(scope, key, descriptor)
        });
        if stored == Some(true) {
            v8::Intercepted::Yes
        } else {
            v8::Intercepted::No
        }
    }

    fn write(&self, line: &str) {
        let Some(sink) = &self.sink else { return };
        let Ok(mut file) = sink.lock() else { return };
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }

    fn trigger_watch<'s>(&self, scope: &mut v8::HandleScope<'s>, path: &str) {
        if !self.devtools_enabled || !self.watches.contains(path) {
            return;
        }
        // This is the same source-injected breakpoint shape used by iv8:
        // `debugger;` is compiled in the realm that performed the access, and
        // the path is retained in a bounded single-line comment for inspector
        // diagnostics. With no attached inspector V8 treats it as a no-op.
        let mut source = String::from("debugger; // ");
        for character in path.chars().take(240) {
            source.push(if matches!(character, '\n' | '\r' | '\0') {
                ' '
            } else {
                character
            });
        }
        let Some(source) = v8::String::new(scope, &source) else { return };
        let catcher = &mut v8::TryCatch::new(scope);
        let Some(script) = v8::Script::compile(catcher, source, None) else { return };
        let _ = script.run(catcher);
    }

    fn with_suppressed<R>(&self, f: impl FnOnce() -> R) -> R {
        if self.suppressed.is_null() {
            return f();
        }
        // SAFETY: the pointer is allocated by ObscuraJsRuntime and this
        // callback cannot outlive that runtime/isolate.
        let previous = unsafe { *self.suppressed };
        unsafe { *self.suppressed = 1; }
        let result = f();
        unsafe { *self.suppressed = previous; }
        result
    }

    fn with_suppressed_mut<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        if self.suppressed.is_null() {
            return f(self);
        }
        // SAFETY: the pointer is allocated by ObscuraJsRuntime and this
        // callback cannot outlive that runtime/isolate.
        let previous = unsafe { *self.suppressed };
        unsafe { *self.suppressed = 1; }
        let result = f(self);
        unsafe { *self.suppressed = previous; }
        result
    }

    fn add_entry_with_scope<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        original: v8::Local<'s, v8::Function>,
        kind: EntryKind,
        base: String,
        property: String,
        prototype: bool,
        holder_hash: i32,
    ) -> *mut TraceEntry {
        let state = self as *mut NativeTraceState;
        let entry = Box::new(TraceEntry {
            state,
            original: v8::Global::new(scope, original),
            kind,
            base,
            property,
            prototype,
            holder_hash,
        });
        let ptr = (&*entry) as *const TraceEntry as *mut TraceEntry;
        self.entries.push(entry);
        ptr
    }

    fn path(&self, entry: &TraceEntry, scope: &mut v8::HandleScope, this: v8::Local<v8::Object>) -> String {
        if !entry.prototype {
            return format!("{}.{}", entry.base, entry.property);
        }
        if this.get_identity_hash().get() == entry.holder_hash {
            return format!("{}.prototype.{}", entry.base, entry.property);
        }
        let owner = this.get_constructor_name().to_rust_string_lossy(scope);
        let mut owner = interface_instance_name(&owner, &entry.base);
        // Obscura's generic DOM wrapper intentionally uses the shared
        // `Element` constructor. iv8 names an instance by its HTML localName
        // (`div.getAttribute`, `canvas.getContext`), which is available through
        // the real DOM getter without adding a visible marker. Read it only
        // for the shared Element/Node holders and under trace suppression.
        if owner == "element" && matches!(entry.base.as_str(), "Node" | "Element" | "HTMLElement") {
            if let Some(key) = v8::String::new(scope, "localName") {
                let local = self.with_suppressed(|| this.get(scope, key.into()));
                if let Some(local) = local.filter(|value| value.is_string()) {
                    let name = local.to_rust_string_lossy(scope);
                    if !name.is_empty() {
                        owner = name.to_ascii_lowercase();
                    }
                }
            }
        }
        format!("{}.{}", owner, entry.property)
    }

    fn render_value(scope: &mut v8::HandleScope, value: v8::Local<v8::Value>) -> String {
        if value.is_undefined() {
            return "undefined".to_string();
        }
        if value.is_null() {
            return "null".to_string();
        }
        if value.is_boolean() {
            return format!("boolean:{}", value.is_true());
        }
        if value.is_number() {
            return format!("number:{}", value.number_value(scope).unwrap_or(f64::NAN));
        }
        if value.is_string() {
            let mut text = value.to_rust_string_lossy(scope);
            if text.len() > 160 {
                text.truncate(157);
                text.push_str("...");
            }
            text = text.replace(['\t', '\r', '\n'], " ");
            return format!("string:\"{text}\"");
        }
        if value.is_function() {
            let function = v8::Local::<v8::Function>::try_from(value).ok();
            let name = function
                .map(|function| function.get_name(scope).to_rust_string_lossy(scope))
                .unwrap_or_default();
            return format!("function {name}() {{ [native code] }}");
        }
        if value.is_object() {
            if let Ok(object) = v8::Local::<v8::Object>::try_from(value) {
                let name = object.get_constructor_name().to_rust_string_lossy(scope);
                return format!("[object {}]", if name.is_empty() { "Object" } else { &name });
            }
        }
        "other".to_string()
    }

    fn render_arguments(scope: &mut v8::HandleScope, args: &v8::FunctionCallbackArguments) -> String {
        (0..args.length())
            .map(|index| Self::render_value(scope, args.get(index)))
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn render_exception(
        &self,
        scope: &mut v8::HandleScope,
        value: v8::Local<v8::Value>,
    ) -> String {
        let Ok(object) = v8::Local::<v8::Object>::try_from(value) else {
            return Self::render_value(scope, value);
        };
        let constructor = object.get_constructor_name().to_rust_string_lossy(scope);
        let Some(message_key) = v8::String::new(scope, "message") else {
            return Self::render_value(scope, value);
        };
        let message = self.with_suppressed(|| object.get(scope, message_key.into()))
            .filter(|value| value.is_string())
            .map(|value| value.to_rust_string_lossy(scope))
            .unwrap_or_default();
        if constructor.is_empty() || message.is_empty() {
            Self::render_value(scope, value)
        } else {
            format!("{constructor}: {message}")
        }
    }

    fn called_from_page(scope: &mut v8::HandleScope) -> bool {
        let Some(stack) = v8::StackTrace::current_stack_trace(scope, 12) else {
            return false;
        };
        for index in 0..stack.get_frame_count() {
            let Some(frame) = stack.get_frame(scope, index) else { continue };
            let script_name = frame
                .get_script_name_or_source_url(scope)
                .map(|name| name.to_rust_string_lossy(scope));
            // Worker author code is deliberately executed with an internal
            // resource label so the host can distinguish it from bootstrap
            // tasks. Treat that one label as page code for tracing; all other
            // <obscura:...>, ext:, and deno: frames remain suppressed.
            let worker_author = script_name.as_deref() == Some("<obscura:worker-script>");
            // Data/blob workers can carry their source URL as the frame name
            // instead of the host label above. Those schemes are only
            // author-created worker scripts in this runtime, so classify them
            // as user code while preserving the internal-frame filters.
            let url_worker_author = script_name.as_deref().is_some_and(|name| {
                name.starts_with("data:") || name.starts_with("blob:")
            });
            let internal = script_name.is_some_and(|name| {
                (name.starts_with("<obscura:") && !worker_author)
                    || name.starts_with("ext:")
                    || name.starts_with("deno:")
            });
            if worker_author
                || url_worker_author
                || (!internal && frame.is_user_javascript())
            {
                return true;
            }
        }
        false
    }

    fn invoke<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        args: v8::FunctionCallbackArguments<'s>,
        mut rv: v8::ReturnValue<v8::Value>,
        entry: &TraceEntry,
    ) {
        if let EntryKind::Reflection(kind) = entry.kind {
            self.invoke_reflection(scope, args, rv, entry, kind);
            return;
        }
        let original = v8::Local::new(scope, &entry.original);
        let receiver = args.this().into();
        let argv = (0..args.length())
            .map(|index| args.get(index))
            .collect::<Vec<_>>();
        let nested = !self.suppressed.is_null() && unsafe { *self.suppressed != 0 };
        let page_call = !nested && Self::called_from_page(scope);
        let path = page_call.then(|| self.path(entry, scope, args.this()));
        let arguments = (!nested).then(|| Self::render_arguments(scope, &args));
        let (called, exception_detail) = {
            let catcher = &mut v8::TryCatch::new(scope);
            let called = self.with_suppressed(|| {
                if args.is_construct_call() {
                    original
                        .new_instance(catcher, &argv)
                        .map(|object| object.into())
                } else {
                    original.call(catcher, receiver, &argv)
                }
            });
            if called.is_some() {
                (called, None)
            } else if catcher.has_caught() {
                let detail = catcher
                    .exception()
                    .map(|value| self.render_exception(catcher, value))
                    .unwrap_or_else(|| "Error".to_string());
                // Preserve the original exception semantics. ReThrow removes
                // it from this catcher and leaves it pending for the caller.
                let _ = catcher.rethrow();
                (None, Some(detail))
            } else {
                (None, None)
            }
        };
        if let Some(value) = called {
            // Browser APIs frequently return a fresh host object (for example
            // `document.createElement()` or `canvas.getContext()`). Discover
            // its own browser methods now so a later page call is observed even
            // though the object did not exist during realm installation. The
            // traversal runs under the same isolate suppression as bootstrap
            // setup and never changes the returned object's identity.
            if let Ok(object) = v8::Local::<v8::Object>::try_from(value) {
                let base = path.as_deref().unwrap_or(&entry.base).to_string();
                self.with_suppressed_mut(|state| {
                    state.visit_object(scope, object, &base, None);
                });
            }
            if let Some(path) = path.as_deref() {
                self.trigger_watch(scope, path);
            }
            if let Some(path) = path.as_deref().filter(|path| self.should_record(path)) {
                self.write(&format!(
                    "实例访问 - {path} -> call -> ({}) -> {}",
                    arguments.as_deref().unwrap_or(""),
                    Self::render_value(scope, value)
                ));
            }
            rv.set(value);
            return;
        }
        if let Some(detail) = exception_detail {
            if let Some(path) = path.as_deref().filter(|path| self.should_record(path)) {
                self.write(&format!(
                    "实例访问 - {path} -> call -> ({}) -> 异常: {detail}",
                    arguments.as_deref().unwrap_or("")
                ));
            }
        }
    }

    fn invoke_reflection<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        args: v8::FunctionCallbackArguments<'s>,
        mut rv: v8::ReturnValue<v8::Value>,
        entry: &TraceEntry,
        _kind: ReflectionKind,
    ) {
        let original = v8::Local::new(scope, &entry.original);
        let receiver = args.this().into();
        let argv = (0..args.length())
            .map(|index| args.get(index))
            .collect::<Vec<_>>();
        let arguments = Self::render_arguments(scope, &args);
        let suppressed = !self.suppressed.is_null() && unsafe { *self.suppressed != 0 };
        let path = if entry.prototype {
            format!("{}.prototype.{}", entry.base, entry.property)
        } else {
            format!("{}.{}", entry.base, entry.property)
        };
        let (called, exception_detail) = {
            let catcher = &mut v8::TryCatch::new(scope);
            // The reference reflection monitor lets the builtin run normally;
            // nested browser reads (for example Reflect.get(navigator, ...))
            // therefore remain visible to the native lookup monitor. Only
            // value formatting below is suppressed where it may inspect an
            // object for its constructor/tag.
            let called = original.call(catcher, receiver, &argv);
            if called.is_some() {
                (called, None)
            } else if catcher.has_caught() {
                let detail = catcher
                    .exception()
                    .map(|value| self.render_exception(catcher, value))
                    .unwrap_or_else(|| "Error".to_string());
                let _ = catcher.rethrow();
                (None, Some(detail))
            } else {
                (None, None)
            }
        };
        if let Some(value) = called {
            if !suppressed && self.should_record(&path) {
                self.write(&format!(
                    "反射访问 - {path} -> call -> ({arguments}) -> {}",
                    Self::render_value(scope, value)
                ));
            }
            rv.set(value);
            return;
        }
        if let Some(detail) = exception_detail.filter(|_| !suppressed && self.should_record(&path)) {
            self.write(&format!(
                "反射访问 - {path} -> call -> ({arguments}) -> 异常: {detail}"
            ));
        }
    }

    /// Install call trampolines for one realm.  Only browser-owned values are
    /// traversed; ECMAScript built-ins and arbitrary page objects are left
    /// untouched.  The traversal follows the real prototype chain, so a
    /// method inherited by every element is wrapped once on its WebIDL holder.
    pub(crate) fn install<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        context: v8::Local<'s, v8::Context>,
    ) {
        if !self.enabled() {
            return;
        }
        let global = context.global(scope);
        let names = own_names(scope, global);
        for name in names {
            if is_internal_or_ecma_global(&name) {
                continue;
            }
            let key = match v8::String::new(scope, &name) {
                Some(key) => key,
                None => continue,
            };
            let Some(value) = global.get(scope, key.into()) else { continue };
            let own_descriptor_is_data = global
                .get_own_property_descriptor(scope, key.into())
                .and_then(|value| value.to_object(scope))
                .and_then(|descriptor| {
                    let value_key = v8::String::new(scope, "value")?;
                    descriptor.has_own_property(scope, value_key.into())
                })
                .unwrap_or(false);
            if value.is_function()
                && own_descriptor_is_data
            {
                // Calling a JS class through the trampoline's generic
                // `new_instance` path does not preserve `new.target` through
                // a derived `super()` chain on all V8 revisions. Leave
                // constructors themselves untouched; their prototype methods
                // are still wrapped below, and object/template interception
                // observes every browser instance operation.
                if let Ok(function) = v8::Local::<v8::Function>::try_from(value) {
                    self.visit_function(scope, function, &name);
                }
                if !is_browser_constructor_name(&name) {
                    self.wrap_data_function(scope, global, &name, value, format!("window.{name}"));
                }
            } else if value.is_object() {
                if let Ok(object) = v8::Local::<v8::Object>::try_from(value) {
                    // `self`, `window`, and their aliases point back to the
                    // global object. Traversing that object as an ordinary
                    // browser value would wrap ECMAScript built-ins a second
                    // time under paths such as `self.String`.
                    if object.same_value(global.into()) {
                        continue;
                    }
                    self.visit_object(
                        scope,
                        object,
                        &name,
                        global_interface_hint(&name),
                    );
                    if name == "performance" {
                        // deno_core supplies high-resolution clock methods on
                        // a hidden runtime prototype. They are inherited by
                        // the bootstrap Performance object and therefore are
                        // not discovered by visit_prototype; publish wrappers
                        // on this holder so page calls remain observable.
                        for method in [
                            "now", "mark", "measure", "clearMarks", "clearMeasures",
                            "clearResourceTimings", "getEntries", "getEntriesByName",
                            "getEntriesByType", "setResourceTimingBufferSize",
                        ] {
                            let Some(method_key) = v8::String::new(scope, method) else {
                                continue;
                            };
                            let Some(method_value) = object.get(scope, method_key.into()) else {
                                continue;
                            };
                            if method_value.is_function() {
                                self.wrap_data_function(
                                    scope,
                                    object,
                                    method,
                                    method_value,
                                    format!("performance.{method}"),
                                );
                            }
                        }
                    }
                    if name == "navigator" {
                        // NavigatorUAData and a few newer Navigator surfaces
                        // are exposed through prototype getters but are plain
                        // objects. Materialize them under installation
                        // suppression so their native methods are discovered
                        // before page code can call them.
                        for child_name in [
                            "userAgentData",
                            "scheduling",
                            "keyboard",
                            "credentials",
                            "mediaSession",
                            "virtualKeyboard",
                        ] {
                            let Some(child_key) = v8::String::new(scope, child_name) else {
                                continue;
                            };
                            let Some(child_value) = object.get(scope, child_key.into()) else {
                                continue;
                            };
                            let Ok(child) = v8::Local::<v8::Object>::try_from(child_value) else {
                                continue;
                            };
                            self.visit_object(
                                scope,
                                child,
                                &format!("navigator.{child_name}"),
                                None,
                            );
                        }
                    }
                }
            }
        }
        // The global's Window prototype is not necessarily reachable through a
        // named global value after snapshot deserialization.
        if let Some(proto) = global.get_prototype(scope).and_then(|value| value.to_object(scope)) {
            self.visit_prototype(scope, proto, "Window");
        }
        self.install_reflection(scope, global);
    }

    fn install_reflection<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        global: v8::Local<'s, v8::Object>,
    ) {
        let Some(object_ctor) = global_value_object(scope, global, "Object") else {
            return;
        };
        let Some(reflect) = global_value_object(scope, global, "Reflect") else {
            return;
        };
        let Some(json) = global_value_object(scope, global, "JSON") else {
            return;
        };
        let object_proto = v8::String::new(scope, "prototype")
            .and_then(|key| object_ctor.get(scope, key.into()))
            .and_then(|value| value.to_object(scope));
        let function_proto = global_value_object(scope, global, "Function")
            .and_then(|constructor| {
                let key = v8::String::new(scope, "prototype")?;
                constructor.get(scope, key.into())?.to_object(scope)
            });
        let regexp_proto = global_value_object(scope, global, "RegExp")
            .and_then(|constructor| {
                let key = v8::String::new(scope, "prototype")?;
                constructor.get(scope, key.into())?.to_object(scope)
            });
        let string_proto = global_value_object(scope, global, "String")
            .and_then(|constructor| {
                let key = v8::String::new(scope, "prototype")?;
                constructor.get(scope, key.into())?.to_object(scope)
            });

        for (name, kind) in [
            ("keys", ReflectionKind::ObjectKeys),
            ("getOwnPropertyNames", ReflectionKind::ObjectGetOwnPropertyNames),
            ("getOwnPropertySymbols", ReflectionKind::ObjectGetOwnPropertySymbols),
            ("getOwnPropertyDescriptor", ReflectionKind::ObjectGetOwnPropertyDescriptor),
            ("getOwnPropertyDescriptors", ReflectionKind::ObjectGetOwnPropertyDescriptors),
            ("hasOwn", ReflectionKind::ObjectHasOwn),
            ("defineProperty", ReflectionKind::ObjectDefineProperty),
            ("defineProperties", ReflectionKind::ObjectDefineProperties),
            ("getPrototypeOf", ReflectionKind::ObjectGetPrototypeOf),
            ("setPrototypeOf", ReflectionKind::ObjectSetPrototypeOf),
        ] {
            self.wrap_reflection_method(
                scope,
                object_ctor,
                name,
                format!("Object.{name}"),
                kind,
            );
        }
        if let Some(object_proto) = object_proto {
            self.wrap_reflection_method(
                scope,
                object_proto,
                "hasOwnProperty",
                "Object.prototype.hasOwnProperty".to_string(),
                ReflectionKind::ObjectHasOwn,
            );
        }
        for (name, kind) in [
            ("has", ReflectionKind::ReflectHas),
            ("get", ReflectionKind::ReflectGet),
            ("ownKeys", ReflectionKind::ReflectOwnKeys),
            ("getOwnPropertyDescriptor", ReflectionKind::ReflectGetOwnPropertyDescriptor),
            ("getPrototypeOf", ReflectionKind::ReflectGetPrototypeOf),
            ("setPrototypeOf", ReflectionKind::ReflectSetPrototypeOf),
        ] {
            self.wrap_reflection_method(
                scope,
                reflect,
                name,
                format!("Reflect.{name}"),
                kind,
            );
        }
        self.wrap_reflection_method(
            scope,
            json,
            "parse",
            "JSON.parse".to_string(),
            ReflectionKind::JsonParse,
        );
        self.wrap_reflection_method(
            scope,
            json,
            "stringify",
            "JSON.stringify".to_string(),
            ReflectionKind::JsonStringify,
        );
        if let Some(regexp_proto) = regexp_proto {
            self.wrap_reflection_method(
                scope,
                regexp_proto,
                "test",
                "RegExp.prototype.test".to_string(),
                ReflectionKind::RegExpTest,
            );
            self.wrap_reflection_method(
                scope,
                regexp_proto,
                "exec",
                "RegExp.prototype.exec".to_string(),
                ReflectionKind::RegExpExec,
            );
        }
        if let Some(string_proto) = string_proto {
            self.wrap_reflection_method(
                scope,
                string_proto,
                "match",
                "String.prototype.match".to_string(),
                ReflectionKind::StringMatch,
            );
            self.wrap_reflection_method(
                scope,
                string_proto,
                "search",
                "String.prototype.search".to_string(),
                ReflectionKind::StringSearch,
            );
        }
        if let Some(function_proto) = function_proto {
            self.wrap_reflection_method(
                scope,
                function_proto,
                "toString",
                "Function.prototype.toString".to_string(),
                ReflectionKind::FunctionToString,
            );
        }
    }

    fn wrap_reflection_method<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        holder: v8::Local<'s, v8::Object>,
        property: &str,
        path: String,
        kind: ReflectionKind,
    ) {
        let Some(key) = v8::String::new(scope, property) else {
            return;
        };
        let Some(value) = holder.get(scope, key.into()) else {
            return;
        };
        if value.is_function() {
            self.wrap_data_function_kind(
                scope,
                holder,
                property,
                value,
                path,
                EntryKind::Reflection(kind),
            );
        }
    }

    fn visit_function<'s>(&mut self, scope: &mut v8::HandleScope<'s>, function: v8::Local<'s, v8::Function>, name: &str) {
        let prototype_key = v8::String::new(scope, "prototype");
        if let Some(prototype_key) = prototype_key {
            let prototype_value = function.get(scope, prototype_key.into());
            if let Some(prototype) = prototype_value
                .and_then(|value| value.to_object(scope))
            {
                self.visit_prototype(scope, prototype, name);
            }
        }
    }

    fn visit_object<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        object: v8::Local<'s, v8::Object>,
        base: &str,
        interface_hint: Option<&str>,
    ) {
        let hash = object.get_identity_hash().get();
        if !self.seen_holders.insert(hash) {
            return;
        }
        let names = own_names(scope, object);
        for name in names {
            if name == "constructor"
                || name.starts_with('_')
                || name.starts_with("__obscura_")
                || is_ecma_method(&name)
            {
                continue;
            }
            let Some(key) = v8::String::new(scope, &name) else { continue };
            let Some(descriptor) = object
                .get_own_property_descriptor(scope, key.into())
                .and_then(|value| value.to_object(scope))
            else { continue };
            let Some(value_key) = v8::String::new(scope, "value") else { continue };
            if descriptor.has_own_property(scope, value_key.into()).unwrap_or(false) {
                let Some(value) = descriptor.get(scope, value_key.into()) else { continue };
                if value.is_function() {
                    self.wrap_data_function(scope, object, &name, value, format!("{base}.{name}"));
                    if let Ok(function) = v8::Local::<v8::Function>::try_from(value) {
                        self.visit_function(scope, function, &name);
                    }
                } else if value.is_object()
                    && (is_browser_object(scope, value)
                        || is_known_browser_child(base, &name))
                {
                    if let Ok(child) = v8::Local::<v8::Object>::try_from(value) {
                        self.visit_object(scope, child, &format!("{base}.{name}"), None);
                    }
                }
            }
        }
        if let Some(proto) = object.get_prototype(scope).and_then(|value| value.to_object(scope)) {
            let interface = interface_hint
                .map(str::to_string)
                .or_else(|| {
                    let value = proto.get_constructor_name().to_rust_string_lossy(scope);
                    (!value.is_empty()).then_some(value)
                });
            if let Some(interface) = interface {
                self.visit_prototype(scope, proto, &interface);
            }
        }
    }

    fn visit_prototype<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        prototype: v8::Local<'s, v8::Object>,
        interface: &str,
    ) {
        let hash = prototype.get_identity_hash().get();
        if !self.seen_holders.insert(hash) {
            return;
        }
        let names = own_names(scope, prototype);
        self.interface_properties
            .entry(interface.to_string())
            .or_default()
            .extend(names.iter().cloned());
        for name in names {
            if name == "constructor"
                || name.starts_with('_')
                || name == "__proto__"
                || is_ecma_method(&name)
            {
                continue;
            }
            let Some(key) = v8::String::new(scope, &name) else { continue };
            let Some(descriptor) = prototype
                .get_own_property_descriptor(scope, key.into())
                .and_then(|value| value.to_object(scope))
            else { continue };
            let Some(value_key) = v8::String::new(scope, "value") else { continue };
            if !descriptor.has_own_property(scope, value_key.into()).unwrap_or(false) {
                // Accessors are intentionally left in place.  The native
                // property monitor records their getter/setter result without
                // changing descriptor identity.
                continue;
            }
            let Some(value) = descriptor.get(scope, value_key.into()) else { continue };
            if value.is_function() {
                self.wrap_data_function(
                    scope,
                    prototype,
                    &name,
                    value,
                    format!("{interface}.prototype.{name}"),
                );
            }
        }
        if let Some(parent) = prototype.get_prototype(scope).and_then(|value| value.to_object(scope)) {
            let parent_name = parent.get_constructor_name().to_rust_string_lossy(scope);
            if !parent_name.is_empty() && parent_name != interface {
                self.interface_parents
                    .entry(interface.to_string())
                    .or_insert_with(|| parent_name.clone());
            }
            if !is_ecma_prototype(&parent_name) && parent_name != interface {
                self.visit_prototype(scope, parent, &parent_name);
            }
        }
    }

    fn wrap_data_function<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        holder: v8::Local<'s, v8::Object>,
        property: &str,
        value: v8::Local<'s, v8::Value>,
        path: String,
    ) {
        self.wrap_data_function_kind(
            scope,
            holder,
            property,
            value,
            path,
            EntryKind::Call,
        );
    }

    fn wrap_data_function_kind<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        holder: v8::Local<'s, v8::Object>,
        property: &str,
        value: v8::Local<'s, v8::Value>,
        path: String,
        kind: EntryKind,
    ) {
        let Ok(original) = v8::Local::<v8::Function>::try_from(value) else {
            return;
        };
        let holder_hash = holder.get_identity_hash().get();
        let slot = (holder_hash, property.to_string(), kind);
        if !self.wrapped.insert(slot) {
            return;
        }
        let prototype = path.contains(".prototype.");
        let (base, property_name) = if let Some((base, property)) = path.rsplit_once(".prototype.") {
            (base.to_string(), property.to_string())
        } else if let Some((base, property)) = path.rsplit_once('.') {
            (base.to_string(), property.to_string())
        } else {
            return;
        };
        let entry_ptr = self.add_entry_with_scope(
            scope,
            original,
            kind,
            base,
            property_name,
            prototype,
            holder_hash,
        );
        let data = v8::External::new(scope, entry_ptr.cast::<c_void>()).into();
        let length_key = v8::String::new(scope, "length").unwrap();
        let length = original
            .get(scope, length_key.into())
            .and_then(|value| value.int32_value(scope))
            .unwrap_or(0);
        let Some(replacement) = v8::Function::builder(trace_callback)
            .data(data)
            .length(length)
            .constructor_behavior(if has_prototype(scope, original) {
                v8::ConstructorBehavior::Allow
            } else {
                v8::ConstructorBehavior::Throw
            })
            .build(scope)
        else {
            return;
        };
        replacement.set_name(original.get_name(scope));
        // Constructors must retain their original prototype so `instanceof`
        // and WebIDL brand checks remain unchanged after replacement.
        let prototype_key = v8::String::new(scope, "prototype").unwrap();
        if let Some(proto) = original
            .get(scope, prototype_key.into())
            .and_then(|value| value.to_object(scope))
        {
            let _ = replacement.set(scope, prototype_key.into(), proto.into());
            // Publishing a native constructor must keep the reciprocal
            // `prototype.constructor` identity that page code observes. The
            // original class prototype is retained, but its constructor slot
            // now points at the trampoline just like a native WebIDL function
            // template does.
            if path.starts_with("window.") {
                if let Some(constructor_key) = v8::String::new(scope, "constructor") {
                    let _ = proto.set(scope, constructor_key.into(), replacement.into());
                }
            }
        }
        // A constructor's static API lives on the constructor object itself
        // (`URL.canParse`, `Response.error`, ...). Replacing only the global
        // function would otherwise drop those properties. Copy data descriptors
        // and wrap static functions on the replacement before publishing it.
        let static_base = if path.starts_with("window.") {
            property.to_string()
        } else {
            path.clone()
        };
        self.copy_function_statics(scope, original, replacement, &static_base);
        let key = match v8::String::new(scope, property) {
            Some(key) => key,
            None => return,
        };
        let descriptor_object = holder
            .get_own_property_descriptor(scope, key.into())
            .and_then(|value| value.to_object(scope));
        let writable_key = v8::String::new(scope, "writable").unwrap();
        let enumerable_key = v8::String::new(scope, "enumerable").unwrap();
        let configurable_key = v8::String::new(scope, "configurable").unwrap();
        let writable = descriptor_object
            .as_ref()
            .and_then(|descriptor| descriptor.get(scope, writable_key.into()))
            .is_some_and(|value| value.boolean_value(scope));
        let enumerable = descriptor_object
            .as_ref()
            .and_then(|descriptor| descriptor.get(scope, enumerable_key.into()))
            .is_some_and(|value| value.boolean_value(scope));
        let configurable = descriptor_object
            .as_ref()
            .and_then(|descriptor| descriptor.get(scope, configurable_key.into()))
            .is_some_and(|value| value.boolean_value(scope));
        let (writable, enumerable, configurable) = if descriptor_object.is_some() {
            (writable, enumerable, configurable)
        } else {
            // An inherited function has no own descriptor on this holder.
            // Browser method descriptors are writable/configurable and
            // non-enumerable, which are the defaults for the promoted wrapper.
            (true, false, true)
        };
        let mut replacement_descriptor = v8::PropertyDescriptor::new_from_value_writable(
            replacement.into(),
            writable,
        );
        replacement_descriptor.set_enumerable(enumerable);
        replacement_descriptor.set_configurable(configurable);
        let defined = holder.define_property(scope, key.into(), &replacement_descriptor);
        if defined != Some(true) {
            return;
        }
    }

    fn copy_function_statics<'s>(
        &mut self,
        scope: &mut v8::HandleScope<'s>,
        original: v8::Local<'s, v8::Function>,
        replacement: v8::Local<'s, v8::Function>,
        base: &str,
    ) {
        for name in own_names(scope, original.into()) {
            if matches!(name.as_str(), "name" | "length" | "prototype" | "caller" | "arguments")
                || name.starts_with('_')
            {
                continue;
            }
            let Some(key) = v8::String::new(scope, &name) else { continue };
            let Some(descriptor) = original
                .get_own_property_descriptor(scope, key.into())
                .and_then(|value| value.to_object(scope))
            else { continue };
            let Some(value_key) = v8::String::new(scope, "value") else { continue };
            if !descriptor.has_own_property(scope, value_key.into()).unwrap_or(false) {
                continue;
            }
            let Some(value) = descriptor.get(scope, value_key.into()) else { continue };
            if value.is_function() {
                self.wrap_data_function(
                    scope,
                    replacement.into(),
                    &name,
                    value,
                    format!("{base}.{name}"),
                );
                continue;
            }
            let writable_key = v8::String::new(scope, "writable").unwrap();
            let enumerable_key = v8::String::new(scope, "enumerable").unwrap();
            let configurable_key = v8::String::new(scope, "configurable").unwrap();
            let writable = descriptor
                .get(scope, writable_key.into())
                .is_some_and(|value| value.boolean_value(scope));
            let enumerable = descriptor
                .get(scope, enumerable_key.into())
                .is_some_and(|value| value.boolean_value(scope));
            let configurable = descriptor
                .get(scope, configurable_key.into())
                .is_some_and(|value| value.boolean_value(scope));
            let mut copied = v8::PropertyDescriptor::new_from_value_writable(value, writable);
            copied.set_enumerable(enumerable);
            copied.set_configurable(configurable);
            let _ = replacement.define_property(scope, key.into(), &copied);
        }
    }
}

fn native_instance_get<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<v8::Value>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: the pointer is published by ObscuraJsRuntime for the lifetime of
    // the isolate and all property callbacks run on that isolate's thread.
    unsafe { (&mut *state).native_get(scope, key, args, rv) }
}

fn native_instance_set<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    value: v8::Local<'s, v8::Value>,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<()>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: see native_instance_get.
    unsafe { (&mut *state).native_set(scope, key, value, args, rv) }
}

fn native_instance_query<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<v8::Integer>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: see native_instance_get.
    unsafe { (&mut *state).native_query(scope, key, args, rv) }
}

fn native_global_get<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<v8::Value>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: see native_instance_get.
    unsafe { (&mut *state).native_get(scope, key, args, rv) }
}

fn native_global_set<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    value: v8::Local<'s, v8::Value>,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<()>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: see native_instance_get.
    unsafe { (&mut *state).native_global_set(scope, key, value, args, rv) }
}

fn native_global_query<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<v8::Integer>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: see native_instance_get.
    unsafe { (&mut *state).native_global_query(scope, key, args, rv) }
}

fn native_instance_define<'s>(
    scope: &mut v8::HandleScope<'s>,
    key: v8::Local<'s, v8::Name>,
    descriptor: &v8::PropertyDescriptor,
    args: v8::PropertyCallbackArguments<'s>,
    rv: v8::ReturnValue<()>,
) -> v8::Intercepted {
    let state = AsRef::<v8::Isolate>::as_ref(scope).get_data(NATIVE_TRACE_DATA_SLOT)
        as *mut NativeTraceState;
    if state.is_null() {
        return v8::Intercepted::No;
    }
    // SAFETY: see native_instance_get.
    unsafe { (&mut *state).native_define(scope, key, descriptor, args, rv) }
}

/// V8 callback entry point. `TraceEntry` is retained by the owning runtime;
/// malformed callback data is ignored so a stale page function cannot unwind
/// through V8.
fn trace_callback<'s>(
    scope: &mut v8::HandleScope<'s>,
    args: v8::FunctionCallbackArguments<'s>,
    rv: v8::ReturnValue<v8::Value>,
) {
    let Some(external) = v8::Local::<v8::External>::try_from(args.data()).ok() else { return };
    let ptr = external.value() as *const TraceEntry;
    if ptr.is_null() { return }
    // SAFETY: entries are boxed and retained in NativeTraceState until the
    // isolate is torn down, after which V8 cannot invoke this callback.
    let entry = unsafe { &*ptr };
    if entry.state.is_null() { return }
    // SAFETY: state and entry are owned by the same runtime and callback runs
    // synchronously on that runtime's V8 thread.
    unsafe { (&mut *entry.state).invoke(scope, args, rv, entry); }
}

fn own_names(scope: &mut v8::HandleScope, object: v8::Local<v8::Object>) -> Vec<String> {
    let args = v8::GetPropertyNamesArgs {
        mode: v8::KeyCollectionMode::OwnOnly,
        property_filter: v8::PropertyFilter::ALL_PROPERTIES | v8::PropertyFilter::SKIP_SYMBOLS,
        index_filter: v8::IndexFilter::IncludeIndices,
        key_conversion: v8::KeyConversionMode::ConvertToString,
    };
    let Some(names) = object.get_own_property_names(scope, args) else { return Vec::new() };
    let mut out = Vec::with_capacity(names.length() as usize);
    for index in 0..names.length() {
        let Some(value) = names.get_index(scope, index) else { continue };
        if value.is_string() {
            out.push(value.to_rust_string_lossy(scope));
        }
    }
    out
}

fn global_value_object<'s>(
    scope: &mut v8::HandleScope<'s>,
    global: v8::Local<'s, v8::Object>,
    name: &str,
) -> Option<v8::Local<'s, v8::Object>> {
    let key = v8::String::new(scope, name)?;
    global
        .get(scope, key.into())
        .and_then(|value| value.to_object(scope))
}

fn has_prototype(scope: &mut v8::HandleScope, function: v8::Local<v8::Function>) -> bool {
    v8::String::new(scope, "prototype")
        .and_then(|key| function.get_own_property_descriptor(scope, key.into()))
        .is_some()
}

fn is_browser_object(scope: &mut v8::HandleScope, value: v8::Local<v8::Value>) -> bool {
    let Ok(object) = v8::Local::<v8::Object>::try_from(value) else { return false };
    let name = object.get_constructor_name().to_rust_string_lossy(scope);
    !is_ecma_prototype(&name) && name != "Object" && name != ""
}

fn is_known_browser_child(base: &str, name: &str) -> bool {
    // A few browser sub-objects are intentionally plain objects in the
    // bootstrap (notably NavigatorUAData). They still expose browser methods
    // and must be traversed for native call tracing.
    matches!(
        (base, name),
        ("navigator", "userAgentData")
            | ("navigator", "scheduling")
            | ("navigator", "keyboard")
            | ("navigator", "credentials")
            | ("navigator", "mediaSession")
            | ("navigator", "virtualKeyboard")
    )
}

fn is_browser_constructor_name(name: &str) -> bool {
    name.as_bytes()
        .first()
        .is_some_and(|character| character.is_ascii_uppercase())
}

fn global_interface_hint(name: &str) -> Option<&'static str> {
    match name {
        "document" => Some("Document"),
        "navigator" => Some("Navigator"),
        "location" => Some("Location"),
        "history" => Some("History"),
        "screen" => Some("Screen"),
        "performance" => Some("Performance"),
        "crypto" => Some("Crypto"),
        "console" => Some("Console"),
        "localStorage" | "sessionStorage" => Some("Storage"),
        "visualViewport" => Some("VisualViewport"),
        _ => None,
    }
}

fn is_ecma_prototype(name: &str) -> bool {
    matches!(
        name,
        "Object"
            | "Function"
            | "Array"
            | "Number"
            | "String"
            | "Boolean"
            | "RegExp"
            | "Date"
            | "Map"
            | "Set"
            | "WeakMap"
            | "WeakSet"
            | "Promise"
            | "ArrayBuffer"
            | "DataView"
            | "Error"
            | "AggregateError"
            | "FinalizationRegistry"
            | "WeakRef"
            | "Iterator"
    )
}

fn is_ecma_method(name: &str) -> bool {
    matches!(
        name,
        "call"
            | "apply"
            | "bind"
            | "toString"
            | "toLocaleString"
            | "valueOf"
            | "hasOwnProperty"
            | "isPrototypeOf"
            | "propertyIsEnumerable"
            | "__defineGetter__"
            | "__defineSetter__"
            | "__lookupGetter__"
            | "__lookupSetter__"
    )
}

fn is_internal_or_ecma_global(name: &str) -> bool {
    name.starts_with('_')
        || name.starts_with("__")
        || matches!(
            name,
            "Object"
                | "Function"
                | "Array"
                | "Number"
                | "String"
                | "Boolean"
                | "Symbol"
                | "BigInt"
                | "RegExp"
                | "Date"
                | "Map"
                | "Set"
                | "WeakMap"
                | "WeakSet"
                | "Promise"
                | "ArrayBuffer"
                | "SharedArrayBuffer"
                | "DataView"
                | "Uint8Array"
                | "Uint8ClampedArray"
                | "Uint16Array"
                | "Uint32Array"
                | "Int8Array"
                | "Int16Array"
                | "Int32Array"
                | "Float32Array"
                | "Float64Array"
                | "BigInt64Array"
                | "BigUint64Array"
                | "Error"
                | "EvalError"
                | "RangeError"
                | "ReferenceError"
                | "SyntaxError"
                | "TypeError"
                | "URIError"
                | "AggregateError"
                | "FinalizationRegistry"
                | "WeakRef"
                | "Iterator"
                | "Math"
                | "JSON"
                | "Reflect"
                | "Proxy"
                | "WebAssembly"
                | "Intl"
                | "Atomics"
                | "Deno"
                | "globalThis"
                | "undefined"
                | "NaN"
                | "Infinity"
                | "eval"
                | "isFinite"
                | "isNaN"
                | "parseFloat"
                | "parseInt"
                | "decodeURI"
                | "decodeURIComponent"
                | "encodeURI"
                | "encodeURIComponent"
                | "escape"
                | "unescape"
        )
}

fn interface_instance_name(actual: &str, fallback: &str) -> String {
    let name = if actual.is_empty() { fallback } else { actual };
    if name == "Window" || name == "Global" { return "window".to_string(); }
    if name == "_ScopedDocument" { return "document".to_string(); }
    if name == "Document" || name == "HTMLDocument" || name == "XMLDocument" {
        return "document".to_string();
    }
    if let Some(rest) = name.strip_prefix("HTML").and_then(|value| value.strip_suffix("Element")) {
        if !rest.is_empty() { return rest.to_ascii_lowercase(); }
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_ascii_lowercase().to_string() + chars.as_str(),
        None => "object".to_string(),
    }
}
