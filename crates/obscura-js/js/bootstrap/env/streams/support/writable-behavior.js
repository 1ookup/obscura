// WritableStream sink scheduling.  WritableStream's public shape stays in the
// neighboring object module; this helper owns its state transitions.
function _writableInitialize(stream, sink) {
  stream._sink = sink;
  stream._state = 'writable';
  stream._error = null;
  stream._chain = Promise.resolve();
  stream.locked = false;
  try {
    const started = sink.start?.({});
    if (started && typeof started.then === 'function') {
      stream._chain = Promise.resolve(started);
    }
  } catch (error) {
    stream._state = 'errored';
    stream._error = error;
    stream._chain = Promise.reject(error);
  }
}

function _writableGetWriter(stream) {
  if (stream.locked) throw new TypeError('WritableStream is locked');
  stream.locked = true;
  return {
    write(chunk) {
      if (stream._state !== 'writable') {
        return Promise.reject(stream._error || new TypeError('WritableStream is closed'));
      }
      stream._chain = stream._chain.then(() => stream._sink.write?.(chunk));
      return stream._chain;
    },
    close() {
      if (stream._state !== 'writable') return stream._chain;
      stream._state = 'closed';
      stream._chain = stream._chain.then(() => stream._sink.close?.());
      return stream._chain;
    },
    abort(reason) {
      stream._state = 'errored';
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

function _writableClose(stream) {
  const writer = stream.getWriter();
  return writer.close().finally(() => writer.releaseLock());
}

function _writableAbort(stream, reason) {
  const writer = stream.getWriter();
  return writer.abort(reason).finally(() => writer.releaseLock());
}
