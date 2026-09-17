globalThis.GPUAdapter = class GPUAdapter {
  constructor() { throw new TypeError('Illegal constructor'); }
  get features() { return _gpuSupportedFeatures(_gpuAdapterProfile().features); }
  get limits() { return _gpuSupportedLimits(_gpuAdapterProfile().limits); }
  get info() { return Object.create(globalThis.GPUAdapterInfo.prototype); }
  get isFallbackAdapter() { return false; }
  requestAdapterInfo() { return Promise.resolve(this.info); }
  requestDevice() {
    return Promise.resolve(Object.create(globalThis.GPUDevice.prototype));
  }
  get [Symbol.toStringTag]() { return 'GPUAdapter'; }
};
