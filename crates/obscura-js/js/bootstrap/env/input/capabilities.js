// Timezone is driven by the process TZ (set by the CLI, default Europe/Berlin),
// so native Intl.DateTimeFormat and Date report the same zone. No JS override:
// forcing a fixed zone here only on Intl left Date on UTC, which is the exact
// cross-surface mismatch a fingerprinting script looks for.

if (typeof PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, opts={}) { super(type, opts); this.pointerId = opts.pointerId || 0; this.width = opts.width || 1; this.height = opts.height || 1; this.pressure = opts.pressure || 0; this.pointerType = opts.pointerType === undefined ? '' : String(opts.pointerType); }
  };
}

if (typeof navigator.credentials === 'undefined') {
  navigator.credentials = { get(){return Promise.resolve(null);}, create(){return Promise.resolve(null);}, store(){return Promise.resolve();}, preventSilentAccess(){return Promise.resolve();} };
}

globalThis.MediaCapabilities = class MediaCapabilities {
  constructor(token) { _mediaCapabilitiesInitialize(this, token); }
  async decodingInfo(configuration) { return _mediaCapabilitiesInfo(this, configuration, 'decodingInfo'); }
  async encodingInfo(configuration) { return _mediaCapabilitiesInfo(this, configuration, 'encodingInfo'); }
  get [Symbol.toStringTag]() { return 'MediaCapabilities'; }
};
const _mediaCapabilitiesConstructor = Object.getOwnPropertyDescriptor(
  MediaCapabilities.prototype, 'constructor');
const _mediaCapabilitiesMethods = new Map([
  ['decodingInfo', MediaCapabilities.prototype.decodingInfo],
  ['encodingInfo', MediaCapabilities.prototype.encodingInfo],
]);
delete MediaCapabilities.prototype.constructor;
delete MediaCapabilities.prototype.decodingInfo;
delete MediaCapabilities.prototype.encodingInfo;
for (const name of ['decodingInfo', 'encodingInfo']) {
  const method = _mediaCapabilitiesMethods.get(name);
  _markNative(method);
  Object.defineProperty(MediaCapabilities.prototype, name, {
    value: method, writable: true, enumerable: true, configurable: true,
  });
}
Object.defineProperty(
  MediaCapabilities.prototype, 'constructor', _mediaCapabilitiesConstructor);
_markNative(MediaCapabilities);
const _mediaCapabilities = new MediaCapabilities(_mediaCapabilitiesToken);
delete globalThis.navigator.mediaCapabilities;
const _mediaCapabilitiesGetterHolder = {
  get mediaCapabilities() { return _mediaCapabilities; },
};
const _mediaCapabilitiesGetter = Object.getOwnPropertyDescriptor(
  _mediaCapabilitiesGetterHolder, 'mediaCapabilities').get;
_markNative(_mediaCapabilitiesGetter);
Object.defineProperty(Object.getPrototypeOf(globalThis.navigator), 'mediaCapabilities', {
  get: _mediaCapabilitiesGetter, set: undefined, enumerable: true, configurable: true,
});

navigator.locks = {
  request(name, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof cb === 'function') return Promise.resolve(cb({ name, mode: (opts && opts.mode) || 'exclusive' }));
    return Promise.resolve(null);
  },
  query() { return Promise.resolve({ held: [], pending: [] }); },
};
// `navigator.keyboard.getLayoutMap()` resolved with an empty Map. A browser
// on a physical keyboard never does: the map describes what the writing-system
// keys produce under the active layout, and an empty one says "no keyboard".
