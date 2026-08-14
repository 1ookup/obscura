use serde_json::{json, Value};
use crate::dispatch::CdpContext;

pub async fn handle(method: &str, _params: &Value, ctx: &CdpContext) -> Result<Value, String> {
    match method {
        "getVersion" => {
            let fingerprint = &ctx.default_context.fingerprint;
            let version = if fingerprint.browser_version.is_empty() {
                obscura_net::BrowserFingerprint::default().browser_version
            } else {
                fingerprint.browser_version.clone()
            };
            Ok(json!({
                "protocolVersion": "1.3",
                "product": format!("Chrome/{version}"),
                "revision": "@0000000000000000000000000000000000000000",
                "userAgent": fingerprint.user_agent,
                "jsVersion": "14.6.0.0",
            }))
        }
        "close" => {
            Ok(json!({}))
        }
        "getWindowForTarget" => Ok(json!({
            "windowId": 1,
            "bounds": {
                "left": 0,
                "top": 0,
                "width": 1280,
                "height": 720,
                "windowState": "normal",
            }
        })),
        "setDownloadBehavior" => Ok(json!({})),
        "getWindowBounds" => Ok(json!({
            "bounds": { "left": 0, "top": 0, "width": 1280, "height": 720, "windowState": "normal" }
        })),
        // No-op acks for window-management methods Playwright sends during
        // page setup. We don't model real OS windows, but answering with {}
        // lets the client's setup sequence complete instead of tearing down
        // the page on an unknown-method error.
        "setWindowBounds" => Ok(json!({})),
        _ => Err(format!("Unknown Browser method: {}", method)),
    }
}
