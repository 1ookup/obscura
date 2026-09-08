if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.subtle) {
  // Real WebCrypto for the secret-key algorithms sites actually use: HMAC,
  // AES-GCM/CBC/CTR, PBKDF2 and HKDF, plus raw/JWK-oct key handling. The crypto
  // itself runs in Rust ops (RustCrypto); this shim only marshals bytes and
  // normalizes algorithm parameters. Public-key algorithms (RSA*, ECDSA, ECDH)
  // and non-symmetric key formats (pkcs8/spki) are not implemented and throw
  // NotSupportedError rather than returning fake data.
  const keyMaterial = new WeakMap();

  class CryptoKey {
    constructor() { throw new TypeError("Illegal constructor"); }
    get [Symbol.toStringTag]() { return "CryptoKey"; }
  }
  function makeKey(type, extractable, algorithm, usages, bytes) {
    const k = Object.create(CryptoKey.prototype);
    Object.defineProperty(k, "type", { value: type, enumerable: true });
    Object.defineProperty(k, "extractable", { value: !!extractable, enumerable: true });
    Object.defineProperty(k, "algorithm", { value: algorithm, enumerable: true });
    Object.defineProperty(k, "usages", { value: Object.freeze((usages || []).slice()), enumerable: true });
    keyMaterial.set(k, bytes);
    return k;
  }
  function keyBytes(key) {
    if (!(key instanceof CryptoKey) || !keyMaterial.has(key)) {
      throw new DOMException("Argument is not a valid CryptoKey", "InvalidAccessError");
    }
    return keyMaterial.get(key);
  }
  // A CryptoKey cloned via structuredClone or postMessage is a different
  // object, so the WeakMap lookup above misses and crypto.subtle throws
  // "Argument is not a valid CryptoKey". Re-register the (cloned) key's
  // material so the clone stays usable. The clone hook is dispatched by
  // _structuredClone via Symbol.toStringTag ("CryptoKey"); registered lazily
  // because structuredClone is defined before this block (issue #389).
  globalThis.__obscura_clone_hooks = globalThis.__obscura_clone_hooks || {};
  // `seen` is the clone memo _structuredClone hands every hook. Populate it so
  // one key reached twice in a graph clones to one shared object (and its key
  // material is registered once), matching structuredClone's identity rules.
  globalThis.__obscura_clone_hooks["CryptoKey"] = function (src, seen) {
    if (seen && seen.has(src)) return seen.get(src);
    const copy = makeKey(src.type, src.extractable, src.algorithm, src.usages, keyBytes(src));
    if (seen) seen.set(src, copy);
    return copy;
  };

  const toBytes = (data) => {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data || []);
  };
  const bufferOf = (u8) => new Uint8Array(u8).buffer;

  const ALGO_CANON = {
    "AES-CTR": "AES-CTR", "AES-CBC": "AES-CBC", "AES-GCM": "AES-GCM", "AES-KW": "AES-KW",
    "HMAC": "HMAC", "PBKDF2": "PBKDF2", "HKDF": "HKDF",
    "RSASSA-PKCS1-V1_5": "RSASSA-PKCS1-v1_5", "RSA-PSS": "RSA-PSS", "RSA-OAEP": "RSA-OAEP",
    "ECDSA": "ECDSA", "ECDH": "ECDH",
  };
  function normalizeAlgo(algorithm) {
    const a = typeof algorithm === "string" ? { name: algorithm } : (algorithm || {});
    const upper = String(a.name || "").toUpperCase();
    const name = ALGO_CANON[upper] || upper;
    return Object.assign({}, a, { name });
  }
  // SubtleCrypto hashes for HMAC/PBKDF2/HKDF and digest (SHA-1/256/384/512).
  function normalizeHash(h) {
    const n = (typeof h === "string" ? h : (h && h.name) || "").toUpperCase().replace("_", "-");
    if (n === "SHA-1" || n === "SHA-256" || n === "SHA-384" || n === "SHA-512") return n;
    throw new DOMException("Unsupported hash algorithm: " + (h && (h.name || h)), "NotSupportedError");
  }
  const hashBlockSize = (hash) => (hash === "SHA-384" || hash === "SHA-512" ? 128 : 64);

  function b64urlToBytes(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Run an op, converting a Rust-side failure (bad GCM tag, bad CBC padding)
  // into the OperationError the WebCrypto spec requires. DOMExceptions we raise
  // ourselves pass through unchanged.
  function runOp(fn) {
    try { return fn(); }
    catch (e) {
      if (e instanceof DOMException) throw e;
      throw new DOMException(String((e && e.message) || e), "OperationError");
    }
  }

  function keyAlgorithmFor(alg, bytes) {
    switch (alg.name) {
      case "HMAC":
        return { name: "HMAC", hash: { name: normalizeHash(alg.hash) }, length: bytes.length * 8 };
      case "AES-CTR": case "AES-CBC": case "AES-GCM": case "AES-KW":
        if (bytes.length !== 16 && bytes.length !== 24 && bytes.length !== 32) {
          throw new DOMException("AES key data must be 128, 192, or 256 bits", "DataError");
        }
        return { name: alg.name, length: bytes.length * 8 };
      case "PBKDF2": return { name: "PBKDF2" };
      case "HKDF": return { name: "HKDF" };
      default:
        throw new DOMException("Unsupported key algorithm: " + alg.name, "NotSupportedError");
    }
  }

  const subtle = {
    async digest(algorithm, data) {
      const name = (typeof algorithm === "string" ? algorithm : algorithm && algorithm.name || "").toUpperCase().replace("_", "-");
      if (name !== "SHA-1" && name !== "SHA-256" && name !== "SHA-384" && name !== "SHA-512" &&
          name !== "SHA-512/224" && name !== "SHA-512/256") {
        throw new DOMException("Unrecognized algorithm name", "NotSupportedError");
      }
      return bufferOf(Deno.core.ops.op_subtle_digest(name, toBytes(data)));
    },

    async importKey(format, keyData, algorithm, extractable, keyUsages) {
      const alg = normalizeAlgo(algorithm);
      let bytes;
      if (format === "raw") {
        bytes = toBytes(keyData);
      } else if (format === "jwk") {
        if (!keyData || keyData.kty !== "oct" || typeof keyData.k !== "string") {
          throw new DOMException("Only symmetric 'oct' JWK keys are supported", "NotSupportedError");
        }
        bytes = b64urlToBytes(keyData.k);
      } else {
        throw new DOMException("Only 'raw' and symmetric 'jwk' key formats are supported", "NotSupportedError");
      }
      return makeKey("secret", extractable, keyAlgorithmFor(alg, bytes), keyUsages, bytes);
    },

    async exportKey(format, key) {
      const bytes = keyBytes(key);
      if (!key.extractable) throw new DOMException("Key is not extractable", "InvalidAccessError");
      if (format === "raw") return bufferOf(bytes);
      if (format === "jwk") {
        const jwk = { kty: "oct", k: bytesToB64url(bytes), ext: key.extractable, key_ops: key.usages.slice() };
        if (key.algorithm.name && key.algorithm.name.indexOf("AES-") === 0) {
          jwk.alg = "A" + (bytes.length * 8) + key.algorithm.name.slice(4);
        } else if (key.algorithm.name === "HMAC") {
          jwk.alg = "HS" + key.algorithm.hash.name.slice(4);
        }
        return jwk;
      }
      throw new DOMException("Only 'raw' and 'jwk' export is supported", "NotSupportedError");
    },

    async generateKey(algorithm, extractable, keyUsages) {
      const alg = normalizeAlgo(algorithm);
      if (alg.name === "HMAC") {
        const hash = normalizeHash(alg.hash);
        const len = alg.length ? Math.ceil(alg.length / 8) : hashBlockSize(hash);
        const bytes = Deno.core.ops.op_random_bytes(len);
        return makeKey("secret", extractable, { name: "HMAC", hash: { name: hash }, length: len * 8 }, keyUsages, bytes);
      }
      if (alg.name === "AES-CTR" || alg.name === "AES-CBC" || alg.name === "AES-GCM" || alg.name === "AES-KW") {
        if (alg.length !== 128 && alg.length !== 192 && alg.length !== 256) {
          throw new DOMException("AES key length must be 128, 192, or 256 bits", "OperationError");
        }
        const bytes = Deno.core.ops.op_random_bytes(alg.length / 8);
        return makeKey("secret", extractable, { name: alg.name, length: alg.length }, keyUsages, bytes);
      }
      throw new DOMException("generateKey does not support " + alg.name, "NotSupportedError");
    },

    async sign(algorithm, key, data) {
      const alg = normalizeAlgo(algorithm);
      const bytes = keyBytes(key);
      if (alg.name === "HMAC") {
        const hash = key.algorithm && key.algorithm.hash ? key.algorithm.hash.name : normalizeHash(alg.hash);
        return bufferOf(runOp(() => Deno.core.ops.op_subtle_hmac(hash, bytes, toBytes(data))));
      }
      throw new DOMException("sign does not support " + alg.name, "NotSupportedError");
    },

    async verify(algorithm, key, signature, data) {
      const alg = normalizeAlgo(algorithm);
      const bytes = keyBytes(key);
      if (alg.name === "HMAC") {
        const hash = key.algorithm && key.algorithm.hash ? key.algorithm.hash.name : normalizeHash(alg.hash);
        const mac = runOp(() => Deno.core.ops.op_subtle_hmac(hash, bytes, toBytes(data)));
        const sig = toBytes(signature);
        if (sig.length !== mac.length) return false;
        let diff = 0;
        for (let i = 0; i < mac.length; i++) diff |= mac[i] ^ sig[i];
        return diff === 0;
      }
      throw new DOMException("verify does not support " + alg.name, "NotSupportedError");
    },

    async encrypt(algorithm, key, data) { return aesCipher(true, algorithm, key, data); },
    async decrypt(algorithm, key, data) { return aesCipher(false, algorithm, key, data); },

    async deriveBits(algorithm, baseKey, length) {
      const alg = normalizeAlgo(algorithm);
      const bytes = keyBytes(baseKey);
      const lenBytes = Math.ceil((length || 0) / 8);
      if (alg.name === "PBKDF2") {
        const hash = normalizeHash(alg.hash);
        const salt = toBytes(alg.salt);
        const iterations = alg.iterations >>> 0;
        return bufferOf(runOp(() => Deno.core.ops.op_subtle_pbkdf2(hash, bytes, salt, iterations, lenBytes)));
      }
      if (alg.name === "HKDF") {
        const hash = normalizeHash(alg.hash);
        const salt = alg.salt != null ? toBytes(alg.salt) : new Uint8Array(0);
        const info = alg.info != null ? toBytes(alg.info) : new Uint8Array(0);
        return bufferOf(runOp(() => Deno.core.ops.op_subtle_hkdf(hash, bytes, salt, info, lenBytes)));
      }
      throw new DOMException("deriveBits does not support " + alg.name, "NotSupportedError");
    },

    async deriveKey(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) {
      const dAlg = normalizeAlgo(derivedKeyAlgorithm);
      let bits;
      if (dAlg.name === "HMAC") {
        bits = dAlg.length || hashBlockSize(normalizeHash(dAlg.hash)) * 8;
      } else if (dAlg.name === "AES-CTR" || dAlg.name === "AES-CBC" || dAlg.name === "AES-GCM" || dAlg.name === "AES-KW") {
        bits = dAlg.length;
        if (bits !== 128 && bits !== 192 && bits !== 256) {
          throw new DOMException("AES key length must be 128, 192, or 256 bits", "OperationError");
        }
      } else {
        throw new DOMException("deriveKey does not support deriving " + dAlg.name, "NotSupportedError");
      }
      const derivedBits = await this.deriveBits(algorithm, baseKey, bits);
      return this.importKey("raw", derivedBits, derivedKeyAlgorithm, extractable, keyUsages);
    },

    async wrapKey(format, key, wrappingKey, wrapAlgorithm) {
      const exported = await this.exportKey(format, key);
      const bytes = format === "jwk"
        ? new TextEncoder().encode(JSON.stringify(exported))
        : new Uint8Array(exported);
      return this.encrypt(wrapAlgorithm, wrappingKey, bytes);
    },

    async unwrapKey(format, wrappedKey, unwrappingKey, unwrapAlgorithm, unwrappedKeyAlgorithm, extractable, keyUsages) {
      const decrypted = await this.decrypt(unwrapAlgorithm, unwrappingKey, wrappedKey);
      const keyData = format === "jwk"
        ? JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)))
        : decrypted;
      return this.importKey(format, keyData, unwrappedKeyAlgorithm, extractable, keyUsages);
    },
  };

  function aesCipher(encrypt, algorithm, key, data) {
    const alg = normalizeAlgo(algorithm);
    const bytes = keyBytes(key);
    const input = toBytes(data);
    if (alg.name === "AES-GCM") {
      const iv = toBytes(alg.iv);
      const aad = alg.additionalData != null ? toBytes(alg.additionalData) : new Uint8Array(0);
      const tagLength = alg.tagLength == null ? 128 : alg.tagLength;
      if (tagLength !== 128) {
        throw new DOMException("Only a 128-bit AES-GCM tag length is supported", "NotSupportedError");
      }
      return bufferOf(runOp(() => Deno.core.ops.op_subtle_aes_gcm(encrypt, bytes, iv, aad, input)));
    }
    if (alg.name === "AES-CBC") {
      const iv = toBytes(alg.iv);
      return bufferOf(runOp(() => Deno.core.ops.op_subtle_aes_cbc(encrypt, bytes, iv, input)));
    }
    if (alg.name === "AES-CTR") {
      const counter = toBytes(alg.counter);
      const length = alg.length >>> 0;
      return bufferOf(runOp(() => Deno.core.ops.op_subtle_aes_ctr(bytes, counter, length, input)));
    }
    throw new DOMException((encrypt ? "encrypt" : "decrypt") + " does not support " + alg.name, "NotSupportedError");
  }

  globalThis.CryptoKey = CryptoKey;
  globalThis.SubtleCrypto = function SubtleCrypto() { throw new TypeError("Illegal constructor"); };
  Object.setPrototypeOf(subtle, globalThis.SubtleCrypto.prototype);
  globalThis.crypto.subtle = subtle;
}

