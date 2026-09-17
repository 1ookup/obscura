// Register the two primary Window aliases before document/location so the
// global property order matches Chromium.
globalThis.window = globalThis;
globalThis.self = globalThis;

globalThis.document = null;
function _environmentSettings() {
  const isWorker = globalThis.__obscuraIsWorker === true
    || (typeof WorkerGlobalScope === "function"
      && globalThis instanceof WorkerGlobalScope)
    || typeof globalThis.document === "undefined";
  // Workers are a separate isolate with no document tree. Check them before
  // the frame-root path: a leftover frame nid on the snapshot global would
  // otherwise make fetch("") resolve against the widget document URL.
  if (isWorker) {
    const url = globalThis.__virtualUrl || globalThis.location?.href || "about:blank";
    let origin = typeof globalThis.origin === "string" ? globalThis.origin : "null";
    if (!origin || origin === "null") {
      try { origin = (globalThis.location && globalThis.location.origin) || new URL(url).origin; }
      catch (e) { origin = "null"; }
    }
    let baseUrl = url;
    if (origin && origin !== "null"
        && (String(url).startsWith("blob:") || String(url).startsWith("data:"))) {
      baseUrl = origin.endsWith("/") ? origin : origin + "/";
    }
    return { root: 0, url, baseUrl, cookieUrl: url, origin };
  }
  const root = _callingFrameRoot();
  if (root > 0) {
    const info = _domParse("document_scope_info", root) || {};
    const rawUrl = info.url || globalThis.__obscura_frame_base_url || "about:blank";
    let url = rawUrl;
    // The deliberate answer below applies only to frames whose document
    // origin is the inherited tuple origin. Opaque-origin frames (sandboxed
    // without allow-same-origin) keep the spec answer: Chrome reports
    // location.origin "null" there, and no probe can expect more than the
    // browser it models shows.
    const tupleOrigin = typeof info.origin === "string"
      && info.origin !== "" && info.origin !== "null";
    if (tupleOrigin && (rawUrl === "about:srcdoc" || rawUrl === "about:blank")
        && /^https?:/i.test(info.baseUrl || "")) {
      // srcdoc/about:blank frames inherit their creator's origin. Chrome
      // keeps `document.URL` as about:srcdoc but reports a Location whose
      // href is the creator's document URL. Returning the raw about: URL
      // made Turnstile's srcdoc probes see protocol "about:" and choose PAT.
      //
      // The about:blank case is deliberate: Cloudflare builds about:blank
      // frames for its probes, and answering "about:" for them sends the VM
      // down the PAT branch. Measured 2026-09-17: restoring the spec answer
      // (location.origin "null") turns three tests green but stalls the
      // challenge after ~4s / ~4k records with a blank page, against 801k
      // records with this deliberate answer. Keep the deliberate answer.
      url = info.baseUrl;
    } else if (tupleOrigin && (rawUrl === "about:srcdoc" || rawUrl === "about:blank")
        && globalThis.__obscura_frame_base_url
        && /^https?:/i.test(globalThis.__obscura_frame_base_url)) {
      url = globalThis.__obscura_frame_base_url;
    }
    const baseUrl = (globalThis.document && globalThis.document.baseURI)
      || info.baseUrl || globalThis.__obscura_frame_base_url || url;
    const cookieUrl = /^(?:https?|wss?):/i.test(url) ? url : baseUrl;
    return { root, url, baseUrl, cookieUrl, origin: info.origin || "null" };
  }
  const url = _domParse("document_url") || "about:blank";
  let origin = "null";
  try { origin = new URL(url).origin; } catch (e) {}
  const baseUrl = (globalThis.document && globalThis.document.baseURI) || url;
  return { root: 0, url, baseUrl, cookieUrl: url, origin };
}
// Internal base lookup used by the engine's own URL resolution. Calling the
// author-facing querySelector here leaks an implementation detail into the
// challenge's selector telemetry (Chrome resolves this natively).
function _internalBaseHref(doc) {
  try {
    if (!doc || typeof doc[_nidSym] !== 'number') return null;
    const nid = Number(_dom("query_selector_scoped", doc[_nidSym], "base[href]"));
    if (!Number.isFinite(nid) || nid < 0) return null;
    return _domParse("get_attribute", nid, "href") || null;
  } catch (_) { return null; }
}

function _resolveUrl(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('about:')) return url;
  try { return new URL(url, _environmentSettings().baseUrl).href; } catch(e) { return url; }
}
function _navigateCurrentContext(url, method, body) {
  const settings = _environmentSettings();
  if (settings.root > 0) {
    Deno.core.ops.op_navigate_frame(settings.root, url, method, body);
  } else {
    Deno.core.ops.op_navigate(url, method, body);
  }
}
// `__virtualUrl` is set by `history.pushState`/`replaceState` (and cleared by
// any real navigation). When set, `location.href` and friends read it instead
// of the underlying `document_url`. Without this, client-side routers
// (Next.js, React Router, vue-router) call `pushState` but the URL never
// changes, so their `useLocation` hooks return the wrong path and the UI
// freezes on the original route.
globalThis.__virtualUrl = null;
function __currentUrl() {
  return globalThis.__virtualUrl || _environmentSettings().url;
}
let _locationObj;
function registerLocationSurface() {
globalThis.location = _bootstrapObject('location', () => ({
  get href() { return __currentUrl(); },
  set href(url) { var r = _resolveUrl(url); globalThis.__virtualUrl = r; _navigateCurrentContext(r, 'GET', ''); },
  get origin() { try { return new URL(this.href).origin; } catch { return ""; } },
  get protocol() { try { return new URL(this.href).protocol; } catch { return ""; } },
  get host() { try { return new URL(this.href).host; } catch { return ""; } },
  get hostname() { try { return new URL(this.href).hostname; } catch { return ""; } },
  get pathname() { try { return new URL(this.href).pathname; } catch { return "/"; } },
  get search() { try { return new URL(this.href).search; } catch { return ""; } },
  get hash() { try { return new URL(this.href).hash; } catch { return ""; } },
  get port() { try { return new URL(this.href).port; } catch { return ""; } },
  toString() { return this.href; },
  assign(url) { var r = _resolveUrl(url); globalThis.__virtualUrl = r; _navigateCurrentContext(r, 'GET', ''); },
  reload() { var r = _resolveUrl(this.href); globalThis.__virtualUrl = r; _navigateCurrentContext(r, 'GET', ''); },
  replace(url) { var r = _resolveUrl(url); globalThis.__virtualUrl = r; _navigateCurrentContext(r, 'GET', ''); },
}));
_locationObj = globalThis.location;
Object.defineProperty(globalThis, 'location', {
  get() { return _locationObj; },
  set(url) { var r = _resolveUrl(String(url)); globalThis.__virtualUrl = r; _navigateCurrentContext(r, 'GET', ''); },
  configurable: false,
  enumerable: true,
});
// The object literal above inherits straight from Object.prototype, so
// `location instanceof Location` threw (no such global) and
// Object.prototype.toString.call(location) read "[object Object]". Give it the
// real interface. Location's members stay own properties of the instance, which
// matches Chrome: every one of them is [LegacyUnforgeable] in the HTML spec.
function Location() { throw new TypeError("Illegal constructor"); }
Object.defineProperty(globalThis, 'Location', {
  value: Location, writable: true, enumerable: false, configurable: true,
});
_markNative(Location);
Object.setPrototypeOf(_locationObj, Location.prototype);
}

registerLocationSurface();

function registerWindowAliasesSurface() {
  globalThis.top = globalThis;
  globalThis.parent = globalThis;
  globalThis.frames = globalThis;
  globalThis.frameElement = null;
  globalThis.length = 0;
}

// HTML spec exposes on* event handler IDL attributes via the GlobalEventHandlers
// mixin on Window, Document, and HTMLElement. Libraries feature-detect the modern
// event path through these: jQuery checks `("on" + ev) in window`, and React
// decides whether the `input` event is supported via `("oninput" in document)`.
// When that check fails React falls back to a legacy change-detection path that
// never fires onChange for controlled inputs (issue #324). Initialising these to
// null on all three targets makes the checks match real browsers. On Document and
// Element they are non-enumerable so they don't surface in `for..in` over nodes.
// The event-handler IDL attributes, split the way the mixins are: one set
// shared by Window, Document and Element, one only on Window, one only on
// Document, and the clipboard pair that Document and Element share.
//
// The names come from enumerating window and document in Chrome 149, not from
// spec text. Chrome ships several that no spec lists (`onmousewheel`, the four
// `onwebkit*` aliases, `onsearch`) and omits some a reading of the spec would
// add, so the enumeration is the only source that matches what a page sees.
// Getting the split wrong is visible in one line: the previous single list put
// `onbeforeunload`, `onhashchange`, `onmessage` and eleven more Window-only
// handlers on Document, where Chrome has none of them.
const _GLOBAL_EVENT_HANDLERS = [
  "abort","animationcancel","animationend","animationiteration",
  "animationstart","auxclick","beforeinput","beforematch","beforetoggle",
  "beforexrselect","blur","cancel","canplay","canplaythrough","change","click",
  "close","command","contentvisibilityautostatechange","contextlost",
  "contextmenu","contextrestored","cuechange","dblclick","drag","dragend",
  "dragenter","dragleave","dragover","dragstart","drop","durationchange",
  "emptied","ended","error","focus","formdata","gotpointercapture","input",
  "invalid","keydown","keypress","keyup","load","loadeddata","loadedmetadata",
  "loadstart","lostpointercapture","mousedown","mouseenter","mouseleave",
  "mousemove","mouseout","mouseover","mouseup","mousewheel","pause","play",
  "playing","pointercancel","pointerdown","pointerenter","pointerleave",
  "pointermove","pointerout","pointerover","pointerrawupdate","pointerup",
  "progress","ratechange","reset","resize","scroll","scrollend",
  "scrollsnapchange","scrollsnapchanging","search","securitypolicyviolation",
  "seeked","seeking","select","selectionchange","selectstart","slotchange",
  "stalled","submit","suspend","timeupdate","toggle","transitioncancel",
  "transitionend","transitionrun","transitionstart","volumechange","waiting",
  "webkitanimationend","webkitanimationiteration","webkitanimationstart",
  "webkittransitionend","wheel",
];
const _WINDOW_EVENT_HANDLERS = [
  "afterprint","appinstalled","beforeinstallprompt","beforeprint",
  "beforeunload","devicemotion","deviceorientation","deviceorientationabsolute",
  "gamepadconnected","gamepaddisconnected","hashchange","languagechange",
  "message","messageerror","offline","online","pagehide","pagereveal",
  "pageshow","pageswap","popstate","rejectionhandled","storage",
  "unhandledrejection","unload",
];
// DocumentAndElementEventHandlers, plus Chrome's three `before*` extensions.
const _CLIPBOARD_EVENT_HANDLERS = [
  "beforecopy","beforecut","beforepaste","copy","cut","paste",
];
const _DOCUMENT_EVENT_HANDLERS = [
  "freeze","fullscreenchange","fullscreenerror","pointerlockchange",
  "pointerlockerror","prerenderingchange","readystatechange","resume",
  "visibilitychange","webkitfullscreenchange","webkitfullscreenerror",
];
// Handler slots are accessor pairs, the shape a real browser exposes: an
// assignment never creates an own property on the instance (`Object.keys(el)`
// stays clean, `delete el.onclick` is a no-op). Under trace the setter also
// snapshots the assigning code's execution-source label.
//
// Placement note: Chrome splits these across HTMLElement.prototype and
// SVGElement.prototype; Obscura's HTML interface layer is one Element class
// (globalThis.HTMLElement === Element), so the HTML half lives on
// Element.prototype and SVGElement installs its own set later (svg-elements.js).
for (const _ev of _GLOBAL_EVENT_HANDLERS.concat(_WINDOW_EVENT_HANDLERS)) {
  const _on = "on" + _ev;
  if (!(_on in globalThis)) __obscuraTraceDefineHandler(globalThis, _on, true);
}
for (const _ev of _GLOBAL_EVENT_HANDLERS
  .concat(_CLIPBOARD_EVENT_HANDLERS, _DOCUMENT_EVENT_HANDLERS)) {
  const _on = "on" + _ev;
  if (!(_on in Document.prototype)) __obscuraTraceDefineHandler(Document.prototype, _on, false);
}
for (const _ev of _GLOBAL_EVENT_HANDLERS
  .concat(_CLIPBOARD_EVENT_HANDLERS, ["focusin", "focusout"])) {
  const _on = "on" + _ev;
  if (!(_on in Element.prototype)) __obscuraTraceDefineHandler(Element.prototype, _on, false);
}

globalThis.Window = globalThis.Window || function Window() {};
Object.defineProperty(globalThis.Window, Symbol.hasInstance, {
  value(obj) { return obj === globalThis || (obj && obj.window === obj); },
  configurable: true,
});
// Legacy storage constants are own properties on both Window and its
// prototype in Chrome. They are still observable through interface-shape
// probes even though the synchronous Web Storage API no longer uses them.
Object.defineProperties(globalThis.Window, {
  TEMPORARY: { value: 0, writable: false, enumerable: true, configurable: false },
  PERSISTENT: { value: 1, writable: false, enumerable: true, configurable: false },
});
Object.defineProperties(globalThis.Window.prototype, {
  TEMPORARY: { value: 0, writable: false, enumerable: true, configurable: false },
  PERSISTENT: { value: 1, writable: false, enumerable: true, configurable: false },
});
// A browser global inherits from Window.prototype. This gives frameworks the
// required `self.constructor === Window` identity without exposing constructor
// as an own Window key (Chrome does not).
Object.setPrototypeOf(globalThis, globalThis.Window.prototype);
const _barPropKey = Symbol('BarProp');
class BarProp {
  constructor(key = undefined) {
    if (key !== _barPropKey) {
      throw new TypeError("Failed to construct 'BarProp': Illegal constructor");
    }
  }
  get visible() { return true; }
  get [Symbol.toStringTag]() { return 'BarProp'; }
}
const _externalKey = Symbol('External');
class External {
  constructor(key = undefined) {
    if (key !== _externalKey) {
      throw new TypeError("Failed to construct 'External': Illegal constructor");
    }
  }
  AddSearchProvider() {}
  IsSearchProviderInstalled() { return 0; }
  get [Symbol.toStringTag]() { return 'External'; }
}
// `window.external.tracelog(key, value)`, the instrumented build's tracing
// primitive: one JSON line per call, appended to the tracelog file (see
// tracelog.rs and docs/native-trace.md). The method exists only when the host
// asked for a destination, so a production page sees Chrome's stock External
// surface and cannot use the object to write anything. The value is serialized
// here, on the calling thread, exactly like the reference build does; a value
// that serializes to nothing (undefined, a function, a throwing getter) reaches
// the writer as null. DOMString conversion for the key follows WebIDL, so a
// Symbol key throws where `String(symbol)` would not.
function _tracelogKey(key) {
  if (typeof key === 'string') return key;
  if (typeof key === 'symbol') {
    throw new TypeError('Cannot convert a Symbol value to a string');
  }
  return String(key);
}
function _tracelogSend(key, value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    json = undefined;
  }
  try {
    Deno.core.ops.op_tracelog(key, typeof json === 'string' ? json : '');
  } catch (error) { /* tracing stays best-effort, like the other streams */ }
}
if (globalThis.__obscura_tracelog_enabled === true) {
  // WebIDL declares an operation on the prototype as enumerable, and the
  // enumerability pass at the end of the bootstrap promotes class members to
  // match; declaring it here keeps the shape right in a realm where that pass
  // has not run yet.
  Object.defineProperty(External.prototype, 'tracelog', {
    value: _markNative(function tracelog(key, value) {
      _tracelogSend(_tracelogKey(key), value);
    }),
    writable: true, enumerable: true, configurable: true,
  });
}
globalThis.BarProp = BarProp;
globalThis.External = External;
Object.defineProperty(globalThis, 'external', {
  value: new External(_externalKey), writable: true, enumerable: true, configurable: true,
});
for (const name of ['locationbar', 'menubar', 'personalbar',
                    'scrollbars', 'statusbar', 'toolbar']) {
  Object.defineProperty(globalThis, name, {
    value: new BarProp(_barPropKey), writable: true, enumerable: true, configurable: true,
  });
}
registerWindowAliasesSurface();
const _styleMediaPrototype = {};
Object.defineProperties(_styleMediaPrototype, {
  type: {
    get: _markNativeAs(function () { return 'screen'; },
      'function get type() { [native code] }'),
    enumerable: true, configurable: true,
  },
  matchMedium: {
    value: _markNative(function matchMedium(query) { return matchMedia(String(query)).matches; }),
    writable: true, enumerable: true, configurable: true,
  },
  [Symbol.toStringTag]: { value: 'StyleMedia', configurable: true },
});
Object.defineProperty(globalThis, 'styleMedia', {
  value: Object.create(_styleMediaPrototype),
  writable: true, enumerable: true, configurable: true,
});
for (const [name, value] of [
  ['fence', null], ['credentialless', false], ['offscreenBuffering', true],
  ['originAgentCluster', true],
]) {
  Object.defineProperty(globalThis, name, {
    value, writable: true, enumerable: true, configurable: true,
  });
}
if (!Object.getOwnPropertyDescriptor(Navigator.prototype,
    'deprecatedRunAdAuctionEnforcesKAnonymity')) {
  Object.defineProperty(Navigator.prototype,
    'deprecatedRunAdAuctionEnforcesKAnonymity', {
      value: false, writable: true, enumerable: true, configurable: true,
    });
}
const _windowEventPrototype = Object.getPrototypeOf(globalThis);
if (_windowEventPrototype && !Object.getOwnPropertyDescriptor(_windowEventPrototype, 'when')) {
  const when = ({ when(type, options = undefined) {
    return _eventTargetWhen.call(this, type, options, arguments.length);
  } }).when;
  _markNative(when);
  Object.defineProperty(_windowEventPrototype, 'when', {
    value: when, writable: true, enumerable: true, configurable: true,
  });
}


// The child browsing contexts, exposed as `window.length` and `window[i]`.
//
// The query runs through the internal channel: `window.length` is read on
// nearly every page, and a challenge script that has hooked
// `document.querySelectorAll` sees each read as a selector the page ran.
function _childBrowsingContexts() {
  return _internalQuerySelectorAll(globalThis.document, 'iframe');
}

Object.defineProperty(globalThis, 'length', {
  get() { return _childBrowsingContexts().length; },
  configurable: true,
  enumerable: true
});

// A browser has exactly `length` of these and no more. There used to be a
// fixed 50, which put "0".."49" in Object.getOwnPropertyNames(window) on every
// page -- 50 names Chrome does not have there, contradicting a `length` of 0
// standing right next to them. globalThis cannot be a Proxy, so the set is
// resynchronised at the points where a subtree connects or disconnects.
function _syncWindowFrameIndices() {
  const count = _childBrowsingContexts().length;
  for (let i = 0; i < count; i++) {
    if (Object.getOwnPropertyDescriptor(globalThis, i)) continue;
    Object.defineProperty(globalThis, i, {
      get() { return _childBrowsingContexts()[i]?.contentWindow; },
      configurable: true,
      // Chrome's indexed window properties show up in for-in.
      enumerable: true
    });
  }
  for (let i = count; Object.getOwnPropertyDescriptor(globalThis, i); i++) {
    delete globalThis[i];
  }
}

// Navigator constructor so that typeof Navigator !== 'undefined' and
// navigatorPrototype checks don't throw a ReferenceError. The whole bootstrap
// runs inside an IIFE, so the declaration alone stays function-scoped and
// `window.Navigator` was undefined -- a one-line tell, since every browser
// exposes the interface object. Chrome publishes interface globals as
// enumerable:false, hence defineProperty rather than a plain assignment.
function Navigator() { throw new TypeError("Illegal constructor"); }
Object.defineProperty(globalThis, 'Navigator', {
  value: Navigator, writable: true, enumerable: false, configurable: true,
});
_markNative(Navigator);

// PluginArray must exist before navigator is built so the plugins getter can use it.
function PluginArray(items) {
  for (var _pi = 0; _pi < items.length; _pi++) this[_pi] = items[_pi];
  this.length = items.length;
}
PluginArray.prototype = Object.create(Array.prototype);
PluginArray.prototype.constructor = PluginArray;
PluginArray.prototype.item = function(i) { return this[i] || null; };
PluginArray.prototype.namedItem = function(name) {
  for (var _pi = 0; _pi < this.length; _pi++) {
    if (this[_pi].name === name) return this[_pi];
  }
  return null;
};
PluginArray.prototype.refresh = function() {};
PluginArray.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.defineProperty(PluginArray.prototype, Symbol.toStringTag, {value: 'PluginArray', configurable: true});
_markNative(PluginArray);
_markNative(PluginArray.prototype.item);
_markNative(PluginArray.prototype.namedItem);
_markNative(PluginArray.prototype.refresh);

