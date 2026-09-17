// Execution-source (`from`) label coverage for the host-op trace. Each
// assertion pins the label taxonomy shared with the HaHaVM dispatch trace:
// script@<url>, function@<source>, worker(M)[creator], iframe(N), host, and
// the ambient window default. See docs/native-trace.md.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
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

fn directory() -> std::path::PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "obscura-trace-source-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}

/// (from, operation, message/arg) for every console row in the trace.
fn console_rows(trace: &str) -> Vec<(String, String, String)> {
    trace
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split('\t').collect();
            if fields.len() == 4 && fields[2].starts_with("console.") {
                Some((
                    fields[1].to_string(),
                    fields[2].to_string(),
                    fields[3].to_string(),
                ))
            } else {
                None
            }
        })
        .collect()
}

fn from_for(rows: &[(String, String, String)], message: &str) -> String {
    rows.iter()
        .find(|(_, _, logged)| logged.contains(message))
        .map(|(from, _, _)| from.clone())
        .unwrap_or_else(|| panic!("no console row containing {message:?}"))
}

fn op_rows(trace: &str, operation: &str) -> Vec<Vec<String>> {
    trace
        .lines()
        .filter(|line| {
            let fields: Vec<_> = line.split('\t').collect();
            fields.len() == 7 && fields[2] == operation
        })
        .map(|line| line.split('\t').map(str::to_string).collect())
        .collect()
}

fn run(origin: &str, trace: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_obscura"))
        .env_remove("OBSCURA_TRACE_API_FILE")
        .env_remove("OBSCURA_TRACE_OP_FILE")
        .arg("--trace-op-file")
        .arg(trace)
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
            "console.log('host-hello')",
        ])
        .output()
        .expect("run trace-source fixture")
}

#[test]
fn trace_source_labels_cover_scripts_timers_listeners_workers_and_frames() {
    let directory = directory();
    let trace = directory.join("ops.tsv");

    let page = r#"
<!doctype html>
<html><body>
<iframe src="/frame.html"></iframe>
<script>
  console.log('inline-hello');
  setTimeout(() => console.log('timer-hello'), 30);
  addEventListener('probe', () => console.log('listener-hello'));
  setTimeout(() => dispatchEvent(new Event('probe')), 40);
  const product = new Function("console.log('fn-hello')");
  product();
  window.onmessage = () => console.log('pmsg-hello');
  postMessage('x', '*');
  const worker = new Worker('/worker.js');
  worker.onmessage = () => console.log('worker-echo');
  worker.postMessage('go');
  fetch('/ping').then(() => console.log('fetch-done'));
</script>
</body></html>
"#;
    let frame = r#"
<!doctype html>
<html><body>
<script>
  console.log('frame-hello');
  window.onload = () => console.log('frame-onload');
</script>
</body></html>
"#;
    let worker = r#"
console.log('worker-src');
onmessage = function () {
  console.log('worker-msg');
  postMessage('back');
};
"#;

    let origin = serve(&[
        ("/page.html", page),
        ("/frame.html", frame),
        ("/worker.js", worker),
        ("/ping", "pong"),
    ]);

    let output = run(&origin, &trace);
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let traced = std::fs::read_to_string(&trace).expect("trace file");

    let rows = console_rows(&traced);
    let page_url = format!("{origin}/page.html");
    let frame_url = format!("{origin}/frame.html");
    let worker_url = format!("{origin}/worker.js");

    // Parser inline script: one script@ unit carrying the document URL.
    assert_eq!(from_for(&rows, "inline-hello"), format!("script@{page_url}"));
    // Timer continuation: the scheduling site's label, restored at fire.
    assert_eq!(from_for(&rows, "timer-hello"), format!("script@{page_url}"));
    // Listener: registration-time snapshot.
    assert_eq!(from_for(&rows, "listener-hello"), format!("script@{page_url}"));
    // new Function product: function@<creation source>.
    assert_eq!(
        from_for(&rows, "fn-hello"),
        format!("function@script@{page_url}")
    );
    // window.onmessage assignment snapshot (self postMessage delivery).
    assert_eq!(from_for(&rows, "pmsg-hello"), format!("script@{page_url}"));
    // .then continuation under the then-call label.
    assert_eq!(from_for(&rows, "fetch-done"), format!("script@{page_url}"));

    // Engine-driven ops in the main realm carry the ambient window default.
    assert!(
        traced
            .lines()
            .any(|line| line.split('\t').nth(1) == Some("window")),
        "no ambient window-labelled row"
    );

    // Worker: its own script is a script@ unit in the worker isolate...
    assert_eq!(from_for(&rows, "worker-src"), format!("script@{worker_url}"));
    // ...message dispatch inside the worker runs on the worker's ambient
    // worker(M)[creator] label...
    let worker_msg = from_for(&rows, "worker-msg");
    assert!(
        worker_msg.starts_with("worker(1)[")
            && worker_msg.contains(&format!("script@{page_url}")),
        "worker message dispatch label was {worker_msg}"
    );
    // ...and the page-side handler runs under its assignment snapshot.
    assert_eq!(from_for(&rows, "worker-echo"), format!("script@{page_url}"));

    // Frame realm: parser script labeled with the frame document URL...
    assert_eq!(from_for(&rows, "frame-hello"), format!("script@{frame_url}"));
    // ...window.onload fired from the engine uses the assignment snapshot...
    assert_eq!(from_for(&rows, "frame-onload"), format!("script@{frame_url}"));
    // ...and engine-driven ops in the frame realm (the load dispatch walks
    // the DOM path) carry the frame's ambient iframe(N) label.
    assert!(
        traced.lines().any(|line| {
            let from = line.split('\t').nth(1).unwrap_or_default();
            from.starts_with("iframe(") && from.ends_with(')')
        }),
        "no ambient iframe(N)-labelled row"
    );

    // Host-injected code (CLI --eval).
    assert_eq!(from_for(&rows, "host-hello"), "host");

    // The fetch op row carries the call-time label deterministically through
    // the referrer context, not the thread-local at async-body start.
    let pings = op_rows(&traced, "fetch")
        .into_iter()
        .filter(|fields| fields[4].ends_with("/ping"))
        .collect::<Vec<_>>();
    assert_eq!(pings.len(), 1, "exactly one /ping fetch row");
    assert_eq!(pings[0][1], format!("script@{page_url}"));

    // The from column exists on every op row (7 fields incl. header).
    assert!(traced.starts_with("timestamp_us\tfrom\toperation\t"));

    // The same page with tracing off must not emit a trace at all.
    let untraced = directory.join("untraced.tsv");
    let output = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .env_remove("OBSCURA_TRACE_API_FILE")
        .env_remove("OBSCURA_TRACE_OP_FILE")
        .args([
            "fetch",
            &format!("{origin}/page.html"),
            "--allow-private-network",
            "--wait",
            "1",
            "--timeout",
            "25",
            "--quiet",
            "--eval",
            "JSON.stringify({flag: globalThis.__obscura_trace_from_enabled === true, \
             handlerIsAccessor: (() => { const d = Object.getOwnPropertyDescriptor(Element.prototype, 'onclick'); return !!d && typeof d.get === 'function' && typeof d.set === 'function'; })(), \
             assignmentMakesOwnProperty: (() => { const el = document.createElement('div'); el.onclick = () => 1; return Object.prototype.hasOwnProperty.call(el, 'onclick'); })(), \
             svgHasOwnHandlers: typeof Object.getOwnPropertyDescriptor(SVGElement.prototype, 'onclick')?.get === 'function', \
             windowHandlerIsOwnAccessor: (() => { const d = Object.getOwnPropertyDescriptor(window, 'onload'); return !!d && typeof d.get === 'function' && d.enumerable === true; })()})",
        ])
        .output()
        .expect("run untraced fixture");
    assert!(output.status.success());
    assert!(
        !untraced.exists() || std::fs::read_to_string(&untraced).unwrap().is_empty(),
        "no trace without --trace-op-file"
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("\"flag\":false")
            && stdout.contains("\"handlerIsAccessor\":true")
            && stdout.contains("\"assignmentMakesOwnProperty\":false")
            && stdout.contains("\"svgHasOwnHandlers\":true")
            && stdout.contains("\"windowHandlerIsOwnAccessor\":true"),
        "untraced handler surface changed: {stdout}"
    );
}
