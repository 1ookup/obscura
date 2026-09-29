// IntersectionObserverEntry is installed separately from the observer
// scheduler. The scheduler currently creates plain entry records, preserving
// the historical behavior while exposing the standard constructor shape.
globalThis.IntersectionObserverEntry = class IntersectionObserverEntry {};

// The intersection MutationObserver wiring in the core half runs before
// MutationObserver exists in a realm that boots the halves as separate scripts.
// MutationObserver is installed above this point, so retry it here.
if (_intersectionObserverPending) _wireIntersectionMutationObserver();
