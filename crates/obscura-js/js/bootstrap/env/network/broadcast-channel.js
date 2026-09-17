// BroadcastChannel object shape and realm-local delivery behavior. Channels
// share the EventTarget dispatcher but keep their own state in a WeakMap so
// public properties remain prototype accessors and cross-instance state cannot
// leak through enumerable own keys.
if (typeof BroadcastChannel === 'undefined') {
  const channelsByName = new Map();
  const channelState = new WeakMap();
  const stateFor = (channel) => {
    const state = channelState.get(channel);
    if (!state) throw new TypeError('Illegal invocation');
    return state;
  };
  const installHandler = (channel, type, callback) => {
    const state = stateFor(channel);
    const slot = type === 'message' ? 'onmessage' : 'onmessageerror';
    const wrapperSlot = type === 'message' ? 'messageWrapper' : 'messageErrorWrapper';
    const oldCallback = state[slot];
    state[slot] = callback;
    if (callback && !oldCallback) {
      const wrapper = (event) => {
        const current = channelState.get(channel)?.[slot];
        if (!current) return;
        if (typeof current === 'function') current.call(channel, event);
        else current.handleEvent.call(current, event);
      };
      state[wrapperSlot] = wrapper;
      _eventTargetAdd(channel, type, wrapper);
    } else if (!callback && oldCallback) {
      _eventTargetRemove(channel, type, state[wrapperSlot]);
      state[wrapperSlot] = null;
    }
  };

  globalThis.BroadcastChannel = class BroadcastChannel {
    constructor(name) {
      if (arguments.length < 1) {
        throw new TypeError("Failed to construct 'BroadcastChannel': 1 argument required.");
      }
      const normalizedName = String(name);
      const state = {
        name: normalizedName,
        closed: false,
        onmessage: null,
        onmessageerror: null,
        messageWrapper: null,
        messageErrorWrapper: null,
      };
      channelState.set(this, state);
      let channels = channelsByName.get(normalizedName);
      if (!channels) channelsByName.set(normalizedName, channels = new Set());
      channels.add(this);
    }
    get name() { return stateFor(this).name; }
    get onmessage() { return stateFor(this).onmessage; }
    set onmessage(callback) {
      callback = typeof callback === 'function'
        || (callback && typeof callback.handleEvent === 'function') ? callback : null;
      installHandler(this, 'message', callback);
    }
    get onmessageerror() { return stateFor(this).onmessageerror; }
    set onmessageerror(callback) {
      callback = typeof callback === 'function'
        || (callback && typeof callback.handleEvent === 'function') ? callback : null;
      installHandler(this, 'messageerror', callback);
    }
    addEventListener(type, callback, options) {
      stateFor(this);
      _eventTargetAdd(this, type, callback, options);
    }
    removeEventListener(type, callback, options) {
      stateFor(this);
      _eventTargetRemove(this, type, callback, options);
    }
    dispatchEvent(event) {
      stateFor(this);
      return _eventTargetDispatch(this, event);
    }
    postMessage(message) {
      const state = stateFor(this);
      if (state.closed) {
        throw new DOMException('BroadcastChannel is closed.', 'InvalidStateError');
      }
      // Serialization is synchronous and precedes recipient selection.
      const snapshot = globalThis.structuredClone(message);
      const recipients = Array.from(channelsByName.get(state.name) || [])
        .filter(channel => channel !== this && !channelState.get(channel)?.closed);
      const origin = globalThis.location?.origin || '';
      for (const recipient of recipients) {
        const data = globalThis.structuredClone(snapshot);
        _scheduleAfter(0, () => {
          const recipientState = channelState.get(recipient);
          if (!recipientState || recipientState.closed) return;
          _eventTargetDispatch(recipient, globalThis.__obscura_markTrusted(
            new MessageEvent('message', { data, origin, source: null, ports: [] })));
        });
      }
    }
    close() {
      const state = stateFor(this);
      if (state.closed) return;
      state.closed = true;
      const channels = channelsByName.get(state.name);
      if (!channels) return;
      channels.delete(this);
      if (!channels.size) channelsByName.delete(state.name);
    }
    get [Symbol.toStringTag]() { return 'BroadcastChannel'; }
  };
  Object.setPrototypeOf(globalThis.BroadcastChannel.prototype, globalThis.EventTarget.prototype);
}
