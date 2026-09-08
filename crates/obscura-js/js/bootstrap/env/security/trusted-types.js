})();

// Trusted Types (W3C). Chrome ships the entire surface; `window.trustedTypes`
// being undefined is a Firefox/Safari answer and contradicts every other
// Chrome signal this build sends, which is why the roadmap lists it (§3.2-#12).
//
// Implemented: the factory, policies, the three wrapper types with real brand
// checks, sink type tables, and the `trusted-types` policy-name allowlist.
// Sink enforcement (`require-trusted-types-for`) remains below the API layer.
(function _installTrustedTypes() {
  // `eval(trustedScript)` is handled by the V8
  // ModifyCodeGenerationFromStrings callback installed by the runtime. It
  // converts only the TrustedScript brand, preserving ordinary eval(object)
  // semantics and direct-eval scope behavior.
  //
  // Brand membership, not prototype identity: `Object.create(
  // TrustedHTML.prototype)` must fail `isHTML`, and in Chrome it does.
  const _trustedValue = new WeakMap();

  function _defineHidden(target, name, value) {
    Object.defineProperty(target, name, {
      value, writable: true, enumerable: false, configurable: true,
    });
  }

  function _trustedTypeInterface(name) {
    const ctor = function () {
      throw new TypeError("Failed to construct '" + name + "': Illegal constructor");
    };
    Object.defineProperty(ctor, 'name', {value: name, configurable: true});
    Object.defineProperty(ctor.prototype, Symbol.toStringTag, {
      value: name, configurable: true,
    });
    const read = function (self) {
      const held = _trustedValue.get(self);
      if (held === undefined) throw new TypeError('Illegal invocation');
      return held;
    };
    _defineHidden(ctor.prototype, 'toString', _markNative(function toString() {
      return read(this);
    }));
    _defineHidden(ctor.prototype, 'toJSON', _markNative(function toJSON() {
      return read(this);
    }));
    return _markNative(ctor);
  }

  const TrustedHTML = _trustedTypeInterface('TrustedHTML');
  const TrustedScript = _trustedTypeInterface('TrustedScript');
  const TrustedScriptURL = _trustedTypeInterface('TrustedScriptURL');

  const _trustedKind = new WeakMap();
  function _mint(ctor, text) {
    const object = Object.create(ctor.prototype);
    _trustedValue.set(object, String(text));
    _trustedKind.set(object, ctor);
    return object;
  }
  const _isKind = (ctor, value) =>
    value != null && _trustedValue.has(value) && _trustedKind.get(value) === ctor;

  const _policyName = new WeakMap();
  const _policyRules = new WeakMap();

  const TrustedTypePolicy = function () {
    throw new TypeError("Failed to construct 'TrustedTypePolicy': Illegal constructor");
  };
  Object.defineProperty(TrustedTypePolicy, 'name', {
    value: 'TrustedTypePolicy', configurable: true,
  });
  Object.defineProperty(TrustedTypePolicy.prototype, Symbol.toStringTag, {
    value: 'TrustedTypePolicy', configurable: true,
  });
  Object.defineProperty(TrustedTypePolicy.prototype, 'name', {
    get: _markNative(function name() { return _policyName.get(this); }),
    enumerable: true,
    configurable: true,
  });

  function _policyFactoryMethod(method, ctor) {
    return _markNative(function (input) {
      if (arguments.length < 1) {
        throw new TypeError(
          "Failed to execute '" + method + "' on 'TrustedTypePolicy': " +
          '1 argument required, but only 0 present.');
      }
      const rules = _policyRules.get(this);
      const callback = rules && rules[method];
      if (typeof callback !== 'function') {
        throw new TypeError(
          "Failed to execute '" + method + "' on 'TrustedTypePolicy': Policy " +
          _policyName.get(this) + "'s TrustedTypePolicyOptions did not specify a '" +
          method + "' member.");
      }
      const extra = Array.prototype.slice.call(arguments, 1);
      return _mint(ctor, callback.apply(undefined, [String(input)].concat(extra)));
    });
  }
  _defineHidden(TrustedTypePolicy.prototype, 'createHTML',
    _policyFactoryMethod('createHTML', TrustedHTML));
  _defineHidden(TrustedTypePolicy.prototype, 'createScript',
    _policyFactoryMethod('createScript', TrustedScript));
  _defineHidden(TrustedTypePolicy.prototype, 'createScriptURL',
    _policyFactoryMethod('createScriptURL', TrustedScriptURL));

  // Sink tables from the spec's "attribute type" / "property type" algorithms,
  // confirmed against Chrome 146. Element names match case-insensitively;
  // attribute names do too, while property names are case-sensitive.
  const _ATTRIBUTE_SINKS = {
    'script src': 'TrustedScriptURL',
    'embed src': 'TrustedScriptURL',
    'object data': 'TrustedScriptURL',
    'object codebase': 'TrustedScriptURL',
    'iframe srcdoc': 'TrustedHTML',
  };
  const _PROPERTY_SINKS = {
    '* innerHTML': 'TrustedHTML',
    '* outerHTML': 'TrustedHTML',
    'script src': 'TrustedScriptURL',
    'script text': 'TrustedScript',
    'script textContent': 'TrustedScript',
    'script innerText': 'TrustedScript',
    'embed src': 'TrustedScriptURL',
    'object data': 'TrustedScriptURL',
    'object codeBase': 'TrustedScriptURL',
    'iframe srcdoc': 'TrustedHTML',
  };

  const TrustedTypePolicyFactory = function () {
    throw new TypeError(
      "Failed to construct 'TrustedTypePolicyFactory': Illegal constructor");
  };
  Object.defineProperty(TrustedTypePolicyFactory, 'name', {
    value: 'TrustedTypePolicyFactory', configurable: true,
  });
  Object.defineProperty(TrustedTypePolicyFactory.prototype, Symbol.toStringTag, {
    value: 'TrustedTypePolicyFactory', configurable: true,
  });

  let _defaultPolicy = null;
  const _policyNames = new Set();
  const _factoryProto = TrustedTypePolicyFactory.prototype;

  function _cspDirective(name) {
    let header = '';
    try {
      const root = typeof __obscura_frame_document_nid === 'number'
        ? __obscura_frame_document_nid : 0;
      const raw = Deno.core.ops.op_dom('document_scope_info', String(root), '');
      const info = raw && JSON.parse(raw);
      header = info && info.csp || '';
    } catch (_) {}
    const match = header.split(';').map(part => part.trim().split(/\s+/))
      .find(tokens => tokens[0] === name);
    return match ? match.slice(1) : null;
  }

  function _requiredScriptSink() {
    const values = _cspDirective('require-trusted-types-for');
    return !!values && values.some(value => value === "'script'");
  }

  // `sink` is the spec's sink name ("Element innerHTML", "HTMLScriptElement
  // src", ...). It is passed to the default policy as the third argument, as
  // Chrome does, because a policy is allowed to branch on which sink it is
  // covering and cannot tell them apart from the value alone.
  function _enforceSink(kind, value, sink) {
    if (!_requiredScriptSink()) return String(value == null ? '' : value);
    if (_isKind(kind === 'TrustedHTML' ? TrustedHTML
      : kind === 'TrustedScript' ? TrustedScript : TrustedScriptURL, value)) {
      return String(value);
    }
    if (_defaultPolicy) {
      const method = kind === 'TrustedHTML' ? 'createHTML'
        : kind === 'TrustedScript' ? 'createScript' : 'createScriptURL';
      const rule = _policyRules.get(_defaultPolicy)[method];
      if (rule) {
        // A policy callback returns a plain string; the policy is what brands
        // it (see _policyFactoryMethod). Demanding a branded value back from
        // the callback made every sink throw whenever a default policy
        // existed, which is the case this branch is here to serve. Only a
        // null or undefined result rejects the assignment.
        const converted = rule(String(value == null ? '' : value), kind, sink);
        if (converted != null) return String(converted);
      }
    }
    throw new TypeError('This document requires Trusted Types for script sinks.');
  }

  _defineHidden(_factoryProto, 'createPolicy', _markNative(function createPolicy(policyName, policyOptions) {
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'createPolicy' on 'TrustedTypePolicyFactory': " +
        '1 argument required, but only 0 present.');
    }
    const name = String(policyName);
    const allowed = _cspDirective('trusted-types');
    if (allowed) {
      if (!name || (!allowed.includes(name) && !allowed.includes('*'))) {
        throw new TypeError('Policy "' + name + '" disallowed.');
      }
      if (_policyNames.has(name) && !allowed.includes('allow-duplicates')) {
        throw new TypeError('Policy "' + name + '" already exists.');
      }
    }
    const policy = Object.create(TrustedTypePolicy.prototype);
    // The options are a WebIDL dictionary of callbacks: read once here, so a
    // later mutation of the caller's object cannot change the policy.
    const rules = Object.create(null);
    if (policyOptions != null) {
      for (const method of ['createHTML', 'createScript', 'createScriptURL']) {
        const callback = policyOptions[method];
        if (typeof callback === 'function') rules[method] = callback;
      }
    }
    _policyName.set(policy, name);
    _policyNames.add(name);
    _policyRules.set(policy, rules);
    // Without a CSP `trusted-types` directive, duplicate and empty names are
    // both accepted -- the directive is what makes them errors.
    if (name === 'default') _defaultPolicy = policy;
    return policy;
  }));

  _defineHidden(_factoryProto, 'isHTML',
    _markNative(function isHTML(value) { return _isKind(TrustedHTML, value); }));
  _defineHidden(_factoryProto, 'isScript',
    _markNative(function isScript(value) { return _isKind(TrustedScript, value); }));
  _defineHidden(_factoryProto, 'isScriptURL',
    _markNative(function isScriptURL(value) { return _isKind(TrustedScriptURL, value); }));

  _defineHidden(_factoryProto, 'getAttributeType', _markNative(function getAttributeType(tagName, attribute) {
    if (arguments.length < 2) {
      throw new TypeError(
        "Failed to execute 'getAttributeType' on 'TrustedTypePolicyFactory': " +
        '2 arguments required, but only ' + arguments.length + ' present.');
    }
    const element = String(tagName).toLowerCase();
    const name = String(attribute).toLowerCase();
    // Event handler content attributes are script sinks on every element.
    if (name.length > 2 && name.slice(0, 2) === 'on') return 'TrustedScript';
    return _ATTRIBUTE_SINKS[element + ' ' + name] || null;
  }));

  _defineHidden(_factoryProto, 'getPropertyType', _markNative(function getPropertyType(tagName, property) {
    if (arguments.length < 2) {
      throw new TypeError(
        "Failed to execute 'getPropertyType' on 'TrustedTypePolicyFactory': " +
        '2 arguments required, but only ' + arguments.length + ' present.');
    }
    const element = String(tagName).toLowerCase();
    const name = String(property);
    return _PROPERTY_SINKS[element + ' ' + name]
      || _PROPERTY_SINKS['* ' + name]
      || null;
  }));

  const _emptyHTML = _mint(TrustedHTML, '');
  const _emptyScript = _mint(TrustedScript, '');
  Object.defineProperty(_factoryProto, 'emptyHTML', {
    get: _markNative(function emptyHTML() { return _emptyHTML; }),
    enumerable: true, configurable: true,
  });
  Object.defineProperty(_factoryProto, 'emptyScript', {
    get: _markNative(function emptyScript() { return _emptyScript; }),
    enumerable: true, configurable: true,
  });
  Object.defineProperty(_factoryProto, 'defaultPolicy', {
    get: _markNative(function defaultPolicy() { return _defaultPolicy; }),
    enumerable: true, configurable: true,
  });

  _markNative(TrustedTypePolicy);
  _markNative(TrustedTypePolicyFactory);
  globalThis.TrustedHTML = TrustedHTML;
  globalThis.TrustedScript = TrustedScript;
  globalThis.TrustedScriptURL = TrustedScriptURL;
  globalThis.TrustedTypePolicy = TrustedTypePolicy;
  globalThis.TrustedTypePolicyFactory = TrustedTypePolicyFactory;
  // An own data property on the global, which is where Chrome puts it.
  Object.defineProperty(globalThis, 'trustedTypes', {
    value: Object.create(_factoryProto),
    writable: false, enumerable: true, configurable: true,
  });
  Object.defineProperty(globalThis, '__obscura_tt_enforce', {
    value: _enforceSink, writable: false, enumerable: false, configurable: false,
  });
})();

