// ServiceWorkerContainer shape and failure semantics.
//
// Obscura does not implement Service Workers (roadmap §3.2-#11 keeps them
// fail-closed). This probe pins down what a browser that *does* implement them
// exposes, so the stub can match every observable that does not require a real
// worker: the container's class identity, the descriptor location, the
// permanently-pending `ready` promise, and the rejection shape of registrations
// that the spec rejects regardless of Service Worker support.
globalThis.swFixturePromise = (async () => {
  const out = {};

  // Interface objects that ship alongside the container. Their absence is a
  // fingerprint difference even when no worker can ever be created.
  out.interfaceObjects = {};
  for (const name of [
    'ServiceWorkerContainer', 'ServiceWorker', 'ServiceWorkerRegistration',
    'Worklet', 'NavigationPreloadManager',
  ]) {
    const value = globalThis[name];
    out.interfaceObjects[name] = typeof value === 'undefined'
      ? 'undefined'
      : {
          type: typeof value,
          construct: (() => {
            try {
              new value();
              return 'constructed';
            } catch (error) {
              return `${error.name}: ${error.message}`;
            }
          })(),
        };
  }

  const sw = navigator.serviceWorker;

  out.containerExists = !!sw;
  if (!sw) {
    globalThis.swFixtureResult = out;
    return out;
  }

  // Class identity. A plain object literal fails every one of these.
  out.toStringTag = Object.prototype.toString.call(sw);
  out.constructorName = sw.constructor && sw.constructor.name;
  out.globalClassType = typeof globalThis.ServiceWorkerContainer;
  out.instanceOfContainer =
    typeof globalThis.ServiceWorkerContainer !== 'undefined' &&
    sw instanceof globalThis.ServiceWorkerContainer;
  out.isEventTarget = sw instanceof EventTarget;

  // Where the property lives: Chrome exposes an accessor on Navigator.prototype,
  // so the navigator instance has no own 'serviceWorker' property.
  out.ownPropertyOnNavigator =
    Object.prototype.hasOwnProperty.call(navigator, 'serviceWorker');
  const descriptor =
    Object.getOwnPropertyDescriptor(Navigator.prototype, 'serviceWorker');
  out.protoDescriptor = descriptor
    ? {
        kind: typeof descriptor.get === 'function' ? 'accessor' : 'data',
        setter: descriptor.set === undefined ? 'undefined' : typeof descriptor.set,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
      }
    : null;
  out.identityStable = navigator.serviceWorker === navigator.serviceWorker;

  // Members.
  out.memberTypes = {};
  for (const key of [
    'register', 'getRegistration', 'getRegistrations', 'startMessages',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
  ]) {
    out.memberTypes[key] = typeof sw[key];
  }
  out.registerIsNative = typeof sw.register === 'function' &&
    /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(sw.register));
  out.registerLength = typeof sw.register === 'function' ? sw.register.length : null;
  out.controller = sw.controller;
  out.eventHandlers = {};
  for (const key of ['oncontrollerchange', 'onmessage', 'onmessageerror']) {
    out.eventHandlers[key] = key in sw ? String(sw[key]) : 'missing';
  }

  // `ready` never settles until an active registration exists. A stub that
  // resolves it immediately is observably wrong: callers that gate on
  // `await navigator.serviceWorker.ready` proceed when a real browser blocks.
  out.readyIsPromise = sw.ready instanceof Promise;
  out.readyIdentityStable = sw.ready === sw.ready;
  out.readyStateAfter500ms = await Promise.race([
    sw.ready.then(() => 'resolved', () => 'rejected'),
    new Promise(resolve => setTimeout(() => resolve('pending'), 500)),
  ]);

  // Takes a thunk, not a promise: a missing member throws synchronously and
  // that is itself a finding worth recording rather than aborting the probe.
  const settle = thunk => {
    let promise;
    try {
      promise = thunk();
    } catch (error) {
      return {settled: 'threw-sync', name: error && error.name,
              message: String(error && error.message)};
    }
    if (!promise || typeof promise.then !== 'function') {
      return {settled: 'not-a-promise',
              valueTag: Object.prototype.toString.call(promise)};
    }
    return promise.then(
      value => ({
        settled: 'fulfilled',
        valueTag: Object.prototype.toString.call(value),
        isUndefined: value === undefined,
      }),
      error => ({
        settled: 'rejected',
        name: error && error.name,
        constructor: error && error.constructor && error.constructor.name,
        isDOMException: typeof DOMException !== 'undefined' &&
          error instanceof DOMException,
        isTypeError: error instanceof TypeError,
        // Ports vary per run; keep only the stable prefix.
        message: String(error && error.message).replace(
          /http:\/\/127\.0\.0\.1:\d+/g, '<origin>'),
      }),
    );
  };

  // Rejections the spec mandates regardless of Service Worker support.
  out.registerCrossOrigin = await settle(() => sw.register('https://example.com/sw.js'));
  out.registerDataUrl = await settle(() => sw.register('data:text/javascript,//'));
  out.registerBadScope = await settle(
    () => sw.register('/sw.js', {scope: 'https://example.com/'}));
  out.registerInvalidUrl = await settle(() => sw.register('http://['));
  // A same-origin script that does not exist: the network failure path.
  out.registerMissingScript = await settle(() => sw.register('/definitely-missing-sw.js'));
  out.registerNoArgs = await settle(() => sw.register());

  out.getRegistration = await settle(() => sw.getRegistration());
  out.getRegistrationCrossOrigin = await settle(
    () => sw.getRegistration('https://example.com/page'));
  out.startMessages = (() => {
    try {
      return {returned: String(sw.startMessages())};
    } catch (error) {
      return {threw: `${error.name}: ${error.message}`};
    }
  })();
  out.getRegistrations = await settle(() => sw.getRegistrations());
  if (out.getRegistrations.settled === 'fulfilled') {
    const value = await sw.getRegistrations().catch(() => null);
    out.getRegistrations.isArray = Array.isArray(value);
    out.getRegistrations.length = Array.isArray(value) ? value.length : null;
  }

  // The Chrome capture awaits the promise over CDP; the Obscura capture reads
  // the settled value with `--eval` after `--wait`.
  globalThis.swFixtureResult = out;
  return out;
})();
