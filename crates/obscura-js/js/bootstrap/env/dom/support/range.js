// Shared boundary-point helpers for Range and StaticRange.
function _rngNodeLength(node) {
  const type = node.nodeType;
  if (type === 3 || type === 4 || type === 8 || type === 7) {
    return (node.data || node.nodeValue || '').length;
  }
  return node.childNodes.length;
}
function _rngNodeIndex(node) {
  if (!node.parentNode) return 0;
  return +_dom('node_index', node[_nidSym]);
}
function _rngSame(a, b) {
  return a === b || (!!a && !!b && a[_nidSym] === b[_nidSym]);
}
function _rngRoot(node) {
  return { _nid: +_dom('node_root', node[_nidSym]) };
}
function _rngAncestors(node) {
  const ancestors = [];
  let current = node;
  while (current) { ancestors.push(current); current = current.parentNode; }
  return ancestors;
}
function _rngOrder(a, b) {
  if (_rngSame(a, b)) return 0;
  return +_dom('compare_order', a[_nidSym], b[_nidSym]) || 0;
}
function _rngCmp(nodeA, offsetA, nodeB, offsetB) {
  if (_rngSame(nodeA, nodeB)) return offsetA < offsetB ? -1 : (offsetA > offsetB ? 1 : 0);
  if (_rngOrder(nodeA, nodeB) > 0) return -_rngCmp(nodeB, offsetB, nodeA, offsetA);
  if (nodeA.contains && nodeA.contains(nodeB)) {
    let child = nodeB;
    while (child && child.parentNode && child.parentNode[_nidSym] !== nodeA[_nidSym]) {
      child = child.parentNode;
    }
    if (child && child.parentNode && child.parentNode[_nidSym] === nodeA[_nidSym]
        && _rngNodeIndex(child) < offsetA) return 1;
    return -1;
  }
  return -1;
}
function _rngCheckOffset(node, offset) {
  if (node && node.nodeType === 10) {
    throw new DOMException('Range boundary cannot be a DocumentType', 'InvalidNodeTypeError');
  }
  if (offset < 0 || offset > _rngNodeLength(node)) {
    throw new DOMException('Range offset out of bounds', 'IndexSizeError');
  }
}
