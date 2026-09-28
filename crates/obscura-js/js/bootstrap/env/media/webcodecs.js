// WebCodecs interface members. The interface table installs the four codec
// constructors as bare shells; the reference carries the full static query
// and a state-machine prototype on each, and its build has no codec backend,
// so every isConfigSupported() resolves unsupported (measured 149, window
// and worker realms alike -- the challenge's capability probe reads exactly
// this and answers null where a shell throws instead).
(function _installWebCodecsMembers() {
  const _codecState = new WeakMap();
  function _stateOf(instance) {
    let state = _codecState.get(instance);
    if (!state) {
      state = { configured: false, closed: false };
      _codecState.set(instance, state);
    }
    return state;
  }
  function _stateString(state) {
    return state.closed ? 'closed' : state.configured ? 'configured' : 'unconfigured';
  }

  const _codecNames = ['VideoEncoder', 'VideoDecoder', 'AudioEncoder', 'AudioDecoder'];
  for (const name of _codecNames) {
    const ctor = globalThis[name];
    if (typeof ctor !== 'function' || !ctor.prototype) continue;
    const proto = ctor.prototype;


    if (!Object.prototype.hasOwnProperty.call(proto, 'encodeQueueSize')) {
      Object.defineProperty(proto, 'encodeQueueSize', {
        get: _markNativeAs(function encodeQueueSize() { return 0; },
          'function get encodeQueueSize() { [native code] }'),
        set: undefined, enumerable: true, configurable: true,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(proto, 'ondequeue')) {
      Object.defineProperty(proto, 'ondequeue', {
        get: function ondequeue() { return this._ondequeue || null; },
        set: function ondequeue(value) { this._ondequeue = value; },
        enumerable: true, configurable: true,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(proto, 'state')) {
      Object.defineProperty(proto, 'state', {
        get: _markNativeAs(function state() { return _stateString(_stateOf(this)); },
          'function get state() { [native code] }'),
        set: undefined, enumerable: true, configurable: true,
      });
    }
    if (typeof proto.close !== 'function') {
      Object.defineProperty(proto, 'close', {
        value: _markNative(function close() {
          const state = _stateOf(this);
          state.closed = true;
          state.configured = false;
        }),
        writable: true, enumerable: true, configurable: true,
      });
    }
    if (typeof proto.configure !== 'function') {
      Object.defineProperty(proto, 'configure', {
        value: _markNative(function configure(config) {
          if (config == null || typeof config !== 'object') {
            throw new TypeError(
              `Failed to execute 'configure' on '${name}': The provided value is not of type '${name}Config'.`);
          }
          const state = _stateOf(this);
          state.configured = true;
          state.closed = false;
        }),
        writable: true, enumerable: true, configurable: true,
      });
    }
    if (typeof proto.encode !== 'function') {
      Object.defineProperty(proto, 'encode', {
        value: _markNative(function encode() {
          const state = _stateOf(this);
          if (state.closed || !state.configured) {
            throw new DOMException(
              `Failed to execute 'encode' on '${name}': ${state.closed ? 'closed' : 'unconfigured'}.`,
              'InvalidStateError');
          }
        }),
        writable: true, enumerable: true, configurable: true,
      });
    }
    if (typeof proto.flush !== 'function') {
      Object.defineProperty(proto, 'flush', {
        value: _markNative(function flush() {
          const state = _stateOf(this);
          if (state.closed || !state.configured) {
            return Promise.reject(new DOMException(
              `Failed to execute 'flush' on '${name}': ${state.closed ? 'closed' : 'unconfigured'}.`,
              'InvalidStateError'));
          }
          return Promise.resolve([]);
        }),
        writable: true, enumerable: true, configurable: true,
      });
    }
    if (typeof proto.reset !== 'function') {
      Object.defineProperty(proto, 'reset', {
        value: _markNative(function reset() {
          const state = _stateOf(this);
          state.configured = false;
          state.closed = false;
        }),
        writable: true, enumerable: true, configurable: true,
      });
    }

    if (typeof ctor.isConfigSupported !== 'function') {
      Object.defineProperty(ctor, 'isConfigSupported', {
        value: _markNative(function isConfigSupported(config) {
          if (config == null || typeof config !== 'object') {
            return Promise.reject(new TypeError(
              `Failed to execute 'isConfigSupported' on '${name}': The provided value is not of type '${name}Config'.`));
          }
          // The pinned reference build ships no codec backend: every config
          // resolves unsupported, echoing the configuration back.
          const echoed = {};
          for (const key of Object.keys(config)) echoed[key] = config[key];
          return Promise.resolve({ supported: false, config: echoed });
        }),
        writable: true, enumerable: true, configurable: true,
      });
    }

    // Chrome's prototype lists encodeQueueSize, ondequeue, state, then the
    // operations, with constructor last -- re-slot the shell's constructor
    // after every member so reflection reads the reference order.
    const shellCtor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (shellCtor && shellCtor.configurable) {
      delete proto.constructor;
      Object.defineProperty(proto, 'constructor', shellCtor);
    }
  }
})();
