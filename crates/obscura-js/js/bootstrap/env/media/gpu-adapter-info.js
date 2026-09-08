globalThis.GPUAdapterInfo = class GPUAdapterInfo {
  constructor() { throw new TypeError('Illegal constructor'); }
  get vendor() { return _webglProfile() === 'apple' ? 'apple' : 'intel'; }
  get architecture() { return _webglProfile() === 'apple' ? '' : 'gen-9'; }
  get device() { return ''; }
  get description() { return ''; }
  // Apple GPUs do not expose subgroups through the adapter info.
  get subgroupMinSize() { return _webglProfile() === 'apple' ? null : 8; }
  get subgroupMaxSize() { return _webglProfile() === 'apple' ? null : 32; }
  get isFallbackAdapter() { return false; }
  get [Symbol.toStringTag]() { return 'GPUAdapterInfo'; }
};
