// SVG object shapes and the SVGAnimatedString reflection helper used by
// Element.className/href.
function SVGAnimatedString(el, attr, fallbackAttr) {
  this._el = el;
  this._attr = attr;
  this._fallback = fallbackAttr || null;
}
SVGAnimatedString.prototype._read = function() {
  let value = this._el.getAttribute(this._attr);
  if (value === null && this._fallback) value = this._el.getAttribute(this._fallback);
  return value == null ? '' : value;
};
Object.defineProperty(SVGAnimatedString.prototype, 'baseVal', {
  get() { return this._read(); },
  set(value) { this._el.setAttribute(this._attr, String(value)); },
  configurable: true, enumerable: true,
});
Object.defineProperty(SVGAnimatedString.prototype, 'animVal', {
  get() { return this._read(); }, configurable: true, enumerable: true,
});
Object.defineProperty(SVGAnimatedString.prototype, Symbol.toStringTag, {
  value: 'SVGAnimatedString', configurable: true,
});
_markNative(SVGAnimatedString);

class SVGElement extends Element {}
class SVGGraphicsElement extends SVGElement {}
class SVGGeometryElement extends SVGGraphicsElement {}
class SVGPathElement extends SVGGeometryElement {}
class SVGSVGElement extends SVGGraphicsElement {}
globalThis.SVGElement = SVGElement;
globalThis.SVGGraphicsElement = SVGGraphicsElement;
globalThis.SVGGeometryElement = SVGGeometryElement;
globalThis.SVGPathElement = SVGPathElement;
globalThis.SVGSVGElement = SVGSVGElement;

// These aliases are installed here because CharacterData/Text/Comment are the
// remaining DOM object shapes previously grouped with SVG aliases.
globalThis.CharacterData = CharacterData;
globalThis.Text = Text;
globalThis.Comment = Comment;
globalThis.CDATASection = CDATASection;
globalThis.ProcessingInstruction = ProcessingInstruction;
