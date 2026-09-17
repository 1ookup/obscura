// WebGPU collection factories.  GPUSupportedLimits and GPUSupportedFeatures
// are interface objects, not plain records; the shape constructors live in
// their dedicated modules while profile selection stays in webgpu.js.
// The per-instance limit values. They ride a symbol rather than own string
// properties: an own property shadows the prototype's getter, and a page that
// enumerates the limits (`for...in`, which is how a fingerprint probe walks
// them) then sees the interface's members and no values. Chrome's own object
// has no own members at all, every limit being a prototype getter.
const _gpuLimitValues = Symbol('GPUSupportedLimits values');

function _webgpuMakeSupportedLimits(values) {
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
