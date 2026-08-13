use obscura_browser::Page;
use serde_json::{json, Value};

use crate::dispatch::CdpContext;

struct InputDispatchTarget {
    frame: Option<(String, u64)>,
    node: Option<u32>,
    x: f64,
    y: f64,
}

fn input_dispatch_target(page: &mut Page, x: f64, y: f64) -> InputDispatchTarget {
    #[cfg(feature = "render")]
    if let Some((Some(frame), node, local_x, local_y)) =
        page.input_target_at_point(x as f32, y as f32)
    {
        return InputDispatchTarget {
            frame: Some(frame),
            node: Some(node),
            x: f64::from(local_x),
            y: f64::from(local_y),
        };
    }
    InputDispatchTarget { frame: None, node: None, x, y }
}

fn evaluate_input_script(page: &mut Page, target: &InputDispatchTarget, source: &str) {
    if let Some((frame_id, generation)) = target.frame.as_ref() {
        let content_root = page
            .frames
            .get(frame_id)
            .and_then(|frame| frame.active_document_root)
            .map(|root| root.raw());
        let base_url = content_root
            .and_then(|root| {
                page.js.as_ref()?.with_dom(|dom| {
                    dom.document_scope(obscura_dom::NodeId::new(root))
                        .map(|scope| scope.base_url)
                })?
            })
            .unwrap_or_else(|| page.url_string());
        if let Some(js) = page.js.as_mut() {
            if let Some(content_root) = content_root {
                let _ = js.ensure_frame_realm(
                    frame_id,
                    *generation,
                    content_root,
                    &base_url,
                );
            }
            let _ = js.execute_script_in_frame_realm(
                frame_id,
                *generation,
                "<cdp-input>",
                source,
            );
        }
    } else {
        page.evaluate(source);
    }
}

fn input_target_js(target: &InputDispatchTarget, fallback: &str) -> String {
    target
        .node
        .map(|node| format!("_wrap({node})"))
        .unwrap_or_else(|| fallback.to_string())
}

fn mouse_hover_exit_js(x: f64, y: f64) -> String {
    format!(
        "(function() {{\
            var old = globalThis.__obscura_hover_target;\
            globalThis.__obscura_hover_target = null;\
            if (!old) return;\
            function path(node) {{\
                var result = [];\
                while (node) {{\
                    result.push(node);\
                    node = node.parentNode || node.host || node._host || null;\
                }}\
                return result;\
            }}\
            var pointer = {{bubbles:true,cancelable:false,composed:true,view:globalThis,clientX:{x},clientY:{y},button:0,buttons:0,relatedTarget:null,pointerId:1,pointerType:'mouse',isPrimary:true,width:1,height:1,pressure:0}};\
            var leavePointer = Object.assign({{}}, pointer, {{bubbles:false,composed:false}});\
            old.dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointerout', pointer)));\
            for (var p of path(old)) p.dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointerleave', leavePointer)));\
            old.dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mouseout', pointer)));\
            for (var m of path(old)) m.dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mouseleave', leavePointer)));\
        }})()"
    )
}

fn mouse_hover_move_js(target_js: &str, x: f64, y: f64) -> String {
    format!(
        "(function() {{\
            var target = {target_js};\
            if (!target) return;\
            var old = globalThis.__obscura_hover_target || null;\
            function path(node) {{\
                var result = [];\
                while (node) {{\
                    result.push(node);\
                    node = node.parentNode || node.host || node._host || null;\
                }}\
                return result;\
            }}\
            var pointer = {{bubbles:true,cancelable:false,composed:true,view:globalThis,clientX:{x},clientY:{y},button:0,buttons:0,relatedTarget:null,pointerId:1,pointerType:'mouse',isPrimary:true,width:1,height:1,pressure:0}};\
            var enterPointer = Object.assign({{}}, pointer, {{bubbles:false,composed:false}});\
            if (old !== target) {{\
                var oldPath = path(old), newPath = path(target);\
                var oi = oldPath.length - 1, ni = newPath.length - 1;\
                while (oi >= 0 && ni >= 0 && oldPath[oi] === newPath[ni]) {{ oi--; ni--; }}\
                if (old) {{\
                    pointer.relatedTarget = target;\
                    enterPointer.relatedTarget = target;\
                    old.dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointerout', pointer)));\
                    for (var op = 0; op <= oi; op++) oldPath[op].dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointerleave', enterPointer)));\
                }}\
                pointer.relatedTarget = old;\
                enterPointer.relatedTarget = old;\
                target.dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointerover', pointer)));\
                for (var np = ni; np >= 0; np--) newPath[np].dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointerenter', enterPointer)));\
                if (old) {{\
                    pointer.relatedTarget = target;\
                    enterPointer.relatedTarget = target;\
                    old.dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mouseout', pointer)));\
                    for (var om = 0; om <= oi; om++) oldPath[om].dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mouseleave', enterPointer)));\
                }}\
                pointer.relatedTarget = old;\
                enterPointer.relatedTarget = old;\
                target.dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mouseover', pointer)));\
                for (var nm = ni; nm >= 0; nm--) newPath[nm].dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mouseenter', enterPointer)));\
                globalThis.__obscura_hover_target = target;\
            }}\
            pointer.relatedTarget = null;\
            target.dispatchEvent(globalThis.__obscura_markTrusted(new PointerEvent('pointermove', pointer)));\
            target.dispatchEvent(globalThis.__obscura_markTrusted(new MouseEvent('mousemove', pointer)));\
        }})()"
    )
}

// Insert `escaped_text` at the caret, replacing any non-collapsed selection
// the way a real browser does when you type over selected text (for example
// after a triple-click select-all). selectionStart is null during ordinary
// typing, so the legacy append path is kept when no selection is tracked.
fn insert_text_js(escaped_text: &str) -> String {
    format!(
        "(function() {{\
            var t = document.activeElement;\
            if (!t || (t.localName !== 'input' && t.localName !== 'textarea')) return;\
            var v = t.value || '';\
            var s = t.selectionStart, e = t.selectionEnd;\
            if (s == null) {{\
                globalThis.__obscura_setFieldValue(t, 'value', v + '{text}');\
            }} else {{\
                s = Math.max(0, Math.min(s, v.length));\
                e = (e == null) ? s : Math.max(0, Math.min(e, v.length));\
                var lo = Math.min(s, e), hi = Math.max(s, e);\
                globalThis.__obscura_setFieldValue(t, 'value', v.slice(0, lo) + '{text}' + v.slice(hi));\
                var caret = lo + ('{text}').length;\
                t.setSelectionRange(caret, caret);\
            }}\
            t.dispatchEvent(globalThis.__obscura_markTrusted(new Event('input', {{bubbles:true}})));\
        }})()",
        text = escaped_text,
    )
}

// Backspace deletes the selected range when there is one, so the common
// "triple-click to select-all, then Backspace to clear" pattern works. With a
// collapsed caret it removes the character before the caret, and with no
// selection tracked it falls back to trimming the last character (legacy).
const BACKSPACE_JS: &str = "(function() {\
    var t = document.activeElement;\
    if (!t || (t.localName !== 'input' && t.localName !== 'textarea')) return;\
    var v = t.value || '';\
    var s = t.selectionStart, e = t.selectionEnd;\
    if (s == null) {\
        globalThis.__obscura_setFieldValue(t, 'value', v.slice(0, -1));\
    } else {\
        s = Math.max(0, Math.min(s, v.length));\
        e = (e == null) ? s : Math.max(0, Math.min(e, v.length));\
        if (s !== e) {\
            var lo = Math.min(s, e), hi = Math.max(s, e);\
            globalThis.__obscura_setFieldValue(t, 'value', v.slice(0, lo) + v.slice(hi));\
            t.setSelectionRange(lo, lo);\
        } else if (s > 0) {\
            globalThis.__obscura_setFieldValue(t, 'value', v.slice(0, s - 1) + v.slice(s));\
            t.setSelectionRange(s - 1, s - 1);\
        }\
    }\
    t.dispatchEvent(globalThis.__obscura_markTrusted(new Event('input', {bubbles:true})));\
})()";

fn mouse_button_code(button: &str) -> u8 {
    match button {
        "middle" => 1,
        "right" => 2,
        "back" => 3,
        "forward" => 4,
        _ => 0,
    }
}

fn mouse_button_mask(button: &str) -> u64 {
    match button {
        "right" => 2,
        "middle" => 4,
        "back" => 8,
        "forward" => 16,
        "none" => 0,
        _ => 1,
    }
}

fn modifier_flags(modifiers: u64) -> (bool, bool, bool, bool) {
    // CDP Input.Modifier: Alt=1, Ctrl=2, Meta=4, Shift=8.
    (
        modifiers & 1 != 0,
        modifiers & 2 != 0,
        modifiers & 4 != 0,
        modifiers & 8 != 0,
    )
}

pub async fn handle(
    method: &str,
    params: &Value,
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<Value, String> {
    match method {
        "dispatchMouseEvent" => {
            let event_type = params.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let x = params.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = params.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let button = params.get("button").and_then(|v| v.as_str()).unwrap_or("left");
            let button_code = mouse_button_code(button);
            let buttons = params
                .get("buttons")
                .and_then(|v| v.as_u64())
                .unwrap_or_else(|| mouse_button_mask(button));
            let click_count = params.get("clickCount").and_then(|v| v.as_u64()).unwrap_or(1);
            let modifiers = params.get("modifiers").and_then(|v| v.as_u64()).unwrap_or(0);
            let (alt_key, ctrl_key, meta_key, shift_key) = modifier_flags(modifiers);

            if event_type == "mousePressed" {
                if let Some(page) = ctx.get_session_page_mut(session_id) {
                    let target = input_dispatch_target(page, x, y);
                    page.set_input_frame_target(target.frame.clone());
                    let target_js = input_target_js(
                        &target,
                        &format!("(document.elementFromPoint && document.elementFromPoint({x},{y})) || globalThis.__obscura_click_target || document.activeElement || document.body"),
                    );
                    let code = format!(
                        "(function() {{\
                            var target = {target_js};\
                            if (!target) return;\
                            globalThis.__obscura_click_target = target;\
                            globalThis.__obscura_mouse_down = {{target:target,button:{button_code},clickCount:{click_count}}};\
                            var pevt = globalThis.__obscura_markTrusted(new PointerEvent('pointerdown', {{bubbles:true,cancelable:true,composed:true,view:globalThis,clientX:{x},clientY:{y},button:{button_code},buttons:{buttons},detail:{click_count},altKey:{alt_key},ctrlKey:{ctrl_key},metaKey:{meta_key},shiftKey:{shift_key},pointerId:1,pointerType:'mouse',isPrimary:true,width:1,height:1,pressure:0.5}}));\
                            var disabledControl = target.matches && target.matches(':disabled');\
                            var pointerAllowed = target.dispatchEvent(pevt);\
                            var suppressMouse = disabledControl || !pointerAllowed;\
                            globalThis.__obscura_mouse_down.suppressMouse = suppressMouse;\
                            if (!suppressMouse) {{\
                                var evt = globalThis.__obscura_markTrusted(new MouseEvent('mousedown', {{bubbles:true,cancelable:true,composed:true,view:globalThis,clientX:{x},clientY:{y},button:{button_code},buttons:{buttons},detail:{click_count},altKey:{alt_key},ctrlKey:{ctrl_key},metaKey:{meta_key},shiftKey:{shift_key}}}));\
                                target.dispatchEvent(evt);\
                            }}\
                        }})()",
                        x = target.x,
                        y = target.y,
                        target_js = target_js,
                        button_code = button_code,
                        buttons = buttons,
                        click_count = click_count,
                        alt_key = alt_key,
                        ctrl_key = ctrl_key,
                        meta_key = meta_key,
                        shift_key = shift_key,
                    );
                    evaluate_input_script(page, &target, &code);
                }
            } else if event_type == "mouseReleased" {
                if let Some(page) = ctx.get_session_page_mut(session_id) {
                    let target = input_dispatch_target(page, x, y);
                    let target_js = input_target_js(
                        &target,
                        &format!("(document.elementFromPoint && document.elementFromPoint({x},{y})) || globalThis.__obscura_click_target || document.activeElement || document.body"),
                    );
                    let code = format!(
                        "(function() {{\
                            var target = {target_js};\
                            if (!target) return;\
                            var down = globalThis.__obscura_mouse_down;\
                            globalThis.__obscura_mouse_down = null;\
                            var pevt = globalThis.__obscura_markTrusted(new PointerEvent('pointerup', {{bubbles:true,cancelable:true,composed:true,view:globalThis,clientX:{x},clientY:{y},button:{button_code},buttons:0,detail:{click_count},altKey:{alt_key},ctrlKey:{ctrl_key},metaKey:{meta_key},shiftKey:{shift_key},pointerId:1,pointerType:'mouse',isPrimary:true,width:1,height:1,pressure:0}}));\
                            target.dispatchEvent(pevt);\
                            if (!down || !down.suppressMouse) {{\
                                var evt = globalThis.__obscura_markTrusted(new MouseEvent('mouseup', {{bubbles:true,cancelable:true,composed:true,view:globalThis,clientX:{x},clientY:{y},button:{button_code},buttons:0,detail:{click_count},altKey:{alt_key},ctrlKey:{ctrl_key},metaKey:{meta_key},shiftKey:{shift_key}}}));\
                                target.dispatchEvent(evt);\
                            }}\
                            if (!down || down.button !== {button_code} || {button_code} !== 0) return;\
                            var clickTarget = down.target;\
                            while (clickTarget && clickTarget !== target && !(clickTarget.contains && clickTarget.contains(target))) {{\
                                clickTarget = clickTarget.parentElement;\
                            }}\
                            if (!clickTarget) return;\
                            if (clickTarget.matches && clickTarget.matches(':disabled')) return;\
                            var tag = clickTarget.tagName;\
                            var type = (clickTarget.getAttribute && clickTarget.getAttribute('type') || '').toLowerCase();\
                            var checkable = tag === 'INPUT' && (type === 'checkbox' || type === 'radio');\
                            var oldChecked = checkable ? !!clickTarget.checked : false;\
                            var radioStates = null;\
                            if (checkable && type === 'radio') {{\
                                var radioName = clickTarget.getAttribute('name') || '';\
                                if (radioName) {{\
                                    var radioRoot = clickTarget.getRootNode();\
                                    var candidates = radioRoot && radioRoot.querySelectorAll ? radioRoot.querySelectorAll('input') : [];\
                                    radioStates = [];\
                                    for (var ri = 0; ri < candidates.length; ri++) {{\
                                        var radio = candidates[ri];\
                                        if ((radio.getAttribute('type') || '').toLowerCase() !== 'radio' || (radio.getAttribute('name') || '') !== radioName || radio.form !== clickTarget.form) continue;\
                                        radioStates.push([radio, !!radio.checked]);\
                                        if (radio !== clickTarget) radio.checked = false;\
                                    }}\
                                }}\
                                clickTarget.checked = true;\
                            }} else if (checkable) {{\
                                clickTarget.checked = !oldChecked;\
                            }}\
                            var click = globalThis.__obscura_markTrusted(new MouseEvent('click', {{bubbles:true,cancelable:true,composed:true,view:globalThis,clientX:{x},clientY:{y},button:0,buttons:0,detail:{click_count},altKey:{alt_key},ctrlKey:{ctrl_key},metaKey:{meta_key},shiftKey:{shift_key}}}));\
                            var cancelled = !clickTarget.dispatchEvent(click);\
                            if (cancelled) {{\
                                if (radioStates) {{\
                                    for (var rr = 0; rr < radioStates.length; rr++) radioStates[rr][0].checked = radioStates[rr][1];\
                                }} else if (checkable) clickTarget.checked = oldChecked;\
                                return;\
                            }}\
                            if (checkable && clickTarget.checked !== oldChecked) {{\
                                try {{ clickTarget.dispatchEvent(globalThis.__obscura_markTrusted(new Event('input', {{bubbles:true}}))); }} catch(e) {{}}\
                                try {{ clickTarget.dispatchEvent(globalThis.__obscura_markTrusted(new Event('change', {{bubbles:true}}))); }} catch(e) {{}}\
                                return;\
                            }}\
                            var link = clickTarget.closest ? clickTarget.closest('a[href]') : null;\
                            if (!link && tag === 'A' && clickTarget.getAttribute('href')) link = clickTarget;\
                            if (link) {{\
                                var href = link.getAttribute('href');\
                                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) location.assign(href);\
                            }} else if (tag === 'BUTTON' && type !== 'button' && type !== 'reset') {{\
                                var form = clickTarget.closest ? clickTarget.closest('form') : null;\
                                if (form) {{ try {{ if (typeof form.requestSubmit === 'function') {{ form.requestSubmit(clickTarget); }} else {{ form.submit(clickTarget); }} }} catch(e) {{}} }}\
                            }} else if (tag === 'INPUT' && (type === 'submit' || type === 'image')) {{\
                                var form2 = clickTarget.closest ? clickTarget.closest('form') : null;\
                                if (form2) {{ try {{ if (typeof form2.requestSubmit === 'function') {{ form2.requestSubmit(clickTarget); }} else {{ form2.submit(clickTarget); }} }} catch(e) {{}} }}\
                            }} else if ({click_count} >= 3 && (tag === 'INPUT' || tag === 'TEXTAREA')) {{\
                                var len = clickTarget.value ? clickTarget.value.length : 0;\
                                if (clickTarget.setSelectionRange) clickTarget.setSelectionRange(0, len);\
                                else {{ clickTarget.selectionStart = 0; clickTarget.selectionEnd = len; }}\
                            }}\
                        }})()",
                        x = target.x,
                        y = target.y,
                        target_js = target_js,
                        button_code = button_code,
                        click_count = click_count,
                        alt_key = alt_key,
                        ctrl_key = ctrl_key,
                        meta_key = meta_key,
                        shift_key = shift_key,
                    );
                    evaluate_input_script(page, &target, &code);
                    page.process_pending_navigation().await.map_err(|e| e.to_string())?;
                }
            } else if event_type == "mouseWheel" {
                let delta_x = params.get("deltaX").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let delta_y = params.get("deltaY").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if let Some(page) = ctx.get_session_page_mut(session_id) {
                    let target = input_dispatch_target(page, x, y);
                    let target_js = input_target_js(
                        &target,
                        &format!("(document.elementFromPoint && document.elementFromPoint({x},{y})) || document.body || document.documentElement"),
                    );
                    let code = format!(
                        "(function() {{\
                            var target = {target_js};\
                            if (!target) return;\
                            var wheel = globalThis.__obscura_markTrusted(new WheelEvent('wheel', {{bubbles:true,cancelable:true,view:globalThis,clientX:{x},clientY:{y},deltaX:{delta_x},deltaY:{delta_y},deltaMode:0,altKey:{alt_key},ctrlKey:{ctrl_key},metaKey:{meta_key},shiftKey:{shift_key}}}));\
                            if (!target.dispatchEvent(wheel)) return;\
                            var dx = {delta_x}, dy = {delta_y};\
                            var root = document.scrollingElement || document.documentElement || document.body;\
                            var scrollTarget = null;\
                            var el = target;\
                            while (el && el.nodeType === 1 && el !== root && el !== document.body && el !== document.documentElement) {{\
                                var maxX = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));\
                                var maxY = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));\
                                var style = null;\
                                try {{ style = getComputedStyle(el); }} catch (_e) {{}}\
                                var ox = style ? (style.overflowX || style.overflow || '') : '';\
                                var oy = style ? (style.overflowY || style.overflow || '') : '';\
                                var allowX = ox === 'auto' || ox === 'scroll' || ox === 'overlay';\
                                var allowY = oy === 'auto' || oy === 'scroll' || oy === 'overlay';\
                                var consumesX = allowX && ((dx > 0 && el.scrollLeft < maxX) || (dx < 0 && el.scrollLeft > 0));\
                                var consumesY = allowY && ((dy > 0 && el.scrollTop < maxY) || (dy < 0 && el.scrollTop > 0));\
                                if (consumesX || consumesY) {{ scrollTarget = el; break; }}\
                                el = el.parentElement;\
                            }}\
                            if (!scrollTarget) scrollTarget = root;\
                            if (scrollTarget === root && root && typeof root.scrollBy === 'function') {{\
                                var beforeX = root.scrollLeft, beforeY = root.scrollTop;\
                                root.scrollBy(dx, dy);\
                                if (root.scrollLeft !== beforeX || root.scrollTop !== beforeY) setTimeout(function() {{\
                                    try {{ document.dispatchEvent(new Event('scroll', {{bubbles:false}})); }} catch (_e) {{}}\
                                    try {{ globalThis.dispatchEvent(new Event('scroll', {{bubbles:false}})); }} catch (_e) {{}}\
                                }}, 0);\
                            }} else if (scrollTarget && typeof scrollTarget.scrollBy === 'function') scrollTarget.scrollBy(dx, dy);\
                        }})()",
                        x = target.x,
                        y = target.y,
                        target_js = target_js,
                        delta_x = delta_x,
                        delta_y = delta_y,
                        alt_key = alt_key,
                        ctrl_key = ctrl_key,
                        meta_key = meta_key,
                        shift_key = shift_key,
                    );
                    evaluate_input_script(page, &target, &code);
                }
            } else if event_type == "mouseMoved" {
                let page_id = session_id
                    .as_ref()
                    .and_then(|sid| ctx.sessions.get(sid))
                    .cloned();
                let old_realm = page_id
                    .as_ref()
                    .and_then(|id| ctx.input_hover_realms.get(id))
                    .cloned();
                let new_realm = if let Some(page) = ctx.get_session_page_mut(session_id) {
                    let target = input_dispatch_target(page, x, y);
                    let target_js = input_target_js(
                        &target,
                        &format!("(document.elementFromPoint && document.elementFromPoint({x},{y})) || document.body || document.documentElement"),
                    );
                    if old_realm.as_ref().is_some_and(|old| old != &target.frame) {
                        let old_target = InputDispatchTarget {
                            frame: old_realm.clone().flatten(),
                            node: None,
                            x,
                            y,
                        };
                        evaluate_input_script(page, &old_target, &mouse_hover_exit_js(x, y));
                    }
                    let code = mouse_hover_move_js(&target_js, target.x, target.y);
                    evaluate_input_script(page, &target, &code);
                    Some(target.frame)
                } else {
                    None
                };
                if let Some(page_id) = page_id {
                    if let Some(new_realm) = new_realm {
                        ctx.input_hover_realms.insert(page_id, new_realm);
                    }
                }
            }

            Ok(json!({}))
        }
        "dispatchKeyEvent" => {
            let event_type = params.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let code = params.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let text = params.get("text").and_then(|v| v.as_str()).unwrap_or("");

            if let Some(page) = ctx.get_session_page_mut(session_id) {
                let target = InputDispatchTarget {
                    frame: page.input_frame_target(),
                    node: None,
                    x: 0.0,
                    y: 0.0,
                };
                match event_type {
                    "keyDown" | "rawKeyDown" => {
                        let js = format!(
                            "(function() {{\
                                var target = document.activeElement || document.body;\
                                var evt = globalThis.__obscura_markTrusted(new KeyboardEvent('keydown', {{bubbles:true,cancelable:true,key:'{key}',code:'{code}'}}));\
                                target.dispatchEvent(evt);\
                            }})()",
                            // Escape backslash BEFORE single-quote (as the text
                            // path below does) so a key like "\" — Chrome's
                            // backslash key — doesn't escape the closing quote
                            // and produce a syntax error that drops the event.
                            key = key.replace('\\', "\\\\").replace('\'', "\\'"),
                            code = code.replace('\\', "\\\\").replace('\'', "\\'"),
                        );
                        evaluate_input_script(page, &target, &js);

                        if !text.is_empty() && text != "\r" && text != "\n" {
                            // Need to escape backslash BEFORE single-quote so the new
                            // backslashes from quote escaping don't get double-escaped.
                            let escaped_text = text.replace('\\', "\\\\").replace('\'', "\\'");
                            evaluate_input_script(page, &target, &insert_text_js(&escaped_text));
                        }

                        if key == "Enter" {
                            // In a textarea Enter inserts a newline; in input fields
                            // it submits the containing form. Real Chrome distinguishes
                            // these two and we should too: previously every Enter tried
                            // to submit the nearest form even from a textarea.
                            let js = "(function() {\
                                var target = document.activeElement;\
                                if (!target) return;\
                                target.dispatchEvent(globalThis.__obscura_markTrusted(new KeyboardEvent('keypress', {bubbles:true,key:'Enter',code:'Enter'})));\
                                if (target.localName === 'textarea') {\
                                    globalThis.__obscura_setFieldValue(target, 'value', (target.value || '') + '\\n');\
                                    target.dispatchEvent(globalThis.__obscura_markTrusted(new Event('input', {bubbles:true})));\
                                } else {\
                                    var form = target.form || (target.closest && target.closest('form'));\
                                    if (form) {{ try {{ if (typeof form.requestSubmit === 'function') {{ form.requestSubmit(); }} else {{ form.submit(); }} }} catch(e) {{}} }}\
                                }\
                            })()";
                            evaluate_input_script(page, &target, js);
                        }

                        if key == "Backspace" {
                            evaluate_input_script(page, &target, BACKSPACE_JS);
                        }
                    }
                    "keyUp" => {
                        let js = format!(
                            "(function() {{\
                                var target = document.activeElement || document.body;\
                                var evt = globalThis.__obscura_markTrusted(new KeyboardEvent('keyup', {{bubbles:true,key:'{key}',code:'{code}'}}));\
                                target.dispatchEvent(evt);\
                            }})()",
                            key = key.replace('\\', "\\\\").replace('\'', "\\'"),
                            code = code.replace('\\', "\\\\").replace('\'', "\\'"),
                        );
                        evaluate_input_script(page, &target, &js);
                    }
                    "char" => {
                        if !text.is_empty() {
                            let escaped_text = text.replace('\\', "\\\\").replace('\'', "\\'");
                            evaluate_input_script(page, &target, &insert_text_js(&escaped_text));
                            // Pump event loop so Angular change detection picks up the input
                            page.settle(50).await;
                        }
                    }
                    _ => {}
                }
            }

            Ok(json!({}))
        }
        "dispatchTouchEvent" => Ok(json!({})),
        "setIgnoreInputEvents" => Ok(json!({})),
        _ => Err(format!("Unknown Input method: {}", method)),
    }
}
