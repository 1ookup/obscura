// Every interface below is a *named* class expression on purpose. An anonymous
// one leaves `.name` as "" and `Ctor.toString()` as "function () { [native
// code] }" where a real engine prints the name; worse, V8 derives a receiver's
// constructor name from it, so every instance introspects as a plain "Object"
// -- the property-lookup trace of a Cloudflare challenge labelled all of its
// MessageEvent reads "Object.*" for exactly this reason.
// `Event.timeStamp` is a DOMHighResTimeStamp measured from the time origin,
// not a Unix epoch value. Handing out `Date.now()` here made every event carry
// a ~1.7e12 stamp where a browser reports a few thousand -- a one-line tell.
function _eventTimeStamp() {
  try {
    const now = globalThis.performance && globalThis.performance.now;
    if (typeof now === "function") return globalThis.performance.now();
  } catch (e) {}
  return 0;
}
const _eventState = _eventInternalStateRegistry.events;
const _uiEventState = _eventInternalStateRegistry.uiEvents;
const _mouseEventState = _eventInternalStateRegistry.mouseEvents;
const _pointerEventState = _eventInternalStateRegistry.pointerEvents;
function _eventData(value) {
  const state = _eventState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}
function _eventInit(value, type, bubbles, cancelable, composed = false) {
  const state = _eventData(value);
  state.type = String(type); state.bubbles = !!bubbles;
  state.cancelable = !!cancelable; state.composed = !!composed;
  state.defaultPrevented = false; state.propagationStopped = false;
  state.immediatePropagationStopped = false;
}
function _eventSetEndpoints(value, target, currentTarget) {
  const state = _eventData(value);
  state.target = target; state.currentTarget = currentTarget;
}
const _eventIsTrusted = function isTrusted() {
  return _trustedEvents.has(this);
};
Object.defineProperty(_eventIsTrusted, 'name', { value:'get isTrusted', configurable:true });
_markNativeAs(_eventIsTrusted, 'function get isTrusted() { [native code] }');
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
// Chrome surfaces the physical device behind trusted input events through
// Event.sourceCapabilities. The class itself is a window global there, so its
// absence is a detectable difference; flags live in a WeakMap so instances
// introspect with no own keys, like the C++-backed originals.
const _inputCapsFlags = new WeakMap();
globalThis.InputDeviceCapabilities = class InputDeviceCapabilities {
  constructor(init) { _inputCapsFlags.set(this, !!(init && init.firesTouchEvents)); }
  get firesTouchEvents() { return _inputCapsFlags.has(this) && _inputCapsFlags.get(this); }
};
_markNative(InputDeviceCapabilities);
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(t,o={}) { if (arguments.length < 1) throw new TypeError("Failed to construct 'CustomEvent': 1 argument required, but only 0 present."); super(t,o);this.detail=o.detail!==undefined?o.detail:null; }
  // Legacy DOM Level 2 init; some libraries (Starbucks China bundle, older
  // analytics shims) still call createEvent('CustomEvent') + initCustomEvent
  // instead of new CustomEvent(...). See issue #41.
  initCustomEvent(type,bubbles,cancelable,detail) {
    _eventInit(this,type,bubbles,cancelable,false);
    this.detail = detail;
  }
};
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
globalThis.KeyboardEvent = class KeyboardEvent extends Event {
  constructor(t,o={}) { super(t,o);_uiEventState.set(this,{view:o.view||null,detail:Number(o.detail)||0});this.key=o.key||"";this.code=o.code||"";this.location=o.location||0;this.ctrlKey=!!o.ctrlKey;this.altKey=!!o.altKey;this.shiftKey=!!o.shiftKey;this.metaKey=!!o.metaKey;this.repeat=!!o.repeat; }
  // Legacy DOM Level 3 initializer. Positional signature per the WebKit/Gecko form.
  initKeyboardEvent(type,canBubble,cancelable,view,key,location,ctrlKey,altKey,shiftKey,metaKey) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initKeyboardEvent' on 'KeyboardEvent': 1 argument required, but only 0 present.");
    _eventInit(this,type,canBubble,cancelable,false);
    _uiEventState.set(this,{view:view===undefined?null:view,detail:0});
    this.key=key===undefined?"":String(key);
    this.location=location||0;
    this.ctrlKey=!!ctrlKey;
    this.altKey=!!altKey;
    this.shiftKey=!!shiftKey;
    this.metaKey=!!metaKey;
  }
};
globalThis.FocusEvent = class FocusEvent extends Event { constructor(t,o={}) { super(t,o);_uiEventState.set(this,{view:o.view||null,detail:Number(o.detail)||0});this.relatedTarget=o.relatedTarget||null; } };
globalThis.InputEvent = class InputEvent extends Event { constructor(t,o={}) { super(t,o);_uiEventState.set(this,{view:o.view||null,detail:Number(o.detail)||0});this.data=o.data||null;this.inputType=o.inputType||""; } };
globalThis.ErrorEvent = class ErrorEvent extends Event { constructor(t,o={}) { super(t,o);this.message=o.message||"";this.error=o.error||null; } };
globalThis.PointerEvent = class PointerEvent extends MouseEvent {
  constructor(t,o={}) {
    super(t,o);
    _pointerEventState.set(this,{pointerId:Number(o.pointerId)||0,
      width:Number(o.width)||1,height:Number(o.height)||1,
      pressure:Number(o.pressure)||0,tiltX:Number(o.tiltX)||0,
      tiltY:Number(o.tiltY)||0,
      azimuthAngle:o.azimuthAngle===undefined?0:Number(o.azimuthAngle),
      altitudeAngle:o.altitudeAngle===undefined?Math.PI/2:Number(o.altitudeAngle),
      tangentialPressure:Number(o.tangentialPressure)||0,
      twist:Number(o.twist)||0,
      pointerType:o.pointerType===undefined?'':String(o.pointerType),
      isPrimary:!!o.isPrimary,persistentDeviceId:Number(o.persistentDeviceId)||0});
  }
  get pointerId(){return _pointerEventState.get(this)?.pointerId??0;}
  get width(){return _pointerEventState.get(this)?.width??1;}
  get height(){return _pointerEventState.get(this)?.height??1;}
  get pressure(){return _pointerEventState.get(this)?.pressure??0;}
  get tiltX(){return _pointerEventState.get(this)?.tiltX??0;}
  get tiltY(){return _pointerEventState.get(this)?.tiltY??0;}
  get azimuthAngle(){return _pointerEventState.get(this)?.azimuthAngle??0;}
  get altitudeAngle(){return _pointerEventState.get(this)?.altitudeAngle??Math.PI/2;}
  get tangentialPressure(){return _pointerEventState.get(this)?.tangentialPressure??0;}
  get twist(){return _pointerEventState.get(this)?.twist??0;}
  get pointerType(){return _pointerEventState.get(this)?.pointerType??'';}
  get isPrimary(){return _pointerEventState.get(this)?.isPrimary??false;}
  getPredictedEvents(){return [];}
  get persistentDeviceId(){return _pointerEventState.get(this)?.persistentDeviceId??0;}
  getCoalescedEvents(){return [];}
};
{
  const ctor=Object.getOwnPropertyDescriptor(PointerEvent.prototype,'constructor');
  const coalesced=Object.getOwnPropertyDescriptor(PointerEvent.prototype,'getCoalescedEvents');
  delete PointerEvent.prototype.constructor;
  delete PointerEvent.prototype.getCoalescedEvents;
  Object.defineProperty(PointerEvent.prototype,'constructor',ctor);
  Object.defineProperty(PointerEvent.prototype,'getCoalescedEvents',coalesced);
}
globalThis.AnimationEvent = class AnimationEvent extends Event {};
globalThis.TransitionEvent = class TransitionEvent extends Event {};
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
// WheelEvent inherits all MouseEvent coordinates and modifier state. CDP
// Input.dispatchMouseEvent supplies those fields and automation libraries use
// them to distinguish wheel gestures over nested panes.
globalThis.WheelEvent = class WheelEvent extends MouseEvent {
  constructor(t,o={}) { super(t,o);this.deltaX=o.deltaX||0;this.deltaY=o.deltaY||0;this.deltaZ=o.deltaZ||0;this.deltaMode=o.deltaMode||0; }
};

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
globalThis.PopStateEvent = class PopStateEvent extends Event {
  constructor(type, init) {
    super(type, init || {});
    // Real PopStateEvent exposes `state` from the entry being navigated to.
    // The earlier stub inherited Event but never stored state, so
    // `popstate.state` was always undefined and SPA routers reading
    // `event.state` to restore route info would mis-render.
    this.state = init && 'state' in init ? init.state : null;
  }
};
globalThis.HashChangeEvent = class HashChangeEvent extends Event {};
globalThis.MessageEvent = class MessageEvent extends Event {
  constructor(t,o={}) {
    super(t,o);
    this.data = Object.prototype.hasOwnProperty.call(o, "data") ? o.data : null;
    this.origin = o.origin == null ? "" : String(o.origin);
    this.lastEventId = o.lastEventId == null ? "" : String(o.lastEventId);
    this.source = o.source == null ? null : o.source;
    // FrozenArray<MessagePort> in the IDL. Relay code that receives an event
    // and appends its own port to `e.ports` must not observe the append
    // sticking, which a plain array would let it do.
    this.ports = Object.freeze(Array.isArray(o.ports) ? o.ports.slice() : []);
  }
};
globalThis.ProgressEvent = class ProgressEvent extends Event {
  constructor(type, init) {
    super(type, init || {});
    const i = init || {};
    this.lengthComputable = !!i.lengthComputable;
    this.loaded = i.loaded != null ? Number(i.loaded) : 0;
    this.total = i.total != null ? Number(i.total) : 0;
  }
};
globalThis.ClipboardEvent = class ClipboardEvent extends Event {};
globalThis.SubmitEvent = class SubmitEvent extends Event {};

// ToggleEvent backs the popover beforetoggle/toggle events. oldState and
// newState are "open"/"closed". These events do not bubble; beforetoggle is
// cancelable only for the closed -> open (show) transition, toggle is never
// cancelable. See HTML "popover" and html/semantics/popovers WPT.
globalThis.ToggleEvent = class ToggleEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.oldState = init.oldState !== undefined ? String(init.oldState) : "";
    this.newState = init.newState !== undefined ? String(init.newState) : "";
  }
};
_markNative(globalThis.ToggleEvent);

globalThis.PromiseRejectionEvent = class PromiseRejectionEvent extends Event {
  constructor(type, init) {
    if (arguments.length < 2 || init == null || !('promise' in Object(init))) {
      throw new TypeError(
        "Failed to construct 'PromiseRejectionEvent': required member promise is undefined."
      );
    }
    super(type, init);
    this.promise = init.promise;
    this.reason = init.reason;
  }
};
_markNative(globalThis.PromiseRejectionEvent);

globalThis.StorageEvent = class StorageEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key !== undefined ? init.key : null;
    this.oldValue = init.oldValue !== undefined ? init.oldValue : null;
    this.newValue = init.newValue !== undefined ? init.newValue : null;
    this.url = init.url || "";
    this.storageArea = init.storageArea || null;
  }
  initStorageEvent(type, bubbles, cancelable, key, oldValue, newValue, url, storageArea) {
    this.initEvent(type, bubbles, cancelable);
    this.key = key !== undefined ? key : null;
    this.oldValue = oldValue !== undefined ? oldValue : null;
    this.newValue = newValue !== undefined ? newValue : null;
    this.url = url || "";
    this.storageArea = storageArea || null;
  }
};
_markNative(globalThis.StorageEvent);

// CSP violations are real WebIDL events in every document, including frame
// documents. Keep their payload in a WeakMap so constructing one does not add
// observable own string properties beyond Event's `isTrusted` slot.
const _securityPolicyViolationState = new WeakMap();
globalThis.SecurityPolicyViolationEvent = class SecurityPolicyViolationEvent extends Event {
  constructor(type, init = {}) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to construct 'SecurityPolicyViolationEvent': 1 argument required, but only 0 present.");
    }
    super(type, init);
    const value = init && typeof init === 'object' ? init : {};
    _securityPolicyViolationState.set(this, {
      documentURI: value.documentURI == null ? '' : String(value.documentURI),
      referrer: value.referrer == null ? '' : String(value.referrer),
      blockedURI: value.blockedURI == null ? '' : String(value.blockedURI),
      violatedDirective: value.violatedDirective == null ? '' : String(value.violatedDirective),
      effectiveDirective: value.effectiveDirective == null ? '' : String(value.effectiveDirective),
      originalPolicy: value.originalPolicy == null ? '' : String(value.originalPolicy),
      disposition: value.disposition == null ? 'enforce' : String(value.disposition),
      sourceFile: value.sourceFile == null ? '' : String(value.sourceFile),
      statusCode: Number.isFinite(Number(value.statusCode)) ? Number(value.statusCode) : 0,
      lineNumber: Number.isFinite(Number(value.lineNumber)) ? Number(value.lineNumber) : 0,
      columnNumber: Number.isFinite(Number(value.columnNumber)) ? Number(value.columnNumber) : 0,
      sample: value.sample == null ? '' : String(value.sample),
    });
  }
};
for (const name of [
  'documentURI', 'referrer', 'blockedURI', 'violatedDirective',
  'effectiveDirective', 'originalPolicy', 'disposition', 'sourceFile',
  'statusCode', 'lineNumber', 'columnNumber', 'sample',
]) {
  Object.defineProperty(SecurityPolicyViolationEvent.prototype, name, {
    configurable: true,
    enumerable: true,
    get() {
      const state = _securityPolicyViolationState.get(this);
      if (!state) throw new TypeError('Illegal invocation');
      return state[name];
    },
  });
}
Object.defineProperty(SecurityPolicyViolationEvent.prototype, Symbol.toStringTag, {
  value: 'SecurityPolicyViolationEvent', configurable: true,
});
{
  const constructor = Object.getOwnPropertyDescriptor(
    SecurityPolicyViolationEvent.prototype, 'constructor');
  delete SecurityPolicyViolationEvent.prototype.constructor;
  Object.defineProperty(SecurityPolicyViolationEvent.prototype, 'constructor', constructor);
}
_markNative(globalThis.SecurityPolicyViolationEvent);

