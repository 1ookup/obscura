//! A STUN Binding client (RFC 5389): one request, one answer.
//!
//! A page whose `RTCPeerConnection` configuration names a `stun:` server makes
//! a browser send one UDP Binding request when ICE gathering starts, and
//! publish what the server echoes back as a `typ srflx` candidate. That
//! candidate is the only part of an offer that carries a public address, so a
//! probe reads it as one. This module is that client and nothing else: the
//! engine sends no media, and an address the engine did not learn from a
//! server would be a fabricated one.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const ATTR_MAPPED_ADDRESS: u16 = 0x0001;
const ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;
const MAGIC_COOKIE: u32 = 0x2112_A442;
/// The port RFC 5389 gives STUN, used when the server URL carries none.
const DEFAULT_PORT: u16 = 3478;
/// One datagram is enough: the address is the first attribute a server sends.
const RECEIVE_BUFFER: usize = 1500;

/// A Binding request with `transaction` as its transaction id: the 20-byte
/// header and no attributes.
fn binding_request(transaction: [u8; 12]) -> [u8; 20] {
    let mut message = [0u8; 20];
    message[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    // Length stays zero: a request carries no attributes.
    message[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    message[8..20].copy_from_slice(&transaction);
    message
}

/// Walk `body`'s attributes for a mapped address. `xor` selects the
/// XOR-MAPPED-ADDRESS form a server answers with; the plain MAPPED-ADDRESS the
/// RFC keeps as a fallback is the same shape without the mask.
fn mapped_attribute(body: &[u8], transaction: [u8; 12], xor: bool) -> Option<(IpAddr, u16)> {
    let wanted = if xor {
        ATTR_XOR_MAPPED_ADDRESS
    } else {
        ATTR_MAPPED_ADDRESS
    };
    let mut offset = 0usize;
    while offset + 4 <= body.len() {
        let code = u16::from_be_bytes([body[offset], body[offset + 1]]);
        let length = u16::from_be_bytes([body[offset + 2], body[offset + 3]]) as usize;
        let value = body.get(offset + 4..offset + 4 + length)?;
        if code == wanted {
            let family = *value.get(1)?;
            let raw_port = u16::from_be_bytes([*value.get(2)?, *value.get(3)?]);
            let port = if xor {
                raw_port ^ (MAGIC_COOKIE >> 16) as u16
            } else {
                raw_port
            };
            let address = match family {
                1 => {
                    let bytes: [u8; 4] = value.get(4..8)?.try_into().ok()?;
                    let bytes = if xor {
                        let mask = MAGIC_COOKIE.to_be_bytes();
                        [
                            bytes[0] ^ mask[0],
                            bytes[1] ^ mask[1],
                            bytes[2] ^ mask[2],
                            bytes[3] ^ mask[3],
                        ]
                    } else {
                        bytes
                    };
                    IpAddr::V4(Ipv4Addr::from(bytes))
                }
                2 => {
                    let bytes: [u8; 16] = value.get(4..20)?.try_into().ok()?;
                    let bytes = if xor {
                        let mut mask = [0u8; 16];
                        mask[0..4].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
                        mask[4..16].copy_from_slice(&transaction);
                        let mut unmasked = [0u8; 16];
                        for index in 0..16 {
                            unmasked[index] = bytes[index] ^ mask[index];
                        }
                        unmasked
                    } else {
                        bytes
                    };
                    IpAddr::V6(Ipv6Addr::from(bytes))
                }
                _ => return None,
            };
            return Some((address, port));
        }
        // Attributes are padded to a four-byte boundary.
        offset += 4 + length + (4 - length % 4) % 4;
    }
    None
}

/// The address a Binding success reports, when `message` is one and carries
/// `transaction`. Any other message (an error response, another transaction, a
/// truncated datagram) answers `None`.
pub(crate) fn parse_binding_response(
    message: &[u8],
    transaction: [u8; 12],
) -> Option<(IpAddr, u16)> {
    if message.len() < 20 {
        return None;
    }
    if u16::from_be_bytes([message[0], message[1]]) != BINDING_SUCCESS {
        return None;
    }
    if u32::from_be_bytes([message[4], message[5], message[6], message[7]]) != MAGIC_COOKIE {
        return None;
    }
    if message[8..20] != transaction {
        return None;
    }
    let length = u16::from_be_bytes([message[2], message[3]]) as usize;
    let body = message.get(20..20 + length)?;
    mapped_attribute(body, transaction, true).or_else(|| mapped_attribute(body, transaction, false))
}

/// `host:port`, with the port STUN defaults to when the URL named none.
///
/// A `stun:` or `stuns:` prefix is accepted and dropped: the callers hand over
/// what the page wrote.
fn host_and_port(server: &str) -> String {
    let lower = server.to_ascii_lowercase();
    let server = if lower.starts_with("stuns:") {
        &server[6..]
    } else if lower.starts_with("stun:") {
        &server[5..]
    } else {
        server
    };
    // A query or fragment is not part of the address.
    let server = server.split(['?', '#']).next().unwrap_or(server);
    if server.starts_with('[') {
        if server.contains("]:") {
            return server.to_string();
        }
        return format!("{server}:{DEFAULT_PORT}");
    }
    if server.contains(':') {
        return server.to_string();
    }
    format!("{server}:{DEFAULT_PORT}")
}

/// Ask `server` which address this host wears towards it.
///
/// `allow_private` opens the same door the fetch path opens: a page names the
/// server, so the address is checked exactly as a request URL is. A server that
/// does not answer, answers with something other than a Binding success, or
/// resolves only to addresses the policy forbids, returns `None` -- the caller
/// then publishes no srflx candidate at all.
pub(crate) async fn binding_lookup(
    server: &str,
    timeout: Duration,
    allow_private: bool,
) -> Option<(IpAddr, u16)> {
    let target = tokio::net::lookup_host(host_and_port(server))
        .await
        .ok()?
        .find(|address| allow_private || !obscura_net::is_forbidden_ip(address.ip()))?;
    let local = if target.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" };
    let socket = tokio::net::UdpSocket::bind(local).await.ok()?;
    socket.connect(target).await.ok()?;
    let mut transaction = [0u8; 12];
    getrandom::getrandom(&mut transaction).ok()?;
    let request = binding_request(transaction);
    socket.send(&request).await.ok()?;
    let deadline = tokio::time::Instant::now() + timeout;
    let mut buffer = [0u8; RECEIVE_BUFFER];
    loop {
        let remaining = deadline.checked_duration_since(tokio::time::Instant::now())?;
        let received = tokio::time::timeout(remaining, socket.recv(&mut buffer))
            .await
            .ok()?
            .ok()?;
        if let Some(mapped) = parse_binding_response(&buffer[..received], transaction) {
            return Some(mapped);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRANSACTION: [u8; 12] = *b"obscura-ice!";

    fn binding_success(transaction: [u8; 12], address: IpAddr, port: u16) -> Vec<u8> {
        let mut value = vec![0u8, if address.is_ipv4() { 1 } else { 2 }];
        value.extend_from_slice(&(port ^ (MAGIC_COOKIE >> 16) as u16).to_be_bytes());
        match address {
            IpAddr::V4(v4) => {
                let mask = MAGIC_COOKIE.to_be_bytes();
                for (index, byte) in v4.octets().iter().enumerate() {
                    value.push(byte ^ mask[index]);
                }
            }
            IpAddr::V6(v6) => {
                let mut mask = [0u8; 16];
                mask[0..4].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
                mask[4..16].copy_from_slice(&transaction);
                for (index, byte) in v6.octets().iter().enumerate() {
                    value.push(byte ^ mask[index]);
                }
            }
        }
        let mut attributes = Vec::new();
        attributes.extend_from_slice(&ATTR_XOR_MAPPED_ADDRESS.to_be_bytes());
        attributes.extend_from_slice(&(value.len() as u16).to_be_bytes());
        attributes.extend_from_slice(&value);
        let mut message = vec![0u8; 20];
        message[0..2].copy_from_slice(&BINDING_SUCCESS.to_be_bytes());
        // The header's length counts the attributes, header included.
        message[2..4].copy_from_slice(&(attributes.len() as u16).to_be_bytes());
        message[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
        message[8..20].copy_from_slice(&transaction);
        message.extend_from_slice(&attributes);
        message
    }

    #[test]
    fn binding_request_carries_the_cookie_and_the_transaction() {
        let request = binding_request(TRANSACTION);
        assert_eq!(request.len(), 20);
        assert_eq!(u16::from_be_bytes([request[0], request[1]]), BINDING_REQUEST);
        assert_eq!(u16::from_be_bytes([request[2], request[3]]), 0);
        assert_eq!(
            u32::from_be_bytes([request[4], request[5], request[6], request[7]]),
            MAGIC_COOKIE
        );
        assert_eq!(&request[8..20], &TRANSACTION);
    }

    #[test]
    fn parses_the_address_a_binding_success_reports() {
        for expected in [
            (IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7)), 5555u16),
            (
                IpAddr::V6("2001:db8::1".parse::<Ipv6Addr>().unwrap()),
                64369,
            ),
        ] {
            let message = binding_success(TRANSACTION, expected.0, expected.1);
            assert_eq!(parse_binding_response(&message, TRANSACTION), Some(expected));
        }
    }

    #[test]
    fn rejects_anything_that_is_not_the_answer_to_our_request() {
        let message = binding_success(TRANSACTION, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7)), 5555);
        // Another transaction, a truncated datagram, a request echoed back.
        assert_eq!(parse_binding_response(&message, [0u8; 12]), None);
        assert_eq!(parse_binding_response(&message[..12], TRANSACTION), None);
        let mut request = binding_request(TRANSACTION).to_vec();
        request.extend_from_slice(&message[20..]);
        assert_eq!(parse_binding_response(&request, TRANSACTION), None);
    }

    /// The whole exchange against a UDP responder on loopback, which is what
    /// the JS-level test cannot do without an allowance for private addresses.
    #[tokio::test]
    async fn asks_a_loopback_server_and_reads_back_the_mapped_address() {
        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        server
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let address = server.local_addr().unwrap();
        let responder = std::thread::spawn(move || {
            let mut buffer = [0u8; RECEIVE_BUFFER];
            let (received, from) = server.recv_from(&mut buffer).unwrap();
            let mut transaction = [0u8; 12];
            transaction.copy_from_slice(&buffer[8..20]);
            assert_eq!(
                u16::from_be_bytes([buffer[0], buffer[1]]),
                BINDING_REQUEST,
                "the stub only answers a Binding request"
            );
            assert_eq!(received, 20, "a request carries no attributes");
            let reply = binding_success(transaction, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7)), 5555);
            server.send_to(&reply, from).unwrap();
        });
        let mapped = binding_lookup(
            &format!("stun:{}", address),
            Duration::from_millis(500),
            true,
        )
        .await;
        responder.join().unwrap();
        assert_eq!(
            mapped,
            Some((IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7)), 5555))
        );

        // A server that never answers leaves the caller with nothing, which is
        // how gathering degrades to host candidates only.
        let silent = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let silent_address = silent.local_addr().unwrap();
        assert_eq!(
            binding_lookup(
                &format!("stun:{}", silent_address),
                Duration::from_millis(150),
                true
            )
            .await,
            None
        );
    }
}
