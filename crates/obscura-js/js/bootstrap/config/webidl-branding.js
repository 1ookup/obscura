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
