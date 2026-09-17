// PerformanceMeasure object shape.
class PerformanceMeasure extends PerformanceEntry {
  constructor(name, startTime, duration, detail = null) {
    super({ name, entryType: 'measure', startTime, duration });
    this.detail = detail;
  }
}
