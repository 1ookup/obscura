use std::fs;
use std::path::{Path, PathBuf};

const BOOTSTRAP_MARKER: &str = "// @obscura-module ";
const DEFERRED_MARKER: &str = "// @obscura-deferred-surface";

fn load_bootstrap_source(manifest_path: &Path) -> String {
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
        source.push_str(&module);
        module_count += 1;
    }

    assert!(module_count > 0, "bootstrap manifest has no modules");
    if deferred_open {
        source.push_str(
            "\n};\n\
             if (!globalThis.__obscura_frame_defers_surface) {\n\
             \x20 __obscura_run_deferred_surface();\n\
             } else {\n\
             \x20 globalThis.__obscura_hydrate = function () {\n\
             \x20   delete globalThis.__obscura_hydrate;\n\
             \x20   delete globalThis.__obscura_frame_defers_surface;\n\
             \x20   __obscura_run_deferred_surface();\n\
             \x20   __obscura_run_deferred_surface = null;\n\
             \x20   // The fingerprint was stored by tools/script-loader's setter at\n\
             \x20   // realm creation; the deferred fingerprint modules define the\n\
             \x20   // applicator, so catch up now, then run the full page init.\n\
             \x20   try { globalThis.__obscura_apply_fingerprint && globalThis.__obscura_apply_fingerprint(); } catch (_e) {}\n\
             \x20   try { globalThis.__obscura_init(); } finally { delete globalThis.__obscura_init; }\n\
             \x20 };\n\
             }\n",
        );
    }
    source.push_str("\n})();\n");
    source
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
