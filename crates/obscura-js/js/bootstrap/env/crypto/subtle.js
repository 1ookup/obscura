if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.subtle) {
  // Real WebCrypto for the algorithms sites actually use: HMAC, AES-GCM/CBC/
  // CTR, PBKDF2 and HKDF, plus ECDSA, ECDH and the RSA family. The crypto
  // itself runs in Rust (RustCrypto); this shim only marshals bytes and
  // normalizes algorithm parameters.
  //
  // Secret keys live here as raw bytes. Public-key keys cross to Rust in one
  // canonical form per family, chosen so a key is never re-parsed into a
  // different shape than it was created with:
  //
  //   EC  private: the raw scalar;  EC  public: the SEC1 point (04 || X || Y)
  //   RSA private: PKCS#8 DER;      RSA public: SPKI DER
  const keyMaterial = new WeakMap();

  // The four attributes are IDL members of CryptoKey, so they live on the
  // prototype as accessors and are computed per read: `key.usages` hands back a
  // fresh array and `key.algorithm` a fresh object, so mutating either cannot
  // reach into the key. An own data property per instance would also show up in
  // Object.keys(key) and in the own-property list, where Chrome reports neither.
  class CryptoKey {
    constructor() { throw new TypeError("Illegal constructor"); }
    get [Symbol.toStringTag]() { return "CryptoKey"; }
  }
  const keyAttributes = new WeakMap();
  function algorithmCopy(algorithm) {
    const copy = { name: algorithm.name };
    if (algorithm.namedCurve !== undefined) copy.namedCurve = algorithm.namedCurve;
    if (algorithm.hash !== undefined) copy.hash = { name: algorithm.hash.name };
    if (algorithm.length !== undefined) copy.length = algorithm.length;
    if (algorithm.modulusLength !== undefined) copy.modulusLength = algorithm.modulusLength;
    if (algorithm.publicExponent !== undefined) {
      copy.publicExponent = new Uint8Array(algorithm.publicExponent);
    }
    return copy;
  }
  for (const attribute of ["type", "extractable", "algorithm", "usages"]) {
    Object.defineProperty(CryptoKey.prototype, attribute, {
      get: function () {
        const slots = keyAttributes.get(this);
        if (!slots) throw new TypeError("Illegal invocation");
        if (attribute === "algorithm") return algorithmCopy(slots.algorithm);
        if (attribute === "usages") return slots.usages.slice();
        return slots[attribute];
      },
      enumerable: true,
      configurable: true,
    });
  }
  function makeKey(type, extractable, algorithm, usages, material) {
    const k = Object.create(CryptoKey.prototype);
    keyAttributes.set(k, {
      type,
      extractable: !!extractable,
      algorithm: algorithmCopy(algorithm),
      usages: (usages || []).slice(),
    });
    keyMaterial.set(k, material);
    return k;
  }
  function keyMaterialOf(key) {
    if (!(key instanceof CryptoKey) || !keyMaterial.has(key)) {
      throw new DOMException("Argument is not a valid CryptoKey", "InvalidAccessError");
    }
    return keyMaterial.get(key);
  }
  // Secret-key ops take raw bytes; asymmetric ones take the record described
  // above. `keyBytes` keeps the secret-key call sites reading as before.
  function keyBytes(key) {
    const material = keyMaterialOf(key);
    if (material instanceof Uint8Array) return material;
    throw new DOMException("Argument is not a valid CryptoKey", "InvalidAccessError");
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
    const copy = makeKey(src.type, src.extractable, src.algorithm, src.usages, keyMaterialOf(src));
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
  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(s) {
    const bin = atob(String(s == null ? "" : s));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
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

  // ---------------------------------------------------------------------
  // Public-key support
  // ---------------------------------------------------------------------

  // The usage each algorithm exposes on each half of a key pair, in the order
  // WebCrypto reports them back. Chrome returns ECDH private usages as
  // ["deriveKey","deriveBits"] and RSA-OAEP as ["decrypt","unwrapKey"], so the
  // arrays are also the canonical ordering.
  const ASYM_USAGES = {
    "ECDSA": { private: ["sign"], public: ["verify"] },
    "ECDH": { private: ["deriveKey", "deriveBits"], public: [] },
    "RSA-OAEP": { private: ["decrypt", "unwrapKey"], public: ["encrypt", "wrapKey"] },
    "RSASSA-PKCS1-v1_5": { private: ["sign"], public: ["verify"] },
    "RSA-PSS": { private: ["sign"], public: ["verify"] },
  };
  const ASYM_NAMES = Object.keys(ASYM_USAGES);
  const isAsymmetric = (name) => Object.prototype.hasOwnProperty.call(ASYM_USAGES, name);
  const CURVES = { "P-256": 32, "P-384": 48, "P-521": 66 };
  const RSA_ALGORITHMS = { "RSA-OAEP": 1, "RSA-PSS": 1, "RSASSA-PKCS1-V1_5": 1 };

  // Usages a caller may request are limited by the half of the pair; anything
  // outside that set is the spec's SyntaxError, not a silently dropped entry.
  function pickUsages(name, half, usages) {
    const allowed = ASYM_USAGES[name][half];
    const requested = [];
    for (const usage of usages || []) {
      const text = String(usage);
      if (allowed.indexOf(text) < 0) {
        throw new DOMException("Cannot create a key using the specified key usages.", "SyntaxError");
      }
      if (requested.indexOf(text) < 0) requested.push(text);
    }
    return allowed.filter((usage) => requested.indexOf(usage) >= 0);
  }
  // `generateKey` is asked for the usages of the pair, so a usage that only the
  // private half can hold is not an error there -- each half simply keeps the
  // subset that applies to it.
  function pickPairUsages(name, usages) {
    const table = ASYM_USAGES[name];
    const every = table.private.concat(table.public);
    const requested = [];
    for (const usage of usages || []) {
      const text = String(usage);
      if (every.indexOf(text) < 0) {
        throw new DOMException("Cannot create a key using the specified key usages.", "SyntaxError");
      }
      if (requested.indexOf(text) < 0) requested.push(text);
    }
    return {
      private: table.private.filter((usage) => requested.indexOf(usage) >= 0),
      public: table.public.filter((usage) => requested.indexOf(usage) >= 0),
    };
  }
  function requirePrivateUsages(usages) {
    if (!usages.length) {
      throw new DOMException("Usages cannot be empty when creating a key.", "SyntaxError");
    }
    return usages;
  }

  function ecCurveOf(algorithm, paramName) {
    const curve = algorithm.namedCurve;
    if (typeof curve !== "string") {
      throw new TypeError(paramName + ": namedCurve: Missing or not a string");
    }
    if (curve !== "P-256" && curve !== "P-384") {
      throw new DOMException(paramName + ": Unrecognized namedCurve", "NotSupportedError");
    }
    return curve;
  }
  function rsaHashOf(algorithm) {
    if (algorithm.hash === undefined || algorithm.hash === null) {
      throw new TypeError("RsaHashedKeyGenParams: hash: Missing or not an AlgorithmIdentifier");
    }
    return normalizeHash(algorithm.hash);
  }
  function uint8ArrayOfExponent(value) {
    if (!ArrayBuffer.isView(value) || value instanceof DataView) {
      throw new TypeError("RsaHashedKeyGenParams: publicExponent: Missing or not a Uint8Array");
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  function rsaAlgorithmObject(name, hash, modulusLength, publicExponent) {
    return {
      name,
      hash: { name: hash },
      modulusLength,
      publicExponent: new Uint8Array(publicExponent),
    };
  }
  function ecAlgorithmObject(name, namedCurve) {
    return { name, namedCurve };
  }

  // The op answers JSON; a failure carries the DOMException name the caller
  // must see, so map it back instead of flattening every failure to
  // OperationError.
  const OP_ERROR_NAMES = {
    DataError: 1, OperationError: 1, NotSupportedError: 1, InvalidAccessError: 1, SyntaxError: 1,
  };
  function opFailure(e) {
    const message = String((e && e.message) || e);
    const split = message.indexOf(": ");
    if (split > 0) {
      const name = message.slice(0, split);
      const detail = message.slice(split + 2);
      if (name === "TypeError") return new TypeError(detail);
      if (OP_ERROR_NAMES[name]) return new DOMException(detail, name);
    }
    return new DOMException(message, "OperationError");
  }
  function asymOp(command, request) {
    let reply;
    try {
      reply = Deno.core.ops.op_subtle_asym(command, JSON.stringify(request));
    } catch (e) {
      throw opFailure(e);
    }
    return JSON.parse(reply);
  }
  function keyMaterialRecord(key, name) {
    const material = keyMaterialOf(key);
    if (!material || material.asym !== name) {
      throw new DOMException("key.algorithm does not match that of operation", "InvalidAccessError");
    }
    return material;
  }
  function requireUsage(key, usage) {
    if (key.usages.indexOf(usage) < 0) {
      throw new DOMException("key.usages does not permit this operation", "InvalidAccessError");
    }
  }

  // Operation params carry their own hash for the algorithms whose spec puts
  // it there; RSA keys also record one, and Chrome falls back to it when the
  // operation omits it.
  function operationHash(algorithm, key, required) {
    if (algorithm.hash !== undefined && algorithm.hash !== null) return normalizeHash(algorithm.hash);
    const fromKey = key && key.algorithm && key.algorithm.hash;
    if (fromKey && fromKey.name) return normalizeHash(fromKey);
    if (required) throw new TypeError("EcdsaParams: hash: Missing or not an AlgorithmIdentifier");
    throw new DOMException("a hash is required", "NotSupportedError");
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
      if (isAsymmetric(alg.name)) {
        const isEc = alg.name === "ECDSA" || alg.name === "ECDH";
        const curve = isEc ? ecCurveOf(alg, "EcKeyImportParams") : null;
        const request = { format, type: "public", data: null };
        if (format === "raw") {
          if (!isEc) {
            throw new DOMException("Only EC keys can be imported in the 'raw' format", "NotSupportedError");
          }
          request.data = bytesToB64(toBytes(keyData));
        } else if (format === "spki" || format === "pkcs8") {
          if (format === "pkcs8") request.type = "private";
          request.data = bytesToB64(toBytes(keyData));
        } else if (format === "jwk") {
          if (!keyData || typeof keyData !== "object") {
            throw new DOMException("Argument 2 of SubtleCrypto.importKey is not an object", "DataError");
          }
          request.type = typeof keyData.d === "string" ? "private" : "public";
          if (keyData.kty !== (isEc ? "EC" : "RSA")) {
            throw new DOMException("The JWK \"kty\" member was inconsistent with that specified by the Web Crypto call", "DataError");
          }
          if (Array.isArray(keyData.key_ops)) {
            for (const op of keyData.key_ops) {
              if (keyUsages.indexOf(op) < 0) {
                throw new DOMException(
                  "The JWK \"key_ops\" member was inconsistent with that specified by the Web Crypto call. The JWK usage must be a superset of those requested",
                  "DataError");
              }
            }
          }
          request.data = keyData;
        } else {
          throw new DOMException("Unsupported key format: " + format, "NotSupportedError");
        }
        if (isEc) request.curve = curve;
        else request.hash = rsaHashOf(alg);
        const half = request.type === "private" ? "private" : "public";
        const usages = pickUsages(alg.name, half, keyUsages);
        if (half === "private") requirePrivateUsages(usages);
        if (half === "private" && format === "raw") {
          throw new DOMException("The key is not of the expected type", "InvalidAccessError");
        }
        const reply = asymOp(isEc ? "ec_import" : "rsa_import", request);
        const bytes = b64ToBytes(reply.key);
        const material = isEc
          ? { asym: alg.name, half, curve, bytes }
          : { asym: alg.name, half, curve: null, bytes };
        // An imported RSA key reports the modulus it actually carries, not
        // whatever the caller's algorithm object claimed.
        const keyAlgorithm = isEc
          ? ecAlgorithmObject(alg.name, curve)
          : rsaAlgorithmObject(
              alg.name,
              request.hash,
              isFinite(reply.modulusLength) ? reply.modulusLength : 0,
              b64ToBytes(reply.publicExponent),
            );
        return makeKey(half, extractable, keyAlgorithm, usages, material);
      }
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
      if (!key.extractable) throw new DOMException("key is not extractable", "InvalidAccessError");
      const material = keyMaterialOf(key);
      if (material && material.asym) {
        const isEc = material.asym === "ECDSA" || material.asym === "ECDH";
        const request = {
          format,
          type: material.half,
          curve: material.curve,
          key: bytesToB64(material.bytes),
        };
        if (!isEc) request.hash = key.algorithm.hash ? key.algorithm.hash.name : "SHA-256";
        const reply = asymOp(isEc ? "ec_export" : "rsa_export", request);
        if (format === "jwk") {
          const jwk = isEc
            ? { kty: "EC", crv: reply.crv, x: reply.x, y: reply.y }
            : { kty: "RSA", n: reply.n, e: reply.e };
          if (material.half === "private") {
            if (isEc) jwk.d = reply.d;
            else {
              jwk.d = reply.d; jwk.p = reply.p; jwk.q = reply.q;
              jwk.dp = reply.dp; jwk.dq = reply.dq; jwk.qi = reply.qi;
            }
          }
          // EC JWKs carry no `alg`; RSA ones name the hash they were made for.
          if (!isEc) {
            const suffix = key.algorithm.hash ? key.algorithm.hash.name.slice(4) : "";
            if (material.asym === "RSA-OAEP") jwk.alg = "RSA-OAEP-" + suffix;
            else if (material.asym === "RSA-PSS") jwk.alg = "PS" + suffix;
            else jwk.alg = "RS" + suffix;
          }
          jwk.ext = key.extractable;
          jwk.key_ops = key.usages.slice();
          // Chrome emits JWK members in alphabetical order.
          const ordered = {};
          for (const field of Object.keys(jwk).sort()) ordered[field] = jwk[field];
          return ordered;
        }
        if (format === "raw" && !isEc) {
          throw new DOMException("Unsupported key format: " + format, "NotSupportedError");
        }
        return b64ToBytes(reply.data).buffer;
      }
      const bytes = keyBytes(key);
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
      if (isAsymmetric(alg.name)) {
        const isEc = alg.name === "ECDSA" || alg.name === "ECDH";
        const pair = pickPairUsages(alg.name, keyUsages);
        const privateUsages = requirePrivateUsages(pair.private);
        const publicUsages = pair.public;
        const request = { kind: alg.name };
        let keyAlgorithm;
        if (isEc) {
          const curve = ecCurveOf(alg, "EcKeyGenParams");
          request.curve = curve;
          keyAlgorithm = ecAlgorithmObject(alg.name, curve);
        } else {
          const hash = rsaHashOf(alg);
          if (typeof alg.modulusLength !== "number") {
            throw new TypeError("RsaHashedKeyGenParams: modulusLength: Missing or not a number");
          }
          const exponent = uint8ArrayOfExponent(alg.publicExponent);
          request.modulusLength = alg.modulusLength;
          request.publicExponent = bytesToB64(exponent);
          request.hash = hash;
          keyAlgorithm = rsaAlgorithmObject(alg.name, hash, alg.modulusLength, exponent);
        }
        const reply = asymOp("generate", request);
        const materialFor = (half, record) => (isEc
          ? { asym: alg.name, half, curve: request.curve, bytes: record }
          : { asym: alg.name, half, curve: null, bytes: record });
        const publicKey = makeKey(
          "public",
          // A generated pair's public half is always extractable: it is not
          // secret, and the spec pins [[extractable]] to true for it.
          true,
          keyAlgorithm,
          publicUsages,
          materialFor("public", b64ToBytes(reply.public)),
        );
        const privateKey = makeKey(
          "private",
          extractable,
          keyAlgorithm,
          privateUsages,
          materialFor("private", b64ToBytes(reply.private)),
        );
        return { privateKey, publicKey };
      }
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
      if (alg.name === "ECDSA") {
        const material = keyMaterialRecord(key, alg.name);
        requireUsage(key, "sign");
        const hash = operationHash(alg, key, true);
        const reply = asymOp("ec_sign", {
          curve: material.curve,
          hash,
          key: bytesToB64(material.bytes),
          data: bytesToB64(toBytes(data)),
        });
        return b64ToBytes(reply.sig).buffer;
      }
      if (alg.name === "RSASSA-PKCS1-V1_5" || alg.name === "RSA-PSS") {
        const material = keyMaterialRecord(key, alg.name);
        requireUsage(key, "sign");
        const hash = operationHash(alg, key, true);
        const request = {
          kind: alg.name,
          hash,
          key: bytesToB64(material.bytes),
          data: bytesToB64(toBytes(data)),
        };
        if (alg.name === "RSA-PSS") request.saltLength = rsaSaltLength(alg);
        const reply = asymOp("rsa_sign", request);
        return b64ToBytes(reply.sig).buffer;
      }
      const bytes = keyBytes(key);
      if (alg.name === "HMAC") {
        const hash = key.algorithm && key.algorithm.hash ? key.algorithm.hash.name : normalizeHash(alg.hash);
        return bufferOf(runOp(() => Deno.core.ops.op_subtle_hmac(hash, bytes, toBytes(data))));
      }
      throw new DOMException("sign does not support " + alg.name, "NotSupportedError");
    },

    async verify(algorithm, key, signature, data) {
      const alg = normalizeAlgo(algorithm);
      if (alg.name === "ECDSA") {
        const material = keyMaterialRecord(key, alg.name);
        requireUsage(key, "verify");
        const hash = operationHash(alg, key, true);
        const reply = asymOp("ec_verify", {
          curve: material.curve,
          hash,
          key: bytesToB64(material.bytes),
          signature: bytesToB64(toBytes(signature)),
          data: bytesToB64(toBytes(data)),
        });
        return !!reply.ok;
      }
      if (alg.name === "RSASSA-PKCS1-V1_5" || alg.name === "RSA-PSS") {
        const material = keyMaterialRecord(key, alg.name);
        requireUsage(key, "verify");
        const hash = operationHash(alg, key, true);
        const request = {
          kind: alg.name,
          hash,
          key: bytesToB64(material.bytes),
          signature: bytesToB64(toBytes(signature)),
          data: bytesToB64(toBytes(data)),
        };
        // A PSS verification is only meaningful for the salt length that was
        // signed with, so the parameter is read here too.
        request.saltLength = rsaSaltLength(alg);
        const reply = asymOp("rsa_verify", request);
        return !!reply.ok;
      }
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

    async encrypt(algorithm, key, data) {
      const alg = normalizeAlgo(algorithm);
      if (alg.name === "RSA-OAEP") return rsaOaep(true, alg, key, data);
      return aesCipher(true, algorithm, key, data);
    },
    async decrypt(algorithm, key, data) {
      const alg = normalizeAlgo(algorithm);
      if (alg.name === "RSA-OAEP") return rsaOaep(false, alg, key, data);
      return aesCipher(false, algorithm, key, data);
    },

    async deriveBits(algorithm, baseKey) {
      const length = arguments[2];
      const alg = normalizeAlgo(algorithm);
      if (alg.name === "ECDH") return ecDerive(alg, baseKey, length);
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

  function rsaSaltLength(algorithm) {
    const saltLength = algorithm.saltLength;
    if (saltLength === undefined || saltLength === null) {
      throw new TypeError("RsaPssParams: saltLength: Missing required property");
    }
    return Math.trunc(Number(saltLength));
  }

  function ecDerive(algorithm, baseKey, length) {
    const material = keyMaterialRecord(baseKey, "ECDH");
    requireUsage(baseKey, "deriveBits");
    if (typeof length !== "number") {
      throw new TypeError("deriveBits: length: Missing or not a number");
    }
    const publicKey = algorithm.public;
    const peer = keyMaterialRecord(publicKey, "ECDH");
    if (peer.half !== "public") {
      throw new DOMException("key.usages does not permit this operation", "InvalidAccessError");
    }
    if (peer.curve !== material.curve) {
      throw new DOMException(
        "The public parameter for ECDH key derivation is for a different named curve",
        "InvalidAccessError");
    }
    const reply = asymOp("ec_derive", {
      curve: material.curve,
      private: bytesToB64(material.bytes),
      public: bytesToB64(peer.bytes),
      length: Math.max(0, length >>> 0),
    });
    return b64ToBytes(reply.bits).buffer;
  }

  function rsaOaep(encrypt, algorithm, key, data) {
    const material = keyMaterialRecord(key, "RSA-OAEP");
    requireUsage(key, encrypt ? "encrypt" : "decrypt");
    const hash = key.algorithm.hash ? key.algorithm.hash.name : "SHA-256";
    const request = {
      hash,
      key: bytesToB64(material.bytes),
      data: bytesToB64(toBytes(data)),
    };
    if (algorithm.label !== undefined && algorithm.label !== null) {
      request.label = bytesToB64(toBytes(algorithm.label));
    }
    const reply = asymOp(encrypt ? "rsa_encrypt" : "rsa_decrypt", request);
    return b64ToBytes(reply.data).buffer;
  }

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

  // `constructor` is defined first by class syntax; Chrome's native prototype
  // lists it last, and the four IDL attributes keep their declaration order.
  delete CryptoKey.prototype.constructor;
  Object.defineProperty(CryptoKey.prototype, "constructor", {
    value: CryptoKey, writable: true, enumerable: false, configurable: true,
  });

  globalThis.CryptoKey = CryptoKey;
  globalThis.SubtleCrypto = function SubtleCrypto() { throw new TypeError("Illegal constructor"); };
  const subtlePrototype = globalThis.SubtleCrypto.prototype;
  // Object.getOwnPropertyNames reports insertion order, and Chrome's
  // prototype lists the methods alphabetically with `constructor` last.
  for (const method of Object.keys(subtle).sort()) {
    Object.defineProperty(subtlePrototype, method, Object.getOwnPropertyDescriptor(subtle, method));
    delete subtle[method];
  }
  Object.defineProperty(subtlePrototype, "constructor", {
    value: globalThis.SubtleCrypto, writable: true, enumerable: false, configurable: true,
  });
  Object.setPrototypeOf(subtle, subtlePrototype);
  globalThis.crypto.subtle = subtle;
}
