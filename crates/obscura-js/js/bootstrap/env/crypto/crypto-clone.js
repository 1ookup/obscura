function registerCryptoSurface() {
  globalThis.crypto = globalThis.crypto || new globalThis.Crypto();
}
registerCryptoSurface();
// Real structured clone (not JSON). JSON.parse(JSON.stringify) silently drops
// ArrayBuffer/TypedArray (they serialize to {}), so browser verification
// orchestrate loses every byte it tries to round-trip through postMessage and
// the challenge never completes (issue #389). Clone buffers, typed arrays,
// maps/sets, dates, errors, and plain objects recursively; CryptoKey and other
// types that register a clone hook (see crypto.subtle below) are routed there.
function _structuredClone(value, seen) {
  // Functions and symbols are not structured-cloneable (HTML structured clone,
  // DataCloneError). This must run before the primitive early-return below,
  // which would otherwise pass them through by reference.
  if (typeof value === "function" || typeof value === "symbol") {
    throw new DOMException("Failed to execute 'structuredClone': value could not be cloned.", "DataCloneError");
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  // Typed arrays: copy the underlying buffer slice. DataView has no .slice(),
  // so slice its buffer over the view's range and wrap a fresh view.
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      const copy = new DataView(buf);
      seen.set(value, copy);
      return copy;
    }
    const Ctor = value.constructor;
    const copy = new Ctor(value.slice());
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    seen.set(value, copy);
    return copy;
  }
  if (_SharedArrayBufferCtor && value instanceof _SharedArrayBufferCtor) {
    return value; // transferable, not copyable
  }
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) {
    const m = new Map();
    seen.set(value, m);
    for (const [k, v] of value) m.set(_structuredClone(k, seen), _structuredClone(v, seen));
    return m;
  }
  if (value instanceof Set) {
    const s = new Set();
    seen.set(value, s);
    for (const v of value) s.add(_structuredClone(v, seen));
    return s;
  }
  if (value instanceof Error) {
    const Ctor = value.constructor || Error;
    const e = new Ctor(value.message);
    // Record the clone before recursing into `cause`, otherwise a cycle
    // through the error (e.cause === e) recurses until the stack overflows.
    seen.set(value, e);
    if (value.name) e.name = value.name;
    if (value.stack) e.stack = value.stack;
    if (value.cause !== undefined) e.cause = _structuredClone(value.cause, seen);
    return e;
  }
  // Platform objects that carry internal slots opt into cloning via a hook
  // (CryptoKey re-registers its key material so the clone stays usable by
  // crypto.subtle). Anything else with a registered hook takes that path.
  if (typeof value[Symbol.toStringTag] === "string" && globalThis.__obscura_clone_hooks) {
    const hook = globalThis.__obscura_clone_hooks[value[Symbol.toStringTag]];
    if (typeof hook === "function") return hook(value, seen);
  }
  // Plain objects clone onto Object.prototype (like Chrome), not the source's
  // prototype. Define each property instead of assigning it: a source with an
  // own enumerable `__proto__` data prop (what JSON.parse('{"__proto__":…}')
  // yields) would otherwise hit the inherited __proto__ setter and reparent
  // the clone instead of copying the property.
  const out = Array.isArray(value) ? [] : {};
  seen.set(value, out);
  for (const k in value) {
    if (Object.prototype.hasOwnProperty.call(value, k)) {
      const cloned = _structuredClone(value[k], seen);
      // Only `__proto__` needs defineProperty: plain assignment would hit the
      // inherited prototype setter and reparent the clone instead of adding an
      // own data property. Every other key takes the fast assignment path.
      if (k === "__proto__") {
        Object.defineProperty(out, k, {
          value: cloned,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        out[k] = cloned;
      }
    }
  }
  // Symbols are not enumerable via for-in; copy own symbol-keyed properties.
  const syms = Object.getOwnPropertySymbols(value);
  for (const s of syms) {
    const d = Object.getOwnPropertyDescriptor(value, s);
    if (d && "value" in d) out[s] = _structuredClone(d.value, seen);
  }
  return out;
}
globalThis.structuredClone = globalThis.structuredClone || ((v) => _structuredClone(v, new Map()));
globalThis.reportError = globalThis.reportError || ((e) => console.error(e));

