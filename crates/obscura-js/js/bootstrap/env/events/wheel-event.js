// WheelEvent inherits all MouseEvent coordinates and modifier state. CDP
// Input.dispatchMouseEvent supplies those fields and automation libraries use
// them to distinguish wheel gestures over nested panes.
globalThis.WheelEvent = class WheelEvent extends MouseEvent {
  constructor(t,o={}) { super(t,o);this.deltaX=o.deltaX||0;this.deltaY=o.deltaY||0;this.deltaZ=o.deltaZ||0;this.deltaMode=o.deltaMode||0; }
};
