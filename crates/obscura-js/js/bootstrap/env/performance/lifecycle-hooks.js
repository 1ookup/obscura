// Rust/browser lifecycle hooks. These are intentionally separate from public
// object definitions so transport and navigation code only depend on the
// narrow __obscura_* bridge.
globalThis.__obscura_performance_record = function(init) {
  if (!init || typeof init !== 'object') return null;
  let entry;
  if (init.entryType === 'navigation') {
    entry = new PerformanceNavigationTiming(init);
    const previous = _performanceEntries.findIndex(value => value.entryType === 'navigation');
    if (previous >= 0) _performanceEntries.splice(previous, 1);
  } else if (init.entryType === 'paint') {
    entry = new PerformancePaintTiming(init.name, init.startTime);
  } else {
    entry = new PerformanceResourceTiming(init);
  }
  return _queuePerformanceEntry(entry);
};

globalThis.__obscura_performance_lifecycle = function(phase, timestamp) {
  const nav = _performanceEntries.find(value => value.entryType === 'navigation');
  if (!nav) return;
  const t = Number.isFinite(+timestamp) ? +timestamp : performance.now();
  if (phase === 'dom-content-loaded') {
    nav.domInteractive = t;
    nav.domContentLoadedEventStart = t;
    nav.domContentLoadedEventEnd = t;
    performance.timing.domContentLoadedEventEnd = performance.timeOrigin + t;
  } else if (phase === 'load') {
    nav.domComplete = t;
    nav.loadEventStart = t;
    nav.loadEventEnd = t;
    nav.duration = t;
    performance.timing.loadEventEnd = performance.timeOrigin + t;
    if (!_performanceEntries.some(value => value.entryType === 'paint')) {
      _queuePerformanceEntry(new PerformancePaintTiming('first-paint', t));
      _queuePerformanceEntry(new PerformancePaintTiming('first-contentful-paint', t));
    }
  }
};
