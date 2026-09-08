if (typeof ReadableStream === 'undefined') {
  globalThis.ReadableStream = class ReadableStream {
    constructor(source = {}, strategy = {}) { _readableInitialize(this, source, strategy); }
    getReader() { return _readableGetReader(this); }
    cancel(reason) { return _readableCancel(this, reason); }
    async pipeTo(destination) { return _readablePipeTo(this, destination); }
    pipeThrough(transform) { return _readablePipeThrough(this, transform); }
    tee() { return _readableTee(this); }
    [Symbol.asyncIterator]() { return _readableAsyncIterator(this); }
  };
}
