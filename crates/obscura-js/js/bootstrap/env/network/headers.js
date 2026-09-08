// Fetch Headers use internal slots. Keeping the backing map on the instance
// makes `Object.getOwnPropertyNames(new Headers())` expose an engine-only
// `_h` field and also lets a page mutate the map without WebIDL validation.
const _headersState = new WeakMap();
function _headersData(value) {
  const state = _headersState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _headerName(value) {
  const name = String(value).toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) {
    throw new TypeError("Headers.append: invalid header name");
  }
  return name;
}
function _headerValue(value) {
  const result = String(value).trim();
  if (/[^\t\x20-\x7e\x80-\xff]/.test(result)) {
    throw new TypeError("Headers.append: invalid header value");
  }
  return result;
}
function _headersInitEntries(init) {
  if (init == null) return [];
  if (init instanceof Headers) return Array.from(_headersData(init).map.entries());
  if (typeof init[Symbol.iterator] === 'function' && typeof init !== 'string') {
    const entries = [];
    for (const pair of init) {
      if (!pair || typeof pair[Symbol.iterator] !== 'function') {
        throw new TypeError('Headers constructor: each item must be a sequence');
      }
      const values = Array.from(pair);
      if (values.length < 2) throw new TypeError('Headers constructor: sequence item has fewer than 2 elements');
      entries.push([values[0], values[1]]);
    }
    return entries;
  }
  if (typeof init === 'object') return Object.entries(init);
  throw new TypeError('Headers constructor: init is not an object');
}
function _headersEntries(value) {
  return Array.from(_headersData(value).map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
}
function _reorderWebIDLPrototype(prototype, names) {
  const descriptors = new Map();
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor) {
      descriptor.enumerable = name !== 'constructor';
      descriptors.set(name, descriptor);
      try { delete prototype[name]; } catch (_error) {}
    }
  }
  for (const name of names) {
    const descriptor = descriptors.get(name);
    if (descriptor) {
      try { Object.defineProperty(prototype, name, descriptor); } catch (_error) {}
    }
  }
}
const _Headers = class Headers {
  constructor(init = undefined) {
    const state = { map: new Map() };
    _headersState.set(this, state);
    for (const [name, value] of _headersInitEntries(init)) {
      const key = _headerName(name);
      const next = _headerValue(value);
      state.map.set(key, state.map.has(key) ? state.map.get(key) + ', ' + next : next);
    }
  }
  get(name) { return _headersData(this).map.get(_headerName(name)) ?? null; }
  set(name, value) { _headersData(this).map.set(_headerName(name), _headerValue(value)); }
  has(name) { return _headersData(this).map.has(_headerName(name)); }
  delete(name) { _headersData(this).map.delete(_headerName(name)); }
  append(name, value) {
    const state = _headersData(this), key = _headerName(name), next = _headerValue(value);
    state.map.set(key, state.map.has(key) ? state.map.get(key) + ', ' + next : next);
  }
  forEach(callback, thisArg = undefined) {
    if (typeof callback !== 'function') throw new TypeError('Headers.forEach callback is not a function');
    for (const [name, value] of _headersEntries(this)) callback.call(thisArg, value, name, this);
  }
  entries() { return _headersEntries(this)[Symbol.iterator](); }
  keys() { return _headersEntries(this).map(entry => entry[0])[Symbol.iterator](); }
  values() { return _headersEntries(this).map(entry => entry[1])[Symbol.iterator](); }
  getSetCookie() { _headersData(this); return []; }
  [Symbol.iterator]() { return this.entries(); }
};
globalThis.Headers = _Headers;
_markNative(Headers);
for (const name of ['get', 'set', 'has', 'delete', 'append', 'forEach', 'entries', 'keys', 'values', 'getSetCookie']) {
  _markNative(Headers.prototype[name]);
}
Object.defineProperty(Headers.prototype, Symbol.toStringTag, { value: 'Headers', configurable: true });
_reorderWebIDLPrototype(Headers.prototype,
  ['append', 'delete', 'get', 'getSetCookie', 'has', 'set', 'entries', 'forEach', 'keys', 'values', 'constructor']);

