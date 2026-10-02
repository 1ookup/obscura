// DOMImplementation, as the object `document.implementation` returns.
//
// Chrome answers a stable object per document -- `document.implementation ===
// document.implementation` is true -- whose prototype carries the four
// operations, and `Object.prototype.toString.call(...)` reads
// "[object DOMImplementation]". The engine built a fresh marked object
// literal on every read, so the tag answered "[object Object]", the members
// were own properties, and two reads were never equal (2026-09-28 oracle).
//
// The interface table installs the constructor shell; this module adds the
// operations to its prototype and hands out one instance per document. An
// instance's owner document lives in a WeakMap rather than on the object, so
// the own-property shape a page reflects over stays empty.
(function installDOMImplementationSurface() {
  const owners = new WeakMap();
  const perDocument = new WeakMap();
  let installed = false;

  const method = (name, length, fn) => {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (_e) {}
    try { Object.defineProperty(fn, 'length', { value: length, configurable: true }); } catch (_e) {}
    return _markNative(fn);
  };
  const ownerOf = receiver => {
    const owner = owners.get(receiver);
    if (!owner) throw new TypeError('Illegal invocation @env/dom/dom-implementation.js:26');
    return owner;
  };

  function install() {
    // The constructor shell comes from the interface table in
    // config/surface-finalize.js, which runs after every module; the members
    // are attached on first use instead of at module time.
    const constructor = globalThis.DOMImplementation;
    if (typeof constructor !== 'function' || !constructor.prototype) return false;
    const prototype = constructor.prototype;
    if (Object.prototype.hasOwnProperty.call(prototype, 'createDocument')) {
      installed = true;
      return true;
    }
    const createHTMLDocument = method('createHTMLDocument', 0, function (title) {
      // Spec: a NEW detached document. jQuery 3.x's selector feature-detect
      // calls `body.innerHTML = '<form>'` on the result -- when this returned
      // `globalThis.document`, the real `<body>` was wiped, taking every page
      // that ships jQuery 3.x with it. DOMParser builds the complete detached
      // skeleton, so only the optional title is added here.
      void ownerOf(this);
      // Engine-internal parse: Chrome's createHTMLDocument takes no markup and
      // is not a Trusted Types sink, so it must not route through
      // parseFromString's argument check.
      const doc = _internalMarkupParse('', 'text/html');
      if (arguments.length > 0) {
        const titleEl = doc.createElement('title');
        titleEl.textContent = String(title);
        doc.head.appendChild(titleEl);
      }
      return doc;
    });
    const createDocument = method('createDocument', 3, function (namespaceURI, qualifiedName, doctype) {
      void namespaceURI;
      void ownerOf(this);
      // The engine has no separate XML stack: a minimal detached document
      // with an element of the requested local name as its documentElement.
      const name = (qualifiedName && String(qualifiedName)) || 'root';
      const safe = name.replace(/[^a-zA-Z0-9-]/g, '');
      const html = qualifiedName ? `<${safe}></${safe}>` : '';
      const doc = _internalMarkupParse(html, 'application/xml');
      if (doctype) _hset(doc, '_docType', doctype);
      return doc;
    });
    const createDocumentType = method('createDocumentType', 3, function (qualifiedName, publicId, systemId) {
      const ownerDocument = ownerOf(this);
      // Browsers validate leniently here (only a name with ASCII whitespace or
      // ">" is rejected, matching the WPT cases); the node's owner document is
      // the document whose implementation was used.
      const name = String(qualifiedName);
      if (name === '' || /[\t\n\f\r >]/.test(name)) {
        throw new DOMException("The qualified name '" + name + "' contains an invalid character", 'InvalidCharacterError');
      }
      const doctype = new DocumentType(
        +_dom('create_comment_node', ''),
        name,
        publicId === undefined ? '' : String(publicId),
        systemId === undefined ? '' : String(systemId),
      );
      _hset(doctype, '_ownerDocument', ownerDocument);
      return doctype;
    });
    const hasFeature = method('hasFeature', 0, function () {
      void ownerOf(this);
      return true;
    });
    for (const [name, value] of [['createDocument', createDocument],
                                 ['createDocumentType', createDocumentType],
                                 ['createHTMLDocument', createHTMLDocument],
                                 ['hasFeature', hasFeature]]) {
      Object.defineProperty(prototype, name, {
        value, writable: true, enumerable: true, configurable: true,
      });
    }
    // Chrome lists the operations before `constructor` on this prototype.
    const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    if (constructorDescriptor) {
      delete prototype.constructor;
      Object.defineProperty(prototype, 'constructor', constructorDescriptor);
    }
    installed = true;
    return true;
  }

  // One implementation per document, as in Chrome.
  globalThis.__obscura_implementation_for = function (document) {
    if (!installed && !install()) {
      return _markNativeObject({});
    }
    let implementation = perDocument.get(document);
    if (!implementation) {
      implementation = Object.create(globalThis.DOMImplementation.prototype);
      owners.set(implementation, document);
      perDocument.set(document, implementation);
    }
    return implementation;
  };
})();
