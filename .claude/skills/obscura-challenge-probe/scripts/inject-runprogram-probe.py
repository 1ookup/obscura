"""Log the VM's own view of the challenge program.

Two seams, both at the boundary the VM itself uses:

  runProgram(text, b)  -- the global (pristine:1243) that consumes the decoded
      program text. `UF = runProgram(Ux(responseText), b)` at pristine:3406 and
      the source-embedded literal at pristine:5072 go through the same call.
      Wrapping it reports the text the VM really decoded, from the VM's side.
  XMLHttpRequest.responseText -- the raw body the VM decodes for /fo/.

Nothing else is rewritten; the wrapper calls through and returns the same value.
"""
import json

SNIPPET = r"""
;(function(){
  try{
    var W = window;
    if (W.__rpWrap) return; W.__rpWrap = 1;
    function tl(k, v){ try{ if (W.external && W.external.tracelog) W.external.tracelog(k, v); }catch(e){} }
    function where(){ try{ return String(W.location && W.location.href || '').slice(0, 70); }catch(e){ return ''; } }
    function stack(){ try{ return String((new Error().stack)||'').split('\n').slice(1,4).join(' | ').slice(0, 150); }catch(e){ return ''; } }
    function headHex(s, n){
      try{ var o = [], i; for (i = 0; i < s.length && i < (n||24); i++) o.push(('0' + s.charCodeAt(i).toString(16)).slice(-2)); return o.join(' '); }catch(e){ return '?'; }
    }
    function charset(s){
      try{
        var seen = {}, out = [], i, q;
        for (i = 0; i < s.length; i++){ q = s.charCodeAt(i); if (!seen[q]) { seen[q] = 1; out.push(q); } }
        out.sort(function(a,b){ return a-b; });
        return out.length + ' distinct; ' + out.map(function(c){ return (c >= 32 && c < 127) ? String.fromCharCode(c) : '\\x' + c.toString(16); }).join('');
      }catch(e){ return '?'; }
    }

    // ---- seam 1: runProgram ------------------------------------------------
    var real = null;
    function install(fn){
      if (typeof fn !== 'function') return fn;
      var wrapped = function(){
        try{
          var a0 = arguments[0];
          var rec = { where: where(), argc: arguments.length, stack: stack() };
          if (typeof a0 === 'string'){
            rec.textLen = a0.length;
            rec.head = a0.slice(0, 72);
            rec.headHex = headHex(a0, 16);
            rec.mid = a0.slice(Math.floor(a0.length/2), Math.floor(a0.length/2) + 40);
            rec.tail = a0.slice(-40);
            rec.charset = charset(a0.slice(0, 4000));
            try{ rec.atobHeadHex = headHex(W.atob(a0.slice(0, 64)), 16); }catch(e){ rec.atobHeadHex = 'atob threw'; }
          } else {
            rec.a0kind = Object.prototype.toString.call(a0);
          }
          rec.a1kind = Object.prototype.toString.call(arguments[1]);
          tl('rp.call', rec);
        }catch(e){}
        return real.apply(this, arguments);
      };
      try{ Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true }); }catch(e){}
      try{ wrapped.toString = function(){ return fn.toString(); }; }catch(e){}
      real = wrapped;
      return wrapped;
    }
    try{
      Object.defineProperty(W, 'runProgram', {
        configurable: true, enumerable: true,
        get: function(){ return real; },
        set: function(v){ install(v); }
      });
      tl('rp.accessor', { where: where() });
    }catch(e){
      tl('rp.accessor.failed', { where: where(), err: String(e).slice(0, 80) });
    }

    // ---- seam 2: the raw /fo/ response text --------------------------------
    try{
      var X = W.XMLHttpRequest;
      if (X && X.prototype){
        var d = Object.getOwnPropertyDescriptor(X.prototype, 'responseText');
        if (d && d.get){
          Object.defineProperty(X.prototype, 'responseText', {
            configurable: true, enumerable: d.enumerable,
            get: function(){
              var r = d.get.call(this);
              try{
                if (typeof r === 'string' && this.responseURL && String(this.responseURL).indexOf('/fo/') >= 0){
                  tl('rp.fo.responseText', { where: where(), url: String(this.responseURL).slice(0, 60), len: r.length, head: r.slice(0, 72), headHex: headHex(r, 16), charset: charset(r.slice(0, 4000)) });
                }
              }catch(e){}
              return r;
            }
          });
        }
      }
    }catch(e){}
    try{
      var _o = W.XMLHttpRequest && W.XMLHttpRequest.prototype.open;
      if (typeof _o === 'function'){
        W.XMLHttpRequest.prototype.open = function(m, u){
          try{ tl('rp.xhr.open', { where: where(), method: String(m), url: String(u).slice(0, 120), stack: stack() }); }catch(e){}
          return _o.apply(this, arguments);
        };
      }
    }catch(e){}
    try{
      var _s = W.XMLHttpRequest && W.XMLHttpRequest.prototype.send;
      if (typeof _s === 'function'){
        W.XMLHttpRequest.prototype.send = function(b){
          try{
            var rec = { where: where(), url: String(this.responseURL || '').slice(0, 80), stack: stack(), arg: Object.prototype.toString.call(b) };
            if (typeof b === 'string'){ rec.bodyLen = b.length; rec.bodyHead = b.slice(0, 120); rec.charset = charset(b.slice(0, 4000)); }
            tl('rp.xhr.send', rec);
          }catch(e){}
          return _s.apply(this, arguments);
        };
      }
    }catch(e){}
    // ---- seam 3: the other consumer branch (pristine:3398 `new Function`) ---
    try{
      var _Fn = W.Function;
      function fnArg(args){
        try{
          var last = args[args.length - 1];
          if (typeof last === 'string' && last.length > 400){
            tl('rp.Function', { where: where(), len: last.length, nargs: args.length, head: last.slice(0, 120), stack: stack() });
          }
        }catch(e){}
      }
      if (typeof Proxy === 'function'){
        var px = new Proxy(_Fn, {
          apply: function(t, th, args){ fnArg(args); return Reflect.apply(t, th, args); },
          construct: function(t, args){ fnArg(args); return Reflect.construct(t, args); }
        });
        Object.defineProperty(W, 'Function', { value: px, writable: true, configurable: true });
      } else {
        Object.defineProperty(W, 'Function', { value: function(){
          fnArg(arguments);
          return new (Function.prototype.bind.apply(_Fn, [null].concat(Array.prototype.slice.call(arguments))))();
        }, writable: true, configurable: true });
      }
      tl('rp.Function.wrapped', { where: where() });
    }catch(e){ tl('rp.Function.failed', { where: where(), err: String(e).slice(0, 80) }); }

    // ---- seam 4: the /fo/ response text, as the page sees it --------------
    try{
      var _fetch = W.fetch;
      if (typeof _fetch === 'function'){
        Object.defineProperty(W, 'fetch', { value: function(input, init){
          var url = '';
          try{ url = (typeof input === 'string') ? input : String(input && input.url || ''); }catch(e){}
          var p = _fetch.apply(this, arguments);
          try{
            if (url.indexOf('/fo/') >= 0){
              tl('rp.fo.fetch', { where: where(), url: url.slice(0, 70), method: String(init && init.method || '?'), bodyKind: Object.prototype.toString.call(init && init.body) });
              p = p.then(function(resp){
                try{
                  var cl = resp.clone();
                  cl.text().then(function(t){
                    try{ tl('rp.fo.text', { where: where(), url: String(resp.url || '').slice(0, 70), len: t.length, head: t.slice(0, 120), headHex: headHex(t, 16), charset: charset(t.slice(0, 4000)) }); }catch(e){}
                  }, function(){});
                }catch(e){}
                return resp;
              });
            }
          }catch(e){}
          return p;
        }, writable: true, configurable: true });
        tl('rp.fetch.wrapped', { where: where() });
      }
    }catch(e){ tl('rp.fetch.failed', { where: where(), err: String(e).slice(0, 80) }); }
    tl('rp.installed', { where: where() });
  }catch(e){}
})();
"""

JS_TYPES = ("javascript", "ecmascript")
_log = open("/tmp/goal/rpwrap.log", "a")


def _note(m):
    _log.write(m + "\n")
    _log.flush()


def response(flow):
    try:
        if flow.response is not None and "/fo/" in flow.request.pretty_url:
            import os
            os.makedirs("/tmp/goal/fobodies2", exist_ok=True)
            body = flow.response.content or b""
            if body:
                with open(f"/tmp/goal/fobodies2/{flow.request.host[:9]}-{len(flow.request.content or b'')}-{len(body)}.bin", "wb") as h:
                    h.write(body)
        if flow.response is None or flow.request.method.upper() != "GET":
            return
        if flow.response.status_code not in (200, 403):
            return
        ctype = (flow.response.headers.get("content-type", "") or "").lower()
        url = flow.request.pretty_url
        if any(t in ctype for t in JS_TYPES):
            body = flow.response.get_text(strict=False)
            if not body:
                return
            flow.response.set_text(SNIPPET + "\n" + body)
            _note(f"[rpwrap] wrapped js {len(body)} bytes at {url[:100]}")
            return
        if "html" in ctype and ("/1.txt" in url or "/turnstile/f/" in url):
            body = flow.response.get_text(strict=False)
            marker = "<script nonce="
            at = body.find(marker)
            if at == -1:
                _note(f"[rpwrap] no nonce script in {url[:80]}")
                return
            gt = body.find(">", at)
            if gt == -1:
                return
            flow.response.set_text(body[: gt + 1] + SNIPPET + body[gt + 1:])
            _note(f"[rpwrap] wrapped inline script at {url[:80]}")
    except Exception as exc:
        _note(f"[rpwrap] error: {exc}")
