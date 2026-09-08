class CSSRuleList {
  constructor(sheet) {
    this._sheet = sheet;
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
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
          const value = target.item(+property);
          return value ? { value, writable: false, enumerable: true, configurable: true } : undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
  }
  get length() { this._sheet._refreshFromOwner(); return this._sheet._rules.length; }
  item(index) {
    this._sheet._refreshFromOwner();
    return this._sheet._rules[index >>> 0] || null;
  }
  forEach(callback, thisArg) {
    for (let i = 0; i < this.length; i++) callback.call(thisArg, this.item(i), i, this);
  }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.item(i); }
}
globalThis.CSSRuleList = CSSRuleList;
