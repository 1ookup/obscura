globalThis.GPUAdapterInfo = class GPUAdapterInfo {
  constructor() { throw new TypeError('Illegal constructor'); }
  get vendor() { return _webglProfile() === 'apple' ? 'apple' : 'intel'; }
  // Chrome answers the architecture its backend reports and leaves the field
  // empty where the backend reports none. The live passing sessions answer
  // the empty string here -- vendor `apple` with no architecture, device or
  // description (five sessions, byte-identical info rows) -- while a
  // fingerprint override keeps the older shape reachable.
  get architecture() {
    const fingerprint = _fingerprint() || {};
    const configured = fingerprint.gpu && fingerprint.gpu.webgpuArchitecture;
    if (configured) return String(configured);
    return '';
  }
  get device() { return ''; }
  get description() { return ''; }
  // The live adapter rows answer 0 for both subgroup bounds on the apple
  // profile -- no nulls, and no subgroup feature exposure.
  get subgroupMinSize() { return _webglProfile() === 'apple' ? 0 : 8; }
  get subgroupMaxSize() { return _webglProfile() === 'apple' ? 0 : 32; }
  // A no-argument requestAdapter on the Mac integrated GPU lands its power
  // class on the info row: 'low-power', not the 'default' a missing field
  // would fall back to.
  get powerPreference() { return _webglProfile() === 'apple' ? 'low-power' : 'default'; }
  get [Symbol.toStringTag]() { return 'GPUAdapterInfo'; }
};
