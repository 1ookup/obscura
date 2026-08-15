// Font enumeration: the classic anti-bot probe. A page cannot list installed
// fonts directly, so it measures a string in a candidate family against a
// generic fallback -- a different width means the family resolved to a real
// font. An engine where every candidate measures identically has no fonts at
// all, and one whose answers disagree with its own advertised platform is
// worse still.
globalThis.fontFixturePromise = (async () => {
  const out = {};
  const CANDIDATES = [
    // Cross-platform web-safe
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana',
    'Georgia', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
    // Windows
    'Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'Candara',
    'Franklin Gothic Medium', 'Lucida Console', 'MS Gothic', 'SimSun',
    'Microsoft YaHei',
    // macOS
    'Menlo', 'Monaco', 'Helvetica Neue', 'Apple Chancery', 'Zapfino',
    'Geneva', 'Optima',
    // Should never exist
    'NonexistentFontXYZ123', 'ObscuraTestFace',
  ];
  const GENERICS = ['monospace', 'sans-serif', 'serif'];
  const TEXT = 'mmmmmmmmmmlli' + 'WQ@%#';

  out.fontsApi = typeof document.fonts;
  if (document.fonts) {
    out.fontsShape = {
      tag: Object.prototype.toString.call(document.fonts),
      ctor: document.fonts.constructor && document.fonts.constructor.name,
      size: document.fonts.size,
      status: document.fonts.status,
      checkType: typeof document.fonts.check,
      readyIsPromise: !!document.fonts.ready && typeof document.fonts.ready.then === 'function',
    };
    out.fontsCheck = {};
    for (const family of CANDIDATES) {
      try { out.fontsCheck[family] = document.fonts.check(`12px "${family}"`); }
      catch (error) { out.fontsCheck[family] = 'threw:' + error.name; }
    }
    out.fontsCheckGeneric = {};
    for (const generic of GENERICS) {
      try { out.fontsCheckGeneric[generic] = document.fonts.check(`12px ${generic}`); }
      catch (error) { out.fontsCheckGeneric[generic] = 'threw:' + error.name; }
    }
  }

  // Width-difference enumeration, the form fingerprinters actually ship.
  const span = document.createElement('span');
  span.textContent = TEXT;
  span.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;font-size:72px;white-space:nowrap;';
  document.body.appendChild(span);
  const measure = family => {
    span.style.fontFamily = family;
    return {w: span.offsetWidth, h: span.offsetHeight};
  };
  const baseline = {};
  for (const generic of GENERICS) baseline[generic] = measure(generic);
  out.baseline = baseline;
  out.detected = {};
  out.widths = {};
  for (const family of CANDIDATES) {
    let detected = false;
    const per = {};
    for (const generic of GENERICS) {
      const got = measure(`"${family}", ${generic}`);
      per[generic] = got.w;
      if (got.w !== baseline[generic].w || got.h !== baseline[generic].h) detected = true;
    }
    out.detected[family] = detected;
    out.widths[family] = per;
  }
  out.detectedCount = Object.values(out.detected).filter(Boolean).length;
  // Distinct width values across the whole sweep: 1 means nothing resolved.
  out.distinctWidths = new Set(
    Object.values(out.widths).flatMap(entry => Object.values(entry))).size;
  span.remove();

  // Canvas text metrics are the other half of the same probe.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  out.canvasContext = !!ctx;
  if (ctx) {
    out.canvasWidths = {};
    for (const family of ['monospace', '"Arial", monospace', '"NonexistentFontXYZ123", monospace',
                          '"Segoe UI", sans-serif', '"Menlo", monospace']) {
      ctx.font = `72px ${family}`;
      out.canvasWidths[family] = Math.round(ctx.measureText(TEXT).width * 100) / 100;
    }
  }
  globalThis.fontFixtureResult = out;
  return out;
})();
