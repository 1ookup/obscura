const _htmlCollectionKey = Symbol('HTMLCollection');
const _htmlCollectionValues = new WeakMap();
function _htmlCollectionData(value) {
  const held = _htmlCollectionValues.get(value);
  if (!held) throw new TypeError('Illegal invocation');
  const values = typeof held === 'function' ? held() : held;
  return Array.from(values || []).filter(Boolean);
}
class HTMLCollection {
  constructor(key = undefined, values = undefined) {
    if (key !== _htmlCollectionKey) {
      throw new TypeError("Failed to construct 'HTMLCollection': Illegal constructor");
    }
    _htmlCollectionValues.set(this, values || []);
  }
  get length() {
    return _htmlCollectionData(this).length;
  }
  item(i) {
    i = i >>> 0;
    const values = _htmlCollectionData(this);
    return values[i] != null ? values[i] : null;
  }
  namedItem(name) {
    const values = _htmlCollectionData(this);
    if (name === undefined || name === null || name === "") return null;
    name = String(name);
    for (let i = 0; i < values.length; i++) {
      const el = values[i];
      if (!el) continue;
      // id always contributes; name only for HTML elements in HTML documents.
      if (el.id === name) return el;
      if (_isHTMLEl(el) && typeof el.getAttribute === "function" && el.getAttribute("name") === name) return el;
    }
    return null;
  }
  *[Symbol.iterator]() {
    const values = _htmlCollectionData(this);
    yield* values;
  }
  get [Symbol.toStringTag]() { return 'HTMLCollection'; }
}
globalThis.HTMLCollection = HTMLCollection;
function _htmlCollectionFrom(source) {
  const values = typeof source === 'function'
    ? source
    : Array.from(source || []).filter(Boolean);
  const target = new HTMLCollection(_htmlCollectionKey, values);
  const collection = new Proxy(target, _htmlCollectionProxy);
  _htmlCollectionValues.set(collection, values);
  return collection;
}
_markNative(HTMLCollection.prototype.item);
_markNative(HTMLCollection.prototype.namedItem);
// Shared (allocated once) Proxy traps for HTMLCollection named access. Indices,
// length, and inherited methods resolve normally via Reflect; only an unknown
// non-numeric string key falls back to namedItem(), so item/namedItem and the
// Array methods are never shadowed and id="namedItem" cannot recurse.
const _htmlCollectionProxy = {
  get(t, k, r) {
    if (typeof k === 'string' && /^(?:0|[1-9]\d*)$/.test(k)) {
      return _htmlCollectionData(r)[Number(k)];
    }
    const v = Reflect.get(t, k, r);
    if (v !== undefined || typeof k !== "string") return v;
    return t.namedItem ? (t.namedItem(k) || undefined) : undefined;
  },
  has(t, k) {
    if (Reflect.has(t, k)) return true;
    if (typeof k === 'string' && /^(?:0|[1-9]\d*)$/.test(k)) {
      return Number(k) < _htmlCollectionData(t).length;
    }
    return typeof k === "string" && !!(t.namedItem && t.namedItem(k));
  },
  ownKeys(t) {
    const values = _htmlCollectionData(t);
    const keys = values.map((_value, index) => String(index));
    const seen = new Set(keys);
    for (const element of values) {
      if (!element) continue;
      const names = [element.id];
      if (_isHTMLEl(element) && typeof element.getAttribute === 'function') {
        names.push(element.getAttribute('name'));
      }
      for (const name of names) {
        if (name && !seen.has(name)) { seen.add(name); keys.push(name); }
      }
    }
    return keys;
  },
  getOwnPropertyDescriptor(t, k) {
    if (typeof k !== 'string') return Reflect.getOwnPropertyDescriptor(t, k);
    const values = _htmlCollectionData(t);
    if (/^(?:0|[1-9]\d*)$/.test(k) && Number(k) < values.length) {
      return { value: values[Number(k)], writable: false, enumerable: true, configurable: true };
    }
    const named = t.namedItem(k);
    if (named) return { value: named, writable: false, enumerable: false, configurable: true };
    return Reflect.getOwnPropertyDescriptor(t, k);
  },
};
const _documentCollectionState = new WeakMap();
function _documentCollection(document, name, provider) {
  let collections = _documentCollectionState.get(document);
  if (!collections) {
    collections = new Map();
    _documentCollectionState.set(document, collections);
  }
  if (!collections.has(name)) collections.set(name, _htmlCollectionFrom(provider));
  return collections.get(name);
}
// True for elements in the HTML namespace (the only ones whose name attribute
// contributes to an HTMLCollection's supported property names).
function _isHTMLEl(el) {
  return !!el && (el.namespaceURI === undefined || el.namespaceURI === "http://www.w3.org/1999/xhtml");
}
// Build a NodeList (no named access, per spec) for querySelectorAll and
// childNodes. Kept light on purpose: querySelectorAll is the hottest query API.
function _nodeList(els) {
  const nl = new NodeList();
  for (let i = 0; i < els.length; i++) nl[i] = els[i];
  nl.length = els.length;
  return nl;
  }

// Window named access. HTML exposes every element id, plus the name of a
// small legacy set of HTML elements, as properties of the WindowProxy. V8's
// global object cannot be replaced with a WindowProxy after snapshot startup,
// so install lazy accessors on Window.prototype for the supported names present
// in this document. This keeps the global's own-property reflection browser-like.
// The accessor resolves against the live tree: one match returns that element
// (or an iframe's Window), while duplicates return a live-shaped
// HTMLCollection in tree order.
const _windowNamedPropertyNames = new Set();
const _windowNamedNameTags = new Set(["embed", "form", "iframe", "img", "object"]);

function _windowNameEligibleElement(element) {
  return !!element
    && element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && _windowNamedNameTags.has(element.localName);
}

function _windowNamedSupportedNames(element) {
  const names = [];
  if (!element || element.nodeType !== 1) return names;
  const id = element.getAttribute("id");
  if (id) names.push(id);
  if (_windowNameEligibleElement(element)) {
    const name = element.getAttribute("name");
    if (name && name !== id) names.push(name);
  }
  return names;
}


// Engine-internal selector queries.
//
// `querySelector`/`querySelectorAll` are page-visible and pages hook them --
// a challenge script logs every selector it sees pass through. Routing the
// engine's own lookups (named window access, stylesheet discovery, the title
// getter) through the public methods put those selectors in the page's log:
// where a browser showed 34 selectors, all the page's own, this showed 74,
// most of them `[id],embed[name],...` and `link[rel~="stylesheet"]`. The
// internals go straight to the DOM op instead, which no page can observe.
function _internalQuerySelectorAll(root, selector) {
  const nid = root && typeof root[_nidSym] === 'number'
    ? root[_nidSym]
    : (root === globalThis.document ? _documentRootNid() : null);
  if (nid === null) return [];
  const ids = _domParse('query_selector_all_scoped', nid, selector) || [];
  const out = [];
  for (const id of ids) {
    const element = _wrapEl(id);
    if (element) out.push(element);
  }
  return out;
}
function _internalQuerySelector(root, selector) {
  return _internalQuerySelectorAll(root, selector)[0] || null;
}
function _documentRootNid() {
  const scoped = globalThis.__obscura_frame_document_nid;
  return typeof scoped === 'number' ? scoped : 0;
}

function _windowNamedCandidates(name) {
  const doc = globalThis.document;
  if (!doc || !name) return [];
  const elements = _internalQuerySelectorAll(
    doc, "[id],embed[name],form[name],iframe[name],img[name],object[name]"
  );
  const matches = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.getAttribute("id") === name
        || (_windowNameEligibleElement(element)
          && element.getAttribute("name") === name)) {
      matches.push(element);
    }
  }
  return matches;
}

function _windowNamedValue(name) {
  const matches = _windowNamedCandidates(name);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return _htmlCollectionFrom(matches);
  const element = matches[0];
  return element.localName === "iframe" && element.contentWindow
    ? element.contentWindow
    : element;
}

function _ensureWindowNamedProperty(name) {
  name = String(name || "");
  if (!name || _windowNamedPropertyNames.has(name)) return;
  // Existing own Window properties win over named elements.
  if (Object.prototype.hasOwnProperty.call(globalThis, name)) return;
  const holder = globalThis.Window?.prototype || Object.getPrototypeOf(globalThis);
  if (!holder || Object.prototype.hasOwnProperty.call(holder, name)) return;
  try {
    // Named properties are an exotic WindowProxy feature in browsers. They
    // participate in `name in window` and `window[name]`, but are absent from
    // the WindowProxy's own-property reflection and from `for..in`. Defining
    // the live accessor on Window.prototype preserves those semantics while
    // keeping the V8 global's own key list stable.
    Object.defineProperty(holder, name, {
      get() { return _windowNamedValue(name); },
      configurable: true,
      enumerable: false,
    });
    _windowNamedPropertyNames.add(name);
  } catch (_error) {}
}

function _reconcileWindowNamedProperty(name) {
  if (!_windowNamedPropertyNames.has(name)) return;
  if (_windowNamedCandidates(name).length !== 0) return;
  const holder = globalThis.Window?.prototype || Object.getPrototypeOf(globalThis);
  try { if (holder) delete holder[name]; } catch (_error) {}
  _windowNamedPropertyNames.delete(name);
}

function _windowNamedNamesInTree(root) {
  const names = new Set();
  if (!root) return names;
  if (root.nodeType === 1) {
    for (const name of _windowNamedSupportedNames(root)) names.add(name);
  }
  if (typeof root.querySelectorAll === "function") {
    const elements = _internalQuerySelectorAll(
      root, "[id],embed[name],form[name],iframe[name],img[name],object[name]"
    );
    for (let i = 0; i < elements.length; i++) {
      for (const name of _windowNamedSupportedNames(elements[i])) names.add(name);
    }
  }
  return names;
}

function _registerWindowNamedTree(root) {
  // Window named access only considers the document tree. Detached nodes and
  // attached shadow trees must not manufacture own Window properties. Check
  // connectivity first: getRootNode() walks every ancestor, which made the
  // common framework pattern of building a deep detached subtree quadratic.
  if (!root || !root.isConnected || root.getRootNode() !== globalThis.document) return;
  const names = _windowNamedNamesInTree(root);
  for (const name of names) _ensureWindowNamedProperty(name);
}

function _reconcileWindowNamedProperties(names) {
  if (!names || names.size === 0) return;
  const doc = globalThis.document;
  if (!doc) return;
  const present = new Set();
  const elements = _internalQuerySelectorAll(
    doc, "[id],embed[name],form[name],iframe[name],img[name],object[name]"
  );
  for (let i = 0; i < elements.length; i++) {
    for (const name of _windowNamedSupportedNames(elements[i])) {
      if (names.has(name)) present.add(name);
    }
  }
  for (const name of names) {
    if (_windowNamedPropertyNames.has(name) && !present.has(name)) {
      _reconcileWindowNamedProperty(name);
    }
  }
}

globalThis.DOMTokenList = DOMTokenList;
// NodeList is its own type, not an Array subclass: in a real browser
// Array.isArray(nodeList) is false and Object.prototype.toString reports
// "[object NodeList]". Fingerprinting and feature-detection scripts check both.
// It keeps the array-like surface scripts actually use: indexed access, length,
// item(), forEach(), entries/keys/values, and iteration (so spread and for..of
// work).
globalThis.NodeList = class NodeList {
  constructor() { this.length = 0; }
  item(i) { i = i >>> 0; return this[i] != null ? this[i] : null; }
  forEach(cb, thisArg) {
    for (let i = 0; i < this.length; i++) cb.call(thisArg, this[i], i, this);
  }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this[i]; }
  *entries() { for (let i = 0; i < this.length; i++) yield [i, this[i]]; }
  *keys() { for (let i = 0; i < this.length; i++) yield i; }
  *values() { for (let i = 0; i < this.length; i++) yield this[i]; }
  get [Symbol.toStringTag]() { return 'NodeList'; }
};
_markNative(NodeList);
_markNative(NodeList.prototype.item);
_markNative(NodeList.prototype.forEach);
// Live Range over the real DOM tree. dom/ranges/* tests are pure boundary-point
// algorithms (no layout, no editing engine), so a property-storing Range with
// correct tree-order comparison passes them. Mutating ops (extract/delete/
// insert/surround) are kept minimal: they do not throw, but do not rewrite the
// tree (that is the editing mega-bucket, out of scope).
function _rngNodeLength(n) {
  const t = n.nodeType;
  if (t === 3 || t === 4 || t === 8 || t === 7) return (n.data || n.nodeValue || "").length;
  return n.childNodes.length;
}
// Index among siblings, computed in Rust (one op) instead of serializing the
// whole childNodes list per call: the Range matrices call this heavily.
function _rngNodeIndex(n) {
  if (!n.parentNode) return 0;
  return +_dom("node_index", n[_nidSym]);
}
function _rngSame(a, b) { return a === b || (!!a && !!b && a[_nidSym] === b[_nidSym]); }
// Root nid in one op (callers only read [_nidSym]), instead of an O(depth) walk.
function _rngRoot(n) { return { _nid: +_dom("node_root", n[_nidSym]) }; }
function _rngAncestors(n) { const a = []; let c = n; while (c) { a.push(c); c = c.parentNode; } return a; }
// document (preorder) tree order: -1 if a precedes b, 1 if a follows b, 0 same.
// Computed in Rust (one op) rather than walking ancestor chains over per-step
// DOM ops, which made the large dom/ranges matrices time out.
function _rngOrder(a, b) {
  if (_rngSame(a, b)) return 0;
  return +_dom("compare_order", a[_nidSym], b[_nidSym]) || 0;
}
// Position of (nA,oA) relative to (nB,oB): -1 before, 0 equal, 1 after.
function _rngCmp(nA, oA, nB, oB) {
  if (_rngSame(nA, nB)) return oA < oB ? -1 : (oA > oB ? 1 : 0);
  if (_rngOrder(nA, nB) > 0) return -_rngCmp(nB, oB, nA, oA);
  if (nA.contains && nA.contains(nB)) { // nA is a strict ancestor of nB
    let child = nB;
    while (child && child.parentNode && child.parentNode[_nidSym] !== nA[_nidSym]) child = child.parentNode;
    if (child && child.parentNode && child.parentNode[_nidSym] === nA[_nidSym] && _rngNodeIndex(child) < oA) return 1;
    return -1;
  }
  return -1;
}
function _rngCheckOffset(n, o) {
  if (n && n.nodeType === 10) throw new DOMException("Range boundary cannot be a DocumentType", "InvalidNodeTypeError");
  if (o < 0 || o > _rngNodeLength(n)) throw new DOMException("Range offset out of bounds", "IndexSizeError");
}
