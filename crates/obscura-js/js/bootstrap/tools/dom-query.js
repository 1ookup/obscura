// HTML "ASCII whitespace": U+0009 TAB, U+000A LF, U+000C FF, U+000D CR, U+0020 SPACE.
// Class token splitting (classList, getElementsByClassName) uses exactly this set.
// JS \s is wider (U+000B, U+00A0, U+2028, etc.), so it must not be used here.
const _ASCII_WS = /[ \t\n\f\r]+/;
function _splitAsciiWhitespace(s) {
  // WebIDL DOMString coercion: null -> "null", undefined -> "undefined".
  return String(s).split(_ASCII_WS).filter(Boolean);
}
// Shared getElementsByClassName: split the argument into an ordered set of
// tokens on ASCII whitespace, then return descendants (in tree order) whose
// class attribute contains every token, as an HTMLCollection (so namedItem and
// named access work on the result). `root` must expose querySelectorAll.
function _getElementsByClassName(root, classNames) {
  const tokens = _splitAsciiWhitespace(classNames);
  if (tokens.length === 0) return _htmlCollectionFrom([]);
  const queryAll = root && typeof root[_nidSym] === 'number'
    ? selector => _internalQuerySelectorAll(root, selector)
    : selector => root.querySelectorAll(selector);
  // Fast path: a single CSS-identifier token goes straight to the native
  // selector engine (the common case). Only multi-token sets or exotic class
  // names (NBSP, leading digits, etc.) fall back to the O(n) JS scan below.
  if (tokens.length === 1 && /^[A-Za-z_-][\w-]*$/.test(tokens[0])) {
    return _htmlCollectionFrom(queryAll("." + tokens[0]));
  }
  const all = queryAll("*");
  const matched = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const elTokens = _splitAsciiWhitespace(el.getAttribute ? (el.getAttribute("class") || "") : "");
    let ok = true;
    for (let t = 0; t < tokens.length; t++) {
      if (elTokens.indexOf(tokens[t]) < 0) { ok = false; break; }
    }
    if (ok) matched.push(el);
  }
  return _htmlCollectionFrom(matched);
}
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
function _consoleOutput(name, args) {
  if (name === 'assert') {
    if (!args[0]) _consoleFn('error', ['Assertion failed:', ...Array.from(args).slice(1)]);
    return;
  }
  if (name === 'error' || name === 'warn') return _consoleFn(name, Array.from(args));
  if (name === 'debug' || name === 'info' || name === 'log'
      || name === 'dir' || name === 'dirxml' || name === 'table'
      || name === 'trace') {
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

