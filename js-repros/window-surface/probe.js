// Chrome surface oracle probe. Runs inside the browser; returns one big object.
// Captured once per Chrome upgrade into chrome-oracle.json. The install list we
// ship is the intersection with what the CF challenge actually probes
// (payload ZokK1 buckets), so a newer probe Chrome cannot oversell interfaces
// that the pinned UA version does not have.
(() => {
  const out = { chrome: true };

  // ---- 1. window surface -------------------------------------------------
  const names = Object.getOwnPropertyNames(globalThis);
  out.window = { names: [] };
  const entries = {};
  for (const name of names) {
    const e = {};
    try {
      const d = Object.getOwnPropertyDescriptor(globalThis, name);
      if (d.get || d.set) {
        e.kind = 'accessor';
        try { e.type = typeof globalThis[name]; } catch (err) { e.type = 'throws'; }
      } else if (typeof d.value === 'function') {
        e.kind = 'function';
        try { e.name = d.value.name; } catch {}
        try { e.length = d.value.length; } catch {}
        try { e.native = Function.prototype.toString.call(d.value).includes('[native code]'); } catch {}
        try {
          if (d.value.prototype) {
            const pp = Object.getPrototypeOf(d.value.prototype);
            e.protoParent = pp === null ? null
              : (pp.constructor ? pp.constructor.name : 'anon');
          } else { e.protoParent = 'no-proto'; }
        } catch {}
        try {
          const inst = Reflect.construct(d.value, []);
          e.ctor = 'ok';
          e.ctorTag = Object.prototype.toString.call(inst).slice(8, -1);
        } catch (err) {
          e.ctor = 'throws';
          e.ctorMsg = String(err && err.message || err).slice(0, 100);
        }
      } else if (typeof d.value === 'object' && d.value !== null) {
        e.kind = 'object';
        e.tag = Object.prototype.toString.call(d.value).slice(8, -1);
      } else {
        e.kind = typeof d.value;
        e.value = String(d.value).slice(0, 40);
      }
      e.attrs = d.writable !== undefined
        ? [d.writable, d.enumerable, d.configurable]
        : [!!d.get, d.enumerable, d.configurable];
    } catch (err) {
      e.kind = 'throws';
      e.err = String(err).slice(0, 60);
    }
    entries[name] = e;
  }
  out.window.names = names;
  out.windowEntries = entries;

  // The CF N bucket also lists prototype methods (addEventListener etc.), so
  // capture the interface prototypes' own members alongside the window own set.
  out.prototypeMembers = {};
  for (const [label, proto] of [
    ['Window', Object.getPrototypeOf(globalThis)],
    ['Navigator', typeof Navigator !== 'undefined' ? Navigator.prototype : null],
    ['Document', typeof Document !== 'undefined' ? Document.prototype : null],
    ['Screen', typeof Screen !== 'undefined' ? Screen.prototype : null],
    ['ScreenOrientation', typeof ScreenOrientation !== 'undefined' ? ScreenOrientation.prototype : null],
  ]) {
    if (!proto) continue;
    const members = {};
    for (const k of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, k);
      members[k] = d && (d.get || d.set) ? 'accessor' : typeof d.value;
    }
    out.prototypeMembers[label] = members;
  }

  // ---- 2. navigator surface ----------------------------------------------
  const nav = {};
  try {
    nav.prototypeGetters = Object.getOwnPropertyNames(Navigator.prototype);
    nav.instanceOwn = Object.getOwnPropertyNames(navigator);
    const types = {};
    for (const k of nav.prototypeGetters) {
      try { types[k] = typeof navigator[k]; } catch (err) { types[k] = 'throws'; }
    }
    nav.types = types;
    nav.prototypeAttrs = {};
    for (const k of nav.prototypeGetters.slice(0, 400)) {
      const d = Object.getOwnPropertyDescriptor(Navigator.prototype, k);
      nav.prototypeAttrs[k] = d && (d.get || d.set) ? 'accessor'
        : d ? [!!d.writable, !!d.enumerable, !!d.configurable] : null;
    }
  } catch (err) { nav.error = String(err).slice(0, 120); }
  out.navigator = nav;

  // ---- 3. UA-CH ------------------------------------------------------------
  out.userAgent = navigator.userAgent;
  out.platform = navigator.platform;
  out.languages = navigator.languages;

  // ---- 4. WebGL ------------------------------------------------------------
  const FORMATS = [33321, 36756, 33330, 33329, 33332, 33331, 33334, 33333, 33323,
    36757, 33336, 33335, 33338, 33337, 33340, 33339, 32849, 36758, 35905, 36221,
    36239, 36215, 36233, 36209, 36227, 32856, 36759, 35907, 32857, 36220, 36238,
    36975, 36214, 36232, 36208, 36226, 34842, 34836, 35898, 35901, 33325, 33326,
    33327, 33328, 33189, 33190, 36012, 36168, 35056, 36013, 32854, 32855, 36194];
  function glFace(gl) {
    if (!gl) return null;
    const face = {};
    try { face.extensions = gl.getSupportedExtensions(); } catch (e) { face.extensions = 'throws'; }
    const proto = Object.getPrototypeOf(gl);
    const constNames = Object.getOwnPropertyNames(proto)
      .filter(k => /^[A-Z][A-Z0-9_]*$/.test(k));
    face.constants = {};
    for (const k of constNames) {
      try { face.constants[k] = gl[k]; } catch {}
    }
    face.params = {};
    for (const [k, v] of Object.entries(face.constants)) {
      if (typeof v !== 'number') continue;
      try {
        const r = gl.getParameter(v);
        face.params[k] = ArrayBuffer.isView(r) ? Array.from(r) : r;
      } catch (err) { face.params[k] = { throws: String(err && err.message || err).slice(0, 60) }; }
    }
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      face.unmaskedVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
      face.unmaskedRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
    } catch {}
    try { face.contextAttributes = gl.getContextAttributes(); } catch {}
    try {
      face.precisions = {};
      for (const sh of [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER]) {
        for (const p of [gl.LOW_FLOAT, gl.MEDIUM_FLOAT, gl.HIGH_FLOAT, gl.LOW_INT, gl.MEDIUM_INT, gl.HIGH_INT]) {
          const r = gl.getShaderPrecisionFormat(sh, p);
          face.precisions[sh + ':' + p] = r ? [r.rangeMin, r.rangeMax, r.precision] : null;
        }
      }
    } catch {}
    return face;
  }
  out.webgl1 = glFace(document.createElement('canvas').getContext('webgl'));
  out.webgl2 = glFace(document.createElement('canvas').getContext('webgl2'));
  const c2 = document.createElement('canvas').getContext('webgl2', { antialias: true, powerPreference: 'low-power' });
  try { out.webgl2LowPowerAttrs = c2 ? c2.getContextAttributes() : null; } catch { out.webgl2LowPowerAttrs = 'throws'; }
  const c3 = document.createElement('canvas').getContext('webgl2', { antialias: false });
  try { out.webgl2NoAaAttrs = c3 ? c3.getContextAttributes() : null; } catch { out.webgl2NoAaAttrs = 'throws'; }
  if (out.webgl2) {
    // One shared context: creating a fresh WebGL2 context per format exhausts
    // the browser's live-context budget (~16) and the rest silently come back
    // from a lost context as null.
    const shared = document.createElement('canvas').getContext('webgl2');
    out.samples = {};
    for (const f of FORMATS) {
      try {
        const r = shared.getInternalformatParameter(0x8D41, f, 0x80B9);
        out.samples[f] = r ? Array.from(r) : null;
      } catch { out.samples[f] = 'throws'; }
    }
  }

  // ---- 5. WebGPU (async, folded into the promise below) --------------------
  const gpuPromise = (async () => {
    const g = {};
    try {
      if (!navigator.gpu) return { absent: true };
      const ad = await navigator.gpu.requestAdapter();
      g.info = ad ? [ad.info.vendor, ad.info.architecture, ad.info.device, ad.info.description, ad.isFallbackAdapter] : null;
      g.features = ad ? Array.from(ad.features) : null;
      if (ad) {
        g.limits = {};
        for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(ad.limits))) {
          g.limits[k] = ad.limits[k];
        }
        g.subgroupTypes = { min: typeof ad.limits.minSubgroupSize, max: typeof ad.limits.maxSubgroupSize };
        try {
          const dev = await ad.requestDevice();
          g.deviceLimits = {};
          for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(dev.limits))) {
            g.deviceLimits[k] = dev.limits[k];
          }
        } catch (err) { g.deviceLimits = 'throws: ' + String(err).slice(0, 60); }
      }
      g.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat();
      try {
        g.wgslFeatures = navigator.gpu.wgslLanguageFeatures
          ? Array.from(navigator.gpu.wgslLanguageFeatures) : null;
      } catch { g.wgslFeatures = null; }
      try { g.forceFallbackNull = (await navigator.gpu.requestAdapter({ forceFallbackAdapter: true })) === null; } catch { g.forceFallbackNull = 'throws'; }
      try {
        const lp = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
        g.lowPowerInfo = lp ? [lp.info.vendor, lp.info.architecture] : null;
      } catch { g.lowPowerInfo = 'throws'; }
      try {
        const cnv = document.createElement('canvas');
        const ctx = cnv.getContext('webgpu');
        if (ctx && ad) {
          const dev = await ad.requestDevice();
          ctx.configure({ device: dev, format: navigator.gpu.getPreferredCanvasFormat() });
          g.canvasConfiguration = ctx.getConfiguration ? JSON.parse(JSON.stringify(ctx.getConfiguration(), (k, v) => typeof v === 'bigint' ? String(v) : v)) : 'no-getConfiguration';
        } else { g.canvasConfiguration = ctx ? 'no-device' : null; }
      } catch (err) { g.canvasConfiguration = 'throws: ' + String(err).slice(0, 80); }
      return g;
    } catch (err) { return { error: String(err).slice(0, 120) }; }
  })();

  // ---- 6. text metrics + canvas paint baseline (B6/B7) ---------------------
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const TEXT = 'mmmmmmmmmmlli W.g7 09';
  const measure = {};
  for (const [px, fam] of [[10, 'sans-serif'], [16, 'sans-serif'], [16, 'monospace'], [16, 'Arial'], [16, 'serif'], [16, '"Liberation Sans", sans-serif'], [72, 'sans-serif']]) {
    x.font = `${px}px ${fam}`;
    const m = x.measureText(TEXT);
    measure[`${px}|${fam}`] = [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent];
  }
  out.measure = measure;

  c.width = 64; c.height = 8;
  const g2 = x.createLinearGradient(0, 0, 64, 0);
  g2.addColorStop(0, '#000000');
  g2.addColorStop(1, '#ffffff');
  x.fillStyle = g2;
  x.fillRect(0, 0, 64, 8);
  out.gradientRow = Array.from(x.getImageData(0, 0, 64, 1).data.slice(0, 64));

  const c4 = document.createElement('canvas');
  c4.width = 32; c4.height = 32;
  const x4 = c4.getContext('2d');
  x4.fillStyle = '#00ff00';
  x4.beginPath();
  x4.arc(16, 16, 10, 0, Math.PI * 2);
  x4.fill();
  out.arcPixels = Array.from(x4.getImageData(0, 0, 32, 1).data);

  x4.fillStyle = '#c0c0f0';
  x4.beginPath();
  x4.moveTo(2, 2); x4.lineTo(30, 2); x4.lineTo(16, 29); x4.closePath(); x4.fill();
  out.trianglePixels = Array.from(x4.getImageData(0, 4, 32, 1).data);

  // combined promise result
  return gpuPromise.then(gpu => { out.webgpu = gpu; return out; });
})();
