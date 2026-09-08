// IntersectionObserverEntry is installed separately from the observer
// scheduler. The scheduler currently creates plain entry records, preserving
// the historical behavior while exposing the standard constructor shape.
globalThis.IntersectionObserverEntry = class IntersectionObserverEntry {};
