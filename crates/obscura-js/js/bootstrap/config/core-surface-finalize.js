// Pre-hydration surface parity for a deferred-surface frame realm (Step 312).
// The parent can reach the frame's document through contentDocument without
// firing any WindowProxy trap, so the core classes that produce must already
// carry the enumerability and brand surface that surface-finalize and
// webidl-branding otherwise install when the deferred surface hydrates. This
// pass covers exactly the prototypes a core document can hand out; the full
// passes stay authoritative (webidl-branding re-installs the table-driven
// toStringTag getters, surface-finalize re-promotes everything) and are
// idempotent over what runs here.
//
// Promotion flips each non-enumerable configurable prototype member to
// enumerable and applies the changes in one Object.defineProperties call per
// prototype: the canvas/element/document prototypes carry hundreds of
// members and per-member defineProperty dominates the realm boot otherwise.
//
// Batch 20: for the three accessor-heavy prototypes the in-place promotion
// is most of the realm boot (Element ~14ms, Document ~6ms, SVGElement ~1ms
// of the ~22ms total; accessor reconfiguration dominates, and a dictionary
// fallback breaks key order), so those rebuild through the swap fast path:
// one Object.create with the final descriptors, assigned to the trampoline's
// writable prototype slot in one write, then relocked to the class-shaped
// descriptor. The trampolines (_swappableInterface, config/bootstrap.js) are
// what makes the slot writable engine-internally; the page-visible slot
// descriptor after the relock is identical to a class's. The swap runs in
// every realm, main context included, at the same point of the bootstrap.
(function _coreSurfaceFinalize() {
  const skipOnPrototype = new Set(['constructor']);

  // Rebuild `name`'s prototype with enumerable members and assign it once.
  // Descriptor collection follows Reflect.ownKeys order, so the fresh
  // object answers [[OwnPropertyKeys]] exactly like the original; symbol
  // keys ([Symbol.toStringTag] getters) carry over verbatim and stay
  // non-enumerable, as WebIDL requires.
  const swapInterfacePrototype = (name) => {
    const F = globalThis[name];
    if (typeof F !== 'function' || !F.prototype) return;
    // The trampoline's slot is the only writable non-configurable one; a
    // relocked (or plain class) slot means the swap already ran or is not
    // applicable.
    const slot = Object.getOwnPropertyDescriptor(F, 'prototype');
    if (!slot || !slot.writable || slot.configurable) return;
    const original = F.prototype;
    let ownKeys;
    try { ownKeys = Reflect.ownKeys(original); } catch (_error) { return; }
    const descriptors = {};
    let flipped = 0;
    for (const key of ownKeys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(original, key); }
      catch (_error) { continue; }
      if (!descriptor) continue;
      if (typeof key === 'string' && !skipOnPrototype.has(key)
          && !key.startsWith('_')
          && descriptor.configurable && !descriptor.enumerable) {
        descriptor.enumerable = true;
        flipped++;
      }
      descriptors[key] = descriptor;
    }
    if (!flipped) return;
    const fresh = Object.create(Object.getPrototypeOf(original), descriptors);
    if (!Object.prototype.hasOwnProperty.call(fresh, 'constructor')) {
      // Unreachable today (the trampoline pins it), but a rebuilt prototype
      // without its own constructor would answer Object.prototype's.
      try {
        Object.defineProperty(fresh, 'constructor', {
          value: F, writable: true, enumerable: false, configurable: true,
        });
      } catch (_error) { return; }
    }
    F.prototype = fresh;
    try {
      // Relock to the exact descriptor class semantics carry.
      Object.defineProperty(F, 'prototype', { value: fresh, writable: false });
    } catch (_error) {}
    // Classes declared `extends <this interface>` before the swap chain the
    // old prototype object; repoint them so they see the promoted members.
    for (const other of Object.getOwnPropertyNames(globalThis)) {
      let C;
      try { C = globalThis[other]; } catch (_error) { continue; }
      if (typeof C !== 'function' || !C.prototype || C === F) continue;
      try {
        if (Object.getPrototypeOf(C.prototype) === original) {
          Object.setPrototypeOf(C.prototype, fresh);
        }
      } catch (_error) {}
    }
    // The frame's scoped document subclass (env/frame/realms.js) is
    // realm-local rather than a global.
    try {
      if (typeof _ScopedDocument === 'function'
          && Object.getPrototypeOf(_ScopedDocument.prototype) === original) {
        Object.setPrototypeOf(_ScopedDocument.prototype, fresh);
      }
    } catch (_error) {}
  };
  // Parents before children: SVGElement's rebuilt prototype must chain the
  // already-rebuilt Element.prototype, and the child repoint above is what
  // puts it there before the SVG swap reads its prototype chain.
  swapInterfacePrototype('Document');
  swapInterfacePrototype('Element');
  swapInterfacePrototype('SVGElement');

  if (!globalThis.__obscura_frame_defers_surface) return;

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
