let _fpSeed = 0;
// Dynamic module/in-order script queue. Module evaluation remains serialized
// to prevent a re-entrant RefCell panic in deno_core's
// futures_unordered_driver when SPAs insert multiple <script type=module>
// elements at once. Ordinary dynamically inserted classic scripts are async
// by default, so their fetches run independently and execute when ready just
// like browser ScriptRunner tasks; serializing those fetches made unrelated
// analytics/widgets form one long load-blocking waterfall.
let __dynScriptQueue = [];
let __dynScriptBusy = false;
let __dynClassicPending = 0;
let __dynLoadDelayingPending = 0;
Object.defineProperty(globalThis, '__obscura_hasPendingDynamicScripts', {
  value: function() {
    return __dynClassicPending > 0 || __dynScriptBusy || __dynScriptQueue.length > 0;
  },
  writable: false,
  enumerable: false,
  configurable: false,
});
// HTML tracks scripts which delay the document load event separately from
// arbitrary asynchronous script work. A connected external script prepared
// before `load` joins that set until its load/error processing finishes;
// dynamic import() and scripts created by a load handler are post-load work.
// Keep this bridge hidden for the same reason as the general queue status.
Object.defineProperty(globalThis, '__obscura_hasPendingLoadDelayingScripts', {
  value: function() { return __dynLoadDelayingPending > 0; },
  writable: false,
  enumerable: false,
  configurable: false,
});
function _decodeDataScriptUrl(url) {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 5) {
    throw new TypeError('Invalid dynamic script data URL');
  }

  const meta = url.slice(5, comma);
  const fragment = url.indexOf('#', comma + 1);
  const payload = url.slice(comma + 1, fragment < 0 ? url.length : fragment);
  if (meta.split(';').some(part => part.toLowerCase() === 'base64')) {
    let encoded = payload.replace(/[\r\n\t\f ]/g, '');
    const remainder = encoded.length % 4;
    if (remainder === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || /=/.test(encoded.slice(0, -2))) {
      throw new TypeError('Invalid dynamic script data URL base64');
    }
    if (remainder > 0) encoded += '='.repeat(4 - remainder);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new TypeError('Invalid dynamic script data URL base64');
    }
    return new TextDecoder().decode(_base64ToUint8Array(encoded));
  }

  const bytes = [];
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    if (code === 0x25 && i + 2 < payload.length) {
      const hi = _hexv(payload.charCodeAt(i + 1));
      const lo = _hexv(payload.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        bytes.push(hi * 16 + lo);
        i += 2;
        continue;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else {
      const character = String.fromCodePoint(payload.codePointAt(i));
      if (character.length === 2) i++;
      const encoded = new TextEncoder().encode(character);
      for (let j = 0; j < encoded.length; j++) bytes.push(encoded[j]);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
// A script element executes at most once.  The authoritative flag lives in
// native per-document state so it survives wrapper churn, fragment parsing,
// moves, and cloneNode().
globalThis.__markParserScripts = function(nids) {
  for (const nid of nids || []) Deno.core.ops.op_script_mark_started(+nid);
};
function _environmentReferrerPolicy() {
  return String(globalThis.__obscura_referrer_policy || "strict-origin-when-cross-origin");
}
// The document root of the realm making a request. `op_fetch_url` resolves the
// governing CSP from it, because a policy belongs to the document that issued
// the request rather than to the page. Every op_fetch_url call site has to
// carry it: a missing root falls back to the top-level policy, which silently
// applies the wrong CSP to subframe requests.
function _environmentDocumentRoot() {
  return typeof globalThis.__obscura_frame_document_nid === 'number'
    ? globalThis.__obscura_frame_document_nid
    : 0;
}
function _environmentDocumentCsp() {
  try {
    const root = _environmentDocumentRoot();
    const raw = Deno.core.ops.op_dom('document_scope_info', String(root), '');
    const info = raw && JSON.parse(raw);
    return info && typeof info.csp === 'string' ? info.csp : '';
  } catch (_) {
    return '';
  }
}
function _environmentAllowsScripts() {
  try {
    const root = _environmentDocumentRoot();
    const raw = Deno.core.ops.op_dom('document_scope_info', String(root), '');
    const info = raw && JSON.parse(raw);
    return !(info && info.sandboxActive === true && info.allowScripts === false);
  } catch (_) {
    return true;
  }
}
function _environmentReferrerContext(destination = "") {
  const context = {
    url: globalThis.location?.href || "",
    policy: _environmentReferrerPolicy(),
    root: _environmentDocumentRoot(),
  };
  // The op argument list is already at deno_core's limit, so keep the
  // browser-owned destination in this internal context rather than exposing
  // a page-settable Sec-Fetch-* header.
  if (destination) context.destination = destination;
  return JSON.stringify(context);
}

// Dynamic script insertion happens after the Rust parser scheduler, so it has
// to enforce the owning document's script policy at the DOM sink itself.
// Keep this helper deliberately small and URL-based: the full CSP parser lives
// in the browser crate, while this path only needs the script source-list and
// nonce checks before scheduling a fetch/evaluation task.
function _dynamicScriptCspAllows(script, resolvedUrl, inline) {
  if (!_environmentAllowsScripts()) return false;
  let header = '';
  try {
    const root = _environmentDocumentRoot();
    const raw = Deno.core.ops.op_dom('document_scope_info', String(root), '');
    const info = raw && JSON.parse(raw);
    header = info && info.csp || '';
  } catch (_) {}
  if (!header) return true;
  const directives = header.split(';').map(part => part.trim().split(/\s+/));
  let sources = null;
  for (const name of ['script-src-elem', 'script-src', 'default-src']) {
    const found = directives.find(tokens => tokens[0]?.toLowerCase() === name);
    if (found) { sources = found.slice(1); break; }
  }
  if (!sources) return true;
  const nonce = script && script.getAttribute && script.getAttribute('nonce');
  if (nonce && sources.some(source => {
    const lower = source.toLowerCase();
    return lower.startsWith("'nonce-") && lower.endsWith("'")
      && source.slice(7, -1) === nonce;
  })) return true;
  if (inline) {
    if (sources.some(source => source.toLowerCase() === "'unsafe-inline'")) return true;
    return false;
  }
  let target;
  let documentUrl;
  try {
    documentUrl = new URL(globalThis.location?.href || 'about:blank');
    target = new URL(resolvedUrl, documentUrl.href);
  } catch (_) { return false; }
  return sources.some(source => {
    const token = source.toLowerCase();
    if (token === "'none'") return false;
    if (token === '*') return ['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol);
    if (token === 'data:') return target.protocol === 'data:';
    if (token === 'blob:') return target.protocol === 'blob:';
    if (token.endsWith(':') && !token.includes('/')) return target.protocol === token;
    if (token === "'self'") return target.origin === documentUrl.origin;
    let sourceUrl;
    try { sourceUrl = new URL(source.includes('://') ? source : documentUrl.protocol + '//' + source); }
    catch (_) { return false; }
    if (sourceUrl.protocol !== target.protocol || sourceUrl.port !== target.port) return false;
    const host = sourceUrl.hostname;
    return host.startsWith('*.')
      ? target.hostname.endsWith(host.slice(1)) && target.hostname !== host.slice(2)
      : target.hostname === host;
  });
}

function _inlineEventHandlerCspAllows() {
  if (!_environmentAllowsScripts()) return false;
  let header = '';
  try {
    const root = _environmentDocumentRoot();
    const raw = Deno.core.ops.op_dom('document_scope_info', String(root), '');
    const info = raw && JSON.parse(raw);
    header = info && info.csp || '';
  } catch (_) {}
  if (!header) return true;
  let attr = null, script = null, fallback = null;
  for (const directive of header.split(';')) {
    const tokens = directive.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (name === 'script-src-attr' && attr === null) attr = tokens;
    else if (name === 'script-src' && script === null) script = tokens;
    else if (name === 'default-src' && fallback === null) fallback = tokens;
  }
  const sources = attr || script || fallback;
  return !sources || sources.some(source => source.toLowerCase() === "'unsafe-inline'");
}

async function __fetchDynClassicScript(task) {
  let body;
  if (task.url.startsWith('data:')) {
    body = _decodeDataScriptUrl(task.url);
  } else {
    // A `data:` script has no network request behind it and therefore no
    // Resource Timing entry, so only this branch files one.
    const fetchStart = performance.now();
    const raw = await Deno.core.ops.op_fetch_url(
      task.url, "GET", "{}", "", task.pageOrigin,
      task.requestMode || "no-cors", task.requestCredentials || "include",
      _environmentReferrerContext("script")
    );
    const parsed = JSON.parse(raw);
    // A browser records the response before deciding whether it is executable,
    // so a 404 script still appears in the timeline.
    _recordFetchResourceTiming(
      { ...parsed, url: parsed.url || task.url }, 'script', fetchStart, task.pageOrigin,
      String(parsed.body || '').length);
    // The HTML script-fetch algorithm treats an unsuccessful HTTP response
    // as a network error. Evaluating its response body is both observably
    // unlike browsers and dangerous: JSON error payloads and diagnostic HTML
    // must never become script source.
    if (!(parsed.status >= 200 && parsed.status <= 299)) {
      throw new Error('HTTP ' + (parsed.status || 0));
    }
    body = parsed.body;
  }
  return body;
}
function __startDynClassicFetch(task) {
  // Attach both reactions immediately. An in-order script may finish fetching
  // before an earlier queue member; retaining a settled value avoids an
  // unhandled-rejection report while its execution turn is still blocked.
  task.fetchResult = __fetchDynClassicScript(task).then(
    body => ({ body }),
    error => ({ error }),
  );
}
// Run a classic script body under its own script name.
//
// Indirect eval would be the obvious way to get global-scope evaluation, but
// V8 stamps every frame of an eval'd script with its eval origin, so a stack
// captured inside the script reads
//   at ki (eval at execute (<obscura:bootstrap>:374:28), <anonymous>:1:19216)
// where a browser gives
//   at ki (https://cdn.example/api.js:1:19216)
// The engine's own file name therefore travels inside any stack the page
// collects -- and challenge scripts do collect them and post them home.
// op_run_classic_script compiles with a real script origin in the calling
// realm, which removes the eval annotation and gives the script its URL.
// Global-scope semantics (a top-level `var` becoming a property of the global
// object) are unchanged. `Deno.core.evalContext` is not the answer here: it
// gives a clean origin but always evaluates in the main realm, so a frame's
// script would define its globals on the embedder.
function __runClassicScript(source, url) {
  const thrown = Deno.core.ops.op_run_classic_script(source, url || "about:blank", globalThis);
  if (thrown.length) throw thrown[0];
}

async function __runDynScriptTask(task) {
  try {
    if (task.isModule) {
      await import(task.url);
    } else {
      if (!task.fetchResult) __startDynClassicFetch(task);
      const fetched = await task.fetchResult;
      if (fetched.error) throw fetched.error;
      const body = fetched.body;
      if (body) {
        // A fetched async script is executed by a ScriptRunner task, not by
        // the fetch promise's microtask continuation. Besides matching event
        // loop ordering, this prevents a batch of concurrently completed
        // third-party scripts from being charged to (and pinning) whichever
        // parser script happened to trigger the microtask checkpoint.
        await new Promise(resolve => {
          const execute = () => {
            globalThis.__currentScriptNid = task.nid;
            try { __runClassicScript(body, task.url); }
            catch(e) { console.error('Dynamic script error (' + task.url + '):', e.message); }
            finally { globalThis.__currentScriptNid = task.prevNid || 0; }
            resolve();
          };
          if (_scheduleAfter(0, execute) === undefined) execute();
        });
      }
    }
    // Fire load via dispatchEvent only: it invokes the element's onload
    // property handler and any addEventListener('load') listeners, read live
    // off the element. Calling onload separately would double-fire it.
    try { task.dispatchEvent(new Event('load')); } catch(e) {}
  } catch(e) {
    console.error('Dynamic script fetch error:', e.message);
    try { task.dispatchEvent(new Event('error')); } catch(ex) {}
  } finally {
    if (task.delaysLoad) {
      task.delaysLoad = false;
      __dynLoadDelayingPending = Math.max(0, __dynLoadDelayingPending - 1);
    }
  }
}
async function __runAsyncClassicScript(task) {
  __dynClassicPending++;
  try {
    await __runDynScriptTask(task);
  } finally {
    __dynClassicPending--;
  }
}
async function __processDynScriptQueue() {
  if (__dynScriptBusy) return;
  __dynScriptBusy = true;
  // try/finally so the busy flag is always cleared even if a task throws
  // outside its own guard; otherwise the queue would wedge and silently
  // block every later module or explicitly in-order script on the page.
  try {
    while (__dynScriptQueue.length > 0) {
      await __runDynScriptTask(__dynScriptQueue.shift());
    }
  } finally {
    __dynScriptBusy = false;
  }
}
// Resolve a resource URL (script src / link href) against <base href> or the
// document URL, the way the inline dynamic-script path does. Guarded so a bad
// base or href never throws into appendChild.
function _resolveResourceUrl(src) {
  let baseHref = null;
  try {
    baseHref = _internalBaseHref(globalThis.document);
  } catch(e) { baseHref = null; }
  const docUrl = globalThis.location?.href || 'http://localhost/';
  let baseUrl;
  try { baseUrl = baseHref ? new URL(baseHref, docUrl).href : docUrl; }
  catch(e) { baseUrl = docUrl; }
  if (baseHref && !_cspBaseUriAllows(baseUrl)) baseUrl = docUrl;
  try {
    return src.startsWith('http') || src.startsWith('data:')
      ? src
      : new URL(src, baseUrl).href;
  } catch(e) { return src; }
}

const _linkedStylesheetNodes = new WeakMap();
const _linkElementSheets = new WeakMap();

function _linkedStylesheetHref(link, explicitHref) {
  const raw = explicitHref || link?.getAttribute?.("href") || link?.href || "";
  return raw ? _resolveResourceUrl(String(raw)) : "";
}

function _linkedStylesheetIsOriginClean(href) {
  try {
    const documentUrl = new URL(globalThis.document?.URL || globalThis.location?.href || "about:blank");
    const stylesheetUrl = new URL(href, documentUrl.href);
    return stylesheetUrl.origin === documentUrl.origin;
  } catch(e) {
    // An unresolved relative URL in an about:blank-style synthetic document
    // has no distinct remote origin and is safe to expose.
    return !/^[a-z][a-z0-9+.-]*:/i.test(String(href || ""));
  }
}

function _registerLinkedStylesheet(link, sourceNode, explicitHref) {
  if (!link || !sourceNode) return null;
  const href = _linkedStylesheetHref(link, explicitHref);
  _linkedStylesheetNodes.set(link, sourceNode);
  let sheet = _linkElementSheets.get(link);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    _linkElementSheets.set(link, sheet);
  }
  sheet._bindLinkedOwner(link, sourceNode, href, _linkedStylesheetIsOriginClean(href));
  return sheet;
}
globalThis.__obscura_registerLinkedStylesheet = _registerLinkedStylesheet;

// A fetched sheet becomes an inline <style>, so relative url() references
// must keep resolving against the stylesheet URL rather than document.URL.
// Scan instead of using a regexp: data URLs and quoted URLs can contain
// parentheses, quotes, and whitespace.
function _rebaseCssUrls(css, baseUrl) {
  let out = "";
  let i = 0;
  let quote = "";
  let comment = false;
  while (i < css.length) {
    if (comment) {
      if (css[i] === "*" && css[i + 1] === "/") {
        out += "*/"; i += 2; comment = false;
      } else {
        out += css[i++];
      }
      continue;
    }
    if (quote) {
      const ch = css[i++];
      out += ch;
      if (ch === "\\" && i < css.length) out += css[i++];
      else if (ch === quote) quote = "";
      continue;
    }
    if (css[i] === "/" && css[i + 1] === "*") {
      out += "/*"; i += 2; comment = true; continue;
    }
    if (css[i] === '"' || css[i] === "'") {
      quote = css[i]; out += css[i++]; continue;
    }
    if (css.slice(i, i + 4).toLowerCase() !== "url(") {
      out += css[i++]; continue;
    }
    let end = i + 4;
    let innerQuote = "";
    while (end < css.length) {
      const ch = css[end];
      if (innerQuote) {
        if (ch === "\\") { end += 2; continue; }
        if (ch === innerQuote) innerQuote = "";
      } else if (ch === '"' || ch === "'") {
        innerQuote = ch;
      } else if (ch === ")") {
        break;
      }
      end++;
    }
    if (end >= css.length) {
      out += css.slice(i);
      break;
    }
    const raw = css.slice(i + 4, end).trim();
    const value = raw.length >= 2
      && ((raw[0] === '"' && raw[raw.length - 1] === '"')
        || (raw[0] === "'" && raw[raw.length - 1] === "'"))
      ? raw.slice(1, -1)
      : raw;
    let resolved = value;
    if (value && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) {
      try { resolved = new URL(value, baseUrl).href; } catch(e) {}
    }
    out += `url("${resolved.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
    i = end + 1;
  }
  return out;
}

function _cssImportApplies(media) {
  const compact = media.replace(/\s+/g, "").toLowerCase();
  if (!compact) return true;
  if (compact.includes("prefers-color-scheme:dark")) return false;
  if (compact.includes("print")
    && !compact.includes("screen")
    && !compact.includes("all")) return false;
  if (compact.includes("min-width") || compact.includes("max-width")
      || compact.includes("prefers-")) {
    try { return matchMedia(media).matches; } catch(e) {}
  }
  return true;
}

async function _fetchLinkedCss(url, pageOrigin, depth = 0, seen = new Set()) {
  if (depth > 4 || seen.has(url)) return "";
  // A dynamically inserted stylesheet is governed by the creator document's
  // style-src policy, not connect-src alone. Check every import as well as the
  // root link so an imported sheet cannot bypass the same policy.
  if (!_cspResourceAllows(url, 'style-src')) {
    throw new DOMException(
      "Refused to load the stylesheet '" + url + "' because it violates the document's Content Security Policy.",
      'SecurityError');
  }
  seen.add(url);
  const raw = await Deno.core.ops.op_fetch_url(
    url, "GET", "{}", "", pageOrigin, "no-cors", "same-origin",
    _environmentReferrerContext("style")
  );
  const parsed = JSON.parse(raw);
  if (parsed.blocked || parsed.status >= 400 || parsed.status === 0) {
    throw new Error("Stylesheet fetch failed: " + url);
  }
  let css = parsed.body || "";
  const imports = [];
  // @import is only valid before ordinary rules. Removing it here lets the
  // renderer consume the imported rules from the materialized <style>.
  css = css.replace(
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"\s;)]+))\s*\)?\s*([^;]*);/gi,
    (statement, doubleQuoted, singleQuoted, bare, media) => {
      const target = doubleQuoted || singleQuoted || bare || "";
      if (_cssImportApplies(media || "")) {
        try {
          const importUrl = new URL(target, url).href;
          if (_cspResourceAllows(importUrl, 'style-src')) imports.push(importUrl);
        } catch(e) {}
      }
      return "";
    }
  );
  const imported = await Promise.all(imports.map(importUrl =>
    _fetchLinkedCss(importUrl, pageOrigin, depth + 1, new Set(seen))
  ));
  imported.push(_rebaseCssUrls(css, url));
  return imported.filter(Boolean).join("\n");
}

// A dynamically-inserted <link rel="stylesheet" href> must fetch, enter the
// live cascade, and then fire load. Framework route chunks commonly await this
// event before revealing their content; firing it while discarding the CSS
// left the DOM loaded but unstyled. Issue #409.
async function _loadLinkedStylesheet(c) {
  // obscura does not yet reflect the `rel` IDL attribute back to the content
  // attribute, so `link.rel = "stylesheet"` leaves getAttribute('rel') null.
  // Read both so the property-assignment form (the common framework pattern)
  // and the parsed-from-HTML form are both recognized.
  const rel = (c.getAttribute('rel') || c.rel || '').toString().toLowerCase();
  if (!rel.split(/\s+/).includes('stylesheet')) return;
  const href = c.getAttribute('href');
  if (!href) return;
  const fullUrl = _resolveResourceUrl(href);
  let pageOrigin = "";
  try {
    const root = _environmentDocumentRoot();
    const scope = _domParse("document_scope_info", root) || {};
    pageOrigin = scope.origin || new URL(globalThis.document?.URL || globalThis.location?.href || "about:blank").origin;
  } catch(e) {
    try { pageOrigin = new URL(globalThis.location?.href || "about:blank").origin; } catch (_) {}
  }
  try {
    const css = await _fetchLinkedCss(fullUrl, pageOrigin);
    const previous = _linkedStylesheetNodes.get(c);
    if (previous?.parentNode) previous.parentNode.removeChild(previous);
    const media = c.getAttribute("media") || "";
    const style = document.createElement("style");
    style.setAttribute("data-obscura-linked", fullUrl);
    style.textContent = css;
    _registerLinkedStylesheet(c, style, fullUrl);
    if (c.parentNode && !c.disabled && _cssImportApplies(media)) {
      c.parentNode.insertBefore(style, c.nextSibling);
    }
    try { c.dispatchEvent(new Event('load', { bubbles: true })); } catch(e) {}
  } catch(e) {
    try { c.dispatchEvent(new Event('error', { bubbles: true })); } catch(e) {}
  }
}

function _fpRand(salt) {
  let h = (_fpSeed ^ (salt || 0)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
}
function _fpNoise(x, y, channel) {
  return (_fpRand(x * 7919 + y * 6271 + channel * 8923) - 0.5) * 4;
}

var _fpCache = null;
function _fingerprint() {
  return globalThis.__obscura_fingerprint || {
    userAgent: '', language: 'en-US', languages: ['en-US', 'en'], browserVersion: '', browserMajor: 0,
    navigatorPlatform: '', uaPlatform: '', uaPlatformVersion: '',
    architecture: '', bitness: '', wow64: false, mobile: false, model: '',
    brands: [], fullVersionList: [], hardwareConcurrency: 8, deviceMemory: 8,
    screen: {width:1920,height:1080,availWidth:1920,availHeight:1080,deviceScaleFactor:1},
    gpu: {vendor:'',renderer:''},
  };
}
globalThis.__obscura_set_fingerprint = function(value) {
  if (!value || typeof value !== 'object') return;
  const language = String(value.language || 'en-US');
  const suppliedLanguages = Array.isArray(value.languages)
    ? value.languages.map(item => String(item || '')).filter(Boolean)
    : [];
  const languages = Object.freeze(suppliedLanguages.length ? suppliedLanguages : [language]);
  const freezeBrands = list => Object.freeze((Array.isArray(list) ? list : []).map(item =>
    Object.freeze({brand:String(item && item.brand || ''),version:String(item && item.version || '')})
  ));
  const installed = Object.assign({}, value, {
    language,
    languages,
    brands: freezeBrands(value.brands),
    fullVersionList: freezeBrands(value.fullVersionList),
    screen: Object.freeze(Object.assign({}, value.screen)),
    gpu: Object.freeze(Object.assign({}, value.gpu)),
  });
  globalThis.__obscura_fingerprint = Object.freeze(installed);
  _fpCache = null;
  if (typeof globalThis.__obscura_apply_fingerprint === 'function') {
    globalThis.__obscura_apply_fingerprint();
  }
};
function _getFp() {
  if (_fpCache) return _fpCache;
  const fingerprint = _fingerprint();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let cfp = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
  for (let i = 0; i < 40; i++) cfp += chars[Math.floor(_fpRand(500 + i) * 64)];
  cfp += '==';
  _fpCache = {
    gpu: String(fingerprint.gpu && fingerprint.gpu.renderer || ''),
    gpuVendor: String(fingerprint.gpu && fingerprint.gpu.vendor || ''),
    audioBaseLatency: 0.002 + _fpRand(100) * 0.008,
    audioSampleRate: [44100, 48000][Math.floor(_fpRand(101) * 2)],
    compThreshold: -24 + (_fpRand(102) - 0.5) * 4,
    compKnee: 30 + (_fpRand(103) - 0.5) * 4,
    compRatio: 12 + (_fpRand(104) - 0.5) * 4,
    batteryLevel: 0.5 + _fpRand(200) * 0.5,
    batteryCharging: _fpRand(201) > 0.3,
    screen: [Number(fingerprint.screen && fingerprint.screen.width) || 1920,
      Number(fingerprint.screen && fingerprint.screen.height) || 1080],
    canvasFingerprint: cfp,
  };
  return _fpCache;
}
function _fp(key) { return _getFp()[key]; }
globalThis._eventRegistry = globalThis._eventRegistry || {};
globalThis._formValues = globalThis._formValues || {};
const _eventRegistry = globalThis._eventRegistry;
const _formValues = globalThis._formValues;
const _domParse = (cmd, a1, a2) => { try { return JSON.parse(_dom(cmd, a1, a2)); } catch { return null; } };

