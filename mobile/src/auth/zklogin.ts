import { api, ApiError, setBearer } from "@/api/client";
import { startGoogleAuth, parseCallback } from "@/auth/oauth";
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

/**
 * Rotate to a fresh ephemeral key and open Google OAuth. Returns the callback
 * URL when the in-app auth session captured the redirect; null when it deep-links
 * into the app instead (completeGoogleSignIn is then driven by the SessionProvider
 * deep-link listener).
 */
export async function beginGoogleSignIn(): Promise<string | null> {
  await ephemeralKey.wipe();
  await proofCache.clear();
  const { secret } = await ephemeralKey.loadOrCreate();
  const pubKeyUrl = b64.encodeUrl(ed25519PublicKey(secret));
  return startGoogleAuth(pubKeyUrl);
}

/**
 * Finish sign-in from the OAuth callback URL: store the session bearer, fetch the
 * user record, cache session material, and warm the ZK proof. Safe to call from
 * either the inline (auth-session) or the deep-link path.
 */
export async function completeGoogleSignIn(callbackUrl: string): Promise<{ user: UserDTO; existing: boolean }> {
  const { token, userId, existing } = parseCallback(callbackUrl);
  await secure.setBearer(token);
  setBearer(token);
  await prefs.setSignInAt(Date.now());
  await prefs.setLastUserId(userId);

  const user = await api<UserDTO>("/api/me");
  await prefs.setUserSnapshot(userId, user);

  const { secret } = await ephemeralKey.loadOrCreate();
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
  meta?: { kind: string; amountUsd?: number; venue?: string; saveProof?: string },
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

/**
 * Auto-claim a `.talise.sui` handle after onboarding, silently — derives a
 * candidate from the name (or email local-part, skipping Apple relay), retries
 * on 409 with a random suffix (≤3 tries), and gives up quietly on any other
 * error. Matches KYCView.claimTaliseHandle().
 */
export async function claimHandleSilently(user: UserDTO): Promise<void> {
  const base = deriveHandle(user);
  if (!base) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const username = attempt === 0 ? base : `${base}${100 + Math.floor(Math.random() * 9900)}`;
    try {
      await api("/api/username/claim", { method: "POST", body: { username } });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) continue;
      return;
    }
  }
}

function deriveHandle(user: UserDTO): string {
  const firstName = user.name?.trim().split(/\s+/)[0];
  const emailLocal =
    user.email && !user.email.includes("privaterelay.appleid.com") ? user.email.split("@")[0] : undefined;
  const raw = firstName || emailLocal || "";
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

/** Submit onboarding country + account type. */
export function submitOnboarding(country: string, accountType: "personal" | "business"): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/api/onboarding", { method: "POST", body: { country, accountType } });
}

type TxMeta = { kind: string; amountUsd?: number; venue?: string; saveProof?: string };

/**
 * Sponsor a transactionKind, then sign + execute. Used by the swap/consolidate
 * paths (POST /api/zk/sponsor {transactionKindB64} -> {bytes} → sponsorExecute).
 */
export async function signAndSubmit(transactionKindB64: string, meta?: TxMeta): Promise<{ digest: string }> {
  const { bytes } = await api<{ bytes: string }>("/api/zk/sponsor", {
    method: "POST",
    zk: true,
    body: { transactionKindB64 },
  });
  return sponsorExecute(bytes, meta);
}

/**
 * The Spend + Save leg of a send, as the SERVER verified it. Never the amount
 * we hoped to save — the receipt renders this verbatim.
 *
 *   none     no save leg in this send (round-up off, or under the floor).
 *   saved    the NAVI supply is on chain and the savings total moved.
 *   pending  the send landed and the save is inside the same transaction, but
 *            the server couldn't read it back yet, so nothing is credited.
 *   failed   nothing was saved and the savings total did not move.
 */
export type SaveOutcome =
  | { status: "none"; reason?: string }
  | { status: "saved"; savedUsd: number }
  | { status: "pending"; savedUsd: number }
  | { status: "failed"; savedUsd: 0; message: string };

/** The `save` block /api/send/sponsor-prepare returns. */
type PrepareSave = {
  applied: boolean;
  grossUsd: number;
  netUsd: number;
  feeBps: number;
  venue: string;
  proof?: string;
  reason?: string;
};

/**
 * Prepare a send, sign the bytes, and submit — gasless when possible, else
 * sponsored. Exact contract: /api/send/sponsor-prepare → sign → /api/send/
 * gasless-submit | /api/zk/sponsor-execute. Returns the on-chain digest.
 *
 * Spend + Save needs NO extra transaction. When round-up is on the server puts
 * the NAVI supply leg inside the SAME PTB and routes it to the sponsored rail,
 * so the one signature below covers both legs. All we do is carry the server's
 * HMAC-signed `saveProof` through to execute (we cannot read or alter what is
 * inside it) and report back what the server verified on chain.
 */
export async function signAndSubmitSend(
  to: string,
  amountUsd: number,
  asset = "USDsui",
): Promise<{ digest: string; save: SaveOutcome }> {
  const prep = await api<{
    bytes: string;
    mode: string;
    save?: PrepareSave;
    error?: string;
    code?: string;
  }>(
    "/api/send/sponsor-prepare",
    { method: "POST", zk: true, body: { to, amount: amountUsd, asset, sponsorFallback: true } },
  );
  if (prep.error) throw new Error(prep.error);

  const pc = await proofCache.get();
  if (!pc) throw new Error("No active session.");
  const ephemeralPubKeyB64 = await ephemeralKey.publicKeyB64();
  const userSignature = await signTransactionBytes(prep.bytes);
  const cachedProof = await proofCache.validProof();

  const body = {
    bytesB64: prep.bytes,
    ephemeralPubKeyB64,
    maxEpoch: pc.maxEpoch,
    randomness: pc.jwtRandomness,
    userSignature,
    cachedProof: cachedProof ?? undefined,
    meta: {
      kind: "send",
      amountUsd,
      ...(prep.save?.proof ? { saveProof: prep.save.proof } : {}),
    },
  };
  const path = prep.mode === "gasless" ? "/api/send/gasless-submit" : "/api/zk/sponsor-execute";
  const res = await api<{
    digest: string;
    freshProof?: Proof;
    error?: string;
    save?: { status: string; savedUsd?: number; reason?: string };
  }>(path, {
    method: "POST",
    zk: true,
    body,
  });
  if (res.freshProof) await proofCache.setProof(res.freshProof);
  if (res.error || !res.digest) throw new Error(res.error || "Payment didn't land on chain. No funds moved.");
  return { digest: res.digest, save: await resolveSave(prep.save, res) };
}

/**
 * Reduce the prepare + execute responses to the one honest sentence the receipt
 * may show about the save.
 *
 * A `pending` execute means the send landed and the save is inside it, but the
 * server couldn't read the transaction back in time to prove the amount, so it
 * credited nothing. We give it ONE re-confirm: a retried READ of a transaction
 * that already exists, carrying the server's own proof. There is no queue and
 * no scheduled job behind it — if this also comes back pending the tally simply
 * doesn't move and we say "confirming", which is the truth.
 */
async function resolveSave(
  prepSave: PrepareSave | undefined,
  exec: { digest: string; save?: { status: string; savedUsd?: number; reason?: string } },
): Promise<SaveOutcome> {
  if (prepSave?.applied !== true) {
    return { status: "none", ...(prepSave?.reason ? { reason: prepSave.reason } : {}) };
  }
  const status = exec.save?.status;
  if (status === "saved") {
    return { status: "saved", savedUsd: exec.save?.savedUsd ?? prepSave.netUsd };
  }
  if (status === "failed") {
    return {
      status: "failed",
      savedUsd: 0,
      message: exec.save?.reason ?? "The round-up didn't go through.",
    };
  }
  if (!prepSave.proof || !exec.digest) {
    return { status: "pending", savedUsd: prepSave.netUsd };
  }
  try {
    const again = await api<{ status: string; savedUsd?: number; reason?: string }>(
      "/api/send/save-confirm",
      { method: "POST", zk: true, body: { digest: exec.digest, saveProof: prepSave.proof } },
    );
    if (again.status === "saved") {
      return { status: "saved", savedUsd: again.savedUsd ?? prepSave.netUsd };
    }
    if (again.status === "failed") {
      return {
        status: "failed",
        savedUsd: 0,
        message: again.reason ?? "The round-up didn't go through.",
      };
    }
  } catch {
    /* the send already landed; a failed re-read is not a send failure */
  }
  return { status: "pending", savedUsd: prepSave.netUsd };
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
