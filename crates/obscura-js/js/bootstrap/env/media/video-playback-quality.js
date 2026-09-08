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

// Class accessors are non-enumerable; WebIDL attributes are enumerable.
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
