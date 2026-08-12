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
use std::sync::{mpsc as std_mpsc, Arc};
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
    /// The creator's origin. A worker's origin is inherited from the document
    /// that created it, so a `blob:`/`data:` worker still reports the page's
    /// origin rather than deriving one from its own script URL.
    pub origin: String,
    /// Whether the creator was a secure context. Carried separately because an
    /// opaque origin serializes to "null" and cannot be re-inspected for its
    /// scheme.
    pub secure_context: bool,
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
        let thread = std::thread::Builder::new()
            .name(format!("obscura-worker-{id}"))
            .spawn(move || {
                worker_thread_main(
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
    kind: String,
    mut environment: WorkerEnvironment,
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
            let proxy_url = environment
                .http_client
                .as_ref()
                .and_then(|client| client.proxy_url().map(str::to_string));
            // Read before the field-by-field move into the runtime state below.
            let worker_name = std::mem::take(&mut environment.name);
            let worker_origin = std::mem::take(&mut environment.origin);
            let worker_secure = environment.secure_context;
            let mut rt = ObscuraJsRuntime::with_base_url_and_proxy(&script_url, proxy_url);
            // reqwest's pooled client is created inside the creator's Tokio
            // runtime. Build the worker's pool on this thread while retaining
            // the browser-context cookie jar, proxy and private-network
            // policy; moving the initialized pool across runtimes produces a
            // reqwest builder error on the first worker fetch.
            let worker_http_client = environment.http_client.as_ref().map(|creator| {
                Arc::new(obscura_net::ObscuraHttpClient::with_full_options(
                    environment
                        .cookie_jar
                        .clone()
                        .unwrap_or_else(|| Arc::new(obscura_net::CookieJar::new())),
                    creator.proxy_url(),
                    creator.allow_private_network,
                ))
            });
            {
                let state = rt.state_handle().clone();
                let mut gs = state.borrow_mut();
                gs.worker_outbox = Some(out_tx.clone());
                gs.url = script_url.clone();
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
                &worker_prep_script(&script_url, &worker_name, &worker_origin, worker_secure),
            ) {
                let _ = out_tx.send(error_entry(&format!("worker global setup failed: {e}")));
                return;
            }
            // HTML "run a worker": the worker source executes exactly once.
            // Later messages only dispatch events (worker_event_loop below).
            let source_result = if kind == "module" {
                rt.load_inline_module(&source, &script_url, 30_000).await
            } else {
                rt.execute_script("<obscura:worker-script>", &source)
            };
            if let Err(e) = source_result {
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

fn worker_prep_script(script_url: &str, name: &str, origin: &str, secure: bool) -> String {
    let json = |s: &str| serde_json::Value::String(s.to_string()).to_string();
    WORKER_PREP_TEMPLATE
        .replace("__OBSCURA_WORKER_URL__", &json(script_url))
        .replace("__OBSCURA_WORKER_NAME__", &json(name))
        .replace("__OBSCURA_WORKER_ORIGIN__", &json(origin))
        .replace("__OBSCURA_WORKER_SECURE__", if secure { "true" } else { "false" })
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
  var getOwnPropertyNames = Object.getOwnPropertyNames;

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
    // Browsing-context self-references and the document tree
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
    'DOMStringMap', 'DOMRect', 'DOMRectReadOnly', 'DOMRectList',
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
    onmessage: 1, onmessageerror: 1, onerror: 1, onlanguagechange: 1,
    onoffline: 1, ononline: 1, onrejectionhandled: 1, onunhandledrejection: 1,
  };
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

  var DedicatedWorkerGlobalScope = illegalConstructor('DedicatedWorkerGlobalScope');
  DedicatedWorkerGlobalScope.prototype = Object.create(WorkerGlobalScope.prototype);
  def(DedicatedWorkerGlobalScope.prototype, 'constructor', DedicatedWorkerGlobalScope);
  defineProperty(DedicatedWorkerGlobalScope.prototype, Symbol.toStringTag, {
    value: 'DedicatedWorkerGlobalScope', configurable: true,
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
  def(G, 'DedicatedWorkerGlobalScope', DedicatedWorkerGlobalScope);
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
      'userAgentData', 'connection', 'storage', 'locks', 'permissions',
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
  G.__obscura_worker_dispatch_message = function (payload) {
    if (G.__obscura_worker_closed) return;
    var data;
    try { data = JSON.parse(payload).v; } catch (e) { return; }
    var event = new MessageEvent('message', { data: data });
    try { defineProperty(event, 'target', { value: G, configurable: true }); } catch (e) {}
    try { defineProperty(event, 'currentTarget', { value: G, configurable: true }); } catch (e) {}
    fire(event, 'message');
  };
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
            const src = "const names = " + JSON.stringify(names) + ";" +
              "postMessage({ leaked: names.filter((n) => typeof self[n] !== 'undefined')," +
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
            serde_json::json!(r#"{"leaked":[],"indexed":0}"#),
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
