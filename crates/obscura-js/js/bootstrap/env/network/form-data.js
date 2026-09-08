if (typeof FormData === "undefined") globalThis.FormData = class FormData { constructor(){this._d=[];} append(k,v){this._d.push([k,v]);} get(k){const e=this._d.find(([a])=>a===k);return e?e[1]:null;} getAll(k){return this._d.filter(([a])=>a===k).map(([,v])=>v);} has(k){return this._d.some(([a])=>a===k);} entries(){return this._d[Symbol.iterator]();} forEach(cb){this._d.forEach(([k,v])=>cb(v,k));} };
// application/x-www-form-urlencoded serializer: like encodeURIComponent but
// space -> '+' and also percent-encoding the chars encodeURIComponent leaves
// bare ( ! ~ ' ( ) ), keeping the form-urlencoded safe set ( * - . _ ).
function _formEncode(s){
  return encodeURIComponent(String(s)).replace(/%20/g,'+').replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function _hexv(c){ if(c>=48&&c<=57)return c-48; if(c>=65&&c<=70)return c-55; if(c>=97&&c<=102)return c-87; return -1; }
if (typeof URLSearchParams === "undefined") {
  const state = new WeakMap();
  const data = value => {
    const stored = state.get(value);
    if (!stored) throw new TypeError('Illegal invocation');
    return stored;
  };
  const decode = value => {
    const s = String(value);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x2B) { out.push(0x20); }
      else if (c === 0x25 && i + 2 < s.length) {
        const a = _hexv(s.charCodeAt(i + 1)), b = _hexv(s.charCodeAt(i + 2));
        if (a >= 0 && b >= 0) { out.push(a * 16 + b); i += 2; } else { out.push(c); }
      } else if (c < 0x80) { out.push(c); }
      else { const e = new TextEncoder().encode(s[i]); for (let j = 0; j < e.length; j++) out.push(e[j]); }
    }
    try { return new TextDecoder().decode(new Uint8Array(out)); } catch (e) { return s; }
  };
  const parseString = value => {
    const pairs = [];
    const s = String(value).replace(/^\?/, "");
    if (s === "") return pairs;
    for (const pair of s.split("&")) {
      if (pair === "") continue;
      const i = pair.indexOf("=");
      const k = i === -1 ? pair : pair.slice(0, i);
      const v = i === -1 ? "" : pair.slice(i + 1);
      pairs.push([decode(k), decode(v)]);
    }
    return pairs;
  };
  const serialize = pairs => pairs.map(pair =>
    _formEncode(pair[0]) + "=" + _formEncode(pair[1])).join("&");
  const notify = value => {
    const stored = data(value);
    if (stored.url) _urlUpdateSearch(stored.url, serialize(stored.pairs));
  };
  const URLSearchParamsImpl = class URLSearchParams {
    constructor(init=""){
      let pairs = [];
      if (typeof URLSearchParams === 'function' && init instanceof URLSearchParams) {
        pairs = data(init).pairs.map(pair => [pair[0], pair[1]]);
      } else if(typeof init==="string"){
        pairs = parseString(init);
      } else if (init && typeof init[Symbol.iterator] === 'function') {
        for (const pair of init) {
          const a = Array.from(pair);
          if (a.length !== 2) throw new TypeError("Failed to construct 'URLSearchParams': Each query pair must be an iterable [name, value] tuple");
          pairs.push([String(a[0]), String(a[1])]);
        }
      } else if (init && typeof init === 'object') {
        Object.keys(init).forEach(k => pairs.push([String(k), String(init[k])]));
      }
      state.set(this, { pairs, url: null });
    }
    get size(){ return data(this).pairs.length; }
    append(k,v){ data(this).pairs.push([String(k),String(v)]); notify(this); }
    delete(k,v){ const stored=data(this); k=String(k); const hv=(v!==undefined); v=String(v); stored.pairs=stored.pairs.filter(([key,val])=> hv ? !(key===k&&val===v) : key!==k); notify(this);}
    get(k){k=String(k); const p=data(this).pairs.find(([key])=>key===k); return p?p[1]:null;}
    getAll(k){k=String(k); return data(this).pairs.filter(([key])=>key===k).map(pair=>pair[1]);}
    has(k,v){k=String(k); const hv=(v!==undefined); v=String(v); return data(this).pairs.some(([key,val])=> hv ? (key===k&&val===v) : key===k);}
    set(k,v){const stored=data(this); k=String(k); v=String(v); let done=false; const out=[]; for (const pair of stored.pairs){ if(pair[0]===k){ if(!done){ out.push([k,v]); done=true; } } else out.push(pair); } if(!done) out.push([k,v]); stored.pairs=out; notify(this); }
    sort(){ const stored=data(this); stored.pairs.sort((a,b)=> a[0]<b[0]?-1:(a[0]>b[0]?1:0)); notify(this); }
    toString(){return serialize(data(this).pairs);}
    *entries(){ for (const pair of data(this).pairs) yield [pair[0],pair[1]]; }
    forEach(cb,thisArg){data(this).pairs.slice().forEach(pair=>cb.call(thisArg,pair[1],pair[0],this));}
    *keys(){ for (const pair of data(this).pairs) yield pair[0]; }
    *values(){ for (const pair of data(this).pairs) yield pair[1]; }
    [Symbol.iterator](){ return this.entries(); }
  };
  const constructorDescriptor = Object.getOwnPropertyDescriptor(URLSearchParamsImpl.prototype, 'constructor');
  delete URLSearchParamsImpl.prototype.constructor;
  Object.defineProperty(URLSearchParamsImpl.prototype, 'constructor', constructorDescriptor);
  globalThis.URLSearchParams = URLSearchParamsImpl;
  _urlSearchParamsBind = (params, url) => { data(params).url = url; };
  _urlSearchParamsSetFromString = (params, value) => { data(params).pairs = parseString(value); };
}

