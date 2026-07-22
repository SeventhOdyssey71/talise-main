import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2";
import { base64, base64urlnopad } from "@scure/base";
import * as Crypto from "expo-crypto";

/**
 * Low-level Sui/zkLogin crypto — pure JS, matching the iOS Swift exactly.
 * Ed25519 (CryptoKit Curve25519) + BLAKE2b-256 (pure-Swift Blake2b) + the same
 * base64 encodings. The ephemeral secret is 32 random bytes we generate here
 * with expo-crypto, so Ed25519 keygen/sign need no RNG polyfill.
 */

export const b64 = {
  encode: (b: Uint8Array): string => base64.encode(b),
  decode: (s: string): Uint8Array => base64.decode(s),
  /** base64URL, no padding (+→-, /→_, = stripped) — for the OAuth start pubkey. */
  encodeUrl: (b: Uint8Array): string => base64urlnopad.encode(b),
};

/** BLAKE2b-256 digest (32 bytes). */
export function blake2b256(msg: Uint8Array): Uint8Array {
  return blake2b(msg, { dkLen: 32 });
}

/** Ed25519 32-byte public key from a 32-byte secret seed. */
export function ed25519PublicKey(secret: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secret);
}

/** Ed25519 detached signature (64 bytes) over `msg`. */
export function ed25519Sign(msg: Uint8Array, secret: Uint8Array): Uint8Array {
  return ed25519.sign(msg, secret);
}

/** 32 cryptographically-random bytes (ephemeral Ed25519 secret seed). */
export function randomSecret(): Uint8Array {
  return Crypto.getRandomBytes(32);
}

/**
 * SuiRandomness.generate() — 16 random bytes → big-endian decimal string
 * (BN254-field-safe, base-10), the `jwtRandomness` the prover expects.
 */
export function randomnessDecimal(): string {
  const bytes = Crypto.getRandomBytes(16);
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  return n.toString(10);
}

export function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** ULEB128 encode a non-negative integer (BCS length prefix). */
export function uleb128(n: number): Uint8Array {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return new Uint8Array(out);
}
