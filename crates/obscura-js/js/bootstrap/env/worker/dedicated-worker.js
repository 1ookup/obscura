// Dedicated Worker (design doc Phase 3.11): each worker owns a persistent,
// separate JsRuntime/isolate hosted by src/worker.rs. The worker source runs
// exactly once in that runtime; messages dispatch events into its retained
// global scope, and terminate() kills only the worker isolate. Messaging uses
// the JSON-clonable subset of structured clone (a {"v": data} envelope, so an
// undefined payload round-trips as an absent property).
// TODO(phase 3.11 follow-up): full structured clone, transfer lists,
// and http(s) importScripts.
function _workerCspSourceList(header) {
  let sources = null;
  for (const part of String(header || '').split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (name === 'worker-src') { sources = tokens; break; }
    if (!sources && name === 'child-src') sources = tokens;
    if (!sources && name === 'default-src') sources = tokens;
  }
  return sources;
}

function _workerCspAllows(url) {
  if (!_environmentAllowsScripts()) return false;
  const root = _callingFrameRoot();
  const info = _domParse("document_scope_info", root) || {};
  const header = info.csp;
  if (!header) return true;
  const sources = _workerCspSourceList(header);
  if (!sources) return true;
  const href = String(url);
  // Turnstile's widget CSP is `worker-src blob:`. A blob URL is
  // `blob:https://host/uuid`; matching the token against URL.origin (the inner
  // https origin) or failing URL parse both refuse the constructor, and the
  // widget then PAT-fetches. HaHaVM's Worker is a stub and never throws.
  if (href.startsWith('blob:')) {
    return sources.some(source => {
      const value = source.toLowerCase();
      return value === 'blob:' || value === 'blob' || value === '*';
    });
  }
  let target;
  try { target = new URL(href); } catch (e) { return false; }
  const targetOrigin = target.origin;
  let selfOrigin = info.origin || 'null';
  try { selfOrigin = new URL(globalThis.location?.href || info.url || 'about:blank').origin; } catch (e) {}
  return sources.some(source => {
    const value = source.toLowerCase();
    if (value === "'none'") return false;
    if (value === "'self'") return targetOrigin === selfOrigin;
    if (value === '*') return target.protocol !== 'data:';
    if (value.endsWith(':')) return target.protocol === value;
    return targetOrigin.toLowerCase() === value.replace(/\/$/, '');
  });
}

function _assertWorkerCspAllowed(url, kind) {
  if (!_workerCspAllows(url)) {
    throw new DOMException(
      "Refused to create a " + kind + " from '" + url + "' because it violates the document's Content Security Policy.",
      'SecurityError');
  }
}

/// Directives that have no `default-src` fallback: a policy that omits one
/// allows the request whatever `default-src` says. `form-action` is the one
/// that bit us: a challenge interstitial is `default-src 'none'` with no
/// `form-action`, and inheriting `'none'` there silently swallows the form
/// submission that answers the challenge.
const _CSP_NO_FALLBACK = new Set(['form-action', 'base-uri', 'frame-ancestors']);

function _cspResourceAllows(url, directive) {
  const root = _callingFrameRoot();
  const info = _domParse("document_scope_info", root) || {};
  const header = info.csp;
  if (!header) return true;
  const inheritsDefault = !_CSP_NO_FALLBACK.has(directive);
  let sources = null;
  for (const part of String(header).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (name === directive) { sources = tokens; break; }
    if (inheritsDefault && !sources && name === 'default-src') sources = tokens;
  }
  if (!sources) return true;
  let target;
  try { target = new URL(String(url)); } catch (e) { return false; }
  let selfOrigin = info.origin || 'null';
  try { selfOrigin = new URL(globalThis.location?.href || info.url || 'about:blank').origin; } catch (e) {}
  return sources.some(source => {
    const value = source.toLowerCase();
    if (value === "'none'") return false;
    if (value === "'self'") return target.origin === selfOrigin;
    if (value === '*') return target.protocol !== 'data:';
    if (value.endsWith(':')) return target.protocol === value;
    return target.origin.toLowerCase() === value.replace(/\/$/, '');
  });
}

function _cspBaseUriAllows(url) {
  const root = _callingFrameRoot();
  const info = _domParse("document_scope_info", root) || {};
  const header = info.csp;
  if (!header) return true;
  let sources = null;
  for (const part of String(header).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (name === 'base-uri') { sources = tokens; break; }
  }
  if (!sources) return true;
  let target;
  try { target = new URL(String(url)); } catch (e) { return false; }
  const selfOrigin = info.origin || 'null';
  return sources.some(source => {
    const value = source.toLowerCase();
    if (value === "'none'") return false;
    if (value === "'self'") return target.origin === selfOrigin;
    if (value === '*') return true;
    if (value.endsWith(':')) return target.protocol === value;
    return target.origin.toLowerCase() === value.replace(/\/$/, '');
  });
}
function _workerScriptFromDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma < 0) throw new DOMException("Failed to construct 'Worker': invalid data: URL", 'SyntaxError');
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (/;base64$/i.test(meta)) return atob(payload);
  try { return decodeURIComponent(payload); } catch (e) { return payload; }
}

function _workerSerializeMessage(data) {
  if (typeof data === 'function' || typeof data === 'symbol') {
    throw new DOMException('The object could not be cloned.', 'DataCloneError');
  }
  let payload;
  try { payload = JSON.stringify({ v: data }); }
  catch (e) { throw new DOMException('The object could not be cloned.', 'DataCloneError'); }
  return payload === undefined ? '{}' : payload;
}

// Turnstile's widget worker is a tiny blob whose only job is
// `onmessage = e => e.isTrusted && eval(e.data)`. HaHaVM never runs that
// blob: Worker construction is a stub, and later postMessage strings that
// contain `postMessage` are Function()'d in the creating document. Spawning
// the isolate instead makes fetch("") a PAT request (no Origin) and the
// widget fails 600010. Large classic blob workers (proof-of-work) still spawn.
function _blobLooksLikeEvalMessageWorker(source) {
  if (source == null) return true;
  const text = String(source);
  if (!text) return true;
  if (text.length > 2048) return false;
  return /eval\s*\(/.test(text) || /\bonmessage\b/.test(text);
}

function _deliverWorkerOutMessage(worker, message) {
  if (worker._terminated) return;
  // HaHaVM Worker_postMessage('out'): deliver to onmessage when assigned,
  // else to registered message listeners, else queue in `listener` until an
  // onmessage assignment replays it. Dropping it made the widget lose the
  // navigator probe and choose PAT / 600010; queuing while a listener was
  // already registered stalled the widget.
  const listeners = (worker._listeners['message'] || []).slice();
  if (typeof worker.onmessage !== 'function' && !listeners.length) {
    worker._listener = message;
    try { console.error('[worker] out queued', String(message).slice(0, 80)); } catch (e) {}
    return;
  }
  try { console.error('[worker] out deliver', String(message).slice(0, 80)); } catch (e) {}
  const evt = globalThis.__obscura_markTrusted
    ? globalThis.__obscura_markTrusted(new MessageEvent('message', { data: message }))
    : new MessageEvent('message', { data: message });
  if (typeof worker.onmessage === 'function') {
    try {
      __obscuraTraceCallWith(
        __obscuraTraceHandlerFrom(worker, 'onmessage'), worker.onmessage, worker, [evt]);
    } catch (e) { console.error('Worker onmessage error:', e); }
  }
  for (const entry of listeners) {
    try { __obscuraTraceCallWith(entry.from, entry.fn, worker, [evt]); }
    catch (e) { console.error('Worker message listener error:', e); }
  }
}

function _runPostedWorkerSource(worker, data, type) {
  // HaHaVM Worker_postMessage: rewrite the posted classic source so its
  // postMessage calls go back through this Worker as type "out", then
  // compile with the host Function (CSP-proof). Page `new Function` is
  // EvalError in the widget srcdoc (`script-src 'nonce-…'`, no unsafe-eval)
  // and the widget then PAT-fetches / 600010.
  let message = String(data).replace(/self\./g, '').replace(/postMessage/g, 'hahavm_this.postMessage').replace(/\r\n/g, '');
  if (type !== 'out') {
    const posts = message.match(/postMessage\((.*?)\)/g);
    if (posts) {
      for (let i = 0; i < posts.length; i++) {
        const inner = posts[i].match(/postMessage\((.*)\)/);
        if (inner) message = message.replaceAll(posts[i], 'postMessage(' + inner[1] + ', "out")');
      }
    }
  }
  try {
    Object.defineProperty(globalThis, '__obscuraWorkerThis', {
      value: worker, writable: true, enumerable: false, configurable: true,
    });
  } catch (e) { globalThis.__obscuraWorkerThis = worker; }
  try {
    if (typeof __runClassicScript === 'function') {
      __runClassicScript(
        '(function(hahavm_this){\n' + message + '\n})(globalThis.__obscuraWorkerThis);',
        'about:blank',
      );
      try { console.error('[worker] source ok', message.slice(0, 100)); } catch (e) {}
    } else {
      (new Function('hahavm_this', message))(worker);
      try { console.error('[worker] source ok fn', message.slice(0, 100)); } catch (e) {}
    }
  } catch (e) {
    console.error('Worker posted source error:', e && e.message ? e.message : e);
  }
  try { delete globalThis.__obscuraWorkerThis; } catch (e) { globalThis.__obscuraWorkerThis = undefined; }
}

globalThis.Worker = class Worker {
  // IDL event-handler attributes live on the prototype, like Chrome's
  // Worker.prototype. An own data property per instance would show up in
  // Object.keys(worker) and in the own-property descriptor, which a Worker
  // created by a challenge script is exactly the sort of place gets read.
  // The setters also snapshot the assigning code's execution-source label,
  // so callbacks fire attributed to their assigner (trace runs only).
  get onmessage() { return this._handlers.message; }
  set onmessage(fn) {
    this._handlers.message = (typeof fn === 'function' || (fn && typeof fn === 'object')) ? fn : null;
    __obscuraTraceRecordHandler(this, 'onmessage');
    // HaHaVM Worker_onmessage_set: an out message that arrived before the
    // handler was assigned is replayed now. Without it the widget's first
    // navigator probe result never reached the page and Turnstile chose PAT.
    if (this._listener !== undefined && this._listener !== null) {
      const pending = this._listener;
      this._listener = undefined;
      try { console.error('[worker] onmessage replay', String(pending).slice(0, 80)); } catch (e) {}
      _deliverWorkerOutMessage(this, pending);
    } else {
      try { console.error('[worker] onmessage set', typeof fn); } catch (e) {}
    }
  }
  get onmessageerror() { return this._handlers.messageerror; }
  set onmessageerror(fn) {
    this._handlers.messageerror = (typeof fn === 'function' || (fn && typeof fn === 'object')) ? fn : null;
    __obscuraTraceRecordHandler(this, 'onmessageerror');
  }
  get onerror() { return this._handlers.error; }
  set onerror(fn) {
    this._handlers.error = (typeof fn === 'function' || (fn && typeof fn === 'object')) ? fn : null;
    __obscuraTraceRecordHandler(this, 'onerror');
  }
  constructor(url, options) {
    this._handlers = { message: null, messageerror: null, error: null };
    this._listeners = {};
    this._terminated = false;
    this._id = null;
    this._pending = [];
    // Execution-source label of the code constructing this worker. The
    // worker's own trace label is worker(M)[this], and 'out' message
    // callbacks on the page side restore it: a handler runs in the creating
    // context, not in whichever turn delivered the message.
    this._traceFrom = __obscuraTraceCurrent();
    const worker = this;
    const href = String(url);
    const workerType = options && options.type !== undefined
      ? String(options.type) : 'classic';
    if (workerType !== 'classic' && workerType !== 'module') {
      throw new TypeError("Failed to construct 'Worker': '" + workerType + "' is not a valid WorkerType.");
    }
    const credentials = options && options.credentials !== undefined
      ? String(options.credentials) : 'same-origin';
    if (credentials !== 'omit' && credentials !== 'same-origin' && credentials !== 'include') {
      throw new TypeError("Failed to construct 'Worker': '" + credentials + "' is not a valid RequestCredentials value.");
    }
    // Resolve against the creator document's base. Frame realms re-run
    // bootstrap, so `location` here is the creator frame's own.
    let resolved = href;
    try { resolved = new URL(href, globalThis.location?.href || 'about:blank').href; }
    catch (e) {
      throw new DOMException("Failed to construct 'Worker': '" + href + "' is not a valid URL.", 'SyntaxError');
    }
    // HaHaVM's Worker is a stub: blob: construction never throws CSP. The
    // widget then posts classic source through postMessage. Enforcing
    // worker-src against the wrong document (or a blob-store miss) is what
    // sent Turnstile down PAT / 600010.
    if (!resolved.startsWith('blob:') && !href.startsWith('blob:')) {
      _assertWorkerCspAllowed(resolved, 'Worker');
    }
    // Surfaces as `self.name` in the worker; "" when none was supplied, which
    // is what a browser reports -- an absent binding is not the same value.
    this._name = options && options.name !== undefined ? String(options.name) : '';
    const blobSource = globalThis.__blobStore?.[href] ?? globalThis.__blobStore?.[resolved];
    // A blob worker's script is the blob's own text, and the challenge builds
    // one that evals the tasks posted to it (`onmessage -> eval`). Running that
    // bootstrap in the worker's isolate is what puts those tasks in a worker
    // scope, and the challenge measures that scope directly: its storage probe
    // reports the duration of a FileSystemSyncAccessHandle flush, an API a
    // document does not have. The widget CSP allows it (`script-src 'nonce-…'
    // 'unsafe-eval'` with `worker-src blob:`).
    if (typeof blobSource === 'string' && blobSource.length) {
      this._scriptUrl = resolved;
      this._spawn(blobSource, resolved, workerType, '');
      return;
    }
    // No text for this blob. HaHaVM's Worker is a stub for blob: URLs:
    // construction never spawns an isolate, and posted strings that contain
    // postMessage are Function()'d in the creating document. Spawning the
    // isolate made fetch("") a PAT request (no Origin) and the widget failed
    // 600010. Large classic http(s) workers still spawn.
    if (resolved.startsWith('blob:') || href.startsWith('blob:')) {
      this._inlineEvalWorker = true;
      try {
        const root = (typeof _callingFrameRoot === 'function') ? _callingFrameRoot() : 0;
        const info = root > 0 ? (Deno.core.ops.op_dom('document_scope_info', String(root), '') || '{}') : '{}';
        console.error('[worker] stub blob ctor', resolved.slice(0, 80),
          'href', String(globalThis.location && globalThis.location.href),
          'secure', globalThis.isSecureContext,
          'origin', String(globalThis.origin),
          'protocol', String(globalThis.location && globalThis.location.protocol),
          'hostname', String(globalThis.location && globalThis.location.hostname),
          'base', String(globalThis.document && globalThis.document.baseURI),
          'docURL', String(globalThis.document && globalThis.document.URL),
          'scope', info.slice(0, 220));
      } catch (e) {
        console.error('[worker] stub blob ctor', resolved.slice(0, 80), 'env-error', e && e.message);
      }
      return;
    }
    if (resolved.startsWith('data:')) {
      this._spawn(_workerScriptFromDataUrl(resolved), resolved, workerType, '');
      return;
    }
    if (resolved.startsWith('http:') || resolved.startsWith('https:')) {
      // HTML "fetch a classic worker script" uses request mode "same-origin":
      // a cross-origin classic worker constructor throws SecurityError.
      let sameOrigin = false;
      try {
        sameOrigin = new URL(resolved).origin
          === new URL(globalThis.location?.href || 'about:blank').origin;
      } catch (e) {}
      if (workerType === 'classic' && !sameOrigin) {
        throw new DOMException(
          "Failed to construct 'Worker': script at '" + resolved + "' cannot be accessed from origin '"
            + (globalThis.location?.origin ?? 'null') + "'.",
          'SecurityError');
      }
      // Fetch the source through the page's fetch (interception and SSRF
      // gates included) without blocking the main thread. Messages posted
      // while the fetch is in flight queue in _pending and flush after spawn.
      (async () => {
        try {
          const resp = await fetch(resolved, {
            mode: workerType === 'module' ? 'cors' : 'same-origin',
            credentials,
          });
          if (!resp || !resp.ok) throw new Error('HTTP ' + (resp ? resp.status : 0));
          const source = await resp.text();
          // A fetched worker's CSP is its own response header, not the
          // creating document's (local-scheme workers inherit; handled in
          // the host from the script URL scheme).
          const workerCsp = resp.headers?.get?.('content-security-policy') || '';
          if (!worker._terminated) worker._spawn(source, resp.url || resolved, workerType, workerCsp);
        } catch (e) { worker._dispatchError(e && e.message ? e.message : String(e)); }
      })();
      return;
    }
    throw new DOMException("Failed to construct 'Worker': unsupported script URL scheme.", 'SecurityError');
  }
  _spawn(source, finalUrl, workerType = 'classic', workerCsp = '') {
    if (this._terminated) return;
    let id;
    // The creator's URL, read from this realm's own `location`. A worker
    // inherits the origin of the document that constructed it, so a worker
    // built inside a cross-origin frame must not be handed the top-level
    // page's origin -- frame realms each have their own `location`.
    const creatorUrl = String((globalThis.location && globalThis.location.href) || '');
    try {
      id = Deno.core.ops.op_worker_spawn(
        String(source),
        String(finalUrl),
        String(workerType),
        String(this._name || ''),
        creatorUrl,
        JSON.stringify(_fingerprint()),
        String(_environmentDocumentRoot()),
        _environmentDocumentCsp(),
        String(this._traceFrom || 'window'),
        String(workerCsp || ''),
      );
    }
    catch (e) { this._dispatchError(e && e.message ? e.message : String(e)); return; }
    this._id = id;
    const queued = this._pending;
    this._pending = [];
    for (const payload of queued) Deno.core.ops.op_worker_post_message(id, payload);
    this._recvLoop();
  }
  async _recvLoop() {
    const worker = this;
    while (!worker._terminated && worker._id !== null) {
      let batchJson;
      try {
        const pending = Deno.core.ops.op_worker_recv(worker._id);
        // Unref on a page: an idle page with live workers must still settle,
        // and the embedder pumps the loop often enough to deliver.
        //
        // Not inside a worker. A worker's loop has no embedder pumping it --
        // it parks once nothing is ref'd, so an unref'd receive is never
        // polled again and a nested worker's messages arrive only when some
        // unrelated ref'd op (a pending timer) happens to keep the parent
        // awake. A worker holding a live child worker is not idle.
        if (typeof WorkerGlobalScope === 'undefined') {
          Deno.core.unrefOpPromise(pending);
        }
        batchJson = await pending;
      } catch (e) { break; }
      if (!batchJson) break; // worker terminated or its thread exited
      let entries = [];
      try { entries = JSON.parse(batchJson); } catch (e) { continue; }
      for (const entry of entries) {
        if (worker._terminated) return;
        if (!entry) continue;
        if (entry.kind === 'error') { worker._dispatchError(entry.message || 'Worker error'); continue; }
        let data;
        try { data = JSON.parse(entry.data).v; } catch (e) { continue; }
        const evt = globalThis.__obscura_markTrusted(new MessageEvent('message', { data }));
        // A worker 'out' message handler runs in the creating context: it
        // executes under the construction-site label, not under whatever
        // code was running when the recv loop turned.
        if (typeof worker.onmessage === 'function') {
          try {
            __obscuraTraceCallWith(
              __obscuraTraceHandlerFrom(worker, 'onmessage'), worker.onmessage, worker, [evt]);
          } catch (e) { console.error('Worker onmessage error:', e); }
        }
        for (const listener of (worker._listeners['message'] || []).slice()) {
          try { __obscuraTraceCallWith(listener.from, listener.fn, worker, [evt]); }
          catch (e) { console.error('Worker message listener error:', e); }
        }
      }
    }
  }
  _dispatchError(message) {
    const worker = this;
    // Deliver asynchronously so `new Worker(...)` callers can attach onerror.
    setTimeout(() => {
      if (worker._terminated) return;
      const evt = { type: 'error', message: String(message), target: worker };
      const handlers = (worker._listeners['error'] || []).slice();
      if (typeof worker.onerror === 'function') {
        try {
          __obscuraTraceCallWith(
            __obscuraTraceHandlerFrom(worker, 'onerror'), worker.onerror, worker, [evt]);
        } catch (e) {}
      } else if (!handlers.length) {
        console.error('Worker error:', String(message));
      }
      for (const listener of handlers) {
        try { __obscuraTraceCallWith(listener.from, listener.fn, worker, [evt]); } catch (e) {}
      }
    }, 0);
  }
  postMessage(data, type) {
    if (this._terminated) return;
    if (typeof data === 'string' && (data.indexOf('postMessage') !== -1 || data.indexOf('fetch') !== -1)) {
      console.error('[worker] post', type || '', data.slice(0, 120));
    }
    // HaHaVM Worker_postMessage: a string that itself contains postMessage
    // is classic-script source, Function()'d in the creating document. The
    // rewritten source then calls this method again with type "out" to
    // deliver to onmessage. Sending the string into a blob isolate is what
    // produces the PAT request and 600010.
    if (data && data.indexOf) {
      if (data.indexOf('debugger') !== -1) return;
      // With an isolate behind this worker every post is a message for it: the
      // blob's own bootstrap evals the task inside the worker scope. The
      // document-eval path is only for a worker that has none.
      if (this._id === null && data.indexOf('hahavm_this') === -1
          && data.indexOf('postMessage') !== -1) {
        _runPostedWorkerSource(this, data, type);
        return;
      }
    }
    if (type === 'out') {
      _deliverWorkerOutMessage(this, data);
      return;
    }
    const payload = _workerSerializeMessage(data);
    if (this._id === null) { this._pending.push(payload); return; }
    Deno.core.ops.op_worker_post_message(this._id, payload);
  }
  terminate() {
    if (this._terminated) return;
    this._terminated = true;
    this._pending.length = 0;
    if (this._id !== null) {
      try { Deno.core.ops.op_worker_terminate(this._id); } catch (e) {}
    }
  }
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    const ls = this._listeners[type] || (this._listeners[type] = []);
    if (ls.some(entry => entry.fn === fn)) return;
    // Registration-time snapshot, matching the shared listener registry.
    ls.push({ fn, from: globalThis.__obscura_trace_from_enabled ? __obscuraTraceCurrent() : null });
  }
  removeEventListener(type, fn) {
    const ls = this._listeners[type];
    if (ls) {
      const i = ls.findIndex(entry => entry.fn === fn);
      if (i >= 0) ls.splice(i, 1);
    }
  }
  dispatchEvent(evt) {
    const handlers = (this._listeners[(evt && evt.type) || ''] || []).slice();
    for (const listener of handlers) {
      try { __obscuraTraceCallWith(listener.from, listener.fn, this, [evt]); } catch (e) {}
    }
    return true;
  }
};

globalThis.__blobStore = globalThis.__blobStore || {};
globalThis.__blobBytesStore = globalThis.__blobBytesStore || {};
globalThis.__blobTypeStore = globalThis.__blobTypeStore || {};
// `blob:<serialized origin>/<uuid v4>`, per the File API's "generate a new blob
// URL". The format is load-bearing beyond cosmetics: a blob-URL Worker takes
// this string as its script URL, so it is what `location.href` reports inside
// the worker, and `location.origin` is parsed back out of it. The previous
// `blob:obscura/<base36>` named the engine outright and left workers reporting
// a "null" origin for pages that had a real one.
function _blobUrlId() {
  let uuid;
  try { uuid = globalThis.crypto && crypto.randomUUID && crypto.randomUUID(); } catch (e) {}
  if (!uuid) {
    const hex = [];
    for (let i = 0; i < 36; i++) hex.push(Math.floor(Math.random() * 16).toString(16));
    hex[8] = hex[13] = hex[18] = hex[23] = '-';
    hex[14] = '4';
    hex[19] = (parseInt(hex[19], 16) & 0x3 | 0x8).toString(16);
    uuid = hex.join('');
  }
  // An opaque-origin document (file:, data:, sandboxed) serializes to "null",
  // which is exactly what a browser puts here too.
  let origin = 'null';
  try {
    const own = globalThis.location && globalThis.location.origin;
    if (own && own !== 'null' && own !== 'about:blank') origin = own;
  } catch (e) {}
  return 'blob:' + origin + '/' + uuid;
}
URL.createObjectURL = function(blob) {
  if (blob) {
    const id = _blobUrlId();
    // Store synchronously so a Worker built from the blob URL in the same
    // tick sees its source. Blob-URL Worker construction is synchronous in
    // real browsers; the previous async blob.text().then() store raced the
    // Worker constructor, so new Worker(blobURL) fell through to fetch() and
    // failed (net::ERR_FAILED), which broke AWS WAF's proof-of-work worker.
    const bytes = _blobBytes(blob);
    if (bytes) {
      let text = '';
      try { text = new TextDecoder().decode(bytes); } catch (e) {}
      globalThis.__blobStore[id] = text;
      globalThis.__blobBytesStore[id] = bytes.slice();
      globalThis.__blobTypeStore[id] = blob.type || '';
    } else if (typeof blob.text === 'function') {
      blob.text().then(text => { globalThis.__blobStore[id] = text; });
    } else {
      globalThis.__blobStore[id] = '';
    }
    return id;
  }
  return _blobUrlId();
};
URL.revokeObjectURL = function(url) {
  delete globalThis.__blobStore[url];
  delete globalThis.__blobBytesStore[url];
  delete globalThis.__blobTypeStore[url];
};

// The text of a script-created blob document, or null when this realm's blob
// URL store has no entry for the URL. This is the same store fetch() and XHR
// read, so a frame navigation and a fetch of one URL agree on the bytes.
function _blobDocumentText(url) {
  const store = globalThis.__blobStore;
  if (!store) return null;
  const text = store[url];
  if (typeof text === 'string') return text;
  const bytes = globalThis.__blobBytesStore && globalThis.__blobBytesStore[url];
  if (bytes) { try { return new TextDecoder().decode(bytes); } catch (e) {} }
  return null;
}

// Chrome serves a blob URL with the type the Blob was created with and does
// not sniff a frame document: `text/html` renders, an empty or `text/plain`
// type lands in the plain-text viewer, and any other type is treated as a
// download with the frame left at about:blank. The engine has one
// frame-document parser (HTML), so only the HTML type is resolved here and
// every other type keeps the previous behaviour, which is also Chrome's for
// a non-renderable type.
function _blobDocumentIsHtml(url) {
  const type = (globalThis.__blobTypeStore && globalThis.__blobTypeStore[url]) || '';
  return type.split(';')[0].trim().toLowerCase() === 'text/html';
}

// Hand a `blob:` frame navigation to the loader as an inline document.
// Returns false when the URL is not an HTML blob document of this realm, in
// which case the caller falls through to the ordinary navigation path. The
// lookup is realm-local on purpose: a frame's blob documents come from that
// frame's own store, which is what keeps a cross-origin embed from reaching
// the embedder's.
function _queueBlobIframeDocument(hostNid, url) {
  if (typeof url !== "string" || !url.startsWith("blob:")) return false;
  if (!_blobDocumentIsHtml(url)) return false;
  const text = _blobDocumentText(url);
  if (text === null) return false;
  Deno.core.ops.op_navigate_iframe_blob(hostNid, url, text);
  return true;
}

// Queue an iframe's src/srcdoc navigation. Every entry point that sees an
// iframe src change, or a newly connected iframe, goes through here so a blob
// document is resolved in one place.
function _queueIframeNavigation(hostNid) {
  let src = null;
  try { src = _domParse("get_attribute", hostNid, "src"); } catch (e) {}
  if (_queueBlobIframeDocument(hostNid, src)) return;
  Deno.core.ops.op_queue_iframe_navigation(hostNid);
}

