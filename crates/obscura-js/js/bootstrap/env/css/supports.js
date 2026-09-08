const _CSS_SUPPORTED_DECLARATIONS = new Set((
  "display width height min-width min-height max-width max-height box-sizing aspect-ratio content " +
  "appearance -webkit-appearance " +
  "margin margin-top margin-right margin-bottom margin-left margin-inline margin-inline-start " +
  "margin-inline-end margin-block margin-block-start margin-block-end padding padding-top " +
  "padding-right padding-bottom padding-left padding-inline padding-inline-start padding-inline-end " +
  "padding-block padding-block-start padding-block-end border-radius border border-width " +
  "border-top-width border-right-width border-bottom-width border-left-width border-top border-right " +
  "border-bottom border-left background background-color background-image background-size " +
  "background-position background-clip -webkit-background-clip mask-image -webkit-mask-image " +
  "mask-size -webkit-mask-size mask-repeat -webkit-mask-repeat color -webkit-text-fill-color fill " +
  "stroke stroke-width border-color font-size font font-weight font-family font-style text-align " +
  "text-transform text-decoration text-decoration-line line-height white-space overflow-wrap word-wrap word-break text-wrap text-wrap-style align-items justify-items " +
  "place-items align-self justify-self place-self align-content justify-content place-content " +
  "flex-flow flex-direction flex-wrap flex-grow flex-shrink flex-basis flex order position float object-fit " +
  "top right bottom left inset overflow overflow-x overflow-y scrollbar-gutter visibility opacity animation " +
  "animation-name animation-fill-mode animation-iteration-count z-index clear vertical-align " +
  "list-style list-style-type gap grid-gap row-gap grid-row-gap column-gap grid-column-gap " +
  "border-spacing border-collapse grid-template-columns grid-template-rows grid-template-areas " +
  "grid-template grid grid-auto-flow grid-area grid-column grid-row grid-column-start " +
  "grid-column-end grid-row-start grid-row-end transform filter backdrop-filter " +
  "-webkit-backdrop-filter perspective contain will-change content-visibility box-shadow " +
  "-webkit-box-shadow"
).split(/\s+/));

const _CSS_SUPPORTED_COLOR_NAMES = new Set((
  "transparent white black gray grey silver lightgray lightgrey darkgray darkgrey whitesmoke " +
  "gainsboro red green lime blue navy yellow orange purple maroon teal aqua cyan fuchsia magenta " +
  "olive darkblue mediumblue royalblue dodgerblue cornflowerblue steelblue deepskyblue skyblue " +
  "lightskyblue lightblue powderblue cadetblue slateblue darkslateblue midnightblue indigo " +
  "darkgreen forestgreen seagreen mediumseagreen limegreen yellowgreen olivedrab darkolivegreen " +
  "greenyellow lightgreen palegreen springgreen mediumaquamarine aquamarine turquoise " +
  "mediumturquoise darkcyan crimson firebrick darkred indianred tomato orangered coral salmon " +
  "lightsalmon darksalmon hotpink deeppink pink lightpink palevioletred mediumvioletred violet " +
  "orchid plum mediumpurple blueviolet darkviolet darkorchid darkmagenta lavender thistle gold " +
  "goldenrod darkgoldenrod khaki darkkhaki peachpuff moccasin papayawhip wheat tan burlywood " +
  "sandybrown peru chocolate sienna saddlebrown brown rosybrown darkorange lightyellow " +
  "lightgoldenrodyellow lemonchiffon beige ivory azure mintcream honeydew snow seashell linen " +
  "oldlace floralwhite ghostwhite aliceblue lavenderblush mistyrose cornsilk antiquewhite bisque " +
  "blanchedalmond navajowhite dimgray dimgrey slategray slategrey lightslategray lightslategrey " +
  "darkslategray darkslategrey"
).split(/\s+/));

function _cssSupportsColor(value) {
  const raw = value.trim();
  const lower = raw.toLowerCase();
  if (_CSS_SUPPORTED_COLOR_NAMES.has(lower)) return true;
  if (/^#[0-9a-f]{3,4}(?:[0-9a-f]{2}){0,2}$/i.test(lower)) {
    return [4, 5, 7, 9].includes(lower.length);
  }
  if (lower.startsWith("var(") && lower.endsWith(")")) {
    const comma = _cssTopLevelComma(raw.slice(4, -1));
    return comma >= 0 && _cssSupportsColor(raw.slice(4 + comma + 1, -1));
  }
  if (/^rgba?\(/.test(lower) && lower.endsWith(")")) {
    // Keep the non-render build aligned with the renderer's capability
    // evaluator: relative colors are valid CSS, but are not implemented by
    // Obscura yet and therefore must not select an unsupported @supports arm.
    if (/\bfrom\b/.test(lower)) {
      return false;
    }
    const parts = lower.slice(lower.indexOf("(") + 1, -1)
      .split(/[,\s/]+/).filter(Boolean);
    return parts.length >= 3 && parts.slice(0, 3)
      .every((part) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part));
  }
  if (/^hsla?\(/.test(lower) && lower.endsWith(")")) {
    const parts = lower.slice(lower.indexOf("(") + 1, -1)
      .split(/[,\s/]+/).filter(Boolean);
    return parts.length >= 3 && parts.slice(0, 3).every((part) =>
      /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|%)?$/.test(part));
  }
  if (/^okl(?:ab|ch)\(/.test(lower) && lower.endsWith(")")) {
    const parts = lower.slice(lower.indexOf("(") + 1, -1)
      .split(/[,\s/]+/).filter(Boolean);
    return parts.length >= 3 && parts.slice(0, 3).every((part) =>
      /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|%)?$/.test(part));
  }
  if (lower.startsWith("light-dark(") && lower.endsWith(")")) {
    const parts = _cssSplitTopLevel(
      raw.slice("light-dark(".length, -1),
      ","
    );
    return !!parts && parts.length === 2 &&
      parts.every((part) => part.trim() && _cssSupportsColor(part));
  }
  if (lower.startsWith("color-mix(") && lower.endsWith(")")) {
    const parts = _cssSplitTopLevel(lower.slice("color-mix(".length, -1), ",");
    if (!parts || parts.length < 3 || !/^in\s+\S+$/i.test(parts[0].trim())) return false;
    const color = (part) => _cssSupportsColor(part.trim().replace(/\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)%\s*$/, ""));
    return color(parts[1]) && color(parts[2]);
  }
  return false;
}

function _cssTopLevelComma(text) {
  let depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === "," && depth === 0) return i;
    if (depth < 0) return -1;
  }
  return -1;
}

function _cssSupportsDeclaration(name, value) {
  name = name.trim().toLowerCase();
  value = value.trim();
  if (typeof Deno.core.ops.op_css_supports === "function") {
    try { return !!Deno.core.ops.op_css_supports(name, value); }
    catch (_) { return false; }
  }
  if (!value || _cssHasInvalidSupportsValueSyntax(value)) return false;
  if (name.startsWith("--")) return name.length > 2;
  if (!_CSS_SUPPORTED_DECLARATIONS.has(name)) return false;
  const lower = value.toLowerCase();
  if (["initial", "inherit", "unset", "revert", "revert-layer"].includes(lower)) return true;
  if (name === "display") {
    return ["none", "flex", "inline-flex", "inline", "inline-block", "grid",
      "inline-grid", "block", "flow-root", "table", "inline-table", "contents"].includes(lower);
  }
  if (name === "position") {
    return ["static", "relative", "absolute", "fixed", "sticky"].includes(lower);
  }
  if (name === "box-sizing") return ["content-box", "border-box"].includes(lower);
  if (name === "float") return ["none", "left", "right"].includes(lower);
  if (name === "object-fit") {
    return ["fill", "contain", "cover", "none", "scale-down"].includes(lower);
  }
  if (name === "visibility") return ["visible", "hidden", "collapse"].includes(lower);
  if (name === "appearance" || name === "-webkit-appearance") {
    // CSS UI appearance plus Chromium's legacy compatibility idents; mirrors
    // the renderer's appearance_value_supported list so both build shapes
    // answer feature queries identically.
    return ["none", "auto", "base-select", "searchfield", "textfield", "textarea", "checkbox", "radio", "menulist", "menulist-button", "listbox", "meter", "progress-bar", "button"].includes(lower);
  }
  if (name === "scrollbar-gutter") {
    return lower === "auto" || lower === "stable" || lower === "stable both-edges";
  }
  if (name === "white-space") {
    return ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"].includes(lower);
  }
  if (name === "overflow-wrap" || name === "word-wrap") {
    return ["normal", "break-word", "anywhere"].includes(lower);
  }
  if (name === "word-break") {
    return ["normal", "break-all", "keep-all", "break-word"].includes(lower);
  }
  if (name === "text-wrap") {
    return ["auto", "wrap", "balance", "wrap balance", "balance wrap"].includes(lower);
  }
  if (name === "text-wrap-style") return lower === "auto" || lower === "balance";
  if (["filter", "backdrop-filter", "-webkit-backdrop-filter", "perspective"].includes(name)) {
    return lower === "none";
  }
  if (name === "contain") return lower === "none";
  if (name === "content-visibility") return lower === "visible";
  if (name === "content") return _cssSupportsContent(value);
  if (["border", "border-top", "border-right", "border-bottom", "border-left"].includes(name)) {
    if (lower === "none") return true;
    const parts = _cssSplitWhitespace(value);
    if (!parts.length || parts.length > 3) return false;
    let widths = 0, styles = 0, colors = 0;
    for (const part of parts) {
      const token = part.toLowerCase();
      if (["thin", "medium", "thick"].includes(token) ||
          (_cssSupportsDimension(part, false) && !token.includes("%"))) widths++;
      else if (["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"].includes(token)) styles++;
      else if (_cssSupportsColor(part) || token === "currentcolor") colors++;
      else return false;
    }
    return widths <= 1 && styles <= 1 && colors <= 1;
  }
  if (["width", "height", "min-width", "min-height", "max-width", "max-height", "flex-basis"].includes(name)) {
    return _cssSupportsDimension(value, true) || (name === "width" && lower === "fit-content");
  }
  if (/^(?:margin(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|padding(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|inset(?:-(?:inline|inline-start|inline-end|block|block-start|block-end))?|top|right|bottom|left)$/.test(name)) {
    const allowAuto = name.startsWith("margin") || name === "top" || name === "right" || name === "bottom" || name === "left" || name.startsWith("inset");
    const parts = _cssSplitWhitespace(value);
    const max = /^(?:margin|padding|inset)$/.test(name) ? 4 : (/(?:inline|block)$/.test(name) ? 2 : 1);
    return parts.length > 0 && parts.length <= max && parts.every((part) => _cssSupportsDimension(part, allowAuto));
  }
  if (["align-items", "justify-items", "align-self", "justify-self"].includes(name)) {
    return _cssSupportsSelfAlignment(lower);
  }
  if (name === "align-content" || name === "justify-content") {
    return _cssSupportsContentAlignment(lower) || (name === "justify-content" && ["left", "right"].includes(lower));
  }
  if (name === "flex-flow") {
    const tokens = _cssSplitWhitespace(lower);
    if (tokens.length < 1 || tokens.length > 2) return false;
    let direction = false, wrap = false;
    for (const token of tokens) {
      if (["row", "row-reverse", "column", "column-reverse"].includes(token)) {
        if (direction) return false;
        direction = true;
      } else if (["nowrap", "wrap", "wrap-reverse"].includes(token)) {
        if (wrap) return false;
        wrap = true;
      } else {
        return false;
      }
    }
    return true;
  }
  if (name === "flex-direction") return ["row", "row-reverse", "column", "column-reverse"].includes(lower);
  if (name === "flex-wrap") return ["nowrap", "wrap", "wrap-reverse"].includes(lower);
  if (name === "flex-grow" || name === "flex-shrink") {
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(lower);
  }
  if (name === "order") return /^[-+]?\d+$/.test(lower);
  if (name === "opacity") return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lower);
  if (name === "z-index") return lower === "auto" || /^[-+]?\d+$/.test(lower);
  if (["color", "-webkit-text-fill-color", "background-color", "border-color"].includes(name)) {
    return _cssSupportsColor(value);
  }
  return false;
}

function _cssHasInvalidSupportsValueSyntax(value) {
  let depth = 0, quote = "";
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") { i++; continue; }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") {
      if (--depth < 0) return true;
    } else if (depth === 0 && /[;{}]/.test(character)) return true;
    else if (depth === 0 && character === "!" && /^\s*important\b/i.test(value.slice(i + 1))) return true;
  }
  return depth !== 0 || !!quote;
}

function _cssSplitWhitespace(value) {
  const values = [], split = _cssSplitTopLevel(value, " ");
  if (split) return split;
  let depth = 0, quote = "", start = -1;
  for (let i = 0; i <= value.length; i++) {
    const character = value[i] || " ";
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
    } else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    if (/\s/.test(character) && depth === 0 && !quote) {
      if (start >= 0) values.push(value.slice(start, i));
      start = -1;
    } else if (start < 0) start = i;
  }
  return values;
}

function _cssSupportsDimension(value, allowAuto) {
  const lower = value.trim().toLowerCase();
  if (allowAuto && lower === "auto") return true;
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|em|ex|rem|vw|vh|dvw|dvh|svw|svh|lvw|lvh|vmin|vmax|%)$/i.test(lower)) return true;
  if (/^[-+]?0(?:\.0*)?$/.test(lower)) return true;
  return /^(?:calc|min|max|clamp|var)\(.+\)$/i.test(lower);
}

function _cssSupportsSelfAlignment(value) {
  return /^(?:auto|normal|stretch|baseline|first baseline|center|(?:safe |unsafe )?(?:start|end|self-start|self-end|flex-start|flex-end))$/.test(value);
}

function _cssSupportsContentAlignment(value) {
  return /^(?:normal|stretch|baseline|first baseline|space-between|space-around|space-evenly|(?:safe |unsafe )?(?:start|end|flex-start|flex-end|center))$/.test(value);
}

function _cssSupportsContent(value) {
  const lower = value.trim().toLowerCase();
  if (lower === "none" || lower === "normal" || _cssSupportsSingleUrl(value)) return true;
  let rest = value.trim(), found = false;
  while (rest) {
    rest = rest.trimStart();
    if (rest[0] === "'" || rest[0] === '"') {
      const quote = rest[0];
      let end = 1;
      for (; end < rest.length; end++) {
        if (rest[end] === "\\") end++;
        else if (rest[end] === quote) break;
      }
      if (end >= rest.length) return false;
      rest = rest.slice(end + 1);
      found = true;
      continue;
    }
    const keyword = /^(?:open-quote|close-quote|no-open-quote|no-close-quote)\b/i.exec(rest);
    if (keyword) {
      rest = rest.slice(keyword[0].length);
      found = true;
      continue;
    }
    const fn = /^(attr|counter|counters)\(/i.exec(rest);
    if (!fn) return false;
    let depth = 0, quote = "", end = -1;
    for (let i = fn[1].length; i < rest.length; i++) {
      const character = rest[i];
      if (quote) {
        if (character === "\\") i++;
        else if (character === quote) quote = "";
      } else if (character === "'" || character === '"') quote = character;
      else if (character === "(") depth++;
      else if (character === ")" && --depth === 0) { end = i; break; }
    }
    const argumentsText = rest.slice(fn[0].length, end).trim();
    if (end < 0 || !_cssSupportsContentFunction(fn[1].toLowerCase(), argumentsText)) return false;
    rest = rest.slice(end + 1);
    found = true;
  }
  return found;
}

function _cssSupportsSingleUrl(value) {
  value = value.trim();
  if (!/^url\(/i.test(value) || !value.endsWith(")")) return false;
  let depth = 0, quote = "";
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") { i++; continue; }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")" && --depth === 0) {
      return i === value.length - 1 && value.slice(4, i).trim().length > 0;
    }
  }
  return false;
}

function _cssSupportsContentFunction(name, argumentsText) {
  const argumentsList = _cssSplitTopLevel(argumentsText, ",") || [argumentsText];
  const ident = (value) => /^[a-z0-9_\\-]+$/i.test(value.trim());
  const counterStyle = (value) => /^(?:decimal|decimal-leading-zero|lower-alpha|lower-latin|upper-alpha|upper-latin|lower-roman|upper-roman)$/i.test(value.trim());
  if (name === "attr") return argumentsList.length === 1 && ident(argumentsList[0].trim().split(/\s+/)[0]);
  if (name === "counter") {
    return argumentsList.length >= 1 && argumentsList.length <= 2 && ident(argumentsList[0]) &&
      (argumentsList.length === 1 || counterStyle(argumentsList[1]));
  }
  if (name === "counters") {
    return argumentsList.length >= 2 && argumentsList.length <= 3 && ident(argumentsList[0]) &&
      /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(argumentsList[1].trim()) &&
      (argumentsList.length === 2 || counterStyle(argumentsList[2]));
  }
  return false;
}

// Return the contents only when one pair of parentheses encloses the complete
// expression. Declaration leaves such as `(display:grid)` are then evaluated
// by the same path as the two-argument overload.
function _cssEnclosingGroup(text) {
  if (!text.startsWith("(")) return null;
  let depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) return i === text.length - 1 ? text.slice(1, i) : null;
    }
  }
  return null;
}

function _cssSplitTopLevel(text, operator) {
  const parts = [];
  const isWord = /^[a-z]+$/i.test(operator);
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") {
      depth--;
      if (depth < 0) return null;
    } else if (depth === 0 &&
        text.slice(i, i + operator.length).toLowerCase() === operator.toLowerCase() &&
        (!isWord || (i > 0 && /\s/.test(text[i - 1]) &&
          i + operator.length < text.length && /\s/.test(text[i + operator.length])))) {
      const part = text.slice(start, i).trim();
      if (!part) return null;
      parts.push(part);
      i += operator.length - 1;
      start = i + 1;
    }
  }
  if (depth !== 0 || quote || !parts.length) return null;
  const tail = text.slice(start).trim();
  if (!tail) return null;
  parts.push(tail);
  return parts;
}

function _cssHasTopLevelComma(text) {
  let depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") { i++; continue; }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (character === "," && depth === 0) return true;
    if (depth < 0) return false;
  }
  return false;
}

const _CSS_SUPPORTED_SIMPLE_PSEUDOS = new Set((
  "hover active focus focus-visible focus-within enabled disabled checked link any-link visited " +
  "first-child last-child only-child root empty scope first-of-type last-of-type only-of-type " +
  "before after"
).split(/\s+/));
const _CSS_SUPPORTED_FUNCTIONAL_PSEUDOS = new Set((
  "nth-child nth-of-type nth-last-child nth-last-of-type is where has host not"
).split(/\s+/));

function _cssSupportsSelector(selector) {
  selector = selector.trim();
  if (!selector || /[{};]/.test(selector)) return false;
  const split = _cssSplitTopLevel(selector, ",");
  if (!split && _cssHasTopLevelComma(selector)) return false;
  const selectors = split || [selector];
  return selectors.every((part) => {
    part = part.trim();
    if (!part || /^[>+~]/.test(part) || /[>+~]\s*$/.test(part)) return false;
    let parens = 0, brackets = 0, quote = "";
    for (let i = 0; i < part.length; i++) {
      const character = part[i];
      if (quote) {
        if (character === "\\") i++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "\\") { i++; continue; }
      if (character === "'" || character === '"') quote = character;
      else if (character === "(") parens++;
      else if (character === ")") parens--;
      else if (character === "[") brackets++;
      else if (character === "]") brackets--;
      else if (character === ":" && brackets === 0) {
        const doubleColon = part[i + 1] === ":";
        let end = i + (doubleColon ? 2 : 1);
        const start = end;
        while (end < part.length && /[a-z0-9_-]/i.test(part[end])) end++;
        if (end === start) return false;
        const name = part.slice(start, end).toLowerCase();
        const functional = part[end] === "(";
        if (doubleColon) {
          if (functional || !["before", "after"].includes(name)) return false;
        } else if (functional) {
          if (!_CSS_SUPPORTED_FUNCTIONAL_PSEUDOS.has(name)) return false;
        } else if (!_CSS_SUPPORTED_SIMPLE_PSEUDOS.has(name)) {
          return false;
        }
        i = end - 1;
      }
      if (parens < 0 || brackets < 0) return false;
    }
    return !quote && parens === 0 && brackets === 0;
  });
}

function _cssBalancedSupportsSyntax(condition) {
  const stack = [];
  let quote = "";
  for (let i = 0; i < condition.length; i++) {
    const character = condition[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") { i++; continue; }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(") stack.push(")");
    else if (character === "[") stack.push("]");
    else if ((character === ")" || character === "]") && stack.pop() !== character) return false;
  }
  return !quote && stack.length === 0;
}

// `null` means invalid syntax, which is distinct from a valid false leaf.
// In particular `not <invalid>` must remain false rather than flipping true.
function _cssSupportsConditionResult(condition) {
  condition = condition.trim();
  if (!condition || !_cssBalancedSupportsSyntax(condition)) return null;
  const grouped = _cssEnclosingGroup(condition);
  if (grouped !== null) return _cssSupportsConditionResult(grouped);
  if (/^not\s/i.test(condition)) {
    const result = _cssSupportsConditionResult(condition.slice(3).trim());
    return result === null ? null : !result;
  }
  const orParts = _cssSplitTopLevel(condition, "or");
  const andParts = _cssSplitTopLevel(condition, "and");
  if (orParts && andParts) return null;
  if (orParts) {
    const results = orParts.map(_cssSupportsConditionResult);
    return results.includes(null) ? null : results.some(Boolean);
  }
  if (andParts) {
    const results = andParts.map(_cssSupportsConditionResult);
    return results.includes(null) ? null : results.every(Boolean);
  }
  if (/^selector\(/i.test(condition) && condition.endsWith(")")) {
    return _cssSupportsSelector(condition.slice(condition.indexOf("(") + 1, -1));
  }
  const colon = condition.indexOf(":");
  if (colon < 0) {
    return /^[a-z_-][a-z0-9_-]*\([\s\S]*\)$/i.test(condition) ? false : null;
  }
  return _cssSupportsDeclaration(condition.slice(0, colon), condition.slice(colon + 1));
}

function _cssSupportsCondition(condition) {
  return _cssSupportsConditionResult(condition) === true;
}

globalThis.CSS = {
  supports(prop, value){
    try {
      if (arguments.length >= 2) {
        return _cssSupportsDeclaration(String(prop), String(value));
      }
      return _cssSupportsCondition(String(prop));
    } catch (e) { return false; }
  },
  escape(s){ return s; }
};

globalThis.HTMLElement = Element;
globalThis.HTMLDivElement = Element;
globalThis.HTMLSpanElement = Element;
globalThis.HTMLParagraphElement = Element;
globalThis.HTMLAnchorElement = Element;
globalThis.HTMLImageElement = HTMLImageElement;
