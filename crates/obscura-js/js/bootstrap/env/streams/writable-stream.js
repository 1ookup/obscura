if (typeof WritableStream === 'undefined') {
  globalThis.WritableStream = class WritableStream {
    constructor(sink = {}) { _writableInitialize(this, sink); }
    getWriter() { return _writableGetWriter(this); }
    close() { return _writableClose(this); }
    abort(reason) { return _writableAbort(this, reason); }
  };
}
