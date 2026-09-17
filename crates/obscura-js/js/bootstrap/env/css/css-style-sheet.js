class CSSStyleSheet extends StyleSheet {
  constructor(_options) {
    super(_styleSheetConstructionKey);
    this.ownerRule = null;
    this._disabled = false;
    this._ownerNode = null;
    this._sourceNode = null;
    this._sourceText = "";
    this._href = null;
    this._media = null;
    this._originClean = true;
    this._rules = [];
    this._cssRules = new CSSRuleList(this);
    this._adopters = new Set();
  }
  get cssRules() {
    this._assertOriginClean();
    this._refreshFromOwner();
    return this._cssRules;
  }
  get rules() { return this.cssRules; }
  _bindOwner(ownerNode, sourceNode = ownerNode) {
    this._ownerNode = ownerNode;
    this._sourceNode = sourceNode;
    this._sourceText = null;
    this._refreshFromOwner();
  }
  _bindLinkedOwner(ownerNode, sourceNode, href, originClean) {
    this._ownerNode = ownerNode;
    this._sourceNode = sourceNode;
    this._sourceText = null;
    this._href = href || null;
    this._originClean = originClean !== false;
    if (this._originClean) this._refreshFromOwner();
    else {
      this._setRules([]);
      this._sourceText = sourceNode?.textContent || "";
    }
  }
  _assertOriginClean() {
    if (!this._originClean) {
      throw new DOMException("Cannot access rules in a cross-origin stylesheet", "SecurityError");
    }
  }
  _refreshFromOwner() {
    if (!this._sourceNode || !this._originClean) return;
    const text = this._sourceNode.textContent || "";
    if (text === this._sourceText) return;
    const parsed = _splitTopLevelCssRules(text);
    const rules = parsed.rules.map(_cssRuleFromText).filter(Boolean);
    this._setRules(rules);
    this._sourceText = text;
  }
  _setRules(rules) {
    for (const rule of this._rules) rule._parentStyleSheet = null;
    this._rules.splice(0, this._rules.length, ...rules);
    for (const rule of this._rules) rule._parentStyleSheet = this;
  }
  _serializeText() { return this._rules.map(rule => rule.cssText).join("\n"); }
  _ruleChanged() {
    const text = this._serializeText();
    this._sourceText = text;
    // DOM text is the renderer bridge for this bounded CSSOM implementation:
    // its ordinary style-element mutation path invalidates cascade/layout.
    // Avoiding the observable text rewrite requires a future native effective-
    // source channel shared by CSSOM and the renderer.
    if (this._sourceNode && this._sourceNode.textContent !== text) this._sourceNode.textContent = text;
    _syncAdoptedStyleSheet(this);
  }
  insertRule(rule, index = 0) {
    if (arguments.length < 1) throw new TypeError("CSSStyleSheet.insertRule requires a rule");
    this._assertOriginClean();
    this._refreshFromOwner();
    const idx = Number(index) >>> 0;
    if (idx > this._rules.length) throw new DOMException("Rule index is out of range", "IndexSizeError");
    const parsed = _splitTopLevelCssRules(String(rule));
    if (!parsed.valid || parsed.rules.length !== 1) {
      throw new DOMException("The rule could not be parsed", "SyntaxError");
    }
    const cssRule = _cssRuleFromText(parsed.rules[0]);
    if (!cssRule) throw new DOMException("The rule could not be parsed", "SyntaxError");
    cssRule._parentStyleSheet = this;
    this._rules.splice(idx, 0, cssRule);
    this._ruleChanged();
    return idx;
  }
  deleteRule(index) {
    if (arguments.length < 1) throw new TypeError("CSSStyleSheet.deleteRule requires an index");
    this._assertOriginClean();
    this._refreshFromOwner();
    const idx = Number(index) >>> 0;
    if (idx >= this._rules.length) throw new DOMException("Rule index is out of range", "IndexSizeError");
    const [removed] = this._rules.splice(idx, 1);
    if (removed) removed._parentStyleSheet = null;
    this._ruleChanged();
  }
  addRule(selector, style, index) {
    this.insertRule(String(selector) + "{" + String(style) + "}", index ?? this._rules.length);
    return -1;
  }
  removeRule(index = 0) { this.deleteRule(index); }
  replace(text) { this.replaceSync(text); return Promise.resolve(this); }
  replaceSync(text) {
    this._assertOriginClean();
    const parsed = _splitTopLevelCssRules(String(text));
    this._setRules(parsed.rules.map(_cssRuleFromText).filter(Boolean));
    this._ruleChanged();
  }
}
globalThis.CSSStyleSheet = CSSStyleSheet;
