// ModelContext and WebMCPEvent (WebMCP).
//
// Chrome's window carries both as non-enumerable own properties, and
// Navigator.prototype carries a `modelContext` accessor whose value is a
// ModelContext instance; the engine answered none of the three, so a census of
// the global and of the navigator prototype came up short. Shapes measured on
// the local Chrome oracle (149): ModelContext extends EventTarget with
// ontoolchange/getTools/registerTool, WebMCPEvent extends Event with a
// `toolName` getter and a one-argument constructor.
//
// What the tools themselves would do is not implemented. getTools answers an
// empty list and registerTool records nothing: this is the shape a feature
// probe sees, not a working agent surface.
(function installModelContextSurface() {
  if (typeof globalThis.ModelContext === 'undefined') {
    const define = (target, name, value) => Object.defineProperty(target, name, {
      value, writable: true, enumerable: true, configurable: true,
    });
    const method = (name, length, fn) => {
      try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (_e) {}
      try { Object.defineProperty(fn, 'length', { value: length, configurable: true }); } catch (_e) {}
      return _markNative(fn);
    };

    const ModelContext = method('ModelContext', 0, function () {
      throw new TypeError("Failed to construct 'ModelContext': Illegal constructor");
    });
    Object.setPrototypeOf(ModelContext.prototype, EventTarget.prototype);
    Object.defineProperty(ModelContext.prototype, Symbol.toStringTag,
      { value: 'ModelContext', configurable: true });
    const toolChangeGetter = function () { return null; };
    const toolChangeSetter = function (value) { void value; };
    try {
      Object.defineProperty(toolChangeGetter, 'name', { value: 'get ontoolchange', configurable: true });
      Object.defineProperty(toolChangeSetter, 'name', { value: 'set ontoolchange', configurable: true });
    } catch (_e) {}
    // ontoolchange comes first in Chrome's member order, before getTools and
    // registerTool, so it is defined before them and the constructor is moved
    // to the end afterwards.
    Object.defineProperty(ModelContext.prototype, 'ontoolchange', {
      get: _markNative(toolChangeGetter), set: _markNative(toolChangeSetter),
      enumerable: true, configurable: true,
    });
    define(ModelContext.prototype, 'getTools', method('getTools', 0, function () {
      // The tool list describes what the embedding agent registered; nothing
      // registers one here, so the list is empty rather than invented.
      return Promise.resolve([]);
    }));
    define(ModelContext.prototype, 'registerTool', method('registerTool', 1, function (tool) {
      if (tool === null || (typeof tool !== 'object' && typeof tool !== 'function')) {
        throw new TypeError("Failed to execute 'registerTool' on 'ModelContext': The provided value is not of type 'ModelContextTool'.");
      }
    }));
    {
      const descriptor = Object.getOwnPropertyDescriptor(ModelContext.prototype, 'constructor');
      delete ModelContext.prototype.constructor;
      Object.defineProperty(ModelContext.prototype, 'constructor', descriptor);
    }
    Object.defineProperty(globalThis, 'ModelContext', {
      value: ModelContext, writable: true, enumerable: false, configurable: true,
    });

    // The init dictionary's toolName is readable back off the instance, as in
    // Chrome; it is kept out of the instance's own properties.
    const toolNames = new WeakMap();
    const toolNameGetter = function () { return toolNames.get(this) || ''; };
    try {
      Object.defineProperty(toolNameGetter, 'name', { value: 'get toolName', configurable: true });
    } catch (_e) {}
    const WebMCPEvent = method('WebMCPEvent', 1, function (type, init) {
      if (arguments.length < 1) {
        throw new TypeError("Failed to construct 'WebMCPEvent': 1 argument required, but only 0 present.");
      }
      if (init !== undefined && (init === null || typeof init !== 'object')) {
        throw new TypeError("Failed to construct 'WebMCPEvent': The provided value is not of type 'WebMCPEventInit'.");
      }
      const event = new Event(type, init);
      Object.setPrototypeOf(event, WebMCPEvent.prototype);
      if (init && typeof init === 'object' && init.toolName !== undefined) {
        toolNames.set(event, String(init.toolName));
      }
      return event;
    });
    Object.setPrototypeOf(WebMCPEvent.prototype, Event.prototype);
    Object.defineProperty(WebMCPEvent.prototype, Symbol.toStringTag,
      { value: 'WebMCPEvent', configurable: true });
    Object.defineProperty(WebMCPEvent.prototype, 'toolName', {
      get: _markNative(toolNameGetter), enumerable: true, configurable: true,
    });
    {
      const descriptor = Object.getOwnPropertyDescriptor(WebMCPEvent.prototype, 'constructor');
      delete WebMCPEvent.prototype.constructor;
      Object.defineProperty(WebMCPEvent.prototype, 'constructor', descriptor);
    }
    Object.defineProperty(globalThis, 'WebMCPEvent', {
      value: WebMCPEvent, writable: true, enumerable: false, configurable: true,
    });
  }

  // The accessor sits on the navigator's own prototype, which is where Chrome
  // puts it (the identity object the page reads is one step further down).
  const navigatorPrototype = globalThis.navigator && Object.getPrototypeOf(globalThis.navigator);
  if (!navigatorPrototype
      || typeof Object.getOwnPropertyDescriptor(navigatorPrototype, 'modelContext') === 'object') {
    return;
  }
  let instance;
  const getter = function () {
    if (!instance) instance = Object.create(globalThis.ModelContext.prototype);
    return instance;
  };
  try {
    Object.defineProperty(getter, 'name', { value: 'get modelContext', configurable: true });
  } catch (_e) {}
  Object.defineProperty(navigatorPrototype, 'modelContext', {
    get: _markNative(getter), enumerable: true, configurable: true,
  });
})();
