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

  globalThis.OffscreenCanvasRenderingContext2D = class OffscreenCanvasRenderingContext2D {
    constructor() { throw new TypeError('Illegal constructor'); }
    get [Symbol.toStringTag]() { return 'OffscreenCanvasRenderingContext2D'; }
  };
  Object.setPrototypeOf(globalThis.OffscreenCanvasRenderingContext2D.prototype,
    _Canvas2D.prototype);

  globalThis.ImageBitmap = class ImageBitmap {
    constructor(key, width, height, pixels = undefined) {
      if (key !== _bitmapKey) throw new TypeError('Illegal constructor');
      _imageBitmapState.set(this, {width, height, pixels, closed: false});
    }
    get width() { const state = _imageBitmapState.get(this); return state.closed ? 0 : state.width; }
    get height() { const state = _imageBitmapState.get(this); return state.closed ? 0 : state.height; }
    close() { const state = _imageBitmapState.get(this); state.closed = true; state.pixels = undefined; }
    get [Symbol.toStringTag]() { return 'ImageBitmap'; }
  };

  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) {
      if (arguments.length < 2) {
        throw new TypeError("Failed to construct 'OffscreenCanvas': 2 arguments required, but only "
          + arguments.length + ' present.');
      }
      width = Math.max(0, Math.trunc(Number(width)) || 0);
      height = Math.max(0, Math.trunc(Number(height)) || 0);
      _offscreenCanvasState.set(this, {width, height, context: null, contextType: null});
    }
    get width() { return _offscreenCanvasState.get(this).width; }
    set width(value) {
      const state = _offscreenCanvasState.get(this);
      state.width = Math.max(0, Math.trunc(Number(value)) || 0);
      if (state.context) state.context._resizeFromCanvas();
    }
    get height() { return _offscreenCanvasState.get(this).height; }
    set height(value) {
      const state = _offscreenCanvasState.get(this);
      state.height = Math.max(0, Math.trunc(Number(value)) || 0);
      if (state.context) state.context._resizeFromCanvas();
    }
    getAttribute(name) {
      if (name === 'width') return String(this.width);
      if (name === 'height') return String(this.height);
      return null;
    }
    getContext(type, attrs = undefined) {
      const state = _offscreenCanvasState.get(this);
      type = String(type).toLowerCase();
      if (state.contextType !== null && state.contextType !== type) return null;
      if (type !== '2d') return null;
      if (!state.context) {
        state.context = new _Canvas2D(this, attrs);
        Object.setPrototypeOf(state.context,
          globalThis.OffscreenCanvasRenderingContext2D.prototype);
        state.contextType = type;
      }
      return state.context;
    }
    convertToBlob() {
      const state = _offscreenCanvasState.get(this);
      if (!state.context) {
        return Promise.reject(new DOMException(
          "Failed to execute 'convertToBlob' on 'OffscreenCanvas': 'OffscreenCanvas' has no rendering context.",
          'InvalidStateError'));
      }
      if (state.width === 0 || state.height === 0) {
        return Promise.reject(new DOMException(
          "Failed to execute 'convertToBlob' on 'OffscreenCanvas': The canvas has no pixels.",
          'IndexSizeError'));
      }
      return Promise.resolve(_canvasPngBlob(state.context));
    }
    transferToImageBitmap() {
      const state = _offscreenCanvasState.get(this);
      const context = state.context || this.getContext('2d');
      const bitmap = new globalThis.ImageBitmap(_bitmapKey, state.width, state.height,
        context._buf.slice());
      context._resizeFromCanvas();
      return bitmap;
    }
    get [Symbol.toStringTag]() { return 'OffscreenCanvas'; }
  };

  globalThis.createImageBitmap = _markNative(async function createImageBitmap(source, ...crop) {
    let width = 0, height = 0, pixels;
    const offscreen = _offscreenCanvasState.get(source);
    if (offscreen) {
      const context = offscreen.context || source.getContext('2d');
      width = offscreen.width; height = offscreen.height; pixels = context._buf.slice();
    } else if (source && source._ctx instanceof _Canvas2D) {
      width = source._ctx._w; height = source._ctx._h; pixels = source._ctx._buf.slice();
    } else if (_imageDataState.has(source)) {
      const image = _imageData(source);
      width = image.width; height = image.height;
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
    if (crop.length >= 4) {
      width = Math.abs(Math.trunc(Number(crop[2])));
      height = Math.abs(Math.trunc(Number(crop[3])));
    }
    return new globalThis.ImageBitmap(_bitmapKey, width, height, pixels);
  });
}

if (typeof Path2D === 'undefined') {
  globalThis.Path2D = class Path2D { constructor(){} moveTo(){} lineTo(){} arc(){} rect(){} closePath(){} addPath(){} };
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
    getClientRects(){return new DOMRectList([]);} cloneRange(){return new Range();} toString(){return '';}
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
  const _fontFaceSource = source => {
    if (typeof source === 'string') {
      if (!source.trim()) throw new DOMException('The font source is empty', 'SyntaxError');
      return { css: source, binary: false };
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
      binary: true
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
            lineGapOverride: declarations['line-gap-override'] || 'normal'
          }
        });
      }
    }
    return out;
  };

  globalThis.FontFace = class FontFace {
    constructor(family, source, descriptors={}) {
      if (arguments.length < 2) throw new TypeError('FontFace requires family and source');
      this._sets = new Set();
      this._family = _fontFaceString(family);
      if (!this._family.trim()) throw new DOMException('The font family is empty', 'SyntaxError');
      const normalizedSource = _fontFaceSource(source);
      this._source = normalizedSource.css;
      this._style = _fontFaceDescriptor(descriptors, 'style', 'normal');
      this._weight = _fontFaceDescriptor(descriptors, 'weight', 'normal');
      this._stretch = _fontFaceDescriptor(descriptors, 'stretch', 'normal');
      this._unicodeRange = _fontFaceDescriptor(descriptors, 'unicodeRange', 'U+0-10FFFF');
      this._variant = _fontFaceDescriptor(descriptors, 'variant', 'normal');
      this._featureSettings = _fontFaceDescriptor(descriptors, 'featureSettings', 'normal');
      this._variationSettings = _fontFaceDescriptor(descriptors, 'variationSettings', 'normal');
      this._display = _fontFaceDescriptor(descriptors, 'display', 'auto');
      this._ascentOverride = _fontFaceDescriptor(descriptors, 'ascentOverride', 'normal');
      this._descentOverride = _fontFaceDescriptor(descriptors, 'descentOverride', 'normal');
      this._lineGapOverride = _fontFaceDescriptor(descriptors, 'lineGapOverride', 'normal');
      this._status = normalizedSource.binary ? 'loaded' : 'unloaded';
      this._loadedPromise = normalizedSource.binary ? Promise.resolve(this) : null;
    }
    _changed() { for (const set of this._sets) set._faceChanged(this); }
    _setDescriptor(slot, value) {
      this[slot] = String(value);
      this._changed();
    }
    get family() { return this._family; }
    set family(value) { this._setDescriptor('_family', value); }
    get style() { return this._style; }
    set style(value) { this._setDescriptor('_style', value); }
    get weight() { return this._weight; }
    set weight(value) { this._setDescriptor('_weight', value); }
    get stretch() { return this._stretch; }
    set stretch(value) { this._setDescriptor('_stretch', value); }
    get unicodeRange() { return this._unicodeRange; }
    set unicodeRange(value) { this._setDescriptor('_unicodeRange', value); }
    get variant() { return this._variant; }
    set variant(value) { this._setDescriptor('_variant', value); }
    get featureSettings() { return this._featureSettings; }
    set featureSettings(value) { this._setDescriptor('_featureSettings', value); }
    get variationSettings() { return this._variationSettings; }
    set variationSettings(value) { this._setDescriptor('_variationSettings', value); }
    get display() { return this._display; }
    set display(value) { this._setDescriptor('_display', value); }
    get ascentOverride() { return this._ascentOverride; }
    set ascentOverride(value) { this._setDescriptor('_ascentOverride', value); }
    get descentOverride() { return this._descentOverride; }
    set descentOverride(value) { this._setDescriptor('_descentOverride', value); }
    get lineGapOverride() { return this._lineGapOverride; }
    set lineGapOverride(value) { this._setDescriptor('_lineGapOverride', value); }
    get status() { return this._status; }
    get loaded() {
      if (!this._loadedPromise) {
        this._loadedPromise = new Promise((resolve, reject) => {
          this._resolveLoaded = resolve;
          this._rejectLoaded = reject;
        });
      }
      return this._loadedPromise;
    }
    load() {
      if (this._status === 'loaded') return this.loaded;
      if (this._status === 'loading') return this.loaded;
      this._status = 'loading';
      this._changed();
      const loaded = this.loaded;
      Promise.resolve().then(() => {
        if (this._status !== 'loading') return;
        // A `local()` source names a font the machine either has or does not.
        // Resolving unconditionally answers "installed" for every name a
        // caller can invent, which is how the engine came to claim it had
        // Windows, Linux and macOS font sets at the same time -- this is the
        // probe that produced that list, not text measurement.
        const missing = _fontFaceLocalSourceMissing(this._source);
        if (missing !== null) {
          this._status = 'error';
          const error = new DOMException(
            `A network error occurred loading font "${missing}".`, 'NetworkError');
          this._rejectLoaded?.(error);
          // The rejection is delivered through `loaded`; without a sink here
          // an unobserved probe would report an unhandled rejection.
          loaded.catch(() => {});
          this._changed();
          return;
        }
        this._status = 'loaded';
        this._resolveLoaded?.(this);
        this._changed();
      });
      return loaded;
    }
  };

  // The first `local()` family in a source that this machine does not have,
  // or null when every one of them is available.
  //
  // Availability is decided by measuring rather than by a second list: the
  // renderer already resolves an unknown named family by skipping it, so a
  // family that survives being measured against two different generics is one
  // the renderer actually has. Keeping the answer on that side means the two
  // can never disagree about which fonts exist.
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
      face.weight.toLowerCase() === 'normal' ? 400 : +(face.weight.split(/\s+/)[0]) || 400;
    const italic = /^(?:italic|oblique)/i.test(face.style);
    return Math.abs(faceWeight - selection.weight) < 350 && italic === (selection.style !== 'normal');
  };

  globalThis.FontFaceSet = class FontFaceSet extends EventTarget {
    constructor(initialFaces=[], ownerDocument=null) {
      super();
      this._faces = new Set();
      this._ownerDocument = ownerDocument;
      this._cssFaces = new Map();
      this._status = 'loaded';
      this._readyPromise = Promise.resolve(this);
      this.onloading = null;
      this.onloadingdone = null;
      this.onloadingerror = null;
      if (initialFaces != null) for (const face of initialFaces) this.add(face);
    }
    get status() { return this._status; }
    get ready() { return this._readyPromise; }
    get size() { this._discoverCssFaces(); return this._faces.size; }
    _discoverCssFaces() {
      if (!this._ownerDocument) return;
      const retained = new Set();
      for (const rule of _fontFaceAuthoredRules(this._ownerDocument)) {
        const key = JSON.stringify([rule.family, rule.source, rule.descriptors]);
        retained.add(key);
        if (this._cssFaces.has(key)) continue;
        try {
          const face = new FontFace(rule.family, rule.source, rule.descriptors);
          face._cssConnected = true;
          face._sets.add(this);
          this._cssFaces.set(key, face);
          this._faces.add(face);
        } catch (_) {}
      }
      for (const [key, face] of this._cssFaces) {
        if (retained.has(key)) continue;
        face._sets.delete(this);
        this._faces.delete(face);
        this._cssFaces.delete(key);
      }
    }
    _dispatch(type, faces) {
      const event = new Event(type);
      event.fontfaces = faces;
      this.dispatchEvent(event);
      const handler = this['on' + type];
      if (typeof handler === 'function') {
        try { handler.call(this, event); } catch (error) { console.error(error); }
      }
    }
    _syncNative() {
      if (!this._ownerDocument || typeof Deno.core.ops.op_set_dynamic_fonts !== 'function') return;
      const registrations = [];
      for (const face of this._faces) registrations.push({
        ...(face._cssConnected ? { skip: true } : {}),
        family: face.family,
        source: face._source,
        style: face.style,
        weight: face.weight,
        unicodeRange: face.unicodeRange
      });
      Deno.core.ops.op_set_dynamic_fonts(JSON.stringify(registrations.filter(face => !face.skip)));
      _scheduleResizeRenderCheckpoint();
    }
    _faceChanged(face) {
      this._syncNative();
      if (face.status === 'loading' && this._status !== 'loading') {
        this._status = 'loading';
        const pending = Array.from(this._faces).filter(candidate => candidate.status === 'loading');
        this._readyPromise = Promise.all(pending.map(candidate => candidate.loaded)).then(() => {
          this._status = 'loaded';
          this._dispatch('loadingdone', Array.from(this._faces));
          return this;
        });
        this._dispatch('loading', [face]);
      }
    }
    add(face) {
      if (!(face instanceof FontFace)) throw new TypeError('FontFaceSet.add requires a FontFace');
      this._discoverCssFaces();
      if (!this._faces.has(face)) {
        this._faces.add(face);
        face._sets.add(this);
        this._syncNative();
      }
      return this;
    }
    check(font, text=' ') {
      void String(text);
      this._discoverCssFaces();
      const selection = _fontFaceSelection(font);
      const matches = Array.from(this._faces).filter(face => _fontFaceMatches(face, selection));
      return matches.length === 0 || matches.every(face => face.status === 'loaded');
    }
    clear() {
      for (const face of Array.from(this._faces)) {
        if (face._cssConnected) continue;
        face._sets.delete(this);
        this._faces.delete(face);
      }
      this._syncNative();
    }
    delete(face) {
      this._discoverCssFaces();
      if (!(face instanceof FontFace) || face._cssConnected || !this._faces.delete(face)) return false;
      face._sets.delete(this);
      this._syncNative();
      return true;
    }
    load(font, text=' ') {
      void String(text);
      this._discoverCssFaces();
      const selection = _fontFaceSelection(font);
      const matches = Array.from(this._faces).filter(face => _fontFaceMatches(face, selection));
      return Promise.all(matches.map(face => face.load())).then(() => matches);
    }
    forEach(callback, thisArg=undefined) {
      if (typeof callback !== 'function') throw new TypeError('FontFaceSet.forEach callback must be callable');
      this._discoverCssFaces();
      for (const face of this._faces) callback.call(thisArg, face, face, this);
    }
    has(face) { this._discoverCssFaces(); return this._faces.has(face); }
    entries() { this._discoverCssFaces(); return Array.from(this._faces, face => [face, face])[Symbol.iterator](); }
    keys() { this._discoverCssFaces(); return Array.from(this._faces).values(); }
    values() { this._discoverCssFaces(); return Array.from(this._faces).values(); }
    [Symbol.iterator]() { return this.values(); }
  };
  Object.defineProperty(Document.prototype, 'fonts', {
    get() {
      if (!this[_fontsSym]) this[_fontsSym] = new FontFaceSet([], this);
      return this[_fontsSym];
    },
    configurable: true
  });
}
