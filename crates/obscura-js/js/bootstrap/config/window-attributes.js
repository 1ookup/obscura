// Window IDL attributes are accessors, not data properties.
//
// Chrome's window owns no data property for these names: each one is a
// getter, and the spec's [Replaceable] attributes carry a setter as well. A
// hand-rolled global that assigns `globalThis.navigator = ...` therefore
// answers a different shape to every reflection pass a fingerprinting bundle
// makes -- `Object.getOwnPropertyDescriptor(window, 'navigator')` returning a
// data property is a shape no Chromium build produces, and the getter's own
// name ("get navigator", not "navigator") is part of the same tell.
//
// Measured on the local Chrome oracle (149) over a page on this host. The
// flags are per name
// because Chrome's are not uniform: `document`, `location`, `top` and
// `window` are non-configurable, `offscreenBuffering` is the single
// non-enumerable entry, and everything else is an enumerable, configurable
// accessor.
//
// The listed names are the ones the page-facing dump disagrees on; adding a
// name here is a descriptor decision, so it belongs in this table rather than
// in the module that happens to define the value.
const _chromeWindowAttributeNames = [
  'caches', 'cookieStore', 'crashReport', 'credentialless', 'crypto',
  'customElements', 'devicePixelRatio', 'document', 'documentPictureInPicture',
  'external', 'fence', 'frames', 'history', 'indexedDB', 'innerHeight',
  'innerWidth', 'launchQueue', 'localStorage', 'location', 'locationbar',
  'menubar', 'navigation', 'navigator', 'offscreenBuffering', 'opener',
  'originAgentCluster', 'outerHeight', 'outerWidth', 'parent', 'performance',
  'personalbar', 'screen', 'screenLeft', 'screenTop', 'screenX', 'screenY',
  'scrollbars', 'self', 'sessionStorage', 'speechSynthesis', 'statusbar',
  'styleMedia', 'toolbar', 'top', 'trustedTypes', 'viewport',
  'visualViewport', 'window',
];
// [Replaceable]: a setter is part of the descriptor.
const _chromeReplaceableWindowAttributes = new Set([
  'devicePixelRatio', 'external', 'frames', 'innerHeight', 'innerWidth',
  'location', 'locationbar', 'menubar', 'navigation', 'offscreenBuffering',
  'opener', 'outerHeight', 'outerWidth', 'parent', 'performance', 'personalbar',
  'screen', 'screenLeft', 'screenTop', 'screenX', 'screenY', 'scrollbars',
  'self', 'statusbar', 'toolbar', 'viewport', 'visualViewport',
]);
const _chromeNonConfigurableWindowAttributes = new Set([
  'document', 'location', 'top', 'window',
]);
const _chromeNonEnumerableWindowAttributes = new Set(['offscreenBuffering']);

// The slot a minted getter reads. The value is captured when the attribute is
// converted, and the minted setter writes it back, so the descriptor stays an
// accessor after a page assigns one. A real [Replaceable] setter replaces the
// property with a data property instead (same measurement); the value a
// page reads afterwards is the same either way, and keeping the accessor keeps
// the engine's own rebinds from splitting one attribute across two shapes.
const _windowAttributeSlots = new WeakMap();

function _windowAttributeSlot(target, name) {
  let slots = _windowAttributeSlots.get(target);
  if (!slots) {
    slots = new Map();
    _windowAttributeSlots.set(target, slots);
  }
  let slot = slots.get(name);
  if (!slot) {
    slot = { value: undefined };
    slots.set(name, slot);
  }
  return slot;
}

// A native-marked accessor half. `_markNative` renders
// "function <name>() { [native code] }", so the name carries the kind: Chrome
// answers "get navigator" here, never "navigator".
function _markWindowAttributeHalf(fn, kind, name) {
  try {
    Object.defineProperty(fn, 'name', { value: kind + ' ' + name, configurable: true });
  } catch (_error) {}
  return _markNative(fn);
}

function _obscuraInstallWindowAttributeAccessors(target) {
  if (!target) return;
  _obscuraRestoreChromeEntryPointNames(target);
  _obscuraLockChromeObject(target);
  for (const name of _chromeWindowAttributeNames) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(target, name);
    } catch (_error) {
      continue;
    }
    if (!descriptor) continue;
    const existingGetter = typeof descriptor.get === 'function' ? descriptor.get : null;
    const existingSetter = typeof descriptor.set === 'function' ? descriptor.set : null;
    const replaceable = _chromeReplaceableWindowAttributes.has(name);
    // Locked descriptors can still get their halves marked, but not their
    // shape changed. `location` is installed this way at boot.
    if (!descriptor.configurable) {
      if (existingGetter) _markWindowAttributeHalf(existingGetter, 'get', name);
      if (existingSetter) _markWindowAttributeHalf(existingSetter, 'set', name);
      continue;
    }
    const slot = _windowAttributeSlot(target, name);
    let getter = existingGetter;
    if (!getter) {
      slot.value = descriptor.value;
      getter = function () { return slot.value; };
    }
    _markWindowAttributeHalf(getter, 'get', name);
    const aligned = {
      get: getter,
      enumerable: !_chromeNonEnumerableWindowAttributes.has(name),
      configurable: !_chromeNonConfigurableWindowAttributes.has(name),
    };
    if (replaceable) {
      // A realm that installs a live getter (a frame's viewport metrics) keeps
      // it: only the setter is minted here.
      const setter = existingSetter || function (value) { slot.value = value; };
      _markWindowAttributeHalf(setter, 'set', name);
      aligned.set = setter;
    }
    try {
      Object.defineProperty(target, name, aligned);
    } catch (_error) {}
  }
}

// Chrome keeps `chrome.loadTimes` and `chrome.csi` anonymous (name "",
// toString "function () { [native code] }"), while every other entry point in
// the surface carries its slot's name. The surface-marking sweep renames them
// through the `constructor` key of their own prototype, so the shape is
// restored here, after that sweep has run.
// Chrome's `chrome` object is non-configurable, and the lock belongs here
// rather than in the finalize module: a worker realm runs that module too and
// then deletes `chrome` (its scope has none), which a locked property would
// refuse. The window key-order walk ahead of this pass moves properties by
// deleting and redefining them, so the flag is only set once that has run.
function _obscuraLockChromeObject(target) {
  let descriptor = null;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, 'chrome');
  } catch (_error) {
    return;
  }
  if (!descriptor || !descriptor.configurable) return;
  try {
    Object.defineProperty(target, 'chrome', {
      value: descriptor.value,
      writable: descriptor.writable !== false,
      enumerable: descriptor.enumerable === true,
      configurable: false,
    });
  } catch (_error) {}
}

function _obscuraRestoreChromeEntryPointNames(target) {
  let chrome = null;
  try {
    chrome = target.chrome;
  } catch (_error) {
    return;
  }
  if (!chrome || typeof chrome !== 'object') return;
  for (const name of ['loadTimes', 'csi']) {
    const fn = chrome[name];
    if (typeof fn !== 'function' || fn.name === '') continue;
    try {
      Object.defineProperty(fn, 'name', { value: '', configurable: true });
    } catch (_error) {}
    try {
      _markNativeAs(fn, 'function () { [native code] }');
    } catch (_error) {}
  }
}

// The engine's own write path for a converted attribute. Page init rebinds
// `document`, `navigator` and `visualViewport` after the conversion, and the
// non-[Replaceable] ones have no setter to catch that.
function __obscura_set_window_attribute(target, name, value) {
  const slots = _windowAttributeSlots.get(target);
  const slot = slots && slots.get(name);
  if (slot) {
    slot.value = value;
    return true;
  }
  try {
    Object.defineProperty(target, name, {
      value, writable: true, enumerable: true, configurable: true,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

Object.defineProperty(globalThis, '__obscura_install_window_attributes', {
  value: _obscuraInstallWindowAttributeAccessors,
  writable: false,
  enumerable: false,
  configurable: false,
});
Object.defineProperty(globalThis, '__obscura_set_window_attribute', {
  value: __obscura_set_window_attribute,
  writable: false,
  enumerable: false,
  configurable: false,
});
