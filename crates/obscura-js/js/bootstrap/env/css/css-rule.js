class CSSRule {
  static STYLE_RULE = 1;
  static CHARSET_RULE = 2;
  static IMPORT_RULE = 3;
  static MEDIA_RULE = 4;
  static FONT_FACE_RULE = 5;
  static PAGE_RULE = 6;
  static KEYFRAMES_RULE = 7;
  static KEYFRAME_RULE = 8;
  static NAMESPACE_RULE = 10;
  static COUNTER_STYLE_RULE = 11;
  static SUPPORTS_RULE = 12;

  constructor(cssText, type = 0) {
    this._cssText = String(cssText || "").trim();
    this._type = type;
    this._parentStyleSheet = null;
    this._parentRule = null;
  }
  get type() { return this._type; }
  get cssText() { return this._cssText; }
  set cssText(_value) {}
  get parentStyleSheet() { return this._parentStyleSheet; }
  get parentRule() { return this._parentRule; }
}
for (const name of [
  "STYLE_RULE", "CHARSET_RULE", "IMPORT_RULE", "MEDIA_RULE", "FONT_FACE_RULE",
  "PAGE_RULE", "KEYFRAMES_RULE", "KEYFRAME_RULE", "NAMESPACE_RULE",
  "COUNTER_STYLE_RULE", "SUPPORTS_RULE",
]) {
  Object.defineProperty(CSSRule.prototype, name, { value: CSSRule[name] });
}
globalThis.CSSRule = CSSRule;

// A single `50% { ... }` block inside @keyframes.
class CSSKeyframeRule extends CSSRule {
  constructor(keyText, declarations) {
    super("", CSSRule.KEYFRAME_RULE);
    this._keyText = String(keyText || "0%");
    const declaration = new CSSStyleDeclaration(null, () => this._changed(), this);
    const state = _cssStyleFor(declaration);
    _parseCssInto(state.props, declarations);
    state.loaded = true;
    this._style = _styleProxy(declaration);
  }
  get keyText() { return this._keyText; }
  set keyText(value) { this._keyText = String(value || "0%"); this._changed(); }
  get style() { return this._style; }
  get cssText() {
    const declarations = this._style.cssText;
    return `${this._keyText} {${declarations ? " " + declarations : ""} }`;
  }
  set cssText(_value) {}
  _changed() {
    if (this._parentRule && this._parentRule._changed) this._parentRule._changed();
  }
}

// `@keyframes <name> { ... }` with its child key blocks addressable like in
// every browser's CSSOM: `.name`, `.cssRules`, appendRule/deleteRule/findRule.
class CSSKeyframesRule extends CSSRule {
  constructor(name, bodyText) {
    super("", CSSRule.KEYFRAMES_RULE);
    this._name = String(name || "");
    this._keyRules = [];
    this._parseBody(String(bodyText || ""));
    this._dirty = false;
  }
  _parseBody(body) {
    this._keyRules = [];
    let position = 0;
    const text = body;
    while (position < text.length) {
      const open = text.indexOf("{", position);
      if (open < 0) break;
      const keyText = text.slice(position, open).trim();
      if (!keyText) break;
      let depth = 1, close = open + 1;
      while (close < text.length && depth) {
        if (text[close] === "{") depth++;
        else if (text[close] === "}") depth--;
        close++;
      }
      const declarations = text.slice(open + 1, close - 1);
      const rule = new CSSKeyframeRule(keyText, declarations);
      rule._parentRule = this;
      this._keyRules.push(rule);
      position = close;
      while (position < text.length && /\s/.test(text[position])) position++;
    }
  }
  get name() { return this._name; }
  set name(value) { this._name = String(value || ""); this._changed(); }
  get cssRules() { return this._keyRules; }
  get cssText() {
    const body = this._keyRules.map(rule => "  " + rule.cssText).join("\n");
    return `@keyframes ${this._name} { \n${body}\n}`;
  }
  set cssText(_value) {}
  appendRule(ruleText) {
    const open = String(ruleText || "").indexOf("{");
    if (open < 0) return;
    const rule = new CSSKeyframeRule(
      String(ruleText).slice(0, open).trim(),
      String(ruleText).slice(open + 1, String(ruleText).lastIndexOf("}")));
    rule._parentRule = this;
    this._keyRules.push(rule);
    this._changed();
  }
  deleteRule(keyText) {
    const key = String(keyText || "");
    const index = this._keyRules.findIndex(rule => rule.keyText === key);
    if (index >= 0) { this._keyRules.splice(index, 1); this._changed(); }
  }
  findRule(keyText) {
    const key = String(keyText || "");
    return this._keyRules.find(rule => rule.keyText === key) || null;
  }
  _changed() {
    if (this._parentStyleSheet) this._parentStyleSheet._ruleChanged();
  }
}
globalThis.CSSKeyframeRule = CSSKeyframeRule;
globalThis.CSSKeyframesRule = CSSKeyframesRule;
