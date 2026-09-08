// WebRTC is not implemented: no packet is ever sent. What *is* implemented is
// everything a page observes from an offer it never uses -- because the empty
// `sdp: ''` this returned before is a value no browser produces, and an
// environment probe reads the offer as a fingerprint surface (codec list,
// header extensions, DTLS fingerprint, ICE credentials).
//
// The section bodies below are a Chrome offer captured verbatim; only the
// per-connection values (session id, ICE credentials, DTLS fingerprint, mid,
// direction) are generated. Editing a codec line here changes what the engine
// claims to support, so keep it a transcription rather than a design.
const _RTC_SDP_SECTIONS = {
  audio: {
    head: [
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126",
      "c=IN IP4 0.0.0.0",
      "a=rtcp:9 IN IP4 0.0.0.0",
    ],
    extmaps: [
      "a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level",
      "a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
      "a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
      "a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid",
    ],
    body: [
      "a=rtcp-mux",
      "a=rtcp-rsize",
      "a=rtpmap:111 opus/48000/2",
      "a=rtcp-fb:111 transport-cc",
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=rtpmap:63 red/48000/2",
      "a=fmtp:63 111/111",
      "a=rtpmap:9 G722/8000",
      "a=rtpmap:0 PCMU/8000",
      "a=rtpmap:8 PCMA/8000",
      "a=rtpmap:13 CN/8000",
      "a=rtpmap:110 telephone-event/48000",
      "a=rtpmap:126 telephone-event/8000",
    ],
  },
  video: {
    head: [
      "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 35 36 37 38 103 104 107 108 109 114 115 116 117 118 39 40 41 42 43 44 45 46 47 48 49 50 51 52 119 120 121 53",
      "c=IN IP4 0.0.0.0",
      "a=rtcp:9 IN IP4 0.0.0.0",
    ],
    extmaps: [
      "a=extmap:14 urn:ietf:params:rtp-hdrext:toffset",
      "a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
      "a=extmap:13 urn:3gpp:video-orientation",
      "a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
      "a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
      "a=extmap:6 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type",
      "a=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing",
      "a=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space",
      "a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid",
      "a=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
      "a=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
    ],
    body: [
      "a=rtcp-mux",
      "a=rtcp-rsize",
      "a=rtpmap:96 VP8/90000",
      "a=rtcp-fb:96 goog-remb",
      "a=rtcp-fb:96 transport-cc",
      "a=rtcp-fb:96 ccm fir",
      "a=rtcp-fb:96 nack",
      "a=rtcp-fb:96 nack pli",
      "a=rtpmap:97 rtx/90000",
      "a=fmtp:97 apt=96",
      "a=rtpmap:98 VP9/90000",
      "a=rtcp-fb:98 goog-remb",
      "a=rtcp-fb:98 transport-cc",
      "a=rtcp-fb:98 ccm fir",
      "a=rtcp-fb:98 nack",
      "a=rtcp-fb:98 nack pli",
      "a=fmtp:98 profile-id=0",
      "a=rtpmap:99 rtx/90000",
      "a=fmtp:99 apt=98",
      "a=rtpmap:100 VP9/90000",
      "a=rtcp-fb:100 goog-remb",
      "a=rtcp-fb:100 transport-cc",
      "a=rtcp-fb:100 ccm fir",
      "a=rtcp-fb:100 nack",
      "a=rtcp-fb:100 nack pli",
      "a=fmtp:100 profile-id=2",
      "a=rtpmap:101 rtx/90000",
      "a=fmtp:101 apt=100",
      "a=rtpmap:35 VP9/90000",
      "a=rtcp-fb:35 goog-remb",
      "a=rtcp-fb:35 transport-cc",
      "a=rtcp-fb:35 ccm fir",
      "a=rtcp-fb:35 nack",
      "a=rtcp-fb:35 nack pli",
      "a=fmtp:35 profile-id=1",
      "a=rtpmap:36 rtx/90000",
      "a=fmtp:36 apt=35",
      "a=rtpmap:37 VP9/90000",
      "a=rtcp-fb:37 goog-remb",
      "a=rtcp-fb:37 transport-cc",
      "a=rtcp-fb:37 ccm fir",
      "a=rtcp-fb:37 nack",
      "a=rtcp-fb:37 nack pli",
      "a=fmtp:37 profile-id=3",
      "a=rtpmap:38 rtx/90000",
      "a=fmtp:38 apt=37",
      "a=rtpmap:103 H264/90000",
      "a=rtcp-fb:103 goog-remb",
      "a=rtcp-fb:103 transport-cc",
      "a=rtcp-fb:103 ccm fir",
      "a=rtcp-fb:103 nack",
      "a=rtcp-fb:103 nack pli",
      "a=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
      "a=rtpmap:104 rtx/90000",
      "a=fmtp:104 apt=103",
      "a=rtpmap:107 H264/90000",
      "a=rtcp-fb:107 goog-remb",
      "a=rtcp-fb:107 transport-cc",
      "a=rtcp-fb:107 ccm fir",
      "a=rtcp-fb:107 nack",
      "a=rtcp-fb:107 nack pli",
      "a=fmtp:107 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f",
      "a=rtpmap:108 rtx/90000",
      "a=fmtp:108 apt=107",
      "a=rtpmap:109 H264/90000",
      "a=rtcp-fb:109 goog-remb",
      "a=rtcp-fb:109 transport-cc",
      "a=rtcp-fb:109 ccm fir",
      "a=rtcp-fb:109 nack",
      "a=rtcp-fb:109 nack pli",
      "a=fmtp:109 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
      "a=rtpmap:114 rtx/90000",
      "a=fmtp:114 apt=109",
      "a=rtpmap:115 H264/90000",
      "a=rtcp-fb:115 goog-remb",
      "a=rtcp-fb:115 transport-cc",
      "a=rtcp-fb:115 ccm fir",
      "a=rtcp-fb:115 nack",
      "a=rtcp-fb:115 nack pli",
      "a=fmtp:115 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
      "a=rtpmap:116 rtx/90000",
      "a=fmtp:116 apt=115",
      "a=rtpmap:117 H264/90000",
      "a=rtcp-fb:117 goog-remb",
      "a=rtcp-fb:117 transport-cc",
      "a=rtcp-fb:117 ccm fir",
      "a=rtcp-fb:117 nack",
      "a=rtcp-fb:117 nack pli",
      "a=fmtp:117 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f",
      "a=rtpmap:118 rtx/90000",
      "a=fmtp:118 apt=117",
      "a=rtpmap:39 H264/90000",
      "a=rtcp-fb:39 goog-remb",
      "a=rtcp-fb:39 transport-cc",
      "a=rtcp-fb:39 ccm fir",
      "a=rtcp-fb:39 nack",
      "a=rtcp-fb:39 nack pli",
      "a=fmtp:39 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f",
      "a=rtpmap:40 rtx/90000",
      "a=fmtp:40 apt=39",
      "a=rtpmap:41 H264/90000",
      "a=rtcp-fb:41 goog-remb",
      "a=rtcp-fb:41 transport-cc",
      "a=rtcp-fb:41 ccm fir",
      "a=rtcp-fb:41 nack",
      "a=rtcp-fb:41 nack pli",
      "a=fmtp:41 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=f4001f",
      "a=rtpmap:42 rtx/90000",
      "a=fmtp:42 apt=41",
      "a=rtpmap:43 H264/90000",
      "a=rtcp-fb:43 goog-remb",
      "a=rtcp-fb:43 transport-cc",
      "a=rtcp-fb:43 ccm fir",
      "a=rtcp-fb:43 nack",
      "a=rtcp-fb:43 nack pli",
      "a=fmtp:43 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=f4001f",
      "a=rtpmap:44 rtx/90000",
      "a=fmtp:44 apt=43",
      "a=rtpmap:45 AV1/90000",
      "a=rtcp-fb:45 goog-remb",
      "a=rtcp-fb:45 transport-cc",
      "a=rtcp-fb:45 ccm fir",
      "a=rtcp-fb:45 nack",
      "a=rtcp-fb:45 nack pli",
      "a=fmtp:45 level-idx=5;profile=0;tier=0",
      "a=rtpmap:46 rtx/90000",
      "a=fmtp:46 apt=45",
      "a=rtpmap:47 AV1/90000",
      "a=rtcp-fb:47 goog-remb",
      "a=rtcp-fb:47 transport-cc",
      "a=rtcp-fb:47 ccm fir",
      "a=rtcp-fb:47 nack",
      "a=rtcp-fb:47 nack pli",
      "a=fmtp:47 level-idx=5;profile=1;tier=0",
      "a=rtpmap:48 rtx/90000",
      "a=fmtp:48 apt=47",
      "a=rtpmap:49 H265/90000",
      "a=rtcp-fb:49 goog-remb",
      "a=rtcp-fb:49 transport-cc",
      "a=rtcp-fb:49 ccm fir",
      "a=rtcp-fb:49 nack",
      "a=rtcp-fb:49 nack pli",
      "a=fmtp:49 level-id=180;profile-id=1;tier-flag=0;tx-mode=SRST",
      "a=rtpmap:50 rtx/90000",
      "a=fmtp:50 apt=49",
      "a=rtpmap:51 H265/90000",
      "a=rtcp-fb:51 goog-remb",
      "a=rtcp-fb:51 transport-cc",
      "a=rtcp-fb:51 ccm fir",
      "a=rtcp-fb:51 nack",
      "a=rtcp-fb:51 nack pli",
      "a=fmtp:51 level-id=180;profile-id=2;tier-flag=0;tx-mode=SRST",
      "a=rtpmap:52 rtx/90000",
      "a=fmtp:52 apt=51",
      "a=rtpmap:119 red/90000",
      "a=rtpmap:120 rtx/90000",
      "a=fmtp:120 apt=119",
      "a=rtpmap:121 ulpfec/90000",
      "a=rtpmap:53 flexfec-03/90000",
      "a=rtcp-fb:53 goog-remb",
      "a=rtcp-fb:53 transport-cc",
      "a=fmtp:53 repair-window=10000000",
    ],
  },
  application: {
    head: [
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "c=IN IP4 0.0.0.0",
    ],
    extmaps: [],
    body: [
      "a=sctp-port:5000",
      "a=max-message-size:262144",
    ],
  },
};

function _rtcRandomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, byte => byte.toString(16).padStart(2, '0').toUpperCase());
}
function _rtcRandomBase64(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, byte => alphabet[byte & 63]).join('');
}
// A fixed-width decimal with no leading zero, which is what a number
// formatted by the real implementation always is.
function _rtcRandomUint(digits) {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  const value = (BigInt(values[0]) << 32n) | BigInt(values[1]);
  const text = String(value).padStart(digits, '1').slice(-digits);
  return text[0] === '0' ? '1' + text.slice(1) : text;
}
// Chrome hides local interface addresses behind mDNS names, one stable UUID
// per interface for the lifetime of the page.
function _rtcMdnsHosts() {
  if (!_rtcMdnsHosts._cache) {
    _rtcMdnsHosts._cache = [0, 1].map(() => {
      const hex = _rtcRandomHex(16).join('').toLowerCase();
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}.local`;
    });
  }
  return _rtcMdnsHosts._cache;
}

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
function _rtcBuildOffer(slots) {
  const kinds = slots.transceivers.map(item => item.kind);
  if (slots.dataChannel) kinds.push('application');
  if (!kinds.length) {
    // A peer connection with nothing to negotiate still offers a session
    // header; Chrome emits no m-line and no BUNDLE group.
    return `v=0\r\no=- ${slots.sessionId} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\n`;
  }
  const lines = [
    'v=0',
    `o=- ${slots.sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${kinds.map((_kind, index) => index).join(' ')}`,
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
  ];
  kinds.forEach((kind, index) => {
    const section = _RTC_SDP_SECTIONS[kind];
    lines.push(...section.head);
    lines.push(`a=ice-ufrag:${slots.ufrag}`);
    lines.push(`a=ice-pwd:${slots.pwd}`);
    lines.push('a=ice-options:trickle');
    lines.push(`a=fingerprint:sha-256 ${slots.fingerprint}`);
    lines.push('a=setup:actpass');
    lines.push(`a=mid:${index}`);
    lines.push(...section.extmaps);
    if (kind !== 'application') {
      lines.push(`a=${(slots.transceivers[index] || {}).direction || 'recvonly'}`);
    }
    lines.push(...section.body);
  });
  return lines.join('\r\n') + '\r\n';
}
function _rtcGatherCandidates(connection, slots) {
  if (slots.iceGatheringState !== 'new' || slots.closed) return;
  const kinds = slots.transceivers.map(item => item.kind);
  if (slots.dataChannel) kinds.push('application');
  if (!kinds.length) return;
  slots.iceGatheringState = 'gathering';
  const hosts = _rtcMdnsHosts();
  const emit = (type, event) => {
    const handler = slots['on' + type];
    if (typeof handler === 'function') { try { handler.call(connection, event); } catch (error) { console.error(error); } }
    for (const listener of (slots.listeners[type] || []).slice()) {
      try { listener.call(connection, event); } catch (error) { console.error(error); }
    }
  };
  // Chrome trickles one candidate per interface per m-line, then a null
  // candidate to close gathering. No srflx candidate is produced here: it
  // would have to carry a public address, and inventing one that does not
  // match the address the request actually came from is a worse mismatch
  // than not offering one.
  const queue = [];
  kinds.forEach((_kind, index) => {
    hosts.forEach((host, hostIndex) => {
      const foundation = _rtcRandomUint(10);
      // The two type-preference/local-preference pairs Chrome emits for its
      // first two interfaces.
      const priority = hostIndex === 0 ? 2113937151 : 2113942271;
      const port = 49152 + Math.floor(crypto.getRandomValues(new Uint16Array(1))[0] / 4);
      queue.push({
        candidate: `candidate:${foundation} 1 udp ${priority} ${host} ${port} typ host generation 0 ufrag ${slots.ufrag} network-cost 999`,
        sdpMid: String(index),
        sdpMLineIndex: index,
      });
    });
  });
  let position = 0;
  const step = () => {
    if (slots.closed) return;
    if (position < queue.length) {
      const item = queue[position++];
      const candidate = new RTCIceCandidate({
        candidate: item.candidate,
        sdpMid: item.sdpMid,
        sdpMLineIndex: item.sdpMLineIndex,
        usernameFragment: slots.ufrag,
      });
      emit('icecandidate', { type: 'icecandidate', candidate, target: connection });
      _scheduleAfter(1, step);
      return;
    }
    slots.iceGatheringState = 'complete';
    emit('icegatheringstatechange', { type: 'icegatheringstatechange', target: connection });
    emit('icecandidate', { type: 'icecandidate', candidate: null, target: connection });
  };
  _scheduleAfter(1, step);
}


// `RTCRtpSender.getCapabilities(kind)` is a static query -- no peer connection
// involved -- and an environment probe reads it as a codec fingerprint. Both
// interfaces were absent, so the call threw.
//
// The answer is derived from the same SDP sections the offer is built from,
// so codec ordering and clock rates stay aligned. Per-offer payload mappings
// for RTX and RED remain in SDP rather than the static capability view.
function _rtcCapabilities(kind) {
  if (kind !== 'audio' && kind !== 'video') return null;
  const section = _RTC_SDP_SECTIONS[kind];
  const formats = new Map();
  for (const line of section.body) {
    const match = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (match) formats.set(match[1], match[2]);
  }
  const codecs = [];
  const seen = new Set();
  for (const line of section.body) {
    const match = /^a=rtpmap:(\d+) ([^/]+)\/(\d+)(?:\/(\d+))?$/.exec(line);
    if (!match) continue;
    const name = match[2];
    // RTX and RED format parameters name the payload types they repair or
    // encapsulate. Chrome keeps those mappings in the offer SDP, but omits
    // them from the static codec capability.
    const lowerName = name.toLowerCase();
    const hasPayloadMapping = lowerName === 'rtx' || lowerName === 'red';
    const parameters = hasPayloadMapping ? undefined : formats.get(match[1]);
    // The clock rate is part of a codec's identity: telephone-event is
    // offered at both 48000 and 8000, and keying on the name alone collapsed
    // them into one.
    const key = name + '/' + match[3] + '|' + (parameters || '');
    if (seen.has(key)) continue;
    seen.add(key);
    const codec = { mimeType: kind + '/' + name, clockRate: +match[3] };
    codec.channels = match[4] ? +match[4] : 1;
    if (parameters !== undefined) codec.sdpFmtpLine = parameters;
    codecs.push(codec);
  }
  const headerExtensions = section.extmaps
    .map(line => /^a=extmap:\d+(?:\/\S+)? (\S+)$/.exec(line))
    .filter(Boolean)
    .map(match => ({ uri: match[1] }));
  return { codecs, headerExtensions };
}

