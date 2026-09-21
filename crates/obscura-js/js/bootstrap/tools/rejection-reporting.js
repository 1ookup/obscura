// Chrome never fails a page because a promise went unhandled: the reason
// reports through the console (unless a unhandledrejection listener calls
// preventDefault) and the event loop drives on. deno_core instead parks the
// reason as the realm's dispatched exception, which errors the next
// event-loop turn; a few of those in a row and a host that stops pumping on
// errors abandons every pending page task. On live challenge pages that
// exact shape killed the enrichment flow: a worker-scope probe touching
// MutationObserver (workers correctly have no such binding) rejected, the
// rejection surfaced as "Worker error: Event loop error: Uncaught (in
// promise) ..." on the page, and after three strikes the autonomous pump
// disarmed with the beacon's late stages still queued (profile Step 334:
// challenge worker round-trip and fold mechanics verified identical in
// fixtures, verdicts still failing on server-side risk scoring).
//
// Register deno_core's unhandled-rejection hook so rejections report
// Chrome-shaped and the loop survives. Runs in every realm that executes the
// bootstrap (page, child frames, workers), which is what keeps a
// worker-realm rejection from ever reaching the page loop. The registration
// is engine-private: no page-visible global appears, and
// window.onunhandledrejection stays null exactly as a browser reports it
// until the page assigns it. Uncaught non-promise task exceptions keep the
// default deno_core reporting: inline module evaluation (and anything else
// that reads a dispatched exception) depends on it.
(function () {
  const core = (globalThis.Deno && Deno.core) || null;
  if (!core || typeof core.setUnhandledPromiseRejectionHandler !== 'function') {
    return;
  }
  core.setUnhandledPromiseRejectionHandler((promise, reason) => {
    // Engine channel: drive_module_eval surfaces a module body's top-level
    // throw from this list, since the hook consumed the rejection the module
    // loader used to see as an event-loop error. Capped, read-only to pages.
    try {
      const list = globalThis.__obscura_consumedRejections ||
        (globalThis.__obscura_consumedRejections = []);
      if (list.length < 32) {
        list.push(reason instanceof Error
          ? (reason.stack || (reason.name + ': ' + reason.message))
          : String(reason));
      }
    } catch (_) {}
    try {
      if (typeof PromiseRejectionEvent === 'function' &&
          typeof globalThis.dispatchEvent === 'function') {
        const event = new PromiseRejectionEvent('unhandledrejection', {
          promise,
          reason,
          cancelable: true,
        });
        globalThis.dispatchEvent(event);
        if (event.defaultPrevented) return true;
      }
    } catch (_) {}
    try {
      console.error(reason);
    } catch (_) {
      try { console.error(String(reason)); } catch (_) {}
    }
    return true;
  });
})();
