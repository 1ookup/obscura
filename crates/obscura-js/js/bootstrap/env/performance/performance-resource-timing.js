// PerformanceResourceTiming object shape. Resource timing recording behavior
// lives in resource-timing.js and lifecycle-hooks.js.
class PerformanceResourceTiming extends PerformanceEntry {
  constructor(init = {}) {
    super({ ...init, entryType: init.entryType || 'resource' });
    const start = this.startTime;
    const responseEnd = Number.isFinite(+init.responseEnd) ? +init.responseEnd : start + this.duration;
    this.initiatorType = String(init.initiatorType || 'other');
    this.deliveryType = String(init.deliveryType || '');
    this.nextHopProtocol = String(init.nextHopProtocol || '');
    this.renderBlockingStatus = String(init.renderBlockingStatus || 'non-blocking');
    this.workerStart = +init.workerStart || 0;
    this.redirectStart = +init.redirectStart || 0;
    this.redirectEnd = +init.redirectEnd || 0;
    this.fetchStart = Number.isFinite(+init.fetchStart) ? +init.fetchStart : start;
    this.domainLookupStart = Number.isFinite(+init.domainLookupStart) ? +init.domainLookupStart : this.fetchStart;
    this.domainLookupEnd = Number.isFinite(+init.domainLookupEnd) ? +init.domainLookupEnd : this.domainLookupStart;
    this.connectStart = Number.isFinite(+init.connectStart) ? +init.connectStart : this.domainLookupEnd;
    this.secureConnectionStart = +init.secureConnectionStart || 0;
    this.connectEnd = Number.isFinite(+init.connectEnd) ? +init.connectEnd : this.connectStart;
    this.requestStart = Number.isFinite(+init.requestStart) ? +init.requestStart : this.connectEnd;
    this.responseStart = Number.isFinite(+init.responseStart) ? +init.responseStart : this.requestStart;
    this.firstInterimResponseStart = +init.firstInterimResponseStart || 0;
    this.responseEnd = responseEnd;
    this.transferSize = Math.max(0, +init.transferSize || 0);
    this.encodedBodySize = Math.max(0, +init.encodedBodySize || 0);
    this.decodedBodySize = Math.max(0, +init.decodedBodySize || 0);
    this.responseStatus = Math.max(0, +init.responseStatus || 0);
    this.serverTiming = Object.freeze(Array.isArray(init.serverTiming) ? init.serverTiming.slice() : []);
  }
}
