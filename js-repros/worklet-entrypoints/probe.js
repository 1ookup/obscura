// Worklet entry points. Obscura exposes the `Worklet` interface object but no
// worklet anywhere hangs off it -- no `CSS.paintWorklet`, no `audioWorklet` on
// an AudioContext. Chrome exposes both, and both are cheap feature-detection
// targets. No worklet module can actually run here, so the question this pins
// down is what the entry points look like and how `addModule` must fail.
globalThis.workletFixturePromise = (async () => {
  const out = {};

  const settle = async thunk => {
    try {
      const value = await thunk();
      return {settled: 'fulfilled', isUndefined: value === undefined};
    } catch (error) {
      return {
        settled: 'rejected',
        name: error && error.name,
        isDOMException: typeof DOMException !== 'undefined' && error instanceof DOMException,
        isTypeError: error instanceof TypeError,
        message: String(error && error.message).replace(/https?:\/\/[^\s')]+/g, '<url>'),
      };
    }
  };

  const describeWorklet = worklet => ({
    type: typeof worklet,
    tag: Object.prototype.toString.call(worklet),
    ctor: worklet && worklet.constructor && worklet.constructor.name,
    instanceOfWorklet: typeof globalThis.Worklet === 'function' && worklet instanceof Worklet,
    addModuleType: worklet && typeof worklet.addModule,
    addModuleLength: worklet && typeof worklet.addModule === 'function'
      ? worklet.addModule.length : null,
  });

  out.workletInterface = typeof globalThis.Worklet;
  out.cssExists = typeof globalThis.CSS;
  out.paintWorkletPresent = !!(globalThis.CSS && globalThis.CSS.paintWorklet);
  if (globalThis.CSS && globalThis.CSS.paintWorklet) {
    const paint = globalThis.CSS.paintWorklet;
    out.paintWorklet = describeWorklet(paint);
    out.paintWorkletStable = globalThis.CSS.paintWorklet === globalThis.CSS.paintWorklet;
    out.paintAddModuleMissingArg = await settle(() => paint.addModule());
    // A module URL that cannot be fetched: the failure path every caller sees.
    out.paintAddModule404 = await settle(
      () => paint.addModule('/definitely-missing-worklet.js'));
    out.paintAddModuleCrossOrigin = await settle(
      () => paint.addModule('https://example.com/worklet.js'));
  }

  out.audioContextType = typeof globalThis.AudioContext;
  if (typeof globalThis.AudioContext === 'function') {
    let context = null;
    try { context = new AudioContext(); }
    catch (error) { out.audioContextConstruct = `${error.name}: ${error.message}`; }
    if (context) {
      out.audioWorkletPresent = !!context.audioWorklet;
      if (context.audioWorklet) {
        out.audioWorklet = describeWorklet(context.audioWorklet);
        out.audioWorkletStable = context.audioWorklet === context.audioWorklet;
        out.audioAddModule404 = await settle(
          () => context.audioWorklet.addModule('/definitely-missing-worklet.js'));
      }
      try { context.close(); } catch (error) {}
    }
  }

  globalThis.workletFixtureResult = out;
  return out;
})();
