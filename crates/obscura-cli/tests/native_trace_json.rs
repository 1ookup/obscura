//! The JSONL trace contract: one record per API access or call, shaped
//! {t, from, src, name, args, result}, filtered by name.
//!
//! These tests need the pinned source-built V8 (`--config
//! vendor/v8-source.toml`, as in the sibling native_trace.rs). A stock prebuilt
//! V8 has no probe bytecodes and every assertion here would fail, which is the
//! same way the TSV fixture behaves.

use std::path::Path;
use std::process::{Command, Output};

fn directory() -> std::path::PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let path = std::env::temp_dir().join(format!(
        "obscura-native-trace-json-{}-{unique}", std::process::id()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}

fn run(script: &str, trace: &Path, filter: &str, calls: bool, exact: bool) -> Output {
    // Keep the URL on one line so it is also a usable source field.
    let source: String = script.lines().map(str::trim).collect();
    let url = format!("data:text/html,<script>{source}</script>");
    let mut command = Command::new(env!("CARGO_BIN_EXE_obscura"));
    for name in [
        "OBSCURA_TRACE_API_FILE", "OBSCURA_TRACE_OP_FILE", "OBSCURA_V8_FLAGS",
        "OBSCURA_TRACE_API_FORMAT", "OBSCURA_TRACE_API_FILTER",
        "OBSCURA_TRACE_API_CALLS", "OBSCURA_TRACE_API_KEYED",
    ] {
        command.env_remove(name);
    }
    command.arg("--trace-api-file").arg(trace);
    command.arg("--trace-api-format").arg("jsonl");
    command.arg("--trace-api-filter").arg(filter);
    if exact {
        command.env("OBSCURA_TRACE_API_FILTER_EXACT", "1");
    }
    if calls {
        command.arg("--trace-api-calls");
    }
    command.args([
        "fetch", &url, "--wait", "0", "--timeout", "15", "--quiet",
    ]).output().expect("run trace fixture")
}

fn records(trace: &str) -> Vec<serde_json::Value> {
    trace
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|error| panic!("not a JSON record: {error}: {line}"))
        })
        .collect()
}

fn find<'a>(
    records: &'a [serde_json::Value],
    name_suffix: &str,
    operation: &str,
) -> Option<&'a serde_json::Value> {
    records.iter().find(|record| {
        record["name"].as_str().is_some_and(|name| name.ends_with(name_suffix))
            && record["src"].as_str().is_some_and(|src| src.starts_with(operation))
    })
}

#[test]
fn json_records_carry_time_source_name_arguments_and_result() {
    let directory = directory();
    let path = directory.join("api trace.jsonl");
    let script = r#"
      (()=>{
        document.title='obscura-trace-set';
        document.body.setAttribute('data-trace','1');
        globalThis.traceResult=navigator.userAgent.length;
      })();
    "#;
    let output = run(script, &path, "userAgent,setAttribute,title", true, false);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let trace = std::fs::read_to_string(&path).expect("trace file");
    let records = records(&trace);
    assert!(!records.is_empty(), "no records written");

    // Every record has exactly the documented field set, `from` names the
    // execution source, and the clock never runs backwards.
    let mut previous = f64::NEG_INFINITY;
    for record in &records {
        let object = record.as_object().expect("record is an object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["args", "from", "name", "result", "src", "t"], "record {record}");
        assert!(
            record["from"].as_str().is_some_and(|from| !from.is_empty()),
            "from is a non-empty label: {record}"
        );
        let t = record["t"].as_f64().expect("numeric t");
        assert!(t >= previous, "clock went backwards: {t} after {previous}");
        previous = t;
        assert!(record["args"].is_array(), "args is an array: {record}");
        assert!(!record["name"].as_str().unwrap().is_empty(), "{record}");
        let src = record["src"].as_str().unwrap();
        assert!(src.contains(" <- "), "src has both sides: {record}");
        assert!(src.contains(":"), "src has a position: {record}");
    }

    // A read carries the value the page received.
    let read = find(&records, ".userAgent", "get ").expect("userAgent read");
    assert!(
        read["result"].as_str().is_some_and(|value| !value.is_empty()),
        "userAgent result is a string: {read}"
    );

    // A write carries the assigned value.
    let write = find(&records, ".title", "set ").expect("title write");
    assert_eq!(write["args"][0], "obscura-trace-set", "written value: {write}");

    // A call carries its arguments and its return value in one record.
    let call = find(&records, ".setAttribute", "call ").expect("setAttribute call");
    assert_eq!(call["args"][0], "data-trace", "call argument: {call}");
    assert_eq!(call["args"][1], "1", "call argument: {call}");
    assert_eq!(call["result"], "undefined", "call result: {call}");

    // The filter is what keeps a challenge run affordable, so an access that
    // does not match it must not appear at all.
    for record in &records {
        let name = record["name"].as_str().unwrap();
        assert!(
            ["userAgent", "setAttribute", "title"]
                .iter()
                .any(|entry| name.contains(entry)),
            "record outside the filter: {record}"
        );
    }
}

#[test]
fn json_filter_excludes_non_matching_members_and_keeps_the_rest() {
    let directory = directory();
    let path = directory.join("filtered.jsonl");
    let script = r#"
      (()=>{
        const probe={userAgent:'x',noiseOne:1,noiseTwo:2};
        void probe.userAgent; void probe.noiseOne; void probe.noiseTwo;
        void navigator.userAgent;
      })();
    "#;
    let output = run(script, &path, "userAgent", false, false);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let trace = std::fs::read_to_string(&path).expect("trace file");
    let records = records(&trace);
    assert!(!records.is_empty(), "filtered trace is empty");
    for record in &records {
        let name = record["name"].as_str().unwrap();
        assert!(name.contains("userAgent"), "leaked record: {record}");
    }
}

#[test]
fn exact_filter_does_not_match_unrelated_objects_with_the_same_member() {
    let directory = directory();
    let path = directory.join("exact.jsonl");
    let output = run(
        "(()=>{ const probe={userAgent:'x'}; void probe.userAgent; void navigator.userAgent; })();",
        &path,
        "Navigator.userAgent",
        false,
        true,
    );
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let records = records(&std::fs::read_to_string(&path).expect("exact trace file"));
    assert!(!records.is_empty(), "exact trace is empty");
    assert!(records.iter().all(|record| record["name"] == "Navigator.userAgent"));
}
