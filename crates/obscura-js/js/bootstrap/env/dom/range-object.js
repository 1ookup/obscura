// Range contents extraction (DOM Standard 5.3.4 clone/extract/delete). The
// engine's innerHTML parser, mutation plumbing and node identity are all real
// on both sides of the boundary, so the challenge's readback shape
// (selectNodeContents + extractContents + innerHTML of the destination) gets
// the same answer Chrome gives instead of an empty fragment. Whole nodes MOVE
// under extract so identity survives like Chrome; partial character-data
// edges split like Chrome.
function _rngContentsFragment(range, clone) {
  const sc = range._sc, ec = range._ec, so = range._so, eo = range._eo;
  const ownerDoc = (sc && sc.ownerDocument) || globalThis.document || document;
  const frag = ownerDoc.createDocumentFragment();
  if (!sc || !ec || range.collapsed) return frag;
  const textLike = (n) => n.nodeType === 3 || n.nodeType === 4;
  const adoptAll = (nodes) => {
    for (let i = 0; i < nodes.length; i++) {
      frag.appendChild(clone ? nodes[i].cloneNode(true) : nodes[i]);
    }
  };
  if (_rngSame(sc, ec)) {
    if (textLike(sc)) {
      if (clone) {
        frag.appendChild(ownerDoc.createTextNode(sc.data.slice(so, eo)));
      } else if (typeof sc.splitText === 'function') {
        const tail = so < eo ? sc.splitText(eo) : null;
        const mid = so > 0 ? (tail ? sc.splitText(so) : null) : sc;
        frag.appendChild(mid !== null && mid !== undefined ? mid : sc);
      } else {
        frag.appendChild(ownerDoc.createTextNode(sc.data.slice(so, eo)));
      }
      return frag;
    }
    adoptAll(Array.prototype.slice.call(sc.childNodes, so, eo));
    return frag;
  }
  // Different containers: partial start side, fully covered middle children
  // of the common ancestor, partial end side.
  const endAncestors = _rngAncestors(ec);
  let common = null;
  for (let a = sc; a; a = a.parentNode) {
    if (endAncestors.indexOf(a) >= 0) { common = a; break; }
  }
  if (!common) return frag;
  let startChild = sc;
  while (startChild && startChild.parentNode !== common) startChild = startChild.parentNode;
  let endChild = ec;
  while (endChild && endChild.parentNode !== common) endChild = endChild.parentNode;
  if (!startChild || !endChild) return frag;
  // Start side.
  if (textLike(sc)) {
    if (clone) frag.appendChild(ownerDoc.createTextNode(sc.data.slice(so)));
    else if (sc.nodeType === 3 && typeof sc.splitText === 'function' && so > 0) {
      frag.appendChild(sc.splitText(so));
    } else frag.appendChild(sc);
  } else if (startChild !== sc) {
    adoptAll(Array.prototype.slice.call(sc.childNodes, so));
  }
  // Middle: children of common strictly between the boundary children.
  const commonKids = Array.prototype.slice.call(common.childNodes);
  const si = commonKids.indexOf(startChild);
  const ei = commonKids.indexOf(endChild);
  if (si >= 0 && ei > si) adoptAll(commonKids.slice(si + 1, ei));
  // End side.
  if (textLike(ec)) {
    if (clone) frag.appendChild(ownerDoc.createTextNode(ec.data.slice(0, eo)));
    else if (ec.nodeType === 3 && typeof ec.splitText === 'function' && eo < _rngNodeLength(ec)) {
      // ec keeps [0, eo); the tail stays behind, ec itself moves.
      ec.splitText(eo);
      frag.appendChild(ec);
    } else frag.appendChild(ec);
  } else if (endChild !== ec) {
    adoptAll(Array.prototype.slice.call(ec.childNodes, 0, eo));
  }
  return frag;
}

globalThis.Range = class Range {
  constructor() {
    const d = globalThis.document || null;
    _hset(this, "_sc", d); _hset(this, "_so", 0); _hset(this, "_ec", d); _hset(this, "_eo", 0);
  }
  get startContainer() { return this._sc; }
  get startOffset() { return this._so; }
  get endContainer() { return this._ec; }
  get endOffset() { return this._eo; }
  get collapsed() { return _rngSame(this._sc, this._ec) && this._so === this._eo; }
  get commonAncestorContainer() {
    if (!this._sc || !this._ec) return null;
    const setA = new Set(_rngAncestors(this._sc).map(n => n[_nidSym]));
    let c = this._ec;
    while (c) { if (setA.has(c[_nidSym])) return c; c = c.parentNode; }
    return null;
  }
  setStart(n, o) { _rngCheckOffset(n, o); _hset(this, "_sc", n); _hset(this, "_so", o); if (_rngRoot(n)[_nidSym] !== _rngRoot(this._ec)[_nidSym] || _rngCmp(this._sc, this._so, this._ec, this._eo) > 0) { _hset(this, "_ec", n); _hset(this, "_eo", o); } }
  setEnd(n, o) { _rngCheckOffset(n, o); _hset(this, "_ec", n); _hset(this, "_eo", o); if (_rngRoot(n)[_nidSym] !== _rngRoot(this._sc)[_nidSym] || _rngCmp(this._sc, this._so, this._ec, this._eo) > 0) { _hset(this, "_sc", n); _hset(this, "_so", o); } }
  setStartBefore(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setStart(p, _rngNodeIndex(n)); }
  setStartAfter(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setStart(p, _rngNodeIndex(n) + 1); }
  setEndBefore(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setEnd(p, _rngNodeIndex(n)); }
  setEndAfter(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setEnd(p, _rngNodeIndex(n) + 1); }
  collapse(toStart) { if (toStart) { _hset(this, "_ec", this._sc); _hset(this, "_eo", this._so); } else { _hset(this, "_sc", this._ec); _hset(this, "_so", this._eo); } }
  selectNode(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); const i = _rngNodeIndex(n); _hset(this, "_sc", p); _hset(this, "_so", i); _hset(this, "_ec", p); _hset(this, "_eo", i + 1); }
  selectNodeContents(n) { if (n && n.nodeType === 10) throw new DOMException("cannot select a DocumentType", "InvalidNodeTypeError"); const len = _rngNodeLength(n); _hset(this, "_sc", n); _hset(this, "_so", 0); _hset(this, "_ec", n); _hset(this, "_eo", len); }
  comparePoint(n, o) {
    o = o >>> 0; // offset is a WebIDL unsigned long: -1 -> 4294967295 -> IndexSizeError
    if (_rngRoot(n)[_nidSym] !== _rngRoot(this._sc)[_nidSym]) throw new DOMException("nodes are in different trees", "WrongDocumentError");
    if (n.nodeType === 10) throw new DOMException("node is a DocumentType", "InvalidNodeTypeError");
    if (o > _rngNodeLength(n)) throw new DOMException("offset out of bounds", "IndexSizeError");
    if (_rngCmp(n, o, this._sc, this._so) < 0) return -1;
    if (_rngCmp(n, o, this._ec, this._eo) > 0) return 1;
    return 0;
  }
  isPointInRange(n, o) {
    o = o >>> 0;
    if (!this._sc || _rngRoot(n)[_nidSym] !== _rngRoot(this._sc)[_nidSym]) return false;
    if (n.nodeType === 10) throw new DOMException("node is a DocumentType", "InvalidNodeTypeError");
    if (o > _rngNodeLength(n)) throw new DOMException("offset out of bounds", "IndexSizeError");
    return _rngCmp(n, o, this._sc, this._so) >= 0 && _rngCmp(n, o, this._ec, this._eo) <= 0;
  }
  compareBoundaryPoints(how, other) {
    // `how` is a WebIDL `unsigned short`: ToUint16-convert before validating,
    // so NaN/Infinity become 0 (START_TO_START) rather than throwing.
    let h = Math.trunc(Number(how));
    if (!Number.isFinite(h)) h = 0;
    h = ((h % 65536) + 65536) % 65536;
    let a, b;
    switch (h) {
      case 0: a = [this._sc, this._so]; b = [other._sc, other._so]; break; // START_TO_START
      case 1: a = [this._ec, this._eo]; b = [other._sc, other._so]; break; // START_TO_END
      case 2: a = [this._ec, this._eo]; b = [other._ec, other._eo]; break; // END_TO_END
      case 3: a = [this._sc, this._so]; b = [other._ec, other._eo]; break; // END_TO_START
      default: throw new DOMException("invalid comparison type", "NotSupportedError");
    }
    // Different roots -> WrongDocumentError. Guard so a null/foreign container
    // raises that DOMException rather than a raw TypeError from _rngRoot.
    let differ;
    try { differ = _rngRoot(a[0])[_nidSym] !== _rngRoot(b[0])[_nidSym]; }
    catch (e) { differ = true; }
    if (differ) throw new DOMException("The two Ranges are not in the same tree.", "WrongDocumentError");
    return _rngCmp(a[0], a[1], b[0], b[1]);
  }
  intersectsNode(n) {
    if (_rngRoot(n)[_nidSym] !== _rngRoot(this._sc)[_nidSym]) return false;
    const p = n.parentNode;
    if (!p) return true;
    const o = _rngNodeIndex(n);
    return _rngCmp(p, o, this._ec, this._eo) < 0 && _rngCmp(p, o + 1, this._sc, this._so) > 0;
  }
  cloneRange() { const r = new Range(); _hset(r, "_sc", this._sc); _hset(r, "_so", this._so); _hset(r, "_ec", this._ec); _hset(r, "_eo", this._eo); return r; }
  createContextualFragment(html) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'createContextualFragment' on 'Range': 1 argument required, but only 0 present.");
    const node = this._sc;
    const ownerDoc = (node && node.ownerDocument) || globalThis.document;
    const frag = ownerDoc.createDocumentFragment();
    let context = node;
    if (context && context.nodeType !== 1) context = context.parentElement;
    if (context && context.localName === 'html') context = null;
    _dom(
      "set_fragment_html_executable",
      frag[_nidSym],
      _fragmentContextPayload(context || 'body', html),
    );
    return frag;
  }
  toString() {
    const sc = this._sc, ec = this._ec;
    if (!sc) return "";
    if (_rngSame(sc, ec) && (sc.nodeType === 3 || sc.nodeType === 4)) return (sc.data || "").slice(this._so, this._eo);
    let s = "";
    if (sc.nodeType === 3 || sc.nodeType === 4) s += (sc.data || "").slice(this._so);
    const cac = this.commonAncestorContainer;
    if (cac) {
      const walk = (node) => {
        if (node.nodeType === 3 || node.nodeType === 4) {
          if (!_rngSame(node, sc) && !_rngSame(node, ec) &&
              _rngCmp(node, 0, this._sc, this._so) >= 0 && _rngCmp(node, _rngNodeLength(node), this._ec, this._eo) <= 0) {
            s += (node.data || "");
          }
        }
        const kids = node.childNodes;
        for (let i = 0; i < kids.length; i++) if (kids[i]) walk(kids[i]);
      };
      walk(cac);
    }
    if (!_rngSame(sc, ec) && (ec.nodeType === 3 || ec.nodeType === 4)) s += (ec.data || "").slice(0, this._eo);
    return s;
  }
  cloneContents() { return _rngContentsFragment(this, true); }
  extractContents() { return _rngContentsFragment(this, false); }
  deleteContents() { _rngContentsFragment(this, false); }
  insertNode(node) { if (node && this._sc && this._sc.insertBefore) { const kids = this._sc.childNodes; this._sc.insertBefore(node, kids[this._so] || null); } }
  surroundContents(node) { this.insertNode(node); }
  detach() {}
  getBoundingClientRect() {
    if (this.collapsed) return new DOMRect();
    let cac = this.commonAncestorContainer;
    while (cac && cac.nodeType !== 1 && cac.nodeType !== 9) cac = cac.parentNode;
    if (cac && cac.getBoundingClientRect) {
      const r = cac.getBoundingClientRect();
      return new DOMRect(r.x, r.y, r.width, r.height);
    }
    return new DOMRect();
  }
  getClientRects() {
    if (this.collapsed) return new DOMRectList([]);
    return new DOMRectList([this.getBoundingClientRect()]);
  }
  static get START_TO_START() { return 0; }
  static get START_TO_END() { return 1; }
  static get END_TO_END() { return 2; }
  static get END_TO_START() { return 3; }
};
Object.assign(globalThis.Range.prototype, { START_TO_START: 0, START_TO_END: 1, END_TO_END: 2, END_TO_START: 3 });
