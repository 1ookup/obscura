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

// Probe-sequence capture: the challenge walks the adapter info row before
// assembling one of its stats blocks, and the read order is what ties each
// reported value to the surface it came from. Getters log their own reads;
// with tracelog unconfigured this is one boolean check per read.
(() => {
  if (typeof window === 'undefined' || !window.external || !window.external.tracelog) return;
  const proto = globalThis.GPUAdapterInfo && globalThis.GPUAdapterInfo.prototype;
  if (!proto) return;
  for (const name of ['vendor', 'architecture', 'device', 'description',
      'subgroupMinSize', 'subgroupMaxSize', 'powerPreference']) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.get) continue;
    Object.defineProperty(proto, name, {
      configurable: true, enumerable: d.enumerable,
      get() {
        try { window.external.tracelog('gpu.read', { s: 'info.' + name }); } catch (e) {}
        return d.get.call(this);
      },
    });
  }
})();
