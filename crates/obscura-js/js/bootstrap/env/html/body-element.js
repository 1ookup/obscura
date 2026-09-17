class HTMLBodyElement extends HTMLElement {
  constructor(nid, key) {
    // Internal wrappers pass the node id as the sole argument. Script-level
    // construction remains illegal, matching the native interface.
    if (arguments.length !== 1 || nid === undefined) {
      throw new TypeError("Failed to construct 'HTMLBodyElement': Illegal constructor");
    }
    super(nid);
  }
  get [Symbol.toStringTag]() { return 'HTMLBodyElement'; }
}
globalThis.HTMLBodyElement = HTMLBodyElement;
Object.defineProperty(HTMLBodyElement, 'length', { value: 0, configurable: true });
_markNative(HTMLBodyElement);
_markNative(Object.getOwnPropertyDescriptor(HTMLBodyElement.prototype, Symbol.toStringTag).get);
