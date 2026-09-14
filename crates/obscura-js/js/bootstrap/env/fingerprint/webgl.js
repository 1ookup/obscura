// The WebGL consistency profile. No GPU work happens: the values describe the
// ANGLE/D3D11 adapter the fingerprint already claims through
// `navigator.userAgent` and the unmasked renderer string, so that a page
// reading the WebGL surface sees one coherent machine rather than a context
// that exists but answers nothing.
//
// `VENDOR` and `RENDERER` are "WebKit"/"WebKit WebGL" in every Chrome; the
// real adapter is only reachable through WEBGL_debug_renderer_info. Reporting
// the adapter strings from `getParameter(VENDOR)` -- which this did -- is
// backwards, and is the single easiest WebGL tell to check.
const _WEBGL1_EXTENSIONS = [
  'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_clip_control',
  'EXT_color_buffer_half_float', 'EXT_depth_clamp', 'EXT_disjoint_timer_query',
  'EXT_float_blend', 'EXT_frag_depth', 'EXT_polygon_offset_clamp',
  'EXT_shader_texture_lod', 'EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic',
  'EXT_texture_mirror_clamp_to_edge', 'EXT_sRGB', 'KHR_parallel_shader_compile',
  'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives',
  'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
  'OES_texture_half_float_linear', 'OES_vertex_array_object',
  'WEBGL_blend_func_extended', 'WEBGL_color_buffer_float',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
  'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw',
  'WEBGL_polygon_mode',
];
const _WEBGL2_EXTENSIONS = [
  'EXT_clip_control', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float',
  'EXT_conservative_depth', 'EXT_depth_clamp', 'EXT_disjoint_timer_query_webgl2',
  'EXT_float_blend', 'EXT_polygon_offset_clamp', 'EXT_render_snorm',
  'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
  'EXT_texture_filter_anisotropic', 'EXT_texture_mirror_clamp_to_edge',
  'EXT_texture_norm16', 'KHR_parallel_shader_compile',
  'NV_shader_noperspective_interpolation', 'OES_draw_buffers_indexed',
  'OES_sample_variables', 'OES_shader_multisample_interpolation',
  'OES_texture_float_linear', 'WEBGL_blend_func_extended',
  'WEBGL_clip_cull_distance', 'WEBGL_compressed_texture_s3tc',
  'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info',
  'WEBGL_debug_shaders', 'WEBGL_lose_context', 'WEBGL_multi_draw',
  'WEBGL_polygon_mode', 'WEBGL_stencil_texturing',
];
// Every value a desktop ANGLE/D3D11 context reports. Shared by both context
// versions; the WebGL 2 table below adds the ES 3.0 names on top.
const _WEBGL1_PARAMETERS = {
  0x1F00: 'WebKit',                        // VENDOR
  0x1F01: 'WebKit WebGL',                  // RENDERER
  0x1F02: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
  0x1F03: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
  0x0D33: 16384,   // MAX_TEXTURE_SIZE
  0x851C: 16384,   // MAX_CUBE_MAP_TEXTURE_SIZE
  0x84E8: 16384,   // MAX_RENDERBUFFER_SIZE
  0x8869: 16,      // MAX_VERTEX_ATTRIBS
  0x8DFB: 4096,    // MAX_VERTEX_UNIFORM_VECTORS
  0x8DFD: 1024,    // MAX_FRAGMENT_UNIFORM_VECTORS
  0x8DFC: 30,      // MAX_VARYING_VECTORS
  0x8872: 16,      // MAX_TEXTURE_IMAGE_UNITS
  0x8B4C: 16,      // MAX_VERTEX_TEXTURE_IMAGE_UNITS
  0x8B4D: 32,      // MAX_COMBINED_TEXTURE_IMAGE_UNITS
  0x0D50: 4,       // SUBPIXEL_BITS
  0x0D52: 8, 0x0D53: 8, 0x0D54: 8, 0x0D55: 8,   // RED/GREEN/BLUE/ALPHA_BITS
  0x0D56: 24,      // DEPTH_BITS
  0x0D57: 0,       // STENCIL_BITS
  0x80A8: 1,       // SAMPLE_BUFFERS (antialiased default context)
  0x80A9: 4,       // SAMPLES
  0x84FF: 16,      // MAX_TEXTURE_MAX_ANISOTROPY_EXT
  0x9240: true,    // UNPACK_FLIP_Y_WEBGL
  0x9241: false,   // UNPACK_PREMULTIPLY_ALPHA_WEBGL
  0x9243: 0x9244,  // UNPACK_COLORSPACE_CONVERSION_WEBGL -> BROWSER_DEFAULT_WEBGL
  0x0B44: false,   // CULL_FACE
  0x0BD0: true,    // DITHER
  0x0BE2: false,   // BLEND
  0x0B71: false,   // DEPTH_TEST
  0x0B90: false,   // STENCIL_TEST
  0x0C11: false,   // SCISSOR_TEST
  0x0B21: 1,       // LINE_WIDTH
  0x0B73: true,    // DEPTH_WRITEMASK
  0x0D05: 4,       // PACK_ALIGNMENT
  0x0CF5: 4,       // UNPACK_ALIGNMENT
  0x0B12: 0x0201,  // STENCIL_FUNC -> LESS
  0x8894: null, 0x8895: null,   // ARRAY_BUFFER_BINDING / ELEMENT_ARRAY_BUFFER_BINDING
  0x8CA6: null,    // FRAMEBUFFER_BINDING
  0x8CA7: null,    // RENDERBUFFER_BINDING
  0x8B8D: null,    // CURRENT_PROGRAM
  0x84E0: 0x84C0,  // ACTIVE_TEXTURE -> TEXTURE0
  0x8B9A: 0x1401,  // IMPLEMENTATION_COLOR_READ_TYPE -> UNSIGNED_BYTE
  0x8B9B: 0x1908,  // IMPLEMENTATION_COLOR_READ_FORMAT -> RGBA
  // Probed-by-challenge constants that previously answered null.
  0x80AA: 1,       // SAMPLE_COVERAGE_VALUE (default 1.0; 4352 was DONT_CARE)
  0x8058: 8,       // MAX_SAMPLES
  0x80E8: 1048576, // MAX_ELEMENTS_INDICES (ANGLE D3D11)
  0x80E9: 1048576, // MAX_ELEMENTS_VERTICES
  0x84FD: 1,       // TEXTURE_MAX_ANISOTROPY_EXT (default)
  0x87FF: 519,     // transient enum state seen in a real capture
  0x8801: 7680,    // default enum state
  0x8824: 8,       // MAX_DRAW_BUFFERS
  0x891E: 2048,
  0x8925: 7,
  0x8A2B: 16, 0x8A2D: 16, 0x8A2E: 32, 0x8A2F: 32,
  0x8A30: 16384, 0x8A31: 69632, 0x8A33: 69632, 0x8A34: 16,
  0x8B49: 4096, 0x8B4A: 4096, 0x8B4B: 120,
  0x8C80: 4, 0x8C8A: 128, 0x8C8B: 4,
  0x8D57: 8,
  0x8D7B: 256,     // UNIFORM_BUFFER_OFFSET_ALIGNMENT (D3D11)
  0x8FC9: false,
  0x9110: 0, 0x9122: 120, 0x9125: 120,
  0x9601: false,
};
// Values that are arrays have to be fresh each call: a caller that mutates the
// returned Int32Array must not change what the next caller sees.
const _WEBGL1_ARRAY_PARAMETERS = {
  // The reported GPU (Intel UHD 630, Direct3D FL11.0) caps viewport dims at
  // 16384; 32767 contradicted the same payload's self-reported adapter.
  0x0D3A: () => new Int32Array([16384, 16384]),  // MAX_VIEWPORT_DIMS
  0x846D: () => new Float32Array([1, 1024]),     // ALIASED_POINT_SIZE_RANGE
  0x846E: () => new Float32Array([1, 1]),        // ALIASED_LINE_WIDTH_RANGE
};
const _WEBGL2_PARAMETERS = {
  0x1F02: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
  0x1F03: 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)',
  0x8073: 2048,        // MAX_3D_TEXTURE_SIZE
  0x88FF: 2048,        // MAX_ARRAY_TEXTURE_LAYERS
  0x80E8: 2147483647,  // MAX_ELEMENTS_VERTICES
  0x80E9: 2147483647,  // MAX_ELEMENTS_INDICES
  0x84FD: 15,          // MAX_TEXTURE_LOD_BIAS
  0x8824: 8,           // MAX_DRAW_BUFFERS
  0x8CDF: 8,           // MAX_COLOR_ATTACHMENTS
  0x8B49: 4096,        // MAX_FRAGMENT_UNIFORM_COMPONENTS
  0x8B4A: 4096,        // MAX_VERTEX_UNIFORM_COMPONENTS
  0x8B4B: 120,         // MAX_VARYING_COMPONENTS
  0x9122: 120,         // MAX_VERTEX_OUTPUT_COMPONENTS
  0x9125: 120,         // MAX_FRAGMENT_INPUT_COMPONENTS
  0x8904: -8,          // MIN_PROGRAM_TEXEL_OFFSET
  0x8905: 7,           // MAX_PROGRAM_TEXEL_OFFSET
  0x8A2B: 12,          // MAX_VERTEX_UNIFORM_BLOCKS
  0x8A2D: 12,          // MAX_FRAGMENT_UNIFORM_BLOCKS
  0x8A2E: 24,          // MAX_COMBINED_UNIFORM_BLOCKS
  0x8A2F: 24,          // MAX_UNIFORM_BUFFER_BINDINGS
  0x8A30: 65536,       // MAX_UNIFORM_BLOCK_SIZE
  0x8A34: 256,         // UNIFORM_BUFFER_OFFSET_ALIGNMENT
  0x8A31: 212992,      // MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS
  0x8A33: 212992,      // MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS
  0x8C8A: 120,         // MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS
  0x8C8B: 4,           // MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS
  0x8C80: 4,           // MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS (D3D11 SO)
  0x9111: 0,           // MAX_SERVER_WAIT_TIMEOUT (ANGLE fences are emulated)
  0x826E: 32,          // MAX_SAMPLES
  0x8D57: 8,           // MAX_SAMPLES (renderbuffer)
  0x9143: 0,           // MAX_ELEMENT_INDEX low word
  0x821B: 3, 0x821C: 0,  // MAJOR_VERSION / MINOR_VERSION
  0x8DFA: 1,           // SHADER_COMPILER
  0x87FE: 0,           // NUM_PROGRAM_BINARY_FORMATS
  0x8DF9: 0,           // NUM_SHADER_BINARY_FORMATS
  0x8C2B: 65536,       // MAX_TEXTURE_BUFFER_SIZE
  0x88FC: 0,           // MAX_VERTEX_UNIFORM_BLOCKS placeholder
  0x8B4F: 0,           // SHADER_TYPE placeholder
};
// Static parameter answers every desktop Chrome reports and the
// tables above used to omit; state defaults and capability limits that
// do not differ between the D3D11 and Apple/Metal shapes. Captured from
// the Chrome oracle in js-repros/window-surface. Array-valued answers
// stay in the factory tables above so callers cannot mutate shared state.
Object.assign(_WEBGL1_PARAMETERS, {
  0x80C8: 0,  // BLEND_DST_RGB
  0x80C9: 1,  // BLEND_SRC_RGB
  0x80CA: 0,  // BLEND_DST_ALPHA
  0x80CB: 1,  // BLEND_SRC_ALPHA
  0x8037: false,  // POLYGON_OFFSET_FILL
  0xB45: 1029,  // CULL_FACE_MODE
  0xB46: 2305,  // FRONT_FACE
  0xB97: 0,  // STENCIL_REF
  0xB93: 0xFFFFFFFF,  // STENCIL_VALUE_MASK
  0xB98: 0xFFFFFFFF,  // STENCIL_WRITEMASK
  0x8CA3: 0,  // STENCIL_BACK_REF
  0x8CA4: 0xFFFFFFFF,  // STENCIL_BACK_VALUE_MASK
  0x8CA5: 0xFFFFFFFF,  // STENCIL_BACK_WRITEMASK
  0xD53: 8,  // GREEN_BITS
  0xD54: 8,  // BLUE_BITS
  0xD55: 8,  // ALPHA_BITS
  0x2A00: 0,  // POLYGON_OFFSET_UNITS
  0x8038: 0,  // POLYGON_OFFSET_FACTOR
  0x8192: 4352,  // GENERATE_MIPMAP_HINT
  0x8B8C: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",  // SHADING_LANGUAGE_VERSION
  0x8B9A: 5121,  // IMPLEMENTATION_COLOR_READ_TYPE
  0x8B9B: 6408,  // IMPLEMENTATION_COLOR_READ_FORMAT
});
Object.assign(_WEBGL2_PARAMETERS, {
  0x80C8: 0,  // BLEND_DST_RGB
  0x80C9: 1,  // BLEND_SRC_RGB
  0x80CA: 0,  // BLEND_DST_ALPHA
  0x80CB: 1,  // BLEND_SRC_ALPHA
  0xB44: false,  // CULL_FACE
  0x8037: false,  // POLYGON_OFFSET_FILL
  0xB45: 1029,  // CULL_FACE_MODE
  0xB46: 2305,  // FRONT_FACE
  0xB97: 0,  // STENCIL_REF
  0x8CA3: 0,  // STENCIL_BACK_REF
  0xCF5: 4,  // UNPACK_ALIGNMENT
  0xD05: 4,  // PACK_ALIGNMENT
  0xD33: 16384,  // MAX_TEXTURE_SIZE
  0xD50: 4,  // SUBPIXEL_BITS
  0xD52: 8,  // RED_BITS
  0xD53: 8,  // GREEN_BITS
  0xD54: 8,  // BLUE_BITS
  0xD55: 8,  // ALPHA_BITS
  0xD56: 24,  // DEPTH_BITS
  0xD57: 0,  // STENCIL_BITS
  0x2A00: 0,  // POLYGON_OFFSET_UNITS
  0x8038: 0,  // POLYGON_OFFSET_FACTOR
  0x80A8: 1,  // SAMPLE_BUFFERS
  0x80A9: 4,  // SAMPLES
  0x8192: 4352,  // GENERATE_MIPMAP_HINT
  0x8869: 16,  // MAX_VERTEX_ATTRIBS
  0x8DFB: 1024,  // MAX_VERTEX_UNIFORM_VECTORS
  0x8DFC: 30,  // MAX_VARYING_VECTORS
  0x8B4D: 32,  // MAX_COMBINED_TEXTURE_IMAGE_UNITS
  0x8B4C: 16,  // MAX_VERTEX_TEXTURE_IMAGE_UNITS
  0x8872: 16,  // MAX_TEXTURE_IMAGE_UNITS
  0x8DFD: 1024,  // MAX_FRAGMENT_UNIFORM_VECTORS
  0x8B8C: "WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)",  // SHADING_LANGUAGE_VERSION
  0x1F00: "WebKit",  // VENDOR
  0x1F01: "WebKit WebGL",  // RENDERER
  0x851C: 16384,  // MAX_CUBE_MAP_TEXTURE_SIZE
  0x8B9A: 5121,  // IMPLEMENTATION_COLOR_READ_TYPE
  0x8B9B: 6408,  // IMPLEMENTATION_COLOR_READ_FORMAT
  0x84E8: 16384,  // MAX_RENDERBUFFER_SIZE
  0xC02: 1029,  // READ_BUFFER
  0xCF2: 0,  // UNPACK_ROW_LENGTH
  0xCF3: 0,  // UNPACK_SKIP_ROWS
  0xCF4: 0,  // UNPACK_SKIP_PIXELS
  0xD02: 0,  // PACK_ROW_LENGTH
  0xD03: 0,  // PACK_SKIP_ROWS
  0xD04: 0,  // PACK_SKIP_PIXELS
  0x806D: 0,  // UNPACK_SKIP_IMAGES
  0x806E: 0,  // UNPACK_IMAGE_HEIGHT
  0x8825: 1029,  // DRAW_BUFFER0
  0x8826: 1029,  // DRAW_BUFFER1
  0x8827: 1029,  // DRAW_BUFFER2
  0x8828: 1029,  // DRAW_BUFFER3
  0x8829: 1029,  // DRAW_BUFFER4
  0x882A: 1029,  // DRAW_BUFFER5
  0x882B: 1029,  // DRAW_BUFFER6
  0x882C: 1029,  // DRAW_BUFFER7
  0x8B8B: 4352,  // FRAGMENT_SHADER_DERIVATIVE_HINT
  0x8C89: false,  // RASTERIZER_DISCARD
  0x8E23: false,  // TRANSFORM_FEEDBACK_PAUSED
  0x8E24: false,  // TRANSFORM_FEEDBACK_ACTIVE
  0x8D6B: 4294967294,  // MAX_ELEMENT_INDEX
  0x9247: 0,  // MAX_CLIENT_WAIT_TIMEOUT_WEBGL
});
Object.assign(_WEBGL1_ARRAY_PARAMETERS, {
  0xB70: () => new Float32Array([0, 1]),  // DEPTH_RANGE
  0x86A3: () => new Int32Array([]),  // COMPRESSED_TEXTURE_FORMATS (until an extension enables them)
});

// The Apple/Metal capability shape for macOS fingerprints. Values the D3D11
// tables already carry (most of the surface) are inherited; only the answers
// that differ are listed here. Order of the extension lists is part of the
// observable fingerprint, so it is transcribed as captured, never sorted.
const _WEBGL_APPLE = {
  webgl1Params: {
    0xD52: 8,  // RED_BITS
    0x80A8: 1,  // SAMPLE_BUFFERS
    0x80A9: 4,  // SAMPLES
    0x8DFB: 1024,  // MAX_VERTEX_UNIFORM_VECTORS
  },
  webgl2Params: {
    0x8C80: 4,  // MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS
    0x8C8A: 128,  // MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS
    0x8D57: 4,  // MAX_SAMPLES
    0x8A2B: 16,  // MAX_VERTEX_UNIFORM_BLOCKS
    0x8A2D: 16,  // MAX_FRAGMENT_UNIFORM_BLOCKS
    0x8A2E: 32,  // MAX_COMBINED_UNIFORM_BLOCKS
    0x8A2F: 32,  // MAX_UNIFORM_BUFFER_BINDINGS
    0x8A30: 16384,  // MAX_UNIFORM_BLOCK_SIZE
    0x8A31: 69632,  // MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS
    0x8A33: 69632,  // MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS
    0x8A34: 16,  // UNIFORM_BUFFER_OFFSET_ALIGNMENT
    0x9111: 0,  // MAX_SERVER_WAIT_TIMEOUT
  },
  webgl1Extensions: ["ANGLE_instanced_arrays","EXT_blend_minmax","EXT_clip_control","EXT_color_buffer_half_float","EXT_depth_clamp","EXT_disjoint_timer_query","EXT_float_blend","EXT_frag_depth","EXT_polygon_offset_clamp","EXT_shader_texture_lod","EXT_texture_compression_bptc","EXT_texture_compression_rgtc","EXT_texture_filter_anisotropic","EXT_texture_mirror_clamp_to_edge","EXT_sRGB","KHR_parallel_shader_compile","OES_element_index_uint","OES_fbo_render_mipmap","OES_standard_derivatives","OES_texture_float","OES_texture_float_linear","OES_texture_half_float","OES_texture_half_float_linear","OES_vertex_array_object","WEBGL_blend_func_extended","WEBGL_color_buffer_float","WEBGL_compressed_texture_astc","WEBGL_compressed_texture_etc","WEBGL_compressed_texture_etc1","WEBGL_compressed_texture_pvrtc","WEBGL_compressed_texture_s3tc","WEBGL_compressed_texture_s3tc_srgb","WEBGL_debug_renderer_info","WEBGL_debug_shaders","WEBGL_depth_texture","WEBGL_draw_buffers","WEBGL_lose_context","WEBGL_multi_draw","WEBGL_polygon_mode"],
  webgl2Extensions: ["EXT_clip_control","EXT_color_buffer_float","EXT_color_buffer_half_float","EXT_conservative_depth","EXT_depth_clamp","EXT_disjoint_timer_query_webgl2","EXT_float_blend","EXT_polygon_offset_clamp","EXT_render_snorm","EXT_texture_compression_bptc","EXT_texture_compression_rgtc","EXT_texture_filter_anisotropic","EXT_texture_mirror_clamp_to_edge","EXT_texture_norm16","KHR_parallel_shader_compile","NV_shader_noperspective_interpolation","OES_draw_buffers_indexed","OES_sample_variables","OES_shader_multisample_interpolation","OES_texture_float_linear","WEBGL_blend_func_extended","WEBGL_clip_cull_distance","WEBGL_compressed_texture_astc","WEBGL_compressed_texture_etc","WEBGL_compressed_texture_etc1","WEBGL_compressed_texture_pvrtc","WEBGL_compressed_texture_s3tc","WEBGL_compressed_texture_s3tc_srgb","WEBGL_debug_renderer_info","WEBGL_debug_shaders","WEBGL_lose_context","WEBGL_multi_draw","WEBGL_polygon_mode","WEBGL_provoking_vertex","WEBGL_render_shared_exponent","WEBGL_stencil_texturing"],
  arrayParams: {
    0x0D3A: () => new Int32Array([16384, 16384]),  // MAX_VIEWPORT_DIMS
    0x846D: () => new Float32Array([1, 511]),      // ALIASED_POINT_SIZE_RANGE
  },
};

// getInternalformatParameter(RENDERBUFFER, fmt, SAMPLES) answer classes,
// backend-independent per the WebGL2 validation Chrome applies before the
// backend answers: the fifteen core color-/depth-/stencil-renderable formats
// return the profile's sample counts, the float formats only become
// renderable once EXT_color_buffer_float is enabled, and every other format
// -- integer, shared-exponent, SNORM, unsized, sRGB-without-alpha -- sets
// INVALID_ENUM and returns null. Transcribed from the Chrome oracle and the
// challenge capture, which agree on the fifteen.
const _WEBGL_IFP_RENDERABLE = new Set([
  0x8229, 0x822B, 0x8051, 0x8058, 0x8C43, 0x8059, 0x8056, 0x8057, 0x8D62,
  0x81A5, 0x81A6, 0x8CAC, 0x8D48, 0x88F0, 0x8CAD,
]);
const _WEBGL_IFP_FLOAT_RENDERABLE = new Set([
  0x822D, 0x822E, 0x822F, 0x8230, 0x8814, 0x881A, 0x8C3A,
]);

// getShaderPrecisionFormat on any desktop GL: IEEE single precision for the
// float formats and 32-bit two's complement for the integer ones, regardless
// of the requested precision qualifier.
const _WEBGL_PRECISION_FLOAT = { rangeMin: 127, rangeMax: 127, precision: 23 };
const _WEBGL_PRECISION_INT = { rangeMin: 31, rangeMax: 30, precision: 0 };

function _webglExtensionObject(tag, constants, methods = {}) {
  const prototype = {};
  for (const [name, value] of Object.entries(constants)) {
    Object.defineProperty(prototype, name, {
      value, writable: false, enumerable: true, configurable: false,
    });
  }
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(prototype, name, {
      value: _markNative(method), writable: true, enumerable: true, configurable: true,
    });
  }
  Object.defineProperty(prototype, Symbol.toStringTag, {
    value: tag, configurable: true,
  });
  return Object.create(prototype);
}

function _oesStandardDerivatives() {
  return _webglExtensionObject('OESStandardDerivatives', {
    FRAGMENT_SHADER_DERIVATIVE_HINT_OES: 0x8B8B,
  });
}

function _extDisjointTimerQuery() {
  return _webglExtensionObject('EXTDisjointTimerQuery', {
    QUERY_COUNTER_BITS_EXT: 0x8864,
    CURRENT_QUERY_EXT: 0x8865,
    QUERY_RESULT_EXT: 0x8866,
    QUERY_RESULT_AVAILABLE_EXT: 0x8867,
    TIME_ELAPSED_EXT: 0x88BF,
    TIMESTAMP_EXT: 0x8E28,
    GPU_DISJOINT_EXT: 0x8FBB,
  }, {
    beginQueryEXT() {},
    createQueryEXT() { return {}; },
    deleteQueryEXT() {},
    endQueryEXT() {},
    getQueryEXT() { return null; },
    getQueryObjectEXT(_query, pname) {
      if (+pname === 0x8867) return false;
      if (+pname === 0x8866) return 0;
      return null;
    },
    isQueryEXT() { return false; },
    queryCounterEXT() {},
  });
}

function _webglCompressedTextureAstc() {
  return _webglExtensionObject('WebGLCompressedTextureASTC', {
    COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93B0,
    COMPRESSED_RGBA_ASTC_5x4_KHR: 0x93B1,
    COMPRESSED_RGBA_ASTC_5x5_KHR: 0x93B2,
    COMPRESSED_RGBA_ASTC_6x5_KHR: 0x93B3,
    COMPRESSED_RGBA_ASTC_6x6_KHR: 0x93B4,
    COMPRESSED_RGBA_ASTC_8x5_KHR: 0x93B5,
    COMPRESSED_RGBA_ASTC_8x6_KHR: 0x93B6,
    COMPRESSED_RGBA_ASTC_8x8_KHR: 0x93B7,
    COMPRESSED_RGBA_ASTC_10x5_KHR: 0x93B8,
    COMPRESSED_RGBA_ASTC_10x6_KHR: 0x93B9,
    COMPRESSED_RGBA_ASTC_10x8_KHR: 0x93BA,
    COMPRESSED_RGBA_ASTC_10x10_KHR: 0x93BB,
    COMPRESSED_RGBA_ASTC_12x10_KHR: 0x93BC,
    COMPRESSED_RGBA_ASTC_12x12_KHR: 0x93BD,
    COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR: 0x93D0,
    COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR: 0x93D1,
    COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR: 0x93D2,
    COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR: 0x93D3,
    COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR: 0x93D4,
    COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR: 0x93D5,
    COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR: 0x93D6,
    COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR: 0x93D7,
    COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR: 0x93D8,
    COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR: 0x93D9,
    COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR: 0x93DA,
    COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR: 0x93DB,
    COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR: 0x93DC,
    COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR: 0x93DD,
  }, {
    getSupportedProfiles() { return ['ldr', 'hdr']; },
  });
}

class _WebGLContext {
  constructor(canvas, isWebGL2, attrs) {
    this.canvas = canvas; this._isWebGL2 = !!isWebGL2; this.drawingBufferWidth = canvas.width; this.drawingBufferHeight = canvas.height;
    this._lost = false; this._extensions = new Map(); this._error = 0;
    // Chrome echoes back the attributes the caller passed, filling defaults.
    this._attrs = (attrs && typeof attrs === 'object') ? attrs : {};
  }
  get drawingBufferColorSpace() { return 'srgb'; }
  get unpackColorSpace() { return 'srgb'; }
  getContextAttributes() {
    return {
      alpha: this._attrs.alpha !== undefined ? !!this._attrs.alpha : true,
      // Chrome's default context is antialiased; the D3D11 table used to
      // claim false, which contradicted the SAMPLES answer.
      antialias: this._attrs.antialias !== undefined ? !!this._attrs.antialias : true,
      depth: this._attrs.depth !== undefined ? !!this._attrs.depth : true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: !!this._attrs.failIfMajorPerformanceCaveat,
      powerPreference: this._attrs.powerPreference || 'default',
      premultipliedAlpha: this._attrs.premultipliedAlpha !== undefined ? !!this._attrs.premultipliedAlpha : true,
      preserveDrawingBuffer: !!this._attrs.preserveDrawingBuffer,
      stencil: !!this._attrs.stencil,
      xrCompatible: false,
    };
  }
  getParameter(name) {
    const key = +name;
    if (key === 0x8B8B && !this._isWebGL2) {
      if (this._extensions.has('OES_standard_derivatives')) return 0x1100;
      if (!this._error) this._error = 0x0500;
      return null;
    }
    if (key === 0x8FBB) {
      const extension = this._isWebGL2
        ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query';
      if (this._extensions.has(extension)) return false;
      if (!this._error) this._error = 0x0500;
      return null;
    }
    // The adapter strings sit behind WEBGL_debug_renderer_info, never here.
    if (key === 0x9245 || key === 0x9246) {
      const gpu = _fingerprint().gpu || {};
      return key === 0x9245 ? (gpu.vendor || '') : (gpu.renderer || '');
    }
    // Viewport and scissor box follow the drawing buffer, like the initial
    // state of a real context.
    if (key === 0x0BA2 || key === 0x0C10) {
      return new Int32Array([0, 0, this.drawingBufferWidth, this.drawingBufferHeight]);
    }
    const apple = _webglProfile() === 'apple' ? _WEBGL_APPLE : null;
    if (apple) {
      const appleArrays = apple.arrayParams[key];
      if (appleArrays) return appleArrays();
      const override = (this._isWebGL2 ? apple.webgl2Params : apple.webgl1Params)[key];
      if (override !== undefined) return override;
    }
    const arrays = _WEBGL1_ARRAY_PARAMETERS[key];
    if (arrays) return arrays();
    if (this._isWebGL2 && _WEBGL2_PARAMETERS[key] !== undefined) return _WEBGL2_PARAMETERS[key];
    const value = _WEBGL1_PARAMETERS[key];
    return value === undefined ? null : value;
  }
  getShaderPrecisionFormat(_shaderType, precisionType) {
    // LOW/MEDIUM/HIGH_FLOAT are 0x8DF0..0x8DF2, the INT variants 0x8DF3..0x8DF5.
    const key = +precisionType;
    const source = key >= 0x8DF3 && key <= 0x8DF5 ? _WEBGL_PRECISION_INT : _WEBGL_PRECISION_FLOAT;
    return Object.assign(Object.create(globalThis.WebGLShaderPrecisionFormat.prototype), source);
  }
  getSupportedExtensions() {
    if (_webglProfile() === 'apple') {
      return (this._isWebGL2 ? _WEBGL_APPLE.webgl2Extensions : _WEBGL_APPLE.webgl1Extensions).slice();
    }
    return (this._isWebGL2 ? _WEBGL2_EXTENSIONS : _WEBGL1_EXTENSIONS).slice();
  }
  getExtension(name) {
    const key = String(name);
    if (!this.getSupportedExtensions().includes(key)) return null;
    if (this._extensions.has(key)) return this._extensions.get(key);
    let value = {};
    if (key === 'WEBGL_debug_renderer_info') {
      value = { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
    } else if (key === 'EXT_texture_filter_anisotropic') {
      value = { TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF };
    } else if (key === 'OES_standard_derivatives') {
      value = _oesStandardDerivatives();
    } else if (key === 'EXT_disjoint_timer_query'
        || key === 'EXT_disjoint_timer_query_webgl2') {
      value = _extDisjointTimerQuery();
    } else if (key === 'WEBGL_compressed_texture_astc') {
      value = _webglCompressedTextureAstc();
    } else if (key === 'WEBGL_lose_context') {
      const context = this;
      value = {
        loseContext() { context._lost = true; },
        restoreContext() { context._lost = false; },
      };
    } else if (key === 'OES_vertex_array_object') {
      value = {
        VERTEX_ARRAY_BINDING_OES: 0x85B5,
        createVertexArrayOES() { return {}; },
        deleteVertexArrayOES() {},
        isVertexArrayOES() { return false; },
        bindVertexArrayOES() {},
      };
    } else if (key === 'WEBGL_compressed_texture_s3tc') {
      value = {
        COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83F0, COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83F1,
        COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83F2, COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83F3,
      };
    }
    this._extensions.set(key, value);
    return value;
  }
  createShader(type) { return { type, source: '', compiled: true }; }
  shaderSource(shader, source) { if (shader) shader.source = String(source); }
  compileShader(shader) { if (shader) shader.compiled = true; }
  getShaderParameter(shader, pname) { return pname === 0x8B81 ? !!shader?.compiled : null; }
  getShaderInfoLog() { return ''; }
  createProgram() { return { shaders: [], linked: true }; }
  attachShader(program, shader) { if (program && shader) program.shaders.push(shader); }
  linkProgram(program) { if (program) program.linked = true; }
  getProgramParameter(program, pname) { return pname === 0x8B82 ? !!program?.linked : null; }
  getProgramInfoLog() { return ''; }
  useProgram() {} getAttribLocation() { return 0; } getUniformLocation() { return {}; }
  viewport() {} clearColor() {} clear() {} enable() {} disable() {} drawArrays() {} drawElements() {} flush() {} finish() {}
  createBuffer() { return {}; } bindBuffer() {} bufferData() {} createTexture() { return {}; } bindTexture() {} texImage2D() {} texParameteri() {}
  // A page that renders a probe triangle and hashes the pixels gets a stable
  // per-profile digest. All zeroes -- what a plain `fill(0)` produces -- is as
  // distinctive a hash as any, and it is the one no GPU ever draws.
  readPixels(x, y, width, height, _format, _type, pixels) {
    if (!pixels || typeof pixels.length !== 'number') return undefined;
    const columns = Math.max(1, +width || 1);
    for (let index = 0; index + 3 < pixels.length; index += 4) {
      const pixel = index >> 2;
      const px = (+x || 0) + (pixel % columns);
      const py = (+y || 0) + Math.floor(pixel / columns);
      pixels[index] = (_fpRand(px * 6151 + py * 8807 + 1) * 256) & 0xFF;
      pixels[index + 1] = (_fpRand(px * 6151 + py * 8807 + 2) * 256) & 0xFF;
      pixels[index + 2] = (_fpRand(px * 6151 + py * 8807 + 3) * 256) & 0xFF;
      pixels[index + 3] = 255;
    }
    return undefined;
  }
  isContextLost() { return this._lost; }
  // A real context reallocates its drawing buffer when the canvas resizes.
  _resizeFromCanvas() {
    this.drawingBufferWidth = this.canvas.width;
    this.drawingBufferHeight = this.canvas.height;
  }

  // The query surface a capability probe walks. Every one of these was
  // missing, so a probe that called them got a TypeError instead of a value
  // -- and a thrown exception is a louder signal than any number they could
  // have returned.
  getError() {
    const error = this._error;
    this._error = 0;
    return error;
  }
  isEnabled(capability) { return +capability === 0x0BD0; }  // DITHER is on by default
  checkFramebufferStatus() { return 0x8CD5; }               // FRAMEBUFFER_COMPLETE
  getInternalformatParameter(_target, internalformat, pname) {
    // Chrome validates the pname and internalformat shape before the backend
    // answers; the sample counts themselves are the profile's (Apple GPUs
    // top out at 4x MSAA, D3D11 FL11 reports 8/4/2/1).
    if (+pname !== 0x80A9) {
      if (!this._error) this._error = 0x0500;
      return null;
    }
    const key = +internalformat;
    const counts = _webglProfile() === 'apple' ? [4, 2] : [8, 4, 2, 1];
    if (_WEBGL_IFP_RENDERABLE.has(key)) return new Int32Array(counts);
    if (_WEBGL_IFP_FLOAT_RENDERABLE.has(key)
        && this._extensions.has('EXT_color_buffer_float')) {
      return new Int32Array(counts);
    }
    if (!this._error) this._error = 0x0500;
    return null;
  }
  getIndexedParameter() { return null; }
  getFramebufferAttachmentParameter() { return null; }
  getRenderbufferParameter() { return 0; }
  getBufferParameter() { return 0; }
  getTexParameter() { return 0; }
  getVertexAttrib() { return null; }
  getVertexAttribOffset() { return 0; }
  getUniform() { return null; }
  getActiveAttrib() { return null; }
  getActiveUniform() { return null; }
  getAttachedShaders() { return []; }
  getShaderSource(shader) { return shader ? shader.source : null; }
  getUniformBlockIndex() { return 0xFFFFFFFF; }
  getFragDataLocation() { return -1; }
  createFramebuffer() { return {}; }
  createRenderbuffer() { return {}; }
  createVertexArray() { return {}; }
  createSampler() { return {}; }
  createQuery() { return {}; }
  createTransformFeedback() { return {}; }
  bindFramebuffer() {} bindRenderbuffer() {} bindVertexArray() {} bindSampler() {}
  deleteBuffer() {} deleteFramebuffer() {} deleteProgram() {} deleteRenderbuffer() {}
  deleteShader() {} deleteTexture() {} deleteVertexArray() {}
  renderbufferStorage() {} renderbufferStorageMultisample() {}
  framebufferTexture2D() {} framebufferRenderbuffer() {}
  texStorage2D() {} texSubImage2D() {} compressedTexImage2D() {} generateMipmap() {}
  activeTexture() {} blendFunc() {} blendFuncSeparate() {} blendEquation() {}
  depthFunc() {} depthMask() {} cullFace() {} frontFace() {} scissor() {}
  colorMask() {} clearDepth() {} clearStencil() {} lineWidth() {} pixelStorei() {}
  hint() {} polygonOffset() {} sampleCoverage() {} stencilFunc() {} stencilMask() {}
  stencilOp() {} bindAttribLocation() {} enableVertexAttribArray() {}
  disableVertexAttribArray() {} vertexAttribPointer() {} validateProgram() {}
  uniform1i() {} uniform1f() {} uniform2f() {} uniform3f() {} uniform4f() {}
  uniform1fv() {} uniform2fv() {} uniform3fv() {} uniform4fv() {}
  uniformMatrix2fv() {} uniformMatrix3fv() {} uniformMatrix4fv() {}
  drawArraysInstanced() {} drawElementsInstanced() {} drawBuffers() {}
  get [Symbol.toStringTag]() {
    return this._isWebGL2 ? 'WebGL2RenderingContext' : 'WebGLRenderingContext';
  }
}
globalThis.WebGLShaderPrecisionFormat = class WebGLShaderPrecisionFormat {
  constructor() { throw new TypeError('Illegal constructor'); }
};
globalThis.WebGLRenderingContext = class WebGLRenderingContext extends _WebGLContext {};
globalThis.WebGL2RenderingContext = class WebGL2RenderingContext extends _WebGLContext {
  get drawingBufferFormat() { return 0x8058; }
};
const _WEBGL1_CONSTANTS = {
  DEPTH_BUFFER_BIT: 0x100, STENCIL_BUFFER_BIT: 0x400, COLOR_BUFFER_BIT: 0x4000, POINTS: 0x0,
  LINES: 0x1, LINE_LOOP: 0x2, LINE_STRIP: 0x3, TRIANGLES: 0x4,
  TRIANGLE_STRIP: 0x5, TRIANGLE_FAN: 0x6, ZERO: 0x0, ONE: 0x1,
  SRC_COLOR: 0x300, ONE_MINUS_SRC_COLOR: 0x301, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303,
  DST_ALPHA: 0x304, ONE_MINUS_DST_ALPHA: 0x305, DST_COLOR: 0x306, ONE_MINUS_DST_COLOR: 0x307,
  SRC_ALPHA_SATURATE: 0x308, FUNC_ADD: 0x8006, BLEND_EQUATION: 0x8009, BLEND_EQUATION_RGB: 0x8009,
  BLEND_EQUATION_ALPHA: 0x883D, FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B, BLEND_DST_RGB: 0x80C8,
  BLEND_SRC_RGB: 0x80C9, BLEND_DST_ALPHA: 0x80CA, BLEND_SRC_ALPHA: 0x80CB, CONSTANT_COLOR: 0x8001,
  ONE_MINUS_CONSTANT_COLOR: 0x8002, CONSTANT_ALPHA: 0x8003, ONE_MINUS_CONSTANT_ALPHA: 0x8004, BLEND_COLOR: 0x8005,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
  STREAM_DRAW: 0x88E0, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, BUFFER_SIZE: 0x8764,
  BUFFER_USAGE: 0x8765, CURRENT_VERTEX_ATTRIB: 0x8626, FRONT: 0x404, BACK: 0x405,
  FRONT_AND_BACK: 0x408, TEXTURE_2D: 0xDE1, CULL_FACE: 0xB44, BLEND: 0xBE2,
  DITHER: 0xBD0, STENCIL_TEST: 0xB90, DEPTH_TEST: 0xB71, SCISSOR_TEST: 0xC11,
  POLYGON_OFFSET_FILL: 0x8037, SAMPLE_ALPHA_TO_COVERAGE: 0x809E, SAMPLE_COVERAGE: 0x80A0, NO_ERROR: 0x0,
  INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502, OUT_OF_MEMORY: 0x505,
  CW: 0x900, CCW: 0x901, LINE_WIDTH: 0xB21, ALIASED_POINT_SIZE_RANGE: 0x846D,
  ALIASED_LINE_WIDTH_RANGE: 0x846E, CULL_FACE_MODE: 0xB45, FRONT_FACE: 0xB46, DEPTH_RANGE: 0xB70,
  DEPTH_WRITEMASK: 0xB72, DEPTH_CLEAR_VALUE: 0xB73, DEPTH_FUNC: 0xB74, STENCIL_CLEAR_VALUE: 0xB91,
  STENCIL_FUNC: 0xB92, STENCIL_FAIL: 0xB94, STENCIL_PASS_DEPTH_FAIL: 0xB95, STENCIL_PASS_DEPTH_PASS: 0xB96,
  STENCIL_REF: 0xB97, STENCIL_VALUE_MASK: 0xB93, STENCIL_WRITEMASK: 0xB98, STENCIL_BACK_FUNC: 0x8800,
  STENCIL_BACK_FAIL: 0x8801, STENCIL_BACK_PASS_DEPTH_FAIL: 0x8802, STENCIL_BACK_PASS_DEPTH_PASS: 0x8803, STENCIL_BACK_REF: 0x8CA3,
  STENCIL_BACK_VALUE_MASK: 0x8CA4, STENCIL_BACK_WRITEMASK: 0x8CA5, VIEWPORT: 0xBA2, SCISSOR_BOX: 0xC10,
  COLOR_CLEAR_VALUE: 0xC22, COLOR_WRITEMASK: 0xC23, UNPACK_ALIGNMENT: 0xCF5, PACK_ALIGNMENT: 0xD05,
  MAX_TEXTURE_SIZE: 0xD33, MAX_VIEWPORT_DIMS: 0xD3A, SUBPIXEL_BITS: 0xD50, RED_BITS: 0xD52,
  GREEN_BITS: 0xD53, BLUE_BITS: 0xD54, ALPHA_BITS: 0xD55, DEPTH_BITS: 0xD56,
  STENCIL_BITS: 0xD57, POLYGON_OFFSET_UNITS: 0x2A00, POLYGON_OFFSET_FACTOR: 0x8038, TEXTURE_BINDING_2D: 0x8069,
  SAMPLE_BUFFERS: 0x80A8, SAMPLES: 0x80A9, SAMPLE_COVERAGE_VALUE: 0x80AA, SAMPLE_COVERAGE_INVERT: 0x80AB,
  COMPRESSED_TEXTURE_FORMATS: 0x86A3, DONT_CARE: 0x1100, FASTEST: 0x1101, NICEST: 0x1102,
  GENERATE_MIPMAP_HINT: 0x8192, BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402,
  UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406,
  DEPTH_COMPONENT: 0x1902, ALPHA: 0x1906, RGB: 0x1907, RGBA: 0x1908,
  LUMINANCE: 0x1909, LUMINANCE_ALPHA: 0x190A, UNSIGNED_SHORT_4_4_4_4: 0x8033, UNSIGNED_SHORT_5_5_5_1: 0x8034,
  UNSIGNED_SHORT_5_6_5: 0x8363, FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_VARYING_VECTORS: 0x8DFC, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD, SHADER_TYPE: 0x8B4F, DELETE_STATUS: 0x8B80,
  LINK_STATUS: 0x8B82, VALIDATE_STATUS: 0x8B83, ATTACHED_SHADERS: 0x8B85, ACTIVE_UNIFORMS: 0x8B86,
  ACTIVE_ATTRIBUTES: 0x8B89, SHADING_LANGUAGE_VERSION: 0x8B8C, CURRENT_PROGRAM: 0x8B8D, NEVER: 0x200,
  LESS: 0x201, EQUAL: 0x202, LEQUAL: 0x203, GREATER: 0x204,
  NOTEQUAL: 0x205, GEQUAL: 0x206, ALWAYS: 0x207, KEEP: 0x1E00,
  REPLACE: 0x1E01, INCR: 0x1E02, DECR: 0x1E03, INVERT: 0x150A,
  INCR_WRAP: 0x8507, DECR_WRAP: 0x8508, VENDOR: 0x1F00, RENDERER: 0x1F01,
  VERSION: 0x1F02, NEAREST: 0x2600, LINEAR: 0x2601, NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701, NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE: 0x1702,
  TEXTURE_CUBE_MAP: 0x8513, TEXTURE_BINDING_CUBE_MAP: 0x8514, TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
  TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517, TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518, TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519, TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851A,
  MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C, TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
  TEXTURE3: 0x84C3, TEXTURE4: 0x84C4, TEXTURE5: 0x84C5, TEXTURE6: 0x84C6,
  TEXTURE7: 0x84C7, TEXTURE8: 0x84C8, TEXTURE9: 0x84C9, TEXTURE10: 0x84CA,
  TEXTURE11: 0x84CB, TEXTURE12: 0x84CC, TEXTURE13: 0x84CD, TEXTURE14: 0x84CE,
  TEXTURE15: 0x84CF, TEXTURE16: 0x84D0, TEXTURE17: 0x84D1, TEXTURE18: 0x84D2,
  TEXTURE19: 0x84D3, TEXTURE20: 0x84D4, TEXTURE21: 0x84D5, TEXTURE22: 0x84D6,
  TEXTURE23: 0x84D7, TEXTURE24: 0x84D8, TEXTURE25: 0x84D9, TEXTURE26: 0x84DA,
  TEXTURE27: 0x84DB, TEXTURE28: 0x84DC, TEXTURE29: 0x84DD, TEXTURE30: 0x84DE,
  TEXTURE31: 0x84DF, ACTIVE_TEXTURE: 0x84E0, REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F,
  MIRRORED_REPEAT: 0x8370, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52,
  INT_VEC2: 0x8B53, INT_VEC3: 0x8B54, INT_VEC4: 0x8B55, BOOL: 0x8B56,
  BOOL_VEC2: 0x8B57, BOOL_VEC3: 0x8B58, BOOL_VEC4: 0x8B59, FLOAT_MAT2: 0x8B5A,
  FLOAT_MAT3: 0x8B5B, FLOAT_MAT4: 0x8B5C, SAMPLER_2D: 0x8B5E, SAMPLER_CUBE: 0x8B60,
  VERTEX_ATTRIB_ARRAY_ENABLED: 0x8622, VERTEX_ATTRIB_ARRAY_SIZE: 0x8623, VERTEX_ATTRIB_ARRAY_STRIDE: 0x8624, VERTEX_ATTRIB_ARRAY_TYPE: 0x8625,
  VERTEX_ATTRIB_ARRAY_NORMALIZED: 0x886A, VERTEX_ATTRIB_ARRAY_POINTER: 0x8645, VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: 0x889F, IMPLEMENTATION_COLOR_READ_TYPE: 0x8B9A,
  IMPLEMENTATION_COLOR_READ_FORMAT: 0x8B9B, COMPILE_STATUS: 0x8B81, LOW_FLOAT: 0x8DF0, MEDIUM_FLOAT: 0x8DF1,
  HIGH_FLOAT: 0x8DF2, LOW_INT: 0x8DF3, MEDIUM_INT: 0x8DF4, HIGH_INT: 0x8DF5,
  FRAMEBUFFER: 0x8D40, RENDERBUFFER: 0x8D41, RGBA4: 0x8056, RGB5_A1: 0x8057,
  RGB565: 0x8D62, DEPTH_COMPONENT16: 0x81A5, STENCIL_INDEX8: 0x8D48, DEPTH_STENCIL: 0x84F9,
  RENDERBUFFER_WIDTH: 0x8D42, RENDERBUFFER_HEIGHT: 0x8D43, RENDERBUFFER_INTERNAL_FORMAT: 0x8D44, RENDERBUFFER_RED_SIZE: 0x8D50,
  RENDERBUFFER_GREEN_SIZE: 0x8D51, RENDERBUFFER_BLUE_SIZE: 0x8D52, RENDERBUFFER_ALPHA_SIZE: 0x8D53, RENDERBUFFER_DEPTH_SIZE: 0x8D54,
  RENDERBUFFER_STENCIL_SIZE: 0x8D55, FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 0x8CD0, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 0x8CD1, FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: 0x8CD2,
  FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: 0x8CD3, COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00, STENCIL_ATTACHMENT: 0x8D20,
  DEPTH_STENCIL_ATTACHMENT: 0x821A, NONE: 0x0, FRAMEBUFFER_COMPLETE: 0x8CD5, FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8CD6,
  FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8CD7, FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 0x8CD9, FRAMEBUFFER_UNSUPPORTED: 0x8CDD, FRAMEBUFFER_BINDING: 0x8CA6,
  RENDERBUFFER_BINDING: 0x8CA7, MAX_RENDERBUFFER_SIZE: 0x84E8, INVALID_FRAMEBUFFER_OPERATION: 0x506, UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241, CONTEXT_LOST_WEBGL: 0x9242, UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243, BROWSER_DEFAULT_WEBGL: 0x9244,
  RGB8: 0x8051, RGBA8: 0x8058,
};
const _WEBGL2_EXTRA_CONSTANTS = {
  READ_BUFFER: 0xC02, UNPACK_ROW_LENGTH: 0xCF2, UNPACK_SKIP_ROWS: 0xCF3, UNPACK_SKIP_PIXELS: 0xCF4,
  PACK_ROW_LENGTH: 0xD02, PACK_SKIP_ROWS: 0xD03, PACK_SKIP_PIXELS: 0xD04, COLOR: 0x1800,
  DEPTH: 0x1801, STENCIL: 0x1802, RED: 0x1903, RGB10_A2: 0x8059,
  TEXTURE_BINDING_3D: 0x806A, UNPACK_SKIP_IMAGES: 0x806D, UNPACK_IMAGE_HEIGHT: 0x806E, TEXTURE_3D: 0x806F,
  TEXTURE_WRAP_R: 0x8072, MAX_3D_TEXTURE_SIZE: 0x8073, UNSIGNED_INT_2_10_10_10_REV: 0x8368, MAX_ELEMENTS_VERTICES: 0x80E8,
  MAX_ELEMENTS_INDICES: 0x80E9, TEXTURE_MIN_LOD: 0x813A, TEXTURE_MAX_LOD: 0x813B, TEXTURE_BASE_LEVEL: 0x813C,
  TEXTURE_MAX_LEVEL: 0x813D, MIN: 0x8007, MAX: 0x8008, DEPTH_COMPONENT24: 0x81A6,
  MAX_TEXTURE_LOD_BIAS: 0x84FD, TEXTURE_COMPARE_MODE: 0x884C, TEXTURE_COMPARE_FUNC: 0x884D, CURRENT_QUERY: 0x8865,
  QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867, STREAM_READ: 0x88E1, STREAM_COPY: 0x88E2,
  STATIC_READ: 0x88E5, STATIC_COPY: 0x88E6, DYNAMIC_READ: 0x88E9, DYNAMIC_COPY: 0x88EA,
  MAX_DRAW_BUFFERS: 0x8824, DRAW_BUFFER0: 0x8825, DRAW_BUFFER1: 0x8826, DRAW_BUFFER2: 0x8827,
  DRAW_BUFFER3: 0x8828, DRAW_BUFFER4: 0x8829, DRAW_BUFFER5: 0x882A, DRAW_BUFFER6: 0x882B,
  DRAW_BUFFER7: 0x882C, DRAW_BUFFER8: 0x882D, DRAW_BUFFER9: 0x882E, DRAW_BUFFER10: 0x882F,
  DRAW_BUFFER11: 0x8830, DRAW_BUFFER12: 0x8831, DRAW_BUFFER13: 0x8832, DRAW_BUFFER14: 0x8833,
  DRAW_BUFFER15: 0x8834, MAX_FRAGMENT_UNIFORM_COMPONENTS: 0x8B49, MAX_VERTEX_UNIFORM_COMPONENTS: 0x8B4A, SAMPLER_3D: 0x8B5F,
  SAMPLER_2D_SHADOW: 0x8B62, FRAGMENT_SHADER_DERIVATIVE_HINT: 0x8B8B, PIXEL_PACK_BUFFER: 0x88EB, PIXEL_UNPACK_BUFFER: 0x88EC,
  PIXEL_PACK_BUFFER_BINDING: 0x88ED, PIXEL_UNPACK_BUFFER_BINDING: 0x88EF, FLOAT_MAT2x3: 0x8B65, FLOAT_MAT2x4: 0x8B66,
  FLOAT_MAT3x2: 0x8B67, FLOAT_MAT3x4: 0x8B68, FLOAT_MAT4x2: 0x8B69, FLOAT_MAT4x3: 0x8B6A,
  SRGB: 0x8C40, SRGB8: 0x8C41, SRGB8_ALPHA8: 0x8C43, COMPARE_REF_TO_TEXTURE: 0x884E,
  RGBA32F: 0x8814, RGB32F: 0x8815, RGBA16F: 0x881A, RGB16F: 0x881B,
  VERTEX_ATTRIB_ARRAY_INTEGER: 0x88FD, MAX_ARRAY_TEXTURE_LAYERS: 0x88FF, MIN_PROGRAM_TEXEL_OFFSET: 0x8904, MAX_PROGRAM_TEXEL_OFFSET: 0x8905,
  MAX_VARYING_COMPONENTS: 0x8B4B, TEXTURE_2D_ARRAY: 0x8C1A, TEXTURE_BINDING_2D_ARRAY: 0x8C1D, R11F_G11F_B10F: 0x8C3A,
  UNSIGNED_INT_10F_11F_11F_REV: 0x8C3B, RGB9_E5: 0x8C3D, UNSIGNED_INT_5_9_9_9_REV: 0x8C3E, TRANSFORM_FEEDBACK_BUFFER_MODE: 0x8C7F,
  MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS: 0x8C80, TRANSFORM_FEEDBACK_VARYINGS: 0x8C83, TRANSFORM_FEEDBACK_BUFFER_START: 0x8C84, TRANSFORM_FEEDBACK_BUFFER_SIZE: 0x8C85,
  TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN: 0x8C88, RASTERIZER_DISCARD: 0x8C89, MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS: 0x8C8A, MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS: 0x8C8B,
  INTERLEAVED_ATTRIBS: 0x8C8C, SEPARATE_ATTRIBS: 0x8C8D, TRANSFORM_FEEDBACK_BUFFER: 0x8C8E, TRANSFORM_FEEDBACK_BUFFER_BINDING: 0x8C8F,
  RGBA32UI: 0x8D70, RGB32UI: 0x8D71, RGBA16UI: 0x8D76, RGB16UI: 0x8D77,
  RGBA8UI: 0x8D7C, RGB8UI: 0x8D7D, RGBA32I: 0x8D82, RGB32I: 0x8D83,
  RGBA16I: 0x8D88, RGB16I: 0x8D89, RGBA8I: 0x8D8E, RGB8I: 0x8D8F,
  RED_INTEGER: 0x8D94, RGB_INTEGER: 0x8D98, RGBA_INTEGER: 0x8D99, SAMPLER_2D_ARRAY: 0x8DC1,
  SAMPLER_2D_ARRAY_SHADOW: 0x8DC4, SAMPLER_CUBE_SHADOW: 0x8DC5, UNSIGNED_INT_VEC2: 0x8DC6, UNSIGNED_INT_VEC3: 0x8DC7,
  UNSIGNED_INT_VEC4: 0x8DC8, INT_SAMPLER_2D: 0x8DCA, INT_SAMPLER_3D: 0x8DCB, INT_SAMPLER_CUBE: 0x8DCC,
  INT_SAMPLER_2D_ARRAY: 0x8DCF, UNSIGNED_INT_SAMPLER_2D: 0x8DD2, UNSIGNED_INT_SAMPLER_3D: 0x8DD3, UNSIGNED_INT_SAMPLER_CUBE: 0x8DD4,
  UNSIGNED_INT_SAMPLER_2D_ARRAY: 0x8DD7, DEPTH_COMPONENT32F: 0x8CAC, DEPTH32F_STENCIL8: 0x8CAD, FLOAT_32_UNSIGNED_INT_24_8_REV: 0x8DAD,
  FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING: 0x8210, FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE: 0x8211, FRAMEBUFFER_ATTACHMENT_RED_SIZE: 0x8212, FRAMEBUFFER_ATTACHMENT_GREEN_SIZE: 0x8213,
  FRAMEBUFFER_ATTACHMENT_BLUE_SIZE: 0x8214, FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE: 0x8215, FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE: 0x8216, FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE: 0x8217,
  FRAMEBUFFER_DEFAULT: 0x8218, UNSIGNED_INT_24_8: 0x84FA, DEPTH24_STENCIL8: 0x88F0, UNSIGNED_NORMALIZED: 0x8C17,
  DRAW_FRAMEBUFFER_BINDING: 0x8CA6, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9, READ_FRAMEBUFFER_BINDING: 0x8CAA,
  RENDERBUFFER_SAMPLES: 0x8CAB, FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER: 0x8CD4, MAX_COLOR_ATTACHMENTS: 0x8CDF, COLOR_ATTACHMENT1: 0x8CE1,
  COLOR_ATTACHMENT2: 0x8CE2, COLOR_ATTACHMENT3: 0x8CE3, COLOR_ATTACHMENT4: 0x8CE4, COLOR_ATTACHMENT5: 0x8CE5,
  COLOR_ATTACHMENT6: 0x8CE6, COLOR_ATTACHMENT7: 0x8CE7, COLOR_ATTACHMENT8: 0x8CE8, COLOR_ATTACHMENT9: 0x8CE9,
  COLOR_ATTACHMENT10: 0x8CEA, COLOR_ATTACHMENT11: 0x8CEB, COLOR_ATTACHMENT12: 0x8CEC, COLOR_ATTACHMENT13: 0x8CED,
  COLOR_ATTACHMENT14: 0x8CEE, COLOR_ATTACHMENT15: 0x8CEF, FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: 0x8D56, MAX_SAMPLES: 0x8D57,
  HALF_FLOAT: 0x140B, RG: 0x8227, RG_INTEGER: 0x8228, R8: 0x8229,
  RG8: 0x822B, R16F: 0x822D, R32F: 0x822E, RG16F: 0x822F,
  RG32F: 0x8230, R8I: 0x8231, R8UI: 0x8232, R16I: 0x8233,
  R16UI: 0x8234, R32I: 0x8235, R32UI: 0x8236, RG8I: 0x8237,
  RG8UI: 0x8238, RG16I: 0x8239, RG16UI: 0x823A, RG32I: 0x823B,
  RG32UI: 0x823C, VERTEX_ARRAY_BINDING: 0x85B5, R8_SNORM: 0x8F94, RG8_SNORM: 0x8F95,
  RGB8_SNORM: 0x8F96, RGBA8_SNORM: 0x8F97, SIGNED_NORMALIZED: 0x8F9C, COPY_READ_BUFFER: 0x8F36,
  COPY_WRITE_BUFFER: 0x8F37, COPY_READ_BUFFER_BINDING: 0x8F36, COPY_WRITE_BUFFER_BINDING: 0x8F37, UNIFORM_BUFFER: 0x8A11,
  UNIFORM_BUFFER_BINDING: 0x8A28, UNIFORM_BUFFER_START: 0x8A29, UNIFORM_BUFFER_SIZE: 0x8A2A, MAX_VERTEX_UNIFORM_BLOCKS: 0x8A2B,
  MAX_FRAGMENT_UNIFORM_BLOCKS: 0x8A2D, MAX_COMBINED_UNIFORM_BLOCKS: 0x8A2E, MAX_UNIFORM_BUFFER_BINDINGS: 0x8A2F, MAX_UNIFORM_BLOCK_SIZE: 0x8A30,
  MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS: 0x8A31, MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS: 0x8A33, UNIFORM_BUFFER_OFFSET_ALIGNMENT: 0x8A34, ACTIVE_UNIFORM_BLOCKS: 0x8A36,
  UNIFORM_TYPE: 0x8A37, UNIFORM_SIZE: 0x8A38, UNIFORM_BLOCK_INDEX: 0x8A3A, UNIFORM_OFFSET: 0x8A3B,
  UNIFORM_ARRAY_STRIDE: 0x8A3C, UNIFORM_MATRIX_STRIDE: 0x8A3D, UNIFORM_IS_ROW_MAJOR: 0x8A3E, UNIFORM_BLOCK_BINDING: 0x8A3F,
  UNIFORM_BLOCK_DATA_SIZE: 0x8A40, UNIFORM_BLOCK_ACTIVE_UNIFORMS: 0x8A42, UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: 0x8A43, UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: 0x8A44,
  UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: 0x8A46, INVALID_INDEX: 0xFFFFFFFF, MAX_VERTEX_OUTPUT_COMPONENTS: 0x9122, MAX_FRAGMENT_INPUT_COMPONENTS: 0x9125,
  MAX_SERVER_WAIT_TIMEOUT: 0x9111, OBJECT_TYPE: 0x9112, SYNC_CONDITION: 0x9113, SYNC_STATUS: 0x9114,
  SYNC_FLAGS: 0x9115, SYNC_FENCE: 0x9116, SYNC_GPU_COMMANDS_COMPLETE: 0x9117, UNSIGNALED: 0x9118,
  SIGNALED: 0x9119, ALREADY_SIGNALED: 0x911A, TIMEOUT_EXPIRED: 0x911B, CONDITION_SATISFIED: 0x911C,
  WAIT_FAILED: 0x911D, SYNC_FLUSH_COMMANDS_BIT: 0x1, VERTEX_ATTRIB_ARRAY_DIVISOR: 0x88FE, ANY_SAMPLES_PASSED: 0x8C2F,
  ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8D6A, SAMPLER_BINDING: 0x8919, RGB10_A2UI: 0x906F, INT_2_10_10_10_REV: 0x8D9F,
  TRANSFORM_FEEDBACK: 0x8E22, TRANSFORM_FEEDBACK_PAUSED: 0x8E23, TRANSFORM_FEEDBACK_ACTIVE: 0x8E24, TRANSFORM_FEEDBACK_BINDING: 0x8E25,
  TEXTURE_IMMUTABLE_FORMAT: 0x912F, MAX_ELEMENT_INDEX: 0x8D6B, TEXTURE_IMMUTABLE_LEVELS: 0x82DF, TIMEOUT_IGNORED: -1,
  MAX_CLIENT_WAIT_TIMEOUT_WEBGL: 0x9247,
};
function _installWebGLConstants(constructor, tables) {
  for (const table of tables) {
    for (const [name, value] of Object.entries(table)) {
      const descriptor = { value, writable: false, enumerable: true, configurable: false };
      Object.defineProperty(constructor, name, descriptor);
      Object.defineProperty(constructor.prototype, name, descriptor);
    }
  }
}
_installWebGLConstants(globalThis.WebGLRenderingContext, [_WEBGL1_CONSTANTS]);
_installWebGLConstants(globalThis.WebGL2RenderingContext,
  [_WEBGL1_CONSTANTS, _WEBGL2_EXTRA_CONSTANTS]);

// `screen.orientation` used to be an object literal with three no-op methods.
