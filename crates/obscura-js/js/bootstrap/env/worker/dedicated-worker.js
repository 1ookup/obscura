// Dedicated Worker (design doc Phase 3.11): each worker owns a persistent,
// separate JsRuntime/isolate hosted by src/worker.rs. The worker source runs
// exactly once in that runtime; messages dispatch events into its retained
// global scope, and terminate() kills only the worker isolate. Messaging uses
// the JSON-clonable subset of structured clone (a {"v": data} envelope, so an
// undefined payload round-trips as an absent property).
// TODO(phase 3.11 follow-up): full structured clone, transfer lists,
// and http(s) importScripts.
function _workerCspAllows(url) {
  if (!_environmentAllowsScripts()) return false;
  const root = _callingFrameRoot();
  const info = _domParse("document_scope_info", root) || {};
  const header = info.csp;
  if (!header) return true;
  let sources = null;
  for (const part of String(header).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (name === 'worker-src') { sources = tokens; break; }
    if (!sources && name === 'child-src') sources = tokens;
    if (!sources && name === 'default-src') sources = tokens;
  }
  if (!sources) return true;
  let target;
  try { target = new URL(String(url)); } catch (e) { return false; }
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

function _cspResourceAllows(url, directive) {
  const root = _callingFrameRoot();
  const info = _domParse("document_scope_info", root) || {};
  const header = info.csp;
  if (!header) return true;
  let sources = null;
  for (const part of String(header).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (name === directive) { sources = tokens; break; }
    if (!sources && name === 'default-src') sources = tokens;
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

globalThis.Worker = class Worker {
  constructor(url, options) {
    this.onmessage = null;
    this.onerror = null;
    this._listeners = {};
    this._terminated = false;
    this._id = null;
    this._pending = [];
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
    _assertWorkerCspAllowed(resolved, 'Worker');
    // Surfaces as `self.name` in the worker; "" when none was supplied, which
    // is what a browser reports -- an absent binding is not the same value.
    this._name = options && options.name !== undefined ? String(options.name) : '';
    const blobSource = globalThis.__blobStore?.[href] ?? globalThis.__blobStore?.[resolved];
    if (typeof blobSource === 'string') { this._spawn(blobSource, resolved, workerType); return; }
    if (resolved.startsWith('data:')) { this._spawn(_workerScriptFromDataUrl(resolved), resolved, workerType); return; }
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
          if (!worker._terminated) worker._spawn(source, resp.url || resolved, workerType);
        } catch (e) { worker._dispatchError(e && e.message ? e.message : String(e)); }
      })();
      return;
    }
    throw new DOMException("Failed to construct 'Worker': unsupported script URL scheme.", 'SecurityError');
  }
  _spawn(source, finalUrl, workerType = 'classic') {
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
        false,
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
        if (typeof worker.onmessage === 'function') {
          try { worker.onmessage(evt); } catch (e) { console.error('Worker onmessage error:', e); }
        }
        for (const handler of (worker._listeners['message'] || []).slice()) {
          try { handler.call(worker, evt); } catch (e) { console.error('Worker message listener error:', e); }
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
        try { worker.onerror(evt); } catch (e) {}
      } else if (!handlers.length) {
        console.error('Worker error:', String(message));
      }
      for (const handler of handlers) {
        try { handler.call(worker, evt); } catch (e) {}
      }
    }, 0);
  }
  postMessage(data) {
    if (this._terminated) return;
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
    if (ls.indexOf(fn) < 0) ls.push(fn);
  }
  removeEventListener(type, fn) {
    const ls = this._listeners[type];
    if (ls) { const i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1); }
  }
  dispatchEvent(evt) {
    const handlers = (this._listeners[(evt && evt.type) || ''] || []).slice();
    for (const handler of handlers) {
      try { handler.call(this, evt); } catch (e) {}
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

