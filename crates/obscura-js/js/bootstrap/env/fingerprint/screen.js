// A probe that walks it saw 5 members where Chrome has 9, and `lock` -- which
// pages call and which Chrome rejects outside fullscreen -- was simply absent.
const _screenOrientationKey = Symbol('ScreenOrientation');
const _screenOrientationHandlers = new WeakMap();
class ScreenOrientation {
  constructor(key) {
    if (key !== _screenOrientationKey) throw new TypeError('Illegal constructor');
  }
  get type() { return 'landscape-primary'; }
  get angle() { return 0; }
  get onchange() { return _screenOrientationHandlers.get(this) || null; }
  set onchange(value) {
    _screenOrientationHandlers.set(this, typeof value === 'function' ? value : null);
  }
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
const _screenSlots = Symbol('Screen slots');
class Screen {
  constructor(w, h, availW, availH, availTop, availLeft) {
    // Every observable value lives behind this one symbol. `colorDepth` and
    // friends used to be own data properties, which put them in
    // `Object.getOwnPropertyNames(screen)` -- a list that is empty in a
    // browser, where all of Screen is prototype accessors.
    this[_screenSlots] = {
      w, h,
      availW: availW === undefined ? w : availW,
      availH: availH === undefined ? h - 40 : availH,
      availTop: availTop === undefined ? 0 : availTop,
      availLeft: availLeft === undefined ? 0 : availLeft,
      orientation: new ScreenOrientation(_screenOrientationKey),
      onchange: null,
    };
  }
  get width() { return this[_screenSlots].w; }
  get height() { return this[_screenSlots].h; }
  get availWidth() { return this[_screenSlots].availW; }
  get availHeight() { return this[_screenSlots].availH; }
  get availTop() { return this[_screenSlots].availTop; }
  get availLeft() { return this[_screenSlots].availLeft; }
  get colorDepth() { return 24; }
  get pixelDepth() { return 24; }
  get orientation() { return this[_screenSlots].orientation; }
  // Chrome reports false unless the window spans several displays, which a
  // headless engine never does.
  get isExtended() { return false; }
  get onchange() { return this[_screenSlots].onchange; }
  set onchange(value) { this[_screenSlots].onchange = typeof value === 'function' ? value : null; }
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
globalThis.Screen = Screen;
function _applyScreenSize(w, h, emulated, availW, availH, availTop, availLeft) {
  const resolvedAvailW = Number.isFinite(availW) ? availW : w;
  const resolvedAvailH = Number.isFinite(availH) ? availH : (emulated ? h : h - 40);
  if (globalThis.screen instanceof Screen) {
    const slots = globalThis.screen[_screenSlots];
    slots.w = w;
    slots.h = h;
    slots.availW = resolvedAvailW;
    slots.availH = resolvedAvailH;
    slots.availTop = Number.isFinite(availTop) ? availTop : 0;
    slots.availLeft = Number.isFinite(availLeft) ? availLeft : 0;
  } else {
    globalThis.screen = new Screen(w, h, resolvedAvailW, resolvedAvailH, availTop, availLeft);
  }
}
globalThis.__obscura_set_screen_override = function(w, h, emulated) {
  globalThis.__obscura_screen_emulated = !!emulated;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    globalThis.__obscura_screen_w = w;
    globalThis.__obscura_screen_h = h;
    _applyScreenSize(w, h, !!emulated);
    return;
  }
  delete globalThis.__obscura_screen_w;
  delete globalThis.__obscura_screen_h;
  const fallback = _fingerprint().screen || {};
  _applyScreenSize(
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
    _applyScreenSize(
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
