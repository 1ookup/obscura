use std::sync::Arc;

use serde_json::{json, Value};

use obscura_net::{BrandVersion, BrowserFingerprint, CookieJar, FingerprintOverrides};

use crate::cookie_params::{parse_cdp_cookie, parse_delete_cookies_params};
use crate::dispatch::CdpContext;

const SESSION_COOKIE_EXPIRES: i64 = -1;
const DEFAULT_SECURE_PORT: u16 = 443;
const DEFAULT_INSECURE_PORT: u16 = 80;
const SOURCE_SCHEME_SECURE: &str = "Secure";
const SOURCE_SCHEME_NONSECURE: &str = "NonSecure";
const DEFAULT_SAME_SITE: &str = "Lax";

// Resolve the cookie jar for a Network request: prefer the session's page jar,
// fall back to the default browser context. Puppeteer and Playwright both call
// Network.setCookie/getCookies/deleteCookies BEFORE attaching to a target —
// requiring a session would break those flows (Storage.* already mirrors this).
fn cookie_jar_for<'a>(ctx: &'a CdpContext, session_id: &Option<String>) -> &'a Arc<CookieJar> {
    ctx.get_session_page(session_id)
        .map(|p| &p.context.cookie_jar)
        .unwrap_or(&ctx.default_context.cookie_jar)
}

pub async fn handle(
    method: &str,
    params: &Value,
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<Value, String> {
    match method {
        "enable" => Ok(json!({})),
        "disable" => {
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                page.clear_response_bodies();
            } else {
                for page in &mut ctx.pages {
                    page.clear_response_bodies();
                }
            }
            Ok(json!({}))
        }
        "setExtraHTTPHeaders" => {
            let headers = params.get("headers").and_then(|v| v.as_object());
            if let Some(page) = ctx.get_session_page(session_id) {
                if let Some(headers) = headers {
                    let header_map: std::collections::HashMap<String, String> = headers
                        .iter()
                        .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                        .collect();
                    page.http_client.set_extra_headers(header_map).await;
                }
            }
            Ok(json!({}))
        }
        "setUserAgentOverride" => {
            let ua = params.get("userAgent").and_then(|v| v.as_str()).unwrap_or("");
            let metadata = params.get("userAgentMetadata").and_then(Value::as_object);
            let brands = metadata.and_then(|values| values.get("brands"))
                .and_then(Value::as_array)
                .map(|values| parse_brands(values));
            let full_version_list = metadata.and_then(|values| values.get("fullVersionList"))
                .and_then(Value::as_array)
                .map(|values| parse_brands(values));
            let overrides = FingerprintOverrides {
                browser_version: metadata
                    .and_then(|values| values.get("fullVersion"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                navigator_platform: params.get("platform").and_then(Value::as_str).map(str::to_string),
                ua_platform: metadata.and_then(|values| values.get("platform"))
                    .and_then(Value::as_str).map(str::to_string),
                ua_platform_version: metadata.and_then(|values| values.get("platformVersion"))
                    .and_then(Value::as_str).map(str::to_string),
                architecture: metadata.and_then(|values| values.get("architecture"))
                    .and_then(Value::as_str).map(str::to_string),
                bitness: metadata.and_then(|values| values.get("bitness"))
                    .and_then(Value::as_str).map(str::to_string),
                wow64: metadata.and_then(|values| values.get("wow64")).and_then(Value::as_bool),
                mobile: metadata.and_then(|values| values.get("mobile")).and_then(Value::as_bool),
                model: metadata.and_then(|values| values.get("model"))
                    .and_then(Value::as_str).map(str::to_string),
                brands,
                full_version_list,
                ..FingerprintOverrides::default()
            };
            let fingerprint = BrowserFingerprint::from_user_agent(ua).with_overrides(&overrides);
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                page.set_browser_fingerprint(fingerprint).await;
            }
            Ok(json!({}))
        }
        "getCookies" | "getAllCookies" => {
            let cookies = cookie_jar_for(ctx, session_id).get_all_cookies();
            let cdp_cookies: Vec<Value> = cookies.iter().map(cookie_info_to_cdp_json).collect();
            Ok(json!({ "cookies": cdp_cookies }))
        }
        "setCookie" => {
            let cookie = parse_cdp_cookie(params)
                .ok_or("setCookie: missing required name/domain (or url)")?;
            cookie_jar_for(ctx, session_id).set_cookies_from_cdp(vec![cookie]);
            Ok(json!({ "success": true }))
        }
        "setCookies" => {
            if let Some(cookies) = params.get("cookies").and_then(|v| v.as_array()) {
                let parsed: Vec<_> = cookies.iter().filter_map(parse_cdp_cookie).collect();
                cookie_jar_for(ctx, session_id).set_cookies_from_cdp(parsed);
            }
            Ok(json!({}))
        }
        "deleteCookies" => {
            if let Some(filter) = parse_delete_cookies_params(params) {
                cookie_jar_for(ctx, session_id).delete_cookies_filtered(
                    &filter.name,
                    &filter.domain,
                    filter.path.as_deref(),
                );
            }
            Ok(json!({}))
        }
        "clearBrowserCookies" => {
            cookie_jar_for(ctx, session_id).clear();
            Ok(json!({}))
        }
        "setCacheDisabled" => Ok(json!({})),
        "setRequestInterception" => Ok(json!({})),
        "setBlockedURLs" => {
            let patterns = params
                .get("urls")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(ToString::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if let Some(page) = ctx.get_session_page_mut(session_id) {
                page.set_blocked_urls(patterns);
            } else {
                for page in &mut ctx.pages {
                    page.set_blocked_urls(patterns.clone());
                }
            }
            Ok(json!({}))
        }
        "getResponseBody" => {
            let request_id = params
                .get("requestId")
                .and_then(|v| v.as_str())
                .ok_or("Network.getResponseBody requires requestId")?;

            let body = if let Some(page) = ctx.get_session_page(session_id) {
                page.get_response_body(request_id)
            } else {
                ctx.pages.iter().find_map(|page| page.get_response_body(request_id))
            };

            match body {
                Some(body) => Ok(json!({
                    "body": body.body,
                    "base64Encoded": body.base64_encoded,
                })),
                None => Err(format!("No response body found for requestId {}", request_id)),
            }
        }
        _ => Err(format!("Unknown Network method: {}", method)),
    }
}

fn parse_brands(values: &[Value]) -> Vec<BrandVersion> {
    values.iter().filter_map(|value| {
        Some(BrandVersion {
            brand: value.get("brand")?.as_str()?.to_string(),
            version: value.get("version")?.as_str()?.to_string(),
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use obscura_net::CookieInfo;

    fn sample_cookie(name: &str) -> CookieInfo {
        CookieInfo {
            name: name.to_string(),
            value: "v".to_string(),
            domain: "example.com".to_string(),
            path: "/".to_string(),
            secure: false,
            http_only: false,
            same_site: String::new(),
            expires: None,
        }
    }

    #[tokio::test]
    async fn set_cookie_without_session_targets_default_context() {
        let mut ctx = CdpContext::new();
        let params = json!({
            "name": "sid",
            "value": "abc",
            "domain": "example.com",
            "path": "/"
        });
        let resp = handle("setCookie", &params, &mut ctx, &None)
            .await
            .expect("setCookie must succeed without a session");
        assert_eq!(resp["success"], json!(true));
        let cookies = ctx.default_context.cookie_jar.get_all_cookies();
        assert_eq!(cookies.len(), 1, "default cookie jar must receive the cookie");
        assert_eq!(cookies[0].name, "sid");
    }

    #[tokio::test]
    async fn set_cookies_without_session_targets_default_context() {
        let mut ctx = CdpContext::new();
        let params = json!({
            "cookies": [
                { "name": "a", "value": "1", "domain": "example.com", "path": "/" },
                { "name": "b", "value": "2", "domain": "example.com", "path": "/" }
            ]
        });
        handle("setCookies", &params, &mut ctx, &None)
            .await
            .expect("setCookies must succeed without a session");
        assert_eq!(ctx.default_context.cookie_jar.get_all_cookies().len(), 2);
    }

    #[tokio::test]
    async fn delete_cookies_without_session_targets_default_context() {
        let mut ctx = CdpContext::new();
        ctx.default_context
            .cookie_jar
            .set_cookies_from_cdp(vec![sample_cookie("sid")]);
        let params = json!({ "name": "sid", "domain": "example.com" });
        handle("deleteCookies", &params, &mut ctx, &None)
            .await
            .expect("deleteCookies must succeed without a session");
        assert!(ctx.default_context.cookie_jar.get_all_cookies().is_empty());
    }

    #[tokio::test]
    async fn get_all_cookies_returns_every_cookie_in_jar() {
        let mut ctx = CdpContext::new();
        ctx.default_context.cookie_jar.set_cookies_from_cdp(vec![
            sample_cookie("a"),
            sample_cookie("b"),
        ]);
        let resp = handle("getAllCookies", &json!({}), &mut ctx, &None)
            .await
            .expect("getAllCookies must succeed");
        let arr = resp["cookies"].as_array().expect("cookies array");
        assert_eq!(arr.len(), 2);
    }

    #[tokio::test]
    async fn get_cookies_falls_back_to_default_context_when_no_session() {
        let mut ctx = CdpContext::new();
        ctx.default_context
            .cookie_jar
            .set_cookies_from_cdp(vec![sample_cookie("sid")]);
        let resp = handle("getCookies", &json!({}), &mut ctx, &None)
            .await
            .expect("getCookies must succeed without a session");
        let arr = resp["cookies"].as_array().expect("cookies array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["name"], "sid");
    }

    #[tokio::test]
    async fn clear_browser_cookies_without_session_clears_default_context() {
        let mut ctx = CdpContext::new();
        ctx.default_context
            .cookie_jar
            .set_cookies_from_cdp(vec![sample_cookie("sid")]);
        handle("clearBrowserCookies", &json!({}), &mut ctx, &None)
            .await
            .expect("clearBrowserCookies must succeed");
        assert!(ctx.default_context.cookie_jar.get_all_cookies().is_empty());
    }

    #[tokio::test]
    async fn user_agent_override_updates_live_js_and_page_network_identity() {
        let mut ctx = CdpContext::new();
        let page_id = ctx.create_page();
        let session_id = Some("fingerprint-session".to_string());
        ctx.sessions.insert(session_id.clone().unwrap(), page_id.clone());
        ctx.get_page_mut(&page_id).unwrap()
            .navigate("data:text/html,<html><body></body></html>")
            .await
            .unwrap();

        handle(
            "setUserAgentOverride",
            &json!({
                "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
                "platform": "MacIntel",
                "userAgentMetadata": {
                    "brands": [
                        {"brand":"Chromium","version":"146"},
                        {"brand":"Not-A.Brand","version":"24"},
                        {"brand":"Google Chrome","version":"146"}
                    ],
                    "fullVersionList": [
                        {"brand":"Chromium","version":"146.0.7680.80"},
                        {"brand":"Not-A.Brand","version":"24.0.0.0"},
                        {"brand":"Google Chrome","version":"146.0.7680.80"}
                    ],
                    "fullVersion": "146.0.7680.80",
                    "platform": "macOS",
                    "platformVersion": "26.3.2",
                    "architecture": "arm",
                    "model": "",
                    "mobile": false,
                    "bitness": "64",
                    "wow64": false
                }
            }),
            &mut ctx,
            &session_id,
        ).await.unwrap();

        let page = ctx.get_page_mut(&page_id).unwrap();
        assert_eq!(page.fingerprint.browser_version, "146.0.7680.80");
        assert_eq!(page.fingerprint.navigator_platform, "MacIntel");
        assert_eq!(page.fingerprint.ua_platform_version, "26.3.2");
        assert_eq!(page.fingerprint.architecture, "arm");
        assert_eq!(page.http_client.browser_fingerprint().await, page.fingerprint);
        assert_eq!(page.evaluate(
            "JSON.stringify([navigator.userAgent,navigator.platform,navigator.userAgentData.toJSON()])"
        ), json!(
            r#"["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36","MacIntel",{"brands":[{"brand":"Chromium","version":"146"},{"brand":"Not-A.Brand","version":"24"},{"brand":"Google Chrome","version":"146"}],"mobile":false,"platform":"macOS"}]"#
        ));
    }

    #[tokio::test]
    async fn set_blocked_urls_targets_session_page_without_enabling_interception() {
        let mut ctx = CdpContext::new();
        let page_id = ctx.create_page();
        let session_id = Some("session-1".to_string());
        ctx.sessions.insert(session_id.clone().unwrap(), page_id.clone());

        handle(
            "setBlockedURLs",
            &json!({
                "urls": [
                    "*://*.example.com/*.png",
                    "*://cdn.example.com/*"
                ]
            }),
            &mut ctx,
            &session_id,
        )
        .await
        .expect("setBlockedURLs must succeed for a session page");

        let page = ctx.get_page(&page_id).unwrap();
        assert_eq!(
            page.blocked_url_patterns,
            vec![
                "*://*.example.com/*.png".to_string(),
                "*://cdn.example.com/*".to_string(),
            ]
        );
        assert!(!page.intercept_enabled);
        assert!(page.intercept_block_patterns.is_empty());
    }

    #[tokio::test]
    async fn set_blocked_urls_without_session_updates_existing_pages() {
        let mut ctx = CdpContext::new();
        let left = ctx.create_page();
        let right = ctx.create_page();

        handle(
            "setBlockedURLs",
            &json!({ "urls": ["*://tiles.example.test/*"] }),
            &mut ctx,
            &None,
        )
        .await
        .expect("setBlockedURLs must succeed without a session");

        assert_eq!(
            ctx.get_page(&left).unwrap().blocked_url_patterns,
            vec!["*://tiles.example.test/*".to_string()]
        );
        assert_eq!(
            ctx.get_page(&right).unwrap().blocked_url_patterns,
            vec!["*://tiles.example.test/*".to_string()]
        );
    }

    #[tokio::test]
    async fn set_blocked_urls_replaces_existing_patterns() {
        let mut ctx = CdpContext::new();
        let page_id = ctx.create_page();
        let session_id = Some("session-1".to_string());
        ctx.sessions.insert(session_id.clone().unwrap(), page_id.clone());

        handle(
            "setBlockedURLs",
            &json!({ "urls": ["*://old.example.test/*"] }),
            &mut ctx,
            &session_id,
        )
        .await
        .unwrap();
        handle(
            "setBlockedURLs",
            &json!({ "urls": ["*://new.example.test/*"] }),
            &mut ctx,
            &session_id,
        )
        .await
        .unwrap();

        assert_eq!(
            ctx.get_page(&page_id).unwrap().blocked_url_patterns,
            vec!["*://new.example.test/*".to_string()]
        );
    }

    #[tokio::test]
    async fn get_response_body_returns_stored_document_body() {
        let mut ctx = CdpContext::new();
        let page_id = ctx.create_page();
        let session_id = Some("session-1".to_string());
        ctx.sessions.insert(session_id.clone().unwrap(), page_id.clone());

        let page = ctx.get_page_mut(&page_id).unwrap();
        page.navigate("data:text/html,<html><body>hello body</body></html>")
            .await
            .unwrap();
        let request_id = page.network_events[0].request_id.clone();

        let result = handle(
            "getResponseBody",
            &json!({ "requestId": request_id }),
            &mut ctx,
            &session_id,
        )
        .await
        .unwrap();

        assert_eq!(result["body"], "<html><body>hello body</body></html>");
        assert_eq!(result["base64Encoded"], false);
    }

    #[tokio::test]
    async fn get_response_body_errors_for_unknown_request_id() {
        let mut ctx = CdpContext::new();
        let err = handle(
            "getResponseBody",
            &json!({ "requestId": "missing" }),
            &mut ctx,
            &None,
        )
        .await
        .unwrap_err();

        assert!(err.contains("missing"));
    }

    #[tokio::test]
    async fn network_disable_clears_stored_response_bodies() {
        let mut ctx = CdpContext::new();
        let page_id = ctx.create_page();
        let session_id = Some("session-1".to_string());
        ctx.sessions.insert(session_id.clone().unwrap(), page_id.clone());

        let page = ctx.get_page_mut(&page_id).unwrap();
        page.navigate("data:text/html,<html><body>temporary body</body></html>")
            .await
            .unwrap();
        let request_id = page.network_events[0].request_id.clone();

        handle("disable", &json!({}), &mut ctx, &session_id)
            .await
            .unwrap();

        let err = handle(
            "getResponseBody",
            &json!({ "requestId": request_id }),
            &mut ctx,
            &session_id,
        )
        .await
        .unwrap_err();
        assert!(err.contains("No response body found"));
    }
}

pub(crate) fn cookie_info_to_cdp_json(c: &obscura_net::CookieInfo) -> Value {
    let expires = c.expires.unwrap_or(SESSION_COOKIE_EXPIRES);
    let session = c.expires.is_none();
    let same_site = if c.same_site.is_empty() {
        DEFAULT_SAME_SITE
    } else {
        c.same_site.as_str()
    };
    json!({
        "name": c.name,
        "value": c.value,
        "domain": c.domain,
        "path": c.path,
        "expires": expires,
        "size": c.name.len() + c.value.len(),
        "httpOnly": c.http_only,
        "secure": c.secure,
        "session": session,
        "sameSite": same_site,
        "sameParty": false,
        "sourceScheme": if c.secure { SOURCE_SCHEME_SECURE } else { SOURCE_SCHEME_NONSECURE },
        "sourcePort": if c.secure { DEFAULT_SECURE_PORT } else { DEFAULT_INSECURE_PORT },
        "priority": "Medium",
    })
}
