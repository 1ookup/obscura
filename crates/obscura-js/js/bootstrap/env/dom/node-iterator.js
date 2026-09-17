globalThis.NodeIterator = class NodeIterator {
  constructor(key = undefined, root, whatToShow, filter) {
    if (key !== _nodeIteratorKey) {
      throw new TypeError("Failed to construct 'NodeIterator': Illegal constructor");
    }
    _nodeIteratorState.set(this, {
      root, referenceNode: root, pointerBeforeReferenceNode: true,
      whatToShow, filter: filter || null,
    });
  }
  get root() { return _nodeIteratorData(this).root; }
  get referenceNode() { return _nodeIteratorData(this).referenceNode; }
  get pointerBeforeReferenceNode() {
    return _nodeIteratorData(this).pointerBeforeReferenceNode;
  }
  get whatToShow() { return _nodeIteratorData(this).whatToShow; }
  get filter() { return _nodeIteratorData(this).filter; }
  nextNode() { return _nodeIteratorTraverse(this, true); }
  previousNode() { return _nodeIteratorTraverse(this, false); }
  detach() {}
  get [Symbol.toStringTag]() { return 'NodeIterator'; }
};
