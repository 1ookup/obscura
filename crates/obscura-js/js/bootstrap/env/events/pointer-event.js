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
  // Per spec the coalesced list contains the event itself when the input
  // pipeline reports no coalescing. Chrome only produces that list for real
  // trusted-pipeline input; a synthetic dispatchEvent returns an empty list.
  // Consumers read [0]'s pointer surface, so the trusted gate decides whether
  // they see the event or undefined.
  getCoalescedEvents(){return _trustedEvents.has(this) ? [this] : [];}
};
{
  const ctor=Object.getOwnPropertyDescriptor(PointerEvent.prototype,'constructor');
  const coalesced=Object.getOwnPropertyDescriptor(PointerEvent.prototype,'getCoalescedEvents');
  delete PointerEvent.prototype.constructor;
  delete PointerEvent.prototype.getCoalescedEvents;
  Object.defineProperty(PointerEvent.prototype,'constructor',ctor);
  Object.defineProperty(PointerEvent.prototype,'getCoalescedEvents',coalesced);
}
