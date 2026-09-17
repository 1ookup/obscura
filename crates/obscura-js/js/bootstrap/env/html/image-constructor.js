// The Image constructor creates a real detached HTMLImageElement, matching
// browser attribute reflection, style, and event behavior.
// Frame realms re-run bootstrap against a snapshot that already has Image.
// That factory closes over the snapshot document, so `new Image()` inside
// the widget would mint a parent-document <img> (or skip the frame HTMLImageElement
// src path). Reinstall so this realm's Image uses this realm's createElement.
globalThis.Image = function Image(width, height) {
  const image = document.createElement('img');
  if (width !== undefined) image.width = width >>> 0;
  if (height !== undefined) image.height = height >>> 0;
  return image;
};
globalThis.Image.prototype = globalThis.HTMLImageElement.prototype;
