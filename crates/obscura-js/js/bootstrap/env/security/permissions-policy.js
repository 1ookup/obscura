// Features can be absent from Chrome's default allowedFeatures() list yet be
// explicitly enabled by a response header. Keep those names recognized by
// allowsFeature()/getAllowlistForFeature() without polluting the default list.
const _featurePolicyDeclaredFeatures = new Set([
  ..._featurePolicyFeatures,
  'accelerometer', 'ambient-light-sensor', 'camera', 'clipboard-read',
  'clipboard-write', 'geolocation', 'gyroscope', 'hid', 'magnetometer',
  'microphone', 'payment', 'publickey-credentials-get', 'screen-wake-lock',
  'serial', 'sync-xhr', 'usb', 'speaker-selection', 'web-share',
]);

// Permissions-Policy is attached to a document, not to a JS wrapper. Keep
// the parser here small and deterministic so FeaturePolicy and Permissions-
// Policy expose the same result after wrapper churn and frame navigation.
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
  // Header directives are comma-separated. Accept semicolons too because a
  // few servers still emit the obsolete delimiter and Chrome tolerates it.
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
    const document = _featurePolicyDocuments.get(this);
    return _documentPermissionsPolicy(document).allowlist(feature);
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
    const document = _permissionsPolicyDocuments.get(this);
    return _documentPermissionsPolicy(document).allowlist(feature);
  }
  get [Symbol.toStringTag]() { return 'PermissionsPolicy'; }
}
const _permissionsPolicyConstructorDescriptor = Object.getOwnPropertyDescriptor(
  PermissionsPolicy.prototype, 'constructor');
delete PermissionsPolicy.prototype.constructor;
Object.defineProperty(
  PermissionsPolicy.prototype, 'constructor', _permissionsPolicyConstructorDescriptor);
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
class _FragmentDirective {
  get [Symbol.toStringTag]() { return 'FragmentDirective'; }
}
const _documentFeaturePolicies = new WeakMap();
const _documentFragmentDirectives = new WeakMap();

const _viewTransitionTypeSetKey = Symbol('ViewTransitionTypeSet');
class ViewTransitionTypeSet extends Set {
  constructor(key = undefined, values = undefined) {
    if (key !== _viewTransitionTypeSetKey) {
      throw new TypeError("Failed to construct 'ViewTransitionTypeSet': Illegal constructor");
    }
    super(values);
  }
  get size() { return Reflect.get(Set.prototype, 'size', this); }
  add(value) { super.add(String(value)); return this; }
  clear() { return super.clear(); }
  delete(value) { return super.delete(String(value)); }
  entries() { return super.entries(); }
  forEach(callback, thisArg = undefined) { return super.forEach(callback, thisArg); }
  has(value) { return super.has(String(value)); }
  keys() { return super.keys(); }
  values() { return super.values(); }
  get [Symbol.toStringTag]() { return 'ViewTransitionTypeSet'; }
}
const _viewTransitionKey = Symbol('ViewTransition');
const _viewTransitionState = new WeakMap();
const _activeViewTransitions = new WeakMap();
class ViewTransition {
  constructor(key = undefined, document, update, types) {
    if (key !== _viewTransitionKey) {
      throw new TypeError("Failed to construct 'ViewTransition': Illegal constructor");
    }
    let resolveReady, rejectReady, resolveUpdate, rejectUpdate, resolveFinished, rejectFinished;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const updateCallbackDone = new Promise((resolve, reject) => { resolveUpdate = resolve; rejectUpdate = reject; });
    const finished = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
    const state = {
      document, ready, updateCallbackDone, finished,
      resolveReady, rejectReady, resolveUpdate, rejectUpdate,
      resolveFinished, rejectFinished, skipped: false,
      waits: [], types: new ViewTransitionTypeSet(_viewTransitionTypeSetKey, types || []),
    };
    _viewTransitionState.set(this, state);
    Promise.resolve().then(async () => {
      try {
        if (typeof update === 'function') await update();
        state.resolveUpdate();
        state.resolveReady();
        await Promise.all(state.waits);
        setTimeout(() => state.resolveFinished(), 0);
      } catch (error) {
        state.rejectUpdate(error); state.rejectReady(error); state.rejectFinished(error);
      }
    });
  }
  get finished() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.finished;
  }
  get ready() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.ready;
  }
  get updateCallbackDone() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.updateCallbackDone;
  }
  get types() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.types;
  }
  get transitionRoot() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    return state.document.documentElement;
  }
  skipTransition() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    if (state.skipped) return;
    state.skipped = true;
    state.resolveReady(); state.resolveFinished();
  }
  waitUntil(value) {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'waitUntil' on 'ViewTransition': 1 argument required, but only 0 present.");
    }
    state.waits.push(Promise.resolve(value));
  }
  get [Symbol.toStringTag]() { return 'ViewTransition'; }
}
globalThis.ViewTransitionTypeSet = ViewTransitionTypeSet;
globalThis.ViewTransition = ViewTransition;

