// WebGPU collection factories.  GPUSupportedLimits and GPUSupportedFeatures
// are interface objects, not plain records; the shape constructors live in
// their dedicated modules while profile selection stays in webgpu.js.
// The per-instance limit values. They ride a symbol rather than own string
// properties: an own property shadows the prototype's getter, and a page that
// enumerates the limits (`for...in`, which is how a fingerprint probe walks
// them) then sees the interface's members and no values. Chrome's own object
// has no own members at all, every limit being a prototype getter.
const _gpuLimitValues = Symbol('GPUSupportedLimits values');

let _gpuLimitsMembersInstalled = false;
function _webgpuInstallLimitsMembers(names) {
  if (_gpuLimitsMembersInstalled) return;
  _gpuLimitsMembersInstalled = true;
  const proto = globalThis.GPUSupportedLimits.prototype;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name !== 'constructor') delete proto[name];
  }
  for (const name of names) {
    // Each member is an interface accessor half: Chrome answers
    // 'function get maxTextureDimension1D() { [native code] }' with
    // [length, name] owned and no prototype slot. A bare method shorthand
    // keeps the shape but stringifies as source, so the getter is named
    // after its kind and goes through the method-literal wrapper.
    const getter = function () {
      const vals = this[_gpuLimitValues];
      return vals ? vals[name] : undefined;
    };
    Object.defineProperty(getter, 'name', { value: 'get ' + name, configurable: true });
    Object.defineProperty(proto, name, {
      get: _obscuraMethodLiteral(getter),
      enumerable: true, configurable: true,
    });
  }
}

function _webgpuMakeSupportedLimits(values) {
  // The member SET follows the active adapter profile, installed at first
  // instance construction: at bootstrap-snapshot time the realm fingerprint
  // is not seeded yet and every profile would collapse to the reference
  // table (38 members with immediate/subgroup slots; the live Chromium 149
  // on this machine walks 35 with neither on the Apple profile).
  _webgpuInstallLimitsMembers(Object.keys(values));
  const limits = Object.create(globalThis.GPUSupportedLimits.prototype);
  Object.defineProperty(limits, _gpuLimitValues, {
    value: values, enumerable: false, configurable: true,
  });
  return limits;
}

function _webgpuMakeSupportedFeatures(names) {
  const features = Object.create(globalThis.GPUSupportedFeatures.prototype);
  const backing = new Set(names);
  Object.defineProperty(features, '_set', {value: backing, configurable: true});
  return features;
}
