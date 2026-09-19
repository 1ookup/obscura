// Pre-hydration surface parity for a deferred-surface frame realm (Step 312).
// The parent can reach the frame's document through contentDocument without
// firing any WindowProxy trap, so the core classes that produce must already
// carry the enumerability and brand surface that surface-finalize and
// webidl-branding otherwise install when the deferred surface hydrates. This
// pass covers exactly the prototypes a core document can hand out; the full
// passes stay authoritative (webidl-branding re-installs the table-driven
// toStringTag getters, surface-finalize re-promotes everything) and are
// idempotent over what runs here. The main context never defers, so this
// returns immediately there.
//
// Promotion flips each non-enumerable configurable prototype member to
// enumerable and applies the changes in one Object.defineProperties call per
// prototype: the canvas/element/document prototypes carry hundreds of
// members and per-member defineProperty dominates the realm boot otherwise.
(function _coreSurfaceFinalize() {
  if (!globalThis.__obscura_frame_defers_surface) return;

  const skipOnPrototype = new Set(['constructor']);
  const seen = new Set();
  const promote = (proto) => {
    if (!proto || typeof proto !== 'object' || seen.has(proto)) return;
    seen.add(proto);
    let names;
    try { names = Object.getOwnPropertyNames(proto); } catch (_error) { return; }
    let changes = null;
    for (const key of names) {
      if (skipOnPrototype.has(key) || key.startsWith('_')) continue;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(proto, key); }
      catch (_error) { continue; }
      if (!descriptor || descriptor.enumerable || !descriptor.configurable) continue;
      descriptor.enumerable = true;
      (changes ||= {})[key] = descriptor;
    }
    if (changes) {
      try { Object.defineProperties(proto, changes); } catch (_error) {}
    }
  };

  // Elements created by the core wrapper factory answer the concrete
  // interface tag through the shared Element.prototype getter; the HTML
  // document answers [object HTMLDocument]. webidl-branding re-installs its
  // table-driven getters at hydration.
  try {
    if (!Object.prototype.hasOwnProperty.call(Element.prototype, Symbol.toStringTag)) {
      Object.defineProperty(Element.prototype, Symbol.toStringTag, {
        get() {
          try {
            const name = this.localName || String(this.tagName || '').toLowerCase();
            if (!name) return 'Element';
            if (this.namespaceURI === 'http://www.w3.org/2000/svg') {
              return SVG_TAGS[name] || 'SVGElement';
            }
            return HTML_TAGS[name] || 'HTMLElement';
          } catch (e) { return 'Element'; }
        },
        configurable: true,
      });
    }
  } catch (_e) {}
  try {
    if (!Object.prototype.hasOwnProperty.call(Document.prototype, Symbol.toStringTag)) {
      Object.defineProperty(Document.prototype, Symbol.toStringTag, {
        get() {
          try {
            const root = this.documentElement;
            const name = root && (root.localName
              || String(root.tagName || '').toLowerCase());
            return name === 'html' ? 'HTMLDocument' : 'Document';
          } catch (e) { return 'Document'; }
        },
        configurable: true,
      });
    }
  } catch (_e) {}

  // Constructor-name brands and promotion for the core interfaces. Same
  // ownership rules as webidl-branding's interface pass: only the constructor
  // that owns the prototype names it, and prototypes that already declare a
  // tag keep it.
  const coreInterfaces = [
    'EventTarget', 'Node', 'CharacterData', 'Text', 'Comment', 'CDATASection',
    'ProcessingInstruction', 'Document', 'DocumentFragment', 'DocumentType',
    'Element', 'HTMLElement', 'NodeList', 'HTMLCollection', 'NamedNodeMap',
    'DOMTokenList', 'CSSStyleDeclaration', 'Animation', 'KeyframeEffect',
    'DocumentTimeline', 'Attr', 'ValidityState', 'SVGElement',
    'SVGGraphicsElement', 'SVGGeometryElement', 'SVGTextContentElement',
    'SVGTextPositioningElement', 'SVGTextElement', 'SVGTSpanElement',
    'SVGPathElement', 'SVGSVGElement',
  ];
  for (const name of coreInterfaces) {
    try {
      const C = globalThis[name];
      if (typeof C !== 'function' || !C.prototype) continue;
      if (C.prototype.constructor === C
          && !Object.prototype.hasOwnProperty.call(C.prototype, Symbol.toStringTag)) {
        try {
          if (C.name !== name) {
            Object.defineProperty(C, 'name', {
              value: name, writable: false, enumerable: false, configurable: true,
            });
          }
          Object.defineProperty(C.prototype, Symbol.toStringTag, {
            value: name, writable: false, enumerable: false, configurable: true,
          });
        } catch (_error) {}
      }
      promote(C.prototype);
    } catch (_error) {}
  }
  // The frame's scoped document subclass (realms.js, same bootstrap core):
  // its members must be enumerable like the promoted Document.prototype pass,
  // or `for..in` over contentDocument misses domain/URL/title next to a
  // hydrated realm.
  try {
    if (typeof _ScopedDocument === 'function') promote(_ScopedDocument.prototype);
  } catch (_error) {}
})();
