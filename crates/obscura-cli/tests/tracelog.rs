// window.external.tracelog coverage. The instrumented Chrome build this engine
// is diffed against exposes that method to page code, so a patched challenge
// script has to reach it from every realm it runs in: the main document, a
// frame, a worker isolate, and host-injected eval. The record shape is the
// reference's one-line-per-call JSONL (`{"t","k","v"}`); see docs/native-trace.md.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn serve(routes: &[(&str, &str)]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let addr = listener.local_addr().unwrap();
    let routes: Vec<(String, String)> = routes
        .iter()
        .map(|(path, body)| (path.to_string(), body.to_string()))
        .collect();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let mut request = [0u8; 8192];
            let read = stream.read(&mut request).unwrap_or(0);
            let text = String::from_utf8_lossy(&request[..read]).to_string();
            let path = text
                .split_whitespace()
                .nth(1)
                .unwrap_or("/")
                .split('?')
                .next()
                .unwrap_or("/")
                .to_string();
            let body = routes
                .iter()
                .find(|(route, _)| *route == path)
                .map(|(_, body)| body.clone())
                .unwrap_or_else(|| format!("not found: {path}"));
            let status = if routes.iter().any(|(route, _)| *route == path) {
                "200 OK"
            } else {
                "404 Not Found"
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/html\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    format!("http://{addr}")
}

fn directory() -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "obscura-tracelog-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}

const PAGE: &str = r#"
<!doctype html>
<html><body>
<iframe src="/frame.html"></iframe>
<script>
  const report = {};
  window.external.tracelog('page.string', 'hello');
  window.external.tracelog('page.object', {a: 1, b: [2, 3], s: 'q"uo\nte'});
  window.external.tracelog('page.undefined', undefined);
  window.external.tracelog('page.fn', function () {});
  window.external.tracelog('weird\nkey', 1);
  window.external.tracelog('page.noargs');
  // A Symbol key is a WebIDL TypeError, not a silent string conversion.
  try { window.external.tracelog(Symbol('k'), 1); report.symbolKey = 'no-throw'; }
  catch (error) { report.symbolKey = error.name; }
  report.surface = [Object.getOwnPropertyNames(External.prototype),
    Object.prototype.hasOwnProperty.call(external, 'tracelog'),
    Object.getOwnPropertyDescriptor(External.prototype, 'tracelog').enumerable,
    external.tracelog.length, external.tracelog.name,
    Function.prototype.toString.call(external.tracelog)];
  window.external.tracelog('page.surface', report);
  // Eval'd page code shares the realm's global, so the challenge scripts that
  // compile their VM through eval and new Function reach the same method.
  eval("window.external.tracelog('page.eval', {via: 'eval'})");
  new Function("window.external.tracelog('page.function', {via: 'new Function'})")();
  new Worker('/worker.js').postMessage('go');
</script>
</body></html>
"#;

const FRAME: &str = r#"
<!doctype html>
<html><body>
<script>
  window.external.tracelog('frame.surface', {
    tracelog: typeof window.external.tracelog,
    keys: Object.getOwnPropertyNames(External.prototype),
  });
</script>
</body></html>
"#;

const WORKER: &str = r#"
// The worker scope keeps `window` deleted (Chrome deletes it there) and still
// exposes the tracing primitive, which is what makes worker-side records
// possible at all.
external.tracelog('worker.scope', {
  windowType: typeof window,
  documentType: typeof document,
  externalType: typeof external,
  tracelogType: typeof (external && external.tracelog),
});
onmessage = function () {
  external.tracelog('worker.message', 'go');
};
"#;

fn run(origin: &str, trace: &Path, label_records: bool) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_obscura"));
    command
        .env_remove("OBSCURA_TRACE_API_FILE")
        .env_remove("OBSCURA_TRACE_OP_FILE")
        .env_remove("OBSCURA_TRACELOG_FILE")
        .env_remove("OBSCURA_TRACELOG_FROM")
        .arg("--tracelog-file")
        .arg(trace);
    if label_records {
        command.env("OBSCURA_TRACELOG_FROM", "1");
    }
    command
        .args([
            "fetch",
            &format!("{origin}/page.html"),
            "--allow-private-network",
            "--wait",
            "2",
            "--timeout",
            "25",
            "--quiet",
            "--eval",
            "window.external.tracelog('host.eval', {via: 'page-evaluate'})",
        ])
        .output()
        .expect("run tracelog fixture")
}

/// Every line of the file, parsed. Panics on a line that is not a record, which
/// is how a key or value that broke the line structure shows up.
fn records(trace: &Path) -> Vec<serde_json::Value> {
    let text = std::fs::read_to_string(trace).expect("tracelog file");
    assert!(text.ends_with('\n'), "last record is not line terminated");
    text.lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|e| panic!("{line}: {e}")))
        .collect()
}

fn lines(trace: &Path) -> Vec<String> {
    std::fs::read_to_string(trace)
        .expect("tracelog file")
        .lines()
        .map(str::to_string)
        .collect()
}

fn value_of<'a>(records: &'a [serde_json::Value], key: &str) -> &'a serde_json::Value {
    records
        .iter()
        .find(|record| record["k"] == key)
        .map(|record| &record["v"])
        .unwrap_or_else(|| panic!("no record for key {key:?}"))
}

fn keys(records: &[serde_json::Value]) -> Vec<String> {
    records
        .iter()
        .map(|record| record["k"].as_str().expect("key is a string").to_string())
        .collect()
}

#[test]
fn tracelog_reaches_every_realm_and_writes_the_reference_shape() {
    let directory = directory();
    let trace = directory.join("trace.jsonl");
    let origin = serve(&[
        ("/page.html", PAGE),
        ("/frame.html", FRAME),
        ("/worker.js", WORKER),
    ]);

    let output = run(&origin, &trace, false);
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let records = records(&trace);
    let keys = keys(&records);

    // The main document, a frame, a worker isolate, eval'd page code and host
    // eval all wrote.
    for key in [
        "page.string",
        "page.surface",
        "page.eval",
        "page.function",
        "frame.surface",
        "worker.scope",
        "host.eval",
    ] {
        assert!(keys.iter().any(|k| k == key), "missing {key}: {keys:?}");
    }
    assert!(
        keys.iter().any(|k| k == "weird\nkey"),
        "a key with a line break in it must survive escaping: {keys:?}"
    );

    // Reference shape: three fields, `t` then `k` then `v`, and nothing else.
    // Field order is asserted on the raw line, not through the parsed map,
    // whose iteration order is the JSON backend's business.
    for (line, record) in lines(&trace).iter().zip(&records) {
        assert!(line.starts_with("{\"t\":"), "{line}");
        let key_at = line.find(",\"k\":\"").unwrap_or_else(|| panic!("{line}"));
        let value_at = line.find("\",\"v\":").unwrap_or_else(|| panic!("{line}"));
        assert!(key_at < value_at, "{line}");
        assert_eq!(record.as_object().unwrap().len(), 3, "{record}");
        assert!(record["t"].as_u64().is_some_and(|t| t > 0), "{record}");
    }
    // One monotonic stamp per call, never going backwards.
    let stamps: Vec<u64> = records.iter().map(|record| record["t"].as_u64().unwrap()).collect();
    assert!(stamps.windows(2).all(|pair| pair[0] <= pair[1]), "{stamps:?}");

    // Values are the caller's, serialized the way JSON.stringify does it.
    assert_eq!(
        value_of(&records, "page.object"),
        &serde_json::json!({"a": 1, "b": [2, 3], "s": "q\"uo\nte"})
    );
    assert_eq!(value_of(&records, "page.string"), &serde_json::json!("hello"));
    assert_eq!(value_of(&records, "host.eval"), &serde_json::json!({"via": "page-evaluate"}));
    // A value that serializes to nothing (undefined, a function) is null, and
    // so is a call with no value argument at all.
    for key in ["page.undefined", "page.fn", "page.noargs"] {
        assert_eq!(value_of(&records, key), &serde_json::Value::Null, "{key}");
    }

    // `external.tracelog` is an IDL operation: on the prototype, not own on the
    // instance, enumerable the way WebIDL declares operations, `length` 2, and
    // reading as native code.
    let surface = &value_of(&records, "page.surface")["surface"];
    let prototype_names: Vec<&str> = surface[0]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap())
        .collect();
    for name in ["tracelog", "AddSearchProvider", "IsSearchProviderInstalled", "constructor"] {
        assert!(prototype_names.contains(&name), "{prototype_names:?}");
    }
    assert_eq!(surface[1], serde_json::json!(false), "own property: {surface}");
    assert_eq!(surface[2], serde_json::json!(true), "enumerable: {surface}");
    assert_eq!(surface[3], serde_json::json!(2), "length: {surface}");
    assert_eq!(surface[4], serde_json::json!("tracelog"), "name: {surface}");
    assert_eq!(
        surface[5],
        serde_json::json!("function tracelog() { [native code] }"),
        "native toString: {surface}"
    );
    assert_eq!(
        value_of(&records, "page.surface")["symbolKey"],
        serde_json::json!("TypeError")
    );

    // A frame is a document realm, so it carries the same surface.
    let frame_surface = &value_of(&records, "frame.surface");
    assert_eq!(frame_surface["tracelog"], serde_json::json!("function"));
    assert!(frame_surface["keys"]
        .as_array()
        .unwrap()
        .iter()
        .any(|name| name == "tracelog"));

    // The worker: `window` and `document` stay deleted (Chrome's worker scope
    // has neither) while the tracing primitive is reachable, and both the
    // worker's own script and its message dispatch can write records.
    let worker_scope = &value_of(&records, "worker.scope");
    assert_eq!(worker_scope["windowType"], serde_json::json!("undefined"));
    assert_eq!(worker_scope["documentType"], serde_json::json!("undefined"));
    assert_eq!(worker_scope["externalType"], serde_json::json!("object"));
    assert_eq!(worker_scope["tracelogType"], serde_json::json!("function"));
    assert!(
        keys.contains(&"worker.message".to_string()),
        "worker message dispatch did not reach the sink: {keys:?}"
    );
}

#[test]
fn tracelog_labels_name_the_realm_that_called() {
    let directory = directory();
    let trace = directory.join("trace.jsonl");
    let origin = serve(&[
        ("/page.html", PAGE),
        ("/frame.html", FRAME),
        ("/worker.js", WORKER),
    ]);

    let output = run(&origin, &trace, true);
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let records = records(&trace);

    // In the labels run every line is a four-field record with a string label.
    for record in &records {
        assert!(record["from"].is_string(), "no label: {record}");
    }
    let from_of = |key: &str| -> String {
        records
            .iter()
            .find(|record| record["k"] == key)
            .unwrap_or_else(|| panic!("no record for key {key:?}"))["from"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let page_url = format!("{origin}/page.html");
    let frame_url = format!("{origin}/frame.html");
    let worker_url = format!("{origin}/worker.js");

    assert_eq!(from_of("page.string"), format!("script@{page_url}"));
    assert_eq!(from_of("frame.surface"), format!("script@{frame_url}"));
    assert_eq!(from_of("host.eval"), "host");
    // The worker's own script is one code unit in its isolate; its message
    // dispatch runs on the worker's ambient label, with the creator's label
    // nested inside it.
    assert_eq!(from_of("worker.scope"), format!("script@{worker_url}"));
    let worker_message = from_of("worker.message");
    assert!(
        worker_message.starts_with("worker(1)[") && worker_message.contains(&format!("script@{page_url}")),
        "worker message label was {worker_message}"
    );
}

#[test]
fn tracelog_is_absent_without_a_destination() {
    let directory = directory();
    let trace = directory.join("trace.jsonl");
    // A page that does not call the method: its absence is the point here, so
    // this run must not depend on a page script surviving the missing API.
    let origin = serve(&[(
        "/quiet.html",
        "<!doctype html><html><body>quiet</body></html>",
    )]);

    let output = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .env_remove("OBSCURA_TRACE_API_FILE")
        .env_remove("OBSCURA_TRACE_OP_FILE")
        .env_remove("OBSCURA_TRACELOG_FILE")
        .env_remove("OBSCURA_TRACELOG_FROM")
        .args([
            "fetch",
            &format!("{origin}/quiet.html"),
            "--allow-private-network",
            "--wait",
            "1",
            "--timeout",
            "25",
            "--quiet",
            "--eval",
            "JSON.stringify([typeof window.external.tracelog, \
             Object.getOwnPropertyNames(External.prototype).sort()])",
        ])
        .output()
        .expect("run untraced fixture");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    // Production shape: no method, the stock External surface, and no file. A
    // page cannot reach the sink a run did not ask for.
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("undefined")
            && stdout.contains("AddSearchProvider")
            && stdout.contains("IsSearchProviderInstalled")
            && !stdout.contains("tracelog"),
        "untraced External surface changed: {stdout}"
    );
    assert!(
        !trace.exists(),
        "a run without --tracelog-file wrote a trace file"
    );
}
