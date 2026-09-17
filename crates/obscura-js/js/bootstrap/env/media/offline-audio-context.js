// OfflineAudioContext interface shape; sample generation and completion events
// live in support/audio-context-behavior.js.
globalThis.OfflineAudioContext = class OfflineAudioContext extends AudioContext {
  constructor(channelsOrOptions, length, sampleRate) {
    super();
    _offlineAudioInitialize(this, channelsOrOptions, length, sampleRate);
  }
  startRendering() { return _offlineAudioStartRendering(this); }
};
