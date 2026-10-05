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
// The plain realm's readings are not clean multiples of 0.1. They walk a
// 0.5 ms macro anchor and step each tick by one of two neighbouring doubles,
// so two consecutive readings differ by exactly one ring step and the
// observed member set (Chrome 154, both realms, page probe run) is these two
// values only. U is the double quantum at 0.1; D0 = 0.1 + 2*U and
// C8 = 0.1 - 3*U are the steps. 3*D0 + 2*C8 sums to 0.5 exactly, so the
// ring closes with no drift. The rotation is the page realm's measured
// order [C8, D0, D0, C8, D0], and OFF is its addition-chain prefix sum,
// built step by step because a synthesised n*0.1 + m*U formula reproduces
// the ties wrong (measured). The reference worker realm rotates the same
// ring one position over (its first step is D0, ours C8; every position
// from the second on is bit-identical), and the challenge times the clock
// from this realm, so both realms ship the page table: a probe that starts
// on a clean 0.5 anchor cannot tell the two apart past the first step.
const _PERF_RING_U = 0.1 * Math.pow(2, -23);
const _PERF_RING_D0 = 0.1 + 2 * _PERF_RING_U;
const _PERF_RING_C8 = 0.1 - 3 * _PERF_RING_U;
const _PERF_RING_OFF = [0, _PERF_RING_C8];
_PERF_RING_OFF.push(_PERF_RING_OFF[1] + _PERF_RING_D0);
_PERF_RING_OFF.push(_PERF_RING_OFF[2] + _PERF_RING_D0);
_PERF_RING_OFF.push(_PERF_RING_OFF[3] + _PERF_RING_C8);
// A cross-origin isolated realm steps at 5 microseconds, and its readings
// walk the same kind of lattice one scale down: a 0.125 ms macro anchor
// whose 25 slots mix 23 steps of 83886*2^-24 with 2 steps of 83887*2^-24,
// so the superblock closes on 0.125 exactly and the smallest step is the
// lower member L = 83886*2^-24 = 0.004999995231628418 bit for bit. The two
// wider steps sit a 12/13-step gap apart (Chrome 154, page and worker both,
// dense probe run); the absolute slot phase differs per realm and is not
// modelled, only the gap. Both realms ship this table: their measured walks
// are the same cycle at a 15-slot rotation.
const _PERF_ISO_L = 83886 * Math.pow(2, -24);
const _PERF_ISO_H = 83887 * Math.pow(2, -24);
const _PERF_ISO_OFF = [0];
for (var _perfIsoSlot = 0; _perfIsoSlot < 25; _perfIsoSlot++) {
  var _perfIsoStep =
    (_perfIsoSlot === 5 || _perfIsoSlot === 18) ? _PERF_ISO_H : _PERF_ISO_L;
  _PERF_ISO_OFF.push(_PERF_ISO_OFF[_perfIsoSlot] + _perfIsoStep);
}
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
  // Cross-origin isolated realms walk the 25-slot 5 microsecond lattice;
  // every other realm walks the 0.1 ms ring. Both realms of a context share
  // their table, so no worker marker is consulted.
  function _isIsolated() {
    try { return globalThis.crossOriginIsolated === true; } catch (e) { return false; }
  }
  return function() {
    var mono = _monoMs();
    if (_perfOriginMono === null) _perfOriginMono = mono;
    var ms = mono - _perfOriginMono;
    if (!(ms > 0)) ms = 0;
    if (!_isIsolated()) {
      var ticks = Math.floor(ms / _PERF_CLAMP_MS);
      ms = Math.floor(ticks / 5) * 0.5 + _PERF_RING_OFF[ticks % 5];
    } else {
      var iticks = Math.floor(ms / _PERF_CLAMP_ISOLATED_MS);
      ms = Math.floor(iticks / 25) * 0.125 + _PERF_ISO_OFF[iticks % 25];
    }
    if (ms < _last) return _last;
    _last = ms;
    return _last;
  };
})();
globalThis.performance = globalThis.performance || {
  // Method shorthand: owns no `prototype`, like the reference's native
  // performance.now (measured: hasOwnProperty('prototype') === false).
  now() {
    if (!_performanceBrand.has(this)) throw new TypeError('Illegal invocation @env/performance/support/clock.js:86');
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
