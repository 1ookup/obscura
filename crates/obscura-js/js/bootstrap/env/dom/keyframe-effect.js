class KeyframeEffect {
  constructor(target, keyframes, options) {
    if (!(target instanceof Element)) throw new TypeError('KeyframeEffect target must be an Element');
    this.target = target;
    this._keyframes = _normalizeWaapiKeyframes(keyframes);
    this._timing = _normalizeWaapiTiming(options);
  }
  getKeyframes() { return this._keyframes.map(frame => ({ ...frame, computedOffset: frame.offset, easing: 'linear', composite: 'auto' })); }
  getTiming() {
    const timing = this._timing;
    return {
      delay: timing.delay, endDelay: 0, fill: timing.fill,
      iterationStart: 0, iterations: timing.iterations,
      duration: timing.duration, direction: timing.direction, easing: timing.easing,
    };
  }
  getComputedTiming() {
    const animation = this._animation;
    const local = animation ? animation.currentTime : 0;
    const activeDuration = this._timing.duration * this._timing.iterations;
    const endTime = this._timing.delay + activeDuration;
    const progress = activeDuration > 0 ? Math.max(0, Math.min(1, (local - this._timing.delay) / activeDuration)) : null;
    return {
      ...this.getTiming(), activeDuration, endTime, localTime: local,
      progress, currentIteration: progress == null ? null : Math.min(this._timing.iterations, 1),
    };
  }
}
