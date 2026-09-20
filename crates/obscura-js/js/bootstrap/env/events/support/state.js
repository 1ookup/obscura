// Shared event state and WebIDL helpers.
//
// Event constructors are kept in one-file-per-interface modules.  Their
// private state still has to be shared across the inheritance chain and across
// the Rust/CDP input bridge, so the registry lives in this support module.
// The registry is stored on Deno rather than in a page-visible global: frame
// bootstrap can be evaluated more than once while wrappers remain isolated.
const _eventInternalStateRegistrySym = Symbol.for('obscura.eventStateRegistry');
const _eventInternalStateRegistry = Deno[_eventInternalStateRegistrySym]
  || (Deno[_eventInternalStateRegistrySym] = {
    trusted: new WeakSet(), sourceCapabilities: new WeakMap(),
    events: new WeakMap(), uiEvents: new WeakMap(),
    mouseEvents: new WeakMap(), pointerEvents: new WeakMap(),
    inits: new WeakMap(),
  });
// Snapshot template realms (batch 21) evaluated the bootstrap with the
// snapshot build's registry, while the live registry rides on the runtime's
// rebound Deno binding. Event objects cross realms (postMessage source,
// cross-frame dispatch, the input bridge), so these views resolve the live
// registry at each access when it differs from the captured one. Realms that
// share one registry (main, execute-bootstrap frames, workers) keep direct
// references and today's fast path.
function _liveEventRegistry() {
  const runtime = Deno[_eventInternalStateRegistrySym];
  return runtime && runtime !== _eventInternalStateRegistry ? runtime : null;
}
const _forwardEventState = (key) => {
  const own = _eventInternalStateRegistry[key];
  return {
    get(k) { const r = _liveEventRegistry(); return r ? r[key].get(k) : own.get(k); },
    set(k, v) { const r = _liveEventRegistry(); (r ? r[key] : own).set(k, v); return v; },
    has(k) { const r = _liveEventRegistry(); return r ? r[key].has(k) : own.has(k); },
    add(k) { const r = _liveEventRegistry(); (r ? r[key] : own).add(k); return this; },
    delete(k) { const r = _liveEventRegistry(); return r ? r[key].delete(k) : own.delete(k); },
  };
};
const _trustedEvents = _forwardEventState('trusted');
const _eventSourceCapabilities = _forwardEventState('sourceCapabilities');
const _eventState = _forwardEventState('events');
const _uiEventState = _forwardEventState('uiEvents');
const _mouseEventState = _forwardEventState('mouseEvents');
const _pointerEventState = _forwardEventState('pointerEvents');
const _eventInitState = _forwardEventState('inits');

// Chrome keeps the per-interface init members (CustomEvent.detail,
// MessageEvent.data, ErrorEvent.message, ...) as enumerable accessors on the
// interface prototype; instances carry no own properties, so
// JSON.stringify(event) answers {"isTrusted":false} and Object.keys lists
// nothing beyond page-added fields (oracle). Own fields here were a
// fingerprint surface. _eventInitSlots installs the Chrome-shaped prototype
// accessors; constructor code keeps assigning through `this.<name> =`, which
// the setter routes into the realm-shared registry.
function _eventInitSlots(impl, props) {
  for (const [name, fallback] of props) {
    Object.defineProperty(impl.prototype, name, {
      get() {
        const v = _eventInitState.get(this);
        if (v && v.has(name)) { return v.get(name); }
        return typeof fallback === 'function' ? fallback() : fallback;
      },
      set(v) {
        let m = _eventInitState.get(this);
        if (!m) { m = new Map(); _eventInitState.set(this, m); }
        m.set(name, v);
      },
      enumerable: true, configurable: true,
    });
  }
}

function _eventTimeStamp() {
  try {
    const now = globalThis.performance && globalThis.performance.now;
    if (typeof now === 'function') return globalThis.performance.now();
  } catch (_error) {}
  return 0;
}

function _eventData(value) {
  const state = _eventState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}

function _eventInit(value, type, bubbles, cancelable, composed = false) {
  const state = _eventData(value);
  state.type = String(type);
  state.bubbles = !!bubbles;
  state.cancelable = !!cancelable;
  state.composed = !!composed;
  state.defaultPrevented = false;
  state.propagationStopped = false;
  state.immediatePropagationStopped = false;
}

function _eventSetEndpoints(value, target, currentTarget) {
  const state = _eventData(value);
  state.target = target;
  state.currentTarget = currentTarget;
}

const _eventIsTrusted = function isTrusted() {
  return _trustedEvents.has(this);
};
Object.defineProperty(_eventIsTrusted, 'name', {
  value: 'get isTrusted', configurable: true,
});
_markNativeAs(_eventIsTrusted, 'function get isTrusted() { [native code] }');
