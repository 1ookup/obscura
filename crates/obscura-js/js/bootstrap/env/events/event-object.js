globalThis.Event = class Event {
  constructor(t,o={}) {
    if (arguments.length < 1) throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.");
    _eventState.set(this, { type:String(t), bubbles:!!o.bubbles,
      cancelable:!!o.cancelable, composed:!!o.composed, defaultPrevented:false,
      target:null, currentTarget:null, eventPhase:0, timeStamp:_eventTimeStamp(),
      propagationStopped:false, immediatePropagationStopped:false,
      dispatching:false, path:null, pathCurrentIndex:-1,
      originalRelatedTarget:undefined });
    Object.defineProperty(this, 'isTrusted', { get:_eventIsTrusted, enumerable:true });
  }
  get type() { return _eventData(this).type; }
  get target() { return _eventData(this).target; }
  get currentTarget() { return _eventData(this).currentTarget; }
  get eventPhase() { return _eventData(this).eventPhase; }
  get bubbles() { return _eventData(this).bubbles; }
  get cancelable() { return _eventData(this).cancelable; }
  get defaultPrevented() { return _eventData(this).defaultPrevented; }
  get composed() { return _eventData(this).composed; }
  get timeStamp() { return _eventData(this).timeStamp; }
  get srcElement() { return _eventData(this).target; }
  get returnValue() { return !_eventData(this).defaultPrevented; }
  set returnValue(value) { if (!value) this.preventDefault(); }
  get cancelBubble() { return _eventData(this).propagationStopped; }
  set cancelBubble(value) { if (value) _eventData(this).propagationStopped = true; }
  get NONE() { return 0; }
  get CAPTURING_PHASE() { return 1; }
  get AT_TARGET() { return 2; }
  get BUBBLING_PHASE() { return 3; }
  composedPath() {
    const state = _eventData(this);
    const tuples = state.path;
    const currentIndex = state.pathCurrentIndex;
    if (!tuples || currentIndex < 0) return [];
    return tuples.filter((tuple, index) => {
      for (let i = index; i < tuples.length; i++) {
        const boundary = tuples[i].invocationTarget;
        if (boundary instanceof ShadowRoot && boundary.mode === 'closed' && currentIndex > i) {
          return false;
        }
      }
      return true;
    }).map(tuple => tuple.invocationTarget);
  }
  initEvent(type,bubbles,cancelable) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initEvent' on 'Event': 1 argument required, but only 0 present.");
    _eventInit(this, type, bubbles, cancelable, false);
  }
  preventDefault() { const state=_eventData(this); if(state.cancelable) state.defaultPrevented=true; }
  stopImmediatePropagation() { const state=_eventData(this); state.propagationStopped=true; state.immediatePropagationStopped=true; }
  stopPropagation() { _eventData(this).propagationStopped=true; }
};
{
  const descriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'constructor');
  delete Event.prototype.constructor;
  Object.defineProperty(Event.prototype, 'constructor', descriptor);
}
_markNative(Event);
