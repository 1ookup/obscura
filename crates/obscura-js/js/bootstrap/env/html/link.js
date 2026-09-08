const _linkConstructionKey = Symbol('HTMLLinkElement construction');
class HTMLLinkElement extends Element {
  constructor(...args) {
    if (args.length !== 2 || args[1] !== _linkConstructionKey) {
      throw new TypeError("Failed to construct 'HTMLLinkElement': Illegal constructor");
    }
    super(args[0]);
  }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) {
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
  get href() {
    const raw = this.getAttribute('href');
    if (raw === null) return '';
    const resolved = _urlResolveOp(raw, _anchorBase());
    return resolved === null ? raw : resolved;
  }
  set href(value) { this.setAttribute('href', value); }
  get crossOrigin() { return this.getAttribute('crossorigin'); }
  set crossOrigin(value) {
    if (value === null || value === undefined) this.removeAttribute('crossorigin');
    else this.setAttribute('crossorigin', String(value));
  }
  get rel() { return this.getAttribute('rel') || ''; }
  set rel(value) { this.setAttribute('rel', String(value)); }
  get relList() {
    return Object.getOwnPropertyDescriptor(Element.prototype, 'relList').get.call(this);
  }
  get media() { return this.getAttribute('media') || ''; }
  set media(value) { this.setAttribute('media', String(value)); }
  get as() { return this.getAttribute('as') || ''; }
  set as(value) { this.setAttribute('as', String(value)); }
  get type() { return this.getAttribute('type') || ''; }
  set type(value) { this.setAttribute('type', String(value)); }
  get hreflang() { return this.getAttribute('hreflang') || ''; }
  set hreflang(value) { this.setAttribute('hreflang', String(value)); }
  get referrerPolicy() { return this.getAttribute('referrerpolicy') || ''; }
  set referrerPolicy(value) { this.setAttribute('referrerpolicy', String(value)); }
  get fetchPriority() { return this.getAttribute('fetchpriority') || 'auto'; }
  set fetchPriority(value) { this.setAttribute('fetchpriority', String(value)); }
  get sizes() {
    return Object.getOwnPropertyDescriptor(Element.prototype, 'sizes').get.call(this);
  }
  get target() { return this.getAttribute('target') || ''; }
  set target(value) { this.setAttribute('target', String(value)); }
  get sheet() {
    return Object.getOwnPropertyDescriptor(Element.prototype, 'sheet').get.call(this);
  }
  get integrity() { return this.getAttribute('integrity') || ''; }
  set integrity(value) { this.setAttribute('integrity', String(value)); }
  get blocking() { return this.getAttribute('blocking') || ''; }
  set blocking(value) { this.setAttribute('blocking', String(value)); }
  get imageSrcset() { return this.getAttribute('imagesrcset') || ''; }
  set imageSrcset(value) { this.setAttribute('imagesrcset', String(value)); }
  get imageSizes() { return this.getAttribute('imagesizes') || ''; }
  set imageSizes(value) { this.setAttribute('imagesizes', String(value)); }
  get charset() { return this.getAttribute('charset') || ''; }
  set charset(value) { this.setAttribute('charset', String(value)); }
  get rev() { return this.getAttribute('rev') || ''; }
  set rev(value) { this.setAttribute('rev', String(value)); }
  get [Symbol.toStringTag]() { return 'HTMLLinkElement'; }
}
_markNative(HTMLLinkElement);
for (const name of Object.getOwnPropertyNames(HTMLLinkElement.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, name);
  if (descriptor?.get) _markNative(descriptor.get);
  if (descriptor?.set) _markNative(descriptor.set);
  if (descriptor?.value) _markNative(descriptor.value);
}
