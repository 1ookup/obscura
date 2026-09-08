// Observable is the event-stream primitive behind EventTarget.when(). It is
// cold: each subscription runs the producer independently and cancellation is
// carried by Subscriber.signal.
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


function _eventTargetWhen(type, options = undefined, argumentCount = 2) {
  const target = this;
  if (!target || typeof target.addEventListener !== 'function'
      || typeof target.removeEventListener !== 'function'
      || typeof target.dispatchEvent !== 'function') {
    throw new TypeError('Illegal invocation');
  }
  if (argumentCount < 1) {
    throw new TypeError(
      "Failed to execute 'when' on 'EventTarget': 1 argument required, but only 0 present.");
  }
  type = String(type);
  const listenerOptions = options && typeof options === 'object' ? options : {};
  return new Observable(subscriber => {
    const listener = event => subscriber.next(event);
    const registration = {
      capture: !!listenerOptions.capture,
      passive: !!listenerOptions.passive,
      signal: subscriber.signal,
    };
    target.addEventListener(type, listener, registration);
    subscriber.addTeardown(() => target.removeEventListener(type, listener, registration.capture));
    if (listenerOptions.signal && typeof listenerOptions.signal.addEventListener === 'function') {
      if (listenerOptions.signal.aborted) subscriber.complete();
      else listenerOptions.signal.addEventListener('abort', () => subscriber.complete(), { once: true });
    }
  });
}
