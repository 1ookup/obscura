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

// Probe-sequence capture for the adapter entry points: requestAdapter
// arguments and the adapter-level surface walks.
(() => {
  if (typeof window === 'undefined' || !window.external || !window.external.tracelog) return;
  const gpuProto = globalThis.GPU && globalThis.GPU.prototype;
  if (gpuProto && typeof gpuProto.requestAdapter === 'function') {
    const d = Object.getOwnPropertyDescriptor(gpuProto, 'requestAdapter');
    const orig = d.value;
    Object.defineProperty(gpuProto, 'requestAdapter', {
      configurable: true, enumerable: d.enumerable,
      value(options) {
        try { window.external.tracelog('gpu.read', { s: 'requestAdapter', o: JSON.stringify(options || null) }); } catch (e) {}
        return orig.call(this, options);
      },
    });
  }
  const adProto = globalThis.GPUAdapter && globalThis.GPUAdapter.prototype;
  if (adProto) {
    for (const name of ['features', 'limits', 'info', 'isFallbackAdapter']) {
      const d = Object.getOwnPropertyDescriptor(adProto, name);
      if (!d || !d.get) continue;
      Object.defineProperty(adProto, name, {
        configurable: true, enumerable: d.enumerable,
        get() {
          try { window.external.tracelog('gpu.read', { s: 'adapter.' + name }); } catch (e) {}
          return d.get.call(this);
        },
      });
    }
    const origReq = adProto.requestDevice;
    if (typeof origReq === 'function') {
      adProto.requestDevice = function (options) {
        try { window.external.tracelog('gpu.read', { s: 'requestDevice', o: JSON.stringify(options || null).slice(0, 120) }); } catch (e) {}
        return origReq.call(this, options);
      };
    }
  }
})();
