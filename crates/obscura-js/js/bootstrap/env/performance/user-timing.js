// User Timing methods and public Performance Timeline registrations.
Object.assign(globalThis.performance, {
  mark(name, options = {}) {
    return _queuePerformanceEntry(new PerformanceMark(name, options));
  },
  measure(name, startOrOptions, endMark) {
    let start = 0, end = performance.now(), detail = null;
    if (startOrOptions && typeof startOrOptions === 'object') {
      detail = startOrOptions.detail ?? null;
      start = startOrOptions.start === undefined
        ? 0
        : (typeof startOrOptions.start === 'number' ? startOrOptions.start : _markTime(startOrOptions.start));
      end = startOrOptions.end === undefined
        ? (startOrOptions.duration === undefined ? performance.now() : start + Number(startOrOptions.duration))
        : (typeof startOrOptions.end === 'number' ? startOrOptions.end : _markTime(startOrOptions.end));
      if (startOrOptions.duration !== undefined && startOrOptions.start === undefined) {
        start = end - Number(startOrOptions.duration);
      }
    } else {
      if (startOrOptions !== undefined) start = _markTime(startOrOptions);
      if (endMark !== undefined) end = _markTime(endMark);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new TypeError('Invalid performance measure range');
    }
    return _queuePerformanceEntry(new PerformanceMeasure(name, start, end - start, detail));
  },
  clearMarks(name) {
    for (let i = _performanceEntries.length - 1; i >= 0; i--) {
      if (_performanceEntries[i].entryType === 'mark'
          && (name === undefined || _performanceEntries[i].name === String(name))) {
        _performanceEntries.splice(i, 1);
      }
    }
  },
  clearMeasures(name) {
    for (let i = _performanceEntries.length - 1; i >= 0; i--) {
      if (_performanceEntries[i].entryType === 'measure'
          && (name === undefined || _performanceEntries[i].name === String(name))) {
        _performanceEntries.splice(i, 1);
      }
    }
  },
  clearResourceTimings() {
    for (let i = _performanceEntries.length - 1; i >= 0; i--) {
      if (_performanceEntries[i].entryType === 'resource') _performanceEntries.splice(i, 1);
    }
  },
  getEntries() { return _entries(); },
  getEntriesByName(name, type) {
    return _entries(type === undefined ? undefined : String(type), String(name));
  },
  getEntriesByType(type) { return _entries(String(type)); },
  setResourceTimingBufferSize(size) {
    size = Math.trunc(Number(size));
    if (size >= 0) _resourceTimingBufferSize = size;
  },
});

globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;
globalThis.PerformanceNavigationTiming = PerformanceNavigationTiming;
globalThis.PerformancePaintTiming = PerformancePaintTiming;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceObserver = PerformanceObserver;
