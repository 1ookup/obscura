// Performance clock support. This module owns the realm-local monotonic
// origin and the minimal object installed before the Performance interface.
// It intentionally stays separate from the public object shape: workers can
// use this clock even when no document lifecycle is present.
var _perfOriginMono = null;
function _monoMs() {
  // Absent while the startup snapshot is being built, and in any embedder that
  // registers only deno_core's builtins.
  var op = Deno.core.ops.op_monotonic_ms;
  return typeof op === "function" ? op() : Date.now();
}

// Chrome floors a DOMHighResTimeStamp to 100 microseconds outside a
// cross-origin isolated context. Deriving the value from Date.now() instead
// yields whole milliseconds, which a page can measure directly.
const _PERF_CLAMP_MS = 0.1;
globalThis.__obscura_rebasePerformanceOrigin = function(timeOrigin) {
  var elapsed = Date.now() - timeOrigin;
  _perfOriginMono = _monoMs() - (elapsed > 0 ? elapsed : 0);
};

globalThis.performance = globalThis.performance || {
  now: (function() {
    // Monotonically non-decreasing. Equal readings are allowed; avoiding a
    // synthetic per-call increment keeps tight loops from advancing the clock.
    var _last = 0;
    return function() {
      var mono = _monoMs();
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
  // it stands: an origin of 0 made now() report Unix epoch milliseconds.
  timeOrigin: Date.now(),
  timing: { navigationStart: 0, domContentLoadedEventEnd: 0, loadEventEnd: 0 },
  navigation: { type: 0, redirectCount: 0 },
  memory: {
    jsHeapSizeLimit: 4395630592,
    totalJSHeapSize: 19321856,
    usedJSHeapSize: 16781520,
  },
};
