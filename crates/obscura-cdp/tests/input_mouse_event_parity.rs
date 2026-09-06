#![cfg(feature = "render")]

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
            #page { width: 1800px; height: 2400px; }
            #box { position: absolute; left: 20px; top: 20px; width: 180px;
                   height: 120px; overflow: auto; border: 10px solid black; }
            #inner { width: 700px; height: 800px; }
        </style></head><body>
          <div id="page"></div>
          <div id="box"><div id="inner"></div></div>
          <input id="check" type="checkbox">
          <form id="radio-form">
            <input id="radio-a" type="radio" name="choice" checked>
            <input id="radio-b" type="radio" name="choice">
          </form>
        </body></html>"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });
    format!("http://{addr}/")
}

async fn serve_iframe_fixture() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let length = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..length]);
            let path = request.split_whitespace().nth(1).unwrap_or("/");
            let body = match path {
                "/child" => r#"<!doctype html><style>
                    html,body { margin:0; width:100%; height:100%; }
                    #child { position:absolute; left:20px; top:30px; width:100px; height:50px; }
                    #nested { position:absolute; left:150px; top:20px; width:100px; height:80px; border:5px solid black; }
                    </style><button id=child>child</button><input id=field><iframe id=nested src=/grand></iframe>
                <script>globalThis.childLog=[];globalThis.childWheel=[]; child.addEventListener('click',e=>{childLog.push([e.clientX,e.clientY,e.screenX,e.screenY,globalThis===window]);field.focus()});child.addEventListener('wheel',e=>{childWheel.push([e.clientX,e.clientY,e.deltaY,globalThis===window]);e.preventDefault()});</script>"#,
                "/grand" => r#"<!doctype html><style>html,body{margin:0}#grand{position:absolute;left:10px;top:10px;width:60px;height:30px}</style>
                    <button id=grand>grand</button><script>globalThis.grandLog=[];grand.addEventListener('click',e=>grandLog.push([e.clientX,e.clientY,globalThis===window]));</script>"#,
                _ => r#"<!doctype html><style>
                    html,body { margin:0; }
                    #clip { position:absolute; left:100px; top:80px; width:300px; height:120px; overflow:hidden; }
                    #frame { display:block; width:300px; height:200px; border:10px solid black; }
                </style><div id=clip><iframe id=frame src=/child></iframe></div>"#,
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
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
}

async fn setup() -> (CdpContext, String) {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve_fixture().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session_id = "input-mouse-session";
    ctx.sessions.insert(session_id.to_string(), page_id);
    cdp(
        &mut ctx,
        1,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        session_id,
    )
    .await;
    (ctx, session_id.to_string())
}

async fn setup_iframe() -> (CdpContext, String) {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let url = serve_iframe_fixture().await;
    let mut ctx = CdpContext::new();
    let page_id = ctx.create_page();
    let session_id = "input-iframe-session";
    ctx.sessions.insert(session_id.to_string(), page_id);
    cdp(
        &mut ctx,
        1,
        "Page.navigate",
        json!({"url": url, "waitUntil": "load"}),
        session_id,
    )
    .await;
    (ctx, session_id.to_string())
}

async fn click(ctx: &mut CdpContext, sid: &str, x: f64, y: f64) {
    cdp(
        ctx,
        80,
        "Input.dispatchMouseEvent",
        json!({"type":"mousePressed","x":x,"y":y,"button":"left"}),
        sid,
    )
    .await;
    cdp(
        ctx,
        81,
        "Input.dispatchMouseEvent",
        json!({"type":"mouseReleased","x":x,"y":y,"button":"left"}),
        sid,
    )
    .await;
}

async fn wheel(ctx: &mut CdpContext, id: u64, sid: &str, x: f64, y: f64, dx: f64, dy: f64) {
    cdp(
        ctx,
        id,
        "Input.dispatchMouseEvent",
        json!({"type": "mouseWheel", "x": x, "y": y, "deltaX": dx, "deltaY": dy}),
        sid,
    )
    .await;
}

async fn scroll_state(ctx: &mut CdpContext, id: u64, sid: &str) -> Value {
    let result = evaluate(
        ctx,
        id,
        r#"JSON.stringify({
            rootX: scrollX, rootY: scrollY,
            boxX: document.getElementById('box').scrollLeft,
            boxY: document.getElementById('box').scrollTop,
            rootScrollWidth: document.scrollingElement.scrollWidth,
            rootClientWidth: document.scrollingElement.clientWidth,
            pageRect: document.getElementById('page').getBoundingClientRect().toJSON(),
            maxBoxX: document.getElementById('box').scrollWidth - document.getElementById('box').clientWidth,
            maxBoxY: document.getElementById('box').scrollHeight - document.getElementById('box').clientHeight
        })"#,
        sid,
    )
    .await;
    serde_json::from_str(result["result"]["value"].as_str().unwrap()).unwrap()
}

#[tokio::test(flavor = "current_thread")]
async fn wheel_over_page_scrolls_the_root_on_both_axes() {
    let (mut ctx, sid) = setup().await;
    wheel(&mut ctx, 2, &sid, 600.0, 300.0, 45.0, 160.0).await;
    let state = scroll_state(&mut ctx, 3, &sid).await;
    assert_eq!(state["rootX"], 45.0, "unexpected root geometry: {state}");
    assert_eq!(state["rootY"], 160.0);
    assert_eq!(state["boxX"], 0.0);
    assert_eq!(state["boxY"], 0.0);
}

#[tokio::test(flavor = "current_thread")]
async fn wheel_over_nested_overflow_scrolls_the_nested_container() {
    let (mut ctx, sid) = setup().await;
    wheel(&mut ctx, 2, &sid, 50.0, 50.0, 70.0, 110.0).await;
    let state = scroll_state(&mut ctx, 3, &sid).await;
    assert_eq!(state["boxX"], 70.0);
    assert_eq!(state["boxY"], 110.0);
    assert_eq!(state["rootX"], 0.0, "nested wheel must not leak to the viewport");
    assert_eq!(state["rootY"], 0.0, "nested wheel must not leak to the viewport");
}

#[tokio::test(flavor = "current_thread")]
async fn wheel_offsets_clamp_to_nested_scroll_extents() {
    let (mut ctx, sid) = setup().await;
    wheel(&mut ctx, 2, &sid, 50.0, 50.0, 100_000.0, 100_000.0).await;
    let state = scroll_state(&mut ctx, 3, &sid).await;
    assert_eq!(state["boxX"], state["maxBoxX"]);
    assert_eq!(state["boxY"], state["maxBoxY"]);

    wheel(&mut ctx, 4, &sid, 50.0, 50.0, -100_000.0, -100_000.0).await;
    let state = scroll_state(&mut ctx, 5, &sid).await;
    assert_eq!(state["boxX"], 0.0);
    assert_eq!(state["boxY"], 0.0);
}

#[tokio::test(flavor = "current_thread")]
async fn wheel_chains_to_root_when_nested_scroller_is_saturated() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        "(() => { const box = document.getElementById('box'); box.scrollTop = box.scrollHeight; })()",
        &sid,
    )
    .await;
    let saturated = scroll_state(&mut ctx, 3, &sid).await;
    assert_eq!(saturated["boxY"], saturated["maxBoxY"]);

    wheel(&mut ctx, 4, &sid, 50.0, 50.0, 0.0, 90.0).await;
    let state = scroll_state(&mut ctx, 5, &sid).await;
    assert_eq!(state["boxY"], state["maxBoxY"], "inner remains clamped");
    assert_eq!(state["rootY"], 90.0, "remaining wheel gesture chains to the viewport");
}

#[tokio::test(flavor = "current_thread")]
async fn canceling_wheel_prevents_its_scroll_default() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            globalThis.wheelProbe = null;
            const page = document.getElementById('page');
            document.elementFromPoint = () => page;
            page.addEventListener('wheel', event => {
                wheelProbe = {
                    x: event.clientX, y: event.clientY,
                    dx: event.deltaX, dy: event.deltaY,
                    ctrl: event.ctrlKey, trusted: event.isTrusted
                };
                event.preventDefault();
            });
        })()"#,
        &sid,
    )
    .await;
    cdp(
        &mut ctx,
        3,
        "Input.dispatchMouseEvent",
        json!({
            "type": "mouseWheel", "x": 600.0, "y": 300.0,
            "deltaX": 25.0, "deltaY": 75.0, "modifiers": 2
        }),
        &sid,
    )
    .await;
    let state = scroll_state(&mut ctx, 4, &sid).await;
    assert_eq!(state["rootX"], 0.0);
    assert_eq!(state["rootY"], 0.0);
    let probe = evaluate(&mut ctx, 5, "JSON.stringify(wheelProbe)", &sid).await;
    let probe: Value = serde_json::from_str(probe["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(probe["x"], 600.0);
    assert_eq!(probe["y"], 300.0);
    assert_eq!(probe["dx"], 25.0);
    assert_eq!(probe["dy"], 75.0);
    assert_eq!(probe["ctrl"], true);
    assert_eq!(probe["trusted"], true);
}

#[tokio::test(flavor = "current_thread")]
async fn hit_testing_clips_scrolled_children_at_overflow_padding_edge() {
    let (mut ctx, sid) = setup().await;
    let result = evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const box = document.getElementById('box');
            box.scrollLeft = 50;
            const inner = document.getElementById('inner').getBoundingClientRect();
            return JSON.stringify({
                hit: document.elementFromPoint(25, 50).id,
                innerLeft: inner.left, innerRight: inner.right,
                boxLeft: box.getBoundingClientRect().left
            });
        })()"#,
        &sid,
    )
    .await;
    let result: Value = serde_json::from_str(result["result"]["value"].as_str().unwrap()).unwrap();
    assert!(result["innerLeft"].as_f64().unwrap() <= 25.0);
    assert!(result["innerRight"].as_f64().unwrap() >= 25.0);
    assert_eq!(result["boxLeft"], 20.0);
    assert_eq!(result["hit"], "box", "content hidden behind the border cannot win hit testing");
}

#[tokio::test(flavor = "current_thread")]
async fn press_release_orders_events_and_defers_click_activation() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            document.elementFromPoint = () => target;
            globalThis.mouseLog = [];
            for (const type of ['mousedown', 'focus', 'mouseup', 'click', 'input', 'change']) {
                target.addEventListener(type, event => mouseLog.push({
                    type, checked: target.checked, x: event.clientX,
                    ctrl: event.ctrlKey, shift: event.shiftKey, trusted: event.isTrusted
                }));
            }
        })()"#,
        &sid,
    )
    .await;

    cdp(
        &mut ctx,
        3,
        "Input.dispatchMouseEvent",
        json!({
            "type": "mousePressed", "x": 31.0, "y": 42.0,
            "button": "left", "clickCount": 1, "modifiers": 10
        }),
        &sid,
    )
    .await;
    let pressed = evaluate(
        &mut ctx,
        4,
        "JSON.stringify({log: mouseLog, checked: document.getElementById('check').checked})",
        &sid,
    )
    .await;
    let pressed: Value = serde_json::from_str(pressed["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(pressed["checked"], false, "checkbox activation must wait for release");
    assert_eq!(pressed["log"][0]["type"], "mousedown");
    assert_eq!(pressed["log"].as_array().unwrap().len(), 2, "press must not synthesize click");

    cdp(
        &mut ctx,
        5,
        "Input.dispatchMouseEvent",
        json!({
            "type": "mouseReleased", "x": 31.0, "y": 42.0,
            "button": "left", "clickCount": 1, "modifiers": 10
        }),
        &sid,
    )
    .await;
    let released = evaluate(
        &mut ctx,
        6,
        "JSON.stringify({log: mouseLog, checked: document.getElementById('check').checked})",
        &sid,
    )
    .await;
    let released: Value = serde_json::from_str(released["result"]["value"].as_str().unwrap()).unwrap();
    let types: Vec<&str> = released["log"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["type"].as_str().unwrap())
        .collect();
    assert_eq!(types, ["mousedown", "focus", "mouseup", "click", "input", "change"]);
    assert_eq!(released["checked"], true);
    assert_eq!(released["log"][3]["checked"], true, "click sees checkbox pre-activation");
    assert_eq!(released["log"][3]["x"], 31.0);
    assert_eq!(released["log"][3]["ctrl"], true);
    assert_eq!(released["log"][3]["shift"], true);
    assert_eq!(released["log"][3]["trusted"], true);
}

#[tokio::test(flavor = "current_thread")]
async fn click_dispatches_pointer_events_with_pointer_metadata_and_composed() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            document.elementFromPoint = () => target;
            globalThis.pLog = [];
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                target.addEventListener(type, event => pLog.push({
                    type, pointerType: event.pointerType, pointerId: event.pointerId,
                    composed: event.composed, x: event.clientX, trusted: event.isTrusted,
                    altitude: event.altitudeAngle, azimuth: event.azimuthAngle,
                    movement: [event.movementX, event.movementY],
                    offset: [event.offsetX, event.offsetY],
                    layer: [event.layerX, event.layerY],
                    expectedOffset: (() => { const r = target.getBoundingClientRect();
                        return [event.clientX - r.left, event.clientY - r.top]; })(),
                    predicted: event.getPredictedEvents?.().length,
                    coalesced: event.getCoalescedEvents?.().length,
                    own: Object.getOwnPropertyNames(event)
                }));
            }
        })()"#,
        &sid,
    )
    .await;

    click(&mut ctx, &sid, 31.0, 42.0).await;

    let out = evaluate(&mut ctx, 3, "JSON.stringify(pLog)", &sid).await;
    let out: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    let types: Vec<&str> = out
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        types,
        ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]
    );
    assert_eq!(out[0]["pointerType"], "mouse");
    assert_eq!(out[0]["pointerId"], 1);
    assert_eq!(out[0]["composed"], true, "pointer events must compose across shadow boundaries");
    assert_eq!(out[0]["x"], 31.0);
    assert_eq!(out[0]["trusted"], true);
    assert_eq!(out[0]["altitude"], std::f64::consts::FRAC_PI_2);
    assert_eq!(out[0]["azimuth"], 0.0);
    assert_eq!(out[0]["movement"], json!([0, 0]));
    assert_eq!(out[0]["offset"], out[0]["expectedOffset"]);
    assert_eq!(out[0]["layer"], out[0]["expectedOffset"]);
    assert_eq!(out[0]["predicted"], 0);
    assert_eq!(out[0]["coalesced"], 0);
    assert_eq!(out[0]["own"], json!(["isTrusted"]));
    assert_eq!(out[4]["composed"], true, "click must compose across shadow boundaries");
    assert_eq!(out[4]["pointerType"], "mouse", "CDP click is a PointerEvent in Chrome");
    assert_eq!(out[4]["pointerId"], 1);
    assert_eq!(out[4]["altitude"], std::f64::consts::FRAC_PI_2);
    assert_eq!(out[4]["azimuth"], 0.0);
    let leaked = evaluate(
        &mut ctx,
        4,
        "JSON.stringify(Object.getOwnPropertyNames(globalThis).filter(name => ['__obscura_focused','__obscura_click_target','__obscura_hover_target','__obscura_mouse_down'].includes(name)))",
        &sid,
    )
    .await;
    assert_eq!(leaked["result"]["value"], "[]");
}

#[tokio::test(flavor = "current_thread")]
async fn mouse_moved_dispatches_pointer_and_mouse_move_events() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            document.elementFromPoint = () => target;
            globalThis.mLog = [];
            for (const type of ['pointerover','pointerenter','pointermove','mouseover','mouseenter','mousemove']) {
                target.addEventListener(type, e => mLog.push({ type, composed: e.composed, x: e.clientX, trusted: e.isTrusted }));
            }
        })()"#,
        &sid,
    )
    .await;

    cdp(
        &mut ctx,
        3,
        "Input.dispatchMouseEvent",
        json!({"type": "mouseMoved", "x": 31.0, "y": 42.0}),
        &sid,
    )
    .await;

    let out = evaluate(&mut ctx, 4, "JSON.stringify(mLog)", &sid).await;
    let out: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    let types: Vec<&str> = out
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        types,
        ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]
    );
    let pointer_move = out
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["type"] == "pointermove")
        .unwrap();
    assert_eq!(pointer_move["x"], 31.0);
    assert_eq!(pointer_move["trusted"], true);
    assert_eq!(pointer_move["composed"], true, "pointermove must compose across shadow boundaries");
}

#[tokio::test(flavor = "current_thread")]
async fn consecutive_mouse_moves_only_cross_boundaries_when_the_target_changes() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const a = document.getElementById('check');
            const b = document.getElementById('radio-b');
            document.elementFromPoint = x => x < 50 ? a : b;
            globalThis.hoverLog = [];
            const types = [
                'pointerover','mouseover','pointerenter','mouseenter',
                'pointermove','mousemove','pointerout','mouseout',
                'pointerleave','mouseleave'
            ];
            for (const node of [a, b]) for (const type of types) {
                node.addEventListener(type, event => hoverLog.push({
                    node: node.id, type,
                    related: event.relatedTarget && event.relatedTarget.id,
                    x: event.clientX, trusted: event.isTrusted
                }));
            }
        })()"#,
        &sid,
    )
    .await;

    for (id, x) in [(3, 20.0), (4, 30.0), (5, 80.0)] {
        cdp(
            &mut ctx,
            id,
            "Input.dispatchMouseEvent",
            json!({"type": "mouseMoved", "x": x, "y": 10.0}),
            &sid,
        )
        .await;
    }

    let out = evaluate(&mut ctx, 6, "JSON.stringify(hoverLog)", &sid).await;
    let out: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    let events: Vec<String> = out
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| format!("{}:{}", entry["node"].as_str().unwrap(), entry["type"].as_str().unwrap()))
        .collect();
    assert_eq!(
        events,
        [
            "check:pointerover", "check:pointerenter", "check:mouseover", "check:mouseenter",
            "check:pointermove", "check:mousemove",
            "check:pointermove", "check:mousemove",
            "check:pointerout", "check:pointerleave",
            "radio-b:pointerover", "radio-b:pointerenter",
            "check:mouseout", "check:mouseleave",
            "radio-b:mouseover", "radio-b:mouseenter",
            "radio-b:pointermove", "radio-b:mousemove",
        ]
    );
    for entry in &out.as_array().unwrap()[8..16] {
        let expected = if entry["node"] == "check" { "radio-b" } else { "check" };
        assert_eq!(entry["related"], expected, "boundary event needs the opposite target: {entry}");
        assert_eq!(entry["trusted"], true);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn canceling_primary_pointerdown_suppresses_compatibility_mouse_events() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            document.elementFromPoint = () => target;
            globalThis.cancelledPointerLog = [];
            for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','input','change']) {
                target.addEventListener(type, event => {
                    cancelledPointerLog.push(type);
                    if (type === 'pointerdown') event.preventDefault();
                });
            }
        })()"#,
        &sid,
    )
    .await;

    click(&mut ctx, &sid, 31.0, 42.0).await;

    let out = evaluate(
        &mut ctx,
        3,
        "JSON.stringify({events:cancelledPointerLog,checked:document.getElementById('check').checked})",
        &sid,
    )
    .await;
    let out: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(
        out["events"],
        json!(["pointerdown", "pointerup", "click", "input", "change"])
    );
    assert_eq!(
        out["checked"],
        true,
        "click is not a compatibility mouse event and must still activate"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn disabled_checkable_does_not_activate_on_cdp_click() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            target.disabled = true;
            document.elementFromPoint = () => target;
            globalThis.disabledClickLog = [];
            for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','input','change']) {
                target.addEventListener(type, () => disabledClickLog.push(type));
            }
        })()"#,
        &sid,
    )
    .await;

    click(&mut ctx, &sid, 31.0, 42.0).await;

    let out = evaluate(
        &mut ctx,
        3,
        "JSON.stringify({events:disabledClickLog,checked:check.checked})",
        &sid,
    )
    .await;
    let out: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(out, json!({"events": ["pointerdown", "pointerup"], "checked": false}));
}

#[tokio::test(flavor = "current_thread")]
async fn constructed_pointer_event_defaults_to_an_empty_pointer_type() {
    let (mut ctx, sid) = setup().await;
    let out = evaluate(
        &mut ctx,
        2,
        "JSON.stringify({omitted:new PointerEvent('x').pointerType,empty:new PointerEvent('x',{pointerType:''}).pointerType,explicit:new PointerEvent('x',{pointerType:'pen'}).pointerType})",
        &sid,
    )
    .await;
    let out: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(out, json!({"omitted":"","empty":"","explicit":"pen"}));
}

#[tokio::test(flavor = "current_thread")]
async fn radio_release_selects_only_the_target_in_its_group() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const a = document.getElementById('radio-a');
            const b = document.getElementById('radio-b');
            document.elementFromPoint = () => b;
            globalThis.radioEvents = [];
            for (const radio of [a, b]) {
                for (const type of ['mousedown', 'mouseup', 'click', 'input', 'change']) {
                    radio.addEventListener(type, () => radioEvents.push(radio.id + ':' + type));
                }
            }
        })()"#,
        &sid,
    )
    .await;
    cdp(
        &mut ctx,
        3,
        "Input.dispatchMouseEvent",
        json!({"type": "mousePressed", "x": 10.0, "y": 10.0, "button": "left"}),
        &sid,
    )
    .await;
    cdp(
        &mut ctx,
        4,
        "Input.dispatchMouseEvent",
        json!({"type": "mouseReleased", "x": 10.0, "y": 10.0, "button": "left"}),
        &sid,
    )
    .await;
    let result = evaluate(
        &mut ctx,
        5,
        "JSON.stringify({a: document.getElementById('radio-a').checked, b: document.getElementById('radio-b').checked, events: radioEvents})",
        &sid,
    )
    .await;
    let result: Value = serde_json::from_str(result["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(result["a"], false);
    assert_eq!(result["b"], true);
    assert_eq!(
        result["events"],
        json!(["radio-b:mousedown", "radio-b:mouseup", "radio-b:click", "radio-b:input", "radio-b:change"]),
        "the newly selected radio alone receives activation events"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn mouse_events_enter_iframe_realm_with_local_client_coordinates() {
    let (mut ctx, sid) = setup_iframe().await;
    // Parent content origin (110,90), child button point (30,40).
    click(&mut ctx, &sid, 140.0, 130.0).await;
    let result = evaluate(
        &mut ctx,
        82,
        "JSON.stringify(document.getElementById('frame').contentWindow.childLog)",
        &sid,
    )
    .await;
    let log: Value = serde_json::from_str(result["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(log, json!([[30, 40, 140, 130, true]]));

    cdp(
        &mut ctx,
        83,
        "Input.dispatchKeyEvent",
        json!({"type":"char","text":"x"}),
        &sid,
    )
    .await;
    let typed = evaluate(
        &mut ctx,
        84,
        "document.getElementById('frame').contentWindow.document.getElementById('field').value",
        &sid,
    )
    .await;
    assert_eq!(typed["result"]["value"], "x");

    wheel(&mut ctx, 85, &sid, 140.0, 130.0, 0.0, 25.0).await;
    let wheel_result = evaluate(
        &mut ctx,
        86,
        "JSON.stringify(document.getElementById('frame').contentWindow.childWheel)",
        &sid,
    )
    .await;
    let wheel_log: Value = serde_json::from_str(
        wheel_result["result"]["value"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(wheel_log, json!([[30, 40, 25, true]]));
}

#[tokio::test(flavor = "current_thread")]
async fn mouse_events_descend_through_nested_iframes() {
    let (mut ctx, sid) = setup_iframe().await;
    // Parent content origin (110,90), nested content origin in child
    // (155,25), grandchild button point (15,15).
    click(&mut ctx, &sid, 280.0, 130.0).await;
    let result = evaluate(
        &mut ctx,
        82,
        "JSON.stringify(document.getElementById('frame').contentWindow.document.getElementById('nested').contentWindow.grandLog)",
        &sid,
    )
    .await;
    let log: Value = serde_json::from_str(result["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(log, json!([[15, 15, true]]));
}

#[tokio::test(flavor = "current_thread")]
async fn clipped_iframe_content_does_not_receive_mouse_events() {
    let (mut ctx, sid) = setup_iframe().await;
    // This lies in the iframe's own content box but beyond #clip's right edge.
    click(&mut ctx, &sid, 415.0, 160.0).await;
    let result = evaluate(
        &mut ctx,
        82,
        "JSON.stringify(document.getElementById('frame').contentWindow.childLog)",
        &sid,
    )
    .await;
    let log: Value = serde_json::from_str(result["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(log, json!([]));
}

#[tokio::test(flavor = "current_thread")]
async fn click_pointer_ids_increment_per_activation_and_pair_within_a_cycle() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            document.elementFromPoint = () => target;
            globalThis.pidLog = [];
            for (const type of ['pointerdown', 'pointerup']) {
                target.addEventListener(type, e => pidLog.push([type, e.pointerId]));
            }
        })()"#,
        &sid,
    )
    .await;

    click(&mut ctx, &sid, 31.0, 42.0).await;
    click(&mut ctx, &sid, 31.0, 42.0).await;

    let out = evaluate(&mut ctx, 3, "JSON.stringify(pidLog)", &sid).await;
    let log: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(
        log,
        json!([["pointerdown", 1], ["pointerup", 1], ["pointerdown", 2], ["pointerup", 2]]),
        "each press cycle mints a fresh pointerId shared by its down/up pair: {log}"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn trusted_input_events_carry_mouse_source_capabilities() {
    let (mut ctx, sid) = setup().await;
    evaluate(
        &mut ctx,
        2,
        r#"(() => {
            const target = document.getElementById('check');
            document.elementFromPoint = () => target;
            globalThis.capsLog = [];
            for (const type of ['mousedown', 'click']) {
                target.addEventListener(type, e => capsLog.push(
                    e.sourceCapabilities instanceof InputDeviceCapabilities
                        ? ['caps', e.sourceCapabilities.firesTouchEvents]
                        : ['bare', String(e.sourceCapabilities)]));
            }
        })()"#,
        &sid,
    )
    .await;

    click(&mut ctx, &sid, 31.0, 42.0).await;

    let out = evaluate(&mut ctx, 3, "JSON.stringify(capsLog)", &sid).await;
    let log: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(
        log,
        json!([["caps", false], ["caps", false]]),
        "CDP mouse input reports a mouse InputDeviceCapabilities: {log}"
    );

    let out = evaluate(
        &mut ctx,
        4,
        r#"JSON.stringify({
            scriptMouseEventIsNull: new MouseEvent('click').sourceCapabilities === null,
            scriptEventIsUndefined: new Event('x').sourceCapabilities === undefined,
            scriptKeyEventIsNull: new KeyboardEvent('keydown').sourceCapabilities === null,
            ctorIsFunction: typeof InputDeviceCapabilities === 'function',
            ctorName: InputDeviceCapabilities.name,
            ctorNative: String(InputDeviceCapabilities).includes('[native code]'),
            defaultFiresTouch: new InputDeviceCapabilities().firesTouchEvents,
            touchCtorFiresTouch: new InputDeviceCapabilities({firesTouchEvents: true}).firesTouchEvents,
            instanceOwnKeys: Object.keys(new InputDeviceCapabilities({firesTouchEvents: true}))
        })"#,
        &sid,
    )
    .await;
    let intro: Value = serde_json::from_str(out["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(intro["scriptMouseEventIsNull"], true, "{intro}");
    assert_eq!(intro["scriptEventIsUndefined"], true, "{intro}");
    assert_eq!(intro["scriptKeyEventIsNull"], true, "{intro}");
    assert_eq!(intro["ctorIsFunction"], true, "{intro}");
    assert_eq!(intro["ctorName"], "InputDeviceCapabilities", "{intro}");
    assert_eq!(intro["ctorNative"], true, "{intro}");
    assert_eq!(intro["defaultFiresTouch"], false, "{intro}");
    assert_eq!(intro["touchCtorFiresTouch"], true, "{intro}");
    assert_eq!(intro["instanceOwnKeys"], json!([]), "{intro}");
}
