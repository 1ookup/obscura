// Per-RTCPeerConnection host state.  SDP/candidate algorithms live in the
// behavior entrypoint; keeping the WeakMap here makes connection object shape
// independent from mutable ICE/session state and preserves realm-local brand
// identity.
const _rtcState = new WeakMap();

function _rtcSlots(connection) {
  let slots = _rtcState.get(connection);
  if (!slots) {
    slots = {
      sessionId: _rtcRandomUint(19),
      ufrag: _rtcRandomBase64(4),
      pwd: _rtcRandomBase64(24),
      fingerprint: _rtcRandomHex(32).join(':'),
      transceivers: [],
      dataChannel: false,
      localDescription: null,
      remoteDescription: null,
      iceGatheringState: 'new',
      listeners: Object.create(null),
      onicecandidate: null,
      onicegatheringstatechange: null,
      closed: false,
    };
    _rtcState.set(connection, slots);
  }
  return slots;
}
