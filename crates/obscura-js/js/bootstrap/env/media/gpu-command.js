// WebGPU device-side objects: textures, buffers, shader modules, pipelines,
// command encoders/passes and the queue.
//
// This consistency layer does not execute GPU workloads, but a page that
// probes WebGPU does not stop at adapter and device: it allocates a render
// target, draws into it, copies the result back and reads the pixels. A
// device missing `createTexture`/`createBuffer`/`createCommandEncoder` makes
// that first call throw, which rejects the probe's promise chain and leaves
// the values it derives undefined -- an observable difference from Chrome
// that has nothing to do with the values themselves.
//
// The readback is therefore produced on the CPU: a submitted render pass is
// rasterized with the same analytic coverage policy as the 2D canvas surface
// (4x4 supersampling), honouring the recorded clear colour, the target
// format and size, and the triangle the recorded shader module describes.
// Page-visible shapes and lifetimes follow the specification closely enough
// that feature detection, serialization and error handling behave as they do
// against a real device.
const _gpuKey = Symbol('obscura.webgpu.construct');

const _gpuTextureState = new WeakMap();
const _gpuBufferState = new WeakMap();
const _gpuEncoderState = new WeakMap();
const _gpuPassState = new WeakMap();
const _gpuQueueState = new WeakMap();
const _gpuDeviceQueues = new WeakMap();
const _gpuDeviceEncoders = new WeakMap();

// Device-side plumbing shared with the GPUDevice class: the private
// constructor key, the per-device queue cache, and the encoders a device has
// handed out (a queue submit drains them).
const _gpuDeviceHandles = {
  key() { return _gpuKey; },
  register(device, encoder) {
    let list = _gpuDeviceEncoders.get(device);
    if (!list) {
      list = [];
      _gpuDeviceEncoders.set(device, list);
    }
    list.push(encoder);
  },
};

const _GPU_MAP_READ = 1;
const _GPU_COPY_DST = 8;
const _GPU_COPY_SRC = 4;
const _GPU_RENDER_ATTACHMENT = 16;

// A texture size is either a single extent or the [width, height, depth]
// sequence the specification describes.
function _gpuTextureExtents(size) {
  if (Array.isArray(size)) {
    return {
      width: Number(size[0]),
      height: Number(size[1]),
      depthOrArrayLayers: size.length > 2 ? Number(size[2]) : 1,
    };
  }
  if (size && typeof size === 'object') return size;
  return { width: Number(size), height: 1, depthOrArrayLayers: 1 };
}

// Chrome's default copyTextureToBuffer row pitch: 256-byte aligned.
function _gpuAlignedBytesPerRow(width, bytesPerPixel) {
  const row = width * bytesPerPixel;
  return Math.ceil(row / 256) * 256;
}

// Vertex positions from a WGSL module. The probes this layer exists for draw
// a fixed triangle with an `array<vec2f,3>(vec2f(..),vec2f(..),vec2f(..))`
// literal; a shader without one falls back to the full-viewport triangle so
// the readback still covers the target.
function _gpuVertexPositions(code) {
  const text = String(code || '');
  const marker = text.indexOf('array<vec2f,3>');
  if (marker >= 0) {
    const positions = [];
    const re = /vec2f\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
    re.lastIndex = marker;
    let match = re.exec(text);
    while (match && positions.length < 3) {
      positions.push([Number(match[1]), Number(match[2])]);
      match = re.exec(text);
    }
    if (positions.length === 3) return positions;
  }
  return [[-1, -1], [3, -1], [-1, 3]];
}

// The colour a fragment shader returns. A literal `return vec4f(r,g,b,a)` is
// honoured; anything else falls back to opaque white, which is what an
// unlit triangle reads back as.
function _gpuFragmentColour(code) {
  const text = String(code || '');
  const match = /return\s+vec4f\(\s*([^)]*)\)/.exec(text.slice(text.indexOf('@fragment')));
  if (match) {
    const parts = match[1].split(',').map(value => Number(value.trim()));
    if (parts.length >= 3 && parts.every(value => Number.isFinite(value))) {
      const alpha = parts.length > 3 ? parts[3] : 1;
      const toByte = value => Math.max(0, Math.min(255, Math.round(value * 255)));
      return [toByte(parts[0]), toByte(parts[1]), toByte(parts[2]), toByte(alpha)];
    }
  }
  return [255, 255, 255, 255];
}

// Rasterize one triangle into an RGBA8 target with 4x4 supersampling. Clip
// space is y-up, the target is y-down, and a vertex outside the viewport is
// clipped by the sampler naturally because coverage is tested per sample.
function _gpuRasterizeTriangle(pixels, width, height, vertices, colour) {
  const sampled = [[-0.375, -0.375], [0.375, -0.375], [-0.375, 0.375], [0.375, 0.375]];
  const [ax, ay] = vertices[0];
  const [bx, by] = vertices[1];
  const [cx, cy] = vertices[2];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let covered = 0;
      for (const [dx, dy] of sampled) {
        const nx = ((x + 0.5 + dx) / width) * 2 - 1;
        const ny = 1 - ((y + 0.5 + dy) / height) * 2;
        const w0 = ((bx - nx) * (cy - ny) - (by - ny) * (cx - nx)) / area;
        const w1 = ((cx - nx) * (ay - ny) - (cy - ny) * (ax - nx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) covered++;
      }
      if (covered === 0) continue;
      const alpha = covered / sampled.length;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const previous = pixels[offset + channel];
        pixels[offset + channel] = Math.round(
          previous * (1 - alpha) + colour[channel] * alpha);
      }
    }
  }
}

globalThis.GPUTextureView = class GPUTextureView {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUTextureView': Illegal constructor");
    }
    this.label = label || '';
  }
  get [Symbol.toStringTag]() { return 'GPUTextureView'; }
};

globalThis.GPUTexture = class GPUTexture {
  constructor(key, descriptor) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUTexture': Illegal constructor");
    }
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const size = _gpuTextureExtents(source.size);
    const width = Math.max(1, Math.trunc(Number(size.width) || 1));
    const height = Math.max(1, Math.trunc(Number(size.height) || 1));
    const format = String(source.format || 'rgba8unorm');
    const usage = Number(source.usage) || 0;
    _gpuTextureState.set(this, {
      width,
      height,
      depthOrArrayLayers: Math.max(1, Math.trunc(Number(size.depthOrArrayLayers) || 1)),
      format,
      usage,
      label: String(source.label || ''),
      pixels: new Uint8ClampedArray(width * height * 4),
    });
  }
  get label() { return _gpuTextureState.get(this).label; }
  set label(value) { _gpuTextureState.get(this).label = String(value || ''); }
  get width() { return _gpuTextureState.get(this).width; }
  get height() { return _gpuTextureState.get(this).height; }
  get depthOrArrayLayers() { return _gpuTextureState.get(this).depthOrArrayLayers; }
  get mipLevelCount() { return 1; }
  get sampleCount() { return 1; }
  get dimension() { return '2d'; }
  get format() { return _gpuTextureState.get(this).format; }
  get usage() { return _gpuTextureState.get(this).usage; }
  createView(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const view = new globalThis.GPUTextureView(_gpuKey, source.label);
    view._texture = this;
    return view;
  }
  destroy() {
    const state = _gpuTextureState.get(this);
    state.pixels = null;
  }
  get [Symbol.toStringTag]() { return 'GPUTexture'; }
};

globalThis.GPUBuffer = class GPUBuffer {
  constructor(key, descriptor) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUBuffer': Illegal constructor");
    }
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const size = Math.max(0, Math.trunc(Number(source.size) || 0));
    _gpuBufferState.set(this, {
      size,
      usage: Number(source.usage) || 0,
      label: String(source.label || ''),
      bytes: new Uint8ClampedArray(size),
      mapped: null,
      destroyed: false,
    });
  }
  get label() { return _gpuBufferState.get(this).label; }
  set label(value) { _gpuBufferState.get(this).label = String(value || ''); }
  get size() { return _gpuBufferState.get(this).size; }
  get usage() { return _gpuBufferState.get(this).usage; }
  get mapState() {
    const state = _gpuBufferState.get(this);
    return state.mapped ? 'mapped' : (state.pending ? 'pending' : 'unmapped');
  }
  mapAsync(mode, offset, size) {
    const state = _gpuBufferState.get(this);
    if (state.destroyed) {
      return Promise.reject(new TypeError("Failed to execute 'mapAsync' on 'GPUBuffer': buffer is destroyed"));
    }
    if (mode !== _GPU_MAP_READ && mode !== 2) {
      return Promise.reject(new TypeError(
        "Failed to execute 'mapAsync' on 'GPUBuffer': the mode is not a valid GPUMapMode"));
    }
    const start = Math.trunc(Number(offset) || 0);
    const length = size === undefined ? state.size - start : Math.trunc(Number(size) || 0);
    state.pending = true;
    return Promise.resolve().then(() => {
      state.pending = false;
      const range = new ArrayBuffer(Math.max(0, Math.min(length, state.size - start)));
      new Uint8Array(range).set(state.bytes.subarray(start, start + range.byteLength));
      state.mapped = { start, range };
      return undefined;
    });
  }
  getMappedRange(offset, size) {
    const state = _gpuBufferState.get(this);
    if (!state.mapped) {
      throw new TypeError("Failed to execute 'getMappedRange' on 'GPUBuffer': the buffer is not mapped");
    }
    if (offset === undefined && size === undefined) return state.mapped.range;
    const start = Math.trunc(Number(offset) || 0);
    const length = size === undefined ? state.size - start : Math.trunc(Number(size) || 0);
    return state.mapped.range.slice(start - state.mapped.start,
      start - state.mapped.start + length);
  }
  unmap() {
    const state = _gpuBufferState.get(this);
    if (!state.mapped) {
      throw new TypeError("Failed to execute 'unmap' on 'GPUBuffer': the buffer is not mapped");
    }
    state.mapped = null;
  }
  destroy() {
    const state = _gpuBufferState.get(this);
    state.destroyed = true;
    state.mapped = null;
  }
  get [Symbol.toStringTag]() { return 'GPUBuffer'; }
};

globalThis.GPUShaderModule = class GPUShaderModule {
  constructor(key, descriptor) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUShaderModule': Illegal constructor");
    }
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    this.label = String(source.label || '');
    this.code = String(source.code || '');
  }
  getCompilationInfo() {
    return Promise.resolve({ messages: [] });
  }
  get [Symbol.toStringTag]() { return 'GPUShaderModule'; }
};

globalThis.GPUBindGroupLayout = class GPUBindGroupLayout {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUBindGroupLayout': Illegal constructor");
    }
    this.label = String(label || '');
  }
  get [Symbol.toStringTag]() { return 'GPUBindGroupLayout'; }
};

globalThis.GPUBindGroup = class GPUBindGroup {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUBindGroup': Illegal constructor");
    }
    this.label = String(label || '');
  }
  get [Symbol.toStringTag]() { return 'GPUBindGroup'; }
};

globalThis.GPUPipelineLayout = class GPUPipelineLayout {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUPipelineLayout': Illegal constructor");
    }
    this.label = String(label || '');
  }
  get [Symbol.toStringTag]() { return 'GPUPipelineLayout'; }
};

globalThis.GPUSampler = class GPUSampler {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUSampler': Illegal constructor");
    }
    this.label = String(label || '');
  }
  get [Symbol.toStringTag]() { return 'GPUSampler'; }
};

globalThis.GPUQuerySet = class GPUQuerySet {
  constructor(key, descriptor) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUQuerySet': Illegal constructor");
    }
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    this.label = String(source.label || '');
    this.type = String(source.type || '');
    this.count = Math.max(0, Math.trunc(Number(source.count) || 0));
  }
  destroy() {}
  get [Symbol.toStringTag]() { return 'GPUQuerySet'; }
};

globalThis.GPURenderPipeline = class GPURenderPipeline {
  constructor(key, descriptor) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPURenderPipeline': Illegal constructor");
    }
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const vertexModule = source.vertex && source.vertex.module;
    // The readback follows the shader the pipeline was built from, so the
    // module's source has to survive until a pass draws with this pipeline.
    _gpuEncoderState.set(this, {
      label: String(source.label || ''),
      code: vertexModule && typeof vertexModule.code === 'string' ? vertexModule.code : '',
    });
  }
  get label() { return _gpuEncoderState.get(this).label; }
  set label(value) { _gpuEncoderState.get(this).label = String(value || ''); }
  getBindGroupLayout() {
    return new globalThis.GPUBindGroupLayout(_gpuKey, '');
  }
  get [Symbol.toStringTag]() { return 'GPURenderPipeline'; }
};

globalThis.GPUComputePipeline = class GPUComputePipeline {
  constructor(key, descriptor) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUComputePipeline': Illegal constructor");
    }
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    this.label = String(source.label || '');
  }
  getBindGroupLayout() {
    return new globalThis.GPUBindGroupLayout(_gpuKey, '');
  }
  get [Symbol.toStringTag]() { return 'GPUComputePipeline'; }
};

globalThis.GPUCommandBuffer = class GPUCommandBuffer {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUCommandBuffer': Illegal constructor");
    }
    this.label = String(label || '');
  }
  get [Symbol.toStringTag]() { return 'GPUCommandBuffer'; }
};

globalThis.GPURenderPassEncoder = class GPURenderPassEncoder {
  constructor(key, state) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPURenderPassEncoder': Illegal constructor");
    }
    _gpuPassState.set(this, state);
  }
  get label() { return _gpuPassState.get(this).label; }
  setPipeline(pipeline) {
    _gpuPassState.get(this).pipeline = pipeline;
  }
  setVertexBuffer() {}
  setIndexBuffer() {}
  setBindGroup() {}
  draw(vertexCount) {
    _gpuPassState.get(this).draws.push(Math.trunc(Number(vertexCount) || 0));
  }
  drawIndexed(indexCount) {
    _gpuPassState.get(this).draws.push(Math.trunc(Number(indexCount) || 0));
  }
  setViewport() {}
  setScissorRect() {}
  setBlendConstant() {}
  setStencilReference() {}
  executeBundles() {}
  end() {
    _gpuPassState.get(this).ended = true;
  }
  get [Symbol.toStringTag]() { return 'GPURenderPassEncoder'; }
};

globalThis.GPUComputePassEncoder = class GPUComputePassEncoder {
  constructor(key, state) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUComputePassEncoder': Illegal constructor");
    }
    _gpuPassState.set(this, state);
  }
  get label() { return _gpuPassState.get(this).label; }
  setPipeline(pipeline) { _gpuPassState.get(this).pipeline = pipeline; }
  setBindGroup() {}
  dispatchWorkgroups() {}
  end() { _gpuPassState.get(this).ended = true; }
  get [Symbol.toStringTag]() { return 'GPUComputePassEncoder'; }
};

globalThis.GPUCommandEncoder = class GPUCommandEncoder {
  constructor(key, label) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUCommandEncoder': Illegal constructor");
    }
    _gpuEncoderState.set(this, { label: String(label || ''), passes: [], copies: [] });
  }
  get label() { return _gpuEncoderState.get(this).label; }
  set label(value) { _gpuEncoderState.get(this).label = String(value || ''); }
  beginRenderPass(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const attachment = (source.colorAttachments || [])[0] || {};
    const view = attachment.view;
    const texture = view && view._texture ? view._texture : null;
    const state = {
      label: String(source.label || ''),
      texture,
      clear: attachment.clearValue || { r: 0, g: 0, b: 0, a: 1 },
      loadOp: String(attachment.loadOp || 'clear'),
      pipeline: null,
      draws: [],
      ended: false,
    };
    _gpuEncoderState.get(this).passes.push(state);
    return new globalThis.GPURenderPassEncoder(_gpuKey, state);
  }
  beginComputePass(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const state = {
      label: String(source.label || ''),
      pipeline: null,
      draws: [],
      ended: false,
    };
    _gpuEncoderState.get(this).passes.push(state);
    return new globalThis.GPUComputePassEncoder(_gpuKey, state);
  }
  copyTextureToBuffer(source, destination, size) {
    const textureState = source && source.texture ? _gpuTextureState.get(source.texture) : null;
    const buffer = destination && destination.buffer;
    const extents = _gpuTextureExtents(size);
    const width = Math.trunc(Number(extents.width) || 0) || (textureState ? textureState.width : 0);
    const height = Math.trunc(Number(extents.height) || 0) || (textureState ? textureState.height : 1);
    const bytesPerRow = Math.trunc(Number(destination && destination.bytesPerRow) || 0);
    _gpuEncoderState.get(this).copies.push({
      texture: source && source.texture,
      textureState,
      buffer,
      width,
      height,
      bytesPerRow,
      offset: Math.trunc(Number(destination && destination.offset) || 0),
    });
  }
  copyBufferToBuffer() {}
  copyBufferToTexture() {}
  copyTextureToTexture() {}
  clearBuffer() {}
  resolveQuerySet() {}
  finish(descriptor) {
    const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const encoder = _gpuEncoderState.get(this);
    return new globalThis.GPUCommandBuffer(_gpuKey, source.label || encoder.label);
  }
  get [Symbol.toStringTag]() { return 'GPUCommandEncoder'; }
};

globalThis.GPUQueue = class GPUQueue {
  constructor(key, device) {
    if (key !== _gpuKey) {
      throw new TypeError("Failed to construct 'GPUQueue': Illegal constructor");
    }
    _gpuQueueState.set(this, { device, label: '' });
  }
  get label() { return _gpuQueueState.get(this).label; }
  set label(value) { _gpuQueueState.get(this).label = String(value || ''); }
  submit(commandBuffers) {
    const device = _gpuQueueState.get(this).device;
    const encoders = device ? _gpuDeviceEncoders.get(device) : null;
    if (!encoders) return;
    // Every encoder the device handed out is drained: the spec leaves the
    // order of separately submitted buffers unobservable here, and the
    // probes this layer serves build one encoder per measurement.
    for (const encoder of encoders.splice(0, encoders.length)) {
      const recorded = _gpuEncoderState.get(encoder);
      if (!recorded) continue;
      for (const pass of recorded.passes) {
        const target = pass.texture ? _gpuTextureState.get(pass.texture) : null;
        if (!target || !target.pixels) continue;
        if (pass.loadOp === 'clear') {
          const clear = pass.clear;
          const colour = [
            Math.round(Math.max(0, Math.min(1, Number(clear.r) || 0)) * 255),
            Math.round(Math.max(0, Math.min(1, Number(clear.g) || 0)) * 255),
            Math.round(Math.max(0, Math.min(1, Number(clear.b) || 0)) * 255),
            Math.round(Math.max(0, Math.min(1, clear.a === undefined ? 1 : Number(clear.a))) * 255),
          ];
          for (let offset = 0; offset < target.pixels.length; offset += 4) {
            target.pixels[offset] = colour[0];
            target.pixels[offset + 1] = colour[1];
            target.pixels[offset + 2] = colour[2];
            target.pixels[offset + 3] = colour[3];
          }
        }
        const pipeline = pass.pipeline;
        const code = pipeline && _gpuEncoderState.get(pipeline)
          ? _gpuEncoderState.get(pipeline).code
          : '';
        for (const draw of pass.draws) {
          if (draw < 3) continue;
          _gpuRasterizeTriangle(
            target.pixels,
            target.width,
            target.height,
            _gpuVertexPositions(code),
            _gpuFragmentColour(code),
          );
        }
      }
      for (const copy of recorded.copies) {
        const bufferState = copy.buffer ? _gpuBufferState.get(copy.buffer) : null;
        if (!bufferState || !copy.textureState || !copy.textureState.pixels) continue;
        const pixels = copy.textureState.pixels;
        const source = copy.textureState;
        const rowPitch = copy.bytesPerRow || _gpuAlignedBytesPerRow(source.width, 4);
        for (let y = 0; y < copy.height; y++) {
          for (let x = 0; x < copy.width; x++) {
            const from = (y * source.width + x) * 4;
            const to = copy.offset + y * rowPitch + x * 4;
            if (to + 4 > bufferState.bytes.length) break;
            bufferState.bytes[to] = pixels[from];
            bufferState.bytes[to + 1] = pixels[from + 1];
            bufferState.bytes[to + 2] = pixels[from + 2];
            bufferState.bytes[to + 3] = pixels[from + 3];
          }
        }
      }
    }
  }
  writeBuffer(buffer, offset, data) {
    const state = buffer ? _gpuBufferState.get(buffer) : null;
    if (!state) return;
    const source = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : (ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null);
    if (!source) return;
    state.bytes.set(source, Math.trunc(Number(offset) || 0));
  }
  writeTexture() {}
  copyExternalImageToTexture() {}
  onSubmittedWorkDone() {
    return Promise.resolve();
  }
  get [Symbol.toStringTag]() { return 'GPUQueue'; }
};

globalThis.GPUMapMode = { READ: _GPU_MAP_READ, WRITE: 2 };
globalThis.GPUBufferUsage = globalThis.GPUBufferUsage || {
  MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8,
  INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128,
  INDIRECT: 256, QUERY_RESOLVE: 512,
};
globalThis.GPUTextureUsage = globalThis.GPUTextureUsage || {
  COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: _GPU_RENDER_ATTACHMENT,
};
globalThis.GPUShaderStage = globalThis.GPUShaderStage || { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// Texture views need the texture they came from so a render pass can find its
// attachment; the property stays implementation-private.
Object.defineProperty(globalThis.GPUTextureView.prototype, '_texture', {
  value: undefined, writable: true, configurable: true, enumerable: false,
});
