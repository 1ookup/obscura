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
  const HTML_TAGS = {
    a: 'HTMLAnchorElement', abbr: 'HTMLElement', acronym: 'HTMLElement',
    address: 'HTMLElement', applet: 'HTMLAppletElement', area: 'HTMLAreaElement',
    article: 'HTMLElement', aside: 'HTMLElement', audio: 'HTMLAudioElement',
    b: 'HTMLElement', base: 'HTMLBaseElement', basefont: 'HTMLBaseFontElement',
    bdi: 'HTMLElement', bdo: 'HTMLElement', bgsound: 'HTMLBGSoundElement',
    big: 'HTMLElement', blink: 'HTMLElement', blockquote: 'HTMLQuoteElement',
    body: 'HTMLBodyElement', br: 'HTMLBRElement', button: 'HTMLButtonElement',
    canvas: 'HTMLCanvasElement', caption: 'HTMLTableCaptionElement',
    center: 'HTMLElement', cite: 'HTMLElement', code: 'HTMLElement',
    col: 'HTMLTableColElement', colgroup: 'HTMLTableColElement',
    data: 'HTMLDataElement', datalist: 'HTMLDataListElement',
    dd: 'HTMLElement', del: 'HTMLModElement', details: 'HTMLDetailsElement',
    dfn: 'HTMLElement', dialog: 'HTMLDialogElement', dir: 'HTMLDirectoryElement',
    div: 'HTMLDivElement', dl: 'HTMLDListElement', dt: 'HTMLElement',
    em: 'HTMLElement', embed: 'HTMLEmbedElement', fieldset: 'HTMLFieldSetElement',
    figcaption: 'HTMLElement', figure: 'HTMLElement', font: 'HTMLFontElement',
    footer: 'HTMLElement', form: 'HTMLFormElement', frame: 'HTMLFrameElement',
    frameset: 'HTMLFrameSetElement', h1: 'HTMLHeadingElement',
    h2: 'HTMLHeadingElement', h3: 'HTMLHeadingElement', h4: 'HTMLHeadingElement',
    h5: 'HTMLHeadingElement', h6: 'HTMLHeadingElement', head: 'HTMLHeadElement',
    header: 'HTMLElement', hgroup: 'HTMLElement', hr: 'HTMLHRElement',
    html: 'HTMLHtmlElement', i: 'HTMLElement', iframe: 'HTMLIFrameElement',
    img: 'HTMLImageElement', input: 'HTMLInputElement', ins: 'HTMLModElement',
    kbd: 'HTMLElement', label: 'HTMLLabelElement', legend: 'HTMLLegendElement',
    li: 'HTMLLIElement', link: 'HTMLLinkElement', main: 'HTMLElement',
    map: 'HTMLMapElement', mark: 'HTMLElement', marquee: 'HTMLMarqueeElement',
    menu: 'HTMLMenuElement', meta: 'HTMLMetaElement', meter: 'HTMLMeterElement',
    nav: 'HTMLElement', nobr: 'HTMLElement', noembed: 'HTMLElement',
    noframes: 'HTMLElement', noscript: 'HTMLElement', object: 'HTMLObjectElement',
    ol: 'HTMLOListElement', optgroup: 'HTMLOptGroupElement',
    option: 'HTMLOptionElement', output: 'HTMLOutputElement', p: 'HTMLParagraphElement',
    param: 'HTMLParamElement', picture: 'HTMLPictureElement',
    plaintext: 'HTMLElement', pre: 'HTMLPreElement', progress: 'HTMLProgressElement',
    q: 'HTMLQuoteElement', rp: 'HTMLElement', rt: 'HTMLElement',
    ruby: 'HTMLElement', s: 'HTMLElement', samp: 'HTMLElement',
    script: 'HTMLScriptElement', search: 'HTMLElement', section: 'HTMLElement',
    select: 'HTMLSelectElement', slot: 'HTMLSlotElement', small: 'HTMLElement',
    source: 'HTMLSourceElement', span: 'HTMLSpanElement', strike: 'HTMLElement',
    strong: 'HTMLElement', style: 'HTMLStyleElement', sub: 'HTMLElement',
    summary: 'HTMLElement', sup: 'HTMLElement', table: 'HTMLTableElement',
    tbody: 'HTMLTableSectionElement', td: 'HTMLTableCellElement',
    template: 'HTMLTemplateElement', textarea: 'HTMLTextAreaElement',
    tfoot: 'HTMLTableSectionElement', th: 'HTMLTableCellElement',
    thead: 'HTMLTableSectionElement', time: 'HTMLTimeElement',
    title: 'HTMLTitleElement', tr: 'HTMLTableRowElement', track: 'HTMLTrackElement',
    tt: 'HTMLElement', u: 'HTMLElement', ul: 'HTMLUListElement',
    var: 'HTMLElement', video: 'HTMLVideoElement', wbr: 'HTMLElement',
    xmp: 'HTMLElement',
  };
  const SVG_TAGS = {
    svg: 'SVGSVGElement', path: 'SVGPathElement', text: 'SVGTextElement',
    g: 'SVGGElement', circle: 'SVGCircleElement', rect: 'SVGRectElement',
    line: 'SVGLineElement', polyline: 'SVGPolylineElement',
    polygon: 'SVGPolygonElement', ellipse: 'SVGEllipseElement',
    image: 'SVGImageElement', use: 'SVGUseElement', tspan: 'SVGTSpanElement',
    title: 'SVGTitleElement', desc: 'SVGDescElement', defs: 'SVGDefsElement',
    symbol: 'SVGSymbolElement', marker: 'SVGMarkerElement', clipPath: 'SVGClipPathElement',
    mask: 'SVGMaskElement', pattern: 'SVGPatternElement', linearGradient: 'SVGLinearGradientElement',
    radialGradient: 'SVGRadialGradientElement', stop: 'SVGStopElement',
  };
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
// measurement methods in env/media/canvas.js because the SVG interfaces are
// installed by this, the last, manifest module.
(function _installSvgTextContentGeometry() {
  if (typeof _measureTextBox !== 'function') return;
  const geometry = {
    getNumberOfChars() { return _svgTextContent(this).length; },
    getStartPositionOfChar(index) {
      return { x: _svgAdvanceTo(this, _svgCharacterIndex(this, index)), y: 0 };
    },
    getEndPositionOfChar(index) {
      const i = _svgCharacterIndex(this, index);
      const char = _svgTextContent(this).charAt(i);
      return { x: _svgAdvanceTo(this, i) + _measureTextBox(char, _svgMeasurementFont(this)).width, y: 0 };
    },
    getRotationOfChar(index) {
      _svgCharacterIndex(this, index);
      return 0;
    },
    getCharNumAtPosition(point) {
      const x = point && Number(point.x);
      if (!Number.isFinite(x)) return -1;
      const text = _svgTextContent(this);
      for (let i = 0; i < text.length; i++) {
        if (x < _svgAdvanceTo(this, i + 1)) return i;
      }
      return -1;
    },
  };
  // Where they belong. `SVGTextElement` and its siblings are still published
  // as aliases of SVGElement here, so a <text> node does not inherit from this
  // prototype yet -- the install below Element.prototype is what makes them
  // reachable on the element the challenge actually measures.
  const owner = globalThis.SVGTextContentElement && globalThis.SVGTextContentElement.prototype;
  if (owner) {
    for (const name of Object.keys(geometry)) {
      Object.defineProperty(owner, name, {
        value: geometry[name], writable: true, enumerable: false, configurable: true,
      });
    }
  }
  for (const name of Object.keys(geometry)) {
    Object.defineProperty(Element.prototype, name, {
      value: geometry[name], writable: true, enumerable: false, configurable: true,
    });
  }
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
        const branded = new DOMRect(result.x, result.y, result.width, result.height);
        // `scrollIntoView` marks a viewport-fixed box on the rect it reads back
        // and skips the scroll for it. The branded value has to carry that
        // marker, or a fixed subtree starts moving the document.
        if (result.__obscuraViewportFixed) branded.__obscuraViewportFixed = true;
        return branded;
      }),
      writable: true, enumerable: false, configurable: true,
    });
  } catch (e) {}
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
