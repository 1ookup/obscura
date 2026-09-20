class CSSStyleRule extends CSSRule {
  constructor(selectorText, declarations) {
    super("", CSSRule.STYLE_RULE);
    _hset(this, "_selectorText", String(selectorText || "").trim());
    const declaration = new CSSStyleDeclaration(null, () => this._changed(), this);
    const state = _cssStyleFor(declaration);
    _parseCssInto(state.props, declarations);
    state.loaded = true;
    _hset(this, "_decl", declaration);
    _hset(this, "_style", null);
  }
  get selectorText() { return this._selectorText; }
  set selectorText(value) {
    const selector = String(value || "").trim();
    if (!selector || /[{}]/.test(selector)) return;
    _hset(this, "_selectorText", selector);
    this._changed();
  }
  // The property-access Proxy is created lazily: materializing a sheet
  // constructs hundreds of rules and paying a six-trap Proxy per rule made
  // re-parsing a rewritten stylesheet visibly slower than Chrome's walk.
  // cssText reads the raw declaration directly.
  get style() {
    if (!this._style) _hset(this, "_style", _styleProxy(this._decl));
    return this._style;
  }
  get cssText() {
    const declarations = _normalizeStyleRuleDeclarations(this._decl.cssText);
    return `${this._selectorText} {${declarations ? " " + declarations : ""} }`;
  }
  set cssText(_value) {}
  _changed() {
    if (this._parentStyleSheet) this._parentStyleSheet._ruleChanged();
  }
}
globalThis.CSSStyleRule = CSSStyleRule;
