// Shared Performance Timeline state. Public entry classes and behavior methods
// consume this state, while no public constructor is defined here.
const _performanceEntries = [];
const _performanceObservers = new Set();
// The 149 order (verifier cross-check 2026-10-06: 13 types -- the
// interaction-contentful-paint and soft-navigation entries of the 10-05
// Chrome 154 alignment are 154-only surfaces and were removed with it). The
// list is published verbatim through PerformanceObserver.supportedEntryTypes,
// so both the membership and the ordering a page snapshots are observable.
const _supportedPerformanceEntryTypes = Object.freeze([
  'element', 'event', 'first-input',
  'largest-contentful-paint', 'layout-shift', 'long-animation-frame',
  'longtask', 'mark', 'measure', 'navigation', 'paint', 'resource',
  'visibility-state'
]);
let _resourceTimingBufferSize = 250;

function _queuePerformanceEntry(entry) {
  if (entry.entryType === 'resource'
      && _performanceEntries.filter(value => value.entryType === 'resource').length >= _resourceTimingBufferSize) {
    try { performance.dispatchEvent(new Event('resourcetimingbufferfull')); } catch (_error) {}
    return entry;
  }
  _performanceEntries.push(entry);
  return _deliverToObservers(entry);
}

// Event Timing entries are observer-scoped in Chrome: they reach
// PerformanceObservers (buffered replay included, capped at 150 like the
// reference) but never the global timeline -- getEntries()/getEntriesByType
// answer nothing for 'event' (measured on Chromium 149: 3 clicks yield zero
// 'event' entries in getEntries while the buffered observer receives all of
// them; 'first-input' is the opposite and rides the global buffer).
const _eventTimingBuffer = [];
const _EVENT_TIMING_BUFFER_MAX = 150;
function _queueObserverOnlyEntry(entry) {
  _eventTimingBuffer.push(entry);
  if (_eventTimingBuffer.length > _EVENT_TIMING_BUFFER_MAX) _eventTimingBuffer.shift();
  return _deliverToObservers(entry);
}

function _deliverToObservers(entry) {
  for (const observer of _performanceObservers) {
    if (observer._types.has(entry.entryType)) {
      observer._records.push(entry);
      observer._schedule();
    }
  }
  return entry;
}

function _entries(type, name) {
  return _performanceEntries
    .filter(entry => (type === undefined || entry.entryType === type)
      && (name === undefined || entry.name === name))
    .slice().sort((a, b) => a.startTime - b.startTime);
}

function _markTime(name) {
  const marks = _entries('mark', String(name));
  if (!marks.length) throw new DOMException("The mark '" + name + "' does not exist.", 'SyntaxError');
  return marks[marks.length - 1].startTime;
}
