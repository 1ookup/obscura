// IntersectionObserverEntry is installed separately from the observer
// scheduler. The scheduler currently creates plain entry records, preserving
// the historical behavior while exposing the standard constructor shape.
globalThis.IntersectionObserverEntry = class IntersectionObserverEntry {};

// The intersection scheduler's MutationObserver belongs to this half, because
// this is the first point where the real MutationObserver (installed above) and
// a document can both exist. Wiring it from the core half instead runs before
// MutationObserver is initialized in a realm that boots the halves as separate
// scripts, where the DOM is already installed: the unguarded wiring there threw
// a ReferenceError out of that half's microtask checkpoint. A realm that
// reaches this point with its document still unset keeps the historical
// behavior, no observer and no throw, and never sees a placeholder observer
// before its first script runs.
if (globalThis.document) {
  // DOM writes synchronously mark ResizeObserver dirty through `_dom`; this
  // MutationObserver is only needed for intersection geometry. Scheduling RO
  // again here would escape its depth-bounded delivery cycle and allow a
  // self-resizing callback to create an infinite chain of zero-delay tasks.
  try {
    new MutationObserver(_scheduleIntersectionRenderCheckpoint).observe(globalThis.document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  } catch {}
}
