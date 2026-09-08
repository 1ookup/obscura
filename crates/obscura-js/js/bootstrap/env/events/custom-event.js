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
