/**
 * Server-side zkLogin signing helpers.
 *
 *  - Stores the JWT + salt in an encrypted httpOnly cookie alongside the
 *    session cookie (so we can re-use the JWT for proof generation later).
 *  - Talks to the Mysten prover service.
 *  - Wraps the proof + ephemeral signature into a final zkLoginSignature.
 *
 * Never expose these helpers to the client bundle — they import server-only
 * crypto via @mysten/sui's zklogin tree.
 */

import "server-only";
import { cookies } from "next/headers";
import {
  genAddressSeed,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
} from "@mysten/sui/zklogin";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import { sign, verify } from "./auth";
import { decodeJwt } from "./zklogin";
import { shinamiCreateProof, shinamiEnabled } from "./shinami";

const JWT_COOKIE = "talise_jwt";

/**
 * Prover endpoint resolution order:
 *   1. ZK_PROVER_URL env (our self-hosted prover — required for mainnet
 *      since Mysten's hosted mainnet prover whitelists audiences).
 *   2. Mysten's testnet prover (open to all audiences) on testnet.
 *   3. Mysten's mainnet prover as a last resort on mainnet (only works for
 *      whitelisted audiences).
 */
const PROVER_URL = (() => {
  const override = process.env.ZK_PROVER_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  const net = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet").toLowerCase();
  return net === "testnet"
    ? "https://prover-dev.mystenlabs.com/v1"
    : "https://prover.mystenlabs.com/v1";
})();

/** Persist the JWT + salt in an encrypted cookie. ~1 hour TTL (matches Google JWT). */
export async function setSigningCookie(jwt: string, salt: string) {
  const jar = await cookies();
  const payload = Buffer.from(JSON.stringify({ jwt, salt }), "utf8").toString("base64url");
  jar.set(JWT_COOKIE, sign(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  });
}

export async function clearSigningCookie() {
  const jar = await cookies();
  jar.delete(JWT_COOKIE);
}

export async function readSigningCookie(): Promise<{ jwt: string; salt: string } | null> {
  const jar = await cookies();
  const raw = jar.get(JWT_COOKIE)?.value;
  if (!raw) return null;
  const payload = verify(raw);
  if (!payload) return null;
  try {
    const { jwt, salt } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    if (typeof jwt !== "string" || typeof salt !== "string") return null;
    return { jwt, salt };
  } catch {
    return null;
  }
}

export type ProverInputs = {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: "sub" | "email";
};

type ProverResponse = {
  proofPoints: { a: string[]; b: string[][]; c: string[] };
  issBase64Details: { value: string; indexMod4: number };
  headerBase64: string;
};

export async function callProver(inputs: ProverInputs): Promise<ProverResponse> {
  const r = await fetch(PROVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inputs),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`prover ${r.status}: ${text.slice(0, 200)}`);
  }
  return (await r.json()) as ProverResponse;
}

/**
 * Full zkLogin proof, including the locally-computed `addressSeed`. This is
 * the cacheable artifact — it's valid for the entire ephemeral session
 * (~55 min in the browser, up to `maxEpoch` on chain). Pass it back through
 * later signing calls to skip the 2-4s Shinami round trip.
 */
export type CachedZkProof = {
  proofPoints: { a: string[]; b: string[][]; c: string[] };
  issBase64Details: { value: string; indexMod4: number };
  headerBase64: string;
  addressSeed: string;
};

/**
 * Generate a fresh zkLogin proof via the configured prover. Reads the
 * session JWT + salt from the encrypted cookie. The returned object is the
 * cacheable shape — pass it to `assembleZkLoginSignature` on subsequent
 * sends to skip the prover call entirely.
 */
export async function mintZkProof(opts: {
  ephemeralPubKeyB64: string;
  maxEpoch: number;
  randomness: string;
}): Promise<CachedZkProof> {
  const stored = await readSigningCookie();
  if (!stored) throw new Error("No active sign-in. Please sign in again.");
  const { jwt, salt } = stored;

  const pubKey = new Ed25519PublicKey(fromBase64(opts.ephemeralPubKeyB64));
  const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(pubKey);

  const raw = shinamiEnabled()
    ? await shinamiCreateProof({
        jwt,
        maxEpoch: opts.maxEpoch,
        extendedEphemeralPublicKey,
        jwtRandomness: opts.randomness,
        salt,
      })
    : await callProver({
        jwt,
        extendedEphemeralPublicKey,
        maxEpoch: opts.maxEpoch,
        jwtRandomness: opts.randomness,
        salt,
        keyClaimName: "sub",
      });

  const claims = decodeJwt(jwt);
  const addressSeed = genAddressSeed(
    BigInt(salt),
    "sub",
    claims.sub,
    claims.aud
  ).toString();

  return { ...raw, addressSeed };
}

/**
 * Given the ephemeral signature of tx bytes, produce a full zkLoginSignature.
 * Returns the signature AND the proof used (whether cached or freshly minted)
 * so callers can persist it for the next send.
 *
 * The proof is `mintZkProof`'s biggest cost — Shinami's Groth16 generator
 * runs 2-4s. Pass `cachedProof` to skip that hop entirely.
 */
export async function assembleZkLoginSignature(opts: {
  ephemeralPubKeyB64: string;
  maxEpoch: number;
  randomness: string;
  userSignature: string;
  cachedProof?: CachedZkProof;
}): Promise<{ signature: string; proof: CachedZkProof; isFresh: boolean }> {
  let proof: CachedZkProof;
  let isFresh = false;
  if (opts.cachedProof) {
    proof = opts.cachedProof;
  } else {
    proof = await mintZkProof({
      ephemeralPubKeyB64: opts.ephemeralPubKeyB64,
      maxEpoch: opts.maxEpoch,
      randomness: opts.randomness,
    });
    isFresh = true;
  }

  const signature = getZkLoginSignature({
    inputs: proof,
    maxEpoch: opts.maxEpoch,
    userSignature: opts.userSignature,
  });

  return { signature, proof, isFresh };
}
