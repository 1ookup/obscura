if (typeof ReadableStream === 'undefined') {
  globalThis.ReadableStream = class ReadableStream {
    constructor(source = {}, strategy = {}) { _readableInitialize(this, source, strategy); }
    get locked() { return _readableLocked(this); }
    getReader() { return _readableGetReader(this); }
    cancel(reason) { return _readableCancel(this, reason); }
    async pipeTo(destination) { return _readablePipeTo(this, destination); }
    pipeThrough(transform) { return _readablePipeThrough(this, transform); }
    tee() { return _readableTee(this); }
    values(options = undefined) { return _readableAsyncIterator(this, options); }
  };
  Object.defineProperty(globalThis.ReadableStream.prototype, Symbol.asyncIterator, {
    value: globalThis.ReadableStream.prototype.values,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
