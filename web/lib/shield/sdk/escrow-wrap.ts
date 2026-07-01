/**
 * Talise shielded-pool SDK — NON-CUSTODIAL note-master escrow envelope.
 *
 * The note master is the root of a user's shielded notes (see keys.ts). Its
 * PRIMARY copy lives on-device (iCloud-synchronizable Keychain); the server
 * escrow (`/api/shield/key-escrow`) is the RECOVERY rail for a reinstall /
 * device switch.
 *
 * Before this module the master was escrowed in PLAINTEXT — so the operator
 * could restore any user's master, derive their viewing key, and read every
 * shielded amount. That made "the amount is hidden on-chain" true against the
 * public but FALSE against Talise. This module wraps the master under a key
 * derived from a USER-HELD recovery code, so the server stores only ciphertext
 * it cannot open. The operator can no longer read the escrowed master — the
 * escrow becomes a blind blob store.
 *
 * ── Envelope (versioned) ────────────────────────────────────────────────────
 *
 *   "tsw1:" ‖ base64( salt(16) ‖ iv(12) ‖ ciphertext+tag )
 *   wrapKey = PBKDF2-SHA256(recoveryCode, salt, PBKDF2_ITERS) → AES-256
 *   ct,tag  = AES-256-GCM(wrapKey, iv, noteMaster)
 *
 * The "tsw1:" prefix lets the server (and the client) distinguish a wrapped
 * envelope from a legacy plaintext-hex master WITHOUT parsing it — the server
 * never needs to understand the contents.
 *
 * The recovery code carries the entropy (128 bits, generated — never
 * user-chosen); PBKDF2 only slows an offline guess of a weak code. Pure
 * WebCrypto (`crypto.subtle`) + bigint-free — importable from the client, the
 * Next.js server runtime, and Vitest alike.
 */

/** Envelope version prefix. Bump only with a migration — old blobs must still
 *  round-trip. */
export const WRAP_PREFIX = "tsw1:";

const SALT_LEN = 16;
const IV_LEN = 12; // AES-GCM 96-bit nonce
/** OWASP-2023 floor for PBKDF2-HMAC-SHA256. The code is already 128-bit, so
 *  this is defense-in-depth, not the primary barrier. */
const PBKDF2_ITERS = 600_000;

// Crockford base32 alphabet (no I/L/O/U — unambiguous when a human reads it
// off a screen and types it back).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle unavailable; cannot wrap note master");
  }
  return subtle;
}

/**
 * Copy into a view backed by an exact `ArrayBuffer` (not `SharedArrayBuffer`)
 * so the `BufferSource` type is precise across DOM/Node lib variants. Mirrors
 * the idiom in encrypt.ts / keys.ts.
 */
function toArrayBufferView(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(data.length);
  const view = new Uint8Array(buf);
  view.set(data);
  return view;
}

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    throw new Error("crypto.getRandomValues unavailable");
  }
  c.getRandomValues(out);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  // Node fallback.
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Generate a 128-bit recovery code as grouped Crockford base32:
 * `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (26 significant chars). Shown to the user
 * ONCE at shield onboarding; it is the only secret that can restore the
 * escrowed master, so the operator can never recover it for them. Store it like
 * a seed phrase.
 */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16); // 128 bits
  // Encode 16 bytes → base32 (5 bits/char → 26 chars, last carries 128 mod 5 = 3 padding bits).
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  // Group into blocks of 4 for readability.
  return (out.match(/.{1,4}/g) ?? [out]).join("-");
}

/**
 * Normalize a recovery code for key derivation: strip spaces/dashes, uppercase,
 * and map the common human confusions (I/L→1, O→0) into the Crockford
 * alphabet. Derivation is over this canonical form so how the user types the
 * separators doesn't matter.
 */
export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/** True iff `s` is a wrapped envelope (vs. a legacy plaintext-hex master). */
export function isWrappedEnvelope(s: string): boolean {
  return typeof s === "string" && s.startsWith(WRAP_PREFIX);
}

async function deriveWrapKey(
  subtle: SubtleCrypto,
  recoveryCode: string,
  salt: Uint8Array,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const codeBytes = new TextEncoder().encode(normalizeRecoveryCode(recoveryCode));
  const baseKey = await subtle.importKey(
    "raw",
    toArrayBufferView(codeBytes),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBufferView(salt),
      iterations: PBKDF2_ITERS,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

/**
 * Wrap a note master under a recovery code. Returns the versioned envelope
 * string to escrow. A fresh random salt + iv are generated per call, so
 * re-wrapping the same master yields a different (equally valid) envelope.
 */
export async function wrapNoteMaster(
  noteMaster: Uint8Array,
  recoveryCode: string
): Promise<string> {
  if (noteMaster.length < 16) {
    throw new Error("note master too short (need ≥16 bytes of entropy)");
  }
  if (normalizeRecoveryCode(recoveryCode).length < 16) {
    throw new Error("recovery code too short");
  }
  const subtle = requireSubtle();
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveWrapKey(subtle, recoveryCode, salt, ["encrypt"]);
  const ctBuf = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBufferView(iv) },
    key,
    toArrayBufferView(noteMaster)
  );
  const ct = new Uint8Array(ctBuf);
  const blob = new Uint8Array(salt.length + iv.length + ct.length);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(ct, salt.length + iv.length);
  return WRAP_PREFIX + bytesToBase64(blob);
}

/**
 * Unwrap an escrow envelope with the recovery code. Returns the note master
 * bytes, or throws on a wrong code / corrupt blob (AES-GCM authentication
 * failure). Pure inverse of {@link wrapNoteMaster}.
 */
export async function unwrapNoteMaster(
  envelope: string,
  recoveryCode: string
): Promise<Uint8Array> {
  if (!isWrappedEnvelope(envelope)) {
    throw new Error("not a wrapped escrow envelope");
  }
  const subtle = requireSubtle();
  const blob = base64ToBytes(envelope.slice(WRAP_PREFIX.length));
  if (blob.length <= SALT_LEN + IV_LEN) {
    throw new Error("escrow envelope too short");
  }
  const salt = blob.subarray(0, SALT_LEN);
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const ct = blob.subarray(SALT_LEN + IV_LEN);
  const key = await deriveWrapKey(subtle, recoveryCode, salt, ["decrypt"]);
  const ptBuf = await subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBufferView(iv) },
    key,
    toArrayBufferView(ct)
  );
  return new Uint8Array(ptBuf);
}
