// Serialize a FormData into a multipart/form-data body the way a browser does
// when it is passed as fetch()/XHR body. The previous shim did String(body),
// so a FormData became the literal "[object Object]" and the multipart payload
// (with its boundary) was lost; servers replied "Invalid boundary for
// multipart/form-data" (e.g. the AWS WAF challenge /mp_verify POST).
function _formDataToMultipart(fd) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let bnd = '----WebKitFormBoundary';
  for (let i = 0; i < 16; i++) bnd += chars[Math.floor(Math.random() * chars.length)];
  let out = '';
  const entries = fd._d || [];
  for (let i = 0; i < entries.length; i++) {
    const k = entries[i][0], v = entries[i][1];
    out += '--' + bnd + '\r\n';
    const blobBytes = _blobBytes(v);
    if (blobBytes) {
      out += 'Content-Disposition: form-data; name="' + k + '"; filename="' + (v.name || 'blob') + '"\r\n';
      out += 'Content-Type: ' + (v.type || 'application/octet-stream') + '\r\n\r\n';
      try { out += new TextDecoder().decode(blobBytes); } catch (e) {}
      out += '\r\n';
    } else {
      out += 'Content-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(v) + '\r\n';
    }
  }
  out += '--' + bnd + '--\r\n';
  return { boundary: bnd, body: out };
}

// Fetch's RequestRedirect enum. Anything else is a WebIDL failure, thrown
// synchronously rather than rejected -- the value never reaches the algorithm.
const _FETCH_REDIRECT_MODES = new Set(['follow', 'error', 'manual']);

// Coerce a fetch()/XHR body into the string op_fetch_url expects, attaching a
// Content-Type header for body types that need one (FormData, URLSearchParams).
function _serializeBody(initBody, headers) {
  if (initBody == null || initBody === '') return '';
  if (initBody instanceof FormData) {
    const mp = _formDataToMultipart(initBody);
    headers['Content-Type'] = 'multipart/form-data; boundary=' + mp.boundary;
    return mp.body;
  }
  if (initBody instanceof URLSearchParams) {
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    return initBody.toString();
  }
  if (typeof Blob !== 'undefined' && initBody instanceof Blob) {
    if (initBody.type && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = initBody.type;
    }
    return _bytesToBinaryString(_bodyToUint8Array(initBody));
  }
  if (typeof ArrayBuffer !== 'undefined' && initBody instanceof ArrayBuffer) {
    const bytes = new Uint8Array(initBody);
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(initBody) && initBody.buffer instanceof ArrayBuffer) {
    const bytes = new Uint8Array(initBody.buffer, initBody.byteOffset, initBody.byteLength);
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  return typeof initBody === 'string' ? initBody : String(initBody);
}

globalThis.fetch = async (input, init = {}) => {
  init = init || {};
  const inputRequest = input instanceof Request ? _requestData(input) : null;
  let url = typeof input === "string"
    ? input
    : (inputRequest
      ? inputRequest.url
      : ((typeof URL === 'function' && input instanceof URL) ? input.href : (input?.url || input?.href || String(input || ""))));
  if (url && !url.includes('://')) {
    try {
      const base = _environmentSettings().baseUrl;
      url = new URL(url, base).href;
    } catch(e) { /* keep as-is if URL resolution fails */ }
  }
  const method = init.method || (inputRequest ? inputRequest.method : "GET");
  if (url.startsWith('blob:')) {
    const upperMethod = String(method).toUpperCase();
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD') {
      throw new TypeError("Failed to fetch");
    }
    const storedBytes = globalThis.__blobBytesStore?.[url];
    const storedText = globalThis.__blobStore?.[url];
    if (storedBytes === undefined && storedText === undefined) {
      throw new TypeError("Failed to fetch");
    }
    const body = upperMethod === 'HEAD'
      ? null
      : (storedBytes !== undefined ? storedBytes : storedText);
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': globalThis.__blobTypeStore?.[url] || '' },
      type: 'basic',
      url,
      redirected: false,
    });
  }
  let _h = inputRequest ? Object.fromEntries(inputRequest.headers.entries()) : {};
  if (init.headers instanceof Headers) _h = Object.fromEntries(init.headers.entries());
  else if (init.headers !== undefined) _h = init.headers || {};
  const initBody = init.body !== undefined ? init.body : inputRequest?.body;
  if (inputRequest && init.body === undefined) {
    if (inputRequest.bodyUsed) throw new TypeError('Body is unusable');
    if (inputRequest.body !== null && inputRequest.body !== undefined) inputRequest.bodyUsed = true;
  }
  const body = _serializeBody(initBody, _h);
  const hdrs = JSON.stringify(_h);
  const fetchMode = init.mode || (inputRequest ? inputRequest.mode : "cors");
  const fetchCredentials = init.credentials !== undefined
    ? String(init.credentials)
    : (inputRequest ? inputRequest.credentials : "same-origin");
  if (fetchCredentials !== "omit" && fetchCredentials !== "same-origin" && fetchCredentials !== "include") {
    throw new TypeError("Failed to execute 'fetch': '" + fetchCredentials + "' is not a valid RequestCredentials value");
  }
  const fetchRedirect = init.redirect !== undefined
    ? String(init.redirect)
    : (inputRequest ? inputRequest.redirect : "follow");
  if (!_FETCH_REDIRECT_MODES.has(fetchRedirect)) {
    throw new TypeError("Failed to execute 'fetch': '" + fetchRedirect + "' is not a valid RequestRedirect value");
  }
  const fetchSignal = init.signal !== undefined ? init.signal : inputRequest?.signal;
  if (fetchSignal !== undefined && !(fetchSignal instanceof AbortSignal)) {
    throw new TypeError("Failed to execute 'fetch': 'signal' is not an AbortSignal");
  }
  if (fetchSignal?.aborted) throw fetchSignal.reason;
  const pageOrigin = _environmentSettings().origin;
  const performanceStart = performance.now();
  let raw;
  let abortHandler;
  try {
    const operation = Deno.core.ops.op_fetch_url(
      url, method, hdrs, body, pageOrigin, fetchMode, fetchCredentials,
      JSON.stringify({
        url: _environmentSettings().url || globalThis.location?.href || "",
        policy: _environmentReferrerPolicy(),
        redirect: fetchRedirect,
        root: _environmentDocumentRoot(),
      })
    );
    if (fetchSignal) {
      const aborted = new Promise((_, reject) => {
        abortHandler = () => reject(fetchSignal.reason);
        fetchSignal.addEventListener('abort', abortHandler, { once: true });
      });
      raw = await Promise.race([operation, aborted]);
    } else {
      raw = await operation;
    }
  } catch (_error) {
    // Fetch exposes transport failures as a TypeError in browsers. Let the
    // op retain detailed Rust diagnostics in the host log without leaking its
    // implementation-specific Error class into page-visible code.
    if (fetchSignal?.aborted) throw fetchSignal.reason;
    throw new TypeError('Failed to fetch');
  } finally {
    if (fetchSignal && abortHandler) fetchSignal.removeEventListener('abort', abortHandler);
  }
  const parsed = JSON.parse(raw);
  if (parsed.blocked) {
    const err = new TypeError('net::ERR_FAILED');
    err.name = 'AbortError';
    err.__aborted = true;
    throw err;
  }
  if (parsed.corsBlocked) {
    throw new TypeError('Failed to fetch: ' + (parsed.corsError || 'CORS error'));
  }
  // A redirect the op refused to take. "error" is a network error, and carries
  // no more detail than any other one; "manual" is an opaque-redirect
  // response: status, headers and body all withheld, so the page cannot learn
  // where the hop pointed. Chrome reports the *requested* url on it, not an
  // empty one, and leaves `redirected` false -- no hop was taken.
  if (parsed.redirectMode === 'error') {
    throw new TypeError('Failed to fetch');
  }
  if (parsed.redirectMode === 'manual') {
    return new Response('', {
      status: 0,
      statusText: '',
      headers: {},
      type: 'opaqueredirect',
      url: parsed.url || url,
      redirected: false,
    });
  }
  const respType = parsed.status === 0 ? "opaque" : (fetchMode === "no-cors" ? "opaque" : "basic");
  const responseBody = parsed.bodyBase64 ? _base64ToUint8Array(parsed.bodyBase64) : (parsed.body || "");
  const response = new Response(responseBody, {
    status: parsed.status,
    statusText: parsed.statusText || "",
    headers: parsed.headers || {},
    type: respType,
    url: parsed.url || url,
    redirected: (parsed.timing?.redirectCount || 0) > 0,
  });
  if (parsed.status !== 0) {
    const bodySize = responseBody && Number.isFinite(responseBody.byteLength)
      ? responseBody.byteLength : String(parsed.body || '').length;
    _recordFetchResourceTiming(
      { ...parsed, url: parsed.url || url }, 'fetch', performanceStart, pageOrigin, bodySize);
  }
  return response;
};

