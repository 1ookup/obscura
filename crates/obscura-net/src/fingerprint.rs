use serde::{Deserialize, Serialize};

/// The stable browser identity used by both request headers and JavaScript
/// observable surfaces. Values that a User-Agent cannot encode can be
/// replaced through [`FingerprintOverrides`] before a browser context is
/// created; request code never invents an independent second identity.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFingerprint {
    pub user_agent: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_languages")]
    pub languages: Vec<String>,
    pub browser_version: String,
    pub browser_major: u32,
    pub navigator_platform: String,
    pub ua_platform: String,
    pub ua_platform_version: String,
    pub architecture: String,
    pub bitness: String,
    pub wow64: bool,
    pub mobile: bool,
    pub model: String,
    pub brands: Vec<BrandVersion>,
    pub full_version_list: Vec<BrandVersion>,
    pub hardware_concurrency: u32,
    pub device_memory: f64,
    pub screen: ScreenFingerprint,
    pub gpu: GpuFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandVersion {
    pub brand: String,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenFingerprint {
    pub width: u32,
    pub height: u32,
    pub avail_width: u32,
    pub avail_height: u32,
    /// Optional screen work-area origin. Zero preserves the historical
    /// headless fallback; embedders can provide the host menu-bar offset.
    #[serde(default)]
    pub avail_top: i32,
    #[serde(default)]
    pub avail_left: i32,
    pub device_scale_factor: f64,
    /// Optional top-level window metrics. Zero keeps the historical derived
    /// values; non-zero values let an embedder mirror its actual host window.
    #[serde(default)]
    pub outer_width: u32,
    #[serde(default)]
    pub outer_height: u32,
    #[serde(default)]
    pub screen_x: i32,
    #[serde(default)]
    pub screen_y: i32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuFingerprint {
    pub vendor: String,
    pub renderer: String,
    /// Which canned adapter/extension table bootstrap.js serves for WebGPU and
    /// WebGL queries: "apple" for Apple-silicon Macs, "intel" for the D3D11
    /// and Metal x86 shapes. Empty lets bootstrap infer it from `ua_platform`.
    #[serde(default)]
    pub webgpu_profile: String,
}

/// Explicit value-level policy for facts which are not fully represented in a
/// User-Agent. Keeping this separate from derivation makes the injection
/// contract auditable and prevents behavior code from selecting random values.
/// Deserialize (camelCase) backs the `--fingerprint` CLI flag so operators can
/// pin the values a reduced UA cannot carry, e.g. a Chromium-shaped brand
/// list or an Intel-Mac GPU string.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FingerprintOverrides {
    pub language: Option<String>,
    pub languages: Option<Vec<String>>,
    pub browser_version: Option<String>,
    pub navigator_platform: Option<String>,
    pub ua_platform: Option<String>,
    pub ua_platform_version: Option<String>,
    pub architecture: Option<String>,
    pub bitness: Option<String>,
    pub wow64: Option<bool>,
    pub mobile: Option<bool>,
    pub model: Option<String>,
    pub brands: Option<Vec<BrandVersion>>,
    pub full_version_list: Option<Vec<BrandVersion>>,
    pub hardware_concurrency: Option<u32>,
    pub device_memory: Option<f64>,
    pub screen: Option<ScreenFingerprint>,
    pub gpu: Option<GpuFingerprint>,
}

pub const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

fn default_language() -> String {
    "en-US".to_string()
}

fn default_languages() -> Vec<String> {
    vec!["en-US".to_string(), "en".to_string()]
}

/// Overrides from `OBSCURA_FINGERPRINT_JSON`, the transport the `--fingerprint`
/// CLI flag uses to reach every worker process without threading a new
/// argument through each entry point. Malformed JSON yields empty overrides
/// with the parse error on stderr rather than aborting a running pipeline.
pub fn fingerprint_overrides_from_env() -> FingerprintOverrides {
    let profile = std::env::var_os("OBSCURA_PROFILE")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            let path = std::path::PathBuf::from("profile.json");
            path.is_file().then_some(path)
        });
    let mut merged = serde_json::Map::new();
    if let Some(path) = profile {
        match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(serde_json::Value::Object(values)) => merged.extend(values),
                Ok(_) => eprintln!("obscura: ignoring non-object profile {}", path.display()),
                Err(err) => eprintln!("obscura: ignoring invalid profile {}: {err}", path.display()),
            },
            Err(err) => eprintln!("obscura: ignoring unreadable profile {}: {err}", path.display()),
        }
    }
    if let Ok(raw) = std::env::var("OBSCURA_FINGERPRINT_JSON") {
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(serde_json::Value::Object(values)) => merged.extend(values),
            Err(err) => eprintln!("obscura: ignoring invalid OBSCURA_FINGERPRINT_JSON: {err}"),
            Ok(_) => eprintln!("obscura: ignoring non-object OBSCURA_FINGERPRINT_JSON"),
        }
    }
    let mut overrides = match serde_json::from_value(serde_json::Value::Object(merged)) {
        Ok(overrides) => overrides,
        Err(err) => {
            eprintln!("obscura: ignoring invalid fingerprint profile values: {err}");
            FingerprintOverrides::default()
        }
    };
    // Language is deliberately a separate, small override because it is a
    // common per-session setting and must stay synchronized across JS realms,
    // workers, and HTTP headers. OBSCURA_FINGERPRINT_JSON still wins when no
    // dedicated environment value is supplied.
    if let Ok(language) = std::env::var("OBSCURA_LANGUAGE") {
        let language = language.trim().to_string();
        if !language.is_empty() {
            overrides.language = Some(language.clone());
            if std::env::var("OBSCURA_LANGUAGES").is_err() {
                overrides.languages = Some(vec![language]);
            }
        }
    }
    if let Ok(raw) = std::env::var("OBSCURA_LANGUAGES") {
        let languages: Vec<String> = raw
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        if !languages.is_empty() {
            overrides.languages = Some(languages);
        }
    }
    overrides
}

/// UA-CH platform-version claims a reduced User-Agent cannot encode: the UA
/// string froze the macOS token at 10_15_7 and the Windows token at NT 10.0,
/// and every real Chrome reports the actual OS version here instead. These are
/// mainstream-value claims, overridable through `FingerprintOverrides`.
pub const MACOS_UA_PLATFORM_VERSION: &str = "26.4.0";
pub const WINDOWS_UA_PLATFORM_VERSION: &str = "15.0.0";

impl Default for BrowserFingerprint {
    fn default() -> Self {
        Self::from_user_agent(DEFAULT_USER_AGENT)
    }
}

impl BrowserFingerprint {
    /// Derive one deterministic identity from a User-Agent. Reduced UA values
    /// are deliberately not expanded into unknowable OS or browser patch
    /// versions. Embedders with real values supply them as policy overrides.
    pub fn from_user_agent(user_agent: impl Into<String>) -> Self {
        let user_agent = user_agent.into();
        let browser_version = chrome_version(&user_agent).unwrap_or_default();
        let browser_major = browser_version
            .split('.')
            .next()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let is_chrome = browser_major > 0;
        let is_google_chrome = user_agent.contains("Chrome/")
            || user_agent.contains("HeadlessChrome/")
            || user_agent.contains("CriOS/");

        let mut fingerprint = if user_agent.contains("Android") {
            let version = token_after(&user_agent, "Android ")
                .map(normalize_version)
                .unwrap_or_default();
            let model = android_model(&user_agent);
            BrowserFingerprint {
                user_agent,
                language: default_language(),
                languages: default_languages(),
                browser_version,
                browser_major,
                navigator_platform: "Linux armv81".to_string(),
                ua_platform: "Android".to_string(),
                ua_platform_version: version,
                architecture: "arm".to_string(),
                bitness: "64".to_string(),
                wow64: false,
                mobile: true,
                model,
                brands: Vec::new(),
                full_version_list: Vec::new(),
                hardware_concurrency: 8,
                device_memory: 8.0,
                screen: ScreenFingerprint {
                    width: 412,
                    height: 915,
                    avail_width: 412,
                    avail_height: 915,
                    avail_top: 0,
                    avail_left: 0,
                    device_scale_factor: 2.625,
                    outer_width: 0,
                    outer_height: 0,
                    screen_x: 0,
                    screen_y: 0,
                },
                gpu: GpuFingerprint {
                    vendor: "Google Inc. (Qualcomm)".to_string(),
                    renderer: "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)".to_string(),
                    webgpu_profile: String::new(),
                },
            }
        } else if user_agent.contains("Windows NT") {
            let wow64 = user_agent.contains("WOW64");
            let arm64 = user_agent.contains("ARM64");
            let bitness = if wow64 { "32" } else if user_agent.contains("Win64") || arm64 { "64" } else { "32" };
            BrowserFingerprint {
                user_agent,
                language: default_language(),
                languages: default_languages(),
                browser_version,
                browser_major,
                navigator_platform: "Win32".to_string(),
                ua_platform: "Windows".to_string(),
                ua_platform_version: WINDOWS_UA_PLATFORM_VERSION.to_string(),
                architecture: if arm64 { "arm" } else { "x86" }.to_string(),
                bitness: bitness.to_string(),
                wow64,
                mobile: false,
                model: String::new(),
                brands: Vec::new(),
                full_version_list: Vec::new(),
                hardware_concurrency: 8,
                device_memory: 8.0,
                screen: desktop_screen(1.0),
                gpu: GpuFingerprint {
                    vendor: "Google Inc. (Intel)".to_string(),
                    renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)".to_string(),
                    webgpu_profile: "intel".to_string(),
                },
            }
        } else if user_agent.contains("Macintosh") {
            // The macOS UA token is frozen at 10_15_7 on every Chrome,
            // Apple Silicon included, so it is not parsed back out. Apple
            // silicon is the mainstream shape and pairs with the apple GPU
            // profile; an Intel Mac identity is a FingerprintOverrides job.
            BrowserFingerprint {
                user_agent,
                language: default_language(),
                languages: default_languages(),
                browser_version,
                browser_major,
                navigator_platform: "MacIntel".to_string(),
                ua_platform: "macOS".to_string(),
                ua_platform_version: MACOS_UA_PLATFORM_VERSION.to_string(),
                architecture: "arm".to_string(),
                bitness: "64".to_string(),
                wow64: false,
                mobile: false,
                model: String::new(),
                brands: Vec::new(),
                full_version_list: Vec::new(),
                hardware_concurrency: 8,
                device_memory: 8.0,
                screen: ScreenFingerprint {
                    width: 1440,
                    height: 900,
                    avail_width: 1440,
                    avail_height: 900,
                    avail_top: 0,
                    avail_left: 0,
                    device_scale_factor: 2.0,
                    outer_width: 0,
                    outer_height: 0,
                    screen_x: 0,
                    screen_y: 0,
                },
                gpu: GpuFingerprint {
                    vendor: "Google Inc. (Apple)".to_string(),
                    renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)".to_string(),
                    webgpu_profile: "apple".to_string(),
                },
            }
        } else if user_agent.contains("Linux") || user_agent.contains("X11") {
            let arm64 = user_agent.contains("aarch64") || user_agent.contains("arm64");
            BrowserFingerprint {
                user_agent,
                language: default_language(),
                languages: default_languages(),
                browser_version,
                browser_major,
                navigator_platform: if arm64 { "Linux aarch64" } else { "Linux x86_64" }.to_string(),
                ua_platform: "Linux".to_string(),
                ua_platform_version: String::new(),
                architecture: if arm64 { "arm" } else { "x86" }.to_string(),
                bitness: "64".to_string(),
                wow64: false,
                mobile: false,
                model: String::new(),
                brands: Vec::new(),
                full_version_list: Vec::new(),
                hardware_concurrency: 8,
                device_memory: 8.0,
                screen: desktop_screen(1.0),
                gpu: GpuFingerprint {
                    vendor: "Google Inc. (Intel)".to_string(),
                    renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)".to_string(),
                    webgpu_profile: "intel".to_string(),
                },
            }
        } else {
            BrowserFingerprint {
                user_agent,
                language: default_language(),
                languages: default_languages(),
                browser_version,
                browser_major,
                navigator_platform: String::new(),
                ua_platform: String::new(),
                ua_platform_version: String::new(),
                architecture: String::new(),
                bitness: String::new(),
                wow64: false,
                mobile: false,
                model: String::new(),
                brands: Vec::new(),
                full_version_list: Vec::new(),
                hardware_concurrency: 8,
                device_memory: 8.0,
                screen: desktop_screen(1.0),
                gpu: GpuFingerprint { vendor: String::new(), renderer: String::new(), webgpu_profile: String::new() },
            }
        };

        if is_chrome {
            fingerprint.brands = chromium_brands(browser_major, is_google_chrome, false, &fingerprint.browser_version);
            fingerprint.full_version_list = chromium_brands(browser_major, is_google_chrome, true, &fingerprint.browser_version);
        }
        fingerprint
    }

    pub fn with_overrides(mut self, overrides: &FingerprintOverrides) -> Self {
        let language_overridden = overrides.language.is_some();
        let languages_overridden = overrides.languages.is_some();
        macro_rules! replace {
            ($field:ident) => {
                if let Some(value) = &overrides.$field {
                    self.$field = value.clone();
                }
            };
        }
        replace!(language);
        replace!(languages);
        replace!(browser_version);
        replace!(navigator_platform);
        replace!(ua_platform);
        replace!(ua_platform_version);
        replace!(architecture);
        replace!(bitness);
        replace!(wow64);
        replace!(mobile);
        replace!(model);
        replace!(brands);
        replace!(hardware_concurrency);
        replace!(device_memory);
        replace!(screen);
        replace!(gpu);
        if let Some(value) = &overrides.full_version_list {
            self.full_version_list = value.clone();
        } else if (overrides.browser_version.is_some() || overrides.brands.is_some())
            && !self.brands.is_empty() {
            self.full_version_list = self.brands.iter().map(|brand| BrandVersion {
                brand: brand.brand.clone(),
                version: if brand.brand.starts_with("Not") {
                    format!("{}.0.0.0", brand.version)
                } else {
                    self.browser_version.clone()
                },
            }).collect();
        }
        if language_overridden && !languages_overridden {
            self.languages = vec![self.language.clone()];
        } else if languages_overridden && !language_overridden {
            if let Some(first) = self.languages.first().filter(|value| !value.is_empty()) {
                self.language = first.clone();
            }
        }
        if self.language.trim().is_empty() {
            self.language = default_language();
        }
        if self.languages.is_empty() {
            self.languages = vec![self.language.clone()];
        }
        self
    }

    /// Serialize the browser's language preference in the same order as
    /// `navigator.languages`. The first entry is unweighted; later entries
    /// use Chrome's conventional descending q-values.
    pub fn accept_language(&self) -> String {
        let languages = if self.languages.is_empty() {
            std::slice::from_ref(&self.language)
        } else {
            &self.languages
        };
        languages
            .iter()
            .enumerate()
            .map(|(index, language)| {
                if index == 0 {
                    language.clone()
                } else {
                    let quality = (10_u32.saturating_sub(index as u32)).max(1);
                    format!("{language};q=0.{}", quality)
                }
            })
            .collect::<Vec<_>>()
            .join(",")
    }

    pub fn sec_ch_ua(&self) -> String {
        self.brands.iter().map(|brand| {
            format!("\"{}\";v=\"{}\"", brand.brand, brand.version)
        }).collect::<Vec<_>>().join(", ")
    }

    pub fn sec_ch_ua_platform(&self) -> String {
        format!("\"{}\"", self.ua_platform.replace('"', "\\\""))
    }

    pub fn sec_ch_ua_mobile(&self) -> &'static str {
        if self.mobile { "?1" } else { "?0" }
    }
}

fn desktop_screen(device_scale_factor: f64) -> ScreenFingerprint {
    ScreenFingerprint {
        width: 1920,
        height: 1080,
        avail_width: 1920,
        avail_height: 1080,
        avail_top: 0,
        avail_left: 0,
        device_scale_factor,
        outer_width: 0,
        outer_height: 0,
        screen_x: 0,
        screen_y: 0,
    }
}

fn token_after<'a>(user_agent: &'a str, marker: &str) -> Option<&'a str> {
    let rest = user_agent.split_once(marker)?.1;
    let end = rest.find([';', ')']).unwrap_or(rest.len());
    Some(rest[..end].trim())
}

fn normalize_version(value: &str) -> String {
    let mut parts = value
        .split(['.', '_'])
        .filter(|part| !part.is_empty())
        .take(3)
        .map(str::to_string)
        .collect::<Vec<_>>();
    while parts.len() < 3 {
        parts.push("0".to_string());
    }
    parts.join(".")
}

fn chrome_version(user_agent: &str) -> Option<String> {
    ["Chrome/", "HeadlessChrome/", "CriOS/", "Chromium/"]
        .iter()
        .find_map(|marker| user_agent.split_once(marker).map(|(_, rest)| rest))
        .map(|rest| rest.split_whitespace().next().unwrap_or(rest).trim_end_matches(';').to_string())
}

fn android_model(user_agent: &str) -> String {
    let Some(rest) = user_agent.split_once("Android ").map(|(_, rest)| rest) else {
        return String::new();
    };
    rest.split(';')
        .nth(1)
        .map(str::trim)
        .and_then(|part| part.split(" Build/").next())
        .filter(|part| !part.is_empty())
        .unwrap_or("")
        .to_string()
}

fn chromium_brands(major: u32, google_chrome: bool, full: bool, full_version: &str) -> Vec<BrandVersion> {
    const GREASE_CHARS: [char; 11] = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
    const GREASE_VERSION: [&str; 3] = ["8", "99", "24"];
    const PERMUTATIONS: [[usize; 3]; 6] = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    let grease_version = GREASE_VERSION[major as usize % GREASE_VERSION.len()];
    let grease = BrandVersion {
        brand: format!(
            "Not{}A{}Brand",
            GREASE_CHARS[major as usize % GREASE_CHARS.len()],
            GREASE_CHARS[(major as usize + 1) % GREASE_CHARS.len()],
        ),
        version: if full { format!("{grease_version}.0.0.0") } else { grease_version.to_string() },
    };
    let version = if full { full_version.to_string() } else { major.to_string() };
    let chromium = BrandVersion { brand: "Chromium".to_string(), version: version.clone() };
    if !google_chrome {
        return vec![chromium, grease];
    }
    let chrome = BrandVersion { brand: "Google Chrome".to_string(), version };
    let values = [grease, chromium, chrome];
    PERMUTATIONS[major as usize % PERMUTATIONS.len()]
        .iter()
        .map(|index| values[*index].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_a_macos_chrome_149_apple_silicon_identity() {
        let fingerprint = BrowserFingerprint::from_user_agent(DEFAULT_USER_AGENT);
        assert_eq!(fingerprint.language, "en-US");
        assert_eq!(fingerprint.languages, vec!["en-US", "en"]);
        assert_eq!(fingerprint.accept_language(), "en-US,en;q=0.9");
        assert_eq!(fingerprint.navigator_platform, "MacIntel");
        assert_eq!(fingerprint.ua_platform, "macOS");
        assert_eq!(fingerprint.ua_platform_version, MACOS_UA_PLATFORM_VERSION);
        assert_eq!(fingerprint.architecture, "arm");
        assert_eq!(fingerprint.gpu.webgpu_profile, "apple");
        assert!(fingerprint.gpu.vendor.contains("Apple"));
        assert!(fingerprint.gpu.renderer.contains("ANGLE Metal Renderer"));
        assert_eq!(fingerprint.sec_ch_ua_platform(), "\"macOS\"");
        assert_eq!(fingerprint.sec_ch_ua_mobile(), "?0");
    }

    #[test]
    fn derives_windows_identity_with_claimed_platform_version() {
        let fingerprint = BrowserFingerprint::from_user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36");
        assert_eq!(fingerprint.navigator_platform, "Win32");
        assert_eq!(fingerprint.ua_platform_version, WINDOWS_UA_PLATFORM_VERSION);
        assert_eq!(fingerprint.architecture, "x86");
        assert_eq!(fingerprint.gpu.webgpu_profile, "intel");
        assert_eq!(fingerprint.brands, vec![
            BrandVersion { brand: "Google Chrome".to_string(), version: "149".to_string() },
            BrandVersion { brand: "Chromium".to_string(), version: "149".to_string() },
            BrandVersion { brand: "Not)A;Brand".to_string(), version: "24".to_string() },
        ]);
        assert_eq!(fingerprint.sec_ch_ua(),
            "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"");
    }

    #[test]
    fn derives_mac_linux_android_and_unknown_without_cross_platform_values() {
        let mac = BrowserFingerprint::from_user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7680.80 Safari/537.36");
        // The 10_15_7-style token is frozen in every macOS UA, so the UA-CH
        // version stays the claimed constant regardless of the token.
        assert_eq!((mac.navigator_platform.as_str(), mac.ua_platform.as_str(), mac.ua_platform_version.as_str()),
            ("MacIntel", "macOS", MACOS_UA_PLATFORM_VERSION));
        assert_eq!(mac.browser_version, "149.0.7680.80");
        assert_eq!(mac.architecture, "arm");

        let linux = BrowserFingerprint::from_user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36");
        assert_eq!((linux.navigator_platform.as_str(), linux.ua_platform.as_str()), ("Linux x86_64", "Linux"));

        let android = BrowserFingerprint::from_user_agent(
            "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36");
        assert_eq!((android.ua_platform.as_str(), android.ua_platform_version.as_str(), android.model.as_str()),
            ("Android", "15.0.0", "Pixel 9"));
        assert!(android.mobile);
        assert_eq!(android.sec_ch_ua_mobile(), "?1");

        let unknown = BrowserFingerprint::from_user_agent("ExampleAgent/1.0");
        assert!(unknown.brands.is_empty());
        assert!(unknown.ua_platform.is_empty());
        assert!(unknown.sec_ch_ua().is_empty());
    }

    #[test]
    fn explicit_policy_overrides_only_value_layer() {
        let fingerprint = BrowserFingerprint::default().with_overrides(&FingerprintOverrides {
            browser_version: Some("149.0.7827.0".to_string()),
            ua_platform_version: Some("19.0.0".to_string()),
            architecture: Some("arm".to_string()),
            hardware_concurrency: Some(12),
            screen: Some(ScreenFingerprint {
                width: 2560,
                height: 1440,
                avail_width: 2560,
                avail_height: 1400,
                avail_top: 0,
                avail_left: 0,
                device_scale_factor: 2.0,
                outer_width: 0,
                outer_height: 0,
                screen_x: 0,
                screen_y: 0,
            }),
            ..FingerprintOverrides::default()
        });
        assert_eq!(fingerprint.browser_version, "149.0.7827.0");
        assert_eq!(fingerprint.full_version_list[0].version, "149.0.7827.0");
        assert_eq!(fingerprint.ua_platform_version, "19.0.0");
        assert_eq!(fingerprint.architecture, "arm");
        assert_eq!(fingerprint.hardware_concurrency, 12);
        assert_eq!(fingerprint.screen.device_scale_factor, 2.0);
    }

    #[test]
    fn language_override_keeps_navigator_and_request_header_in_sync() {
        let fingerprint = BrowserFingerprint::default().with_overrides(&FingerprintOverrides {
            language: Some("zh-CN".to_string()),
            ..FingerprintOverrides::default()
        });
        assert_eq!(fingerprint.language, "zh-CN");
        assert_eq!(fingerprint.languages, vec!["zh-CN"]);
        assert_eq!(fingerprint.accept_language(), "zh-CN");

        let languages = BrowserFingerprint::default().with_overrides(&FingerprintOverrides {
            languages: Some(vec!["zh-CN".to_string(), "en-US".to_string()]),
            ..FingerprintOverrides::default()
        });
        assert_eq!(languages.language, "zh-CN");
        assert_eq!(languages.accept_language(), "zh-CN,en-US;q=0.9");
    }

    #[test]
    fn brand_overrides_rederive_the_full_version_list() {
        // A Chromium-shaped brands override without an explicit
        // fullVersionList must not leave the 3-brand full list behind.
        let fingerprint = BrowserFingerprint::default().with_overrides(&FingerprintOverrides {
            browser_version: Some("149.0.7827.0".to_string()),
            brands: Some(vec![
                BrandVersion { brand: "Chromium".to_string(), version: "149".to_string() },
                BrandVersion { brand: "Not)A;Brand".to_string(), version: "24".to_string() },
            ]),
            ..FingerprintOverrides::default()
        });
        assert_eq!(fingerprint.brands.len(), 2);
        assert_eq!(fingerprint.full_version_list, vec![
            BrandVersion { brand: "Chromium".to_string(), version: "149.0.7827.0".to_string() },
            BrandVersion { brand: "Not)A;Brand".to_string(), version: "24.0.0.0".to_string() },
        ]);
    }

    #[test]
    fn serializes_the_javascript_injection_contract() {
        let value = serde_json::to_value(BrowserFingerprint::default()).unwrap();
        assert_eq!(value["navigatorPlatform"], "MacIntel");
        assert_eq!(value["screen"]["deviceScaleFactor"], 2.0);
        assert_eq!(value["brands"][0]["brand"], "Google Chrome");
        assert_eq!(value["gpu"]["webgpuProfile"], "apple");
    }
}
