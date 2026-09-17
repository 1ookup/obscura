// IndexedDB shim with an origin-keyed JSON backing store. The value layer is
// JSON-clone only, while request and transaction callbacks remain asynchronous.
const __obscura_idb = new Map();
function _idbClone(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); }
  catch (e) { throw new DOMException('The object could not be cloned.', 'DataCloneError'); }
}
function _idbState(name) {
  let state = __obscura_idb.get(name);
  if (state) return state;
  try { state = JSON.parse(Deno.core.ops.op_indexeddb_load(name) || '{}'); } catch (e) { state = {}; }
  if (!state || typeof state !== 'object') state = {};
  state.version = Number(state.version) || 0;
  state.stores = state.stores && typeof state.stores === 'object' ? state.stores : {};
  for (const key of Object.keys(state.stores)) {
    const store = state.stores[key];
    if (!store || typeof store !== 'object') state.stores[key] = { keyPath: null, records: {} };
    else store.records = store.records && typeof store.records === 'object' ? store.records : {};
  }
  __obscura_idb.set(name, state);
  return state;
}
function _idbPersist(name, state) {
  try { Deno.core.ops.op_indexeddb_save(name, JSON.stringify(state)); } catch (e) {}
}
function _idbKey(key) { return JSON.stringify(key === undefined ? null : key); }
function _idbRequest(produceResult) {
  const req = {
    result: undefined,
    error: null,
    source: null,
    transaction: null,
    readyState: 'pending',
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    addEventListener(type, fn) { req['on' + type] = fn; },
    removeEventListener(type, fn) { if (req['on' + type] === fn) req['on' + type] = null; },
  };
  Promise.resolve().then(() => {
    try {
      req.result = produceResult();
      req.readyState = 'done';
      if (typeof req.onsuccess === 'function') {
        try { req.onsuccess({ target: req, type: 'success' }); } catch (e) {}
      }
    } catch (e) {
      req.error = e; req.readyState = 'done';
      if (typeof req.onerror === 'function') {
        try { req.onerror({ target: req, type: 'error' }); } catch (e2) {}
      }
    }
  });
  return req;
}

function _idbObjectStore(name, tx) {
  const dbState = tx && tx._dbState;
  const data = dbState && dbState.stores[name] ? dbState.stores[name].records : {};
  const save = () => { if (tx && tx._dbName) _idbPersist(tx._dbName, tx._dbState); };
  const keys = () => Object.keys(data).map(k => { try { return JSON.parse(k); } catch (e) { return k; } });
  return {
    name,
    keyPath: null,
    autoIncrement: false,
    indexNames: { contains() { return false; }, length: 0, item() { return null; } },
    transaction: tx || null,
    add(value, key) { const k = key ?? Date.now(); const id = _idbKey(k); if (Object.prototype.hasOwnProperty.call(data, id)) throw new DOMException('Key already exists.', 'ConstraintError'); data[id] = _idbClone(value); save(); return _idbRequest(() => k); },
    put(value, key) { const k = key ?? Date.now(); data[_idbKey(k)] = _idbClone(value); save(); return _idbRequest(() => k); },
    get(key) { return _idbRequest(() => _idbClone(data[_idbKey(key)])); },
    getAll() { return _idbRequest(() => Object.values(data).map(_idbClone)); },
    getAllKeys() { return _idbRequest(keys); },
    getKey(key) { return _idbRequest(() => Object.prototype.hasOwnProperty.call(data, _idbKey(key)) ? key : undefined); },
    delete(key) { return _idbRequest(() => { delete data[_idbKey(key)]; save(); return undefined; }); },
    clear() { return _idbRequest(() => { for (const key of Object.keys(data)) delete data[key]; save(); return undefined; }); },
    count() { return _idbRequest(() => Object.keys(data).length); },
    openCursor() { return _idbRequest(() => null); },
    openKeyCursor() { return _idbRequest(() => null); },
    createIndex() { return { name: '', keyPath: '', unique: false, multiEntry: false, get() { return _idbRequest(() => undefined); } }; },
    index() { return { get() { return _idbRequest(() => undefined); }, getAll() { return _idbRequest(() => []); }, count() { return _idbRequest(() => 0); }, openCursor() { return _idbRequest(() => null); } }; },
    deleteIndex() {},
  };
}

function _idbTransaction(dbState, dbName, storeNames, mode) {
  const stores = new Map();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const txState = { _dbState: dbState, _dbName: dbName };
  for (const n of names) if (dbState.stores[String(n)]) stores.set(String(n), _idbObjectStore(String(n), txState));
  const tx = {
    _dbState: dbState, _dbName: dbName,
    db: null,
    mode: mode || 'readonly',
    objectStoreNames: { contains: (n) => stores.has(String(n)), length: stores.size },
    onabort: null, oncomplete: null, onerror: null,
    error: null,
    objectStore(name) {
      let s = stores.get(name);
      if (!s && dbState.stores[name]) { s = _idbObjectStore(name, tx); stores.set(name, s); }
      if (!s) throw new DOMException('The object store does not exist.', 'NotFoundError');
      s.transaction = tx;
      return s;
    },
    abort() {},
    commit() {},
    addEventListener(type, fn) { tx['on' + type] = fn; },
    removeEventListener(type, fn) { if (tx['on' + type] === fn) tx['on' + type] = null; },
  };
  Promise.resolve().then(() => {
    if (typeof tx.oncomplete === 'function') {
      try { tx.oncomplete({ target: tx, type: 'complete' }); } catch (e) {}
    }
  });
  return tx;
}

function _idbDatabase(name, version) {
  const state = _idbState(name);
  const objectStoreNames = { contains(n) { return Object.prototype.hasOwnProperty.call(state.stores, String(n)); }, get length() { return Object.keys(state.stores).length; }, item(i) { return Object.keys(state.stores)[i] || null; } };
  return {
    name,
    version: state.version || version,
    objectStoreNames,
    createObjectStore(n, options) { const key = String(n); if (state.stores[key]) throw new DOMException('The object store already exists.', 'ConstraintError'); state.stores[key] = { keyPath: options?.keyPath ?? null, records: {} }; _idbPersist(name, state); return _idbObjectStore(key, { _dbState: state, _dbName: name }); },
    deleteObjectStore(n) { delete state.stores[String(n)]; _idbPersist(name, state); },
    transaction(storeNames, mode) {
      return _idbTransaction(state, name, storeNames, mode);
    },
    close() {},
    onversionchange: null, onabort: null, onerror: null, onclose: null,
    addEventListener() {}, removeEventListener() {},
  };
}

function registerIndexedDbSurface() {
globalThis.indexedDB = {
  [Symbol.toStringTag]: 'IDBFactory',
  open(name, version) {
    const dbName = String(name);
    const requested = version === undefined ? 1 : Number(version);
    const state = _idbState(dbName);
    const oldVersion = state.version;
    const req = { result: undefined, error: null, source: null, transaction: null, readyState: 'pending', onsuccess: null, onerror: null, onupgradeneeded: null,
      addEventListener(type, fn) { req['on' + type] = fn; },
      removeEventListener(type, fn) { if (req['on' + type] === fn) req['on' + type] = null; } };
    Promise.resolve().then(() => {
      if (requested > oldVersion) {
        state.version = requested;
        req.result = _idbDatabase(dbName, requested);
        if (typeof req.onupgradeneeded === 'function') {
          try { req.onupgradeneeded({ target: req, type: 'upgradeneeded', oldVersion, newVersion: requested }); } catch (e) {}
        }
        _idbPersist(dbName, state);
      } else req.result = _idbDatabase(dbName, requested);
      req.readyState = 'done';
      if (typeof req.onsuccess === 'function') { try { req.onsuccess({ target: req, type: 'success' }); } catch (e) {} }
    });
    return req;
  },
  deleteDatabase(name) { __obscura_idb.delete(String(name)); try { Deno.core.ops.op_indexeddb_delete(String(name)); } catch (e) {} return _idbRequest(() => undefined); },
  databases() { return Promise.resolve([...__obscura_idb.keys()].map(name => ({ name, version: _idbState(name).version }))); },
  cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
};
}
registerIndexedDbSurface();
const _idbKeyRangeState = new WeakMap();
function IDBKeyRange() {
  throw new TypeError("Failed to construct 'IDBKeyRange': Illegal constructor");
}
function _idbKeyRange(lower, upper, lowerOpen, upperOpen) {
  const range = Object.create(IDBKeyRange.prototype);
  _idbKeyRangeState.set(range, { lower, upper, lowerOpen, upperOpen });
  return range;
}
function _idbKeyRangeData(value) {
  const state = _idbKeyRangeState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
Object.defineProperties(IDBKeyRange.prototype, {
  lower: { get: _markNativeAs(function () {
    return _idbKeyRangeData(this).lower;
  }, 'function get lower() { [native code] }'), enumerable: true, configurable: true },
  upper: { get: _markNativeAs(function () {
    return _idbKeyRangeData(this).upper;
  }, 'function get upper() { [native code] }'), enumerable: true, configurable: true },
  lowerOpen: { get: _markNativeAs(function () {
    return _idbKeyRangeData(this).lowerOpen;
  }, 'function get lowerOpen() { [native code] }'), enumerable: true, configurable: true },
  upperOpen: { get: _markNativeAs(function () {
    return _idbKeyRangeData(this).upperOpen;
  }, 'function get upperOpen() { [native code] }'), enumerable: true, configurable: true },
  includes: { value: _markNative(function includes(value) {
    const state = _idbKeyRangeData(this);
    const above = state.lower === null || (state.lowerOpen ? value > state.lower : value >= state.lower);
    const below = state.upper === null || (state.upperOpen ? value < state.upper : value <= state.upper);
    return above && below;
  }), writable: true, enumerable: true, configurable: true },
  [Symbol.toStringTag]: { value: 'IDBKeyRange', configurable: true },
});
Object.defineProperties(IDBKeyRange, {
  only: { value: _markNative(function only(value) {
    return _idbKeyRange(value, value, false, false);
  }), writable: true, enumerable: true, configurable: true },
  lowerBound: { value: _markNative(function lowerBound(value, open = false) {
    return _idbKeyRange(value, null, !!open, false);
  }), writable: true, enumerable: true, configurable: true },
  upperBound: { value: _markNative(function upperBound(value, open = false) {
    return _idbKeyRange(null, value, false, !!open);
  }), writable: true, enumerable: true, configurable: true },
  bound: { value: _markNative(function bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return _idbKeyRange(lower, upper, !!lowerOpen, !!upperOpen);
  }), writable: true, enumerable: true, configurable: true },
});
_markNative(IDBKeyRange);
Object.defineProperty(globalThis, 'IDBKeyRange', {
  value: IDBKeyRange, writable: true, enumerable: false, configurable: true,
});

function registerCacheSurface() {
globalThis.caches = {
  open() { return Promise.resolve({ match(){return Promise.resolve(undefined);}, put(){return Promise.resolve();}, delete(){return Promise.resolve(false);}, keys(){return Promise.resolve([]);} }); },
  match() { return Promise.resolve(undefined); },
  has() { return Promise.resolve(false); },
  delete() { return Promise.resolve(false); },
  keys() { return Promise.resolve([]); },
};
}
registerCacheSurface();

_markNative(AudioContext); _markNative(OfflineAudioContext);
_markNative(SpeechSynthesisUtterance);
_markNative(MediaStream); _markNative(MediaStreamTrack);
_markNative(RTCPeerConnection); _markNative(RTCSessionDescription); _markNative(RTCIceCandidate);
_markNative(RTCRtpSender); _markNative(RTCRtpReceiver);

