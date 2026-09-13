// Plugin / MimeType / MimeTypeArray global interfaces. Chrome exposes these as
// global constructors; their absence threw "ReferenceError: Plugin is not
// defined" in site bundles that reference them (issue #305). Plain function
// declarations (no globalThis assignment) so they survive the V8 snapshot, the
// same pattern PluginArray uses.
function Plugin(name, filename, description, mimeTypes) {
  this.name = name;
  this.filename = filename;
  this.description = description;
  var mt = mimeTypes || [];
  for (var _i = 0; _i < mt.length; _i++) this[_i] = mt[_i];
  this.length = mt.length;
}
Plugin.prototype.item = function(i) { return this[i] || null; };
Plugin.prototype.namedItem = function(name) {
  for (var _i = 0; _i < this.length; _i++) if (this[_i] && this[_i].type === name) return this[_i];
  return null;
};
Plugin.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.defineProperty(Plugin.prototype, Symbol.toStringTag, {value: 'Plugin', configurable: true});
_markNative(Plugin);
_markNative(Plugin.prototype.item);
_markNative(Plugin.prototype.namedItem);

function MimeType(type, description, suffixes, plugin) {
  this.type = type;
  this.description = description;
  this.suffixes = suffixes;
  this.enabledPlugin = plugin || null;
}
Object.defineProperty(MimeType.prototype, Symbol.toStringTag, {value: 'MimeType', configurable: true});
_markNative(MimeType);

function MimeTypeArray(items) {
  for (var _i = 0; _i < items.length; _i++) this[_i] = items[_i];
  this.length = items.length;
}
MimeTypeArray.prototype.item = function(i) { return this[i] || null; };
MimeTypeArray.prototype.namedItem = function(name) {
  for (var _i = 0; _i < this.length; _i++) if (this[_i] && this[_i].type === name) return this[_i];
  return null;
};
MimeTypeArray.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.defineProperty(MimeTypeArray.prototype, Symbol.toStringTag, {value: 'MimeTypeArray', configurable: true});
_markNative(MimeTypeArray);
_markNative(MimeTypeArray.prototype.item);
_markNative(MimeTypeArray.prototype.namedItem);

const _networkInformationKey = {};
const _networkInformationState = new WeakMap();
const _networkInformation = value => {
  const state = _networkInformationState.get(value);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
};
class NetworkInformation {
  constructor(key = undefined) {
    if (key !== _networkInformationKey) {
      throw new TypeError("Failed to construct 'NetworkInformation': Illegal constructor");
    }
    _networkInformationState.set(this, { onchange: null });
  }
  get onchange() { return _networkInformation(this).onchange; }
  set onchange(value) {
    _networkInformation(this).onchange = typeof value === 'function' ? value : null;
  }
  get type() { _networkInformation(this); return 'wifi'; }
  get effectiveType() { _networkInformation(this); return '4g'; }
  get rtt() { _networkInformation(this); return 50; }
  get downlink() { _networkInformation(this); return 10; }
  get saveData() { _networkInformation(this); return false; }
}
const _networkInformationConstructor = Object.getOwnPropertyDescriptor(
  NetworkInformation.prototype, 'constructor');
delete NetworkInformation.prototype.constructor;
if (_networkInformationConstructor) Object.defineProperty(
  NetworkInformation.prototype, 'constructor', _networkInformationConstructor);
Object.defineProperty(NetworkInformation.prototype, Symbol.toStringTag,
  { value: 'NetworkInformation', configurable: true });
_markNative(NetworkInformation);
for (const name of ['onchange', 'type', 'effectiveType', 'rtt', 'downlink', 'saveData']) {
  const descriptor = Object.getOwnPropertyDescriptor(NetworkInformation.prototype, name);
  if (descriptor.get) _markNative(descriptor.get);
  if (descriptor.set) _markNative(descriptor.set);
}
globalThis.NetworkInformation = NetworkInformation;


function _uaBrands() {
  return (_fingerprint().brands || []).map(item => ({brand:item.brand,version:item.version}));
}

function _permissionPolicyAllows(name) {
  const root = globalThis.__obscura_frame_document_nid;
  if (typeof root !== 'number' || root <= 0) return true;
  try { return _dom('frame_permission_allowed', root, String(name)) === 'true'; }
  catch (_error) { return false; }
}

// Chrome's defaults, measured on a fresh profile. The split is not arbitrary:
// the names it reports as `granted` are the ones it auto-grants to a page that
// has not been asked, while the rest stay `prompt` until the user answers.
// Neither list may fall back to `granted` -- a page that never prompted for the
// camera still reads `prompt`, so a blanket `granted` is a value Chrome does
// not produce for any of these.
const _PERMISSION_DEFAULT_PROMPT = new Set([
  'geolocation', 'notifications', 'camera', 'microphone', 'midi',
  'clipboard-read', 'persistent-storage', 'idle-detection', 'local-fonts',
  'window-management',
]);
const _PERMISSION_DEFAULT_GRANTED = new Set([
  'clipboard-write', 'background-sync', 'storage-access', 'accelerometer',
  'gyroscope', 'magnetometer', 'payment-handler', 'screen-wake-lock',
]);

function _permissionState(name) {
  name = String(name || '');
  if (!_permissionPolicyAllows(name)) return 'denied';
  if (name === 'notifications') {
    const permission = globalThis.Notification && Notification.permission;
    return permission === 'granted' || permission === 'denied' ? permission : 'prompt';
  }
  if (_PERMISSION_DEFAULT_GRANTED.has(name)) return 'granted';
  if (_PERMISSION_DEFAULT_PROMPT.has(name)) return 'prompt';
  return 'prompt';
}

function _permissionStatusName(name) {
  name = String(name || '');
  if (name === 'camera') return 'video_capture';
  if (name === 'microphone') return 'audio_capture';
  return name;
}

