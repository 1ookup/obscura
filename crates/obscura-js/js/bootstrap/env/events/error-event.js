globalThis.ErrorEvent = class ErrorEvent extends Event {
  constructor(t, o = {}) {
    super(t, o);
    this.message = o.message || "";
    this.filename = o.filename || "";
    this.lineno = Number(o.lineno) || 0;
    this.colno = Number(o.colno) || 0;
    this.error = o.error !== undefined ? o.error : null;
  }
};

// HTML's "report the exception": fire an `error` event at the global object and
// give `window.onerror` first refusal, so a page's own collector sees the
// failure. Returning true (or calling preventDefault) marks the error handled
// and suppresses the console report, exactly as a browser does.
globalThis.__obscura_report_uncaught = function (thrown) {
  try {
    const message = thrown && thrown.message !== undefined
      ? String(thrown.message) : String(thrown);
    const filename = thrown && thrown.fileName !== undefined && thrown.fileName !== null
      ? String(thrown.fileName) : "";
    const lineno = Number(thrown && thrown.lineNumber) || 0;
    const colno = Number(thrown && thrown.columnNumber) || 0;
    let handled = false;
    const handler = globalThis.onerror;
    if (typeof handler === "function") {
      try {
        // The handler runs under its assignment snapshot's label, not the
        // failing turn's.
        if (__obscuraTraceCallWith(
              __obscuraTraceHandlerFrom(globalThis, 'onerror'),
              handler, globalThis,
              [message, filename, lineno, colno, thrown]) === true) {
          handled = true;
        }
      } catch (_handlerError) {}
    }
    const event = new globalThis.ErrorEvent("error", {
      message, filename, lineno, colno, error: thrown,
    });
    try {
      if (globalThis.dispatchEvent(event) === false) handled = true;
    } catch (_dispatchError) {}
    return handled;
  } catch (_reportError) {
    return false;
  }
};
