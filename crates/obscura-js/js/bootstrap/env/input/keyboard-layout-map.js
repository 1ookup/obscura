const _keyboardLayoutState = new WeakMap();

globalThis.KeyboardLayoutMap = class KeyboardLayoutMap {
  constructor() { throw new TypeError('Illegal constructor'); }
  get size() { const st = _keyboardLayoutState.get(this); return st ? st.size : 0; }
  get(key) { const st = _keyboardLayoutState.get(this); return st ? st.get(String(key)) : undefined; }
  has(key) { const st = _keyboardLayoutState.get(this); return st ? st.has(String(key)) : false; }
  keys() { const st = _keyboardLayoutState.get(this); return st ? st.keys() : [][Symbol.iterator](); }
  values() { const st = _keyboardLayoutState.get(this); return st ? st.values() : [][Symbol.iterator](); }
  entries() { const st = _keyboardLayoutState.get(this); return st ? st.entries() : [][Symbol.iterator](); }
  forEach(callback, thisArg) { const st = _keyboardLayoutState.get(this); if (st) st.forEach(callback, thisArg); }
  [Symbol.iterator]() { const st = _keyboardLayoutState.get(this); return st ? st[Symbol.iterator]() : [][Symbol.iterator](); }
  get [Symbol.toStringTag]() { return 'KeyboardLayoutMap'; }
};