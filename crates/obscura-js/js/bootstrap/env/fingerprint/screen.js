// A probe that walks it saw 5 members where Chrome has 9, and `lock` -- which
// pages call and which Chrome rejects outside fullscreen -- was simply absent.
class ScreenOrientation {
  constructor(key) {
    _screenOrientationInitialize(this, key);
  }
  get type() { return 'landscape-primary'; }
  get angle() { return 0; }
  get onchange() { return _screenOrientationOnChange(this); }
  set onchange(value) { _screenOrientationSetOnChange(this, value); }
  // Chrome rejects with NotSupportedError unless the document is fullscreen,
  // which is the state a headless page is always in.
  lock() {
    return Promise.reject(new DOMException(
      'screen.orientation.lock() is not available on this device.', 'NotSupportedError'));
  }
  unlock() {}
  addEventListener(type, callback, options) { _eventTargetAdd(this, type, callback, options); }
  removeEventListener(type, callback, options) { _eventTargetRemove(this, type, callback, options); }
  dispatchEvent(event) { return _eventTargetDispatch(this, event); }
  when(type, options = undefined) {
    return _eventTargetWhen.call(this, type, options, arguments.length);
  }
  get [Symbol.toStringTag]() { return 'ScreenOrientation'; }
}
globalThis.ScreenOrientation = _markNative(ScreenOrientation);

// A symbol key, not `_w`: a probe reads own property *names* as well as
// running `for..in`, so a non-enumerable `_w` is still one
// `Object.getOwnPropertyNames(screen)` away from being visible. A browser's
// screen object has no own string-keyed properties at all.
// Chromium answers the display's real bit depth rather than a constant, and
// the answer follows the platform: 30 on macOS, 24 on Windows and Linux. A
// macOS identity that answered 24 contradicted its own platform on the first
// screen probe, whether or not an embedder supplied screen metrics.
var _screenDepthPlatform = null;
var _screenDepthValue = 24;
function _screenColorDepth() {
  const fingerprint = _fingerprint();
  const platform = String(fingerprint.uaPlatform || fingerprint.navigatorPlatform || '');
  if (platform !== _screenDepthPlatform) {
    _screenDepthPlatform = platform;
    _screenDepthValue = /^mac/i.test(platform) ? 30 : 24;
  }
  return _screenDepthValue;
}

class Screen {
  constructor(w, h, availW, availH, availTop, availLeft) {
    // Every observable value lives behind this one symbol. `colorDepth` and
    // friends used to be own data properties, which put them in
    // `Object.getOwnPropertyNames(screen)` -- a list that is empty in a
    // browser, where all of Screen is prototype accessors.
    _screenInitialize(this, w, h, availW, availH, availTop, availLeft);
  }
  get width() { return _screenSlot(this, 'w'); }
  get height() { return _screenSlot(this, 'h'); }
  get availWidth() { return _screenSlot(this, 'availW'); }
  get availHeight() { return _screenSlot(this, 'availH'); }
  get availTop() { return _screenSlot(this, 'availTop'); }
  get availLeft() { return _screenSlot(this, 'availLeft'); }
  get colorDepth() { return _screenColorDepth(); }
  get pixelDepth() { return _screenColorDepth(); }
  get orientation() { return _screenOrientationFor(this); }
  // Chrome reports false unless the window spans several displays, which a
  // headless engine never does.
  get isExtended() { return false; }
  get onchange() { return _screenSlot(this, 'onchange'); }
  set onchange(value) { _screenSetSlot(this, 'onchange', typeof value === 'function' ? value : null); }
  addEventListener(type, callback, options) { _eventTargetAdd(this, type, callback, options); }
  removeEventListener(type, callback, options) { _eventTargetRemove(this, type, callback, options); }
  dispatchEvent(event) { return _eventTargetDispatch(this, event); }
  when(type, options = undefined) {
    return _eventTargetWhen.call(this, type, options, arguments.length);
  }
  get [Symbol.toStringTag]() { return 'Screen'; }
}
['width','height','availWidth','availHeight','availTop','availLeft','colorDepth',
 'pixelDepth','orientation','isExtended','onchange'].forEach(function(k) {
  var d = Object.getOwnPropertyDescriptor(Screen.prototype, k);
  if (d && d.get) _markNative(d.get);
  if (d && d.set) _markNative(d.set);
});
['addEventListener','removeEventListener','dispatchEvent'].forEach(function(k) {
  _markNative(Screen.prototype[k]);
});
// Chrome's Screen reaches the event methods through the EventTarget chain
// rather than owning them: enumerating its prototype yields the getters above
// and `constructor`, nothing else. Owning them here put four extra names in an
// enumeration a page can read, so they move onto a base prototype, which leaves
// `screen.addEventListener` a function (as Chrome's is) without the extra owns.
if (typeof EventTarget === 'function' && EventTarget.prototype) {
  var _screenEventBase = Object.create(EventTarget.prototype);
  ['addEventListener', 'removeEventListener', 'dispatchEvent', 'when'].forEach(function(k) {
    var d = Object.getOwnPropertyDescriptor(Screen.prototype, k);
    if (d) {
      Object.defineProperty(_screenEventBase, k, d);
      delete Screen.prototype[k];
    }
  });
  Object.setPrototypeOf(Screen.prototype, _screenEventBase);
}
globalThis.Screen = Screen;
globalThis.__obscura_set_screen_override = function(w, h, emulated) {
  globalThis.__obscura_screen_emulated = !!emulated;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    globalThis.__obscura_screen_w = w;
    globalThis.__obscura_screen_h = h;
    _screenApplySize(w, h, !!emulated);
    return;
  }
  delete globalThis.__obscura_screen_w;
  delete globalThis.__obscura_screen_h;
  const fallback = _fingerprint().screen || {};
  _screenApplySize(
    Number(fallback.width) || 1920,
    Number(fallback.height) || 1080,
    !!emulated,
    Number(fallback.availWidth),
    Number(fallback.availHeight),
    Number(fallback.availTop),
    Number(fallback.availLeft),
  );
};
globalThis.__obscura_apply_fingerprint = function() {
  const fingerprint = _fingerprint();
  const fallback = fingerprint.screen || {};
  if (!(Number.isFinite(globalThis.__obscura_screen_w) && globalThis.__obscura_screen_w > 0)) {
    _screenApplySize(
      Number(fallback.width) || 1920,
      Number(fallback.height) || 1080,
      !!globalThis.__obscura_screen_emulated,
      Number(fallback.availWidth),
      Number(fallback.availHeight),
      Number(fallback.availTop),
      Number(fallback.availLeft),
    );
  }
  const scale = Number(fallback.deviceScaleFactor);
  if (Number.isFinite(scale) && scale > 0) globalThis.devicePixelRatio = scale;
};
globalThis.__fetchInterceptEnabled = false;
globalThis.__fetchInterceptCallback = null; // Set by CDP to handle paused requests

// charCode -> 6-bit value reverse table for base64 decode. -1 for any byte not
// in the standard alphabet, which mirrors String.indexOf's miss exactly, so the
// bitmath below stays byte-identical to the old indexOf path including on
// malformed input. Built once at module load.
