globalThis.GPU = class GPU {
  constructor() { throw new TypeError('Illegal constructor'); }
  requestAdapter(options) {
    // Without the consistency profile there is no adapter to describe, which
    // is also what Chrome answers when the GPU is unavailable. A fallback
    // request resolves null as well: there is no SwiftShader behind the
    // hardware profile.
    if (!globalThis.__obscura_webgl_enabled) return Promise.resolve(null);
    if (options && options.forceFallbackAdapter) return Promise.resolve(null);
    // webgpu's Permissions-Policy default allowlist is 'self': a frame whose
    // origin differs from its embedder's without an allow="webgpu"
    // delegation reads a null adapter (the challenge's cross-origin widget
    // chain then answers "unavailable" instead of running a device census).
    if (typeof _permissionPolicyAllows === 'function'
        && !_permissionPolicyAllows('webgpu')) {
      return Promise.resolve(null);
    }
    return Promise.resolve(Object.create(globalThis.GPUAdapter.prototype));
  }
  getPreferredCanvasFormat() { return 'bgra8unorm'; }
  get wgslLanguageFeatures() {
    // WGSL feature sets carry their own interface, so the read answers
    // `[object WGSLLanguageFeatures]` and not the adapter's feature set.
    const features = _gpuSupportedFeatures(_GPU_WGSL_FEATURES);
    try {
      // Brand only: replacing the prototype would drop the setlike surface
      // (size/has/iteration) that the feature set shares with the adapter.
      Object.defineProperty(features, Symbol.toStringTag, {
        value: 'WGSLLanguageFeatures', configurable: true,
      });
    } catch (_error) {}
    return features;
  }
  get [Symbol.toStringTag]() { return 'GPU'; }
};
navigator.gpu = Object.create(globalThis.GPU.prototype);
