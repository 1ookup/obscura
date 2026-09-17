var _commonFonts = [
  'Arial', 'Arial Black', 'Arial Narrow',
  'Book Antiqua',
  'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New',
  'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Georgia',
  'Impact', 'Javanese Text', 'Lucida Console', 'Lucida Sans Unicode',
  'Malgun Gothic', 'Microsoft Sans Serif', 'MV Boli', 'Nirmala UI',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI',
  'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol',
  'Sitka', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
  'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
];
Object.defineProperty(Document.prototype, 'fonts', {
  get() {
    const _set = _commonFonts.map((name, i) => ({
      family: name, style: 'normal', weight: '400', stretch: 'normal',
      status: 'loaded', loaded: Promise.resolve(this),
      [Symbol.toStringTag]: 'FontFace',
    }));
    _set.forEach = (fn) => { _set.forEach(fn); };
    _set.has = (f) => typeof f === 'string'
      ? _commonFonts.some(n => n.toLowerCase() === f.toLowerCase())
      : _set.some(ff => ff.family === f?.family);
    _set.delete = (f) => false;
    _set.clear = () => {};
    _set.add = () => {};
    _set.load = () => Promise.resolve(_set);
    _set.check = (font) => {
      const m = typeof font === 'string' ? font.match(/["']([^"']+)["']/) : null;
      return m ? _commonFonts.some(n => n.toLowerCase() === m[1].toLowerCase()) : true;
    };
    _set.ready = Promise.resolve(_set);
    _set.status = 'loaded';
    _set.addEventListener = () => {};
    _set.removeEventListener = () => {};
    _set.dispatchEvent = () => true;
    return _set;
  },
  configurable: true,
});
globalThis.Crypto = class Crypto {
  // Fill an integer TypedArray from the OS CSPRNG. Filling the underlying bytes
  // (not per-element Math.random) keeps the distribution uniform across every
  // typed-array width and is actually cryptographically random.
  getRandomValues(arr) {
    if (!ArrayBuffer.isView(arr) || arr instanceof DataView ||
        arr instanceof Float32Array || arr instanceof Float64Array ||
        (typeof Float16Array !== 'undefined' && arr instanceof Float16Array)) {
      throw new DOMException("The provided ArrayBufferView is not an integer-typed array", "TypeMismatchError");
    }
    if (arr.byteLength > 65536) {
      throw new DOMException("The requested length exceeds 65536 bytes", "QuotaExceededError");
    }
    const bytes = Deno.core.ops.op_random_bytes(arr.byteLength);
    new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
    return arr;
  }
  randomUUID() {
    const b = Deno.core.ops.op_random_bytes(16);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    let s = "";
    for (let i = 0; i < 16; i++) {
      s += (b[i] + 0x100).toString(16).slice(1);
      if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
    }
    return s;
  }
};
