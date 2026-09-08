const _requestState = new WeakMap();
function _requestData(value) {
  const state = _requestState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _requestBodyBytes(body) {
  if (body == null) return new Uint8Array(0);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return _bodyToUint8Array(body);
  return new TextEncoder().encode(typeof body === 'string' ? body : String(body));
}
const _Request = class Request {
  constructor(input, init = {}) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to construct 'Request': 1 argument required, but only 0 present.");
    }
    const source = input instanceof Request ? _requestData(input) : null;
    init = init || {};
    let url;
    if (source) url = source.url;
    else if (typeof URL === 'function' && input instanceof URL) url = input.href;
    else if (input && typeof input === 'object') url = input.url || input.href || String(input);
    else url = String(input);
    try { url = new URL(String(url), globalThis.location?.href || 'about:blank').href; }
    catch (_error) { throw new TypeError("Failed to construct 'Request': Invalid URL"); }
    const state = {
      url: String(url),
      method: String(init.method !== undefined ? init.method : source?.method || 'GET').toUpperCase(),
      headers: new Headers(init.headers !== undefined ? init.headers : source?.headers),
      body: init.body !== undefined ? init.body : source?.body,
      mode: String(init.mode !== undefined ? init.mode : source?.mode || 'cors'),
      credentials: String(init.credentials !== undefined ? init.credentials : source?.credentials || 'same-origin'),
      redirect: String(init.redirect !== undefined ? init.redirect : source?.redirect || 'follow'),
      referrer: String(init.referrer !== undefined ? init.referrer : source?.referrer || ''),
      referrerPolicy: String(init.referrerPolicy !== undefined ? init.referrerPolicy : source?.referrerPolicy || ''),
      signal: init.signal !== undefined ? init.signal : source?.signal || new AbortController().signal,
      cache: String(init.cache !== undefined ? init.cache : source?.cache || 'default'),
      integrity: String(init.integrity !== undefined ? init.integrity : source?.integrity || ''),
      keepalive: !!(init.keepalive !== undefined ? init.keepalive : source?.keepalive),
      bodyUsed: false,
    };
    if (!['omit', 'same-origin', 'include'].includes(state.credentials)) {
      throw new TypeError("Failed to construct 'Request': '" + state.credentials + "' is not a valid RequestCredentials value");
    }
    if (!_FETCH_REDIRECT_MODES.has(state.redirect)) {
      throw new TypeError("Failed to construct 'Request': '" + state.redirect + "' is not a valid RequestRedirect value");
    }
    _requestState.set(this, state);
  }
  get url() { return _requestData(this).url; }
  get method() { return _requestData(this).method; }
  get headers() { return _requestData(this).headers; }
  get destination() { _requestData(this); return ''; }
  get referrer() { return _requestData(this).referrer; }
  get referrerPolicy() { return _requestData(this).referrerPolicy; }
  get mode() { return _requestData(this).mode; }
  get credentials() { return _requestData(this).credentials; }
  get cache() { return _requestData(this).cache; }
  get redirect() { return _requestData(this).redirect; }
  get integrity() { return _requestData(this).integrity; }
  get keepalive() { return _requestData(this).keepalive; }
  get duplex() { _requestData(this); return 'half'; }
  get isReloadNavigation() { _requestData(this); return false; }
  get isHistoryNavigation() { _requestData(this); return false; }
  get targetAddressSpace() { _requestData(this); return 'unknown'; }
  get signal() { return _requestData(this).signal; }
  get body() { _requestData(this); return null; }
  get bodyUsed() { return _requestData(this).bodyUsed; }
  clone() {
    const state = _requestData(this);
    if (state.bodyUsed) throw new TypeError("Failed to execute 'clone' on 'Request': Request body is already used");
    return new Request(this);
  }
  async text() {
    const state = _requestData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return new TextDecoder().decode(_requestBodyBytes(state.body));
  }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() {
    const state = _requestData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return _requestBodyBytes(state.body).buffer;
  }
  async blob() {
    const state = _requestData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    const ct = state.headers.get('content-type') || '';
    return new Blob([_requestBodyBytes(state.body)], { type: ct });
  }
  async formData() { throw new TypeError('Could not parse the body as FormData.'); }
  async bytes() {
    const state = _requestData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    return _requestBodyBytes(state.body);
  }
  textStream() {
    const state = _requestData(this);
    if (state.bodyUsed) throw new TypeError('Body is unusable');
    state.bodyUsed = true;
    const text = new TextDecoder().decode(_requestBodyBytes(state.body));
    return new ReadableStream({ start(controller) { controller.enqueue(text); controller.close(); } });
  }
};
globalThis.Request = _Request;
_markNative(Request);
for (const name of ['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text', 'bytes', 'textStream']) {
  _markNative(Request.prototype[name]);
}
_reorderWebIDLPrototype(Request.prototype,
  ['method', 'url', 'headers', 'destination', 'referrer', 'referrerPolicy', 'mode',
    'credentials', 'cache', 'redirect', 'integrity', 'keepalive', 'signal', 'duplex',
    'isHistoryNavigation', 'bodyUsed', 'arrayBuffer', 'blob', 'clone', 'formData',
    'json', 'text', 'targetAddressSpace', 'isReloadNavigation', 'body', 'bytes',
    'textStream', 'constructor']);

