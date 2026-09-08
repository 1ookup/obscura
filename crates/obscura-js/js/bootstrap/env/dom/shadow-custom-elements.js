// Constructible-stylesheet adoption, mirroring Document.adoptedStyleSheets.
Object.defineProperty(globalThis.ShadowRoot.prototype, 'adoptedStyleSheets', {
  get() { return _adoptedStyleSheetsFor(this); },
  set(sheets) { _replaceAdoptedStyleSheets(this, sheets); },
  configurable: true,
});
globalThis.__obscura_shadowHostNames = new Set(['article','aside','blockquote','body','div','footer','h1','h2','h3','h4','h5','h6','header','main','nav','p','section','span']);
function _isConstructorCE(v) {
  if (typeof v !== 'function') return false;
  try { Reflect.construct(function () {}, [], v); return true; } catch (e) { return false; }
}
const _CE_RESERVED = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph']);
function _isValidCustomElementName(name) {
  if (typeof name !== 'string' || _CE_RESERVED.has(name)) return false;
  // PotentialCustomElementName (approx): lowercase start, a hyphen, no uppercase.
  return /^[a-z][a-z0-9._·À-￿-]*-[a-z0-9._·À-￿-]*$/.test(name);
}
const _customElementRegistryState = new WeakMap();
function _customElementRegistryData(value) {
  const state = _customElementRegistryState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _customElementUpgrade(registry, el, cls) {
  if (el.__customUpgraded) return;
  el.__customUpgraded = true;
  try {
    const constructionEntry = { element: el, constructor: cls, constructed: false };
    _customElementConstructionStack.push(constructionEntry);
    let constructed;
    try {
      constructed = Reflect.construct(cls, []);
    } finally {
      const pending = _customElementConstructionStack.lastIndexOf(constructionEntry);
      if (pending !== -1) _customElementConstructionStack.splice(pending, 1);
    }
    if (constructed !== el) {
      throw new TypeError('Custom element constructor did not produce the element being upgraded');
    }
    if (typeof el.connectedCallback === 'function' && el.isConnected) {
      try { el.connectedCallback(); } catch (_error) {}
    }
  } catch (_error) {
    el.__customUpgradeFailed = true;
  }
}
function _customElementUpgradeRoot(registry, root) {
  const state = _customElementRegistryData(registry);
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const [name, cls] of state.registry.entries()) {
    if (root.localName === name) _customElementUpgrade(registry, root, cls);
    for (const el of root.querySelectorAll(name)) _customElementUpgrade(registry, el, cls);
  }
}
function _customElementRegistryForNode(node) {
  try {
    const root = node?.getRootNode?.();
    // A detached element's native root is the element itself. Reading
    // `root.customElementRegistry` in that case re-enters this resolver
    // through Element#customElementRegistry forever. Detached elements still
    // resolve through ownerDocument below; only inspect a distinct document or
    // shadow root here.
    if (root && root !== node
        && root?.customElementRegistry instanceof CustomElementRegistry) {
      return root.customElementRegistry;
    }
    const doc = node?.ownerDocument || (node?.nodeType === 9 ? node : null);
    if (doc?.customElementRegistry instanceof CustomElementRegistry) {
      return doc.customElementRegistry;
    }
  } catch (_error) {}
  return globalThis.customElements;
}

class CustomElementRegistry {
  constructor() {
    _customElementRegistryState.set(this, {
      registry: new Map(), byCtor: new Map(), resolvers: new Map(),
      defining: false, roots: new Set(),
    });
  }
  define(name, cls, opts) {
    const state = _customElementRegistryData(this);
    if (!_isConstructorCE(cls)) throw new TypeError("Failed to execute 'define' on 'CustomElementRegistry': parameter 2 is not a constructor.");
    if (!_isValidCustomElementName(name)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': \"" + name + "\" is not a valid custom element name", "SyntaxError");
    if (state.defining) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': operation is not supported while a definition is in progress", "NotSupportedError");
    if (state.registry.has(name)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': the name \"" + name + "\" has already been used with this registry", "NotSupportedError");
    if (state.byCtor.has(cls)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': the constructor has already been used with this registry", "NotSupportedError");
    state.defining = true;
    try {
      state.byCtor.set(cls, name);
      state.registry.set(name, cls);
      for (const root of state.roots) _customElementUpgradeRoot(this, root);
    } finally {
      state.defining = false;
    }
    const resolvers = state.resolvers.get(name);
    if (resolvers) {
      for (const r of resolvers) r(cls);
      state.resolvers.delete(name);
    }
  }
  get(name) { return _customElementRegistryData(this).registry.get(name); }
  getName(cls) {
    const state = _customElementRegistryData(this);
    if (!_isConstructorCE(cls)) throw new TypeError("Failed to execute 'getName' on 'CustomElementRegistry': parameter 1 is not a constructor.");
    return state.byCtor.has(cls) ? state.byCtor.get(cls) : null;
  }
  whenDefined(name) {
    const state = _customElementRegistryData(this);
    if (!_isValidCustomElementName(name)) return Promise.reject(new DOMException("Failed to execute 'whenDefined' on 'CustomElementRegistry': \"" + name + "\" is not a valid custom element name", "SyntaxError"));
    const cls = state.registry.get(name);
    if (cls) return Promise.resolve(cls);
    return new Promise((resolve) => {
      const list = state.resolvers.get(name) || [];
      list.push(resolve);
      state.resolvers.set(name, list);
    });
  }
  upgrade(root) {
    _customElementRegistryData(this);
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'upgrade' on 'CustomElementRegistry': 1 argument required, but only 0 present.");
    }
    _customElementUpgradeRoot(this, root);
  }
  initialize(root) {
    const state = _customElementRegistryData(this);
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'initialize' on 'CustomElementRegistry': 1 argument required, but only 0 present.");
    }
    if (root?.customElementRegistry === this) {
      state.roots.add(root);
      _customElementUpgradeRoot(this, root);
    }
  }
}
globalThis.CustomElementRegistry = CustomElementRegistry;
globalThis.customElements = new CustomElementRegistry();
_customElementRegistryData(globalThis.customElements).roots.add(globalThis.document);
{
  const prototype = CustomElementRegistry.prototype;
  const descriptors = Object.getOwnPropertyDescriptors(prototype);
  for (const name of Object.getOwnPropertyNames(prototype)) delete prototype[name];
  for (const name of ['define','get','getName','upgrade','whenDefined','initialize']) {
    const descriptor = descriptors[name]; descriptor.enumerable = true;
    Object.defineProperty(prototype, name, descriptor);
  }
  Object.defineProperty(prototype, 'constructor', descriptors.constructor);
  Object.defineProperty(prototype, Symbol.toStringTag, {
    value: 'CustomElementRegistry', configurable: true,
  });
}
globalThis.HTMLUnknownElement = Element;
// ElementInternals: form-associated custom element internals. Validity/state
// are JS-observable; ARIA reflection that needs the accessibility tree is not.
globalThis.ElementInternals = class ElementInternals {
  constructor(el) { this._el = el; this._valid = true; this._flags = {}; this._message = ''; this._value = null; this._states = new Set(); }
  setFormValue(value, state) { this._value = value; }
  setValidity(flags, message, anchor) {
    flags = flags || {};
    const bad = Object.keys(flags).some((k) => k !== 'valid' && flags[k]);
    if (bad && (message == null || message === '')) throw new TypeError("Failed to execute 'setValidity' on 'ElementInternals': The second argument should not be empty if one or more flags in the first argument are true.");
    this._flags = flags; this._valid = !bad; this._message = bad ? String(message) : '';
  }
  checkValidity() { return this._valid; }
  reportValidity() { return this._valid; }
  get validity() {
    const f = this._flags || {};
    return { valid: this._valid, valueMissing: !!f.valueMissing, typeMismatch: !!f.typeMismatch, patternMismatch: !!f.patternMismatch, tooLong: !!f.tooLong, tooShort: !!f.tooShort, rangeUnderflow: !!f.rangeUnderflow, rangeOverflow: !!f.rangeOverflow, stepMismatch: !!f.stepMismatch, badInput: !!f.badInput, customError: !!f.customError };
  }
  get validationMessage() { return this._message || ''; }
  get willValidate() { return true; }
  get form() { return this._el && this._el.closest ? this._el.closest('form') : null; }
  get labels() { return _nodeList([]); }
  get shadowRoot() { return this._el ? _shadowRootForHost(this._el, true) : null; }
  get states() { return this._states; }
};
// Full standard constant set (issue #439). The partial version here lacked
// FILTER_ACCEPT/REJECT/SKIP and most SHOW_* values, so the canonical
// `acceptNode() { return NodeFilter.FILTER_ACCEPT; }` filter idiom returned
// undefined and TreeWalker/NodeIterator rejected every node.
const NodeFilter = ({ NodeFilter() {} }).NodeFilter;
Object.assign(NodeFilter, {
  SHOW_ALL: 0xFFFFFFFF,
  SHOW_ELEMENT: 0x1,
  SHOW_ATTRIBUTE: 0x2,
  SHOW_TEXT: 0x4,
  SHOW_CDATA_SECTION: 0x8,
  SHOW_ENTITY_REFERENCE: 0x10,
  SHOW_ENTITY: 0x20,
  SHOW_PROCESSING_INSTRUCTION: 0x40,
  SHOW_COMMENT: 0x80,
  SHOW_DOCUMENT: 0x100,
  SHOW_DOCUMENT_TYPE: 0x200,
  SHOW_DOCUMENT_FRAGMENT: 0x400,
  SHOW_NOTATION: 0x800,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
});
_markNative(NodeFilter);
Object.defineProperty(globalThis, 'NodeFilter', {
  value: NodeFilter, writable: true, enumerable: false, configurable: true,
});
// ResizeObserver is defined earlier with real per-target firing; the stub
// that previously lived here was a no-op that clobbered the real class.
//
