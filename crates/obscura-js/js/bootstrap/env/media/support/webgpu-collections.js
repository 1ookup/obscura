// WebGPU collection factories.  GPUSupportedLimits and GPUSupportedFeatures
// are interface objects, not plain records; the shape constructors live in
// their dedicated modules while profile selection stays in webgpu.js.
function _webgpuMakeSupportedLimits(values) {
  const limits = Object.create(globalThis.GPUSupportedLimits.prototype);
  for (const name of Object.keys(values)) {
    Object.defineProperty(limits, name, {
      value: values[name], enumerable: false, configurable: true,
    });
  }
  return limits;
}

function _webgpuMakeSupportedFeatures(names) {
  const features = Object.create(globalThis.GPUSupportedFeatures.prototype);
  const backing = new Set(names);
  Object.defineProperty(features, '_set', {value: backing, configurable: true});
  return features;
}
