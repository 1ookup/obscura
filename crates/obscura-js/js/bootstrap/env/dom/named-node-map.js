class NamedNodeMap {
  constructor(element) {
    Object.defineProperty(this, "_element", {
      value: element,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && /^(?:0|[1-9]\d*)$/.test(prop)) {
          return target.item(+prop);
        }
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        if (typeof prop === "string") return target.getNamedItem(prop);
        return undefined;
      },
      ownKeys(target) {
        const names = target._names();
        return Reflect.ownKeys(target).concat(
          names.map((_, i) => String(i)),
          names.filter((name) => !Reflect.has(target, name))
        );
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === "string" && (/^(?:0|[1-9]\d*)$/.test(prop) || target._names().includes(prop))) {
          return { configurable: true, enumerable: true, value: target[prop], writable: false };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });
  }
  _names() {
    return _domParse("attribute_names", this._element[_nidSym]) || [];
  }
  _attr(name) {
    const value = this._element.getAttribute(name);
    if (value === null) return null;
    const attr = new Attr(name, value, null, null);
    attr.ownerElement = this._element;
    return attr;
  }
  get length() { return this._names().length; }
  item(index) {
    const name = this._names()[Number(index)];
    return name === undefined ? null : this._attr(name);
  }
  getNamedItem(name) {
    name = String(name);
    return this._names().includes(name) ? this._attr(name) : null;
  }
  getNamedItemNS(namespaceURI, localName) {
    return this.getNamedItem(localName);
  }
  setNamedItem(attr) {
    if (!attr || typeof attr.name !== "string") return null;
    return this._element.setAttributeNode(attr);
  }
  setNamedItemNS(attr) { return this.setNamedItem(attr); }
  removeNamedItem(name) {
    const attr = this.getNamedItem(name);
    if (!attr) throw new DOMException("Attribute not found", "NotFoundError");
    return this._element.removeAttributeNode(attr);
  }
  removeNamedItemNS(namespaceURI, localName) {
    return this.removeNamedItem(localName);
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.item(i);
  }
}
globalThis.NamedNodeMap = NamedNodeMap;
