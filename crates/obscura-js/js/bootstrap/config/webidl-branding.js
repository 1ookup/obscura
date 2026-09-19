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

// SVGTextContentElement's character-position API. Chrome exposes it on the
// interface; Obscura had none of it, so a probe that walks a text run one
// character at a time -- which is how the challenge builds its ascending
// per-character position list -- collected an empty list instead of the
// advances a browser reports. This runs here rather than next to the
// measurement methods in env/media/canvas.js because the reflection accessors
// below want the final interface objects; env/html/svg-elements.js has
// already defined SVGTextContentElement as a real class, and <text>/<tspan>/
// <textPath> inherit it through the interface lattice.
(function _installSvgTextContentGeometry() {
  if (typeof _measureTextBox !== 'function') return;
  const owner = globalThis.SVGTextContentElement && globalThis.SVGTextContentElement.prototype;
  if (!owner || owner === Element.prototype) return;
  const geometry = {
    getNumberOfChars() {
      // Without a rendering box Chrome reads the run as zero characters, so
      // every count here follows the rendered check, not the text content.
      if (_svgUnrendered(this)) return 0;
      return _svgTextContent(this).length;
    },
    getStartPositionOfChar(index) {
      if (_svgUnrendered(this)) _svgThrowIndexSize('getStartPositionOfChar', index);
      // Chrome anchors the character positions on the element's x list origin
      // (a run at x=32 starts its position list at 32), not at user-space 0,
      // and answers SVGPoint instances, not plain records. Both halves of a
      // surrogate pair answer the cluster's start position.
      const offset = _svgAttrOffset(this, 'x');
      const i = _svgCharacterIndex(this, 'getStartPositionOfChar', index);
      const [spanStart] = _svgCharClusterSpan(_svgTextContent(this), i);
      return _svgPointLike({ x: offset + _svgAdvanceTo(this, spanStart), y: 0 });
    },
    getEndPositionOfChar(index) {
      if (_svgUnrendered(this)) _svgThrowIndexSize('getEndPositionOfChar', index);
      const i = _svgCharacterIndex(this, 'getEndPositionOfChar', index);
      const text = _svgTextContent(this);
      const [spanStart, spanEnd] = _svgCharClusterSpan(text, i);
      const char = text.slice(spanStart, spanEnd);
      return _svgPointLike({ x: _svgAttrOffset(this, 'x') + _svgAdvanceTo(this, spanStart) + _measureTextBox(char, _svgMeasurementFont(this)).width, y: 0 });
    },
    getRotationOfChar(index) {
      if (_svgUnrendered(this)) _svgThrowIndexSize('getRotationOfChar', index);
      _svgCharacterIndex(this, 'getRotationOfChar', index);
      return 0;
    },
    getCharNumAtPosition(point) {
      const x = point && Number(point.x);
      if (!Number.isFinite(x)) return -1;
      if (_svgUnrendered(this)) return -1;
      const text = _svgTextContent(this);
      for (let i = 0; i < text.length; i++) {
        if (x < _svgAdvanceTo(this, i + 1)) return i;
      }
      return -1;
    },
    // Chrome's SVG 1.1 name (selectSubStringLength does not exist there --
    // local headless-Chrome oracle). Selection itself needs layout hit-testing
    // this engine does not model for SVG runs; validating the index the way
    // Chrome does and returning cleanly is the observable behaviour for an
    // empty selection surface.
    selectSubString(index, count) {
      if (_svgUnrendered(this)) _svgThrowIndexSize('selectSubString', index);
      _svgCharacterIndex(this, 'selectSubString', index);
      if (count !== undefined && count < 0) {
        throw new DOMException(
          'The number provided (' + count + ') is negative.',
          'IndexSizeError',
        );
      }
    },
  };
  for (const name of Object.keys(geometry)) {
    Object.defineProperty(owner, name, {
      value: geometry[name], writable: true, enumerable: false, configurable: true,
    });
  }
  // WebIDL constants live on the interface prototype object for the SVG 1.1
  // interfaces, and Chrome mirrors them on the constructor (local Chrome
  // oracle: own keys on both).
  const constants = [['LENGTHADJUST_UNKNOWN', 0],
                     ['LENGTHADJUST_SPACING', 1],
                     ['LENGTHADJUST_SPACINGANDGLYPHS', 2]];
  for (const [name, value] of constants) {
    Object.defineProperty(owner, name, {
      value, writable: true, enumerable: true, configurable: false,
    });
    const ctor = globalThis.SVGTextContentElement;
    if (ctor && !Object.prototype.hasOwnProperty.call(ctor, name)) {
      Object.defineProperty(ctor, name, {
        value, writable: true, enumerable: true, configurable: false,
      });
    }
  }
  // Reflected attributes. Chrome caches the reflection objects per element
  // (text.textLength === text.textLength) and keeps them in sync with the
  // attribute, so the getters memoize the wrapper per slot in a WeakMap and
  // refresh the value on each read. Instances are branded from the shells.
  const reflectionCache = new WeakMap();
  const slotOf = (el, slot, brand, initial) => {
    let slots = reflectionCache.get(el);
    if (slots === undefined) { slots = {}; reflectionCache.set(el, slots); }
    let inst = slots[slot];
    if (inst === undefined) {
      inst = Object.create(brandedOf(brand));
      inst.baseVal = initial;
      inst.animVal = initial;
      slots[slot] = inst;
    }
    return inst;
  };
  const brandedOf = (name) => {
    const ctor = globalThis[name];
    return (ctor && typeof ctor === 'function' && ctor.prototype)
      ? ctor.prototype : Object.prototype;
  };
  const attrNumber = (el, attr, fallback) => {
    try {
      const v = el.getAttribute(attr);
      if (v == null || v === '') return fallback;
      const n = Number(String(v).trim().split(/[\s,]+/)[0]);
      return Number.isFinite(n) ? n : fallback;
    } catch (_e) { return fallback; }
  };
  const attrEnum = (el, attr) => {
    try {
      const v = el.getAttribute(attr);
      if (v === 'spacingAndGlyphs') return 2;
      if (v === 'spacing') return 1;
      return 1; // spec initial value: lengthAdjust="spacing"
    } catch (_e) { return 1; }
  };
  Object.defineProperty(owner, 'textLength', {
    get() {
      const n = attrNumber(this, 'textLength', 0);
      const len = { value: n };
      const inst = slotOf(this, 'textLength', 'SVGAnimatedLength', len);
      inst.baseVal = len;
      inst.animVal = len;
      return inst;
    }, configurable: true, enumerable: true,
  });
  Object.defineProperty(owner, 'lengthAdjust', {
    get() {
      const n = attrEnum(this, 'lengthAdjust');
      const inst = slotOf(this, 'lengthAdjust', 'SVGAnimatedEnumeration', 1);
      inst.baseVal = n;
      inst.animVal = n;
      return inst;
    }, configurable: true, enumerable: true,
  });
})();

// SVGTextPositioningElement's x/y/dx/dy/rotate reflection. Chrome answers
// SVGAnimatedLengthList instances (SVGAnimatedNumberList for rotate) whose
// baseVal supports numberOfItems/getItem; the challenge sets x/y as
// attributes and reads positions back through the measurement API, but a
// census probe reading text.x.baseVal.numberOfItems must not see undefined.
(function _installSvgTextPositioningReflection() {
  const owner = globalThis.SVGTextPositioningElement
    && globalThis.SVGTextPositioningElement.prototype;
  if (!owner || owner === Element.prototype) return;
  const reflectionCache = new WeakMap();
  const brandedOf = (name) => {
    const ctor = globalThis[name];
    return (ctor && typeof ctor === 'function' && ctor.prototype)
      ? ctor.prototype : Object.prototype;
  };
  const parseList = (el, attr) => {
    try {
      const raw = el.getAttribute(attr);
      if (raw == null || raw === '') return [];
      return String(raw).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    } catch (_e) { return []; }
  };
  const lengthListOf = (values) => {
    const list = {
      numberOfItems: values.length,
      getItem(i) {
        if (i < 0 || i >= values.length) {
          throw new DOMException('Index out of range', 'IndexSizeError');
        }
        return { value: values[i] };
      },
    };
    for (let i = 0; i < values.length; i++) list[i] = { value: values[i] };
    return list;
  };
  const animatedListOf = (el, attr, kind) => {
    // Chrome keeps one reflection object per element/attribute
    // (text.x === text.x); the underlying list refreshes on each read so
    // attribute writes stay visible.
    let perEl = reflectionCache.get(el);
    if (perEl === undefined) { perEl = {}; reflectionCache.set(el, perEl); }
    let inst = perEl[attr];
    if (inst === undefined) {
      inst = Object.create(brandedOf(kind));
      perEl[attr] = inst;
    }
    const values = parseList(el, attr);
    inst.baseVal = lengthListOf(values);
    inst.animVal = lengthListOf(values);
    return inst;
  };  for (const attr of ['x', 'y', 'dx', 'dy']) {
    Object.defineProperty(owner, attr, {
      get() { return animatedListOf(this, attr, 'SVGAnimatedLengthList'); },
      configurable: true, enumerable: true,
    });
  }
  Object.defineProperty(owner, 'rotate', {
    get() { return animatedListOf(this, 'rotate', 'SVGAnimatedNumberList'); },
    configurable: true, enumerable: true,
  });
})();

// Geometry producers hand back plain records, so `Object.prototype.toString`
// on a rect reads `[object Object]` where a browser reads `[object DOMRect]`,
// and `rect instanceof DOMRect` is false. The tag alone does not help: the
// value has to actually be an instance. Re-wrap the producer instead of
// rewriting the layout path.
(function _brandGeometryResults() {
  if (typeof DOMRect !== 'function' || typeof _markNative !== 'function') return;
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype, 'getBoundingClientRect');
  if (!descriptor || typeof descriptor.value !== 'function') return;
  const call = descriptor.value;
  try {
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      value: _markNative(function () {
        const result = call.apply(this, arguments);
        if (result == null || typeof result.x !== 'number'
            || typeof result.width !== 'number') return result;
        if (result instanceof DOMRect) return result;
        // Chrome's layout engine clamps every box at LayoutUnit's maximum;
        // a magnitude no browser can produce (an overflowing authored width
        // that reached layout) is a renderer fingerprint.
        const clampBox = (v) => (!Number.isFinite(v) || Math.abs(v) > 33554430) ? 33554430 : v;
        const branded = new DOMRect(
          clampBox(result.x), clampBox(result.y), clampBox(result.width), clampBox(result.height));
        // `scrollIntoView` marks a viewport-fixed box on the rect it reads back
        // and skips the scroll for it. The branded value has to carry that
        // marker, or a fixed subtree starts moving the document. The marker
        // lives in a WeakSet: Chrome's rects carry no own properties, and an
        // own flag here would hand the own-key census a name.
        if (result.__obscuraViewportFixed) OBSCURA_VIEWPORT_FIXED_RECTS.add(branded);
        return branded;
      }),
      writable: true, enumerable: false, configurable: true,
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
(function _markRemainingBuiltinsNative() {
  if (typeof _markNative !== 'function') return;
  const seen = new Set();
  const nameOf = (fn, name) => {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (_e) {}
  };
  function markMembers(owner) {
    let keys;
    try { keys = Object.getOwnPropertyNames(owner); } catch (_e) { return; }
    for (const key of keys) {
      let d;
      try { d = Object.getOwnPropertyDescriptor(owner, key); } catch (_e) { continue; }
      if (!d) continue;
      if (typeof d.value === 'function') {
        // An anonymous function installed under a slot (URL.createObjectURL's
        // plain assignment drops the name) must carry the slot's name.
        if (d.value.name === '') nameOf(d.value, key);
        _markNative(d.value);
      }
      if (typeof d.get === 'function') {
        // 'get'/'set' are shorthand-definition artifacts (`get() {}`), never
        // the accessor's real name; Chrome reports "get <key>".
        if (d.get.name === '' || d.get.name === 'get') nameOf(d.get, 'get ' + key);
        if (!_nativeStr.has(d.get)) _markNativeAs(d.get, 'function get ' + key + '() { [native code] }');
      }
      if (typeof d.set === 'function') {
        if (d.set.name === '' || d.set.name === 'set') nameOf(d.set, 'set ' + key);
        if (!_nativeStr.has(d.set)) _markNativeAs(d.set, 'function set ' + key + '() { [native code] }');
      }
    }
  }
  function walkConstructor(ctor) {
    if (typeof ctor !== 'function') return;
    _markNative(ctor);
    // Static interface members (URL.createObjectURL, URL.parse) are as
    // page-visible as prototype members.
    markMembers(ctor);
    const proto = ctor.prototype;
    if (!proto || seen.has(proto)) return;
    seen.add(proto);
    markMembers(proto);
  }
  const names = Object.getOwnPropertyNames(globalThis);
  for (const name of names) {
    if (!/^[A-Z]/.test(name)) continue;
    let val;
    try { val = globalThis[name]; } catch (_e) { continue; }
    walkConstructor(val);
  }
  // Window's own slots follow the same rules: nameless shims take the slot's
  // name (Chrome reports setTimeout.name === "setTimeout") and its accessors
  // answer with the `get <key>` shape every other accessor uses.
  markMembers(globalThis);
})();
