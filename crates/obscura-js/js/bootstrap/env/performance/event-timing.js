// Event Timing: PerformanceEventTiming entries for discrete trusted input
// events, plus the one-time 'first-input' entry. Chrome generates these for
// real user interactions (interactionId != 0); a page observing type 'event'
// must never see an empty buffer after a real interaction.
class PerformanceEventTiming extends PerformanceEntry {
  constructor(init = {}) {
    super(init);
    this.interactionId = Number.isFinite(+init.interactionId) ? Math.max(0, Math.trunc(+init.interactionId)) : 0;
    this.processingStart = Number.isFinite(+init.processingStart) ? Math.max(0, +init.processingStart) : this.startTime;
    this.processingEnd = Number.isFinite(+init.processingEnd) ? Math.max(this.processingStart, +init.processingEnd) : this.processingStart;
    this.cancelable = !!init.cancelable;
  }
  get [Symbol.toStringTag]() { return 'PerformanceEventTiming'; }
}
Object.defineProperty(PerformanceEventTiming.prototype, 'constructor', {
  value: PerformanceEventTiming, writable: true, enumerable: false, configurable: true,
});
globalThis.PerformanceEventTiming = PerformanceEventTiming;

let _nextInteractionId = 0;
let _firstInputRecorded = false;
// Discrete event types that carry user activation in Chrome; these are the
// ones Chrome tags with an interactionId.
const _interactionEventTypes = new Set([
  'click', 'auxclick', 'contextmenu', 'dblclick',
  'pointerdown', 'pointerup',
  'keydown', 'input',
  'mousedown', 'mouseup',
  'touchend', 'touchstart',
]);
function _queueEventTiming(event) {
  try {
    if (!event || !event.isTrusted) return;
    const type = String(event.type || '');
    if (!_interactionEventTypes.has(type)) return;
    _nextInteractionId += 1;
    const startTime = Number(event.timeStamp) || performance.now();
    const processingStart = performance.now();
    const entry = new PerformanceEventTiming({
      name: type,
      entryType: 'event',
      startTime,
      duration: 8,
      interactionId: _nextInteractionId,
      processingStart,
      processingEnd: processingStart,
      cancelable: !!event.cancelable,
    });
    _queuePerformanceEntry(entry);
    if (!_firstInputRecorded) {
      _firstInputRecorded = true;
      _queuePerformanceEntry(new PerformanceEventTiming({
        name: type,
        entryType: 'first-input',
        startTime,
        duration: 8,
        interactionId: _nextInteractionId,
        processingStart,
        processingEnd: processingStart,
        cancelable: !!event.cancelable,
      }));
    }
  } catch (_error) {}
}
// Engine-internal dispatch hook (hidden from page code like the other
// __obscura globals).
globalThis.__obscura_queue_event_timing = _queueEventTiming;
