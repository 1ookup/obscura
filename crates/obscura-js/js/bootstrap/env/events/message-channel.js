// MessagePort is a task-backed EventTarget, not a pair of callback slots.
// React currently uses `onmessage`, while Angular/Zone.js and worker-style
// schedulers commonly use addEventListener + start and inspect the prototype.
// Keep stopped-port messages queued, clone payloads synchronously, and deliver
// one message per task so every delivery gets its own microtask checkpoint.
const _messagePortConstructionKey = {};
const _messagePortState = new WeakMap();
function _messagePortStateFor(port) {
  const state = _messagePortState.get(port);
  if (!state) throw new TypeError("Illegal invocation");
  return state;
}
function _messagePortInstallEventHandler(port, type, callback) {
  const state = _messagePortStateFor(port);
  const slot = type === "message" ? "onmessage" : "onmessageerror";
  const wrapperSlot = type === "message" ? "messageHandlerWrapper" : "messageErrorHandlerWrapper";
  const oldCallback = state[slot];
  state[slot] = callback;

  // Event-handler IDL attributes participate in the same listener list as
  // addEventListener. Install their stable wrapper when the slot first becomes
  // non-null so mixed registrations run in registration order. Reassigning a
  // live handler keeps its position; clearing and setting it again appends it.
  if (callback && !oldCallback) {
    const wrapper = (event) => {
      const current = _messagePortState.get(port)?.[slot];
      if (!current) return;
      if (typeof current === "function") current.call(port, event);
      else current.handleEvent.call(current, event);
    };
    state[wrapperSlot] = wrapper;
    _eventTargetAdd(port, type, wrapper);
  } else if (!callback && oldCallback) {
    _eventTargetRemove(port, type, state[wrapperSlot]);
    state[wrapperSlot] = null;
  }
}
function _messagePortScheduleDelivery(port) {
  const state = _messagePortStateFor(port);
  if (state.closed || !state.messageQueueEnabled || state.messageDeliveryPending || !state.messageQueue.length) return;
  state.messageDeliveryPending = true;
  // User-visible ordinary rank. Scheduler continuations at the same priority
  // remain immediately above this task; FIFO holds across all ordinary tasks.
  _browserPostedTaskEnqueue(() => {
    const current = _messagePortState.get(port);
    if (!current) return;
    current.messageDeliveryPending = false;
    if (current.closed || !current.messageQueueEnabled || !current.messageQueue.length) return;
    const data = current.messageQueue.shift();
    const event = globalThis.__obscura_markTrusted(new MessageEvent("message", {
      data,
      origin: "",
      lastEventId: "",
      source: null,
      ports: [],
    }));
    _eventTargetDispatch(port, event);
    _messagePortScheduleDelivery(port);
  }, _schedulerPriorityRank["user-visible"] * 2);
}
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

class MessageChannel {
  constructor() {
    this.port1 = new MessagePort(_messagePortConstructionKey);
    this.port2 = new MessagePort(_messagePortConstructionKey);
    _messagePortStateFor(this.port1).entangled = this.port2;
    _messagePortStateFor(this.port2).entangled = this.port1;
  }
}
globalThis.MessageChannel = MessageChannel;
globalThis.MessagePort = MessagePort;

const _cssCamelToKebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const _cssKebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

