// Prototype own-key order fixups, run after every interface exists
// (surface-finalize minted its shells, webidl-branding has not run yet but
// only stamps symbols, which getOwnPropertyNames never lists).
//
// WebIDL emits `constructor` after the members the interface declares, and
// the own-key order of an interface prototype is as readable as the set: the
// bench8 proto-order scan diffs Object.getOwnPropertyNames(prototype)
// against a live Chrome, and our class-shaped interfaces read
// ["constructor", ...members] where Chrome reads [...members, "constructor"].
// The fixup deletes each own key and redefines it with the exact descriptor
// it had, in Chrome's order -- redefinition never changes value semantics,
// only the position.
(function _fixProtoOrders() {
  // Reorder proto's own keys to `order` (must be a permutation of the
  // current own keys -- a set mismatch means the surface drifted and the
  // fixup refuses rather than guessing). Returns true when it ran.
  function reorder(proto, order) {
    try {
      const current = Object.getOwnPropertyNames(proto);
      if (current.length !== order.length) return false;
      for (const key of order) {
        if (!Object.prototype.hasOwnProperty.call(proto, key)) return false;
      }
      for (const key of order) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        delete proto[key];
        Object.defineProperty(proto, key, descriptor);
      }
      return true;
    } catch (_e) {
      return false;
    }
  }
  // CanvasGradient: pre-install addColorStop on the shell's prototype and
  // move the constructor behind it (canvas.js owns the intrinsic so
  // createLinearGradient redefinition keeps pointing at the same function).
  if (typeof _canvas2dInstallGradientProto === 'function') {
    try { _canvas2dInstallGradientProto(); } catch (_e) {}
    if (typeof CanvasGradient === 'function' && CanvasGradient.prototype) {
      reorder(CanvasGradient.prototype, ['addColorStop', 'constructor']);
    }
  }
  if (typeof TextMetrics === 'function' && TextMetrics.prototype) {
    reorder(TextMetrics.prototype, [
      'width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight',
      'fontBoundingBoxAscent', 'fontBoundingBoxDescent',
      'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
      'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline',
      'constructor',
    ]);
  }
  if (typeof ImageData === 'function' && ImageData.prototype) {
    reorder(ImageData.prototype,
      ['width', 'height', 'colorSpace', 'data', 'pixelFormat', 'constructor']);
  }
  // Path2D now carries the full eleven-member method set (the segment
  // recorder in sockets.js), so the census goes through the exact mode.
  if (typeof Path2D === 'function' && Path2D.prototype) {
    reorder(Path2D.prototype, [
      'addPath', 'roundRect', 'arc', 'arcTo', 'bezierCurveTo', 'closePath',
      'ellipse', 'lineTo', 'moveTo', 'quadraticCurveTo', 'rect', 'constructor',
    ]);
  }
  // DOMMatrix's rewrite installs in Chrome's order already; the permutation
  // check doubles as a drift alarm if a future edit breaks it.
  if (typeof DOMMatrix === 'function' && DOMMatrix.prototype) {
    reorder(DOMMatrix.prototype, [
      'a', 'b', 'c', 'd', 'e', 'f',
      'm11', 'm12', 'm13', 'm14', 'm21', 'm22', 'm23', 'm24',
      'm31', 'm32', 'm33', 'm34', 'm41', 'm42', 'm43', 'm44',
      'invertSelf', 'multiplySelf', 'preMultiplySelf', 'rotateAxisAngleSelf',
      'rotateFromVectorSelf', 'rotateSelf', 'scale3dSelf', 'scaleSelf',
      'skewXSelf', 'skewYSelf', 'translateSelf',
      'constructor', 'setMatrixValue',
    ]);
  }
  if (typeof MutationObserver === 'function' && MutationObserver.prototype) {
    reorder(MutationObserver.prototype,
      ['disconnect', 'observe', 'takeRecords', 'constructor']);
  }
  if (typeof Text === 'function' && Text.prototype) {
    reorder(Text.prototype,
      ['wholeText', 'assignedSlot', 'splitText', 'constructor']);
  }
  if (typeof HTMLCanvasElement === 'function' && HTMLCanvasElement.prototype) {
    reorder(HTMLCanvasElement.prototype, [
      'width', 'height', 'captureStream', 'getContext', 'toBlob', 'toDataURL',
      'transferControlToOffscreen', 'constructor',
    ]);
  }
  if (typeof Performance === 'function' && Performance.prototype) {
    reorder(Performance.prototype, [
      'timeOrigin', 'onresourcetimingbufferfull', 'clearMarks', 'clearMeasures',
      'clearResourceTimings', 'getEntries', 'getEntriesByName',
      'getEntriesByType', 'mark', 'measure', 'setResourceTimingBufferSize',
      'toJSON', 'now', 'constructor', 'timing', 'navigation', 'memory',
      'eventCounts', 'interactionCount',
    ]);
  }
})();
