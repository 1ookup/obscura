class HTMLVideoElement extends HTMLMediaElement {
  get poster() {
    const raw = this.getAttribute("poster");
    if (!raw) return "";
    try { return new URL(raw, this.baseURI || globalThis.location?.href || "about:blank").href; }
    catch (_error) { return raw; }
  }
  set poster(value) { this.setAttribute("poster", value); }
  get videoWidth() { return 0; }
  get videoHeight() { return 0; }
  getVideoPlaybackQuality() { return new VideoPlaybackQuality(_timeRangesKey); }
  // The callback is retained and never invoked: it fires per presented frame,
  // and no frame is ever presented. Chrome behaves the same for a video that
  // never starts. The handle is a live counter so cancel() has something real.
  requestVideoFrameCallback(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        "Failed to execute 'requestVideoFrameCallback' on 'HTMLVideoElement': " +
        'parameter 1 is not of type \'Function\'.');
    }
    this._videoFrameCallbacks = this._videoFrameCallbacks || new Map();
    const handle = (this._videoFrameHandle = (this._videoFrameHandle || 0) + 1);
    this._videoFrameCallbacks.set(handle, callback);
    return handle;
  }
  cancelVideoFrameCallback(handle) {
    if (this._videoFrameCallbacks) this._videoFrameCallbacks.delete(handle >>> 0);
  }
}
