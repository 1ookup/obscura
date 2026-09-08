if (typeof TextEncoderStream === 'undefined') {
  globalThis.TextEncoderStream = class TextEncoderStream {
    constructor() { _textEncoderStreamInitialize(this); }
    get encoding() { return "utf-8"; }
  };
}
