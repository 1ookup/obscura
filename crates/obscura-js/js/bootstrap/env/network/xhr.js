const _xhrState = new WeakMap();
const _xhrUploadState = new WeakMap();
const _xhrEventTargetKey = {};
function _xhrData(value) {
  const state = _xhrState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _xhrTargetData(value) {
  const state = _xhrState.get(value) || _xhrUploadState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _xhrHandlerStore(target) {
  const state = _xhrTargetData(target);
  return _xhrState.has(target) ? state.handlers : state.uploadHandlers;
}
function _xhrGetHandler(target, type) {
  return _xhrHandlerStore(target).get(type)?.value || null;
}
function _xhrSetHandler(target, type, value) {
  const store = _xhrHandlerStore(target);
  let entry = store.get(type);
  const callable = typeof value === 'function' ? value : null;
  if (!entry && callable) {
    entry = { value: callable, wrapper: null };
    entry.wrapper = event => {
      const current = store.get(type)?.value;
      if (typeof current === 'function') current.call(target, event);
    };
    store.set(type, entry);
    _eventTargetAdd(target, type, entry.wrapper);
  } else if (entry) {
    entry.value = callable;
    if (!callable) {
      _eventTargetRemove(target, type, entry.wrapper);
      store.delete(type);
    }
  }
}
function _xhrResetResponse(state) {
  state.status = 0; state.statusText = ''; state.responseURL = '';
  state.responseText = ''; state.responseXML = null;
  state.response = state.responseType === '' || state.responseType === 'text' ? '' : null;
  state.responseHeaders = Object.create(null);
}
function _xhrFire(target, type, progress = null) {
  const event = progress ? new ProgressEvent(type, progress) : new Event(type);
  return target.dispatchEvent(__obscura_markTrusted(event));
}
function _xhrReady(target, state, readyState) {
  state.readyState = readyState;
  _xhrFire(target, 'readystatechange');
}
function _xhrBodySize(body) {
  if (body == null) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).length;
  const bytes = _bodyToUint8Array(body);
  return bytes ? bytes.length : 0;
}

const XMLHttpRequestEventTarget = function XMLHttpRequestEventTarget(key) {
  if (key !== _xhrEventTargetKey) {
    throw new TypeError("Failed to construct 'XMLHttpRequestEventTarget': Illegal constructor");
  }
};
Object.setPrototypeOf(XMLHttpRequestEventTarget.prototype, EventTarget.prototype);
const XMLHttpRequestUpload = function XMLHttpRequestUpload(key, state) {
  if (key !== _xhrEventTargetKey) {
    throw new TypeError("Failed to construct 'XMLHttpRequestUpload': Illegal constructor");
  }
  _xhrUploadState.set(this, state);
};
Object.setPrototypeOf(XMLHttpRequestUpload.prototype, XMLHttpRequestEventTarget.prototype);

globalThis.XMLHttpRequest = class XMLHttpRequest {
  constructor() {
    const state = {
      readyState: 0, timeout: 0, withCredentials: false,
      responseURL: '', status: 0, statusText: '', responseType: '',
      response: '', responseText: '', responseXML: null,
      method: 'GET', url: '', async: true,
      headers: Object.create(null), responseHeaders: Object.create(null),
      overrideMimeType: '', sent: false, aborted: false, requestId: 0,
      timeoutId: null, controller: null, handlers: new Map(), uploadHandlers: new Map(),
      attributionReporting: null, privateToken: null,
    };
    state.upload = new XMLHttpRequestUpload(_xhrEventTargetKey, state);
    _xhrState.set(this, state);
  }
  get onreadystatechange() { return _xhrGetHandler(this, 'readystatechange'); }
  set onreadystatechange(value) { _xhrSetHandler(this, 'readystatechange', value); }
  get readyState() { return _xhrData(this).readyState; }
  get timeout() { return _xhrData(this).timeout; }
  set timeout(value) {
    const number = Number(value);
    _xhrData(this).timeout = Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
  }
  get withCredentials() { return _xhrData(this).withCredentials; }
  set withCredentials(value) {
    const state = _xhrData(this);
    if (state.readyState > 1 || state.sent) throw new DOMException('The object is in an invalid state.', 'InvalidStateError');
    state.withCredentials = !!value;
  }
  get upload() { return _xhrData(this).upload; }
  get responseURL() { return _xhrData(this).responseURL; }
  get status() { return _xhrData(this).status; }
  get statusText() { return _xhrData(this).statusText; }
  get responseType() { return _xhrData(this).responseType; }
  set responseType(value) {
    const state = _xhrData(this);
    value = String(value);
    if (!['', 'arraybuffer', 'blob', 'document', 'json', 'text'].includes(value)) value = '';
    if (state.readyState === 3 || state.readyState === 4) {
      throw new DOMException('The object is in an invalid state.', 'InvalidStateError');
    }
    state.responseType = value;
    state.response = value === '' || value === 'text' ? state.responseText : null;
  }
  get response() { return _xhrData(this).response; }
  get responseText() {
    const state = _xhrData(this);
    if (state.responseType !== '' && state.responseType !== 'text') {
      throw new DOMException(
        "Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '" + state.responseType + "').",
        'InvalidStateError');
    }
    return state.responseText;
  }
  get responseXML() { return _xhrData(this).responseXML; }
  abort() {
    const state = _xhrData(this);
    if (state.readyState === 0 || state.readyState === 4 || (state.readyState === 1 && !state.sent)) return;
    state.requestId++; state.aborted = true; state.sent = false;
    if (state.controller) { state.controller.abort(); state.controller = null; }
    if (state.timeoutId !== null) { clearTimeout(state.timeoutId); state.timeoutId = null; }
    _xhrResetResponse(state); _xhrReady(this, state, 4);
    _xhrFire(this, 'abort', {lengthComputable: false, loaded: 0, total: 0});
    _xhrFire(this, 'loadend', {lengthComputable: false, loaded: 0, total: 0});
    state.readyState = 0;
  }
  getAllResponseHeaders() {
    const state = _xhrData(this);
    if (state.readyState < 2) return '';
    return Object.keys(state.responseHeaders).sort()
      .map(name => name + ': ' + state.responseHeaders[name] + '\r\n').join('');
  }
  getResponseHeader(name) {
    const state = _xhrData(this);
    if (state.readyState < 2) return null;
    const value = state.responseHeaders[String(name).toLowerCase()];
    return value === undefined ? null : value;
  }
  open(method, url, async = true, _user = undefined, _password = undefined) {
    if (arguments.length < 2) {
      throw new TypeError("Failed to execute 'open' on 'XMLHttpRequest': 2 arguments required, but only " + arguments.length + ' present.');
    }
    const state = _xhrData(this);
    method = String(method).toUpperCase();
    let resolved;
    try {
      const base = globalThis.location?.href || _domParse('document_url') || 'about:blank';
      resolved = new URL(String(url), base).href;
    } catch (_error) {
      throw new DOMException("Failed to execute 'open' on 'XMLHttpRequest': Invalid URL", 'SyntaxError');
    }
    state.requestId++;
    if (state.timeoutId !== null) { clearTimeout(state.timeoutId); state.timeoutId = null; }
    state.method = method; state.url = resolved; state.async = async !== false;
    state.headers = Object.create(null); state.sent = false; state.aborted = false;
    _xhrResetResponse(state); _xhrReady(this, state, 1);
  }
  overrideMimeType(mime) {
    const state = _xhrData(this);
    if (state.readyState === 3 || state.readyState === 4) {
      throw new DOMException('The object is in an invalid state.', 'InvalidStateError');
    }
    state.overrideMimeType = String(mime);
  }
  send(body = null) {
    const state = _xhrData(this);
    if (state.readyState !== 1 || state.sent) {
      throw new DOMException(
        "Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.",
        'InvalidStateError');
    }
    if (state.method === 'GET' || state.method === 'HEAD') body = null;
    state.sent = true; state.aborted = false;
    const controller = new AbortController();
    state.controller = controller;
    const requestId = ++state.requestId;
    const uploadSize = _xhrBodySize(body);
    _xhrFire(this, 'loadstart', {lengthComputable: false, loaded: 0, total: 0});
    if (body !== null) _xhrFire(state.upload, 'loadstart', {lengthComputable: false, loaded: 0, total: 0});
    if (state.timeout > 0) {
      state.timeoutId = setTimeout(() => {
        if (!state.sent || state.requestId !== requestId) return;
        controller.abort();
        state.controller = null;
        state.requestId++; state.sent = false; state.timeoutId = null;
        _xhrResetResponse(state); _xhrReady(this, state, 4);
        _xhrFire(this, 'timeout', {lengthComputable: false, loaded: 0, total: 0});
        _xhrFire(this, 'loadend', {lengthComputable: false, loaded: 0, total: 0});
      }, state.timeout);
    }
    fetch(state.url, {
      method: state.method, headers: state.headers,
      body: body === null ? undefined : body, mode: 'cors',
      credentials: state.withCredentials ? 'include' : 'same-origin',
      signal: controller.signal,
    }).then(async resp => {
      if (!state.sent || state.requestId !== requestId) return;
      state.status = resp.status; state.statusText = resp.statusText || '';
      state.responseURL = resp.url || state.url;
      state.responseHeaders = Object.create(null);
      if (resp.headers) resp.headers.forEach((value, name) => {
        state.responseHeaders[String(name).toLowerCase()] = String(value);
      });
      _xhrReady(this, state, 2);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (!state.sent || state.requestId !== requestId) return;
      const text = _decodeBodyWithCharset(bytes, resp.headers);
      state.responseText = text; _xhrReady(this, state, 3);
      const declared = Number(state.responseHeaders['content-length']);
      const lengthComputable = Number.isFinite(declared) && declared >= 0;
      const total = lengthComputable ? declared : 0;
      _xhrFire(this, 'progress', {lengthComputable, loaded: bytes.length, total});
      switch (state.responseType) {
        case 'json': try { state.response = JSON.parse(text); } catch (_error) { state.response = null; } break;
        case 'arraybuffer': state.response = _arrayBufferFromBytes(bytes); break;
        case 'blob': state.response = new Blob([bytes], {type: state.responseHeaders['content-type'] || ''}); break;
        case 'document': state.response = text; break;
        default: state.response = text;
      }
      state.sent = false;
      state.controller = null;
      if (state.timeoutId !== null) { clearTimeout(state.timeoutId); state.timeoutId = null; }
      if (body !== null) {
        const uploadProgress = {lengthComputable: true, loaded: uploadSize, total: uploadSize};
        _xhrFire(state.upload, 'progress', uploadProgress);
        _xhrFire(state.upload, 'load', uploadProgress);
        _xhrFire(state.upload, 'loadend', uploadProgress);
      }
      _xhrReady(this, state, 4);
      const progress = {lengthComputable, loaded: bytes.length, total};
      _xhrFire(this, 'load', progress); _xhrFire(this, 'loadend', progress);
    }).catch(error => {
      if (!state.sent || state.requestId !== requestId) return;
      state.sent = false;
      state.controller = null;
      if (state.timeoutId !== null) { clearTimeout(state.timeoutId); state.timeoutId = null; }
      _xhrResetResponse(state); _xhrReady(this, state, 4);
      const type = error && error.__aborted ? 'abort' : 'error';
      _xhrFire(this, type, {lengthComputable: false, loaded: 0, total: 0});
      _xhrFire(this, 'loadend', {lengthComputable: false, loaded: 0, total: 0});
    });
  }
  setRequestHeader(name, value) {
    const state = _xhrData(this);
    if (state.readyState !== 1 || state.sent) {
      throw new DOMException(
        "Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.",
        'InvalidStateError');
    }
    name = String(name).toLowerCase(); value = String(value).trim();
    state.headers[name] = state.headers[name] === undefined ? value : state.headers[name] + ', ' + value;
  }
  setAttributionReporting(options) { _xhrData(this).attributionReporting = options; }
  setPrivateToken(options) { _xhrData(this).privateToken = options; }
};
Object.setPrototypeOf(XMLHttpRequest.prototype, XMLHttpRequestEventTarget.prototype);
globalThis.XMLHttpRequestEventTarget = XMLHttpRequestEventTarget;
globalThis.XMLHttpRequestUpload = XMLHttpRequestUpload;

function _xhrInstallHandler(prototype, name) {
  const getter = function() { return _xhrGetHandler(this, name.slice(2)); };
  const setter = function(value) { _xhrSetHandler(this, name.slice(2), value); };
  Object.defineProperty(getter, 'name', {value: 'get ' + name, configurable: true});
  Object.defineProperty(setter, 'name', {value: 'set ' + name, configurable: true});
  _markNativeAs(getter, 'function get ' + name + '() { [native code] }');
  _markNativeAs(setter, 'function set ' + name + '() { [native code] }');
  Object.defineProperty(prototype, name, {get: getter, set: setter, enumerable: true, configurable: true});
}
const _xhrEventTargetConstructor = Object.getOwnPropertyDescriptor(
  XMLHttpRequestEventTarget.prototype, 'constructor');
delete XMLHttpRequestEventTarget.prototype.constructor;
for (const name of ['onloadstart','onprogress','onabort','onerror','onload','ontimeout','onloadend']) {
  _xhrInstallHandler(XMLHttpRequestEventTarget.prototype, name);
}
Object.defineProperty(XMLHttpRequestEventTarget.prototype, 'constructor', _xhrEventTargetConstructor);
const _xhrProto = XMLHttpRequest.prototype;
const _xhrDescriptors = Object.getOwnPropertyDescriptors(_xhrProto);
for (const name of Object.getOwnPropertyNames(_xhrProto)) delete _xhrProto[name];
for (const name of ['onreadystatechange','readyState','timeout','withCredentials','upload','responseURL',
  'status','statusText','responseType','response','responseText']) {
  const descriptor = _xhrDescriptors[name]; descriptor.enumerable = true;
  Object.defineProperty(_xhrProto, name, descriptor);
}
for (const [name, value] of [['UNSENT',0],['OPENED',1],['HEADERS_RECEIVED',2],['LOADING',3],['DONE',4]]) {
  Object.defineProperty(XMLHttpRequest, name, {value, writable: false, enumerable: true, configurable: false});
  Object.defineProperty(_xhrProto, name, {value, writable: false, enumerable: true, configurable: false});
}
for (const name of ['abort','getAllResponseHeaders','getResponseHeader','open','overrideMimeType','send','setRequestHeader']) {
  const descriptor = _xhrDescriptors[name]; descriptor.enumerable = true;
  Object.defineProperty(_xhrProto, name, descriptor);
}
Object.defineProperty(_xhrProto, 'constructor', _xhrDescriptors.constructor);
for (const name of ['responseXML','setAttributionReporting','setPrivateToken']) {
  const descriptor = _xhrDescriptors[name]; descriptor.enumerable = true;
  Object.defineProperty(_xhrProto, name, descriptor);
}
Object.defineProperty(XMLHttpRequestEventTarget.prototype, Symbol.toStringTag, {
  value: 'XMLHttpRequestEventTarget', configurable: true,
});
Object.defineProperty(XMLHttpRequestUpload.prototype, Symbol.toStringTag, {
  value: 'XMLHttpRequestUpload', configurable: true,
});
Object.defineProperty(_xhrProto, Symbol.toStringTag, {value: 'XMLHttpRequest', configurable: true});
Object.defineProperty(XMLHttpRequestEventTarget, 'length', {value: 0, configurable: true});
Object.defineProperty(XMLHttpRequestUpload, 'length', {value: 0, configurable: true});
for (const ctor of [XMLHttpRequest, XMLHttpRequestEventTarget, XMLHttpRequestUpload]) _markNative(ctor);

