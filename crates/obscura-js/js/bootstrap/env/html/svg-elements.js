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

var SVGElement = _swappableInterface('SVGElement', class extends Element {}, Element);
class SVGGraphicsElement extends SVGElement {}
class SVGGeometryElement extends SVGGraphicsElement {}
class SVGPathElement extends SVGGeometryElement {}
class SVGSVGElement extends SVGGraphicsElement {}
// Chrome's SVG text lattice (local headless-Chrome oracle):
//   SVGTextElement / SVGTSpanElement : SVGTextPositioningElement
//   SVGTextPathElement               : SVGTextContentElement
//   SVGTextPositioningElement        : SVGTextContentElement
//   SVGTextContentElement            : SVGGraphicsElement
// These were published as aliases of SVGElement before, so a <text> resolved
// its methods through Element.prototype and any interface-identity gate (the
// challenge hash probe's instanceof/brand checks) saw a shape no browser
// produces. The measurement API itself is installed on SVGTextContentElement
// by env/media/canvas.js and config/webidl-branding.js.
class SVGTextContentElement extends SVGGraphicsElement {}
class SVGTextPositioningElement extends SVGTextContentElement {}
class SVGTextElement extends SVGTextPositioningElement {}
class SVGTSpanElement extends SVGTextPositioningElement {}
class SVGTextPathElement extends SVGTextContentElement {}
// The graphics containers carry getBBox/getCTM (owned by SVGGraphicsElement
// in Chrome's IDL). Every tag Chrome answers with one of these interfaces is
// mapped in env/dom/iframe-element.js's tag ladders.
class SVGAElement extends SVGGraphicsElement {}
class SVGDefsElement extends SVGGraphicsElement {}
class SVGForeignObjectElement extends SVGGraphicsElement {}
class SVGGElement extends SVGGraphicsElement {}
class SVGImageElement extends SVGGraphicsElement {}
class SVGSwitchElement extends SVGGraphicsElement {}
class SVGSymbolElement extends SVGGraphicsElement {}
class SVGUseElement extends SVGGraphicsElement {}
globalThis.SVGElement = SVGElement;
globalThis.SVGGraphicsElement = SVGGraphicsElement;
globalThis.SVGGeometryElement = SVGGeometryElement;
globalThis.SVGPathElement = SVGPathElement;
globalThis.SVGSVGElement = SVGSVGElement;
globalThis.SVGTextContentElement = SVGTextContentElement;
globalThis.SVGTextPositioningElement = SVGTextPositioningElement;
globalThis.SVGTextElement = SVGTextElement;
globalThis.SVGTSpanElement = SVGTSpanElement;
globalThis.SVGTextPathElement = SVGTextPathElement;
globalThis.SVGAElement = SVGAElement;
globalThis.SVGDefsElement = SVGDefsElement;
globalThis.SVGForeignObjectElement = SVGForeignObjectElement;
globalThis.SVGGElement = SVGGElement;
globalThis.SVGImageElement = SVGImageElement;
globalThis.SVGSwitchElement = SVGSwitchElement;
globalThis.SVGSymbolElement = SVGSymbolElement;
globalThis.SVGUseElement = SVGUseElement;
// Chrome implements GlobalEventHandlers on SVGElement.prototype itself, so
// an SVG element resolves `onclick` there rather than through the Element
// chain. Shadowing with the same accessor shape keeps that lookup level
// truthful even though the HTML side still lives on Element.prototype.
// The check must be own-property based: `in` sees the inherited Element
// accessors and would skip every name.
for (const _ev of _GLOBAL_EVENT_HANDLERS) {
  const _on = "on" + _ev;
  if (!Object.prototype.hasOwnProperty.call(SVGElement.prototype, _on)) {
    __obscuraTraceDefineHandler(SVGElement.prototype, _on, false);
  }
}

// These aliases are installed here because CharacterData/Text/Comment are the
// remaining DOM object shapes previously grouped with SVG aliases.
globalThis.CharacterData = CharacterData;
globalThis.Text = Text;
globalThis.Comment = Comment;
globalThis.CDATASection = CDATASection;
globalThis.ProcessingInstruction = ProcessingInstruction;
