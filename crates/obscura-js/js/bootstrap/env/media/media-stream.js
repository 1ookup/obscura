// MediaStream and MediaStreamTrack interface shapes.  Device/capture behavior
// is deliberately inert and is implemented by support/media-stream-behavior.js.
if (typeof globalThis.MediaStream === 'undefined') {
  globalThis.MediaStream = class MediaStream {
    constructor() { _mediaStreamInitialize(this); }
    getTracks() { return _mediaStreamTracks(); }
    getAudioTracks() { return _mediaStreamTracks(); }
    getVideoTracks() { return _mediaStreamTracks(); }
    addTrack(track) { return _mediaStreamAddTrack(this, track); }
    removeTrack(track) { return _mediaStreamRemoveTrack(this, track); }
    clone() { return _mediaStreamClone(this); }
  };
}
if (typeof globalThis.MediaStreamTrack === 'undefined') {
  globalThis.MediaStreamTrack = class MediaStreamTrack {
    constructor() { _mediaTrackInitialize(this); }
    stop() { return _mediaTrackStop(this); }
    clone() { return _mediaTrackClone(this); }
  };
}
