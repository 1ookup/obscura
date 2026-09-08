// WebGPU, like WebGL above, is a consistency surface rather than an
// implementation: `requestAdapter()` resolved with `null`, so any page that
// walked the adapter got a TypeError instead of a machine description. The
// adapter described here is the same Intel part the WebGL renderer string
// claims, on D3D12 -- reporting an Apple adapter under a Windows user agent
// would trade one mismatch for a worse one. It follows the same
// `--stealth`-driven flag, so an engine with no GPU profile still answers
// `null` truthfully.
const _GPU_LIMITS = {
  maxTextureDimension1D: 16384,
  maxTextureDimension2D: 16384,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 2048,
  maxBindGroups: 4,
  maxBindGroupsPlusVertexBuffers: 24,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 8,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 10,
  maxStorageTexturesPerShaderStage: 8,
  maxUniformBuffersPerShaderStage: 12,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 2147483644,
  minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256,
  maxVertexBuffers: 8,
  maxBufferSize: 2147483648,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxInterStageShaderVariables: 28,
  maxColorAttachments: 8,
  maxColorAttachmentBytesPerSample: 64,
  maxComputeWorkgroupStorageSize: 32768,
  maxComputeInvocationsPerWorkgroup: 1024,
  maxComputeWorkgroupSizeX: 1024,
  maxComputeWorkgroupSizeY: 1024,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
  minSubgroupSize: 8,
  maxSubgroupSize: 32,
  maxStorageBuffersInFragmentStage: 10,
  maxStorageTexturesInFragmentStage: 8,
  maxStorageBuffersInVertexStage: 10,
  maxStorageTexturesInVertexStage: 8,
};
// The limits a device gets when it asks for none: the spec defaults, which
// are the same on every adapter.
const _GPU_DEFAULT_LIMITS = {
  maxTextureDimension1D: 8192, maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048, maxTextureArrayLayers: 256,
  maxBindGroups: 4, maxBindGroupsPlusVertexBuffers: 24,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12, maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728, minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256, maxVertexBuffers: 8,
  maxBufferSize: 268435456, maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048, maxInterStageShaderVariables: 16,
  maxColorAttachments: 8, maxColorAttachmentBytesPerSample: 32,
  maxComputeWorkgroupStorageSize: 16384, maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64, maxComputeWorkgroupsPerDimension: 65535,
  minSubgroupSize: 8, maxSubgroupSize: 32,
  maxStorageBuffersInFragmentStage: 8, maxStorageTexturesInFragmentStage: 4,
  maxStorageBuffersInVertexStage: 8, maxStorageTexturesInVertexStage: 4,
};
// An Intel part on D3D12: BC compression, no ASTC or ETC2, which are the
// mobile and Apple formats.
const _GPU_ADAPTER_FEATURES = [
  'depth32float-stencil8', 'rg11b10ufloat-renderable', 'bgra8unorm-storage',
  'texture-formats-tier1', 'texture-compression-bc', 'dual-source-blending',
  'core-features-and-limits', 'float32-filterable', 'indirect-first-instance',
  'float32-blendable', 'depth-clip-control', 'texture-compression-bc-sliced-3d',
  'texture-formats-tier2', 'shader-f16', 'clip-distances',
  'texture-component-swizzle', 'subgroups',
];
// The Apple/Metal adapter a macOS fingerprint claims. Feature order is the
// captured order; subgroup limits are absent (null) on Apple GPUs.
const _GPU_APPLE = {
  limits: {
    maxTextureDimension1D: 16384,
    maxTextureDimension2D: 16384,
    maxTextureDimension3D: 2048,
    maxTextureArrayLayers: 2048,
    maxBindGroups: 4,
    maxBindGroupsPlusVertexBuffers: 24,
    maxBindingsPerBindGroup: 1000,
    maxDynamicUniformBuffersPerPipelineLayout: 10,
    maxDynamicStorageBuffersPerPipelineLayout: 8,
    maxSampledTexturesPerShaderStage: 48,
    maxSamplersPerShaderStage: 16,
    maxStorageBuffersPerShaderStage: 10,
    maxStorageTexturesPerShaderStage: 8,
    maxUniformBuffersPerShaderStage: 12,
    maxUniformBufferBindingSize: 65536,
    maxStorageBufferBindingSize: 4294967292,
    minUniformBufferOffsetAlignment: 256,
    minStorageBufferOffsetAlignment: 256,
    maxVertexBuffers: 8,
    maxBufferSize: 4294967292,
    maxVertexAttributes: 30,
    maxVertexBufferArrayStride: 2048,
    maxInterStageShaderVariables: 28,
    maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 128,
    maxComputeWorkgroupStorageSize: 32768,
    maxComputeInvocationsPerWorkgroup: 1024,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeWorkgroupSizeY: 1024,
    maxComputeWorkgroupSizeZ: 64,
    maxComputeWorkgroupsPerDimension: 65535,
    minSubgroupSize: null,
    maxSubgroupSize: null,
    maxStorageBuffersInFragmentStage: 10,
    maxStorageTexturesInFragmentStage: 8,
    maxStorageBuffersInVertexStage: 10,
    maxStorageTexturesInVertexStage: 8,
  },
  features: [
    'core-features-and-limits', 'depth-clip-control', 'indirect-first-instance',
    'shader-f16', 'rg11b10ufloat-renderable', 'bgra8unorm-storage',
    'float32-filterable', 'float32-blendable', 'clip-distances', 'dual-source-blending',
    'texture-compression-bc', 'texture-compression-bc-sliced-3d',
    'texture-compression-astc', 'texture-compression-astc-sliced-3d',
    'texture-compression-etc2', 'texture-formats-tier1', 'texture-formats-tier2',
    'texture-component-swizzle', 'depth32float-stencil8', 'subgroups',
  ],
};
function _gpuAdapterProfile() {
  return _webglProfile() === 'apple' ? _GPU_APPLE : {
    limits: _GPU_LIMITS, features: _GPU_ADAPTER_FEATURES,
  };
}
// A property of the Chrome build, not of the adapter.
const _GPU_WGSL_FEATURES = [
  'packed_4x8_integer_dot_product', 'subgroup_uniformity', 'subgroup_id',
  'linear_indexing', 'readonly_and_readwrite_storage_textures',
  'unrestricted_pointer_parameters', 'texture_and_sampler_let',
  'pointer_composite_access', 'uniform_buffer_standard_layout',
];

function _gpuSupportedLimits(values) {
  const limits = Object.create(globalThis.GPUSupportedLimits.prototype);
  for (const name of Object.keys(values)) {
    Object.defineProperty(limits, name, {
      value: values[name], enumerable: false, configurable: true,
    });
  }
  return limits;
}
// GPUSupportedFeatures is a setlike, so it answers `has`, iterates, and
// reports `size` -- a plain Array would fail every one of those checks.
function _gpuSupportedFeatures(names) {
  const features = Object.create(globalThis.GPUSupportedFeatures.prototype);
  const backing = new Set(names);
  Object.defineProperty(features, '_set', { value: backing, configurable: true });
  return features;
}

// The WebGPU usage/stage constants Chrome hangs off the global. Spec values,
// identical across implementations.
globalThis.GPUBufferUsage = { MAP_READ: 0x0001, MAP_WRITE: 0x0002, COPY_SRC: 0x0004, COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080, INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200 };
globalThis.GPUColorWrite = { RED: 0x1, GREEN: 0x2, BLUE: 0x4, ALPHA: 0x8, ALL: 0xF };
globalThis.GPUMapMode = { READ: 0x1, WRITE: 0x2 };
globalThis.GPUShaderStage = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };
globalThis.GPUTextureUsage = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10 };
