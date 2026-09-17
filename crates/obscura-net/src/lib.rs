pub mod client;
pub mod cookies;
pub mod encoding;
pub mod fingerprint;
pub mod interceptor;
pub mod robots;
pub mod blocklist;
#[cfg(feature = "stealth")]
pub mod wreq_client;

pub use client::{
    env_allows_private_network, is_forbidden_ip, CallbackRegistry, ObscuraHttpClient,
    ObscuraNetError, RequestCallback, RequestCredentials, RequestInfo, RequestMode,
    ReferrerPolicy, ResourceRequest, ResourceType, Response, ResponseCallback, ResponseTiming,
    SsrfGuardResolver, referrer_value,
};
// The HTTP method type accepted by `ObscuraHttpClient::fetch_with_method`,
// re-exported so navigation callers do not need a direct reqwest dependency.
pub use reqwest::Method;
pub use cookies::{default_cookie_path, CookieInfo, CookieJar};
pub use encoding::{
    decode_non_html, decode_response, decode_response_with_name, decode_with_label, label_name,
    url_encode_query,
};
pub use fingerprint::{
    fingerprint_overrides_from_env, BrandVersion, BrowserFingerprint, FingerprintOverrides,
    GpuFingerprint, ScreenFingerprint, DEFAULT_USER_AGENT, MACOS_UA_PLATFORM_VERSION,
    WINDOWS_UA_PLATFORM_VERSION,
};
pub use robots::RobotsCache;
pub use blocklist::is_blocked as is_tracker_blocked;
#[cfg(feature = "stealth")]
pub use wreq_client::{StealthHttpClient, STEALTH_USER_AGENT};
