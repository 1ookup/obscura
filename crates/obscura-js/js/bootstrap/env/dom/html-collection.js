class HTMLCollection {
  constructor(key = undefined, values = undefined) {
    if (key !== _htmlCollectionKey) {
      throw new TypeError("Failed to construct 'HTMLCollection': Illegal constructor");
    }
    _htmlCollectionValues.set(this, values || []);
  }
  get length() {
    return _htmlCollectionData(this).length;
  }
  item(i) {
    i = i >>> 0;
    const values = _htmlCollectionData(this);
    return values[i] != null ? values[i] : null;
  }
  namedItem(name) {
    const values = _htmlCollectionData(this);
    if (name === undefined || name === null || name === "") return null;
    name = String(name);
    for (let i = 0; i < values.length; i++) {
      const el = values[i];
      if (!el) continue;
      // id always contributes; name only for HTML elements in HTML documents.
      if (el.id === name) return el;
      if (_isHTMLEl(el) && typeof el.getAttribute === "function" && el.getAttribute("name") === name) return el;
    }
    return null;
  }
  *[Symbol.iterator]() {
    const values = _htmlCollectionData(this);
    yield* values;
  }
  get [Symbol.toStringTag]() { return 'HTMLCollection'; }
}

globalThis.HTMLCollection = HTMLCollection;
_markNative(HTMLCollection.prototype.item);
_markNative(HTMLCollection.prototype.namedItem);
