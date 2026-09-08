// Shared policy keys, feature names, and default allowlists. Object shapes
// and parser behavior live in permissions-policy-objects.js.
const _featurePolicyKey = Symbol('FeaturePolicy');
const _featurePolicyDocuments = new WeakMap();
const _featurePolicyFeatures = [
  'ch-ua-full-version-list', 'cross-origin-isolated', 'on-device-speech-recognition',
  'translator', 'shared-storage-select-url', 'ch-ua-arch', 'bluetooth',
  'compute-pressure', 'ch-prefers-reduced-transparency', 'deferred-fetch',
  'ch-save-data', 'publickey-credentials-create', 'shared-storage',
  'deferred-fetch-minimal', 'run-ad-auction', 'ch-downlink', 'ch-ua-form-factors',
  'otp-credentials', 'ch-ua', 'ch-ua-model', 'ch-ect', 'autoplay',
  'language-detector', 'private-state-token-issuance', 'digital-credentials-get',
  'ch-ua-platform-version', 'idle-detection', 'language-model',
  'private-aggregation', 'interest-cohort', 'ch-viewport-height',
  'captured-surface-control', 'local-fonts', 'ch-ua-platform', 'midi',
  'ch-ua-full-version', 'xr-spatial-tracking', 'gamepad', 'display-capture',
  'keyboard-map', 'join-ad-interest-group', 'aria-notify', 'local-network',
  'ch-ua-high-entropy-values', 'ch-width', 'ch-prefers-reduced-motion',
  'browsing-topics', 'encrypted-media', 'local-network-access', 'ch-rtt',
  'ch-ua-mobile', 'window-management', 'unload', 'ch-dpr',
  'ch-prefers-color-scheme', 'ch-ua-wow64', 'fullscreen',
  'identity-credentials-get', 'private-state-token-redemption', 'summarizer',
  'ch-ua-bitness', 'storage-access', 'ch-device-memory', 'ch-viewport-width',
  'picture-in-picture', 'loopback-network',
];
const _featurePolicyWildcardDefaults = new Set([
  'shared-storage-select-url', 'ch-save-data', 'shared-storage',
  'deferred-fetch-minimal', 'run-ad-auction', 'ch-ua', 'private-state-token-issuance',
  'private-aggregation', 'interest-cohort', 'xr-spatial-tracking', 'gamepad',
  'join-ad-interest-group', 'aria-notify', 'ch-ua-high-entropy-values',
  'browsing-topics', 'ch-ua-platform', 'ch-ua-mobile', 'unload',
  'private-state-token-redemption', 'storage-access', 'picture-in-picture',
]);
