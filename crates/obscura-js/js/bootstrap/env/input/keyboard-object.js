globalThis.Keyboard = class Keyboard {
  constructor() { throw new TypeError('Illegal constructor'); }
  getLayoutMap() {
    const map = Object.create(globalThis.KeyboardLayoutMap.prototype);
    Object.defineProperty(map, '_entries', {
      value: new Map(_KEYBOARD_LAYOUT_US), configurable: true,
    });
    return Promise.resolve(map);
  }
  lock() { return Promise.resolve(); }
  unlock() {}
  addEventListener(type, callback, options) { _eventTargetAdd(this, type, callback, options); }
  removeEventListener(type, callback, options) { _eventTargetRemove(this, type, callback, options); }
  dispatchEvent(event) { return _eventTargetDispatch(this, event); }
  get [Symbol.toStringTag]() { return 'Keyboard'; }
};
navigator.keyboard = Object.create(globalThis.Keyboard.prototype);
navigator.keyboard = Object.create(globalThis.Keyboard.prototype);
