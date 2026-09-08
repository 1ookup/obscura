function _isXMLDocument(doc) {
  const ct = (doc && doc.contentType) || "text/html";
  return ct !== "text/html";
}
// XML Name production, sufficient for createProcessingInstruction targets.
const _piNameStart = "A-Za-z_:\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
const _piNameChar = _piNameStart + "0-9.\\u00B7\\u0300-\\u036F\\u203F-\\u2040\\-";
const _piNameRe = new RegExp("^[" + _piNameStart + "][" + _piNameChar + "]*$");
function _isValidPITarget(target) {
  return typeof target === "string" && target.length > 0 && _piNameRe.test(target);
}
globalThis.DocumentFragment = DocumentFragment;
globalThis.DocumentType = DocumentType;
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.Document = Document;
for (const name of ["hasPrivateToken", "hasRedemptionRecord", "hasStorageAccess"]) {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
  if (descriptor) {
    descriptor.enumerable = true;
    Object.defineProperty(Document.prototype, name, descriptor);
  }
}
// CSSStyleDeclaration is the type of element.style and getComputedStyle(); it is
// pre-declared non-enumerable in _preHideInternals, but unlike the other WebIDL
// interfaces it had no value assignment, leaving `window.CSSStyleDeclaration`
// undefined (so `el.style instanceof CSSStyleDeclaration` threw). Assigning here
// only fills the value; the property stays enumerable:false, matching Chrome.
globalThis.CSSStyleDeclaration = CSSStyleDeclaration;
globalThis.Animation = Animation;
globalThis.KeyframeEffect = KeyframeEffect;
globalThis.DocumentTimeline = DocumentTimeline;
globalThis.XPathResult = globalThis.XPathResult || class XPathResult {};
Object.assign(globalThis.XPathResult, {
  ANY_TYPE: 0,
  NUMBER_TYPE: 1,
  STRING_TYPE: 2,
  BOOLEAN_TYPE: 3,
  UNORDERED_NODE_ITERATOR_TYPE: 4,
  ORDERED_NODE_ITERATOR_TYPE: 5,
  UNORDERED_NODE_SNAPSHOT_TYPE: 6,
  ORDERED_NODE_SNAPSHOT_TYPE: 7,
  ANY_UNORDERED_NODE_TYPE: 8,
  FIRST_ORDERED_NODE_TYPE: 9,
});
// XMLDocument is a subclass of Document (DOMParser of an XML type and
// implementation.createDocument produce one). The interface must exist globally.
if (typeof XMLDocument === "undefined") globalThis.XMLDocument = class XMLDocument extends Document {};
// ParentNode mixin: Document and DocumentFragment are ParentNodes too, so they
// share Element's append / prepend / replaceChildren.
for (const _proto of [Document.prototype, DocumentFragment.prototype]) {
  _proto.append = Element.prototype.append;
  _proto.prepend = Element.prototype.prepend;
  _proto.replaceChildren = Element.prototype.replaceChildren;
}
globalThis.EventTarget = EventTarget;
if (typeof NetworkInformation === 'function') {
  try { Object.setPrototypeOf(NetworkInformation.prototype, EventTarget.prototype); } catch (_error) {}
}
