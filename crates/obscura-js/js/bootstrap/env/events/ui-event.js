globalThis.UIEvent = class UIEvent extends Event {
  constructor(t,o={}) { super(t,o);_uiEventState.set(this,{view:o.view||null,detail:Number(o.detail)||0}); }
  get view(){return _uiEventState.get(this)?.view??null;}
  get detail(){return _uiEventState.get(this)?.detail??0;}
  get sourceCapabilities(){return _eventSourceCapabilities.has(this)?_eventSourceCapabilities.get(this):null;}
  get which(){return 0;}
  // Legacy DOM Level 2 initializer. Positional signature per UI Events spec.
  initUIEvent(type,canBubble,cancelable,view,detail) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initUIEvent' on 'UIEvent': 1 argument required, but only 0 present.");
    _eventInit(this,type,canBubble,cancelable,false);
    _uiEventState.set(this,{view:view===undefined?null:view,detail:detail||0});
  }
};
for (const ctor of [MouseEvent, KeyboardEvent, FocusEvent, InputEvent]) {
  try {
    Object.setPrototypeOf(ctor.prototype, UIEvent.prototype);
    Object.setPrototypeOf(ctor, UIEvent);
  } catch (_error) {}
}
