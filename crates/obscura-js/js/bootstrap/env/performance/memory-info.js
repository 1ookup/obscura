// MemoryInfo is a small WebIDL-shaped value object exposed through
// performance.memory and console.memory. Its backing values are deliberately
// realm-local and read-only, matching the previous implementation.
const _initialMemoryInfo = globalThis.performance.memory || {};
const _memoryInfoBacking = {
  jsHeapSizeLimit: Number(_initialMemoryInfo.jsHeapSizeLimit) || 4395630592,
  totalJSHeapSize: Number(_initialMemoryInfo.totalJSHeapSize) || 19321856,
  usedJSHeapSize: Number(_initialMemoryInfo.usedJSHeapSize) || 16781520,
};
const _memoryInfoInstances = new WeakSet();
const _memoryInfoPrototype = {};
function _memoryInfoValue(receiver, name) {
  if (!_memoryInfoInstances.has(receiver)) throw new TypeError('Illegal invocation');
  return _memoryInfoBacking[name];
}
const _memoryInfoGetterHolders = {
  totalJSHeapSize: { get totalJSHeapSize() { return _memoryInfoValue(this, 'totalJSHeapSize'); } },
  usedJSHeapSize: { get usedJSHeapSize() { return _memoryInfoValue(this, 'usedJSHeapSize'); } },
  jsHeapSizeLimit: { get jsHeapSizeLimit() { return _memoryInfoValue(this, 'jsHeapSizeLimit'); } },
};
for (const name of ['totalJSHeapSize', 'usedJSHeapSize', 'jsHeapSizeLimit']) {
  const getter = Object.getOwnPropertyDescriptor(_memoryInfoGetterHolders[name], name).get;
  _markNative(getter);
  Object.defineProperty(_memoryInfoPrototype, name, {
    get: getter, set: undefined, enumerable: true, configurable: true,
  });
}
Object.defineProperty(_memoryInfoPrototype, Symbol.toStringTag, {
  value: 'MemoryInfo', writable: false, enumerable: false, configurable: true,
});
function _newMemoryInfo() {
  const info = Object.create(_memoryInfoPrototype);
  _memoryInfoInstances.add(info);
  return info;
}

delete globalThis.performance.memory;
const _performanceMemoryGetter = Object.getOwnPropertyDescriptor({
  get memory() { return _newMemoryInfo(); },
}, 'memory').get;
_markNative(_performanceMemoryGetter);
Object.defineProperty(Performance.prototype, 'memory', {
  get: _performanceMemoryGetter, set: undefined, enumerable: true, configurable: true,
});

const _consoleMemoryGetter = function() { return _newMemoryInfo(); };
const _consoleMemorySetter = function(_value) {};
Object.defineProperty(_consoleMemoryGetter, 'name', { value: '', configurable: true });
Object.defineProperty(_consoleMemorySetter, 'name', { value: '', configurable: true });
_markNativeAs(_consoleMemoryGetter, 'function () { [native code] }');
_markNativeAs(_consoleMemorySetter, 'function () { [native code] }');
Object.defineProperty(globalThis.console, 'memory', {
  get: _consoleMemoryGetter, set: _consoleMemorySetter,
  enumerable: true, configurable: true,
});
