// One color slot per document, kept in a closure map so the only names the five
// legacy attributes add to Document.prototype are the five Chrome exposes.
const _legacyDocColorSlots = new WeakMap();
function _documentLegacyColor(doc, name, value) {
  var store = _legacyDocColorSlots.get(doc);
  if (!store) { store = Object.create(null); _legacyDocColorSlots.set(doc, store); }
  if (arguments.length > 2) { store[name] = value == null ? '' : String(value); return; }
  return name in store ? store[name] : '';
}

class Document extends Node {
  constructor(nid) {
    // Node's constructor stores the handle under _nidSym already, which keeps
    // it out of Object.getOwnPropertyNames / Object.keys / for-in without the
    // per-document defineProperty this used to need.
    super(nid);
  }
  get timeline() {
    if (!this._timeline) {
      this._timeline = new DocumentTimeline();
    }
    return this._timeline;
  }
  getAnimations() {
    return Array.from(_waapiAnimations).filter(animation => animation.playState !== 'idle'
      && (animation.playState !== 'finished' || animation.effect?._timing.fill === 'forwards' || animation.effect?._timing.fill === 'both'));
  }
  get documentElement() {
    if (typeof this[_scopeRootSym] === 'number') {
      return _wrapEl(+_dom("query_selector_scoped", this[_scopeRootSym], "html"));
    }
    return _wrapEl(+_dom("document_element"));
  }
  get children() {
    return _documentCollection(this, 'children', () => {
      const root = this.documentElement;
      return root ? [root] : [];
    });
  }
  get childElementCount() { return this.documentElement ? 1 : 0; }
  get firstElementChild() { return this.documentElement; }
  get lastElementChild() { return this.documentElement; }
  // Native Document getters query the tree internally. Calling the public
  // querySelector method here lets a page's monkey-patch observe engine
  // bookkeeping (and pollutes the challenge's selector trace).
  get head() { return _internalQuerySelector(this, "head"); }
  get body() { return _internalQuerySelector(this, "body"); }
  get customElementRegistry() { return globalThis.customElements; }
  get designMode() { return 'off'; }
  set designMode(value) { String(value); }
  // HTMLDocument exposes the root element's direction on the prototype.
  // Chrome does not expose a Document.lang prototype member; page code that
  // assigns document.lang consequently creates an ordinary own property.
  get dir() {
    const root = this.documentElement;
    if (!root) return '';
    const value = (root.getAttribute('dir') || '').toLowerCase();
    return value === 'ltr' || value === 'rtl' || value === 'auto' ? value : '';
  }
  set dir(value) {
    const root = this.documentElement;
    if (root) root.setAttribute('dir', String(value));
  }
  get featurePolicy() {
    if (!_documentFeaturePolicies.has(this)) {
      _documentFeaturePolicies.set(this, new FeaturePolicy(_featurePolicyKey, this));
    }
    return _documentFeaturePolicies.get(this);
  }
  get fragmentDirective() {
    if (!_documentFragmentDirectives.has(this)) {
      _documentFragmentDirectives.set(this, new _FragmentDirective());
    }
    return _documentFragmentDirectives.get(this);
  }
  get activeViewTransition() { return _activeViewTransitions.get(this) || null; }
  get fullscreenElement() { return null; }
  get pictureInPictureElement() { return null; }
  get pointerLockElement() { return null; }
  get rootElement() { return null; }
  get textContent() { return null; }
  set textContent(_value) {}
  get webkitCurrentFullScreenElement() { return null; }
  get webkitFullscreenElement() { return null; }
  get xmlEncoding() { return null; }
  get xmlVersion() { return null; }
  get fullscreen() { return false; }
  get prerendering() { return false; }
  get wasDiscarded() { return false; }
  get webkitIsFullScreen() { return false; }
  get xmlStandalone() { return false; }
  get fullscreenEnabled() { return true; }
  get pictureInPictureEnabled() { return true; }
  get webkitFullscreenEnabled() { return true; }
  get doctype() {
    if (typeof this[_scopeRootSym] === 'number') {
      const ids = _domParse("child_nodes", this[_scopeRootSym]) || [];
      for (const cid of ids) {
        if (+_dom("node_type", cid) === 10) return _wrap(+cid);
      }
      return null;
    }
    if (this._doctype !== undefined) return this._doctype;
    const info = _domParse("document_doctype");
    if (info && info.name) {
      this._doctype = new DocumentType(info.nodeId, info.name, info.publicId || "", info.systemId || "");
    } else {
      this._doctype = null;
    }
    return this._doctype;
  }
  get title() {
    if (typeof this[_scopeRootSym] === 'number') {
      const title = _internalQuerySelector(this, "title");
      return title ? (title.textContent || '').split(/[\t\n\f\r ]+/).filter(Boolean).join(' ') : '';
    }
    return _domParse("document_title") ?? "";
  }
  set title(v) {
    const value = String(v);
    let title = _internalQuerySelector(this, "title");
    if (!title) {
      let head = this.head;
      const root = this.documentElement;
      if (!head && root) {
        head = this.createElement("head");
        root.insertBefore(head, this.body);
      }
      if (!head) return;
      title = this.createElement("title");
      head.appendChild(title);
    }
    title.textContent = value;
  }
  get URL() {
    if (typeof this[_scopeRootSym] === 'number') {
      const info = _domParse('document_scope_info', this[_scopeRootSym]);
      return (info && info.url) || 'about:blank';
    }
    return _domParse("document_url") ?? "";
  }
  get documentURI() { return this.URL; }
  get domain() {
    if (typeof this[_scopeRootSym] === 'number') {
      if (typeof this[_effectiveDomainSym] === 'string') return this[_effectiveDomainSym];
      const info = _domParse('document_scope_info', this[_scopeRootSym]);
      if (!info || !info.url || (info.sandboxActive && !info.allowSameOrigin)) return '';
      try { return new URL(info.origin || info.url).hostname || ''; } catch (_e) { return ''; }
    }
    return this === globalThis.document
      ? (typeof this._effectiveDomain === "string" ? this._effectiveDomain : _documentUrlHost())
      : _incumbentDocumentDomain();
  }
  set domain(value) {
    // Web IDL performs DOMString conversion before the setter algorithm checks
    // whether the Document has a browsing context.
    const input = String(value);
    if (this !== globalThis.document) _throwDocumentDomainSecurityError();
    const current = this.domain;
    if (!current) _throwDocumentDomainSecurityError();
    const candidate = Deno.core.ops.op_document_domain_candidate(current, input);
    if (!candidate) _throwDocumentDomainSecurityError();
    // This runtime currently has one top-level browsing context and no
    // principal-backed same-origin-domain comparison.  Persisting the
    // validated effective domain supplies the standards-shaped API without
    // weakening iframe/fetch/storage origin checks; those must be wired to a
    // future browsing-context principal model before domain relaxation can
    // grant cross-document access.
    this._effectiveDomain = candidate;
  }
  get referrer() {
    if (typeof this[_scopeRootSym] === 'number') {
      const info = _domParse('document_scope_info', this[_scopeRootSym]);
      return (info && info.referrer) || '';
    }
    return _domParse("document_referrer") ?? "";
  }
  async hasPrivateToken(issuer) {
    const root = _documentPrivacyRoot(this, "hasPrivateToken");
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'hasPrivateToken' on 'Document': 1 argument required, but only 0 present.");
    }
    const result = JSON.parse(Deno.core.ops.op_private_state_query(
      "token", String(issuer), root));
    if (result.status !== "ok") throw _privateStateTokenError("hasPrivateToken", result.status);
    return !!result.value;
  }
  async hasRedemptionRecord(issuer) {
    const root = _documentPrivacyRoot(this, "hasRedemptionRecord");
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'hasRedemptionRecord' on 'Document': 1 argument required, but only 0 present.");
    }
    const result = JSON.parse(Deno.core.ops.op_private_state_query(
      "redemption", String(issuer), root));
    if (result.status !== "ok") throw _privateStateTokenError("hasRedemptionRecord", result.status);
    return !!result.value;
  }
  async hasStorageAccess() {
    const root = _documentPrivacyRoot(this, "hasStorageAccess");
    const result = JSON.parse(Deno.core.ops.op_has_storage_access(root));
    if (result.status === "invalid-state") {
      throw new DOMException(
        "hasStorageAccess: Cannot be used unless the document is fully active.",
        "InvalidStateError");
    }
    return !!result.value;
  }
  ariaNotify(message, _options = undefined) {
    _documentPrivacyRoot(this, 'ariaNotify');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'ariaNotify' on 'Document': 1 argument required, but only 0 present.");
    }
    String(message);
  }
  async browsingTopics(_options = undefined) {
    _documentPrivacyRoot(this, 'browsingTopics');
    return [];
  }
  async hasUnpartitionedCookieAccess() {
    const root = _documentPrivacyRoot(this, 'hasUnpartitionedCookieAccess');
    const result = JSON.parse(Deno.core.ops.op_has_storage_access(root));
    if (result.status === 'invalid-state') {
      throw new DOMException(
        'hasUnpartitionedCookieAccess: Cannot be used unless the document is fully active.',
        'InvalidStateError');
    }
    return !!result.value;
  }
  async requestStorageAccess() {
    const root = _documentPrivacyRoot(this, 'requestStorageAccess');
    const result = JSON.parse(Deno.core.ops.op_has_storage_access(root));
    if (result.status === 'invalid-state') {
      throw new DOMException(
        'requestStorageAccess: Cannot be used unless the document is fully active.',
        'InvalidStateError');
    }
    if (result.value) return;
    throw new DOMException('requestStorageAccess not allowed', 'NotAllowedError');
  }
  async requestStorageAccessFor(requestedOrigin) {
    _documentPrivacyRoot(this, 'requestStorageAccessFor');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'requestStorageAccessFor' on 'Document': 1 argument required, but only 0 present.");
    }
    let requested;
    try { requested = new URL(String(requestedOrigin), this.URL).origin; }
    catch (_error) { throw new DOMException('requestStorageAccessFor not allowed', 'NotAllowedError'); }
    // Read the Window's location rather than `this.location`: the latter is an
    // own accessor that page-init installs per realm, and this method must not
    // depend on that having run.
    if (requested === globalThis.location.origin) return;
    throw new DOMException('requestStorageAccessFor not allowed', 'NotAllowedError');
  }
  captureEvents() { _documentPrivacyRoot(this, 'captureEvents'); }
  releaseEvents() { _documentPrivacyRoot(this, 'releaseEvents'); }
  clear() { _documentPrivacyRoot(this, 'clear'); }
  exitPointerLock() { _documentPrivacyRoot(this, 'exitPointerLock'); }
  webkitCancelFullScreen() { _documentPrivacyRoot(this, 'webkitCancelFullScreen'); }
  webkitExitFullscreen() { _documentPrivacyRoot(this, 'webkitExitFullscreen'); }
  async exitFullscreen() {
    _documentPrivacyRoot(this, 'exitFullscreen');
    throw new TypeError(
      "Failed to execute 'exitFullscreen' on 'Document': Document not active");
  }
  async exitPictureInPicture() {
    _documentPrivacyRoot(this, 'exitPictureInPicture');
    throw new DOMException(
      "Failed to execute 'exitPictureInPicture' on 'Document': There is no Picture-in-Picture element in this document.",
      'InvalidStateError');
  }
  startViewTransition(update = undefined) {
    _documentPrivacyRoot(this, 'startViewTransition');
    let callback = update, types = [];
    if (update && typeof update === 'object') {
      callback = update.update;
      types = Array.isArray(update.types) ? update.types : [];
    }
    if (callback !== undefined && typeof callback !== 'function') {
      throw new TypeError(
        "Failed to execute 'startViewTransition' on 'Document': parameter 1 is not a function.");
    }
    const transition = new ViewTransition(_viewTransitionKey, this, callback, types);
    _activeViewTransitions.set(this, transition);
    transition.finished.finally(() => {
      if (_activeViewTransitions.get(this) === transition) {
        _activeViewTransitions.delete(this);
      }
    });
    return transition;
  }
  moveBefore(node, child) {
    _documentPrivacyRoot(this, 'moveBefore');
    if (arguments.length < 2) {
      throw new TypeError(
        "Failed to execute 'moveBefore' on 'Document': 2 arguments required, but only "
          + arguments.length + " present.");
    }
    if (!(node instanceof Node)) {
      throw new TypeError(
        "Failed to execute 'moveBefore' on 'Document': parameter 1 is not of type 'Node'.");
    }
    if (child !== null && (!(child instanceof Node) || child.parentNode !== this)) {
      throw new DOMException(
        "Failed to execute 'moveBefore' on 'Document': The node before which the new node is to be inserted is not a child of this node.",
        'NotFoundError');
    }
    if (node === child) return;
    this.insertBefore(node, child);
  }
  queryCommandEnabled(command) {
    const name = _queryCommandName(this, 'queryCommandEnabled', command, arguments.length);
    if (!_queryCommandSupportedNames.has(name)) return false;
    if (name === 'selectall' || name === 'stylewithcss') return true;
    return !!_queryCommandEditingHost(this) && _queryCommandEditableNames.has(name);
  }
  queryCommandIndeterm(command) {
    _queryCommandName(this, 'queryCommandIndeterm', command, arguments.length);
    return false;
  }
  queryCommandState(command) {
    const name = _queryCommandName(this, 'queryCommandState', command, arguments.length);
    return _queryCommandState(this, name);
  }
  queryCommandSupported(command) {
    const name = _queryCommandName(this, 'queryCommandSupported', command, arguments.length);
    return _queryCommandSupportedNames.has(name);
  }
  queryCommandValue(command) {
    const name = _queryCommandName(this, 'queryCommandValue', command, arguments.length);
    if (name === 'bold' || name === 'italic' || name === 'underline'
        || name === 'strikethrough' || name === 'subscript' || name === 'superscript') {
      return String(_queryCommandState(this, name));
    }
    return '';
  }
  // `location` is deliberately not declared here. It is [LegacyUnforgeable], so
  // Chrome exposes it as an own accessor of each document instance and
  // Document.prototype carries no `location` at all (page-init installs the
  // instance one, per realm). Declaring it in the class body put it on the
  // prototype as well, where an enumeration sees an extra name in the wrong
  // position.
  // The legacy color attributes: Chrome still carries all five on the document
  // and answers "" while they are unset, which is what a prototype enumeration
  // and a direct read both see. They are absent without this, and a missing
  // member is a louder tell than an empty one. The store is a closure rather
  // than a prototype helper, so nothing extra lands in the enumeration.
  get fgColor() { return _documentLegacyColor(this, 'fgColor'); }
  set fgColor(v) { _documentLegacyColor(this, 'fgColor', v); }
  get linkColor() { return _documentLegacyColor(this, 'linkColor'); }
  set linkColor(v) { _documentLegacyColor(this, 'linkColor', v); }
  get vlinkColor() { return _documentLegacyColor(this, 'vlinkColor'); }
  set vlinkColor(v) { _documentLegacyColor(this, 'vlinkColor', v); }
  get alinkColor() { return _documentLegacyColor(this, 'alinkColor'); }
  set alinkColor(v) { _documentLegacyColor(this, 'alinkColor', v); }
  get bgColor() { return _documentLegacyColor(this, 'bgColor'); }
  set bgColor(v) { _documentLegacyColor(this, 'bgColor', v); }
  // Scoped frame documents use the same Document prototype as the top-level
  // document. Resolve their WindowProxy through the internal slot so the
  // inherited member keeps Chrome's prototype enumeration position.
  get defaultView() { return this[_defaultViewProxySym] || globalThis; }
  get nodeType() { return 9; }
  get nodeName() { return "#document"; }
  get ownerDocument() { return null; } // Document has no ownerDocument
  get compatMode() {
    // The top document's parse mode comes from the DOM; about:blank and
    // doctypeless documents are BackCompat.
    try {
      const info = _domParse("document_scope_info", 0);
      if (info && info.quirks !== undefined) return info.quirks ? "BackCompat" : "CSS1Compat";
    } catch (_e) {}
    return "CSS1Compat";
  }
  get lastModified() {
    let stamp = this[_lastModifiedSym];
    if (!stamp) {
      let header = null;
      try {
        const root = typeof this[_scopeRootSym] === 'number'
          ? this[_scopeRootSym] : (this === globalThis.document ? 0 : null);
        if (root !== null) {
          header = _domParse('document_scope_info', root)?.lastModified || null;
        }
      } catch (_e) {}
      stamp = header ? new Date(header) : new Date();
      if (!Number.isFinite(stamp.getTime())) stamp = new Date();
      try { Object.defineProperty(this, _lastModifiedSym, { value: stamp, configurable: true }); }
      catch (_e) { this[_lastModifiedSym] = stamp; }
    }
    const p2 = n => String(n).padStart(2, '0');
    return `${p2(stamp.getMonth() + 1)}/${p2(stamp.getDate())}/${stamp.getFullYear()} `
      + `${p2(stamp.getHours())}:${p2(stamp.getMinutes())}:${p2(stamp.getSeconds())}`;
  }
  // The document's character encoding, detected from the response charset
  // (HTTP Content-Type -> <meta charset>). characterSet/charset/inputEncoding
  // are WHATWG aliases. A node-less document (DOMParser/createDocument) has no
  // backing encoding and reports UTF-8.
  get characterSet() { return (this[_nidSym] === undefined || this[_nidSym] === null) ? "UTF-8" : _docEncoding(); }
  get charset() { return this.characterSet; }
  get inputEncoding() { return this.characterSet; }
  get contentType() {
    // An explicit type set by DOMParser/createDocument wins.
    if (this._contentType) return this._contentType;
    // `new Document()` (the WHATWG constructor, no backing node id) creates an
    // XML document, so createCDATASection/etc. must not throw. Live documents
    // wrapped from the tree carry a real nid and fall through to URL-derived.
    if (this[_nidSym] === undefined || this[_nidSym] === null) return "application/xml";
    const url = this.URL || "";
    // data: URLs carry their MIME type explicitly.
    const dm = /^data:([^,;]+)/i.exec(url);
    if (dm) {
      const mime = dm[1].toLowerCase();
      if (mime === "application/xhtml+xml") return "application/xhtml+xml";
      if (mime === "text/xml") return "text/xml";
      if (mime === "application/xml" || mime.endsWith("+xml")) return "application/xml";
    }
    if (/\.xhtml(?:[?#]|$)/i.test(url)) return "application/xhtml+xml";
    if (/\.(?:xml|svg)(?:[?#]|$)/i.test(url)) return "application/xml";
    return "text/html";
  }
  get readyState() { return globalThis.__documentReadyState__ || 'complete'; }
  get currentScript() {
    // Next.js / Turbopack chunk loader reads document.currentScript.src to
    // derive its base path. page.rs sets __currentScriptNid before each
    // <script> body runs and clears it after, mirroring real Chrome.
    const nid = globalThis.__currentScriptNid;
    return nid ? _wrapEl(+nid) : null;
  }
  get hidden() { return false; }
  get visibilityState() { return "visible"; }
  get webkitVisibilityState() { return this.visibilityState; }
  get webkitHidden() { return this.hidden; }
  getElementById(id) {
    if (typeof this[_scopeRootSym] === 'number') {
      const sel = '[id="' + String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
      return _wrapEl(+_dom("query_selector_scoped", this[_scopeRootSym], sel));
    }
    if (_detachedDocumentBrand.has(this) && this._root) {
      const target = String(id);
      const stack = [this._root];
      while (stack.length) {
        const node = stack.pop();
        if (node && node.nodeType === 1 && node.getAttribute
            && node.getAttribute("id") === target) return node;
        const children = node && node.children ? Array.from(node.children) : [];
        for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
      }
      return null;
    }
    return _wrapEl(+_dom("get_element_by_id", id));
  }
  querySelector(s) {
    if (typeof this[_scopeRootSym] === 'number') {
      return _wrapEl(+_dom("query_selector_scoped", this[_scopeRootSym], s));
    }
    if (_detachedDocumentBrand.has(this) && this._root) return this._root.querySelector(s);
    return _wrapEl(+_dom("query_selector", s));
  }
  querySelectorAll(s) {
    if (typeof this[_scopeRootSym] === 'number') {
      const ids = _domParse("query_selector_all_scoped", this[_scopeRootSym], s) || [];
      return _nodeList(ids.map(_wrapEl).filter(Boolean));
    }
    if (_detachedDocumentBrand.has(this) && this._root) return this._root.querySelectorAll(s);
    const ids = _domParse("query_selector_all", s) || [];
    return _nodeList(ids.map(_wrapEl).filter(Boolean));
  }
  getElementsByTagName(t) { return _htmlCollectionFrom(_internalQuerySelectorAll(this, t)); }
  getElementsByClassName(c) { return _getElementsByClassName(this, c); }
  getElementsByName(name) {
    return _internalQuerySelectorAll(
      this, '[name="' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
  }
  evaluate(expression, contextNode, namespaceResolver, type, result) {
    return _makeXPathResult(type, _xpathFindNodes(expression, contextNode || this));
  }
  createExpression(expression, resolver = null) {
    _documentPrivacyRoot(this, 'createExpression');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'createExpression' on 'Document': 1 argument required, but only 0 present.");
    }
    return new XPathExpression(
      _xpathExpressionKey, this, String(expression), resolver);
  }
  createNSResolver(nodeResolver) {
    _documentPrivacyRoot(this, 'createNSResolver');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'createNSResolver' on 'Document': 1 argument required, but only 0 present.");
    }
    if (!(nodeResolver instanceof Node)) {
      throw new TypeError(
        "Failed to execute 'createNSResolver' on 'Document': parameter 1 is not of type 'Node'.");
    }
    return nodeResolver;
  }
  caretPositionFromPoint(x, y, _options = undefined) {
    _documentPrivacyRoot(this, 'caretPositionFromPoint');
    if (arguments.length < 2) {
      throw new TypeError(
        "Failed to execute 'caretPositionFromPoint' on 'Document': 2 arguments required, but only "
          + arguments.length + " present.");
    }
    return _caretPositionAt(this, x, y);
  }
  caretRangeFromPoint(x = 0, y = 0) {
    _documentPrivacyRoot(this, 'caretRangeFromPoint');
    const position = _caretPositionAt(this, x, y);
    const range = new Range();
    range.setStart(position.offsetNode, position.offset);
    range.setEnd(position.offsetNode, position.offset);
    return range;
  }
  createElement(t) {
    const localName = String(t).toLowerCase();
    const nid = +_dom("create_element", localName);
    const C = _elementClassForKnownName(
      "http://www.w3.org/1999/xhtml",
      localName,
    );
    const el = C === HTMLIFrameElement
      ? new C(nid, _iframeConstructionKey)
      : C === HTMLLinkElement
        ? new C(nid, _linkConstructionKey)
        : C === HTMLInputElement
          ? new C(nid, _inputConstructionKey)
        : new C(nid);
    // This node was just created from values already known to JS. Seed its
    // immutable metadata instead of rediscovering it through native calls in
    // hydration's tag/local-name checks.
    el._tagName = localName.toUpperCase();
    el._lname = localName;
    el._ns = "http://www.w3.org/1999/xhtml";
    el._nullNamespaceAttrs = new Map();
    _seedDetachedTreeState(el);
    // Creation knows its scope: stamp the owner-document root (scoped
    // documents carry _scopeRoot, the main document its own nid).
    el[_ownerDocRootSym] = this[_scopeRootSym] !== undefined ? this[_scopeRootSym] : this[_nidSym];
    _stampDetachedDocumentNode(this, el);
    _cache.set(nid, el);
    if (el && localName === 'template') {
      el._templateContent = this.createDocumentFragment();
      el._templateContent._fragmentContext = 'template';
    }
    const registry = this.customElementRegistry || globalThis.customElements;
    const definition = registry?.get(localName);
    if (el && definition) _customElementUpgrade(registry, el, definition);
    return el;
  }
  createElementNS(ns, t) {
    const namespace = ns == null ? null : String(ns);
    const qualified = String(t);
    _ns_validateQualifiedName(namespace == null ? "" : namespace, qualified);
    if (namespace === "http://www.w3.org/1999/xhtml") {
      const el = this.createElement(qualified);
      if (el) el._ns = namespace;
      return el;
    }
    const nid = +_dom(
      "create_element_ns",
      (namespace == null ? "" : namespace) + "\0" + qualified,
    );
    const effectiveNamespace = namespace == null ? "" : namespace;
    const C = _elementClassForKnownName(effectiveNamespace, qualified);
    const el = C === HTMLIFrameElement
      ? new C(nid, _iframeConstructionKey)
      : C === HTMLLinkElement
        ? new C(nid, _linkConstructionKey)
        : C === HTMLInputElement
          ? new C(nid, _inputConstructionKey)
        : new C(nid);
    const localName = qualified.includes(":")
      ? qualified.slice(qualified.indexOf(":") + 1)
      : qualified;
    el._tagName = qualified;
    el._lname = localName;
    el._ns = effectiveNamespace;
    el._nullNamespaceAttrs = new Map();
    _seedDetachedTreeState(el);
    el[_ownerDocRootSym] = this[_scopeRootSym] !== undefined ? this[_scopeRootSym] : this[_nidSym];
    _stampDetachedDocumentNode(this, el);
    _cache.set(nid, el);
    return el;
  }
  createTextNode(t) {
    const nid = +_dom("create_text_node", String(t));
    const n = new Text(nid);
    _seedDetachedTreeState(n);
    n[_ownerDocRootSym] = this[_scopeRootSym] !== undefined ? this[_scopeRootSym] : this[_nidSym];
    _stampDetachedDocumentNode(this, n);
    _cache.set(nid, n);
    return n;
  }
  createComment(t) {
    const nid = +_dom("create_comment_node", String(t ?? ""));
    const n = new Comment(nid);
    _seedDetachedTreeState(n);
    n[_ownerDocRootSym] = this[_scopeRootSym] !== undefined ? this[_scopeRootSym] : this[_nidSym];
    _stampDetachedDocumentNode(this, n);
    _cache.set(nid, n);
    return n;
  }
  createCDATASection(data) {
    // Spec: throw NotSupportedError on an HTML document, reject data
    // containing "]]>", then return a CDATASection node.
    if (!_isXMLDocument(this)) {
      throw new DOMException("createCDATASection is not supported in HTML documents", "NotSupportedError");
    }
    const str = String(data);
    if (str.indexOf("]]>") !== -1) {
      throw new DOMException("CDATA section data must not contain ']]>'", "InvalidCharacterError");
    }
    const nid = +_dom("create_text_node", str);
    const n = new CDATASection(nid);
    _seedDetachedTreeState(n);
    _stampDetachedDocumentNode(this, n);
    _cache.set(nid, n);
    return n;
  }
  createProcessingInstruction(target, data) {
    // Spec: not gated on document type. Reject targets that are not an XML
    // Name, then reject data containing "?>", then return a PI node.
    const tgt = String(target);
    const str = String(data);
    if (!_isValidPITarget(tgt)) {
      throw new DOMException("Invalid processing instruction target", "InvalidCharacterError");
    }
    if (str.indexOf("?>") !== -1) {
      throw new DOMException("Processing instruction data must not contain '?>'", "InvalidCharacterError");
    }
    const nid = +_dom("create_text_node", str);
    const n = new ProcessingInstruction(nid, tgt);
    _seedDetachedTreeState(n);
    _stampDetachedDocumentNode(this, n);
    _cache.set(nid, n);
    return n;
  }
  createDocumentFragment() {
    const nid = +_dom("create_document_fragment");
    const frag = new DocumentFragment(nid);
    _seedDetachedTreeState(frag);
    frag[_ownerDocRootSym] = this[_scopeRootSym] !== undefined ? this[_scopeRootSym] : this[_nidSym];
    _stampDetachedDocumentNode(this, frag);
    _cache.set(nid, frag);
    return frag;
  }
  // Legacy DOM Level 2 event factory. Spec returns an event of the requested
  // class with an empty type until init*Event() is called. We previously
  // returned a generic Event for every type, which broke libraries that call
  // createEvent('CustomEvent').initCustomEvent(...) — see issue #41.
  createEvent(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'promiserejectionevent') {
      throw new DOMException(
        "The provided event type ('PromiseRejectionEvent') is invalid",
        'NotSupportedError'
      );
    }
    const map = {
      'customevent': CustomEvent, 'customevents': CustomEvent,
      'mouseevent': MouseEvent,   'mouseevents': MouseEvent,
      'keyboardevent': KeyboardEvent, 'keyboardevents': KeyboardEvent,
      'focusevent': FocusEvent,
      'inputevent': InputEvent,
      'uievent': UIEvent, 'uievents': UIEvent,
      'compositionevent': CompositionEvent,
      'wheelevent': WheelEvent,
      'pointerevent': PointerEvent,
      'errorevent': ErrorEvent,
      'popstateevent': PopStateEvent,
      'animationevent': AnimationEvent,
      'transitionevent': TransitionEvent,
      'storageevent': StorageEvent,
    };
    const Cls = map[normalized] || Event;
    return new Cls('');
  }
  createRange() { return new Range(); }
  addEventListener(type, fn, opts) {
    _eventTargetAdd(this, type, fn, opts);
  }
  removeEventListener(type, fn, opts) {
    _eventTargetRemove(this, type, fn, opts);
  }
  dispatchEvent(event) {
    return _eventTargetDispatch(this, event);
  }
  createTreeWalker(root, whatToShow, filter) {
    // whatToShow is unsigned long; default SHOW_ALL only when the arg is omitted.
    // An explicit 0 (show nothing) must stay 0, not become SHOW_ALL.
    whatToShow = (whatToShow === undefined) ? 0xFFFFFFFF : (whatToShow >>> 0);
    return new TreeWalker(_treeWalkerKey, root, whatToShow, filter);
  }
  // A real NodeIterator (DOM 6.2), not a TreeWalker in disguise (issue #467).
  // The two differ in more than naming: an iterator's pointer starts *before*
  // its root, so the first nextNode() returns the root itself, and it exposes
  // referenceNode/pointerBeforeReferenceNode/detach rather than a TreeWalker's
  // currentNode and child/sibling movers.
  createNodeIterator(root, whatToShow, filter) {
    // whatToShow is unsigned long; default SHOW_ALL only when the arg is
    // omitted. An explicit 0 (show nothing) must stay 0, not become SHOW_ALL.
    whatToShow = (whatToShow === undefined) ? 0xFFFFFFFF : (whatToShow >>> 0);
    return new NodeIterator(_nodeIteratorKey, root, whatToShow, filter);
  }
  getSelection() { return this.defaultView ? _selectionFor(this) : null; }
  get activeElement() { return globalThis[_inputFocusedSym] || this.body; }
  // The element that scrolls the viewport, and where the page offset lives
  // (issue #468). Standards mode, so documentElement — quirks mode would be
  // body, but we never parse in quirks mode.
  get scrollingElement() { return this.documentElement; }
  get implementation() {
    const ownerDoc = this;
    return {
      // Spec: createHTMLDocument returns a NEW detached Document. jQuery
      // 3.x's selector feature-detect calls `body.innerHTML = '<form>'` on
      // the result — when we returned `globalThis.document`, the real
      // `<body>` was wiped, taking every page on the open web that ships
      // jQuery 3.x with it. DOMParser now builds the complete detached
      // document skeleton, so only the optional title needs adding here.
      createHTMLDocument(title) {
        const doc = new DOMParser().parseFromString("", "text/html");
        if (arguments.length > 0) {
          const titleEl = document.createElement("title");
          titleEl.textContent = String(title);
          doc.head.appendChild(titleEl);
        }
        return doc;
      },
      // Real spec: createDocument(namespaceURI, qualifiedName, doctype) →
      // an XML document with a root element of the given name. We don't
      // have a separate XML stack, so return a minimal detached document
      // with an element of the requested local name as documentElement.
      createDocument(_ns, qualifiedName, _doctype) {
        const name = (qualifiedName && String(qualifiedName)) || "root";
        const safe = name.replace(/[^a-zA-Z0-9-]/g, "");
        const html = qualifiedName ? `<${safe}></${safe}>` : "";
        const doc = new DOMParser().parseFromString(html, "application/xml");
        if (_doctype) doc._docType = _doctype;
        return doc;
      },
      // createDocumentType(qualifiedName, publicId, systemId): build a detached
      // DocumentType node. Browsers validate leniently here (only a name with
      // ASCII whitespace or ">" is rejected, matching the WPT cases); the node's
      // owner document is the document whose implementation was used.
      createDocumentType(qualifiedName, publicId, systemId) {
        const name = String(qualifiedName);
        if (name === "" || /[\t\n\f\r >]/.test(name)) {
          throw new DOMException("The qualified name '" + name + "' contains an invalid character", "InvalidCharacterError");
        }
        const dt = new DocumentType(
          +_dom("create_comment_node", ""),
          name,
          publicId === undefined ? "" : String(publicId),
          systemId === undefined ? "" : String(systemId)
        );
        dt._ownerDocument = ownerDoc;
        return dt;
      },
      hasFeature() { return true; },
    };
  }
  get styleSheets() {
    if (!this[_styleSheetListSym]) this[_styleSheetListSym] = new StyleSheetList(this);
    return this[_styleSheetListSym];
  }
  get forms() { return _documentCollection(this, 'forms', () => _internalQuerySelectorAll(this, 'form')); }
  get images() { return _documentCollection(this, 'images', () => _internalQuerySelectorAll(this, 'img')); }
  get links() { return _documentCollection(this, 'links', () => _internalQuerySelectorAll(this, 'a[href], area[href]')); }
  get scripts() { return _documentCollection(this, 'scripts', () => _internalQuerySelectorAll(this, 'script')); }
  get anchors() { return _documentCollection(this, 'anchors', () => _internalQuerySelectorAll(this, 'a[name]')); }
  get applets() { return _documentCollection(this, 'applets', () => _internalQuerySelectorAll(this, 'applet')); }
  get embeds() { return _documentCollection(this, 'embeds', () => _internalQuerySelectorAll(this, 'embed')); }
  get plugins() { return this.embeds; }
  get cookie() {
    const settings = _environmentSettings();
    if (settings.origin === "null") {
      throw new DOMException("The document is sandboxed and lacks an origin.", "SecurityError");
    }
    return Deno.core.ops.op_get_cookies_for_url(settings.cookieUrl);
  }
  set cookie(v) {
    if (!v) return;
    const settings = _environmentSettings();
    if (settings.origin === "null") {
      throw new DOMException("The document is sandboxed and lacks an origin.", "SecurityError");
    }
    Deno.core.ops.op_set_cookie_for_url(settings.cookieUrl, String(v));
  }
  write(...args) {
    var html = args.join('');
    if (!html) return;
    var body = this.body;
    if (!body) return;
    var temp = this.createDocumentFragment();
    _dom("set_fragment_html_executable", temp[_nidSym], _fragmentContextPayload('body', html));
    var children = Array.from(temp.childNodes);
    for (var i = 0; i < children.length; i++) {
      body.appendChild(children[i]);
    }
  }
  writeln(...args) {
    this.write(args.join('') + '\n');
  }
  open() {
    var body = this.body;
    if (body) body.innerHTML = '';
    return this;
  }
  close() {
    return;
  }
  hasFocus() { return true; }
  execCommand() { return false; }
}

// Node supplies these members for Document as well. Keep the document
