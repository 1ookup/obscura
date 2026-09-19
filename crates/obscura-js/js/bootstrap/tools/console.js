// The console surface: one full-fidelity, op-routed console in every realm.
//
// Placement is load-bearing: this module must stay in the bootstrap CORE half,
// above the @obscura-deferred-surface marker (Step 312), so a frame realm
// created with __obscura_frame_defers_surface installs it during the core boot
// and never depends on hydration for console.* to exist or to reach
// op_console_msg. It used to live inside tools/dom-query.js, an incidental
// home that one rename away from falling below the marker; it now has its own
// module so the invariant has a name. Chrome's console is native-complete in
// every realm at all times, and the challenge's sandbox probe logs through it
// before touching any other surface, so the method set, the native-marked
// toString, the undefined return values, and the op routing are all part of
// the observable contract here. The sentinel table also reads the
// count/countReset side effect ("<label>: <n>" rows, Chrome's per-realm
// label map) and the self-titled bare-call rows (trace/clear/group family),
// so those shapes are contract too (profile Step 320).
//
// Message serialization mirrors what a CDP console consumer sees from Chrome,
// because the ops.tsv console rows are the diagnostic channel the Cloudflare
// probe analysis diffs against Chrome captures (profile Steps 313-316):
// RegExp arguments render as their source (`/.*.*=.*/`), node wrappers render
// as Chrome's node description (an element's local name, `#document`), and
// every other object keeps the Object.prototype.toString brand. None of these
// paths walk an argument: author-defined getters stay uninvoked.
const _consoleFn = (level, args) => {
  try { Deno.core.ops.op_console_msg(level, args.map(a => {
    if (a === null) return "null";
    if (a === undefined) return "undefined";
    // `instanceof` misses an Error that came from another realm -- a frame
    // realm or the challenge's own vm -- and those then fell through to the
    // `[object Object]` branch below, which is a brand test the comment there
    // already relies on. The internal Error slot is what
    // Object.prototype.toString reports, and a plain object can only imitate
    // it by setting Symbol.toStringTag, which the devtools probe this guards
    // against does not do (it would have tripped the same check).
    if (a instanceof Error || Object.prototype.toString.call(a) === '[object Error]') {
      const _pst = Error.prepareStackTrace;
      if (_pst !== undefined) Error.prepareStackTrace = undefined;
      const _s = a.stack || a.message || String(a);
      if (_pst !== undefined) Error.prepareStackTrace = _pst;
      return _s;
    }
    if (typeof a === "object") {
      // Chrome formats a RegExp as its source, not the brand.
      if (Object.prototype.toString.call(a) === '[object RegExp]') {
        try { return RegExp.prototype.toString.call(a); } catch (_e) {}
      }
      // Chrome's node description is the local name ("a") for an element and
      // "#document" for a document. Both reads hit engine-owned accessors;
      // no author getter on the argument is consulted. The numeric nid is the
      // same wrapper discriminator the engine uses elsewhere.
      try {
        if (typeof a[_nidSym] === 'number') {
          if (a.nodeType === 9) return "#document";
          const name = a.localName;
          if (typeof name === 'string' && name) return name;
        }
      } catch (_e) {}
      // Do not walk the object. Chrome keeps a reference and formats lazily
      // when devtools is closed, so author-defined getters are never invoked
      // by a bare console.log -- and that asymmetry is exactly what
      // devtools-detection code tests for. Cloudflare's challenge runs it on
      // every log line as
      //   console.log("%c%d", "font-size:0;color:transparent", probeObject)
      // where `probeObject` carries accessors that record being read.
      // JSON.stringify walks every enumerable property and calls toJSON, so
      // it answered "devtools is open" unconditionally; reading `.message` to
      // salvage `{}` did the same for one more property.
      // Object.prototype.toString only consults Symbol.toStringTag, which the
      // detection above does not use, and matches how Chrome labels a value
      // it has not expanded.
      return Object.prototype.toString.call(a);
    }
    return String(a);
  }).join(" ")); } catch {}
};

const _consoleMethodNames = [
  'debug', 'error', 'info', 'log', 'warn', 'dir', 'dirxml', 'table', 'trace',
  'group', 'groupCollapsed', 'groupEnd', 'clear', 'count', 'countReset',
  'assert', 'profile', 'profileEnd', 'time', 'timeLog', 'timeEnd',
  'timeStamp', 'context', 'createTask',
];
function _makeConsoleMethod(name, length, implementation) {
  const method = function() { return implementation.apply(this, arguments); };
  Object.defineProperty(method, 'name', { value: name, configurable: true });
  Object.defineProperty(method, 'length', { value: length, configurable: true });
  _markNativeAs(method, `function ${name}() { [native code] }`);
  return method;
}
// Chrome keeps one label -> n map per realm for count/countReset (and one
// for the time family), and this module is evaluated once per realm boot,
// so a module closure is the realm's map. The challenge's console-method
// sentinel table runs count/countReset and reads the "<label>: <n>" side
// effect (profile Step 320); missing output is a legitimate fail signal.
const _consoleCounts = new Map();
const _consoleTimes = new Map();
// count/countReset/time/timeLog/timeEnd take (label = "default"); an
// explicit undefined is the default label too, and anything else is
// stringified (console.count({}) prints "[object Object]: 1"). A Symbol
// label cannot be stringified: Chrome silently drops the call.
const _consoleLabel = (args) => {
  try {
    return args.length === 0 || args[0] === undefined
      ? 'default' : String(args[0]);
  } catch (_e) { return undefined; }
};
// Milliseconds with Chrome's fractional shape ("t: 0.005859375 ms"). The
// op is the same monotonic clock performance.now() is built on; wrapped in
// try so a console call can never break the op-routed console contract.
const _consoleMs = () => {
  try { return Deno.core.ops.op_monotonic_ms(); } catch (_e) { return 0; }
};
function _consoleOutput(name, args) {
  if (name === 'assert') {
    if (!args[0]) {
      // Chrome titles a message-less assert with the method name and does
      // not prepend "Assertion failed:" to a message it carries.
      if (args.length > 1) _consoleFn('error', Array.from(args).slice(1));
      else _consoleFn('error', ['console.assert']);
    }
    return;
  }
  if (name === 'count') {
    const label = _consoleLabel(args);
    if (label === undefined) return;
    const n = (_consoleCounts.get(label) || 0) + 1;
    _consoleCounts.set(label, n);
    return _consoleFn('log', [`${label}: ${n}`]);
  }
  if (name === 'countReset') {
    const label = _consoleLabel(args);
    if (label === undefined) return;
    if (_consoleCounts.has(label)) {
      _consoleCounts.set(label, 0);
      return;
    }
    return _consoleFn('warn', [`Count for '${label}' does not exist`]);
  }
  if (name === 'time') {
    const label = _consoleLabel(args);
    if (label !== undefined) _consoleTimes.set(label, _consoleMs());
    return;
  }
  if (name === 'timeLog' || name === 'timeEnd') {
    const label = _consoleLabel(args);
    if (label === undefined) return;
    const start = _consoleTimes.get(label);
    if (start === undefined) {
      return _consoleFn('warn', [`Timer '${label}' does not exist`]);
    }
    if (name === 'timeEnd') _consoleTimes.delete(label);
    return _consoleFn('log', [`${label}: ${_consoleMs() - start} ms`]);
  }
  // Blink gives a bare call a default title only on the self-titled methods
  // (trace/clear/group/groupEnd) and drops every other zero-arg call
  // entirely -- no consoleAPICalled row reaches CDP, so an empty row where
  // Chrome emits none is a visible ops-diff row.
  if (name === 'groupEnd') return _consoleFn('log', ['console.groupEnd']);
  if (name === 'clear') return _consoleFn('log', ['console.clear']);
  if (name === 'trace' || name === 'group' || name === 'groupCollapsed') {
    if (args.length === 0) return _consoleFn('log', [`console.${name}`]);
    return _consoleFn('log', Array.from(args));
  }
  if (args.length === 0) return;
  if (name === 'error' || name === 'warn') return _consoleFn(name, Array.from(args));
  if (name === 'debug' || name === 'info' || name === 'log'
      || name === 'dir' || name === 'dirxml' || name === 'table') {
    return _consoleFn('log', Array.from(args));
  }
}
function _newConsoleContext() {
  const context = {};
  const names = [
    'dir', 'dirXml', 'table', 'groupEnd', 'clear', 'count', 'countReset',
    'profile', 'profileEnd', 'debug', 'error', 'info', 'log', 'warn', 'trace',
    'group', 'groupCollapsed', 'assert', 'time', 'timeLog', 'timeEnd', 'timeStamp',
  ];
  for (const name of names) {
    Object.defineProperty(context, name, {
      value: _makeConsoleMethod(name, 1, function() {
        return _consoleOutput(name === 'dirXml' ? 'dirxml' : name, arguments);
      }),
      writable: true, enumerable: true, configurable: true,
    });
  }
  return context;
}
const _consoleTaskPrototype = Object.create(Object.prototype);
Object.defineProperty(_consoleTaskPrototype, 'constructor', {
  value: Object, writable: true, enumerable: false, configurable: true,
});
function _newConsoleTask() {
  const task = Object.create(_consoleTaskPrototype);
  const run = _makeConsoleMethod('run', 0, function() {
    if (this !== task) throw new Error("'run' called with illegal receiver.");
    const callback = arguments[0];
    if (typeof callback !== 'function') throw new Error('First argument must be a function.');
    return callback.call(globalThis);
  });
  Object.defineProperty(task, 'run', {
    value: run, writable: true, enumerable: true, configurable: true,
  });
  return task;
}

function registerConsoleSurface() {
  globalThis.console = _bootstrapObject('console', () => ({}));
}
registerConsoleSurface();
for (const name of _consoleMethodNames) {
  const length = name === 'context' ? 1 : 0;
  const implementation = name === 'context'
    ? function() { return _newConsoleContext(); }
    : name === 'createTask'
      ? function() { return _newConsoleTask(); }
      : function() { return _consoleOutput(name, arguments); };
  Object.defineProperty(globalThis.console, name, {
    value: _makeConsoleMethod(name, length, implementation),
    writable: true, enumerable: true, configurable: true,
  });
}
Object.defineProperty(globalThis.console, Symbol.toStringTag, {
  value: 'console', writable: false, enumerable: false, configurable: true,
});
