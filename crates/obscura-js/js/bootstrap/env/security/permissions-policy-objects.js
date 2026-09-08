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
  try {
    const root = document && typeof document[_scopeRootSym] === 'number'
      ? document[_scopeRootSym] : 0;
    const info = _domParse('document_scope_info', root) || {};
    header = typeof info.permissionsPolicy === 'string' ? info.permissionsPolicy : '';
    origin = typeof info.origin === 'string' ? info.origin : String(document.location.origin || '');
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
    if (!directives.has(name)) {
      return requestedOrigin === undefined || _featurePolicyWildcardDefaults.has(name)
        || subject === origin;
    }
    return directives.get(name).some(token => matchesOrigin(token, subject));
  };
  const allowlist = feature => {
    const name = String(feature || '').toLowerCase();
    if (!_featurePolicyDeclaredFeatures.has(name)) return [];
    if (!directives.has(name)) {
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
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation');
    const policy = _documentPermissionsPolicy(_featurePolicyDocuments.get(this));
    return _featurePolicyFeatures.filter(policy.allows);
  }
  allowsFeature(feature, _origin = undefined) {
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'allowsFeature' on 'FeaturePolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_featurePolicyDocuments.get(this)).allows(feature, _origin);
  }
  features() { return this.allowedFeatures(); }
  getAllowlistForFeature(feature) {
    if (!_featurePolicyDocuments.has(this)) throw new TypeError('Illegal invocation');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'getAllowlistForFeature' on 'FeaturePolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_featurePolicyDocuments.get(this)).allowlist(feature);
  }
  get [Symbol.toStringTag]() { return 'FeaturePolicy'; }
}
globalThis.FeaturePolicy = FeaturePolicy;

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
    if (!_permissionsPolicyDocuments.has(this)) throw new TypeError('Illegal invocation');
    const policy = _documentPermissionsPolicy(_permissionsPolicyDocuments.get(this));
    return _featurePolicyFeatures.filter(policy.allows);
  }
  allowsFeature(feature, _origin = undefined) {
    if (!_permissionsPolicyDocuments.has(this)) throw new TypeError('Illegal invocation');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'allowsFeature' on 'PermissionsPolicy': 1 argument required, but only 0 present.");
    }
    return _documentPermissionsPolicy(_permissionsPolicyDocuments.get(this)).allows(feature, _origin);
  }
  features() { return this.allowedFeatures(); }
  getAllowlistForFeature(feature) {
    if (!_permissionsPolicyDocuments.has(this)) throw new TypeError('Illegal invocation');
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
Object.defineProperty(globalThis, 'PermissionsPolicy', {
  value: PermissionsPolicy, writable: true, enumerable: false, configurable: true,
});
_markNative(PermissionsPolicy);
for (const name of Object.getOwnPropertyNames(PermissionsPolicy.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(PermissionsPolicy.prototype, name);
  if (descriptor?.get) _markNative(descriptor.get);
  if (descriptor?.set) _markNative(descriptor.set);
  if (descriptor?.value) _markNative(descriptor.value);
}
