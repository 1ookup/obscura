class HTMLMediaElement extends Element {
  static NETWORK_EMPTY = 0;
  static NETWORK_IDLE = 1;
  static NETWORK_LOADING = 2;
  static NETWORK_NO_SOURCE = 3;
  static HAVE_NOTHING = 0;
  static HAVE_METADATA = 1;
  static HAVE_CURRENT_DATA = 2;
  static HAVE_FUTURE_DATA = 3;
  static HAVE_ENOUGH_DATA = 4;
  canPlayType(type) { return _canPlayMediaType(type); }
  load() {}
  play() {
    // Playback is refused as a policy, not because the format is unknown --
    // which is also what a headless Chrome with no user gesture reports.
    return Promise.reject(new DOMException(
      "play() failed because the user didn't interact with the document first.",
      'NotAllowedError',
    ));
  }
  pause() {}
  get buffered() { return new TimeRanges(_timeRangesKey); }
  get played() { return new TimeRanges(_timeRangesKey); }
  get seekable() { return new TimeRanges(_timeRangesKey); }
  get NETWORK_EMPTY() { return HTMLMediaElement.NETWORK_EMPTY; }
  get NETWORK_IDLE() { return HTMLMediaElement.NETWORK_IDLE; }
  get NETWORK_LOADING() { return HTMLMediaElement.NETWORK_LOADING; }
  get NETWORK_NO_SOURCE() { return HTMLMediaElement.NETWORK_NO_SOURCE; }
  get HAVE_NOTHING() { return HTMLMediaElement.HAVE_NOTHING; }
  get HAVE_METADATA() { return HTMLMediaElement.HAVE_METADATA; }
  get HAVE_CURRENT_DATA() { return HTMLMediaElement.HAVE_CURRENT_DATA; }
  get HAVE_FUTURE_DATA() { return HTMLMediaElement.HAVE_FUTURE_DATA; }
  get HAVE_ENOUGH_DATA() { return HTMLMediaElement.HAVE_ENOUGH_DATA; }
  get paused() { return true; }
  get ended() { return false; }
  get networkState() {
    const raw = this.getAttribute("src");
    if (raw) {
      let resolved = raw;
      try { resolved = new URL(raw, this.baseURI || globalThis.location?.href || "about:blank").href; }
      catch (_error) {}
      if (!_cspResourceAllows(resolved, 'media-src')) return HTMLMediaElement.NETWORK_NO_SOURCE;
    }
    return HTMLMediaElement.NETWORK_EMPTY;
  }
  get readyState() { return HTMLMediaElement.HAVE_NOTHING; }
  get error() { return null; }
  get seeking() { return false; }
  get currentTime() { return 0; }
  set currentTime(v) {}
  get duration() { return NaN; }
  get volume() { return 1; }
  set volume(v) {}
  get muted() { return false; }
  set muted(v) {}
  get src() {
    const raw = this.getAttribute("src");
    if (!raw) return "";
    try { return new URL(raw, this.baseURI || globalThis.location?.href || "about:blank").href; }
    catch (_error) { return raw; }
  }
  set src(v) { this.setAttribute('src', v); }
  get currentSrc() { return ""; }
  get textTracks() {
    return TextTrackList.from(
      Array.from(this.querySelectorAll("track")).map((element) => element.track)
    );
  }
  addTextTrack(kind, label = "", language = "") {
    return new TextTrack(null, String(kind), String(label), String(language));
  }
}

_markNative(HTMLMediaElement.prototype.canPlayType);
_markNative(HTMLMediaElement.prototype.play);
_markNative(HTMLMediaElement.prototype.load);
_markNative(HTMLMediaElement.prototype.pause);
