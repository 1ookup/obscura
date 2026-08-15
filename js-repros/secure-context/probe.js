// What a page can see about its own secure-context status, and which APIs the
// answer gates. Chrome exposes none of the powerful ones on an insecure
// origin -- and `isSecureContext` itself must exist on both.
globalThis.secureContextFixturePromise = (async () => {
  const out = {};
  out.isSecureContext = globalThis.isSecureContext;
  out.typeofIsSecureContext = typeof globalThis.isSecureContext;
  out.hasOwn = Object.prototype.hasOwnProperty.call(globalThis, 'isSecureContext');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  out.descriptor = descriptor ? {
    isAccessor: typeof descriptor.get === 'function',
    hasSetter: descriptor.set !== undefined,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
    writable: descriptor.writable,
  } : null;
  out.origin = globalThis.origin;
  out.locationProtocol = location.protocol;

  // Every API Chrome gates on a secure context that this engine also has.
  const gated = {};
  gated['crypto.subtle'] = typeof crypto?.subtle;
  gated['navigator.serviceWorker'] = typeof navigator.serviceWorker;
  gated['navigator.mediaDevices'] = typeof navigator.mediaDevices;
  gated['navigator.geolocation'] = typeof navigator.geolocation;
  gated['navigator.storage'] = typeof navigator.storage;
  gated['navigator.clipboard'] = typeof navigator.clipboard;
  gated['navigator.wakeLock'] = typeof navigator.wakeLock;
  gated['Notification'] = typeof globalThis.Notification;
  gated['caches'] = typeof globalThis.caches;
  gated['navigator.credentials'] = typeof navigator.credentials;
  gated['navigator.locks'] = typeof navigator.locks;
  gated['SharedArrayBuffer'] = typeof globalThis.SharedArrayBuffer;
  out.gated = gated;

  // SharedArrayBuffer sits on a different axis: Chrome withholds it without
  // *cross-origin isolation* (COOP+COEP), which is stricter than a secure
  // context, so it is absent on loopback too. Withholding the global binding
  // is not enough on its own -- these are the ways a page can reach the same
  // constructor, or detect that only the binding was hidden.
  const isolation = {};
  isolation.crossOriginIsolated = globalThis.crossOriginIsolated;
  isolation.typeofCrossOriginIsolated = typeof globalThis.crossOriginIsolated;
  isolation.hasOwnSAB =
    Object.prototype.hasOwnProperty.call(globalThis, 'SharedArrayBuffer');
  isolation.sabInDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer') !== undefined;
  isolation.sabInGlobalNames =
    Object.getOwnPropertyNames(globalThis).includes('SharedArrayBuffer');
  // Atomics stays: it works on ordinary ArrayBuffers too.
  isolation.typeofAtomics = typeof globalThis.Atomics;
  isolation.typeofAtomicsWait = typeof globalThis.Atomics?.wait;
  // The back door. A shared WebAssembly.Memory's buffer *is* a
  // SharedArrayBuffer, so if this succeeds the constructor is reachable
  // regardless of what the global binding says.
  try {
    const memory = new WebAssembly.Memory({initial: 1, maximum: 1, shared: true});
    isolation.wasmSharedMemory = {
      threw: false,
      bufferCtorName: memory.buffer?.constructor?.name ?? null,
      bufferTag: Object.prototype.toString.call(memory.buffer),
      ctorIsGlobalSAB: memory.buffer?.constructor === globalThis.SharedArrayBuffer,
    };
  } catch (error) {
    isolation.wasmSharedMemory = {threw: true, name: error?.name || null};
  }
  out.crossOriginIsolation = isolation;

  // A worker inherits the creator's secure-context status; a mismatch between
  // the two is an engine-internal contradiction visible to any script.
  out.worker = await new Promise(resolve => {
    try {
      const source = 'self.postMessage({isSecureContext: self.isSecureContext,' +
        ' typeofValue: typeof self.isSecureContext,' +
        ' subtle: typeof (self.crypto && self.crypto.subtle),' +
        ' caches: typeof self.caches});';
      const worker = new Worker(URL.createObjectURL(
        new Blob([source], {type: 'text/javascript'})));
      const timer = setTimeout(() => resolve({timedOut: true}), 3000);
      worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      worker.onerror = error => { clearTimeout(timer); resolve({error: String(error.message || error)}); };
    } catch (error) { resolve({threw: String(error && error.message)}); }
  });

  globalThis.secureContextFixtureResult = out;
  return out;
})();
