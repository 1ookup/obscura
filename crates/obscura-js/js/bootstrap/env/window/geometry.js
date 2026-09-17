// Canonical Window geometry surface. Keep definitions in Chrome's stable
// insertion order so every realm and WindowProxy observes the same sequence.
globalThis.screen = new Screen(1920, 1080);
globalThis.screenX = 0;
globalThis.screenY = 0;
globalThis.screenLeft = 0;
globalThis.screenTop = 0;
globalThis.visualViewport = _bootstrapObject('visualViewport', () => ({ width:1920, height:1000, offsetLeft:0, offsetTop:0, scale:1, [Symbol.toStringTag]: 'VisualViewport', addEventListener(){}, removeEventListener(){} }));
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
