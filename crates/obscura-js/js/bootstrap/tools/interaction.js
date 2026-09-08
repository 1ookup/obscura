// Generic, policy-driven interaction helpers. They are inert unless the
// embedder installs `__obscura_input_strategy`; the core never matches page
// text or hostnames. The click path uses the same trusted activation behavior
// as CDP Input and the natural type helper emits one input event per code unit.
globalThis.__obscura_schedule_input_strategy = function() {
  const policy = globalThis.__obscura_input_strategy;
  if (!policy || !policy.selector || globalThis.__obscura_input_strategy_done) return;
  const run = () => {
    let target;
    try { target = document.querySelector(policy.selector); } catch (e) { return; }
    if (!target || (target.matches && target.matches(':disabled'))) return;
    globalThis.__obscura_input_strategy_done = true;
    const activate = () => {
      const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
      if (rect && rect.width > 0 && rect.height > 0) {
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, buttons: 1, pointerId: __obscura_pointer_id(true), pointerType: 'mouse', isPrimary: true };
        target.dispatchEvent(__obscura_markTrusted(new PointerEvent('pointerdown', opts)));
        target.dispatchEvent(__obscura_markTrusted(new MouseEvent('mousedown', opts)));
        target.dispatchEvent(__obscura_markTrusted(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 }))));
        target.dispatchEvent(__obscura_markTrusted(new MouseEvent('mouseup', Object.assign({}, opts, { buttons: 0 }))));
      }
      target.click();
    };
    const delay = Math.max(0, Number(policy.delayMs) || 0);
    if (delay) setTimeout(activate, delay); else activate();
  };
  // The embedder installs the policy while the parsed document is already
  // attached, but this runtime does not synthesize a DOMContentLoaded event
  // for every navigation. Probe once immediately when the selector exists,
  // while retaining the event/task path for genuinely late DOM insertion.
  let present = false;
  try { present = !!document.querySelector(policy.selector); } catch (e) {}
  if (present || document.readyState !== 'loading') setTimeout(run, 0);
  else {
    document.addEventListener('DOMContentLoaded', run, { once: true });
    setTimeout(run, 0);
  }
};
globalThis.__obscura_natural_type = function(target, text, keyDelayMs) {
  target = target || document.activeElement;
  if (!target || !('value' in target)) return Promise.resolve(false);
  const value = String(text), delay = Math.max(0, Number(keyDelayMs) || 0);
  let index = 0;
  return new Promise(resolve => {
    const step = () => {
      if (index >= value.length) { resolve(true); return; }
      const ch = value[index++];
      const before = String(target.value || '');
      __obscura_setFieldValue(target, 'value', before + ch);
      target.dispatchEvent(__obscura_markTrusted(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' })));
      if (delay) setTimeout(step, delay); else _browserPostedTaskEnqueue(step, 0);
    };
    step();
  });
};

// WHATWG "convert nodes into a node": a Node argument passes through, anything
// else is stringified into a Text node, so e.g. append(null) inserts the text
// "null" and append(undefined) inserts "undefined" per the (Node or DOMString)
// union, rather than throwing.
function _convertNodes(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n && typeof n[_nidSym] === "number") out.push(n);
    else out.push(document.createTextNode(String(n)));
  }
  return out;
}

// ---- Reflected IDL attributes (WHATWG) ---------------------------------------
// Installed ONCE on Element.prototype as shared getter/setter pairs. This is
// data-driven so there is no per-element defineProperty: element creation and
// the querySelector/mutation hot paths are unaffected (each access is a normal
// prototype getter that reads the backing attribute). Covers the global content
// attributes reflected on every element plus the ARIAMixin (aria-* + ariaXxx).
(function installElementReflectors() {
  const P = Element.prototype;
  const def = (name, get, set) => {
    if (Object.prototype.hasOwnProperty.call(P, name)) return; // never clobber an existing member
    Object.defineProperty(P, name, { get, set, enumerable: true, configurable: true });
  };
  // WHATWG "rules for parsing integers"; returns a JS number or null on failure.
  const parseIntAttr = (s) => {
    if (s === null || s === undefined) return null;
    const m = /^[ \t\n\f\r]*([+-]?[0-9]+)/.exec(String(s));
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  };
  // IDL `long` conversion (ToInt32): finite, truncated, wrapped to 32-bit signed.
  const toLong = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    n = Math.trunc(n) % 4294967296;
    if (n >= 2147483648) n -= 4294967296;
    else if (n < -2147483648) n += 4294967296;
    return n;
  };
  // DOMString reflect: get -> attribute or ""; set -> setAttribute(String(v)).
  const reflectStr = (name, attr) => def(name,
    function () { const v = this.getAttribute(attr); return v === null ? "" : v; },
    function (v) { this.setAttribute(attr, String(v)); });
  // boolean reflect: get -> hasAttribute; set -> truthy ? add("") : remove.
  const reflectBool = (name, attr) => def(name,
    function () { return this.hasAttribute(attr); },
    function (v) { if (v) this.setAttribute(attr, ""); else this.removeAttribute(attr); });
  // long reflect: get -> parse else default (static value or per-element fn);
  // set -> setAttribute(String(ToInt32(v))).
  const reflectLong = (name, attr, dflt) => def(name,
    function () {
      const r = parseIntAttr(this.getAttribute(attr));
      if (r !== null && r >= -2147483648 && r <= 2147483647) return r;
      return typeof dflt === "function" ? dflt.call(this) : dflt;
    },
    function (v) { this.setAttribute(attr, String(toLong(v))); });
  // enumerated reflect: get -> canonical (lowercased) keyword, else missing/
  // invalid default; set -> setAttribute(String(v)) (canonicalization on get).
  const reflectEnum = (name, attr, keywords, missingDefault, invalidDefault) => def(name,
    function () {
      const v = this.getAttribute(attr);
      if (v === null) return missingDefault;
      const lc = String(v).toLowerCase();
      return keywords.indexOf(lc) !== -1 ? lc : invalidDefault;
    },
    function (v) { this.setAttribute(attr, String(v)); });
  // nullable DOMString reflect (ARIA): get -> attribute or null; set -> null/
  // undefined removes, else setAttribute(String(v)).
  const reflectNullable = (name, attr) => def(name,
    function () { return this.getAttribute(attr); },
    function (v) { if (v === null || v === undefined) this.removeAttribute(attr); else this.setAttribute(attr, String(v)); });

  // Global content attributes reflected on every element (HTML "global attributes").
  reflectStr("title", "title");
  reflectStr("lang", "lang");
  reflectStr("accessKey", "accesskey");
  reflectStr("slot", "slot");
  reflectEnum("dir", "dir", ["ltr", "rtl", "auto"], "", "");
  reflectBool("autofocus", "autofocus");
  reflectBool("hidden", "hidden");
  // tabIndex default is element-dependent (0 for natively-focusable, else -1);
  // reflection.js does not assert it, but match the common case anyway.
  reflectLong("tabIndex", "tabindex", function () {
    const ln = this.localName;
    if (ln === "a" || ln === "area" || ln === "link") return this.hasAttribute("href") ? 0 : -1;
    return (ln === "button" || ln === "input" || ln === "select" || ln === "textarea" || ln === "iframe") ? 0 : -1;
  });

  // ARIAMixin: aria-* content attributes reflected as nullable DOMString IDL
  // properties (ariaAtomic <-> aria-atomic, ...).
  const ARIA = {
    ariaAtomic: "aria-atomic", ariaAutoComplete: "aria-autocomplete", ariaBrailleLabel: "aria-braillelabel",
    ariaBrailleRoleDescription: "aria-brailleroledescription", ariaBusy: "aria-busy", ariaChecked: "aria-checked",
    ariaColCount: "aria-colcount", ariaColIndex: "aria-colindex", ariaColIndexText: "aria-colindextext",
    ariaColSpan: "aria-colspan", ariaCurrent: "aria-current", ariaDescription: "aria-description",
    ariaDisabled: "aria-disabled", ariaExpanded: "aria-expanded", ariaHasPopup: "aria-haspopup",
    ariaHidden: "aria-hidden", ariaInvalid: "aria-invalid", ariaKeyShortcuts: "aria-keyshortcuts",
    ariaLabel: "aria-label", ariaLevel: "aria-level", ariaLive: "aria-live", ariaModal: "aria-modal",
    ariaMultiLine: "aria-multiline", ariaMultiSelectable: "aria-multiselectable", ariaOrientation: "aria-orientation",
    ariaPlaceholder: "aria-placeholder", ariaPosInSet: "aria-posinset", ariaPressed: "aria-pressed",
    ariaReadOnly: "aria-readonly", ariaRelevant: "aria-relevant", ariaRequired: "aria-required",
    ariaRoleDescription: "aria-roledescription", ariaRowCount: "aria-rowcount", ariaRowIndex: "aria-rowindex",
    ariaRowIndexText: "aria-rowindextext", ariaRowSpan: "aria-rowspan", ariaSelected: "aria-selected",
    ariaSetSize: "aria-setsize", ariaSort: "aria-sort", ariaValueMax: "aria-valuemax",
    ariaValueMin: "aria-valuemin", ariaValueNow: "aria-valuenow", ariaValueText: "aria-valuetext",
  };
  for (const prop in ARIA) reflectNullable(prop, ARIA[prop]);
})();

function _parseXPathPredicate(part) {
  part = String(part || "").trim();
  let m = part.match(/^@([A-Za-z_][\w:.-]*)(?:\s*=\s*(["'])(.*?)\2)?$/);
  if (m) return { kind: "attr", name: m[1], value: m[3] };
  m = part.match(/^contains\(\s*@([A-Za-z_][\w:.-]*)\s*,\s*(["'])(.*?)\2\s*\)$/);
  if (m) return { kind: "contains", name: m[1], value: m[3] };
  m = part.match(/^starts-with\(\s*@([A-Za-z_][\w:.-]*)\s*,\s*(["'])(.*?)\2\s*\)$/);
  if (m) return { kind: "startsWith", name: m[1], value: m[3] };
  return null;
}

function _xpathPredicateParts(body) {
  const out = [];
  let quote = null, start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (body.slice(i, i + 5).toLowerCase() === " and " || body.slice(i, i + 4).toLowerCase() === "and ") {
      const before = body.slice(start, i).trim();
      if (before) out.push(before);
      i += body[i] === " " ? 4 : 3;
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  if (last) out.push(last);
  return out.length ? out : [body];
}

function _xpathFindNodes(expression, contextNode) {
  expression = String(expression || "").trim();
  contextNode = contextNode || document;
  const m = expression.match(/^(?:\.?\/\/)([A-Za-z*][\w:.-]*|\*)?((?:\[[^\]]+\])*)$/);
  if (!m) return [];
  const tag = !m[1] || m[1] === "*" ? "*" : m[1];
  const predicates = [];
  const predText = m[2] || "";
  for (const match of predText.matchAll(/\[([^\]]+)\]/g)) {
    for (const part of _xpathPredicateParts(match[1])) {
      const pred = _parseXPathPredicate(part);
      if (pred) predicates.push(pred);
    }
  }
  const source = typeof contextNode.querySelectorAll === "function"
    ? contextNode.querySelectorAll(tag)
    : [];
  return Array.prototype.filter.call(source, (node) => {
    for (const pred of predicates) {
      const value = node.getAttribute?.(pred.name);
      if (pred.kind === "attr") {
        if (value === null) return false;
        if (pred.value !== undefined && value !== pred.value) return false;
      } else if (pred.kind === "contains") {
        if (value === null || !String(value).includes(pred.value)) return false;
      } else if (pred.kind === "startsWith") {
        if (value === null || !String(value).startsWith(pred.value)) return false;
      }
    }
    return true;
  });
}

function _makeXPathResult(type, nodes) {
  nodes = Array.from(nodes || []);
  const requested = type || XPathResult.ANY_TYPE;
  const resultType = requested === XPathResult.ANY_TYPE
    ? XPathResult.UNORDERED_NODE_ITERATOR_TYPE
    : requested;
  let iter = 0;
  return {
    resultType,
    singleNodeValue: nodes[0] || null,
    snapshotLength: nodes.length,
    snapshotItem(i) { return nodes[i] || null; },
    iterateNext() { return nodes[iter++] || null; },
    invalidIteratorState: false,
    numberValue: nodes.length,
    stringValue: nodes[0]?.textContent || "",
    booleanValue: nodes.length > 0,
  };
}

// `document.domain` exposes the document's effective host.  Keep the relaxed
// value on the live Document object so a navigation (which installs a new
// Document in __obscura_init) naturally restores the URL host.  Detached
// documents inherit the incumbent realm's principal for reads, which is why a
// `new Document().domain` read reflects the live document rather than its own
// about:blank URL.
function _documentUrlHost() {
  try { return new URL(_domParse("document_url") || "about:blank").hostname; }
  catch (_) { return ""; }
}
function _incumbentDocumentDomain() {
  const live = globalThis.document;
  return live && typeof live._effectiveDomain === "string"
    ? live._effectiveDomain
    : _documentUrlHost();
}
function _throwDocumentDomainSecurityError() {
  throw new DOMException("Failed to set the 'domain' property on 'Document'", "SecurityError");
}

const _detachedDocumentBrand = new WeakSet();
function _stampDetachedDocumentNode(document, node) {
  if (node && _detachedDocumentBrand.has(document)) {
    _detachedNodeOwners.set(node, document);
    if (node[_nidSym] !== undefined) {
      const rootNid = +_dom("document_root", node[_nidSym]);
      _detachedRootOwners.set(rootNid || node[_nidSym], document);
    }
  }
  return node;
}
function _documentPrivacyRoot(value, method) {
  const branded = value instanceof Document
    || _detachedDocumentBrand.has(value)
    || (value && typeof value === "object" && value.nodeType === 9
      && /Document$/.test(value.constructor && value.constructor.name || ""));
  if (!branded) {
    throw new TypeError("Failed to execute '" + method + "' on 'Document': Illegal invocation");
  }
  if (value === globalThis.document) return _callingFrameRoot();
  if (typeof value[_scopeRootSym] === "number" && value._scopeInfo && value._scopeInfo()) {
    return value[_scopeRootSym];
  }
  return -1;
}

function _privateStateTokenError(method, status) {
  if (status === "invalid-state") {
    return new DOMException(
      "Failed to execute '" + method + "' on 'Document': " + method
        + ": Cannot execute in documents lacking top-frame origins.",
      "InvalidStateError");
  }
  if (status === "quota") {
    return new DOMException("Failed to retrieve " + method + " response.", "OperationError");
  }
  return new TypeError(
    "Failed to execute '" + method + "' on 'Document': " + method
      + ": Private Token issuer origins must be both HTTP(S) and secure (\"potentially trustworthy\").");
}

const _queryCommandSupportedNames = new Set([
  'backcolor', 'bold', 'copy', 'createlink', 'cut', 'decreasefontsize',
  'delete', 'enableabsolutepositioneditor', 'enableinlinetableediting',
  'enableobjectresizing', 'fontname', 'fontsize', 'forecolor', 'formatblock',
  'forwarddelete', 'hilitecolor', 'increasefontsize', 'indent',
  'insertbronreturn', 'inserthorizontalrule', 'inserthtml', 'insertimage',
  'insertlinebreak', 'insertorderedlist', 'insertparagraph', 'inserttext',
  'insertunorderedlist', 'italic', 'justifycenter', 'justifyfull',
  'justifyleft', 'justifynone', 'justifyright', 'outdent', 'redo',
  'removeformat', 'selectall', 'strikethrough', 'stylewithcss', 'subscript',
  'superscript', 'underline', 'undo', 'unlink', 'usecss',
]);
const _queryCommandEditableNames = new Set([
  'backcolor', 'bold', 'createlink', 'delete', 'fontname', 'fontsize',
  'forecolor', 'formatblock', 'forwarddelete', 'hilitecolor', 'indent',
  'inserthorizontalrule', 'inserthtml', 'insertimage', 'insertlinebreak',
  'insertorderedlist', 'insertparagraph', 'inserttext', 'insertunorderedlist',
  'italic', 'justifycenter', 'justifyfull', 'justifyleft', 'justifyright',
  'outdent', 'removeformat', 'strikethrough', 'subscript', 'superscript',
  'underline', 'unlink',
]);
function _queryCommandName(doc, method, command, argumentCount) {
  _documentPrivacyRoot(doc, method);
  if (argumentCount < 1) {
    throw new TypeError(
      "Failed to execute '" + method + "' on 'Document': 1 argument required, but only 0 present.");
  }
  return String(command).toLowerCase();
}
function _queryCommandEditingHost(doc) {
  let node = doc.activeElement;
  while (node && node !== doc) {
    const reflected = typeof node.contentEditable === 'string'
      ? node.contentEditable.toLowerCase() : '';
    const attribute = typeof node.getAttribute === 'function'
      ? node.getAttribute('contenteditable') : null;
    if (reflected === 'true' || reflected === 'plaintext-only'
        || (attribute !== null && String(attribute).toLowerCase() !== 'false')) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
function _queryCommandState(doc, command) {
  const tags = {
    bold: new Set(['B', 'STRONG']),
    italic: new Set(['I', 'EM']),
    underline: new Set(['U']),
    strikethrough: new Set(['S', 'STRIKE']),
    subscript: new Set(['SUB']),
    superscript: new Set(['SUP']),
  }[command];
  if (!tags) return false;
  const selection = doc.getSelection();
  let node = selection && selection.anchorNode;
  if (node && node.nodeType !== 1) node = node.parentElement;
  while (node && node !== doc) {
    if (tags.has(node.tagName)) return true;
    node = node.parentElement;
  }
  return false;
}

const _xpathExpressionKey = Symbol('XPathExpression');
const _xpathExpressionState = new WeakMap();
class XPathExpression {
  constructor(key = undefined, document, expression, resolver) {
    if (key !== _xpathExpressionKey) {
      throw new TypeError("Failed to construct 'XPathExpression': Illegal constructor");
    }
    _xpathExpressionState.set(this, { document, expression, resolver });
  }
  evaluate(contextNode, type = 0, result = null) {
    const state = _xpathExpressionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'evaluate' on 'XPathExpression': 1 argument required, but only 0 present.");
    }
    return state.document.evaluate(
      state.expression, contextNode, state.resolver, type, result);
  }
  get [Symbol.toStringTag]() { return 'XPathExpression'; }
}
globalThis.XPathExpression = XPathExpression;

const _caretPositionKey = Symbol('CaretPosition');
const _caretPositionState = new WeakMap();
class CaretPosition {
  constructor(key = undefined, document, node, offset) {
    if (key !== _caretPositionKey) {
      throw new TypeError("Failed to construct 'CaretPosition': Illegal constructor");
    }
    _caretPositionState.set(this, { document, node, offset });
  }
  get offsetNode() {
    const state = _caretPositionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.node;
  }
  get offset() {
    const state = _caretPositionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.offset;
  }
  getClientRect() {
    const state = _caretPositionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    const range = new Range();
    range.setStart(state.node, state.offset);
    range.setEnd(state.node, state.offset);
    return range.getBoundingClientRect();
  }
  get [Symbol.toStringTag]() { return 'CaretPosition'; }
}
globalThis.CaretPosition = CaretPosition;
function _caretPositionAt(document, x, y) {
  let hit = null;
  try { hit = document.elementFromPoint(Number(x) || 0, Number(y) || 0); }
  catch (_error) {}
  if (!hit) hit = document.body || document.documentElement || document;
  let text = null;
  const stack = hit && hit.childNodes ? Array.from(hit.childNodes).reverse() : [];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType === 3) { text = node; break; }
    if (node.childNodes) {
      const children = Array.from(node.childNodes);
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }
  const node = text || hit;
  let offset = 0;
  if (text) {
    const length = _rngNodeLength(text);
    const rect = hit && typeof hit.getBoundingClientRect === 'function'
      ? hit.getBoundingClientRect() : null;
    if (rect && rect.width > 0) {
      offset = Math.round(((Number(x) || 0) - rect.left) / rect.width * length);
      offset = Math.max(0, Math.min(length, offset));
    } else {
      offset = length;
    }
  }
  return new CaretPosition(_caretPositionKey, document, node, offset);
}
