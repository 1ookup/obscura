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
