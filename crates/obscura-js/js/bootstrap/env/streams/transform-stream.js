if (typeof TransformStream === 'undefined') {
  globalThis.TransformStream = class TransformStream {
    constructor(transformer = {}) {
      let controller;
      this.readable = new ReadableStream({
        start(readableController) { controller = readableController; },
      });
      this.writable = new WritableStream({
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
  };
}
