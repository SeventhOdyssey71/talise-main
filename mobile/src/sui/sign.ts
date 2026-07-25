import { utf8ToBytes } from "@noble/hashes/utils";

import { b64, blake2b256, concat, ed25519PublicKey, ed25519Sign, uleb128 } from "@/sui/crypto";
import { ephemeralKey } from "@/sui/ephemeral";

/**
 * Sign with the zkLogin ephemeral key, exactly as ios ZkLoginCoordinator does.
 * The ephemeral Ed25519 key signs the BLAKE2b-256 of the intent message; the
 * backend then assembles the full zkLoginSignature (proof + this sig + JWT meta).
 *
 * SerializedSignature = base64( 0x00 ‖ sig(64) ‖ ephemeralPubKey(32) )  (flag 0x00 = Ed25519)
 */
function serializedSignature(secret: Uint8Array, digest: Uint8Array): string {
  const sig = ed25519Sign(digest, secret);
  const pk = ed25519PublicKey(secret);
  return b64.encode(concat(new Uint8Array([0x00]), sig, pk));
}

/** Transaction signing: intent scope [0,0,0] ‖ txBytes → BLAKE2b-256 → Ed25519. */
export async function signTransactionBytes(txBytesB64: string): Promise<string> {
  const secret = await ephemeralKey.current();
  if (!secret) throw new Error("No ephemeral key present");
  const intent = concat(new Uint8Array([0, 0, 0]), b64.decode(txBytesB64));
  return serializedSignature(secret, blake2b256(intent));
}

/**
 * Personal-message signing (off-ramp bank attestation): BCS vector<u8> =
 * ULEB128(len) ‖ utf8(message); intent scope [3,0,0]; BLAKE2b-256 → Ed25519.
 */
export async function signPersonalMessage(message: string): Promise<string> {
  const secret = await ephemeralKey.current();
  if (!secret) throw new Error("No ephemeral key present");
  const utf8 = utf8ToBytes(message);
  const bcs = concat(uleb128(utf8.length), utf8);
  const intent = concat(new Uint8Array([3, 0, 0]), bcs);
  return serializedSignature(secret, blake2b256(intent));
}
