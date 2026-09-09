// Performance object shape and event behavior. Timeline methods and backing
// state are installed by the dedicated behavior modules below.
const _performanceEventListeners = new Map();
class Performance {
  constructor() { throw new TypeError('Illegal constructor'); }
  addEventListener(type, callback) {
    if (typeof callback !== 'function' && typeof callback?.handleEvent !== 'function') return;
    type = String(type);
    const listeners = _performanceEventListeners.get(type) || [];
    if (!listeners.includes(callback)) listeners.push(callback);
    _performanceEventListeners.set(type, listeners);
  }
  removeEventListener(type, callback) {
    const listeners = _performanceEventListeners.get(String(type));
    if (!listeners) return;
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  }
  dispatchEvent(event) {
    if (!event || !event.type) throw new TypeError('Invalid event');
    for (const callback of [...(_performanceEventListeners.get(String(event.type)) || [])]) {
      try {
        if (typeof callback === 'function') callback.call(this, event);
        else callback.handleEvent.call(callback, event);
      } catch (error) { queueMicrotask(() => { throw error; }); }
    }
    const handler = this['on' + event.type];
    if (typeof handler === 'function') handler.call(this, event);
    return !event.defaultPrevented;
  }
}
Object.defineProperty(Performance.prototype, Symbol.toStringTag, { value: 'Performance' });
Object.setPrototypeOf(globalThis.performance, Performance.prototype);
globalThis.Performance = Performance;

// PerformanceTiming is a legacy interface, but Chrome still exposes its
// prototype getters through performance.timing. Keep the lifecycle values in
// a private slot-backed object rather than leaking a plain object with three
// engine-owned keys.
const _performanceTimingState = new WeakMap();
const _performanceTimingNames = [
  'navigationStart', 'unloadEventStart', 'unloadEventEnd', 'redirectStart',
  'redirectEnd', 'fetchStart', 'domainLookupStart', 'domainLookupEnd',
  'connectStart', 'connectEnd', 'secureConnectionStart', 'requestStart',
  'responseStart', 'responseEnd', 'domLoading', 'domInteractive',
  'domContentLoadedEventStart', 'domContentLoadedEventEnd', 'domComplete',
  'loadEventStart', 'loadEventEnd',
];
class PerformanceTiming {
  constructor() { throw new TypeError("Failed to construct 'PerformanceTiming': Illegal constructor"); }
  toJSON() {
    const state = _performanceTimingState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return Object.fromEntries(_performanceTimingNames.map(name => [name, state[name]]));
  }
}
for (const name of _performanceTimingNames) {
  Object.defineProperty(PerformanceTiming.prototype, name, {
    get() {
      const state = _performanceTimingState.get(this);
      if (!state) throw new TypeError('Illegal invocation');
      return state[name];
    },
    // The host lifecycle mutates these legacy values; author-facing reads
    // still observe the same numeric timeline through the getter.
    set(value) {
      const state = _performanceTimingState.get(this);
      if (!state) throw new TypeError('Illegal invocation');
      state[name] = Number(value) || 0;
    },
    enumerable: true,
    configurable: true,
  });
}
Object.defineProperty(PerformanceTiming.prototype, Symbol.toStringTag, {
  value: 'PerformanceTiming', configurable: true,
});
const _performanceTimingOrder = [..._performanceTimingNames, 'toJSON', 'constructor'];
const _performanceTimingDescriptors = new Map();
for (const name of _performanceTimingOrder) {
  const descriptor = Object.getOwnPropertyDescriptor(PerformanceTiming.prototype, name);
  if (!descriptor) continue;
  _performanceTimingDescriptors.set(name, descriptor);
  delete PerformanceTiming.prototype[name];
}
for (const name of _performanceTimingOrder) {
  const descriptor = _performanceTimingDescriptors.get(name);
  if (descriptor) Object.defineProperty(PerformanceTiming.prototype, name, descriptor);
}
_markNative(PerformanceTiming);
_markNative(PerformanceTiming.prototype.toJSON);
for (const name of _performanceTimingNames) {
  const descriptor = Object.getOwnPropertyDescriptor(PerformanceTiming.prototype, name);
  _markNative(descriptor.get);
  _markNative(descriptor.set);
}
globalThis.PerformanceTiming = PerformanceTiming;
function _makePerformanceTiming(value) {
  const timing = Object.create(PerformanceTiming.prototype);
  const state = Object.create(null);
  for (const name of _performanceTimingNames) state[name] = Number(value?.[name]) || 0;
  _performanceTimingState.set(timing, state);
  return timing;
}

// Keep the singleton's backing values private while exposing the same
// prototype-owned shape as the browser. page-init updates these values during
// navigation, so the accessors intentionally retain setters for the host
// initialization path even though page code only sees read-only-like getters.
const _performanceSurfaceValues = {
  timeOrigin: globalThis.performance.timeOrigin,
  timing: _makePerformanceTiming(globalThis.performance.timing),
  navigation: globalThis.performance.navigation,
};
for (const name of ['timeOrigin', 'navigation']) {
  delete globalThis.performance[name];
  Object.defineProperty(Performance.prototype, name, {
    get() { return _performanceSurfaceValues[name]; },
    set(value) { _performanceSurfaceValues[name] = value; },
    enumerable: true,
    configurable: true,
  });
}
delete globalThis.performance.timing;
Object.defineProperty(Performance.prototype, 'timing', {
  get() { return _performanceSurfaceValues.timing; },
  set(value) { _performanceSurfaceValues.timing = _makePerformanceTiming(value); },
  enumerable: true,
  configurable: true,
});

const _performanceNow = globalThis.performance.now;
delete globalThis.performance.now;
Object.defineProperty(Performance.prototype, 'now', {
  value: _performanceNow,
  writable: true,
  enumerable: true,
  configurable: true,
});

let _performanceResourceTimingBufferFull = null;
Object.defineProperty(Performance.prototype, 'onresourcetimingbufferfull', {
  get() { return _performanceResourceTimingBufferFull; },
  set(value) {
    _performanceResourceTimingBufferFull = typeof value === 'function' ? value : null;
  },
  enumerable: true,
  configurable: true,
});
