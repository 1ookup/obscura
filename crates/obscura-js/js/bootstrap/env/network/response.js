// Decode a response body honoring the Content-Type charset, so fetch()/XHR
// over non-UTF-8 resources (GBK, Shift_JIS, ISO-8859-x, ...) return correctly
// decoded text instead of mojibake. The UTF-8 case (the overwhelming majority)
// takes the plain TextDecoder fast path; only an explicit non-UTF-8 charset
// routes through TextDecoder(label), which falls back to UTF-8 on a bad label.
function _decodeBodyWithCharset(bytes, headers) {
  let label = '';
  try {
    const ct = headers && typeof headers.get === 'function' ? (headers.get('content-type') || '') : '';
    const m = /charset\s*=\s*"?([^";]+)"?/i.exec(ct);
    if (m) label = m[1].trim();
  } catch (e) {}
  if (!label || /^utf-?8$/i.test(label)) return new TextDecoder().decode(bytes);
  try { return new TextDecoder(label).decode(bytes); }
  catch (e) { return new TextDecoder().decode(bytes); }
}

const _responseState = new WeakMap();
function _responseData(value) {
  const state = _responseState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
const _Response = class Response {
  constructor(body = null, init = {}) {
    const status = init.status === undefined || init.status === null ? 200 : Number(init.status);
    const state = {
      bodyBytes: _bodyToUint8Array(body),
      status,
      statusText: init.statusText === undefined ? '' : String(init.statusText),
      headers: new Headers(init.headers),
      type: init.type || 'basic',
      url: init.url || '',
      redirected: !!init.redirected,
      bodyUsed: false,
    };
    state.ok = status >= 200 && status < 300;
    _responseState.set(this, state);
  }
  get type() { return _responseData(this).type; }
  get url() { return _responseData(this).url; }
  get redirected() { return _responseData(this).redirected; }
  get status() { return _responseData(this).status; }
  get ok() { return _responseData(this).ok; }
  get statusText() { return _responseData(this).statusText; }
  get headers() { return _responseData(this).headers; }
  get body() { _responseData(this); return null; }
  get bodyUsed() { return _responseData(this).bodyUsed; }
  async text() {
    const state = _responseData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return _decodeBodyWithCharset(state.bodyBytes, state.headers);
  }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() {
    const state = _responseData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return _arrayBufferFromBytes(state.bodyBytes);
  }
  async blob() {
    const state = _responseData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return new Blob([state.bodyBytes], { type: state.headers.get('content-type') || '' });
  }
  async formData() { throw new TypeError('Could not parse the body as FormData.'); }
  async bytes() {
    const state = _responseData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return new Uint8Array(state.bodyBytes);
  }
  textStream() {
    const state = _responseData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    const text = _decodeBodyWithCharset(state.bodyBytes, state.headers);
    return new ReadableStream({ start(controller) { controller.enqueue(text); controller.close(); } });
  }
  clone() {
    const state = _responseData(this);
    if (state.bodyUsed) throw new TypeError("Failed to execute 'clone' on 'Response': Response body is already used");
    return new Response(state.bodyBytes, {
      status: state.status, statusText: state.statusText, headers: state.headers,
      type: state.type, url: state.url, redirected: state.redirected,
    });
  }
  static error() { return new Response(null, { status: 0, type: 'error' }); }
  static redirect(url, status = 302) {
    if (![301, 302, 303, 307, 308].includes(Number(status))) {
      throw new RangeError('Invalid status code');
    }
    let location;
    try { location = new URL(String(url), globalThis.location?.href || 'about:blank').href; }
    catch (_error) { throw new TypeError('Failed to parse URL from Response.redirect'); }
    return new Response(null, { status: Number(status), headers: { Location: location } });
  }
  static json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), { ...init, headers });
  }
};
globalThis.Response = _Response;
_markNative(Response);
for (const name of ['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text', 'bytes', 'textStream']) {
  _markNative(Response.prototype[name]);
}
_reorderWebIDLPrototype(Response.prototype,
  ['type', 'url', 'redirected', 'status', 'ok', 'statusText', 'headers', 'body', 'bodyUsed',
    'arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text', 'bytes', 'textStream', 'constructor']);

if (!Element.prototype.replaceWith) {
  // _convertNodes turns any non-node argument (numbers, booleans, null, …) into
  // a Text node via String(n), matching the spec and append()/prepend(); the
  // old `typeof n === 'string'` check corrupted insert_before for other types.
  Element.prototype.replaceWith = function(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const n of _convertNodes(nodes)) parent.insertBefore(n, this);
    parent.removeChild(this);
  };
  _markNative(Element.prototype.replaceWith);
}
if (!Element.prototype.before) {
  Element.prototype.before = function(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const n of _convertNodes(nodes)) parent.insertBefore(n, this);
  };
  _markNative(Element.prototype.before);
}
if (!Element.prototype.after) {
  Element.prototype.after = function(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const ref = this.nextSibling;
    for (const n of _convertNodes(nodes)) parent.insertBefore(n, ref);
  };
  _markNative(Element.prototype.after);
}

