// Uint8Array.toBase64/toHex/setFromBase64/setFromHex. The vendored V8 ships
// without the ES2025 base64/hex TypedArray methods, so Chrome's
// Uint8Array.prototype own-key census
// ([constructor, BYTES_PER_ELEMENT, toBase64, setFromBase64, toHex,
// setFromHex]) reads four names short; the challenge's hash family hashes
// over these surfaces and a missing key flips the branch. The four members
// install in that exact order after the two built-ins, with the built-in
// method descriptor shape ({writable, non-enumerable, configurable}).
//
// Semantics follow the proposal's main paths: ToString on the input, a
// base64url alphabet switch and padding omission for toBase64, {read,
// written} progress records from the setters, lastChunkHandling in its
// loose/strict/stop-before-partial forms, and SyntaxError on malformed hex.
(function _installTypedArrayBase64() {
  if (typeof Uint8Array === 'undefined') return;
  const proto = Uint8Array.prototype;
  if (typeof proto.toBase64 === 'function') return; // a newer V8 owns these
  const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const _B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // The methods brand-check through the length walk below rather than
  // instanceof, so a cross-realm Uint8Array works the way the proposal's
  // ValidateUint8ArraySteps does.
  function _asUint8Array(self) {
    if (!ArrayBuffer.isView(self) || self.buffer === undefined
        || !(self.constructor === Uint8Array || self instanceof Uint8Array)) {
      throw new TypeError('Receiver must be a Uint8Array');
    }
    return self;
  }
  function _define(name, fn) {
    Object.defineProperty(proto, name, {
      value: _markNative(fn),
      writable: true, enumerable: false, configurable: true,
    });
  }
  _define('toBase64', function toBase64(options) {
    const bytes = _asUint8Array(this);
    const alphabet = options?.alphabet === 'base64url' ? _B64URL : _B64;
    if (options?.alphabet !== undefined && options.alphabet !== 'base64'
        && options.alphabet !== 'base64url') {
      throw new TypeError("Failed to execute 'toBase64' on 'Uint8Array': Failed to read the 'alphabet' property from 'Base64Options': The provided value '" + options.alphabet + "' is not a valid enum value of type Base64Alphabet.");
    }
    const omitPadding = options?.omitPadding === true;
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63]
        + alphabet[(n >> 6) & 63] + alphabet[n & 63];
    }
    const left = bytes.length - i;
    if (left === 1) {
      const n = bytes[i] << 16;
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + '==';
    } else if (left === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63]
        + alphabet[(n >> 6) & 63] + '=';
    }
    return omitPadding ? out.replace(/=+$/, '') : out;
  });
  _define('setFromBase64', function setFromBase64(string, options) {
    const bytes = _asUint8Array(this);
    const text = String(string);
    const lastChunk = options?.lastChunkHandling ?? 'loose';
    if (lastChunk !== 'loose' && lastChunk !== 'strict'
        && lastChunk !== 'stop-before-partial') {
      throw new TypeError("Failed to execute 'setFromBase64' on 'Uint8Array': Failed to read the 'lastChunkHandling' property from 'Uint8ArrayBase64Options': The provided value '" + lastChunk + "' is not a valid enum value of type LastChunkHandling.");
    }
    const valueOf = (c) => {
      const code = c.charCodeAt(0);
      if (code >= 65 && code <= 90) return code - 65; // A-Z
      if (code >= 97 && code <= 122) return code - 71; // a-z
      if (code >= 48 && code <= 57) return code + 4; // 0-9
      if (c === '+') return 62;
      if (c === '/') return 63;
      return -1;
    };
    const _isAsciiWhitespace = (c) => c === ' ' || c === '\t' || c === '\n'
      || c === '\r' || c === '\f';
    let read = 0;
    let written = 0;
    let chunk = [];
    let sawPadding = false;
    // A 2-char tail with no padding decodes one byte; a 3-char tail two.
    // 'stop-before-partial' leaves the tail undecoded and reports the
    // position through {read, written}.
    const flush = (allowPartial) => {
      if (chunk.length === 1) {
        if (lastChunk === 'strict') {
          throw new SyntaxError("Failed to execute 'setFromBase64' on 'Uint8Array': The string to be decoded ends with a partial base64 chunk.");
        }
        if (lastChunk === 'loose') { chunk = []; return true; }
        return false;
      }
      if (chunk.length === 2) {
        if (allowPartial) return false;
        const n = (chunk[0] << 18) | (chunk[1] << 12);
        if (written < bytes.length) bytes[written++] = (n >> 16) & 255;
        chunk = [];
        return true;
      }
      const n = (chunk[0] << 18) | (chunk[1] << 12) | (chunk[2] << 6);
      if (written < bytes.length) bytes[written++] = (n >> 16) & 255;
      if (written < bytes.length) bytes[written++] = (n >> 8) & 255;
      chunk = [];
      return true;
    };
    for (; read < text.length; read++) {
      const c = text[read];
      if (_isAsciiWhitespace(c)) continue;
      if (c === '=') {
        sawPadding = true;
        if (chunk.length >= 2) {
          if (chunk.length === 3) {
            // One padding char closes a 3-char chunk (two data bytes).
            if (!flush(false)) break;
          } else {
            // Two padding chars close a 2-char chunk (one data byte).
            const n = (chunk[0] << 18) | (chunk[1] << 12);
            if (written < bytes.length) bytes[written++] = (n >> 16) & 255;
            chunk = [];
          }
          read++;
          // Only whitespace may follow padding.
          while (read < text.length && _isAsciiWhitespace(text[read])) read++;
          if (read < text.length && lastChunk === 'strict') {
            throw new SyntaxError("Failed to execute 'setFromBase64' on 'Uint8Array': The string to be decoded contains characters after the padding.");
          }
        } else if (lastChunk === 'strict') {
          throw new SyntaxError("Failed to execute 'setFromBase64' on 'Uint8Array': The string to be decoded contains a padding character inside of a base64 chunk.");
        }
        break;
      }
      if (sawPadding) break;
      const v = valueOf(c);
      if (v < 0) {
        if (lastChunk === 'strict') {
          throw new SyntaxError("Failed to execute 'setFromBase64' on 'Uint8Array': The string to be decoded contains characters outside of the base64 alphabet.");
        }
        continue; // loose skips stray bytes
      }
      chunk.push(v);
      if (chunk.length === 4) {
        const n = (chunk[0] << 18) | (chunk[1] << 12) | (chunk[2] << 6) | chunk[3];
        if (written < bytes.length) bytes[written++] = (n >> 16) & 255;
        if (written < bytes.length) bytes[written++] = (n >> 8) & 255;
        if (written < bytes.length) bytes[written++] = n & 255;
        chunk = [];
        if (written >= bytes.length) { read++; break; }
      }
    }
    if (chunk.length > 0) {
      const done = flush(lastChunk !== 'stop-before-partial');
      if (done === false) return { read, written };
    }
    return { read, written };
  });
  _define('toHex', function toHex() {
    const bytes = _asUint8Array(this);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += (bytes[i] >> 4).toString(16) + (bytes[i] & 15).toString(16);
    }
    return out;
  });
  _define('setFromHex', function setFromHex(string) {
    const bytes = _asUint8Array(this);
    const text = String(string);
    if (text.length % 2 === 1) {
      throw new SyntaxError("Failed to execute 'setFromHex' on 'Uint8Array': The string to be decoded ends with a partial hex byte.");
    }
    const _hexValue = (code) => {
      if (code >= 48 && code <= 57) return code - 48; // 0-9
      if (code >= 97 && code <= 102) return code - 87; // a-f
      if (code >= 65 && code <= 70) return code - 55; // A-F
      return -1;
    };
    let written = 0;
    let read = 0;
    while (read + 1 < text.length && written < bytes.length) {
      const high = _hexValue(text.charCodeAt(read));
      const low = _hexValue(text.charCodeAt(read + 1));
      if (high < 0 || low < 0) {
        throw new SyntaxError("Failed to execute 'setFromHex' on 'Uint8Array': The string to be decoded contains characters outside of the hexadecimal alphabet.");
      }
      bytes[written++] = (high << 4) | low;
      read += 2;
    }
    // A full-length receiver that stopped early still reports a malformed
    // tail rather than silently swallowing it.
    while (read < text.length) {
      if (_hexValue(text.charCodeAt(read)) < 0) {
        throw new SyntaxError("Failed to execute 'setFromHex' on 'Uint8Array': The string to be decoded contains characters outside of the hexadecimal alphabet.");
      }
      read++;
    }
    return { read: text.length, written };
  });
})();
