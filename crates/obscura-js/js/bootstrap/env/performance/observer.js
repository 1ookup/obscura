// PerformanceObserver behavior and public shape. Observer delivery is queued
// through microtasks, while timeline-state.js owns the source entry buffer.
class PerformanceObserver {
  constructor(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to construct 'PerformanceObserver': parameter 1 is not of type 'Function'.");
    }
    this._callback = callback;
    this._types = new Set();
    this._records = [];
    this._queued = false;
  }
  static get supportedEntryTypes() { return _supportedPerformanceEntryTypes.slice(); }
  observe(options = {}) {
    const hasTypes = Array.isArray(options.entryTypes);
    const hasType = options.type !== undefined;
    if (hasTypes === hasType) throw new TypeError("Failed to execute 'observe': specify either entryTypes or type.");
    const types = hasTypes ? options.entryTypes.map(String) : [String(options.type)];
    this._types = new Set(types.filter(type => _supportedPerformanceEntryTypes.includes(type)));
    _performanceObservers.add(this);
    if (!hasTypes && options.buffered) {
      for (const entry of _performanceEntries) if (this._types.has(entry.entryType)) this._records.push(entry);
      this._schedule();
    }
  }
  disconnect() { _performanceObservers.delete(this); this._records.length = 0; this._types.clear(); }
  takeRecords() { const records = this._records.slice(); this._records.length = 0; return records; }
  _schedule() {
    if (this._queued || !this._records.length) return;
    this._queued = true;
    queueMicrotask(() => {
      this._queued = false;
      const records = this.takeRecords();
      if (records.length && _performanceObservers.has(this)) {
        this._callback(new PerformanceObserverEntryList(records), this);
      }
    });
  }
}
