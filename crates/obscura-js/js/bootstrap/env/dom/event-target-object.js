class EventTarget {
  addEventListener(type, callback, options = undefined) {
    _eventTargetAdd(this, type, callback, options);
  }
  dispatchEvent(event) {
    return _eventTargetDispatch(this, event);
  }
  removeEventListener(type, callback, options = undefined) {
    _eventTargetRemove(this, type, callback, options);
  }
}

// Observable API. The Step 340 reading this file used to rely on ("Chrome 151
// has no EventTarget.prototype.when") is expired: a local Chrome 153 window
// owns `when` on EventTarget.prototype -- after removeEventListener, before
// constructor, length 1, native-code toString -- and the 0926 reference census
// reports when/d.when/s.when/so.when on the same four prefixes this engine
// exposes through the same chain. `when(type, options)` returns an Observable
// whose subscription registers the listener through the same registry
// addEventListener uses, and unsubscribes through the subscriber teardown when
// the subscription ends (an aborted signal or a completed subscriber).
//
// Defined with an explicit descriptor rather than a class method: Chrome's
// member is enumerable, and a class body would put it there non-enumerable.
Object.defineProperty(EventTarget.prototype, 'when', {
  value: _markNativeAs(function when(type, options = undefined) {
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'when' on 'EventTarget': 1 argument required, but only 0 present.");
    }
    const target = this;
    const eventType = String(type);
    return new Observable(subscriber => {
      const listener = event => subscriber.next(event);
      _eventTargetAdd(target, eventType, listener, options);
      subscriber.addTeardown(
        () => _eventTargetRemove(target, eventType, listener, options));
    });
  }, 'function when() { [native code] }'),
  writable: true, enumerable: true, configurable: true,
});

