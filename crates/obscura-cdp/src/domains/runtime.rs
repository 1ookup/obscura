use obscura_browser::lifecycle::WaitUntil;
use obscura_js::runtime::RemoteObjectInfo;
use serde_json::{json, Value};

use crate::dispatch::CdpContext;

/// Drain pending JS-initiated navigation (form.submit, location.assign, etc),
/// then emit the same CDP nav-event sequence Page.navigate emits so
/// Puppeteer's waitForNavigation / Playwright's wait_for_url resolves.
/// Without this, in-page navigations look like Runtime.evaluate finishing
/// to clients and they hang waiting for a frameNavigated that never fires.
async fn emit_post_eval_nav(
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<(), String> {
    let page = ctx
        .get_session_page_mut(session_id)
        .ok_or("No page")?;
    let did_navigate = page.process_pending_navigation().await.map_err(|e| e.to_string())?;
    if !did_navigate {
        return Ok(());
    }
    let (frame_id, page_url, page_id, network_events, reached_idle) = {
        let p = ctx.get_session_page_mut(session_id).ok_or("No page")?;
        (
            p.frame_id.clone(),
            p.url_string(),
            p.id.clone(),
            p.network_events.drain(..).collect::<Vec<_>>(),
            p.lifecycle.is_network_idle(),
        )
    };
    let loader_id = format!("loader-{}", uuid::Uuid::new_v4());
    super::page::emit_navigation_events(
        ctx,
        session_id,
        &frame_id,
        &loader_id,
        &page_url,
        &page_id,
        &network_events,
        WaitUntil::Load,
        reached_idle,
    );
    Ok(())
}

pub async fn handle(
    method: &str,
    params: &Value,
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<Value, String> {
    match method {
        "enable" => {
            // puppeteer-extra's FrameManager.initialize calls Runtime.enable on
            // the browser-level connection BEFORE any page target exists. Real
            // Chrome replies with `{}` and emits executionContextCreated when
            // a context appears. Returning "No page" here breaks the standard
            // puppeteer connect/newPage flow. If there's no session, succeed
            // silently — the next Target.attachToTarget will set things up.
            // The client cares about execution contexts from here on, so
            // child frames get their default world eagerly (Phase 6.3). The
            // flag is what keeps a plain navigate/screenshot client from
            // paying for a realm per frame.
            ctx.runtime_enabled = true;
            match ctx.get_session_page(session_id) {
                Some(page) => {
                    let page_id = page.id.clone();
                    let event = crate::types::CdpEvent {
                        method: "Runtime.executionContextCreated".to_string(),
                        params: json!({
                            "context": {
                                "id": 1,
                                "origin": page.url_string(),
                                "name": "",
                                "uniqueId": format!("ctx-{}", page.id),
                                "auxData": {
                                    "isDefault": true,
                                    "type": "default",
                                    "frameId": page.frame_id,
                                }
                            }
                        }),
                        session_id: session_id.clone(),
                    };
                    ctx.pending_events.push(event);
                    // Chrome replays the contexts that already exist when the
                    // domain is enabled. Enabling after a navigation is the
                    // common Playwright/Puppeteer order, so without this the
                    // page's frames would never advertise one.
                    super::page::emit_existing_frame_contexts(ctx, session_id, &page_id);
                }
                None => {
                    // No session attached yet — that's fine. Just ack.
                }
            }
            Ok(json!({}))
        }
        "evaluate" => {
            let expression = params
                .get("expression")
                .and_then(|v| v.as_str())
                .ok_or("expression required")?;
            let return_by_value = params
                .get("returnByValue")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            validate_context_id(params, "contextId", ctx, "evaluate")?;

            let await_promise = params
                .get("awaitPromise")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            // CDP `timeout` field (milliseconds). Default to Chrome's
            // protocolTimeout (30s) so long evaluations don't pin the V8 lock
            // indefinitely and starve every other CDP command on the same
            // session.
            let timeout_ms = params
                .get("timeout")
                .and_then(|v| v.as_u64())
                .unwrap_or(30_000);

            // Phase 6.2/6.3: a contextId registered in the execution-context
            // table addresses a real world realm (any child frame world, or a
            // main-frame isolated world); route there. Ids outside the table
            // (1/2 and the synthetic puppeteer utility world) keep the
            // historical main-context path.
            let realm_context_id = params
                .get("contextId")
                .and_then(|v| v.as_i64())
                .filter(|id| ctx.execution_contexts.contains_key(id));
            if let Some(realm_context_id) = realm_context_id {
                // A main-frame isolated world builds its realm here, on first
                // use; a child-frame world already has one.
                super::page::ensure_context_realm(ctx, session_id, realm_context_id)?;
                let entry = ctx
                    .execution_contexts
                    .get(&realm_context_id)
                    .cloned()
                    .ok_or_else(|| {
                        format!("Cannot find context with specified id: {realm_context_id}")
                    })?;
                let page = ctx
                    .get_session_page_mut(session_id)
                    .ok_or("No page")?;
                let js = page.js.as_mut().ok_or("No page")?;
                // Statement-shaped sources (`var x = 1`, `let`, `const`) need
                // Script semantics so the binding persists at the realm's top
                // level across evaluations, as in Chrome's global evaluation;
                // the remote-object wrapper would parenthesize them into a
                // SyntaxError. Mirrors the main path, whose by-value shortcut
                // routes them through wrap_expression.
                let trimmed = expression.trim_start();
                let statement_shaped = ["var ", "let ", "const "]
                    .iter()
                    .any(|kw| trimmed.starts_with(kw));
                if statement_shaped && return_by_value && !await_promise {
                    let completion = js.execute_script_in_frame_world_realm(
                        &entry.frame_id,
                        entry.generation,
                        entry.world_id,
                        "<cdp-eval-frame>",
                        expression,
                    )?;
                    return Ok(json!({ "result": completion_to_remote(&completion) }));
                }
                let info = match tokio::time::timeout(
                    std::time::Duration::from_millis(timeout_ms),
                    js.evaluate_in_frame_realm_for_cdp(
                        &entry.frame_id,
                        entry.generation,
                        entry.world_id,
                        expression,
                        return_by_value,
                        await_promise,
                        timeout_ms,
                    ),
                )
                .await
                {
                    Ok(Ok(info)) => info,
                    Ok(Err(error)) => return Err(error),
                    Err(_) => {
                        return Err(format!(
                            "Runtime.evaluate exceeded {timeout_ms}ms timeout"
                        ));
                    }
                };
                emit_post_eval_nav(ctx, session_id).await?;
                return Ok(json!({ "result": remote_object_from_info(&info) }));
            }

            let page = ctx
                .get_session_page_mut(session_id)
                .ok_or("No page")?;
            let info = match tokio::time::timeout(
                std::time::Duration::from_millis(timeout_ms),
                page.evaluate_for_cdp_with_timeout(
                    expression,
                    return_by_value,
                    await_promise,
                    timeout_ms,
                ),
            )
            .await
            {
                Ok(Ok(info)) => info,
                Ok(Err(error)) => return Err(error),
                Err(_) => {
                    return Err(format!(
                        "Runtime.evaluate exceeded {timeout_ms}ms timeout"
                    ));
                }
            };
            emit_post_eval_nav(ctx, session_id).await?;

            Ok(json!({ "result": remote_object_from_info(&info) }))
        }
        "callFunctionOn" => {
            let function_declaration = params
                .get("functionDeclaration")
                .and_then(|v| v.as_str())
                .unwrap_or("() => undefined");
            let return_by_value = params
                .get("returnByValue")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let await_promise = params
                .get("awaitPromise")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let object_id = params.get("objectId").and_then(|v| v.as_str());
            let arguments = params
                .get("arguments")
                .and_then(|v| v.as_array())
                .map(|a| a.to_vec())
                .unwrap_or_default();

            // #51: validate executionContextId the same way Runtime.evaluate
            // does. CDP names this field `executionContextId` on
            // callFunctionOn (not `contextId`); a request may omit it when
            // `objectId` is supplied — in that case validate_context_id is a
            // no-op and the default context is used.
            validate_context_id(params, "executionContextId", ctx, "callFunctionOn")?;

            // Keep awaitPromise alive for the same command budget as evaluate.
            // Playwright implements waits with callFunctionOn on some utility
            // paths, so a shorter hidden cap makes the client return before the
            // requested browser timer fires.
            let timeout_ms = params
                .get("timeout")
                .and_then(|v| v.as_u64())
                .unwrap_or(30_000);

            // Phase 6.2 routing: an executionContextId in the table selects
            // its frame world realm; otherwise a frame-owned objectId
            // implicitly selects the world that produced it. Cross-world
            // objectId/context combinations are rejected inside the runtime.
            if let Some(realm_context_id) = params
                .get("executionContextId")
                .and_then(|v| v.as_i64())
                .filter(|id| ctx.execution_contexts.contains_key(id))
            {
                super::page::ensure_context_realm(ctx, session_id, realm_context_id)?;
            }
            let realm_key: Option<(String, u64, u64)> = params
                .get("executionContextId")
                .and_then(|v| v.as_i64())
                .and_then(|id| ctx.execution_contexts.get(&id))
                .map(|entry| (entry.frame_id.clone(), entry.generation, entry.world_id))
                .or_else(|| {
                    object_id.and_then(|oid| {
                        ctx.get_session_page(session_id)
                            .and_then(|page| page.js.as_ref())
                            .and_then(|js| js.object_realm_key(oid))
                    })
                });
            if let Some((frame_id, generation, world_id)) = realm_key {
                let page = ctx
                    .get_session_page_mut(session_id)
                    .ok_or("No page")?;
                let js = page.js.as_mut().ok_or("No page")?;
                let info = match tokio::time::timeout(
                    std::time::Duration::from_millis(timeout_ms),
                    js.call_function_on_in_frame_realm(
                        &frame_id,
                        generation,
                        world_id,
                        function_declaration,
                        object_id,
                        &arguments,
                        return_by_value,
                        await_promise,
                        timeout_ms,
                    ),
                )
                .await
                {
                    Ok(Ok(info)) => info,
                    Ok(Err(error)) => return Err(error),
                    Err(_) => {
                        return Err(format!(
                            "Runtime.callFunctionOn exceeded {timeout_ms}ms timeout"
                        ));
                    }
                };
                emit_post_eval_nav(ctx, session_id).await?;
                return Ok(json!({ "result": remote_object_from_info(&info) }));
            }

            let page = ctx
                .get_session_page_mut(session_id)
                .ok_or("No page")?;
            let info = match tokio::time::timeout(
                std::time::Duration::from_millis(timeout_ms),
                page.call_function_on_for_cdp_with_timeout(
                    function_declaration,
                    object_id,
                    &arguments,
                    return_by_value,
                    await_promise,
                    timeout_ms,
                ),
            )
            .await
            {
                Ok(Ok(info)) => info,
                Ok(Err(error)) => return Err(error),
                Err(_) => {
                    return Err(format!(
                        "Runtime.callFunctionOn exceeded {timeout_ms}ms timeout"
                    ));
                }
            };
            emit_post_eval_nav(ctx, session_id).await?;

            Ok(json!({ "result": remote_object_from_info(&info) }))
        }
        "getProperties" => {
            // Puppeteer's $$() flow:
            //   1. evaluate querySelectorAll → handle for the NodeList
            //   2. getProperties on that handle → indexed items
            //   3. For each item, JSHandle.asElement() checks subtype === 'node';
            //      if true, wraps as ElementHandle (with click/type/etc).
            //
            // Older impl returned the raw value via JSON, dropping the node
            // identity. Items came back as `{type:'object'}` with no objectId
            // and no subtype, so asElement returned null and the caller got
            // plain JSHandles back from page.$$ -- breaking checkboxes[0].click().
            //
            // We now:
            //   1. Walk the underlying object in JS, allocating a stable child
            //      oid per (parent_oid + index) and stashing each value in
            //      __obscura_objects so later callFunctionOn can resolve it.
            //   2. Annotate each item with subtype:'node' + className when the
            //      value has a numeric nodeType, so Puppeteer wraps it as
            //      ElementHandle.
            let object_id = params.get("objectId").and_then(|v| v.as_str());
            if let Some(oid) = object_id {
                let page = ctx
                    .get_session_page_mut(session_id)
                    .ok_or("No page")?;
                // Phase 6.2: a handle owned by a frame world realm resolves
                // in that realm. The props payload shares the main path's
                // shape, so the same descriptor mapping applies.
                if page
                    .js
                    .as_ref()
                    .map_or(false, |js| js.object_realm_key(oid).is_some())
                {
                    let js = page.js.as_mut().expect("probed above");
                    let props = js.get_properties_in_frame_realm(oid)?;
                    let descriptors = match props {
                        serde_json::Value::Array(items) => props_to_descriptors(&items),
                        _ => Vec::new(),
                    };
                    return Ok(json!({ "result": descriptors, "internalProperties": [] }));
                }
                let escaped_oid = oid.replace('\\', "\\\\").replace('\'', "\\'");
                let code = format!(
                    "(function() {{\
                        var obj = globalThis.__obscura_objects['{oid}'];\
                        if (!obj || typeof obj !== 'object') return [];\
                        var keys = Object.keys(obj);\
                        return keys.map(function(k) {{\
                            var v = obj[k];\
                            var t = typeof v;\
                            var item = {{ name: k, type: t }};\
                            if (v === null) {{ item.value = null; return item; }}\
                            if (t !== 'object' && t !== 'function') {{ item.value = v; return item; }}\
                            var childOid = '{oid}::' + k;\
                            globalThis.__obscura_objects[childOid] = v;\
                            item.childOid = childOid;\
                            if (typeof v.nodeType === 'number') {{\
                                item.subtype = 'node';\
                                item.className = v.constructor && v.constructor.name ? v.constructor.name : (v.tagName ? 'HTML' + v.tagName.charAt(0) + v.tagName.slice(1).toLowerCase() + 'Element' : 'Node');\
                                item.description = v.tagName ? v.tagName.toLowerCase() : (v.nodeName || 'node');\
                            }} else if (Array.isArray(v)) {{\
                                item.subtype = 'array';\
                                item.className = 'Array';\
                                item.description = 'Array(' + v.length + ')';\
                            }} else {{\
                                item.className = (v.constructor && v.constructor.name) || 'Object';\
                                item.description = item.className;\
                            }}\
                            return item;\
                        }});\
                    }})()",
                    oid = escaped_oid,
                );
                let result = page.evaluate(&code);
                if let serde_json::Value::Array(props) = result {
                    let descriptors = props_to_descriptors(&props);
                    Ok(json!({ "result": descriptors, "internalProperties": [] }))
                } else {
                    Ok(json!({ "result": [], "internalProperties": [] }))
                }
            } else {
                Ok(json!({ "result": [], "internalProperties": [] }))
            }
        }
        "releaseObject" => {
            if let Some(oid) = params.get("objectId").and_then(|v| v.as_str()) {
                if let Some(page) = ctx.get_session_page_mut(session_id) {
                    page.release_object(oid);
                }
            }
            Ok(json!({}))
        }
        "releaseObjectGroup" => {
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                page.release_object_group();
            }
            Ok(json!({}))
        }
        "addBinding" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if !name.is_empty()
                && name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$')
                && !name.chars().next().unwrap_or('0').is_ascii_digit()
            {
                // The shim forwards every call back to Rust through
                // op_binding_called; the CDP dispatcher then drains the
                // queue and emits Runtime.bindingCalled events the same
                // way Chromium does. Chromium's V8InspectorImpl rejects
                // calls without exactly one argument and ToString-coerces
                // that argument before emitting it as the payload — we
                // match the coercion (`String(arg)`) and silently drop
                // calls with wrong arity, which is what Chrome does.
                let shim = format!(
                    "globalThis['{name}'] = function (arg) {{\
                        if (arguments.length !== 1) return;\
                        try {{\
                            const payload = typeof arg === 'string' ? arg : String(arg);\
                            Deno.core.ops.op_binding_called('{name}', payload);\
                        }} catch (e) {{ /* swallow: binding must not throw into page */ }}\
                    }};",
                    name = name,
                );
                // Re-install on every navigation: globalThis is wiped on
                // each new document, and puppeteer registers bindings
                // once-per-page rather than once-per-document.
                let key = format!("__obscura_binding__{}", name);
                ctx.preload_scripts.retain(|(k, _)| k != &key);
                ctx.preload_scripts.push((key, shim.clone()));
                // Install on the current page so the binding is usable
                // immediately, without waiting for the next navigation.
                if let Some(page) = ctx.get_session_page_mut(session_id) {
                    page.evaluate(&shim);
                }
            }
            Ok(json!({}))
        }
        "removeBinding" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if !name.is_empty() {
                let key = format!("__obscura_binding__{}", name);
                ctx.preload_scripts.retain(|(k, _)| k != &key);
                if let Some(page) = ctx.get_session_page_mut(session_id) {
                    page.evaluate(&format!("delete globalThis['{}'];", name));
                }
            }
            Ok(json!({}))
        }
        "runIfWaitingForDebugger" => Ok(json!({})),
        "getExceptionDetails" => Ok(json!({ "exceptionDetails": null })),
        "discardConsoleEntries" => Ok(json!({})),
        _ => Err(format!("Unknown Runtime method: {}", method)),
    }
}

/// Reject `Runtime.{evaluate,callFunctionOn}` calls that target an execution
/// context Obscura has not advertised. Returns `Ok(())` when the parameter is
/// absent (defaulting to the page's default context) or when the id matches
/// one of `ctx.valid_context_ids`. Logs a debug trace on accept for #51.
fn validate_context_id(
    params: &Value,
    field: &str,
    ctx: &crate::dispatch::CdpContext,
    method: &str,
) -> Result<(), String> {
    let Some(id) = params.get(field).and_then(|v| v.as_i64()) else {
        return Ok(());
    };
    if !ctx.valid_context_ids.contains(&id) {
        return Err(format!(
            "Cannot find context with specified id: {}",
            id
        ));
    }
    tracing::debug!(
        target: "obscura_cdp::runtime",
        "Runtime.{}: {}={} (single-isolate routing)",
        method,
        field,
        id
    );
    Ok(())
}

/// RemoteObject for a Script-semantics completion value (frame-realm
/// statement evaluation). A JSON null stands for an empty/undefined
/// completion, which statement sources produce per spec.
fn completion_to_remote(value: &Value) -> Value {
    match value {
        Value::Null => json!({ "type": "undefined" }),
        Value::String(s) => json!({ "type": "string", "value": s }),
        Value::Number(n) => json!({ "type": "number", "value": n, "description": n.to_string() }),
        Value::Bool(b) => json!({ "type": "boolean", "value": b }),
        other => json!({ "type": "object", "value": other }),
    }
}

/// Map the in-page property scan payload (`{ name, type, value | childOid,
/// subtype?, className?, description? }` items) to CDP PropertyDescriptors.
/// Shared by the main-context and frame-realm getProperties paths, whose
/// scan scripts produce the same shape.
fn props_to_descriptors(props: &[Value]) -> Vec<Value> {
    props
        .iter()
        .map(|p| {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let prop_type = p.get("type").and_then(|v| v.as_str()).unwrap_or("undefined");
            let mut remote = json!({ "type": prop_type });
            if let Some(child_oid) = p.get("childOid").and_then(|v| v.as_str()) {
                remote["type"] = json!("object");
                if let Some(sub) = p.get("subtype").and_then(|v| v.as_str()) {
                    remote["subtype"] = json!(sub);
                }
                if let Some(cls) = p.get("className").and_then(|v| v.as_str()) {
                    remote["className"] = json!(cls);
                }
                if let Some(desc) = p.get("description").and_then(|v| v.as_str()) {
                    remote["description"] = json!(desc);
                }
                remote["objectId"] = json!(child_oid);
            } else if let Some(val) = p.get("value") {
                match val {
                    Value::Null => {
                        remote["type"] = json!("object");
                        remote["subtype"] = json!("null");
                        remote["value"] = json!(null);
                    }
                    Value::String(s) => {
                        remote["type"] = json!("string");
                        remote["value"] = json!(s);
                    }
                    Value::Number(n) => {
                        remote["type"] = json!("number");
                        remote["value"] = json!(n);
                    }
                    Value::Bool(b) => {
                        remote["type"] = json!("boolean");
                        remote["value"] = json!(b);
                    }
                    _ => {
                        remote["value"] = val.clone();
                    }
                }
            }
            json!({
                "name": name,
                "value": remote,
                "configurable": true,
                "enumerable": true,
                "writable": true,
                "isOwn": true,
            })
        })
        .collect()
}

fn remote_object_from_info(info: &RemoteObjectInfo) -> Value {
    let mut obj = json!({ "type": info.js_type });

    if let Some(ref subtype) = info.subtype {
        obj["subtype"] = json!(subtype);
    }

    if !info.class_name.is_empty() {
        obj["className"] = json!(info.class_name);
    }

    if !info.description.is_empty() {
        obj["description"] = json!(info.description);
    }

    if let Some(ref oid) = info.object_id {
        obj["objectId"] = json!(oid);
    }

    if let Some(ref value) = info.value {
        obj["value"] = value.clone();
    }

    obj
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatch::CdpContext;

    // Issue #51 — Runtime.evaluate / callFunctionOn must read and validate
    // contextId. Pre-fix the parameter was silently dropped, so Playwright's
    // locator (which targets the utility world created by
    // Page.createIsolatedWorld) ran in the wrong context and timed out.
    //
    // Phase 5.5 (RED-then-GREEN) verification:
    //   - Without the prod fix, `valid_context_ids` does not exist on
    //     CdpContext → these tests fail to compile.
    //   - With the prod fix, all four tests pass.

    #[tokio::test]
    async fn evaluate_rejects_unknown_context_id() {
        let mut ctx = CdpContext::new();
        let err = handle(
            "evaluate",
            &json!({ "expression": "1 + 1", "contextId": 9999 }),
            &mut ctx,
            &None,
        )
        .await
        .expect_err("unknown contextId must error per CDP spec");
        assert!(
            err.contains("Cannot find context with specified id"),
            "error must match real Chrome's wording: {err}"
        );
        assert!(err.contains("9999"), "error must include the bad id: {err}");
    }

    #[tokio::test]
    async fn call_function_on_rejects_unknown_execution_context_id() {
        let mut ctx = CdpContext::new();
        let err = handle(
            "callFunctionOn",
            &json!({
                "functionDeclaration": "() => 42",
                "executionContextId": 9999,
            }),
            &mut ctx,
            &None,
        )
        .await
        .expect_err("unknown executionContextId must error per CDP spec");
        assert!(
            err.contains("Cannot find context with specified id"),
            "error must match Chrome wording: {err}"
        );
    }

    #[tokio::test]
    async fn evaluate_accepts_default_context_id_one() {
        // Runtime.enable advertises contextId=1 — that must be accepted as
        // valid input to evaluate, regardless of whether a page is attached.
        // (Without a page we get an Err("No page") AFTER the contextId check,
        // which proves validation passed for id=1.)
        let mut ctx = CdpContext::new();
        let result = handle(
            "evaluate",
            &json!({ "expression": "1 + 1", "contextId": 1 }),
            &mut ctx,
            &None,
        )
        .await;
        match result {
            Ok(_) => {} // accepted + executed (would happen if a page is attached)
            Err(e) => assert!(
                !e.contains("Cannot find context"),
                "contextId=1 must be accepted, got: {e}"
            ),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn evaluate_await_promise_reports_the_requested_timeout() {
        let mut ctx = CdpContext::new();
        let page_id = ctx.create_page();
        let session_id = "await-timeout-session".to_string();
        ctx.sessions.insert(session_id.clone(), page_id);

        let error = handle(
            "evaluate",
            &json!({
                "expression": "new Promise(() => {})",
                "returnByValue": true,
                "awaitPromise": true,
                "timeout": 25,
            }),
            &mut ctx,
            &Some(session_id),
        )
        .await
        .expect_err("an unsettled promise must not return stale result metadata");
        assert!(
            error.contains("25ms timeout") || error.contains("within 25ms"),
            "unexpected timeout error: {error}"
        );
    }

    #[tokio::test]
    async fn create_isolated_world_registers_id_for_evaluate() {
        // Round-trip: Page.createIsolatedWorld returns contextId N, and a
        // subsequent Runtime.evaluate targeting that contextId must NOT be
        // rejected.
        let mut ctx = CdpContext::new();
        // Bypass the page-attached path of createIsolatedWorld by direct
        // insert — mirrors the same effect as calling the page handler with
        // a real session.
        ctx.valid_context_ids.insert(100);

        let result = handle(
            "evaluate",
            &json!({ "expression": "1 + 1", "contextId": 100 }),
            &mut ctx,
            &None,
        )
        .await;
        if let Err(e) = result {
            assert!(
                !e.contains("Cannot find context"),
                "registered isolated-world contextId=100 must be accepted, got: {e}"
            );
        }
    }

    /// Regression for #122 item 7: puppeteer-extra's FrameManager.initialize
    /// fires Runtime.enable on the browser-level WebSocket BEFORE any page
    /// target exists. Real Chrome replies with `{}`; before the fix Obscura
    /// returned `{"error":{"code":-32601,"message":"No page"}}` and the
    /// puppeteer connect flow died.
    #[tokio::test]
    async fn enable_succeeds_when_no_session_attached() {
        let mut ctx = CdpContext::new();
        let result = handle("enable", &json!({}), &mut ctx, &None)
            .await
            .expect("Runtime.enable must succeed even with no session");
        assert_eq!(result, json!({}));
    }
}
