// MediaSource: absent entirely before, which no Chrome build is. Its stricter
// container/codec rules intentionally differ from canPlayType, as in Chrome.
// An instance stays "closed" because nothing attaches it to a playing element.
if (typeof globalThis.MediaSource === 'undefined') {
  const MediaSource = class MediaSource extends EventTarget {
    constructor() {
      super();
      this._readyState = 'closed';
      this.sourceBuffers = [];
      this.activeSourceBuffers = [];
      this.duration = NaN;
      this.onsourceopen = null;
      this.onsourceended = null;
      this.onsourceclose = null;
    }
    get readyState() { return this._readyState; }
    addSourceBuffer(type) {
      // Reached only after `sourceopen`, which never fires here.
      throw new DOMException(
        "Failed to execute 'addSourceBuffer' on 'MediaSource': " +
        "The MediaSource's readyState is not 'open'.",
        'InvalidStateError');
    }
    removeSourceBuffer() {
      throw new DOMException(
        "Failed to execute 'removeSourceBuffer' on 'MediaSource': " +
        'The SourceBuffer provided is not contained in this MediaSource.',
        'NotFoundError');
    }
    endOfStream() {
      throw new DOMException(
        "Failed to execute 'endOfStream' on 'MediaSource': " +
        "The MediaSource's readyState is not 'open'.",
        'InvalidStateError');
    }
    setLiveSeekableRange() {}
    clearLiveSeekableRange() {}
    static isTypeSupported(type) { return _mediaSourceTypeSupported(type); }
    get [Symbol.toStringTag]() { return 'MediaSource'; }
  };
  _markNative(MediaSource);
  _markNative(MediaSource.isTypeSupported);
  globalThis.MediaSource = MediaSource;
}

// Worklet entry points. The `Worklet` interface object existed with nothing
// hanging off it: no `CSS.paintWorklet`, no `audioWorklet` on an AudioContext,
// both of which Chrome exposes and both of which are one-line feature
// detections. No worklet module can run here, so `addModule` always fails --
// with the exact error Chrome raises when a module cannot be fetched
// (`AbortError: Unable to load a worklet's module.`), so callers' existing
// failure paths handle it rather than a shape no browser produces.
(function _installWorkletEntryPoints() {
  const Worklet = globalThis.Worklet;
  if (typeof Worklet !== 'function') return;

  Object.defineProperty(Worklet.prototype, 'addModule', {
    // `options` carries a default so `addModule.length` is 1, as in Chrome.
    value: _markNative(function addModule(moduleURL, options = undefined) {
      if (arguments.length < 1) {
        return Promise.reject(new TypeError(
          "Failed to execute 'addModule' on 'Worklet': " +
          '1 argument required, but only 0 present.'));
      }
      let url;
      try { url = new URL(String(moduleURL), globalThis.location?.href || 'about:blank').href; }
      catch (error) { return Promise.reject(error); }
      return (async () => {
        try {
          const response = await fetch(url, {
            mode: 'cors', credentials: 'same-origin', redirect: 'follow',
          });
          if (response && response.ok) await response.text();
        } catch (_error) {}
        throw new DOMException("Unable to load a worklet's module.", 'AbortError');
      })();
    }),
    writable: true, enumerable: false, configurable: true,
  });

  const AudioWorklet = function () {
    throw new TypeError("Failed to construct 'AudioWorklet': Illegal constructor");
  };
  Object.defineProperty(AudioWorklet, 'name', {value: 'AudioWorklet', configurable: true});
  AudioWorklet.prototype = Object.create(Worklet.prototype);
  Object.defineProperty(AudioWorklet.prototype, 'constructor', {
    value: AudioWorklet, writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(AudioWorklet.prototype, Symbol.toStringTag, {
    value: 'AudioWorklet', configurable: true,
  });
  _markNative(AudioWorklet);
  globalThis.AudioWorklet = AudioWorklet;

  // Each entry point is one stable object, as in Chrome: `CSS.paintWorklet ===
  // CSS.paintWorklet`, and one audioWorklet per AudioContext.
  const paintWorklet = Object.create(Worklet.prototype);
  if (globalThis.CSS && typeof globalThis.CSS === 'object') {
    Object.defineProperty(globalThis.CSS, 'paintWorklet', {
      get: _markNative(function paintWorklet_() { return paintWorklet; }),
      enumerable: true, configurable: true,
    });
  }

  const audioWorklets = new WeakMap();
  if (typeof globalThis.AudioContext === 'function') {
    // OfflineAudioContext extends AudioContext, so it inherits this accessor
    // and gets its own worklet object through the same WeakMap.
    Object.defineProperty(globalThis.AudioContext.prototype, 'audioWorklet', {
      get: _markNative(function audioWorklet() {
        let worklet = audioWorklets.get(this);
        if (!worklet) {
          worklet = Object.create(AudioWorklet.prototype);
          audioWorklets.set(this, worklet);
        }
        return worklet;
      }),
      enumerable: true, configurable: true,
    });
  }
