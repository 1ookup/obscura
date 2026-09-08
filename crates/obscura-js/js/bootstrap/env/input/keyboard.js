// This is the US ANSI layout, which is the one the reported Windows identity
// implies -- notably without `IntlBackslash`, the extra key an ISO board has
// and an ANSI board does not.
const _KEYBOARD_LAYOUT_US = [
  ['Backquote', '`'], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'],
  ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'],
  ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-'],
  ['Equal', '='],
  ['KeyQ', 'q'], ['KeyW', 'w'], ['KeyE', 'e'], ['KeyR', 'r'], ['KeyT', 't'],
  ['KeyY', 'y'], ['KeyU', 'u'], ['KeyI', 'i'], ['KeyO', 'o'], ['KeyP', 'p'],
  ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\'],
  ['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'], ['KeyF', 'f'], ['KeyG', 'g'],
  ['KeyH', 'h'], ['KeyJ', 'j'], ['KeyK', 'k'], ['KeyL', 'l'],
  ['Semicolon', ';'], ['Quote', "'"],
  ['KeyZ', 'z'], ['KeyX', 'x'], ['KeyC', 'c'], ['KeyV', 'v'], ['KeyB', 'b'],
  ['KeyN', 'n'], ['KeyM', 'm'], ['Comma', ','], ['Period', '.'], ['Slash', '/'],
];
// KeyboardLayoutMap is maplike and read-only: it answers `get`/`has`/`size`
// and iterates, but has no `set`. A plain Map would answer `set` too.
globalThis.KeyboardLayoutMap = class KeyboardLayoutMap {
  constructor() { throw new TypeError('Illegal constructor'); }
  get size() { return this._entries.size; }
  get(key) { return this._entries.get(String(key)); }
  has(key) { return this._entries.has(String(key)); }
  keys() { return this._entries.keys(); }
  values() { return this._entries.values(); }
  entries() { return this._entries.entries(); }
  forEach(callback, thisArg) { this._entries.forEach(callback, thisArg); }
  [Symbol.iterator]() { return this._entries[Symbol.iterator](); }
  get [Symbol.toStringTag]() { return 'KeyboardLayoutMap'; }
};
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

