//! Frame Window realms (docs/Iframe-support-design.md, Phase 3.7): additional
//! `v8::Context`s inside the existing `ObscuraJsRuntime` isolate, one per
//! iframe content document generation.
//!
//! deno_core 0.350 has no public realm API, so contexts are built directly on
//! the isolate. The `Deno.core` JS binding object is per-context; it is
//! bridged by injecting the main context's `Deno` global into the new context
//! (objects may cross contexts within one isolate), then re-executing the
//! bootstrap source, which the snapshot bakes into the default context only.
//! Inside a frame realm, `document` binds to the frame's content root: the
//! realm host defines `__obscura_frame_document_nid` before bootstrap and
//! `__obscura_init` builds the realm's `document` as that bootstrap
//! instance's `_ScopedDocument(content_root)` (scoped op_dom queries).
//!
//! [`FrameRealmHost`] is the managed registry, keyed by
//! `(frame_id, document_generation, world_id)`, created lazily and destroyed
//! by generation. `world_id` [`MAIN_WORLD`] is the frame's own Window realm
//! (the default execution context); ids above it are CDP isolated worlds
//! (Phase 6.3): a separate `v8::Context` with its own global and DOM wrapper
//! cache, but the same native DOM (both reach `content_root` through op_dom).
//! [`SecondaryRealm`] is the retained feasibility spike (implementation order
//! item 1); nothing on the main path constructs either.

use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use deno_core::v8;

use crate::import_map::ImportMap;
use crate::runtime::ObscuraJsRuntime;

/// The frame's own Window realm: the default execution context CDP reports
/// with `auxData.isDefault = true`. Isolated worlds use ids above this.
pub const MAIN_WORLD: u64 = 0;

/// bootstrap.js source. The snapshot (build.rs) contains its executed result
/// in the default context only; a secondary context runs the source again.
const BOOTSTRAP_SRC: &str = include_str!("../js/bootstrap.js");

/// Mirror of the `<obscura:init>` script the runtime constructor executes in
/// the default context (runtime.rs).
const REALM_INIT_SRC: &str =
    "globalThis.__obscura_objects = {}; globalThis.__obscura_oid = 0;";

/// A secondary context in the runtime's isolate. Dropping the handle releases
/// the context to GC; the main context is unaffected.
pub struct SecondaryRealm {
    context: v8::Global<v8::Context>,
}

/// A managed frame Window realm: the context handle plus the metadata that
/// identifies which document and world it serves.
pub struct FrameRealm {
    pub(crate) context: v8::Global<v8::Context>,
    /// Which world this realm is: [`MAIN_WORLD`] for the frame's own Window,
    /// higher ids for CDP isolated worlds.
    pub world_id: u64,
    /// Isolated-world name (`Page.createIsolatedWorld` worldName); `None` for
    /// the main world.
    pub world_name: Option<String>,
    /// Arena index of the frame's content-document root node.
    pub content_root: u32,
    /// Base URL handed to the realm at creation (`__obscura_frame_base_url`).
    pub base_url: String,
    /// DocumentScope url/origin serialized at creation time; `None` when the
    /// content root had no registered scope yet.
    pub scope_url: Option<String>,
    pub scope_origin: Option<String>,
}

impl FrameRealm {
    /// Whether this is the frame's default (main) world.
    pub fn is_default(&self) -> bool {
        self.world_id == MAIN_WORLD
    }
}

/// Registry of frame Window realms keyed by
/// `(frame_id, document_generation, world_id)`. Owned by `ObscuraJsRuntime`;
/// empty on pages without iframes, so the main path never pays for it.
#[derive(Default)]
pub struct FrameRealmHost {
    pub(crate) realms: HashMap<(String, u64, u64), FrameRealm>,
}

/// One frame Document's V8 module registry. V8 modules are context-bound, so
/// they cannot use deno_core's main-realm module map without evaluating
/// `globalThis`, DOM APIs and lexical bindings in the top Window.
#[derive(Default)]
pub(crate) struct FrameModuleMap {
    import_map: ImportMap,
    modules: HashMap<String, v8::Global<v8::Module>>,
    resolutions: HashMap<(i32, String), String>,
    evaluations: HashMap<String, v8::Global<v8::Promise>>,
    dynamic_helpers: Vec<Box<FrameDynamicImportHelper>>,
    next_dynamic_helper: u64,
}

/// The subset of a frame document's CSP needed while fetching its module
/// graph. The browser crate owns the full CSP parser; this small value object
/// keeps the module loader independent while still applying the same
/// script-src source-list rules to every static import.
#[derive(Clone, Debug)]
pub struct FrameModuleCsp {
    header: String,
    origin: String,
}

impl FrameModuleCsp {
    pub fn new(header: &str, origin: &str) -> Self {
        Self {
            header: header.to_string(),
            origin: origin.to_string(),
        }
    }

    fn allows_url(&self, requested: &str) -> bool {
        let mut script_elem = None;
        let mut script = None;
        let mut default = None;
        for directive in self.header.split(';') {
            let mut tokens = directive.split_ascii_whitespace();
            let Some(name) = tokens.next() else { continue };
            let values = tokens.map(str::to_string).collect::<Vec<_>>();
            if name.eq_ignore_ascii_case("script-src-elem") && script_elem.is_none() {
                script_elem = Some(values);
            } else if name.eq_ignore_ascii_case("script-src") && script.is_none() {
                script = Some(values);
            } else if name.eq_ignore_ascii_case("default-src") && default.is_none() {
                default = Some(values);
            }
        }
        let sources = script_elem.or(script).or(default);
        let Some(sources) = sources else { return true };
        let Ok(target) = url::Url::parse(requested) else { return false };
        let document = url::Url::parse(&self.origin).ok();
        sources.iter().any(|source| {
            let source_lower = source.to_ascii_lowercase();
            if source_lower == "'none'" { return false; }
            if source_lower == "*" {
                return matches!(target.scheme(), "http" | "https" | "ws" | "wss");
            }
            if source_lower == "data:" { return target.scheme() == "data"; }
            if source_lower == "blob:" { return target.scheme() == "blob"; }
            if source_lower == "'self'" {
                return document.as_ref().is_some_and(|document| {
                    target.origin() == document.origin()
                });
            }
            if let Some(scheme) = source_lower.strip_suffix(':') {
                if !scheme.contains('/') { return target.scheme() == scheme; }
            }
            let (scheme, host_port) = source_lower
                .split_once("://")
                .map_or((None, source_lower.as_str()), |(scheme, rest)| {
                    (Some(scheme), rest)
                });
            let host_port = host_port.split(['/', '?', '#']).next().unwrap_or("");
            let (host, port) = host_port
                .rsplit_once(':')
                .filter(|(_, value)| !value.contains(']'))
                .map_or((host_port, None), |(host, port)| (host, Some(port)));
            let source_scheme = scheme.or_else(|| document.as_ref().map(|value| value.scheme()));
            if host.is_empty() || source_scheme.is_some_and(|scheme| scheme != target.scheme()) {
                return false;
            }
            let host_matches = if let Some(suffix) = host.strip_prefix("*.") {
                target
                    .host_str()
                    .is_some_and(|target_host| target_host.ends_with(suffix)
                        && target_host.len() > suffix.len())
            } else {
                target.host_str() == Some(host)
            };
            if !host_matches { return false; }
            match port {
                Some("*") => true,
                Some(port) => port.parse::<u16>().ok() == target.port_or_known_default(),
                None => target.port_or_known_default() == default_port(target.scheme()),
            }
        })
    }
}

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" | "ws" => Some(80),
        "https" | "wss" => Some(443),
        _ => None,
    }
}

struct FrameDynamicImportHelper {
    module_map: *mut FrameModuleMap,
    referrer_url: String,
}

impl FrameRealmHost {
    /// The frame's main-world realm.
    pub fn get(&self, frame_id: &str, generation: u64) -> Option<&FrameRealm> {
        self.get_world(frame_id, generation, MAIN_WORLD)
    }

    pub fn get_world(&self, frame_id: &str, generation: u64, world_id: u64) -> Option<&FrameRealm> {
        self.realms
            .get(&(frame_id.to_string(), generation, world_id))
    }

    /// Whether the frame's main-world realm exists.
    pub fn contains(&self, frame_id: &str, generation: u64) -> bool {
        self.contains_world(frame_id, generation, MAIN_WORLD)
    }

    pub fn contains_world(&self, frame_id: &str, generation: u64, world_id: u64) -> bool {
        self.realms
            .contains_key(&(frame_id.to_string(), generation, world_id))
    }

    pub fn active_count(&self) -> usize {
        self.realms.len()
    }
}

fn alloc_err(what: &str) -> String {
    format!("realm: {what} allocation failed")
}

fn decode_frame_module_data_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("data:")?;
    let (metadata, payload) = rest.split_once(',')?;
    let bytes = if metadata
        .split(';')
        .any(|token| token.eq_ignore_ascii_case("base64"))
    {
        let payload: String = payload.chars().filter(|ch| !ch.is_whitespace()).collect();
        BASE64.decode(payload).ok()?
    } else {
        let bytes = payload.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' && index + 2 < bytes.len() {
                let value = u8::from_str_radix(
                    std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?,
                    16,
                );
                if let Ok(value) = value {
                    decoded.push(value);
                    index += 3;
                    continue;
                }
            }
            decoded.push(bytes[index]);
            index += 1;
        }
        decoded
    };
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn skip_frame_module_trivia(source: &str, mut index: usize) -> usize {
    let bytes = source.as_bytes();
    loop {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
        } else if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len()
                && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
            {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
        } else {
            return index;
        }
    }
}

fn frame_hex_escape(bytes: &[u8], index: usize, length: usize) -> Option<u32> {
    let digits = std::str::from_utf8(bytes.get(index..index + length)?).ok()?;
    u32::from_str_radix(digits, 16).ok()
}

fn frame_dynamic_import_literal(source: &str, index: usize) -> Option<String> {
    let bytes = source.as_bytes();
    let mut index = skip_frame_module_trivia(source, index);
    let quote = *bytes.get(index)?;
    if quote != b'\'' && quote != b'"' && quote != b'`' {
        return None;
    }
    index += 1;
    let mut value = String::new();
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == quote {
            let tail = skip_frame_module_trivia(source, index + 1);
            return matches!(bytes.get(tail), Some(b')' | b','))
                .then_some(value);
        }
        if quote == b'`' && byte == b'$' && bytes.get(index + 1) == Some(&b'{') {
            return None;
        }
        if byte == b'\\' {
            index += 1;
            let escaped = *bytes.get(index)?;
            match escaped {
                b'n' => value.push('\n'),
                b'r' => value.push('\r'),
                b't' => value.push('\t'),
                b'b' => value.push('\u{0008}'),
                b'f' => value.push('\u{000c}'),
                b'v' => value.push('\u{000b}'),
                b'0' if !bytes.get(index + 1).is_some_and(u8::is_ascii_digit) => {
                    value.push('\0')
                }
                b'\n' => {}
                b'\r' => {
                    if bytes.get(index + 1) == Some(&b'\n') {
                        index += 1;
                    }
                }
                b'x' => {
                    let code = frame_hex_escape(bytes, index + 1, 2)?;
                    value.push(char::from_u32(code)?);
                    index += 2;
                }
                b'u' if bytes.get(index + 1) == Some(&b'{') => {
                    let start = index + 2;
                    let end = bytes.get(start..)?.iter().position(|byte| *byte == b'}')? + start;
                    if end == start || end - start > 6 {
                        return None;
                    }
                    let code = frame_hex_escape(bytes, start, end - start)?;
                    value.push(char::from_u32(code)?);
                    index = end;
                }
                b'u' => {
                    let mut code = frame_hex_escape(bytes, index + 1, 4)?;
                    index += 4;
                    if (0xd800..=0xdbff).contains(&code)
                        && bytes.get(index + 1) == Some(&b'\\')
                        && bytes.get(index + 2) == Some(&b'u')
                    {
                        if let Some(low) = frame_hex_escape(bytes, index + 3, 4)
                            .filter(|low| (0xdc00..=0xdfff).contains(low))
                        {
                            code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                            index += 6;
                        }
                    }
                    value.push(char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER));
                }
                other => value.push(other as char),
            }
            index += 1;
            continue;
        }
        if byte == b'\n' || byte == b'\r' {
            return None;
        }
        let character = source[index..].chars().next()?;
        value.push(character);
        index += character.len_utf8();
    }
    None
}

fn scan_frame_template(
    source: &str,
    index: &mut usize,
    imports: &mut Vec<usize>,
    literals: &mut Vec<String>,
) {
    let bytes = source.as_bytes();
    *index += 1;
    while *index < bytes.len() {
        if bytes[*index] == b'\\' {
            *index = (*index + 2).min(bytes.len());
        } else if bytes[*index] == b'`' {
            *index += 1;
            return;
        } else if bytes[*index] == b'$' && bytes.get(*index + 1) == Some(&b'{') {
            *index += 2;
            scan_frame_code(source, index, true, imports, literals);
        } else {
            *index += source[*index..]
                .chars()
                .next()
                .map(char::len_utf8)
                .unwrap_or(1);
        }
    }
}

fn scan_frame_code(
    source: &str,
    index: &mut usize,
    stop_on_closing_brace: bool,
    imports: &mut Vec<usize>,
    literals: &mut Vec<String>,
) {
    let bytes = source.as_bytes();
    let mut brace_depth = 0usize;
    while *index < bytes.len() {
        match bytes[*index] {
            b'\'' | b'"' => {
                let quote = bytes[*index];
                *index += 1;
                while *index < bytes.len() {
                    if bytes[*index] == b'\\' {
                        *index = (*index + 2).min(bytes.len());
                    } else if bytes[*index] == quote {
                        *index += 1;
                        break;
                    } else {
                        *index += source[*index..]
                            .chars()
                            .next()
                            .map(char::len_utf8)
                            .unwrap_or(1);
                    }
                }
            }
            b'`' => scan_frame_template(source, index, imports, literals),
            b'{' => {
                brace_depth += 1;
                *index += 1;
            }
            b'}' if stop_on_closing_brace && brace_depth == 0 => {
                *index += 1;
                return;
            }
            b'}' => {
                brace_depth = brace_depth.saturating_sub(1);
                *index += 1;
            }
            b'/' if bytes.get(*index + 1) == Some(&b'/') => {
                *index += 2;
                while *index < bytes.len() && bytes[*index] != b'\n' {
                    *index += 1;
                }
            }
            b'/' if bytes.get(*index + 1) == Some(&b'*') => {
                *index += 2;
                while *index + 1 < bytes.len()
                    && !(bytes[*index] == b'*' && bytes[*index + 1] == b'/')
                {
                    *index += 1;
                }
                *index = (*index + 2).min(bytes.len());
            }
            b'/' if frame_slash_starts_regex(source, *index) => {
                *index += 1;
                let mut in_class = false;
                while *index < bytes.len() {
                    match bytes[*index] {
                        b'\\' => *index = (*index + 2).min(bytes.len()),
                        b'[' => {
                            in_class = true;
                            *index += 1;
                        }
                        b']' => {
                            in_class = false;
                            *index += 1;
                        }
                        b'/' if !in_class => {
                            *index += 1;
                            while *index < bytes.len() && bytes[*index].is_ascii_alphabetic() {
                                *index += 1;
                            }
                            break;
                        }
                        _ => *index += 1,
                    }
                }
            }
            b'i'
                if source[*index..].starts_with("import")
                    && (*index == 0
                        || !bytes[*index - 1].is_ascii_alphanumeric()
                            && bytes[*index - 1] != b'_'
                            && bytes[*index - 1] != b'$') =>
            {
                let after = *index + "import".len();
                let open = skip_frame_module_trivia(source, after);
                if bytes.get(open) == Some(&b'(') {
                    imports.push(*index);
                    if let Some(raw) = frame_dynamic_import_literal(source, open + 1) {
                        literals.push(raw);
                    }
                }
                *index = after;
            }
            _ => {
                *index += source[*index..]
                    .chars()
                    .next()
                    .map(char::len_utf8)
                    .unwrap_or(1);
            }
        }
    }
}

/// Route `import()` calls away from deno_core's main-realm module map. The
/// lexer visits template substitutions but leaves template text, strings,
/// comments and regular expressions untouched. Literal requests are prepared
/// with the surrounding frame graph; computed requests can reuse any module
/// already present in that graph and otherwise reject without crossing realms.
fn rewrite_frame_dynamic_imports(
    source: &str,
    helper_name: &str,
) -> (String, Vec<String>) {
    let mut imports = Vec::new();
    let mut literals = Vec::new();
    let mut index = 0;
    scan_frame_code(source, &mut index, false, &mut imports, &mut literals);
    let mut rewritten = String::with_capacity(source.len() + imports.len() * helper_name.len());
    let mut copy_from = 0;
    for index in imports {
        rewritten.push_str(&source[copy_from..index]);
        rewritten.push_str(helper_name);
        copy_from = index + "import".len();
    }
    rewritten.push_str(&source[copy_from..]);
    (rewritten, literals)
}

fn frame_slash_starts_regex(source: &str, slash: usize) -> bool {
    let before = source[..slash].trim_end();
    let Some(last) = before.as_bytes().last().copied() else {
        return true;
    };
    if b"([{=:;,!?&|+-*%^~<>".contains(&last) {
        return true;
    }
    before
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .next_back()
        .is_some_and(|word| matches!(word, "return" | "throw" | "case" | "delete" | "void" | "typeof" | "yield" | "await"))
}

fn frame_module_resolve_callback<'s>(
    context: v8::Local<'s, v8::Context>,
    specifier: v8::Local<'s, v8::String>,
    _import_attributes: v8::Local<'s, v8::FixedArray>,
    referrer: v8::Local<'s, v8::Module>,
) -> Option<v8::Local<'s, v8::Module>> {
    // SAFETY: V8 invokes this synchronously inside instantiate_module below.
    // That call installs a pointer to the live FrameModuleMap in the isolate
    // slot and removes it before returning.
    let scope = &mut unsafe { v8::CallbackScope::new(context) };
    let map = unsafe {
        scope
            .get_slot::<*const FrameModuleMap>()?
            .as_ref()?
    };
    let raw = specifier.to_rust_string_lossy(scope);
    let module_key = map
        .resolutions
        .get(&(referrer.get_identity_hash().get(), raw))?;
    map.modules
        .get(module_key)
        .map(|module| v8::Local::new(scope, module))
}

fn reject_frame_dynamic_import<'s>(
    scope: &mut v8::HandleScope<'s>,
    message: &str,
) -> Option<v8::Local<'s, v8::Promise>> {
    let resolver = v8::PromiseResolver::new(scope)?;
    let message = v8::String::new(scope, message)?;
    let error = v8::Exception::type_error(scope, message);
    resolver.reject(scope, error);
    Some(resolver.get_promise(scope))
}

fn frame_dynamic_import_namespace(
    _scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue<v8::Value>,
) {
    rv.set(args.data());
}

fn frame_dynamic_import_rethrow(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue<v8::Value>,
) {
    scope.throw_exception(args.get(0));
}

fn frame_dynamic_import_evaluation<'s>(
    scope: &mut v8::HandleScope<'s>,
    evaluation: v8::Local<'s, v8::Promise>,
    namespace: v8::Local<'s, v8::Value>,
) -> Option<v8::Local<'s, v8::Promise>> {
    let on_fulfilled = v8::Function::builder(frame_dynamic_import_namespace)
        .data(namespace)
        .build(scope)?;
    let on_rejected = v8::Function::new(scope, frame_dynamic_import_rethrow)?;
    evaluation.then2(scope, on_fulfilled, on_rejected)
}

fn frame_dynamic_import_helper(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue<v8::Value>,
) {
    let Some(external) = v8::Local::<v8::External>::try_from(args.data()).ok() else {
        return;
    };
    let helper = unsafe { &*(external.value() as *const FrameDynamicImportHelper) };
    let raw = args.get(0).to_rust_string_lossy(scope);
    let Ok(referrer) = deno_core::ModuleSpecifier::parse(&helper.referrer_url) else {
        if let Some(promise) = reject_frame_dynamic_import(scope, "Invalid frame module referrer") {
            rv.set(promise.into());
        }
        return;
    };
    let map = unsafe { &mut *helper.module_map };
    let Ok(resolved) = map.import_map.resolve(&raw, &referrer) else {
        if let Some(promise) = reject_frame_dynamic_import(
            scope,
            &format!("Failed to resolve frame dynamic import {raw}"),
        ) {
            rv.set(promise.into());
        }
        return;
    };
    let module_key = resolved.to_string();
    let Some(module) = map.modules.get(&module_key).cloned() else {
        if let Some(promise) = reject_frame_dynamic_import(
            scope,
            &format!("Frame dynamic module was not prepared: {module_key}"),
        ) {
            rv.set(promise.into());
        }
        return;
    };
    let module = v8::Local::new(scope, &module);
    if module.get_status() == v8::ModuleStatus::Uninstantiated {
        scope.set_slot(map as *const FrameModuleMap);
        let instantiated = module.instantiate_module(scope, frame_module_resolve_callback);
        scope.remove_slot::<*const FrameModuleMap>();
        if instantiated != Some(true) {
            if let Some(promise) = reject_frame_dynamic_import(
                scope,
                &format!("Failed to instantiate frame dynamic module {module_key}"),
            ) {
                rv.set(promise.into());
            }
            return;
        }
    }
    if module.get_status() == v8::ModuleStatus::Errored {
        if let Some(resolver) = v8::PromiseResolver::new(scope) {
            resolver.reject(scope, module.get_exception());
            rv.set(resolver.get_promise(scope).into());
        }
        return;
    }
    let namespace = v8::Global::new(scope, module.get_module_namespace());
    let namespace = v8::Local::new(scope, &namespace);
    if let Some(evaluation) = map.evaluations.get(&module_key) {
        let evaluation = v8::Local::new(scope, evaluation);
        if let Some(promise) = frame_dynamic_import_evaluation(scope, evaluation, namespace) {
            rv.set(promise.into());
        }
        return;
    }
    if module.get_status() == v8::ModuleStatus::Evaluated {
        if let Some(resolver) = v8::PromiseResolver::new(scope) {
            resolver.resolve(scope, namespace);
            rv.set(resolver.get_promise(scope).into());
        }
        return;
    }
    if module.get_status() != v8::ModuleStatus::Instantiated {
        if let Some(promise) = reject_frame_dynamic_import(
            scope,
            &format!("Frame dynamic module is already evaluating: {module_key}"),
        ) {
            rv.set(promise.into());
        }
        return;
    }
    let Some(value) = module.evaluate(scope) else {
        if let Some(promise) = reject_frame_dynamic_import(
            scope,
            &format!("Failed to evaluate frame dynamic module {module_key}"),
        ) {
            rv.set(promise.into());
        }
        return;
    };
    let Ok(evaluation) = v8::Local::<v8::Promise>::try_from(value) else {
        return;
    };
    map.evaluations
        .insert(module_key, v8::Global::new(scope, evaluation));
    if let Some(promise) = frame_dynamic_import_evaluation(scope, evaluation, namespace) {
        rv.set(promise.into());
    }
}

impl ObscuraJsRuntime {
    /// Create a fresh context in this runtime's isolate and inject the main
    /// context's `Deno` binding object so ops are callable from realm script.
    fn create_realm_context(&mut self) -> Result<v8::Global<v8::Context>, String> {
        let main_context = self.deno_runtime_mut().main_context();
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let main_context = v8::Local::new(scope, &main_context);
        let (deno_key, deno_val, token, context_state, module_map) = {
            let scope = &mut v8::ContextScope::new(scope, main_context);
            let main_global = main_context.global(scope);
            let deno_key = v8::String::new(scope, "Deno").ok_or_else(|| alloc_err("key"))?;
            let deno_val = main_global
                .get(scope, deno_key.into())
                .filter(|v| v.is_object())
                .ok_or_else(|| "realm: main context has no Deno binding object".to_string())?;
            let token = main_context.get_security_token(scope);
            let context_state = main_context.get_aligned_pointer_from_embedder_data(
                deno_core::CONTEXT_STATE_SLOT_INDEX,
            );
            let module_map = main_context.get_aligned_pointer_from_embedder_data(
                deno_core::MODULE_MAP_SLOT_INDEX,
            );
            (
                v8::Global::new(scope, deno_key),
                v8::Global::new(scope, deno_val),
                v8::Global::new(scope, token),
                context_state,
                module_map,
            )
        };

        let context = v8::Context::new(scope, v8::ContextOptions::default());
        context.set_allow_generation_from_strings(false);
        // Same security token as the main context. Plain contexts install no
        // access-check callbacks, but equal tokens keep V8's same-origin
        // checks permissive while objects (Deno.core) are shared across
        // realms. Author-visible cross-frame access checks live in the
        // WindowProxy layer (bootstrap.js), not in V8 tokens.
        let token = v8::Local::new(scope, &token);
        context.set_security_token(token);
        // deno_core's isolate-wide dynamic-import hook unconditionally reads
        // these slots. Frame modules normally route import() through their own
        // helper below, but sharing the live main pointers makes an unhandled
        // syntax edge reject or fall back safely instead of dereferencing null
        // and crashing the worker process.
        unsafe {
            context.set_aligned_pointer_in_embedder_data(
                deno_core::CONTEXT_STATE_SLOT_INDEX,
                context_state,
            );
            context.set_aligned_pointer_in_embedder_data(
                deno_core::MODULE_MAP_SLOT_INDEX,
                module_map,
            );
        }
        {
            let scope = &mut v8::ContextScope::new(scope, context);
            let global = context.global(scope);
            let deno_key = v8::Local::new(scope, &deno_key);
            let deno_val = v8::Local::new(scope, &deno_val);
            global.set(scope, deno_key.into(), deno_val);
        }
        Ok(v8::Global::new(scope, context))
    }

    /// Spike entry point (implementation order item 1); the managed layer is
    /// [`ObscuraJsRuntime::ensure_frame_realm`].
    pub fn create_secondary_realm(&mut self) -> Result<SecondaryRealm, String> {
        Ok(SecondaryRealm {
            context: self.create_realm_context()?,
        })
    }

    /// Lazily create the Window realm for `(frame_id, generation)`. Returns
    /// `true` when a realm was created, `false` when one already existed (a
    /// generation identifies one committed document, so an existing entry is
    /// reused as-is). Creation follows the spike flow (fresh context, `Deno`
    /// binding, init globals, bootstrap re-execution, `__obscura_init`), with
    /// one addition: `__obscura_frame_document_nid` / `__obscura_frame_base_url`
    /// are defined on the realm global before bootstrap runs, which makes
    /// `__obscura_init` bind the realm's `document` to `content_root` as a
    /// `_ScopedDocument` (scoped op_dom queries) instead of the top document.
    pub fn ensure_frame_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        content_root: u32,
        base_url: &str,
    ) -> Result<bool, String> {
        self.ensure_frame_world_realm(frame_id, generation, MAIN_WORLD, None, content_root, base_url)
    }

    /// Lazily create a CDP isolated world realm (Phase 6.3) for
    /// `(frame_id, generation, world_id)`. `world_id` must be above
    /// [`MAIN_WORLD`]. The world gets its own `v8::Context` (own global, own
    /// DOM wrapper cache) but binds `document` to the same `content_root`, so
    /// its ops reach the same native DOM as the frame main world without
    /// leaking utility globals into it. Returns `true` on creation, `false`
    /// when the world already existed.
    pub fn ensure_isolated_world_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        world_id: u64,
        world_name: &str,
        content_root: u32,
        base_url: &str,
    ) -> Result<bool, String> {
        if world_id == MAIN_WORLD {
            return Err("realm: isolated world id must be above MAIN_WORLD".to_string());
        }
        self.ensure_frame_world_realm(
            frame_id,
            generation,
            world_id,
            Some(world_name),
            content_root,
            base_url,
        )
    }

    fn ensure_frame_world_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        world_id: u64,
        world_name: Option<&str>,
        content_root: u32,
        base_url: &str,
    ) -> Result<bool, String> {
        if self.frame_realms.contains_world(frame_id, generation, world_id) {
            return Ok(false);
        }

        let context = self.create_realm_context()?;
        {
            // The frame flags must exist before any realm script runs:
            // bootstrap and __obscura_init both execute below and the
            // document-binding hook reads the nid inside __obscura_init.
            let scope = &mut self.deno_runtime_mut().handle_scope();
            let context = v8::Local::new(scope, &context);
            let scope = &mut v8::ContextScope::new(scope, context);
            let global = context.global(scope);
            let nid_key = v8::String::new(scope, "__obscura_frame_document_nid")
                .ok_or_else(|| alloc_err("key"))?;
            let nid_val = v8::Number::new(scope, f64::from(content_root));
            global.set(scope, nid_key.into(), nid_val.into());
            let url_key = v8::String::new(scope, "__obscura_frame_base_url")
                .ok_or_else(|| alloc_err("key"))?;
            let url_val =
                v8::String::new(scope, base_url).ok_or_else(|| alloc_err("value"))?;
            global.set(scope, url_key.into(), url_val.into());
            // Realm identity for cross-document messaging (Phase 4): the
            // bootstrap reads these to identify the calling realm to the
            // postMessage ops. Author script in this realm could rewrite
            // them; that is the shared-isolate honesty boundary documented
            // in the design's Constraints, not a security mechanism.
            let fid_key = v8::String::new(scope, "__obscura_frame_id")
                .ok_or_else(|| alloc_err("key"))?;
            let fid_val =
                v8::String::new(scope, frame_id).ok_or_else(|| alloc_err("value"))?;
            global.set(scope, fid_key.into(), fid_val.into());
            let gen_key = v8::String::new(scope, "__obscura_frame_generation")
                .ok_or_else(|| alloc_err("key"))?;
            let gen_val = v8::Number::new(scope, generation as f64);
            global.set(scope, gen_key.into(), gen_val.into());
            // `document.all` is built through the V8 API, so each realm needs
            // its own; the bootstrap below installs it on this realm's
            // Document.prototype.
            crate::document_all::install(scope, context);
        }
        // Bootstrap runs first, matching the main context (its bootstrap is
        // baked into the snapshot, then `<obscura:init>` runs). REALM_INIT must
        // come after: bootstrap's `_preHideInternals` re-declares
        // `__obscura_objects` as undefined, so seeding it before bootstrap
        // would be wiped and the RemoteObject stash (Phase 6.2) would be
        // missing in the realm.
        self.execute_in_context(&context, "<obscura:frame-realm-bootstrap>", BOOTSTRAP_SRC)?;
        self.execute_in_context(&context, "<obscura:frame-realm-init>", REALM_INIT_SRC)?;
        // The runtime-owned fingerprint lands before `__obscura_init`, the
        // same order the main realm uses: init derives innerWidth/outer* from
        // the screen it can already see, so seeding the identity afterwards
        // left every frame reporting the bootstrap defaults (1920x1000) next
        // to a correctly re-seeded screen. The stealth and GPU-profile flags
        // travel with it: a frame that got the identity but not the flags
        // reported a different machine from its own parent.
        let fingerprint_json = serde_json::to_string(&self.fingerprint)
            .map_err(|error| format!("realm fingerprint serialization: {error}"))?;
        let stealth = self.stealth;
        let webgl_enabled = self.gpu_profile_enabled();
        self.execute_in_context(
            &context,
            "<obscura:frame-fingerprint>",
            &format!(
                "globalThis.__obscura_set_fingerprint({fingerprint_json}); \
                 globalThis.__obscura_stealth = {stealth}; \
                 globalThis.__obscura_webgl_enabled = {webgl_enabled};"
            ),
        )?;
        self.execute_in_context(
            &context,
            "<obscura:frame-realm-page-init>",
            "globalThis.__obscura_init();",
        )?;

        // Snapshot the content root's scope for later diagnostics/routing;
        // the scope may legitimately not exist yet (about:blank pre-commit).
        let (scope_url, scope_origin) = {
            let state = self.state_handle().borrow();
            match state.dom.as_ref().and_then(|dom| {
                dom.document_scope(obscura_dom::NodeId::new(content_root))
            }) {
                Some(scope) => (Some(scope.url.clone()), Some(scope.origin.serialize())),
                None => (None, None),
            }
        };
        self.frame_realms.realms.insert(
            (frame_id.to_string(), generation, world_id),
            FrameRealm {
                context,
                world_id,
                world_name: world_name.map(|s| s.to_string()),
                content_root,
                base_url: base_url.to_string(),
                scope_url,
                scope_origin,
            },
        );
        self.rebuild_frame_realm_global_registries()?;
        Ok(true)
    }

    /// Rebuild the context-local lookup used by JavaScript WindowProxy
    /// facades. Each receiver gets a live realm-owned bridge for every frame
    /// main world. Rebuilding, rather than mutating, also releases contexts
    /// belonging to destroyed generations.
    fn rebuild_frame_realm_global_registries(&mut self) -> Result<(), String> {
        let frame_targets: Vec<(u32, v8::Global<v8::Context>)> = self
            .frame_realms
            .realms
            .values()
            .filter(|realm| realm.world_id == MAIN_WORLD)
            .map(|realm| (realm.content_root, realm.context.clone()))
            .collect();
        let receiver_contexts: Vec<v8::Global<v8::Context>> = self
            .frame_realms
            .realms
            .values()
            .map(|realm| realm.context.clone())
            .collect();

        let main_context_global = self.deno_runtime_mut().main_context();
        let mut target_contexts = Vec::with_capacity(frame_targets.len() + 1);
        target_contexts.push((0, main_context_global.clone()));
        target_contexts.extend(frame_targets);
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let mut targets = Vec::with_capacity(target_contexts.len());
        for (content_root, context) in target_contexts {
            let context = v8::Local::new(scope, &context);
            let global = {
                let scope = &mut v8::ContextScope::new(scope, context);
                let global = context.global(scope);
                let key = v8::String::new(scope, "__obscura_realm_bridge")
                    .ok_or_else(|| alloc_err("realm bridge key"))?;
                let bridge = global
                    .get(scope, key.into())
                    .and_then(|value| value.to_object(scope))
                    .ok_or_else(|| "realm: frame context has no realm bridge".to_string())?;
                v8::Global::new(scope, bridge)
            };
            targets.push((content_root, global));
        }

        let mut receivers = Vec::with_capacity(receiver_contexts.len() + 1);
        receivers.push(main_context_global);
        receivers.extend(receiver_contexts);
        for receiver in receivers {
            let receiver = v8::Local::new(scope, &receiver);
            let scope = &mut v8::ContextScope::new(scope, receiver);
            let registry = v8::Object::new(scope);
            for (content_root, target) in &targets {
                let key = v8::String::new(scope, &content_root.to_string())
                    .ok_or_else(|| alloc_err("frame realm registry key"))?;
                let target = v8::Local::new(scope, target);
                if registry.set(scope, key.into(), target.into()) != Some(true) {
                    return Err("realm: failed to populate frame global registry".to_string());
                }
            }
            let key = v8::String::new(scope, "__obscura_frame_realm_globals")
                .ok_or_else(|| alloc_err("frame realm registry property"))?;
            let global = receiver.global(scope);
            if global.set(scope, key.into(), registry.into()) != Some(true) {
                return Err("realm: failed to install frame global registry".to_string());
            }
        }
        Ok(())
    }

    /// Run `source` with Script semantics in the realm registered for
    /// `(frame_id, generation)`; the JSON-ified completion value follows
    /// [`ObscuraJsRuntime::realm_execute_script`].
    pub fn execute_script_in_frame_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        name: &str,
        source: &str,
    ) -> Result<serde_json::Value, String> {
        self.execute_script_in_frame_world_realm(frame_id, generation, MAIN_WORLD, name, source)
    }

    pub fn execute_script_in_frame_realm_at_line(
        &mut self,
        frame_id: &str,
        generation: u64,
        name: &str,
        source: &str,
        line: u64,
    ) -> Result<serde_json::Value, String> {
        self.execute_script_in_frame_world_realm_at_line(
            frame_id,
            generation,
            MAIN_WORLD,
            name,
            source,
            line,
        )
    }

    /// Merge a parser-discovered import map into one frame Document's module
    /// map. Resolution history is document-local, matching the browser model.
    pub fn add_frame_import_map(
        &mut self,
        frame_id: &str,
        generation: u64,
        source: &str,
        base_url: &str,
    ) -> Result<(), String> {
        let parsed = ImportMap::parse(source, base_url)?;
        self.frame_module_maps
            .entry((frame_id.to_string(), generation))
            .or_default()
            .import_map
            .merge(parsed);
        Ok(())
    }

    /// Fetch and compile an ES module graph in a frame's own V8
    /// context. deno_core's public module APIs always target its main realm,
    /// so using them here would point global and DOM access at the top Window.
    pub async fn prepare_module_in_frame_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        root_key: &str,
        module_url: &str,
        inline_source: Option<&str>,
        document_url: &str,
        csp: Option<FrameModuleCsp>,
        budget_ms: u64,
    ) -> Result<(), String> {
        let context = self.frame_world_context(frame_id, generation, MAIN_WORLD)?;
        let map_key = (frame_id.to_string(), generation);
        let mut module_map = self
            .frame_module_maps
            .remove(&map_key)
            .unwrap_or_else(|| Box::new(FrameModuleMap::default()));
        let result = self
            .prepare_frame_module_graph(
                &context,
                module_map.as_mut(),
                root_key,
                module_url,
                inline_source,
                document_url,
                csp.as_ref(),
                budget_ms,
            )
            .await;
        self.frame_module_maps.insert(map_key, module_map);
        result
    }

    async fn prepare_frame_module_graph(
        &mut self,
        context: &v8::Global<v8::Context>,
        module_map: &mut FrameModuleMap,
        root_key: &str,
        module_url: &str,
        inline_source: Option<&str>,
        document_url: &str,
        csp: Option<&FrameModuleCsp>,
        budget_ms: u64,
    ) -> Result<(), String> {
        let deadline =
            tokio::time::Instant::now() + tokio::time::Duration::from_millis(budget_ms);
        let mut pending = std::collections::VecDeque::from([(
            root_key.to_string(),
            module_url.to_string(),
            inline_source.map(str::to_string),
            document_url.to_string(),
        )]);

        while let Some((module_key, requested_url, inline, referrer_url)) = pending.pop_front() {
            if module_map.modules.contains_key(&module_key) {
                continue;
            }
            let (final_url, source) = match inline {
                Some(source) => (requested_url, source),
                None => {
                    if csp.is_some_and(|policy| !policy.allows_url(&requested_url)) {
                        return Err(format!(
                            "Frame module blocked by Content-Security-Policy: {requested_url}"
                        ));
                    }
                    let remaining = deadline
                        .checked_duration_since(tokio::time::Instant::now())
                        .ok_or_else(|| "Frame module graph load timed out".to_string())?;
                    tokio::time::timeout(
                        remaining,
                        self.fetch_frame_module_source(
                            &requested_url,
                            document_url,
                            &referrer_url,
                        ),
                    )
                    .await
                    .map_err(|_| "Frame module graph load timed out".to_string())??
                }
            };

            let (identity, requests, dynamic_requests) = self.compile_frame_module_source(
                context,
                module_map,
                &module_key,
                &final_url,
                &source,
            )?;
            let referrer = deno_core::ModuleSpecifier::parse(&final_url)
                .map_err(|error| format!("Invalid frame module URL {final_url}: {error}"))?;
            for raw in requests {
                let resolved = module_map.import_map.resolve(&raw, &referrer)?;
                let resolved_key = resolved.to_string();
                module_map
                    .resolutions
                    .insert((identity, raw), resolved_key.clone());
                if !module_map.modules.contains_key(&resolved_key) {
                    if csp.is_some_and(|policy| !policy.allows_url(&resolved_key)) {
                        return Err(format!(
                            "Frame module import blocked by Content-Security-Policy: {resolved_key}"
                        ));
                    }
                    pending.push_back((
                        resolved_key.clone(),
                        resolved_key,
                        None,
                        final_url.clone(),
                    ));
                }
            }
            for raw in dynamic_requests {
                let resolved = module_map.import_map.resolve(&raw, &referrer)?;
                let resolved_key = resolved.to_string();
                if !module_map.modules.contains_key(&resolved_key) {
                    if csp.is_some_and(|policy| !policy.allows_url(&resolved_key)) {
                        return Err(format!(
                            "Frame dynamic module import blocked by Content-Security-Policy: {resolved_key}"
                        ));
                    }
                    pending.push_back((
                        resolved_key.clone(),
                        resolved_key,
                        None,
                        final_url.clone(),
                    ));
                }
            }
        }

        Ok(())
    }

    /// Instantiate and evaluate a graph prepared by
    /// [`Self::prepare_module_in_frame_realm`]. Keeping this separate lets the
    /// HTML scheduler fetch modules at their parser encounter point while
    /// deferring non-async evaluation until parsing is complete.
    pub async fn evaluate_module_in_frame_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        root_key: &str,
        budget_ms: u64,
    ) -> Result<(), String> {
        let context = self.frame_world_context(frame_id, generation, MAIN_WORLD)?;
        let map_key = (frame_id.to_string(), generation);
        let mut module_map = self
            .frame_module_maps
            .remove(&map_key)
            .unwrap_or_else(|| Box::new(FrameModuleMap::default()));
        let result = self
            .evaluate_frame_module(&context, module_map.as_mut(), root_key, budget_ms)
            .await;
        self.frame_module_maps.insert(map_key, module_map);
        result
    }

    async fn evaluate_frame_module(
        &mut self,
        context: &v8::Global<v8::Context>,
        module_map: &mut FrameModuleMap,
        root_key: &str,
        budget_ms: u64,
    ) -> Result<(), String> {
        let deadline =
            tokio::time::Instant::now() + tokio::time::Duration::from_millis(budget_ms);
        let root = module_map
            .modules
            .get(root_key)
            .ok_or_else(|| "Frame root module was not compiled".to_string())?
            .clone();
        let promise = if let Some(promise) = module_map.evaluations.get(root_key) {
            promise.clone()
        } else {
            let scope = &mut self.deno_runtime_mut().handle_scope();
            let context = v8::Local::new(scope, context);
            let scope = &mut v8::ContextScope::new(scope, context);
            let module = v8::Local::new(scope, &root);
            if module.get_status() == v8::ModuleStatus::Evaluated {
                return Ok(());
            }
            if module.get_status() == v8::ModuleStatus::Uninstantiated {
                scope.set_slot(module_map as *const FrameModuleMap);
                let instantiated =
                    module.instantiate_module(scope, frame_module_resolve_callback);
                scope.remove_slot::<*const FrameModuleMap>();
                if instantiated.is_none() {
                    return Err("Frame module instantiation error".to_string());
                }
            }
            let value = module.evaluate(scope).ok_or_else(|| {
                let message = module.get_exception().to_rust_string_lossy(scope);
                format!("Frame module evaluation error: {message}")
            })?;
            let promise = v8::Local::<v8::Promise>::try_from(value)
                .map_err(|_| "Frame module evaluation did not return a Promise".to_string())?;
            let promise = v8::Global::new(scope, promise);
            module_map
                .evaluations
                .insert(root_key.to_string(), promise.clone());
            promise
        };

        let completed = self
            .resolve_promises_until(
                |runtime| {
                    runtime.frame_module_promise_state(context, &promise)
                        != v8::PromiseState::Pending
                },
                deadline
                    .checked_duration_since(tokio::time::Instant::now())
                    .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
                    .unwrap_or(0),
            )
            .await;
        if !completed {
            return Err("Frame module evaluation timed out".to_string());
        }
        let (state, result) = self.frame_module_promise_result(context, &promise);
        match state {
            v8::PromiseState::Fulfilled => Ok(()),
            v8::PromiseState::Rejected => Err(format!("Frame module evaluation error: {result}")),
            v8::PromiseState::Pending => Err("Frame module evaluation timed out".to_string()),
        }
    }

    async fn fetch_frame_module_source(
        &self,
        url: &str,
        document_url: &str,
        referrer_url: &str,
    ) -> Result<(String, String), String> {
        let requested = deno_core::ModuleSpecifier::parse(url)
            .map_err(|error| format!("Invalid frame module URL {url}: {error}"))?;
        if requested.scheme() == "data" {
            let source = decode_frame_module_data_url(url)
                .ok_or_else(|| "Invalid data: frame module URL".to_string())?;
            return Ok((url.to_string(), source));
        }
        let document = deno_core::ModuleSpecifier::parse(document_url)
            .unwrap_or_else(|_| requested.clone());
        let referrer = deno_core::ModuleSpecifier::parse(referrer_url)
            .unwrap_or_else(|_| document.clone());
        let (client, callbacks) = {
            let state = self.state_handle().borrow();
            (
                state
                    .http_client
                    .clone()
                    .ok_or_else(|| "No HTTP client wired for frame modules".to_string())?,
                state.callbacks.clone(),
            )
        };
        let response = client
            .fetch_resource_with_callbacks(
                &requested,
                obscura_net::ResourceRequest::module_script(&document, &referrer),
                callbacks.as_deref(),
            )
            .await
            .map_err(|error| format!("Failed to fetch frame module {url}: {error}"))?;
        if !(200..=299).contains(&response.status) {
            return Err(format!(
                "Frame module {url} returned HTTP {}",
                response.status
            ));
        }
        let source = obscura_net::decode_non_html(&response.body, response.content_type());
        Ok((response.url.to_string(), source))
    }

    fn compile_frame_module_source(
        &mut self,
        context: &v8::Global<v8::Context>,
        module_map: &mut FrameModuleMap,
        module_key: &str,
        module_url: &str,
        source: &str,
    ) -> Result<(i32, Vec<String>, Vec<String>), String> {
        let helper_name = format!(
            "__obscura_frame_dynamic_import_{}",
            module_map.next_dynamic_helper,
        );
        module_map.next_dynamic_helper = module_map.next_dynamic_helper.wrapping_add(1);
        let (source, dynamic_requests) =
            rewrite_frame_dynamic_imports(source, &helper_name);
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);
        let source = v8::String::new(scope, &source)
            .ok_or_else(|| alloc_err("module source"))?;
        let name = v8::String::new(scope, module_url)
            .ok_or_else(|| alloc_err("module URL"))?;
        let origin = v8::ScriptOrigin::new(
            scope,
            name.into(),
            0,
            0,
            false,
            -1,
            None,
            false,
            false,
            true,
            None,
        );
        let mut source = v8::script_compiler::Source::new(source, Some(&origin));
        let scope = &mut v8::TryCatch::new(scope);
        let module = v8::script_compiler::compile_module(scope, &mut source).ok_or_else(|| {
            let message = scope
                .exception()
                .map(|value| value.to_rust_string_lossy(scope))
                .unwrap_or_else(|| "unknown compile error".to_string());
            format!("Frame module compile error ({module_url}): {message}")
        })?;
        let identity = module.get_identity_hash().get();
        let requests = module.get_module_requests();
        let mut imports = Vec::with_capacity(requests.length());
        for index in 0..requests.length() {
            let request = requests
                .get(scope, index)
                .and_then(|value| v8::Local::<v8::ModuleRequest>::try_from(value).ok())
                .ok_or_else(|| "Frame module request metadata was invalid".to_string())?;
            imports.push(request.get_specifier().to_rust_string_lossy(scope));
        }
        module_map
            .modules
            .insert(module_key.to_string(), v8::Global::new(scope, module));
        let helper = Box::new(FrameDynamicImportHelper {
            module_map: module_map as *mut FrameModuleMap,
            referrer_url: module_url.to_string(),
        });
        let helper_ptr = (&*helper) as *const FrameDynamicImportHelper as *mut std::ffi::c_void;
        let data = v8::External::new(scope, helper_ptr);
        let function = v8::Function::builder(frame_dynamic_import_helper)
            .data(data.into())
            .build(scope)
            .ok_or_else(|| alloc_err("frame dynamic import helper"))?;
        let global = scope.get_current_context().global(scope);
        let name = v8::String::new(scope, &helper_name)
            .ok_or_else(|| alloc_err("frame dynamic import helper name"))?;
        let attributes = v8::PropertyAttribute::READ_ONLY
            | v8::PropertyAttribute::DONT_ENUM
            | v8::PropertyAttribute::DONT_DELETE;
        if global.define_own_property(scope, name.into(), function.into(), attributes) != Some(true) {
            return Err("Failed to install frame dynamic import helper".to_string());
        }
        module_map.dynamic_helpers.push(helper);
        Ok((identity, imports, dynamic_requests))
    }

    fn frame_module_promise_state(
        &mut self,
        context: &v8::Global<v8::Context>,
        promise: &v8::Global<v8::Promise>,
    ) -> v8::PromiseState {
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);
        v8::Local::new(scope, promise).state()
    }

    fn frame_module_promise_result(
        &mut self,
        context: &v8::Global<v8::Context>,
        promise: &v8::Global<v8::Promise>,
    ) -> (v8::PromiseState, String) {
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);
        let promise = v8::Local::new(scope, promise);
        (
            promise.state(),
            promise.result(scope).to_rust_string_lossy(scope),
        )
    }

    /// Run `source` with Script semantics in a specific frame world realm.
    pub fn execute_script_in_frame_world_realm(
        &mut self,
        frame_id: &str,
        generation: u64,
        world_id: u64,
        name: &str,
        source: &str,
    ) -> Result<serde_json::Value, String> {
        // Clone the handle (a second Global to the same context) so the
        // registry borrow ends before V8 re-borrows the runtime.
        let context = self.frame_world_context(frame_id, generation, world_id)?;
        self.execute_in_context(&context, name, source)
    }

    pub fn execute_script_in_frame_world_realm_at_line(
        &mut self,
        frame_id: &str,
        generation: u64,
        world_id: u64,
        name: &str,
        source: &str,
        line: u64,
    ) -> Result<serde_json::Value, String> {
        let context = self.frame_world_context(frame_id, generation, world_id)?;
        self.execute_in_context_at(&context, name, source, line)
    }

    /// Clone the context handle for a frame world realm, or a no-realm error.
    pub(crate) fn frame_world_context(
        &self,
        frame_id: &str,
        generation: u64,
        world_id: u64,
    ) -> Result<v8::Global<v8::Context>, String> {
        self.frame_realms
            .get_world(frame_id, generation, world_id)
            .map(|realm| realm.context.clone())
            .ok_or_else(|| {
                format!(
                    "realm: no frame realm for ({frame_id}, generation {generation}, world {world_id})"
                )
            })
    }

    /// Destroy one document generation's realms (every world). Returns whether
    /// any existed. Object handles bound to those worlds are invalidated.
    pub fn destroy_frame_realm_generation(&mut self, frame_id: &str, generation: u64) -> bool {
        self.frame_module_maps
            .remove(&(frame_id.to_string(), generation));
        let before = self.frame_realms.realms.len();
        self.frame_realms
            .realms
            .retain(|(id, gen, _), _| !(id == frame_id && *gen == generation));
        let removed = before - self.frame_realms.realms.len();
        if removed > 0 {
            self.invalidate_object_handles(frame_id, Some(generation));
            let _ = self.rebuild_frame_realm_global_registries();
            self.deno_runtime_mut().v8_isolate().low_memory_notification();
        }
        removed > 0
    }

    /// Destroy every realm registered for `frame_id` (all generations and
    /// worlds), e.g. on frame detach. Returns how many were dropped.
    pub fn destroy_frame_realm(&mut self, frame_id: &str) -> usize {
        self.frame_module_maps
            .retain(|(id, _), _| id != frame_id);
        let before = self.frame_realms.realms.len();
        self.frame_realms.realms.retain(|(id, _, _), _| id != frame_id);
        let removed = before - self.frame_realms.realms.len();
        if removed > 0 {
            self.invalidate_object_handles(frame_id, None);
            let _ = self.rebuild_frame_realm_global_registries();
            self.deno_runtime_mut().v8_isolate().low_memory_notification();
        }
        removed
    }

    /// Registry view of the frame main world, for callers that only need
    /// metadata.
    pub fn frame_realm(&self, frame_id: &str, generation: u64) -> Option<&FrameRealm> {
        self.frame_realms.get(frame_id, generation)
    }

    /// Registry view of a specific world.
    pub fn frame_realm_world(
        &self,
        frame_id: &str,
        generation: u64,
        world_id: u64,
    ) -> Option<&FrameRealm> {
        self.frame_realms.get_world(frame_id, generation, world_id)
    }

    /// Keys of every live frame realm world. Empty (and allocation-free apart
    /// from the Vec) on pages without iframes.
    pub fn frame_realm_keys(&self) -> Vec<(String, u64, u64)> {
        self.frame_realms.realms.keys().cloned().collect()
    }

    /// Read-only projection for CDP execution-context events (Phase 6.2):
    /// `(frame_id, generation, world_id, is_default)` for every live realm.
    pub fn list_frame_realms(&self) -> Vec<(String, u64, u64, bool)> {
        self.frame_realms
            .realms
            .iter()
            .map(|((id, gen, world), realm)| {
                (id.clone(), *gen, *world, realm.is_default())
            })
            .collect()
    }

    /// Install the runtime-init globals and re-execute bootstrap.js in the
    /// realm. Order matters: the Deno binding was injected at creation, the
    /// init globals come next, then the bootstrap source (it calls ops).
    pub fn bootstrap_secondary_realm(&mut self, realm: &SecondaryRealm) -> Result<(), String> {
        self.realm_execute_script(realm, "<obscura:realm-init>", REALM_INIT_SRC)?;
        self.realm_execute_script(realm, "<obscura:realm-bootstrap>", BOOTSTRAP_SRC)?;
        Ok(())
    }

    /// Run `__obscura_init()` in the realm, the per-page half of bootstrap.
    /// Requires an installed DOM (`set_dom`): it resolves the document node
    /// over `op_dom`.
    pub fn init_secondary_realm_page(&mut self, realm: &SecondaryRealm) -> Result<(), String> {
        self.realm_execute_script(
            realm,
            "<obscura:realm-page-init>",
            "globalThis.__obscura_init();",
        )?;
        Ok(())
    }

    /// Test helper: expose the main context's global proxy in the realm under
    /// `name` so realm scripts can compare identities across realms.
    pub fn realm_expose_main_global(
        &mut self,
        realm: &SecondaryRealm,
        name: &str,
    ) -> Result<(), String> {
        let context = realm.context.clone();
        self.expose_main_global_in_context(&context, name)
    }

    /// Test helper: same as [`ObscuraJsRuntime::realm_expose_main_global`],
    /// for a managed frame realm.
    pub fn frame_realm_expose_main_global(
        &mut self,
        frame_id: &str,
        generation: u64,
        name: &str,
    ) -> Result<(), String> {
        let context = self
            .frame_realms
            .get(frame_id, generation)
            .ok_or_else(|| {
                format!("realm: no frame realm for ({frame_id}, generation {generation})")
            })?
            .context
            .clone();
        self.expose_main_global_in_context(&context, name)
    }

    fn expose_main_global_in_context(
        &mut self,
        context: &v8::Global<v8::Context>,
        name: &str,
    ) -> Result<(), String> {
        let main_context = self.deno_runtime_mut().main_context();
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let main_context = v8::Local::new(scope, &main_context);
        let main_global = {
            let scope = &mut v8::ContextScope::new(scope, main_context);
            let main_global = main_context.global(scope);
            v8::Global::new(scope, main_global)
        };
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);
        let key = v8::String::new(scope, name).ok_or_else(|| alloc_err("key"))?;
        let global = context.global(scope);
        let main_global = v8::Local::new(scope, &main_global);
        global.set(scope, key.into(), main_global.into());
        Ok(())
    }

    /// Compile and run `source` with Script semantics in the realm's context.
    /// Top-level `var`/`function`, directive prologues and the completion
    /// value all follow the Script goal, mirroring `execute_classic_script`.
    /// The completion value is returned JSON-ified (objects via
    /// JSON.stringify) for test assertions.
    pub fn realm_execute_script(
        &mut self,
        realm: &SecondaryRealm,
        name: &str,
        source: &str,
    ) -> Result<serde_json::Value, String> {
        let context = realm.context.clone();
        self.execute_in_context(&context, name, source)
    }

    pub(crate) fn execute_in_context(
        &mut self,
        context: &v8::Global<v8::Context>,
        name: &str,
        source: &str,
    ) -> Result<serde_json::Value, String> {
        self.execute_in_context_at(context, name, source, 0)
    }

    pub(crate) fn execute_in_context_at(
        &mut self,
        context: &v8::Global<v8::Context>,
        name: &str,
        source: &str,
        line: u64,
    ) -> Result<serde_json::Value, String> {
        let _trace_guard = self.trace_suppression_guard(
            name.starts_with('<') && name != "<eval>",
        );
        let scope = &mut self.deno_runtime_mut().handle_scope();
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);

        let source =
            v8::String::new(scope, source).ok_or_else(|| alloc_err("source"))?;
        let name = v8::String::new(scope, name).ok_or_else(|| alloc_err("script URL"))?;
        let origin = v8::ScriptOrigin::new(
            scope,
            name.into(),
            line.saturating_sub(1).min(i32::MAX as u64) as i32,
            0,
            false,
            0,
            None,
            false,
            false,
            false,
            None,
        );
        let scope = &mut v8::TryCatch::new(scope);
        let Some(script) = v8::Script::compile(scope, source, Some(&origin)) else {
            return Err(realm_error(scope, "compilation"));
        };
        let Some(value) = script.run(scope) else {
            return Err(realm_error(scope, "execution"));
        };

        if value.is_undefined() || value.is_null() {
            return Ok(serde_json::Value::Null);
        }
        if value.is_boolean() {
            return Ok(serde_json::Value::Bool(value.boolean_value(scope)));
        }
        if value.is_number() {
            let n = value.number_value(scope).unwrap_or(0.0);
            return Ok(serde_json::json!(n));
        }
        if value.is_string() {
            return Ok(serde_json::Value::String(value.to_rust_string_lossy(scope)));
        }
        if let Some(json) = v8::json::stringify(scope, value) {
            let text = json.to_rust_string_lossy(scope);
            if let Ok(parsed) = serde_json::from_str(&text) {
                return Ok(parsed);
            }
        }
        Ok(serde_json::Value::String(value.to_rust_string_lossy(scope)))
    }

    /// Drop the realm's context and ask V8 for a full GC so context teardown
    /// happens now rather than at isolate drop.
    pub fn destroy_secondary_realm(&mut self, realm: SecondaryRealm) {
        drop(realm);
        self.deno_runtime_mut().v8_isolate().low_memory_notification();
    }
}

/// Compile and run `source` in the scope's current context, discarding the
/// completion value. Scope-based twin of `execute_in_context_at`, for the
/// synchronous realm path where only an op's own scope is available.
fn run_script(scope: &mut v8::HandleScope, name: &str, source: &str) -> Result<(), String> {
    let source = v8::String::new(scope, source).ok_or_else(|| alloc_err("source"))?;
    let name = v8::String::new(scope, name).ok_or_else(|| alloc_err("script URL"))?;
    let origin = v8::ScriptOrigin::new(
        scope,
        name.into(),
        0,
        0,
        false,
        0,
        None,
        false,
        false,
        false,
        None,
    );
    let scope = &mut v8::TryCatch::new(scope);
    let Some(script) = v8::Script::compile(scope, source, Some(&origin)) else {
        return Err(realm_error(scope, "compilation"));
    };
    if script.run(scope).is_none() {
        return Err(realm_error(scope, "execution"));
    }
    Ok(())
}

/// Synchronously create and register a frame main-world realm, the op-callable
/// twin of `ensure_frame_world_realm`. It takes the op's own `v8::HandleScope`
/// and a borrowed `FrameRealmHost` instead of `&mut self`, so a freshly-appended
/// iframe can materialize its Window realm before the event loop runs. Returns
/// the new realm's bridge object (for the JS side to cache), or `Ok(None)` when
/// the realm already exists.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_frame_realm(
    scope: &mut v8::HandleScope,
    frame_realms: &mut FrameRealmHost,
    frame_id: &str,
    generation: u64,
    content_root: u32,
    base_url: &str,
    fingerprint_json: &str,
    stealth: bool,
    webgl_enabled: bool,
    scope_url: Option<String>,
    scope_origin: Option<String>,
) -> Result<Option<v8::Global<v8::Object>>, String> {
    if frame_realms.contains_world(frame_id, generation, MAIN_WORLD) {
        return Ok(None);
    }

    // An op's scope reports the main context (Deno.core.ops is shared across
    // realms), so the current context carries the main realm's Deno binding,
    // security token and embedder slots. Read them here; the new context copies
    // all three, exactly as the async path does.
    let current = scope.get_current_context();
    let deno_val = {
        let key = v8::String::new(scope, "Deno").ok_or_else(|| alloc_err("key"))?;
        current
            .global(scope)
            .get(scope, key.into())
            .filter(|value| value.is_object())
            .ok_or_else(|| "realm: no Deno binding object".to_string())?
    };
    let deno_val = v8::Global::new(scope, deno_val);
    let token = current.get_security_token(scope);
    let context_state =
        current.get_aligned_pointer_from_embedder_data(deno_core::CONTEXT_STATE_SLOT_INDEX);
    let module_map =
        current.get_aligned_pointer_from_embedder_data(deno_core::MODULE_MAP_SLOT_INDEX);

    let context = v8::Context::new(scope, v8::ContextOptions::default());
    context.set_allow_generation_from_strings(false);
    context.set_security_token(token);
    unsafe {
        context.set_aligned_pointer_in_embedder_data(
            deno_core::CONTEXT_STATE_SLOT_INDEX,
            context_state,
        );
        context.set_aligned_pointer_in_embedder_data(
            deno_core::MODULE_MAP_SLOT_INDEX,
            module_map,
        );
    }

    let bridge = {
        let scope = &mut v8::ContextScope::new(scope, context);
        let global = context.global(scope);
        let deno_key = v8::String::new(scope, "Deno").ok_or_else(|| alloc_err("key"))?;
        let deno_local = v8::Local::new(scope, &deno_val);
        global.set(scope, deno_key.into(), deno_local.into());

        let nid_key = v8::String::new(scope, "__obscura_frame_document_nid")
            .ok_or_else(|| alloc_err("key"))?;
        let nid_val = v8::Number::new(scope, f64::from(content_root));
        global.set(scope, nid_key.into(), nid_val.into());
        let url_key = v8::String::new(scope, "__obscura_frame_base_url")
            .ok_or_else(|| alloc_err("key"))?;
        let url_val = v8::String::new(scope, base_url).ok_or_else(|| alloc_err("value"))?;
        global.set(scope, url_key.into(), url_val.into());
        let fid_key =
            v8::String::new(scope, "__obscura_frame_id").ok_or_else(|| alloc_err("key"))?;
        let fid_val = v8::String::new(scope, frame_id).ok_or_else(|| alloc_err("value"))?;
        global.set(scope, fid_key.into(), fid_val.into());
        let gen_key = v8::String::new(scope, "__obscura_frame_generation")
            .ok_or_else(|| alloc_err("key"))?;
        let gen_val = v8::Number::new(scope, generation as f64);
        global.set(scope, gen_key.into(), gen_val.into());

        crate::document_all::install(scope, context);

        run_script(scope, "<obscura:frame-realm-bootstrap>", BOOTSTRAP_SRC)?;
        run_script(scope, "<obscura:frame-realm-init>", REALM_INIT_SRC)?;
        // Fingerprint before init, matching the main realm's order (see the
        // comment in ensure_frame_world_realm).
        let fingerprint_src = format!(
            "globalThis.__obscura_set_fingerprint({fingerprint_json}); \
             globalThis.__obscura_stealth = {stealth}; \
             globalThis.__obscura_webgl_enabled = {webgl_enabled};"
        );
        run_script(scope, "<obscura:frame-fingerprint>", &fingerprint_src)?;
        run_script(
            scope,
            "<obscura:frame-realm-page-init>",
            "globalThis.__obscura_init();",
        )?;

        let bridge_key = v8::String::new(scope, "__obscura_realm_bridge")
            .ok_or_else(|| alloc_err("key"))?;
        match global.get(scope, bridge_key.into()) {
            Some(value) if value.is_object() => {
                let bridge = value.to_object(scope).ok_or_else(|| alloc_err("bridge"))?;
                Some(v8::Global::new(scope, bridge))
            }
            _ => None,
        }
    };

    frame_realms.realms.insert(
        (frame_id.to_string(), generation, MAIN_WORLD),
        FrameRealm {
            context: v8::Global::new(scope, context),
            world_id: MAIN_WORLD,
            world_name: None,
            content_root,
            base_url: base_url.to_string(),
            scope_url,
            scope_origin,
        },
    );
    Ok(bridge)
}

fn realm_error(scope: &mut v8::TryCatch<v8::HandleScope>, phase: &str) -> String {
    if scope.is_execution_terminating() {
        scope.cancel_terminate_execution();
        return "JS error: Uncaught Error: execution terminated".to_string();
    }
    match scope.exception() {
        Some(exception) => {
            // Stringify the exception directly instead of
            // JsError::from_v8_exception: the latter walks the V8 stack trace
            // assuming the isolate's default context is current, and crashes
            // (EXC_BAD_ACCESS) when called inside a secondary realm's
            // ContextScope. A plain coercion is context-safe and enough for a
            // frame realm error message.
            let msg = exception.to_rust_string_lossy(scope);
            format!("JS error: {msg}")
        }
        None => format!("JS error: script {phase} failed without an exception"),
    }
}

#[cfg(test)]
mod tests {
    use super::{rewrite_frame_dynamic_imports, FrameModuleCsp};
    use crate::runtime::ObscuraJsRuntime;
    use obscura_dom::parse_html;

    fn setup_runtime(html: &str) -> ObscuraJsRuntime {
        let dom = parse_html(html);
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(dom);
        rt.set_url("http://example.com/test");
        rt.set_title("Test Page");
        rt.run_page_init();
        rt
    }

    #[test]
    fn frame_dynamic_import_rewrite_ignores_text_comments_and_regexes() {
        let source = r#"
            const literal = import('./literal.js');
            const escaped = import /* gap */ ('./\u0065scaped.js');
            const noSubstitution = import(`./template.js`);
            const computed = import(name);
            const text = "import('./text.js')";
            // import('./comment.js')
            const pattern = /import\(['"]ignored/;
            const template = `text ${import('./nested.js').then(use)}`;
        "#;
        let (rewritten, literals) =
            rewrite_frame_dynamic_imports(source, "__frame_import");
        assert_eq!(
            literals,
            vec!["./literal.js", "./escaped.js", "./template.js", "./nested.js"]
        );
        assert!(rewritten.contains("__frame_import('./literal.js')"));
        assert!(rewritten.contains("__frame_import /* gap */ ('./\\u0065scaped.js')"));
        assert!(rewritten.contains("__frame_import(`./template.js`)"));
        assert!(rewritten.contains("__frame_import(name)"));
        assert!(rewritten.contains("\"import('./text.js')\""));
        assert!(rewritten.contains("// import('./comment.js')"));
        assert!(rewritten.contains("/import\\(['\"]ignored/"));
        assert!(rewritten.contains("`text ${__frame_import('./nested.js').then(use)}`"));
    }

    #[test]
    fn frame_module_csp_uses_directive_precedence_and_document_scheme() {
        let policy = FrameModuleCsp::new(
            "default-src 'none'; script-src https://cdn.example; script-src-elem 'self'",
            "https://app.example/frame",
        );
        assert!(policy.allows_url("https://app.example/dep.js"));
        assert!(!policy.allows_url("https://cdn.example/dep.js"));

        let first_wins = FrameModuleCsp::new(
            "script-src https://blocked.example; script-src https://allowed.example",
            "https://app.example/frame",
        );
        assert!(!first_wins.allows_url("https://allowed.example/dep.js"));

        let scheme_less = FrameModuleCsp::new("script-src app.example", "https://app.example/frame");
        assert!(scheme_less.allows_url("https://app.example/dep.js"));
        assert!(!scheme_less.allows_url("http://app.example/dep.js"));
    }

    #[test]
    fn secondary_realm_top_level_bindings_stay_out_of_main_context() {
        let mut rt = setup_runtime("<html><body></body></html>");
        let realm = rt.create_secondary_realm().unwrap();
        rt.bootstrap_secondary_realm(&realm).unwrap();

        rt.realm_execute_script(
            &realm,
            "<t>",
            "var __realm_spike_x = 41; function __realm_spike_f() { return __realm_spike_x + 1; }",
        )
        .unwrap();
        assert_eq!(
            rt.realm_execute_script(
                &realm,
                "<t>",
                "[typeof __realm_spike_x, typeof __realm_spike_f, __realm_spike_f(), globalThis.__realm_spike_x]",
            )
            .unwrap(),
            serde_json::json!(["number", "function", 42, 41])
        );
        // The main context must not see the realm's top-level bindings.
        assert_eq!(
            rt.evaluate("[typeof __realm_spike_x, typeof __realm_spike_f]")
                .unwrap(),
            serde_json::json!(["undefined", "undefined"])
        );
    }

    #[test]
    fn secondary_realm_has_own_global_and_intrinsics() {
        let mut rt = setup_runtime("<html><body></body></html>");
        let realm = rt.create_secondary_realm().unwrap();
        rt.bootstrap_secondary_realm(&realm).unwrap();
        rt.realm_expose_main_global(&realm, "__main").unwrap();

        assert_eq!(
            rt.realm_execute_script(
                &realm,
                "<t>",
                r#"[
                    globalThis !== __main,
                    Object !== __main.Object,
                    Array !== __main.Array,
                    ({}) instanceof Object,
                    (new __main.Object()) instanceof __main.Object,
                    !(({}) instanceof __main.Object),
                ]"#,
            )
            .unwrap(),
            serde_json::json!([true, true, true, true, true, true])
        );

        // A Script-goal directive prologue applies to the whole script.
        assert_eq!(
            rt.realm_execute_script(
                &realm,
                "<t>",
                r#""use strict";
                var __strict_probe;
                try { __realm_spike_undeclared = 1; __strict_probe = "assigned"; }
                catch (e) { __strict_probe = e.constructor.name; }
                __strict_probe"#,
            )
            .unwrap(),
            serde_json::json!("ReferenceError")
        );
        // Without the directive the same assignment succeeds (sloppy Script).
        assert_eq!(
            rt.realm_execute_script(
                &realm,
                "<t>",
                "__realm_spike_sloppy = 7; typeof __realm_spike_sloppy",
            )
            .unwrap(),
            serde_json::json!("number")
        );
    }

    #[test]
    fn secondary_realm_ops_reach_shared_dom() {
        let mut rt = setup_runtime(
            "<html><head><title>Test Page</title></head><body><div id=\"probe\">hello</div></body></html>",
        );
        let realm = rt.create_secondary_realm().unwrap();
        rt.bootstrap_secondary_realm(&realm).unwrap();
        rt.init_secondary_realm_page(&realm).unwrap();

        assert_eq!(
            rt.realm_execute_script(
                &realm,
                "<t>",
                "[document.title, document.getElementById('probe').textContent]",
            )
            .unwrap(),
            serde_json::json!(["Test Page", "hello"])
        );

        // A mutation performed in the realm is visible from the main context:
        // both realms drive the same native DomTree through op_dom.
        rt.realm_execute_script(
            &realm,
            "<t>",
            "document.getElementById('probe').setAttribute('data-realm', 'second')",
        )
        .unwrap();
        assert_eq!(
            rt.evaluate("document.getElementById('probe').getAttribute('data-realm')")
                .unwrap(),
            serde_json::json!("second")
        );

        // Wrapper identity stays per-realm even though the node is shared.
        rt.realm_expose_main_global(&realm, "__main").unwrap();
        assert_eq!(
            rt.realm_execute_script(
                &realm,
                "<t>",
                "[document !== __main.document, document instanceof Document, !(document instanceof __main.Document)]",
            )
            .unwrap(),
            serde_json::json!([true, true, true])
        );
    }

    #[test]
    fn destroying_secondary_realm_keeps_main_context_alive() {
        let mut rt = setup_runtime("<html><body></body></html>");
        let realm = rt.create_secondary_realm().unwrap();
        rt.bootstrap_secondary_realm(&realm).unwrap();
        rt.realm_execute_script(&realm, "<t>", "var __realm_spike_x = 1;")
            .unwrap();
        rt.destroy_secondary_realm(realm);

        assert_eq!(rt.evaluate("1 + 1").unwrap(), serde_json::json!(2.0));
        assert_eq!(
            rt.evaluate("document.body.tagName").unwrap(),
            serde_json::json!("BODY")
        );

        // A fresh realm starts from a clean global again.
        let second = rt.create_secondary_realm().unwrap();
        assert_eq!(
            rt.realm_execute_script(&second, "<t>", "typeof __realm_spike_x")
                .unwrap(),
            serde_json::json!("undefined")
        );
    }

    // ---- Managed frame realms (Phase 3.7 host layer) ----

    /// Create + parse + scope an iframe content document through the same
    /// op_dom commands the Rust frame loader uses, from the main context.
    /// Returns the content root nid.
    fn setup_frame(
        rt: &mut ObscuraJsRuntime,
        host_id: &str,
        html: &str,
        origin_url: &str,
        generation: u64,
    ) -> u32 {
        let script = format!(
            r#"(() => {{
                const op = (cmd, a1, a2) =>
                    Deno.core.ops.op_dom(cmd, String(a1 ?? ""), String(a2 ?? ""));
                const host = document.getElementById({host_id:?})[Symbol.for('obscura.nid')];
                const created = JSON.parse(op("create_iframe_content_document", host));
                op("parse_into_subtree", created.root, {html:?});
                op("set_document_scope", created.root, JSON.stringify({{
                    url: {origin_url:?},
                    originUrl: {origin_url:?},
                    frameId: "frame-test",
                    documentGeneration: {generation},
                }}));
                return created.root;
            }})()"#
        );
        rt.evaluate(&script).unwrap().as_f64().unwrap() as u32
    }

    const FRAME_HTML: &str = "<html><head><title>Frame Title</title></head>\
        <body><div id=\"inner\">frame text</div></body></html>";

    #[test]
    fn frame_realm_globals_stay_hidden_from_cross_realm_enumeration() {
        let mut rt = setup_runtime("<html><body></body></html>");
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    document.body.appendChild(frame);
                    const win = frame.contentWindow;
                    const internal = n =>
                        n.includes('obscura') || n.startsWith('_') || n === 'Deno';
                    // The normal path (the WindowProxy facade) filters its own keys.
                    const viaProxy = Object.getOwnPropertyNames(win).filter(internal);
                    // A fingerprinting script can reach the frame realm's *real*
                    // global object through eval and enumerate it with the main
                    // realm's Object.getOwnPropertyNames. That filter must also
                    // hide the frame's internals, not just the main global's.
                    const viaRealGlobal = Object.getOwnPropertyNames(win.eval('globalThis'))
                        .filter(internal);
                    return {
                        viaProxy,
                        viaRealGlobal,
                        // The frame is its own realm: the eval'd global is not the page's.
                        distinct: win.eval('globalThis') !== globalThis,
                    };
                })()"#,
            )
            .unwrap(),
            serde_json::json!({
                "viaProxy": [],
                "viaRealGlobal": [],
                "distinct": true,
            })
        );
    }

    #[test]
    fn frame_window_proxy_methods_read_as_native_code() {
        let mut rt = setup_runtime("<html><body></body></html>");
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    document.body.appendChild(frame);
                    const win = frame.contentWindow;
                    const native = name =>
                        /\{\s*\[native code\]\s*\}/
                            .test(Function.prototype.toString.call(win[name]));
                    const nativeInFrame = name =>
                        /\{\s*\[native code\]\s*\}/
                            .test(win.Function.prototype.toString.call(win[name]));
                    const belongsToFrame = name => win[name] instanceof win.Function;
                    const shape = name => {
                        const value = win[name];
                        let constructible = true;
                        try { Reflect.construct(value, []); } catch (_error) { constructible = false; }
                        return [value.name, value.length, 'prototype' in value, constructible];
                    };
                    return {
                        postMessage: native('postMessage'),
                        blur: native('blur'),
                        focus: native('focus'),
                        close: native('close'),
                        frameFunctions: Object.fromEntries(
                            ['postMessage', 'blur', 'focus', 'close']
                                .map(name => [name, belongsToFrame(name)])),
                        frameNative: Object.fromEntries(
                            ['postMessage', 'blur', 'focus', 'close']
                                .map(name => [name, nativeInFrame(name)])),
                        shape: Object.fromEntries(
                            ['postMessage', 'blur', 'focus', 'close']
                                .map(name => [name, shape(name)])),
                    };
                })()"#,
            )
            .unwrap(),
            serde_json::json!({
                "postMessage": true,
                "blur": true,
                "focus": true,
                "close": true,
                "frameFunctions": {
                    "postMessage": true, "blur": true, "focus": true, "close": true,
                },
                "frameNative": {
                    "postMessage": true, "blur": true, "focus": true, "close": true,
                },
                "shape": {
                    "postMessage": ["postMessage", 1, false, false],
                    "blur": ["blur", 0, false, false],
                    "focus": ["focus", 0, false, false],
                    "close": ["close", 0, false, false],
                },
            })
        );
    }

    #[test]
    fn frame_window_proxy_constructor_is_the_frames_window() {
        let mut rt = setup_runtime("<html><body></body></html>");
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    document.body.appendChild(frame);
                    const win = frame.contentWindow;
                    return {
                        // A browser answers the frame's own Window, not the
                        // main realm's Object off the target's prototype chain.
                        isFramesWindow: win.constructor === win.Window,
                        isNotMainObject: win.constructor !== Object,
                        prototypeIsWindow: Object.getPrototypeOf(win) === win.Window.prototype,
                        name: win.constructor.name,
                        own: Object.prototype.hasOwnProperty.call(win, 'constructor'),
                        ownKeys: Object.getOwnPropertyNames(win).includes('constructor'),
                        descriptorMissing:
                            Object.getOwnPropertyDescriptor(win, 'constructor') === undefined,
                    };
                })()"#,
            )
            .unwrap(),
            serde_json::json!({
                "isFramesWindow": true,
                "isNotMainObject": true,
                "prototypeIsWindow": true,
                "name": "Window",
                "own": false,
                "ownKeys": false,
                "descriptorMissing": true,
            })
        );
    }

    #[test]
    fn document_does_not_leak_engine_internals_via_own_property_names() {
        let mut rt = setup_runtime("<html><body></body></html>");
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    // The engine's tree/scope/document slots, which used to be
                    // own string-keyed properties a fingerprint could read with
                    // Object.getOwnPropertyNames(document). Chrome keeps these
                    // on WebIDL prototypes / the C++ backing store.
                    const fields = ['_nid', '_scopeRoot', '_defaultViewProxy',
                        '_treeParent', '_treeParentEpoch', '_ownerDocRoot',
                        '_styleSheetList', '_fonts'];
                    const leaked = obj => {
                        const names = new Set(Object.getOwnPropertyNames(obj));
                        return fields.filter(f => names.has(f));
                    };
                    const frame = document.createElement('iframe');
                    document.body.appendChild(frame);
                    const div = document.createElement('div');
                    return {
                        mainDoc: leaked(document),
                        frameDoc: leaked(frame.contentWindow.eval('document')),
                        element: leaked(div),
                        // Direct access is gone too, not just enumeration.
                        nidGone: document._nid === undefined,
                        scopeRootGone: document._scopeRoot === undefined,
                    };
                })()"#,
            )
            .unwrap(),
            serde_json::json!({
                "mainDoc": [],
                "frameDoc": [],
                "element": [],
                "nidGone": true,
                "scopeRootGone": true,
            })
        );
    }

    #[test]
    fn document_location_is_own_and_lang_dir_reflect_the_root_element() {
        let mut rt = setup_runtime("<html><body></body></html>");
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const before = Object.getOwnPropertyNames(document);
                    document.lang = 'zh-CN';
                    document.dir = 'rtl';
                    const locationDescriptor = Object.getOwnPropertyDescriptor(document, 'location');
                    const langDescriptor = Object.getOwnPropertyDescriptor(document, 'lang');
                    const dirDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'dir');
                    return {
                        before,
                        after: Object.getOwnPropertyNames(document),
                        lang: document.lang,
                        dir: document.dir,
                        rootLang: document.documentElement.getAttribute('lang'),
                        rootDir: document.documentElement.getAttribute('dir'),
                        locationEnumerable: locationDescriptor && locationDescriptor.enumerable,
                        locationConfigurable: locationDescriptor && locationDescriptor.configurable,
                        langEnumerable: langDescriptor && langDescriptor.enumerable,
                        dirEnumerable: dirDescriptor && dirDescriptor.enumerable,
                    };
                })()"#,
            )
            .unwrap(),
            serde_json::json!({
                "before": ["location"],
                "after": ["location", "lang"],
                "lang": "zh-CN",
                "dir": "rtl",
                "rootLang": null,
                "rootDir": "rtl",
                "locationEnumerable": true,
                "locationConfigurable": false,
                "langEnumerable": true,
                "dirEnumerable": true,
            })
        );
    }

    #[test]
    fn frame_realm_document_binds_frame_content_root() {
        let mut rt = setup_runtime(
            "<html><head><title>Test Page</title></head>\
             <body><iframe id=f></iframe><div id=mainonly>main</div></body></html>",
        );
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        assert!(rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame").unwrap());
        rt.frame_realm_expose_main_global("frame-test", 1, "__main").unwrap();

        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"[
                    document.getElementById('inner').textContent,
                    document.getElementById('mainonly') === null,
                    document.title,
                    document.URL,
                    document.documentElement.tagName,
                    document.body.tagName,
                    document instanceof Document,
                    globalThis.document !== __main.document,
                    globalThis !== __main,
                ]"#,
            )
            .unwrap(),
            serde_json::json!([
                "frame text", true, "Frame Title", "http://example.com/frame",
                "HTML", "BODY", true, true, true,
            ])
        );
        // The main context still sees its own document, not the frame's.
        assert_eq!(
            rt.evaluate("[document.getElementById('inner') === null, document.title]")
                .unwrap(),
            serde_json::json!([true, "Test Page"])
        );

        // Registry metadata snapshots the content root's DocumentScope.
        let realm = rt.frame_realm("frame-test", 1).unwrap();
        assert_eq!(realm.content_root, root);
        assert_eq!(realm.base_url, "http://example.com/frame");
        assert_eq!(realm.scope_url.as_deref(), Some("http://example.com/frame"));
        assert_eq!(realm.scope_origin.as_deref(), Some("http://example.com"));
    }

    #[test]
    fn frame_scoped_query_sees_incremental_fragment_insertions() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        let result = rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<fixture>",
            r#"(() => {
                const query = document.querySelectorAll.bind(document);
                const container = document.createElement('null');
                document.body.appendChild(container);
                container.insertAdjacentHTML('beforeend',
                    '<div id="dGSz90" class="hRkTq50"> </div>');
                const first = query('.hRkTq50')[0];
                first.insertAdjacentHTML('beforeend',
                    '<span id="dGSz91" class="hRkTq56"> </span>');
                const second = query('#dGSz91')[0];
                second.insertAdjacentHTML('beforeend',
                    '<div id="dGSz92" class="hRkTq58"> </div>');
                const third = query('#dGSz92')[0];
                return {
                    connected: container.isConnected,
                    tags: [first.tagName, second.tagName, third.tagName],
                    roots: [first.ownerDocument === document,
                        second.ownerDocument === document,
                        third.ownerDocument === document],
                    topHidden: document.getElementById('f') === null,
                };
            })()"#,
        ).unwrap();
        assert_eq!(result, serde_json::json!({
            "connected": true,
            "tags": ["DIV", "SPAN", "DIV"],
            "roots": [true, true, true],
            "topHidden": true,
        }));
    }

    #[test]
    fn frame_document_queries_flow_through_document_prototype() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        let result = rt
            .execute_script_in_frame_realm(
                "frame-test",
                1,
                "<prototype-query>",
                r#"(() => {
                    const descriptor = Object.getOwnPropertyDescriptor(
                        Document.prototype, 'querySelectorAll');
                    const original = descriptor.value;
                    let calls = 0;
                    descriptor.value = function(...args) {
                        calls++;
                        return original.apply(this, args);
                    };
                    Object.defineProperty(Document.prototype, 'querySelectorAll', descriptor);
                    const result = document.querySelectorAll('body').length;
                    descriptor.value = original;
                    Object.defineProperty(Document.prototype, 'querySelectorAll', descriptor);
                    return {
                        result,
                        calls,
                        own: Object.prototype.hasOwnProperty.call(
                            Object.getPrototypeOf(document), 'querySelectorAll'),
                    };
                })()"#,
            )
            .unwrap();
        assert_eq!(result, serde_json::json!({
            "result": 1,
            "calls": 1,
            "own": false,
        }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_permissions_follow_origin_and_iframe_delegation() {
        async fn snapshot(origin: &str, allow: Option<&str>) -> serde_json::Value {
            let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
            if let Some(allow) = allow {
                rt.evaluate(&format!(
                    "document.getElementById('f').setAttribute('allow', {allow:?})"
                ))
                .unwrap();
            }
            let root = setup_frame(&mut rt, "f", FRAME_HTML, origin, 1);
            rt.ensure_frame_realm("frame-test", 1, root, origin).unwrap();
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<permissions>",
                r#"globalThis.__permissionResult = null;
                   Promise.all([
                     navigator.permissions.query({name:'geolocation'}),
                     navigator.permissions.query({name:'notifications'}),
                     navigator.permissions.query({name:'camera'}),
                     navigator.permissions.query({name:'microphone'}),
                     navigator.permissions.query({name:'notifications'}),
                   ]).then(values => {
                     const status = values[1];
                     globalThis.__permissionResult = {
                       states: [Notification.permission, values[0].state, status.state,
                         values[2].state, values[3].state],
                       names: values.slice(0, 4).map(value => value.name),
                       permissionsTag: Object.prototype.toString.call(navigator.permissions),
                       permissionsOwn: Object.getOwnPropertyNames(navigator.permissions),
                       permissionsProto: Object.getOwnPropertyNames(Permissions.prototype),
                       statusTag: Object.prototype.toString.call(status),
                       statusOwn: Object.getOwnPropertyNames(status),
                       statusProto: Object.getOwnPropertyNames(PermissionStatus.prototype),
                       statusConstructor: status.constructor.name,
                       statusStable: status === values[4],
                     };
                   });"#,
            )
            .unwrap();
            for _ in 0..10 {
                rt.run_event_loop_bounded(25).await.unwrap();
                let ready = rt
                    .execute_script_in_frame_realm(
                        "frame-test",
                        1,
                        "<probe>",
                        "globalThis.__permissionResult !== null",
                    )
                    .unwrap();
                if ready == serde_json::json!(true) {
                    break;
                }
            }
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<result>",
                "globalThis.__permissionResult",
            )
            .unwrap()
        }

        let same = snapshot("http://example.com/frame", None).await;
        let cross = snapshot("https://frame.example/embedded", None).await;
        let delegated = snapshot(
            "https://frame.example/embedded",
            Some("geolocation; camera; microphone"),
        )
        .await;

        assert_eq!(same["states"], serde_json::json!([
            "default", "prompt", "prompt", "prompt", "prompt"
        ]));
        assert_eq!(cross["states"], serde_json::json!([
            "denied", "denied", "denied", "denied", "denied"
        ]));
        assert_eq!(delegated["states"], serde_json::json!([
            "denied", "prompt", "denied", "prompt", "prompt"
        ]));
        for result in [&same, &cross, &delegated] {
            assert_eq!(result["names"], serde_json::json!([
                "geolocation", "notifications", "video_capture", "audio_capture"
            ]));
            assert_eq!(result["permissionsTag"], "[object Permissions]");
            assert_eq!(result["permissionsOwn"], serde_json::json!([]));
            assert_eq!(result["permissionsProto"], serde_json::json!(["query", "constructor"]));
            assert_eq!(result["statusTag"], "[object PermissionStatus]");
            assert_eq!(result["statusOwn"], serde_json::json!([]));
            assert_eq!(result["statusProto"], serde_json::json!([
                "name", "state", "onchange", "constructor"
            ]));
            assert_eq!(result["statusConstructor"], "PermissionStatus");
            assert_eq!(result["statusStable"], false);
        }
    }

    #[test]
    fn frame_realm_scripts_share_top_level_bindings() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        assert!(rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame").unwrap());

        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            "var frx = 1; function frf() { return frx + 41; } let frl = 5;",
        )
        .unwrap();
        // ensure is idempotent: the same generation keeps its realm, so the
        // top-level bindings from the first script survive.
        assert!(!rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame").unwrap());
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"[
                    frx, frf(), frl,
                    this === globalThis,
                    globalThis === window,
                    globalThis.frx,
                ]"#,
            )
            .unwrap(),
            serde_json::json!([1, 42, 5, true, true, 1])
        );
        // Nothing leaked into the main context.
        assert_eq!(
            rt.evaluate("[typeof frx, typeof frf, typeof frl]").unwrap(),
            serde_json::json!(["undefined", "undefined", "undefined"])
        );
    }

    #[test]
    fn frame_realm_dynamic_code_binds_realm_global() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        rt.frame_realm_expose_main_global("frame-test", 1, "__main").unwrap();

        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"var frg = 10;
                (0, eval)("var frEvalVar = 7;");
                [
                    (0, eval)("frg + 1"),
                    Function("return frg + 2")(),
                    (function() { var loc = 30; return eval("loc + frg"); })(),
                    Function("return globalThis")() === globalThis,
                    (0, eval)("globalThis") === globalThis,
                    Function("return globalThis")() !== __main,
                    typeof frEvalVar,
                    Function("return typeof document")(),
                ]"#,
            )
            .unwrap(),
            serde_json::json!([11, 12, 40, true, true, true, "number", "object"])
        );
        // Indirect eval declared its var on the frame realm global only.
        assert_eq!(
            rt.evaluate("[typeof frg, typeof frEvalVar]").unwrap(),
            serde_json::json!(["undefined", "undefined"])
        );
    }

    #[test]
    fn frame_realm_generations_destroy_independently() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root1 = setup_frame(
            &mut rt,
            "f",
            "<html><body><p id=one></p></body></html>",
            "http://example.com/first",
            1,
        );
        rt.ensure_frame_realm("frame-test", 1, root1, "http://example.com/first")
            .unwrap();
        rt.execute_script_in_frame_realm("frame-test", 1, "<t>", "var marker = 123;")
            .unwrap();

        // A navigation commits a new content root under a new generation.
        let root2 = setup_frame(
            &mut rt,
            "f",
            "<html><body><p id=two></p></body></html>",
            "http://example.com/second",
            2,
        );
        rt.ensure_frame_realm("frame-test", 2, root2, "http://example.com/second")
            .unwrap();
        assert_eq!(rt.frame_realms.active_count(), 2);
        // The new generation is a fresh realm bound to the new document.
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                2,
                "<t>",
                "[typeof marker, document.getElementById('two') !== null, document.URL]",
            )
            .unwrap(),
            serde_json::json!(["undefined", true, "http://example.com/second"])
        );

        // Destroying the old generation leaves main and the new realm intact.
        assert!(rt.destroy_frame_realm_generation("frame-test", 1));
        assert!(!rt.destroy_frame_realm_generation("frame-test", 1));
        assert_eq!(rt.evaluate("1 + 1").unwrap(), serde_json::json!(2.0));
        assert_eq!(
            rt.evaluate("document.body.tagName").unwrap(),
            serde_json::json!("BODY")
        );
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 2, "<t>", "document.title")
                .unwrap(),
            serde_json::json!("")
        );

        // Destroying the whole frame drops every generation; execution then
        // fails until a realm is recreated, and recreation starts clean.
        assert_eq!(rt.destroy_frame_realm("frame-test"), 1);
        assert_eq!(rt.frame_realms.active_count(), 0);
        assert!(rt
            .execute_script_in_frame_realm("frame-test", 2, "<t>", "1")
            .unwrap_err()
            .contains("no frame realm"));
        assert!(rt.ensure_frame_realm("frame-test", 2, root2, "http://example.com/second").unwrap());
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                2,
                "<t>",
                "[typeof marker, document.getElementById('two') !== null]",
            )
            .unwrap(),
            serde_json::json!(["undefined", true])
        );
        assert_eq!(rt.evaluate("document.body.tagName").unwrap(), serde_json::json!("BODY"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_realm_timer_callback_fires_in_its_realm() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            r#"var __realmTimerRan = false;
               setTimeout(() => {
                   __realmTimerRan = [
                       document.getElementById('inner').textContent,
                       globalThis === window,
                   ];
               }, 0);
               // A string handler compiles in the scheduling realm: the realm
               // bootstrap's own indirect eval runs it against this global.
               setTimeout("var __realmStringTimer = document.title;", 0);"#,
        )
        .unwrap();
        rt.run_event_loop_bounded(200).await.unwrap();

        // The callbacks ran in the frame realm: their document is the frame
        // document and the flags landed on the realm global, not main's.
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "[__realmTimerRan, __realmStringTimer]",
            )
            .unwrap(),
            serde_json::json!([["frame text", true], "Frame Title"])
        );
        assert_eq!(
            rt.evaluate("[typeof globalThis.__realmTimerRan, typeof globalThis.__realmStringTimer]")
                .unwrap(),
            serde_json::json!(["undefined", "undefined"])
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_worker_uses_creator_url_and_frame_global_callbacks() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let frame_url = "http://example.com/frame/path/page.html";
        let root = setup_frame(&mut rt, "f", FRAME_HTML, frame_url, 1);
        rt.ensure_frame_realm("frame-test", 1, root, frame_url)
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            r#"globalThis.frameWorkerResult = null;
               globalThis.frameWorkerFetchUrl = null;
               globalThis.fetch = async function (url) {
                   frameWorkerFetchUrl = String(url);
                   return {
                       ok: true,
                       url: String(url),
                       text: async function () { return "postMessage(location.href)"; },
                   };
               };
               const worker = new Worker('worker.js');
               worker.onmessage = function (event) {
                   frameWorkerResult = event.data;
               };"#,
        )
        .unwrap();

        for _ in 0..100 {
            let _ = rt.run_event_loop_bounded(25).await;
            let done = rt
                .execute_script_in_frame_realm(
                    "frame-test",
                    1,
                    "<probe>",
                    "frameWorkerResult !== null",
                )
                .unwrap();
            if done == serde_json::json!(true) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "[frameWorkerFetchUrl, frameWorkerResult]",
            )
            .unwrap(),
            serde_json::json!([
                "http://example.com/frame/path/worker.js",
                "http://example.com/frame/path/worker.js",
            ]),
        );
        assert_eq!(
            rt.evaluate("[typeof frameWorkerResult, typeof frameWorkerFetchUrl]")
                .unwrap(),
            serde_json::json!(["undefined", "undefined"]),
        );
    }

    /// An `<img>` created inside a frame resolves its relative `src` against
    /// the frame's document, not the embedder's. Chrome's Turnstile flow
    /// fetches a `/ci/` image from inside the widget iframe; resolving that
    /// against the page sent it to the embedding site instead.
    #[tokio::test(flavor = "current_thread")]
    async fn a_frames_image_resolves_against_the_frame_not_the_page() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let frame_url = "https://frame.example/widget/inner.html";
        let root = setup_frame(&mut rt, "f", FRAME_HTML, frame_url, 1);
        rt.ensure_frame_realm("frame-test", 1, root, frame_url)
            .unwrap();

        let resolved = rt
            .execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"(() => {
                     const img = document.createElement('img');
                     img.setAttribute('src', '/ci/token');
                     document.body.appendChild(img);
                     return [img.src, img.baseURI, img.getAttribute('src')];
                   })()"#,
            )
            .unwrap();

        assert_eq!(
            resolved,
            serde_json::json!([
                "https://frame.example/ci/token",
                "https://frame.example/widget/inner.html",
                // The attribute keeps the author's literal value.
                "/ci/token",
            ])
        );
    }

    /// CSSOM geometry for a node inside an iframe must come from that frame's
    /// own layout, not the top-level document's. Reading it from the top-level
    /// `prepared_render` -- which does not contain frame content -- reported
    /// 0x0 for every element in a frame, which is what made a challenge widget
    /// read as invisible and fall into interactive mode.
    #[tokio::test(flavor = "current_thread")]
    async fn frame_elements_report_their_own_document_geometry() {
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html(
            "<html><head><title>p</title></head><body>\
             <iframe id=f style=\"display:block;width:300px;height:65px;border:0\"></iframe>\
             </body></html>",
        ));
        rt.set_url("http://example.com/test");
        rt.set_viewport(400.0, 300.0);
        rt.run_page_init();

        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        let result = rt
            .execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"JSON.stringify((function () {
                     const b = document.body.getBoundingClientRect();
                     const h = document.documentElement.getBoundingClientRect();
                     return [
                       b.width, b.height, h.width, h.height,
                       document.documentElement.clientWidth,
                       document.documentElement.scrollWidth,
                       window.innerWidth, window.innerHeight,
                     ];
                   })())"#,
            )
            .unwrap();

        let values = serde_json::from_str::<Vec<f64>>(result.as_str().unwrap()).unwrap();
        let [body_w, body_h, html_w, _html_h, client_w, scroll_w, inner_w, inner_h] = values[..]
        else {
            panic!("unexpected shape");
        };
        // The frame viewport is the iframe's 300x65 content box. The body's
        // height is its content (an 18px line here), its width the viewport
        // minus the 16px default body margin -- the point is that neither is 0.
        assert!(
            body_w >= 250.0 && body_h > 0.0,
            "frame body was {body_w}x{body_h}, expected it to fill the viewport width"
        );
        assert!(html_w >= 250.0, "frame html width was {html_w}");
        assert!(client_w >= 250.0, "frame clientWidth was {client_w}");
        assert!(scroll_w >= 250.0, "frame scrollWidth was {scroll_w}");
        // window.innerWidth/Height must be the frame viewport, not the OS
        // screen the __obscura_init fallback otherwise derives.
        assert!(
            inner_w >= 250.0 && inner_h >= 50.0,
            "frame innerWidth/Height was {inner_w}x{inner_h}, expected ~300x65"
        );

        // Resizing the host does not recreate the frame realm. Window and
        // VisualViewport metrics must therefore read the live content box,
        // rather than keeping the values captured by __obscura_init.
        rt.execute_script(
            "<resize-host>",
            "document.getElementById('f').setAttribute('style',\
             'display:block;width:180px;height:40px;border:0')",
        )
        .unwrap();
        let resized = rt
            .execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "JSON.stringify([innerWidth,innerHeight,visualViewport.width,visualViewport.height])",
            )
            .unwrap();
        let resized = serde_json::from_str::<Vec<f64>>(resized.as_str().unwrap()).unwrap();
        assert_eq!(resized, vec![180.0, 40.0, 180.0, 40.0]);
    }

    /// A worker's origin comes from the document that constructed it. When
    /// that document is a cross-origin frame, reading the origin off the
    /// top-level page hands the worker the wrong one -- and `self.origin` is
    /// what a worker-hosted payload reads to decide who it is running for.
    #[tokio::test(flavor = "current_thread")]
    async fn frame_worker_inherits_the_frame_origin_not_the_page_origin() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let frame_url = "https://frame.example/embedded/page.html";
        let root = setup_frame(&mut rt, "f", FRAME_HTML, frame_url, 1);
        rt.ensure_frame_realm("frame-test", 1, root, frame_url)
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            r#"globalThis.workerScope = null;
               const source = "postMessage({origin: origin, secure: isSecureContext})";
               const worker = new Worker('data:text/javascript,' + encodeURIComponent(source));
               worker.onmessage = function (event) { workerScope = event.data; };"#,
        )
        .unwrap();

        for _ in 0..100 {
            let _ = rt.run_event_loop_bounded(25).await;
            let done = rt
                .execute_script_in_frame_realm("frame-test", 1, "<probe>", "workerScope !== null")
                .unwrap();
            if done == serde_json::json!(true) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        // The page is http://example.com; the frame is https://frame.example.
        // Taking the origin from the page would also report the frame as an
        // insecure context, which it is not.
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "[workerScope.origin, workerScope.secure]",
            )
            .unwrap(),
            serde_json::json!(["https://frame.example", true]),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_worker_fetch_uses_the_creator_document_csp() {
        use base64::Engine as _;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let requests_thread = std::sync::Arc::clone(&requests);
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        requests_thread.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let mut request = [0u8; 2048];
                        let _ = stream.read(&mut request);
                        let _ = stream.write_all(
                            b"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                        );
                        return;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(_) => return,
                }
            }
        });

        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        rt.set_url("https://top.example/index.html");
        rt.set_content_security_policy(Some("default-src *; connect-src *"));
        let frame_url = "https://frame.example/embedded/page.html";
        let root = setup_frame(&mut rt, "f", FRAME_HTML, frame_url, 1);
        {
            let state_handle = rt.state_handle().clone();
            let mut state = state_handle.borrow_mut();
            let dom = state.dom.as_mut().expect("runtime DOM");
            let mut scope = dom
                .document_scope(obscura_dom::NodeId::new(root))
                .expect("frame scope");
            scope.csp = Some(
                "default-src *; worker-src data:; connect-src 'none'".to_string(),
            );
            dom.set_document_scope(obscura_dom::NodeId::new(root), scope);
        }
        rt.set_http_client(std::sync::Arc::new(
            obscura_net::ObscuraHttpClient::with_full_options(
                std::sync::Arc::new(obscura_net::CookieJar::new()),
                None,
                true,
            ),
        ));
        rt.ensure_frame_realm("frame-test", 1, root, frame_url)
            .unwrap();

        let worker_source = format!(
            "fetch('http://{address}/probe').then(r => postMessage('status:' + r.status)).catch(e => postMessage(e.name))"
        );
        let worker_url = format!(
            "data:text/javascript;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(worker_source.as_bytes())
        );
        let script = format!(
            "globalThis.workerCspResult=null; const worker=new Worker({worker_url:?}); worker.onmessage=e=>workerCspResult=e.data;"
        );
        rt.execute_script_in_frame_realm("frame-test", 1, "<t>", &script)
            .unwrap();
        for _ in 0..120 {
            let _ = rt.run_event_loop_bounded(25).await;
            let done = rt
                .execute_script_in_frame_realm(
                    "frame-test",
                    1,
                    "<probe>",
                    "workerCspResult !== null",
                )
                .unwrap();
            if done == serde_json::json!(true) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "workerCspResult",
            )
            .unwrap(),
            serde_json::json!("AbortError"),
        );
        assert_eq!(
            requests.load(std::sync::atomic::Ordering::Relaxed),
            0,
            "frame worker fetch must be blocked before network I/O",
        );
    }

    // ---- Cross-document postMessage (Phase 4) ----

    #[tokio::test(flavor = "current_thread")]
    async fn parent_and_frame_exchange_messages_with_origin_and_source() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        // Frame side: record the delivery and echo back through e.source.
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            r#"var __got = null;
               window.addEventListener('message', (e) => {
                   __got = {
                       data: e.data,
                       origin: e.origin,
                       sourceIsParent: e.source === window.parent,
                   };
                   e.source.postMessage({ echo: e.data.a + 1 }, '*');
               });"#,
        )
        .unwrap();
        // Same-origin frame: frameElement resolves to the host element.
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "globalThis.frameElement ? globalThis.frameElement.getAttribute('id') : null",
            )
            .unwrap(),
            serde_json::json!("f")
        );

        // Main side: capture origin and assert source identity against the
        // stable contentWindow proxy, then post into the frame.
        rt.evaluate(
            r#"(() => {
                globalThis.__gotMain = null;
                window.addEventListener('message', (e) => {
                    globalThis.__gotMain = {
                        data: e.data,
                        origin: e.origin,
                        sourceIsProxy: e.source === document.getElementById('f').contentWindow,
                    };
                });
                document.getElementById('f').contentWindow.postMessage({ a: 1 }, '*');
                return true;
            })()"#,
        )
        .unwrap();

        rt.run_event_loop_bounded(500).await.unwrap();

        // One ping-pong round: the parent's message reached the frame realm
        // (drain), and the frame's reply reached the main realm (recv pump).
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 1, "<t>", "__got")
                .unwrap(),
            serde_json::json!({
                "data": { "a": 1 },
                "origin": "http://example.com",
                "sourceIsParent": true,
            })
        );
        assert_eq!(
            rt.evaluate("globalThis.__gotMain").unwrap(),
            serde_json::json!({
                "data": { "echo": 2 },
                "origin": "http://example.com",
                "sourceIsProxy": true,
            })
        );
    }

    /// A window may address a message at itself, and HTML delivers it like any
    /// other cross-document message. Scripts use this as a same-realm mailbox
    /// -- post work to yourself, collect it in the one `message` listener that
    /// also serves the frames -- and `window.postMessage` was a no-op stub, so
    /// those posts vanished and the sender waited on a reply it had sent
    /// itself. The frame directions above already worked; only self-delivery
    /// was missing.
    #[tokio::test(flavor = "current_thread")]
    async fn window_post_message_delivers_to_its_own_window() {
        let mut rt = setup_runtime("<html><body></body></html>");
        let queued = rt
            .evaluate(
                r#"(() => {
                globalThis.__got = [];
                window.addEventListener('message', (e) => {
                    globalThis.__got.push([e.data, e.origin, e.source === window,
                        e.isTrusted, Array.isArray(e.ports), e.lastEventId,
                        e.bubbles, e.cancelable, e.composed].join('|'));
                });
                postMessage('star', '*');
                postMessage('matched', 'http://example.com');
                postMessage('mismatched', 'http://other.example');
                return globalThis.__got.length;
            })()"#,
            )
            .unwrap();
        assert_eq!(queued, serde_json::json!(0.0), "delivery must be a task");

        rt.run_event_loop_bounded(500).await.unwrap();

        // The sender's own origin and its own WindowProxy, a trusted event,
        // and every other member at its default. The mismatched targetOrigin
        // is dropped silently rather than delivered or thrown.
        assert_eq!(
            rt.evaluate("globalThis.__got").unwrap(),
            serde_json::json!([
                "star|http://example.com|true|true|true||false|false|false",
                "matched|http://example.com|true|true|true||false|false|false",
            ])
        );
    }

    #[test]
    fn nested_window_proxy_compares_child_origin_with_calling_frame() {
        let mut rt = setup_runtime(
            "<html><body><iframe id=outer></iframe></body></html>",
        );
        let outer_root = setup_frame(
            &mut rt,
            "outer",
            "<html><body><iframe id=child-a></iframe><iframe id=child-b></iframe></body></html>",
            "http://b.example/frame",
            1,
        );

        let roots = rt
            .evaluate(&format!(
                r##"(() => {{
                    const op = (cmd, a1, a2) =>
                        Deno.core.ops.op_dom(cmd, String(a1 ?? ""), String(a2 ?? ""));
                    const make = (selector, url, frameId) => {{
                        const host = +op("query_selector_scoped", {outer_root}, selector);
                        const created = JSON.parse(op("create_iframe_content_document", host));
                        op("parse_into_subtree", created.root, "<html><body>child</body></html>");
                        op("set_document_scope", created.root, JSON.stringify({{
                            url,
                            originUrl: url,
                            frameId,
                            documentGeneration: 1,
                        }}));
                        return created.root;
                    }};
                    return [
                        make("#child-a", "http://example.com/child", "child-a"),
                        make("#child-b", "http://b.example/child", "child-b"),
                    ];
                }})()"##
            ))
            .unwrap();
        assert!(roots.is_array());

        rt.ensure_frame_realm(
            "outer-frame",
            1,
            outer_root,
            "http://b.example/frame",
        )
        .unwrap();
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "outer-frame",
                1,
                "<t>",
                r#"[
                    document.getElementById("child-a").contentDocument === null,
                    document.getElementById("child-b").contentDocument.body.textContent,
                ]"#,
            )
            .unwrap(),
            serde_json::json!([true, "child"]),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_environment_uses_its_url_origin_cookies_and_storage_area() {
        let mut rt = setup_runtime(
            "<html><body><iframe id=f></iframe><iframe id=g></iframe></body></html>",
        );
        let frame_url = "http://frame.example/dir/page.html";
        let f_root = setup_frame(&mut rt, "f", FRAME_HTML, frame_url, 1);
        let g_root = setup_frame(&mut rt, "g", FRAME_HTML, frame_url, 1);
        rt.ensure_frame_realm("frame-f", 1, f_root, frame_url)
            .unwrap();
        rt.ensure_frame_realm("frame-g", 1, g_root, frame_url)
            .unwrap();

        let jar = std::sync::Arc::new(obscura_net::CookieJar::new());
        jar.set_cookie(
            "frame_cookie=inside; Path=/",
            &url::Url::parse(frame_url).unwrap(),
        );
        jar.set_cookie(
            "top_cookie=outside; Path=/",
            &url::Url::parse("http://example.com/test").unwrap(),
        );
        rt.set_cookie_jar(jar);

        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-f",
                1,
                "<t>",
                r#"(() => {
                    localStorage.setItem("shared", "frame-value");
                    sessionStorage.setItem("session-shared", "frame-session");
                    location.href = "next.html";
                    return [
                        location.href,
                        location.origin,
                        document.cookie,
                    ];
                })()"#,
            )
            .unwrap(),
            serde_json::json!([
                "http://frame.example/dir/next.html",
                "http://frame.example",
                "frame_cookie=inside",
            ]),
        );
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-g",
                1,
                "<t>",
                "[localStorage.getItem('shared'), sessionStorage.getItem('session-shared')]",
            )
            .unwrap(),
            serde_json::json!(["frame-value", "frame-session"]),
        );
        assert_eq!(
            rt.evaluate(
                "[localStorage.getItem('shared'), sessionStorage.getItem('session-shared'), document.cookie]"
            )
            .unwrap(),
            serde_json::json!([null, null, "top_cookie=outside"]),
        );

        assert!(rt.take_pending_navigation().is_none());
        assert_eq!(
            rt.take_pending_frame_navigations(),
            vec![(
                f_root,
                "http://frame.example/dir/next.html".to_string(),
                "GET".to_string(),
                String::new(),
            )],
        );

        let (intercept_tx, mut intercept_rx) = tokio::sync::mpsc::unbounded_channel();
        rt.set_intercept_tx(intercept_tx);
        rt.set_intercept_enabled(true);
        let intercepted = tokio::spawn(async move {
            let request = intercept_rx.recv().await.expect("frame fetch intercepted");
            let url = request.url.clone();
            request
                .resolver
                .send(crate::ops::InterceptResolution::Fulfill {
                    status: 200,
                    headers: std::collections::HashMap::new(),
                    body: "frame-response".to_string(),
                })
                .unwrap();
            url
        });
        rt.execute_script_in_frame_realm(
            "frame-g",
            1,
            "<t>",
            "globalThis.__frameFetch = null; fetch('asset.json').then(r => r.text()).then(v => { __frameFetch = v; });",
        )
        .unwrap();
        rt.run_event_loop_bounded(500).await.unwrap();
        assert_eq!(
            intercepted.await.unwrap(),
            "http://frame.example/dir/asset.json"
        );
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-g", 1, "<t>", "__frameFetch")
                .unwrap(),
            serde_json::json!("frame-response"),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn postmessage_target_origin_filtering() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            "var __count = 0; window.addEventListener('message', () => { __count++; });",
        )
        .unwrap();

        // Mismatched explicit origin: silently dropped.
        rt.evaluate(
            "document.getElementById('f').contentWindow.postMessage({x:1}, 'http://other.example')",
        )
        .unwrap();
        rt.run_event_loop_bounded(200).await.unwrap();
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 1, "<t>", "__count")
                .unwrap(),
            serde_json::json!(0.0)
        );

        // '/' resolves to the sender's origin; sender and frame share
        // http://example.com, so it delivers.
        rt.evaluate("document.getElementById('f').contentWindow.postMessage({x:2}, '/')")
            .unwrap();
        // Matching explicit origin delivers too.
        rt.evaluate(
            "document.getElementById('f').contentWindow.postMessage({x:3}, 'http://example.com')",
        )
        .unwrap();
        rt.run_event_loop_bounded(200).await.unwrap();
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 1, "<t>", "__count")
                .unwrap(),
            serde_json::json!(2.0)
        );

        // A targetOrigin that is neither '*', '/', nor a URL throws
        // SyntaxError synchronously (evaluate() maps caught throws to null,
        // so capture the exception in JS).
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    try {
                        document.getElementById('f').contentWindow.postMessage({x:4}, 'not a url');
                        return "no-throw";
                    } catch (e) {
                        return e.name + ":"
                            + (String(e.message).includes("Invalid target origin") ? "msg-ok" : e.message);
                    }
                })()"#,
            )
            .unwrap(),
            serde_json::json!("SyntaxError:msg-ok")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn sandboxed_opaque_frame_matches_star_only_and_reports_null_origin() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        // Opaque origin (sandbox without allow-same-origin, scripts allowed).
        let root = rt
            .evaluate(
                r#"(() => {
                    const op = (cmd, a1, a2) =>
                        Deno.core.ops.op_dom(cmd, String(a1 ?? ""), String(a2 ?? ""));
                    const host = document.getElementById("f")[Symbol.for('obscura.nid')];
                    const created = JSON.parse(op("create_iframe_content_document", host));
                    op("parse_into_subtree", created.root, "<html><body><p>s</p></body></html>");
                    op("set_document_scope", created.root, JSON.stringify({
                        url: "about:srcdoc",
                        origin: { type: "opaque" },
                        sandbox: "allow-scripts",
                        frameId: "frame-test",
                        documentGeneration: 1,
                    }));
                    return created.root;
                })()"#,
            )
            .unwrap()
            .as_f64()
            .unwrap() as u32;
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/test")
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            r#"var __msgs = [];
               window.addEventListener('message', (e) => { __msgs.push(e.data); });
               // Opaque frame reporting toward the parent: origin is "null".
               parent.postMessage({ hello: true }, '*');"#,
        )
        .unwrap();
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"(() => {
                    const names = ['postMessage', 'blur', 'focus', 'close'];
                    return Object.fromEntries(names.map(name => [name, {
                        frameFunction: parent[name] instanceof Function,
                        native: /\{\s*\[native code\]\s*\}/
                            .test(Function.prototype.toString.call(parent[name])),
                    }]));
                })()"#,
            )
            .unwrap(),
            serde_json::json!({
                "postMessage": {"frameFunction": true, "native": true},
                "blur": {"frameFunction": true, "native": true},
                "focus": {"frameFunction": true, "native": true},
                "close": {"frameFunction": true, "native": true},
            }),
        );

        rt.evaluate(
            r#"(() => {
                globalThis.__mainOrigin = null;
                window.addEventListener('message', (e) => { globalThis.__mainOrigin = e.origin; });
                const w = document.getElementById('f').contentWindow;
                w.postMessage({ n: 1 }, '*');                  // delivered
                w.postMessage({ n: 2 }, 'http://example.com'); // opaque only matches '*'
                w.postMessage({ n: 3 }, '/');                  // tuple sender vs opaque target
                return true;
            })()"#,
        )
        .unwrap();
        rt.run_event_loop_bounded(300).await.unwrap();

        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 1, "<t>", "__msgs")
                .unwrap(),
            serde_json::json!([{ "n": 1 }])
        );
        assert_eq!(
            rt.evaluate("globalThis.__mainOrigin").unwrap(),
            serde_json::json!("null")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn messages_for_destroyed_generation_are_dropped() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root1 = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root1, "http://example.com/frame")
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            "var __g1 = 0; window.addEventListener('message', () => { __g1++; });",
        )
        .unwrap();

        // Enqueue toward generation 1, then re-navigate before any pump: the
        // commit path replaces the content root and destroys the old realm
        // (mirroring Page::navigate_frame).
        rt.evaluate("document.getElementById('f').contentWindow.postMessage({stale:1}, '*')")
            .unwrap();
        let root2 = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 2);
        rt.destroy_frame_realm("frame-test");
        rt.ensure_frame_realm("frame-test", 2, root2, "http://example.com/frame")
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            2,
            "<t>",
            "var __g2 = 0; window.addEventListener('message', () => { __g2++; });",
        )
        .unwrap();

        rt.run_event_loop_bounded(200).await.unwrap();

        // The stale message reached neither the new document generation nor
        // anything else; a fresh message to generation 2 still delivers.
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 2, "<t>", "__g2")
                .unwrap(),
            serde_json::json!(0.0)
        );
        rt.evaluate("document.getElementById('f').contentWindow.postMessage({fresh:1}, '*')")
            .unwrap();
        rt.run_event_loop_bounded(200).await.unwrap();
        assert_eq!(
            rt.execute_script_in_frame_realm("frame-test", 2, "<t>", "__g2")
                .unwrap(),
            serde_json::json!(1.0)
        );
        // Main realm unaffected throughout.
        assert_eq!(rt.evaluate("1 + 1").unwrap(), serde_json::json!(2.0));
    }

    #[test]
    fn window_indexed_access_returns_the_frame_window_proxy() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let _root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const w = document.getElementById('f').contentWindow;
                    return [
                        window.length,
                        window[0] === w,
                        window.frames[0] === w,
                        window.frames === window,
                        typeof w.postMessage === 'function',
                    ];
                })()"#,
            )
            .unwrap(),
            serde_json::json!([1, true, true, true, true])
        );
    }

    #[test]
    fn frame_realm_dom_writes_are_visible_to_main_context() {
        // Same-origin frame so the main context may read contentDocument.
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            r#"document.getElementById('inner').setAttribute('data-realm', 'yes');
               const added = document.createElement('span');
               added.id = 'added';
               added.textContent = 'from realm';
               document.body.appendChild(added);"#,
        )
        .unwrap();

        // The shared DomTree carries the mutation to the main context, which
        // observes it through the frame's scoped content document.
        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const cd = document.getElementById('f').contentDocument;
                    return [
                        cd.getElementById('inner').getAttribute('data-realm'),
                        cd.getElementById('added').textContent,
                        document.getElementById('added') === null,
                    ];
                })()"#,
            )
            .unwrap(),
            serde_json::json!(["yes", "from realm", true])
        );
    }

    #[test]
    fn same_origin_window_proxy_targets_the_live_frame_global() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            "var frameMarker = 7; globalThis.frameObject = { realm: 'child' };",
        )
        .unwrap();

        assert_eq!(
            rt.evaluate(
                r#"(() => {
                    const iframe = document.getElementById('f');
                    const child = iframe.contentWindow;
                    child.parentAssigned = 11;
                    child.eval('globalThis.evalAssigned = 13');
                    return [
                        child.frameMarker,
                        child.frameObject.realm,
                        child.parentAssigned,
                        child.evalAssigned,
                        child.Array !== Array,
                        child.document === iframe.contentDocument,
                        Object.getOwnPropertyNames(child).includes('frameMarker'),
                        !Object.getOwnPropertyNames(child).some(name => name.includes('obscura')),
                    ];
                })()"#,
            )
            .unwrap(),
            serde_json::json!([7, "child", 11, 13, true, true, true, true]),
        );
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "[parentAssigned, evalAssigned]",
            )
            .unwrap(),
            serde_json::json!([11, 13]),
        );
    }

    #[test]
    fn same_origin_parent_and_top_forward_live_author_globals() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.evaluate("globalThis.parentMarker = { value: 7 }")
            .unwrap();
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                r#"(() => {
                    parent.childWrite = 11;
                    top.topWrite = 13;
                    return [
                        parent.parentMarker.value,
                        top.parentMarker.value,
                        'parentMarker' in parent,
                        Object.getOwnPropertyNames(parent).includes('parentMarker'),
                        parent === top,
                        parent.window === parent,
                    ];
                })()"#,
            )
            .unwrap(),
            serde_json::json!([7, 7, true, true, true, true]),
        );
        assert_eq!(
            rt.evaluate("[childWrite, topWrite]").unwrap(),
            serde_json::json!([11, 13]),
        );

        rt.execute_script_in_frame_realm(
            "frame-test",
            1,
            "<t>",
            "parent.location.href = '/from-frame'",
        )
        .unwrap();
        assert_eq!(
            rt.take_pending_navigation(),
            Some((
                "http://example.com/from-frame".to_string(),
                "GET".to_string(),
                String::new(),
            )),
        );
    }

    // ---- Isolated worlds (Phase 6.3) ----

    #[test]
    fn isolated_world_has_own_global_but_shares_frame_dom() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        // world 7 is a CDP isolated world over the same content root.
        assert!(rt
            .ensure_isolated_world_realm(
                "frame-test",
                1,
                7,
                "utility",
                root,
                "http://example.com/frame",
            )
            .unwrap());
        // Idempotent per world.
        assert!(!rt
            .ensure_isolated_world_realm(
                "frame-test",
                1,
                7,
                "utility",
                root,
                "http://example.com/frame",
            )
            .unwrap());

        // A utility global set in the isolated world does not leak into the
        // frame main world, yet both worlds resolve the same DOM node.
        rt.execute_script_in_frame_world_realm(
            "frame-test",
            1,
            7,
            "<t>",
            "window.__utility = 'x'; document.getElementById('inner').setAttribute('data-w', 'iso');",
        )
        .unwrap();
        assert_eq!(
            rt.execute_script_in_frame_world_realm(
                "frame-test",
                1,
                7,
                "<t>",
                "[typeof window.__utility, document.getElementById('inner').getAttribute('data-w')]",
            )
            .unwrap(),
            serde_json::json!(["string", "iso"])
        );
        // Frame main world: no __utility, but sees the shared mutation.
        assert_eq!(
            rt.execute_script_in_frame_realm(
                "frame-test",
                1,
                "<t>",
                "[typeof window.__utility, document.getElementById('inner').getAttribute('data-w'), document.getElementById('inner') !== null]",
            )
            .unwrap(),
            serde_json::json!(["undefined", "iso", true])
        );
        // Main context is untouched.
        assert_eq!(
            rt.evaluate("typeof window.__utility").unwrap(),
            serde_json::json!("undefined")
        );

        // Registry reflects both worlds; only the main world is default.
        let mut worlds: Vec<(u64, bool)> = rt
            .list_frame_realms()
            .into_iter()
            .filter(|(id, gen, _, _)| id == "frame-test" && *gen == 1)
            .map(|(_, _, world, is_default)| (world, is_default))
            .collect();
        worlds.sort();
        assert_eq!(worlds, vec![(super::MAIN_WORLD, true), (7, false)]);
    }

    // ---- Frame RemoteObject evaluation (Phase 6.2) ----

    #[tokio::test(flavor = "current_thread")]
    async fn frame_realm_cdp_evaluate_returns_remote_objects() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        // number by value
        let n = rt
            .evaluate_in_frame_realm_for_cdp("frame-test", 1, super::MAIN_WORLD, "40 + 2", true, false, 1000)
            .await
            .unwrap();
        assert_eq!(n.js_type, "number");
        assert_eq!(n.value, Some(serde_json::json!(42.0)));
        assert!(n.object_id.is_none());

        // string, evaluated against the frame document
        let s = rt
            .evaluate_in_frame_realm_for_cdp(
                "frame-test",
                1,
                super::MAIN_WORLD,
                "document.getElementById('inner').textContent",
                true,
                false,
                1000,
            )
            .await
            .unwrap();
        assert_eq!(s.js_type, "string");
        assert_eq!(s.value, Some(serde_json::json!("frame text")));

        // object gets an objectId bound to the realm
        let obj = rt
            .evaluate_in_frame_realm_for_cdp(
                "frame-test",
                1,
                super::MAIN_WORLD,
                "({ a: 1, b: 'x' })",
                false,
                false,
                1000,
            )
            .await
            .unwrap();
        assert_eq!(obj.js_type, "object");
        assert!(obj.object_id.is_some());

        // awaitPromise on a resolved promise returns the value
        let p = rt
            .evaluate_in_frame_realm_for_cdp(
                "frame-test",
                1,
                super::MAIN_WORLD,
                "Promise.resolve(7)",
                true,
                true,
                1000,
            )
            .await
            .unwrap();
        assert_eq!(p.js_type, "number");
        assert_eq!(p.value, Some(serde_json::json!(7.0)));

        // a throw under awaitPromise surfaces as an error (CDP exceptionDetails)
        let err = rt
            .evaluate_in_frame_realm_for_cdp(
                "frame-test",
                1,
                super::MAIN_WORLD,
                "(() => { throw new Error('boom'); })()",
                false,
                true,
                1000,
            )
            .await
            .unwrap_err();
        assert!(err.contains("boom"), "unexpected error: {err}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_realm_call_function_on_and_get_properties() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();

        let obj = rt
            .evaluate_in_frame_realm_for_cdp(
                "frame-test",
                1,
                super::MAIN_WORLD,
                "({ a: 1, b: 'x', c: { nested: true } })",
                false,
                false,
                1000,
            )
            .await
            .unwrap();
        let oid = obj.object_id.clone().unwrap();

        // callFunctionOn with the handle as `this`
        let called = rt
            .call_function_on_in_frame_realm(
                "frame-test",
                1,
                super::MAIN_WORLD,
                "function() { return this.a + 10; }",
                Some(&oid),
                &[],
                true,
                false,
                1000,
            )
            .await
            .unwrap();
        assert_eq!(called.value, Some(serde_json::json!(11.0)));

        // getProperties on the same handle: primitives inline, objects get a
        // child objectId bound to the same world.
        let props = rt.get_properties_in_frame_realm(&oid).unwrap();
        let arr = props.as_array().unwrap();
        let by_name = |name: &str| arr.iter().find(|p| p.get("name").and_then(|v| v.as_str()) == Some(name)).cloned().unwrap();
        assert_eq!(by_name("a").get("value"), Some(&serde_json::json!(1)));
        assert_eq!(by_name("b").get("value"), Some(&serde_json::json!("x")));
        let child = by_name("c");
        let child_oid = child.get("childOid").and_then(|v| v.as_str()).unwrap().to_string();
        // The child handle drills in through the same routing.
        let child_props = rt.get_properties_in_frame_realm(&child_oid).unwrap();
        assert_eq!(
            child_props.as_array().unwrap().iter().find(|p| p.get("name").and_then(|v| v.as_str()) == Some("nested")).and_then(|p| p.get("value")),
            Some(&serde_json::json!(true))
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_realm_object_handles_do_not_cross_worlds_or_frames() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe><iframe id=g></iframe></body></html>");
        let root_a = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/a", 1);
        rt.ensure_frame_realm("frame-a", 1, root_a, "http://example.com/a")
            .unwrap();
        rt.ensure_isolated_world_realm("frame-a", 1, 7, "utility", root_a, "http://example.com/a")
            .unwrap();
        let root_b = setup_frame(&mut rt, "g", FRAME_HTML, "http://example.com/b", 1);
        rt.ensure_frame_realm("frame-b", 1, root_b, "http://example.com/b")
            .unwrap();

        // A handle allocated in frame-a's isolated world 7.
        let iso = rt
            .evaluate_in_frame_realm_for_cdp("frame-a", 1, 7, "({ v: 1 })", false, false, 1000)
            .await
            .unwrap();
        let iso_oid = iso.object_id.clone().unwrap();

        // Using it in the main world of frame-a is rejected (different world).
        let cross_world = rt
            .call_function_on_in_frame_realm(
                "frame-a",
                1,
                super::MAIN_WORLD,
                "function() { return 1; }",
                Some(&iso_oid),
                &[],
                true,
                false,
                1000,
            )
            .await
            .unwrap_err();
        assert!(cross_world.contains("different execution context"), "{cross_world}");

        // Using it as an argument in another frame is rejected too.
        let cross_frame = rt
            .call_function_on_in_frame_realm(
                "frame-b",
                1,
                super::MAIN_WORLD,
                "function(x) { return x; }",
                None,
                &[serde_json::json!({ "objectId": iso_oid })],
                true,
                false,
                1000,
            )
            .await
            .unwrap_err();
        assert!(cross_frame.contains("execution context"), "{cross_frame}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn destroying_generation_invalidates_its_handles_and_worlds() {
        let mut rt = setup_runtime("<html><body><iframe id=f></iframe></body></html>");
        let root = setup_frame(&mut rt, "f", FRAME_HTML, "http://example.com/frame", 1);
        rt.ensure_frame_realm("frame-test", 1, root, "http://example.com/frame")
            .unwrap();
        rt.ensure_isolated_world_realm("frame-test", 1, 7, "utility", root, "http://example.com/frame")
            .unwrap();

        let obj = rt
            .evaluate_in_frame_realm_for_cdp("frame-test", 1, super::MAIN_WORLD, "({ a: 1 })", false, false, 1000)
            .await
            .unwrap();
        let oid = obj.object_id.clone().unwrap();
        assert!(rt.get_properties_in_frame_realm(&oid).is_ok());

        // Destroying the generation drops every world and every handle.
        assert!(rt.destroy_frame_realm_generation("frame-test", 1));
        assert!(rt.frame_realm_world("frame-test", 1, 7).is_none());
        assert!(rt.frame_realm("frame-test", 1).is_none());
        let stale = rt.get_properties_in_frame_realm(&oid).unwrap_err();
        assert!(stale.contains("not a live frame realm handle"), "{stale}");

        // The main context is unaffected.
        assert_eq!(rt.evaluate("1 + 1").unwrap(), serde_json::json!(2.0));
        assert_eq!(
            rt.evaluate("document.body.tagName").unwrap(),
            serde_json::json!("BODY")
        );
    }

    #[test]
    fn pages_without_iframes_allocate_no_realms() {
        let mut rt = setup_runtime("<html><body><p>plain</p></body></html>");
        assert_eq!(rt.frame_realms.active_count(), 0);
        assert!(rt.frame_realm_keys().is_empty());
        assert!(rt.list_frame_realms().is_empty());
        // Main-context CDP evaluation is unaffected.
        assert_eq!(rt.evaluate("2 + 3").unwrap(), serde_json::json!(5.0));
    }
}
