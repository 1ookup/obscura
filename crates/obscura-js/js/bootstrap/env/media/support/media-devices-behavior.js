// MediaDevices behavior and realm-local brand state.  Obscura does not own a
// capture-device backend, so permission-gated capture fails explicitly and
// enumeration never invents host hardware.
const _mediaDevicesInstances = new WeakSet();
const _mediaDevicesToken = {};
const _mediaDevicesHandlers = new WeakMap();

function _mediaDevicesInitialize(instance, token) {
  if (token !== _mediaDevicesToken) {
    throw new TypeError("Failed to construct 'MediaDevices': Illegal constructor");
  }
  _mediaDevicesInstances.add(instance);
  _mediaDevicesHandlers.set(instance, null);
}
function _mediaDevicesAssert(instance) {
  if (!_mediaDevicesInstances.has(instance)) throw new TypeError('Illegal invocation');
}
function _mediaDevicesEnumerate(instance) {
  _mediaDevicesAssert(instance);
  return Promise.resolve([]);
}
function _mediaDevicesSupportedConstraints(instance) {
  _mediaDevicesAssert(instance);
  return {};
}
function _mediaDevicesCapture(instance) {
  _mediaDevicesAssert(instance);
  return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
}
function _mediaDevicesSetCaptureHandleConfig(instance) {
  _mediaDevicesAssert(instance);
  throw new DOMException('Capture devices are not supported', 'NotSupportedError');
}
function _mediaDevicesOnDeviceChange(instance) {
  _mediaDevicesAssert(instance);
  return _mediaDevicesHandlers.get(instance);
}
function _mediaDevicesSetOnDeviceChange(instance, value) {
  _mediaDevicesAssert(instance);
  _mediaDevicesHandlers.set(instance, typeof value === 'function' ? value : null);
}
