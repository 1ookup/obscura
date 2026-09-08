globalThis.ErrorEvent = class ErrorEvent extends Event { constructor(t,o={}) { super(t,o);this.message=o.message||"";this.error=o.error||null; } };
