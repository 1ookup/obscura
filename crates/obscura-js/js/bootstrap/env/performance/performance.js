// Performance object shape and event behavior. Timeline methods and backing
// state are installed by the dedicated behavior modules below. Event
// membership comes from the shared EventTarget dispatcher: Chrome's
// Performance.prototype carries no addEventListener/removeEventListener/
// dispatchEvent own keys (they answer from EventTarget.prototype), and the
// earlier local reimplementations sat on the prototype as an own-key trio no
// browser produces -- while missing the capture/options handling and the
// LoAF event-listener attribution the shared dispatcher already provides.
class Performance {
  // The reference raises the long form under `new` ("Failed to construct
  // 'Performance': Illegal constructor", measured live).
  constructor() { throw new TypeError("Failed to construct 'Performance': Illegal constructor"); }
}
Object.setPrototypeOf(Performance.prototype, EventTarget.prototype);
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
    if (!state) throw new TypeError('Illegal invocation @env/performance/performance.js:36');
    return Object.fromEntries(_performanceTimingNames.map(name => [name, state[name]]));
  }
}
for (const name of _performanceTimingNames) {
  Object.defineProperty(PerformanceTiming.prototype, name, {
    get() {
      const state = _performanceTimingState.get(this);
      if (!state) throw new TypeError('Illegal invocation @env/performance/performance.js:44');
      return state[name];
    },
    // The host lifecycle mutates these legacy values; author-facing reads
    // still observe the same numeric timeline through the getter.
    set(value) {
      const state = _performanceTimingState.get(this);
      if (!state) throw new TypeError('Illegal invocation @env/performance/performance.js:51');
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

// Chrome's Performance surface carries three members the behavior modules
// above never installed: the serializer, and the two read-only views the
// spec hangs off the singleton. EventCounts is a live map of the distinct
// event types dispatched on the document's tree; the type ledger itself is
// kept by the dispatch choke point in env/events/event-target.js
// (__obscura_document_event_types), so size and get answer what the page
// actually dispatched rather than a frozen zero.
const _performanceEventCounts = (() => {
  const counts = Object.create(null);
  Object.defineProperty(counts, Symbol.toStringTag, {
    value: 'EventCounts', writable: false, enumerable: false, configurable: true,
  });
  Object.defineProperty(counts, 'size', {
    get: _markNative(function size() {
      const ledger = globalThis.__obscura_document_event_types;
      return ledger ? ledger.size : 0;
    }),
    enumerable: true, configurable: true,
  });
  Object.defineProperty(counts, 'get', {
    value: _markNative(function get(type) {
      const ledger = globalThis.__obscura_document_event_types;
      if (!ledger) return 0;
      const n = ledger.get(String(type));
      return n === undefined ? 0 : n;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(counts, 'has', {
    value: _markNative(function has(type) {
      const ledger = globalThis.__obscura_document_event_types;
      return !!ledger && ledger.has(String(type));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return counts;
})();
Object.defineProperty(Performance.prototype, 'eventCounts', {
  get() { return _performanceEventCounts; },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(Performance.prototype, 'interactionCount', {
  get() { return 0; },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(Performance.prototype, 'toJSON', {
  value: function toJSON() {
    return {
      timeOrigin: this.timeOrigin,
    };
  },
  writable: true,
  enumerable: true,
  configurable: true,
});
