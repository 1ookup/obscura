//! Cross-realm capture of `/fo/` request and response bodies.
//!
//! The challenge's verdict is computed server-side from the `/fo/` request
//! bodies, so a payload-level diff needs the bytes themselves, from every
//! realm that sends them: the page's own fetch/XHR, a widget frame's, and a
//! dedicated worker's -- the worker realms are where the widget's attestation
//! traffic goes, and nothing page-level can see it.
//!
//! Enabled by `OBSCURA_CAPTURE_FO=<dir>`. With the variable unset every entry
//! point is one cached environment lookup plus a substring test on the URL, and
//! no other code path changes. With it set, each fetch/XHR whose URL contains
//! `/fo/` writes two files into that directory:
//!
//! ```text
//! <seq>-<realm>-req.bin    the bytes the request carried
//! <seq>-<realm>-resp.bin   the bytes the response carried (empty if none)
//! ```
//!
//! `<realm>` is `page`, `frame` or `worker`, and `<seq>` is a process-wide
//! counter, so the files sort into the order the requests were made. The bytes
//! are read from the op's own arguments and its own result: nothing is
//! re-encoded, and neither the request nor the response is touched.
//!
//! The `te` module below is the sibling facility for
//! `TextEncoder.prototype.encode` arguments, keyed on `OBSCURA_CAPTURE_TE`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

/// The capture directory. Read once per process; `None` means the facility is
/// off, which is what keeps the unset case free of filesystem work.
fn capture_dir() -> Option<&'static str> {
    static DIR: OnceLock<Option<String>> = OnceLock::new();
    DIR.get_or_init(|| {
        std::env::var("OBSCURA_CAPTURE_FO")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
    .as_deref()
}

/// Whether this URL is a capture target. Called once per scripted request, so
/// the string test comes after the (cached) flag check.
pub(crate) fn target(url: &str) -> bool {
    capture_dir().is_some() && url.contains("/fo/")
}

/// A capture in flight, from the request until the response is known.
pub(crate) struct Capture {
    sequence: u64,
    realm: &'static str,
}

impl Capture {
    /// Start a capture for `url`, or `None` when the facility is off or the URL
    /// is not a `/fo/` target. `realm` is only called when a capture starts, so
    /// the caller's cheap path stays cheap.
    pub(crate) fn start(url: &str, realm: impl FnOnce() -> &'static str) -> Option<Self> {
        if !target(url) {
            return None;
        }
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        Some(Capture {
            sequence: SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1,
            realm: realm(),
        })
    }

    fn path(&self, kind: &str) -> std::path::PathBuf {
        std::path::Path::new(capture_dir().unwrap_or(".")).join(format!(
            "{}-{}-{}.bin",
            self.sequence, self.realm, kind
        ))
    }

    /// Record the request bytes. The op's body is a `String` and both the
    /// reqwest and the stealth transport send one as its UTF-8 bytes, so this
    /// is exactly what goes on the wire, binary bodies included.
    pub(crate) fn record_request(&self, body: &str) {
        self.write("req", body.as_bytes());
    }

    /// Record the response bytes from the op's own result. `bodyBase64` is the
    /// response as read, which the `body` string cannot be for anything that is
    /// not UTF-8; a result without a body (blocked, failed, no content) leaves
    /// the file empty rather than absent, so the pair is always complete.
    pub(crate) fn record_response(&self, result: &Result<String, deno_error::JsErrorBox>) {
        let body = result
            .as_ref()
            .ok()
            .and_then(|json| response_bytes(json))
            .unwrap_or_default();
        self.write("resp", &body);
    }

    /// Writes are best-effort: a diagnostic that fails must not take the
    /// request down with it, so every error is logged and dropped.
    fn write(&self, kind: &str, bytes: &[u8]) {
        let path = self.path(kind);
        if let Err(error) = std::fs::write(&path, bytes) {
            tracing::debug!(
                "OBSCURA_CAPTURE_FO: could not write {}: {}",
                path.display(),
                error
            );
        }
    }
}

fn response_bytes(json: &str) -> Option<Vec<u8>> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let encoded = value.get("bodyBase64")?.as_str()?;
    BASE64.decode(encoded).ok()
}

/// The realm a request came from. A dedicated worker has its own isolate and
/// its own outbox; a subframe carries its document root; everything else is the
/// page. The root is read from the op's referrer context rather than from the
/// DOM so a blocked document cannot change the answer.
pub(crate) fn realm(root: u64, worker: bool) -> &'static str {
    if worker {
        "worker"
    } else if root != 0 {
        "frame"
    } else {
        "page"
    }
}

/// Cross-realm capture of `TextEncoder.prototype.encode` arguments.
///
/// The challenge's fingerprint payload is assembled and UTF-8 encoded through
/// `TextEncoder`, whose shim here is pure bootstrap JS: the native API tracer
/// never sees the call, so a payload-level diff needs this tee. The bootstrap
/// calls `op_capture_te` from inside the method body (the function object, and
/// with it the native `toString` mark, is untouched) once per realm after
/// `op_capture_te_enabled` answers, so with the facility off an encode() costs
/// one cached boolean read on the JS side and no op crossing at all.
///
/// Enabled by `OBSCURA_CAPTURE_TE=<dir>`. Each non-empty argument, after the
/// method's own String() coercion, is written as UTF-8 to
/// `<dir>/<seq>-<realm>.txt`, one file per call, never truncated. Zero-length
/// arguments are skipped (the challenge fires hundreds of empty encodes as a
/// timing probe, none of which carry payload). `<seq>` is a process-wide
/// counter and `<realm>` is resolved like the `/fo/` capture's: a worker owns
/// an outbox, a frame carries its document root, everything else is the page.
/// Writes are best-effort and the encode result is never touched.
pub(crate) mod te {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;

    /// The capture directory. Read once per process; `None` means the
    /// facility is off, which is what keeps the unset case free of
    /// filesystem work.
    fn capture_dir() -> Option<&'static str> {
        static DIR: OnceLock<Option<String>> = OnceLock::new();
        DIR.get_or_init(|| {
            std::env::var("OBSCURA_CAPTURE_TE")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .as_deref()
    }

    /// Whether the facility has a destination. The bootstrap resolves this
    /// once per realm on the first encode() call and caches the answer.
    pub(crate) fn enabled() -> bool {
        capture_dir().is_some()
    }

    /// File one encode() argument. The JS side already skips empty strings;
    /// the check repeats here so the op is safe for any caller. The write is
    /// best-effort: a diagnostic that fails must not take the encode down
    /// with it, so every error is logged and dropped.
    pub(crate) fn record(text: &str, root: u64, worker: bool) {
        let Some(dir) = capture_dir() else {
            return;
        };
        if text.is_empty() {
            return;
        }
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
        let path = std::path::Path::new(dir).join(format!(
            "{}-{}.txt",
            sequence,
            super::realm(root, worker)
        ));
        if let Err(error) = std::fs::write(&path, text.as_bytes()) {
            tracing::debug!(
                "OBSCURA_CAPTURE_TE: could not write {}: {}",
                path.display(),
                error
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The realm tag is what makes the captured set readable: a worker's `/fo/`
    /// traffic must not be filed next to the page's.
    #[test]
    fn realm_labels_follow_the_calling_realm() {
        assert_eq!(realm(0, false), "page");
        assert_eq!(realm(7, false), "frame");
        assert_eq!(realm(0, true), "worker");
        assert_eq!(realm(7, true), "worker");
    }

    /// The response bytes come from the op's own base64 field, so the capture
    /// does not round-trip anything through a lossy string.
    #[test]
    fn response_bytes_decode_the_base64_field() {
        let json = serde_json::json!({
            "status": 200,
            "body": "text",
            "bodyBase64": BASE64.encode([0u8, 159, 146, 150, 255]),
        })
        .to_string();
        assert_eq!(response_bytes(&json), Some(vec![0, 159, 146, 150, 255]));
        assert_eq!(response_bytes(r#"{"status":200,"body":""}"#), None);
    }

    /// The TextEncoder capture files the argument as its UTF-8 bytes under
    /// `<seq>-<realm>.txt`, skips empty arguments entirely, and keeps the
    /// realms' files apart.
    #[test]
    fn te_record_writes_utf8_and_skips_empty_arguments() {
        let dir = std::env::temp_dir().join(format!("obscura-te-record-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("OBSCURA_CAPTURE_TE", &dir);
        assert!(te::enabled());

        te::record("héllo — 中文", 0, false);
        te::record("", 0, false);
        te::record("widget", 7, false);
        te::record("attestation", 0, true);

        let mut files: Vec<(String, Vec<u8>)> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                (
                    path.file_name().unwrap().to_string_lossy().to_string(),
                    std::fs::read(&path).unwrap(),
                )
            })
            .collect();
        files.sort();
        assert_eq!(files.len(), 3, "{files:?}");
        assert_eq!(files[0].0, "1-page.txt");
        assert_eq!(files[0].1, "héllo — 中文".as_bytes());
        assert_eq!(files[1].0, "2-frame.txt");
        assert_eq!(files[1].1, b"widget");
        assert_eq!(files[2].0, "3-worker.txt");
        assert_eq!(files[2].1, b"attestation");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
