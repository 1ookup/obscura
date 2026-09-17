class HTMLObjectElement extends Element {
  get data() {
    const raw = this.getAttribute('data');
    if (!raw) return '';
    try { return new URL(raw, this.baseURI || globalThis.location?.href || 'about:blank').href; }
    catch (_error) { return raw; }
  }
  set data(value) { this.setAttribute('data', value); }
  get contentDocument() {
    const resolved = this.data;
    return resolved && _cspResourceAllows(resolved, 'object-src') ? null : null;
  }
  get contentWindow() { return null; }
}
