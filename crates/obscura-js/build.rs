use std::fs;
use std::path::{Path, PathBuf};

use deno_core::v8;

const BOOTSTRAP_MARKER: &str = "// @obscura-module ";
const DEFERRED_MARKER: &str = "// @obscura-deferred-surface";

fn load_bootstrap_source(manifest_path: &Path) -> String {
    // Measurement-only assembly (batch 21): with OBSCURA_BOOTSTRAP_TIMING=1
    // the assembler inserts Date.now boundary marks between modules and a
    // rows collector, so a hydrating frame realm reports per-module wall cost
    // through `globalThis.__obscura_btRows`. Production builds never set the
    // env, and cargo:rerun-if-env-changed keeps the snapshot honest.
    let timing = std::env::var("OBSCURA_BOOTSTRAP_TIMING").as_deref() == Ok("1");
    println!("cargo:rerun-if-env-changed=OBSCURA_BOOTSTRAP_TIMING");

    let manifest = fs::read_to_string(manifest_path).unwrap_or_else(|error| {
        panic!(
            "failed to read bootstrap manifest {}: {error}",
            manifest_path.display()
        )
    });
    let source_root = manifest_path
        .parent()
        .expect("bootstrap manifest directory")
        .join("bootstrap");
    // Keep the generated bootstrap as one classic lexical scope. The wrapper
    // belongs to the assembler rather than any module, so every source file is
    // independently parseable while shared private bindings remain shared in
    // the snapshot and in secondary realms.
    //
    // Modules below the @obscura-deferred-surface marker are wrapped in
    // __obscura_run_deferred_surface (Step 312). A frame realm created with
    // __obscura_frame_defers_surface skips the call and receives a hydrate
    // function instead; the main context and every non-deferring realm run it
    // inline exactly as before. The wrapper keeps one lexical scope for the
    // deferred half, so cross-module bindings inside it are unchanged, and
    // prefix code that was pulled above the marker still sees bindings from
    // the core half through the outer scope.
    let mut source = String::from("(function () {\n");
    // The assembler's first module opens with "use strict"; keeping it as the
    // first statement of this function body is load-bearing: it is what makes
    // the whole assembled bootstrap strict. Anything emitted before it (the
    // engine-namespace capture below) has to come after the directive.
    source.push_str("\"use strict\";\n");
    // deno_core installs the engine namespace as a `Deno` data property on the
    // realm global before this script runs, and every module below reaches the
    // op table through it. Real Chrome has no such global, and `'Deno' in
    // window` / `typeof Deno` are exactly the probes the challenge payload
    // answers for a browser with false/undefined. So the namespace is captured
    // into this lexical binding -- which shadows the global for all 145
    // internal uses -- and the embedder deletes the global again once its own
    // boot work is done (runtime.rs, realm.rs). Nothing page-visible remains.
    //
    // The symbol-keyed hook re-points a realm's binding at the live runtime
    // namespace. Frame realms restored from the snapshot template captured a
    // context-local placeholder (the serializer rejects cross-context object
    // graphs); realm.rs calls the hook with the live object right after
    // restore, before any of the realm's script runs, and deletes it again.
    // Only the template keeps it: build.rs flags that context before this
    // bootstrap runs there, and every realm that executes the bootstrap with
    // the live namespace in reach (main, fresh frame, worker) removes the
    // hook below, so no page-reachable callable can touch the binding. A
    // symbol key never answers `in`, Object.keys, for-in or
    // getOwnPropertyNames, so the wiring adds no string-keyed surface.
    source.push_str(
        "var Deno = globalThis.Deno;\n\
         globalThis[Symbol.for('obscura.internalNamespace')] = function (ns) {\n\
         \x20 if (ns && typeof ns === 'object') { Deno = ns; }\n\
         };\n\
         if (globalThis.__obscura_frame_template_boot !== true) {\n\
         \x20 delete globalThis[Symbol.for('obscura.internalNamespace')];\n\
         }\n",
    );
    if timing {
        source.push_str(
            "var __obscura_btLast = Date.now();\n\
             globalThis.__obscura_btRows = [];\n\
             function __obscura_btMark(name) {\n\
             \x20 var _n = Date.now();\n\
             \x20 globalThis.__obscura_btRows.push(name, _n - __obscura_btLast);\n\
             \x20 __obscura_btLast = _n;\n\
             }\n",
        );
    }
    let mut module_count = 0;
    let mut deferred_open = false;
    // The console module is core-surface: every realm (main, pre-hydration
    // frame, worker) must install it during the core boot, so its module has
    // to stay above the @obscura-deferred-surface marker. If it slips below,
    // frame realms boot without an op-routed console and the challenge's
    // pre-hydration probe goes blind (Step 316); fail the build instead.
    let mut console_module_seen = false;

    for line in manifest.lines() {
        let trimmed = line.trim();
        if trimmed == DEFERRED_MARKER {
            assert!(!deferred_open, "bootstrap manifest has two deferred markers");
            assert!(module_count > 0, "deferred marker before any core module");
            assert!(
                console_module_seen,
                "tools/console.js must be listed above the deferred-surface marker"
            );
            source.push_str("var __obscura_run_deferred_surface = function () {\n");
            deferred_open = true;
            continue;
        }
        let Some(relative_path) = trimmed.strip_prefix(BOOTSTRAP_MARKER) else {
            continue;
        };
        let relative_path = relative_path.trim();
        assert!(!relative_path.is_empty(), "empty bootstrap module path");
        if relative_path == "tools/console.js" {
            console_module_seen = true;
        }
        let module_path = source_root.join(relative_path);
        println!("cargo:rerun-if-changed={}", module_path.display());
        let module = fs::read_to_string(&module_path).unwrap_or_else(|error| {
            panic!(
                "failed to read bootstrap module {}: {error}",
                module_path.display()
            )
        });
        if timing {
            source.push_str(&format!(
                "try {{ __obscura_btMark(\"{relative_path}\"); }} catch (_e) {{}}\n"
            ));
        }
        source.push_str(&module);
        module_count += 1;
    }

    assert!(module_count > 0, "bootstrap manifest has no modules");
    if timing {
        source.push_str("try { __obscura_btMark(\"<end>\"); } catch (_e) {}\n");
    }
    if deferred_open {
        // Boundary marks around the hydration tail so the fingerprint
        // applicator and the full page init show up as their own rows
        // (measurement builds only; production tail is byte-identical).
        let fp_apply = if timing {
            "\x20   try { __obscura_btMark(\"<fp_apply>\"); } catch (_e) {}\n"
        } else {
            ""
        };
        let init_mark = if timing {
            "\x20   try { __obscura_btMark(\"<init>\"); } catch (_e) {}\n"
        } else {
            ""
        };
        let done_mark = if timing {
            "\x20   try { __obscura_btMark(\"<done>\"); } catch (_e) {}\n"
        } else {
            ""
        };
        source.push_str(&format!(
            "\n}};\n\
             if (!globalThis.__obscura_frame_defers_surface) {{\n\
             \x20 __obscura_run_deferred_surface();\n\
             }} else {{\n\
             \x20 globalThis.__obscura_hydrate = function () {{\n\
             \x20   delete globalThis.__obscura_hydrate;\n\
             \x20   delete globalThis.__obscura_frame_defers_surface;\n\
             \x20   __obscura_run_deferred_surface();\n\
             \x20   __obscura_run_deferred_surface = null;\n\
             \x20   // The fingerprint was stored by tools/script-loader's setter at\n\
             \x20   // realm creation; the deferred fingerprint modules define the\n\
             \x20   // applicator, so catch up now, then run the full page init.\n\
             {fp_apply}\
             \x20   try {{ globalThis.__obscura_apply_fingerprint && globalThis.__obscura_apply_fingerprint(); }} catch (_e) {{}}\n\
             {init_mark}\
             \x20   try {{ globalThis.__obscura_init(); }} finally {{ delete globalThis.__obscura_init; }}\n\
             {done_mark}\
             \x20 }};\n\
             }}\n"
        ));
    }
    source.push_str("\n})();\n");
    source
}

/// Execute `bootstrap` (the assembled bootstrap source) in a fresh context of
/// the snapshot runtime's isolate with no defer flag set, so the full window
/// surface installs inline, then fit the context with the hydration stub the
/// frame realm paths expect. Runs inside `with_runtime_cb`; the returned
/// context is serialized as snapshot restore index 0 (batch 21).
///
/// Placeholder frame identity is set before the bootstrap because
/// `config/surface-finalize.js` keys its frame-shaped window enumerability on
/// `__obscura_frame_document_nid`; the real identity overwrites these before
/// any script can run in a restored realm.
fn build_frame_template_context(
    runtime: &mut deno_core::JsRuntime,
    bootstrap: &str,
) -> v8::Global<v8::Context> {
    let scope = &mut runtime.handle_scope();
    let context = v8::Context::new(scope, v8::ContextOptions::default());
    {
        let scope = &mut v8::ContextScope::new(scope, context);
        // The bootstrap's core half resolves `Deno` at top level: the native
        // function registry and the event-state registry ride on it
        // (`Deno[sym] || (Deno[sym] = {...})`). The template cannot reference
        // the main context's Deno object (the V8 context serializer rejects
        // cross-context object graphs), so it gets a fresh context-local
        // binding and both registries attach to it. The bootstrap's first
        // statement captures this placeholder into its lexical `Deno` binding
        // and drops the global again, so a restored realm starts without a
        // page-visible `Deno`; realm.rs then calls the bootstrap's
        // `Symbol.for('obscura.internalNamespace')` hook with the live
        // runtime's namespace before any of the realm's script runs. The
        // restored bootstrap functions keep resolving the registries through
        // their own lexical scope, which is the per-realm registry shape the
        // deferred frame realms already have.
        run_template_script(scope, "globalThis.Deno = {};");
        // Keep the namespace re-pointing hook alive in this context only (see
        // the assembler prologue); realm.rs deletes it after using it.
        run_template_script(scope, "globalThis.__obscura_frame_template_boot = true;");
        let global = context.global(scope);
        let nid_key = v8::String::new(scope, "__obscura_frame_document_nid")
            .expect("template global key");
        let nid_val = v8::Number::new(scope, 1.0);
        global.set(scope, nid_key.into(), nid_val.into());
        let url_key = v8::String::new(scope, "__obscura_frame_base_url")
            .expect("template global key");
        let url_val = v8::String::new(scope, "about:blank").expect("template base url");
        global.set(scope, url_key.into(), url_val.into());
        let fid_key =
            v8::String::new(scope, "__obscura_frame_id").expect("template global key");
        let fid_val = v8::String::new(scope, "").expect("template frame id");
        global.set(scope, fid_key.into(), fid_val.into());
        let gen_key = v8::String::new(scope, "__obscura_frame_generation")
            .expect("template global key");
        let gen_val = v8::Number::new(scope, 0.0);
        global.set(scope, gen_key.into(), gen_val.into());
        // __obscura_frame_defers_surface is intentionally NOT set: the tail
        // runs the surface half inline so the snapshot bakes it.
        run_template_script(scope, bootstrap);
        // Same hydration tail the deferred-surface assembler installs for
        // defer realms, minus the surface run (already baked): catch up the
        // fingerprint applicator and run the full page init at first touch.
        run_template_script(
            scope,
            "globalThis.__obscura_hydrate = function () {\n\
             \x20 delete globalThis.__obscura_hydrate;\n\
             \x20 delete globalThis.__obscura_frame_defers_surface;\n\
             \x20 try { globalThis.__obscura_apply_fingerprint && globalThis.__obscura_apply_fingerprint(); } catch (_e) {}\n\
             \x20 try { globalThis.__obscura_init(); } finally { delete globalThis.__obscura_init; }\n\
             };\n\
             Object.defineProperty(globalThis, '__obscura_frame_snapshot_surface', {\n\
             \x20 value: true, writable: false, enumerable: false, configurable: false });",
        );
        context.set_allow_generation_from_strings(false);
    }
    v8::Global::new(scope, context)
}

fn run_template_script(scope: &mut v8::ContextScope<v8::HandleScope>, source_text: &str) {
    let scope = &mut v8::TryCatch::new(scope);
    let source =
        v8::String::new(scope, source_text).expect("frame surface template source");
    let name = v8::String::new(scope, "<obscura:frame-template-bootstrap>")
        .expect("frame surface template name");
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
    let Some(script) = v8::Script::compile(scope, source, Some(&origin)) else {
        panic!(
            "frame surface template script failed to compile: {}",
            template_error(scope)
        );
    };
    if script.run(scope).is_none() {
        panic!(
            "frame surface template script failed to run: {}",
            template_error(scope)
        );
    }
}

fn template_error(scope: &mut v8::TryCatch<v8::HandleScope>) -> String {
    if scope.is_execution_terminating() {
        scope.cancel_terminate_execution();
        return "JS error: execution terminated".to_string();
    }
    match scope.exception() {
        Some(exception) => {
            let msg = exception.to_rust_string_lossy(scope);
            format!("JS error: {msg}")
        }
        None => "JS error: script failed without an exception".to_string(),
    }
}

fn main() {
    // Keep the generated snapshot coupled to bootstrap/op contract changes.
    println!("cargo:rerun-if-changed=js/bootstrap.js");
    println!("cargo:rerun-if-changed=build.rs");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let snapshot_path = out_dir.join("OBSCURA_SNAPSHOT.bin");
    let bootstrap_path = out_dir.join("bootstrap.js");

    let bootstrap_js = load_bootstrap_source(Path::new("js/bootstrap.js"));
    fs::write(&bootstrap_path, &bootstrap_js).unwrap_or_else(|error| {
        panic!(
            "failed to write generated bootstrap {}: {error}",
            bootstrap_path.display()
        )
    });
    println!(
        "cargo:rustc-env=OBSCURA_BOOTSTRAP_PATH={}",
        bootstrap_path.display()
    );

    // Frame surface template (batch 21): a second context serialized into the
    // same snapshot blob whose full window surface (core half and deferred
    // half) has already executed inline. Frame realms restore a fresh copy
    // with v8::Context::from_snapshot instead of re-executing the 1.7 MB
    // surface half at hydration; the per-realm delta (frame identity,
    // fingerprint seed, core init, and the page init at hydration) runs
    // exactly as before, so a frame realm that is never touched still never
    // pays. The main realm context serializes after the template and lands
    // at restore index 1, which deno_core's restore path prefers.
    let template_js = bootstrap_js.clone();
    let output = deno_core::snapshot::create_snapshot(
        deno_core::snapshot::CreateSnapshotOptions {
            cargo_manifest_dir: env!("CARGO_MANIFEST_DIR"),
            startup_snapshot: None,
            skip_op_registration: true,
            extensions: vec![],
            extension_transpiler: None,
            with_runtime_cb: Some(Box::new(move |runtime| {
                runtime
                    .execute_script("<obscura:bootstrap>", bootstrap_js.to_string())
                    .expect("bootstrap.js should not fail during snapshot creation");
                let template = build_frame_template_context(runtime, &template_js);
                runtime.add_extra_snapshot_context(template);
            })),
        },
        None,
    )
    .expect("Failed to create V8 snapshot");

    std::fs::write(&snapshot_path, &*output.output).expect("Failed to write snapshot");
    println!(
        "cargo:rustc-env=OBSCURA_SNAPSHOT_PATH={}",
        snapshot_path.display()
    );

    for file in &output.files_loaded_during_snapshot {
        println!("cargo:rerun-if-changed={}", file.display());
    }
}
