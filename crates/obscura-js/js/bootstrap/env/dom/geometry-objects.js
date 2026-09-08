// Geometry value objects. Each interface is exposed independently while the
// retained layout pipeline continues to consume the same global constructors.
if (typeof DOMRectReadOnly === 'undefined') {
  globalThis.DOMRectReadOnly = class DOMRectReadOnly {
    constructor(x=0,y=0,w=0,h=0) {
      this.x=x;this.y=y;this.width=w;this.height=h;
      this.top=y;this.right=x+w;this.bottom=y+h;this.left=x;
    }
    toJSON() {
      return {x:this.x,y:this.y,width:this.width,height:this.height,
        top:this.top,right:this.right,bottom:this.bottom,left:this.left};
    }
    static fromRect(r={}) { return new DOMRectReadOnly(r.x,r.y,r.width,r.height); }
  };
}
if (typeof DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRect extends DOMRectReadOnly {
    static fromRect(r={}) { return new DOMRect(r.x,r.y,r.width,r.height); }
  };
}
if (typeof DOMRectList === 'undefined') {
  globalThis.DOMRectList = class DOMRectList {
    constructor(arr=[]) {
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
