globalThis.GPUSupportedFeatures = class GPUSupportedFeatures {
  constructor() { throw new TypeError('Illegal constructor'); }
  get size() { return this._set.size; }
  has(value) { return this._set.has(String(value)); }
  keys() { return this._set.keys(); }
  values() { return this._set.values(); }
  entries() { return this._set.entries(); }
  forEach(callback, thisArg) { this._set.forEach(callback, thisArg); }
  [Symbol.iterator]() { return this._set[Symbol.iterator](); }
  get [Symbol.toStringTag]() { return 'GPUSupportedFeatures'; }
};
