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
