#![cfg(feature = "render")]

// A sandbox without allow-scripts suppresses scripts, not the document
// lifecycle. The frame's realm still advances readyState through interactive
// to complete and fires DOMContentLoaded/load, and the embedder observes the
// load on the iframe element. A parent that probes the child's readyState
// (the challenge's expectation table) retried the frame while this engine
// left it at "loading".

use obscura_cdp::dispatch::{dispatch, CdpContext};
use obscura_cdp::types::CdpRequest;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const PAGE: &str = r#"<html><body>
<iframe id="f" sandbox="allow-same-origin" srcdoc="<b>hello</b>"></iframe>
<script>
window.__ev = [];
var f = document.getElementById('f');
f.addEventListener('load', function(){ window.__ev.push('iframe-load'); });
setTimeout(function(){
  var d = null;
  try { d = f.contentDocument; } catch (e) {}
  window.__snap = {
    ev: window.__ev.slice(),
    readyState: d ? d.readyState : 'noDoc',
    visibility: d ? d.visibilityState : 'noDoc',
  };
}, 700);
</script>
</body></html>"#;

async fn serve_fixture() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 2048];
        let _ = socket.read(&mut buf).await.unwrap();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{PAGE}",
            PAGE.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });
    format!("http://{addr}/")
}

async fn cdp(
    ctx: &mut CdpContext,
    id: u64,
    method: &str,
    params: Value,
    session_id: &str,
) -> Value {
    let response = dispatch(
        &CdpRequest {
            id,
            method: method.to_string(),
            params,
            session_id: Some(session_id.to_string()),
        },
        ctx,
    )
    .await;
    assert!(response.error.is_none(), "CDP {method} failed: {:?}", response.error);
    response.result.unwrap_or_else(|| json!({}))
}

async fn evaluate(ctx: &mut CdpContext, id: u64, expression: &str, session_id: &str) -> Value {
    cdp(
        ctx,
        id,
        "Runtime.evaluate",
        json!({"expression": expression, "returnByValue": true, "awaitPromise": true}),
        session_id,
    )
    .await
    .get("result")
    .cloned()
    .and_then(|r| r.get("value").cloned())
    .unwrap_or(Value::Null)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sandboxed_no_scripts_frame_still_completes_its_document_lifecycle() {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve_fixture().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session_id = "sandbox-lifecycle-session";
    ctx.sessions.insert(session_id.to_string(), page_id);
    cdp(
        &mut ctx,
        1,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        session_id,
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let snap = evaluate(
        &mut ctx,
        2,
        "(async function(){ var deadline = Date.now() + 5000; \
          while (!window.__snap && Date.now() < deadline) { \
            await new Promise(function(r){ setTimeout(r, 100); }); \
          } \
          return JSON.stringify(window.__snap); })()",
        session_id,
    )
    .await;
    let snap: Value = serde_json::from_str(snap.as_str().unwrap()).unwrap();
    assert_eq!(
        snap["readyState"], json!("complete"),
        "a sandboxed frame's document must reach readyState complete"
    );
    assert_eq!(snap["visibility"], json!("visible"));
    assert_eq!(
        snap["ev"],
        json!(["iframe-load"]),
        "the embedder must observe the load event on the iframe element"
    );
}
