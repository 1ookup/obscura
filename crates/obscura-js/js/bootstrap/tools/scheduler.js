// Browser posted tasks need an event-loop boundary but no clock delay. Tokio's
// timer wheel imposes roughly a one-millisecond floor even for delay zero,
// which turns MessageChannel and scheduler chains into artificial latency.
// Keep one shared priority/FIFO queue in JavaScript and use a yield-only async
// op solely to wake one delivery. Scheduling the next wake after the callback
// gives V8 a microtask checkpoint between every pair of posted tasks.
const _browserPostedTaskQueues = Array.from({ length: 6 }, () => []);
let _browserPostedTaskWakePending = false;

function _browserPostedTaskScheduleWake() {
  if (_browserPostedTaskWakePending) return;
  if (!Deno.core.ops.op_async_runtime_available()) return;
  _browserPostedTaskWakePending = true;
  Deno.core.ops.op_posted_task().then(
    _browserPostedTaskRunOne,
    () => {
      _browserPostedTaskWakePending = false;
      if (_browserPostedTaskQueues.some(queue => queue.length)) {
        _scheduleAfter(0, _browserPostedTaskRunOne);
      }
    },
  );
}

function _browserPostedTaskEnqueue(callback, priority) {
  _browserPostedTaskQueues[priority].push(callback);
  _browserPostedTaskScheduleWake();
}

function _browserPostedTaskRunOne() {
  _browserPostedTaskWakePending = false;
  let callback = null;
  for (let priority = _browserPostedTaskQueues.length - 1; priority >= 0; priority--) {
    const queue = _browserPostedTaskQueues[priority];
    if (queue.length) {
      callback = queue.shift();
      break;
    }
  }
  if (!callback) return;

  Deno.core.ops.op_begin_render_task?.();
  try { callback(); }
  catch (error) { console.error("Posted task error:", error); }
  finally {
    if (_browserPostedTaskQueues.some(queue => queue.length)) {
      _browserPostedTaskScheduleWake();
    }
  }
}

// Prioritized Task Scheduling. A scheduler task is a real event-loop task,
// ordered strictly by effective priority and FIFO within one priority. Yield
// continuations rank immediately above ordinary tasks of the same priority.
// This keeps background prefetch work behind visible hydration while still
// giving every callback its own microtask checkpoint.
const _schedulerConstructionKey = {};
const _schedulerInstances = new WeakSet();
const _schedulerPriorityRank = {
  "background": 0,
  "user-visible": 1,
  "user-blocking": 2,
};
let _schedulerCurrentState = null;

function _schedulerRemoveAbort(task) {
  if (task.signal && task.abortHandler) {
    task.signal.removeEventListener("abort", task.abortHandler);
    task.abortHandler = null;
  }
}

function _schedulerEnqueue(task, continuation) {
  if (task.canceled) return;
  const effectivePriority = _schedulerPriorityRank[task.priority] * 2
    + (continuation ? 1 : 0);
  _browserPostedTaskEnqueue(() => _schedulerRunTask(task), effectivePriority);
}

function _schedulerRunTask(task) {
  if (task.canceled) return;

  task.started = true;
  const previousState = _schedulerCurrentState;
  _schedulerCurrentState = task.state;
  try {
    if (task.callback === null) {
      task.resolve(undefined);
    } else {
      const callback = task.callback;
      task.resolve(callback());
    }
  } catch (error) {
    task.reject(error);
  } finally {
    _schedulerCurrentState = previousState;
    task.completed = true;
    _schedulerRemoveAbort(task);
  }
}

function _schedulerNormalizeOptions(options) {
  const dictionary = options == null ? {} : Object(options);

  let delay = 0;
  const rawDelay = dictionary.delay;
  if (rawDelay !== undefined) {
    if (typeof rawDelay === "bigint") {
      throw new TypeError("Failed to read the 'delay' property from 'SchedulerPostTaskOptions': Value is not of type 'unsigned long long'.");
    }
    delay = Number(rawDelay);
    if (!Number.isFinite(delay) || delay < 0 || delay >= 18446744073709551616) {
      throw new TypeError("Failed to read the 'delay' property from 'SchedulerPostTaskOptions': Value is outside the 'unsigned long long' value range.");
    }
    delay = Math.trunc(delay);
  }

  let priority = "user-visible";
  const rawPriority = dictionary.priority;
  if (rawPriority !== undefined) {
    priority = String(rawPriority);
    if (!Object.prototype.hasOwnProperty.call(_schedulerPriorityRank, priority)) {
      throw new TypeError("The provided value '" + priority + "' is not a valid enum value of type TaskPriority.");
    }
  }

  const signal = dictionary.signal;
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) {
    throw new TypeError("Failed to read the 'signal' property from 'SchedulerPostTaskOptions': Failed to convert value to 'AbortSignal'.");
  }
  return { delay, priority, signal: signal === undefined ? null : signal };
}

function _schedulerCreateTask(callback, state, resolve, reject) {
  const task = {
    callback, state, resolve, reject,
    priority: state.priority,
    signal: state.signal,
    abortHandler: null,
    delayTimerId: null,
    canceled: false,
    started: false,
    completed: false,
  };
  if (task.signal) {
    task.abortHandler = () => {
      if (task.completed || task.canceled) return;
      task.canceled = true;
      if (task.delayTimerId !== null) clearTimeout(task.delayTimerId);
      _schedulerRemoveAbort(task);
      reject(task.signal.reason);
    };
    task.signal.addEventListener("abort", task.abortHandler);
  }
  return task;
}

globalThis.Scheduler = class Scheduler {
  constructor(key) {
    if (key !== _schedulerConstructionKey) {
      throw new TypeError("Failed to construct 'Scheduler': Illegal constructor");
    }
    _schedulerInstances.add(this);
  }

  postTask(callback, options = {}) {
    return new Promise((resolve, reject) => {
      if (!_schedulerInstances.has(this)) throw new TypeError("Illegal invocation");
      if (typeof callback !== "function") {
        throw new TypeError("Failed to execute 'postTask' on 'Scheduler': parameter 1 is not of type 'Function'.");
      }
      const normalized = _schedulerNormalizeOptions(options);
      if (normalized.signal && normalized.signal.aborted) {
        reject(normalized.signal.reason);
        return;
      }
      const state = { priority: normalized.priority, signal: normalized.signal };
      const task = _schedulerCreateTask(callback, state, resolve, reject);
      if (normalized.delay > 0) {
        task.delayTimerId = setTimeout(() => {
          task.delayTimerId = null;
          _schedulerEnqueue(task, false);
        }, normalized.delay);
      } else {
        _schedulerEnqueue(task, false);
      }
    });
  }

  yield() {
    return new Promise((resolve, reject) => {
      if (!_schedulerInstances.has(this)) throw new TypeError("Illegal invocation");
      const inherited = _schedulerCurrentState;
      const state = inherited
        ? { priority: inherited.priority, signal: inherited.signal }
        : { priority: "user-visible", signal: null };
      if (state.signal && state.signal.aborted) {
        reject(state.signal.reason);
        return;
      }
      _schedulerEnqueue(_schedulerCreateTask(null, state, resolve, reject), true);
    });
  }
};
Object.defineProperty(globalThis.Scheduler.prototype, Symbol.toStringTag, {
  value: "Scheduler",
  configurable: true,
});
_markNative(globalThis.Scheduler);
_markNative(globalThis.Scheduler.prototype.postTask);
_markNative(globalThis.Scheduler.prototype.yield);

const _defaultScheduler = new globalThis.Scheduler(_schedulerConstructionKey);
Object.defineProperty(globalThis, "scheduler", {
  get() { return _defaultScheduler; },
  set(value) {
    Object.defineProperty(globalThis, "scheduler", {
      value, writable: true, enumerable: true, configurable: true,
    });
  },
  enumerable: true,
  configurable: true,
});

