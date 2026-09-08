// The realm's time origin on the monotonic clock. Rebased when a time origin
// is chosen for the document (see __obscura_rebasePerformanceOrigin), so
// `performance.now()` and `Date.now() - performance.timeOrigin` agree.
var _perfOriginMono = null;
function _monoMs() {
  // Absent while the startup snapshot is being built, and in any embedder that
  // registers only deno_core's builtins.
  var op = Deno.core.ops.op_monotonic_ms;
  return typeof op === "function" ? op() : Date.now();
}
// Chrome floors a DOMHighResTimeStamp to 100 microseconds outside a
// cross-origin isolated context. Deriving the value from `Date.now()` instead
// yields whole milliseconds, which a page can measure directly: time two
// consecutive `performance.now()` calls in a loop and the smallest positive
// difference is 1 where a browser reports 0.1.
const _PERF_CLAMP_MS = 0.1;
globalThis.__obscura_rebasePerformanceOrigin = function(timeOrigin) {
  var elapsed = Date.now() - timeOrigin;
  _perfOriginMono = _monoMs() - (elapsed > 0 ? elapsed : 0);
};
globalThis.performance = globalThis.performance || {
  now: (function() {
    // Monotonically non-decreasing. Equal readings are allowed; avoiding a
    // synthetic per-call increment keeps tight loops from advancing the clock
    // faster than real elapsed time.
    var _last = 0;
    return function() {
      var mono = _monoMs();
      // First reading in this realm establishes its origin.
      if (_perfOriginMono === null) _perfOriginMono = mono;
      var ms = mono - _perfOriginMono;
      if (!(ms > 0)) ms = 0;
      ms = Math.floor(ms / _PERF_CLAMP_MS) * _PERF_CLAMP_MS;
      if (ms < _last) return _last;
      _last = ms;
      return _last;
    };
  })(),
  // A worker never runs __obscura_init, so this default has to be usable as
  // it stands: an origin of 0 made `now()` report Unix epoch milliseconds.
  timeOrigin: Date.now(),
  timing: { navigationStart: 0, domContentLoadedEventEnd: 0, loadEventEnd: 0 },
  navigation: { type: 0, redirectCount: 0 },
  memory: {
    jsHeapSizeLimit: 4395630592,
    totalJSHeapSize: 19321856,
    usedJSHeapSize: 16781520,
  },
};
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

// W3C Performance Timeline / User Timing / Resource Timing. Entries are fed
// by real transport and lifecycle milestones through the two internal hooks;
// the JS-facing buffer and observer delivery follow the platform algorithms.
const _performanceEntries = [];
const _performanceObservers = new Set();
const _supportedPerformanceEntryTypes = Object.freeze([
  'element', 'event', 'first-input', 'largest-contentful-paint',
  'layout-shift', 'long-animation-frame', 'longtask', 'mark', 'measure',
  'navigation', 'paint', 'resource', 'visibility-state'
]);
let _resourceTimingBufferSize = 250;

class PerformanceEntry {
  constructor(init = {}) {
    this.name = String(init.name || '');
    this.entryType = String(init.entryType || '');
    this.startTime = Number.isFinite(+init.startTime) ? Math.max(0, +init.startTime) : 0;
    this.duration = Number.isFinite(+init.duration) ? Math.max(0, +init.duration) : 0;
  }
  toJSON() {
    const out = {};
    for (const key of Object.keys(this)) out[key] = this[key];
    return out;
  }
}
class PerformanceMark extends PerformanceEntry {
  constructor(name, options = {}) {
    super({ name, entryType: 'mark', startTime: options.startTime ?? performance.now(), duration: 0 });
    this.detail = options.detail ?? null;
  }
}
class PerformanceMeasure extends PerformanceEntry {
  constructor(name, startTime, duration, detail = null) {
    super({ name, entryType: 'measure', startTime, duration });
    this.detail = detail;
  }
}
class PerformanceResourceTiming extends PerformanceEntry {
  constructor(init = {}) {
    super({ ...init, entryType: init.entryType || 'resource' });
    const start = this.startTime;
    const responseEnd = Number.isFinite(+init.responseEnd) ? +init.responseEnd : start + this.duration;
    this.initiatorType = String(init.initiatorType || 'other');
    this.deliveryType = String(init.deliveryType || '');
    this.nextHopProtocol = String(init.nextHopProtocol || '');
    this.renderBlockingStatus = String(init.renderBlockingStatus || 'non-blocking');
    this.workerStart = +init.workerStart || 0;
    this.redirectStart = +init.redirectStart || 0;
    this.redirectEnd = +init.redirectEnd || 0;
    this.fetchStart = Number.isFinite(+init.fetchStart) ? +init.fetchStart : start;
    this.domainLookupStart = Number.isFinite(+init.domainLookupStart) ? +init.domainLookupStart : this.fetchStart;
    this.domainLookupEnd = Number.isFinite(+init.domainLookupEnd) ? +init.domainLookupEnd : this.domainLookupStart;
    this.connectStart = Number.isFinite(+init.connectStart) ? +init.connectStart : this.domainLookupEnd;
    this.secureConnectionStart = +init.secureConnectionStart || 0;
    this.connectEnd = Number.isFinite(+init.connectEnd) ? +init.connectEnd : this.connectStart;
    this.requestStart = Number.isFinite(+init.requestStart) ? +init.requestStart : this.connectEnd;
    this.responseStart = Number.isFinite(+init.responseStart) ? +init.responseStart : this.requestStart;
    this.firstInterimResponseStart = +init.firstInterimResponseStart || 0;
    this.responseEnd = responseEnd;
    this.transferSize = Math.max(0, +init.transferSize || 0);
    this.encodedBodySize = Math.max(0, +init.encodedBodySize || 0);
    this.decodedBodySize = Math.max(0, +init.decodedBodySize || 0);
    this.responseStatus = Math.max(0, +init.responseStatus || 0);
    this.serverTiming = Object.freeze(Array.isArray(init.serverTiming) ? init.serverTiming.slice() : []);
  }
}
class PerformanceNavigationTiming extends PerformanceResourceTiming {
  constructor(init = {}) {
    super({ ...init, entryType: 'navigation', initiatorType: 'navigation' });
    this.entryType = 'navigation';
    this.type = String(init.type || 'navigate');
    this.redirectCount = Math.max(0, +init.redirectCount || 0);
    this.unloadEventStart = +init.unloadEventStart || 0;
    this.unloadEventEnd = +init.unloadEventEnd || 0;
    this.domInteractive = +init.domInteractive || 0;
    this.domContentLoadedEventStart = +init.domContentLoadedEventStart || 0;
    this.domContentLoadedEventEnd = +init.domContentLoadedEventEnd || 0;
    this.domComplete = +init.domComplete || 0;
    this.loadEventStart = +init.loadEventStart || 0;
    this.loadEventEnd = +init.loadEventEnd || 0;
    this.activationStart = 0;
    this.criticalCHRestart = 0;
  }
}
class PerformancePaintTiming extends PerformanceEntry {
  constructor(name, startTime) { super({ name, entryType: 'paint', startTime, duration: 0 }); }
}
class PerformanceObserverEntryList {
  constructor(entries) { this._entries = entries; }
  getEntries() { return this._entries.slice().sort((a, b) => a.startTime - b.startTime); }
  getEntriesByType(type) { return this.getEntries().filter(entry => entry.entryType === String(type)); }
  getEntriesByName(name, type) {
    return this.getEntries().filter(entry => entry.name === String(name) && (type === undefined || entry.entryType === String(type)));
  }
}
class PerformanceObserver {
  constructor(callback) {
    if (typeof callback !== 'function') throw new TypeError("Failed to construct 'PerformanceObserver': parameter 1 is not of type 'Function'.");
    this._callback = callback; this._types = new Set(); this._records = []; this._queued = false;
  }
  static get supportedEntryTypes() { return _supportedPerformanceEntryTypes.slice(); }
  observe(options = {}) {
    const hasTypes = Array.isArray(options.entryTypes);
    const hasType = options.type !== undefined;
    if (hasTypes === hasType) throw new TypeError("Failed to execute 'observe': specify either entryTypes or type.");
    const types = hasTypes ? options.entryTypes.map(String) : [String(options.type)];
    this._types = new Set(types.filter(type => _supportedPerformanceEntryTypes.includes(type)));
    _performanceObservers.add(this);
    if (!hasTypes && options.buffered) {
      for (const entry of _performanceEntries) if (this._types.has(entry.entryType)) this._records.push(entry);
      this._schedule();
    }
  }
  disconnect() { _performanceObservers.delete(this); this._records.length = 0; this._types.clear(); }
  takeRecords() { const records = this._records.slice(); this._records.length = 0; return records; }
  _schedule() {
    if (this._queued || !this._records.length) return;
    this._queued = true;
    queueMicrotask(() => {
      this._queued = false;
      const records = this.takeRecords();
      if (records.length && _performanceObservers.has(this)) this._callback(new PerformanceObserverEntryList(records), this);
    });
  }
}

function _queuePerformanceEntry(entry) {
  if (entry.entryType === 'resource'
      && _performanceEntries.filter(value => value.entryType === 'resource').length >= _resourceTimingBufferSize) {
    try { performance.dispatchEvent(new Event('resourcetimingbufferfull')); } catch (_error) {}
    return entry;
  }
  _performanceEntries.push(entry);
  for (const observer of _performanceObservers) {
    if (observer._types.has(entry.entryType)) { observer._records.push(entry); observer._schedule(); }
  }
  return entry;
}
function _entries(type, name) {
  return _performanceEntries
    .filter(entry => (type === undefined || entry.entryType === type) && (name === undefined || entry.name === name))
    .slice().sort((a, b) => a.startTime - b.startTime);
}
function _markTime(name) {
  const marks = _entries('mark', String(name));
  if (!marks.length) throw new DOMException("The mark '" + name + "' does not exist.", 'SyntaxError');
  return marks[marks.length - 1].startTime;
}

Object.assign(globalThis.performance, {
  mark(name, options = {}) { return _queuePerformanceEntry(new PerformanceMark(name, options)); },
  measure(name, startOrOptions, endMark) {
    let start = 0, end = performance.now(), detail = null;
    if (startOrOptions && typeof startOrOptions === 'object') {
      detail = startOrOptions.detail ?? null;
      start = startOrOptions.start === undefined ? 0 : (typeof startOrOptions.start === 'number' ? startOrOptions.start : _markTime(startOrOptions.start));
      end = startOrOptions.end === undefined ? (startOrOptions.duration === undefined ? performance.now() : start + Number(startOrOptions.duration))
        : (typeof startOrOptions.end === 'number' ? startOrOptions.end : _markTime(startOrOptions.end));
      if (startOrOptions.duration !== undefined && startOrOptions.start === undefined) start = end - Number(startOrOptions.duration);
    } else {
      if (startOrOptions !== undefined) start = _markTime(startOrOptions);
      if (endMark !== undefined) end = _markTime(endMark);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new TypeError('Invalid performance measure range');
    return _queuePerformanceEntry(new PerformanceMeasure(name, start, end - start, detail));
  },
  clearMarks(name) { for (let i = _performanceEntries.length - 1; i >= 0; i--) if (_performanceEntries[i].entryType === 'mark' && (name === undefined || _performanceEntries[i].name === String(name))) _performanceEntries.splice(i, 1); },
  clearMeasures(name) { for (let i = _performanceEntries.length - 1; i >= 0; i--) if (_performanceEntries[i].entryType === 'measure' && (name === undefined || _performanceEntries[i].name === String(name))) _performanceEntries.splice(i, 1); },
  clearResourceTimings() { for (let i = _performanceEntries.length - 1; i >= 0; i--) if (_performanceEntries[i].entryType === 'resource') _performanceEntries.splice(i, 1); },
  getEntries() { return _entries(); },
  getEntriesByName(name, type) { return _entries(type === undefined ? undefined : String(type), String(name)); },
  getEntriesByType(type) { return _entries(String(type)); },
  setResourceTimingBufferSize(size) { size = Math.trunc(Number(size)); if (size >= 0) _resourceTimingBufferSize = size; },
});
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;
globalThis.PerformanceNavigationTiming = PerformanceNavigationTiming;
globalThis.PerformancePaintTiming = PerformancePaintTiming;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceObserver = PerformanceObserver;

globalThis.__obscura_performance_record = function(init) {
  if (!init || typeof init !== 'object') return null;
  let entry;
  if (init.entryType === 'navigation') {
    entry = new PerformanceNavigationTiming(init);
    const previous = _performanceEntries.findIndex(value => value.entryType === 'navigation');
    if (previous >= 0) _performanceEntries.splice(previous, 1);
  } else if (init.entryType === 'paint') entry = new PerformancePaintTiming(init.name, init.startTime);
  else entry = new PerformanceResourceTiming(init);
  return _queuePerformanceEntry(entry);
};
globalThis.__obscura_performance_lifecycle = function(phase, timestamp) {
  const nav = _performanceEntries.find(value => value.entryType === 'navigation');
  if (!nav) return;
  const t = Number.isFinite(+timestamp) ? +timestamp : performance.now();
  if (phase === 'dom-content-loaded') {
    nav.domInteractive = t; nav.domContentLoadedEventStart = t; nav.domContentLoadedEventEnd = t;
    performance.timing.domContentLoadedEventEnd = performance.timeOrigin + t;
  } else if (phase === 'load') {
    nav.domComplete = t; nav.loadEventStart = t; nav.loadEventEnd = t; nav.duration = t;
    performance.timing.loadEventEnd = performance.timeOrigin + t;
    if (!_performanceEntries.some(value => value.entryType === 'paint')) {
      _queuePerformanceEntry(new PerformancePaintTiming('first-paint', t));
      _queuePerformanceEntry(new PerformancePaintTiming('first-contentful-paint', t));
    }
  }
};


// `document.all`. The object itself is built by the V8 API (src/document_all.rs)
// because its `[[IsHTMLDDA]]` behaviour -- `typeof document.all` answering
// "undefined" while the collection still resolves and is still callable -- has
// no JavaScript expression. Everything it contains is decided here.
//
// The contract with the native interceptors: return `[value]` to answer a
// lookup, `undefined` to decline it. A bare `undefined` return cannot mean
// "the answer is undefined", because declining is how the prototype's own
// members stay reachable.
