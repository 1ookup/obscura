globalThis.GPUAdapterInfo = class GPUAdapterInfo {
  constructor() { throw new TypeError('Illegal constructor'); }
  get vendor() { return _webglProfile() === 'apple' ? 'apple' : 'intel'; }
  // Chrome reports the Metal feature family for an Apple GPU. An empty string
  // is not a value it produces for this adapter, and the profile selector
  // already decided the adapter is Apple.
  get architecture() {
    const fingerprint = _fingerprint() || {};
    const configured = fingerprint.gpu && fingerprint.gpu.webgpuArchitecture;
    if (configured) return String(configured);
    return _webglProfile() === 'apple' ? 'metal-3' : 'gen-9';
  }
  get device() { return ''; }
  get description() { return ''; }
  // Apple GPUs do not expose subgroups through the adapter info.
  get subgroupMinSize() { return _webglProfile() === 'apple' ? null : 8; }
  get subgroupMaxSize() { return _webglProfile() === 'apple' ? null : 32; }
  get isFallbackAdapter() { return false; }
  get [Symbol.toStringTag]() { return 'GPUAdapterInfo'; }
};
