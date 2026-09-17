// Worker CSP precedence, pinned against Chromium: a *fetched* worker carries
// its own Content-Security-Policy response header with no fallback to the
// creator document's policy, while local-scheme workers (data:, blob:)
// inherit the creator's. Before the fix every worker ran under the creator's
// policy, so a worker could neither restrict itself nor escape a creator
// restriction Chromium would not have applied to it.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Command;

fn serve(routes: &[(&str, &[(&str, &str)], &str)]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let addr = listener.local_addr().unwrap();
    let routes: Vec<(String, Vec<(String, String)>, String)> = routes
        .iter()
        .map(|(path, headers, body)| {
            (
                path.to_string(),
                headers
                    .iter()
                    .map(|(name, value)| (name.to_string(), value.to_string()))
                    .collect(),
                body.to_string(),
            )
        })
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
            let Some((_, headers, body)) = routes.iter().find(|(route, _, _)| *route == path)
            else {
                continue;
            };
            let mut response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n",
                body.len()
            );
            for (name, value) in headers {
                response.push_str(&format!("{name}: {value}\r\n"));
            }
            response.push_str("Connection: close\r\n\r\n");
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(body.as_bytes());
            let _ = stream.flush();
        }
    });
    format!("http://{addr}")
}

fn run(origin: &str, page: &str, eval: &str) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .env_remove("OBSCURA_TRACE_API_FILE")
        .env_remove("OBSCURA_TRACE_OP_FILE")
        .args([
            "fetch",
            page,
            "--allow-private-network",
            "--wait",
            "2",
            "--timeout",
            "25",
            "--quiet",
            "--eval",
            eval,
        ])
        .output()
        .expect("run worker csp fixture");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_matches('"')
        .to_string()
}

const PROBE_WORKER: &str = r#"
onmessage = function () {
  fetch('/leak').then(
    () => postMessage('fetched'),
    () => postMessage('blocked'));
};
"#;

const PAGE_SCRIPT: &str = r#"
<script>
  globalThis.__results = [];
  const report = (tag) => (e) => { globalThis.__results.push(tag + ':' + e.data); };
  // A worker-src violation throws synchronously from the constructor (as in
  // Chrome), so each construction is guarded to keep the probe running.
  const make = (fn) => { try { return fn(); } catch (e) { return null; } };
  const ownCsp = make(() => new Worker('/own-csp.js'));
  if (ownCsp) { ownCsp.onmessage = report('own'); ownCsp.postMessage('go'); }
  const noCsp = make(() => new Worker('/no-csp.js'));
  if (noCsp) { noCsp.onmessage = report('none'); noCsp.postMessage('go'); }
  // A data: worker has an opaque base URL, so its probe fetches an absolute
  // URL the way a real inline worker must.
  const inherited = make(() => new Worker('data:text/javascript,' + encodeURIComponent(
    "onmessage=function(){fetch('" + location.origin + "/leak').then(function(){postMessage('fetched')},function(){postMessage('blocked')})}")));
  if (inherited) { inherited.onmessage = report('inherited'); inherited.postMessage('go'); }
</script>
"#;

#[test]
fn worker_csp_owns_its_response_header_and_local_schemes_inherit() {
    let origin = serve(&[
        // Clean creator page.
        (
            "/page.html",
            &[],
            &format!("<!doctype html><html><body>{PAGE_SCRIPT}</body></html>"),
        ),
        // Fetched worker with its own restrictive policy.
        (
            "/own-csp.js",
            &[("Content-Security-Policy", "connect-src 'none'")],
            PROBE_WORKER,
        ),
        // Fetched worker with no policy of its own: Chromium runs it with no
        // CSP at all (it does not fall back to the creator's).
        ("/no-csp.js", &[], PROBE_WORKER),
        ("/leak", &[], "leak"),
    ]);

    let results = run(
        &origin,
        &format!("{origin}/page.html"),
        "globalThis.__results.sort().join('|')",
    );
    assert_eq!(
        results,
        "inherited:fetched|none:fetched|own:blocked",
        "worker CSP precedence: own header must govern fetched workers"
    );

    // A creator policy now reaches only local-scheme workers. The page's own
    // CSP allows the data: worker's construction but denies its fetch;
    // `connect-src` with a path-limited source keeps the page navigable.
    let restrictive_page = format!(
        "<!doctype html><html><head><meta http-equiv='Content-Security-Policy' \
         content=\"worker-src data:; connect-src 'none'\"></head><body>{PAGE_SCRIPT}</body></html>"
    );
    let origin = serve(&[
        ("/page.html", &[], &restrictive_page),
        (
            "/own-csp.js",
            &[("Content-Security-Policy", "connect-src 'none'")],
            PROBE_WORKER,
        ),
        ("/no-csp.js", &[], PROBE_WORKER),
        ("/leak", &[], "leak"),
    ]);
    let results = run(
        &origin,
        &format!("{origin}/page.html"),
        "globalThis.__results.sort().join('|')",
    );
    // The fetched workers never construct: `worker-src data:` refuses their
    // constructors synchronously, exactly as Chrome does. The data: worker
    // constructs and its fetch inherits the creator policy.
    assert_eq!(
        results,
        "inherited:blocked",
        "local-scheme workers inherit the creator policy"
    );
}
