use std::fs;
use std::path::{Path, PathBuf};

const BOOTSTRAP_MARKER: &str = "// @obscura-module ";

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
    let mut source = String::from("(function () {\n");
    let mut module_count = 0;

    for line in manifest.lines() {
        let Some(relative_path) = line.strip_prefix(BOOTSTRAP_MARKER) else {
            continue;
        };
        let relative_path = relative_path.trim();
        assert!(!relative_path.is_empty(), "empty bootstrap module path");
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
