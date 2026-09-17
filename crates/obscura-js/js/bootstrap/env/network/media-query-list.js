// MediaQueryList is a live EventTarget returned by matchMedia. Query parsing
// remains in tools/encoding-media-query.js; this module owns the WebIDL shape
// and realm-local state.
const _mediaQueryListToken = {};
const _mediaQueryListState = new WeakMap();

function _mediaQueryListSlots(instance) {
  const state = _mediaQueryListState.get(instance);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}

function _mediaQueryListCreate(media) {
  return new MediaQueryList(_mediaQueryListToken, media);
}

globalThis.MediaQueryList = class MediaQueryList extends EventTarget {
  constructor(...args) {
    super();
    if (args[0] !== _mediaQueryListToken) {
      throw new TypeError("Failed to construct 'MediaQueryList': Illegal constructor");
    }
    _mediaQueryListState.set(this, {media: String(args[1] ?? ''), onchange: null});
  }
  get media() { return _mediaQueryListSlots(this).media; }
  get matches() { return _evaluateMediaQueryList(_mediaQueryListSlots(this).media); }
  get onchange() { return _mediaQueryListSlots(this).onchange; }
  set onchange(value) {
    _mediaQueryListSlots(this).onchange = typeof value === 'function' ? value : null;
  }
  addListener(callback) { return this.addEventListener('change', callback); }
  removeListener(callback) { return this.removeEventListener('change', callback); }
};
Object.defineProperty(globalThis.MediaQueryList.prototype, Symbol.toStringTag, {
  value: 'MediaQueryList', configurable: true,
});

globalThis.matchMedia = _markNative(function matchMedia(query) {
  return _mediaQueryListCreate(query == null ? '' : String(query));
});
