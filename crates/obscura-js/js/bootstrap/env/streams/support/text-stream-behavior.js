// TextEncoderStream/TextDecoderStream adapters.  The public constructors and
// readonly properties stay in their object modules.
function _textEncoderStreamInitialize(stream) {
  const encoder = new TextEncoder();
  const transform = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(String(chunk)));
    },
  });
  stream.readable = transform.readable;
  stream.writable = transform.writable;
}

function _textDecoderStreamInitialize(stream, label, options) {
  const decoder = new TextDecoder(label, options);
  const transform = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(decoder.decode(chunk, {stream: true}));
    },
    flush(controller) {
      const tail = decoder.decode();
      if (tail) controller.enqueue(tail);
    },
  });
  stream.readable = transform.readable;
  stream.writable = transform.writable;
  stream._decoder = decoder;
}
