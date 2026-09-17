globalThis.RTCRtpSender = class RTCRtpSender {
  constructor() { throw new TypeError('Illegal constructor'); }
  static getCapabilities(kind) { return _rtcCapabilities(String(kind)); }
  get track() { return null; }
  get transport() { return null; }
  getParameters() { return { codecs: [], encodings: [], headerExtensions: [], rtcp: {} }; }
  setParameters() { return Promise.resolve(); }
  getStats() { return Promise.resolve(new Map()); }
  replaceTrack() { return Promise.resolve(); }
  get [Symbol.toStringTag]() { return 'RTCRtpSender'; }
};
