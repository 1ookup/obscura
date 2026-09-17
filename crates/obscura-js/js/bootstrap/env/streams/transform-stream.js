if (typeof TransformStream === 'undefined') {
  globalThis.TransformStream = class TransformStream {
    constructor(transformer = {}) { _transformInitialize(this, transformer); }
  };
}
