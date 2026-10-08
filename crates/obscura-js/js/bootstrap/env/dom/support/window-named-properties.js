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
  if (element.localName === 'iframe') {
    // Chrome answers the frame's WindowProxy -- never the element, and never
    // a throw for a not-yet-realized frame. The proxy helper materializes
    // the realm facade when the contentWindow getter cannot.
    try {
      const win = element.contentWindow;
      if (win) return win;
    } catch (_error) {}
    try {
      const nid = element[Symbol.for('obscura.nid')];
      if (nid && typeof _frameWindowProxyFor === 'function') {
        return _frameWindowProxyFor(element);
      }
    } catch (_error) {}
  }
  return element;
}

// Named properties are served dynamically through the WindowProperties
// prototype level (the proxy consults the live document tree per read), so
// unlike the old per-name accessor install there is nothing to define on
// Window.prototype -- whose own surface stays byte-equal to Chrome's
// (TEMPORARY/PERSISTENT/constructor only, measured Chromium 149). The set
// keeps the name bookkeeping the reconcile/page-init callers rely on.
function _ensureWindowNamedProperty(name) {
  name = String(name || '');
  if (!name || _windowNamedPropertyNames.has(name)) return;
  if (Object.prototype.hasOwnProperty.call(globalThis, name)) return;
  const level = _windowPropertiesLevel();
  if (!level || Object.prototype.hasOwnProperty.call(level, name)) return;
  try {
    // Installed lazily per named element at arbitrary page times, long after
    // the finalize sweeps, so the accessor carries its own mark. Chrome
    // renders the WebIDL accessor as "function get <name>() { [native code] }".
    Object.defineProperty(level, name, {
      get: _markNativeAs(function () { return _windowNamedValue(name); },
        'function get ' + name + '() { [native code] }'),
      configurable: true, enumerable: false,
    });
    _windowNamedPropertyNames.add(name);
  } catch (_error) {}
}
function _reconcileWindowNamedProperty(name) {
  if (!_windowNamedPropertyNames.has(name)) return;
  if (_windowNamedCandidates(name).length !== 0) return;
  const level = _windowPropertiesLevelInstance;
  try { if (level) delete level[name]; } catch (_error) {}
  _windowNamedPropertyNames.delete(name);
}

// The WindowProperties prototype level: sits between Window.prototype and
// EventTarget.prototype, exactly where Chromium's chain has it (window ->
// Window.prototype -> WindowProperties.prototype -> EventTarget.prototype ->
// Object.prototype; the level's own surface is empty -- named properties are
// answered dynamically, invisible to getOwnPropertyNames at every level).
// The iframe candidate returns the frame's WindowProxy; a frame whose
// content window is not realized yet answers its element instead of
// throwing (reading window.<iframe id> used to throw here).
// A plain prototype object, not a proxy: a trapped `has` on the global's
// prototype chain participates in V8 global declaration resolution and flips
// strict-mode undeclared assignments (the secondary-realm test caught it).
// Named accessors are defined per name on this level; unregistered names stay
// invisible, so global binding semantics are untouched.
let _windowPropertiesLevelInstance = null;
function _windowPropertiesLevel() {
  if (_windowPropertiesLevelInstance) return _windowPropertiesLevelInstance;
  // A plain prototype object: a proxy here (even get-only) participates in V8
  // global declaration resolution and flips strict-mode undeclared assignments
  // (the secondary-realm test caught it). Named accessors are defined per name
  // on this level instead of Window.prototype, so Window.prototype's own
  // surface stays the Chrome 149 three-member set; the level accumulates the
  // page's named elements where Chromium answers them dynamically -- a bounded,
  // known divergence at exactly one depth.
  const level = Object.create(globalThis.EventTarget.prototype);
  _windowPropertiesLevelInstance = level;
  Object.setPrototypeOf(globalThis.Window.prototype, level);
  return level;
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
