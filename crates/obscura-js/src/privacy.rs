use std::collections::{HashMap, HashSet};
use std::fmt;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};

use url::{Host, Url};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct PrivateStateKey {
    top_level_origin: String,
    document_origin: String,
    issuer_origin: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct StorageAccessKey {
    top_level_origin: String,
    document_origin: String,
}

#[derive(Clone, Debug, Default)]
struct PrivacyPolicyState {
    private_tokens: HashSet<PrivateStateKey>,
    redemption_records: HashSet<PrivateStateKey>,
    storage_access_grants: HashSet<StorageAccessKey>,
}

/// Browser-owned, origin-partitioned values exposed through privacy APIs.
///
/// Web API validation, Promise behavior and document lifecycle checks live in
/// the runtime. This policy only supplies values that an embedder knows to be
/// true. Its empty default is deliberately honest: no private token,
/// redemption record, or third-party storage grant is invented.
#[derive(Clone, Debug, Default)]
pub struct PrivacyPolicy {
    state: Arc<Mutex<PrivacyPolicyState>>,
}

/// Browser-context state for the Private State Token query information limit.
/// Chromium associates at most two issuer origins with one top-level origin,
/// and that association survives same-origin document navigations.
#[derive(Clone, Debug, Default)]
pub struct PrivateTokenQueryState {
    issuers_by_top_level_origin: Arc<Mutex<HashMap<String, HashSet<String>>>>,
}

impl PrivateTokenQueryState {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn associate(&self, top_level_origin: &str, issuer_origin: &str) -> bool {
        let mut state = self
            .issuers_by_top_level_origin
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let issuers = state.entry(top_level_origin.to_string()).or_default();
        if issuers.contains(issuer_origin) {
            return true;
        }
        if issuers.len() >= 2 {
            return false;
        }
        issuers.insert(issuer_origin.to_string());
        true
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrivacyPolicyError {
    value: String,
    requirement: &'static str,
}

impl fmt::Display for PrivacyPolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid origin '{}': {}", self.value, self.requirement)
    }
}

impl std::error::Error for PrivacyPolicyError {}

impl PrivacyPolicy {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set whether a document partition has a private state token issued by
    /// `issuer`. Inputs may be full URLs; they are stored as normalized
    /// origins so paths, fragments and default ports cannot split state.
    pub fn set_private_token(
        &self,
        top_level_origin: &str,
        document_origin: &str,
        issuer: &str,
        present: bool,
    ) -> Result<(), PrivacyPolicyError> {
        let key = private_state_key(top_level_origin, document_origin, issuer)?;
        set_membership(&mut self.lock().private_tokens, key, present);
        Ok(())
    }

    /// Set whether a document partition has a redemption record for `issuer`.
    pub fn set_redemption_record(
        &self,
        top_level_origin: &str,
        document_origin: &str,
        issuer: &str,
        present: bool,
    ) -> Result<(), PrivacyPolicyError> {
        let key = private_state_key(top_level_origin, document_origin, issuer)?;
        set_membership(&mut self.lock().redemption_records, key, present);
        Ok(())
    }

    /// Set a non-partitioned storage-access grant for an embedded origin.
    /// First-party documents do not need a grant and resolve true in the Web
    /// API independently of this table.
    pub fn set_storage_access_grant(
        &self,
        top_level_origin: &str,
        document_origin: &str,
        granted: bool,
    ) -> Result<(), PrivacyPolicyError> {
        let key = storage_access_key(top_level_origin, document_origin)?;
        set_membership(&mut self.lock().storage_access_grants, key, granted);
        Ok(())
    }

    /// Copy configured values into an independent policy. BrowserContext
    /// isolation uses this instead of sharing future mutations with the
    /// template context.
    pub fn snapshot(&self) -> Self {
        Self {
            state: Arc::new(Mutex::new(self.lock().clone())),
        }
    }

    pub(crate) fn has_private_token(
        &self,
        top_level_origin: &str,
        document_origin: &str,
        issuer_origin: &str,
    ) -> bool {
        self.lock().private_tokens.contains(&PrivateStateKey {
            top_level_origin: top_level_origin.to_string(),
            document_origin: document_origin.to_string(),
            issuer_origin: issuer_origin.to_string(),
        })
    }

    pub(crate) fn has_redemption_record(
        &self,
        top_level_origin: &str,
        document_origin: &str,
        issuer_origin: &str,
    ) -> bool {
        self.lock().redemption_records.contains(&PrivateStateKey {
            top_level_origin: top_level_origin.to_string(),
            document_origin: document_origin.to_string(),
            issuer_origin: issuer_origin.to_string(),
        })
    }

    pub(crate) fn has_storage_access_grant(
        &self,
        top_level_origin: &str,
        document_origin: &str,
    ) -> bool {
        self.lock().storage_access_grants.contains(&StorageAccessKey {
            top_level_origin: top_level_origin.to_string(),
            document_origin: document_origin.to_string(),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PrivacyPolicyState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn set_membership<T: Eq + std::hash::Hash>(set: &mut HashSet<T>, key: T, present: bool) {
    if present {
        set.insert(key);
    } else {
        set.remove(&key);
    }
}

fn private_state_key(
    top_level_origin: &str,
    document_origin: &str,
    issuer: &str,
) -> Result<PrivateStateKey, PrivacyPolicyError> {
    Ok(PrivateStateKey {
        top_level_origin: normalize_http_origin(top_level_origin, false)?,
        document_origin: normalize_http_origin(document_origin, false)?,
        issuer_origin: normalize_http_origin(issuer, true)?,
    })
}

fn storage_access_key(
    top_level_origin: &str,
    document_origin: &str,
) -> Result<StorageAccessKey, PrivacyPolicyError> {
    Ok(StorageAccessKey {
        top_level_origin: normalize_http_origin(top_level_origin, false)?,
        document_origin: normalize_http_origin(document_origin, false)?,
    })
}

pub(crate) fn normalize_private_token_issuer(value: &str) -> Option<String> {
    normalize_http_origin(value, true).ok()
}

fn normalize_http_origin(
    value: &str,
    require_trustworthy: bool,
) -> Result<String, PrivacyPolicyError> {
    let parsed = Url::parse(value).map_err(|_| PrivacyPolicyError {
        value: value.to_string(),
        requirement: "an absolute HTTP(S) URL is required",
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || !parsed.origin().is_tuple() {
        return Err(PrivacyPolicyError {
            value: value.to_string(),
            requirement: "an absolute HTTP(S) URL is required",
        });
    }
    if require_trustworthy && !is_potentially_trustworthy_http_url(&parsed) {
        return Err(PrivacyPolicyError {
            value: value.to_string(),
            requirement: "the issuer must be potentially trustworthy",
        });
    }
    Ok(parsed.origin().ascii_serialization())
}

fn is_potentially_trustworthy_http_url(url: &Url) -> bool {
    if url.scheme() == "https" {
        return true;
    }
    match url.host() {
        Some(Host::Ipv4(ip)) => IpAddr::V4(ip).is_loopback(),
        Some(Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        Some(Host::Domain(domain)) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            domain == "localhost" || domain.ends_with(".localhost")
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_normalizes_urls_and_never_invents_values() {
        let policy = PrivacyPolicy::new();
        assert!(!policy.has_private_token(
            "https://top.example",
            "https://frame.example",
            "https://issuer.example",
        ));
        policy
            .set_private_token(
                "https://top.example/page",
                "https://frame.example/path",
                "https://issuer.example:443/issue?batch=1",
                true,
            )
            .unwrap();
        assert!(policy.has_private_token(
            "https://top.example",
            "https://frame.example",
            "https://issuer.example",
        ));
    }

    #[test]
    fn issuer_must_be_http_and_potentially_trustworthy() {
        assert!(normalize_private_token_issuer("https://issuer.example/path").is_some());
        assert!(normalize_private_token_issuer("http://localhost:8080/path").is_some());
        assert!(normalize_private_token_issuer("http://127.0.0.1/path").is_some());
        assert!(normalize_private_token_issuer("http://issuer.example/path").is_none());
        assert!(normalize_private_token_issuer("wss://issuer.example").is_none());
    }

    #[test]
    fn snapshots_do_not_share_later_configuration_mutations() {
        let source = PrivacyPolicy::new();
        source
            .set_storage_access_grant(
                "https://top.example",
                "https://frame.example",
                true,
            )
            .unwrap();
        let snapshot = source.snapshot();
        source
            .set_storage_access_grant(
                "https://top.example",
                "https://frame.example",
                false,
            )
            .unwrap();
        assert!(snapshot.has_storage_access_grant(
            "https://top.example",
            "https://frame.example",
        ));
        assert!(!source.has_storage_access_grant(
            "https://top.example",
            "https://frame.example",
        ));
    }

    #[test]
    fn private_token_query_limit_is_shared_by_top_level_origin() {
        let state = PrivateTokenQueryState::new();
        let second_page = state.clone();
        assert!(state.associate("https://top.example", "https://one.example"));
        assert!(second_page.associate("https://top.example", "https://two.example"));
        assert!(!state.associate("https://top.example", "https://three.example"));
        assert!(state.associate("https://top.example", "https://one.example"));
        assert!(state.associate("https://other.example", "https://three.example"));
    }
}
