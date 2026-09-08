// MediaStream and MediaStreamTrack are shape-only sources in this engine: no
// capture device is opened.  These helpers preserve the old empty-track
// behavior while keeping state transitions out of the interface declarations.
function _mediaStreamInitialize(stream) {
  stream.id = '';
  stream.active = true;
}

function _mediaStreamTracks() { return []; }
function _mediaStreamAddTrack() {}
function _mediaStreamRemoveTrack() {}
function _mediaStreamClone() {
  return new globalThis.MediaStream();
}

function _mediaTrackInitialize(track) {
  track.kind = '';
  track.enabled = true;
  track.readyState = 'live';
}

// No capture device exists, so stop() intentionally leaves the same inert
// `live` state exposed by the legacy shim.
function _mediaTrackStop(track) {}
function _mediaTrackClone() { return new globalThis.MediaStreamTrack(); }
