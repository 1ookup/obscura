// MediaCapabilities behavior and realm-local brand state.  The interface
// declaration and navigator getter remain in capabilities.js so its public
// shape is easy to inspect independently from codec policy.
const _mediaCapabilitiesInstances = new WeakSet();
const _mediaCapabilitiesToken = {};

function _mediaCapabilitiesInitialize(instance, token) {
  if (token !== _mediaCapabilitiesToken) {
    throw new TypeError("Failed to construct 'MediaCapabilities': Illegal constructor");
  }
  _mediaCapabilitiesInstances.add(instance);
}

function _mediaConfigurationSupported(configuration) {
  const media = configuration && (configuration.video || configuration.audio);
  const contentType = media && media.contentType;
  if (!contentType) return false;
  return _mediaCapabilityTypeSupported(contentType);
}

function _mediaCapabilitiesInfo(instance, configuration, method) {
  if (!_mediaCapabilitiesInstances.has(instance)) {
    throw new TypeError("Failed to execute '" + method + "' on 'MediaCapabilities': Illegal invocation");
  }
  const supported = _mediaConfigurationSupported(configuration);
  return {powerEfficient: false, smooth: supported, supported, keySystemAccess: null};
}
