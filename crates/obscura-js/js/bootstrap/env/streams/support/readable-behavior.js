// ReadableStream host behavior.  The public interface and constructor remain
// in readable-stream.js; this file owns the queue/controller operations so the
// shape can be audited without having to parse the stream algorithm.
function _readableInitialize(stream, source) {
  stream._source = source;
  stream._queue = [];
  stream._reads = [];
  stream._state = 'readable';
  stream._error = null;
  stream.locked = false;
  stream._controller = {
    enqueue(chunk) {
      if (stream._state !== 'readable') return;
      const pending = stream._reads.shift();
      if (pending) pending.resolve({value: chunk, done: false});
      else stream._queue.push(chunk);
    },
    close() {
      if (stream._state !== 'readable') return;
      stream._state = 'closed';
      while (stream._reads.length) {
        stream._reads.shift().resolve({value: undefined, done: true});
      }
    },
    error(error) {
      if (stream._state !== 'readable') return;
      stream._state = 'errored';
      stream._error = error;
      while (stream._reads.length) stream._reads.shift().reject(error);
    },
    get desiredSize() { return Math.max(0, 1 - stream._queue.length); },
  };
  try {
    const started = source.start?.(stream._controller);
    if (started && typeof started.then === 'function') {
      started.catch((error) => stream._controller.error(error));
    }
  } catch (error) {
    stream._controller.error(error);
  }
}

function _readableGetReader(stream) {
  if (stream.locked) throw new TypeError('ReadableStream is locked');
  stream.locked = true;
  return {
    read() {
      if (stream._queue.length > 0) {
        return Promise.resolve({value: stream._queue.shift(), done: false});
      }
      if (stream._state === 'closed') {
        return Promise.resolve({value: undefined, done: true});
      }
      if (stream._state === 'errored') return Promise.reject(stream._error);
      return new Promise((resolve, reject) => stream._reads.push({resolve, reject}));
    },
    releaseLock() { stream.locked = false; },
    cancel(reason) { return _readableCancel(stream, reason); },
    get closed() {
      if (stream._state === 'closed') return Promise.resolve();
      if (stream._state === 'errored') return Promise.reject(stream._error);
      return new Promise((resolve, reject) => {
        const poll = () => {
          if (stream._state === 'closed') resolve();
          else if (stream._state === 'errored') reject(stream._error);
          else setTimeout(poll, 0);
        };
        poll();
      });
    },
  };
}

function _readableCancel(stream, reason) {
  stream._queue.length = 0;
  stream._controller.close();
  try { return Promise.resolve(stream._source.cancel?.(reason)); }
  catch (error) { return Promise.reject(error); }
}

async function _readablePipeTo(stream, destination) {
  const reader = stream.getReader();
  const writer = destination.getWriter();
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (error) {
    try { await writer.abort(error); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}

function _readablePipeThrough(stream, transform) {
  _readablePipeTo(stream, transform.writable).catch((error) => {
    try { transform.readable._controller?.error(error); } catch {}
  });
  return transform.readable;
}

function _readableTee(stream) {
  let leftController;
  let rightController;
  const left = new ReadableStream({start(controller) { leftController = controller; }});
  const right = new ReadableStream({start(controller) { rightController = controller; }});
  (async () => {
    try {
      const reader = stream.getReader();
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        leftController.enqueue(value);
        rightController.enqueue(value);
      }
      leftController.close();
      rightController.close();
    } catch (error) {
      leftController.error(error);
      rightController.error(error);
    }
  })();
  return [left, right];
}

function _readableAsyncIterator(stream) {
  const reader = stream.getReader();
  return {
    next: () => reader.read(),
    return: () => {
      reader.releaseLock();
      return Promise.resolve({done: true});
    },
  };
}
