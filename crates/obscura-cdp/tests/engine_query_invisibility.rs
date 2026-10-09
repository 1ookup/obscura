#![cfg(feature = "render")]

// Engine-internal DOM work must not surface through the page-visible
// querySelector/querySelectorAll prototypes. Cloudflare's ov2 program wraps
// those methods and records every selector it sees into the payload's
// selector log (the GOxN9 key); before this was fixed, one synthetic click
// logged 'input,button,select,textarea' three times (label resolution in the
// CDP input path) and a single elementFromPoint logged '*'.

use obscura_cdp::dispatch::{dispatch, CdpContext};
use obscura_cdp::types::CdpRequest;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

async fn serve_fixture() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 2048];
        let _ = socket.read(&mut buf).await.unwrap();
        let body = r#"<!doctype html><html><head><style>
            html, body { margin: 0; }
            #label { position: absolute; left: 40px; top: 40px; width: 120px; height: 40px; }
            #overlay { position: absolute; left: 40px; top: 40px; width: 120px; height: 40px; }
            input[type=checkbox] { position: absolute; left: 40px; top: 40px; width: 120px; height: 40px; }
            #v { position: absolute; left: 40px; top: 300px; }
        </style></head><body>
          <form id="f">
            <label id="label"><input id="check" type="checkbox"><span id="overlay" aria-hidden="true"></span></label>
            <input id="field" name="q">
          </form>
          <video id="v"></video>
        </body></html>"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
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
async fn engine_internal_queries_are_invisible_to_page_hooks() {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve_fixture().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session_id = "query-invisibility-session";
    ctx.sessions.insert(session_id.to_string(), page_id);
    cdp(
        &mut ctx,
        1,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        session_id,
    )
    .await;

    // Wrap every querySelector-family prototype the way page instrumentation
    // (ov2's selector log) does. Any engine-internal routing through these
    // surfaces shows up in the counter.
    let install = r#"(function() {
        globalThis.__qcount = 0;
        var wrap = function(holder, name) {
            var native = holder[name];
            holder[name] = function() { globalThis.__qcount++; return native.apply(this, arguments); };
        };
        wrap(Element.prototype, 'querySelector');
        wrap(Element.prototype, 'querySelectorAll');
        wrap(Document.prototype, 'querySelector');
        wrap(Document.prototype, 'querySelectorAll');
        return 'installed';
    })()"#;
    assert_eq!(evaluate(&mut ctx, 2, install, session_id).await, "installed");

    // A full synthetic click (move, press, release) through the aria-hidden
    // overlay: the label-control resolution used to query through the public
    // prototype once per phase. The click point is the overlay's own center
    // so the test does not depend on default margins around the form.
    let center = r#"(function() {
        var r = document.getElementById('overlay').getBoundingClientRect();
        return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]);
    })()"#;
    let center = evaluate(&mut ctx, 3, center, session_id).await;
    let center: serde_json::Value = serde_json::from_str(center.as_str().unwrap()).unwrap();
    let (cx, cy) = (center[0].as_f64().unwrap(), center[1].as_f64().unwrap());
    for (i, event_type) in ["mouseMoved", "mousePressed", "mouseReleased"].iter().enumerate() {
        cdp(
            &mut ctx,
            4 + i as u64,
            "Input.dispatchMouseEvent",
            json!({"type": event_type, "x": cx, "y": cy, "button": "left", "clickCount": 1}),
            session_id,
        )
        .await;
    }
    // The label resolution still has to work: the click lands on the overlay
    // and forwards to the checkbox inside the label.
    let hit = r#"(function() {
        var t = globalThis[Symbol.for('obscura.inputClickTarget')];
        return JSON.stringify({resolved: t ? (t.id || t.tagName) : null});
    })()"#;
    let hit_out = evaluate(&mut ctx, 9, hit, session_id).await;
    let clicked = evaluate(&mut ctx, 10, "document.getElementById('check').checked", session_id).await;
    assert_eq!(clicked, json!(true), "label control resolution must survive (resolved target: {hit_out})");

    // Public DOM APIs whose implementations used to route through the public
    // querySelector: elementFromPoint, getElementsByTagNameNS, form.elements,
    // media textTracks.
    let probes = r#"(function() {
        var ef = document.elementFromPoint(arguments[0], arguments[1]);
        var tags = document.getElementsByTagNameNS('*', '*').length;
        var fields = document.getElementById('f').elements.length;
        var tracks = document.getElementById('v').textTracks.length;
        return JSON.stringify([!!ef, tags > 2, fields === 2, tracks === 0]);
    })()"#.replace("arguments[0]", &cx.to_string()).replace("arguments[1]", &cy.to_string());
    let probed = evaluate(&mut ctx, 11, &probes, session_id).await;
    assert_eq!(probed, json!(r#"[true,true,true,true]"#), "probes must answer correctly");

    let count = evaluate(&mut ctx, 12, "globalThis.__qcount", session_id).await;
    assert_eq!(count.as_f64(), Some(0.0), "engine-internal work leaked a querySelector call");
}
