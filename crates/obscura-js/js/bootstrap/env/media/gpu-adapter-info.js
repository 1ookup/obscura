globalThis.GPUAdapterInfo = class GPUAdapterInfo {
  constructor() { throw new TypeError('Illegal constructor'); }
  get vendor() { return _webglProfile() === 'apple' ? 'apple' : 'intel'; }
  // Chrome answers the architecture its backend reports and leaves the field
  // empty where the backend reports none. A macOS Chrome on Apple silicon
  // answers `metal-3` -- the reference trace's adapter carries vendor `apple`
  // with that architecture -- while the Direct3D backend behind the Intel
  // profile keeps answering the empty string.
  get architecture() {
    const fingerprint = _fingerprint() || {};
    const configured = fingerprint.gpu && fingerprint.gpu.webgpuArchitecture;
    if (configured) return String(configured);
    return _webglProfile() === 'apple' ? 'metal-3' : '';
  }
  get device() { return ''; }
  get description() { return ''; }
  // Apple GPUs do not expose subgroups through the adapter info.
  get subgroupMinSize() { return _webglProfile() === 'apple' ? null : 8; }
  get subgroupMaxSize() { return _webglProfile() === 'apple' ? null : 32; }
  get [Symbol.toStringTag]() { return 'GPUAdapterInfo'; }
};
