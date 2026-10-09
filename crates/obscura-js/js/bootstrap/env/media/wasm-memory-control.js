// WebAssembly memory-control surface (toFixedLengthBuffer /
// toResizableBuffer on Memory.prototype, stack on Exception.prototype),
// measured on the live Chromium 149 (2026-10-09, reference capture):
//
// Both Memory methods are ordinary own methods (length 0, writable/
// enumerable/configurable). A memory's initial buffer is always fixed, even
// when a maximum was declared. toFixedLengthBuffer is idempotent on an
// already-fixed memory (same object back); converting from resizable builds
// a new fixed ArrayBuffer at the current byte length, replaces
// memory.buffer, and detaches the old object. toResizableBuffer throws
// TypeError when the memory has no maximum, is idempotent on an
// already-resizable memory, and otherwise builds a resizable ArrayBuffer
// (maxByteLength = maximum * 65536), replaces memory.buffer, and detaches
// the old fixed object; a maximum equal to the initial size still converts
// (a resizable buffer with no headroom). Bad receivers throw
// 'Receiver is not a WebAssembly.Memory'; extra arguments are ignored.
//
// Exception.prototype.stack is an enumerable configurable getter: undefined
// for JS-constructed exceptions and for wasm-thrown ones; the
// {traceStack:true} construction is the only string case, and the engine
// never constructs one.
//
// The engine's native backing buffers are always fixed, so the initial
// state answers the fixed branch of every rule. The maximum a construction
// declared is only observable through these methods, so a construction
// shadow records it; the native constructor, prototype and instanceof are
// untouched.

// Per-context: V8 mints WebAssembly fresh for every new context (it is not
// part of the snapshot), so page-init re-invokes this installer when it
// meets the minted intrinsic. Idempotent.
globalThis.__obscura_install_wasm_surface = _installWasmMemoryControl;
function _installWasmMemoryControl() {
  const WA = globalThis.WebAssembly;
  if (!WA || !WA.Memory || !WA.Memory.prototype) return;
  const proto = WA.Memory.prototype;
  if (typeof proto.toFixedLengthBuffer === 'function') return;

  const state = new WeakMap(); // Memory -> {maximum, resizable}

  const detach = function (buffer) {
    // A page can no longer read anything through a detached buffer. V8's
    // zero-length transfer produces exactly that state; when it is not
    // available, the stale reference a probe would keep is the only
    // remaining difference.
    if (buffer && typeof buffer.transfer === 'function') {
      try { buffer.transfer(); } catch (_error) {}
    }
  };

  const replaceBuffer = function (memory, replacement) {
    const old = memory.buffer;
    Object.defineProperty(memory, 'buffer', {
      value: replacement, configurable: true, enumerable: true,
    });
    detach(old);
  };

  proto.toFixedLengthBuffer = function toFixedLengthBuffer() {
    const info = state.get(this);
    if (info === undefined && !(this instanceof WA.Memory)) {
      throw new TypeError(
        'WebAssembly.Memory.toFixedLengthBuffer(): '
        + 'Receiver is not a WebAssembly.Memory');
    }
    if (!info || !info.resizable) return this.buffer;
    const fixed = new ArrayBuffer(this.buffer.byteLength);
    info.resizable = false;
    replaceBuffer(this, fixed);
    return fixed;
  };

  proto.toResizableBuffer = function toResizableBuffer() {
    const info = state.get(this);
    if (info === undefined && !(this instanceof WA.Memory)) {
      throw new TypeError(
        'WebAssembly.Memory.toResizableBuffer(): '
        + 'Receiver is not a WebAssembly.Memory');
    }
    if (!info || !info.resizable) {
      if (!info || info.maximum === undefined) {
        throw new TypeError(
          'WebAssembly.Memory.toResizableBuffer(): '
          + 'Memory must have a maximum');
      }
      const size = this.buffer.byteLength;
      const max = info.maximum * 65536;
      let resizable;
      try {
        resizable = new ArrayBuffer(size, { maxByteLength: max });
      } catch (_error) {
        resizable = new ArrayBuffer(size);
      }
      info.resizable = true;
      replaceBuffer(this, resizable);
      return resizable;
    }
    return this.buffer;
  };

  // Record each construction's declared maximum so toResizableBuffer can
  // answer the TypeError a memory without one owes. The native constructor
  // keeps its own state; this shadow only carries what the two methods
  // read, and memories the engine builds internally (an instantiate import)
  // simply answer the no-maximum branch.
  const nativeMemory = WA.Memory;
  const shadowMemory = new Proxy(nativeMemory, {
    construct(target, args, newTarget) {
      const memory = Reflect.construct(target, args, newTarget);
      const descriptor = args[0] && typeof args[0] === 'object' ? args[0] : {};
      const maximum = typeof descriptor.maximum === 'number'
        ? descriptor.maximum : undefined;
      state.set(memory, { maximum, resizable: false });
      return memory;
    },
  });
  try {
    Object.defineProperty(WA, 'Memory', {
      value: shadowMemory,
      writable: true, configurable: true,
    });
  } catch (_error) {}

  if (WA.Exception && WA.Exception.prototype
      && !('stack' in WA.Exception.prototype)) {
    Object.defineProperty(WA.Exception.prototype, 'stack', {
      get() {
        if (!(this instanceof WA.Exception)) {
          throw new TypeError(
            'WebAssembly.Exception.stack(): '
            + 'Receiver is not a WebAssembly.Exception');
        }
        // The wasm-thrown exceptions the engine produces answer undefined;
        // {traceStack:true} is the only string case and the engine never
        // constructs one, so the getter stays a constant read.
        return undefined;
      },
      enumerable: true, configurable: true,
    });
  }
}
_installWasmMemoryControl();
