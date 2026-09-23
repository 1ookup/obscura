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
  // Chrome's desktop NetworkInformation exposes exactly these members;
  // `type` and `downlinkMax` are spec-only and absent there, and exposing
  // them surfaced in challenge payloads as values no real Chrome reports.
  get effectiveType() { _networkInformation(this); return '4g'; }
  // Chrome's rtt is a network-quality measurement, not a model: driven through
  // CDP `Network.emulateNetworkConditions` it reports 50/150/350/2100 for
  // emulated latencies of 50/150/333/2000 ms, and 0 when offline. With no
  // observation to report it answers its 100 ms default, which is what it read
  // on this engine's own environment -- a loopback fixture and a real site
  // alike, before and after the page's transfers. This engine measures
  // throughput but not latency, so it reports that default rather than a
  // fabricated sample.
  get rtt() { _networkInformation(this); return 100; }
  // Chrome's estimator answers observed transfer throughput quantized to
  // 25 kbps buckets, clamped to [0.05, 10] Mbps; the op keeps the same EWMA
  // over the engine's completed scripted fetches. A pinned 10 is the reporting
  // cap, and a cap is the value the passing session did not report. It is a
  // reading, not a constant: Chrome 153 answered 1.65-1.8 Mbps on this machine
  // depending on the load, and CDP-emulated 500/1600/10000 kbps came back as
  // 0.5/1.6/10 Mbps. The default before any sample stays in that band.
  get downlink() { _networkInformation(this); return Deno.core.ops.op_connection_downlink(); }
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
for (const name of ['onchange', 'effectiveType', 'rtt', 'downlink', 'saveData']) {
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
