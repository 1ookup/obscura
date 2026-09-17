"use strict";

// Everything the JavaScript engine put on the global before this file runs.
// Their prototypes follow ECMAScript rules (members non-enumerable) and must
// not be touched by the WebIDL enumerability pass at the bottom of this file;
// everything added below is a Web platform interface, which follows the
// opposite rule. Snapshotting is the only way to tell the two apart that does
// not need a hand-maintained list of 300 names to drift out of date.
const _ecmaScriptGlobals = new Set(Object.getOwnPropertyNames(globalThis));

// Static Window APIs use one mount primitive. Capability modules still own the
// implementation, while this keeps the WebIDL descriptor policy explicit and
// matches HaHaVM's defineProperty(window, name, descriptor) convention.
const _windowSurfaceSlots = new Map();
function _registerWindowSurface(name, kind = 'value', options = {}) {
  if (_windowSurfaceSlots.has(name)) return;
  if (Object.prototype.hasOwnProperty.call(globalThis, name)) {
    _windowSurfaceSlots.set(name, false);
    return;
  }
  Object.defineProperty(globalThis, name, {
    value: kind === 'method' ? function () {} : undefined,
    writable: true,
    enumerable: options.enumerable !== false,
    configurable: true,
  });
  _windowSurfaceSlots.set(name, true);
}
function _replaceWindowSurface(name, value, options = {}) {
  const current = Object.getOwnPropertyDescriptor(globalThis, name);
  const descriptor = current && !current.get && !current.set
    ? { ...current, value }
    : {
        value,
        writable: options.writable !== false,
        enumerable: options.enumerable !== false,
        configurable: options.configurable !== false,
      };
  Object.defineProperty(globalThis, name, descriptor);
  return value;
}
function _defineWindowValue(name, value, options = {}) {
  return _replaceWindowSurface(name, value, options);
}

// Register the stable Window surface before capability modules run. Later
// assignments replace these writable slots without changing insertion order.
for (const name of [
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'scrollTo', 'scrollBy', 'scroll', 'focus', 'blur',
  'print', 'alert', 'confirm', 'prompt', 'open', 'close', 'stop',
  'postMessage', 'fetch', 'getComputedStyle', 'getSelection', 'matchMedia',
  'reportError',
]) _registerWindowSurface(name, 'method');
for (const name of [
  'window', 'self', 'top', 'parent', 'frames', 'document', 'location',
  'navigator', 'customElements', 'history', 'navigation', 'screen',
  'visualViewport', 'console', 'crypto', 'indexedDB', 'localStorage',
  'sessionStorage', 'caches', 'cookieStore', 'speechSynthesis',
]) _registerWindowSurface(name, 'value');

// Pre-declare all internal globals as non-enumerable so they are invisible
// to Object.keys(window) / for-in enumeration. Must run before any var
// declarations or property assignments below: once a property is defined
// with enumerable:false here, subsequent `var x = value` assignments will
// find the property already exists and only update the value, leaving the
// descriptor intact. Direct globalThis.x = value assignments also only
// update the value without touching enumerable when the property is
// writable:true and configurable:true.
(function _preHideInternals() {
  var _names = [
    // Created by deno_core before this script runs, so it is already present
    // with a value: the loop below preserves it rather than clearing it.
    // Chrome has no such global at all -- hiding it from enumeration is the
    // cheap half of the fix; `'Deno' in window` still answers true. Removing
    // it outright means routing all 119 JS uses plus the Rust-injected
    // snippets (page.rs, realm.rs) through a non-global reference first.
    'Deno',
    // runtime-set by Rust (runtime.rs / page.rs) -- these were missing, and
    // Object.keys(window) listed them verbatim:
    //   __obscura_webgl_enabled, __obscura_referrer_policy,
    //   __obscura_performance_time_origin_ms, __obscura_viewport_w/h,
    //   __obscura_screen_emulated
    '__obscura_webgl_enabled', '__obscura_referrer_policy',
    '__obscura_performance_time_origin_ms',
    '__obscura_viewport_w', '__obscura_viewport_h', '__obscura_screen_emulated',
    // runtime-set by Rust (runtime.rs / page.rs)
    '__obscura_init', '__obscura_hide_list', '__obscura_filter_prepare_stack_trace',
    '__obscura_csp_allows_unsafe_eval',
    // Execution-source trace bridge (tools/trace-source.js + Rust
    // trace_source.rs). The prehide loop preserves values, so the
    // Rust-set flag/default survive this pass with enumerability fixed.
    '__obscura_trace_from_enabled', '__obscura_trace_default_from',
    '__obscura_trace_from',
    '__obscuraTraceCurrent', '__obscuraTraceEnter', '__obscuraTraceLeave',
    '__obscuraTraceBind', '__obscuraTraceCallWith', '__obscuraTraceDefineHandler',
    '__obscuraTraceRecordHandler', '__obscuraTraceHandlerFrom',
    '__obscuraTraceRawFunction',
    // Rust-set when --tracelog-file configured a window.external.tracelog
    // destination (tracelog.rs). Read by env/window/location.js, which installs
    // the method only then, and preserved here like the flags above.
    '__obscura_tracelog_enabled',
    '__obscura_objects', '__obscura_oid', '__obscura_fingerprint',
    '__obscura_set_fingerprint', '__obscura_apply_fingerprint',
    '__obscura_frame_realm_globals', '__obscura_realm_bridge',
    '__obscura_stealth', '__obscura_markTrusted', '__obscura_pointer_id',
    '__obscura_registerLinkedStylesheet', '__obscura_install_window_surface',
    '__obscura_install_platform_surfaces',
    '__markParserScripts', '__obscura_hasPendingDynamicScripts',
    '__obscura_hasPendingLoadDelayingScripts',
    '__obscura_nextPendingTimeoutDelay',
    '__documentReadyState__', '__currentUrl',
    '__obscura_document_all', '__obscura_document_all_resolve',
    '_installDocumentAll', '_documentAllElements', '_documentAllNamed',
    '_HTML_ALL_OWN_KEYS',
    // Assigned only once a dynamically inserted script runs, which is why it
    // was missed here and showed up in a challenge page's window enumeration.
    '__currentScriptNid',
    // internal helpers (var-declared throughout the file)
    '__processDynScriptQueue', '_decodeDataScriptUrl', '_markNative', '_fpRand', '_fpNoise',
    '_fpCache', '_fingerprint', '_getFp', '_fp', '_splitAsciiWhitespace',
    '_getElementsByClassName', '_docEncoding', '_docIsUtf8',
    '_isSpecialScheme', '_applyDocQueryEncoding', '_anchorBase',
    '_elemHrefURL', '_setElemHrefPart', '_pad', '_daysInMonth',
    '_isoWeek1Monday', '_inputParseNumber', '_inputFormatNumber',
    '_htmlAttrName', '_convertNodes', '_fragmentContextPayload', '_parseHTMLFragment', '_xmlWellFormed', '_elementClassFor', '_wrap', '_wrapEl',
    '_resolveUrl', '_registerIframe', '_base64ToUint8Array',
    '_bodyToUint8Array', '_arrayBufferFromBytes',
    '_installWasmStreamingFallback', '_urlParseOp', '_urlSetOp',
    '_urlResolveOp', '_decodeBodyWithCharset', '_utf8DecodeBytes',
    '_selectionFor', '_isConstructorCE', '_isValidCustomElementName', '_shadowRootForHost',
    '_blobPartToBytes', '_bytesToBinaryString', '_formEncode', '_hexv',
    '_commonFonts', '_isXMLDocument', '_isValidPITarget', '_isHTMLEl',
    '_nodeList', '_rngNodeLength', '_rngNodeIndex', '_rngSame', '_rngRoot',
    '_rngAncestors', '_rngOrder', '_rngCmp', '_rngCheckOffset',
    '_idbRequest', '_idbObjectStore', '_idbTransaction', '_idbDatabase',
    '_makeListenerBox',
    // WebIDL interfaces. A real browser exposes these on the global as
    // enumerable:false; here they were assigned with `globalThis.X = X`, which
    // defaults to enumerable:true and is detectable in one line:
    //   Object.getOwnPropertyDescriptor(window, 'Node').enumerable
    // Pre-declaring them non-enumerable here is enough -- per the note above,
    // the later `globalThis.X = X` assignments only update the value.
    'Node', 'Element', 'Document', 'DocumentFragment', 'DocumentType',
    'Animation', 'KeyframeEffect', 'DocumentTimeline',
    'Text', 'Comment', 'CDATASection', 'ProcessingInstruction', 'CharacterData',
    'CSSStyleDeclaration', 'DOMTokenList', 'NamedNodeMap', 'Screen', 'NetworkInformation',
    'MessageChannel', 'MessagePort', 'BroadcastChannel', 'CustomElementRegistry',
    'Scheduler', 'TextMetrics',
    'XMLHttpRequestEventTarget', 'XMLHttpRequestUpload', 'HTMLMediaElement', 'HTMLVideoElement',
    'HTMLAudioElement', 'WebGL2RenderingContext',
    'SVGElement', 'SVGGraphicsElement', 'SVGGeometryElement', 'SVGPathElement',
    'SVGSVGElement',
  ];
  // Preserve whatever is already there. Most of these names do not exist yet
  // at this point, but some do (`Deno`), and redefining those with
  // `value: undefined` would wipe them.
  for (var _i = 0; _i < _names.length; _i++) {
    try {
      var _prev = Object.getOwnPropertyDescriptor(globalThis, _names[_i]);
      if (_prev && (_prev.get || _prev.set)) {
        Object.defineProperty(globalThis, _names[_i], {
          get: _prev.get, set: _prev.set,
          enumerable: false, configurable: true,
        });
      } else {
        Object.defineProperty(globalThis, _names[_i], {
          value: _prev ? _prev.value : undefined,
          writable: true, enumerable: false, configurable: true,
        });
      }
    } catch (_e) {}
  }
})();

globalThis.addEventListener = globalThis.addEventListener || function(){};
// `window.onerror` and `window.onunhandledrejection` are null in a browser
// until the page assigns them, and a script that reads them gets the source of
// whatever is there. Two engine handlers used to sit in those slots; neither
// was reachable. Nothing dispatched `unhandledrejection` at all, and the
// `onerror` one only appended to `__obscura_errors`, which no Rust or JS
// caller ever read. The event-handler loop further down leaves both null now,
// which is what a browser reports.
globalThis.__windowListeners = {};
// Marked native below, next to _markNative itself: the set it writes to is
// still in its temporal dead zone here.
globalThis.addEventListener = function addEventListener(type, fn) {
  _eventTargetAdd(globalThis, type, fn, arguments[2]);
};
globalThis.removeEventListener = function removeEventListener(type, fn) {
  _eventTargetRemove(globalThis, type, fn, arguments[2]);
};
globalThis.dispatchEvent = function dispatchEvent(event) {
  return _eventTargetDispatch(globalThis, event);
};
// A cross-context V8 GlobalProxy exposes built-in bindings but can miss
// properties created later on the owning global object. Keep one realm-owned
// bridge whose traps execute in that realm and forward every live operation
// to its actual global. Rust shares this bridge between contexts; author-facing
// WindowProxy facades still enforce origin checks and stable navigation identity.
globalThis.__obscura_realm_bridge = new Proxy({}, {
  get(_target, key) { return Reflect.get(globalThis, key, globalThis); },
  set(_target, key, value) { return Reflect.set(globalThis, key, value, globalThis); },
  has(_target, key) { return Reflect.has(globalThis, key); },
  ownKeys() { return Reflect.ownKeys(globalThis); },
  getOwnPropertyDescriptor(_target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) descriptor.configurable = true;
    return descriptor;
  },
  defineProperty(_target, key, descriptor) {
    return Reflect.defineProperty(globalThis, key, descriptor);
  },
  deleteProperty(_target, key) { return Reflect.deleteProperty(globalThis, key); },
  getPrototypeOf() { return Reflect.getPrototypeOf(globalThis); },
});

let _domMutationEpoch = 0;
let _treeMutationEpoch = 0;
const _DOM_MUTATION_COMMANDS = new Set([
  "append_child", "insert_before", "remove_child",
  "set_attribute", "remove_attribute",
  "set_text_content", "set_inner_html", "set_inner_html_context",
  "set_fragment_html_executable",
]);
const _DOM_TREE_MUTATION_COMMANDS = new Set([
  "append_child", "insert_before", "remove_child",
  "set_inner_html", "set_inner_html_context", "set_fragment_html_executable",
]);
const _dom = (cmd, a1, a2) => {
  const result = Deno.core.ops.op_dom(cmd, String(a1 ?? ""), String(a2 ?? ""));
  if (_DOM_MUTATION_COMMANDS.has(cmd)) {
    _domMutationEpoch++;
    // Resize observation is tied to rendering-invalidating DOM work. The
    // hook is installed later in bootstrap, before page script can run.
    if (typeof globalThis.__obscura_recompute_resizes === "function") {
      globalThis.__obscura_recompute_resizes();
    }
    // Intersection geometry is invalidated synchronously as well. Deferring
    // this solely through MutationObserver misses the IO phase of the current
    // rendering opportunity when an rAF callback changes layout.
    if (typeof globalThis.__obscura_recompute_intersections === "function") {
      globalThis.__obscura_recompute_intersections();
    }
  }
  // Native mutation ops report their verified postcondition. Only a real tree
  // change invalidates ancestry caches; rejected cycles and invalid roots must
  // not make JS believe a move happened.
  if (result === "true" && _DOM_TREE_MUTATION_COMMANDS.has(cmd)) {
    _treeMutationEpoch++;
  }
  return result;
};

// Browser objects are ordinary JS shims. Property tracing is implemented below
// the page-visible object layer by the pinned V8 bytecode/runtime monitor.
function _bootstrapObject(_label, fallback) { return fallback(); }
function _identityObject(_label, source) { return source; }

const _nativeRegistrySym = Symbol.for('obscura.nativeFunctionRegistry');
const _nativeRegistry = Deno[_nativeRegistrySym] ||
  (Deno[_nativeRegistrySym] = { fns: new WeakSet(), strings: new WeakMap() });
const _nativeFns = _nativeRegistry.fns;
// Exact toString override for members whose native form is not just
// `function <name>()`, e.g. accessors (`function get x() { [native code] }`)
// or functions whose `.name` does not match the real builtin.
const _nativeStr = _nativeRegistry.strings;
const _origToString = Function.prototype.toString;
Function.prototype.toString = function toString() {
  if (_nativeStr.has(this)) { return _nativeStr.get(this); }
  if (_nativeFns.has(this)) {
    return `function ${this.name || ''}() { [native code] }`;
  }
  return _origToString.call(this);
};
function _markNative(fn) { if (typeof fn === 'function') _nativeFns.add(fn); return fn; }
// Mark a function with an exact native-code toString (used for accessors).
function _markNativeAs(fn, str) { if (typeof fn === 'function') _nativeStr.set(fn, str); return fn; }
// DOM instance internals live under isolate-global symbols rather than own
// string-keyed properties. `Object.getOwnPropertyNames(document)` returns
// non-enumerable own properties too, so a non-enumerable string slot still
// leaks through it (and Reflect.ownKeys). A symbol-keyed slot drops out of
// Object.getOwnPropertyNames, Object.keys and for-in entirely, matching Chrome
// where these slots live on WebIDL prototypes or in the C++ backing store.
// Symbol.for keeps the same key across the main realm
// and every frame realm (the string form, and a plain per-realm Symbol, would
// not), and is what Rust-injected snippets read back with.
const _nidSym = Symbol.for('obscura.nid');
const _scopeRootSym = Symbol.for('obscura.scopeRoot');
const _effectiveDomainSym = Symbol.for('obscura.effectiveDomain');
const _lastModifiedSym = Symbol.for('obscura.lastModified');
const _adoptedSheetsSym = Symbol.for('obscura.adoptedStyleSheets');
const _adoptedNodesSym = Symbol.for('obscura.adoptedStyleNodes');
const _defaultViewProxySym = Symbol.for('obscura.defaultViewProxy');
const _treeParentSym = Symbol.for('obscura.treeParent');
const _treeParentEpochSym = Symbol.for('obscura.treeParentEpoch');
const _ownerDocRootSym = Symbol.for('obscura.ownerDocRoot');
const _styleSheetListSym = Symbol.for('obscura.styleSheetList');
const _fontsSym = Symbol.for('obscura.fonts');
const _inputFocusedSym = Symbol.for('obscura.inputFocused');
const _inputClickTargetSym = Symbol.for('obscura.inputClickTarget');
const _detachedNodeOwners = new WeakMap();
const _detachedRootOwners = new Map();
function _detachedOwnerForNode(node) {
  const direct = node && _detachedNodeOwners.get(node);
  if (direct) return direct;
  if (_detachedRootOwners.size && node && node[_nidSym] !== undefined) {
    const rootNid = +_dom("document_root", node[_nidSym]);
    const owner = _detachedRootOwners.get(rootNid);
    if (owner) {
      _detachedNodeOwners.set(node, owner);
      return owner;
    }
  }
  return null;
}
// Captured once so structured clone does not depend on the global binding
// still being there. Chrome exposes no SharedArrayBuffer without cross-origin
// isolation; matching that is tracked separately (deleting it here does work,
// but something re-installs it after bootstrap runs).
let _SharedArrayBufferCtor = globalThis.SharedArrayBuffer || (() => {
  try {
    return new WebAssembly.Memory({initial: 1, maximum: 1, shared: true})
      .buffer.constructor;
  } catch (_error) { return undefined; }
})();
// Set by _installSecureContext at the very end of bootstrap and called from
// __obscura_init. A closure variable rather than a global: any own property
// name containing "obscura" leaks the engine's identity to a page that reads
// Object.getOwnPropertyNames(window).
let _applySecureContextGating = null;
let _applyCrossOriginIsolation = null;
let _crossOriginIsolatedValue = false;
// Chrome's non-isolated child Window surface omits these experimental
// constructors from own-key reflection. The values remain available through
// direct property access in realms that implement them; only the reflected
// surface is gated, and isolated frames keep the complete set.
const _nonIsolatedFrameHiddenNames = new Set([
  'FontFaceSet', 'HTMLUserMediaElement', 'InteractionContentfulPaint', 'NodeRange',
  'OpaqueRange', 'PerformanceSoftNavigation', 'PermissionsPolicy', 'XSLTProcessor',
]);
// V8's code-generation callback reads this realm-local flag to enforce the
// document's `script-src` `unsafe-eval` requirement without replacing the
// intrinsic eval binding (which would change direct-eval scope).
Object.defineProperty(globalThis, '__obscura_csp_allows_unsafe_eval', {
  value: true, writable: true, enumerable: false, configurable: true,
});
_nativeFns.add(Function.prototype.toString);
// Defined above, before this set existed. A script that enumerates the global
// and reads each value gets the function source back for anything unmarked,
// so an unmarked EventTarget method on `window` is engine source in the page's
// hands.
_markNative(globalThis.addEventListener);
_markNative(globalThis.removeEventListener);
_markNative(globalThis.dispatchEvent);

// unusualWindowProperties: obscura's internal globals are made non-enumerable
// (see _preHideInternals and __obscura_init), which hides them from
// Object.keys / for-in. But fingerprinting scripts enumerate the global object
// with Object.getOwnPropertyNames and Reflect.ownKeys, which return
// non-enumerable properties too, so the internals still leak (pixelscan's
// unusualWindowProperties check). Filter the engine's own globals out of the
// reflection APIs when they target the global object. The canonical name set is
// __obscura_hide_list, precomputed at snapshot-build time; referencing it lazily
// means the list is already populated by the time any page calls these.
(function _hideInternalsFromReflection() {
  var _cache = null, _cacheLen = -1;
  function _set() {
    var list = globalThis.__obscura_hide_list;
    if (!list) { return null; }
    if (_cache && _cacheLen === list.length) { return _cache; }
    _cache = new Set(list);
    _cache.add('__obscura_hide_list');
    _cacheLen = list.length;
    return _cache;
  }
  function _isGlobal(t) {
    if (t === globalThis) return true;
    // A frame realm's global object is a distinct V8 global, not this realm's
    // `globalThis`. Fingerprinting scripts reach it through
    // `iframe.contentWindow.eval('globalThis')` and then enumerate it with the
    // *main* realm's Object.getOwnPropertyNames, whose filter would otherwise
    // skip it (t !== globalThis) and leak every __obscura_* / _* / Deno global
    // the frame carries. A V8 global always answers `globalThis === t`; a plain
    // object does not, so this is a cheap, side-effect-free discriminator.
    try { return !!t && t.globalThis === t; } catch (_e) { return false; }
  }
  function _isNonIsolatedFrameGlobal(t) {
    let root = 0;
    try { root = Number(t && t.__obscura_frame_document_nid) || 0; } catch (_e) {}
    if (root <= 0) return false;
    try {
      const info = _domParse('document_scope_info', root) || {};
      if (info.crossOriginIsolated === true) return false;
      // Same-origin about:blank frames share the normal platform surface.
      // The reduced own-key view is specific to a cross-origin child, which
      // is the WindowProxy shape used by the challenge widget.
      const container = _domParse('frame_container_info', root) || {};
      const parentRoot = Number(container.parentRoot) || 0;
      return _dom('iframe_scopes_same_origin', root, parentRoot) !== 'true';
    } catch (_e) { return false; }
  }
  function _isDomWrapper(t) {
    try { return !!t && typeof t[_nidSym] === 'number'; }
    catch (_e) { return false; }
  }
  // __obscura_hide_list is snapshot-time. A global the engine creates later --
  // the interaction strategy's flags, the embedder-installed policy -- is not
  // in it, and Cloudflare's challenge payload enumerated exactly those out of
  // the window (`o.__obscura_click_listener_hooked`, `o.__obscura_click_listener_seen`,
  // `o.__obscura_input_strategy`). Match the engine's own namespace by name so
  // a later-created internal cannot come back through reflection. No page
  // global carries this namespace, so nothing a page owns is hidden here.
  function _isEngineName(name) {
    if (typeof name !== 'string' || name.length < 4) { return false; }
    return name.indexOf('obscura') !== -1 || name.indexOf('Obscura') !== -1 || name === 'Deno';
  }
  function _filter(t, names) {
    var out = names;
    if (_isGlobal(t)) {
      var set = _set();
      out = out.filter(function(name) {
        if (_isEngineName(name)) { return false; }
        return !set || !set.has(name);
      });
      if (_isNonIsolatedFrameGlobal(t)) {
        out = out.filter(function(name) {
          return typeof name !== 'string' || !_nonIsolatedFrameHiddenNames.has(name);
        });
      }
    }
    // DOM wrapper implementation slots are all underscore-prefixed. They are
    // intentionally ordinary JS fields for fast internal access, but Chrome's
    // WebIDL objects do not expose them through own-property reflection.
    if (_isDomWrapper(t)) {
      out = out.filter(function(name) { return typeof name !== 'string' || name.charAt(0) !== '_'; });
    }
    return out;
  }
  var _oGOPN = Object.getOwnPropertyNames;
  var _oOwnKeys = Reflect.ownKeys;
  var _oKeys = Object.keys;
  var _oGOPDs = Object.getOwnPropertyDescriptors;
  function define(obj, prop, impl) {
    try { Object.defineProperty(obj, prop, { value: _markNative(impl), writable: true, enumerable: false, configurable: true }); } catch (e) {}
  }
  define(Object, 'getOwnPropertyNames', function getOwnPropertyNames(t) { return _filter(t, _oGOPN(t)); });
  define(Reflect, 'ownKeys', function ownKeys(t) { return _filter(t, _oOwnKeys(t)); });
  define(Object, 'keys', function keys(t) { return _filter(t, _oKeys(t)); });
  define(Object, 'getOwnPropertyDescriptors', function getOwnPropertyDescriptors(t) {
    var all = _oGOPDs(t);
    if (_isGlobal(t)) {
      var set = _set();
      var ks = _oGOPN(all);
      for (var i = 0; i < ks.length; i++) {
        if (_isEngineName(ks[i]) || (set && set.has(ks[i]))) { delete all[ks[i]]; }
      }
      if (_isNonIsolatedFrameGlobal(t)) {
        var frameKeys = _oGOPN(all);
        for (var fi = 0; fi < frameKeys.length; fi++) {
          if (_nonIsolatedFrameHiddenNames.has(frameKeys[fi])) delete all[frameKeys[fi]];
        }
      }
    }
    if (_isDomWrapper(t)) {
      var domKeys = _oGOPN(all);
      for (var j = 0; j < domKeys.length; j++) {
        if (typeof domKeys[j] === 'string' && domKeys[j].charAt(0) === '_') delete all[domKeys[j]];
      }
    }
    return all;
  });
  // Engine globals created after the snapshot-time hide list was captured --
  // the interaction strategy flags, the embedder's input policy, the measure
  // and clone helpers -- are installed as ordinary assignments, which makes
  // them enumerable. The reflection-API filter above hides them from
  // getOwnPropertyNames / ownKeys / keys / getOwnPropertyDescriptors, but V8
  // walks `for..in` from the property table itself, so `for (var k in window)`
  // still listed 19 engine names that no browser has. Enumerability is the only
  // thing that walk consults, so make every engine-namespaced own global
  // non-enumerable. `for..in` finds them precisely because our own enumeration
  // helpers are filtered. Idempotent and cheap: call again after a late install.
  define(globalThis, '__obscura_hide_engine_globals', function __obscura_hide_engine_globals() {
    try {
      for (var name in globalThis) {
        if (typeof name !== 'string') { continue; }
        if (!_isEngineName(name) && name.indexOf('__blob') !== 0) { continue; }
        try {
          var d = Object.getOwnPropertyDescriptor(globalThis, name);
          if (d && d.enumerable) {
            Object.defineProperty(globalThis, name, { enumerable: false });
          }
        } catch (e) {}
      }
    } catch (e) {}
    return undefined;
  });
})();

[Error, TypeError, ReferenceError, SyntaxError, RangeError, URIError, EvalError].forEach(E => {
  try {
    Object.defineProperty(E.prototype, 'name', {
      value: E.name, writable: true, enumerable: false, configurable: false,
    });
  } catch(e) {}
});

const _stackCache = new WeakMap();
const _origStackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
if (_origStackDesc && _origStackDesc.get) {
  Object.defineProperty(Error.prototype, 'stack', {
    configurable: false, enumerable: false,
    get: function() {
      if (!_stackCache.has(this)) _stackCache.set(this, _origStackDesc.get.call(this));
      return _stackCache.get(this);
    }
  });
}
