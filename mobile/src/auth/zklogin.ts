import { api, setBearer } from "@/api/client";
import { googleSignIn } from "@/auth/oauth";
import { prefs } from "@/auth/prefs";
import { proofCache, type Proof } from "@/auth/proofCache";
import { secure } from "@/auth/secure";
import { b64, ed25519PublicKey, randomnessDecimal } from "@/sui/crypto";
import { ephemeralKey } from "@/sui/ephemeral";
import { signTransactionBytes } from "@/sui/sign";

/**
 * ZkLogin coordinator — mirrors ios ZkLoginCoordinator. The ephemeral key +
 * randomness + maxEpoch live client-side; the proof, salt, address and full
 * signature assembly stay SERVER-side. We just run OAuth, cache session material,
 * and sign tx digests with the ephemeral key.
 */

export type UserDTO = {
  id: string;
  name?: string | null;
  email?: string | null;
  handle?: string | null;
  suiAddress?: string | null;
  accountType?: string | null;
  picture?: string | null;
};

/** maxEpoch = current Sui epoch + 3 (~3-day window). */
async function fetchMaxEpoch(): Promise<number> {
  const { epoch } = await api<{ epoch: string }>("/api/sui/epoch");
  return Number(epoch) + 3;
}

export async function signInWithGoogle(): Promise<{ user: UserDTO; existing: boolean }> {
  await ephemeralKey.wipe();
  await proofCache.clear();
  const { secret } = await ephemeralKey.loadOrCreate();
  const pubKeyUrl = b64.encodeUrl(ed25519PublicKey(secret));

  const { token, userId, existing } = await googleSignIn(pubKeyUrl);
  await secure.setBearer(token);
  setBearer(token);
  await prefs.setSignInAt(Date.now());
  await prefs.setLastUserId(userId);

  const user = await api<UserDTO>("/api/me");
  await prefs.setUserSnapshot(userId, user);

  const randomness = randomnessDecimal();
  const maxEpoch = await fetchMaxEpoch();
  await proofCache.set({ maxEpoch, jwtRandomness: randomness });
  void warmProof(b64.encode(ed25519PublicKey(secret)), maxEpoch, randomness);

  return { user, existing };
}

/** Best-effort: pre-mint the ZK proof so the first send is instant. */
async function warmProof(ephemeralPubKeyB64: string, maxEpoch: number, randomness: string): Promise<void> {
  try {
    const { proof } = await api<{ proof?: Proof }>("/api/zk/proof", {
      method: "POST",
      zk: true,
      body: { ephemeralPubKeyB64, maxEpoch, randomness },
    });
    if (proof) await proofCache.setProof(proof);
  } catch {
    /* server re-mints on demand */
  }
}

/** Restore the in-memory bearer from the keychain on cold launch. */
export async function restoreBearer(): Promise<string | null> {
  const t = await secure.getBearer();
  setBearer(t);
  return t;
}

/** Fetch the authoritative user record. */
export function fetchMe(): Promise<UserDTO> {
  return api<UserDTO>("/api/me");
}

/**
 * Sponsored/gasless execute — sign the prepared bytes with the ephemeral key and
 * submit with the cached proof. Exact contract from /api/zk/sponsor-execute.
 * (Used by the money flows in later phases.)
 */
export async function sponsorExecute(
  bytesB64: string,
  meta?: { kind: string; amountUsd?: number; venue?: string; roundupUsd?: number },
): Promise<{ digest: string }> {
  const pc = await proofCache.get();
  if (!pc) throw new Error("No active session.");
  const ephemeralPubKeyB64 = await ephemeralKey.publicKeyB64();
  const userSignature = await signTransactionBytes(bytesB64);
  const cachedProof = await proofCache.validProof();

  const res = await api<{ digest: string; freshProof?: Proof; error?: string }>("/api/zk/sponsor-execute", {
    method: "POST",
    zk: true,
    body: {
      bytesB64,
      ephemeralPubKeyB64,
      maxEpoch: pc.maxEpoch,
      randomness: pc.jwtRandomness,
      userSignature,
      cachedProof: cachedProof ?? undefined,
      meta,
    },
  });
  if (res.freshProof) await proofCache.setProof(res.freshProof);
  if (res.error) throw new Error(res.error);
  return { digest: res.digest };
}

/** Wipe all session material (keeps the per-user PIN, like iOS clearSession()). */
export async function clearSession(): Promise<void> {
  const uid = await prefs.getLastUserId();
  await secure.clearBearer();
  setBearer(null);
  await ephemeralKey.wipe();
  await proofCache.clear();
  await prefs.clearSignInAt();
  await prefs.clearLastUserId();
  if (uid) await prefs.clearUserSnapshot(uid);
}
