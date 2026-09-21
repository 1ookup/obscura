// SharedWorker processes are owned by the BrowserContext. Each page keeps a
// local connection id while the native registry reuses one worker isolate for
// the same origin/name/script tuple across pages.
const _sharedWorkerEntries = new Map();

// Instance internals live in this WeakMap, not on the object: a real Chrome
// SharedWorker instance owns no properties at all -- `port` is a prototype
// accessor (oracle headless Chrome: SharedWorker.prototype owns exactly
// {port, constructor, onerror}, and getOwnPropertyNames(instance) is empty).
const _sharedWorkerState = new WeakMap();
function _sharedWorkerStateOf(worker) {
  let state = _sharedWorkerState.get(worker);
  if (!state) {
    state = { entry: null, connectionId: 0, port: null, onerror: null };
    _sharedWorkerState.set(worker, state);
  }
  return state;
}

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
  for (const worker of entry.workers.slice()) _sharedWorkerDispatchError(worker, message);
}

// _sharedWorkerDispatchError lives off the prototype: the listener trio is
// inherited from EventTarget.prototype (shared registry), matching the
// Worker.prototype convergence.
function _sharedWorkerDispatchError(worker, message) {
  setTimeout(() => {
    const evt = { type: 'error', message: String(message), target: worker };
    const handlers = _eventTargetListenersFor(worker, 'error');
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

// A plain constructor function rather than class syntax: the own set below
// must start with `port` (Chrome's enumeration order), and a class body
// always lists `constructor` first -- its prototype object is also
// non-configurable, so it cannot be swapped afterwards.
function SharedWorker(url, options) {
  if (new.target === undefined) {
    throw new TypeError(
      "Failed to construct 'SharedWorker': Please use the 'new' operator, "
        + "this DOM object constructor cannot be called as a function.");
  }
  if (arguments.length < 1) {
    throw new TypeError(
      "Failed to construct 'SharedWorker': 1 argument required, but only 0 present.");
  }
  const state = _sharedWorkerStateOf(this);
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
    state.entry = entry;

    // Each construction is its own connection, even to a reused worker.
    const connectionId = entry.nextConnection++;
    state.connectionId = connectionId;
    const channel = new MessageChannel();
    state.port = channel.port1;
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
_markNative(SharedWorker);
globalThis.SharedWorker = SharedWorker;

// Chrome 151 SharedWorker.prototype owns exactly {port, constructor, onerror},
// in that order, with `port` a prototype accessor over per-instance state and
// the listener trio inherited from EventTarget.prototype (oracle headless
// Chrome: getOwnPropertyNames(instance) is empty -- not even `port`).
const _sharedWorkerProto = Object.create(
  globalThis.EventTarget && globalThis.EventTarget.prototype
    ? globalThis.EventTarget.prototype : Object.prototype);
Object.defineProperty(_sharedWorkerProto, 'port', {
  get() { return _sharedWorkerStateOf(this).port; },
  configurable: true, enumerable: true,
});
Object.defineProperty(_sharedWorkerProto, 'constructor', {
  value: SharedWorker,
  writable: true, configurable: true, enumerable: false,
});
Object.defineProperty(_sharedWorkerProto, 'onerror', {
  get() { return _sharedWorkerStateOf(this).onerror; },
  set(fn) {
    _sharedWorkerStateOf(this).onerror = (typeof fn === 'function' || (fn && typeof fn === 'object')) ? fn : null;
  },
  configurable: true, enumerable: true,
});
Object.defineProperty(SharedWorker, 'prototype', {
  value: _sharedWorkerProto,
  writable: false, enumerable: false, configurable: false,
});
