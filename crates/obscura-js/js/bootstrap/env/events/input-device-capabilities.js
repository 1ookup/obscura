const _inputCapsFlags = new WeakMap();
globalThis.InputDeviceCapabilities = class InputDeviceCapabilities {
  constructor(init) { _inputCapsFlags.set(this, !!(init && init.firesTouchEvents)); }
  get firesTouchEvents() { return _inputCapsFlags.has(this) && _inputCapsFlags.get(this); }
};
_markNative(InputDeviceCapabilities);
