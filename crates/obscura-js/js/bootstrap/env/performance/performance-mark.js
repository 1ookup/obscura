// PerformanceMark object shape.
class PerformanceMark extends PerformanceEntry {
  constructor(name, options = {}) {
    super({ name, entryType: 'mark', startTime: options.startTime ?? performance.now(), duration: 0 });
    this.detail = options.detail ?? null;
  }
}
