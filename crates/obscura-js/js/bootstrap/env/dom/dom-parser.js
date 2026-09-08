globalThis.DOMParser = class DOMParser {
  parseFromString(source, mimeType) {
    const html = String(source ?? "");
    const isXml = typeof mimeType === "string" && /xml/i.test(mimeType);
    const root = document.createElement("html");
    // innerHTML parses children via html5ever fragment-parsing rules. Most
    // HTML inputs start with `<!DOCTYPE>` / `<html>` / `<head>` etc.; the
    // fragment parser strips the outer `<html>` and emits its head+body
    // children, which is what callers want.
    try { root.innerHTML = html; } catch (e) { /* leave empty on parse error */ }

    // For XML mime types, surface a <parsererror> on clearly-malformed input so
    // error-detection code (doc.querySelector('parsererror')) works, matching
    // Chrome. obscura has no XML parser, so the tree stays HTML-parsed.
    if (isXml && !_xmlWellFormed(html)) {
      try {
        root.innerHTML = '<parsererror xmlns="http://www.w3.org/1999/xhtml">This page contains the following errors:<div>error while parsing XML</div></parsererror>';
      } catch (e) { /* ignore */ }
    }

    // Helper: depth-first walk to find an element by predicate.
    const walk = (node, pred) => {
      if (!node) return null;
      if (node.nodeType === 1 && pred(node)) return node;
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        const r = walk(children[i], pred);
        if (r) return r;
      }
      return null;
    };

    const findByTagName = (name) => walk(root, n => n.tagName === name);

    // `innerHTML` above is a fragment parse, while DOMParser's text/html mode
    // parses a complete document. Normalize the fragment result into the
    // document skeleton the full parser always creates, and place loose nodes
    // where the HTML tree builder would put them.
    if (!isXml) {
      const directChild = (name) => {
        const children = root.children || [];
        for (let i = 0; i < children.length; i++) {
          if (children[i].tagName === name) return children[i];
        }
        return null;
      };
      const looseNodes = Array.from(root.childNodes || []);
      let head = directChild("HEAD");
      let body = directChild("BODY");
      if (!head) {
        head = document.createElement("head");
        root.insertBefore(head, body || root.firstChild);
      }
      if (!body) {
        body = document.createElement("body");
        root.appendChild(body);
      }
      const headNames = new Set([
        "BASE", "BASEFONT", "BGSOUND", "LINK", "META", "NOFRAMES",
        "SCRIPT", "STYLE", "TEMPLATE", "TITLE",
      ]);
      let bodyStarted = (body.childNodes || []).length > 0;
      for (const node of looseNodes) {
        if (node === head || node === body) continue;
        const headNode = !bodyStarted && node.nodeType === 1
          && headNames.has(node.tagName);
        if (headNode) {
          head.appendChild(node);
          continue;
        }
        if (node.nodeType !== 3 || /\S/.test(node.textContent || "")) {
          bodyStarted = true;
        }
        body.appendChild(node);
      }
    }

    let exposedDocument = null;
    const docNode = {
      _root: root,
      nodeName: "#document",
      nodeType: 9,
      contentType: isXml ? (mimeType || "application/xml") : "text/html",
      get documentElement() { return root; },
      get body() { return findByTagName("BODY"); },
      get head() { return findByTagName("HEAD"); },
      get title() {
        const t = findByTagName("TITLE");
        return t ? (t.textContent || "").replace(/[\t\n\f\r ]+/g, " ").trim() : "";
      },
      set title(value) {
        let t = findByTagName("TITLE");
        if (!t) {
          let head = findByTagName("HEAD");
          if (!head) {
            head = document.createElement("head");
            root.insertBefore(head, findByTagName("BODY"));
          }
          t = document.createElement("title");
          head.appendChild(t);
        }
        t.textContent = String(value);
      },
      get firstChild() { return root; },
      get lastChild() { return root; },
      get children() { return [root]; },
      get childNodes() { return [root]; },
      // Document metadata the WHATWG interface exposes; DOMParser documents have
      // URL about:blank, are already fully parsed, and carry no stylesheets.
      get URL() { return "about:blank"; },
      get documentURI() { return "about:blank"; },
      get domain() { return _incumbentDocumentDomain(); },
      set domain(value) { String(value); _throwDocumentDomainSecurityError(); },
      get referrer() { return ""; },
      get baseURI() { return "about:blank"; },
      get compatMode() { return "CSS1Compat"; },
      get characterSet() { return "UTF-8"; },
      get charset() { return "UTF-8"; },
      get inputEncoding() { return "UTF-8"; },
      get readyState() { return "complete"; },
      get styleSheets() { return { length: 0, item() { return null; }, [Symbol.iterator]: function* () {} }; },
      get defaultView() { return null; },
      get ownerDocument() { return null; },
      createTreeWalker(r, ws, f) { return document.createTreeWalker(r || root, ws, f); },
      createNodeIterator(r, ws, f) { return document.createNodeIterator(r || root, ws, f); },
      querySelector(s) { return root.querySelector(s); },
      querySelectorAll(s) { return root.querySelectorAll(s); },
      getElementById(id) {
        return walk(root, n => n.getAttribute && n.getAttribute("id") === id);
      },
      getElementsByTagName(t) {
        return root.querySelectorAll(t);
      },
      getElementsByClassName(c) {
        return _getElementsByClassName(root, c);
      },
      getElementsByName(n) {
        return root.querySelectorAll(`[name="${n}"]`);
      },
      createElement: (t) => _stampDetachedDocumentNode(exposedDocument, document.createElement(t)),
      createElementNS: (ns, t) => _stampDetachedDocumentNode(exposedDocument, document.createElementNS(ns, t)),
      createTextNode: (t) => _stampDetachedDocumentNode(exposedDocument, document.createTextNode(t)),
      createComment: (t) => _stampDetachedDocumentNode(exposedDocument, document.createComment(t)),
      createDocumentFragment: () => _stampDetachedDocumentNode(exposedDocument, document.createDocumentFragment()),
      createRange: () => new Range(),
      createEvent: (type) => document.createEvent(type),
      createCDATASection: (data) => {
        if (mimeType === "text/html") throw new DOMException("createCDATASection is not supported in HTML documents", "NotSupportedError");
        const s = String(data);
        if (s.indexOf("]]>") !== -1) throw new DOMException("CDATA section data must not contain ']]>'", "InvalidCharacterError");
        return _stampDetachedDocumentNode(
          exposedDocument, new CDATASection(+_dom("create_text_node", s)));
      },
      createProcessingInstruction: (target, data) => {
        const t = String(target), s = String(data);
        if (!_isValidPITarget(t)) throw new DOMException("Invalid processing instruction target", "InvalidCharacterError");
        if (s.indexOf("?>") !== -1) throw new DOMException("Processing instruction data must not contain '?>'", "InvalidCharacterError");
        return _stampDetachedDocumentNode(
          exposedDocument, new ProcessingInstruction(+_dom("create_text_node", s), t));
      },
      adoptNode: (n) => n,
      importNode: (n) => n,
      // Document-level node insertion. Detached docs from createHTMLDocument /
      // createDocument back onto the same tree, so appending lands under the
      // documentElement; enough for dom/common.js to build its Range fixtures.
      appendChild: function (n) { try { root.appendChild(n); } catch (e) {} return n; },
      removeChild: function (n) { try { root.removeChild(n); } catch (e) {} return n; },
      insertBefore: function (n, ref) { try { root.insertBefore(n, ref); } catch (e) {} return n; },
      _docType: null,
      get doctype() { return this._docType; },
      cloneNode: function (deep) {
        return new DOMParser().parseFromString(root.outerHTML, mimeType);
      },
      contains(n) { return root.contains ? root.contains(n) : false; },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    };
    _detachedDocumentBrand.add(docNode);
    const prototype = isXml
      ? globalThis.XMLDocument?.prototype
      : globalThis.HTMLDocument?.prototype;
    if (prototype) Object.setPrototypeOf(docNode, prototype);
    Object.defineProperty(docNode, "location", {
      get() { return null; },
      set(_value) {},
      enumerable: true,
      configurable: false,
    });
    exposedDocument = new Proxy(docNode, {
      get(target, key, receiver) {
        if (_detachedDocumentPrototypeMethods.has(key)) {
          return Reflect.get(Document.prototype, key, receiver);
        }
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        return ["location", ...Reflect.ownKeys(target).filter(key => typeof key === "symbol")];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "location" || typeof key === "symbol") {
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
        return undefined;
      },
    });
    _detachedDocumentBrand.add(exposedDocument);
    _detachedNodeOwners.set(exposedDocument, exposedDocument);
    _detachedNodeOwners.set(root, exposedDocument);
    _detachedRootOwners.set(root[_nidSym], exposedDocument);
    return exposedDocument;
  }
};
