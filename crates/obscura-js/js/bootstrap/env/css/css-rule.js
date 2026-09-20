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
    _hset(this, "_cssText", String(cssText || "").trim());
    _hset(this, "_type", type);
    _hset(this, "_parentStyleSheet", null);
    _hset(this, "_parentRule", null);
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

// ---------------------------------------------------------------------------
// Parsed-form declaration serialization for CSSStyleRule.cssText.
//
// Chrome re-serializes a style rule's declarations from the parsed
// representation instead of echoing the authored text: numbers are
// canonicalized (`+30` -> `30`, `1.50` -> `1.5`, `.3` -> `0.3`, `1e3px` ->
// `1000px`), hex and functional colors become `rgb()`/`rgba()` (`#228b49` ->
// `rgb(34, 139, 73)`, `hsl(120,100%,50%)` -> `rgb(0, 255, 0)`, `rgb(50%,50%,50%)`
// -> `rgb(128, 128, 128)`, fully-opaque 8-digit hex loses the alpha), grid and
// font shorthands space their slashes (`1/1` -> `1 / 1`), the animation
// shorthand is reordered to duration | easing | delay | iteration-count |
// direction | fill-mode | [play-state] | name with missing parts filled from
// the initial values, the transition shorthand drops the initial `all`,
// `ease` and `0s` components, `transform-origin`/`background-position` regain
// their second value, `flex` expands to grow/shrink/basis, edge shorthands
// collapse redundant sides, `url()` payloads are double-quoted, `steps(n, end)`
// loses the initial second argument, `!important` declarations sort after
// normal ones, and declarations containing `var()` are echoed verbatim
// (pending substitution). Custom property values are opaque token streams and
// stay verbatim.
//
// Verified against headless Chrome 153 via CDP for every generic rule and
// against the Chrome 151 reference capture for the two forms where 151 and
// 153 disagree: box-shadow keeps the authored component order (`inset 0 0 0
// #228b49` -> `inset 0px 0px 0px rgb(34, 139, 73)`, 153 moves the color
// first), and the animation shorthand omits the initial `running` play-state
// that 153 prints.
// ---------------------------------------------------------------------------

// Canonical textual form of a CSS <number>: drop the plus sign, expand
// scientific notation, strip trailing zeros, regain the leading zero.
function _cssCanonicalNumberText(raw) {
  const match = /^([+-]?)((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(raw);
  if (!match) return raw;
  const parsed = Number.parseFloat(match[2]);
  if (!Number.isFinite(parsed)) return raw;
  let text = String(parsed);
  if (match[1] === "-" && parsed !== 0) text = "-" + text;
  return text;
}

function _cssIsNumberToken(token) {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token);
}

function _cssIsTimeToken(token) {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:ms|s)$/i.test(token);
}

// Hex color to the `rgb()`/`rgba()` serialization. A fully opaque alpha
// collapses to `rgb()` (`#000000ff` -> `rgb(0, 0, 0)`); other alphas keep
// three decimals (`#abcd` -> `rgba(170, 187, 204, 0.867)`).
function _cssHexColorFn(all, digits) {
  const channels = [];
  const step = digits.length <= 4 ? 1 : 2;
  for (let i = 0; i < digits.length; i += step) {
    const part = digits.slice(i, i + step);
    channels.push(step === 1 ? parseInt(part, 16) * 17 : parseInt(part, 16));
  }
  if (channels.length === 4) {
    const alpha = Math.round((channels[3] / 255) * 1000) / 1000;
    if (alpha >= 1) return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
  }
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

// Split a functional color's argument list on top-level commas, whitespace
// and slashes, so both `1,2,3` and `1 2 3 / 0.5` syntaxes parse.
function _cssColorArgTokens(body) {
  const tokens = [];
  let current = "", depth = 0, quote = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += body[++i] || "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); current += ch; continue; }
    if (depth === 0 && (ch === "," || ch === "/")) {
      if (current.trim()) tokens.push(current.trim());
      if (ch === "/") tokens.push("/");
      current = "";
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current.trim()) tokens.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function _cssHslToRgb(hue, saturation, lightness) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lightness - c / 2;
  const channel = (v) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return [channel(r), channel(g), channel(b)];
}

// Canonicalize one `rgb()/rgba()/hsl()/hsla()` token, or return null when the
// token is not one. Chrome converts hsl to rgb and percentages to 0-255
// integers, and folds an alpha of 1 into the `rgb()` form.
function _cssNormalizeColorFunction(token) {
  const open = token.indexOf("(");
  if (open <= 0 || !token.endsWith(")")) return null;
  const name = token.slice(0, open).toLowerCase();
  if (name !== "rgb" && name !== "rgba" && name !== "hsl" && name !== "hsla") return null;
  const tokens = _cssColorArgTokens(token.slice(open + 1, -1)).filter((t) => t !== ",");
  const solidus = tokens.indexOf("/");
  let parts = solidus < 0 ? tokens : tokens.slice(0, solidus);
  const alphaParts = solidus < 0 ? [] : tokens.slice(solidus + 1);
  if (parts.length === 4 && !alphaParts.length) {
    // Legacy comma syntax carries the alpha as a fourth argument.
    parts = parts.slice(0, 3);
    alphaParts.push(tokens[3]);
  }
  if (parts.length < 3 || alphaParts.length > 1) return null;
  let alpha = 1;
  if (alphaParts.length === 1) {
    const raw = alphaParts[0];
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return null;
    alpha = raw.includes("%") ? parsed / 100 : parsed;
  }
  const channel = (part) => {
    const parsed = Number.parseFloat(part);
    if (!Number.isFinite(parsed)) return null;
    const scaled = part.includes("%") ? (parsed / 100) * 255 : parsed;
    return Math.max(0, Math.min(255, Math.round(scaled)));
  };
  let rgb;
  if (name === "hsl" || name === "hsla") {
    const rawHue = parts[0];
    const hueValue = Number.parseFloat(rawHue);
    if (!Number.isFinite(hueValue)) return null;
    let hue = hueValue;
    if (rawHue.endsWith("turn")) hue = hueValue * 360;
    else if (rawHue.endsWith("grad")) hue = hueValue * 0.9;
    else if (rawHue.endsWith("rad")) hue = (hueValue * 180) / Math.PI;
    else if (rawHue.endsWith("%")) hue = hueValue * 3.6;
    const percent = (part) => {
      const parsed = Number.parseFloat(part);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(1, part.includes("%") ? parsed / 100 : parsed));
    };
    const saturation = percent(parts[1]);
    const lightness = percent(parts[2]);
    if (saturation === null || lightness === null) return null;
    rgb = _cssHslToRgb(hue, saturation, lightness);
  } else {
    rgb = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
    if (rgb.some((v) => v === null)) return null;
  }
  if (alpha >= 1) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${_cssCanonicalNumberText(String(alpha))})`;
}

// Tokenize a declaration value on top-level whitespace (and optionally on
// top-level slashes) while keeping functions and quoted strings intact.
function _cssValueTokens(text, splitSlash) {
  const tokens = [];
  let current = "", depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += text[++i] || "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); current += ch; continue; }
    if (depth > 0) { current += ch; continue; }
    if (/\s/.test(ch) || (splitSlash && ch === "/")) {
      if (current) { tokens.push(current); current = ""; }
      if (splitSlash && ch === "/") tokens.push("/");
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

// Tolerant top-level comma split for comma-separated value lists.
function _cssSplitList(value) {
  const items = [];
  let current = "", depth = 0, quote = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += value[++i] || "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); current += ch; continue; }
    if (depth === 0 && ch === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  items.push(current.trim());
  return items;
}

// Apply a text transformation to a value, leaving quoted strings and url()
// payloads untouched.
function _cssMapValueSegments(value, mapper) {
  value = String(value || "");
  // Fast path: without quotes there are no quoted segments, and without
  // `url(` the url split cannot match, so the one segment is the whole
  // value. Avoids the segment-array churn on the common declaration.
  if (!value.includes('"') && !value.includes("'")) {
    if (!/[uU][rR][lL]\(/.test(value)) return mapper(value);
    return value.split(/(url\([^)]*\))/i)
      .map((part, index) => (index % 2 ? part : mapper(part)))
      .join("");
  }
  return _cssQuotedSegments(value)
    .map(({ quoted, text }) => quoted ? text
      : text.split(/(url\([^)]*\))/i)
        .map((part, index) => (index % 2 ? part : mapper(part)))
        .join(""))
    .join("");
}

function _cssPassNumbers(value) {
  // Every rewrite needs a digit; digit-free values ("auto", "red") skip the
  // segment machinery entirely.
  if (!/\d/.test(value)) return value;
  return _cssMapValueSegments(value, (part) => part.replace(
    /(?<![\w#.])[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g,
    (match) => _cssCanonicalNumberText(match)));
}

const _CSS_HEX_COLOR_RE = /(?<![\w#])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/gi;
// `_cssNormalizeColorFunction` only rewrites rgb()/rgba()/hsl()/hsla()
// tokens; other functions pass through unchanged, so gate the scan.
const _CSS_COLOR_FN_PRESENT = /(?:^|[^a-zA-Z0-9-])(?:rgba?|hsla?)\(/i;

function _cssPassColors(value) {
  // Hex colors need "#" and functional colors need "("; without either the
  // pass cannot rewrite anything.
  if (!value.includes("#") && !value.includes("(")) return value;
  return _cssMapValueSegments(value, (part) => {
    let out = part.replace(_CSS_HEX_COLOR_RE, (all, digits) => _cssHexColorFn(all, digits));
    if (_CSS_COLOR_FN_PRESENT.test(out)) {
      out = out.replace(/[a-zA-Z][a-zA-Z0-9-]*\([^()]*\)/g, (fn) =>
        _cssNormalizeColorFunction(fn) || fn);
    }
    return out;
  });
}

// Double-quote a url() payload: `url(a.png)` -> `url("a.png")`.
function _cssQuoteUrl(url) {
  const open = url.indexOf("(");
  const close = url.lastIndexOf(")");
  if (open < 0 || close < open) return url;
  const inner = url.slice(open + 1, close).trim();
  if ((inner.startsWith('"') && inner.endsWith('"'))
    || (inner.startsWith("'") && inner.endsWith("'"))) {
    const body = inner.slice(1, -1);
    if (body.includes('"')) return url;
    return `url("${body}")`;
  }
  return `url("${inner}")`;
}

const _CSS_LENGTH_FNS = /^(translate|translate3d|translatex|translatey|translatez|perspective|blur)$/i;
const _CSS_ANGLE_FNS = /^(rotate|rotatex|rotatey|rotatez|skew|skewx|skewy)$/i;

// Double-quote a url() payload: `url(a.png)` -> `url("a.png")`. Quotes inside
// a url() payload do not open a string, so the scan is quote-aware only
// outside url().
function _cssQuoteUrls(value) {
  let out = "", quote = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      out += ch;
      if (ch === "\\") out += value[++i] || "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (/^url\(/i.test(value.slice(i, i + 4))) {
      const close = value.indexOf(")", i);
      if (close > i) {
        out += _cssQuoteUrl(value.slice(i, close + 1));
        i = close;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function _cssPassFunctions(value) {
  // url() quoting and every function rewrite match text containing "(".
  if (!value.includes("(")) return value;
  const quoted = /[uU][rR][lL]\(/.test(value) ? _cssQuoteUrls(value) : value;
  return _cssMapValueSegments(quoted, (part) => {
    let out = part.replace(/([a-zA-Z][a-zA-Z0-9-]*)\(([^()]*)\)/g, (match, name, args) => {
      if (/^(url|src)$/i.test(name)) return match;
      if (/^steps$/i.test(name)) {
        const parts = args.split(",").map((arg) => arg.trim()).filter(Boolean);
        if (parts.length === 2 && parts[1].toLowerCase() === "end") return `${name}(${parts[0]})`;
      }
      if (/^drop-shadow$/i.test(name)) {
        const shadow = _cssValueTokens(args)
          .map((token) => (/^[+-]?0(?:\.0+)?$/.test(token) ? "0px" : token))
          .join(" ");
        return `${name}(${shadow})`;
      }
      const joined = args.split(",").map((arg) => {
        const part = arg.trim();
        if (part === "") return part;
        if (_CSS_LENGTH_FNS.test(name) && /^-?0(?:\.0+)?$/.test(part)) return "0px";
        if (_CSS_ANGLE_FNS.test(name) && /^-?0(?:\.0+)?$/.test(part)) return "0deg";
        return part;
      }).join(", ");
      return `${name}(${joined})`;
    });
    return out;
  });
}

function _cssPassCommaSpace(value) {
  if (!value.includes(",")) return value;
  return _cssMapValueSegments(value, (part) => part.replace(/\s*,\s*/g, ", "));
}

// Standard length properties re-serialize a bare zero as `0px`; SVG
// presentation properties and plain numbers keep the authored `0`.
const _CSS_STYLE_LENGTH_PROPS = /^(?:margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|(?:min-|max-)?(?:width|height)|top|right|bottom|left|inset|letter-spacing|word-spacing|border|border-(?:width|spacing|radius|(?:top|right|bottom|left)-width)|outline-width|column-width|(?:column|row)-gap|gap|flex-basis|font-size|text-indent|vertical-align|background|background-position|object-position|transform-origin|perspective-origin)$/;

function _cssPassZeroLength(prop, value) {
  if (!value.includes("0")) return value;
  return _cssMapValueSegments(value, (part) => {
    let out = "", current = "", depth = 0;
    const flush = () => {
      out += depth === 0 && /^[+-]?0$/.test(current) ? "0px" : current;
      current = "";
    };
    for (const ch of part) {
      if (ch === "(" || ch === ")") {
        current += ch;
        depth = Math.max(0, depth + (ch === "(" ? 1 : -1));
        continue;
      }
      if (depth === 0 && /[\s,]/.test(ch)) { flush(); out += ch; continue; }
      current += ch;
    }
    flush();
    return out;
  });
}

// `animation: <single item>` reorders to
// duration | easing | delay | iteration-count | direction | fill-mode |
// [play-state] | name, filling absent components from the initial values.
// Chrome 151 (the reference capture) omits the initial `running` play-state;
// Chrome 153 prints it. The name is the last token that is not classifiable
// as any other component.
const _CSS_EASING_KEYWORDS = new Set(["ease", "linear", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);
const _CSS_ANIM_DIRECTION = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
const _CSS_ANIM_FILL = new Set(["none", "forwards", "backwards", "both"]);
const _CSS_ANIM_PLAY = new Set(["running", "paused"]);

function _cssIsEasingToken(token) {
  return _CSS_EASING_KEYWORDS.has(token.toLowerCase())
    || /^(?:cubic-bezier|steps|linear)\(/i.test(token);
}

function _cssNormalizeAnimationValue(value) {
  return _cssSplitList(value).map((item) => {
    const tokens = _cssValueTokens(item);
    let name = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i], lower = token.toLowerCase();
      if (_cssIsTimeToken(token) || _cssIsNumberToken(token)
        || lower === "infinite" || _cssIsEasingToken(token)
        || _CSS_ANIM_DIRECTION.has(lower) || _CSS_ANIM_FILL.has(lower)
        || _CSS_ANIM_PLAY.has(lower)) continue;
      name = tokens.splice(i, 1)[0];
      break;
    }
    let duration = null, delay = null, easing = null, count = null;
    let direction = null, fill = null, play = null;
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (_cssIsTimeToken(token)) {
        if (duration === null) duration = token;
        else if (delay === null) delay = token;
      } else if (_cssIsEasingToken(token)) {
        if (easing === null) easing = token;
      } else if (lower === "infinite" || _cssIsNumberToken(token)) {
        if (count === null) count = lower === "infinite" ? "infinite" : token;
      } else if (_CSS_ANIM_DIRECTION.has(lower)) {
        if (direction === null) direction = lower;
      } else if (_CSS_ANIM_FILL.has(lower)) {
        if (fill === null) fill = lower;
      } else if (_CSS_ANIM_PLAY.has(lower)) {
        if (play === null) play = lower;
      }
    }
    const parts = [
      duration || "0s",
      easing || "ease",
      delay || "0s",
      count || "1",
      direction || "normal",
      fill || "none",
    ];
    if (play && play !== "running") parts.push(play);
    parts.push(name || "none");
    return parts.join(" ");
  }).join(", ");
}

// `transition: <single item>` reorders to [property] duration [easing]
// [delay]; the initial `all` property, `ease` easing and `0s` delay are
// omitted.
function _cssNormalizeTransitionValue(value) {
  if (/^none$/i.test(value.trim())) return value;
  return _cssSplitList(value).map((item) => {
    const tokens = _cssValueTokens(item);
    let property = null;
    const times = [];
    let easing = null;
    for (const token of tokens) {
      if (_cssIsTimeToken(token)) { times.push(token); continue; }
      if (_cssIsEasingToken(token)) { if (easing === null) easing = token; continue; }
      if (property === null) property = token;
    }
    if (property && property.toLowerCase() === "all") property = null;
    const parts = [];
    if (property) parts.push(property);
    if (!times.length) return item;
    parts.push(times[0]);
    if (easing && easing.toLowerCase() !== "ease") parts.push(easing);
    if (times[1] && !/^[+-]?0(?:\.0+)?s$/i.test(times[1])) parts.push(times[1]);
    return parts.join(" ");
  }).join(", ");
}

// A single transform-origin/background-position value regains its second
// component; a top/bottom-first keyword pair serializes x before y.
// background-position layers are comma-separated and expand per layer.
function _cssExpandPositionKeywords(value) {
  return _cssSplitList(value).map((layer) => _cssExpandPositionLayer(layer)).join(", ");
}

function _cssExpandPositionLayer(value) {
  const tokens = _cssValueTokens(value);
  if (tokens.length === 1) {
    const token = tokens[0];
    const lower = token.toLowerCase();
    if (lower === "top") return "center top";
    if (lower === "bottom") return "center bottom";
    if (lower === "left" || lower === "right" || lower === "center") return `${token} center`;
    if (/^[+-]?0$/.test(token)) return `0px center`;
    return `${token} center`;
  }
  if (tokens.length === 2) {
    const first = tokens[0].toLowerCase(), second = tokens[1].toLowerCase();
    const isY = (t) => t === "top" || t === "bottom";
    const isX = (t) => t === "left" || t === "right" || t === "center";
    if (isY(first) && isX(second)) return `${tokens[1]} ${tokens[0]}`;
  }
  return value;
}

// `flex` expands to grow | shrink | basis with the spec defaults
// (`1` -> `1 1 0%`, `auto` -> `1 1 auto`, `none` -> `0 0 auto`).
function _cssNormalizeFlexValue(value) {
  const text = value.trim();
  const lower = text.toLowerCase();
  if (lower === "none") return "0 0 auto";
  if (lower === "auto") return "1 1 auto";
  if (["initial", "inherit", "unset", "revert"].includes(lower)) return text;
  const tokens = _cssValueTokens(text);
  const numbers = [];
  let basis = null;
  for (const token of tokens) {
    if (_cssIsNumberToken(token)) numbers.push(_cssCanonicalNumberText(token));
    else if (basis === null) basis = token;
  }
  if (!numbers.length && basis === null) return text;
  const grow = numbers[0] ?? "1";
  const shrink = numbers[1] ?? "1";
  return `${grow} ${shrink} ${basis ?? "0%"}`;
}

// Shadows keep the authored component order (the Chrome 151 form) with bare
// zero lengths gaining `px`; colors are normalized by the generic passes.
function _cssNormalizeShadowValue(value) {
  return _cssSplitList(value).map((item) => _cssValueTokens(item)
    .map((token) => (/^[+-]?0(?:\.0+)?$/.test(token) ? "0px" : token))
    .join(" ")).join(", ");
}

const _CSS_BG_POS_KEYWORDS = new Set(["left", "right", "top", "bottom", "center"]);
const _CSS_BG_REPEAT = new Set(["repeat", "repeat-x", "repeat-y", "no-repeat", "space", "round"]);
const _CSS_BG_ATTACHMENT = new Set(["scroll", "fixed", "local"]);
const _CSS_BG_BOX = new Set(["border-box", "padding-box", "content-box"]);
const _CSS_COLOR_FN_PREFIXES = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;

function _cssIsColorToken(token) {
  if (token.startsWith("#")) return true;
  if (_CSS_COLOR_FN_PREFIXES.test(token)) return true;
  return _CSS_SUPPORTED_COLOR_NAMES.has(token.toLowerCase());
}

function _cssIsPositionIshToken(token) {
  if (token === "/") return false;
  if (_CSS_BG_POS_KEYWORDS.has(token.toLowerCase())) return true;
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?$/i.test(token);
}

function _cssIsSizeToken(token) {
  const lower = token.toLowerCase();
  if (lower === "auto" || lower === "cover" || lower === "contain") return true;
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?$/i.test(token);
}

// The background shorthand serializes in longhand order: image, position
// (/ size), repeat, attachment, box, color. A lone position value regains its
// second component and the color moves to the end. Each comma-separated
// layer is serialized on its own.
function _cssNormalizeBackgroundValue(value) {
  return _cssSplitList(value).map(_cssNormalizeBackgroundLayer).join(", ");
}

function _cssNormalizeBackgroundLayer(value) {
  const tokens = _cssValueTokens(value, true);
  const images = [], positions = [], sizes = [], repeats = [];
  const attachments = [], boxes = [], rest = [];
  let color = null, afterSlash = false;
  for (const token of tokens) {
    if (token === "/") { afterSlash = true; continue; }
    if (afterSlash) {
      // The size component takes at most two size-like tokens; anything
      // after it belongs to the normal component classes again.
      if (sizes.length < 2 && _cssIsSizeToken(token)) { sizes.push(token); continue; }
      afterSlash = false;
    }
    const lower = token.toLowerCase();
    if (_cssIsColorToken(token)) color = token;
    else if (/^url\(/i.test(token) || /^none$/i.test(lower) || /\(/.test(token)) images.push(token);
    else if (_CSS_BG_REPEAT.has(lower)) repeats.push(token);
    else if (_CSS_BG_ATTACHMENT.has(lower)) attachments.push(token);
    else if (_CSS_BG_BOX.has(lower)) boxes.push(token);
    else if (_cssIsPositionIshToken(token)) positions.push(token);
    else rest.push(token);
  }
  if (!images.length && !positions.length && !sizes.length && !repeats.length
    && !attachments.length && !boxes.length && !rest.length) return color || value;
  let positionText = positions.join(" ");
  if (positions.length === 1) {
    const lower = positions[0].toLowerCase();
    positionText = lower === "top" || lower === "bottom"
      ? `center ${positions[0]}` : `${positions[0]} center`;
  }
  let sizeText = sizes.join(" ");
  // A single numeric size regains its second axis (`50%` -> `50% auto`);
  // keyword sizes (`cover`, `contain`) already cover both.
  if (sizes.length === 1 && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?$/i.test(sizes[0])) {
    sizeText = `${sizes[0]} auto`;
  }
  const groups = [];
  if (images.length) groups.push(images.join(" "));
  if (positionText || sizeText) {
    groups.push([positionText, sizeText].filter(Boolean).join(" / "));
  }
  if (repeats.length) groups.push(repeats.join(" "));
  if (attachments.length) groups.push(attachments.join(" "));
  if (boxes.length) groups.push(boxes.join(" "));
  if (rest.length) groups.push(rest.join(" "));
  if (color) groups.push(color);
  return groups.join(" ");
}

const _CSS_FONT_STYLE_KW = new Set(["italic", "oblique"]);
const _CSS_FONT_VARIANT_KW = new Set(["small-caps", "all-small-caps", "petite-caps", "all-petite-caps", "unicase", "titling-caps"]);
const _CSS_FONT_WEIGHT_KW = new Set(["bold", "bolder", "lighter"]);
const _CSS_FONT_STRETCH_KW = new Set(["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"]);
const _CSS_FONT_SYSTEM = new Set(["caption", "icon", "menu", "message-box", "small-caption", "status-bar"]);

// The font shorthand spaces its size/line-height slash and serializes the
// leading components in style | variant | weight | stretch order.
function _cssNormalizeFontValue(value) {
  const tokens = _cssValueTokens(value, true);
  if (tokens.length <= 1) return value;
  const lower0 = tokens[0].toLowerCase();
  if (_CSS_FONT_SYSTEM.has(lower0)) return value;
  const isSize = (token) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)$/i.test(token);
  const sizeIndex = tokens.findIndex((token) => isSize(token));
  if (sizeIndex < 0) return value;
  const prefix = tokens.slice(0, sizeIndex);
  const style = [], variant = [], weight = [], stretch = [];
  for (const token of prefix) {
    const lower = token.toLowerCase();
    if (_CSS_FONT_STYLE_KW.has(lower)) style.push(token);
    else if (_CSS_FONT_VARIANT_KW.has(lower)) variant.push(token);
    else if (_CSS_FONT_WEIGHT_KW.has(lower) || _cssIsNumberToken(token)) weight.push(token);
    else if (_CSS_FONT_STRETCH_KW.has(lower)) stretch.push(token);
  }
  const hasSlash = tokens[sizeIndex + 1] === "/";
  const lineHeight = hasSlash ? tokens[sizeIndex + 2] : null;
  const family = tokens.slice(sizeIndex + (hasSlash ? 3 : 1)).join(" ");
  const groups = [];
  if (style.length) groups.push(style.join(" "));
  if (variant.length) groups.push(variant.join(" "));
  if (weight.length) groups.push(weight.join(" "));
  if (stretch.length) groups.push(stretch.join(" "));
  groups.push(lineHeight ? `${tokens[sizeIndex]} / ${lineHeight}` : tokens[sizeIndex]);
  if (family) groups.push(family);
  return groups.join(" ");
}

// Grid/font shorthands space their slashes: `1/1` -> `1 / 1`.
function _cssSpaceSlashValue(value) {
  return _cssMapValueSegments(value, (part) => part.replace(/\s*\/\s*/g, " / "));
}

// Edge shorthands collapse redundant sides: `10px 20px 10px 20px` ->
// `10px 20px`, `1px 1px 1px` -> `1px`, `0 0 0 0` -> `0`.
function _cssCollapseEdgeValue(value) {
  let tokens = _cssValueTokens(value);
  for (;;) {
    const n = tokens.length;
    if (n === 4 && tokens[3] === tokens[1]) {
      tokens = tokens[2] === tokens[0] ? [tokens[0], tokens[1]] : [tokens[0], tokens[1], tokens[2]];
    } else if (n === 3 && tokens[2] === tokens[0]) {
      tokens = tokens[1] === tokens[0] ? [tokens[0]] : [tokens[0], tokens[1]];
    } else if (n === 2 && tokens[1] === tokens[0]) {
      tokens = [tokens[0]];
    } else break;
  }
  return tokens.join(" ");
}

// stroke-dasharray serializes its lengths as a comma list.
function _cssCommaJoinValue(value) {
  return _cssValueTokens(value).join(", ");
}

const _CSS_STYLE_VALUE_HANDLERS = {
  "animation": _cssNormalizeAnimationValue,
  "transition": _cssNormalizeTransitionValue,
  "transform-origin": _cssExpandPositionKeywords,
  "perspective-origin": _cssExpandPositionKeywords,
  "flex": _cssNormalizeFlexValue,
  "box-shadow": _cssNormalizeShadowValue,
  "text-shadow": _cssNormalizeShadowValue,
  "background": _cssNormalizeBackgroundValue,
  "background-position": _cssExpandPositionKeywords,
  "font": _cssNormalizeFontValue,
  "grid-area": _cssSpaceSlashValue,
  "grid-column": _cssSpaceSlashValue,
  "grid-row": _cssSpaceSlashValue,
  "grid-template": _cssSpaceSlashValue,
  "grid": _cssSpaceSlashValue,
  "margin": _cssCollapseEdgeValue,
  "padding": _cssCollapseEdgeValue,
  "inset": _cssCollapseEdgeValue,
  "border-width": _cssCollapseEdgeValue,
  "border-style": _cssCollapseEdgeValue,
  "border-color": _cssCollapseEdgeValue,
  "border-radius": _cssCollapseEdgeValue,
  "overflow": _cssCollapseEdgeValue,
  "overscroll-behavior": _cssCollapseEdgeValue,
  "scroll-margin": _cssCollapseEdgeValue,
  "scroll-padding": _cssCollapseEdgeValue,
  "stroke-dasharray": _cssCommaJoinValue,
};

function _cssValueHasVariable(value) {
  // Every match contains the substring "var"; skip the quoted-segment scan
  // for values without it.
  if (!/var/i.test(value)) return false;
  return _cssQuotedSegments(String(value || "")).some(({ quoted, text }) =>
    !quoted && /[\s(]var\s*\(|^var\s*\(/i.test(text));
}

// Chrome parses these prefixed shorthands as aliases and serializes them
// under the unprefixed name (`-webkit-transition: all .3s` ->
// `transition: 0.3s`).
const _CSS_PROPERTY_ALIASES = {
  "-webkit-animation": "animation",
  "-webkit-transition": "transition",
  "-webkit-box-shadow": "box-shadow",
};

// Declaration normalization is a pure function of (prop, value); real
// sheets repeat the same values across rules (theme colors, transforms),
// so memoize the pair in addition to the whole-list memo above.
const _cssDeclPairMemo = new Map();

function _cssNormalizeDeclarationText(prop, value) {
  const key = prop + "\0" + value;
  const cached = _cssDeclPairMemo.get(key);
  if (cached !== undefined) return cached;
  const aliased = _CSS_PROPERTY_ALIASES[prop.toLowerCase()] || prop;
  const lower = aliased.toLowerCase();
  const handler = _CSS_STYLE_VALUE_HANDLERS[lower];
  let out = handler ? handler(value) : value;
  out = _cssPassNumbers(out);
  out = _cssPassColors(out);
  out = _cssPassFunctions(out);
  out = _cssPassCommaSpace(out);
  if (_CSS_STYLE_LENGTH_PROPS.test(lower)) out = _cssPassZeroLength(lower, out);
  out = `${aliased}: ${out}`;
  if (_cssDeclPairMemo.size >= _CSS_DECL_TEXT_MEMO_MAX) _cssDeclPairMemo.clear();
  _cssDeclPairMemo.set(key, out);
  return out;
}

// Chrome keeps `!important` declarations after the normal ones (both in
// authored order) and echoes declarations whose value contains `var()`
// verbatim, because they stay pending substitution.
//
// Normalization is a pure text transform, and a cssRules walk re-serializes
// every rule on each access; real sheets also repeat declaration lists
// (utility classes, theme values). Memoize the raw declaration list ->
// normalized text so second walks and repeated declarations cost a map hit.
// Bounded so a sheet of unique declarations cannot grow it without limit.
const _cssDeclTextMemo = new Map();
const _CSS_DECL_TEXT_MEMO_MAX = 8192;
function _memoizedText(memo, key, compute) {
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const value = compute();
  if (memo.size >= _CSS_DECL_TEXT_MEMO_MAX) memo.clear();
  memo.set(key, value);
  return value;
}

function _normalizeStyleRuleDeclarations(cssText) {
  return _memoizedText(_cssDeclTextMemo, cssText, () => {
    const normal = [], important = [];
    for (const declaration of _splitCssDeclarations(cssText)) {
      const colon = declaration.indexOf(":");
      if (colon <= 0) continue;
      const prop = declaration.slice(0, colon).trim();
      const rawValue = declaration.slice(colon + 1).trim();
      if (!prop || !rawValue) continue;
      const priority = _cssHasPriority(rawValue);
      const value = priority ? _cssStripPriority(rawValue) : rawValue;
      const text = prop.startsWith("--") || _cssValueHasVariable(value)
        ? `${prop}: ${value}`
        : _cssNormalizeDeclarationText(prop, value);
      (priority ? important : normal).push(priority ? `${text} !important` : text);
    }
    const all = normal.concat(important);
    return all.length ? all.join("; ") + ";" : "";
  });
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
  return _memoizedText(_cssDeclTextMemo, cssText, () =>
    _normalizeKeyframeDeclarationsUncached(cssText));
}

function _normalizeKeyframeDeclarationsUncached(cssText) {
  const lengthFns = /^(translate|translate3d|translatex|translatey|translatez|perspective|blur)$/i;
  const angleFns = /^(rotate|rotatex|rotatey|rotatez|skew|skewx|skewy)$/i;
  // Standard length properties re-serialize a bare zero as `0px`; SVG
  // presentation properties (stroke-width...) and plain numbers (opacity,
  // z-index...) keep the authored `0`.
  const lengthProps = /^(?:margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|(?:min-|max-)?(?:width|height)|top|right|bottom|left|inset|letter-spacing|word-spacing|border-(?:width|spacing|radius|(?:top|right|bottom|left)-width)|outline-width|column-width|(?:column|row)-gap|gap|flex-basis|font-size|text-indent|vertical-align|background-position|object-position)$/;
  const rewrite = (text) => {
    let out = text.replace(/(?<![\w.])\.(\d)/g, "0.$1");
    out = out.replace(/([a-zA-Z-]+)(\s*:\s*)([^;]*)(;)/g, (match, prop, gap, value, semi) => {
      if (!lengthProps.test(prop.toLowerCase())) return match;
      const normalized = value.split(/([\s,]+)/)
        .map((token) => (token === "0" ? "0px" : token))
        .join("");
      return prop + gap + normalized + semi;
    });
    out = out.replace(/(?<![\w#])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/gi, _cssHexColorFn);
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
    _hset(this, "_keyText", _normalizeKeyText(keyText));
    const declaration = new CSSStyleDeclaration(null, () => this._changed(), this);
    const state = _cssStyleFor(declaration);
    _parseCssInto(state.props, declarations);
    state.loaded = true;
    _hset(this, "_decl", declaration);
    _hset(this, "_style", null);
  }
  get keyText() { return this._keyText; }
  set keyText(value) { _hset(this, "_keyText", _normalizeKeyText(value)); this._changed(); }
  get style() {
    if (!this._style) _hset(this, "_style", _styleProxy(this._decl));
    return this._style;
  }
  get cssText() {
    const declarations = _normalizeKeyframeDeclarations(this._decl.cssText);
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
    _hset(this, "_name", String(name || ""));
    _hset(this, "_keyRules", []);
    this._parseBody(String(bodyText || ""));
    _hset(this, "_dirty", false);
  }
  _parseBody(body) {
    _hset(this, "_keyRules", []);
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
      _hset(rule, "_parentRule", this);
      this._keyRules.push(rule);
      position = close;
      while (position < text.length && /\s/.test(text[position])) position++;
    }
  }
  get name() { return this._name; }
  set name(value) { _hset(this, "_name", String(value || "")); this._changed(); }
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
    _hset(rule, "_parentRule", this);
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
