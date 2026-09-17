// Window named properties behavior. The V8 global cannot be replaced with a
// WindowProxy after snapshot startup, so live accessors are installed on the
// Window prototype as elements enter/leave the document tree.
const _windowNamedPropertyNames = new Set();
const _windowNamedNameTags = new Set(['embed', 'form', 'iframe', 'img', 'object']);

function _windowNameEligibleElement(element) {
  return !!element
    && element.namespaceURI === 'http://www.w3.org/1999/xhtml'
    && _windowNamedNameTags.has(element.localName);
}

function _windowNamedSupportedNames(element) {
  const names = [];
  if (!element || element.nodeType !== 1) return names;
  const id = element.getAttribute('id');
  if (id) names.push(id);
  if (_windowNameEligibleElement(element)) {
    const name = element.getAttribute('name');
    if (name && name !== id) names.push(name);
  }
  return names;
}

// Engine-internal selector queries bypass the public querySelector methods so
// page instrumentation cannot observe the engine's own named-property scans.
function _internalQuerySelectorAll(root, selector) {
  const nid = root && typeof root[_nidSym] === 'number'
    ? root[_nidSym]
    : (root === globalThis.document ? _documentRootNid() : null);
  if (nid === null) return [];
  const ids = _domParse('query_selector_all_scoped', nid, selector) || [];
  const elements = [];
  for (const id of ids) {
    const element = _wrapEl(id);
    if (element) elements.push(element);
  }
  return elements;
}
function _internalQuerySelector(root, selector) {
  return _internalQuerySelectorAll(root, selector)[0] || null;
}
function _documentRootNid() {
  const scoped = globalThis.__obscura_frame_document_nid;
  return typeof scoped === 'number' ? scoped : 0;
}

function _windowNamedCandidates(name) {
  const document = globalThis.document;
  if (!document || !name) return [];
  const elements = _internalQuerySelectorAll(
    document, '[id],embed[name],form[name],iframe[name],img[name],object[name]');
  const matches = [];
  for (const element of elements) {
    if (element.getAttribute('id') === name
        || (_windowNameEligibleElement(element) && element.getAttribute('name') === name)) {
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
  return element.localName === 'iframe' && element.contentWindow
    ? element.contentWindow
    : element;
}

function _ensureWindowNamedProperty(name) {
  name = String(name || '');
  if (!name || _windowNamedPropertyNames.has(name)) return;
  if (Object.prototype.hasOwnProperty.call(globalThis, name)) return;
  const holder = globalThis.Window?.prototype || Object.getPrototypeOf(globalThis);
  if (!holder || Object.prototype.hasOwnProperty.call(holder, name)) return;
  try {
    Object.defineProperty(holder, name, {
      get() { return _windowNamedValue(name); }, configurable: true, enumerable: false,
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
  if (typeof root.querySelectorAll === 'function') {
    const elements = _internalQuerySelectorAll(
      root, '[id],embed[name],form[name],iframe[name],img[name],object[name]');
    for (const element of elements) {
      for (const name of _windowNamedSupportedNames(element)) names.add(name);
    }
  }
  return names;
}
function _registerWindowNamedTree(root) {
  if (!root || !root.isConnected || root.getRootNode() !== globalThis.document) return;
  for (const name of _windowNamedNamesInTree(root)) _ensureWindowNamedProperty(name);
}
function _reconcileWindowNamedProperties(names) {
  if (!names || names.size === 0) return;
  const document = globalThis.document;
  if (!document) return;
  const present = new Set();
  const elements = _internalQuerySelectorAll(
    document, '[id],embed[name],form[name],iframe[name],img[name],object[name]');
  for (const element of elements) {
    for (const name of _windowNamedSupportedNames(element)) {
      if (names.has(name)) present.add(name);
    }
  }
  for (const name of names) {
    if (_windowNamedPropertyNames.has(name) && !present.has(name)) {
      _reconcileWindowNamedProperty(name);
    }
  }
}
