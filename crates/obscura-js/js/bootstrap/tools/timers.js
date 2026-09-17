// Timers accept a string first arg per the HTML spec (e.g. the Aliyun WAF
// `acw_sc__v2` challenge drives `setTimeout('reload(arg2)', 2)`). A string is
// compiled and run in global scope, identical to a real browser; otherwise the
// call silently no-ops and JS-triggered navigations (cookie → reload) never fire.
const _coerceTimerFn = (fn) => {
  if (typeof fn === "string") {
    // Per HTML, a string handler is compiled and run as a classic script in
    // global scope *at fire time*, so top-level var/function declarations
    // become globals (a `new Function(fn)` wrapper kept them local);
    // deferring to fire time also
    // surfaces a SyntaxError when the timer elapses, matching a real browser,
    // instead of swallowing it eagerly at scheduling. The dynamic-script path
    // uses the same global-scope evaluation for the same reason.
    // Trace attribution: a string timer runs under its *scheduling* label
    // (the createBrowserTimer snapshot rule), not as a script@ unit, so the
    // classic-script entry keeps the ambient label via keepFrom.
    const src = fn;
    return () => { __runClassicScript(src, globalThis.location?.href, true); };
  }
  return typeof fn === "function" ? fn : null;
};

// HTML's timer nesting level. A timer scheduled from inside a timer callback
// nests one deeper, and past five levels the spec floors the delay at 4ms --
// which is why a chain of `setTimeout(f, 0)` advances at ~4ms per step in a
// browser rather than as fast as the event loop can turn.
//
// Worth having beyond conformance: the floor is measurable from script, so a
// page that times a nesting chain reads an engine without it as not-a-browser.
// Running faster than the platform is itself a tell.
let _timerNesting = 0;
const _TIMER_NESTING_FLOOR_LEVEL = 5;
const _TIMER_NESTING_FLOOR_MS = 4;

function _clampNestedDelay(delay) {
  return (_timerNesting > _TIMER_NESTING_FLOOR_LEVEL && delay < _TIMER_NESTING_FLOOR_MS)
    ? _TIMER_NESTING_FLOOR_MS
    : delay;
}

// Runs `f` at the nesting level its own timer scheduled, so timers it starts
// nest deeper while unrelated work on the task queue keeps counting from zero.
function _runAtNesting(level, f, args) {
  const previous = _timerNesting;
  _timerNesting = level;
  // Long task timings feed the LoAF timeline (see
  // env/performance/long-animation-frame.js); without the wrapper the
  // duration of a blocking callback is invisible to PerformanceObserver.
  const run = () => {
    try { f(...args); }
    catch (e) {
      // A timer callback that throws is an uncaught exception: report it to the
      // window (error event + onerror) before logging, or page-side collectors
      // never observe the failure.
      const handled = typeof globalThis.__obscura_report_uncaught === 'function'
        && globalThis.__obscura_report_uncaught(e);
      if (!handled) console.error("Timer error:", e);
    }
    finally { _timerNesting = previous; }
  };
  if (typeof globalThis.__obscura_measure_task === 'function') {
    return globalThis.__obscura_measure_task('TimerHandler', run);
  }
  return run();
}

_defineWindowValue('setTimeout', (fn, delay = 0, ...args) => {
  const f = _coerceTimerFn(fn);
  if (f === null) return ++_tid;
  const id = ++_tid;
  const nesting = _timerNesting + 1;
  const normalizedDelay = _clampNestedDelay(Math.max(0, Number(delay) || 0));
  const nativeId = _scheduleAfter(normalizedDelay, () => {
    _nativeTimerIds.delete(id);
    __obscuraPendingTimeoutDeadlines.delete(id);
    if (_clearedTimers.has(id)) return;
    _runAtNesting(nesting, f, args);
  });
  if (nativeId !== undefined) {
    _nativeTimerIds.set(id, nativeId);
    __obscuraPendingTimeoutDeadlines.set(id, performance.now() + normalizedDelay);
  }
  return id;
});

_defineWindowValue('clearTimeout', (id) => {
  _clearedTimers.add(id);
  __obscuraPendingTimeoutDeadlines.delete(id);
  const nativeId = _nativeTimerIds.get(id);
  if (nativeId !== undefined) {
    Deno.core.ops.op_browser_timer_complete(nativeId);
    Deno.core.cancelTimer(nativeId);
    _nativeTimerIds.delete(id);
  }
});

_defineWindowValue('setInterval', (fn, delay = 0, ...args) => {
  const f = _coerceTimerFn(fn);
  if (f === null) return ++_tid;
  const id = ++_tid;
  _intervals.add(id);
  // An interval nests one level below whatever scheduled it, and every tick
  // repeats at that level -- so a sub-4ms interval started inside a timer is
  // floored the same way a nested timeout is.
  const nesting = _timerNesting + 1;
  const normalizedDelay = (nesting > _TIMER_NESTING_FLOOR_LEVEL
      && Math.max(0, Number(delay) || 0) < _TIMER_NESTING_FLOOR_MS)
    ? _TIMER_NESTING_FLOOR_MS
    : Math.max(0, Number(delay) || 0);
  const tick = () => {
    if (!_intervals.has(id)) return;
    _runAtNesting(nesting, f, args);
    if (!_intervals.has(id)) return;
    const nativeId = _scheduleAfter(normalizedDelay, tick);
    if (nativeId !== undefined) _nativeTimerIds.set(id, nativeId);
  };
  const nativeId = _scheduleAfter(normalizedDelay, tick);
  if (nativeId !== undefined) _nativeTimerIds.set(id, nativeId);
  return id;
});

_defineWindowValue('clearInterval', (id) => {
  _intervals.delete(id);
  globalThis.clearTimeout(id);
});

// Animation callbacks are a rendering-phase batch, not zero-delay
// microtasks.  In particular, a callback which queues itself must yield to
// timers, networking, and the embedder between frames.  The old setTimeout(0)
// alias eventually used Promise.resolve(), so a normal animation loop formed
// an unbounded microtask chain and pinned V8 until the watchdog terminated it.
const _RAF_FRAME_DELAY_MS = 16;
let _rafPending = new Map();
let _rafCurrentBatch = null;
let _rafFrameScheduled = false;
let _rafRunningFrame = false;
let _renderOpportunityScheduled = false;
let _renderOpportunityRunning = false;

function _renderOpportunityHasWork() {
  return _rafFrameScheduled || _resizeRenderCheckpointPending
    || _intersectionRenderCheckpointPending;
}

// Gecko and the HTML rendering algorithm use one refresh opportunity for
// every rendering phase. Keeping rAF, ResizeObserver, and
// IntersectionObserver on independent 16ms timers triples host wakeups and
// lets registration order change which geometry a callback sees. Run the
// phases once, in browser order, from one task instead:
//
//   animation frame callbacks -> layout/ResizeObserver -> intersections
//
// A phase which queues more work while this task is running belongs to the
// next opportunity unless a later phase in this opportunity can consume it.
function _scheduleRenderingOpportunity() {
  if (_renderOpportunityScheduled || _renderOpportunityRunning
      || !_renderOpportunityHasWork()) return;
  _renderOpportunityScheduled = true;
  _scheduleAfter(_RAF_FRAME_DELAY_MS, _runRenderingOpportunity);
}

function _runRenderingOpportunity() {
  _renderOpportunityScheduled = false;
  _renderOpportunityRunning = true;
  try {
    if (_rafFrameScheduled) _runAnimationFrameBatch();
    if (_resizeRenderCheckpointPending) _runResizeRenderCheckpoint();
    if (_intersectionRenderCheckpointPending) _runIntersectionRenderCheckpoint();
  } finally {
    _renderOpportunityRunning = false;
    _scheduleRenderingOpportunity();
  }
}

function _scheduleAnimationFrame() {
  if (_rafFrameScheduled || _rafRunningFrame || _rafPending.size === 0) return;
  _rafFrameScheduled = true;
  _scheduleRenderingOpportunity();
}

function _runAnimationFrameBatch() {
  _rafFrameScheduled = false;
  if (_rafPending.size === 0) return;

  // Swap before invoking anything. A callback requested while this batch is
  // running therefore belongs to the next frame. Every callback in this
  // batch receives the same rendering timestamp.
  const batch = _rafPending;
  _rafPending = new Map();
  _rafCurrentBatch = batch;
  _rafRunningFrame = true;
  const timestamp = performance.now();
  const runFrame = () => {
    try {
      for (const [id, callback] of batch) {
        // cancelAnimationFrame() may remove a later callback while an earlier
        // callback in the same frame is running.
        if (!batch.has(id)) continue;
        batch.delete(id);
        try { callback(timestamp); }
        catch (e) {
          const handled = typeof globalThis.__obscura_report_uncaught === 'function'
            && globalThis.__obscura_report_uncaught(e);
          if (!handled) console.error("Animation frame error:", e);
        }
      }
    } finally {
      _rafRunningFrame = false;
      _rafCurrentBatch = null;
      _scheduleAnimationFrame();
    }
  };
  if (typeof globalThis.__obscura_measure_task === 'function') {
    globalThis.__obscura_measure_task('FrameRequestCallback', runFrame);
  } else {
    runFrame();
  }
}

_defineWindowValue('requestAnimationFrame', (fn) => {
  if (typeof fn !== "function") {
    throw new TypeError(
      "Failed to execute 'requestAnimationFrame' on 'Window': parameter 1 is not of type 'Function'."
    );
  }
  const id = ++_tid;
  // Each animation callback keeps its own registration label; the rendering
  // opportunity that runs the batch is whoever scheduled a frame, which is
  // not necessarily who registered this callback.
  _rafPending.set(id, __obscuraTraceBind(fn));
  _scheduleAnimationFrame();
  return id;
});

_defineWindowValue('cancelAnimationFrame', (id) => {
  _rafPending.delete(id);
  if (_rafCurrentBatch) _rafCurrentBatch.delete(id);
});
if (!globalThis.queueMicrotask) {
  // The microtask inherits its queuing site's execution-source label.
  _defineWindowValue('queueMicrotask', (fn) => Promise.resolve().then(__obscuraTraceBind(fn)));
}
