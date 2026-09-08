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
