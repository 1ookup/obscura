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
