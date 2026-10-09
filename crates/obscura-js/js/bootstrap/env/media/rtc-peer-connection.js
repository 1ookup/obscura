globalThis.RTCPeerConnection = class RTCPeerConnection {
  constructor(configuration) {
    const slots = _rtcSlots(this);
    // A `stun:` entry means a browser will publish the address that server
    // reports for it as an srflx candidate when gathering starts.
    slots.stunServer = _rtcStunServer(configuration);
  }
  get localDescription() { return _rtcSlots(this).localDescription; }
  get remoteDescription() { return _rtcSlots(this).remoteDescription; }
  get iceConnectionState() { return 'new'; }
  get iceGatheringState() { return _rtcSlots(this).iceGatheringState; }
  get signalingState() { const s = _rtcSlots(this); return s.signalingState === 'have-local-offer' || s.localDescription ? 'have-local-offer' : 'stable'; }
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
  get onsignalingstatechange() { return _rtcSlots(this).onsignalingstatechange; }
  set onsignalingstatechange(value) {
    _rtcSlots(this).onsignalingstatechange = typeof value === 'function' ? value : null;
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
    // Chrome hands back a plain object from createOffer (constructor Object,
    // own keys type/sdp); only the stored localDescription is an
    // RTCSessionDescription. A page that stringifies or constructors the
    // argument it passes to setLocalDescription reads the difference.
    return Promise.resolve({ type: 'offer', sdp: _rtcBuildOffer(slots) });
  }
  createAnswer() {
    const slots = _rtcSlots(this);
    return Promise.resolve({ type: 'answer', sdp: _rtcBuildOffer(slots) });
  }
  setLocalDescription(description) {
    const slots = _rtcSlots(this);
    const wasStable = slots.signalingState !== 'have-local-offer';
    slots.localDescription = description
      ? new RTCSessionDescription(description)
      : new RTCSessionDescription({ type: 'offer', sdp: _rtcBuildOffer(slots) });
    slots.signalingState = 'have-local-offer';
    // Chrome fires the signaling-state transition synchronously inside the
    // operation (the listener runs before the returned promise's reactions)
    // and the gathering phase is announced right after the promise settles.
    // The event system carries both, endpoints on the connection.
    if (wasStable) {
      try {
        const event = new Event('signalingstatechange');
        _eventSetEndpoints(event, this, this);
        globalThis.__obscura_markTrusted(event);
        const handler = slots.onsignalingstatechange;
        if (typeof handler === 'function') { try { handler.call(this, event); } catch (e) { console.error(e); } }
        for (const l of (slots.listeners['signalingstatechange'] || []).slice()) {
          try { l.call(this, event); } catch (e) { console.error(e); }
        }
      } catch (_error) {}
    }
    const announceGathering = () => {
      // _rtcGatherCandidates flips the slot to 'gathering' synchronously, so
      // the state check here only guards against a completed or closed
      // connection: the announcement itself must fire on the promise
      // reaction, after setLocalDescription resolves, the way Chrome paces
      // it. A VM that waits for the 'gathering' phase before arming its
      // completion window reads the transition straight to 'complete' as a
      // failed gather.
      if (slots.closed || slots.iceGatheringState === 'complete') return;
      slots.iceGatheringState = 'gathering';
      try {
        const event = new Event('icegatheringstatechange');
        _eventSetEndpoints(event, this, this);
        globalThis.__obscura_markTrusted(event);
        const handler = slots.onicegatheringstatechange;
        if (typeof handler === 'function') { try { handler.call(this, event); } catch (e) { console.error(e); } }
        for (const l of (slots.listeners['icegatheringstatechange'] || []).slice()) {
          try { l.call(this, event); } catch (e) { console.error(e); }
        }
      } catch (_error) {}
    };
    _rtcGatherCandidates(this, slots);
    // Chrome fires the gathering announcement after the caller's promise
    // reactions (setLocalDescription resolves at 121.9ms, gathering at
    // 122.2ms on the reference): a VM that attaches its listener inside
    // its own .then would miss an announcement that ran first. A queued
    // task lands after every pending reaction and still long before the
    // gather loop's complete (single-digit ms here, 140ms there).
    setTimeout(() => { try { announceGathering(); } catch (_e) {} }, 0);
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

// Chrome's RTCPeerConnection is an EventTarget: the interface prototype
// chains to EventTarget.prototype (measured Chromium 149).
if (typeof EventTarget === 'function' && globalThis.RTCPeerConnection?.prototype) {
  Object.setPrototypeOf(globalThis.RTCPeerConnection.prototype, EventTarget.prototype);
}
