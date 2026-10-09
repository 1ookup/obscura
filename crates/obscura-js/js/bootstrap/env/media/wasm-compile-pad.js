// Parity-experiment pad for WebAssembly compile/instantiate in worker
// realms (env-gated, default off; unset stays byte-identical).
//
// The engine's native wasm compilation answers in a fraction of the time
// the reference browser's pipeline needs, so a worker program that times
// instantiate with performance.now() records deltas several times shorter
// than the reference distribution (measured medians 0.90ms vs 4.95ms).
// OBSCURA_WASM_COMPILE_PAD_MS (+ _JITTER_MS of uniform span) charges each
// worker-realm compile a calibrated slice, which inflates both the per-
// round entry and the total it belongs to, so the uUBIv6 = sum(ftEz2) +
// overhead identity the server can cross-check keeps holding.
//
// The wrapper resolves per context alongside the intrinsic (WebAssembly is
// not in the snapshot; wasm-memory-control.js installs from the same hook).

globalThis.__obscura_install_wasm_compile_pad = function() {
  const WA = globalThis.WebAssembly;
  if (!WA || WA.__obscura_compile_pad_installed) return;
  const baseMs = Deno.core.ops.op_wasm_compile_pad();
  const jitterMs = Deno.core.ops.op_wasm_compile_pad_jitter();
  if (baseMs <= 0 && jitterMs <= 0) return;
  WA.__obscura_compile_pad_installed = true;

  const isWorkerRealm = function() {
    return typeof WorkerGlobalScope === 'function'
      && globalThis instanceof WorkerGlobalScope;
  };

  const delay = function() {
    const ms = baseMs + (jitterMs > 0 ? Math.random() * jitterMs : 0);
    if (ms <= 0) return;
    const target = Date.now() + ms;
    while (Date.now() < target) { /* spin: sub-5ms pad, no timer queue */ }
  };

  const wrap = function(original) {
    if (typeof original !== 'function') return original;
    const wrapped = function() {
      if (isWorkerRealm()) delay();
      return original.apply(this, arguments);
    };
    try {
      Object.defineProperty(wrapped, 'name', {
        value: original.name, configurable: true,
      });
      Object.defineProperty(wrapped, 'length', {
        value: original.length, configurable: true,
      });
    } catch (_error) {}
    return wrapped;
  };

  for (const name of ['compile', 'instantiate',
                      'compileStreaming', 'instantiateStreaming']) {
    try {
      Object.defineProperty(WA, name, {
        value: wrap(WA[name]),
        writable: true, configurable: true,
      });
    } catch (_error) {}
  }
};
