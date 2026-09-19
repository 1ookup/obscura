// Geometry value objects. Each interface is exposed independently while the
// retained layout pipeline continues to consume the same global constructors.
//
// Chrome's geometry instances carry their fields in an internal slot behind
// prototype accessors: Object.keys(rect) is empty, Object.entries(rect) is
// empty, and the prototype's own keys are just the field accessors plus
// constructor (local headless-Chrome oracle). Own-property records fail that
// shape, and the challenge hash probe's rect collection rejects them -- the
// live reduce behind RKUE0 saw an empty set while getBBox/getExtentOfChar
// answered branded instances (tel7 telemetry). Slots live in a module WeakMap
// shared with the SVG geometry producers (canvas.js), which needs no visible
// own key.
const OBSCURA_GEOM_SLOTS = new WeakMap();
// Rects flagged as already viewport-fixed are tracked here so the branded
// DOMRect a page receives stays own-key-less like Chrome's (the marker used
// to be an own property).
const OBSCURA_VIEWPORT_FIXED_RECTS = new WeakSet();
function OBSCURA_GEOM_ACCESSORS(proto, keys) {
  for (const key of keys) {
    Object.defineProperty(proto, key, {
      get() {
        const slot = OBSCURA_GEOM_SLOTS.get(this);
        return slot ? slot[key] : undefined;
      },
      configurable: true,
      enumerable: true,
    });
  }
}
if (typeof DOMRectReadOnly === 'undefined') {
  globalThis.DOMRectReadOnly = class DOMRectReadOnly {
    constructor(x = 0, y = 0, w = 0, h = 0) {
      OBSCURA_GEOM_SLOTS.set(this, { x: +x, y: +y, width: +w, height: +h });
    }
    static fromRect(r = {}) { return new DOMRectReadOnly(r.x, r.y, r.width, r.height); }
  };
  // WebIDL attributes are enumerable on the prototype (Chrome for-in yields
  // x..left and toJSON), so the derived edges and toJSON are defined with the
  // same helper instead of class-getter syntax, which is non-enumerable.
  OBSCURA_GEOM_ACCESSORS(globalThis.DOMRectReadOnly.prototype,
    ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']);
  const readOnlyProto = globalThis.DOMRectReadOnly.prototype;
  Object.defineProperty(readOnlyProto, 'top', {
    get() { return OBSCURA_GEOM_SLOTS.get(this).y; },
    configurable: true, enumerable: true,
  });
  Object.defineProperty(readOnlyProto, 'right', {
    get() { const s = OBSCURA_GEOM_SLOTS.get(this); return s.x + s.width; },
    configurable: true, enumerable: true,
  });
  Object.defineProperty(readOnlyProto, 'bottom', {
    get() { const s = OBSCURA_GEOM_SLOTS.get(this); return s.y + s.height; },
    configurable: true, enumerable: true,
  });
  Object.defineProperty(readOnlyProto, 'left', {
    get() { return OBSCURA_GEOM_SLOTS.get(this).x; },
    configurable: true, enumerable: true,
  });
  Object.defineProperty(readOnlyProto, 'toJSON', {
    value() {
      const s = OBSCURA_GEOM_SLOTS.get(this);
      return { x: s.x, y: s.y, width: s.width, height: s.height,
        top: this.top, right: this.right, bottom: this.bottom, left: this.left };
    },
    configurable: true, writable: true, enumerable: true,
  });
}
if (typeof DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRect extends DOMRectReadOnly {
    static fromRect(r = {}) { return new DOMRect(r.x, r.y, r.width, r.height); }
  };
  // Chrome's DOMRect x/y/width/height are writable; the derived edges are not.
  for (const key of ['x', 'y', 'width', 'height']) {
    const desc = Object.getOwnPropertyDescriptor(globalThis.DOMRectReadOnly.prototype, key);
    Object.defineProperty(globalThis.DOMRect.prototype, key, {
      get: desc.get,
      set(v) { const slot = OBSCURA_GEOM_SLOTS.get(this); if (slot) slot[key] = +v; },
      configurable: true,
      enumerable: true,
    });
  }
}
if (typeof DOMRectList === 'undefined') {
  globalThis.DOMRectList = class DOMRectList {
    constructor(arr = []) {
      this.length = arr.length;
      for (let i = 0; i < arr.length; i++) this[i] = arr[i];
    }
    item(i) { return this[i] || null; }
    [Symbol.iterator]() {
      let i = 0, self = this;
      return { next() {
        const done = i >= self.length;
        return { value: done ? undefined : self[i++], done };
      } };
    }
  };
}
if (typeof DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint {
    constructor(x=0,y=0,z=0,w=1) { this.x=x;this.y=y;this.z=z;this.w=w; }
    static fromPoint(p={}) { return new DOMPoint(p.x,p.y,p.z,p.w); }
  };
}
if (typeof DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;
      this.is2D=true;this.isIdentity=true;
    }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array() { return new DOMMatrix(); }
    static fromFloat64Array() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint(p) { return new DOMPoint(p?.x||0,p?.y||0); }
  };
}
