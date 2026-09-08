// TransformStream composition behavior.  Keeping this separate makes the
// shape module a small WebIDL-like interface while preserving the existing
// ReadableStream/WritableStream controllers and error propagation.
function _transformInitialize(stream, transformer) {
  let controller;
  stream.readable = new ReadableStream({
    start(readableController) { controller = readableController; },
  });
  stream.writable = new WritableStream({
    async write(chunk) {
      if (transformer.transform) await transformer.transform(chunk, controller);
      else controller.enqueue(chunk);
    },
    async close() {
      if (transformer.flush) await transformer.flush(controller);
      controller.close();
    },
    abort(reason) { controller.error(reason); },
  });
  try { transformer.start?.(controller); }
  catch (error) { controller.error(error); }
}
