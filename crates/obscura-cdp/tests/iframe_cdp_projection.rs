// Phase 6 — CDP frame projection and execution-context routing
// (docs/Iframe-support-design.md). These tests drive the public CDP surface
// against a page with nested srcdoc iframes:
//   - Page.getFrameTree projects the browser-core frame registry recursively
//   - child frame lifecycle events stream in Chrome order inside the main
//     frame's load sequence, with real executionContextCreated events
//   - Runtime.evaluate / callFunctionOn / getProperties route into the frame
//     world realm a contextId or objectId addresses
//   - stale contexts are rejected with Chrome's error shape after teardown
//   - Page.createIsolatedWorld builds a real child-frame world, and a real
//     main-frame world that survives navigation
//   - a frame with no <script> still gets a default context once the client
//     enables the Runtime domain, and none at all when it does not
//   - Page.navigate(frameId) navigates one frame through the Rust controller

use obscura_cdp::dispatch::{dispatch, CdpContext};
use obscura_cdp::types::CdpRequest;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const MAIN_PAGE: &str = r#"<html><head><title>main</title></head><body>
<iframe srcdoc='<html><head><title>frame one</title></head><body><div id="inner">hello</div><script>var frameVar=7;</script><iframe srcdoc="<script>var deep=1;</script><b id=deepb>deep</b>"></iframe></body></html>'></iframe>
<div id="mainDiv">main content</div>
</body></html>"#;

const FRAME_PAGE: &str = r#"<html><head><title>navd</title></head><body><div id="navdiv">NV</div><script>var navvar=99;</script></body></html>"#;
const MISSING_FRAME_PAGE: &str = r#"<html><head><title>Not Found</title></head><body><h1 id="missing">404</h1></body></html>"#;

/// A page whose iframe carries no script at all, like an ad, an embedded
/// player or any static include. Nothing on the page creates a realm on its
/// own, which is what both the eager-context and the zero-cost tests need.
const PLAIN_PAGE: &str = r#"<html><head><title>plain host</title></head><body>
<iframe srcdoc='<html><head><title>plain frame</title></head><body><div id="plain">static</div></body></html>'></iframe>
<div id="mainDiv">main content</div>
</body></html>"#;

/// Serve the main page at `/` and a navigable frame document at `/frame`.
async fn serve() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let body = if request.starts_with("GET /frame") {
                    FRAME_PAGE
                } else if request.starts_with("GET /missing") {
                    MISSING_FRAME_PAGE
                } else if request.starts_with("GET /plain") {
                    PLAIN_PAGE
                } else {
                    MAIN_PAGE
                };
                let status = if request.starts_with("GET /missing") {
                    "404 Not Found"
                } else {
                    "200 OK"
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
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

/// Runtime.evaluate returning by value, optionally in a specific context.
async fn eval_value(
    ctx: &mut CdpContext,
    id: u64,
    expr: &str,
    context_id: Option<i64>,
    session_id: &str,
) -> Result<Value, String> {
    let mut params = json!({ "expression": expr, "returnByValue": true });
    if let Some(context_id) = context_id {
        params["contextId"] = json!(context_id);
    }
    let result = cdp(ctx, id, "Runtime.evaluate", params, session_id).await?;
    Ok(result["result"]["value"].clone())
}

async fn setup() -> (CdpContext, String, String, String) {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session_id = "session-1";
    ctx.sessions.insert(session_id.to_string(), page_id.clone());
    // Chromium only reports executionContextCreated after Runtime.enable.
    // Most tests below inspect or route through those advertised contexts;
    // the explicit navigate-only test exercises the disabled-domain path.
    cdp_ok(&mut ctx, 1, "Runtime.enable", json!({}), session_id).await;
    cdp_ok(
        &mut ctx,
        2,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        session_id,
    )
    .await;
    (ctx, session_id.to_string(), page_id, url)
}

/// Navigate to the scriptless-iframe page, calling `Runtime.enable` before or
/// after the navigation. Both orders have to end with the frame advertising a
/// default execution context: the rollout creates it eagerly, and enabling
/// later backfills the frames that already committed.
async fn setup_plain(enable_runtime_first: bool) -> (CdpContext, String, String) {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session_id = "session-1";
    ctx.sessions.insert(session_id.to_string(), page_id.clone());
    if enable_runtime_first {
        cdp_ok(&mut ctx, 1, "Runtime.enable", json!({}), session_id).await;
    }
    cdp_ok(
        &mut ctx,
        2,
        "Page.navigate",
        json!({"url": format!("{url}plain"), "waitUntil": "load"}),
        session_id,
    )
    .await;
    if !enable_runtime_first {
        cdp_ok(&mut ctx, 3, "Runtime.enable", json!({}), session_id).await;
    }
    (ctx, session_id.to_string(), page_id)
}

/// The only child frame of the scriptless page.
async fn only_child_frame_id(ctx: &mut CdpContext, session_id: &str) -> String {
    let tree = cdp_ok(ctx, 91, "Page.getFrameTree", json!({}), session_id).await;
    tree["frameTree"]["childFrames"][0]["frame"]["id"]
        .as_str()
        .expect("child frame present")
        .to_string()
}

/// The outer child frame and the nested (depth-2) frame ids, read from
/// Page.getFrameTree.
async fn child_frame_ids(ctx: &mut CdpContext, session_id: &str) -> (String, String) {
    let tree = cdp_ok(ctx, 90, "Page.getFrameTree", json!({}), session_id).await;
    let outer = tree["frameTree"]["childFrames"][0]["frame"]["id"]
        .as_str()
        .expect("outer child frame present")
        .to_string();
    let deep = tree["frameTree"]["childFrames"][0]["childFrames"][0]["frame"]["id"]
        .as_str()
        .expect("nested child frame present")
        .to_string();
    (outer, deep)
}

/// The latest advertised default-world contextId for `frame_id`.
fn default_context_id(ctx: &CdpContext, frame_id: &str) -> i64 {
    ctx.pending_events
        .iter()
        .rev()
        .find_map(|e| {
            if e.method != "Runtime.executionContextCreated" {
                return None;
            }
            let context = &e.params["context"];
            (context["auxData"]["frameId"] == frame_id
                && context["auxData"]["isDefault"] == true)
                .then(|| context["id"].as_i64().unwrap())
        })
        .unwrap_or_else(|| panic!("no default executionContextCreated for {frame_id}"))
}

#[tokio::test(flavor = "current_thread")]
async fn get_frame_tree_projects_nested_srcdoc_frames() {
    let (mut ctx, sid, page_id, url) = setup().await;
    let tree = cdp_ok(&mut ctx, 2, "Page.getFrameTree", json!({}), &sid).await;

    // Main frame unchanged: id == targetId (Chromium convention).
    assert_eq!(tree["frameTree"]["frame"]["id"], json!(page_id));
    let origin = obscura_dom::Origin::from_url(&url).serialize();
    assert_eq!(tree["frameTree"]["frame"]["securityOrigin"], json!(origin));

    let children = tree["frameTree"]["childFrames"].as_array().unwrap();
    assert_eq!(children.len(), 1, "one outer iframe: {children:?}");
    let outer = &children[0]["frame"];
    let outer_id = outer["id"].as_str().unwrap();
    assert!(
        outer_id.starts_with(&format!("frame-{page_id}-")),
        "child frame ids follow frame-<page>-<n>: {outer_id}"
    );
    assert_eq!(outer["parentId"], json!(page_id));
    assert_eq!(outer["url"], json!("about:srcdoc"));
    // srcdoc inherits the creator origin.
    assert_eq!(outer["securityOrigin"], json!(origin));
    assert!(outer["loaderId"].as_str().is_some_and(|l| !l.is_empty()));

    // Depth 2: the iframe nested inside the srcdoc document.
    let nested = tree["frameTree"]["childFrames"][0]["childFrames"]
        .as_array()
        .unwrap();
    assert_eq!(nested.len(), 1, "one nested iframe: {nested:?}");
    let deep = &nested[0]["frame"];
    assert_eq!(deep["parentId"], json!(outer_id));
    assert_eq!(deep["securityOrigin"], json!(origin));
    assert!(nested[0]["childFrames"].as_array().unwrap().is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn child_frame_lifecycle_streams_in_order_within_main_load() {
    let (mut ctx, sid, page_id, _url) = setup().await;
    let (outer, deep) = child_frame_ids(&mut ctx, &sid).await;

    let events: Vec<(usize, &str, &Value)> = ctx
        .pending_events
        .iter()
        .enumerate()
        .map(|(i, e)| (i, e.method.as_str(), &e.params))
        .collect();
    let find = |method: &str, frame: &str| -> usize {
        events
            .iter()
            .find(|(_, m, p)| {
                *m == method
                    && (p["frameId"] == frame || p["frame"]["id"] == frame)
            })
            .map(|(i, _, _)| *i)
            .unwrap_or_else(|| panic!("missing {method} for {frame}"))
    };

    let attached = find("Page.frameAttached", &outer);
    let started = find("Page.frameStartedLoading", &outer);
    let navigated = find("Page.frameNavigated", &outer);
    let stopped = find("Page.frameStoppedLoading", &outer);
    assert!(
        attached < started && started < navigated && navigated < stopped,
        "child lifecycle order: attached {attached} started {started} navigated {navigated} stopped {stopped}"
    );
    // frameAttached carries the parent.
    assert_eq!(
        ctx.pending_events[attached].params["parentFrameId"],
        json!(page_id)
    );

    // The child stream sits inside the main frame's load sequence: after the
    // main commit lifecycle, before the main load lifecycle.
    let main_commit = events
        .iter()
        .find(|(_, m, p)| {
            *m == "Page.lifecycleEvent" && p["name"] == "commit" && p["frameId"] == page_id
        })
        .map(|(i, _, _)| *i)
        .expect("main commit lifecycle");
    let main_load = events
        .iter()
        .find(|(_, m, p)| {
            *m == "Page.lifecycleEvent" && p["name"] == "load" && p["frameId"] == page_id
        })
        .map(|(i, _, _)| *i)
        .expect("main load lifecycle");
    assert!(
        main_commit < attached && stopped < main_load,
        "child events must land between main commit ({main_commit}) and load ({main_load})"
    );

    // The nested frame streams too, attached to the outer frame.
    let deep_attached = find("Page.frameAttached", &deep);
    assert_eq!(
        ctx.pending_events[deep_attached].params["parentFrameId"],
        json!(outer)
    );

    // Real execution contexts: default world for both frames, registered in
    // the table and the valid-id set.
    for frame in [&outer, &deep] {
        let context_id = default_context_id(&ctx, frame);
        assert!(ctx.valid_context_ids.contains(&context_id));
        let entry = ctx
            .execution_contexts
            .get(&context_id)
            .unwrap_or_else(|| panic!("table entry for context {context_id}"));
        assert_eq!(&entry.frame_id, frame);
        assert!(entry.is_default);
        assert_eq!(entry.world_id, 0);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn evaluate_routes_into_child_frame_context() {
    let (mut ctx, sid, _page_id, _url) = setup().await;
    let (outer, deep) = child_frame_ids(&mut ctx, &sid).await;
    let outer_ctx = default_context_id(&ctx, &outer);
    let deep_ctx = default_context_id(&ctx, &deep);

    // The frame's own document, not the main document.
    let title = eval_value(&mut ctx, 3, "document.title", Some(outer_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("frame one"));
    let inner = eval_value(
        &mut ctx,
        4,
        "document.getElementById('inner').textContent",
        Some(outer_ctx),
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(inner, json!("hello"));

    // Frame scripts ran in this realm; the nested frame has its own.
    let frame_var = eval_value(&mut ctx, 5, "frameVar", Some(outer_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(frame_var.as_f64(), Some(7.0));
    let deep_var = eval_value(&mut ctx, 6, "deep", Some(deep_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(deep_var.as_f64(), Some(1.0));

    // Top-level var persists across evaluations in the same frame context.
    eval_value(&mut ctx, 7, "var shared1 = 41", Some(outer_ctx), &sid)
        .await
        .unwrap();
    let shared = eval_value(
        &mut ctx,
        8,
        "typeof shared1 === 'number' ? shared1 + 1 : 'missing'",
        Some(outer_ctx),
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(shared.as_f64(), Some(42.0));

    // The main context is untouched: no frame globals, its own document.
    let main_view = eval_value(
        &mut ctx,
        9,
        "JSON.stringify({t: document.title, leak: typeof frameVar, inner: document.getElementById('inner') === null, main: document.getElementById('mainDiv') !== null})",
        None,
        &sid,
    )
    .await
    .unwrap();
    let main_view: Value = serde_json::from_str(main_view.as_str().unwrap()).unwrap();
    assert_eq!(main_view["t"], json!("main"));
    assert_eq!(main_view["leak"], json!("undefined"));
    assert_eq!(main_view["inner"], json!(true));
    assert_eq!(main_view["main"], json!(true));
}

#[tokio::test(flavor = "current_thread")]
async fn stale_child_context_is_rejected_after_renavigation() {
    let (mut ctx, sid, _page_id, url) = setup().await;
    let (outer, _deep) = child_frame_ids(&mut ctx, &sid).await;
    let outer_ctx = default_context_id(&ctx, &outer);
    ctx.pending_events.clear();

    // Re-navigating the page detaches the old child frames and destroys
    // their contexts.
    cdp_ok(
        &mut ctx,
        10,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        &sid,
    )
    .await;

    let error = eval_value(&mut ctx, 11, "1 + 1", Some(outer_ctx), &sid)
        .await
        .expect_err("stale contextId must be rejected");
    assert!(
        error.contains("Cannot find context with specified id"),
        "Chrome-shaped rejection: {error}"
    );

    assert!(
        ctx.pending_events.iter().any(|e| {
            e.method == "Runtime.executionContextDestroyed"
                && e.params["executionContextId"] == outer_ctx
        }),
        "executionContextDestroyed must have been emitted for {outer_ctx}"
    );
    assert!(
        ctx.pending_events.iter().any(|e| {
            e.method == "Page.frameDetached"
                && e.params["frameId"] == outer
                && e.params["reason"] == "remove"
        }),
        "frameDetached must have been emitted for the old child frame"
    );

    // The re-navigated page advertises a fresh context that works.
    let (new_outer, _) = child_frame_ids(&mut ctx, &sid).await;
    let new_ctx_id = default_context_id(&ctx, &new_outer);
    assert_ne!(new_ctx_id, outer_ctx, "context ids are never reused");
    let title = eval_value(&mut ctx, 12, "document.title", Some(new_ctx_id), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("frame one"));
}

#[tokio::test(flavor = "current_thread")]
async fn call_function_on_and_get_properties_route_by_object_id() {
    let (mut ctx, sid, _page_id, _url) = setup().await;
    let (outer, deep) = child_frame_ids(&mut ctx, &sid).await;
    let outer_ctx = default_context_id(&ctx, &outer);
    let deep_ctx = default_context_id(&ctx, &deep);

    // A handle from the outer frame's world.
    let result = cdp_ok(
        &mut ctx,
        13,
        "Runtime.evaluate",
        json!({
            "expression": "[document.getElementById('inner'), 21]",
            "contextId": outer_ctx,
        }),
        &sid,
    )
    .await;
    let object_id = result["result"]["objectId"]
        .as_str()
        .expect("handle for the array")
        .to_string();

    // getProperties resolves in the owning world and annotates the node.
    let props = cdp_ok(
        &mut ctx,
        14,
        "Runtime.getProperties",
        json!({"objectId": object_id}),
        &sid,
    )
    .await;
    let items = props["result"].as_array().unwrap();
    let first = items.iter().find(|p| p["name"] == "0").expect("index 0");
    assert_eq!(first["value"]["subtype"], json!("node"));
    let node_oid = first["value"]["objectId"]
        .as_str()
        .expect("child handle for the node")
        .to_string();
    let second = items.iter().find(|p| p["name"] == "1").expect("index 1");
    assert_eq!(second["value"]["value"], json!(21));

    // callFunctionOn with only the objectId routes into the same world.
    let length = cdp_ok(
        &mut ctx,
        15,
        "Runtime.callFunctionOn",
        json!({
            "functionDeclaration": "function() { return this.length; }",
            "objectId": object_id,
            "returnByValue": true,
        }),
        &sid,
    )
    .await;
    assert_eq!(length["result"]["value"].as_f64(), Some(2.0));
    let text = cdp_ok(
        &mut ctx,
        16,
        "Runtime.callFunctionOn",
        json!({
            "functionDeclaration": "function() { return this.textContent; }",
            "objectId": node_oid,
            "returnByValue": true,
        }),
        &sid,
    )
    .await;
    assert_eq!(text["result"]["value"], json!("hello"));

    // A handle used against another frame's context is rejected.
    let error = cdp(
        &mut ctx,
        17,
        "Runtime.callFunctionOn",
        json!({
            "functionDeclaration": "function() { return 1; }",
            "objectId": object_id,
            "executionContextId": deep_ctx,
            "returnByValue": true,
        }),
        &sid,
    )
    .await
    .expect_err("cross-context objectId must be rejected");
    assert!(
        error.contains("different execution context"),
        "cross-context rejection: {error}"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn create_isolated_world_builds_a_real_child_world() {
    let (mut ctx, sid, _page_id, _url) = setup().await;
    let (outer, _deep) = child_frame_ids(&mut ctx, &sid).await;
    let outer_ctx = default_context_id(&ctx, &outer);

    let created = cdp_ok(
        &mut ctx,
        18,
        "Page.createIsolatedWorld",
        json!({"frameId": outer, "worldName": "__test_utility"}),
        &sid,
    )
    .await;
    let world_ctx = created["executionContextId"]
        .as_i64()
        .expect("world context id");
    assert!(ctx.valid_context_ids.contains(&world_ctx));
    let entry = ctx.execution_contexts.get(&world_ctx).expect("table entry");
    assert_eq!(entry.frame_id, outer);
    assert!(!entry.is_default);
    assert!(entry.world_id > 0);
    assert!(ctx.pending_events.iter().any(|e| {
        e.method == "Runtime.executionContextCreated"
            && e.params["context"]["id"] == world_ctx
            && e.params["context"]["auxData"]["type"] == "isolated"
            && e.params["context"]["auxData"]["frameId"] == outer
    }));

    // Same-named world of the same document returns the same context.
    let again = cdp_ok(
        &mut ctx,
        19,
        "Page.createIsolatedWorld",
        json!({"frameId": outer, "worldName": "__test_utility"}),
        &sid,
    )
    .await;
    assert_eq!(again["executionContextId"], json!(world_ctx));

    // Utility globals stay out of the frame's main world...
    eval_value(
        &mut ctx,
        20,
        "globalThis.__utility = 42",
        Some(world_ctx),
        &sid,
    )
    .await
    .unwrap();
    let leak = eval_value(&mut ctx, 21, "typeof __utility", Some(outer_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(leak, json!("undefined"), "utility world must not leak");
    let main_leak = eval_value(&mut ctx, 22, "typeof __utility", None, &sid)
        .await
        .unwrap();
    assert_eq!(main_leak, json!("undefined"), "main world must not leak");

    // ...while the isolated world reaches the same native DOM.
    let found = eval_value(
        &mut ctx,
        23,
        "document.getElementById('inner') ? document.getElementById('inner').textContent : 'missing'",
        Some(world_ctx),
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(found, json!("hello"));
}

#[tokio::test(flavor = "current_thread")]
async fn navigate_with_frame_id_navigates_a_single_frame() {
    let (mut ctx, sid, page_id, url) = setup().await;
    let (outer, _deep) = child_frame_ids(&mut ctx, &sid).await;
    let old_ctx_id = default_context_id(&ctx, &outer);
    let main_url_before = ctx.get_page(&page_id).unwrap().url_string();
    ctx.pending_events.clear();

    let frame_url = format!("{url}frame");
    let result = cdp_ok(
        &mut ctx,
        24,
        "Page.navigate",
        json!({"url": frame_url, "frameId": outer}),
        &sid,
    )
    .await;
    assert_eq!(result["frameId"], json!(outer));
    let loader_id = result["loaderId"].as_str().unwrap();
    assert!(!loader_id.is_empty());

    // The main frame did not navigate.
    assert_eq!(
        ctx.get_page(&page_id).unwrap().url_string(),
        main_url_before
    );

    // Single-frame lifecycle: no frameAttached (the frame was already
    // advertised), started -> navigated (new URL) -> stopped, and the old
    // document's context destroyed.
    assert!(!ctx
        .pending_events
        .iter()
        .any(|e| e.method == "Page.frameAttached" && e.params["frameId"] == outer));
    let navigated = ctx
        .pending_events
        .iter()
        .find(|e| e.method == "Page.frameNavigated" && e.params["frame"]["id"] == outer)
        .expect("child frameNavigated");
    assert_eq!(navigated.params["frame"]["url"], json!(frame_url));
    assert_eq!(navigated.params["frame"]["loaderId"], json!(loader_id));
    assert!(ctx
        .pending_events
        .iter()
        .any(|e| e.method == "Page.frameStartedLoading" && e.params["frameId"] == outer));
    assert!(ctx
        .pending_events
        .iter()
        .any(|e| e.method == "Page.frameStoppedLoading" && e.params["frameId"] == outer));
    assert!(ctx.pending_events.iter().any(|e| {
        e.method == "Runtime.executionContextDestroyed"
            && e.params["executionContextId"] == old_ctx_id
    }));

    // The navigated document's scripts ran in a fresh realm the new context
    // addresses; the old context is gone.
    let new_ctx_id = default_context_id(&ctx, &outer);
    assert_ne!(new_ctx_id, old_ctx_id);
    let value = eval_value(
        &mut ctx,
        25,
        "navvar + (document.getElementById('navdiv') ? 1 : 0)",
        Some(new_ctx_id),
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(value.as_f64(), Some(100.0), "frame script effects visible in its realm");
    let title = eval_value(&mut ctx, 26, "document.title", Some(new_ctx_id), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("navd"));
    let error = eval_value(&mut ctx, 27, "1", Some(old_ctx_id), &sid)
        .await
        .expect_err("old context must be rejected");
    assert!(error.contains("Cannot find context with specified id"));

    // A direct child-frame navigation must expose its real error response and
    // keep the response body under the request id seen by Network events.
    ctx.pending_events.clear();
    let missing_url = format!("{url}missing");
    let missing = cdp_ok(
        &mut ctx,
        29,
        "Page.navigate",
        json!({"url": missing_url, "frameId": outer}),
        &sid,
    )
    .await;
    let missing_loader = missing["loaderId"].as_str().unwrap();
    let response_event = ctx
        .pending_events
        .iter()
        .find(|event| {
            event.method == "Network.responseReceived"
                && event.params["frameId"] == outer
                && event.params["response"]["status"] == 404
        })
        .expect("child 404 response event");
    assert_eq!(response_event.params["loaderId"], json!(missing_loader));
    let request_id = response_event.params["requestId"]
        .as_str()
        .unwrap()
        .to_string();
    let body = cdp_ok(
        &mut ctx,
        30,
        "Network.getResponseBody",
        json!({"requestId": request_id}),
        &sid,
    )
    .await;
    assert_eq!(body["base64Encoded"], json!(false));
    assert!(body["body"].as_str().unwrap().contains("404"));

    // The main document still sees its own content.
    let main_title = eval_value(&mut ctx, 28, "document.title", None, &sid)
        .await
        .unwrap();
    assert_eq!(main_title, json!("main"));
}

// Phase 6.3: a frame with no <script> still needs a default execution
// context. Realms are created by frame script execution, so before this a
// purely static iframe (an ad, an embedded player, a plain include) appeared
// in the frame tree with no contextId at all and frame.evaluate() /
// frameLocator() had nothing to address.
#[tokio::test(flavor = "current_thread")]
async fn scriptless_frame_gets_a_default_context_when_runtime_enabled_first() {
    let (mut ctx, sid, _page_id) = setup_plain(true).await;
    let frame = only_child_frame_id(&mut ctx, &sid).await;
    let frame_ctx = default_context_id(&ctx, &frame);

    let title = eval_value(&mut ctx, 30, "document.title", Some(frame_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("plain frame"));
    let text = eval_value(
        &mut ctx,
        31,
        "document.getElementById('plain').textContent",
        Some(frame_ctx),
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(text, json!("static"));

    // The context addresses the frame, not the embedder.
    let main_title = eval_value(&mut ctx, 32, "document.title", None, &sid)
        .await
        .unwrap();
    assert_eq!(main_title, json!("plain host"));
}

// Runtime.enable after the navigation is the common client order (Playwright
// attaches, enables, then navigates, but a reconnect or a second session
// enables against an already-loaded page). Chrome replays the contexts that
// exist at enable time; so must the frame projection.
#[tokio::test(flavor = "current_thread")]
async fn runtime_enable_backfills_contexts_for_already_committed_frames() {
    let (mut ctx, sid, _page_id) = setup_plain(false).await;
    let frame = only_child_frame_id(&mut ctx, &sid).await;
    let frame_ctx = default_context_id(&ctx, &frame);

    let title = eval_value(&mut ctx, 33, "document.title", Some(frame_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("plain frame"));
}

// Zero-cost guard for the eager path: a client that only navigates and
// captures never enables the Runtime domain, and must not pay a realm
// bootstrap per frame. The scriptless page creates no realm on its own, so
// the realm list staying empty is the whole assertion.
#[tokio::test(flavor = "current_thread")]
async fn navigate_only_creates_the_frame_window_realm_without_advertising_it() {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let sid = "session-1";
    ctx.sessions.insert(sid.to_string(), page_id.clone());
    cdp_ok(
        &mut ctx,
        34,
        "Page.navigate",
        json!({"url": format!("{url}plain"), "waitUntil": "load"}),
        sid,
    )
    .await;

    // The frame is projected...
    let tree = cdp_ok(&mut ctx, 35, "Page.getFrameTree", json!({}), sid).await;
    assert!(tree["frameTree"]["childFrames"][0]["frame"]["id"].is_string());
    // The browsing context owns its Window realm even before Runtime.enable,
    // so contentWindow and author scripts have browser-like identity. CDP
    // still does not advertise an execution context until the client enables
    // Runtime, and no isolated utility realm is allocated speculatively.
    let realms = ctx
        .get_page(&page_id)
        .and_then(|page| page.js.as_ref())
        .map(|js| js.list_frame_realms())
        .expect("page runtime");
    assert_eq!(realms.len(), 1, "unexpected speculative realms: {realms:?}");
    assert_eq!(realms[0].2, obscura_js::realm::MAIN_WORLD);
    assert!(realms[0].3);
    assert!(
        ctx.execution_contexts
            .values()
            .all(|entry| entry.frame_id == page_id),
        "no child-frame context is advertised without Runtime.enable"
    );
}

// Risk row "Isolated worlds silently target the main frame": before this,
// Page.createIsolatedWorld on the main frame echoed the frame id back and
// every evaluation landed on the page's own global, so Playwright's utility
// world shared globals and prototypes with author script.
#[tokio::test(flavor = "current_thread")]
async fn create_isolated_world_builds_a_real_main_frame_world() {
    let (mut ctx, sid, page_id, _url) = setup().await;

    let created = cdp_ok(
        &mut ctx,
        40,
        "Page.createIsolatedWorld",
        json!({"frameId": page_id, "worldName": "__main_utility"}),
        &sid,
    )
    .await;
    let world_ctx = created["executionContextId"]
        .as_i64()
        .expect("world context id");
    assert!(ctx.valid_context_ids.contains(&world_ctx));
    let entry = ctx
        .execution_contexts
        .get(&world_ctx)
        .expect("main frame world must enter the execution-context table");
    assert_eq!(entry.frame_id, page_id);
    assert!(!entry.is_default);
    assert!(entry.world_id > 0);

    // Same-named world returns the same context, like Chrome.
    let again = cdp_ok(
        &mut ctx,
        41,
        "Page.createIsolatedWorld",
        json!({"frameId": page_id, "worldName": "__main_utility"}),
        &sid,
    )
    .await;
    assert_eq!(again["executionContextId"], json!(world_ctx));

    // Utility globals stay out of the page's main world...
    eval_value(&mut ctx, 42, "globalThis.__u = 42", Some(world_ctx), &sid)
        .await
        .unwrap();
    let leak = eval_value(&mut ctx, 43, "typeof __u", None, &sid)
        .await
        .unwrap();
    assert_eq!(leak, json!("undefined"), "utility world must not leak");
    // ...and the page's globals stay out of the utility world.
    eval_value(&mut ctx, 44, "globalThis.__pageOnly = 1", None, &sid)
        .await
        .unwrap();
    let reverse = eval_value(&mut ctx, 45, "typeof __pageOnly", Some(world_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(reverse, json!("undefined"));

    // Separate realms, not just separate variable scopes: marking the world's
    // Object constructor is invisible to the page's.
    eval_value(
        &mut ctx,
        46,
        "(function(){ Object.__worldMark = 'iso'; return typeof Object.__worldMark; })()",
        Some(world_ctx),
        &sid,
    )
    .await
    .unwrap();
    let ctor = eval_value(&mut ctx, 47, "typeof Object.__worldMark", None, &sid)
        .await
        .unwrap();
    assert_eq!(
        ctor,
        json!("undefined"),
        "the two worlds must have distinct Object constructors"
    );

    // The isolated world still reaches the same native main document.
    let text = eval_value(
        &mut ctx,
        48,
        "document.getElementById('mainDiv').textContent",
        Some(world_ctx),
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(text, json!("main content"));
    let title = eval_value(&mut ctx, 49, "document.title", Some(world_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("main"));

    // A mutation made in the world is visible to the page: same DOM, not a
    // copy.
    eval_value(
        &mut ctx,
        50,
        "(function(){ document.getElementById('mainDiv').textContent = 'from world'; return 1; })()",
        Some(world_ctx),
        &sid,
    )
    .await
    .unwrap();
    let seen = eval_value(
        &mut ctx,
        51,
        "document.getElementById('mainDiv').textContent",
        None,
        &sid,
    )
    .await
    .unwrap();
    assert_eq!(seen, json!("from world"));
}

// The world a client created has to keep addressing its own realm after a
// navigation re-creates its context, otherwise the utility world silently
// falls back to the page global exactly where Playwright uses it most.
#[tokio::test(flavor = "current_thread")]
async fn main_frame_world_stays_isolated_across_navigation() {
    let (mut ctx, sid, page_id, url) = setup().await;
    cdp_ok(
        &mut ctx,
        60,
        "Page.createIsolatedWorld",
        json!({"frameId": page_id, "worldName": "__main_utility"}),
        &sid,
    )
    .await;
    ctx.pending_events.clear();

    cdp_ok(
        &mut ctx,
        61,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        &sid,
    )
    .await;

    let world_ctx = ctx
        .pending_events
        .iter()
        .rev()
        .find_map(|e| {
            if e.method != "Runtime.executionContextCreated" {
                return None;
            }
            let context = &e.params["context"];
            (context["name"] == "__main_utility").then(|| context["id"].as_i64().unwrap())
        })
        .expect("the registered world is re-emitted after navigation");
    assert!(
        ctx.execution_contexts.contains_key(&world_ctx),
        "the re-emitted world must stay a real realm, not an echoed id"
    );

    eval_value(&mut ctx, 62, "globalThis.__afterNav = 7", Some(world_ctx), &sid)
        .await
        .unwrap();
    let leak = eval_value(&mut ctx, 63, "typeof __afterNav", None, &sid)
        .await
        .unwrap();
    assert_eq!(leak, json!("undefined"));
    let title = eval_value(&mut ctx, 64, "document.title", Some(world_ctx), &sid)
        .await
        .unwrap();
    assert_eq!(title, json!("main"), "the world binds the new document");
}

/// The engine's own globals must not be visible through window reflection, in
/// the main realm or a frame realm. Cloudflare's challenge payload enumerated
/// `o.__obscura_click_listener_hooked`, `o.__obscura_click_listener_seen` and
/// `o.__obscura_input_strategy` out of the widget frame's window and submitted
/// them. The click-listener flags and the embedder-installed policy are created
/// while the page runs, so the snapshot-time name list cannot cover them; the
/// reflection filter therefore matches the engine namespace by name.
#[tokio::test(flavor = "current_thread")]
async fn window_reflection_hides_engine_globals_in_every_realm() {
    let (mut ctx, sid, _page_id, _url) = setup().await;
    let (child, _nested) = child_frame_ids(&mut ctx, &sid).await;
    let child_context = default_context_id(&ctx, &child);
    // A name created after page init stands in for the strategy flags: it is
    // not in __obscura_hide_list, and before the fix it was enumerable.
    let expr = "(() => { globalThis.__obscura_late_probe = true; \
                return JSON.stringify(Object.getOwnPropertyNames(globalThis)\
                .filter(n => /obscura/i.test(n))); })()";
    let main = eval_value(&mut ctx, 3, expr, None, &sid).await.unwrap();
    assert_eq!(main, json!("[]"), "main realm window: {main}");
    let frame = eval_value(&mut ctx, 4, expr, Some(child_context), &sid)
        .await
        .unwrap();
    assert_eq!(frame, json!("[]"), "frame realm window: {frame}");
}
