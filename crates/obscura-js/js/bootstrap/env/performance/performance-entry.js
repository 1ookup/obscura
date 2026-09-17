// PerformanceEntry object shape shared by all timeline entry subclasses.
class PerformanceEntry {
  constructor(init = {}) {
    this.name = String(init.name || '');
    this.entryType = String(init.entryType || '');
    this.startTime = Number.isFinite(+init.startTime) ? Math.max(0, +init.startTime) : 0;
    this.duration = Number.isFinite(+init.duration) ? Math.max(0, +init.duration) : 0;
  }
  toJSON() {
    const out = {};
    for (const key of Object.keys(this)) out[key] = this[key];
    return out;
  }
}
