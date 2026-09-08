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

globalThis.HTMLUnknownElement = Element;
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
