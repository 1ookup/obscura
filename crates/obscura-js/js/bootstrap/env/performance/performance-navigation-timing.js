// PerformanceNavigationTiming object shape.
class PerformanceNavigationTiming extends PerformanceResourceTiming {
  constructor(init = {}) {
    super({ ...init, entryType: 'navigation', initiatorType: 'navigation' });
    this.entryType = 'navigation';
    this.type = String(init.type || 'navigate');
    this.redirectCount = Math.max(0, +init.redirectCount || 0);
    this.unloadEventStart = +init.unloadEventStart || 0;
    this.unloadEventEnd = +init.unloadEventEnd || 0;
    this.domInteractive = +init.domInteractive || 0;
    this.domContentLoadedEventStart = +init.domContentLoadedEventStart || 0;
    this.domContentLoadedEventEnd = +init.domContentLoadedEventEnd || 0;
    this.domComplete = +init.domComplete || 0;
    this.loadEventStart = +init.loadEventStart || 0;
    this.loadEventEnd = +init.loadEventEnd || 0;
    this.activationStart = 0;
    this.criticalCHRestart = 0;
  }
}
