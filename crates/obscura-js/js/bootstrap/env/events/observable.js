// Observable is the event-stream primitive (global constructor + Subscriber).
// It is cold: each subscription runs the producer independently and
// cancellation is carried by Subscriber.signal. There is deliberately no
// EventTarget.prototype.when: Chrome 151 has none (Step 340 oracle).
const _observableState = new WeakMap();
const _subscriberState = new WeakMap();
const _subscriberKey = Symbol('Subscriber');
function _observableData(value) {
  const state = _observableState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _subscriberData(value) {
  const state = _subscriberState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _subscriberClose(subscriber, kind, value) {
  const state = _subscriberData(subscriber);
  if (!state.active) return;
  state.active = false;
  const callback = state.observer[kind];
  if (typeof callback === 'function') {
    try { callback.call(state.observer, value); }
    catch (error) { if (typeof reportError === 'function') reportError(error); }
  }
  try { state.controller.abort(value); } catch (_error) {}
  const teardowns = state.teardowns.splice(0);
  for (const teardown of teardowns) {
    try { teardown(); } catch (error) {
      if (typeof reportError === 'function') reportError(error);
    }
  }
}
