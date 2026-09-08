// TextMetrics interface shape.  Values and branding state live in
// support/text-metrics-state.js so canvas.js only contains rendering behavior.
const TextMetrics = (function _defineTextMetrics() {
  const TextMetrics = function () {
    throw new TypeError("Failed to construct 'TextMetrics': Illegal constructor");
  };
  Object.defineProperty(TextMetrics, 'name', {value: 'TextMetrics', configurable: true});
  Object.defineProperty(TextMetrics.prototype, Symbol.toStringTag, {
    value: 'TextMetrics', configurable: true,
  });
  const names = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight',
    'fontBoundingBoxAscent', 'fontBoundingBoxDescent',
    'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
    'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'];
  for (const name of names) {
    Object.defineProperty(TextMetrics.prototype, name, {
      get: _markNativeAs(function () {
        return _textMetricValue(this, name);
      }, 'function get ' + name + '() { [native code] }'),
      enumerable: true,
      configurable: true,
    });
  }
  return _markNative(TextMetrics);
})();
globalThis.TextMetrics = TextMetrics;
