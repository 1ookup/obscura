class StyleSheetList {
  constructor(root) {
    this._root = root;
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          return target.item(+property) || undefined;
        }
        return Reflect.get(target, property, receiver);
      },
      has(target, property) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          return +property < target.length;
        }
        return Reflect.has(target, property);
      },
    });
  }
  _sheets() {
    const nodes = this._root.querySelectorAll
      ? _internalQuerySelectorAll(this._root, 'style, link[rel~="stylesheet"]')
      : [];
    const out = [];
    for (const style of nodes) {
      if (style.localName === "link") {
        const sheet = _sheetForLinkElement(style);
        if (sheet) out.push(sheet);
        continue;
      }
      if (_styleElementIsCssomBridge(style)) continue;
      const sheet = _sheetForStyleElement(style);
      if (sheet) out.push(sheet);
    }
    return out;
  }
  get length() { return this._sheets().length; }
  item(index) { return this._sheets()[index >>> 0] || null; }
  forEach(callback, thisArg) {
    const sheets = this._sheets();
    sheets.forEach((sheet, index) => callback.call(thisArg, sheet, index, this));
  }
  *[Symbol.iterator]() { yield* this._sheets(); }
}

Object.defineProperty(Element.prototype, "sheet", {
  get() {
    if (this.localName === "style") return _sheetForStyleElement(this);
    if (this.localName === "link") return _sheetForLinkElement(this);
    return null;
  },
  configurable: true,
});
globalThis.CSSRule = CSSRule;
globalThis.CSSStyleRule = CSSStyleRule;
globalThis.CSSRuleList = CSSRuleList;
globalThis.CSSStyleSheet = CSSStyleSheet;
globalThis.StyleSheetList = StyleSheetList;
globalThis.StyleSheetList = StyleSheetList;
