// Execution-source attribution for the trace streams: the `from` label that
// says which code unit produced a traced record. The taxonomy mirrors the
// HaHaVM dispatch trace (window / iframe(N) / worker(M)[creator] /
// script@<url> / function@<source> / eval@<source> / host) so traces from the
// two engines can be diffed unit by unit.
//
// The authoritative stack lives in Rust (thread-local, read by the host-op
// trace writer); this module mirrors it for the snapshots JS needs (a timer
// registered by script A must restore A's label when it fires, not inherit
// whoever ran last) and keeps the two in lockstep through
// op_trace_push_source / op_trace_pop_source. Rust funnels set the ambient
// label per context; the host sets `__obscura_trace_default_from` before this
// realm's bootstrap runs.
//
// Production runs (no trace env var) keep every wrapper off: the flag global
// is never set, enter/leave are no-ops, `Function` and `Promise.prototype.then`
// stay native, and on* handlers stay plain data properties. The only residual
// cost is two global function calls around each Rust-executed script.
(function _installTraceSource() {
  const G = globalThis;
  const enabled = () => G.__obscura_trace_from_enabled === true;

  // JS-side mirror of the Rust label stack. `current === null` means "ambient"
  // (window / iframe(N) / worker(M)[...] per realm).
  let stack = [];
  let current = null;

  function defaultFrom() {
    const d = G.__obscura_trace_default_from;
    return typeof d === 'string' && d ? d : 'window';
  }
  function syncRust(label) {
    try {
      Deno.core.ops.op_trace_push_source(label);
    } catch (e) { /* tracing stays best-effort */ }
  }
  function desyncRust() {
    try {
      Deno.core.ops.op_trace_pop_source();
    } catch (e) { /* tracing stays best-effort */ }
  }
  // A hidden own data string the V8 JSONL writer can read without calling
  // back into JS. Updating it here keeps the IC path off the JS stack.
  function publishFrom() {
    if (!enabled()) return;
    const label = current || defaultFrom();
    try {
      Object.defineProperty(G, '__obscura_trace_from', {
        value: label, writable: true, enumerable: false, configurable: true,
      });
    } catch (e) {
      try { G.__obscura_trace_from = label; } catch (e2) {}
    }
  }

  G.__obscuraTraceCurrent = function () {
    return current || defaultFrom();
  };
  // Rust-driven script brackets (page.rs) enter/leave around each classic
  // script; JS-driven ones (dynamic insertion, string timers) call the same
  // pair from __runClassicScript.
  G.__obscuraTraceEnter = function (label) {
    if (!enabled()) return;
    stack.push(current);
    current = String(label);
    syncRust(current);
    publishFrom();
  };
  G.__obscuraTraceLeave = function () {
    if (!enabled()) return;
    current = stack.length ? stack.pop() : null;
    desyncRust();
    publishFrom();
  };

  // Snapshot-at-registration / restore-at-invocation for async continuations.
  // Returns the function untouched unless tracing is on.
  G.__obscuraTraceBind = function (fn) {
    if (!enabled() || typeof fn !== 'function') return fn;
    const label = current || defaultFrom();
    return function (...args) {
      const previous = current;
      const depth = stack.length;
      current = label;
      syncRust(label);
      publishFrom();
      try {
        return fn.apply(this, args);
      } finally {
        // Force-unwind anything the callback leaked (a script terminated
        // mid-run by the watchdog leaves its entry behind).
        stack.length = depth;
        current = previous;
        desyncRust();
        publishFrom();
      }
    };
  };
  // Invoke one callback under a snapshot label (listener entries, on*
  // handlers). A null label means "no snapshot; run under the ambient turn".
  G.__obscuraTraceCallWith = function (label, fn, thisArg, args) {
    if (label === null || label === undefined || !enabled()) {
      return fn.apply(thisArg, args);
    }
    const previous = current;
    const depth = stack.length;
    current = String(label);
    syncRust(current);
    publishFrom();
    try {
      return fn.apply(thisArg, args);
    } finally {
      stack.length = depth;
      current = previous;
      desyncRust();
      publishFrom();
    }
  };

  // on* property-handler slots. Chrome exposes every event-handler IDL
  // attribute as a prototype (or Window own) accessor pair, so assignment
  // never creates an own property on the instance and `delete el.onclick`
  // is a no-op. That is the production shape here too; under trace the
  // setter additionally snapshots the assigning code's label, so a handler
  // is attributed to the code that assigned it rather than to whichever
  // turn dispatched the event.
  const handlerSlots = new WeakMap();
  function handlerSlot(target) {
    let slot = handlerSlots.get(target);
    if (!slot) {
      slot = new Map();
      handlerSlots.set(target, slot);
    }
    return slot;
  }
  G.__obscuraTraceDefineHandler = function (target, name, enumerable) {
    // The descriptor is installed on a prototype (or on Window itself).
    // Storage keys on `this`: Chrome keeps one handler value per instance,
    // and using `target` here would make every Element share one onclick.
    Object.defineProperty(target, name, {
      get() {
        const entry = handlerSlots.get(this)?.get(name);
        return entry ? entry.value : null;
      },
      set(value) {
        handlerSlot(this).set(name, {
          value: (typeof value === 'function' || (value && typeof value === 'object'))
            ? value : null,
          from: enabled() ? (current || defaultFrom()) : null,
        });
      },
      enumerable: !!enumerable,
      configurable: true,
    });
    return true;
  };
  // Record a snapshot from an existing setter (Image own accessors, the
  // Worker prototype handlers): the value itself stays where that setter
  // already put it.
  G.__obscuraTraceRecordHandler = function (target, name) {
    if (!enabled()) return;
    handlerSlot(target).set(name, { value: null, from: current || defaultFrom() });
  };
  G.__obscuraTraceHandlerFrom = function (target, name) {
    if (!enabled()) return null;
    const entry = handlerSlots.get(target)?.get(name);
    return entry ? entry.from : null;
  };

  // `new Function` products run as one labeled unit (function@<creation
  // source>). A Proxy over the original constructor keeps instanceof,
  // .prototype and Reflect.construct semantics intact; the only observable
  // difference under trace is Function.prototype.toString on a wrapped
  // product, which reads as [native code] -- the same surface the HaHaVM
  // reference build accepts.
  G.__obscuraTraceRawFunction = Function;
  if (enabled()) {
    const OriginalFunction = Function;
    const wrapProduct = (product) => {
      if (typeof product !== 'function') return product;
      const label = 'function@' + (current || defaultFrom());
      return new Proxy(product, {
        apply(target, thisArg, args) {
          return G.__obscuraTraceCallWith(label, target, thisArg, args);
        },
        construct(target, args) {
          return G.__obscuraTraceCallWith(label, () => Reflect.construct(target, args));
        },
      });
    };
    G.Function = new Proxy(OriginalFunction, {
      apply(target, _thisArg, args) {
        return wrapProduct(Reflect.apply(target, undefined, args));
      },
      construct(target, args) {
        return wrapProduct(Reflect.construct(target, args));
      },
    });
    // Keep the constructor identity Chrome guarantees: in a real browser
    // `f.constructor === Function` and `Function.prototype.constructor ===
    // Function` are the same object as the global. The proxy replaced the
    // global binding, so point the prototype's constructor at it too.
    try {
      Object.defineProperty(OriginalFunction.prototype, 'constructor', {
        value: G.Function,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) { /* identity fix is best-effort */ }
  }

  // Promise continuations carry the .then call site's label. await is a
  // boundary on both engines (V8 resolves it through an internal intrinsic,
  // not the then property), so async/await resumptions stay attributed to the
  // ambient turn.
  if (enabled()) {
    const originalThen = Promise.prototype.then;
    if (typeof originalThen === 'function') {
      const wrappedThen = function then(onFulfilled, onRejected) {
        return originalThen.call(
          this,
          G.__obscuraTraceBind(onFulfilled),
          G.__obscuraTraceBind(onRejected),
        );
      };
      try {
        Object.defineProperty(wrappedThen, 'length', {
          value: 2, writable: false, enumerable: false, configurable: true,
        });
        Object.defineProperty(wrappedThen, 'name', {
          value: 'then', writable: false, enumerable: false, configurable: true,
        });
      } catch (e) { /* descriptor best-effort */ }
      _markNative(wrappedThen);
      Promise.prototype.then = wrappedThen;
    }
  }

  publishFrom();
})();
