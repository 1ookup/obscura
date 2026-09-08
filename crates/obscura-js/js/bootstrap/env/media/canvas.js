// TextMetrics. Chrome exposes a branded interface whose numbers live on the
// prototype as getters; measureText used to return a plain object carrying
// three own properties, which is two separate tells:
//   Object.prototype.toString.call(ctx.measureText('x'))  // was [object Object]
//   'fontBoundingBoxAscent' in ctx.measureText('x')       // was false
// Chrome 146 ships exactly these ten members (no emHeight*), in this order.
const _textMetricsValues = new WeakMap();
const TextMetrics = (function _defineTextMetrics() {
  const TextMetrics = function () {
    throw new TypeError("Failed to construct 'TextMetrics': Illegal constructor");
  };
  Object.defineProperty(TextMetrics, 'name', { value: 'TextMetrics', configurable: true });
  Object.defineProperty(TextMetrics.prototype, Symbol.toStringTag, {
    value: 'TextMetrics', configurable: true,
  });
  const _names = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight',
    'fontBoundingBoxAscent', 'fontBoundingBoxDescent',
    'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
    'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'];
  for (let _i = 0; _i < _names.length; _i++) {
    const name = _names[_i];
    Object.defineProperty(TextMetrics.prototype, name, {
      get: _markNativeAs(function () {
        const held = _textMetricsValues.get(this);
        if (held === undefined) throw new TypeError('Illegal invocation');
        return held[name];
      }, 'function get ' + name + '() { [native code] }'),
      enumerable: true,
      configurable: true,
    });
  }
  return _markNative(TextMetrics);
})();
globalThis.TextMetrics = TextMetrics;

function _makeTextMetrics(values) {
  const metrics = Object.create(TextMetrics.prototype);
  _textMetricsValues.set(metrics, values);
  return metrics;
}

const _imageDataState = new WeakMap();
const _IMAGE_DATA_COLOR_SPACES = new Set(['srgb', 'display-p3']);
const _IMAGE_DATA_PIXEL_FORMATS = new Set(['rgba-unorm8', 'rgba-float16']);
function _imageDataEnum(value, fallback, allowed, member) {
  if (value === undefined) return fallback;
  const normalized = String(value);
  if (!allowed.has(normalized)) {
    throw new TypeError("Failed to read the '" + member
      + "' property from 'ImageDataSettings': The provided value '"
      + normalized + "' is not a valid enum value.");
  }
  return normalized;
}
function _imageDataSettings(settings, defaultColorSpace = 'srgb') {
  settings = settings == null ? {} : Object(settings);
  return {
    colorSpace: _imageDataEnum(settings.colorSpace, defaultColorSpace,
      _IMAGE_DATA_COLOR_SPACES, 'colorSpace'),
    pixelFormat: _imageDataEnum(settings.pixelFormat, 'rgba-unorm8',
      _IMAGE_DATA_PIXEL_FORMATS, 'pixelFormat'),
  };
}
function _imageDataDimensions(width, height, prefix = "Failed to construct 'ImageData'") {
  width = Math.trunc(Number(width));
  height = Math.trunc(Number(height));
  if (!Number.isFinite(width) || width <= 0) {
    throw new DOMException(prefix + ': The source width is zero or not a number.', 'IndexSizeError');
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new DOMException(prefix + ': The source height is zero or not a number.', 'IndexSizeError');
  }
  if (width > _MAX_CANVAS_DIMENSION || height > _MAX_CANVAS_DIMENSION
      || width * height > _MAX_CANVAS_PIXELS) {
    throw new DOMException(prefix + ': The requested image data is too large.', 'IndexSizeError');
  }
  return [width, height];
}
function _installImageData(target, data, width, height, colorSpace, pixelFormat) {
  _imageDataState.set(target, { data, width, height, colorSpace, pixelFormat });
  // Blink exposes the Uint8ClampedArray as an own property for the legacy
  // rgba-unorm8 shape. Float16 data stays behind the prototype getter.
  if (pixelFormat === 'rgba-unorm8') {
    Object.defineProperty(target, 'data', {
      value: data, enumerable: true, writable: false, configurable: true,
    });
  }
  return target;
}
function _makeImageData(data, width, height, colorSpace, pixelFormat) {
  return _installImageData(Object.create(globalThis.ImageData.prototype),
    data, width, height, colorSpace, pixelFormat);
}
function _imageData(value) {
  const state = _imageDataState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}

// Chromium canvas converts its named sRGB and Display-P3 spaces through
// Skia's D50 gamut matrices. These combined linear-light transforms preserve
// extended components and avoid a lossy XYZ round trip.
const _P3_TO_SRGB = [
  1.2248163647793426, -0.22511484254967298, 0.000004016024995612266,
  -0.04203825737967747, 1.0421472265146752, 0.000011317757177765203,
  -0.01962348117620927, -0.07863566035626239, 1.098419217632786,
];
const _SRGB_TO_P3 = [
  0.822547142507788, 0.1776785326630192, -0.000004838127636017949,
  0.03317981798185353, 0.9667237517446563, -0.00001008212117997691,
  0.01707030882567679, 0.07238186538013885, 0.9103984127298359,
];
const _SRGB_TO_XYZ = [
  506752 / 1228815, 87881 / 245763, 12673 / 70218,
  87098 / 409605, 175762 / 245763, 12673 / 175545,
  7918 / 409605, 87881 / 737289, 1001167 / 1053270,
];
const _XYZ_TO_SRGB = [
  12831 / 3959, -329 / 214, -1974 / 3959,
  -851781 / 878810, 1648619 / 878810, 36519 / 878810,
  705 / 12673, -2585 / 12673, 705 / 667,
];
const _P3_TO_XYZ = [
  608311 / 1250200, 189793 / 714400, 198249 / 1000160,
  35783 / 156275, 247089 / 357200, 198249 / 2500400,
  0, 32229 / 714400, 5220557 / 5000800,
];
const _XYZ_TO_P3 = [
  446124 / 178915, -333277 / 357830, -72051 / 178915,
  -14852 / 17905, 63121 / 35810, 423 / 17905,
  11844 / 330415, -50337 / 660830, 316169 / 330415,
];
function _colorTransferToLinear(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.04045
    ? magnitude / 12.92 : Math.pow((magnitude + 0.055) / 1.055, 2.4));
}
function _colorTransferFromLinear(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.0031308
    ? magnitude * 12.92 : 1.055 * Math.pow(magnitude, 1 / 2.4) - 0.055);
}
function _colorMatrix(matrix, rgb) {
  return [
    matrix[0] * rgb[0] + matrix[1] * rgb[1] + matrix[2] * rgb[2],
    matrix[3] * rgb[0] + matrix[4] * rgb[1] + matrix[5] * rgb[2],
    matrix[6] * rgb[0] + matrix[7] * rgb[1] + matrix[8] * rgb[2],
  ];
}
function _convertCanvasColor(rgb, source, destination) {
  const linear = rgb.map(_colorTransferToLinear);
  const xyz = _colorMatrix(source === 'display-p3' ? _P3_TO_XYZ : _SRGB_TO_XYZ, linear);
  return _colorMatrix(destination === 'display-p3' ? _XYZ_TO_P3 : _XYZ_TO_SRGB, xyz)
    .map(_colorTransferFromLinear);
}
function _convertCanvasFloatColor(rgb, source, destination) {
  if (source === destination) return rgb.slice();
  const linear = rgb.map(_colorTransferToLinear);
  return _colorMatrix(source === 'display-p3' ? _P3_TO_SRGB : _SRGB_TO_P3, linear)
    .map(_colorTransferFromLinear);
}
function _canvasColorComponent(token) {
  token = String(token).trim();
  return token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token);
}
const _CANVAS_AA_2X2 = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const _CANVAS_AA_4X4 = Array.from({length: 16}, (_, index) =>
  [(index % 4 + 0.5) / 4, (Math.floor(index / 4) + 0.5) / 4]);
function _prepareCanvasText(value) {
  return String(value).replace(/[\x80-\x9f]/g, '\uFFFD');
}

class _Canvas2D {
  constructor(canvas, attrs = undefined) {
    this.canvas = canvas;
    attrs = attrs == null ? {} : Object(attrs);
    this._colorSpace = _imageDataEnum(attrs.colorSpace, 'srgb',
      _IMAGE_DATA_COLOR_SPACES, 'colorSpace');
    this._colorType = attrs.colorType === 'float16' ? 'float16' : 'unorm8';
    this._alpha = attrs.alpha !== false;
    this._desynchronized = !!attrs.desynchronized;
    this._willReadFrequently = !!attrs.willReadFrequently;
    this._damageQueued = false;
    this._resizeFromCanvas();
  }
  _canvasDimension(name, fallback) {
    const raw = this.canvas.getAttribute(name);
    if (raw === null || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  _resetDrawingState() {
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.direction = 'inherit';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this._stateStack = [];
    this._transform = [1, 0, 0, 1, 0, 0];
    this._path = [];
  }
  _resizeFromCanvas() {
    const requestedWidth = this._canvasDimension('width', 300);
    const requestedHeight = this._canvasDimension('height', 150);
    const valid = requestedWidth <= _MAX_CANVAS_DIMENSION
      && requestedHeight <= _MAX_CANVAS_DIMENSION
      && requestedWidth * requestedHeight <= _MAX_CANVAS_PIXELS;
    this._w = valid ? requestedWidth : 0;
    this._h = valid ? requestedHeight : 0;
    this._buf = new Uint8ClampedArray(this._w * this._h * 4);
    this._floatBuf = this._colorType === 'float16'
      ? new Float32Array(this._buf.length) : null;
    this._colorBuf = this._colorSpace === 'srgb' && !this._floatBuf
      ? this._buf : new Uint8ClampedArray(this._buf.length);
    this._resetDrawingState();
    const register = Deno.core.ops.op_canvas_register_surface;
    if (typeof register === 'function' && this.canvas[_nidSym] != null) {
      // op2 accepts Uint8Array, while Canvas exposes Uint8ClampedArray. This
      // second view shares the exact backing store; no pixel copy is made.
      const bytes = new Uint8Array(
        this._buf.buffer,
        this._buf.byteOffset,
        this._buf.byteLength,
      );
      if (!register(this.canvas[_nidSym], this._w, this._h, bytes)) {
        throw new RangeError('Canvas backing store allocation failed');
      }
    }
  }
  _markPaintDamage() {
    if (this.canvas[_nidSym] == null) return;
    if (this._damageQueued) return;
    this._damageQueued = true;
    queueMicrotask(() => {
      this._damageQueued = false;
      const damage = Deno.core.ops.op_canvas_paint_damage;
      if (typeof damage === 'function') damage(this.canvas[_nidSym]);
    });
  }
  _parseColor(css) {
    if (!css || typeof css !== 'string' || css === 'none') return [0,0,0,0];
    const functional = /^color\(\s*(srgb|display-p3)\s+([^\s/]+)\s+([^\s/]+)\s+([^\s/)]+)(?:\s*\/\s*([^\s)]+))?\s*\)$/i.exec(css);
    if (functional) {
      const source = functional[1].toLowerCase();
      const rgb = [_canvasColorComponent(functional[2]),
        _canvasColorComponent(functional[3]), _canvasColorComponent(functional[4])];
      if (rgb.every(Number.isFinite)) {
        const converted = (this._floatBuf
          ? _convertCanvasFloatColor : _convertCanvasColor)(rgb, source, this._colorSpace);
        const alpha = functional[5] === undefined ? 1 : _canvasColorComponent(functional[5]);
        if (this._floatBuf) {
          return [converted[0] * 255, converted[1] * 255, converted[2] * 255,
            Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1)) * 255];
        }
        const p3TieBias = source === 'display-p3' && this._colorSpace === 'display-p3'
          ? Number.EPSILON * 255 : 0;
        return [
          Math.round(Math.max(0, Math.min(1, converted[0])) * 255 - p3TieBias),
          Math.round(Math.max(0, Math.min(1, converted[1])) * 255 - p3TieBias),
          Math.round(Math.max(0, Math.min(1, converted[2])) * 255 - p3TieBias),
          Math.round(Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1)) * 255),
        ];
      }
    }
    if (css.startsWith('#')) {
      const hex = css.slice(1);
      if (hex.length === 3) return [parseInt(hex[0]+hex[0],16),parseInt(hex[1]+hex[1],16),parseInt(hex[2]+hex[2],16),255];
      if (hex.length === 6) return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
      if (hex.length === 8) return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),parseInt(hex.slice(6,8),16)];
    }
    const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) return [+m[1],+m[2],+m[3],m[4]!==undefined?Math.round(+m[4]*255):255];
    const named = {red:[255,0,0,255],green:[0,128,0,255],blue:[0,0,255,255],white:[255,255,255,255],black:[0,0,0,255],yellow:[255,255,0,255],orange:[255,165,0,255],gray:[128,128,128,255],transparent:[0,0,0,0]};
    const value = named[css] || [0,0,0,255];
    if (this._colorSpace === 'srgb') return value;
    const converted = (this._floatBuf
      ? _convertCanvasFloatColor : _convertCanvasColor)(value.slice(0, 3).map(v => v / 255),
      'srgb', this._colorSpace);
    return converted.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255))
      .concat(value[3]);
  }
  _syncRendererPixel(idx) {
    if (this._colorBuf === this._buf && !this._floatBuf) return;
    const source = this._floatBuf
      ? [this._floatBuf[idx], this._floatBuf[idx + 1], this._floatBuf[idx + 2]]
      : [this._colorBuf[idx] / 255, this._colorBuf[idx + 1] / 255,
        this._colorBuf[idx + 2] / 255];
    const converted = (this._floatBuf
      ? _convertCanvasFloatColor : _convertCanvasColor)(source,
      this._colorSpace, 'srgb');
    this._buf[idx] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
    this._buf[idx + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
    this._buf[idx + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
    this._buf[idx + 3] = this._floatBuf
      ? Math.round(Math.max(0, Math.min(1, this._floatBuf[idx + 3])) * 255)
      : this._colorBuf[idx + 3];
  }
  _setPixel(x, y, r, g, b, a, sourceSpace = this._colorSpace) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= this._w || y < 0 || y >= this._h) return;
    if (sourceSpace !== this._colorSpace) {
      const converted = (this._floatBuf
        ? _convertCanvasFloatColor : _convertCanvasColor)([r / 255, g / 255, b / 255],
        sourceSpace, this._colorSpace);
      r = converted[0] * 255;
      g = converted[1] * 255;
      b = converted[2] * 255;
    }
    this._blendPixel(x, y, r, g, b, a, 1);
  }
  fillRect(x, y, w, h) {
    const t = this._transform;
    const identity = t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1
      && t[4] === 0 && t[5] === 0;
    if (!identity || (this.fillStyle && this.fillStyle._stops)) {
      const currentPath = this._path;
      try {
        this._path = [];
        this.rect(x, y, w, h);
        this.fill();
      } finally {
        this._path = currentPath;
      }
      return;
    }
    const [r,g,b,a] = this._parseColor(this.fillStyle);
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    for (let py = Math.max(0,y); py < Math.min(this._h, y+h); py++) {
      for (let px = Math.max(0,x); px < Math.min(this._w, x+w); px++) {
        this._setPixel(px, py, r, g, b, a);
      }
    }
    this._markPaintDamage();
  }
  clearRect(x, y, w, h) {
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    for (let py = Math.max(0,y); py < Math.min(this._h, y+h); py++) {
      for (let px = Math.max(0,x); px < Math.min(this._w, x+w); px++) {
        const idx = (py * this._w + px) * 4;
        this._colorBuf[idx] = this._colorBuf[idx+1] = this._colorBuf[idx+2] = 0;
        this._colorBuf[idx+3] = this._alpha ? 0 : 255;
        if (this._floatBuf) {
          this._floatBuf[idx] = this._floatBuf[idx + 1] = this._floatBuf[idx + 2] = 0;
          this._floatBuf[idx + 3] = this._alpha ? 0 : 1;
        }
        if (this._colorBuf !== this._buf || this._floatBuf) this._syncRendererPixel(idx);
      }
    }
    this._markPaintDamage();
  }
  strokeRect(x, y, w, h) {
    const [r,g,b,a] = this._parseColor(this.strokeStyle);
    const lw = this.lineWidth;
    for (let px = Math.round(x); px < Math.round(x+w); px++) {
      for (let l = 0; l < lw; l++) { this._setPixel(px, Math.round(y)+l, r,g,b,a); this._setPixel(px, Math.round(y+h)-1-l, r,g,b,a); }
    }
    for (let py = Math.round(y); py < Math.round(y+h); py++) {
      for (let l = 0; l < lw; l++) { this._setPixel(Math.round(x)+l, py, r,g,b,a); this._setPixel(Math.round(x+w)-1-l, py, r,g,b,a); }
    }
    this._markPaintDamage();
  }
  fillText(text, x, y) {
    // A gradient fill under text uses the gradient's first stop; per-glyph
    // gradient evaluation stays out of the dot-matrix rasterizer.
    const fill = this.fillStyle;
    const [r,g,b,a] = fill && fill._stops && fill._stops.length
      ? fill._stops[0][1] : this._parseColor(fill);
    const fontSize = parseInt(this.font) || 10;
    const scale = Math.max(1, Math.round(fontSize / 10));
    const str = _prepareCanvasText(text);
    const [tx, ty] = this._applyTransform(+x || 0, +y || 0);
    let cx = Math.round(tx);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          const on = ((_fpRand(code * 100 + row * 10 + col) > 0.45) &&
                      (row > 0 && row < 6 && col > 0 && col < 4)) ||
                     (_fpRand(code * 200 + row * 7 + col) > 0.7);
          if (on) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                this._setPixel(cx + col*scale + sx, Math.round(ty) - 7*scale + row*scale + sy, r, g, b, a);
              }
            }
          }
        }
      }
      cx += 6 * scale;
    }
    this._markPaintDamage();
  }
  strokeText(text, x, y) { this.fillText(text, x, y); }
  measureText(t) {
    // Route through the real text layout engine, which is what element
    // measurement already uses. The previous `length * 6 * scale` ignored the
    // font entirely, so every family measured identically -- a canvas font
    // fingerprint with no variance at all, and one that contradicted the
    // element widths the same engine produced next door. The ascent/descent
    // were worse: constants derived from the size alone, so they did not move
    // when the family did.
    const text = _prepareCanvasText(t);
    const box = _measureTextBox(text, this.font);
    const hasInk = !/^\s*$/u.test(text);
    let direction = this.direction;
    if (direction !== 'ltr' && direction !== 'rtl') {
      direction = 'ltr';
      for (let node = this.canvas; node; node = node.parentElement) {
        const authored = node.getAttribute && node.getAttribute('dir');
        if (authored === 'ltr' || authored === 'rtl') { direction = authored; break; }
      }
    }
    let align = this.textAlign;
    if (align === 'start') align = direction === 'rtl' ? 'right' : 'left';
    if (align === 'end') align = direction === 'rtl' ? 'left' : 'right';
    const alignmentOffset = align === 'center' ? box.width / 2
      : align === 'right' ? box.width : 0;
    return _makeTextMetrics({
      width: box.width,
      // No per-glyph outlines are available here, so the ink extents fall back
      // to the font box and the advance. That is a superset of the real ink
      // rather than an invented number, and it stays consistent with the
      // font box reported beside it.
      actualBoundingBoxLeft: alignmentOffset,
      actualBoundingBoxRight: (hasInk ? box.width : 0) - alignmentOffset,
      fontBoundingBoxAscent: box.ascent,
      fontBoundingBoxDescent: box.descent,
      actualBoundingBoxAscent: hasInk ? box.ascent : 0,
      actualBoundingBoxDescent: hasInk ? box.descent : 0,
      // Chrome puts the hanging baseline at 80% of the font ascent, the
      // alphabetic one at the origin, and the ideographic one at the font
      // descent. Checked against Chrome 146 for sans-serif, Arial, Times New
      // Roman and monospace at 10/16/32px: hanging is 0.8 * ascent in all of
      // them, alphabetic is 0 in all of them.
      hangingBaseline: box.ascent * 0.8,
      alphabeticBaseline: 0,
      ideographicBaseline: -box.descent,
    });
  }
  getImageData(x, y, w, h, settings = undefined) {
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    [w, h] = _imageDataDimensions(w, h, "Failed to execute 'getImageData' on 'CanvasRenderingContext2D'");
    const output = _imageDataSettings(settings, this._colorSpace);
    const data = output.pixelFormat === 'rgba-float16'
      ? new Float16Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcX = x + px, srcY = y + py;
        const dstIdx = (py * w + px) * 4;
        if (srcX >= 0 && srcX < this._w && srcY >= 0 && srcY < this._h) {
          const srcIdx = (srcY * this._w + srcX) * 4;
          const sourceColor = this._floatBuf
            ? [this._floatBuf[srcIdx], this._floatBuf[srcIdx + 1],
              this._floatBuf[srcIdx + 2]]
            : [this._colorBuf[srcIdx] / 255, this._colorBuf[srcIdx + 1] / 255,
              this._colorBuf[srcIdx + 2] / 255];
          const sourceAlpha = this._floatBuf
            ? this._floatBuf[srcIdx + 3] : this._colorBuf[srcIdx + 3] / 255;
          const converted = (this._floatBuf
            ? _convertCanvasFloatColor : _convertCanvasColor)(sourceColor,
            this._colorSpace, output.colorSpace);
          if (output.pixelFormat === 'rgba-float16') {
            data[dstIdx] = converted[0]; data[dstIdx + 1] = converted[1];
            data[dstIdx + 2] = converted[2]; data[dstIdx + 3] = sourceAlpha;
          } else {
            data[dstIdx] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
            data[dstIdx + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
            data[dstIdx + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
            data[dstIdx + 3] = Math.round(Math.max(0, Math.min(1, sourceAlpha)) * 255);
          }
        }
      }
    }
    return _makeImageData(data, w, h, output.colorSpace, output.pixelFormat);
  }
  putImageData(imageData, dx, dy) {
    dx=Math.round(dx); dy=Math.round(dy);
    const source = _imageData(imageData);
    const {data, width: w, height: h} = source;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcIdx = (py * w + px) * 4;
        const x = dx + px, y = dy + py;
        if (x >= 0 && x < this._w && y >= 0 && y < this._h) {
          const dstIdx = (y * this._w + x) * 4;
          const scale = source.pixelFormat === 'rgba-float16' ? 1 : 1 / 255;
          const converted = (this._floatBuf
            ? _convertCanvasFloatColor : _convertCanvasColor)([data[srcIdx] * scale,
            data[srcIdx + 1] * scale, data[srcIdx + 2] * scale],
            source.colorSpace, this._colorSpace);
          const alpha = Math.max(0, Math.min(1, data[srcIdx + 3] * scale));
          if (this._floatBuf) {
            this._floatBuf[dstIdx] = converted[0];
            this._floatBuf[dstIdx + 1] = converted[1];
            this._floatBuf[dstIdx + 2] = converted[2];
            this._floatBuf[dstIdx + 3] = alpha;
          }
          this._colorBuf[dstIdx] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
          this._colorBuf[dstIdx + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
          this._colorBuf[dstIdx + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
          this._colorBuf[dstIdx + 3] = Math.round(alpha * 255);
          this._syncRendererPixel(dstIdx);
        }
      }
    }
    this._markPaintDamage();
  }
  createImageData(widthOrImage, height, settings = undefined) {
    if (_imageDataState.has(widthOrImage)) {
      const source = _imageData(widthOrImage);
      const output = _imageDataSettings(height, source.colorSpace);
      const data = output.pixelFormat === 'rgba-float16'
        ? new Float16Array(source.width * source.height * 4)
        : new Uint8ClampedArray(source.width * source.height * 4);
      return _makeImageData(data, source.width, source.height,
        output.colorSpace, output.pixelFormat);
    }
    const dimensions = _imageDataDimensions(widthOrImage, height,
      "Failed to execute 'createImageData' on 'CanvasRenderingContext2D'");
    const output = _imageDataSettings(settings, this._colorSpace);
    const data = output.pixelFormat === 'rgba-float16'
      ? new Float16Array(dimensions[0] * dimensions[1] * 4)
      : new Uint8ClampedArray(dimensions[0] * dimensions[1] * 4);
    return _makeImageData(data, dimensions[0], dimensions[1],
      output.colorSpace, output.pixelFormat);
  }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (img && img._ctx && img._ctx._buf) {
      const src = img._ctx;
      dx = dx ?? sx; dy = dy ?? sy; dw = dw ?? (sw ?? src._w); dh = dh ?? (sh ?? src._h);
      for (let py = 0; py < dh; py++) {
        for (let px = 0; px < dw; px++) {
          const srcX = Math.floor((sx||0) + px * (sw||src._w) / dw);
          const srcY = Math.floor((sy||0) + py * (sh||src._h) / dh);
          if (srcX >= 0 && srcX < src._w && srcY >= 0 && srcY < src._h) {
            const srcIdx = (srcY * src._w + srcX) * 4;
            const sourceBuffer = src._floatBuf || src._colorBuf || src._buf;
            const scale = src._floatBuf ? 255 : 1;
            this._setPixel(dx+px, dy+py, sourceBuffer[srcIdx] * scale,
              sourceBuffer[srcIdx+1] * scale, sourceBuffer[srcIdx+2] * scale,
              sourceBuffer[srcIdx+3] * scale, src._colorSpace || 'srgb');
          }
        }
      }
    }
    this._markPaintDamage();
  }
  beginPath() { this._path = []; }
  closePath() { if (this._path) this._path.push({t:'Z'}); }
  moveTo(x, y) {
    if (this._path) {
      const point = this._applyTransform(+x, +y);
      this._path.push({t:'M', x:point[0], y:point[1]});
    }
  }
  lineTo(x, y) {
    if (this._path) {
      const point = this._applyTransform(+x, +y);
      this._path.push({t:'L', x:point[0], y:point[1]});
    }
  }
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    if (!this._path.length) this.moveTo(cp1x, cp1y);
    const last = this._path[this._path.length - 1];
    const p1 = this._applyTransform(+cp1x, +cp1y);
    const p2 = this._applyTransform(+cp2x, +cp2y);
    const end = this._applyTransform(+x, +y);
    this._path.push({t:'C', x0:last.x, y0:last.y, x1:p1[0], y1:p1[1],
      x2:p2[0], y2:p2[1], x:end[0], y:end[1]});
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    if (!this._path.length) this.moveTo(cpx, cpy);
    const last = this._path[this._path.length - 1];
    const control = this._applyTransform(+cpx, +cpy);
    const end = this._applyTransform(+x, +y);
    this._path.push({t:'Q', x0:last.x, y0:last.y,
      x1:control[0], y1:control[1], x:end[0], y:end[1]});
  }
  arc(x, y, r, startAngle, endAngle, counterclockwise = false) {
    r = +r;
    if (r < 0) throw new DOMException('The radius provided is negative.', 'IndexSizeError');
    if (this._path) this._path.push({t:'A', x:+x, y:+y, r,
      s:+(startAngle || 0), e:+(endAngle === undefined ? Math.PI * 2 : endAngle),
      ccw:!!counterclockwise, m:this._transform.slice()});
  }
  arcTo() {}
  rect(x, y, w, h) {
    if (!this._path) return;
    const x0 = +x, y0 = +y, ww = +w, hh = +h;
    this.moveTo(x0, y0); this.lineTo(x0 + ww, y0);
    this.lineTo(x0 + ww, y0 + hh); this.lineTo(x0, y0 + hh); this.closePath();
  }
  ellipse(x, y, rx, ry) {
    if (this._path) this._path.push({t:'E', x:+x, y:+y, rx:+rx,
      ry:+ry === 0 ? +rx : +ry, m:this._transform.slice()});
  }
  roundRect(x, y, w, h) { this.rect(x, y, w, h); }
  // Path commands capture the current transform when they are appended, so
  // later CTM changes cannot move geometry already present in the path.
  _applyTransform(x, y) {
    const [a, b, c, d, e, f] = this._transform;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  _flattenPath(minPoints) {
    const subpaths = [];
    let current = null;
    const finish = close => {
      if (close && current && current.length > 1) current.push(current[0].slice());
      if (current && current.length >= minPoints) subpaths.push(current);
      current = null;
    };
    const push = (x, y) => {
      if (!current) current = [[x, y]];
      else current.push([x, y]);
    };
    const mappedPush = (matrix, x, y) => {
      const [a, b, c, d, e, f] = matrix;
      push(a * x + c * y + e, b * x + d * y + f);
    };
    const arcSteps = r => Math.max(16, Math.min(64, Math.ceil(r * 2)));
    for (const seg of this._path || []) {
      if (seg.t === 'M') { finish(false); push(seg.x, seg.y); }
      else if (seg.t === 'L') push(seg.x, seg.y);
      else if (seg.t === 'Z') { finish(true); }
      else if (seg.t === 'C' || seg.t === 'Q') {
        const cubic = seg.t === 'C'
          ? [seg.x0, seg.y0, seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y]
          : [ // quadratic as the equivalent cubic
            seg.x0, seg.y0,
            seg.x0 + 2 / 3 * (seg.x1 - seg.x0), seg.y0 + 2 / 3 * (seg.y1 - seg.y0),
            seg.x + 2 / 3 * (seg.x1 - seg.x), seg.y + 2 / 3 * (seg.y1 - seg.y),
            seg.x, seg.y];
        for (let step = 1; step <= 16; step++) {
          const t = step / 16, u = 1 - t;
          push(
            u * u * u * cubic[0] + 3 * u * u * t * cubic[2] + 3 * u * t * t * cubic[4] + t * t * t * cubic[6],
            u * u * u * cubic[1] + 3 * u * u * t * cubic[3] + 3 * u * t * t * cubic[5] + t * t * t * cubic[7]);
        }
      } else if (seg.t === 'A') {
        let sweep = seg.e - seg.s;
        const fullTurn = Math.PI * 2;
        if (Math.abs(sweep) >= fullTurn) sweep = seg.ccw ? -fullTurn : fullTurn;
        else if (seg.ccw) { while (sweep > 0) sweep -= fullTurn; }
        else { while (sweep < 0) sweep += fullTurn; }
        const steps = arcSteps(seg.r);
        for (let step = 0; step <= steps; step++) {
          const angle = seg.s + sweep * step / steps;
          mappedPush(seg.m, seg.x + seg.r * Math.cos(angle), seg.y + seg.r * Math.sin(angle));
        }
      } else if (seg.t === 'E') {
        const steps = arcSteps(Math.max(seg.rx, seg.ry));
        for (let step = 0; step <= steps; step++) {
          const angle = Math.PI * 2 * step / steps;
          mappedPush(seg.m, seg.x + seg.rx * Math.cos(angle), seg.y + seg.ry * Math.sin(angle));
        }
      }
    }
    finish(false);
    return subpaths;
  }
  // Nonzero winding number at a device-space point.
  _windingAt(subpaths, x, y, evenOdd = false) {
    let winding = 0, crossings = 0;
    for (const poly of subpaths) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
          crossings++;
          winding += yj > yi ? 1 : -1;
        }
      }
    }
    return evenOdd ? crossings & 1 : winding;
  }
  // Paint source at a device-space pixel: either a flat color or a gradient
  // evaluated in its own user space (device point unmapped through the
  // transform inverse).
  _paintAt(px, py) {
    const fill = this.fillStyle;
    if (fill && fill._stops && fill._stops.length) {
      const inv = this._transformInverse(fill._transform);
      const [ux, uy] = [inv[0] * px + inv[2] * py + inv[4], inv[1] * px + inv[3] * py + inv[5]];
      return this._gradientColorAt(fill, ux, uy);
    }
    const color = this._parseColor(fill);
    color.gradient = false;
    return color;
  }
  _coverageSamples() {
    return this._w * this._h <= 65536 ? _CANVAS_AA_4X4 : _CANVAS_AA_2X2;
  }
  _transformInverse(matrix) {
    const [a, b, c, d, e, f] = matrix || this._transform;
    const det = a * d - b * c;
    if (!det) return [1, 0, 0, 1, 0, 0];
    return [d / det, -b / det, -c / det, a / det,
      (c * f - d * e) / det, (b * e - a * f) / det];
  }
  _gradientColorAt(grad, x, y) {
    let t;
    if (grad._type === 'linear') {
      const dx = grad._x1 - grad._x0, dy = grad._y1 - grad._y0;
      const len = dx * dx + dy * dy;
      t = len ? ((x - grad._x0) * dx + (y - grad._y0) * dy) / len : 0;
    } else if (grad._type === 'radial') {
      const dist = Math.hypot(x - grad._x1, y - grad._y1);
      t = grad._r1 > grad._r0 ? (dist - grad._r0) / (grad._r1 - grad._r0) : 0;
    } else {
      t = ((Math.atan2(y - grad._y0, x - grad._x0) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      if (grad._startAngle) t = (t + grad._startAngle / (Math.PI * 2)) % 1;
    }
    t = Math.min(1, Math.max(0, t));
    const stops = grad._stops;
    if (t <= stops[0][0]) return stops[0][1].slice();
    const lastStop = stops[stops.length - 1];
    if (t >= lastStop[0]) return lastStop[1].slice();
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
        const span = t1 - t0 || 1;
        const f = (t - t0) / span;
        return [0, 1, 2, 3].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * f));
      }
    }
    return lastStop[1].slice();
  }
  fill(fillRule = 'nonzero') {
    if (!this._path) return;
    const evenOdd = String(fillRule).toLowerCase() === 'evenodd';
    const subpaths = this._flattenPath(3);
    if (!subpaths.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of subpaths) for (const [x, y] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(this._w - 1, Math.ceil(maxX)), y1 = Math.min(this._h - 1, Math.ceil(maxY));
    const samples = this._coverageSamples();
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let coverage = 0;
        for (const [ox, oy] of samples) {
          if (this._windingAt(subpaths, px + ox, py + oy, evenOdd) !== 0) coverage++;
        }
        if (!coverage) continue;
        const [r, g, b, a] = this._paintAt(px + 0.5, py + 0.5);
        this._blendPixel(px, py, r, g, b, a, coverage / samples.length);
      }
    }
    this._markPaintDamage();
  }
  stroke() {
    if (!this._path) return;
    const subpaths = this._flattenPath(2);
    if (!subpaths.length) return;
    const half = Math.max(0.5, +this.lineWidth / 2 || 0.5);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of subpaths) for (const [x, y] of poly) {
      if (x - half < minX) minX = x - half; if (x + half > maxX) maxX = x + half;
      if (y - half < minY) minY = y - half; if (y + half > maxY) maxY = y + half;
    }
    const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(this._w - 1, Math.ceil(maxX)), y1 = Math.min(this._h - 1, Math.ceil(maxY));
    const samples = this._coverageSamples();
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let inside = 0;
        for (const [ox, oy] of samples) {
          const sx = px + ox, sy = py + oy;
          for (const poly of subpaths) {
            for (let i = 1; i < poly.length; i++) {
              if (this._distanceToSegment(sx, sy, poly[i - 1], poly[i]) <= half) { inside++; break; }
            }
          }
        }
        if (!inside) continue;
        const [r, g, b, a] = this._paintStrokeAt(px + 0.5, py + 0.5);
        this._blendPixel(px, py, r, g, b, a, inside / samples.length);
      }
    }
    this._markPaintDamage();
  }
  _paintStrokeAt(px, py) {
    const stroke = this.strokeStyle;
    if (stroke && stroke._stops && stroke._stops.length) {
      const inv = this._transformInverse(stroke._transform);
      const [ux, uy] = [inv[0] * px + inv[2] * py + inv[4], inv[1] * px + inv[3] * py + inv[5]];
      return this._gradientColorAt(stroke, ux, uy);
    }
    return this._parseColor(stroke);
  }
  _distanceToSegment(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  _blendPixel(x, y, r, g, b, a, coverage) {
    const sourceAlpha = (a / 255) * coverage * this.globalAlpha;
    if (sourceAlpha <= 0) return;
    if (x < 0 || x >= this._w || y < 0 || y >= this._h) return;
    const idx = (y * this._w + x) * 4;
    const destinationAlpha = this._floatBuf
      ? this._floatBuf[idx + 3] : this._colorBuf[idx + 3] / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    const source = [r / 255, g / 255, b / 255];
    const destination = this._floatBuf
      ? [this._floatBuf[idx], this._floatBuf[idx + 1], this._floatBuf[idx + 2]]
      : [this._colorBuf[idx] / 255, this._colorBuf[idx + 1] / 255,
        this._colorBuf[idx + 2] / 255];
    for (let channel = 0; channel < 3; channel++) {
      const blended = this.globalCompositeOperation === 'multiply'
        ? source[channel] * destination[channel] : source[channel];
      const premultiplied = source[channel] * sourceAlpha * (1 - destinationAlpha)
        + destination[channel] * destinationAlpha * (1 - sourceAlpha)
        + blended * sourceAlpha * destinationAlpha;
      const value = outputAlpha > 0 ? premultiplied / outputAlpha : 0;
      if (this._floatBuf) this._floatBuf[idx + channel] = value;
      this._colorBuf[idx + channel] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
    if (this._floatBuf) this._floatBuf[idx + 3] = outputAlpha;
    this._colorBuf[idx + 3] = Math.round(Math.max(0, Math.min(1, outputAlpha)) * 255);
    this._syncRendererPixel(idx);
  }
  clip() {}
  save() {
    this._stateStack.push({fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha, font: this.font, lineWidth: this.lineWidth,
      textAlign: this.textAlign, textBaseline: this.textBaseline, direction: this.direction,
      globalCompositeOperation: this.globalCompositeOperation,
      _transform: this._transform.slice()});
  }
  restore() { const s = this._stateStack.pop(); if (s) { const t = s._transform; delete s._transform; Object.assign(this, s); this._transform = t; } }
  translate(x, y) { this.transform(1, 0, 0, 1, +x, +y); }
  rotate(angle) {
    const c = Math.cos(+angle), s = Math.sin(+angle);
    this.transform(c, s, -s, c, 0, 0);
  }
  scale(x, y) { this.transform(+x, 0, 0, y === undefined ? +x : +y, 0, 0); }
  setTransform(a, b, c, d, e, f) { this._transform = [+a, +b, +c, +d, +e || 0, +f || 0]; }
  resetTransform() { this._transform = [1, 0, 0, 1, 0, 0]; }
  getTransform() {
    const [a, b, c, d, e, f] = this._transform;
    return {a, b, c, d, e, f, is2D: true, isIdentity: a === 1 && b === 0 && c === 0
      && d === 1 && e === 0 && f === 0,
      get [Symbol.toStringTag]() { return 'DOMMatrix'; },
      multiplySelf() { return this; }, scaleSelf() { return this; },
      translateSelf() { return this; }};
  }
  transform(a, b, c, d, e, f) {
    const [a0, b0, c0, d0, e0, f0] = this._transform;
    this._transform = [
      a0 * +a + c0 * +b, b0 * +a + d0 * +b,
      a0 * +c + c0 * +d, b0 * +c + d0 * +d,
      a0 * (+e || 0) + c0 * (+f || 0) + e0,
      b0 * (+e || 0) + d0 * (+f || 0) + f0];
  }
  createLinearGradient(x0, y0, x1, y1) {
    return this._makeGradient('linear', {_x0:+x0, _y0:+y0, _x1:+x1, _y1:+y1});
  }
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return this._makeGradient('radial', {_x0:+x0, _y0:+y0, _r0:+r0, _x1:+x1, _y1:+y1, _r1:+r1});
  }
  createConicGradient(startAngle, x, y) {
    return this._makeGradient('conic', {_startAngle:+startAngle, _x0:+x, _y0:+y});
  }
  _makeGradient(type, params) {
    const ctx = this;
    const grad = Object.assign({
      _type: type, _stops: [],
      addColorStop(offset, color) {
        offset = +offset;
        if (!(offset >= 0 && offset <= 1)) {
          throw new DOMException("Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite or out of range.", 'IndexSizeError');
        }
        this._stops.push([offset, ctx._parseColor(color)]);
        this._stops.sort((a, b) => a[0] - b[0]);
      },
      get [Symbol.toStringTag]() { return 'CanvasGradient'; },
      _transform: this._transform.slice(),
    }, params);
    return grad;
  }
  createPattern() { return {}; }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
  // Line-dash plus a few path/style methods that charting libraries (Highcharts,
  // ECharts) call on every animation frame. A missing setLineDash threw
  // "is not a function" from a timer each tick, spamming errors (#258).
  setLineDash() {}
  getLineDash() { return []; }
  getContextAttributes() {
    return { alpha: this._alpha, colorSpace: this._colorSpace, colorType: this._colorType,
      desynchronized: this._desynchronized, toneMapping: { mode: 'standard' },
      willReadFrequently: this._willReadFrequently };
  }
}

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
HTMLCanvasElement.prototype.toDataURL = function(type) {
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
HTMLCanvasElement.prototype.toBlob = function(cb, type, q) {
  const blob = _canvasPngBlob(this._ctx || this.getContext('2d'));
  if (blob && type && String(type).toLowerCase() === 'image/png')
    Object.defineProperty(blob, 'type', {value: 'image/png', configurable: true});
  cb(blob);
};
Element.prototype.getBBox = function() { return { x: 0, y: 0, width: 0, height: 0 }; };
Element.prototype.getComputedTextLength = function() { return 0; };
Element.prototype.getExtentOfChar = function(ch) { return { x: 0, y: 0, width: 0, height: 0 }; };
Element.prototype.getSubStringLength = function(ch, len) { return 0; };

_markNative(HTMLCanvasElement.prototype.getContext);
_markNative(HTMLCanvasElement.prototype.toDataURL);
_markNative(HTMLCanvasElement.prototype.toBlob);

Element.prototype.attachShadow = function attachShadow(opts) {
  var _mode = opts == null ? undefined : opts.mode;
  if (_mode !== 'open' && _mode !== 'closed') {
    throw new TypeError('Failed to execute attachShadow on Element: the mode value is not a valid ShadowRootMode.');
  }
  var _ln = (this.localName || '').toLowerCase();
  if (!globalThis.__obscura_shadowHostNames.has(_ln) && _ln.indexOf('-') === -1) {
    throw new DOMException('Failed to execute attachShadow on Element: this element does not support attachShadow', 'NotSupportedError');
  }
  if (Deno.core.ops.op_shadow_root_info(this[_nidSym])) {
    throw new DOMException('Failed to execute attachShadow on Element: the element already hosts a shadow tree.', 'NotSupportedError');
  }
  const rootNid = Deno.core.ops.op_shadow_attach(this[_nidSym], _mode);
  if (rootNid < 0) {
    throw new DOMException('Failed to execute attachShadow on Element: this element does not support attachShadow', 'NotSupportedError');
  }
  const shadow = new ShadowRoot(rootNid, this, opts);
  _treeMutationEpoch++;
  shadow._treeDetachedExact = false;
  shadow[_treeParentSym] = null;
  shadow[_treeParentEpochSym] = _treeMutationEpoch;
  shadow._treeConnected = this.isConnected;
  shadow._treeConnectedEpoch = _treeMutationEpoch;
  _cache.set(rootNid, shadow);
  try {
    const registry = shadow.customElementRegistry;
    const state = _customElementRegistryData(registry);
    state.roots.add(shadow);
    _customElementUpgradeRoot(registry, shadow);
  } catch (_error) {}
  return shadow;
};

_markNative(Element.prototype.attachShadow);

function _shadowRootForHost(host, includeClosed) {
  if (!host) return null;
  const info = Deno.core.ops.op_shadow_root_info(host[_nidSym]);
  if (!info) return null;
  const parts = info.split('\0');
  if (!includeClosed && parts[1] !== 'open') return null;
  const rootNid = +parts[0];
  let root = _cache.get(rootNid);
  if (!(root instanceof ShadowRoot)) {
    root = new ShadowRoot(rootNid, host, { mode: parts[1] });
    _cache.set(rootNid, root);
  }
  return root;
}

Object.defineProperty(Element.prototype, 'shadowRoot', {
  configurable: true,
  enumerable: true,
  get: function () {
    return _shadowRootForHost(this, false);
  },
});

// setHTMLUnsafe / getHTML: shims over innerHTML. setHTMLUnsafe parses markup
// like innerHTML (declarative shadow roots inside are not expanded yet, but the
// call no longer throws so the rest of a test file can run); getHTML serializes
// like innerHTML.
Element.prototype.setHTMLUnsafe = function setHTMLUnsafe(html) { this.innerHTML = String(html == null ? "" : html); };
Element.prototype.getHTML = function getHTML() { return this.innerHTML; };
_markNative(Element.prototype.setHTMLUnsafe);
_markNative(Element.prototype.getHTML);
// Document.parseHTMLUnsafe(html): static that parses into a new HTML document.
if (typeof Document !== 'undefined' && typeof Document.parseHTMLUnsafe !== 'function') {
  Document.parseHTMLUnsafe = function parseHTMLUnsafe(html) {
    return new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");
  };
  _markNative(Document.parseHTMLUnsafe);
}

globalThis.AudioBuffer = class AudioBuffer {
  constructor(opts) {
    var o = (typeof opts === 'object' && opts !== null) ? opts : {};
    this.numberOfChannels = o.numberOfChannels || 1;
    this.length = o.length || 0;
    this.sampleRate = o.sampleRate || 44100;
    this.duration = this.length / (this.sampleRate || 44100);
    this._chs = [];
    for (var c = 0; c < this.numberOfChannels; c++) this._chs.push(new Float32Array(this.length));
  }
  getChannelData(c) { return this._chs[c] || this._chs[0] || new Float32Array(0); }
  copyFromChannel(dst, ch, start) { var s=this._chs[ch]||this._chs[0]; start=start||0; for(var i=0;i<dst.length;i++) dst[i]=(s&&s[start+i])||0; }
  copyToChannel(src, ch, start) { var d=this._chs[ch]||this._chs[0]; start=start||0; if(d) for(var i=0;i<src.length;i++) d[start+i]=src[i]; }
};
globalThis.AudioContext = class AudioContext {
  constructor() { this.sampleRate=_fp('audioSampleRate'); this.state='running'; this.currentTime=0; this.baseLatency=_fp('audioBaseLatency'); this.destination={maxChannelCount:2,numberOfInputs:1,numberOfOutputs:0,channelCount:2}; this._listeners={}; }
  addEventListener(type, fn) { if (!this._listeners[type]) this._listeners[type]=[]; this._listeners[type].push(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type]=this._listeners[type].filter(h=>h!==fn); }
  _ap(v, min=-3.4028235e38, max=3.4028235e38) { return { value: v, defaultValue: v, minValue: min, maxValue: max, setValueAtTime(){} }; }
  createOscillator() { return {context:this,type:'sine',frequency:this._ap(440, -22050, 22050),detune:this._ap(0, -153600, 153600),connect(){},start(){},stop(){},disconnect(){},addEventListener(){},removeEventListener(){}}; }
  createDynamicsCompressor() { return {context:this,threshold:this._ap(_fp('compThreshold'), -100, 0),knee:this._ap(_fp('compKnee'), 0, 40),ratio:this._ap(_fp('compRatio'), 1, 20),attack:this._ap(0.003, 0, 1),release:this._ap(0.25, 0, 1),reduction:0,connect(){},disconnect(){}}; }
  createAnalyser() {
    return {context:this,fftSize:2048,frequencyBinCount:1024,channelCount:2,channelCountMode:'max',channelInterpretation:'speakers',maxDecibels:-30,minDecibels:-100,numberOfInputs:1,numberOfOutputs:1,smoothingTimeConstant:0.8,connect(){},disconnect(){},
      getByteFrequencyData(a){for(let i=0;i<a.length;i++)a[i]=Math.floor(_fpRand(600+i)*10);},
      getFloatFrequencyData(a){for(let i=0;i<a.length;i++)a[i]=-100+_fpRand(700+i)*5;}
    };
  }
  createGain() { return {context:this,gain:this._ap(1),connect(){},disconnect(){}}; }
  createBiquadFilter() { return {context:this,type:'lowpass',frequency:this._ap(350, 0, 22050),Q:this._ap(1, 0.0001, 1000),gain:this._ap(0, -40, 40),connect(){},disconnect(){}}; }
  createBufferSource() { return {context:this,buffer:null,connect(){},start(){},stop(){},disconnect(){},loop:false}; }
  createBuffer(ch,len,rate) { return new globalThis.AudioBuffer({numberOfChannels:ch||1,length:len||0,sampleRate:rate||44100}); }
  createScriptProcessor() { return {connect(){},disconnect(){},onaudioprocess:null}; }
  decodeAudioData(buf) { return Promise.resolve(this.createBuffer(2,44100,44100)); }
  resume() { this.state='running'; return Promise.resolve(); }
  suspend() { this.state='suspended'; return Promise.resolve(); }
  close() { this.state='closed'; return Promise.resolve(); }
};
globalThis.OfflineAudioContext = class OfflineAudioContext extends AudioContext {
  constructor(ch,len,rate) {
    super();
    if (typeof ch === 'object' && ch !== null) {
      this.length = ch.length || 44100;
      this.sampleRate = ch.sampleRate || 44100;
    } else {
      this.length = len || 44100;
      this.sampleRate = rate || 44100;
    }
    this.oncomplete = null;
  }
  startRendering() {
    var self = this;
    var buf = this.createBuffer(1, self.length, 44100);
    var data = buf.getChannelData(0);
    // Simulate compressed triangle wave at 10kHz.
    // Target: sum(|data[4500..5000]|) matches Chrome Linux (~124.04347527516074).
    var target = 124.04347527516074 + (_fpRand(9991) - 0.5) * 0.002;
    var freq = 10000, sr = 44100;
    for (var i = 0; i < self.length; i++) {
      var phase = ((i * freq / sr) % 1 + 1) % 1;
      data[i] = phase < 0.5 ? 4*phase - 1 : 3 - 4*phase;
    }
    var s = 0;
    for (var i = 4500; i < 5000; i++) s += Math.abs(data[i]);
    var scale = s > 0 ? target / s : 0;
    for (var i = 0; i < self.length; i++) data[i] *= scale;
    // Fire oncomplete + 'complete' listeners on next microtask so callers
    // can register handlers synchronously after startRendering().
    var p = Promise.resolve().then(function() {
      var evt = {renderedBuffer: buf, target: self, type: 'complete'};
      if (typeof self.oncomplete === 'function') {
        try { self.oncomplete(evt); } catch(e) {}
      }
      var listeners = (self._listeners && self._listeners['complete']) || [];
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](evt); } catch(e) {}
      }
      return buf;
    });
    return p;
  }
};
