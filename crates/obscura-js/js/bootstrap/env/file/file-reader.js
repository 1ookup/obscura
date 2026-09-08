// FileReader fallback for builds without the host-provided implementation.
if (typeof FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null; this.error = null; this.readyState = 0;
      this.onloadstart = null; this.onprogress = null; this.onload = null;
      this.onabort = null; this.onerror = null; this.onloadend = null;
      this._listeners = {};
    }
    get [Symbol.toStringTag]() { return 'FileReader'; }
    _read(blob, kind, encoding) {
      if (this.readyState === 1) {
        throw new DOMException('The object is already busy reading Blobs.', 'InvalidStateError');
      }
      this.readyState = 1;
      this.result = null; this.error = null;
      this._fire('loadstart');
      const self = this;
      Promise.resolve().then(function () {
        if (self.readyState !== 1) return;
        const bytes = _blobBytes(blob) || new Uint8Array(0);
        try {
          if (kind === 'text') self.result = new TextDecoder(encoding || 'utf-8').decode(bytes);
          else if (kind === 'binary') self.result = _bytesToBinaryString(bytes);
          else if (kind === 'dataurl') {
            self.result = 'data:' + ((blob && blob.type) || 'application/octet-stream')
              + ';base64,' + btoa(_bytesToBinaryString(bytes));
          } else self.result = _arrayBufferFromBytes(bytes);
        } catch (error) { self.error = error; }
        self.readyState = 2;
        self._fire('progress'); self._fire('load'); self._fire('loadend');
      });
    }
    readAsText(blob, encoding) { this._read(blob, 'text', encoding); }
    readAsDataURL(blob) { this._read(blob, 'dataurl'); }
    readAsArrayBuffer(blob) { this._read(blob, 'arraybuffer'); }
    readAsBinaryString(blob) { this._read(blob, 'binary'); }
    abort() {
      const wasReading = this.readyState === 1;
      this.readyState = 0; this.result = null;
      if (wasReading) { this._fire('abort'); this._fire('loadend'); }
    }
    _fire(type) {
      const event = { type, target: this, currentTarget: this,
        lengthComputable: false, loaded: 0, total: 0 };
      const handler = this['on' + type];
      if (typeof handler === 'function') { try { handler.call(this, event); } catch (_error) {} }
      const listeners = this._listeners[type];
      if (listeners) for (const listener of listeners.slice()) {
        try { listener.call(this, event); } catch (_error) {}
      }
    }
    addEventListener(type, listener) {
      if (typeof listener === 'function') {
        (this._listeners[type] = this._listeners[type] || []).push(listener);
      }
    }
    removeEventListener(type, listener) {
      const listeners = this._listeners[type];
      if (listeners) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); }
    }
    dispatchEvent() { return true; }
  };
  globalThis.FileReader.EMPTY = 0;
  globalThis.FileReader.LOADING = 1;
  globalThis.FileReader.DONE = 2;
  Object.assign(globalThis.FileReader.prototype, { EMPTY: 0, LOADING: 1, DONE: 2 });
}
