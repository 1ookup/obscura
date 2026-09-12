// ---------------------------------------------------------------------------
// Iframe content documents (Phase 2b). The Rust frame loader commits real
// content documents into the shared DomTree; these wrappers bind Document
// methods to a content root and gate cross-frame access on the typed
// DocumentScope origin. Same NodeId space as the main document, so node
// wrapping reuses _wrap/_cache unchanged. Per-frame realms are Phase 3.7.
// ---------------------------------------------------------------------------

// rootNid -> _ScopedDocument. Flags that at least one content document was
// wrapped this page, which turns on the (otherwise free) ownerDocument logic.
const _scopedDocs = new Map();
let _iframeContentDocsSeen = false;

// Same-origin test between a frame content document and the calling realm.
// The comparison runs in Rust on the typed Origin enum; JS never compares
// serialized origins (two "null" strings are not same-origin). A nested
// frame must compare its child against itself, not against the top document:
// top=A -> frame=B -> child=A is cross-origin to its caller even though the
// child matches top, while a B child remains same-origin with the B caller.
function _frameSameOrigin(rootNid) {
  return _dom("iframe_scopes_same_origin", _callingFrameRoot(), rootNid) === "true";
}

// Cross-document postMessage (Phase 4). Structured cloning reuses the Worker
// JSON envelope (_workerSerializeMessage, a hoisted top-level declaration);
// transfer lists are not supported yet (TODO). The typed-origin targetOrigin
// comparison runs in Rust (op_post_to_frame / op_post_to_parent) and a
// mismatch drops silently per spec; this helper only normalizes the author
// value: WindowPostMessageOptions default "/", and a SyntaxError for a string
// that is neither "*" nor "/" nor a parseable absolute URL.
function _normalizeTargetOrigin(targetOrigin) {
  if (targetOrigin === undefined || targetOrigin === null) return "/";
  if (typeof targetOrigin === "object") return _normalizeTargetOrigin(targetOrigin.targetOrigin);
  const t = String(targetOrigin);
  if (t === "*" || t === "/") return t;
  // Spec: parse as a URL with no base; failure throws SyntaxError. The
  // bootstrap URL shim resolves relative inputs against the document, so an
  // explicit absolute-scheme test replaces the constructor probe here.
  if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(t)) {
    throw new DOMException(
      "Failed to execute 'postMessage' on 'Window': Invalid target origin '"
        + t + "' in a call to 'postMessage'.",
      "SyntaxError");
  }
  return t;
}

// The main frame-message receive op is intentionally unref'd so an idle page
// can settle. A late cross-document post therefore also needs one ref'd event
// loop wake to poll that op after it is notified.
function _wakeFrameMessageDelivery() {
  try {
    if (Deno.core.ops.op_async_runtime_available()) {
      Deno.core.ops.op_posted_task().catch(() => {});
    }
  } catch (e) {}
}

// The calling realm's own content root, 0 in the main Window realm. Frame
// realms get the flag injected by the Rust realm host before bootstrap runs.
// In this shared-isolate model the flag is the realm's identity claim toward
// the postMessage ops (design doc, Constraints) — an honesty boundary, not a
// security proof.
function _callingFrameRoot() {
  const nid = globalThis.__obscura_frame_document_nid;
  return (typeof nid === "number" && nid > 0) ? nid : 0;
}

function _scopedDocumentFor(rootNid) {
  let doc = _scopedDocs.get(rootNid);
  if (!doc) {
    doc = new _ScopedDocument(rootNid);
    _scopedDocs.set(rootNid, doc);
    _cache.set(rootNid, doc);
    _iframeContentDocsSeen = true;
  }
  return doc;
}

// Document bound to an iframe content root. Inherited Document methods that
// route through this.querySelector/this.documentElement/this.createElement
// (head, body, title setter, getElementsBy*, children, ...) become scoped for
// free; only the root-0 primitives are overridden.
class _ScopedDocument extends Document {
  constructor(rootNid) {
    super(rootNid);
    this[_scopeRootSym] = rootNid;
  }
  _scopeInfo() { return _domParse("document_scope_info", this[_scopeRootSym]); }
  get title() {
    const t = _internalQuerySelector(this, "title");
    if (!t) return "";
    return (t.textContent || "").split(/[\t\n\f\r ]+/).filter(Boolean).join(" ");
  }
  set title(v) {
    // The inherited setter builds head/title through this.* methods, which
    // are scoped here.
    Object.getOwnPropertyDescriptor(Document.prototype, "title").set.call(this, v);
  }
  get URL() { const info = this._scopeInfo(); return (info && info.url) || "about:blank"; }
  get baseURI() {
    const info = this._scopeInfo();
    const docUrl = (info && (info.baseUrl || info.url)) || "about:blank";
    const base = _internalQuerySelector(this, "base[href]");
    if (base) {
      const href = base.getAttribute("href");
      if (href) {
        try {
          const resolved = new URL(href, docUrl).href;
          if (_cspBaseUriAllows(resolved)) return resolved;
        } catch (e) {}
      }
    }
    return docUrl;
  }
  get domain() {
    // The frame document's own host, not the embedder's: the base class
    // routes non-top documents through the incumbent (top) document.
    if (typeof this[_effectiveDomainSym] === 'string') return this[_effectiveDomainSym];
    const info = this._scopeInfo();
    if (!info || !info.url) return '';
    if (info.sandboxActive && !info.allowSameOrigin) return '';
    try {
      const host = new URL(info.origin || info.url).hostname;
      return host || '';
    } catch (_e) { return ''; }
  }
  set domain(value) {
    // Same candidate walk as the top-level setter, anchored on this frame's
    // own current host.
    const input = String(value);
    const current = this.domain;
    if (!current) _throwDocumentDomainSecurityError();
    const candidate = Deno.core.ops.op_document_domain_candidate(current, input);
    if (!candidate) _throwDocumentDomainSecurityError();
    this[_effectiveDomainSym] = candidate;
  }
  get compatMode() {
    const info = this._scopeInfo();
    return info && info.quirks ? "BackCompat" : "CSS1Compat";
  }
  // Editing the whole document is not implemented, but the attribute is not
  // optional: every browser reports "off" here, and `undefined` is not a
  // value any of them produce.
  get designMode() { return "off"; }
  set designMode(_value) {}
  get referrer() {
    const info = this._scopeInfo();
    return (info && info.referrer) || "";
  }
  // Wired by the contentDocument/contentWindow getters; null for a document
  // no longer presented in a frame.
  get location() { return this[_defaultViewProxySym] ? this[_defaultViewProxySym].location : null; }
  set location(url) { _navigateCurrentContext(_resolveUrl(String(url)), 'GET', ''); }
  get doctype() {
    const ids = _domParse("child_nodes", this[_scopeRootSym]) || [];
    for (const cid of ids) {
      if (+_dom("node_type", cid) === 10) return _wrap(+cid);
    }
    return null;
  }
}
// Scoped documents share Document's public prototype in Chromium. Their
// getters dispatch on _scopeRootSym above; keeping a second enumerable layer
// would put title/doctype/defaultView before the browser's canonical members.
for (const _scopedPublicName of [
  'title', 'URL', 'baseURI', 'compatMode', 'designMode', 'referrer',
  'location', 'doctype',
]) {
  try { delete _ScopedDocument.prototype[_scopedPublicName]; } catch (_e) {}
}
// _ScopedDocument's own class members shadow Document.prototype; without
// the native marker their toString exposes the source and the challenge
// files them in the fake-'f' bucket instead of Chrome's native one.
_markNative(_ScopedDocument.prototype.querySelector);
_markNative(_ScopedDocument.prototype.querySelectorAll);
_markNative(_ScopedDocument.prototype.getElementById);


// HTML cross-origin Window property allowlist. Everything else on a
// cross-origin WindowProxy throws SecurityError.
const _crossOriginWindowProps = new Set([
  "window", "self", "frames", "length", "top", "parent", "opener", "closed",
  "location", "postMessage", "blur", "focus", "close",
]);

// host nid -> WindowProxy facade. The proxy identity is stable across the
// frame's navigations; every access re-reads the active content root.
const _frameWindowProxies = new Map();

// Rust rebuilds this context-local registry whenever a managed frame realm is
// created or destroyed. Values are live, realm-owned bridges to the frame main
// worlds, so same-origin WindowProxy access reaches the realm that executes the
// frame's scripts instead of a detached JS facade with copied constructors.
function _frameRealmGlobalFor(rootNid) {
  const globals = globalThis.__obscura_frame_realm_globals;
  return globals ? (globals[String(rootNid)] || null) : null;
}

// Materialize a real realm for a freshly-connected same-origin frame whose
// realm the async loader has not built yet. contentDocument and contentWindow
// must both see the same document, so both getters route through here before
// they consult _frameRealmGlobalFor. Only the initial about:blank document
// (empty frameId) needs this: a document the async loader committed already has
// a frameId and will get its realm from ensure_frame_realm on the event loop.
function _materializeFrameRealm(hostNid) {
  const root = +_dom("iframe_content_document_root", hostNid);
  if (root < 0 || !_frameSameOrigin(root) || _frameRealmGlobalFor(root)) return;
  const info = _domParse("document_scope_info", root);
  if (info && info.frameId) return;
  const bridge = Deno.core.ops.op_ensure_frame_realm(hostNid);
  if (bridge) {
    const globals = globalThis.__obscura_frame_realm_globals ||
      (globalThis.__obscura_frame_realm_globals = {});
    globals[String(root)] = bridge;
  }
}
const _chromeWindowKeyOrder = [
  // WindowProxy exposes opener before the event-handler block. The boolean
  // and secure-context globals follow the same native registration order.
  'opener', 'closed', 'crossOriginIsolated', 'credentialless',
  'isSecureContext', 'originAgentCluster', 'offscreenBuffering',
  'window', 'self', 'document', 'location', 'customElements', 'history',
  'navigation', 'locationbar', 'menubar', 'personalbar', 'scrollbars',
  'statusbar', 'toolbar', 'frames', 'top', 'parent', 'frameElement',
  'navigator', 'external', 'screen', 'visualViewport', 'clientInformation',
  'styleMedia', 'scheduler', 'performance', 'trustedTypes', 'crypto',
  'indexedDB', 'localStorage', 'sessionStorage', 'chrome', 'crashReport',
  'cookieStore', 'caches', 'documentPictureInPicture', 'sharedStorage',
  'viewport', 'launchQueue', 'speechSynthesis', 'globalThis', 'JSON', 'Math',
  'Intl', 'Atomics', 'Reflect', 'console', 'CSS', 'Temporal', 'WebAssembly',
  'GPUBufferUsage', 'GPUColorWrite', 'GPUMapMode', 'GPUShaderStage',
  'GPUTextureUsage',
  'onsearch', 'onappinstalled', 'onbeforeinstallprompt', 'onabort',
  'onbeforeinput', 'onbeforematch', 'onbeforetoggle', 'onblur', 'oncancel',
  'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose',
  'oncommand', 'oncontentvisibilityautostatechange', 'oncontextlost',
  'oncontextmenu', 'oncontextrestored', 'oncuechange', 'ondblclick', 'ondrag',
  'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart',
  'ondrop', 'ondurationchange', 'onemptied', 'onended', 'onerror', 'onfocus',
  'onformdata', 'oninput', 'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup',
  'onload', 'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onmousedown',
  'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover',
  'onmouseup', 'onmousewheel', 'onpause', 'onplay', 'onplaying', 'onprogress',
  'onratechange', 'onreset', 'onresize', 'onscroll', 'onscrollend',
  'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect',
  'onslotchange', 'onstalled', 'onsubmit', 'onsuspend', 'ontimeupdate',
  'ontoggle', 'onvolumechange', 'onwaiting', 'onwebkitanimationend',
  'onwebkitanimationiteration', 'onwebkitanimationstart', 'onwebkittransitionend',
  'onwheel', 'onauxclick', 'ongotpointercapture', 'onlostpointercapture',
  'onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel',
  'onpointerover', 'onpointerout', 'onpointerenter', 'onpointerleave',
  'onselectstart', 'onselectionchange', 'onanimationcancel', 'onanimationend',
  'onanimationiteration', 'onanimationstart', 'ontransitionrun',
  'ontransitionstart', 'ontransitionend', 'ontransitioncancel', 'onbeforexrselect',
  'onafterprint', 'onbeforeprint', 'onbeforeunload', 'onhashchange',
  'onlanguagechange', 'onmessage', 'onmessageerror', 'onoffline', 'ononline',
  'onpagehide', 'onpageshow', 'onpopstate', 'onrejectionhandled', 'onstorage',
  'onunhandledrejection', 'onunload', 'ondevicemotion', 'ondeviceorientation',
  'ondeviceorientationabsolute', 'onpointerrawupdate', 'onpageswap',
  'onpagereveal', 'fence', 'onscrollsnapchange', 'onscrollsnapchanging',
  'ongamepadconnected', 'ongamepaddisconnected',
];
function _orderedWindowNames(names) {
  const rank = new Map(_chromeWindowKeyOrder.map((key, index) => [key, index]));
  const values = Array.from(names);
  const indices = values.filter(key => _isWindowIndexKey(key))
    .sort((a, b) => Number(a) - Number(b));
  const named = values.filter(key => !_isWindowIndexKey(key));
  named.sort((a, b) => (rank.get(a) ?? 10_000) - (rank.get(b) ?? 10_000));
  return indices.concat(named);
}
function _isWindowIndexKey(key) {
  if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < 0xFFFFFFFF;
}
function _frameRealmOwnKeys(realmGlobal) {
  let keys;
  try { keys = realmGlobal.Reflect.ownKeys(realmGlobal); }
  catch (e) { keys = Reflect.ownKeys(realmGlobal); }
  const rank = new Map(_chromeWindowKeyOrder.map((key, index) => [key, index]));
  const indices = keys.filter(key => _isWindowIndexKey(key))
    .sort((a, b) => Number(a) - Number(b));
  const strings = keys.filter(key => typeof key === 'string' && !_isWindowIndexKey(key));
  const symbols = keys.filter(key => typeof key !== 'string');
  strings.sort((a, b) => (rank.get(a) ?? 10_000) - (rank.get(b) ?? 10_000));
  return indices.concat(strings, symbols);
}
function _frameRealmOwnDescriptor(realmGlobal, key) {
  try { return realmGlobal.Object.getOwnPropertyDescriptor(realmGlobal, key); }
  catch (e) { return Reflect.getOwnPropertyDescriptor(realmGlobal, key); }
}

// Realm-local views of this realm's globals, one set per frame WindowProxy.
//
// A browser gives every frame its own realm, so `frame.Object !== Object` and
// an object built in one frame fails `instanceof` in the other. obscura runs
// the initial about:blank frame in this realm, so the constructors have to be
// made distinct here: a wrapper that constructs through the real one but
// carries its own identity and its own prototype, with the statics inherited
// rather than copied.
const _iframeRealmGlobalCache = new WeakMap();
const _frameRealmProxyMethodCache = new WeakMap();

function _frameRealmProxyMethod(realmGlobal, name, delegate) {
  let cache = _frameRealmProxyMethodCache.get(realmGlobal);
  if (!cache) {
    cache = new Map();
    _frameRealmProxyMethodCache.set(realmGlobal, cache);
  }
  if (cache.has(name)) return cache.get(name);
  let wrapped = delegate;
  try {
    const parameters = name === 'postMessage' ? 'message' : '';
    const factory = Reflect.construct(realmGlobal.Function, [
      'delegate',
      'return ({' + name + '(' + parameters
        + '){return Reflect.apply(delegate,this,arguments)}}).' + name,
    ]);
    wrapped = Reflect.apply(factory, realmGlobal, [delegate]);
  } catch (_error) {}
  _markNative(wrapped);
  cache.set(name, wrapped);
  return wrapped;
}

function _iframeSourceIsConstructor(value) {
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch (e) {
    return false;
  }
}

function _iframeRealmFunction(target, name, source) {
  let wrapped;
  if (_iframeSourceIsConstructor(source)) {
    wrapped = function (...args) {
      if (new.target) return Reflect.construct(source, args, new.target);
      return Reflect.apply(source, this === target ? globalThis : this, args);
    };
    if (source.prototype && (typeof source.prototype === 'object' || typeof source.prototype === 'function')) {
      const prototype = Object.create(source.prototype);
      Object.defineProperty(prototype, 'constructor', {
        value: wrapped,
        writable: true,
        configurable: true,
      });
      wrapped.prototype = prototype;
    }
  } else {
    wrapped = (...args) => Reflect.apply(source, globalThis, args);
  }
  // Inherit static members such as Promise.resolve, Object.keys, and
  // Array.isArray while keeping the constructor identity realm-local.
  try { Object.setPrototypeOf(wrapped, source); } catch (e) {}
  try { Object.defineProperty(wrapped, 'name', { value: name, configurable: true }); } catch (e) {}
  try { Object.defineProperty(wrapped, 'length', { value: source.length, configurable: true }); } catch (e) {}
  return _markNative(wrapped);
}

function _iframeRealmGlobal(target, name) {
  let cache = _iframeRealmGlobalCache.get(target);
  if (!cache) {
    cache = new Map();
    _iframeRealmGlobalCache.set(target, cache);
  }
  if (cache.has(name)) return cache.get(name);

  const source = globalThis[name];
  let value = source;
  if (typeof source === 'function') {
    value = _iframeRealmFunction(target, name, source);
  } else if (source && typeof source === 'object') {
    // Namespace objects such as Math, JSON, Reflect, and Intl belong to the
    // child global too. A lightweight facade gives each iframe a stable,
    // distinct object without copying large immutable tables.
    value = Object.create(source);
  }
  cache.set(name, value);
  return value;
}

// The window surface of a same-origin frame whose realm the loader has not
// built yet -- the initial about:blank, read on the line after the iframe was
// appended.
//
// That window is real and its platform surface comes from the engine, not
// from either document, so it is this realm's. What it must not carry is
// anything the *page* put on its own global: the difference between a fresh
// frame's window and the page's is exactly what a fingerprinting probe
// measures, and answering with the page's globals would erase a signal a
// browser does produce. `_pristineGlobalNames` is the set as it stood when
// bootstrap finished, before any page script ran.
// Assigned at the very bottom of this file, once every interface is installed.
let _pristineGlobalNames = new Set();
function _blankFrameSurfaceHas(key) {
  return typeof key === "string" && _pristineGlobalNames.has(key);
}

function _frameWindowProxyFor(hostEl) {
  const hostNid = hostEl[_nidSym];
  const existing = _frameWindowProxies.get(hostNid);
  if (existing) return existing;

  // A same-origin frame whose realm the async loader has not built yet (the
  // freshly-appended about:blank) must still expose a real realm: a probe reads
  // contentWindow on the line after append and enumerates it, and the wrapper
  // fallback reads as tampered.
  _materializeFrameRealm(hostNid);

  const contentRoot = () => +_dom("iframe_content_document_root", hostNid);
  const sameOrigin = () => {
    const root = contentRoot();
    return root >= 0 && _frameSameOrigin(root);
  };
  const securityError = () => new DOMException(
    'Blocked a frame with origin "'
      + (globalThis.location ? globalThis.location.origin : "null")
      + '" from accessing a cross-origin frame.',
    "SecurityError");
  const navigate = (value) => {
    const url = _resolveUrl(String(value));
    if (_queueBlobIframeDocument(hostNid, url)) return;
    Deno.core.ops.op_navigate_iframe(hostNid, url, "GET", "");
  };

  // Stable per-proxy location. Reads re-check the frame origin on every
  // access; writes/assign/replace are permitted cross-origin per HTML and
  // enqueue a navigation through the Rust frame controller.
  const frameLocation = {
    get href() {
      const root = contentRoot();
      if (root < 0 || !_frameSameOrigin(root)) throw securityError();
      const info = _domParse("document_scope_info", root);
      return (info && info.url) || "about:blank";
    },
    set href(v) { navigate(v); },
    assign(v) { navigate(v); },
    replace(v) { navigate(v); },
    reload() {
      const root = contentRoot();
      const info = root >= 0 ? _domParse("document_scope_info", root) : null;
      navigate((info && info.url) || "about:blank");
    },
    toString() { return this.href; },
  };
  for (const part of ["origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"]) {
    Object.defineProperty(frameLocation, part, {
      get() {
        // this.href throws SecurityError cross-origin; let it propagate.
        const href = this.href;
        try { const u = new URL(href); return u[part]; }
        catch (e) { return part === "pathname" ? "/" : ""; }
      },
      configurable: true,
      enumerable: true,
    });
  }

  const target = {
    // WindowProxy's own surface starts with these aliases in Chromium.
    // Defining them first keeps iframe enumeration order stable without a
    // post-hoc reorder in the proxy trap.
    get window() { return proxy; },
    get self() { return proxy; },
    get document() {
      const root = contentRoot();
      if (root < 0) return null;
      if (!_frameSameOrigin(root)) throw securityError();
      const realmGlobal = _frameRealmGlobalFor(root);
      if (realmGlobal && realmGlobal.document) {
        realmGlobal.document[_defaultViewProxySym] = proxy;
        return realmGlobal.document;
      }
      const doc = _scopedDocumentFor(root);
      doc[_defaultViewProxySym] = proxy;
      return doc;
    },
    get location() {
      const root = contentRoot();
      if (root >= 0 && _frameSameOrigin(root)) {
        const realmGlobal = _frameRealmGlobalFor(root);
        if (realmGlobal && realmGlobal.location) return realmGlobal.location;
      }
      return frameLocation;
    },
    set location(v) { navigate(v); },
    get name() {
      if (!sameOrigin()) throw securityError();
      return hostEl.getAttribute("name") || "";
    },
    // Single-realm: the top and (for frames embedded by the top document)
    // parent window are the main global. The full ancestor WindowProxy chain
    // for nested frames arrives with per-frame realms (Phase 3.7).
    get length() {
      const root = contentRoot();
      if (root < 0) return 0;
      return (_domParse("query_selector_all_scoped", root, "iframe") || []).length;
    },
    get closed() { return false; },
    get opener() { return null; },
    // Cross-document messaging (Phase 4): enqueue through the realm-aware
    // Rust queue. Works from the main realm and from a frame realm holding a
    // nested frame's proxy; the sender identifies its own realm.
    postMessage(message, targetOrigin) {
      const to = _normalizeTargetOrigin(targetOrigin);
      const payload = _workerSerializeMessage(message);
      try {
        if (Deno.core.ops.op_post_to_frame(hostNid, payload, to, _callingFrameRoot()) === "ok") {
          _wakeFrameMessageDelivery();
        }
      } catch (e) {}
    },
    blur() {},
    focus() {},
    close() {},
  };
  // A probe that reads frame.contentWindow.postMessage gets the source of a
  // plain function back unless it is marked native; Chrome answers
  // `[native code]` for these WindowProxy members.
  _markNative(target.postMessage);
  _markNative(target.blur);
  _markNative(target.focus);
  _markNative(target.close);
  Object.defineProperties(target, {
    frames: { get: () => proxy, enumerable: true, configurable: true },
    top: { get: () => globalThis, enumerable: true, configurable: true },
    parent: { get: () => globalThis, enumerable: true, configurable: true },
    frameElement: {
      get: () => { if (!sameOrigin()) throw securityError(); return hostEl; },
      enumerable: true,
      configurable: true,
    },
  });
  _alignPropertiesOrder(target, _chromeWindowKeyOrder);

  const proxy = new Proxy(target, {
    // Access checks run per property operation, not only on contentDocument:
    // cross-origin callers get the HTML allowlist; anything else throws.
    get(t, key) {
      if (key === "globalThis") {
        if (!sameOrigin()) throw securityError();
        return proxy;
      }
      // `constructor` is inherited off the target's Object.prototype, which
      // would answer the *main* realm's Object. A browser answers the frame's
      // own Window, so route it through the frame realm like every other
      // Window member instead of the target's prototype chain.
      if (key === "constructor") {
        if (!sameOrigin()) throw securityError();
        const realmGlobal = _frameRealmGlobalFor(contentRoot());
        return realmGlobal ? Reflect.get(realmGlobal, "constructor", realmGlobal) : Object;
      }
      if ((key === "postMessage" || key === "blur" || key === "focus" || key === "close")
          && sameOrigin()) {
        const realmGlobal = _frameRealmGlobalFor(contentRoot());
        if (realmGlobal) {
          if (key === "postMessage") {
            return _frameRealmProxyMethod(realmGlobal, key, Reflect.get(t, key));
          }
          const value = Reflect.get(realmGlobal, key, realmGlobal);
          _markNative(value);
          return value;
        }
      }
      if (Reflect.has(t, key)) return Reflect.get(t, key);
      if (typeof key === "string" && !sameOrigin()) throw securityError();
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      if (realmGlobal) return Reflect.get(realmGlobal, key, realmGlobal);
      if (key === "globalThis") return proxy;
      return _blankFrameSurfaceHas(key) ? _iframeRealmGlobal(t, key) : undefined;
    },
    set(t, key, value) {
      if (typeof key === "string" && !_crossOriginWindowProps.has(key) && !sameOrigin()) {
        throw securityError();
      }
      if (Reflect.has(t, key)) return Reflect.set(t, key, value);
      const realmGlobal = sameOrigin() ? _frameRealmGlobalFor(contentRoot()) : null;
      return realmGlobal
        ? Reflect.set(realmGlobal, key, value, realmGlobal)
        : Reflect.set(t, key, value);
    },
    has(t, key) {
      if (key === "globalThis") return sameOrigin();
      if (key === "constructor") {
        if (!sameOrigin()) return false;
        const realmGlobal = _frameRealmGlobalFor(contentRoot());
        return realmGlobal ? Reflect.has(realmGlobal, "constructor") : true;
      }
      if (Reflect.has(t, key)) return true;
      if (typeof key === "string" && !sameOrigin()) return false;
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      if (realmGlobal) return Reflect.has(realmGlobal, key);
      return key === "globalThis" || _blankFrameSurfaceHas(key);
    },
    ownKeys(t) {
      if (!sameOrigin()) return Reflect.ownKeys(t);
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      const source = realmGlobal
        ? _frameRealmOwnKeys(realmGlobal) : _pristineGlobalNames;
      const keys = [];
      const seen = new Set();
      for (const key of source) {
        if (key === "constructor") continue;
        if (!seen.has(key)) { seen.add(key); keys.push(key); }
      }
      for (const key of Reflect.ownKeys(t)) {
        if (!seen.has(key)) { seen.add(key); keys.push(key); }
      }
      return _orderedWindowNames(keys);
    },
    getOwnPropertyDescriptor(t, key) {
      const own = Reflect.getOwnPropertyDescriptor(t, key);
      if (own) return own;
      if (typeof key === "string" && !sameOrigin()) return undefined;
      if (key === "constructor") return undefined;
      if (key === "globalThis") {
        return { value: proxy, writable: true, enumerable: false, configurable: true };
      }
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      let descriptor;
      if (realmGlobal) {
        descriptor = _frameRealmOwnDescriptor(realmGlobal, key);
      } else if (key === "globalThis") {
        descriptor = { value: proxy, writable: true, enumerable: false };
      } else if (_blankFrameSurfaceHas(key)) {
        const source = Reflect.getOwnPropertyDescriptor(globalThis, key);
        descriptor = source && {
          value: _iframeRealmGlobal(t, key),
          writable: source.writable !== false,
          enumerable: source.enumerable,
        };
      }
      if (!descriptor) return undefined;
      descriptor.configurable = true;
      return descriptor;
    },
    defineProperty(t, key, descriptor) {
      if (!sameOrigin()) throw securityError();
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      return realmGlobal
        ? Reflect.defineProperty(realmGlobal, key, descriptor)
        : Reflect.defineProperty(t, key, descriptor);
    },
    deleteProperty(t, key) {
      if (!sameOrigin()) throw securityError();
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      return realmGlobal
        ? Reflect.deleteProperty(realmGlobal, key)
        : Reflect.deleteProperty(t, key);
    },
    getPrototypeOf(t) {
      if (!sameOrigin()) return Reflect.getPrototypeOf(t);
      const realmGlobal = _frameRealmGlobalFor(contentRoot());
      return realmGlobal ? Reflect.getPrototypeOf(realmGlobal) : Reflect.getPrototypeOf(t);
    },
  });
  _frameWindowProxies.set(hostNid, proxy);
  return proxy;
}
// The Rust-built frame-message delivery script and the main realm's recv
// loop resolve these by name from separate scripts; export them explicitly
// (snapshot-context scripts do not expose top-level declarations by name).
globalThis._wrapEl = _wrapEl;
globalThis._frameWindowProxyFor = _frameWindowProxyFor;

// Main-realm delivery pump for cross-document messages (Phase 4). Mirrors
// Worker._recvLoop: an unref'd async op parks until a frame posts toward the
// main Window, so an idle page still settles while delivery happens whenever
// the embedder pumps the event loop. Started lazily by the Rust pump paths
// (ObscuraJsRuntime::ensure_frame_message_pump) the first time a main-realm
// message is queued — an async op can only be spawned inside a live tokio
// context, and messages queue in Rust until the loop's first scan, so the
// late start loses nothing. Frame realms receive through the Rust-side drain
// (ObscuraJsRuntime::drain_frame_messages) instead.
let _frameMessageLoopStarted = false;
async function _frameMessageRecvLoop() {
  if (_frameMessageLoopStarted) return;
  _frameMessageLoopStarted = true;
  while (true) {
    let batchJson;
    try {
      const pending = Deno.core.ops.op_frame_message_recv();
      // The op completes eagerly when messages are already queued; unref of
      // an already-settled op promise must not tear the loop down.
      try { Deno.core.unrefOpPromise(pending); } catch (e) {}
      batchJson = await pending;
    } catch (e) { break; }
    if (!batchJson) break;
    let entries = [];
    try { entries = JSON.parse(batchJson); } catch (e) { continue; }
    for (const entry of entries) {
      if (!entry) continue;
      let data;
      try { data = JSON.parse(entry.data).v; } catch (e) { continue; }
      // The sender is a frame document; its WindowProxy in this realm comes
      // from the host element, so e.source === host.contentWindow holds.
      let source = null;
      if (typeof entry.sourceHost === "number" && entry.sourceHost > 0) {
        try {
          const hostEl = _wrapEl(entry.sourceHost);
          if (hostEl) source = _frameWindowProxyFor(hostEl);
        } catch (e) {}
      }
      // postMessage delivery is performed by the user agent, so its event is
      // trusted. Author-created `new MessageEvent(...)` instances remain
      // untrusted; only this browser-owned delivery path marks the event.
      const evt = __obscura_markTrusted(new MessageEvent("message", {
        data, origin: entry.origin || "", source
      }));
      try { globalThis.dispatchEvent(evt); } catch (e) { console.error("message dispatch error:", e); }
      if (typeof globalThis.onmessage === "function") {
        try {
          _withLegacyWindowEvent(evt, () => globalThis.onmessage.call(globalThis, evt));
        } catch (e) { console.error("onmessage error:", e); }
      }
    }
  }
}
// Rust starts the pump by name (ensure_frame_message_pump). Top-level
// declarations in the snapshot-built main context are not reachable from
// later scripts, so export explicitly — same reason as `globalThis._wrap`.
globalThis._frameMessageRecvLoop = _frameMessageRecvLoop;

// Frame-realm `parent` / `top` references (Phase 4; the frame side of Phase
// 2.5). Each is a window reference backed by ops: postMessage routes through
// op_post_to_parent, a same-origin ancestor exposes its document, and
// cross-origin access is limited to the HTML cross-origin Window allowlist —
// the same policy _frameWindowProxyFor enforces in the other direction. A
// nested frame's `parent` addresses its direct parent document's realm and
// `top` always addresses the main Window.
const _ancestorWindowRefs = new Map();
function _ancestorWindowRef(selfRoot, targetRoot /* 0 = top document */, toTop) {
  const cacheKey = selfRoot + ":" + targetRoot;
  const cached = _ancestorWindowRefs.get(cacheKey);
  if (cached) return cached;
  const sameOrigin = () =>
    _dom("iframe_scopes_same_origin", selfRoot, targetRoot) === "true";
  const securityError = () => new DOMException(
    'Blocked a frame with origin "'
      + (globalThis.location ? globalThis.location.origin : "null")
      + '" from accessing a cross-origin frame.',
    "SecurityError");
  const targetGlobal = () => _frameRealmGlobalFor(targetRoot);
  const navigate = (value) => {
    const url = _resolveUrl(String(value));
    Deno.core.ops.op_navigate_frame(targetRoot, url, "GET", "");
  };
  const ancestorLocation = {
    get href() {
      if (!sameOrigin()) throw securityError();
      if (targetRoot > 0) {
        const info = _domParse("document_scope_info", targetRoot);
        return (info && info.url) || "about:blank";
      }
      return _domParse("document_url") || "about:blank";
    },
    set href(v) { navigate(v); },
    assign(v) { navigate(v); },
    replace(v) { navigate(v); },
    reload() { navigate(this.href); },
    toString() { return this.href; },
  };
  const target = {
    postMessage(message, targetOrigin) {
      const to = _normalizeTargetOrigin(targetOrigin);
      const payload = _workerSerializeMessage(message);
      try {
        if (Deno.core.ops.op_post_to_parent(_callingFrameRoot() || selfRoot, payload, to, !!toTop) === "ok") {
          // A frame can post after the main event loop has gone idle. The
          // receive pump is intentionally unref'd, so wake one ref'd browser
          // tick as well; it will poll the pending message op and dispatch it.
          _wakeFrameMessageDelivery();
        }
      } catch (e) {}
    },
    get document() {
      if (!sameOrigin()) throw securityError();
      const realmGlobal = targetGlobal();
      if (realmGlobal && realmGlobal.document) return realmGlobal.document;
      return targetRoot > 0 ? _scopedDocumentFor(targetRoot) : null;
    },
    get location() {
      if (sameOrigin()) {
        const realmGlobal = targetGlobal();
        if (realmGlobal && realmGlobal.location) return realmGlobal.location;
      }
      return ancestorLocation;
    },
    set location(v) { navigate(v); },
    get top() { return toTop ? ref : globalThis.top; },
    get parent() {
      if (targetRoot === 0) return ref;
      const container = _domParse("frame_container_info", targetRoot) || {};
      const parentRoot =
        typeof container.parentRoot === "number" && container.parentRoot > 0
          ? container.parentRoot : 0;
      return _ancestorWindowRef(selfRoot, parentRoot, parentRoot === 0);
    },
    get length() {
      const root = targetRoot > 0 ? targetRoot : +_dom("document_node_id");
      return (_domParse("query_selector_all_scoped", root, "iframe") || []).length;
    },
    get closed() { return false; },
    get opener() { return null; },
    blur() {},
    focus() {},
    close() {},
  };
  // Same WindowProxy-member marking as _frameWindowProxyFor, for the
  // parent/top facades a nested frame sees.
  _markNative(target.postMessage);
  _markNative(target.blur);
  _markNative(target.focus);
  _markNative(target.close);
  Object.defineProperty(target, "self", { get: () => ref, enumerable: true, configurable: true });
  Object.defineProperty(target, "window", { get: () => ref, enumerable: true, configurable: true });
  Object.defineProperty(target, "frames", { get: () => ref, enumerable: true, configurable: true });
  _alignPropertiesOrder(target, _chromeWindowKeyOrder);
  const ref = new Proxy(target, {
    get(t, key) {
      if (key === "globalThis") {
        if (!sameOrigin()) throw securityError();
        return ref;
      }
      if (key === "constructor") {
        if (!sameOrigin()) throw securityError();
        const realmGlobal = targetGlobal();
        return realmGlobal ? Reflect.get(realmGlobal, "constructor", realmGlobal) : Object;
      }
      if (Reflect.has(t, key)) return Reflect.get(t, key);
      if (typeof key === "string" && !sameOrigin()) throw securityError();
      const realmGlobal = targetGlobal();
      return realmGlobal ? Reflect.get(realmGlobal, key, realmGlobal) : undefined;
    },
    set(t, key, value) {
      if (typeof key === "string" && !_crossOriginWindowProps.has(key) && !sameOrigin()) {
        throw securityError();
      }
      if (Reflect.has(t, key)) return Reflect.set(t, key, value);
      const realmGlobal = sameOrigin() ? targetGlobal() : null;
      return realmGlobal
        ? Reflect.set(realmGlobal, key, value, realmGlobal)
        : Reflect.set(t, key, value);
    },
    has(t, key) {
      if (key === "globalThis") return sameOrigin();
      if (key === "constructor") {
        if (!sameOrigin()) return false;
        const realmGlobal = targetGlobal();
        return realmGlobal ? Reflect.has(realmGlobal, "constructor") : true;
      }
      if (Reflect.has(t, key)) return true;
      if (typeof key === "string" && !sameOrigin()) return false;
      const realmGlobal = targetGlobal();
      return !!realmGlobal && Reflect.has(realmGlobal, key);
    },
    ownKeys(t) {
      const keys = Reflect.ownKeys(t);
      if (!sameOrigin()) return keys;
      const realmGlobal = targetGlobal();
      if (!realmGlobal) return keys;
      const seen = new Set(keys);
      for (const key of _frameRealmOwnKeys(realmGlobal)) {
        if (key === "constructor") continue;
        if (!seen.has(key)) keys.push(key);
      }
      return _orderedWindowNames(keys);
    },
    getOwnPropertyDescriptor(t, key) {
      const own = Reflect.getOwnPropertyDescriptor(t, key);
      if (own) return own;
      if (typeof key === "string" && !sameOrigin()) return undefined;
      if (key === "constructor") return undefined;
      if (key === "globalThis") {
        return { value: ref, writable: true, enumerable: false, configurable: true };
      }
      const realmGlobal = targetGlobal();
      const descriptor = realmGlobal
        ? _frameRealmOwnDescriptor(realmGlobal, key) : undefined;
      if (!descriptor) return undefined;
      descriptor.configurable = true;
      return descriptor;
    },
  });
  _ancestorWindowRefs.set(cacheKey, ref);
  return ref;
}

