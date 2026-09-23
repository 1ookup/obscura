// MediaCapabilities behavior and realm-local brand state.  The interface
// declaration and navigator getter remain in capabilities.js so its public
// shape is easy to inspect independently from codec policy.
//
// Chrome validates the configuration dictionary before it answers, so a bad
// `type`, a missing required member, or a configuration that names neither
// `video` nor `audio` rejects with a TypeError instead of resolving.  The two
// enums disagree in Chrome: MediaDecodingType still carries the deprecated
// 'media-source' while MediaEncodingType accepts only 'webrtc' (the
// MediaRecorder 'record' value was removed).  Measured against the Chrome 153
// oracle.
const _MEDIA_DECODING_TYPES = ['file', 'media-source', 'webrtc'];
// Chrome's IDL still carries the removed MediaRecorder value, so 'record'
// fails the behavioral check with its own, shorter message rather than the
// WebIDL reading error every other value gets.  'webrtc' is the only value
// encodingInfo accepts.
const _MEDIA_ENCODING_TYPES = ['record', 'webrtc'];
const _MEDIA_ENCODING_ACCEPTED = ['webrtc'];
// `samplerate`, `channels` and `bitrate` are optional in Chrome's
// AudioConfiguration -- only `contentType` is required.  VideoConfiguration
// requires all five.
const _MEDIA_REQUIRED_MEMBERS = {
  video: ['contentType', 'width', 'height', 'bitrate', 'framerate'],
  audio: ['contentType'],
};
// `powerEfficient` reports the platform decoder the declared GPU profile
// implies, not the container.  A Mac behind ANGLE/Metal hardware-decodes every
// supported configuration except AV1 and VP8, which run on the CPU (Chrome 153
// oracle, Apple M2 Max, the same capture the WebGL tables come from); the
// D3D11 profile has no oracle yet, so it keeps the conservative software
// answer.  A page that reads `WEBGL_debug_renderer_info` and then
// `decodingInfo` sees one machine, not two.
// AV1 is spelled `av01` in a file codec string and `av01`/`AV1` in an RTP
// mime type, so both spellings are listed.
const _MEDIA_SOFTWARE_CODEC = { apple: /^av01|^(?:av1|vp8)$/ };

const _mediaCapabilitiesInstances = new WeakSet();
const _mediaCapabilitiesToken = {};

function _mediaCapabilitiesInitialize(instance, token) {
  if (token !== _mediaCapabilitiesToken) {
    throw new TypeError("Failed to construct 'MediaCapabilities': Illegal constructor");
  }
  _mediaCapabilitiesInstances.add(instance);
}

// Chrome reads the dictionary through its generated bindings, so the message
// names the member path it failed on.  Reproduce the shapes, not just the
// error type: a fingerprinting script compares them.
function _mediaConfigurationError(method, detail) {
  return new TypeError(
    "Failed to execute '" + method + "' on 'MediaCapabilities': " + detail);
}

function _mediaConfigurationKind(configuration) {
  if (configuration && configuration.video) return 'video';
  if (configuration && configuration.audio) return 'audio';
  return null;
}

function _mediaValidateConfiguration(configuration, method, dictionary, types, accepted) {
  if (configuration === null || typeof configuration !== 'object'
      || Array.isArray(configuration)) {
    throw _mediaConfigurationError(
      method, "The provided value is not of type '" + dictionary + "'.");
  }
  if (types.indexOf(configuration.type) === -1) {
    throw _mediaConfigurationError(
      method, "Failed to read the 'type' property from '" + dictionary + "': "
        + "The provided value '" + String(configuration.type)
        + "' is not a valid enum value of type Media"
        + (types === _MEDIA_DECODING_TYPES ? 'Decoding' : 'Encoding') + "Type.");
  }
  if (accepted && accepted.indexOf(configuration.type) === -1) {
    throw _mediaConfigurationError(
      method, "The provided value '" + String(configuration.type)
        + "' is not a valid enum value of type MediaEncodingType.");
  }
  const kind = _mediaConfigurationKind(configuration);
  if (!kind) {
    throw _mediaConfigurationError(
      method, 'The configuration dictionary has neither |video| nor |audio| '
        + 'specified and needs at least one of them.');
  }
  const shape = kind === 'video' ? 'Video' : 'Audio';
  const media = configuration[kind];
  if (media === null || typeof media !== 'object') {
    throw _mediaConfigurationError(
      method, "Failed to read the '" + kind + "' property from 'MediaConfiguration'"
        + "': The provided value is not of type '" + shape + "Configuration'.");
  }
  for (const member of _MEDIA_REQUIRED_MEMBERS[kind]) {
    if (media[member] === undefined) {
      throw _mediaConfigurationError(
        method, "Failed to read the '" + kind + "' property from 'MediaConfiguration"
          + "': Failed to read the '" + member + "' property from '"
          + shape + "Configuration': Required member is undefined.");
    }
  }
  return kind;
}

function _mediaConfigurationSupported(configuration) {
  for (const kind of ['video', 'audio']) {
    const media = configuration[kind];
    if (!media) continue;
    const contentType = media.contentType;
    if (!contentType) return false;
    const supported = configuration.type === 'webrtc'
      ? _mediaRtpTypeSupported(String(contentType), kind)
      : _mediaCapabilityTypeSupported(contentType);
    if (!supported) return false;
  }
  return true;
}

// RTP answers come from the same offer sections `RTCRtpSender.getCapabilities`
// reads, so a 'webrtc' configuration cannot claim a codec the capability view
// does not list.  The repair and event codecs that list does carry (rtx, red,
// ulpfec, flexfec-03, CN, telephone-event) are not media codecs and Chrome
// answers unsupported for them.
const _MEDIA_RTP_NON_MEDIA = /^(?:rtx|red|ulpfec|flexfec-03|CN|telephone-event)$/i;

function _mediaRtpTypeSupported(contentType, kind) {
  if (typeof _rtcCapabilities !== 'function') return false;
  const capabilities = _rtcCapabilities(kind);
  if (!capabilities) return false;
  const wanted = contentType.toLowerCase();
  return capabilities.codecs.some(codec =>
    codec.mimeType.toLowerCase() === wanted
      && !_MEDIA_RTP_NON_MEDIA.test(codec.mimeType.slice(codec.mimeType.indexOf('/') + 1)));
}

function _mediaCodecSoftwareDecoded(contentType) {
  const profile = typeof _webglProfile === 'function' ? _webglProfile() : '';
  const rule = _MEDIA_SOFTWARE_CODEC[profile];
  if (!rule || typeof _parseMediaType !== 'function') return true;
  const parsed = _parseMediaType(contentType);
  if (!parsed) return true;
  // An RTP type names the codec in the type itself (`video/VP8`); a file type
  // carries it in the `codecs` parameter, and a bare container such as
  // `audio/mpeg` has no codec name at all.
  const codecs = parsed.codecs.length
    ? parsed.codecs
    : [parsed.container.slice(parsed.container.indexOf('/') + 1)];
  return codecs.some(codec => rule.test(codec));
}

function _mediaConfigurationPowerEfficient(configuration) {
  for (const kind of ['video', 'audio']) {
    const media = configuration[kind];
    if (!media) continue;
    if (_mediaCodecSoftwareDecoded(String(media.contentType))) return false;
  }
  return true;
}

function _mediaCapabilitiesInfo(instance, configuration, method) {
  if (!_mediaCapabilitiesInstances.has(instance)) {
    throw new TypeError("Failed to execute '" + method + "' on 'MediaCapabilities': Illegal invocation");
  }
  const decoding = method === 'decodingInfo';
  _mediaValidateConfiguration(
    configuration, method,
    decoding ? 'MediaDecodingConfiguration' : 'MediaEncodingConfiguration',
    decoding ? _MEDIA_DECODING_TYPES : _MEDIA_ENCODING_TYPES,
    decoding ? null : _MEDIA_ENCODING_ACCEPTED);
  const supported = _mediaConfigurationSupported(configuration);
  const powerEfficient = supported && _mediaConfigurationPowerEfficient(configuration);
  return {powerEfficient, smooth: supported, supported, keySystemAccess: null};
}
