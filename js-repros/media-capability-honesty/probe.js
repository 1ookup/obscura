globalThis.mediaFixturePromise = (async () => {
  const out = {};
  const video = document.createElement('video');
  const audio = document.createElement('audio');
  out.videoCtor = video.constructor.name;
  out.videoTag = Object.prototype.toString.call(video);
  out.geometry = {
    videoWidth: video.videoWidth, videoHeight: video.videoHeight,
    duration: String(video.duration), currentTime: video.currentTime,
    readyState: video.readyState, networkState: video.networkState,
    paused: video.paused, ended: video.ended, error: String(video.error),
    seeking: video.seeking, buffered: video.buffered ? video.buffered.length : 'missing',
    played: video.played ? video.played.length : 'missing',
    seekable: video.seekable ? video.seekable.length : 'missing',
  };
  out.canPlayType = {};
  for (const type of [
    'video/mp4', 'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    'video/webm', 'video/webm; codecs="vp8"', 'video/webm; codecs="vp9"',
    'video/webm; codecs="vp8, vorbis"', 'video/ogg', 'video/ogg; codecs="theora"',
    'video/mp4; codecs="av01.0.05M.08"', 'video/x-matroska', 'video/quicktime',
    'video/3gpp', 'application/x-mpegURL', 'application/vnd.apple.mpegurl',
    'video/nonsense', '', 'video/mp4; codecs="nope"',
    'audio/mpeg', 'audio/mp4', 'audio/mp4; codecs="mp4a.40.2"',
    'audio/aac', 'audio/wav', 'audio/wav; codecs="1"', 'audio/ogg',
    'audio/ogg; codecs="vorbis"', 'audio/webm', 'audio/webm; codecs="opus"',
    'audio/flac', 'audio/x-flac', 'audio/basic',
  ]) {
    out.canPlayType[type || '(empty)'] =
      (type.startsWith('audio/') ? audio : video).canPlayType(type);
  }
  out.timeRanges = (() => {
    const ranges = video.buffered;
    if (!ranges) return 'missing';
    return {
      tag: Object.prototype.toString.call(ranges),
      ctor: ranges.constructor && ranges.constructor.name,
      length: ranges.length,
      startThrows: (() => {
        try { ranges.start(0); return 'no-throw'; }
        catch (e) { return e.name; }
      })(),
      sameObject: video.buffered === video.buffered,
    };
  })();
  out.playbackQuality = typeof video.getVideoPlaybackQuality === 'function'
    ? (() => {
        const quality = video.getVideoPlaybackQuality();
        return {
          tag: Object.prototype.toString.call(quality),
          keys: Object.keys(quality.constructor.prototype || {}).length,
          droppedVideoFrames: quality.droppedVideoFrames,
          totalVideoFrames: quality.totalVideoFrames,
          creationTimeType: typeof quality.creationTime,
        };
      })()
    : 'missing';
  out.mediaSourceShape = typeof globalThis.MediaSource === 'function'
    ? {
        isTypeSupportedType: typeof MediaSource.isTypeSupported,
        mp4: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
        webm: MediaSource.isTypeSupported('video/webm; codecs="vp9"'),
        nonsense: MediaSource.isTypeSupported('video/nonsense'),
        instanceTag: (() => {
          try { return Object.prototype.toString.call(new MediaSource()); }
          catch (e) { return 'threw:' + e.name; }
        })(),
        readyState: (() => {
          try { return new MediaSource().readyState; } catch (e) { return 'threw'; }
        })(),
      }
    : 'missing';
  out.constants = {
    HAVE_NOTHING: video.HAVE_NOTHING, HAVE_METADATA: video.HAVE_METADATA,
    NETWORK_EMPTY: video.NETWORK_EMPTY, NETWORK_NO_SOURCE: video.NETWORK_NO_SOURCE,
  };
  const playResult = (() => { try { const r = video.play(); return r && typeof r.then === 'function' ? 'promise' : String(r); } catch (e) { return 'threw:' + e.name; } })();
  out.playReturns = playResult;
  if (playResult === 'promise') {
    out.playSettles = await video.play().then(() => 'fulfilled', e => 'rejected:' + e.name);
  }
  out.loadType = typeof video.load;
  out.requestVideoFrameCallback = typeof video.requestVideoFrameCallback;
  out.getVideoPlaybackQuality = typeof video.getVideoPlaybackQuality;
  out.mediaCapabilities = typeof navigator.mediaCapabilities;
  if (navigator.mediaCapabilities) {
    out.decodingInfo = await navigator.mediaCapabilities.decodingInfo({
      type: 'file', video: {contentType: 'video/mp4; codecs="avc1.42E01E"', width: 640, height: 480, bitrate: 1000, framerate: 30},
    }).then(r => ({supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient}), e => 'rejected:' + e.name);
  }
  out.mediaSource = typeof globalThis.MediaSource;
  if (typeof MediaSource === 'function' && MediaSource.isTypeSupported) {
    out.msSupported = MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
  }
  globalThis.mediaFixtureResult = out;
  return out;
})();
