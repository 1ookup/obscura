// CDP `DOM.getDocument{pierce:true}`: a closed shadow root is not part of the
// ordinary child list, so the plain walk stops at the host. A widget a page puts
// inside one (Turnstile's checkbox is the motivating case) is therefore only
// findable through `pierce`, and a client that cannot find it has to inject a
// preload that wraps a builtin -- which the challenge then reads back through
// `Function.prototype.toString` and treats as automation.
//
// The root arrives beside its host as `shadowRoots`, carrying its encapsulation
// mode, and the frame inside it is addressable by `nodeId` so a click can use
// `DOM.getBoxModel` for coordinates.
use obscura_cdp::dispatch::{dispatch, CdpContext};
use obscura_cdp::types::CdpRequest;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const PAGE: &str = r#"<html><head><title>pierce</title></head><body>
<iframe id="plain" srcdoc="<b>plain</b>"></iframe>
<div id="host"></div>
<script>
  const root = document.getElementById('host').attachShadow({ mode: 'closed' });
  const widget = document.createElement('iframe');
  widget.id = 'widget';
  widget.srcdoc = '<b>widget</b>';
  root.appendChild(widget);
</script>
</body></html>"#;

async fn serve() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                let _ = socket.read(&mut buf).await;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\
                     Connection: close\r\n\r\n{PAGE}",
                    PAGE.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            });
        }
    });
    format!("http://{addr}/")
}

async fn cdp(
    ctx: &mut CdpContext,
    id: u64,
    method: &str,
    params: Value,
    session_id: &str,
) -> Result<Value, String> {
    let resp = dispatch(
        &CdpRequest {
            id,
            method: method.to_string(),
            params,
            session_id: Some(session_id.to_string()),
        },
        ctx,
    )
    .await;
    match resp.error {
        Some(error) => Err(error.message),
        None => Ok(resp.result.unwrap_or_else(|| json!({}))),
    }
}

async fn cdp_ok(
    ctx: &mut CdpContext,
    id: u64,
    method: &str,
    params: Value,
    session_id: &str,
) -> Value {
    cdp(ctx, id, method, params, session_id)
        .await
        .unwrap_or_else(|error| panic!("CDP {method} failed: {error}"))
}

/// Depth-first search for an element node with the given `id` attribute.
fn find_by_id(node: &Value, id: &str) -> Option<u64> {
    let attributes = node.get("attributes").and_then(Value::as_array);
    if let Some(attributes) = attributes {
        let pairs: Vec<&str> = attributes.iter().filter_map(Value::as_str).collect();
        for pair in pairs.chunks(2) {
            if pair.len() == 2 && pair[0] == "id" && pair[1] == id {
                return node.get("nodeId").and_then(Value::as_u64);
            }
        }
    }
    for key in ["children", "shadowRoots"] {
        for child in node.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let Some(found) = find_by_id(child, id) {
                return Some(found);
            }
        }
    }
    None
}

fn find_shadow_root(node: &Value) -> Option<&Value> {
    if let Some(roots) = node.get("shadowRoots").and_then(Value::as_array) {
        if let Some(first) = roots.first() {
            return Some(first);
        }
    }
    for key in ["children", "shadowRoots"] {
        for child in node.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let Some(found) = find_shadow_root(child) {
                return Some(found);
            }
        }
    }
    None
}

#[tokio::test(flavor = "current_thread")]
async fn get_document_pierce_projects_a_closed_shadow_root() {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session = "session-1";
    ctx.sessions.insert(session.to_string(), page_id);
    cdp_ok(&mut ctx, 1, "DOM.enable", json!({}), session).await;
    cdp_ok(
        &mut ctx,
        2,
        "Page.navigate",
        json!({ "url": url, "waitUntil": "load" }),
        session,
    )
    .await;

    // Without pierce, the tree stops at the host: a shadow root is not an
    // ordinary child, and the widget inside it is unreachable by name.
    let flat = cdp_ok(&mut ctx, 3, "DOM.getDocument", json!({ "depth": -1 }), session).await;
    assert!(
        find_by_id(&flat["root"], "widget").is_none(),
        "the closed shadow root's contents must not appear without pierce"
    );
    assert!(
        find_shadow_root(&flat["root"]).is_none(),
        "no shadowRoots without pierce"
    );
    assert!(
        find_by_id(&flat["root"], "plain").is_some(),
        "the ordinary frame must still be there"
    );

    // With pierce they do: the root is reported beside its host with the mode
    // the page chose, and the frame inside it is addressable for a click.
    let pierced = cdp_ok(
        &mut ctx,
        4,
        "DOM.getDocument",
        json!({ "depth": -1, "pierce": true }),
        session,
    )
    .await;
    let root = find_shadow_root(&pierced["root"]).expect("shadowRoots on the host");
    assert_eq!(root["shadowRootType"], json!("closed"));
    assert_eq!(root["nodeType"], json!(11));
    let widget = find_by_id(&pierced["root"], "widget").expect("widget inside the shadow root");

    #[cfg(feature = "render")]
    {
        let model = cdp_ok(&mut ctx, 5, "DOM.getBoxModel", json!({ "nodeId": widget }), session).await;
        assert!(
            model.get("model").is_some(),
            "a click needs the frame's box: {model}"
        );
    }
}

/// The same page, requested with `pierce: false` explicitly, keeps the old
/// shape: the flag is opt-in, and clients that never set it see no new fields.
#[tokio::test(flavor = "current_thread")]
async fn get_document_without_pierce_is_unchanged() {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session = "session-1";
    ctx.sessions.insert(session.to_string(), page_id);
    cdp_ok(&mut ctx, 1, "DOM.enable", json!({}), session).await;
    cdp_ok(
        &mut ctx,
        2,
        "Page.navigate",
        json!({ "url": url, "waitUntil": "load" }),
        session,
    )
    .await;
    let doc = cdp_ok(
        &mut ctx,
        3,
        "DOM.getDocument",
        json!({ "depth": -1, "pierce": false }),
        session,
    )
    .await;
    let serialized = serde_json::to_string(&doc).expect("serialize");
    assert!(!serialized.contains("shadowRoots"), "{serialized}");
    assert!(!serialized.contains("shadowRootType"), "{serialized}");
}
