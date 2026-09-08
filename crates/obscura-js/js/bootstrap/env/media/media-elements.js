// TimeRanges: `buffered`, `played` and `seekable` return one of these. Nothing
// is ever buffered here, so every list is empty -- but the objects have to
// exist, because a media element missing all three is not a media element in
// any browser. Chrome returns a *new* object per read; matching that keeps
// `video.buffered === video.buffered` false, as it is there.
class TimeRanges {
  constructor(key) {
    if (key !== _timeRangesKey) throw new TypeError('Illegal constructor');
  }
  get length() { return 0; }
  start(index) {
    throw new DOMException(
      "Failed to execute 'start' on 'TimeRanges': The index provided (" +
      (index >>> 0) + ') is greater than or equal to the maximum bound (0).',
      'IndexSizeError');
  }
  end(index) {
    throw new DOMException(
      "Failed to execute 'end' on 'TimeRanges': The index provided (" +
      (index >>> 0) + ') is greater than or equal to the maximum bound (0).',
      'IndexSizeError');
  }
  get [Symbol.toStringTag]() { return 'TimeRanges'; }
}
const _timeRangesKey = Symbol('TimeRanges');
globalThis.TimeRanges = _markNative(TimeRanges);

// VideoPlaybackQuality: all counters are zero because no frame is ever
// decoded, which is what the same counters read in a browser that has not
// started playback either.
class VideoPlaybackQuality {
  constructor(key) {
    if (key !== _timeRangesKey) throw new TypeError('Illegal constructor');
    this._creationTime = _performanceNowSafe();
  }
  get creationTime() { return this._creationTime; }
  get droppedVideoFrames() { return 0; }
  get totalVideoFrames() { return 0; }
  get corruptedVideoFrames() { return 0; }
  get [Symbol.toStringTag]() { return 'VideoPlaybackQuality'; }
}
globalThis.VideoPlaybackQuality = _markNative(VideoPlaybackQuality);

// Class accessors are non-enumerable; WebIDL attributes are enumerable, and
// `Object.keys(VideoPlaybackQuality.prototype)` returning 0 instead of 4 is
// exactly the kind of difference an environment probe enumerates for.
for (const [target, keys] of [
  [TimeRanges.prototype, ['length']],
  [VideoPlaybackQuality.prototype,
    ['creationTime', 'droppedVideoFrames', 'totalVideoFrames', 'corruptedVideoFrames']],
]) {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) {
      descriptor.enumerable = true;
      if (descriptor.get) _markNative(descriptor.get);
      Object.defineProperty(target, key, descriptor);
    }
  }
}

function _performanceNowSafe() {
  try { return globalThis.performance ? performance.now() : 0; }
  catch (_error) { return 0; }
}

// canPlayType reports the container/codec support a Chrome build advertises.
// This is a static capability query, not a promise that a given file will
// play: Chrome answers "probably" for streams it then fails to fetch or
// decode. Answering "" for every type -- which is what this returned before --
// is a value no Chrome produces, and it pushes sites into their "your browser
// cannot play video" path. Playback itself still never happens: `play()`
// rejects, `readyState` stays HAVE_NOTHING and no frame is decoded.
// The broad canPlayType table is pinned in js-repros/media-capability-honesty/.
const _MEDIA_CONTAINERS = {
  'video/mp4': 'maybe', 'video/webm': 'maybe', 'video/ogg': 'maybe',
  'video/x-matroska': 'maybe', 'video/3gpp': 'maybe',
  'application/x-mpegurl': 'maybe', 'application/vnd.apple.mpegurl': 'maybe',
  'audio/mp4': 'maybe', 'audio/wav': 'maybe', 'audio/ogg': 'maybe',
  'audio/webm': 'maybe',
  // Containers that imply their codec answer "probably" with no codecs given.
  'audio/mpeg': 'probably', 'audio/aac': 'probably', 'audio/flac': 'probably',
};
// Theora and the QuickTime container are absent on purpose: Chrome answers ""
// for both, so a blanket "known container" rule would over-report.
const _MEDIA_CODEC = /^(avc[13](\.[0-9a-f]{6})?|(?:hev1|hvc1)(\.[0-9a-z.]+)?|mp4a\.[0-9a-f]{2}(\.[0-9]+)?|vp0?[89](\.[0-9a-z.]+)?|av01(\.[0-9a-z.]+)?|vorbis|opus|flac|mp3|[12])$/i;

function _parseMediaType(raw) {
  const text = String(raw).trim();
  if (!text) return null;
  const parts = text.split(';');
  const container = parts[0].trim().toLowerCase();
  const match = /codecs\s*=\s*"?([^"]*)"?/i.exec(parts.slice(1).join(';'));
  const codecs = match
    ? match[1].split(',').map(codec => codec.trim().toLowerCase()).filter(Boolean)
    : [];
  return { container, codecs };
}

function _mediaSourceTypeSupported(raw) {
  const parsed = _parseMediaType(raw);
  if (!parsed) return false;
  const { container, codecs } = parsed;
  if (!codecs.length) return container === 'audio/mpeg' || container === 'audio/aac';
  const every = pattern => codecs.every(codec => pattern.test(codec));
  if (container === 'audio/mp4') return every(/^(?:mp4a\.|opus$)/);
  if (container === 'audio/webm') return every(/^(?:opus|vorbis)$/);
  if (container === 'video/mp4') {
    return every(/^(?:avc[13]\.|hev1\.|hvc1\.|av01\.|vp09\.|mp4a\.)/);
  }
  if (container === 'video/webm') {
    return every(/^(?:vp8$|vp9$|vp09\.|av01\.|opus$|vorbis$)/);
  }
  return false;
}

function _mediaCapabilityTypeSupported(raw) {
  const parsed = _parseMediaType(raw);
  if (!parsed) return false;
  const { container, codecs } = parsed;
  if (!codecs.length) {
    return container === 'audio/mpeg' || container === 'audio/aac'
      || container === 'audio/flac';
  }
  if (codecs.length !== 1) return false;
  const codec = codecs[0];
  if (container === 'audio/mp4') return /^(?:mp4a\.|opus$)/.test(codec);
  if (container === 'audio/webm') return /^(?:opus|vorbis)$/.test(codec);
  if (container === 'audio/ogg') return /^(?:vorbis|flac)$/.test(codec);
  if (container === 'audio/wav') return codec === '1';
  if (container === 'video/mp4') {
    return /^(?:avc[13]\.|hev1\.|hvc1\.|av01\.|vp09\.)/.test(codec);
  }
  if (container === 'video/webm') {
    return /^(?:vp8$|vp09\.|av01\.)/.test(codec);
  }
  return false;
}

function _canPlayMediaType(raw) {
  const text = String(raw).trim();
  if (!text) return '';
  const parts = text.split(';');
  const container = parts[0].trim().toLowerCase();
  const base = _MEDIA_CONTAINERS[container];
  if (!base) return '';
  const codecsParameter = parts.slice(1).join(';');
  const match = /codecs\s*=\s*"?([^"]*)"?/i.exec(codecsParameter);
  if (!match) return base;
  const codecs = match[1].split(',').map((codec) => codec.trim()).filter(Boolean);
  if (!codecs.length) return base;
  return codecs.every((codec) => _MEDIA_CODEC.test(codec)) ? 'probably' : '';
}

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
class HTMLAudioElement extends HTMLMediaElement {}
class HTMLObjectElement extends Element {
  get data() {
    const raw = this.getAttribute('data');
    if (!raw) return '';
    try { return new URL(raw, this.baseURI || globalThis.location?.href || 'about:blank').href; }
    catch (_error) { return raw; }
  }
  set data(value) { this.setAttribute('data', value); }
  get contentDocument() {
    const resolved = this.data;
    return resolved && _cspResourceAllows(resolved, 'object-src') ? null : null;
  }
  get contentWindow() { return null; }
}
class HTMLTrackElement extends Element {
  static NONE = 0;
  static LOADING = 1;
  static LOADED = 2;
  static ERROR = 3;
  get kind() { return this.getAttribute("kind") || "subtitles"; }
  set kind(value) { this.setAttribute("kind", value); }
  get src() { return this.getAttribute("src") || ""; }
  set src(value) { this.setAttribute("src", value); }
  get srclang() { return this.getAttribute("srclang") || ""; }
  set srclang(value) { this.setAttribute("srclang", value); }
  get label() { return this.getAttribute("label") || ""; }
  set label(value) { this.setAttribute("label", value); }
  get default() { return this.hasAttribute("default"); }
  set default(value) { value ? this.setAttribute("default", "") : this.removeAttribute("default"); }
  get readyState() { return HTMLTrackElement.LOADED; }
  get track() {
    if (!this._textTrack) {
      this._textTrack = new TextTrack(this, this.kind, this.label, this.srclang);
    }
    return this._textTrack;
  }
}
