globalThis.RTCRtpReceiver = class RTCRtpReceiver {
  constructor() { throw new TypeError('Illegal constructor'); }
  static getCapabilities(kind) { return _rtcCapabilities(String(kind)); }
  get track() { return null; }
  get transport() { return null; }
  getParameters() { return { codecs: [], headerExtensions: [], rtcp: {} }; }
  getContributingSources() { return []; }
  getSynchronizationSources() { return []; }
  getStats() { return Promise.resolve(new Map()); }
  get [Symbol.toStringTag]() { return 'RTCRtpReceiver'; }
};
