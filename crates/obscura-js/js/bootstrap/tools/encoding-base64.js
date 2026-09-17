const _B64_DECODE_TABLE = (function () {
  const t = new Int16Array(128).fill(-1);
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < 64; i++) t[a.charCodeAt(i)] = i;
  return t;
})();

function _base64ToUint8Array(b64) {
  const clean = String(b64 || '').replace(/[\r\n\s]/g, '');
  if (!clean) return new Uint8Array();
  const T = _B64_DECODE_TABLE;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array((clean.length * 3 >> 2) - padding);
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    // charCodeAt avoids the per-char substring alloc; T[code] replaces the
    // O(64) indexOf scan. Out-of-range (NaN or code >= 128) folds to -1, and
    // `=== 61` is `=== '='`, so results match the old code exactly.
    const ca = clean.charCodeAt(i);     const a = ca < 128 ? T[ca] : -1;
    const cb = clean.charCodeAt(i + 1); const b = cb < 128 ? T[cb] : -1;
    const cc = clean.charCodeAt(i + 2); const c = cc === 61 ? 0 : (cc < 128 ? T[cc] : -1);
    const cd = clean.charCodeAt(i + 3); const d = cd === 61 ? 0 : (cd < 128 ? T[cd] : -1);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (out < bytes.length) bytes[out++] = (n >> 16) & 0xff;
    if (out < bytes.length) bytes[out++] = (n >> 8) & 0xff;
    if (out < bytes.length) bytes[out++] = n & 0xff;
  }
  return bytes;
}

function _bodyToUint8Array(body) {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  const blobBytes = _blobBytes(body);
  if (blobBytes) return blobBytes;
  return new TextEncoder().encode(String(body));
}

function _arrayBufferFromBytes(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function _installWasmStreamingFallback() {
  if (typeof WebAssembly === 'undefined') return;
  if (WebAssembly.instantiateStreaming && WebAssembly.instantiateStreaming.__obscuraFallback) return;
  const nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
  const fallback = async function instantiateStreaming(source, imports) {
    const response = await source;
    if (response && typeof response.arrayBuffer === 'function') {
      return WebAssembly.instantiate(await response.arrayBuffer(), imports);
    }
    if (typeof nativeInstantiateStreaming === 'function') {
      return nativeInstantiateStreaming.call(WebAssembly, response, imports);
    }
    return WebAssembly.instantiate(response, imports);
  };
  fallback.__obscuraFallback = true;
  WebAssembly.instantiateStreaming = fallback;
}
_installWasmStreamingFallback();

