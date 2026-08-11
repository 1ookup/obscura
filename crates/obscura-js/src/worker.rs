//! Dedicated Worker host (design doc Phase 3.11, first slice).
//!
//! Each `new Worker(url)` owns a persistent, separate `ObscuraJsRuntime` (its
//! own V8 isolate seeded from the shared startup snapshot) on a dedicated OS
//! thread, so `terminate()` and runaway worker code never touch the page
//! isolate. The worker source executes exactly once; later messages only
//! dispatch `message` events into the retained worker global scope.
//!
//! Messaging uses the JSON-clonable subset of structured clone: both sides
//! serialize payloads as the JSON envelope `{"v": <data>}` (so `undefined`
//! round-trips as an absent property).
//! TODO(phase 3.11 follow-up): full structured clone (Map/Set/Date/RegExp/
//! ArrayBuffer/bigint/cyclic graphs) and transfer lists.

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc as std_mpsc;
use std::time::{Duration, Instant};

use deno_core::v8::IsolateHandle;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::runtime::ObscuraJsRuntime;

/// Upper bound on live workers per page. Chromium has no fixed cap, but each
/// Obscura worker costs an OS thread plus a V8 isolate; a page asking for more
/// than this is either broken or hostile, and gets a constructor error instead
/// of resource exhaustion.
pub const MAX_WORKERS: usize = 32;

/// How long `op_worker_spawn` waits for the worker thread to build its runtime
/// and hand back the isolate handle. Creation is snapshot-seeded and takes
/// milliseconds; the margin covers first-run V8 init and loaded CI hosts.
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(10);

/// Bounded wait for the worker thread to unwind after `terminate()`. The
/// isolate got `terminate_execution()` and its inbox closed, so a healthy
/// thread exits almost immediately; one stuck in native code is detached
/// rather than wedging the page behind a `join()`.
const TERMINATE_JOIN_TIMEOUT: Duration = Duration::from_millis(500);

/// Page-side registry of live dedicated workers. Lazily created by
/// `op_worker_spawn` (`ObscuraState.worker_host`), so pages without workers
/// allocate nothing.
pub struct WorkerHost {
    next_id: u32,
    workers: HashMap<u32, WorkerHandle>,
}

struct WorkerHandle {
    /// Page -> worker message payloads (already-serialized clone envelopes).
    to_worker: UnboundedSender<String>,
    /// Worker -> page outbox entries (JSON: {"kind":"message"|"error",..}),
    /// drained by the page-side `op_worker_recv` async op. The Rc lets the
    /// pending op future outlive `terminate()` and observe the channel close.
    outbox_rx: Rc<tokio::sync::Mutex<UnboundedReceiver<String>>>,
    /// The worker's own isolate. Terminating it never affects the page.
    isolate_handle: IsolateHandle,
    join: Option<std::thread::JoinHandle<()>>,
}

impl Drop for WorkerHandle {
    fn drop(&mut self) {
        // Page teardown without an explicit terminate(): interrupt any
        // synchronous worker JS so the thread observes its closed inbox and
        // exits instead of leaking a spinning isolate. Idempotent with
        // `WorkerHost::terminate`.
        self.isolate_handle.terminate_execution();
    }
}

impl Default for WorkerHost {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkerHost {
    pub fn new() -> Self {
        WorkerHost {
            next_id: 1,
            workers: HashMap::new(),
        }
    }

    /// Spawn a worker thread + runtime for `source` and return its id. Blocks
    /// only until the worker runtime exists (bounded), not until the source
    /// finishes: a source that loops forever still returns a usable id whose
    /// isolate handle `terminate` can kill.
    pub fn spawn(
        &mut self,
        source: String,
        script_url: String,
        kind: String,
    ) -> Result<u32, String> {
        if self.workers.len() >= MAX_WORKERS {
            return Err(format!(
                "worker limit reached ({MAX_WORKERS} per page)"
            ));
        }
        let (msg_tx, msg_rx) = unbounded_channel::<String>();
        let (out_tx, out_rx) = unbounded_channel::<String>();
        let (ready_tx, ready_rx) = std_mpsc::channel::<Result<IsolateHandle, String>>();
        let id = self.next_id;
        let thread = std::thread::Builder::new()
            .name(format!("obscura-worker-{id}"))
            .spawn(move || {
                worker_thread_main(source, script_url, kind, msg_rx, out_tx, ready_tx)
            })
            .map_err(|e| format!("failed to spawn worker thread: {e}"))?;
        let isolate_handle = match ready_rx.recv_timeout(SPAWN_READY_TIMEOUT) {
            Ok(Ok(handle)) => handle,
            Ok(Err(message)) => {
                let _ = thread.join();
                return Err(message);
            }
            Err(_) => {
                // Thread wedged before building the runtime; nothing to
                // terminate yet, so detach it and report failure.
                return Err("worker runtime did not start in time".to_string());
            }
        };
        self.next_id += 1;
        self.workers.insert(
            id,
            WorkerHandle {
                to_worker: msg_tx,
                outbox_rx: Rc::new(tokio::sync::Mutex::new(out_rx)),
                isolate_handle,
                join: Some(thread),
            },
        );
        Ok(id)
    }

    /// Queue a serialized message envelope for the worker. Returns false when
    /// the worker id is unknown or its thread already exited.
    pub fn post_message(&self, id: u32, payload: &str) -> bool {
        match self.workers.get(&id) {
            Some(handle) => handle.to_worker.send(payload.to_string()).is_ok(),
            None => false,
        }
    }

    /// Shared receiver for the worker's outbox, awaited by `op_worker_recv`.
    pub fn outbox(
        &self,
        id: u32,
    ) -> Option<Rc<tokio::sync::Mutex<UnboundedReceiver<String>>>> {
        self.workers.get(&id).map(|handle| handle.outbox_rx.clone())
    }

    /// Kill the worker's isolate and drop its channels. The page isolate is
    /// untouched. The thread gets a bounded join; if it does not unwind in
    /// time (stuck in native code) it is detached and exits on its own once
    /// V8 delivers the termination.
    pub fn terminate(&mut self, id: u32) -> bool {
        let Some(mut handle) = self.workers.remove(&id) else {
            return false;
        };
        handle.isolate_handle.terminate_execution();
        let join = handle.join.take();
        // Close the inbox/outbox first so an idle worker parked on recv()
        // wakes immediately.
        drop(handle);
        if let Some(join) = join {
            let deadline = Instant::now() + TERMINATE_JOIN_TIMEOUT;
            while !join.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            if join.is_finished() {
                let _ = join.join();
            }
        }
        true
    }
}

/// Outbox entry for a worker `postMessage` payload (an already-serialized
/// clone envelope). Kept as strings so the page-side recv op can frame a
/// batch without re-parsing.
pub(crate) fn message_entry(payload: &str) -> String {
    serde_json::json!({ "kind": "message", "data": payload }).to_string()
}

/// Outbox entry reporting a worker-side error to the page `Worker` object.
pub(crate) fn error_entry(message: &str) -> String {
    serde_json::json!({ "kind": "error", "message": message }).to_string()
}

fn is_termination(error: &str) -> bool {
    error.contains("execution terminated")
}

fn worker_thread_main(
    source: String,
    script_url: String,
    _kind: String,
    mut inbox: UnboundedReceiver<String>,
    out_tx: UnboundedSender<String>,
    ready_tx: std_mpsc::Sender<Result<IsolateHandle, String>>,
) {
    let panic_out_tx = out_tx.clone();
    let panic_ready_tx = ready_tx.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let tokio_runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("worker event loop init failed: {e}")));
                return;
            }
        };
        tokio_runtime.block_on(async move {
            // A separate isolate from the page's, seeded from the same startup
            // snapshot; ObscuraJsRuntime construction already serializes
            // isolate creation through ISOLATE_CREATE_LOCK (#430).
            let mut rt = ObscuraJsRuntime::with_base_url(&script_url);
            {
                let state = rt.state_handle().clone();
                let mut gs = state.borrow_mut();
                gs.worker_outbox = Some(out_tx.clone());
                gs.url = script_url.clone();
            }
            // Hand the isolate handle back before running author code so
            // spawn returns quickly even when the source never yields.
            if ready_tx.send(Ok(rt.isolate_handle())).is_err() {
                return;
            }
            if let Err(e) =
                rt.execute_script("<obscura:worker-prep>", &worker_prep_script(&script_url))
            {
                let _ = out_tx.send(error_entry(&format!("worker global setup failed: {e}")));
                return;
            }
            // HTML "run a worker": the worker source executes exactly once.
            // Later messages only dispatch events (worker_event_loop below).
            if let Err(e) = rt.execute_script("<obscura:worker-script>", &source) {
                let _ = out_tx.send(error_entry(&e));
                if is_termination(&e) {
                    return;
                }
            }
            worker_event_loop(&mut rt, &mut inbox, &out_tx).await;
        });
    }));
    if result.is_err() {
        // Panic-isolated: the page only observes a closed channel plus this
        // error entry; the process (and the page isolate) keep running.
        let _ = panic_out_tx.send(error_entry("worker thread panicked"));
        let _ = panic_ready_tx.send(Err("worker thread panicked".to_string()));
    }
}

/// Pump the worker's own event loop (timers, microtasks, async ops) while
/// racing the page's message channel. Biased toward messages so a burst
/// drains before timer work; between tasks `run_event_loop` performs the
/// microtask checkpoints.
async fn worker_event_loop(
    rt: &mut ObscuraJsRuntime,
    inbox: &mut UnboundedReceiver<String>,
    out_tx: &UnboundedSender<String>,
) {
    enum Turn {
        Message(Option<String>),
        Idle(Result<(), String>),
    }
    loop {
        if close_requested(rt) {
            return;
        }
        let turn = tokio::select! {
            biased;
            message = inbox.recv() => Turn::Message(message),
            pumped = rt.run_event_loop() => Turn::Idle(pumped),
        };
        match turn {
            Turn::Message(Some(payload)) => {
                if !dispatch_message(rt, &payload, out_tx) {
                    return;
                }
            }
            // Channel closed: the page terminated us or went away.
            Turn::Message(None) => return,
            Turn::Idle(result) => {
                if let Err(error) = result {
                    if is_termination(&error) {
                        return;
                    }
                    let _ = out_tx.send(error_entry(&error));
                }
                if close_requested(rt) {
                    return;
                }
                // JS fully idle (no pending timers/ops): park until the next
                // message or channel close instead of spinning.
                match inbox.recv().await {
                    Some(payload) => {
                        if !dispatch_message(rt, &payload, out_tx) {
                            return;
                        }
                    }
                    None => return,
                }
            }
        }
    }
}

fn close_requested(rt: &ObscuraJsRuntime) -> bool {
    rt.state_handle().borrow().worker_close_requested
}

/// Dispatch one page message as a `message` event in the retained worker
/// global. Returns false when the isolate was terminated mid-dispatch.
fn dispatch_message(
    rt: &mut ObscuraJsRuntime,
    payload: &str,
    out_tx: &UnboundedSender<String>,
) -> bool {
    // The payload is a JSON document; its JSON serialization is also a valid
    // JS string literal (ES2019 accepts U+2028/2029 in strings).
    let literal = serde_json::Value::String(payload.to_string()).to_string();
    let script = format!("globalThis.__obscura_worker_dispatch_message({literal});");
    match rt.execute_script("<obscura:worker-message>", &script) {
        Ok(()) => true,
        Err(error) => {
            let terminated = is_termination(&error);
            let _ = out_tx.send(error_entry(&error));
            !terminated
        }
    }
}

fn worker_prep_script(script_url: &str) -> String {
    let literal = serde_json::Value::String(script_url.to_string()).to_string();
    WORKER_PREP_TEMPLATE.replace("__OBSCURA_WORKER_URL__", &literal)
}

/// Executed in the fresh worker runtime before the worker source. The
/// snapshot global is the page bootstrap's Window; this strips the
/// Window-only surface and installs the DedicatedWorkerGlobalScope API.
const WORKER_PREP_TEMPLATE: &str = r#"(function () {
  // Author checks like `typeof document` / `'document' in self` must match a
  // worker scope. These globals were created by plain assignment in the page
  // bootstrap, so they are configurable and deletable.
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.top;
  delete globalThis.parent;
  delete globalThis.frames;
  delete globalThis.frameElement;
  globalThis.self = globalThis;
  globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
  globalThis.DedicatedWorkerGlobalScope = function DedicatedWorkerGlobalScope() {};
  globalThis.WorkerLocation = function WorkerLocation() {};
  // The page bootstrap pins `location` non-configurable, but all its getters
  // derive from `__virtualUrl` when set. Pointing it at the final worker
  // script URL gives location.href/origin/protocol/... WorkerLocation reads.
  // TODO(phase 3.11 follow-up): a real WorkerLocation instance (readonly, no
  // assign()/reload()/replace()).
  globalThis.__virtualUrl = __OBSCURA_WORKER_URL__;

  var listeners = { message: [], error: [] };
  globalThis.addEventListener = function (type, fn) {
    if (typeof fn !== 'function') return;
    var ls = listeners[type] || (listeners[type] = []);
    if (ls.indexOf(fn) < 0) ls.push(fn);
  };
  globalThis.removeEventListener = function (type, fn) {
    var ls = listeners[type];
    if (ls) { var i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1); }
  };
  globalThis.onmessage = null;
  globalThis.onerror = null;

  // Structured clone, JSON-clonable subset; `{v: data}` envelope so an
  // `undefined` payload round-trips as an absent property.
  // TODO(phase 3.11 follow-up): full structured clone + transfer lists.
  globalThis.postMessage = function postMessage(data) {
    if (typeof data === 'function' || typeof data === 'symbol') {
      throw new DOMException('The object could not be cloned.', 'DataCloneError');
    }
    var payload;
    try { payload = JSON.stringify({ v: data }); }
    catch (e) { throw new DOMException('The object could not be cloned.', 'DataCloneError'); }
    if (payload === undefined) payload = '{}';
    Deno.core.ops.op_worker_post_to_page(payload);
  };

  globalThis.close = function close() {
    globalThis.__obscura_worker_closed = true;
    Deno.core.ops.op_worker_close();
  };

  function decodeDataUrl(u) {
    var comma = u.indexOf(',');
    if (comma < 0) throw new DOMException('Invalid data: URL', 'SyntaxError');
    var meta = u.slice(5, comma);
    var payload = u.slice(comma + 1);
    if (/;base64$/i.test(meta)) return atob(payload);
    try { return decodeURIComponent(payload); } catch (e) { return payload; }
  }

  // First slice: importScripts executes data: URLs synchronously (indirect
  // eval runs them as classic scripts in the worker global scope, per HTML).
  // The worker thread has no synchronous HTTP channel yet, so http(s)/blob
  // sources throw NetworkError.
  // TODO(phase 3.11 follow-up): http(s) importScripts through the page HTTP
  // client, resolved against the worker script URL; blob: URL store sharing.
  globalThis.importScripts = function importScripts() {
    for (var i = 0; i < arguments.length; i++) {
      var resolved;
      try { resolved = new URL(String(arguments[i]), globalThis.location.href).href; }
      catch (e) {
        throw new DOMException("Failed to execute 'importScripts': invalid URL", 'SyntaxError');
      }
      if (resolved.startsWith('data:')) {
        (0, eval)(decodeDataUrl(resolved));
      } else {
        throw new DOMException(
          "importScripts('" + resolved + "') is not supported in this worker build (data: URLs only)",
          'NetworkError');
      }
    }
  };

  globalThis.__obscura_worker_dispatch_message = function (payload) {
    if (globalThis.__obscura_worker_closed) return;
    var data;
    try { data = JSON.parse(payload).v; } catch (e) { return; }
    var evt = new MessageEvent('message', { data: data });
    if (typeof globalThis.onmessage === 'function') {
      try { globalThis.onmessage(evt); }
      catch (e) { console.error('Worker onmessage error:', e); }
    }
    var ls = listeners.message.slice();
    for (var i = 0; i < ls.length; i++) {
      try { ls[i].call(globalThis, evt); }
      catch (e) { console.error('Worker message listener error:', e); }
    }
  };
})();
"#;

#[cfg(test)]
mod tests {
    use crate::runtime::ObscuraJsRuntime;
    use obscura_dom::parse_html;

    fn page_runtime() -> ObscuraJsRuntime {
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url("http://example.com/app/index.html");
        rt.run_page_init();
        rt
    }

    /// Pump the page event loop until `expr` evaluates to `expected`. Worker
    /// round trips cross a real OS thread, so delivery needs wall-clock time;
    /// each pump drains resolved worker-recv ops and their microtasks.
    async fn pump_until(
        rt: &mut ObscuraJsRuntime,
        expr: &str,
        expected: &serde_json::Value,
    ) -> serde_json::Value {
        let mut last = serde_json::Value::Null;
        for _ in 0..400 {
            let _ = rt.run_event_loop_bounded(25).await;
            if let Ok(value) = rt.evaluate(expr) {
                if &value == expected {
                    return value;
                }
                last = value;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        panic!("pump_until: wanted {expected}, last saw {last}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_echo_round_trip() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "onmessage = function (e) { postMessage({ echo: e.data }); };";
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('hi');
            w.postMessage({ n: 1, arr: [1, 2], nested: { s: 'x' } });
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!(
                r#"[{"echo":"hi"},{"echo":{"n":1,"arr":[1,2],"nested":{"s":"x"}}}]"#
            ),
        )
        .await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_source_executes_once_and_state_persists() {
        let mut rt = page_runtime();
        // `inits` counts source-top-level executions; `count` proves vars
        // persist across message dispatches in one retained global scope.
        rt.execute_script(
            "<test>",
            r#"
            const src =
              "var inits = (typeof globalThis.__inits === 'number') ? (globalThis.__inits += 1) : (globalThis.__inits = 1);" +
              "var count = 0;" +
              "onmessage = function () { count++; postMessage({ inits: globalThis.__inits, count: count }); };";
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            globalThis.__got = [];
            w.addEventListener('message', (e) => { globalThis.__got.push(e.data); });
            w.postMessage('a');
            w.postMessage('b');
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!(r#"[{"inits":1,"count":1},{"inits":1,"count":2}]"#),
        )
        .await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_set_timeout_fires_in_worker_runtime() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "onmessage = function () { setTimeout(function () { postMessage('timer'); }, 25); };";
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('go');
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!(r#"["timer"]"#),
        )
        .await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_terminate_stops_messages_and_page_survives() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "onmessage = function (e) { postMessage('echo:' + e.data); };";
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            globalThis.__w = w;
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('one');
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!(r#"["echo:one"]"#),
        )
        .await;

        rt.execute_script(
            "<test-terminate>",
            "globalThis.__w.terminate(); globalThis.__w.postMessage('two');",
        )
        .unwrap();
        // Give a stale reply every chance to arrive, then assert none did.
        for _ in 0..20 {
            let _ = rt.run_event_loop_bounded(20).await;
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            rt.evaluate("JSON.stringify(globalThis.__got)").unwrap(),
            serde_json::json!(r#"["echo:one"]"#),
        );
        // The page isolate is unaffected: sync eval and timers still work.
        assert_eq!(rt.evaluate("1 + 1").unwrap(), serde_json::json!(2.0));
        rt.execute_script(
            "<test-page-timer>",
            "globalThis.__pageTimer = null; setTimeout(() => { globalThis.__pageTimer = 'ok'; }, 5);",
        )
        .unwrap();
        pump_until(
            &mut rt,
            "globalThis.__pageTimer",
            &serde_json::json!("ok"),
        )
        .await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_scope_has_no_document_or_window() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src =
              "postMessage({ doc: typeof document, win: typeof window, wgs: typeof WorkerGlobalScope," +
              " dwgs: typeof DedicatedWorkerGlobalScope, selfOk: self === globalThis, loc: location.href });";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__expectedUrl = url;
            const w = new Worker(url);
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate(
                "JSON.stringify([__got[0].doc, __got[0].win, __got[0].wgs, __got[0].dwgs, __got[0].selfOk, __got[0].loc === __expectedUrl])"
            )
            .unwrap(),
            serde_json::json!(r#"["undefined","undefined","function","function",true,true]"#),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_cross_origin_classic_throws_security_error() {
        let mut rt = page_runtime();
        assert_eq!(
            rt.evaluate(
                "(function () { try { new Worker('http://other.example/w.js'); return 'no-throw'; } catch (e) { return e.name; } })()"
            )
            .unwrap(),
            serde_json::json!("SecurityError"),
        );
        // Same check applies inside relative resolution: the page origin is
        // http://example.com, so a protocol-relative other host also throws.
        assert_eq!(
            rt.evaluate(
                "(function () { try { new Worker('//other.example/w.js'); return 'no-throw'; } catch (e) { return e.name; } })()"
            )
            .unwrap(),
            serde_json::json!("SecurityError"),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_import_scripts_data_url_and_close() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const lib = 'var IMPORTED = 7;';
            const src =
              "importScripts('data:text/javascript,' + encodeURIComponent(" + JSON.stringify('var IMPORTED = 7;') + "));" +
              "onmessage = function () { postMessage(IMPORTED); close(); };";
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('go');
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!("[7]"),
        )
        .await;
        // close() from inside the worker: later messages are not dispatched.
        rt.execute_script("<test-post-close>", "0").unwrap();
        rt.evaluate("(function(){ return 1; })()").unwrap();
        for _ in 0..20 {
            let _ = rt.run_event_loop_bounded(20).await;
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            rt.evaluate("JSON.stringify(globalThis.__got)").unwrap(),
            serde_json::json!("[7]"),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_from_blob_url_round_trips() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const blob = new Blob(["onmessage = function (e) { postMessage('b:' + e.data); };"],
                                  { type: 'text/javascript' });
            const w = new Worker(URL.createObjectURL(blob));
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('x');
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!(r#"["b:x"]"#),
        )
        .await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_http_same_origin_fetches_source_and_reports_location() {
        // Same-origin http(s) workers fetch their source through the page's
        // fetch pipeline; WorkerLocation.href is the final script URL.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            let body =
                "onmessage = function (e) { postMessage({ echo: e.data, loc: location.href }); };";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            let _ = stream.write_all(response.as_bytes());
        });

        let origin = format!("http://{address}");
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url(&format!("{origin}/app/page.html"));
        rt.set_http_client(std::sync::Arc::new(
            obscura_net::ObscuraHttpClient::with_full_options(
                std::sync::Arc::new(obscura_net::CookieJar::new()),
                None,
                true,
            ),
        ));
        rt.run_page_init();

        // Relative URL: resolves against the page base to the local origin.
        rt.execute_script(
            "<test>",
            r#"
            const w = new Worker('/worker.js');
            globalThis.__got = [];
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('over-http');
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("globalThis.__got[0].echo").unwrap(),
            serde_json::json!("over-http"),
        );
        assert_eq!(
            rt.evaluate("globalThis.__got[0].loc").unwrap(),
            serde_json::json!(format!("{origin}/worker.js")),
        );
    }
}
