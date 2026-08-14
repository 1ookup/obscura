//! Browser identity derivation.
//!
//! The old implementation selected one of eight fixed UA/platform rows. The
//! platform now exposes the shared derivation and value-policy types directly,
//! so embedders can start with one UA and explicitly override facts they know.

pub use obscura_net::{
    BrowserFingerprint, FingerprintOverrides, GpuFingerprint, ScreenFingerprint,
    DEFAULT_USER_AGENT,
};

pub fn from_user_agent(user_agent: impl Into<String>) -> BrowserFingerprint {
    BrowserFingerprint::from_user_agent(user_agent)
}
