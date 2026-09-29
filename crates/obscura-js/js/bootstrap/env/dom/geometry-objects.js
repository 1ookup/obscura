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
// DOMMatrix / DOMMatrixReadOnly. Chrome publishes the matrix as two
// interfaces: the read-only base owns the derived-view accessors and the
// non-mutating operations, DOMMatrix extends it and adds the *Self mutators
// plus setMatrixValue. Values live in the shared geometry slot -- instances
// carry no own keys, the earlier stub's `this.a = 1` own assignments read as
// an own-key census no browser produces. DOMMatrix.prototype's own-key order
// follows the WebIDL declaration order: the 2D/3D field accessors, the
// eleven *Self mutators, the constructor, and setMatrixValue last (Chrome
// 153 oracle; the bench8 proto-order scan reads exactly this list). The
// earlier stub kept the legacy WebKitCSSMatrix-style methods on the same
// prototype, and ctx.getTransform() answered a bare object literal whose
// prototype was Object.prototype outright.
const _OBSCURA_MATRIX_FIELDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const _OBSCURA_MATRIX_3D = [
  'm11', 'm12', 'm13', 'm14', 'm21', 'm22', 'm23', 'm24',
  'm31', 'm32', 'm33', 'm34', 'm41', 'm42', 'm43', 'm44',
];
// The 2D triple answers the 3D entry it aliases; the remaining eight 3D
// entries hold the values a purely 2D matrix keeps.
function _obscuraMatrix3D(slot, name) {
  switch (name) {
    case 'm11': return slot.a;
    case 'm12': return slot.b;
    case 'm21': return slot.c;
    case 'm22': return slot.d;
    case 'm41': return slot.e;
    case 'm42': return slot.f;
    case 'm33': case 'm44': return 1;
    default: return 0;
  }
}
function _obscuraMatrixSlotOf(value) {
  const slot = OBSCURA_GEOM_SLOTS.get(value);
  return slot && typeof slot.a === 'number' ? slot : null;
}
function _obscuraMatrixIsIdentity(slot) {
  return slot.a === 1 && slot.b === 0 && slot.c === 0 && slot.d === 1
    && slot.e === 0 && slot.f === 0;
}
// Matrix composition: (s x o), the order the ctx transform methods use.
function _obscuraMatrix2DMul(s, o) {
  return {
    a: s.a * o.a + s.c * o.b,
    b: s.b * o.a + s.d * o.b,
    c: s.a * o.c + s.c * o.d,
    d: s.b * o.c + s.d * o.d,
    e: s.a * o.e + s.c * o.f + s.e,
    f: s.b * o.e + s.d * o.f + s.f,
  };
}
function _obscuraMatrix2DTranslate(x, y) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}
function _obscuraMatrix2DScale(sx, sy) {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}
function _obscuraMatrix2DRotateZ(deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}
// WebIDL DOMMatrixInit: a 6- or 16-entry sequence, or a value answering a/f
// (a DOMMatrix*, DOMPoint, DOMRect). Anything else constructs the identity,
// the shape the earlier stub answered for every input.
function _obscuraMatrixInit(init) {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (init === undefined || init === null) return identity;
  if (typeof init === 'object' && typeof init.a === 'number') {
    return { a: init.a, b: init.b, c: init.c, d: init.d, e: init.e, f: init.f };
  }
  if (typeof init.length === 'number') {
    if (init.length === 6) {
      return { a: +init[0], b: +init[1], c: +init[2], d: +init[3], e: +init[4], f: +init[5] };
    }
    if (init.length === 16) {
      return { a: +init[0], b: +init[1], c: +init[4], d: +init[5], e: +init[12], f: +init[13] };
    }
  }
  return identity;
}
if (typeof DOMMatrixReadOnly === 'undefined') {
  const ReadOnlyCtor = class DOMMatrixReadOnly {
    constructor(init) {
      OBSCURA_GEOM_SLOTS.set(this, _obscuraMatrixInit(init));
    }
    static fromMatrix(init = {}) { return new DOMMatrixReadOnly(init); }
    static fromFloat32Array(array) { return new DOMMatrixReadOnly(array); }
    static fromFloat64Array(array) { return new DOMMatrixReadOnly(array); }
  };
  const readOnlyProto = ReadOnlyCtor.prototype;
  const readOnlyAccessor = (name, read) => {
    const box = { get [name]() { return read(this); } };
    const descriptor = Object.getOwnPropertyDescriptor(box, name);
    Object.defineProperty(readOnlyProto, name, {
      get: descriptor.get, enumerable: true, configurable: true,
    });
  };
  for (const name of _OBSCURA_MATRIX_FIELDS) {
    readOnlyAccessor(name, (self) => _obscuraMatrixSlotOf(self)?.[name]);
  }
  for (const name of _OBSCURA_MATRIX_3D) {
    readOnlyAccessor(name, (self) => {
      const slot = _obscuraMatrixSlotOf(self);
      return slot ? _obscuraMatrix3D(slot, name) : undefined;
    });
  }
  readOnlyAccessor('is2D', () => true);
  readOnlyAccessor('isIdentity', (self) => {
    const slot = _obscuraMatrixSlotOf(self);
    return slot ? _obscuraMatrixIsIdentity(slot) : false;
  });
  const readOnlyOperate = (name, apply) => {
    // Named via a computed-key literal: a bare `function [name]()` is not
    // legal syntax, and the reference answers the member name from
    // Function.prototype.toString.
    const fn = { [name](...args) {
      const slot = _obscuraMatrixSlotOf(this);
      if (!slot) throw new TypeError('Illegal invocation');
      return new DOMMatrixReadOnly(apply(slot, ...args));
    } }[name];
    Object.defineProperty(readOnlyProto, name, {
      value: _markNative(fn),
      writable: true, enumerable: true, configurable: true,
    });
  };
  readOnlyOperate('multiply', (slot, other = {}) => _obscuraMatrix2DMul(slot, _obscuraMatrixInit(other)));
  readOnlyOperate('inverse', (slot) => {
    const det = slot.a * slot.d - slot.b * slot.c;
    if (!det) return { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN };
    return {
      a: slot.d / det, b: -slot.b / det, c: -slot.c / det, d: slot.a / det,
      e: (slot.c * slot.f - slot.d * slot.e) / det,
      f: (slot.b * slot.e - slot.a * slot.f) / det,
    };
  });
  readOnlyOperate('translate', (slot, x = 0, y = 0) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DTranslate(+x, +y)));
  readOnlyOperate('scale', (slot, scaleX = 1, scaleY = scaleX) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DScale(+scaleX, +scaleY)));
  readOnlyOperate('rotate', (slot, angle = 0) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DRotateZ(+angle)));
  readOnlyOperate('rotateFromVector', (slot, x = 0, y = 0) => (
    (+x || +y) ? _obscuraMatrix2DMul(slot, _obscuraMatrix2DRotateZ(Math.atan2(+y, +x) * 180 / Math.PI)) : slot
  ));
  Object.defineProperty(readOnlyProto, 'transformPoint', {
    value: _markNative(function transformPoint(point = {}) {
      const slot = _obscuraMatrixSlotOf(this);
      const x = +(point?.x || 0), y = +(point?.y || 0);
      const px = slot.a * x + slot.c * y + slot.e;
      const py = slot.b * x + slot.d * y + slot.f;
      return new DOMPoint(px, py, 0, 1);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  OBSCURA_GEOM_ENUMERABLE_STATICS(ReadOnlyCtor,
    ['fromMatrix', 'fromFloat32Array', 'fromFloat64Array']);
  OBSCURA_GEOM_CTOR_LAST(readOnlyProto);
  _markNative(globalThis.DOMMatrixReadOnly = ReadOnlyCtor);
  Object.defineProperty(ReadOnlyCtor, 'name', { value: 'DOMMatrixReadOnly', configurable: true });
}
if (typeof DOMMatrix === 'undefined') {
  const MatrixCtor = class DOMMatrix extends DOMMatrixReadOnly {
    constructor(init) {
      super(init);
    }
  };
  const matrixProto = MatrixCtor.prototype;
  // Writable 2D fields (a write re-syncs the aliasing 3D entry through the
  // shared slot); the 3D entries and the derived views stay read-only, the
  // way Chrome's interface declares them.
  for (const name of _OBSCURA_MATRIX_FIELDS) {
    const box = { get [name]() { return _obscuraMatrixSlotOf(this)?.[name]; },
      set [name](v) { const slot = _obscuraMatrixSlotOf(this); if (slot) slot[name] = +v; } };
    const descriptor = Object.getOwnPropertyDescriptor(box, name);
    Object.defineProperty(matrixProto, name, {
      get: descriptor.get, set: descriptor.set,
      enumerable: true, configurable: true,
    });
  }
  for (const name of _OBSCURA_MATRIX_3D) {
    const box = { get [name]() {
      const slot = _obscuraMatrixSlotOf(this);
      return slot ? _obscuraMatrix3D(slot, name) : undefined;
    } };
    const descriptor = Object.getOwnPropertyDescriptor(box, name);
    Object.defineProperty(matrixProto, name, {
      get: descriptor.get, enumerable: true, configurable: true,
    });
  }
  // is2D/isIdentity stay on DOMMatrixReadOnly.prototype: Chrome's
  // DOMMatrix.prototype own-key census stops at the eleven *Self mutators,
  // and the derived views read through the prototype chain regardless.
  const mutate = (name, apply) => {
    // Declaration order matters: the *Self mutators install in Chrome's
    // own-key order (alphabetical, between the field accessors and the
    // constructor), so the mutate calls below must run in that exact
    // sequence. Same computed-key literal trick as the read-only side.
    const fn = { [name](...args) {
      const slot = _obscuraMatrixSlotOf(this);
      if (!slot) throw new TypeError('Illegal invocation');
      Object.assign(slot, apply(slot, ...args));
      return this;
    } }[name];
    Object.defineProperty(matrixProto, name, {
      value: _markNative(fn),
      writable: true, enumerable: true, configurable: true,
    });
  };
  mutate('invertSelf', (slot) => {
    const det = slot.a * slot.d - slot.b * slot.c;
    if (!det) return { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN };
    return {
      a: slot.d / det, b: -slot.b / det, c: -slot.c / det, d: slot.a / det,
      e: (slot.c * slot.f - slot.d * slot.e) / det,
      f: (slot.b * slot.e - slot.a * slot.f) / det,
    };
  });
  mutate('multiplySelf', (slot, other = {}) => _obscuraMatrix2DMul(slot, _obscuraMatrixInit(other)));
  mutate('preMultiplySelf', (slot, other = {}) => _obscuraMatrix2DMul(_obscuraMatrixInit(other), slot));
  mutate('rotateAxisAngleSelf', (slot, _x = 0, _y = 0, _z = 0, angle = 0) => (
    _obscuraMatrix2DMul(slot, _obscuraMatrix2DRotateZ(+angle))
  ));
  mutate('rotateFromVectorSelf', (slot, x = 0, y = 0) => (
    (+x || +y) ? _obscuraMatrix2DMul(slot, _obscuraMatrix2DRotateZ(Math.atan2(+y, +x) * 180 / Math.PI)) : slot
  ));
  mutate('rotateSelf', (slot, angle = 0) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DRotateZ(+angle)));
  mutate('scale3dSelf', (slot, scale = 1) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DScale(+scale, +scale)));
  mutate('scaleSelf', (slot, scaleX = 1, scaleY = scaleX) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DScale(+scaleX, +scaleY)));
  mutate('skewXSelf', (slot, sx = 0) => {
    const rad = (+sx * Math.PI) / 180;
    return _obscuraMatrix2DMul(slot, { a: 1, b: 0, c: Math.tan(rad), d: 1, e: 0, f: 0 });
  });
  mutate('skewYSelf', (slot, sy = 0) => {
    const rad = (+sy * Math.PI) / 180;
    return _obscuraMatrix2DMul(slot, { a: 1, b: Math.tan(rad), c: 0, d: 1, e: 0, f: 0 });
  });
  mutate('translateSelf', (slot, x = 0, y = 0) => _obscuraMatrix2DMul(slot, _obscuraMatrix2DTranslate(+x, +y)));
  // Chrome carries setMatrixValue *after* the constructor in the own-key
  // order, the one member that breaks the members-then-constructor rule.
  Object.defineProperty(matrixProto, 'setMatrixValue', {
    value: _markNative(function setMatrixValue(transformList) {
      const slot = _obscuraMatrixSlotOf(this);
      if (!slot) throw new TypeError('Illegal invocation');
      void transformList;
      Object.assign(slot, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return this;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  OBSCURA_GEOM_CTOR_LAST(matrixProto);
  _markNative(globalThis.DOMMatrix = MatrixCtor);
  Object.defineProperty(MatrixCtor, 'name', { value: 'DOMMatrix', configurable: true });
  Object.defineProperty(MatrixCtor, 'fromMatrix', {
    value: _markNative(function fromMatrix(init = {}) { return new DOMMatrix(init); }),
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(MatrixCtor, 'fromFloat32Array', {
    value: _markNative(function fromFloat32Array(array) { return new DOMMatrix(array); }),
    writable: true, enumerable: true, configurable: true,
  });
  Object.defineProperty(MatrixCtor, 'fromFloat64Array', {
    value: _markNative(function fromFloat64Array(array) { return new DOMMatrix(array); }),
    writable: true, enumerable: true, configurable: true,
  });
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
