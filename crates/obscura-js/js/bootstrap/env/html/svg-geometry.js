// SVG coordinate services: getCTM/getScreenCTM, real
// getBoundingClientRect/getClientRects for SVG fragments, getBBox unions for
// containers, and SVGGeometryElement path lengths.
//
// Before this module every SVG child answered gBCR with an all-zero rect --
// the layout pipeline only gives the <svg> root a CSS box -- and getCTM /
// getScreenCTM / getTotalLength did not exist, so a page measuring through
// them read a zero geometry triple and an anti-tamper probe could tell the
// layout engine was not participating. Chrome's semantics, verified against
// headless Chrome on a transform/viewBox fixture:
//
//   getCTM()            own transform * ancestor transforms * viewBox map,
//                       element user space -> svg viewport units; identity on
//                       the root <svg>; null outside an svg tree.
//   getScreenCTM()      getCTM pre-multiplied by the root svg's CSS-box
//                       origin plus the window origin (screenX/Y).
//   getBoundingClientRect()  bbox corners mapped through the viewport CTM,
//                       axis-aligned union of the mapped corners (rotate
//                       exchanges width/height).
//   getTotalLength()    user-space path length; basic shapes walk their
//                       geometry; absent on non-geometry elements.
(function () {
  'use strict';
  if (typeof _measureTextBox !== 'function') return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const _layoutGBCR = Element.prototype.getBoundingClientRect;
  const _layoutGCRs = Element.prototype.getClientRects;

  // --- affine matrices, {a,b,c,d,e,f} ------------------------------------
  function _ident() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  function _mul(m, n) {
    // point is transformed by n first, then m
    return {
      a: m.a * n.a + m.c * n.b,
      b: m.b * n.a + m.d * n.b,
      c: m.a * n.c + m.c * n.d,
      d: m.b * n.c + m.d * n.d,
      e: m.a * n.e + m.c * n.f + m.e,
      f: m.b * n.e + m.d * n.f + m.f,
    };
  }
  function _apply(m, x, y) {
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  }
  function _translate(x, y) { return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }; }

  function _parseTransform(str) {
    let m = _ident();
    if (!str || typeof str !== 'string') return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let hit;
    while ((hit = re.exec(str)) !== null) {
      const args = hit[2].trim().split(/[\s,]+/).filter(s => s.length).map(Number);
      let t;
      switch (hit[1]) {
        case 'matrix':
          t = { a: args[0] || 0, b: args[1] || 0, c: args[2] || 0, d: args[3] || 0, e: args[4] || 0, f: args[5] || 0 };
          break;
        case 'translate':
          t = _translate(args[0] || 0, args[1] || 0);
          break;
        case 'scale': {
          const sx = args[0] === undefined ? 1 : args[0];
          const sy = args.length > 1 ? args[1] : sx;
          t = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
          break;
        }
        case 'rotate': {
          const rad = (args[0] || 0) * Math.PI / 180;
          // Chrome prints cos(90deg) as exactly 0; snap the float residue so
          // matrix consumers compare equal.
          let cos = Math.cos(rad), sin = Math.sin(rad);
          if (Math.abs(cos) < 1e-12) cos = 0;
          if (Math.abs(sin) < 1e-12) sin = 0;
          t = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
          if (args.length > 2) {
            t = _mul(_mul(_translate(args[1], args[2]), t), _translate(-args[1], -args[2]));
          }
          break;
        }
        case 'skewX':
          t = { a: 1, b: 0, c: Math.tan((args[0] || 0) * Math.PI / 180), d: 1, e: 0, f: 0 };
          break;
        case 'skewY':
          t = { a: 1, b: Math.tan((args[0] || 0) * Math.PI / 180), c: 0, d: 1, e: 0, f: 0 };
          break;
      }
      if (t) m = _mul(m, t);
    }
    return m;
  }

  function _isSvgNode(node) {
    try {
      return !!(node && node.nodeType === 1 && node.namespaceURI === SVG_NS);
    } catch (_e) { return false; }
  }

  function _svgRootOf(el) {
    let n = el;
    while (_isSvgNode(n)) {
      if (n.localName === 'svg') return n;
      n = n.parentNode;
    }
    return null;
  }

  function _attrNum(el, name, fallback) {
    try {
      const v = el.getAttribute(name);
      if (v == null || v === '') return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch (_e) { return fallback; }
  }

  // x/y on text elements accept per-glyph lists; the first value positions
  // the run.
  function _attrFirstNum(el, name, fallback) {
    try {
      const v = el.getAttribute(name);
      if (v == null || v === '') return fallback;
      const first = String(v).trim().split(/[\s,]+/)[0];
      const n = Number(first);
      return Number.isFinite(n) ? n : fallback;
    } catch (_e) { return fallback; }
  }

  // viewBox -> viewport-units map. Uses the root's rendered CSS box for the
  // used size when width/height are missing or percentages.
  function _viewBoxMatrix(root) {
    let vb = null;
    try { vb = root.getAttribute('viewBox'); } catch (_e) {}
    if (!vb) return _ident();
    const p = String(vb).trim().split(/[\s,]+/).map(Number);
    if (p.length !== 4 || !p.every(Number.isFinite) || !p[2] || !p[3]) return _ident();
    const box = _layoutGBCR.call(root);
    let uw = box.width, uh = box.height;
    const wAttr = root.getAttribute('width'), hAttr = root.getAttribute('height');
    if (wAttr && !String(wAttr).includes('%')) { const n = Number(wAttr); if (Number.isFinite(n)) uw = n; }
    if (hAttr && !String(hAttr).includes('%')) { const n = Number(hAttr); if (Number.isFinite(n)) uh = n; }
    const sx = (uw || p[2]) / p[2], sy = (uh || p[3]) / p[3];
    return { a: sx, b: 0, c: 0, d: sy, e: -p[0] * sx, f: -p[1] * sy };
  }

  function _ownTransform(el) {
    try { return _parseTransform(el.getAttribute('transform')); } catch (_e) { return _ident(); }
  }

  // Element user space -> svg viewport units. The element's own transform is
  // included (Chrome: getCTM on <text transform="translate(5,5)"> is that
  // translate), then each ancestor up to (excluding) the root svg, then the
  // root's viewBox map.
  function _viewportCTM(el) {
    let m = _ownTransform(el);
    let n = el.parentNode;
    while (_isSvgNode(n) && n.localName !== 'svg') {
      m = _mul(_ownTransform(n), m);
      n = n.parentNode;
    }
    if (!_isSvgNode(n) || n.localName !== 'svg') return null;
    return _mul(_viewBoxMatrix(n), m);
  }

  // --- fragment bounding boxes, in the element's own user space -----------
  function _union(boxes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      if (!b) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function _mapBox(m, b) {
    const c1 = _apply(m, b.x, b.y);
    const c2 = _apply(m, b.x + b.width, b.y);
    const c3 = _apply(m, b.x, b.y + b.height);
    const c4 = _apply(m, b.x + b.width, b.y + b.height);
    const xs = [c1[0], c2[0], c3[0], c4[0]], ys = [c1[1], c2[1], c3[1], c4[1]];
    const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return {
      x, y,
      width: Math.max.apply(null, xs) - x,
      height: Math.max.apply(null, ys) - y,
    };
  }

  const TEXT_TAGS = new Set(['text', 'tspan', 'textPath']);
  const CONTAINER_TAGS = new Set(['g', 'svg', 'a', 'marker', 'pattern', 'defs', 'switch', 'symbol', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'filter']);

  function _shapeBox(el) {
    const name = el.localName;
    switch (name) {
      case 'rect':
        return { x: _attrNum(el, 'x', 0), y: _attrNum(el, 'y', 0), width: _attrNum(el, 'width', 0), height: _attrNum(el, 'height', 0) };
      case 'circle': {
        const cx = _attrNum(el, 'cx', 0), cy = _attrNum(el, 'cy', 0), r = _attrNum(el, 'r', 0);
        return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
      }
      case 'ellipse': {
        const cx = _attrNum(el, 'cx', 0), cy = _attrNum(el, 'cy', 0);
        const rx = _attrNum(el, 'rx', 0), ry = _attrNum(el, 'ry', 0);
        return { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
      }
      case 'line': {
        const x1 = _attrNum(el, 'x1', 0), y1 = _attrNum(el, 'y1', 0);
        const x2 = _attrNum(el, 'x2', 0), y2 = _attrNum(el, 'y2', 0);
        return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      }
      case 'polyline':
      case 'polygon': {
        let pts = [];
        try {
          pts = String(el.getAttribute('points') || '')
            .trim().split(/[\s,]+/).map(Number)
            .filter(Number.isFinite);
        } catch (_e) {}
        const xs = [], ys = [];
        for (let i = 0; i + 1 < pts.length; i += 2) { xs.push(pts[i]); ys.push(pts[i + 1]); }
        if (!xs.length) return { x: 0, y: 0, width: 0, height: 0 };
        const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
        return { x, y, width: Math.max.apply(null, xs) - x, height: Math.max.apply(null, ys) - y };
      }
      case 'path': {
        // The tight bounds of the flattened geometry. (Chrome's Skia fast
        // bounds use bezier control points, a superset of the curve; the
        // flattened walk is the spec's box.)
        const pts = _geometryPoints(el) || [];
        if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
        const xs = [], ys = [];
        for (const p of pts) { xs.push(p[0]); ys.push(p[1]); }
        const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
        return { x, y, width: Math.max.apply(null, xs) - x, height: Math.max.apply(null, ys) - y };
      }
      case 'image':
      case 'use':
      case 'foreignObject': {
        const x = _attrNum(el, 'x', 0), y = _attrNum(el, 'y', 0);
        return { x, y, width: _attrNum(el, 'width', 0), height: _attrNum(el, 'height', 0) };
      }
      default:
        return null;
    }
  }

  function _textBox(el) {
    const box = _measureTextBox(_svgTextContent(el), _svgMeasurementFont(el));
    // The x/y attributes (first list value) place the run's origin.
    return {
      x: _attrFirstNum(el, 'x', 0),
      y: _attrFirstNum(el, 'y', 0) - box.ascent,
      width: box.width,
      height: box.ascent + box.descent,
    };
  }

  function _fragmentBBox(el) {
    if (TEXT_TAGS.has(el.localName)) return _textBox(el);
    const shape = _shapeBox(el);
    if (shape) return shape;
    if (CONTAINER_TAGS.has(el.localName) || !_isSvgNode(el)) {
      // Union of the child fragments, each mapped by its own transform.
      const boxes = [];
      let kids = null;
      try { kids = el.childNodes; } catch (_e) {}
      for (let i = 0; kids && i < kids.length; i++) {
        const kid = kids[i];
        if (!_isSvgNode(kid)) continue;
        boxes.push(_mapBox(_ownTransform(kid), _fragmentBBox(kid)));
      }
      return _union(boxes);
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // --- installed API ------------------------------------------------------
  Element.prototype.getCTM = function getCTM() {
    const root = _svgRootOf(this);
    if (!root) return null;
    if (root === this) return _matrixLike(_ident());
    return _matrixLike(_viewportCTM(this) || _ident());
  };

  Element.prototype.getScreenCTM = function getScreenCTM() {
    const root = _svgRootOf(this);
    if (!root) return null;
    const origin = _layoutGBCR.call(root);
    const winX = (typeof globalThis.__obscura_window_origin_x === 'function') ? globalThis.__obscura_window_origin_x() : 0;
    const winY = (typeof globalThis.__obscura_window_origin_y === 'function') ? globalThis.__obscura_window_origin_y() : 0;
    let m = _translate(origin.x + winX, origin.y + winY);
    if (root !== this) {
      const ctm = _viewportCTM(this);
      if (ctm) m = _mul(m, ctm);
    } else {
      m = _mul(m, _viewBoxMatrix(root));
    }
    return _matrixLike(m);
  };

  function _matrixLike(m) {
    if (typeof DOMMatrix === 'function') {
      try {
        const d = new DOMMatrix();
        d.a = m.a; d.b = m.b; d.c = m.c; d.d = m.d; d.e = m.e; d.f = m.f;
        d.isIdentity = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
        return d;
      } catch (_e) {}
    }
    return m;
  }

  // getComputedStyle resolves width/height through gBCR, and this module's
  // fragment measurement resolves its font through getComputedStyle. A
  // re-entrant read (gBCR while a fragment measurement is running) falls
  // back to the layout box instead, which is the pre-fragment answer and
  // breaks the cycle after one extra op.
  let _measuringFragment = false;

  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const root = _svgRootOf(this);
    if (!root || root === this || _measuringFragment) {
      return _layoutGBCR.apply(this, arguments);
    }
    const ctm = _viewportCTM(this);
    if (!ctm) return _layoutGBCR.apply(this, arguments);
    _measuringFragment = true;
    let mapped;
    try {
      mapped = _mapBox(ctm, _fragmentBBox(this));
    } finally {
      _measuringFragment = false;
    }
    const origin = _layoutGBCR.call(root);
    const x = mapped.x + origin.x, y = mapped.y + origin.y;
    return {
      x, y, width: mapped.width, height: mapped.height,
      top: y, right: x + mapped.width, bottom: y + mapped.height, left: x,
      toJSON() {
        return { x, y, width: mapped.width, height: mapped.height, top: y, right: x + mapped.width, bottom: y + mapped.height, left: x };
      },
    };
  };

  Element.prototype.getClientRects = function getClientRects() {
    const root = _svgRootOf(this);
    if (!root || root === this) return _layoutGCRs.apply(this, arguments);
    const r = this.getBoundingClientRect();
    return new DOMRectList([new DOMRect(r.x, r.y, r.width, r.height)]);
  };

  // getBBox gains the container union and the x/y-attribute placement while
  // keeping the text measurement the previous implementation used.
  Element.prototype.getBBox = function getBBox() {
    if (_measuringFragment) return { x: 0, y: 0, width: 0, height: 0 };
    _measuringFragment = true;
    try {
      return _fragmentBBox(this);
    } finally {
      _measuringFragment = false;
    }
  };

  // --- SVGGeometryElement path lengths -------------------------------------
  // Walked as a flattened polyline in user space; arcs become the same kappa
  // beziers Chrome's path builder uses, so lengths land on Chrome's values
  // (circle r=20 -> ~124.85, not the exact 2*pi*r).
  const KAPPA = 0.5522847498307936;

  function _tokenizePath(d) {
    const out = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
      if (m[1]) out.push(m[1]);
      else out.push(Number(m[2]));
    }
    return out;
  }

  function _flattenQuadratic(p0, p1, p2, out) {
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      out.push([
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      ]);
    }
  }

  function _flattenCubic(p0, p1, p2, p3, out) {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  }

  function _arcToBeziers(x0, y0, rx, ry, phi, fa, fs, x, y, out) {
    // SVG appendix F.6: endpoint -> center parameterization, then the same
    // kappa-split into cubic segments Chrome's path builder performs.
    if (rx === 0 || ry === 0) { out.push([x, y]); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const rad = phi * Math.PI / 180, cosP = Math.cos(rad), sinP = Math.sin(rad);
    const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
    const x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const sign = fa === fs ? -1 : 1;
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num / den));
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cosP * cxp - sinP * cyp + (x0 + x) / 2;
    const cy = sinP * cxp + cosP * cyp + (y0 + y) / 2;
    function angle(ux, uy, vx, vy) {
      const dot = ux * vx + uy * vy;
      const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
      let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    }
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dTheta > 0) dTheta -= 2 * Math.PI;
    if (fs && dTheta < 0) dTheta += 2 * Math.PI;
    const segs = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
    const delta = dTheta / segs;
    const t4 = 4 / 3 * Math.tan(delta / 4);
    let th = theta1;
    let px = cx + rx * Math.cos(th), py = cy + ry * Math.sin(th);
    for (let i = 0; i < segs; i++) {
      const th2 = th + delta;
      const px2 = cx + rx * Math.cos(th2), py2 = cy + ry * Math.sin(th2);
      // Outgoing handle of the segment start, incoming handle of the end
      // (the classic kappa split; note the opposite derivative signs).
      const d1x = -rx * Math.sin(th) * t4, d1y = ry * Math.cos(th) * t4;
      const d2x = rx * Math.sin(th2) * t4, d2y = -ry * Math.cos(th2) * t4;
      _flattenCubic([px, py], [px + d1x, py + d1y], [px2 + d2x, py2 + d2y], [px2, py2], out);
      th = th2; px = px2; py = py2;
    }
  }

  function _geometryPoints(el) {
    const name = el.localName;
    if (name === 'line') {
      return [[_attrNum(el, 'x1', 0), _attrNum(el, 'y1', 0)], [_attrNum(el, 'x2', 0), _attrNum(el, 'y2', 0)]];
    }
    if (name === 'rect') {
      const x = _attrNum(el, 'x', 0), y = _attrNum(el, 'y', 0);
      const w = _attrNum(el, 'width', 0), h = _attrNum(el, 'height', 0);
      const rx = Math.min(_attrNum(el, 'rx', 0), _attrNum(el, 'ry', 0) || _attrNum(el, 'rx', 0), w / 2) || 0;
      if (rx <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
      const ry = Math.min(_attrNum(el, 'ry', _attrNum(el, 'rx', 0)) || rx, h / 2);
      const pts = [[x + rx, y]];
      pts.push([x + w - rx, y]);
      _arcToBeziers(x + w - rx, y, rx, ry, 0, 0, 1, x + w, y + ry, pts);
      pts.push([x + w, y + h - ry]);
      _arcToBeziers(x + w, y + h - ry, rx, ry, 0, 0, 1, x + w - rx, y + h, pts);
      pts.push([x + rx, y + h]);
      _arcToBeziers(x + rx, y + h, rx, ry, 0, 0, 1, x, y + h - ry, pts);
      pts.push([x, y + ry]);
      _arcToBeziers(x, y + ry, rx, ry, 0, 0, 1, x + rx, y, pts);
      return pts;
    }
    if (name === 'circle' || name === 'ellipse') {
      const cx = _attrNum(el, 'cx', 0), cy = _attrNum(el, 'cy', 0);
      const rx = name === 'circle' ? _attrNum(el, 'r', 0) : _attrNum(el, 'rx', 0);
      const ry = name === 'circle' ? _attrNum(el, 'r', 0) : _attrNum(el, 'ry', 0);
      // Chrome starts at (cx+rx, cy) and sweeps clockwise.
      const pts = [[cx + rx, cy]];
      _arcToBeziers(cx + rx, cy, rx, ry, 0, 0, 1, cx, cy + ry, pts);
      _arcToBeziers(cx, cy + ry, rx, ry, 0, 0, 1, cx - rx, cy, pts);
      _arcToBeziers(cx - rx, cy, rx, ry, 0, 0, 1, cx, cy - ry, pts);
      _arcToBeziers(cx, cy - ry, rx, ry, 0, 0, 1, cx + rx, cy, pts);
      return pts;
    }
    if (name === 'polyline' || name === 'polygon') {
      const pts = [];
      try {
        const raw = String(el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
        for (let i = 0; i + 1 < raw.length; i += 2) pts.push([raw[i], raw[i + 1]]);
      } catch (_e) {}
      if (name === 'polygon' && pts.length > 1) pts.push(pts[0].slice());
      return pts;
    }
    if (name === 'path') {
      const tok = _tokenizePath(el.getAttribute('d') || '');
      const pts = [];
      let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      let lastC2 = null, lastQ1 = null, prevCmd = '';
      function num() { const v = tok[i++]; return typeof v === 'number' ? v : 0; }
      while (i < tok.length) {
        const cmd = tok[i++];
        if (typeof cmd !== 'string') { i--; break; }
        switch (cmd) {
          case 'M': cx = num(); cy = num(); sx = cx; sy = cy; pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'm': cx += num(); cy += num(); sx = cx; sy = cy; pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'L': cx = num(); cy = num(); pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'l': cx += num(); cy += num(); pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'H': cx = num(); pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'h': cx += num(); pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'V': cy = num(); pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'v': cy += num(); pts.push([cx, cy]); lastC2 = lastQ1 = null; break;
          case 'C': {
            const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
            _flattenCubic([cx, cy], [x1, y1], [x2, y2], [x, y], pts);
            lastC2 = [x2, y2]; cx = x; cy = y; lastQ1 = null; break;
          }
          case 'c': {
            const x1 = cx + num(), y1 = cy + num(), x2 = cx + num(), y2 = cy + num(), x = cx + num(), y = cy + num();
            _flattenCubic([cx, cy], [x1, y1], [x2, y2], [x, y], pts);
            lastC2 = [x2, y2]; cx = x; cy = y; lastQ1 = null; break;
          }
          case 'S': {
            let x1 = cx, y1 = cy;
            if (prevCmd === 'C' || prevCmd === 'S' || prevCmd === 'c' || prevCmd === 's') {
              if (lastC2) { x1 = 2 * cx - lastC2[0]; y1 = 2 * cy - lastC2[1]; }
            }
            const x2 = num(), y2 = num(), x = num(), y = num();
            _flattenCubic([cx, cy], [x1, y1], [x2, y2], [x, y], pts);
            lastC2 = [x2, y2]; cx = x; cy = y; lastQ1 = null; break;
          }
          case 's': {
            let x1 = cx, y1 = cy;
            if (prevCmd === 'C' || prevCmd === 'S' || prevCmd === 'c' || prevCmd === 's') {
              if (lastC2) { x1 = 2 * cx - lastC2[0]; y1 = 2 * cy - lastC2[1]; }
            }
            const x2 = cx + num(), y2 = cy + num(), x = cx + num(), y = cy + num();
            _flattenCubic([cx, cy], [x1, y1], [x2, y2], [x, y], pts);
            lastC2 = [x2, y2]; cx = x; cy = y; lastQ1 = null; break;
          }
          case 'Q': {
            const x1 = num(), y1 = num(), x = num(), y = num();
            _flattenQuadratic([cx, cy], [x1, y1], [x, y], pts);
            lastQ1 = [x1, y1]; cx = x; cy = y; lastC2 = null; break;
          }
          case 'q': {
            const x1 = cx + num(), y1 = cy + num(), x = cx + num(), y = cy + num();
            _flattenQuadratic([cx, cy], [x1, y1], [x, y], pts);
            lastQ1 = [x1, y1]; cx = x; cy = y; lastC2 = null; break;
          }
          case 'T': {
            let x1 = cx, y1 = cy;
            if (prevCmd === 'Q' || prevCmd === 'T' || prevCmd === 'q' || prevCmd === 't') {
              if (lastQ1) { x1 = 2 * cx - lastQ1[0]; y1 = 2 * cy - lastQ1[1]; }
            }
            const x = num(), y = num();
            _flattenQuadratic([cx, cy], [x1, y1], [x, y], pts);
            lastQ1 = [x1, y1]; cx = x; cy = y; lastC2 = null; break;
          }
          case 't': {
            let x1 = cx, y1 = cy;
            if (prevCmd === 'Q' || prevCmd === 'T' || prevCmd === 'q' || prevCmd === 't') {
              if (lastQ1) { x1 = 2 * cx - lastQ1[0]; y1 = 2 * cy - lastQ1[1]; }
            }
            const x = cx + num(), y = cy + num();
            _flattenQuadratic([cx, cy], [x1, y1], [x, y], pts);
            lastQ1 = [x1, y1]; cx = x; cy = y; lastC2 = null; break;
          }
          case 'A': {
            const rx = num(), ry = num(), rot = num(), fa = num(), fs = num(), x = num(), y = num();
            _arcToBeziers(cx, cy, rx, ry, rot, fa, fs, x, y, pts);
            cx = x; cy = y; lastC2 = lastQ1 = null; break;
          }
          case 'a': {
            const rx = num(), ry = num(), rot = num(), fa = num(), fs = num();
            const x = cx + num(), y = cy + num();
            _arcToBeziers(cx, cy, rx, ry, rot, fa, fs, x, y, pts);
            cx = x; cy = y; lastC2 = lastQ1 = null; break;
          }
          case 'Z':
          case 'z':
            if (pts.length) pts.push([sx, sy]);
            cx = sx; cy = sy; lastC2 = lastQ1 = null; break;
        }
        prevCmd = cmd;
      }
      return pts;
    }
    return null;
  }

  function _walkLength(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return total;
  }

  function _pointAt(pts, dist) {
    if (!pts.length) return [0, 0];
    if (dist <= 0) return pts[0].slice();
    let remain = dist;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (remain <= seg && seg > 0) {
        const t = remain / seg;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      remain -= seg;
    }
    return pts[pts.length - 1].slice();
  }

  // Keep the generic Element fallback for compatibility, but publish the
  // geometry methods on their owning SVG interfaces as Chrome does. Besides
  // matching the IDL surface, this preserves the receiver interface in the
  // native call trace (SVGGraphicsElement.getBBox and
  // SVGSVGElement.getComputedTextLength), which challenge scripts inspect.
  function _publishSvgMethod(proto, name) {
    if (!proto || proto === Element.prototype
        || Object.prototype.hasOwnProperty.call(proto, name)) return;
    const fn = Element.prototype[name];
    if (typeof fn !== 'function') return;
    Object.defineProperty(proto, name, {
      value: fn, writable: true, enumerable: false, configurable: true,
    });
  }
  const graphicsProto = globalThis.SVGGraphicsElement && globalThis.SVGGraphicsElement.prototype;
  for (const name of ['getBBox', 'getCTM', 'getScreenCTM', 'getClientRects']) {
    _publishSvgMethod(graphicsProto, name);
  }
  const svgProto = globalThis.SVGSVGElement && globalThis.SVGSVGElement.prototype;
  for (const name of ['getComputedTextLength', 'getSubStringLength', 'getExtentOfChar',
                      'getStartPositionOfChar', 'getEndPositionOfChar',
                      'getRotationOfChar', 'getCharNumAtPosition', 'getNumberOfChars']) {
    _publishSvgMethod(svgProto, name);
  }

  const GEOMETRY_PROTO = (globalThis.SVGGeometryElement && globalThis.SVGGeometryElement.prototype) || Element.prototype;
  Object.defineProperty(GEOMETRY_PROTO, 'getTotalLength', {
    value: function getTotalLength() {
      const pts = _geometryPoints(this);
      if (!pts) throw new DOMException('This element does not support getTotalLength', 'NotSupportedError');
      return _walkLength(pts);
    },
    writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(GEOMETRY_PROTO, 'getPointAtLength', {
    value: function getPointAtLength(distance) {
      const pts = _geometryPoints(this);
      if (!pts) throw new DOMException('This element does not support getPointAtLength', 'NotSupportedError');
      const d = Number(distance);
      const p = _pointAt(pts, Number.isFinite(d) ? Math.max(0, d) : 0);
      if (typeof DOMPoint === 'function') return new DOMPoint(p[0], p[1]);
      return { x: p[0], y: p[1] };
    },
    writable: true, enumerable: false, configurable: true,
  });
})();
