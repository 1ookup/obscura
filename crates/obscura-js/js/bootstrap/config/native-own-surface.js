// Final own-surface normalization: Chrome's interface methods own exactly
// [length, name] on the function -- a method on the interface literal -- while
// every function expression this engine assigned to a prototype carries a
// non-configurable prototype slot a real builtin does not have. `'prototype'
// in f` is a probe a page reads without any observable call; it hit the
// challenge's native-detection family in matched pairs (sObF6 r5/r6, cleared
// for attachShadow when its definition became a method literal).
//
// The slot cannot be deleted (non-configurable), so each dirty method is
// replaced by a computed-key method literal that forwards to the original:
// method shorthand owns no prototype, keeps the name through the computed
// key, and length is restored via its configurable descriptor. Constructors
// are exempt -- a real constructor owns its prototype. The forwarder is
// re-marked so Function.prototype.toString keeps answering native on both
// call paths. Runs last in the bundle so every earlier definition is final.

// Per-context installer: page-init invokes it once the realm's surface is
// hydrated and the DOM ops are bound (the snapshot template context runs the
// deferred half without ops, so normalizing there is both impossible and
// useless -- the restored surface is the one this fixes). Idempotent.
globalThis.__obscura_install_native_own_surface = function() {
  try {
    if (typeof Deno.core.ops.op_dom !== 'function') return;
  } catch (_opsError) { return; }
  const exempt = new Set(['constructor']);

  const methodize = function (name, fn) {
    const holder = { [name](...args) { return fn.apply(this, args); } };
    const method = holder[name];
    try {
      Object.defineProperty(method, 'length', {
        value: fn.length, writable: false, enumerable: false, configurable: true,
      });
    } catch (_error) {}
    return method;
  };

  const skip = function (holder, name) {
    // Only engine-installed surfaces: skip anything a page overwrote with a
    // plain function (the page's own install is Chrome-visible too), and
    // skip getters/setters and non-functions.
    return exempt.has(name) || typeof holder[name] !== 'function';
  };

  const debug = { classes: 0, dirty: 0, cleaned: 0, defineFail: 0, sample: [] };
  const surface = function (owner, ownerName) {
    debug.classes += 1;
    let names;
    try { names = Object.getOwnPropertyNames(owner); } catch (_error) { return; }
    for (const name of names) {
      if (skip(owner, name)) continue;
      let fn;
      try { fn = owner[name]; } catch (_error) { continue; }
      let own;
      try { own = Object.getOwnPropertyNames(fn).indexOf('prototype') >= 0; } catch (_error) { continue; }
      if (!own) continue;
      debug.dirty += 1;
      if (debug.sample.length < 5) debug.sample.push(ownerName + '.' + name);
      const method = methodize(fn.name || name, fn);
      try {
        Object.defineProperty(owner, name, {
          value: method,
          writable: true, enumerable: false, configurable: true,
        });
      } catch (_error) { debug.defineFail += 1; continue; }
      debug.cleaned += 1;
      _markNative(method);
    }
  };

  // The engine's class definitions (Element's core surface, the observers,
  // the codec families) are already method literals; the prototype
  // re-assignments in the bundle are the dirty set. Walk every interface
  // the page can reach.
  const classes = [
    'Element', 'HTMLElement', 'Node', 'Document', 'HTMLDocument',
    'ShadowRoot', 'Storage', 'Plugin', 'PluginArray', 'MimeTypeArray',
    'SVGElement', 'SVGAnimatedString', 'HTMLCanvasElement',
    'CanvasRenderingContext2D', 'OffscreenCanvas',
    'OffscreenCanvasRenderingContext2D', 'RTCPeerConnection',
    'TextEncoder', 'TextDecoder', 'XMLSerializer', 'Performance',
    'Notification', 'History', 'Location', 'Navigator', 'Screen', 'Worker',
    'MessagePort', 'MutationObserver', 'ResizeObserver',
    'IntersectionObserver', 'PerformanceObserver', 'CSSStyleDeclaration',
    'DOMTokenList', 'NodeList', 'HTMLFormElement', 'HTMLInputElement',
    'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLAnchorElement',
    'HTMLImageElement', 'Window', 'HTMLUnknownElement', 'HTMLDivElement',
    'HTMLSpanElement', 'HTMLIFrameElement', 'HTMLScriptElement',
    'HTMLStyleElement', 'HTMLTemplateElement', 'HTMLTableElement',
  ];
  for (const name of classes) {
    const ctor = globalThis[name];
    if (!ctor || !ctor.prototype) continue;
    try { surface(ctor.prototype, name); } catch (_error) {}
  }
  // The window-level functions the engine defines as expressions.
  const windowFns = [
    'queueMicrotask', 'reportError', 'matchMedia', 'alert', 'getSelection',
    'scrollTo', 'scrollBy',
  ];
  try { Object.defineProperty(globalThis, '__obscura_own_surface_debug', {
    value: debug, writable: true, enumerable: false, configurable: true }); } catch (_e) {}
  for (const name of windowFns) {
    if (typeof globalThis[name] !== 'function') continue;
    let own;
    try {
      own = Object.getOwnPropertyNames(globalThis[name]).indexOf('prototype') >= 0;
    } catch (_error) { continue; }
    if (!own) continue;
    const method = methodize(globalThis[name].name || name, globalThis[name]);
    try {
      Object.defineProperty(globalThis, name, {
        value: method,
        writable: true, enumerable: true, configurable: true,
      });
      _markNative(method);
    } catch (_error) {}
  }
};
// This module is last in the deferred half, so at its load every other
// surface definition in the wrapper is final: normalize immediately. The
// snapshot template context runs the half without ops and the guard skips
// it there; the main and frame realms run it at hydration with ops bound.
try { globalThis.__obscura_install_native_own_surface(); } catch (_earlyError) {}
