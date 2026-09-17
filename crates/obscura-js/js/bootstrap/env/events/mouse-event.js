function _mouseEventData(value) {
  const state = _mouseEventState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _mouseEventSetRelatedTarget(value, relatedTarget) {
  const state = _mouseEventState.get(value);
  if (state) state.relatedTarget = relatedTarget;
  else { try { value.relatedTarget = relatedTarget; } catch (_error) {} }
}
function _mouseEventOffset(value) {
  const state = _mouseEventData(value);
  const target = _eventData(value).target;
  if (!target || typeof target.getBoundingClientRect !== 'function') return [0, 0];
  try {
    const rect = target.getBoundingClientRect();
    // Chromium exposes offset coordinates as integer CSS pixels (rounding
    // fractional layout positions), while layer coordinates retain the
    // lower pixel boundary. Keep the raw relation available to the layer
    // getter below so the two standard views do not collapse to 7.5/7.5.
    return [Math.round(state.clientX - rect.left), Math.round(state.clientY - rect.top)];
  } catch (_error) { return [0, 0]; }
}
function _mouseEventLayer(value) {
  const state = _mouseEventData(value);
  const target = _eventData(value).target;
  if (!target || typeof target.getBoundingClientRect !== 'function') return [0, 0];
  try {
    const rect = target.getBoundingClientRect();
    return [Math.floor(state.clientX - rect.left), Math.floor(state.clientY - rect.top)];
  } catch (_error) { return [0, 0]; }
}
globalThis.MouseEvent = class MouseEvent extends Event {
  constructor(t,o={}) {
    super(t,o);
    _uiEventState.set(this, { view:o.view||null, detail:Number(o.detail)||0 });
    _mouseEventState.set(this, { screenX:Number(o.screenX)||0,
      screenY:Number(o.screenY)||0, clientX:Number(o.clientX)||0,
      clientY:Number(o.clientY)||0, ctrlKey:!!o.ctrlKey,
      shiftKey:!!o.shiftKey, altKey:!!o.altKey, metaKey:!!o.metaKey,
      button:Number(o.button)||0, buttons:Number(o.buttons)||0,
      relatedTarget:o.relatedTarget||null, movementX:Number(o.movementX)||0,
      movementY:Number(o.movementY)||0 });
  }
  get screenX() { return _mouseEventData(this).screenX; }
  get screenY() { return _mouseEventData(this).screenY; }
  get clientX() { return _mouseEventData(this).clientX; }
  get clientY() { return _mouseEventData(this).clientY; }
  get ctrlKey() { return _mouseEventData(this).ctrlKey; }
  get shiftKey() { return _mouseEventData(this).shiftKey; }
  get altKey() { return _mouseEventData(this).altKey; }
  get metaKey() { return _mouseEventData(this).metaKey; }
  get button() { return _mouseEventData(this).button; }
  get buttons() { return _mouseEventData(this).buttons; }
  get relatedTarget() { return _mouseEventData(this).relatedTarget; }
  get pageX() { return this.clientX + (Number(globalThis.scrollX)||0); }
  get pageY() { return this.clientY + (Number(globalThis.scrollY)||0); }
  get x() { return this.clientX; }
  get y() { return this.clientY; }
  get offsetX() { return _mouseEventOffset(this)[0]; }
  get offsetY() { return _mouseEventOffset(this)[1]; }
  get movementX() { return _mouseEventData(this).movementX; }
  get movementY() { return _mouseEventData(this).movementY; }
  get fromElement() { return this.type==='mouseover' ? this.relatedTarget : this.target; }
  get toElement() { return this.type==='mouseout' ? this.relatedTarget : this.target; }
  get layerX() { return _mouseEventLayer(this)[0]; }
  get layerY() { return _mouseEventLayer(this)[1]; }
  getModifierState(key) { return !!({Alt:this.altKey,AltGraph:false,
    Control:this.ctrlKey,Meta:this.metaKey,Shift:this.shiftKey}[String(key)]); }
  // Legacy DOM Level 2 initializer. Positional signature per UI Events spec.
  initMouseEvent(type,canBubble,cancelable,view,detail,screenX,screenY,clientX,clientY,ctrlKey,altKey,shiftKey,metaKey,button,relatedTarget) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initMouseEvent' on 'MouseEvent': 1 argument required, but only 0 present.");
    _eventInit(this,type,canBubble,cancelable,false);
    _uiEventState.set(this,{view:view===undefined?null:view,detail:detail||0});
    _mouseEventState.set(this,{screenX:screenX||0,screenY:screenY||0,
      clientX:clientX||0,clientY:clientY||0,ctrlKey:!!ctrlKey,
      shiftKey:!!shiftKey,altKey:!!altKey,metaKey:!!metaKey,
      button:button||0,buttons:0,
      relatedTarget:relatedTarget===undefined?null:relatedTarget,
      movementX:0,movementY:0});
  }
};
{
  const descriptor=Object.getOwnPropertyDescriptor(MouseEvent.prototype,'constructor');
  delete MouseEvent.prototype.constructor;
  Object.defineProperty(MouseEvent.prototype,'constructor',descriptor);
}
