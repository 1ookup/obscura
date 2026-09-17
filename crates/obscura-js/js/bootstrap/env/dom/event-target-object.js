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
  when(type, options = undefined) {
    return _eventTargetWhen.call(this, type, options, arguments.length);
  }
}
