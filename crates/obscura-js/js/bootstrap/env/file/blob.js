const _blobState = new WeakMap();
const _fileState = new WeakMap();
const _blobData = value => {
  const state = _blobState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
};
const _fileData = value => {
  const state = _fileState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
};
const _blobBytes = value => {
  const state = value != null && (typeof value === 'object' || typeof value === 'function')
    ? _blobState.get(value)
    : null;
  return state ? state.bytes : null;
};

// Normalize one Blob part to bytes. `native` newline normalization applies to
// string parts when the Blob/File `endings` option is "native".
function _blobPartToBytes(p, native) {
  const blobBytes = _blobBytes(p);
  if (blobBytes) return blobBytes;
  if (p instanceof ArrayBuffer) return new Uint8Array(p.slice(0));
  if (ArrayBuffer.isView(p)) return new Uint8Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength));
  let s = String(p);
  if (native) s = s.replace(/\r\n|\r|\n/g, "\n");
  return new TextEncoder().encode(s);
}
function _bytesToBinaryString(bytes) { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
if (typeof Blob === "undefined") globalThis.Blob = class Blob {
  constructor(parts, opts) {
    opts = opts || {};
    const endings = opts.endings != null ? String(opts.endings) : "transparent";
    if (endings !== "transparent" && endings !== "native") throw new TypeError("Failed to construct 'Blob': The provided value '" + endings + "' is not a valid enum value of type EndingType.");
    const native = endings === "native";
    const chunks = []; let total = 0;
    if (parts != null) {
      if (typeof parts === "string" || typeof parts[Symbol.iterator] !== "function") throw new TypeError("Failed to construct 'Blob': The provided value cannot be converted to a sequence.");
      for (const p of parts) { const b = _blobPartToBytes(p, native); chunks.push(b); total += b.length; }
    }
    const data = new Uint8Array(total); let off = 0;
    for (const c of chunks) { data.set(c, off); off += c.length; }
    const t = opts.type != null ? String(opts.type) : "";
    _blobState.set(this, {
      bytes: data,
      type: /^[\x20-\x7e]*$/.test(t) ? t.toLowerCase() : "",
    });
  }
  get size() { return _blobData(this).bytes.length; }
  get type() { return _blobData(this).type; }
  arrayBuffer() { return Promise.resolve(_arrayBufferFromBytes(_blobData(this).bytes)); }
  slice(start, end, contentType) {
    const state = _blobData(this);
    const len = state.bytes.length;
    const s = start === undefined ? 0 : (start < 0 ? Math.max(len + start, 0) : Math.min(start, len));
    let e = end === undefined ? len : (end < 0 ? Math.max(len + end, 0) : Math.min(end, len));
    if (e < s) e = s;
    return new Blob([state.bytes.slice(s, e)], contentType != null ? { type: contentType } : {});
  }
  stream() {
    const bytes = _blobData(this).bytes.slice();
    return new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    });
  }
  text() { return Promise.resolve(new TextDecoder().decode(_blobData(this).bytes)); }
  bytes() { return Promise.resolve(_blobData(this).bytes.slice()); }
  textStream() {
    const text = new TextDecoder().decode(_blobData(this).bytes);
    return new ReadableStream({
      start(controller) { controller.enqueue(text); controller.close(); },
    });
  }
};
if (typeof File === "undefined") globalThis.File = class File extends Blob {
  constructor(parts, name, opts) {
    if (arguments.length < 2) throw new TypeError("Failed to construct 'File': 2 arguments required, but only " + arguments.length + " present.");
    opts = opts || {};
    super(parts, opts);
    const modified = opts.lastModified != null ? Number(opts.lastModified) : Date.now();
    _fileState.set(this, {
      name: String(name),
      lastModified: Number.isFinite(modified) ? Math.trunc(modified) : 0,
    });
  }
  get name() { return _fileData(this).name; }
  get lastModified() { return _fileData(this).lastModified; }
  get lastModifiedDate() { return new Date(_fileData(this).lastModified); }
  get webkitRelativePath() { _fileData(this); return ''; }
};

// Web IDL attributes and operations are enumerable prototype members. Re-add
// them in Chrome's interface order after class syntax creates `constructor`
// first and non-enumerable methods.
const _blobPrototype = globalThis.Blob.prototype;
const _filePrototype = globalThis.File.prototype;
const _blobDescriptors = Object.getOwnPropertyDescriptors(_blobPrototype);
const _fileDescriptors = Object.getOwnPropertyDescriptors(_filePrototype);
Object.defineProperty(_blobDescriptors.slice.value, 'length', {value: 0, configurable: true});
for (const name of Object.getOwnPropertyNames(_blobPrototype)) delete _blobPrototype[name];
for (const name of Object.getOwnPropertyNames(_filePrototype)) delete _filePrototype[name];
for (const name of ['size', 'type', 'arrayBuffer', 'slice', 'stream', 'text', 'bytes', 'textStream']) {
  const descriptor = _blobDescriptors[name];
  descriptor.enumerable = true;
  Object.defineProperty(_blobPrototype, name, descriptor);
}
Object.defineProperty(_blobPrototype, 'constructor', _blobDescriptors.constructor);
for (const name of ['name', 'lastModified', 'lastModifiedDate', 'webkitRelativePath']) {
  const descriptor = _fileDescriptors[name];
  descriptor.enumerable = true;
  Object.defineProperty(_filePrototype, name, descriptor);
}
Object.defineProperty(_filePrototype, 'constructor', _fileDescriptors.constructor);
Object.defineProperty(_blobPrototype, Symbol.toStringTag, {
  value: 'Blob', writable: false, enumerable: false, configurable: true,
});
Object.defineProperty(_filePrototype, Symbol.toStringTag, {
  value: 'File', writable: false, enumerable: false, configurable: true,
});
Object.defineProperty(globalThis.Blob, 'length', {value: 0, configurable: true});
Object.defineProperty(globalThis.File, 'length', {value: 2, configurable: true});
_markNative(globalThis.Blob);
_markNative(globalThis.File);
for (const name of ['size', 'type']) _markNative(_blobDescriptors[name].get);
for (const name of ['arrayBuffer', 'slice', 'stream', 'text', 'bytes', 'textStream']) {
  _markNative(_blobDescriptors[name].value);
}
for (const name of ['name', 'lastModified', 'lastModifiedDate', 'webkitRelativePath']) {
  _markNative(_fileDescriptors[name].get);
}
