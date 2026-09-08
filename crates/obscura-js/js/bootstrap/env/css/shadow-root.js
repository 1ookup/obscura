globalThis.ShadowRoot = class ShadowRoot extends DocumentFragment {
  constructor(nid, host, options) {
    super(nid);
    this._host = host;
    this._mode = options.mode;
    this._delegatesFocus = !!options.delegatesFocus;
    this._slotAssignment = options.slotAssignment === 'manual' ? 'manual' : 'named';
    this._clonable = !!options.clonable;
    this._serializable = !!options.serializable;
    const registry = options.customElementRegistry;
    _shadowCustomElementRegistries.set(
      this,
      registry instanceof CustomElementRegistry ? registry : globalThis.customElements,
    );
  }
  get host() { return this._host; }
  get mode() { return this._mode; }
  get delegatesFocus() { return this._delegatesFocus; }
  get slotAssignment() { return this._slotAssignment; }
  get clonable() { return this._clonable; }
  get serializable() { return this._serializable; }
  get customElementRegistry() { return _shadowCustomElementRegistries.get(this) || null; }
  _assertInsertable(node, operation) {
    const createsComposedCycle = node instanceof ShadowRoot
      || node === this._host
      || !!(node?.contains && node.contains(this._host));
    if (createsComposedCycle) {
      throw new DOMException(
        `Failed to execute '${operation}' on 'Node': The new child would contain the parent.`,
        'HierarchyRequestError'
      );
    }
  }
  appendChild(child) {
    this._assertInsertable(child, 'appendChild');
    return super.appendChild(child);
  }
  insertBefore(node, reference) {
    if (reference && reference.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'insertBefore' on 'Node': The reference node is not a child of this node.",
        'NotFoundError'
      );
    }
    if (node === reference) return node;
    this._assertInsertable(node, 'insertBefore');
    return super.insertBefore(node, reference);
  }
  removeChild(child) {
    if (!child || child.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        'NotFoundError'
      );
    }
    return super.removeChild(child);
  }
  replaceChild(node, oldChild) {
    if (!oldChild || oldChild.parentNode !== this) {
      throw new DOMException(
        "Failed to execute 'replaceChild' on 'Node': The node to be replaced is not a child of this node.",
        'NotFoundError'
      );
    }
    if (node === oldChild) return oldChild;
    this._assertInsertable(node, 'replaceChild');
    return super.replaceChild(node, oldChild);
  }
  getRootNode(options) {
    return options?.composed ? this._host.getRootNode(options) : this;
  }
  get activeElement() { return null; }
  get styleSheets() {
    if (!this[_styleSheetListSym]) this[_styleSheetListSym] = new StyleSheetList(this);
    return this[_styleSheetListSym];
  }
  cloneNode() {
    throw new DOMException(
      'Failed to execute cloneNode on Node: ShadowRoot nodes are not clonable.',
      'NotSupportedError'
    );
  }
  setHTMLUnsafe(value) { this.innerHTML = String(value == null ? '' : value); }
  getHTML() { return this.innerHTML; }
};
