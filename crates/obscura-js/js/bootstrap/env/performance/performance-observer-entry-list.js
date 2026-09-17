// PerformanceObserverEntryList object shape.
class PerformanceObserverEntryList {
  constructor(entries) { this._entries = entries; }
  getEntries() { return this._entries.slice().sort((a, b) => a.startTime - b.startTime); }
  getEntriesByType(type) { return this.getEntries().filter(entry => entry.entryType === String(type)); }
  getEntriesByName(name, type) {
    return this.getEntries().filter(entry => entry.name === String(name)
      && (type === undefined || entry.entryType === String(type)));
  }
}
