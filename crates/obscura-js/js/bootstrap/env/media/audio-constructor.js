// Lightweight Audio constructor used when the media implementation does not
// provide one. Keep the same observable defaults as the previous fallback.
if (typeof Audio === 'undefined') {
  globalThis.Audio = class Audio {
    constructor(src) {
      this.src = src || ''; this.paused = true; this.volume = 1;
      this.currentTime = 0; this.duration = 0;
    }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
}
