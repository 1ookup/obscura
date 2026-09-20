// The element storage lives in a WeakMap owned by support/collections.js and
// is reached through a shared-trap proxy, mirroring HTMLCollection. Chrome's
// NodeList instances carry `length` only as a prototype getter; the indexed
// entries are enumerable platform properties (oracle, Chrome 153: an
// non-empty list answers ["0"] for Object.keys and {"0":{}} for
// JSON.stringify, with no "length" anywhere), so an own length/index
// implementation here was itself a fingerprint surface.
const _nodeListCtorKey = _nodeListKey;
globalThis.NodeList = class NodeList {
  constructor(key = undefined, values = undefined) {
    if (key !== _nodeListCtorKey) {
      throw new TypeError("Failed to construct 'NodeList': Illegal constructor");
    }
    _nodeListValues.set(this, values || []);
  }
  get length() { return _nodeListData(this).length; }
  item(i) { i = i >>> 0; const v = _nodeListData(this); return v[i] != null ? v[i] : null; }
  forEach(cb, thisArg) {
    const v = _nodeListData(this);
    for (let i = 0; i < v.length; i++) cb.call(thisArg, v[i], i, this);
  }
  *[Symbol.iterator]() { yield* _nodeListData(this); }
  *entries() {
    const v = _nodeListData(this);
    for (let i = 0; i < v.length; i++) yield [i, v[i]];
  }
  *keys() { for (let i = 0; i < _nodeListData(this).length; i++) yield i; }
  *values() { yield* _nodeListData(this); }
  get [Symbol.toStringTag]() { return 'NodeList'; }
};
_markNative(NodeList);
_markNative(NodeList.prototype.item);
_markNative(NodeList.prototype.forEach);
