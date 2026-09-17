// ResizeObserver value objects. Delivery and measurement scheduling remain in
// resize.js; these constructors only describe the WebIDL object shape.
const _roConstructionKey = {};
const _roSizeValues = new WeakMap();
globalThis.ResizeObserverSize = class ResizeObserverSize {
  constructor(key, inlineSize, blockSize) {
    if (key !== _roConstructionKey) throw new TypeError('Illegal constructor');
    _roSizeValues.set(this, { inlineSize, blockSize });
  }
  get inlineSize() { return _roSizeValues.get(this)?.inlineSize; }
  get blockSize() { return _roSizeValues.get(this)?.blockSize; }
};
const _roEntryValues = new WeakMap();
globalThis.ResizeObserverEntry = class ResizeObserverEntry {
  constructor(key, target, measurement) {
    if (key !== _roConstructionKey) throw new TypeError('Illegal constructor');
    _roEntryValues.set(this, { target, measurement });
  }
  get target() { return _roEntryValues.get(this)?.target; }
  get contentRect() { return _roEntryValues.get(this)?.measurement.contentRect; }
  get borderBoxSize() { return _roEntryValues.get(this)?.measurement.borderBoxSize; }
  get contentBoxSize() { return _roEntryValues.get(this)?.measurement.contentBoxSize; }
  get devicePixelContentBoxSize() {
    return _roEntryValues.get(this)?.measurement.devicePixelContentBoxSize;
  }
};
