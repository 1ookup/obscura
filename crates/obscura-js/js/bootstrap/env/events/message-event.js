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
