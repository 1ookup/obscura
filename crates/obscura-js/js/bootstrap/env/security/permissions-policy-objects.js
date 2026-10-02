// Permissions Policy object shapes and behavior. Feature names/defaults come
// from the same-domain permissions-policy-support.js module.
const _featurePolicyDeclaredFeatures = new Set([
  ..._featurePolicyFeatures,
  'accelerometer', 'ambient-light-sensor', 'camera', 'clipboard-read',
  'clipboard-write', 'geolocation', 'gyroscope', 'hid', 'magnetometer',
  'microphone', 'payment', 'publickey-credentials-get', 'screen-wake-lock',
  'serial', 'sync-xhr', 'usb', 'speaker-selection', 'web-share',
]);

function _documentPermissionsPolicy(document) {
  let header = '';
  let origin = '';
  // Whether the frame was *granted* `cross-origin-isolated`: the container's
  // `allow` attribute (an iframe's default allowlist is `self`, so a
  // cross-origin child needs one) intersected with its embedder's own grant,
  // decided by the navigation layer. It is independent of whether isolation
  // happened -- measured Chrome answers this true for a cross-origin child
  // under a plain top with the delegation while the child itself still reads
  // `crossOriginIsolated === false` -- so it cannot be derived from the
  // document's own headers, and the `self` this policy resolves against is the
  // frame's own origin either way.
  let crossOriginIsolatedAllowed = false;
  try {
    const root = document && typeof document[_scopeRootSym] === 'number'
      ? document[_scopeRootSym] : 0;
    const info = _domParse('document_scope_info', root) || {};
    header = typeof info.permissionsPolicy === 'string' ? info.permissionsPolicy : '';
    origin = typeof info.origin === 'string' ? info.origin : String(document.location.origin || '');
    crossOriginIsolatedAllowed = info.crossOriginIsolatedAllowed === true;
  } catch (_error) {}
  const directives = new Map();
  for (const part of header.split(/[,;]/)) {
    const match = part.trim().match(/^([^=\s]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const raw = match[2].trim();
    const list = raw.startsWith('(') && raw.endsWith(')')
      ? raw.slice(1, -1).trim().split(/\s+/).filter(Boolean)
      : raw ? raw.split(/\s+/).filter(Boolean) : [];
    directives.set(name, list);
  }
  const matchesOrigin = (token, subject = origin) => {
    const value = String(token || '').replace(/^['"]|['"]$/g, '');
    return value === '*' || value.toLowerCase() === 'self' && !!origin
      && subject === origin || value === subject;
  };
  const allows = (feature, requestedOrigin = undefined) => {
    const name = String(feature || '').toLowerCase();
    if (!_featurePolicyDeclaredFeatures.has(name)) return false;
    let subject = origin;
    if (requestedOrigin !== undefined) {
      try { subject = new URL(String(requestedOrigin), origin || undefined).origin; }
      catch (_error) { subject = String(requestedOrigin); }
    }
    if (name === 'cross-origin-isolated') {
      // The granted set decides, not this document's own headers: the owner's
      // `self` default and the container's delegation are resolved where the
      // frame tree is known. A header that denies the feature outright still
      // wins, exactly as it does for every other feature.
      if (directives.has(name) && !directives.get(name).some(token => matchesOrigin(token, subject))) {
        return false;
      }
      return crossOriginIsolatedAllowed;
    }
    if (!directives.has(name)) {
      if (_featurePolicyDeniedByDefault.has(name)) return false;
      return requestedOrigin === undefined || _featurePolicyWildcardDefaults.has(name)
        || subject === origin;
    }
    return directives.get(name).some(token => matchesOrigin(token, subject));
  };
  const allowlist = feature => {
    const name = String(feature || '').toLowerCase();
    if (!_featurePolicyDeclaredFeatures.has(name)) return [];
    if (!directives.has(name)) {
      if (_featurePolicyDeniedByDefault.has(name)) return [];
      return _featurePolicyWildcardDefaults.has(name) ? ['*'] : (origin ? [origin] : []);
    }
    return directives.get(name).filter(token => {
      const value = String(token).replace(/^['"]|['"]$/g, '');
      return value !== 'none';
    }).map(token => {
      const value = String(token).replace(/^['"]|['"]$/g, '');
      return value.toLowerCase() === 'self' ? origin : value;
    }).filter(Boolean);
  };
  return { allows, allowlist };
}

class FeaturePolicy {
  constructor(key = undefined, document) {
    if (key !== _featurePolicyKey) {
      throw new TypeError("Failed to construct 'FeaturePolicy': Illegal constructor");
    }
    _featurePolicyDocuments.set(this, document);
  }
  allowedFeatures() {
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:99');
    const policy = _documentPermissionsPolicy(_featurePolicyDocuments.get(this));
    return _featurePolicyFeatures.filter(policy.allows);
  }
  allowsFeature(feature, _origin = undefined) {
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:104');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'allowsFeature' on 'FeaturePolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_featurePolicyDocuments.get(this)).allows(feature, _origin);
  }
  features() {
    // The full feature enumeration, not the allowed subset: Chrome lists
    // `unload` here and omits it from allowedFeatures().
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:114');
    return _featurePolicyFeatures.slice();
  }
  getAllowlistForFeature(feature) {
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:118');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'getAllowlistForFeature' on 'FeaturePolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_featurePolicyDocuments.get(this)).allowlist(feature);
  }
  get [Symbol.toStringTag]() { return 'FeaturePolicy'; }
}
// Chrome lists the operations before `constructor` on FeaturePolicy.prototype
// (its PermissionsPolicy prototype has them in the same order); a class body
// puts the constructor first, so it is rebuilt into Chrome's slot.
{
  const descriptor = Object.getOwnPropertyDescriptor(FeaturePolicy.prototype, 'constructor');
  if (descriptor) {
    delete FeaturePolicy.prototype.constructor;
    Object.defineProperty(FeaturePolicy.prototype, 'constructor', descriptor);
  }
}
globalThis.FeaturePolicy = FeaturePolicy;
// document.featurePolicy / iframe.featurePolicy mint fresh instances on
// every read, so the prototype carries the native presentation.
_markNativeObject(FeaturePolicy.prototype);

const _permissionsPolicyKey = Symbol('PermissionsPolicy');
const _permissionsPolicyDocuments = new WeakMap();
class PermissionsPolicy {
  constructor(key = undefined, document) {
    if (key !== _permissionsPolicyKey) {
      throw new TypeError("Failed to construct 'PermissionsPolicy': Illegal constructor");
    }
    _permissionsPolicyDocuments.set(this, document);
  }
  allowedFeatures() {
    if (!_permissionsPolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:152');
    const policy = _documentPermissionsPolicy(_permissionsPolicyDocuments.get(this));
    return _featurePolicyFeatures.filter(policy.allows);
  }
  allowsFeature(feature, _origin = undefined) {
    if (!_permissionsPolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:157');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'allowsFeature' on 'PermissionsPolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_permissionsPolicyDocuments.get(this)).allows(feature, _origin);
  }
  features() {
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:165');
    return _featurePolicyFeatures.slice();
  }
  getAllowlistForFeature(feature) {
    if (!_permissionsPolicyDocuments.has(this)) throw new TypeError('Illegal invocation @env/security/permissions-policy-objects.js:169');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'getAllowlistForFeature' on 'PermissionsPolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_permissionsPolicyDocuments.get(this)).allowlist(feature);
  }
  get [Symbol.toStringTag]() { return 'PermissionsPolicy'; }
}
const _permissionsPolicyConstructorDescriptor = Object.getOwnPropertyDescriptor(
  PermissionsPolicy.prototype, 'constructor');
delete PermissionsPolicy.prototype.constructor;
Object.defineProperty(PermissionsPolicy.prototype, 'constructor', _permissionsPolicyConstructorDescriptor);
// No global binding: real Chrome (149 census, 151 trace) exposes
// document.featurePolicy / iframe.featurePolicy objects but no
// window.PermissionsPolicy constructor. The class stays in bootstrap scope
// for the iframe.featurePolicy wrapper in env/dom/iframe-element.js.
_markNative(PermissionsPolicy);
// Reflect.ownKeys-based, so the symbol-keyed toStringTag getter is covered
// alongside the string-keyed members.
_markNativeObject(PermissionsPolicy.prototype);
