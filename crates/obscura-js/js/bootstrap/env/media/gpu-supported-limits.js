globalThis.GPUSupportedLimits = class GPUSupportedLimits {
  constructor() { throw new TypeError('Illegal constructor'); }
  get [Symbol.toStringTag]() { return 'GPUSupportedLimits'; };
};
// The limit members are NOT installed here: at bootstrap-snapshot time the
// realm fingerprint is not seeded yet, so any profile query collapses to the
// Intel reference table (38 members with immediate/subgroup slots) whatever
// the eventual identity. webgpu-collections installs the active profile's
// member set -- the live Chromium 149 on this machine walks 35 with neither
// slot on the Apple profile -- at first limits-instance construction, when
// the profile is known.
