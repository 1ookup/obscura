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
  if (trimmed[0] === "@") {
    // `@keyframes name { ... }` gets a real CSSKeyframesRule so `.name`,
    // `.cssRules` and the child key blocks answer like every browser.
    const keyframes = /^@(-webkit-)?keyframes\s+([\w-]+)\s*\{([\s\S]*)\}$/.exec(trimmed);
    if (keyframes) return new CSSKeyframesRule(keyframes[2], keyframes[3]);
    return new CSSRule(trimmed, 0);
  }
  const open = trimmed.indexOf("{");
  if (open <= 0 || !trimmed.endsWith("}")) return null;
  const selector = trimmed.slice(0, open).trim();
  if (!selector) return null;
  return new CSSStyleRule(selector, trimmed.slice(open + 1, -1));
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
