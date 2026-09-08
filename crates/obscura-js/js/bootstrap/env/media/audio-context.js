// AudioContext interface shape.  The implementation is an inert, deterministic
// behavior layer in support/audio-context-behavior.js.
globalThis.AudioContext = class AudioContext {
  constructor() { _audioContextInitialize(this); }
  addEventListener(type, callback) { _audioContextAddEventListener(this, type, callback); }
  removeEventListener(type, callback) { _audioContextRemoveEventListener(this, type, callback); }
  _ap(value, min, max) { return _audioParam(value, min, max); }
  createOscillator() { return _audioContextCreateOscillator(this); }
  createDynamicsCompressor() { return _audioContextCreateDynamicsCompressor(this); }
  createAnalyser() { return _audioContextCreateAnalyser(this); }
  createGain() { return _audioContextCreateGain(this); }
  createBiquadFilter() { return _audioContextCreateBiquadFilter(this); }
  createBufferSource() { return _audioContextCreateBufferSource(this); }
  createBuffer(channels, length, sampleRate) {
    return _audioContextCreateBuffer(this, channels, length, sampleRate);
  }
  createScriptProcessor() { return _audioContextCreateScriptProcessor(); }
  decodeAudioData(buffer) { return _audioContextDecodeAudioData(this, buffer); }
  resume() { return _audioContextResume(this); }
  suspend() { return _audioContextSuspend(this); }
  close() { return _audioContextClose(this); }
};
