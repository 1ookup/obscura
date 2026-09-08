class Element extends Node {
  constructor(nid) {
    const entry = _customElementConstructionStack[_customElementConstructionStack.length - 1];
    const matchesUpgrade = entry && new.target === entry.constructor;
    const upgrading = matchesUpgrade && !entry.constructed ? entry.element : null;
    super(upgrading ? upgrading[_nidSym] : nid);
    if (matchesUpgrade && entry.constructed) {
      throw new TypeError("Custom element is already being constructed");
    }
    if (upgrading) {

      // Keep an already-constructed marker on the stack until the outer class
      // constructor returns. Recursive `new`/`super` calls for the same
      // definition must not steal the element currently being upgraded.
      entry.constructed = true;
      Object.setPrototypeOf(upgrading, new.target.prototype);
      return upgrading;
    }
    this._style = _styleProxy(new CSSStyleDeclaration(this));
  }
  // Element wrappers always back a nodeType-1 node (_wrap/_wrapEl only build an
  // Element for element nodes, and node ids are never freed-and-reused), so this
  // is constant. Overrides Node's dynamic getter to drop one op per nodeType read.
  get nodeType() { return 1; }
  get tagName() {
    // An element's qualified name is immutable for its lifetime. React reads
    // nodeName/tagName repeatedly while hydrating; crossing the native bridge
    // for every comparison adds thousands of calls on modern component trees.
    if (this._tagName !== undefined) return this._tagName;
    this._tagName = _domParse("tag_name", this[_nidSym]) || "";
    return this._tagName;
  }
  get nodeName() { return this.tagName; }
  get customElementRegistry() { return _customElementRegistryForNode(this); }
  get localName() {
    // The native tree owns the namespace-aware QualName. Reading its local
    // component directly preserves case-sensitive SVG/MathML names such as
    // `linearGradient`; deriving this from HTML's uppercased tagName loses it.
    if (this._lname !== undefined) return this._lname;
    const ln = _domParse("local_name", this[_nidSym])
      || (this.tagName || "").toLowerCase();
    if (ln) this._lname = ln;
    return ln;
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  // HTMLElement.nonce reflects the content attribute. Challenge scripts set
  // this IDL property before appending a dynamically-created script; without
  // the reflection the frame's CSP nonce gate rejects an otherwise authorized
  // script.
  get nonce() { return this.getAttribute("nonce") || ""; }
  set nonce(v) { this.setAttribute("nonce", v == null ? "" : String(v)); }
  get className() {
    // SVG elements reflect class as an SVGAnimatedString (.baseVal/.animVal),
    // not a plain string. Anti-fraud sensors read el.className.animVal.
    if (this.namespaceURI === "http://www.w3.org/2000/svg") {
      if (!this._svgClassName) this._svgClassName = new SVGAnimatedString(this, "class");
      return this._svgClassName;
    }
    return this.getAttribute("class") || "";
  }
  set className(v) { this.setAttribute("class", v); }
  get namespaceURI() {
    // createElementNS records the requested namespace on _ns; an empty string
    // maps to the null namespace per spec.
    if (this._ns !== undefined) return this._ns === "" ? null : this._ns;
    // Otherwise use the namespace the HTML tree builder assigned. Foreign
    // content puts the WHOLE <svg>/<math> subtree in that namespace, not just
    // the root, so deriving it from the tag name (the old `localName === "svg"`
    // check) left every descendant looking like HTML and skipped the SVG-only
    // reflections -- notably `get href()`, which then returned a plain string
    // instead of an SVGAnimatedString. An element's namespace never changes,
    // so cache it like _lname.
    if (this._nsCache !== undefined) return this._nsCache;
    let ns = _domParse("namespace_uri", this[_nidSym]) || "";
    // Nodes with no element name recorded fall back to the previous heuristic.
    if (!ns) ns = this.localName === "svg" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml";
    this._nsCache = ns;
    return ns;
  }
  // `inner_html` resolves a <template> to its contents document on the Rust
  // side (issue #463), so this needs no template special case.
  get innerHTML() { return _domParse("inner_html", this[_nidSym]) ?? ""; }
  set innerHTML(v) {
    v = globalThis.__obscura_tt_enforce('TrustedHTML', v, 'Element innerHTML');
    if (this.localName === 'template') {
      this.content.innerHTML = v;
      return;
    }
    // Capture the children that are about to be replaced so we can deliver
    // them as `removedNodes` in the MutationObserver record. Without this,
    // libraries that mutate via `innerHTML =` (jQuery's `.html(s)`, React
    // `dangerouslySetInnerHTML`, vue-style content swaps) silently bypass
    // every MutationObserver subscriber and downstream hydration / polling
    // logic stalls.
    const previousWindowNames = _windowNamedNamesInTree(this);
    // Native fragment replacement bypasses Node.removeChild. Disassociate
    // descendant style sheets before the backing nodes leave the document so
    // retained CSSStyleSheet wrappers cannot keep stale owner/source nodes.
    for (const style of _internalQuerySelectorAll(this, "style")) _detachStyleSheet(style);
    let oldChildren = [];
    let newChildren = [];
    if (globalThis.__mutationObservers?.length) {
      oldChildren = _domParse("child_nodes", this[_nidSym]) || [];
    }
    _dom("set_inner_html", this[_nidSym], String(v ?? ""));
    // HTML fragment parsing can introduce IDs without calling the JS
    // setAttribute path. Register those elements for Window named access
    // before script can synchronously read `window.someId`.
    _registerWindowNamedTree(this);
    _reconcileWindowNamedProperties(previousWindowNames);
    if (globalThis.__mutationObservers?.length) {
      newChildren = _domParse("child_nodes", this[_nidSym]) || [];
      globalThis.__notifyMutation('childList', this[_nidSym], newChildren, oldChildren);
    }
  }
  get outerHTML() { return _domParse("outer_html", this[_nidSym]) ?? ""; }
  // Assigning outerHTML replaces the element with the parsed markup. There was
  // only a getter, so in sloppy mode -- which page code usually is -- the
  // assignment did nothing at all and no error was raised: the element stayed
  // put, and the replacement a page then went looking for was never there.
  set outerHTML(v) {
    const parent = this.parentNode;
    if (!parent) {
      throw new DOMException(
        'This element has no parent node.', 'NoModificationAllowedError');
    }
    if (parent.nodeType === 9) {
      throw new DOMException(
        'This element has no parent node.', 'NoModificationAllowedError');
    }
    const markup = globalThis.__obscura_tt_enforce('TrustedHTML', v, 'Element outerHTML');
    // A DocumentFragment parent cannot be a parsing context, so the fragment is
    // parsed as if for <body>, per the spec's fragment parsing algorithm.
    const context = parent.nodeType === 1 ? parent : null;
    const replacements = _parseHTMLFragment(markup, context);
    const oldChildren = _domParse("child_nodes", parent[_nidSym]) || [];
    for (const node of replacements) parent.insertBefore(node, this);
    parent.removeChild(this);
    if (globalThis.__mutationObservers?.length) {
      globalThis.__notifyMutation(
        'childList', parent[_nidSym], _domParse("child_nodes", parent[_nidSym]) || [], oldChildren);
    }
  }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get children() {
    const ids = _domParse("element_children", this[_nidSym]) || [];
    return _htmlCollectionFrom(ids.map(_wrapEl).filter(Boolean));
  }
  get content() {
    // <template>.content is a DocumentFragment; <meta>.content reflects
    // the content attribute (read/write per spec). Next.js' next/head
    // iterates <meta> tags and sets .content during hydration, which
    // threw with the previous getter-only stub and put React into an
    // infinite retry loop (issue #210).
    const tag = this.localName;
    if (tag === 'template') {
      // Back the fragment with the node's real template contents (issue #463).
      // The parser stores template children in a separate contents document
      // instead of under the element, so without this the getter handed back a
      // fabricated empty fragment and the parsed markup was unreachable.
      // `template_contents` allocates one on demand for created templates.
      const nid = +_dom("template_contents", this[_nidSym]);
      if (nid >= 0) {
        // Cache by node id so `.content` keeps a stable identity across reads —
        // frameworks stash the fragment and compare it later.
        if (!_cache.has(nid)) _cache.set(nid, new DocumentFragment(nid));
        const content = _cache.get(nid);
        content._fragmentContext = 'template';
        return content;
      }
      if (!this._templateContent) {
        this._templateContent = document.createDocumentFragment();
        this._templateContent._fragmentContext = 'template';
      }
      return this._templateContent;
    }
    if (tag === 'meta') return this.getAttribute('content') || '';
    return undefined;
  }
  set content(v) {
    if (this.localName === 'meta') {
      this.setAttribute('content', v == null ? '' : String(v));
    }
  }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const ch = this.children; return ch[ch.length-1] || null; }
  get nextElementSibling() { let s = this.nextSibling; while(s && s.nodeType !== 1) s = s.nextSibling; return s; }
  get previousElementSibling() { let s = this.previousSibling; while(s && s.nodeType !== 1) s = s.previousSibling; return s; }
  get classList() {
    if (!this._classList) this._classList = new DOMTokenList(this, "class");
    return this._classList;
  }
  get relList() {
    const ns = this.namespaceURI, ln = this.localName;
    const ok = (ns === "http://www.w3.org/2000/svg" && ln === "a") ||
               (ns === "http://www.w3.org/1999/xhtml" && (ln === "a" || ln === "area" || ln === "link"));
    if (!ok) return undefined;
    // relList has supported tokens, so relList.supports(x) returns a boolean
    // rather than throwing. Vite's modulepreload polyfill runs
    // link.relList.supports('modulepreload') at the top of every bundle; a
    // throw there aborts the whole module and the SPA renders blank.
    if (!this._relList) this._relList = new DOMTokenList(this, "rel", ["alternate","dns-prefetch","icon","manifest","modulepreload","next","pingback","preconnect","prefetch","preload","prev","search","stylesheet"]);
    return this._relList;
  }
  get sandbox() {
    if (this.namespaceURI !== "http://www.w3.org/1999/xhtml" || this.localName !== "iframe") return undefined;
    if (!this._sandboxList) this._sandboxList = new DOMTokenList(this, "sandbox", ["allow-downloads","allow-forms","allow-modals","allow-orientation-lock","allow-pointer-lock","allow-popups","allow-popups-to-escape-sandbox","allow-presentation","allow-same-origin","allow-scripts","allow-top-navigation","allow-top-navigation-by-user-activation","allow-top-navigation-to-custom-protocols"]);
    return this._sandboxList;
  }
  get sizes() {
    if (this.namespaceURI !== "http://www.w3.org/1999/xhtml" || this.localName !== "link") return undefined;
    if (!this._sizesList) this._sizesList = new DOMTokenList(this, "sizes");
    return this._sizesList;
  }
  get htmlFor() {
    if (this.namespaceURI !== "http://www.w3.org/1999/xhtml") return undefined;
    const ln = this.localName;
    if (ln === "output") {
      if (!this._htmlForList) this._htmlForList = new DOMTokenList(this, "for");
      return this._htmlForList;
    }
    if (ln === "label") return this.getAttribute("for") || "";
    return undefined;
  }
  set htmlFor(v) {
    if (this.namespaceURI === "http://www.w3.org/1999/xhtml" && this.localName === "label") {
      this.setAttribute("for", String(v));
    }
  }
  get control() {
    if (this.localName !== 'label') return undefined;
    const root = this.getRootNode ? this.getRootNode() : document;
    const forId = this.getAttribute('for');
    const labelable = 'button,input,meter,output,progress,select,textarea';
    if (forId && root && root.getElementById) {
      const target = root.getElementById(forId);
      return target && target.matches && target.matches(labelable) && !target.matches('input[type=hidden]') ? target : null;
    }
    // Chrome resolves a label's control internally; issuing the query
    // through the public method puts this selector in any log the page keeps.
    return _internalQuerySelector(this, labelable);
  }
  get labels() {
    const labelable = 'button,input,meter,output,progress,select,textarea';
    if (!this.matches || !this.matches(labelable) || this.matches('input[type=hidden]')) return undefined;
    const root = this.getRootNode ? this.getRootNode() : document;
    const labels = root && root.querySelectorAll ? _internalQuerySelectorAll(root, 'label') : [];
    const result = [];
    for (const label of labels) {
      if (label.control === this || (!label.getAttribute('for') && label.contains && label.contains(this))) result.push(label);
    }
    return _nodeList(result);
  }
  get style() { return this._style; }
  set style(v) { if (typeof v === "string") this._style.cssText = v; }
  getAttribute(n) {
    n = _htmlAttrName(this, n);
    // Script-created elements start with a provably empty attribute set. Keep
    // that small null-namespace map coherent through the ordinary mutation
    // APIs so React's write-then-read reflection does not cross the bridge.
    if (this._nullNamespaceAttrs instanceof Map) {
      return this._nullNamespaceAttrs.has(n)
        ? this._nullNamespaceAttrs.get(n)
        : null;
    }
    return _domParse("get_attribute", this[_nidSym], n);
  }
  setAttribute(n, v) {
    n = _htmlAttrName(this, n);
    const popoverPrev = (n === "popover") ? this.popover : undefined;
    const previousWindowName = (n === "id" || n === "name")
      ? this.getAttribute(n)
      : null;
    const value = String(v);
    _dom("set_attribute", this[_nidSym], n + "\0" + value);
    if (this._nullNamespaceAttrs instanceof Map) {
      this._nullNamespaceAttrs.set(n, value);
    }
    if (n === "id" || (n === "name" && _windowNameEligibleElement(this))) {
      if (this.getRootNode() === globalThis.document) {
        _ensureWindowNamedProperty(value);
      }
      if (previousWindowName && previousWindowName !== value) {
        _reconcileWindowNamedProperty(previousWindowName);
      }
    }
    if (n === "style") _cssStyleReplaceFromAttribute(this._style, value);
    if (popoverPrev !== undefined) this._popoverTypeMaybeChanged(popoverPrev);
    if (this.localName === "iframe" && (n === "src" || n === "srcdoc")) {
      Deno.core.ops.op_queue_iframe_navigation(this[_nidSym]);
    }
    if (globalThis.__mutationObservers?.length) globalThis.__notifyMutation('attributes', this[_nidSym], [], [], n);
    if (this.localName === "source"
        && (n === "srcset" || n === "sizes" || n === "media" || n === "type")) {
      const picture = this.parentElement;
      const image = picture && picture.localName === "picture"
        ? picture.querySelector("img")
        : null;
      if (image && typeof image._imageSourceChanged === "function") {
        image._imageSourceChanged();
      }
    }
  }
  setAttributeNS(ns, n, v) {
    ns = ns == null || ns === '' ? '' : String(ns);
    n = String(n);
    const value = String(v);
    _ns_validateQualifiedName(ns, n);
    _dom("set_attribute_ns", this[_nidSym], ns + "\0" + n + "\0" + value);
    // Namespace-aware writes can replace an attribute by namespace/local name
    // while changing its qualified name. Fall back to native reads afterwards
    // instead of maintaining a second, subtly different key space here.
    this._nullNamespaceAttrs = null;
    if (ns === "" && n === "style") _cssStyleReplaceFromAttribute(this._style, value);
  }
  removeAttribute(n) {
    n = _htmlAttrName(this, n);
    const popoverPrev = (n === "popover") ? this.popover : undefined;
    const previousWindowName = (n === "id" || n === "name")
      ? this.getAttribute(n)
      : null;
    _dom("remove_attribute", this[_nidSym], n);
    if (this._nullNamespaceAttrs instanceof Map) {
      this._nullNamespaceAttrs.delete(n);
    }
    if (previousWindowName
        && (n === "id" || (n === "name" && _windowNameEligibleElement(this)))) {
      _reconcileWindowNamedProperty(previousWindowName);
    }
    if (n === "style") _cssStyleReplaceFromAttribute(this._style, "");
    if (popoverPrev !== undefined) this._popoverTypeMaybeChanged(popoverPrev);
    if (this.localName === "iframe" && (n === "src" || n === "srcdoc")) {
      Deno.core.ops.op_queue_iframe_navigation(this[_nidSym]);
    }
    if (this.localName === "source"
        && (n === "srcset" || n === "sizes" || n === "media" || n === "type")) {
      const picture = this.parentElement;
      const image = picture && picture.localName === "picture"
        ? picture.querySelector("img")
        : null;
      if (image && typeof image._imageSourceChanged === "function") {
        image._imageSourceChanged();
      }
    }
  }
  removeAttributeNS(ns, n) {
    ns = String(ns == null ? "" : ns);
    n = String(n);
    _dom("remove_attribute_ns", this[_nidSym], ns + "\0" + n);
    this._nullNamespaceAttrs = null;
    if (ns === "" && n === "style") _cssStyleReplaceFromAttribute(this._style, "");
  }
  hasAttribute(n) { return this.getAttribute(n) !== null; }
  hasAttributes() { return this.attributes.length > 0; }
  getAttributeNames() { return _domParse("attribute_names", this[_nidSym]) || []; }
  get attributes() {
    if (!this._attributes) this._attributes = new NamedNodeMap(this);
    return this._attributes;
  }
  getAttributeNS(ns, n) { return _domParse("get_attribute_ns", this[_nidSym], String(ns == null ? "" : ns) + "\0" + String(n)); }
  querySelector(s) { return _wrapEl(+_dom("query_selector_scoped", this[_nidSym], s)); }
  querySelectorAll(s) {
    const ids = _domParse("query_selector_all_scoped", this[_nidSym], s) || [];
    return _nodeList(ids.map(_wrapEl).filter(Boolean));
  }
  getElementsByTagName(t) { return _htmlCollectionFrom(_internalQuerySelectorAll(this, t)); }
  getElementsByClassName(c) { return _getElementsByClassName(this, c); }
  matches(s) {
    // :popover-open is a JS-observable popover state, not understood by the
    // native selector engine. Handle it here (and strip it from compound
    // selectors so the rest can still be matched natively).
    if (typeof s === "string" && s.indexOf(":popover-open") !== -1) {
      if (this._popoverState !== "showing") return false;
      const rest = s.replace(/:popover-open/g, "").trim();
      if (rest === "") return true;
      return this.matches(rest);
    }
    // :modal is a JS-observable dialog state (a dialog opened via showModal()),
    // not understood by the native selector engine; handle it like :popover-open.
    if (typeof s === "string" && s.indexOf(":modal") !== -1) {
      if (this._dialogModal !== true) return false;
      const rest = s.replace(/:modal/g, "").trim();
      if (rest === "") return true;
      return this.matches(rest);
    }
    return _dom("matches_selector", this[_nidSym], String(s)) === "true";
  }
  closest(s) {
    let el = this;
    while (el) {
      if (el.nodeType === 1 && el.matches && el.matches(s)) return el;
      el = el.parentNode;
    }
    return null;
  }
  insertAdjacentHTML(position, html) {
    // Position is matched ASCII-case-insensitively; an unknown value throws
    // SyntaxError (both were silent no-ops before). Sibling insertions parse
    // against the parent's context, child insertions against this element, so
    // table/select fragments keep the right parsing context (_parseHTMLFragment).
    html = globalThis.__obscura_tt_enforce(
      'TrustedHTML', html, 'Element insertAdjacentHTML');
    const pos = String(position).toLowerCase();
    const parent = this.parentNode;
    const context = (pos === 'beforebegin' || pos === 'afterend') ? parent : this;
    switch (pos) {
      case 'beforebegin':
        if (parent) for (const n of _parseHTMLFragment(html, context)) parent.insertBefore(n, this);
        break;
      case 'afterbegin': {
        const first = this.firstChild;
        for (const n of _parseHTMLFragment(html, context)) this.insertBefore(n, first);
        break;
      }
      case 'beforeend':
        for (const n of _parseHTMLFragment(html, context)) this.appendChild(n);
        break;
      case 'afterend':
        if (parent) { const next = this.nextSibling; for (const n of _parseHTMLFragment(html, context)) parent.insertBefore(n, next); }
        break;
      default:
        throw new DOMException(
          "Failed to execute 'insertAdjacentHTML' on 'Element': The value provided ('" + position + "') is not one of 'beforeBegin', 'afterBegin', 'beforeEnd', or 'afterEnd'.",
          "SyntaxError"
        );
    }
  }
  // Like insertAdjacentHTML but inserts a Text node instead of parsing markup,
  // so the content stays literal.
  insertAdjacentText(position, text) {
    const parent = this.parentNode;
    const node = document.createTextNode(String(text));
    switch (String(position).toLowerCase()) {
      case 'beforebegin':
        if (parent) parent.insertBefore(node, this);
        break;
      case 'afterbegin':
        this.insertBefore(node, this.firstChild);
        break;
      case 'beforeend':
        this.appendChild(node);
        break;
      case 'afterend':
        if (parent) parent.insertBefore(node, this.nextSibling);
        break;
    }
  }
  // Returns the inserted element, or null for beforebegin/afterend when this
  // element has no parent.
  insertAdjacentElement(position, element) {
    const parent = this.parentNode;
    switch (String(position).toLowerCase()) {
      case 'beforebegin':
        if (!parent) return null;
        parent.insertBefore(element, this);
        return element;
      case 'afterbegin':
        this.insertBefore(element, this.firstChild);
        return element;
      case 'beforeend':
        this.appendChild(element);
        return element;
      case 'afterend':
        if (!parent) return null;
        parent.insertBefore(element, this.nextSibling);
        return element;
    }
    return null;
  }
  addEventListener(type, handler, opts) {
    _eventTargetAdd(this, type, handler, opts);
  }
  removeEventListener(type, handler, opts) {
    _eventTargetRemove(this, type, handler, opts);
  }
  dispatchEvent(event) {
    return _eventTargetDispatch(this, event);
  }
  _resolveInlineHandler(name) {
    // name = 'onclick' / 'onsubmit' / etc. Compile the content attribute
    // as a function body on first read and cache it on the instance.
    const cache = this.__inlineHandlerCache || (this.__inlineHandlerCache = {});
    if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
    const src = this.getAttribute && this.getAttribute(name);
    if (!src) { cache[name] = null; return null; }
    if (!_inlineEventHandlerCspAllows()) { cache[name] = null; return null; }
    try {
      cache[name] = new Function('event', src);
    } catch (e) {
      cache[name] = null;
    }
    return cache[name];
  }
  click() {
    // HTMLElement.click() performs no dispatch or activation for a disabled
    // form control. In particular, the checkbox/radio pre-click action below
    // must not transiently change checkedness before returning.
    if (this.matches && this.matches(':disabled')) return;
    const type = (this.getAttribute && this.getAttribute('type') || '').toLowerCase();
    const checkable = this.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio');
    const oldChecked = checkable ? !!this.checked : false;
    let radioStates = null;
    // Checkbox/radio activation is the legacy pre-click action: listeners see
    // the new state, while cancellation restores the state that preceded it.
    if (checkable && type === 'radio') {
      const radioName = this.getAttribute('name') || '';
      if (radioName) {
        const root = this.getRootNode();
        const candidates = root && root.querySelectorAll ? root.querySelectorAll('input') : [];
        radioStates = [];
        for (let i = 0; i < candidates.length; i++) {
          const radio = candidates[i];
          if ((radio.getAttribute('type') || '').toLowerCase() !== 'radio'
              || (radio.getAttribute('name') || '') !== radioName
              || radio.form !== this.form) continue;
          radioStates.push([radio, !!radio.checked]);
          if (radio !== this) radio.checked = false;
        }
      }
      this.checked = true;
    } else if (checkable) {
      this.checked = !oldChecked;
    }
    const cancelled = !this.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
    if (cancelled && radioStates) {
      for (const [radio, checked] of radioStates) radio.checked = checked;
    } else if (cancelled && checkable) {
      this.checked = oldChecked;
    }
    if (!cancelled) {
      // Label activation is a second, trusted click on the labeled control.
      // Keep it in the element activation path so HTMLElement.click(), CDP,
      // and user-like input share identical behavior.
      if (this.localName === 'label' && this.control && this.control !== this) {
        this.control.click();
        return;
      }
      const link = this.tagName === 'A' ? this : (this.closest ? this.closest('a[href]') : null);
      if (link) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          location.assign(href);
          return;
        }
      }
      // Same predicate requestSubmit validates against, so an internal click
      // can never hand it a submitter it would reject. Also matches the CDP
      // click path in input.rs, which already treats <input type=image> as a
      // submit button.
      if (_isSubmitButton(this)) {
        const form = this.closest ? this.closest('form') : null;
        // A real submit-button click fires the cancelable submit event, so use
        // requestSubmit() (not the plain submit() method, which now bypasses it).
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit(this);
        } else if (form && typeof form.submit === 'function') {
          form.submit(this);
        }
      }
      if (checkable && this.checked !== oldChecked) {
        this.dispatchEvent(new Event('input', {bubbles: true}));
        this.dispatchEvent(new Event('change', {bubbles: true}));
      }
    }
  }
  focus() {
    if (globalThis[_inputFocusedSym] === this) return;
    const previous = globalThis[_inputFocusedSym];
    if (previous && previous !== this && typeof previous.blur === 'function') previous.blur();
    globalThis[_inputFocusedSym] = this;
    globalThis[_inputClickTargetSym] = this;
    try {
      this.dispatchEvent(__obscura_markTrusted(new FocusEvent('focus', {
        bubbles: false, cancelable: false, composed: true, view: globalThis,
      })));
    } catch (_error) {}
  }
  blur() {
    if (globalThis[_inputFocusedSym] !== this) return;
    globalThis[_inputFocusedSym] = null;
    try {
      this.dispatchEvent(__obscura_markTrusted(new FocusEvent('blur', {
        bubbles: false, cancelable: false, composed: true, view: globalThis,
      })));
    } catch (_error) {}
  }

  // --- Popover API (HTML "popover") ---------------------------------------
  // Read the popover content attribute case-insensitively. The HTML parser
  // lowercases attribute names, but runtime setAttribute("PoPoVeR", ...)
  // preserves case, and the IDL reflection matches the name ASCII-case-
  // insensitively. Returns the raw stored string, or null if absent.
  _popoverAttrValue() {
    const v = this.getAttribute("popover");
    if (v !== null) return v;
    const names = _domParse("attribute_names", this[_nidSym]) || [];
    for (let i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === "popover") return this.getAttribute(names[i]);
    }
    return null;
  }
  // The reflected (effective) popover type: null (No Popover), "auto",
  // "hint", or "manual". Empty string maps to "auto"; any non-keyword value
  // (invalid) maps to "manual".
  get popover() {
    const raw = this._popoverAttrValue();
    if (raw === null) return null;
    const v = String(raw).toLowerCase();
    if (v === "auto" || v === "hint" || v === "manual") return v;
    if (v === "") return "auto";
    return "manual";
  }
  set popover(value) {
    if (value === null || value === undefined) { this._popoverRemoveAttr(); return; }
    this.setAttribute("popover", String(value));
  }
  _popoverRemoveAttr() {
    if (this.getAttribute("popover") !== null) { this.removeAttribute("popover"); return; }
    const names = _domParse("attribute_names", this[_nidSym]) || [];
    for (let i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === "popover") { this.removeAttribute(names[i]); return; }
    }
  }
  // "check popover validity". expectedToBeShowing is true for hide, false for
  // show. Throws NotSupportedError when there is no valid popover type, and
  // InvalidStateError when the element is not connected; returns false (no
  // throw) when the current state does not match expectedToBeShowing.
  _checkPopoverValidity(expectedToBeShowing) {
    if (this.popover === null) throw new DOMException("Not supported on elements that don't have a valid value for the popover attribute", "NotSupportedError");
    const showing = this._popoverState === "showing";
    if ((expectedToBeShowing && !showing) || (!expectedToBeShowing && showing)) return false;
    if (!this.isConnected) throw new DOMException("Invalid on popover elements which aren't connected", "InvalidStateError");
    return true;
  }
  showPopover() {
    if (!this._checkPopoverValidity(/*expectedToBeShowing*/false)) return;
    const beforeEvent = new ToggleEvent("beforetoggle", { cancelable: true, oldState: "closed", newState: "open" });
    if (!this.dispatchEvent(beforeEvent)) return;
    // The beforetoggle handler may have changed our type or shown us; re-check.
    if (!this._checkPopoverValidity(/*expectedToBeShowing*/false)) return;
    this._popoverState = "showing";
    const target = this;
    setTimeout(() => { try { target.dispatchEvent(new ToggleEvent("toggle", { oldState: "closed", newState: "open" })); } catch (e) {} }, 0);
  }
  hidePopover() {
    if (!this._checkPopoverValidity(/*expectedToBeShowing*/true)) return;
    this.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
    this._popoverState = "hidden";
    const target = this;
    setTimeout(() => { try { target.dispatchEvent(new ToggleEvent("toggle", { oldState: "open", newState: "closed" })); } catch (e) {} }, 0);
  }
  togglePopover(force) {
    let options = force;
    if (options && typeof options === "object") force = options.force;
    const showing = this._popoverState === "showing";
    if (showing && (force === undefined || force === null || force === false)) {
      this.hidePopover();
    } else if (force === undefined || force === null || force === true) {
      this.showPopover();
    }
    return this._popoverState === "showing";
  }
  // Called from setAttribute/removeAttribute/IDL setter when the popover
  // attribute may have changed. If the effective type changed while showing,
  // hide the popover (firing the hide events) per the HTML spec.
  _popoverTypeMaybeChanged(prevType) {
    const newType = this.popover;
    if (this._popoverState === "showing" && prevType !== newType) {
      // Hide directly. Do not call hidePopover(): it re-validates against the
      // popover attribute, which may now be removed (No Popover), and would
      // throw NotSupportedError. This mirrors the spec hide with throw=false.
      this.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
      this._popoverState = "hidden";
      const target = this;
      setTimeout(() => { try { target.dispatchEvent(new ToggleEvent("toggle", { oldState: "open", newState: "closed" })); } catch (e) {} }, 0);
    }
  }
  // HTMLDialogElement members (live on Element.prototype like popover/input;
  // meaningful only when localName === 'dialog'). Modal top-layer/focus/render
  // is layout (out of scope); the open state, returnValue, and beforetoggle/
  // toggle/close/cancel events are JS-observable and implemented here.
  get open() { return this.hasAttribute('open'); }
  set open(v) { if (v) { if (!this.hasAttribute('open')) this.setAttribute('open', ''); } else if (this.hasAttribute('open')) { this.removeAttribute('open'); this._dialogModal = false; } }
  get returnValue() { return this._returnValue != null ? this._returnValue : ''; }
  set returnValue(v) { this._returnValue = String(v); }
  get oncancel() { return this._oncancel || null; }
  set oncancel(f) { this._oncancel = typeof f === 'function' ? f : null; }
  get onclose() { return this._onclose || null; }
  set onclose(f) { this._onclose = typeof f === 'function' ? f : null; }
  get closedBy() { const v = (this.getAttribute('closedby') || '').toLowerCase(); return (v === 'any' || v === 'closerequest' || v === 'none') ? v : 'auto'; }
  set closedBy(v) { this.setAttribute('closedby', String(v)); }
  show() {
    if (this.hasAttribute('open')) { if (this._dialogModal) throw new DOMException("The dialog is already open as a modal dialog.", "InvalidStateError"); return; }
    const before = new ToggleEvent("beforetoggle", { cancelable: true, oldState: "closed", newState: "open" });
    if (!this.dispatchEvent(before)) return;
    if (this.hasAttribute('open')) return;
    this.setAttribute('open', ''); this._dialogModal = false;
    const self = this; setTimeout(() => { try { self.dispatchEvent(new ToggleEvent("toggle", { oldState: "closed", newState: "open" })); } catch (e) {} }, 0);
  }
  showModal() {
    if (this.hasAttribute('open')) throw new DOMException("The dialog is already open.", "InvalidStateError");
    if (!this.isConnected) throw new DOMException("The dialog is not connected to a document.", "InvalidStateError");
    const before = new ToggleEvent("beforetoggle", { cancelable: true, oldState: "closed", newState: "open" });
    if (!this.dispatchEvent(before)) return;
    if (this.hasAttribute('open')) return;
    this.setAttribute('open', ''); this._dialogModal = true;
    const self = this; setTimeout(() => { try { self.dispatchEvent(new ToggleEvent("toggle", { oldState: "closed", newState: "open" })); } catch (e) {} }, 0);
  }
  _dialogClose(result, fireClose) {
    if (!this.hasAttribute('open')) return;
    this.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
    this.removeAttribute('open'); this._dialogModal = false;
    if (result !== undefined) this._returnValue = String(result);
    const self = this;
    setTimeout(() => { try { self.dispatchEvent(new ToggleEvent("toggle", { oldState: "open", newState: "closed" })); } catch (e) {} }, 0);
    if (fireClose) setTimeout(() => { try { self.dispatchEvent(new Event('close', { bubbles: false, cancelable: false })); } catch (e) {} }, 0);
  }
  close(result) { this._dialogClose(result, true); }
  requestClose(result) {
    if (!this.hasAttribute('open')) return;
    if (this._dialogCancelFiring) return; // no re-entrant cancel
    this._dialogCancelFiring = true;
    let canceled = false;
    try { const ev = new Event('cancel', { bubbles: false, cancelable: true }); this.dispatchEvent(ev); canceled = ev.defaultPrevented; }
    finally { this._dialogCancelFiring = false; }
    if (canceled) return;
    this._dialogClose(result, true);
  }
  attachInternals() {
    const registry = _customElementRegistryForNode(this);
    if (!registry || !registry.get(this.localName)) throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to non-custom elements.", "NotSupportedError");
    if (this.getAttribute('is')) throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to a customized built-in element.", "NotSupportedError");
    if (this._internalsAttached) throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': ElementInternals for the specified element was already attached.", "NotSupportedError");
    this._internalsAttached = true;
    return new ElementInternals(this);
  }
  get value() {
    const tag = this.localName;
    if (tag === 'select') {
      // Selected option wins; otherwise first option (HTML default).
      const opts = this.querySelectorAll('option');
      for (let i = 0; i < opts.length; i++) {
        if (opts[i].selected) {
          return opts[i].getAttribute('value') !== null ? opts[i].getAttribute('value') : opts[i].textContent;
        }
      }
      if (opts.length) return opts[0].getAttribute('value') !== null ? opts[0].getAttribute('value') : opts[0].textContent;
      return '';
    }
    if (_formValues[this[_nidSym]] !== undefined) return _formValues[this[_nidSym]];
    if (tag === 'textarea') return this.textContent;
    if (tag === 'option') {
      const attr = this.getAttribute('value');
      return attr !== null ? attr : this.textContent;
    }
    if (tag === 'input') {
      const itype = (this.getAttribute('type') || '').toLowerCase();
      if (itype === 'checkbox' || itype === 'radio') {
        // A checkbox/radio with no value attribute defaults to "on" in a real
        // browser, not the empty string.
        const attr = this.getAttribute('value');
        return attr !== null ? attr : 'on';
      }
      if (itype === 'file') {
        // Chrome exposes a file input's value as C:\fakepath\<first filename>.
        return (this._files && this._files.length) ? ('C:\\fakepath\\' + this._files[0].name) : '';
      }
    }
    return this.getAttribute("value") || "";
  }
  // FileList for <input type=file>, populated by DOM.setFileInputFiles (Puppeteer
  // uploadFile / Playwright setInputFiles). null for non-file inputs, matching
  // the DOM. See __obscura_setInputFiles (issue #359).
  get files() {
    if (this.localName !== 'input') return undefined;
    if ((this.getAttribute('type') || '').toLowerCase() !== 'file') return null;
    return this._files || _emptyFileList();
  }
  set value(v) {
    const tag = this.localName;
    if (tag === 'option') {
      this.setAttribute('value', String(v));
      return;
    }
    if (tag === 'select') {
      // Set selected on matching option, clear on others. Puppeteer's
      // page.select(selector, value) round-trips through this setter.
      const wanted = String(v);
      const opts = this.querySelectorAll('option');
      let matched = false;
      for (let i = 0; i < opts.length; i++) {
        const attrV = opts[i].getAttribute('value');
        const optVal = attrV !== null ? attrV : opts[i].textContent;
        if (optVal === wanted) { opts[i].selected = true; matched = true; }
        else { opts[i].selected = false; }
      }
      if (matched) try { this.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      return;
    }
    _formValues[this[_nidSym]] = String(v);
    if (tag === 'textarea') {
      this.textContent = String(v);
    }
  }
  get min() { return this.getAttribute('min') || ''; }
  set min(v) { this.setAttribute('min', v); }
  get max() { return this.getAttribute('max') || ''; }
  set max(v) { this.setAttribute('max', v); }
  get step() { return this.getAttribute('step') || ''; }
  set step(v) { this.setAttribute('step', v); }
  _inputType() { return this.localName === 'input' ? (this.getAttribute('type') || 'text').toLowerCase() : ''; }
  get valueAsNumber() {
    const t = this._inputType();
    if (!_INPUT_NUM_TYPES[t]) return NaN;
    if (t === 'range') {
      let minN = _inputParseNumber('range', this.getAttribute('min')); if (isNaN(minN)) minN = 0;
      let maxN = _inputParseNumber('range', this.getAttribute('max')); if (isNaN(maxN)) maxN = 100;
      if (maxN < minN) maxN = minN;
      const v = _inputParseNumber('range', this.value);
      let n = isNaN(v) ? (minN + (maxN - minN) / 2) : v;
      if (n < minN) n = minN; if (n > maxN) n = maxN;
      return n;
    }
    return _inputParseNumber(t, this.value);
  }
  set valueAsNumber(n) {
    const t = this._inputType();
    if (!_INPUT_NUM_TYPES[t]) throw new DOMException("Failed to set the 'valueAsNumber' property on 'HTMLInputElement': This input element does not support Number values.", 'InvalidStateError');
    n = Number(n);
    if (isNaN(n)) { this.value = ''; return; }
    if (!isFinite(n)) throw new TypeError("Failed to set the 'valueAsNumber' property on 'HTMLInputElement': The value provided is infinite.");
    this.value = _inputFormatNumber(t, n);
  }
  get valueAsDate() {
    const t = this._inputType();
    if (!_INPUT_DATE_TYPES[t]) return null;
    const n = _inputParseNumber(t, this.value);
    if (isNaN(n)) return null;
    if (t === 'month') { const y = 1970 + Math.floor(n / 12); const mo = ((n % 12) + 12) % 12; return new Date(Date.UTC(y, mo, 1)); }
    return new Date(n);
  }
  set valueAsDate(d) {
    const t = this._inputType();
    if (!_INPUT_DATE_TYPES[t]) throw new DOMException("Failed to set the 'valueAsDate' property on 'HTMLInputElement': This input element does not support Date values.", 'InvalidStateError');
    if (d === null) { this.value = ''; return; }
    if (!(d instanceof Date)) throw new TypeError("Failed to set the 'valueAsDate' property on 'HTMLInputElement': The provided value is not a Date.");
    const ms = d.getTime();
    if (isNaN(ms)) { this.value = ''; return; }
    if (t === 'month') { this.value = _inputFormatNumber('month', (d.getUTCFullYear() - 1970) * 12 + d.getUTCMonth()); return; }
    this.value = _inputFormatNumber(t, ms);
  }
  stepUp(n) { this._stepBy(n === undefined ? 1 : (n | 0)); }
  stepDown(n) { this._stepBy(-(n === undefined ? 1 : (n | 0))); }
  _stepBy(delta) {
    const t = this._inputType();
    const stepAttr = this.getAttribute('step');
    if (!_INPUT_STEP_SCALE[t] || (stepAttr && stepAttr.trim().toLowerCase() === 'any')) {
      throw new DOMException("Failed to execute 'stepUp' on 'HTMLInputElement': This form element does not have allowed value steps.", 'InvalidStateError');
    }
    const scale = _INPUT_STEP_SCALE[t];
    let stepN = _INPUT_STEP_DEFAULT[t];
    if (stepAttr) { const s = Number(stepAttr); if (isFinite(s) && s > 0) stepN = s; }
    const allowed = stepN * scale;
    const minN = _inputParseNumber(t, this.getAttribute('min'));
    const maxN = _inputParseNumber(t, this.getAttribute('max'));
    const stepBase = isNaN(minN) ? 0 : minN;
    let value = this.valueAsNumber;
    if (isNaN(value)) value = isNaN(minN) ? 0 : minN;
    value += delta * allowed;
    value = stepBase + Math.round((value - stepBase) / allowed) * allowed;
    const effMin = (t === 'range' && isNaN(minN)) ? 0 : minN;
    const effMax = (t === 'range' && isNaN(maxN)) ? 100 : maxN;
    if (!isNaN(effMin) && value < effMin) value = effMin;
    if (!isNaN(effMax) && value > effMax) value = effMax;
    this.value = _inputFormatNumber(t, value);
  }
  get checked() {
    return _dom("live_checked", this[_nidSym], "") === "true";
  }
  set checked(v) {
    const checked = !!v;
    if (checked && this.localName === 'input'
        && (this.getAttribute('type') || '').toLowerCase() === 'radio') {
      const name = this.getAttribute('name') || '';
      if (name) {
        const root = this.getRootNode();
        const candidates = root && root.querySelectorAll ? root.querySelectorAll('input') : [];
        for (let i = 0; i < candidates.length; i++) {
          const radio = candidates[i];
          if (radio !== this
              && (radio.getAttribute('type') || '').toLowerCase() === 'radio'
              && (radio.getAttribute('name') || '') === name
              && radio.form === this.form) {
            _dom("set_live_checked", radio[_nidSym], "false");
          }
        }
      }
    }
    _dom("set_live_checked", this[_nidSym], checked ? "true" : "false");
  }
  get selected() {
    if (this._selected !== undefined) return this._selected;
    return this.hasAttribute("selected");
  }
  set selected(v) {
    this._selected = !!v;
    // Keep the native DOM tree in sync so layout/paint observes live form
    // state after scripts construct or change an option.
    if (this.localName === 'option') {
      if (this._selected) this.setAttribute('selected', '');
      else this.removeAttribute('selected');
    }
  }
  get text() {
    if (['option', 'script', 'title', 'a'].includes(this.localName)) {
      return this.textContent;
    }
    return undefined;
  }
  set text(v) {
    if (['option', 'script', 'title', 'a'].includes(this.localName)) {
      // A script's text is a Trusted Types sink, but this delegates to
      // textContent, which is one too. Enforcing here as well would run the
      // policy twice for a single assignment, where Chrome runs it once, so
      // leave it to textContent. The value must not be stringified on the way
      // through or an already-branded TrustedScript would lose its brand and
      // be converted a second time.
      this.textContent = this.localName === 'script' ? v : String(v);
      return;
    }
    // Most elements have no platform `text` reflector. Preserve ordinary
    // expando semantics for them even though all HTML element interfaces
    // currently share this prototype.
    Object.defineProperty(this, 'text', {
      value: v,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get type() { return this.getAttribute("type") || (this.localName === "input" ? "text" : ""); }
  set type(v) { this.setAttribute("type", v); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get placeholder() { return this.getAttribute("placeholder") || ""; }
  set placeholder(v) { this.setAttribute("placeholder", v); }
  // For <a>/<area>, href returns the resolved absolute URL (the spec behavior,
  // and what scrapers want). It uses op_url_resolve, which returns just the
  // resolved string, rather than the full-component op the decomposition
  // members use. Other elements reflect the raw attribute.
  get href() {
    const ln = this.localName;
    // SVG href-bearing elements reflect href as an SVGAnimatedString (with the
    // legacy xlink:href as a fallback), not a resolved URL string. Checked
    // before the HTML <a> path because an SVG <a> also has localName 'a'.
    if (this.namespaceURI === "http://www.w3.org/2000/svg" &&
        (ln === 'a' || ln === 'image' || ln === 'use' || ln === 'script' ||
         ln === 'pattern' || ln === 'filter' || ln === 'textPath' || ln === 'mpath' ||
         ln === 'linearGradient' || ln === 'radialGradient' || ln === 'feImage' || ln === 'tref')) {
      if (!this._svgHref) this._svgHref = new SVGAnimatedString(this, "href", "xlink:href");
      return this._svgHref;
    }
    if (ln === 'a' || ln === 'area') {
      const raw = this.getAttribute('href');
      if (raw === null) return '';
      // Legacy-charset document: href must reflect the encoding-override query.
      if (!_docIsUtf8()) { const u = _elemHrefURL(this); return u ? u.href : raw; }
      const r = _urlResolveOp(raw, _anchorBase());
      return r !== null ? r : raw;
    }
    return this.getAttribute("href") || "";
  }
  set href(v) { this.setAttribute("href", v); }
  // HTMLHyperlinkElementUtils / HTMLAnchorElement reflected content
  // attributes. Real-world locale, routing, and analytics code commonly
  // enumerates `[hreflang]` links and reads the IDL property rather than
  // getAttribute(); leaving it undefined aborts the entire component even
  // though the attribute is present in the DOM.
  get hreflang() { return this.getAttribute("hreflang") || ""; }
  set hreflang(v) { this.setAttribute("hreflang", v); }
  get rel() { return this.getAttribute("rel") || ""; }
  set rel(v) { this.setAttribute("rel", v); }
  get target() { return this.getAttribute("target") || ""; }
  set target(v) { this.setAttribute("target", v); }
  get download() { return this.getAttribute("download") || ""; }
  set download(v) { this.setAttribute("download", v); }
  get ping() { return this.getAttribute("ping") || ""; }
  set ping(v) { this.setAttribute("ping", v); }
  get referrerPolicy() { return this.getAttribute("referrerpolicy") || ""; }
  set referrerPolicy(v) { this.setAttribute("referrerpolicy", v); }
  // HTMLHyperlinkElementUtils URL-decomposition members, live on <a>/<area>.
  get protocol() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.protocol : ''; }
  set protocol(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'protocol', v); }
  get username() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.username : ''; }
  set username(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'username', v); }
  get password() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.password : ''; }
  set password(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'password', v); }
  get host() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.host : ''; }
  set host(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'host', v); }
  get hostname() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.hostname : ''; }
  set hostname(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'hostname', v); }
  get port() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.port : ''; }
  set port(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'port', v); }
  get pathname() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.pathname : ''; }
  set pathname(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'pathname', v); }
  get search() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.search : ''; }
  set search(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'search', v); }
  get hash() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.hash : ''; }
  set hash(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'hash', v); }
  get origin() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.origin : ''; }
  get src() {
    // IDL reflection: HTMLScriptElement/HTMLImageElement/etc. `.src` returns the
    // resolved absolute URL, not the literal attribute. Loaders that compute their
    // base via `new URL(document.currentScript.src).origin` break on a relative
    // value (issue #255). getAttribute("src") still returns the literal.
    const v = this.getAttribute("src");
    if (!v) return "";
    try { return new URL(v, globalThis.location?.href || "about:blank").href; }
    catch (e) { return v; }
  }
  set src(v) {
    // Only a script's src is a Trusted Types sink; an image or iframe src is
    // not, so the other elements sharing this reflector must not be routed
    // through a policy.
    this.setAttribute("src", this.localName === 'script'
      ? globalThis.__obscura_tt_enforce('TrustedScriptURL', v, 'HTMLScriptElement src')
      : v);
  }
  get srcdoc() { return this.localName === 'iframe' ? (this.getAttribute('srcdoc') || '') : undefined; }
  set srcdoc(v) {
    if (this.localName === 'iframe') {
      this.setAttribute('srcdoc', globalThis.__obscura_tt_enforce(
        'TrustedHTML', v, 'HTMLIFrameElement srcdoc'));
    }
  }
  get csp() { return this.localName === 'iframe' ? (this.getAttribute('csp') || '') : undefined; }
  set csp(value) {
    if (this.localName === 'iframe') this.setAttribute('csp', String(value));
  }
  get contentDocument() {
    if (this.localName !== 'iframe') return undefined;
    const nativeRoot = +_dom("iframe_content_document_root", this[_nidSym]);
    if (nativeRoot >= 0) {
      // Native content document committed by the Rust frame loader. The
      // same-origin gate compares typed DocumentScope origins in Rust, never
      // serialized origin strings; cross-origin content reads as null.
      if (!_frameSameOrigin(nativeRoot)) return null;
      _materializeFrameRealm(this[_nidSym]);
      const realmGlobal = _frameRealmGlobalFor(nativeRoot);
      if (realmGlobal && realmGlobal.document) {
        realmGlobal.document[_defaultViewProxySym] = _frameWindowProxyFor(this);
        return realmGlobal.document;
      }
      const doc = _scopedDocumentFor(nativeRoot);
      doc[_defaultViewProxySym] = _frameWindowProxyFor(this);
      return doc;
    }
    // No content root means no browsing context, which is what a detached
    // <iframe> has. A connected one is given its initial about:blank document
    // by the insertion steps, so it never reaches here.
    return null;
  }
  get contentWindow() {
    if (this.localName !== 'iframe') return undefined;
    // A native content document gets the stable WindowProxy regardless of
    // origin; per-property access checks live on the proxy itself.
    if (+_dom("iframe_content_document_root", this[_nidSym]) >= 0) {
      return _frameWindowProxyFor(this);
    }
    return null;
  }
  get action() {
    const base = _anchorBase();
    const action = this.getAttribute("action") || base || "";
    try { return new URL(action, base).href; } catch(e) { return action; }
  }
  set action(v) { this.setAttribute("action", v); }
  get method() { return this.getAttribute("method") || "get"; }
  set method(v) { this.setAttribute("method", v); }
  get form() {
    let p = this.parentNode;
    while (p && p.localName !== 'form') p = p.parentNode;
    return p;
  }
  get options() {
    if (this.localName !== 'select') return [];
    return _htmlCollectionFrom(this.querySelectorAll('option'));
  }
  add(item, before = null) {
    if (this.localName !== 'select') {
      throw new TypeError("Illegal invocation");
    }
    if (!item || item.nodeType !== 1
        || (item.localName !== 'option' && item.localName !== 'optgroup')) {
      throw new TypeError("Failed to execute 'add' on 'HTMLSelectElement': parameter 1 is not of type 'HTMLOptionElement' or 'HTMLOptGroupElement'.");
    }
    if (typeof before === 'number') {
      const reference = this.options[before] || null;
      this.insertBefore(item, reference);
    } else if (before == null) {
      this.appendChild(item);
    } else {
      this.insertBefore(item, before);
    }
  }
  get selectedIndex() {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].selected || opts[i].hasAttribute('selected')) return i;
    }
    return opts.length ? 0 : -1;
  }
  set selectedIndex(v) {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) {
      opts[i]._selected = (i === v);
    }
  }
  // Per the HTML spec, the submit() METHOD submits the form WITHOUT firing a
  // cancelable `submit` event — a page's submit listener cannot veto it. Only
  // requestSubmit() and user-initiated submits fire the cancelable event.
  // Conflating the two broke sites whose submit listener preventDefault()s the
  // native submit and then calls form.submit() from a callback (e.g. an
  // invisible-reCAPTCHA data-callback) to actually send the form.
  submit(submitter) {
    this._navigateSubmit(submitter);
  }
  requestSubmit(submitter) {
    // Per spec, a given submitter must be a submit button owned by this form;
    // both checks run before the submit event fires. A missing/null submitter
    // means "submit from the form itself".
    if (submitter !== undefined && submitter !== null) {
      if (!_isSubmitButton(submitter)) {
        throw new TypeError(
          "Failed to execute 'requestSubmit' on 'HTMLFormElement': The specified element is not a submit button."
        );
      }
      if (submitter.form !== this) {
        throw new DOMException(
          "Failed to execute 'requestSubmit' on 'HTMLFormElement': The specified element is not owned by this form element.",
          'NotFoundError'
        );
      }
    }
    const cancelled = !this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    if (cancelled) return;
    this._navigateSubmit(submitter);
  }
  _navigateSubmit(submitter) {
    const pairs = [];
    const fields = this.querySelectorAll('input, select, textarea');
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const name = f.getAttribute('name');
      if (!name) continue;
      if (f.getAttribute('disabled') !== null) continue;
      const tag = f.localName;
      const type = (f.getAttribute('type') || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !f.checked) continue;
      if (type === 'file' || type === 'reset') continue;
      if (type === 'button') continue;
      if (type === 'submit' || tag === 'button') {
        if (submitter && f !== submitter) continue;
        if (!submitter) continue; // default submit: don't include submit button value
      }

      let val;
      if (tag === 'select') {
        const opt = f.querySelector('option[selected]') || f.querySelector('option');
        val = opt ? (opt.getAttribute('value') !== null ? opt.getAttribute('value') : opt.textContent) : '';
      } else if (tag === 'textarea') {
        val = f.value || f.textContent || '';
      } else {
        val = f.value !== undefined ? f.value : (f.getAttribute('value') || '');
      }
      const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/!/g, '%21');
      pairs.push(enc(name) + '=' + enc(val));
    }

    const action = this.getAttribute('action') || '';
    const method = (this.getAttribute('method') || 'GET').toUpperCase();
    const baseUrl = globalThis.location?.href || 'about:blank';
    let targetUrl;
    try { targetUrl = new URL(action, baseUrl).href; } catch(e) { targetUrl = action; }

    if (!_cspResourceAllows(targetUrl, 'form-action')) return;

    const encoded = pairs.join('&');
    if (method === 'POST') {
      _navigateCurrentContext(targetUrl, 'POST', encoded);
    } else {
      const sep = targetUrl.includes('?') ? '&' : '?';
      _navigateCurrentContext(targetUrl + (encoded ? sep + encoded : ''), 'GET', '');
    }
  }
  reset() {
    this.dispatchEvent(new Event('reset', { bubbles: true }));
  }
  get dataset() {
    if (this._dataset) return this._dataset;
    const el = this;
    const attrFor = (k) => "data-" + _cssCamelToKebab(k);
    // camelCase the part after the `data-` prefix, e.g. data-foo-bar -> fooBar.
    const dataKeys = () => el.getAttributeNames()
      .filter((n) => n.startsWith("data-"))
      .map((n) => _cssKebabToCamel(n.slice(5)));
    this._dataset = new Proxy({}, {
      get(_, k) { if (typeof k !== "string") return undefined; return el.hasAttribute(attrFor(k)) ? el.getAttribute(attrFor(k)) : undefined; },
      set(_, k, v) { el.setAttribute(attrFor(k), String(v)); return true; },
      has(_, k) { return typeof k === "string" && el.hasAttribute(attrFor(k)); },
      deleteProperty(_, k) { if (typeof k === "string") el.removeAttribute(attrFor(k)); return true; },
      ownKeys() { return dataKeys(); },
      getOwnPropertyDescriptor(_, k) {
        if (typeof k === "string" && el.hasAttribute(attrFor(k))) {
          return { value: el.getAttribute(attrFor(k)), writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
    return this._dataset;
  }
  get offsetWidth() {
    if (this._isViewportRoot()) return globalThis.innerWidth || 1280;
    return Math.round(this.getBoundingClientRect().width);
  }
  get offsetHeight() {
    if (this._isViewportRoot()) return globalThis.innerHeight || 720;
    return Math.round(this.getBoundingClientRect().height);
  }
  get offsetTop() { return Math.round(this.getBoundingClientRect().top); }
  get offsetLeft() { return Math.round(this.getBoundingClientRect().left); }
  // The offset parent is the ancestor those two are measured against. It was
  // absent entirely, so reading it gave `undefined` -- a value the attribute
  // never has in a browser, which returns an element or null.
  get offsetParent() {
    const name = this.localName;
    if (name === 'body' || name === 'html' || !this.isConnected) return null;
    const styleOf = element => {
      try { return globalThis.getComputedStyle(element); } catch (_error) { return null; }
    };
    const own = styleOf(this);
    // A box that is not rendered, and a fixed box, have no offset parent.
    if (own && (own.display === 'none' || own.position === 'fixed')) return null;
    for (let node = this.parentElement; node; node = node.parentElement) {
      const local = node.localName;
      if (local === 'body') return node;
      const style = styleOf(node);
      if (style && style.position && style.position !== 'static') return node;
      if (local === 'td' || local === 'th' || local === 'table') return node;
    }
    return null;
  }
  // In standards mode documentElement exposes viewport client geometry.
  // Puppeteer's #clickableBox clips boxes to those dimensions; returning the
  // non-render fallback 100x20 there makes every element appear off-screen.
  get clientWidth() {
    // In standards mode only the root element exposes the viewport. Body is
    // an ordinary box; treating it as another viewport breaks libraries that
    // measure the page's body or a full-viewport sizing sentinel.
    if (this.tagName === 'HTML') return globalThis.innerWidth || 1280;
    const metrics = this._renderClientMetrics();
    return metrics ? metrics.width : 100;
  }
  get clientHeight() {
    if (this.tagName === 'HTML') return globalThis.innerHeight || 720;
    const metrics = this._renderClientMetrics();
    return metrics ? metrics.height : 20;
  }
  _renderClientMetrics() {
    if (typeof Deno.core.ops.op_layout_geometry !== 'function') return null;
    try {
      const raw = Deno.core.ops.op_layout_geometry(String(this[_nidSym] | 0));
      if (!raw) return { width: 0, height: 0 };
      const geometry = JSON.parse(raw);
      if (geometry
          && Number.isFinite(geometry.clientWidth)
          && Number.isFinite(geometry.clientHeight)) {
        // CSSOM View exposes Web IDL longs. The native layout retains
        // subpixel precision for getBoundingClientRect(); client metrics round
        // to whole CSS pixels like Chromium.
        return {
          width: Math.round(Math.max(0, geometry.clientWidth)),
          height: Math.round(Math.max(0, geometry.clientHeight)),
        };
      }
    } catch (_error) {}
    return { width: 0, height: 0 };
  }
  // `undefined` means this is a non-render build. `null` means the render
  // engine is present but this element has no associated CSS box (for
  // example, display:none or a detached element). Keep those states distinct:
  // CSSOM View returns an empty rect list for the latter, while the former
  // deliberately retains Obscura's compatibility geometry.
  _renderBoxGeometry() {
    if (typeof Deno.core.ops.op_layout_geometry !== 'function') return undefined;
    try {
      const raw = Deno.core.ops.op_layout_geometry(String(this[_nidSym] | 0));
      if (!raw) return null;
      const geometry = JSON.parse(raw);
      if (geometry
          && Number.isFinite(geometry.x)
          && Number.isFinite(geometry.y)
          && Number.isFinite(geometry.width)
          && Number.isFinite(geometry.height)) {
        return geometry;
      }
    } catch (_error) {}
    return null;
  }
  _rectFromRenderGeometry(geometry) {
    const x = geometry.x, y = geometry.y;
    const width = geometry.width, height = geometry.height;
    const rect = {
      x, y, width, height,
      top: y, right: x + width, bottom: y + height, left: x,
      toJSON() { return this; },
    };
    Object.defineProperty(rect, "__obscuraViewportFixed", {
      value: !!geometry.viewportFixed,
      enumerable: false,
    });
    return rect;
  }
  get scrollWidth() {
    if (this._isViewportRoot()) {
      const metrics = this._renderScrollMetrics();
      return metrics
        ? Math.round(Math.max(0, metrics.scrollWidth || 0))
        : (globalThis.innerWidth || 1280);
    }
    const metrics = this._renderElementScrollMetrics();
    if (metrics !== undefined) {
      return metrics ? Math.round(Math.max(0, metrics.scrollWidth || 0)) : 0;
    }
    return 100;
  }
  get scrollHeight() {
    if (this._isViewportRoot()) {
      const metrics = this._renderScrollMetrics();
      return metrics
        ? Math.round(Math.max(0, metrics.scrollHeight || 0))
        : (globalThis.innerHeight || 720);
    }
    const metrics = this._renderElementScrollMetrics();
    if (metrics !== undefined) {
      return metrics ? Math.round(Math.max(0, metrics.scrollHeight || 0)) : 0;
    }
    return 20;
  }
  _isViewportRoot() {
    const t = this.tagName;
    return t === 'HTML' || t === 'BODY';
  }
  _renderScrollMetrics() {
    if (typeof Deno.core.ops.op_layout_metrics !== 'function') return null;
    try {
      // A frame realm's document-level metrics (client*/scroll*) belong to the
      // frame, not the embedder; pass its own content root so the op lays out
      // the right document.
      const raw = Deno.core.ops.op_layout_metrics(String(_callingFrameRoot() || ""));
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }
  _renderElementScrollMetrics() {
    if (typeof Deno.core.ops.op_element_scroll_metrics !== 'function') return undefined;
    try {
      const raw = Deno.core.ops.op_element_scroll_metrics(String(this[_nidSym] | 0));
      if (!raw) return null;
      const metrics = JSON.parse(raw);
      return metrics && metrics.hasBox !== false ? metrics : null;
    } catch (_e) {
      return null;
    }
  }
  _renderScrollOffset() {
    if (typeof Deno.core.ops.op_scroll_offset !== 'function') return null;
    try {
      const raw = Deno.core.ops.op_scroll_offset();
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }
  _setRenderScroll(x, y) {
    if (typeof Deno.core.ops.op_scroll_to !== 'function') return null;
    try {
      const raw = Deno.core.ops.op_scroll_to(+x || 0, +y || 0);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }
  _setRenderElementScroll(x, y) {
    if (typeof Deno.core.ops.op_element_scroll_to !== 'function') return null;
    try {
      const raw = Deno.core.ops.op_element_scroll_to(String(this[_nidSym] | 0), +x || 0, +y || 0);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }
  // Render builds clamp both viewport and element scroll areas against the
  // exact overflow used by geometry and paint. Non-render builds retain the
  // synthetic compatibility state.
  get scrollTop() {
    if (this._isViewportRoot()) {
      const offset = this._renderScrollOffset();
      if (offset) return offset.y || 0;
    } else {
      const metrics = this._renderElementScrollMetrics();
      if (metrics !== undefined) return metrics ? (metrics.y || 0) : 0;
    }
    return this._scrollTop || 0;
  }
  set scrollTop(v) {
    v = +v;
    const nv = Number.isFinite(v) && v > 0 ? v : 0;
    const old = this.scrollTop;
    let actual = nv;
    if (this._isViewportRoot()) {
      const offset = this._renderScrollOffset();
      const updated = offset && this._setRenderScroll(offset.x, nv);
      if (updated) actual = updated.y || 0;
    } else {
      const metrics = this._renderElementScrollMetrics();
      if (metrics !== undefined) {
        actual = metrics ? (metrics.y || 0) : 0;
        const updated = metrics && this._setRenderElementScroll(metrics.x, nv);
        if (updated) actual = updated.y || 0;
      }
    }
    const changed = actual !== old;
    this._scrollTop = actual;
    if (changed && !this._scrollSuppress) this._fireScroll();
    if (changed &&
        typeof globalThis.__obscura_recompute_intersections === "function") {
      // Scrolling changes target positions, not ResizeObserver box sizes.
      globalThis.__obscura_recompute_intersections();
    }
  }
  get scrollLeft() {
    if (this._isViewportRoot()) {
      const offset = this._renderScrollOffset();
      if (offset) return offset.x || 0;
    } else {
      const metrics = this._renderElementScrollMetrics();
      if (metrics !== undefined) return metrics ? (metrics.x || 0) : 0;
    }
    return this._scrollLeft || 0;
  }
  set scrollLeft(v) {
    v = +v;
    const nv = Number.isFinite(v) && v > 0 ? v : 0;
    const old = this.scrollLeft;
    let actual = nv;
    if (this._isViewportRoot()) {
      const offset = this._renderScrollOffset();
      const updated = offset && this._setRenderScroll(nv, offset.y);
      if (updated) actual = updated.x || 0;
    } else {
      const metrics = this._renderElementScrollMetrics();
      if (metrics !== undefined) {
        actual = metrics ? (metrics.x || 0) : 0;
        const updated = metrics && this._setRenderElementScroll(nv, metrics.y);
        if (updated) actual = updated.x || 0;
      }
    }
    const changed = actual !== old;
    this._scrollLeft = actual;
    if (changed && !this._scrollSuppress) this._fireScroll();
    if (changed &&
        typeof globalThis.__obscura_recompute_intersections === "function") {
      globalThis.__obscura_recompute_intersections();
    }
  }
  getBoundingClientRect() {
    globalThis[_inputClickTargetSym] = this;
    // Real layout when the render feature is compiled in: ask the Rust layout
    // cache for this element's border box. The op is absent in the default
    // build, so probe with typeof and fall through to the synthetic rect below.
    const geometry = this._renderBoxGeometry();
    if (geometry !== undefined) {
      if (geometry) return this._rectFromRenderGeometry(geometry);
      // CSSOM View: an element without an associated box has an all-zero
      // bounding rect. Do not leak the non-render 100x20 compatibility cell.
      return {
        x: 0, y: 0, width: 0, height: 0,
        top: 0, right: 0, bottom: 0, left: 0,
        toJSON() { return this; },
      };
    }
    // Default (non-render) builds keep viewport-sized roots. Without this
    // synthetic fallback every hit test against them clips down to a 100x20
    // cell and Document.elementFromPoint cannot recurse into their children.
    if (this._isViewportRoot()) {
      const vw = globalThis.innerWidth || 1280;
      const vh = globalThis.innerHeight || 720;
      return {
        x: 0, y: 0, width: vw, height: vh,
        top: 0, right: vw, bottom: vh, left: 0,
        toJSON() { return this; },
      };
    }
    // No layout engine (default build): synthesize a deterministic position
    // from the node id so Playwright's actionability polling still gets a
    // stable, distinct rect for hit-testing (issue #45).
    // Every nid maps to a unique cell in a 12-column grid for a 1280x720 viewport.
    const VW = 1280, VH = 720, COLS = 12, CW = 100, CH = 20, GX = 110, GY = 30;
    const rowsPerScreen = Math.max(1, Math.floor((VH - 10) / GY));
    const cell = this[_nidSym] | 0;
    const col = ((cell * 7) | 0) % COLS;
    const row = (((cell * 13) | 0) >> 0) % rowsPerScreen;
    const x = 10 + col * GX;
    const y = 10 + row * GY;
    return {
      x, y, width: CW, height: CH,
      top: y, right: x + CW, bottom: y + CH, left: x,
      toJSON() { return this; },
    };
  }
  getClientRects() {
    const geometry = this._renderBoxGeometry();
    if (geometry === null) return new DOMRectList([]);
    if (geometry !== undefined) {
      if (Array.isArray(geometry.clientRects)) {
        return new DOMRectList(geometry.clientRects.map(
          rect => this._rectFromRenderGeometry({
            ...rect,
            viewportFixed: geometry.viewportFixed,
          })
        ));
      }
      return new DOMRectList([this._rectFromRenderGeometry(geometry)]);
    }
    return new DOMRectList([this.getBoundingClientRect()]);
  }
  // No layout engine: a stub that always returns true unblocks Playwright's
  // actionability polling. With a real layout we'd check display, visibility,
  // opacity and rect dimensions per spec.
  checkVisibility(opts) { return true; }
  // ARIA reflection properties. Without an accessibility tree we expose the
  // raw aria-* attributes so Playwright's getByRole / getByLabel locators can
  // at least find elements that author them explicitly.
  get role() { return this.getAttribute('role'); }
  set role(v) { if (v == null) this.removeAttribute('role'); else this.setAttribute('role', String(v)); }
  get ariaLabel() { return this.getAttribute('aria-label'); }
  set ariaLabel(v) { if (v == null) this.removeAttribute('aria-label'); else this.setAttribute('aria-label', String(v)); }
  get ariaRoleDescription() { return this.getAttribute('aria-roledescription'); }
  set ariaRoleDescription(v) { if (v == null) this.removeAttribute('aria-roledescription'); else this.setAttribute('aria-roledescription', String(v)); }
  get ariaChecked() { return this.getAttribute('aria-checked'); }
  set ariaChecked(v) { if (v == null) this.removeAttribute('aria-checked'); else this.setAttribute('aria-checked', String(v)); }
  get ariaDisabled() { return this.getAttribute('aria-disabled'); }
  set ariaDisabled(v) { if (v == null) this.removeAttribute('aria-disabled'); else this.setAttribute('aria-disabled', String(v)); }
  get ariaExpanded() { return this.getAttribute('aria-expanded'); }
  set ariaExpanded(v) { if (v == null) this.removeAttribute('aria-expanded'); else this.setAttribute('aria-expanded', String(v)); }
  get ariaHidden() { return this.getAttribute('aria-hidden'); }
  set ariaHidden(v) { if (v == null) this.removeAttribute('aria-hidden'); else this.setAttribute('aria-hidden', String(v)); }
  get ariaSelected() { return this.getAttribute('aria-selected'); }
  set ariaSelected(v) { if (v == null) this.removeAttribute('aria-selected'); else this.setAttribute('aria-selected', String(v)); }
  scrollIntoView(arg) {
    globalThis[_inputClickTargetSym] = this;
    const rect = this.getBoundingClientRect();
    // A viewport-fixed subtree is already expressed in the viewport's
    // coordinate space and cannot be brought closer by moving the document.
    if (rect.__obscuraViewportFixed) return;

    let block = "start", inline = "nearest";
    if (arg === false) block = "end";
    else if (arg && typeof arg === "object") {
      if (["start", "center", "end", "nearest"].includes(arg.block)) block = arg.block;
      if (["start", "center", "end", "nearest"].includes(arg.inline)) inline = arg.inline;
    }
    const currentX = globalThis.scrollX || 0;
    const currentY = globalThis.scrollY || 0;
    const vw = globalThis.innerWidth || 1280;
    const vh = globalThis.innerHeight || 720;
    const align = (mode, start, end, size, viewportSize, current) => {
      if (mode === "start") return current + start;
      if (mode === "center") return current + start - (viewportSize - size) / 2;
      if (mode === "end") return current + end - viewportSize;
      // CSSOM View's nearest alignment: do nothing when fully visible or when
      // the box spans both viewport edges; otherwise move the closer edge in.
      if ((start >= 0 && end <= viewportSize) || (start < 0 && end > viewportSize)) {
        return current;
      }
      if (start < 0) return current + start;
      if (end > viewportSize) return current + end - viewportSize;
      return current;
    };
    const left = align(inline, rect.left, rect.right, rect.width, vw, currentX);
    const top = align(block, rect.top, rect.bottom, rect.height, vh, currentY);
    globalThis.scrollTo({ left, top, behavior: arg && arg.behavior });
  }
  // scrollTo/scrollBy/scroll accept either (x, y) or a ScrollToOptions object.
  // The setters fire a scroll event of their own, so suppress the per-axis ones
  // here and emit a single event for the whole movement, the way a real browser
  // coalesces one scroll per scroll operation rather than one per axis.
  scrollTo(x, y) {
    let left, top;
    if (x !== null && typeof x === 'object') { left = x.left; top = x.top; }
    else { left = x; top = y; }
    const oldLeft = this.scrollLeft, oldTop = this.scrollTop;
    let native = false, updated = null;
    if (this._isViewportRoot()) {
      const offset = this._renderScrollOffset();
      if (offset) {
        native = true;
        updated = this._setRenderScroll(
          left === undefined ? offset.x : (+left || 0),
          top === undefined ? offset.y : (+top || 0),
        );
      }
    } else {
      const metrics = this._renderElementScrollMetrics();
      if (metrics !== undefined) {
        native = true;
        updated = metrics
          ? this._setRenderElementScroll(
              left === undefined ? metrics.x : (+left || 0),
              top === undefined ? metrics.y : (+top || 0),
            )
          : { x: 0, y: 0 };
      }
    }
    if (native) {
      const actualLeft = updated ? (updated.x || 0) : oldLeft;
      const actualTop = updated ? (updated.y || 0) : oldTop;
      this._scrollLeft = actualLeft;
      this._scrollTop = actualTop;
      if (actualLeft !== oldLeft || actualTop !== oldTop) {
        if (typeof globalThis.__obscura_recompute_intersections === "function") {
          globalThis.__obscura_recompute_intersections();
        }
        this._fireScroll();
      }
      return;
    }
    this._scrollSuppress = true;
    if (left !== undefined) this.scrollLeft = +left || 0;
    if (top !== undefined) this.scrollTop = +top || 0;
    this._scrollSuppress = false;
    if (this.scrollLeft !== oldLeft || this.scrollTop !== oldTop) this._fireScroll();
  }
  scroll(x, y) { this.scrollTo(x, y); }
  scrollBy(x, y) {
    let dl, dt;
    if (x !== null && typeof x === 'object') { dl = x.left; dt = x.top; }
    else { dl = x; dt = y; }
    this.scrollTo({
      left: (this.scrollLeft || 0) + (+dl || 0),
      top: (this.scrollTop || 0) + (+dt || 0),
    });
  }
  _fireScroll() {
    if (this._scrollEventPending) return;
    this._scrollEventPending = true;
    const self = this;
    setTimeout(() => {
      self._scrollEventPending = false;
      try { self.dispatchEvent(new Event('scroll', { bubbles: false })); } catch (e) {}
    }, 0);
  }
  animate(keyframes, options) {
    const animation = new Animation(new KeyframeEffect(this, keyframes, options), document.timeline);
    animation.play();
    return animation;
  }
  getAnimations() { return _animationsForTarget(this); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  append(...nodes) { for (const n of _convertNodes(nodes)) this.appendChild(n); }
  prepend(...nodes) {
    const ref = this.firstChild;
    for (const n of _convertNodes(nodes)) {
      if (ref) this.insertBefore(n, ref); else this.appendChild(n);
    }
  }
  replaceChildren(...nodes) {
    const converted = _convertNodes(nodes);
    let c;
    while ((c = this.firstChild)) this.removeChild(c);
    for (const n of converted) this.appendChild(n);
  }
}
