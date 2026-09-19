// Local tag name -> element interface identifier, for the HTML and SVG
// namespaces. Two consumers: the per-instance [object XXX] getter, and the
// per-interface constructor install at the end of this file.
//
// applet/basefont/bgsound have no window constructor in the passing Chrome
// censuses (149) nor in the 151 renderer trace: their legacy interfaces were
// removed, and the elements fall through to HTMLUnknownElement, so no
// interface is built or published for them.

(function _brandWebIDLInterfaces() {
  var names = [
    // Events
    'Event', 'CustomEvent', 'UIEvent', 'MouseEvent', 'KeyboardEvent',
    'FocusEvent', 'InputEvent', 'ErrorEvent', 'PointerEvent', 'WheelEvent',
    'CompositionEvent', 'AnimationEvent', 'TransitionEvent', 'PopStateEvent',
    'HashChangeEvent', 'MessageEvent', 'ProgressEvent', 'ClipboardEvent',
    'SubmitEvent', 'ToggleEvent', 'PromiseRejectionEvent', 'StorageEvent',
    'SecurityPolicyViolationEvent',
    'EventSource',
    // Core DOM interfaces own distinct prototypes.
    'Node', 'EventTarget', 'Element', 'Document', 'XMLDocument', 'DocumentFragment',
    'DocumentType', 'CharacterData', 'Text', 'Comment', 'CDATASection',
    'ProcessingInstruction', 'Attr', 'NamedNodeMap', 'NodeList',
    'HTMLCollection', 'DOMTokenList', 'ShadowRoot', 'Range', 'StaticRange',
    'TreeWalker', 'Selection', 'DOMParser', 'XMLSerializer', 'XPathResult',
    'CustomElementRegistry', 'ElementInternals', 'DOMException',
    // HTML element interfaces that own their prototype. The rest are aliases
    // of Element and are filtered out by the constructor check below.
    'HTMLFormElement', 'HTMLInputElement', 'HTMLImageElement', 'HTMLMediaElement',
    'HTMLVideoElement', 'HTMLAudioElement', 'HTMLObjectElement', 'HTMLTrackElement',
    'SVGElement', 'SVGGraphicsElement', 'SVGGeometryElement', 'SVGPathElement',
    'SVGSVGElement', 'SVGAnimatedString',
    'SVGTextContentElement', 'SVGTextPositioningElement', 'SVGTextElement',
    'SVGTSpanElement', 'SVGTextPathElement',
    'SVGAElement', 'SVGDefsElement', 'SVGForeignObjectElement', 'SVGGElement',
    'SVGImageElement', 'SVGSwitchElement', 'SVGSymbolElement', 'SVGUseElement',
    // Text tracks
    'TextTrack', 'TextTrackList', 'TextTrackCue', 'TextTrackCueList', 'VTTCue',
    // CSSOM
    'CSSStyleDeclaration', 'CSSRule', 'CSSStyleRule', 'CSSRuleList',
    'CSSStyleSheet', 'StyleSheetList', 'MediaQueryList',
    'FontFace', 'FontFaceSet',
    // Window plumbing
    'Window', 'Navigator', 'Location', 'History', 'Screen', 'Storage',
    'NetworkInformation', 'ValidityState',
    // Observers and animation
    'MutationObserver', 'PerformanceObserver', 'IntersectionObserver',
    'IntersectionObserverEntry', 'ResizeObserver', 'ResizeObserverEntry',
    'ResizeObserverSize', 'Animation', 'KeyframeEffect', 'DocumentTimeline',
    // Fetch, XHR and streams
    'Headers', 'Request', 'Response', 'FormData', 'AbortController',
    'AbortSignal', 'XMLHttpRequest', 'XMLHttpRequestEventTarget', 'XMLHttpRequestUpload',
    'ReadableStream', 'WritableStream', 'TransformStream',
    'TextEncoder', 'TextDecoder', 'TextEncoderStream', 'TextDecoderStream',
    'URL', 'URLSearchParams', 'URLPattern', 'WebSocket',
    // Files and crypto
    'Blob', 'File', 'FileReader', 'Crypto', 'SubtleCrypto', 'CryptoKey',
    // Workers and messaging
    'Worker', 'SharedWorker', 'MessageChannel', 'MessagePort',
    'BroadcastChannel', 'Scheduler', 'ServiceWorkerContainer',
    'ServiceWorker', 'ServiceWorkerRegistration', 'Worklet', 'AudioWorklet',
    'NavigationPreloadManager',
    // Trusted Types
    'TrustedTypePolicyFactory', 'TrustedTypePolicy', 'TrustedHTML',
    'TrustedScript', 'TrustedScriptURL',
    // Media
    'TimeRanges', 'VideoPlaybackQuality', 'MediaSource',
    // Graphics and geometry
    'CanvasRenderingContext2D', 'WebGLRenderingContext',
    'WebGL2RenderingContext', 'OffscreenCanvas', 'Path2D', 'ImageData',
    'ImageBitmap', 'DOMMatrix', 'DOMPoint', 'DOMRect', 'DOMRectReadOnly',
    'DOMRectList',
    // Performance timeline. These are real JS classes rather than host
    // interfaces, so nothing else stamps them; without the tag every entry
    // stringifies as `[object Object]` while `constructor.name` is correct,
    // a pair no browser produces. The chrome interface table in
    // surface-finalize.js already declares the tag each one should carry.
    'PerformanceEntry', 'PerformanceMark', 'PerformanceMeasure',
    'PerformanceResourceTiming', 'PerformanceNavigationTiming',
    'PerformancePaintTiming', 'PerformanceLongTaskTiming',
    'PerformanceLongAnimationFrameTiming', 'PerformanceElementTiming',
    'PerformanceEventTiming', 'PerformanceServerTiming',
    'PerformanceObserverEntryList', 'PerformanceObserver',
    'PerformanceTiming', 'PerformanceNavigation',
    'LargestContentfulPaint', 'LayoutShift', 'LayoutShiftAttribution',
    'TaskAttributionTiming',
    // Media, storage and the long tail of stubs
    'MediaStream', 'MediaStreamTrack', 'AudioBuffer', 'AudioContext',
    'OfflineAudioContext', 'SpeechSynthesisUtterance', 'Notification',
    'ContentIndex', 'IDBKeyRange', 'RTCPeerConnection', 'RTCIceCandidate',
    'RTCSessionDescription',
  ];
  // Two aliasing shapes have to be filtered, and they need different tests.
  var branded = new Set();
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var ctor;
    try { ctor = globalThis[name]; } catch (e) { continue; }
    if (typeof ctor !== 'function' || !ctor.prototype) { continue; }
    // Shape 1: distinct constructors sharing one prototype object, as in
    // `globalThis.HTMLDivElement = Element`. Branding through the alias would
    // stamp the wrong identifier on Element.prototype, so only the
    // constructor that owns the prototype may name it. Order-independent.
    if (ctor.prototype.constructor !== ctor) { continue; }
    // Shape 2: one constructor published under two names. Here the ownership
    // test passes for both names, so the first name wins and the second is dropped --
    // otherwise the later name would also rewrite `.name` on the shared
    // constructor and undo the earlier brand.
    if (branded.has(ctor.prototype)) { continue; }
    branded.add(ctor.prototype);
    if (ctor.name !== name) {
      try {
        Object.defineProperty(ctor, 'name', {
          value: name, writable: false, enumerable: false, configurable: true,
        });
      } catch (e) {}
    }
    // Interfaces that already declare their own tag (several do it with a
    // getter in the class body) keep it; re-defining would only churn the
    // descriptor shape.
    if (Object.prototype.hasOwnProperty.call(ctor.prototype, Symbol.toStringTag)) { continue; }
    try {
      Object.defineProperty(ctor.prototype, Symbol.toStringTag, {
        value: name, writable: false, enumerable: false, configurable: true,
      });
    } catch (e) {}
  }
})();

// Per-element [object XXX] tags. Every DOM element here is an instance of the
// single Element class, so the interface-table brand would answer the generic
// "Element" for a <div>. Chrome answers the concrete interface name, computed
// from the tag; a prototype getter reproduces that without stamping an own
// symbol on every instance (Chrome has none).
(function _installPerElementToStringTags() {
  const namespaceOf = (el) => {
    try { return el.namespaceURI || el[_nsSym] || 'http://www.w3.org/1999/xhtml'; }
    catch (e) { return 'http://www.w3.org/1999/xhtml'; }
  };
  try {
    Object.defineProperty(Element.prototype, Symbol.toStringTag, {
      get() {
        try {
          const name = this.localName;
          if (!name) return 'Element';
          if (namespaceOf(this) === 'http://www.w3.org/2000/svg') {
            return SVG_TAGS[name] || 'SVGElement';
          }
          return HTML_TAGS[name] || 'HTMLElement';
        } catch (e) { return 'Element'; }
      },
      configurable: true,
    });
  } catch (e) {}
  // Documents: an HTML document answers [object HTMLDocument].
  try {
    Object.defineProperty(Document.prototype, Symbol.toStringTag, {
      get() {
        try {
          const root = this.documentElement;
          return root && root.localName === 'html' ? 'HTMLDocument' : 'Document';
        } catch (e) { return 'Document'; }
      },
      configurable: true,
    });
  } catch (e) {}
})();




// Late interface bindings. The media modules build their objects before the
// interface shells above exist, so instanceof bindings that belong to page
// time land here: the audio context class chain, and the speechSynthesis
// singleton's interface prototype.
(function _bindLateInterfaces() {
  try {
    if (typeof globalThis.BaseAudioContext === 'function') {
      // The lightweight AudioContext implementation keeps its factory
      // methods on AudioContext.prototype.  Chrome exposes those factories
      // on BaseAudioContext, and OfflineAudioContext inherits that prototype
      // directly.  Copy the shared methods before rebasing the child classes,
      // otherwise OfflineAudioContext loses createOscillator() and friends.
      const audioPrototype = globalThis.AudioContext && globalThis.AudioContext.prototype;
      const basePrototype = globalThis.BaseAudioContext.prototype;
      if (audioPrototype) {
        for (const key of Object.getOwnPropertyNames(audioPrototype)) {
          if (key === 'constructor' || !(key.startsWith('create') || key === 'decodeAudioData')) {
            continue;
          }
          if (!Object.prototype.hasOwnProperty.call(basePrototype, key)) {
            const descriptor = Object.getOwnPropertyDescriptor(audioPrototype, key);
            if (descriptor) Object.defineProperty(basePrototype, key, descriptor);
          }
        }
      }
      for (const name of ['AudioContext', 'OfflineAudioContext']) {
        const ctor = globalThis[name];
        if (typeof ctor === 'function'
            && Object.getPrototypeOf(ctor.prototype) !== globalThis.BaseAudioContext.prototype) {
          Object.setPrototypeOf(ctor.prototype, globalThis.BaseAudioContext.prototype);
        }
      }
    }
  } catch (_e) {}
  try {
    if (globalThis.speechSynthesis && typeof globalThis.SpeechSynthesis === 'function'
        && !(globalThis.speechSynthesis instanceof globalThis.SpeechSynthesis)) {
      Object.setPrototypeOf(globalThis.speechSynthesis, globalThis.SpeechSynthesis.prototype);
    }
  } catch (_e) {}
})();

// Chrome's built-in-AI interfaces expose static availability()/create() even
// when no model is downloaded. The auto-generated interface shells have the
// constructor but neither static, so a feature probe reading
// `Summarizer.availability` got undefined -- a value no Chrome produces --
// and calling it threw. Stock Chrome resolves availability to "unavailable"
// when the model is absent (verified against the passing-side reference).
(function _installAiStatics() {
  if (typeof _markNative !== 'function') return;
  const statics = ['Summarizer', 'LanguageDetector', 'Translator', 'Writer',
    'Proofreader', 'Prompt'];
  for (const name of statics) {
    const ctor = globalThis[name];
    if (typeof ctor !== 'function') continue;
    if (typeof ctor.availability !== 'function') {
      try {
        Object.defineProperty(ctor, 'availability', {
          value: _markNative(function availability() {
            return Promise.resolve('unavailable');
          }),
          writable: true, enumerable: true, configurable: true,
        });
      } catch (_e) {}
    }
    if (typeof ctor.create !== 'function') {
      try {
        Object.defineProperty(ctor, 'create', {
          value: _markNative(function create() {
            return Promise.reject(new DOMException(
              'Not supported', 'NotSupportedError'));
          }),
          writable: true, enumerable: true, configurable: true,
        });
      } catch (_e) {}
    }
  }
})();

// Every element interface owns a distinct prototype, and that prototype
// carries an own `constructor` pointing back at the interface, which is what
// WebIDL specifies: `document.createElement('div').constructor.name` is
// "HTMLDivElement" and
// `Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'constructor').value`
// is HTMLDivElement. Obscura published most of the HTML family as an alias of
// Element (`globalThis.HTMLTableElement = Element`), so the descriptor
// resolved through the prototype chain and answered "Element" -- a value no
// browser produces, readable in one line. Canvas, input, form, iframe, link,
// body, the media family and the SVG family already own a class; this builds
// one for every other interface the tag table names, and registers
// tag -> interface for the wrapper factory in env/dom/iframe-element.js.
//
// The parent of every HTML class here is a real HTMLElement interface whose
// prototype hangs off Element.prototype -- Chrome's HTML lattice answers
// `HTMLDivElement > HTMLElement > Element > Node`, and a challenge-side
// inspection probe that walks the chain (or stringifies an anchor) reads the
// difference directly. HTMLElement itself used to be a bare alias of Element
// (env/css/supports.js), which made every `instanceof HTMLElement` answer true
// through the alias while no prototype chain actually contained it.
// Interfaces with a deeper parent (HTMLMediaElement's subclasses) reach this
// point as real implementations: their own parent is repointed onto
// HTMLElement.prototype below, and their subclasses follow transitively.
(function _installElementInterfaces() {
  const ElementCtor = globalThis.Element;
  if (typeof ElementCtor !== 'function' || !ElementCtor.prototype) return;
  // The real HTMLElement interface. Direct script construction throws; the
  // generated interfaces reach it through super(nid), and tags Chrome maps
  // straight onto HTMLElement (b/i/abbr/...) are constructed internally with
  // the interface key, so the guard keys on new.target plus that key.
  const HTMLElementCtor = { HTMLElement: class extends ElementCtor {
      constructor(nid, key) {
        if (new.target === HTMLElementCtor
            && (arguments.length !== 2 || key !== _elementInterfaceKey)) {
          throw new TypeError("Failed to construct 'HTMLElement': Illegal constructor");
        }
        super(nid);
      }
      get [Symbol.toStringTag]() { return 'HTMLElement'; }
    } }['HTMLElement'];
  Object.defineProperty(HTMLElementCtor, 'length', { value: 0, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: _markNative(HTMLElementCtor), writable: true, enumerable: false, configurable: true,
  });
  const install = (name) => {
    const C = { [name]: class extends HTMLElementCtor {
        constructor(nid, key) {
          // Internal wrappers pass the node id and env/dom/iframe-element.js's
          // construction key; page code reaches the TypeError a generated
          // binding throws for an interface with no constructor.
          if (arguments.length !== 2 || key !== _elementInterfaceKey) {
            throw new TypeError("Failed to construct '" + name + "': Illegal constructor");
          }
          super(nid);
        }
        get [Symbol.toStringTag]() { return name; }
      } }[name];
    // Generated bindings have no declared arguments, so theirs is 0.
    Object.defineProperty(C, 'length', { value: 0, configurable: true });
    Object.defineProperty(globalThis, name, {
      value: _markNative(C), writable: true, enumerable: false, configurable: true,
    });
    return C;
  };
  const built = Object.create(null);
  // HTMLUnknownElement must exist before the tag loop: the removed legacy
  // interfaces (applet, basefont, bgsound) fall through to it, and every tag
  // mapping to it has to share the exact class the global publishes.
  built.HTMLUnknownElement = install('HTMLUnknownElement');
  const interfaceFor = (name) => {
    if (name === 'HTMLElement') return HTMLElementCtor;
    const existing = globalThis[name];
    if (typeof existing === 'function' && existing !== ElementCtor
        && existing !== HTMLElementCtor && !_chromeInterfaceShells.has(name)) {
      // A real implementation owns this interface; only the tag binding is
      // new.
      return existing;
    }
    if (!built[name]) built[name] = install(name);
    return built[name];
  };
  for (const tag of Object.keys(HTML_TAGS)) {
    _elementInterfaceByTag[tag] = interfaceFor(HTML_TAGS[tag]);
  }
  // Real element implementations were declared `extends Element` before the
  // real HTMLElement existed (env/html/*, env/media/*, env/dom/iframe-element.js).
  // Repoint their prototype and static chains onto HTMLElement so the whole
  // lattice answers Chrome's walk; subclasses of these (HTMLAudioElement and
  // HTMLVideoElement under HTMLMediaElement) follow transitively. The guard
  // keeps anything already republished on HTMLElement untouched.
  for (const name of ['HTMLLinkElement', 'HTMLInputElement', 'HTMLFormElement',
    'HTMLIFrameElement', 'HTMLCanvasElement', 'HTMLTrackElement',
    'HTMLMediaElement', 'HTMLImageElement', 'HTMLObjectElement', 'HTMLBodyElement']) {
    const C = globalThis[name];
    if (typeof C !== 'function' || !C.prototype) continue;
    if (Object.getPrototypeOf(C.prototype) === ElementCtor.prototype) {
      Object.setPrototypeOf(C.prototype, HTMLElementCtor.prototype);
      if (Object.getPrototypeOf(C) === ElementCtor) Object.setPrototypeOf(C, HTMLElementCtor);
    }
  }
  // The wrapper for a local name no interface claims. Chrome answers
  // HTMLUnknownElement, except for a valid custom element name, which is an
  // ordinary HTMLElement until a CustomElementRegistry definition upgrades
  // it. HTMLUnknownElement was another Element alias, so a class is needed
  // before it can be a wrapper.
  _elementInterfaceUnknownTag = function (localName) {
    return _isValidCustomElementName(localName)
      ? HTMLElementCtor
      : built.HTMLUnknownElement;
  };
  // HTMLHyperlinkElementUtils stringifier: Chrome's <a>/<area> `toString` is
  // the IDL `href` (empty string when the attribute is absent), so
  // `String(anchor)` never yields "[object HTMLAnchorElement]". The href
  // accessor lives on Element.prototype here and already answers the resolved
  // absolute URL / "" pair.
  const hyperlinkStringifier = (name) => {
    const C = globalThis[name];
    if (typeof C !== 'function' || !C.prototype) return;
    Object.defineProperty(C.prototype, 'toString', {
      value: function toString() {
        const h = this.href;
        return h === undefined || h === null ? '' : String(h);
      },
      writable: true, enumerable: true, configurable: true,
    });
  };
  hyperlinkStringifier('HTMLAnchorElement');
  hyperlinkStringifier('HTMLAreaElement');
})();

// Final native-presentation sweep. _markBuiltinsNative (surface-finalize)
// walks constructors and prototypes, but not constructor statics, window
// accessors, or anything installed after it -- and this module's SVG
// geometry installs land exactly there. Every function left unmarked answers
// Function.prototype.toString with its bootstrap source, which is what an
// anti-tamper probe compares against a fresh realm's reference. Re-walking
// is idempotent: the registries behind _markNative are a WeakSet/WeakMap.
//
// The body is a named function, not an IIFE-only pass, because the surface
// does not stop changing when this module finishes: __obscura_init replaces
// visualViewport, re-installs viewport and child-context accessors, and a
// fresh runtime's ECMAScript intrinsics (WebAssembly) are not the snapshot
// objects this module walked. It runs here once and again at the end of
// __obscura_init (config/page-init.js), after that install work is done.
// filterToPristine: when true, only globals present at init-end (the
// _pristineGlobalNames census, config/page-init.js) are walked. A page's own
// global functions -- which a browser reports with their source, not
// "[native code]" -- must never be marked, so any pass that runs after page
// scripts could have run must set this. The boot-time call uses false; the
// lazy toString trigger and the frame-realm init pass use true.
function _obscuraMarkSurfaceNative(filterToPristine) {
  if (typeof _markNative !== 'function') return;
  const pristine = filterToPristine ? _pristineGlobalNames : null;
  const known = (name) => !pristine || pristine.has(name);
  const seen = new Set();
  const nameOf = (fn, name) => {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (_e) {}
  };
  // The rename parameter is only true on WebIDL interface objects and the
  // Window's own slots, where Chrome derives an accessor's visible name from
  // its slot ("get memory" on MemoryInfo.prototype). Namespace objects play
  // by the other convention: Chrome's console.memory accessor keeps an empty
  // .name, so marking must not invent one there.
  function markMembers(owner, rename) {
    // Reflect.ownKeys, not getOwnPropertyNames: the [Symbol.toStringTag]
    // getters on interface prototypes and Window[Symbol.hasInstance] are as
    // page-visible as any string-keyed member, and an unmarked one answers
    // toString with its bootstrap source.
    let keys;
    try { keys = Reflect.ownKeys(owner); } catch (_e) { return; }
    for (const key of keys) {
      let d;
      try { d = Object.getOwnPropertyDescriptor(owner, key); } catch (_e) { continue; }
      if (!d) continue;
      if (typeof d.value === 'function') {
        // An anonymous function installed under a slot (URL.createObjectURL's
        // plain assignment drops the name) must carry the slot's name.
        if (rename && typeof key === 'string' && d.value.name === '') nameOf(d.value, key);
        _markNative(d.value);
      }
      if (typeof d.get === 'function') {
        if (typeof key === 'string') {
          // 'get'/'set' are shorthand-definition artifacts (`get() {}`), never
          // the accessor's real name; Chrome reports "get <key>".
          if (rename && (d.get.name === '' || d.get.name === 'get')) nameOf(d.get, 'get ' + key);
          if (!_nativeStr.has(d.get)) _markNativeAs(d.get, 'function get ' + key + '() { [native code] }');
        } else {
          // Symbol-keyed accessors: V8 renders the computed name
          // ("get [Symbol.toStringTag]"), which _markNative reproduces
          // verbatim; a string template would mangle it.
          if (rename && (d.get.name === '' || d.get.name === 'get')) {
            nameOf(d.get, 'get ' + (key.description ? '[' + key.description + ']' : ''));
          }
          _markNative(d.get);
        }
      }
      if (typeof d.set === 'function') {
        if (typeof key === 'string') {
          if (rename && (d.set.name === '' || d.set.name === 'set')) nameOf(d.set, 'set ' + key);
          if (!_nativeStr.has(d.set)) _markNativeAs(d.set, 'function set ' + key + '() { [native code] }');
        } else {
          if (rename && (d.set.name === '' || d.set.name === 'set')) {
            nameOf(d.set, 'set ' + (key.description ? '[' + key.description + ']' : ''));
          }
          _markNative(d.set);
        }
      }
    }
  }
  function walkConstructor(ctor) {
    if (typeof ctor !== 'function') return;
    _markNative(ctor);
    // Static interface members (URL.createObjectURL, URL.parse) are as
    // page-visible as prototype members.
    markMembers(ctor, true);
    const proto = ctor.prototype;
    if (!proto || seen.has(proto)) return;
    seen.add(proto);
    markMembers(proto, true);
    // Factory-built interface chains: the WebGL context class behind its
    // public constructor, the frame _ScopedDocument under Document. Their
    // members are as page-visible as the interface's own.
    let parent = null;
    try { parent = Object.getPrototypeOf(proto); } catch (_e) {}
    for (let hop = 0; hop < 8 && parent; hop++) {
      if (parent === Object.prototype || parent === Function.prototype) break;
      if (seen.has(parent)) break;
      seen.add(parent);
      markMembers(parent, true);
      try { parent = Object.getPrototypeOf(parent); } catch (_e) { break; }
    }
  }
  // Namespace and instance objects sitting on the global are as page-visible
  // as the constructors: WebAssembly.instantiateStreaming, CSS.supports,
  // console.error, navigation.*, caches.*, indexedDB.*, visualViewport.*,
  // speechSynthesis.*, chrome.runtime.*, document.implementation.*, the
  // Location accessors, screen/navigator sub-objects all used to answer
  // toString with bootstrap source. Walk them depth- and node-bounded with
  // cycle protection (window === window.window). Reading an accessor here
  // descends into the object it returns; every getter on the bootstrap
  // surface is pure, and getters that mint fresh objects mark each instance
  // again at their construction site (_markNativeObject). Prototype chains
  // are followed so factory-built instances (the frame _ScopedDocument, the
  // WebGL context class behind its public interface) are covered too.
  (function _markGlobalObjectSurfaces() {
    // Runtime-only. Descending into window namespace objects while the
    // snapshot is being created reads lazily-backed getters in that alien
    // environment and perturbs the frozen heap in ways runtime behavior
    // depends on. `document` does not exist during the snapshot build and
    // exists in every live Window realm by the time this pass can run.
    if (typeof globalThis.document === 'undefined') return;
    const visited = new Set();
    let budget = 20000;
    const seenProtos = new Set();
    function markProtoChain(obj) {
      let p = obj;
      for (let hop = 0; hop < 8 && p; hop++) {
        if (p === Object.prototype || p === Function.prototype) break;
        if (seenProtos.has(p)) break;
        seenProtos.add(p);
        markMembers(p, false);
        try { p = Object.getPrototypeOf(p); } catch (_e) { break; }
      }
    }
    function scan(obj, depth) {
      if (!obj || budget <= 0 || depth > 4) return;
      if (typeof obj !== 'object' && typeof obj !== 'function') return;
      if (visited.has(obj)) return;
      visited.add(obj);
      budget--;
      markMembers(obj, false);
      markProtoChain(obj);
      let keys;
      try { keys = Reflect.ownKeys(obj); } catch (_e) { return; }
      for (const key of keys) {
        let d;
        try { d = Object.getOwnPropertyDescriptor(obj, key); } catch (_e) { continue; }
        if (!d) continue;
        let v;
        if ('value' in d) v = d.value;
        else {
          try { v = obj[key]; } catch (_e) { continue; }
        }
        if (typeof v === 'function') {
          if (!d.get && !d.set) walkConstructor(v);
        } else if (v && typeof v === 'object') {
          scan(v, depth + 1);
        }
      }
    }
    // A curated list rather than a blind walk over every global getter:
    // reading arbitrary window accessors here perturbs the resource
    // pipeline's startup (the load-event race the image lifecycle tests
    // exercise), and the census of namespace surfaces is stable. New
    // namespace surfaces must be added here; their construction sites
    // should also mark fresh instances with _markNativeObject.
    const allSurfaces = [
      'navigation', 'caches', 'indexedDB', 'visualViewport', 'CSS',
      'chrome', 'speechSynthesis', 'console', 'performance', 'crypto',
      'screen', 'history', 'scheduler', 'customElements', 'cookieStore',
      'styleMedia', 'external', 'trustedTypes', 'localStorage',
      'sessionStorage', 'location', 'document', 'navigator', 'Deno',
      '__bootstrap',
    ];
    for (const name of allSurfaces) {
      if (!known(name)) continue;
      let val;
      try { val = globalThis[name]; } catch (_e) { continue; }
      if (val && (typeof val === 'object')) scan(val, 1);
    }
  })();
  const names = Object.getOwnPropertyNames(globalThis);
  for (const name of names) {
    if (!/^[A-Z]/.test(name)) continue;
    if (!known(name)) continue;
    let val;
    try { val = globalThis[name]; } catch (_e) { continue; }
    walkConstructor(val);
  }
  // Window's own slots follow the same rules: nameless shims take the slot's
  // name (Chrome reports setTimeout.name === "setTimeout") and its accessors
  // answer with the `get <key>` shape every other accessor uses. Under the
  // pristine filter, page-added globals are skipped entirely: a page
  // function must answer toString with its source, exactly as a browser
  // does, so only slots the engine itself installed are touched.
  if (!filterToPristine) {
    markMembers(globalThis, true);
  } else {
    // Page-added globals keep their own identity: a page function must
    // answer toString with its source, exactly as a browser does. Only
    // slots the engine itself installed (the pristine census) are touched.
    const own = Object.getOwnPropertyNames(globalThis);
    for (const name of own) {
      if (!pristine.has(name)) continue;
      let val;
      try { val = globalThis[name]; } catch (_e) { continue; }
      // window/self/frames/globalThis alias the global itself; marking it
      // here would sweep up every page-added global function with it.
      if (val === globalThis) continue;
      if (val && (typeof val === 'object')) markMembers(val, true);
    }
  }
}
// The boot-time pass runs only where the whole surface installs inline (the
// main context at snapshot build, non-deferring realms); its registry marks
// survive the snapshot restore, so the main realm is premarked from boot. A
// deferred-surface frame realm defers the sweep to its single eager pass at
// init completion (config/page-init.js): one pass per realm instead of two.
if (!globalThis.__obscura_frame_defers_surface) _obscuraMarkSurfaceNative();
// Exported for the core-half page-init scope: this function is declared
// inside the deferred-surface wrapper, so `__obscura_init` (which re-installs
// visualViewport, viewport accessors and the window frame indices after this
// module has run) cannot reach it as a lexical binding. Same pattern as
// __obscura_install_window_surface above.
Object.defineProperty(globalThis, '__obscura_mark_surface_native', {
  value: () => _obscuraMarkSurfaceNative(true),
  writable: false,
  enumerable: false,
  configurable: false,
});
// Lazy trigger for the same sweep: installed for the Function.prototype
//.toString override in config/bootstrap.js. This is the pre-boot safety net
// only -- a restored context carries it until its first __obscura_init (or
// the worker prep), which marks the surface eagerly and then deletes the
// hook, so a realm with a complete surface can never fire the deep scan from
// inside page execution (batch 20: the challenge census stringifies page
// functions, and the first unmarked probe used to run the full sweep inside
// its own timed window; profile Step 317, uGyjw9 15 -> 295-526).
Object.defineProperty(globalThis, '__obscura_lazy_mark_surface', {
  value: () => _obscuraMarkSurfaceNative(true),
  writable: true,
  enumerable: false,
  configurable: true,
});
