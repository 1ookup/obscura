// queryLocalFonts: the reference profile has Local Font Access allowed, so
// the full system enumeration resolves (631 FontData measured 149). This
// engine used to answer a bare NotAllowedError rejection, which broke the
// challenge's font probe at its first step -- the tUxL6/OyfhW8 rows fell
// back to their symbol names. Method shorthand (no .prototype), own
// length/name, per the reference's function shape.
(function _installQueryLocalFonts() {
  // Worker realms have no Local Font Access and no `window` binding; the
  // query is a document-surface API. Guard on `window` so the worker
  // bootstrap doesn't throw a ReferenceError.
  if (typeof window === 'undefined' || typeof _localFontData !== 'function') return;
  const queryLocalFonts = () => Promise.resolve(_localFontData());
  Object.defineProperty(window, 'queryLocalFonts', {
    value: queryLocalFonts,
    writable: true, enumerable: true, configurable: true,
  });
})();
