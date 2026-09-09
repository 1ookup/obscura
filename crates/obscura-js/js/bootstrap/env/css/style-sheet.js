// Base StyleSheet interface shared by CSSStyleSheet and future sheet types.
// Backing fields remain owned by the concrete sheet so parser/render bridges
// can keep their current fast paths.
const _styleSheetConstructionKey = Symbol('StyleSheet construction');
class StyleSheet {
  constructor(key = undefined) {
    if (key !== _styleSheetConstructionKey) {
      throw new TypeError("Failed to construct 'StyleSheet': Illegal constructor");
    }
  }
  get type() { return 'text/css'; }
  get href() { return this._href; }
  get ownerNode() { return this._ownerNode; }
  get parentStyleSheet() { return null; }
  get title() { return this._ownerNode?.getAttribute?.('title') || ''; }
  get media() { return this._media || null; }
  get disabled() { return !!this._disabled; }
  set disabled(value) { this._disabled = !!value; }
  get [Symbol.toStringTag]() { return 'StyleSheet'; }
}
globalThis.StyleSheet = StyleSheet;
