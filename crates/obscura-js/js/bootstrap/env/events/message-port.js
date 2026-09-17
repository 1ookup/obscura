class MessagePort {
  constructor(key) {
    if (key !== _messagePortConstructionKey) throw new TypeError("Illegal constructor");
    _messagePortState.set(this, {
      entangled: null,
      messageQueue: [],
      messageQueueEnabled: false,
      messageDeliveryPending: false,
      closed: false,
      onmessage: null,
      onmessageerror: null,
      messageHandlerWrapper: null,
      messageErrorHandlerWrapper: null,
    });
  }
  postMessage(message, options) {
    // Structured serialization happens before inspecting the entanglement.
    // This preserves the browser-observable DataCloneError on closed ports and
    // prevents mutations after postMessage from changing the delivered value.
    let cloned;
    try {
      cloned = globalThis.structuredClone(message, options);
    } catch (error) {
      throw error;
    }
    const state = _messagePortStateFor(this);
    const target = state.entangled;
    const targetState = target && _messagePortState.get(target);
    if (state.closed || !targetState || targetState.closed) return;
    targetState.messageQueue.push(cloned);
    _messagePortScheduleDelivery(target);
  }
  start() {
    const state = _messagePortStateFor(this);
    if (state.messageQueueEnabled || state.closed) return;
    state.messageQueueEnabled = true;
    _messagePortScheduleDelivery(this);
  }
  close() {
    const state = _messagePortStateFor(this);
    if (state.closed) return;
    state.closed = true;
    state.messageQueue.length = 0;
    state.messageQueueEnabled = false;
    const peer = state.entangled;
    state.entangled = null;
    const peerState = peer && _messagePortState.get(peer);
    if (peerState?.entangled === this) peerState.entangled = null;
    // A previously scheduled task cannot be removed from the shared task
    // source, but it observes `closed` and therefore cannot dispatch.
  }
  addEventListener(type, callback, options) {
    _eventTargetAdd(this, type, callback, options);
  }
  removeEventListener(type, callback, options) {
    _eventTargetRemove(this, type, callback, options);
  }
  dispatchEvent(event) {
    _messagePortStateFor(this);
    return _eventTargetDispatch(this, event);
  }
  get onmessage() { return _messagePortStateFor(this).onmessage; }
  set onmessage(callback) {
    callback = typeof callback === "function"
      || (callback && typeof callback.handleEvent === "function")
      ? callback : null;
    _messagePortInstallEventHandler(this, "message", callback);
    // Setting the event-handler IDL attribute implicitly starts the port,
    // including when the assigned value is null.
    this.start();
  }
  get onmessageerror() { return _messagePortStateFor(this).onmessageerror; }
  set onmessageerror(callback) {
    callback = typeof callback === "function"
      || (callback && typeof callback.handleEvent === "function")
      ? callback : null;
    _messagePortInstallEventHandler(this, "messageerror", callback);
  }
  get [Symbol.toStringTag]() { return "MessagePort"; }
}
globalThis.MessagePort = MessagePort;
