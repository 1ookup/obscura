// SharedWorker processes are owned by the BrowserContext. Each page keeps a
// local connection id while the native registry reuses one worker isolate for
// the same origin/name/script tuple across pages.
const _sharedWorkerEntries = new Map();

// Worker -> page: {"kind":"message","data":"{\"v\":...,\"c\":<connection>}"}.
async function _sharedWorkerReceive(entry) {
  while (entry.id !== null) {
    let batchJson;
    try {
      const pending = Deno.core.ops.op_shared_worker_recv(entry.id);
      if (typeof WorkerGlobalScope === 'undefined') Deno.core.unrefOpPromise(pending);
      batchJson = await pending;
    } catch (e) { break; }
    if (!batchJson) break;
    let items = [];
    try { items = JSON.parse(batchJson); } catch (e) { continue; }
    for (const item of items) {
      if (!item) continue;
      if (item.kind === 'error') { _sharedWorkerError(entry, item.message || 'Worker error'); continue; }
      let envelope;
      try { envelope = JSON.parse(item.data); } catch (e) { continue; }
      const bridge = entry.connections.get(envelope && envelope.c);
      // Posting into the bridge end runs the page port's own queue, so a port
      // the page has not start()ed holds the message instead of delivering it.
      if (bridge) { try { bridge.postMessage(envelope.v); } catch (e) {} }
    }
  }
}

function _sharedWorkerError(entry, message) {
  entry.failed = true;
  for (const worker of entry.workers.slice()) worker._dispatchError(message);
}

function _sharedWorkerSpawned(entry, source, finalUrl, workerType, creatorFrom, workerCsp = '') {
  if (entry.failed) return;
  let id;
  const creatorUrl = String((globalThis.location && globalThis.location.href) || '');
  try {
    id = Deno.core.ops.op_shared_worker_connect(
      String(source), String(finalUrl), String(workerType), String(entry.name),
      creatorUrl, JSON.stringify(_fingerprint()),
      String(_environmentDocumentRoot()), _environmentDocumentCsp(),
      String(creatorFrom || 'window'),
      String(workerCsp || ''),
    );
  } catch (e) { _sharedWorkerError(entry, e && e.message ? e.message : String(e)); return; }
  entry.id = id;
  const queued = entry.pending;
  entry.pending = [];
  for (const payload of queued) Deno.core.ops.op_shared_worker_post_message(id, payload);
  _sharedWorkerReceive(entry);
}

function _sharedWorkerSend(entry, payload) {
  if (entry.failed) return;
  if (entry.id === null) { entry.pending.push(payload); return; }
  Deno.core.ops.op_shared_worker_post_message(entry.id, payload);
}

globalThis.SharedWorker = class SharedWorker {
  constructor(url, options) {
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to construct 'SharedWorker': 1 argument required, but only 0 present.");
    }
    this.onerror = null;
    this._listeners = {};
    const href = String(url);
    // The second argument is a name shorthand or a SharedWorkerOptions.
    const name = options == null ? ''
      : (typeof options === 'object'
          ? (options.name !== undefined ? String(options.name) : '')
          : String(options));
    const workerType = options && typeof options === 'object' && options.type !== undefined
      ? String(options.type) : 'classic';
    if (workerType !== 'classic' && workerType !== 'module') {
      throw new TypeError(
        "Failed to construct 'SharedWorker': '" + workerType + "' is not a valid WorkerType.");
    }
    let resolved;
    try { resolved = new URL(href, globalThis.location?.href || 'about:blank').href; }
    catch (e) {
      throw new DOMException(
        "Failed to construct 'SharedWorker': '" + href + "' is not a valid URL.", 'SyntaxError');
    }
    _assertWorkerCspAllowed(resolved, 'SharedWorker');
    if (resolved.startsWith('http:') || resolved.startsWith('https:')) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(resolved).origin
          === new URL(globalThis.location?.href || 'about:blank').origin;
      } catch (e) {}
      if (!sameOrigin) {
        throw new DOMException(
          "Failed to construct 'SharedWorker': Script at '" + resolved
            + "' cannot be accessed from origin '"
            + (globalThis.location?.origin ?? 'null') + "'.",
          'SecurityError');
      }
    }

    const blobSource = globalThis.__blobStore?.[href] ?? globalThis.__blobStore?.[resolved];
    if (!(resolved.startsWith('http:') || resolved.startsWith('https:')
          || resolved.startsWith('data:') || resolved.startsWith('blob:')
          || typeof blobSource === 'string')) {
      throw new DOMException(
        "Failed to construct 'SharedWorker': unsupported script URL scheme.", 'SecurityError');
    }

    const key = name + '\n' + resolved;
    let entry = _sharedWorkerEntries.get(key);
    const fresh = entry === undefined;
    if (fresh) {
      entry = {
        id: null, name, failed: false, pending: [], nextConnection: 1,
        connections: new Map(), workers: [],
      };
      _sharedWorkerEntries.set(key, entry);
    }
    entry.workers.push(this);
    this._entry = entry;

    // Each construction is its own connection, even to a reused worker.
    const connectionId = entry.nextConnection++;
    this._connectionId = connectionId;
    const channel = new MessageChannel();
    this.port = channel.port1;
    const bridge = channel.port2;
    entry.connections.set(connectionId, bridge);
    bridge.onmessage = event => {
      let payload;
      try { payload = JSON.stringify({ v: event.data, c: connectionId }); }
      catch (e) { return; }
      if (payload === undefined) return;
      _sharedWorkerSend(entry, payload);
    };
    _sharedWorkerSend(entry, JSON.stringify({ connect: true, c: connectionId }));

    if (!fresh) return;
    // First construction of this entry mints the worker; its label carries
    // this constructor call's execution source as the creator.
    const creatorFrom = __obscuraTraceCurrent();
    if (typeof blobSource === 'string') {
      _sharedWorkerSpawned(entry, blobSource, resolved, workerType, creatorFrom);
      return;
    }
    if (resolved.startsWith('data:')) {
      _sharedWorkerSpawned(entry, _workerScriptFromDataUrl(resolved), resolved, workerType, creatorFrom);
      return;
    }
    if (resolved.startsWith('http:') || resolved.startsWith('https:')) {
      (async () => {
        try {
          const resp = await fetch(resolved, {
            mode: workerType === 'module' ? 'cors' : 'same-origin',
            credentials: 'same-origin',
          });
          if (!resp || !resp.ok) throw new Error('HTTP ' + (resp ? resp.status : 0));
          // A fetched worker's CSP is its own response header (see the
          // dedicated Worker path).
          const workerCsp = resp.headers?.get?.('content-security-policy') || '';
          _sharedWorkerSpawned(entry, await resp.text(), resp.url || resolved, workerType,
            creatorFrom, workerCsp);
        } catch (e) { _sharedWorkerError(entry, e && e.message ? e.message : String(e)); }
      })();
      return;
    }
  }
  _dispatchError(message) {
    const worker = this;
    setTimeout(() => {
      const evt = { type: 'error', message: String(message), target: worker };
      const handlers = (worker._listeners['error'] || []).slice();
      if (typeof worker.onerror === 'function') {
        try { worker.onerror(evt); } catch (e) {}
      } else if (!handlers.length) {
        console.error('SharedWorker error:', String(message));
      }
      for (const handler of handlers) {
        try { handler.call(worker, evt); } catch (e) {}
      }
    }, 0);
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
    for (const handler of (this._listeners[(evt && evt.type) || ''] || []).slice()) {
      try { handler.call(this, evt); } catch (e) {}
    }
    return true;
  }
  get [Symbol.toStringTag]() { return 'SharedWorker'; }
};
_markNative(globalThis.SharedWorker);
// Preserve the worker's event implementation while sharing the EventTarget chain.
try {
  Object.setPrototypeOf(globalThis.SharedWorker.prototype, EventTarget.prototype);
} catch (e) {}
