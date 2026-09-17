const _HTML_ALL_OWN_KEYS = new Set(['length', 'item', 'namedItem']);
globalThis.HTMLAllCollection = class HTMLAllCollection {
  constructor() { throw new TypeError('Illegal constructor'); }
  get [Symbol.toStringTag]() { return 'HTMLAllCollection'; }
};
function _documentAllElements() {
  // Document order, starting at <html>, which is what the collection is.
  return _internalQuerySelectorAll(globalThis.document, '*');
}
// A name matches an element's id, or its name attribute on the elements where
// that is a named-access surface.
function _documentAllNamed(elements, key) {
  const named = [];
  for (const element of elements) {
    if (element.getAttribute('id') === key) { named.push(element); continue; }
    const local = element.localName;
    if ((local === 'a' || local === 'applet' || local === 'area' || local === 'embed'
      || local === 'form' || local === 'frame' || local === 'frameset'
      || local === 'iframe' || local === 'img' || local === 'object')
      && element.getAttribute('name') === key) {
      named.push(element);
    }
  }
  if (!named.length) return undefined;
  // One match answers with the element; several answer with a collection, as
  // named access does everywhere else.
  return named.length === 1 ? named[0] : _htmlCollectionFrom(named);
}
globalThis.__obscura_document_all_resolve = function (kind, key) {
  try {
    if (kind === 'index') {
      const elements = _documentAllElements();
      const index = +key;
      return index >= 0 && index < elements.length ? [elements[index]] : undefined;
    }
    if (kind === 'call') {
      // `document.all(x)` is `document.all[x]` for an index, and named access
      // otherwise; with no argument at all it is null.
      if (key === undefined) return [null];
      const elements = _documentAllElements();
      if (typeof key === 'number' || /^[0-9]+$/.test(String(key))) {
        const index = +key;
        return [index >= 0 && index < elements.length ? elements[index] : null];
      }
      const named = _documentAllNamed(elements, String(key));
      return [named === undefined ? null : named];
    }
    const name = String(key);
    if (name === 'length') return [_documentAllElements().length];
    if (name === 'item') {
      return [_markNative(function item(index) {
        const elements = _documentAllElements();
        if (arguments.length === 0) {
          throw new TypeError(
            "Failed to execute 'item' on 'HTMLAllCollection': 1 argument required, but only 0 present.");
        }
        if (typeof index === 'string' && !/^[0-9]+$/.test(index)) {
          const named = _documentAllNamed(elements, index);
          return named === undefined ? null : named;
        }
        const at = +index;
        return at >= 0 && at < elements.length ? elements[at] : null;
      })];
    }
    if (name === 'namedItem') {
      return [_markNative(function namedItem(key2) {
        const named = _documentAllNamed(_documentAllElements(), String(key2));
        return named === undefined ? null : named;
      })];
    }
    // A digit string is an index however it arrives.
    if (/^(?:0|[1-9][0-9]*)$/.test(name)) {
      const elements = _documentAllElements();
      const index = +name;
      return index < elements.length ? [elements[index]] : undefined;
    }
    // Anything the collection does not own is left to the prototype chain, so
    // `constructor`, `toString` and the rest keep working.
    if (_HTML_ALL_OWN_KEYS.has(name)) return undefined;
    const named = _documentAllNamed(_documentAllElements(), name);
    return named === undefined ? undefined : [named];
  } catch (_error) {
    return undefined;
  }
};

