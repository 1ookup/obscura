// HTMLCanvasElement interface shape and export behavior.  Pixel operations
// remain in canvas.js/_Canvas2D; this object module only owns element
// attributes, context selection, and image export methods.
class HTMLCanvasElement extends Element {
  get width() {
    const raw = this.getAttribute('width');
    const parsed = raw === null ? 300 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
  }
  set width(value) { this.setAttribute('width', Math.max(0, Number(value) || 0)); }
  get height() {
    const raw = this.getAttribute('height');
    const parsed = raw === null ? 150 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 150;
  }
  set height(value) { this.setAttribute('height', Math.max(0, Number(value) || 0)); }
  setAttribute(name, value) {
    super.setAttribute(name, value);
    const normalized = String(name).toLowerCase();
    if (this._ctx && (normalized === 'width' || normalized === 'height')) {
      this._ctx._resizeFromCanvas();
    }
  }
  removeAttribute(name) {
    super.removeAttribute(name);
    const normalized = String(name).toLowerCase();
    if (this._ctx && (normalized === 'width' || normalized === 'height')) {
      this._ctx._resizeFromCanvas();
    }
  }
}
globalThis.HTMLCanvasElement = HTMLCanvasElement;

HTMLCanvasElement.prototype.getContext = function getContext(type, attrs) {
  if (type === '2d') {
    if (!this._ctx) {
      try { this._ctx = new _Canvas2D(this, attrs); }
      catch (_error) { return null; }
    }
    return this._ctx;
  }
  if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
    // The consistency layer is opt-in because it does not paint GPU pixels.
    // Its values come from the same fingerprint policy as navigator.userAgent;
    // callers that require a real GPU still receive the truthful null default.
    if (!globalThis.__obscura_webgl_enabled) return null;
    return type === 'webgl2'
      ? new globalThis.WebGL2RenderingContext(this, true, attrs)
      : new globalThis.WebGLRenderingContext(this, false, attrs);
  }
  if (type === 'webgpu') {
    if (!globalThis.__obscura_webgl_enabled || !globalThis.GPUCanvasContext) return null;
    if (!this._webgpuCtx) this._webgpuCtx = new globalThis.GPUCanvasContext(this);
    return this._webgpuCtx;
  }
  return null;
};
HTMLCanvasElement.prototype.toDataURL = function toDataURL(type) {
  const ctx = this._ctx || this.getContext('2d');
  if (ctx && ctx._buf) {
    if (ctx._w === 0 || ctx._h === 0) return 'data:,';
    return _encodePNG(ctx._w, ctx._h, ctx._buf);
  }
  return 'data:,';
};
function _canvasPngBlob(ctx) {
  if (!ctx || !ctx._buf || ctx._w === 0 || ctx._h === 0) return null;
  const url = _encodePNG(ctx._w, ctx._h, ctx._buf);
  const comma = url.indexOf(',');
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type: 'image/png'});
}
HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type, quality) {
  const blob = _canvasPngBlob(this._ctx || this.getContext('2d'));
  if (blob && type && String(type).toLowerCase() === 'image/png') {
    Object.defineProperty(blob, 'type', {value: 'image/png', configurable: true});
  }
  callback(blob);
};

_markNative(HTMLCanvasElement.prototype.getContext);
_markNative(HTMLCanvasElement.prototype.toDataURL);
_markNative(HTMLCanvasElement.prototype.toBlob);
