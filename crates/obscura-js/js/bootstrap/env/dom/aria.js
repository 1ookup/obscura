globalThis.__ariaQuerySelector = function(root, selector) { return null; };
globalThis.__ariaQuerySelectorAll = async function*(root, selector) { /* yields nothing */ };
const _MAX_CANVAS_DIMENSION = 32767;
const _MAX_CANVAS_PIXELS = 67108864;

// Measure without manufacturing a selector-visible DOM node. The native
// measurer owns the same deterministic cosmic-text engine as element layout.
function _measureTextRun(text, font) {
  try {
    if (text === '') return 0;
    const measure = Deno.core.ops.op_canvas_measure_text;
    if (typeof measure !== 'function') return null;
    const width = measure(String(text), String(font || '10px sans-serif'));
    return typeof width === 'number' && width > 0 ? width : null;
  } catch (_error) { return null; }
}

// Advance width plus the grid-fitted font box, from the same engine element
// measurement uses. Falls back to the old size-derived approximation only in a
// build without the render layer, where there is no font engine to ask.
function _measureTextBox(text, font) {
  const fontString = String(font || '10px sans-serif');
  try {
    const op = Deno.core.ops.op_canvas_text_metrics;
    if (typeof op === 'function') {
      const parts = String(op(String(text), fontString)).split(',');
      const width = Number(parts[0]);
      const ascent = Number(parts[1]);
      const descent = Number(parts[2]);
      if (Number.isFinite(width) && Number.isFinite(ascent) && Number.isFinite(descent)) {
        const inkLeft = Number(parts[3]);
        const inkRight = Number(parts[4]);
        const inkAscent = Number(parts[5]);
        const inkDescent = Number(parts[6]);
        const ink = Number.isFinite(inkLeft) && Number.isFinite(inkRight)
          && Number.isFinite(inkAscent) && Number.isFinite(inkDescent);
        // The baselines are font decisions the layout engine owns, so they
        // come from the same answer as the box instead of a formula repeated
        // here: on a macOS identity the ideographic baseline is the face's
        // OS/2 sTypoDescender, which is not the descent. Older payloads
        // without them keep the descent-based fallback.
        const hanging = Number(parts[7]);
        const ideographic = Number(parts[8]);
        return {
          width, ascent, descent,
          inkLeft: ink ? inkLeft : undefined,
          inkRight: ink ? inkRight : undefined,
          inkAscent: ink ? inkAscent : undefined,
          inkDescent: ink ? inkDescent : undefined,
          hangingBaseline: Number.isFinite(hanging) ? hanging : ascent * 0.8,
          ideographicBaseline: Number.isFinite(ideographic) ? ideographic : -descent,
        };
      }
    }
  } catch (_error) {}
  const fontSize = parseFloat(fontString) || 10;
  const scale = Math.max(1, Math.round(fontSize / 10));
  return { width: String(text).length * 6 * scale, ascent: 7 * scale, descent: 2 * scale };
}

