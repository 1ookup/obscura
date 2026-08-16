//! Frame embedding policy: `X-Frame-Options`, CSP `frame-ancestors` and the
//! embedder's `frame-src` (docs/Iframe-support-design.md, Phase 3.2).
//!
//! An iframe load is a navigation request, so CORS never applies to it; these
//! checks are the actual gates. The CSP source grammar implemented here is an
//! explicit subset: `'none'`, `'self'`, `*`, scheme sources and host sources
//! (with `*.` host wildcards and port matching). Unrecognized source
//! expressions never match, so unsupported grammar fails closed — it blocks
//! rather than grants. Path components of host sources are ignored: correct
//! for `frame-ancestors` (origin-based matching per CSP3) and a documented,
//! slightly permissive simplification for `frame-src`.

use obscura_dom::Origin;

/// Why a frame navigation response (or request) was blocked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FrameBlockedReason {
    XFrameOptionsDeny,
    XFrameOptionsSameOrigin,
    CspFrameAncestors,
    CspFrameSrc,
}

impl std::fmt::Display for FrameBlockedReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::XFrameOptionsDeny => "blocked by X-Frame-Options: DENY",
            Self::XFrameOptionsSameOrigin => "blocked by X-Frame-Options: SAMEORIGIN",
            Self::CspFrameAncestors => "blocked by Content-Security-Policy frame-ancestors",
            Self::CspFrameSrc => "blocked by embedder Content-Security-Policy frame-src",
        };
        f.write_str(message)
    }
}

/// A parsed Content-Security-Policy header value (enforced policies only;
/// report-only headers must not be passed here).
#[derive(Clone, Debug, Default)]
pub struct ContentSecurityPolicy {
    directives: Vec<(String, Vec<String>)>,
}

impl ContentSecurityPolicy {
    pub fn parse(header: &str) -> Self {
        let mut directives = Vec::new();
        for chunk in header.split(';') {
            let mut tokens = chunk.split_ascii_whitespace();
            let Some(name) = tokens.next() else { continue };
            let name = name.to_ascii_lowercase();
            // First occurrence of a directive wins, per CSP parsing.
            if directives.iter().any(|(existing, _)| *existing == name) {
                continue;
            }
            directives.push((name, tokens.map(str::to_string).collect()));
        }
        ContentSecurityPolicy { directives }
    }

    pub fn directive(&self, name: &str) -> Option<&[String]> {
        self.directives
            .iter()
            .find(|(existing, _)| existing == name)
            .map(|(_, values)| values.as_slice())
    }

    pub fn has_frame_ancestors(&self) -> bool {
        self.directive("frame-ancestors").is_some()
    }

    /// Evaluate `frame-ancestors` against the complete ancestor-origin chain.
    /// Every ancestor must match the source list.
    pub fn frame_ancestors_allow(
        &self,
        response_origin: &Origin,
        ancestor_origins: &[Origin],
    ) -> bool {
        let Some(sources) = self.directive("frame-ancestors") else {
            return true;
        };
        ancestor_origins.iter().all(|ancestor| {
            sources
                .iter()
                .any(|source| source_matches_origin(source, response_origin, ancestor))
        })
    }

    /// Evaluate the embedder's frame-loading restriction for `url`. Uses the
    /// CSP3 fallback chain `frame-src` -> `child-src` -> `default-src`; no
    /// applicable directive allows the load.
    pub fn frame_src_allows(&self, url: &str, self_origin: &Origin) -> bool {
        let sources = self
            .directive("frame-src")
            .or_else(|| self.directive("child-src"))
            .or_else(|| self.directive("default-src"));
        let Some(sources) = sources else {
            return true;
        };
        let target = Origin::from_url(url);
        sources
            .iter()
            .any(|source| source_matches_url(source, url, &target, self_origin))
    }

    /// Evaluate whether a script URL is allowed by the document policy.
    /// `script-src-elem` takes precedence over `script-src`, followed by
    /// `default-src`, matching the CSP fallback used for script elements.
    pub fn script_src_allows(&self, url: &str, self_origin: &Origin) -> bool {
        let sources = self
            .directive("script-src-elem")
            .or_else(|| self.directive("script-src"))
            .or_else(|| self.directive("default-src"));
        let Some(sources) = sources else {
            return true;
        };
        let target = Origin::from_url(url);
        sources
            .iter()
            .any(|source| source_matches_url(source, url, &target, self_origin))
    }

    /// Evaluate an inline script element against the nonce/inline keywords.
    /// Hash sources are deliberately rejected until CSP hash computation is
    /// wired into the script loader.
    pub fn inline_script_allows(&self, nonce: Option<&str>) -> bool {
        let sources = self
            .directive("script-src-elem")
            .or_else(|| self.directive("script-src"))
            .or_else(|| self.directive("default-src"));
        let Some(sources) = sources else {
            return true;
        };
        sources.iter().any(|source| {
            source.eq_ignore_ascii_case("'unsafe-inline'")
                || nonce.is_some_and(|value| {
                    source.strip_prefix("'nonce-")
                        .and_then(|token| token.strip_suffix('\''))
                        .is_some_and(|expected| expected == value)
                })
        })
    }

    /// Evaluate an external stylesheet URL using `style-src` then
    /// `default-src`. Inline style handling is separate because this method
    /// only applies to network-backed sheets and imports.
    pub fn style_src_allows(&self, url: &str, self_origin: &Origin) -> bool {
        let sources = self
            .directive("style-src-elem")
            .or_else(|| self.directive("style-src"))
            .or_else(|| self.directive("default-src"));
        let Some(sources) = sources else { return true };
        let target = Origin::from_url(url);
        sources
            .iter()
            .any(|source| source_matches_url(source, url, &target, self_origin))
    }
}

/// Match one frame-ancestors source expression against an ancestor origin.
/// `response_origin` anchors `'self'` and scheme-less host sources.
fn source_matches_origin(source: &str, response_origin: &Origin, ancestor: &Origin) -> bool {
    let source_lower = source.to_ascii_lowercase();
    match source_lower.as_str() {
        "'none'" => false,
        "'self'" => response_origin.same_origin(ancestor),
        "*" => true,
        _ => {
            let Origin::Tuple { scheme, host, port } = ancestor else {
                // An opaque ancestor matches nothing but `*`.
                return false;
            };
            host_source_matches(&source_lower, response_origin, scheme, host, *port)
        }
    }
}

/// Match one fetch-directive source expression against a request URL.
fn source_matches_url(source: &str, url: &str, target: &Origin, self_origin: &Origin) -> bool {
    let source_lower = source.to_ascii_lowercase();
    match source_lower.as_str() {
        "'none'" => false,
        "'self'" => self_origin.same_origin(target),
        "*" => {
            // `*` matches network schemes but not data:/blob: per CSP.
            matches!(target, Origin::Tuple { .. })
        }
        "data:" => url.starts_with("data:"),
        "blob:" => url.starts_with("blob:"),
        _ => {
            let Origin::Tuple { scheme, host, port } = target else {
                return false;
            };
            host_source_matches(&source_lower, self_origin, scheme, host, *port)
        }
    }
}

/// Shared scheme/host/port matching for host-source expressions. `anchor`
/// supplies the scheme to assume for scheme-less sources.
fn host_source_matches(
    source: &str,
    anchor: &Origin,
    scheme: &str,
    host: &str,
    port: Option<u16>,
) -> bool {
    // Scheme-only source such as `https:`.
    if let Some(source_scheme) = source.strip_suffix(':') {
        if !source_scheme.contains('/') && !source_scheme.contains('.') {
            return scheme_matches(source_scheme, scheme);
        }
    }

    let (source_scheme, rest) = match source.split_once("://") {
        Some((source_scheme, rest)) => (Some(source_scheme), rest),
        None => (None, source),
    };
    // Drop any path component; see module docs.
    let host_port = rest.split(['/', '?', '#']).next().unwrap_or("");
    let (source_host, source_port) = match host_port.rsplit_once(':') {
        Some((h, p)) if !p.contains(']') => (h, Some(p)),
        _ => (host_port, None),
    };
    if source_host.is_empty() {
        return false;
    }

    match source_scheme {
        Some(source_scheme) => {
            if !scheme_matches(source_scheme, scheme) {
                return false;
            }
        }
        None => {
            // A scheme-less source assumes the protected resource's scheme,
            // upgraded: an https anchor never matches an http ancestor.
            if let Origin::Tuple {
                scheme: anchor_scheme,
                ..
            } = anchor
            {
                if !scheme_matches(anchor_scheme, scheme) {
                    return false;
                }
            }
        }
    }

    let host_ok = if let Some(suffix) = source_host.strip_prefix("*.") {
        host.len() > suffix.len()
            && host.ends_with(suffix)
            && host.as_bytes()[host.len() - suffix.len() - 1] == b'.'
    } else {
        source_host == host
    };
    if !host_ok {
        return false;
    }

    match source_port {
        Some("*") => true,
        Some(source_port) => match source_port.parse::<u16>() {
            Ok(source_port) => effective_port(scheme, port) == Some(source_port),
            Err(_) => false,
        },
        // No port in the source: match the scheme's default port.
        None => effective_port(scheme, port) == default_port(scheme),
    }
}

fn scheme_matches(source_scheme: &str, scheme: &str) -> bool {
    // http matches https (secure upgrade), ws matches wss.
    source_scheme == scheme
        || (source_scheme == "http" && scheme == "https")
        || (source_scheme == "ws" && scheme == "wss")
}

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" | "ws" => Some(80),
        "https" | "wss" => Some(443),
        "ftp" => Some(21),
        _ => None,
    }
}

fn effective_port(scheme: &str, port: Option<u16>) -> Option<u16> {
    port.or_else(|| default_port(scheme))
}

/// Decide whether a frame navigation response may be embedded under
/// `ancestor_origins` (nearest first, ending with the top-level document).
///
/// Browser precedence: when any enforced policy of the response contains
/// `frame-ancestors`, `X-Frame-Options` is ignored; otherwise XFO applies.
/// `SAMEORIGIN` requires every ancestor to be same-origin with the response,
/// matching Chromium's all-ancestors check. Conflicting multiple XFO values
/// deny, per spec.
pub fn frame_embedding_allowed(
    x_frame_options: &[String],
    response_policies: &[ContentSecurityPolicy],
    response_origin: &Origin,
    ancestor_origins: &[Origin],
) -> Result<(), FrameBlockedReason> {
    let has_frame_ancestors = response_policies
        .iter()
        .any(ContentSecurityPolicy::has_frame_ancestors);
    if has_frame_ancestors {
        // Every enforced policy must allow the embedding.
        if response_policies
            .iter()
            .all(|policy| policy.frame_ancestors_allow(response_origin, ancestor_origins))
        {
            return Ok(());
        }
        return Err(FrameBlockedReason::CspFrameAncestors);
    }

    // Normalize XFO: collapse comma-separated header values, ignore case.
    let mut tokens = Vec::new();
    for value in x_frame_options {
        for token in value.split(',') {
            let token = token.trim().to_ascii_uppercase();
            if !token.is_empty() {
                tokens.push(token);
            }
        }
    }
    if tokens.is_empty() {
        return Ok(());
    }
    let unique: std::collections::HashSet<&str> =
        tokens.iter().map(String::as_str).collect();
    if unique.len() > 1 {
        // Conflicting values (for example `DENY, ALLOWALL`) deny.
        return Err(FrameBlockedReason::XFrameOptionsDeny);
    }
    match tokens[0].as_str() {
        "DENY" => Err(FrameBlockedReason::XFrameOptionsDeny),
        "SAMEORIGIN" => {
            if ancestor_origins
                .iter()
                .all(|ancestor| response_origin.same_origin(ancestor))
            {
                Ok(())
            } else {
                Err(FrameBlockedReason::XFrameOptionsSameOrigin)
            }
        }
        // ALLOWALL, obsolete ALLOW-FROM and unrecognized values do not
        // restrict framing, matching browser behavior for invalid XFO.
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(url: &str) -> Origin {
        Origin::from_url(url)
    }

    #[test]
    fn x_frame_options_deny_and_sameorigin() {
        let same = origin("https://a.example/");
        let cross = origin("https://b.example/");
        let deny = vec!["DENY".to_string()];
        assert_eq!(
            frame_embedding_allowed(&deny, &[], &same, &[same.clone()]),
            Err(FrameBlockedReason::XFrameOptionsDeny)
        );
        let sameorigin = vec!["sameorigin".to_string()];
        assert_eq!(
            frame_embedding_allowed(&sameorigin, &[], &same, &[same.clone()]),
            Ok(())
        );
        assert_eq!(
            frame_embedding_allowed(&sameorigin, &[], &same, &[same.clone(), cross.clone()]),
            Err(FrameBlockedReason::XFrameOptionsSameOrigin)
        );
        // Conflicting values deny; a single unknown value does not restrict.
        assert_eq!(
            frame_embedding_allowed(
                &vec!["DENY, ALLOWALL".to_string()],
                &[],
                &same,
                &[same.clone()]
            ),
            Err(FrameBlockedReason::XFrameOptionsDeny)
        );
        assert_eq!(
            frame_embedding_allowed(&vec!["BOGUS".to_string()], &[], &same, &[cross.clone()]),
            Ok(())
        );
        assert_eq!(frame_embedding_allowed(&[], &[], &same, &[cross]), Ok(()));
    }

    #[test]
    fn frame_ancestors_overrides_xfo_and_checks_full_chain() {
        let resp = origin("https://widget.example/");
        let parent = origin("https://app.example/");
        let top = origin("https://top.example/");
        let policy = ContentSecurityPolicy::parse("frame-ancestors https://app.example https://top.example");
        // XFO DENY present but frame-ancestors wins and allows.
        assert_eq!(
            frame_embedding_allowed(
                &vec!["DENY".to_string()],
                &[policy.clone()],
                &resp,
                &[parent.clone(), top.clone()]
            ),
            Ok(())
        );
        // A chain member outside the list blocks.
        let other = origin("https://evil.example/");
        assert_eq!(
            frame_embedding_allowed(
                &[],
                &[policy],
                &resp,
                &[parent.clone(), other]
            ),
            Err(FrameBlockedReason::CspFrameAncestors)
        );
        // 'none' blocks everything.
        let none = ContentSecurityPolicy::parse("frame-ancestors 'none'");
        assert_eq!(
            frame_embedding_allowed(&[], &[none], &resp, &[parent]),
            Err(FrameBlockedReason::CspFrameAncestors)
        );
    }

    #[test]
    fn frame_ancestors_source_grammar_subset() {
        let resp = origin("https://widget.example/");
        let policy = ContentSecurityPolicy::parse("frame-ancestors 'self' https: *.trusted.example");
        assert!(policy.frame_ancestors_allow(&resp, &[origin("https://widget.example/")]));
        assert!(policy.frame_ancestors_allow(&resp, &[origin("https://anything.example/")]));
        assert!(policy.frame_ancestors_allow(&resp, &[origin("https://sub.trusted.example/")]));
        // http ancestor: `https:` scheme source does not match, wildcard host
        // is https-anchored (response scheme) so it does not match either.
        assert!(!policy.frame_ancestors_allow(&resp, &[origin("http://sub.trusted.example/")]));
        // The bare apex does not match a `*.` wildcard.
        let wildcard_only = ContentSecurityPolicy::parse("frame-ancestors *.trusted.example");
        assert!(!wildcard_only.frame_ancestors_allow(&resp, &[origin("https://trusted.example/")]));
        // Opaque ancestors match only `*`.
        let star = ContentSecurityPolicy::parse("frame-ancestors *");
        let opaque = Origin::from_url("data:text/html,x");
        assert!(star.frame_ancestors_allow(&resp, &[opaque.clone()]));
        let self_only = ContentSecurityPolicy::parse("frame-ancestors 'self'");
        assert!(!self_only.frame_ancestors_allow(&resp, &[opaque]));
    }

    #[test]
    fn frame_src_fallback_chain_and_schemes() {
        let self_origin = origin("https://app.example/");
        let frame_src = ContentSecurityPolicy::parse("default-src 'none'; frame-src https://pay.example data:");
        assert!(frame_src.frame_src_allows("https://pay.example/checkout", &self_origin));
        assert!(frame_src.frame_src_allows("data:text/html,hi", &self_origin));
        assert!(!frame_src.frame_src_allows("https://ads.example/", &self_origin));

        // No frame-src: child-src, then default-src applies.
        let child_src = ContentSecurityPolicy::parse("child-src 'self'; default-src *");
        assert!(child_src.frame_src_allows("https://app.example/embed", &self_origin));
        assert!(!child_src.frame_src_allows("https://other.example/", &self_origin));

        let default_only = ContentSecurityPolicy::parse("default-src 'self'");
        assert!(default_only.frame_src_allows("https://app.example/x", &self_origin));
        assert!(!default_only.frame_src_allows("https://other.example/x", &self_origin));

        // `*` does not grant data: URLs.
        let star = ContentSecurityPolicy::parse("frame-src *");
        assert!(!star.frame_src_allows("data:text/html,hi", &self_origin));

        // No applicable directive: allowed.
        let unrelated = ContentSecurityPolicy::parse("script-src 'self'");
        assert!(unrelated.frame_src_allows("https://anything.example/", &self_origin));
    }

    #[test]
    fn script_src_and_inline_nonce_enforcement() {
        let self_origin = origin("https://app.example/");
        let policy = ContentSecurityPolicy::parse(
            "default-src 'none'; script-src 'self' https://cdn.example 'nonce-abc'",
        );
        assert!(policy.script_src_allows("https://app.example/app.js", &self_origin));
        assert!(policy.script_src_allows("https://cdn.example/app.js", &self_origin));
        assert!(!policy.script_src_allows("https://evil.example/app.js", &self_origin));
        assert!(policy.inline_script_allows(Some("abc")));
        assert!(!policy.inline_script_allows(Some("wrong")));
        assert!(!policy.inline_script_allows(None));

        let elem = ContentSecurityPolicy::parse(
            "script-src 'self' 'unsafe-inline'; script-src-elem https://cdn.example",
        );
        assert!(elem.script_src_allows("https://cdn.example/app.js", &self_origin));
        assert!(!elem.script_src_allows("https://app.example/app.js", &self_origin));
        assert!(!elem.inline_script_allows(None));
        let style = ContentSecurityPolicy::parse("default-src 'none'; style-src https://cdn.example");
        assert!(style.style_src_allows("https://cdn.example/theme.css", &self_origin));
        assert!(!style.style_src_allows("https://evil.example/theme.css", &self_origin));
    }

    #[test]
    fn host_source_ports_and_default_ports() {
        let resp = origin("https://widget.example/");
        let with_port = ContentSecurityPolicy::parse("frame-ancestors https://app.example:8443");
        assert!(with_port.frame_ancestors_allow(&resp, &[origin("https://app.example:8443/")]));
        assert!(!with_port.frame_ancestors_allow(&resp, &[origin("https://app.example/")]));
        let wildcard_port = ContentSecurityPolicy::parse("frame-ancestors https://app.example:*");
        assert!(wildcard_port.frame_ancestors_allow(&resp, &[origin("https://app.example:9000/")]));
        // Default port in the source matches an origin with elided port.
        let default_port = ContentSecurityPolicy::parse("frame-ancestors https://app.example:443");
        assert!(default_port.frame_ancestors_allow(&resp, &[origin("https://app.example/")]));
    }
}
