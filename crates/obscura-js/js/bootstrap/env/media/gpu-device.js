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
  // One queue per device, sharing the recorded command stream the encoders
  // feed, so a submitted pass actually reaches the readback path.
  get queue() {
    let queue = _gpuDeviceQueues.get(this);
    if (!queue) {
      queue = new globalThis.GPUQueue(_gpuDeviceHandles.key(), this);
      _gpuDeviceQueues.set(this, queue);
    }
    return queue;
  }
  createTexture(descriptor) {
    return new globalThis.GPUTexture(_gpuDeviceHandles.key(), descriptor);
  }
  createBuffer(descriptor) {
    return new globalThis.GPUBuffer(_gpuDeviceHandles.key(), descriptor);
  }
  createSampler(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    return new globalThis.GPUSampler(_gpuDeviceHandles.key(), source.label);
  }
  createShaderModule(descriptor) {
    return new globalThis.GPUShaderModule(_gpuDeviceHandles.key(), descriptor);
  }
  createBindGroupLayout(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    return new globalThis.GPUBindGroupLayout(_gpuDeviceHandles.key(), source.label);
  }
  createBindGroup(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    return new globalThis.GPUBindGroup(_gpuDeviceHandles.key(), source.label);
  }
  createPipelineLayout(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    return new globalThis.GPUPipelineLayout(_gpuDeviceHandles.key(), source.label);
  }
  createRenderPipeline(descriptor) {
    return new globalThis.GPURenderPipeline(_gpuDeviceHandles.key(), descriptor);
  }
  createComputePipeline(descriptor) {
    return new globalThis.GPUComputePipeline(_gpuDeviceHandles.key(), descriptor);
  }
  createRenderPipelineAsync(descriptor) {
    return Promise.resolve(new globalThis.GPURenderPipeline(_gpuDeviceHandles.key(), descriptor));
  }
  createComputePipelineAsync(descriptor) {
    return Promise.resolve(new globalThis.GPUComputePipeline(_gpuDeviceHandles.key(), descriptor));
  }
  createCommandEncoder(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const encoder = new globalThis.GPUCommandEncoder(_gpuDeviceHandles.key(), source.label);
    _gpuDeviceHandles.register(this, encoder);
    return encoder;
  }
  destroy() {}
  pushErrorScope() {}
  popErrorScope() {
    return Promise.resolve(null);
  }
  get [Symbol.toStringTag]() { return 'GPUDevice'; }
};
