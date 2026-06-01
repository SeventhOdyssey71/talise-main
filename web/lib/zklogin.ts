import { jwtToAddress } from "@mysten/sui/zklogin";
import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Google's published signing keys (JWKS). `createRemoteJWKSet` fetches +
// caches the keys and rotates them automatically, so this is created once.
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

type GoogleClaims = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
};

/**
 * Verify a Google `id_token`'s SIGNATURE against Google's JWKS and validate
 * `iss` / `aud` / `exp`. Use this for ANY client-submitted token (e.g. the iOS
 * PKCE flow posts its own id_token to /api/auth/mobile/exchange).
 *
 * `decodeJwt` only base64-decodes the payload — trusting it for a
 * client-submitted token is an account-takeover hole (an attacker can forge
 * any `sub`). This throws on a bad signature, wrong issuer/audience, or expiry.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audiences: string[]
): Promise<GoogleClaims> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: audiences,
  });
  return payload as unknown as GoogleClaims;
}

/**
 * Generate a random user salt for zkLogin.
 * Must be < 2^128. We sample 16 random bytes and stringify as decimal.
 * The salt is what binds Google account → deterministic Sui address.
 * Lose the salt and the address is unrecoverable. Store carefully.
 */
export function generateSalt(): string {
  const bytes = randomBytes(16);
  const hex = bytes.toString("hex");
  return BigInt("0x" + hex).toString();
}

/**
 * Derive a Sui address from a Google JWT and a salt.
 * Uses `sub` claim by default (Google's stable user id).
 */
export function deriveSuiAddress(jwt: string, salt: string): string {
  // legacyAddress=false uses the post-2024 derivation; matches our prior addresses
  // because @mysten/zklogin defaulted to non-legacy too.
  return jwtToAddress(jwt, salt, false);
}

/**
 * Decode a JWT payload without verifying the signature.
 * Safe in our context because we only accept JWTs we just exchanged with
 * Google's token endpoint over TLS — not user-submitted JWTs.
 */
export function decodeJwt(jwt: string): {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
} {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}
