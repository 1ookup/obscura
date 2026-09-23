//! Chrome's outbound header order and set.
//!
//! Header *order* is part of the HTTP client fingerprint (Cloudflare's JA4H
//! carries it), and the previous build sites emitted the caller-supplied block
//! by iterating a `HashMap`. `std::collections::HashMap` seeds its hasher per
//! map, so two byte-identical requests left the process with two different
//! header orders: a scripted fetch put `origin` before `sec-fetch-site` on one
//! request and after it on the next. Real Chrome is deterministic, so a
//! shuffled order is itself the tell, independent of which names are present.
//!
//! The tables below are measured, not inferred. `obscura serve --stealth` and
//! headless Chrome 153.0.8010.48 were each driven over CDP against a loopback
//! endpoint that logs header names in wire order, over HTTP/2 and HTTP/1.1,
//! for a top-level navigation and for a page `fetch()`; each cell was repeated
//! and reproduced. `http::HeaderMap` iterates in insertion order and both the
//! h1 and h2 encoders preserve it, so replaying a table in order is enough to
//! fix the wire order.
//!
//! Two shapes, because Chrome does not use one order:
//!
//! * [`NAVIGATION_ORDER`] - the top-level document request. Client hints come
//!   last of the `Sec-CH-UA` trio, `Upgrade-Insecure-Requests` and
//!   `Sec-Fetch-User` are present.
//! * [`SUBRESOURCE_ORDER`] - scripted fetch/XHR, images, favicons, scripts.
//!   `Sec-CH-UA-Platform` leads, the trio is interleaved differently, and the
//!   navigation-only headers are absent.
//!
//! `Priority` is on both: Chrome sends it over HTTP/2, which is the transport
//! the challenge is reached on. It is also sent over HTTP/1.1 here, where
//! Chrome omits it; the transport is chosen after the headers are built, so
//! the h2 shape is the one worth matching.

use std::collections::{HashMap, HashSet};

use url::Url;

use crate::client::{
    client_hint_value, request_fetch_site, request_referrer, RequestMode, ResourceRequest,
};
use crate::fingerprint::BrowserFingerprint;

/// Chrome orders a top-level navigation and a subresource differently.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ChromeRequestShape {
    Navigation,
    Subresource,
}

/// Chrome's wire order for a top-level document navigation, measured over
/// HTTP/2 against a `Page.navigate` (a GET) and against a form submission (a
/// POST). The two share this table: `content-length`, `cache-control`,
/// `content-type` and `origin` are on the POST only, and where they appear is
/// exactly where the POST measurement put them. On the GET they are absent, so
/// the same table yields the GET order Chrome sent.
///
/// `referer` is absent from both measurements because neither driving
/// navigation carried one; its slot is the one Chrome uses on the subresource
/// shape, which is the only place it could be observed.
pub(crate) const NAVIGATION_ORDER: &[&str] = &[
    "content-length",
    "cache-control",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "upgrade-insecure-requests",
    "content-type",
    "user-agent",
    "origin",
    "accept",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-user",
    "sec-fetch-dest",
    "referer",
    "accept-encoding",
    "accept-language",
    "cookie",
    "priority",
];

/// Chrome's wire order for a subresource (scripted fetch/XHR, image, script).
///
/// `content-length` really does come before the client hints and
/// `content-type` really does land between `sec-ch-ua` and
/// `sec-ch-ua-mobile`: that interleaving was reproduced across `fetch`,
/// `XMLHttpRequest`, an explicit `Content-Type`, a `URLSearchParams` body and
/// a five-fold repeat, and is Chromium's own insertion order for a request
/// with a body. A control client that sent a deliberately scrambled POST
/// through the same endpoint came back with its order intact, so it is not an
/// artifact of the observatory.
pub(crate) const SUBRESOURCE_ORDER: &[&str] = &[
    "content-length",
    "sec-ch-ua-platform",
    "user-agent",
    "sec-ch-ua",
    "content-type",
    "sec-ch-ua-mobile",
    "accept",
    "origin",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "sec-fetch-storage-access",
    "referer",
    "accept-encoding",
    "accept-language",
    "cookie",
    "priority",
];

pub(crate) fn order_for(shape: ChromeRequestShape) -> &'static [&'static str] {
    match shape {
        ChromeRequestShape::Navigation => NAVIGATION_ORDER,
        ChromeRequestShape::Subresource => SUBRESOURCE_ORDER,
    }
}

/// Everything the ordered build needs that is not derivable from the request
/// alone. The caller resolves cookies, `Origin`, `Referer` and the body length
/// because those decisions live in each transport's own redirect/CORS loop.
pub(crate) struct ChromeHeaderPlan<'a> {
    pub fingerprint: &'a BrowserFingerprint,
    /// The request profile, when the caller has one. A scripted fetch/XHR
    /// supplies its Fetch metadata through `caller` instead, so the derived
    /// entries fall back to that map.
    pub request: Option<&'a ResourceRequest>,
    pub current_url: &'a Url,
    pub shape: ChromeRequestShape,
    /// `Some` when the wire method makes `Origin` applicable.
    pub origin: Option<&'a str>,
    /// `Priority` value, when the transport knows the request shape directly
    /// rather than deriving it from a `ResourceRequest`.
    pub priority: &'static str,
    /// Body length, when the request carries one. Chrome puts
    /// `content-length` first on the subresource shape; the transport would
    /// otherwise append it last, which is not where a browser puts it.
    pub body_len: Option<usize>,
    /// True when the frame document is an iframe, which drops `Sec-Fetch-User`.
    pub is_frame_navigation: bool,
    /// Client defaults merged over the per-request headers, lowercased. A name
    /// present here keeps Chrome's slot but takes the caller's value, which is
    /// what Chrome does with an explicitly set `Accept` or `Content-Type`.
    pub caller: &'a HashMap<String, String>,
    /// High-entropy client hints the origin asked for through `Accept-CH`.
    /// Detached from the origin's hint set rather than borrowed from it, so no
    /// read lock is held across the send.
    pub accepted_hints: &'a [String],
    /// Whether this request carries credentials to `current_url`.
    pub sends_credentials: bool,
}

/// Chrome's wire header list for `plan`, in order.
///
/// No name is emitted twice: a caller-supplied value replaces the browser
/// default in Chrome's own slot rather than being appended. Names the caller
/// supplied that Chrome has no slot for are appended afterwards in sorted
/// order, which keeps them deterministic; Chrome's own placement of those
/// moves between requests on one connection, so there is no fixed slot to
/// match.
pub(crate) fn build_chrome_headers(plan: &ChromeHeaderPlan<'_>) -> Vec<(String, String)> {
    let fingerprint = plan.fingerprint;
    let mut out: Vec<(String, String)> = Vec::with_capacity(order_for(plan.shape).len() + 4);
    let mut emitted: HashSet<&'static str> = HashSet::new();

    // Whether the high-entropy hints have been placed yet. They follow the
    // low-entropy trio, which sits at a different offset in each shape.
    let hints_after = match plan.shape {
        ChromeRequestShape::Navigation => "sec-ch-ua-platform",
        ChromeRequestShape::Subresource => "sec-ch-ua-mobile",
    };

    for name in order_for(plan.shape) {
        let value = plan
            .caller
            .get(*name)
            .cloned()
            .or_else(|| browser_default(plan, name));
        if let Some(value) = value {
            out.push(((*name).to_string(), value));
            emitted.insert(*name);
        }
        if *name == hints_after {
            // Sorted here rather than at the call sites so no caller can
            // reintroduce a shuffle. The set these come from used to be
            // iterated directly, which put them on the wire in hash order.
            let mut hints: Vec<&String> = plan
                .accepted_hints
                .iter()
                .filter(|hint| !emitted.contains(hint.as_str()))
                .collect();
            hints.sort();
            for hint in hints {
                if emitted.contains(hint.as_str()) {
                    continue;
                }
                if let Some(value) = client_hint_value(hint, fingerprint) {
                    out.push((hint.clone(), value));
                }
            }
        }
    }

    let mut rest = plan
        .caller
        .iter()
        .filter(|(name, _)| !emitted.contains(name.as_str()))
        .filter(|(name, _)| !plan.accepted_hints.iter().any(|hint| hint == *name))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect::<Vec<_>>();
    rest.sort();
    out.extend(rest);
    out
}

/// The browser-owned value for `name`, or `None` when the request shape does
/// not carry that header at all.
fn browser_default(plan: &ChromeHeaderPlan<'_>, name: &str) -> Option<String> {
    let fingerprint = plan.fingerprint;
    let request = plan.request;
    match name {
        "user-agent" => (!fingerprint.user_agent.is_empty())
            .then(|| fingerprint.user_agent.clone()),
        "accept" => request.map(|request| request.accept().to_string()),
        "accept-language" => Some(fingerprint.accept_language()),
        "accept-encoding" => Some("gzip, deflate, br, zstd".to_string()),
        "priority" => Some(plan.priority.to_string()),
        "sec-fetch-site" => request
            .map(|request| request_fetch_site(request, plan.current_url).to_string()),
        "sec-fetch-mode" => request.map(|request| request.mode.header_value().to_string()),
        "sec-fetch-dest" => request.map(|request| request.destination().to_string()),
        "referer" => request.and_then(|request| request_referrer(request, plan.current_url)),
        "origin" => plan.origin.map(ToString::to_string),
        "sec-ch-ua" if !fingerprint.brands.is_empty() => Some(fingerprint.sec_ch_ua()),
        "sec-ch-ua-mobile" if !fingerprint.brands.is_empty() => {
            Some(fingerprint.sec_ch_ua_mobile().to_string())
        }
        "sec-ch-ua-platform" if !fingerprint.brands.is_empty() => {
            Some(fingerprint.sec_ch_ua_platform())
        }
        // Navigation only. Chrome sends `Upgrade-Insecure-Requests` on a
        // navigation, and only when the destination is not already secure or
        // potentially trustworthy; the navigations this client performs to the
        // challenge are https, but the header is a property of the request
        // shape here, so it is emitted with the shape.
        "upgrade-insecure-requests" if plan.shape == ChromeRequestShape::Navigation => {
            Some("1".to_string())
        }
        // A frame navigation carries `Sec-Fetch-Dest: iframe` and no
        // `Sec-Fetch-User`.
        "sec-fetch-user"
            if plan.shape == ChromeRequestShape::Navigation && !plan.is_frame_navigation =>
        {
            Some("?1".to_string())
        }
        // Measured on Chrome 153: present exactly when the request is
        // cross-site and carries credentials, and `active` in every such case
        // (first-party document, cookies present or not). Same-origin and
        // cross-site-without-credentials requests omit it.
        "sec-fetch-storage-access" if plan.sends_credentials && fetch_site_is_cross_site(plan) => {
            Some("active".to_string())
        }
        "content-length" => plan.body_len.map(|len| len.to_string()),
        // `Content-Type` is only ever caller-supplied; there is no browser
        // default for a scripted request.
        _ => None,
    }
}

/// `Sec-Fetch-Site` as it will go on the wire: the caller's value wins,
/// because a scripted fetch/XHR classifies its own initiator.
fn fetch_site_is_cross_site(plan: &ChromeHeaderPlan<'_>) -> bool {
    match plan.caller.get("sec-fetch-site") {
        Some(value) => value.eq_ignore_ascii_case("cross-site"),
        None => plan
            .request
            .is_some_and(|request| request_fetch_site(request, plan.current_url) == "cross-site"),
    }
}

/// The shape a request maps to. A navigation is a top-level or frame document;
/// everything else is a subresource.
pub(crate) fn shape_for(request: &ResourceRequest) -> ChromeRequestShape {
    if request.mode == RequestMode::Navigate {
        ChromeRequestShape::Navigation
    } else {
        ChromeRequestShape::Subresource
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ResourceType;

    fn fingerprint() -> BrowserFingerprint {
        BrowserFingerprint::from_user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
        )
    }

    fn names(pairs: &[(String, String)]) -> Vec<String> {
        pairs.iter().map(|(name, _)| name.clone()).collect()
    }

    fn value<'a>(pairs: &'a [(String, String)], name: &str) -> Option<&'a str> {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// A plan with every default, no caller headers, no accepted hints.
    fn plan<'a>(
        fingerprint: &'a BrowserFingerprint,
        request: &'a ResourceRequest,
        current_url: &'a Url,
        shape: ChromeRequestShape,
        caller: &'a HashMap<String, String>,
        accepted_hints: &'a [String],
    ) -> ChromeHeaderPlan<'a> {
        ChromeHeaderPlan {
            fingerprint,
            request: Some(request),
            current_url,
            shape,
            origin: None,
            priority: "u=0, i",
            body_len: None,
            is_frame_navigation: false,
            caller,
            accepted_hints,
            sends_credentials: true,
        }
    }

    // The order Chrome 153.0.8010.48 actually put on the wire for a top-level
    // https navigation over HTTP/2, measured against a loopback echo endpoint.
    // Chrome's own ordering is the contract; this list is the regression pin.
    #[test]
    fn navigation_header_order_matches_chrome_h2() {
        let fingerprint = fingerprint();
        let url = Url::parse("https://example.com/").unwrap();
        let request = ResourceRequest::navigation();
        let caller = HashMap::new();
        let plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Navigation,
            &caller,
            &[],
        );

        assert_eq!(
            names(&build_chrome_headers(&plan)),
            vec![
                "sec-ch-ua",
                "sec-ch-ua-mobile",
                "sec-ch-ua-platform",
                "upgrade-insecure-requests",
                "user-agent",
                "accept",
                "sec-fetch-site",
                "sec-fetch-mode",
                "sec-fetch-user",
                "sec-fetch-dest",
                "accept-encoding",
                "accept-language",
                "priority",
            ],
        );
        assert_eq!(value(&build_chrome_headers(&plan), "sec-fetch-mode"), Some("navigate"));
        assert_eq!(value(&build_chrome_headers(&plan), "sec-fetch-dest"), Some("document"));
        assert_eq!(value(&build_chrome_headers(&plan), "sec-fetch-user"), Some("?1"));
    }

    // The subresource shape, as Chrome 153 put it on the wire for a page
    // `fetch()` to a cross-site origin with credentials. `content-length` is
    // absent because this request carries no body.
    #[test]
    fn scripted_fetch_header_order_matches_chrome_h2() {
        let fingerprint = fingerprint();
        let initiator = Url::parse("https://example.com/").unwrap();
        let url = Url::parse("https://challenges.cloudflare.com/x").unwrap();
        let request = ResourceRequest::subresource(ResourceType::Fetch, &initiator);
        let caller = HashMap::new();
        let mut plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Subresource,
            &caller,
            &[],
        );
        plan.origin = Some("https://example.com");
        plan.sends_credentials = true;

        assert_eq!(
            names(&build_chrome_headers(&plan)),
            vec![
                "sec-ch-ua-platform",
                "user-agent",
                "sec-ch-ua",
                "sec-ch-ua-mobile",
                "accept",
                "origin",
                "sec-fetch-site",
                "sec-fetch-mode",
                "sec-fetch-dest",
                "sec-fetch-storage-access",
                "referer",
                "accept-encoding",
                "accept-language",
                "priority",
            ],
        );
    }

    // A body moves `content-length` to the front and `content-type` between the
    // two client-hint groups, which is where Chromium puts them and where no
    // hand-rolled list would guess.
    #[test]
    fn a_body_puts_content_length_first_and_content_type_in_chromes_slot() {
        let fingerprint = fingerprint();
        let initiator = Url::parse("https://example.com/").unwrap();
        let url = Url::parse("https://example.com/cdn-cgi/challenge-platform/x").unwrap();
        let request = ResourceRequest::subresource(ResourceType::Fetch, &initiator);
        let mut caller = HashMap::new();
        caller.insert("content-type".to_string(), "text/plain;charset=UTF-8".to_string());
        let mut plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Subresource,
            &caller,
            &[],
        );
        plan.body_len = Some(5);

        assert_eq!(
            names(&build_chrome_headers(&plan))[..5],
            [
                "content-length",
                "sec-ch-ua-platform",
                "user-agent",
                "sec-ch-ua",
                "content-type"
            ],
        );
        assert_eq!(value(&build_chrome_headers(&plan), "content-length"), Some("5"));
    }

    // A form-submission navigation is the same shape as a GET navigation with
    // four extra headers, and Chrome puts all four in different places: the
    // body length first, `cache-control` next, `content-type` after
    // `upgrade-insecure-requests`, and `origin` after `user-agent`. Measured
    // on Chrome 153.0.8010.48 with a real form submission.
    #[test]
    fn a_form_submission_navigation_matches_chrome_h2() {
        let fingerprint = fingerprint();
        let initiator = Url::parse("http://localhost:8080/form").unwrap();
        let url = Url::parse("https://127.0.0.1:9443/formpost").unwrap();
        let mut request = ResourceRequest::navigation();
        request.initiator = Some(initiator);
        let mut caller = HashMap::new();
        caller.insert("origin".to_string(), "http://localhost:8080".to_string());
        caller.insert(
            "content-type".to_string(),
            "application/x-www-form-urlencoded".to_string(),
        );
        caller.insert("cache-control".to_string(), "max-age=0".to_string());
        let mut plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Navigation,
            &caller,
            &[],
        );
        plan.body_len = Some(3);

        assert_eq!(
            names(&build_chrome_headers(&plan)),
            vec![
                "content-length",
                "cache-control",
                "sec-ch-ua",
                "sec-ch-ua-mobile",
                "sec-ch-ua-platform",
                "upgrade-insecure-requests",
                "content-type",
                "user-agent",
                "origin",
                "accept",
                "sec-fetch-site",
                "sec-fetch-mode",
                "sec-fetch-user",
                "sec-fetch-dest",
                "referer",
                "accept-encoding",
                "accept-language",
                "priority",
            ],
        );
    }

    // The bug this module exists for: the caller maps used to be replayed by
    // iterating them, and HashMap iteration order is seeded per map. Two maps
    // with identical contents built in different insertion orders must produce
    // the same wire order.
    #[test]
    fn caller_map_iteration_order_cannot_reach_the_wire() {
        let fingerprint = fingerprint();
        let initiator = Url::parse("https://example.com/").unwrap();
        let url = Url::parse("https://challenges.cloudflare.com/x").unwrap();
        let request = ResourceRequest::subresource(ResourceType::Fetch, &initiator);

        let mut forwards = HashMap::new();
        forwards.insert("x-first".to_string(), "1".to_string());
        forwards.insert("origin".to_string(), "https://example.com".to_string());
        forwards.insert("x-second".to_string(), "2".to_string());

        let mut backwards = HashMap::new();
        backwards.insert("x-second".to_string(), "2".to_string());
        backwards.insert("x-first".to_string(), "1".to_string());
        backwards.insert("origin".to_string(), "https://example.com".to_string());

        let first = build_chrome_headers(&plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Subresource,
            &forwards,
            &[],
        ));
        let second = build_chrome_headers(&plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Subresource,
            &backwards,
            &[],
        ));
        assert_eq!(first, second);
    }

    // An explicitly set `Accept` keeps Chrome's slot with the caller's value.
    // Appending it instead would put a second `accept` on the wire.
    #[test]
    fn a_caller_header_replaces_the_default_in_chromes_slot() {
        let fingerprint = fingerprint();
        let url = Url::parse("https://example.com/").unwrap();
        let request = ResourceRequest::navigation();
        let mut caller = HashMap::new();
        caller.insert("accept".to_string(), "application/json".to_string());
        let plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Navigation,
            &caller,
            &[],
        );
        let built = build_chrome_headers(&plan);

        assert_eq!(built.iter().filter(|(name, _)| name == "accept").count(), 1);
        assert_eq!(value(&built, "accept"), Some("application/json"));
        assert_eq!(
            names(&built)[..4],
            ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "upgrade-insecure-requests"],
        );
    }

    // `Sec-Fetch-Storage-Access: active` is present exactly when the request is
    // cross-site and carries credentials; Chrome sent it on a first-party page
    // with and without a cookie, and omitted it same-origin and on a
    // cross-site request with no credentials.
    #[test]
    fn storage_access_follows_chrome_cross_site_and_credentials_rule() {
        let fingerprint = fingerprint();
        let initiator = Url::parse("https://example.com/").unwrap();
        let cross_site = Url::parse("https://challenges.cloudflare.com/x").unwrap();
        let same_origin = Url::parse("https://example.com/x").unwrap();
        let request = ResourceRequest::subresource(ResourceType::Fetch, &initiator);
        let caller = HashMap::new();

        let mut cross = plan(
            &fingerprint,
            &request,
            &cross_site,
            ChromeRequestShape::Subresource,
            &caller,
            &[],
        );
        cross.sends_credentials = true;
        assert_eq!(
            value(&build_chrome_headers(&cross), "sec-fetch-storage-access"),
            Some("active"),
        );

        cross.sends_credentials = false;
        assert_eq!(
            value(&build_chrome_headers(&cross), "sec-fetch-storage-access"),
            None,
        );

        let mut same = plan(
            &fingerprint,
            &request,
            &same_origin,
            ChromeRequestShape::Subresource,
            &caller,
            &[],
        );
        same.sends_credentials = true;
        assert_eq!(value(&build_chrome_headers(&same), "sec-fetch-storage-access"), None);
    }

    // A frame navigation is a navigation for ordering purposes but drops
    // `Sec-Fetch-User`; Chrome sends neither on a subresource.
    #[test]
    fn a_frame_navigation_drops_sec_fetch_user() {
        let fingerprint = fingerprint();
        let url = Url::parse("https://example.com/frame").unwrap();
        let request = ResourceRequest::navigation();
        let caller = HashMap::new();
        let mut plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Navigation,
            &caller,
            &[],
        );
        plan.is_frame_navigation = true;
        assert_eq!(value(&build_chrome_headers(&plan), "sec-fetch-user"), None);
    }

    // An accepted high-entropy hint is emitted once, in the slot after the
    // low-entropy trio, and never duplicated by a caller header of the same
    // name. The set it came from used to be iterated directly.
    #[test]
    fn accepted_client_hints_are_sorted_and_not_duplicated() {
        let fingerprint = fingerprint();
        let url = Url::parse("https://example.com/").unwrap();
        let request = ResourceRequest::navigation();
        let mut caller = HashMap::new();
        caller.insert("sec-ch-ua".to_string(), "caller-owned".to_string());
        let accepted = vec![
            "sec-ch-ua-platform-version".to_string(),
            "sec-ch-ua".to_string(),
            "sec-ch-ua-arch".to_string(),
        ];
        let plan = plan(
            &fingerprint,
            &request,
            &url,
            ChromeRequestShape::Navigation,
            &caller,
            &accepted,
        );
        let built = build_chrome_headers(&plan);
        let hint_names: Vec<&str> = built
            .iter()
            .filter(|(name, _)| name.starts_with("sec-ch-ua-arch") || name == "sec-ch-ua-platform-version")
            .map(|(name, _)| name.as_str())
            .collect();

        assert_eq!(hint_names, ["sec-ch-ua-arch", "sec-ch-ua-platform-version"]);
        assert_eq!(built.iter().filter(|(name, _)| name == "sec-ch-ua").count(), 1);
        assert_eq!(value(&built, "sec-ch-ua"), Some("caller-owned"));
        // The trio still precedes the high-entropy hints.
        assert!(names(&built).iter().position(|name| name == "sec-ch-ua-platform").unwrap()
            < names(&built).iter().position(|name| name == "sec-ch-ua-arch").unwrap());
    }
}
