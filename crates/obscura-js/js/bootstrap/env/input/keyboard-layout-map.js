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
