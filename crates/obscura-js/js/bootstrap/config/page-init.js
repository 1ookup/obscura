globalThis.__obscura_init = function() {
  // First: the document URL is known now, and the gating below removes APIs
  // that later init steps would otherwise hand out on an insecure origin.
  try { _applySecureContextGating?.(); } catch (_e) {}
  _fpSeed = Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0);
  _fpCache = null;
  // A real navigation just completed (this runs after set_url), so drop any
  // URL a location setter previewed synchronously and let document_url drive
  // location.href again, including any redirect target.
  globalThis.__virtualUrl = null;
  _installWasmStreamingFallback();
  _installDocumentAll();
  // Browser objects stay on the ordinary shim path. Native property tracing is
  // provided by the pinned V8 IC/runtime hooks.

  // Frame wrappers belong to the replaced document; the Rust loader creates
  // fresh content roots for the new page.
  _scopedDocs.clear();
  _frameWindowProxies.clear();
  _iframeContentDocsSeen = false;

  const documentNid = +_dom("document_node_id");
  // Frame realm hook (Phase 3.7): the Rust realm host defines this nid on a
  // fresh frame context before bootstrap runs, so this realm's `document`
  // binds to its iframe content root through _ScopedDocument (scoped op_dom
  // queries). The main context never defines the flag and is unaffected.
  const frameRootNid = globalThis.__obscura_frame_document_nid;
  if (typeof frameRootNid === "number" && frameRootNid > 0) {
    // _scopedDocumentFor caches the wrapper in _cache as the canonical
    // Document object for the content root.
    globalThis.document = _scopedDocumentFor(frameRootNid);
    globalThis.document[_defaultViewProxySym] = globalThis;
    // Ancestor window wiring (Phase 4): `parent` addresses the direct parent
    // document's realm, `top` the main Window; frameElement follows the
    // same-origin-with-parent rule (a cross-origin container reads null).
    const container = _domParse("frame_container_info", frameRootNid) || {};
    const parentRoot =
      typeof container.parentRoot === "number" && container.parentRoot > 0
        ? container.parentRoot : 0;
    const topRef = _ancestorWindowRef(frameRootNid, 0, true);
    globalThis.top = topRef;
    globalThis.parent =
      parentRoot > 0 ? _ancestorWindowRef(frameRootNid, parentRoot, false) : topRef;
    globalThis.frameElement = null;
    try {
      if (typeof container.host === "number" && container.host > 0
          && _dom("iframe_scopes_same_origin", frameRootNid, parentRoot) === "true") {
        globalThis.frameElement = _wrapEl(container.host);
      }
    } catch (e) {}
  } else {
    globalThis.document = new Document(documentNid);
    // parentNode on <html> reaches the backing document node. Keep that wrapper
    // canonical so getRootNode(), isConnected, and identity comparisons return
    // the same Document object exposed as globalThis.document.
    _cache.set(documentNid, globalThis.document);
  }
  // `location` is [LegacyUnforgeable] on a live Document: Chrome exposes it
  // as an enumerable, non-configurable own accessor. Install it after the
  // realm chooses its document so the closure points at that realm's Window,
  // including frame documents created by the shared-isolate host.
  try {
    if (!Object.prototype.hasOwnProperty.call(globalThis.document, 'location')) {
      Object.defineProperty(globalThis.document, 'location', {
        get() { return globalThis.location; },
        set(value) { _navigateCurrentContext(_resolveUrl(String(value)), 'GET', ''); },
        enumerable: true,
        configurable: false,
      });
    }
  } catch (_error) {}
  try {
    const registryState = _customElementRegistryData(globalThis.customElements);
    registryState.roots.clear();
    registryState.roots.add(globalThis.document);
  } catch (_e) {}
  try { _applyCrossOriginIsolation?.(frameRootNid || 0); } catch (_e) {}
  if (frameRootNid > 0 && _crossOriginIsolatedValue
      && !Object.getOwnPropertyDescriptor(Navigator.prototype, 'cpuPerformance')) {
    const getter = _markNativeAs(function cpuPerformance() {
      const cores = Number(_fingerprint().hardwareConcurrency) || 8;
      return Math.max(1, Math.min(4, Math.round(cores / 3)));
    }, 'function get cpuPerformance() { [native code] }');
    try { Object.defineProperty(getter, 'name', { value: 'get cpuPerformance', configurable: true }); } catch (_e) {}
    Object.defineProperty(Navigator.prototype, 'cpuPerformance', {
      get: getter,
      enumerable: true,
      configurable: true,
    });
  }
  // Keep string-code generation enabled unless this document explicitly has
  // a script-src/default-src without 'unsafe-eval'. The flag is consumed by
  // V8's isolate callback, so the intrinsic eval binding retains direct-eval
  // semantics in every frame realm.
  try {
    const scopeInfo = _domParse('document_scope_info', frameRootNid || 0) || {};
    const header = String(scopeInfo.csp || '');
    let scriptSources = null;
    let defaultSources = null;
    for (const directive of header.split(';')) {
      const tokens = directive.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const name = tokens.shift().toLowerCase();
      if (name === 'script-src' && scriptSources === null) scriptSources = tokens;
      if (name === 'default-src' && defaultSources === null) defaultSources = tokens;
    }
    const sources = scriptSources || defaultSources;
    globalThis.__obscura_csp_allows_unsafe_eval =
      !sources || sources.some(token => token.toLowerCase() === "'unsafe-eval'");
  } catch (_e) {
    globalThis.__obscura_csp_allows_unsafe_eval = true;
  }
  const previousWindowNames = new Set(_windowNamedPropertyNames);
  _registerWindowNamedTree(globalThis.document.documentElement);
  _reconcileWindowNamedProperties(previousWindowNames);

  const fingerprintScreen = _fingerprint().screen || {};
  const sw = Number.isFinite(globalThis.__obscura_screen_w) && globalThis.__obscura_screen_w > 0
    ? globalThis.__obscura_screen_w : (Number(fingerprintScreen.width) || 1920);
  const sh = Number.isFinite(globalThis.__obscura_screen_h) && globalThis.__obscura_screen_h > 0
    ? globalThis.__obscura_screen_h : (Number(fingerprintScreen.height) || 1080);
  // The OS screen and the page viewport are different browser concepts.
  // Keep the fingerprinted screen, but let the embedding browser provide the
  // actual CSS viewport so responsive JavaScript, layout, and screenshots all
  // observe the same dimensions.
  const vw = Number.isFinite(globalThis.__obscura_viewport_w) && globalThis.__obscura_viewport_w > 0
    ? globalThis.__obscura_viewport_w : sw;
  const vh = Number.isFinite(globalThis.__obscura_viewport_h) && globalThis.__obscura_viewport_h > 0
    ? globalThis.__obscura_viewport_h : sh - 80;
  const hasScreenOverride = Number.isFinite(globalThis.__obscura_screen_w)
    && globalThis.__obscura_screen_w > 0;
  _applyScreenSize(
    sw,
    sh,
    !!globalThis.__obscura_screen_emulated,
    hasScreenOverride ? undefined : Number(fingerprintScreen.availWidth),
    hasScreenOverride ? undefined : Number(fingerprintScreen.availHeight),
    hasScreenOverride ? undefined : Number(fingerprintScreen.availTop),
    hasScreenOverride ? undefined : Number(fingerprintScreen.availLeft),
  );
  globalThis.visualViewport = _bootstrapObject('visualViewport', () => ({ width:vw, height:vh, offsetLeft:0, offsetTop:0, scale:1, [Symbol.toStringTag]: 'VisualViewport', addEventListener(){}, removeEventListener(){} }));
  // Screen dimensions do not determine the output device scale. The embedding
  // browser applies an explicit device metric after page initialization; the
  // standalone runtime has the same 1x default as Obscura's render surface.
  const fingerprintScale = Number(fingerprintScreen.deviceScaleFactor);
  globalThis.devicePixelRatio = Number.isFinite(fingerprintScale) && fingerprintScale > 0
    ? fingerprintScale : 1;
  globalThis.innerWidth = vw; globalThis.innerHeight = vh;
  // A frame realm's viewport is its iframe content box, not the OS screen the
  // above fallback derives. `__obscura_viewport_w/h` are only ever set for the
  // top-level document, so without this a widget inside an iframe read the
  // screen size (2560x1360) as its own innerWidth, where a browser reports the
  // frame's 300x65. Resolve the frame's document-level metrics and overwrite.
  if (_callingFrameRoot()) {
    try {
      const frameRoot = String(_callingFrameRoot());
      let frameMetricsEpoch = null;
      let frameMetricsCache = null;
      const readFrameMetrics = function() {
        // Host mutations happen in the parent realm, so the child's local DOM
        // epoch cannot invalidate this cache. Use a shared native epoch to
        // keep consecutive inner/visualViewport reads to one frame layout.
        const epoch = Deno.core.ops.op_layout_metrics_epoch
          ? Deno.core.ops.op_layout_metrics_epoch() : null;
        if (frameMetricsCache && frameMetricsEpoch === epoch) {
          return frameMetricsCache;
        }
        const raw = Deno.core.ops.op_layout_metrics
          && Deno.core.ops.op_layout_metrics(frameRoot);
        if (!raw) return null;
        frameMetricsCache = JSON.parse(raw);
        frameMetricsEpoch = epoch;
        return frameMetricsCache;
      };
      const readFrameMetric = function(name, fallback) {
        try {
          const metrics = readFrameMetrics();
          if (metrics) {
            // An unrendered frame (display:none, 0x0, no layout yet) reports
            // zero, exactly as Chrome does -- never the screen fallback.
            if (metrics.rendered === false) return 0;
            const value = metrics[name];
            if (Number.isFinite(value) && value >= 0) return value;
          }
        } catch (_e) {}
        return fallback;
      };
      const parsed = readFrameMetrics();
      if (parsed) {
        const zeroViewport = parsed.rendered === false;
        if (zeroViewport || (Number.isFinite(parsed.clientWidth) && parsed.clientWidth >= 0)) {
          globalThis.innerWidth = zeroViewport ? 0 : parsed.clientWidth;
          globalThis.innerHeight = zeroViewport ? 0 : parsed.clientHeight;
          if (globalThis.visualViewport) {
            globalThis.visualViewport.width = globalThis.innerWidth;
            globalThis.visualViewport.height = globalThis.innerHeight;
          }
        }
      }
      // A frame viewport can change without recreating its realm (responsive
      // iframe CSS, display toggles, animation, or an embedder resize). Keep
      // these Window surfaces live instead of freezing their initialization
      // values. The fallbacks preserve the last usable value if layout is
      // temporarily unavailable during navigation.
      let frameWidthFallback = globalThis.innerWidth;
      let frameHeightFallback = globalThis.innerHeight;
      Object.defineProperty(globalThis, 'innerWidth', {
        configurable: true,
        enumerable: true,
        get() {
          return frameWidthFallback = readFrameMetric('clientWidth', frameWidthFallback);
        },
      });
      Object.defineProperty(globalThis, 'innerHeight', {
        configurable: true,
        enumerable: true,
        get() {
          return frameHeightFallback = readFrameMetric('clientHeight', frameHeightFallback);
        },
      });
      if (globalThis.visualViewport) {
        Object.defineProperty(globalThis.visualViewport, 'width', {
          configurable: true,
          enumerable: true,
          get() { return globalThis.innerWidth; },
        });
        Object.defineProperty(globalThis.visualViewport, 'height', {
          configurable: true,
          enumerable: true,
          get() { return globalThis.innerHeight; },
        });
      }
    } catch (_e) {}
  }
  // Window-level geometry every frame shares with its top window. The claim
  // is a maximized window: outer bounds fill the working area, the window
  // origin sits at the working area's top-left. Deterministic from the screen
  // fingerprint, and plausible next to any screen a profile claims.
  const availW = hasScreenOverride ? sw
    : (Number.isFinite(Number(fingerprintScreen.availWidth)) && Number(fingerprintScreen.availWidth) > 0
      ? Number(fingerprintScreen.availWidth) : sw);
  const availH = hasScreenOverride ? sh
    : (Number.isFinite(Number(fingerprintScreen.availHeight)) && Number(fingerprintScreen.availHeight) > 0
      ? Number(fingerprintScreen.availHeight) : sh);
  const windowTop = Math.max(0, sh - availH);
  // A host can provide real window metrics through ScreenFingerprint. Zero
  // keeps the historical maximized-window fallback used by embedders that do
  // not expose native window placement.
  const configuredOuterW = Number(fingerprintScreen.outerWidth);
  const configuredOuterH = Number(fingerprintScreen.outerHeight);
  const configuredScreenX = Number(fingerprintScreen.screenX);
  const configuredScreenY = Number(fingerprintScreen.screenY);
  // Viewport emulation changes the CSS/screen size, but it does not erase the
  // host window placement supplied by the fingerprint. Keep location and outer
  // bounds independent so CDP viewport overrides do not turn a real window
  // into the historical all-zero geometry.
  globalThis.outerWidth = configuredOuterW > 0 ? configuredOuterW : availW;
  globalThis.outerHeight = configuredOuterH > 0 ? configuredOuterH : availH;
  globalThis.screenX = Number.isFinite(configuredScreenX) ? configuredScreenX : 0;
  globalThis.screenY = Number.isFinite(configuredScreenY) ? configuredScreenY : windowTop;
  globalThis.screenLeft = globalThis.screenX;
  globalThis.screenTop = globalThis.screenY;

  // The time origin is when navigation started, so it is always in the past.
  // Jittering it forward put `performance.timeOrigin` after `Date.now()`,
  // which no browser does and which makes every elapsed-time computation on
  // the page come out negative.
  const configuredTimeOrigin = Number(globalThis.__obscura_performance_time_origin_ms);
  const t0 = Number.isFinite(configuredTimeOrigin) && configuredTimeOrigin > 0
    ? configuredTimeOrigin : Date.now();
  globalThis.performance.timeOrigin = t0;
  globalThis.__obscura_rebasePerformanceOrigin?.(t0);
  globalThis.performance.timing = { navigationStart: t0, domContentLoadedEventEnd: t0, loadEventEnd: t0 };
  globalThis.performance.timing = _identityObject(
    'performance.timing', globalThis.performance.timing);
  if (globalThis.performance.navigation) {
    globalThis.performance.navigation = _identityObject(
      'performance.navigation', globalThis.performance.navigation);
  }
  // The startup snapshot was created before runtime ops existed, so its
  // browser objects started as ordinary JS objects. Rebind the same objects
  // to native ObjectTemplate carriers now that trace mode is active, copying
  // descriptors and prototypes without changing their public surface.
  try {
    const nav = globalThis.navigator;
    const navProto = nav && Object.getPrototypeOf(nav);
    for (const childName of [
      'userAgentData', 'mediaDevices', 'clipboard', 'permissions',
      'geolocation', 'storage',
    ]) {
      if (nav && nav[childName] && typeof nav[childName] === 'object') {
        const source = nav[childName];
        const adopted = _identityObject(
          'navigator.' + childName, source);
        if (adopted !== source) {
          const holder = navProto && Object.getOwnPropertyDescriptor(navProto, childName)
            ? navProto : nav;
          const descriptor = Object.getOwnPropertyDescriptor(holder, childName);
          if (descriptor && descriptor.get) {
            Object.defineProperty(holder, childName, {
              get() { return adopted; },
              set: descriptor.set,
              enumerable: descriptor.enumerable,
              configurable: descriptor.configurable,
            });
          } else {
            Object.defineProperty(holder, childName, {
              value: adopted,
              writable: descriptor?.writable !== false,
              enumerable: descriptor?.enumerable !== false,
              configurable: descriptor?.configurable !== false,
            });
          }
        }
      }
    }
    globalThis.navigator = _identityObject('navigator', nav);
    globalThis.console = _identityObject('console', globalThis.console);
    globalThis.visualViewport = _identityObject(
      'visualViewport', globalThis.visualViewport);
    globalThis.__obscura_seed_visibility_entry?.();
    // The remaining BOM surfaces are initialized by the startup snapshot
    // before runtime ops exist, so adopt them after page state is available.
    // `location` is backed by the private _locationObj binding rather than a
    // writable global property; update that binding to preserve
    // `window.location` identity and navigation setters.
    const locationSource = globalThis.location;
    const locationNative = _identityObject('location', locationSource);
    if (locationNative && locationNative !== locationSource) _locationObj = locationNative;
    for (const name of [
      'screen', 'history', 'performance', 'crypto',
      'localStorage', 'sessionStorage', 'caches',
    ]) {
      const source = globalThis[name];
      const adopted = _identityObject(name, source);
      if (adopted && adopted !== source) {
        try { globalThis[name] = adopted; } catch (_error) {}
      }
    }
  } catch (_error) {}
  var _totalHeap = 15000000 + Math.floor(_fpRand(620) * 85000000);
  _memoryInfoBacking.jsHeapSizeLimit = 4395630592;
  _memoryInfoBacking.totalJSHeapSize = _totalHeap;
  _memoryInfoBacking.usedJSHeapSize = Math.floor(
    _totalHeap * (0.3 + _fpRand(621) * 0.5));
  // Navigator, UA-CH, screen and request headers share the Rust-derived
  // fingerprint contract installed before page initialization.

  // Hide internals (_*, obscura, Obscura). The set of keys is static at
  // snapshot-build time, so we precompute it ONCE below (after this
  // function definition) and reuse it on every page init. Was an
  // Object.keys + filter on every navigation, ~5-40ms per page on
  // SPAs that load 1000+ globals.
  const toHide = globalThis.__obscura_hide_list || [];
  for (let i = 0; i < toHide.length; i++) {
    try { Object.defineProperty(globalThis, toHide[i], { enumerable: false }); } catch(e) {}
  }
  // Re-taken per page, before any page script runs. The snapshot-time capture
  // at the bottom of this file misses the globals V8 installs per isolate
  // rather than into the snapshot (Temporal, Float16Array, WebAssembly and the
  // explicit-resource-management set), which then read as page additions.
  // Indices are excluded on purpose: they are this window's child frames, and
  // a fresh frame has none.
  try {
    _extendChromeWindowFunctionOrder();
    if (typeof globalThis.__obscura_install_platform_surfaces === 'function') {
      globalThis.__obscura_install_platform_surfaces(globalThis);
    } else {
      _normalizeWindowObjectEnumerability(globalThis);
      _flattenNavigatorPrototypeSurface();
      if (globalThis.navigator) {
        _alignPropertiesOrder(Object.getPrototypeOf(globalThis.navigator), _chromeNavigatorKeyOrder);
      }
      if (globalThis.Document?.prototype) {
        _alignPropertiesOrder(globalThis.Document.prototype, _chromeDocumentKeyOrder);
      }
      if (globalThis.Screen?.prototype) {
        _alignPropertiesOrder(globalThis.Screen.prototype, _chromeScreenKeyOrder);
      }
      if (globalThis.ScreenOrientation?.prototype) {
        _alignPropertiesOrder(
          globalThis.ScreenOrientation.prototype,
          _chromeScreenOrientationKeyOrder,
        );
      }
      if (globalThis.Node?.prototype) {
        _alignPropertiesOrder(globalThis.Node.prototype, _chromeNodeKeyOrder);
      }
    }
  } catch (e) {}
  _pristineGlobalNames = new Set(_orderedWindowNames(
    Object.getOwnPropertyNames(globalThis).filter(name => !/^\d+$/.test(name))));
  // Iframes the parser produced never run the insertion steps, so this is the
  // only place the initial window[i] set gets built. It runs last: the
  // document nid this realm binds to is set further up in this function.
  try { _syncWindowFrameIndices(); } catch(e) {}
  // Each iframe realm is initialized after the snapshot has been restored.
  // Reapply the canonical Window order here so its real global object (the
  // object challenge code enumerates) matches the snapshot and WindowProxy.
  try {
    if (typeof globalThis.__obscura_install_window_surface === 'function') {
      globalThis.__obscura_install_window_surface(globalThis, _chromeWindowKeyOrder);
    } else {
      _alignPropertiesOrder(globalThis, _chromeWindowKeyOrder);
    }
  } catch(e) {}
  delete globalThis.__obscura_init;
};

// Snapshot-time pre-computation of the hide list. Bootstrap.js runs once
// during the V8 snapshot build (build.rs); this line captures the set of
// globals defined by bootstrap that we want to hide and stashes them
// for __obscura_init to consume on every subsequent page. The snapshot
// preserves the array as a regular global.
// Use getOwnPropertyNames, not Object.keys: the internal globals declared by
// _preHideInternals are already non-enumerable, so Object.keys would omit them
// and leave them out of the hide list (and thus visible to the reflection-API
// filter and to fingerprinting scripts). getOwnPropertyNames captures them.
globalThis.__obscura_hide_list = Object.getOwnPropertyNames(globalThis).filter(k =>
  k.startsWith('_') || k.includes('obscura') || k.includes('Obscura')
  // deno_core's binding object. It matches none of the patterns above and was
  // therefore the one internal name left in Object.getOwnPropertyNames(window)
  // -- a global no browser has, sitting in plain sight next to the ones this
  // list was written to remove. It stays reachable by name for the ~119 call
  // sites and the Rust-injected snippets that use it; only the enumeration
  // hides it.
  || k === 'Deno'
);
// The four frame-realm identity globals are set by Rust (realm.rs / ops.rs) on
// a fresh frame context *before* its bootstrap runs, so they never exist on the
// main global and the pattern above misses them. The main realm's reflection
// filter (see _hideInternalsFromReflection) reads this list when a probe
// enumerates the frame global across realms, so append them explicitly rather
// than let a frame's own identity leak through Object.getOwnPropertyNames.
for (const _frameFlag of ['__obscura_frame_document_nid', '__obscura_frame_base_url',
    '__obscura_frame_id', '__obscura_frame_generation']) {
  globalThis.__obscura_hide_list.push(_frameFlag);
}

/* ===== WPT conformance shims: batch 2 ===== */

// ---- Node namespace lookup methods ----

Node.prototype.lookupNamespaceURI = function(prefix) {
  let node = this;
  if (node.nodeType === 9) node = node.documentElement;
  if (!node || node.nodeType !== 1) return null;
  const _ns_builtins = { 'xml': 'http://www.w3.org/XML/1998/namespace', 'xmlns': 'http://www.w3.org/2000/xmlns/' };
  if (prefix && _ns_builtins[prefix]) return _ns_builtins[prefix];
  while (node && node.nodeType === 1) {
    if (prefix) {
      if (node.prefix === prefix && node.namespaceURI) return node.namespaceURI;
      const nsAttr = node.getAttribute('xmlns:' + prefix);
      if (nsAttr !== null) return nsAttr || null;
    } else {
      const defaultNs = node.getAttribute('xmlns');
      if (defaultNs !== null) return defaultNs || null;
      if (node.prefix === null && node.namespaceURI) return node.namespaceURI;
    }
    node = node.parentElement;
  }
  return null;
};
_markNative(Node.prototype.lookupNamespaceURI);

Node.prototype.lookupPrefix = function(namespace) {
  namespace = namespace || null;
  let node = this;
  if (node.nodeType === 9) node = node.documentElement;
  if (!node || node.nodeType !== 1) return null;
  const _ns_builtins = { 'http://www.w3.org/XML/1998/namespace': 'xml', 'http://www.w3.org/2000/xmlns/': 'xmlns' };
  if (_ns_builtins[namespace]) return _ns_builtins[namespace];
  while (node && node.nodeType === 1) {
    if (node.namespaceURI === namespace) {
      const p = node.prefix;
      if (p) return p;
    }
    const attrs = node.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const attrName = attr.name || attr.nodeName || '';
      const attrValue = attr.value || attr.nodeValue || '';
      if (attrName === 'xmlns' && attrValue === namespace) return '';
      if (attrName.startsWith('xmlns:')) {
        const prefix = attrName.substring(6);
        if (attrValue === namespace) return prefix;
      }
    }
    node = node.parentElement;
  }
  return null;
};
_markNative(Node.prototype.lookupPrefix);

Node.prototype.isDefaultNamespace = function(namespace) {
  return this.lookupNamespaceURI(null) === (namespace || null);
};
_markNative(Node.prototype.isDefaultNamespace);


// ---- getElementsByTagNameNS on Element and Document ----
// getElementsByTagNameNS on Element and Document
if (!Element.prototype.getElementsByTagNameNS) {
  Element.prototype.getElementsByTagNameNS = function(namespaceURI, localName) {
    const all = this.querySelectorAll('*');
    const filtered = [];
    const nsMatch = namespaceURI === '*';
    const tagMatch = localName === '*';
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (!el) continue;
      const elNs = el.namespaceURI;
      const elTag = el.localName;
      const nsOk = nsMatch || (elNs === (namespaceURI || null));
      const tagOk = tagMatch || (elTag === localName);
      if (nsOk && tagOk) filtered.push(el);
    }
    const result = new HTMLCollection(...filtered);
    result.item = (i) => result[i] != null ? result[i] : null;
    return result;
  };
  _markNative(Element.prototype.getElementsByTagNameNS);
}
if (!Document.prototype.getElementsByTagNameNS) {
  Document.prototype.getElementsByTagNameNS = function(namespaceURI, localName) {
    const all = this.querySelectorAll('*');
    const filtered = [];
    const nsMatch = namespaceURI === '*';
    const tagMatch = localName === '*';
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (!el) continue;
      const elNs = el.namespaceURI;
      const elTag = el.localName;
      const nsOk = nsMatch || (elNs === (namespaceURI || null));
      const tagOk = tagMatch || (elTag === localName);
      if (nsOk && tagOk) filtered.push(el);
    }
    const result = new HTMLCollection(...filtered);
    result.item = (i) => result[i] != null ? result[i] : null;
    return result;
  };
  _markNative(Document.prototype.getElementsByTagNameNS);
}

// ---- Attr nodes and createAttribute ----
// Attr class: represents attribute nodes (nodeType 2)
if (!globalThis.Attr) {
  globalThis.Attr = class Attr {
    constructor(name, value = '', namespaceURI = null, prefix = null) {
      this.name = name;
      this.localName = name;
      this.value = value;
      this.namespaceURI = namespaceURI;
      this.prefix = prefix;
      this.ownerElement = null;
      this.specified = true;
    }
    get nodeName() { return this.name; }
    get nodeValue() { return this.value; }
    set nodeValue(v) { this.value = v; }
    get nodeType() { return 2; }
  };
}

// XML Name validation helper for attribute/processing instruction names
const _ns_isValidXmlName = (name) => {
  if (typeof name !== 'string' || !name.length) return false;
  return /^[A-Za-z_:][\w.\-:]*$/.test(name);
};

const _ns_validateQualifiedName = (namespaceURI, qualifiedName) => {
  const parts = qualifiedName.split(':');
  if (parts.length > 2 || parts.some((part) => !_ns_isValidXmlName(part))) {
    throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
  }
  const prefix = parts.length === 2 ? parts[0] : null;
  const XML = 'http://www.w3.org/XML/1998/namespace';
  const XMLNS = 'http://www.w3.org/2000/xmlns/';
  if ((prefix && !namespaceURI)
      || (prefix === 'xml' && namespaceURI !== XML)
      || ((qualifiedName === 'xmlns' || prefix === 'xmlns') && namespaceURI !== XMLNS)
      || (namespaceURI === XMLNS && qualifiedName !== 'xmlns' && prefix !== 'xmlns')) {
    throw new DOMException('The namespace is invalid', 'NamespaceError');
  }
};

// Document.prototype.createAttribute: create a detached Attr node
if (!Document.prototype.createAttribute) {
  Document.prototype.createAttribute = function(localName) {
    const name = String(localName || '');
    if (!_ns_isValidXmlName(name)) {
      throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
    }
    return new Attr(name, '', null, null);
  };
  _markNative(Document.prototype.createAttribute);
}

// Document.prototype.createAttributeNS: create a namespaced Attr node
if (!Document.prototype.createAttributeNS) {
  Document.prototype.createAttributeNS = function(namespaceURI, qualifiedName) {
    const ns = namespaceURI ? String(namespaceURI) : null;
    const qn = String(qualifiedName || '');
    if (!qn.length) {
      throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
    }
    let prefix = null;
    let localName = qn;
    const colonIdx = qn.indexOf(':');
    if (colonIdx !== -1) {
      prefix = qn.substring(0, colonIdx);
      localName = qn.substring(colonIdx + 1);
      if (!_ns_isValidXmlName(prefix) || !_ns_isValidXmlName(localName)) {
        throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
      }
    } else {
      if (!_ns_isValidXmlName(localName)) {
        throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
      }
    }
    return new Attr(qn, '', ns, prefix);
  };
  _markNative(Document.prototype.createAttributeNS);
}

// Element.prototype.getAttributeNode: return an Attr node or null
if (!Element.prototype.getAttributeNode) {
  Element.prototype.getAttributeNode = function(name) {
    const val = this.getAttribute(name);
    if (val === null) return null;
    const attr = new Attr(name, val, null, null);
    attr.ownerElement = this;
    return attr;
  };
  _markNative(Element.prototype.getAttributeNode);
}

// Element.prototype.getAttributeNodeNS: return a namespaced Attr node or null
if (!Element.prototype.getAttributeNodeNS) {
  Element.prototype.getAttributeNodeNS = function(namespaceURI, localName) {
    const val = this.getAttributeNS(namespaceURI, localName);
    if (val === null) return null;
    const name = String(localName || '');
    const attr = new Attr(name, val, namespaceURI ? String(namespaceURI) : null, null);
    attr.ownerElement = this;
    return attr;
  };
  _markNative(Element.prototype.getAttributeNodeNS);
}

// Element.prototype.setAttributeNode: set an Attr and return the previous one
if (!Element.prototype.setAttributeNode) {
  Element.prototype.setAttributeNode = function(attr) {
    if (!attr || typeof attr.name !== 'string') return null;
    const prevVal = this.getAttribute(attr.name);
    const prevAttr = prevVal !== null ? new Attr(attr.name, prevVal, null, null) : null;
    if (prevAttr) prevAttr.ownerElement = this;
    this.setAttribute(attr.name, attr.value);
    attr.ownerElement = this;
    return prevAttr;
  };
  _markNative(Element.prototype.setAttributeNode);
}

// Element.prototype.setAttributeNodeNS: set a namespaced Attr and return the previous one
if (!Element.prototype.setAttributeNodeNS) {
  Element.prototype.setAttributeNodeNS = function(attr) {
    if (!attr || typeof attr.name !== 'string') return null;
    const prevVal = this.getAttribute(attr.name);
    const prevAttr = prevVal !== null 
      ? new Attr(attr.name, prevVal, attr.namespaceURI || null, attr.prefix || null) 
      : null;
    if (prevAttr) prevAttr.ownerElement = this;
    this.setAttributeNS(attr.namespaceURI || null, attr.name, attr.value);
    attr.ownerElement = this;
    return prevAttr;
  };
  _markNative(Element.prototype.setAttributeNodeNS);
}

// Element.prototype.removeAttributeNode: remove and return an Attr
if (!Element.prototype.removeAttributeNode) {
  Element.prototype.removeAttributeNode = function(attr) {
    if (!attr || typeof attr.name !== 'string') return attr;
    const val = this.getAttribute(attr.name);
    if (val !== null) {
      this.removeAttribute(attr.name);
    }
    return attr;
  };
  _markNative(Element.prototype.removeAttributeNode);
}


// ---- form control validity and text selection ----

// ValidityState class for form validation state reporting
if (typeof ValidityState === 'undefined') {
  globalThis.ValidityState = class ValidityState {
    constructor() {
      this.badInput = false;
      this.customError = false;
      this.patternMismatch = false;
      this.rangeOverflow = false;
      this.rangeUnderflow = false;
      this.stepMismatch = false;
      this.tooLong = false;
      this.tooShort = false;
      this.typeMismatch = false;
      this.valueMissing = false;
      this.valid = true;
    }
  };
}

// Validity and validation message storage on elements
const _ns_validityCache = new WeakMap();
const _ns_customValidityMsg = new WeakMap();

// Element.prototype.validity - returns cached ValidityState for the element
if (!Element.prototype.validity) {
  Object.defineProperty(Element.prototype, 'validity', {
    get: function() {
      if (!_ns_validityCache.has(this)) {
        _ns_validityCache.set(this, new ValidityState());
      }
      return _ns_validityCache.get(this);
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.willValidate - whether element is subject to constraint validation
if (!Element.prototype.willValidate) {
  Object.defineProperty(Element.prototype, 'willValidate', {
    get: function() {
      return true;
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.validationMessage - custom validation message if set
if (!Element.prototype.validationMessage) {
  Object.defineProperty(Element.prototype, 'validationMessage', {
    get: function() {
      return _ns_customValidityMsg.get(this) || '';
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.checkValidity - stub returns true
if (!Element.prototype.checkValidity) {
  Element.prototype.checkValidity = function checkValidity() {
    return true;
  };
  _markNative(Element.prototype.checkValidity);
}

// Element.prototype.reportValidity - stub returns true
if (!Element.prototype.reportValidity) {
  Element.prototype.reportValidity = function reportValidity() {
    return true;
  };
  _markNative(Element.prototype.reportValidity);
}

// Element.prototype.setCustomValidity - set custom validation message
if (!Element.prototype.setCustomValidity) {
  Element.prototype.setCustomValidity = function setCustomValidity(msg) {
    const validity = this.validity;
    if (msg && msg.length > 0) {
      _ns_customValidityMsg.set(this, msg);
      validity.customError = true;
      validity.valid = false;
    } else {
      _ns_customValidityMsg.delete(this);
      validity.customError = false;
      validity.valid = true;
    }
  };
  _markNative(Element.prototype.setCustomValidity);
}

// Text selection on Element.prototype
const _ns_selectionStart = new WeakMap();
const _ns_selectionEnd = new WeakMap();
const _ns_selectionDir = new WeakMap();

// Element.prototype.selectionStart - get/set selection start position
if (!Element.prototype.selectionStart) {
  Object.defineProperty(Element.prototype, 'selectionStart', {
    get: function() {
      return _ns_selectionStart.get(this) ?? null;
    },
    set: function(v) {
      _ns_selectionStart.set(this, v == null ? null : Math.max(0, parseInt(v, 10) || 0));
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.selectionEnd - get/set selection end position
if (!Element.prototype.selectionEnd) {
  Object.defineProperty(Element.prototype, 'selectionEnd', {
    get: function() {
      return _ns_selectionEnd.get(this) ?? null;
    },
    set: function(v) {
      _ns_selectionEnd.set(this, v == null ? null : Math.max(0, parseInt(v, 10) || 0));
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.selectionDirection - get/set selection direction
if (!Element.prototype.selectionDirection) {
  Object.defineProperty(Element.prototype, 'selectionDirection', {
    get: function() {
      return _ns_selectionDir.get(this) ?? 'none';
    },
    set: function(v) {
      _ns_selectionDir.set(this, v === 'forward' || v === 'backward' ? v : 'none');
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.setSelectionRange - set text selection range
if (!Element.prototype.setSelectionRange) {
  Element.prototype.setSelectionRange = function setSelectionRange(start, end, direction) {
    start = Math.max(0, parseInt(start, 10) || 0);
    end = Math.max(0, parseInt(end, 10) || 0);
    direction = direction === 'forward' || direction === 'backward' ? direction : 'none';
    _ns_selectionStart.set(this, start);
    _ns_selectionEnd.set(this, end);
    _ns_selectionDir.set(this, direction);
  };
  _markNative(Element.prototype.setSelectionRange);
}

// Element.prototype.setRangeText - replace selection with text
if (!Element.prototype.setRangeText) {
  Element.prototype.setRangeText = function setRangeText(replacement, start, end, selectMode) {
    const val = this.value;
    if (!val) return;
    const strVal = String(val);
    start = start === undefined ? (this.selectionStart ?? 0) : Math.max(0, parseInt(start, 10) || 0);
    end = end === undefined ? (this.selectionEnd ?? 0) : Math.max(0, parseInt(end, 10) || 0);
    const newValue = strVal.slice(0, start) + String(replacement) + strVal.slice(end);
    this.value = newValue;
    selectMode = selectMode || 'preserve';
    if (selectMode === 'select') {
      const replLen = String(replacement).length;
      _ns_selectionStart.set(this, start);
      _ns_selectionEnd.set(this, start + replLen);
      _ns_selectionDir.set(this, 'none');
    } else if (selectMode === 'start') {
      _ns_selectionStart.set(this, start);
      _ns_selectionEnd.set(this, start);
      _ns_selectionDir.set(this, 'none');
    } else if (selectMode === 'end') {
      const replLen = String(replacement).length;
      _ns_selectionStart.set(this, start + replLen);
      _ns_selectionEnd.set(this, start + replLen);
      _ns_selectionDir.set(this, 'none');
    }
  };
  _markNative(Element.prototype.setRangeText);
}

// Element.prototype.select - select all text in the element
if (!Element.prototype.select) {
  Element.prototype.select = function select() {
    const val = this.value;
    if (val === undefined || val === null) return;
    const len = String(val).length;
    _ns_selectionStart.set(this, 0);
    _ns_selectionEnd.set(this, len);
    _ns_selectionDir.set(this, 'none');
  };
  _markNative(Element.prototype.select);
}


// ---- Response.blob() on the real fetch path ----

if (typeof Response !== 'undefined' && Response.prototype && !Response.prototype.blob) {
  Response.prototype.blob = async function() {
    const bytes = await this.arrayBuffer();
    const contentType = this.headers && typeof this.headers.get === 'function' ? this.headers.get('content-type') : '';
    return new Blob([new Uint8Array(bytes)], { type: contentType || '' });
  };
  _markNative(Response.prototype.blob);
}
if (typeof Response !== 'undefined' && Response.prototype && !Response.prototype.text) {
  Response.prototype.text = async function() {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  };
  _markNative(Response.prototype.text);
}
if (typeof Response !== 'undefined' && Response.prototype && !Response.prototype.json) {
  Response.prototype.json = async function() {
    return JSON.parse(await this.text());
  };
  _markNative(Response.prototype.json);
}
// arrayBuffer is the body primitive that blob/text/json derive from; the
// engine's Response provides it natively, so it is intentionally not shimmed
// here (a JS fallback could only recurse into itself).

// WebIDL requires every interface prototype object to carry @@toStringTag with
// the interface identifier, as {writable:false, enumerable:false,
// configurable:true}, and the interface object's `.name` to be that same
// identifier. Obscura satisfied neither on ~35 interfaces, so
// `Object.prototype.toString.call(new MessageEvent('m'))` answered
// "[object Object]" where a browser answers "[object MessageEvent]" -- a check
// jQuery, lodash and every fingerprinting bundle makes, and one that no real
// engine can fail.
//
// The list is enumerated by hand rather than derived from "every capitalised
// global" on purpose: ECMAScript builtins must NOT carry a tag (Chrome's
// Date.prototype and RegExp.prototype have no own @@toStringTag), so a
// blanket sweep would trade one discrepancy for a fresh one. Legacy factory
// functions -- Image, Audio -- are omitted for the same reason: they are not
// interfaces, and in a browser they share HTMLImageElement's / HTMLAudio-
// Element's prototype rather than owning one to brand.
//
// Runs last so it sees every interface, including the ones the WPT conformance
// shims install above.
