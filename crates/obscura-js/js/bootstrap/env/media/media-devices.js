// MediaDevices interface shape.  Capture and device enumeration policy lives
// in support/media-devices-behavior.js.
globalThis.MediaDevices = class MediaDevices extends EventTarget {
  constructor(...args) {
    super();
    _mediaDevicesInitialize(this, args[0]);
  }
  enumerateDevices() { return _mediaDevicesEnumerate(this); }
  getSupportedConstraints() { return _mediaDevicesSupportedConstraints(this); }
  getUserMedia(constraints) { return _mediaDevicesCapture(this, constraints); }
  getDisplayMedia(constraints = undefined) { return _mediaDevicesCapture(this, constraints); }
  setCaptureHandleConfig(configuration = undefined) {
    return _mediaDevicesSetCaptureHandleConfig(this, configuration);
  }
  get ondevicechange() { return _mediaDevicesOnDeviceChange(this); }
  set ondevicechange(value) { _mediaDevicesSetOnDeviceChange(this, value); }
};
Object.defineProperty(globalThis.MediaDevices.prototype, Symbol.toStringTag, {
  value: 'MediaDevices', configurable: true,
});

const _mediaDevices = new MediaDevices(_mediaDevicesToken);
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  value: _mediaDevices,
  writable: true,
  enumerable: true,
  configurable: true,
});
