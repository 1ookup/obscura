//! Address-family aware reachability gate for fetch paths.
//!
//! A host that the DNS truthfully answers with AAAA records only (no A
//! record) is unreachable from a machine with no global IPv6 connectivity:
//! Chrome on such a machine fails the fetch instantly at the name-resolution
//! stage, and a managed challenge treats that instant, clean network error
//! very differently from a transport that dials, handshakes, and then dies
//! mid-request seconds later. This module reproduces the Chrome semantics:
//! resolve, look at both families, and reject the fetch up front when no
//! address family is usable, before any connection work starts.
//!
//! The subtlety is that the system resolver cannot always be trusted to
//! expose the family split. Fake-IP DNS modes (Clash/mihomo TUN and friends)
//! answer every A query with an address in 198.18.0.0/15 -- the RFC 2544
//! benchmarking range, which is never routed on the public internet -- so a
//! genuinely AAAA-only name looks like a perfectly dialable IPv4 host. The
//! gate therefore checks the system answers first and only when they carry
//! no globally usable IPv4 address (fake-IP range or empty) falls back to a
//! DoH lookup of A and AAAA, raced across two public resolvers for tail
//! latency. Every denial requires the full conjunction: suspicious system
//! answers, a truthful NOERROR with no A records, at least one AAAA record,
//! and no global IPv6 address on any local interface. Anything else -- DoH
//! unreachable, NXDOMAIN (VPN split-horizon names must keep working through
//! the tunnel), a real A record -- allows the request and behaves exactly as
//! before.
//!
//! The gate adds no network traffic on ordinary networks: system resolution
//! already ran for the connect, and a globally usable IPv4 answer short-
//! circuits everything. `OBSCURA_FAMILY_GATE=0` disables the gate outright.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::ObscuraNetError;

/// DoH resolvers raced for the truthful family answer. The JSON API (the
/// wire format would need RFC 8484 encoding; the JSON APIs are what public
/// resolvers expose for exactly this kind of probing). Override with
/// `OBSCURA_DOH_ENDPOINTS` (comma-separated URL templates with `{name}` and
/// `{type}` placeholders).
const DEFAULT_DOH_ENDPOINTS: &[&str] = &[
    "https://1.1.1.1/dns-query?name={name}&type={type}",
    "https://dns.google/resolve?name={name}&type={type}",
];

/// Whole-probe budget: the DoH race must never turn a working network into
/// a slow one. Both record-type races run concurrently, so this bounds the
/// gate's total added latency; a probe that misses the budget allows the
/// request and the transport behaves exactly as before. On a jittery tunnel
/// this is what bounds the worst case; the common case answers in one
/// round trip.
const DOH_PROBE_BUDGET: Duration = Duration::from_millis(700);

/// How long a gate decision is reused. DNS TTLs are not tracked per record;
/// this bounds both staleness and DoH traffic.
const DECISION_TTL: Duration = Duration::from_secs(300);

/// True when `ip` is an address only a fake-IP DNS pool would hand out:
/// inside 198.18.0.0/15 (198.18.0.0 - 198.19.255.255) the answer came from a
/// local interception pool, not from authoritative DNS.
pub fn is_fake_range_v4(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
        }
        IpAddr::V6(_) => false,
    }
}

/// RFC 4291 global unicast: 2000::/3. Unique-local (fc00::/7), link-local
/// (fe80::/10) and the v6 loopback do not give a machine internet IPv6
/// reachability; getaddrinfo's AI_ADDRCONFIG likewise refuses to hand out
/// AAAA answers when only those are assigned.
pub fn is_global_ipv6(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V6(v6) => (v6.segments()[0] & 0xe000) == 0x2000,
        IpAddr::V4(_) => false,
    }
}

/// True when any local interface carries a global-scope IPv6 address, i.e.
/// the machine can even attempt an outbound IPv6 connection. Checked once
/// and cached: interface assignment changes mid-process are not something
/// fetch paths can react to anyway.
fn has_global_ipv6() -> bool {
    static GLOBAL_V6: OnceLock<bool> = OnceLock::new();
    *GLOBAL_V6.get_or_init(detect_global_ipv6)
}

fn detect_global_ipv6() -> bool {
    unsafe {
        let mut addrs: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut addrs) != 0 {
            return false;
        }
        let mut found = false;
        let mut cursor = addrs;
        while !cursor.is_null() {
            let iface = &*cursor;
            let sock = iface.ifa_addr;
            if !sock.is_null() && (*sock).sa_family as i32 == libc::AF_INET6 {
                let sin6 = &*(sock as *const libc::sockaddr_in6);
                if is_global_ipv6(IpAddr::V6(Ipv6Addr::from(sin6.sin6_addr.s6_addr))) {
                    found = true;
                    break;
                }
            }
            cursor = iface.ifa_next;
        }
        libc::freeifaddrs(addrs);
        found
    }
}

/// The system answers, split by family. `None` means getaddrinfo failed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SystemAddrs {
    pub v4: Vec<Ipv4Addr>,
    pub v6: Vec<Ipv6Addr>,
}

/// The truthful (DoH) family facts for one name. `no_error` records the A
/// query's rCODE: only NOERROR with zero A records is the AAAA-only shape;
/// NXDOMAIN says nothing usable (VPN split-horizon names exist that only the
/// tunnel's own resolver can answer).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DohAnswer {
    pub no_error: bool,
    pub has_a: bool,
    pub has_aaaa: bool,
}

/// The pure family decision, factored out so the policy is testable without
/// network fixtures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FamilyDecision {
    /// A usable family exists (or nothing suspicious was seen): dial as
    /// before.
    Proceed,
    /// Truthful DNS says AAAA-only and the machine has no global IPv6:
    /// reject the fetch immediately.
    DenyNoFamily,
}

pub fn decide_family(system: Option<&SystemAddrs>, doh: Option<&DohAnswer>) -> FamilyDecision {
    decide_family_with(system, doh, has_global_ipv6())
}

/// `decide_family` with the machine's IPv6 capability injected, so the deny
/// shape is testable on any machine.
pub fn decide_family_with(
    system: Option<&SystemAddrs>,
    doh: Option<&DohAnswer>,
    has_global_v6: bool,
) -> FamilyDecision {
    // Fast path: the system resolver handed out at least one IPv4 address
    // that could be real. Dial it, exactly as before. This covers every
    // ordinary network with zero extra traffic.
    if let Some(system) = system {
        if system
            .v4
            .iter()
            .any(|ip| !is_fake_range_v4(IpAddr::V4(*ip)))
        {
            return FamilyDecision::Proceed;
        }
        if system.v6.iter().any(|ip| is_global_ipv6(IpAddr::V6(*ip))) {
            return FamilyDecision::Proceed;
        }
    }
    // The system answer was empty, fake-IP-ranged, or unresolvable. Only a
    // truthful DoH answer may deny, and only on the exact AAAA-only shape.
    let Some(doh) = doh else {
        return FamilyDecision::Proceed;
    };
    if doh.no_error && !doh.has_a && doh.has_aaaa && !has_global_v6 {
        return FamilyDecision::DenyNoFamily;
    }
    FamilyDecision::Proceed
}

fn family_gate_disabled() -> bool {
    matches!(
        std::env::var("OBSCURA_FAMILY_GATE")
            .ok()
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("0") | Some("false") | Some("off")
    )
}

fn doh_endpoints() -> Vec<String> {
    match std::env::var("OBSCURA_DOH_ENDPOINTS") {
        Ok(value) if !value.trim().is_empty() => value
            .split(',')
            .map(|entry| entry.trim().to_string())
            .filter(|entry| !entry.is_empty())
            .collect(),
        _ => DEFAULT_DOH_ENDPOINTS.iter().map(|s| s.to_string()).collect(),
    }
}

fn doh_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // The DoH probe reports on the direct network; sending it through
            // the user's proxy would make the probe answer about the wrong
            // path and could loop a proxy-side failure back into resolution.
            // The per-request timeout must sit at or above the race budget:
            // a tighter request timeout would fail both endpoints whenever a
            // single round trip is slow, and the budget exists to bound the
            // wait, not to disqualify slow-but-alive resolvers.
            .no_proxy()
            .timeout(DOH_PROBE_BUDGET)
            .build()
            .expect("failed to build DoH probe client")
    })
}

/// One DoH JSON query against one endpoint template. `None` on any transport
/// or parse failure, so a broken endpoint just loses the race.
async fn doh_query(template: &str, name: &str, record_type: &str) -> Option<DohAnswer> {
    let url = template
        .replace("{name}", name)
        .replace("{type}", record_type);
    let resp = doh_client()
        .get(&url)
        .header("accept", "application/dns-json")
        .send()
        .await
        .ok()?;
    let body = resp.text().await.ok()?;
    let value: serde_json::Value = serde_json::from_str(&body).ok()?;
    Some(parse_doh_json(&value))
}

fn parse_doh_json(value: &serde_json::Value) -> DohAnswer {
    let status = value.get("Status").and_then(serde_json::Value::as_i64);
    let no_error = status == Some(0);
    let mut has_a = false;
    let mut has_aaaa = false;
    if let Some(answers) = value.get("Answer").and_then(serde_json::Value::as_array) {
        for answer in answers {
            match answer.get("type").and_then(serde_json::Value::as_u64) {
                Some(1) => has_a = true,
                Some(28) => has_aaaa = true,
                _ => {}
            }
        }
    }
    DohAnswer {
        no_error,
        has_a,
        has_aaaa,
    }
}

/// Wait for the first future that answers `Some`, dropping `None` results.
/// `None` only when every future completed without an answer.
async fn first_answer<F, T>(futures: Vec<F>) -> Option<T>
where
    F: std::future::Future<Output = Option<T>>,
{
    use std::pin::Pin;
    use std::task::{Context, Poll};
    let mut pending: Vec<Pin<Box<F>>> = futures.into_iter().map(Box::pin).collect();
    std::future::poll_fn(move |cx: &mut Context<'_>| loop {
        let mut any_pending = false;
        let mut index = 0;
        let mut answered: Option<T> = None;
        while index < pending.len() {
            match pending[index].as_mut().poll(cx) {
                Poll::Ready(Some(value)) => {
                    answered = Some(value);
                    break;
                }
                // This endpoint failed: drop it and keep waiting for the rest.
                Poll::Ready(None) => {
                    drop(pending.remove(index));
                }
                Poll::Pending => {
                    any_pending = true;
                    index += 1;
                }
            }
        }
        if let Some(value) = answered {
            return Poll::Ready(Some(value));
        }
        if any_pending {
            return Poll::Pending;
        }
        return Poll::Ready(None);
    })
    .await
}

/// Race the record-type query across all endpoints, bounded by the probe
/// budget. `None` when no endpoint answered in time.
async fn raced_query(name: &str, record_type: &str) -> Option<DohAnswer> {
    let endpoints = doh_endpoints();
    let races: Vec<_> = endpoints
        .iter()
        .map(|template| doh_query(template, name, record_type))
        .collect();
    tokio::time::timeout(DOH_PROBE_BUDGET, first_answer(races))
        .await
        .ok()
        .flatten()
}

fn system_addrs_for(host: &str) -> Option<SystemAddrs> {
    let mut addrs = SystemAddrs::default();
    let iter = std::net::ToSocketAddrs::to_socket_addrs(&(host, 0)).ok()?;
    for addr in iter {
        match addr.ip() {
            IpAddr::V4(v4) => addrs.v4.push(v4),
            IpAddr::V6(v6) => addrs.v6.push(v6),
        }
    }
    Some(addrs)
}

/// The gate itself. Call at fetch entry for every host-string target, before
/// any connection work. Hosts that resolve (system or DoH) to a usable
/// family proceed; only the truthful AAAA-only-without-IPv6 shape is
/// rejected, and that rejection surfaces as an ordinary network error
/// (`TypeError: Failed to fetch` in the JS shim) -- the observable Chrome
/// produces on the same machine.
pub async fn ensure_host_reachable(host: &str) -> Result<(), ObscuraNetError> {
    if family_gate_disabled() {
        return Ok(());
    }
    // IP literals and single-label names never touch DNS.
    if host.is_empty() || !host.contains('.') || host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let host = host.trim_end_matches('.').to_ascii_lowercase();

    if let Some(cached) = cached_decision(&host) {
        return finish(cached, &host);
    }

    // getaddrinfo is a blocking libc call: run it off the async workers.
    let lookup_host = host.clone();
    let system = tokio::task::spawn_blocking(move || system_addrs_for(&lookup_host))
        .await
        .unwrap_or(None);

    if system.as_ref().is_some_and(|s| {
        s.v4.iter().any(|ip| !is_fake_range_v4(IpAddr::V4(*ip)))
            || s.v6.iter().any(|ip| is_global_ipv6(IpAddr::V6(*ip)))
    }) {
        store_decision(&host, FamilyDecision::Proceed);
        return Ok(());
    }

    // The system answer is fake-IP-ranged, empty, or failed: ask truthful
    // DNS. The A query is the discriminator; the AAAA query only matters on
    // the AAAA-only shape, so both run concurrently.
    let (a_answer, aaaa_answer) = {
        let a_host = host.clone();
        let aaaa_host = host.clone();
        tokio::join!(
            raced_query(&a_host, "A"),
            raced_query(&aaaa_host, "AAAA"),
        )
    };
    prime_doh_connections_once().await;
    let doh = a_answer.map(|mut a| {
        if let Some(aaaa) = aaaa_answer {
            a.has_aaaa = aaaa.has_aaaa;
        }
        a
    });
    if doh.is_none() {
        tracing::debug!(%host, "family gate DoH probe did not answer; proceeding");
    }

    let decision = decide_family(system.as_ref(), doh.as_ref());
    store_decision(&host, decision);
    finish(decision, &host)
}

/// One throwaway query per endpoint, fired in the background after the first
/// real probe: it completes DNS + TCP + TLS to each resolver so every later
/// gate probe rides a warm connection (the probe's own budget otherwise pays
/// handshake time on first use).
async fn prime_doh_connections_once() {
    static PRIMED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if PRIMED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let endpoints = doh_endpoints();
    tokio::spawn(async move {
        for template in &endpoints {
            // Best effort; a resolver that never answers costs nothing here.
            let _ = tokio::time::timeout(DOH_PROBE_BUDGET, doh_query(template, "example.com", "A"))
                .await;
        }
    });
}

fn finish(decision: FamilyDecision, host: &str) -> Result<(), ObscuraNetError> {
    match decision {
        FamilyDecision::Proceed => Ok(()),
        FamilyDecision::DenyNoFamily => Err(ObscuraNetError::Network(format!(
            "DNS: '{host}' has no A record (IPv6-only name) and this host has no global IPv6 route"
        ))),
    }
}

fn cached_decision(host: &str) -> Option<FamilyDecision> {
    let cache = decision_cache().lock().ok()?;
    let (decision, stored) = cache.get(host)?;
    if stored.elapsed() > DECISION_TTL {
        return None;
    }
    Some(*decision)
}

fn store_decision(host: &str, decision: FamilyDecision) {
    if let Ok(mut cache) = decision_cache().lock() {
        cache.insert(host.to_string(), (decision, Instant::now()));
    }
}

fn decision_cache() -> &'static Mutex<HashMap<String, (FamilyDecision, Instant)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (FamilyDecision, Instant)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;

    fn v4(octets: [u8; 4]) -> IpAddr {
        IpAddr::V4(Ipv4Addr::from(octets))
    }

    fn v6(segments: [u16; 8]) -> IpAddr {
        IpAddr::V6(Ipv6Addr::new(
            segments[0], segments[1], segments[2], segments[3], segments[4], segments[5],
            segments[6], segments[7],
        ))
    }

    fn system(v4: Vec<IpAddr>, v6: Vec<IpAddr>) -> SystemAddrs {
        let mut addrs = SystemAddrs::default();
        for ip in v4 {
            addrs.v4.push(match ip {
                IpAddr::V4(v4) => v4,
                IpAddr::V6(_) => panic!("v4 slot got v6"),
            });
        }
        for ip in v6 {
            addrs.v6.push(match ip {
                IpAddr::V6(v6) => v6,
                IpAddr::V4(_) => panic!("v6 slot got v4"),
            });
        }
        addrs
    }

    #[test]
    fn a_real_ipv4_answer_proceeds_without_any_probe() {
        let system = system(vec![v4([93, 184, 216, 34])], vec![]);
        assert_eq!(
            decide_family_with(Some(&system), None, false),
            FamilyDecision::Proceed
        );
    }

    #[test]
    fn a_global_ipv6_answer_proceeds() {
        let system = system(vec![], vec![v6([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1092])]);
        assert_eq!(
            decide_family_with(Some(&system), None, false),
            FamilyDecision::Proceed
        );
    }

    #[test]
    fn a_missing_system_answer_proceeds_without_doh() {
        assert_eq!(decide_family_with(None, None, false), FamilyDecision::Proceed);
    }

    #[test]
    fn fake_range_ipv4_is_recognized() {
        // Clash's default fake-IP pool starts at 198.18.0.1.
        assert!(is_fake_range_v4(v4([198, 18, 0, 20])));
        assert!(is_fake_range_v4(v4([198, 19, 255, 255])));
        assert!(!is_fake_range_v4(v4([198, 17, 0, 1])));
        assert!(!is_fake_range_v4(v4([198, 20, 0, 1])));
        assert!(!is_fake_range_v4(v4([93, 184, 216, 34])));
    }

    #[test]
    fn global_ipv6_classification_matches_rfc4291() {
        assert!(is_global_ipv6(v6([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1092])));
        assert!(!is_global_ipv6(v6([0xfdfe, 0xdcba, 0x9876, 0, 0, 0, 0, 0x9])));
        assert!(!is_global_ipv6(v6([0xfe80, 0, 0, 0, 0, 0, 0, 1])));
        assert!(!is_global_ipv6(v6([0xfc00, 0, 0, 0, 0, 0, 0, 1])));
        assert!(!is_global_ipv6(v6([0, 0, 0, 0, 0, 0, 0, 1])));
        assert!(!is_global_ipv6(v4([127, 0, 0, 1])));
    }

    #[test]
    fn aaaa_only_truthful_answer_denies_when_no_global_ipv6() {
        // Fake-IP system answer (no real family), truthful DNS says the name
        // exists with AAAA records only, machine has no global IPv6: this is
        // the IPv4-only-Chrome instant failure.
        let system = system(vec![v4([198, 18, 0, 20])], vec![]);
        let doh = DohAnswer {
            no_error: true,
            has_a: false,
            has_aaaa: true,
        };
        assert_eq!(
            decide_family_with(Some(&system), Some(&doh), false),
            FamilyDecision::DenyNoFamily
        );
        // The same shape on a v6-capable machine must proceed.
        assert_eq!(
            decide_family_with(Some(&system), Some(&doh), true),
            FamilyDecision::Proceed
        );
    }

    #[test]
    fn an_a_record_in_the_truthful_answer_proceeds() {
        let system = system(vec![v4([198, 18, 0, 20])], vec![]);
        let doh = DohAnswer {
            no_error: true,
            has_a: true,
            has_aaaa: true,
        };
        assert_eq!(
            decide_family_with(Some(&system), Some(&doh), false),
            FamilyDecision::Proceed
        );
    }

    #[test]
    fn nxdomain_and_doh_failures_proceed() {
        // NXDOMAIN: VPN split-horizon names only the tunnel's resolver can
        // answer must keep working.
        let system = system(vec![v4([198, 18, 0, 20])], vec![]);
        let nxdomain = DohAnswer {
            no_error: false,
            has_a: false,
            has_aaaa: false,
        };
        assert_eq!(
            decide_family_with(Some(&system), Some(&nxdomain), false),
            FamilyDecision::Proceed
        );
        // Probe timed out / no endpoint answered: proceed as before.
        assert_eq!(
            decide_family_with(Some(&system), None, false),
            FamilyDecision::Proceed
        );
        // NODATA for both families: nothing here says the v4 path fails.
        let empty = DohAnswer {
            no_error: true,
            has_a: false,
            has_aaaa: false,
        };
        assert_eq!(
            decide_family_with(Some(&system), Some(&empty), false),
            FamilyDecision::Proceed
        );
    }

    #[test]
    fn doh_json_answers_parse() {
        // Real shaped response: the A query for an AAAA-only name is
        // NOERROR with an authority section and no answers.
        let nodata: serde_json::Value = serde_json::from_str(
            r#"{"Status":0,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,
                "Question":[{"name":"brunhild.challenges.cloudflare.com","type":1}],
                "Authority":[{"name":"brunhild.challenges.cloudflare.com","type":6,
                "TTL":1753,"data":"kirk.ns.cloudflare.com. dns.cloudflare.com. 2413266296 10000 2400 604800 1800"}]}"#,
        )
        .unwrap();
        let parsed = parse_doh_json(&nodata);
        assert!(parsed.no_error);
        assert!(!parsed.has_a);
        assert!(!parsed.has_aaaa);

        let aaaa: serde_json::Value = serde_json::from_str(
            r#"{"Status":0,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,
                "Question":[{"name":"brunhild.challenges.cloudflare.com","type":28}],
                "Answer":[{"name":"brunhild.challenges.cloudflare.com","type":28,"TTL":88,
                "data":"2606:4700::6812:1092"},
                {"name":"brunhild.challenges.cloudflare.com","type":28,"TTL":88,
                "data":"2606:4700::6812:1192"}]}"#,
        )
        .unwrap();
        let parsed = parse_doh_json(&aaaa);
        assert!(parsed.no_error);
        assert!(!parsed.has_a);
        assert!(parsed.has_aaaa);

        let nxdomain: serde_json::Value =
            serde_json::from_str(r#"{"Status":3,"Question":[{"name":"gone.example","type":1}]}"#)
                .unwrap();
        let parsed = parse_doh_json(&nxdomain);
        assert!(!parsed.no_error);
    }

    /// End-to-end gate shape reachable without controlling the system
    /// resolver: a name getaddrinfo cannot resolve goes to the DoH probe,
    /// and a stub endpoint may answer. NXDOMAIN and an A-record answer both
    /// proceed; the AAAA-only deny itself is covered by the decision tests
    /// above because the machine's own IPv6 capability cannot be injected
    /// through the public entry point.
    #[tokio::test(flavor = "multi_thread")]
    async fn gate_uses_stub_doh_endpoint_and_proceeds_on_nxdomain() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 2048];
                    let _ = stream.read(&mut buf).await;
                    let body = br#"{"Status":3,"Question":[{"name":"gate-stub.example","type":1}]}"#;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(body).await;
                });
            }
        });

        std::env::set_var(
            "OBSCURA_DOH_ENDPOINTS",
            format!("http://{address}/dns-query?name={{name}}&type={{type}}"),
        );
        // A name that cannot resolve AND a stub DoH that answers NXDOMAIN:
        // the gate must let the request proceed (today's behaviour).
        let result = ensure_host_reachable("gate-stub-nxdomain.invalid").await;
        assert!(result.is_ok(), "{result:?}");
        std::env::remove_var("OBSCURA_DOH_ENDPOINTS");
    }
}
