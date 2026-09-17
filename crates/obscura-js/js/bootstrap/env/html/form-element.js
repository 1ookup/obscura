// Form interface shape. Submission behavior remains on Element.prototype.
globalThis.HTMLButtonElement = Element;
globalThis.HTMLFormElement = class HTMLFormElement extends Element {
  get elements() {
    return _htmlCollectionFrom(this.querySelectorAll(
      'input, select, textarea, button, fieldset, output, object'));
  }
  get length() { return this.elements.length; }
  reset() {
    for (const field of this.elements) if ('value' in field) field.value = '';
  }
};
