globalThis.RTCIceCandidate = class RTCIceCandidate {
  constructor(init) {
    const source = init || {};
    this.candidate = source.candidate == null ? '' : String(source.candidate);
    this.sdpMid = source.sdpMid == null ? null : String(source.sdpMid);
    this.sdpMLineIndex = source.sdpMLineIndex == null ? null : (+source.sdpMLineIndex || 0);
    this.usernameFragment = source.usernameFragment == null ? null : String(source.usernameFragment);
  }
  toJSON() {
    return {
      candidate: this.candidate, sdpMid: this.sdpMid,
      sdpMLineIndex: this.sdpMLineIndex, usernameFragment: this.usernameFragment,
    };
  }
};
