// strokeText draws a band of ink along the glyph outline, not the glyph fill:
// at lineWidth 1 the counter (the hole of an 'O') stays open, at lineWidth 8
// the band swallows it. A live shadow must spread from the ink that was
// actually laid down, so the stroke's shadow mask follows the band too. An
// engine that reuses the fill coverage for both answers "stroke" with a solid
// glyph whose silhouette never changes as lineWidth moves -- measurable as a
// stroke alphaSum/nz that is identical for every width, and a counter that is
// never open.
//
// The scene matrix fixes font, glyph and canvas; only the op, the line width
// and the shadow switch move. Every scene reports raw pixel evidence: the
// alpha total (data[3::4] sum, the cross-engine comparable read), the nonzero
// count, the ink bounding box, and the 3x3 alpha patch at the bbox centre --
// the hole probe.
globalThis.strokeShadowFixturePromise = (async () => {
  await document.fonts.ready;

  const GLYPH = 'O';
  const FONT = '20px sans-serif';
  const SIZE = 64;
  const PEN_X = 32;
  const PEN_Y = 40;

  const SCENES = [
    { name: 'fill',              op: 'fill',   lineWidth: null, shadow: false },
    { name: 'fill-shadow',       op: 'fill',   lineWidth: null, shadow: true },
    { name: 'stroke-lw1',        op: 'stroke', lineWidth: 1,    shadow: false },
    { name: 'stroke-lw4',        op: 'stroke', lineWidth: 4,    shadow: false },
    { name: 'stroke-lw8',        op: 'stroke', lineWidth: 8,    shadow: false },
    { name: 'stroke-lw1-shadow', op: 'stroke', lineWidth: 1,    shadow: true },
    { name: 'stroke-lw4-shadow', op: 'stroke', lineWidth: 4,    shadow: true },
    { name: 'stroke-lw8-shadow', op: 'stroke', lineWidth: 8,    shadow: true },
  ];

  // Alpha-only metrics: the RGB channels stay at the ink colour everywhere, so
  // the alpha plane is the whole signal. holeCentre3x3 is reported raw (row
  // major, null where the patch would leave the canvas) rather than averaged,
  // so two engines can be compared byte for byte.
  function measure(data, w, h) {
    let alphaSum = 0;
    let nz = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a > 0) {
          alphaSum += a;
          nz++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const hole = [];
    if (maxX >= 0) {
      const cx = (minX + maxX) >> 1;
      const cy = (minY + maxY) >> 1;
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          const inside = x >= 0 && x < w && y >= 0 && y < h;
          hole.push(inside ? data[(y * w + x) * 4 + 3] : null);
        }
      }
    }
    return {
      alphaSum,
      nz,
      bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
      holeCentre3x3: hole,
    };
  }

  function runScene(scene) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    if (scene.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    if (scene.op === 'stroke') {
      ctx.lineWidth = scene.lineWidth;
      ctx.strokeText(GLYPH, PEN_X, PEN_Y);
    } else {
      ctx.fillText(GLYPH, PEN_X, PEN_Y);
    }
    const frame = ctx.getImageData(0, 0, SIZE, SIZE);
    return { scene: scene.name, ...measure(frame.data, SIZE, SIZE) };
  }

  const out = { glyph: GLYPH, font: FONT, size: SIZE, scenes: SCENES.map(runScene) };
  globalThis.strokeShadowFixtureResult = out;
  return out;
})();
