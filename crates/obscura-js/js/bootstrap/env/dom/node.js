// During custom-element upgrade, HTMLElement's constructor must return the
// already-existing element being upgraded. A class constructor cannot be
// invoked with `.call(existingElement)`, so the registry and Element
// constructor coordinate through the same construction-stack shape used by
// browser custom-element implementations.
const _customElementConstructionStack = [];

// Elements whose `nonce` was assigned through the IDL attribute. Chrome keeps
// that value in an internal slot: the content attribute is never created or
// updated, so `getAttribute("nonce")` stays null and the attribute is absent
// from `attributes`. The native CSP nonce gate still reads the content
// attribute, so the setter mirrors the value there and this map is what tells
// the JS-visible attribute surface to hide it.
const _idlNonce = new WeakMap();

// Scripts whose `async` was explicitly assigned `false`. A non-parser-inserted
// classic script is force-async unless the page opted out this way, and once
// `async` reflects the content attribute the opt-out can no longer be read
// back from the element.
const _scriptAsyncOptOut = new WeakSet();

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
    const explicitlyInOrder = !isModule && _scriptAsyncOptOut.has(script);
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
    _queueIframeNavigation(root[_nidSym]);
  }
  // Shadow-piercing on purpose. A selector query stops at a shadow boundary,
  // so an iframe inside a shadow root -- how widget embeds are built, Turnstile
  // among them -- was never queued when its host was connected, and the
  // browsing context that its `src` had already asked for was dropped for
  // having no frame yet. Nothing re-queued it, so the frame stayed empty.
  const iframeIds = _domParse("iframe_hosts_including_shadow", root[_nidSym], "") || [];
  for (const nid of iframeIds) {
    _dom("create_blank_iframe_document", +nid);
    _queueIframeNavigation(+nid);
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
