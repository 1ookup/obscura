// Window surface installation.
//
// The capability modules define the implementations. This final surface pass
// is the equivalent of HaHaVM's globalThis.js mount block: it owns the order
// and descriptor policy of Window's own properties without moving runtime
// dependent objects such as document/location into bootstrap-time code.
function _obscuraWindowSurfaceEnumerable(name) {
  if (_chromeEnumerableWindowObjects.includes(name)) return true;
  if (_chromeEnumerableWindowFunctions.includes(name)) return true;
  if (_chromeNonEnumerableWindowObjects.includes(name)) return false;
  if (/^[A-Z]/.test(name) && !_ecmaScriptGlobals.has(name)) return false;
  return undefined;
}

function _obscuraInstallWindowSurface(target = globalThis, keyOrder = _chromeWindowKeyOrder) {
  if (!target) return;
  // The finalizer owns the canonical descriptor lists. Calling it here keeps
  // the standalone installer useful for frame WindowProxy targets too.
  try {
    if (target === globalThis && typeof _normalizeWindowObjectEnumerability === 'function') {
      _normalizeWindowObjectEnumerability(target);
    }
  } catch (_error) {}

  const seen = new Set();
  for (const name of keyOrder || []) {
    if (seen.has(name)) continue;
    seen.add(name);
    // V8's ECMAScript globals are installed by the realm itself. The main
    // realm must keep them in place: deleting Object while this installer is
    // calling Object.defineProperty would remove the global before it can be
    // restored. Frame realms use their own globals and can still be aligned.
    if (target === globalThis && _ecmaScriptGlobals.has(name)) continue;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(target, name); } catch (_error) { continue; }
    if (!descriptor || !descriptor.configurable) continue;

    const enumerable = _obscuraWindowSurfaceEnumerable(name);
    if (enumerable !== undefined) descriptor.enumerable = enumerable;
    try {
      // Deleting and defining a configurable property is the Web-compatible
      // way to move it to the explicit Window insertion order.
      delete target[name];
      Object.defineProperty(target, name, descriptor);
    } catch (_error) {}
  }
}

function _obscuraInstallPlatformSurfaces(target = globalThis) {
  _obscuraInstallWindowSurface(target, _chromeWindowKeyOrder);
  if (target !== globalThis) return;
  _flattenNavigatorPrototypeSurface();
  if (globalThis.navigator) {
    _alignPropertiesOrder(Object.getPrototypeOf(globalThis.navigator), _chromeNavigatorKeyOrder);
  }
  if (globalThis.Navigator?.prototype) {
    _alignPropertiesOrder(globalThis.Navigator.prototype, _chromeNavigatorKeyOrder);
  }
  if (globalThis.Document?.prototype) {
    _alignPropertiesOrder(globalThis.Document.prototype, _chromeDocumentKeyOrder);
  }
  if (globalThis.Screen?.prototype) {
    _alignPropertiesOrder(globalThis.Screen.prototype, _chromeScreenKeyOrder);
  }
  if (globalThis.ScreenOrientation?.prototype) {
    _alignPropertiesOrder(
      globalThis.ScreenOrientation.prototype,
      _chromeScreenOrientationKeyOrder,
    );
  }
  if (globalThis.Node?.prototype) {
    _alignPropertiesOrder(globalThis.Node.prototype, _chromeNodeKeyOrder);
  }
}

Object.defineProperty(globalThis, '__obscura_install_window_surface', {
  value: _obscuraInstallWindowSurface,
  writable: false,
  enumerable: false,
  configurable: false,
});
Object.defineProperty(globalThis, '__obscura_install_platform_surfaces', {
  value: _obscuraInstallPlatformSurfaces,
  writable: false,
  enumerable: false,
  configurable: false,
});
