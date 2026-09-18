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

// Chrome re-serializes a keyframe selector list from the parsed form, not the
// authored text: `from`/`to` in any case become `0%`/`100%`, numeric keys lose
// leading/trailing zeros (`050%`/`50.0%` -> `50%`), and the list is joined
// with ", " no matter how it was authored. Verified against Chrome 151/153.
function _normalizeKeyText(keyText) {
  const parts = String(keyText || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^from$/i.test(part)) return "0%";
      if (/^to$/i.test(part)) return "100%";
      const percent = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(part);
      if (percent) return `${String(parseFloat(percent[1]))}%`;
      return part;
    });
  return parts.length ? parts.join(", ") : "0%";
}

// Split a serialized declaration list into quoted and unquoted segments so
// value normalization never rewrites the contents of string tokens such as
// `content: "."`.
function _cssQuotedSegments(text) {
  const segments = [];
  let current = "", quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") {
        segments.push({ quoted: true, text: current });
        current = "";
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (current) { segments.push({ quoted: false, text: current }); current = ""; }
      quote = ch;
      current = ch;
      continue;
    }
    current += ch;
  }
  if (current) segments.push({ quoted: false, text: current });
  return segments;
}

// Chrome re-serializes keyframe declaration values from the parsed
// representation: leading-dot numbers regain their `0` (`scale(.6)` ->
// `scale(0.6)`, `-.5px` -> `-0.5px`), hex colors become `rgb()`/`rgba()`
// (`#fff` -> `rgb(255, 255, 255)`, `#abcd` -> `rgba(170, 187, 204, 0.867)`
// with the alpha rounded to three decimals), a bare zero inside a length- or
// angle-taking transform function gets the canonical unit (`translateY(0)`
// -> `translateY(0px)`, `rotate(0)` -> `rotate(0deg)`), and function
// arguments are joined with ", ". Named colors and `url()` payloads stay
// verbatim. Verified against Chrome 151/153 on the challenge stylesheet.
function _normalizeKeyframeDeclarations(cssText) {
  const lengthFns = /^(translate|translate3d|translatex|translatey|translatez|perspective|blur)$/i;
  const angleFns = /^(rotate|rotatex|rotatey|rotatez|skew|skewx|skewy)$/i;
  // Standard length properties re-serialize a bare zero as `0px`; SVG
  // presentation properties (stroke-width...) and plain numbers (opacity,
  // z-index...) keep the authored `0`.
  const lengthProps = /^(?:margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|(?:min-|max-)?(?:width|height)|top|right|bottom|left|inset|letter-spacing|word-spacing|border-(?:width|spacing|radius|(?:top|right|bottom|left)-width)|outline-width|column-width|(?:column|row)-gap|gap|flex-basis|font-size|text-indent|vertical-align|background-position|object-position)$/;
  const hexColor = (all, digits) => {
    const channels = [];
    const step = digits.length <= 4 ? 1 : 2;
    for (let i = 0; i < digits.length; i += step) {
      const part = digits.slice(i, i + step);
      channels.push(step === 1 ? parseInt(part, 16) * 17 : parseInt(part, 16));
    }
    if (channels.length === 4) {
      const alpha = Math.round((channels[3] / 255) * 1000) / 1000;
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
    }
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
  };
  const rewrite = (text) => {
    let out = text.replace(/(?<![\w.])\.(\d)/g, "0.$1");
    out = out.replace(/([a-zA-Z-]+)(\s*:\s*)([^;]*)(;)/g, (match, prop, gap, value, semi) => {
      if (!lengthProps.test(prop.toLowerCase())) return match;
      const normalized = value.split(/([\s,]+)/)
        .map((token) => (token === "0" ? "0px" : token))
        .join("");
      return prop + gap + normalized + semi;
    });
    out = out.replace(/(?<![\w#])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/gi, hexColor);
    out = out.replace(/([a-zA-Z][a-zA-Z0-9-]*)\(([^()]*)\)/g, (match, name, args) => {
      if (/^(url|src)$/i.test(name)) return match;
      const joined = args.split(",").map((arg) => {
        const part = arg.trim();
        if (part === "") return part;
        if (lengthFns.test(name) && /^-?0(?:\.0+)?$/.test(part)) return "0px";
        if (angleFns.test(name) && /^-?0(?:\.0+)?$/.test(part)) return "0deg";
        const zeroUnit = (lengthFns.test(name) || angleFns.test(name))
          && /^-?0(?:\.0+)?(?:px|deg)$/i.exec(part);
        if (zeroUnit) return part.toLowerCase();
        return part;
      }).join(", ");
      return `${name}(${joined})`;
    });
    return out;
  };
  return _cssQuotedSegments(String(cssText || ""))
    .map(({ quoted, text }) => {
      if (quoted) return text;
      // `url(#abc)` fragment references are not colors; keep them verbatim.
      return text.split(/(url\([^)]*\))/i).map((part, index) => (index % 2 ? part : rewrite(part))).join("");
    })
    .join("");
}

// A single `50% { ... }` block inside @keyframes.
class CSSKeyframeRule extends CSSRule {
  constructor(keyText, declarations) {
    super("", CSSRule.KEYFRAME_RULE);
    this._keyText = _normalizeKeyText(keyText);
    const declaration = new CSSStyleDeclaration(null, () => this._changed(), this);
    const state = _cssStyleFor(declaration);
    _parseCssInto(state.props, declarations);
    state.loaded = true;
    this._style = _styleProxy(declaration);
  }
  get keyText() { return this._keyText; }
  set keyText(value) { this._keyText = _normalizeKeyText(value); this._changed(); }
  get style() { return this._style; }
  get cssText() {
    const declarations = _normalizeKeyframeDeclarations(this._style.cssText);
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
    const key = _normalizeKeyText(keyText);
    const index = this._keyRules.findIndex(rule => rule.keyText === key);
    if (index >= 0) { this._keyRules.splice(index, 1); this._changed(); }
  }
  findRule(keyText) {
    const key = _normalizeKeyText(keyText);
    return this._keyRules.find(rule => rule.keyText === key) || null;
  }
  _changed() {
    if (this._parentStyleSheet) this._parentStyleSheet._ruleChanged();
  }
}
globalThis.CSSKeyframeRule = CSSKeyframeRule;
globalThis.CSSKeyframesRule = CSSKeyframesRule;
