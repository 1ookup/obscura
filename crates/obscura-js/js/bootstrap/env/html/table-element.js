// HTMLTableElement IDL: rows/tBodies/tHead/tFoot/caption collections and the
// create* factories. The interface class comes from webidl-branding; this
// module adds the table-specific surface its census row declares. Row and
// section collections are filtered to this table's own subtree so nested
// tables do not leak their rows into the outer table's `rows`.
(function () {
  const proto = globalThis.HTMLTableElement
    && globalThis.HTMLTableElement.prototype;
  if (!proto || proto === globalThis.Element.prototype) return;

  function ownedTrs(table) {
    const all = table.getElementsByTagName('tr');
    const owned = [];
    for (let i = 0; i < all.length; i++) {
      let p = all[i].parentElement;
      while (p && p !== table) {
        if (p.tagName === 'TABLE') break;
        p = p.parentElement;
      }
      if (p === table) owned.push(all[i]);
    }
    return owned;
  }

  function firstChildElement(table, tag) {
    const children = table.children || [];
    for (let i = 0; i < children.length; i++) {
      if (children[i].tagName === tag.toUpperCase()) return children[i];
    }
    return null;
  }

  Object.defineProperty(proto, 'rows', {
    get: _markNative(function rows() {
      return _htmlCollectionFrom(ownedTrs(this).filter(tr =>
        tr.parentElement && tr.parentElement.tagName !== 'TABLE'));
    }),
    configurable: true, enumerable: true,
  });
  Object.defineProperty(proto, 'tBodies', {
    get: _markNative(function tBodies() {
      const bodies = [];
      for (const child of this.children || []) {
        if (child.tagName === 'TBODY') bodies.push(child);
      }
      return _htmlCollectionFrom(bodies);
    }),
    configurable: true, enumerable: true,
  });
  Object.defineProperty(proto, 'tHead', {
    get: _markNative(function tHead() {
      for (const child of this.children || []) {
        if (child.tagName === 'THEAD') return child;
      }
      return null;
    }),
    configurable: true, enumerable: true,
  });
  Object.defineProperty(proto, 'tFoot', {
    get: _markNative(function tFoot() {
      for (const child of this.children || []) {
        if (child.tagName === 'TFOOT') return child;
      }
      return null;
    }),
    configurable: true, enumerable: true,
  });
  Object.defineProperty(proto, 'caption', {
    get: _markNative(function caption() {
      for (const child of this.children || []) {
        if (child.tagName === 'CAPTION') return child;
      }
      return null;
    }),
    configurable: true, enumerable: true,
  });
  proto.createTBody = _markNative(function createTBody() {
    const body = document.createElement('tbody');
    this.appendChild(body);
    return body;
  });
  proto.createCaption = _markNative(function createCaption() {
    const cap = document.createElement('caption');
    this.insertBefore(cap, this.firstChild);
    return cap;
  });
})();
