// In-flight observation probe for the Cloudflare challenge.
//
// Runs in every realm the CDP preload reaches. Records go through
// external.tracelog (window realm: installed by the bootstrap; worker realm:
// installed by the prep script when --tracelog-file is set).
//
// Visibility discipline this file has to respect, or the run never reaches the
// stage being observed: every wrapper keeps the original `name`, `length` and
// `toString()` output (the VM calls Function.prototype.toString on builtins
// while it collects telemetry), and no probe-owned global is enumerable, since
// the VM audits the global with for..in.
;(function () {
  var G = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (!G) return;
  // Which seams to install. Bisecting is a one-character edit here.
  var ON = 'fabxwreomk';

  var EXT = G.external;
  function tl(k, v) { try { if (EXT && typeof EXT.tracelog === 'function') EXT.tracelog(k, v); } catch (e) {} }
  function realm() {
    try {
      if (typeof importScripts === 'function' || typeof DedicatedWorkerGlobalScope === 'function') return 'worker';
      if (typeof window !== 'undefined') return 'window';
      return 'other';
    } catch (e) { return '?'; }
  }
  var R = realm();
  var FPT = Function.prototype.toString;

  // Restore the native-looking shape on a wrapper: same name, same arity, and
  // toString() answering exactly what the original did.
  function camo(fn, orig) {
    try { Object.defineProperty(fn, 'name', { value: orig.name, configurable: true }); } catch (e) {}
    try { Object.defineProperty(fn, 'length', { value: orig.length, configurable: true }); } catch (e) {}
    var text = null;
    try { text = FPT.call(orig); } catch (e) {}
    if (typeof text === 'string') {
      var ts = function () { return text; };
      try { Object.defineProperty(ts, 'name', { value: 'toString', configurable: true }); } catch (e) {}
      try { Object.defineProperty(fn, 'toString', { value: ts, writable: true, enumerable: false, configurable: true }); } catch (e) {}
      try { fn.toString = ts; } catch (e) {}
    }
    return fn;
  }
  function def(o, n, fn) {
    // Preserve the existing descriptor's flags. A WebIDL global operation is
    // enumerable, writable and configurable; redefining it as non-enumerable
    // is a tell that a for..in audit reads immediately.
    var prev = null;
    try { prev = Object.getOwnPropertyDescriptor(o, n); } catch (e) {}
    try {
      Object.defineProperty(o, n, {
        value: fn,
        writable: prev ? prev.writable !== false : true,
        enumerable: prev ? prev.enumerable === true : false,
        configurable: prev ? prev.configurable !== false : true,
      });
      return true;
    } catch (e) {
      try { o[n] = fn; return true; } catch (e2) { return false; }
    }
  }
  function wrap(obj, name, make) {
    try {
      var orig = obj[name];
      if (typeof orig !== 'function') return false;
      var patched = camo(make(orig), orig);
      if (!def(obj, name, patched)) return false;
      return obj[name] === patched;
    } catch (e) { return false; }
  }
  function hex(s, n) {
    try { var o = [], i; for (i = 0; i < s.length && i < (n || 24); i++) o.push(('0' + s.charCodeAt(i).toString(16)).slice(-2)); return o.join(' '); } catch (e) { return '?'; }
  }
  function strrec(s, cap) {
    try {
      var rec = { len: s.length, head: s.slice(0, 96), headHex: hex(s, 16) };
      if (cap) { rec.mid = s.slice(Math.floor(s.length / 2), Math.floor(s.length / 2) + 48); rec.tail = s.slice(-48); }
      return rec;
    } catch (e) { return { err: String(e) }; }
  }
  function stack() { try { return String((new Error().stack) || '').split('\n').slice(1, 5).join(' | ').slice(0, 200); } catch (e) { return ''; } }
  var FO = /\/fo\/|\/eb\/|\/pat\//;
  var wraps = {};

  if (ON.indexOf('f') >= 0) wraps.fetch = wrap(G, 'fetch', function (orig) {
    return function (input, init) {
      var url = '';
      try { url = (typeof input === 'string') ? input : String((input && input.url) || ''); } catch (e) {}
      var hit = false;
      try { hit = FO.test(url); } catch (e) {}
      if (hit) {
        try {
          var rec = { realm: R, url: url.slice(0, 90), method: String((init && init.method) || 'GET'), kind: Object.prototype.toString.call(init && init.body), stack: stack() };
          if (typeof (init && init.body) === 'string') { var s = strrec(init.body, true); for (var k in s) rec[k] = s[k]; }
          tl('rp.fetch.req', rec);
        } catch (e) {}
      }
      var p = orig.apply(this, arguments);
      try {
        if (hit) p = p.then(function (resp) {
          try {
            resp.clone().text().then(function (t) {
              try { var rec = { realm: R, url: String(resp.url || '').slice(0, 90), status: resp.status }; var s = strrec(t, true); for (var k in s) rec[k] = s[k]; tl('rp.fetch.resp', rec); } catch (e) {}
            }, function () {});
          } catch (e) {}
          return resp;
        });
      } catch (e) {}
      return p;
    };
  });
  if (ON.indexOf('a') >= 0) wraps.atob = wrap(G, 'atob', function (orig) {
    return function (v) {
      var r = orig.apply(this, arguments);
      try { if (typeof v === 'string' && v.length >= 2048) tl('rp.atob', { realm: R, inLen: v.length, inHead: v.slice(0, 64), outLen: r.length, outHeadHex: hex(r, 24) }); } catch (e) {}
      return r;
    };
  });
  if (ON.indexOf('b') >= 0) wraps.btoa = wrap(G, 'btoa', function (orig) {
    return function (v) {
      var r = orig.apply(this, arguments);
      try { if (typeof v === 'string' && v.length >= 1024) tl('rp.btoa', { realm: R, inLen: v.length, inHead: v.slice(0, 64), outHead: r.slice(0, 64) }); } catch (e) {}
      return r;
    };
  });
  if (ON.indexOf('x') >= 0) wraps.XHR_open = (function () {
    var X = G.XMLHttpRequest;
    if (!X || !X.prototype) return false;
    var ok = wrap(X.prototype, 'open', function (orig) {
      return function (m, u) {
        try { Object.defineProperty(this, '__rpUrl', { value: String(u), writable: true, enumerable: false, configurable: true }); } catch (e) {}
        try { if (FO.test(String(u))) tl('rp.xhr.open', { realm: R, method: String(m), url: String(u).slice(0, 110), stack: stack() }); } catch (e) {}
        return orig.apply(this, arguments);
      };
    });
    var ok2 = wrap(X.prototype, 'send', function (orig) {
      return function (b) {
        try {
          if (FO.test(String(this.__rpUrl || ''))) {
            var rec = { realm: R, url: String(this.__rpUrl || '').slice(0, 110), kind: Object.prototype.toString.call(b), stack: stack() };
            if (typeof b === 'string') { var s = strrec(b, true); for (var k in s) rec[k] = s[k]; }
            tl('rp.xhr.send', rec);
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    });
    return ok && ok2;
  })();
  // Wrap the constructor but keep the prototype chain: a fresh prototype object
  // would drop terminate/addEventListener off every instance, which the
  // challenge notices long before it posts anything.
  if (ON.indexOf('w') >= 0) wraps.Worker = (function () {
    var orig = G.Worker;
    if (typeof orig !== 'function') return false;
    var patched = camo(function (url, opts) {
      var pre = { realm: R, url: String(url).slice(0, 90), scheme: String(url).split(':')[0], type: String(opts && opts.type), stack: stack() };
      try {
        try { pre.tag = Object.prototype.toString.call(url); } catch (e) {}
        try { pre.blobType = String(url && url.type); pre.blobSize = url && url.size; } catch (e) {}
        tl('rp.worker.ctor', pre);
      } catch (e) {}
      try {
        return new (Function.prototype.bind.apply(orig, [null].concat(Array.prototype.slice.call(arguments))))();
      } catch (e) {
        // A constructor that throws is exactly the divergence worth seeing:
        // the caller's fan-out stops here and never posts a task.
        try {
          tl('rp.worker.ctor.threw', {
            realm: R, url: pre.url, name: e && e.name, message: e && e.message,
            stack: stack(),
          });
        } catch (e2) {}
        throw e;
      }
    }, orig);
    try { patched.prototype = orig.prototype; } catch (e) {}
    if (!def(G, 'Worker', patched) || G.Worker !== patched) return false;
    var pmOk = false;
    try {
      if (orig.prototype && typeof orig.prototype.postMessage === 'function') {
        var pm = orig.prototype.postMessage;
        var prev = Object.getOwnPropertyDescriptor(orig.prototype, 'postMessage') || {};
        var wrapped = camo(function (data, transfer) {
          var forwarded = data;
          try {
            var t = (typeof data === 'string') ? data : JSON.stringify(data);
            if (typeof t === 'string' && t.length) tl('rp.worker.post', { realm: R, len: t.length, head: t.slice(0, 1500), hasPM: t.indexOf('postMessage') >= 0, hasFetch: t.indexOf('fetch') >= 0 });
          } catch (e) {}
          try {
            // classic worker source: the observer runs inside the worker scope
            if (typeof data === 'string' && data.indexOf('postMessage') >= 0
                && data.indexOf('hahavm_this') < 0 && data.indexOf('__rpwRP') < 0) {
              forwarded = WORKER_PROBE + data;
            }
          } catch (e) {}
          return pm.call(this, forwarded, transfer);
        }, pm);
        Object.defineProperty(orig.prototype, 'postMessage', {
          value: wrapped,
          writable: prev.writable !== false,
          enumerable: prev.enumerable === true,
          configurable: prev.configurable !== false,
        });
        pmOk = orig.prototype.postMessage === wrapped;
      }
    } catch (e) {}
    // The reference's next step after constructing a worker is
    // `workers.push(w); w.onmessage = fn; w.postMessage(task)`. Recording the
    // handler assignment (and any throw from our setter) closes the gap
    // between "the constructor returned" and "the task was posted".
    try {
      var od = Object.getOwnPropertyDescriptor(orig.prototype, 'onmessage');
      if (od && od.set) {
        var oset = od.set, oget = od.get;
        Object.defineProperty(orig.prototype, 'onmessage', {
          get: oget,
          set: function (fn) {
            var rec = { realm: R, kind: typeof fn, stack: stack() };
            try {
              var r = oset.call(this, fn);
              rec.ok = true;
              tl('rp.worker.onmessage', rec);
              return r;
            } catch (e) {
              rec.ok = false; rec.name = e && e.name; rec.message = e && e.message;
              tl('rp.worker.onmessage', rec);
              throw e;
            }
          },
          enumerable: od.enumerable, configurable: od.configurable,
        });
      }
    } catch (e) {}
    try {
      var ae = orig.prototype.addEventListener;
      if (typeof ae === 'function') {
        Object.defineProperty(orig.prototype, 'addEventListener', {
          value: camo(function (type, fn) {
            try { tl('rp.worker.listener', { realm: R, type: String(type), kind: typeof fn, stack: stack() }); } catch (e) {}
            return ae.apply(this, arguments);
          }, ae),
          writable: true, enumerable: false, configurable: true,
        });
      }
    } catch (e) {}
    return pmOk;
  })();


  // The worker realm is where the challenge's later probes and its payload
  // plumbing run, and a CDP preload does not reach an isolate. The posted
  // classic source is the worker's script, so the observer rides along as its
  // first statement; it reports through external.tracelog, which the worker
  // prep installs when the host asked for a destination.
  var WORKER_PROBE = '(' + function () {
    try {
      var E = self.external;
      function T(k, v) { try { if (E && typeof E.tracelog === 'function') E.tracelog(k, v); } catch (e) {} }
      function keep(o, n, fn) {
        var prev = Object.getOwnPropertyDescriptor(o, n) || {};
        try {
          Object.defineProperty(o, n, { value: fn, writable: prev.writable !== false,
            enumerable: prev.enumerable === true, configurable: prev.configurable !== false });
        } catch (e) { try { o[n] = fn; } catch (e2) {} }
      }
      T('rpw.hello', {
        hasExt: !!E, hasTL: !!(E && typeof E.tracelog === 'function'),
        dwsc: typeof DedicatedWorkerGlobalScope, ias: typeof importScripts,
        syncHandle: typeof self.FileSystemSyncAccessHandle, tag: Object.prototype.toString.call(self),
        ua: navigator.userAgent, platform: navigator.platform, hc: navigator.hardwareConcurrency,
        dm: navigator.deviceMemory, langs: navigator.languages, loc: String(self.location && self.location.href).slice(0, 60),
      });
      var pm = self.postMessage;
      if (typeof pm === 'function') {
        keep(self, 'postMessage', function (msg, transfer) {
          try {
            var t = (typeof msg === 'string') ? msg : JSON.stringify(msg);
            if (typeof t === 'string' && t.length) T('rpw.post', { len: t.length, body: t.slice(0, 400) });
          } catch (e) {}
          return pm.apply(this, arguments);
        });
      }
      var f = self.fetch;
      if (typeof f === 'function') {
        keep(self, 'fetch', function (u, i) {
          try {
            if (String(u).indexOf('/fo/') >= 0) T('rpw.fetch.req', {
              url: String(u).slice(0, 90), method: String((i && i.method) || 'GET'),
              bodyLen: (i && typeof i.body === 'string') ? i.body.length : null,
              bodyHead: (i && typeof i.body === 'string') ? i.body.slice(0, 120) : null });
          } catch (e) {}
          var p = f.apply(this, arguments);
          try {
            p = p.then(function (r) {
              try { r.clone().text().then(function (t) { T('rpw.fetch.resp', { status: r.status, len: t.length, head: t.slice(0, 96) }); }, function () {}); } catch (e) {}
              return r;
            });
          } catch (e) {}
          return p;
        });
      }
      ['atob', 'btoa'].forEach(function (n) {
        var o = self[n];
        if (typeof o !== 'function') return;
        keep(self, n, function (v) {
          var r = o.apply(this, arguments);
          try { if (typeof v === 'string' && v.length >= 2048) T('rpw.' + n, { inLen: v.length, inHead: v.slice(0, 64), outLen: r.length }); } catch (e) {}
          return r;
        });
      });
      var rp = self.runProgram;
      if (typeof rp !== 'function') {
        try {
          Object.defineProperty(self, 'runProgram', {
            configurable: true, enumerable: true,
            get: function () { return self.__rpwRP; },
            set: function (v) {
              if (typeof v !== 'function') { self.__rpwRP = v; return; }
              var real = v;
              var w = function () {
                var t0 = 0;
                try { t0 = performance.now(); } catch (e) {}
                try {
                  var a0 = arguments[0];
                  if (typeof a0 === 'string') T('rpw.runProgram', { len: a0.length, head: a0.slice(0, 96), tail: a0.slice(-48) });
                } catch (e) {}
                var out = null, threw = null;
                try { out = real.apply(this, arguments); } catch (e) { threw = e; }
                try {
                  var ms = Math.round((performance.now() - t0) * 100) / 100;
                  if (threw) T('rpw.runProgram.out', { threw: true, ms: ms, name: threw && threw.name, message: String(threw && threw.message).slice(0, 300) });
                  else if (out && typeof out.then === 'function') {
                    T('rpw.runProgram.out', { promise: true, ms: ms });
                    out.then(function () { T('rpw.runProgram.settled', { ok: true, ms: ms }); },
                             function (e) { T('rpw.runProgram.settled', { ok: false, ms: ms, message: String(e && e.message).slice(0, 200) }); });
                  } else {
                    T('rpw.runProgram.out', { ms: ms, kind: Object.prototype.toString.call(out), value: String(out).slice(0, 200) });
                  }
                } catch (e) {}
                if (threw) throw threw;
                return out;
              };
              try { Object.defineProperty(w, 'name', { value: v.name, configurable: true }); } catch (e) {}
              self.__rpwRP = w;
              try { Object.defineProperty(self, 'runProgram', { value: w, writable: true, enumerable: true, configurable: true }); } catch (e) {}
            },
          });
        } catch (e) {}
      }
    } catch (e) { try { self.external.tracelog('rpw.error', { e: String(e).slice(0, 120) }); } catch (e2) {} }
  }.toString() + ')();' + String.fromCharCode(10);

  // The VM's own program consumer. It is assigned once with plain assignment
  // (`G.runProgram = fn`), so an accessor catches it; the accessor is then
  // replaced by an ordinary data property holding the wrapper, because a
  // global whose descriptor has get/set is not what a browser shows.
  var origRP = null;
  var publicRP = null;
  function installRP(fn) {
    if (typeof fn !== 'function') return fn;
    var wrapped = camo(function () {
      var t0 = 0;
      try { t0 = performance.now(); } catch (e) {}
      var rec = { realm: R, argc: arguments.length, stack: stack() };
      try {
        var a0 = arguments[0];
        if (typeof a0 === 'string') { var s = strrec(a0, true); for (var k in s) rec[k] = s[k]; try { rec.atobHeadHex = hex(G.atob(a0.slice(0, 64)), 16); } catch (e) {} }
        else if (a0 && typeof a0.length === 'number') { rec.a0kind = Object.prototype.toString.call(a0); rec.a0len = a0.length; }
        else { rec.a0kind = Object.prototype.toString.call(a0); }
        tl('rp.runProgram', rec);
      } catch (e) {}
      // The program's outcome is the program-side signal: a program that
      // returns without doing what the reference does either completed down a
      // different branch or took the VM's error path.
      var out = null, threw = null;
      try { out = origRP.apply(this, arguments); } catch (e) { threw = e; }
      try {
        var elapsed = function () { try { return Math.round((performance.now() - t0) * 100) / 100; } catch (e) { return -1; } };
        if (threw) {
          tl('rp.runProgram.out', { realm: R, threw: true, ms: elapsed(),
            name: threw && threw.name, message: String(threw && threw.message).slice(0, 300), stack: stack() });
        } else if (out && typeof out.then === 'function') {
          tl('rp.runProgram.out', { realm: R, promise: true, ms: elapsed(), argc: rec.argc });
          try {
            out.then(function (v) {
              tl('rp.runProgram.settled', { realm: R, ok: true, ms: elapsed(),
                kind: Object.prototype.toString.call(v), value: String(v).slice(0, 240) });
            }, function (e) {
              tl('rp.runProgram.settled', { realm: R, ok: false, ms: elapsed(),
                name: e && e.name, message: String(e && e.message).slice(0, 300) });
            });
          } catch (e) {}
        } else {
          var r = { realm: R, ms: elapsed(), kind: Object.prototype.toString.call(out) };
          try { r.value = String(out).slice(0, 240); } catch (e) {}
          tl('rp.runProgram.out', r);
        }
      } catch (e) {}
      if (threw) throw threw;
      // runProgram BUILDS the program and returns its executor: measured 3-24 ms
      // and a native function. The execution therefore happens when the VM
      // calls that function, so wrap it to see whether the program is ever
      // driven and how each drive ends. `camo` keeps name/length/toString
      // answering the original text, which the VM reads.
      if (typeof out === 'function') {
        (function () {
          var real = out;
          var n = 0;
          var inner = camo(function () {
            n += 1;
            var t0 = 0;
            try { t0 = performance.now(); } catch (e) {}
            var res = null, err = null;
            try { res = real.apply(this, arguments); } catch (e) { err = e; }
            try {
              var ms = Math.round((performance.now() - t0) * 100) / 100;
              var rec = { realm: R, call: n, ms: ms, argc: arguments.length };
              if (err) { rec.threw = true; rec.name = err && err.name; rec.message = String(err && err.message).slice(0, 300); }
              else if (res && typeof res.then === 'function') {
                rec.promise = true;
                res.then(function () { tl('rp.prog.settled', { realm: R, call: n, ok: true }); },
                         function (e) { tl('rp.prog.settled', { realm: R, call: n, ok: false, message: String(e && e.message).slice(0, 200) }); });
              } else {
                rec.kind = Object.prototype.toString.call(res);
                try { rec.value = String(res).slice(0, 160); } catch (e) {}
              }
              tl('rp.prog.call', rec);
            } catch (e) {}
            if (err) throw err;
            return res;
          }, real);
          try { Object.defineProperty(inner, 'name', { value: real.name, configurable: true }); } catch (e) {}
          try { Object.defineProperty(inner, 'length', { value: real.length, configurable: true }); } catch (e) {}
          out = inner;
        })();
      }
      return out;
    }, fn);
    origRP = fn;
    publicRP = wrapped;
    try {
      Object.defineProperty(G, 'runProgram', {
        value: wrapped, writable: true, enumerable: true, configurable: true,
      });
    } catch (e) {}
    return wrapped;
  }
  // Blob URL lifecycle. A worker built from a blob URL needs the blob's text
  // still registered in this realm's store at construction time; a revoke in
  // between is invisible except as "the constructor threw".
  if (ON.indexOf('o') >= 0) try {
    ['createObjectURL', 'revokeObjectURL'].forEach(function (name) {
      try {
        var u = G.URL && G.URL[name];
        if (typeof u !== 'function') return;
        def(G.URL, name, camo(function (v) {
          var r = u.apply(this, arguments);
          try {
            tl('rp.bloburl.' + (name === 'createObjectURL' ? 'create' : 'revoke'), {
              realm: R, url: String(r).slice(0, 90),
              blobType: name === 'createObjectURL' ? String(v && v.type) : undefined,
              blobSize: name === 'createObjectURL' ? (v && v.size) : undefined,
              known: !!(G.__blobStore && G.__blobStore[r] !== undefined),
              stack: stack(),
            });
          } catch (e) {}
          return r;
        }, u));
      } catch (e) {}
    });
  } catch (e) {}

  // Cross-realm handoff. The widget's last act is a postMessage to its parent;
  // if that message is not delivered the page waits forever in its own loop
  // and the widget realm goes silent, which looks exactly like a stuck worker.
  if (ON.indexOf('m') >= 0) try {
    wrap(G, 'postMessage', function (orig) {
      return function (data, targetOrigin, transfer) {
        try {
          var rec = { realm: R, targetOrigin: String(targetOrigin),
                      kind: Object.prototype.toString.call(data),
                      stack: stack() };
          if (typeof data === 'string') { rec.len = data.length; rec.head = data.slice(0, 160); }
          else { try { var j = JSON.stringify(data); rec.len = j.length; rec.head = j.slice(0, 160); } catch (e) {} }
          tl('rp.pm.out', rec);
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    });
    try {
      G.addEventListener('message', function (ev) {
        try {
          var rec = { realm: R, origin: String(ev && ev.origin), kind: Object.prototype.toString.call(ev && ev.data),
                      stack: stack() };
          var d = ev && ev.data;
          if (typeof d === 'string') { rec.len = d.length; rec.head = d.slice(0, 160); }
          else { try { var j = JSON.stringify(d); rec.len = j.length; rec.head = j.slice(0, 160); } catch (e) {} }
          tl('rp.pm.in', rec);
        } catch (e) {}
      }, true);
    } catch (e) {}
  } catch (e) {}

  // Blob construction, counted. The reference's post-proof window constructs
  // nine Blobs and calls URL.createObjectURL fifty-eight times; a program that
  // stops after one of each has left the fan-out loop early, which is a
  // program-side fact rather than an inference from host ops.
  if (ON.indexOf('k') >= 0) try {
    var _Blob = G.Blob;
    if (typeof _Blob === 'function') {
      var patchedBlob = camo(function (parts, opts) {
        var made = new (Function.prototype.bind.apply(_Blob, [null].concat(Array.prototype.slice.call(arguments))))();
        try {
          tl('rp.blob.new', { realm: R, size: made && made.size, type: String(made && made.type),
                              argc: arguments.length, stack: stack() });
        } catch (e) {}
        return made;
      }, _Blob);
      try { patchedBlob.prototype = _Blob.prototype; } catch (e) {}
      try { Object.defineProperty(patchedBlob, 'name', { value: _Blob.name, configurable: true }); } catch (e) {}
      def(G, 'Blob', patchedBlob);
      // File keeps its OWN wrapper: aliasing it to Blob makes
      // `x instanceof File` true for a plain Blob, which is a fingerprint the
      // challenge reads (File.prototype must stay a distinct interface).
      try {
        var _File = G.File;
        if (typeof _File === 'function' && _File !== _Blob) {
          var patchedFile = camo(function (parts, name, opts) {
            var made = new (Function.prototype.bind.apply(_File, [null].concat(Array.prototype.slice.call(arguments))))();
            try { tl('rp.blob.new', { realm: R, size: made && made.size, type: String(made && made.type),
                                      file: true, argc: arguments.length }); } catch (e) {}
            return made;
          }, _File);
          try { patchedFile.prototype = _File.prototype; } catch (e) {}
          try {
            Object.defineProperty(patchedFile.prototype, 'constructor',
              { value: patchedFile, writable: true, enumerable: false, configurable: true });
          } catch (e) {}
          def(G, 'File', patchedFile);
        }
      } catch (e) {}
    }
  } catch (e) {}

  if (ON.indexOf('r') >= 0) try {    Object.defineProperty(G, 'runProgram', {
      configurable: true, enumerable: true,
      get: function () { return publicRP; },
      set: function (v) { installRP(v); }
    });
  } catch (e) {}
  if (ON.indexOf('e') >= 0) try {
    var _ev = G.eval;
    if (typeof _ev === 'function') def(G, 'eval', camo(function (src) {
      try {
        if (typeof src === 'string' && src.length > 400) {
          var rec = { realm: R, len: src.length, head: src.slice(0, 300), stack: stack() };
          if (src.length > 1e6) {
            // A large eval is rare enough to describe fully: where the real
            // code starts past the padding, and what it parses to.
            var off = 0;
            while (off < src.length && src.charCodeAt(off) === 32) off++;
            rec.pad = off;
            rec.code = src.slice(off, off + 400);
            rec.tail = src.slice(-120);
            try { rec.parses = String(_ev(src.length ? '0' : '') === undefined ? '' : ''); } catch (e2) {}
            try { var f = new G.Function(src); rec.fnLen = f.length; } catch (e2) { rec.fnErr = String(e2).slice(0, 120); }
          }
          tl('rp.eval', rec);
        }
      } catch (e) {}
      return _ev.apply(this, arguments);
    }, _ev));
  } catch (e) {}

  tl('rp.installed', { realm: R, wraps: wraps, hasExternal: !!EXT, hasTracelog: !!(EXT && typeof EXT.tracelog === 'function'), href: (function () { try { return String(G.location && G.location.href).slice(0, 70); } catch (e) { return ''; } })() });
})();
