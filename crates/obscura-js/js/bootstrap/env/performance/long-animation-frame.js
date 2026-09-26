// Long Animation Frames (LoAF) and the initial visibility-state entry.
//
// Chrome records a PerformanceLongAnimationFrameTiming whenever a rendering
// frame is blocked for more than 50 ms, and buffers one initial
// VisibilityStateEntry ("visible") for buffered observers. The challenge's
// heavy VM programs block the main thread for hundreds of milliseconds in a
// real browser, so a session that shows none of either is distinguishable
// from one that does. Entries here carry real measured durations from the
// engine's own task runner.

const _LOAF_THRESHOLD_MS = 50;

class PerformanceScriptTiming {
  constructor(detail) {
    Object.assign(this, detail);
  }
  get [Symbol.toStringTag]() { return 'PerformanceScriptTiming'; }
  toJSON() {
    return {
      name: this.name, entryType: this.entryType, startTime: this.startTime,
      duration: this.duration, invoker: this.invoker,
      invokerType: this.invokerType, scriptId: this.scriptId,
    };
  }
}

class PerformanceLongAnimationFrameTiming {
  constructor(detail) {
    _hset(this, "_detail", detail);
  }
  get name() { return 'long-animation-frame'; }
  get entryType() { return 'long-animation-frame'; }
  get startTime() { return this._detail.startTime; }
  get duration() { return this._detail.duration; }
  get renderStart() { return this._detail.renderStart; }
  get styleAndLayoutStart() { return this._detail.styleAndLayoutStart; }
  get firstUIEventTimestamp() { return this._detail.firstUIEventTimestamp; }
  get blockingDuration() { return this._detail.blockingDuration; }
  get scripts() { return this._detail.scripts; }
  get [Symbol.toStringTag]() { return 'PerformanceLongAnimationFrameTiming'; }
  toJSON() {
    return {
      name: this.name, entryType: this.entryType, startTime: this.startTime,
      duration: this.duration, renderStart: this.renderStart,
      styleAndLayoutStart: this.styleAndLayoutStart,
      firstUIEventTimestamp: this.firstUIEventTimestamp,
      blockingDuration: this.blockingDuration, scripts: this.scripts,
    };
  }
}

class VisibilityStateEntry {
  constructor(detail) {
    _hset(this, "_detail", detail);
  }
  get name() { return this._detail.name; }
  get entryType() { return 'visibility-state'; }
  get startTime() { return this._detail.startTime; }
  get duration() { return this._detail.duration; }
  get [Symbol.toStringTag]() { return 'VisibilityStateEntry'; }
  toJSON() {
    return { name: this.name, entryType: this.entryType,
      startTime: this.startTime, duration: this.duration };
  }
}

globalThis.PerformanceLongAnimationFrameTiming = PerformanceLongAnimationFrameTiming;
globalThis.PerformanceScriptTiming = PerformanceScriptTiming;
globalThis.VisibilityStateEntry = VisibilityStateEntry;

// Chrome buffers the page's initial visible state for buffered observers.
// Called from page-init once the shared timeline state exists.
globalThis.__obscura_seed_visibility_entry = function () {
  if (_performanceEntries.some(entry => entry.entryType === 'visibility-state')) return;
  _queuePerformanceEntry(new VisibilityStateEntry({ name: 'visible', startTime: 0, duration: 0 }));
};

let _taskDepth = 0;
let _taskStartedAt = 0;

// Chrome coalesces every long script that ran inside one rendering frame into
// a single entry whose `scripts` array carries the per-script attribution. This
// engine has no rendering-phase boundary to coalesce against, so each long unit
// records one entry with its own attribution, and a unit whose window overlaps
// an already recorded one is dropped rather than double-counted.
function _overlapsRecordedLoaf(startTime, duration) {
  const endTime = startTime + duration;
  for (let i = _performanceEntries.length - 1; i >= 0; i--) {
    const entry = _performanceEntries[i];
    if (entry.entryType !== 'long-animation-frame') continue;
    if (entry.startTime < endTime && (entry.startTime + entry.duration) > startTime) return true;
  }
  return false;
}

function _recordLongAnimationFrame(startTime, duration, invoker, invokerType) {
  if (duration < _LOAF_THRESHOLD_MS) return;
  if (_overlapsRecordedLoaf(startTime, duration)) return;
  // Chrome stamps the render phases at the end of the blocked frame, after the
  // last long script and before the frame's deadline, and reports 0 when the
  // frame produced no rendering update. Keeping them at the frame's end holds
  // startTime <= renderStart <= styleAndLayoutStart <= startTime + duration.
  const renderStart = startTime + duration;
  globalThis.__obscura_performance_record({
    name: 'long-animation-frame',
    entryType: 'long-animation-frame',
    startTime,
    duration,
    renderStart,
    styleAndLayoutStart: renderStart,
    firstUIEventTimestamp: 0,
    blockingDuration: Math.max(0, duration - _LOAF_THRESHOLD_MS),
    scripts: [new PerformanceScriptTiming({
      name: invoker, entryType: 'script', startTime,
      duration, invoker, invokerType,
      scriptId: 0, sourceURL: '', sourceFunctionName: '',
      sourceCharPosition: 0, window: [], styleAndLayoutStart: renderStart,
      pauseDuration: 0,
    })],
  });
}

// Opens the enclosing task. False means an outer unit already owns the
// measurement, which is what a listener running inside a timer callback sees:
// Chrome reports that listener inside the same frame, not as a second one.
globalThis.__obscura_task_begin = function () {
  if (_taskDepth > 0) return false;
  _taskDepth = 1;
  _taskStartedAt = performance.now();
  return true;
};

// Closes it. `invoker` names the handler and `invokerType` the task source, as
// Chrome reports them on the entry's script. `invoker` may be a function, which
// keeps callers off the string-building path for every one of the tasks that
// never blocks long enough to be recorded.
globalThis.__obscura_task_end = function (invoker, invokerType) {
  if (_taskDepth !== 1) return;
  _taskDepth = 0;
  const finishedAt = performance.now();
  const duration = finishedAt - _taskStartedAt;
  if (duration < _LOAF_THRESHOLD_MS) return;
  const name = typeof invoker === 'function' ? invoker() : invoker;
  _recordLongAnimationFrame(_taskStartedAt, duration, name, invokerType);
};

// Runs `task` and, when the whole synchronous run blocked past the LoAF
// threshold, records one entry with the measured timings. Chrome attributes
// the blocking to the animation frame; a top-level macrotask is the closest
// unit this engine's runner exposes.
globalThis.__obscura_measure_task = function (invoker, task, invokerType) {
  if (!__obscura_task_begin()) return task();
  try {
    return task();
  } finally {
    __obscura_task_end(invoker, invokerType || 'user-callback');
  }
};

// A page script the host executed directly (a parser-inserted `<script>`, which
// never enters this realm through a task source of its own). Chrome attributes
// its blocking to a `classic-script` entry named after the script's URL, and
// the host can only report the elapsed milliseconds, so the start is derived
// from the same timeline the page reads.
globalThis.__obscura_record_host_task = function (elapsedMs, invoker, invokerType) {
  const duration = Math.max(0, +elapsedMs || 0);
  if (duration < _LOAF_THRESHOLD_MS) return;
  _recordLongAnimationFrame(
    performance.now() - duration, duration, String(invoker || ''),
    String(invokerType || 'classic-script'));
};
