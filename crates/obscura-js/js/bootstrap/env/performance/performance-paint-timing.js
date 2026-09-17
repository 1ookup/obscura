// PerformancePaintTiming object shape.
class PerformancePaintTiming extends PerformanceEntry {
  constructor(name, startTime) { super({ name, entryType: 'paint', startTime, duration: 0 }); }
}
