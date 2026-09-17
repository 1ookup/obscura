globalThis.GPUSupportedLimits = class GPUSupportedLimits {
  constructor() { throw new TypeError('Illegal constructor'); }
  get [Symbol.toStringTag]() { return 'GPUSupportedLimits'; }
};
// Reflect the limit names on the prototype so a probe that enumerates them
// sees the same list a browser does, whatever the instance carries.
for (const name of Object.keys(_GPU_LIMITS)) {
  Object.defineProperty(globalThis.GPUSupportedLimits.prototype, name, {
    get() { return undefined; }, enumerable: true, configurable: true,
  });
}
