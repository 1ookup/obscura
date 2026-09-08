// HTMLInputElement has its own WebIDL prototype in Chromium. Most input
// behavior is implemented on Element for the shared DOM fast path, but the
// dedicated wrapper is required for instanceof and Object#toString branding.
const _inputConstructionKey = Symbol('HTMLInputElement construction');
class HTMLInputElement extends Element {
  constructor(nid, key) {
    if (key !== _inputConstructionKey) {
      throw new TypeError("Failed to construct 'HTMLInputElement': Illegal constructor");
    }
    super(nid);
  }
  get [Symbol.toStringTag]() { return 'HTMLInputElement'; }
}
globalThis.HTMLInputElement = HTMLInputElement;
Object.defineProperty(HTMLInputElement, 'length', { value: 0, configurable: true });
_markNative(HTMLInputElement);
_markNative(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, Symbol.toStringTag).get);
// Keep the existing shared implementations, but expose input IDL members on
// the dedicated prototype where WebIDL places them in Chrome.
for (const name of [
  'accept', 'alt', 'autocomplete', 'defaultChecked', 'checked', 'dirName',
  'disabled', 'form', 'files', 'formAction', 'formEnctype', 'formMethod',
  'formNoValidate', 'formTarget', 'height', 'indeterminate', 'list', 'max',
  'maxLength', 'min', 'minLength', 'multiple', 'name', 'pattern',
  'placeholder', 'readOnly', 'required', 'size', 'src', 'step', 'type',
  'defaultValue', 'value', 'valueAsDate', 'valueAsNumber', 'width',
  'willValidate', 'validity', 'validationMessage', 'labels', 'selectionStart',
  'selectionEnd', 'selectionDirection', 'align', 'useMap', 'webkitdirectory',
  'incremental', 'checkValidity', 'reportValidity', 'select', 'setCustomValidity',
  'setRangeText', 'setSelectionRange', 'showPicker', 'stepDown', 'stepUp',
  'webkitEntries',
]) {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
  if (descriptor) Object.defineProperty(HTMLInputElement.prototype, name, descriptor);
}

class HTMLBodyElement extends HTMLElement {
  constructor(nid, key) {
    // Internal wrappers pass the node id as the sole argument. Script-level
    // construction remains illegal, matching the native interface.
    if (arguments.length !== 1 || nid === undefined) {
      throw new TypeError("Failed to construct 'HTMLBodyElement': Illegal constructor");
    }
    super(nid);
  }
  get [Symbol.toStringTag]() { return 'HTMLBodyElement'; }
}
globalThis.HTMLBodyElement = HTMLBodyElement;
Object.defineProperty(HTMLBodyElement, 'length', { value: 0, configurable: true });
_markNative(HTMLBodyElement);
_markNative(Object.getOwnPropertyDescriptor(HTMLBodyElement.prototype, Symbol.toStringTag).get);

globalThis.HTMLButtonElement = Element;
globalThis.HTMLFormElement = class HTMLFormElement extends Element {
  get elements() { return _htmlCollectionFrom(this.querySelectorAll("input, select, textarea, button, fieldset, output, object")); }
  get length() { return this.elements.length; }
  // Inherit submit() from Element.prototype: it dispatches the cancelable
  // 'submit' event and (if not prevented) builds form data and navigates.
  reset() { for (const f of this.elements) { if ('value' in f) f.value = ''; } }
};
globalThis.HTMLSelectElement = Element;
globalThis.HTMLTextAreaElement = Element;
globalThis.HTMLLabelElement = Element;
globalThis.HTMLTableElement = Element;
// HTMLIFrameElement is defined with its dedicated prototype above.
globalThis.HTMLCanvasElement = Element;
// HTMLVideoElement and HTMLAudioElement are defined above with canPlayType support.
globalThis.HTMLScriptElement = Element;
globalThis.HTMLStyleElement = Element;
globalThis.HTMLLinkElement = HTMLLinkElement;
globalThis.HTMLMetaElement = Element;
globalThis.HTMLHeadElement = Element;
globalThis.HTMLHtmlElement = Element;
globalThis.HTMLBRElement = Element;
globalThis.HTMLHRElement = Element;
globalThis.HTMLUListElement = Element;
globalThis.HTMLOListElement = Element;
globalThis.HTMLLIElement = Element;
globalThis.HTMLPreElement = Element;
globalThis.HTMLHeadingElement = Element;
globalThis.HTMLTemplateElement = Element;
globalThis.HTMLSlotElement = Element;
globalThis.HTMLOptionElement = Element;
globalThis.HTMLDataListElement = Element;
globalThis.HTMLFieldSetElement = Element;
globalThis.HTMLLegendElement = Element;
globalThis.HTMLProgressElement = Element;
globalThis.HTMLDetailsElement = Element;
globalThis.HTMLDialogElement = Element;
// SVGAnimatedString backs the className and href reflections on SVG elements.
// baseVal and animVal both read the live attribute (no SMIL animation), and
// baseVal is writable. Used by the SVG-aware get className()/get href() above.
function SVGAnimatedString(el, attr, fallbackAttr) {
  this._el = el;
  this._attr = attr;
  this._fallback = fallbackAttr || null;
}
SVGAnimatedString.prototype._read = function() {
  let v = this._el.getAttribute(this._attr);
  if (v === null && this._fallback) v = this._el.getAttribute(this._fallback);
  return v == null ? '' : v;
};
Object.defineProperty(SVGAnimatedString.prototype, 'baseVal', {
  get() { return this._read(); },
  set(v) { this._el.setAttribute(this._attr, String(v)); },
  configurable: true, enumerable: true,
});
Object.defineProperty(SVGAnimatedString.prototype, 'animVal', {
  get() { return this._read(); },
  configurable: true, enumerable: true,
});
Object.defineProperty(SVGAnimatedString.prototype, Symbol.toStringTag, { value: 'SVGAnimatedString', configurable: true });
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
globalThis.CharacterData = CharacterData;
globalThis.Text = Text;
globalThis.Comment = Comment;

globalThis.CDATASection = CDATASection;
globalThis.ProcessingInstruction = ProcessingInstruction;
// True when the document was loaded from an XML/XHTML source. Obscura has no
// native XML tree, so this is inferred from contentType (derived from the URL).
