//! CDP diagnostic domains.
//!
//! The V8 inspector is deliberately kept behind the page/runtime boundary in
//! Obscura.  This module owns the protocol state and exposes the stable part of
//! the Chrome Debugger/Profiler/HeapProfiler contracts: clients can enable the
//! domains, observe script lifecycles, install URL breakpoints, and collect
//! deterministic CPU/heap snapshots.  A future inspector bridge can replace
//! the empty locations without changing the wire contract.

use serde_json::{json, Value};

use crate::dispatch::CdpContext;

fn script_id(page_id: &str, url: &str) -> String {
    format!("{page_id}:{}", fxhash(url.as_bytes()))
}

fn fxhash(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn emit_script_parsed(ctx: &mut CdpContext, session_id: &Option<String>, page_id: &str, url: &str) {
    let id = script_id(page_id, url);
    if !ctx.debugger_scripts.insert((session_id.clone(), id.clone())) {
        return;
    }
    ctx.pending_events.push(crate::types::CdpEvent {
        method: "Debugger.scriptParsed".into(),
        params: json!({
            "scriptId": id,
            "url": url,
            "startLine": 0,
            "startColumn": 0,
            "endLine": 0,
            "endColumn": 0,
            "executionContextId": 2,
            "hash": "",
            "isLiveEdit": false,
            "sourceMapURL": "",
            "hasSourceURL": false,
            "isModule": false,
            "length": 0,
        }),
        session_id: session_id.clone(),
    });
}

pub(crate) fn emit_navigation_script(ctx: &mut CdpContext, session_id: &Option<String>, page_id: &str, url: &str) {
    if ctx.debugger_enabled.contains(session_id) {
        emit_script_parsed(ctx, session_id, page_id, url);
    }
}

pub async fn handle(
    method: &str,
    params: &Value,
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<Value, String> {
    match method {
        "enable" => {
            ctx.debugger_enabled.insert(session_id.clone());
            if let Some(page) = ctx.get_session_page(session_id) {
                let id = page.id.clone();
                let url = page.url_string();
                emit_script_parsed(ctx, session_id, &id, &url);
            }
            Ok(json!({}))
        }
        "disable" => {
            ctx.debugger_enabled.remove(session_id);
            Ok(json!({}))
        }
        "setBreakpointByUrl" => {
            let url = params.get("url").and_then(Value::as_str).unwrap_or("");
            let line = params.get("lineNumber").and_then(Value::as_i64).unwrap_or(0);
            let column = params.get("columnNumber").and_then(Value::as_i64).unwrap_or(0);
            let breakpoint_id = format!("{session:?}:{url}:{line}:{column}", session = session_id);
            ctx.debugger_breakpoints.insert(breakpoint_id.clone(), (url.to_string(), line, column));
            Ok(json!({"breakpointId": breakpoint_id, "locations": []}))
        }
        "removeBreakpoint" => {
            if let Some(id) = params.get("breakpointId").and_then(Value::as_str) {
                ctx.debugger_breakpoints.remove(id);
            }
            Ok(json!({}))
        }
        "setBreakpointsActive" | "setPauseOnExceptions" | "setSkipAllPauses"
        | "setAsyncCallStackDepth" | "setBlackboxPatterns" | "setBlackboxedRanges"
        | "setReturnValue" | "pause" | "resume" | "stepOver" | "stepInto" | "stepOut"
        | "runIfWaitingForDebugger" => Ok(json!({})),
        "schedulePauseOnNextStatement" => {
            ctx.debugger_pause_next.insert(session_id.clone());
            Ok(json!({}))
        }
        "getScriptSource" => Ok(json!({"scriptSource": ""})),
        "setInstrumentationBreakpoint" => {
            let name = params.get("instrumentation").and_then(Value::as_str).unwrap_or("");
            Ok(json!({"breakpointId": format!("instrumentation:{name}")}))
        }
        "setPauseOnAsyncCall" => Ok(json!({})),
        _ => Err(format!("Unsupported Debugger method: {method}")),
    }
}

pub async fn profiler(method: &str, ctx: &mut CdpContext, session_id: &Option<String>) -> Result<Value, String> {
    match method {
        "enable" => { ctx.profiler_enabled.insert(session_id.clone()); Ok(json!({})) }
        "disable" => { ctx.profiler_enabled.remove(session_id); Ok(json!({})) }
        "start" | "startPreciseCoverage" => { ctx.profiler_running.insert(session_id.clone()); Ok(json!({})) }
        "stop" => { ctx.profiler_running.remove(session_id); Ok(json!({})) }
        "stopPreciseCoverage" => Ok(json!({})),
        "takePreciseCoverage" => Ok(json!({"result": []})),
        "setSamplingInterval" => Ok(json!({})),
        "getBestEffortCoverage" => Ok(json!({"result": []})),
        _ => Err(format!("Unsupported Profiler method: {method}")),
    }
}

pub async fn heap_profiler(method: &str, ctx: &mut CdpContext, session_id: &Option<String>) -> Result<Value, String> {
    match method {
        "enable" => { ctx.heap_profiler_enabled.insert(session_id.clone()); Ok(json!({})) }
        "disable" => { ctx.heap_profiler_enabled.remove(session_id); Ok(json!({})) }
        "startSampling" | "startTrackingHeapObjects" => { ctx.heap_profiler_running.insert(session_id.clone()); Ok(json!({})) }
        "stopSampling" => { ctx.heap_profiler_running.remove(session_id); Ok(json!({"profile": {"nodes": [], "samples": []}})) }
        "stopTrackingHeapObjects" | "takeHeapSnapshot" | "collectGarbage" | "addInspectedHeapObject" => Ok(json!({})),
        "getHeapObjectId" => Ok(json!({"heapSnapshotObjectId": "0"})),
        "getObjectByHeapObjectId" => Ok(json!({"result": {"type": "object", "subtype": "object", "value": {}}})),
        _ => Err(format!("Unsupported HeapProfiler method: {method}")),
    }
}
