globalThis.TreeWalker = class TreeWalker {
  constructor(key = undefined, root, whatToShow, filter) {
    if (key !== _treeWalkerKey) {
      throw new TypeError("Failed to construct 'TreeWalker': Illegal constructor");
    }
    _treeWalkerState.set(this, {
      root, currentNode: root, whatToShow, filter: filter || null,
    });
  }
  get root() { return _treeWalkerData(this).root; }
  get whatToShow() { return _treeWalkerData(this).whatToShow; }
  get filter() { return _treeWalkerData(this).filter; }
  get currentNode() { return _treeWalkerData(this).currentNode; }
  set currentNode(node) {
    // Interface conversion must accept a Node wrapper from another realm;
    // `instanceof Node` is realm-local, while the private nid symbol is shared.
    if (!node || typeof node[_nidSym] !== 'number') {
      throw new TypeError("Failed to set 'currentNode' on 'TreeWalker': The provided value is not of type 'Node'.");
    }
    _treeWalkerData(this).currentNode = node;
  }
  parentNode() { return _treeWalkerParent(this); }
  firstChild() { return _treeWalkerTraverseChildren(this, 'firstChild', 'nextSibling'); }
  lastChild() { return _treeWalkerTraverseChildren(this, 'lastChild', 'previousSibling'); }
  previousSibling() {
    return _treeWalkerTraverseSiblings(this, 'lastChild', 'previousSibling');
  }
  nextSibling() { return _treeWalkerTraverseSiblings(this, 'firstChild', 'nextSibling'); }
  previousNode() { return _treeWalkerPrevious(this); }
  nextNode() { return _treeWalkerNext(this); }
  get [Symbol.toStringTag]() { return 'TreeWalker'; }
};
