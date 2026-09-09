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

// Keep the singleton's backing values private while exposing the same
// prototype-owned shape as the browser. page-init updates these values during
// navigation, so the accessors intentionally retain setters for the host
// initialization path even though page code only sees read-only-like getters.
const _performanceSurfaceValues = {
  timeOrigin: globalThis.performance.timeOrigin,
  timing: globalThis.performance.timing,
  navigation: globalThis.performance.navigation,
};
for (const name of ['timeOrigin', 'timing', 'navigation']) {
  delete globalThis.performance[name];
  Object.defineProperty(Performance.prototype, name, {
    get() { return _performanceSurfaceValues[name]; },
    set(value) { _performanceSurfaceValues[name] = value; },
    enumerable: true,
    configurable: true,
  });
}

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
