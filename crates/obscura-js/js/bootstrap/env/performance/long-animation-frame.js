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
    this._detail = detail;
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
    this._detail = detail;
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
// Runs `task` and, when the whole synchronous run blocked past the LoAF
// threshold, records one entry with the measured timings. Chrome attributes
// the blocking to the animation frame; a top-level macrotask is the closest
// unit this engine's runner exposes.
globalThis.__obscura_measure_task = function (invoker, task) {
  if (_taskDepth > 0) return task();
  _taskDepth += 1;
  const startedAt = performance.now();
  let finishedAt = startedAt;
  try {
    return task();
  } finally {
    _taskDepth -= 1;
    finishedAt = performance.now();
    const duration = finishedAt - startedAt;
    if (duration >= _LOAF_THRESHOLD_MS) {
      _queuePerformanceEntry(new PerformanceLongAnimationFrameTiming({
        startTime: startedAt,
        duration,
        renderStart: finishedAt,
        styleAndLayoutStart: finishedAt,
        firstUIEventTimestamp: 0,
        blockingDuration: Math.max(0, duration - _LOAF_THRESHOLD_MS),
        scripts: [new PerformanceScriptTiming({
          name: invoker, entryType: 'script', startTime: startedAt,
          duration, invoker, invokerType: 'user-callback',
          scriptId: 0, sourceURL: '', sourceFunctionName: '',
          sourceCharPosition: 0, window: [], styleAndLayoutStart: finishedAt,
          pauseDuration: 0,
        })],
      }));
    }
  }
};
