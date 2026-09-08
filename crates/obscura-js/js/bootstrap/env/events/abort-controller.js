// AbortController / AbortSignal. AbortSignal is a real constructor with a
// prototype, so feature-detection and `AbortSignal.prototype` access work. It
// carries aborted/reason, supports throwIfAborted(), and fires "abort" to
// onabort and addEventListener listeners when the controller aborts.
(function () {
  const BRAND = Symbol("AbortSignal");
  function emit(signal, evt) {
    if (typeof signal.onabort === "function") {
      try { signal.onabort.call(signal, evt); } catch (_) {}
    }
    for (const cb of signal._listeners.slice()) {
      const fn = typeof cb === "function" ? cb : cb && cb.handleEvent;
      if (typeof fn === "function") { try { fn.call(signal, evt); } catch (_) {} }
    }
  }
  function fire(signal, reason) {
    if (signal._aborted) return;
    signal._aborted = true;
    signal._reason = reason !== undefined
      ? reason
      : new DOMException("This operation was aborted", "AbortError");
    const evt = typeof Event === "function" ? new Event("abort") : { type: "abort" };
    try { if (evt instanceof Event) _eventSetEndpoints(evt, signal, signal); } catch (_) {}
    emit(signal, evt);
  }
  globalThis.AbortSignal = class AbortSignal {
    constructor(brand) {
      if (brand !== BRAND) {
        throw new TypeError("Failed to construct 'AbortSignal': Illegal constructor");
      }
      this._aborted = false;
      this._reason = undefined;
      this._listeners = [];
      this.onabort = null;
    }
    get aborted() { return this._aborted; }
    get reason() { return this._reason; }
    throwIfAborted() { if (this._aborted) throw this._reason; }
    addEventListener(type, cb) {
      if (type === "abort" && cb != null) this._listeners.push(cb);
    }
    removeEventListener(type, cb) {
      if (type !== "abort") return;
      const i = this._listeners.indexOf(cb);
      if (i >= 0) this._listeners.splice(i, 1);
    }
    dispatchEvent(evt) {
      if (evt && evt.type === "abort") emit(this, evt);
      return true;
    }
    static abort(reason) {
      const s = new AbortSignal(BRAND);
      s._aborted = true;
      s._reason = reason !== undefined
        ? reason
        : new DOMException("This operation was aborted", "AbortError");
      return s;
    }
    static timeout(ms) {
      const s = new AbortSignal(BRAND);
      setTimeout(() => fire(s, new DOMException("signal timed out", "TimeoutError")), ms);
      return s;
    }
    static any(signals) {
      const s = new AbortSignal(BRAND);
      const list = Array.from(signals || []);
      for (const sig of list) {
        if (sig && sig.aborted) { s._aborted = true; s._reason = sig.reason; return s; }
      }
      for (const sig of list) {
        if (sig && typeof sig.addEventListener === "function") {
          sig.addEventListener("abort", () => fire(s, sig.reason));
        }
      }
      return s;
    }
  };
  globalThis.AbortController = class AbortController {
    constructor() { this.signal = new globalThis.AbortSignal(BRAND); }
    abort(reason) { fire(this.signal, reason); }
  };
  _markNative(globalThis.AbortSignal);
  _markNative(globalThis.AbortController);
})();
