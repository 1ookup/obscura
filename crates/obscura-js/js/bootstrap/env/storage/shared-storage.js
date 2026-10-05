// SharedStorage.
//
// Retired on the Chrome 154 evidence: the family this file once installed
// (SharedStorage, five *Method classes, SharedStorageWorklet, a
// `sharedStorage` accessor) does not exist on the 154 reference in any realm
// we can observe. The shapes below were measured against the 149 oracle;
// they stay as reference, and the installer returns before touching the
// global.
//
// The storage itself is not implemented. Writes and batchUpdate resolve
// without persisting anything, and the three entry points that need a
// registered worklet module (run, selectURL, createWorklet) reject, because
// nothing in this engine can add one; a resolved promise there would be a
// value no browser produces for those calls.
(function installSharedStorageSurface() {
  // Chrome 154 carries no SharedStorage family in any realm we can observe:
  // the top document, a secure origin and the cross-origin widget frame all
  // answer `'sharedStorage' in window` with false, `typeof SharedStorage` is
  // undefined, and the 154 payload census lists none of the constructors.
  // The 149 oracle this file was measured against is stale; installing any of
  // it now would be ten invented keys on the global. The shapes below stay
  // for reference only.
  return;
  if (typeof globalThis.SharedStorage !== 'undefined') return;

  const method = (name, length, fn) => {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (_e) {}
    try { Object.defineProperty(fn, 'length', { value: length, configurable: true }); } catch (_e) {}
    return _markNative(fn);
  };
  const define = (target, name, value) => Object.defineProperty(target, name, {
    value, writable: true, enumerable: true, configurable: true,
  });
  const defineGetter = (target, name, get) => {
    try {
      Object.defineProperty(get, 'name', { value: 'get ' + name, configurable: true });
    } catch (_e) {}
    Object.defineProperty(target, name, {
      get: _markNative(get), enumerable: true, configurable: true,
    });
  };
  const brand = (ctor, name) => {
    _markNative(ctor);
    Object.defineProperty(ctor.prototype, Symbol.toStringTag,
      { value: name, configurable: true });
  };
  const illegal = name => method(name, 0, function () {
    throw new TypeError("Failed to construct '" + name + "': Illegal constructor");
  });
  const publish = (name, ctor) => Object.defineProperty(globalThis, name, {
    value: ctor, writable: true, enumerable: false, configurable: true,
  });

  // SharedStorageModifierMethod is the base of the five method classes and is
  // itself not constructible.
  const ModifierMethod = illegal('SharedStorageModifierMethod');
  brand(ModifierMethod, 'SharedStorageModifierMethod');

  // The two classes that take shared-storage modifier methods validate their
  // arguments rather than coercing them: Chrome rejects anything that is not a
  // SharedStorageModifierMethod with the WebIDL conversion error.
  const methodClass = (name, argCount, validator) => {
    const ctor = method(name, argCount, function () {
      if (arguments.length < argCount) {
        throw new TypeError("Failed to construct '" + name + "': " + argCount
          + ' argument' + (argCount > 1 ? 's' : '') + ' required, but only '
          + arguments.length + ' present.');
      }
      if (validator) validator(name, arguments, argCount);
      return Object.create(ctor.prototype);
    });
    Object.setPrototypeOf(ctor.prototype, ModifierMethod.prototype);
    brand(ctor, name);
    return ctor;
  };
  const AppendMethod = methodClass('SharedStorageAppendMethod', 2);
  const SetMethod = methodClass('SharedStorageSetMethod', 2);
  // `key`/modifier classes take required arguments before the modifiers, so
  // only the trailing arguments are validated against the base class:
  // `new SharedStorageDeleteMethod('k')` is valid, a second non-modifier
  // argument is not.
  const modifierValidator = (name, args, required) => {
    for (const value of Array.prototype.slice.call(args, required)) {
      if (!(value instanceof ModifierMethod)) {
        throw new TypeError("Failed to construct '" + name
          + "': The provided value is not of type 'SharedStorageModifierMethod'.");
      }
    }
  };
  const DeleteMethod = methodClass('SharedStorageDeleteMethod', 1, modifierValidator);
  const ClearMethod = methodClass('SharedStorageClearMethod', 0, modifierValidator);

  const rejectNoWorklet = () =>
    Promise.reject(new DOMException('The worklet module was not added', 'OperationError'));

  const Worklet = illegal('SharedStorageWorklet');
  brand(Worklet, 'SharedStorageWorklet');
  define(Worklet.prototype, 'addModule', method('addModule', 1, function (moduleURL, options) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'addModule' on 'SharedStorageWorklet': 1 argument required, but only 0 present.");
    }
    void options;
    void moduleURL;
    return rejectNoWorklet();
  }));
  // Chrome's own member order: addModule, then `constructor`, then run and
  // selectURL. The constructor is already the prototype's first key, so it is
  // rebuilt into the slot Chrome puts it in.
  {
    const descriptor = Object.getOwnPropertyDescriptor(Worklet.prototype, 'constructor');
    delete Worklet.prototype.constructor;
    Object.defineProperty(Worklet.prototype, 'constructor', descriptor);
  }
  define(Worklet.prototype, 'run', method('run', 2, function () { return rejectNoWorklet(); }));
  define(Worklet.prototype, 'selectURL', method('selectURL', 3, function () { return rejectNoWorklet(); }));

  const SharedStorage = illegal('SharedStorage');
  brand(SharedStorage, 'SharedStorage');
  const resolved = () => Promise.resolve(undefined);
  define(SharedStorage.prototype, 'append', method('append', 2, function (key, value) {
    if (arguments.length < 2) {
      throw new TypeError("Failed to execute 'append' on 'SharedStorage': 2 arguments required, but only " + arguments.length + ' present.');
    }
    void key; void value;
    return resolved();
  }));
  define(SharedStorage.prototype, 'clear', method('clear', 0, function () { return resolved(); }));
  define(SharedStorage.prototype, 'delete', method('delete', 1, function (key) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'delete' on 'SharedStorage': 1 argument required, but only 0 present.");
    }
    void key;
    return resolved();
  }));
  define(SharedStorage.prototype, 'set', method('set', 2, function (key, value) {
    if (arguments.length < 2) {
      throw new TypeError("Failed to execute 'set' on 'SharedStorage': 2 arguments required, but only " + arguments.length + ' present.');
    }
    void key; void value;
    return resolved();
  }));
  const batchMethods = { set: SharedStorage.prototype.set, append: SharedStorage.prototype.append,
                         delete: SharedStorage.prototype.delete, clear: SharedStorage.prototype.clear };
  define(SharedStorage.prototype, 'batchUpdate', method('batchUpdate', 1, function (update) {
    if (typeof update !== 'function') {
      return Promise.reject(new TypeError("Failed to execute 'batchUpdate' on 'SharedStorage': The provided value is not of type 'Function'."));
    }
    try {
      update(Object.create(null, Object.fromEntries(
        Object.entries(batchMethods).map(([name, value]) => [name, { value, enumerable: true }]))));
    } catch (error) {
      return Promise.reject(error);
    }
    return resolved();
  }));
  {
    const descriptor = Object.getOwnPropertyDescriptor(SharedStorage.prototype, 'constructor');
    delete SharedStorage.prototype.constructor;
    Object.defineProperty(SharedStorage.prototype, 'constructor', descriptor);
  }
  const workletInstance = Object.create(Worklet.prototype);
  defineGetter(SharedStorage.prototype, 'worklet', function () { return workletInstance; });
  define(SharedStorage.prototype, 'createWorklet', method('createWorklet', 0, function () {
    return rejectNoWorklet();
  }));
  define(SharedStorage.prototype, 'run', method('run', 2, function () { return rejectNoWorklet(); }));
  define(SharedStorage.prototype, 'selectURL', method('selectURL', 3, function () { return rejectNoWorklet(); }));

  publish('SharedStorageModifierMethod', ModifierMethod);
  publish('SharedStorageAppendMethod', AppendMethod);
  publish('SharedStorageSetMethod', SetMethod);
  publish('SharedStorageDeleteMethod', DeleteMethod);
  publish('SharedStorageClearMethod', ClearMethod);
  publish('SharedStorageWorklet', Worklet);
  publish('SharedStorage', SharedStorage);

  // Chrome exposes `sharedStorage` from a secure context onwards. The engine's
  // other secure-context-only storages (caches, cookieStore) are installed
  // unconditionally and gated by the secure-context pass instead, so this
  // follows them rather than inventing a second rule.
  const instance = Object.create(SharedStorage.prototype);
  const storageGetter = function () { return instance; };
  try {
    Object.defineProperty(storageGetter, 'name', { value: 'get sharedStorage', configurable: true });
  } catch (_e) {}
  Object.defineProperty(globalThis, 'sharedStorage', {
    get: _markNative(storageGetter),
    enumerable: true, configurable: true,
  });
})();
