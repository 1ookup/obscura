(function _markBuiltinsNative() {
  var seen = new Set();
  function walk(ctor) {
    if (typeof ctor !== 'function') { return; }
    _markNative(ctor);
    var proto = ctor.prototype;
    if (!proto || seen.has(proto)) { return; }
    seen.add(proto);
    var keys = Object.getOwnPropertyNames(proto);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var d;
      try { d = Object.getOwnPropertyDescriptor(proto, key); } catch (e) { continue; }
      if (!d) { continue; }
      if (typeof d.value === 'function') { _markNative(d.value); }
      if (typeof d.get === 'function') { _markNativeAs(d.get, 'function get ' + key + '() { [native code] }'); }
      if (typeof d.set === 'function') { _markNativeAs(d.set, 'function set ' + key + '() { [native code] }'); }
    }
  }
  var names = Object.getOwnPropertyNames(globalThis);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!/^[A-Z]/.test(name)) { continue; }
    var val;
    try { val = globalThis[name]; } catch (e) { continue; }
    if (typeof val === 'function') { walk(val); }
  }
})();

// Secure contexts. Runs last: it takes away APIs the rest of bootstrap has
// already installed, so anything registered after it would survive by accident.
(function _installSecureContext() {
  // https://w3c.github.io/webappsec-secure-contexts/. Loopback counts as
  // trustworthy even over plain HTTP, which is why a 127.0.0.1 fixture cannot
  // show what an insecure origin looks like -- the oracle for this had to be
  // captured over the host's LAN address.
  function _isPotentiallyTrustworthy(href) {
    try {
      const url = new URL(String(href));
      if (url.protocol === 'https:' || url.protocol === 'wss:'
        || url.protocol === 'file:') return true;
      // data: carries an opaque origin, and so does a sandboxed document.
      // Neither is a secure context in Chrome either.
      if (url.origin === 'null') return false;
      const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
      if (host === 'localhost' || host.endsWith('.localhost')) return true;
      if (host === '::1' || /^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(host)) return true;
      if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
      return false;
    } catch (_error) {
      return false;
    }
  }

  // The origin the engine resolved for a document root.
  function _scopeOrigin(root) {
    try {
      const info = _domParse('document_scope_info', Number(root) || 0);
      if (info && typeof info.origin === 'string') return info.origin;
    } catch (_error) {}
    return null;
  }

  // The origin of the document that created this one. about:blank and
  // about:srcdoc inherit the creator's origin, and Chrome keeps that
  // inheritance even when sandboxing forces the frame's own origin opaque: a
  // sandboxed srcdoc child of a loopback page is still a secure context, and
  // of an http LAN page is not. `frame_container_info` maps a frame's content
  // root to the document holding its <iframe>; parentRoot 0 is the top
  // document, which `document_scope_info` answers for as well.
  function _inheritedDocumentOrigin() {
    let root = 0;
    try { root = Number(_callingFrameRoot()) || 0; } catch (_error) { return null; }
    if (root <= 0) return null;
    try {
      const container = _domParse('frame_container_info', root);
      if (!container) return null;
      const parentRoot = Number(container.parentRoot);
      if (!Number.isFinite(parentRoot) || parentRoot < 0) return null;
      return _scopeOrigin(parentRoot);
    } catch (_error) {}
    return null;
  }

  // Evaluated on every read rather than captured once: bootstrap runs while the
  // document URL is still about:blank, and the real one arrives later.
  function _secureNow() {
    let href = '';
    try { href = globalThis.location?.href || ''; } catch (_error) { href = ''; }
    // No URL yet is the engine's own bootstrapping, not a page an insecure
    // origin can observe.
    if (href === '') return true;
    // A document with no origin of its own -- about:blank, about:srcdoc, a
    // blob: URL -- is exactly as trustworthy as the origin behind it and never
    // more: Chrome reports an about:blank or blob child of an insecure page as
    // an insecure context too, which `href === 'about:blank'` used to answer as
    // secure. The origin comes from the engine's document scope, not from the
    // URL text: a blob: URL carries whatever `location.origin` said when it was
    // minted, and `history.pushState` can rewrite that without a same-origin
    // check. A sandboxed document's own origin is opaque, so the creator's is
    // used instead -- which is the trust Chrome grants it.
    if (href === 'about:blank' || href === 'about:srcdoc' || href.startsWith('blob:')) {
      const own = _scopeOrigin(_callingFrameRoot());
      const origin = own !== null && own !== 'null' ? own : _inheritedDocumentOrigin();
      // A top-level about:blank has no creator to inherit from; that keeps the
      // previous answer, which is also Chrome's for a fresh tab.
      if (origin === null) return true;
      return origin !== 'null' && _isPotentiallyTrustworthy(origin);
    }
    return _isPotentiallyTrustworthy(href);
  }

  Object.defineProperty(globalThis, 'isSecureContext', {
    get: _markNativeAs(function isSecureContext() { return _secureNow(); },
      'function get isSecureContext() { [native code] }'),
    set: undefined,
    enumerable: true,
    configurable: true,
  });

  // The navigation layer derives this from COOP+COEP and Permissions-Policy.
  // Drive this getter and the SAB global from one per-document value.
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    get: _markNativeAs(function crossOriginIsolated() { return _crossOriginIsolatedValue; },
      'function get crossOriginIsolated() { [native code] }'),
    set: undefined,
    enumerable: true,
    configurable: true,
  });

  _applyCrossOriginIsolation = function (documentRoot) {
    let isolated = false;
    try {
      const info = _domParse('document_scope_info', documentRoot || 0) || {};
      isolated = _secureNow() && info.crossOriginIsolated === true;
    } catch (_error) {}
    _crossOriginIsolatedValue = isolated;
    if (isolated && typeof _SharedArrayBufferCtor !== 'function') {
      try {
        _SharedArrayBufferCtor = new WebAssembly.Memory(
          {initial: 1, maximum: 1, shared: true}).buffer.constructor;
      } catch (_error) {}
    }
    if (isolated && typeof _SharedArrayBufferCtor === 'function') {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', {
        value: _SharedArrayBufferCtor,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } else {
      try { delete globalThis.SharedArrayBuffer; } catch (_error) {}
    }
  };

  // Legacy Window accessors that remain observable even when their value is
  // absent. `event` reads undefined outside dispatch, while `origin` reads the
  // serialized environment origin; both keep a native no-op setter in Chrome.
  if (!('event' in globalThis)) {
    Object.defineProperty(globalThis, 'event', {
      get: _markNativeAs(function event() {
        return _legacyWindowEvent || (_legacyEventStickyEligible() ? _legacyStickyWindowEvent : undefined);
      },
        'function get event() { [native code] }'),
      set: _markNativeAs(function event(value) { _legacyWindowEvent = value; },
        'function set event() { [native code] }'),
      enumerable: true,
      configurable: true,
    });
  }

  // `origin` is a WindowOrWorkerGlobalScope attribute that Chrome exposes on
  // every global. An opaque origin reads "null".
  if (!('origin' in globalThis)) {
    const originSetter = _markNativeAs(function origin(value) {},
      'function set origin() { [native code] }');
    Object.defineProperty(globalThis, 'origin', {
      get: _markNativeAs(function origin() {
        try {
          // about:blank/srcdoc inherit their creator's origin, while their
          // location.origin remains "null". Sandboxed scopes stay opaque.
          const info = _domParse('document_scope_info', _callingFrameRoot());
          if (info && typeof info.origin === 'string') return info.origin;
          const value = globalThis.location?.origin;
          return value === undefined || value === '' ? 'null' : value;
        } catch (_error) { return 'null'; }
      }, 'function get origin() { [native code] }'),
      set: originSetter,
      enumerable: true,
      configurable: true,
    });
  }

  // Taking the APIs away is destructive and cannot be undone per read, so it
  // waits for __obscura_init, which runs once the document URL is known.
  _applySecureContextGating = function () {
    if (_secureNow()) return;

    // Deleting, not shadowing: Chrome leaves no trace of these on an insecure
    // origin, so `'caches' in globalThis` is false and not merely undefined.
    function _remove(target, name) {
      // Walks the whole chain: `navigator.serviceWorker` is an accessor on
      // Navigator.prototype rather than an own property, and the other gated
      // members sit at different depths.
      let object = target;
      while (object) {
        try {
          if (Object.prototype.hasOwnProperty.call(object, name)) {
            delete object[name];
            return;
          }
        } catch (_error) { /* non-configurable: leave it rather than throw */ }
        try { object = Object.getPrototypeOf(object); } catch (_error) { return; }
      }
    }

    for (const name of ['caches', 'CacheStorage', 'Cache']) _remove(globalThis, name);
    for (const name of [
      'serviceWorker', 'mediaDevices', 'storage', 'clipboard', 'wakeLock',
      'credentials', 'locks',
      // Secure-only hardware/device APIs from the interface surface install.
      // Keyboard deliberately stays: Chrome keeps it on insecure origins
      // too, and gpu stays for engine continuity (its shell predates this
      // table and callers rely on it in tests).
      'bluetooth', 'hid', 'serial', 'usb', 'xr', 'ink', 'login', 'managed',
      'protectedAudience', 'storageBuckets',
    ]) _remove(globalThis.navigator, name);
    for (const name of ['sharedStorage', 'documentPictureInPicture', 'launchQueue']) {
      _remove(globalThis, name);
    }
    _remove(globalThis.crypto, 'subtle');

    // `geolocation` and `Notification` deliberately stay. Chrome keeps both
    // interfaces on an insecure origin and refuses at call time instead, so
    // removing them would be a difference, not a fix -- checked against Chrome
    // 146 in js-repros/secure-context/chrome-oracle.json.
  };
})();

// WebIDL puts every interface member on the prototype as enumerable; an ES
// class puts them there as non-enumerable. That single difference is the
// whole reason `for (const key in document)` answered 13 names here against
// Chrome's 295, and 9 against 15 for `screen` -- a ratio no browser version
// gap explains, and one an environment probe reads in a three-line loop.
//
// The pass runs last so it covers every interface, whenever it was defined,
// and it only ever flips `enumerable`: a member that is absent stays absent.
// `constructor` is the documented exception -- WebIDL keeps it
// non-enumerable, as does ECMAScript.
(function _applyWebIdlEnumerability() {
  const skipOnPrototype = new Set(['constructor']);
  const seen = new Set();
  const promote = proto => {
    if (!proto || typeof proto !== 'object' || seen.has(proto)) return;
    seen.add(proto);
    let names;
    try { names = Object.getOwnPropertyNames(proto); } catch (_error) { return; }
    for (const key of names) {
      if (skipOnPrototype.has(key)) continue;
      // Engine helpers on an otherwise Web-facing prototype (`_scopeInfo` on
      // _ScopedDocument). Making those enumerable would put them in the page's
      // `for..in` over the object, which is the opposite of the point.
      if (key.startsWith('_')) continue;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(proto, key); }
      catch (_error) { continue; }
      if (!descriptor || descriptor.enumerable || !descriptor.configurable) continue;
      descriptor.enumerable = true;
      try { Object.defineProperty(proto, key, descriptor); } catch (_error) {}
    }
  };
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (_ecmaScriptGlobals.has(name)) continue;
    let value;
    // Reading a global can throw (cross-origin Location) and can have side
    // effects; neither is worth a member's enumerability.
    try { value = globalThis[name]; } catch (_error) { continue; }
    if (typeof value !== 'function') continue;
    let proto;
    try { proto = value.prototype; } catch (_error) { continue; }
    if (!proto || proto === Object.prototype || proto === Function.prototype) continue;
    promote(proto);
  }
  // An interface a page reaches without the constructor being on the global,
  // and exactly the object a challenge script walks: `iframe.contentDocument`.
  // Its class members are non-enumerable by ECMAScript rules, and a
  // non-enumerable override *shadows* the enumerable Document.prototype member
  // of the same name, so leaving this out drops twelve names -- querySelector,
  // documentElement, title and the rest -- out of `for (k in doc)` entirely.
  promote(_ScopedDocument.prototype);
})();

// ==== Chrome interface surface (generated; regenerate with
// js-repros/window-surface) ====
// Captured from the Chrome oracle in js-repros/window-surface and pruned to
// the names the CF challenge actually probes (payload ZokK1 N/o buckets), so a
// newer capture cannot oversell interfaces the pinned UA version lacks.
// Row: [name, kind(0=interface ctor,1=object), ctorMode(0=illegal,1=constructs,
// 2/3='N arguments required' throw,4=free-form message), protoParent, tag,
// fn.length].
const _chromeInterfaceTable = [
  ["AbortController",0,1,"Object","AbortController",0],
  ["AbortSignal",0,0,"EventTarget","",0],
  ["AbsoluteOrientationSensor",0,1,"OrientationSensor","AbsoluteOrientationSensor",0],
  ["AbstractRange",0,0,"Object","",0],
  ["Accelerometer",0,1,"Sensor","Accelerometer",0],
  ["AggregateError",0,4,"Error","",2],
  ["AnalyserNode",0,2,"AudioNode","",1],
  ["Animation",0,1,"EventTarget","Animation",0],
  ["AnimationEffect",0,0,"Object","",0],
  ["AnimationEvent",0,2,"Event","",1],
  ["AnimationPlaybackEvent",0,2,"Event","",1],
  ["AnimationTimeline",0,0,"Object","",0],
  ["AnimationTrigger",0,0,"Object","",0],
  ["ArrayBuffer",0,1,"Object","ArrayBuffer",1],
  ["AsyncDisposableStack",0,1,"Object","AsyncDisposableStack",0],
  ["Atomics",1,9,"Object","Atomics",0],
  ["Attr",0,0,"Node","",0],
  ["Audio",0,1,"HTMLMediaElement","HTMLAudioElement",0],
  ["AudioBuffer",0,2,"Object","",1],
  ["AudioBufferSourceNode",0,2,"AudioScheduledSourceNode","",1],
  ["AudioContext",0,1,"BaseAudioContext","AudioContext",0],
  ["AudioData",0,2,"Object","",1],
  ["AudioDecoder",0,2,"EventTarget","",1],
  ["AudioDestinationNode",0,0,"AudioNode","",0],
  ["AudioEncoder",0,2,"EventTarget","",1],
  ["AudioListener",0,0,"Object","",0],
  ["AudioNode",0,0,"EventTarget","",0],
  ["AudioParam",0,0,"Object","",0],
  ["AudioParamMap",0,0,"Object","",0],
  ["AudioPlaybackStats",0,0,"Object","",0],
  ["AudioProcessingEvent",0,3,"Event","",2],
  ["AudioScheduledSourceNode",0,0,"AudioNode","",0],
  ["AudioSinkInfo",0,0,"Object","",0],
  ["AudioWorklet",0,0,"Worklet","",0],
  ["AudioWorkletNode",0,3,"AudioNode","",2],
  ["AuthenticatorAssertionResponse",0,0,"AuthenticatorResponse","",0],
  ["AuthenticatorAttestationResponse",0,0,"AuthenticatorResponse","",0],
  ["AuthenticatorResponse",0,0,"Object","",0],
  ["BackgroundFetchManager",0,0,"Object","",0],
  ["BackgroundFetchRecord",0,0,"Object","",0],
  ["BackgroundFetchRegistration",0,0,"EventTarget","",0],
  ["BarProp",0,0,"Object","",0],
  ["BarcodeDetector",0,1,"Object","BarcodeDetector",0],
  ["BaseAudioContext",0,0,"EventTarget","",0],
  ["BatteryManager",0,0,"EventTarget","",0],
  ["BeforeInstallPromptEvent",0,2,"Event","",1],
  ["BeforeUnloadEvent",0,0,"Event","",0],
  ["BigInt",0,4,"Object","",1],
  ["BigInt64Array",0,1,"TypedArray","BigInt64Array",3],
  ["BigUint64Array",0,1,"TypedArray","BigUint64Array",3],
  ["BiquadFilterNode",0,2,"AudioNode","",1],
  ["Blob",0,1,"Object","Blob",0],
  ["BlobEvent",0,3,"Event","",2],
  ["Bluetooth",0,0,"EventTarget","",0],
  ["BluetoothCharacteristicProperties",0,0,"Object","",0],
  ["BluetoothDevice",0,0,"EventTarget","",0],
  ["BluetoothRemoteGATTCharacteristic",0,0,"EventTarget","",0],
  ["BluetoothRemoteGATTDescriptor",0,0,"Object","",0],
  ["BluetoothRemoteGATTServer",0,0,"Object","",0],
  ["BluetoothRemoteGATTService",0,0,"Object","",0],
  ["BluetoothUUID",0,0,"Object","",0],
  ["Boolean",0,1,"Object","Boolean",1],
  ["BroadcastChannel",0,2,"EventTarget","",1],
  ["BrowserCaptureMediaStreamTrack",0,0,"MediaStreamTrack","",0],
  ["ByteLengthQueuingStrategy",0,2,"Object","",1],
  ["CDATASection",0,0,"Text","",0],
  ["CSPViolationReportBody",0,0,"ReportBody","",0],
  ["CSS",1,9,"Object","CSS",0],
  ["CSSAnimation",0,0,"Animation","",0],
  ["CSSConditionRule",0,0,"CSSGroupingRule","",0],
  ["CSSContainerRule",0,0,"CSSConditionRule","",0],
  ["CSSCounterStyleRule",0,0,"CSSRule","",0],
  ["CSSFontFaceRule",0,0,"CSSRule","",0],
  ["CSSFontFeatureValuesRule",0,0,"CSSRule","",0],
  ["CSSFontPaletteValuesRule",0,0,"CSSRule","",0],
  ["CSSFunctionDeclarations",0,0,"CSSRule","",0],
  ["CSSFunctionDescriptors",0,0,"CSSStyleDeclaration","",0],
  ["CSSFunctionRule",0,0,"CSSGroupingRule","",0],
  ["CSSGroupingRule",0,0,"CSSRule","",0],
  ["CSSImageValue",0,0,"CSSStyleValue","",0],
  ["CSSImportRule",0,0,"CSSRule","",0],
  ["CSSKeyframeRule",0,0,"CSSRule","",0],
  ["CSSKeyframesRule",0,0,"CSSRule","",0],
  ["CSSKeywordValue",0,2,"CSSStyleValue","",1],
  ["CSSLayerBlockRule",0,0,"CSSGroupingRule","",0],
  ["CSSLayerStatementRule",0,0,"CSSRule","",0],
  ["CSSMarginRule",0,0,"CSSRule","",0],
  ["CSSMathClamp",0,3,"CSSMathValue","",3],
  ["CSSMathInvert",0,2,"CSSMathValue","",1],
  ["CSSMathMax",0,4,"CSSMathValue","",0],
  ["CSSMathMin",0,4,"CSSMathValue","",0],
  ["CSSMathNegate",0,2,"CSSMathValue","",1],
  ["CSSMathProduct",0,4,"CSSMathValue","",0],
  ["CSSMathSum",0,4,"CSSMathValue","",0],
  ["CSSMathValue",0,0,"CSSNumericValue","",0],
  ["CSSMatrixComponent",0,2,"CSSTransformComponent","",1],
  ["CSSMediaRule",0,0,"CSSConditionRule","",0],
  ["CSSNamespaceRule",0,0,"CSSRule","",0],
  ["CSSNestedDeclarations",0,0,"CSSRule","",0],
  ["CSSNumericArray",0,0,"Object","",0],
  ["CSSNumericValue",0,0,"CSSStyleValue","",0],
  ["CSSPageRule",0,0,"CSSGroupingRule","",0],
  ["CSSPerspective",0,2,"CSSTransformComponent","",1],
  ["CSSPositionTryDescriptors",0,0,"CSSStyleDeclaration","",0],
  ["CSSPositionTryRule",0,0,"CSSRule","",0],
  ["CSSPositionValue",0,3,"CSSStyleValue","",2],
  ["CSSPropertyRule",0,0,"CSSRule","",0],
  ["CSSPseudoElement",0,0,"Object","",0],
  ["CSSRotate",0,2,"CSSTransformComponent","",1],
  ["CSSRule",0,0,"Object","",0],
  ["CSSRuleList",0,0,"Object","",0],
  ["CSSScale",0,3,"CSSTransformComponent","",2],
  ["CSSScopeRule",0,0,"CSSGroupingRule","",0],
  ["CSSSkew",0,3,"CSSTransformComponent","",2],
  ["CSSSkewX",0,2,"CSSTransformComponent","",1],
  ["CSSSkewY",0,2,"CSSTransformComponent","",1],
  ["CSSStartingStyleRule",0,0,"CSSGroupingRule","",0],
  ["CSSStyleDeclaration",0,0,"Object","",0],
  ["CSSStyleRule",0,0,"CSSRule","",0],
  ["CSSStyleSheet",0,1,"StyleSheet","CSSStyleSheet",0],
  ["CSSStyleValue",0,0,"Object","",0],
  ["CSSSupportsRule",0,0,"CSSConditionRule","",0],
  ["CSSTransformComponent",0,0,"Object","",0],
  ["CSSTransformValue",0,2,"CSSStyleValue","",1],
  ["CSSTransition",0,0,"Animation","",0],
  ["CSSTranslate",0,3,"CSSTransformComponent","",2],
  ["CSSUnitValue",0,3,"CSSNumericValue","",2],
  ["CSSUnparsedValue",0,2,"CSSStyleValue","",1],
  ["CSSVariableReferenceValue",0,2,"Object","",1],
  ["CSSViewTransitionRule",0,0,"CSSRule","",0],
  ["Cache",0,0,"Object","",0],
  ["CacheStorage",0,0,"Object","",0],
  ["CanvasCaptureMediaStreamTrack",0,0,"MediaStreamTrack","",0],
  ["CanvasGradient",0,0,"Object","",0],
  ["CanvasPattern",0,0,"Object","",0],
  ["CanvasRenderingContext2D",0,0,"Object","",0],
  ["CaptureController",0,1,"EventTarget","CaptureController",0],
  ["CaretPosition",0,0,"Object","",0],
  ["ChannelMergerNode",0,2,"AudioNode","",1],
  ["ChannelSplitterNode",0,2,"AudioNode","",1],
  ["ChapterInformation",0,0,"Object","",0],
  ["CharacterBoundsUpdateEvent",0,2,"Event","",1],
  ["CharacterData",0,0,"Node","",0],
  ["Clipboard",0,0,"EventTarget","",0],
  ["ClipboardChangeEvent",0,1,"Event","ClipboardChangeEvent",0],
  ["ClipboardEvent",0,2,"Event","",1],
  ["ClipboardItem",0,2,"Object","",1],
  ["CloseEvent",0,2,"Event","",1],
  ["CloseWatcher",0,1,"EventTarget","CloseWatcher",0],
  ["CommandEvent",0,2,"Event","",1],
  ["Comment",0,1,"CharacterData","Comment",0],
  ["CompositionEvent",0,2,"UIEvent","",1],
  ["CompressionStream",0,2,"Object","",1],
  ["ConstantSourceNode",0,2,"AudioScheduledSourceNode","",1],
  ["ContentVisibilityAutoStateChangeEvent",0,4,"Event","",1],
  ["ConvolverNode",0,2,"AudioNode","",1],
  ["CookieChangeEvent",0,2,"Event","",1],
  ["CookieStore",0,0,"EventTarget","",0],
  ["CookieStoreManager",0,0,"Object","",0],
  ["CountQueuingStrategy",0,2,"Object","",1],
  ["CrashReportContext",0,0,"Object","",0],
  ["CreateMonitor",0,0,"EventTarget","",0],
  ["Credential",0,0,"Object","",0],
  ["CredentialsContainer",0,0,"Object","",0],
  ["CropTarget",0,0,"Object","",0],
  ["Crypto",0,0,"Object","",0],
  ["CryptoKey",0,0,"Object","",0],
  ["CustomElementRegistry",0,1,"Object","CustomElementRegistry",0],
  ["CustomEvent",0,2,"Event","",1],
  ["CustomStateSet",0,0,"Object","",0],
  ["DOMError",0,2,"Object","",1],
  ["DOMException",0,1,"Error","DOMException",0],
  ["DOMImplementation",0,0,"Object","",0],
  ["DOMMatrix",0,1,"DOMMatrixReadOnly","DOMMatrix",0],
  ["DOMMatrixReadOnly",0,1,"Object","DOMMatrixReadOnly",0],
  ["DOMParser",0,1,"Object","DOMParser",0],
  ["DOMPoint",0,1,"DOMPointReadOnly","DOMPoint",0],
  ["DOMPointReadOnly",0,1,"Object","DOMPointReadOnly",0],
  ["DOMQuad",0,1,"Object","DOMQuad",0],
  ["DOMRect",0,1,"DOMRectReadOnly","DOMRect",0],
  ["DOMRectList",0,0,"Object","",0],
  ["DOMRectReadOnly",0,1,"Object","DOMRectReadOnly",0],
  ["DOMStringList",0,0,"Object","",0],
  ["DOMStringMap",0,0,"Object","",0],
  ["DOMTokenList",0,0,"Object","",0],
  ["DataTransfer",0,1,"Object","DataTransfer",0],
  ["DataTransferItem",0,0,"Object","",0],
  ["DataTransferItemList",0,0,"Object","",0],
  ["DataView",0,4,"Object","",1],
  ["Date",0,1,"Object","Date",7],
  ["DecompressionStream",0,2,"Object","",1],
  ["DelayNode",0,2,"AudioNode","",1],
  ["DelegatedInkTrailPresenter",0,0,"Object","",0],
  ["DeviceMotionEvent",0,2,"Event","",1],
  ["DeviceMotionEventAcceleration",0,0,"Object","",0],
  ["DeviceMotionEventRotationRate",0,0,"Object","",0],
  ["DeviceOrientationEvent",0,2,"Event","",1],
  ["DevicePosture",0,0,"EventTarget","",0],
  ["DigitalCredential",0,0,"Credential","",0],
  ["DisposableStack",0,1,"Object","DisposableStack",0],
  ["Document",0,1,"Node","Document",0],
  ["DocumentFragment",0,1,"Node","DocumentFragment",0],
  ["DocumentPictureInPicture",0,0,"EventTarget","",0],
  ["DocumentPictureInPictureEvent",0,3,"Event","",2],
  ["DocumentTimeline",0,1,"AnimationTimeline","DocumentTimeline",0],
  ["DocumentType",0,0,"Node","",0],
  ["DragEvent",0,2,"MouseEvent","",1],
  ["DynamicsCompressorNode",0,2,"AudioNode","",1],
  ["EditContext",0,1,"EventTarget","EditContext",0],
  ["Element",0,0,"Node","",0],
  ["ElementInternals",0,0,"Object","",0],
  ["EncodedAudioChunk",0,2,"Object","",1],
  ["EncodedVideoChunk",0,2,"Object","",1],
  ["Error",0,1,"Object","Error",1],
  ["ErrorEvent",0,2,"Event","",1],
  ["EvalError",0,1,"Error","Error",1],
  ["Event",0,2,"Object","",1],
  ["EventCounts",0,0,"Object","",0],
  ["EventSource",0,2,"EventTarget","",1],
  ["EventTarget",0,1,"Object","EventTarget",0],
  ["External",0,0,"Object","",0],
  ["EyeDropper",0,1,"Object","EyeDropper",0],
  ["FeaturePolicy",0,0,"Object","",0],
  ["FederatedCredential",0,2,"Credential","",1],
  ["Fence",0,0,"Object","",0],
  ["FencedFrameConfig",0,0,"Object","",0],
  ["FetchLaterResult",0,0,"Object","",0],
  ["File",0,3,"Blob","",2],
  ["FileList",0,0,"Object","",0],
  ["FileReader",0,1,"EventTarget","FileReader",0],
  ["FileSystemDirectoryHandle",0,0,"FileSystemHandle","",0],
  ["FileSystemFileHandle",0,0,"FileSystemHandle","",0],
  ["FileSystemHandle",0,0,"Object","",0],
  ["FileSystemObserver",0,2,"Object","",1],
  ["FileSystemWritableFileStream",0,0,"WritableStream","",0],
  ["FinalizationRegistry",0,4,"Object","",1],
  ["Float16Array",0,1,"TypedArray","Float16Array",3],
  ["Float32Array",0,1,"TypedArray","Float32Array",3],
  ["Float64Array",0,1,"TypedArray","Float64Array",3],
  ["FocusEvent",0,2,"UIEvent","",1],
  ["FontData",0,0,"Object","",0],
  ["FontFace",0,3,"Object","",2],
  ["FontFaceSetLoadEvent",0,2,"Event","",1],
  ["FormData",0,1,"Object","FormData",0],
  ["FormDataEvent",0,3,"Event","",2],
  ["FragmentDirective",0,0,"Object","",0],
  ["Function",0,1,"Object","Function",1],
  ["GPU",0,0,"Object","",0],
  ["GPUAdapter",0,0,"Object","",0],
  ["GPUAdapterInfo",0,0,"Object","",0],
  ["GPUBindGroup",0,0,"Object","",0],
  ["GPUBindGroupLayout",0,0,"Object","",0],
  ["GPUBuffer",0,0,"Object","",0],
  ["GPUBufferUsage",1,9,"Object","GPUBufferUsage",0],
  ["GPUCanvasContext",0,0,"Object","",0],
  ["GPUColorWrite",1,9,"Object","GPUColorWrite",0],
  ["GPUCommandBuffer",0,0,"Object","",0],
  ["GPUCommandEncoder",0,0,"Object","",0],
  ["GPUCompilationInfo",0,0,"Object","",0],
  ["GPUCompilationMessage",0,0,"Object","",0],
  ["GPUComputePassEncoder",0,0,"Object","",0],
  ["GPUComputePipeline",0,0,"Object","",0],
  ["GPUDevice",0,0,"EventTarget","",0],
  ["GPUDeviceLostInfo",0,0,"Object","",0],
  ["GPUError",0,0,"Object","",0],
  ["GPUExternalTexture",0,0,"Object","",0],
  ["GPUInternalError",0,2,"GPUError","",1],
  ["GPUMapMode",1,9,"Object","GPUMapMode",0],
  ["GPUOutOfMemoryError",0,2,"GPUError","",1],
  ["GPUPipelineError",0,2,"DOMException","",1],
  ["GPUPipelineLayout",0,0,"Object","",0],
  ["GPUQuerySet",0,0,"Object","",0],
  ["GPUQueue",0,0,"Object","",0],
  ["GPURenderBundle",0,0,"Object","",0],
  ["GPURenderBundleEncoder",0,0,"Object","",0],
  ["GPURenderPassEncoder",0,0,"Object","",0],
  ["GPURenderPipeline",0,0,"Object","",0],
  ["GPUSampler",0,0,"Object","",0],
  ["GPUShaderModule",0,0,"Object","",0],
  ["GPUShaderStage",1,9,"Object","GPUShaderStage",0],
  ["GPUSupportedFeatures",0,0,"Object","",0],
  ["GPUSupportedLimits",0,0,"Object","",0],
  ["GPUTexture",0,0,"Object","",0],
  ["GPUTextureUsage",1,9,"Object","GPUTextureUsage",0],
  ["GPUTextureView",0,0,"Object","",0],
  ["GPUUncapturedErrorEvent",0,3,"Event","",2],
  ["GPUValidationError",0,2,"GPUError","",1],
  ["GainNode",0,2,"AudioNode","",1],
  ["Gamepad",0,0,"Object","",0],
  ["GamepadButton",0,0,"Object","",0],
  ["GamepadEvent",0,2,"Event","",1],
  ["GamepadHapticActuator",0,0,"Object","",0],
  ["Geolocation",0,0,"Object","",0],
  ["GeolocationCoordinates",0,0,"Object","",0],
  ["GeolocationPosition",0,0,"Object","",0],
  ["GeolocationPositionError",0,0,"Object","",0],
  ["GravitySensor",0,1,"Accelerometer","GravitySensor",0],
  ["Gyroscope",0,1,"Sensor","Gyroscope",0],
  ["HID",0,0,"EventTarget","",0],
  ["HIDConnectionEvent",0,3,"Event","",2],
  ["HIDDevice",0,0,"EventTarget","",0],
  ["HIDInputReportEvent",0,0,"Event","",0],
  ["HTMLAllCollection",0,0,"Object","",0],
  ["HTMLAnchorElement",0,0,"HTMLElement","",0],
  ["HTMLAreaElement",0,0,"HTMLElement","",0],
  ["HTMLAudioElement",0,0,"HTMLMediaElement","",0],
  ["HTMLBRElement",0,0,"HTMLElement","",0],
  ["HTMLBaseElement",0,0,"HTMLElement","",0],
  ["HTMLBodyElement",0,0,"HTMLElement","",0],
  ["HTMLButtonElement",0,0,"HTMLElement","",0],
  ["HTMLCanvasElement",0,0,"HTMLElement","",0],
  ["HTMLCollection",0,0,"Object","",0],
  ["HTMLDListElement",0,0,"HTMLElement","",0],
  ["HTMLDataElement",0,0,"HTMLElement","",0],
  ["HTMLDataListElement",0,0,"HTMLElement","",0],
  ["HTMLDetailsElement",0,0,"HTMLElement","",0],
  ["HTMLDialogElement",0,0,"HTMLElement","",0],
  ["HTMLDirectoryElement",0,0,"HTMLElement","",0],
  ["HTMLDivElement",0,0,"HTMLElement","",0],
  ["HTMLDocument",0,0,"Document","",0],
  ["HTMLElement",0,0,"Element","",0],
  ["HTMLEmbedElement",0,0,"HTMLElement","",0],
  ["HTMLFencedFrameElement",0,0,"HTMLElement","",0],
  ["HTMLFieldSetElement",0,0,"HTMLElement","",0],
  ["HTMLFontElement",0,0,"HTMLElement","",0],
  ["HTMLFormControlsCollection",0,0,"HTMLCollection","",0],
  ["HTMLFormElement",0,0,"HTMLElement","",0],
  ["HTMLFrameElement",0,0,"HTMLElement","",0],
  ["HTMLFrameSetElement",0,0,"HTMLElement","",0],
  ["HTMLGeolocationElement",0,0,"HTMLElement","",0],
  ["HTMLHRElement",0,0,"HTMLElement","",0],
  ["HTMLHeadElement",0,0,"HTMLElement","",0],
  ["HTMLHeadingElement",0,0,"HTMLElement","",0],
  ["HTMLHtmlElement",0,0,"HTMLElement","",0],
  ["HTMLIFrameElement",0,0,"HTMLElement","",0],
  ["HTMLImageElement",0,0,"HTMLElement","",0],
  ["HTMLInputElement",0,0,"HTMLElement","",0],
  ["HTMLLIElement",0,0,"HTMLElement","",0],
  ["HTMLLabelElement",0,0,"HTMLElement","",0],
  ["HTMLLegendElement",0,0,"HTMLElement","",0],
  ["HTMLLinkElement",0,0,"HTMLElement","",0],
  ["HTMLMapElement",0,0,"HTMLElement","",0],
  ["HTMLMarqueeElement",0,0,"HTMLElement","",0],
  ["HTMLMediaElement",0,0,"HTMLElement","",0],
  ["HTMLMenuElement",0,0,"HTMLElement","",0],
  ["HTMLMetaElement",0,0,"HTMLElement","",0],
  ["HTMLMeterElement",0,0,"HTMLElement","",0],
  ["HTMLModElement",0,0,"HTMLElement","",0],
  ["HTMLOListElement",0,0,"HTMLElement","",0],
  ["HTMLObjectElement",0,0,"HTMLElement","",0],
  ["HTMLOptGroupElement",0,0,"HTMLElement","",0],
  ["HTMLOptionElement",0,0,"HTMLElement","",0],
  ["HTMLOptionsCollection",0,0,"HTMLCollection","",0],
  ["HTMLOutputElement",0,0,"HTMLElement","",0],
  ["HTMLParagraphElement",0,0,"HTMLElement","",0],
  ["HTMLParamElement",0,0,"HTMLElement","",0],
  ["HTMLPictureElement",0,0,"HTMLElement","",0],
  ["HTMLPreElement",0,0,"HTMLElement","",0],
  ["HTMLProgressElement",0,0,"HTMLElement","",0],
  ["HTMLQuoteElement",0,0,"HTMLElement","",0],
  ["HTMLScriptElement",0,0,"HTMLElement","",0],
  ["HTMLSelectElement",0,0,"HTMLElement","",0],
  ["HTMLSelectedContentElement",0,0,"HTMLElement","",0],
  ["HTMLSlotElement",0,0,"HTMLElement","",0],
  ["HTMLSourceElement",0,0,"HTMLElement","",0],
  ["HTMLSpanElement",0,0,"HTMLElement","",0],
  ["HTMLStyleElement",0,0,"HTMLElement","",0],
  ["HTMLTableCaptionElement",0,0,"HTMLElement","",0],
  ["HTMLTableCellElement",0,0,"HTMLElement","",0],
  ["HTMLTableColElement",0,0,"HTMLElement","",0],
  ["HTMLTableElement",0,0,"HTMLElement","",0],
  ["HTMLTableRowElement",0,0,"HTMLElement","",0],
  ["HTMLTableSectionElement",0,0,"HTMLElement","",0],
  ["HTMLTemplateElement",0,0,"HTMLElement","",0],
  ["HTMLTextAreaElement",0,0,"HTMLElement","",0],
  ["HTMLTimeElement",0,0,"HTMLElement","",0],
  ["HTMLTitleElement",0,0,"HTMLElement","",0],
  ["HTMLTrackElement",0,0,"HTMLElement","",0],
  ["HTMLUserMediaElement",0,0,"HTMLElement","HTMLUserMediaElement",0],
  ["HTMLUListElement",0,0,"HTMLElement","",0],
  ["HTMLUnknownElement",0,0,"HTMLElement","",0],
  ["HTMLVideoElement",0,0,"HTMLMediaElement","",0],
  ["HashChangeEvent",0,2,"Event","",1],
  ["Headers",0,1,"Object","Headers",0],
  ["Highlight",0,1,"Object","Highlight",0],
  ["HighlightRegistry",0,0,"Object","",0],
  ["History",0,0,"Object","",0],
  ["IDBCursor",0,0,"Object","",0],
  ["IDBCursorWithValue",0,0,"IDBCursor","",0],
  ["IDBDatabase",0,0,"EventTarget","",0],
  ["IDBFactory",0,0,"Object","",0],
  ["IDBIndex",0,0,"Object","",0],
  ["IDBKeyRange",0,0,"Object","",0],
  ["IDBObjectStore",0,0,"Object","",0],
  ["IDBOpenDBRequest",0,0,"IDBRequest","",0],
  ["IDBRecord",0,0,"Object","",0],
  ["IDBRequest",0,0,"EventTarget","",0],
  ["IDBTransaction",0,0,"EventTarget","",0],
  ["IDBVersionChangeEvent",0,2,"Event","",1],
  ["IIRFilterNode",0,3,"AudioNode","",2],
  ["IdentityCredential",0,0,"Credential","",0],
  ["IdentityCredentialError",0,1,"DOMException","IdentityCredentialError",0],
  ["IdentityProvider",0,0,"Object","",0],
  ["IdleDeadline",0,0,"Object","",0],
  ["IdleDetector",0,1,"EventTarget","IdleDetector",0],
  ["Image",0,1,"HTMLElement","HTMLImageElement",0],
  ["ImageBitmap",0,0,"Object","",0],
  ["ImageBitmapRenderingContext",0,0,"Object","",0],
  ["ImageCapture",0,2,"Object","",1],
  ["ImageData",0,3,"Object","",2],
  ["ImageDecoder",0,2,"Object","",1],
  ["ImageTrack",0,0,"Object","",0],
  ["ImageTrackList",0,0,"Object","",0],
  ["Ink",0,0,"Object","",0],
  ["InputDeviceCapabilities",0,1,"Object","InputDeviceCapabilities",0],
  ["InputDeviceInfo",0,0,"MediaDeviceInfo","",0],
  ["InputEvent",0,2,"UIEvent","",1],
  ["InteractionContentfulPaint",0,0,"PerformanceEntry","InteractionContentfulPaint",0],
  ["Int16Array",0,1,"TypedArray","Int16Array",3],
  ["Int32Array",0,1,"TypedArray","Int32Array",3],
  ["Int8Array",0,1,"TypedArray","Int8Array",3],
  ["IntegrityViolationReportBody",0,0,"ReportBody","",0],
  ["InterestEvent",0,2,"Event","",1],
  ["IntersectionObserver",0,2,"Object","",1],
  ["IntersectionObserverEntry",0,0,"Object","",0],
  ["Intl",1,9,"Object","Intl",0],
  ["Iterator",0,4,"Object","",0],
  ["JSON",1,9,"Object","JSON",0],
  ["Keyboard",0,0,"Object","",0],
  ["KeyboardEvent",0,2,"UIEvent","",1],
  ["KeyboardLayoutMap",0,0,"Object","",0],
  ["KeyframeEffect",0,2,"AnimationEffect","",1],
  ["LanguageDetector",0,0,"Object","",0],
  ["LanguageModel",0,0,"EventTarget","",0],
  ["LargestContentfulPaint",0,0,"PerformanceEntry","",0],
  ["LaunchParams",0,0,"Object","",0],
  ["LaunchQueue",0,0,"Object","",0],
  ["LayoutShift",0,0,"PerformanceEntry","",0],
  ["LayoutShiftAttribution",0,0,"Object","",0],
  ["LinearAccelerationSensor",0,1,"Accelerometer","LinearAccelerationSensor",0],
  ["Location",0,0,"Object","",0],
  ["Lock",0,0,"Object","",0],
  ["LockManager",0,0,"Object","",0],
  ["MIDIAccess",0,0,"EventTarget","",0],
  ["MIDIConnectionEvent",0,2,"Event","",1],
  ["MIDIInput",0,0,"MIDIPort","",0],
  ["MIDIInputMap",0,0,"Object","",0],
  ["MIDIMessageEvent",0,2,"Event","",1],
  ["MIDIOutput",0,0,"MIDIPort","",0],
  ["MIDIOutputMap",0,0,"Object","",0],
  ["MIDIPort",0,0,"EventTarget","",0],
  ["Map",0,1,"Object","Map",0],
  ["Math",1,9,"Object","Math",0],
  ["MathMLElement",0,0,"Element","",0],
  ["MediaCapabilities",0,0,"Object","",0],
  ["MediaDeviceInfo",0,0,"Object","",0],
  ["MediaDevices",0,0,"EventTarget","",0],
  ["MediaElementAudioSourceNode",0,3,"AudioNode","",2],
  ["MediaEncryptedEvent",0,2,"Event","",1],
  ["MediaError",0,0,"Object","",0],
  ["MediaKeyMessageEvent",0,3,"Event","",2],
  ["MediaKeySession",0,0,"EventTarget","",0],
  ["MediaKeyStatusMap",0,0,"Object","",0],
  ["MediaKeySystemAccess",0,0,"Object","",0],
  ["MediaKeys",0,0,"Object","",0],
  ["MediaList",0,0,"Object","",0],
  ["MediaMetadata",0,1,"Object","MediaMetadata",0],
  ["MediaQueryList",0,0,"EventTarget","",0],
  ["MediaQueryListEvent",0,2,"Event","",1],
  ["MediaRecorder",0,2,"EventTarget","",1],
  ["MediaSession",0,0,"Object","",0],
  ["MediaSource",0,1,"EventTarget","MediaSource",0],
  ["MediaSourceHandle",0,0,"Object","",0],
  ["MediaStream",0,1,"EventTarget","MediaStream",0],
  ["MediaStreamAudioDestinationNode",0,2,"AudioNode","",1],
  ["MediaStreamAudioSourceNode",0,3,"AudioNode","",2],
  ["MediaStreamEvent",0,2,"Event","",1],
  ["MediaStreamTrack",0,0,"EventTarget","",0],
  ["MediaStreamTrackAudioStats",0,0,"Object","",0],
  ["MediaStreamTrackEvent",0,3,"Event","",2],
  ["MediaStreamTrackGenerator",0,2,"MediaStreamTrack","",1],
  ["MediaStreamTrackProcessor",0,2,"Object","",1],
  ["MediaStreamTrackVideoStats",0,0,"Object","",0],
  ["MessageChannel",0,1,"Object","MessageChannel",0],
  ["MessageEvent",0,2,"Event","",1],
  ["MessagePort",0,0,"EventTarget","",0],
  ["MimeType",0,0,"Object","",0],
  ["MimeTypeArray",0,0,"Object","",0],
  ["MouseEvent",0,2,"UIEvent","",1],
  ["MutationObserver",0,2,"Object","",1],
  ["MutationRecord",0,0,"Object","",0],
  ["NamedNodeMap",0,0,"Object","",0],
  ["NavigateEvent",0,3,"Event","",2],
  ["Navigation",0,0,"EventTarget","",0],
  ["NavigationActivation",0,0,"Object","",0],
  ["NavigationCurrentEntryChangeEvent",0,3,"Event","",2],
  ["NavigationDestination",0,0,"Object","",0],
  ["NavigationHistoryEntry",0,0,"EventTarget","",0],
  ["NavigationPrecommitController",0,0,"Object","",0],
  ["NavigationPreloadManager",0,0,"Object","",0],
  ["NavigationTransition",0,0,"Object","",0],
  ["Navigator",0,0,"Object","",0],
  ["NavigatorLogin",0,0,"Object","",0],
  ["NavigatorManagedData",0,0,"EventTarget","",0],
  ["NavigatorUAData",0,0,"Object","",0],
  ["NetworkInformation",0,0,"EventTarget","",0],
  ["Node",0,0,"EventTarget","",0],
  ["NodeFilter",0,4,"no-proto","",0],
  ["NodeIterator",0,0,"Object","",0],
  ["NodeList",0,0,"Object","",0],
  ["NodeRange",0,0,"AbstractRange","NodeRange",0],
  ["NotRestoredReasonDetails",0,0,"Object","",0],
  ["NotRestoredReasons",0,0,"Object","",0],
  ["Notification",0,2,"EventTarget","",1],
  ["Number",0,1,"Object","Number",1],
  ["OTPCredential",0,0,"Credential","",0],
  ["Object",0,1,"Object","Object",1],
  ["Observable",0,2,"Object","",1],
  ["OfflineAudioCompletionEvent",0,3,"Event","",2],
  ["OfflineAudioContext",0,2,"BaseAudioContext","",1],
  ["OffscreenCanvas",0,3,"EventTarget","",2],
  ["OpaqueRange",0,0,"AbstractRange","OpaqueRange",0],
  ["OffscreenCanvasRenderingContext2D",0,0,"Object","",0],
  ["Option",0,1,"HTMLElement","HTMLOptionElement",0],
  ["OrientationSensor",0,0,"Sensor","",0],
  ["Origin",0,1,"Object","Origin",0],
  ["OscillatorNode",0,2,"AudioScheduledSourceNode","",1],
  ["OverconstrainedError",0,2,"DOMException","",1],
  ["PageRevealEvent",0,2,"Event","",1],
  ["PageSwapEvent",0,2,"Event","",1],
  ["PageTransitionEvent",0,2,"Event","",1],
  ["PannerNode",0,2,"AudioNode","",1],
  ["PasswordCredential",0,2,"Credential","",1],
  ["Path2D",0,1,"Object","Path2D",0],
  ["PaymentAddress",0,0,"Object","",0],
  ["PaymentManager",0,0,"Object","",0],
  ["PaymentMethodChangeEvent",0,2,"PaymentRequestUpdateEvent","",1],
  ["PaymentRequest",0,2,"EventTarget","",1],
  ["PaymentRequestUpdateEvent",0,2,"Event","",1],
  ["PaymentResponse",0,0,"EventTarget","",0],
  ["Performance",0,0,"EventTarget","",0],
  ["PerformanceElementTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceEntry",0,0,"Object","",0],
  ["PerformanceEventTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceLongAnimationFrameTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceLongTaskTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceMark",0,2,"PerformanceEntry","",1],
  ["PerformanceMeasure",0,0,"PerformanceEntry","",0],
  ["PerformanceNavigation",0,0,"Object","",0],
  ["PerformanceNavigationTiming",0,0,"PerformanceResourceTiming","",0],
  ["PerformanceObserver",0,2,"Object","",1],
  ["PerformanceObserverEntryList",0,0,"Object","",0],
  ["PerformancePaintTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceResourceTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceSoftNavigation",0,0,"PerformanceEntry","PerformanceSoftNavigation",0],
  ["PerformanceScriptTiming",0,0,"PerformanceEntry","",0],
  ["PerformanceServerTiming",0,0,"Object","",0],
  ["PerformanceTiming",0,0,"Object","",0],
  ["PerformanceTimingConfidence",0,0,"Object","",0],
  ["PeriodicSyncManager",0,0,"Object","",0],
  ["PeriodicWave",0,2,"Object","",1],
  ["PermissionStatus",0,0,"EventTarget","",0],
  ["Permissions",0,0,"Object","",0],
  ["PictureInPictureEvent",0,3,"Event","",2],
  ["PictureInPictureWindow",0,0,"EventTarget","",0],
  ["Plugin",0,0,"Object","",0],
  ["PluginArray",0,0,"Object","",0],
  ["PointerEvent",0,2,"MouseEvent","",1],
  ["PopStateEvent",0,2,"Event","",1],
  ["Presentation",0,0,"Object","",0],
  ["PresentationAvailability",0,0,"EventTarget","",0],
  ["PresentationConnection",0,0,"EventTarget","",0],
  ["PresentationConnectionAvailableEvent",0,4,"Event","",2],
  ["PresentationConnectionCloseEvent",0,3,"Event","",2],
  ["PresentationConnectionList",0,0,"EventTarget","",0],
  ["PresentationReceiver",0,0,"Object","",0],
  ["PresentationRequest",0,2,"EventTarget","",1],
  ["PressureObserver",0,2,"Object","",1],
  ["PressureRecord",0,0,"Object","",0],
  ["ProcessingInstruction",0,0,"CharacterData","",0],
  ["Profiler",0,2,"EventTarget","",1],
  ["ProgressEvent",0,2,"Event","",1],
  ["Promise",0,4,"Object","",1],
  ["PromiseRejectionEvent",0,3,"Event","",2],
  ["ProtectedAudience",0,0,"Object","",0],
  ["Proxy",0,4,"no-proto","",2],
  ["PublicKeyCredential",0,0,"Credential","",0],
  ["PushManager",0,0,"Object","",0],
  ["PushSubscription",0,0,"Object","",0],
  ["PushSubscriptionOptions",0,0,"Object","",0],
  ["QuotaExceededError",0,1,"DOMException","QuotaExceededError",0],
  ["RTCCertificate",0,0,"Object","",0],
  ["RTCDTMFSender",0,0,"EventTarget","",0],
  ["RTCDTMFToneChangeEvent",0,3,"Event","",2],
  ["RTCDataChannel",0,0,"EventTarget","",0],
  ["RTCDataChannelEvent",0,3,"Event","",2],
  ["RTCDtlsTransport",0,0,"EventTarget","",0],
  ["RTCEncodedAudioFrame",0,2,"Object","",1],
  ["RTCEncodedVideoFrame",0,2,"Object","",1],
  ["RTCError",0,2,"DOMException","",1],
  ["RTCErrorEvent",0,3,"Event","",2],
  ["RTCIceCandidate",0,4,"Object","",0],
  ["RTCIceTransport",0,0,"EventTarget","",0],
  ["RTCPeerConnection",0,1,"EventTarget","RTCPeerConnection",0],
  ["RTCPeerConnectionIceErrorEvent",0,3,"Event","",2],
  ["RTCPeerConnectionIceEvent",0,2,"Event","",1],
  ["RTCRtpReceiver",0,0,"Object","",0],
  ["RTCRtpScriptTransform",0,2,"Object","",1],
  ["RTCRtpSender",0,0,"Object","",0],
  ["RTCRtpTransceiver",0,0,"Object","",0],
  ["RTCSctpTransport",0,0,"EventTarget","",0],
  ["RTCSessionDescription",0,1,"Object","RTCSessionDescription",0],
  ["RTCStatsReport",0,0,"Object","",0],
  ["RTCTrackEvent",0,3,"Event","",2],
  ["RadioNodeList",0,0,"NodeList","",0],
  ["Range",0,1,"AbstractRange","Range",0],
  ["RangeError",0,1,"Error","Error",1],
  ["ReadableByteStreamController",0,0,"Object","",0],
  ["ReadableStream",0,1,"Object","ReadableStream",0],
  ["ReadableStreamBYOBReader",0,2,"Object","",1],
  ["ReadableStreamBYOBRequest",0,0,"Object","",0],
  ["ReadableStreamDefaultController",0,0,"Object","",0],
  ["ReadableStreamDefaultReader",0,2,"Object","",1],
  ["ReferenceError",0,1,"Error","Error",1],
  ["Reflect",1,9,"Object","Reflect",0],
  ["RegExp",0,1,"Object","RegExp",2],
  ["RelativeOrientationSensor",0,1,"OrientationSensor","RelativeOrientationSensor",0],
  ["RemotePlayback",0,0,"EventTarget","",0],
  ["ReportBody",0,0,"Object","",0],
  ["ReportingObserver",0,2,"Object","",1],
  ["Request",0,2,"Object","",1],
  ["ResizeObserver",0,2,"Object","",1],
  ["ResizeObserverEntry",0,0,"Object","",0],
  ["ResizeObserverSize",0,0,"Object","",0],
  ["Response",0,1,"Object","Response",0],
  ["RestrictionTarget",0,0,"Object","",0],
  ["SVGAElement",0,0,"SVGGraphicsElement","",0],
  ["SVGAngle",0,0,"Object","",0],
  ["SVGAnimateElement",0,0,"SVGAnimationElement","",0],
  ["SVGAnimateMotionElement",0,0,"SVGAnimationElement","",0],
  ["SVGAnimateTransformElement",0,0,"SVGAnimationElement","",0],
  ["SVGAnimatedAngle",0,0,"Object","",0],
  ["SVGAnimatedBoolean",0,0,"Object","",0],
  ["SVGAnimatedEnumeration",0,0,"Object","",0],
  ["SVGAnimatedInteger",0,0,"Object","",0],
  ["SVGAnimatedLength",0,0,"Object","",0],
  ["SVGAnimatedLengthList",0,0,"Object","",0],
  ["SVGAnimatedNumber",0,0,"Object","",0],
  ["SVGAnimatedNumberList",0,0,"Object","",0],
  ["SVGAnimatedPreserveAspectRatio",0,0,"Object","",0],
  ["SVGAnimatedRect",0,0,"Object","",0],
  ["SVGAnimatedString",0,0,"Object","",0],
  ["SVGAnimatedTransformList",0,0,"Object","",0],
  ["SVGAnimationElement",0,0,"SVGElement","",0],
  ["SVGCircleElement",0,0,"SVGGeometryElement","",0],
  ["SVGClipPathElement",0,0,"SVGElement","",0],
  ["SVGComponentTransferFunctionElement",0,0,"SVGElement","",0],
  ["SVGDefsElement",0,0,"SVGGraphicsElement","",0],
  ["SVGDescElement",0,0,"SVGElement","",0],
  ["SVGElement",0,0,"Element","",0],
  ["SVGEllipseElement",0,0,"SVGGeometryElement","",0],
  ["SVGFEBlendElement",0,0,"SVGElement","",0],
  ["SVGFEColorMatrixElement",0,0,"SVGElement","",0],
  ["SVGFEComponentTransferElement",0,0,"SVGElement","",0],
  ["SVGFECompositeElement",0,0,"SVGElement","",0],
  ["SVGFEConvolveMatrixElement",0,0,"SVGElement","",0],
  ["SVGFEDiffuseLightingElement",0,0,"SVGElement","",0],
  ["SVGFEDisplacementMapElement",0,0,"SVGElement","",0],
  ["SVGFEDistantLightElement",0,0,"SVGElement","",0],
  ["SVGFEDropShadowElement",0,0,"SVGElement","",0],
  ["SVGFEFloodElement",0,0,"SVGElement","",0],
  ["SVGFEFuncAElement",0,0,"SVGComponentTransferFunctionElement","",0],
  ["SVGFEFuncBElement",0,0,"SVGComponentTransferFunctionElement","",0],
  ["SVGFEFuncGElement",0,0,"SVGComponentTransferFunctionElement","",0],
  ["SVGFEFuncRElement",0,0,"SVGComponentTransferFunctionElement","",0],
  ["SVGFEGaussianBlurElement",0,0,"SVGElement","",0],
  ["SVGFEImageElement",0,0,"SVGElement","",0],
  ["SVGFEMergeElement",0,0,"SVGElement","",0],
  ["SVGFEMergeNodeElement",0,0,"SVGElement","",0],
  ["SVGFEMorphologyElement",0,0,"SVGElement","",0],
  ["SVGFEOffsetElement",0,0,"SVGElement","",0],
  ["SVGFEPointLightElement",0,0,"SVGElement","",0],
  ["SVGFESpecularLightingElement",0,0,"SVGElement","",0],
  ["SVGFESpotLightElement",0,0,"SVGElement","",0],
  ["SVGFETileElement",0,0,"SVGElement","",0],
  ["SVGFETurbulenceElement",0,0,"SVGElement","",0],
  ["SVGFilterElement",0,0,"SVGElement","",0],
  ["SVGForeignObjectElement",0,0,"SVGGraphicsElement","",0],
  ["SVGGElement",0,0,"SVGGraphicsElement","",0],
  ["SVGGeometryElement",0,0,"SVGGraphicsElement","",0],
  ["SVGGradientElement",0,0,"SVGElement","",0],
  ["SVGGraphicsElement",0,0,"SVGElement","",0],
  ["SVGImageElement",0,0,"SVGGraphicsElement","",0],
  ["SVGLength",0,0,"Object","",0],
  ["SVGLengthList",0,0,"Object","",0],
  ["SVGLineElement",0,0,"SVGGeometryElement","",0],
  ["SVGLinearGradientElement",0,0,"SVGGradientElement","",0],
  ["SVGMPathElement",0,0,"SVGElement","",0],
  ["SVGMarkerElement",0,0,"SVGElement","",0],
  ["SVGMaskElement",0,0,"SVGElement","",0],
  ["SVGMatrix",0,0,"Object","",0],
  ["SVGMetadataElement",0,0,"SVGElement","",0],
  ["SVGNumber",0,0,"Object","",0],
  ["SVGNumberList",0,0,"Object","",0],
  ["SVGPathElement",0,0,"SVGGeometryElement","",0],
  ["SVGPatternElement",0,0,"SVGElement","",0],
  ["SVGPoint",0,0,"Object","",0],
  ["SVGPointList",0,0,"Object","",0],
  ["SVGPolygonElement",0,0,"SVGGeometryElement","",0],
  ["SVGPolylineElement",0,0,"SVGGeometryElement","",0],
  ["SVGPreserveAspectRatio",0,0,"Object","",0],
  ["SVGRadialGradientElement",0,0,"SVGGradientElement","",0],
  ["SVGRect",0,0,"Object","",0],
  ["SVGRectElement",0,0,"SVGGeometryElement","",0],
  ["SVGSVGElement",0,0,"SVGGraphicsElement","",0],
  ["SVGScriptElement",0,0,"SVGElement","",0],
  ["SVGSetElement",0,0,"SVGAnimationElement","",0],
  ["SVGStopElement",0,0,"SVGElement","",0],
  ["SVGStringList",0,0,"Object","",0],
  ["SVGStyleElement",0,0,"SVGElement","",0],
  ["SVGSwitchElement",0,0,"SVGGraphicsElement","",0],
  ["SVGSymbolElement",0,0,"SVGGraphicsElement","",0],
  ["SVGTSpanElement",0,0,"SVGTextPositioningElement","",0],
  ["SVGTextContentElement",0,0,"SVGGraphicsElement","",0],
  ["SVGTextElement",0,0,"SVGTextPositioningElement","",0],
  ["SVGTextPathElement",0,0,"SVGTextContentElement","",0],
  ["SVGTextPositioningElement",0,0,"SVGTextContentElement","",0],
  ["SVGTitleElement",0,0,"SVGElement","",0],
  ["SVGTransform",0,0,"Object","",0],
  ["SVGTransformList",0,0,"Object","",0],
  ["SVGUnitTypes",0,0,"Object","",0],
  ["SVGUseElement",0,0,"SVGGraphicsElement","",0],
  ["SVGViewElement",0,0,"SVGElement","",0],
  ["Sanitizer",0,1,"Object","Sanitizer",0],
  ["Scheduler",0,0,"Object","",0],
  ["Scheduling",0,0,"Object","",0],
  ["Screen",0,0,"EventTarget","",0],
  ["ScreenDetailed",0,0,"Screen","",0],
  ["ScreenDetails",0,0,"EventTarget","",0],
  ["ScreenOrientation",0,0,"EventTarget","",0],
  ["ScriptProcessorNode",0,0,"AudioNode","",0],
  ["ScrollTimeline",0,1,"AnimationTimeline","ScrollTimeline",0],
  ["SecurityPolicyViolationEvent",0,2,"Event","",1],
  ["Selection",0,0,"Object","",0],
  ["Sensor",0,0,"EventTarget","",0],
  ["SensorErrorEvent",0,3,"Event","",2],
  ["Serial",0,0,"EventTarget","",0],
  ["SerialPort",0,0,"EventTarget","",0],
  ["ServiceWorker",0,0,"EventTarget","",0],
  ["ServiceWorkerContainer",0,0,"EventTarget","",0],
  ["ServiceWorkerRegistration",0,0,"EventTarget","",0],
  ["Set",0,1,"Object","Set",0],
  ["ShadowRoot",0,0,"DocumentFragment","",0],
  ["SharedWorker",0,2,"EventTarget","",1],
  ["SnapEvent",0,0,"Event","",0],
  ["SourceBuffer",0,0,"EventTarget","",0],
  ["SourceBufferList",0,0,"EventTarget","",0],
  ["SpeechGrammar",0,1,"Object","SpeechGrammar",0],
  ["SpeechGrammarList",0,1,"Object","SpeechGrammarList",0],
  ["SpeechRecognition",0,1,"EventTarget","SpeechRecognition",0],
  ["SpeechRecognitionErrorEvent",0,2,"Event","",1],
  ["SpeechRecognitionEvent",0,2,"Event","",1],
  ["SpeechRecognitionPhrase",0,2,"Object","",1],
  ["SpeechSynthesis",0,0,"EventTarget","",0],
  ["SpeechSynthesisErrorEvent",0,3,"SpeechSynthesisEvent","",2],
  ["SpeechSynthesisEvent",0,3,"Event","",2],
  ["SpeechSynthesisUtterance",0,1,"EventTarget","SpeechSynthesisUtterance",0],
  ["SpeechSynthesisVoice",0,0,"Object","",0],
  ["StaticRange",0,2,"AbstractRange","",1],
  ["StereoPannerNode",0,2,"AudioNode","",1],
  ["Storage",0,0,"Object","",0],
  ["StorageBucket",0,0,"Object","",0],
  ["StorageBucketManager",0,0,"Object","",0],
  ["StorageEvent",0,2,"Event","",1],
  ["StorageManager",0,0,"Object","",0],
  ["String",0,1,"Object","String",1],
  ["StylePropertyMap",0,0,"StylePropertyMapReadOnly","",0],
  ["StylePropertyMapReadOnly",0,0,"Object","",0],
  ["StyleSheet",0,0,"Object","",0],
  ["StyleSheetList",0,0,"Object","",0],
  ["SubmitEvent",0,2,"Event","",1],
  ["Subscriber",0,0,"Object","",0],
  ["SubtleCrypto",0,0,"Object","",0],
  ["Summarizer",0,0,"Object","",0],
  ["SuppressedError",0,1,"Error","Error",3],
  ["Symbol",0,4,"Object","",0],
  ["SyncManager",0,0,"Object","",0],
  ["SyntaxError",0,1,"Error","Error",1],
  ["TaskAttributionTiming",0,0,"PerformanceEntry","",0],
  ["TaskController",0,1,"AbortController","TaskController",0],
  ["TaskPriorityChangeEvent",0,3,"Event","",2],
  ["TaskSignal",0,0,"AbortSignal","",0],
  ["Temporal",1,9,"Object","Temporal",0],
  ["Text",0,1,"CharacterData","Text",0],
  ["TextDecoder",0,1,"Object","TextDecoder",0],
  ["TextDecoderStream",0,1,"Object","TextDecoderStream",0],
  ["TextEncoder",0,1,"Object","TextEncoder",0],
  ["TextEncoderStream",0,1,"Object","TextEncoderStream",0],
  ["TextEvent",0,0,"UIEvent","",0],
  ["TextFormat",0,1,"Object","TextFormat",0],
  ["TextFormatUpdateEvent",0,2,"Event","",1],
  ["TextMetrics",0,0,"Object","",0],
  ["TextTrack",0,0,"EventTarget","",0],
  ["TextTrackCue",0,0,"EventTarget","",0],
  ["TextTrackCueList",0,0,"Object","",0],
  ["TextTrackList",0,0,"EventTarget","",0],
  ["TextUpdateEvent",0,2,"Event","",1],
  ["TimeRanges",0,0,"Object","",0],
  ["TimelineTrigger",0,1,"AnimationTrigger","TimelineTrigger",0],
  ["TimelineTriggerRange",0,0,"Object","",0],
  ["TimelineTriggerRangeList",0,0,"Object","",0],
  ["ToggleEvent",0,2,"Event","",1],
  ["Touch",0,2,"Object","",1],
  ["TouchEvent",0,2,"UIEvent","",1],
  ["TouchList",0,0,"Object","",0],
  ["TrackEvent",0,2,"Event","",1],
  ["TransformStream",0,1,"Object","TransformStream",0],
  ["TransformStreamDefaultController",0,0,"Object","",0],
  ["TransitionEvent",0,2,"Event","",1],
  ["Translator",0,0,"Object","",0],
  ["TreeWalker",0,0,"Object","",0],
  ["TrustedHTML",0,0,"Object","",0],
  ["TrustedScript",0,0,"Object","",0],
  ["TrustedScriptURL",0,0,"Object","",0],
  ["TrustedTypePolicy",0,0,"Object","",0],
  ["TrustedTypePolicyFactory",0,0,"Object","",0],
  ["TypeError",0,1,"Error","Error",1],
  ["UIEvent",0,2,"Event","",1],
  ["URIError",0,1,"Error","Error",1],
  ["URL",0,2,"Object","",1],
  ["URLPattern",0,1,"Object","URLPattern",0],
  ["URLSearchParams",0,1,"Object","URLSearchParams",0],
  ["USB",0,0,"EventTarget","",0],
  ["USBAlternateInterface",0,3,"Object","",2],
  ["USBConfiguration",0,3,"Object","",2],
  ["USBConnectionEvent",0,3,"Event","",2],
  ["USBDevice",0,0,"Object","",0],
  ["USBEndpoint",0,3,"Object","",3],
  ["USBInTransferResult",0,2,"Object","",1],
  ["USBInterface",0,3,"Object","",2],
  ["USBIsochronousInTransferPacket",0,2,"Object","",1],
  ["USBIsochronousInTransferResult",0,2,"Object","",1],
  ["USBIsochronousOutTransferPacket",0,2,"Object","",1],
  ["USBIsochronousOutTransferResult",0,2,"Object","",1],
  ["USBOutTransferResult",0,2,"Object","",1],
  ["Uint16Array",0,1,"TypedArray","Uint16Array",3],
  ["Uint32Array",0,1,"TypedArray","Uint32Array",3],
  ["Uint8Array",0,1,"TypedArray","Uint8Array",3],
  ["Uint8ClampedArray",0,1,"TypedArray","Uint8ClampedArray",3],
  ["UserActivation",0,0,"Object","",0],
  ["VTTCue",0,3,"TextTrackCue","",3],
  ["ValidityState",0,0,"Object","",0],
  ["VideoColorSpace",0,1,"Object","VideoColorSpace",0],
  ["VideoDecoder",0,2,"EventTarget","",1],
  ["VideoEncoder",0,2,"EventTarget","",1],
  ["VideoFrame",0,2,"Object","",1],
  ["VideoPlaybackQuality",0,0,"Object","",0],
  ["ViewTimeline",0,1,"ScrollTimeline","ViewTimeline",0],
  ["ViewTransition",0,0,"Object","",0],
  ["ViewTransitionTypeSet",0,0,"Object","",0],
  ["Viewport",0,0,"Object","",0],
  ["VirtualKeyboard",0,0,"EventTarget","",0],
  ["VirtualKeyboardGeometryChangeEvent",0,2,"Event","",1],
  ["VisibilityStateEntry",0,0,"PerformanceEntry","",0],
  ["VisualViewport",0,0,"EventTarget","",0],
  ["WGSLLanguageFeatures",0,0,"Object","",0],
  ["WakeLock",0,0,"Object","",0],
  ["WakeLockSentinel",0,0,"EventTarget","",0],
  ["WaveShaperNode",0,2,"AudioNode","",1],
  ["WeakMap",0,1,"Object","WeakMap",0],
  ["WeakRef",0,4,"Object","",1],
  ["WeakSet",0,1,"Object","WeakSet",0],
  ["WebAssembly",1,9,"Object","WebAssembly",0],
  ["WebGL2RenderingContext",0,0,"Object","",0],
  ["WebGLActiveInfo",0,0,"Object","",0],
  ["WebGLBuffer",0,0,"WebGLObject","",0],
  ["WebGLContextEvent",0,2,"Event","",1],
  ["WebGLFramebuffer",0,0,"WebGLObject","",0],
  ["WebGLObject",0,0,"Object","",0],
  ["WebGLProgram",0,0,"WebGLObject","",0],
  ["WebGLQuery",0,0,"WebGLObject","",0],
  ["WebGLRenderbuffer",0,0,"WebGLObject","",0],
  ["WebGLRenderingContext",0,0,"Object","",0],
  ["WebGLSampler",0,0,"WebGLObject","",0],
  ["WebGLShader",0,0,"WebGLObject","",0],
  ["WebGLShaderPrecisionFormat",0,0,"Object","",0],
  ["WebGLSync",0,0,"WebGLObject","",0],
  ["WebGLTexture",0,0,"WebGLObject","",0],
  ["WebGLTransformFeedback",0,0,"WebGLObject","",0],
  ["WebGLUniformLocation",0,0,"Object","",0],
  ["WebGLVertexArrayObject",0,0,"WebGLObject","",0],
  ["WebKitCSSMatrix",0,1,"DOMMatrixReadOnly","DOMMatrix",0],
  ["WebKitMutationObserver",0,2,"Object","",1],
  ["WebSocket",0,2,"EventTarget","",1],
  ["WebSocketError",0,1,"DOMException","WebSocketError",0],
  ["WebSocketStream",0,2,"Object","",1],
  ["WebTransport",0,2,"Object","",1],
  ["WebTransportBidirectionalStream",0,0,"Object","",0],
  ["WebTransportDatagramDuplexStream",0,0,"Object","",0],
  ["WebTransportError",0,1,"DOMException","WebTransportError",0],
  ["WheelEvent",0,2,"MouseEvent","",1],
  ["Window",0,0,"EventTarget","",0],
  ["WindowControlsOverlay",0,0,"EventTarget","",0],
  ["WindowControlsOverlayGeometryChangeEvent",0,4,"Event","",2],
  ["Worker",0,2,"EventTarget","",1],
  ["Worklet",0,0,"Object","",0],
  ["WritableStream",0,1,"Object","WritableStream",0],
  ["WritableStreamDefaultController",0,0,"Object","",0],
  ["WritableStreamDefaultWriter",0,2,"Object","",1],
  ["XMLDocument",0,0,"Document","",0],
  ["XMLHttpRequest",0,1,"XMLHttpRequestEventTarget","XMLHttpRequest",0],
  ["XMLHttpRequestEventTarget",0,0,"EventTarget","",0],
  ["XMLHttpRequestUpload",0,0,"XMLHttpRequestEventTarget","",0],
  ["XMLSerializer",0,1,"Object","XMLSerializer",0],
  ["XSLTProcessor",0,1,"Object","XSLTProcessor",0],
  ["XPathEvaluator",0,1,"Object","XPathEvaluator",0],
  ["XPathExpression",0,0,"Object","",0],
  ["XPathResult",0,0,"Object","",0],
  ["XRAnchor",0,0,"Object","",0],
  ["XRAnchorSet",0,0,"Object","",0],
  ["XRBoundedReferenceSpace",0,0,"XRReferenceSpace","",0],
  ["XRCPUDepthInformation",0,0,"XRDepthInformation","",0],
  ["XRCamera",0,0,"Object","",0],
  ["XRCompositionLayer",0,0,"XRLayer","",0],
  ["XRCubeLayer",0,0,"XRCompositionLayer","",0],
  ["XRCylinderLayer",0,0,"XRCompositionLayer","",0],
  ["XRDOMOverlayState",0,0,"Object","",0],
  ["XRDepthInformation",0,0,"Object","",0],
  ["XREquirectLayer",0,0,"XRCompositionLayer","",0],
  ["XRFrame",0,0,"Object","",0],
  ["XRHand",0,0,"Object","",0],
  ["XRHitTestResult",0,0,"Object","",0],
  ["XRHitTestSource",0,0,"Object","",0],
  ["XRInputSource",0,0,"Object","",0],
  ["XRInputSourceArray",0,0,"Object","",0],
  ["XRInputSourceEvent",0,3,"Event","",2],
  ["XRInputSourcesChangeEvent",0,3,"Event","",2],
  ["XRJointPose",0,0,"XRPose","",0],
  ["XRJointSpace",0,0,"XRSpace","",0],
  ["XRLayer",0,0,"EventTarget","",0],
  ["XRLayerEvent",0,3,"Event","",2],
  ["XRLightEstimate",0,0,"Object","",0],
  ["XRLightProbe",0,0,"EventTarget","",0],
  ["XRPlane",0,0,"Object","",0],
  ["XRPlaneSet",0,0,"Object","",0],
  ["XRPose",0,0,"Object","",0],
  ["XRProjectionLayer",0,0,"XRCompositionLayer","",0],
  ["XRQuadLayer",0,0,"XRCompositionLayer","",0],
  ["XRRay",0,1,"Object","XRRay",0],
  ["XRReferenceSpace",0,0,"XRSpace","",0],
  ["XRReferenceSpaceEvent",0,3,"Event","",2],
  ["XRRenderState",0,0,"Object","",0],
  ["XRRigidTransform",0,1,"Object","XRRigidTransform",0],
  ["XRSession",0,0,"EventTarget","",0],
  ["XRSessionEvent",0,3,"Event","",2],
  ["XRSpace",0,0,"EventTarget","",0],
  ["XRSubImage",0,0,"Object","",0],
  ["XRSystem",0,0,"EventTarget","",0],
  ["XRTransientInputHitTestResult",0,0,"Object","",0],
  ["XRTransientInputHitTestSource",0,0,"Object","",0],
  ["XRView",0,0,"Object","",0],
  ["XRViewerPose",0,0,"XRPose","",0],
  ["XRViewport",0,0,"Object","",0],
  ["XRVisibilityMaskChangeEvent",0,3,"Event","",2],
  ["XRWebGLBinding",0,3,"Object","",2],
  ["XRWebGLDepthInformation",0,0,"XRDepthInformation","",0],
  ["XRWebGLLayer",0,3,"XRLayer","",2],
  ["XRWebGLSubImage",0,0,"XRSubImage","",0],
  ["alert",0,4,"no-proto","",0],
  ["atob",0,4,"no-proto","",1],
  ["blur",0,4,"no-proto","",0],
  ["btoa",0,4,"no-proto","",1],
  ["cancelAnimationFrame",0,4,"no-proto","",1],
  ["cancelIdleCallback",0,4,"no-proto","",1],
  ["captureEvents",0,4,"no-proto","",0],
  ["chrome",1,9,"Object","Object",0],
  ["clearInterval",0,4,"no-proto","",0],
  ["clearTimeout",0,4,"no-proto","",0],
  ["close",0,4,"no-proto","",0],
  ["confirm",0,4,"no-proto","",0],
  ["console",1,9,"Object","console",0],
  ["createImageBitmap",0,4,"no-proto","",1],
  ["decodeURI",0,4,"no-proto","",1],
  ["decodeURIComponent",0,4,"no-proto","",1],
  ["encodeURI",0,4,"no-proto","",1],
  ["encodeURIComponent",0,4,"no-proto","",1],
  ["escape",0,4,"no-proto","",1],
  ["eval",0,4,"no-proto","",1],
  ["fetch",0,4,"no-proto","",1],
  ["fetchLater",0,4,"no-proto","",1],
  ["find",0,4,"no-proto","",0],
  ["focus",0,4,"no-proto","",0],
  ["getComputedStyle",0,4,"no-proto","",1],
  ["getScreenDetails",0,4,"no-proto","",0],
  ["getSelection",0,4,"no-proto","",0],
  ["globalThis",1,9,"Object","Window",0],
  ["isFinite",0,4,"no-proto","",1],
  ["isNaN",0,4,"no-proto","",1],
  ["matchMedia",0,4,"no-proto","",1],
  ["moveBy",0,4,"no-proto","",2],
  ["moveTo",0,4,"no-proto","",2],
  ["open",0,4,"no-proto","",0],
  ["parseFloat",0,4,"no-proto","",1],
  ["parseInt",0,4,"no-proto","",2],
  ["postMessage",0,4,"no-proto","",1],
  ["print",0,4,"no-proto","",0],
  ["prompt",0,4,"no-proto","",0],
  ["queryLocalFonts",0,4,"no-proto","",0],
  ["queueMicrotask",0,4,"no-proto","",1],
  ["releaseEvents",0,4,"no-proto","",0],
  ["reportError",0,4,"no-proto","",1],
  ["requestAnimationFrame",0,4,"no-proto","",1],
  ["requestIdleCallback",0,4,"no-proto","",1],
  ["resizeBy",0,4,"no-proto","",2],
  ["resizeTo",0,4,"no-proto","",2],
  ["scroll",0,4,"no-proto","",0],
  ["scrollBy",0,4,"no-proto","",0],
  ["scrollTo",0,4,"no-proto","",0],
  ["setInterval",0,4,"no-proto","",1],
  ["setTimeout",0,4,"no-proto","",1],
  ["showDirectoryPicker",0,4,"no-proto","",0],
  ["showOpenFilePicker",0,4,"no-proto","",0],
  ["showSaveFilePicker",0,4,"no-proto","",0],
  ["stop",0,4,"no-proto","",0],
  ["structuredClone",0,4,"no-proto","",1],
  ["unescape",0,4,"no-proto","",1],
  ["webkitCancelAnimationFrame",0,4,"no-proto","",1],
  ["webkitMediaStream",0,1,"EventTarget","MediaStream",0],
  ["webkitRTCPeerConnection",0,1,"EventTarget","RTCPeerConnection",0],
  ["webkitRequestAnimationFrame",0,4,"no-proto","",1],
  ["webkitRequestFileSystem",0,4,"no-proto","",3],
  ["webkitResolveLocalFileSystemURL",0,4,"no-proto","",2],
  ["webkitSpeechGrammar",0,1,"Object","SpeechGrammar",0],
  ["webkitSpeechGrammarList",0,1,"Object","SpeechGrammarList",0],
  ["webkitSpeechRecognition",0,1,"EventTarget","SpeechRecognition",0],
  ["webkitSpeechRecognitionError",0,2,"Event","",1],
  ["webkitSpeechRecognitionEvent",0,2,"Event","",1],
  ["webkitURL",0,2,"Object","",1],
];
const _chromeCtorMessages = {
  "AggregateError": "undefined is not iterable (cannot read property Symbol(Symbol.iterator))",
  "BigInt": "BigInt is not a constructor",
  "CSSMathMax": "Failed to construct 'CSSMathMax': Arguments can't be empty",
  "CSSMathMin": "Failed to construct 'CSSMathMin': Arguments can't be empty",
  "CSSMathProduct": "Failed to construct 'CSSMathProduct': Arguments can't be empty",
  "CSSMathSum": "Failed to construct 'CSSMathSum': Arguments can't be empty",
  "ContentVisibilityAutoStateChangeEvent": "Failed to construct 'ContentVisibilityAutoStateChangeEvent': 1 argument required, but only 0 present",
  "DataView": "First argument to DataView constructor must be an ArrayBuffer",
  "FinalizationRegistry": "FinalizationRegistry: cleanup must be callable",
  "Iterator": "Abstract class Iterator not directly constructable",
  "NodeFilter": "function NodeFilter() { [native code] } is not a constructor",
  "PresentationConnectionAvailableEvent": "Failed to construct 'PresentationConnectionAvailableEvent': 2 arguments required, but only 0 present",
  "Promise": "Promise resolver undefined is not a function",
  "Proxy": "Cannot create proxy with a non-object as target or handler",
  "RTCIceCandidate": "Failed to construct 'RTCIceCandidate': sdpMid and sdpMLineIndex are both null.",
  "Symbol": "Symbol is not a constructor",
  "WeakRef": "WeakRef: invalid target",
  "WindowControlsOverlayGeometryChangeEvent": "Failed to construct 'WindowControlsOverlayGeometryChangeEvent': 2 arguments required, but only 0 pre",
  "alert": "function alert() { [native code] } is not a constructor",
  "atob": "function atob() { [native code] } is not a constructor",
  "blur": "function blur() { [native code] } is not a constructor",
  "btoa": "function btoa() { [native code] } is not a constructor",
  "cancelAnimationFrame": "function cancelAnimationFrame() { [native code] } is not a constructor",
  "cancelIdleCallback": "function cancelIdleCallback() { [native code] } is not a constructor",
  "captureEvents": "function captureEvents() { [native code] } is not a constructor",
  "clearInterval": "function clearInterval() { [native code] } is not a constructor",
  "clearTimeout": "function clearTimeout() { [native code] } is not a constructor",
  "close": "function close() { [native code] } is not a constructor",
  "confirm": "function confirm() { [native code] } is not a constructor",
  "createImageBitmap": "function createImageBitmap() { [native code] } is not a constructor",
  "decodeURI": "function decodeURI() { [native code] } is not a constructor",
  "decodeURIComponent": "function decodeURIComponent() { [native code] } is not a constructor",
  "encodeURI": "function encodeURI() { [native code] } is not a constructor",
  "encodeURIComponent": "function encodeURIComponent() { [native code] } is not a constructor",
  "escape": "function escape() { [native code] } is not a constructor",
  "eval": "function eval() { [native code] } is not a constructor",
  "fetch": "function fetch() { [native code] } is not a constructor",
  "fetchLater": "function fetchLater() { [native code] } is not a constructor",
  "find": "function find() { [native code] } is not a constructor",
  "focus": "function focus() { [native code] } is not a constructor",
  "getComputedStyle": "function getComputedStyle() { [native code] } is not a constructor",
  "getScreenDetails": "function getScreenDetails() { [native code] } is not a constructor",
  "getSelection": "function getSelection() { [native code] } is not a constructor",
  "isFinite": "function isFinite() { [native code] } is not a constructor",
  "isNaN": "function isNaN() { [native code] } is not a constructor",
  "matchMedia": "function matchMedia() { [native code] } is not a constructor",
  "moveBy": "function moveBy() { [native code] } is not a constructor",
  "moveTo": "function moveTo() { [native code] } is not a constructor",
  "open": "function open() { [native code] } is not a constructor",
  "parseFloat": "function parseFloat() { [native code] } is not a constructor",
  "parseInt": "function parseInt() { [native code] } is not a constructor",
  "postMessage": "function postMessage() { [native code] } is not a constructor",
  "print": "function print() { [native code] } is not a constructor",
  "prompt": "function prompt() { [native code] } is not a constructor",
  "queryLocalFonts": "function queryLocalFonts() { [native code] } is not a constructor",
  "queueMicrotask": "function queueMicrotask() { [native code] } is not a constructor",
  "releaseEvents": "function releaseEvents() { [native code] } is not a constructor",
  "reportError": "function reportError() { [native code] } is not a constructor",
  "requestAnimationFrame": "function requestAnimationFrame() { [native code] } is not a constructor",
  "requestIdleCallback": "function requestIdleCallback() { [native code] } is not a constructor",
  "resizeBy": "function resizeBy() { [native code] } is not a constructor",
  "resizeTo": "function resizeTo() { [native code] } is not a constructor",
  "scroll": "function scroll() { [native code] } is not a constructor",
  "scrollBy": "function scrollBy() { [native code] } is not a constructor",
  "scrollTo": "function scrollTo() { [native code] } is not a constructor",
  "setInterval": "function setInterval() { [native code] } is not a constructor",
  "setTimeout": "function setTimeout() { [native code] } is not a constructor",
  "showDirectoryPicker": "function showDirectoryPicker() { [native code] } is not a constructor",
  "showOpenFilePicker": "function showOpenFilePicker() { [native code] } is not a constructor",
  "showSaveFilePicker": "function showSaveFilePicker() { [native code] } is not a constructor",
  "stop": "function stop() { [native code] } is not a constructor",
  "structuredClone": "function structuredClone() { [native code] } is not a constructor",
  "unescape": "function unescape() { [native code] } is not a constructor",
  "webkitCancelAnimationFrame": "function webkitCancelAnimationFrame() { [native code] } is not a constructor",
  "webkitRequestAnimationFrame": "function webkitRequestAnimationFrame() { [native code] } is not a constructor",
  "webkitRequestFileSystem": "function webkitRequestFileSystem() { [native code] } is not a constructor",
  "webkitResolveLocalFileSystemURL": "function webkitResolveLocalFileSystemURL() { [native code] } is not a constructor",
};
// [name, isObject] for the navigator members the challenge probes.
const _chromeNavigatorTable = [
  ["adAuctionComponents", 0],
  ["bluetooth", 1],
  ["canLoadAdAuctionFencedFrame", 0],
  ["canShare", 0],
  ["clearAppBadge", 0],
  ["clearOriginJoinedAdInterestGroups", 0],
  ["clipboard", 1],
  ["connection", 1],
  ["createAuctionNonce", 0],
  ["credentials", 1],
  ["deprecatedReplaceInURN", 0],
  ["deprecatedURNToURL", 0],
  ["devicePosture", 1],
  ["geolocation", 1],
  ["getBattery", 0],
  ["getGamepads", 0],
  ["getInstalledRelatedApps", 0],
  ["getInterestGroupAdAuctionData", 0],
  ["getUserMedia", 0],
  ["gpu", 1],
  ["hid", 1],
  ["ink", 1],
  ["javaEnabled", 0],
  ["joinAdInterestGroup", 0],
  ["keyboard", 1],
  ["leaveAdInterestGroup", 0],
  ["locks", 1],
  ["login", 1],
  ["managed", 1],
  ["mediaCapabilities", 1],
  ["mediaDevices", 1],
  ["mediaSession", 1],
  ["mimeTypes", 1],
  ["permissions", 1],
  ["plugins", 1],
  ["presentation", 1],
  ["protectedAudience", 1],
  ["registerProtocolHandler", 0],
  ["requestMIDIAccess", 0],
  ["requestMediaKeySystemAccess", 0],
  ["runAdAuction", 0],
  ["scheduling", 1],
  ["sendBeacon", 0],
  ["serial", 1],
  ["serviceWorker", 1],
  ["setAppBadge", 0],
  ["share", 0],
  ["storage", 1],
  ["storageBuckets", 1],
  ["unregisterProtocolHandler", 0],
  ["updateAdInterestGroups", 0],
  ["usb", 1],
  ["userActivation", 1],
  ["userAgentData", 1],
  ["vibrate", 0],
  ["virtualKeyboard", 1],
  ["wakeLock", 1],
  ["webkitGetUserMedia", 0],
  ["webkitPersistentStorage", 1],
  ["webkitTemporaryStorage", 1],
  ["windowControlsOverlay", 1],
  ["xr", 1],
];

// Install the window-level interface surface a pinned Chrome exposes: the
// constructors, namespace objects and constants this engine has no real
// implementation for. A probe that walks getOwnPropertyNames(window) sees
// them, getOwnPropertyDescriptor sees value/writable like Chrome, and `new`
// answers the same way the capture did (illegal constructor, N-arguments
// TypeError, or a constructible shell). Real implementations always win --
// the typeof guard never shadows RTCPeerConnection, Worker, or anything else
// the engine actually provides.
(function installChromeInterfaceSurface() {
  const ctorMessages = _chromeCtorMessages;
  function argMessage(name, count) {
    return "Failed to construct '" + name + "': " + count + " argument"
      + (count > 1 ? 's' : '') + " required, but only 0 present.";
  }
  const installed = new Set();
  for (let pass = 0; pass < 2; pass++) {
    // Pass 0 installs everything without parent links; pass 1 links
    // prototypes now that the whole surface exists (parents install in name
    // order, so a child may have run before its parent).
    for (const row of _chromeInterfaceTable) {
      const name = row[0], kind = row[1], ctorMode = row[2];
      // V8/deno install the ES globals themselves. In the snapshot-baking
      // context some (WebAssembly, Temporal) are still undefined, so the
      // typeof guard would let a shell through that then collides with the
      // runtime's real registration.
      if (_ecmaScriptGlobals && _ecmaScriptGlobals.has(name)) continue;
      // V8 installs these lazily: they are absent from both the snapshot-time
      // capture above and the baking context, so a shell would slip past the
      // guards and collide with the runtime's real registration.
      if (name === 'WebAssembly' || name === 'Temporal' || name === 'Float16Array'
          || name === 'Iterator' || name === 'DisposableStack'
          || name === 'AsyncDisposableStack' || name === 'SuppressedError') continue;
      const protoParent = row[3], tag = row[4], fnLength = row[5];
      if (kind === 1) {
        if (pass || typeof globalThis[name] !== 'undefined') continue;
        const object = {};
        Object.defineProperty(object, Symbol.toStringTag,
          { value: tag || name, configurable: true });
        Object.defineProperty(globalThis, name,
          { value: object, writable: true, enumerable: false, configurable: true });
        continue;
      }
      if (pass === 0) {
        if (typeof globalThis[name] !== 'undefined') continue;
        let ctor;
        if (protoParent === 'no-proto') {
          // Arrow functions keep window methods non-constructible. Methods
          // with optional arguments must still accept a normal zero-argument
          // call after feature detection succeeds.
          if (name === 'find') {
            ctor = () => false;
          } else if (name === 'captureEvents' || name === 'releaseEvents') {
            ctor = () => undefined;
          } else if (name === 'showDirectoryPicker' || name === 'showOpenFilePicker'
              || name === 'showSaveFilePicker' || name === 'queryLocalFonts'
              || name === 'getScreenDetails') {
            ctor = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
          } else {
            ctor = () => { throw new TypeError(argMessage(name, 1)); };
          }
        } else if (ctorMode === 0) {
          ctor = function() {
            throw new TypeError("Failed to construct '" + name + "': Illegal constructor");
          };
        } else if (ctorMode === 1) {
          ctor = function() { return Object.create(ctor.prototype); };
        } else if (ctorMode === 2 || ctorMode === 3) {
          const count = ctorMode === 2 ? 1 : 2;
          ctor = function() { throw new TypeError(argMessage(name, count)); };
        } else {
          const message = ctorMessages[name] || "Failed to construct '" + name + "'.";
          ctor = function() { throw new TypeError(message); };
        }
        if (protoParent !== 'no-proto') {
          Object.defineProperty(ctor.prototype, Symbol.toStringTag,
            { value: tag || name, configurable: true });
        }
        Object.defineProperty(ctor, 'name', { value: name, configurable: true });
        if (Number.isFinite(fnLength)) {
          Object.defineProperty(ctor, 'length', { value: fnLength, configurable: true });
        }
        Object.defineProperty(globalThis, name,
          { value: ctor, writable: true, enumerable: false, configurable: true });
        _markNative(ctor);
        installed.add(name);
      } else if (installed.has(name)
          && protoParent !== 'no-proto' && protoParent !== 'Object') {
        const parent = globalThis[protoParent];
        if (parent && parent.prototype
            && Object.getPrototypeOf(globalThis[name].prototype) !== parent.prototype) {
          try { Object.setPrototypeOf(globalThis[name].prototype, parent.prototype); } catch (_e) {}
        }
      }
    }
  }
  // Namespace/accessor objects the table's own kinds cannot express.
  if (typeof globalThis.clientInformation === 'undefined') {
    Object.defineProperty(globalThis, 'clientInformation',
      { get() { return globalThis.navigator; }, enumerable: true, configurable: true });
  }
  for (const name of ['cookieStore', 'crashReport', 'documentPictureInPicture',
                      'sharedStorage', 'viewport', 'launchQueue']) {
    if (typeof globalThis[name] !== 'undefined') continue;
    const object = {};
    Object.defineProperty(object, Symbol.toStringTag,
      { value: { cookieStore: 'CookieStore', crashReport: 'CrashReportedDetails',
                 documentPictureInPicture: 'DocumentPictureInPicture',
                 viewport: 'Viewport',
                 launchQueue: 'LaunchQueue' }[name], configurable: true });
    Object.defineProperty(globalThis, name,
      { value: object, writable: true, enumerable: false, configurable: true });
  }
})();

// A handful of Chrome 152 interfaces are exposed even though their concrete
// implementations are internal-only. Keep their public prototype shape so
// feature probes see the same constructors and WebIDL members.
(function installLongTailInterfaceMembers() {
  const method = (proto, name, length, fn) => {
    const value = _markNative(fn || function() {});
    try { Object.defineProperty(value, 'length', { value: length, configurable: true }); } catch (_e) {}
    Object.defineProperty(proto, name, {
      value, writable: true, enumerable: true, configurable: true,
    });
  };
  const getter = (proto, name) => {
    const get = _markNativeAs(
      function() { throw new TypeError('Illegal invocation'); },
      'function get ' + name + '() { [native code] }',
    );
    Object.defineProperty(proto, name, {
      get, set: undefined, enumerable: true, configurable: true,
    });
  };
  if (typeof XSLTProcessor === 'function') {
    const proto = XSLTProcessor.prototype;
    method(proto, 'clearParameters', 0, function clearParameters() {});
    method(proto, 'getParameter', 2, function getParameter() {});
    method(proto, 'importStylesheet', 1, function importStylesheet() {});
    method(proto, 'removeParameter', 2, function removeParameter() {});
    method(proto, 'reset', 0, function reset() {});
    method(proto, 'setParameter', 3, function setParameter() {});
    method(proto, 'transformToDocument', 1, function transformToDocument() {});
    method(proto, 'transformToFragment', 2, function transformToFragment() {});
  }
  if (typeof HTMLUserMediaElement === 'function') {
    const proto = HTMLUserMediaElement.prototype;
    for (const name of ['error', 'onstream', 'oncancel', 'onerror', 'stream']) getter(proto, name);
    method(proto, 'setConstraints', 0, function setConstraints() {});
  }
  if (typeof InteractionContentfulPaint === 'function') {
    const proto = InteractionContentfulPaint.prototype;
    getter(proto, 'largestContentfulPaint');
    getter(proto, 'interactionId');
    method(proto, 'toJSON', 0, function toJSON() { return {}; });
    getter(proto, 'paintTime');
    getter(proto, 'presentationTime');
  }
  if (typeof PerformanceSoftNavigation === 'function') {
    const proto = PerformanceSoftNavigation.prototype;
    getter(proto, 'navigationType');
    getter(proto, 'interactionId');
    method(proto, 'getLargestInteractionContentfulPaint', 0,
      function getLargestInteractionContentfulPaint() {});
    getter(proto, 'paintTime');
    getter(proto, 'presentationTime');
  }
  if (typeof NodeRange === 'function') {
    const proto = NodeRange.prototype;
    getter(proto, 'startContainer');
    getter(proto, 'endContainer');
  }
  if (typeof OpaqueRange === 'function') {
    const proto = OpaqueRange.prototype;
    method(proto, 'disconnect', 0, function disconnect() {});
    method(proto, 'getBoundingClientRect', 0, function getBoundingClientRect() {});
    method(proto, 'getClientRects', 0, function getClientRects() {});
  }
})();

// Permissions are realm-sensitive: a cross-origin iframe does not inherit
// the top document's prompt state unless every boundary delegates the feature.
// Keep the public objects branded and slot-backed like Chromium rather than
// returning plain records from query().
(function installPermissions() {
  if (typeof Permissions !== 'function' || typeof PermissionStatus !== 'function') return;
  const statusState = new WeakMap();
  const permissions = globalThis.navigator.permissions;
  if (!permissions) return;

  const status = value => {
    const state = statusState.get(value);
    if (!state) throw new TypeError('Illegal invocation');
    return state;
  };
  const nameGetter = _markNative(function name() { return status(this).name; });
  const stateGetter = _markNative(function state() { return status(this).state; });
  const onchangeGetter = _markNative(function onchange() { return status(this).onchange; });
  const onchangeSetter = _markNative(function onchange(value) {
    status(this).onchange = typeof value === 'function' ? value : null;
  });
  const statusConstructor = Object.getOwnPropertyDescriptor(
    PermissionStatus.prototype, 'constructor');
  delete PermissionStatus.prototype.constructor;
  Object.defineProperties(PermissionStatus.prototype, {
    name: { get: nameGetter, set: undefined, enumerable: true, configurable: true },
    state: { get: stateGetter, set: undefined, enumerable: true, configurable: true },
    onchange: { get: onchangeGetter, set: onchangeSetter, enumerable: true, configurable: true },
  });
  if (statusConstructor) Object.defineProperty(
    PermissionStatus.prototype, 'constructor', statusConstructor);

  const query = _markNative(function query(descriptor) {
    if (arguments.length === 0) {
      return Promise.reject(new TypeError(
        "Failed to execute 'query' on 'Permissions': 1 argument required, but only 0 present."));
    }
    const name = descriptor && descriptor.name;
    const result = Object.create(PermissionStatus.prototype);
    statusState.set(result, {
      name: _permissionStatusName(name), state: _permissionState(name), onchange: null,
    });
    return Promise.resolve(result);
  });
  const permissionsConstructor = Object.getOwnPropertyDescriptor(
    Permissions.prototype, 'constructor');
  delete Permissions.prototype.constructor;
  Object.defineProperty(Permissions.prototype, 'query',
    { value: query, writable: true, enumerable: true, configurable: true });
  if (permissionsConstructor) Object.defineProperty(
    Permissions.prototype, 'constructor', permissionsConstructor);
  delete permissions.query;
  Object.setPrototypeOf(permissions, Permissions.prototype);

  Object.defineProperty(Notification, 'permission', {
    get: _markNative(function permission() {
      return _permissionPolicyAllows('notifications') ? 'default' : 'denied';
    }),
    set: undefined,
    enumerable: true,
    configurable: true,
  });
})();

// StorageManager and the origin-private file system. The backing graph is
// page/realm-local and never touches the host filesystem; it exists to provide
// the durable browser object model and API semantics pages observe.
(function installOriginPrivateFileSystem() {
  if (typeof StorageManager !== 'function'
      || typeof FileSystemHandle !== 'function'
      || typeof FileSystemDirectoryHandle !== 'function'
      || typeof FileSystemFileHandle !== 'function') return;

  const storageState = new WeakSet();
  const handleState = new WeakMap();
  const writableState = new WeakMap();
  const rootNode = { kind: 'directory', name: '', parent: null, children: new Map() };
  const manager = Object.create(StorageManager.prototype);
  storageState.add(manager);

  const requireStorage = value => {
    if (!storageState.has(value)) throw new TypeError('Illegal invocation');
  };
  const requireHandle = value => {
    const state = handleState.get(value);
    if (!state) throw new TypeError('Illegal invocation');
    return state;
  };
  const requireDirectory = value => {
    const state = requireHandle(value);
    if (state.node.kind !== 'directory') throw new TypeError('Illegal invocation');
    return state;
  };
  const validName = value => {
    const name = String(value);
    if (!name || name === '.' || name === '..' || name.includes('/')) {
      throw new TypeError('Name is not allowed.');
    }
    return name;
  };
  const method = (prototype, name, fn, length = fn.length) => {
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
    Object.defineProperty(fn, 'length', { value: length, configurable: true });
    _markNative(fn);
    Object.defineProperty(prototype, name, {
      value: fn, writable: true, enumerable: true, configurable: true,
    });
  };
  const getter = (prototype, name, fn) => {
    Object.defineProperty(fn, 'name', { value: 'get ' + name, configurable: true });
    Object.defineProperty(prototype, name, {
      get: _markNativeAs(fn, 'function get ' + name + '() { [native code] }'),
      set: undefined, enumerable: true, configurable: true,
    });
  };
  const makeHandle = node => {
    const prototype = node.kind === 'directory'
      ? FileSystemDirectoryHandle.prototype : FileSystemFileHandle.prototype;
    const handle = Object.create(prototype);
    handleState.set(handle, { node });
    return handle;
  };
  const rootHandle = makeHandle(rootNode);

  method(StorageManager.prototype, 'estimate', async function estimate() {
    requireStorage(this);
    // Chrome grants a share of free disk under a per-origin cap; the reference
    // capture reports 10 GiB (10737418240) from a worker realm exactly like this
    // one, where a flat 5 GB is a value no browser produces. This realm and the
    // document realm must answer alike: one origin reporting two quotas is its
    // own tell, so both read the same constant.
    return { quota: 10737418240, usage: 0, usageDetails: {} };
  }, 0);
  method(StorageManager.prototype, 'persisted', async function persisted() {
    requireStorage(this); return false;
  }, 0);
  method(StorageManager.prototype, 'getDirectory', async function getDirectory() {
    requireStorage(this); return rootHandle;
  }, 0);
  method(StorageManager.prototype, 'persist', async function persist() {
    requireStorage(this); return false;
  }, 0);

  getter(FileSystemHandle.prototype, 'kind', function kind() {
    return requireHandle(this).node.kind;
  });
  getter(FileSystemHandle.prototype, 'name', function name() {
    return requireHandle(this).node.name;
  });
  method(FileSystemHandle.prototype, 'isSameEntry', async function isSameEntry(other) {
    const left = requireHandle(this).node;
    const right = requireHandle(other).node;
    return left === right;
  }, 1);
  method(FileSystemHandle.prototype, 'queryPermission', async function queryPermission() {
    requireHandle(this); return 'granted';
  }, 0);
  method(FileSystemHandle.prototype, 'requestPermission', async function requestPermission() {
    requireHandle(this); return 'granted';
  }, 0);
  method(FileSystemHandle.prototype, 'remove', async function remove(options = undefined) {
    const node = requireHandle(this).node;
    if (!node.parent) throw new DOMException('The root directory cannot be removed.', 'InvalidModificationError');
    if (node.kind === 'directory' && node.children.size
        && !(options && options.recursive === true)) {
      throw new DOMException('The directory is not empty.', 'InvalidModificationError');
    }
    node.parent.children.delete(node.name);
  }, 0);

  const child = (directory, name, kind, options) => {
    name = validName(name);
    const state = requireDirectory(directory);
    let node = state.node.children.get(name);
    if (node && node.kind !== kind) {
      throw new DOMException('A handle of a different kind exists.', 'TypeMismatchError');
    }
    if (!node) {
      if (!(options && options.create === true)) {
        throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
      }
      node = kind === 'directory'
        ? { kind, name, parent: state.node, children: new Map() }
        : { kind, name, parent: state.node, bytes: new Uint8Array(0), lastModified: Date.now() };
      state.node.children.set(name, node);
    }
    return makeHandle(node);
  };
  method(FileSystemDirectoryHandle.prototype, 'getDirectoryHandle', async function getDirectoryHandle(name, options = undefined) {
    return child(this, name, 'directory', options);
  }, 1);
  method(FileSystemDirectoryHandle.prototype, 'getFileHandle', async function getFileHandle(name, options = undefined) {
    return child(this, name, 'file', options);
  }, 1);
  method(FileSystemDirectoryHandle.prototype, 'removeEntry', async function removeEntry(name, options = undefined) {
    name = validName(name);
    const directory = requireDirectory(this).node;
    const node = directory.children.get(name);
    if (!node) throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
    if (node.kind === 'directory' && node.children.size
        && !(options && options.recursive === true)) {
      throw new DOMException('The directory is not empty.', 'InvalidModificationError');
    }
    directory.children.delete(name);
  }, 1);
  method(FileSystemDirectoryHandle.prototype, 'resolve', async function resolve(possibleDescendant) {
    const directory = requireDirectory(this).node;
    let node = requireHandle(possibleDescendant).node;
    const path = [];
    while (node && node !== directory) { path.unshift(node.name); node = node.parent; }
    return node === directory ? path : null;
  }, 1);
  const directoryIterator = (directory, mode) => {
    const entries = Array.from(requireDirectory(directory).node.children.entries());
    let index = 0;
    return {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (index >= entries.length) return Promise.resolve({ value: undefined, done: true });
        const [name, node] = entries[index++];
        const handle = makeHandle(node);
        return Promise.resolve({
          value: mode === 'keys' ? name : mode === 'values' ? handle : [name, handle],
          done: false,
        });
      },
    };
  };
  method(FileSystemDirectoryHandle.prototype, 'entries', function entries() {
    return directoryIterator(this, 'entries');
  }, 0);
  method(FileSystemDirectoryHandle.prototype, 'keys', function keys() {
    return directoryIterator(this, 'keys');
  }, 0);
  method(FileSystemDirectoryHandle.prototype, 'values', function values() {
    return directoryIterator(this, 'values');
  }, 0);
  Object.defineProperty(FileSystemDirectoryHandle.prototype, Symbol.asyncIterator, {
    value: FileSystemDirectoryHandle.prototype.entries,
    writable: true, enumerable: false, configurable: true,
  });

  method(FileSystemFileHandle.prototype, 'getFile', async function getFile() {
    const node = requireHandle(this).node;
    if (node.kind !== 'file') throw new TypeError('Illegal invocation');
    return new File([node.bytes], node.name, {
      type: node.name.toLowerCase().endsWith('.txt') ? 'text/plain' : '',
      lastModified: node.lastModified,
    });
  }, 0);
  method(FileSystemFileHandle.prototype, 'createWritable', async function createWritable() {
    const node = requireHandle(this).node;
    if (node.kind !== 'file') throw new TypeError('Illegal invocation');
    const stream = Object.create(FileSystemWritableFileStream.prototype);
    writableState.set(stream, { node, position: 0, closed: false });
    return stream;
  }, 0);
  method(FileSystemFileHandle.prototype, 'move', async function move(name) {
    const node = requireHandle(this).node;
    if (node.kind !== 'file') throw new TypeError('Illegal invocation');
    name = validName(name);
    if (node.parent) { node.parent.children.delete(node.name); node.name = name; node.parent.children.set(name, node); }
  }, 1);


  if (typeof FileSystemWritableFileStream === 'function') {
    const writable = value => {
      const state = writableState.get(value);
      if (!state || state.closed) throw new TypeError('Illegal invocation');
      return state;
    };
    method(FileSystemWritableFileStream.prototype, 'write', async function write(data) {
      const state = writable(this);
      if (data && typeof data === 'object' && typeof data.type === 'string') {
        if (data.type === 'seek') { state.position = Math.max(0, Number(data.position) || 0); return; }
        if (data.type === 'truncate') {
          const size = Math.max(0, Number(data.size) || 0);
          const next = new Uint8Array(size); next.set(state.node.bytes.subarray(0, size));
          state.node.bytes = next; return;
        }
        if (data.type === 'write') { state.position = Math.max(0, Number(data.position) || 0); data = data.data; }
      }
      const bytes = _blobPartToBytes(data, false);
      const size = Math.max(state.node.bytes.length, state.position + bytes.length);
      const next = new Uint8Array(size); next.set(state.node.bytes); next.set(bytes, state.position);
      state.node.bytes = next; state.position += bytes.length; state.node.lastModified = Date.now();
    }, 1);
    method(FileSystemWritableFileStream.prototype, 'seek', async function seek(position) {
      writable(this).position = Math.max(0, Number(position) || 0);
    }, 1);
    method(FileSystemWritableFileStream.prototype, 'truncate', async function truncate(size) {
      const state = writable(this); size = Math.max(0, Number(size) || 0);
      const next = new Uint8Array(size); next.set(state.node.bytes.subarray(0, size)); state.node.bytes = next;
    }, 1);
    method(FileSystemWritableFileStream.prototype, 'close', async function close() {
      const state = writable(this); state.closed = true;
    }, 0);
  }

  delete globalThis.navigator.storage;
  getter(Navigator.prototype, 'storage', function storage() { return manager; });
})();

// Navigator member -> interface name, for members whose interface name cannot
// be derived from the member name by capitalizing its first letter. That rule
// holds for what a URL and a device list are called and fails for almost
// everything else the capture's navigator carries: acronyms (USB, HID), an XR
// member whose interface is XRSystem, a plural that is not the interface's
// (credentials -> CredentialsContainer, locks -> LockManager, login ->
// NavigatorLogin, managed -> NavigatorManagedData, storageBuckets ->
// StorageBucketManager), and one that shares no prefix at all (userAgentData ->
// NavigatorUAData). Deriving it anyway named an interface that does not exist,
// so the member kept a @@toStringTag invented from its own name --
// `[object Usb]`, `[object Xr]`, `[object WebkitTemporaryStorage]` -- or fell
// all the way back to `[object Object]`. Listing every member here also makes
// this object the one place that names the set the brand pass owns.
// DeprecatedStorageQuota is [LegacyNoInterfaceObject]: neither engine exposes a
// constructor for it, so its prototype is built on demand below.
const _navigatorInterfaceNames = {
  clipboard: 'Clipboard',
  credentials: 'CredentialsContainer',
  geolocation: 'Geolocation',
  hid: 'HID',
  locks: 'LockManager',
  login: 'NavigatorLogin',
  managed: 'NavigatorManagedData',
  storageBuckets: 'StorageBucketManager',
  usb: 'USB',
  userAgentData: 'NavigatorUAData',
  wakeLock: 'WakeLock',
  webkitPersistentStorage: 'DeprecatedStorageQuota',
  webkitTemporaryStorage: 'DeprecatedStorageQuota',
  xr: 'XRSystem',
};
function _navigatorInterfaceName(member) {
  return _navigatorInterfaceNames[member]
    || member.charAt(0).toUpperCase() + member.slice(1);
}

// The capture's declared arity for the members the capability modules
// implemented with a longer parameter list than the IDL has
// (`geolocation.getCurrentPosition` takes an error callback the shim never
// calls; `locks.request` spells out the optional callback). A function's length
// is part of the prototype surface a probe reads, so pin the ones that differ.
const _navigatorMemberLengths = {
  credentials: { store: 1 },
  geolocation: { getCurrentPosition: 1, watchPosition: 1, clearWatch: 1 },
  clipboard: { writeText: 1 },
  locks: { request: 2 },
};

// Navigator members the same capture proves a real Chrome carries. Object
// members return a cached singleton whose prototype is the matching interface
// from the table above when one exists; method members throw Chrome's
// argument TypeError shape, with the boolean/[]-returning handful special
// cased.
(function installChromeNavigatorSurface() {
  const prototype = Object.getPrototypeOf(globalThis.navigator);
  const instances = new Map();
  function interfaceFor(name) {
    const candidate = globalThis[_navigatorInterfaceName(name)];
    return candidate && candidate.prototype ? candidate.prototype : null;
  }
  for (const row of _chromeNavigatorTable) {
    const name = row[0], isObject = row[1];
    try {
      if (typeof globalThis.navigator[name] !== 'undefined') continue;
      if (isObject) {
        if (Object.getOwnPropertyDescriptor(prototype, name)) continue;
        Object.defineProperty(prototype, name, {
          get() {
            if (!instances.has(name)) {
              const proto = interfaceFor(name);
              const object = proto ? Object.create(proto) : {};
              if (!proto) Object.defineProperty(object, Symbol.toStringTag,
                { value: _navigatorInterfaceName(name), configurable: true });
              instances.set(name, object);
            }
            return instances.get(name);
          },
          set: undefined, enumerable: true, configurable: true,
        });
      } else {
        let impl;
        if (name === 'vibrate') {
          impl = function vibrate() { return false; };
        } else if (name === 'getGamepads') {
          impl = function getGamepads() { return [null, null, null, null]; };
        } else if (name === 'javaEnabled') {
          impl = function javaEnabled() { return false; };
        } else if (name === 'getInstalledRelatedApps') {
          impl = function getInstalledRelatedApps() { return Promise.resolve([]); };
        } else if (name === 'clearAppBadge' || name === 'setAppBadge'
            || name === 'updateAdInterestGroups') {
          impl = function() { return Promise.resolve(); };
        } else if (name === 'requestMIDIAccess') {
          impl = function requestMIDIAccess() {
            return Promise.reject(new DOMException('MIDI is not supported', 'NotSupportedError'));
          };
        } else {
          impl = function() {
            throw new TypeError("Failed to execute '" + name
              + "' on 'Navigator': 1 argument required, but only 0 present.");
          };
        }
        _markNative(impl);
        Object.defineProperty(prototype, name,
          { value: impl, writable: true, enumerable: true, configurable: true });
      }
    } catch (_e) {}
  }
})();

// Navigator is a WebIDL interface object: Chrome keeps its exposed members on
// the prototype and has no own string-keyed properties on the instance. The
// initial compatibility object above is convenient for constructing stable
// backing values, but leaving those fields own makes `getOwnPropertyNames`
// expose an engine-specific shape. Move the backing values to the existing
// navigator prototype as native accessors/methods after all late surface
// installers (credentials, keyboard and gpu) have run.
(function moveNavigatorOwnPropertiesToPrototype() {
  const navigatorObject = globalThis.navigator;
  const prototype = Object.getPrototypeOf(navigatorObject);
  for (const name of Object.getOwnPropertyNames(navigatorObject)) {
    const descriptor = Object.getOwnPropertyDescriptor(navigatorObject, name);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    const value = descriptor.value;
    if (!delete navigatorObject[name]) continue;
    if (Object.prototype.hasOwnProperty.call(prototype, name)) continue;
    if (typeof value === 'function') {
      _markNative(value);
      Object.defineProperty(prototype, name, {
        value, writable: true, enumerable: true, configurable: true,
      });
      continue;
    }
    const getter = _markNativeAs(
      function() { return value; },
      'function get ' + name + '() { [native code] }',
    );
    Object.defineProperty(getter, 'name', { value: 'get ' + name, configurable: true });
    Object.defineProperty(prototype, name, {
      get: getter, set: undefined, enumerable: true, configurable: true,
    });
  }
})();

// A navigator object member is a WebIDL interface instance, not a plain object.
// Its prototype is the interface prototype, the IDL operations are that
// prototype's own members, and both `constructor.name` and
// `Object.prototype.toString.call` read the interface identifier off it. The
// capability modules that own each member's behavior built several of them as
// object literals, so `navigator.credentials.constructor.name` answered
// "Object" and `Object.prototype.toString.call(navigator.credentials)`
// answered "[object Object]" where the captured Chrome answers
// "CredentialsContainer" and "[object CredentialsContainer]". That is a
// two-line brand check no shim should fail. Move each backing implementation
// onto its interface prototype and re-point the instance, so the member keeps
// its behavior and gains the Chrome surface around it.
(function installNavigatorInterfaceBrands() {
  const method = (proto, name, length, fn) => {
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
    Object.defineProperty(fn, 'length', { value: length, configurable: true });
    _markNative(fn);
    Object.defineProperty(proto, name, {
      value: fn, writable: true, enumerable: true, configurable: true,
    });
  };
  // Event-handler attributes are nullable per-instance slots, like the
  // BatteryManager accessors above: the value starts at null and only a
  // function assignment is retained.
  const handlerSlots = new WeakMap();
  const handler = (proto, slot) => {
    const get = _markNativeAs(function() {
      const state = handlerSlots.get(this);
      return state && state[slot] ? state[slot] : null;
    }, 'function get ' + slot + '() { [native code] }');
    const set = _markNativeAs(function(value) {
      let state = handlerSlots.get(this);
      if (!state) { state = Object.create(null); handlerSlots.set(this, state); }
      state[slot] = typeof value === 'function' ? value : null;
    }, 'function set ' + slot + '(value) { [native code] }');
    Object.defineProperty(get, 'name', { value: 'get ' + slot, configurable: true });
    Object.defineProperty(set, 'name', { value: 'set ' + slot, configurable: true });
    Object.defineProperty(proto, slot, { get, set, enumerable: true, configurable: true });
  };
  const prototypeFor = name => {
    const ctor = globalThis[name];
    return ctor && ctor.prototype ? ctor.prototype : null;
  };

  // Clipboard: the engine implements readText and writeText; the capture shows
  // read, write and the onclipboardchange handler attribute beside them. The
  // document this engine runs has no clipboard access, and Chrome in that state
  // rejects the promise with "Document is not focused." -- the same answer the
  // capture recorded for the sibling writeText. The binding-level argument
  // check runs first, as it did in the capture.
  const clipboardProto = prototypeFor('Clipboard');
  if (clipboardProto) {
    method(clipboardProto, 'read', 0, function read() {
      return Promise.reject(new DOMException(
        "Failed to execute 'read' on 'Clipboard': Document is not focused.",
        'NotAllowedError'));
    });
    method(clipboardProto, 'write', 1, function write(data) {
      if (arguments.length === 0) {
        return Promise.reject(new TypeError(
          "Failed to execute 'write' on 'Clipboard': 1 argument required,"
          + ' but only 0 present.'));
      }
      return Promise.reject(new DOMException(
        "Failed to execute 'write' on 'Clipboard': Document is not focused.",
        'NotAllowedError'));
    });
    handler(clipboardProto, 'onclipboardchange');
  }

  // USB and HID have no device backend here. The capture shows getDevices
  // resolving with an empty sequence and requestDevice refusing for want of a
  // user gesture.
  for (const deviceInterface of ['USB', 'HID']) {
    const proto = prototypeFor(deviceInterface);
    if (!proto) continue;
    method(proto, 'getDevices', 0, function getDevices() { return Promise.resolve([]); });
    method(proto, 'requestDevice', 1, function requestDevice(options) {
      return Promise.reject(new DOMException(
        "Failed to execute 'requestDevice' on '" + deviceInterface
        + "': Must be handling a user gesture to show a permission request.",
        'SecurityError'));
    });
    handler(proto, 'onconnect');
    handler(proto, 'ondisconnect');
  }

  // XRSystem: no device is ever present, so the session query answers false and
  // the session request refuses exactly the way the capture did.
  const xrProto = prototypeFor('XRSystem');
  if (xrProto) {
    method(xrProto, 'isSessionSupported', 1, function isSessionSupported(mode) {
      if (arguments.length === 0) {
        return Promise.reject(new TypeError(
          "Failed to execute 'isSessionSupported' on 'XRSystem': 1 argument"
          + ' required, but only 0 present.'));
      }
      return Promise.resolve(false);
    });
    method(xrProto, 'requestSession', 1, function requestSession(mode) {
      return Promise.reject(new DOMException(
        "Failed to execute 'requestSession' on 'XRSystem': The requested"
        + ' session requires user activation.',
        'SecurityError'));
    });
    handler(xrProto, 'ondevicechange');
  }

  // NavigatorLogin and NavigatorManagedData back enterprise-managed browser
  // state Obscura has none of; both answer the captured values.
  const loginProto = prototypeFor('NavigatorLogin');
  if (loginProto) {
    method(loginProto, 'setStatus', 1, function setStatus(status) {
      if (arguments.length === 0) {
        return Promise.reject(new TypeError(
          "Failed to execute 'setStatus' on 'NavigatorLogin': 1 argument"
          + ' required, but only 0 present.'));
      }
      return Promise.resolve();
    });
  }
  const managedProto = prototypeFor('NavigatorManagedData');
  if (managedProto) {
    method(managedProto, 'getManagedConfiguration', 1,
      function getManagedConfiguration(keys) {
        if (arguments.length === 0) {
          return Promise.reject(new TypeError(
            "Failed to execute 'getManagedConfiguration' on"
            + " 'NavigatorManagedData': 1 argument required, but only 0"
            + ' present.'));
        }
        return Promise.reject(new DOMException(
          'Managed configuration is empty. This API is available only for'
          + ' managed apps.',
          'NotAllowedError'));
      });
    handler(managedProto, 'onmanagedconfigurationchange');
  }

  // StorageBucketManager: the bucket store is empty, so keys() resolves with no
  // names and delete() resolves without a value. `open` is deliberately left
  // out -- the captured Chrome never settled it on any origin, so neither a
  // resolved nor a rejected behavior could be pinned for it.
  const bucketProto = prototypeFor('StorageBucketManager');
  if (bucketProto) {
    method(bucketProto, 'keys', 0, function keys() { return Promise.resolve([]); });
    method(bucketProto, 'delete', 1, function deleteBucket(name) {
      if (arguments.length === 0) {
        return Promise.reject(new TypeError(
          "Failed to execute 'delete' on 'StorageBucketManager': 1 argument"
          + ' required, but only 0 present.'));
      }
      return Promise.resolve();
    });
  }

  // DeprecatedStorageQuota is [LegacyNoInterfaceObject]: both engines expose it
  // only through the legacy navigator members, and Chrome shares one prototype
  // between the two. Build that prototype so both report
  // "[object DeprecatedStorageQuota]" rather than a name invented from the
  // member name.
  const quotaProto = Object.create(Object.prototype);
  Object.defineProperty(quotaProto, Symbol.toStringTag,
    { value: 'DeprecatedStorageQuota', configurable: true });
  const quotaArgCount = (name, count) =>
    "Failed to execute '" + name + "' on 'DeprecatedStorageQuota': " + count
    + ' argument' + (count > 1 ? 's' : '') + ' required, but only 0 present.';
  method(quotaProto, 'queryUsageAndQuota', 1, function queryUsageAndQuota(successCallback) {
    if (arguments.length === 0) throw new TypeError(quotaArgCount('queryUsageAndQuota', 1));
    // The captured quota is the shared origin quota the capture reported;
    // usage is the same 0 the StorageManager estimate reports.
    if (typeof successCallback === 'function') successCallback(0, 10737418240);
  });
  method(quotaProto, 'requestQuota', 1, function requestQuota(quota) {
    if (arguments.length === 0) throw new TypeError(quotaArgCount('requestQuota', 1));
    return undefined;
  });

  // Chrome reports each interface's own members in IDL declaration order.
  // Property enumeration order is specified, so it is part of what a probe that
  // joins `Object.getOwnPropertyNames` into one string reads back, and the
  // engine's own insertion order is not the capture's. `open` is missing from
  // the StorageBucketManager row for the reason above; a name the order pass
  // cannot find is simply left out, which is what the capture's own list is.
  const memberOrder = {
    Clipboard: ['onclipboardchange', 'read', 'readText', 'write', 'writeText'],
    CredentialsContainer: ['create', 'get', 'preventSilentAccess', 'store'],
    Geolocation: ['clearWatch', 'getCurrentPosition', 'watchPosition'],
    HID: ['onconnect', 'ondisconnect', 'getDevices', 'requestDevice'],
    LockManager: ['query', 'request'],
    NavigatorLogin: ['setStatus'],
    NavigatorManagedData: ['onmanagedconfigurationchange', 'getManagedConfiguration'],
    NavigatorUAData: ['brands', 'mobile', 'platform', 'getHighEntropyValues', 'toJSON'],
    StorageBucketManager: ['delete', 'keys', 'open'],
    USB: ['onconnect', 'ondisconnect', 'getDevices', 'requestDevice'],
    WakeLock: ['request'],
    XRSystem: ['ondevicechange', 'isSessionSupported', 'requestSession'],
    DeprecatedStorageQuota: ['queryUsageAndQuota', 'requestQuota'],
  };

  const syntheticPrototypes = new Map([['DeprecatedStorageQuota', quotaProto]]);
  for (const member of Object.keys(_navigatorInterfaceNames)) {
    let instance;
    try { instance = globalThis.navigator[member]; } catch (_error) { continue; }
    if (!instance || typeof instance !== 'object') continue;
    const interfaceName = _navigatorInterfaceName(member);
    const proto = prototypeFor(interfaceName) || syntheticPrototypes.get(interfaceName);
    if (!proto) continue;
    // The literal's own string-keyed members are the IDL operations. Move each
    // onto the prototype; a WebIDL interface member is not an own property of
    // the instance, and the capture reports an empty
    // `Object.getOwnPropertyNames(navigator.credentials)`.
    for (const key of Object.getOwnPropertyNames(instance)) {
      const descriptor = Object.getOwnPropertyDescriptor(instance, key);
      try { delete instance[key]; } catch (_error) { continue; }
      if (Object.prototype.hasOwnProperty.call(proto, key)) continue;
      if (descriptor.get || descriptor.set) {
        Object.defineProperty(proto, key, {
          get: descriptor.get, set: descriptor.set,
          enumerable: true, configurable: true,
        });
        continue;
      }
      const value = typeof descriptor.value === 'function'
        ? _markNative(descriptor.value) : descriptor.value;
      const length = (_navigatorMemberLengths[member] || {})[key];
      if (typeof value === 'function' && Number.isFinite(length)) {
        Object.defineProperty(value, 'length', { value: length, configurable: true });
      }
      Object.defineProperty(proto, key, {
        value, writable: true, enumerable: true, configurable: true,
      });
    }
    Object.setPrototypeOf(instance, proto);
    // A retro-fitted @@toStringTag on the instance would shadow the
    // prototype's and keep the wrong brand alive; the prototype owns it.
    if (Object.prototype.hasOwnProperty.call(instance, Symbol.toStringTag)) {
      delete instance[Symbol.toStringTag];
    }
  }

  // Runs last: it reorders members that are already on the prototype.
  for (const interfaceName of Object.keys(memberOrder)) {
    const proto = prototypeFor(interfaceName) || syntheticPrototypes.get(interfaceName);
    if (proto) _alignPropertiesOrder(proto, memberOrder[interfaceName]);
  }
})();

// Legacy Window attributes are own accessors on a browsing-context global in
// Chrome. Keep their state per realm and connect Window.prototype to the
// EventTarget chain so `window instanceof EventTarget` and own-key reflection
// agree with the browser surface.
(function installWindowLegacySurface() {
  let windowName = '';
  let windowStatus = '';
  const accessor = (name, getter, setter) => {
    const get = _markNativeAs(getter, 'function get ' + name + '() { [native code] }');
    Object.defineProperty(get, 'name', { value: 'get ' + name, configurable: true });
    const descriptor = {
      get, enumerable: true, configurable: true,
    };
    if (setter) {
      const set = _markNativeAs(setter, 'function set ' + name + '() { [native code] }');
      Object.defineProperty(set, 'name', { value: 'set ' + name, configurable: true });
      descriptor.set = set;
    } else {
      descriptor.set = undefined;
    }
    Object.defineProperty(globalThis, name, descriptor);
  };
  accessor('name', function() { return windowName; }, function(value) {
    windowName = String(value);
  });
  accessor('status', function() { return windowStatus; }, function(value) {
    windowStatus = String(value);
  });
  accessor('closed', function() { return false; }, null);
  try {
    if (globalThis.EventTarget?.prototype) {
      Object.setPrototypeOf(globalThis.Window.prototype, globalThis.EventTarget.prototype);
    }
  } catch (_) {}
  for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!descriptor || typeof descriptor.value !== 'function') continue;
    try { delete globalThis[name]; } catch (_) { continue; }
    // A bare call in a strict page script can arrive with an undefined
    // receiver. The Window methods therefore target this realm explicitly,
    // while DOM EventTargets continue using EventTarget.prototype's receiver-aware
    // implementations.
    const method = name === 'addEventListener'
      ? function addEventListener(type, fn) { return _eventTargetAdd(globalThis, type, fn, arguments[2]); }
      : name === 'removeEventListener'
        ? function removeEventListener(type, fn) { return _eventTargetRemove(globalThis, type, fn, arguments[2]); }
        : function dispatchEvent(event) { return _eventTargetDispatch(globalThis, event); };
    Object.defineProperty(globalThis.Window.prototype, name, {
      value: _markNative(method), writable: true, enumerable: true, configurable: true,
    });
  }
})();

const _chromeNavigatorKeyOrder = [
  'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling',
  'userActivation', 'geolocation', 'doNotTrack', 'webkitTemporaryStorage',
  'webkitPersistentStorage', 'windowControlsOverlay', 'hardwareConcurrency',
  'cookieEnabled', 'appCodeName', 'appName', 'appVersion', 'platform',
  'product', 'userAgent', 'language', 'languages', 'onLine', 'webdriver',
  'plugins', 'mimeTypes', 'pdfViewerEnabled', 'connection',
  'getGamepads',
  'javaEnabled', 'sendBeacon', 'vibrate', 'constructor',
  'deprecatedRunAdAuctionEnforcesKAnonymity', 'protectedAudience', 'bluetooth',
  'clipboard', 'credentials', 'keyboard', 'managed', 'mediaDevices',
  'serviceWorker', 'virtualKeyboard', 'wakeLock', 'deviceMemory', 'userAgentData',
  'locks', 'storage', 'gpu', 'login', 'ink', 'mediaCapabilities', 'permissions',
  'devicePosture', 'hid', 'mediaSession', 'presentation', 'serial', 'usb', 'xr',
  'storageBuckets', 'adAuctionComponents', 'runAdAuction',
  'canLoadAdAuctionFencedFrame', 'canShare', 'share', 'clearAppBadge',
  'getBattery', 'getUserMedia', 'requestMIDIAccess', 'requestMediaKeySystemAccess',
  'setAppBadge', 'webkitGetUserMedia', 'clearOriginJoinedAdInterestGroups',
  'createAuctionNonce', 'joinAdInterestGroup', 'leaveAdInterestGroup',
  'updateAdInterestGroups', 'deprecatedReplaceInURN', 'deprecatedURNToURL',
  'getInstalledRelatedApps', 'getInterestGroupAdAuctionData',
  'registerProtocolHandler', 'unregisterProtocolHandler'
];

const _chromeDocumentKeyOrder = [
  'implementation', 'URL', 'documentURI', 'compatMode', 'characterSet',
  'charset', 'inputEncoding', 'contentType', 'doctype', 'documentElement',
  'xmlEncoding', 'xmlVersion', 'xmlStandalone', 'domain', 'referrer', 'cookie',
  'lastModified', 'readyState', 'title', 'dir', 'body', 'head', 'images',
  'embeds', 'plugins', 'links', 'forms', 'scripts', 'currentScript',
  'defaultView', 'designMode', 'onreadystatechange', 'anchors', 'applets',
  'fgColor', 'linkColor', 'vlinkColor', 'alinkColor', 'bgColor', 'all',
  'scrollingElement', 'onpointerlockchange', 'onpointerlockerror', 'hidden',
  'visibilityState', 'wasDiscarded', 'prerendering', 'featurePolicy',
  'webkitVisibilityState', 'webkitHidden', 'onbeforecopy', 'onbeforecut',
  'onbeforepaste', 'onfreeze', 'onprerenderingchange', 'onresume', 'onsearch',
  'onvisibilitychange', 'timeline', 'fullscreenEnabled', 'fullscreen',
  'onfullscreenchange', 'onfullscreenerror', 'webkitIsFullScreen',
  'webkitCurrentFullScreenElement', 'webkitFullscreenEnabled',
  'webkitFullscreenElement', 'onwebkitfullscreenchange', 'onwebkitfullscreenerror',
  'rootElement', 'pictureInPictureEnabled', 'onabort', 'onbeforeinput',
  'onbeforematch', 'onbeforetoggle', 'onblur', 'oncancel', 'oncanplay',
  'oncanplaythrough', 'onchange', 'onclick', 'onclose', 'oncommand',
  'oncontentvisibilityautostatechange', 'oncontextlost', 'oncontextmenu',
  'oncontextrestored', 'oncuechange', 'ondblclick', 'ondrag', 'ondragend',
  'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop',
  'ondurationchange', 'onemptied', 'onended', 'onerror', 'onfocus', 'onformdata',
  'oninput', 'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup', 'onload',
  'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onmousedown',
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
  'oncopy', 'oncut', 'onpaste', 'children', 'firstElementChild',
  'lastElementChild', 'childElementCount', 'activeElement', 'styleSheets',
  'pointerLockElement', 'fullscreenElement', 'adoptedStyleSheets',
  'pictureInPictureElement', 'fonts', 'adoptNode', 'append', 'captureEvents',
  'caretPositionFromPoint', 'caretRangeFromPoint', 'clear', 'close',
  'createAttribute', 'createAttributeNS', 'createCDATASection', 'createComment',
  'createDocumentFragment', 'createElement', 'createElementNS', 'createEvent',
  'createExpression', 'createNSResolver', 'createNodeIterator',
  'createProcessingInstruction', 'createRange', 'createTextNode',
  'createTreeWalker', 'elementFromPoint', 'elementsFromPoint', 'evaluate',
  'execCommand', 'exitFullscreen', 'exitPictureInPicture', 'exitPointerLock',
  'getAnimations', 'getElementById', 'getElementsByClassName',
  'getElementsByName', 'getElementsByTagName', 'getElementsByTagNameNS',
  'getSelection', 'hasFocus', 'hasStorageAccess', 'hasUnpartitionedCookieAccess',
  'importNode', 'moveBefore', 'open', 'prepend', 'queryCommandEnabled',
  'queryCommandIndeterm', 'queryCommandState', 'queryCommandSupported',
  'queryCommandValue', 'querySelector', 'querySelectorAll', 'releaseEvents',
  'replaceChildren', 'requestStorageAccess', 'requestStorageAccessFor',
  'startViewTransition', 'webkitCancelFullScreen', 'webkitExitFullscreen',
  'write', 'writeln', 'constructor', 'fragmentDirective', 'onpointerrawupdate',
  'browsingTopics', 'hasPrivateToken', 'hasRedemptionRecord',
  'activeViewTransition', 'onscrollsnapchange', 'onscrollsnapchanging',
  'customElementRegistry', 'ariaNotify'
];

const _chromeScreenKeyOrder = [
  'availWidth', 'availHeight', 'width', 'height', 'colorDepth', 'pixelDepth',
  'availLeft', 'availTop', 'orientation', 'isExtended', 'onchange',
  'addEventListener', 'dispatchEvent', 'removeEventListener', 'when',
  'constructor',
];
const _chromeScreenOrientationKeyOrder = [
  'type', 'angle', 'onchange', 'lock', 'unlock',
  'addEventListener', 'dispatchEvent', 'removeEventListener', 'when',
  'constructor',
];
const _chromeNodeKeyOrder = [
  'nodeType', 'nodeName', 'baseURI', 'isConnected', 'ownerDocument',
  'parentNode', 'parentElement', 'childNodes', 'firstChild', 'lastChild',
  'previousSibling', 'nextSibling', 'nodeValue', 'textContent',
  'ELEMENT_NODE', 'ATTRIBUTE_NODE', 'TEXT_NODE', 'CDATA_SECTION_NODE',
  'ENTITY_REFERENCE_NODE', 'ENTITY_NODE', 'PROCESSING_INSTRUCTION_NODE',
  'COMMENT_NODE', 'DOCUMENT_NODE', 'DOCUMENT_TYPE_NODE', 'DOCUMENT_FRAGMENT_NODE',
  'NOTATION_NODE', 'DOCUMENT_POSITION_DISCONNECTED', 'DOCUMENT_POSITION_PRECEDING',
  'DOCUMENT_POSITION_FOLLOWING', 'DOCUMENT_POSITION_CONTAINS',
  'DOCUMENT_POSITION_CONTAINED_BY', 'DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC',
  'appendChild', 'cloneNode', 'compareDocumentPosition', 'contains', 'getRootNode',
  'hasChildNodes', 'insertBefore', 'isDefaultNamespace', 'isEqualNode', 'isSameNode',
  'lookupNamespaceURI', 'lookupPrefix', 'normalize', 'removeChild', 'replaceChild',
  'addEventListener', 'dispatchEvent', 'removeEventListener', 'when', 'constructor',
];
// Chrome installs the callable Window surface in two stable groups: the
// Window/ECMAScript functions first, then the generated interface constructors
// in the reference payload order. Keep this generated table in bootstrap so
// realm enumeration follows the same registration sequence.
const _chromeWindowVersionExtras = new Set([
  'FontFaceSet', 'HTMLUserMediaElement', 'InteractionContentfulPaint', 'NodeRange',
  'OpaqueRange', 'PerformanceSoftNavigation', 'PermissionsPolicy', 'XSLTProcessor',
]);
const _chromePayloadBareFunctionOrder = [
 'alert', 'atob', 'blur', 'btoa', 'cancelAnimationFrame', 'cancelIdleCallback', 'captureEvents', 'clearInterval',
 'clearTimeout', 'close', 'confirm', 'createImageBitmap', 'fetch', 'find', 'focus', 'getComputedStyle',
 'getSelection', 'matchMedia', 'moveBy', 'moveTo', 'open', 'postMessage', 'print', 'prompt',
 'queueMicrotask', 'releaseEvents', 'reportError', 'requestAnimationFrame', 'requestIdleCallback', 'resizeBy', 'resizeTo', 'scroll',
 'scrollBy', 'scrollTo', 'setInterval', 'setTimeout', 'stop', 'structuredClone', 'webkitCancelAnimationFrame', 'webkitRequestAnimationFrame',
 'fetchLater', 'getScreenDetails', 'queryLocalFonts', 'showDirectoryPicker', 'showOpenFilePicker', 'showSaveFilePicker', 'webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL',
 'addEventListener', 'dispatchEvent', 'removeEventListener', 'when', 'Object', 'Function', 'Number', 'parseFloat',
 'parseInt', 'Boolean', 'String', 'Symbol', 'Date', 'Promise', 'RegExp', 'Error',
 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'ArrayBuffer',
 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'BigUint64Array', 'BigInt64Array',
 'Uint8ClampedArray', 'Float32Array', 'Float64Array', 'DataView', 'Map', 'BigInt', 'Set', 'Iterator',
 'WeakMap', 'WeakSet', 'Proxy', 'FinalizationRegistry', 'WeakRef', 'decodeURI', 'decodeURIComponent', 'encodeURI',
 'encodeURIComponent', 'escape', 'unescape', 'eval', 'isFinite', 'isNaN', 'Option', 'Image',
 'Audio', 'webkitURL', 'webkitRTCPeerConnection', 'webkitMediaStream', 'WebKitMutationObserver', 'WebKitCSSMatrix', 'XPathResult', 'XPathExpression',
 'XPathEvaluator', 'XMLSerializer', 'XMLHttpRequestUpload', 'XMLHttpRequestEventTarget', 'XMLHttpRequest', 'XMLDocument', 'WritableStreamDefaultWriter', 'WritableStreamDefaultController',
 'WritableStream', 'Worker', 'WindowControlsOverlayGeometryChangeEvent', 'WindowControlsOverlay', 'Window', 'WheelEvent', 'WebSocket', 'WebGLVertexArrayObject',
 'WebGLUniformLocation', 'WebGLTransformFeedback', 'WebGLTexture', 'WebGLSync', 'WebGLShaderPrecisionFormat', 'WebGLShader', 'WebGLSampler', 'WebGLRenderingContext',
 'WebGLRenderbuffer', 'WebGLQuery', 'WebGLProgram', 'WebGLObject', 'WebGLFramebuffer', 'WebGLContextEvent', 'WebGLBuffer', 'WebGLActiveInfo',
 'WebGL2RenderingContext', 'WaveShaperNode', 'VisualViewport', 'VisibilityStateEntry', 'VirtualKeyboardGeometryChangeEvent', 'ViewTransitionTypeSet', 'ViewTransition', 'ViewTimeline',
 'VideoPlaybackQuality', 'VideoFrame', 'VideoColorSpace', 'ValidityState', 'VTTCue', 'UserActivation', 'URLSearchParams', 'URLPattern',
 'URL', 'UIEvent', 'TrustedTypePolicyFactory', 'TrustedTypePolicy', 'TrustedScriptURL', 'TrustedScript', 'TrustedHTML', 'TreeWalker',
 'TransitionEvent', 'TransformStreamDefaultController', 'TransformStream', 'TrackEvent', 'TouchList', 'TouchEvent', 'Touch', 'ToggleEvent',
 'TimeRanges', 'TextUpdateEvent', 'TextTrackList', 'TextTrackCueList', 'TextTrackCue', 'TextTrack', 'TextMetrics', 'TextFormatUpdateEvent',
 'TextFormat', 'TextEvent', 'TextEncoderStream', 'TextEncoder', 'TextDecoderStream', 'TextDecoder', 'Text', 'TaskSignal',
 'TaskPriorityChangeEvent', 'TaskController', 'TaskAttributionTiming', 'SyncManager', 'Subscriber', 'SubmitEvent', 'StyleSheetList', 'StyleSheet',
 'StylePropertyMapReadOnly', 'StylePropertyMap', 'StorageEvent', 'Storage', 'StereoPannerNode', 'StaticRange', 'SourceBufferList', 'SourceBuffer',
 'ShadowRoot', 'Selection', 'SecurityPolicyViolationEvent', 'ScrollTimeline', 'ScriptProcessorNode', 'ScreenOrientation', 'Screen', 'Scheduling',
 'Scheduler', 'SVGViewElement', 'SVGUseElement', 'SVGUnitTypes', 'SVGTransformList', 'SVGTransform', 'SVGTitleElement', 'SVGTextPositioningElement',
 'SVGTextPathElement', 'SVGTextElement', 'SVGTextContentElement', 'SVGTSpanElement', 'SVGSymbolElement', 'SVGSwitchElement', 'SVGStyleElement', 'SVGStringList',
 'SVGStopElement', 'SVGSetElement', 'SVGScriptElement', 'SVGSVGElement', 'SVGRectElement', 'SVGRect', 'SVGRadialGradientElement', 'SVGPreserveAspectRatio',
 'SVGPolylineElement', 'SVGPolygonElement', 'SVGPointList', 'SVGPoint', 'SVGPatternElement', 'SVGPathElement', 'SVGNumberList', 'SVGNumber',
 'SVGMetadataElement', 'SVGMatrix', 'SVGMaskElement', 'SVGMarkerElement', 'SVGMPathElement', 'SVGLinearGradientElement', 'SVGLineElement', 'SVGLengthList',
 'SVGLength', 'SVGImageElement', 'SVGGraphicsElement', 'SVGGradientElement', 'SVGGeometryElement', 'SVGGElement', 'SVGForeignObjectElement', 'SVGFilterElement',
 'SVGFETurbulenceElement', 'SVGFETileElement', 'SVGFESpotLightElement', 'SVGFESpecularLightingElement', 'SVGFEPointLightElement', 'SVGFEOffsetElement', 'SVGFEMorphologyElement', 'SVGFEMergeNodeElement',
 'SVGFEMergeElement', 'SVGFEImageElement', 'SVGFEGaussianBlurElement', 'SVGFEFuncRElement', 'SVGFEFuncGElement', 'SVGFEFuncBElement', 'SVGFEFuncAElement', 'SVGFEFloodElement',
 'SVGFEDropShadowElement', 'SVGFEDistantLightElement', 'SVGFEDisplacementMapElement', 'SVGFEDiffuseLightingElement', 'SVGFEConvolveMatrixElement', 'SVGFECompositeElement', 'SVGFEComponentTransferElement', 'SVGFEColorMatrixElement',
 'SVGFEBlendElement', 'SVGEllipseElement', 'SVGElement', 'SVGDescElement', 'SVGDefsElement', 'SVGComponentTransferFunctionElement', 'SVGClipPathElement', 'SVGCircleElement',
 'SVGAnimationElement', 'SVGAnimatedTransformList', 'SVGAnimatedString', 'SVGAnimatedRect', 'SVGAnimatedPreserveAspectRatio', 'SVGAnimatedNumberList', 'SVGAnimatedNumber', 'SVGAnimatedLengthList',
 'SVGAnimatedLength', 'SVGAnimatedInteger', 'SVGAnimatedEnumeration', 'SVGAnimatedBoolean', 'SVGAnimatedAngle', 'SVGAnimateTransformElement', 'SVGAnimateMotionElement', 'SVGAnimateElement',
 'SVGAngle', 'SVGAElement', 'Response', 'ResizeObserverSize', 'ResizeObserverEntry', 'ResizeObserver', 'Request', 'ReportingObserver',
 'ReportBody', 'ReadableStreamDefaultReader', 'ReadableStreamDefaultController', 'ReadableStreamBYOBRequest', 'ReadableStreamBYOBReader', 'ReadableStream', 'ReadableByteStreamController', 'Range',
 'RadioNodeList', 'RTCTrackEvent', 'RTCStatsReport', 'RTCSessionDescription', 'RTCSctpTransport', 'RTCRtpTransceiver', 'RTCRtpSender', 'RTCRtpReceiver',
 'RTCPeerConnectionIceEvent', 'RTCPeerConnectionIceErrorEvent', 'RTCPeerConnection', 'RTCIceTransport', 'RTCIceCandidate', 'RTCErrorEvent', 'RTCError', 'RTCEncodedVideoFrame',
 'RTCEncodedAudioFrame', 'RTCDtlsTransport', 'RTCDataChannelEvent', 'RTCDTMFToneChangeEvent', 'RTCDTMFSender', 'RTCCertificate', 'PromiseRejectionEvent', 'ProgressEvent',
 'ProcessingInstruction', 'PopStateEvent', 'PointerEvent', 'PluginArray', 'Plugin', 'PictureInPictureWindow', 'PictureInPictureEvent', 'Permissions',
 'PermissionStatus', 'PeriodicWave', 'PerformanceTiming', 'PerformanceServerTiming', 'PerformanceScriptTiming', 'PerformanceResourceTiming', 'PerformancePaintTiming', 'PerformanceObserverEntryList',
 'PerformanceObserver', 'PerformanceNavigationTiming', 'PerformanceNavigation', 'PerformanceMeasure', 'PerformanceMark', 'PerformanceLongTaskTiming', 'PerformanceLongAnimationFrameTiming', 'PerformanceEventTiming',
 'PerformanceEntry', 'PerformanceElementTiming', 'Performance', 'Path2D', 'PannerNode', 'PageTransitionEvent', 'OverconstrainedError', 'OscillatorNode',
 'OffscreenCanvasRenderingContext2D', 'OffscreenCanvas', 'OfflineAudioContext', 'OfflineAudioCompletionEvent', 'Observable', 'NodeList', 'NodeIterator', 'NodeFilter',
 'Node', 'NetworkInformation', 'NavigatorUAData', 'Navigator', 'NavigationTransition', 'NavigationPrecommitController', 'NavigationHistoryEntry', 'NavigationDestination',
 'NavigationCurrentEntryChangeEvent', 'NavigationActivation', 'Navigation', 'NavigateEvent', 'NamedNodeMap', 'MutationRecord', 'MutationObserver', 'MouseEvent',
 'MimeTypeArray', 'MimeType', 'MessagePort', 'MessageEvent', 'MessageChannel', 'MediaStreamTrackVideoStats', 'MediaStreamTrackProcessor', 'MediaStreamTrackGenerator',
 'MediaStreamTrackEvent', 'MediaStreamTrackAudioStats', 'MediaStreamTrack', 'MediaStreamEvent', 'MediaStreamAudioSourceNode', 'MediaStreamAudioDestinationNode', 'MediaStream', 'MediaSourceHandle',
 'MediaSource', 'MediaRecorder', 'MediaQueryListEvent', 'MediaQueryList', 'MediaList', 'MediaError', 'MediaEncryptedEvent', 'MediaElementAudioSourceNode',
 'MediaCapabilities', 'MathMLElement', 'Location', 'LayoutShiftAttribution', 'LayoutShift', 'LargestContentfulPaint', 'KeyframeEffect', 'KeyboardEvent',
 'IntersectionObserverEntry', 'IntersectionObserver', 'InterestEvent', 'InputEvent', 'InputDeviceInfo', 'InputDeviceCapabilities', 'Ink', 'ImageData',
 'ImageBitmapRenderingContext', 'ImageBitmap', 'IdleDeadline', 'IIRFilterNode', 'IDBVersionChangeEvent', 'IDBTransaction', 'IDBRequest', 'IDBRecord',
 'IDBOpenDBRequest', 'IDBObjectStore', 'IDBKeyRange', 'IDBIndex', 'IDBFactory', 'IDBDatabase', 'IDBCursorWithValue', 'IDBCursor',
 'History', 'HighlightRegistry', 'Highlight', 'Headers', 'HashChangeEvent', 'HTMLVideoElement', 'HTMLUnknownElement', 'HTMLUListElement',
 'HTMLTrackElement', 'HTMLTitleElement', 'HTMLTimeElement', 'HTMLTextAreaElement', 'HTMLTemplateElement', 'HTMLTableSectionElement', 'HTMLTableRowElement', 'HTMLTableElement',
 'HTMLTableColElement', 'HTMLTableCellElement', 'HTMLTableCaptionElement', 'HTMLStyleElement', 'HTMLSpanElement', 'HTMLSourceElement', 'HTMLSlotElement', 'HTMLSelectedContentElement',
 'HTMLSelectElement', 'HTMLScriptElement', 'HTMLQuoteElement', 'HTMLProgressElement', 'HTMLPreElement', 'HTMLPictureElement', 'HTMLParamElement', 'HTMLParagraphElement',
 'HTMLOutputElement', 'HTMLOptionsCollection', 'HTMLOptionElement', 'HTMLOptGroupElement', 'HTMLObjectElement', 'HTMLOListElement', 'HTMLModElement', 'HTMLMeterElement',
 'HTMLMetaElement', 'HTMLMenuElement', 'HTMLMediaElement', 'HTMLMarqueeElement', 'HTMLMapElement', 'HTMLLinkElement', 'HTMLLegendElement', 'HTMLLabelElement',
 'HTMLLIElement', 'HTMLInputElement', 'HTMLImageElement', 'HTMLIFrameElement', 'HTMLHtmlElement', 'HTMLHeadingElement', 'HTMLHeadElement', 'HTMLHRElement',
 'HTMLFrameSetElement', 'HTMLFrameElement', 'HTMLFormElement', 'HTMLFormControlsCollection', 'HTMLFontElement', 'HTMLFieldSetElement', 'HTMLEmbedElement', 'HTMLElement',
 'HTMLDocument', 'HTMLDivElement', 'HTMLDirectoryElement', 'HTMLDialogElement', 'HTMLDetailsElement', 'HTMLDataListElement', 'HTMLDataElement', 'HTMLDListElement',
 'HTMLCollection', 'HTMLCanvasElement', 'HTMLButtonElement', 'HTMLBodyElement', 'HTMLBaseElement', 'HTMLBRElement', 'HTMLAudioElement', 'HTMLAreaElement',
 'HTMLAnchorElement', 'HTMLAllCollection', 'GeolocationPositionError', 'GeolocationPosition', 'GeolocationCoordinates', 'Geolocation', 'GamepadHapticActuator', 'GamepadEvent',
 'GamepadButton', 'Gamepad', 'GainNode', 'FormDataEvent', 'FormData', 'FontFaceSetLoadEvent', 'FontFace', 'FocusEvent',
 'FileReader', 'FileList', 'File', 'FeaturePolicy', 'External', 'EventTarget', 'EventSource', 'EventCounts',
 'Event', 'ErrorEvent', 'EncodedVideoChunk', 'EncodedAudioChunk', 'ElementInternals', 'Element', 'EditContext', 'DynamicsCompressorNode',
 'DragEvent', 'DocumentType', 'DocumentTimeline', 'DocumentFragment', 'Document', 'DelegatedInkTrailPresenter', 'DelayNode', 'DecompressionStream',
 'DataTransferItemList', 'DataTransferItem', 'DataTransfer', 'DOMTokenList', 'DOMStringMap', 'DOMStringList', 'DOMRectReadOnly', 'DOMRectList',
 'DOMRect', 'DOMQuad', 'DOMPointReadOnly', 'DOMPoint', 'DOMParser', 'DOMMatrixReadOnly', 'DOMMatrix', 'DOMImplementation',
 'DOMException', 'DOMError', 'CustomStateSet', 'CustomEvent', 'CustomElementRegistry', 'Crypto', 'CountQueuingStrategy', 'ConvolverNode',
 'ContentVisibilityAutoStateChangeEvent', 'ConstantSourceNode', 'CompressionStream', 'CompositionEvent', 'Comment', 'CommandEvent', 'CloseWatcher', 'CloseEvent',
 'ClipboardEvent', 'CharacterData', 'CharacterBoundsUpdateEvent', 'ChannelSplitterNode', 'ChannelMergerNode', 'CaretPosition', 'CanvasRenderingContext2D', 'CanvasPattern',
 'CanvasGradient', 'CanvasCaptureMediaStreamTrack', 'CSSViewTransitionRule', 'CSSVariableReferenceValue', 'CSSUnparsedValue', 'CSSUnitValue', 'CSSTranslate', 'CSSTransition',
 'CSSTransformValue', 'CSSTransformComponent', 'CSSSupportsRule', 'CSSStyleValue', 'CSSStyleSheet', 'CSSStyleRule', 'CSSStyleDeclaration', 'CSSStartingStyleRule',
 'CSSSkewY', 'CSSSkewX', 'CSSSkew', 'CSSScopeRule', 'CSSScale', 'CSSRuleList', 'CSSRule', 'CSSRotate',
 'CSSPropertyRule', 'CSSPositionValue', 'CSSPositionTryRule', 'CSSPositionTryDescriptors', 'CSSPerspective', 'CSSPageRule', 'CSSNumericValue', 'CSSNumericArray',
 'CSSNestedDeclarations', 'CSSNamespaceRule', 'CSSMediaRule', 'CSSMatrixComponent', 'CSSMathValue', 'CSSMathSum', 'CSSMathProduct', 'CSSMathNegate',
 'CSSMathMin', 'CSSMathMax', 'CSSMathInvert', 'CSSMathClamp', 'CSSMarginRule', 'CSSLayerStatementRule', 'CSSLayerBlockRule', 'CSSKeywordValue',
 'CSSKeyframesRule', 'CSSKeyframeRule', 'CSSImportRule', 'CSSImageValue', 'CSSGroupingRule', 'CSSFontPaletteValuesRule', 'CSSFontFaceRule', 'CSSCounterStyleRule',
 'CSSContainerRule', 'CSSConditionRule', 'CSSAnimation', 'CSPViolationReportBody', 'CDATASection', 'ByteLengthQueuingStrategy', 'BrowserCaptureMediaStreamTrack', 'BroadcastChannel',
 'BlobEvent', 'Blob', 'BiquadFilterNode', 'BeforeUnloadEvent', 'BeforeInstallPromptEvent', 'BaseAudioContext', 'BarProp', 'AudioWorkletNode',
 'AudioSinkInfo', 'AudioScheduledSourceNode', 'AudioProcessingEvent', 'AudioParamMap', 'AudioParam', 'AudioNode', 'AudioListener', 'AudioDestinationNode',
 'AudioData', 'AudioContext', 'AudioBufferSourceNode', 'AudioBuffer', 'Attr', 'AnimationTimeline', 'AnimationPlaybackEvent', 'AnimationEvent',
 'AnimationEffect', 'Animation', 'AnalyserNode', 'AbstractRange', 'AbortSignal', 'AbortController', 'SuppressedError', 'DisposableStack',
 'AsyncDisposableStack', 'Float16Array', 'AbsoluteOrientationSensor', 'Accelerometer', 'AudioDecoder', 'AudioEncoder', 'AudioWorklet', 'BatteryManager',
 'Cache', 'CacheStorage', 'Clipboard', 'ClipboardChangeEvent', 'ClipboardItem', 'CookieChangeEvent', 'CookieStore', 'CookieStoreManager',
 'CreateMonitor', 'Credential', 'CredentialsContainer', 'CryptoKey', 'DeviceMotionEvent', 'DeviceMotionEventAcceleration', 'DeviceMotionEventRotationRate', 'DeviceOrientationEvent',
 'FederatedCredential', 'GPU', 'GPUAdapter', 'GPUAdapterInfo', 'GPUBindGroup', 'GPUBindGroupLayout', 'GPUBuffer', 'GPUCanvasContext',
 'GPUCommandBuffer', 'GPUCommandEncoder', 'GPUCompilationInfo', 'GPUCompilationMessage', 'GPUComputePassEncoder', 'GPUComputePipeline', 'GPUDevice', 'GPUDeviceLostInfo',
 'GPUError', 'GPUExternalTexture', 'GPUInternalError', 'GPUOutOfMemoryError', 'GPUPipelineError', 'GPUPipelineLayout', 'GPUQuerySet', 'GPUQueue',
 'GPURenderBundle', 'GPURenderBundleEncoder', 'GPURenderPassEncoder', 'GPURenderPipeline', 'GPUSampler', 'GPUShaderModule', 'GPUSupportedFeatures', 'GPUSupportedLimits',
 'GPUTexture', 'GPUTextureView', 'GPUUncapturedErrorEvent', 'GPUValidationError', 'GravitySensor', 'Gyroscope', 'IdleDetector', 'ImageCapture',
 'ImageDecoder', 'ImageTrack', 'ImageTrackList', 'Keyboard', 'KeyboardLayoutMap', 'LinearAccelerationSensor', 'MIDIAccess', 'MIDIConnectionEvent',
 'MIDIInput', 'MIDIInputMap', 'MIDIMessageEvent', 'MIDIOutput', 'MIDIOutputMap', 'MIDIPort', 'MediaDeviceInfo', 'MediaDevices',
 'MediaKeyMessageEvent', 'MediaKeySession', 'MediaKeyStatusMap', 'MediaKeySystemAccess', 'MediaKeys', 'NavigationPreloadManager', 'NavigatorManagedData', 'OrientationSensor',
 'PasswordCredential', 'ProtectedAudience', 'RelativeOrientationSensor', 'ScreenDetailed', 'ScreenDetails', 'Sensor', 'SensorErrorEvent', 'ServiceWorkerRegistration',
 'StorageManager', 'SubtleCrypto', 'VideoDecoder', 'VideoEncoder', 'VirtualKeyboard', 'WGSLLanguageFeatures', 'WebTransport', 'WebTransportBidirectionalStream',
 'WebTransportDatagramDuplexStream', 'WebTransportError', 'Worklet', 'XRDOMOverlayState', 'XRLayer', 'XRWebGLBinding', 'AudioPlaybackStats', 'AuthenticatorAssertionResponse',
 'AuthenticatorAttestationResponse', 'AuthenticatorResponse', 'PublicKeyCredential', 'BarcodeDetector', 'Bluetooth', 'BluetoothCharacteristicProperties', 'BluetoothDevice', 'BluetoothRemoteGATTCharacteristic',
 'BluetoothRemoteGATTDescriptor', 'BluetoothRemoteGATTServer', 'BluetoothRemoteGATTService', 'CaptureController', 'CrashReportContext', 'DevicePosture', 'DigitalCredential', 'DocumentPictureInPicture',
 'EyeDropper', 'FetchLaterResult', 'FileSystemDirectoryHandle', 'FileSystemFileHandle', 'FileSystemHandle', 'FileSystemWritableFileStream', 'FileSystemObserver', 'FontData',
 'FragmentDirective', 'HID', 'HIDConnectionEvent', 'HIDDevice', 'HIDInputReportEvent', 'IdentityCredential', 'IdentityCredentialError', 'IdentityProvider',
 'NavigatorLogin', 'LanguageDetector', 'LanguageModel', 'Lock', 'LockManager', 'ServiceWorker', 'ServiceWorkerContainer',
 'NotRestoredReasonDetails', 'NotRestoredReasons', 'OTPCredential', 'PaymentAddress', 'PaymentRequest', 'PaymentRequestUpdateEvent', 'PaymentResponse', 'PaymentManager',
 'PaymentMethodChangeEvent', 'Presentation', 'PresentationAvailability', 'PresentationConnection', 'PresentationConnectionAvailableEvent', 'PresentationConnectionCloseEvent', 'PresentationConnectionList', 'PresentationReceiver',
 'PresentationRequest', 'PressureObserver', 'PressureRecord', 'Serial', 'SerialPort', 'SpeechRecognitionPhrase', 'StorageBucket', 'StorageBucketManager',
 'Summarizer', 'Translator', 'USB', 'USBAlternateInterface', 'USBConfiguration', 'USBConnectionEvent', 'USBDevice', 'USBEndpoint',
 'USBInTransferResult', 'USBInterface', 'USBIsochronousInTransferPacket', 'USBIsochronousInTransferResult', 'USBIsochronousOutTransferPacket', 'USBIsochronousOutTransferResult', 'USBOutTransferResult', 'WakeLock',
 'WakeLockSentinel', 'XRAnchor', 'XRAnchorSet', 'XRBoundedReferenceSpace', 'XRCPUDepthInformation', 'XRCamera', 'XRDepthInformation',
 'XRFrame', 'XRHand', 'XRHitTestResult', 'XRHitTestSource', 'XRInputSource', 'XRInputSourceArray', 'XRInputSourceEvent', 'XRInputSourcesChangeEvent',
 'XRJointPose', 'XRJointSpace', 'XRLightEstimate', 'XRLightProbe', 'XRPose', 'XRRay', 'XRReferenceSpace', 'XRReferenceSpaceEvent',
 'XRRenderState', 'XRRigidTransform', 'XRSession', 'XRSessionEvent', 'XRSpace', 'XRSystem', 'XRTransientInputHitTestResult', 'XRTransientInputHitTestSource',
 'XRView', 'XRViewerPose', 'XRViewport', 'XRWebGLDepthInformation', 'XRWebGLLayer', 'XRCompositionLayer', 'XRProjectionLayer', 'XRCubeLayer',
 'XRCylinderLayer', 'XREquirectLayer', 'XRLayerEvent', 'XRQuadLayer', 'XRSubImage', 'XRWebGLSubImage', 'XRPlane', 'XRPlaneSet',
 'XRVisibilityMaskChangeEvent', 'AnimationTrigger', 'BackgroundFetchManager', 'BackgroundFetchRecord', 'BackgroundFetchRegistration', 'BluetoothUUID', 'CSSFontFeatureValuesRule', 'CSSFunctionDeclarations',
 'CSSFunctionDescriptors', 'CSSFunctionRule', 'CSSPseudoElement', 'ChapterInformation', 'CropTarget', 'DocumentPictureInPictureEvent', 'Fence', 'FencedFrameConfig',
 'HTMLFencedFrameElement', 'HTMLGeolocationElement', 'IntegrityViolationReportBody', 'LaunchParams', 'LaunchQueue', 'MediaMetadata', 'MediaSession', 'Notification',
 'Origin', 'PageRevealEvent', 'PageSwapEvent', 'PerformanceTimingConfidence', 'PeriodicSyncManager', 'Profiler', 'PushManager', 'PushSubscription',
 'PushSubscriptionOptions', 'QuotaExceededError', 'RTCDataChannel', 'RTCRtpScriptTransform', 'RemotePlayback', 'RestrictionTarget', 'Sanitizer', 'SharedStorage',
 'SharedStorageWorklet', 'SharedStorageAppendMethod', 'SharedStorageClearMethod', 'SharedStorageDeleteMethod', 'SharedStorageModifierMethod', 'SharedStorageSetMethod', 'SharedWorker', 'SnapEvent',
 'SpeechGrammar', 'SpeechGrammarList', 'SpeechRecognition', 'SpeechRecognitionErrorEvent', 'SpeechRecognitionEvent', 'SpeechSynthesis', 'SpeechSynthesisErrorEvent', 'SpeechSynthesisEvent',
 'SpeechSynthesisUtterance', 'SpeechSynthesisVoice', 'TimelineTrigger', 'TimelineTriggerRange', 'TimelineTriggerRangeList', 'Viewport', 'WebSocketError', 'WebSocketStream',
 'webkitSpeechGrammar', 'webkitSpeechGrammarList', 'webkitSpeechRecognition', 'webkitSpeechRecognitionError', 'webkitSpeechRecognitionEvent'
];
function _extendChromeWindowFunctionOrder() {
  const ordered = _chromePayloadBareFunctionOrder;
  const seen = new Set(_chromeWindowKeyOrder);
  for (const name of ordered) {
    if (!seen.has(name)) { seen.add(name); _chromeWindowKeyOrder.push(name); }
  }
  for (const name of _chromeWindowVersionExtras) {
    if (!seen.has(name)) { seen.add(name); _chromeWindowKeyOrder.push(name); }
  }
}

function _alignPropertiesOrder(target, keyOrder) {
  if (keyOrder === _chromeWindowKeyOrder
      && typeof globalThis.__obscura_install_window_surface === 'function') {
    globalThis.__obscura_install_window_surface(target, keyOrder);
    return;
  }
  if (!target) return;
  for (const key of keyOrder) {
    if (target === globalThis && _ecmaScriptGlobals.has(key)) continue;
    try {
      const desc = Object.getOwnPropertyDescriptor(target, key);
      if (desc && desc.configurable) {
        delete target[key];
        Object.defineProperty(target, key, desc);
      }
    } catch (_error) {}
  }
}

// Window's WebIDL namespace objects are enumerable own properties in Chrome.
// The ECMAScript namespace objects that follow them (globalThis, JSON, Math,
// CSS and the GPU constant objects) are not. Keep this descriptor contract in
// one place because secure-context gating and frame initialization can replace
// these properties after the initial bootstrap pass.
const _chromeEnumerableWindowObjects = [
  'window', 'self', 'document', 'location', 'customElements', 'history',
  'navigation', 'locationbar', 'menubar', 'personalbar', 'scrollbars',
  'statusbar', 'toolbar', 'frames', 'top', 'parent', 'frameElement',
  'navigator', 'external', 'screen', 'visualViewport', 'clientInformation',
  'styleMedia', 'scheduler', 'performance', 'trustedTypes', 'crypto',
  'indexedDB', 'localStorage', 'sessionStorage', 'chrome', 'crashReport',
  'cookieStore', 'caches', 'documentPictureInPicture', 'sharedStorage',
  'viewport', 'launchQueue', 'speechSynthesis',
];
const _chromeEnumerableWindowFunctions = [
  'alert', 'atob', 'blur', 'btoa', 'cancelAnimationFrame', 'cancelIdleCallback',
  'captureEvents', 'clearInterval', 'clearTimeout', 'close', 'confirm',
  'createImageBitmap', 'fetch', 'find', 'focus', 'getComputedStyle',
  'getSelection', 'matchMedia', 'moveBy', 'moveTo', 'open', 'postMessage',
  'print', 'prompt', 'queueMicrotask', 'releaseEvents', 'reportError',
  'requestAnimationFrame', 'requestIdleCallback', 'resizeBy', 'resizeTo',
  'scroll', 'scrollBy', 'scrollTo', 'setInterval', 'setTimeout', 'stop',
  'structuredClone', 'webkitCancelAnimationFrame', 'webkitRequestAnimationFrame',
  'fetchLater', 'getScreenDetails', 'queryLocalFonts', 'showDirectoryPicker',
  'showOpenFilePicker', 'showSaveFilePicker', 'webkitRequestFileSystem',
  'webkitResolveLocalFileSystemURL', 'addEventListener', 'dispatchEvent',
  'removeEventListener', 'when',
];
const _chromeNonEnumerableWindowObjects = [
  'globalThis', 'JSON', 'Math', 'Intl', 'Atomics', 'Reflect', 'console',
  'CSS', 'Temporal', 'WebAssembly', 'GPUBufferUsage', 'GPUColorWrite',
  'GPUMapMode', 'GPUShaderStage', 'GPUTextureUsage',
];
function _normalizeWindowObjectEnumerability(target) {
  if (!target) return;
  const isFrameRealm = typeof target.__obscura_frame_document_nid === 'number'
    && target.__obscura_frame_document_nid > 0;
  const setEnumerable = (name, enumerable) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (!descriptor || descriptor.enumerable === enumerable || !descriptor.configurable) return;
      Object.defineProperty(target, name, { ...descriptor, enumerable });
    } catch (_error) {}
  };
  for (const name of _chromeEnumerableWindowObjects) setEnumerable(name, true);
  for (const name of _chromeEnumerableWindowFunctions) {
    if (isFrameRealm && !Object.prototype.hasOwnProperty.call(target, name)
        && target.Window?.prototype && typeof target.Window.prototype[name] === 'function') {
      try {
        Object.defineProperty(target, name, {
          value: target.Window.prototype[name], writable: true,
          enumerable: true, configurable: true,
        });
      } catch (_error) {}
    }
    setEnumerable(name, true);
  }
  // Window interface constructors are own properties of the global object,
  // but WebIDL exposes those bindings as non-enumerable. Several legacy
  // shims were installed with `globalThis.X = ...` before the interface table
  // pass and consequently retained enumerable:true. That makes an enumerable
  // walk put Image/Element/etc. before ECMAScript globals, unlike Chrome.
  // Keep the rule derived from the descriptor shape rather than maintaining a
  // second list of constructor names that would drift with the interface table.
  for (const name of Object.getOwnPropertyNames(target)) {
    if (!/^[A-Z]/.test(name) || _ecmaScriptGlobals.has(name)) continue;
    try {
      const value = target[name];
      if (typeof value === 'function') setEnumerable(name, false);
    } catch (_error) {}
  }
  for (const name of _chromeNonEnumerableWindowObjects) setEnumerable(name, false);
}

// The initial navigator shim used a thin overlay prototype for per-page
// getters. Copy its descriptors into Navigator.prototype once every installer
// has run so one ordered WebIDL surface is observed by for-in.
function _flattenNavigatorPrototypeSurface() {
  const navigatorObject = globalThis.navigator;
  const prototype = globalThis.Navigator?.prototype;
  const overlay = navigatorObject && Object.getPrototypeOf(navigatorObject);
  if (!navigatorObject || !prototype || !overlay || overlay === prototype) return;
  for (const name of Object.getOwnPropertyNames(overlay)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(overlay, name);
      if (!descriptor || name === 'constructor') continue;
      Object.defineProperty(prototype, name, descriptor);
    } catch (_error) {}
  }
  try { Object.setPrototypeOf(navigatorObject, prototype); } catch (_error) {}
}

// Re-align globalThis own keys and interface prototypes to standard Chrome order.
try {
  if (typeof globalThis.__obscura_install_platform_surfaces === 'function') {
    globalThis.__obscura_install_platform_surfaces(globalThis);
  } else {
    _normalizeWindowObjectEnumerability(globalThis);
    _flattenNavigatorPrototypeSurface();
    _alignPropertiesOrder(globalThis, _chromeWindowKeyOrder);
  }
} catch (_) {}

// The global's own property names as the engine leaves them, before any page
// script runs. This is the surface a fresh same-origin frame's window has.
_pristineGlobalNames = new Set(_orderedWindowNames(Object.getOwnPropertyNames(globalThis)));

// V8 invokes the embedder prepare-stack callback instead of calling
// Error.prepareStackTrace directly. Keep CallSite inspection in JavaScript,
// where V8 owns the stack handles, and let the native callback only dispatch
// to this helper. This avoids re-entering Rust source-map state while V8 is
// materializing an Error.stack value.
Object.defineProperty(globalThis, '__obscura_filter_prepare_stack_trace', {
  configurable: false,
  enumerable: false,
  value: function(error, callsites) {
    const visible = [];
    for (let i = 0; i < callsites.length; i++) {
      const site = callsites[i];
      let source = null;
      try {
        if (site && typeof site.getScriptNameOrSourceURL === 'function') {
          source = site.getScriptNameOrSourceURL();
        }
        if ((source === null || source === undefined)
            && site && typeof site.getFileName === 'function') {
          source = site.getFileName();
        }
      } catch (_) {}
      if (!(typeof source === 'string'
            && (source.startsWith('<obscura:')
                || source.startsWith('<cdp-')
                || source.startsWith('ext:')
                || source.startsWith('deno:')))) {
        visible.push(site);
      }
    }
    const prepare = Error.prepareStackTrace;
    if (typeof prepare === 'function') {
      return prepare(error, visible);
    }
    let result = error && error.name ? String(error.name) : 'Error';
    if (error && error.message) result += ': ' + String(error.message);
    for (let i = 0; i < visible.length; i++) {
      let frame = 'native';
      try { frame = String(visible[i]); } catch (_) {}
      result += '\n    at ' + frame;
    }
    return result;
  },
});
