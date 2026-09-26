const _linkConstructionKey = Symbol('HTMLLinkElement construction');
// Destinations a `rel=preload` link fetches. Chrome acts on these and reports
// one Resource Timing entry per response under `link`; destinations it does
// not know (`as=bogus`, `as=`) fetch nothing.
const _PRELOAD_DESTINATIONS = { image: 1, fetch: 1, script: 1, style: 1 };
// Issue the preload's own request through the transport, off the page's
// `fetch`: a browser's preload is not a `fetch()` call, so a page that hooks
// window.fetch must not observe it. The response body is discarded -- a
// preload warms the connection and the cache, it hands nothing to script --
// and the request is filed under the link's own name.
function _preloadFetch(href, as, crossOrigin) {
  const op = Deno.core.ops.op_fetch_url;
  if (typeof op !== 'function') return;
  let pageOrigin = '';
  let documentUrl = '';
  try {
    pageOrigin = _environmentSettings().origin;
    documentUrl = _environmentSettings().url || globalThis.location?.href || '';
  } catch (_error) {}
  const fetchStart = performance.now();
  const mode = as === 'fetch' || crossOrigin ? 'cors' : 'no-cors';
  _markLinkPreload(href);
  Promise.resolve(op(
    href, 'GET', '{}', '', pageOrigin, mode, 'same-origin',
    JSON.stringify({
      url: documentUrl,
      policy: _environmentReferrerPolicy(),
      redirect: 'follow',
      root: _environmentDocumentRoot(),
      uaHeaders: [],
      from: __obscuraTraceCurrent(),
    }),
  )).then(
    raw => {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (_error) {}
      if (!parsed || parsed.blocked || parsed.corsBlocked || !parsed.status) {
        // Nothing crossed the network, so no entry may name this link and a
        // later element fetch for the same URL stays its own.
        _unmarkLinkPreload(href);
        return;
      }
      const body = parsed.bodyBase64 || parsed.body || '';
      const padding = typeof body === 'string'
        ? (body.slice(-2) === '==' ? 2 : (body.slice(-1) === '=' ? 1 : 0))
        : 0;
      const bodySize = typeof body === 'string'
        ? Math.max(0, Math.floor(body.length * 3 / 4) - padding)
        : (body.byteLength || 0);
      _recordFetchResourceTiming(
        { ...parsed, url: parsed.url || href }, 'link', fetchStart, pageOrigin, bodySize);
    },
    () => _unmarkLinkPreload(href),
  );
}
class HTMLLinkElement extends Element {
  constructor(...args) {
    if (args.length !== 2 || args[1] !== _linkConstructionKey) {
      throw new TypeError("Failed to construct 'HTMLLinkElement': Illegal constructor");
    }
    super(args[0]);
  }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) {
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
  get href() {
    const raw = this.getAttribute('href');
    if (raw === null) return '';
    const resolved = _urlResolveOp(raw, this.baseURI || _anchorBase());
    return resolved === null ? raw : resolved;
  }
  set href(value) {
    this.setAttribute('href', value);
    this._maybePreloadImage();
  }
  get crossOrigin() { return this.getAttribute('crossorigin'); }
  set crossOrigin(value) {
    if (value === null || value === undefined) this.removeAttribute('crossorigin');
    else this.setAttribute('crossorigin', String(value));
  }
  get rel() { return this.getAttribute('rel') || ''; }
  set rel(value) {
    this.setAttribute('rel', String(value));
    this._maybePreloadImage();
  }
  get relList() {
    return Object.getOwnPropertyDescriptor(Element.prototype, 'relList').get.call(this);
  }
  get media() { return this.getAttribute('media') || ''; }
  set media(value) { this.setAttribute('media', String(value)); }
  get as() { return this.getAttribute('as') || ''; }
  set as(value) {
    this.setAttribute('as', String(value));
    this._maybePreloadImage();
  }
  get type() { return this.getAttribute('type') || ''; }
  set type(value) { this.setAttribute('type', String(value)); }
  get hreflang() { return this.getAttribute('hreflang') || ''; }
  set hreflang(value) { this.setAttribute('hreflang', String(value)); }
  get referrerPolicy() { return this.getAttribute('referrerpolicy') || ''; }
  set referrerPolicy(value) { this.setAttribute('referrerpolicy', String(value)); }
  get fetchPriority() { return this.getAttribute('fetchpriority') || 'auto'; }
  set fetchPriority(value) { this.setAttribute('fetchpriority', String(value)); }
  get sizes() {
    return Object.getOwnPropertyDescriptor(Element.prototype, 'sizes').get.call(this);
  }
  get target() { return this.getAttribute('target') || ''; }
  set target(value) { this.setAttribute('target', String(value)); }
  get sheet() {
    return Object.getOwnPropertyDescriptor(Element.prototype, 'sheet').get.call(this);
  }
  get integrity() { return this.getAttribute('integrity') || ''; }
  set integrity(value) { this.setAttribute('integrity', String(value)); }
  get blocking() { return this.getAttribute('blocking') || ''; }
  set blocking(value) { this.setAttribute('blocking', String(value)); }
  get imageSrcset() { return this.getAttribute('imagesrcset') || ''; }
  set imageSrcset(value) { this.setAttribute('imagesrcset', String(value)); }
  get imageSizes() { return this.getAttribute('imagesizes') || ''; }
  set imageSizes(value) { this.setAttribute('imagesizes', String(value)); }
  get charset() { return this.getAttribute('charset') || ''; }
  set charset(value) { this.setAttribute('charset', String(value)); }
  get rev() { return this.getAttribute('rev') || ''; }
  set rev(value) { this.setAttribute('rev', String(value)); }
  // The engine-only members live at the end so the enumeration prefix up to
  // here is exactly Chrome's HTMLLinkElement.prototype member order.
  setAttribute(name, value) {
    super.setAttribute(name, value);
    const n = String(name).toLowerCase();
    if (n === 'href' || n === 'rel' || n === 'as') this._maybePreloadImage();
  }
  // Turnstile preloads `/ci/` with <link rel=preload as=image> and then
  // assigns the same URL to Image.src. HaHaVM's loadAsset fires an image
  // GET for both; without a preload fetch here the widget never issues
  // that request and fails 600010 after PAT 401.
  //
  // A preload link is not an image-only construct: Chrome fetches every
  // destination it knows and files the Resource Timing entry under the link's
  // own name, never under the destination's tag -- `as=image` reports `link`
  // even though the request runs with <img> semantics. The sweep sites
  // (page-init, node.js, element-object.js) keep calling this method, so the
  // name stays.
  _maybePreloadImage() {
    if (String(this.rel).toLowerCase() !== 'preload') return;
    const as = String(this.as).toLowerCase();
    if (!_PRELOAD_DESTINATIONS[as]) return;
    const href = this.href;
    if (!href || this._preloadedHref === href) return;
    _hset(this, "_preloadedHref", href);
    if (as === 'image') {
      // <img> fetch semantics, but the entry keeps the link's own name.
      _markLinkPreload(href);
      try {
        const image = new Image();
        image.src = href;
      } catch (e) { _unmarkLinkPreload(href); }
      return;
    }
    _preloadFetch(href, as, this.crossOrigin);
  }
  get [Symbol.toStringTag]() { return 'HTMLLinkElement'; }
}
// A preload link only arms its fetch through this class's setters, so script
// that builds one with `createElement` + property writes works. A parser-built
// link never calls them: `innerHTML`, `insertAdjacentHTML`, `<template>` +
// cloneNode and the initial document parse apply the attributes on the native
// node. Turnstile builds its `/ci/` preload that way, and the image GET a
// browser issues for it was dropped -- only the later `Image.src` assignment
// produced a request, a full round trip after the challenge expected it.
// Sweep the subtree wherever the DOM already does its JS-side post-parse
// bookkeeping.
function _armPreloadImageLinks(root) {
  if (!root || root.nodeType !== 1 || !root.isConnected) return;
  const links = [];
  if (root.localName === 'link' && typeof root._maybePreloadImage === 'function') {
    links.push(root);
  }
  const ids = _domParse("query_selector_all_scoped", root[_nidSym], "link[rel]") || [];
  for (const id of ids) {
    const link = _wrapEl(+id);
    if (link && typeof link._maybePreloadImage === 'function') links.push(link);
  }
  for (const link of links) {
    try { link._maybePreloadImage(); } catch (_error) {}
  }
}
globalThis._armPreloadImageLinks = _armPreloadImageLinks;
_markNative(HTMLLinkElement);
for (const name of Object.getOwnPropertyNames(HTMLLinkElement.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, name);
  if (descriptor?.get) _markNative(descriptor.get);
  if (descriptor?.set) _markNative(descriptor.set);
  if (descriptor?.value) _markNative(descriptor.value);
}
