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
  });
const _trustedEvents = _eventInternalStateRegistry.trusted;
const _eventSourceCapabilities = _eventInternalStateRegistry.sourceCapabilities;
const _eventState = _eventInternalStateRegistry.events;
const _uiEventState = _eventInternalStateRegistry.uiEvents;
const _mouseEventState = _eventInternalStateRegistry.mouseEvents;
const _pointerEventState = _eventInternalStateRegistry.pointerEvents;

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
