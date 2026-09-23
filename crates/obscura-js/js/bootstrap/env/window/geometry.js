// Canonical Window geometry surface. Keep definitions in Chrome's stable
// insertion order so every realm and WindowProxy observes the same sequence.
globalThis.screen = new Screen(1920, 1080);
globalThis.screenX = 0;
globalThis.screenY = 0;
globalThis.screenLeft = 0;
globalThis.screenTop = 0;
// A real VisualViewport instance (env/dom/geometry-objects.js owns the
// interface), not the plain object the boot surface used to publish: the
// fields are prototype accessors and the value's own keys are empty.
globalThis.visualViewport = OBSCURA_VISUAL_VIEWPORT_NEW();
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1000;
globalThis.outerWidth = 1920;
globalThis.outerHeight = 1080;
globalThis.scrollX = 0;
globalThis.pageXOffset = 0;
globalThis.scrollY = 0;
globalThis.pageYOffset = 0;

// Keep the JavaScript capability surface aligned with the declarations the
// renderer actually implements. Reporting an unknown declaration as supported
// is not harmless: Tailwind and other framework sheets use negative probes to
// select legacy-browser fallbacks, which can replace their modern cascade.
