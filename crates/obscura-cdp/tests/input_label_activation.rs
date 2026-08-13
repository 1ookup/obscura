#![cfg(feature = "render")]

//! A click inside a `<label>` must activate the label's control.
//!
//! Without this, a page that decorates a checkbox with its own markup and binds
//! the handler to the hidden `<input>` never sees the click at all -- the event
//! reaches the inner `<span>` and stops there.

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
        // Every box is absolutely positioned so a click coordinate names
        // exactly one element and the assertions cannot drift with layout.
        let body = r#"<!doctype html><html><head><style>
            html, body { margin: 0; }
            label { position: absolute; width: 300px; height: 60px; }
            .hit { position: absolute; left: 20px; top: 20px; width: 60px; height: 20px; }
            .ctl { position: absolute; left: 200px; top: 20px; }
            #wrap { left: 0; top: 0; }
            #forlabel { left: 0; top: 100px; }
            #btnlabel { left: 0; top: 200px; }
            #ext { position: absolute; left: 250px; top: 120px; }
            #selflabel { left: 0; top: 300px; }
          </style></head><body>
          <label id="wrap">
            <input id="cb" class="ctl" type="checkbox">
            <span id="inner" class="hit">click me</span>
          </label>

          <label id="forlabel" for="ext">
            <span id="forhit" class="hit">for me</span>
          </label>
          <input id="ext" type="checkbox">

          <label id="btnlabel">
            <input id="cb2" class="ctl" type="checkbox">
            <button id="btn" class="hit">btn</button>
          </label>

          <label id="selflabel">
            <input id="cb3" class="hit" type="checkbox">
          </label>

          <script>
            window.log = [];
            for (const id of ['cb', 'ext', 'cb2', 'cb3']) {
              document.getElementById(id).addEventListener(
                'click', () => window.log.push(id));
            }
            document.getElementById('btn').addEventListener(
              'click', () => window.log.push('btn'));
          </script>
        </body></html>"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });
    format!("http://{addr}/")
}

async fn cdp(ctx: &mut CdpContext, id: u64, method: &str, params: Value, session: &str) -> Value {
    let request = CdpRequest {
        id,
        method: method.to_string(),
        params,
        session_id: Some(session.to_string()),
    };
    let response = dispatch(&request, ctx).await;
    serde_json::to_value(response).unwrap()
}

async fn evaluate(ctx: &mut CdpContext, id: u64, expression: &str, session: &str) -> Value {
    let response = cdp(
        ctx,
        id,
        "Runtime.evaluate",
        json!({"expression": expression, "returnByValue": true}),
        session,
    )
    .await;
    response
}

async fn setup() -> (CdpContext, String) {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve_fixture().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session = "label-activation-session";
    ctx.sessions.insert(session.to_string(), page_id);
    cdp(
        &mut ctx,
        1,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        session,
    )
    .await;
    (ctx, session.to_string())
}

async fn click(ctx: &mut CdpContext, session: &str, id: u64, x: f64, y: f64) {
    cdp(
        ctx,
        id,
        "Input.dispatchMouseEvent",
        json!({"type": "mousePressed", "x": x, "y": y, "button": "left"}),
        session,
    )
    .await;
    cdp(
        ctx,
        id + 1,
        "Input.dispatchMouseEvent",
        json!({"type": "mouseReleased", "x": x, "y": y, "button": "left"}),
        session,
    )
    .await;
}

async fn state(ctx: &mut CdpContext, id: u64, session: &str) -> Value {
    let result = evaluate(
        ctx,
        id,
        // One line on purpose: obscura's Runtime.evaluate returns null for
        // some multi-line JSON.stringify forms.
        "(function(){return JSON.stringify({log:window.log,\
           cb:document.getElementById('cb').checked,\
           ext:document.getElementById('ext').checked,\
           cb2:document.getElementById('cb2').checked,\
           cb3:document.getElementById('cb3').checked});})()",
        session,
    )
    .await;
    let raw = result["result"]["result"]["value"]
        .as_str()
        .expect("state evaluate returned no value");
    serde_json::from_str(raw).unwrap()
}

#[tokio::test]
async fn clicking_inside_a_label_activates_its_nested_control() {
    let (mut ctx, session) = setup().await;
    click(&mut ctx, &session, 10, 40.0, 28.0).await;
    let state = state(&mut ctx, 20, &session).await;
    assert_eq!(
        state["log"].as_array().unwrap(),
        &vec![Value::from("cb")],
        "the label's checkbox should have received exactly one click"
    );
    assert_eq!(state["cb"], Value::Bool(true), "checkedness should have flipped");
}

#[tokio::test]
async fn clicking_inside_a_for_label_activates_the_referenced_control() {
    let (mut ctx, session) = setup().await;
    click(&mut ctx, &session, 10, 40.0, 128.0).await;
    let state = state(&mut ctx, 20, &session).await;
    assert_eq!(state["log"].as_array().unwrap(), &vec![Value::from("ext")]);
    assert_eq!(state["ext"], Value::Bool(true));
}

#[tokio::test]
async fn interactive_content_inside_a_label_does_not_forward() {
    let (mut ctx, session) = setup().await;
    click(&mut ctx, &session, 10, 40.0, 228.0).await;
    let state = state(&mut ctx, 20, &session).await;
    assert_eq!(
        state["log"].as_array().unwrap(),
        &vec![Value::from("btn")],
        "a button inside the label handles its own click; the checkbox stays out of it"
    );
    assert_eq!(state["cb2"], Value::Bool(false));
}

#[tokio::test]
async fn clicking_the_control_itself_activates_it_once() {
    let (mut ctx, session) = setup().await;
    click(&mut ctx, &session, 10, 30.0, 328.0).await;
    let state = state(&mut ctx, 20, &session).await;
    assert_eq!(
        state["log"].as_array().unwrap(),
        &vec![Value::from("cb3")],
        "the control must not be activated a second time by its own label"
    );
    assert_eq!(state["cb3"], Value::Bool(true));
}
