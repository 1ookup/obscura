// WHATWG URL parsing/serialization is delegated to the Rust `url` crate via
// op_url_parse / op_url_set. The op returns the full component set as JSON; the
// constructor caches it so getters are plain field reads (no per-access op) and
// the hot paths (navigation, fetch, _resolveUrl) stay cheap. Returns null when
// the input is not a valid URL.
function _urlParseOp(url, base) {
  try {
    const s = Deno.core.ops.op_url_parse(String(url), (base === undefined || base === null) ? "" : String(base));
    const c = JSON.parse(s);
    return (c && c.ok) ? c : null;
  } catch (e) { return null; }
}
function _urlSetOp(href, part, value) {
  try {
    const s = Deno.core.ops.op_url_set(String(href), part, String(value));
    const c = JSON.parse(s);
    return (c && c.ok) ? c : null;
  } catch (e) { return null; }
}
// Returns just the resolved absolute URL string (no component JSON), or null on
// failure. Cheaper than _urlParseOp for callers that only need the href.
function _urlResolveOp(href, base) {
  try {
    const r = Deno.core.ops.op_url_resolve(String(href), (base === undefined || base === null) ? "" : String(base));
    return r ? r : null;
  } catch (e) { return null; }
}
const _urlState = new WeakMap();
let _urlSearchParamsBind = null;
let _urlSearchParamsSetFromString = null;
function _urlData(value) {
  const state = _urlState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _urlSetPart(value, part, nextValue) {
  const state = _urlData(value);
  const parsed = _urlSetOp(state.c.href, part, nextValue);
  if (parsed) state.c = parsed;
}
function _urlRefreshSearchParams(value) {
  const state = _urlData(value);
  if (state.sp && _urlSearchParamsSetFromString) {
    _urlSearchParamsSetFromString(state.sp, state.c.search);
  }
}
function _urlUpdateSearch(value, query) {
  _urlSetPart(value, 'search', query ? ('?' + query) : '');
}
{
  const _URL = class URL {
    constructor(url, base) {
      const c = _urlParseOp(url, base);
      if (!c) throw new TypeError("Failed to construct 'URL': Invalid URL");
      _urlState.set(this, { c, sp: null });
    }
    get origin() { return _urlData(this).c.origin; }
    get protocol() { return _urlData(this).c.protocol; }
    set protocol(v) { _urlSetPart(this, 'protocol', v); }
    get username() { return _urlData(this).c.username; }
    set username(v) { _urlSetPart(this, 'username', v); }
    get password() { return _urlData(this).c.password; }
    set password(v) { _urlSetPart(this, 'password', v); }
    get host() { return _urlData(this).c.host; }
    set host(v) { _urlSetPart(this, 'host', v); }
    get hostname() { return _urlData(this).c.hostname; }
    set hostname(v) { _urlSetPart(this, 'hostname', v); }
    get port() { return _urlData(this).c.port; }
    set port(v) { _urlSetPart(this, 'port', v); }
    get pathname() { return _urlData(this).c.pathname; }
    set pathname(v) { _urlSetPart(this, 'pathname', v); }
    get search() { return _urlData(this).c.search; }
    set search(v) { _urlSetPart(this, 'search', v); _urlRefreshSearchParams(this); }
    get searchParams() {
      const state = _urlData(this);
      if (!state.sp) {
        state.sp = new URLSearchParams(state.c.search);
        if (_urlSearchParamsBind) _urlSearchParamsBind(state.sp, this);
      }
      return state.sp;
    }
    get hash() { return _urlData(this).c.hash; }
    set hash(v) { _urlSetPart(this, 'hash', v); }
    get href() { return _urlData(this).c.href; }
    set href(v) {
      const parsed = _urlParseOp(v, undefined);
      if (!parsed) throw new TypeError("Failed to set the 'href' property on 'URL': Invalid URL");
      _urlData(this).c = parsed;
      _urlRefreshSearchParams(this);
    }
    toJSON() { return _urlData(this).c.href; }
    toString() { return _urlData(this).c.href; }
    static createObjectURL() { return 'blob:null/fake-' + Math.random().toString(36).slice(2); }
    static revokeObjectURL() {}
    // WHATWG URL.parse: like the constructor but returns null instead of throwing.
    static parse(url, base) {
      const c = _urlParseOp(url, base);
      if (!c) return null;
      const parsed = Object.create(_URL.prototype);
      _urlState.set(parsed, { c, sp: null });
      return parsed;
    }
    static canParse(url, base) { return _urlParseOp(url, base) !== null; }
  };
  const constructorDescriptor = Object.getOwnPropertyDescriptor(_URL.prototype, 'constructor');
  delete _URL.prototype.constructor;
  Object.defineProperty(_URL.prototype, 'constructor', constructorDescriptor);
  globalThis.URL = _URL;
}

globalThis.requestIdleCallback = globalThis.requestIdleCallback || function requestIdleCallback(cb, opts) {
  const start = Date.now();
  return setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining() { return Math.max(0, 50 - (Date.now() - start)); },
    });
  }, 1);
};
globalThis.cancelIdleCallback = globalThis.cancelIdleCallback || function cancelIdleCallback(id) { clearTimeout(id); };
_markNative(globalThis.requestIdleCallback);
_markNative(globalThis.cancelIdleCallback);

