// Select the canned WebGL/WebGPU capability profile from the realm's browser
// fingerprint.  Tables and context methods remain in webgl.js; this policy
// helper is shared by the WebGPU adapter implementation.
function _webglProfile() {
  const fingerprint = _fingerprint() || {};
  const tag = (fingerprint.gpu && fingerprint.gpu.webgpuProfile) || '';
  if (tag === 'apple' || tag === 'intel') return tag;
  return (fingerprint.uaPlatform || '') === 'macOS' ? 'apple' : 'intel';
}
