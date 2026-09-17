// Performance is not a DOM Node, but its Web IDL interface inherits
// EventTarget. Link the prototype after EventTarget is installed so
// `performance instanceof EventTarget` matches browsers while its listener
// storage remains independent of the DOM tree.
if (typeof Performance === 'function') {
  try { Object.setPrototypeOf(Performance.prototype, EventTarget.prototype); } catch (_error) {}
}

// Service Workers are deliberately not implemented (roadmap §3.2-#11 keeps
// them fail-closed). What *is* implemented is everything a page observes
// without a worker ever running, because the previous stub was wrong in ways
// no browser is: `register()` resolved with undefined, so the universal
// `register().then(reg => reg.scope)` threw a TypeError Chrome never produces,
// and `ready` resolved immediately, so code gated on
// `await navigator.serviceWorker.ready` proceeded where Chrome blocks forever.
// Refusing is honest; faking success is not. Chrome 146 semantics are pinned
// in js-repros/service-worker-fail-closed/chrome-oracle.json.
(function _installServiceWorkerInterfaces() {
  function _illegalConstructor(name) {
    const ctor = function () {
      throw new TypeError("Failed to construct '" + name + "': Illegal constructor");
    };
    Object.defineProperty(ctor, 'name', {value: name, configurable: true});
    Object.defineProperty(ctor.prototype, Symbol.toStringTag, {
      value: name, configurable: true,
    });
    return _markNative(ctor);
  }

  // The interface objects exist even though no instance can be constructed;
  // their absence is itself a fingerprint difference.
  for (const name of [
    'ServiceWorker', 'ServiceWorkerRegistration', 'Worklet',
    'NavigationPreloadManager',
  ]) {
    if (typeof globalThis[name] === 'undefined') {
      globalThis[name] = _illegalConstructor(name);
    }
  }

  function _base() {
    try { return globalThis.document?.baseURI || globalThis.location?.href || ''; }
    catch (_error) { return ''; }
  }
  // An opaque or unavailable origin disables the cross-origin checks rather
  // than rejecting everything: the refusal below is the outcome either way.
  function _origin() {
    try {
      const value = globalThis.location?.origin;
      return value && value !== 'null' ? value : '';
    } catch (_error) { return ''; }
  }

  // The JavaScript MIME types the fetch spec recognises. Chrome accepts
  // exactly this set for a worker script, matched case-insensitively with
  // parameters stripped, and rejects everything else including text/html.
  const _SW_JS_MIME_TYPES = new Set([
    'application/ecmascript', 'application/javascript',
    'application/x-ecmascript', 'application/x-javascript',
    'text/ecmascript', 'text/javascript', 'text/javascript1.0',
    'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3',
    'text/javascript1.4', 'text/javascript1.5', 'text/jscript',
    'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
  ]);

  // %2f / %5c stay escaped through URL parsing, so a scope could otherwise be
  // widened past the directory the script lives in. Chrome refuses both, in
  // either case, in the script URL and in the scope.
  function _swDisallowedEscape(url) {
    return /%2f|%5c/i.test(url.pathname);
  }

  // The default scope is the script's containing directory, and the same value
  // caps how wide an explicit scope may be (absent Service-Worker-Allowed).
  function _swScriptDirectory(script) {
    try { return new URL('./', script).href; }
    catch (_error) { return script.href; }
  }

  function _swHeader(headers, name) {
    if (!headers || typeof headers !== 'object') return null;
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === wanted) {
        const value = headers[key];
        return Array.isArray(value) ? value[0] : value;
      }
    }
    return null;
  }

  // Chrome fetches the script with a header set nothing else produces:
  // `Service-Worker: script` exists only on this request. Skipping the fetch
  // would leave a server-visible hole -- a page that calls register() but
  // never asks for the script -- that no page-side check is needed to spot.
  async function _swFetchScript(script) {
    const raw = await Deno.core.ops.op_fetch_url(
      script.href,
      'GET',
      JSON.stringify({
        'Service-Worker': 'script',
        'Sec-Fetch-Dest': 'serviceworker',
        'Sec-Fetch-Mode': 'same-origin',
        'Sec-Fetch-Site': 'same-origin',
        'Accept': '*/*',
      }),
      '',
      _origin(),
      'same-origin',
      'same-origin',
      // Chrome never takes the hop: a redirected worker script is an error,
      // and following it would log a request Chrome does not send. `redirect`
      // rides on the referrer context because the op is at deno_core's
      // nine-argument ceiling.
      JSON.stringify(Object.assign(
        JSON.parse(_environmentReferrerContext() || '{}'),
        {redirect: 'error'},
      )),
    );
    return JSON.parse(raw);
  }

  // Every failure Chrome reports after the fetch names both URLs; every one it
  // reports before the fetch names neither.
  function _swFetchPrefix(scopeUrl, script) {
    return "Failed to register a ServiceWorker for scope ('" + scopeUrl.href +
      "') with script ('" + script.href + "'): ";
  }

  // The order below is not the spec's reading order, it is Chrome's observed
  // one, pinned by feeding it inputs that fail two checks at once: a redirect
  // to a 404 reports the redirect, a 404 with no MIME type reports the 404,
  // and an over-broad scope with a bad MIME type reports the MIME type.
  async function _swRegisterOverNetwork(script, scopeUrl) {
    const prefix = _swFetchPrefix(scopeUrl, script);
    let response = null;
    try { response = await _swFetchScript(script); }
    catch (_error) { response = null; }
    // The redirect outranks the status code: a 302 to a 404 reports the
    // redirect, not the 404.
    if (response && response.redirected) {
      throw new DOMException(
        prefix + 'The script resource is behind a redirect, which is disallowed.',
        'SecurityError');
    }
    if (!response || !response.status) {
      throw new TypeError(
        prefix + 'An unknown error occurred when fetching the script.');
    }

    if (!(response.status >= 200 && response.status <= 299)) {
      throw new TypeError(prefix + 'A bad HTTP response code (' +
        response.status + ') was received when fetching the script.');
    }

    const essence = String(_swHeader(response.headers, 'content-type') || '')
      .split(';')[0].trim().toLowerCase();
    if (!essence || essence.indexOf('/') < 0) {
      throw new DOMException(prefix + 'The script does not have a MIME type.',
        'SecurityError');
    }
    if (!_SW_JS_MIME_TYPES.has(essence)) {
      throw new DOMException(
        prefix + "The script has an unsupported MIME type ('" + essence + "').",
        'SecurityError');
    }

    // A script may only claim a scope at or below its own directory, unless
    // the response widens the cap with Service-Worker-Allowed.
    const allowed = _swHeader(response.headers, 'service-worker-allowed');
    let maxScope = null;
    if (allowed !== null && allowed !== undefined && String(allowed) !== '') {
      try { maxScope = new URL(String(allowed), script); } catch (_error) { maxScope = null; }
    }
    const capped = maxScope || new URL(_swScriptDirectory(script));
    if (scopeUrl.href.indexOf(capped.href) !== 0) {
      throw new DOMException(prefix + "The path of the provided scope ('" +
        scopeUrl.pathname + "') is not under the max scope allowed (" +
        (maxScope ? "set by Service-Worker-Allowed: '" + maxScope.pathname + "'"
                  : "'" + capped.pathname + "'") +
        '). Adjust the scope, move the Service Worker script, or use the ' +
        'Service-Worker-Allowed HTTP header to allow the scope.',
        'SecurityError');
    }

    // The script was fetched and every check that does not need a worker has
    // passed. Running it does need one, and there is none -- so this is where
    // the refusal belongs, using the error Chrome itself surfaces when site
    // data is blocked so callers' existing failure paths handle it.
    throw new DOMException(
      'Failed to register a ServiceWorker: ' +
      'The user denied permission to use Service Worker.',
      'SecurityError');
  }

  const _containerKey = Symbol('ServiceWorkerContainer');

  class ServiceWorkerContainer {
    constructor(key) {
      if (key !== _containerKey) {
        throw new TypeError(
          "Failed to construct 'ServiceWorkerContainer': Illegal constructor");
      }
      // Preserve the container's private listener storage when linking its
      // prototype to EventTarget below.
      this._listeners = Object.create(null);
      this._handlers = Object.create(null);
      // The spec's [[ready promise]] resolves only once an active
      // registration exists for this client. There is never one, so it stays
      // pending for the document's lifetime, which is exactly what Chrome
      // does on a page that has not registered a worker.
      this._ready = new Promise(function () {});
    }

    get controller() { return null; }
    get ready() { return this._ready; }

    register(scriptURL, options = undefined) {
      if (arguments.length < 1) {
        return Promise.reject(new TypeError(
          "Failed to execute 'register' on 'ServiceWorkerContainer': " +
          '1 argument required, but only 0 present.'));
      }
      const base = _base();
      let script;
      try {
        script = new URL(String(scriptURL), base);
      } catch (_error) {
        return Promise.reject(new TypeError(
          "Failed to register a ServiceWorker: The URL protocol of the script ('" +
          String(scriptURL) + "') is not supported."));
      }
      if (script.protocol !== 'http:' && script.protocol !== 'https:') {
        return Promise.reject(new TypeError(
          "Failed to register a ServiceWorker: The URL protocol of the script ('" +
          script.href + "') is not supported."));
      }
      const origin = _origin();
      if (origin && script.origin !== origin) {
        return Promise.reject(new DOMException(
          "Failed to register a ServiceWorker: The origin of the provided scriptURL ('" +
          script.origin + "') does not match the current origin ('" + origin + "').",
          'SecurityError'));
      }
      const rawScope = options == null ? undefined : options.scope;
      let scope = null;
      if (rawScope !== undefined && rawScope !== null) {
        try {
          scope = new URL(String(rawScope), base);
        } catch (_error) {
          return Promise.reject(new TypeError(
            "Failed to register a ServiceWorker: The URL protocol of the scope ('" +
            String(rawScope) + "') is not supported."));
        }
        if (origin && scope.origin !== origin) {
          return Promise.reject(new DOMException(
            "Failed to register a ServiceWorker: The origin of the provided scope ('" +
            scope.origin + "') does not match the current origin ('" + origin + "').",
            'SecurityError'));
        }
      }
      let scopeUrl;
      try { scopeUrl = scope || new URL(_swScriptDirectory(script)); }
      catch (_error) { scopeUrl = script; }
      // Chrome runs the escape check after both URLs' protocol and origin and
      // before it touches the network, and names both URLs in one message.
      if (_swDisallowedEscape(script) || _swDisallowedEscape(scopeUrl)) {
        return Promise.reject(new TypeError(
          "Failed to register a ServiceWorker: The provided scope ('" +
          scopeUrl.href + "') or scriptURL ('" + script.href +
          "') includes a disallowed escape character."));
      }
      // Everything decidable without the network is decided. Fetching the
      // script does not need a worker either, so it happens for real.
      return _swRegisterOverNetwork(script, scopeUrl);
    }

    getRegistration(clientURL = undefined) {
      if (clientURL !== undefined) {
        const origin = _origin();
        let document_;
        try { document_ = new URL(String(clientURL), _base()); }
        catch (_error) { document_ = null; }
        if (document_ && origin && document_.origin !== origin) {
          return Promise.reject(new DOMException(
            'Failed to get a ServiceWorkerRegistration: The origin of the ' +
            "provided documentURL ('" + document_.origin +
            "') does not match the current origin ('" + origin + "').",
            'SecurityError'));
        }
      }
      return Promise.resolve(undefined);
    }

    getRegistrations() { return Promise.resolve([]); }

    // Buffered messages are delivered to `message` listeners once this is
    // called. No worker can post one, so it is a no-op that returns undefined.
    startMessages() {}

    addEventListener(type, listener) {
      if (typeof listener !== 'function') return;
      const key = String(type);
      (this._listeners[key] || (this._listeners[key] = [])).push(listener);
    }
    removeEventListener(type, listener) {
      const list = this._listeners[String(type)];
      if (list) {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      }
    }
    dispatchEvent(event) {
      if (!event || !event.type) return true;
      for (const listener of (this._listeners[event.type] || []).slice()) {
        try { listener.call(this, event); } catch (error) { console.error(error); }
      }
      const handler = this._handlers[event.type];
      if (typeof handler === 'function') {
        try { handler.call(this, event); } catch (error) { console.error(error); }
      }
      return !event.defaultPrevented;
    }
  }

  for (const type of ['controllerchange', 'message', 'messageerror']) {
    Object.defineProperty(ServiceWorkerContainer.prototype, 'on' + type, {
      get: _markNative(function () { return this._handlers[type] || null; }),
      set: _markNative(function (value) {
        this._handlers[type] = typeof value === 'function' ? value : null;
      }),
      enumerable: true,
      configurable: true,
    });
  }
  for (const key of [
    'register', 'getRegistration', 'getRegistrations', 'startMessages',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
  ]) {
    _markNative(ServiceWorkerContainer.prototype[key]);
  }
  for (const key of ['controller', 'ready']) {
    const descriptor =
      Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, key);
    if (descriptor && descriptor.get) _markNative(descriptor.get);
  }
  Object.defineProperty(ServiceWorkerContainer.prototype, Symbol.toStringTag, {
    value: 'ServiceWorkerContainer', configurable: true,
  });
  // Preserve the container's own event implementation and EventTarget brand.
  try {
    Object.setPrototypeOf(ServiceWorkerContainer.prototype, EventTarget.prototype);
  } catch (_error) {}
  _markNative(ServiceWorkerContainer);
  globalThis.ServiceWorkerContainer = ServiceWorkerContainer;

  // Chrome exposes the container through an accessor on Navigator.prototype,
  // so `navigator` has no own 'serviceWorker' property and the descriptor is
  // found one hop up. A data property on the instance is a bot tell.
  const container = new ServiceWorkerContainer(_containerKey);
  Object.defineProperty(Navigator.prototype, 'serviceWorker', {
    get: _markNative(function serviceWorker() { return container; }),
    set: undefined,
    enumerable: true,
    configurable: true,
  });
})();

