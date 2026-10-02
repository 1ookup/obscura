// Socket-like objects moved to dedicated network modules. This aggregate file
// retains only the older media/DOM fallback surfaces below; the manifest loads
// network/support/socket-listeners.js and the corresponding objects first.

if (typeof ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, heightOrSettings = undefined, settings = undefined) {
      if (arguments.length < 2) {
        throw new TypeError("Failed to construct 'ImageData': 2 arguments required, but only "
          + arguments.length + ' present.');
      }
      const isBytes = dataOrWidth instanceof Uint8ClampedArray;
      const isFloat = typeof Float16Array !== 'undefined'
        && dataOrWidth instanceof Float16Array;
      if (!isBytes && !isFloat && ArrayBuffer.isView(dataOrWidth)) {
        throw new TypeError("Failed to construct 'ImageData': The provided ArrayBufferView is not a supported type.");
      }
      if (isBytes || isFloat) {
        let height = heightOrSettings;
        let resolvedSettings = settings;
        if (heightOrSettings !== undefined && typeof heightOrSettings === 'object') {
          resolvedSettings = heightOrSettings;
          height = undefined;
        }
        const output = _imageDataSettings(resolvedSettings);
        if (isBytes && output.pixelFormat !== 'rgba-unorm8') {
          throw new DOMException("Failed to construct 'ImageData': Uint8ClampedArray must use rgba-unorm8 pixelFormat.",
            'InvalidStateError');
        }
        if (isFloat && output.pixelFormat !== 'rgba-float16') {
          throw new DOMException("Failed to construct 'ImageData': Float16Array must use rgba-float16 pixelFormat.",
            'InvalidStateError');
        }
        const width = Math.trunc(Number(widthOrHeight));
        if (!Number.isFinite(width) || width <= 0) {
          throw new DOMException("Failed to construct 'ImageData': The source width is zero or not a number.",
            'IndexSizeError');
        }
        if (height === undefined) {
          height = dataOrWidth.length / (4 * width);
        }
        const dimensions = _imageDataDimensions(width, height);
        if (dataOrWidth.length !== dimensions[0] * dimensions[1] * 4) {
          throw new DOMException("Failed to construct 'ImageData': The input data length is not a multiple of (4 * width).",
            'IndexSizeError');
        }
        _installImageData(this, dataOrWidth, dimensions[0], dimensions[1],
          output.colorSpace, output.pixelFormat);
        return;
      }
      const dimensions = _imageDataDimensions(dataOrWidth, widthOrHeight);
      const output = _imageDataSettings(heightOrSettings);
      const data = output.pixelFormat === 'rgba-float16'
        ? new Float16Array(dimensions[0] * dimensions[1] * 4)
        : new Uint8ClampedArray(dimensions[0] * dimensions[1] * 4);
      _installImageData(this, data, dimensions[0], dimensions[1],
        output.colorSpace, output.pixelFormat);
    }
    get data() { return _imageData(this).data; }
    get width() { return _imageData(this).width; }
    get height() { return _imageData(this).height; }
    get colorSpace() { return _imageData(this).colorSpace; }
    get pixelFormat() { return _imageData(this).pixelFormat; }
    get [Symbol.toStringTag]() { return 'ImageData'; }
  };
}

if (typeof CanvasRenderingContext2D === 'undefined') {
  globalThis.CanvasRenderingContext2D = class CanvasRenderingContext2D {};
}
if (_Canvas2D.prototype !== globalThis.CanvasRenderingContext2D.prototype) {
  Object.setPrototypeOf(_Canvas2D.prototype, globalThis.CanvasRenderingContext2D.prototype);
}
Object.defineProperty(_Canvas2D.prototype, Symbol.toStringTag, {
  value: 'CanvasRenderingContext2D', configurable: true,
});

if (typeof OffscreenCanvas === 'undefined') {
  const _offscreenCanvasState = new WeakMap();
  const _imageBitmapState = new WeakMap();
  const _bitmapKey = Symbol('ImageBitmap');
  // An `on*` handler slot: assignment sticks, reads answer the last value or
  // null, exactly as the rest of this realm's handler attributes behave.
  const _offscreenCanvasHandler = (canvas, name, value) => {
    const state = _offscreenCanvasState.get(canvas);
    if (!state) throw new TypeError('Illegal invocation');
    state[name] = (typeof value === 'function' || (value && typeof value === 'object')) ? value : null;
    return value;
  };

  globalThis.OffscreenCanvasRenderingContext2D = class OffscreenCanvasRenderingContext2D {
    constructor() { throw new TypeError('Illegal constructor'); }
    get [Symbol.toStringTag]() { return 'OffscreenCanvasRenderingContext2D'; }
  };
  // Chrome's offscreen interface declares the same mixins as the canvas one
  // rather than inheriting from it: its prototype owns all of them (73 members
  // against the canvas interface's 74, the difference being drawFocusIfNeeded)
  // and its parent is Object.prototype. Sharing the canvas prototype instead
  // left the offscreen context with no members of its own, so anything that
  // names a method by the prototype that owns it -- including the native
  // property tracer -- called an offscreen context a canvas context.
  {
    const offscreen = globalThis.OffscreenCanvasRenderingContext2D.prototype;
    for (const name of Object.getOwnPropertyNames(_Canvas2D.prototype)) {
      if (name === 'constructor' || name === 'drawFocusIfNeeded') continue;
      Object.defineProperty(offscreen, name,
        Object.getOwnPropertyDescriptor(_Canvas2D.prototype, name));
    }
    Object.setPrototypeOf(offscreen, Object.prototype);
  }

  globalThis.ImageBitmap = class ImageBitmap {
    constructor(key, width, height, pixels = undefined, colorSpace = 'srgb') {
      if (key !== _bitmapKey) throw new TypeError('Illegal constructor');
      _imageBitmapState.set(this, {width, height, pixels, closed: false});
      // Publish the snapshot for drawImage (canvas.js module scope).
      if (pixels) _imageBitmapPixels.set(this, {pixels, width, height, colorSpace});
    }
    get width() { const state = _imageBitmapState.get(this); return state.closed ? 0 : state.width; }
    get height() { const state = _imageBitmapState.get(this); return state.closed ? 0 : state.height; }
    close() {
      const state = _imageBitmapState.get(this);
      state.closed = true; state.pixels = undefined;
      _imageBitmapPixels.delete(this);
    }
    get [Symbol.toStringTag]() { return 'ImageBitmap'; }
  };


// Diagnostic for the live OffscreenCanvas Illegal invocation pair: a brand
// check that fails means the receiver reached this surface without its
// internal state -- the snapshot names what the receiver actually is
// (toString tag, constructor, prototype chain, own keys) and the stack.
function _reportOffscreenBrand(site, receiver) {
  try {
    if (!(typeof window === 'undefined') && window.external
      && window.external.tracelog) {
      var chain = [];
      var p = receiver;
      for (var i = 0; i < 3 && p; i++) {
        chain.push(p.constructor && p.constructor.name
          ? p.constructor.name : String(p));
        p = Object.getPrototypeOf(p);
      }
      var stack = '';
      try { stack = String(new Error().stack || '').slice(0, 600); } catch (_e) {}
      window.external.tracelog('oc-brand', JSON.stringify({
        site: site,
        toStr: Object.prototype.toString.call(receiver),
        ctor: receiver && receiver.constructor && receiver.constructor.name,
        chain: chain.join('>'),
        keys: receiver ? Object.getOwnPropertyNames(receiver).slice(0, 8).join(',') : '',
        stack: stack,
      }));
    }
  } catch (_report) {}
}

  globalThis.OffscreenCanvas = class OffscreenCanvas extends EventTarget {
    constructor(width, height) {
      super();
      if (arguments.length < 2) {
        throw new TypeError("Failed to construct 'OffscreenCanvas': 2 arguments required, but only "
          + arguments.length + ' present.');
      }
      width = Math.max(0, Math.trunc(Number(width)) || 0);
      height = Math.max(0, Math.trunc(Number(height)) || 0);
      _offscreenCanvasState.set(this, {
        width, height, context: null, contextType: null,
        oncontextlost: null, oncontextrestored: null,
      });
    }
    get width() {
      const state = _offscreenCanvasState.get(this);
      if (!state) {
        _reportOffscreenBrand('width.get', this);
        throw new TypeError('Illegal invocation');
      }
      return state.width;
    }
    set width(value) {
      const state = _offscreenCanvasState.get(this);
      if (!state) {
        _reportOffscreenBrand('width.set', this);
        throw new TypeError('Illegal invocation');
      }
      state.width = Math.max(0, Math.trunc(Number(value)) || 0);
      if (state.context) _canvas2dResizeFromCanvas(state.context);
    }
    get height() {
      const state = _offscreenCanvasState.get(this);
      if (!state) {
        _reportOffscreenBrand('height.get', this);
        throw new TypeError('Illegal invocation');
      }
      return state.height;
    }
    set height(value) {
      const state = _offscreenCanvasState.get(this);
      if (!state) {
        _reportOffscreenBrand('height.set', this);
        throw new TypeError('Illegal invocation');
      }
      state.height = Math.max(0, Math.trunc(Number(value)) || 0);
      if (state.context) _canvas2dResizeFromCanvas(state.context);
    }
    // Chrome's OffscreenCanvas has no getAttribute; the context reads
    // width/height off this surface as properties (see _canvasSizeAttribute).
    // The two context handlers are real attributes here, in Chrome's slots.
    get oncontextlost() { return _offscreenCanvasState.get(this).oncontextlost; }
    set oncontextlost(value) { _offscreenCanvasHandler(this, 'oncontextlost', value); }
    get oncontextrestored() { return _offscreenCanvasState.get(this).oncontextrestored; }
    set oncontextrestored(value) { _offscreenCanvasHandler(this, 'oncontextrestored', value); }
    getContext(type, attrs = undefined) {
      const state = _offscreenCanvasState.get(this);
      // The argument is an OffscreenRenderingContextType enum, not the
      // free-form string HTMLCanvasElement.getContext takes. WebIDL matches
      // enum members case-sensitively, so `'WebGL'` and the legacy
      // `'experimental-webgl'` alias the element still honours both raise a
      // TypeError here instead of the null an unknown element context id
      // gets. An absent argument is required-argument arity, which fails
      // before the enum is read.
      if (arguments.length < 1) {
        throw new TypeError("Failed to execute 'getContext' on 'OffscreenCanvas': "
          + '1 argument required, but only 0 present.');
      }
      type = String(type);
      if (type !== '2d' && type !== 'bitmaprenderer' && type !== 'webgl'
          && type !== 'webgl2' && type !== 'webgpu') {
        throw new TypeError(
          'Failed to execute \'getContext\' on \'OffscreenCanvas\': The provided value \''
          + type + '\' is not a valid enum value of type OffscreenRenderingContextType.');
      }
      if (type === 'webgl' || type === 'webgl2') {
        // The context-creation dictionary is converted before the method body
        // runs, so an invalid powerPreference rejects even a surface whose
        // request would otherwise answer null. Chrome's OffscreenCanvas names
        // the shared mixin, not the element's WebGLContextAttributes.
        const powerPreference = attrs && typeof attrs === 'object'
          ? attrs.powerPreference : undefined;
        if (powerPreference !== undefined && powerPreference !== 'default'
            && powerPreference !== 'low-power'
            && powerPreference !== 'high-performance') {
          throw new TypeError(
            'Failed to execute \'getContext\' on \'OffscreenCanvas\': Failed to read '
            + 'the \'powerPreference\' property from \'CanvasContextCreationAttributesModule\': The '
            + 'provided value \'' + powerPreference + '\' is not a valid enum value '
            + 'of type CanvasPowerPreference.');
        }
        // Chrome's OffscreenCanvas runs the same WebGL families as a canvas
        // element: the context is cached per surface, the families are
        // mutually exclusive, and the attributes of the first call are what
        // getContextAttributes keeps reporting.
        if (state.contextType !== null && state.contextType !== type) return null;
        if (!globalThis.__obscura_webgl_enabled) return null;
        if (!state.context) {
          state.context = type === 'webgl2'
            ? new globalThis.WebGL2RenderingContext(this, true, attrs)
            : new globalThis.WebGLRenderingContext(this, false, attrs);
          state.contextType = type;
        }
        return state.context;
      }
      if (type === 'webgpu') {
        // navigator.gpu is [Exposed=(Window,Worker)], and the offscreen
        // canvas offers the WebGPU family in a worker exactly as the element
        // does in a document.
        if (state.contextType !== null && state.contextType !== type) return null;
        if (!globalThis.__obscura_webgl_enabled || !globalThis.GPUCanvasContext) return null;
        if (!state.context) {
          state.context = new globalThis.GPUCanvasContext(this);
          state.contextType = type;
        }
        return state.context;
      }
      if (state.contextType !== null && state.contextType !== type) return null;
      // `bitmaprenderer` is a recognised member this layer does not
      // implement, so it answers the null a rejected family gets.
      if (type !== '2d') return null;
      if (!state.context) {
        state.context = new _Canvas2D(this, attrs);
        Object.setPrototypeOf(state.context,
          globalThis.OffscreenCanvasRenderingContext2D.prototype);
        state.contextType = type;
        // Publish the context for drawImage (canvas.js module scope).
        _offscreenCanvasContexts.set(this, state.context);
      }
      return state.context;
    }
    convertToBlob() {
      const state = _offscreenCanvasState.get(this);
      // Chrome validates the size before the rendering context, so a
      // zero-sized surface reports IndexSizeError even when it has none.
      if (state.width === 0 || state.height === 0) {
        return Promise.reject(new DOMException(
          "Failed to execute 'convertToBlob' on 'OffscreenCanvas': The size of the OffscreenCanvas is zero.",
          'IndexSizeError'));
      }
      if (!state.context) {
        return Promise.reject(new DOMException(
          "Failed to execute 'convertToBlob' on 'OffscreenCanvas': The OffscreenCanvas has no rendering context.",
          'InvalidStateError'));
      }
      if (!_isCanvas2DContext(state.context)) {
        // A WebGL surface has no CPU-side 2D buffer to encode here; Chrome
        // snapshots the drawing buffer, which this consistency layer does
        // not paint. A blank PNG keeps the promise shape intact.
        return Promise.resolve(_canvasPngBlob(
          new _Canvas2D({ width: state.width, height: state.height })));
      }
      return Promise.resolve(_canvasPngBlob(state.context));
    }
    transferToImageBitmap() {
      const state = _offscreenCanvasState.get(this);
      // A surface with no rendering context has no bitmap to hand over;
      // Chrome raises InvalidStateError rather than minting a blank one.
      if (!state.context) {
        throw new DOMException(
          "Failed to execute 'transferToImageBitmap' on 'OffscreenCanvas': "
          + 'Cannot transfer an ImageBitmap from an OffscreenCanvas with no context',
          'InvalidStateError');
      }
      const context = state.context && _canvas2dPixels(state.context)
        ? state.context
        : this.getContext('2d');
      const pixels = context && _canvas2dPixels(context)
        ? _canvas2dPixels(context).slice()
        : new Uint8ClampedArray(state.width * state.height * 4);
      // _buf is the srgb unorm8 renderer buffer, whatever the canvas's own
      // color space is, so the snapshot is tagged srgb.
      const bitmap = new globalThis.ImageBitmap(_bitmapKey, state.width, state.height,
        pixels, 'srgb');
      if (context) _canvas2dResizeFromCanvas(context);
      return bitmap;
    }
    get [Symbol.toStringTag]() { return 'OffscreenCanvas'; }
  };
  // Chrome lists `constructor` last on both offscreen prototypes and marks the
  // rest of the members enumerable; a class body emits it first and hides them.
  const _parkOffscreenPrototype = (prototype, order) => {
    const current = Object.getOwnPropertyNames(prototype);
    const wanted = order.filter(name => current.indexOf(name) >= 0);
    const extras = current.filter(name => wanted.indexOf(name) < 0);
    const descriptors = new Map();
    for (const name of current) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (name !== 'constructor' && !descriptor.enumerable) descriptor.enumerable = true;
      descriptors.set(name, descriptor);
    }
    for (const name of wanted.concat(extras)) {
      try { delete prototype[name]; } catch (_error) {}
    }
    for (const name of wanted.concat(extras)) {
      if (descriptors.has(name)) {
        try { Object.defineProperty(prototype, name, descriptors.get(name)); } catch (_error) {}
      }
    }
  };
  _parkOffscreenPrototype(globalThis.OffscreenCanvas.prototype,
    ['width', 'height', 'oncontextlost', 'oncontextrestored', 'convertToBlob',
      'getContext', 'transferToImageBitmap', 'constructor']);
  // The offscreen context lists the same members as the canvas prototype minus
  // drawFocusIfNeeded, and it lists `getContextAttributes` last rather than
  // between fillText and getImageData -- both measured, so the canvas order is
  // shifted into the offscreen one here rather than duplicated.
  const _offscreenContextOrder = _CHROME_CANVAS_2D_MEMBER_ORDER
    .filter(name => name !== 'getContextAttributes');
  _offscreenContextOrder.splice(
    _offscreenContextOrder.indexOf('constructor'), 0, 'getContextAttributes');
  _parkOffscreenPrototype(globalThis.OffscreenCanvasRenderingContext2D.prototype,
    _offscreenContextOrder);

  globalThis.createImageBitmap = _markNative(async function createImageBitmap(source, ...crop) {
    let width = 0, height = 0, pixels, colorSpace = 'srgb';
    const offscreen = _offscreenCanvasState.get(source);
    if (offscreen) {
      const context = offscreen.context || source.getContext('2d');
      width = offscreen.width; height = offscreen.height;
      // _buf is the srgb unorm8 renderer buffer regardless of canvas space.
      pixels = context && _canvas2dPixels(context) ? _canvas2dPixels(context).slice() : undefined;
    } else if (source && _isCanvas2DContext(source._ctx)) {
      [width, height] = _canvas2dPixelSize(source._ctx);
      pixels = _canvas2dPixels(source._ctx).slice();
    } else if (_imageDataState.has(source)) {
      const image = _imageData(source);
      width = image.width; height = image.height; colorSpace = image.colorSpace;
      if (image.pixelFormat !== 'rgba-float16') pixels = image.data.slice();
    } else if (source instanceof Blob) {
      const bytes = new Uint8Array(await source.arrayBuffer());
      if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50
          && bytes[2] === 0x4e && bytes[3] === 0x47) {
        width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
        height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
      } else {
        throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      }
    } else {
      throw new TypeError("Failed to execute 'createImageBitmap': The provided value is not an image source.");
    }
    // The arguments are either `(sx, sy, sw, sh, options)` or `(options)`, and
    // the options dictionary carries the resize Chrome applies after the crop
    // (measured: a 5x4 crop resized to 11x12 answers 11x12, and a resize
    // without a crop answers the resized size).
    let options = null;
    if (crop.length >= 4) {
      const left = Math.trunc(Number(crop[0]));
      const top = Math.trunc(Number(crop[1]));
      const cropWidth = Math.abs(Math.trunc(Number(crop[2])));
      const cropHeight = Math.abs(Math.trunc(Number(crop[3])));
      options = crop[4] && typeof crop[4] === 'object' ? crop[4] : null;
      const resized = _canvasBitmapResize(options);
      if (pixels) {
        [width, height, pixels] = _canvasBitmapSample(
          pixels, width, height, left, top, cropWidth, cropHeight, resized);
      } else {
        width = cropWidth; height = cropHeight;
      }
    } else {
      options = crop[0] && typeof crop[0] === 'object' ? crop[0] : null;
      const resized = _canvasBitmapResize(options);
      if (pixels && resized) {
        [width, height, pixels] = _canvasBitmapSample(
          pixels, width, height, 0, 0, width, height, resized);
      }
    }
    return new globalThis.ImageBitmap(_bitmapKey, width, height, pixels, colorSpace);
  });
  // The requested output size, or null when the dictionary does not ask for one.
  const _canvasBitmapResize = options => {
    if (!options) return null;
    const width = Math.trunc(Number(options.resizeWidth));
    const height = Math.trunc(Number(options.resizeHeight));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return [width, height];
  };
  // Crop (and optionally resize) a pixel buffer. Sampling is nearest-neighbour
  // at pixel centres; Chrome resamples with a filter, so the values of a
  // resized bitmap are close but not identical (documented residual).
  const _canvasBitmapSample = (pixels, sourceWidth, sourceHeight, left, top,
                                cropWidth, cropHeight, resized) => {
    const outWidth = resized ? resized[0] : cropWidth;
    const outHeight = resized ? resized[1] : cropHeight;
    // Pixels the crop rectangle reaches past the source stay transparent
    // black: measured Chrome answers 00000000 for the out-of-bounds half of
    // a partially off-canvas crop, where clamping to the edge pixel filled
    // them with copied colour (and a probe that expects the transparent half
    // fails its own check -- the shape behind the tUxL6 fallback).
    const out = new Uint8ClampedArray(outWidth * outHeight * 4);
    for (let y = 0; y < outHeight; y++) {
      const sourceY = top + Math.floor((y + 0.5) * cropHeight / outHeight);
      if (sourceY < 0 || sourceY >= sourceHeight) continue;
      for (let x = 0; x < outWidth; x++) {
        const sourceX = left + Math.floor((x + 0.5) * cropWidth / outWidth);
        if (sourceX < 0 || sourceX >= sourceWidth) continue;
        const from = (sourceY * sourceWidth + sourceX) * 4;
        const to = (y * outWidth + x) * 4;
        out[to] = pixels[from];
        out[to + 1] = pixels[from + 1];
        out[to + 2] = pixels[from + 2];
        out[to + 3] = pixels[from + 3];
      }
    }
    return [outWidth, outHeight, out];
  };
}

if (typeof Path2D === 'undefined') {
  // The path model records segments into a per-instance slot the canvas
  // pipeline can consume later; nothing here rasterizes. Arguments go through
  // the WebIDL double conversion so a string "10" behaves like 10 and a
  // missing count degrades the way the canvas methods next door degrade.
  const _path2dSegments = new WeakMap();
  const _path2dSegs = (p) => {
    let segs = _path2dSegments.get(p);
    if (!segs) { segs = []; _path2dSegments.set(p, segs); }
    return segs;
  };
  const _num = (v) => +v;
  // Zero-arity segments first, then the arity families in Chrome's own-key
  // order -- the install sequence below is the prototype's own-key order.
  const _path2dMembers = [
    ['addPath', function addPath(path) {
      if (path) for (const seg of _path2dSegs(path)) _path2dSegs(this).push(seg);
    }],
    ['roundRect', function roundRect(x, y, w, h, radii) {
      _path2dSegs(this).push(['roundRect', _num(x), _num(y), _num(w), _num(h), _num(radii || 0)]);
    }],
    ['arc', function arc(x, y, radius, startAngle, endAngle, counterclockwise) {
      _path2dSegs(this).push(['arc', _num(x), _num(y), _num(radius), _num(startAngle || 0), _num(endAngle || 0), Boolean(counterclockwise)]);
    }],
    ['arcTo', function arcTo(x1, y1, x2, y2, radius) {
      _path2dSegs(this).push(['arcTo', _num(x1), _num(y1), _num(x2), _num(y2), _num(radius)]);
    }],
    ['bezierCurveTo', function bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      _path2dSegs(this).push(['bezierCurveTo', _num(cp1x), _num(cp1y), _num(cp2x), _num(cp2y), _num(x), _num(y)]);
    }],
    ['closePath', function closePath() { _path2dSegs(this).push(['closePath']); }],
    ['ellipse', function ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise) {
      _path2dSegs(this).push(['ellipse', _num(x), _num(y), _num(radiusX), _num(radiusY), _num(rotation || 0), _num(startAngle || 0), _num(endAngle || 0), Boolean(counterclockwise)]);
    }],
    ['lineTo', function lineTo(x, y) { _path2dSegs(this).push(['lineTo', _num(x), _num(y)]); }],
    ['moveTo', function moveTo(x, y) { _path2dSegs(this).push(['moveTo', _num(x), _num(y)]); }],
    ['quadraticCurveTo', function quadraticCurveTo(cpx, cpy, x, y) {
      _path2dSegs(this).push(['quadraticCurveTo', _num(cpx), _num(cpy), _num(x), _num(y)]);
    }],
    ['rect', function rect(x, y, w, h) {
      _path2dSegs(this).push(['rect', _num(x), _num(y), _num(w), _num(h)]);
    }],
  ];
  const Path2DCtor = { Path2D: class Path2D {
    constructor(path) {
      if (path) for (const seg of _path2dSegs(path)) _path2dSegs(this).push(seg);
    }
  } }.Path2D;
  for (const [name, fn] of _path2dMembers) {
    Object.defineProperty(Path2DCtor.prototype, name, {
      value: fn, writable: true, enumerable: true, configurable: true,
    });
  }
  globalThis.Path2D = Path2DCtor;
}

if (typeof ImageBitmap === 'undefined') {
  globalThis.ImageBitmap = class ImageBitmap { constructor(){this.width=0;this.height=0;} close(){} };
  globalThis.createImageBitmap = _markNative(function createImageBitmap() {
    return Promise.resolve(new ImageBitmap());
  });
}

if (typeof Selection === 'undefined') {
  globalThis.Selection = class Selection {
    constructor(){this.anchorNode=null;this.focusNode=null;this.rangeCount=0;this.isCollapsed=true;this.type='None';}
    getRangeAt(){return null;} collapse(){} extend(){} selectAllChildren(){} deleteFromDocument(){}
    addRange(){} removeRange(){} removeAllRanges(){} toString(){return '';}
  };
}

if (typeof TreeWalker === 'undefined') {
  globalThis.TreeWalker = class TreeWalker {
    constructor(root){this.root=root;this.currentNode=root;this.whatToShow=0xFFFFFFFF;this.filter=null;}
    parentNode(){return this.currentNode?.parentNode||null;}
    firstChild(){return this.currentNode?.firstChild||null;}
    lastChild(){return this.currentNode?.lastChild||null;}
    previousSibling(){return this.currentNode?.previousSibling||null;}
    nextSibling(){return this.currentNode?.nextSibling||null;}
    nextNode(){return null;} previousNode(){return null;}
  };
}

if (typeof Range === 'undefined') {
  globalThis.Range = class Range {
    constructor(){this.startContainer=null;this.startOffset=0;this.endContainer=null;this.endOffset=0;this.collapsed=true;this.commonAncestorContainer=null;}
    setStart(n,o){this.startContainer=n;this.startOffset=o;} setEnd(n,o){this.endContainer=n;this.endOffset=o;}
    collapse(){} selectNode(){} selectNodeContents(){} cloneContents(){return document?.createDocumentFragment();}
    deleteContents(){} insertNode(){} getBoundingClientRect(){return new DOMRect();}
    getClientRects(){return OBSCURA_DOM_RECT_LIST([]);} cloneRange(){return new Range();} toString(){return '';}
  };
}

if (typeof FontFace === 'undefined') {
  const _fontFaceString = value => String(value ?? '');
  const _fontFaceBytesBase64 = bytes => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
      out += alphabet[a >> 2];
      out += alphabet[((a & 3) << 4) | (b >> 4)];
      out += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
      out += i + 2 < bytes.length ? alphabet[c & 63] : '=';
    }
    return out;
  };
  // The shallow font-container check behind `status` for a BufferSource
  // source. Chrome parses the data; this reads the container header only. The
  // two cases a probe takes are both right -- a buffer that is not a font
  // answers 'error' and rejects, a real font answers 'loaded' -- while a
  // container whose directory is plausible but whose tables are truncated
  // still passes here and is rejected by Chrome (documented residual).
  const _fontFaceContainerValid = bytes => {
    if (!bytes || bytes.length < 12) return false;
    const u16 = offset => (bytes[offset] << 8) | bytes[offset + 1];
    const u32 = offset => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16)
      + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
    const magic = u32(0);
    if (magic === 0x74746366) {                       // 'ttcf': a collection
      const fonts = u32(8);
      return fonts > 0 && 12 + fonts * 4 <= bytes.length;
    }
    if (magic === 0x774f4646 || magic === 0x774f4632) {   // 'wOFF' / 'wOF2'
      return u32(4) === 0x00010000 && u16(12) > 0;
    }
    if (magic === 0x00010000 || magic === 0x74727565    // sfnt, 'true',
        || magic === 0x74797031 || magic === 0x4f54544f) {  // 'typ1', 'OTTO'
      const tables = u16(4);
      return tables > 0 && 12 + tables * 16 <= bytes.length;
    }
    return false;
  };
  // `parseError` carries the raw source text Chrome puts in the message a
  // source that is not a value list produces at load(); the constructor does
  // not throw for it (measured: `new FontFace('X', '')` answers status
  // 'error', and only load() rejects).
  const _fontFaceSource = source => {
    if (typeof source === 'string') {
      return {
        css: source,
        binary: false,
        bytes: null,
        parseError: /local\s*\(|url\s*\(/i.test(source) ? null : source,
      };
    }
    let bytes;
    if (source instanceof ArrayBuffer) {
      bytes = new Uint8Array(source.slice(0));
    } else if (ArrayBuffer.isView(source)) {
      bytes = new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
    } else {
      throw new TypeError('FontFace source must be a CSS source string or BufferSource');
    }
    return {
      css: 'url("data:font/ttf;base64,' + _fontFaceBytesBase64(bytes) + '")',
      binary: true,
      bytes,
      parseError: null,
    };
  };
  const _fontFaceDescriptor = (descriptors, name, fallback) =>
    descriptors && descriptors[name] !== undefined ? String(descriptors[name]) : fallback;
  const _fontFaceDeclarations = block => {
    const declarations = Object.create(null);
    let start = 0, depth = 0, quote = '', escaped = false;
    const commit = end => {
      const declaration = block.slice(start, end);
      const colon = declaration.indexOf(':');
      if (colon > 0) declarations[declaration.slice(0, colon).trim().toLowerCase()] =
        declaration.slice(colon + 1).trim();
    };
    for (let i = 0; i <= block.length; i++) {
      const ch = block[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if ((ch === ';' && depth === 0) || i === block.length) {
        commit(i);
        start = i + 1;
      }
    }
    return declarations;
  };
  const _fontFaceAuthoredRules = doc => {
    const out = [];
    for (const style of _internalQuerySelectorAll(doc, 'style')) {
      const css = style.textContent || '';
      const pattern = /@font-face\s*\{([\s\S]*?)\}/gi;
      let match;
      while ((match = pattern.exec(css))) {
        const declarations = _fontFaceDeclarations(match[1]);
        const family = (declarations['font-family'] || '').trim().replace(/^(['"])(.*)\1$/, '$2');
        const source = declarations.src || '';
        if (!family || !source) continue;
        out.push({
          family,
          source,
          descriptors: {
            style: declarations['font-style'] || 'normal',
            weight: declarations['font-weight'] || 'normal',
            stretch: declarations['font-stretch'] || 'normal',
            unicodeRange: declarations['unicode-range'] || 'U+0-10FFFF',
            variant: declarations['font-variant'] || 'normal',
            featureSettings: declarations['font-feature-settings'] || 'normal',
            variationSettings: declarations['font-variation-settings'] || 'normal',
            display: declarations['font-display'] || 'auto',
            ascentOverride: declarations['ascent-override'] || 'normal',
            descentOverride: declarations['descent-override'] || 'normal',
            lineGapOverride: declarations['line-gap-override'] || 'normal',
            sizeAdjust: declarations['size-adjust'] || '100%'
          }
        });
      }
    }
    return out;
  };
  // The first `local()` family in a source that this machine does not have,
  // or null when every one of them is available.
  //
  // Availability is decided by measuring rather than by a second list: the
  // renderer already resolves an unknown named family by skipping it, so a
  // family that survives being measured against two different generics is one
  // the renderer actually has. Keeping the answer on that side means the two
  // can never disagree about which fonts exist.
  //
  // A macOS identity answers from a name list instead, because `local()`
  // matches a font's own names and not its family name: the oracle loads
  // `local("Menlo Regular")` and rejects `local("Menlo")`, loads
  // `local("Skia Regular")` and rejects `local("Skia")`, while a font whose
  // full name equals its family name ("Geneva", "Apple Symbols", "Verdana")
  // answers for both. Measuring cannot tell those two apart, and the
  // challenge's font probe reads exactly this surface: its reference answer is
  // the six names of the list below that this machine has.
  const _MACOS_LOCAL_FACES = {
    'andale mono': [''],
    'apple symbols': [''],
    'arial': ['', 'Bold', 'Bold Italic', 'Italic'],
    'arial black': [''],
    'arial narrow': ['', 'Bold', 'Bold Italic', 'Italic'],
    'avenir': ['Black', 'Heavy', 'Light', 'Medium'],
    'avenir next': ['Bold', 'Bold Italic', 'Heavy', 'Italic', 'Medium', 'Regular'],
    'baskerville': ['', 'Bold', 'Bold Italic', 'Italic', 'Semibold'],
    'bodoni 72': ['Bold'],
    'chalkboard': ['', 'Bold'],
    'charter': ['Black', 'Bold', 'Bold Italic', 'Italic'],
    'cochin': ['', 'Bold', 'Bold Italic', 'Italic'],
    'comic sans ms': ['', 'Bold'],
    'courier new': ['', 'Bold', 'Bold Italic', 'Italic'],
    'didot': ['', 'Bold', 'Italic'],
    'futura': ['Bold', 'Medium'],
    'galvji': ['', 'Bold'],
    'geneva': [''],
    'georgia': ['', 'Bold', 'Bold Italic', 'Italic'],
    'gill sans': ['', 'Bold', 'Bold Italic', 'Italic', 'Light', 'Semibold'],
    'hannotate sc': ['Bold', 'Regular'],
    'heiti sc': ['Light', 'Medium'],
    'helvetica': ['', 'Bold', 'Light'],
    'helvetica neue': ['', 'Bold', 'Bold Italic', 'Italic', 'Light', 'Medium', 'Thin'],
    'hoefler text': ['', 'Black', 'Italic'],
    'inaimathi': ['', 'Bold'],
    'kaiti sc': ['Black', 'Bold', 'Regular'],
    'lantinghei sc': ['Heavy'],
    'libian sc': ['Regular'],
    'lucida grande': ['', 'Bold'],
    'luminari': [''],
    'marker felt': ['Thin'],
    'menlo': ['Bold', 'Bold Italic', 'Italic', 'Regular'],
    'monaco': [''],
    'optima': ['Bold', 'Bold Italic', 'Italic', 'Regular'],
    'palatino': ['', 'Bold', 'Bold Italic', 'Italic'],
    'pingfang hk': ['Light', 'Medium', 'Regular', 'Semibold', 'Thin'],
    'pingfang sc': ['Light', 'Medium', 'Regular', 'Semibold', 'Thin'],
    'pingfang tc': ['Light', 'Medium', 'Regular', 'Semibold', 'Thin'],
    'pt sans': ['', 'Bold', 'Bold Italic', 'Italic'],
    'skia': ['Black', 'Bold', 'Light', 'Regular'],
    'songti sc': ['Black', 'Bold', 'Light', 'Regular'],
    'superclarendon': ['Black', 'Bold', 'Bold Italic', 'Italic', 'Light', 'Regular'],
    'tahoma': ['', 'Bold'],
    'times': ['Bold', 'Bold Italic', 'Italic'],
    'times new roman': ['', 'Bold', 'Bold Italic', 'Italic'],
    'trebuchet ms': ['', 'Bold', 'Bold Italic', 'Italic'],
    'verdana': ['', 'Bold', 'Bold Italic', 'Italic'],
    'wawati sc': ['Regular'],
    'webdings': [''],
    'weibei sc': ['Bold'],
    'wingdings': [''],
    'xingkai sc': ['Bold', 'Light'],
    'yuanti sc': ['Bold', 'Light', 'Regular'],
  };
  // The names those fonts answer to that are not family plus face: the
  // PostScript spellings, and the macOS faces this identity otherwise does not
  // name (they resolve here the way the reference's do).
  const _MACOS_LOCAL_ALIASES = [
    'apple color emoji', 'applecoloremoji', 'applegothic', 'arialmt', 'chalkduster',
    'helveticaneue', 'herculanum', 'kokonor', 'papyrus', 'stheiti', 'stsong',
    'timesnewromanpsmt', 'zapfino',
  ];
  let _macosLocalNames;
  const _macosLocalNameSet = () => {
    if (_macosLocalNames !== undefined) return _macosLocalNames;
    let names = null;
    try {
      const platform = String((_fingerprint().navigatorPlatform) || '').toLowerCase();
      // An identity that has not been installed yet is not a non-macOS one:
      // answering "measure instead" here would stick for the life of the
      // realm, so only a named platform decides.
      if (!platform) return null;
      if (platform.includes('mac') || platform.includes('darwin')) {
        names = new Set(_MACOS_LOCAL_ALIASES);
        for (const family of Object.keys(_MACOS_LOCAL_FACES)) {
          for (const face of _MACOS_LOCAL_FACES[family]) {
            names.add(face ? (family + ' ' + face).toLowerCase() : family);
          }
        }
      }
    } catch (_error) { names = null; }
    _macosLocalNames = names;
    return names;
  };
  const _fontFaceLocalSourceMissing = source => {
    const text = String(source == null ? '' : source);
    const locals = text.match(/local\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi);
    if (!locals) return null;
    for (const entry of locals) {
      const family = entry
        .replace(/^local\(\s*/i, '').replace(/\s*\)$/, '').trim()
        .replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
      if (family && !_localFontAvailable(family)) return family;
    }
    return null;
  };
  const _localFontCache = new Map();
  const _localFontAvailable = family => {
    const key = family.toLowerCase();
    if (_localFontCache.has(key)) return _localFontCache.get(key);
    let available = false;
    try {
      const macos = _macosLocalNameSet();
      if (macos !== null) {
        _localFontCache.set(key, macos.has(key));
        return macos.has(key);
      }
      const context = (_localFontAvailable._canvas
        || (_localFontAvailable._canvas = document.createElement('canvas'))).getContext('2d');
      const quoted = '"' + family.replace(/"/g, '\\"') + '"';
      const width = generic => {
        context.font = '72px ' + quoted + ', ' + generic;
        return context.measureText('mmmmmmmmmmlli').width;
      };
      // An absent family falls through to whichever generic follows it, so the
      // two measurements differ. A present one overrides both, so they agree.
      available = width('monospace') === width('sans-serif');
    } catch (_error) {}
    _localFontCache.set(key, available);
    return available;
  };

  const _fontFaceSelection = font => {
    const value = String(font);
    const size = /(?:^|\s)(?:\d*\.?\d+)(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i.exec(value);
    if (!size) throw new DOMException('Invalid font shorthand', 'SyntaxError');
    const family = size[1].split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();
    const prefix = value.slice(0, size.index + size[0].length - size[1].length).toLowerCase();
    const weight = /\b(?:[1-9]00|bold)\b/.exec(prefix)?.[0] || 'normal';
    const style = /\b(?:italic|oblique)\b/.exec(prefix)?.[0] || 'normal';
    return { family, weight: weight === 'bold' ? 700 : weight === 'normal' ? 400 : +weight, style };
  };
  const _fontFaceMatches = (face, selection) => {
    if (face.family.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase() !== selection.family) return false;
    const faceWeight = face.weight.toLowerCase() === 'bold' ? 700 :
      face.weight.toLowerCase() === 'normal' ? 400 : +face.weight;
    const italic = face.style.toLowerCase() !== 'normal';
    return Math.abs(faceWeight - selection.weight) < 350 && italic === (selection.style !== 'normal');
  };

  // ---------------------------------------------------------------------
  // FontFace.
  //
  // Every internal slot lives in a WeakMap: Chrome's `new FontFace(...)` has
  // no own properties at all (`Object.getOwnPropertyNames(face)` is []), and
  // the four `_`-prefixed helpers this class used to carry were prototype
  // members Chrome does not have. The prototype's member set, order and
  // descriptor kinds are the ones measured on the local oracle (149).
  // ---------------------------------------------------------------------
  const _fontFaceState = new WeakMap();
  const _fontFaceStateOf = face => {
    const state = _fontFaceState.get(face);
    if (!state) throw new TypeError('Illegal invocation');
    return state;
  };
  const _fontFaceAttach = (face, set) => { _fontFaceStateOf(face).sets.add(set); };
  const _fontFaceDetach = (face, set) => { _fontFaceStateOf(face).sets.delete(set); };
  const _fontFaceMarkCssConnected = face => { _fontFaceStateOf(face).cssConnected = true; };
  const _fontFaceIsCssConnected = face => !!_fontFaceStateOf(face).cssConnected;
  const _fontFaceCssSource = face => _fontFaceStateOf(face).source;
  const _fontFaceNotifySets = face => {
    const state = _fontFaceState.get(face);
    if (!state) return;
    for (const set of state.sets) _fontFaceSetFaceChanged(set, face);
  };
  // The `loaded` promise is created on first read and settles with whatever
  // the status already is, so `face.loaded` on an errored face rejects the
  // same way `load()` does (measured). A sink keeps that rejection from
  // reaching the engine's unhandled-rejection reporting when a page only
  // reads the property.
  const _fontFaceLoaded = face => {
    const state = _fontFaceStateOf(face);
    if (!state.loadedPromise) {
      state.loadedPromise = new Promise((resolve, reject) => {
        state.resolveLoaded = resolve;
        state.rejectLoaded = reject;
      });
      state.loadedPromise.catch(() => {});
      if (state.status === 'loaded') state.resolveLoaded(face);
      else if (state.status === 'error') state.rejectLoaded(state.failure);
    }
    return state.loadedPromise;
  };
  const _fontFaceFail = (face, error) => {
    const state = _fontFaceStateOf(face);
    state.status = 'error';
    state.failure = error;
    const existing = !!state.loadedPromise;
    _fontFaceLoaded(face);
    if (existing) state.rejectLoaded?.(error);
    _fontFaceNotifySets(face);
  };
  const _fontFaceSetDescriptor = (face, slot, value) => {
    _fontFaceStateOf(face)[slot] = String(value);
    _fontFaceNotifySets(face);
  };
  const _fontFaceLoad = face => {
    const state = _fontFaceStateOf(face);
    const loaded = _fontFaceLoaded(face);
    if (state.status !== 'unloaded') return loaded;
    state.status = 'loading';
    _fontFaceNotifySets(face);
    Promise.resolve().then(() => {
      if (state.status !== 'loading') return;
      const missing = _fontFaceLocalSourceMissing(state.source);
      if (missing !== null) {
        _fontFaceFail(face, new DOMException('A network error occurred.', 'NetworkError'));
        return;
      }
      state.status = 'loaded';
      state.resolveLoaded?.(face);
      _fontFaceNotifySets(face);
    });
    return loaded;
  };
  // Chrome's member order for the prototype, measured on the oracle: the
  // CSSOM descriptors, then sizeAdjust, status, loaded, load, and
  // variationSettings after load. The class body emits the accessors in the
  // order below, and `constructor` is parked into the last slot afterwards.
  const _chromeFontFaceMemberOrder = [
    'family', 'style', 'weight', 'stretch', 'unicodeRange', 'variant',
    'featureSettings', 'display', 'ascentOverride', 'descentOverride',
    'lineGapOverride', 'sizeAdjust', 'status', 'loaded', 'load',
    'variationSettings', 'constructor',
  ];
  globalThis.FontFace = class FontFace {
    constructor(family, source, descriptors={}) {
      if (arguments.length < 2) throw new TypeError('FontFace requires family and source');
      const state = {
        sets: new Set(), cssConnected: false, status: 'unloaded', failure: null,
        loadedPromise: null, resolveLoaded: null, rejectLoaded: null,
        source: '', bytes: null,
      };
      _fontFaceState.set(this, state);
      state.family = _fontFaceString(family);
      if (!state.family.trim()) throw new DOMException('The font family is empty', 'SyntaxError');
      const normalized = _fontFaceSource(source);
      state.source = normalized.css;
      state.bytes = normalized.bytes;
      state.style = _fontFaceDescriptor(descriptors, 'style', 'normal');
      state.weight = _fontFaceDescriptor(descriptors, 'weight', 'normal');
      state.stretch = _fontFaceDescriptor(descriptors, 'stretch', 'normal');
      state.unicodeRange = _fontFaceDescriptor(descriptors, 'unicodeRange', 'U+0-10FFFF');
      state.variant = _fontFaceDescriptor(descriptors, 'variant', 'normal');
      state.featureSettings = _fontFaceDescriptor(descriptors, 'featureSettings', 'normal');
      state.variationSettings = _fontFaceDescriptor(descriptors, 'variationSettings', 'normal');
      state.display = _fontFaceDescriptor(descriptors, 'display', 'auto');
      state.ascentOverride = _fontFaceDescriptor(descriptors, 'ascentOverride', 'normal');
      state.descentOverride = _fontFaceDescriptor(descriptors, 'descentOverride', 'normal');
      state.lineGapOverride = _fontFaceDescriptor(descriptors, 'lineGapOverride', 'normal');
      state.sizeAdjust = _fontFaceDescriptor(descriptors, 'sizeAdjust', '100%');
      if (normalized.parseError !== null) {
        _fontFaceFail(this, new DOMException(
          "The source provided ('" + normalized.parseError + "') could not be parsed as a value list.",
          'SyntaxError'));
      } else if (normalized.binary) {
        if (_fontFaceContainerValid(state.bytes)) {
          state.status = 'loaded';
        } else {
          _fontFaceFail(this, new DOMException('Invalid font data in ArrayBuffer.', 'SyntaxError'));
        }
      }
    }
    get family() { return _fontFaceStateOf(this).family; }
    set family(value) { _fontFaceSetDescriptor(this, 'family', value); }
    get style() { return _fontFaceStateOf(this).style; }
    set style(value) { _fontFaceSetDescriptor(this, 'style', value); }
    get weight() { return _fontFaceStateOf(this).weight; }
    set weight(value) { _fontFaceSetDescriptor(this, 'weight', value); }
    get stretch() { return _fontFaceStateOf(this).stretch; }
    set stretch(value) { _fontFaceSetDescriptor(this, 'stretch', value); }
    get unicodeRange() { return _fontFaceStateOf(this).unicodeRange; }
    set unicodeRange(value) { _fontFaceSetDescriptor(this, 'unicodeRange', value); }
    get variant() { return _fontFaceStateOf(this).variant; }
    set variant(value) { _fontFaceSetDescriptor(this, 'variant', value); }
    get featureSettings() { return _fontFaceStateOf(this).featureSettings; }
    set featureSettings(value) { _fontFaceSetDescriptor(this, 'featureSettings', value); }
    get display() { return _fontFaceStateOf(this).display; }
    set display(value) { _fontFaceSetDescriptor(this, 'display', value); }
    get ascentOverride() { return _fontFaceStateOf(this).ascentOverride; }
    set ascentOverride(value) { _fontFaceSetDescriptor(this, 'ascentOverride', value); }
    get descentOverride() { return _fontFaceStateOf(this).descentOverride; }
    set descentOverride(value) { _fontFaceSetDescriptor(this, 'descentOverride', value); }
    get lineGapOverride() { return _fontFaceStateOf(this).lineGapOverride; }
    set lineGapOverride(value) { _fontFaceSetDescriptor(this, 'lineGapOverride', value); }
    get sizeAdjust() { return _fontFaceStateOf(this).sizeAdjust; }
    set sizeAdjust(value) { _fontFaceSetDescriptor(this, 'sizeAdjust', value); }
    get status() { return _fontFaceStateOf(this).status; }
    get loaded() { return _fontFaceLoaded(this); }
    load() { return _fontFaceLoad(this); }
    get variationSettings() { return _fontFaceStateOf(this).variationSettings; }
    set variationSettings(value) { _fontFaceSetDescriptor(this, 'variationSettings', value); }
  };
  // Re-slot `constructor` into Chrome's position (the class body puts it
  // first) and drop anything a later pass may have added.
  const _parkFontFacePrototype = prototype => {
    const current = Object.getOwnPropertyNames(prototype);
    const wanted = _chromeFontFaceMemberOrder.filter(name => current.includes(name));
    const extras = current.filter(name => !wanted.includes(name));
    const order = [...wanted, ...extras];
    const descriptors = new Map();
    for (const name of current) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      // Chrome marks every member of this prototype enumerable; the
      // constructor is the one exception (and the class body already leaves
      // it non-enumerable, as does the oracle).
      if (name !== 'constructor') descriptor.enumerable = true;
      descriptors.set(name, descriptor);
    }
    if (order.length === current.length && order.every((name, i) => name === current[i])) return;
    for (const name of current) { try { delete prototype[name]; } catch (_e) {} }
    for (const name of order) {
      const descriptor = descriptors.get(name);
      if (descriptor) { try { Object.defineProperty(prototype, name, descriptor); } catch (_e) {} }
    }
  };
  _parkFontFacePrototype(globalThis.FontFace.prototype);

  // ---------------------------------------------------------------------
  // FontFaceSet.
  //
  // Chrome's prototype has no own `constructor` (`document.fonts.constructor`
  // is EventTarget), carries no `_`-prefixed helpers, keeps the three
  // onloading* handlers as accessors rather than instance properties, and its
  // @@iterator is the very same function object as `values`. The instance
  // itself has no own property (`Object.getOwnPropertyNames(document.fonts)`
  // is []), so every slot moved into the WeakMap below.
  // ---------------------------------------------------------------------
  const _fontFaceSetState = new WeakMap();
  const _fontFaceSetStateOf = set => {
    const state = _fontFaceSetState.get(set);
    if (!state) throw new TypeError('Illegal invocation');
    return state;
  };
  const _fontFaceSetGetHandler = (set, name) => _fontFaceSetStateOf(set)[name];
  const _fontFaceSetSetHandler = (set, name, value) => {
    _fontFaceSetStateOf(set)[name] =
      (typeof value === 'function' || (value && typeof value === 'object')) ? value : null;
    return value;
  };
  const _fontFaceSetDiscover = set => {
    const state = _fontFaceSetStateOf(set);
    if (!state.ownerDocument) return;
    const retained = new Set();
    for (const rule of _fontFaceAuthoredRules(state.ownerDocument)) {
      const key = JSON.stringify([rule.family, rule.source, rule.descriptors]);
      retained.add(key);
      if (state.cssFaces.has(key)) continue;
      try {
        const face = new FontFace(rule.family, rule.source, rule.descriptors);
        _fontFaceMarkCssConnected(face);
        _fontFaceAttach(face, set);
        state.cssFaces.set(key, face);
        state.faces.add(face);
      } catch (_) {}
    }
    for (const [key, face] of state.cssFaces) {
      if (retained.has(key)) continue;
      _fontFaceDetach(face, set);
      state.faces.delete(face);
      state.cssFaces.delete(key);
    }
  };
  const _fontFaceSetDispatch = (set, type, faces) => {
    const event = new Event(type);
    event.fontfaces = faces;
    set.dispatchEvent(event);
    const handler = _fontFaceSetGetHandler(set, 'on' + type);
    if (typeof handler === 'function') {
      try { handler.call(set, event); } catch (error) { console.error(error); }
    }
  };
  const _fontFaceSetSyncNative = set => {
    const state = _fontFaceSetStateOf(set);
    if (!state.ownerDocument || typeof Deno.core.ops.op_set_dynamic_fonts !== 'function') return;
    const registrations = [];
    for (const face of state.faces) {
      if (_fontFaceIsCssConnected(face) || face.status === 'error') continue;
      registrations.push({
        family: face.family,
        source: _fontFaceCssSource(face),
        style: face.style,
        weight: face.weight,
        unicodeRange: face.unicodeRange
      });
    }
    Deno.core.ops.op_set_dynamic_fonts(JSON.stringify(registrations));
    _scheduleResizeRenderCheckpoint();
  };
  const _fontFaceSetFaceChanged = (set, face) => {
    const state = _fontFaceSetStateOf(set);
    _fontFaceSetSyncNative(set);
    if (face.status === 'loading' && state.status !== 'loading') {
      state.status = 'loading';
      const pending = Array.from(state.faces).filter(candidate => candidate.status === 'loading');
      // A face that fails must not take `ready` down with it: Chrome resolves
      // it once nothing is loading any more, errors included.
      state.readyPromise = Promise.all(
        pending.map(candidate => candidate.loaded.catch(() => null))
      ).then(() => {
        state.status = 'loaded';
        _fontFaceSetDispatch(set, 'loadingdone', Array.from(state.faces));
        return set;
      });
      _fontFaceSetDispatch(set, 'loading', [face]);
    }
  };

  // Lexical binding as well as the global: the global is deleted from a
  // non-isolated window (Chrome does not expose FontFaceSet there), while
  // the `fonts` getter below still has to construct one.
  const FontFaceSet = globalThis.FontFaceSet = class FontFaceSet extends EventTarget {
    constructor(initialFaces=[], ownerDocument=null) {
      super();
      _fontFaceSetState.set(this, {
        faces: new Set(), ownerDocument, cssFaces: new Map(), status: 'loaded',
        readyPromise: null, onloading: null, onloadingdone: null, onloadingerror: null,
      });
      if (initialFaces != null) for (const face of initialFaces) this.add(face);
    }
    get onloading() { return _fontFaceSetGetHandler(this, 'onloading'); }
    set onloading(value) { _fontFaceSetSetHandler(this, 'onloading', value); }
    get onloadingdone() { return _fontFaceSetGetHandler(this, 'onloadingdone'); }
    set onloadingdone(value) { _fontFaceSetSetHandler(this, 'onloadingdone', value); }
    get onloadingerror() { return _fontFaceSetGetHandler(this, 'onloadingerror'); }
    set onloadingerror(value) { _fontFaceSetSetHandler(this, 'onloadingerror', value); }
    get ready() {
      const state = _fontFaceSetStateOf(this);
      if (!state.readyPromise) state.readyPromise = Promise.resolve(this);
      return state.readyPromise;
    }
    get status() { return _fontFaceSetStateOf(this).status; }
    get size() { _fontFaceSetDiscover(this); return _fontFaceSetStateOf(this).faces.size; }
    check(font, text=' ') {
      void String(text);
      _fontFaceSetDiscover(this);
      const state = _fontFaceSetStateOf(this);
      const selection = _fontFaceSelection(font);
      const matches = Array.from(state.faces).filter(face => _fontFaceMatches(face, selection));
      return matches.length === 0 || matches.every(face => face.status === 'loaded');
    }
    load(font, text=' ') {
      void String(text);
      _fontFaceSetDiscover(this);
      const state = _fontFaceSetStateOf(this);
      const selection = _fontFaceSelection(font);
      const matches = Array.from(state.faces).filter(face => _fontFaceMatches(face, selection));
      return Promise.all(matches.map(face => face.load())).then(() => matches);
    }
    add(face) {
      if (!(face instanceof FontFace)) throw new TypeError('FontFaceSet.add requires a FontFace');
      _fontFaceSetDiscover(this);
      const state = _fontFaceSetStateOf(this);
      if (!state.faces.has(face)) {
        state.faces.add(face);
        _fontFaceAttach(face, this);
        _fontFaceSetSyncNative(this);
      }
      return this;
    }
    clear() {
      const state = _fontFaceSetStateOf(this);
      for (const face of Array.from(state.faces)) {
        if (_fontFaceIsCssConnected(face)) continue;
        _fontFaceDetach(face, this);
        state.faces.delete(face);
      }
      _fontFaceSetSyncNative(this);
    }
    delete(face) {
      _fontFaceSetDiscover(this);
      const state = _fontFaceSetStateOf(this);
      if (!(face instanceof FontFace) || _fontFaceIsCssConnected(face)
          || !state.faces.delete(face)) return false;
      _fontFaceDetach(face, this);
      _fontFaceSetSyncNative(this);
      return true;
    }
    entries() {
      _fontFaceSetDiscover(this);
      return Array.from(_fontFaceSetStateOf(this).faces, face => [face, face])[Symbol.iterator]();
    }
    forEach(callback, thisArg=undefined) {
      if (typeof callback !== 'function') throw new TypeError('FontFaceSet.forEach callback must be callable');
      _fontFaceSetDiscover(this);
      for (const face of _fontFaceSetStateOf(this).faces) callback.call(thisArg, face, face, this);
    }
    has(face) { _fontFaceSetDiscover(this); return _fontFaceSetStateOf(this).faces.has(face); }
    keys() { _fontFaceSetDiscover(this); return Array.from(_fontFaceSetStateOf(this).faces).values(); }
    values() { return this.keys(); }
  };
  // Chrome's prototype carries no `constructor` and lists @@iterator as a
  // non-enumerable data property holding the same function object `values` is.
  // The tag has to be declared here: with `constructor` gone,
  // config/webidl-branding.js skips this interface (it brands only a prototype
  // whose `constructor` is the interface itself), and the realm would answer
  // "[object EventTarget]" for `document.fonts`.
  const _fontFaceSetPrototype = FontFaceSet.prototype;
  Object.defineProperty(_fontFaceSetPrototype, Symbol.toStringTag, {
    value: 'FontFaceSet', writable: false, enumerable: false, configurable: true,
  });
  for (const name of Object.getOwnPropertyNames(_fontFaceSetPrototype)) {
    if (name === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(_fontFaceSetPrototype, name);
    if (descriptor && !descriptor.enumerable) {
      descriptor.enumerable = true;
      try { Object.defineProperty(_fontFaceSetPrototype, name, descriptor); } catch (_error) {}
    }
  }
  try { delete _fontFaceSetPrototype.constructor; } catch (_error) {}
  Object.defineProperty(_fontFaceSetPrototype, Symbol.iterator, {
    value: _fontFaceSetPrototype.values, enumerable: false, configurable: true,
  });

  const _documentFonts = new WeakMap();
  Object.defineProperty(Document.prototype, 'fonts', {
    get() {
      let set = _documentFonts.get(this);
      if (!set) {
        set = new FontFaceSet([], this);
        _documentFonts.set(this, set);
      }
      return set;
    },
    configurable: true
  });
}
