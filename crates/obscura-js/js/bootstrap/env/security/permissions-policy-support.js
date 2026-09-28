// Shared policy keys, feature names, and default allowlists. Object shapes
// and parser behavior live in permissions-policy-objects.js.
const _featurePolicyKey = Symbol('FeaturePolicy');
const _featurePolicyDocuments = new WeakMap();
// Chrome's own feature enumeration, in its order (local Chrome 149 oracle,
// 2026-09-28). `features()` and `allowedFeatures()` walk this list, so both
// the membership and the order a page reads are Chrome's; the previous list
// was a 66-name subset in a different order, which cost 17 names at the front
// of the array (geolocation, screen-wake-lock, camera, ...).
const _featurePolicyFeatures = [
  'geolocation', 'ch-ua-full-version-list', 'cross-origin-isolated', 'screen-wake-lock',
  'on-device-speech-recognition', 'translator', 'publickey-credentials-get',
  'shared-storage-select-url', 'ch-ua-arch', 'bluetooth', 'compute-pressure',
  'ch-prefers-reduced-transparency', 'deferred-fetch', 'usb', 'ch-save-data',
  'publickey-credentials-create', 'shared-storage', 'deferred-fetch-minimal', 'run-ad-auction',
  'ch-downlink', 'ch-ua-form-factors', 'otp-credentials', 'payment', 'ch-ua', 'ch-ua-model',
  'ch-ect', 'autoplay', 'camera', 'language-detector', 'private-state-token-issuance',
  'digital-credentials-get', 'accelerometer', 'ch-ua-platform-version', 'idle-detection',
  'language-model', 'private-aggregation', 'interest-cohort', 'ch-viewport-height',
  'captured-surface-control', 'local-fonts', 'ch-ua-platform', 'midi', 'ch-ua-full-version',
  'xr-spatial-tracking', 'clipboard-read', 'gamepad', 'display-capture', 'keyboard-map',
  'join-ad-interest-group', 'aria-notify', 'local-network', 'ch-ua-high-entropy-values',
  'ch-width', 'ch-prefers-reduced-motion', 'browsing-topics', 'encrypted-media',
  'local-network-access', 'gyroscope', 'serial', 'ch-rtt', 'ch-ua-mobile', 'window-management',
  'unload', 'ch-dpr', 'ch-prefers-color-scheme', 'ch-ua-wow64', 'attribution-reporting',
  'fullscreen', 'identity-credentials-get', 'private-state-token-redemption', 'hid',
  'summarizer', 'ch-ua-bitness', 'storage-access', 'sync-xhr', 'ch-device-memory',
  'ch-viewport-width', 'picture-in-picture', 'tools', 'magnetometer', 'loopback-network',
  'clipboard-write', 'microphone'
];
// `unload` is the one feature Chrome lists but does not allow by default; it
// moved out of the wildcard defaults when the list above became Chrome's.
const _featurePolicyDeniedByDefault = new Set(['unload']);
const _featurePolicyWildcardDefaults = new Set([
  'shared-storage-select-url', 'ch-save-data', 'shared-storage',
  'deferred-fetch-minimal', 'run-ad-auction', 'ch-ua', 'private-state-token-issuance',
  'private-aggregation', 'interest-cohort', 'xr-spatial-tracking', 'gamepad',
  'join-ad-interest-group', 'aria-notify', 'ch-ua-high-entropy-values',
  'browsing-topics', 'ch-ua-platform', 'ch-ua-mobile',
  'private-state-token-redemption', 'storage-access', 'picture-in-picture',
]);
