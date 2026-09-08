globalThis.GPUDevice = class GPUDevice {
  constructor() { throw new TypeError('Illegal constructor'); }
  get features() { return _gpuSupportedFeatures(['core-features-and-limits']); }
  get limits() {
    const base = _gpuSupportedLimits(_GPU_DEFAULT_LIMITS);
    if (_webglProfile() === 'apple') {
      Object.defineProperty(base, 'minSubgroupSize', { value: null, enumerable: false, configurable: true });
      Object.defineProperty(base, 'maxSubgroupSize', { value: null, enumerable: false, configurable: true });
    }
    return base;
  }
  get adapterInfo() { return Object.create(globalThis.GPUAdapterInfo.prototype); }
  get label() { return ''; }
  get lost() { return new Promise(() => {}); }
  get queue() { return { label: '', submit() {}, onSubmittedWorkDone() { return Promise.resolve(); } }; }
  destroy() {}
  get [Symbol.toStringTag]() { return 'GPUDevice'; }
};
