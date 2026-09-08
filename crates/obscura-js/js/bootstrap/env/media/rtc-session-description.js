globalThis.RTCSessionDescription = class RTCSessionDescription {
  constructor(init) {
    this.type = init && init.type ? String(init.type) : undefined;
    this.sdp = init && init.sdp != null ? String(init.sdp) : '';
  }
  toJSON() { return { type: this.type, sdp: this.sdp }; }
};
