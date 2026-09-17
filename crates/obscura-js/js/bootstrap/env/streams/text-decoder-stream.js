if (typeof TextDecoderStream === 'undefined') {
  globalThis.TextDecoderStream = class TextDecoderStream {
    constructor(label = "utf-8", options = {}) { _textDecoderStreamInitialize(this, label, options); }
    get encoding() { return this._decoder.encoding; }
    get fatal() { return this._decoder.fatal; }
    get ignoreBOM() { return this._decoder.ignoreBOM; }
  };
}
