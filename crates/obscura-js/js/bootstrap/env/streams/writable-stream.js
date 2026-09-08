if (typeof WritableStream === 'undefined') {
  globalThis.WritableStream = class WritableStream {
    constructor(sink = {}) {
      this._sink = sink;
      this._state = "writable";
      this._error = null;
      this._chain = Promise.resolve();
      this.locked = false;
      try {
        const started = sink.start?.({});
        if (started && typeof started.then === "function") this._chain = Promise.resolve(started);
      } catch (error) {
        this._state = "errored";
        this._error = error;
        this._chain = Promise.reject(error);
      }
    }
    getWriter() {
      if (this.locked) throw new TypeError("WritableStream is locked");
      this.locked = true;
      const stream = this;
      return {
        write(chunk) {
          if (stream._state !== "writable") return Promise.reject(stream._error || new TypeError("WritableStream is closed"));
          stream._chain = stream._chain.then(() => stream._sink.write?.(chunk));
          return stream._chain;
        },
        close() {
          if (stream._state !== "writable") return stream._chain;
          stream._state = "closed";
          stream._chain = stream._chain.then(() => stream._sink.close?.());
          return stream._chain;
        },
        abort(reason) {
          stream._state = "errored";
          stream._error = reason;
          stream._chain = stream._chain.then(() => stream._sink.abort?.(reason));
          return stream._chain;
        },
        releaseLock() { stream.locked = false; },
        get ready() { return stream._chain.then(() => undefined); },
        get closed() { return stream._chain.then(() => undefined); },
        get desiredSize() { return 1; },
      };
    }
    close() { const writer = this.getWriter(); return writer.close().finally(() => writer.releaseLock()); }
    abort(reason) { const writer = this.getWriter(); return writer.abort(reason).finally(() => writer.releaseLock()); }
  };
}
