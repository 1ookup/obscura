class MessageChannel {
  constructor() {
    this.port1 = new MessagePort(_messagePortConstructionKey);
    this.port2 = new MessagePort(_messagePortConstructionKey);
    _messagePortStateFor(this.port1).entangled = this.port2;
    _messagePortStateFor(this.port2).entangled = this.port1;
  }
}
globalThis.MessageChannel = MessageChannel;
