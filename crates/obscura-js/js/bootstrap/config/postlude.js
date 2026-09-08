if (typeof URLPattern === 'undefined') {
  globalThis.URLPattern = class URLPattern {
    constructor(pattern){this._pattern=pattern||{};} test(){return false;} exec(){return null;}
  };
}

if (typeof Document !== 'undefined' && !Document.prototype.importNode) {
  Document.prototype.importNode = function(node, deep) {
    return _stampDetachedDocumentNode(this, node?.cloneNode(!!deep) || null);
  };
}

// Document.adoptNode: standard DOM (HTML living spec). Frameworks that move
// nodes between documents (portals, iframe hand-off) call it; the missing
// method throws "adoptNode is not a function". Adoption transfers ownership
// without cloning: restamp the adopted root's owner-document cache; its
// descendants re-resolve lazily (same weak-consistency strategy as
// insertion, see Node#ownerDocument).
if (typeof Document !== 'undefined' && !Document.prototype.adoptNode) {
  Document.prototype.adoptNode = function(node) {
    if (node && node[_nidSym] !== undefined) {
      node[_ownerDocRootSym] = this[_scopeRootSym] !== undefined ? this[_scopeRootSym] : this[_nidSym];
    }
    return _stampDetachedDocumentNode(this, node || null);
  };
}

// Element.toggleAttribute: standard DOM. Lit/Stencil and several ad SDKs call
// it; the missing method throws. Spec semantics: no force arg toggles, force
// true adds, force false removes; returns the new presence.
if (typeof Element !== 'undefined' && !Element.prototype.toggleAttribute) {
  Element.prototype.toggleAttribute = function(name, force) {
    const n = String(name);
    const present = this.hasAttribute(n);
    const want = arguments.length < 2 ? !present : !!force;
    if (want && !present) { this.setAttribute(n, ''); return true; }
    if (!want && present) { this.removeAttribute(n); return false; }
    return want;
  };
}

// Document.elementFromPoint / elementsFromPoint — no layout engine, so this is a stub:
// in-viewport coords return <body> (or <html> as fallback), out-of-viewport returns null.
// Wrong-but-non-throwing beats "undefined", which traps ad/analytics bootstraps in retry loops
// (see issue #63).
if (typeof Document !== 'undefined' && !Document.prototype.elementFromPoint) {
  // Real hit testing against the synthetic bboxes from getBoundingClientRect.
  // Flat iteration over every element, NOT a tree walk: our synthetic rects
  // don't form a proper containment hierarchy (a child's rect can lie far
  // outside its parent's), so a tree walk that only descends into ancestors
  // containing (x,y) would never reach a deep <input> inside <label><p>.
  // Returns the deepest matching element (highest nid wins as a proxy for
  // tree depth) so descendants beat ancestors.
  Document.prototype.elementFromPoint = function(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) {
      return null;
    }
    var w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    var h = (typeof window !== 'undefined' && window.innerHeight) || 720;
    if (x < 0 || y < 0 || x > w || y > h) return null;
    var all = this.querySelectorAll('*');
    var best = null;
    var bestNid = -1;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || !el.getBoundingClientRect) continue;
      // documentElement / body span the viewport; skip them so we pick a
      // real descendant instead of falling back to <html>/<body>.
      if (el === this.documentElement || el === this.body) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        // A descendant's layout rect can extend beyond an overflow clip. It
        // must not win hit testing where its scrolling ancestor hides it —
        // otherwise a wheel well outside a small pane scrolls that pane
        // instead of the page behind it.
        var visible = true;
        var ancestor = el.parentElement;
        while (ancestor && ancestor !== this.documentElement && ancestor !== this.body) {
          var style = null;
          try { style = getComputedStyle(ancestor); } catch (_e) {}
          var ox = style ? (style.overflowX || style.overflow || '') : '';
          var oy = style ? (style.overflowY || style.overflow || '') : '';
          var clipsX = ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip';
          var clipsY = oy === 'auto' || oy === 'scroll' || oy === 'hidden' || oy === 'clip';
          if (clipsX || clipsY) {
            var ar = ancestor.getBoundingClientRect();
            // Overflow clips at the padding box, inside the border. Renderer
            // client metrics expose that box's size; computed border widths
            // locate it within the border-box rect.
            var borderLeft = parseFloat(style && style.borderLeftWidth) || 0;
            var borderTop = parseFloat(style && style.borderTopWidth) || 0;
            var clipLeft = ar.left + borderLeft;
            var clipTop = ar.top + borderTop;
            var clipRight = clipLeft + ancestor.clientWidth;
            var clipBottom = clipTop + ancestor.clientHeight;
            if ((clipsX && (x < clipLeft || x > clipRight)) ||
                (clipsY && (y < clipTop || y > clipBottom))) {
              visible = false;
              break;
            }
          }
          ancestor = ancestor.parentElement;
        }
        if (!visible) continue;
        var nid = el[_nidSym] | 0;
        if (nid > bestNid) { best = el; bestNid = nid; }
      }
    }
    return best || this.body || this.documentElement || null;
  };
  Document.prototype.elementsFromPoint = function(x, y) {
    var el = this.elementFromPoint(x, y);
    return el ? [el] : [];
  };
}
if (typeof ShadowRoot !== 'undefined' && !ShadowRoot.prototype.elementFromPoint) {
  ShadowRoot.prototype.elementFromPoint = function(x, y) {
    return Document.prototype.elementFromPoint.call(globalThis.document || this, x, y);
  };
  ShadowRoot.prototype.elementsFromPoint = function(x, y) {
    return Document.prototype.elementsFromPoint.call(globalThis.document || this, x, y);
  };
}


// Hang the native collection off Document.prototype. It is absent in a build
// that links the prebuilt V8 rather than the vendored source, and then
// `document.all` stays undefined -- which is this engine's behaviour today.
// Substituting an ordinary object would answer `typeof` wrongly and be a
// louder difference than the absence.
function _installDocumentAll() {
  const collection = globalThis.__obscura_document_all;
  // `!collection` would be true here: the object is deliberately falsy. Strict
  // comparison is the only test that separates "absent" from "undetectable",
  // because `== undefined` is true for both.
  if (collection === undefined) return;
  try { Object.setPrototypeOf(collection, globalThis.HTMLAllCollection.prototype); }
  catch (_error) {}
  if (Object.getOwnPropertyDescriptor(Document.prototype, 'all')) return;
  Object.defineProperty(Document.prototype, 'all', {
    get() { return collection; },
    enumerable: true, configurable: true,
  });
}

