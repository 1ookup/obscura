class CustomElementRegistry {
  constructor() {
    _customElementRegistryState.set(this, {
      registry: new Map(), byCtor: new Map(), resolvers: new Map(),
      defining: false, roots: new Set(),
    });
  }
  define(name, cls, opts) {
    const state = _customElementRegistryData(this);
    if (!_isConstructorCE(cls)) throw new TypeError("Failed to execute 'define' on 'CustomElementRegistry': parameter 2 is not a constructor.");
    if (!_isValidCustomElementName(name)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': \"" + name + "\" is not a valid custom element name", "SyntaxError");
    if (state.defining) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': operation is not supported while a definition is in progress", "NotSupportedError");
    if (state.registry.has(name)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': the name \"" + name + "\" has already been used with this registry", "NotSupportedError");
    if (state.byCtor.has(cls)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': the constructor has already been used with this registry", "NotSupportedError");
    state.defining = true;
    try {
      state.byCtor.set(cls, name);
      state.registry.set(name, cls);
      for (const root of state.roots) _customElementUpgradeRoot(this, root);
    } finally {
      state.defining = false;
    }
    const resolvers = state.resolvers.get(name);
    if (resolvers) {
      for (const r of resolvers) r(cls);
      state.resolvers.delete(name);
    }
  }
  get(name) { return _customElementRegistryData(this).registry.get(name); }
  getName(cls) {
    const state = _customElementRegistryData(this);
    if (!_isConstructorCE(cls)) throw new TypeError("Failed to execute 'getName' on 'CustomElementRegistry': parameter 1 is not a constructor.");
    return state.byCtor.has(cls) ? state.byCtor.get(cls) : null;
  }
  whenDefined(name) {
    const state = _customElementRegistryData(this);
    if (!_isValidCustomElementName(name)) return Promise.reject(new DOMException("Failed to execute 'whenDefined' on 'CustomElementRegistry': \"" + name + "\" is not a valid custom element name", "SyntaxError"));
    const cls = state.registry.get(name);
    if (cls) return Promise.resolve(cls);
    return new Promise((resolve) => {
      const list = state.resolvers.get(name) || [];
      list.push(resolve);
      state.resolvers.set(name, list);
    });
  }
  upgrade(root) {
    _customElementRegistryData(this);
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'upgrade' on 'CustomElementRegistry': 1 argument required, but only 0 present.");
    }
    _customElementUpgradeRoot(this, root);
  }
  initialize(root) {
    const state = _customElementRegistryData(this);
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'initialize' on 'CustomElementRegistry': 1 argument required, but only 0 present.");
    }
    if (root?.customElementRegistry === this) {
      state.roots.add(root);
      _customElementUpgradeRoot(this, root);
    }
  }
}
globalThis.CustomElementRegistry = CustomElementRegistry;
globalThis.customElements = new CustomElementRegistry();
_customElementRegistryData(globalThis.customElements).roots.add(globalThis.document);
{
  const prototype = CustomElementRegistry.prototype;
  const descriptors = Object.getOwnPropertyDescriptors(prototype);
  for (const name of Object.getOwnPropertyNames(prototype)) delete prototype[name];
  for (const name of ['define','get','getName','upgrade','whenDefined','initialize']) {
    const descriptor = descriptors[name]; descriptor.enumerable = true;
    Object.defineProperty(prototype, name, descriptor);
  }
  Object.defineProperty(prototype, 'constructor', descriptors.constructor);
  Object.defineProperty(prototype, Symbol.toStringTag, {
    value: 'CustomElementRegistry', configurable: true,
  });
}
