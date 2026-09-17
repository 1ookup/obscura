// Real-enough DOMParser. The previous one-liner returned `globalThis.document`,
// so anything that did `new DOMParser().parseFromString(s, 'text/html')` and
// then read `.body.innerHTML` mutated the LIVE page (jQuery 3.x's selector
// feature-detect writes `<form></form>` and wiped real bodies). We parse the
// input into a detached `<html>` element and wrap it so the common Document
// API surface (body / head / documentElement / querySelector* / getElementById /
// getElementsByTagName / getElementsByClassName / title / cloneNode) works.
// Conservative XML well-formedness check. obscura has no XML parser, so this
// only decides whether to surface a <parsererror> (it does not build an XML
// tree). It flags clear structural errors — mismatched or unclosed tags,
// multiple/no root elements, unterminated comment/CDATA/PI — and defaults to
// "well-formed" whenever the scan is ambiguous, so valid XML is never falsely
// flagged. Quoted attribute regions, comments, CDATA, PIs and the doctype are
// skipped; a literal '<' in text (invalid in XML) reads as a bad tag.
function _xmlWellFormed(src) {
  const s = String(src);
  const stack = [];
  let rootsClosed = 0; // top-level elements fully closed (or self-closed)
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) break;
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); if (e === -1) return false; i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) { const e = s.indexOf(']]>', i + 9); if (e === -1) return false; i = e + 3; continue; }
    if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i + 2); if (e === -1) return false; i = e + 2; continue; }
    if (s.startsWith('<!', i)) { const e = s.indexOf('>', i + 2); if (e === -1) return false; i = e + 1; continue; }
    // A start/end/self-closing tag: find its '>' while skipping quoted regions.
    let j = i + 1, quote = null;
    while (j < n) {
      const c = s[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    if (j >= n) return false; // unterminated tag
    const inner = s.slice(i + 1, j).trim();
    i = j + 1;
    if (!inner) return false;
    if (inner[0] === '/') {
      const name = inner.slice(1).trim().split(/\s/)[0];
      if (stack.length === 0 || stack[stack.length - 1] !== name) return false;
      stack.pop();
      if (stack.length === 0) rootsClosed++;
    } else if (inner[inner.length - 1] === '/') {
      if (stack.length === 0) rootsClosed++;
    } else {
      const name = inner.split(/\s/)[0];
      if (!name) return false;
      stack.push(name);
    }
  }
  return stack.length === 0 && rootsClosed === 1;
}

const _detachedDocumentPrototypeMethods = new Set([
  "createTreeWalker", "createNodeIterator", "querySelector", "querySelectorAll",
  "getElementById", "getElementsByTagName", "getElementsByClassName",
  "getElementsByName", "createElement", "createElementNS", "createTextNode",
  "createComment", "createDocumentFragment", "createRange", "createEvent",
  "createCDATASection", "createProcessingInstruction", "adoptNode", "importNode",
  "addEventListener", "removeEventListener", "dispatchEvent",
  "contains", "hasChildNodes", "compareDocumentPosition", "getRootNode",
  "isEqualNode", "isSameNode",
]);
