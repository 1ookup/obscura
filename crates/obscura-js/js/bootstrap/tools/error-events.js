// An event handler that throws does not cancel dispatch -- the remaining
// handlers still run -- but the exception is *reported*, exactly as an uncaught
// one is. Swallowing it silently is both a spec deviation and the reason a
// page that dies inside its own XHR callback looks, from the outside, like a
// page that simply stopped making requests.
function __XHRDBG(xhr, where, e) {
  _consoleFn("error", ["XHR handler threw in", where, "for",
                       String(xhr && xhr._url || "?").slice(0, 120), e]);
}

let _tid = 0;
const _clearedTimers = new Set();
const _intervals = new Set();
const _nativeTimerIds = new Map();
const __obscuraPendingTimeoutDeadlines = new Map();
Object.defineProperty(globalThis, '__obscura_nextPendingTimeoutDelay', {
  value: function() {
    const now = performance.now();
    let nearest = Infinity;
    for (const deadline of __obscuraPendingTimeoutDeadlines.values()) {
      nearest = Math.min(nearest, Math.max(0, deadline - now));
    }
    return Number.isFinite(nearest) ? nearest : -1;
  },
  writable: false,
  enumerable: false,
  configurable: false,
});

const _scheduleAfter = (delay, fn) => {
  const d = Math.max(0, Number(delay) || 0);
  // HTML timers queue tasks even when their delay is zero. Treating a
  // zero-delay timer as a Promise reaction turns recursive framework
  // schedulers into an unbounded microtask checkpoint: timers and networking
  // never regain control and V8 can burn seconds before navigation completes.
  // deno_core's timer queue requires a Tokio reactor even to enqueue. Some
  // low-level embedders intentionally do a synchronous geometry mutation and
  // capture without pumping an event loop. Such a host cannot observe queued
  // tasks, so leave them pending instead of aborting or incorrectly turning a
  // task into a microtask. Normal browser and CDP execution always takes the
  // task-queue path below.
  if (!Deno.core.ops.op_async_runtime_available()) {
    return undefined;
  }
  // The callback runs only when the embedder pumps the event loop, after the
  // current microtask checkpoint. Bind the scheduling site's execution-source
  // label now: everything the fire does (bookkeeping ops included) must be
  // attributed to whoever scheduled the timer, not to whichever code ran last.
  const labeled = __obscuraTraceBind(fn);
  let nativeId;
  nativeId = Deno.core.queueUserTimer(0, false, d, labeled);
  Deno.core.ops.op_browser_timer_schedule(nativeId, d);
  return nativeId;
};

