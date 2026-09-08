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

class NamedNodeMap {
  constructor(element) {
    Object.defineProperty(this, "_element", {
      value: element,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && /^(?:0|[1-9]\d*)$/.test(prop)) {
          return target.item(+prop);
        }
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        if (typeof prop === "string") return target.getNamedItem(prop);
        return undefined;
      },
      ownKeys(target) {
        const names = target._names();
        return Reflect.ownKeys(target).concat(
          names.map((_, i) => String(i)),
          names.filter((name) => !Reflect.has(target, name))
        );
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === "string" && (/^(?:0|[1-9]\d*)$/.test(prop) || target._names().includes(prop))) {
          return { configurable: true, enumerable: true, value: target[prop], writable: false };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });
  }
  _names() {
    return _domParse("attribute_names", this._element[_nidSym]) || [];
  }
  _attr(name) {
    const value = this._element.getAttribute(name);
    if (value === null) return null;
    const attr = new Attr(name, value, null, null);
    attr.ownerElement = this._element;
    return attr;
  }
  get length() { return this._names().length; }
  item(index) {
    const name = this._names()[Number(index)];
    return name === undefined ? null : this._attr(name);
  }
  getNamedItem(name) {
    name = String(name);
    return this._names().includes(name) ? this._attr(name) : null;
  }
  getNamedItemNS(namespaceURI, localName) {
    return this.getNamedItem(localName);
  }
  setNamedItem(attr) {
    if (!attr || typeof attr.name !== "string") return null;
    return this._element.setAttributeNode(attr);
  }
  setNamedItemNS(attr) { return this.setNamedItem(attr); }
  removeNamedItem(name) {
    const attr = this.getNamedItem(name);
    if (!attr) throw new DOMException("Attribute not found", "NotFoundError");
    return this._element.removeAttributeNode(attr);
  }
  removeNamedItemNS(namespaceURI, localName) {
    return this.removeNamedItem(localName);
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.item(i);
  }
}
globalThis.NamedNodeMap = NamedNodeMap;

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

class KeyframeEffect {
  constructor(target, keyframes, options) {
    if (!(target instanceof Element)) throw new TypeError('KeyframeEffect target must be an Element');
    this.target = target;
    this._keyframes = _normalizeWaapiKeyframes(keyframes);
    this._timing = _normalizeWaapiTiming(options);
  }
  getKeyframes() { return this._keyframes.map(frame => ({ ...frame, computedOffset: frame.offset, easing: 'linear', composite: 'auto' })); }
  getTiming() {
    const timing = this._timing;
    return {
      delay: timing.delay, endDelay: 0, fill: timing.fill,
      iterationStart: 0, iterations: timing.iterations,
      duration: timing.duration, direction: timing.direction, easing: timing.easing,
    };
  }
  getComputedTiming() {
    const animation = this._animation;
    const local = animation ? animation.currentTime : 0;
    const activeDuration = this._timing.duration * this._timing.iterations;
    const endTime = this._timing.delay + activeDuration;
    const progress = activeDuration > 0 ? Math.max(0, Math.min(1, (local - this._timing.delay) / activeDuration)) : null;
    return {
      ...this.getTiming(), activeDuration, endTime, localTime: local,
      progress, currentIteration: progress == null ? null : Math.min(this._timing.iterations, 1),
    };
  }
}

class Animation {
  constructor(effect = null, timeline = globalThis.document?.timeline || null) {
    this.id = '';
    this.effect = effect;
    this.timeline = timeline;
    this.onfinish = null;
    this.oncancel = null;
    this._nativeId = _waapiNextId++;
    this._registered = false;
    this._playState = 'idle';
    this._holdTime = 0;
    this._startTime = null;
    this._finishTimer = null;
    this.ready = Promise.resolve(this);
    this._resetFinishedPromise();
    if (effect) effect._animation = this;
  }
  _resetFinishedPromise() {
    this.finished = new Promise((resolve, reject) => {
      this._resolveFinished = resolve;
      this._rejectFinished = reject;
    });
    // Browser code commonly ignores the rejected cancel promise.
    this.finished.catch(() => {});
  }
  _native(action, value = 0) {
    try {
      const changed = !!Deno.core.ops.op_waapi_control?.(this._nativeId, action, Number(value) || 0);
      if (changed) _domMutationEpoch++;
      return changed;
    }
    catch (_) { return false; }
  }
  _register() {
    if (this._registered || !this.effect) return this._registered;
    const input = {
      id: this._nativeId,
      node: this.effect.target[_nidSym],
      keyframes: this.effect._keyframes,
      ...this.effect._timing,
      // JSON has no Infinity literal and would silently turn it into null.
      // Preserve the Web Animations unrestricted-double value explicitly.
      iterations: this.effect._timing.iterations === Infinity
        ? 0
        : this.effect._timing.iterations,
      iterationsInfinite: this.effect._timing.iterations === Infinity,
    };
    try { this._registered = !!Deno.core.ops.op_waapi_create?.(JSON.stringify(input)); }
    catch (_) { this._registered = false; }
    if (this._registered) {
      _waapiAnimations.add(this);
      _domMutationEpoch++;
    }
    return this._registered;
  }
  _scheduleFinish() {
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
    if (this._playState !== 'running' || !this.effect) return;
    const timing = this.effect._timing;
    if (timing.iterations === Infinity) {
      this._finishTimer = null;
      return;
    }
    const end = Math.max(0, timing.delay + timing.duration * timing.iterations);
    const remaining = Math.max(0, end - this.currentTime);
    this._finishTimer = setTimeout(() => this.finish(), remaining);
  }
  get playState() { return this._playState; }
  get currentTime() {
    if (this._playState === 'running' && this._startTime != null) return Math.max(0, performance.now() - this._startTime);
    return this._holdTime;
  }
  set currentTime(value) {
    const time = Math.max(0, Number(value) || 0);
    this._holdTime = time;
    if (this._playState === 'running') this._startTime = performance.now() - time;
    this._native('currentTime', time);
    this._scheduleFinish();
  }
  get startTime() { return this._startTime; }
  set startTime(value) {
    if (value == null) { this._startTime = null; return; }
    const start = Number(value);
    if (!Number.isFinite(start)) throw new TypeError('Invalid startTime');
    this._startTime = start;
    this._holdTime = Math.max(0, performance.now() - start);
    this._native('currentTime', this._holdTime);
    this._scheduleFinish();
  }
  play() {
    if (!this.effect) return;
    if (this._playState === 'finished' || this._playState === 'idle') {
      this._holdTime = 0;
      if (this._playState === 'finished') this._resetFinishedPromise();
    }
    this._register();
    this._startTime = performance.now() - this._holdTime;
    this._playState = 'running';
    this._native('play');
    this.ready = Promise.resolve(this);
    this._scheduleFinish();
  }
  pause() {
    if (this._playState === 'idle') this._register();
    this._holdTime = this.currentTime;
    this._playState = 'paused';
    this._native('currentTime', this._holdTime);
    this._native('pause');
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
  }
  finish() {
    if (!this.effect) return;
    this._register();
    const timing = this.effect._timing;
    this._holdTime = Math.max(0, timing.delay + timing.duration * timing.iterations);
    this._playState = 'finished';
    this._native('finish');
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
    this._resolveFinished(this);
    const event = new Event('finish');
    this.dispatchEvent(event);
    if (typeof this.onfinish === 'function') { try { this.onfinish.call(this, event); } catch (e) { console.error(e); } }
  }
  cancel() {
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
    this._native('cancel');
    this._registered = false;
    this._playState = 'idle';
    this._holdTime = 0;
    this._startTime = null;
    _waapiAnimations.delete(this);
    this._rejectFinished(new DOMException('The animation was canceled', 'AbortError'));
    const event = new Event('cancel');
    this.dispatchEvent(event);
    if (typeof this.oncancel === 'function') { try { this.oncancel.call(this, event); } catch (e) { console.error(e); } }
    this._resetFinishedPromise();
  }
  reverse() { throw new DOMException('reverse() is not implemented for this animation', 'NotSupportedError'); }
  addEventListener(type, callback, options) { _eventTargetAdd(this, type, callback, options); }
  removeEventListener(type, callback, options) { _eventTargetRemove(this, type, callback, options); }
  dispatchEvent(event) { return _eventTargetDispatch(this, event); }
}

class DocumentTimeline {
  constructor(options = {}) {
    this.originTime = Number(options.originTime) || 0;
  }
  get currentTime() { return performance.now() - this.originTime; }
}

function _animationsForTarget(target) {
  return Array.from(_waapiAnimations).filter(animation => {
    if (animation.effect?.target !== target || animation.playState === 'idle') return false;
    return animation.playState !== 'finished' || animation.effect._timing.fill === 'forwards' || animation.effect._timing.fill === 'both';
  });
}

class Element extends Node {
  constructor(nid) {
    const entry = _customElementConstructionStack[_customElementConstructionStack.length - 1];
    const matchesUpgrade = entry && new.target === entry.constructor;
    const upgrading = matchesUpgrade && !entry.constructed ? entry.element : null;
    super(upgrading ? upgrading[_nidSym] : nid);
    if (matchesUpgrade && entry.constructed) {
      throw new TypeError("Custom element is already being constructed");
    }
    if (upgrading) {
