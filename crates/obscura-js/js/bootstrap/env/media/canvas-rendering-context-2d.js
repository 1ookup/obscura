// Public CanvasRenderingContext2D interface shape.  _Canvas2D owns the actual
// state and paint implementation; sharing its prototype avoids an observable
// extra `_Canvas2D` hop while the public constructor remains illegal.
const CanvasRenderingContext2D = _markNative(function CanvasRenderingContext2D() {
  throw new TypeError("Failed to construct 'CanvasRenderingContext2D': Illegal constructor");
});
CanvasRenderingContext2D.prototype = _Canvas2D.prototype;
Object.defineProperty(CanvasRenderingContext2D.prototype, 'constructor', {
  value: CanvasRenderingContext2D,
  writable: true,
  enumerable: false,
  configurable: true,
});
Object.defineProperty(CanvasRenderingContext2D.prototype, Symbol.toStringTag, {
  value: 'CanvasRenderingContext2D',
  writable: false,
  enumerable: false,
  configurable: true,
});
globalThis.CanvasRenderingContext2D = CanvasRenderingContext2D;
