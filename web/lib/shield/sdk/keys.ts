import { poseidonHash } from "@mysten/sui/zklogin";
/**
 * Talise shielded-pool SDK — deterministic key derivation.
 *
 * Importable from both server and client (no `server-only`, no Node-only deps).
 * NO new npm deps: uses Web Crypto (`globalThis.crypto.subtle`) + bigint only.
 *
 * Key model (PRIVACY-BUILD-PLAN.md Workstream C):
 *   spendingKey = hash(sign(FIXED_MSG)) mod r   (r = BN254 scalar field order)
 *   viewingKey  = Poseidon1(spendingKey)
 *   publicKey   = derived from spendingKey (commitment owner field)
 *
 * The user signs ONE fixed personal message with their zkLogin/wallet key; the
 * note master is the SHA-256 of that signature reduced mod r. This is
 * deterministic across devices (re-sign-in → re-derive → re-scan), so it is the
 * recovery rail.
 *
 * CRYPTO STATUS:
 *   • spendingKey derivation (sign → SHA-256 → mod r): REAL.
 *   • viewingKey = Poseidon1(spendingKey): STUBBED — see `poseidon1` below.
 *     Needs a BN254 Poseidon impl byte-identical to `sui::poseidon_bn254`.
 *   • publicKey: STUBBED — placeholder pending the circuit's pubkey definition.
 */

/** BN254 scalar field order r. Reductions for the note field live here. */
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * The fixed message the user signs to derive their note master. MUST be stable
 * forever — changing it orphans every existing note. Domain-separated.
 */
export const SHIELD_KEY_DERIVATION_MESSAGE =
  "talise.shield.note-master.v1";

export type ShieldKeypair = {
  /** Note spending key — a BN254 scalar. Keep secret; never leaves the device. */
  spendingKey: bigint;
  /** Viewing key — lets a holder trial-decrypt notes without spend authority. */
  viewingKey: bigint;
  /** Public key field element bound into note commitments. */
  publicKey: bigint;
};

/** Signs `SHIELD_KEY_DERIVATION_MESSAGE` and returns the raw signature bytes. */
export type PersonalMessageSigner = (message: Uint8Array) => Promise<Uint8Array>;

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle unavailable; cannot derive shield keys");
  }
  // Copy into a fresh ArrayBuffer-backed view so the BufferSource type is exact
  // across DOM/Node lib variants.
  const buf = new Uint8Array(data).buffer;
  const digest = await subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}

/**
 * Derive the shield keypair from a personal-message signer. The signer is the
 * user's zkLogin/wallet personal-message signing function — the same one used
 * elsewhere for `signPersonalMessage`.
 *
 * REAL: spendingKey = SHA-256(signature) mod r.
 * STUBBED: viewingKey + publicKey (Poseidon — see `poseidon1`).
 */
export async function deriveShieldKeypair(
  sign: PersonalMessageSigner
): Promise<ShieldKeypair> {
  const msg = new TextEncoder().encode(SHIELD_KEY_DERIVATION_MESSAGE);
  const sig = await sign(msg);
  const hash = await sha256(sig);
  const spendingKey = bytesToBigIntBE(hash) % BN254_SCALAR_FIELD;

  const viewingKey = poseidon1(spendingKey);
  // TODO(crypto): the circuit's note pubkey is currently defined as
  // Poseidon1(spendingKey) in many Sapling-style designs; confirm against the
  // Workstream-B circuit and replace. Until then publicKey reuses viewingKey's
  // stub so the surface type-checks end-to-end.
  const publicKey = poseidon1(spendingKey);

  return { spendingKey, viewingKey, publicKey };
}

/**
 * Poseidon hash of a single BN254 field element.
 *
 * STUB — NOT A REAL POSEIDON. Returns a deterministic field element so the SDK
 * surface composes and tests run, but the output is NOT byte-compatible with
 * `sui::poseidon_bn254`. THE critical gate (PRIVACY-BUILD-PLAN.md Workstream B)
 * is that in-circuit/SDK Poseidon equals the on-chain native Poseidon exactly —
 * any mismatch means no deposit is ever spendable.
 *
 * TODO(crypto): replace with a real BN254 Poseidon (e.g. a WASM gadget from the
 * arkworks `poseidon_opt` bundle, or a vetted JS impl with the SAME round
 * constants / MDS matrix as `sui::poseidon_bn254`). Add the three Vortex
 * cross-checks (Poseidon vectors, gadget==native, Rust-root==Move-root).
 */
export function poseidon1(x: bigint): bigint {
  return poseidonStub([x]);
}

/**
 * REAL Poseidon over BN254 — `@mysten/sui/zklogin`'s `poseidonHash`, the
 * circomlib parameterization that is byte-identical to `sui::poseidon_bn254`
 * (verified for arity-2 against all 27 on-chain `empty_subtree_hashes`, the
 * Phase-0 gate). Used for note commitments (Poseidon4), nullifiers (Poseidon3),
 * and the viewing key (Poseidon1). NOTE: the arity-1/3/4 cross-check against the
 * circuit's poseidon_opt is still pending (the arity-2 Merkle hash is proven);
 * confirm before relying on these for real on-chain notes.
 */
export function poseidonStub(inputs: bigint[]): bigint {
  return poseidonHash(inputs);
}
