// Returns the one Selection instance for a document (cached on the document),
// so window.getSelection() === document.getSelection(). The real Selection
// class is defined below, after Range. _selectionFor is hoisted.
function _selectionFor(doc) {
  if (!doc) return null;
  if (!doc._selection) doc._selection = new Selection(doc);
  return doc._selection;
}
globalThis.getSelection = _markNative(function getSelection() {
  return _selectionFor(globalThis.document);
});

class CSSRule {
  static STYLE_RULE = 1;
  static CHARSET_RULE = 2;
  static IMPORT_RULE = 3;
  static MEDIA_RULE = 4;
  static FONT_FACE_RULE = 5;
  static PAGE_RULE = 6;
  static KEYFRAMES_RULE = 7;
  static KEYFRAME_RULE = 8;
  static NAMESPACE_RULE = 10;
  static COUNTER_STYLE_RULE = 11;
  static SUPPORTS_RULE = 12;

  constructor(cssText, type = 0) {
    this._cssText = String(cssText || "").trim();
    this._type = type;
    this._parentStyleSheet = null;
    this._parentRule = null;
  }
  get type() { return this._type; }
  get cssText() { return this._cssText; }
  set cssText(_value) {}
  get parentStyleSheet() { return this._parentStyleSheet; }
  get parentRule() { return this._parentRule; }
}
for (const name of [
  "STYLE_RULE", "CHARSET_RULE", "IMPORT_RULE", "MEDIA_RULE", "FONT_FACE_RULE",
  "PAGE_RULE", "KEYFRAMES_RULE", "KEYFRAME_RULE", "NAMESPACE_RULE",
  "COUNTER_STYLE_RULE", "SUPPORTS_RULE",
]) {
  Object.defineProperty(CSSRule.prototype, name, { value: CSSRule[name] });
}

class CSSStyleRule extends CSSRule {
  constructor(selectorText, declarations) {
    super("", CSSRule.STYLE_RULE);
    this._selectorText = String(selectorText || "").trim();
    const declaration = new CSSStyleDeclaration(null, () => this._changed(), this);
    const state = _cssStyleFor(declaration);
    _parseCssInto(state.props, declarations);
    state.loaded = true;
    this._style = _styleProxy(declaration);
  }
  get selectorText() { return this._selectorText; }
  set selectorText(value) {
    const selector = String(value || "").trim();
    if (!selector || /[{}]/.test(selector)) return;
    this._selectorText = selector;
    this._changed();
  }
  get style() { return this._style; }
  get cssText() {
    const declarations = this._style.cssText;
    return `${this._selectorText} {${declarations ? " " + declarations : ""} }`;
  }
  set cssText(_value) {}
  _changed() {
    if (this._parentStyleSheet) this._parentStyleSheet._ruleChanged();
  }
}

// Split only the stylesheet's top-level rules. The renderer remains the CSS
// parser of record; this scanner exists to expose the live CSSOM rule list and
// deliberately preserves unfamiliar at-rules as opaque CSSRule objects.
function _splitTopLevelCssRules(value) {
  const css = String(value || "");
  const rules = [];
  let position = 0;
  const skipTrivia = () => {
    for (;;) {
      while (position < css.length && /\s/.test(css[position])) position++;
      if (css.startsWith("/*", position)) {
        const end = css.indexOf("*/", position + 2);
        if (end < 0) { position = css.length; return false; }
        position = end + 2;
        continue;
      }
      return true;
    }
  };
  let valid = skipTrivia();
  while (valid && position < css.length) {
    const start = position;
    let quote = "", comment = false, escaped = false;
    let parens = 0, braces = 0, complete = false;
    for (; position < css.length; position++) {
      const ch = css[position], next = css[position + 1];
      if (comment) {
        if (ch === "*" && next === "/") { comment = false; position++; }
        continue;
      }
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (quote) { if (ch === quote) quote = ""; continue; }
      if (ch === "/" && next === "*") { comment = true; position++; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "(") { parens++; continue; }
      if (ch === ")") { parens = Math.max(0, parens - 1); continue; }
      if (parens) continue;
      if (ch === "{") { braces++; continue; }
      if (ch === "}") {
        if (!braces) break;
        braces--;
        if (!braces) { position++; complete = true; break; }
        continue;
      }
      if (ch === ";" && !braces) { position++; complete = true; break; }
    }
    if (!complete || quote || comment || braces || parens) {
      valid = false;
      break;
    }
    const text = css.slice(start, position).trim();
    if (text) rules.push(text);
    valid = skipTrivia();
  }
  return { rules, valid: valid && position >= css.length };
}

function _cssRuleFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed[0] === "@") return new CSSRule(trimmed, 0);
  const open = trimmed.indexOf("{");
  if (open <= 0 || !trimmed.endsWith("}")) return null;
  const selector = trimmed.slice(0, open).trim();
  if (!selector) return null;
  return new CSSStyleRule(selector, trimmed.slice(open + 1, -1));
}

class CSSRuleList {
  constructor(sheet) {
    this._sheet = sheet;
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          return target.item(+property) || undefined;
        }
        return Reflect.get(target, property, receiver);
      },
      has(target, property) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          return +property < target.length;
        }
        return Reflect.has(target, property);
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          const value = target.item(+property);
          return value ? { value, writable: false, enumerable: true, configurable: true } : undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
  }
  get length() { this._sheet._refreshFromOwner(); return this._sheet._rules.length; }
  item(index) {
    this._sheet._refreshFromOwner();
    return this._sheet._rules[index >>> 0] || null;
  }
  forEach(callback, thisArg) {
    for (let i = 0; i < this.length; i++) callback.call(thisArg, this.item(i), i, this);
  }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.item(i); }
}

class CSSStyleSheet {
  constructor(_options) {
    this.ownerRule = null;
    this.disabled = false;
    this._ownerNode = null;
    this._sourceNode = null;
    this._sourceText = "";
    this._href = null;
    this._originClean = true;
    this._rules = [];
    this._cssRules = new CSSRuleList(this);
    this._adopters = new Set();
  }
  get type() { return "text/css"; }
  get ownerNode() { return this._ownerNode; }
  get parentStyleSheet() { return null; }
  get href() { return this._href; }
  get title() { return this._ownerNode?.getAttribute?.("title") || ""; }
  get cssRules() {
    this._assertOriginClean();
    this._refreshFromOwner();
    return this._cssRules;
  }
  get rules() { return this.cssRules; }
  _bindOwner(ownerNode, sourceNode = ownerNode) {
    this._ownerNode = ownerNode;
    this._sourceNode = sourceNode;
    this._sourceText = null;
    this._refreshFromOwner();
  }
  _bindLinkedOwner(ownerNode, sourceNode, href, originClean) {
    this._ownerNode = ownerNode;
    this._sourceNode = sourceNode;
    this._sourceText = null;
    this._href = href || null;
    this._originClean = originClean !== false;
    if (this._originClean) this._refreshFromOwner();
    else {
      this._setRules([]);
      this._sourceText = sourceNode?.textContent || "";
    }
  }
  _assertOriginClean() {
    if (!this._originClean) {
      throw new DOMException("Cannot access rules in a cross-origin stylesheet", "SecurityError");
    }
  }
  _refreshFromOwner() {
    if (!this._sourceNode || !this._originClean) return;
    const text = this._sourceNode.textContent || "";
    if (text === this._sourceText) return;
    const parsed = _splitTopLevelCssRules(text);
    const rules = parsed.rules.map(_cssRuleFromText).filter(Boolean);
    this._setRules(rules);
    this._sourceText = text;
  }
  _setRules(rules) {
    for (const rule of this._rules) rule._parentStyleSheet = null;
    this._rules.splice(0, this._rules.length, ...rules);
    for (const rule of this._rules) rule._parentStyleSheet = this;
  }
  _serializeText() { return this._rules.map(rule => rule.cssText).join("\n"); }
  _ruleChanged() {
    const text = this._serializeText();
    this._sourceText = text;
    // DOM text is the renderer bridge for this bounded CSSOM implementation:
    // its ordinary style-element mutation path invalidates cascade/layout.
    // Avoiding the observable text rewrite requires a future native effective-
    // source channel shared by CSSOM and the renderer.
    if (this._sourceNode && this._sourceNode.textContent !== text) this._sourceNode.textContent = text;
    _syncAdoptedStyleSheet(this);
  }
  insertRule(rule, index = 0) {
    if (arguments.length < 1) throw new TypeError("CSSStyleSheet.insertRule requires a rule");
    this._assertOriginClean();
    this._refreshFromOwner();
    const idx = Number(index) >>> 0;
    if (idx > this._rules.length) throw new DOMException("Rule index is out of range", "IndexSizeError");
    const parsed = _splitTopLevelCssRules(String(rule));
    if (!parsed.valid || parsed.rules.length !== 1) {
      throw new DOMException("The rule could not be parsed", "SyntaxError");
    }
    const cssRule = _cssRuleFromText(parsed.rules[0]);
    if (!cssRule) throw new DOMException("The rule could not be parsed", "SyntaxError");
    cssRule._parentStyleSheet = this;
    this._rules.splice(idx, 0, cssRule);
    this._ruleChanged();
    return idx;
  }
  deleteRule(index) {
    if (arguments.length < 1) throw new TypeError("CSSStyleSheet.deleteRule requires an index");
    this._assertOriginClean();
    this._refreshFromOwner();
    const idx = Number(index) >>> 0;
    if (idx >= this._rules.length) throw new DOMException("Rule index is out of range", "IndexSizeError");
    const [removed] = this._rules.splice(idx, 1);
    if (removed) removed._parentStyleSheet = null;
    this._ruleChanged();
  }
  addRule(selector, style, index) {
    this.insertRule(String(selector) + "{" + String(style) + "}", index ?? this._rules.length);
    return -1;
  }
  removeRule(index = 0) { this.deleteRule(index); }
  replace(text) { this.replaceSync(text); return Promise.resolve(this); }
  replaceSync(text) {
    this._assertOriginClean();
    const parsed = _splitTopLevelCssRules(String(text));
    this._setRules(parsed.rules.map(_cssRuleFromText).filter(Boolean));
    this._ruleChanged();
  }
}

const _styleElementSheets = new WeakMap();
function _styleElementIsCssomBridge(style) {
  return style.hasAttribute("data-obscura-adopted")
    || style.hasAttribute("data-obscura-linked")
    || style.hasAttribute("data-obscura-external-stylesheets")
    || style.hasAttribute("data-obscura-inline-import");
}
function _styleElementHasCssSheet(style) {
  if (!style || style.localName !== "style" || !style.isConnected) return false;
  // These nodes carry renderer input for another stylesheet owner. Exposing a
  // second style-owned sheet would duplicate entries and, for remote links,
  // bypass the link sheet's origin-clean cssRules check.
  if (_styleElementIsCssomBridge(style)) return false;
  const type = (style.getAttribute("type") || "").trim().toLowerCase();
  return !type || type === "text/css";
}
function _sheetForStyleElement(style) {
  if (!_styleElementHasCssSheet(style)) {
    _detachStyleSheet(style);
    return null;
  }
  let sheet = _styleElementSheets.get(style);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet._bindOwner(style);
    _styleElementSheets.set(style, sheet);
  }
  return sheet;
}
function _detachStyleSheet(style) {
  const sheet = _styleElementSheets.get(style);
  if (!sheet) return;
  sheet._ownerNode = null;
  sheet._sourceNode = null;
  _styleElementSheets.delete(style);
}
function _linkElementHasCssSheet(link) {
  if (!link || link.localName !== "link" || !link.isConnected) return false;
  const rel = (link.getAttribute("rel") || link.rel || "").toLowerCase().split(/\s+/);
  const type = (link.getAttribute("type") || "").trim().toLowerCase();
  return rel.includes("stylesheet") && (!type || type === "text/css")
    && _linkedStylesheetNodes.has(link);
}
function _sheetForLinkElement(link) {
  if (!_linkElementHasCssSheet(link)) {
    _detachLinkedStyleSheet(link);
    return null;
  }
  let sheet = _linkElementSheets.get(link);
  if (!sheet) {
    sheet = _registerLinkedStylesheet(link, _linkedStylesheetNodes.get(link));
  }
  return sheet;
}
function _detachLinkedStyleSheet(link) {
  const sheet = _linkElementSheets.get(link);
  if (!sheet) return;
  sheet._ownerNode = null;
  sheet._sourceNode = null;
  _linkElementSheets.delete(link);
}
// Called wherever a subtree stops being connected. Two things are keyed on
// that: its stylesheets leave document.styleSheets, and any iframe it took
// with it leaves window[i].
function _subtreeDisconnected(root) {
  if (!root) return;
  _syncWindowFrameIndices();
  if (root.nodeType === 1 && root.localName === "style") _detachStyleSheet(root);
  if (root.nodeType === 1 && root.localName === "link") _detachLinkedStyleSheet(root);
  if (!root.querySelectorAll) return;
  for (const style of _internalQuerySelectorAll(root, "style")) _detachStyleSheet(style);
  for (const link of _internalQuerySelectorAll(root, 'link[rel~="stylesheet"]')) {
    _detachLinkedStyleSheet(link);
  }
}

class StyleSheetList {
  constructor(root) {
    this._root = root;
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          return target.item(+property) || undefined;
        }
        return Reflect.get(target, property, receiver);
      },
      has(target, property) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          return +property < target.length;
        }
        return Reflect.has(target, property);
      },
    });
  }
  _sheets() {
    const nodes = this._root.querySelectorAll
      ? _internalQuerySelectorAll(this._root, 'style, link[rel~="stylesheet"]')
      : [];
    const out = [];
    for (const style of nodes) {
      if (style.localName === "link") {
        const sheet = _sheetForLinkElement(style);
        if (sheet) out.push(sheet);
        continue;
      }
      if (_styleElementIsCssomBridge(style)) continue;
      const sheet = _sheetForStyleElement(style);
      if (sheet) out.push(sheet);
    }
    return out;
  }
  get length() { return this._sheets().length; }
  item(index) { return this._sheets()[index >>> 0] || null; }
  forEach(callback, thisArg) {
    const sheets = this._sheets();
    sheets.forEach((sheet, index) => callback.call(thisArg, sheet, index, this));
  }
  *[Symbol.iterator]() { yield* this._sheets(); }
}

Object.defineProperty(Element.prototype, "sheet", {
  get() {
    if (this.localName === "style") return _sheetForStyleElement(this);
    if (this.localName === "link") return _sheetForLinkElement(this);
    return null;
  },
  configurable: true,
});
globalThis.CSSRule = CSSRule;
globalThis.CSSStyleRule = CSSStyleRule;
globalThis.CSSRuleList = CSSRuleList;
globalThis.CSSStyleSheet = CSSStyleSheet;
globalThis.StyleSheetList = StyleSheetList;

function _syncAdoptedStyleSheet(sheet) {
  for (const root of Array.from(sheet._adopters || [])) {
    _syncAdoptedStyles(root);
  }
}

function _reconcileAdoptedStyleSheetAdopters(root, sheets) {
  const previous = root._registeredAdoptedStyleSheets
    || (root._registeredAdoptedStyleSheets = new Set());
  const current = new Set(Array.from(sheets || []).filter(sheet => sheet instanceof CSSStyleSheet));
  for (const sheet of previous) {
    if (!current.has(sheet)) sheet._adopters?.delete(root);
  }
  for (const sheet of current) {
    if (!previous.has(sheet)) sheet._adopters.add(root);
  }
  root._registeredAdoptedStyleSheets = current;
}

function _adoptedStyleTarget(root) {
  if (!root) return null;
  if (root.nodeType === 9) return root.head || root.documentElement;
  return root instanceof globalThis.ShadowRoot ? root : null;
}

function _syncAdoptedStyles(root) {
  const sheets = root[_adoptedSheetsSym] || [];
  _reconcileAdoptedStyleSheetAdopters(root, sheets);
  const nodes = root[_adoptedNodesSym] || (root[_adoptedNodesSym] = new Map());
  for (const [sheet, node] of Array.from(nodes.entries())) {
    if (!sheets.includes(sheet)) {
      node.remove();
      nodes.delete(sheet);
    }
  }
  const target = _adoptedStyleTarget(root);
  if (!target) return;
  for (const sheet of sheets) {
    if (!(sheet instanceof CSSStyleSheet)) continue;
    let node = nodes.get(sheet);
    if (!node || node.parentNode !== target) {
      node = (root.ownerDocument || globalThis.document).createElement("style");
      node.setAttribute("data-obscura-adopted", "");
      target.appendChild(node);
      nodes.set(sheet, node);
    }
    const css = Array.from(sheet.cssRules || [], rule => rule.cssText || "").join("\n");
    if (node.textContent !== css) node.textContent = css;
  }
}

// Keep the [SameObject] array identity stable even when the IDL setter replaces
// its contents. Mutating the backing target directly avoids intermediate
// materializations while assignment is in progress; ordinary array mutations
// still pass through the proxy and synchronize immediately.
const _adoptedSheetListTargets = new WeakMap();
function _makeAdoptedSheetList(root, values) {
  const target = Array.from(values || []);
  const list = new Proxy(target, {
    set(array, property, value) {
      Reflect.set(array, property, value);
      _syncAdoptedStyles(root);
      return true;
    },
    deleteProperty(array, property) {
      Reflect.deleteProperty(array, property);
      _syncAdoptedStyles(root);
      return true;
    },
  });
  _adoptedSheetListTargets.set(root, target);
  return list;
}

function _adoptedStyleSheetsFor(root) {
  if (!root[_adoptedSheetsSym]) {
    root[_adoptedSheetsSym] = _makeAdoptedSheetList(root, []);
  }
  return root[_adoptedSheetsSym];
}

function _replaceAdoptedStyleSheets(root, sheets) {
  const list = _adoptedStyleSheetsFor(root);
  const values = Array.from(sheets || []);
  const target = _adoptedSheetListTargets.get(root);
  target.splice(0, target.length, ...values);
  _syncAdoptedStyles(root);
  return list;
}

Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
  get() { return _adoptedStyleSheetsFor(this); },
  set(sheets) {
    _replaceAdoptedStyleSheets(this, sheets);
  },
  enumerable: true,
  configurable: true,
});

globalThis.__mutationObservers = [];
globalThis.MutationObserver = class MutationObserver {
  constructor(callback) {
    this._callback = callback;
    this._targets = [];
    this._records = [];
  }
  observe(target, options) {
    this._targets.push({ target, options: options || {} });
    globalThis.__mutationObservers.push(this);
  }
  disconnect() {
    this._targets = [];
    const idx = globalThis.__mutationObservers.indexOf(this);
    if (idx >= 0) globalThis.__mutationObservers.splice(idx, 1);
  }
  takeRecords() {
    const r = this._records.slice();
    this._records = [];
    return r;
  }
  _notify(records) {
    this._records.push(...records);
    Promise.resolve().then(() => {
      if (this._records.length > 0) {
        const batch = this._records.splice(0);
        try { this._callback(batch, this); } catch(e) { /* observer errors shouldn't propagate */ }
      }
    });
  }
};
globalThis.__notifyMutation = function(type, target_nid, addedNodes, removedNodes, attributeName, oldValue) {
  if (!globalThis.__mutationObservers.length) return;
  // Use `_wrap` (the canonical node-id → wrapper resolver) instead of a
  // direct cache poke. The previous code referenced `globalThis._cache`,
  // but `_cache` is a module-local Map — the lookup always returned
  // undefined, so the function silently bailed every time. Result: no
  // MutationObserver fired in obscura, ever, despite the call sites being
  // wired up at appendChild / setAttribute. _wrap also lazily creates a
  // wrapper for nodes that didn't have one yet (e.g. children parsed from
  // `set innerHTML`), which we need for record.target/added/removed.
  const target = _wrap(target_nid);
  if (!target) return;
  const record = {
    type: type, // 'childList', 'attributes', 'characterData'
    target: target,
    addedNodes: (addedNodes || []).map(nid => _wrap(nid)).filter(Boolean),
    removedNodes: (removedNodes || []).map(nid => _wrap(nid)).filter(Boolean),
    attributeName: attributeName || null,
    oldValue: oldValue ?? null,
    previousSibling: null,
    nextSibling: null,
  };
  // Walk target → ancestors so a subtree-mode observer rooted at any
  // ancestor matches. The previous implementation just checked that
  // `target.contains` and `target.closest` were defined (always true on
  // any Element), so subtree=true silently behaved like subtree=false and
  // every nested mutation missed its subscriber.
  for (const obs of globalThis.__mutationObservers) {
    let matched = false;
    for (const t of obs._targets) {
      const root = t.target;
      if (!root) continue;
      // Filter by type per the observer options. Default behaviour matches
      // real MutationObserver: attribute mutations need options.attributes,
      // characterData mutations need options.characterData, childList
      // needs options.childList.
      const wantsType =
        (type === 'attributes' && t.options.attributes) ||
        (type === 'characterData' && t.options.characterData) ||
        (type === 'childList' && t.options.childList);
      if (!wantsType) continue;
      if (root[_nidSym] === target_nid) { matched = true; break; }
      if (t.options.subtree) {
        // Walk parents until we hit the observed root or run off the tree.
        let cur = target.parentNode;
        while (cur) {
          if (cur[_nidSym] === root[_nidSym]) { matched = true; break; }
          cur = cur.parentNode;
        }
        if (matched) break;
      }
    }
    if (matched) obs._notify([record]);
  }
};

const _shadowCustomElementRegistries = new WeakMap();
globalThis.ShadowRoot = class ShadowRoot extends DocumentFragment {
  constructor(nid, host, options) {
    super(nid);
    this._host = host;
    this._mode = options.mode;
    this._delegatesFocus = !!options.delegatesFocus;
    this._slotAssignment = options.slotAssignment === 'manual' ? 'manual' : 'named';
    this._clonable = !!options.clonable;
    this._serializable = !!options.serializable;
    const registry = options.customElementRegistry;
    _shadowCustomElementRegistries.set(
      this,
      registry instanceof CustomElementRegistry ? registry : globalThis.customElements,
    );
  }
  get host() { return this._host; }
  get mode() { return this._mode; }
  get delegatesFocus() { return this._delegatesFocus; }
  get slotAssignment() { return this._slotAssignment; }
  get clonable() { return this._clonable; }
  get serializable() { return this._serializable; }
  get customElementRegistry() { return _shadowCustomElementRegistries.get(this) || null; }
  _assertInsertable(node, operation) {
    const createsComposedCycle = node instanceof ShadowRoot
      || node === this._host
      || !!(node?.contains && node.contains(this._host));
    if (createsComposedCycle) {
      throw new DOMException(
        `Failed to execute '${operation}' on 'Node': The new child would contain the parent.`,
        'HierarchyRequestError'
      );
    }
  }
  appendChild(child) {
    this._assertInsertable(child, 'appendChild');
    return super.appendChild(child);
  }
  insertBefore(node, reference) {
    if (reference && reference.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'insertBefore' on 'Node': The reference node is not a child of this node.",
        'NotFoundError'
      );
    }
    if (node === reference) return node;
    this._assertInsertable(node, 'insertBefore');
    return super.insertBefore(node, reference);
  }
  removeChild(child) {
    if (!child || child.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        'NotFoundError'
      );
    }
    return super.removeChild(child);
  }
  replaceChild(node, oldChild) {
    if (!oldChild || oldChild.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'replaceChild' on 'Node': The node to be replaced is not a child of this node.",
        'NotFoundError'
      );
    }
    if (node === oldChild) return oldChild;
    this._assertInsertable(node, 'replaceChild');
    return super.replaceChild(node, oldChild);
  }
  getRootNode(options) {
    return options?.composed ? this._host.getRootNode(options) : this;
  }
  get activeElement() { return null; }
  get styleSheets() {
    if (!this[_styleSheetListSym]) this[_styleSheetListSym] = new StyleSheetList(this);
    return this[_styleSheetListSym];
  }
  cloneNode() {
    throw new DOMException(
      'Failed to execute cloneNode on Node: ShadowRoot nodes are not clonable.',
      'NotSupportedError'
    );
  }
  setHTMLUnsafe(value) { this.innerHTML = String(value == null ? '' : value); }
  getHTML() { return this.innerHTML; }
};
