// ReadableStream host behavior. State is realm-local and hidden so stream
// instances expose the browser shape rather than implementation fields.
const _readableStreamState = new WeakMap();

function _readableSlots(stream) {
  const slots = _readableStreamState.get(stream);
  if (!slots) throw new TypeError('Illegal invocation');
  return slots;
}

function _readableError(stream, error) {
  const slots = _readableSlots(stream);
  if (slots.state !== 'readable') return;
  slots.state = 'errored';
  slots.error = error;
  while (slots.reads.length) slots.reads.shift().reject(error);
}

function _readableInitialize(stream, source) {
  const slots = {
    source,
    queue: [],
    reads: [],
    state: 'readable',
    error: null,
    locked: false,
    controller: null,
  };
  _readableStreamState.set(stream, slots);
  slots.controller = {
    enqueue(chunk) {
      if (slots.state !== 'readable') return;
      const pending = slots.reads.shift();
      if (pending) pending.resolve({value: chunk, done: false});
      else slots.queue.push(chunk);
    },
    close() {
      if (slots.state !== 'readable') return;
      slots.state = 'closed';
      while (slots.reads.length) {
        slots.reads.shift().resolve({value: undefined, done: true});
      }
    },
    error(error) { _readableError(stream, error); },
    get desiredSize() { return Math.max(0, 1 - slots.queue.length); },
  };
  try {
    const started = source.start?.(slots.controller);
    if (started && typeof started.then === 'function') {
      started.catch((error) => _readableError(stream, error));
    }
  } catch (error) {
    _readableError(stream, error);
  }
}

function _readableLocked(stream) { return _readableSlots(stream).locked; }

function _readableGetReader(stream) {
  const slots = _readableSlots(stream);
  if (slots.locked) throw new TypeError('ReadableStream is locked');
  slots.locked = true;
  return {
    read() {
      if (slots.queue.length > 0) {
        return Promise.resolve({value: slots.queue.shift(), done: false});
      }
      if (slots.state === 'closed') {
        return Promise.resolve({value: undefined, done: true});
      }
      if (slots.state === 'errored') return Promise.reject(slots.error);
      return new Promise((resolve, reject) => slots.reads.push({resolve, reject}));
    },
    releaseLock() { slots.locked = false; },
    cancel(reason) { return _readableCancel(stream, reason); },
    get closed() {
      if (slots.state === 'closed') return Promise.resolve();
      if (slots.state === 'errored') return Promise.reject(slots.error);
      return new Promise((resolve, reject) => {
        const poll = () => {
          if (slots.state === 'closed') resolve();
          else if (slots.state === 'errored') reject(slots.error);
          else setTimeout(poll, 0);
        };
        poll();
      });
    },
  };
}

function _readableCancel(stream, reason) {
  const slots = _readableSlots(stream);
  slots.queue.length = 0;
  slots.controller.close();
  try { return Promise.resolve(slots.source.cancel?.(reason)); }
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
    try { _readableError(transform.readable, error); } catch {}
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

function _readableAsyncIterator(stream, options) {
  const reader = stream.getReader();
  return {
    next: () => reader.read(),
    return: () => {
      reader.releaseLock();
      return Promise.resolve({done: true});
    },
  };
}
