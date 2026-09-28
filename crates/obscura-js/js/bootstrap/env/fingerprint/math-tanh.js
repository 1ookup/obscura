// Math.tanh answers the platform libm, not this V8's fdlibm port.
//
// The reference Chrome's Math.tanh resolves to exactly the platform libm's
// values -- checked value for value against that build over a sweep of inputs
// -- while the fdlibm port bundled with this V8 drifts by one ulp on some of
// them. The challenge fingerprints the engine with a battery of Math results,
// and a one-ulp drift in a transcendental is the difference between "the
// browser that passes" and "some other engine", so route tanh through the op
// that calls the platform function.
//
// This runs while the snapshot is being built, where the op table is not bound
// yet, so the op is resolved on each call and the original builtin stays the
// fallback. The finalize pass marks the wrapper native, and the descriptor
// shape matches the builtin it replaces.
(function () {
  var own = Object.getOwnPropertyDescriptor(Math, 'tanh');
  if (!own || typeof own.value !== 'function') return;
  var original = own.value;
  var calls = 0;
  try {
    var tanh = function tanh(x) {
      x = Number(x);
      var op = Deno.core.ops.op_math_tanh;
      calls++;
      return typeof op === 'function' ? op(x) : original(x);
    };
    Object.defineProperty(Math, 'tanh', {
      value: tanh, writable: true, enumerable: false, configurable: true,
    });
    // Math is not a constructor, so the builtins walk in the finalize pass
    // never reaches it; mark the wrapper here or toString exposes the source.
    if (typeof _markNativeAs === 'function') {
      _markNativeAs(tanh, 'function tanh() { [native code] }');
    }
    globalThis.__obscura_math_tanh = {
      patched: Math.tanh === tanh,
      calls: function () { return calls; },
    };
  } catch (_e) {}
})();
