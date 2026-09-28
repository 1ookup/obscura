// The CSS namespace object, installed from __obscura_init.
//
// Chrome's CSS carries 69 own properties: `highlights` first, then one factory
// per unit (Hz, Q, cap, ... x), with `escape`, `registerProperty` and
// `supports` in their alphabetical slots and `paintWorklet` last. The engine
// had three of them, so `Object.getOwnPropertyNames(CSS)` -- a census any
// fingerprinting bundle takes -- came up 66 names short, and the unit
// factories (`CSS.px(4)` answering a CSSUnitValue) were missing entirely.
//
// Shapes measured on the local Chrome oracle (149): `CSS.px(4)` answers
// "[object CSSUnitValue]" with `value` 4 and `unit` "px", String() renders
// "4px", the instance has no own properties, the prototype chain is
// CSSUnitValue -> CSSNumericValue -> CSSStyleValue, `toString` is
// CSSStyleValue's own member, and an unknown unit name is a TypeError.
// `CSS.highlights` is a HighlightRegistry with the maplike surface and a
// "HighlightRegistry Iterator" tag.
//
// The install runs at init rather than at module time because the interface
// objects it chains onto (CSSNumericValue, CSSStyleValue) are installed by the
// interface table in config/surface-finalize.js, which runs after this module.
// The registry keeps highlights and nothing renders them, which is what a page
// observes from a registry it never wrote to.
(function installCssNamespaceSurface() {
  const unitNames = [
    'Hz', 'Q', 'cap', 'ch', 'cm', 'cqb', 'cqh', 'cqi', 'cqmax', 'cqmin', 'cqw',
    'deg', 'dpcm', 'dpi', 'dppx', 'dvb', 'dvh', 'dvi', 'dvmax', 'dvmin', 'dvw',
    'em', 'ex', 'fr', 'grad', 'ic', 'in', 'kHz', 'lh', 'lvb', 'lvh', 'lvi',
    'lvmax', 'lvmin', 'lvw', 'mm', 'ms', 'number', 'pc', 'percent', 'pt', 'px',
    'rad', 'rcap', 'rch', 'rem', 'rex', 'ric', 'rlh', 's', 'svb', 'svh', 'svi',
    'svmax', 'svmin', 'svw', 'turn', 'vb', 'vh', 'vi', 'vmax', 'vmin', 'vw', 'x',
  ];
  const knownUnits = new Set(unitNames.map(name => name.toLowerCase()));
  // `percent` renders as "%" and `number` as a bare value; every other unit is
  // its own name.
  const unitSuffix = unit => (unit === 'percent' ? '%' : (unit === 'number' ? '' : unit));

  const unitState = new WeakMap();
  const method = (name, length, fn) => {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (_e) {}
    try { Object.defineProperty(fn, 'length', { value: length, configurable: true }); } catch (_e) {}
    return _markNative(fn);
  };
  const define = (target, name, value) => Object.defineProperty(target, name, {
    value, writable: true, enumerable: true, configurable: true,
  });
  // Chrome keeps `constructor` in the middle of some prototypes and last in
  // others; the descriptors are rebuilt in the slot the oracle reported.
  const parkConstructor = prototype => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    if (!descriptor) return;
    try {
      delete prototype.constructor;
      Object.defineProperty(prototype, 'constructor', descriptor);
    } catch (_e) {}
  };

  function installUnitValue() {
    const numericPrototype = globalThis.CSSNumericValue?.prototype || Object.prototype;
    const styleValuePrototype = globalThis.CSSStyleValue?.prototype || Object.prototype;
    if (Object.getPrototypeOf(numericPrototype) !== styleValuePrototype) {
      try { Object.setPrototypeOf(numericPrototype, styleValuePrototype); } catch (_e) {}
    }
    const UnitValue = method('CSSUnitValue', 2, function (value, unit) {
      if (arguments.length < 2) {
        throw new TypeError("Failed to construct 'CSSUnitValue': 2 arguments required, but only "
          + arguments.length + ' present.');
      }
      const name = String(unit).toLowerCase();
      if (!knownUnits.has(name)) {
        throw new TypeError("Failed to construct 'CSSUnitValue': Invalid unit: " + String(unit));
      }
      const instance = Object.create(UnitValue.prototype);
      unitState.set(instance, { value: Number(value), unit: name });
      return instance;
    });
    Object.setPrototypeOf(UnitValue.prototype, numericPrototype);
    Object.defineProperty(UnitValue.prototype, Symbol.toStringTag,
      { value: 'CSSUnitValue', configurable: true });
    const requireUnit = receiver => {
      const state = unitState.get(receiver);
      if (!state) throw new TypeError('Illegal invocation');
      return state;
    };
    Object.defineProperty(UnitValue.prototype, 'value', {
      get: method('get value', 0, function () { return requireUnit(this).value; }),
      set: method('set value', 1, function (value) { requireUnit(this).value = Number(value); }),
      enumerable: true, configurable: true,
    });
    Object.defineProperty(UnitValue.prototype, 'unit', {
      get: method('get unit', 0, function () { return requireUnit(this).unit; }),
      set: undefined, enumerable: true, configurable: true,
    });
    // CSSStyleValue owns the string form; a CSSUnitValue answers through it.
    if (styleValuePrototype !== Object.prototype
        && typeof Object.getOwnPropertyDescriptor(styleValuePrototype, 'toString') === 'undefined') {
      define(styleValuePrototype, 'toString', method('toString', 0, function () {
        const state = requireUnit(this);
        return String(state.value) + unitSuffix(state.unit);
      }));
      // Chrome lists toString before constructor on CSSStyleValue.prototype.
      parkConstructor(styleValuePrototype);
    }
    parkConstructor(UnitValue.prototype);
    Object.defineProperty(globalThis, 'CSSUnitValue', {
      value: UnitValue, writable: true, enumerable: false, configurable: true,
    });
    return UnitValue;
  }

  function installHighlights() {
    const registryEntries = new WeakMap();
    const Iterator = function () {
      throw new TypeError("Failed to construct 'HighlightRegistry Iterator': Illegal constructor");
    };
    Object.defineProperty(Iterator.prototype, Symbol.toStringTag,
      { value: 'HighlightRegistry Iterator', configurable: true });
    let prototype = globalThis.HighlightRegistry && globalThis.HighlightRegistry.prototype;
    if (!prototype) {
      const Registry = method('HighlightRegistry', 0, function () {
        throw new TypeError("Failed to construct 'HighlightRegistry': Illegal constructor");
      });
      Object.defineProperty(globalThis, 'HighlightRegistry', {
        value: Registry, writable: true, enumerable: false, configurable: true,
      });
      prototype = Registry.prototype;
    }
    if (typeof Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag) === 'undefined') {
      Object.defineProperty(prototype, Symbol.toStringTag,
        { value: 'HighlightRegistry', configurable: true });
    }
    const entriesOf = receiver => {
      const map = registryEntries.get(receiver);
      if (!map) throw new TypeError('Illegal invocation');
      return map;
    };
    const registryMethod = (name, length, body) =>
      define(prototype, name, method(name, length, body));
    const iteratorOver = (registry, kind) => {
      const iterator = entriesOf(registry)[kind]();
      Object.setPrototypeOf(iterator, Iterator.prototype);
      return iterator;
    };
    if (typeof Object.getOwnPropertyDescriptor(prototype, 'size') === 'undefined') {
      Object.defineProperty(prototype, 'size', {
        get: method('get size', 0, function () { return entriesOf(this).size; }),
        set: undefined, enumerable: true, configurable: true,
      });
    }
    registryMethod('clear', 0, function () { entriesOf(this).clear(); });
    registryMethod('delete', 1, function (key) { return entriesOf(this).delete(key); });
    registryMethod('entries', 0, function () { return iteratorOver(this, 'entries'); });
    registryMethod('forEach', 1, function (callback, thisArg) {
      if (typeof callback !== 'function') {
        throw new TypeError("Failed to execute 'forEach' on 'HighlightRegistry': parameter 1 is not of type 'Function'.");
      }
      entriesOf(this).forEach((value, key) => { callback.call(thisArg, value, key, this); });
    });
    registryMethod('get', 1, function (key) { return entriesOf(this).get(key); });
    registryMethod('has', 1, function (key) { return entriesOf(this).has(key); });
    registryMethod('keys', 0, function () { return iteratorOver(this, 'keys'); });
    registryMethod('set', 2, function (key, value) {
      // A real registry rejects anything that is not a Highlight; nothing here
      // can build one, so the entry is kept as given.
      entriesOf(this).set(key, value);
      return this;
    });
    registryMethod('values', 0, function () { return iteratorOver(this, 'values'); });
    registryMethod('highlightsFromPoint', 2, function () { return []; });
    parkConstructor(prototype);
    const highlights = Object.create(prototype);
    registryEntries.set(highlights, new Map());
    return highlights;
  }

  // The namespace's own key order, in Chrome's list. The three members the
  // engine already had (escape, supports, paintWorklet) are carried into their
  // Chrome slots; anything else the engine added keeps a slot at the end
  // rather than disappearing.
  function orderNamespace(CSS, highlights) {
    const order = ['highlights'];
    for (const name of unitNames) {
      order.push(name);
      if (name === 'em') order.push('escape');
      if (name === 'rch') order.push('registerProperty');
      if (name === 's') order.push('supports');
    }
    order.push('paintWorklet');
    const carried = new Map();
    for (const name of Object.getOwnPropertyNames(CSS)) {
      const descriptor = Object.getOwnPropertyDescriptor(CSS, name);
      if (descriptor) carried.set(name, descriptor);
    }
    for (const name of Object.getOwnPropertyNames(CSS)) {
      try { delete CSS[name]; } catch (_e) {}
    }
    // `highlights` leads Chrome's list; the carried members follow in the
    // slots above.
    if (highlights) define(CSS, 'highlights', highlights);
    for (const name of [...order, ...carried.keys()]) {
      const descriptor = carried.get(name);
      if (!descriptor) continue;
      try { Object.defineProperty(CSS, name, descriptor); } catch (_e) {}
    }
  }

  globalThis.__obscura_install_css_namespace = function () {
    const CSS = globalThis.CSS;
    if (!CSS || typeof CSS !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(CSS, 'highlights')
        && Object.prototype.hasOwnProperty.call(CSS, 'px')) {
      return;
    }
    const UnitValue = installUnitValue();
    const highlights = installHighlights();
    for (const name of unitNames) {
      const unit = name.toLowerCase();
      define(CSS, name, method(name, 1, function (value) {
        if (arguments.length < 1) {
          throw new TypeError("Failed to execute '" + name + "' on 'CSS': 1 argument required, but only 0 present.");
        }
        const instance = Object.create(UnitValue.prototype);
        unitState.set(instance, { value: Number(value), unit });
        return instance;
      }));
    }
    define(CSS, 'registerProperty', method('registerProperty', 1, function (definition) {
      const property = definition || {};
      if (property.inherits === undefined) {
        throw new TypeError("Failed to execute 'registerProperty' on 'CSS': Failed to read the 'inherits' property from 'PropertyDefinition': Required member is undefined.");
      }
      const name = String(property.name === undefined ? '' : property.name);
      if (!name.startsWith('--')) {
        throw new SyntaxError("Failed to execute 'registerProperty' on 'CSS': Custom property names must start with '--'.");
      }
    }));
    orderNamespace(CSS, highlights);
  };

  // V8's Temporal namespace carries TimeZone and Calendar; the Chrome oracle
  // for this engine's target answer does not (nine members: Now and the eight
  // plain types). The descriptors are configurable, so the extra two leave.
  // The trim rides this pass because Temporal's intrinsics are minted per
  // context, after every module has run.
  globalThis.__obscura_trim_temporal_namespace = function () {
    let namespace = null;
    try { namespace = globalThis.Temporal; } catch (_e) { return; }
    if (!namespace) return;
    for (const name of ['TimeZone', 'Calendar']) {
      const descriptor = Object.getOwnPropertyDescriptor(namespace, name);
      if (descriptor && descriptor.configurable) {
        try { delete namespace[name]; } catch (_e) {}
      }
    }
  };
})();
