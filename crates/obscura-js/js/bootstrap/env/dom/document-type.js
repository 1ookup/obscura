class DocumentType extends Node {
  constructor(nid, name, publicId, systemId) {
    super(nid);
    _hset(this, "_name", name);
    _hset(this, "_publicId", publicId);
    _hset(this, "_systemId", systemId);
  }
  // Only the three doctype fields are own members here. nodeType, nodeName,
  // nodeValue and ownerDocument belong to Node.prototype in Chrome, and
  // redeclaring them put four extra names on the prototype a probe reads;
  // Node's own implementations answer 10, the doctype name, null and the
  // owning document for this node.
  get name() { return this._name; }
  get publicId() { return this._publicId; }
  get systemId() { return this._systemId; }
}

// Chrome's member order is the three doctype fields, then ChildNode's four
// operations, then `constructor`. A class body emits the constructor first
// and the ChildNode mixin (env/dom/child-node.js) adds its four afterwards,
// so the constructor is rebuilt into Chrome's slot on the first probe of the
// prototype -- after the mixin has run at module time, which is why this is
// a getter-triggered pass as well as a module-time one.
// Chrome's order, which is also the order its own mixin installation leaves:
// the three doctype fields, then ChildNode's four in the order after, before,
// remove, replaceWith, then the constructor.
const _chromeDocumentTypeMemberOrder = [
  'name', 'publicId', 'systemId', 'after', 'before', 'remove', 'replaceWith', 'constructor',
];
function _parkDocumentTypeConstructor() {
  const prototype = DocumentType.prototype;
  const current = Object.getOwnPropertyNames(prototype);
  const wanted = _chromeDocumentTypeMemberOrder.filter(name => current.includes(name));
  const extras = current.filter(name => !wanted.includes(name));
  const order = [...wanted, ...extras];
  if (order.length === current.length && order.every((name, index) => name === current[index])) {
    return;
  }
  const descriptors = new Map();
  for (const name of current) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(prototype, name));
  }
  for (const name of current) {
    try { delete prototype[name]; } catch (_e) {}
  }
  for (const name of order) {
    const descriptor = descriptors.get(name);
    if (!descriptor) continue;
    try { Object.defineProperty(prototype, name, descriptor); } catch (_e) {}
  }
}
globalThis.__obscura_park_document_type_constructor = _parkDocumentTypeConstructor;
