// The canvas half of the WebGPU surface: enough for a probe that configures
// a context and reads the configuration back. No texture contents exist.
globalThis.GPUCanvasContext = class GPUCanvasContext {
  constructor(canvas) { this.canvas = canvas; _hset(this, "_configuration", null); }
  configure(configuration) {
    const config = configuration || {};
    // The reference has no HDR canvas path: a non-standard toneMapping mode
    // is accepted silently but the configured context answers 'standard' --
    // the getConfiguration() read-back is what a support probe sees.
    const requestedMode = config.toneMapping && config.toneMapping.mode;
    _hset(this, "_configuration", {
      device: config.device,
      format: config.format || 'bgra8unorm',
      usage: typeof config.usage === 'number' ? config.usage : 0x10,
      alphaMode: config.alphaMode || 'premultiplied',
      colorSpace: 'srgb',
      toneMapping: { mode: requestedMode === 'hdr' ? 'standard' : (requestedMode || 'standard') },
      viewFormats: Array.isArray(config.viewFormats) ? config.viewFormats.slice() : [],
    });
  }
  unconfigure() { _hset(this, "_configuration", null); }
  getConfiguration() {
    if (!this._configuration) return null;
    const config = this._configuration;
    return {
      device: config.device,
      format: config.format,
      usage: config.usage,
      alphaMode: config.alphaMode,
      colorSpace: config.colorSpace,
      toneMapping: { mode: config.toneMapping.mode },
      viewFormats: config.viewFormats.slice(),
    };
  }
  getCurrentTexture() {
    if (!this._configuration) {
      throw new DOMException('Failed to execute \'getCurrentTexture\' on \'GPUCanvasContext\': context is not configured.', 'InvalidStateError');
    }
    return {
      get [Symbol.toStringTag]() { return 'GPUTexture'; },
      createView() { return { get [Symbol.toStringTag]() { return 'GPUTextureView'; } }; },
      destroy() {},
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }
  get [Symbol.toStringTag]() { return 'GPUCanvasContext'; }
};

navigator.wakeLock = { request() { return Promise.reject(new DOMException('Not allowed', 'NotAllowedError')); } };

globalThis.opener = null;


// Probe-sequence capture for the canvas configuration: the toneMapping and
// alphaMode a probe asks for land here before the read-back.
(() => {
  if (typeof window === 'undefined' || !window.external || !window.external.tracelog) return;
  const proto = globalThis.GPUCanvasContext && globalThis.GPUCanvasContext.prototype;
  if (!proto || typeof proto.configure !== 'function') return;
  const d = Object.getOwnPropertyDescriptor(proto, 'configure');
  const orig = d.value;
  proto.configure = function (configuration) {
    try {
      window.external.tracelog('gpu.read', {
        s: 'configure',
        o: JSON.stringify(configuration || null, (k, v) => (k === 'device' ? 'GPUDevice' : v)).slice(0, 200),
      });
    } catch (e) {}
    return orig.call(this, configuration);
  };
})();
