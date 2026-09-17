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
globalThis.Subscriber = Subscriber;
