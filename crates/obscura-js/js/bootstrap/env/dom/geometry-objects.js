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
// SVG geometry result interfaces (Chrome: non-constructible, own toStringTag,
// no prototype members beyond the field accessors the SVG producers install).
// They live in the bootstrap core so a deferred-surface frame realm answers
// branded records from getBBox/getExtentOfChar before hydration, where
// surface-finalize's interface table has not run; the table skips names that
// already exist, so hydration is a no-op for them.
function OBSCURA_INSTALL_SVG_GEOM_INTERFACE(name) {
  if (typeof globalThis[name] !== 'undefined') return;
  const ctor = { [name]: class {
      constructor() {
        throw new TypeError("Failed to construct '" + name + "': Illegal constructor");
      }
    } }[name];
  Object.defineProperty(ctor, 'name', { value: name, configurable: true });
  Object.defineProperty(ctor.prototype, Symbol.toStringTag,
    { value: name, configurable: true });
  Object.defineProperty(globalThis, name,
    { value: _markNative(ctor), writable: true, enumerable: false, configurable: true });
}
OBSCURA_INSTALL_SVG_GEOM_INTERFACE('SVGRect');
OBSCURA_INSTALL_SVG_GEOM_INTERFACE('SVGPoint');
OBSCURA_INSTALL_SVG_GEOM_INTERFACE('SVGMatrix');
// WebIDL emits `constructor` after the members the interface declares, and
// the own-key order of an interface prototype is as readable as the set. A
// class body emits it first, so the field accessors below install in Chrome's
// order and this moves the existing descriptor to the tail.
function OBSCURA_GEOM_CTOR_LAST(proto) {
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'constructor');
  if (!descriptor) return;
  delete proto.constructor;
  Object.defineProperty(proto, 'constructor', descriptor);
}
// WebIDL static interface members are enumerable; a class body's `static`
// methods are not (oracle headless Chrome: getOwnPropertyDescriptor(DOMRect,
// 'fromRect').enumerable === true). Redefining in place keeps the member's
// position on the constructor.
function OBSCURA_GEOM_ENUMERABLE_STATICS(ctor, names) {
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(ctor, name);
    if (!descriptor || descriptor.enumerable) continue;
    Object.defineProperty(ctor, name, {
      value: descriptor.value,
      writable: descriptor.writable,
      enumerable: true,
      configurable: descriptor.configurable,
    });
  }
}
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
  // Named, not method shorthand: the shorthand form inside a `value:` slot
  // takes the slot's key as its name, so toJSON would answer
  // Function.prototype.toString with "function value()".
  Object.defineProperty(readOnlyProto, 'toJSON', {
    value: function toJSON() {
      const s = OBSCURA_GEOM_SLOTS.get(this);
      return { x: s.x, y: s.y, width: s.width, height: s.height,
        top: this.top, right: this.right, bottom: this.bottom, left: this.left };
    },
    configurable: true, writable: true, enumerable: true,
  });
  OBSCURA_GEOM_ENUMERABLE_STATICS(globalThis.DOMRectReadOnly, ['fromRect']);
  OBSCURA_GEOM_CTOR_LAST(readOnlyProto);
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
  OBSCURA_GEOM_ENUMERABLE_STATICS(globalThis.DOMRect, ['fromRect']);
  OBSCURA_GEOM_CTOR_LAST(globalThis.DOMRect.prototype);
}
// DOMRectList. Chrome's instances carry one own property per index and nothing
// else: `length` is a prototype accessor, `item` a prototype method, and the
// constructor is illegal. Records that hold own `length` plus own index keys
// answer an own-key census with a set Chrome never produces, which is what the
// previous plain-object-shaped list did. The item array lives in a slot so the
// indexed own properties stay the only visible state.
const OBSCURA_RECT_LIST_SLOTS = new WeakMap();
// Internal builder. `new DOMRectList(...)` is the IDL's illegal constructor,
// so the engine's producers reach the list through this instead.
function OBSCURA_DOM_RECT_LIST(items) {
  const proto = globalThis.DOMRectList && globalThis.DOMRectList.prototype;
  if (!proto) return null;
  const list = Object.create(proto);
  const entries = [];
  for (let i = 0; i < items.length; i++) entries.push(items[i]);
  OBSCURA_RECT_LIST_SLOTS.set(list, entries);
  for (let i = 0; i < entries.length; i++) {
    // Chrome's indexed properties are enumerable and configurable but not
    // writable; a slot is the source of truth so the descriptors never need
    // rewriting.
    Object.defineProperty(list, i, {
      value: entries[i], enumerable: true, writable: false, configurable: true,
    });
  }
  return list;
}
if (typeof DOMRectList === 'undefined') {
  const RectListCtor = {
    DOMRectList: function DOMRectList() {
      throw new TypeError("Failed to construct 'DOMRectList': Illegal constructor");
    },
  }['DOMRectList'];
  const listProto = RectListCtor.prototype;
  const listCtorDesc = Object.getOwnPropertyDescriptor(listProto, 'constructor');
  delete listProto.constructor;
  const listEntryArray = function (self) { return OBSCURA_RECT_LIST_SLOTS.get(self); };
  // Declared with accessor syntax so V8 names the getter "get length" -- the
  // form Chrome's surface reports and _markNative reproduces verbatim.
  const listLength = {
    get length() { const e = listEntryArray(this); return e ? e.length : 0; },
  };
  Object.defineProperty(listProto, 'length', Object.assign(
    Object.getOwnPropertyDescriptor(listLength, 'length'),
    { enumerable: true, configurable: true }));
  Object.defineProperty(listProto, 'item', {
    value: function item(index) {
      const entries = listEntryArray(this);
      if (!entries) return null;
      const i = Number(index) | 0;
      return i >= 0 && i < entries.length ? entries[i] : null;
    },
    writable: true, enumerable: true, configurable: true,
  });
  if (listCtorDesc) Object.defineProperty(listProto, 'constructor', listCtorDesc);
  Object.defineProperty(listProto, Symbol.toStringTag,
    { value: 'DOMRectList', writable: false, enumerable: false, configurable: true });
  Object.defineProperty(RectListCtor, 'name',
    { value: 'DOMRectList', writable: false, enumerable: false, configurable: true });
  globalThis.DOMRectList = RectListCtor;
}
// DOMPoint/DOMPointReadOnly. Same own-key rule as the rects: Chrome's
// instances are empty and the fields are prototype accessors, with
// DOMPoint extending DOMPointReadOnly (so `point instanceof DOMPointReadOnly`
// is true, which the interface table's bare shell could not answer).
if (typeof DOMPointReadOnly === 'undefined') {
  globalThis.DOMPointReadOnly = {
    DOMPointReadOnly: class DOMPointReadOnly {
      constructor(x = 0, y = 0, z = 0, w = 1) {
        OBSCURA_GEOM_SLOTS.set(this, { x: +x, y: +y, z: +z, w: +w });
      }
      static fromPoint(p = {}) {
        return new DOMPointReadOnly(p.x, p.y, p.z, p.w);
      }
    },
  }['DOMPointReadOnly'];
  const pointReadOnlyProto = globalThis.DOMPointReadOnly.prototype;
  OBSCURA_GEOM_ACCESSORS(pointReadOnlyProto, ['x', 'y', 'z', 'w']);
  Object.defineProperty(pointReadOnlyProto, 'matrixTransform', {
    value: function matrixTransform() { return new DOMPoint(this.x, this.y, this.z, this.w); },
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(pointReadOnlyProto, 'toJSON', {
    value: function toJSON() {
      const s = OBSCURA_GEOM_SLOTS.get(this);
      return { x: s.x, y: s.y, z: s.z, w: s.w };
    },
    configurable: true, writable: true, enumerable: true,
  });
  OBSCURA_GEOM_ENUMERABLE_STATICS(globalThis.DOMPointReadOnly, ['fromPoint']);
  OBSCURA_GEOM_CTOR_LAST(pointReadOnlyProto);
}
if (typeof DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint extends globalThis.DOMPointReadOnly {
    static fromPoint(p = {}) { return new DOMPoint(p.x, p.y, p.z, p.w); }
  };
  const pointProto = globalThis.DOMPoint.prototype;
  for (const key of ['x', 'y', 'z', 'w']) {
    const desc = Object.getOwnPropertyDescriptor(
      globalThis.DOMPointReadOnly.prototype, key);
    Object.defineProperty(pointProto, key, {
      get: desc.get,
      set(v) { const slot = OBSCURA_GEOM_SLOTS.get(this); if (slot) slot[key] = +v; },
      configurable: true,
      enumerable: true,
    });
  }
  OBSCURA_GEOM_ENUMERABLE_STATICS(globalThis.DOMPoint, ['fromPoint']);
  OBSCURA_GEOM_CTOR_LAST(pointProto);
}
// DOMQuad. The interface table published a bare shell, so `new DOMQuad()`
// answered an empty prototype object: q.p1 was undefined where a browser
// hands back four DOMPoints, and the four fields plus getBounds/toJSON were
// absent from the prototype entirely. The points are read-only accessors over
// an internal slot (q.p1 === q.p1), and getBounds() is the xy bounding box of
// the four points as a DOMRect.
if (typeof globalThis.DOMQuad === 'undefined') {
  globalThis.DOMQuad = {
    DOMQuad: class DOMQuad {
      constructor(p1 = {}, p2 = {}, p3 = {}, p4 = {}) {
        OBSCURA_GEOM_SLOTS.set(this, {
          p1: new DOMPoint(p1.x, p1.y, p1.z, p1.w),
          p2: new DOMPoint(p2.x, p2.y, p2.z, p2.w),
          p3: new DOMPoint(p3.x, p3.y, p3.z, p3.w),
          p4: new DOMPoint(p4.x, p4.y, p4.z, p4.w),
        });
      }
    },
  }['DOMQuad'];
  const quadProto = globalThis.DOMQuad.prototype;
  for (const key of ['p1', 'p2', 'p3', 'p4']) {
    // Accessor syntax in a throwaway object: reading the descriptor back gives
    // the getter function itself, and V8 names it "get p1" as Chrome does.
    const holder = { get [key]() { const s = OBSCURA_GEOM_SLOTS.get(this); return s && s[key]; } };
    Object.defineProperty(quadProto, key, {
      get: Object.getOwnPropertyDescriptor(holder, key).get,
      enumerable: true,
      configurable: true,
    });
  }
  Object.defineProperty(quadProto, 'getBounds', {
    value: function getBounds() {
      const s = OBSCURA_GEOM_SLOTS.get(this);
      const points = [s.p1, s.p2, s.p3, s.p4];
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const point of points) {
        if (point.x < left) left = point.x;
        if (point.y < top) top = point.y;
        if (point.x > right) right = point.x;
        if (point.y > bottom) bottom = point.y;
      }
      return new DOMRect(left, top, right - left, bottom - top);
    },
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(quadProto, 'toJSON', {
    value: function toJSON() {
      const s = OBSCURA_GEOM_SLOTS.get(this);
      return { p1: s.p1.toJSON(), p2: s.p2.toJSON(),
        p3: s.p3.toJSON(), p4: s.p4.toJSON() };
    },
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(quadProto, Symbol.toStringTag,
    { value: 'DOMQuad', writable: false, enumerable: false, configurable: true });
  OBSCURA_GEOM_CTOR_LAST(quadProto);
  _markNative(globalThis.DOMQuad);
  Object.defineProperty(globalThis.DOMQuad, 'name',
    { value: 'DOMQuad', writable: false, enumerable: false, configurable: true });
  // Chrome's constructor publishes fromQuad before fromRect (its own-key
  // order, oracle headless Chrome 153).
  Object.defineProperty(globalThis.DOMQuad, 'fromQuad', {
    value: _markNative(function fromQuad(quad = {}) {
      return new DOMQuad(quad.p1, quad.p2, quad.p3, quad.p4);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(globalThis.DOMQuad, 'fromRect', {
    value: _markNative(function fromRect(rect = {}) {
      const x = rect.x || 0, y = rect.y || 0;
      const width = rect.width || 0, height = rect.height || 0;
      return new DOMQuad(
        { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height });
    }),
    writable: true, enumerable: true, configurable: true,
  });
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

// VisualViewport. Chrome's is an EventTarget-derived interface whose fields sit
// behind prototype accessors: Object.keys(visualViewport) and
// Object.getOwnPropertyNames(visualViewport) are both empty, the fields appear
// in for-in through the prototype, and `visualViewport instanceof
// VisualViewport` is true on a chain of VisualViewport > EventTarget. The
// placeholder this replaces was a plain object literal that carried all seven
// fields plus two listener stubs as own enumerable keys and answered
// `[object VisualViewport]` from a symbol it owned -- an own-key census no
// browser produces.
//
// Every field derives from live window state rather than from values frozen at
// init: pageLeft/pageTop are the layout viewport's document offsets, and
// width/height are the layout viewport's size divided by scale (always 1 here,
// since nothing pinches or pans the visual viewport independently of layout).
// That is also what keeps a frame realm correct -- its viewport is its iframe's
// content box, which can change without the realm being recreated, and its
// innerWidth/innerHeight are already live accessors by then.
//
// The interface lives in the bootstrap core (this module) rather than next to
// the instance it publishes (env/window/geometry.js, deferred surface) because
// __obscura_init, which mints the per-page instance, is core-half code and
// cannot see a deferred module's lexical bindings.
const OBSCURA_VISUAL_VIEWPORT_SLOTS = new WeakMap();
const OBSCURA_VISUAL_VIEWPORT_KEY = Symbol('VisualViewport construction');
function OBSCURA_VISUAL_VIEWPORT_NEW() {
  return new globalThis.VisualViewport(OBSCURA_VISUAL_VIEWPORT_KEY);
}
// An event handler IDL attribute *is* a listener: assigning replaces the
// previous one and assigning null removes it, which is what the panel of
// onresize/onscroll/onscrollend accessors below implements. The assigned
// function stays the one the accessor reads back.
function OBSCURA_VISUAL_VIEWPORT_SET_HANDLER(vv, name, value) {
  const slot = OBSCURA_VISUAL_VIEWPORT_SLOTS.get(vv);
  if (!slot) return;
  const next = typeof value === 'function' ? value : null;
  const previous = slot.handlers[name] || null;
  if (previous === next) return;
  slot.handlers[name] = next;
  const type = name.slice(2);
  if (previous) { try { vv.removeEventListener(type, previous); } catch (_e) {} }
  if (next) { try { vv.addEventListener(type, next); } catch (_e) {} }
}
if (typeof globalThis.VisualViewport === 'undefined') {
  const VisualViewportCtor = class VisualViewport extends EventTarget {
    constructor(key) {
      if (key !== OBSCURA_VISUAL_VIEWPORT_KEY) {
        throw new TypeError("Failed to construct 'VisualViewport': Illegal constructor");
      }
      super();
      OBSCURA_VISUAL_VIEWPORT_SLOTS.set(this, { handlers: Object.create(null) });
    }
  };
  // The declared argument list is the construction key, so the generated
  // arity would be 1; Chrome's interface has none.
  Object.defineProperty(VisualViewportCtor, 'length', { value: 0, configurable: true });
  Object.defineProperty(VisualViewportCtor, 'name',
    { value: 'VisualViewport', configurable: true });
  const viewportProto = VisualViewportCtor.prototype;
  const viewportCtorDesc = Object.getOwnPropertyDescriptor(viewportProto, 'constructor');
  delete viewportProto.constructor;
  const slotOf = (self) => OBSCURA_VISUAL_VIEWPORT_SLOTS.get(self);
  const accessor = (name, read, write) => {
    // Accessor syntax with a computed key: V8 names the getter "get <name>",
    // the form a Chrome surface reports.
    const box = write
      ? { get [name]() { return read(this); }, set [name](v) { write(this, v); } }
      : { get [name]() { return read(this); } };
    const descriptor = Object.getOwnPropertyDescriptor(box, name);
    Object.defineProperty(viewportProto, name, {
      get: descriptor.get, set: descriptor.set,
      enumerable: true, configurable: true,
    });
  };
  accessor('offsetLeft', () => 0);
  accessor('offsetTop', () => 0);
  accessor('pageLeft', () => globalThis.scrollX || 0);
  accessor('pageTop', () => globalThis.scrollY || 0);
  accessor('width', function () {
    const width = globalThis.innerWidth;
    return typeof width === 'number' ? width : 0;
  });
  accessor('height', function () {
    const height = globalThis.innerHeight;
    return typeof height === 'number' ? height : 0;
  });
  accessor('scale', () => 1);
  for (const name of ['onresize', 'onscroll', 'onscrollend']) {
    accessor(
      name,
      function (self) {
        const slot = slotOf(self);
        const handler = slot && slot.handlers[name];
        return handler === undefined ? null : handler;
      },
      function (self, value) { OBSCURA_VISUAL_VIEWPORT_SET_HANDLER(self, name, value); });
  }
  if (viewportCtorDesc) Object.defineProperty(viewportProto, 'constructor', viewportCtorDesc);
  Object.defineProperty(viewportProto, Symbol.toStringTag,
    { value: 'VisualViewport', writable: false, enumerable: false, configurable: true });
  Object.defineProperty(globalThis, 'VisualViewport',
    { value: _markNative(VisualViewportCtor), writable: true, enumerable: false, configurable: true });
}
