// Shared Performance Timeline state. Public entry classes and behavior methods
// consume this state, while no public constructor is defined here.
const _performanceEntries = [];
const _performanceObservers = new Set();
const _supportedPerformanceEntryTypes = Object.freeze([
  'element', 'event', 'first-input', 'largest-contentful-paint',
  'layout-shift', 'long-animation-frame', 'longtask', 'mark', 'measure',
  'navigation', 'paint', 'resource', 'visibility-state'
]);
let _resourceTimingBufferSize = 250;

function _queuePerformanceEntry(entry) {
  if (entry.entryType === 'resource'
      && _performanceEntries.filter(value => value.entryType === 'resource').length >= _resourceTimingBufferSize) {
    try { performance.dispatchEvent(new Event('resourcetimingbufferfull')); } catch (_error) {}
    return entry;
  }
  _performanceEntries.push(entry);
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
