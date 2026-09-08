// A submit button per the HTML spec: a <button> whose type is submit — the
// default, including when the type attribute is missing or invalid — or an
// <input> of type submit/image. Used to validate requestSubmit's submitter.
function _isSubmitButton(el) {
  if (!el || typeof el.localName !== "string") return false;
  const type = ((el.getAttribute && el.getAttribute("type")) || "").toLowerCase();
  if (el.localName === "button") return type !== "reset" && type !== "button";
  if (el.localName === "input") return type === "submit" || type === "image";
  return false;
}

// Carry the context element's full qualified name into html5ever. Fragment
// parsing depends on both the local name and namespace (SVG/MathML included).
function _fragmentContextPayload(context, html) {
  let namespace = 'http://www.w3.org/1999/xhtml';
  let qualified = 'body';
  if (typeof context === 'string') {
    qualified = context || 'body';
  } else if (context && context.nodeType === 1) {
    namespace = context.namespaceURI || '';
    qualified = context.nodeName || context.localName || 'body';
  }
  return namespace + "\0" + qualified + "\0" + String(html == null ? '' : html);
}

// Parse an HTML string into detached nodes using the actual insertion element
// as html5ever's fragment context. This preserves table/select parsing rules,
// comments, text-node order, and foreign-content namespaces without a wrap map.
function _parseHTMLFragment(html, context) {
  html = String(html == null ? '' : html);
  const ns = context && context.nodeType === 1 ? context.namespaceURI : null;
  const tag = context && context.nodeType === 1 ? context.localName : 'body';
  const tmp = ns && ns !== 'http://www.w3.org/1999/xhtml'
    ? document.createElementNS(ns, tag)
    : document.createElement(tag);
  // Callers already enforce the public Trusted Types sink. Going through the
  // public innerHTML setter here would enforce a second time after the trusted
  // wrapper was stringified, allowing a default policy to rewrite the markup.
  _dom("set_inner_html", tmp[_nidSym], html);
  const out = [];
  let child;
  while ((child = tmp.firstChild)) out.push(tmp.removeChild(child));
  return out;
}


let _waapiNextId = 1;
const _waapiAnimations = new Set();

function _normalizeWaapiKeyframes(input) {
  let frames;
  if (Array.isArray(input)) {
    frames = input.map(frame => ({ ...(frame || {}) }));
  } else if (input && typeof input === 'object') {
    const properties = Object.keys(input).filter(name => name !== 'offset' && name !== 'easing' && name !== 'composite');
    const count = Math.max(1, ...properties.map(name => Array.isArray(input[name]) ? input[name].length : 1));
    frames = Array.from({ length: count }, (_, index) => {
      const frame = {};
      for (const name of properties) {
        const values = Array.isArray(input[name]) ? input[name] : [input[name]];
        frame[name] = values[Math.min(index, values.length - 1)];
      }
      if (Array.isArray(input.offset)) frame.offset = input.offset[Math.min(index, input.offset.length - 1)];
      return frame;
    });
  } else {
    throw new TypeError('Keyframes must be an object or an array');
  }
  if (frames.length === 0) return [];
  let previous = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].offset != null) {
      const offset = Number(frames[i].offset);
      if (!Number.isFinite(offset) || offset < 0 || offset > 1 || offset < previous) {
        throw new TypeError('Invalid keyframe offset');
      }
      frames[i].offset = offset;
      previous = offset;
    }
  }
  if (frames[0].offset == null) frames[0].offset = 0;
  if (frames[frames.length - 1].offset == null) frames[frames.length - 1].offset = 1;
  let anchor = 0;
  while (anchor < frames.length - 1) {
    let next = anchor + 1;
    while (next < frames.length && frames[next].offset == null) next++;
    const from = frames[anchor].offset;
    const to = frames[next].offset;
    for (let i = anchor + 1; i < next; i++) {
      frames[i].offset = from + (to - from) * ((i - anchor) / (next - anchor));
    }
    anchor = next;
  }
  return frames.map(frame => {
    const normalized = { offset: frame.offset };
    if (frame.opacity != null) {
      const value = Number(frame.opacity);
      if (Number.isFinite(value)) normalized.opacity = Math.max(0, Math.min(1, value));
    }
    if (frame.transform != null) normalized.transform = String(frame.transform);
    return normalized;
  }).filter(frame => frame.opacity != null || frame.transform != null);
}

function _normalizeWaapiTiming(options) {
  if (typeof options === 'number') options = { duration: options };
  options = options || {};
  const duration = options.duration === 'auto' || options.duration == null ? 0 : Number(options.duration);
  const delay = options.delay == null ? 0 : Number(options.delay);
  const iterations = options.iterations == null ? 1 : Number(options.iterations);
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(delay)
      || (!Number.isFinite(iterations) && iterations !== Infinity) || iterations < 0) {
    throw new TypeError('Invalid animation timing');
  }
  const easing = options.easing == null ? 'linear' : String(options.easing).trim();
  const namedBezier = {
    'ease': [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  let easingBezier = easing === 'linear' ? null : namedBezier[easing];
  let linearEasing = null;
  if (easing.startsWith('linear(') && easing.endsWith(')')) {
    const values = easing.slice(7, -1).split(',').map(value => Number(value.trim()));
    if (values.length >= 2 && values.every(Number.isFinite)) linearEasing = values;
  }
  if (easingBezier === undefined) {
    const match = /^cubic-bezier\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)$/.exec(easing);
    if (match) {
      easingBezier = match.slice(1).map(Number);
      if (!easingBezier.every(Number.isFinite) || easingBezier[0] < 0 || easingBezier[0] > 1
          || easingBezier[2] < 0 || easingBezier[2] > 1) easingBezier = undefined;
    }
  }
  if (linearEasing) easingBezier = null;
  // steps() and linear() with explicit stop positions remain explicit
  // unsupported surfaces rather than being silently approximated.
  if (easingBezier === undefined) throw new TypeError('Unsupported animation easing: ' + easing);
  const fill = ['none', 'forwards', 'backwards', 'both'].includes(options.fill) ? options.fill : 'none';
  const direction = ['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(options.direction)
    ? options.direction : 'normal';
  return { duration, delay, iterations, fill, direction, easing, easingBezier, linearEasing };
}







function _animationsForTarget(target) {
  return Array.from(_waapiAnimations).filter(animation => {
    if (animation.effect?.target !== target || animation.playState === 'idle') return false;
    return animation.playState !== 'finished' || animation.effect._timing.fill === 'forwards' || animation.effect._timing.fill === 'both';
  });
}
