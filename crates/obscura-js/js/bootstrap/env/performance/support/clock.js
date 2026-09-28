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
// cross-origin isolated context, and to 5 microseconds inside one -- the
// resolution a timing probe reads straight off two consecutive readings.
// Deriving the value from Date.now() instead yields whole milliseconds,
// which a page can measure directly.
const _PERF_CLAMP_MS = 0.1;
const _PERF_CLAMP_ISOLATED_MS = 0.005;
// A worker's clock carries the same quantum but with the float32 rounding a
// worker reading shows: the smallest step two consecutive worker readings can
// show sits one float32 epsilon away from 0.1 (0.09999999403953552, Chrome
// 153 oracle), not at the double artefact of `n * 0.1`. Rounding the
// *quantum* through f32 puts the step in that class and keeps it there at
// every magnitude, where rounding the reading itself would grow the error
// with the clock's age and eventually swallow the quantum. Realms are seeded
// from the startup snapshot, so the realm-level check has to be deferred to
// the first reading: WORKER_PREP_TEMPLATE defines the marker in the worker
// before any worker script runs, but after this module has already been
// evaluated.
const _PERF_CLAMP_MS_F32 = Math.fround(_PERF_CLAMP_MS);
const _PERF_CLAMP_ISOLATED_MS_F32 = Math.fround(_PERF_CLAMP_ISOLATED_MS);
var _perfWorkerQuantum = null;
var _perfWorkerQuantumIsolated = null;
globalThis.__obscura_rebasePerformanceOrigin = function(timeOrigin) {
  var elapsed = Date.now() - timeOrigin;
  _perfOriginMono = _monoMs() - (elapsed > 0 ? elapsed : 0);
};

// Chrome brands performance.now with the receiver's internal slot: bound
// calls answer the clock, but a detached call (or any receiver without the
// slot, including an Object.create(Performance.prototype) stand-in) throws
// "Illegal invocation". The WeakSet survives snapshot restore like the other
// registry marks, so restored realms stay branded.
var _performanceBrand = new WeakSet();
var _performanceNowImpl = (function() {
  // Monotonically non-decreasing. Equal readings are allowed; avoiding a
  // synthetic per-call increment keeps tight loops from advancing the clock.
  var _last = 0;
  // The isolation state lives on a getter the surface finalize installs, so
  // it is read per call: this module runs before that finalize, and a page
  // can flip nothing here afterwards. The read is one memory-backed getter.
  function _quantum() {
    var isolated = false;
    try { isolated = globalThis.crossOriginIsolated === true; } catch (e) {}
    if (isolated) {
      if (_perfWorkerQuantumIsolated === null) {
        _perfWorkerQuantumIsolated =
          typeof globalThis.__obscuraIsWorker !== 'undefined'
            ? _PERF_CLAMP_ISOLATED_MS_F32 : _PERF_CLAMP_ISOLATED_MS;
      }
      return [_PERF_CLAMP_ISOLATED_MS, _perfWorkerQuantumIsolated];
    }
    if (_perfWorkerQuantum === null) {
      _perfWorkerQuantum = typeof globalThis.__obscuraIsWorker !== 'undefined'
        ? _PERF_CLAMP_MS_F32 : _PERF_CLAMP_MS;
    }
    return [_PERF_CLAMP_MS, _perfWorkerQuantum];
  }
  return function() {
    var mono = _monoMs();
    if (_perfOriginMono === null) _perfOriginMono = mono;
    var ms = mono - _perfOriginMono;
    if (!(ms > 0)) ms = 0;
    var clamp = _quantum();
    ms = Math.floor(ms / clamp[0]) * clamp[1];
    if (ms < _last) return _last;
    _last = ms;
    return _last;
  };
})();
globalThis.performance = globalThis.performance || {
  now: function now() {
    if (!_performanceBrand.has(this)) throw new TypeError('Illegal invocation');
    return _performanceNowImpl();
  },
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
_performanceBrand.add(globalThis.performance);
_markNative(globalThis.performance.now);
