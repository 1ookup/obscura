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
class Subscriber {
  constructor(key = undefined, observer, externalSignal) {
    if (key !== _subscriberKey) {
      throw new TypeError("Failed to construct 'Subscriber': Illegal constructor");
    }
    const controller = new AbortController();
    const state = { observer, controller, active: true, teardowns: [] };
    _subscriberState.set(this, state);
    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
      if (externalSignal.aborted) {
        state.active = false;
        try { controller.abort(externalSignal.reason); } catch (_error) {}
      } else {
        const abort = () => _subscriberClose(this, 'complete');
        externalSignal.addEventListener('abort', abort, { once: true });
        state.teardowns.push(() => externalSignal.removeEventListener('abort', abort));
      }
    }
  }
  get active() { return _subscriberData(this).active; }
  get signal() { return _subscriberData(this).controller.signal; }
  next(value) {
    const state = _subscriberData(this);
    if (!state.active) return;
    const callback = state.observer.next;
    if (typeof callback === 'function') {
      try { callback.call(state.observer, value); }
      catch (error) { this.error(error); }
    }
  }
  error(error) { _subscriberClose(this, 'error', error); }
  complete() { _subscriberClose(this, 'complete'); }
  addTeardown(teardown) {
    const state = _subscriberData(this);
    if (typeof teardown !== 'function') return;
    if (!state.active) { teardown(); return; }
    state.teardowns.push(teardown);
  }
  get [Symbol.toStringTag]() { return 'Subscriber'; }
}
class Observable {
  constructor(callback) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to construct 'Observable': 1 argument required, but only 0 present.");
    }
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to construct 'Observable': parameter 1 is not a function.");
    }
    _observableState.set(this, callback);
  }
  subscribe(observer = {}, options = undefined) {
    const callback = _observableData(this);
    const normalized = typeof observer === 'function' ? { next: observer } : (observer || {});
    const signal = options && typeof options === 'object' ? options.signal : null;
    const subscriber = new Subscriber(_subscriberKey, normalized, signal);
    if (!subscriber.active) return;
    try {
      const teardown = callback(subscriber);
      if (typeof teardown === 'function') subscriber.addTeardown(teardown);
    } catch (error) {
      subscriber.error(error);
    }
  }
  map(callback) {
    const source = this;
    if (typeof callback !== 'function') throw new TypeError('callback must be callable');
    return new Observable(subscriber => {
      let index = 0;
      source.subscribe({
        next(value) { try { subscriber.next(callback(value, index++)); } catch (error) { subscriber.error(error); } },
        error(error) { subscriber.error(error); },
        complete() { subscriber.complete(); },
      }, { signal: subscriber.signal });
    });
  }
  filter(callback) {
    const source = this;
    if (typeof callback !== 'function') throw new TypeError('callback must be callable');
    return new Observable(subscriber => {
      let index = 0;
      source.subscribe({
        next(value) { try { if (callback(value, index++)) subscriber.next(value); } catch (error) { subscriber.error(error); } },
        error(error) { subscriber.error(error); },
        complete() { subscriber.complete(); },
      }, { signal: subscriber.signal });
    });
  }
  take(count) {
    const source = this;
    count = Math.max(0, Math.trunc(Number(count)) || 0);
    return new Observable(subscriber => {
      if (count === 0) { subscriber.complete(); return; }
      let seen = 0;
      source.subscribe({
        next(value) { if (++seen <= count) subscriber.next(value); if (seen >= count) subscriber.complete(); },
        error(error) { subscriber.error(error); }, complete() { subscriber.complete(); },
      }, { signal: subscriber.signal });
    });
  }
  drop(count) {
    const source = this;
    count = Math.max(0, Math.trunc(Number(count)) || 0);
    return new Observable(subscriber => {
      let seen = 0;
      source.subscribe({
        next(value) { if (seen++ >= count) subscriber.next(value); },
        error(error) { subscriber.error(error); }, complete() { subscriber.complete(); },
      }, { signal: subscriber.signal });
    });
  }
  inspect(observer = {}) {
    const source = this;
    const tap = typeof observer === 'function' ? { next: observer } : (observer || {});
    return new Observable(subscriber => source.subscribe({
      next(value) { try { tap.next?.(value); subscriber.next(value); } catch (error) { subscriber.error(error); } },
      error(error) { try { tap.error?.(error); } finally { subscriber.error(error); } },
      complete() { try { tap.complete?.(); } finally { subscriber.complete(); } },
    }, { signal: subscriber.signal }));
  }
  finally(callback) {
    const source = this;
    if (typeof callback !== 'function') throw new TypeError('callback must be callable');
    return new Observable(subscriber => {
      subscriber.addTeardown(callback);
      source.subscribe({
        next(value) { subscriber.next(value); }, error(error) { subscriber.error(error); },
        complete() { subscriber.complete(); },
      }, { signal: subscriber.signal });
    });
  }
  catch(callback) {
    const source = this;
    if (typeof callback !== 'function') throw new TypeError('callback must be callable');
    return new Observable(subscriber => source.subscribe({
      next(value) { subscriber.next(value); },
      error(error) {
        let replacement;
        try { replacement = callback(error); } catch (caught) { subscriber.error(caught); return; }
        if (replacement instanceof Observable) {
          replacement.subscribe(subscriber, { signal: subscriber.signal });
        } else subscriber.complete();
      },
      complete() { subscriber.complete(); },
    }, { signal: subscriber.signal }));
  }
  flatMap(callback) {
    const source = this;
    if (typeof callback !== 'function') throw new TypeError('callback must be callable');
    return new Observable(subscriber => {
      let index = 0, active = 1;
      const done = () => { if (--active === 0) subscriber.complete(); };
      source.subscribe({
        next(value) {
          let inner;
          try { inner = callback(value, index++); } catch (error) { subscriber.error(error); return; }
          if (!(inner instanceof Observable)) { subscriber.error(new TypeError('callback must return an Observable')); return; }
          active++;
          inner.subscribe({ next(value) { subscriber.next(value); }, error(error) { subscriber.error(error); }, complete: done }, { signal: subscriber.signal });
        },
        error(error) { subscriber.error(error); }, complete: done,
      }, { signal: subscriber.signal });
    });
  }
  switchMap(callback) {
    const source = this;
    if (typeof callback !== 'function') throw new TypeError('callback must be callable');
    return new Observable(subscriber => {
      let index = 0, innerController = null, sourceDone = false, innerActive = false;
      const maybeComplete = () => { if (sourceDone && !innerActive) subscriber.complete(); };
      subscriber.addTeardown(() => innerController?.abort());
      source.subscribe({
        next(value) {
          innerController?.abort();
          let inner;
          try { inner = callback(value, index++); } catch (error) { subscriber.error(error); return; }
          if (!(inner instanceof Observable)) { subscriber.error(new TypeError('callback must return an Observable')); return; }
          innerController = new AbortController(); innerActive = true;
          subscriber.signal.addEventListener('abort', () => innerController.abort(), { once: true });
          inner.subscribe({ next(value) { subscriber.next(value); }, error(error) { subscriber.error(error); },
            complete() { innerActive = false; maybeComplete(); } }, { signal: innerController.signal });
        },
        error(error) { subscriber.error(error); }, complete() { sourceDone = true; maybeComplete(); },
      }, { signal: subscriber.signal });
    });
  }
  takeUntil(notifier) {
    const source = this;
    if (!(notifier instanceof Observable)) throw new TypeError('parameter 1 is not an Observable');
    return new Observable(subscriber => {
      notifier.subscribe({ next() { subscriber.complete(); }, error(error) { subscriber.error(error); } }, { signal: subscriber.signal });
      if (subscriber.active) source.subscribe({
        next(value) { subscriber.next(value); }, error(error) { subscriber.error(error); }, complete() { subscriber.complete(); },
      }, { signal: subscriber.signal });
    });
  }
  forEach(callback) {
    const source = this;
    if (typeof callback !== 'function') return Promise.reject(new TypeError('callback must be callable'));
    return new Promise((resolve, reject) => {
      let index = 0;
      source.subscribe({ next(value) { try { callback(value, index++); } catch (error) { reject(error); } }, error: reject, complete: resolve });
    });
  }
  toArray() {
    const source = this;
    return new Promise((resolve, reject) => {
      const values = [];
      source.subscribe({ next(value) { values.push(value); }, error: reject, complete() { resolve(values); } });
    });
  }
  first() {
    const source = this;
    return new Promise((resolve, reject) => {
      let found = false;
      source.subscribe({ next(value) { if (!found) { found = true; resolve(value); } }, error: reject,
        complete() { if (!found) reject(new RangeError('No values in Observable')); } });
    });
  }
  last() {
    const source = this;
    return new Promise((resolve, reject) => {
      let found = false, last;
      source.subscribe({ next(value) { found = true; last = value; }, error: reject,
        complete() { found ? resolve(last) : reject(new RangeError('No values in Observable')); } });
    });
  }
  find(callback) {
    const source = this;
    if (typeof callback !== 'function') return Promise.reject(new TypeError('callback must be callable'));
    return new Promise((resolve, reject) => {
      let index = 0, found = false;
      source.subscribe({ next(value) { try { if (!found && callback(value, index++)) { found = true; resolve(value); } } catch (error) { reject(error); } },
        error: reject, complete() { if (!found) resolve(undefined); } });
    });
  }
  every(callback) {
    const source = this;
    if (typeof callback !== 'function') return Promise.reject(new TypeError('callback must be callable'));
    return new Promise((resolve, reject) => {
      let index = 0, result = true;
      source.subscribe({ next(value) { try { if (!callback(value, index++)) result = false; } catch (error) { reject(error); } },
        error: reject, complete() { resolve(result); } });
    });
  }
  some(callback) {
    const source = this;
    if (typeof callback !== 'function') return Promise.reject(new TypeError('callback must be callable'));
    return new Promise((resolve, reject) => {
      let index = 0, result = false;
      source.subscribe({ next(value) { try { if (callback(value, index++)) result = true; } catch (error) { reject(error); } },
        error: reject, complete() { resolve(result); } });
    });
  }
  reduce(callback, initialValue = undefined) {
    const source = this;
    if (typeof callback !== 'function') return Promise.reject(new TypeError('callback must be callable'));
    const hasInitial = arguments.length > 1;
    return new Promise((resolve, reject) => {
      let index = 0, hasValue = hasInitial, accumulator = initialValue;
      source.subscribe({
        next(value) {
          if (!hasValue) { accumulator = value; hasValue = true; return; }
          try { accumulator = callback(accumulator, value, index++); } catch (error) { reject(error); }
        },
        error: reject,
        complete() { hasValue ? resolve(accumulator) : reject(new TypeError('Reduce of empty Observable with no initial value')); },
      });
    });
  }
  get [Symbol.toStringTag]() { return 'Observable'; }
}
globalThis.Observable = Observable;
globalThis.Subscriber = Subscriber;

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

