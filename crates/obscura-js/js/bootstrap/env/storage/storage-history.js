// WHATWG Storage as a legacy platform object: a Proxy routes property access
// (localStorage.foo, localStorage["foo"], delete, `in`, Object.keys) through
// the named getter/setter so length/key()/iteration stay in sync with the
// backing map. Plain prototype methods alone could not intercept direct
// property access, so `localStorage.foo = x` never updated length before.
globalThis.Storage = function Storage() {};
// Every Window realm receives its own Storage wrapper, while the backing area
// lives in the page's native state and is keyed by typed serialized origin.
// This makes same-origin frames share entries without sharing wrappers or
// constructors. Opaque origins have no storage key and fail closed.
function _storageOrigin() {
  const origin = _environmentSettings().origin;
  if (!origin || origin === 'null') {
    throw new DOMException('Access to storage is not allowed from an opaque origin.', 'SecurityError');
  }
  return origin;
}
function _storageCall(action, kind, key, value) {
  return Deno.core.ops.op_origin_storage(
    action, kind, _storageOrigin(), String(key ?? ''), String(value ?? ''));
}
Storage.prototype.getItem = function(k) {
  return JSON.parse(_storageCall('get', this._kind, String(k), ''));
};
Storage.prototype.setItem = function(k, v) {
  _storageCall('set', this._kind, String(k), String(v));
};
Storage.prototype.removeItem = function(k) {
  _storageCall('remove', this._kind, String(k), '');
};
Storage.prototype.clear = function() {
  _storageCall('clear', this._kind, '', '');
};
Storage.prototype.key = function(i) {
  return JSON.parse(_storageCall('key', this._kind, i >>> 0, ''));
};
Object.defineProperty(Storage.prototype, 'length', {
  get: function() { return +_storageCall('length', this._kind, '', ''); }, configurable: true,
});

const _mkStore = (kind) => {
  const target = Object.create(Storage.prototype);
  Object.defineProperty(target, '_kind', { value: kind, writable: false, enumerable: false, configurable: true });
  const isReal = (p) => p === '_kind' || p === 'constructor' || (p in Storage.prototype);
  return new Proxy(target, {
    get(t, p, recv) { if (typeof p === 'symbol' || isReal(p)) return Reflect.get(t, p, recv); const v = t.getItem(p); return v === null ? undefined : v; },
    set(t, p, v, recv) { if (typeof p === 'symbol' || isReal(p)) return Reflect.set(t, p, v, recv); t.setItem(p, v); return true; },
    has(t, p) { if (typeof p === 'symbol' || isReal(p)) return true; return t.getItem(p) !== null; },
    deleteProperty(t, p) { if (typeof p === 'symbol' || isReal(p)) return Reflect.deleteProperty(t, p); t.removeItem(p); return true; },
    ownKeys(t) { return JSON.parse(_storageCall('keys', t._kind, '', '')); },
    getOwnPropertyDescriptor(t, p) {
      if (typeof p !== 'symbol') {
        const value = t.getItem(p);
        if (value !== null) return { value, writable: true, enumerable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
};
function registerStorageSurface() {
  globalThis.localStorage = _mkStore('local');
  globalThis.sessionStorage = _mkStore('session');
}
registerStorageSurface();

// `btoa`/`atob` are byte-oriented: every code unit of the string is one byte,
// and the decoded string is Latin-1. Encoding through TextEncoder instead
// makes the pair look self-consistent (`atob(btoa(s)) === s` still holds) while
// silently inflating every code unit above 0x7F to two bytes, so any binary
// round trip through them -- a FileReader data URL, a JWK byte field, an
// ECDSA/RSA key exported to Rust and back, a challenge payload decoded with
// `Uint8Array.from(atob(x), c=>c.charCodeAt(0))` -- comes back the wrong
// length and the wrong bytes.
//
// Measured against Chrome 152 on the bytes [0x41,0x80,0xA1,0xFF,0x42]:
//   Chrome  btoa -> "QYCh/0I="        atob -> 5 bytes [65,128,161,255,66]
//   before  btoa -> "QcKAwqHDv0I="    atob -> 8 bytes [65,194,128,...]
// and `btoa('Ā')` throws InvalidCharacterError in Chrome, which a UTF-8
// encoder cannot do because it never sees a code unit above 0xFF.
globalThis.btoa = globalThis.btoa || ((data) => {
  const s = String(data);
  const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let r="";
  for(let i=0;i<s.length;i+=3){
    const a=s.charCodeAt(i);
    const hasB=i+1<s.length, hasC=i+2<s.length;
    const b=hasB?s.charCodeAt(i+1):0, cc=hasC?s.charCodeAt(i+2):0;
    if(a>0xff||b>0xff||cc>0xff){
      throw new DOMException(
        "Failed to execute 'btoa' on 'Window': The string to be encoded contains characters outside of the Latin1 range.",
        "InvalidCharacterError");
    }
    r+=c[a>>2]+c[((a&3)<<4)|(b>>4)]+(hasB?c[((b&15)<<2)|(cc>>6)]:"=")+(hasC?c[cc&63]:"=");
  }
  return r;
});
globalThis.atob = globalThis.atob || ((data) => {
  const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s=String(data).replace(/[\t\n\f\r ]/g,"");
  // `forgiving-base64 decode`: the padding is optional and is dropped before
  // the length check, so "QQ" and "QQ==" both decode and "Q" does not.
  if(s.length%4===0){
    if(s.endsWith("=="))s=s.slice(0,-2);
    else if(s.endsWith("="))s=s.slice(0,-1);
  }
  if(s.length%4===1){
    throw new DOMException(
      "Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.",
      "InvalidCharacterError");
  }
  const r=[];
  for(let i=0;i<s.length;i+=4){
    const a=c.indexOf(s[i]),b=c.indexOf(s[i+1]),cc=c.indexOf(s[i+2]),d=c.indexOf(s[i+3]);
    if(a<0||b<0||(i+2<s.length&&cc<0)||(i+3<s.length&&d<0)){
      throw new DOMException(
        "Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.",
        "InvalidCharacterError");
    }
    r.push((a<<2)|(b>>4));
    if(cc>=0)r.push(((b&15)<<4)|(cc>>2));
    if(d>=0)r.push(((cc&3)<<6)|d);
  }
  // Spreading a large decoded payload into one call overflows V8's argument
  // stack. Angular and other SSR frameworks routinely decode blobs large
  // enough to hit that ceiling.
  let out="";
  const chunk=0x8000;
  for(let i=0;i<r.length;i+=chunk) out+=String.fromCharCode(...r.slice(i,i+chunk));
  return out;
});

// Functional History API. The earlier stub returned constant state and was a
// no-op on push/replace, so any SPA that tried to update its URL (Next.js
// client router, React Router, vue-router, hash-based routers) silently
// failed: location.href stayed pinned to the initial page, useLocation hooks
// never updated, and popstate-driven UI froze.
//
// Internally we keep a tiny in-memory stack of {state, url} entries. push/
// replace mutate the stack and set globalThis.__virtualUrl so location.href
// reads the new URL. Real Chrome doesn't fire popstate on push/replace,
// only on user-driven back/forward — we match that exactly.
function registerHistorySurface() {
  const stack = [{state: null, url: undefined}]; // initial entry; url=undefined means "use document URL"
  let idx = 0;
  const historyToken = Symbol("History");
  const resolveOrFallback = (url) => {
    // A missing url (pushState/replaceState called with < 3 args) keeps the
    // current document URL per the HTML spec — capture it so the entry does not
    // reset location back to the original document URL.
    if (url === null || url === undefined) return __currentUrl();
    try { return new URL(String(url), __currentUrl()).href; } catch (e) { return String(url); }
  };
  const applyVirtual = () => {
    const entry = stack[idx];
    globalThis.__virtualUrl = entry.url ?? null;
  };
  const fireHashChangeIfNeeded = (prevUrl) => {
    try {
      const next = __currentUrl();
      if (!prevUrl || !next) return;
      const a = new URL(prevUrl), b = new URL(next);
      if (a.origin === b.origin && a.pathname === b.pathname && a.search === b.search && a.hash !== b.hash) {
        const ev = new Event('hashchange');
        ev.oldURL = prevUrl; ev.newURL = next;
        try { globalThis.dispatchEvent(ev); } catch {}
      }
    } catch {}
  };
  class History {
    constructor(token) {
      if (token !== historyToken) throw new TypeError("Illegal constructor");
    }
    get length() { return stack.length; }
    get state() { return stack[idx].state; }
    get scrollRestoration() { return this._scrollRestoration || "auto"; }
    set scrollRestoration(value) {
      const normalized = String(value);
      if (normalized === "auto" || normalized === "manual") {
        this._scrollRestoration = normalized;
      }
    }
    pushState(state, _title, url) {
      const prevUrl = __currentUrl();
      const resolved = resolveOrFallback(url);
      // Truncate forward entries (real Chrome drops the forward stack on a
      // new push) then append + advance.
      stack.length = idx + 1;
      stack.push({state: state ?? null, url: resolved});
      idx = stack.length - 1;
      applyVirtual();
      fireHashChangeIfNeeded(prevUrl);
    }
    replaceState(state, _title, url) {
      const prevUrl = __currentUrl();
      const resolved = resolveOrFallback(url);
      stack[idx] = {state: state ?? null, url: resolved};
      applyVirtual();
      fireHashChangeIfNeeded(prevUrl);
    }
    go(n) {
      n = (n | 0);
      if (n === 0) return; // real spec: go(0) reloads. We don't reload SPAs.
      const next = Math.max(0, Math.min(stack.length - 1, idx + n));
      if (next === idx) return;
      const prevUrl = __currentUrl();
      idx = next;
      applyVirtual();
      // Real Chrome fires popstate on back/forward with the destination entry's state.
      try {
        const ev = new PopStateEvent('popstate', {state: stack[idx].state});
        globalThis.dispatchEvent(ev);
      } catch {}
      fireHashChangeIfNeeded(prevUrl);
    }
    back() { this.go(-1); }
    forward() { this.go(1); }
  }
  // configurable:true is what WebIDL specifies for @@toStringTag; the default
  // (false) is observable through getOwnPropertyDescriptor.
  Object.defineProperty(History.prototype, Symbol.toStringTag, {value: "History", configurable: true});
  Object.defineProperty(globalThis, "History", {
    value: History, writable: true, configurable: true,
  });
  Object.defineProperty(globalThis, "history", {
    value: new History(historyToken), writable: true, configurable: true,
  });
}

registerHistorySurface();

