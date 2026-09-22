globalThis.RTCPeerConnectionIceEvent = class RTCPeerConnectionIceEvent extends Event {
  constructor(type, init = {}) {
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to construct 'RTCPeerConnectionIceEvent': 1 argument required, but only 0 present.");
    }
    super(type, init);
    this.candidate = Object.prototype.hasOwnProperty.call(init, 'candidate') ? init.candidate : null;
  }
};
_eventInitSlots(globalThis.RTCPeerConnectionIceEvent, [['candidate', null]]);
