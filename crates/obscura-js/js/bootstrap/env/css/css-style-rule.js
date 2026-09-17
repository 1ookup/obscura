class CSSStyleRule extends CSSRule {
  constructor(selectorText, declarations) {
    super("", CSSRule.STYLE_RULE);
    this._selectorText = String(selectorText || "").trim();
    const declaration = new CSSStyleDeclaration(null, () => this._changed(), this);
    const state = _cssStyleFor(declaration);
    _parseCssInto(state.props, declarations);
    state.loaded = true;
    this._style = _styleProxy(declaration);
  }
  get selectorText() { return this._selectorText; }
  set selectorText(value) {
    const selector = String(value || "").trim();
    if (!selector || /[{}]/.test(selector)) return;
    this._selectorText = selector;
    this._changed();
  }
  get style() { return this._style; }
  get cssText() {
    const declarations = this._style.cssText;
    return `${this._selectorText} {${declarations ? " " + declarations : ""} }`;
  }
  set cssText(_value) {}
  _changed() {
    if (this._parentStyleSheet) this._parentStyleSheet._ruleChanged();
  }
}
globalThis.CSSStyleRule = CSSStyleRule;
