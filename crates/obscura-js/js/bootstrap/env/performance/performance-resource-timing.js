// One Server-Timing metric of the response behind a navigation or resource
// entry. The header itself never crosses the op boundary: Rust hands over the
// raw value and this realm owns the parsed shape.
class PerformanceServerTiming {
  constructor(init = {}) {
    this.name = String(init.name || '');
    // A metric the server sent without a usable dur reports 0, and a negative
    // one reports the negative value -- Chrome does not clamp either way.
    this.duration = Number.isFinite(+init.duration) ? +init.duration : 0;
    this.description = String(init.description || '');
  }
  toJSON() {
    return { name: this.name, duration: this.duration, description: this.description };
  }
}
// Published here rather than from user-timing.js so the real class exists
// before the interface surface pass: it would otherwise install a throw-on-
// construct shell under this name and the entries' metrics would fail an
// `instanceof` against it.
globalThis.PerformanceServerTiming = PerformanceServerTiming;

// Parse a Server-Timing header value into PerformanceServerTiming entries.
// Metrics are comma separated and their parameters semicolon separated, with
// quoted strings protecting the delimiter inside them -- `desc="a,b"` is one
// description, not two metrics. Matches what a browser does with the same
// value: parameters are case-insensitive, the first dur and desc win, unknown
// parameters are skipped, an unusable dur reports 0, and a member with an
// empty name is not a metric at all. A quote that does not open a quoted
// value only ends the token in front of it -- `desc=a"b` keeps "a" and then
// parses on as if the quote had been a semicolon.
function _serverTimingFor(value) {
  const raw = String(value == null ? '' : value);
  const length = raw.length;
  const metrics = [];
  let index = 0;
  // Consume a quoted parameter value, unescaping it. `index` sits on the
  // opening quote and moves past the closing one.
  const readQuoted = () => {
    index++;
    let out = '';
    while (index < length) {
      const ch = raw[index];
      if (ch === '\\') {
        index++;
        if (index < length) { out += raw[index]; index++; }
      } else if (ch === '"') {
        index++;
        return out;
      } else {
        out += ch;
        index++;
      }
    }
    return out;
  };
  // Read an unquoted run: everything up to one of `stops`. A quote ends a
  // token because a browser treats it as a delimiter rather than as part of
  // the token, but it never ends the metric.
  const readBare = (stops) => {
    let out = '';
    while (index < length && !stops.includes(raw[index])) {
      out += raw[index];
      index++;
    }
    return out;
  };
  while (index < length) {
    const name = readBare(';,"').trim();
    let duration = 0;
    let description = '';
    let haveDuration = false;
    let haveDescription = false;
    while (index < length && raw[index] !== ',') {
      if (raw[index] === ';' || raw[index] === '"') { index++; continue; }
      const param = readBare(';,=').trim().toLowerCase();
      let paramValue = '';
      if (raw[index] === '=') {
        index++;
        while (index < length && (raw[index] === ' ' || raw[index] === '\t')) index++;
        paramValue = raw[index] === '"' ? readQuoted() : readBare(';,"').trim();
      }
      if (param === 'dur' && !haveDuration) {
        const parsed = Number(paramValue);
        if (Number.isFinite(parsed)) duration = parsed;
        haveDuration = true;
      } else if (param === 'desc' && !haveDescription) {
        description = paramValue;
        haveDescription = true;
      }
    }
    if (index < length && raw[index] === ',') index++;
    if (name) metrics.push(new PerformanceServerTiming({ name, duration, description }));
  }
  return metrics;
}

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
    // Server-Timing arrives as the response's raw header value so that every
    // recorder -- navigation, subframe, script, image and fetch -- shares one
    // parser. A caller that already has metrics keeps them.
    const metrics = Array.isArray(init.serverTiming)
      ? init.serverTiming
      : _serverTimingFor(init.serverTimingHeader);
    this.serverTiming = Object.freeze(metrics.map(metric => new PerformanceServerTiming(metric)));
  }
}
