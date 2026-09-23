// Iframes have a distinct WebIDL interface. A plain Element alias makes
// `instanceof HTMLIFrameElement`, the prototype chain, and iframe-only
// navigation/policy properties observably wrong.
const _iframeConstructionKey = Symbol('HTMLIFrameElement construction');
const _iframeFeaturePolicies = new WeakMap();
class HTMLIFrameElement extends Element {
  get src() {
    const raw = this.getAttribute('src');
    if (!raw) return '';
    try { return new URL(raw, this.baseURI || globalThis.location?.href || 'about:blank').href; }
    catch (_error) { return raw; }
  }
  set src(value) { this.setAttribute('src', value); }
  get srcdoc() { return this.getAttribute('srcdoc') || ''; }
  set srcdoc(value) {
    this.setAttribute('srcdoc', globalThis.__obscura_tt_enforce(
      'TrustedHTML', value, 'HTMLIFrameElement srcdoc'));
  }
  get name() { return this.getAttribute('name') || ''; }
  set name(value) { this.setAttribute('name', value); }
  get sandbox() {
    if (!this._sandboxList) {
      _hset(this, "_sandboxList", new DOMTokenList(this, 'sandbox', [
        'allow-downloads', 'allow-forms', 'allow-modals', 'allow-orientation-lock',
        'allow-pointer-lock', 'allow-popups', 'allow-popups-to-escape-sandbox',
        'allow-presentation', 'allow-same-origin', 'allow-scripts',
        'allow-top-navigation', 'allow-top-navigation-by-user-activation',
        'allow-top-navigation-to-custom-protocols',
      ]));
    }
    return this._sandboxList;
  }
  set sandbox(value) { this.setAttribute('sandbox', value); }
  get allowFullscreen() { return this.hasAttribute('allowfullscreen'); }
  set allowFullscreen(value) {
    if (value) this.setAttribute('allowfullscreen', '');
    else this.removeAttribute('allowfullscreen');
  }
  get width() { return this.getAttribute('width') || ''; }
  set width(value) { this.setAttribute('width', value); }
  get height() { return this.getAttribute('height') || ''; }
  set height(value) { this.setAttribute('height', value); }
  get contentDocument() {
    const st = _frameContentState(this[_nidSym]);
    if (st.root >= 0) {
      if (!st.same) return null;
      _materializeFrameRealm(this[_nidSym], st);
      const realmGlobal = _frameRealmGlobalFor(st.root);
      if (realmGlobal && realmGlobal.document) {
        realmGlobal.document[_defaultViewProxySym] = _frameWindowProxyFor(this);
        return realmGlobal.document;
      }
      const doc = _scopedDocumentFor(st.root);
      doc[_defaultViewProxySym] = _frameWindowProxyFor(this);
      return doc;
    }
    return null;
  }
  get contentWindow() {
    if (_frameContentState(this[_nidSym]).root >= 0) {
      return _frameWindowProxyFor(this);
    }
    return null;
  }
  get referrerPolicy() { return this.getAttribute('referrerpolicy') || ''; }
  set referrerPolicy(value) { this.setAttribute('referrerpolicy', value); }
  get csp() { return this.getAttribute('csp') || ''; }
  set csp(value) { this.setAttribute('csp', String(value)); }
  get allow() { return this.getAttribute('allow') || ''; }
  set allow(value) { this.setAttribute('allow', value); }
  get featurePolicy() {
    let policy = _iframeFeaturePolicies.get(this);
    if (!policy) {
      policy = new PermissionsPolicy(_permissionsPolicyKey, this.ownerDocument || globalThis.document);
      _iframeFeaturePolicies.set(this, policy);
    }
    return policy;
  }
  get loading() { return this.getAttribute('loading') || 'auto'; }
  set loading(value) { this.setAttribute('loading', value); }
  get align() { return this.getAttribute('align') || ''; }
  set align(value) { this.setAttribute('align', value); }
  get scrolling() { return this.getAttribute('scrolling') || ''; }
  set scrolling(value) { this.setAttribute('scrolling', value); }
  get frameBorder() { return this.getAttribute('frameborder') || ''; }
  set frameBorder(value) { this.setAttribute('frameborder', value); }
  get longDesc() { return this.getAttribute('longdesc') || ''; }
  set longDesc(value) { this.setAttribute('longdesc', value); }
  get marginHeight() { return this.getAttribute('marginheight') || ''; }
  set marginHeight(value) { this.setAttribute('marginheight', value); }
  get marginWidth() { return this.getAttribute('marginwidth') || ''; }
  set marginWidth(value) { this.setAttribute('marginwidth', value); }
  getSVGDocument() { return null; }
  get credentialless() { return this.hasAttribute('credentialless'); }
  set credentialless(value) {
    if (value) this.setAttribute('credentialless', '');
    else this.removeAttribute('credentialless');
  }
  get allowPaymentRequest() { return this.hasAttribute('allowpaymentrequest'); }
  set allowPaymentRequest(value) {
    if (value) this.setAttribute('allowpaymentrequest', '');
    else this.removeAttribute('allowpaymentrequest');
  }
  constructor(...args) {
    if (args.length !== 2 || args[1] !== _iframeConstructionKey) {
      throw new TypeError('Illegal constructor');
    }
    super(args[0]);
  }
  get [Symbol.toStringTag]() { return 'HTMLIFrameElement'; }
}
const _iframeConstructorDescriptor = Object.getOwnPropertyDescriptor(
  HTMLIFrameElement.prototype, 'constructor');
delete HTMLIFrameElement.prototype.constructor;
Object.defineProperty(HTMLIFrameElement.prototype, 'constructor', _iframeConstructorDescriptor);
Object.defineProperty(globalThis, 'HTMLIFrameElement', {
  value: HTMLIFrameElement, writable: true, enumerable: false, configurable: true,
});
_markNative(HTMLIFrameElement);
for (const name of Object.getOwnPropertyNames(HTMLIFrameElement.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, name);
  if (descriptor?.get) _markNative(descriptor.get);
  if (descriptor?.set) _markNative(descriptor.set);
  if (descriptor?.value) _markNative(descriptor.value);
}
// These members belong to iframe (or object) interfaces, not Element itself.
// Leaving them on Element.prototype leaks a non-Chrome prototype shape even
// when the iframe wrapper has the right dedicated class.
for (const name of ['sandbox', 'srcdoc', 'csp', 'contentDocument', 'contentWindow']) {
  delete Element.prototype[name];
}

globalThis.HTMLMediaElement = HTMLMediaElement;
globalThis.HTMLVideoElement = HTMLVideoElement;
globalThis.HTMLAudioElement = HTMLAudioElement;
globalThis.HTMLObjectElement = HTMLObjectElement;
globalThis.HTMLTrackElement = HTMLTrackElement;
globalThis.TextTrack = TextTrack;
globalThis.TextTrackList = TextTrackList;
globalThis.TextTrackCue = TextTrackCue;
globalThis.TextTrackCueList = TextTrackCueList;
globalThis.VTTCue = VTTCue;

// Lowercase HTML local name -> the interface wrapper the node is created
// from. Chrome gives every element interface its own prototype, so a <div> is
// an HTMLDivElement rather than a bare Element; most of the HTML family here
// used to be an alias of Element, which made
// `document.createElement('div').constructor.name` read "Element".
// config/webidl-branding.js -- the last module -- fills this map once every
// real interface exists. Until then it is empty and the literal fallbacks
// below answer, which is all bootstrap-time wrapper creation needs.
const _elementInterfaceByTag = Object.create(null);
// Resolver for a local name no interface claims, installed together with the
// map by config/webidl-branding.js. Null before that.
let _elementInterfaceUnknownTag = null;

// The interfaces config/webidl-branding.js builds take the node id plus this
// key, so `new HTMLDivElement(1)` from page code still throws the illegal
// constructor TypeError. None of the classes reachable here can be built
// without it.
const _elementInterfaceKey = Symbol('element interface construction');

// SVG local names Chrome answers with a dedicated text/graphics interface
// (local headless-Chrome oracle). Values are global constructor names,
// resolved at call time because env/html/svg-elements.js defines the classes
// later in the manifest. path/svg and the basic shapes keep their explicit
// branches in the ladders below (the shapes share SVGGeometryElement).
const _svgInterfaceByLocalName = {
  text: 'SVGTextElement',
  tspan: 'SVGTSpanElement',
  textPath: 'SVGTextPathElement',
  g: 'SVGGElement',
  a: 'SVGAElement',
  use: 'SVGUseElement',
  image: 'SVGImageElement',
  defs: 'SVGDefsElement',
  symbol: 'SVGSymbolElement',
  switch: 'SVGSwitchElement',
  foreignObject: 'SVGForeignObjectElement',
};
function _svgInterfaceFor(localName) {
  const name = _svgInterfaceByLocalName[localName];
  return (name && globalThis[name]) || null;
}

// One place where a wrapper class is constructed, so every interface that
// needs an internal argument beyond the node id is listed once.
function _wrapElementNode(C, nid) {
  if (C === HTMLIFrameElement) return new C(nid, _iframeConstructionKey);
  if (C === HTMLLinkElement) return new C(nid, _linkConstructionKey);
  if (C === HTMLInputElement) return new C(nid, _inputConstructionKey);
  // HTMLBodyElement predates the interface key and takes the node id alone.
  if (C === globalThis.HTMLBodyElement) return new C(nid);
  return new C(nid, _elementInterfaceKey);
}

function _elementClassFor(nid) {
  const tag = _domParse("tag_name", nid);
  // HTML tagName values are ASCII-uppercase. Foreign SVG names retain their
  // case, so keep the common HTML path fast and only inspect the native
  // namespace for possible SVG wrappers.
  if (tag && tag !== tag.toUpperCase()
      && _domParse("namespace_uri", nid) === "http://www.w3.org/2000/svg") {
    if (tag === "path" && globalThis.SVGPathElement) return globalThis.SVGPathElement;
    if (tag === "svg" && globalThis.SVGSVGElement) return globalThis.SVGSVGElement;
    // Basic shapes answer getTotalLength/getPointAtLength in Chrome; the
    // geometry prototype (an SVGElement subclass) keeps every Element-level
    // API while adding the geometry one.
    if (globalThis.SVGGeometryElement && (
      tag === "circle" || tag === "ellipse" || tag === "line"
      || tag === "polygon" || tag === "polyline" || tag === "rect"
    )) return globalThis.SVGGeometryElement;
    const svgIface = _svgInterfaceFor(tag);
    if (svgIface) return svgIface;
    if (globalThis.SVGElement) return globalThis.SVGElement;
    return Element;
  }
  const iface = tag ? _elementInterfaceByTag[tag.toLowerCase()] : null;
  if (iface) return iface;
  if (_elementInterfaceUnknownTag) {
    // An unlisted name only has an interface answer in the HTML namespace.
    // MathML and any other foreign content keep the plain Element wrapper,
    // and so does a name that is not ASCII-uppercase, which HTML tag names
    // always are.
    if (tag && tag === tag.toUpperCase()
        && _domParse("namespace_uri", nid) === "http://www.w3.org/1999/xhtml") {
      return _elementInterfaceUnknownTag(tag.toLowerCase());
    }
    return Element;
  }
  if (tag === "FORM" && globalThis.HTMLFormElement) return globalThis.HTMLFormElement;
  if (tag === "INPUT" && globalThis.HTMLInputElement) return globalThis.HTMLInputElement;
  if (tag === "BODY" && globalThis.HTMLBodyElement) return globalThis.HTMLBodyElement;
  if (tag === "IFRAME" && globalThis.HTMLIFrameElement) return globalThis.HTMLIFrameElement;
  if (tag === "IMG") return HTMLImageElement;
  if (tag === "LINK" && globalThis.HTMLLinkElement) return HTMLLinkElement;
  if (tag === "CANVAS" && globalThis.HTMLCanvasElement) return globalThis.HTMLCanvasElement;
  if (tag === "AUDIO") return HTMLAudioElement;
  if (tag === "VIDEO") return HTMLVideoElement;
  if (tag === "OBJECT") return HTMLObjectElement;
  if (tag === "TRACK") return HTMLTrackElement;
  return Element;
}
function _elementClassForKnownName(namespace, qualifiedName) {
  const localName = qualifiedName.includes(":")
    ? qualifiedName.slice(qualifiedName.indexOf(":") + 1)
    : qualifiedName;
  if (namespace === "http://www.w3.org/2000/svg") {
    if (localName === "path" && globalThis.SVGPathElement) return globalThis.SVGPathElement;
    if (localName === "svg" && globalThis.SVGSVGElement) return globalThis.SVGSVGElement;
    // Basic shapes answer getTotalLength/getPointAtLength in Chrome; giving
    // them the geometry prototype (a subclass of SVGElement) keeps every
    // Element-level API while adding the geometry one.
    if (globalThis.SVGGeometryElement && (
      localName === "circle" || localName === "ellipse" || localName === "line"
      || localName === "polygon" || localName === "polyline" || localName === "rect"
    )) return globalThis.SVGGeometryElement;
    const svgIface = _svgInterfaceFor(localName);
    if (svgIface) return svgIface;
    if (globalThis.SVGElement) return globalThis.SVGElement;
    return Element;
  }
  if (namespace === "http://www.w3.org/1999/xhtml") {
    const tag = localName.toLowerCase();
    const iface = _elementInterfaceByTag[tag];
    if (iface) return iface;
    if (_elementInterfaceUnknownTag) return _elementInterfaceUnknownTag(tag);
    const upper = localName.toUpperCase();
    if (upper === "FORM" && globalThis.HTMLFormElement) return globalThis.HTMLFormElement;
    if (upper === "INPUT" && globalThis.HTMLInputElement) return globalThis.HTMLInputElement;
    if (upper === "BODY" && globalThis.HTMLBodyElement) return globalThis.HTMLBodyElement;
    if (upper === "IFRAME" && globalThis.HTMLIFrameElement) return globalThis.HTMLIFrameElement;
    if (upper === "IMG") return HTMLImageElement;
    if (upper === "LINK" && globalThis.HTMLLinkElement) return globalThis.HTMLLinkElement;
    if (upper === "CANVAS" && globalThis.HTMLCanvasElement) return globalThis.HTMLCanvasElement;
    if (upper === "AUDIO") return HTMLAudioElement;
    if (upper === "VIDEO") return HTMLVideoElement;
    if (upper === "OBJECT") return HTMLObjectElement;
    if (upper === "TRACK") return HTMLTrackElement;
  }
  return Element;
}
function _wrap(nid) {
  if (nid < 0 || nid === null || nid === undefined || isNaN(nid)) return null;
  if (_cache.has(nid)) return _cache.get(nid);
  const t = +_dom("node_type", nid);
  let n;
  if (t === 1) {
    const C = _elementClassFor(nid);
    n = _wrapElementNode(C, nid);
  }
  else if (t === 3) n = new Text(nid);
  else if (t === 8) n = new Comment(nid);
  else if (t === 9) {
    // The only non-main document nodes in the arena are iframe content-
    // document roots; hand back the scoped wrapper so queries stay in-frame.
    const main = globalThis.document;
    n = (main && nid !== main[_nidSym]) ? _scopedDocumentFor(nid) : new Document(nid);
  }
  else n = new Node(nid);
  _cache.set(nid, n);
  return n;
}
function _wrapEl(nid) {
  if (nid < 0 || nid === null || nid === undefined || isNaN(nid)) return null;
  if (_cache.has(nid)) return _cache.get(nid);
  const C = _elementClassFor(nid);
  const n = _wrapElementNode(C, nid);
  _cache.set(nid, n);
  return n;
}

globalThis._wrap = _wrap;

