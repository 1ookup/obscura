// DOMRect extends DOMRectReadOnly in every browser, so `rect instanceof
// DOMRectReadOnly` holds and the base interface is reachable on its own.
// Both are [Exposed=(Window,Worker)].
if (typeof DOMRectReadOnly === 'undefined') {
  globalThis.DOMRectReadOnly = class DOMRectReadOnly {
    constructor(x=0,y=0,w=0,h=0) { this.x=x;this.y=y;this.width=w;this.height=h;this.top=y;this.right=x+w;this.bottom=y+h;this.left=x; }
    toJSON() { return {x:this.x,y:this.y,width:this.width,height:this.height,top:this.top,right:this.right,bottom:this.bottom,left:this.left}; }
    static fromRect(r={}) { return new DOMRectReadOnly(r.x,r.y,r.width,r.height); }
  };
}
if (typeof DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRect extends DOMRectReadOnly {
    static fromRect(r={}) { return new DOMRect(r.x,r.y,r.width,r.height); }
  };
}

if (typeof DOMRectList === 'undefined') {
  globalThis.DOMRectList = class DOMRectList {
    constructor(arr=[]) {
      this.length = arr.length;
      for (let i = 0; i < arr.length; i++) this[i] = arr[i];
    }
    item(i) { return this[i] || null; }
    [Symbol.iterator]() {
      let i = 0, self = this;
      return { next() { const done = i >= self.length; return { value: done ? undefined : self[i++], done }; } };
    }
  };
}
if (typeof DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint {
    constructor(x=0,y=0,z=0,w=1) { this.x=x;this.y=y;this.z=z;this.w=w; }
    static fromPoint(p={}) { return new DOMPoint(p.x,p.y,p.z,p.w); }
  };
}
if (typeof DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;this.is2D=true;this.isIdentity=true; }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array() { return new DOMMatrix(); }
    static fromFloat64Array() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint(p) { return new DOMPoint(p?.x||0,p?.y||0); }
  };
}

if (typeof Image === 'undefined') {
  // In a real browser `new Image()` is `document.createElement('img')`, i.e. a
  // full HTMLImageElement. The old plain-class shim had no `.style`, so
  // `new Image().style` was `undefined` and libraries that touch it on a
  // detached image threw (issue #350). Build a real element so `.style`,
  // attribute reflection, and event dispatch all come for free.
  globalThis.Image = function Image(width, height) {
    const img = document.createElement('img');
    if (width !== undefined) img.width = width >>> 0;
    if (height !== undefined) img.height = height >>> 0;
    return img;
  };
  globalThis.Image.prototype = globalThis.HTMLImageElement.prototype;
}

if (typeof Audio === 'undefined') {
  globalThis.Audio = class Audio {
    constructor(src) { this.src = src || ''; this.paused = true; this.volume = 1; this.currentTime = 0; this.duration = 0; }
    play() { return Promise.resolve(); } pause() { this.paused = true; } load() {}
    addEventListener() {} removeEventListener() {}
  };
}

if (typeof FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null; this.error = null; this.readyState = 0; // EMPTY
      this.onloadstart = null; this.onprogress = null; this.onload = null;
      this.onabort = null; this.onerror = null; this.onloadend = null;
      this._listeners = {};
    }
    get [Symbol.toStringTag]() { return "FileReader"; }
    _read(blob, kind, encoding) {
      // Spec: reading while LOADING throws InvalidStateError.
      if (this.readyState === 1) throw new DOMException("The object is already busy reading Blobs.", "InvalidStateError");
      this.readyState = 1; // LOADING
      this.result = null; this.error = null;
      this._fire("loadstart");
      const self = this;
      Promise.resolve().then(function () {
        if (self.readyState !== 1) return; // aborted before completion
        const bytes = _blobBytes(blob) || new Uint8Array(0);
        try {
          if (kind === "text") self.result = new TextDecoder(encoding || "utf-8").decode(bytes);
          else if (kind === "binary") self.result = _bytesToBinaryString(bytes);
          else if (kind === "dataurl") self.result = "data:" + ((blob && blob.type) || "application/octet-stream") + ";base64," + btoa(_bytesToBinaryString(bytes));
          else self.result = _arrayBufferFromBytes(bytes);
        } catch (e) { self.error = e; }
        self.readyState = 2; // DONE
        self._fire("progress"); self._fire("load"); self._fire("loadend");
      });
    }
    readAsText(blob, encoding) { this._read(blob, "text", encoding); }
    readAsDataURL(blob) { this._read(blob, "dataurl"); }
    readAsArrayBuffer(blob) { this._read(blob, "arraybuffer"); }
    readAsBinaryString(blob) { this._read(blob, "binary"); }
    abort() {
      const wasReading = this.readyState === 1;
      this.readyState = 0; this.result = null;
      if (wasReading) { this._fire("abort"); this._fire("loadend"); }
    }
    _fire(type) {
      const ev = { type: type, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0 };
      const h = this["on" + type]; if (typeof h === "function") { try { h.call(this, ev); } catch (e) {} }
      const ls = this._listeners[type]; if (ls) for (const fn of ls.slice()) { try { fn.call(this, ev); } catch (e) {} }
    }
    addEventListener(t, fn) { if (typeof fn === "function") (this._listeners[t] = this._listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const ls = this._listeners[t]; if (ls) { const i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1); } }
    dispatchEvent() { return true; }
  };
  globalThis.FileReader.EMPTY = 0; globalThis.FileReader.LOADING = 1; globalThis.FileReader.DONE = 2;
  Object.assign(globalThis.FileReader.prototype, { EMPTY: 0, LOADING: 1, DONE: 2 });
}

