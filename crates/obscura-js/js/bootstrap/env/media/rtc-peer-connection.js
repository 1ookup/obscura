globalThis.RTCPeerConnection = class RTCPeerConnection {
  constructor(_configuration) { _rtcSlots(this); }
  get localDescription() { return _rtcSlots(this).localDescription; }
  get remoteDescription() { return _rtcSlots(this).remoteDescription; }
  get iceConnectionState() { return 'new'; }
  get iceGatheringState() { return _rtcSlots(this).iceGatheringState; }
  get signalingState() { return _rtcSlots(this).localDescription ? 'have-local-offer' : 'stable'; }
  get connectionState() { return 'new'; }
  // Spec/Chrome: null until a remote description is set, then whether that
  // description advertises trickle ICE (`a=ice-options:trickle`). Measured on
  // Chrome: null after setLocalDescription, true after a loopback
  // setRemoteDescription of an offer that carries the trickle option.
  get canTrickleIceCandidates() {
    const slots = _rtcSlots(this);
    if (!slots.remoteDescription) return null;
    return /a=ice-options:trickle/.test(String(slots.remoteDescription.sdp || ''));
  }
  get onicecandidate() { return _rtcSlots(this).onicecandidate; }
  set onicecandidate(value) { _rtcSlots(this).onicecandidate = typeof value === 'function' ? value : null; }
  get onicegatheringstatechange() { return _rtcSlots(this).onicegatheringstatechange; }
  set onicegatheringstatechange(value) {
    _rtcSlots(this).onicegatheringstatechange = typeof value === 'function' ? value : null;
  }
  addTransceiver(trackOrKind, init) {
    const slots = _rtcSlots(this);
    const kind = typeof trackOrKind === 'string' ? trackOrKind : (trackOrKind && trackOrKind.kind);
    if (kind !== 'audio' && kind !== 'video') {
      throw new TypeError("Failed to execute 'addTransceiver' on 'RTCPeerConnection': Kind must be 'audio' or 'video'.");
    }
    const transceiver = {
      kind,
      mid: null,
      direction: (init && init.direction) || 'sendrecv',
      currentDirection: null,
      stop() { this.direction = 'inactive'; },
    };
    slots.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() { return _rtcSlots(this).transceivers.slice(); }
  getSenders() { return []; }
  getReceivers() { return []; }
  createOffer(options) {
    const slots = _rtcSlots(this);
    // The legacy offerToReceive* options are still the shortest way to ask
    // for a full offer, and are what environment probes use.
    const legacy = (typeof options === 'object' && options) || {};
    if (legacy.offerToReceiveAudio && !slots.transceivers.some(item => item.kind === 'audio')) {
      slots.transceivers.push({ kind: 'audio', mid: null, direction: 'recvonly', currentDirection: null, stop() {} });
    }
    if (legacy.offerToReceiveVideo && !slots.transceivers.some(item => item.kind === 'video')) {
      slots.transceivers.push({ kind: 'video', mid: null, direction: 'recvonly', currentDirection: null, stop() {} });
    }
    return Promise.resolve(new RTCSessionDescription({ type: 'offer', sdp: _rtcBuildOffer(slots) }));
  }
  createAnswer() {
    const slots = _rtcSlots(this);
    return Promise.resolve(new RTCSessionDescription({ type: 'answer', sdp: _rtcBuildOffer(slots) }));
  }
  setLocalDescription(description) {
    const slots = _rtcSlots(this);
    slots.localDescription = description
      ? new RTCSessionDescription(description)
      : new RTCSessionDescription({ type: 'offer', sdp: _rtcBuildOffer(slots) });
    _rtcGatherCandidates(this, slots);
    return Promise.resolve();
  }
  setRemoteDescription(description) {
    _rtcSlots(this).remoteDescription = description ? new RTCSessionDescription(description) : null;
    return Promise.resolve();
  }
  addIceCandidate() { return Promise.resolve(); }
  restartIce() {}
  close() { _rtcSlots(this).closed = true; }
  createDataChannel(label) {
    const slots = _rtcSlots(this);
    slots.dataChannel = true;
    return {
      label: String(label == null ? '' : label),
      readyState: 'connecting',
      close(){}, send(){}, addEventListener(){}, removeEventListener(){},
    };
  }
  addEventListener(type, listener) {
    if (typeof listener !== 'function') return;
    const listeners = _rtcSlots(this).listeners;
    const list = listeners[type] || (listeners[type] = []);
    if (!list.includes(listener)) list.push(listener);
  }
  removeEventListener(type, listener) {
    const list = _rtcSlots(this).listeners[type];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index !== -1) list.splice(index, 1);
  }
  dispatchEvent() { return true; }
  getStats() { return Promise.resolve(new Map()); }
  get [Symbol.toStringTag]() { return 'RTCPeerConnection'; }
};
