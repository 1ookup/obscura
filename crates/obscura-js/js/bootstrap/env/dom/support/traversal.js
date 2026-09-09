// Shared TreeWalker and NodeIterator state/algorithms. Object modules expose
// the WebIDL shape while this module keeps cursor state out of own properties.
const _treeWalkerKey = Symbol('TreeWalker construction');
const _treeWalkerState = new WeakMap();
const _nodeIteratorKey = Symbol('NodeIterator construction');
const _nodeIteratorState = new WeakMap();

function _treeWalkerData(value) {
  const state = _treeWalkerState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _nodeIteratorData(value) {
  const state = _nodeIteratorState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _traversalFilter(state, node) {
  if (!((state.whatToShow >> (node.nodeType - 1)) & 1)) return 3;
  const filter = state.filter;
  if (filter) {
    if (typeof filter === 'function') return filter(node);
    if (typeof filter.acceptNode === 'function') return filter.acceptNode(node);
  }
  return 1;
}
function _treeWalkerAccept(state, node) {
  return _traversalFilter(state, node) === 1;
}

function _treeWalkerNext(value) {
  const state = _treeWalkerData(value);
  let node = _wrap(+_dom('next_in_subtree', state.root[_nidSym], state.currentNode[_nidSym]));
  while (node) {
    const verdict = _traversalFilter(state, node);
    if (verdict === 1) { state.currentNode = node; return node; }
    const step = verdict === 2 ? 'next_after_subtree' : 'next_in_subtree';
    node = _wrap(+_dom(step, state.root[_nidSym], node[_nidSym]));
  }
  return null;
}
function _treeWalkerPrevious(value) {
  const state = _treeWalkerData(value);
  let node = state.currentNode;
  while (node !== state.root) {
    let sibling = node.previousSibling;
    while (sibling) {
      node = sibling;
      let verdict = _traversalFilter(state, node);
      while (verdict !== 2 && node.lastChild) {
        node = node.lastChild;
        verdict = _traversalFilter(state, node);
      }
      if (verdict === 1) { state.currentNode = node; return node; }
      sibling = node.previousSibling;
    }
    const parent = node.parentNode;
    if (!parent || node === state.root) return null;
    node = parent;
    if (node === state.root) return null;
    if (_treeWalkerAccept(state, node)) { state.currentNode = node; return node; }
  }
  return null;
}
function _treeWalkerTraverseChildren(value, edge, step) {
  const state = _treeWalkerData(value);
  let node = state.currentNode[edge];
  while (node) {
    const verdict = _traversalFilter(state, node);
    if (verdict === 1) { state.currentNode = node; return node; }
    if (verdict === 3) {
      const child = node[edge];
      if (child) { node = child; continue; }
    }
    while (node) {
      const sibling = node[step];
      if (sibling) { node = sibling; break; }
      const parent = node.parentNode;
      if (!parent || parent === state.root || parent === state.currentNode) return null;
      node = parent;
    }
  }
  return null;
}
function _treeWalkerTraverseSiblings(value, edge, step) {
  const state = _treeWalkerData(value);
  let node = state.currentNode;
  if (node === state.root) return null;
  for (;;) {
    let sibling = node[step];
    while (sibling) {
      node = sibling;
      const verdict = _traversalFilter(state, node);
      if (verdict === 1) { state.currentNode = node; return node; }
      sibling = node[edge];
      if (verdict === 2 || !sibling) sibling = node[step];
    }
    node = node.parentNode;
    if (!node || node === state.root) return null;
    if (_treeWalkerAccept(state, node)) return null;
  }
}
function _treeWalkerParent(value) {
  const state = _treeWalkerData(value);
  let node = state.currentNode;
  while (node && node !== state.root) {
    node = node.parentNode;
    if (node && _treeWalkerAccept(state, node)) {
      state.currentNode = node;
      return node;
    }
  }
  return null;
}

function _nodeIteratorAccept(state, node) {
  return _traversalFilter(state, node) === 1;
}
function _nodeIteratorTraverse(value, forward) {
  const state = _nodeIteratorData(value);
  let node = state.referenceNode;
  let before = state.pointerBeforeReferenceNode;
  for (;;) {
    if (forward === before) {
      before = !before;
    } else {
      const step = forward ? 'next_in_subtree' : 'prev_in_subtree';
      const next = _wrap(+_dom(step, state.root[_nidSym], node[_nidSym]));
      if (!next) return null;
      node = next;
    }
    if (_nodeIteratorAccept(state, node)) break;
  }
  state.referenceNode = node;
  state.pointerBeforeReferenceNode = before;
  return node;
}
