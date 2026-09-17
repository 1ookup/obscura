// Dedicated HTMLInputElement shape. Input behavior stays on Element so the
// native DOM fast path remains shared; this module owns the WebIDL prototype.
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
