// TimeRanges: `buffered`, `played` and `seekable` return one of these. Nothing
// is ever buffered here, so every list is empty -- but the objects have to
// exist, because a media element missing all three is not a media element in
// any browser. Chrome returns a *new* object per read; matching that keeps
// `video.buffered === video.buffered` false, as it is there.

const _timeRangesKey = Symbol('TimeRanges');

// VideoPlaybackQuality: all counters are zero because no frame is ever
// decoded, which is what the same counters read in a browser that has not
// started playback either.

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
