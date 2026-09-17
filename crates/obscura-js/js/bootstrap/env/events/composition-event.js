globalThis.CompositionEvent = class CompositionEvent extends Event {
  constructor(t,o={}) { super(t,o);_uiEventState.set(this,{view:o.view||null,detail:Number(o.detail)||0});this.data=o.data||""; }
  // Legacy DOM Level 3 initializer. Positional signature per UI Events spec.
  initCompositionEvent(type,canBubble,cancelable,view,data) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initCompositionEvent' on 'CompositionEvent': 1 argument required, but only 0 present.");
    _eventInit(this,type,canBubble,cancelable,false);
    _uiEventState.set(this,{view:view===undefined?null:view,detail:0});
    this.data=data===undefined?"":String(data);
  }
};
try {
  Object.setPrototypeOf(CompositionEvent.prototype, UIEvent.prototype);
  Object.setPrototypeOf(CompositionEvent, UIEvent);
} catch (_error) {}
