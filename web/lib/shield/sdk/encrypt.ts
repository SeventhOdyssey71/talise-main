/**
 * Talise shielded-pool SDK — note encryption (ECIES to recipient viewing key).
 *
 * Each `transact` carries two encrypted note outputs in `ExtData`
 * (`encrypted_output0/1`). The recipient trial-decrypts them (see scan.ts) with
 * their viewing key to discover incoming notes. Sender encrypts to the
 * recipient's viewing-key-derived public point.
 *
 * CRYPTO STATUS: STUBBED. A real impl needs ECIES over a curve compatible with
 * the viewing-key scalar (e.g. Baby Jubjub for in-circuit friendliness, or
 * X25519 with the viewing key as the static recipient key) + an AEAD
 * (AES-GCM / ChaCha20-Poly1305). Web Crypto provides AES-GCM + ECDH, but NOT
 * Baby Jubjub. We DELIBERATELY do not ship a hand-rolled curve here.
 *
 * The functions below define the SHAPE (so scan.ts + tx.ts compose) and encode
 * the plaintext deterministically, but the "encryption" is a reversible
 * obfuscation keyed by the viewing key — NOT confidential. Replace before any
 * real use.
 */

import { BN254_SCALAR_FIELD } from "./keys";
import type { Note } from "./note";

/** Serialized note plaintext (amount, pubkey, blinding, pool) as 4×32B BE. */
export function encodeNotePlaintext(note: Note): Uint8Array {
  const out = new Uint8Array(128);
  writeField(out, 0, note.amount);
  writeField(out, 32, note.pubkey);
  writeField(out, 64, note.blinding);
  writeField(out, 96, note.pool);
  return out;
}

export function decodeNotePlaintext(bytes: Uint8Array): Note | null {
  if (bytes.length !== 128) return null;
  return {
    amount: readField(bytes, 0),
    pubkey: readField(bytes, 32),
    blinding: readField(bytes, 64),
    pool: readField(bytes, 96),
  };
}

/**
 * "Encrypt" a note to a recipient viewing key.
 *
 * STUB — NOT CONFIDENTIAL. XORs the plaintext with a viewing-key-derived
 * keystream so `decryptNote` round-trips and trial-decrypt can be exercised.
 * TODO(crypto): replace with real ECIES (ephemeral key ‖ AEAD ciphertext).
 */
export function encryptNote(note: Note, recipientViewingKey: bigint): Uint8Array {
  const pt = encodeNotePlaintext(note);
  const ks = keystream(recipientViewingKey, pt.length);
  const ct = new Uint8Array(pt.length);
  for (let i = 0; i < pt.length; i++) ct[i] = pt[i] ^ ks[i];
  return ct;
}

/**
 * Trial-decrypt a ciphertext with a viewing key. Returns the note iff the
 * round-trip yields a well-formed plaintext whose fields are valid field
 * elements (the cheap validity gate scan.ts relies on).
 *
 * STUB — see `encryptNote`.
 */
export function decryptNote(
  ciphertext: Uint8Array,
  viewingKey: bigint
): Note | null {
  if (ciphertext.length !== 128) return null;
  const ks = keystream(viewingKey, ciphertext.length);
  const pt = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) pt[i] = ciphertext[i] ^ ks[i];
  const note = decodeNotePlaintext(pt);
  if (!note) return null;
  // Reject if any field is out of range — a wrong key yields garbage that
  // usually overflows the field, giving trial-decrypt a (weak, stub-only)
  // accept/reject signal.
  if (
    note.amount >= BN254_SCALAR_FIELD ||
    note.pubkey >= BN254_SCALAR_FIELD ||
    note.blinding >= BN254_SCALAR_FIELD ||
    note.pool >= BN254_SCALAR_FIELD
  ) {
    return null;
  }
  return note;
}

// ── helpers (stub keystream + field I/O) ───────────────────────────────────

function keystream(key: bigint, len: number): Uint8Array {
  // Deterministic, NON-cryptographic byte expansion of `key`. Stub only.
  const out = new Uint8Array(len);
  let s = key % BN254_SCALAR_FIELD;
  for (let i = 0; i < len; i++) {
    s = (s * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    out[i] = Number(s & 0xffn);
  }
  return out;
}

function writeField(out: Uint8Array, offset: number, value: bigint): void {
  let v = value % BN254_SCALAR_FIELD;
  for (let i = 31; i >= 0; i--) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function readField(bytes: Uint8Array, offset: number): bigint {
  let acc = 0n;
  for (let i = 0; i < 32; i++) acc = (acc << 8n) | BigInt(bytes[offset + i]);
  return acc;
}
