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
  // No `when`: Chrome 151 (the identity the fingerprint claims; Step 340
  // oracle) has no EventTarget.prototype.when -- Observable/when shipped
  // later -- and the own-name enumeration of EventTarget.prototype is a
  // first-class fingerprint surface. The global Observable stays; only the
  // prototype method a 151 does not publish is absent.
}
