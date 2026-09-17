// Compatibility entry point.  The public surfaces moved to
// speech-synthesis.js and media-stream.js so each object has its own shape;
// retain guarded fallbacks for snapshots built with the legacy manifest.
if (typeof globalThis.speechSynthesis === 'undefined') {
  globalThis.speechSynthesis = typeof _makeSpeechSynthesis === 'function'
    ? _makeSpeechSynthesis()
    : {
      speaking: false, pending: false, paused: false,
      getVoices() { return [{name: 'Google US English', lang: 'en-US', default: true, localService: true, voiceURI: 'Google US English'}]; },
      speak() {}, cancel() {}, pause() {}, resume() {},
      addEventListener() {}, removeEventListener() {}, onvoiceschanged: null,
    };
}
if (typeof globalThis.SpeechSynthesisUtterance === 'undefined') {
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
    constructor(text) {
      if (typeof _speechUtteranceInitialize === 'function') {
        _speechUtteranceInitialize(this, text);
      } else {
        this.text = text; this.lang = 'en-US'; this.rate = 1; this.pitch = 1; this.volume = 1;
      }
    }
  };
}
if (typeof globalThis.MediaStream === 'undefined') {
  globalThis.MediaStream = class MediaStream {
    constructor() {
      if (typeof _mediaStreamInitialize === 'function') _mediaStreamInitialize(this);
      else { this.id = ''; this.active = true; }
    }
    getTracks() { return typeof _mediaStreamTracks === 'function' ? _mediaStreamTracks() : []; }
    getAudioTracks() { return typeof _mediaStreamTracks === 'function' ? _mediaStreamTracks() : []; }
    getVideoTracks() { return typeof _mediaStreamTracks === 'function' ? _mediaStreamTracks() : []; }
    addTrack(track) { return typeof _mediaStreamAddTrack === 'function' ? _mediaStreamAddTrack(this, track) : undefined; }
    removeTrack(track) { return typeof _mediaStreamRemoveTrack === 'function' ? _mediaStreamRemoveTrack(this, track) : undefined; }
    clone() { return typeof _mediaStreamClone === 'function' ? _mediaStreamClone(this) : new MediaStream(); }
  };
}
if (typeof globalThis.MediaStreamTrack === 'undefined') {
  globalThis.MediaStreamTrack = class MediaStreamTrack {
    constructor() {
      if (typeof _mediaTrackInitialize === 'function') _mediaTrackInitialize(this);
      else { this.kind = ''; this.enabled = true; this.readyState = 'live'; }
    }
    stop() { return typeof _mediaTrackStop === 'function' ? _mediaTrackStop(this) : undefined; }
    clone() { return typeof _mediaTrackClone === 'function' ? _mediaTrackClone(this) : new MediaStreamTrack(); }
  };
}
