// CDATASection: a Text-derived node (nodeType 4) used only in XML documents.
// Extends Text so data/length/textContent/childNodes reuse the working text
// node machinery; only the type-identifying getters differ.


// ProcessingInstruction: nodeType 7, nodeName === target. Extends CharacterData
// and carries a separate target. Backed by a text node so data/nodeValue/
// textContent/length work without native PI support.


// Document character encoding (WHATWG canonical name, e.g. "UTF-8", "EUC-JP").
// Cached per runtime: the encoding is fixed for a document's lifetime and this
// is read on every <a>/<area> URL-component access, so the UTF-8 common case
// must reduce to a single cached-boolean read with no op call and no allocation.
let __docEncoding;
let __docIsUtf8;
function _docEncoding() {
  if (__docEncoding === undefined) {
    const e = _domParse("document_encoding");
    __docEncoding = (typeof e === 'string' && e) ? e : 'UTF-8';
    __docIsUtf8 = __docEncoding.toLowerCase() === 'utf-8';
  }
  return __docEncoding;
}
function _docIsUtf8() { if (__docIsUtf8 === undefined) _docEncoding(); return __docIsUtf8; }
// WHATWG "special scheme" check (these get the special-query percent-encode set).
function _isSpecialScheme(protocol) {
  const s = (protocol || '').replace(/:$/, '').toLowerCase();
  return s === 'http' || s === 'https' || s === 'ws' || s === 'wss' || s === 'ftp' || s === 'file';
}
// Apply the WHATWG URL "encoding override": in a legacy (non-UTF-8) document
// the query of an <a>/<area> href is percent-encoded in the document charset,
// not UTF-8. The url op already produced a UTF-8-encoded query; recover the
// original characters (percent-decode + UTF-8) and re-encode them through the
// document charset. Pure-ASCII queries round-trip unchanged.
function _applyDocQueryEncoding(u) {
  if (!u || !u.search || u.search.length < 2) return u;
  let decoded;
  try { decoded = decodeURIComponent(u.search.slice(1)); } catch (e) { return u; }
  let reencoded;
  try { reencoded = Deno.core.ops.op_url_encode_query(decoded, _docEncoding(), _isSpecialScheme(u.protocol)); }
  catch (e) { return u; }
  const newSearch = '?' + reencoded;
  if (newSearch === u.search) return u;
  const hashIdx = u.href.indexOf('#');
  const frag = hashIdx >= 0 ? u.href.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? u.href.slice(0, hashIdx) : u.href;
  const qIdx = beforeHash.indexOf('?');
  u.href = (qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash) + newSearch + frag;
  u.search = newSearch;
  return u;
}

// HTMLHyperlinkElementUtils helpers (the <a>/<area> URL-decomposition members).
// The element's href attribute is parsed against the document base URL via the
// WHATWG url op; component getters read it, setters rewrite the href attribute.
// This realm's document, not the top-level one: `document_url` is the Rust
// side's page URL, so links inside a frame resolved against the embedder.
function _anchorBase() {
  return globalThis.location?.href || _domParse("document_url") || "about:blank";
}
function _elemHrefURL(el) {
  const raw = el.getAttribute('href');
  if (raw === null || raw === undefined) return null;
  const u = _urlParseOp(raw, _anchorBase());
  if (u && !_docIsUtf8()) return _applyDocQueryEncoding(u);
  return u;
}
function _setElemHrefPart(el, part, value) {
  const u = _elemHrefURL(el);
  if (!u) return;
  const c = _urlSetOp(u.href, part, value);
  if (c) el.setAttribute('href', c.href);
}
