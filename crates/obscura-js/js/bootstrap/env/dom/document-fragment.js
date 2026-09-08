class DocumentFragment extends Node {
  constructor(nid) {
    const created = nid === undefined;
    super(created ? +_dom("create_document_fragment") : nid);
    if (created) _seedDetachedTreeState(this);
  }
  get nodeType() { return 11; }
  get nodeName() { return "#document-fragment"; }
  get innerHTML() { return _domParse("inner_html", this[_nidSym]) ?? ""; }
  set innerHTML(v) {
    const html = globalThis.__obscura_tt_enforce('TrustedHTML', v, 'Element innerHTML');
    if (this._fragmentContext) {
      _dom("set_inner_html_context", this[_nidSym], _fragmentContextPayload(this._fragmentContext, html));
    } else {
      _dom("set_inner_html", this[_nidSym], html);
    }
  }
  querySelector(s) { return _wrapEl(+_dom("query_selector_scoped", this[_nidSym], s)); }
  querySelectorAll(s) {
    const ids = _domParse("query_selector_all_scoped", this[_nidSym], s) || [];
    return _nodeList(ids.map(_wrapEl).filter(Boolean));
  }
  get children() {
    const ids = _domParse("element_children", this[_nidSym]) || [];
    return _htmlCollectionFrom(ids.map(_wrapEl).filter(Boolean));
  }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const ch = this.children; return ch[ch.length - 1] || null; }
  getElementById(id) {
    const needle = String(id);
    const stack = Array.from(this.childNodes || []).reverse();
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.nodeType === 1 && node.id === needle) return node;
      const children = node.childNodes || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return null;
  }
  cloneNode(deep) {
    const nid = +_dom("clone_node", this[_nidSym], deep ? "true" : "false");
    const frag = new DocumentFragment(nid);
    _cache.set(nid, frag);
    return frag;
  }
}
