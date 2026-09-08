// During custom-element upgrade, HTMLElement's constructor must return the
// already-existing element being upgraded. A class constructor cannot be
// invoked with `.call(existingElement)`, so the registry and Element
// constructor coordinate through the same construction-stack shape used by
// browser custom-element implementations.
const _customElementConstructionStack = [];

function __prepareInsertedScript(script) {
  if (!Deno.core.ops.op_script_try_start(script[_nidSym])) return;
  const scriptType = (script.getAttribute('type') || '').trim().toLowerCase();
  const isModule = scriptType === 'module';
  const isImportMap = scriptType === 'importmap';
  if (isImportMap) {
    const src = script.getAttribute('src');
    if (!_dynamicScriptCspAllows(script, '', true)) {
      console.info('Blocked dynamic import map by Content-Security-Policy');
      return;
    }
    let error = '';
    if (src) {
      error = 'External import maps are not supported';
    } else {
      const base = script.baseURI
        || globalThis.location?.href
        || 'about:blank';
      try {
        error = Deno.core.ops.op_add_import_map(script.textContent || '', base) || '';
      } catch (e) {
        error = e && e.message ? e.message : String(e);
      }
    }
    if (error) {
      console.error('Import map error:', error);
      queueMicrotask(() => {
        try { script.dispatchEvent(new Event('error')); } catch (_) {}
      });
    }
    return;
  }
  if (scriptType && !isModule && scriptType !== 'text/javascript' && scriptType !== 'application/javascript') {
    return;
  }
  const src = script.getAttribute('src');
  const code = src ? "" : script.textContent;
  if (!src && !code) return;
  if (src) {
    let resolved = src;
    try { resolved = _resolveResourceUrl(String(src)); } catch (_) {}
    if (!_dynamicScriptCspAllows(script, resolved, false)) {
      console.info('Blocked dynamic script by Content-Security-Policy:', resolved);
      return;
    }
  } else if (!_dynamicScriptCspAllows(script, '', true)) {
    console.info('Blocked dynamic inline script by Content-Security-Policy');
    return;
  }
  const prevNid = globalThis.__currentScriptNid;
  if (src) {
    let baseHref;
    try {
      baseHref = _internalBaseHref(globalThis.document);
    } catch(e) { baseHref = null; }
    const docUrl = globalThis.location?.href || 'http://localhost/';
    let baseUrl;
    try { baseUrl = baseHref ? new URL(baseHref, docUrl).href : docUrl; }
    catch(e) { baseUrl = docUrl; }
    let fullUrl;
    try {
      fullUrl = src.startsWith('http') || src.startsWith('data:')
        ? src
        : new URL(src, baseUrl).href;
    } catch(e) {
      console.error('Dynamic script URL resolve failed (' + src + '):', e.message);
      fullUrl = src;
    }
    // Fetch metadata and Origin belong to the document's environment, not to
    // a cross-origin <base href> used only to resolve this script URL.
    const pageOrigin = _environmentSettings().origin
      || (function() { try { return new URL(docUrl).origin; } catch(e) { return ""; } })();
    const crossOrigin = script.getAttribute('crossorigin');
    let requestMode = 'no-cors';
    let requestCredentials = 'include';
    if (crossOrigin !== null) {
      const value = String(crossOrigin).trim().toLowerCase();
      if (value === '' || value === 'anonymous') {
        requestMode = 'cors';
        requestCredentials = 'same-origin';
      } else if (value === 'use-credentials') {
        requestMode = 'cors';
        requestCredentials = 'include';
      }
    }
    const task = {
      url: fullUrl,
      isModule,
      nid: script[_nidSym],
      prevNid,
      pageOrigin,
      requestMode,
      requestCredentials,
      dispatchEvent: (ev) => { try { script.dispatchEvent(ev); } catch(e) {} },
    };
    // Non-parser-inserted external scripts are async by default, but scripts
    // prepared while the document is still loading still delay window.load.
    // Snapshot the flag at preparation time: changing readyState later must
    // not turn already-prepared work into a post-load enhancement.
    task.delaysLoad = globalThis.document?.readyState !== 'complete';
    if (task.delaysLoad) __dynLoadDelayingPending++;
    // A non-parser-inserted classic script is force-async unless script code
    // explicitly assigned `.async = false`. Keep that opt-out in insertion
    // order; default/async=true scripts fetch concurrently and execute as soon
    // as each response is ready.
    const explicitlyInOrder = !isModule
      && Object.prototype.hasOwnProperty.call(script, 'async')
      && script.async === false;
    if (!isModule) {
      // Fetch all dynamically inserted classics immediately. `async=false`
      // changes only execution order: browsers still overlap their network
      // requests, then hold a ready body behind earlier ordered scripts.
      __startDynClassicFetch(task);
      if (explicitlyInOrder) {
        __dynScriptQueue.push(task);
        __processDynScriptQueue();
      } else {
        __runAsyncClassicScript(task);
      }
    } else {
      __dynScriptQueue.push(task);
      __processDynScriptQueue();
    }
  } else if (isModule) {
    const dataUrl = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(code)));
    const task = {
      url: dataUrl,
      isModule: true,
      nid: script[_nidSym],
      prevNid,
      pageOrigin: "",
      dispatchEvent: (ev) => { try { script.dispatchEvent(ev); } catch(e) {} },
      delaysLoad: globalThis.document?.readyState !== 'complete',
    };
    if (task.delaysLoad) __dynLoadDelayingPending++;
    __dynScriptQueue.push(task);
    __processDynScriptQueue();
  } else {
    globalThis.__currentScriptNid = script[_nidSym];
    // An inline script has no URL of its own; a browser attributes it to the
    // document that contains it.
    try { __runClassicScript(code, globalThis.location?.href); }
    catch(e) { console.error('Dynamic inline script error:', e.message); }
    finally { globalThis.__currentScriptNid = prevNid || 0; }
  }
}

function __prepareInsertedSubtree(root) {
  // HTML's script preparation algorithm leaves a disconnected script
  // unstarted.  When an ancestor is later connected, insertion steps visit
  // every script in that subtree in tree order.
  if (!root || !root.isConnected) return;
  if (root.nodeType === 1 && root.localName === 'iframe') {
    _dom("create_blank_iframe_document", root[_nidSym]);
    Deno.core.ops.op_queue_iframe_navigation(root[_nidSym]);
  }
  // Shadow-piercing on purpose. A selector query stops at a shadow boundary,
  // so an iframe inside a shadow root -- how widget embeds are built, Turnstile
  // among them -- was never queued when its host was connected, and the
  // browsing context that its `src` had already asked for was dropped for
  // having no frame yet. Nothing re-queued it, so the frame stayed empty.
  const iframeIds = _domParse("iframe_hosts_including_shadow", root[_nidSym], "") || [];
  for (const nid of iframeIds) {
    _dom("create_blank_iframe_document", +nid);
    Deno.core.ops.op_queue_iframe_navigation(+nid);
  }
  _syncWindowFrameIndices();
  const scripts = [];
  const seen = new Set();
  if (root.nodeType === 1 && root.tagName === 'SCRIPT') {
    scripts.push(root);
    seen.add(root[_nidSym]);
  }
  const ids = _domParse("query_selector_all_scoped", root[_nidSym], "script") || [];
  for (const nid of ids) {
    const script = _wrapEl(+nid);
    if (script && !seen.has(script[_nidSym])) {
      scripts.push(script);
      seen.add(script[_nidSym]);
    }
  }
  for (const script of scripts) __prepareInsertedScript(script);
}

function _seedDetachedTreeState(node) {
  node._treeDetachedExact = true;
  node[_treeParentSym] = null;
  node[_treeParentEpochSym] = _treeMutationEpoch;
  node._treeConnected = false;
  node._treeConnectedEpoch = _treeMutationEpoch;
}

function _seedInsertedTreeState(node, parent, connected) {
  node._treeDetachedExact = false;
  node[_treeParentSym] = parent;
  node[_treeParentEpochSym] = _treeMutationEpoch;
  node._treeConnected = !!connected;
  node._treeConnectedEpoch = _treeMutationEpoch;
  // Insertion adopts the node into the parent's document. Restamp only the
  // moved root; descendants re-resolve lazily (weak consistency, see
  // Node#ownerDocument). Free while no iframe content document exists.
  if (_iframeContentDocsSeen) {
    node[_ownerDocRootSym] = parent
      ? (parent[_scopeRootSym] !== undefined
          ? parent[_scopeRootSym]
          : (parent instanceof Document ? parent[_nidSym] : parent[_ownerDocRootSym]))
      : undefined;
  }
}

function _seedUnchangedConnection(node, connected) {
  node._treeConnected = !!connected;
  node._treeConnectedEpoch = _treeMutationEpoch;
}

class EventTarget {
  addEventListener(type, callback, options = undefined) {
    _eventTargetAdd(this, type, callback, options);
  }
  dispatchEvent(event) {
    return _eventTargetDispatch(this, event);
  }
  removeEventListener(type, callback, options = undefined) {
    _eventTargetRemove(this, type, callback, options);
  }
  when(type, options = undefined) {
    return _eventTargetWhen.call(this, type, options, arguments.length);
  }
}

class Node extends EventTarget {
  static ELEMENT_NODE = 1;
  static ATTRIBUTE_NODE = 2;
  static TEXT_NODE = 3;
  static CDATA_SECTION_NODE = 4;
  static ENTITY_REFERENCE_NODE = 5;
  static ENTITY_NODE = 6;
  static PROCESSING_INSTRUCTION_NODE = 7;
  static COMMENT_NODE = 8;
  static DOCUMENT_NODE = 9;
  static DOCUMENT_TYPE_NODE = 10;
  static DOCUMENT_FRAGMENT_NODE = 11;
  static NOTATION_NODE = 12;
  static DOCUMENT_POSITION_DISCONNECTED = 1;
  static DOCUMENT_POSITION_PRECEDING = 2;
  static DOCUMENT_POSITION_FOLLOWING = 4;
  static DOCUMENT_POSITION_CONTAINS = 8;
  static DOCUMENT_POSITION_CONTAINED_BY = 16;
  static DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 32;

  constructor(nid) {
    super();
    this[_nidSym] = nid;
  }
  get nodeType() { return +_dom("node_type", this[_nidSym]); }
  get nodeName() { return _domParse("node_name", this[_nidSym]) || ""; }
  get ownerDocument() {
    if (typeof Document === 'function' && this instanceof Document) return null;
    const detachedOwner = _detachedOwnerForNode(this);
    if (detachedOwner) return detachedOwner;
    // Owner-document scope cache (design 2.3). The stamp is the owning
    // document root nid; creation and insertion paths stamp it when they know
    // the scope, cross-document moves restamp only the moved root (a
    // descendant may keep a stale owner until re-resolved -- accepted weak
    // consistency for Phase 2b; adoptNode and insertion restamp the root).
    // Pages that never create an iframe content document take the constant
    // no-op path below.
    const main = globalThis.document;
    const cached = this[_ownerDocRootSym];
    if (cached !== undefined) {
      return (main === null || cached === main[_nidSym]) ? main : _scopedDocumentFor(cached);
    }
    if (!_iframeContentDocsSeen) return main;
    const mainNid = main ? main[_nidSym] : 0;
    const root = +_dom("document_root", this[_nidSym]);
    // A detached subtree's scope root is its own top ancestor, not a document
    // node; ownership stays with the main document unless the root is an
    // iframe content-document root (the only non-main document nodes in the
    // arena).
    const owner = (root > 0 && root !== mainNid
        && (_scopedDocs.has(root) || +_dom("node_type", root) === 9))
      ? root
      : mainNid;
    this[_ownerDocRootSym] = owner;
    return owner === mainNid ? main : _scopedDocumentFor(owner);
  }
  // https://dom.spec.whatwg.org/#dom-node-baseuri
  get baseURI() {
    try {
      if (typeof this[_scopeRootSym] === 'number') {
        const info = _domParse('document_scope_info', this[_scopeRootSym]) || {};
        const docUrl = info.baseUrl || info.url || 'about:blank';
        const href = _internalBaseHref(this);
        if (href) {
          const resolved = new URL(href, docUrl).href;
          if (_cspBaseUriAllows(resolved)) return resolved;
        }
        return docUrl;
      }
      // Frame content nodes resolve against their own document's base; the
      // ownerDocument lookup is cached and skipped entirely on pages without
      // iframe content documents.
      const doc = (_iframeContentDocsSeen && this.ownerDocument) || globalThis.document;
      const docUrl = (doc && doc.URL) || "";
      const href = _internalBaseHref(doc);
      if (href) {
        if (href) {
          const resolved = docUrl ? new URL(href, docUrl).href : href;
          if (_cspBaseUriAllows(resolved)) return resolved;
        }
      }
      return docUrl;
    } catch (e) {
      return "";
    }
  }
  get textContent() {
    if (typeof Document === 'function' && this instanceof Document) return null;
    return _domParse("text_content", this[_nidSym]) ?? "";
  }
  set textContent(v) {
    if (this.localName === 'script') {
      v = globalThis.__obscura_tt_enforce(
        'TrustedScript', v, 'HTMLScriptElement textContent');
    }
    const oldChildren = _domParse("child_nodes", this[_nidSym]) || [];
    for (const c of oldChildren) {
      const child = _wrap(c);
      if (child) _subtreeDisconnected(child);
      _dom("remove_child", c);
    }
    let added = [];
    if (v != null && v !== "") {
      const tn = +_dom("create_text_node", String(v));
      _dom("append_child", this[_nidSym], tn);
      added = [tn];
    }
    // Real MutationObserver fires childList for the children swap.
    // Without this React 18+ hydration mismatch detection and many polling
    // libs (intersection-driven lazy load, content sync) silently stall.
    if (globalThis.__mutationObservers?.length) {
      globalThis.__notifyMutation('childList', this[_nidSym], added, oldChildren);
    }
  }
  get nodeValue() {
    const t = this.nodeType;
    if (t === 3 || t === 8) return _domParse("text_content", this[_nidSym]) ?? "";
    return null;
  }
  set nodeValue(v) {
    const t = this.nodeType;
    if (t === 3 || t === 8) _dom("set_text_content", this[_nidSym], String(v ?? ""));
  }
  get parentNode() {
    if (this._shadowParent) return this._shadowParent;
    const detachedOwner = _detachedOwnerForNode(this);
    if (detachedOwner && detachedOwner !== this
        && detachedOwner.documentElement === this) return detachedOwner;
    if (this._treeDetachedExact) return null;
    if (this[_treeParentEpochSym] === _treeMutationEpoch) return this[_treeParentSym];
    const parent = _wrap(+_dom("parent_node", this[_nidSym]));
    this[_treeParentSym] = parent;
    this[_treeParentEpochSym] = _treeMutationEpoch;
    return parent;
  }
  get parentElement() { const p = this.parentNode; return p && p.nodeType === 1 ? p : null; }
  get childNodes() {
    const ids = _domParse("child_nodes", this[_nidSym]) || [];
    return _nodeList(ids.map(_wrap).filter(Boolean));
  }
  get firstChild() { return _wrap(+_dom("first_child", this[_nidSym])); }
  get lastChild() { return _wrap(+_dom("last_child", this[_nidSym])); }
  get nextSibling() {
    if (this._shadowParent) {
      const children = this._shadowParent.childNodes;
      const index = children.indexOf(this);
      return index >= 0 ? (children[index + 1] || null) : null;
    }
    return _wrap(+_dom("next_sibling", this[_nidSym]));
  }
  get previousSibling() {
    if (this._shadowParent) {
      const children = this._shadowParent.childNodes;
      const index = children.indexOf(this);
      return index > 0 ? children[index - 1] : null;
    }
    return _wrap(+_dom("prev_sibling", this[_nidSym]));
  }
  appendChild(c) {
    if (!c) return c;
    if (c instanceof DocumentFragment) {
      const children = Array.from(c.childNodes);
      for (const child of children) this.appendChild(child);
      return c;
    }
    if (c._shadowParent) c._shadowParent.removeChild(c);
    else if (c.parentNode) _subtreeDisconnected(c);
    const parentConnected = this.isConnected;
    const inserted = _dom("append_child", this[_nidSym], c[_nidSym]) === "true";
    if (!inserted) {
      throw new DOMException(
        "Failed to execute 'appendChild' on 'Node': The new child would create an invalid tree.",
        "HierarchyRequestError",
      );
    }
    _seedUnchangedConnection(this, parentConnected);
    _seedInsertedTreeState(c, this, parentConnected);
    _registerWindowNamedTree(c);
    if (globalThis.__mutationObservers?.length) globalThis.__notifyMutation('childList', this[_nidSym], [c[_nidSym]], []);
    __prepareInsertedSubtree(c);
    if (c instanceof Element && c.tagName === 'LINK') {
      _loadLinkedStylesheet(c);
    }
    return c;
  }
  removeChild(c) {
    if (!c || c.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        'NotFoundError'
      );
    }
    const removedWindowNames = _windowNamedNamesInTree(c);
    const linkedStyle = c instanceof Element
      ? _linkedStylesheetNodes.get(c)
      : null;
    if (linkedStyle?.parentNode === this) {
      _dom("remove_child", linkedStyle[_nidSym]);
      _linkedStylesheetNodes.delete(c);
    }
    const parentConnected = this.isConnected;
    const removed = _dom("remove_child", c[_nidSym]) === "true";
    if (!removed) {
      throw new DOMException(
        "Failed to execute 'removeChild' on 'Node': The node is not a child of this node.",
        "NotFoundError",
      );
    }
    _seedUnchangedConnection(this, parentConnected);
    _seedDetachedTreeState(c);
    _subtreeDisconnected(c);
    _reconcileWindowNamedProperties(removedWindowNames);
    if (globalThis.__mutationObservers?.length) globalThis.__notifyMutation('childList', this[_nidSym], [], [c[_nidSym]]);
    return c;
  }
  replaceChild(newChild, oldChild) {
    if (!oldChild || !newChild) return oldChild;
    if (oldChild.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'replaceChild' on 'Node': The node to be replaced is not a child of this node.",
        "NotFoundError",
      );
    }
    if (newChild === oldChild) return oldChild;
    if (newChild instanceof DocumentFragment) {
      const children = Array.from(newChild.childNodes);
      for (const child of children) this.insertBefore(child, oldChild);
      this.removeChild(oldChild);
      return oldChild;
    }
    if (newChild._shadowParent) newChild._shadowParent.removeChild(newChild);
    else if (newChild.parentNode) _subtreeDisconnected(newChild);
    const parentConnected = this.isConnected;
    const removedWindowNames = _windowNamedNamesInTree(oldChild);
    const inserted = _dom("insert_before", newChild[_nidSym], oldChild[_nidSym]) === "true";
    if (!inserted) {
      throw new DOMException(
        "Failed to execute 'replaceChild' on 'Node': The new child would create an invalid tree.",
        "HierarchyRequestError",
      );
    }
    const removed = _dom("remove_child", oldChild[_nidSym]) === "true";
    if (!removed) throw new DOMException("The node could not be replaced.", "NotFoundError");
    _seedUnchangedConnection(this, parentConnected);
    _seedInsertedTreeState(newChild, this, parentConnected);
    _seedDetachedTreeState(oldChild);
    _subtreeDisconnected(oldChild);
    _registerWindowNamedTree(newChild);
    _reconcileWindowNamedProperties(removedWindowNames);
    __prepareInsertedSubtree(newChild);
    return oldChild;
  }
  insertBefore(n, ref) {
    if (!n) return n;
    if (!ref) { this.appendChild(n); return n; }
    if (ref.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'insertBefore' on 'Node': The reference node is not a child of this node.",
        "NotFoundError",
      );
    }
    if (n === ref) return n;
    if (n instanceof DocumentFragment) {
      const children = Array.from(n.childNodes);
      for (const child of children) this.insertBefore(child, ref);
      return n;
    }
    if (n._shadowParent) n._shadowParent.removeChild(n);
    else if (n.parentNode) _subtreeDisconnected(n);
    const parentConnected = this.isConnected;
    const inserted = _dom("insert_before", n[_nidSym], ref[_nidSym]) === "true";
    if (!inserted) {
      throw new DOMException(
        "Failed to execute 'insertBefore' on 'Node': The new child would create an invalid tree.",
        "HierarchyRequestError",
      );
    }
    _seedUnchangedConnection(this, parentConnected);
    _seedInsertedTreeState(n, this, parentConnected);
    _registerWindowNamedTree(n);
    __prepareInsertedSubtree(n);
    return n;
  }
  contains(o) {
    if (!o) return false;
    if (o === this) return true;
    const owner = _detachedOwnerForNode(this);
    if (owner && owner === this && _detachedOwnerForNode(o) === owner) return true;
    return _dom("contains", this[_nidSym], o[_nidSym]) === "true";
  }
  hasChildNodes() {
    const owner = _detachedOwnerForNode(this);
    if (owner && owner === this) return !!this.documentElement;
    return _dom("has_child_nodes", this[_nidSym]) === "true";
  }
  cloneNode(deep) {
    const t = this.nodeType;
    if (t === 1) {
      return _wrap(+_dom("clone_node", this[_nidSym], deep ? "true" : "false"));
    }
    // Clone structurally via real DOM nodes rather than round-tripping through a
    // throwaway <div>.innerHTML: the fragment parser discards elements that are
    // not valid children of <div> (<tr>, <td>, <option>, …), so the old path
    // returned null for them and lost JS-set inline styles. Building each node
    // directly with createElement(NS) + attribute copy avoids any parsing
    // context, and an explicit stack keeps a deep subtree from overflowing the
    // JS stack (issue #490).
    const root = _shallowCloneNode(this);
    if (!deep || !root) return root;
    const stack = [[this, root]];
    while (stack.length) {
      const [src, dst] = stack.pop();
      // A <template>'s children hang off its content fragment, not childNodes,
      // so clone them into the clone's fragment. Gated on the tag name because
      // .content means something else on other elements (e.g. <meta>).
      if (src.localName === 'template' && dst.localName === 'template') {
        const sc = src.content, dc = dst.content;
        if (sc && dc && sc.childNodes) {
          const tk = sc.childNodes;
          for (let i = 0; i < tk.length; i++) {
            const c = _shallowCloneNode(tk[i]);
            if (c) { dc.appendChild(c); stack.push([tk[i], c]); }
          }
        }
      }
      const kids = src.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = _shallowCloneNode(kids[i]);
        if (c) { dst.appendChild(c); stack.push([kids[i], c]); }
      }
    }
    return root;
  }
  compareDocumentPosition(other) {
    if (!other) return 0;
    if (this === other) return 0;
    const thisOwner = _detachedOwnerForNode(this);
    const otherOwner = _detachedOwnerForNode(other);
    if (thisOwner && thisOwner === otherOwner) {
      if (this === thisOwner) return 16 | 4;
      if (other === thisOwner) return 8 | 2;
    }
    if (this[_nidSym] !== undefined && this[_nidSym] === other[_nidSym]) return 0;
    // Different roots: DISCONNECTED | IMPLEMENTATION_SPECIFIC plus a stable
    // (consistent across calls) PRECEDING/FOLLOWING bit, chosen by node-id order.
    if (+_dom("node_root", this[_nidSym]) !== +_dom("node_root", other[_nidSym])) {
      return 1 | 32 | ((this[_nidSym] < other[_nidSym]) ? 4 : 2);
    }
    if (this.contains(other)) return 16 | 4;          // CONTAINED_BY | FOLLOWING
    if (other.contains && other.contains(this)) return 8 | 2; // CONTAINS | PRECEDING
    // Same root, neither contains the other: real tree order (compare_order op:
    // -1 => this precedes other => other FOLLOWS this(4); +1 => this PRECEDING(2)).
    return (+_dom("compare_order", this[_nidSym], other[_nidSym]) < 0) ? 4 : 2;
  }
  getRootNode(options) {
    const detachedOwner = _detachedOwnerForNode(this);
    if (detachedOwner) return detachedOwner;
    const root = _wrap(+_dom("node_root", this[_nidSym]));
    if (options?.composed && root instanceof ShadowRoot) {
      return root.host.getRootNode(options);
    }
    return root;
  }
  get isConnected() {
    if (this._treeDetachedExact) return false;
    if (this._treeConnectedEpoch === _treeMutationEpoch) return this._treeConnected;
    const connected = _dom("is_connected", this[_nidSym]) === "true";
    this._treeConnected = connected;
    this._treeConnectedEpoch = _treeMutationEpoch;
    return connected;
  }
  normalize() {
    // Merge adjacent exclusive Text nodes, drop empty ones, recurse. Detached
    // removed nodes keep their own data (read from the backing node by nid).
    let child = this.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (child.nodeType === 3) {
        let data = child.data, sib = child.nextSibling;
        while (sib && sib.nodeType === 3) { const after = sib.nextSibling; data += sib.data; this.removeChild(sib); sib = after; }
        if (data.length === 0) { this.removeChild(child); child = sib; continue; }
        if (data !== child.data) child.data = data;
        child = sib; continue;
      } else if (child.nodeType === 1 || child.nodeType === 11) {
        child.normalize();
      }
      child = next;
    }
  }
  isEqualNode(other) {
    if (!other) return false;
    if (this === other) return true;
    if (this[_nidSym] !== undefined && this[_nidSym] === other[_nidSym]) return true;
    if (this.nodeType !== other.nodeType) return false;
    if (this.nodeName !== other.nodeName) return false;
    if (this.nodeValue !== other.nodeValue) return false;
    const a = this.attributes ? this.attributes : null;
    const b = other.attributes ? other.attributes : null;
    if ((a && a.length) || (b && b.length)) {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (other.getAttribute(a[i].name) !== a[i].value) return false;
      }
    }
    const cA = this.childNodes || [];
    const cB = other.childNodes || [];
    if (cA.length !== cB.length) return false;
    for (let i = 0; i < cA.length; i++) {
      if (!cA[i].isEqualNode(cB[i])) return false;
    }
    return true;
  }
  isSameNode(other) {
    return !!other && (other === this
      || (this[_nidSym] !== undefined && this[_nidSym] === other[_nidSym]));
  }
}
class CharacterData extends Node {
  get data() {
    return _domParse("text_content", this[_nidSym]) ?? "";
  }
  set data(v) {
    const oldValue = _domParse("text_content", this[_nidSym]) ?? "";
    _dom("set_text_content", this[_nidSym], String(v ?? ""));
    if (globalThis.__mutationObservers?.length) {
      globalThis.__notifyMutation('characterData', this[_nidSym], [], [], null, oldValue);
    }
  }
  get length() { return this.data.length; }
  substringData(offset, count) {
    return this.data.substring(offset, offset + count);
  }
  appendData(s) { this.data += s; }
  insertData(offset, s) {
    const d = this.data;
    this.data = d.slice(0, offset) + s + d.slice(offset);
  }
  deleteData(offset, count) {
    const d = this.data;
    this.data = d.slice(0, offset) + d.slice(offset + count);
  }
  replaceData(offset, count, s) {
    const d = this.data;
    this.data = d.slice(0, offset) + s + d.slice(offset + count);
  }
}

class Text extends CharacterData {
  get nodeName() { return "#text"; }
  get nodeType() { return 3; }
  get wholeText() { return this.data; }
  splitText(offset) {
    const d = this.data;
    const tail = d.substring(offset);
    this.data = d.substring(0, offset);
    const newNid = +_dom("create_text_node", tail);
    const parent = this.parentNode;
    if (parent) {
      const ref = this.nextSibling;
      parent.insertBefore(_wrap(newNid), ref);
    }
    return _wrap(newNid);
  }
  cloneNode() { return document.createTextNode(this.data); }
}

class Comment extends CharacterData {
  get nodeName() { return "#comment"; }
  get nodeType() { return 8; }
  cloneNode() { return document.createComment(this.data); }
}

