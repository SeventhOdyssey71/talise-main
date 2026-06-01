import "server-only";

import crypto from "node:crypto";
import { decode as cborDecode } from "cbor-x";

/**
 * Apple App Attest verification (F4). Implements the two verifications from
 * Apple's spec ("Validating Apps That Connect to Your Server"):
 *   - verifyAttestation: on register — decode the CBOR attestation, extract +
 *     return the credential P-256 public key, and run the deterministic checks
 *     (rpIdHash, AAGUID, signCount==0, nonce). The x5c chain → Apple App Attest
 *     Root CA is run when the root CA is pinned (see APPLE_APP_ATTEST_ROOT_CA);
 *     until a real device fixture validates it end-to-end this ships in
 *     log-mode (see lib/app-attest.ts appAttestMode()).
 *   - verifyAssertion: per money request — verify the ECDSA-P256 signature over
 *     SHA256(authenticatorData ‖ clientDataHash) against the stored key, the
 *     rpIdHash, and strict counter monotonicity (clone/replay defense). FULLY
 *     unit-tested against a synthetic key (see __tests__).
 *
 * Refs: developer.apple.com/documentation/devicecheck/
 *   establishing-your-app-s-integrity + validating-apps-that-connect-to-your-server
 */

// app id = "<TeamID>.<BundleID>" (Team 5N8DU2A9WH, bundle io.talise.app).
// Env-overridable so a re-provision doesn't need a deploy.
export function appAttestAppId(): string {
  return process.env.APP_ATTEST_APP_ID ?? "5N8DU2A9WH.io.talise.app";
}

// Pinned "Apple App Attestation Root CA". MUST be filled with the real PEM
// (apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem) before
// the attestation x5c chain can be enforced. When empty, the chain check is
// SKIPPED (and reported), so enforce-mode must not be enabled until this is set
// AND validated against a real device-captured attestation.
const APPLE_APP_ATTEST_ROOT_CA = process.env.APPLE_APP_ATTEST_ROOT_CA_PEM ?? "";

const NONCE_OID = "1.2.840.113635.100.8.2";

type AuthData = {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  aaguid: Buffer; // 16 bytes (present only in attestation authData)
  credentialPublicKeyDer: Buffer | null;
};

/**
 * Parse the WebAuthn-style authenticator data. Layout:
 *   rpIdHash[32] ‖ flags[1] ‖ signCount[4]  (assertion stops here)
 *   ‖ aaguid[16] ‖ credIdLen[2] ‖ credId[credIdLen] ‖ COSE_pubkey (attestation)
 */
function parseAuthData(authData: Buffer, withCredential: boolean): AuthData {
  if (authData.length < 37) throw new Error("authData too short");
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);
  if (!withCredential) {
    return { rpIdHash, flags, signCount, aaguid: Buffer.alloc(0), credentialPublicKeyDer: null };
  }
  const aaguid = authData.subarray(37, 53);
  const credIdLen = authData.readUInt16BE(53);
  const credIdEnd = 55 + credIdLen;
  const coseRaw = authData.subarray(credIdEnd);
  const cose = cborDecode(coseRaw) as Map<number, unknown> | Record<number, unknown>;
  const get = (k: number): unknown =>
    cose instanceof Map ? cose.get(k) : (cose as Record<number, unknown>)[k];
  // COSE EC2 / P-256: kty(1)=2, crv(-1)=1, x(-2)=32B, y(-3)=32B.
  if (Number(get(1)) !== 2 || Number(get(-1)) !== 1) {
    throw new Error("credential key is not COSE EC2 P-256");
  }
  const x = Buffer.from(get(-2) as Uint8Array);
  const y = Buffer.from(get(-3) as Uint8Array);
  if (x.length !== 32 || y.length !== 32) throw new Error("bad EC point length");
  return {
    rpIdHash,
    flags,
    signCount,
    aaguid,
    credentialPublicKeyDer: p256RawToDerSpki(x, y),
  };
}

/** Wrap an uncompressed P-256 point (x,y) in the fixed SPKI ASN.1 header → DER. */
function p256RawToDerSpki(x: Buffer, y: Buffer): Buffer {
  const SPKI_P256_PREFIX = Buffer.from(
    "3059301306072a8648ce3d020106082a8648ce3d030107034200",
    "hex"
  );
  return Buffer.concat([SPKI_P256_PREFIX, Buffer.from([0x04]), x, y]);
}

function sha256(...parts: Buffer[]): Buffer {
  const h = crypto.createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

export type AttestationResult = {
  publicKeyDer: Buffer;
  signCount: number;
  /** Whether the full x5c→Apple-root chain + nonce verified (vs deterministic-only). */
  chainVerified: boolean;
  warnings: string[];
};

/**
 * Verify a registration attestation and return the credential public key to
 * store. Throws on a deterministic failure (bad rpIdHash / AAGUID / signCount /
 * malformed). The x5c chain + nonce are verified only when the Apple root CA is
 * pinned; otherwise `chainVerified=false` + a warning (caller decides per mode).
 */
export function verifyAttestation(input: {
  attestationBase64: string;
  challenge: string; // the base64 challenge string the client attested over
  appId?: string;
}): AttestationResult {
  const appId = input.appId ?? appAttestAppId();
  const obj = cborDecode(Buffer.from(input.attestationBase64, "base64")) as {
    fmt?: string;
    attStmt?: { x5c?: Uint8Array[]; receipt?: Uint8Array };
    authData?: Uint8Array;
  };
  if (obj.fmt !== "apple-appattest") throw new Error(`bad fmt ${obj.fmt}`);
  if (!obj.authData) throw new Error("missing authData");
  const authData = Buffer.from(obj.authData);
  const ad = parseAuthData(authData, true);

  // Deterministic checks (no Apple cert needed).
  if (!ad.rpIdHash.equals(sha256(Buffer.from(appId, "utf8")))) {
    throw new Error("rpIdHash mismatch");
  }
  if (ad.signCount !== 0) throw new Error(`attestation signCount ${ad.signCount} != 0`);
  const aaguidStr = ad.aaguid.toString("utf8").replace(/\0+$/, "");
  if (aaguidStr !== "appattest" && aaguidStr !== "appattestdevelop") {
    throw new Error(`unexpected AAGUID "${aaguidStr}"`);
  }
  if (!ad.credentialPublicKeyDer) throw new Error("no credential public key");

  const warnings: string[] = [];
  let chainVerified = false;
  const x5c = obj.attStmt?.x5c;
  if (!x5c || x5c.length === 0) {
    warnings.push("no x5c in attestation");
  } else if (!APPLE_APP_ATTEST_ROOT_CA) {
    warnings.push(
      "APPLE_APP_ATTEST_ROOT_CA_PEM unset — x5c chain + nonce NOT verified (do not enforce until pinned + device-validated)"
    );
  } else {
    // Full chain + nonce verification (runs once the root CA is pinned).
    try {
      const credCert = new crypto.X509Certificate(Buffer.from(x5c[0]));
      const root = new crypto.X509Certificate(APPLE_APP_ATTEST_ROOT_CA);
      // Walk x5c → root: each cert issued by the next, last issued by root.
      let ok = true;
      for (let i = 0; i < x5c.length; i++) {
        const cur = new crypto.X509Certificate(Buffer.from(x5c[i]));
        const issuer =
          i + 1 < x5c.length
            ? new crypto.X509Certificate(Buffer.from(x5c[i + 1]))
            : root;
        if (!cur.checkIssued(issuer) || !cur.verify(issuer.publicKey)) {
          ok = false;
          break;
        }
      }
      // nonce = SHA256(authData ‖ SHA256(challenge)); must equal the
      // 1.2.840.113635.100.8.2 extension's embedded octet string.
      const expectedNonce = sha256(authData, sha256(Buffer.from(input.challenge, "utf8")));
      const certNonce = readNonceExtension(Buffer.from(credCert.raw));
      const nonceOk = certNonce != null && certNonce.equals(expectedNonce);
      chainVerified = ok && nonceOk;
      if (!chainVerified) {
        warnings.push(`chain ok=${ok} nonceOk=${nonceOk} (OID ${NONCE_OID})`);
      }
    } catch (e) {
      warnings.push(`chain verify error: ${(e as Error).message}`);
    }
  }

  return { publicKeyDer: ad.credentialPublicKeyDer, signCount: ad.signCount, chainVerified, warnings };
}

/**
 * Minimal ASN.1 walk to pull the 32-byte nonce out of the credCert's
 * 1.2.840.113635.100.8.2 extension (OCTET STRING → SEQUENCE → [1] → OCTET
 * STRING(32)). Returns null if not found. Best-effort; only used when the
 * root CA is pinned, and gated behind device-fixture validation.
 */
function readNonceExtension(certDer: Buffer): Buffer | null {
  // Apple's nonce extension wraps a 32-byte octet string; rather than a full
  // DER parser, locate the OID bytes then the trailing 32-byte octet string.
  const oidBytes = Buffer.from("2a864886f763640802", "hex"); // 1.2.840.113635.100.8.2
  const idx = certDer.indexOf(oidBytes);
  if (idx < 0) return null;
  // Scan forward for an OCTET STRING (0x04) of length 0x20 (32).
  for (let i = idx; i < certDer.length - 34; i++) {
    if (certDer[i] === 0x04 && certDer[i + 1] === 0x20) {
      return certDer.subarray(i + 2, i + 34);
    }
  }
  return null;
}

export type AssertionResult = { newCounter: number };

/**
 * Verify a per-request assertion. Throws on failure. FULLY testable with a
 * synthetic P-256 key (no Apple cert involved — the attested key was captured
 * at register time).
 */
export function verifyAssertion(input: {
  assertionBase64: string;
  clientDataHash: Buffer; // SHA256(rawRequestBody)
  publicKeyDer: Buffer; // the stored P-256 SPKI DER from verifyAttestation
  storedCounter: number;
  appId?: string;
}): AssertionResult {
  const appId = input.appId ?? appAttestAppId();
  const obj = cborDecode(Buffer.from(input.assertionBase64, "base64")) as {
    signature?: Uint8Array;
    authenticatorData?: Uint8Array;
  };
  if (!obj.signature || !obj.authenticatorData) throw new Error("malformed assertion");
  const authData = Buffer.from(obj.authenticatorData);
  const ad = parseAuthData(authData, false);

  if (!ad.rpIdHash.equals(sha256(Buffer.from(appId, "utf8")))) {
    throw new Error("assertion rpIdHash mismatch");
  }

  // Signature is ECDSA-P256 over SHA256(authenticatorData ‖ clientDataHash).
  // crypto.verify("sha256", data, key, sig) hashes `data` then ECDSA-verifies;
  // the Apple signature is DER-encoded (dsaEncoding default "der").
  const key = crypto.createPublicKey({ key: input.publicKeyDer, format: "der", type: "spki" });
  const data = Buffer.concat([authData, input.clientDataHash]);
  const sigOk = crypto.verify("sha256", data, key, Buffer.from(obj.signature));
  if (!sigOk) throw new Error("assertion signature invalid");

  // Strict counter monotonicity — defeats replay + cloned-key reuse.
  if (ad.signCount <= input.storedCounter) {
    throw new Error(`assertion counter ${ad.signCount} <= stored ${input.storedCounter}`);
  }

  return { newCounter: ad.signCount };
}
