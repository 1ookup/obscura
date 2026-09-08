globalThis.GPU = class GPU {
  constructor() { throw new TypeError('Illegal constructor'); }
  requestAdapter(options) {
    // Without the consistency profile there is no adapter to describe, which
    // is also what Chrome answers when the GPU is unavailable. A fallback
    // request resolves null as well: there is no SwiftShader behind the
    // hardware profile.
    if (!globalThis.__obscura_webgl_enabled) return Promise.resolve(null);
    if (options && options.forceFallbackAdapter) return Promise.resolve(null);
    return Promise.resolve(Object.create(globalThis.GPUAdapter.prototype));
  }
  getPreferredCanvasFormat() { return 'bgra8unorm'; }
  get wgslLanguageFeatures() { return _gpuSupportedFeatures(_GPU_WGSL_FEATURES); }
  get [Symbol.toStringTag]() { return 'GPU'; }
};
navigator.gpu = Object.create(globalThis.GPU.prototype);
