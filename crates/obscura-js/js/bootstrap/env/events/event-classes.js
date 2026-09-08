// Every interface below is a *named* class expression on purpose. An anonymous
// one leaves `.name` as "" and `Ctor.toString()` as "function () { [native
// code] }" where a real engine prints the name; worse, V8 derives a receiver's
// constructor name from it, so every instance introspects as a plain "Object"
// -- the property-lookup trace of a Cloudflare challenge labelled all of its
// MessageEvent reads "Object.*" for exactly this reason.
// `Event.timeStamp` is a DOMHighResTimeStamp measured from the time origin,
// not a Unix epoch value. Handing out `Date.now()` here made every event carry
// a ~1.7e12 stamp where a browser reports a few thousand -- a one-line tell.
function _eventTimeStamp() {
  try {
    const now = globalThis.performance && globalThis.performance.now;
    if (typeof now === "function") return globalThis.performance.now();
  } catch (e) {}
  return 0;
}
const _eventState = _eventInternalStateRegistry.events;
const _uiEventState = _eventInternalStateRegistry.uiEvents;
const _mouseEventState = _eventInternalStateRegistry.mouseEvents;
const _pointerEventState = _eventInternalStateRegistry.pointerEvents;
function _eventData(value) {
  const state = _eventState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _eventInit(value, type, bubbles, cancelable, composed = false) {
  const state = _eventData(value);
  state.type = String(type); state.bubbles = !!bubbles;
  state.cancelable = !!cancelable; state.composed = !!composed;
  state.defaultPrevented = false; state.propagationStopped = false;
  state.immediatePropagationStopped = false;
}
function _eventSetEndpoints(value, target, currentTarget) {
  const state = _eventData(value);
  state.target = target; state.currentTarget = currentTarget;
}
const _eventIsTrusted = function isTrusted() {
  return _trustedEvents.has(this);
};
Object.defineProperty(_eventIsTrusted, 'name', { value:'get isTrusted', configurable:true });
_markNativeAs(_eventIsTrusted, 'function get isTrusted() { [native code] }');
// Chrome surfaces the physical device behind trusted input events through
// Event.sourceCapabilities. The class itself is a window global there, so its
// absence is a detectable difference; flags live in a WeakMap so instances
// introspect with no own keys, like the C++-backed originals.
