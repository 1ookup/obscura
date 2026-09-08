// The canvas half of the WebGPU surface: enough for a probe that configures
// a context and reads the configuration back. No texture contents exist.
globalThis.GPUCanvasContext = class GPUCanvasContext {
  constructor(canvas) { this.canvas = canvas; this._configuration = null; }
  configure(configuration) {
    const config = configuration || {};
    this._configuration = {
      device: config.device,
      format: config.format || 'bgra8unorm',
      usage: typeof config.usage === 'number' ? config.usage : 0x10,
      alphaMode: config.alphaMode || 'premultiplied',
      colorSpace: 'srgb',
      toneMapping: { mode: 'standard' },
      viewFormats: Array.isArray(config.viewFormats) ? config.viewFormats.slice() : [],
    };
  }
  unconfigure() { this._configuration = null; }
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

