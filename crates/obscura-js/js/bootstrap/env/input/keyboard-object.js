// Keyboard is a plain interface with four prototype members -- Chrome 149
// measures [constructor, getLayoutMap, lock, unlock] and NO event methods
// (Keyboard is not an EventTarget). The KeyboardLayoutMap instance likewise
// answers [] to own-key reflection: the entries live in realm-side state,
// never on the object (the ddiv valuediff B6 surface).
globalThis.Keyboard = class Keyboard {
  constructor() { throw new TypeError('Illegal constructor'); }
  getLayoutMap() {
    const map = Object.create(globalThis.KeyboardLayoutMap.prototype);
    _keyboardLayoutState.set(map, new Map(_KEYBOARD_LAYOUT_US));
    return Promise.resolve(map);
  }
  lock() { return Promise.resolve(); }
  unlock() {}
  get [Symbol.toStringTag]() { return 'Keyboard'; }
};
navigator.keyboard = Object.create(globalThis.Keyboard.prototype);
