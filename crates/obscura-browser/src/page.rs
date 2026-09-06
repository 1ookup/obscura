use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use obscura_dom::{parse_html, DomTree};
use obscura_js::ops::{new_storage_areas, SharedStorageAreas};
use obscura_js::runtime::ObscuraJsRuntime;
use obscura_net::{
    CallbackRegistry, Method, ObscuraHttpClient, ObscuraNetError, RequestCallback,
    ResourceRequest, ResourceType, Response, ResponseCallback,
};
use url::Url;

use crate::context::BrowserContext;
use crate::lifecycle::LifecycleState;

/// Parse `OBSCURA_GEOLOCATION="lat,lon"` for the navigator.geolocation shim.
/// Returns None when unset or malformed, leaving the built-in default in place.
/// Lets a deployment align the reported coordinates with the region its exit IP
/// resolves to, so timezone and location stay consistent (issue #228).
fn env_geolocation() -> Option<(f64, f64)> {
    let raw = std::env::var("OBSCURA_GEOLOCATION").ok()?;
    let (lat, lon) = raw.split_once(',')?;
    let lat: f64 = lat.trim().parse().ok()?;
    let lon: f64 = lon.trim().parse().ok()?;
    let valid = lat.is_finite()
        && lon.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && (-180.0..=180.0).contains(&lon);
    valid.then_some((lat, lon))
}

fn decode_data_uri(uri: &str) -> Option<Vec<u8>> {
    let rest = uri.strip_prefix("data:")?;
    let comma = rest.find(',')?;
    let meta = &rest[..comma];
    let payload = &rest[comma + 1..];
    if meta.split(';').any(|t| t.eq_ignore_ascii_case("base64")) {
        let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
        BASE64.decode(cleaned).ok()
    } else {
        Some(percent_decode(payload))
    }
}

fn percent_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hi = hex_val(b[i + 1]);
            let lo = hex_val(b[i + 2]);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Truncate `s` to at most `max` bytes without splitting a UTF-8 character.
/// `&s[..max]` panics if `max` lands inside a multi-byte char; the evaluated
/// expression logged below is caller-controlled, so slice it safely.
/// (`str::floor_char_boundary` would do this but is still unstable.)
fn truncate_on_char_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(feature = "render")]
fn remaining_settle_resource_warmup_ms(
    max_ms: u64,
    elapsed: std::time::Duration,
    configured_ms: u64,
) -> u64 {
    std::time::Duration::from_millis(max_ms)
        .checked_sub(elapsed)
        .map(|remaining| {
            (remaining.as_millis().min(u128::from(u64::MAX)) as u64).min(configured_ms)
        })
        .unwrap_or(0)
}

#[cfg(feature = "stealth")]
use obscura_net::StealthHttpClient;

/// Returns true when a JS-initiated navigation would step from a
/// non-file scheme into a file: URL. We treat that move as an SOP
/// violation because the existing realm survives the navigation and
/// can read the new document's body.
fn cross_scheme_to_file(from: &str, to: &str) -> bool {
    let to_is_file = Url::parse(to)
        .map(|u| u.scheme().eq_ignore_ascii_case("file"))
        .unwrap_or(false);
    if !to_is_file {
        return false;
    }
    Url::parse(from)
        .map(|u| !u.scheme().eq_ignore_ascii_case("file"))
        .unwrap_or(true)
}

/// Sub-resource fetch policy. http(s) is always fine; data: is allowed
/// because the bytes are inline in the URI (no network fetch, no SSRF);
/// file: is only allowed when the page itself was loaded from file:;
/// everything else (javascript:, chrome:, etc) is blocked.
/// Real Chrome allows data: subresources by default; Instagram and most
/// Meta properties depend on this for their inline bootstrap scripts.
fn subresource_allowed(page_url: Option<&Url>, resource: &str) -> bool {
    let Ok(target) = Url::parse(resource) else {
        return false;
    };
    let scheme = target.scheme().to_ascii_lowercase();
    match scheme.as_str() {
        "http" | "https" | "data" => true,
        "file" => page_url
            .map(|u| u.scheme().eq_ignore_ascii_case("file"))
            .unwrap_or(false),
        _ => false,
    }
}

/// Compute the referrer value used for a document-initiated navigation.
/// Direct automation navigations pass an empty source; document-triggered
/// navigations use the current document's policy.
fn navigation_referrer_with_policy(
    source: &Url,
    target: &Url,
    policy: obscura_net::ReferrerPolicy,
) -> String {
    obscura_net::referrer_value(
        source,
        target,
        policy,
    )
    .unwrap_or_default()
}

fn navigation_referrer(source: &Url, target: &Url) -> String {
    navigation_referrer_with_policy(
        source,
        target,
        obscura_net::ReferrerPolicy::default(),
    )
}

fn document_referrer_policy(
    dom: &DomTree,
    response_header: Option<&str>,
) -> obscura_net::ReferrerPolicy {
    document_referrer_policy_from_root(dom, dom.document(), response_header)
}

fn document_referrer_policy_from_root(
    dom: &DomTree,
    root: obscura_dom::NodeId,
    response_header: Option<&str>,
) -> obscura_net::ReferrerPolicy {
    if let Some(header) = response_header {
        return obscura_net::ReferrerPolicy::parse_list(header);
    }
    for id in dom.query_selector_all_from(root, "meta").unwrap_or_default() {
        let Some(node) = dom.get_node(id) else { continue; };
        let name = node
            .get_attribute("name")
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if name == "referrer" || name == "referrer-policy" {
            if let Some(content) = node.get_attribute("content") {
                return obscura_net::ReferrerPolicy::parse_list(content);
            }
        }
    }
    obscura_net::ReferrerPolicy::default()
}

/// Extract enforced CSP policies declared by document metadata. A meta policy
/// is applied after the response policy, so when both exist their source lists
/// are intersected instead of allowing the later declaration to weaken the
/// response header. The parser intentionally leaves report-only metadata out
/// of this path because only the `http-equiv` CSP policy is enforced here.
fn meta_content_security_policy(
    dom: &DomTree,
    root: obscura_dom::NodeId,
) -> Option<String> {
    let mut effective: Option<crate::frame_policy::ContentSecurityPolicy> = None;
    for id in dom.query_selector_all_from(root, "meta").unwrap_or_default() {
        let Some(node) = dom.get_node(id) else { continue };
        let is_csp = node
            .get_attribute("http-equiv")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("content-security-policy"));
        if !is_csp {
            continue;
        }
        let Some(content) = node
            .get_attribute("content")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let policy = crate::frame_policy::ContentSecurityPolicy::parse(content);
        effective = Some(match effective {
            Some(existing) => {
                let combined = existing.combined_with_required(&policy);
                crate::frame_policy::ContentSecurityPolicy::parse(&combined)
            }
            None => policy,
        });
    }
    effective.map(|policy| policy.serialized())
}

fn effective_document_csp(
    dom: &DomTree,
    root: obscura_dom::NodeId,
    response_csp: Option<String>,
) -> Option<String> {
    let Some(meta_csp) = meta_content_security_policy(dom, root) else {
        return response_csp;
    };
    let meta = crate::frame_policy::ContentSecurityPolicy::parse(&meta_csp);
    Some(match response_csp {
        Some(response) => {
            crate::frame_policy::ContentSecurityPolicy::parse(&response)
                .combined_with_required(&meta)
        }
        None => meta.serialized(),
    })
}

/// Escape a value for safe inclusion inside a JavaScript template
/// literal. The previous implementation only escaped `\`, `` ` `` and
/// `${`; that left U+2028 / U+2029 (the JS-specific line terminators)
/// and other control characters as breakout vectors. Done at the
/// callsite means future tweaks come back to one function.
fn escape_for_js_template_literal(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '`' => out.push_str("\\`"),
            '$' => out.push_str("\\$"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            '\u{0000}' => out.push_str("\\0"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct NetworkEvent {
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub resource_type: String,
    /// Browsing context that owns this request. `None` keeps the historical
    /// top-level/scripted event shape; frame navigations set this explicitly so
    /// CDP does not attribute a child response to the main frame.
    pub frame_id: Option<String>,
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub response_headers: Arc<std::collections::HashMap<String, String>>,
    pub body_size: usize,
    pub timestamp: f64,
}

#[derive(Debug, Clone)]
pub struct StoredResponseBody {
    pub body: String,
    pub base64_encoded: bool,
}

#[derive(Clone, Copy)]
struct DeviceMetricsBaseline {
    viewport: (f32, f32),
    device_scale_factor: f32,
}

/// Source registered through `Page.addScriptToEvaluateOnNewDocument`.
/// `world_name == None` targets each document's main world; a named entry
/// targets the matching isolated world id assigned by CDP.
#[derive(Clone, Debug)]
pub struct PreloadScript {
    pub source: String,
    pub world_name: Option<String>,
    pub world_id: u64,
}

impl PreloadScript {
    pub fn main_world(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            world_name: None,
            world_id: obscura_js::realm::MAIN_WORLD,
        }
    }
}

pub struct Page {
    pub id: String,
    pub frame_id: String,
    /// Browser-core frame tree (docs/Iframe-support-design.md Phase 1.7).
    /// The main frame is registered on construction; child entries appear
    /// when iframe browsing contexts are created. CDP projects this
    /// registry rather than keeping its own frame model.
    pub frames: crate::frames::FrameRegistry,
    /// Typed origin of the current top-level document, derived exactly once
    /// per committed document. Frame origin inheritance and same-origin
    /// checks share this instance so an opaque top origin (data:, sandboxed)
    /// keeps one identity; re-deriving from the URL would mint a fresh
    /// opaque id per call and break srcdoc same-origin access.
    pub document_origin: Option<obscura_dom::Origin>,
    /// Content-Security-Policy of the committed top-level response. Child
    /// frame requests consult its frame-src/child-src/default-src chain.
    document_csp: Option<String>,
    /// Raw Permissions-Policy of the committed top-level response.
    document_permissions_policy: Option<String>,
    /// COOP+COEP isolation capability of the committed top-level document.
    cross_origin_isolated: bool,
    /// Raw Last-Modified header of the committed top-level response.
    document_last_modified: Option<String>,
    pub url: Option<Url>,
    pub dom: Option<DomTree>,
    pub js: Option<ObscuraJsRuntime>,
    pub lifecycle: LifecycleState,
    pub http_client: Arc<ObscuraHttpClient>,
    pub context: Arc<BrowserContext>,
    /// Page-local browser identity. Network and JavaScript consume this same
    /// value, while CDP overrides remain isolated from sibling targets.
    pub fingerprint: obscura_net::BrowserFingerprint,
    /// sessionStorage namespace for this top-level browsing context. It
    /// survives document navigations but is not shared with another Page.
    session_storage: SharedStorageAreas,
    pub title: String,
    /// Source document URL for the current document. This is deliberately
    /// separate from `url`: direct automation navigations have no referrer,
    /// while a navigation requested by page script uses the previous document.
    pub referrer: String,
    /// Referrer-Policy selected by the current response or document metadata.
    pub referrer_policy: obscura_net::ReferrerPolicy,
    /// CSS viewport used by responsive page JavaScript and CDP screenshots.
    /// The physical `screen` fingerprint remains independent.
    pub viewport: (f32, f32),
    /// Optional CDP physical-screen override. This is separate from the CSS
    /// viewport and survives navigation, matching device-metrics emulation.
    screen_size_override: Option<(f32, f32)>,
    screen_metrics_emulated: bool,
    /// Metrics captured when CDP device emulation is first enabled. Chromium
    /// keeps this baseline across subsequent override calls and restores it
    /// only when the override is cleared.
    device_metrics_baseline: Option<DeviceMetricsBaseline>,
    /// Output device pixels per CSS pixel for CDP surface capture. Layout and
    /// CSSOM stay in CSS pixels; Emulation.setDeviceMetricsOverride owns this
    /// independent raster scale.
    pub device_scale_factor: f32,
    /// DevTools override for the compositor's base surface. It is page-owned,
    /// so it survives document navigation without leaking to other targets.
    default_background_color_override: Option<[u8; 4]>,
    /// WHATWG canonical name of the current document's character encoding
    /// (e.g. "UTF-8", "EUC-JP"), detected when the response body is decoded.
    /// Exposed to JS as `document.characterSet` and used for the URL query
    /// encoding override on `<a>`/`<area>` hrefs in legacy-charset documents.
    pub encoding: String,
    /// Monotonic origin for the current document's CSS animation timeline.
    /// It is reset once author styles are installed, so stylesheet download
    /// latency does not incorrectly advance newly-created animations.
    document_timeline_origin: std::time::Instant,
    /// Monotonic and wall-clock representations of the current navigation
    /// start. Performance entries use the former; Performance.timeOrigin uses
    /// the latter.
    performance_time_origin: std::time::Instant,
    performance_time_origin_ms: f64,
    /// Optional page-scoped ceiling for an end-to-end navigation. Automation
    /// frontends set this from their request timeout so a caller asking for a
    /// 50-second navigation is not silently cut off by the process default.
    /// Pages without an override retain the environment-configurable default.
    navigation_timeout: Option<std::time::Duration>,
    /// Navigation history for Page.getNavigationHistory / navigateToHistoryEntry.
    /// Entries are URLs in visit order; `history_index` is the current position.
    /// Pushed on every successful navigation; truncated on goBack -> new nav.
    pub history: Vec<String>,
    pub history_index: usize,
    pub network_events: Vec<NetworkEvent>,
    response_bodies: std::collections::HashMap<String, StoredResponseBody>,
    response_body_order: std::collections::VecDeque<String>,
    network_event_counter: u32,
    pub intercept_enabled: bool,
    pub intercept_block_patterns: Vec<String>,
    /// Child browsing context most recently focused by native input. CDP key
    /// events continue in that realm until a main-document press replaces it.
    input_frame_target: Option<(String, u64)>,
    pub blocked_url_patterns: Vec<String>,
    /// Optional embedder-owned interaction policy. It contains no site
    /// knowledge: a caller supplies a selector and timing profile.
    pub input_strategy: Option<InputStrategy>,
    intercept_tx: Option<tokio::sync::mpsc::UnboundedSender<obscura_js::ops::InterceptedRequest>>,
    // Scripts to execute in the page's JS context BEFORE any of the page's
    // own scripts run — the CDP `Page.addScriptToEvaluateOnNewDocument`
    // contract. Includes `Runtime.addBinding` shims so puppeteer's
    // `exposeFunction` bindings exist before inline `<script>` tags execute.
    preload_scripts: Vec<PreloadScript>,
    debugger_enabled: bool,
    /// Document-owned HTML script preparation flags saved while the V8 realm
    /// is suspended for CDP/MCP tab switching.  These are restored only when
    /// the same surviving DomTree is resumed; navigation clears them.
    suspended_started_script_ids: Vec<u32>,
    /// Passive on_request/on_response callbacks, scoped to this page (issue
    /// #408): they fire only for requests this page drives and die with it.
    /// Arc because the JS runtime state holds a second handle for fetch()/XHR.
    callbacks: Arc<CallbackRegistry>,
    /// Materialized frame stylesheet graphs keyed by canonical root URL
    /// (Phase 3.6). The same sheet referenced from several frames is fetched
    /// once per top-level navigation; None caches a failed fetch.
    frame_stylesheet_cache: std::collections::HashMap<String, Option<String>>,
    /// Performance Timeline entries produced while no runtime can accept
    /// them. Child frames load either before `init_js` builds the runtime
    /// that answers `performance.getEntriesByType`, or with the DomTree on
    /// loan out of the runtime; recording straight away in the first case
    /// wrote into a runtime about to be discarded.
    deferred_performance_entries: Vec<serde_json::Value>,
    /// Nesting depth of the windows described above. A counter rather than a
    /// flag because a frame navigation can start during page navigation.
    performance_entries_deferred: usize,
    #[cfg(feature = "stealth")]
    pub stealth_client: Option<Arc<StealthHttpClient>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct InputStrategy {
    pub selector: String,
    pub delay_ms: u64,
    pub key_delay_ms: u64,
}

impl InputStrategy {
    pub fn selector(selector: impl Into<String>) -> Self {
        Self { selector: selector.into(), delay_ms: 0, key_delay_ms: 25 }
    }
}

const MAX_STYLESHEET_IMPORT_DEPTH: u8 = 4;
const MAX_STYLESHEET_RESOURCES: usize = 128;
const DEFAULT_NAVIGATION_TIMEOUT_MS: u64 = 30_000;

fn default_navigation_timeout() -> std::time::Duration {
    navigation_timeout_from_env_value(std::env::var("OBSCURA_NAV_TIMEOUT_MS").ok().as_deref())
}

fn navigation_timeout_from_env_value(value: Option<&str>) -> std::time::Duration {
    let milliseconds = value
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_NAVIGATION_TIMEOUT_MS);
    std::time::Duration::from_millis(milliseconds)
}

fn duration_millis_u64(duration: std::time::Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

#[derive(Clone)]
struct LoadedStylesheet {
    response_url: Url,
    imports: Vec<StylesheetImport>,
    rules: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct StylesheetImport {
    url: String,
    media: Option<String>,
}

#[derive(Clone, Copy)]
enum AuthorStylesheetTarget {
    Linked(usize),
    InlineImport(usize),
}

fn canonical_stylesheet_url(mut url: Url) -> (String, Url) {
    url.set_fragment(None);
    (url.to_string(), url)
}

/// Expand a cached stylesheet graph in CSS cascade order. Network deduplication
/// is separate from expansion: a shared import is downloaded once but expanded
/// at each import position, while the active stack cuts cycles.
fn materialize_stylesheet_graph(
    key: &str,
    sheets: &std::collections::HashMap<String, LoadedStylesheet>,
    aliases: &std::collections::HashMap<String, String>,
    active: &mut std::collections::HashSet<String>,
) -> Option<String> {
    let actual_key = aliases.get(key).map(String::as_str).unwrap_or(key);
    if !active.insert(actual_key.to_string()) {
        return None;
    }
    let Some(sheet) = sheets.get(actual_key).cloned() else {
        active.remove(actual_key);
        return None;
    };

    let mut output = String::new();
    for import in &sheet.imports {
        let Ok(import_url) = sheet.response_url.join(&import.url) else {
            continue;
        };
        let (import_key, _) = canonical_stylesheet_url(import_url);
        if let Some(imported) = materialize_stylesheet_graph(&import_key, sheets, aliases, active) {
            if let Some(media) = import.media.as_deref() {
                output.push_str("@media ");
                output.push_str(media);
                output.push_str(" {\n");
                output.push_str(&imported);
                output.push_str("\n}\n");
            } else {
                output.push_str(&imported);
                output.push('\n');
            }
        }
    }
    output.push_str(&rebase_css_urls(&sheet.rules, &sheet.response_url));
    active.remove(actual_key);
    Some(output)
}

/// Preserve the URL base of a fetched stylesheet after it is materialized as
/// inline CSS. Relative `url(...)` values resolve against the stylesheet's
/// URL in browsers, not the document URL; failing to rebase them drops common
/// background, mask, cursor, and font assets from nested theme directories.
fn rebase_css_urls(css: &str, base: &url::Url) -> String {
    let mut out = String::with_capacity(css.len());
    let mut index = 0usize;
    while index < css.len() {
        let rest = &css[index..];
        if rest.starts_with("/*") {
            if let Some(end) = rest[2..].find("*/") {
                let length = end + 4;
                out.push_str(&rest[..length]);
                index += length;
            } else {
                out.push_str(rest);
                break;
            }
            continue;
        }
        let Some(first) = rest.chars().next() else {
            break;
        };
        if first == '"' || first == '\'' {
            let quote = first;
            let mut escaped = false;
            let mut length = quote.len_utf8();
            for ch in rest[quote.len_utf8()..].chars() {
                length += ch.len_utf8();
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == quote {
                    break;
                }
            }
            out.push_str(&rest[..length]);
            index += length;
            continue;
        }
        let is_url = rest
            .get(..4)
            .map_or(false, |prefix| prefix.eq_ignore_ascii_case("url("));
        if !is_url {
            out.push(first);
            index += first.len_utf8();
            continue;
        }

        let mut quote = None;
        let mut escaped = false;
        let mut end = None;
        for (offset, ch) in rest[4..].char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            match quote {
                Some(open) if ch == open => quote = None,
                Some(_) => {}
                None if ch == '"' || ch == '\'' => quote = Some(ch),
                None if ch == ')' => {
                    end = Some(4 + offset);
                    break;
                }
                None => {}
            }
        }
        let Some(end) = end else {
            out.push_str(rest);
            break;
        };
        let raw = rest[4..end].trim();
        let value = if raw.len() >= 2
            && ((raw.starts_with('"') && raw.ends_with('"'))
                || (raw.starts_with('\'') && raw.ends_with('\'')))
        {
            &raw[1..raw.len() - 1]
        } else {
            raw
        };
        let resolved = if value.is_empty()
            || value.starts_with('#')
            || value.contains("var(")
            || url::Url::parse(value).is_ok()
        {
            None
        } else {
            base.join(value).ok().map(|url| url.to_string())
        };
        if let Some(resolved) = resolved {
            out.push_str("url(\"");
            for ch in resolved.chars() {
                if ch == '\\' || ch == '"' {
                    out.push('\\');
                }
                out.push(ch);
            }
            out.push_str("\")");
        } else {
            out.push_str(&rest[..=end]);
        }
        index += end + 1;
    }
    out
}

/// Extract network-backed `url(...)` assets while respecting CSS comments and
/// strings. Linked sheets have already been rebased before materialization;
/// inline declarations are resolved against the document base here.
#[cfg(any(feature = "render", test))]
fn css_resource_urls(css: &str, base: &url::Url) -> Vec<String> {
    let mut urls = Vec::new();
    let mut index = 0usize;
    while index < css.len() {
        let rest = &css[index..];
        if rest.starts_with("/*") {
            if let Some(end) = rest[2..].find("*/") {
                index += end + 4;
            } else {
                break;
            }
            continue;
        }
        // `@import url(...)` is a stylesheet dependency, not a paint asset.
        // It is fetched by the bounded stylesheet graph above. Letting the
        // generic image/font warmup rediscover it issues a second request with
        // the wrong ResourceType::Image classification.
        if let Some(length) = css_import_rule_len(rest) {
            index += length;
            continue;
        }
        let Some(first) = rest.chars().next() else {
            break;
        };
        if first == '"' || first == '\'' {
            let quote = first;
            let mut escaped = false;
            let mut length = quote.len_utf8();
            for ch in rest[quote.len_utf8()..].chars() {
                length += ch.len_utf8();
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == quote {
                    break;
                }
            }
            index += length;
            continue;
        }
        if !rest
            .get(..4)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("url("))
        {
            index += first.len_utf8();
            continue;
        }
        let mut quote = None;
        let mut escaped = false;
        let mut end = None;
        for (offset, ch) in rest[4..].char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            match quote {
                Some(open) if ch == open => quote = None,
                Some(_) => {}
                None if ch == '"' || ch == '\'' => quote = Some(ch),
                None if ch == ')' => {
                    end = Some(4 + offset);
                    break;
                }
                None => {}
            }
        }
        let Some(end) = end else { break };
        let raw = rest[4..end].trim();
        let value = if raw.len() >= 2
            && ((raw.starts_with('"') && raw.ends_with('"'))
                || (raw.starts_with('\'') && raw.ends_with('\'')))
        {
            &raw[1..raw.len() - 1]
        } else {
            raw
        };
        if !value.is_empty()
            && !value.starts_with('#')
            && !value.starts_with("data:")
            && !value.contains("var(")
        {
            if let Ok(mut url) = base.join(value) {
                url.set_fragment(None);
                if matches!(url.scheme(), "http" | "https") {
                    urls.push(url.to_string());
                }
            }
        }
        index += end + 1;
    }
    urls
}

/// Return the byte length of a leading CSS `@import` rule, including its
/// terminating semicolon. Semicolons inside quoted URLs, comments, or `url()`
/// parentheses do not end the rule. A malformed import is left to the normal
/// scanner so this helper cannot swallow following declarations.
#[cfg(any(feature = "render", test))]
fn css_import_rule_len(css: &str) -> Option<usize> {
    let prefix = css.get(..7)?;
    if !prefix.eq_ignore_ascii_case("@import") {
        return None;
    }
    if css[7..]
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return None;
    }

    let bytes = css.as_bytes();
    let mut index = 7usize;
    let mut quote = None;
    let mut escaped = false;
    let mut paren_depth = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(open) = quote {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == open {
                quote = None;
            }
            index += 1;
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            let Some(end) = css[index + 2..].find("*/") else {
                return None;
            };
            index += end + 4;
            continue;
        }
        match byte {
            b'\'' | b'"' => quote = Some(byte),
            b'(' => paren_depth += 1,
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b';' if paren_depth == 0 => return Some(index + 1),
            b'{' if paren_depth == 0 => return None,
            _ => {}
        }
        index += 1;
    }
    None
}

#[cfg(any(feature = "render", test))]
fn render_resource_type(url: &url::Url) -> ResourceType {
    let path = url.path().to_ascii_lowercase();
    if [".woff", ".woff2", ".ttf", ".otf", ".eot"]
        .iter()
        .any(|extension| path.ends_with(extension))
    {
        ResourceType::Font
    } else {
        ResourceType::Image
    }
}

/// Pull leading `@import` rules out of a stylesheet. Returns each import target
/// URL with its optional media condition plus the CSS with those `@import`
/// statements removed. Browsers fetch media-gated imports even when they do
/// not match the current screen; preserving the condition lets the same bytes
/// participate in a later PDF print cascade. Handles `@import "x.css";`,
/// `@import url("x.css");`, `@import url(x.css);` and an optional trailing
/// media query.
fn split_css_imports(css: &str) -> (Vec<StylesheetImport>, String) {
    let mut urls = Vec::new();
    let mut stripped = String::with_capacity(css.len());
    let mut rest = css;
    loop {
        let Some(pos) = rest.find("@import") else {
            stripped.push_str(rest);
            break;
        };
        // Real sheets place `@import` at the top (after an optional @charset), so
        // scanning for it anywhere is safe in practice and tolerates minified
        // whitespace. Text before this match carries through unchanged.
        stripped.push_str(&rest[..pos]);
        let after = &rest[pos + "@import".len()..];
        let Some(semi) = after.find(';') else {
            // Malformed; keep the remainder verbatim.
            stripped.push_str(&rest[pos..]);
            break;
        };
        let stmt = &after[..semi];
        if let Some(target) = parse_import_url(stmt) {
            urls.push(target);
        } else {
            // Could not parse a URL; preserve the statement so we don't lose it.
            stripped.push_str("@import");
            stripped.push_str(&after[..=semi]);
        }
        rest = &after[semi + 1..];
    }
    (urls, stripped)
}

/// Extract the URL and optional trailing media query from an `@import`
/// statement body (the text between `@import` and `;`).
fn parse_import_url(stmt: &str) -> Option<StylesheetImport> {
    let s = stmt.trim();
    let is_url_fn = s.len() >= 4 && s[..4].eq_ignore_ascii_case("url(");
    let (url, media) = if is_url_fn {
        let rest = &s[4..];
        let end = rest.find(')')?;
        let inner = rest[..end].trim().trim_matches(|c| c == '"' || c == '\'');
        (inner.to_string(), rest[end + 1..].trim())
    } else {
        let quote = s.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let rest = &s[1..];
        let end = rest.find(quote)?;
        (rest[..end].to_string(), rest[end + 1..].trim())
    };
    if url.is_empty() {
        return None;
    }
    Some(StylesheetImport {
        url,
        media: (!media.is_empty()).then(|| media.to_string()),
    })
}

/// Materialize a fetched linked sheet immediately after its source `<link>`.
///
/// Keeping each sheet at its document position matters when linked and inline
/// author sheets are interleaved. Appending one aggregate `<style>` to `<head>`
/// makes every external rule later than every inline rule, which changes the
/// CSS cascade even when the external fetches themselves complete in order.
/// The synthetic style retains the link's effective media query so the same
/// fetched bytes can enter print layout without leaking into screen layout.
fn materialize_linked_stylesheet_script(link_index: usize, css: &str) -> String {
    let escaped_css = escape_for_js_template_literal(css);
    format!(
        r#"(function() {{
            var links = document.querySelectorAll('link[rel~="stylesheet"]');
            var link = links[{link_index}];
            if (!link || !link.parentNode) return;
            var style = null;
            function effectiveMedia() {{
                // Until the generic Element shim reflects HTMLLinkElement.media,
                // `this.media = "all"` creates an own property while the parsed
                // media="print" attribute remains unchanged.
                if (Object.prototype.hasOwnProperty.call(link, 'media')) {{
                    return String(link.media || '');
                }}
                return link.getAttribute('media') || '';
            }}
            function syncSheet() {{
                if (!style) {{
                    style = document.createElement('style');
                    style.setAttribute('data-obscura-external-stylesheets', '');
                    style.textContent = `{escaped_css}`;
                    globalThis.__obscura_registerLinkedStylesheet(link, style);
                }}
                var enabled = link.parentNode
                    && !link.disabled
                    && !link.hasAttribute('disabled');
                if (!enabled) {{
                    if (style && style.parentNode) style.parentNode.removeChild(style);
                    return;
                }}
                var media = effectiveMedia().trim();
                if (media) style.setAttribute('media', media);
                else style.removeAttribute('media');
                if (!style.parentNode) {{
                    link.parentNode.insertBefore(style, link.nextSibling);
                }}
            }}

            // A non-matching sheet still loads and fires its event. Its handler
            // may then make the sheet applicable (the common
            // media=print/onload="this.media='all'" async-CSS pattern).
            syncSheet();
            try {{ link.dispatchEvent(new Event('load')); }}
            finally {{ syncSheet(); }}
        }})()"#
    )
}

/// Materialize one fetched `@import` immediately before its source inline
/// `<style>`. Imported rules precede the importing sheet in the author cascade,
/// and inherit the source sheet's own media condition in addition to the
/// import rule's media wrapper.
fn materialize_inline_import_script(style_index: usize, css: &str) -> String {
    let escaped_css = escape_for_js_template_literal(css);
    format!(
        r#"(function() {{
            var styles = document.querySelectorAll('style');
            var source = null;
            var authorIndex = -1;
            for (var i = 0; i < styles.length; i++) {{
                var candidate = styles[i];
                if (candidate.hasAttribute('data-obscura-external-stylesheets')
                    || candidate.hasAttribute('data-obscura-inline-import')) continue;
                authorIndex++;
                if (authorIndex === {style_index}) {{ source = candidate; break; }}
            }}
            if (!source || !source.parentNode) return;
            var imported = document.createElement('style');
            imported.setAttribute('data-obscura-inline-import', '');
            var media = source.getAttribute('media') || '';
            if (media.trim()) imported.setAttribute('media', media);
            imported.textContent = `{escaped_css}`;
            source.parentNode.insertBefore(imported, source);
        }})()"#
    )
}

/// Discover linked author sheets in document order.
///
/// Media queries control whether a loaded sheet participates in the cascade;
/// they do not suppress its fetch or `load` event. Keep the index among all
/// stylesheet links so the materialization script addresses the same node.
fn linked_stylesheet_requests(dom: &DomTree) -> Vec<(usize, String)> {
    let link_ids = dom
        .query_selector_all("link[rel~=\"stylesheet\"]")
        .unwrap_or_default();
    let mut links = Vec::new();
    for (link_index, lid) in link_ids.into_iter().enumerate() {
        if let Some(node) = dom.get_node(lid) {
            // Disabled alternate sheets remain dormant until script enables
            // them. Media-gated sheets are different: they still load.
            if node.get_attribute("disabled").is_some() {
                continue;
            }
            if let Some(href) = node.get_attribute("href") {
                links.push((link_index, href.to_string()));
            }
        }
    }
    links
}

/// Discover fetchable `@import` rules in inline author sheets. The source
/// index excludes Obscura's own materialized sheets so it remains stable while
/// imports are inserted before their source nodes.
fn inline_stylesheet_import_requests(dom: &DomTree) -> Vec<(usize, StylesheetImport)> {
    let style_ids = dom.query_selector_all("style").unwrap_or_default();
    let mut imports = Vec::new();
    let mut author_index = 0usize;
    for style_id in style_ids {
        let Some(node) = dom.get_node(style_id) else {
            continue;
        };
        if node
            .get_attribute("data-obscura-external-stylesheets")
            .is_some()
            || node.get_attribute("data-obscura-inline-import").is_some()
        {
            continue;
        }
        let (style_imports, _) = split_css_imports(&dom.text_content(style_id));
        imports.extend(
            style_imports
                .into_iter()
                .map(|import| (author_index, import)),
        );
        author_index += 1;
    }
    imports
}

impl Page {
    pub fn new(id: String, context: Arc<BrowserContext>) -> Self {
        let fingerprint = context.fingerprint.clone();
        let http_client = Arc::new(
            context.http_client.fork_with_fingerprint(fingerprint.clone())
        );
        let device_scale_factor = fingerprint.screen.device_scale_factor as f32;
        // Chromium convention: the main frame's frameId == the targetId.
        // Playwright's frame manager looks up the main frame by targetId
        // (via target._targetInfo.targetId), so any divergence here makes
        // Page.getFrameTree return a frame the client cannot match,
        // triggering a Target.closeTarget and "Frame has been detached".
        let frame_id = id.clone();
        #[cfg(feature = "stealth")]
        let stealth_client = if context.stealth {
            // The wreq client backing StealthHttpClient does not speak SOCKS5.
            // Callers must validate the proxy scheme up front and fail loudly
            // (see obscura-cli) rather than silently rewriting socks5:// to
            // http://, which only works when the upstream happens to be a
            // Clash-style mixed-mode proxy and breaks plain SOCKS5 servers
            // like `ssh -ND` (#160).
            Some(Arc::new(StealthHttpClient::with_proxy_and_fingerprint(
                context.cookie_jar.clone(),
                context.proxy_url.as_deref(),
                fingerprint.clone(),
            )))
        } else {
            None
        };

        Page {
            id,
            frames: crate::frames::FrameRegistry::new(frame_id.clone()),
            frame_id,
            document_origin: None,
            document_csp: None,
            document_permissions_policy: None,
            cross_origin_isolated: false,
            document_last_modified: None,
            url: None,
            dom: None,
            js: None,
            lifecycle: LifecycleState::Idle,
            http_client,
            context,
            fingerprint,
            session_storage: new_storage_areas(),
            title: String::new(),
            referrer: String::new(),
            referrer_policy: obscura_net::ReferrerPolicy::default(),
            viewport: (1280.0, 720.0),
            screen_size_override: None,
            screen_metrics_emulated: false,
            device_metrics_baseline: None,
            device_scale_factor,
            default_background_color_override: None,
            encoding: "UTF-8".to_string(),
            document_timeline_origin: std::time::Instant::now(),
            performance_time_origin: std::time::Instant::now(),
            performance_time_origin_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64()
                * 1_000.0,
            navigation_timeout: None,
            history: Vec::new(),
            history_index: 0,
            network_events: Vec::new(),
            response_bodies: std::collections::HashMap::new(),
            response_body_order: std::collections::VecDeque::new(),
            network_event_counter: 0,
            intercept_enabled: false,
            intercept_block_patterns: Vec::new(),
            input_frame_target: None,
            blocked_url_patterns: Vec::new(),
            input_strategy: std::env::var("OBSCURA_AUTO_CLICK_SELECTOR")
                .ok()
                .filter(|selector| !selector.trim().is_empty())
                .map(InputStrategy::selector),
            intercept_tx: None,
            preload_scripts: Vec::new(),
            debugger_enabled: false,
            suspended_started_script_ids: Vec::new(),
            callbacks: Arc::new(CallbackRegistry::new()),
            frame_stylesheet_cache: std::collections::HashMap::new(),
            deferred_performance_entries: Vec::new(),
            performance_entries_deferred: 0,
            #[cfg(feature = "stealth")]
            stealth_client,
        }
    }

    /// Set the end-to-end navigation deadline for this page. This page-scoped
    /// value takes precedence over `OBSCURA_NAV_TIMEOUT_MS`; callers that do
    /// not set it retain the existing environment-configurable 30s default.
    pub fn set_navigation_timeout(&mut self, timeout: std::time::Duration) {
        self.navigation_timeout = Some(timeout);
    }

    /// Install a generic selector-based interaction policy. The selector is
    /// evaluated in the current document; no hostname or visible text is
    /// inspected by the browser core.
    pub fn set_input_strategy(&mut self, strategy: Option<InputStrategy>) {
        self.input_strategy = strategy;
    }

    /// Return the effective end-to-end navigation deadline for this page.
    pub fn navigation_timeout(&self) -> std::time::Duration {
        self.navigation_timeout
            .unwrap_or_else(default_navigation_timeout)
    }

    fn should_block_url(&self, url: &str) -> bool {
        for pattern in &self.blocked_url_patterns {
            if url_matches_cdp_pattern(pattern, url) {
                return true;
            }
        }
        if self.intercept_enabled {
            for pattern in &self.intercept_block_patterns {
                if url_matches_cdp_pattern(pattern, url) {
                    return true;
                }
            }
        }
        false
    }

    /// Update the page's CSS viewport. Calling this before navigation makes
    /// responsive scripts observe it from their first instruction; calling it
    /// on a live page mirrors CDP's device-metrics override surfaces.
    pub fn set_viewport(&mut self, viewport: (f32, f32)) {
        if !viewport.0.is_finite()
            || !viewport.1.is_finite()
            || viewport.0 <= 0.0
            || viewport.1 <= 0.0
        {
            return;
        }
        self.viewport = viewport;
        if let Some(js) = &mut self.js {
            js.set_viewport(viewport.0 as f64, viewport.1 as f64);
        }
    }

    /// Set or clear the CDP physical-screen override independently of layout.
    pub fn set_screen_size_override(&mut self, size: Option<(f32, f32)>, emulated: bool) {
        self.screen_size_override = size.filter(|(width, height)| {
            width.is_finite() && height.is_finite() && *width > 0.0 && *height > 0.0
        });
        self.screen_metrics_emulated = emulated;
        if let Some(js) = &mut self.js {
            js.set_screen_size_override(
                self.screen_size_override
                    .map(|(width, height)| (width as f64, height as f64)),
                self.screen_metrics_emulated,
            );
        }
    }

    /// Apply CDP device metrics relative to the metrics that were active when
    /// emulation was first enabled. A zero protocol dimension/scale is passed
    /// as `None` and therefore restores that axis from the retained baseline.
    pub fn apply_device_metrics_override(
        &mut self,
        width: Option<f32>,
        height: Option<f32>,
        device_scale_factor: Option<f32>,
        screen_size: Option<(f32, f32)>,
        mobile: bool,
    ) {
        let baseline = *self
            .device_metrics_baseline
            .get_or_insert(DeviceMetricsBaseline {
                viewport: self.viewport,
                device_scale_factor: self.device_scale_factor,
            });
        let viewport = (
            width.unwrap_or(baseline.viewport.0),
            height.unwrap_or(baseline.viewport.1),
        );
        self.set_viewport(viewport);

        // Blink uses the effective widget size as the screen size for mobile
        // emulation when no complete explicit screen size was supplied.
        let effective_screen_size = screen_size.or_else(|| mobile.then_some(viewport));
        self.set_screen_size_override(effective_screen_size, true);
        self.set_device_scale_factor(device_scale_factor.unwrap_or(baseline.device_scale_factor));
    }

    /// Disable CDP device metrics and restore the state captured by the first
    /// override. Clearing while emulation is inactive is intentionally a no-op.
    pub fn clear_device_metrics_override(&mut self) {
        let Some(baseline) = self.device_metrics_baseline.take() else {
            return;
        };
        self.set_viewport(baseline.viewport);
        self.set_screen_size_override(None, false);
        self.set_device_scale_factor(baseline.device_scale_factor);
    }

    /// Set the screenshot surface density without changing CSS layout. CDP
    /// uses zero to disable its override, which restores the native 1x surface
    /// in Obscura's headless-only model.
    pub fn set_device_scale_factor(&mut self, device_scale_factor: f32) {
        if !device_scale_factor.is_finite() || device_scale_factor < 0.0 {
            return;
        }
        self.device_scale_factor = if device_scale_factor == 0.0 {
            1.0
        } else {
            device_scale_factor
        };
        self.fingerprint.screen.device_scale_factor = self.device_scale_factor as f64;
        if let Some(js) = &mut self.js {
            js.set_fingerprint(&self.fingerprint);
            let _ = js.execute_script(
                "<device-metrics>",
                &format!("globalThis.devicePixelRatio={};", self.device_scale_factor),
            );
        }
    }

    /// Install a complete value-level identity for this page. Navigator,
    /// UA-CH, low-entropy request headers, and subsequently-created workers
    /// all observe this same contract.
    pub async fn set_browser_fingerprint(
        &mut self,
        fingerprint: obscura_net::BrowserFingerprint,
    ) {
        if self.device_metrics_baseline.is_none() {
            self.device_scale_factor = fingerprint.screen.device_scale_factor as f32;
        }
        self.fingerprint = fingerprint;
        self.http_client.set_fingerprint(self.fingerprint.clone()).await;
        #[cfg(feature = "stealth")]
        if let Some(client) = &self.stealth_client {
            client.set_fingerprint(self.fingerprint.clone()).await;
        }
        if let Some(js) = &mut self.js {
            js.set_fingerprint(&self.fingerprint);
            js.set_screen_size_override(
                self.screen_size_override
                    .map(|(width, height)| (width as f64, height as f64)),
                self.screen_metrics_emulated,
            );
            let _ = js.execute_script(
                "<device-metrics>",
                &format!("globalThis.devicePixelRatio={};", self.device_scale_factor),
            );
        }
        tracing::debug!(
            target: "obscura::fingerprint",
            user_agent = %self.fingerprint.user_agent,
            navigator_platform = %self.fingerprint.navigator_platform,
            ua_platform = %self.fingerprint.ua_platform,
            browser_version = %self.fingerprint.browser_version,
            mobile = self.fingerprint.mobile,
            "page fingerprint updated"
        );
    }

    pub fn set_default_background_color_override(&mut self, color: Option<[u8; 4]>) {
        self.default_background_color_override = color;
    }

    #[cfg(feature = "render")]
    fn capture_surface_color(&self) -> [u8; 4] {
        self.default_background_color_override
            .unwrap_or([255, 255, 255, 255])
    }

    async fn do_fetch(
        &self,
        url: &Url,
        referrer: &str,
        policy: obscura_net::ReferrerPolicy,
    ) -> Result<Response, ObscuraNetError> {
        let referrer = Url::parse(referrer).ok();
        #[cfg(feature = "stealth")]
        if let Some(ref stealth) = self.stealth_client {
            return stealth
                .fetch_document_with_referrer(url, referrer, policy, Some(&self.callbacks))
                .await;
        }
        self.http_client
            .fetch_document_with_referrer(url, referrer, policy, Some(&self.callbacks))
            .await
    }
    fn init_js(&mut self) {
        // init_js is also the new-document path.  Only resume_js explicitly
        // takes these IDs out before entering here and restores them after the
        // same DomTree is installed; a navigation must never inherit IDs from
        // a suspended prior document whose allocator may reuse them.
        self.suspended_started_script_ids.clear();
        // Drop any existing runtime so the JS realm starts clean on
        // every navigation. The old code reused the V8 isolate and
        // only re-bound `globalThis.document`, leaving window.onload,
        // custom window properties and event handlers from the prior
        // page in place. That made it possible for a page to set
        // attacker-controlled state, trigger a navigation, and then
        // run code in the next document's context.
        if self.js.is_some() {
            let _ = self.js.take();
        }

        // Thread the BrowserContext's proxy through to the ES-module loader
        // and op_fetch_url so dynamic imports and JS fetch() honour the
        // configured upstream proxy (#139). When proxy_url is None this is
        // equivalent to with_base_url() (direct connection).
        let mut rt = ObscuraJsRuntime::with_base_url_and_proxy(
            &self.url_string(),
            self.context.proxy_url.clone(),
        );
        rt.set_url(&self.url_string());
        if let Some(origin) = &self.document_origin {
            rt.set_top_origin(origin.clone());
        }
        rt.set_encoding(&self.encoding);
        rt.set_title(&self.title);
        rt.set_referrer(&self.referrer);
        rt.set_referrer_policy(self.referrer_policy.as_str());
        rt.set_last_modified(self.document_last_modified.as_deref());
        rt.set_performance_time_origin(self.performance_time_origin_ms);

        #[cfg(feature = "stealth")]
        rt.set_stealth(self.stealth_client.is_some());
        rt.set_fingerprint(&self.fingerprint);
        if let Some((lat, lon)) = env_geolocation() {
            rt.set_geolocation(lat, lon);
        }
        rt.set_viewport(self.viewport.0 as f64, self.viewport.1 as f64);
        rt.set_screen_size_override(
            self.screen_size_override
                .map(|(width, height)| (width as f64, height as f64)),
            self.screen_metrics_emulated,
        );

        rt.set_cookie_jar(self.context.cookie_jar.clone());
        rt.set_storage_dir(self.context.storage_dir.clone());
        rt.set_storage_areas(
            self.context.local_storage.clone(),
            self.session_storage.clone(),
        );
        rt.set_shared_worker_registry(self.context.shared_worker_registry.clone());
        rt.set_privacy_policy(self.context.privacy_policy.clone());
        rt.set_private_token_query_state(self.context.private_token_query_state.clone());
        rt.set_http_client(self.http_client.clone());
        rt.set_callbacks(self.callbacks.clone());
        rt.set_blocked_urls(self.blocked_url_patterns.clone());
        if let Some(strategy) = &self.input_strategy {
            rt.set_input_strategy(Some(&strategy.selector), strategy.delay_ms, strategy.key_delay_ms);
        }
        #[cfg(feature = "stealth")]
        if let Some(ref stealth) = self.stealth_client {
            rt.set_stealth_client(stealth.clone());
        }

        if let Some(tx) = &self.intercept_tx {
            rt.set_intercept_tx(tx.clone());
        }
        // Re-apply intercept_enabled: enable_interception()/enable_intercept()
        // called before the first navigation sets this on the Page while the
        // runtime does not exist yet, so the new runtime would otherwise start
        // with interception disabled and op_fetch_url would never intercept.
        rt.set_intercept_enabled(self.intercept_enabled);
        // The document's policy has to be installed here rather than where the
        // response headers are read: a navigation reads them before this
        // runtime exists, so pushing it there is a no-op on a fresh page and is
        // undone by the runtime this function replaces. Missing it leaves every
        // scripted fetch unchecked while script-src and style-src still work,
        // because those are evaluated on the browser side.
        rt.set_content_security_policy(self.document_csp.as_deref());
        rt.set_permissions_policy(self.document_permissions_policy.as_deref());
        rt.set_cross_origin_isolated(self.cross_origin_isolated);

        if let Some(dom) = self.dom.take() {
            rt.set_dom(dom);
        }

        if self.debugger_enabled {
            rt.enable_debugger();
        }
        rt.run_page_init();
        let _ = rt.execute_script(
            "<device-metrics>",
            &format!("globalThis.devicePixelRatio={};", self.device_scale_factor),
        );

        self.js = Some(rt);
    }

    fn record_performance_response(
        &mut self,
        response: &obscura_net::Response,
        entry_type: &str,
        initiator_type: &str,
    ) {
        if entry_type == "resource" && !matches!(response.url.scheme(), "http" | "https") {
            return;
        }
        let transport_start = response
            .timing
            .start
            .checked_duration_since(self.performance_time_origin)
            .unwrap_or_default()
            .as_secs_f64()
            * 1_000.0;
        let start_time = if entry_type == "navigation" { 0.0 } else { transport_start };
        let response_start = transport_start + response.timing.response_start.as_secs_f64() * 1_000.0;
        let response_end = transport_start + response.timing.response_end.as_secs_f64() * 1_000.0;
        let redirect_end = if response.redirected_from.is_empty() {
            0.0
        } else {
            transport_start + response.timing.redirect_end.as_secs_f64() * 1_000.0
        };
        let body_size = response.body.len();
        let document_origin = self
            .url
            .as_ref()
            .map(|url| url.origin().ascii_serialization())
            .unwrap_or_default();
        let same_origin = response.url.origin().ascii_serialization() == document_origin;
        let timing_allowed = entry_type != "resource"
            || same_origin
            || response.header("timing-allow-origin").is_some_and(|value| {
                value.split(',').map(str::trim).any(|allowed| {
                    allowed == "*" || (!document_origin.is_empty() && allowed == document_origin)
                })
            });
        let exposed_response_start = if timing_allowed { response_start } else { 0.0 };
        let exposed_size = if timing_allowed { body_size } else { 0 };
        let exposed_status = if timing_allowed { response.status } else { 0 };
        // transferSize counts the response headers too, so it is always larger
        // than encodedBodySize on a real connection; the gap is a flat 300
        // bytes over h2. Reporting them equal is one subtraction away from
        // being obvious. A denied Timing-Allow-Origin hides the protocol as
        // well as the sizes, which is the only case where "" is correct.
        const RESOURCE_HEADER_BYTES: usize = 300;
        let transfer_size = if exposed_size > 0 {
            exposed_size + RESOURCE_HEADER_BYTES
        } else {
            0
        };
        let next_hop_protocol = if !timing_allowed {
            ""
        } else if response.url.scheme() == "https" {
            "h2"
        } else {
            "http/1.1"
        };
        let entry = serde_json::json!({
            "name": response.url.as_str(),
            "entryType": entry_type,
            "initiatorType": initiator_type,
            "startTime": start_time,
            "duration": (response_end - start_time).max(0.0),
            "redirectStart": if response.redirected_from.is_empty() { 0.0 } else { transport_start },
            "redirectEnd": redirect_end,
            "fetchStart": transport_start,
            "domainLookupStart": if timing_allowed { transport_start } else { 0.0 },
            "domainLookupEnd": if timing_allowed { transport_start } else { 0.0 },
            "connectStart": if timing_allowed { transport_start } else { 0.0 },
            "connectEnd": if timing_allowed { transport_start } else { 0.0 },
            "requestStart": if timing_allowed { transport_start } else { 0.0 },
            "responseStart": exposed_response_start,
            "responseEnd": response_end,
            "nextHopProtocol": next_hop_protocol,
            "transferSize": transfer_size,
            "encodedBodySize": exposed_size,
            "decodedBodySize": exposed_size,
            "responseStatus": exposed_status,
            "redirectCount": response.redirected_from.len(),
            "type": "navigate",
        });
        tracing::debug!(
            target: "obscura::performance",
            entry_type,
            initiator_type,
            url = %response.url,
            start_time_ms = start_time,
            response_start_ms = response_start,
            response_end_ms = response_end,
            body_size,
            "recording Performance Timeline entry",
        );
        self.record_performance_entry(entry);
    }

    /// Build the navigation entry visible inside a committed frame document.
    /// Unlike the embedding page's cross-origin iframe resource entry, this
    /// entry belongs to the response's own realm and therefore exposes its
    /// timing and body sizes without a Timing-Allow-Origin grant.
    fn frame_navigation_performance_entry(
        response: &obscura_net::Response,
    ) -> serde_json::Value {
        let response_start = response.timing.response_start.as_secs_f64() * 1_000.0;
        let response_end = response.timing.response_end.as_secs_f64() * 1_000.0;
        let redirect_end = if response.redirected_from.is_empty() {
            0.0
        } else {
            response.timing.redirect_end.as_secs_f64() * 1_000.0
        };
        let body_size = response.body.len();
        const RESOURCE_HEADER_BYTES: usize = 300;
        serde_json::json!({
            "name": response.url.as_str(),
            "entryType": "navigation",
            "initiatorType": "navigation",
            "startTime": 0.0,
            "duration": response_end,
            "redirectStart": 0.0,
            "redirectEnd": redirect_end,
            "fetchStart": 0.0,
            "domainLookupStart": 0.0,
            "domainLookupEnd": 0.0,
            "connectStart": 0.0,
            "connectEnd": 0.0,
            "requestStart": 0.0,
            "responseStart": response_start,
            "responseEnd": response_end,
            "nextHopProtocol": if response.url.scheme() == "https" { "h2" } else { "http/1.1" },
            "transferSize": body_size + RESOURCE_HEADER_BYTES,
            "encodedBodySize": body_size,
            "decodedBodySize": body_size,
            "responseStatus": response.status,
            "redirectCount": response.redirected_from.len(),
            "type": "navigate",
        })
    }

    /// File one built Performance Timeline entry, or hold it until a runtime
    /// exists to file it into.
    fn record_performance_entry(&mut self, entry: serde_json::Value) {
        if self.performance_entries_deferred > 0 || self.js.is_none() {
            self.deferred_performance_entries.push(entry);
            return;
        }
        let Some(js) = self.js.as_mut() else { return };
        let _ = js.execute_script(
            "<performance-entry>",
            &format!("globalThis.__obscura_performance_record({entry});"),
        );
    }

    /// Replay entries recorded before the runtime existed, oldest first.
    fn flush_deferred_performance_entries(&mut self) {
        if self.deferred_performance_entries.is_empty() {
            return;
        }
        let pending = std::mem::take(&mut self.deferred_performance_entries);
        let Some(js) = self.js.as_mut() else { return };
        for entry in pending {
            let _ = js.execute_script(
                "<performance-entry>",
                &format!("globalThis.__obscura_performance_record({entry});"),
            );
        }
    }

    /// Resolve the document base URL per HTML spec:
    /// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-url
    /// Falls back to self.url when no <base href> exists.
    fn resolve_base_url(&self) -> Option<url::Url> {
        let doc_url = self.url.as_ref()?;
        let base_href: Option<String> = self.js.as_ref().and_then(|js| {
            js.with_dom(|dom| match dom.query_selector("base[href]") {
                Ok(Some(nid)) => dom
                    .get_node(nid)
                    .and_then(|n| n.get_attribute("href").map(|s| s.to_string())),
                _ => None,
            })
            .flatten()
        });
        match base_href {
            Some(href) => doc_url.join(&href).ok(),
            None => Some(doc_url.clone()),
        }
    }

    async fn fetch_stylesheets(&mut self) -> Vec<(AuthorStylesheetTarget, String)> {
        let (all_links, inline_imports) = match &self.js {
            Some(js) => js
                .with_dom(|dom| {
                    (
                        linked_stylesheet_requests(dom),
                        inline_stylesheet_import_requests(dom),
                    )
                })
                .unwrap_or_default(),
            None => {
                tracing::info!("fetch_stylesheets: no js runtime");
                return Vec::new();
            }
        };

        tracing::info!(
            "fetch_stylesheets: found {} stylesheet links and {} inline imports",
            all_links.len(),
            inline_imports.len()
        );

        let Some(document_url) = self.url.clone() else {
            return Vec::new();
        };
        let document_base = self
            .resolve_base_url()
            .unwrap_or_else(|| document_url.clone());
        let style_policy = self
            .document_csp
            .as_deref()
            .map(crate::frame_policy::ContentSecurityPolicy::parse);
        let style_origin = self
            .document_origin
            .clone()
            .unwrap_or_else(|| obscura_dom::Origin::from_url(document_url.as_str()));
        let mut roots = Vec::new();
        let mut scheduled = std::collections::HashSet::new();
        let mut pending = Vec::new();
        for (link_index, href) in all_links {
            let Ok(resolved) = document_base.join(&href) else {
                continue;
            };
            let (key, resolved) = canonical_stylesheet_url(resolved);
            if style_policy
                .as_ref()
                .is_some_and(|policy| !policy.style_src_allows(resolved.as_str(), &style_origin))
            {
                tracing::info!("Blocked stylesheet by Content-Security-Policy: {}", resolved);
                continue;
            }
            if !subresource_allowed(Some(&document_url), resolved.as_str()) {
                tracing::warn!(
                    "blocking cross-scheme <link rel=stylesheet href>: page={} href={}",
                    self.url_string(),
                    resolved,
                );
                continue;
            }
            if self.should_block_url(resolved.as_str()) {
                tracing::info!("Blocked stylesheet by interception: {}", resolved);
                continue;
            }
            roots.push((AuthorStylesheetTarget::Linked(link_index), key.clone(), None));
            if scheduled.insert(key.clone()) {
                if scheduled.len() <= MAX_STYLESHEET_RESOURCES {
                    pending.push((key, resolved, 0u8));
                }
            }
        }
        for (style_index, import) in inline_imports {
            let Ok(resolved) = document_base.join(&import.url) else {
                continue;
            };
            let (key, resolved) = canonical_stylesheet_url(resolved);
            if style_policy
                .as_ref()
                .is_some_and(|policy| !policy.style_src_allows(resolved.as_str(), &style_origin))
            {
                tracing::info!("Blocked stylesheet import by Content-Security-Policy: {}", resolved);
                continue;
            }
            if !subresource_allowed(Some(&document_url), resolved.as_str())
                || self.should_block_url(resolved.as_str())
            {
                tracing::info!("Blocked inline stylesheet import: {}", resolved);
                continue;
            }
            roots.push((
                AuthorStylesheetTarget::InlineImport(style_index),
                key.clone(),
                import.media,
            ));
            if scheduled.insert(key.clone()) && scheduled.len() <= MAX_STYLESHEET_RESOURCES {
                pending.push((key, resolved, 1u8));
            }
        }

        let mut sheets = std::collections::HashMap::new();
        let mut aliases = std::collections::HashMap::new();
        let referrer_policy = self.referrer_policy;
        while !pending.is_empty() {
            let batch = std::mem::take(&mut pending);
            let client = self.http_client.clone();
            #[cfg(feature = "stealth")]
            let stealth_client = self.stealth_client.clone();
            let callbacks = self.callbacks.clone();
            let initiator = document_url.clone();
            use futures::StreamExt as _;
            let results: Vec<_> =
                futures::stream::iter(batch.into_iter().map(|(key, requested_url, depth)| {
                    let client = client.clone();
                    #[cfg(feature = "stealth")]
                    let stealth_client = stealth_client.clone();
                    let callbacks = callbacks.clone();
                    let initiator = initiator.clone();
                    let referrer_policy = referrer_policy;
                    async move {
                        let mut request =
                            ResourceRequest::subresource(ResourceType::Stylesheet, &initiator);
                        request.referrer_policy = referrer_policy;
                        #[cfg(feature = "stealth")]
                        let result = if let Some(stealth_client) = stealth_client {
                            stealth_client
                                .fetch_resource_with_callbacks(
                                    &requested_url,
                                    request,
                                    Some(&callbacks),
                                )
                                .await
                        } else {
                            client
                                .fetch_resource_with_callbacks(
                                    &requested_url,
                                    request,
                                    Some(&callbacks),
                                )
                                .await
                        };
                        #[cfg(not(feature = "stealth"))]
                        let result = client
                            .fetch_resource_with_callbacks(
                                &requested_url,
                                request,
                                Some(&callbacks),
                            )
                            .await;
                        (key, requested_url, depth, result)
                    }
                }))
                .buffered(16)
                .collect()
                .await;

            for (key, requested_url, depth, result) in results {
                let response = match result {
                    Ok(response) => response,
                    Err(error) => {
                        tracing::debug!("Failed to fetch stylesheet {}: {}", requested_url, error);
                        continue;
                    }
                };
                let response_url = response.url.clone();
                self.record_performance_response(&response, "resource", "link");
                self.record_network_event_with_body(
                    response_url.as_str(),
                    "GET",
                    "Stylesheet",
                    response.status,
                    &response.headers,
                    &response.body,
                    false,
                );

                let (response_key, response_url) = canonical_stylesheet_url(response_url);
                if let Some(existing) = aliases.get(&response_key).cloned() {
                    aliases.insert(key, existing);
                    continue;
                }
                let css = obscura_net::decode_non_html(&response.body, response.content_type());
                let (imports, rules) = split_css_imports(&css);
                let imports = if depth < MAX_STYLESHEET_IMPORT_DEPTH {
                    imports
                } else {
                    Vec::new()
                };
                aliases.insert(key.clone(), key.clone());
                aliases.insert(response_key, key.clone());
                sheets.insert(
                    key,
                    LoadedStylesheet {
                        response_url: response_url.clone(),
                        imports: imports.clone(),
                        rules,
                    },
                );

                if depth >= MAX_STYLESHEET_IMPORT_DEPTH {
                    continue;
                }
                for import in imports {
                    let Ok(import_url) = response_url.join(&import.url) else {
                        continue;
                    };
                    let (import_key, import_url) = canonical_stylesheet_url(import_url);
                    if aliases.contains_key(&import_key) || scheduled.contains(&import_key) {
                        continue;
                    }
                    if scheduled.len() >= MAX_STYLESHEET_RESOURCES {
                        tracing::warn!(
                            "stylesheet resource cap reached at {} resources",
                            MAX_STYLESHEET_RESOURCES
                        );
                        continue;
                    }
                    if !subresource_allowed(Some(&document_url), import_url.as_str())
                        || self.should_block_url(import_url.as_str())
                    {
                        tracing::info!("Blocked stylesheet import: {}", import_url);
                        continue;
                    }
                    scheduled.insert(import_key.clone());
                    pending.push((import_key, import_url, depth + 1));
                }
            }
        }

        roots
            .into_iter()
            .filter_map(|(target, key, media)| {
                materialize_stylesheet_graph(
                    &key,
                    &sheets,
                    &aliases,
                    &mut std::collections::HashSet::new(),
                )
                .map(|css| {
                    let css = match media {
                        Some(media) => format!("@media {media} {{\n{css}\n}}\n"),
                        None => css,
                    };
                    (target, css)
                })
            })
            .collect()
    }

    async fn execute_scripts(&mut self) {
        self.execute_scripts_with_module_budget(None).await;
    }

    /// Drive only dynamic script elements which participate in the current
    /// document's load-event delay set. Browser script runners keep this set
    /// separate from arbitrary post-load imports, timers, and enhancement
    /// scripts; navigation readiness must not turn those into an implicit
    /// multi-second settle.
    async fn drive_load_delaying_scripts(
        js: &mut ObscuraJsRuntime,
        deadline: tokio::time::Instant,
    ) -> bool {
        while js.has_pending_load_delaying_scripts() {
            let Some(remaining) = deadline.checked_duration_since(tokio::time::Instant::now())
            else {
                return false;
            };
            if remaining.is_zero() {
                return false;
            }
            let poll_budget = remaining.min(tokio::time::Duration::from_millis(25));
            match tokio::time::timeout(
                poll_budget,
                js.run_load_delaying_event_loop_tick(),
            )
            .await
            {
                Ok(Ok(_idle)) => {
                    if js.has_pending_load_delaying_scripts() {
                        tokio::task::yield_now().await;
                    }
                }
                Ok(Err(error)) => {
                    tracing::warn!("load-delaying dynamic script event loop failed: {error}");
                    return false;
                }
                Err(_) => {
                    // This timeout only cancels a parked event-loop poll. The
                    // shared absolute deadline above remains authoritative.
                }
            }
        }
        true
    }

    async fn execute_scripts_with_module_budget(&mut self, module_budget_override: Option<u64>) {
        let scripts_started = std::time::Instant::now();
        tracing::info!(
            "execute_scripts called, js runtime exists: {}",
            self.js.is_some()
        );
        // Soft deadline on the entire script-execution phase. Heavy SPAs
        // (GitHub, Linear, CodeSandbox) ship 50+ scripts and our serial
        // fetch + execute loop can blow past a Puppeteer/Playwright goto
        // timeout. The old 10s default was too tight: a heavy React/Vue/Angular
        // SPA had its remaining scripts skipped before the app booted, so it
        // never fired its XHR/fetch calls and page.on('response') saw nothing
        // (issue #361). Only pages that actually run past the deadline are
        // affected; fast pages finish and return well before it, so a larger
        // budget costs them nothing. 30s gives an app room to initialize while
        // the per-phase watchdog (armed at this + 1s) still bounds a real
        // synchronous hang. Raise it further with OBSCURA_SCRIPT_DEADLINE_MS=<ms>
        // for very heavy SPAs on slow networks (pair it with a matching client
        // navigation timeout).
        let script_deadline_ms: u64 = std::env::var("OBSCURA_SCRIPT_DEADLINE_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30_000);
        let script_deadline =
            tokio::time::Instant::now() + tokio::time::Duration::from_millis(script_deadline_ms);

        // Hard backstop over the WHOLE script-execution phase. Inline scripts
        // run back-to-back with no await between them, so neither the soft
        // deadline above (only checked between scripts) nor the per-script guard
        // can interrupt a page that burns the budget across many synchronous
        // scripts (the real-world SPA / anti-bot busy-loop hang). This watchdog
        // terminates the isolate if cumulative synchronous script work overruns.
        let exec_wd = self
            .js
            .as_mut()
            .map(|js| js.arm_watchdog(std::time::Duration::from_millis(script_deadline_ms + 1000)));

        #[derive(Debug, Clone, Copy)]
        enum ScriptKind {
            Classic,
            Module,
            ImportMap,
        }

        #[derive(Debug)]
        struct ScriptInfo {
            src: Option<String>,
            nonce: Option<String>,
            inline: String,
            is_defer: bool,
            is_async: bool,
            kind: ScriptKind,
            nid: u32,
            source_line: u64,
            /// Document base URL at this element's parser encounter point.
            base_url: String,
        }

        let all_scripts = match &self.js {
            Some(js) => {
                let document_url = self.url_string();
                js.with_dom(|dom| {
                    let script_ids = dom.query_selector_all("script").unwrap_or_default();
                    let mut bases_at_script = std::collections::HashMap::new();
                    let mut active_base = url::Url::parse(&document_url).ok();
                    let mut found_base = false;
                    for nid in dom.descendants(dom.document()) {
                        let Some(node) = dom.get_node(nid) else {
                            continue;
                        };
                        let Some(name) = node.as_element() else {
                            continue;
                        };
                        if name.local.as_ref() == "base" && !found_base {
                            if let Some(href) = node.get_attribute("href") {
                                found_base = true;
                                if let Some(resolved) =
                                    active_base.as_ref().and_then(|base| base.join(href).ok())
                                {
                                    active_base = Some(resolved);
                                }
                            }
                        } else if name.local.as_ref() == "script" {
                            bases_at_script.insert(
                                nid.raw(),
                                active_base
                                    .as_ref()
                                    .map(ToString::to_string)
                                    .unwrap_or_else(|| document_url.clone()),
                            );
                        }
                    }
                    let mut scripts = Vec::new();

                    for sid in script_ids {
                        if let Some(node) = dom.get_node(sid) {
                            let src = node.get_attribute("src").map(|s| s.to_string());
                            let nonce = node.get_attribute("nonce").map(|s| s.to_string());
                            let script_type = node
                                .get_attribute("type")
                                .unwrap_or("")
                                .trim()
                                .to_ascii_lowercase();
                            let is_defer = node.get_attribute("defer").is_some();
                            let is_async = node.get_attribute("async").is_some();
                            let kind = match script_type.as_str() {
                                "module" => ScriptKind::Module,
                                "importmap" => ScriptKind::ImportMap,
                                "" | "text/javascript" | "application/javascript" => {
                                    ScriptKind::Classic
                                }
                                _ => continue,
                            };

                            let inline_code = if src.is_none() {
                                dom.text_content(sid)
                            } else {
                                String::new()
                            };

                            if matches!(kind, ScriptKind::ImportMap)
                                || src.is_some()
                                || !inline_code.trim().is_empty()
                            {
                                scripts.push(ScriptInfo {
                                    src,
                                    nonce,
                                    inline: inline_code,
                                    is_defer,
                                    is_async,
                                    kind,
                                    nid: sid.raw(),
                                    source_line: dom.source_line(sid).unwrap_or(1),
                                    base_url: bases_at_script
                                        .get(&sid.raw())
                                        .cloned()
                                        .unwrap_or_else(|| document_url.clone()),
                                });
                            }
                        }
                    }
                    scripts
                })
                .unwrap_or_default()
            }
            None => return,
        };

        let script_policy = self
            .document_csp
            .as_deref()
            .map(crate::frame_policy::ContentSecurityPolicy::parse);
        let sandbox_allows_scripts = script_policy
            .as_ref()
            .and_then(|policy| policy.sandbox_flags())
            .is_none_or(|sandbox| sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SCRIPTS));
        let script_self_origin = self
            .document_origin
            .clone()
            .unwrap_or_else(|| obscura_dom::Origin::from_url(&self.url_string()));
        let script_allowed = |script: &ScriptInfo| {
            if !sandbox_allows_scripts {
                return false;
            }
            let Some(policy) = &script_policy else {
                return true;
            };
            match &script.src {
                Some(src) => {
                    let resolved = url::Url::parse(&script.base_url)
                        .ok()
                        .and_then(|base| base.join(src).ok())
                        .map(|url| url.to_string())
                        .unwrap_or_else(|| src.clone());
                    policy.script_src_allows(&resolved, &script_self_origin)
                }
                None => policy.inline_script_allows(script.nonce.as_deref()),
            }
        };

        // HTML scripts have an "already started" flag. Mark every
        // parser-discovered script before running page code so React/Next
        // hydration can move or hoist those nodes without appendChild
        // executing them a second time.
        if let Some(js) = &mut self.js {
            let ids = all_scripts
                .iter()
                .map(|script| script.nid.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let _ = js.execute_script(
                "<parser-scripts>",
                &format!("globalThis.__markParserScripts([{}]);", ids),
            );
        }

        tracing::info!("Found {} parser-discovered scripts", all_scripts.len());
        let mut fetch_tasks: Vec<(usize, String)> = Vec::new();

        for (i, script) in all_scripts.iter().enumerate() {
            if !matches!(script.kind, ScriptKind::Classic) {
                continue;
            }
            if !script_allowed(script) {
                tracing::warn!("Blocked script by Content-Security-Policy");
                continue;
            }
            if let Some(src_url) = &script.src {
                let full_url = if src_url.starts_with("http://") || src_url.starts_with("https://")
                {
                    src_url.clone()
                } else {
                    url::Url::parse(&script.base_url)
                        .ok()
                        .and_then(|base| base.join(src_url).ok())
                        .map(|url| url.to_string())
                        .unwrap_or_else(|| src_url.clone())
                };

                if !subresource_allowed(self.url.as_ref(), &full_url) {
                    // Block file://, data:, javascript:, and other
                    // off-origin schemes from being injected as a
                    // <script src>. Without this an http page can
                    // include <script src="file:///etc/passwd"> and
                    // see the body parsed as JS source.
                    tracing::warn!(
                        "blocking cross-scheme <script src>: page={} src={}",
                        self.url_string(),
                        full_url,
                    );
                    continue;
                }
                if self.should_block_url(&full_url) {
                    tracing::info!("Blocked script by interception: {}", full_url);
                    continue;
                }
                fetch_tasks.push((i, full_url));
            }
        }

        let client = self.http_client.clone();
        let page_callbacks = self.callbacks.clone();
        let referrer_policy = self.referrer_policy;
        let script_initiator = self
            .url
            .clone()
            .unwrap_or_else(|| Url::parse("about:blank").unwrap());
        let fetch_futures: Vec<_> = fetch_tasks
            .iter()
            .map(|(idx, url)| {
                let client = client.clone();
                let cbs = page_callbacks.clone();
                let initiator = script_initiator.clone();
                let url = url.clone();
                let idx = *idx;
                let referrer_policy = referrer_policy;
                async move {
                    let parsed =
                        Url::parse(&url).unwrap_or_else(|_| Url::parse("about:blank").unwrap());
                    if parsed.scheme() == "data" {
                        // data: URIs are inline; decode locally, no network fetch.
                        // Instagram and other Meta properties serve their bootstrap
                        // as <script src="data:application/x-javascript;base64,...">.
                        let body = decode_data_uri(&url).unwrap_or_default();
                        let content_type = url
                            .strip_prefix("data:")
                            .and_then(|s| s.split(',').next())
                            .unwrap_or("application/javascript")
                            .split(';')
                            .next()
                            .unwrap_or("application/javascript")
                            .to_string();
                        let mut headers = std::collections::HashMap::new();
                        headers.insert("content-type".to_string(), content_type);
                        let resp = obscura_net::Response {
                            url: parsed,
                            status: 200,
                            headers,
                            body,
                            redirected_from: Vec::new(),
                            timing: obscura_net::ResponseTiming::default(),
                        };
                        return Some((idx, url, resp));
                    }
                    let mut request = ResourceRequest::subresource(ResourceType::Script, &initiator);
                    request.referrer_policy = referrer_policy;
                    match client
                        .fetch_resource_with_callbacks(&parsed, request, Some(&cbs))
                        .await
                    {
                        Ok(resp) => Some((idx, url, resp)),
                        Err(e) => {
                            tracing::warn!("Failed to fetch script {}: {}", url, e);
                            None
                        }
                    }
                }
            })
            .collect();

        // Bound concurrency: a page with 100 external scripts would
        // otherwise open 100 sockets at once, exhausting the connection
        // pool / ephemeral ports and triggering OS-level backpressure.
        // 16 is well above the per-host pool ceiling most browsers use
        // and matches what real Chrome does for a given origin.
        use futures::StreamExt as _;
        let fetch_stream = futures::stream::iter(fetch_futures).buffer_unordered(16);
        let fetch_results = match tokio::time::timeout_at(
            script_deadline,
            fetch_stream.collect::<Vec<_>>(),
        )
        .await
        {
            Ok(results) => results,
            Err(_) => {
                tracing::warn!(
                    "execute_scripts: fetch deadline reached, some scripts may not have loaded"
                );
                Vec::new()
            }
        };

        let mut fetched: std::collections::HashMap<usize, (String, String, obscura_net::Response)> =
            std::collections::HashMap::new();
        for result in fetch_results {
            if let Some((idx, url, resp)) = result {
                self.record_performance_response(&resp, "resource", "script");
                if !script_response_is_executable(resp.status) {
                    self.record_network_event_with_body(
                        &url,
                        "GET",
                        "Script",
                        resp.status,
                        &resp.headers,
                        &resp.body,
                        false,
                    );
                    tracing::warn!(
                        "Refusing to execute script {} after HTTP {}",
                        url,
                        resp.status
                    );
                    continue;
                }
                // Script bodies: only the HTTP Content-Type charset matters
                // (no in-band meta-charset for JS).
                let code = obscura_net::decode_non_html(&resp.body, resp.content_type());
                fetched.insert(idx, (url, code, resp));
            }
        }

        // Spec: readyState is "loading" while parser-discovered scripts execute.
        // Scripts that check readyState === 'loading' will register DOMContentLoaded
        // listeners instead of calling their callback immediately.
        if let Some(js) = &mut self.js {
            let _ = js.execute_script(
                "<ready-state>",
                "globalThis.__documentReadyState__ = 'loading';",
            );
        }

        // CDP `Page.addScriptToEvaluateOnNewDocument` contract: preload
        // sources must run BEFORE any of the page's own scripts. This is
        // also where puppeteer's `exposeFunction` wrapper installs itself —
        // if preload runs after page scripts, every early binding call
        // hits an undefined function and silently no-ops.
        // Per-module budget. Modules on an already-rendered page are
        // enhancement, not the app: give them a short budget so one slow
        // non-essential module (e.g. YC's bookface, whose top-level eval
        // idle-waits ~10s) cannot block navigation completion. A page whose
        // body is still an empty shell IS the SPA (issue #205), so give it the
        // full script budget and the app module still mounts.
        let module_budget_ms: u64 = {
            let body_nodes = self
                .js
                .as_ref()
                .and_then(|js| {
                    js.with_dom(|dom| {
                        dom.query_selector("body")
                            .ok()
                            .flatten()
                            .map(|b| dom.descendants(b).len())
                            .unwrap_or(0)
                    })
                })
                .unwrap_or(0);
            let short_ms: u64 = module_budget_override.unwrap_or_else(|| {
                std::env::var("OBSCURA_MODULE_BUDGET_MS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(3_000)
            });
            // A rendered body has hundreds of descendants; an unmounted Vite/Next
            // shell is <root> plus maybe a spinner.
            if module_budget_override.is_some() || body_nodes > 50 {
                short_ms
            } else {
                script_deadline_ms
            }
        };
        // V8 can flag an overrun while a synchronous renderer host call is in
        // progress, but it cannot preempt Rust after entering that call. Allow
        // one bounded, finite style/layout flush without weakening the
        // page-wide script deadline. Private test overrides keep zero grace.
        let module_hostcall_grace_ms = if module_budget_override.is_some() {
            0
        } else {
            std::env::var("OBSCURA_MODULE_HOSTCALL_GRACE_MS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(5_000)
        };

        enum ScheduledScript {
            Classic(usize),
            Module {
                prepared: obscura_js::runtime::PreparedModule,
                url: Option<String>,
                remaining_active_ms: u64,
                graph_elapsed_ms: u64,
                queued_at: std::time::Instant,
            },
        }

        let remaining_budget_ms = |deadline: tokio::time::Instant| -> Option<u64> {
            let remaining = deadline.checked_duration_since(tokio::time::Instant::now())?;
            if remaining.is_zero() {
                return None;
            }
            let millis = remaining
                .as_millis()
                .saturating_add(u128::from(remaining.subsec_nanos() % 1_000_000 != 0));
            Some(millis.min(u128::from(u64::MAX)) as u64)
        };
        let elapsed_ms_ceil = |elapsed: std::time::Duration| -> u64 {
            elapsed
                .as_micros()
                .div_ceil(1_000)
                .max(1)
                .min(u128::from(u64::MAX)) as u64
        };
        let evaluation_budget_ms = |remaining_active_ms: u64| -> Option<u64> {
            let remaining_page_ms = remaining_budget_ms(script_deadline)?;
            let budget = remaining_active_ms
                .saturating_add(module_hostcall_grace_ms)
                .min(remaining_page_ms);
            (budget != 0).then_some(budget)
        };

        let execute_classic =
            |page: &mut Self,
             script: &ScriptInfo,
             fetched_script: Option<(String, String, obscura_net::Response)>| {
                if script.src.is_some() {
                    if let Some((url, code, resp)) = fetched_script {
                        tracing::info!("Executing script ({} bytes): {}", code.len(), url);
                        let execution_url = resp.url.to_string();
                        page.record_network_event_with_body(
                            &url,
                            "GET",
                            "Script",
                            resp.status,
                            &resp.headers,
                            &resp.body,
                            false,
                        );
                        if let Some(js) = &mut page.js {
                            let _ = js.execute_script(
                                "<current-script>",
                                &format!("globalThis.__currentScriptNid={};", script.nid),
                            );
                            if let Err(error) = js.execute_script_guarded(&execution_url, &code) {
                                tracing::warn!("Script error ({}): {}", execution_url, error);
                            }
                            let _ = js.execute_script(
                                "<current-script>",
                                "globalThis.__currentScriptNid=0;",
                            );
                        }
                    }
                } else if !script.inline.is_empty() {
                    if let Some(js) = &mut page.js {
                        let _ = js.execute_script(
                            "<current-script>",
                            &format!("globalThis.__currentScriptNid={};", script.nid),
                        );
                        if let Err(error) =
                            js.execute_script_guarded_at_line(
                                &script.base_url,
                                &script.inline,
                                script.source_line,
                            )
                        {
                            tracing::warn!("Inline script error: {}", error);
                        }
                        let _ = js
                            .execute_script("<current-script>", "globalThis.__currentScriptNid=0;");
                    }
                }
            };

        let mut post_parse = Vec::new();

        // Process parser-discovered scripts in encounter order. Import maps
        // register at their exact position; module graphs start there too, but
        // evaluation of non-async modules remains post-parse.
        for (index, script) in all_scripts.iter().enumerate() {
            if tokio::time::Instant::now() >= script_deadline {
                tracing::warn!(
                    "execute_scripts: deadline reached, skipping {} remaining scripts",
                    all_scripts.len() - index,
                );
                break;
            }
            if !script_allowed(script) {
                tracing::warn!("Blocked script by Content-Security-Policy");
                continue;
            }

            match script.kind {
                ScriptKind::ImportMap => {
                    if script.src.is_some() {
                        tracing::warn!("External import maps are not supported");
                        continue;
                    }
                    if let Some(js) = &self.js {
                        if let Err(error) = js.add_import_map(&script.inline, &script.base_url) {
                            tracing::warn!("Ignoring invalid import map: {}", error);
                        }
                    }
                }
                ScriptKind::Classic => {
                    if script.is_defer && !script.is_async && script.src.is_some() {
                        post_parse.push(ScheduledScript::Classic(index));
                    } else {
                        let fetched_script = fetched.remove(&index);
                        execute_classic(self, script, fetched_script);
                    }
                }
                ScriptKind::Module => {
                    // Graph loading and evaluation share one active-work
                    // allowance. Queue time behind other post-parse scripts is
                    // not work performed by this module.
                    let Some(remaining_page_ms) = remaining_budget_ms(script_deadline) else {
                        tracing::warn!("ES module budget exhausted before graph preparation");
                        continue;
                    };
                    let prepare_budget_ms = module_budget_ms.min(remaining_page_ms);
                    let prepare_started = std::time::Instant::now();
                    let (prepared, module_url) = if let Some(src) = &script.src {
                        let full_url = if src.starts_with("http://")
                            || src.starts_with("https://")
                            || src.starts_with("data:")
                        {
                            src.clone()
                        } else {
                            url::Url::parse(&script.base_url)
                                .ok()
                                .and_then(|base| base.join(src).ok())
                                .map(|url| url.to_string())
                                .unwrap_or_else(|| src.clone())
                        };
                        tracing::info!("Preparing ES module graph: {}", full_url);
                        let result = match &mut self.js {
                            Some(js) => js.prepare_module(&full_url, prepare_budget_ms).await,
                            None => continue,
                        };
                        tracing::debug!(
                            phase = "module-graph",
                            module = %full_url,
                            elapsed_ms = prepare_started.elapsed().as_millis(),
                            budget_ms = prepare_budget_ms,
                            success = result.is_ok(),
                            "ES module phase complete",
                        );
                        match result {
                            Ok(prepared) => (prepared, Some(full_url)),
                            Err(error) => {
                                tracing::warn!("ES module error ({}): {}", full_url, error);
                                continue;
                            }
                        }
                    } else {
                        let result = match &mut self.js {
                            Some(js) => {
                                js.prepare_inline_module(
                                    &script.inline,
                                    &script.base_url,
                                    prepare_budget_ms,
                                )
                                .await
                            }
                            None => continue,
                        };
                        tracing::debug!(
                            phase = "module-graph",
                            module = "<inline>",
                            elapsed_ms = prepare_started.elapsed().as_millis(),
                            budget_ms = prepare_budget_ms,
                            success = result.is_ok(),
                            "ES module phase complete",
                        );
                        match result {
                            Ok(prepared) => (prepared, None),
                            Err(error) => {
                                tracing::warn!("Inline ES module error: {}", error);
                                continue;
                            }
                        }
                    };
                    let graph_elapsed_ms = elapsed_ms_ceil(prepare_started.elapsed());
                    let remaining_active_ms = module_budget_ms.saturating_sub(graph_elapsed_ms);
                    if remaining_active_ms == 0 {
                        tracing::warn!(
                            module = module_url.as_deref().unwrap_or("<inline>"),
                            graph_elapsed_ms,
                            active_budget_ms = module_budget_ms,
                            "ES module exhausted its active budget during graph preparation",
                        );
                        continue;
                    }
                    let scheduled = ScheduledScript::Module {
                        prepared,
                        url: module_url,
                        remaining_active_ms,
                        graph_elapsed_ms,
                        queued_at: std::time::Instant::now(),
                    };
                    if script.is_async {
                        let ScheduledScript::Module {
                            prepared,
                            url,
                            remaining_active_ms,
                            graph_elapsed_ms,
                            queued_at,
                        } = scheduled
                        else {
                            unreachable!();
                        };
                        let Some(evaluation_budget_ms) = evaluation_budget_ms(remaining_active_ms)
                        else {
                            tracing::warn!(
                                module = url.as_deref().unwrap_or("<inline>"),
                                graph_elapsed_ms,
                                queue_wait_ms = queued_at.elapsed().as_millis(),
                                "ES module exhausted the page budget before evaluation",
                            );
                            continue;
                        };
                        let queue_wait_ms = queued_at.elapsed().as_millis();
                        let evaluation_started = std::time::Instant::now();
                        let result = match &mut self.js {
                            Some(js) => {
                                js.evaluate_prepared_module(prepared, evaluation_budget_ms)
                                    .await
                            }
                            None => continue,
                        };
                        tracing::debug!(
                            phase = "module-evaluation",
                            module = url.as_deref().unwrap_or("<inline>"),
                            elapsed_ms = evaluation_started.elapsed().as_millis(),
                            graph_elapsed_ms,
                            queue_wait_ms,
                            remaining_active_ms,
                            evaluation_ceiling_ms = evaluation_budget_ms,
                            success = result.is_ok(),
                            "ES module phase complete",
                        );
                        if let Err(error) = result {
                            tracing::warn!("ES module evaluation error: {}", error);
                        } else if let Some(url) = url {
                            tracing::info!("ES module loaded: {}", url);
                            self.record_network_event(
                                &url,
                                "GET",
                                "Script",
                                200,
                                &std::collections::HashMap::new(),
                                0,
                            );
                        }
                    } else {
                        post_parse.push(scheduled);
                    }
                }
            }
        }

        // Parsing has finished before defer scripts and non-async modules run.
        // They still gate DOMContentLoaded, but observe the browser's
        // `interactive` readyState while they execute.
        if let Some(js) = &mut self.js {
            let _ = js.execute_script(
                "<ready-state-interactive>",
                "globalThis.__documentReadyState__ = 'interactive';",
            );
        }

        for scheduled in post_parse {
            if tokio::time::Instant::now() >= script_deadline {
                tracing::warn!("execute_scripts: deadline reached during post-parse scripts");
                break;
            }
            match scheduled {
                ScheduledScript::Classic(index) => {
                    let script = &all_scripts[index];
                    let fetched_script = fetched.remove(&index);
                    execute_classic(self, script, fetched_script);
                }
                ScheduledScript::Module {
                    prepared,
                    url,
                    remaining_active_ms,
                    graph_elapsed_ms,
                    queued_at,
                } => {
                    let Some(evaluation_budget_ms) = evaluation_budget_ms(remaining_active_ms)
                    else {
                        tracing::warn!(
                            module = url.as_deref().unwrap_or("<inline>"),
                            graph_elapsed_ms,
                            queue_wait_ms = queued_at.elapsed().as_millis(),
                            "ES module exhausted the page budget before post-parse evaluation",
                        );
                        continue;
                    };
                    let queue_wait_ms = queued_at.elapsed().as_millis();
                    let evaluation_started = std::time::Instant::now();
                    let result = match &mut self.js {
                        Some(js) => {
                            js.evaluate_prepared_module(prepared, evaluation_budget_ms)
                                .await
                        }
                        None => continue,
                    };
                    tracing::debug!(
                        phase = "module-evaluation",
                        module = url.as_deref().unwrap_or("<inline>"),
                        elapsed_ms = evaluation_started.elapsed().as_millis(),
                        graph_elapsed_ms,
                        queue_wait_ms,
                        remaining_active_ms,
                        evaluation_ceiling_ms = evaluation_budget_ms,
                        success = result.is_ok(),
                        "ES module phase complete",
                    );
                    if let Err(error) = result {
                        tracing::warn!("ES module evaluation error: {}", error);
                    } else if let Some(url) = url {
                        tracing::info!("ES module loaded: {}", url);
                        self.record_network_event(
                            &url,
                            "GET",
                            "Script",
                            200,
                            &std::collections::HashMap::new(),
                            0,
                        );
                    }
                }
            }
        }

        if let Some(js) = &mut self.js {
            // DOMContentLoaded follows parser/defer/module work, but async
            // dynamic script elements do not gate it. They do remain in the
            // document's load-event delay set, including scripts inserted by
            // a DOMContentLoaded listener.
            let _ = js.execute_script(
                "<dom-content-loaded>",
                "try { globalThis.__obscura_schedule_input_strategy?.(); } catch(e) {}\n\
                 try { globalThis.__obscura_performance_lifecycle?.('dom-content-loaded', performance.now()); } catch(e) {}\n\
                 try { document.dispatchEvent(new Event('DOMContentLoaded', {bubbles:false,cancelable:false})); } catch(e) {}\n\
                 try { window.dispatchEvent(new Event('DOMContentLoaded', {bubbles:false,cancelable:false})); } catch(e) {}",
            );

            let load_blockers_finished =
                Self::drive_load_delaying_scripts(js, script_deadline).await;
            if !load_blockers_finished {
                tracing::warn!(
                    "script deadline reached with load-delaying dynamic scripts still pending"
                );
            }

            // readyState becomes complete before the load event. A script
            // inserted by an onload handler is therefore post-load work and
            // remains pending until an explicit caller settle/wait.
            let _ = js.execute_script(
                "<load-event>",
                "globalThis.__documentReadyState__ = 'complete';\n\
                 if (typeof window.onload === 'function') { try { window.onload(); } catch(e) {} }\n\
                 try { window.dispatchEvent(new Event('load', {bubbles:false,cancelable:false})); } catch(e) {}\n\
                 try { globalThis.__obscura_performance_lifecycle?.('load', performance.now()); } catch(e) {}",
            );
        }
        if let Some(token) = exec_wd {
            if let Some(js) = self.js.as_mut() {
                js.disarm_watchdog(token);
            }
        }
        tracing::debug!(
            phase = "script-execution-total",
            elapsed_ms = scripts_started.elapsed().as_millis(),
            budget_ms = script_deadline_ms,
            "script execution phase complete",
        );
    }

    /// Run the `<script>` elements of every committed child frame in
    /// that frame's own Window realm (Phase 3.8). Runs after `init_js` (the
    /// realm host and the DomTree live in the runtime by then) and before the
    /// main document's `execute_scripts`: frame documents commit while the
    /// parent parses, so their parser scripts run before the parent document
    /// signals readiness. Pages without iframes return without touching the
    /// runtime.
    async fn execute_frame_scripts(&mut self) {
        if self.js.is_none() {
            return;
        }
        // Outermost first: walk the registry tree from the main frame so a
        // parent frame's scripts run before its nested frames' scripts.
        let mut order: Vec<String> = Vec::new();
        let mut queue: std::collections::VecDeque<String> = self
            .frames
            .get(self.frames.main_frame_id())
            .map(|main| main.children.iter().cloned().collect())
            .unwrap_or_default();
        while let Some(frame_id) = queue.pop_front() {
            if let Some(frame) = self.frames.get(&frame_id) {
                queue.extend(frame.children.iter().cloned());
                order.push(frame_id);
            }
        }
        self.execute_frame_scripts_in_order(order).await;
    }

    /// Run the scripts of the frames in `order` under the shared phase
    /// budget: a soft deadline observed between scripts plus a watchdog for a
    /// synchronous overrun inside one frame script. Same budget shape as the
    /// main document's script phase.
    async fn execute_frame_scripts_in_order(&mut self, order: Vec<String>) {
        if order.is_empty() {
            return;
        }
        let deadline_ms: u64 = std::env::var("OBSCURA_SCRIPT_DEADLINE_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30_000);
        let deadline =
            tokio::time::Instant::now() + tokio::time::Duration::from_millis(deadline_ms);
        let watchdog = self
            .js
            .as_mut()
            .map(|js| js.arm_watchdog(std::time::Duration::from_millis(deadline_ms + 1000)));
        for frame_id in order {
            if tokio::time::Instant::now() >= deadline {
                tracing::warn!("execute_frame_scripts: deadline reached, skipping remaining frames");
                break;
            }
            self.execute_frame_scripts_for(&frame_id, deadline).await;
        }
        if let Some(token) = watchdog {
            if let Some(js) = self.js.as_mut() {
                js.disarm_watchdog(token);
            }
        }
    }

    /// Run the scripts of `root_frame_id` and its nested frames
    /// (outermost first). Used by the CDP single-frame navigation path, where
    /// only the navigated subtree has a fresh document; the full-page flow
    /// walks the whole tree via [`Self::execute_frame_scripts`].
    async fn execute_frame_subtree_scripts(&mut self, root_frame_id: &str) {
        if self.js.is_none() || self.frames.get(root_frame_id).is_none() {
            return;
        }
        let mut order: Vec<String> = Vec::new();
        let mut queue: std::collections::VecDeque<String> =
            std::collections::VecDeque::from([root_frame_id.to_string()]);
        while let Some(frame_id) = queue.pop_front() {
            if let Some(frame) = self.frames.get(&frame_id) {
                queue.extend(frame.children.iter().cloned());
                order.push(frame_id);
            }
        }
        self.execute_frame_scripts_in_order(order).await;
    }

    async fn execute_frame_scripts_for(
        &mut self,
        frame_id: &str,
        deadline: tokio::time::Instant,
    ) {
        let Some(frame) = self.frames.get(frame_id) else {
            return;
        };
        let Some(content_root) = frame.active_document_root else {
            return;
        };
        let generation = frame.document_generation;
        let navigation_timing = frame.navigation_timing.clone();

        let Some(scope) = self
            .js
            .as_ref()
            .and_then(|js| js.with_dom(|dom| dom.document_scope(content_root)))
            .flatten()
        else {
            return;
        };
        let frame_base = scope.base_url.clone();
        // Every committed browsing context owns a Window realm, including an
        // empty about:blank document and a sandboxed document whose author
        // scripts are disabled. contentWindow/eval/CDP must not depend on the
        // presence of a <script> element.
        let frame_preloads = self.preload_scripts.clone();
        let Some(js) = self.js.as_mut() else {
            return;
        };
        if let Err(error) =
            js.ensure_frame_realm(frame_id, generation, content_root.raw(), &frame_base)
        {
            tracing::warn!("frame realm creation failed ({frame_id}): {error}");
            return;
        }
        if let Some(entry) = navigation_timing {
            if let Err(error) = js.execute_script_in_frame_realm(
                frame_id,
                generation,
                "<frame-navigation-timing>",
                &format!("globalThis.__obscura_performance_record({entry});"),
            ) {
                tracing::warn!("frame navigation timing install failed ({frame_id}): {error}");
            }
        }
        let _ = js.execute_script_in_frame_realm(
            frame_id,
            generation,
            "<frame-referrer-policy>",
            &format!(
                "globalThis.__obscura_referrer_policy={:?};",
                scope.referrer_policy
            ),
        );
        // New-document scripts run in every matching frame world after the
        // browser bootstrap and before any author script, including when the
        // sandbox suppresses author execution.
        for preload in frame_preloads {
            let result = match preload.world_name.as_deref() {
                None => js
                    .execute_script_in_frame_realm(
                        frame_id,
                        generation,
                        "<preload>",
                        &preload.source,
                    )
                    .map(|_| ()),
                Some(world_name) => js
                    .ensure_isolated_world_realm(
                        frame_id,
                        generation,
                        preload.world_id,
                        world_name,
                        content_root.raw(),
                        &frame_base,
                    )
                    .and_then(|_| {
                        js.execute_script_in_frame_world_realm(
                            frame_id,
                            generation,
                            preload.world_id,
                            "<preload>",
                            &preload.source,
                        )
                        .map(|_| ())
                    }),
            };
            if let Err(error) = result {
                tracing::debug!("Frame preload script error: {}", error);
            }
        }
        // A sandbox without allow-scripts suppresses author scripts after the
        // realm exists. Nested frames carry their parent's merged flags.
        if scope.sandbox.active
            && !scope.sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SCRIPTS)
        {
            return;
        }
        // Subresource initiator/referrer: the frame document's URL when it is
        // a network document, else the inherited base (srcdoc, about:blank).
        let initiator = Url::parse(&scope.url)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
            .or_else(|| Url::parse(&frame_base).ok())
            .unwrap_or_else(|| Url::parse("about:blank").unwrap());

        #[derive(Clone, Copy)]
        enum FrameScriptKind {
            Classic,
            Module,
            ImportMap,
        }
        struct FrameScript {
            src: Option<String>,
            nonce: Option<String>,
            inline: String,
            nid: u32,
            base_url: String,
            kind: FrameScriptKind,
            is_defer: bool,
            is_async: bool,
            source_line: u64,
        }
        // Discovery mirrors the main document's scan, scoped to the content
        // root. Content documents are parentless subtrees, so descendants()
        // never crosses into a nested frame's document. The <base> pre-scan is
        // document-local, seeded from the frame scope's base URL.
        let scripts: Vec<FrameScript> = self
            .js
            .as_ref()
            .and_then(|js| {
                js.with_dom(|dom| {
                    let script_ids = dom
                        .query_selector_all_from(content_root, "script")
                        .unwrap_or_default();
                    let mut bases_at_script = std::collections::HashMap::new();
                    let mut active_base = Url::parse(&frame_base).ok();
                    let mut found_base = false;
                    for nid in dom.descendants(content_root) {
                        let Some(node) = dom.get_node(nid) else {
                            continue;
                        };
                        let Some(name) = node.as_element() else {
                            continue;
                        };
                        if name.local.as_ref() == "base" && !found_base {
                            if let Some(href) = node.get_attribute("href") {
                                found_base = true;
                                if let Some(resolved) =
                                    active_base.as_ref().and_then(|base| base.join(href).ok())
                                {
                                    active_base = Some(resolved);
                                }
                            }
                        } else if name.local.as_ref() == "script" {
                            bases_at_script.insert(
                                nid.raw(),
                                active_base
                                    .as_ref()
                                    .map(ToString::to_string)
                                    .unwrap_or_else(|| frame_base.clone()),
                            );
                        }
                    }
                    let mut scripts = Vec::new();
                    for sid in script_ids {
                        let Some(node) = dom.get_node(sid) else {
                            continue;
                        };
                        let script_type = node
                            .get_attribute("type")
                            .unwrap_or("")
                            .trim()
                            .to_ascii_lowercase();
                        let kind = match script_type.as_str() {
                            "" | "text/javascript" | "application/javascript" => {
                                FrameScriptKind::Classic
                            }
                            "module" => FrameScriptKind::Module,
                            "importmap" => FrameScriptKind::ImportMap,
                            _ => continue,
                        };
                        let src = node.get_attribute("src").map(str::to_string);
                        let nonce = node.get_attribute("nonce").map(str::to_string);
                        let inline = if src.is_none() {
                            dom.text_content(sid)
                        } else {
                            String::new()
                        };
                        if src.is_some() || !inline.trim().is_empty() {
                            scripts.push(FrameScript {
                                src,
                                nonce,
                                inline,
                                nid: sid.raw(),
                                source_line: dom.source_line(sid).unwrap_or(1),
                                kind,
                                is_defer: node.get_attribute("defer").is_some(),
                                is_async: node.get_attribute("async").is_some(),
                                base_url: bases_at_script
                                    .get(&sid.raw())
                                    .cloned()
                                    .unwrap_or_else(|| frame_base.clone()),
                            });
                        }
                    }
                    scripts
                })
            })
            .unwrap_or_default();
        if scripts.is_empty() {
            return;
        }

        let Some(js) = self.js.as_mut() else {
            return;
        };
        let frame_script_policy = scope
            .csp
            .as_deref()
            .map(crate::frame_policy::ContentSecurityPolicy::parse);
        // Already-started marks are frame-document-local: set them in the
        // frame's realm so frame code moving these nodes cannot re-run them.
        let ids = scripts
            .iter()
            .map(|script| script.nid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let _ = js.execute_script_in_frame_realm(
            frame_id,
            generation,
            "<parser-scripts>",
            &format!("globalThis.__markParserScripts([{ids}]);"),
        );

        // Prefetch external classics concurrently, then execute in document
        // order. Gates mirror the main document's: scheme allowlist against
        // the frame base, interception blocklist, and the transport's SSRF
        // checks inside fetch_resource_with_callbacks.
        let mut fetch_tasks: Vec<(usize, String)> = Vec::new();
        for (index, script) in scripts.iter().enumerate() {
            if !matches!(script.kind, FrameScriptKind::Classic) {
                continue;
            }
            let Some(src) = &script.src else {
                continue;
            };
            let full_url = if src.starts_with("http://") || src.starts_with("https://") {
                src.clone()
            } else {
                Url::parse(&script.base_url)
                    .ok()
                    .and_then(|base| base.join(src).ok())
                    .map(|url| url.to_string())
                    .unwrap_or_else(|| src.clone())
            };
            if frame_script_policy
                .as_ref()
                .is_some_and(|policy| !policy.script_src_allows(&full_url, &scope.origin))
            {
                tracing::info!(
                    "Blocked frame script by Content-Security-Policy: {}",
                    full_url
                );
                continue;
            }
            if !subresource_allowed(Url::parse(&frame_base).ok().as_ref(), &full_url) {
                tracing::warn!(
                    "blocking cross-scheme frame <script src>: frame={} src={}",
                    scope.url,
                    full_url,
                );
                continue;
            }
            if self.should_block_url(&full_url) {
                tracing::info!("Blocked frame script by interception: {}", full_url);
                continue;
            }
            fetch_tasks.push((index, full_url));
        }
        let client = self.http_client.clone();
        let callbacks = self.callbacks.clone();
        let referrer_policy = obscura_net::ReferrerPolicy::parse(&scope.referrer_policy)
            .unwrap_or_default();
        let fetch_futures: Vec<_> = fetch_tasks
            .into_iter()
            .map(|(index, url)| {
                let client = client.clone();
                let callbacks = callbacks.clone();
                let initiator = initiator.clone();
                let referrer_policy = referrer_policy;
                async move {
                    let parsed =
                        Url::parse(&url).unwrap_or_else(|_| Url::parse("about:blank").unwrap());
                    if parsed.scheme() == "data" {
                        let body = decode_data_uri(&url).unwrap_or_default();
                        let content_type = url
                            .strip_prefix("data:")
                            .and_then(|s| s.split(',').next())
                            .unwrap_or("application/javascript")
                            .split(';')
                            .next()
                            .unwrap_or("application/javascript")
                            .to_string();
                        let mut headers = std::collections::HashMap::new();
                        headers.insert("content-type".to_string(), content_type);
                        let resp = obscura_net::Response {
                            url: parsed,
                            status: 200,
                            headers,
                            body,
                            redirected_from: Vec::new(),
                            timing: obscura_net::ResponseTiming::default(),
                        };
                        return Some((index, url, resp));
                    }
                    let mut request =
                        ResourceRequest::subresource(ResourceType::Script, &initiator);
                    request.referrer_policy = referrer_policy;
                    match client
                        .fetch_resource_with_callbacks(&parsed, request, Some(&callbacks))
                        .await
                    {
                        Ok(resp) => Some((index, url, resp)),
                        Err(error) => {
                            tracing::warn!("Failed to fetch frame script {}: {}", url, error);
                            None
                        }
                    }
                }
            })
            .collect();
        use futures::StreamExt as _;
        let fetch_stream = futures::stream::iter(fetch_futures).buffer_unordered(8);
        let fetch_results =
            match tokio::time::timeout_at(deadline, fetch_stream.collect::<Vec<_>>()).await {
                Ok(results) => results,
                Err(_) => {
                    tracing::warn!("execute_frame_scripts: fetch deadline reached");
                    Vec::new()
                }
            };
        let mut fetched: std::collections::HashMap<usize, (String, String, obscura_net::Response)> =
            std::collections::HashMap::new();
        for result in fetch_results {
            let Some((index, url, resp)) = result else {
                continue;
            };
            if !script_response_is_executable(resp.status) {
                self.record_network_event_with_body_for_frame(
                    frame_id,
                    &url,
                    "GET",
                    "Script",
                    resp.status,
                    &resp.headers,
                    &resp.body,
                    false,
                );
                tracing::warn!("Refusing to execute frame script {} after HTTP {}", url, resp.status);
                continue;
            }
            let code = obscura_net::decode_non_html(&resp.body, resp.content_type());
            fetched.insert(index, (url, code, resp));
        }

        macro_rules! execute_classic {
            ($index:expr) => {{
                let script = &scripts[$index];
                let executable = if script.src.is_some() {
                    fetched.remove(&$index).map(|(url, code, resp)| {
                        self.record_network_event_with_body_for_frame(
                            frame_id,
                            &url,
                            "GET",
                            "Script",
                            resp.status,
                            &resp.headers,
                            &resp.body,
                            false,
                        );
                        (resp.url.to_string(), code)
                    })
                } else {
                    Some((script.base_url.clone(), script.inline.clone()))
                };
                if let Some((execution_url, code)) = executable {
                    if let Some(js) = self.js.as_mut() {
                        // currentScript is non-null only for classic script
                        // evaluation, never for ES modules.
                        let _ = js.execute_script_in_frame_realm(
                            frame_id,
                            generation,
                            "<current-script>",
                            &format!("globalThis.__currentScriptNid={};", script.nid),
                        );
                        let result = if script.src.is_none() {
                            js.execute_script_in_frame_realm_at_line(
                                frame_id,
                                generation,
                                &execution_url,
                                &code,
                                script.source_line,
                            )
                        } else {
                            js.execute_script_in_frame_realm(
                                frame_id,
                                generation,
                                &execution_url,
                                &code,
                            )
                        };
                        if let Err(error) = result {
                            tracing::warn!(
                                "Frame script error ({}): {}",
                                execution_url,
                                error
                            );
                        }
                        let _ = js.execute_script_in_frame_realm(
                            frame_id,
                            generation,
                            "<current-script>",
                            "globalThis.__currentScriptNid=0;",
                        );
                    }
                }
            }};
        }

        enum PostParseScript {
            Classic(usize),
            Module(String),
        }
        let mut post_parse = Vec::new();
        for (index, script) in scripts.iter().enumerate() {
            if tokio::time::Instant::now() >= deadline {
                tracing::warn!("execute_frame_scripts: deadline reached mid-frame");
                break;
            }
            match script.kind {
                FrameScriptKind::ImportMap => {
                    if script.src.is_none() {
                        if frame_script_policy
                            .as_ref()
                            .is_some_and(|policy| !policy.inline_script_allows(script.nonce.as_deref()))
                        {
                            tracing::info!(
                                "Blocked frame import map by Content-Security-Policy"
                            );
                            continue;
                        }
                        if let Some(js) = self.js.as_mut() {
                            if let Err(error) = js.add_frame_import_map(
                                frame_id,
                                generation,
                                &script.inline,
                                &script.base_url,
                            ) {
                                tracing::warn!("Frame import map error: {}", error);
                            }
                        }
                    }
                }
                FrameScriptKind::Classic => {
                    if script.src.is_none()
                        && frame_script_policy
                            .as_ref()
                            .is_some_and(|policy| !policy.inline_script_allows(script.nonce.as_deref()))
                    {
                        tracing::info!("Blocked inline frame script by Content-Security-Policy");
                        continue;
                    }
                    if script.is_defer && !script.is_async && script.src.is_some() {
                        post_parse.push(PostParseScript::Classic(index));
                    } else {
                        execute_classic!(index);
                    }
                }
                FrameScriptKind::Module => {
                    if script.src.is_none()
                        && frame_script_policy
                            .as_ref()
                            .is_some_and(|policy| !policy.inline_script_allows(script.nonce.as_deref()))
                    {
                        tracing::info!("Blocked inline frame module by Content-Security-Policy");
                        continue;
                    }
                    let module_url = match &script.src {
                        Some(src) => Url::parse(&script.base_url)
                            .ok()
                            .and_then(|base| base.join(src).ok())
                            .map(|url| url.to_string()),
                        None => Some(script.base_url.clone()),
                    };
                    let Some(module_url) = module_url else {
                        continue;
                    };
                    if script.src.is_some()
                        && frame_script_policy
                            .as_ref()
                            .is_some_and(|policy| !policy.script_src_allows(&module_url, &scope.origin))
                    {
                        tracing::info!(
                            "Blocked frame module by Content-Security-Policy: {}",
                            module_url
                        );
                        continue;
                    }
                    if script.src.is_some()
                        && !subresource_allowed(
                            Url::parse(&script.base_url).ok().as_ref(),
                            &module_url,
                        )
                    {
                        continue;
                    }
                    let root_key = if script.src.is_some() {
                        module_url.clone()
                    } else {
                        format!("frame-inline:{frame_id}:{generation}:{}", script.nid)
                    };
                    let remaining_ms = deadline
                        .checked_duration_since(tokio::time::Instant::now())
                        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
                        .unwrap_or(0);
                    let inline = script.src.is_none().then_some(script.inline.as_str());
                    let module_csp = scope.csp.as_deref().map(|header| {
                        obscura_js::realm::FrameModuleCsp::new(
                            header,
                            &scope.origin.serialize(),
                        )
                    });
                    let prepared = match self.js.as_mut() {
                        Some(js) => {
                            js.prepare_module_in_frame_realm(
                                frame_id,
                                generation,
                                &root_key,
                                &module_url,
                                inline,
                                initiator.as_str(),
                                module_csp,
                                remaining_ms,
                            )
                            .await
                        }
                        None => return,
                    };
                    if let Err(error) = prepared {
                        tracing::warn!("Frame module graph error ({}): {}", module_url, error);
                        continue;
                    }
                    if script.is_async {
                        let result = match self.js.as_mut() {
                            Some(js) => {
                                js.evaluate_module_in_frame_realm(
                                    frame_id,
                                    generation,
                                    &root_key,
                                    remaining_ms,
                                )
                                .await
                            }
                            None => return,
                        };
                        if let Err(error) = result {
                            tracing::warn!("Frame module error ({}): {}", module_url, error);
                        }
                    } else {
                        post_parse.push(PostParseScript::Module(root_key));
                    }
                }
            }
        }

        for scheduled in post_parse {
            if tokio::time::Instant::now() >= deadline {
                tracing::warn!("execute_frame_scripts: deadline reached during post-parse work");
                break;
            }
            match scheduled {
                PostParseScript::Classic(index) => execute_classic!(index),
                PostParseScript::Module(root_key) => {
                    let remaining_ms = deadline
                        .checked_duration_since(tokio::time::Instant::now())
                        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
                        .unwrap_or(0);
                    let result = match self.js.as_mut() {
                        Some(js) => {
                            js.evaluate_module_in_frame_realm(
                                frame_id,
                                generation,
                                &root_key,
                                remaining_ms,
                            )
                            .await
                        }
                        None => return,
                    };
                    if let Err(error) = result {
                        tracing::warn!("Frame module evaluation error: {}", error);
                    }
                }
            }
        }
    }

    pub async fn navigate(&mut self, url_str: &str) -> Result<(), PageError> {
        self.navigate_with_wait(url_str, crate::lifecycle::WaitUntil::Load)
            .await
    }

    pub async fn navigate_with_wait(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
    ) -> Result<(), PageError> {
        self.navigate_with_wait_post(url_str, wait_until, "GET", "")
            .await
    }

    pub async fn navigate_with_wait_post(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
        method: &str,
        body: &str,
    ) -> Result<(), PageError> {
        // Hard ceiling on a single end-to-end navigation. Without this a slow
        // primary fetch or a runaway settle loop can hold the V8 lock for
        // arbitrarily long (we've measured 60+ seconds on JS-heavy news
        // sites), wedging every other in-flight CDP request because the
        // dispatcher holds the lock across the entire handler. 30 seconds
        // matches reqwest's default per-request timeout — the worst case is
        // one slow primary GET plus one slow JS-redirect chain step. Override
        // with `OBSCURA_NAV_TIMEOUT_MS=NN`, or set a page-scoped deadline when
        // the automation request already has an explicit timeout.
        let nav_timeout = self.navigation_timeout();
        let nav_timeout_ms = duration_millis_u64(nav_timeout);

        let result = match tokio::time::timeout(
            nav_timeout,
            self.navigate_with_wait_post_inner(url_str, wait_until, method, body, ""),
        )
        .await
        {
            Ok(r) => r,
            Err(_) => {
                self.lifecycle = crate::lifecycle::LifecycleState::Failed;
                Err(PageError::NetworkError(format!(
                    "navigation exceeded {nav_timeout_ms}ms deadline"
                )))
            }
        };
        if result.is_ok() {
            self.push_history(self.url_string());
        }
        result
    }

    /// Drive the JS event loop after navigation so deferred work can run:
    /// pending timers (setTimeout / setInterval), queued microtasks, in-flight
    /// fetches, and completion callbacks such as testharness's
    /// `add_completion_callback`. Returns as soon as the loop goes idle, or
    /// after `max_ms`. Without this the page is observed exactly as it stood at
    /// the load event, before any async work settles, which silently strands
    /// timer-driven tests and dynamic pages.
    pub async fn settle(&mut self, max_ms: u64) {
        if max_ms == 0 {
            return;
        }
        #[cfg(feature = "render")]
        let settle_started = std::time::Instant::now();
        if std::env::var_os("OBSCURA_STRICT_SETTLE").is_some() {
            self.settle_for_duration(max_ms).await;
        } else {
            let deadline = tokio::time::Instant::now()
                + tokio::time::Duration::from_millis(max_ms);
            loop {
                let now = tokio::time::Instant::now();
                let Some(remaining) = deadline.checked_duration_since(now) else {
                    break;
                };
                let Some(js) = self.js.as_mut() else {
                    break;
                };
                // A deno_core event loop remains "busy" for any future timer,
                // including analytics intervals and animation loops which do
                // not make the page more ready. Require a short window without
                // observable document/network/script activity instead. The
                // absolute caller budget and V8 watchdog still bound both
                // asynchronous work and synchronous microtask storms.
                let _ = js
                    .run_event_loop_until_quiescent(
                        duration_millis_u64(remaining),
                        150,
                    )
                    .await;
                // Timers and fetch completions can insert iframes after the
                // navigation-time fixed-point drain. Hand those requests to
                // the Rust frame controller, then give successfully committed
                // child scripts another event-loop pass within the same
                // caller deadline.
                if self.process_pending_frame_navigations().await == 0 {
                    break;
                }
            }
        }
        #[cfg(feature = "render")]
        {
            // Timers, fetch completions, and framework commits commonly append
            // images or @font-face rules during settling. Seed those resources
            // here so a following capture remains a fast observation of the
            // retained page rather than initiating its own network phase.
            let warmup_ms = std::env::var("OBSCURA_RENDER_RESOURCE_SETTLE_WARMUP_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1_000);
            let remaining_ms = remaining_settle_resource_warmup_ms(
                max_ms,
                settle_started.elapsed(),
                warmup_ms,
            );
            if remaining_ms != 0 {
                let _ = self.prepare_screenshot_resources(remaining_ms).await;
            }
        }
    }

    /// Pump the event loop and retain the full requested wall-clock delay.
    /// The CLI uses this for an explicitly supplied `--wait`; callers asking
    /// for a fixed capture delay should not be silently shortened by adaptive
    /// readiness heuristics.
    pub async fn settle_for_duration(&mut self, duration_ms: u64) {
        if duration_ms == 0 {
            return;
        }
        const FRAME_TASK_SLICE_MS: u64 = 100;
        let started = tokio::time::Instant::now();
        let requested = tokio::time::Duration::from_millis(duration_ms);
        loop {
            let elapsed = started.elapsed();
            let Some(remaining) = requested.checked_sub(elapsed) else {
                break;
            };
            let Some(js) = self.js.as_mut() else {
                break;
            };
            let slice_ms = duration_millis_u64(remaining).min(FRAME_TASK_SLICE_MS);
            if slice_ms == 0 {
                break;
            }
            Self::settle_runtime_for_duration(js, slice_ms).await;
            self.process_pending_frame_navigations().await;
        }
    }

    /// Advance one wake-driven browser task for a continuously owned page.
    /// `true` means deno_core reached full idle; `false` means one wake/task was
    /// delivered and the owner should offer another turn after servicing any
    /// higher-priority automation commands.
    #[doc(hidden)]
    pub async fn run_autonomous_event_loop_turn(&mut self) -> Result<bool, String> {
        let idle = match self.js.as_mut() {
            Some(js) => js.run_autonomous_event_loop_turn().await,
            None => Ok(true),
        }?;
        let navigated = self.process_pending_frame_navigations().await;
        Ok(idle && navigated == 0)
    }

    async fn settle_runtime_for_duration(js: &mut ObscuraJsRuntime, duration_ms: u64) {
        let started = tokio::time::Instant::now();
        let _ = js.run_event_loop_for_duration(duration_ms).await;
        let requested = tokio::time::Duration::from_millis(duration_ms);
        let elapsed = started.elapsed();
        if elapsed < requested {
            tokio::time::sleep(requested - elapsed).await;
        }
    }

    /// Append the current URL to the history stack, truncating any forward
    /// entries past the cursor (matches real Chrome: navigating after a
    /// goBack clobbers the forward history).
    pub fn push_history(&mut self, url: String) {
        if url.is_empty() {
            return;
        }
        // Don't dupe consecutive entries (Page.reload would otherwise pile up).
        if self.history.get(self.history_index) == Some(&url) {
            return;
        }
        if !self.history.is_empty() && self.history_index < self.history.len() - 1 {
            self.history.truncate(self.history_index + 1);
        }
        self.history.push(url);
        self.history_index = self.history.len() - 1;
    }

    /// Move the history cursor without re-navigating; used by
    /// Page.navigateToHistoryEntry which then drives the actual fetch.
    pub fn set_history_index(&mut self, idx: usize) {
        if idx < self.history.len() {
            self.history_index = idx;
        }
    }

    async fn navigate_with_wait_post_inner(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
        method: &str,
        body: &str,
        initial_referrer: &str,
    ) -> Result<(), PageError> {
        let mut current_url = url_str.to_string();
        let mut current_method = method.to_string();
        let mut current_body = body.to_string();
        let mut document_referrer = initial_referrer.to_string();
        const REDIRECT_LIMIT: usize = 10;
        for chain in 0..REDIRECT_LIMIT {
            self.navigate_single(
                &current_url,
                wait_until,
                &current_method,
                &current_body,
                &document_referrer,
            )
            .await?;
            if let Some((next_url, next_method, next_body)) = self.take_pending_navigation() {
                if cross_scheme_to_file(&current_url, &next_url) {
                    // SOP gate. A web page must not be able to drive
                    // a navigation to file:// and then read the loaded
                    // document. Without this an http(s) page sets
                    // window.onload, calls location.href = "file:..."
                    // and harvests document.body from a local file
                    // once the new document loads.
                    tracing::warn!(
                        "blocking JS-initiated cross-scheme navigation to file: {} -> {}",
                        current_url,
                        next_url,
                    );
                    break;
                }
                tracing::info!(
                    "JS-triggered navigation chain: {} {} -> {}",
                    current_method,
                    current_url,
                    next_url
                );
                document_referrer = self
                    .url
                    .as_ref()
                    .and_then(|source| {
                        Url::parse(&next_url)
                            .ok()
                            .map(|target| {
                                navigation_referrer_with_policy(
                                    source,
                                    &target,
                                    self.referrer_policy,
                                )
                            })
                    })
                    .unwrap_or_default();
                current_url = next_url;
                current_method = next_method;
                current_body = next_body;
                if chain + 1 == REDIRECT_LIMIT {
                    // Hit the cap and the page still wants to keep
                    // chaining. Surface that as an error instead of
                    // returning Ok(()) so callers can distinguish a
                    // successful load from a redirect storm.
                    return Err(PageError::TooManyRedirects(REDIRECT_LIMIT));
                }
                continue;
            }
            break;
        }
        Ok(())
    }

    async fn navigate_single(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
        method: &str,
        body: &str,
        referrer: &str,
    ) -> Result<(), PageError> {
        self.performance_time_origin = std::time::Instant::now();
        self.performance_time_origin_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1_000.0;
        let url = Url::parse(url_str).map_err(|e| PageError::InvalidUrl(e.to_string()))?;

        self.lifecycle = LifecycleState::Loading;
        self.referrer = referrer.to_string();
        self.referrer_policy = obscura_net::ReferrerPolicy::default();
        self.document_origin = Some(obscura_dom::Origin::from_url(url.as_str()));
        self.document_csp = None;
        self.document_permissions_policy = None;
        self.cross_origin_isolated = false;
        self.document_last_modified = None;
        self.url = Some(url.clone());
        self.network_events.clear();

        if self.context.obey_robots {
            if let Some(domain) = url.host_str() {
                if self.context.robots_cache.is_allowed(domain, "/robots.txt") {
                    let robots_url = format!("{}://{}/robots.txt", url.scheme(), domain);
                    if let Ok(robots_url) = Url::parse(&robots_url) {
                        if let Ok(resp) = self
                            .http_client
                            .fetch_with_callbacks(&robots_url, Some(&self.callbacks))
                            .await
                        {
                            if resp.status == 200 {
                                let body = String::from_utf8_lossy(&resp.body);
                                self.context.robots_cache.parse_and_store(
                                    domain,
                                    &body,
                                    &self.fingerprint.user_agent,
                                );
                            }
                        }
                    }
                }

                if !self.context.robots_cache.is_allowed(domain, url.path()) {
                    self.lifecycle = LifecycleState::Failed;
                    return Err(PageError::NetworkError(format!(
                        "Blocked by robots.txt: {}",
                        url
                    )));
                }
            }
        }

        if url.scheme() == "about" {
            self.navigate_blank();
            self.init_js();
            // Preloads (Page.addScriptToEvaluateOnNewDocument, the
            // Runtime.addBinding shim) must run on about:blank too —
            // puppeteer's `browser.newPage()` lands on about:blank and
            // a follow-up `exposeFunction` is unusable otherwise.
            self.inject_main_document_preloads();
            return Ok(());
        }

        let response = if url.scheme() == "data" {
            let content_type = url_str
                .strip_prefix("data:")
                .and_then(|s| s.split(',').next())
                .unwrap_or("text/html")
                .split(';')
                .next()
                .unwrap_or("text/html")
                .to_string();
            let body_bytes = decode_data_uri(url_str).unwrap_or_default();
            let mut headers = std::collections::HashMap::new();
            headers.insert("content-type".to_string(), content_type);
            Ok(obscura_net::Response {
                url: url.clone(),
                status: 200,
                headers,
                body: body_bytes,
                redirected_from: Vec::new(),
                timing: obscura_net::ResponseTiming::default(),
            })
        } else if method == "POST" {
            self.http_client
                .fetch_document_with_method_referrer(
                    Method::POST,
                    &url,
                    Some(body.as_bytes().to_vec()),
                    Url::parse(referrer).ok(),
                    self.referrer_policy,
                    Some(&self.callbacks),
                )
                .await
        } else {
            self.do_fetch(&url, referrer, self.referrer_policy).await
        }
        .map_err(|e| {
            self.lifecycle = LifecycleState::Failed;
            PageError::NetworkError(e.to_string())
        })?;
        let response_csp = response
            .header("content-security-policy")
            .map(str::to_string);
        self.document_csp = response_csp.clone();
        self.document_permissions_policy = response
            .header("permissions-policy")
            .map(str::to_string);
        self.cross_origin_isolated = response_grants_cross_origin_isolation(&response);
        self.document_last_modified = response.header("last-modified").map(str::to_string);
        if let Some(js) = &self.js {
            js.set_content_security_policy(self.document_csp.as_deref());
            js.set_permissions_policy(self.document_permissions_policy.as_deref());
        }

        // Store binary main resources (images, PDFs, octet-stream) base64 so
        // Network.getResponseBody returns intact bytes. A UTF-8-lossy text store
        // corrupts them (issue #340). Text-like types stay as text.
        let main_is_binary = !is_text_like_content_type(response.content_type());
        self.record_network_event_with_body(
            url.as_str(),
            "GET",
            "Document",
            response.status,
            &response.headers,
            &response.body,
            main_is_binary,
        );

        if !response.redirected_from.is_empty() {
            self.document_origin = Some(obscura_dom::Origin::from_url(response.url.as_str()));
            self.url = Some(response.url.clone());
        }

        // Honor the response charset: HTTP Content-Type → <meta charset> sniff
        // in the first 1KB → UTF-8 fallback. Without this, every non-UTF-8
        // page (GBK, Big5, Shift-JIS, Windows-125x, EUC-KR, ISO-8859-x)
        // came through as replacement characters.
        let (body_text, encoding_name) =
            obscura_net::decode_response_with_name(&response.body, response.content_type());
        self.encoding = encoding_name.to_string();
        let dom = parse_html(&body_text);
        self.document_csp = effective_document_csp(&dom, dom.document(), response_csp);
        if let Some(sandbox) = self.document_csp.as_deref().and_then(|header| {
            crate::frame_policy::ContentSecurityPolicy::parse(header).sandbox_flags()
        }) {
            if sandbox.active
                && !sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN)
            {
                self.document_origin = Some(obscura_dom::Origin::Opaque(
                    obscura_dom::OpaqueOriginId::new(),
                ));
                self.cross_origin_isolated = false;
            }
        }
        self.referrer_policy = document_referrer_policy(
            &dom,
            response.header("referrer-policy"),
        );

        self.title = dom
            .query_selector("title")
            .ok()
            .flatten()
            .map(|title_id| dom.text_content(title_id))
            .unwrap_or_default();

        self.dom = Some(dom);
        // Phase 2b: the Rust frame loader replaces the JS iframe pre-scan; it
        // covers src, srcdoc, data:, nesting, sandbox propagation and the
        // XFO/frame-ancestors/frame-src gates. It must run before init_js
        // moves the DomTree into the JS runtime (self.dom.take() below), and
        // after detaching the previous document's child frames: their host
        // nids belong to the replaced tree, and a stale by_host entry would
        // mask a host in the new document (nids restart per document).
        let main_frame_id = self.frames.main_frame_id().to_string();
        let stale_children = self
            .frames
            .get(&main_frame_id)
            .map(|main| main.children.clone())
            .unwrap_or_default();
        for child in stale_children {
            let removed = self.frames.detach(&child);
            // The old document's frame realms die with the old runtime when
            // init_js below replaces it; destroy them eagerly anyway so a
            // future runtime-reuse change cannot leak them.
            if let Some(js) = self.js.as_mut() {
                for context in &removed {
                    js.destroy_frame_realm(&context.frame_id);
                }
            }
        }
        self.frame_stylesheet_cache.clear();
        // The runtime these frames' timing entries belong to does not exist
        // yet; `init_js` below builds it.
        self.performance_entries_deferred += 1;
        self.load_child_frames().await;
        self.init_js();
        self.performance_entries_deferred -= 1;
        self.record_performance_response(&response, "navigation", "navigation");
        // After the navigation entry, so the timeline starts with it the way
        // a browser's does.
        self.flush_deferred_performance_entries();
        // The top Window's new-document scripts precede every child-frame and
        // top-document author script, just as they precede HTML parsing in a
        // browser. Child worlds receive their own injection below.
        self.inject_main_document_preloads();
        let author_stylesheets = self.fetch_stylesheets().await;

        // Inject CSS as a global so getComputedStyle and any CSS-aware shim
        // can read it. Has to happen before scripts run, regardless of
        // waitUntil, so handlers that read window.__obscura_css see it.
        if !author_stylesheets.is_empty() {
            if let Some(js) = &mut self.js {
                let combined_css = author_stylesheets
                    .iter()
                    .map(|(_, css)| css.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                // Use the thorough template-literal escape that
                // covers U+2028 / U+2029 and other control chars.
                // The previous escaper only handled `, \, and ${,
                // letting attacker-controlled CSS containing a raw
                // U+2028 break out of the template literal and run
                // arbitrary JS in the page's V8 realm.
                let escaped = escape_for_js_template_literal(&combined_css);
                let code = format!("globalThis.__obscura_css = `{}`;", escaped);
                let _ = js.execute_script("<css>", &code);
                for (target, css) in &author_stylesheets {
                    let code = match target {
                        AuthorStylesheetTarget::Linked(link_index) => {
                            materialize_linked_stylesheet_script(*link_index, css)
                        }
                        AuthorStylesheetTarget::InlineImport(style_index) => {
                            materialize_inline_import_script(*style_index, css)
                        }
                    };
                    let _ = js.execute_script("<fetch_stylesheets>", &code);
                }
            }
        }
        self.document_timeline_origin = std::time::Instant::now();
        #[cfg(feature = "render")]
        if let Some(js) = &self.js {
            js.reset_animation_timeline();
        }
        if let Some(js) = &mut self.js {
            // Fire the load events of iframe hosts whose content document the
            // Rust loader committed above (real frame lifecycle lands with
            // Phase 3.5). Deferred one macrotask so handlers attached by page
            // scripts, which run below, still observe them.
            let hosts = self
                .frames
                .get(self.frames.main_frame_id())
                .map(|main| {
                    main.children
                        .iter()
                        .filter_map(|frame_id| self.frames.get(frame_id))
                        .filter_map(|frame| frame.host_nid)
                        .map(|host| host.raw().to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            let script = format!(
                "setTimeout(function() {{ for (const nid of [{}]) {{ try {{ const f = globalThis._wrapEl(nid); if (f && +Deno.core.ops.op_dom('iframe_content_document_root', String(nid), '') >= 0) f.dispatchEvent(new Event('load')); }} catch (e) {{}} }} }}, 0);",
                hosts,
            );
            let _ = js.execute_script("<iframe-load>", &script);
        }

        // Scripts can synchronously flush style/layout through
        // getComputedStyle(), geometry, ResizeObserver, or IntersectionObserver.
        // Seed their image/font dependencies concurrently through the page
        // transport first. Otherwise the first CSSOM read falls into the
        // renderer's synchronous resource loader and serial network latency pins
        // V8, making framework startup take many seconds. This is deliberately
        // bounded: navigation should not wait indefinitely for decorative
        // resources.
        #[cfg(feature = "render")]
        {
            let warmup_ms = std::env::var("OBSCURA_RENDER_RESOURCE_WARMUP_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1_000);
            let _ = self.prepare_screenshot_resources(warmup_ms).await;
        }

        // Frame classic scripts run in their own Window realms before the
        // main document's scripts (Phase 3.8): frame documents committed
        // during the parse above, so their parser scripts precede the parent
        // document's readiness signals.
        self.execute_frame_scripts().await;

        // Spec: DOMContentLoaded fires AFTER parser-blocking scripts run,
        // not before. Skipping execute_scripts() on the DCL path meant
        // every inline <script> in the page was silently dropped: form
        // listeners never registered, frameworks never bootstrapped,
        // page.click() handlers were no-ops. Now scripts run regardless
        // of waitUntil and DCL means "DOM parsed AND scripts executed".
        self.execute_scripts().await;

        // Script insertion/src/location changes enqueue real frame
        // navigations. Drain to a bounded fixed point so a newly loaded frame
        // may create its own child without letting hostile content grow an
        // unbounded synchronous navigation chain.
        for _ in 0..8 {
            if self.process_pending_frame_navigations().await == 0 {
                break;
            }
        }

        // Cross-document postMessage traffic produced by frame and page
        // scripts gets one delivery pass before readiness (Phase 4). It runs
        // after the main scripts so parent-side listeners registered there
        // observe frame messages, matching the task-queue timing; later
        // pumps (settle, event-loop ticks) keep draining as messages appear.
        // Pages without pending messages return immediately.
        if let Some(js) = &mut self.js {
            js.deliver_pending_frame_messages().await;
        }

        #[cfg(feature = "render")]
        {
            // Page scripts and their bounded post-script event-loop pass can
            // create responsive images, inline styles, and @font-face rules
            // that did not exist during the parser warmup above. Discover them
            // before navigation becomes capture-ready. Known parser resources
            // are filtered by the render cache, so ordinary pages pay only the
            // inexpensive scan on this second pass.
            let warmup_ms = std::env::var("OBSCURA_RENDER_RESOURCE_POST_SCRIPT_WARMUP_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1_000);
            let _ = self.prepare_screenshot_resources(warmup_ms).await;
        }

        self.lifecycle = LifecycleState::DomContentLoaded;

        if wait_until == crate::lifecycle::WaitUntil::DomContentLoaded {
            return Ok(());
        }

        if let Some(js) = &mut self.js {
            if let Ok(new_title) = js.evaluate("document.title") {
                if let Some(t) = new_title.as_str() {
                    self.title = t.to_string();
                }
            }
        }

        self.lifecycle = LifecycleState::Loaded;

        if matches!(
            wait_until,
            crate::lifecycle::WaitUntil::NetworkIdle0 | crate::lifecycle::WaitUntil::NetworkIdle2
        ) {
            let threshold = match wait_until {
                crate::lifecycle::WaitUntil::NetworkIdle0 => 0,
                crate::lifecycle::WaitUntil::NetworkIdle2 => 2,
                _ => 0,
            };

            // Same hazard as the post-script settle: a synchronous poll can pin
            // the thread past the 5s network-idle deadline, so arm a watchdog
            // that terminates the isolate ~500ms past it.
            let netidle_wd = self
                .js
                .as_mut()
                .map(|js| js.arm_watchdog(std::time::Duration::from_millis(5500)));
            let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
            let mut idle_since: Option<tokio::time::Instant> = None;

            loop {
                let active = self.http_client.active_requests();
                let now = tokio::time::Instant::now();

                if active <= threshold {
                    if idle_since.is_none() {
                        idle_since = Some(now);
                    }
                    if now.duration_since(idle_since.unwrap())
                        >= tokio::time::Duration::from_millis(500)
                    {
                        break;
                    }
                } else {
                    idle_since = None;
                }

                if now >= deadline {
                    tracing::debug!(
                        "Network idle timeout reached with {} active requests",
                        active
                    );
                    break;
                }

                if let Some(js) = &mut self.js {
                    let _ = tokio::time::timeout(
                        tokio::time::Duration::from_millis(50),
                        js.run_event_loop(),
                    )
                    .await;
                } else {
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            }

            if let Some(token) = netidle_wd {
                if let Some(js) = self.js.as_mut() {
                    js.disarm_watchdog(token);
                }
            }
            self.lifecycle = LifecycleState::NetworkIdle;
        }

        Ok(())
    }

    pub fn navigate_blank(&mut self) {
        self.js = None;
        self.document_origin = Some(obscura_dom::Origin::from_url("about:blank"));
        self.url = Some(Url::parse("about:blank").unwrap());
        self.dom = Some(parse_html(
            "<!DOCTYPE html><html><head></head><body></body></html>",
        ));
        self.title = String::new();
        self.lifecycle = LifecycleState::Loaded;
        self.document_timeline_origin = std::time::Instant::now();
    }

    pub fn url_string(&self) -> String {
        self.url
            .as_ref()
            .map(|u| u.to_string())
            .unwrap_or_else(|| "about:blank".to_string())
    }

    pub fn with_dom<R>(&self, f: impl FnOnce(&DomTree) -> R) -> Option<R> {
        if let Some(js) = &self.js {
            return js.with_dom(f);
        }
        self.dom.as_ref().map(f)
    }

    /// Concurrently seed the synchronous renderer cache through the owning
    /// page transport. This removes serial image/font HTTP from the first
    /// screenshot while retaining cookies, proxy policy, interception, CORS,
    /// response limits, and connection pooling.
    #[cfg(feature = "render")]
    pub async fn prepare_screenshot_resources(&mut self, max_ms: u64) -> usize {
        let started = std::time::Instant::now();
        if max_ms == 0 || self.js.is_none() {
            return 0;
        }
        let Some(document_url) = self.url.clone() else {
            return 0;
        };
        let base_url = self
            .resolve_base_url()
            .unwrap_or_else(|| document_url.clone());
        let mut candidates = std::collections::BTreeMap::new();

        if let Some(js) = &self.js {
            for (raw, profile, root) in js.pending_render_image_urls() {
                if let Ok(mut url) = url::Url::parse(&raw) {
                    if let Some(scope) = js
                        .with_dom(|dom| dom.document_scope(root))
                        .flatten()
                    {
                        let policy = scope
                            .csp
                            .as_deref()
                            .map(crate::frame_policy::ContentSecurityPolicy::parse);
                        if policy.as_ref().is_some_and(|policy| {
                            !policy.resource_src_allows("img-src", url.as_str(), &scope.origin)
                        }) {
                            tracing::info!(
                                "Blocked speculative frame image by Content-Security-Policy: {}",
                                url
                            );
                            continue;
                        }
                    }
                    url.set_fragment(None);
                    candidates.insert((url.to_string(), Some(profile)), ResourceType::Image);
                }
            }
            // CSS sources per document root: the main document plus every
            // active iframe content document (Phase 3.6), whose relative
            // url() assets resolve against the frame's own base URL.
            let css_sources = js
                .with_dom(|dom| {
                    let mut roots: Vec<(obscura_dom::NodeId, Option<String>)> =
                        vec![(dom.document(), None)];
                    let mut index = 0;
                    while index < roots.len() {
                        let root = roots[index].0;
                        for host in dom.iframe_hosts_in_shadow_including_subtree(root) {
                            if let Some(content_root) = dom.iframe_content_document(host) {
                                let frame_base = dom
                                    .document_scope(content_root)
                                    .map(|scope| scope.base_url);
                                roots.push((content_root, frame_base));
                            }
                        }
                        index += 1;
                    }
                    let mut sources = Vec::new();
                    for (root, root_base) in roots {
                        let (root_csp, root_origin) = dom
                            .document_scope(root)
                            .map(|scope| (scope.csp.clone(), scope.origin.clone()))
                            .unwrap_or((None, obscura_dom::Origin::from_url(&document_url.to_string())));
                        for id in dom.descendants(root) {
                            let Some(node) = dom.get_node(id) else {
                                continue;
                            };
                            if node
                                .as_element()
                                .is_some_and(|element| element.local.as_ref() == "style")
                            {
                                sources.push((
                                    dom.text_content(id),
                                    root_base.clone(),
                                    root_csp.clone(),
                                    root_origin.clone(),
                                ));
                            }
                            if let Some(style) = node.get_attribute("style") {
                                sources.push((
                                    style.to_string(),
                                    root_base.clone(),
                                    root_csp.clone(),
                                    root_origin.clone(),
                                ));
                            }
                            if node
                                .as_element()
                                .is_some_and(|element| element.local.as_ref() == "use")
                            {
                                if let Some(href) = node
                                    .get_attribute("href")
                                    .or_else(|| node.get_attribute("xlink:href"))
                                {
                                    sources.push((
                                        format!("url({href})"),
                                        root_base.clone(),
                                        root_csp.clone(),
                                        root_origin.clone(),
                                    ));
                                }
                            }
                        }
                    }
                    sources
                })
                .unwrap_or_default();
            for (css, root_base, root_csp, root_origin) in css_sources {
                let scan_base = root_base
                    .as_deref()
                    .and_then(|raw| url::Url::parse(raw).ok())
                    .unwrap_or_else(|| base_url.clone());
                for raw in css_resource_urls(&css, &scan_base) {
                    if let Ok(mut url) = url::Url::parse(&raw) {
                        let kind = render_resource_type(&url);
                        if let Some(header) = root_csp.as_deref() {
                            let directive = match kind {
                                ResourceType::Font => "font-src",
                                ResourceType::Image => "img-src",
                                _ => "media-src",
                            };
                            let policy = crate::frame_policy::ContentSecurityPolicy::parse(header);
                            if !policy.resource_src_allows(
                                directive,
                                url.as_str(),
                                &root_origin,
                            ) {
                                tracing::info!(
                                    "Blocked speculative frame resource by Content-Security-Policy: {}",
                                    url
                                );
                                continue;
                            }
                        }
                        url.set_fragment(None);
                        candidates.insert((url.to_string(), None), kind);
                    }
                }
            }
            candidates.retain(|(url, profile), _| match profile {
                Some(profile) => !js.render_image_resource_is_known(url, *profile),
                None => !js.render_resource_is_known(url),
            });
        }

        candidates.retain(|(url, _), _| {
            subresource_allowed(Some(&document_url), url) && !self.should_block_url(url)
        });
        if candidates.len() > 128 {
            candidates = candidates.into_iter().take(128).collect();
        }
        if candidates.is_empty() {
            return 0;
        }

        let requested: Vec<(String, Option<obscura_js::ImageRequestProfile>, ResourceType)> =
            candidates
                .into_iter()
                .map(|((url, profile), kind)| (url, profile, kind))
                .collect();
        let client = self.http_client.clone();
        #[cfg(feature = "stealth")]
        let stealth_client = self.stealth_client.clone();
        let callbacks = self.callbacks.clone();
        let initiator = document_url.clone();
        let referrer_policy = self.referrer_policy;
        use futures::StreamExt as _;
        let requests = futures::stream::iter(requested.into_iter().map(|(raw, profile, kind)| {
            let client = client.clone();
            #[cfg(feature = "stealth")]
            let stealth_client = stealth_client.clone();
            let callbacks = callbacks.clone();
            let initiator = initiator.clone();
            let referrer_policy = referrer_policy;
            async move {
                let parsed = url::Url::parse(&raw).expect("validated render resource URL");
                let mut request = ResourceRequest::subresource(kind, &initiator);
                request.referrer_policy = referrer_policy;
                match profile {
                    Some(obscura_js::ImageRequestProfile::CorsSameOrigin) => {
                        request.mode = obscura_net::RequestMode::Cors;
                        request.credentials = obscura_net::RequestCredentials::SameOrigin;
                    }
                    Some(obscura_js::ImageRequestProfile::CorsInclude) => {
                        request.mode = obscura_net::RequestMode::Cors;
                        request.credentials = obscura_net::RequestCredentials::Include;
                    }
                    _ => {}
                }
                #[cfg(feature = "stealth")]
                let result = if let Some(stealth_client) = stealth_client {
                    stealth_client
                        .fetch_resource_with_callbacks(&parsed, request, Some(&callbacks))
                        .await
                } else {
                    client
                        .fetch_resource_with_callbacks(&parsed, request, Some(&callbacks))
                        .await
                };
                #[cfg(not(feature = "stealth"))]
                let result = client
                    .fetch_resource_with_callbacks(&parsed, request, Some(&callbacks))
                    .await;
                (raw, profile, kind, result)
            }
        }))
        .buffer_unordered(16);
        futures::pin_mut!(requests);
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(max_ms);
        let mut loaded = 0usize;
        loop {
            match tokio::time::timeout_at(deadline, requests.next()).await {
                Ok(Some((raw, profile, kind, result))) => {
                    let outcome = match result {
                        Ok(response) => {
                            self.record_performance_response(
                                &response,
                                "resource",
                                match kind {
                                    ResourceType::Font => "css",
                                    _ => "img",
                                },
                            );
                            self.record_network_event_with_body(
                                response.url.as_str(),
                                "GET",
                                match kind {
                                    ResourceType::Font => "Font",
                                    _ => "Image",
                                },
                                response.status,
                                &response.headers,
                                &response.body,
                                true,
                            );
                            if (200..300).contains(&response.status) {
                                loaded += 1;
                                Some(response.body)
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    };
                    if let Some(js) = &mut self.js {
                        match profile {
                            Some(profile) => {
                                js.seed_render_image_resource(raw, profile, outcome)
                            }
                            None => js.seed_render_resource(raw, outcome),
                        }
                    }
                }
                Ok(None) | Err(_) => break,
            }
        }
        // A deadline drops unfinished futures without negative-caching them,
        // so a later warmup can retry slow resources.
        drop(requests);
        tracing::debug!(
            loaded,
            elapsed_ms = started.elapsed().as_millis(),
            "prepared screenshot resources through page transport"
        );
        loaded
    }

    /// Rasterize the current DOM to PNG bytes at `viewport` (CSS pixels), when
    /// the render feature is compiled in. None if the page has no DOM or the
    /// viewport is zero-sized.
    #[cfg(feature = "render")]
    pub fn screenshot(&self, viewport: (f32, f32)) -> Option<Vec<u8>> {
        self.screenshot_with_animation_sample(viewport, self.live_animation_sample())
    }

    /// Rasterize every CSS animation at one explicit local time. This mirrors
    /// Web Animations `currentTime` and is intended for deterministic parity
    /// capture; ordinary screenshots use each live instance's start epoch.
    #[cfg(feature = "render")]
    pub fn screenshot_at_animation_time(
        &self,
        viewport: (f32, f32),
        animation_sample_time: obscura_js::AnimationSampleTime,
    ) -> Option<Vec<u8>> {
        self.screenshot_with_animation_sample(
            viewport,
            obscura_js::AnimationSample {
                time: animation_sample_time,
                mode: obscura_js::AnimationSampleMode::LocalOverride,
            },
        )
    }

    #[cfg(feature = "render")]
    pub fn screenshot_with_animation_sample(
        &self,
        viewport: (f32, f32),
        animation_sample: obscura_js::AnimationSample,
    ) -> Option<Vec<u8>> {
        // Needed to resolve the relative image URLs ("logo.svg") that make up
        // the overwhelming majority of real markup.
        let base_url = self.resolve_base_url();
        let base_url = base_url.as_ref().map(|u| u.as_str());
        if let Some(js) = &self.js {
            if !js.set_animation_sample(animation_sample) {
                return None;
            }
            if let Some(png) = js.screenshot_prepared_with_surface_color(
                viewport,
                base_url,
                self.capture_surface_color(),
            ) {
                return Some(png);
            }
        }
        // Compatibility path for a page without a JS runtime or an ad-hoc
        // viewport/base that does not match the runtime's CSSOM render key.
        let scroll = self
            .js
            .as_ref()
            .map(|js| js.scroll_offset())
            .unwrap_or((0.0, 0.0));
        self.with_dom(|dom| {
            obscura_js::screenshot_png_scrolled_at_animation_time_with_surface_color(
                dom,
                viewport,
                base_url,
                scroll,
                animation_sample.time,
                self.capture_surface_color(),
            )
        })
            .flatten()
    }

    /// Rasterize an immutable document-space rectangle from the page's retained
    /// layout. Unlike [`Self::screenshot`], this may address content outside the
    /// live viewport and scale the output without relayout or scripted scroll.
    #[cfg(feature = "render")]
    pub fn screenshot_region(
        &self,
        region: obscura_js::CaptureRegion,
    ) -> Result<Vec<u8>, obscura_js::CaptureError> {
        self.screenshot_region_with_animation_sample(region, self.live_animation_sample())
    }

    #[cfg(feature = "render")]
    pub fn screenshot_region_at_animation_time(
        &self,
        region: obscura_js::CaptureRegion,
        animation_sample_time: obscura_js::AnimationSampleTime,
    ) -> Result<Vec<u8>, obscura_js::CaptureError> {
        self.screenshot_region_with_animation_sample(
            region,
            obscura_js::AnimationSample {
                time: animation_sample_time,
                mode: obscura_js::AnimationSampleMode::LocalOverride,
            },
        )
    }

    #[cfg(feature = "render")]
    pub fn screenshot_region_with_animation_sample(
        &self,
        region: obscura_js::CaptureRegion,
        animation_sample: obscura_js::AnimationSample,
    ) -> Result<Vec<u8>, obscura_js::CaptureError> {
        let js = self
            .js
            .as_ref()
            .ok_or(obscura_js::CaptureError::PaintFailed)?;
        if !js.set_animation_sample(animation_sample) {
            return Err(obscura_js::CaptureError::PaintFailed);
        }
        js.screenshot_prepared_region_with_surface_color(region, self.capture_surface_color())
    }

    /// Scrollable document dimensions from the retained render layout. Unlike
    /// DOM properties evaluated in page JavaScript, this cannot be shadowed or
    /// monkey-patched by the document being captured.
    #[cfg(feature = "render")]
    pub fn prepared_content_size(&self) -> Option<(f32, f32)> {
        self.prepared_content_size_with_animation_sample(self.live_animation_sample())
    }

    #[cfg(feature = "render")]
    pub fn prepared_content_size_at_animation_time(
        &self,
        animation_sample_time: obscura_js::AnimationSampleTime,
    ) -> Option<(f32, f32)> {
        self.prepared_content_size_with_animation_sample(obscura_js::AnimationSample {
            time: animation_sample_time,
            mode: obscura_js::AnimationSampleMode::LocalOverride,
        })
    }

    #[cfg(feature = "render")]
    pub fn prepared_content_size_with_animation_sample(
        &self,
        animation_sample: obscura_js::AnimationSample,
    ) -> Option<(f32, f32)> {
        let js = self.js.as_ref()?;
        js.set_animation_sample(animation_sample)
            .then(|| js.prepared_content_size())
            .flatten()
    }

    #[cfg(feature = "render")]
    pub fn live_animation_sample(&self) -> obscura_js::AnimationSample {
        if let Some(js) = &self.js {
            return js.live_animation_sample();
        }
        let milliseconds = self.document_timeline_origin.elapsed().as_secs_f64() * 1_000.0;
        obscura_js::AnimationSample {
            time: obscura_js::AnimationSampleTime {
                milliseconds: milliseconds.min(f64::from(f32::MAX)) as f32,
            },
            mode: obscura_js::AnimationSampleMode::DocumentTime,
        }
    }

    #[cfg(feature = "render")]
    pub fn prepared_has_active_css_animations(&self) -> bool {
        self.js
            .as_ref()
            .is_some_and(|js| js.prepared_has_active_css_animations())
    }

    /// Renderer-owned root scroll offset for document-space capture routing.
    #[cfg(feature = "render")]
    pub fn screenshot_scroll_offset(&self) -> (f32, f32) {
        self.js
            .as_ref()
            .map(|js| js.scroll_offset())
            .unwrap_or((0.0, 0.0))
    }

    /// Absolute URLs the page pulled in via fetch()/XHR (issue #301). Empty
    /// when the page has no live JS runtime.
    pub fn fetched_urls(&self) -> Vec<String> {
        self.js
            .as_ref()
            .map(|js| js.fetched_urls())
            .unwrap_or_default()
    }

    /// Move network events recorded for script-initiated requests
    /// (fetch/XHR/dynamic resource) from the JS runtime into this page's
    /// network_events, so the CDP layer emits Network.requestWillBeSent /
    /// responseReceived for them (issue #406). Idempotent: the runtime's queue
    /// is drained, so calling this repeatedly does not duplicate events. The
    /// fetch-{N} request id is preserved so Network.getResponseBody resolves.
    pub fn sync_js_network_events(&mut self) {
        let events = match self.js.as_ref() {
            Some(js) => js.take_js_network_events(),
            None => return,
        };
        for ev in events {
            self.network_events.push(NetworkEvent {
                request_id: ev.request_id,
                url: ev.url,
                method: ev.method,
                resource_type: "Fetch".to_string(),
                frame_id: None,
                status: ev.status,
                headers: std::collections::HashMap::new(),
                response_headers: Arc::new(ev.response_headers),
                body_size: ev.body_size,
                timestamp: ev.timestamp,
            });
        }
    }

    pub fn dom(&self) -> Option<&DomTree> {
        self.dom.as_ref()
    }

    /// V8 isolate handle for this page's runtime, if it has been initialized.
    /// Lets the CDP dispatcher arm a per-command watchdog (which bounds any one
    /// command so a hung page cannot hold this connection's V8 lock forever)
    /// without taking `&mut self`.
    pub fn isolate_handle(&self) -> Option<obscura_js::runtime::IsolateHandle> {
        self.js.as_ref().map(|js| js.isolate_handle())
    }

    /// Clear a V8 termination left by a per-command watchdog so the next command
    /// on this page can run. No-op if the runtime is absent or not terminating.
    pub fn cancel_v8_termination(&mut self) {
        if let Some(js) = self.js.as_mut() {
            js.cancel_termination();
        }
    }

    /// Like [`Self::evaluate`] but bounded by a V8 watchdog so a runaway
    /// expression cannot hang the process. A non-zero `timeout` of zero falls
    /// back to the unbounded path.
    pub fn evaluate_with_timeout(
        &mut self,
        expression: &str,
        timeout: std::time::Duration,
    ) -> serde_json::Value {
        if let Some(js) = &mut self.js {
            match js.evaluate_with_timeout(expression, timeout) {
                Ok(val) => val,
                Err(e) => {
                    tracing::debug!(
                        "JS eval error/timeout for '{}': {}",
                        truncate_on_char_boundary(expression, 80),
                        e
                    );
                    serde_json::Value::Null
                }
            }
        } else {
            self.evaluate(expression)
        }
    }

    pub fn evaluate(&mut self, expression: &str) -> serde_json::Value {
        if let Some(js) = &mut self.js {
            match js.evaluate(expression) {
                Ok(val) => val,
                Err(e) => {
                    tracing::debug!(
                        "JS eval error for '{}': {}",
                        truncate_on_char_boundary(expression, 80),
                        e
                    );
                    serde_json::Value::Null
                }
            }
        } else {
            match expression.trim() {
                "document.title" => serde_json::Value::String(self.title.clone()),
                "document.URL" | "document.location.href" | "window.location.href" => {
                    serde_json::Value::String(self.url_string())
                }
                _ => serde_json::Value::Null,
            }
        }
    }

    /// Resolve top-level viewport coordinates into the deepest rendered frame
    /// document. The frame id/generation is absent for the main document.
    #[cfg(feature = "render")]
    pub fn input_target_at_point(
        &mut self,
        x: f32,
        y: f32,
    ) -> Option<(Option<(String, u64)>, u32, f32, f32)> {
        let (root, node, point) = self.js.as_ref()?.input_target_at_point(x, y)?;
        let main_root = self.js.as_ref()?.with_dom(|dom| dom.document())?;
        if root == main_root {
            return Some((None, node.raw(), point.0, point.1));
        }
        let frame = self
            .frames
            .frame_ids()
            .filter_map(|id| self.frames.get(id))
            .find(|frame| frame.active_document_root == Some(root))?;
        Some((
            Some((frame.frame_id.clone(), frame.document_generation)),
            node.raw(),
            point.0,
            point.1,
        ))
    }

    pub fn set_input_frame_target(&mut self, target: Option<(String, u64)>) {
        self.input_frame_target = target;
    }

    pub fn input_frame_target(&self) -> Option<(String, u64)> {
        let (frame_id, generation) = self.input_frame_target.as_ref()?;
        self.frames
            .get(frame_id)
            .filter(|frame| frame.document_generation == *generation)
            .map(|_| (frame_id.clone(), *generation))
    }

    pub async fn evaluate_for_cdp(
        &mut self,
        expression: &str,
        return_by_value: bool,
        await_promise: bool,
    ) -> obscura_js::runtime::RemoteObjectInfo {
        if let Some(js) = &mut self.js {
            match js
                .evaluate_for_cdp(expression, return_by_value, await_promise)
                .await
            {
                Ok(info) => info,
                Err(e) => {
                    tracing::debug!("evaluate_for_cdp error: {}", e);
                    obscura_js::runtime::RemoteObjectInfo {
                        js_type: "undefined".into(),
                        subtype: None,
                        class_name: String::new(),
                        description: String::new(),
                        object_id: None,
                        value: None,
                    }
                }
            }
        } else {
            let val = self.evaluate(expression);
            obscura_js::runtime::RemoteObjectInfo {
                js_type: match &val {
                    serde_json::Value::String(_) => "string".into(),
                    serde_json::Value::Number(_) => "number".into(),
                    serde_json::Value::Bool(_) => "boolean".into(),
                    _ => "undefined".into(),
                },
                subtype: None,
                class_name: String::new(),
                description: String::new(),
                object_id: None,
                value: Some(val),
            }
        }
    }

    pub async fn evaluate_for_cdp_with_timeout(
        &mut self,
        expression: &str,
        return_by_value: bool,
        await_promise: bool,
        await_timeout_ms: u64,
    ) -> Result<obscura_js::runtime::RemoteObjectInfo, String> {
        if await_promise {
            let pending = self
                .js
                .as_mut()
                .ok_or("JavaScript runtime unavailable")?
                .start_await_evaluate_for_cdp(expression)?;
            // The expression above may synchronously set iframe.src or append
            // a connected iframe and then await its load event. Commit those
            // browser tasks before pumping the Promise, otherwise each side
            // waits for the other until the CDP timeout.
            self.process_pending_frame_navigations().await;
            return self
                .js
                .as_mut()
                .ok_or("JavaScript runtime unavailable")?
                .finish_await_evaluate_for_cdp(
                    pending,
                    return_by_value,
                    await_timeout_ms,
                )
                .await;
        }
        if let Some(js) = &mut self.js {
            js.evaluate_for_cdp_with_timeout(
                expression,
                return_by_value,
                false,
                await_timeout_ms,
            )
            .await
        } else {
            let value = self.evaluate(expression);
            Ok(obscura_js::runtime::RemoteObjectInfo {
                js_type: match &value {
                    serde_json::Value::String(_) => "string".into(),
                    serde_json::Value::Number(_) => "number".into(),
                    serde_json::Value::Bool(_) => "boolean".into(),
                    _ => "undefined".into(),
                },
                subtype: None,
                class_name: String::new(),
                description: String::new(),
                object_id: None,
                value: Some(value),
            })
        }
    }

    pub async fn call_function_on_for_cdp(
        &mut self,
        function_declaration: &str,
        object_id: Option<&str>,
        args: &[serde_json::Value],
        return_by_value: bool,
        await_promise: bool,
    ) -> obscura_js::runtime::RemoteObjectInfo {
        if let Some(js) = &mut self.js {
            match js
                .call_function_on_for_cdp(
                    function_declaration,
                    object_id,
                    args,
                    return_by_value,
                    await_promise,
                )
                .await
            {
                Ok(info) => info,
                Err(e) => {
                    tracing::debug!("callFunctionOn error: {}", e);
                    obscura_js::runtime::RemoteObjectInfo {
                        js_type: "undefined".into(),
                        subtype: None,
                        class_name: String::new(),
                        description: String::new(),
                        object_id: None,
                        value: None,
                    }
                }
            }
        } else {
            obscura_js::runtime::RemoteObjectInfo {
                js_type: "undefined".into(),
                subtype: None,
                class_name: String::new(),
                description: String::new(),
                object_id: None,
                value: None,
            }
        }
    }

    pub async fn call_function_on_for_cdp_with_timeout(
        &mut self,
        function_declaration: &str,
        object_id: Option<&str>,
        args: &[serde_json::Value],
        return_by_value: bool,
        await_promise: bool,
        await_timeout_ms: u64,
    ) -> Result<obscura_js::runtime::RemoteObjectInfo, String> {
        let js = self.js.as_mut().ok_or("JavaScript runtime unavailable")?;
        js.call_function_on_for_cdp_with_timeout(
            function_declaration,
            object_id,
            args,
            return_by_value,
            await_promise,
            await_timeout_ms,
        )
        .await
    }

    pub fn set_blocked_urls(&mut self, patterns: Vec<String>) {
        self.blocked_url_patterns = patterns.clone();
        if let Some(js) = &self.js {
            js.set_blocked_urls(patterns);
        }
    }

    pub fn release_object(&mut self, object_id: &str) {
        if let Some(js) = &mut self.js {
            js.release_object(object_id);
        }
    }

    fn record_network_event(
        &mut self,
        url: &str,
        method: &str,
        resource_type: &str,
        status: u16,
        response_headers: &std::collections::HashMap<String, String>,
        body_size: usize,
    ) {
        self.record_network_event_inner(
            url,
            method,
            resource_type,
            status,
            response_headers,
            body_size,
        );
    }

    fn record_network_event_with_body(
        &mut self,
        url: &str,
        method: &str,
        resource_type: &str,
        status: u16,
        response_headers: &std::collections::HashMap<String, String>,
        body: &[u8],
        base64_encoded: bool,
    ) {
        let request_id = self.record_network_event_inner(
            url,
            method,
            resource_type,
            status,
            response_headers,
            body.len(),
        );
        self.store_response_body(request_id, body, base64_encoded);
    }

    fn record_network_event_with_body_for_frame(
        &mut self,
        frame_id: &str,
        url: &str,
        method: &str,
        resource_type: &str,
        status: u16,
        response_headers: &std::collections::HashMap<String, String>,
        body: &[u8],
        base64_encoded: bool,
    ) {
        let request_id = self.record_network_event_inner(
            url,
            method,
            resource_type,
            status,
            response_headers,
            body.len(),
        );
        if let Some(event) = self
            .network_events
            .iter_mut()
            .rev()
            .find(|event| event.request_id == request_id)
        {
            event.frame_id = Some(frame_id.to_string());
        }
        self.store_response_body(request_id, body, base64_encoded);
    }

    fn record_network_event_inner(
        &mut self,
        url: &str,
        method: &str,
        resource_type: &str,
        status: u16,
        response_headers: &std::collections::HashMap<String, String>,
        body_size: usize,
    ) -> String {
        self.network_event_counter += 1;
        let request_id = format!("{}.{}", self.id, self.network_event_counter);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        self.network_events.push(NetworkEvent {
            request_id: request_id.clone(),
            url: url.to_string(),
            method: method.to_string(),
            resource_type: resource_type.to_string(),
            frame_id: None,
            status,
            headers: std::collections::HashMap::new(),
            response_headers: Arc::new(response_headers.clone()),
            body_size,
            timestamp,
        });
        request_id
    }

    fn store_response_body(&mut self, request_id: String, body: &[u8], base64_encoded: bool) {
        let max_entries = response_body_entry_limit();
        let max_bytes = response_body_byte_limit();
        if max_entries == 0 || max_bytes == 0 || body.len() > max_bytes {
            return;
        }
        let body = if base64_encoded {
            BASE64.encode(body)
        } else {
            String::from_utf8_lossy(body).to_string()
        };
        self.response_bodies.insert(
            request_id.clone(),
            StoredResponseBody {
                body,
                base64_encoded,
            },
        );
        self.response_body_order.push_back(request_id);
        while self.response_body_order.len() > max_entries {
            if let Some(oldest) = self.response_body_order.pop_front() {
                self.response_bodies.remove(&oldest);
            }
        }
    }

    pub fn get_response_body(&self, request_id: &str) -> Option<StoredResponseBody> {
        self.response_bodies.get(request_id).cloned().or_else(|| {
            self.js
                .as_ref()?
                .get_network_response_body(request_id)
                .map(|body| StoredResponseBody {
                    body: body.body,
                    base64_encoded: body.base64_encoded,
                })
        })
    }

    /// Take a stored response body as raw bytes for CDP streaming
    /// (Fetch.takeResponseBodyAsStream). Removes it from the in-memory cache and
    /// transfers ownership to the caller, so a large body is held once and freed
    /// when the stream is closed rather than lingering in this long-running
    /// process (issue #360). Binary bodies are stored base64 (byte-exact); text
    /// bodies return their UTF-8 bytes. Returns None if the body was never
    /// cached (e.g. it exceeded OBSCURA_NETWORK_BODY_BUFFER_BYTES and was
    /// dropped) or the id is unknown.
    pub fn take_response_body_raw(&mut self, request_id: &str) -> Option<Vec<u8>> {
        let stored = if let Some(body) = self.response_bodies.remove(request_id) {
            self.response_body_order.retain(|id| id != request_id);
            body
        } else {
            self.js
                .as_ref()?
                .get_network_response_body(request_id)
                .map(|b| StoredResponseBody {
                    body: b.body,
                    base64_encoded: b.base64_encoded,
                })?
        };
        if stored.base64_encoded {
            BASE64.decode(stored.body.as_bytes()).ok()
        } else {
            Some(stored.body.into_bytes())
        }
    }

    /// Make the body stored under `from_id` also retrievable under `to_id`.
    /// The main navigation resource is stored under its internal request id, but
    /// the CDP layer reports it to clients with the navigation's loaderId as the
    /// requestId (Chrome's `requestId === loaderId` convention). Without this
    /// alias, `Network.getResponseBody(loaderId)` misses and a client navigating
    /// straight to an image or other resource cannot read the main-response body
    /// (issue #340).
    pub fn alias_response_body(&mut self, from_id: &str, to_id: &str) {
        if from_id == to_id || self.response_bodies.contains_key(to_id) {
            return;
        }
        if let Some(body) = self.response_bodies.get(from_id).cloned() {
            self.response_bodies.insert(to_id.to_string(), body);
            self.response_body_order.push_back(to_id.to_string());
        }
    }

    pub fn clear_response_bodies(&mut self) {
        self.response_bodies.clear();
        self.response_body_order.clear();
        if let Some(js) = &self.js {
            js.clear_network_response_bodies();
        }
    }

    pub fn execute_preload_script(&mut self, source: &str) -> Result<(), String> {
        if let Some(js) = &mut self.js {
            js.execute_script("<preload>", source)
        } else {
            Err("No JS runtime".to_string())
        }
    }

    pub fn suspend_js(&mut self) {
        let Some(js) = &self.js else {
            return;
        };
        let started_script_ids = js.started_script_ids();
        let dom = js.take_dom();
        if let Some(dom) = dom {
            self.dom = Some(dom);
            self.suspended_started_script_ids = started_script_ids;
        } else {
            self.suspended_started_script_ids.clear();
        }
        self.js = None;
    }

    pub fn resume_js(&mut self) {
        if self.js.is_some() {
            return;
        }
        let started_script_ids = std::mem::take(&mut self.suspended_started_script_ids);
        self.init_js();
        if let Some(js) = &self.js {
            js.restore_started_script_ids(&started_script_ids);
        }
    }

    pub fn has_js(&self) -> bool {
        self.js.is_some()
    }

    pub fn release_object_group(&mut self) {
        if let Some(js) = &mut self.js {
            js.release_object_group();
        }
    }

    pub fn take_pending_navigation(&self) -> Option<(String, String, String)> {
        if let Some(js) = &self.js {
            js.take_pending_navigation()
        } else {
            None
        }
    }

    /// Commit iframe navigations requested by script through the Rust frame
    /// controller. This also discovers newly-connected iframe elements, whose
    /// initial about:blank/src/srcdoc browsing context cannot be created while
    /// synchronous JavaScript still owns the V8 isolate.
    pub async fn process_pending_frame_navigations(&mut self) -> usize {
        let (root_requests, iframe_requests) = match self.js.as_ref() {
            Some(js) => (
                js.take_pending_frame_navigations(),
                js.take_pending_iframe_navigations(),
            ),
            None => return 0,
        };
        if root_requests.is_empty() && iframe_requests.is_empty() {
            return 0;
        }

        let borrowed_from_js = if self.dom.is_none() {
            match self.js.as_ref().and_then(|js| js.take_dom()) {
                Some(dom) => {
                    self.dom = Some(dom);
                    true
                }
                None => return 0,
            }
        } else {
            false
        };

        let mut explicit_by_host = std::collections::HashMap::new();
        for request in iframe_requests {
            explicit_by_host.insert(request.host_nid, request);
        }

        let mut discovered = Vec::new();
        if let Some(dom) = self.dom.as_ref() {
            let main_id = self.frames.main_frame_id().to_string();
            for host in dom.iframe_hosts_in_shadow_including_subtree(dom.document()) {
                if dom.is_connected(host) && self.frames.by_host(host).is_none() {
                    discovered.push((main_id.clone(), host));
                }
            }
            let frame_scopes: Vec<(String, obscura_dom::NodeId)> = self
                .frames
                .frame_ids()
                .filter_map(|frame_id| {
                    let frame = self.frames.get(frame_id)?;
                    frame
                        .active_document_root
                        .map(|root| (frame_id.to_string(), root))
                })
                .collect();
            for (parent_id, root) in frame_scopes {
                for host in dom.iframe_hosts_in_shadow_including_subtree(root) {
                    if dom.is_connected(host) && self.frames.by_host(host).is_none() {
                        discovered.push((parent_id.clone(), host));
                    }
                }
            }
        }

        let mut jobs: Vec<(String, FrameNavigationRequest)> = Vec::new();
        let mut latest_by_root = std::collections::HashMap::new();
        for (document_root, url, method, body) in root_requests {
            latest_by_root.insert(document_root, (url, method, body));
        }
        for (document_root, (url, method, body)) in latest_by_root {
            let frame_id = self.frames.frame_ids().find_map(|frame_id| {
                self.frames.get(frame_id).and_then(|frame| {
                    (frame.active_document_root == Some(obscura_dom::NodeId::new(document_root)))
                        .then(|| frame_id.to_string())
                })
            });
            if let Some(frame_id) = frame_id {
                jobs.push((
                    frame_id,
                    FrameNavigationRequest {
                        url: Some(url),
                        method: Some(method),
                        body: (!body.is_empty()).then_some(body.into_bytes()),
                        ..FrameNavigationRequest::default()
                    },
                ));
            }
        }

        for (parent_id, host) in discovered {
            if let Some(frame_id) = self.frames.attach_child(&parent_id, host) {
                let request = self
                    .dom
                    .as_ref()
                    .and_then(|dom| dom.get_node(host))
                    .map(|node| FrameNavigationRequest {
                        url: node.get_attribute("src").map(str::to_string),
                        srcdoc: node.get_attribute("srcdoc").map(str::to_string),
                        referrer_policy: node
                            .get_attribute("referrerpolicy")
                            .map(str::to_string),
                        sandbox: obscura_dom::SandboxFlags::parse(
                            node.get_attribute("sandbox"),
                        ),
                        allow: node.get_attribute("allow").map(str::to_string),
                        ..FrameNavigationRequest::default()
                    })
                    .unwrap_or_default();
                jobs.push((frame_id, request));
            }
        }

        for (host_nid, pending) in explicit_by_host {
            let host = obscura_dom::NodeId::new(host_nid);
            let Some(frame_id) = self.frames.by_host(host).map(|frame| frame.frame_id.clone()) else {
                continue;
            };
            let Some(dom) = self.dom.as_ref() else {
                continue;
            };
            if !dom.is_connected(host) {
                continue;
            }
            let sandbox = dom
                .get_node(host)
                .map(|node| obscura_dom::SandboxFlags::parse(node.get_attribute("sandbox")))
                .unwrap_or_default();
            let allow = dom
                .get_node(host)
                .and_then(|node| node.get_attribute("allow").map(str::to_string));
            let request = if let Some(url) = pending.url {
                FrameNavigationRequest {
                    url: Some(url),
                    method: Some(pending.method),
                    body: (!pending.body.is_empty()).then_some(pending.body.into_bytes()),
                    sandbox,
                    allow: allow.clone(),
                    ..FrameNavigationRequest::default()
                }
            } else {
                dom.get_node(host)
                    .map(|node| FrameNavigationRequest {
                        url: node.get_attribute("src").map(str::to_string),
                        srcdoc: node.get_attribute("srcdoc").map(str::to_string),
                        referrer_policy: node
                            .get_attribute("referrerpolicy")
                            .map(str::to_string),
                        sandbox,
                        allow,
                        ..FrameNavigationRequest::default()
                    })
                    .unwrap_or_default()
            };
            if let Some(existing) = jobs.iter_mut().find(|(id, _)| *id == frame_id) {
                existing.1 = request;
            } else {
                jobs.push((frame_id, request));
            }
        }

        if borrowed_from_js {
            if let Some(dom) = self.dom.take() {
                if let Some(js) = self.js.as_ref() {
                    js.return_borrowed_dom(dom);
                }
            }
        }

        let mut committed = 0;
        for (frame_id, request) in jobs {
            match self.navigate_frame_for_cdp(&frame_id, request).await {
                Ok(()) => committed += 1,
                Err(error) => tracing::debug!(
                    "script-requested iframe navigation for {} failed: {}",
                    frame_id,
                    error
                ),
            }
        }
        committed
    }

    pub fn take_pending_binding_calls(&self) -> Vec<(String, String)> {
        if let Some(js) = &self.js {
            js.take_pending_binding_calls()
        } else {
            Vec::new()
        }
    }

    pub fn set_preload_scripts(&mut self, scripts: Vec<PreloadScript>) {
        self.preload_scripts = scripts;
    }

    pub fn set_debugger_enabled(&mut self, enabled: bool) {
        self.debugger_enabled = enabled;
        if enabled {
            if let Some(js) = self.js.as_mut() {
                js.enable_debugger();
            }
        }
    }

    pub async fn debugger_scripts(
        &mut self,
    ) -> Result<Vec<obscura_js::runtime::DebuggerScript>, String> {
        self.js
            .as_mut()
            .ok_or_else(|| "JavaScript runtime unavailable".to_string())?
            .debugger_scripts()
            .await
    }

    pub async fn debugger_script_source(&mut self, script_id: &str) -> Result<String, String> {
        self.js
            .as_mut()
            .ok_or_else(|| "JavaScript runtime unavailable".to_string())?
            .debugger_script_source(script_id)
            .await
    }

    fn inject_main_document_preloads(&mut self) {
        let scripts = self.preload_scripts.clone();
        if scripts.is_empty() {
            return;
        }
        let frame_id = self.frames.main_frame_id().to_string();
        let generation = self
            .frames
            .get(&frame_id)
            .map(|frame| frame.document_generation)
            .unwrap_or_default();
        let content_root = self
            .js
            .as_ref()
            .and_then(|js| js.with_dom(|dom| dom.document().raw()))
            .unwrap_or_default();
        let base_url = self.url_string();
        let Some(js) = self.js.as_mut() else {
            return;
        };
        for script in scripts {
            let result = match script.world_name.as_deref() {
                None => js.execute_script_guarded("<preload>", &script.source),
                Some(world_name) => js
                    .ensure_isolated_world_realm(
                        &frame_id,
                        generation,
                        script.world_id,
                        world_name,
                        content_root,
                        &base_url,
                    )
                    .and_then(|_| {
                        js.execute_script_in_frame_world_realm(
                            &frame_id,
                            generation,
                            script.world_id,
                            "<preload>",
                            &script.source,
                        )
                        .map(|_| ())
                    }),
            };
            if let Err(error) = result {
                tracing::debug!("Preload script error: {}", error);
            }
        }
    }

    /// Apply a newly registered source to every already-existing matching
    /// world, implementing CDP runImmediately.
    pub fn run_preload_script_immediately(&mut self, script: &PreloadScript) {
        let main_id = self.frames.main_frame_id().to_string();
        let main_generation = self
            .frames
            .get(&main_id)
            .map(|frame| frame.document_generation)
            .unwrap_or_default();
        let main_root = self
            .with_dom(|dom| dom.document().raw())
            .unwrap_or_default();
        let main_base = self.url_string();
        let child_targets: Vec<(String, u64, u32, String)> = self
            .frames
            .frame_ids()
            .filter(|frame_id| *frame_id != main_id)
            .filter_map(|frame_id| {
                let frame = self.frames.get(frame_id)?;
                let root = frame.active_document_root?;
                let base = self
                    .with_dom(|dom| dom.document_scope(root))
                    .flatten()
                    .map(|scope| scope.base_url)
                    .unwrap_or_else(|| "about:blank".to_string());
                Some((
                    frame_id.to_string(),
                    frame.document_generation,
                    root.raw(),
                    base,
                ))
            })
            .collect();
        let Some(js) = self.js.as_mut() else {
            return;
        };
        match script.world_name.as_deref() {
            None => {
                let _ = js.execute_script_guarded("<preload>", &script.source);
                for (frame_id, generation, root, base) in child_targets {
                    if js
                        .ensure_frame_realm(&frame_id, generation, root, &base)
                        .is_ok()
                    {
                        let _ = js.execute_script_in_frame_realm(
                            &frame_id,
                            generation,
                            "<preload>",
                            &script.source,
                        );
                    }
                }
            }
            Some(world_name) => {
                let mut targets =
                    vec![(main_id, main_generation, main_root, main_base)];
                targets.extend(child_targets);
                for (frame_id, generation, root, base) in targets {
                    if js
                        .ensure_isolated_world_realm(
                            &frame_id,
                            generation,
                            script.world_id,
                            world_name,
                            root,
                            &base,
                        )
                        .is_ok()
                    {
                        let _ = js.execute_script_in_frame_world_realm(
                            &frame_id,
                            generation,
                            script.world_id,
                            "<preload>",
                            &script.source,
                        );
                    }
                }
            }
        }
    }

    /// Append a script that runs in the page before any of the page's own
    /// `<script>` tags, matching CDP `Page.addScriptToEvaluateOnNewDocument`.
    /// Takes effect on the next navigation (`goto` / `navigate*`).
    pub fn add_preload_script(&mut self, script: &str) {
        self.preload_scripts
            .push(PreloadScript::main_world(script));
    }

    /// Enable CDP-Fetch-style interception of JS-initiated `fetch()`/XHR.
    /// Returns a receiver yielding every such request; resolve each through its
    /// `resolver` with `InterceptResolution::{Continue, Fulfill, Fail}` to pass,
    /// mock, or block it. Works in stealth and non-stealth. Mirrors how the CDP
    /// server wires the channel (`obscura-cdp/src/server.rs`).
    pub fn enable_interception(
        &mut self,
    ) -> tokio::sync::mpsc::UnboundedReceiver<obscura_js::ops::InterceptedRequest> {
        let (tx, rx) =
            tokio::sync::mpsc::unbounded_channel::<obscura_js::ops::InterceptedRequest>();
        self.set_intercept_tx(tx);
        self.enable_intercept(true);
        rx
    }

    /// Register a passive callback fired for every JS `fetch()`/XHR (and
    /// navigation) request this page makes, once the method/headers/body are
    /// known and before it is sent. Non-blocking; use `enable_interception` to
    /// mutate or block. Returns a stable id; pass it to `off_request` to
    /// detach (issue #408). Scoped to this page: it never sees sibling pages'
    /// requests and dies with the page.
    pub fn on_request(&mut self, cb: RequestCallback) -> u64 {
        self.callbacks.add_request(cb)
    }

    /// Register a passive callback fired with every JS `fetch()`/XHR (and
    /// navigation) response this page receives, including its body.
    /// Non-blocking. The main path for crawlers that need to capture API
    /// response payloads. Returns a stable id for `off_response`. Page-scoped
    /// like `on_request`.
    pub fn on_response(&mut self, cb: ResponseCallback) -> u64 {
        self.callbacks.add_response(cb)
    }

    /// Detach a request observer registered with `on_request`. Returns true if
    /// one was removed.
    pub fn off_request(&mut self, id: u64) -> bool {
        self.callbacks.remove_request(id)
    }

    /// Detach a response observer registered with `on_response`. Returns true if
    /// one was removed.
    pub fn off_response(&mut self, id: u64) -> bool {
        self.callbacks.remove_response(id)
    }

    pub async fn process_pending_navigation(&mut self) -> Result<bool, PageError> {
        if let Some((url, method, body)) = self.take_pending_navigation() {
            let source_url = self
                .url
                .as_ref()
                .and_then(|source| {
                    Url::parse(&url)
                        .ok()
                        .map(|target| navigation_referrer(source, &target))
                })
                .unwrap_or_default();
            let nav_timeout = self.navigation_timeout();
            let nav_timeout_ms = duration_millis_u64(nav_timeout);
            let result = tokio::time::timeout(
                nav_timeout,
                self.navigate_with_wait_post_inner(
                    &url,
                    crate::lifecycle::WaitUntil::Load,
                    &method,
                    &body,
                    &source_url,
                ),
            )
            .await
            .map_err(|_| {
                self.lifecycle = crate::lifecycle::LifecycleState::Failed;
                PageError::NetworkError(format!("navigation exceeded {nav_timeout_ms}ms deadline"))
            })?;
            result?;
            self.push_history(self.url_string());
            Ok(true)
        } else {
            self.process_pending_frame_navigations().await;
            Ok(false)
        }
    }

    pub fn set_intercept_tx(
        &mut self,
        tx: tokio::sync::mpsc::UnboundedSender<obscura_js::ops::InterceptedRequest>,
    ) {
        self.intercept_tx = Some(tx.clone());
        if let Some(js) = &self.js {
            js.set_intercept_tx(tx);
        }
    }

    pub fn enable_intercept(&mut self, enabled: bool) {
        self.intercept_enabled = enabled;
        if let Some(js) = &self.js {
            js.set_intercept_enabled(enabled);
        }
    }
}

fn script_response_is_executable(status: u16) -> bool {
    (200..=299).contains(&status)
}

fn url_matches_cdp_pattern(pattern: &str, url: &str) -> bool {
    if pattern == "*" {
        return true;
    }

    let mut remainder = url;
    let mut first = true;
    for part in pattern.split('*') {
        if part.is_empty() {
            continue;
        }

        let Some(index) = remainder.find(part) else {
            return false;
        };

        if first && !pattern.starts_with('*') && index != 0 {
            return false;
        }

        remainder = &remainder[index + part.len()..];
        first = false;
    }

    pattern.ends_with('*') || remainder.is_empty()
}

// ---------------------------------------------------------------------------
// Frame navigation controller (docs/Iframe-support-design.md Phase 3.1/3.5).
//
// Every iframe load is a navigation request driven from Rust: no CORS
// filtering applies, and the gates are the embedder's `frame-src` plus the
// response's `X-Frame-Options` / `frame-ancestors` (frame_policy.rs). All
// entry points (parser insertion, src/srcdoc mutation, location, CDP
// Page.navigate(frameId)) are expected to funnel through `navigate_frame`.
// Script execution and sub-resource loading for frame documents integrate in
// Phase 3.6-3.8.
// ---------------------------------------------------------------------------

/// Depth cap for nested frames, enforced at the loader so a self-embedding
/// page fetch-loops before paint ever runs. Blink's kMaxFrameDepth is on the
/// order of 100; this is deliberately lower but far above real embed stacks.
pub const MAX_FRAME_DEPTH: usize = 32;

/// A navigation request for one frame. `srcdoc` takes precedence over `url`,
/// per the HTML processing model.
#[derive(Clone, Debug, Default)]
pub struct FrameNavigationRequest {
    /// Absolute or parent-base-relative URL; `None` (with no srcdoc) is the
    /// initial about:blank document.
    pub url: Option<String>,
    pub srcdoc: Option<String>,
    pub method: Option<String>,
    pub body: Option<Vec<u8>>,
    pub referrer: Option<String>,
    /// Optional `iframe[referrerpolicy]` override for this navigation.
    pub referrer_policy: Option<String>,
    /// Required policy from the host iframe's `csp` attribute. Network
    /// navigations negotiate it with Sec-Required-CSP; srcdoc applies it
    /// directly, while initial about:blank ignores it.
    pub required_csp: Option<String>,
    /// Parsed `sandbox` attribute of the host element. Propagation from the
    /// parent scope happens inside the controller.
    pub sandbox: obscura_dom::SandboxFlags,
    /// Permissions Policy declaration from the embedding iframe's `allow`
    /// attribute.
    pub allow: Option<String>,
    pub user_activated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FrameNavigateError {
    UnknownFrame,
    /// A newer navigation started; this one is abandoned.
    Superseded,
    DepthExceeded,
    /// URL equals an ancestor document's URL in this frame chain.
    SelfEmbedding,
    Blocked(crate::frame_policy::FrameBlockedReason),
    Fetch(String),
    Dom(String),
}

impl std::fmt::Display for FrameNavigateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownFrame => f.write_str("unknown frame id"),
            Self::Superseded => f.write_str("superseded by a newer navigation"),
            Self::DepthExceeded => f.write_str("frame nesting depth exceeded"),
            Self::SelfEmbedding => f.write_str("frame URL matches an ancestor document"),
            Self::Blocked(reason) => write!(f, "{reason}"),
            Self::Fetch(message) => write!(f, "frame fetch failed: {message}"),
            Self::Dom(message) => write!(f, "frame dom commit failed: {message}"),
        }
    }
}

fn nonempty_required_csp(value: Option<String>) -> Option<String> {
    value.filter(|policy| !policy.trim().is_empty())
}

fn combine_required_csp(base: Option<String>, required: Option<&str>) -> Option<String> {
    let Some(required) = required.filter(|policy| !policy.trim().is_empty()) else {
        return base;
    };
    let required = crate::frame_policy::ContentSecurityPolicy::parse(required);
    Some(match base {
        Some(base) if !base.trim().is_empty() => {
            crate::frame_policy::ContentSecurityPolicy::parse(&base)
                .combined_with_required(&required)
        }
        _ => required.serialized(),
    })
}

fn allow_csp_from_accepts(value: Option<&str>, embedder: &obscura_dom::Origin) -> bool {
    value.is_some_and(|value| {
        value
            .split(|character: char| character == ',' || character.is_ascii_whitespace())
            .filter(|token| !token.is_empty())
            .any(|token| {
                if token == "*" {
                    return true;
                }
                // Allow-CSP-From carries origins, not arbitrary URL strings.
                // Parse before comparing so scheme/host casing, default ports,
                // and an optional trailing slash follow URL-origin rules.
                let Ok(url) = Url::parse(token) else {
                    return false;
                };
                if !url.username().is_empty()
                    || url.password().is_some()
                    || url.query().is_some()
                    || url.fragment().is_some()
                    || (url.path() != "" && url.path() != "/")
                {
                    return false;
                }
                obscura_dom::Origin::from_url(url.as_str()) == *embedder
            })
    })
}

impl Page {
    /// The document URL and origin of each ancestor of `frame_id`, nearest
    /// first, ending with the top-level document.
    fn frame_ancestor_chain(&self, frame_id: &str) -> Vec<(String, obscura_dom::Origin)> {
        let mut chain = Vec::new();
        let mut current = self
            .frames
            .get(frame_id)
            .and_then(|frame| frame.parent_frame_id.clone());
        while let Some(ancestor_id) = current {
            let Some(frame) = self.frames.get(&ancestor_id) else {
                break;
            };
            if frame.parent_frame_id.is_none() {
                // Main frame: URL and origin come from the page itself. Use
                // the stored document origin so an opaque top keeps one
                // identity across every check.
                let url = self
                    .url
                    .as_ref()
                    .map(|url| url.to_string())
                    .unwrap_or_else(|| "about:blank".to_string());
                let origin = self
                    .document_origin
                    .clone()
                    .unwrap_or_else(|| obscura_dom::Origin::from_url(&url));
                chain.push((url, origin));
            } else if let Some(scope) = frame
                .active_document_root
                .and_then(|root| self.dom.as_ref()?.document_scope(root))
            {
                chain.push((scope.url.clone(), scope.origin.clone()));
            }
            current = frame.parent_frame_id.clone();
        }
        chain
    }

    /// The parent document's scope pieces needed for inheritance: (base URL,
    /// origin, sandbox, csp, permissions policy, referrer policy).
    fn frame_parent_inheritance(
        &self,
        frame_id: &str,
    ) -> (
        String,
        obscura_dom::Origin,
        obscura_dom::SandboxFlags,
        Option<String>,
        Option<String>,
        String,
        bool,
    ) {
        let parent = self
            .frames
            .get(frame_id)
            .and_then(|frame| frame.parent_frame_id.as_deref())
            .and_then(|parent_id| self.frames.get(parent_id));
        if let Some(parent) = parent {
            if parent.parent_frame_id.is_some() {
                if let Some(scope) = parent
                    .active_document_root
                    .and_then(|root| self.dom.as_ref().and_then(|dom| dom.document_scope(root)))
                {
                    return (
                        scope.base_url.clone(),
                        scope.origin.clone(),
                        scope.sandbox,
                        scope.csp.clone(),
                        scope.permissions_policy.clone(),
                        scope.referrer_policy.clone(),
                        scope.cross_origin_isolated,
                    );
                }
            }
        }
        let url = self
            .url
            .as_ref()
            .map(|url| url.to_string())
            .unwrap_or_else(|| "about:blank".to_string());
        // Shared per-document origin instance: srcdoc/about:blank frames
        // inherit it, and the same-origin op compares against it, so an
        // opaque top origin stays equal to itself.
        let origin = self
            .document_origin
            .clone()
            .unwrap_or_else(|| obscura_dom::Origin::from_url(&url));
        (
            url,
            origin,
            obscura_dom::SandboxFlags::default(),
            self.document_csp.clone(),
            self.document_permissions_policy.clone(),
            self.referrer_policy.as_str().to_string(),
            self.cross_origin_isolated,
        )
    }

    /// Navigate one child frame. Commits a new content document into the
    /// shared DomTree, updates the frame registry, and recursively starts
    /// navigations for iframes found in the committed content.
    pub fn navigate_frame<'a>(
        &'a mut self,
        frame_id: &'a str,
        request: FrameNavigationRequest,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<(), FrameNavigateError>> + 'a>,
    > {
        Box::pin(self.navigate_frame_inner(frame_id, request))
    }

    /// CDP `Page.navigate(frameId)` entry point (Phase 6.5). After a full page
    /// load the DomTree lives inside the JS runtime, while the frame
    /// navigation controller works on `self.dom`; borrow the tree back for
    /// the Rust-side commit, return it, then run the committed subtree's
    /// classic scripts (the full-page flow does that in
    /// `execute_frame_scripts`, which a single-frame navigation bypasses).
    pub async fn navigate_frame_for_cdp(
        &mut self,
        frame_id: &str,
        request: FrameNavigationRequest,
    ) -> Result<(), FrameNavigateError> {
        let borrowed_from_js = if self.dom.is_none() {
            match self.js.as_ref().and_then(|js| js.take_dom()) {
                Some(dom) => {
                    self.dom = Some(dom);
                    true
                }
                None => false,
            }
        } else {
            false
        };
        // The tree is on loan out of the runtime for the duration of the
        // commit, so nothing may run script against it until it is back.
        self.performance_entries_deferred += 1;
        let result = self.navigate_frame(frame_id, request).await;
        if borrowed_from_js {
            if let Some(dom) = self.dom.take() {
                if let Some(js) = self.js.as_ref() {
                    js.return_borrowed_dom(dom);
                }
            }
        }
        self.performance_entries_deferred -= 1;
        self.flush_deferred_performance_entries();
        if result.is_ok() {
            self.execute_frame_subtree_scripts(frame_id).await;
        }
        // HTML deliberately fires iframe load even when fetching or embedding
        // fails, so callers cannot use the event to probe network resources.
        // A superseded navigation is the exception: its replacement owns the
        // eventual load event.
        if !matches!(&result, Err(FrameNavigateError::Superseded)) {
            self.dispatch_frame_load_event(frame_id);
        }
        result
    }

    fn dispatch_frame_load_event(&mut self, frame_id: &str) {
        let Some(frame) = self.frames.get(frame_id) else {
            return;
        };
        let Some(host) = frame.host_nid else {
            return;
        };
        let parent = frame.parent_frame_id.clone();
        let script = format!(
            "(() => {{ const host = globalThis._wrapEl({}); if (host) host.dispatchEvent(new Event('load')); }})()",
            host.raw(),
        );
        let Some(parent_id) = parent else {
            return;
        };
        if parent_id == self.frames.main_frame_id() {
            if let Some(js) = self.js.as_mut() {
                let _ = js.execute_script("<iframe-load>", &script);
            }
            return;
        }
        let Some(parent) = self.frames.get(&parent_id) else {
            return;
        };
        let generation = parent.document_generation;
        if let Some(js) = self.js.as_mut() {
            let _ = js.execute_script_in_frame_realm(
                &parent_id,
                generation,
                "<iframe-load>",
                &script,
            );
        }
    }

    async fn navigate_frame_inner(
        &mut self,
        frame_id: &str,
        request: FrameNavigationRequest,
    ) -> Result<(), FrameNavigateError> {
        let host_nid = self
            .frames
            .get(frame_id)
            .ok_or(FrameNavigateError::UnknownFrame)?
            .host_nid
            .ok_or(FrameNavigateError::UnknownFrame)?;
        let required_csp = nonempty_required_csp(request.required_csp.clone().or_else(|| {
            self.dom
                .as_ref()
                .and_then(|dom| dom.get_node(host_nid))
                .and_then(|node| node.get_attribute("csp").map(str::to_string))
        }));
        let navigation_generation = self
            .frames
            .begin_navigation(frame_id)
            .ok_or(FrameNavigateError::UnknownFrame)?;
        if self.frames.depth(frame_id) > MAX_FRAME_DEPTH {
            return Err(FrameNavigateError::DepthExceeded);
        }

        let (
            parent_base,
            parent_origin,
            parent_sandbox,
            parent_csp,
            parent_permissions_policy,
            parent_policy,
            parent_cross_origin_isolated,
        ) =
            self.frame_parent_inheritance(frame_id);
        let frame_policy = request
            .referrer_policy
            .as_deref()
            .and_then(obscura_net::ReferrerPolicy::parse)
            .unwrap_or_else(|| obscura_net::ReferrerPolicy::parse(&parent_policy).unwrap_or_default());
        let inherited_referrer = request.referrer.clone().or_else(|| {
            self.frame_ancestor_chain(frame_id)
                .first()
                .map(|(url, _)| url.clone())
        });
        let mut sandbox = request.sandbox.merged_with_parent(parent_sandbox);
        let allow_cross_origin_isolated = request
            .allow
            .as_deref()
            .is_some_and(iframe_allows_cross_origin_isolated);
        let ancestors = self.frame_ancestor_chain(frame_id);

        // Resolve the document: URL, origin, and HTML body.
        let resolved_document = if let Some(srcdoc) = request.srcdoc {
            // An embedded CSP policy applies directly to srcdoc documents.
            // Unlike the initial about:blank special case below, this is a
            // real replacement document and must honor a CSP sandbox token.
            if let Some(required_flags) = required_csp.as_deref().and_then(|header| {
                crate::frame_policy::ContentSecurityPolicy::parse(header).sandbox_flags()
            }) {
                sandbox = sandbox.merged_with_parent(required_flags);
            }
            // srcdoc inherits the creator origin unless sandbox forces opaque;
            // its base URL is the creator's.
            let origin = if sandbox.active
                && !sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN)
            {
                obscura_dom::Origin::Opaque(obscura_dom::OpaqueOriginId::new())
            } else {
                parent_origin.clone()
            };
            // A local-scheme document has no response of its own to carry a
            // policy, so it inherits the creator's. Leaving it empty gives a
            // subframe a strictly weaker policy than the document that made it,
            // which is the opposite of what CSP is for.
            (
                "about:srcdoc".to_string(),
                parent_base.clone(),
                origin,
                srcdoc,
                combine_required_csp(parent_csp.clone(), required_csp.as_deref()),
                parent_permissions_policy.clone(),
                None,
                None,
                parent_cross_origin_isolated,
            )
        } else {
            let raw_url = request.url.as_deref().unwrap_or("about:blank");
            if raw_url == "about:blank" || raw_url.is_empty() {
                let origin = if sandbox.active
                    && !sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN)
                {
                    obscura_dom::Origin::Opaque(obscura_dom::OpaqueOriginId::new())
                } else {
                    parent_origin.clone()
                };
                (
                    "about:blank".to_string(),
                    parent_base.clone(),
                    origin,
                    String::new(),
                    parent_csp.clone(),
                    parent_permissions_policy.clone(),
                    None,
                    None,
                    parent_cross_origin_isolated,
                )
            } else {
                // A relative URL resolves against the parent document's base.
                // `Url::join` handles absolute URLs, `data:` and `blob:`
                // correctly, unlike a substring test on "://".
                let base = Url::parse(&parent_base)
                    .unwrap_or_else(|_| Url::parse("about:blank").unwrap());
                let resolved = base
                    .join(raw_url)
                    .map_err(|error| FrameNavigateError::Fetch(error.to_string()))?;
                let resolved_str = resolved.to_string();

                // Loader-level recursion guard: refuse a frame whose URL
                // equals an ancestor document's URL in its own frame chain.
                if ancestors.iter().any(|(url, _)| *url == resolved_str) {
                    return Err(FrameNavigateError::SelfEmbedding);
                }
                // The embedding document's CSP gates the request.
                if let Some(csp) = &parent_csp {
                    let policy = crate::frame_policy::ContentSecurityPolicy::parse(csp);
                    if !policy.frame_src_allows(&resolved_str, &parent_origin) {
                        return Err(FrameNavigateError::Blocked(
                            crate::frame_policy::FrameBlockedReason::CspFrameSrc,
                        ));
                    }
                }

                if resolved.scheme() == "data" {
                    let body = decode_data_uri(&resolved_str).unwrap_or_default();
                    if let Some(required_flags) = required_csp.as_deref().and_then(|header| {
                        crate::frame_policy::ContentSecurityPolicy::parse(header).sandbox_flags()
                    }) {
                        sandbox = sandbox.merged_with_parent(required_flags);
                    }
                    // data: documents always get a fresh opaque origin.
                    (
                        resolved_str.clone(),
                        resolved_str,
                        obscura_dom::Origin::Opaque(obscura_dom::OpaqueOriginId::new()),
                        String::from_utf8_lossy(&body).into_owned(),
                        combine_required_csp(None, required_csp.as_deref()),
                        parent_permissions_policy.clone(),
                        None,
                        None,
                        false,
                    )
                } else {
                    let method = match request.method.as_deref() {
                        Some("POST") | Some("post") => Method::POST,
                        _ => Method::GET,
                    };
                    let request_method = method.to_string();
                    let mut navigation_headers = std::collections::HashMap::new();
                    if let Some(required_csp) = required_csp.as_deref() {
                        navigation_headers.insert(
                            "Sec-Required-CSP".to_string(),
                            required_csp.to_string(),
                        );
                    }
                    let frame_initiator = Url::parse(&parent_base).ok();
                    let frame_referrer = inherited_referrer
                        .as_deref()
                        .and_then(|value| Url::parse(value).ok());
                    #[cfg(feature = "stealth")]
                    let response = if method == Method::GET {
                        if let Some(stealth) = &self.stealth_client {
                            stealth
                                .fetch_frame_document_with_referrer_headers(
                                    &resolved,
                                    frame_referrer.clone(),
                                    frame_initiator.clone(),
                                    frame_policy,
                                    navigation_headers.clone(),
                                    Some(&self.callbacks),
                                )
                                .await
                        } else {
                            self.http_client
                                .fetch_frame_document_with_method_referrer_headers(
                                    method,
                                    &resolved,
                                    request.body.clone(),
                                    frame_referrer.clone(),
                                    frame_initiator.clone(),
                                    frame_policy,
                                    navigation_headers.clone(),
                                    Some(&self.callbacks),
                                )
                                .await
                        }
                    } else {
                        self.http_client
                            .fetch_frame_document_with_method_referrer_headers(
                                method,
                                &resolved,
                                request.body.clone(),
                                frame_referrer,
                                frame_initiator,
                                frame_policy,
                                navigation_headers,
                                Some(&self.callbacks),
                            )
                            .await
                    }
                    .map_err(|error| FrameNavigateError::Fetch(error.to_string()))?;
                    #[cfg(not(feature = "stealth"))]
                    let response = self
                        .http_client
                        .fetch_frame_document_with_method_referrer_headers(
                            method,
                            &resolved,
                            request.body.clone(),
                            frame_referrer,
                            frame_initiator,
                            frame_policy,
                            navigation_headers,
                            Some(&self.callbacks),
                        )
                        .await
                        .map_err(|error| FrameNavigateError::Fetch(error.to_string()))?;
                    // A stale navigation must not commit, parse or execute.
                    if !self
                        .frames
                        .navigation_is_current(frame_id, navigation_generation)
                    {
                        return Err(FrameNavigateError::Superseded);
                    }

                    // A frame document is a real network resource even when
                    // its status is 404 or an embedding policy later blocks
                    // it. Keep the response body available to CDP so callers
                    // can distinguish a genuine error document from an empty
                    // about:blank fallback.
                    let frame_is_binary =
                        !is_text_like_content_type(response.content_type());
                    self.record_network_event_with_body_for_frame(
                        frame_id,
                        response.url.as_str(),
                        &request_method,
                        "Document",
                        response.status,
                        &response.headers,
                        &response.body,
                        frame_is_binary,
                    );

                    // Response gates: X-Frame-Options / frame-ancestors,
                    // evaluated against the complete ancestor origin chain.
                    // A blocked navigation must not expose its body.
                    let response_origin = obscura_dom::Origin::from_url(response.url.as_str());
                    let xfo: Vec<String> = response
                        .header("x-frame-options")
                        .map(|value| vec![value.to_string()])
                        .unwrap_or_default();
                    let policies: Vec<crate::frame_policy::ContentSecurityPolicy> = response
                        .header("content-security-policy")
                        .map(|value| vec![crate::frame_policy::ContentSecurityPolicy::parse(value)])
                        .unwrap_or_default();
                    let ancestor_origins: Vec<obscura_dom::Origin> =
                        ancestors.iter().map(|(_, origin)| origin.clone()).collect();
                    crate::frame_policy::frame_embedding_allowed(
                        &xfo,
                        &policies,
                        &response_origin,
                        &ancestor_origins,
                    )
                    .map_err(FrameNavigateError::Blocked)?;

                    // A subframe's document load is a resource of the embedding
                    // document, so it belongs in the parent's timeline under
                    // the element's local name. Skipping it left a page that
                    // counts its own resources one entry short of a browser.
                    self.record_performance_response(&response, "resource", "iframe");
                    let navigation_timing =
                        Some(Self::frame_navigation_performance_entry(&response));

                    let final_url = response.url.to_string();
                    let response_csp = response
                        .header("content-security-policy")
                        .map(str::to_string);
                    let response_permissions_policy = response
                        .header("permissions-policy")
                        .map(str::to_string);
                    let document_csp = if let Some(required_value) = required_csp.as_deref() {
                        let required =
                            crate::frame_policy::ContentSecurityPolicy::parse(required_value);
                        let response_policy = response_csp
                            .as_deref()
                            .map(crate::frame_policy::ContentSecurityPolicy::parse);
                        let policy_accepts = response_policy
                            .as_ref()
                            .is_some_and(|policy| policy.subsumes_required(&required));
                        let header_accepts = allow_csp_from_accepts(
                            response.header("allow-csp-from"),
                            &parent_origin,
                        );
                        if !policy_accepts && !header_accepts {
                            return Err(FrameNavigateError::Blocked(
                                crate::frame_policy::FrameBlockedReason::CspEmbeddedEnforcement,
                            ));
                        }
                        if policy_accepts {
                            response_csp
                        } else {
                            combine_required_csp(response_csp, Some(required_value))
                        }
                    } else {
                        response_csp
                    };
                    // CSP's response-level sandbox is an independent
                    // restriction and composes with both the embedding
                    // iframe attribute and any accepted embedded policy.
                    if let Some(response_flags) = policies
                        .iter()
                        .filter_map(|policy| policy.sandbox_flags())
                        .next()
                    {
                        sandbox = sandbox.merged_with_parent(response_flags);
                    }
                    if let Some(required_flags) = required_csp.as_deref().and_then(|header| {
                        crate::frame_policy::ContentSecurityPolicy::parse(header).sandbox_flags()
                    }) {
                        sandbox = sandbox.merged_with_parent(required_flags);
                    }
                    // A sandboxed unique-origin document is not eligible for
                    // cross-origin isolation, even when its response carries
                    // COOP/COEP. `allow-same-origin` keeps the tuple origin
                    // and may therefore retain isolation.
                    // COOP is a top-level browsing-context boundary. A
                    // cross-origin child may retain isolation when the
                    // embedding iframe explicitly delegates the feature via
                    // `allow="cross-origin-isolated"` and its own response
                    // grants COOP+COEP.
                    let document_cross_origin_isolated = frame_document_isolation(
                        &response,
                        &response_origin,
                        &parent_origin,
                        parent_cross_origin_isolated,
                        allow_cross_origin_isolated,
                        sandbox,
                    );
                    let last_modified = response.header("last-modified").map(str::to_string);
                    let origin = if sandbox.active
                        && !sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN)
                    {
                        obscura_dom::Origin::Opaque(obscura_dom::OpaqueOriginId::new())
                    } else {
                        response_origin
                    };
                    let html = response.text();
                    (
                        final_url.clone(),
                        final_url,
                        origin,
                        html,
                        document_csp,
                        response_permissions_policy,
                        last_modified,
                        navigation_timing,
                        document_cross_origin_isolated,
                    )
                }
            }
        };
        let (
            document_url,
            base_url,
            mut origin,
            html,
            mut document_csp,
            document_permissions_policy,
            last_modified,
            navigation_timing,
            mut document_cross_origin_isolated,
        ) = resolved_document;

        if !self
            .frames
            .navigation_is_current(frame_id, navigation_generation)
        {
            return Err(FrameNavigateError::Superseded);
        }

        // Commit: fresh content root, scope, parsed content, registry update.
        let dom = self
            .dom
            .as_ref()
            .ok_or_else(|| FrameNavigateError::Dom("page has no document".to_string()))?;
        let (content_root, _replaced) = dom
            .create_iframe_content_document(host_nid)
            .map_err(|error| FrameNavigateError::Dom(error.to_string()))?;
        // Even an empty HTML response is a complete Document with an html,
        // head and body. Skipping the parser left about:blank and empty
        // srcdoc documents as bare Document nodes after the async commit.
        let quirks = obscura_dom::parse_into_subtree(dom, content_root, &html);
        document_csp = effective_document_csp(dom, content_root, document_csp);
        // A CSP sandbox declared in metadata takes effect once the parser has
        // seen the meta element. It must update the security context as well
        // as the stored policy: without this step a sandboxed meta-only frame
        // incorrectly retains its tuple origin and isolation bit.
        if let Some(meta_sandbox) = document_csp.as_deref().and_then(|header| {
            crate::frame_policy::ContentSecurityPolicy::parse(header).sandbox_flags()
        }) {
            sandbox = sandbox.merged_with_parent(meta_sandbox);
            if sandbox.active
                && !sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN)
            {
                origin = obscura_dom::Origin::Opaque(obscura_dom::OpaqueOriginId::new());
                document_cross_origin_isolated = false;
            }
        }
        let frame_referrer_policy = document_referrer_policy_from_root(
            dom,
            content_root,
            document_csp.as_deref(),
        );
        let frame_referrer = match (
            inherited_referrer.as_deref().and_then(|value| Url::parse(value).ok()),
            Url::parse(&document_url),
        ) {
            (Some(source), Ok(target)) if matches!(target.scheme(), "http" | "https") => {
                obscura_net::referrer_value(&source, &target, frame_policy).unwrap_or_default()
            }
            // about:blank/srcdoc and other non-network documents inherit the
            // creator's source URL as their environment referrer.
            _ => inherited_referrer.unwrap_or_default(),
        };
        let committed = self
            .frames
            .commit_document(frame_id, navigation_generation, Some(content_root))
            .map_err(|error| match error {
                crate::frames::CommitError::UnknownFrame => FrameNavigateError::UnknownFrame,
                crate::frames::CommitError::Superseded => FrameNavigateError::Superseded,
            })?;
        if let Some(frame) = self.frames.get_mut(frame_id) {
            frame.navigation_timing = navigation_timing;
        }
        let dom = self.dom.as_ref().expect("checked above");
        dom.set_document_scope(
            content_root,
            obscura_dom::DocumentScope {
                url: document_url.to_string(),
                origin,
                base_url: base_url.clone(),
                last_modified,
                sandbox,
                csp: document_csp,
                permissions_policy: document_permissions_policy,
                referrer_policy: frame_referrer_policy.as_str().to_string(),
                referrer: frame_referrer,
                frame_id: frame_id.to_string(),
                document_generation: committed.document_generation,
                quirks,
                cross_origin_isolated: document_cross_origin_isolated,
            },
        );
        // The superseded document is detached by the registry swap inside
        // attach_iframe_content_document. Until Phase 2's wrapper-lifetime
        // work lands, no JS wrapper can retain it, so free it eagerly.
        if let Some(previous) = committed.previous_root {
            #[cfg(feature = "render")]
            if let Some(js) = self.js.as_ref() {
                js.discard_frame_render_state(previous);
            }
            dom.remove(previous);
        }
        // A browsing context survives its own navigation, but every child
        // browsing context belongs to the superseded Document and must be
        // detached with its complete subtree before discovering children in
        // the replacement document.
        let stale_children = self
            .frames
            .get(frame_id)
            .map(|frame| frame.children.clone())
            .unwrap_or_default();
        for child in stale_children {
            let removed = self.frames.detach(&child);
            if let Some(js) = self.js.as_mut() {
                for context in removed {
                    #[cfg(feature = "render")]
                    if let Some(root) = context.active_document_root {
                        js.discard_frame_render_state(root);
                    }
                    js.destroy_frame_realm(&context.frame_id);
                }
            }
        }
        // Every realm registered for this frame belongs to a superseded
        // generation (the freshly committed one has no realm yet; it is
        // created lazily at script execution), so drop them all.
        if let Some(js) = self.js.as_mut() {
            js.destroy_frame_realm(frame_id);
        }

        // External stylesheets of the committed content (Phase 3.6). A failed
        // or blocked sheet never fails the navigation.
        self.load_frame_stylesheets(frame_id, navigation_generation, content_root)
            .await;

        // Discover nested frames in the committed content and navigate them.
        // Each child gets its own browsing context; sandbox flags propagate.
        let nested: Vec<(obscura_dom::NodeId, FrameNavigationRequest)> = {
            let dom = self.dom.as_ref().expect("checked above");
            dom.iframe_hosts_in_shadow_including_subtree(content_root)
                .into_iter()
                .map(|nested_host| {
                    let node = dom.get_node(nested_host);
                    let attr = |name: &str| {
                        node.as_ref()
                            .and_then(|node| node.get_attribute(name))
                            .map(str::to_string)
                    };
                    (
                        nested_host,
                        FrameNavigationRequest {
                            url: attr("src"),
                            srcdoc: attr("srcdoc"),
                            referrer_policy: attr("referrerpolicy"),
                            sandbox: obscura_dom::SandboxFlags::parse(
                                attr("sandbox").as_deref(),
                            ),
                            allow: attr("allow"),
                            ..FrameNavigationRequest::default()
                        },
                    )
                })
                .collect()
        };
        for (nested_host, nested_request) in nested {
            if !self
                .frames
                .navigation_is_current(frame_id, navigation_generation)
            {
                return Err(FrameNavigateError::Superseded);
            }
            let Some(child_id) = self.frames.attach_child(frame_id, nested_host) else {
                continue;
            };
            // A nested frame failing to load must not fail this navigation;
            // browsers paint the parent regardless.
            let _ = self.navigate_frame(&child_id, nested_request).await;
        }
        Ok(())
    }

    /// Create browsing contexts for the top-level document's iframes and
    /// drive their navigations through the Rust controller. Returns the
    /// number of frames started.
    pub async fn load_child_frames(&mut self) -> usize {
        let Some(dom) = self.dom.as_ref() else {
            return 0;
        };
        let hosts: Vec<(obscura_dom::NodeId, FrameNavigationRequest)> = dom
            .iframe_hosts_in_shadow_including_subtree(dom.document())
            .into_iter()
            .filter(|host| dom.is_connected(*host))
            .filter(|host| self.frames.by_host(*host).is_none())
            .map(|host| {
                let node = dom.get_node(host);
                let attr = |name: &str| {
                    node.as_ref()
                        .and_then(|node| node.get_attribute(name))
                        .map(str::to_string)
                };
                (
                    host,
                    FrameNavigationRequest {
                        url: attr("src"),
                        srcdoc: attr("srcdoc"),
                        referrer_policy: attr("referrerpolicy"),
                        sandbox: obscura_dom::SandboxFlags::parse(attr("sandbox").as_deref()),
                        allow: attr("allow"),
                        ..FrameNavigationRequest::default()
                    },
                )
            })
            .collect();
        let main_frame_id = self.frames.main_frame_id().to_string();
        let mut started = 0;
        for (host, request) in hosts {
            let Some(frame_id) = self.frames.attach_child(&main_frame_id, host) else {
                continue;
            };
            started += 1;
            let _ = self.navigate_frame(&frame_id, request).await;
        }
        started
    }

    /// Fetch and install external stylesheets for one committed frame content
    /// document (Phase 3.6). Each fetched graph is inserted as a `<style>`
    /// node right after its source `<link>`, tagged
    /// `data-obscura-materialized`, which the per-root render pipeline's
    /// `<style>` scan picks up. Discovery mirrors the main document's
    /// `linked_stylesheet_requests`: disabled alternates stay dormant and
    /// media-gated sheets still fetch, carrying the media condition onto the
    /// installed `<style>`. Blocked or failed links are skipped silently.
    async fn load_frame_stylesheets(
        &mut self,
        frame_id: &str,
        navigation_generation: u64,
        content_root: obscura_dom::NodeId,
    ) {
        let Some(scope) = self
            .dom
            .as_ref()
            .and_then(|dom| dom.document_scope(content_root))
        else {
            return;
        };
        // Frame link hrefs resolve against the frame document's base URL
        // (the creator's base for srcdoc), never the top document's.
        let Ok(base) = Url::parse(&scope.base_url) else {
            return;
        };
        let frame_policy = obscura_net::ReferrerPolicy::parse(&scope.referrer_policy)
            .unwrap_or_default();
        let frame_csp = scope
            .csp
            .as_deref()
            .map(crate::frame_policy::ContentSecurityPolicy::parse);
        let frame_origin = scope.origin.clone();
        let links: Vec<(obscura_dom::NodeId, String, Option<String>)> = {
            let Some(dom) = self.dom.as_ref() else {
                return;
            };
            dom.query_selector_all_from(content_root, "link[rel~=\"stylesheet\"]")
                .unwrap_or_default()
                .into_iter()
                .filter_map(|link_id| {
                    let node = dom.get_node(link_id)?;
                    if node.get_attribute("disabled").is_some() {
                        return None;
                    }
                    let href = node.get_attribute("href")?.to_string();
                    let media = node.get_attribute("media").map(str::to_string);
                    Some((link_id, href, media))
                })
                .collect()
        };
        for (link_id, href, media) in links {
            let Ok(resolved) = base.join(&href) else {
                continue;
            };
            let (key, resolved) = canonical_stylesheet_url(resolved);
            if frame_csp
                .as_ref()
                .is_some_and(|policy| !policy.style_src_allows(resolved.as_str(), &frame_origin))
            {
                tracing::info!("Blocked frame stylesheet by Content-Security-Policy: {}", resolved);
                continue;
            }
            if !subresource_allowed(Some(&base), resolved.as_str())
                || self.should_block_url(resolved.as_str())
            {
                tracing::info!("Blocked frame stylesheet: {}", resolved);
                continue;
            }
            let Some(css) = self
                .materialize_frame_stylesheet(
                    frame_id,
                    key,
                    resolved,
                    &base,
                    frame_policy,
                    frame_csp.as_ref(),
                    &frame_origin,
                )
                .await
            else {
                continue;
            };
            // A stale navigation must not mutate the committed document.
            if !self
                .frames
                .navigation_is_current(frame_id, navigation_generation)
            {
                return;
            }
            let Some(dom) = self.dom.as_ref() else {
                return;
            };
            // The link may have been detached while the sheet was in flight,
            // or a sheet already installed for it.
            let Some(link) = dom.get_node(link_id) else {
                continue;
            };
            let Some(parent) = link.parent else {
                continue;
            };
            let already = link.next_sibling.and_then(|sibling| {
                dom.with_node(sibling, |node| {
                    node.get_attribute("data-obscura-materialized").is_some()
                })
            });
            if already == Some(true) {
                continue;
            }
            let style = dom.new_node(obscura_dom::NodeData::Element {
                name: html5ever::QualName::new(
                    None,
                    html5ever::ns!(html),
                    html5ever::LocalName::from("style"),
                ),
                attrs: vec![],
                template_contents: None,
                mathml_annotation_xml_integration_point: false,
            });
            dom.with_node_mut(style, |node| {
                node.set_attribute("data-obscura-materialized", "1".to_string());
                if let Some(media) = &media {
                    if !media.trim().is_empty() {
                        node.set_attribute("media", media.clone());
                    }
                }
            });
            let text = dom.new_node(obscura_dom::NodeData::Text { contents: css });
            dom.append_child(style, text);
            match link.next_sibling {
                Some(next) => dom.insert_before(next, style),
                None => dom.append_child(parent, style),
            }
        }
    }

    /// Fetch one external stylesheet graph (`@import`s included, bounded by
    /// the shared depth and resource caps) and return the materialized CSS
    /// with relative `url()` values rebased onto each sheet's response URL.
    /// Results are cached per canonical root URL for the page's lifetime of
    /// the current top-level document, so the same sheet referenced from
    /// several frames is fetched once. Frame subresources use the plain page
    /// transport, like frame navigation itself.
    async fn materialize_frame_stylesheet(
        &mut self,
        frame_id: &str,
        root_key: String,
        root_url: Url,
        base: &Url,
        referrer_policy: obscura_net::ReferrerPolicy,
        csp: Option<&crate::frame_policy::ContentSecurityPolicy>,
        frame_origin: &obscura_dom::Origin,
    ) -> Option<String> {
        if let Some(cached) = self.frame_stylesheet_cache.get(&root_key) {
            return cached.clone();
        }
        let callbacks = self.callbacks.clone();
        let mut sheets = std::collections::HashMap::new();
        let mut aliases = std::collections::HashMap::new();
        let mut scheduled = std::collections::HashSet::new();
        scheduled.insert(root_key.clone());
        let mut pending = vec![(root_key.clone(), root_url, 0u8)];
        while let Some((key, requested_url, depth)) = pending.pop() {
            let (css, response_url) = if requested_url.scheme() == "data" {
                let Some(body) = decode_data_uri(requested_url.as_str()) else {
                    continue;
                };
                (
                    String::from_utf8_lossy(&body).into_owned(),
                    requested_url.clone(),
                )
            } else {
                let mut request = ResourceRequest::subresource(ResourceType::Stylesheet, base);
                request.referrer_policy = referrer_policy;
                let response = match self
                    .http_client
                    .fetch_resource_with_callbacks(&requested_url, request, Some(&callbacks))
                    .await
                {
                    Ok(response) => response,
                    Err(error) => {
                        tracing::debug!(
                            "Failed to fetch frame stylesheet {}: {}",
                            requested_url,
                            error
                        );
                        continue;
                    }
                };
                let response_url = response.url.clone();
                self.record_network_event_with_body_for_frame(
                    frame_id,
                    response_url.as_str(),
                    "GET",
                    "Stylesheet",
                    response.status,
                    &response.headers,
                    &response.body,
                    false,
                );
                (
                    obscura_net::decode_non_html(&response.body, response.content_type()),
                    response_url,
                )
            };

            let (response_key, response_url) = canonical_stylesheet_url(response_url);
            if let Some(existing) = aliases.get(&response_key).cloned() {
                aliases.insert(key, existing);
                continue;
            }
            let (imports, rules) = split_css_imports(&css);
            let imports = if depth < MAX_STYLESHEET_IMPORT_DEPTH {
                imports
            } else {
                Vec::new()
            };
            aliases.insert(key.clone(), key.clone());
            aliases.insert(response_key, key.clone());
            sheets.insert(
                key,
                LoadedStylesheet {
                    response_url: response_url.clone(),
                    imports: imports.clone(),
                    rules,
                },
            );
            for import in imports {
                let Ok(import_url) = response_url.join(&import.url) else {
                    continue;
                };
                let (import_key, import_url) = canonical_stylesheet_url(import_url);
                if aliases.contains_key(&import_key) || scheduled.contains(&import_key) {
                    continue;
                }
                if scheduled.len() >= MAX_STYLESHEET_RESOURCES {
                    tracing::warn!(
                        "frame stylesheet resource cap reached at {} resources",
                        MAX_STYLESHEET_RESOURCES
                    );
                    continue;
                }
                if !subresource_allowed(Some(base), import_url.as_str())
                    || self.should_block_url(import_url.as_str())
                    || csp.is_some_and(|policy| {
                        !policy.style_src_allows(import_url.as_str(), frame_origin)
                    })
                {
                    tracing::info!("Blocked frame stylesheet import: {}", import_url);
                    continue;
                }
                scheduled.insert(import_key.clone());
                pending.push((import_key, import_url, depth + 1));
            }
        }
        let css = materialize_stylesheet_graph(
            &root_key,
            &sheets,
            &aliases,
            &mut std::collections::HashSet::new(),
        );
        self.frame_stylesheet_cache.insert(root_key, css.clone());
        css
    }
}

#[cfg(test)]
mod tests {
    use super::{
        css_resource_urls, linked_stylesheet_requests, materialize_linked_stylesheet_script,
        materialize_stylesheet_graph, navigation_referrer, navigation_timeout_from_env_value,
        document_referrer_policy, parse_import_url, rebase_css_urls, script_response_is_executable,
        split_css_imports, response_grants_cross_origin_isolation,
        frame_response_grants_cross_origin_isolation,
        truncate_on_char_boundary, url_matches_cdp_pattern, LoadedStylesheet, StylesheetImport,
    };
    #[cfg(feature = "render")]
    use super::remaining_settle_resource_warmup_ms;
    use base64::Engine as _;
    use obscura_dom::parse_html;

    fn frame_test_page(html: &str) -> super::Page {
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-test".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-test".to_string(), context);
        page.url = Some(url::Url::parse("https://top.example/app/").unwrap());
        page.dom = Some(parse_html(html));
        page
    }

    #[test]
    fn web_storage_lifetimes_match_context_and_page() {
        let context = std::sync::Arc::new(crate::BrowserContext::new(
            "storage-test".to_string(),
        ));
        let mut page = super::Page::new("storage-page".to_string(), context.clone());
        page.url = Some(url::Url::parse("https://storage.example/first").unwrap());
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://storage.example/first",
        ));
        page.dom = Some(parse_html("<html></html>"));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                "(() => { localStorage.setItem('local', 'kept'); sessionStorage.setItem('session', 'kept'); })()",
            )
            .unwrap();

        // Replacing the document replaces every realm but preserves both
        // storage namespaces for this top-level browsing context.
        page.url = Some(url::Url::parse("https://storage.example/second").unwrap());
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://storage.example/second",
        ));
        page.dom = Some(parse_html("<html></html>"));
        page.init_js();
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("[localStorage.local, sessionStorage.session]")
                .unwrap(),
            serde_json::json!(["kept", "kept"]),
        );

        // A second top-level browsing context shares localStorage through the
        // BrowserContext and receives a fresh sessionStorage namespace.
        let mut other = super::Page::new("storage-other".to_string(), context);
        other.url = Some(url::Url::parse("https://storage.example/other").unwrap());
        other.document_origin = Some(obscura_dom::Origin::from_url(
            "https://storage.example/other",
        ));
        other.dom = Some(parse_html("<html></html>"));
        other.init_js();
        assert_eq!(
            other
                .js
                .as_mut()
                .unwrap()
                .evaluate("[localStorage.local, sessionStorage.session]")
                .unwrap(),
            serde_json::json!(["kept", null]),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn dynamic_iframe_navigation_uses_the_frame_controller() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    frame.id = 'dynamic';
                    globalThis.dynamicLoads = 0;
                    frame.addEventListener('load', () => dynamicLoads++);
                    frame.srcdoc = '<script>globalThis.frameMarker = 1;</script>';
                    document.body.appendChild(frame);
                })()"#,
            )
            .unwrap();

        assert_eq!(page.process_pending_frame_navigations().await, 1);
        let (frame_id, first_generation) = {
            let js = page.js.as_ref().unwrap();
            let host = js
                .with_dom(|dom| dom.query_selector("#dynamic").unwrap().unwrap())
                .unwrap();
            let frame = page.frames.by_host(host).unwrap();
            (frame.frame_id.clone(), frame.document_generation)
        };
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("[document.getElementById('dynamic').contentWindow.frameMarker, dynamicLoads]")
                .unwrap(),
            serde_json::json!([1, 1]),
        );

        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                "document.getElementById('dynamic').setAttribute('srcdoc', '<script>globalThis.frameMarker = 2;</script>')",
            )
            .unwrap();
        assert_eq!(page.process_pending_frame_navigations().await, 1);
        let frame = page.frames.get(&frame_id).unwrap();
        assert_eq!(frame.document_generation, first_generation + 1);
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("[document.getElementById('dynamic').contentWindow.frameMarker, dynamicLoads]")
                .unwrap(),
            serde_json::json!([2, 2]),
        );

        page.js
            .as_mut()
            .unwrap()
            .evaluate("document.getElementById('dynamic').contentWindow.eval(\"location.href = 'about:blank'\")")
            .unwrap();
        assert_eq!(page.process_pending_frame_navigations().await, 1);
        let frame = page.frames.get(&frame_id).unwrap();
        assert_eq!(frame.document_generation, first_generation + 2);
        let scope = page
            .js
            .as_ref()
            .unwrap()
            .with_dom(|dom| dom.document_scope(frame.active_document_root.unwrap()))
            .flatten()
            .unwrap();
        assert_eq!(scope.url, "about:blank");
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "(() => { const d = document.getElementById('dynamic').contentDocument; return [dynamicLoads, d.documentElement.tagName, !!d.head, !!d.body, d.body.innerHTML]; })()",
                )
                .unwrap(),
            serde_json::json!([3, "HTML", true, true, ""]),
        );
    }

    #[cfg(feature = "render")]
    #[tokio::test(flavor = "current_thread")]
    async fn browser_frame_navigation_drops_only_the_superseded_render_state() {
        let mut page = frame_test_page(
            r#"<html><body><iframe id="left" srcdoc="<iframe srcdoc='nested'></iframe>"></iframe><iframe id="right" srcdoc="right"></iframe></body></html>"#,
        );
        page.load_child_frames().await;
        page.init_js();

        let (left_id, old_left_root, old_nested_root, right_root) = {
            let dom = page.js.as_ref().unwrap();
            let left_host = dom
                .with_dom(|tree| tree.query_selector("#left").unwrap().unwrap())
                .unwrap();
            let right_host = dom
                .with_dom(|tree| tree.query_selector("#right").unwrap().unwrap())
                .unwrap();
            let left = page.frames.by_host(left_host).unwrap();
            let right = page.frames.by_host(right_host).unwrap();
            let nested = page.frames.get(left.children.first().unwrap()).unwrap();
            (
                left.frame_id.clone(),
                left.active_document_root.unwrap(),
                nested.active_document_root.unwrap(),
                right.active_document_root.unwrap(),
            )
        };
        let js = page.js.as_ref().unwrap();
        js.ensure_frame_render_state_for_test(old_left_root);
        js.ensure_frame_render_state_for_test(old_nested_root);
        js.ensure_frame_render_state_for_test(right_root);

        page.navigate_frame_for_cdp(
            &left_id,
            super::FrameNavigationRequest {
                srcdoc: Some("new left".to_string()),
                ..super::FrameNavigationRequest::default()
            },
        )
        .await
        .unwrap();

        let js = page.js.as_ref().unwrap();
        assert!(
            !js.has_frame_render_state(old_left_root),
            "the superseded document retained its animation/style state"
        );
        assert!(
            !js.has_frame_render_state(old_nested_root),
            "a detached child document retained its animation/style state"
        );
        assert!(
            js.has_frame_render_state(right_root),
            "navigating one frame cleared an unaffected sibling timeline"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn closed_shadow_iframe_gets_a_browsing_context_and_navigates() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const host = document.createElement('div');
                    document.body.appendChild(host);
                    const root = host.attachShadow({mode: 'closed'});
                    const frame = document.createElement('iframe');
                    globalThis.closedShadowHost = host;
                    globalThis.closedShadowFrame = frame;
                    globalThis.closedShadowLoads = 0;
                    frame.addEventListener('load', () => closedShadowLoads++);
                    frame.srcdoc = '<script>globalThis.shadowMarker = 1;</script>';
                    root.appendChild(frame);
                })()"#,
            )
            .unwrap();

        assert_eq!(page.process_pending_frame_navigations().await, 1);
        let (host, frame_id, content_root) = {
            let js = page.js.as_ref().unwrap();
            let host = js
                .with_dom(|dom| {
                    dom.iframe_hosts_in_shadow_including_subtree(dom.document())
                        .into_iter()
                        .next()
                        .unwrap()
                })
                .unwrap();
            let frame = page.frames.by_host(host).expect("shadow browsing context");
            (host, frame.frame_id.clone(), frame.active_document_root.unwrap())
        };
        assert_eq!(
            page.frames.get(&frame_id).unwrap().parent_frame_id.as_deref(),
            Some(page.frames.main_frame_id())
        );
        assert_eq!(
            page.js
                .as_ref()
                .unwrap()
                .with_dom(|dom| {
                    (
                        dom.containing_document_root_shadow_including(host),
                        dom.iframe_content_document(host),
                    )
                })
                .unwrap(),
            (Some(obscura_dom::NodeId::new(0)), Some(content_root))
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "[closedShadowHost.shadowRoot, document.querySelectorAll('iframe').length, closedShadowFrame.contentWindow.shadowMarker, closedShadowLoads]",
                )
                .unwrap(),
            serde_json::json!([null, 0, 1, 1]),
        );

        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                "closedShadowFrame.srcdoc = '<script>globalThis.shadowMarker = 2;</' + 'script>'",
            )
            .unwrap();
        assert_eq!(page.process_pending_frame_navigations().await, 1);
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("[closedShadowFrame.contentWindow.shadowMarker, closedShadowLoads]")
                .unwrap(),
            serde_json::json!([2, 2]),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn shadow_iframe_in_child_document_uses_child_as_parent_frame() {
        let mut page = frame_test_page(
            "<!doctype html><iframe id=outer srcdoc='<p>outer</p>'></iframe>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;
        let outer_host = page
            .js
            .as_ref()
            .unwrap()
            .with_dom(|dom| dom.query_selector("#outer").unwrap().unwrap())
            .unwrap();
        let outer_id = page.frames.by_host(outer_host).unwrap().frame_id.clone();

        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"document.getElementById('outer').contentWindow.eval(`(() => {
                    const host = document.createElement('div');
                    document.body.appendChild(host);
                    const root = host.attachShadow({mode: 'open'});
                    const frame = document.createElement('iframe');
                    globalThis.nestedShadowFrame = frame;
                    frame.srcdoc = '<script>globalThis.nestedMarker = 7;</script>';
                    root.appendChild(frame);
                })()`)"#,
            )
            .unwrap();

        assert_eq!(page.process_pending_frame_navigations().await, 1);
        let nested = page
            .js
            .as_ref()
            .unwrap()
            .with_dom(|dom| {
                let outer_root = dom.iframe_content_document(outer_host).unwrap();
                let nested = dom
                    .iframe_hosts_in_shadow_including_subtree(outer_root)
                    .into_iter()
                    .next()
                    .unwrap();
                assert_eq!(
                    dom.containing_document_root_shadow_including(nested),
                    Some(outer_root)
                );
                nested
            })
            .unwrap();
        let nested_frame = page.frames.by_host(nested).expect("nested shadow frame");
        assert_eq!(nested_frame.parent_frame_id.as_deref(), Some(outer_id.as_str()));
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "document.getElementById('outer').contentWindow.nestedShadowFrame.contentWindow.nestedMarker",
                )
                .unwrap(),
            serde_json::json!(7.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fixed_settle_drains_iframe_navigation_created_by_a_timer() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"setTimeout(() => {
                    const host = document.createElement('div');
                    document.body.appendChild(host);
                    const root = host.attachShadow({mode: 'closed'});
                    const frame = document.createElement('iframe');
                    globalThis.timerShadowFrame = frame;
                    frame.srcdoc = '<script>globalThis.timerFrameMarker = 9;</script>';
                    root.appendChild(frame);
                }, 20)"#,
            )
            .unwrap();

        page.settle_for_duration(300).await;

        let host = page
            .js
            .as_ref()
            .unwrap()
            .with_dom(|dom| {
                dom.iframe_hosts_in_shadow_including_subtree(dom.document())
                    .into_iter()
                    .next()
            })
            .flatten()
            .expect("timer-created shadow iframe");
        let frame = page
            .frames
            .by_host(host)
            .expect("timer-created shadow frame has a browsing context");
        assert_eq!(
            frame.parent_frame_id.as_deref(),
            Some(page.frames.main_frame_id())
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("timerShadowFrame.contentWindow.timerFrameMarker")
                .unwrap(),
            serde_json::json!(9.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn adaptive_settle_drains_delayed_shadow_iframe_navigation() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"setTimeout(() => {
                    const host = document.body.appendChild(document.createElement('div'));
                    const frame = document.createElement('iframe');
                    globalThis.adaptiveShadowFrame = frame;
                    frame.srcdoc = '<script>globalThis.adaptiveMarker = 4;</script>';
                    host.attachShadow({mode: 'open'}).appendChild(frame);
                }, 20)"#,
            )
            .unwrap();

        page.settle(500).await;

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("adaptiveShadowFrame.contentWindow.adaptiveMarker")
                .unwrap(),
            serde_json::json!(4.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn autonomous_event_loop_turn_commits_pending_shadow_iframe() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const host = document.body.appendChild(document.createElement('div'));
                    const frame = document.createElement('iframe');
                    globalThis.autonomousShadowFrame = frame;
                    frame.srcdoc = '<script>globalThis.autonomousMarker = 6;</script>';
                    host.attachShadow({mode: 'closed'}).appendChild(frame);
                })()"#,
            )
            .unwrap();

        assert!(!page.run_autonomous_event_loop_turn().await.unwrap());
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("autonomousShadowFrame.contentWindow.autonomousMarker")
                .unwrap(),
            serde_json::json!(6.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn autonomous_event_loop_delivers_shadow_frame_message_before_next_task() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const host = document.body.appendChild(document.createElement('div'));
                    const frame = document.createElement('iframe');
                    globalThis.autonomousMessageFrame = frame;
                    frame.srcdoc = `<script>
                        window.addEventListener('message', event => {
                            globalThis.autonomousReply = event.data.reply;
                        });
                    <\/script>`;
                    host.attachShadow({mode: 'closed'}).appendChild(frame);
                })()"#,
            )
            .unwrap();

        // First turn commits the dynamic browsing context and creates its
        // realm. A queued frame message is already a browser task and must be
        // delivered before a timer scheduled after postMessage. Waiting until
        // deno's poll returns reverses that ordering and can starve delivery
        // entirely when the page keeps the poll continuously busy.
        assert!(!page.run_autonomous_event_loop_turn().await.unwrap());
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                "(() => { autonomousMessageFrame.contentWindow.postMessage({ reply: 17 }, '*'); setTimeout(() => { globalThis.replySeenByNextTask = autonomousMessageFrame.contentWindow.autonomousReply; }, 0); })()",
            )
            .unwrap();
        let _ = page.run_autonomous_event_loop_turn().await.unwrap();
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("autonomousMessageFrame.contentWindow.autonomousReply")
                .unwrap(),
            serde_json::json!(17.0),
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.replySeenByNextTask")
                .unwrap(),
            serde_json::json!(17.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn failed_iframe_navigation_still_dispatches_load() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url(
            "https://top.example/app/",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    globalThis.failedFrameLoads = 0;
                    frame.addEventListener('load', () => failedFrameLoads++);
                    frame.src = location.href;
                    document.body.appendChild(frame);
                })()"#,
            )
            .unwrap();

        assert_eq!(page.process_pending_frame_navigations().await, 0);
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("failedFrameLoads")
                .unwrap(),
            serde_json::json!(1.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_navigation_detaches_superseded_descendants_and_realms() {
        let mut page = frame_test_page(
            "<!doctype html><iframe id=outer srcdoc=\"\
             <script>globalThis.outerOld=1</script>\
             <iframe srcdoc='<script>globalThis.innerOld=1</script>'></iframe>\
             \"></iframe>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;

        let (outer_id, outer_generation, inner_id) = {
            let js = page.js.as_ref().unwrap();
            let outer_host = js
                .with_dom(|dom| dom.query_selector("#outer").unwrap().unwrap())
                .unwrap();
            let outer = page.frames.by_host(outer_host).unwrap();
            let inner_id = outer.children.first().unwrap().clone();
            (
                outer.frame_id.clone(),
                outer.document_generation,
                inner_id,
            )
        };
        assert!(page
            .js
            .as_ref()
            .unwrap()
            .frame_realm_keys()
            .iter()
            .any(|(frame_id, _, _)| frame_id == &inner_id));

        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                "document.getElementById('outer').srcdoc = '<script>globalThis.outerNew=2</' + 'script>'",
            )
            .unwrap();
        assert_eq!(page.process_pending_frame_navigations().await, 1);

        let outer = page.frames.get(&outer_id).unwrap();
        assert_eq!(outer.document_generation, outer_generation + 1);
        assert!(outer.children.is_empty());
        assert!(page.frames.get(&inner_id).is_none());
        assert!(!page
            .js
            .as_ref()
            .unwrap()
            .frame_realm_keys()
            .iter()
            .any(|(frame_id, _, _)| frame_id == &inner_id));
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("document.getElementById('outer').contentWindow.outerNew")
                .unwrap(),
            serde_json::json!(2.0),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn srcdoc_frame_commits_content_document_with_inherited_origin() {
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe srcdoc=\"<p id=hi>hello</p>\"></iframe></body></html>",
        );
        let started = page.load_child_frames().await;
        assert_eq!(started, 1);

        let dom = page.dom.as_ref().unwrap();
        let host = dom.query_selector("iframe").unwrap().unwrap();
        let root = dom.iframe_content_document(host).expect("content document");
        let scope = dom.document_scope(root).expect("scope recorded");
        assert_eq!(scope.url, "about:srcdoc");
        // srcdoc inherits the creator origin.
        assert_eq!(
            scope.origin,
            obscura_dom::Origin::from_url("https://top.example/app/")
        );
        let p = dom.query_selector_from(root, "#hi").unwrap().unwrap();
        assert_eq!(dom.text_content(p), "hello");
        // Frame content stays out of the top document's scope.
        assert!(dom.query_selector("#hi").unwrap().is_none());
        // The registry tracks the committed document.
        let frame = page.frames.by_host(host).expect("browsing context");
        assert_eq!(frame.active_document_root, Some(root));
        assert_eq!(frame.document_generation, 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn declarative_closed_shadow_iframe_loads_before_runtime_init() {
        let mut page = frame_test_page(
            "<!doctype html><div><template shadowrootmode=closed>\
             <iframe srcdoc='<p id=shadow-content>loaded</p>'></iframe>\
             </template></div>",
        );

        assert_eq!(page.load_child_frames().await, 1);
        let dom = page.dom.as_ref().unwrap();
        assert!(dom.query_selector("iframe").unwrap().is_none());
        let host = dom
            .iframe_hosts_in_shadow_including_subtree(dom.document())
            .into_iter()
            .next()
            .expect("closed-shadow iframe host");
        let root = dom.iframe_content_document(host).expect("content document");
        let marker = dom
            .query_selector_from(root, "#shadow-content")
            .unwrap()
            .unwrap();
        assert_eq!(dom.text_content(marker), "loaded");
        assert_eq!(
            page.frames.by_host(host).unwrap().parent_frame_id.as_deref(),
            Some(page.frames.main_frame_id())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn sandboxed_srcdoc_gets_opaque_origin_and_nested_frames_recurse() {
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body>\
             <iframe sandbox=\"\" srcdoc=\"<iframe srcdoc='<b id=deep>x</b>'></iframe>\"></iframe>\
             </body></html>",
        );
        page.load_child_frames().await;

        let dom = page.dom.as_ref().unwrap();
        let host = dom.query_selector("iframe").unwrap().unwrap();
        let root = dom.iframe_content_document(host).unwrap();
        let scope = dom.document_scope(root).unwrap();
        // sandbox without allow-same-origin forces a fresh opaque origin.
        assert!(scope.origin.is_opaque());
        assert!(scope.sandbox.active);

        // The nested iframe got its own browsing context and document, and
        // sandbox flags propagated to it.
        let nested_host = dom.query_selector_from(root, "iframe").unwrap().unwrap();
        let nested_root = dom.iframe_content_document(nested_host).expect("nested doc");
        let nested_scope = dom.document_scope(nested_root).unwrap();
        assert!(nested_scope.origin.is_opaque());
        assert!(nested_scope.sandbox.active);
        let deep = dom.query_selector_from(nested_root, "#deep").unwrap().unwrap();
        assert_eq!(dom.text_content(deep), "x");
        let nested_frame = page.frames.by_host(nested_host).expect("nested context");
        assert_eq!(
            nested_frame.parent_frame_id.as_deref(),
            Some(page.frames.by_host(host).unwrap().frame_id.as_str())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_navigation_blocks_self_embedding_and_frame_src() {
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe></iframe></body></html>",
        );
        let dom = page.dom.as_ref().unwrap();
        let host = dom.query_selector("iframe").unwrap().unwrap();
        let main_id = page.frames.main_frame_id().to_string();
        let frame_id = page.frames.attach_child(&main_id, host).unwrap();

        // A frame whose URL equals an ancestor document URL is refused at
        // the loader, before any fetch.
        let result = page
            .navigate_frame(
                &frame_id,
                super::FrameNavigationRequest {
                    url: Some("https://top.example/app/".to_string()),
                    ..Default::default()
                },
            )
            .await;
        assert_eq!(result, Err(super::FrameNavigateError::SelfEmbedding));

        // about:blank commits synchronously with the creator origin.
        let result = page
            .navigate_frame(&frame_id, super::FrameNavigationRequest::default())
            .await;
        assert_eq!(result, Ok(()));
        let dom = page.dom.as_ref().unwrap();
        let root = dom.iframe_content_document(host).unwrap();
        let scope = dom.document_scope(root).unwrap();
        assert_eq!(scope.url, "about:blank");
        assert!(!scope.origin.is_opaque());
    }

    /// The document's connect-src has to reach the JS runtime. A navigation
    /// reads the response headers before that runtime exists, so the policy has
    /// to be installed when the runtime is built. Miss it and scripted fetches
    /// run unchecked while script-src and style-src still look correct, because
    /// those are evaluated on the browser side and never consult the runtime.
    #[tokio::test(flavor = "current_thread")]
    async fn a_documents_connect_src_reaches_scripted_fetches() {
        let serve = |csp: Option<&'static str>, body: &'static str, count: usize| {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            std::thread::spawn(move || {
                use std::io::{Read as _, Write as _};
                for _ in 0..count {
                    let Ok((mut stream, _)) = listener.accept() else { break };
                    let mut request = [0u8; 2048];
                    let _ = stream.read(&mut request);
                    let csp_header = csp
                        .map(|value| format!("Content-Security-Policy: {value}\r\n"))
                        .unwrap_or_default();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{csp_header}Access-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len(),
                    );
                    let _ = stream.write_all(response.as_bytes());
                }
            });
            format!("http://{address}")
        };
        let other = serve(None, "ok", 1);
        let origin = serve(
            Some("default-src 'none'; connect-src 'self'"),
            "<!doctype html><p>page</p>",
            2,
        );

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "connect-csp".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("connect-csp".to_string(), context);
        page.navigate(&format!("{origin}/main")).await.unwrap();

        let probe = format!(
            r#"(async () => {{
                const reach = async url => {{
                    try {{ return "status:" + (await fetch(url)).status; }}
                    catch (error) {{ return error.name; }}
                }};
                return [await reach("{origin}/ok"), await reach("{other}/ok")];
            }})()"#
        );
        let result = page
            .evaluate_for_cdp_with_timeout(&probe, true, true, 5_000)
            .await
            .unwrap()
            .value
            .unwrap();
        assert_eq!(result, serde_json::json!(["status:200", "AbortError"]));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_subframe_document_load_lands_in_the_parents_resource_timeline() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let frame_body = "<!doctype html><p>frame</p>";
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            for _ in 0..2 {
                let Ok((mut stream, _)) = listener.accept() else { break };
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap_or(0);
                let head = String::from_utf8_lossy(&request[..length]).to_string();
                let body = if head.contains("/frame") {
                    frame_body.to_string()
                } else {
                    "<!doctype html><iframe src=\"/frame\"></iframe>".to_string()
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTiming-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-timing".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-timing".to_string(), context);
        page.navigate(&format!("{origin}/main")).await.unwrap();

        let probe = r#"(() => {
            const entry = performance.getEntriesByType("resource")
                .find(value => value.name.endsWith("/frame"));
            return entry
                ? [entry.initiatorType, entry.nextHopProtocol,
                   entry.transferSize - entry.encodedBodySize]
                : null;
        })()"#;
        let result = page
            .evaluate_for_cdp_with_timeout(probe, true, true, 5_000)
            .await
            .unwrap()
            .value
            .unwrap();
        assert_eq!(
            result,
            serde_json::json!(["iframe", "http/1.1", 300]),
            "a subframe's document is a resource of the embedding document",
        );

        let child_id = page
            .frames
            .get(page.frames.main_frame_id())
            .unwrap()
            .children[0]
            .clone();
        let generation = page.frames.get(&child_id).unwrap().document_generation;
        let child_timing = page
            .js
            .as_mut()
            .unwrap()
            .execute_script_in_frame_realm(
                &child_id,
                generation,
                "<frame-navigation-timing-probe>",
                r#"(() => {
                    const entry = performance.getEntriesByType('navigation')[0];
                    return entry ? [
                        entry.name.endsWith('/frame'),
                        entry.entryType,
                        entry.initiatorType,
                        entry.responseStart > 0,
                        entry.responseEnd >= entry.responseStart,
                        entry.transferSize - entry.encodedBodySize,
                        entry.encodedBodySize,
                        entry.responseStatus,
                        entry instanceof PerformanceNavigationTiming,
                    ] : null;
                })()"#,
            )
            .unwrap();
        assert_eq!(
            child_timing,
            serde_json::json!([
                true,
                "navigation",
                "navigation",
                true,
                true,
                300,
                frame_body.len(),
                200,
                true,
            ]),
            "a frame document exposes its own complete navigation timing",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn response_frame_src_blocks_child_and_nested_frame_requests() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let path = String::from_utf8_lossy(&request[..length])
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                request_tx.send(path.clone()).unwrap();
                let (csp, body) = match path.as_str() {
                    "/main-blocked" => (
                        Some("frame-src 'none'"),
                        "<!doctype html><iframe src='/blocked.html'></iframe>",
                    ),
                    "/main-nested" => (
                        None,
                        "<!doctype html><iframe src='/child.html'></iframe>",
                    ),
                    "/child.html" => (
                        Some("frame-src 'none'"),
                        "<!doctype html><p id=child>child</p><iframe src='/grandchild.html'></iframe>",
                    ),
                    _ => (None, "unexpected request"),
                };
                let csp_header = csp
                    .map(|value| format!("Content-Security-Policy: {value}\r\n"))
                    .unwrap_or_default();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{csp_header}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-csp".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-csp".to_string(), context);

        page.navigate(&format!("{origin}/main-blocked")).await.unwrap();
        let blocked_has_document = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                dom.iframe_content_document(host).is_some()
            })
            .unwrap();
        assert!(!blocked_has_document);

        page.navigate(&format!("{origin}/main-nested")).await.unwrap();
        let (child_text, nested_has_document, child_csp) = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                let child = dom.query_selector_from(root, "#child").unwrap().unwrap();
                let nested = dom.query_selector_from(root, "iframe").unwrap().unwrap();
                (
                    dom.text_content(child),
                    dom.iframe_content_document(nested).is_some(),
                    dom.document_scope(root).unwrap().csp,
                )
            })
            .unwrap();
        assert_eq!(child_text, "child");
        assert!(!nested_has_document);
        assert_eq!(child_csp.as_deref(), Some("frame-src 'none'"));

        let requested: Vec<String> = request_rx.try_iter().collect();
        assert_eq!(
            requested,
            vec!["/main-blocked", "/main-nested", "/child.html"]
        );
    }

    #[test]
    fn allow_csp_from_compares_origins_not_raw_header_strings() {
        let embedder = obscura_dom::Origin::from_url("https://Parent.Example/");
        assert!(super::allow_csp_from_accepts(
            Some("HTTPS://parent.example:443/"),
            &embedder,
        ));
        assert!(super::allow_csp_from_accepts(
            Some("https://other.example, https://parent.example"),
            &embedder,
        ));
        assert!(!super::allow_csp_from_accepts(
            Some("https://parent.example:8443"),
            &embedder,
        ));
        assert!(!super::allow_csp_from_accepts(
            Some("https://parent.example/path"),
            &embedder,
        ));

        let opaque = obscura_dom::Origin::from_url("data:text/html,opaque");
        assert!(super::allow_csp_from_accepts(Some("*"), &opaque));
        assert!(!super::allow_csp_from_accepts(Some("null"), &opaque));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn iframe_404_response_commits_real_document_and_network_body() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let frame_origin = origin.clone();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                request_tx.send(path.clone()).unwrap();
                let (status, csp, body) = if path == "/missing" {
                    (
                        "404 Not Found",
                        "Content-Security-Policy: script-src 'none'\r\n".to_string(),
                        "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"img-src 'none'\"><title>Not Found</title></head><body><h1 id=missing>404</h1></body></html>".to_string(),
                    )
                } else {
                    (
                        "200 OK",
                        String::new(),
                        format!(
                            "<!doctype html><html><body><iframe id=missing-frame src=\"{frame_origin}/missing\"></iframe></body></html>"
                        ),
                    )
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n{csp}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "iframe-404".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("iframe-404".to_string(), context);
        page.navigate(&origin).await.unwrap();

        let (frame_id, root) = page
            .with_dom(|dom| {
                let host = dom.query_selector("#missing-frame").unwrap().unwrap();
                let frame = page.frames.by_host(host).expect("iframe browsing context");
                (frame.frame_id.clone(), frame.active_document_root.unwrap())
            })
            .unwrap();
        let scope = page
            .with_dom(|dom| dom.document_scope(root))
            .flatten()
            .unwrap();
        assert_eq!(scope.url, format!("{origin}/missing"));
        assert_eq!(
            scope.csp.as_deref(),
            Some("script-src 'none'; img-src 'none'")
        );

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "(() => { const d = document.getElementById('missing-frame').contentDocument; return [d.URL, d.title, d.body.innerHTML]; })()",
                )
                .unwrap(),
            serde_json::json!([
                format!("{origin}/missing"),
                "Not Found",
                "<h1 id=\"missing\">404</h1>"
            ]),
        );

        let event = page
            .network_events
            .iter()
            .find(|event| event.frame_id.as_deref() == Some(frame_id.as_str()))
            .expect("iframe network event");
        assert_eq!(event.status, 404);
        assert_eq!(event.resource_type, "Document");
        assert!(event.body_size > 0);
        let stored = page.get_response_body(&event.request_id).unwrap();
        assert!(!stored.base64_encoded);
        assert!(
            stored.body.contains("404"),
            "unexpected stored iframe body: {}",
            stored.body
        );
        assert_eq!(
            request_rx.try_iter().collect::<Vec<_>>(),
            vec!["/".to_string(), "/missing".to_string()]
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn top_level_404_response_commits_real_document() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request).unwrap();
            let body = "<!doctype html><html><head><title>Missing</title></head><body><p>404 body</p></body></html>";
            let response = format!(
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "top-404".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("top-404".to_string(), context);
        page.navigate(&format!("{origin}/missing")).await.unwrap();
        assert_eq!(page.url_string(), format!("{origin}/missing"));
        assert_eq!(page.title, "Missing");
        assert_eq!(
            page.with_dom(|dom| {
                let body = dom.query_selector("body").unwrap().unwrap();
                dom.text_content(body)
            })
            .unwrap(),
            "404 body"
        );
        let event = page
            .network_events
            .iter()
            .find(|event| event.resource_type == "Document")
            .expect("top-level network event");
        assert_eq!(event.status, 404);
        assert!(page
            .get_response_body(&event.request_id)
            .is_some_and(|body| body.body.contains("404 body")));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn top_csp_sandbox_blocks_parser_scripts_and_reports_scope_flags() {
        let mut page = frame_test_page(
            "<html><body><script>globalThis.topCspRan = true;</script></body></html>",
        );
        page.document_csp = Some("sandbox".to_string());
        page.init_js();
        page.execute_scripts().await;

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("typeof globalThis.topCspRan")
                .unwrap(),
            serde_json::json!("undefined")
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "(() => { const info = JSON.parse(Deno.core.ops.op_dom('document_scope_info', '0', '')); return [info.sandboxActive, info.allowScripts, info.allowSameOrigin]; })()",
                )
                .unwrap(),
            serde_json::json!([true, false, false])
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_meta_csp_blocks_inline_script_before_frame_realm_runs() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    frame.id = 'meta-csp-frame';
                    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><script>globalThis.metaCspRan = true;</script><p>body</p>';
                    document.body.appendChild(frame);
                })()"#,
            )
            .unwrap();
        assert_eq!(page.process_pending_frame_navigations().await, 1);

        let (frame_id, root) = page
            .with_dom(|dom| {
                let host = dom.query_selector("#meta-csp-frame").unwrap().unwrap();
                let frame = page.frames.by_host(host).expect("meta CSP frame");
                (frame.frame_id.clone(), frame.active_document_root.unwrap())
            })
            .unwrap();
        let scope = page
            .with_dom(|dom| dom.document_scope(root))
            .flatten()
            .unwrap();
        assert_eq!(scope.csp.as_deref(), Some("script-src 'none'"));
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "(() => { const frame = document.getElementById('meta-csp-frame'); return [frame.contentDocument.body.textContent, frame.contentWindow.metaCspRan ?? null]; })()",
                )
                .unwrap(),
            serde_json::json!(["body", null]),
        );
        assert_eq!(
            page.frames.get(&frame_id).unwrap().active_document_root,
            Some(root)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_meta_csp_sandbox_creates_opaque_origin() {
        let mut page = frame_test_page("<html><body></body></html>");
        page.set_preload_scripts(vec![super::PreloadScript::main_world(
            "if (document.URL === 'about:srcdoc') { const script = document.createElement('script'); script.textContent = 'globalThis.metaSandboxDynamic = true'; document.body.appendChild(script); }",
        )]);
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const frame = document.createElement('iframe');
                    frame.id = 'meta-sandbox-frame';
                    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="sandbox"><p>opaque</p>';
                    document.body.appendChild(frame);
                })()"#,
            )
            .unwrap();
        assert_eq!(page.process_pending_frame_navigations().await, 1);

        let (frame_id, generation, root) = page
            .with_dom(|dom| {
                let host = dom.query_selector("#meta-sandbox-frame").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                let frame = page.frames.by_host(host).unwrap();
                (frame.frame_id.clone(), frame.document_generation, root)
            })
            .unwrap();
        let scope = page
            .with_dom(|dom| dom.document_scope(root))
            .flatten()
            .unwrap();
        assert_eq!(scope.csp.as_deref(), Some("sandbox"));
        assert!(scope.sandbox.active);
        assert!(!scope.sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN));
        assert!(scope.origin.is_opaque());
        assert!(!scope.cross_origin_isolated);
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .execute_script_in_frame_realm(
                    &frame_id,
                    generation,
                    "<meta-sandbox-probe>",
                    "typeof globalThis.metaSandboxDynamic",
                )
                .unwrap(),
            serde_json::json!("undefined")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn iframe_embedded_csp_negotiates_network_and_applies_only_to_srcdoc_locals() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            let mut seen = 0;
            while seen < 3 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                if length == 0 {
                    continue;
                }
                seen += 1;
                let head = String::from_utf8_lossy(&request[..length]).to_string();
                request_tx.send(head.clone()).unwrap();
                let request_line = head.lines().next().unwrap_or("");
                let exact = request_line.contains("/exact");
                let allow = request_line.contains("/allow");
                let body = if exact {
                    "<p id=accepted>accepted</p>"
                } else if allow {
                    "<p id=allowed>allowed</p>"
                } else {
                    "not accepted"
                };
                let csp = if exact {
                    "Content-Security-Policy: connect-src 'none'\r\n"
                } else if allow {
                    "Allow-CSP-From: *\r\n"
                } else {
                    ""
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{csp}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let html = format!(
            "<!doctype html><iframe id=exact csp=\"connect-src 'none'\" src=\"{origin}/exact\"></iframe>\
             <iframe id=allow csp=\"connect-src 'none'\" src=\"{origin}/allow\"></iframe>\
             <iframe id=reject csp=\"connect-src 'none'\" src=\"{origin}/reject\"></iframe>",
        );
        let mut page = frame_test_page(&html);
        let main_id = page.frames.main_frame_id().to_string();
        for (id, path, expected) in [
            ("exact", "exact", Ok(())),
            ("allow", "allow", Ok(())),
            (
                "reject",
                "reject",
                Err(super::FrameNavigateError::Blocked(
                    crate::frame_policy::FrameBlockedReason::CspEmbeddedEnforcement,
                )),
            ),
        ] {
            let host = page
                .with_dom(|dom| dom.query_selector(&format!("#{id}")).unwrap().unwrap())
                .unwrap();
            let frame_id = page.frames.attach_child(&main_id, host).unwrap();
            let result = page
                .navigate_frame(
                    &frame_id,
                    super::FrameNavigationRequest {
                        url: Some(format!("{origin}/{path}")),
                        ..Default::default()
                    },
                )
                .await;
            assert_eq!(result, expected, "{id}");
        }
        let (accepted, allowed, rejected, exact_csp, allowed_csp) = page
            .with_dom(|dom| {
                let exact = dom.query_selector("#exact").unwrap().unwrap();
                let allow = dom.query_selector("#allow").unwrap().unwrap();
                let reject = dom.query_selector("#reject").unwrap().unwrap();
                let exact_root = dom.iframe_content_document(exact).unwrap();
                let allow_root = dom.iframe_content_document(allow).unwrap();
                (
                    dom.query_selector_from(exact_root, "#accepted").unwrap().is_some(),
                    dom.query_selector_from(allow_root, "#allowed").unwrap().is_some(),
                    dom.iframe_content_document(reject).is_none(),
                    dom.document_scope(exact_root).unwrap().csp,
                    dom.document_scope(allow_root).unwrap().csp,
                )
            })
            .unwrap();
        assert!(accepted);
        assert!(allowed);
        assert!(rejected);
        assert_eq!(exact_csp.as_deref(), Some("connect-src 'none'"));
        assert_eq!(allowed_csp.as_deref(), Some("connect-src 'none'"));
        let requests: Vec<String> = (0..3)
            .map(|_| request_rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap())
            .collect();
        for request in requests {
            assert!(
                request.to_ascii_lowercase().contains("sec-required-csp: connect-src 'none'"),
                "{request}"
            );
        }

        let mut local = frame_test_page(
            "<!doctype html>\
             <iframe id=srcdoc csp=\"connect-src 'none'\" srcdoc='<p>srcdoc</p>'></iframe>\
             <iframe id=blank csp=\"connect-src 'none'\"></iframe>",
        );
        local.document_csp = Some("connect-src *".to_string());
        assert_eq!(local.load_child_frames().await, 2);
        let (srcdoc_csp, blank_csp) = local
            .with_dom(|dom| {
                let srcdoc = dom.query_selector("#srcdoc").unwrap().unwrap();
                let blank = dom.query_selector("#blank").unwrap().unwrap();
                let srcdoc_root = dom.iframe_content_document(srcdoc).unwrap();
                let blank_root = dom.iframe_content_document(blank).unwrap();
                (
                    dom.document_scope(srcdoc_root).unwrap().csp,
                    dom.document_scope(blank_root).unwrap().csp,
                )
            })
            .unwrap();
        assert_eq!(srcdoc_csp.as_deref(), Some("connect-src 'none'"));
        assert_eq!(blank_csp.as_deref(), Some("connect-src *"));

        local.init_js();
        let shape = local
            .evaluate(
                r#"(() => {
                    const frame = document.getElementById('srcdoc');
                    const descriptor = Object.getOwnPropertyDescriptor(
                        HTMLIFrameElement.prototype, 'csp');
                    frame.csp = "connect-src 'self'";
                    return [frame.csp, frame.getAttribute('csp'), descriptor.enumerable,
                        descriptor.configurable, descriptor.get.name, descriptor.set.name,
                        Function.prototype.toString.call(descriptor.get),
                        Function.prototype.toString.call(descriptor.set)];
                })()"#,
            );
        assert_eq!(shape, serde_json::json!([
            "connect-src 'self'", "connect-src 'self'", true, true,
            "get csp", "set csp", "function get csp() { [native code] }",
            "function set csp() { [native code] }",
        ]));
    }

    #[test]
    fn coop_coep_and_permissions_policy_derive_cross_origin_isolation() {
        let response = |headers: &[(&str, &str)]| obscura_net::Response {
            url: url::Url::parse("https://isolated.example/page").unwrap(),
            status: 200,
            headers: headers.iter().map(|(name, value)| {
                ((*name).to_string(), (*value).to_string())
            }).collect(),
            body: Vec::new(),
            redirected_from: Vec::new(),
            timing: obscura_net::ResponseTiming::default(),
        };
        assert!(response_grants_cross_origin_isolation(&response(&[
            ("cross-origin-opener-policy", "same-origin"),
            ("cross-origin-embedder-policy", "require-corp"),
        ])));
        assert!(response_grants_cross_origin_isolation(&response(&[
            ("cross-origin-opener-policy", "same-origin; report-to=coop"),
            ("cross-origin-embedder-policy", "credentialless"),
        ])));
        assert!(!response_grants_cross_origin_isolation(&response(&[
            ("cross-origin-opener-policy", "same-origin-allow-popups"),
            ("cross-origin-embedder-policy", "require-corp"),
        ])));
        assert!(!response_grants_cross_origin_isolation(&response(&[
            ("cross-origin-opener-policy", "same-origin"),
        ])));
        assert!(!response_grants_cross_origin_isolation(&response(&[
            ("cross-origin-opener-policy", "same-origin"),
            ("cross-origin-embedder-policy", "require-corp"),
            ("permissions-policy", "camera=(), cross-origin-isolated = ()"),
        ])));
    }

    #[test]
    fn cross_origin_child_cannot_enable_cross_origin_isolation() {
        let response = obscura_net::Response {
            url: url::Url::parse("https://widget.example/frame").unwrap(),
            status: 200,
            headers: [
                ("cross-origin-opener-policy".to_string(), "same-origin".to_string()),
                ("cross-origin-embedder-policy".to_string(), "require-corp".to_string()),
            ]
            .into_iter()
            .collect(),
            body: Vec::new(),
            redirected_from: Vec::new(),
            timing: obscura_net::ResponseTiming::default(),
        };
        let widget = obscura_dom::Origin::from_url("https://widget.example/frame");
        let page = obscura_dom::Origin::from_url("https://page.example/");
        assert!(!frame_response_grants_cross_origin_isolation(
            &response, &widget, &page, true,
        ));
        assert!(!frame_response_grants_cross_origin_isolation(
            &response, &widget, &widget, false,
        ));
        assert!(frame_response_grants_cross_origin_isolation(
            &response, &widget, &widget, true,
        ));
        assert!(super::iframe_allows_cross_origin_isolated(
            "cross-origin-isolated; fullscreen; autoplay"
        ));
        assert!(super::frame_document_isolation(
            &response, &widget, &page, true, true, obscura_dom::SandboxFlags::default(),
        ));
        assert!(!super::frame_document_isolation(
            &response, &widget, &page, true, false, obscura_dom::SandboxFlags::default(),
        ));
        assert!(!super::iframe_allows_cross_origin_isolated("fullscreen; autoplay"));
        assert!(!super::iframe_allows_cross_origin_isolated("cross-origin-isolated-extra"));
    }

    #[test]
    fn feature_policy_reads_committed_permissions_policy_header() {
        let mut page = frame_test_page("<!doctype html><html><body></body></html>");
        page.document_origin = Some(obscura_dom::Origin::from_url("https://top.example/app/"));
        page.document_permissions_policy = Some(
            "geolocation=(), camera=(), microphone=(self), fullscreen=*".to_string(),
        );
        page.init_js();
        let result = page
            .evaluate(
                "(() => { const p = document.featurePolicy; return {\
                    geo: p.allowsFeature('geolocation'),\
                    camera: p.allowsFeature('camera'),\
                    mic: p.allowsFeature('microphone'),\
                    micOther: p.allowsFeature('microphone', 'https://other.example'),\
                    fullscreen: p.allowsFeature('fullscreen'),\
                    pictureOther: p.allowsFeature('picture-in-picture', 'https://other.example'),\
                    features: p.allowedFeatures().slice(0, 5),\
                    geoList: p.getAllowlistForFeature('geolocation'),\
                    micList: p.getAllowlistForFeature('microphone'),\
                    unknown: p.getAllowlistForFeature('not-a-feature'),\
                }; })()",
            );
        assert_eq!(result["geo"], false);
        assert_eq!(result["camera"], false);
        assert_eq!(result["mic"], true);
        assert_eq!(result["micOther"], false);
        assert_eq!(result["fullscreen"], true);
        assert_eq!(result["pictureOther"], true);
        assert_eq!(
            result["features"],
            serde_json::json!([
                "ch-ua-full-version-list",
                "cross-origin-isolated",
                "on-device-speech-recognition",
                "translator",
                "shared-storage-select-url",
            ])
        );
        assert_eq!(result["geoList"], serde_json::json!([]));
        assert_eq!(
            result["micList"],
            serde_json::json!(["https://top.example"])
        );
        assert_eq!(result["unknown"], serde_json::json!([]));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn data_url_frame_gets_opaque_origin_not_relative_join() {
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body>\
             <iframe src=\"data:text/html,<i id=d>data</i>\"></iframe>\
             </body></html>",
        );
        page.load_child_frames().await;
        let dom = page.dom.as_ref().unwrap();
        let host = dom.query_selector("iframe").unwrap().unwrap();
        let root = dom.iframe_content_document(host).expect("data: doc");
        let scope = dom.document_scope(root).unwrap();
        // data: is not treated as a relative URL and gets an opaque origin.
        assert!(scope.url.starts_with("data:"));
        assert!(scope.origin.is_opaque());
        let node = dom.query_selector_from(root, "#d").unwrap().unwrap();
        assert_eq!(dom.text_content(node), "data");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_inline_scripts_execute_in_their_frame_realm() {
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe srcdoc=\"\
             <div id=out>before</div>\
             <script>var frameVar='ran';document.getElementById('out').textContent=frameVar;</script>\
             <script>document.getElementById('out').setAttribute('data-second', frameVar + (document.currentScript ? '/cs' : '/nocs'));</script>\
             \"></iframe></body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;

        // Both scripts ran against the frame document; the second saw the
        // first's top-level var (shared frame global) and its own
        // document.currentScript.
        let (text, second) = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                let out = dom.query_selector_from(root, "#out").unwrap().unwrap();
                (
                    dom.text_content(out),
                    dom.get_node(out)
                        .and_then(|node| node.get_attribute("data-second").map(str::to_string)),
                )
            })
            .unwrap();
        assert_eq!(text, "ran");
        assert_eq!(second.as_deref(), Some("ran/cs"));

        // The frame's top-level binding stayed out of the main realm, and the
        // frame realm still holds it.
        let host = page
            .with_dom(|dom| dom.query_selector("iframe").unwrap().unwrap())
            .unwrap();
        let (frame_id, generation) = {
            let frame = page.frames.by_host(host).unwrap();
            (frame.frame_id.clone(), frame.document_generation)
        };
        let js = page.js.as_mut().unwrap();
        assert_eq!(
            js.evaluate("typeof frameVar").unwrap(),
            serde_json::json!("undefined")
        );
        assert_eq!(
            js.execute_script_in_frame_realm(&frame_id, generation, "<t>", "frameVar")
                .unwrap(),
            serde_json::json!("ran")
        );
        // currentScript was restored after the last script finished.
        assert_eq!(
            js.execute_script_in_frame_realm(
                &frame_id,
                generation,
                "<t>",
                "document.currentScript === null",
            )
            .unwrap(),
            serde_json::json!(true)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_preloads_run_before_author_scripts_in_matching_worlds() {
        let mut page = frame_test_page(
            "<!doctype html><iframe id=f srcdoc=\"\
             <script>\
               globalThis.authorSawPreload=globalThis.preloadValue;\
               globalThis.authorSawUtility=typeof globalThis.utilityValue;\
             </script>\
             \"></iframe>",
        );
        page.set_preload_scripts(vec![
            super::PreloadScript::main_world("globalThis.preloadValue='ready'"),
            super::PreloadScript {
                source: "globalThis.utilityValue='isolated'".to_string(),
                world_name: Some("utility".to_string()),
                world_id: 7,
            },
        ]);
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "[document.getElementById('f').contentWindow.authorSawPreload, document.getElementById('f').contentWindow.authorSawUtility]",
                )
                .unwrap(),
            serde_json::json!(["ready", "undefined"]),
        );
        let (frame_id, generation) = {
            let js = page.js.as_ref().unwrap();
            let host = js
                .with_dom(|dom| dom.query_selector("#f").unwrap().unwrap())
                .unwrap();
            let frame = page.frames.by_host(host).unwrap();
            (frame.frame_id.clone(), frame.document_generation)
        };
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .execute_script_in_frame_world_realm(
                    &frame_id,
                    generation,
                    7,
                    "<test>",
                    "[utilityValue, typeof preloadValue, typeof authorSawPreload]",
                )
                .unwrap(),
            serde_json::json!(["isolated", "undefined", "undefined"]),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn sandboxed_frame_scripts_do_not_execute() {
        // sandbox="" withholds allow-scripts, so the frame must stay inert.
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe sandbox=\"\" srcdoc=\"\
             <div id=s>x</div>\
             <script>document.getElementById('s').textContent='hacked';</script>\
             \"></iframe></body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;

        let text = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                let s = dom.query_selector_from(root, "#s").unwrap().unwrap();
                dom.text_content(s)
            })
            .unwrap();
        assert_eq!(text, "x");
        // The browsing context still owns a Window realm; only author script
        // execution is suppressed by the sandbox flag.
        let host = page
            .with_dom(|dom| dom.query_selector("iframe").unwrap().unwrap())
            .unwrap();
        let (frame_id, generation) = {
            let frame = page.frames.by_host(host).unwrap();
            (frame.frame_id.clone(), frame.document_generation)
        };
        assert!(page
            .js
            .as_ref()
            .unwrap()
            .frame_realm(&frame_id, generation)
            .is_some());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn synchronously_created_nested_iframe_inherits_parent_sandbox() {
        // The nested iframe is created from the outer frame's author script,
        // so its initial about:blank scope is observed before the controller
        // can replace it with an asynchronous navigation commit.
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe sandbox=\"allow-scripts\" srcdoc=\"\
             <script>\
               const nested = document.createElement('iframe');\
               nested.id = 'nested';\
               document.body.appendChild(nested);\
             </script>\
             \"></iframe></body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;

        let nested_scope = page
            .with_dom(|dom| {
                let outer = dom.query_selector("iframe").unwrap().unwrap();
                let outer_root = dom.iframe_content_document(outer).unwrap();
                let nested = dom
                    .query_selector_from(outer_root, "#nested")
                    .unwrap()
                    .unwrap();
                let nested_root = dom.iframe_content_document(nested).unwrap();
                dom.document_scope(nested_root)
            })
            .flatten()
            .expect("nested initial about:blank scope");

        assert!(nested_scope.sandbox.active);
        assert!(nested_scope
            .sandbox
            .allows(obscura_dom::SandboxFlags::ALLOW_SCRIPTS));
        assert!(!nested_scope
            .sandbox
            .allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN));
        assert!(nested_scope.origin.is_opaque());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn nested_frame_scripts_execute_in_their_own_realms() {
        // The nested markup avoids quotes so it survives the srcdoc-in-srcdoc
        // attribute nesting; each script publishes through document.title.
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe srcdoc=\"\
             <script>var outerV=1;document.title=100+outerV;</script>\
             <iframe srcdoc='<script>var innerV=41;document.title=innerV+1;</script>'></iframe>\
             \"></iframe></body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;

        let (outer_host, inner_host) = page
            .with_dom(|dom| {
                let outer = dom.query_selector("iframe").unwrap().unwrap();
                let outer_root = dom.iframe_content_document(outer).unwrap();
                let inner = dom
                    .query_selector_from(outer_root, "iframe")
                    .unwrap()
                    .unwrap();
                (outer, inner)
            })
            .unwrap();
        let (outer_id, outer_generation) = {
            let frame = page.frames.by_host(outer_host).unwrap();
            (frame.frame_id.clone(), frame.document_generation)
        };
        let (inner_id, inner_generation) = {
            let frame = page.frames.by_host(inner_host).unwrap();
            (frame.frame_id.clone(), frame.document_generation)
        };
        let js = page.js.as_mut().unwrap();
        // Each document got its own realm with its own top-level bindings and
        // its own scoped document.
        assert_eq!(
            js.execute_script_in_frame_realm(
                &outer_id,
                outer_generation,
                "<t>",
                "[document.title, outerV, typeof innerV]",
            )
            .unwrap(),
            serde_json::json!(["101", 1, "undefined"])
        );
        assert_eq!(
            js.execute_script_in_frame_realm(
                &inner_id,
                inner_generation,
                "<t>",
                "[document.title, innerV, typeof outerV]",
            )
            .unwrap(),
            serde_json::json!(["42", 41, "undefined"])
        );
        assert_eq!(
            js.evaluate("[typeof outerV, typeof innerV]").unwrap(),
            serde_json::json!(["undefined", "undefined"])
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_and_parent_exchange_postmessage_round_trip() {
        // Phase 4: parent -> child via contentWindow.postMessage('/', same
        // origin), child handler writes the delivery into its own DOM and
        // echoes through e.source; the parent's listener asserts payload,
        // sender origin and source identity against the contentWindow proxy.
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body>\
             <iframe srcdoc=\"\
               <div id=out>none</div>\
               <script>\
                 window.addEventListener('message', function(e) {\
                   document.getElementById('out').textContent = 'got:' + e.data.n + ':' + e.origin;\
                   e.source.postMessage({ n: e.data.n + 1 }, '*');\
                 });\
               </script>\"></iframe>\
             <div id=pout>none</div>\
             <script>\
               window.addEventListener('message', function(e) {\
                 document.getElementById('pout').textContent =\
                   'echo:' + e.data.n + ':' + e.origin + ':' + (e.source === document.querySelector('iframe').contentWindow);\
               });\
               document.querySelector('iframe').contentWindow.postMessage({ n: 1 }, '/');\
             </script>\
             </body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;
        page.execute_scripts().await;
        // The navigation flow runs this delivery pass after the scripts; the
        // direct-call harness invokes it the same way.
        page.js.as_mut().unwrap().deliver_pending_frame_messages().await;

        // Child side observed the parent's message (data + serialized parent
        // origin), written into the frame document.
        let child_text = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                let out = dom.query_selector_from(root, "#out").unwrap().unwrap();
                dom.text_content(out)
            })
            .unwrap();
        assert_eq!(child_text, "got:1:https://top.example");

        // Parent side observed the echo: payload, the frame's origin (srcdoc
        // inherits the parent origin) and source === contentWindow proxy.
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("document.getElementById('pout').textContent")
                .unwrap(),
            serde_json::json!("echo:2:https://top.example:true")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cross_document_postmessage_events_are_trusted() {
        // UA-delivered message events are trusted in browsers. Constructing a
        // MessageEvent in author script remains untrusted; only delivery via
        // postMessage receives the browser-owned trust marker.
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body>\
             <iframe srcdoc=\"\
               <script>\
                 window.addEventListener('message', function(e) {\
                   parent.postMessage({ childTrusted: e.isTrusted }, '*');\
                 });\
               </script>\"></iframe>\
             <script>\
               globalThis.trustResult = null;\
               window.addEventListener('message', function(e) {\
                 globalThis.trustResult = {\
                   childTrusted: e.data.childTrusted,\
                   parentTrusted: e.isTrusted,\
                   constructedTrusted: (new MessageEvent('message')).isTrusted\
                 };\
               });\
               document.querySelector('iframe').contentWindow.postMessage('start', '*');\
             </script>\
             </body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;
        page.execute_scripts().await;
        page.js.as_mut().unwrap().deliver_pending_frame_messages().await;

        assert_eq!(
            page.js.as_mut().unwrap().evaluate("globalThis.trustResult").unwrap(),
            serde_json::json!({
                "childTrusted": true,
                "parentTrusted": true,
                "constructedTrusted": false,
            })
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn nested_frame_parent_postmessage_targets_intermediate_frame_realm() {
        // Phase 4 nesting: the innermost frame's `parent` addresses the
        // intermediate frame's realm, not the main Window. The inner srcdoc
        // is single-quote delimited, so its script avoids quotes entirely
        // (String.fromCharCode(42) === '*').
        let mut page = frame_test_page(
            "<!DOCTYPE html><html><body><iframe srcdoc=\"\
             <div id=oout>none</div>\
             <script>\
               window.addEventListener('message', function(e) {\
                 document.getElementById('oout').textContent = 'inner:' + e.data.n + ':' + e.origin\
                   + ':' + (e.source === document.querySelector('iframe').contentWindow);\
               });\
             </script>\
             <iframe srcdoc='<script>parent.postMessage({n:5}, String.fromCharCode(42));</script>'></iframe>\
             \"></iframe></body></html>",
        );
        page.load_child_frames().await;
        page.init_js();
        page.execute_frame_scripts().await;
        page.js.as_mut().unwrap().deliver_pending_frame_messages().await;

        // The intermediate frame realm received the message with the inner
        // frame's origin (inherited srcdoc chain) and its source resolved to
        // that realm's contentWindow proxy for the inner host.
        let outer_text = page
            .with_dom(|dom| {
                let outer = dom.query_selector("iframe").unwrap().unwrap();
                let outer_root = dom.iframe_content_document(outer).unwrap();
                let out = dom.query_selector_from(outer_root, "#oout").unwrap().unwrap();
                dom.text_content(out)
            })
            .unwrap();
        assert_eq!(outer_text, "inner:5:https://top.example:true");
        // Nothing leaked to the main Window's queue or listeners.
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("typeof globalThis.__gotMain")
                .unwrap(),
            serde_json::json!("undefined")
        );
    }

    /// 1x1 PNG, color #e02020. Valid bytes so the render image cache accepts
    /// the seed (image_intrinsic_dimensions must parse it).
    const TEST_PIXEL_PNG: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8,
        2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 120, 156, 99, 120, 160, 160,
        0, 0, 3, 4, 1, 33, 103, 116, 190, 231, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    fn spawn_frame_stylesheet_server() -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..32 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let _ = request_tx.send(path.clone());
                let (content_type, body): (&str, Vec<u8>) = match path.as_str() {
                    "/" => (
                        "text/html",
                        b"<!doctype html><html><body>\
                          <iframe src=\"/sub/frame.html\"></iframe>\
                          </body></html>"
                            .to_vec(),
                    ),
                    "/sub/frame.html" => (
                        "text/html",
                        b"<!doctype html><html><head>\
                          <link rel=\"stylesheet\" href=\"css/frame.css\">\
                          <link rel=\"stylesheet\" href=\"css/frame.css\">\
                          <link rel=\"stylesheet\" href=\"css/print.css\" media=\"print\">\
                          <link rel=\"stylesheet\" href=\"css/frame.css\" disabled>\
                          </head><body>\
                          <img src=\"img/pixel.png\">\
                          <iframe src=\"/inner.html\"></iframe>\
                          </body></html>"
                            .to_vec(),
                    ),
                    "/sub/css/frame.css" => (
                        "text/css",
                        b"@import 'imported.css';body{background:url('img/bg.png')}".to_vec(),
                    ),
                    "/sub/css/imported.css" => ("text/css", b".imp{color:red}".to_vec()),
                    "/sub/css/print.css" => ("text/css", b".print-only{display:none}".to_vec()),
                    "/inner.html" => (
                        "text/html",
                        b"<!doctype html><html><head>\
                          <link rel=\"stylesheet\" href=\"/css/inner.css\">\
                          </head><body></body></html>"
                            .to_vec(),
                    ),
                    "/css/inner.css" => ("text/css", b".inner{color:blue}".to_vec()),
                    "/sub/img/pixel.png" | "/sub/css/img/bg.png" => {
                        ("image/png", TEST_PIXEL_PNG.to_vec())
                    }
                    _ => ("text/plain", b"missing".to_vec()),
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len(),
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        (origin, request_rx)
    }

    fn spawn_frame_script_server() -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..16 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let _ = request_tx.send(path.clone());
                let (content_type, body): (&str, Vec<u8>) = match path.as_str() {
                    "/" => (
                        "text/html",
                        b"<!doctype html><html><body>\
                          <iframe src=\"/sub/frame.html\"></iframe>\
                          </body></html>"
                            .to_vec(),
                    ),
                    "/sub/frame.html" => (
                        "text/html",
                        b"<!doctype html><html><body>\
                          <div id=\"t\">before</div>\
                          <script src=\"js/app.js\"></script>\
                          </body></html>"
                            .to_vec(),
                    ),
                    // The relative src resolved against the frame document's
                    // URL, not the top document's.
                    "/sub/js/app.js" => (
                        "application/javascript",
                        b"var extVar=7;document.getElementById('t').textContent='external';"
                            .to_vec(),
                    ),
                    _ => ("text/plain", b"missing".to_vec()),
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len(),
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        (origin, request_rx)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_external_scripts_execute_and_resolve_against_frame_base() {
        let (origin, requests) = spawn_frame_script_server();
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-script".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-script".to_string(), context);
        page.navigate(&origin).await.unwrap();

        let text = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                let t = dom.query_selector_from(root, "#t").unwrap().unwrap();
                dom.text_content(t)
            })
            .unwrap();
        assert_eq!(text, "external");

        let requested: Vec<String> = requests.try_iter().collect();
        assert!(
            requested.iter().any(|path| path == "/sub/js/app.js"),
            "expected the frame-relative script fetch, saw {requested:?}",
        );
        let frame_id = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                page.frames.by_host(host).unwrap().frame_id.clone()
            })
            .unwrap();
        let script_event = page
            .network_events
            .iter()
            .find(|event| event.url.ends_with("/sub/js/app.js"))
            .expect("frame script network event");
        assert_eq!(script_event.frame_id.as_deref(), Some(frame_id.as_str()));

        // The external frame script's top-level var stayed in its realm.
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("typeof extVar")
                .unwrap(),
            serde_json::json!("undefined")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_document_csp_gates_inline_nonce_and_external_scripts() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..4 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let _ = request_tx.send(path.clone());
                let (csp, content_type, body): (&str, &str, &[u8]) = match path.as_str() {
                    "/" => (
                        "",
                        "text/html",
                        b"<!doctype html><iframe src='/frame.html'></iframe>",
                    ),
                    "/frame.html" => (
                        "script-src 'nonce-good'",
                        "text/html",
                        b"<!doctype html><script>globalThis.blocked=1</script>\
                           <script nonce='good'>globalThis.allowed=2;\
                             globalThis.evalState='allowed';\
                             try { eval('2 + 2'); } catch (error) { globalThis.evalState=error.name; }\
                             globalThis.functionState='allowed';\
                             try { new Function('return 1'); } catch (error) { globalThis.functionState=error.name; }\
                             const denied=document.createElement('script');\
                             denied.textContent='globalThis.dynamicDenied=4';\
                             document.body.appendChild(denied);\
                             const allowed=document.createElement('script');\
                             allowed.nonce='good';\
                             allowed.textContent='globalThis.dynamicAllowed=5';\
                             document.body.appendChild(allowed);\
                             const external=document.createElement('script');\
                             external.nonce='good';\
                             external.src='/allowed.js';\
                             document.body.appendChild(external);\
                           </script>\
                           <script nonce='good' type='module'>\
                             import 'https://blocked.example/dep.js';\
                             globalThis.moduleMarker=1;\
                           </script>\
                           <script src='/frame.js'></script>",
                    ),
                    "/frame.js" => (
                        "",
                        "application/javascript",
                        b"globalThis.cspExternalMarker=3",
                    ),
                    "/allowed.js" => (
                        "",
                        "application/javascript",
                        b"globalThis.dynamicExternalAllowed=6",
                    ),
                    _ => ("", "text/plain", b"missing"),
                };
                let csp_header = if csp.is_empty() {
                    String::new()
                } else {
                    format!("Content-Security-Policy: {csp}\r\n")
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n{csp_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(body);
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-script-csp".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-script-csp".to_string(), context);
        page.navigate(&origin).await.unwrap();
        page.settle_for_duration(100).await;

        let values = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                "(() => { const w = document.querySelector('iframe').contentWindow; return [w.blocked, w.allowed, w.__obscura_csp_allows_unsafe_eval, w.evalState, w.functionState, w.cspExternalMarker, w.dynamicDenied, w.dynamicAllowed, w.dynamicExternalAllowed, w.moduleMarker]; })()",
            )
            .unwrap();
        assert_eq!(values, serde_json::json!([null, 2, false, "EvalError", "EvalError", null, null, 5, 6, null]));

        let requested: Vec<String> = request_rx.try_iter().collect();
        assert_eq!(requested, vec!["/", "/frame.html", "/allowed.js"]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_response_csp_sandbox_gates_scripts_and_origin() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..3 {
                let Ok((mut stream, _)) = listener.accept() else { break };
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap_or(0);
                let path = String::from_utf8_lossy(&request[..length])
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let (csp, body) = match path.as_str() {
                    "/" => (
                        "",
                        "<!doctype html><iframe id=strict src='/strict.html'></iframe><iframe id=relaxed src='/relaxed.html'></iframe>",
                    ),
                    "/strict.html" => (
                        "sandbox",
                        "<!doctype html><script>globalThis.strictRan=1</script>",
                    ),
                    "/relaxed.html" => (
                        "sandbox allow-scripts",
                        "<!doctype html><script>globalThis.relaxedRan=1</script>",
                    ),
                    _ => ("", "missing"),
                };
                let csp_header = if csp.is_empty() {
                    String::new()
                } else {
                    format!("Content-Security-Policy: {csp}\r\n")
                };
                let isolation_headers = if path == "/relaxed.html" {
                    "Cross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\n"
                } else {
                    ""
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{csp_header}{isolation_headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(body.as_bytes());
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-response-csp-sandbox".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-response-csp-sandbox".to_string(), context);
        page.navigate(&origin).await.unwrap();

        let (strict, relaxed) = page
            .with_dom(|dom| {
                let strict_host = dom.query_selector("#strict").unwrap().unwrap();
                let relaxed_host = dom.query_selector("#relaxed").unwrap().unwrap();
                let strict_root = dom.iframe_content_document(strict_host).unwrap();
                let relaxed_root = dom.iframe_content_document(relaxed_host).unwrap();
                (
                    dom.document_scope(strict_root).unwrap(),
                    dom.document_scope(relaxed_root).unwrap(),
                )
            })
            .unwrap();
        assert!(strict.sandbox.active);
        assert!(!strict.sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SCRIPTS));
        assert!(strict.origin.is_opaque());
        assert!(relaxed.sandbox.active);
        assert!(relaxed.sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SCRIPTS));
        assert!(relaxed.origin.is_opaque());
        assert!(!relaxed.cross_origin_isolated);

        let (strict_host, relaxed_host) = page
            .with_dom(|dom| {
                (
                    dom.query_selector("#strict").unwrap().unwrap(),
                    dom.query_selector("#relaxed").unwrap().unwrap(),
                )
            })
            .unwrap();
        let strict_frame = page.frames.by_host(strict_host).unwrap();
        let relaxed_frame = page.frames.by_host(relaxed_host).unwrap();
        let (strict_id, strict_generation, relaxed_id, relaxed_generation) = (
            strict_frame.frame_id.clone(),
            strict_frame.document_generation,
            relaxed_frame.frame_id.clone(),
            relaxed_frame.document_generation,
        );
        let strict_ran = page
            .js
            .as_mut()
            .unwrap()
            .execute_script_in_frame_realm(
                &strict_id,
                strict_generation,
                "<csp-sandbox-probe>",
                "typeof strictRan",
            )
            .unwrap();
        let relaxed_ran = page
            .js
            .as_mut()
            .unwrap()
            .execute_script_in_frame_realm(
                &relaxed_id,
                relaxed_generation,
                "<csp-sandbox-probe>",
                "relaxedRan",
            )
            .unwrap();
        assert_eq!(strict_ran, serde_json::json!("undefined"));
        assert_eq!(relaxed_ran, serde_json::json!(1.0));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_modules_use_frame_import_map_realm_and_post_parse_order() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..5 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let path = String::from_utf8_lossy(&request[..length])
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let (content_type, body) = match path.as_str() {
                    "/" => (
                        "text/html",
                        "<!doctype html><iframe id=f src='/frame.html'></iframe>",
                    ),
                    "/frame.html" => (
                        "text/html",
                        "<!doctype html><div id=out></div>\
                         <script>globalThis.order=['classic']</script>\
                         <script defer src='/defer.js'></script>\
                         <script type=importmap>{\"imports\":{\"dep\":\"/dep.js\"}}</script>\
                         <script type=module>\
                           import { value } from 'dep';\
                           const lazyName = './lazy.js';\
                           const lazy = await import('./lazy.js');\
                           const repeated = await import(lazyName);\
                           const templated = `${(await import(`./lazy.js`)).value}`;\
                           order.push(value);\
                           order.push(lazy.value);\
                           order.push(templated);\
                           globalThis.dynamicNamespaceReused = lazy === repeated;\
                           globalThis.dynamicHelperEnumerable = Object.keys(globalThis).some(key => key.startsWith('__obscura_frame_dynamic_import_'));\
                           globalThis.moduleGlobalIsFrame = globalThis === window;\
                           globalThis.moduleCurrentScript = document.currentScript;\
                           document.getElementById('out').textContent = order.join(',');\
                         </script>\
                         <script>order.push('parser-tail')</script>",
                    ),
                    "/defer.js" => (
                        "application/javascript",
                        "order.push('defer')",
                    ),
                    "/dep.js" => (
                        "application/javascript",
                        "export const value = 'module';",
                    ),
                    "/lazy.js" => (
                        "application/javascript",
                        "globalThis.lazyRealmIsFrame = globalThis === window; export const value = 'dynamic';",
                    ),
                    _ => ("text/plain", "unexpected"),
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-module".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-module".to_string(), context);
        page.navigate(&origin).await.unwrap();

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "(() => { const w = document.getElementById('f').contentWindow; return [w.document.getElementById('out').textContent, w.moduleGlobalIsFrame, w.moduleCurrentScript]; })()",
                )
                .unwrap(),
            serde_json::json!(["classic,parser-tail,defer,module,dynamic,dynamic", true, null]),
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("(() => { const w = document.getElementById('f').contentWindow; return [w.lazyRealmIsFrame, w.dynamicNamespaceReused, w.dynamicHelperEnumerable]; })()")
                .unwrap(),
            serde_json::json!([true, true, false]),
        );
        assert_eq!(
            page.js.as_mut().unwrap().evaluate("typeof order").unwrap(),
            serde_json::json!("undefined"),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn frame_external_stylesheets_materialize_with_imports_and_rebased_urls() {
        let (origin, requests) = spawn_frame_stylesheet_server();
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-css".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-css".to_string(), context);
        page.navigate(&origin).await.unwrap();

        let (frame_styles, inner_css, print_media) = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().expect("frame host");
                let root = dom.iframe_content_document(host).expect("content doc");
                let styles: Vec<(String, Option<String>)> = dom
                    .query_selector_all_from(root, "style")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|sid| {
                        dom.get_node(*sid)
                            .and_then(|node| {
                                node.get_attribute("data-obscura-materialized")
                                    .map(|_| ())
                            })
                            .is_some()
                    })
                    .map(|sid| {
                        let media = dom
                            .get_node(sid)
                            .and_then(|node| node.get_attribute("media").map(str::to_string));
                        (dom.text_content(sid), media)
                    })
                    .collect();
                let inner_host = dom
                    .query_selector_from(root, "iframe")
                    .unwrap()
                    .expect("inner host");
                let inner_root = dom
                    .iframe_content_document(inner_host)
                    .expect("inner content doc");
                let inner_css: Vec<String> = dom
                    .query_selector_all_from(inner_root, "style")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|sid| dom.text_content(sid))
                    .collect();
                let print_media = styles
                    .iter()
                    .find(|(css, _)| css.contains(".print-only"))
                    .and_then(|(_, media)| media.clone());
                (styles, inner_css, print_media)
            })
            .expect("dom available");

        // Two enabled frame.css links plus the media-gated print.css load;
        // the disabled link stays dormant.
        assert_eq!(frame_styles.len(), 3);
        let frame_css = &frame_styles[0].0;
        // Imported rules precede the importing sheet and relative url()
        // values are rebased onto the sheet's response URL.
        let imp = frame_css.find(".imp{color:red}").expect("imported rule");
        let body_rule = frame_css.find("body{background:").expect("own rule");
        assert!(imp < body_rule);
        assert!(frame_css.contains(&format!("url(\"{origin}/sub/css/img/bg.png\")")));
        assert_eq!(print_media.as_deref(), Some("print"));

        // Nested frame documents get their stylesheets too.
        assert!(inner_css.iter().any(|css| css.contains(".inner{color:blue}")));

        // The same sheet referenced from two links is fetched once.
        let paths: Vec<String> = requests.try_iter().collect();
        assert_eq!(
            paths
                .iter()
                .filter(|path| path.as_str() == "/sub/css/frame.css")
                .count(),
            1
        );
        let frame_id = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                page.frames.by_host(host).unwrap().frame_id.clone()
            })
            .unwrap();
        let stylesheet_event = page
            .network_events
            .iter()
            .find(|event| event.url.ends_with("/sub/css/frame.css"))
            .expect("frame stylesheet network event");
        assert_eq!(stylesheet_event.frame_id.as_deref(), Some(frame_id.as_str()));

        // Frame <img> resources are discovered and warmed through the page
        // transport into the shared render cache.
        #[cfg(feature = "render")]
        assert!(page.js.as_ref().unwrap().render_image_resource_is_known(
            &format!("{origin}/sub/img/pixel.png"),
            obscura_js::ImageRequestProfile::NoCorsInclude,
        ));
    }

    #[test]
    fn navigation_timeout_environment_default_remains_thirty_seconds() {
        assert_eq!(
            navigation_timeout_from_env_value(None),
            std::time::Duration::from_secs(30)
        );
        assert_eq!(
            navigation_timeout_from_env_value(Some("not-a-timeout")),
            std::time::Duration::from_secs(30)
        );
    }

    #[test]
    fn navigation_timeout_environment_override_remains_available() {
        assert_eq!(
            navigation_timeout_from_env_value(Some("42000")),
            std::time::Duration::from_secs(42)
        );
    }

    #[test]
    fn css_resource_discovery_ignores_strings_comments_data_and_fragments() {
        let base = url::Url::parse("https://example.test/css/app/main.css").unwrap();
        let css = r#"
            /* url(ignored.png) */
            .copy::before { content: "url(also-ignored.png)"; }
            @import URL("theme.css") print;
            @import url("semi;colon.css") screen;
            .hero { background: url('../img/hero.png'); }
            .icon { mask: URL("https://cdn.test/icon.svg#shape"); }
            .inline { background: url(data:image/svg+xml,<svg/>); }
            .local { mask: url(#local); }
        "#;
        assert_eq!(
            css_resource_urls(css, &base),
            vec![
                "https://example.test/css/img/hero.png".to_string(),
                "https://cdn.test/icon.svg".to_string(),
            ]
        );
    }

    fn spawn_stylesheet_graph_server(
        expected_requests: usize,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let response_origin = origin.clone();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                request_tx.send(path.clone()).unwrap();
                let (content_type, body) = match path.as_str() {
                    "/" => (
                        "text/html",
                        r#"<!doctype html><html><head>
                            <link rel="stylesheet" href="/css/root.css#first">
                            <link rel="stylesheet" href="/css/root.css#second">
                            <link rel="preload stylesheet" href="/theme/second.css">
                        </head><body></body></html>"#
                            .to_string(),
                    ),
                    "/css/root.css" => (
                        "text/css",
                        "@import '/css/nested/shared.css';@import '/blocked.css';@import '/intercepted.css';.root{background:url('img/root.png')}".to_string(),
                    ),
                    "/theme/second.css" => (
                        "text/css",
                        "@import '../css/nested/shared.css';.second{background:url('img/second.png')}".to_string(),
                    ),
                    "/css/nested/shared.css" => (
                        "text/css",
                        "@import '../root.css';.shared{background:url('../img/shared.png')}".to_string(),
                    ),
                    _ => ("text/plain", "unexpected".to_string()),
                };
                let status = if path == "/blocked.css" || path == "/intercepted.css" {
                    "500 Unexpected Request"
                } else {
                    "200 OK"
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nX-Origin: {response_origin}\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (origin, request_rx)
    }

    fn spawn_inline_import_server() -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            // Five requests are expected after import/image deduplication. Keep
            // two extra accepts alive so a regression's bogus CSS-as-image
            // warmup still reaches the request callback and server cleanly.
            for _ in 0..7 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                request_tx.send(path.clone()).unwrap();
                let (content_type, body) = match path.as_str() {
                    "/" => (
                        "text/html",
                        r#"<!doctype html><style media="screen, print">
                            @import url('/a.css') print;
                            @import '/b.css' print;
                            .local { color: white; background-image: url('/local.svg') }
                        </style><div class="local imported-a imported-b">marker</div>"#,
                    ),
                    "/a.css" => (
                        "text/css",
                        ".imported-a{background:#9020d0 url('/imported.svg')}",
                    ),
                    "/b.css" => ("text/css", ".imported-b{border-color:#f0d020}"),
                    "/local.svg" | "/imported.svg" => (
                        "image/svg+xml",
                        r#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="white"/></svg>"#,
                    ),
                    _ => ("text/plain", "unexpected"),
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (origin, request_rx)
    }

    #[test]
    fn default_navigation_referrer_matches_strict_origin_when_cross_origin() {
        let source = url::Url::parse("https://user:pass@source.example/path?q=1#fragment").unwrap();
        let same_origin = url::Url::parse("https://source.example/next").unwrap();
        let cross_origin = url::Url::parse("https://target.example/next").unwrap();
        let downgrade = url::Url::parse("http://source.example/next").unwrap();

        assert_eq!(
            navigation_referrer(&source, &same_origin),
            "https://source.example/path?q=1"
        );
        assert_eq!(
            navigation_referrer(&source, &cross_origin),
            "https://source.example/"
        );
        assert_eq!(navigation_referrer(&source, &downgrade), "");

        let data_source = url::Url::parse("data:text/html,source").unwrap();
        assert_eq!(navigation_referrer(&data_source, &cross_origin), "");
    }

    #[test]
    fn referrer_policy_reads_meta_and_prefers_response_header() {
        let dom = parse_html(
            "<!doctype html><meta name=referrer content=origin-when-cross-origin>",
        );
        assert_eq!(
            document_referrer_policy(&dom, None),
            obscura_net::ReferrerPolicy::OriginWhenCrossOrigin
        );
        assert_eq!(
            document_referrer_policy(&dom, Some("no-referrer")),
            obscura_net::ReferrerPolicy::NoReferrer
        );
        assert_eq!(
            document_referrer_policy(&dom, Some("invalid, strict-origin")),
            obscura_net::ReferrerPolicy::StrictOrigin
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn document_navigation_referrer_survives_http_redirects() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let request_text = String::from_utf8_lossy(&request[..length]);
                let path = request_text
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/");
                let response = match path {
                    "/source" => {
                        let body = "<script>location.href='/redirect'</script>";
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len(),
                        )
                    }
                    "/redirect" => "HTTP/1.1 302 Found\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                    "/final" => {
                        let body = "<!doctype html><title>final</title>";
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len(),
                        )
                    }
                    _ => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                };
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "referrer-redirect".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("referrer-redirect".to_string(), context);
        let source = format!("http://{address}/source");
        page.navigate(&source).await.unwrap();

        let observed = page
            .js
            .as_mut()
            .unwrap()
            .evaluate("[document.URL, document.referrer]")
            .unwrap();
        assert_eq!(
            observed,
            serde_json::json!([format!("http://{address}/final"), source])
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn top_and_frame_documents_expose_their_last_modified_headers() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let request_text = String::from_utf8_lossy(&request[..length]);
                let path = request_text
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/");
                let (body, modified) = if path == "/frame" {
                    ("<!doctype html><p>frame</p>", "Tue, 15 Nov 1994 12:45:26 GMT")
                } else {
                    ("<!doctype html><iframe src='/frame'></iframe>", "Wed, 21 Oct 2015 07:28:00 GMT")
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nLast-Modified: {modified}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "last-modified".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("last-modified".to_string(), context);
        page.navigate(&format!("http://{address}/")).await.unwrap();

        let observed = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const frame = document.querySelector('iframe').contentDocument;
                    return [
                        Date.parse(document.lastModified),
                        Date.parse(frame.lastModified),
                        Date.parse((new Document()).lastModified)
                            !== Date.parse(document.lastModified),
                    ];
                })()"#,
            )
            .unwrap();
        assert_eq!(
            observed,
            serde_json::json!([1_445_412_480_000u64, 784_903_526_000u64, true])
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn linked_stylesheet_graph_fetches_once_and_preserves_order_and_bases() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let (origin, requests) = spawn_stylesheet_graph_server(4);
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "stylesheet-graph".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("stylesheet-graph".to_string(), context);
        page.set_blocked_urls(vec!["*blocked.css".to_string()]);
        page.intercept_block_patterns = vec!["*intercepted.css".to_string()];
        page.enable_intercept(true);

        let request_count = std::sync::Arc::new(AtomicUsize::new(0));
        let response_count = std::sync::Arc::new(AtomicUsize::new(0));
        let observed_requests = request_count.clone();
        page.on_request(std::sync::Arc::new(move |request| {
            if request.resource_type == obscura_net::ResourceType::Stylesheet {
                observed_requests.fetch_add(1, Ordering::SeqCst);
            }
        }));
        let observed_responses = response_count.clone();
        page.on_response(std::sync::Arc::new(move |request, _| {
            if request.resource_type == obscura_net::ResourceType::Stylesheet {
                observed_responses.fetch_add(1, Ordering::SeqCst);
            }
        }));

        page.navigate(&format!("{origin}/")).await.unwrap();

        let mut paths = (0..4)
            .map(|_| {
                requests
                    .recv_timeout(std::time::Duration::from_secs(1))
                    .unwrap()
            })
            .collect::<Vec<_>>();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "/".to_string(),
                "/css/nested/shared.css".to_string(),
                "/css/root.css".to_string(),
                "/theme/second.css".to_string(),
            ]
        );
        assert_eq!(request_count.load(Ordering::SeqCst), 3);
        assert_eq!(response_count.load(Ordering::SeqCst), 3);
        assert_eq!(
            page.network_events
                .iter()
                .filter(|event| event.resource_type == "Stylesheet")
                .count(),
            3
        );

        let sheets = page
            .js
            .as_ref()
            .unwrap()
            .with_dom(|dom| {
                dom.query_selector_all("style[data-obscura-external-stylesheets]")
                    .unwrap()
                    .into_iter()
                    .map(|nid| dom.text_content(nid))
                    .collect::<Vec<_>>()
            })
            .unwrap();
        assert_eq!(sheets.len(), 3);
        assert_eq!(sheets[0], sheets[1], "duplicate links reuse one download");
        let shared = sheets[0].find(".shared").unwrap();
        let root = sheets[0].find(".root").unwrap();
        assert!(shared < root, "imports precede the importing sheet");
        assert!(sheets[0].contains(&format!("url(\"{origin}/css/img/shared.png\")")));
        assert!(sheets[0].contains(&format!("url(\"{origin}/css/img/root.png\")")));
        let root = sheets[2].find(".root").unwrap();
        let shared = sheets[2].find(".shared").unwrap();
        let second = sheets[2].find(".second").unwrap();
        assert!(
            root < shared && shared < second,
            "cycle is cut without reordering rules"
        );
        assert!(sheets[2].contains(&format!("url(\"{origin}/theme/img/second.png\")")));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn inline_imports_fetch_in_order_and_materialize_before_source_style() {
        let (origin, requests) = spawn_inline_import_server();
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "inline-imports".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("inline-imports".to_string(), context);
        page.set_viewport((100.0, 80.0));
        let observed_requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let callback_requests = observed_requests.clone();
        page.on_request(std::sync::Arc::new(move |request| {
            callback_requests
                .lock()
                .unwrap()
                .push((request.url.path().to_string(), request.resource_type));
        }));
        page.navigate(&format!("{origin}/")).await.unwrap();

        let mut paths = (0..3)
            .map(|_| {
                requests
                    .recv_timeout(std::time::Duration::from_secs(1))
                    .unwrap()
            })
            .collect::<Vec<_>>();
        paths.sort();
        assert_eq!(paths, vec!["/", "/a.css", "/b.css"]);
        let observed_requests = observed_requests.lock().unwrap();
        for path in ["/a.css", "/b.css"] {
            assert_eq!(
                observed_requests
                    .iter()
                    .filter(|(request_path, _)| request_path == path)
                    .map(|(_, resource_type)| *resource_type)
                    .collect::<Vec<_>>(),
                vec![obscura_net::ResourceType::Stylesheet],
                "an inline import must fetch exactly once as a stylesheet"
            );
        }
        #[cfg(feature = "render")]
        {
            for path in ["/local.svg", "/imported.svg"] {
                assert_eq!(
                    observed_requests
                        .iter()
                        .filter(|(request_path, _)| request_path == path)
                        .map(|(_, resource_type)| *resource_type)
                        .collect::<Vec<_>>(),
                    vec![obscura_net::ResourceType::Image],
                    "ordinary rule assets must remain in render warmup"
                );
            }
        }
        drop(observed_requests);

        let styles = page
            .js
            .as_ref()
            .unwrap()
            .with_dom(|dom| {
                dom.query_selector_all("style")
                    .unwrap()
                    .into_iter()
                    .map(|nid| {
                        let node = dom.get_node(nid).unwrap();
                        (
                            node.get_attribute("data-obscura-inline-import").is_some(),
                            node.get_attribute("media").map(str::to_string),
                            dom.text_content(nid),
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap();
        assert_eq!(styles.len(), 3);
        assert!(styles[0].0 && styles[0].2.contains(".imported-a"));
        assert!(styles[1].0 && styles[1].2.contains(".imported-b"));
        assert!(!styles[2].0 && styles[2].2.contains(".local"));
        assert_eq!(styles[0].1.as_deref(), Some("screen, print"));
        assert_eq!(styles[1].1.as_deref(), Some("screen, print"));
        assert!(styles[0].2.starts_with("@media print {\n"));
        assert!(styles[1].2.starts_with("@media print {\n"));

        #[cfg(feature = "render")]
        {
            let pdf = page
                .raster_pdf(crate::RasterPdfOptions {
                    print_background: true,
                    paper_width_in: 100.0 / 72.0,
                    paper_height_in: 80.0 / 72.0,
                    margin_top_in: 0.0,
                    margin_bottom_in: 0.0,
                    margin_left_in: 0.0,
                    margin_right_in: 0.0,
                    ..crate::RasterPdfOptions::default()
                })
                .expect("inline-import print PDF");
            assert!(pdf.starts_with(b"%PDF-1.4"));
        }
    }

    fn client_replacement_page(name: &str, deferred: bool) -> super::Page {
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            name.to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new(name.to_string(), context);
        let server_content = (0..45)
            .map(|index| format!("<p>server content item {index} with enough text</p>"))
            .collect::<String>();
        let start = if deferred {
            "window.addEventListener('mount-client', () => setTimeout(mountClient, 0));"
        } else {
            "mountClient();"
        };
        let html = format!(
            r#"<!doctype html><html><body><main id="ssr">{server_content}</main><script>
                function mountClient() {{
                    document.body.innerHTML = '<button id="client" data-clicks="0">Client view</button>';
                    const button = document.getElementById('client');
                    button.addEventListener('click', () => {{
                        button.setAttribute('data-clicks', String(Number(button.getAttribute('data-clicks')) + 1));
                    }});
                }}
                {start}
            </script></body></html>"#,
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(html);
        page.url =
            Some(url::Url::parse(&format!("data:text/html;base64,{encoded}")).expect("data URL"));
        page
    }

    fn assert_client_replacement_survived(page: &mut super::Page) {
        let state = page
            .js
            .as_mut()
            .expect("page runtime")
            .evaluate(
                r#"
                var clientReplacementCheck = true;
                const button = document.getElementById('client');
                if (button) button.dispatchEvent(new Event('click'));
                return {
                    staleServerContent: !!document.getElementById('ssr'),
                    clientPresent: !!button,
                    clientText: button ? button.textContent : null,
                    clicks: button ? button.getAttribute('data-clicks') : null,
                    bodyElements: document.querySelectorAll('body *').length
                };
                "#,
            )
            .expect("inspect client replacement");
        assert_eq!(
            state,
            serde_json::json!({
                "staleServerContent": false,
                "clientPresent": true,
                "clientText": "Client view",
                "clicks": "1",
                "bodyElements": 1,
            }),
        );
    }

    fn spawn_parser_import_map_server(
        expected_requests: usize,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                request_tx.send(path.clone()).unwrap();
                let (status, body) = match path.as_str() {
                    "/app/before.js" => ("200 OK", "export const value = 'before-first-module';"),
                    "/app/later.js" => ("200 OK", "export const value = 'later-map';"),
                    "/app/async.js" => (
                        "200 OK",
                        "import('too-late')\
                           .then(module => globalThis.__async_before_map = module.value)\
                           .catch(() => globalThis.__async_before_map = 'rejected');",
                    ),
                    _ => ("404 Not Found", "not found"),
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (format!("http://{}", address), request_rx)
    }

    fn spawn_delayed_classic_script_server(
        delay: std::time::Duration,
        body: &'static str,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let length = stream.read(&mut request).unwrap();
            let path = String::from_utf8_lossy(&request[..length])
                .lines()
                .next()
                .and_then(|line| line.split_ascii_whitespace().nth(1))
                .unwrap_or("/")
                .to_string();
            request_tx.send(path).unwrap();
            std::thread::sleep(delay);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (format!("http://{address}"), request_rx)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn performance_timeline_uses_navigation_and_transport_milestones() {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let request_text = String::from_utf8_lossy(&request[..length]);
                let path = request_text
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/");
                let (content_type, body) = if path == "/timed.js" {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    ("application/javascript", "globalThis.timelineScriptLoaded=true")
                } else {
                    ("text/html", "<!doctype html><script src='/timed.js'></script><p>timeline</p>")
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "performance-timeline".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("performance-timeline".to_string(), context);
        page.navigate(&format!("http://{address}/")).await.unwrap();
        let result = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"(() => {
                    const navigation = performance.getEntriesByType('navigation')[0];
                    const resource = performance.getEntriesByName(location.origin + '/timed.js', 'resource')[0];
                    return {
                        navigationCount: performance.getEntriesByType('navigation').length,
                        paintNames: performance.getEntriesByType('paint').map(entry => entry.name),
                        navigationOrdered: navigation.startTime === 0
                            && navigation.responseStart >= navigation.requestStart
                            && navigation.responseEnd >= navigation.responseStart
                            && navigation.loadEventEnd >= navigation.domContentLoadedEventEnd,
                        resourceOrdered: resource.responseStart >= resource.requestStart
                            && resource.responseEnd >= resource.responseStart,
                        resourceDuration: resource.duration,
                        responseStatus: resource.responseStatus,
                        timeOriginAgreement: Math.abs((Date.now() - performance.timeOrigin) - performance.now()),
                        scriptLoaded: globalThis.timelineScriptLoaded === true,
                    };
                })()"#,
            )
            .unwrap();
        assert_eq!(result["navigationCount"], serde_json::json!(1));
        assert_eq!(result["navigationOrdered"], serde_json::json!(true));
        assert_eq!(result["resourceOrdered"], serde_json::json!(true));
        assert_eq!(result["responseStatus"], serde_json::json!(200));
        assert_eq!(result["scriptLoaded"], serde_json::json!(true));
        assert_eq!(
            result["paintNames"],
            serde_json::json!(["first-paint", "first-contentful-paint"]),
        );
        assert!(result["resourceDuration"].as_f64().unwrap() >= 40.0);
        assert!(result["timeOriginAgreement"].as_f64().unwrap() < 25.0);
    }

    fn spawn_script_resource_cache_server(
        distinct: bool,
    ) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read as _, Write as _};
        use std::sync::atomic::Ordering;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let script_requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed_requests = script_requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else {
                    continue;
                };
                let observed_requests = observed_requests.clone();
                std::thread::spawn(move || {
                    let mut request = [0u8; 2048];
                    let length = stream.read(&mut request).unwrap_or(0);
                    let request_text = String::from_utf8_lossy(&request[..length]);
                    let path = request_text
                        .lines()
                        .next()
                        .and_then(|line| line.split_ascii_whitespace().nth(1))
                        .unwrap_or("/");
                    let (content_type, cache_control, body) = if path == "/duplicate.html" {
                        let tags = (0..32)
                            .map(|_| "<script src='/shared.js'></script>")
                            .collect::<String>();
                        (
                            "text/html",
                            "no-store",
                            format!(
                                "<!doctype html><html><body><script>globalThis.__runs=0</script>{tags}</body></html>"
                            ),
                        )
                    } else if path == "/distinct.html" {
                        let tags = (0..24)
                            .map(|index| format!("<script src='/distinct/{index}.js'></script>"))
                            .collect::<String>();
                        (
                            "text/html",
                            "no-store",
                            format!(
                                "<!doctype html><html><body><script>globalThis.__runs=0</script>{tags}</body></html>"
                            ),
                        )
                    } else if path == "/shared.js" || path.starts_with("/distinct/") {
                        observed_requests.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(80));
                        (
                            "application/javascript",
                            "public, max-age=3600",
                            "globalThis.__runs=(globalThis.__runs||0)+1;".to_string(),
                        )
                    } else {
                        ("text/plain", "no-store", "not found".to_string())
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nCache-Control: {cache_control}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len(),
                    );
                    let _ = stream.write_all(response.as_bytes());
                });
            }
        });
        let page = if distinct {
            "distinct.html"
        } else {
            "duplicate.html"
        };
        (format!("http://{address}/{page}"), script_requests)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn duplicate_cacheable_scripts_fetch_once_but_execute_for_each_element() {
        use std::sync::atomic::Ordering;

        let (url, script_requests) = spawn_script_resource_cache_server(false);
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "duplicate-script-cache".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("duplicate-script-cache".to_string(), context);

        page.navigate(&url).await.unwrap();

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__runs")
                .unwrap(),
            serde_json::json!(32.0),
            "a cached response must still execute for every script element",
        );
        assert_eq!(script_requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn distinct_cacheable_scripts_keep_distinct_network_requests() {
        use std::sync::atomic::Ordering;

        let (url, script_requests) = spawn_script_resource_cache_server(true);
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "distinct-script-cache".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("distinct-script-cache".to_string(), context);

        page.navigate(&url).await.unwrap();

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__runs")
                .unwrap(),
            serde_json::json!(24.0),
        );
        assert_eq!(script_requests.load(Ordering::SeqCst), 24);
    }

    #[test]
    fn external_scripts_require_a_successful_http_status() {
        assert!(script_response_is_executable(200));
        assert!(script_response_is_executable(204));
        assert!(script_response_is_executable(299));
        assert!(!script_response_is_executable(0));
        assert!(!script_response_is_executable(304));
        assert!(!script_response_is_executable(401));
        assert!(!script_response_is_executable(404));
        assert!(!script_response_is_executable(500));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn suspend_resume_preserves_document_script_start_state() {
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "script-state-suspend".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("script-state-suspend".to_string(), context);
        page.url = Some(url::Url::parse("http://example.com/suspend.html").unwrap());
        page.dom = Some(parse_html(
            r#"<html><head></head><body data-parser-runs="0" data-dynamic-runs="0" data-inert-runs="0">
            <script id="parser">
              document.body.setAttribute("data-parser-runs", String(Number(document.body.getAttribute("data-parser-runs")) + 1));
            </script>
            </body></html>"#,
        ));
        page.init_js();
        page.execute_scripts().await;

        let before = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"
                var scriptStateSetup = true;
                const dynamic = document.createElement("script");
                dynamic.id = "dynamic";
                dynamic.textContent =
                  'document.body.setAttribute("data-dynamic-runs", String(Number(document.body.getAttribute("data-dynamic-runs")) + 1))';
                document.body.appendChild(dynamic);

                const holder = document.createElement("div");
                holder.innerHTML =
                  '<script id="inert">document.body.setAttribute("data-inert-runs", String(Number(document.body.getAttribute("data-inert-runs")) + 1))<\/script>';
                document.body.appendChild(holder.firstChild);
                return [
                  document.body.getAttribute("data-parser-runs"),
                  document.body.getAttribute("data-dynamic-runs"),
                  document.body.getAttribute("data-inert-runs")
                ];
                "#,
            )
            .unwrap();
        assert_eq!(before, serde_json::json!(["1", "1", "0"]));

        page.suspend_js();
        page.suspend_js();
        page.resume_js();

        let after = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                r#"
                var scriptStateCheck = true;
                for (const id of ["parser", "dynamic", "inert"]) {
                  const script = document.getElementById(id);
                  document.head.appendChild(script);
                  document.body.appendChild(script.cloneNode(true));
                }
                return [
                  document.body.getAttribute("data-parser-runs"),
                  document.body.getAttribute("data-dynamic-runs"),
                  document.body.getAttribute("data-inert-runs")
                ];
                "#,
            )
            .unwrap();
        assert_eq!(after, serde_json::json!(["1", "1", "0"]));
    }

    #[test]
    fn new_document_does_not_inherit_suspended_script_ids() {
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "script-state-navigation".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("script-state-navigation".to_string(), context);
        page.url = Some(url::Url::parse("http://example.com/old.html").unwrap());
        page.dom = Some(parse_html(
            "<html><head></head><body><script id=old></script></body></html>",
        ));
        page.init_js();
        page.js
            .as_mut()
            .unwrap()
            .evaluate(
                "var setup = true; const old = document.getElementById('old'); globalThis.__markParserScripts([old[Symbol.for('obscura.nid')]]); return old[Symbol.for('obscura.nid')];",
            )
            .unwrap();
        page.suspend_js();

        page.url = Some(url::Url::parse("http://example.com/new.html").unwrap());
        page.dom = Some(parse_html(
            "<html><head></head><body data-fresh-runs=0><script id=fresh>document.body.setAttribute('data-fresh-runs', '1')</script></body></html>",
        ));
        page.init_js();
        let result = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                "var check = true; document.head.appendChild(document.getElementById('fresh')); return document.body.getAttribute('data-fresh-runs');",
            )
            .unwrap();
        assert_eq!(result, serde_json::json!("1"));
    }

    fn import_map_test_page(name: &str, base: &str, html: &str) -> super::Page {
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            name.to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new(name.to_string(), context);
        page.url = Some(url::Url::parse(&format!("{}/app/index.html", base)).unwrap());
        page.dom = Some(parse_html(html));
        page.init_js();
        page
    }

    #[tokio::test(flavor = "current_thread")]
    async fn module_graph_and_evaluation_share_one_active_budget() {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let length = stream.read(&mut request).unwrap();
            let path = String::from_utf8_lossy(&request[..length])
                .lines()
                .next()
                .and_then(|line| line.split_ascii_whitespace().nth(1))
                .unwrap_or("/")
                .to_string();
            request_tx.send(path).unwrap();

            // Spend part of the module's allowance loading its graph. The
            // synchronous top-level work then fits in a freshly reset budget,
            // but cannot fit in the shared active load+evaluation budget.
            std::thread::sleep(std::time::Duration::from_millis(100));
            let body = "export const delayed = true;";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let base = format!("http://{address}");
        let mut page = import_map_test_page(
            "shared-module-budget",
            &base,
            r#"<html><head><script type="module">
                import "./delayed.js";
                globalThis.__shared_deadline_started = true;
                const until = Date.now() + 300;
                while (Date.now() < until) {}
                globalThis.__shared_deadline_completed = true;
            </script></head><body></body></html>"#,
        );
        page.execute_scripts_with_module_budget(Some(350)).await;

        assert_eq!(
            request_rx
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/app/delayed.js",
        );
        let state = page
            .js
            .as_mut()
            .unwrap()
            .evaluate(
                "[globalThis.__shared_deadline_started === true, \
                  globalThis.__shared_deadline_completed === true]",
            )
            .unwrap();
        assert_eq!(
            state,
            serde_json::json!([true, false]),
            "evaluation must be terminated at the remaining shared deadline",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn queued_module_does_not_spend_its_budget_waiting_for_deferred_script() {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let path = String::from_utf8_lossy(&request[..length])
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let body = if path.ends_with("deferred.js") {
                    "const until=Date.now()+500;while(Date.now()<until){}"
                } else {
                    "export const ready=true;"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let base = format!("http://{address}");
        let mut page = import_map_test_page(
            "module-queue-budget",
            &base,
            r#"<html><head>
                <script defer src="./deferred.js"></script>
                <script type="module">
                    import { ready } from "./quick.js";
                    globalThis.__queued_module_completed = ready;
                </script>
            </head><body></body></html>"#,
        );
        page.execute_scripts_with_module_budget(Some(300)).await;

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__queued_module_completed === true")
                .unwrap(),
            serde_json::json!(true),
            "queue latency must not consume a module's active-work budget",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn parser_import_map_before_first_module_controls_resolution() {
        let (base, requests) = spawn_parser_import_map_server(1);
        let mut page = import_map_test_page(
            "import-map-order",
            &base,
            r#"<html><head>
            <script type="importmap">{"imports":{"ordered":"./before.js"}}</script>
            <script type="module">
                import { value } from "ordered";
                globalThis.__parser_import_map_value = value;
            </script>
            <script type="importmap">{"imports":{"ordered":"./after.js"}}</script>
        </head><body></body></html>"#,
        );
        page.execute_scripts().await;

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__parser_import_map_value")
                .unwrap(),
            serde_json::json!("before-first-module"),
        );
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/app/before.js"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn later_import_map_adds_unrelated_rule_without_rebinding_resolved_rule() {
        let (base, requests) = spawn_parser_import_map_server(2);
        let mut page = import_map_test_page(
            "multiple-import-map-order",
            &base,
            r#"<html><head>
            <script type="importmap">{"imports":{"fixed":"./before.js"}}</script>
            <script type="module">
                import { value } from "fixed";
                globalThis.__first_map_value = value;
            </script>
            <script type="importmap">{"imports":{"fixed":"./after.js","later":"./later.js"}}</script>
            <script type="module">
                import { value as fixed } from "fixed";
                import { value as later } from "later";
                globalThis.__later_map_values = [fixed, later];
            </script>
        </head><body></body></html>"#,
        );
        page.execute_scripts().await;

        let js = page.js.as_mut().unwrap();
        assert_eq!(
            js.evaluate("globalThis.__first_map_value").unwrap(),
            serde_json::json!("before-first-module")
        );
        assert_eq!(
            js.evaluate("globalThis.__later_map_values").unwrap(),
            serde_json::json!(["before-first-module", "later-map"])
        );
        let paths = (0..2)
            .map(|_| {
                requests
                    .recv_timeout(std::time::Duration::from_secs(1))
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert!(paths.contains(&"/app/before.js".to_string()), "{paths:?}");
        assert!(paths.contains(&"/app/later.js".to_string()), "{paths:?}");
        assert!(!paths.contains(&"/app/after.js".to_string()), "{paths:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn classic_dynamic_import_does_not_see_a_later_parser_import_map() {
        let (base, _requests) = spawn_parser_import_map_server(1);
        let mut page = import_map_test_page(
            "classic-before-import-map",
            &base,
            r#"<html><head>
            <script>
                import("too-late")
                    .then(() => globalThis.__classic_before_map = "resolved")
                    .catch(() => globalThis.__classic_before_map = "rejected");
            </script>
            <script type="importmap">{"imports":{"too-late":"./later.js"}}</script>
        </head><body></body></html>"#,
        );
        page.execute_scripts().await;
        page.settle_for_duration(500).await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__classic_before_map")
                .unwrap(),
            serde_json::json!("rejected"),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn ready_async_classic_script_runs_before_a_later_parser_import_map() {
        let (base, requests) = spawn_parser_import_map_server(2);
        let mut page = import_map_test_page(
            "async-classic-before-map",
            &base,
            r#"<html><head>
            <script async src="./async.js"></script>
            <script type="importmap">{"imports":{"too-late":"./later.js"}}</script>
        </head><body></body></html>"#,
        );
        page.execute_scripts().await;
        page.settle_for_duration(500).await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__async_before_map")
                .unwrap(),
            serde_json::json!("rejected"),
        );
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/app/async.js"
        );
        assert!(requests.try_recv().is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn dynamically_inserted_import_map_controls_later_dynamic_import() {
        let (base, requests) = spawn_parser_import_map_server(1);
        let mut page = import_map_test_page(
            "dynamic-import-map",
            &base,
            r#"<html><head></head><body>
            <script>
                const map = document.createElement("script");
                map.type = "importmap";
                map.textContent = JSON.stringify({imports:{dynamicName:"./later.js"}});
                document.head.appendChild(map);
                import("dynamicName")
                    .then(module => globalThis.__dynamic_map_value = module.value)
                    .catch(error => globalThis.__dynamic_map_value = error.message);
            </script>
        </body></html>"#,
        );
        page.execute_scripts().await;
        page.settle_for_duration(500).await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__dynamic_map_value")
                .unwrap(),
            serde_json::json!("later-map"),
        );
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/app/later.js"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn preload_dynamic_script_delays_load_but_not_dom_content_loaded() {
        let (base, requests) = spawn_delayed_classic_script_server(
            std::time::Duration::from_millis(150),
            "globalThis.__lifecycleOrder.push('dynamic-exec');",
        );
        let html = format!(
            r#"<html><head></head><body><script>
                globalThis.__lifecycleOrder = [];
                document.addEventListener('DOMContentLoaded', () =>
                    globalThis.__lifecycleOrder.push('dom-content-loaded'));
                window.onload = () =>
                    globalThis.__lifecycleOrder.push('window-onload');
                window.addEventListener('load', () =>
                    globalThis.__lifecycleOrder.push('window-load'));
                const script = document.createElement('script');
                script.src = '{base}/preload-dynamic.js';
                script.onload = () => globalThis.__lifecycleOrder.push('script-load');
                document.head.appendChild(script);
            </script></body></html>"#,
        );
        let mut page = import_map_test_page(
            "preload-dynamic-lifecycle",
            "http://127.0.0.1:9",
            &html,
        );

        page.execute_scripts().await;

        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/preload-dynamic.js",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__lifecycleOrder")
                .unwrap(),
            serde_json::json!([
                "dom-content-loaded",
                "dynamic-exec",
                "script-load",
                "window-onload",
                "window-load"
            ]),
            "dynamic async scripts gate load, not DOMContentLoaded",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "globalThis.__lifecycleOrder.filter(value => value === 'window-onload').length",
                )
                .unwrap(),
            serde_json::json!(1.0),
            "window.onload must fire exactly once",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn load_delaying_script_progresses_through_continuously_ready_timer_work() {
        let (base, requests) = spawn_delayed_classic_script_server(
            std::time::Duration::from_millis(75),
            "globalThis.__fairDynamicRan = true;",
        );
        let html = format!(
            r#"<html><head></head><body><script>
                globalThis.__schedulerTicks = 0;
                setInterval(() => globalThis.__schedulerTicks++, 0);
                const script = document.createElement('script');
                script.src = '{base}/fair-dynamic.js';
                script.onload = () => globalThis.__fairDynamicLoaded = true;
                document.head.appendChild(script);
            </script></body></html>"#,
        );
        let mut page = import_map_test_page(
            "load-delayer-scheduler-fairness",
            "http://127.0.0.1:9",
            &html,
        );
        let started = std::time::Instant::now();

        page.execute_scripts().await;

        let elapsed = started.elapsed();
        assert!(
            elapsed < std::time::Duration::from_millis(1500),
            "continuous ready work must not starve a load-delaying fetch; elapsed={elapsed:?}",
        );
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/fair-dynamic.js",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "[globalThis.__fairDynamicRan === true, \
                     globalThis.__fairDynamicLoaded === true, \
                     globalThis.__schedulerTicks > 0]",
                )
                .unwrap(),
            serde_json::json!([true, true, true]),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn load_delaying_script_driver_respects_absolute_deadline() {
        let (base, requests) = spawn_delayed_classic_script_server(
            std::time::Duration::from_secs(1),
            "globalThis.__lateDynamicRan = true;",
        );
        let mut page = import_map_test_page(
            "load-delayer-deadline",
            "http://127.0.0.1:9",
            "<html><head></head><body></body></html>",
        );
        page.js
            .as_mut()
            .unwrap()
            .execute_script(
                "install-load-delayer",
                &format!(
                    "globalThis.__documentReadyState__ = 'loading'; \
                     const script = document.createElement('script'); \
                     script.src = '{base}/slow-dynamic.js'; \
                     document.head.appendChild(script);",
                ),
            )
            .unwrap();
        assert!(page
            .js
            .as_mut()
            .unwrap()
            .has_pending_load_delaying_scripts());
        let started = std::time::Instant::now();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(125);

        let completed = super::Page::drive_load_delaying_scripts(
            page.js.as_mut().unwrap(),
            deadline,
        )
        .await;

        let elapsed = started.elapsed();
        assert!(!completed, "the delayed resource must exceed the deadline");
        assert!(
            elapsed >= std::time::Duration::from_millis(100)
                && elapsed < std::time::Duration::from_millis(500),
            "the driver must honor its absolute wall-clock bound; elapsed={elapsed:?}",
        );
        assert!(page
            .js
            .as_mut()
            .unwrap()
            .has_pending_load_delaying_scripts());
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/slow-dynamic.js",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn post_load_dynamic_script_waits_only_when_caller_requests_settle() {
        let (base, requests) = spawn_delayed_classic_script_server(
            std::time::Duration::from_millis(400),
            "globalThis.__postLoadDynamicRan = true;",
        );
        let html = format!(
            r#"<html><body><script>
                window.addEventListener('load', () => {{
                    const script = document.createElement('script');
                    script.src = '{base}/post-load.js';
                    document.head.appendChild(script);
                }});
            </script></body></html>"#,
        );
        let mut page = import_map_test_page("post-load-dynamic-lifecycle", &base, &html);
        let started = std::time::Instant::now();

        page.execute_scripts().await;

        let navigation_elapsed = started.elapsed();
        assert!(
            navigation_elapsed < std::time::Duration::from_millis(300),
            "post-load enhancement must not extend navigation; elapsed={navigation_elapsed:?}",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "[document.readyState, globalThis.__postLoadDynamicRan === true, \
                     globalThis.__obscura_hasPendingDynamicScripts(), \
                     globalThis.__obscura_hasPendingLoadDelayingScripts()]",
                )
                .unwrap(),
            serde_json::json!(["complete", false, true, false]),
            "a script prepared by load is pending enhancement work, not a load blocker",
        );

        page.settle_for_duration(700).await;

        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/post-load.js",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__postLoadDynamicRan === true")
                .unwrap(),
            serde_json::json!(true),
            "an explicit caller settle must drive post-load script completion",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn timer_hydration_runs_during_explicit_adaptive_settle_not_navigation_load() {
        let mut page = import_map_test_page(
            "timer-hydration-lifecycle",
            "http://example.com",
            r#"<html><body><main id="app">Server shell</main><script>
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        document.getElementById('app').textContent = 'Hydrated app';
                        document.body.setAttribute('data-hydrated', 'true');
                    }, 80);
                });
            </script></body></html>"#,
        );

        page.execute_scripts().await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "[document.readyState, document.body.getAttribute('data-hydrated'), \
                     document.getElementById('app').textContent]",
                )
                .unwrap(),
            serde_json::json!(["complete", null, "Server shell"]),
            "navigation load observes load semantics without inventing a timer settle",
        );

        page.settle(500).await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate(
                    "[document.body.getAttribute('data-hydrated'), \
                     document.getElementById('app').textContent]",
                )
                .unwrap(),
            serde_json::json!(["true", "Hydrated app"]),
            "the automation caller's adaptive settle must retain timer hydration",
        );
    }

    fn spawn_timer_deadline_server() -> std::net::SocketAddr {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let (content_type, body) = if path == "/probe.js" {
                    (
                        "text/javascript",
                        r#"
                            globalThis.__timerDeadlineProbe = { events: [], chain: [] };
                            const started = performance.now();
                            [50, 100].forEach(delay => setTimeout(() => {
                                __timerDeadlineProbe.events.push([delay, performance.now() - started]);
                            }, delay));
                            let count = 0;
                            const chain = () => {
                                __timerDeadlineProbe.chain.push(performance.now() - started);
                                if (++count < 8) setTimeout(chain, 0);
                            };
                            setTimeout(chain, 0);
                        "#,
                    )
                } else {
                    ("text/html", "<!doctype html><script src='/probe.js'></script>")
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        address
    }

    fn timer_deadline_page(address: std::net::SocketAddr) -> super::Page {
        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "timer-deadline-lifecycle".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        super::Page::new(format!("timer-deadline-{address}"), context)
    }

    fn assert_timer_deadline_probe(result: &serde_json::Value) {
        let events = result["events"].as_array().expect("timer event array");
        assert_eq!(events.len(), 2, "both delayed timers must fire: {result}");
        for (event, expected) in events.iter().zip([50.0, 100.0]) {
            let elapsed = event[1].as_f64().expect("timer elapsed");
            assert!(
                elapsed >= expected && elapsed < expected + 35.0,
                "timer {expected}ms crossed a poll boundary at {elapsed}ms: {result}"
            );
        }
        let chain = result["chain"].as_array().expect("nested timer chain");
        assert_eq!(chain.len(), 8, "nested timer chain must complete: {result}");
        assert!(
            chain.last().and_then(|value| value.as_f64()).is_some_and(|elapsed| elapsed < 60.0),
            "an overdue nested timer must not wait for an embedder deadline: {result}"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fixed_settle_delivers_timers_at_their_deadlines_after_navigation() {
        let address = spawn_timer_deadline_server();
        let mut page = timer_deadline_page(address);
        page.navigate(&format!("http://{address}/")).await.unwrap();
        page.settle_for_duration(160).await;

        let result = page
            .js
            .as_mut()
            .unwrap()
            .evaluate("__timerDeadlineProbe")
            .unwrap();
        assert_timer_deadline_probe(&result);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn autonomous_event_loop_delivers_timers_after_a_cancelled_navigation_poll() {
        let address = spawn_timer_deadline_server();
        let mut page = timer_deadline_page(address);
        page.navigate(&format!("http://{address}/")).await.unwrap();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(160);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout_at(deadline, page.run_autonomous_event_loop_turn()).await {
                Ok(Ok(true)) | Err(_) => break,
                Ok(Ok(false)) => tokio::task::yield_now().await,
                Ok(Err(error)) => panic!("autonomous timer pump failed: {error}"),
            }
        }
        let result = page
            .js
            .as_mut()
            .unwrap()
            .evaluate("__timerDeadlineProbe")
            .unwrap();
        assert_timer_deadline_probe(&result);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn lazy_module_graph_is_post_load_work_until_caller_settles() {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let length = stream.read(&mut request).unwrap();
                let request_text = String::from_utf8_lossy(&request[..length]);
                let path = request_text
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/");
                let body = match path {
                    "/app/lazy.js" => {
                        "import { ready } from './lazy-child.js'; export { ready };"
                    }
                    "/app/lazy-child.js" => {
                        // Cross the lifecycle's 500ms fast-settle floor on a
                        // descendant edge. deno_core must propagate the lazy
                        // graph marker beyond its root for this to stay alive.
                        std::thread::sleep(std::time::Duration::from_millis(700));
                        "export const ready = 'lazy-ready';"
                    }
                    unexpected => panic!("unexpected module request: {unexpected}"),
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let base = format!("http://{address}");
        let mut page = import_map_test_page(
            "lazy-module-readiness",
            &base,
            r#"<html><body><script>
                import("./lazy.js").then(module => {
                    document.body.setAttribute("data-lazy-state", module.ready);
                });
            </script></body></html>"#,
        );
        let started = std::time::Instant::now();
        page.execute_scripts().await;

        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "dynamic import() must not become an implicit navigation settle",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("document.body.getAttribute('data-lazy-state')")
                .unwrap(),
            serde_json::Value::Null,
        );

        page.settle_for_duration(1_000).await;

        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("document.body.getAttribute('data-lazy-state')")
                .unwrap(),
            serde_json::json!("lazy-ready"),
            "an explicit caller settle must drive the lazy module graph",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn ordinary_fetch_does_not_extend_dynamic_module_settle() {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (accepted_tx, accepted_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = accepted_tx.send(());
            let mut request = [0u8; 2048];
            let length = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..length])
                .starts_with("GET /app/analytics "));
            std::thread::sleep(std::time::Duration::from_secs(2));
            let body = "{}";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            let _ = stream.write_all(response.as_bytes());
        });

        let base = format!("http://{address}");
        let html = format!(
            r#"<html><body><script>
                globalThis.__analyticsStarted = true;
                fetch("{base}/app/analytics").catch(error => {{
                    globalThis.__analyticsError = error.message;
                }});
            </script></body></html>"#,
        );
        let mut page = import_map_test_page(
            "ordinary-fetch-readiness",
            &base,
            &html,
        );
        let started = std::time::Instant::now();
        page.execute_scripts().await;
        let elapsed = started.elapsed();

        assert!(
            accepted_rx
                .recv_timeout(std::time::Duration::from_millis(100))
                .is_ok(),
            "ordinary fetch fixture must actually start its network request",
        );
        assert!(
            elapsed < std::time::Duration::from_millis(1_500),
            "ordinary fetch/XHR must retain the fast settle path; elapsed={elapsed:?}",
        );
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__analyticsStarted")
                .unwrap(),
            serde_json::json!(true),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn dynamic_import_map_uses_live_document_base_at_insertion() {
        let (base, requests) = spawn_parser_import_map_server(1);
        let mut page = import_map_test_page(
            "dynamic-import-map-base",
            &base,
            r#"<html><head><base href="/old/"></head><body>
            <script>
                document.querySelector("base").setAttribute("href", "/app/");
                const map = document.createElement("script");
                map.type = "importmap";
                map.textContent = JSON.stringify({imports:{liveBase:"./later.js"}});
                document.head.appendChild(map);
                import("liveBase")
                    .then(module => globalThis.__dynamic_map_base = module.value)
                    .catch(error => globalThis.__dynamic_map_base = error.message);
            </script>
        </body></html>"#,
        );
        page.execute_scripts().await;
        page.settle_for_duration(500).await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__dynamic_map_base")
                .unwrap(),
            serde_json::json!("later-map"),
        );
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/app/later.js"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn later_base_element_does_not_rebase_an_earlier_import_map() {
        let (base, requests) = spawn_parser_import_map_server(1);
        let mut page = import_map_test_page(
            "temporal-import-map-base",
            &base,
            r#"<html><head>
            <script type="importmap">{"imports":{"fixed":"./before.js"}}</script>
            <base href="/assets/">
            <script type="module">
                import { value } from "fixed";
                globalThis.__temporal_base_value = value;
            </script>
        </head><body></body></html>"#,
        );
        page.execute_scripts().await;
        assert_eq!(
            page.js
                .as_mut()
                .unwrap()
                .evaluate("globalThis.__temporal_base_value")
                .unwrap(),
            serde_json::json!("before-first-module"),
        );
        assert_eq!(
            requests
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            "/app/before.js"
        );
    }

    #[cfg(feature = "render")]
    #[tokio::test(flavor = "current_thread")]
    async fn page_transport_prefetches_once_and_capture_reuses_the_bytes() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        // A real little HTTP server, because the client is a real HTTP client.
        //
        // The original answered exactly one request and returned. Under load
        // that produced three distinct failures, all of which surfaced as
        // `loaded == 0` -- the request never counted, for three different
        // reasons:
        //
        //   * a single `read` can return a partial header, and closing a
        //     socket that still has unread bytes makes the kernel send RST
        //     rather than FIN;
        //   * hyper may send a second request on the same connection, and a
        //     server that answers once and then only drains fails it with
        //     "received unexpected message from connection";
        //   * a non-blocking `accept` can fail with EINTR on a busy machine,
        //     and `Err(_) => return` dropped the listener on it -- taking the
        //     already-handshaked connection sitting in the backlog with it.
        //     The client saw EOF ("connection closed before message
        //     completed") for a request the server never even accepted, which
        //     is why `requests served` read 0.
        //
        // So: never abandon the listener on a transient accept error, read
        // each request to its end, and answer every request on the connection.
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_server = std::sync::Arc::clone(&stop);
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut served = 0usize;
            let stopping = |stop: &std::sync::atomic::AtomicBool| {
                std::time::Instant::now() >= deadline
                    || stop.load(std::sync::atomic::Ordering::Relaxed)
            };
            while !stopping(&stop_server) {
                let Ok((mut stream, _)) = listener.accept() else {
                    // Every accept error is transient here: WouldBlock is the
                    // normal poll result, and anything else (EINTR) must not
                    // cost us the listener. The loop ends on the deadline or
                    // the stop flag, never on an errno.
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                };
                stream
                    .set_read_timeout(Some(std::time::Duration::from_millis(100)))
                    .unwrap();
                let mut chunk = [0u8; 1024];
                let mut served_here = 0usize;
                loop {
                    let mut request = Vec::new();
                    let complete = loop {
                        if request.windows(4).any(|window| window == b"\r\n\r\n") {
                            break true;
                        }
                        match stream.read(&mut chunk) {
                            Ok(0) => break false,
                            Ok(read) => request.extend_from_slice(&chunk[..read]),
                            Err(error)
                                if matches!(
                                    error.kind(),
                                    std::io::ErrorKind::WouldBlock
                                        | std::io::ErrorKind::TimedOut
                                        | std::io::ErrorKind::Interrupted
                                ) =>
                            {
                                // Nothing buffered on a connection we have
                                // already answered means the client is done
                                // with it. Before the first request it just
                                // means the client has not written yet.
                                if request.is_empty() && served_here > 0 {
                                    break false;
                                }
                                if stopping(&stop_server) {
                                    break false;
                                }
                            }
                            Err(_) => break false,
                        }
                    };
                    if !complete {
                        break;
                    }
                    let _ = seen_tx.send(());
                    served += 1;
                    served_here += 1;
                    let body = br##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#f00"/></svg>"##;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nContent-Length: {}\r\n\r\n",
                        body.len()
                    );
                    if stream.write_all(response.as_bytes()).is_err()
                        || stream.write_all(body).is_err()
                    {
                        break;
                    }
                    let _ = stream.flush();
                }
                // Half-close, then drain, so the final close is a FIN.
                let _ = stream.shutdown(std::net::Shutdown::Write);
                while matches!(stream.read(&mut chunk), Ok(read) if read > 0) {}
            }
            served
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "render-prefetch".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("render-prefetch".to_string(), context);
        page.set_viewport((100.0, 80.0));
        let page_url = format!("http://{address}/page");
        let asset_network_url = format!("http://{address}/asset.svg");
        let asset_url = format!("{asset_network_url}#icon");
        let dom = parse_html(&format!(
            r#"<html><body><img src="{asset_url}" style="width:20px;height:10px"></body></html>"#
        ));
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.set_url(&page_url);
        runtime.set_viewport(100.0, 80.0);
        runtime.run_page_init();
        page.js = Some(runtime);
        page.url = Some(url::Url::parse(&page_url).unwrap());

        let prefetch_started = std::time::Instant::now();
        let loaded = page.prepare_screenshot_resources(1_000).await;
        let prefetch_elapsed = prefetch_started.elapsed();
        let current_src = page
            .js
            .as_mut()
            .unwrap()
            .evaluate("document.querySelector('img').currentSrc")
            .unwrap();
        let prefetch_connection = seen_rx.recv_timeout(std::time::Duration::from_secs(1));
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let served = server.join().unwrap();
        let cached = page.js.as_ref().unwrap().render_image_resource_is_known(
            &asset_network_url,
            obscura_js::ImageRequestProfile::NoCorsInclude,
        );
        let screenshot = page.screenshot(page.viewport);
        assert_eq!(
            loaded, 1,
            "prefetch connection: {prefetch_connection:?}, requests served: \
{served}, prefetch took {prefetch_elapsed:?} of its 1000ms budget",
        );
        assert_eq!(
            current_src,
            serde_json::json!(asset_url),
            "cache/network fragment normalization must not alter currentSrc"
        );
        assert!(cached, "page transport must seed the renderer image cache");
        screenshot.expect("prefetched capture");
        prefetch_connection.expect("prefetch must open one transport connection");
    }

    #[cfg(feature = "render")]
    #[tokio::test(flavor = "current_thread")]
    async fn frame_csp_blocks_render_warmup_resource_prefetch() {
        use std::io::{Read, Write};

        // Disable navigation's two automatic warmup passes so this test can
        // isolate the explicit frame-aware warmup below.
        std::env::set_var("OBSCURA_RENDER_RESOURCE_WARMUP_MS", "0");
        std::env::set_var("OBSCURA_RENDER_RESOURCE_POST_SCRIPT_WARMUP_MS", "0");
        std::env::set_var("OBSCURA_RENDER_RESOURCE_SETTLE_WARMUP_MS", "0");

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for _ in 0..3 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let _ = seen_tx.send(path.clone());
                let (content_type, csp, body): (&str, &str, &[u8]) = match path.as_str() {
                    "/" => (
                        "text/html",
                        "",
                        b"<!doctype html><iframe src='/frame.html'></iframe>",
                    ),
                    "/frame.html" => (
                        "text/html",
                        "img-src 'none'",
                        b"<!doctype html><style>.blocked{background:url('/blocked.svg')}</style><div class=blocked></div><img src='/blocked.svg'>",
                    ),
                    "/blocked.svg" => (
                        "image/svg+xml",
                        "",
                        br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>"#,
                    ),
                    _ => ("text/plain", "", b"missing"),
                };
                let csp_header = if csp.is_empty() {
                    String::new()
                } else {
                    format!("Content-Security-Policy: {csp}\r\n")
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n{csp_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(body);
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "frame-render-csp".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("frame-render-csp".to_string(), context);
        page.set_viewport((100.0, 80.0));
        page.navigate(&format!("http://{address}/")).await.unwrap();
        let frame_csp = page
            .with_dom(|dom| {
                let host = dom.query_selector("iframe").unwrap().unwrap();
                let root = dom.iframe_content_document(host).unwrap();
                dom.document_scope(root).unwrap().csp
            })
            .unwrap();
        assert_eq!(frame_csp.as_deref(), Some("img-src 'none'"));
        let mut before_warmup = Vec::new();
        while let Ok(path) = seen_rx.try_recv() {
            before_warmup.push(path);
        }
        assert!(
            !before_warmup.iter().any(|path| path == "/blocked.svg"),
            "warmup/navigation already fetched blocked image: {before_warmup:?}"
        );
        let _ = page.prepare_screenshot_resources(500).await;

        let mut paths = before_warmup;
        while let Ok(path) = seen_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            paths.push(path);
        }
        assert!(paths.iter().any(|path| path == "/"));
        assert!(paths.iter().any(|path| path == "/frame.html"));
        assert!(!paths.iter().any(|path| path == "/blocked.svg"), "saw {paths:?}");
    }

    #[cfg(feature = "render")]
    #[tokio::test(flavor = "current_thread")]
    async fn render_resource_deadline_does_not_negative_cache_cancelled_requests() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            std::thread::sleep(std::time::Duration::from_millis(100));
            let body = br##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>"##;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(body);
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "render-deadline".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("render-deadline".to_string(), context);
        page.set_viewport((100.0, 80.0));
        let page_url = format!("http://{address}/page");
        let asset_url = format!("http://{address}/slow.svg");
        let dom = parse_html(&format!(
            r#"<html><body><img src="{asset_url}"></body></html>"#
        ));
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.set_url(&page_url);
        runtime.set_viewport(100.0, 80.0);
        runtime.run_page_init();
        page.js = Some(runtime);
        page.url = Some(url::Url::parse(&page_url).unwrap());

        assert_eq!(page.prepare_screenshot_resources(5).await, 0);
        assert!(
            !page
                .js
                .as_ref()
                .unwrap()
                .render_resource_is_known(&asset_url),
            "a deadline-cancelled request must remain retryable"
        );
    }

    #[cfg(feature = "render")]
    #[tokio::test(flavor = "current_thread")]
    async fn navigation_post_script_warmup_seeds_dynamic_images_and_fonts() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let read = stream.read(&mut request).unwrap_or(0);
                let path = String::from_utf8_lossy(&request[..read])
                    .lines()
                    .next()
                    .and_then(|line| line.split_ascii_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                seen_tx.send(path.clone()).unwrap();
                let (content_type, body): (&str, &[u8]) = match path.as_str() {
                    "/page" => (
                        "text/html",
                        br#"<!doctype html><html><head></head><body><script>
                            const image = document.createElement('img');
                            image.src = '/dynamic.svg';
                            document.body.appendChild(image);
                            const style = document.createElement('style');
                            style.textContent = "@font-face{font-family:Dynamic;src:url('/dynamic.woff2')}body{font-family:Dynamic}";
                            document.head.appendChild(style);
                        </script></body></html>"#,
                    ),
                    "/dynamic.svg" => (
                        "image/svg+xml",
                        br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>"#,
                    ),
                    "/dynamic.woff2" => ("font/woff2", b"not-a-real-font"),
                    _ => ("text/plain", b"not found"),
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
                stream.write_all(body).unwrap();
            }
        });

        let context = std::sync::Arc::new(crate::BrowserContext::with_storage_and_network(
            "dynamic-render-warmup".to_string(),
            None,
            false,
            None,
            None,
            true,
        ));
        let mut page = super::Page::new("dynamic-render-warmup".to_string(), context);
        let page_url = format!("http://{address}/page");
        page.navigate(&page_url).await.unwrap();

        let mut paths = (0..3)
            .map(|_| seen_rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap())
            .collect::<Vec<_>>();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "/dynamic.svg".to_string(),
                "/dynamic.woff2".to_string(),
                "/page".to_string(),
            ]
        );
        let js = page.js.as_ref().expect("navigation runtime");
        assert!(js.render_resource_is_known(&format!(
            "http://{address}/dynamic.svg"
        )));
        assert!(js.render_resource_is_known(&format!(
            "http://{address}/dynamic.woff2"
        )));
    }

    #[cfg(feature = "render")]
    #[test]
    fn page_screenshot_uses_the_live_window_scroll_offset() {
        let context = std::sync::Arc::new(crate::BrowserContext::new("scroll-test".to_string()));
        let mut page = super::Page::new("scroll-page".to_string(), context);
        page.set_viewport((100.0, 80.0));

        let dom = parse_html(
            r#"<html style="margin:0"><body style="margin:0">
                <div style="height:80px;background:#ff0000"></div>
                <div id="second" style="height:80px;background:#0000ff"></div>
                <div style="position:fixed;left:0;top:0;width:20px;height:20px;background:#00ff00"></div>
            </body></html>"#,
        );
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.set_url("https://example.test/scroll");
        runtime.set_viewport(100.0, 80.0);
        runtime.run_page_init();
        page.js = Some(runtime);
        page.url = Some(url::Url::parse("https://example.test/scroll").unwrap());

        let before = page.screenshot(page.viewport).expect("top screenshot");
        assert_eq!(
            page.evaluate(
                "return (document.getElementById('second').scrollIntoView(), window.scrollY)"
            )
            .as_f64(),
            Some(80.0)
        );
        let after = page.screenshot(page.viewport).expect("scrolled screenshot");

        assert_ne!(
            before, after,
            "Page screenshot must paint the scrolled viewport"
        );
        assert_eq!(
            page.js.as_ref().expect("runtime").scroll_offset(),
            (0.0, 80.0)
        );
    }

    #[test]
    fn truncate_never_splits_a_multibyte_char() {
        // A caller-supplied expression whose byte 80 lands inside a multi-byte
        // char would make `&expression[..80]` panic; the helper truncates safely.
        let s = format!("{}€tail", "a".repeat(79));
        assert!(!s.is_char_boundary(80), "setup: byte 80 splits the € char");
        let t = truncate_on_char_boundary(&s, 80);
        assert!(s.starts_with(t));
        assert_eq!(t.len(), 79, "should stop right before the € char");
        assert_eq!(truncate_on_char_boundary("short", 80), "short");
    }

    #[test]
    fn parse_import_url_extracts_url_forms() {
        for (source, expected_url) in [
            (" url(\"basic.css\")", "basic.css"),
            (" url(basic.css)", "basic.css"),
            (" \"basic.css\"", "basic.css"),
            (" 'theme.css'", "theme.css"),
            (" URL('x.css')", "x.css"),
        ] {
            assert_eq!(
                parse_import_url(source),
                Some(StylesheetImport {
                    url: expected_url.to_string(),
                    media: None,
                })
            );
        }
    }

    #[test]
    fn parse_import_url_preserves_print_and_color_scheme_media() {
        assert_eq!(
            parse_import_url("url(\"p.css\") print"),
            Some(StylesheetImport {
                url: "p.css".to_string(),
                media: Some("print".to_string()),
            })
        );
        assert_eq!(
            parse_import_url("url(\"d.css\") (prefers-color-scheme: dark)"),
            Some(StylesheetImport {
                url: "d.css".to_string(),
                media: Some("(prefers-color-scheme: dark)".to_string()),
            })
        );
        assert_eq!(
            parse_import_url("url(\"a.css\") print, screen"),
            Some(StylesheetImport {
                url: "a.css".to_string(),
                media: Some("print, screen".to_string()),
            })
        );
    }

    #[test]
    fn split_css_imports_pulls_imports_and_strips_them() {
        let css = "@import url(\"basic.css\");\nbody { color: red; }";
        let (imports, stripped) = split_css_imports(css);
        assert_eq!(
            imports,
            vec![StylesheetImport {
                url: "basic.css".to_string(),
                media: None,
            }]
        );
        assert!(!stripped.contains("@import"));
        assert!(stripped.contains("body { color: red; }"));
    }

    #[test]
    fn split_css_imports_leaves_import_free_css_untouched() {
        let css = "body { color: red; }";
        let (imports, stripped) = split_css_imports(css);
        assert!(imports.is_empty());
        assert_eq!(stripped, css);
    }

    #[test]
    fn materialized_import_graph_retains_print_condition_and_import_base() {
        let root_url = url::Url::parse("https://example.test/css/root.css").unwrap();
        let print_url = root_url.join("print/print.css").unwrap();
        let mut sheets = std::collections::HashMap::new();
        sheets.insert(
            root_url.to_string(),
            LoadedStylesheet {
                response_url: root_url.clone(),
                imports: vec![StylesheetImport {
                    url: "print/print.css".to_string(),
                    media: Some("print".to_string()),
                }],
                rules: ".root{color:red}".to_string(),
            },
        );
        sheets.insert(
            print_url.to_string(),
            LoadedStylesheet {
                response_url: print_url.clone(),
                imports: Vec::new(),
                rules: ".print{background:url(../mark.svg)}".to_string(),
            },
        );
        let aliases = std::collections::HashMap::from([
            (root_url.to_string(), root_url.to_string()),
            (print_url.to_string(), print_url.to_string()),
        ]);
        let materialized = materialize_stylesheet_graph(
            root_url.as_str(),
            &sheets,
            &aliases,
            &mut std::collections::HashSet::new(),
        )
        .expect("materialized graph");

        assert!(materialized.starts_with("@media print {\n"));
        assert!(materialized.contains(
            r#".print{background:url("https://example.test/css/mark.svg")}"#
        ));
        assert!(materialized.ends_with(".root{color:red}"));
    }

    #[test]
    fn stylesheet_asset_urls_keep_the_importing_sheets_base() {
        let base = url::Url::parse("https://example.com/css/theme/app.css").unwrap();
        let css = r#"
            .hero { background:url("../img/hero.png") }
            .icon { mask-image:URL('./icons/mark.svg') }
            .data { background:url("data:image/svg+xml,<svg></svg>") }
            .fragment { mask:url(#shape) }
            .copy::before { content:"url(../not-an-asset.png)" }
            /* url(../not-an-asset-either.png) */
        "#;
        let rebased = rebase_css_urls(css, &base);

        assert!(rebased.contains(r#"url("https://example.com/css/img/hero.png")"#));
        assert!(rebased.contains(r#"url("https://example.com/css/theme/icons/mark.svg")"#));
        assert!(rebased.contains(r#"url("data:image/svg+xml,<svg></svg>")"#));
        assert!(rebased.contains("url(#shape)"));
        assert!(rebased.contains(r#"content:"url(../not-an-asset.png)""#));
        assert!(rebased.contains("/* url(../not-an-asset-either.png) */"));
    }

    #[test]
    fn stylesheet_rel_token_selector_includes_preloaded_stylesheets() {
        let dom = parse_html(
            r#"<link rel="preload stylesheet" href="app.css">
               <link rel="preload" href="font.woff2">"#,
        );
        let links = dom
            .query_selector_all(r#"link[rel~="stylesheet"]"#)
            .expect("valid selector");
        assert_eq!(links.len(), 1);
        assert_eq!(
            dom.get_node(links[0])
                .and_then(|node| node.get_attribute("href").map(str::to_owned)),
            Some("app.css".to_string())
        );
    }

    #[test]
    fn media_gated_stylesheets_are_fetched_but_disabled_sheets_are_not() {
        let dom = parse_html(
            r#"<link rel="stylesheet" href="screen.css">
               <link rel="stylesheet" href="async.css" media="print"
                     onload="this.media='all'">
               <link rel="stylesheet" href="dark.css"
                     media="(prefers-color-scheme: dark)">
               <link rel="stylesheet" href="disabled.css" disabled>"#,
        );

        assert_eq!(
            linked_stylesheet_requests(&dom),
            vec![
                (0, "screen.css".to_string()),
                (1, "async.css".to_string()),
                (2, "dark.css".to_string()),
            ]
        );
    }

    #[test]
    fn print_media_onload_can_activate_a_fetched_stylesheet() {
        let dom = parse_html(
            r#"<html><head>
                <link id="async" rel="stylesheet" href="async.css" media="print"
                      onload="this.media='all';this.setAttribute('data-loaded','yes')">
            </head><body></body></html>"#,
        );
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.run_page_init();
        runtime
            .execute_script(
                "<async-sheet>",
                &materialize_linked_stylesheet_script(0, ".target{color:red}"),
            )
            .expect("load and materialize async linked sheet");

        let state = runtime
            .with_dom(|dom| {
                let link = dom
                    .query_selector("#async")
                    .expect("valid selector")
                    .expect("async link");
                let styles = dom
                    .query_selector_all("style[data-obscura-external-stylesheets]")
                    .expect("valid selector");
                (
                    dom.get_node(link)
                        .and_then(|node| node.get_attribute("data-loaded").map(str::to_owned)),
                    styles.first().map(|&nid| dom.text_content(nid)),
                )
            })
            .expect("live DOM");

        assert_eq!(
            state.0.as_deref(),
            Some("yes"),
            "link load handler must run"
        );
        assert_eq!(
            state.1.as_deref(),
            Some(".target{color:red}"),
            "the handler's `this.media = 'all'` must activate the sheet"
        );
    }

    #[test]
    fn true_print_stylesheet_loads_and_remains_media_gated() {
        let dom = parse_html(
            r#"<html><head>
                <link id="print" rel="stylesheet" href="print.css" media="print"
                      onload="this.setAttribute('data-loaded','yes')">
            </head><body></body></html>"#,
        );
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.run_page_init();
        runtime
            .execute_script(
                "<print-sheet>",
                &materialize_linked_stylesheet_script(0, "body{display:none}"),
            )
            .expect("finish print linked sheet load");

        let state = runtime
            .with_dom(|dom| {
                let link = dom
                    .query_selector("#print")
                    .expect("valid selector")
                    .expect("print link");
                (
                    dom.get_node(link)
                        .and_then(|node| node.get_attribute("data-loaded").map(str::to_owned)),
                    dom.query_selector("style[data-obscura-external-stylesheets]")
                        .expect("valid selector")
                        .and_then(|style| {
                            dom.get_node(style)
                                .and_then(|node| node.get_attribute("media").map(str::to_owned))
                        }),
                )
            })
            .expect("live DOM");

        assert_eq!(
            state.0.as_deref(),
            Some("yes"),
            "print link still fires load"
        );
        assert_eq!(
            state.1.as_deref(),
            Some("print"),
            "the fetched sheet must remain available for PDF print selection"
        );
    }

    #[test]
    fn materialized_linked_stylesheets_expose_link_owned_cssom_with_origin_security() {
        let dom = parse_html(
            r#"<html><head>
                <link id="same" rel="stylesheet" href="/assets/app.css" title="app">
                <style id="inline">.inline { color: green }</style>
                <link id="cross" rel="stylesheet" href="https://cdn.example.test/theme.css">
            </head><body></body></html>"#,
        );
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.set_url("https://example.test/products/widget");
        runtime.run_page_init();
        runtime
            .execute_script(
                "<same-origin-sheet>",
                &materialize_linked_stylesheet_script(
                    0,
                    ".app { color: red } .wide { width: 20px }",
                ),
            )
            .expect("materialize same-origin linked sheet");
        runtime
            .execute_script(
                "<cross-origin-sheet>",
                &materialize_linked_stylesheet_script(1, ".secret { color: purple }"),
            )
            .expect("materialize cross-origin linked sheet");

        let result = runtime
            .evaluate(
                r#"
                (() => {
                    const list = document.styleSheets;
                    const same = document.getElementById('same');
                    const inline = document.getElementById('inline');
                    const cross = document.getElementById('cross');
                    const sameSheet = same.sheet;
                    const sameRules = sameSheet.cssRules;
                    const crossSheet = cross.sheet;
                    const security = [];
                    for (const operation of [
                        () => crossSheet.cssRules,
                        () => crossSheet.rules,
                        () => crossSheet.insertRule('.leak {}', 0),
                        () => crossSheet.deleteRule(0),
                        () => crossSheet.replaceSync('.leak {}'),
                    ]) {
                        try { operation(); security.push('missing'); }
                        catch (error) { security.push(error && error.name); }
                    }
                    sameSheet.insertRule('.added { height: 9px }', sameRules.length);
                    const source = document.querySelector(
                        'style[data-obscura-external-stylesheets]'
                    );
                    return {
                        stableList: list === document.styleSheets,
                        length: list.length,
                        order: [list[0] === sameSheet, list[1] === inline.sheet,
                                list[2] === crossSheet],
                        sameIdentity: same.sheet === sameSheet,
                        owner: sameSheet.ownerNode === same,
                        href: sameSheet.href,
                        title: sameSheet.title,
                        rulesIdentity: sameSheet.cssRules === sameRules,
                        rules: Array.from(sameRules, rule => rule.selectorText),
                        sourceUpdated: source.textContent.includes('.added'),
                        crossOwner: crossSheet.ownerNode === cross,
                        crossHref: crossSheet.href,
                        bridgeSheetsHidden: same.nextSibling.sheet === null
                            && cross.nextSibling.sheet === null,
                        security,
                    };
                })()
                "#,
            )
            .expect("inspect linked stylesheet CSSOM");

        assert_eq!(
            result,
            serde_json::json!({
                "stableList": true,
                "length": 3,
                "order": [true, true, true],
                "sameIdentity": true,
                "owner": true,
                "href": "https://example.test/assets/app.css",
                "title": "app",
                "rulesIdentity": true,
                "rules": [".app", ".wide", ".added"],
                "sourceUpdated": true,
                "crossOwner": true,
                "crossHref": "https://cdn.example.test/theme.css",
                "bridgeSheetsHidden": true,
                "security": ["SecurityError", "SecurityError", "SecurityError",
                             "SecurityError", "SecurityError"],
            })
        );
    }

    #[test]
    fn external_stylesheets_keep_their_positions_between_inline_sheets() {
        let dom = parse_html(
            r#"<html><head>
                <link rel="stylesheet" href="first.css">
                <style data-name="inline">.target{height:20px}</style>
                <link rel="preload stylesheet" href="second.css">
            </head><body></body></html>"#,
        );
        let mut runtime = obscura_js::runtime::ObscuraJsRuntime::new();
        runtime.set_dom(dom);
        runtime.run_page_init();
        runtime
            .execute_script(
                "<first-sheet>",
                &materialize_linked_stylesheet_script(0, ".target{height:10px}"),
            )
            .expect("materialize first linked sheet");
        runtime
            .execute_script(
                "<second-sheet>",
                &materialize_linked_stylesheet_script(1, ".target{height:30px}"),
            )
            .expect("materialize second linked sheet");

        let sheet_text = runtime
            .with_dom(|dom| {
                dom.query_selector_all("style")
                    .expect("valid selector")
                    .into_iter()
                    .map(|nid| dom.text_content(nid))
                    .collect::<Vec<_>>()
            })
            .expect("live DOM");
        assert_eq!(
            sheet_text,
            vec![
                ".target{height:10px}",
                ".target{height:20px}",
                ".target{height:30px}",
            ]
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn parser_script_body_replacement_survives_navigation() {
        let mut page = client_replacement_page("parser-client-replacement", false);
        let target = page.url_string();

        page.navigate(&target)
            .await
            .expect("navigate replacement page");

        assert_client_replacement_survived(&mut page);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn timer_body_replacement_survives_settle() {
        let mut page = client_replacement_page("timer-client-replacement", true);
        let target = page.url_string();
        page.navigate(&target)
            .await
            .expect("navigate deferred replacement page");

        let before_timer = page
            .js
            .as_mut()
            .expect("page runtime")
            .evaluate(
                "var scheduleClientReplacement = true; window.dispatchEvent(new Event('mount-client')); return !!document.getElementById('ssr');",
            )
            .expect("schedule client replacement");
        assert_eq!(before_timer, serde_json::json!(true));

        page.settle(100).await;

        assert_client_replacement_survived(&mut page);
    }

    #[cfg(feature = "render")]
    #[test]
    fn settle_resource_warmup_uses_only_remaining_absolute_budget() {
        assert_eq!(
            remaining_settle_resource_warmup_ms(
                1_000,
                std::time::Duration::from_millis(250),
                1_000,
            ),
            750
        );
        assert_eq!(
            remaining_settle_resource_warmup_ms(
                1_000,
                std::time::Duration::from_millis(250),
                100,
            ),
            100
        );
        assert_eq!(
            remaining_settle_resource_warmup_ms(
                1_000,
                std::time::Duration::from_micros(999_500),
                1_000,
            ),
            0,
            "a sub-millisecond remainder cannot safely fund a millisecond timeout"
        );
        assert_eq!(
            remaining_settle_resource_warmup_ms(
                1_000,
                std::time::Duration::from_millis(1_001),
                1_000,
            ),
            0
        );
    }

    #[test]
    fn url_matches_cdp_pattern_handles_wildcards_across_url_parts() {
        assert!(url_matches_cdp_pattern(
            "*://*.gstatic.com/*.woff2",
            "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTcviYwYZ8UA3.woff2",
        ));
        assert!(url_matches_cdp_pattern(
            "*://*.google.com/maps/vt/*",
            "https://www.google.com/maps/vt/pb=!1m4!1m3",
        ));
        assert!(url_matches_cdp_pattern(
            "https://example.com/assets/*",
            "https://example.com/assets/app.js",
        ));
        assert!(!url_matches_cdp_pattern(
            "https://example.com/assets/*",
            "https://cdn.example.com/assets/app.js",
        ));
        assert!(!url_matches_cdp_pattern(
            "*://*.gstatic.com/*.woff2",
            "https://fonts.gstatic.com/s/inter/v18/font.woff",
        ));
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PageError {
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Too many redirects (limit {0})")]
    TooManyRedirects(usize),
}

impl From<ObscuraNetError> for PageError {
    fn from(e: ObscuraNetError) -> Self {
        PageError::NetworkError(e.to_string())
    }
}

/// Whether a Content-Type is text-like and can be stored/returned as a UTF-8
/// string. Everything else (images, PDF, fonts, octet-stream) is binary and must
/// be base64-encoded so Network.getResponseBody returns intact bytes.
fn response_grants_cross_origin_isolation(response: &obscura_net::Response) -> bool {
    let trustworthy = response.url.scheme() == "https"
        || response.url.scheme() == "wss"
        || response.url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host.ends_with(".localhost")
                || host == "::1"
                || host.starts_with("127.")
        });
    if !trustworthy {
        return false;
    }
    let token = |name: &str| {
        response
            .header(name)
            .and_then(|value| value.split(';').next())
            .map(str::trim)
            .map(str::to_ascii_lowercase)
    };
    if token("cross-origin-opener-policy").as_deref() != Some("same-origin") {
        return false;
    }
    if !matches!(
        token("cross-origin-embedder-policy").as_deref(),
        Some("require-corp" | "credentialless")
    ) {
        return false;
    }
    !response
        .header("permissions-policy")
        .map(|value| value.to_ascii_lowercase().replace(' ', ""))
        .is_some_and(|value| value.split(',').any(|entry| {
            entry == "cross-origin-isolated=()"
        }))
}

fn frame_response_grants_cross_origin_isolation(
    response: &obscura_net::Response,
    response_origin: &obscura_dom::Origin,
    parent_origin: &obscura_dom::Origin,
    parent_cross_origin_isolated: bool,
) -> bool {
    parent_cross_origin_isolated
        && response_origin == parent_origin
        && response_grants_cross_origin_isolation(response)
}

fn iframe_allows_cross_origin_isolated(value: &str) -> bool {
    value.split(';').any(|directive| {
        directive
            .split_whitespace()
            .next()
            .is_some_and(|feature| feature.eq_ignore_ascii_case("cross-origin-isolated"))
    })
}

fn frame_document_isolation(
    response: &obscura_net::Response,
    response_origin: &obscura_dom::Origin,
    parent_origin: &obscura_dom::Origin,
    parent_cross_origin_isolated: bool,
    allow_cross_origin_isolated: bool,
    sandbox: obscura_dom::SandboxFlags,
) -> bool {
    let own_isolation = frame_response_grants_cross_origin_isolation(
        response,
        response_origin,
        parent_origin,
        parent_cross_origin_isolated,
    );
    let delegated_isolation = allow_cross_origin_isolated
        && parent_cross_origin_isolated
        && response_grants_cross_origin_isolation(response);
    (own_isolation || delegated_isolation)
        && (!sandbox.active
            || sandbox.allows(obscura_dom::SandboxFlags::ALLOW_SAME_ORIGIN))
}

fn is_text_like_content_type(content_type: Option<&str>) -> bool {
    let ct = match content_type {
        Some(c) => c.split(';').next().unwrap_or(c).trim().to_ascii_lowercase(),
        // No Content-Type: assume text (matches the HTML-parse default).
        None => return true,
    };
    if ct.is_empty() {
        return true;
    }
    ct.starts_with("text/")
        || ct == "application/json"
        || ct == "application/xml"
        || ct == "application/xhtml+xml"
        || ct == "application/javascript"
        || ct == "application/ecmascript"
        || ct == "image/svg+xml"
        || ct.ends_with("+json")
        || ct.ends_with("+xml")
}

fn response_body_entry_limit() -> usize {
    std::env::var("OBSCURA_NETWORK_BODY_BUFFER_ENTRIES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(128)
}

fn response_body_byte_limit() -> usize {
    std::env::var("OBSCURA_NETWORK_BODY_BUFFER_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2 * 1024 * 1024)
}
