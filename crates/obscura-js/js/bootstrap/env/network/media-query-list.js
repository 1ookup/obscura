// MediaQueryList compatibility shape. matchMedia currently returns its own
// lightweight record from tools/encoding-media-query.js; keep this constructor
// available for feature detection without changing that established behavior.
if (typeof MediaQueryList === 'undefined') {
  globalThis.MediaQueryList = class MediaQueryList {
    constructor(query) { this.media = query || ''; this.matches = false; }
    addListener() {}
    removeListener() {}
    addEventListener() {}
    removeEventListener() {}
  };
}
