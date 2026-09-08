// Fast pure-JS UTF-8 decode (the common case: Response/Blob .text(), most
// pages). Avoids the op + JSON round trip for plain UTF-8.
function _utf8DecodeBytes(bytes, start) {
  let str = '', i = start | 0;
  const n = bytes.length;
  while (i < n) {
    const c = bytes[i++];
    if (c < 0x80) { str += String.fromCharCode(c); continue; }
    let needed = 0, cp = 0, min = 0, firstMin = 0x80, firstMax = 0xBF;
    if (c >= 0xC2 && c <= 0xDF) {
      needed = 1; cp = c & 0x1F; min = 0x80;
    } else if (c >= 0xE0 && c <= 0xEF) {
      needed = 2; cp = c & 0x0F; min = 0x800;
      if (c === 0xE0) firstMin = 0xA0;
      if (c === 0xED) firstMax = 0x9F;
    } else if (c >= 0xF0 && c <= 0xF4) {
      needed = 3; cp = c & 0x07; min = 0x10000;
      if (c === 0xF0) firstMin = 0x90;
      if (c === 0xF4) firstMax = 0x8F;
    } else {
      str += '\uFFFD';
      continue;
    }
    let consumed = 0, valid = true;
    while (consumed < needed) {
      if (i >= n) { valid = false; break; }
      const b = bytes[i];
      const low = consumed === 0 ? firstMin : 0x80;
      const high = consumed === 0 ? firstMax : 0xBF;
      if (b < low || b > high) { valid = false; break; }
      cp = (cp << 6) | (b & 0x3F);
      i++; consumed++;
    }
    if (!valid || cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
      str += '\uFFFD';
      continue;
    }
    if (cp <= 0xFFFF) str += String.fromCharCode(cp);
    else {
      const scalar = cp - 0x10000;
      str += String.fromCharCode(0xD800 + (scalar >> 10), 0xDC00 + (scalar & 0x3FF));
    }
  }
  return str;
}
if (typeof TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    constructor(label, options) {
      // No-arg construction (Response.text()/Blob.text() and most pages) is
      // UTF-8; skip the label-validation op on that hot path.
      let name;
      if (label === undefined) {
        name = 'utf-8';
      } else {
        name = Deno.core.ops.op_encoding_for_label(String(label));
        if (!name) throw new RangeError("Failed to construct 'TextDecoder': The encoding label provided ('" + label + "') is invalid.");
      }
      const o = options || {};
      Object.defineProperty(this, 'encoding', { value: name, enumerable: true });
      Object.defineProperty(this, 'fatal', { value: !!o.fatal, enumerable: true });
      Object.defineProperty(this, 'ignoreBOM', { value: !!o.ignoreBOM, enumerable: true });
    }
    decode(input, options) {
      if (input === undefined) return '';
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      // Fast path: plain UTF-8, non-fatal (Response/Blob text, most pages).
      if (this.encoding === 'utf-8' && !this.fatal) {
        let off = 0;
        if (!this.ignoreBOM && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) off = 3;
        return _utf8DecodeBytes(bytes, off);
      }
      // Legacy encodings / fatal mode: encoding_rs via the op.
      const r = JSON.parse(Deno.core.ops.op_text_decode(this.encoding, bytes, this.fatal, this.ignoreBOM));
      if (!r.ok) throw new TypeError("Failed to execute 'decode' on 'TextDecoder': The encoded data was not valid.");
      return r.v;
    }
  };
}

function _splitMediaQueryList(input) {
  const result = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth < 0) return null;
    } else if (ch === ',' && depth === 0) {
      result.push(input.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0 || quote) return null;
  result.push(input.slice(start));
  return result;
}

function _splitMediaAnd(input) {
  const result = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0 && input.slice(i, i + 3).toLowerCase() === 'and'
        && (i === 0 || /\s/.test(input[i - 1]))
        && (i + 3 === input.length || /\s/.test(input[i + 3]))) {
      result.push(input.slice(start, i));
      start = i + 3;
      i += 2;
    }
  }
  result.push(input.slice(start));
  return result;
}

function _mediaViewportDimension(name) {
  const value = name === 'width' ? Number(globalThis.innerWidth) : Number(globalThis.innerHeight);
  if (Number.isFinite(value)) return value;
  return name === 'width' ? 1440 : 900;
}

function _parseMediaPx(value) {
  const match = String(value).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/i);
  if (!match || (!match[2] && Number(match[1]) !== 0)) return null;
  const result = Number(match[1]);
  return Number.isFinite(result) ? result : null;
}

function _compareMediaValues(left, operator, right) {
  if (operator === '<') return left < right;
  if (operator === '<=') return left <= right;
  if (operator === '>') return left > right;
  if (operator === '>=') return left >= right;
  return left === right;
}

function _evaluateMediaDimension(feature) {
  let match = feature.match(/^(min|max)-(width|height)\s*:\s*(.+)$/);
  if (match) {
    const expected = _parseMediaPx(match[3]);
    if (expected === null) return false;
    const actual = _mediaViewportDimension(match[2]);
    return match[1] === 'min' ? actual >= expected : actual <= expected;
  }

  match = feature.match(/^(width|height)\s*:\s*(.+)$/);
  if (match) {
    const expected = _parseMediaPx(match[2]);
    return expected !== null && _mediaViewportDimension(match[1]) === expected;
  }

  match = feature.match(/^(width|height)\s*(<=|>=|=|<|>)\s*(.+)$/);
  if (match) {
    const expected = _parseMediaPx(match[3]);
    return expected !== null
      && _compareMediaValues(_mediaViewportDimension(match[1]), match[2], expected);
  }

  match = feature.match(/^(.+?)\s*(<=|>=|=|<|>)\s*(width|height)$/);
  if (match) {
    const expected = _parseMediaPx(match[1]);
    return expected !== null
      && _compareMediaValues(expected, match[2], _mediaViewportDimension(match[3]));
  }

  match = feature.match(/^(.+?)\s*(<=|>=|<|>)\s*(width|height)\s*(<=|>=|<|>)\s*(.+)$/);
  if (match) {
    const lower = _parseMediaPx(match[1]);
    const upper = _parseMediaPx(match[5]);
    if (lower === null || upper === null) return false;
    const actual = _mediaViewportDimension(match[3]);
    return _compareMediaValues(lower, match[2], actual)
      && _compareMediaValues(actual, match[4], upper);
  }

  if (feature === 'width' || feature === 'height')
    return _mediaViewportDimension(feature) !== 0;
  return null;
}

function _evaluateMediaFeature(raw) {
  let feature = raw.trim().toLowerCase();
  if (feature[0] !== '(' || feature[feature.length - 1] !== ')') return false;
  feature = feature.slice(1, -1).trim();

  const dimension = _evaluateMediaDimension(feature);
  if (dimension !== null) return dimension;

  let match = feature.match(/^orientation\s*:\s*(portrait|landscape)$/);
  if (match) {
    const width = _mediaViewportDimension('width');
    const height = _mediaViewportDimension('height');
    return match[1] === 'portrait' ? height >= width : width > height;
  }

  match = feature.match(/^prefers-color-scheme\s*:\s*(dark|light|no-preference)$/);
  if (match) return match[1] === 'light';
  match = feature.match(/^prefers-reduced-motion\s*:\s*(reduce|no-preference)$/);
  if (match) return match[1] === 'no-preference';

  match = feature.match(/^(pointer|any-pointer)\s*:\s*(none|coarse|fine)$/);
  if (match) return match[2] === 'fine';
  match = feature.match(/^(hover|any-hover)\s*:\s*(none|hover)$/);
  if (match) return match[2] === 'hover';

  if (feature === 'color') return true;
  match = feature.match(/^color\s*:\s*(\d+)$/);
  if (match) return Number(match[1]) === 8;
  return false;
}

function _evaluateOneMediaQuery(raw) {
  let query = raw.trim().toLowerCase();
  if (!query) return false;

  let negate = false;
  let modifier = query.match(/^(not|only)\b\s*/);
  if (modifier) {
    negate = modifier[1] === 'not';
    query = query.slice(modifier[0].length).trim();
  }

  let typeMatches = true;
  if (query[0] !== '(') {
    const type = query.match(/^([a-z][a-z0-9-]*)\b/i);
    if (!type) return false;
    typeMatches = type[1] === 'all' || type[1] === 'screen';
    if (type[1] !== 'all' && type[1] !== 'screen' && type[1] !== 'print')
      typeMatches = false;
    query = query.slice(type[0].length).trim();
    if (query) {
      const conjunction = query.match(/^and\b\s*/);
      if (!conjunction) return false;
      query = query.slice(conjunction[0].length).trim();
    }
  }

  let matches = typeMatches;
  if (query) {
    const conditions = _splitMediaAnd(query);
    if (!conditions.length || conditions.some(condition => !condition.trim())) return false;
    matches = matches && conditions.every(_evaluateMediaFeature);
  }
  return negate ? !matches : matches;
}

function _evaluateMediaQueryList(query) {
  const list = _splitMediaQueryList(String(query));
  return !!list && list.some(_evaluateOneMediaQuery);
}

globalThis.matchMedia = _markNative(function matchMedia(q) {
  const media = q == null ? '' : String(q);
  return {
    get matches() { return _evaluateMediaQueryList(media); },
    media,
    onchange: null,
    addListener(){},
    removeListener(){},
    addEventListener(){},
    removeEventListener(){},
    dispatchEvent(){return true;}
  };
});
// getComputedStyle() returns a fresh declaration object, but those objects all
// observe the same computed style for an element until the document mutates.
// Share the immutable native snapshot behind them. Frameworks routinely call
// getComputedStyle() repeatedly on the same few roots; rebuilding and parsing
// several hundred properties for every wrapper dominated real-page startup.
