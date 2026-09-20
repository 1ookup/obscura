// Collection behavior shared by HTMLCollection, NodeList, and Document.
// Constructors remain in env/dom/html-collection.js and node-list.js; this
// support module owns their private state and live collection factories.
const _htmlCollectionKey = Symbol('HTMLCollection');
const _htmlCollectionValues = new WeakMap();
function _htmlCollectionData(value) {
  const held = _htmlCollectionValues.get(value);
  if (!held) throw new TypeError('Illegal invocation');
  const values = typeof held === 'function' ? held() : held;
  return Array.from(values || []).filter(Boolean);
}
function _htmlCollectionFrom(source) {
  const values = typeof source === 'function'
    ? source
    : Array.from(source || []).filter(Boolean);
  const target = new HTMLCollection(_htmlCollectionKey, values);
  const collection = new Proxy(target, _htmlCollectionProxy);
  _htmlCollectionValues.set(collection, values);
  return collection;
}
// Shared traps keep indexed and named access live without shadowing item() or
// namedItem(). The proxy is allocated per collection, but this trap object is
// shared to avoid a closure per DOM query.
const _htmlCollectionProxy = {
  get(t, key, receiver) {
    if (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)) {
      return _htmlCollectionData(receiver)[Number(key)];
    }
    const value = Reflect.get(t, key, receiver);
    if (value !== undefined || typeof key !== 'string') return value;
    return t.namedItem ? (t.namedItem(key) || undefined) : undefined;
  },
  has(t, key) {
    if (Reflect.has(t, key)) return true;
    if (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)) {
      return Number(key) < _htmlCollectionData(t).length;
    }
    return typeof key === 'string' && !!(t.namedItem && t.namedItem(key));
  },
  ownKeys(t) {
    const values = _htmlCollectionData(t);
    const keys = values.map((_value, index) => String(index));
    const seen = new Set(keys);
    for (const element of values) {
      if (!element) continue;
      const names = [element.id];
      if (_isHTMLEl(element) && typeof element.getAttribute === 'function') {
        names.push(element.getAttribute('name'));
      }
      for (const name of names) {
        if (name && !seen.has(name)) { seen.add(name); keys.push(name); }
      }
    }
    return keys;
  },
  getOwnPropertyDescriptor(t, key) {
    if (typeof key !== 'string') return Reflect.getOwnPropertyDescriptor(t, key);
    const values = _htmlCollectionData(t);
    if (/^(?:0|[1-9]\d*)$/.test(key) && Number(key) < values.length) {
      // Chrome's platform indexed properties are enumerable own properties
      // (oracle, Chrome 153, non-empty collection: Object.keys -> ["0"],
      // JSON.stringify -> {"0":{}}), unlike length/item/namedItem which stay
      // off the instance.
      return { value: values[Number(key)], writable: false, enumerable: true, configurable: true };
    }
    const named = t.namedItem(key);
    if (named) return { value: named, writable: false, enumerable: false, configurable: true };
    return Reflect.getOwnPropertyDescriptor(t, key);
  },
};

const _documentCollectionState = new WeakMap();
function _documentCollection(document, name, provider) {
  let collections = _documentCollectionState.get(document);
  if (!collections) {
    collections = new Map();
    _documentCollectionState.set(document, collections);
  }
  if (!collections.has(name)) collections.set(name, _htmlCollectionFrom(provider));
  return collections.get(name);
}

function _isHTMLEl(element) {
  return !!element && (element.namespaceURI === undefined
    || element.namespaceURI === 'http://www.w3.org/1999/xhtml');
}

// NodeList is static and has no named access; this factory avoids allocating
// an Array subclass for every querySelectorAll/childNodes call. Like
// HTMLCollection the elements live in a WeakMap behind a shared-trap proxy so
// `list[0]` keeps working while the instance carries no own enumerable
// properties: Chrome answers {} for JSON.stringify(list) and [] for
// Object.keys(list) (oracle), not the index/length own props a JS array
// subclass would expose.
const _nodeListKey = Symbol('NodeList');
const _nodeListValues = new WeakMap();
function _nodeListData(value) {
  const held = _nodeListValues.get(value);
  if (!held) throw new TypeError('Illegal invocation');
  return held;
}
const _nodeListProxy = {
  get(t, key, receiver) {
    if (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)) {
      const v = _nodeListData(receiver)[Number(key)];
      return v != null ? v : null;
    }
    return Reflect.get(t, key, receiver);
  },
  has(t, key) {
    if (Reflect.has(t, key)) return true;
    return typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)
      && Number(key) < _nodeListData(t).length;
  },
  ownKeys(t) {
    return _nodeListData(t).map((_value, index) => String(index));
  },
  getOwnPropertyDescriptor(t, key) {
    if (typeof key !== 'string') return Reflect.getOwnPropertyDescriptor(t, key);
    const values = _nodeListData(t);
    if (/^(?:0|[1-9]\d*)$/.test(key) && Number(key) < values.length) {
      // Chrome's platform indexed properties are enumerable own properties
      // (oracle, Chrome 153, non-empty list: Object.keys -> ["0"],
      // JSON.stringify -> {"0":{}}); length is NOT an own key, which is what
      // distinguishes this shape from the old own-field implementation.
      return { value: values[Number(key)], writable: false, enumerable: true, configurable: true };
    }
    return Reflect.getOwnPropertyDescriptor(t, key);
  },
};

function _nodeList(elements) {
  const values = Array.from(elements || []).filter(Boolean);
  const target = new NodeList(_nodeListKey, values);
  const list = new Proxy(target, _nodeListProxy);
  _nodeListValues.set(list, values);
  return list;
}

globalThis.DOMTokenList = DOMTokenList;
