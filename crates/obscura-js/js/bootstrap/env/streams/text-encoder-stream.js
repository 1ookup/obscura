if (typeof TextEncoderStream === 'undefined') {
  globalThis.TextEncoderStream = class TextEncoderStream {
    constructor() {
      const encoder = new TextEncoder();
      const transform = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(encoder.encode(String(chunk)));
        },
      });
      this.readable = transform.readable;
      this.writable = transform.writable;
    }
    get encoding() { return "utf-8"; }
  };
}
