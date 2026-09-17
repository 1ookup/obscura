globalThis.GPUAdapterInfo = class GPUAdapterInfo {
  constructor() { throw new TypeError('Illegal constructor'); }
  get vendor() { return _webglProfile() === 'apple' ? 'apple' : 'intel'; }
  // Chrome redacts the adapter architecture, so the read answers the empty
  // string; the profile-specific name was a value no browser produces.
  get architecture() {
    const fingerprint = _fingerprint() || {};
    const configured = fingerprint.gpu && fingerprint.gpu.webgpuArchitecture;
    if (configured) return String(configured);
    return '';
  }
  get device() { return ''; }
  get description() { return ''; }
  // Apple GPUs do not expose subgroups through the adapter info.
  get subgroupMinSize() { return _webglProfile() === 'apple' ? null : 8; }
  get subgroupMaxSize() { return _webglProfile() === 'apple' ? null : 32; }
  get [Symbol.toStringTag]() { return 'GPUAdapterInfo'; }
};
