// The Image constructor creates a real detached HTMLImageElement, matching
// browser attribute reflection, style, and event behavior.
if (typeof Image === 'undefined') {
  globalThis.Image = function Image(width, height) {
    const image = document.createElement('img');
    if (width !== undefined) image.width = width >>> 0;
    if (height !== undefined) image.height = height >>> 0;
    return image;
  };
  globalThis.Image.prototype = globalThis.HTMLImageElement.prototype;
}
