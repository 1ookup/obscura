// TextMetrics is a branded wrapper around the values produced by the 2D
// context.  Keep its realm-local storage in support code; the interface shape
// is installed by text-metrics.js.
const _textMetricsValues = new WeakMap();

function _makeTextMetrics(values) {
  const metrics = Object.create(TextMetrics.prototype);
  _textMetricsValues.set(metrics, values);
  return metrics;
}

function _textMetricValue(instance, name) {
  const held = _textMetricsValues.get(instance);
  if (held === undefined) throw new TypeError('Illegal invocation');
  return held[name];
}
