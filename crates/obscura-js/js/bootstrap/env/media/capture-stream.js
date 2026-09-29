// HTMLCanvasElement.captureStream: the send-track path (addTransceiver +
// createOffer) reads .kind off the tracks; a full frame pump is out of scope
// for the probe surface, so the stream exposes one video track.
(function _installCaptureStream() {
  const el = globalThis.HTMLCanvasElement;
  if (typeof el !== 'function' || typeof el.prototype !== 'object') return;
  Object.defineProperty(el.prototype, 'captureStream', {
    value: function captureStream() {
      const track = {
        kind: 'video',
        id: 'cs' + String(Math.random()).slice(2, 12),
        label: '',
        enabled: true,
        muted: false,
        readyState: 'live',
        stop() { this.readyState = 'ended'; },
      };
      return {
        id: 'cs' + String(Math.random()).slice(2, 12),
        active: true,
        getVideoTracks() { return [track]; },
        getAudioTracks() { return []; },
        getTracks() { return [track]; },
        addTrack() {},
        removeTrack() {},
        clone() { return this; },
      };
    },
    writable: true, enumerable: true, configurable: true,
  });
})();
