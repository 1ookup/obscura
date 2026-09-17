//! WebCrypto public-key primitives behind `crypto.subtle`: ECDSA, ECDH, and
//! the three RSA algorithms.
//!
//! Same split as the secret-key ops in `ops.rs`: the JS shim in
//! `js/bootstrap/env/crypto/subtle.js` owns the `CryptoKey` objects and their
//! normalized algorithm parameters, and this module does the cryptography
//! with the RustCrypto crates on the digest 0.10 stack the rest of the tree
//! already uses.
//!
//! One op carries every command. The asymmetric operations are dominated by
//! curve arithmetic and big-integer modexp, so a JSON envelope costs nothing
//! measurable and keeps the JS/Rust boundary in one place. Key material
//! crosses as base64 in the envelope:
//!
//! - EC private keys are the raw field-element bytes; EC public keys are the
//!   SEC1 uncompressed point (`04 || X || Y`).
//! - RSA private keys are PKCS#8 DER; RSA public keys are SPKI DER.
//!
//! Canonicalizing on those forms means every import/export/sign path funnels
//! through one representation instead of reparsing whatever a caller passed.
//!
//! Errors start with the DOMException name the shim must raise, so a failure
//! deep in the padding code still surfaces as the name the spec requires.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use deno_core::op2;
use deno_error::JsErrorBox;
use serde_json::{json, Value};

/// Longest OAEP label WebCrypto callers pass in practice. Bounded so a huge
/// label cannot turn into an unbounded allocation before the RSA op rejects it.
const MAX_OAEP_LABEL: usize = 1024;

fn err(name: &str, msg: impl std::fmt::Display) -> JsErrorBox {
    JsErrorBox::generic(format!("{name}: {msg}"))
}

fn decode_b64(value: Option<&Value>, field: &str) -> Result<Vec<u8>, JsErrorBox> {
    let text = value
        .and_then(Value::as_str)
        .ok_or_else(|| err("DataError", format!("missing {field}")))?;
    BASE64
        .decode(text)
        .map_err(|_| err("DataError", format!("{field} is not valid base64")))
}

/// Base64url without padding, the encoding every JWK byte field uses.
fn b64url_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn b64url_decode(text: &str) -> Result<Vec<u8>, JsErrorBox> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| err("DataError", "JWK field is not valid base64url"))
}

fn field<'a>(request: &'a Value, name: &str) -> Result<&'a Value, JsErrorBox> {
    request
        .get(name)
        .ok_or_else(|| err("DataError", format!("missing {name}")))
}

fn hash_name(request: &Value) -> Result<&str, JsErrorBox> {
    let name = request
        .get("hash")
        .and_then(Value::as_str)
        .ok_or_else(|| err("NotSupportedError", "a hash is required"))?;
    match name {
        "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" => Ok(name),
        other => Err(err("NotSupportedError", format!("unsupported hash {other}"))),
    }
}

fn digest_bytes(hash: &str, data: &[u8]) -> Vec<u8> {
    use sha1::Digest as _;
    match hash {
        "SHA-1" => sha1::Sha1::digest(data).to_vec(),
        "SHA-256" => sha2::Sha256::digest(data).to_vec(),
        "SHA-384" => sha2::Sha384::digest(data).to_vec(),
        _ => sha2::Sha512::digest(data).to_vec(),
    }
}

/// Dispatch a runtime-selected hash over the monomorphized RustCrypto paths.
/// Each arm takes a type that implements `Digest` and returns the same type,
/// so the whole RSA surface is written once per hash instead of once per
/// algorithm-and-hash pair.
macro_rules! with_hash {
    ($hash:expr, $digest:ident => $body:expr) => {
        match $hash {
            "SHA-1" => {
                type $digest = sha1::Sha1;
                $body
            }
            "SHA-256" => {
                type $digest = sha2::Sha256;
                $body
            }
            "SHA-384" => {
                type $digest = sha2::Sha384;
                $body
            }
            _ => {
                type $digest = sha2::Sha512;
                $body
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Elliptic curves (P-256 / P-384)
// ---------------------------------------------------------------------------

/// Curve operations are written once per curve; the two curves differ only in
/// the crate, so the macro keeps one copy of the logic.
macro_rules! with_curve {
    ($curve:expr, $krate:ident => $body:expr) => {
        match $curve {
            "P-256" => {
                use p256 as $krate;
                $body
            }
            "P-384" => {
                use p384 as $krate;
                $body
            }
            other => Err(err(
                "NotSupportedError",
                format!("unsupported namedCurve {other}"),
            )),
        }
    };
}

fn ec_generate(curve: &str) -> Result<(Vec<u8>, Vec<u8>), JsErrorBox> {
    with_curve!(curve, krate => {
        use krate::elliptic_curve::sec1::ToEncodedPoint as _;
        let secret = krate::SecretKey::random(&mut rsa::rand_core::OsRng);
        let public = secret.public_key().to_encoded_point(false);
        Ok((
            secret.to_bytes().to_vec(),
            public.as_bytes().to_vec(),
        ))
    })
}

fn ec_public_from_bytes(curve: &str, bytes: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    with_curve!(curve, krate => {
        use krate::elliptic_curve::sec1::ToEncodedPoint as _;
        let public = krate::PublicKey::from_sec1_bytes(bytes)
            .map_err(|_| err("DataError", "invalid EC public key"))?;
        Ok(public.to_encoded_point(false).as_bytes().to_vec())
    })
}

fn ec_secret_from_bytes(curve: &str, bytes: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    with_curve!(curve, krate => {
        let secret = krate::SecretKey::from_slice(bytes)
            .map_err(|_| err("DataError", "invalid EC private key"))?;
        Ok(secret.to_bytes().to_vec())
    })
}

fn ec_public_der(curve: &str, point: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    with_curve!(curve, krate => {
        use krate::pkcs8::EncodePublicKey as _;
        let public = krate::PublicKey::from_sec1_bytes(point)
            .map_err(|_| err("DataError", "invalid EC public key"))?;
        public
            .to_public_key_der()
            .map(|der| der.as_bytes().to_vec())
            .map_err(|_| err("OperationError", "could not encode SPKI"))
    })
}

fn ec_secret_der(curve: &str, scalar: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    with_curve!(curve, krate => {
        use krate::pkcs8::EncodePrivateKey as _;
        let secret = krate::SecretKey::from_slice(scalar)
            .map_err(|_| err("DataError", "invalid EC private key"))?;
        secret
            .to_pkcs8_der()
            .map(|der| der.as_bytes().to_vec())
            .map_err(|_| err("OperationError", "could not encode PKCS#8"))
    })
}

fn ec_import_der(curve: &str, format: &str, der: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    with_curve!(curve, krate => {
        if format == "spki" {
            use krate::pkcs8::DecodePublicKey as _;
            use krate::elliptic_curve::sec1::ToEncodedPoint as _;
            let public = krate::PublicKey::from_public_key_der(der)
                .map_err(|_| err("DataError", "invalid SPKI"))?;
            return Ok(public.to_encoded_point(false).as_bytes().to_vec());
        }
        use krate::pkcs8::DecodePrivateKey as _;
        let secret = krate::SecretKey::from_pkcs8_der(der)
            .map_err(|_| err("DataError", "invalid PKCS#8"))?;
        Ok(secret.to_bytes().to_vec())
    })
}

fn ec_jwk(curve: &str, format: &str, jwk: &Value) -> Result<Vec<u8>, JsErrorBox> {
    let crv = jwk
        .get("crv")
        .and_then(Value::as_str)
        .ok_or_else(|| err("DataError", "JWK has no crv"))?;
    if crv != curve {
        return Err(err(
            "DataError",
            "The imported EC key specifies a different curve than requested",
        ));
    }
    let x = b64url_decode(
        jwk.get("x")
            .and_then(Value::as_str)
            .ok_or_else(|| err("DataError", "JWK has no x"))?,
    )?;
    let y = b64url_decode(
        jwk.get("y")
            .and_then(Value::as_str)
            .ok_or_else(|| err("DataError", "JWK has no y"))?,
    )?;
    if format == "private" || jwk.get("d").is_some() {
        let d = b64url_decode(
            jwk.get("d")
                .and_then(Value::as_str)
                .ok_or_else(|| err("DataError", "JWK has no d"))?,
        )?;
        return ec_secret_from_bytes(curve, &d);
    }
    let mut point = Vec::with_capacity(x.len() + y.len() + 1);
    point.push(0x04);
    point.extend_from_slice(&x);
    point.extend_from_slice(&y);
    ec_public_from_bytes(curve, &point)
}

fn ec_public_coordinates(curve: &str, point: &[u8]) -> Result<(Vec<u8>, Vec<u8>), JsErrorBox> {
    with_curve!(curve, krate => {
        use krate::elliptic_curve::sec1::ToEncodedPoint as _;
        let public = krate::PublicKey::from_sec1_bytes(point)
            .map_err(|_| err("DataError", "invalid EC public key"))?;
        let encoded = public.to_encoded_point(false);
        let x = encoded.x().ok_or_else(|| err("DataError", "EC point has no x"))?;
        let y = encoded.y().ok_or_else(|| err("DataError", "EC point has no y"))?;
        Ok((x.to_vec(), y.to_vec()))
    })
}

fn ec_sign(curve: &str, hash: &str, scalar: &[u8], data: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    let digest = digest_bytes(hash, data);
    with_curve!(curve, krate => {
        use krate::ecdsa::signature::hazmat::PrehashSigner as _;
        let secret = krate::SecretKey::from_slice(scalar)
            .map_err(|_| err("DataError", "invalid EC private key"))?;
        let signing = krate::ecdsa::SigningKey::from(&secret);
        let signature: krate::ecdsa::Signature = signing
            .sign_prehash(&digest)
            .map_err(|_| err("OperationError", "ECDSA signing failed"))?;
        // WebCrypto uses the raw `r || s` form, not the DER encoding.
        Ok(signature.to_bytes().to_vec())
    })
}

fn ec_verify(
    curve: &str,
    hash: &str,
    point: &[u8],
    signature: &[u8],
    data: &[u8],
) -> Result<bool, JsErrorBox> {
    let digest = digest_bytes(hash, data);
    with_curve!(curve, krate => {
        use krate::ecdsa::signature::hazmat::PrehashVerifier as _;
        let public = krate::PublicKey::from_sec1_bytes(point)
            .map_err(|_| err("DataError", "invalid EC public key"))?;
        let verifying = krate::ecdsa::VerifyingKey::from(&public);
        // A malformed signature is a failed verification, not an error: the
        // spec reserves throws for key and algorithm problems.
        let Ok(signature) = krate::ecdsa::Signature::from_slice(signature) else {
            return Ok(false);
        };
        Ok(verifying.verify_prehash(&digest, &signature).is_ok())
    })
}

/// ECDH, then truncate to the requested bit length the way WebCrypto does:
/// round up to whole bytes and clear the bits past the requested length.
fn ec_derive(curve: &str, scalar: &[u8], point: &[u8], bits: u32) -> Result<Vec<u8>, JsErrorBox> {
    with_curve!(curve, krate => {
        use krate::elliptic_curve::sec1::FromEncodedPoint as _;
        let secret = krate::SecretKey::from_slice(scalar)
            .map_err(|_| err("DataError", "invalid EC private key"))?;
        let encoded = krate::EncodedPoint::from_bytes(point)
            .map_err(|_| err("DataError", "invalid EC public key"))?;
        let public = krate::PublicKey::from_encoded_point(&encoded);
        let Some(public) = Option::<krate::PublicKey>::from(public) else {
            return Err(err("DataError", "invalid EC public key"));
        };
        let shared = krate::ecdh::diffie_hellman(secret.to_nonzero_scalar(), public.as_affine());
        let secret_bytes = shared.raw_secret_bytes();
        let curve_bits = secret_bytes.len() as u32 * 8;
        // Chrome caps the request at the curve size rounded up to a byte, not
        // at the curve size itself (528 for P-521, 256 for P-256).
        if bits > curve_bits {
            return Err(err(
                "OperationError",
                format!("Length specified for ECDH key derivation is too large. Maximum allowed is {curve_bits} bits"),
            ));
        }
        let mut out = secret_bytes.to_vec();
        let byte_len = bits.div_ceil(8) as usize;
        out.truncate(byte_len);
        if let (Some(last), true) = (out.last_mut(), bits % 8 != 0) {
            *last &= 0xffu8 << (8 - (bits % 8));
        }
        Ok(out)
    })
}

// ---------------------------------------------------------------------------
// RSA
// ---------------------------------------------------------------------------

const RSA_EXPONENT_ERROR: &str = "The \"publicExponent\" must be either 3 or 65537";

fn rsa_generate(request: &Value) -> Result<(Vec<u8>, Vec<u8>), JsErrorBox> {
    use rsa::traits::PublicKeyParts as _;
    let bits = request
        .get("modulusLength")
        .and_then(Value::as_u64)
        .ok_or_else(|| err("OperationError", "modulusLength is required"))?;
    if bits < 256 || bits > 8192 || bits % 8 != 0 {
        return Err(err(
            "OperationError",
            "The modulus length must be a multiple of 8 bits and >= 256 and <= 8192",
        ));
    }
    let exponent = decode_b64(request.get("publicExponent"), "publicExponent")?;
    let exponent = if exponent.is_empty() {
        return Err(err("TypeError", RSA_EXPONENT_ERROR));
    } else {
        rsa::BigUint::from_bytes_be(&exponent)
    };
    if exponent != rsa::BigUint::from(3u32) && exponent != rsa::BigUint::from(65537u32) {
        return Err(err("OperationError", RSA_EXPONENT_ERROR));
    }
    let private = rsa::RsaPrivateKey::new_with_exp(
        &mut rsa::rand_core::OsRng,
        bits as usize,
        &exponent,
    )
    .map_err(|_| err("OperationError", "RSA key generation failed"))?;
    let public = private.to_public_key();
    let _ = public.size();
    use rsa::pkcs8::{EncodePrivateKey as _, EncodePublicKey as _};
    let private_der = private
        .to_pkcs8_der()
        .map_err(|_| err("OperationError", "could not encode PKCS#8"))?
        .as_bytes()
        .to_vec();
    let public_der = public
        .to_public_key_der()
        .map_err(|_| err("OperationError", "could not encode SPKI"))?
        .as_bytes()
        .to_vec();
    Ok((private_der, public_der))
}

fn rsa_import_der(format: &str, der: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    use rsa::pkcs8::{DecodePrivateKey as _, DecodePublicKey as _, EncodePrivateKey as _, EncodePublicKey as _};
    if format == "spki" {
        let public = rsa::RsaPublicKey::from_public_key_der(der)
            .map_err(|_| err("DataError", "invalid SPKI"))?;
        return public
            .to_public_key_der()
            .map(|der| der.as_bytes().to_vec())
            .map_err(|_| err("DataError", "invalid SPKI"));
    }
    let private = rsa::RsaPrivateKey::from_pkcs8_der(der)
        .map_err(|_| err("DataError", "invalid PKCS#8"))?;
    private
        .to_pkcs8_der()
        .map(|der| der.as_bytes().to_vec())
        .map_err(|_| err("DataError", "invalid PKCS#8"))
}

fn rsa_import_jwk(jwk: &Value, want_private: bool) -> Result<Vec<u8>, JsErrorBox> {
    use rsa::pkcs8::{EncodePrivateKey as _, EncodePublicKey as _};
    use rsa::traits::PublicKeyParts as _;
    let n = b64url_decode(
        jwk.get("n")
            .and_then(Value::as_str)
            .ok_or_else(|| err("DataError", "JWK has no n"))?,
    )?;
    let e = b64url_decode(
        jwk.get("e")
            .and_then(Value::as_str)
            .ok_or_else(|| err("DataError", "JWK has no e"))?,
    )?;
    let public = rsa::RsaPublicKey::new(
        rsa::BigUint::from_bytes_be(&n),
        rsa::BigUint::from_bytes_be(&e),
    )
    .map_err(|_| err("DataError", "invalid RSA public key"))?;
    if !want_private {
        return public
            .to_public_key_der()
            .map(|der| der.as_bytes().to_vec())
            .map_err(|_| err("OperationError", "could not encode SPKI"));
    }
    let read = |name: &str| -> Result<rsa::BigUint, JsErrorBox> {
        Ok(rsa::BigUint::from_bytes_be(&b64url_decode(
            jwk.get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| err("DataError", format!("JWK has no {name}")))?,
        )?))
    };
    let private = rsa::RsaPrivateKey::from_components(
        public.n().clone(),
        public.e().clone(),
        read("d")?,
        vec![read("p")?, read("q")?],
    )
    .map_err(|_| err("DataError", "invalid RSA private key"))?;
    private
        .to_pkcs8_der()
        .map(|der| der.as_bytes().to_vec())
        .map_err(|_| err("OperationError", "could not encode PKCS#8"))
}

fn rsa_exponent_bytes(key: &rsa::RsaPublicKey) -> Vec<u8> {
    use rsa::traits::PublicKeyParts as _;
    let bytes = key.e().to_bytes_be();
    // Chrome reports the exponent as a minimal big-endian integer.
    if bytes.is_empty() { vec![0] } else { bytes }
}

/// `qinv` is a signed integer in `rsa`; its JWK form is the magnitude.
fn qinv_bytes(key: &rsa::RsaPrivateKey) -> Result<Vec<u8>, JsErrorBox> {
    use rsa::traits::PrivateKeyParts as _;
    key.qinv()
        .map(|value| value.to_bytes_be().1)
        .ok_or_else(|| err("NotSupportedError", "RSA key has no CRT parameters"))
}

/// A CRT parameter the JWK export needs. `rsa` computes them lazily, so a key
/// reassembled from raw components can be missing one; that is a key the JWK
/// form cannot describe, not a crash.
fn crt(
    key: &rsa::RsaPrivateKey,
    read: impl Fn(&rsa::RsaPrivateKey) -> Option<&rsa::BigUint>,
) -> Result<Vec<u8>, JsErrorBox> {
    read(key)
        .map(|value| value.to_bytes_be())
        .ok_or_else(|| err("NotSupportedError", "RSA key has no CRT parameters"))
}

fn rsa_public_jwk(key: &rsa::RsaPublicKey) -> (String, String) {
    use rsa::traits::PublicKeyParts as _;
    (
        b64url_encode(&key.n().to_bytes_be()),
        b64url_encode(&rsa_exponent_bytes(key)),
    )
}

fn rsa_sign(
    kind: &str,
    hash: &str,
    salt_len: Option<usize>,
    private_der: &[u8],
    data: &[u8],
) -> Result<Vec<u8>, JsErrorBox> {
    use rsa::pkcs8::DecodePrivateKey as _;
    let private = rsa::RsaPrivateKey::from_pkcs8_der(private_der)
        .map_err(|_| err("DataError", "invalid PKCS#8"))?;
    let digest = digest_bytes(hash, data);
    if kind == "RSA-PSS" {
        let salt_len = salt_len.ok_or_else(|| {
            err("TypeError", "RsaPssParams: saltLength: Missing required property")
        })?;
        return with_hash!(hash, D => {
            use rsa::signature::hazmat::RandomizedPrehashSigner as _;
            use rsa::signature::SignatureEncoding as _;
            let signing = rsa::pss::SigningKey::<D>::new_with_salt_len(private, salt_len);
            let signature = signing
                .sign_prehash_with_rng(&mut rsa::rand_core::OsRng, &digest)
                .map_err(|e| err("OperationError", format!("RSA-PSS signing failed: {e}")))?;
            Ok(signature.to_vec())
        });
    }
    with_hash!(hash, D => {
        use rsa::signature::hazmat::PrehashSigner as _;
        use rsa::signature::SignatureEncoding as _;
        let signing = rsa::pkcs1v15::SigningKey::<D>::new(private);
        let signature = signing
            .sign_prehash(&digest)
            .map_err(|_| err("OperationError", "RSASSA-PKCS1-v1_5 signing failed"))?;
        Ok(signature.to_vec())
    })
}

fn rsa_verify(
    kind: &str,
    hash: &str,
    salt_len: Option<usize>,
    public_der: &[u8],
    signature: &[u8],
    data: &[u8],
) -> Result<bool, JsErrorBox> {
    use rsa::pkcs8::DecodePublicKey as _;
    let public = rsa::RsaPublicKey::from_public_key_der(public_der)
        .map_err(|_| err("DataError", "invalid SPKI"))?;
    let digest = digest_bytes(hash, data);
    if kind == "RSA-PSS" {
        let salt_len = salt_len.ok_or_else(|| {
            err("TypeError", "RsaPssParams: saltLength: Missing required property")
        })?;
        return with_hash!(hash, D => {
            use rsa::signature::hazmat::PrehashVerifier as _;
            let verifying =
                rsa::pss::VerifyingKey::<D>::new_with_salt_len(public, salt_len);
            let Ok(signature) = rsa::pss::Signature::try_from(signature) else {
                return Ok(false);
            };
            Ok(verifying.verify_prehash(&digest, &signature).is_ok())
        });
    }
    with_hash!(hash, D => {
        use rsa::signature::hazmat::PrehashVerifier as _;
        let verifying = rsa::pkcs1v15::VerifyingKey::<D>::new(public);
        let Ok(signature) = rsa::pkcs1v15::Signature::try_from(signature) else {
            return Ok(false);
        };
        Ok(verifying.verify_prehash(&digest, &signature).is_ok())
    })
}

/// OAEP's label is hashed as raw bytes, but the `rsa` crate carries it as a
/// `String`. Every label a browser caller passes is ASCII in practice; a
/// non-UTF-8 one is rejected rather than silently hashed as something else.
fn oaep_label(request: &Value) -> Result<Option<String>, JsErrorBox> {
    let Some(value) = request.get("label").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let bytes = decode_b64(Some(value), "label")?;
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() > MAX_OAEP_LABEL {
        return Err(err("OperationError", "OAEP label is too long"));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| err("NotSupportedError", "a non-UTF-8 OAEP label is not supported"))
}

fn rsa_encrypt(hash: &str, label: Option<String>, public_der: &[u8], data: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    use rsa::pkcs8::DecodePublicKey as _;
    let public = rsa::RsaPublicKey::from_public_key_der(public_der)
        .map_err(|_| err("DataError", "invalid SPKI"))?;
    let mut rng = rsa::rand_core::OsRng;
    with_hash!(hash, D => {
        let padding = match label {
            Some(label) => rsa::Oaep::new_with_label::<D, String>(label),
            None => rsa::Oaep::new::<D>(),
        };
        public
            .encrypt(&mut rng, padding, data)
            .map_err(|_| err("OperationError", "RSA-OAEP encryption failed"))
    })
}

fn rsa_decrypt(hash: &str, label: Option<String>, private_der: &[u8], data: &[u8]) -> Result<Vec<u8>, JsErrorBox> {
    use rsa::pkcs8::DecodePrivateKey as _;
    let private = rsa::RsaPrivateKey::from_pkcs8_der(private_der)
        .map_err(|_| err("DataError", "invalid PKCS#8"))?;
    with_hash!(hash, D => {
        let padding = match label {
            Some(label) => rsa::Oaep::new_with_label::<D, String>(label),
            None => rsa::Oaep::new::<D>(),
        };
        private
            .decrypt(padding, data)
            .map_err(|_| err("OperationError", "RSA-OAEP decryption failed"))
    })
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

/// One entry point for every public-key WebCrypto operation. `command` picks
/// the family and `request` is the JSON envelope described above; the reply is
/// JSON as well, so the shim can hand back ArrayBuffers, booleans or JWK
/// objects without a second op.
#[op2]
#[string]
pub fn op_subtle_asym(#[string] command: &str, #[string] request: &str) -> Result<String, JsErrorBox> {
    let request: Value = serde_json::from_str(request)
        .map_err(|_| err("OperationError", "malformed request"))?;
    let text = |value: Value| serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string());
    match command {
        "generate" => {
            let kind = request
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| err("NotSupportedError", "a key type is required"))?;
            if kind == "ECDSA" || kind == "ECDH" {
                let curve = request
                    .get("curve")
                    .and_then(Value::as_str)
                    .ok_or_else(|| err("NotSupportedError", "a namedCurve is required"))?;
                let (private, public) = ec_generate(curve)?;
                return Ok(text(json!({
                    "private": BASE64.encode(&private),
                    "public": BASE64.encode(&public),
                })));
            }
            let (private, public) = rsa_generate(&request)?;
            Ok(text(json!({
                "private": BASE64.encode(&private),
                "public": BASE64.encode(&public),
            })))
        }
        "ec_import" => {
            let curve = field(&request, "curve")?
                .as_str()
                .ok_or_else(|| err("NotSupportedError", "a namedCurve is required"))?;
            let format = field(&request, "format")?
                .as_str()
                .ok_or_else(|| err("DataError", "a format is required"))?;
            let want_private = request.get("type").and_then(Value::as_str) == Some("private");
            let bytes = match format {
                "raw" => decode_b64(request.get("data"), "data")?,
                "spki" | "pkcs8" => ec_import_der(
                    curve,
                    format,
                    &decode_b64(request.get("data"), "data")?,
                )?,
                "jwk" => ec_jwk(
                    curve,
                    if want_private { "private" } else { "public" },
                    field(&request, "data")?,
                )?,
                other => {
                    return Err(err(
                        "NotSupportedError",
                        format!("unsupported EC key format {other}"),
                    ))
                }
            };
            Ok(text(json!({ "key": BASE64.encode(&bytes) })))
        }
        "ec_export" => {
            let curve = field(&request, "curve")?
                .as_str()
                .ok_or_else(|| err("NotSupportedError", "a namedCurve is required"))?;
            let format = field(&request, "format")?
                .as_str()
                .ok_or_else(|| err("DataError", "a format is required"))?;
            let is_private = request.get("type").and_then(Value::as_str) == Some("private");
            let key = decode_b64(request.get("key"), "key")?;
            match format {
                "raw" => {
                    if is_private {
                        return Err(err("InvalidAccessError", "The key is not of the expected type"));
                    }
                    Ok(text(json!({ "data": BASE64.encode(&key) })))
                }
                "spki" => Ok(text(json!({
                    "data": BASE64.encode(&ec_public_der(curve, &key)?),
                }))),
                "pkcs8" => Ok(text(json!({
                    "data": BASE64.encode(&ec_secret_der(curve, &key)?),
                }))),
                "jwk" => {
                    if is_private {
                        with_curve!(curve, krate => {
                            use krate::elliptic_curve::sec1::ToEncodedPoint as _;
                            let secret = krate::SecretKey::from_slice(&key)
                                .map_err(|_| err("DataError", "invalid EC private key"))?;
                            let point = secret.public_key().to_encoded_point(false);
                            let x = point.x().ok_or_else(|| err("DataError", "EC point has no x"))?;
                            let y = point.y().ok_or_else(|| err("DataError", "EC point has no y"))?;
                            Ok(text(json!({
                                "crv": curve,
                                "d": b64url_encode(&secret.to_bytes()),
                                "x": b64url_encode(x),
                                "y": b64url_encode(y),
                            })))
                        })
                    } else {
                        let (x, y) = ec_public_coordinates(curve, &key)?;
                        Ok(text(json!({
                            "crv": curve,
                            "x": b64url_encode(&x),
                            "y": b64url_encode(&y),
                        })))
                    }
                }
                other => Err(err(
                    "NotSupportedError",
                    format!("unsupported EC key format {other}"),
                )),
            }
        }
        "ec_sign" => {
            let curve = field(&request, "curve")?.as_str().unwrap_or("");
            let hash = hash_name(&request)?;
            let key = decode_b64(request.get("key"), "key")?;
            let data = decode_b64(request.get("data"), "data")?;
            Ok(text(json!({
                "sig": BASE64.encode(&ec_sign(curve, hash, &key, &data)?),
            })))
        }
        "ec_verify" => {
            let curve = field(&request, "curve")?.as_str().unwrap_or("");
            let hash = hash_name(&request)?;
            let point = decode_b64(request.get("key"), "key")?;
            let signature = decode_b64(request.get("signature"), "signature")?;
            let data = decode_b64(request.get("data"), "data")?;
            let ok = ec_verify(curve, hash, &point, &signature, &data)?;
            Ok(text(json!({ "ok": ok })))
        }
        "ec_derive" => {
            let curve = field(&request, "curve")?.as_str().unwrap_or("");
            let bits = request.get("length").and_then(Value::as_u64).unwrap_or(0);
            let scalar = decode_b64(request.get("private"), "private")?;
            let point = decode_b64(request.get("public"), "public")?;
            Ok(text(json!({
                "bits": BASE64.encode(&ec_derive(curve, &scalar, &point, bits as u32)?),
            })))
        }
        "rsa_import" => {
            let format = field(&request, "format")?
                .as_str()
                .ok_or_else(|| err("DataError", "a format is required"))?;
            let want_private = request.get("type").and_then(Value::as_str) == Some("private");
            let bytes = if format == "jwk" {
                rsa_import_jwk(field(&request, "data")?, want_private)?
            } else if format == "spki" || format == "pkcs8" {
                rsa_import_der(format, &decode_b64(request.get("data"), "data")?)?
            } else {
                return Err(err(
                    "NotSupportedError",
                    format!("unsupported RSA key format {format}"),
                ));
            };
            // The key's own modulus and exponent travel back with it: an
            // imported RSA CryptoKey reports what it carries, not what the
            // caller's algorithm object claimed.
            let shape = if format == "jwk" {
                json!({})
            } else if want_private {
                use rsa::pkcs8::DecodePrivateKey as _;
                use rsa::traits::PublicKeyParts as _;
                let private = rsa::RsaPrivateKey::from_pkcs8_der(&bytes)
                    .map_err(|_| err("DataError", "invalid PKCS#8"))?;
                json!({
                    "modulusLength": private.n().bits(),
                    "publicExponent": BASE64.encode(&rsa_exponent_bytes(&private.to_public_key())),
                })
            } else {
                use rsa::pkcs8::DecodePublicKey as _;
                use rsa::traits::PublicKeyParts as _;
                let public = rsa::RsaPublicKey::from_public_key_der(&bytes)
                    .map_err(|_| err("DataError", "invalid SPKI"))?;
                json!({
                    "modulusLength": public.n().bits(),
                    "publicExponent": BASE64.encode(&rsa_exponent_bytes(&public)),
                })
            };
            let mut reply = json!({ "key": BASE64.encode(&bytes) });
            if let Some(object) = reply.as_object_mut() {
                if let Some(shape) = shape.as_object() {
                    for (name, value) in shape {
                        object.insert(name.clone(), value.clone());
                    }
                }
            }
            Ok(text(reply))
        }
        "rsa_export" => {
            use rsa::pkcs8::{DecodePrivateKey as _, DecodePublicKey as _, EncodePrivateKey as _, EncodePublicKey as _};
            let format = field(&request, "format")?
                .as_str()
                .ok_or_else(|| err("DataError", "a format is required"))?;
            let is_private = request.get("type").and_then(Value::as_str) == Some("private");
            let key = decode_b64(request.get("key"), "key")?;
            if format == "spki" {
                if is_private {
                    return Err(err("InvalidAccessError", "The key is not of the expected type"));
                }
                let public = rsa::RsaPublicKey::from_public_key_der(&key)
                    .map_err(|_| err("DataError", "invalid SPKI"))?;
                return Ok(text(json!({
                    "data": BASE64.encode(
                        public.to_public_key_der()
                            .map_err(|_| err("OperationError", "could not encode SPKI"))?
                            .as_bytes(),
                    ),
                })));
            }
            if format == "pkcs8" {
                if !is_private {
                    return Err(err("InvalidAccessError", "The key is not of the expected type"));
                }
                let private = rsa::RsaPrivateKey::from_pkcs8_der(&key)
                    .map_err(|_| err("DataError", "invalid PKCS#8"))?;
                return Ok(text(json!({
                    "data": BASE64.encode(
                        private
                            .to_pkcs8_der()
                            .map_err(|_| err("OperationError", "could not encode PKCS#8"))?
                            .as_bytes(),
                    ),
                })));
            }
            if format == "jwk" {
                if is_private {
                    let private = rsa::RsaPrivateKey::from_pkcs8_der(&key)
                        .map_err(|_| err("DataError", "invalid PKCS#8"))?;
                    let public = private.to_public_key();
                    let (n, e) = rsa_public_jwk(&public);
                    use rsa::traits::PrivateKeyParts as _;
                    let primes = private.primes();
                    if primes.len() != 2 {
                        return Err(err("NotSupportedError", "a multi-prime RSA key is not supported"));
                    }
                    let (p, q) = (&primes[0], &primes[1]);
                    return Ok(text(json!({
                        "e": e,
                        "n": n,
                        "d": b64url_encode(&private.d().to_bytes_be()),
                        "p": b64url_encode(&p.to_bytes_be()),
                        "q": b64url_encode(&q.to_bytes_be()),
                        "dp": b64url_encode(&crt(&private, |key| key.dp())?),
                        "dq": b64url_encode(&crt(&private, |key| key.dq())?),
                        "qi": b64url_encode(&qinv_bytes(&private)?),
                    })));
                }
                let public = rsa::RsaPublicKey::from_public_key_der(&key)
                    .map_err(|_| err("DataError", "invalid SPKI"))?;
                let (n, e) = rsa_public_jwk(&public);
                return Ok(text(json!({ "e": e, "n": n })));
            }
            Err(err(
                "NotSupportedError",
                format!("unsupported RSA key format {format}"),
            ))
        }
        "rsa_sign" => {
            let kind = field(&request, "kind")?.as_str().unwrap_or("");
            let hash = hash_name(&request)?;
            let salt_len = request
                .get("saltLength")
                .and_then(Value::as_i64)
                .map(|value| value.max(0) as usize);
            let key = decode_b64(request.get("key"), "key")?;
            let data = decode_b64(request.get("data"), "data")?;
            Ok(text(json!({
                "sig": BASE64.encode(&rsa_sign(kind, hash, salt_len, &key, &data)?),
            })))
        }
        "rsa_verify" => {
            let kind = field(&request, "kind")?.as_str().unwrap_or("");
            let hash = hash_name(&request)?;
            let salt_len = request
                .get("saltLength")
                .and_then(Value::as_i64)
                .map(|value| value.max(0) as usize);
            let key = decode_b64(request.get("key"), "key")?;
            let signature = decode_b64(request.get("signature"), "signature")?;
            let data = decode_b64(request.get("data"), "data")?;
            let ok = rsa_verify(kind, hash, salt_len, &key, &signature, &data)?;
            Ok(text(json!({ "ok": ok })))
        }
        "rsa_encrypt" => {
            let hash = hash_name(&request)?;
            let label = oaep_label(&request)?;
            let key = decode_b64(request.get("key"), "key")?;
            let data = decode_b64(request.get("data"), "data")?;
            Ok(text(json!({
                "data": BASE64.encode(&rsa_encrypt(hash, label, &key, &data)?),
            })))
        }
        "rsa_decrypt" => {
            let hash = hash_name(&request)?;
            let label = oaep_label(&request)?;
            let key = decode_b64(request.get("key"), "key")?;
            let data = decode_b64(request.get("data"), "data")?;
            Ok(text(json!({
                "data": BASE64.encode(&rsa_decrypt(hash, label, &key, &data)?),
            })))
        }
        other => Err(err(
            "NotSupportedError",
            format!("unsupported asymmetric command {other}"),
        )),
    }
}
