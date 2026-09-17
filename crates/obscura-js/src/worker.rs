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
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use deno_core::v8::IsolateHandle;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::runtime::ObscuraJsRuntime;

/// Page-owned network state inherited by a dedicated worker. Dedicated
/// workers have a separate global and isolate, but they fetch through their
/// creator's browser context, cookie jar, callbacks and request policy.
pub(crate) struct WorkerEnvironment {
    pub cookie_jar: Option<Arc<obscura_net::CookieJar>>,
    pub http_client: Option<Arc<obscura_net::ObscuraHttpClient>>,
    pub callbacks: Option<Arc<obscura_net::CallbackRegistry>>,
    pub blocked_urls: Vec<String>,
    pub page_in_flight: Arc<std::sync::atomic::AtomicU32>,
    /// `new Worker(url, {name})`. Surfaces as `self.name`, which is `""` for a
    /// worker constructed without one -- not `undefined`, which is what an
    /// absent binding would report and what marks a scope as not-a-worker.
    pub name: String,
    /// Brands the global as a SharedWorkerGlobalScope and routes messages
    /// through connection ports instead of the scope's own `postMessage`,
    /// which a shared scope does not have.
    pub shared: bool,
    /// The creator's origin. A worker's origin is inherited from the document
    /// that created it, so a `blob:`/`data:` worker still reports the page's
    /// origin rather than deriving one from its own script URL.
    pub origin: String,
    /// Whether the creator was a secure context. Carried separately because an
    /// opaque origin serializes to "null" and cannot be re-inspected for its
    /// scheme.
    pub secure_context: bool,
    /// The enforced CSP of the document that created this worker. Worker
    /// fetches are governed by the creator document's `connect-src`; a frame
    /// worker must not silently fall back to the top-level page policy.
    pub document_csp: Option<String>,
    /// Immutable identity copied from the creator realm. The worker installs
    /// it before any author source runs and uses it for its own fetch client.
    pub fingerprint: obscura_net::BrowserFingerprint,
    /// Execution-source label for the trace streams (`worker(M)[creator]`),
    /// computed by the host once the worker id is known. The creator half is
    /// the constructing context's label at `new Worker(...)`, so nested
    /// workers nest their labels.
    pub trace_label: String,
    #[cfg(feature = "stealth")]
    pub stealth_client: Option<Arc<obscura_net::StealthHttpClient>>,
}

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
    pub(crate) fn spawn(
        &mut self,
        source: String,
        script_url: String,
        kind: String,
        environment: WorkerEnvironment,
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
        // The environment carries the creator's label in `trace_label`; the
        // host owns the worker counter, so the full label is minted here.
        let mut environment = environment;
        environment.trace_label = format!("worker({id})[{}]", environment.trace_label);
        let thread = std::thread::Builder::new()
            .name(format!("obscura-worker-{id}"))
            .spawn(move || {
                worker_thread_main(
                    id,
                    source,
                    script_url,
                    kind,
                    environment,
                    msg_rx,
                    out_tx,
                    ready_tx,
                )
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

pub type SharedWorkerRegistryHandle = Arc<Mutex<SharedWorkerRegistry>>;

pub fn new_shared_worker_registry() -> SharedWorkerRegistryHandle {
    Arc::new(Mutex::new(SharedWorkerRegistry::default()))
}

#[derive(Default)]
pub struct SharedWorkerRegistry {
    workers: HashMap<String, SharedWorkerProcess>,
    /// Worker-id counter shared by the trace labels, so dedicated and shared
    /// workers within one browser context never collide on `worker(M)`.
    next_worker: u32,
}

struct SharedWorkerProcess {
    to_worker: UnboundedSender<String>,
    routes: Arc<Mutex<HashMap<u64, UnboundedSender<String>>>>,
    next_connection: u64,
    isolate_handle: IsolateHandle,
    worker_join: Option<std::thread::JoinHandle<()>>,
    router_join: Option<std::thread::JoinHandle<()>>,
}

pub(crate) struct SharedWorkerConnection {
    to_worker: UnboundedSender<String>,
    routes: Arc<Mutex<HashMap<u64, UnboundedSender<String>>>>,
    connection_id: u64,
    outbox_rx: Rc<tokio::sync::Mutex<UnboundedReceiver<String>>>,
}

impl Drop for SharedWorkerConnection {
    fn drop(&mut self) {
        if let Ok(mut routes) = self.routes.lock() {
            routes.remove(&self.connection_id);
        }
    }
}

#[derive(Default)]
pub(crate) struct SharedWorkerPageHost {
    next_id: u32,
    connections: HashMap<u32, SharedWorkerConnection>,
}

impl SharedWorkerPageHost {
    pub(crate) fn insert(&mut self, connection: SharedWorkerConnection) -> u32 {
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let id = self.next_id;
        self.connections.insert(id, connection);
        id
    }

    pub(crate) fn post_message(&self, id: u32, payload: &str) -> bool {
        let Some(connection) = self.connections.get(&id) else { return false };
        let Ok(envelope) = serde_json::from_str::<serde_json::Value>(payload) else {
            return false;
        };
        let Some(_object) = envelope.as_object() else { return false };
        // The page-side connection id is preserved in the envelope. A page
        // normally has one native connection per SharedWorker entry; when
        // several JS ports share that connection, the single-route fallback
        // below still delivers the envelope so bootstrap can select its port.
        connection.to_worker.send(envelope.to_string()).is_ok()
    }

    pub(crate) fn outbox(
        &self,
        id: u32,
    ) -> Option<Rc<tokio::sync::Mutex<UnboundedReceiver<String>>>> {
        self.connections.get(&id).map(|connection| connection.outbox_rx.clone())
    }
}

impl SharedWorkerRegistry {
    pub(crate) fn connect(
        &mut self,
        key: String,
        source: String,
        script_url: String,
        kind: String,
        environment: WorkerEnvironment,
    ) -> Result<SharedWorkerConnection, String> {
        if !self.workers.contains_key(&key) {
            if self.workers.len() >= MAX_WORKERS {
                return Err(format!("shared worker limit reached ({MAX_WORKERS} per context)"));
            }
            self.next_worker = self.next_worker.saturating_add(1).max(1);
            let mut environment = environment;
            environment.trace_label =
                format!("worker({})[{}]", self.next_worker, environment.trace_label);
            self.workers.insert(
                key.clone(),
                spawn_shared_worker_process(source, script_url, kind, environment)?,
            );
        }
        let process = self.workers.get_mut(&key).expect("shared worker inserted");
        let connection_id = process.next_connection;
        process.next_connection = process.next_connection.wrapping_add(1).max(1);
        let (outbox_tx, outbox_rx) = unbounded_channel();
        process
            .routes
            .lock()
            .map_err(|_| "shared worker route registry poisoned".to_string())?
            .insert(connection_id, outbox_tx);
        if process
            .to_worker
            .send(serde_json::json!({ "connect": true, "c": connection_id }).to_string())
            .is_err()
        {
            if let Ok(mut routes) = process.routes.lock() {
                routes.remove(&connection_id);
            }
            return Err("shared worker thread exited".to_string());
        }
        Ok(SharedWorkerConnection {
            to_worker: process.to_worker.clone(),
            routes: Arc::clone(&process.routes),
            connection_id,
            outbox_rx: Rc::new(tokio::sync::Mutex::new(outbox_rx)),
        })
    }
}

fn spawn_shared_worker_process(
    source: String,
    script_url: String,
    kind: String,
    environment: WorkerEnvironment,
) -> Result<SharedWorkerProcess, String> {
    let (msg_tx, msg_rx) = unbounded_channel::<String>();
    let (out_tx, out_rx) = unbounded_channel::<String>();
    let (ready_tx, ready_rx) = std_mpsc::channel::<Result<IsolateHandle, String>>();
    let worker_thread = std::thread::Builder::new()
        .name("obscura-shared-worker".to_string())
        .spawn(move || {
            worker_thread_main(
                0,
                source,
                script_url,
                kind,
                environment,
                msg_rx,
                out_tx,
                ready_tx,
            )
        })
        .map_err(|error| format!("failed to spawn shared worker thread: {error}"))?;
    let isolate_handle = match ready_rx.recv_timeout(SPAWN_READY_TIMEOUT) {
        Ok(Ok(handle)) => handle,
        Ok(Err(message)) => {
            let _ = worker_thread.join();
            return Err(message);
        }
        Err(_) => return Err("shared worker runtime did not start in time".to_string()),
    };
    let routes = Arc::new(Mutex::new(HashMap::new()));
    let router_routes = Arc::clone(&routes);
    let router_thread = std::thread::Builder::new()
        .name("obscura-shared-worker-router".to_string())
        .spawn(move || route_shared_worker_outbox(out_rx, router_routes))
        .map_err(|error| format!("failed to spawn shared worker router: {error}"))?;
    Ok(SharedWorkerProcess {
        to_worker: msg_tx,
        routes,
        next_connection: 1,
        isolate_handle,
        worker_join: Some(worker_thread),
        router_join: Some(router_thread),
    })
}

fn route_shared_worker_outbox(
    mut outbox: UnboundedReceiver<String>,
    routes: Arc<Mutex<HashMap<u64, UnboundedSender<String>>>>,
) {
    while let Some(entry) = outbox.blocking_recv() {
        let parsed = serde_json::from_str::<serde_json::Value>(&entry).ok();
        let connection_id = parsed
            .as_ref()
            .and_then(|value| value.get("data"))
            .and_then(serde_json::Value::as_str)
            .and_then(|data| serde_json::from_str::<serde_json::Value>(data).ok())
            .and_then(|envelope| envelope.get("c").and_then(serde_json::Value::as_u64));
        let Ok(routes) = routes.lock() else { return };
        if let Some(connection_id) = connection_id {
            if let Some(route) = routes.get(&connection_id) {
                let _ = route.send(entry);
            } else if routes.len() == 1 {
                if let Some(route) = routes.values().next() {
                    let _ = route.send(entry);
                }
            }
        } else {
            for route in routes.values() {
                let _ = route.send(entry.clone());
            }
        }
    }
}

impl Drop for SharedWorkerProcess {
    fn drop(&mut self) {
        self.isolate_handle.terminate_execution();
        // Do not synchronously join isolate threads during page/context
        // teardown. V8 termination is asynchronous and an isolate parked in
        // its event loop may take a scheduling turn before observing it;
        // blocking here can wedge the owning page indefinitely. Dropping the
        // handles detaches the threads, which then exit when their channels
        // close (the same lifecycle used by dedicated workers).
        self.worker_join.take();
        self.router_join.take();
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
    id: u32,
    source: String,
    script_url: String,
    kind: String,
    mut environment: WorkerEnvironment,
    mut inbox: UnboundedReceiver<String>,
    out_tx: UnboundedSender<String>,
    ready_tx: std_mpsc::Sender<Result<IsolateHandle, String>>,
) {
    worker_debug(
        id,
        &format!("spawn kind={kind} url={script_url} source_len={}", source.len()),
    );
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
            let proxy_url = environment
                .http_client
                .as_ref()
                .and_then(|client| client.proxy_url().map(str::to_string));
            // Read before the field-by-field move into the runtime state below.
            let worker_name = std::mem::take(&mut environment.name);
            let worker_origin = std::mem::take(&mut environment.origin);
            let worker_secure = environment.secure_context;
            let worker_csp = environment.document_csp.take();
            let worker_shared = environment.shared;
            let trace_label = environment.trace_label.clone();
            let mut rt = ObscuraJsRuntime::with_base_url_and_proxy(&script_url, proxy_url);
            rt.set_fingerprint(&environment.fingerprint);
            // The worker's ambient execution-source label: author scripts push
            // script@<url> on top of it and message dispatches run on it.
            // Skipped entirely in production runs (zero surface difference).
            rt.set_trace_ambient(&trace_label);
            if crate::trace_source::enabled() {
                let label_json =
                    serde_json::Value::String(trace_label.clone()).to_string();
                let _ = rt.execute_script(
                    "<obscura:worker-trace-label>",
                    format!("globalThis.__obscura_trace_default_from = {label_json};").as_str(),
                );
            }
            // reqwest's pooled client is created inside the creator's Tokio
            // runtime. Build the worker's pool on this thread while retaining
            // the browser-context cookie jar, proxy and private-network
            // policy; moving the initialized pool across runtimes produces a
            // reqwest builder error on the first worker fetch.
            let worker_http_client = environment.http_client.as_ref().map(|creator| {
                Arc::new(obscura_net::ObscuraHttpClient::with_full_options_and_fingerprint(
                    environment
                        .cookie_jar
                        .clone()
                        .unwrap_or_else(|| Arc::new(obscura_net::CookieJar::new())),
                    creator.proxy_url(),
                    creator.allow_private_network,
                    environment.fingerprint.clone(),
                ))
            });
            {
                let state = rt.state_handle().clone();
                let mut gs = state.borrow_mut();
                gs.worker_outbox = Some(out_tx.clone());
                gs.url = script_url.clone();
                // Carried so a nested `new Worker(...)` can inherit it: this
                // runtime's `url` is the worker's own `blob:`/`data:` script
                // URL, which describes no origin to inherit from.
                gs.inherited_origin = Some(worker_origin.clone());
                gs.inherited_secure_context = worker_secure;
                gs.document_csp = worker_csp;
                gs.cookie_jar = environment.cookie_jar;
                gs.http_client = worker_http_client;
                gs.callbacks = environment.callbacks;
                gs.blocked_urls = environment.blocked_urls;
                gs.page_in_flight = environment.page_in_flight;
                #[cfg(feature = "stealth")]
                {
                    gs.stealth_client = environment.stealth_client;
                }
            }
            // Hand the isolate handle back before running author code so
            // spawn returns quickly even when the source never yields.
            if ready_tx.send(Ok(rt.isolate_handle())).is_err() {
                return;
            }
            if let Err(e) = rt.execute_script(
                "<obscura:worker-prep>",
                &worker_prep_script(
                    &script_url,
                    &worker_name,
                    &worker_origin,
                    worker_secure,
                    worker_shared,
                    crate::tracelog::enabled(),
                ),
            ) {
                let _ = out_tx.send(error_entry(&format!("worker global setup failed: {e}")));
                return;
            }
            // HTML "run a worker": the worker source executes exactly once.
            // Later messages only dispatch events (worker_event_loop below).
            // The classic source is one labeled code unit, like a document
            // script; modules keep the worker's ambient label (module graphs
            // are not attributable per-unit on either engine).
            let source_result = if kind == "module" {
                rt.load_inline_module(&source, &script_url, 30_000).await
            } else {
                let _trace_script = crate::trace_source::push(&format!("script@{script_url}"));
                rt.execute_script("<obscura:worker-script>", &source)
            };
            if let Err(e) = source_result {
                let _ = out_tx.send(error_entry(&e));
                if is_termination(&e) {
                    return;
                }
            }
            worker_event_loop(id, &mut rt, &mut inbox, &out_tx).await;
        });
    }));
    if result.is_err() {
        // Panic-isolated: the page only observes a closed channel plus this
        // error entry; the process (and the page isolate) keep running.
        let _ = panic_out_tx.send(error_entry("worker thread panicked"));
        let _ = panic_ready_tx.send(Err("worker thread panicked".to_string()));
    }
}

/// `OBSCURA_DEBUG_WORKER=1` reports worker isolate lifecycle. The challenge's
/// widget keeps a pool of short-lived workers and waits on their replies, so a
/// worker that exits while it still has queued work is worth seeing directly.
pub(crate) fn worker_debug(id: u32, message: &str) {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if *ENABLED.get_or_init(|| std::env::var_os("OBSCURA_DEBUG_WORKER").is_some()) {
        eprintln!("[worker-life] id={id} {message}");
    }
}

/// Pump the worker's own event loop (timers, microtasks, async ops) while
/// racing the page's message channel. Biased toward messages so a burst
/// drains before timer work; between tasks `run_event_loop` performs the
/// microtask checkpoints.
async fn worker_event_loop(
    id: u32,
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
            worker_debug(id, "exit: self.close() requested");
            return;
        }
        let turn = tokio::select! {
            biased;
            message = inbox.recv() => Turn::Message(message),
            pumped = rt.run_event_loop() => Turn::Idle(pumped),
        };
        match turn {
            Turn::Message(Some(payload)) => {
                worker_debug(id, &format!("dispatch {} bytes", payload.len()));
                if !dispatch_message(rt, &payload, out_tx) {
                    worker_debug(id, "exit: dispatch failed / terminated");
                    return;
                }
            }
            // Channel closed: the page terminated us or went away.
            Turn::Message(None) => {
                worker_debug(id, "exit: inbox closed (page dropped the worker)");
                return;
            }
            Turn::Idle(result) => {
                if let Err(error) = result {
                    if is_termination(&error) {
                        worker_debug(id, "exit: event loop terminated");
                        return;
                    }
                    let _ = out_tx.send(error_entry(&error));
                }
                if close_requested(rt) {
                    worker_debug(id, "exit: self.close() after idle");
                    return;
                }
                // JS fully idle (no pending timers/ops): park until the next
                // message or channel close instead of spinning.
                match inbox.recv().await {
                    Some(payload) => {
                        worker_debug(id, &format!("dispatch {} bytes (parked)", payload.len()));
                        if !dispatch_message(rt, &payload, out_tx) {
                            worker_debug(id, "exit: dispatch failed / terminated");
                            return;
                        }
                    }
                    None => {
                        worker_debug(id, "exit: inbox closed while parked");
                        return;
                    }
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

fn worker_prep_script(
    script_url: &str,
    name: &str,
    origin: &str,
    secure: bool,
    shared: bool,
    tracelog: bool,
) -> String {
    let json = |s: &str| serde_json::Value::String(s.to_string()).to_string();
    WORKER_PREP_TEMPLATE
        .replace("__OBSCURA_WORKER_URL__", &json(script_url))
        .replace("__OBSCURA_WORKER_NAME__", &json(name))
        .replace("__OBSCURA_WORKER_ORIGIN__", &json(origin))
        .replace("__OBSCURA_WORKER_SECURE__", if secure { "true" } else { "false" })
        .replace("__OBSCURA_WORKER_SHARED__", if shared { "true" } else { "false" })
        .replace("__OBSCURA_TRACELOG__", if tracelog { "true" } else { "false" })
}

/// Executed in the fresh worker runtime before the worker source. The
/// snapshot global is the page bootstrap's Window; this strips the
/// Window-only surface and installs the DedicatedWorkerGlobalScope API.
///
/// Parity matters here beyond correctness. A dedicated worker is the one
/// scope an anti-bot payload can inspect without the page ever seeing the
/// probe, and the cheapest tells are structural: `Object.prototype.toString`
/// on the global, `self.constructor.name`, whether `HTMLElement` resolves,
/// whether `navigator` carries `plugins`. A scope that answers "Window",
/// "[object Object]" and "yes" to those is not a worker in any browser.
const WORKER_PREP_TEMPLATE: &str = r#"(function () {
  var G = globalThis;
  var defineProperty = Object.defineProperty;
  // Snapshot WorkerGlobalScope is a different function object than the one
  // this prep installs, so `globalThis instanceof WorkerGlobalScope` is false
  // here. An explicit flag is the only check fetch/Request can trust.
  try {
    defineProperty(G, '__obscuraIsWorker', {
      value: true, writable: false, enumerable: false, configurable: false,
    });
  } catch (e) { G.__obscuraIsWorker = true; }
  var getOwnPropertyNames = Object.getOwnPropertyNames;
  // A worker's performance clock counts from the worker's own creation, like
  // Chrome's worker time origin. The startup snapshot otherwise leaves the
  // monotonic base at process start, so worker `performance.now()` reports
  // process uptime -- a proof-of-work shard then claims milliseconds-since-
  // boot as its compute duration, which no real browser produces.
  try {
    if (typeof G.__obscura_rebasePerformanceOrigin === 'function') {
      G.__obscura_rebasePerformanceOrigin(Date.now());
      G.performance.timeOrigin = Date.now();
    }
  } catch (e) {}
  // A shared worker's scope is branded SharedWorkerGlobalScope, reaches its
  // pages over connection ports rather than a scope-level `postMessage`, and
  // exposes `onconnect` where a dedicated scope exposes `onmessage`.
  var IS_SHARED = __OBSCURA_WORKER_SHARED__;
  var SCOPE_NAME = IS_SHARED ? 'SharedWorkerGlobalScope' : 'DedicatedWorkerGlobalScope';

  function def(target, name, value, enumerable) {
    defineProperty(target, name, {
      value: value, writable: true, enumerable: !!enumerable, configurable: true,
    });
  }
  function defGet(target, name, getter, enumerable) {
    defineProperty(target, name, {
      get: getter, enumerable: !!enumerable, configurable: true,
    });
  }
  // Accessor pair backing an `on*` IDL attribute: assignment sticks, reads
  // return the last assignment, and the initial value is null rather than
  // undefined (absent handlers are a tell -- browsers pre-declare them).
  function defEventHandler(target, name) {
    var current = null;
    defineProperty(target, name, {
      get: function () { return current; },
      set: function (v) { current = (typeof v === 'function' || (v && typeof v === 'object')) ? v : null; },
      enumerable: true, configurable: true,
    });
  }

  // ---------------------------------------------------------------------
  // 1. Strip the Window/DOM surface.
  //
  // The worker runtime boots from the page's snapshot, so every global the
  // page bootstrap installs is present here too -- `document`, `Element`,
  // `localStorage`, all 49 `HTML*Element` constructors. None of them exist
  // in a real DedicatedWorkerGlobalScope, and a single `typeof HTMLElement`
  // is enough to classify the scope. Deleted before anything below runs so
  // the worker API installs onto a clean global.
  // ---------------------------------------------------------------------
  var WINDOW_ONLY = [
    // Browsing-context self-references and the document tree.
    //
    // `external` is deliberately absent from this list even though stock
    // Chrome's External is [Exposed=Window]: it is where the tracing primitive
    // window.external.tracelog lives (tracelog.rs), so a worker that has to
    // instrument its own VM reaches it as `external.tracelog(...)`. `window`
    // itself stays deleted, as Chromium's DedicatedWorkerGlobalScope has no
    // such binding.
    'window', 'document', 'top', 'parent', 'frames', 'frameElement', 'length',
    'opener', 'name',
    // Window-only constructors
    'Window', 'Navigator', 'Location', 'History', 'Screen', 'Storage',
    'BarProp', 'VisualViewport', 'CustomElementRegistry', 'SharedWorker',
    // Core DOM (Exposed=Window)
    'Document', 'HTMLDocument', 'XMLDocument', 'DocumentFragment',
    'DocumentType', 'DOMImplementation', 'Element', 'Attr', 'CharacterData',
    'Text', 'Comment', 'CDATASection', 'ProcessingInstruction', 'Node',
    'NodeList', 'NodeFilter', 'NodeIterator', 'TreeWalker', 'HTMLCollection',
    'NamedNodeMap', 'ShadowRoot', 'Range', 'StaticRange', 'AbstractRange',
    'Selection', 'DOMParser', 'XMLSerializer', 'XSLTProcessor',
    'XPathEvaluator', 'XPathResult', 'XPathExpression', 'DOMTokenList',
    // DOMRect and DOMRectReadOnly are [Exposed=(Window,Worker)] and stay --
    // only the live-list form, which exists to back getClientRects(), is
    // Window-only.
    'DOMStringMap', 'DOMRectList',
    // Observers scoped to layout/DOM
    'MutationObserver', 'MutationRecord', 'IntersectionObserver',
    'IntersectionObserverEntry', 'ResizeObserver', 'ResizeObserverEntry',
    // CSSOM
    'CSS', 'CSSStyleDeclaration', 'CSSStyleSheet', 'CSSRule', 'CSSRuleList',
    'StyleSheet', 'StyleSheetList', 'MediaQueryList', 'getComputedStyle',
    'matchMedia',
    // Element factory aliases
    'Image', 'Audio', 'Option',
    // Window instance state and methods
    'localStorage', 'sessionStorage', 'history', 'screen', 'customElements',
    'visualViewport', 'chrome', 'speechSynthesis', 'SpeechSynthesisUtterance',
    'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'focus', 'blur',
    'stop', 'getSelection', 'scroll', 'scrollTo', 'scrollBy', 'moveTo',
    'moveBy', 'resizeTo', 'resizeBy',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback',
    'devicePixelRatio', 'innerWidth', 'innerHeight', 'outerWidth',
    'outerHeight', 'screenX', 'screenY', 'screenLeft', 'screenTop',
    'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
    'onload', 'onunload', 'onbeforeunload', 'onpagehide', 'onpageshow',
    'onhashchange', 'onpopstate', 'onstorage', 'onresize', 'onscroll',
  ];
  for (var i = 0; i < WINDOW_ONLY.length; i++) {
    try { delete G[WINDOW_ONLY[i]]; } catch (e) {}
  }
  // Chrome's DedicatedWorkerGlobalScope has no `document` binding at all.
  // A leftover `document = null` still answers `typeof document === "object"`,
  // and a challenge that branches on that (Turnstile's worker source) then
  // skips fetch("") / /ci/ and takes a failing PAT path instead.
  try { delete G.document; } catch (e) {}
  if (Object.prototype.hasOwnProperty.call(G, 'document')) {
    try {
      defineProperty(G, 'document', { value: undefined, configurable: true });
      delete G.document;
    } catch (e) {}
  }
  // Element interfaces are open-ended (HTMLDivElement, SVGPathElement, ...);
  // matching the prefix covers the ones this build has and any added later.
  var globalNames = getOwnPropertyNames(G);
  for (var j = 0; j < globalNames.length; j++) {
    var key = globalNames[j];
    if (/^(HTML|SVG|MathML)[A-Za-z]*Element$/.test(key)
        || /^HTML[A-Za-z]*Collection$/.test(key)) {
      try { delete G[key]; } catch (e) {}
    }
  }
  // Window-only `on*` handlers left over from the page bootstrap's bulk
  // GlobalEventHandlers install. The worker keeps only its own set, added
  // further down; anything else advertises DOM events a worker cannot fire.
  var WORKER_HANDLERS = {
    onerror: 1, onlanguagechange: 1,
    onoffline: 1, ononline: 1, onrejectionhandled: 1, onunhandledrejection: 1,
  };
  if (IS_SHARED) {
    WORKER_HANDLERS.onconnect = 1;
  } else {
    WORKER_HANDLERS.onmessage = 1;
    WORKER_HANDLERS.onmessageerror = 1;
  }
  var leftover = getOwnPropertyNames(G);
  for (var k = 0; k < leftover.length; k++) {
    var handler = leftover[k];
    if (handler.length > 2 && handler.slice(0, 2) === 'on' && !WORKER_HANDLERS[handler]) {
      try { delete G[handler]; } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------
  // 2. Brand the global as a DedicatedWorkerGlobalScope.
  //
  //   self -> DedicatedWorkerGlobalScope.prototype
  //        -> WorkerGlobalScope.prototype
  //        -> EventTarget.prototype
  //
  // This is what makes `self instanceof WorkerGlobalScope`,
  // `self.constructor.name` and `Object.prototype.toString.call(self)` agree
  // with a browser. Constructors throw on direct call, as the real ones do.
  // ---------------------------------------------------------------------
  function illegalConstructor(name) {
    var ctor = function () { throw new TypeError('Illegal constructor'); };
    defineProperty(ctor, 'name', { value: name, configurable: true });
    return ctor;
  }
  var EventTargetProto = (typeof EventTarget === 'function' && EventTarget.prototype)
    ? EventTarget.prototype : Object.prototype;
  // Whatever the snapshot left on the global's prototype stays reachable:
  // dropping it would take the runtime's own plumbing with it.
  var inheritedProto = Object.getPrototypeOf(G);

  var WorkerGlobalScope = illegalConstructor('WorkerGlobalScope');
  WorkerGlobalScope.prototype = Object.create(EventTargetProto);
  def(WorkerGlobalScope.prototype, 'constructor', WorkerGlobalScope);
  defineProperty(WorkerGlobalScope.prototype, Symbol.toStringTag, {
    value: 'WorkerGlobalScope', configurable: true,
  });
  if (inheritedProto && inheritedProto !== Object.prototype
      && inheritedProto !== EventTargetProto) {
    var carried = getOwnPropertyNames(inheritedProto);
    for (var c = 0; c < carried.length; c++) {
      if (carried[c] === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(WorkerGlobalScope.prototype, carried[c])) continue;
      var descriptor = Object.getOwnPropertyDescriptor(inheritedProto, carried[c]);
      if (descriptor) {
        try { defineProperty(WorkerGlobalScope.prototype, carried[c], descriptor); } catch (e) {}
      }
    }
  }

  var DedicatedWorkerGlobalScope = illegalConstructor(SCOPE_NAME);
  DedicatedWorkerGlobalScope.prototype = Object.create(WorkerGlobalScope.prototype);
  def(DedicatedWorkerGlobalScope.prototype, 'constructor', DedicatedWorkerGlobalScope);
  defineProperty(DedicatedWorkerGlobalScope.prototype, Symbol.toStringTag, {
    value: SCOPE_NAME, configurable: true,
  });
  try { Object.setPrototypeOf(G, DedicatedWorkerGlobalScope.prototype); } catch (e) {}

  // The page bootstrap pins `constructor` as an own property of the global so
  // framework environment gates see `self.constructor === Window`. In a worker
  // that own property shadows the prototype's and keeps reporting Window;
  // dropping it lets the DedicatedWorkerGlobalScope one through.
  try { delete G.constructor; } catch (e) {}
  if (Object.prototype.hasOwnProperty.call(G, 'constructor')) {
    try { def(G, 'constructor', DedicatedWorkerGlobalScope); } catch (e) {}
  }

  // Window exposes its child browsing contexts as indexed properties; the
  // bootstrap installs getters for 0..49 that read `document`. With the DOM
  // stripped those getters throw on access, where a worker global simply has
  // no indexed properties at all.
  for (var idx = 0; idx < 50; idx++) {
    try { delete G[idx]; } catch (e) {}
  }

  def(G, 'WorkerGlobalScope', WorkerGlobalScope);
  def(G, SCOPE_NAME, DedicatedWorkerGlobalScope);
  // `self` is a getter-only attribute in a browser, not a data property.
  defGet(G, 'self', function () { return G; }, true);

  // ---------------------------------------------------------------------
  // 3. WorkerLocation.
  //
  // `location` is pinned non-configurable by the page bootstrap, so the
  // object is re-branded in place rather than replaced: same identity, new
  // prototype, and the navigation methods removed -- a worker cannot
  // navigate, and `typeof location.assign === 'function'` says Window.
  // ---------------------------------------------------------------------
  G.__virtualUrl = __OBSCURA_WORKER_URL__;
  var WorkerLocation = illegalConstructor('WorkerLocation');
  defineProperty(WorkerLocation.prototype, Symbol.toStringTag, {
    value: 'WorkerLocation', configurable: true,
  });
  def(G, 'WorkerLocation', WorkerLocation);
  try {
    var loc = G.location;
    if (loc && typeof loc === 'object') {
      delete loc.assign;
      delete loc.reload;
      delete loc.replace;
      Object.setPrototypeOf(loc, WorkerLocation.prototype);
      // A blob:/data: worker inherits its creator's origin; deriving one from
      // the script URL yields "null" and contradicts the page it runs for.
      var inheritedOrigin = __OBSCURA_WORKER_ORIGIN__;
      if (inheritedOrigin) {
        defGet(loc, 'origin', function () { return inheritedOrigin; }, true);
      }
    }
  } catch (e) {}

  // ---------------------------------------------------------------------
  // 4. WorkerNavigator.
  //
  // Built by allowlist, not by deletion: WorkerNavigator is a much smaller
  // interface than Navigator, and the properties it omits are the ones that
  // depend on a document or a viewport. `navigator.plugins` resolving inside
  // a worker cannot happen in a browser.
  // ---------------------------------------------------------------------
  var WorkerNavigator = illegalConstructor('WorkerNavigator');
  defineProperty(WorkerNavigator.prototype, Symbol.toStringTag, {
    value: 'WorkerNavigator', configurable: true,
  });
  def(G, 'WorkerNavigator', WorkerNavigator);
  try {
    var pageNav = G.navigator;
    var workerNav = Object.create(WorkerNavigator.prototype);
    // Exactly the mixins WorkerNavigator includes: NavigatorID,
    // NavigatorLanguage, NavigatorOnLine, NavigatorConcurrentHardware,
    // NavigatorDeviceMemory, NavigatorStorage, NavigatorLocks,
    // NavigatorPermissions, NavigatorBeacon, plus userAgentData/connection/
    // serviceWorker/mediaCapabilities.
    var NAV_ALLOW = [
      'appCodeName', 'appName', 'appVersion', 'platform', 'product',
      'productSub', 'userAgent', 'vendor', 'vendorSub',
      'language', 'languages', 'onLine',
      'hardwareConcurrency', 'deviceMemory',
      'userAgentData', 'connection', 'locks', 'permissions',
      'mediaCapabilities', 'serviceWorker', 'sendBeacon',
    ];
    for (var n = 0; n < NAV_ALLOW.length; n++) {
      var prop = NAV_ALLOW[n];
      // Accessors are re-installed as accessors so per-page overrides
      // (hardwareConcurrency, deviceMemory) keep tracking their source.
      var own = Object.getOwnPropertyDescriptor(pageNav, prop);
      var proto = Object.getPrototypeOf(pageNav);
      var inherited = (!own && proto) ? Object.getOwnPropertyDescriptor(proto, prop) : null;
      var found = own || inherited;
      if (!found) continue;
      try { defineProperty(workerNav, prop, found); } catch (e) {}
    }
    if (__OBSCURA_WORKER_SECURE__ && typeof G.StorageManager === 'function'
        && typeof G.FileSystemHandle === 'function'
        && typeof G.FileSystemDirectoryHandle === 'function'
        && typeof G.FileSystemFileHandle === 'function') {
      var storageBrands = new WeakSet();
      var handleState = new WeakMap();
      var syncAccessState = new WeakMap();
      var rootNode = { kind: 'directory', name: '', parent: null, children: new Map() };
      var storageManager = Object.create(G.StorageManager.prototype);
      storageBrands.add(storageManager);
      var nativeRegistry = Deno[Symbol.for('obscura.nativeFunctionRegistry')];
      function nativeMethod(proto, name, length, fn) {
        try { defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
        try { defineProperty(fn, 'length', { value: length, configurable: true }); } catch (e) {}
        try { if (nativeRegistry) nativeRegistry.fns.add(fn); } catch (e) {}
        defineProperty(proto, name, {
          value: fn, writable: true, enumerable: true, configurable: true,
        });
      }
      function nativeGetter(proto, name, fn) {
        try { defineProperty(fn, 'name', { value: 'get ' + name, configurable: true }); } catch (e) {}
        try {
          if (nativeRegistry) {
            nativeRegistry.fns.add(fn);
            nativeRegistry.strings.set(fn, 'function get ' + name + '() { [native code] }');
          }
        } catch (e) {}
        defGet(proto, name, fn, true);
      }
      function storageData(value) {
        if (!storageBrands.has(value)) throw new TypeError('Illegal invocation');
      }
      function handleData(value) {
        var state = handleState.get(value);
        if (!state) throw new TypeError('Illegal invocation');
        return state;
      }
      function makeHandle(node) {
        var proto = node.kind === 'directory'
          ? G.FileSystemDirectoryHandle.prototype : G.FileSystemFileHandle.prototype;
        var handle = Object.create(proto);
        handleState.set(handle, node);
        return handle;
      }
      function validName(value) {
        var name = String(value);
        if (!name || name === '.' || name === '..' || name.indexOf('/') !== -1) {
          throw new TypeError('Name is not allowed.');
        }
        return name;
      }
      var rootHandle = makeHandle(rootNode);
      var storageCtorDescriptor = Object.getOwnPropertyDescriptor(
        G.StorageManager.prototype, 'constructor');
      for (var smi = 0; smi < 4; smi++) {
        try { delete G.StorageManager.prototype[
          ['constructor', 'estimate', 'persisted', 'getDirectory'][smi]]; } catch (e) {}
      }
      try { delete G.StorageManager.prototype.persist; } catch (e) {}
      nativeMethod(G.StorageManager.prototype, 'estimate', 0, async function () {
        // The same quota the document realm answers: one origin cannot report
        // two, and the reference capture's worker reads 10 GiB. The challenge
        // runs its storage probe in this realm, so a flat 5 GB here was the
        // value that actually reached the payload.
        storageData(this); return { quota: 10737418240, usage: 0, usageDetails: {} };
      });
      nativeMethod(G.StorageManager.prototype, 'persisted', 0, async function () {
        storageData(this); return false;
      });
      if (storageCtorDescriptor) {
        defineProperty(G.StorageManager.prototype, 'constructor', storageCtorDescriptor);
      }
      nativeMethod(G.StorageManager.prototype, 'getDirectory', 0, async function () {
        storageData(this); return rootHandle;
      });
      nativeGetter(G.FileSystemHandle.prototype, 'kind', function () {
        return handleData(this).kind;
      });
      nativeGetter(G.FileSystemHandle.prototype, 'name', function () {
        return handleData(this).name;
      });
      nativeMethod(G.FileSystemHandle.prototype, 'isSameEntry', 1, async function (other) {
        return handleData(this) === handleData(other);
      });
      function child(directory, value, kind, options) {
        var parent = handleData(directory);
        if (parent.kind !== 'directory') throw new TypeError('Illegal invocation');
        var name = validName(value);
        var node = parent.children.get(name);
        if (node && node.kind !== kind) throw new DOMException('', 'TypeMismatchError');
        if (!node) {
          if (!(options && options.create === true)) throw new DOMException('', 'NotFoundError');
          node = kind === 'directory'
            ? { kind: kind, name: name, parent: parent, children: new Map() }
            : { kind: kind, name: name, parent: parent, bytes: new Uint8Array(0) };
          parent.children.set(name, node);
        }
        return makeHandle(node);
      }
      nativeMethod(G.FileSystemDirectoryHandle.prototype, 'getDirectoryHandle', 1,
        async function (name, options) { return child(this, name, 'directory', options); });
      nativeMethod(G.FileSystemDirectoryHandle.prototype, 'getFileHandle', 1,
        async function (name, options) { return child(this, name, 'file', options); });
      nativeMethod(G.FileSystemDirectoryHandle.prototype, 'resolve', 1, async function (possible) {
        var directory = handleData(this), node = handleData(possible), path = [];
        while (node && node !== directory) { path.unshift(node.name); node = node.parent; }
        return node === directory ? path : null;
      });
      nativeMethod(G.FileSystemFileHandle.prototype, 'getFile', 0, async function () {
        var node = handleData(this);
        if (node.kind !== 'file') throw new TypeError('Illegal invocation');
        return new File([node.bytes], node.name);
      });
      var SyncAccessHandle = G.FileSystemSyncAccessHandle;
      if (typeof SyncAccessHandle !== 'function') {
        SyncAccessHandle = illegalConstructor('FileSystemSyncAccessHandle');
        defineProperty(SyncAccessHandle.prototype, Symbol.toStringTag, {
          value: 'FileSystemSyncAccessHandle', configurable: true,
        });
        def(G, 'FileSystemSyncAccessHandle', SyncAccessHandle);
      }
      try { if (nativeRegistry) nativeRegistry.fns.add(SyncAccessHandle); } catch (e) {}
      var syncCtorDescriptor = Object.getOwnPropertyDescriptor(
        SyncAccessHandle.prototype, 'constructor');
      for (var sai = 0; sai < 8; sai++) {
        try { delete SyncAccessHandle.prototype[
          ['constructor', 'close', 'flush', 'getSize', 'read', 'truncate', 'write', 'mode'][sai]]; }
        catch (e) {}
      }
      function syncData(value) {
        var state = syncAccessState.get(value);
        if (!state || state.closed) throw new DOMException('', 'InvalidStateError');
        return state;
      }
      function byteView(value) {
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) {
          return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        }
        throw new TypeError('The provided value is not of type BufferSource.');
      }
      // The backing file is the source of truth for cost, not for content: the
      // node's `bytes` stay authoritative so a handle opened twice in a row
      // reads what the other one wrote, and the ops below keep the file in step.
      function syncOpen(node) {
        try { return Deno.core.ops.op_opfs_sync_open(node.name || 'file', node.bytes); }
        catch (e) { return null; }
      }
      nativeMethod(SyncAccessHandle.prototype, 'close', 0, function () {
        var state = syncData(this);
        state.closed = true;
        state.node.syncOpen = false;
        if (state.fd !== null) {
          try { Deno.core.ops.op_opfs_sync_close(state.fd); } catch (e) {}
          state.fd = null;
        }
      });
      nativeMethod(SyncAccessHandle.prototype, 'flush', 0, function () {
        var state = syncData(this);
        if (state.fd !== null) Deno.core.ops.op_opfs_sync_flush(state.fd);
      });
      nativeMethod(SyncAccessHandle.prototype, 'getSize', 0, function () {
        var state = syncData(this);
        if (state.fd !== null) {
          try { return Deno.core.ops.op_opfs_sync_size(state.fd); } catch (e) {}
        }
        return state.node.bytes.length;
      });
      nativeMethod(SyncAccessHandle.prototype, 'read', 1, function (buffer, options) {
        var state = syncData(this), out = byteView(buffer);
        var at = options && options.at !== undefined
          ? Math.max(0, Number(options.at) || 0) : state.position;
        var count = Math.min(out.length, Math.max(0, state.node.bytes.length - at));
        if (state.fd !== null) {
          var read = Deno.core.ops.op_opfs_sync_read(state.fd, at, count);
          count = Math.min(count, read.length);
          out.set(read.subarray(0, count));
        } else {
          out.set(state.node.bytes.subarray(at, at + count));
        }
        state.position = at + count;
        return count;
      });
      nativeMethod(SyncAccessHandle.prototype, 'truncate', 1, function (size) {
        var state = syncData(this);
        size = Math.max(0, Math.trunc(Number(size) || 0));
        var next = new Uint8Array(size);
        next.set(state.node.bytes.subarray(0, size));
        state.node.bytes = next;
        state.position = Math.min(state.position, size);
        if (state.fd !== null) Deno.core.ops.op_opfs_sync_truncate(state.fd, size);
      });
      nativeMethod(SyncAccessHandle.prototype, 'write', 1, function (buffer, options) {
        var state = syncData(this), input = byteView(buffer);
        var at = options && options.at !== undefined
          ? Math.max(0, Number(options.at) || 0) : state.position;
        var size = Math.max(state.node.bytes.length, at + input.length);
        var next = new Uint8Array(size);
        next.set(state.node.bytes); next.set(input, at);
        state.node.bytes = next; state.position = at + input.length;
        if (state.fd !== null) Deno.core.ops.op_opfs_sync_write(state.fd, at, input);
        return input.length;
      });
      nativeGetter(SyncAccessHandle.prototype, 'mode', function () { syncData(this); return 'readwrite'; });
      if (syncCtorDescriptor) {
        defineProperty(SyncAccessHandle.prototype, 'constructor', syncCtorDescriptor);
      }
      nativeMethod(G.FileSystemFileHandle.prototype, 'createSyncAccessHandle', 0,
        async function () {
          var node = handleData(this);
          if (node.kind !== 'file') throw new TypeError('Illegal invocation');
          if (node.syncOpen) throw new DOMException('', 'NoModificationAllowedError');
          node.syncOpen = true;
          var access = Object.create(SyncAccessHandle.prototype);
          syncAccessState.set(access, {
            node: node, position: 0, closed: false, fd: syncOpen(node),
          });
          return access;
        });
      nativeGetter(WorkerNavigator.prototype, 'storage', function () { return storageManager; });
    }
    defineProperty(G, 'navigator', {
      get: function () { return workerNav; },
      enumerable: true, configurable: true,
    });
  } catch (e) {}

  // ---------------------------------------------------------------------
  // 5. WorkerGlobalScope / DedicatedWorkerGlobalScope attributes.
  // ---------------------------------------------------------------------
  // Defined on the global itself, not on the prototypes. WebIDL relocates the
  // members of a [Global] interface -- and of everything it inherits -- onto
  // the global object, which is why `self.hasOwnProperty('addEventListener')`
  // holds in a browser while the prototype chain carries only `constructor`.
  var workerName = __OBSCURA_WORKER_NAME__;
  var workerOrigin = __OBSCURA_WORKER_ORIGIN__;
  defGet(G, 'name', function () { return workerName; }, true);
  defGet(G, 'origin', function () {
    return workerOrigin || (G.location ? G.location.origin : 'null');
  }, true);
  // Decided by the creator's scheme, not parsed back out of the origin: a
  // file:// document is a secure context but serializes its origin to "null",
  // so the string cannot answer this.
  defGet(G, 'isSecureContext', function () { return __OBSCURA_WORKER_SECURE__; }, true);
  defGet(G, 'crossOriginIsolated', function () { return false; }, true);

  // ---------------------------------------------------------------------
  // 6. Event plumbing.
  //
  // addEventListener and dispatchEvent must share one registry. The page
  // bootstrap's dispatchEvent writes to the Window registry, so leaving it
  // in place meant `dispatchEvent(new MessageEvent('message'))` reached
  // nothing that `addEventListener('message', ...)` had registered.
  // ---------------------------------------------------------------------
  var listeners = Object.create(null);
  def(G, 'addEventListener', function addEventListener(type, fn, options) {
    if (!fn) return;
    var handler = typeof fn === 'function' ? fn
      : (typeof fn.handleEvent === 'function' ? fn.handleEvent.bind(fn) : null);
    if (!handler) return;
    var key = String(type);
    var ls = listeners[key] || (listeners[key] = []);
    for (var idx = 0; idx < ls.length; idx++) if (ls[idx].original === fn) return;
    ls.push({ original: fn, handler: handler, once: !!(options && options.once) });
  });
  def(G, 'removeEventListener', function removeEventListener(type, fn) {
    var ls = listeners[String(type)];
    if (!ls) return;
    for (var idx = 0; idx < ls.length; idx++) {
      if (ls[idx].original === fn) { ls.splice(idx, 1); return; }
    }
  });
  function fire(event, type) {
    var previousEvent;
    try { previousEvent = G.event; G.event = event; } catch (_) { previousEvent = undefined; }
    try {
    var handlerProp = G['on' + type];
    if (typeof handlerProp === 'function') {
      try { handlerProp.call(G, event); }
      catch (e) { try { console.error('Worker on' + type + ' error:', e); } catch (_) {} }
    }
    var ls = listeners[type];
    if (!ls || !ls.length) return;
    var snapshot = ls.slice();
    for (var idx = 0; idx < snapshot.length; idx++) {
      var entry = snapshot[idx];
      if (entry.once) removeEventListener(type, entry.original);
      try { entry.handler.call(G, event); }
      catch (e) { try { console.error('Worker ' + type + ' listener error:', e); } catch (_) {} }
    }
    } finally {
      try { G.event = previousEvent; } catch (_) {}
    }
  }
  def(G, 'dispatchEvent', function dispatchEvent(event) {
    if (!event || typeof event.type !== 'string') {
      throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.");
    }
    try { defineProperty(event, 'target', { value: G, configurable: true }); } catch (e) {}
    try { defineProperty(event, 'currentTarget', { value: G, configurable: true }); } catch (e) {}
    fire(event, event.type);
    return !event.defaultPrevented;
  });
  var HANDLER_NAMES = getOwnPropertyNames(WORKER_HANDLERS);
  for (var h = 0; h < HANDLER_NAMES.length; h++) {
    defEventHandler(G, HANDLER_NAMES[h]);
  }

  // Structured clone, JSON-clonable subset; `{v: data}` envelope so an
  // `undefined` payload round-trips as an absent property.
  // TODO(phase 3.11 follow-up): full structured clone + transfer lists.
  // A SharedWorkerGlobalScope has no `postMessage`: everything travels over
  // the ports handed out by `connect` events.
  if (!IS_SHARED) {
    def(G, 'postMessage', function postMessage(data) {
      if (typeof data === 'function' || typeof data === 'symbol') {
        throw new DOMException('The object could not be cloned.', 'DataCloneError');
      }
      var payload;
      try { payload = JSON.stringify({ v: data }); }
      catch (e) { throw new DOMException('The object could not be cloned.', 'DataCloneError'); }
      if (payload === undefined) payload = '{}';
      Deno.core.ops.op_worker_post_to_page(payload);
    });
  } else {
    try { delete G.postMessage; } catch (e) {}
  }

  def(G, 'close', function close() {
    G.__obscura_worker_closed = true;
    Deno.core.ops.op_worker_close();
  });

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
  def(G, 'importScripts', function importScripts() {
    for (var i = 0; i < arguments.length; i++) {
      var resolved;
      try { resolved = new URL(String(arguments[i]), G.location.href).href; }
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
  });

  // Entry point for the Rust side. Routed through the same `fire` path as
  // dispatchEvent so `onmessage` and `addEventListener('message')` observe
  // one ordering rather than two independent ones.
  // Shared workers: one MessageChannel per page-side connection. The page
  // holds one end, the worker script gets the other through the `connect`
  // event, and the bridge end forwards in both directions tagged with the
  // connection id. Reusing MessagePort rather than inventing a port type
  // keeps `ports[0] instanceof MessagePort`, structured cloning and the
  // start()/queue semantics exactly as the page bootstrap implements them.
  var SHARED_BRIDGES = IS_SHARED ? new Map() : null;

  function sharedConnect(connectionId) {
    if (SHARED_BRIDGES.has(connectionId)) return;
    var channel = new MessageChannel();
    var bridge = channel.port2;
    SHARED_BRIDGES.set(connectionId, bridge);
    bridge.onmessage = function (event) {
      var payload;
      try { payload = JSON.stringify({ v: event.data, c: connectionId }); }
      catch (e) { return; }
      if (payload === undefined) return;
      Deno.core.ops.op_worker_post_to_page(payload);
    };
    var event = new MessageEvent('connect', {
      data: '', origin: '', lastEventId: '', source: null,
      ports: [channel.port1],
    });
    if (typeof G.__obscura_markTrusted === 'function') G.__obscura_markTrusted(event);
    try { defineProperty(event, 'target', { value: G, configurable: true }); } catch (e) {}
    try { defineProperty(event, 'currentTarget', { value: G, configurable: true }); } catch (e) {}
    fire(event, 'connect');
  }

  G.__obscura_worker_dispatch_message = function (payload) {
    if (G.__obscura_worker_closed) return;
    if (IS_SHARED) {
      var envelope;
      try { envelope = JSON.parse(payload); } catch (e) { return; }
      if (!envelope || typeof envelope.c !== 'number') return;
      if (envelope.connect) { sharedConnect(envelope.c); return; }
      var bridge = SHARED_BRIDGES.get(envelope.c);
      // Delivering through the bridge end runs the page's own port queue and
      // start() gating on the worker script's end.
      if (bridge) { try { bridge.postMessage(envelope.v); } catch (e) {} }
      return;
    }
    var data;
    try { data = JSON.parse(payload).v; } catch (e) { return; }
    // The user agent dispatches this one, so it is trusted. Worker payloads
    // routinely gate on the whole triple -- Turnstile ships a worker whose
    // handler is `e.isTrusted && '' === e.origin && null === e.source && eval(...)`
    // -- and an untrusted event makes such a worker sit silently forever:
    // no eval, no reply, no error for anyone to see.
    var event = new MessageEvent('message', { data: data });
    if (typeof G.__obscura_markTrusted === 'function') G.__obscura_markTrusted(event);
    try { defineProperty(event, 'target', { value: G, configurable: true }); } catch (e) {}
    try { defineProperty(event, 'currentTarget', { value: G, configurable: true }); } catch (e) {}
    fire(event, 'message');
  };

  // A worker inherits its creator's secure-context status, and the same APIs
  // go away here as on the page. Last in the prep script so it removes what
  // the steps above have finished installing. `isSecureContext` matching while
  // `crypto.subtle` still answered would be an engine-internal contradiction
  // any script could read in two lines. Checked against Chrome 146 in
  // js-repros/secure-context/chrome-oracle.json.
  if (!__OBSCURA_WORKER_SECURE__) {
    var gatedGlobals = ['caches', 'CacheStorage', 'Cache'];
    for (var gi = 0; gi < gatedGlobals.length; gi++) {
      try { delete G[gatedGlobals[gi]]; } catch (e) {}
    }
    var gatedOnNavigator = ['serviceWorker', 'storage', 'locks', 'mediaDevices'];
    for (var ni = 0; ni < gatedOnNavigator.length; ni++) {
      try { if (G.navigator) delete G.navigator[gatedOnNavigator[ni]]; } catch (e) {}
    }
    try { if (G.crypto) delete G.crypto.subtle; } catch (e) {}
  }

  // A window realm gets external.tracelog from the bootstrap, gated on whether
  // the host configured a destination. A worker boots from the page snapshot,
  // where that gate was already false at snapshot build time, so the primitive
  // has to be installed here too, or the one scope an anti-bot payload owns
  // outright is the one scope that cannot be instrumented. Present only when
  // the host asked for tracing, same as the window realm.
  if (__OBSCURA_TRACELOG__) {
    try {
      var ExternalCtor = G.External;
      if (ExternalCtor && ExternalCtor.prototype &&
          typeof ExternalCtor.prototype.tracelog !== 'function') {
        defineProperty(ExternalCtor.prototype, 'tracelog', {
          value: function tracelog(key, value) {
            var json;
            try { json = JSON.stringify(value); } catch (e) { json = undefined; }
            try {
              Deno.core.ops.op_tracelog(
                typeof key === 'string' ? key : String(key),
                typeof json === 'string' ? json : '');
            } catch (e) {}
          },
          writable: true, enumerable: true, configurable: true,
        });
      }
    } catch (e) {}
  }
})();
"#;

#[cfg(test)]
mod tests {
    use crate::runtime::ObscuraJsRuntime;
    use obscura_dom::parse_html;
    use std::sync::Arc;

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

    /// A shared worker runs one thread per (name, url) within the page, hands
    /// each construction its own MessagePort, and brands its scope
    /// SharedWorkerGlobalScope with no scope-level postMessage. Pinned against
    /// Chrome 146 in js-repros/shared-worker/chrome-oracle.json.
    #[tokio::test(flavor = "current_thread")]
    async fn shared_worker_connects_reuses_one_thread_and_brands_its_scope() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "let seen = 0;"
              + "self.onconnect = function (e) {"
              + "  seen++;"
              + "  const port = e.ports[0];"
              + "  const connection = seen;"
              + "  port.onmessage = function (m) {"
              + "    port.postMessage({ echo: m.data, connection: connection,"
              + "      tag: Object.prototype.toString.call(self),"
              + "      post: typeof self.postMessage, name: self.name,"
              + "      dom: typeof document });"
              + "  };"
              + "};";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            // Same name: one worker thread, two connections.
            const first = new SharedWorker(url, { name: 'alpha' });
            const second = new SharedWorker(url, { name: 'alpha' });
            // Different name: a separate thread whose counter restarts.
            const other = new SharedWorker(url, { name: 'beta' });
            globalThis.__portIsMessagePort = first.port instanceof MessagePort;
            globalThis.__distinct = first !== second;
            globalThis.__hasTerminate = typeof first.terminate;
            for (const [worker, tag] of [[first, 'a'], [second, 'b'], [other, 'c']]) {
              worker.port.onmessage = (e) => {
                globalThis.__got.push(tag + ':' + e.data.connection + ':' + e.data.echo
                  + ':' + e.data.tag + ':' + e.data.post + ':' + e.data.name
                  + ':' + e.data.dom);
              };
              worker.port.postMessage('ping');
            }
            globalThis.__crossOrigin = (() => {
              try { new SharedWorker('https://other.example/w.js'); return 'constructed'; }
              catch (error) { return error.name; }
            })();
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "globalThis.__got.length === 3 ? JSON.stringify(globalThis.__got.slice().sort()) : ''",
            &serde_json::json!(
                r#"["a:1:ping:[object SharedWorkerGlobalScope]:undefined:alpha:undefined",\
"b:2:ping:[object SharedWorkerGlobalScope]:undefined:alpha:undefined",\
"c:1:ping:[object SharedWorkerGlobalScope]:undefined:beta:undefined"]"#
                    .replace("\\\n", "")
            ),
        )
        .await;
        assert_eq!(rt.evaluate("globalThis.__portIsMessagePort").unwrap(), serde_json::json!(true));
        assert_eq!(rt.evaluate("globalThis.__distinct").unwrap(), serde_json::json!(true));
        assert_eq!(
            rt.evaluate("globalThis.__hasTerminate").unwrap(),
            serde_json::json!("undefined")
        );
        assert_eq!(
            rt.evaluate("globalThis.__crossOrigin").unwrap(),
            serde_json::json!("SecurityError")
        );
    }

    /// A port the page never start()s queues its messages instead of
    /// delivering them; start() then flushes the queue.
    #[tokio::test(flavor = "current_thread")]
    async fn shared_worker_port_delivery_waits_for_start() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "self.onconnect = function (e) {"
              + "  const port = e.ports[0];"
              + "  port.onmessage = function (m) { port.postMessage('reply:' + m.data); };"
              + "};";
            const worker = new SharedWorker(
              'data:text/javascript,' + encodeURIComponent(src), { name: 'gated' });
            globalThis.__delivered = [];
            // addEventListener alone must not enable delivery.
            worker.port.addEventListener('message', (e) => {
              globalThis.__delivered.push(e.data);
            });
            worker.port.postMessage('one');
            globalThis.__startPort = () => worker.port.start();
            "#,
        )
        .unwrap();
        // Give the round trip room to arrive at the unstarted port.
        for _ in 0..40 {
            let _ = rt.run_event_loop_bounded(25).await;
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            rt.evaluate("JSON.stringify(globalThis.__delivered)").unwrap(),
            serde_json::json!("[]"),
            "an unstarted port must queue, not deliver"
        );
        rt.execute_script("<start>", "globalThis.__startPort();").unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__delivered)",
            &serde_json::json!(r#"["reply:one"]"#),
        )
        .await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_inherits_the_creator_fingerprint_contract() {
        let mut rt = ObscuraJsRuntime::new();
        let fingerprint = obscura_net::BrowserFingerprint::from_user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        ).with_overrides(&obscura_net::FingerprintOverrides {
            hardware_concurrency: Some(12),
            device_memory: Some(4.0),
            ..obscura_net::FingerprintOverrides::default()
        });
        rt.set_fingerprint(&fingerprint);
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url("https://example.com/app/");
        rt.run_page_init();
        rt.execute_script(
            "<fingerprint-worker>",
            r#"
            const source = `postMessage({
              userAgent:navigator.userAgent,
              platform:navigator.platform,
              hardwareConcurrency:navigator.hardwareConcurrency,
              deviceMemory:navigator.deviceMemory,
              userAgentData:navigator.userAgentData.toJSON()
            })`;
            globalThis.__got = [];
            new Worker(URL.createObjectURL(new Blob([source], {type:'text/javascript'})))
              .onmessage = event => globalThis.__got.push(event.data);
            "#,
        ).unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(rt.evaluate("JSON.stringify(globalThis.__got[0])").unwrap(), serde_json::json!(
            r#"{"userAgent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36","platform":"Linux x86_64","hardwareConcurrency":12,"deviceMemory":4,"userAgentData":{"brands":[{"brand":"Chromium","version":"146"},{"brand":"Not-A.Brand","version":"24"},{"brand":"Google Chrome","version":"146"}],"mobile":false,"platform":"Linux"}}"#
        ));
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

    /// The structural tells a fingerprinting payload reads first. Each of
    /// these answered "Window" or "[object Object]" before the scope was
    /// branded, which is not a shape any browser produces.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_scope_is_branded_as_a_dedicated_worker_global_scope() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "postMessage({" +
              "tag: Object.prototype.toString.call(self)," +
              "ctor: self.constructor.name," +
              "protoCtor: Object.getPrototypeOf(self).constructor.name," +
              "isDedicated: self instanceof DedicatedWorkerGlobalScope," +
              "isWorkerScope: self instanceof WorkerGlobalScope," +
              "isEventTarget: self instanceof EventTarget," +
              "name: self.name, ownName: Object.prototype.hasOwnProperty.call(self, 'name')," +
              "origin: typeof origin, secure: typeof isSecureContext," +
              "isolated: typeof crossOriginIsolated });";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            new Worker(url).onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        let got = rt.evaluate("JSON.stringify(__got[0])").unwrap();
        assert_eq!(
            got,
            serde_json::json!(
                r#"{"tag":"[object DedicatedWorkerGlobalScope]","ctor":"DedicatedWorkerGlobalScope","protoCtor":"DedicatedWorkerGlobalScope","isDedicated":true,"isWorkerScope":true,"isEventTarget":true,"name":"","ownName":true,"origin":"string","secure":"boolean","isolated":"boolean"}"#
            ),
        );
    }

    /// A worker created inside a worker inherits the same origin. The nested
    /// worker's creator URL is its parent's `data:`/`blob:` script URL, which
    /// carries no origin, and the parent runtime's `url` is that same script
    /// URL -- so without the inherited value being carried forward the chain
    /// collapses to "null" one level down.
    #[tokio::test(flavor = "current_thread")]
    async fn nested_worker_inherits_the_document_origin() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            // The inner worker reports its scope; the outer one relays it
            // alongside its own so both levels are visible at once. The inner
            // URL is embedded with JSON.stringify: encodeURIComponent leaves
            // quotes alone, so concatenating it into a quoted literal would
            // let a quote in the source terminate that literal early.
            const innerUrl = 'data:text/javascript,'
              + encodeURIComponent("postMessage({origin: origin, secure: isSecureContext})");
            const outer = [
              "var scope = {origin: origin, secure: isSecureContext};",
              "postMessage({hello: scope});",
              "try {",
              "  var child = new Worker(" + JSON.stringify(innerUrl) + ");",
              "  child.onmessage = function (e) { postMessage({outer: scope, inner: e.data}); };",
              "  child.onerror = function (e) { postMessage({outer: scope, childError: String(e.message || e)}); };",
              "} catch (err) { postMessage({outer: scope, threw: String(err && err.message || err)}); }",
            ].join("");
            globalThis.__got = [];
            const w = new Worker('data:text/javascript,' + encodeURIComponent(outer));
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.onerror = (e) => { globalThis.__got.push({error: String(e.message || e)}); };
            "#,
        )
        .unwrap();
        // Two worker threads, each building its own isolate behind the shared
        // creation lock, so this chain needs a longer budget than a
        // single-level round trip.
        for _ in 0..1200 {
            let _ = rt.run_event_loop_bounded(25).await;
            if rt.evaluate("globalThis.__got.length").unwrap() == serde_json::json!(2.0) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        // page_runtime() serves http://example.com/app/index.html. The relay
        // carries both levels: [0] is the outer worker announcing itself, [1]
        // is the outer worker forwarding what the nested one reported.
        assert_eq!(
            rt.evaluate(
                "JSON.stringify([__got[1].outer.origin, __got[1].inner.origin, \
                 __got[1].outer.secure, __got[1].inner.secure])"
            )
            .unwrap(),
            serde_json::json!(r#"["http://example.com","http://example.com",false,false]"#),
        );
    }

    /// A `blob:` URL carries its creator's origin in its path, so a worker
    /// built from one reports that origin rather than an opaque "null" -- and
    /// an https creator makes it a secure context.
    #[tokio::test(flavor = "current_thread")]
    async fn blob_worker_reports_the_creating_origin() {
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url("https://secure.example/app/index.html");
        rt.run_page_init();
        rt.execute_script(
            "<test>",
            r#"
            const source = "postMessage({origin: origin, secure: isSecureContext, href: location.href})";
            const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
            globalThis.__blobUrl = url;
            globalThis.__got = [];
            new Worker(url).onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate(
                "JSON.stringify([__got[0].origin, __got[0].secure, __got[0].href === __blobUrl])"
            )
            .unwrap(),
            serde_json::json!(r#"["https://secure.example",true,true]"#),
        );
    }

    /// Relative fetch/Request inside a blob worker is resolved against the
    /// creating document origin, not the blob: script URL. fetch("") from a
    /// Turnstile widget worker has to hit https://challenges.cloudflare.com/,
    /// not re-fetch the worker source.
    #[tokio::test(flavor = "current_thread")]
    async fn blob_worker_relative_fetch_uses_creator_origin() {
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/av0/rch/x");
        rt.run_page_init();
        rt.execute_script(
            "<test>",
            r#"
            const source = "postMessage({ request: new Request('').url, empty: new URL('', self.origin + '/').href })";
            const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
            globalThis.__got = [];
            new Worker(url).onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify([__got[0].request, __got[0].empty])")
                .unwrap(),
            serde_json::json!(
                r#"["https://challenges.cloudflare.com/","https://challenges.cloudflare.com/"]"#
            ),
        );
    }

    /// `new Worker(url, {name})` reaches `self.name`, and the default is the
    /// empty string rather than an absent binding.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_name_option_reaches_the_worker_scope() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "postMessage(self.name);";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            const push = (e) => { globalThis.__got.push(e.data); };
            new Worker(url, { name: 'pow-worker' }).onmessage = push;
            new Worker(url).onmessage = push;
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(2.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got.slice().sort())").unwrap(),
            serde_json::json!(r#"["","pow-worker"]"#),
        );
    }

    /// A worker has no DOM. The runtime boots from the page snapshot, so every
    /// one of these resolved until they were stripped -- and `typeof
    /// HTMLElement` alone separates a worker from anything pretending to be
    /// one.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_scope_exposes_no_dom_or_window_interfaces() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const names = ['document','window','Document','Element','HTMLElement',
              'HTMLDivElement','Node','NodeList','ShadowRoot','DOMParser','Range',
              'MutationObserver','IntersectionObserver','CSS','Image',
              'localStorage','sessionStorage','history','screen','customElements',
              'chrome','alert','matchMedia','getComputedStyle',
              'requestAnimationFrame','innerWidth','devicePixelRatio',
              'Window','Navigator','SharedWorker'];
            // The other direction: stripping the Window surface must not take
            // anything [Exposed=(Window,Worker)] with it. DOMRect and
            // DOMRectReadOnly were removed by an over-broad DOM* sweep and are
            // the reason this half of the assertion exists.
            const kept = ['DOMRect','DOMRectReadOnly','MessageChannel','MessagePort',
              'MessageEvent','BroadcastChannel','Event','EventTarget','ErrorEvent',
              'Blob','File','FileReader','URL','URLSearchParams','TextEncoder',
              'TextDecoder','ReadableStream','AbortController','Headers','Request',
              'Response','fetch','WebSocket','XMLHttpRequest','FormData','crypto',
              'performance','PerformanceObserver','ImageData','OffscreenCanvas',
              'createImageBitmap','Worker','indexedDB','caches','structuredClone',
              'queueMicrotask','reportError','atob','btoa','setTimeout','setInterval'];
            const src = "const names = " + JSON.stringify(names) + ";" +
              "const kept = " + JSON.stringify(kept) + ";" +
              "postMessage({ leaked: names.filter((n) => typeof self[n] !== 'undefined')," +
              " dropped: kept.filter((n) => typeof self[n] === 'undefined')," +
              " indexed: Object.getOwnPropertyNames(self).filter((k) => /^[0-9]+$/.test(k)).length });";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            new Worker(url).onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got[0])").unwrap(),
            // `caches` is gone because this worker's creator is
            // http://example.com -- an insecure origin, where Chrome exposes
            // no CacheStorage either. The rest of the WorkerGlobalScope set is
            // unaffected. See js-repros/secure-context/.
            serde_json::json!(r#"{"leaked":[],"dropped":["caches"],"indexed":0}"#),
        );
    }

    /// WorkerNavigator is a smaller interface than Navigator, and what it
    /// leaves out is exactly what needs a document. `navigator.plugins`
    /// resolving inside a worker cannot happen in a browser.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_navigator_and_location_are_worker_interfaces() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "postMessage({" +
              "navCtor: navigator.constructor.name," +
              "navTag: Object.prototype.toString.call(navigator)," +
              "ua: typeof navigator.userAgent, cores: typeof navigator.hardwareConcurrency," +
              "windowOnly: ['plugins','mimeTypes','geolocation','mediaDevices','clipboard'," +
                "'doNotTrack','maxTouchPoints','cookieEnabled','webdriver','getBattery']" +
                ".filter((k) => navigator[k] !== undefined)," +
              "locCtor: location.constructor.name," +
              "locTag: Object.prototype.toString.call(location)," +
              "navMethods: ['assign','reload','replace'].filter((k) => typeof location[k] === 'function') });";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            new Worker(url).onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got[0])").unwrap(),
            serde_json::json!(
                r#"{"navCtor":"WorkerNavigator","navTag":"[object WorkerNavigator]","ua":"string","cores":"number","windowOnly":[],"locCtor":"WorkerLocation","locTag":"[object WorkerLocation]","navMethods":[]}"#
            ),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn secure_worker_storage_exposes_branded_origin_private_root() {
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url("https://example.com/app/index.html");
        rt.run_page_init();
        rt.execute_script(
            "<test>",
            r#"
            const src = "onmessage=async()=>{try{" +
              "const storage=navigator.storage;const root=await storage.getDirectory();" +
              "const child=await root.getDirectoryHandle('sub',{create:true});" +
              "const file=await root.getFileHandle('probe.bin',{create:true});" +
              "const access=await file.createSyncAccessHandle();" +
              "const written=access.write(new Uint8Array([7,8,9]),{at:0});access.flush();" +
              "const readBytes=new Uint8Array(3);const read=access.read(readBytes,{at:0});" +
              "postMessage({navOwn:Object.prototype.hasOwnProperty.call(navigator,'storage')," +
              "storageTag:Object.prototype.toString.call(storage)," +
              "storageInstance:storage instanceof StorageManager," +
              "storageProto:Object.getOwnPropertyNames(StorageManager.prototype)," +
              "rootTag:Object.prototype.toString.call(root),kind:root.kind,name:root.name," +
              "directory:root instanceof FileSystemDirectoryHandle," +
              "handle:root instanceof FileSystemHandle,stable:storage===navigator.storage," +
              "resolve:await root.resolve(child),syncTag:Object.prototype.toString.call(access)," +
              "syncInstance:access instanceof FileSystemSyncAccessHandle," +
              "syncOwn:Object.getOwnPropertyNames(access)," +
              "syncProto:Object.getOwnPropertyNames(FileSystemSyncAccessHandle.prototype)," +
              "written,read,bytes:Array.from(readBytes),size:access.getSize(),mode:access.mode});" +
              "access.close();}catch(error){postMessage({error:error.name+': '+error.message})}}";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            const worker = new Worker(url);
            worker.onmessage = (event) => { globalThis.__got.push(event.data); };
            worker.postMessage(1);
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got[0])").unwrap(),
            serde_json::json!(
                r#"{"navOwn":false,"storageTag":"[object StorageManager]","storageInstance":true,"storageProto":["estimate","persisted","constructor","getDirectory"],"rootTag":"[object FileSystemDirectoryHandle]","kind":"directory","name":"","directory":true,"handle":true,"stable":true,"resolve":["sub"],"syncTag":"[object FileSystemSyncAccessHandle]","syncInstance":true,"syncOwn":[],"syncProto":["close","flush","getSize","read","truncate","write","mode","constructor"],"written":3,"read":3,"bytes":[7,8,9],"size":3,"mode":"readwrite"}"#
            ),
        );
    }

    /// addEventListener and dispatchEvent have to share one registry. They did
    /// not: the prep script installed its own listener list while leaving the
    /// page bootstrap's dispatchEvent in place, so a dispatched event reached
    /// nothing that had been registered.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_dispatch_event_reaches_listeners_and_handlers() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "const seen = [];" +
              "self.onping = null;" +
              "addEventListener('ping', () => seen.push('listener'));" +
              "addEventListener('ping', () => seen.push('once'), { once: true });" +
              "dispatchEvent(new Event('ping'));" +
              "dispatchEvent(new Event('ping'));" +
              "const evt = new Event('probe');" +
              "let target = null;" +
              "addEventListener('probe', (e) => { target = e.target === self; });" +
              "dispatchEvent(evt);" +
              "postMessage({ seen, target });";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            new Worker(url).onmessage = (e) => { globalThis.__got.push(e.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got[0])").unwrap(),
            serde_json::json!(r#"{"seen":["listener","once","listener"],"target":true}"#),
        );
    }

    /// A message must reach `onmessage` and `addEventListener('message')`
    /// alike; they run off one registry now, so ordering is single-valued.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_message_reaches_both_handler_and_listener() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "const seen = [];" +
              "onmessage = (e) => { seen.push('handler:' + e.data); };" +
              "addEventListener('message', (e) => {" +
                "seen.push('listener:' + e.data); postMessage(seen); });";
            const url = 'data:text/javascript,' + encodeURIComponent(src);
            globalThis.__got = [];
            const w = new Worker(url);
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage('x');
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got[0])").unwrap(),
            serde_json::json!(r#"["handler:x","listener:x"]"#),
        );
    }

    /// A worker payload that gates on the event being user-agent dispatched
    /// gets nothing at all when the flag is wrong: no eval, no reply, no
    /// error. Turnstile ships exactly such a worker --
    /// `e.isTrusted && '' === e.origin && null === e.source && eval(e.data)`.
    #[tokio::test(flavor = "current_thread")]
    async fn a_workers_incoming_message_is_trusted_like_the_user_agent_dispatched_it() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const src = "onmessage = function (e) { postMessage({"
              + " isTrusted: e.isTrusted, origin: e.origin,"
              + " sourceIsNull: e.source === null,"
              + " gate: !!(e.isTrusted && '' === e.origin && null === e.source)"
              + "}); };";
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            globalThis.__gate = null;
            w.onmessage = (e) => { globalThis.__gate = e.data; };
            w.postMessage('probe');
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__gate)",
            &serde_json::json!(
                r#"{"isTrusted":true,"origin":"","sourceIsNull":true,"gate":true}"#
            ),
        )
        .await;
    }

    /// Turnstile's widget worker is `onmessage = e => e.isTrusted && eval(e.data)`.
    /// The posted payload is source, not a structured clone of an object, and
    /// fetch("") inside it has to resolve to the creating document origin.
    #[tokio::test(flavor = "current_thread")]
    async fn blob_worker_evals_posted_source_and_relative_fetch_hits_creator_origin() {
        // `doc` is the probe: the blob's own bootstrap evals the posted source
        // inside the worker scope, where `document` does not exist. A scope that
        // answers "object" evaluated it in the creating document instead.
        let mut rt = page_runtime();
        rt.set_url("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/av0/rch/x");
        rt.execute_script(
            "<test>",
            r#"
            const src = "onmessage = function (e) {"
              + " if (e.isTrusted && e.origin === '' && e.source === null) eval(e.data);"
              + "};";
            const url = URL.createObjectURL(new Blob([src], {type: 'text/javascript'}));
            globalThis.__got = [];
            const w = new Worker(url);
            w.onmessage = (e) => { globalThis.__got.push(e.data); };
            w.postMessage("postMessage({ doc: typeof document, url: new Request('').url })");
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate("JSON.stringify(__got[0])").unwrap(),
            serde_json::json!(
                r#"{"doc":"undefined","url":"https://challenges.cloudflare.com/"}"#
            ),
        );
    }

    /// A MessageEvent has to arrive with its whole IDL, not just `data`. A
    /// Cloudflare challenge reads `bubbles`, `cancelable`, `composed`, `ports`
    /// and `lastEventId` off every message it receives; while the constructor
    /// filled in only `data` those five read back `undefined` and the
    /// challenge discarded the message. Both directions are checked because
    /// they build their events in different places -- the worker's inbound
    /// event comes from `__obscura_worker_dispatch_message` here, the page's
    /// from the receive loop in bootstrap.js -- and each has regressed alone.
    #[tokio::test(flavor = "current_thread")]
    async fn worker_message_events_carry_the_whole_idl() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            function shape(e) {
              return [e.constructor.name, JSON.stringify(e.origin),
                      JSON.stringify(e.lastEventId), e.source === null,
                      Array.isArray(e.ports), e.ports.length, e.bubbles,
                      e.cancelable, e.composed, typeof e.composedPath].join('|');
            }
            const src = shape.toString() +
              ";onmessage = (e) => { postMessage(shape(e)); };";
            globalThis.__got = [];
            const w = new Worker('data:text/javascript,' + encodeURIComponent(src));
            w.onmessage = (e) => { globalThis.__got.push([e.data, shape(e)]); };
            w.postMessage('x');
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        // A worker message has no sender origin, no source window and no
        // transferred ports, so every optional member sits at its default.
        let expected = r#"MessageEvent|""|""|true|true|0|false|false|false|function"#;
        assert_eq!(
            rt.evaluate("__got[0][0]").unwrap(),
            serde_json::json!(expected),
            "worker-side event"
        );
        assert_eq!(
            rt.evaluate("__got[0][1]").unwrap(),
            serde_json::json!(expected),
            "page-side event"
        );
    }

    /// `blob:<origin>/<uuid>` per the File API. The URL is the worker's script
    /// URL, so its shape is what `location.href` reports and what
    /// `location.origin` is parsed back out of.
    #[tokio::test(flavor = "current_thread")]
    async fn blob_object_urls_use_the_browser_format() {
        let mut rt = page_runtime();
        let value = rt
            .evaluate(
                "(() => { const u = URL.createObjectURL(new Blob(['x'])); \
                 return /^blob:http:\\/\\/example\\.com\\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u); })()",
            )
            .unwrap();
        assert_eq!(value, serde_json::json!(true));
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
    async fn module_worker_executes_with_module_semantics() {
        let mut rt = page_runtime();
        rt.execute_script(
            "<test>",
            r#"
            const source = "postMessage({ url: import.meta.url, topThis: this === undefined });";
            const url = 'data:text/javascript,' + encodeURIComponent(source);
            globalThis.__expectedUrl = url;
            globalThis.__got = [];
            const worker = new Worker(url, { type: 'module' });
            worker.onmessage = (event) => { globalThis.__got.push(event.data); };
            "#,
        )
        .unwrap();
        pump_until(&mut rt, "globalThis.__got.length", &serde_json::json!(1.0)).await;
        assert_eq!(
            rt.evaluate(
                "JSON.stringify([__got[0].url === __expectedUrl, __got[0].topThis])",
            )
            .unwrap(),
            serde_json::json!("[true,true]"),
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

    #[tokio::test(flavor = "current_thread")]
    async fn worker_fetch_inherits_creator_cookie_and_http_client() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let read = stream.read(&mut request).unwrap_or_default();
                let request = String::from_utf8_lossy(&request[..read]);
                let (content_type, body) = if request.starts_with("GET /worker.js ") {
                    (
                        "text/javascript",
                        "fetch('/api', { credentials: 'include' })\
                         .then(function (response) { return response.text(); })\
                         .then(function (text) { postMessage(text); })\
                         .catch(function (error) { postMessage('error:' + error); });",
                    )
                } else {
                    (
                        "text/plain",
                        if request.contains("Cookie: creator=frame")
                            || request.contains("cookie: creator=frame")
                        {
                            "cookie-ok"
                        } else {
                            "cookie-missing"
                        },
                    )
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        let origin = format!("http://{address}");
        let page_url = url::Url::parse(&format!("{origin}/frame/page.html")).unwrap();
        let jar = Arc::new(obscura_net::CookieJar::new());
        jar.set_cookie("creator=frame; Path=/", &page_url);
        let client = Arc::new(obscura_net::ObscuraHttpClient::with_full_options(
            jar.clone(),
            None,
            true,
        ));
        let mut rt = ObscuraJsRuntime::new();
        rt.set_dom(parse_html("<html><body></body></html>"));
        rt.set_url(page_url.as_str());
        rt.set_cookie_jar(jar);
        rt.set_http_client(client);
        rt.run_page_init();

        rt.execute_script(
            "<test>",
            r#"
            const w = new Worker('/worker.js');
            globalThis.__got = [];
            w.onmessage = (event) => { globalThis.__got.push(event.data); };
            "#,
        )
        .unwrap();
        pump_until(
            &mut rt,
            "JSON.stringify(globalThis.__got)",
            &serde_json::json!(r#"["cookie-ok"]"#),
        )
        .await;
    }
}
