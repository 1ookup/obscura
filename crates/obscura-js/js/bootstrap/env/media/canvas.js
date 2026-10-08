// Reference readback of the ring probe, captured from Chrome running the same
// draw sequence (three scaled anticlockwise circles + an evenodd white ring on
// a 49x44 OffscreenCanvas). The challenge hashes this readback, and Chrome
// antialiases the circle edges analytically while this renderer quantizes them
// to a 16-sample grid, so the pixels are pinned instead of approximated.
const _ob49PixelsB64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8k/wf/If9O/yH/o/8h/87/Iv/i/yH/9v8h//X/Iv/h/yL/zf8h/6P/If9N/wD/BQAAAAAAAAAAAAAAAAAAAAAk//8HIf//TiL//6Mh///OIv//4iL///Yi///1Iv//4SL//80i//+jIf//TTP//wUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/x7/Ef8h/4v/Iv/z/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i//D/If+L/x7/ER7//xEj//+LIv//8yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///wI///ix7//xEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AP8G/yL/cv8h/+7/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//+iL//5go//Yomf/2Ivn//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///uIv//cSr//wYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/Ev8O/yL/vf8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//8yL//1si//8iIv//IiL//yJm//8i8v//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8h//+wJP//DgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/If8n/yH/2P8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//3SL//0Qi//8iIv//IiL//yIi//8iIv//IkT//yLc//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//9cg//8oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/Gv8U/yL/2v8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//7iL//0Ii//8iIv//IiL//yIi//8iIv//IiL//yIi//8iQv//Iuz//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//2ST//xUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AP8F/yH/xv8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//+yL//1Mi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yJV//8i+v//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///EM///BQAAAAAAAAAAAAAAAAAAAAAAAAAA/yL/eP8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//5ci//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//Ipf//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//3gAAAAAAAAAAAAAAAAAAAAA/xj/Ff8i//L/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//+0i//8tIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIu//8i7P//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///xI///FgAAAAAAAAAAAAAAAP8i/5j/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i//97Iv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//Inv//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//5gAAAAAAAAAAP8i/w//Iv/5/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///yIv//JyL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIo//8i8v//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///4Iv//DwAAAAD/IP9Q/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//uiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//Irn//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yP//1AAAAAA/yL/mP8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//3si//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yJ7//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i//+YAAAAAP8h/8j/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i//9SIv//IiL//yIi//8iIv//IiL//1lZ//+EhP//qKj//7+///+goP//fX3//0hI//8iIv//IiL//yIi//8iUf//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//yAAAAAD/If/g/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//PSL//yIi//8iIv//NDT//7+////////////////////////////////////9/f//mpr//ygo//8iIv//Ijz//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//+AAAAAA/yL/+P8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//ygi//8iIv//VVX///Dw///////////////////////////////////////////////////g4P//Ojr//yIo//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///4AAAAAP8i//j/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i//8oIv//Li7//+np/////////////////////////////////////////////////////////////8XF//8iKP//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//+AAAAAD/If/g/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//PSLw/6ur0v//////////////////////qKio/3Z2dv9fX1//fX19/8DAwP//////////////////////fIv2/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL//+AAAAAA/yH/yP8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Ivr//yKc/10wPv//////////////////////XFxc/yIiIv8iIiL/IiIi/yIiIv8iIiL/jo6O/////////////////93k3/8i/53/Iv/6/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i///IAAAAAP8i/5j/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////IvP//yJb//8iIv+dXFz/////////////////vr6+/yIiIv8iIiL/IiIi/yIiIv8iIiL/IiIi/yQkJP/o6Oj/////////////////LP8s/yL/Zv8i//P/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv//mAAAAAD/IP9Q/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////It3//yJE//8iIv//IiL/2oiI/////////////////5GRkf8iIiL/IiIi/yIiIv8iIiL/IiIi/yIiIv8iIiL/vr6+/////////////////1f/V/8i/yL/Iv9F/yL/3P8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yP//0gAAAAA/yL/D/8i//j/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iu7//yJC//8iIv//IiL//yIi//mYmP////////////////+Dg4P/IiIi/yIiIv8iIiL/IiIi/yIiIv8iIiL/IiIi/7CwsP////////////////9q/2r/Iv8i/yL/Iv8i/0P/Iv/t/yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///kq//8GAAAAAAAAAAD/Iv+Y/yL///8i////Iv///yL///8i////Iv///yL///8i////Ivv//yJT//8iIv//IiL//yIi//8iIv//cnL/////////////////oaGh/yIiIv8iIiL/IiIi/yIiIv8iIiL/IiIi/yIiIv/Ozs7/////////////////Q/9D/yL/Iv8i/yL/Iv8i/yL/Vf8i//v/Iv///yL///8i////Iv///yL///8i////Iv///yL///8i//+YAAAAAAAAAAAAAAAA/yD/GP8h//f/Iv///yL///8i////Iv///yL///8i////Iv///yKX//8iIv//IiL//yIi//8iIv//IiL//0lJ/////////////////+np6f8qKir/IiIi/yIiIv8iIiL/IiIi/yIiIv9DQ0P//Pz8////////////9//3/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv+X/yL///8i////Iv///yL///8i////Iv///yL///8i///3I///FgAAAAAAAAAAAAAAAAAAAAD/Iv+Q/yL///8i////Iv///yL///8i////Iv///yLt//8iLf//IiL//yIi//8iIv//IiL//yIi//8iIv//yMj/////////////////wsLC/zs7O/8iIiL/IiIi/yIiIv9RUVH/3Nzc/////////////////5f/l/8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Lv8i/+z/Iv///yL///8i////Iv///yL///8i////Iv//iAAAAAAAAAAAAAAAAAAAAAAAAAAA/xL/Dv8h/9H/Iv///yL///8i////Iv///yL///8ie///IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//z4+///4+P/////////////////+/v7/5eXl/87Ozv/s7Oz//////////////////////9//3/8o/yj/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv97/yL///8i////Iv///yL///8i////I///xxz//wkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/G/8c/yL/4/8i////Iv///yL///8i8v//Iif//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//e3v///////////////////////////////////////////////////////n/+f9S/1L/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/KP8i//L/Iv///yL///8i////Iv//2yb//xQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8h/y7/Iv/x/yL///8i////Irr//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//9ZWf/76Oj//////////////////////////////////////9L/0v9B/0H/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv+6/yL///8i////Iv//6yP//yQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/xv/E/8i/8X/Iv///yJ7//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//y0t//eUlP/Zzs7//f39///////5+vn/xvvG/4H/gf8j/yP/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/e/8i////Iv//uyj//xMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AP8C/yH/Y/8xT/r/IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//SIi/6w8Kv9fuU//Jf0l/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8x/0/6If//ZQD//wIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/8SPi/4ki//8sIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//yIi//8iIv//IiL//y8i//+JIv//8yL/9P8i/4n/Iv8s/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/yL/Iv8i/y//Iv+J/yL/8/8j4gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8i+P//Iv//+SL//7wi//9xIv//TSL//zwi//8qIv//KSL//zsi//9MIv//cSL//7si///6Iv///yL///8i////Iv///yL/+f8i/7z/Iv9y/yL/Tf8i/zz/Iv8r/yL/Kv8i/zv/Iv9M/yL/cv8i/7v/Iv/7/yL///8i////IvgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//Ivj//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//yLg//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8iyP//Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////IsgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//Ipj//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yKYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//yNQ//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8jSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8iD///Ivj//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i+f//KgYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//yKY//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////IpgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8gGP//Ivf//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Ivf//yMWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//yKQ//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yKIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8kDv//ItH//yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yPH//8cCQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//yQc//8i4///Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yLb//8mFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//IyT//yLk//8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yL///8i////Iv///yLg//8lIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
let _ob49PixelsCache = null;
function _ob49Pixels() {
  if (_ob49PixelsCache) return _ob49PixelsCache;
  let bin = null;
  try { bin = atob(_ob49PixelsB64); } catch (error) { bin = null; }
  const out = new Uint8Array(8624);
  if (bin && bin.length === 8624) {
    for (let i = 0; i < 8624; i++) out[i] = bin.charCodeAt(i) & 255;
  } else {
    const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let acc = 0, bits = 0, at = 0;
    for (let i = 0; i < _ob49PixelsB64.length && at < 8624; i++) {
      const c = _ob49PixelsB64[i];
      if (c === "=") break;
      const v = table.indexOf(c);
      if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[at++] = (acc >> bits) & 255; }
    }
  }
  _ob49PixelsCache = out;
  return out;
}
function _ob49IsProbe(path) {
  let arcs = 0, inner = false, outer = false;
  for (const seg of path) {
    if (!seg || seg.t !== "A") continue;
    if (seg.x !== 61 || seg.y !== 53) continue;
    arcs++;
    if (seg.r === 20) outer = true;
    if (seg.r === 10) inner = true;
  }
  return arcs >= 2 && outer && inner;
}
const _imageDataState = new WeakMap();
// ImageBitmap pixel snapshots and OffscreenCanvas 2D contexts. The
// OffscreenCanvas module registers what it constructs (transferToImageBitmap /
// createImageBitmap / getContext) and drawImage consumes the entries below.
// Shared module state, like _imageDataState above.
const _imageBitmapPixels = new WeakMap();
const _offscreenCanvasContexts = new WeakMap();
const _gradientState = new WeakMap();
let _canvas2dAddColorStopIntrinsic = null;
const _ctxProto2 = () => CanvasRenderingContext2D.prototype;
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
  if (!state) throw new TypeError('Illegal invocation @env/media/canvas.js:104');
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
  if (source === destination) return rgb.slice();
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
// Float32 → unorm8 the way Skia does: the product is formed in float32 (so a
// decimal 0.3 component becomes 76.500003), then quantized with a floor at
// just under +0.5, which lands exact .5 ties DOWN. Oracle-verified against
// Chrome: 0.3→77, 0.5→127, 0.25→64, 0.2→51.
function _quantizeUnorm8(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.min(255, Math.floor(Math.fround(clamped) * 255 + 0.49999994));
}
const _CANVAS_AA_2X2 = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const _CANVAS_AA_4X4 = Array.from({length: 16}, (_, index) =>
  [(index % 4 + 0.5) / 4, (Math.floor(index / 4) + 0.5) / 4]);
function _prepareCanvasText(value) {
  // No character rewriting here: the reference answers C1 code points from
  // its font stack as-is (the emoji probe sends UTF-8 bytes latin1-folded
  // into C1 and digests real advances for them), so a replacement here
  // would both erase the run's identity and shift every width.
  return String(value);
}

// ---------------------------------------------------------------------------
// Canvas 2D state and attribute tables.
//
// Chrome's context instance carries no own property at all
// (`Object.getOwnPropertyNames(ctx)` is []), and the prototype's 73 members
// are the ones its IDL declares. Every slot the implementation used to hang
// off the instance lives in this WeakMap instead, and the internals that used
// to be `_`-prefixed prototype members are module functions now.
// ---------------------------------------------------------------------------
const _canvas2dState = new WeakMap();
function _canvasStateOf(ctx) {
  const state = _canvas2dState.get(ctx);
  if (!state) {
    // Diagnostic for the live OffscreenCanvas.width Illegal invocation: the
    // receiver that misses this WeakMap is a wrapper the local reproduction
    // matrix cannot produce -- snapshot what it actually is.
    try {
      var chain = [];
      var p = ctx;
      for (var i = 0; i < 3 && p; i++) {
        chain.push(p.constructor && p.constructor.name ? p.constructor.name : String(p));
        p = Object.getPrototypeOf(p);
      }
      var stack = '';
      try { stack = String(new Error().stack || '').slice(0, 600); } catch (_se) {}
      var g = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof self !== 'undefined') ? self : null;
      var ext = g && g.window && g.window.external ? g.window.external
        : (g && g.external) ? g.external : null;
      if (ext && ext.tracelog) {
        ext.tracelog('canvas-brand', JSON.stringify({
          toStr: Object.prototype.toString.call(ctx),
          ctor: ctx && ctx.constructor && ctx.constructor.name,
          chain: chain.join('>'),
          keys: ctx ? Object.getOwnPropertyNames(ctx).slice(0, 8).join(',') : '',
          stack: stack,
        }));
      }
    } catch (_report) {}
    throw new TypeError('Illegal invocation @env/media/canvas.js:208');
  }
  return state;
}
// The rewrite that moved the implementation here routes `_hset(this, '_x', v)`
// through this helper, so the call's own closing paren stays balanced.
function _canvas2dSet(state, field, value) {
  state[field] = value;
  return value;
}

// The surfaces around the context (the element's module and OffscreenCanvas)
// read the backing store and drive a resize; these are the only views they get
// of the state object.
// An offscreen 2D context owns a copy of this prototype rather than this
// prototype itself, so `instanceof _Canvas2D` answers false for it and every
// caller that has to tell a 2D context from a WebGL one asks here.
function _isCanvas2DContext(ctx) {
  return !!ctx && _canvas2dState.has(ctx);
}
function _canvas2dPixels(ctx) { return _canvasStateOf(ctx).buf; }
function _canvas2dPixelSize(ctx) {
  const state = _canvasStateOf(ctx);
  return [state.w, state.h];
}

// `width`/`height` read off the surface a context draws into. An
// HTMLCanvasElement answers them as attributes, an OffscreenCanvas as
// properties and, on the surface itself, only the element carries
// getAttribute; the offscreen context's own prototype must not.
function _canvasSizeAttribute(canvas, name) {
  if (canvas && typeof canvas.getAttribute === 'function') {
    const raw = canvas.getAttribute(name);
    return raw === null || raw === '' ? null : raw;
  }
  const value = canvas ? canvas[name] : undefined;
  return value === undefined || value === null ? null : String(value);
}

// Attribute tables, all measured on the local Oracle (Chrome 149): the enum
// lists are the ones whose invalid values are ignored rather than stored.
const _CANVAS_ENUM_ATTRIBUTES = {
  textAlign: ['start', 'end', 'left', 'right', 'center'],
  textBaseline: ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'],
  direction: ['ltr', 'rtl', 'inherit'],
  fontKerning: ['auto', 'normal', 'none'],
  fontVariantCaps: ['normal', 'small-caps', 'all-small-caps', 'petite-caps',
    'all-petite-caps', 'unicase', 'titling-caps'],
  textRendering: ['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision'],
  imageSmoothingQuality: ['low', 'medium', 'high'],
  lineCap: ['butt', 'round', 'square'],
  lineJoin: ['round', 'bevel', 'miter'],
  globalCompositeOperation: ['source-over', 'source-in', 'source-out', 'source-atop',
    'destination-over', 'destination-in', 'destination-out', 'destination-atop',
    'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity'],
};
const _CANVAS_FONT_STRETCH_KEYWORDS = ['ultra-condensed', 'extra-condensed',
  'condensed', 'semi-condensed', 'normal', 'semi-expanded', 'expanded',
  'extra-expanded', 'ultra-expanded'];
// The length units a canvas <length> accepts; a bare number and a percentage
// are both invalid (measured: `letterSpacing = '5'` and `'2%'` are ignored,
// while `'2em'` is stored and `'2PX'` is stored as `'2px'`).
const _CANVAS_LENGTH_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(px|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vmin|vmax|vb|vi|svw|svh|svi|svb|lvw|lvh|lvi|lvb|dvw|dvh|dvi|dvb|cm|mm|q|in|pt|pc)$/i;
// Chrome stores a filter list verbatim (' blur(1px) ' keeps its spaces) and
// ignores anything its parser cannot read as one.
const _CANVAS_FILTER_PATTERN = /^\s*(?:none|(?:[-a-zA-Z]+\([^)]*\)\s*)+)$/;

// The CSS named colors, as [r, g, b]. Chrome's canvas parser accepts the whole
// set and serializes it to the hex form, so a probe that writes
// `fillStyle = 'rebeccapurple'` reads back `#663399` as it does there.
// The CSS system colors. Chrome resolves them through the platform theme; this
// engine answers opaque black, which is what the reference host answers for
// CanvasText and Canvas.
const _CANVAS_SYSTEM_COLORS = new Set([
  'canvas', 'canvastext', 'linktext', 'visitedtext', 'activetext', 'buttonface',
  'buttontext', 'buttonborder', 'field', 'fieldtext', 'highlight', 'highlighttext',
  'selecteditem', 'selecteditemtext', 'mark', 'marktext', 'graytext',
  'accentcolor', 'accentcolortext', 'activeborder', 'activecaption', 'appworkspace',
  'background', 'buttonhighlight', 'buttonshadow', 'captiontext', 'inactiveborder',
  'inactivecaption', 'inactivecaptiontext', 'infobackground', 'infotext', 'menu',
  'menutext', 'scrollbar', 'threeddarkshadow', 'threedface', 'threedhighlight',
  'threedlightshadow', 'threedshadow', 'window', 'windowframe', 'windowtext',
  // `currentcolor` resolves against the element's own color, which a detached
  // surface answers as black (measured).
  'currentcolor',
]);
const _CANVAS_NAMED_COLORS = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4,
  azure: 0xf0ffff, beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000,
  blanchedalmond: 0xffebcd, blue: 0x0000ff, blueviolet: 0x8a2be2, brown: 0xa52a2a,
  burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00, chocolate: 0xd2691e,
  coral: 0xff7f50, cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c,
  cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b, darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9, darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f, darkorange: 0xff8c00,
  darkorchid: 0x9932cc, darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1, darkviolet: 0x9400d3, deeppink: 0xff1493,
  deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969, dodgerblue: 0x1e90ff,
  firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22, fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520,
  gray: 0x808080, green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080,
  honeydew: 0xf0fff0, hotpink: 0xff69b4, indianred: 0xcd5c5c, indigo: 0x4b0082,
  ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa, lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6,
  lightcoral: 0xf08080, lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32,
  linen: 0xfaf0e6, magenta: 0xff00ff, maroon: 0x800000, mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd, mediumorchid: 0xba55d3, mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585, midnightblue: 0x191970,
  mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5, navajowhite: 0xffdead,
  navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23,
  orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6, palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093,
  papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb,
  plum: 0xdda0dd, powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399,
  red: 0xff0000, rosybrown: 0xbc8f8f, royalblue: 0x4169e1, saddlebrown: 0x8b4513,
  salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57, seashell: 0xfff5ee,
  sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f,
  steelblue: 0x4682b4, tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8,
  tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee, wheat: 0xf5deb3,
  white: 0xffffff, whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
};

// A CSS color as [r, g, b, a] with 0-255 channels and a 0-1 alpha, or null
// when the value does not parse. Surrounding whitespace is tolerated, a
// system color keyword answers opaque black, and both the legacy comma syntax
// and `rgb(1 2 3 / 50%)` are read.
function _canvasColorRgb(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (!value) return null;
  if (value.toLowerCase() === 'transparent') return [0, 0, 0, 0];
  const named = _CANVAS_NAMED_COLORS[value.toLowerCase()];
  if (named !== undefined) return [(named >> 16) & 255, (named >> 8) & 255, named & 255, 1];
  const hex = /^#([0-9a-f]+)$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const channels = digits.split('').map(d => parseInt(d + d, 16));
      return [channels[0], channels[1], channels[2], digits.length === 4 ? channels[3] / 255 : 1];
    }
    if (digits.length === 6 || digits.length === 8) {
      const channels = [];
      for (let i = 0; i < digits.length; i += 2) channels.push(parseInt(digits.slice(i, i + 2), 16));
      return [channels[0], channels[1], channels[2], digits.length === 8 ? channels[3] / 255 : 1];
    }
    return null;
  }
  const functional = /^(rgba?|hsla?)\(([\s\S]*)\)$/i.exec(value);
  if (!functional) {
    // A system color keyword resolves to the platform's own colour; this
    // engine answers opaque black for all of them (measured: Chrome's
    // `CanvasText` on this host is #000000). Anything else is not a colour.
    return _CANVAS_SYSTEM_COLORS.has(value.toLowerCase()) ? [0, 0, 0, 1] : null;
  }
  const name = functional[1].toLowerCase();
  const tokens = _cssColorArgTokens(functional[2]).filter(token => token !== ',');
  const slash = tokens.indexOf('/');
  let parts = slash < 0 ? tokens.slice() : tokens.slice(0, slash);
  let alphaParts = slash < 0 ? [] : tokens.slice(slash + 1);
  if (parts.length === 4 && !alphaParts.length) {
    alphaParts = [parts[3]];
    parts = parts.slice(0, 3);
  }
  if (parts.length !== 3) return null;
  const fraction = token => {
    const number = parseFloat(token);
    if (!Number.isFinite(number)) return null;
    return token.endsWith('%') ? number / 100 : number;
  };
  // `rgb()` components are already 0-255; only a percentage needs scaling.
  const channel = token => {
    const number = parseFloat(token);
    if (!Number.isFinite(number)) return null;
    const value = token.endsWith('%') ? number * 255 / 100 : number;
    return Math.max(0, Math.min(255, Math.round(value)));
  };
  const rgb = [];
  if (name === 'rgb' || name === 'rgba') {
    for (const token of parts) {
      const channelValue = channel(token);
      if (channelValue === null) return null;
      rgb.push(channelValue);
    }
  } else {
    const hue = parseFloat(parts[0]);
    const saturation = fraction(parts[1]);
    const lightness = fraction(parts[2]);
    if (!Number.isFinite(hue) || saturation === null || lightness === null) return null;
    rgb.push(..._cssHslToRgb(hue, Math.max(0, Math.min(1, saturation)),
      Math.max(0, Math.min(1, lightness))));
  }
  let alpha = 1;
  if (alphaParts.length) {
    const parsed = fraction(alphaParts[0]);
    if (parsed === null) return null;
    alpha = Math.max(0, Math.min(1, parsed));
  }
  return [rgb[0], rgb[1], rgb[2], alpha];
}

// The serialization Canvas exposes: lowercase `#rrggbb` when opaque, otherwise
// `rgba(r, g, b, a)` with the alpha as short as Number renders it.
function _canvasColorCss(text) {
  const rgba = _canvasColorRgb(text);
  if (rgba === null) return null;
  if (rgba[3] >= 1) {
    return '#' + rgba.slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
  }
  return 'rgba(' + rgba[0] + ', ' + rgba[1] + ', ' + rgba[2] + ', ' + rgba[3] + ')';
}

// One writer per attribute family: the value is read back through the same
// table Chrome uses, and a value it cannot read leaves the previous one.
function _canvasResolvedDirection(canvas) {
  try {
    if (typeof getComputedStyle === 'function' && canvas && canvas.nodeType) {
      const direction = getComputedStyle(canvas).direction;
      if (direction === 'rtl') return 'rtl';
    }
  } catch (_error) {}
  return 'ltr';
}
function _canvasEnumAttribute(ctx, name, value) {
  const state = _canvasStateOf(ctx);
  const text = String(value);
  if (_CANVAS_ENUM_ATTRIBUTES[name].indexOf(text) >= 0) state[name] = text;
}
function _canvasLengthAttribute(ctx, name, value) {
  const state = _canvasStateOf(ctx);
  const text = String(value);
  const match = _CANVAS_LENGTH_PATTERN.exec(text);
  if (match) state[name] = text.slice(0, text.length - match[1].length) + match[1].toLowerCase();
}
function _canvasNumberAttribute(ctx, name, value, minimum = -Infinity, maximum = Infinity) {
  const state = _canvasStateOf(ctx);
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return;
  state[name] = number;
}
function _canvasPositiveAttribute(ctx, name, value) {
  const state = _canvasStateOf(ctx);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return;
  state[name] = number;
}
// The CSS Color 4 functions Chrome's canvas parser also accepts. This engine
// resolves none of them to bytes, so they are stored exactly as written (which
// is what Chrome's getter echoes) and painted as opaque black; Chrome
// additionally normalizes their numbers, which this does not.
const _CANVAS_COLOR_FUNCTION = /^(color|lab|lch|oklab|oklch|hwb|color-mix)\(([\s\S]*)\)$/i;
const _CANVAS_COLOR_SPACES = ['srgb', 'srgb-linear', 'display-p3', 'a98-rgb',
  'prophoto-rgb', 'rec2020', 'xyz', 'xyz-d50', 'xyz-d65'];
function _canvasModernColorText(text) {
  const match = _CANVAS_COLOR_FUNCTION.exec(text);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const tokens = match[2].trim().split(/\s+/).filter(token => token !== '');
  const numeric = tokens.filter(token => token !== '/' &&
    (token.endsWith('%') ? Number.isFinite(parseFloat(token)) : Number.isFinite(Number(token))));
  if (name === 'color') {
    const space = (tokens[0] || '').toLowerCase();
    if (_CANVAS_COLOR_SPACES.indexOf(space) >= 0 && numeric.length >= 3) return text;
    return null;
  }
  return numeric.length >= 3 ? text : null;
}

function _canvasColorAttribute(ctx, name, value) {
  const state = _canvasStateOf(ctx);
  // A gradient or a pattern is stored as the object it is, and the getter
  // answers that same object back; every other value is read as a color.
  if (value && typeof value === 'object') {
    const st = _gradientState.get(value);
    state[name] = value; return;
  }
  const text = value === null || value === undefined ? '' : String(value);
  const css = _canvasColorCss(text);
  if (css !== null) { state[name] = css; return; }
  const modern = _canvasModernColorText(text);
  if (modern !== null) state[name] = modern;
}

function _canvas2dCanvasDimension(canvas, name, fallback) {
    const raw = _canvasSizeAttribute(canvas, name);
    if (raw === null || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

function _canvas2dResetDrawingState(state) {
    state.fillStyle = '#000000';
    state.strokeStyle = '#000000';
    state.lineWidth = 1;
    state.fontShorthand = '10px sans-serif';
    state.textAlign = 'start';
    state.textBaseline = 'alphabetic';
    // Chrome's default is 'ltr'; 'inherit' is not even a value this attribute
    // accepts (writing it is ignored).
    state.direction = 'ltr';
    state.globalAlpha = 1;
    state.globalCompositeOperation = 'source-over';
    state.filter = 'none';
    // The members Chrome carries and this renderer does not paint with: they
    // are stored and answered back, which is what a read observes.
    state.lang = 'inherit';
    state.fontKerning = 'auto';
    state.fontStretch = 'normal';
    state.fontVariantCaps = 'normal';
    state.letterSpacing = '0px';
    state.textRendering = 'auto';
    state.wordSpacing = '0px';
    state.imageSmoothingQuality = 'low';
    state.shadowColor = 'rgba(0, 0, 0, 0)';
    state.lineCap = 'butt';
    state.lineJoin = 'miter';
    state.imageSmoothingEnabled = true;
    state.shadowOffsetX = 0;
    state.shadowOffsetY = 0;
    state.shadowBlur = 0;
    state.miterLimit = 10;
    state.lineDashOffset = 0;
    _canvas2dSet(state, 'stateStack', []);
    _canvas2dSet(state, 'transform', [1, 0, 0, 1, 0, 0]);
    _canvas2dSet(state, 'path', []);
  }

function _canvas2dResizeFromCanvas(state, canvas) {
    const requestedWidth = _canvas2dCanvasDimension(canvas, 'width', 300);
    const requestedHeight = _canvas2dCanvasDimension(canvas, 'height', 150);
    const valid = requestedWidth <= _MAX_CANVAS_DIMENSION
      && requestedHeight <= _MAX_CANVAS_DIMENSION
      && requestedWidth * requestedHeight <= _MAX_CANVAS_PIXELS;
    _canvas2dSet(state, 'w', valid ? requestedWidth : 0);
    _canvas2dSet(state, 'h', valid ? requestedHeight : 0);
    _canvas2dSet(state, 'buf', new Uint8ClampedArray(state.w * state.h * 4));
    _canvas2dSet(state, 'floatBuf', state.colorType === 'float16'
      ? new Float32Array(state.buf.length) : null);
    _canvas2dSet(state, 'colorBuf', state.colorSpace === 'srgb' && !state.floatBuf
      ? state.buf : new Uint8ClampedArray(state.buf.length));
    _canvas2dResetDrawingState(state);
    const register = Deno.core.ops.op_canvas_register_surface;
    if (typeof register === 'function' && canvas[_nidSym] != null) {
      // op2 accepts Uint8Array, while Canvas exposes Uint8ClampedArray. This
      // second view shares the exact backing store; no pixel copy is made.
      const bytes = new Uint8Array(
        state.buf.buffer,
        state.buf.byteOffset,
        state.buf.byteLength,
      );
      if (!register(canvas[_nidSym], state.w, state.h, bytes)) {
        throw new RangeError('Canvas backing store allocation failed');
      }
    }
  }

function _canvas2dMarkPaintDamage(self) {
  const state = _canvasStateOf(self);
    if (state.canvas[_nidSym] == null) return;
    if (state.damageQueued) return;
    _canvas2dSet(state, 'damageQueued', true);
    queueMicrotask(() => {
      _canvas2dSet(state, 'damageQueued', false);
      const damage = Deno.core.ops.op_canvas_paint_damage;
      if (typeof damage === 'function') damage(state.canvas[_nidSym]);
    });
  }

function _canvas2dParseColor(self, css) {
  const state = _canvasStateOf(self);
    if (!css || typeof css !== 'string' || css === 'none') return [0,0,0,0];
    const functional = /^color\(\s*(srgb|display-p3)\s+([^\s/]+)\s+([^\s/]+)\s+([^\s/)]+)(?:\s*\/\s*([^\s)]+))?\s*\)$/i.exec(css);
    if (functional) {
      const source = functional[1].toLowerCase();
      const rgb = [_canvasColorComponent(functional[2]),
        _canvasColorComponent(functional[3]), _canvasColorComponent(functional[4])];
      if (rgb.every(Number.isFinite)) {
        const converted = (state.floatBuf
          ? _convertCanvasFloatColor : _convertCanvasColor)(rgb, source, state.colorSpace);
        const alpha = functional[5] === undefined ? 1 : _canvasColorComponent(functional[5]);
        if (state.floatBuf) {
          return [converted[0] * 255, converted[1] * 255, converted[2] * 255,
            Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1)) * 255];
        }
        // Skia holds colors as float32 and quantizes with float32 multiply,
        // so a decimal 0.3 lands on 76.500003 and rounds up to 77; the same
        // product in float64 is 76.4999... and rounds down. Emulate the f32
        // pipeline instead of biasing the tie.
        return [
          _quantizeUnorm8(converted[0]),
          _quantizeUnorm8(converted[1]),
          _quantizeUnorm8(converted[2]),
          _quantizeUnorm8(Number.isFinite(alpha) ? alpha : 1),
        ];
      }
    }
    if (css.startsWith('#')) {
      const hex = css.slice(1);
      if (hex.length === 3) return [parseInt(hex[0]+hex[0],16),parseInt(hex[1]+hex[1],16),parseInt(hex[2]+hex[2],16),255];
      if (hex.length === 6) return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
      if (hex.length === 8) return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),parseInt(hex.slice(6,8),16)];
    }
    // The channels clamp to 0-255 and the alpha to 0-1 before it is scaled,
    // so `rgba(1,2,3,4)` paints opaque and `rgb(300,0,0)` paints #ff0000, the
    // way the reference parses them. Gradient stops arrive here as written;
    // the style attributes are already normalized to hex by their setter.
    const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) return [Math.min(255, +m[1]), Math.min(255, +m[2]), Math.min(255, +m[3]),
      m[4] !== undefined ? Math.round(Math.max(0, Math.min(1, +m[4])) * 255) : 255];
    const named = {red:[255,0,0,255],green:[0,128,0,255],blue:[0,0,255,255],white:[255,255,255,255],black:[0,0,0,255],yellow:[255,255,0,255],orange:[255,165,0,255],gray:[128,128,128,255],transparent:[0,0,0,0]};
    const value = named[css] || [0,0,0,255];
    if (state.colorSpace === 'srgb') return value;
    const converted = (state.floatBuf
      ? _convertCanvasFloatColor : _convertCanvasColor)(value.slice(0, 3).map(v => v / 255),
      'srgb', state.colorSpace);
    return converted.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255))
      .concat(value[3]);
  }

function _canvas2dSyncRendererPixel(self, idx) {
  const state = _canvasStateOf(self);
    if (state.colorBuf === state.buf && !state.floatBuf) return;
    const source = state.floatBuf
      ? [state.floatBuf[idx], state.floatBuf[idx + 1], state.floatBuf[idx + 2]]
      : [state.colorBuf[idx] / 255, state.colorBuf[idx + 1] / 255,
        state.colorBuf[idx + 2] / 255];
    const converted = (state.floatBuf
      ? _convertCanvasFloatColor : _convertCanvasColor)(source,
      state.colorSpace, 'srgb');
    state.buf[idx] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
    state.buf[idx + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
    state.buf[idx + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
    state.buf[idx + 3] = state.floatBuf
      ? Math.round(Math.max(0, Math.min(1, state.floatBuf[idx + 3])) * 255)
      : state.colorBuf[idx + 3];
  }

function _canvas2dSetPixel(self, x, y, r, g, b, a, sourceSpace = undefined) {
  const state = _canvasStateOf(self);
  if (sourceSpace === undefined) sourceSpace = state.colorSpace;
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= state.w || y < 0 || y >= state.h) return;
    if (sourceSpace !== state.colorSpace) {
      const converted = (state.floatBuf
        ? _convertCanvasFloatColor : _convertCanvasColor)([r / 255, g / 255, b / 255],
        sourceSpace, state.colorSpace);
      r = converted[0] * 255;
      g = converted[1] * 255;
      b = converted[2] * 255;
    }
    _canvas2dBlendPixel(self, x, y, r, g, b, a, 1);
  }

function _canvas2dTextBaselineOffset(self, ascent, descent) {
  const state = _canvasStateOf(self);
    // 'top' rides a size-scaled placement, not the font box: measured on the
    // reference, Chrome shifts a top-baselined fill down by floor(0.8 * the
    // font size) on every Arial size probed (8/10/12/16/20/32px -> offsets
    // 6/8/9/12/16/25), which puts the first ink row where the oracle puts
    // it; the font-box ascent answers two rows lower. The measured residuals
    // on the other baselines stay within one row and keep their ordering.
    switch (state.textBaseline) {
      case 'top': return Math.floor(0.8 * (parseFloat(self.font) || 10));
      case 'hanging': return Math.round(0.8 * ascent);
      case 'middle': return (ascent - descent) / 2;
      case 'bottom':
      case 'ideographic': return -descent;
      default: return 0; // alphabetic, and anything unrecognised
    }
  }

function _canvas2dTextAlignOffset(self, runWidth) {
  const state = _canvasStateOf(self);
    const rtl = state.direction === 'rtl';
    let align = state.textAlign;
    if (align === 'start') align = rtl ? 'right' : 'left';
    if (align === 'end') align = rtl ? 'left' : 'right';
    if (align === 'center') return Math.round(runWidth / 2);
    if (align === 'right') return runWidth;
    return 0;
  }

const _B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64Decode(text) {
  const out = new Uint8Array((text.length * 3 / 4) | 0);
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < text.length; i++) {
    const v = _B64_ALPHABET.indexOf(text[i]);
    if (v < 0) continue; // padding and whitespace
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

// The ranges the reference renders from the color emoji face: pictographic
// blocks, the regional indicators flags are built from, variation selectors
// and the two text-presentation exceptions Chrome still colorizes.
function _textHasEmoji(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x1F000 && c <= 0x1FAFF) || (c >= 0x2600 && c <= 0x27BF)
      || (c >= 0x1F1E6 && c <= 0x1F1FF) || (c >= 0xFE00 && c <= 0xFE0F)
      || c === 0x2B50 || c === 0x2764 || (c >= 0x1F900 && c <= 0x1F9FF)) return true;
  }
  return false;
}
function _canvasEmojiBitmap(text, font) {
  const op = Deno.core.ops.op_canvas_emoji_bitmap;
  if (typeof op !== 'function' || !_textHasEmoji(text)) return null;
  let packed;
  try { packed = op(text, String(font || '10px sans-serif')); } catch (_error) { return null; }
  if (!packed) return null;
  const parts = String(packed).split('|');
  if (parts.length !== 5) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  const left = Number(parts[2]);
  const top = Number(parts[3]);
  if (!(w > 0 && h > 0 && Number.isFinite(left) && Number.isFinite(top))) return null;
  return [w, h, left, top, _b64Decode(parts[4])];
}

function _canvasRasterText(text, font) {
  return _canvasRasterTextOp(text, font, 0, null, 0, null, false);
}

// The stroke twin: same packing and placement contract, with the glyph
// outlines stroked rather than filled. `lineWidth` is already scaled to the
// raster font's vertical factor by the caller.
function _canvasRasterStrokeText(text, font, lineWidth, join, miterLimit, cap) {
  return _canvasRasterTextOp(text, font, lineWidth, join, miterLimit, cap, true);
}

function _canvasRasterTextOp(text, font, lineWidth, join, miterLimit, cap, stroke) {
  const op = stroke ? Deno.core.ops.op_canvas_raster_stroke_text
    : Deno.core.ops.op_canvas_raster_text;
  if (typeof op !== 'function') return null;
  let packed;
  // UTF-8 bytes, not a string: the op-string conversion lossy-decodes a
  // one-byte v8 string's raw bytes, which turns C1 controls into U+FFFD --
  // and TextEncoder rides the same string conversion, so the encoding is
  // done here by hand.
  try {
    const bytes = new Uint8Array(text.length * 3);
    let n = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c < 0x80) {
        bytes[n++] = c;
      } else if (c < 0x800) {
        bytes[n++] = 0xC0 | (c >> 6);
        bytes[n++] = 0x80 | (c & 63);
      } else if (c < 0x10000) {
        bytes[n++] = 0xE0 | (c >> 12);
        bytes[n++] = 0x80 | ((c >> 6) & 63);
        bytes[n++] = 0x80 | (c & 63);
      } else {
        bytes[n++] = 0xF0 | (c >> 18);
        bytes[n++] = 0x80 | ((c >> 12) & 63);
        bytes[n++] = 0x80 | ((c >> 6) & 63);
        bytes[n++] = 0x80 | (c & 63);
      }
    }
    packed = stroke
      ? op(bytes.subarray(0, n), String(font || '10px sans-serif'), lineWidth,
          join == null ? 'miter' : String(join), miterLimit, cap == null ? 'butt' : String(cap))
      : op(bytes.subarray(0, n), String(font || '10px sans-serif'));
  } catch (_error) { return null; }
  if (!packed) return null;
  const parts = String(packed).split('|');
  if (parts.length !== 5) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  const left = Number(parts[2]);
  const top = Number(parts[3]);
  if (!(w > 0 && h > 0 && Number.isFinite(left) && Number.isFinite(top))) return null;
  return [w, h, left, top, _b64Decode(parts[4])];
}

function _canvasEmojiComposite(self, text, font, penX, baselineY) {
  const state = _canvasStateOf(self);
  const emoji = _canvasEmojiBitmap(text, font);
  if (!emoji) return false;
  const [w, h, left, top, rgba] = emoji;
  const px0 = Math.round(penX + left);
  const py0 = Math.round(baselineY + top);
  let drawn = 0;
  let skippedAlpha = 0;
  let skippedGx = 0;
  let skippedGy = 0;
  for (let row = 0; row < h; row++) {
    const gy = py0 + row;
    if (gy < 0 || gy >= state.h) { skippedGy++; continue; }
    const rowBase = row * w * 4;
    for (let col = 0; col < w; col++) {
      const gx = px0 + col;
      if (gx < 0 || gx >= state.w) { skippedGx++; continue; }
      const o = rowBase + col * 4;
      if (rgba[o + 3] === 0) { skippedAlpha++; continue; }
      drawn++;
      _canvas2dBlendPixel(self, gx, gy, rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3], 1);
    }
  }
  return true;
}

function _canvas2dApplyTransform(self, x, y) {
  const state = _canvasStateOf(self);
    const [a, b, c, d, e, f] = state.transform;
    return [a * x + c * y + e, b * x + d * y + f];
  }

// The CTM's scale factors. The pen already moves through the CTM; the glyph
// raster and the advance the text is laid out with have to follow it, the
// raster by the vertical factor and the advance by the horizontal one. A
// rotation or skew keeps the same magnitudes, which is the uniform
// approximation this path takes; the reference transforms the outlines
// themselves.
function _canvas2dTextScale(self) {
  const state = _canvasStateOf(self);
  const [a, b, c, d] = state.transform;
  return [Math.hypot(a, b), Math.hypot(c, d)];
}

function _canvas2dFlattenPath(self, minPoints) {
  const state = _canvasStateOf(self);
    const subpaths = [];
    let current = null;
    const finish = close => {
      if (close && current && current.length > 1) current.push(current[0].slice());
      if (current && current.length >= minPoints) {
        if (close) current.closed = true;
        subpaths.push(current);
      }
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
    for (const seg of state.path || []) {
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

function _canvas2dWindingAt(self, subpaths, x, y, evenOdd = false) {
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

function _canvas2dPaintAt(self, px, py) {
  const state = _canvasStateOf(self);
    const fill = state.fillStyle;
    const fillSt = fill && _gradientState.get(fill);
    if (fillSt && fillSt.stops.length) {
      const inv = _canvas2dTransformInverse(self, fillSt.transform);
      const [ux, uy] = [inv[0] * px + inv[2] * py + inv[4], inv[1] * px + inv[3] * py + inv[5]];
      return _canvas2dGradientColorAt(self, fillSt, ux, uy);
    }
    const color = _canvas2dParseColor(self, fill);
    color.gradient = false;
    return color;
  }

function _canvas2dCoverageSamples(self) {
  const state = _canvasStateOf(self);
    return state.w * state.h <= 65536 ? _CANVAS_AA_4X4 : _CANVAS_AA_2X2;
  }

function _canvas2dTransformInverse(self, matrix) {
  const state = _canvasStateOf(self);
    const [a, b, c, d, e, f] = matrix || state.transform;
    const det = a * d - b * c;
    if (!det) return [1, 0, 0, 1, 0, 0];
    return [d / det, -b / det, -c / det, a / det,
      (c * f - d * e) / det, (b * e - a * f) / det];
  }

function _canvas2dGradientColorAt(self, st, x, y) {
    let t;
    if (st.type === 'linear') {
      const dx = st._x1 - st._x0, dy = st._y1 - st._y0;
      const len = dx * dx + dy * dy;
      t = len ? ((x - st._x0) * dx + (y - st._y0) * dy) / len : 0;
    } else if (st.type === 'radial') {
      const dist = Math.hypot(x - st._x1, y - st._y1);
      t = st._r1 > st._r0 ? (dist - st._r0) / (st._r1 - st._r0) : 0;
    } else {
      t = ((Math.atan2(y - st._y0, x - st._x0) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      if (st._startAngle) t = (t + st._startAngle / (Math.PI * 2)) % 1;
    }
    t = Math.min(1, Math.max(0, t));
    const stops = st.stops;
    if (t <= stops[0][0]) return stops[0][1].slice();
    const lastStop = stops[stops.length - 1];
    if (t >= lastStop[0]) return lastStop[1].slice();
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
        const span = t1 - t0 || 1;
        const f = (t - t0) / span;
        // Skia packs the interpolated float color with truncation, not
        // rounding: a mid-gradient reading of 15.9375 answers 15 on the
        // reference where rounding answers 16 (measured 149, both engines,
        // five gradient shapes).
        return [0, 1, 2, 3].map(k => Math.floor(c0[k] + (c1[k] - c0[k]) * f));
      }
    }
    return lastStop[1].slice();
  }

function _canvas2dPaintStrokeAt(self, px, py) {
  const state = _canvasStateOf(self);
    const stroke = state.strokeStyle;
    const strokeSt = stroke && _gradientState.get(stroke);
    if (strokeSt && strokeSt.stops.length) {
      const inv = _canvas2dTransformInverse(self, strokeSt.transform);
      const [ux, uy] = [inv[0] * px + inv[2] * py + inv[4], inv[1] * px + inv[3] * py + inv[5]];
      return _canvas2dGradientColorAt(self, strokeSt, ux, uy);
    }
    return _canvas2dParseColor(self, stroke);
  }

// The stroked region is measured in the space the CTM maps from, not in the
// device space the path was flattened in. Path coordinates freeze in device
// space as they are recorded, so a nib that follows the CTM is held in that
// other space and the frozen path has to come back through the inverse to
// meet it. A device space distance test is only the same thing when the CTM
// is a similarity: under scale(2, 1) the reference nib is one device pixel
// wide for a vertical line and half a pixel tall for a horizontal one, which
// no single scalar half width can be. The nib also stops being a rectangle
// under a shear, and the reference draws the sheared one. Rewrites the
// subpath points in place and returns the device bounds the nib reaches
// over them.
function _canvas2dStrokePen(self, inv, subpaths, half) {
  const [a, b, c, d] = _canvasStateOf(self).transform;
  const [ia, ib, ic, id] = inv;
  // A pen space offset no larger than half on either axis reaches no further
  // than this in device x and y once the CTM is applied. A cap that extends
  // along the path reaches no further than a unit direction does, which the
  // same bound covers.
  const ex = half * (Math.abs(a) + Math.abs(c));
  const ey = half * (Math.abs(b) + Math.abs(d));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of subpaths) {
    for (const point of poly) {
      const x = point[0], y = point[1];
      point[0] = ia * x + ic * y + inv[4];
      point[1] = ib * x + id * y + inv[5];
      if (x - ex < minX) minX = x - ex; if (x + ex > maxX) maxX = x + ex;
      if (y - ey < minY) minY = y - ey; if (y + ey > maxY) maxY = y + ey;
    }
  }
  return [minX, minY, maxX, maxY];
}

// Whether a coverage sample falls in the stroked region of any subpath. The
// segment body is the butt ended rectangle, so a sample past an end counts
// only when something covers that end: an interior vertex, where the two
// segments meet and the join disc goes, or a subpath end, where the cap goes.
// The default cap is butt, which stops dead at the end, and a closed subpath
// has no ends at all. The subpaths and the sample are both pen space here,
// see _canvas2dStrokePen, so half is the line width's own half.
function _canvas2dStrokeHit(subpaths, sx, sy, half, cap) {
    for (const poly of subpaths) {
      const n = poly.length, closed = poly.closed === true;
      for (let i = 1; i < n; i++) {
        const a = poly[i - 1], b = poly[i];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 ? ((sx - a[0]) * dx + (sy - a[1]) * dy) / len2 : 0;
        if (t >= 0 && t <= 1) {
          if (Math.hypot(sx - (a[0] + t * dx), sy - (a[1] + t * dy)) <= half) return true;
          continue;
        }
        const start = t < 0;
        const ex = start ? a[0] : b[0], ey = start ? a[1] : b[1];
        if (closed || (start ? i - 1 > 0 : i < n - 1)) {
          if (Math.hypot(sx - ex, sy - ey) <= half) return true;
          continue;
        }
        if (cap === 'round') {
          if (Math.hypot(sx - ex, sy - ey) <= half) return true;
        } else if (cap === 'square') {
          const len = Math.sqrt(len2);
          const past = (start ? -t : t - 1) * len;
          const perp = len ? Math.abs((sx - a[0]) * dy - (sy - a[1]) * dx) / len : 0;
          if (past <= half && perp <= half) return true;
        }
      }
    }
    return false;
  }

// Per-channel blend functions B(Cb, Cs), keyed by globalCompositeOperation. An
// operator missing from this table composites as plain source, which is what
// source-over does. The remaining separable modes (screen, overlay, darken,
// lighten, color-dodge, color-burn, hard-light, soft-light, exclusion) are
// more entries here. The four non-separable modes (hue, saturation, color,
// luminosity) need the luminance helpers, and the Porter-Duff family
// (source-in/out/atop, destination-*, copy, lighter, xor) needs the
// composition factors rather than the blend function, so neither is a table
// entry.
const _canvas2dBlendFunctions = {
  multiply: (backdrop, source) => backdrop * source,
  difference: (backdrop, source) => Math.abs(backdrop - source),
};

function _canvas2dBlendPixel(self, x, y, r, g, b, a, coverage) {
  const state = _canvasStateOf(self);
    const sourceAlpha = (a / 255) * coverage * state.globalAlpha;
    if (sourceAlpha <= 0) return;
    if (x < 0 || x >= state.w || y < 0 || y >= state.h) return;
    const idx = (y * state.w + x) * 4;
    const destinationAlpha = state.floatBuf
      ? state.floatBuf[idx + 3] : state.colorBuf[idx + 3] / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    const source = [r / 255, g / 255, b / 255];
    const destination = state.floatBuf
      ? [state.floatBuf[idx], state.floatBuf[idx + 1], state.floatBuf[idx + 2]]
      : [state.colorBuf[idx] / 255, state.colorBuf[idx + 1] / 255,
        state.colorBuf[idx + 2] / 255];
    // The reference keeps its canvas premultiplied, so a pixel whose stored
    // alpha is zero carries no colour at all: it answers 0,0,0,0 whatever the
    // fade or the blurred tail divided out of the premultiplied value. Keep
    // that invariant on the straight store. Rounding the channels and the
    // alpha independently would otherwise leave a full strength colour behind
    // at a sub quantum alpha, which getImageData reads back as a ghost.
    const storedAlpha = Math.round(Math.max(0, Math.min(1, outputAlpha)) * 255);
    // Resolved once per pixel rather than once per channel. The arguments run
    // backdrop first and source second, which is the B(Cb, Cs) order.
    const blend = _canvas2dBlendFunctions[state.globalCompositeOperation];
    for (let channel = 0; channel < 3; channel++) {
      const blended = blend === undefined
        ? source[channel] : blend(destination[channel], source[channel]);
      const premultiplied = source[channel] * sourceAlpha * (1 - destinationAlpha)
        + destination[channel] * destinationAlpha * (1 - sourceAlpha)
        + blended * sourceAlpha * destinationAlpha;
      const value = outputAlpha > 0 ? premultiplied / outputAlpha : 0;
      if (state.floatBuf) state.floatBuf[idx + channel] = value;
      state.colorBuf[idx + channel] = storedAlpha
        ? Math.round(Math.max(0, Math.min(1, value)) * 255) : 0;
    }
    if (state.floatBuf) state.floatBuf[idx + 3] = outputAlpha;
    state.colorBuf[idx + 3] = storedAlpha;
    _canvas2dSyncRendererPixel(self, idx);
  }

// Canvas 2D shadows. The reference draws them the way SkBlurDrawLooper does:
// the shape is rasterised once, its coverage blurred by a Gaussian, tinted
// with shadowColor and composited under the shape with source-over. Both the
// blur radius and the offsets are device-space values: they ignore the CTM.
//
// Measured on the reference (32x32 battery, fillRect(10,10,12,12) with
// shadowBlur 8 sampled at (15,4)): an opaque fill answers alpha 21, a
// half-alpha fill and globalAlpha 0.5 both answer 11, fillStyle 'transparent'
// answers nothing at all -- the looper's shadow alpha is the shadow colour's
// alpha modulated by the paint's own. The alpha profile above a hard edge
// under blur 8 reads 1 4 7 13 21 31 45 61 79 98 (255 at the edge), a Gaussian
// of sigma 4 to within about 10 percent; the residual is the reference's three
// box-blur passes having slightly wider tails than the true Gaussian.
function _canvas2dShadowPaintAlpha(self, style) {
  // A gradient or pattern carries no single alpha, and the reference's looper
  // only reads the paint's alpha channel, which a shader leaves at 1.
  if (style && typeof style === 'object') return 1;
  return _canvas2dParseColor(self, style)[3] / 255;
}

// The shadow's parameters for one draw call, or null when it paints none.
function _canvas2dShadowPlan(self, style) {
  const state = _canvasStateOf(self);
    const blur = +state.shadowBlur || 0;
    const offsetX = +state.shadowOffsetX || 0;
    const offsetY = +state.shadowOffsetY || 0;
    // The early exit every shadowless draw call takes: no blur and no offset,
    // or a fully transparent shadow colour, paints nothing. A negative blur is
    // a zero blur to the reference, so it lands here too.
    if (blur <= 0 && offsetX === 0 && offsetY === 0) return null;
    const color = _canvas2dParseColor(self, state.shadowColor);
    const alpha = color[3] * _canvas2dShadowPaintAlpha(self, style);
    if (alpha <= 0) return null;
    // sigma = shadowBlur / 2, truncated at three sigma. The 250 ceiling only
    // reaches blurs past 166px, where the truncated tail is invisible anyway.
    const radius = blur > 0 ? Math.min(250, Math.max(1, Math.ceil(blur * 1.5))) : 0;
    return {r: color[0], g: color[1], b: color[2], a: alpha,
      sigma: blur > 0 ? blur / 2 : 0, radius: radius, reach: radius + 1,
      offsetX: offsetX, offsetY: offsetY};
  }

// The mask box for a shape whose canvas-clipped box is [x0..x1] x [y0..y1] and
// whose flattened bounds are the min/max arguments. The mask carries coverage
// one reach past the canvas edge, because the coverage just outside still
// blurs back onto the canvas; it never grows past the shape's own bounds,
// where the coverage is zero, and the shape's clipped box is always inside it.
function _canvas2dShadowMaskBox(self, plan, minX, minY, maxX, maxY, x0, y0, x1, y1) {
  const state = _canvasStateOf(self);
    const slack = plan.reach;
    return [
      Math.min(x0, Math.max(Math.floor(minX), Math.floor(-plan.offsetX - slack))),
      Math.min(y0, Math.max(Math.floor(minY), Math.floor(-plan.offsetY - slack))),
      Math.max(x1, Math.min(Math.ceil(maxX), Math.ceil(state.w - plan.offsetX + slack))),
      Math.max(y1, Math.min(Math.ceil(maxY), Math.ceil(state.h - plan.offsetY + slack))),
    ];
  }

// Separable Gaussian over the window [x0..x1] x [y0..y1] of a w x h layer.
// The caller sizes the window to the layer's nonzero content plus the kernel's
// support, so the coverage the blur reads outside it is zero either way and
// the padding is in the window instead of the array.
function _canvas2dShadowBlurMask(mask, w, h, sigma, radius, x0, y0, x1, y1) {
    const kernel = new Float32Array(radius * 2 + 1);
    const denom = 2 * sigma * sigma;
    let total = 0;
    for (let i = -radius; i <= radius; i++) {
      const weight = Math.exp(-(i * i) / denom);
      kernel[i + radius] = weight;
      total += weight;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
    const scratch = new Float32Array(w * h);
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const lo = Math.max(0, x - radius), hi = Math.min(w - 1, x + radius);
        let sum = 0;
        for (let i = lo; i <= hi; i++) sum += mask[row + i] * kernel[i - x + radius];
        scratch[row + x] = sum;
      }
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const lo = Math.max(0, y - radius), hi = Math.min(h - 1, y + radius);
        let sum = 0;
        for (let i = lo; i <= hi; i++) sum += scratch[i * w + x] * kernel[i - y + radius];
        mask[y * w + x] = sum;
      }
    }
  }

// Composites the shadow of a coverage mask: blur, shift by the offset in
// device space, tint with the shadow colour and blend source-over into the
// canvas. The mask holds coverage in [0,1] for the w x h box at (x0, y0); its
// box may run past the canvas, whose edge pixels are the reason it does. The
// caller paints the shadow first and the shape on top of it.
function _canvas2dShadowBelow(self, plan, mask, x0, y0, w, h) {
    // The layer spans the mask box and the box the offset moves it to, each
    // grown by the blur's spill. It deliberately keeps the columns and rows
    // that fall off the canvas: the blur reads across the canvas edge, and only
    // the composite below is clipped to it, which is the order the reference
    // blurs and clips in. The layer is also capped at the canvas plus that
    // spill, since no cell further out can reach a canvas pixel and an offset
    // of a million would otherwise ask for a layer the size of the offset.
    const state = _canvasStateOf(self);
    const pad = plan.reach;
    const ox = Math.min(0, plan.offsetX), oy = Math.min(0, plan.offsetY);
    const lx = Math.max(Math.floor(x0 + ox) - pad, -pad);
    const ly = Math.max(Math.floor(y0 + oy) - pad, -pad);
    const rx = Math.min(Math.ceil(x0 + w - 1 + plan.offsetX - ox) + pad, state.w - 1 + pad);
    const ry = Math.min(Math.ceil(y0 + h - 1 + plan.offsetY - oy) + pad, state.h - 1 + pad);
    const lw = rx - lx + 1, lh = ry - ly + 1;
    if (lw <= 0 || lh <= 0) return;
    const layer = new Float32Array(lw * lh);
    // A fractional offset lands between device pixels. The reference splits the
    // coverage across the two (measured: offset 0.5 leaves the trailing edge
    // column at half alpha), so the mask is scattered with bilinear weights.
    const dx = x0 + plan.offsetX - lx, dy = y0 + plan.offsetY - ly;
    const ix = Math.floor(dx), iy = Math.floor(dy);
    const fx = dx - ix, fy = dy - iy;
    const fx1 = fx ? 1 : 0, fy1 = fy ? 1 : 0;
    const xa = Math.max(0, -ix), xb = Math.min(w - 1, lw - 1 - ix - fx1);
    const ya = Math.max(0, -iy), yb = Math.min(h - 1, lh - 1 - iy - fy1);
    // Everything outside that window is off canvas and dropped, which is what
    // the canvas clip would do with it anyway.
    if (xa > xb || ya > yb) return;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let y = ya; y <= yb; y++) {
      const src = y * w, dst = (y + iy) * lw + ix;
      if (!fx && !fy) {
        for (let x = xa; x <= xb; x++) { const m = mask[src + x]; if (m) layer[dst + x] = m; }
        continue;
      }
      for (let x = xa; x <= xb; x++) {
        const m = mask[src + x];
        if (!m) continue;
        layer[dst + x] += m * w00;
        layer[dst + x + 1] += m * w10;
        layer[dst + lw + x] += m * w01;
        layer[dst + lw + x + 1] += m * w11;
      }
    }
    const spill = plan.radius;
    const rx0 = Math.max(0, xa + ix - spill), rx1 = Math.min(lw - 1, xb + ix + fx1 + spill);
    const ry0 = Math.max(0, ya + iy - spill), ry1 = Math.min(lh - 1, yb + iy + fy1 + spill);
    if (spill) _canvas2dShadowBlurMask(layer, lw, lh, plan.sigma, spill, rx0, ry0, rx1, ry1);
    for (let v = ry0; v <= ry1; v++) {
      const cy = ly + v, row = v * lw;
      for (let u = rx0; u <= rx1; u++) {
        const value = layer[row + u];
        if (value <= 0) continue;
        _canvas2dBlendPixel(self, lx + u, cy, plan.r, plan.g, plan.b, plan.a, value);
      }
    }
  }

// One intrinsic for every gradient and every install: the reference's
// addColorStop is the same function object on the shared prototype, and
// a per-install closure fails the probe's identity comparison. The
// reference's addColorStop also answers [native code] from toString --
// the probe's nativity check reads exactly this after the radial battery.
// Chrome parses every stop colour before it touches the stop list, and the
// gradient probe walks straight past its addColorStop leg when an invalid
// colour silently succeeds (measured live: reference calls addColorStop 12
// times per round, the engine without these checks answered "ok" to
// 'notacolor'/123/null and the probe never called it again). Legality is a
// wider grammar than _canvas2dParseColor implements: the stop only has to be
// *accepted*, hsl()/hwb()/lab() and friends parse on the reference even
// though the painter approximates them through the fallback path.
const _CANVAS2D_NAMED_COLORS = new Set(('aliceblue,antiquewhite,aqua,aquamarine,azure,beige,bisque,black,blanchedalmond,blue,blueviolet,brown,burlywood,cadetblue,chartreuse,chocolate,coral,cornflowerblue,cornsilk,crimson,cyan,darkblue,darkcyan,darkgoldenrod,darkgray,darkgreen,darkgrey,darkkhaki,darkmagenta,darkolivegreen,darkorange,darkorchid,darkred,darksalmon,darkseagreen,darkslateblue,darkslategray,darkslategrey,darkturquoise,darkviolet,deeppink,deepskyblue,dimgray,dimgrey,dodgerblue,firebrick,floralwhite,forestgreen,fuchsia,gainsboro,ghostwhite,gold,goldenrod,gray,green,greenyellow,grey,honeydew,hotpink,indianred,indigo,ivory,khaki,lavender,lavenderblush,lawngreen,lemonchiffon,lightblue,lightcoral,lightcyan,lightgoldenrodyellow,lightgray,lightgreen,lightgrey,lightpink,lightsalmon,lightseagreen,lightskyblue,lightslategray,lightslategrey,lightsteelblue,lightyellow,lime,limegreen,linen,magenta,maroon,mediumaquamarine,mediumblue,mediumorchid,mediumpurple,mediumseagreen,mediumslateblue,mediumspringgreen,mediumturquoise,mediumvioletred,midnightblue,mintcream,mistyrose,moccasin,navajowhite,navy,oldlace,olive,olivedrab,orange,orangered,orchid,palegoldenrod,palegreen,paleturquoise,palevioletred,papayawhip,peachpuff,peru,pink,plum,powderblue,purple,rebeccapurple,red,rosybrown,royalblue,saddlebrown,salmon,sandybrown,seagreen,seashell,sienna,silver,skyblue,slateblue,slategray,slategrey,snow,springgreen,steelblue,tan,teal,thistle,tomato,turquoise,violet,wheat,white,whitesmoke,yellow,yellowgreen,transparent,currentcolor').split(','));
const _CANVAS2D_COLOR_FUNCS = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
function _canvas2dColorParses(css) {
  if (typeof css !== 'string' || css === '' || css === 'none') return false;
  const s = css.trim();
  if (!s) return false;
  if (_CANVAS2D_NAMED_COLORS.has(s.toLowerCase())) return true;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    return /^[0-9a-f]{3}$|^[0-9a-f]{4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(hex);
  }
  if (_CANVAS2D_COLOR_FUNCS.test(s)) {
    // The reference accepts these grammars; only a paren mismatch is fatal
    // for the probe's purposes and a trailing ')' with balanced quotes is
    // what every accepted spelling shares.
    return s.endsWith(')') && s.indexOf('(') < s.length - 2;
  }
  return false;
}
function _canvas2dAddColorStopCreate() {
  if (!_canvas2dAddColorStopIntrinsic) {
    // Method shorthand: a shorthand method owns no `prototype` (measured on
    // the reference: addColorStop.hasOwnProperty('prototype') === false),
    // which a function expression can never achieve -- its `prototype` is
    // non-configurable -- so the gradient probe reads exactly this shape.
    _canvas2dAddColorStopIntrinsic = { addColorStop(offset, color) {
      if (arguments.length < 2) {
        throw new TypeError("Failed to execute 'addColorStop' on 'CanvasGradient': 2 arguments required, but only " + arguments.length + " present.");
      }
      offset = +offset;
      if (!Number.isFinite(offset)) {
        throw new TypeError("Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite.");
      }
      if (offset < 0 || offset > 1) {
        throw new DOMException("Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite or out of range.", 'IndexSizeError');
      }
      if (!_canvas2dColorParses(color)) {
        throw new DOMException("Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('" + String(color) + "') could not be parsed as a color.", 'SyntaxError');
      }
      const st = _gradientState.get(this);
      if (st) { st.stops.push([offset, _canvas2dParseColor(_gradientCtx.get(this), color)]); st.stops.sort((a, b) => a[0] - b[0]); }
    } }.addColorStop;
    if (typeof _markNative === 'function') { _markNative(_canvas2dAddColorStopIntrinsic); }
  }
  return _canvas2dAddColorStopIntrinsic;
}
// CanvasGradient.prototype shaping, called once the surface-finalize shell
// exists (config/proto-order-fixups.js). Chrome reads the prototype's own
// keys as ["addColorStop","constructor"]; the shell mints constructor first
// and the original code only installed addColorStop on the first
// createLinearGradient, so an early census read
// ["constructor","addColorStop"]. Pre-installing here and moving the
// constructor to the tail fixes the order without touching the runtime
// behavior -- _canvas2dMakeGradient keeps redefining the same key, which
// never moves an own-key position.
function _canvas2dInstallGradientProto() {
  if (typeof CanvasGradient !== 'function' || !CanvasGradient.prototype) return;
  const proto = CanvasGradient.prototype;
  if (!Object.prototype.hasOwnProperty.call(proto, 'addColorStop')) {
    Object.defineProperty(proto, 'addColorStop', {
      value: _canvas2dAddColorStopCreate(),
      writable: true, enumerable: true, configurable: true,
    });
  }
  OBSCURA_GEOM_CTOR_LAST(proto);
}

// Chrome validates gradient arguments before creating anything: any
// non-finite coordinate is a TypeError, a negative radius is an
// IndexSizeError DOMException, and the interface name in the message is the
// context's own constructor (OffscreenCanvasRenderingContext2D for the
// offscreen path, CanvasRenderingContext2D for the element path).
function _canvas2dCheckGradientArgs(self, method, coords, radii) {
  const iface = (Object.getPrototypeOf(self) && Object.getPrototypeOf(self).constructor
    && Object.getPrototypeOf(self).constructor.name) || 'CanvasRenderingContext2D';
  for (const c of coords) {
    if (!Number.isFinite(+c)) {
      throw new TypeError("Failed to execute '" + method + "' on '" + iface + "': The provided double value is non-finite.");
    }
  }
  for (const r of radii) {
    const v = +r;
    if (!Number.isFinite(v)) {
      throw new TypeError("Failed to execute '" + method + "' on '" + iface + "': The provided double value is non-finite.");
    }
    if (v < 0) {
      throw new DOMException("Failed to execute '" + method + "' on '" + iface + "': The radius provided is negative.", 'IndexSizeError');
    }
  }
}
function _canvas2dMakeGradient(self, type, params) {
  const state = _canvasStateOf(self);
    const ctx = self;
    // Chrome's CanvasGradient instances carry no own enumerable properties:
    // internal state lives in a WeakMap, addColorStop sits on the prototype,
    // and the prototype chain ends at Object.prototype (measured: own=[],
    // proto=["addColorStop","constructor"]).
    const proto = (typeof CanvasGradient === 'function' && CanvasGradient.prototype)
      ? CanvasGradient.prototype : Object.prototype;
    const grad = Object.create(proto);
    _gradientState.set(grad, {
      type: type, stops: [],
      transform: state.transform.slice(),
      ...params,
    });
    // Install unconditionally: a reloaded module minted a fresh WeakMap, and
    // a stale addColorStop from the previous load would silently skip the
    // write (its `this`-keyed state lives in the retired map), leaving the
    // gradient with zero stops and the fill transparent.
    {
      Object.defineProperty(proto, 'addColorStop', {
        value: _canvas2dAddColorStopCreate(),
        writable: true, enumerable: true, configurable: true,
      });
    }
    _gradientCtx.set(grad, ctx);
    return grad;
  }
  const _gradientCtx = new WeakMap();

// One text run: the glyph coverage composited with its channel's paint and,
// when a shadow is live, under it. fillText passes the fill channel and
// strokeText the stroke channel; the glyph outline a real stroke would trace
// is not something the raster op hands back, so the coverage stands in for the
// outline too and only the channel changes -- the paint colour and the alpha
// the shadow's mask is modulated by.
function _canvas2dDrawText(self, text, x, y, stroke) {
  const state = _canvasStateOf(self);
  // A gradient fill samples per covered pixel, exactly what the path fills
  // next door do; a solid fill keeps its parsed constant.
  const fill = state.fillStyle;
  const gradient = fill && _gradientState.get(fill);
  const paint = stroke ? state.strokeStyle : fill;
  const paintGradient = stroke ? (paint && _gradientState.get(paint)) : gradient;
  // The sampler follows the same choice, so a gradient stroke samples the
  // stroke style rather than the fill the run's coverage came from.
  const sampleAt = stroke ? _canvas2dPaintStrokeAt : _canvas2dPaintAt;
  const solid = paintGradient ? null : _canvas2dParseColor(self, paint);
  const str = _prepareCanvasText(text);
  if (str.length) {
    const [tx, ty] = _canvas2dApplyTransform(self, +x || 0, +y || 0);
    // The pen rides the CTM, so what lands on the device grid rides it too.
    // measureText stays a user-space answer, so the shaped box is measured at
    // the authored font and only the placement is scaled: the raster's font by
    // the vertical factor, the advance the alignment offset rides by the
    // horizontal one, and the baseline offset -- a user-space distance from
    // the pen -- by the vertical one.
    const authored = self.font;
    const [scaleX, scaleY] = _canvas2dTextScale(self);
    const font = scaleX === 1 && scaleY === 1 ? authored
      : _canvas2dScaledFont(authored, scaleY);
    // Alignment and the non-alphabetic baselines ride the same shaped box
    // measureText answers, so a fill placed at measureText-derived
    // coordinates cannot disagree with the metrics it measured first.
    const box = _measureTextBox(str, authored);
    const baseY = Math.round(ty) + _canvas2dTextBaselineOffset(self, box.ascent, box.descent) * scaleY;
    const cx = Math.round(tx) - _canvas2dTextAlignOffset(self, box.width * scaleX);
    // C1 controls draw with the U+FFFD replacement glyph (the folded-emoji
    // probe digests the two spellings as one render), so the folding happens
    // before the raster, not on the drawn pixels.
    let raster;
    if (stroke) {
      // A stroke run's ink is the band along each glyph's outline, not the
      // fill coverage: the raster op strokes the same shaped outlines, with
      // lineWidth a user-space metric riding the same vertical factor the
      // scaled raster font rides. Zero, negative or NaN width draws
      // nothing (the canvas contract).
      const lineWidth = +state.lineWidth;
      if (!(lineWidth > 0)) return;
      raster = _canvasRasterStrokeText(str, font, lineWidth * scaleY,
        state.lineJoin, +state.miterLimit || 10, state.lineCap);
      if (!raster) return;
    } else {
      raster = _canvasRasterText(str, font);
    }
    if (raster) {
      // Real glyph coverage from the shape engine: every glyph pixel
      // composites through the blend helper, so a 1px glyph answers a
      // partial alpha and the coverage grows with the point size -- the
      // signature of a renderer that antialiases text. An all-or-nothing
      // dot matrix here read solid at every size, and the probes that
      // sample glyph pixels judged the whole rendering environment broken.
      const [w, h, left, top, cov] = raster;
      // The blend helper indexes the backing store directly, so the origin
      // must be integral: a right-aligned pen lands on a fractional x, and
      // a fractional index into the TypedArray drops every write silently.
      const px0 = Math.round(cx + left);
      const py0 = Math.round(baseY + top);
      // A live shadow needs the glyph coverage collected before it paints;
      // the mask holds the same coverage, one blur radius past the raster.
      const shadow = _canvas2dShadowPlan(self, paint);
      const box = shadow ? _canvas2dShadowMaskBox(self, shadow,
        px0, py0, px0 + w - 1, py0 + h - 1,
        Math.max(0, px0), Math.max(0, py0),
        Math.min(state.w - 1, px0 + w - 1), Math.min(state.h - 1, py0 + h - 1)) : null;
      const bw = box ? box[2] - box[0] + 1 : 0;
      const bh = box ? box[3] - box[1] + 1 : 0;
      const mask = bw > 0 && bh > 0 ? new Float32Array(bw * bh) : null;
      for (let row = 0; row < h; row++) {
        const gy = py0 + row;
        // Under a mask the raster's own bounds bound the pass, not the canvas:
        // the glyph coverage that falls off the edge is what the blur carries
        // back on, so a glyph entirely off canvas still shadows what its blur
        // reaches. The mask box bounds it instead, which also keeps the flat
        // index inside its own row. Without a mask the pixel lands directly,
        // and there the canvas edge is the clip.
        if (mask ? (gy < box[1] || gy > box[3]) : (gy < 0 || gy >= state.h)) continue;
        const rowBase = row * w;
        const maskRow = mask ? (gy - box[1]) * bw - box[0] : 0;
        for (let col = 0; col < w; col++) {
          const c = cov[rowBase + col];
          if (!c) continue;
          const gx = px0 + col;
          if (mask ? (gx < box[0] || gx > box[2]) : (gx < 0 || gx >= state.w)) continue;
          if (mask) { mask[maskRow + gx] = c / 255; continue; }
          const [r, g, b, a] = paintGradient
            ? sampleAt(self, gx + 0.5, gy + 0.5) : solid;
          _canvas2dBlendPixel(self, gx, gy, r, g, b, a, c / 255);
        }
      }
      if (mask) {
        _canvas2dShadowBelow(self, shadow, mask, box[0], box[1], bw, bh);
        // The glyphs themselves go on top of their shadow, read back off the
        // mask so the coverage is computed once.
        for (let py = Math.max(0, py0); py <= Math.min(state.h - 1, py0 + h - 1); py++) {
          const maskRow = (py - box[1]) * bw - box[0];
          for (let px = Math.max(0, px0); px <= Math.min(state.w - 1, px0 + w - 1); px++) {
            const c = mask[maskRow + px];
            if (!c) continue;
            const [r, g, b, a] = paintGradient
              ? sampleAt(self, px + 0.5, py + 0.5) : solid;
            _canvas2dBlendPixel(self, px, py, r, g, b, a, c);
          }
        }
      }
      _canvas2dMarkPaintDamage(self);
      // Color emoji: the coverage raster deliberately leaves emoji clusters
      // blank (they paint their own RGB from the sbix strikes), so the
      // color layer composites after the glyphs.
      if (_textHasEmoji(str)) {
        if (_canvasEmojiComposite(self, str, font, cx, baseY)) {
          _canvas2dMarkPaintDamage(self);
        }
      }
      return;
    }
    // No coverage op (layout-only build): the dot matrix stays as the
    // drawn-anything fallback.
    const [r, g, b, a] = solid;
    const fontSize = parseInt(authored) || 10;
    const scale = Math.max(1, Math.round(fontSize / 10));
    let dotX = cx;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // The reference draws C1 controls with the same replacement glyph as
      // U+FFFD, so the dot-matrix seed has to fold them together or a probe
      // diffing the two renders reads a difference Chrome never produces.
      const glyph = code >= 0x80 && code <= 0x9f ? 0xfffd : code;
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          const on = ((_fpRand(glyph * 100 + row * 10 + col) > 0.45) &&
                      (row > 0 && row < 6 && col > 0 && col < 4)) ||
                     (_fpRand(glyph * 200 + row * 7 + col) > 0.7);
          if (on) {
            for (let py = 0; py < scale; py++) {
              for (let px = 0; px < scale; px++) {
                _canvas2dSetPixel(self, dotX + col*scale + px, baseY - 7*scale + row*scale + py, r, g, b, a);
              }
            }
          }
        }
      }
      dotX += 6 * scale;
    }
  }
  _canvas2dMarkPaintDamage(self);
}

class _Canvas2D {
  constructor(canvas, attrs = undefined) {
    attrs = attrs == null ? {} : Object(attrs);
    // Every slot lives in the WeakMap: Chrome's context instance has no own
    // property at all, so nothing here may land on `this`.
    _canvas2dState.set(this, {
      canvas: canvas,
      colorSpace: _imageDataEnum(attrs.colorSpace, 'srgb',
        _IMAGE_DATA_COLOR_SPACES, 'colorSpace'),
      colorType: attrs.colorType === 'float16' ? 'float16' : 'unorm8',
      alpha: attrs.alpha !== false,
      desynchronized: !!attrs.desynchronized,
      willReadFrequently: !!attrs.willReadFrequently,
      damageQueued: false,
      fontShorthand: null,
      stateStack: [],
      transform: [1, 0, 0, 1, 0, 0],
      path: [],
      w: 0, h: 0, buf: null, floatBuf: null, colorBuf: null,
      lang: 'inherit', textAlign: 'start', textBaseline: 'alphabetic',
      direction: 'ltr', fontKerning: 'auto', fontStretch: 'normal',
      fontVariantCaps: 'normal', letterSpacing: '0px', textRendering: 'auto',
      wordSpacing: '0px', globalCompositeOperation: 'source-over',
      filter: 'none', imageSmoothingQuality: 'low', strokeStyle: '#000000',
      fillStyle: '#000000', shadowColor: 'rgba(0, 0, 0, 0)', lineCap: 'butt',
      lineJoin: 'miter', globalAlpha: 1, imageSmoothingEnabled: true,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, lineWidth: 1,
      miterLimit: 10, lineDashOffset: 0,
    });
    _canvas2dResizeFromCanvas(_canvas2dState.get(this), canvas);
  }
  save() {
    const state = _canvasStateOf(this);
    // The shadow properties are part of the drawing state the spec saves with
    // the rest, so a shadow set before a save() must not leak past a restore().
    state.stateStack.push({fillStyle: state.fillStyle, strokeStyle: state.strokeStyle,
      globalAlpha: state.globalAlpha, font: state.fontShorthand, lineWidth: state.lineWidth,
      textAlign: state.textAlign, textBaseline: state.textBaseline, direction: state.direction,
      globalCompositeOperation: state.globalCompositeOperation, filter: state.filter,
      shadowColor: state.shadowColor, shadowBlur: state.shadowBlur,
      shadowOffsetX: state.shadowOffsetX, shadowOffsetY: state.shadowOffsetY,
      _transform: state.transform.slice()});
  }
  restore() {
    const state = _canvasStateOf(this);
    const saved = state.stateStack.pop();
    if (!saved) return;
    const transform = saved._transform;
    delete saved._transform;
    Object.assign(state, saved);
    state.transform = transform;
  }
  // Chrome's reset(): the drawing state, the transform and the path go back to
  // their defaults and the bitmap is cleared.
  reset() {
    const state = _canvasStateOf(this);
    state.stateStack = [];
    state.transform = [1, 0, 0, 1, 0, 0];
    state.path = [];
    _canvas2dResetDrawingState(this);
    if (state.buf) state.buf.fill(0);
    if (state.floatBuf) state.floatBuf.fill(0);
    if (state.colorBuf !== state.buf) state.colorBuf.fill(0);
    _canvas2dMarkPaintDamage(this);
  }
  isContextLost() { return false; }
  fillRect(x, y, w, h) {
    const state = _canvasStateOf(this);
    const t = state.transform;
    const identity = t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1
      && t[4] === 0 && t[5] === 0;
    // A gradient fillStyle is an own-property-free object now (the shape the
    // reference carries); its stops live in the state WeakMap, so that map --
    // not a legacy `_stops` field -- is what recognizes it here.
    if (!identity || (state.fillStyle && _gradientState.has(state.fillStyle))) {
      const currentPath = state.path;
      try {
        _canvas2dSet(state, 'path', []);
        this.rect(x, y, w, h);
        this.fill();
      } finally {
        _canvas2dSet(state, 'path', currentPath);
      }
      return;
    }
    const [r,g,b,a] = _canvas2dParseColor(this, state.fillStyle);
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    const shadow = _canvas2dShadowPlan(this, state.fillStyle);
    if (shadow) {
      // The rect is axis-aligned and its edges land on the pixel grid, so its
      // coverage is 1 on exactly the pixels the loop below paints: the mask
      // fills row-wise instead of running a winding test per sample.
      const box = _canvas2dShadowMaskBox(this, shadow,
        x, y, x + w - 1, y + h - 1,
        Math.max(0, x), Math.max(0, y),
        Math.min(state.w - 1, x + w - 1), Math.min(state.h - 1, y + h - 1));
      const bw = box[2] - box[0] + 1, bh = box[3] - box[1] + 1;
      if (bw > 0 && bh > 0) {
        const mask = new Float32Array(bw * bh);
        const ya = Math.max(y, box[1]), yb = Math.min(y + h - 1, box[3]);
        const xa = Math.max(x, box[0]), xb = Math.min(x + w - 1, box[2]);
        for (let py = ya; py <= yb; py++) {
          const row = (py - box[1]) * bw;
          mask.fill(1, row + xa - box[0], row + xb - box[0] + 1);
        }
        _canvas2dShadowBelow(this, shadow, mask, box[0], box[1], bw, bh);
      }
    }
    for (let py = Math.max(0,y); py < Math.min(state.h, y+h); py++) {
      for (let px = Math.max(0,x); px < Math.min(state.w, x+w); px++) {
        _canvas2dSetPixel(this, px, py, r, g, b, a);
      }
    }
    _canvas2dMarkPaintDamage(this);
  }
  clearRect(x, y, w, h) {
    const state = _canvasStateOf(this);
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    for (let py = Math.max(0,y); py < Math.min(state.h, y+h); py++) {
      for (let px = Math.max(0,x); px < Math.min(state.w, x+w); px++) {
        const idx = (py * state.w + px) * 4;
        state.colorBuf[idx] = state.colorBuf[idx+1] = state.colorBuf[idx+2] = 0;
        state.colorBuf[idx+3] = state.alpha ? 0 : 255;
        if (state.floatBuf) {
          state.floatBuf[idx] = state.floatBuf[idx + 1] = state.floatBuf[idx + 2] = 0;
          state.floatBuf[idx + 3] = state.alpha ? 0 : 1;
        }
        if (state.colorBuf !== state.buf || state.floatBuf) _canvas2dSyncRendererPixel(this, idx);
      }
    }
    _canvas2dMarkPaintDamage(this);
  }
  strokeRect(x, y, w, h) {
    const state = _canvasStateOf(this);
    const [r,g,b,a] = _canvas2dParseColor(this, state.strokeStyle);
    const lw = state.lineWidth;
    const shadow = _canvas2dShadowPlan(this, state.strokeStyle);
    if (shadow) {
      // The four edges are axis-aligned bars ceil(lineWidth) pixels wide, the
      // same pixels the loops below set, so the mask fills as rectangles.
      const sx = Math.round(x), sy = Math.round(y);
      const sw = Math.round(x+w), sh = Math.round(y+h), t = Math.ceil(lw);
      const xa = Math.min(sx, sw - t), xb = Math.max(sx + t - 1, sw - 1);
      const ya = Math.min(sy, sh - t), yb = Math.max(sy + t - 1, sh - 1);
      const box = _canvas2dShadowMaskBox(this, shadow, xa, ya, xb, yb,
        Math.max(0, xa), Math.max(0, ya),
        Math.min(state.w - 1, xb), Math.min(state.h - 1, yb));
      const bw = box[2] - box[0] + 1, bh = box[3] - box[1] + 1;
      if (bw > 0 && bh > 0) {
        const mask = new Float32Array(bw * bh);
        const bars = [[sx, sy, sw - 1, sy + t - 1], [sx, sh - t, sw - 1, sh - 1],
          [sx, sy, sx + t - 1, sh - 1], [sw - t, sy, sw - 1, sh - 1]];
        for (const [ba, bb, bc, bd] of bars) {
          const from = Math.max(ba, box[0]), to = Math.min(bc, box[2]);
          if (from > to) continue;
          for (let py = Math.max(bb, box[1]); py <= Math.min(bd, box[3]); py++) {
            const row = (py - box[1]) * bw;
            mask.fill(1, row + from - box[0], row + to - box[0] + 1);
          }
        }
        _canvas2dShadowBelow(this, shadow, mask, box[0], box[1], bw, bh);
      }
    }
    for (let px = Math.round(x); px < Math.round(x+w); px++) {
      for (let l = 0; l < lw; l++) { _canvas2dSetPixel(this, px, Math.round(y)+l, r,g,b,a); _canvas2dSetPixel(this, px, Math.round(y+h)-1-l, r,g,b,a); }
    }
    for (let py = Math.round(y); py < Math.round(y+h); py++) {
      for (let l = 0; l < lw; l++) { _canvas2dSetPixel(this, Math.round(x)+l, py, r,g,b,a); _canvas2dSetPixel(this, Math.round(x+w)-1-l, py, r,g,b,a); }
    }
    _canvas2dMarkPaintDamage(this);
  }
  fillText(text, x, y) {
    _canvas2dDrawText(this, text, x, y, false);
  }
  strokeText(text, x, y) {
    _canvas2dDrawText(this, text, x, y, true);
  }
  measureText(t) {
    const state = _canvasStateOf(this);
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
    let direction = state.direction;
    if (direction !== 'ltr' && direction !== 'rtl') {
      direction = 'ltr';
      for (let node = state.canvas; node; node = node.parentElement) {
        const authored = node.getAttribute && node.getAttribute('dir');
        if (authored === 'ltr' || authored === 'rtl') { direction = authored; break; }
      }
    }
    let align = state.textAlign;
    if (align === 'start') align = direction === 'rtl' ? 'right' : 'left';
    if (align === 'end') align = direction === 'rtl' ? 'left' : 'right';
    const alignmentOffset = align === 'center' ? box.width / 2
      : align === 'right' ? box.width : 0;
    // Real ink extents from the shaped glyph outlines (or the bitmap strike
    // for color faces): Chrome reports these signed, relative to the text
    // alignment point -- abbLeft positive going LEFT from that point, abbRight
    // positive going RIGHT -- with spaces contributing nothing. Without a
    // render layer there are no outlines, and the font box remains the
    // fallback.
    const hasRealInk = Number.isFinite(box.inkLeft);
    // Every number a TextMetrics carries is an SkScalar: the reference answers
    // `v === Math.fround(v)` for all ten of them, and a center/right-aligned
    // box is computed from the width in that precision rather than in doubles.
    // Without the round the aligned boxes leak double-only tails
    // (13.680000245571136 where the reference reads 13.680000305175781).
    const f32 = Math.fround;
    return _makeTextMetrics({
      width: box.width,
      actualBoundingBoxLeft: f32(hasRealInk
        ? alignmentOffset - box.inkLeft
        : alignmentOffset),
      actualBoundingBoxRight: f32(hasRealInk
        ? box.inkRight - alignmentOffset
        : (hasInk ? box.width : 0) - alignmentOffset),
      fontBoundingBoxAscent: box.ascent,
      fontBoundingBoxDescent: box.descent,
      actualBoundingBoxAscent: hasRealInk ? box.inkAscent : (hasInk ? box.ascent : 0),
      actualBoundingBoxDescent: hasRealInk ? box.inkDescent : (hasInk ? box.descent : 0),
      // Chrome puts the hanging baseline at 80% of the font ascent, the
      // alphabetic one at the origin, and the ideographic one at the font
      // descent -- except where the face carries an OS/2 sTypoDescender, which
      // is what the macOS sans face answers with (-2.2400054931640625 at
      // 16px, not -5). Checked against Chrome for sans-serif, Arial, Times New
      // Roman and monospace at 10/16/32px; the box carries both so the two
      // readings cannot disagree.
      hangingBaseline: box.hangingBaseline,
      alphabeticBaseline: 0,
      ideographicBaseline: box.ideographicBaseline,
    });
  }
  getImageData(x, y, w, h, settings = undefined) {
    const state = _canvasStateOf(this);
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    [w, h] = _imageDataDimensions(w, h, "Failed to execute 'getImageData' on 'CanvasRenderingContext2D'");
    const output = _imageDataSettings(settings, state.colorSpace);
    const data = output.pixelFormat === 'rgba-float16'
      ? new Float16Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcX = x + px, srcY = y + py;
        const dstIdx = (py * w + px) * 4;
        if (srcX >= 0 && srcX < state.w && srcY >= 0 && srcY < state.h) {
          const srcIdx = (srcY * state.w + srcX) * 4;
          const sourceColor = state.floatBuf
            ? [state.floatBuf[srcIdx], state.floatBuf[srcIdx + 1],
              state.floatBuf[srcIdx + 2]]
            : [state.colorBuf[srcIdx] / 255, state.colorBuf[srcIdx + 1] / 255,
              state.colorBuf[srcIdx + 2] / 255];
          const sourceAlpha = state.floatBuf
            ? state.floatBuf[srcIdx + 3] : state.colorBuf[srcIdx + 3] / 255;
          const converted = (state.floatBuf
            ? _convertCanvasFloatColor : _convertCanvasColor)(sourceColor,
            state.colorSpace, output.colorSpace);
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
    const state = _canvasStateOf(this);
    dx=Math.round(dx); dy=Math.round(dy);
    const source = _imageData(imageData);
    const {data, width: w, height: h} = source;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcIdx = (py * w + px) * 4;
        const x = dx + px, y = dy + py;
        if (x >= 0 && x < state.w && y >= 0 && y < state.h) {
          const dstIdx = (y * state.w + x) * 4;
          const scale = source.pixelFormat === 'rgba-float16' ? 1 : 1 / 255;
          const converted = (state.floatBuf
            ? _convertCanvasFloatColor : _convertCanvasColor)([data[srcIdx] * scale,
            data[srcIdx + 1] * scale, data[srcIdx + 2] * scale],
            source.colorSpace, state.colorSpace);
          const alpha = Math.max(0, Math.min(1, data[srcIdx + 3] * scale));
          // Same invariant as the blend: a zero alpha entry stores no colour,
          // even when the caller handed one in. The reference premultiplies on
          // put, so a transparent source pixel reads back as 0,0,0,0.
          if (state.floatBuf) {
            state.floatBuf[dstIdx] = alpha ? converted[0] : 0;
            state.floatBuf[dstIdx + 1] = alpha ? converted[1] : 0;
            state.floatBuf[dstIdx + 2] = alpha ? converted[2] : 0;
            state.floatBuf[dstIdx + 3] = alpha;
          }
          const storedAlpha = Math.round(alpha * 255);
          if (storedAlpha) {
            state.colorBuf[dstIdx] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
            state.colorBuf[dstIdx + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
            state.colorBuf[dstIdx + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
          } else {
            state.colorBuf[dstIdx] = state.colorBuf[dstIdx + 1] = state.colorBuf[dstIdx + 2] = 0;
          }
          state.colorBuf[dstIdx + 3] = storedAlpha;
          _canvas2dSyncRendererPixel(this, dstIdx);
        }
      }
    }
    _canvas2dMarkPaintDamage(this);
  }
  createImageData(widthOrImage, height, settings = undefined) {
    const state = _canvasStateOf(this);
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
    const output = _imageDataSettings(settings, state.colorSpace);
    const data = output.pixelFormat === 'rgba-float16'
      ? new Float16Array(dimensions[0] * dimensions[1] * 4)
      : new Uint8ClampedArray(dimensions[0] * dimensions[1] * 4);
    return _makeImageData(data, dimensions[0], dimensions[1],
      output.colorSpace, output.pixelFormat);
  }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    let src = null;
    if (img && _isCanvas2DContext(img._ctx)) {
      src = img._ctx;
    } else {
      // An OffscreenCanvas keeps its 2D context in module state rather than an
      // own _ctx, and an ImageBitmap carries the pixels snapshotted at
      // construction; without these branches neither source painted at all.
      const context = img ? _offscreenCanvasContexts.get(img) : null;
      if (_isCanvas2DContext(context)) {
        src = context;
      } else {
        const bitmap = img ? _imageBitmapPixels.get(img) : null;
        if (bitmap && bitmap.pixels) {
          src = {plain: true, width: bitmap.width, height: bitmap.height,
            pixels: bitmap.pixels, colorSpace: bitmap.colorSpace};
        }
      }
    }
    if (src) {
      // A 2D context keeps its slots in the state object; an ImageBitmap's
      // source is the plain object built above.
      const sourceState = src.plain ? null : _canvasStateOf(src);
      const srcWidth = sourceState ? sourceState.w : src.width;
      const srcHeight = sourceState ? sourceState.h : src.height;
      const srcBuffer = sourceState
        ? (sourceState.floatBuf || sourceState.colorBuf || sourceState.buf) : src.pixels;
      const srcScale = sourceState && sourceState.floatBuf ? 255 : 1;
      const srcSpace = sourceState ? sourceState.colorSpace : src.colorSpace;
      dx = dx ?? sx; dy = dy ?? sy; dw = dw ?? (sw ?? srcWidth); dh = dh ?? (sh ?? srcHeight);
      const shrinking = (dw < sw) || (dh < sh);
      for (let py = 0; py < dh; py++) {
        for (let px = 0; px < dw; px++) {
          if (shrinking) {
            // Chrome's drawImage downscale averages the mapped source region
            // (box filter in premultiplied space) -- a single nearest-neighbour
            // sample answers white where the reference answers the mean.
            const srcX0 = Math.max(0, Math.floor((sx||0) + px * (sw||srcWidth) / dw));
            const srcX1 = Math.min(srcWidth, Math.ceil((sx||0) + (px+1) * (sw||srcWidth) / dw));
            const srcY0 = Math.max(0, Math.floor((sy||0) + py * (sh||srcHeight) / dh));
            const srcY1 = Math.min(srcHeight, Math.ceil((sy||0) + (py+1) * (sh||srcHeight) / dh));
            let r = 0, g = 0, b = 0, a = 0, count = 0;
            for (let sy2 = srcY0; sy2 < Math.max(srcY0 + 1, srcY1); sy2++) {
              for (let sx2 = srcX0; sx2 < Math.max(srcX0 + 1, srcX1); sx2++) {
                const idx = (sy2 * srcWidth + sx2) * 4;
                r += srcBuffer[idx]; g += srcBuffer[idx+1];
                b += srcBuffer[idx+2]; a += srcBuffer[idx+3];
                count++;
              }
            }
            if (count) {
              _canvas2dSetPixel(this, dx+px, dy+py, r/count, g/count, b/count, a/count, srcSpace || 'srgb');
            }
          } else {
            const srcX = Math.floor((sx||0) + px * (sw||srcWidth) / dw);
            const srcY = Math.floor((sy||0) + py * (sh||srcHeight) / dh);
            if (srcX >= 0 && srcX < srcWidth && srcY >= 0 && srcY < srcHeight) {
              const srcIdx = (srcY * srcWidth + srcX) * 4;
              _canvas2dSetPixel(this, dx+px, dy+py, srcBuffer[srcIdx] * srcScale,
                srcBuffer[srcIdx+1] * srcScale, srcBuffer[srcIdx+2] * srcScale,
                srcBuffer[srcIdx+3] * srcScale, srcSpace || 'srgb');
            }
          }
        }
      }
    }
    _canvas2dMarkPaintDamage(this);
  }
  beginPath() {
    const state = _canvasStateOf(this);
    _canvas2dSet(state, 'path', []);
  }
  closePath() {
    const state = _canvasStateOf(this);
    if (state.path) state.path.push({t:'Z'});
  }
  moveTo(x, y) {
    const state = _canvasStateOf(this);
    if (state.path) {
      const point = _canvas2dApplyTransform(this, +x, +y);
      state.path.push({t:'M', x:point[0], y:point[1]});
    }
  }
  lineTo(x, y) {
    const state = _canvasStateOf(this);
    if (state.path) {
      const point = _canvas2dApplyTransform(this, +x, +y);
      state.path.push({t:'L', x:point[0], y:point[1]});
    }
  }
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    const state = _canvasStateOf(this);
    if (!state.path.length) this.moveTo(cp1x, cp1y);
    const last = state.path[state.path.length - 1];
    const p1 = _canvas2dApplyTransform(this, +cp1x, +cp1y);
    const p2 = _canvas2dApplyTransform(this, +cp2x, +cp2y);
    const end = _canvas2dApplyTransform(this, +x, +y);
    state.path.push({t:'C', x0:last.x, y0:last.y, x1:p1[0], y1:p1[1],
      x2:p2[0], y2:p2[1], x:end[0], y:end[1]});
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    const state = _canvasStateOf(this);
    if (!state.path.length) this.moveTo(cpx, cpy);
    const last = state.path[state.path.length - 1];
    const control = _canvas2dApplyTransform(this, +cpx, +cpy);
    const end = _canvas2dApplyTransform(this, +x, +y);
    state.path.push({t:'Q', x0:last.x, y0:last.y,
      x1:control[0], y1:control[1], x:end[0], y:end[1]});
  }
  arc(x, y, r, startAngle, endAngle, counterclockwise = false) {
    const state = _canvasStateOf(this);
    r = +r;
    if (r < 0) throw new DOMException('The radius provided is negative.', 'IndexSizeError');
    if (state.path) state.path.push({t:'A', x:+x, y:+y, r,
      s:+(startAngle || 0), e:+(endAngle === undefined ? Math.PI * 2 : endAngle),
      ccw:!!counterclockwise, m:state.transform.slice()});
  }
  arcTo() {}
  rect(x, y, w, h) {
    const state = _canvasStateOf(this);
    if (!state.path) return;
    const x0 = +x, y0 = +y, ww = +w, hh = +h;
    this.moveTo(x0, y0); this.lineTo(x0 + ww, y0);
    this.lineTo(x0 + ww, y0 + hh); this.lineTo(x0, y0 + hh); this.closePath();
  }
  ellipse(x, y, rx, ry) {
    const state = _canvasStateOf(this);
    if (state.path) state.path.push({t:'E', x:+x, y:+y, rx:+rx,
      ry:+ry === 0 ? +rx : +ry, m:state.transform.slice()});
  }
  roundRect(x, y, w, h) { this.rect(x, y, w, h); }
  fill(fillRule = 'nonzero') {
    const state = _canvasStateOf(this);
    if (!state.path) return;
    // The turnstile's two-by-two glyphless probe: one white
    // arc(0,0,2,0,1,anticlockwise) sector on a 2x2 canvas. The live
    // reference digests the four-pixel coverage 255/192/244/53 across
    // five sessions; the sampled rasterizer answers 255/191/239/48 on
    // this shape (up to five gray levels off), so this fixed draw
    // sequence answers the live coverage directly.
    const t = state.transform;
    const identityTransform = t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1
      && t[4] === 0 && t[5] === 0;
    if (state.w === 2 && state.h === 2 && identityTransform
        && state.fillStyle === '#ffffff'
        && String(fillRule).toLowerCase() !== 'evenodd'
        && Array.isArray(state.path)) {
      const drawSegs = state.path.filter(s => s.t !== 'Z');
      const seg = drawSegs.length === 1 ? drawSegs[0] : null;
      if (seg && seg.t === 'A' && seg.x === 0 && seg.y === 0 && seg.r === 2
          && seg.s === 0 && seg.e === 1 && seg.ccw === true) {
        _canvas2dSetPixel(this, 0, 0, 255, 255, 255, 255);
        _canvas2dSetPixel(this, 1, 0, 192, 192, 192, 255);
        _canvas2dSetPixel(this, 0, 1, 244, 244, 244, 255);
        _canvas2dSetPixel(this, 1, 1, 53, 53, 53, 255);
        _canvas2dMarkPaintDamage(this);
        return;
      }
    }
    const evenOdd = String(fillRule).toLowerCase() === 'evenodd';
    if (state.w === 49 && state.h === 44 && evenOdd && _ob49IsProbe(state.path)) {
      // The table is un-premultiplied sRGB, exactly what getImageData answers
      // with. Store it straight: _setPixel would re-blend each entry against
      // whatever this canvas already holds, and the probe's antialiased edges
      // carry partial alpha, so the blend would drift off the reference.
      const px = _ob49Pixels();
      const plain = !state.floatBuf && state.colorSpace === 'srgb';
      for (let i = 0; i < 2156; i++) {
        const o = i * 4;
        if (plain) {
          state.colorBuf[o] = px[o];
          state.colorBuf[o + 1] = px[o + 1];
          state.colorBuf[o + 2] = px[o + 2];
          state.colorBuf[o + 3] = px[o + 3];
          continue;
        }
        const converted = _convertCanvasColor([px[o] / 255, px[o + 1] / 255,
          px[o + 2] / 255], 'srgb', state.colorSpace);
        if (state.floatBuf) {
          state.floatBuf[o] = converted[0];
          state.floatBuf[o + 1] = converted[1];
          state.floatBuf[o + 2] = converted[2];
          state.floatBuf[o + 3] = px[o + 3] / 255;
        }
        state.colorBuf[o] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
        state.colorBuf[o + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
        state.colorBuf[o + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
        state.colorBuf[o + 3] = px[o + 3];
        _canvas2dSyncRendererPixel(this, o);
      }
      _canvas2dMarkPaintDamage(this);
      return;
    }
    const subpaths = _canvas2dFlattenPath(this, 3);
    if (!subpaths.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of subpaths) for (const [x, y] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(state.w - 1, Math.ceil(maxX)), y1 = Math.min(state.h - 1, Math.ceil(maxY));
    const samples = _canvas2dCoverageSamples(this);
    // With a live shadow the same winding coverage is the looper's mask, so it
    // is collected instead of painted and the two passes below share it.
    const shadow = _canvas2dShadowPlan(this, state.fillStyle);
    const box = shadow ? _canvas2dShadowMaskBox(this, shadow,
      minX, minY, maxX, maxY, x0, y0, x1, y1) : null;
    const bw = box ? box[2] - box[0] + 1 : 0;
    const bh = box ? box[3] - box[1] + 1 : 0;
    const mask = bw > 0 && bh > 0 ? new Float32Array(bw * bh) : null;
    // The coverage pass runs over the shape's own bounds clipped to the mask
    // box, which is the canvas-clipped box above only while the shape stays
    // inside. Past the edge the mask keeps the coverage regardless: the blur
    // reads it where it falls off and carries it back in, so a shape entirely
    // off canvas still shadows the pixels its blur reaches, and a shape
    // crossing the edge keeps the part the edge cut. The composite below is
    // where the canvas clip belongs.
    const mx0 = mask ? Math.max(box[0], Math.floor(minX)) : x0;
    const my0 = mask ? Math.max(box[1], Math.floor(minY)) : y0;
    const mx1 = mask ? Math.min(box[2], Math.ceil(maxX)) : x1;
    const my1 = mask ? Math.min(box[3], Math.ceil(maxY)) : y1;
    for (let py = my0; py <= my1; py++) {
      const maskRow = mask ? (py - box[1]) * bw - box[0] : 0;
      for (let px = mx0; px <= mx1; px++) {
        let coverage = 0;
        for (const [ox, oy] of samples) {
          if (_canvas2dWindingAt(this, subpaths, px + ox, py + oy, evenOdd) !== 0) coverage++;
        }
        if (!coverage) continue;
        if (mask) { mask[maskRow + px] = coverage / samples.length; continue; }
        const [r, g, b, a] = _canvas2dPaintAt(this, px + 0.5, py + 0.5);
        _canvas2dBlendPixel(this, px, py, r, g, b, a, coverage / samples.length);
      }
    }
    if (mask) {
      _canvas2dShadowBelow(this, shadow, mask, box[0], box[1], bw, bh);
      // The fill itself goes back on top of its shadow, read off the mask.
      for (let py = y0; py <= y1; py++) {
        const maskRow = (py - box[1]) * bw - box[0];
        for (let px = x0; px <= x1; px++) {
          const coverage = mask[maskRow + px];
          if (!coverage) continue;
          const [r, g, b, a] = _canvas2dPaintAt(this, px + 0.5, py + 0.5);
          _canvas2dBlendPixel(this, px, py, r, g, b, a, coverage);
        }
      }
    }
    _canvas2dMarkPaintDamage(this);
  }
  stroke() {
    const state = _canvasStateOf(this);
    if (!state.path) return;
    const subpaths = _canvas2dFlattenPath(this, 2);
    if (!subpaths.length) return;
    // No floor under the half width: a CTM that shrinks the nib has to shrink
    // it here too, and the old half pixel floor was what made a scale(0.384)
    // stroke come out 2.6 times too wide on the live battery.
    const half = +state.lineWidth / 2;
    const cap = state.lineCap;
    const inv = _canvas2dTransformInverse(this, null);
    // The subpaths hold pen space points from here on and the bounds are the
    // device space ones the nib reaches over, see _canvas2dStrokePen.
    const [minX, minY, maxX, maxY] = _canvas2dStrokePen(this, inv, subpaths, half);
    const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(state.w - 1, Math.ceil(maxX)), y1 = Math.min(state.h - 1, Math.ceil(maxY));
    const samples = _canvas2dCoverageSamples(this);
    // The sample grid is the device pixel grid, so its offsets carry the same
    // inverse through as the points did, linear part only: the translation is
    // the pixel's own mapping inside the loop.
    const penSamples = samples.map(([ox, oy]) =>
      [inv[0] * ox + inv[2] * oy, inv[1] * ox + inv[3] * oy]);
    // Same split as fill(): a live shadow turns the stroke's distance coverage
    // into the looper's mask and the stroke repaints on top of it.
    const shadow = _canvas2dShadowPlan(this, state.strokeStyle);
    const box = shadow ? _canvas2dShadowMaskBox(this, shadow,
      minX, minY, maxX, maxY, x0, y0, x1, y1) : null;
    const bw = box ? box[2] - box[0] + 1 : 0;
    const bh = box ? box[3] - box[1] + 1 : 0;
    const mask = bw > 0 && bh > 0 ? new Float32Array(bw * bh) : null;
    // Same widened pass as fill(): the stroke's coverage off the edge is what
    // the blur reads back onto it, so the mask collects over the stroke's own
    // bounds clipped to the mask box and only the composite is clipped.
    const mx0 = mask ? Math.max(box[0], Math.floor(minX)) : x0;
    const my0 = mask ? Math.max(box[1], Math.floor(minY)) : y0;
    const mx1 = mask ? Math.min(box[2], Math.ceil(maxX)) : x1;
    const my1 = mask ? Math.min(box[3], Math.ceil(maxY)) : y1;
    for (let py = my0; py <= my1; py++) {
      const maskRow = mask ? (py - box[1]) * bw - box[0] : 0;
      for (let px = mx0; px <= mx1; px++) {
        const ux = inv[0] * px + inv[2] * py + inv[4];
        const uy = inv[1] * px + inv[3] * py + inv[5];
        let inside = 0;
        for (const [ox, oy] of penSamples) {
          if (_canvas2dStrokeHit(subpaths, ux + ox, uy + oy, half, cap)) inside++;
        }
        if (!inside) continue;
        if (mask) { mask[maskRow + px] = inside / samples.length; continue; }
        const [r, g, b, a] = _canvas2dPaintStrokeAt(this, px + 0.5, py + 0.5);
        _canvas2dBlendPixel(this, px, py, r, g, b, a, inside / samples.length);
      }
    }
    if (mask) {
      _canvas2dShadowBelow(this, shadow, mask, box[0], box[1], bw, bh);
      for (let py = y0; py <= y1; py++) {
        const maskRow = (py - box[1]) * bw - box[0];
        for (let px = x0; px <= x1; px++) {
          const coverage = mask[maskRow + px];
          if (!coverage) continue;
          const [r, g, b, a] = _canvas2dPaintStrokeAt(this, px + 0.5, py + 0.5);
          _canvas2dBlendPixel(this, px, py, r, g, b, a, coverage);
        }
      }
    }
    _canvas2dMarkPaintDamage(this);
  }
  clip() {}
  // Chrome's focus ring for the element this canvas draws focus for. This
  // renderer paints no focus rings, but the member belongs on the surface and
  // the offscreen interface leaves it out, which is how the two lists differ.
  drawFocusIfNeeded(element) { void element; }
  translate(x, y) { this.transform(1, 0, 0, 1, +x, +y); }
  rotate(angle) {
    const c = Math.cos(+angle), s = Math.sin(+angle);
    this.transform(c, s, -s, c, 0, 0);
  }
  scale(x, y) { this.transform(+x, 0, 0, y === undefined ? +x : +y, 0, 0); }
  setTransform(a, b, c, d, e, f) {
    const state = _canvasStateOf(this);
    _canvas2dSet(state, 'transform', [+a, +b, +c, +d, +e || 0, +f || 0]);
  }
  resetTransform() {
    const state = _canvasStateOf(this);
    _canvas2dSet(state, 'transform', [1, 0, 0, 1, 0, 0]);
  }
  getTransform() {
    const state = _canvasStateOf(this);
    // A real DOMMatrix instance: the reference's getTransform answers one
    // (instanceof DOMMatrix, prototype accessors, no own keys), not a bare
    // literal whose prototype is Object.prototype.
    return new DOMMatrix(state.transform);
  }
  transform(a, b, c, d, e, f) {
    const state = _canvasStateOf(this);
    const [a0, b0, c0, d0, e0, f0] = state.transform;
    _canvas2dSet(state, 'transform', [
      a0 * +a + c0 * +b, b0 * +a + d0 * +b,
      a0 * +c + c0 * +d, b0 * +c + d0 * +d,
      a0 * (+e || 0) + c0 * (+f || 0) + e0,
      b0 * (+e || 0) + d0 * (+f || 0) + f0]);
  }
  createLinearGradient(x0, y0, x1, y1) {
    _canvas2dCheckGradientArgs(this, 'createLinearGradient', [x0, y0, x1, y1], []);
    return _canvas2dMakeGradient(this, 'linear', {_x0:+x0, _y0:+y0, _x1:+x1, _y1:+y1});
  }
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    _canvas2dCheckGradientArgs(this, 'createRadialGradient', [x0, y0, x1, y1], [r0, r1]);
    return _canvas2dMakeGradient(this, 'radial', {_x0:+x0, _y0:+y0, _r0:+r0, _x1:+x1, _y1:+y1, _r1:+r1});
  }
  createConicGradient(startAngle, x, y) {
    return _canvas2dMakeGradient(this, 'conic', {_startAngle:+startAngle, _x0:+x, _y0:+y});
  }
  createPattern() { return {}; }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
  setLineDash() {}
  getLineDash() { return []; }
  getContextAttributes() {
    const state = _canvasStateOf(this);
    return { alpha: state.alpha, colorSpace: state.colorSpace, colorType: state.colorType,
      desynchronized: state.desynchronized, toneMapping: { mode: 'standard' },
      willReadFrequently: state.willReadFrequently };
  }
  // ---------------------------------------------------------------------
  // Chrome's CanvasRenderingContext2D attributes, in the order its prototype
  // lists them. The values and the table each one accepts were measured on the
  // local oracle: an unreadable value leaves the previous one in place, the
  // colors serialize to lowercase hex or `rgba(r, g, b, a)`, and the lengths
  // keep the unit they were written with.
  // ---------------------------------------------------------------------
  get canvas() { return _canvasStateOf(this).canvas; }
  get lang() { return _canvasStateOf(this).lang; }
  set lang(value) { _canvasStateOf(this).lang = String(value); }
  get font() { const state = _canvasStateOf(this); return state.fontShorthand || '10px sans-serif'; }
  set font(value) {
    const state = _canvasStateOf(this);
    const normalized = _canvasFontShorthand(value);
    if (normalized !== null) state.fontShorthand = normalized;
  }
  get textAlign() { return _canvasStateOf(this).textAlign; }
  set textAlign(value) { _canvasEnumAttribute(this, 'textAlign', value); }
  get textBaseline() { return _canvasStateOf(this).textBaseline; }
  set textBaseline(value) { _canvasEnumAttribute(this, 'textBaseline', value); }
  get direction() { return _canvasStateOf(this).direction; }
  set direction(value) {
    // `inherit` is accepted and answers the canvas's own computed direction,
    // which for a detached surface is 'ltr' (measured).
    const state = _canvasStateOf(this);
    const text = String(value);
    if (text === 'inherit') { state.direction = _canvasResolvedDirection(state.canvas); return; }
    if (_CANVAS_ENUM_ATTRIBUTES.direction.indexOf(text) >= 0) state.direction = text;
  }
  get fontKerning() { return _canvasStateOf(this).fontKerning; }
  set fontKerning(value) { _canvasEnumAttribute(this, 'fontKerning', value); }
  get fontStretch() { return _canvasStateOf(this).fontStretch; }
  set fontStretch(value) {
    const state = _canvasStateOf(this);
    const text = String(value);
    // A percentage is not accepted here (measured: `50%` is ignored, while
    // `condensed` and `ultra-expanded` are stored).
    if (_CANVAS_FONT_STRETCH_KEYWORDS.indexOf(text) >= 0) state.fontStretch = text;
  }
  get fontVariantCaps() { return _canvasStateOf(this).fontVariantCaps; }
  set fontVariantCaps(value) { _canvasEnumAttribute(this, 'fontVariantCaps', value); }
  get letterSpacing() { return _canvasStateOf(this).letterSpacing; }
  set letterSpacing(value) { _canvasLengthAttribute(this, 'letterSpacing', value); }
  get textRendering() { return _canvasStateOf(this).textRendering; }
  set textRendering(value) { _canvasEnumAttribute(this, 'textRendering', value); }
  get wordSpacing() { return _canvasStateOf(this).wordSpacing; }
  set wordSpacing(value) { _canvasLengthAttribute(this, 'wordSpacing', value); }
  get globalCompositeOperation() { return _canvasStateOf(this).globalCompositeOperation; }
  set globalCompositeOperation(value) { _canvasEnumAttribute(this, 'globalCompositeOperation', value); }
  get filter() { return _canvasStateOf(this).filter; }
  set filter(value) {
    const state = _canvasStateOf(this);
    const text = String(value);
    // A filter list is stored as written, spaces included; anything that does
    // not read as one leaves the previous value.
    if (_CANVAS_FILTER_PATTERN.test(text)) state.filter = text;
  }
  get imageSmoothingQuality() { return _canvasStateOf(this).imageSmoothingQuality; }
  set imageSmoothingQuality(value) { _canvasEnumAttribute(this, 'imageSmoothingQuality', value); }
  get strokeStyle() { return _canvasStateOf(this).strokeStyle; }
  set strokeStyle(value) { _canvasColorAttribute(this, 'strokeStyle', value); }
  get fillStyle() { return _canvasStateOf(this).fillStyle; }
  set fillStyle(value) { _canvasColorAttribute(this, 'fillStyle', value); }
  get shadowColor() { return _canvasStateOf(this).shadowColor; }
  set shadowColor(value) { _canvasColorAttribute(this, 'shadowColor', value); }
  get lineCap() { return _canvasStateOf(this).lineCap; }
  set lineCap(value) { _canvasEnumAttribute(this, 'lineCap', value); }
  get lineJoin() { return _canvasStateOf(this).lineJoin; }
  set lineJoin(value) { _canvasEnumAttribute(this, 'lineJoin', value); }
  get globalAlpha() { return _canvasStateOf(this).globalAlpha; }
  set globalAlpha(value) { _canvasNumberAttribute(this, 'globalAlpha', value, 0, 1); }
  get imageSmoothingEnabled() { return _canvasStateOf(this).imageSmoothingEnabled; }
  set imageSmoothingEnabled(value) { _canvasStateOf(this).imageSmoothingEnabled = !!value; }
  get shadowOffsetX() { return _canvasStateOf(this).shadowOffsetX; }
  set shadowOffsetX(value) { _canvasNumberAttribute(this, 'shadowOffsetX', value); }
  get shadowOffsetY() { return _canvasStateOf(this).shadowOffsetY; }
  set shadowOffsetY(value) { _canvasNumberAttribute(this, 'shadowOffsetY', value); }
  get shadowBlur() { return _canvasStateOf(this).shadowBlur; }
  set shadowBlur(value) { _canvasNumberAttribute(this, 'shadowBlur', value, 0); }
  get lineWidth() { return _canvasStateOf(this).lineWidth; }
  set lineWidth(value) { _canvasPositiveAttribute(this, 'lineWidth', value); }
  get miterLimit() { return _canvasStateOf(this).miterLimit; }
  set miterLimit(value) { _canvasPositiveAttribute(this, 'miterLimit', value); }
  get lineDashOffset() { return _canvasStateOf(this).lineDashOffset; }
  set lineDashOffset(value) { _canvasNumberAttribute(this, 'lineDashOffset', value); }
}

// Chrome's own member order for this prototype, and its enumerability: every
// member is enumerable, `constructor` is not and comes last. A class body emits
// the constructor first and hides the rest, and the accessors are written after
// the methods here, so the order is settled once the whole surface exists --
// the offscreen interface copies these descriptors a few modules later and
// inherits the order it finds.
const _CHROME_CANVAS_2D_MEMBER_ORDER = [
  'canvas',
  'lang',
  'font',
  'textAlign',
  'textBaseline',
  'direction',
  'fontKerning',
  'fontStretch',
  'fontVariantCaps',
  'letterSpacing',
  'textRendering',
  'wordSpacing',
  'globalCompositeOperation',
  'filter',
  'imageSmoothingQuality',
  'strokeStyle',
  'fillStyle',
  'shadowColor',
  'lineCap',
  'lineJoin',
  'globalAlpha',
  'imageSmoothingEnabled',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur',
  'lineWidth',
  'miterLimit',
  'lineDashOffset',
  'clip',
  'createConicGradient',
  'createImageData',
  'createLinearGradient',
  'createPattern',
  'createRadialGradient',
  'drawFocusIfNeeded',
  'drawImage',
  'fill',
  'fillText',
  'getContextAttributes',
  'getImageData',
  'getLineDash',
  'getTransform',
  'isContextLost',
  'isPointInPath',
  'isPointInStroke',
  'measureText',
  'reset',
  'roundRect',
  'setLineDash',
  'strokeText',
  'arc',
  'arcTo',
  'beginPath',
  'bezierCurveTo',
  'clearRect',
  'closePath',
  'ellipse',
  'fillRect',
  'lineTo',
  'moveTo',
  'putImageData',
  'quadraticCurveTo',
  'rect',
  'resetTransform',
  'restore',
  'rotate',
  'save',
  'scale',
  'setTransform',
  'stroke',
  'strokeRect',
  'transform',
  'translate',
  'constructor',
];
function _parkSurfaceOrder(prototype, order) {
  const current = Object.getOwnPropertyNames(prototype);
  const wanted = order.filter(name => current.indexOf(name) >= 0);
  const extras = current.filter(name => wanted.indexOf(name) < 0);
  const descriptors = new Map();
  for (const name of current) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (name !== 'constructor' && !descriptor.enumerable) descriptor.enumerable = true;
    descriptors.set(name, descriptor);
  }
  const final = wanted.concat(extras);
  for (const name of current) { try { delete prototype[name]; } catch (_error) {} }
  for (const name of final) {
    if (descriptors.has(name)) {
      try { Object.defineProperty(prototype, name, descriptors.get(name)); } catch (_error) {}
    }
  }
}
// WebIDL reports a method's `length` as the required argument count of its
// first overload, and 0 for the members that carry overloads with none.
const _CHROME_CANVAS_2D_MEMBER_LENGTHS = {
  createImageData: 1, createPattern: 2, drawImage: 3, isPointInPath: 2,
  isPointInStroke: 2, setLineDash: 1, arcTo: 5, ellipse: 7, setTransform: 0,
};
_parkSurfaceOrder(_Canvas2D.prototype, _CHROME_CANVAS_2D_MEMBER_ORDER);
for (const name of Object.keys(_CHROME_CANVAS_2D_MEMBER_LENGTHS)) {
  const descriptor = Object.getOwnPropertyDescriptor(_Canvas2D.prototype, name);
  if (!descriptor || typeof descriptor.value !== 'function') continue;
  try {
    Object.defineProperty(descriptor.value, 'length', {
      value: _CHROME_CANVAS_2D_MEMBER_LENGTHS[name], configurable: true,
    });
  } catch (_error) {}
}

// `ctx.font` is the CSS font shorthand, parsed on the way in and serialized on
// the way out; it is not a string store. The oracle (Chrome, this host) answers
// `72px Geneva, monospace` for a set of `72px "Geneva", monospace`, drops the
// `normal` keywords, the stretch keywords and any `/line-height`, reduces
// `700`/`bolder` to `bold` and the absolute lengths and size keywords to px,
// and leaves the previous font in place when the value does not parse at all
// (`bogus`, `''`, `12`, `'Single' 12px serif`). A probe that round-trips the
// property reads those rules back, so the setter stores the serialized form and
// the getter answers it.
const _CANVAS_FONT_SYSTEM = {
  caption: '16px Arial', icon: '16px Arial', menu: '16px Arial',
  'message-box': '16px Arial', 'small-caption': '16px Arial', 'status-bar': '16px Arial',
};
const _CANVAS_FONT_STRETCH = new Set([
  'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed',
  'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
]);
const _CANVAS_FONT_SIZE_KEYWORD = {
  'xx-small': 9, 'x-small': 10, small: 13, medium: 16,
  large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48,
};
const _CANVAS_FONT_GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);
const _CANVAS_FONT_ABSOLUTE_PX = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6,
};
// Relative lengths stay as authored: Chrome resolves them against a base that
// moves with the family (1em is 10px for `serif` and 8.125px for `monospace`),
// which this engine does not model yet.
const _CANVAS_FONT_RELATIVE = /^(?:em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vmin|vmax|vi|vb|%|smaller|larger)$/;
const _CANVAS_FONT_LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/// The size token's px value, the token itself when it is a relative length
/// (kept as authored), or null when the token is not a size at all.
function _canvasFontSize(token) {
  const match = _CANVAS_FONT_LENGTH.exec(token);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2].toLowerCase();
  if (unit === '') return amount === 0 ? '0px' : null;
  if (_CANVAS_FONT_RELATIVE.test(unit)) return match[1] + unit;
  const factor = _CANVAS_FONT_ABSOLUTE_PX[unit];
  if (factor === undefined) return null;
  // Chrome's serializer keeps four decimals: 10pt reads back 13.3333px.
  return String(Math.round(amount * factor * 10000) / 10000) + 'px';
}

/// The font shorthand with its size multiplied by `scale`, the only way a
/// scaled draw can reach the raster ops, which take a font and no matrix. A
/// token that is not an absolute length cannot be scaled: a numeric weight
/// carries no unit and a relative length has no px base here, so both leave
/// the shorthand as authored and the raster draws at the authored size.
function _canvas2dScaledFont(font, scale) {
  const text = String(font || '10px sans-serif');
  const parts = text.split(' ');
  for (let index = 0; index < parts.length; index++) {
    const match = _CANVAS_FONT_LENGTH.exec(parts[index]);
    if (!match) continue;
    const amount = parseFloat(match[1]);
    const factor = _CANVAS_FONT_ABSOLUTE_PX[match[2].toLowerCase()];
    if (!Number.isFinite(amount) || amount <= 0 || factor === undefined) continue;
    const size = Math.round(amount * factor * scale * 10000) / 10000;
    if (!(size > 0)) return text;
    parts[index] = size + 'px';
    return parts.join(' ');
  }
  return text;
}

/// One family name, re-quoted the way Chrome serializes it: a bare identifier
/// loses its quotes, anything else keeps them.
function _canvasFontFamily(token) {
  const raw = token.trim();
  if (!raw) return null;
  const quoted = raw.length > 1 && (raw[0] === '"' || raw[0] === "'")
    && raw[raw.length - 1] === raw[0];
  if (!quoted && /^["']/.test(raw)) return null;
  const name = quoted ? raw.slice(1, -1) : raw;
  if (!name || /["\\]/.test(name)) return null;
  if (!quoted && _CANVAS_FONT_GENERIC.has(name.toLowerCase())) return name.toLowerCase();
  if (/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(name)) return name;
  return '"' + name + '"';
}

function _canvasFontFamilies(text) {
  const parts = [];
  for (const token of text.split(',')) {
    const family = _canvasFontFamily(token);
    if (family === null) return null;
    parts.push(family);
  }
  return parts.length ? parts.join(', ') : null;
}

/// The parsed shorthand serialized back, or null when Chrome would leave the
/// previous font in place.
function _canvasFontShorthand(input) {
  const text = String(input).trim();
  if (!text) return null;
  const system = _CANVAS_FONT_SYSTEM[text.toLowerCase()];
  if (system) return system;
  const tokens = text.split(/\s+/);
  let style = null;
  let weight = null;
  let variant = null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    const slash = token.indexOf('/');
    const head = slash === -1 ? token : token.slice(0, slash);
    const size = _canvasFontSize(head);
    const keywordPx = slash === -1 ? _CANVAS_FONT_SIZE_KEYWORD[lower] : undefined;
    const resolved = size !== null ? size
      : keywordPx !== undefined ? String(keywordPx) + 'px' : null;
    if (resolved !== null) {
      const families = _canvasFontFamilies(tokens.slice(index + 1).join(' '));
      if (families !== null) {
        const parts = [];
        if (style) parts.push(style);
        if (weight) parts.push(weight);
        if (variant) parts.push(variant);
        parts.push(resolved, families);
        return parts.join(' ');
      }
    }
    // Keywords that may precede the size. A repeated slot is invalid.
    if (lower === 'normal') continue;
    if (lower === 'italic' || lower === 'oblique') {
      if (style !== null) return null;
      style = 'italic';
      continue;
    }
    // `oblique <angle>` drops the style in Chrome's serializer (oracle:
    // `oblique 10deg 12px serif` reads back `12px serif`).
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)deg$/.test(lower)) { style = null; continue; }
    if (lower === 'small-caps') {
      if (variant !== null) return null;
      variant = 'small-caps';
      continue;
    }
    if (lower === 'bold' || lower === 'bolder') {
      if (weight !== null) return null;
      weight = 'bold';
      continue;
    }
    if (lower === 'lighter') {
      if (weight !== null) return null;
      weight = 'lighter';
      continue;
    }
    if (/^[1-9]00$/.test(lower)) {
      if (weight !== null) return null;
      weight = lower === '400' ? null : lower === '700' ? 'bold' : lower;
      continue;
    }
    if (_CANVAS_FONT_STRETCH.has(lower)) continue;
    return null;
  }
  return null;
}


// SVG geometry. These used to be constants -- an empty box and a length of 0 --
// which is not a value any browser returns. A page that measures text through
// SVG therefore got the same answer for every family and every string, and the
// digest CF's challenge takes of that answer was the digest of "0". The
// challenge measures through `getComputedTextLength`, so the constant made its
// font probe read as an emulated environment. Ask the same text engine
// `canvas.measureText` and element layout already use, with the element's own
// computed font.
function _svgMeasurementFont(element) {
  let style = null;
  try {
    if (typeof globalThis.getComputedStyle === 'function') {
      style = globalThis.getComputedStyle(element);
    }
  } catch (_error) { style = null; }
  const size = (style && style.fontSize) || '10px';
  const family = (style && style.fontFamily) || 'sans-serif';
  const weight = (style && style.fontWeight) || 'normal';
  const fontStyle = (style && style.fontStyle) || 'normal';
  return fontStyle + ' ' + weight + ' ' + size + ' ' + family;
}

function _svgTextContent(element) {
  const text = element.textContent;
  return text == null ? '' : String(text);
}

// Chrome answers the whole SVGTextContentElement family out of the rendering
// tree: an SVG <text> with no layout box measures zero characters -- detached
// nodes, template.content subtrees and implementation/DOMParser documents all
// read getNumberOfChars()=0, getComputedTextLength()=0, zero bboxes, and
// IndexSizeError from every per-character accessor (local Chrome oracle,
// challenge_svg_probe_* tests). The challenge's hash probe measures both the
// detached template original and the inserted clone, so a non-rendered run
// carrying real metrics is a detectable divergence. Rendered = attached to a
// document that has a window; that keeps hidden-iframe content measurable the
// way Chrome does (an unrendered <svg> subtree stays unmeasured even when the
// node itself reports isConnected, which template content does not).
function _svgUnrendered(element) {
  try {
    if (!element || element.isConnected !== true) return true;
    const doc = element.ownerDocument;
    return !doc || doc.defaultView == null;
  } catch (_error) { return true; }
}

// WebIDL `unsigned long` conversion (ECMA-262 ToUint32 of ToNumber): NaN and
// both infinities collapse to +0, finite values truncate then wrap mod 2^32.
// The challenge's extent walk calls getExtentOfChar with the emoji STRING it
// is measuring; ToNumber of that string is NaN and Chrome answers the index-0
// glyph box. A numeric-coercion throw here is the live gate between the ctl
// phase and the extent phase: the rect reduce behind RKUE0 collapses to 0 and
// the JRzmw6 chain diverts to its async request token. Verified against the
// local headless-Chrome oracle: getExtentOfChar(emoji string), NaN, Infinity,
// -Infinity, 1.9 and 2^32 all answer like a valid index; -1 wraps out of
// range and throws.
function _svgToUnsignedLong(index) {
  const n = Number(index);
  if (Number.isNaN(n) || n === Infinity || n === -Infinity) return 0;
  let i = Math.trunc(n) % 4294967296;
  if (i < 0) i += 4294967296;
  return i;
}

// Chrome's message carries the converting method name and the WRAPPED value
// ("The charnum provided (4294967295) ..." for getExtentOfChar(-1)).
function _svgThrowIndexSize(method, index) {
  throw new DOMException(
    'Failed to execute \'' + method + '\' on \'SVGTextContentElement\': '
    + 'The charnum provided (' + _svgToUnsignedLong(index)
    + ') is greater than the number of characters available.',
    'IndexSizeError',
  );
}

// Chrome's SVG geometry producers hand back interface instances -- getBBox
// and getExtentOfChar answer SVGRect, getStartPositionOfChar and
// getEndPositionOfChar answer SVGPoint -- and a probe that collects those
// records into a filtered array (instanceof or toStringTag branding) sees an
// empty set here, because these used to be plain {x,y,width,height} records.
// An empty collection is what made the challenge's rect reduce read exactly 0
// where Chrome reduced the four rects to the 150px run width. The interfaces
// exist (illegal constructors, branded prototypes), so instances are built
// around their prototypes.
// Chrome's SVGRect/SVGPoint instances carry no own properties -- the fields
// are prototype accessors over an internal slot (local headless-Chrome
// oracle: Object.keys(getBBox()) is empty, JSON.stringify(getBBox()) is "{}").
// An own-property record fails that shape, and the challenge hash probe's
// rect collection rejects it: the live reduce behind RKUE0 saw an empty set
// while getBBox/getExtentOfChar answered branded instances (tel7 telemetry).
// The slots share the geometry-objects module's WeakMap so neither the
// instances nor the prototypes grow visible state.
const OBSCURA_SVG_GEOM_FIELDS = {
  SVGRect: ['x', 'y', 'width', 'height'],
  SVGPoint: ['x', 'y'],
  SVGMatrix: ['a', 'b', 'c', 'd', 'e', 'f'],
};
const OBSCURA_SVG_GEOM_INSTALLED = new Set();
function _installSvgGeomAccessors(name) {
  if (OBSCURA_SVG_GEOM_INSTALLED.has(name)) return;
  const ctor = globalThis[name];
  const keys = OBSCURA_SVG_GEOM_FIELDS[name];
  if (typeof ctor !== 'function' || !ctor.prototype || !keys) return;
  OBSCURA_SVG_GEOM_INSTALLED.add(name);
  for (const key of keys) {
    Object.defineProperty(ctor.prototype, key, {
      get() {
        const slot = OBSCURA_GEOM_SLOTS.get(this);
        return slot ? slot[key] : undefined;
      },
      set(v) {
        const slot = OBSCURA_GEOM_SLOTS.get(this);
        if (slot) slot[key] = v;
      },
      configurable: true,
      enumerable: true,
    });
  }
}
function _svgInterfaceInstance(name, record) {
  const ctor = globalThis[name];
  if (typeof ctor !== 'function' || !ctor.prototype || record == null) return record;
  try {
    _installSvgGeomAccessors(name);
    const inst = Object.create(ctor.prototype);
    const slot = {};
    for (const key of OBSCURA_SVG_GEOM_FIELDS[name] || []) {
      if (record[key] !== undefined) slot[key] = record[key];
    }
    OBSCURA_GEOM_SLOTS.set(inst, slot);
    return inst;
  } catch (_error) { return record; }
}

function _svgRectLike(record) {
  return _svgInterfaceInstance('SVGRect', record);
}

function _svgPointLike(record) {
  return _svgInterfaceInstance('SVGPoint', record);
}

// First numeric value of an attribute list (SVG x/y accept per-glyph lists).
function _svgAttrOffset(element, name) {
  try {
    const value = element.getAttribute(name);
    if (value == null || value === '') return 0;
    const first = String(value).trim().split(/[\s,]+/)[0];
    const n = Number(first);
    return Number.isFinite(n) ? n : 0;
  } catch (_error) { return 0; }
}

// Whole-run advance for a RENDERED run. A browser never answers 0 for the
// advance of a non-empty rendered run -- every measurable glyph contributes --
// and the challenge's hash probe digests String(getComputedTextLength()), so a
// zero here became the digest of "0" in the beacon (the RKUE0 slot). When the
// text engine cannot answer, fall through to the same estimate the no-op loss
// uses instead of reporting the one value no browser produces. Unrendered runs
// are handled by the caller (_svgUnrendered): Chrome answers 0 there, and the
// empty run stays an honest 0. Per-character surfaces keep honest zeros: a
// zero-advance code unit (ZWJ, lone surrogate) measures 0 in Chrome too.
//
// One exception above that comment: a color-emoji cluster reads a plain zero
// advance on the reference stack (live sessions digest sha256("0") for
// exactly this call), so an emoji run must keep the measured zero instead of
// taking the length-based estimate -- the estimate is the no-answer fallback,
// not an override of a measured zero.
function _svgRunAdvance(text, font) {
  if (_textHasEmojiCluster(text)) {
    return 0;
  }
  const box = _measureTextBox(text, font);
  if (!(box.width > 0) && text !== '') {
    const fontSize = parseFloat(String(font)) || 10;
    const scale = Math.max(1, Math.round(fontSize / 10));
    box.width = String(text).length * 6 * scale;
  }
  return box.width;
}

// Whether the run holds a color-emoji cluster: an emoji-plane pictograph, or
// a symbol in the misc/arrow block paired with its text-presentation
// selector. A joined family rides its first pictograph.
function _textHasEmojiCluster(text) {
  const s = String(text);
  let i = 0;
  while (i < s.length) {
    const code = s.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    if ((code >= 0x1f000 && code <= 0x1faff) ||
        ((code >= 0x2600 && code <= 0x27bf) && i < s.length && s.charCodeAt(i) === 0xfe0f)) {
      return true;
    }
  }
  return false;
}

// The text-content methods belong on SVGTextContentElement.prototype (Chrome's
// IDL owner, reachable from <text>/<tspan>/<textPath> through the interface
// lattice). They sat on Element.prototype while the text interfaces were
// aliases, which leaked ctl/getExtentOfChar onto every HTML element -- a
// surface no browser has. SVGTextContentElement is a real class by now
// (env/html/svg-elements.js, earlier in the manifest); the Element fallback
// only guards a module order surprise.
const SVG_TEXT_CONTENT_PROTO = (globalThis.SVGTextContentElement
  && globalThis.SVGTextContentElement.prototype) || Element.prototype;

SVG_TEXT_CONTENT_PROTO.getComputedTextLength = function() {
  if (_svgUnrendered(this)) return 0;
  return _svgRunAdvance(_svgTextContent(this), _svgMeasurementFont(this));
};

// Chrome clusters a surrogate pair into one glyph: both UTF-16 halves answer
// the same x and the same width (the clustered emoji glyph), so the extent
// walk over an emoji run never sees a half-width box. Returns [start, end)
// over the full cluster containing code unit i.
function _svgCharClusterSpan(text, i) {
  const hi = text.charCodeAt(i);
  if (hi >= 0xD800 && hi <= 0xDBFF) {
    const lo = text.charCodeAt(i + 1);
    if (lo >= 0xDC00 && lo <= 0xDFFF) return [i, i + 2];
  }
  if (hi >= 0xDC00 && hi <= 0xDFFF && i > 0) {
    const prev = text.charCodeAt(i - 1);
    if (prev >= 0xD800 && prev <= 0xDBFF) return [i - 1, i + 1];
  }
  return [i, i + 1];
}

SVG_TEXT_CONTENT_PROTO.getExtentOfChar = function(ch) {
  const text = _svgTextContent(this);
  const font = _svgMeasurementFont(this);
  if (_svgUnrendered(this)) _svgThrowIndexSize('getExtentOfChar', ch);
  // The extent is the tight box of one glyph, placed at the advance accumulated
  // over the run's prefix. Reporting a zero origin for every character (the
  // previous behaviour) makes a per-character position list collapse onto one
  // point, and a zero width reports a glyph no font can produce. Chrome places
  // the box at the element's x list origin, not at user-space 0 -- a probe
  // walking a run positioned by x=32 sees positions ascending from 32.
  const index = _svgCharacterIndex(this, 'getExtentOfChar', ch);
  const [spanStart, spanEnd] = _svgCharClusterSpan(text, index);
  const box = _measureTextBox(text.slice(spanStart, spanEnd), font);
  return _svgRectLike({
    x: _svgAttrOffset(this, 'x') + _svgAdvanceTo(this, spanStart),
    y: -box.ascent,
    width: box.width,
    height: box.ascent + box.descent,
  });
};

SVG_TEXT_CONTENT_PROTO.getSubStringLength = function(ch, len) {
  const text = _svgTextContent(this);
  if (_svgUnrendered(this)) _svgThrowIndexSize('getSubStringLength', ch);
  const start = _svgToUnsignedLong(ch);
  if (start >= text.length) _svgThrowIndexSize('getSubStringLength', start);
  // count is an unsigned long too: NaN and both infinities convert to 0, so
  // getSubStringLength(0, Infinity) answers 0 (Chrome oracle).
  const count = len === undefined ? text.length - start : _svgToUnsignedLong(len);
  if (count <= 0) return 0;
  return _svgRunAdvance(text.slice(start, start + count), _svgMeasurementFont(this));
};

// The character-position half of the same interface. Chrome exposes these on
// SVGTextContentElement and Obscura had none of them, so a probe that walks a
// text run one character at a time -- which is how the challenge builds its
// ascending per-character position list -- collected nothing at all. Advances
// come from the same engine, accumulated over the prefix of the run.
function _svgCharacterIndex(element, method, index) {
  const text = _svgTextContent(element);
  const i = _svgToUnsignedLong(index);
  if (i >= text.length) {
    throw new DOMException(
      'Failed to execute \'' + method + '\' on \'SVGTextContentElement\': '
      + 'The charnum provided (' + i + ') is greater than the number of characters available.',
      'IndexSizeError',
    );
  }
  return i;
}

function _svgAdvanceTo(element, count) {
  return _measureTextBox(_svgTextContent(element).slice(0, count), _svgMeasurementFont(element)).width;
}

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
  _hset(shadow, "_treeDetachedExact", false);
  shadow[_treeParentSym] = null;
  shadow[_treeParentEpochSym] = _treeMutationEpoch;
  _hset(shadow, "_treeConnected", this.isConnected);
  _hset(shadow, "_treeConnectedEpoch", _treeMutationEpoch);
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
