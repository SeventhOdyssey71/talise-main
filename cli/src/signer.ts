/**
 * Local, non-custodial signing. Rebuilds the ephemeral Ed25519 keypair from the
 * 32-byte seed in the session and signs prepared transaction bytes. This is the
 * client half of Talise's hybrid zkLogin: we produce `userSignature` (the
 * ephemeral signature over the intent-prefixed, Blake2b-hashed tx bytes) and
 * the server combines it with the zkLogin proof it mints from its JWT+salt.
 *
 * `Ed25519Keypair.signTransaction` applies the Sui intent prefix + Blake2b-256
 * exactly as the app does, so the produced signature matches what the backend
 * expects in `/api/send/gasless-submit`.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { randomBytes } from "node:crypto";
import type { Session } from "./config.js";

export type SignedTx = {
  userSignature: string;
  ephemeralPubKeyB64: string;
  maxEpoch: number;
  randomness: string;
};

function keypairFrom(session: Session): Ed25519Keypair {
  const secret = fromBase64(session.ephemeralSecretB64);
  if (secret.length !== 32) {
    throw new Error("stored ephemeral key is malformed — run `talise login` again");
  }
  return Ed25519Keypair.fromSecretKey(secret);
}

/** Sign prepared tx bytes (base64) and return the fields gasless-submit needs. */
export async function signPreparedTx(
  session: Session,
  bytesB64: string,
): Promise<SignedTx> {
  const kp = keypairFrom(session);
  const { signature } = await kp.signTransaction(fromBase64(bytesB64));
  const ephemeralPubKeyB64 = toBase64(kp.getPublicKey().toRawBytes());
  // Sanity: the key we sign with must be the one bound at sign-in, else the
  // server's proof won't verify against this ephemeral pubkey.
  if (ephemeralPubKeyB64 !== session.ephemeralPubKeyB64) {
    throw new Error(
      "ephemeral key mismatch with the bound session — run `talise login` again",
    );
  }
  return {
    userSignature: signature,
    ephemeralPubKeyB64,
    maxEpoch: session.maxEpoch,
    randomness: session.randomness,
  };
}

/**
 * Fresh ephemeral keypair for a new login. We generate the 32-byte seed
 * ourselves (rather than reading it back off a keypair, whose export format
 * varies across @mysten/sui versions) so the stored secret always round-trips
 * cleanly through `Ed25519Keypair.fromSecretKey`.
 */
export function newEphemeralKey(): { secretB64: string; pubKeyB64: string } {
  const seed = new Uint8Array(randomBytes(32));
  const kp = Ed25519Keypair.fromSecretKey(seed);
  return {
    secretB64: toBase64(seed),
    pubKeyB64: toBase64(kp.getPublicKey().toRawBytes()),
  };
}
