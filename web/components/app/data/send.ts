"use client";

/**
 * useSignAndSend, the browser send pipeline for plain USDsui / SUI transfers.
 *
 * Reuses the zkLogin ephemeral key that `web/lib/zkclient.ts` provisions in
 * sessionStorage. The server builds the sponsor-ready (or gasless) bytes, we
 * sign them with the ephemeral key, then the server wraps the zkLogin
 * signature + sponsor signature and broadcasts:
 *
 *   POST /api/send/sponsor-prepare {to, amount, asset}  -> { bytes, mode, ... }
 *   sign bytes with the ephemeral Ed25519 key
 *   if mode === "gasless":  POST /api/send/gasless-submit
 *   else (sponsored*):      POST /api/zk/sponsor-execute
 *   -> { digest }
 *
 * When the server booked a Spend + Save round-up for the send it also returns
 * a `roundupToken`, and we then fire the save as a SECOND sponsored
 * transaction (see `runRoundupSave`). It is silent: the ephemeral zkLogin key
 * is already in this session, so there is no second prompt.
 *
 * On success we dispatch a `talise:tx` window event so balance/activity hooks
 * refresh. If there's no ephemeral key (not signed in to the wallet), we kick
 * the Google sign-in flow and return to the current path.
 */

import { useCallback, useRef, useState } from "react";
import { forceFreshSignIn, isSessionExpiryError } from "@/lib/session-expiry";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { triggerOauthSignIn, readEphemeralForT2000, writeCachedProof } from "@/lib/zkclient";
import { api, ApiError } from "./api";

export type SendArgs = {
  to: string;
  amountUsd: number;
  asset?: "USDsui" | "SUI";
};

/**
 * Outcome of the Spend + Save leg, which is a SECOND sponsored transaction
 * fired straight after the send lands.
 *
 *   saved    the NAVI supply is on chain and the savings total moved.
 *   pending  the supply is broadcast but not yet verifiable server-side.
 *            The savings total moves when the reconcile pass credits it.
 *   failed   nothing was saved and the savings total did not move.
 */
export type RoundupSaveOutcome =
  | { status: "none" }
  | { status: "saved"; savedUsd: number; digest: string }
  | { status: "pending"; savedUsd: number; digest: string }
  | { status: "failed"; savedUsd: number; message: string };

/**
 * What `send()` resolves with. `digest` is the on-chain receipt; `mode` and
 * `roundupUsd` are the SERVER-BLESSED rail + round-up decisions from
 * sponsor-prepare, surfaced so the success UI can show what actually happened
 * (gasless vs sponsored, and the real Save leg) instead of fabricating steps.
 */
export type SendResult = {
  digest: string;
  /** "gasless" | "sponsored" | "sponsored-coin-fallback" | "sponsored-anchor-fallback" */
  mode: string;
  /** USD the server booked to round up on this send (0 when none). */
  roundupUsd: number;
  /**
   * Resolves when the Spend + Save transaction has been fired and its
   * outcome is known. Present only when `roundupUsd > 0`. Never rejects.
   */
  save?: Promise<RoundupSaveOutcome>;
};

type PrepareResponse = {
  bytes: string;
  mode: string;
  roundupUsd?: number;
  roundupNetUsd?: number;
  roundupToken?: string;
  receiptNonce?: string;
};

type ExecuteResponse = {
  digest: string;
  freshProof?: Parameters<typeof writeCachedProof>[0];
  roundupSave?: { status: string; creditedUsd?: number; reason?: string };
};

type RoundupPrepareResponse = {
  bytes: string;
  token: string;
  amountUsd: number;
  netUsd: number;
  saveDigest: string;
};

/**
 * Fire the round-up as its OWN sponsored transaction, right after the send.
 *
 * Two hops, both server-side heavy lifting:
 *   POST /api/send/roundup/prepare {token, sendDigest} -> sponsor-ready bytes
 *   sign with the same in-session ephemeral key the send just used
 *   POST /api/zk/sponsor-execute   {..., meta:{roundupSaveToken}} -> digest
 *
 * Silent by design: the user already signed in to this session, so no prompt
 * and no extra tap. It never throws, the caller renders the outcome.
 */
async function runRoundupSave(
  eph: NonNullable<ReturnType<typeof readEphemeralForT2000>>,
  token: string,
  sendDigest: string,
  plannedUsd: number
): Promise<RoundupSaveOutcome> {
  try {
    const prep = await api<RoundupPrepareResponse>("/api/send/roundup/prepare", {
      method: "POST",
      body: { token, sendDigest },
    });

    const keypair = Ed25519Keypair.fromSecretKey(eph.ephemeralPrivateKey);
    const { signature: userSignature } = await keypair.signTransaction(
      fromBase64(prep.bytes)
    );

    const exec = await api<ExecuteResponse>("/api/zk/sponsor-execute", {
      method: "POST",
      body: {
        bytesB64: prep.bytes,
        ephemeralPubKeyB64: eph.ephemeralPubKeyB64,
        maxEpoch: eph.maxEpoch,
        randomness: eph.randomness,
        userSignature,
        cachedProof: eph.cachedProof,
        // An opaque token, never an amount. The server holds the amount and
        // credits the savings total only after reading this transaction back
        // off chain.
        meta: { roundupSaveToken: token },
      },
    });
    if (exec.freshProof) {
      try {
        writeCachedProof(exec.freshProof);
      } catch {
        /* non-fatal */
      }
    }
    if (typeof window !== "undefined" && exec.digest) {
      window.dispatchEvent(
        new CustomEvent("talise:tx", { detail: { digest: exec.digest } })
      );
    }

    const saved = exec.roundupSave?.creditedUsd ?? prep.netUsd;
    if (exec.roundupSave?.status === "failed") {
      return {
        status: "failed",
        savedUsd: prep.netUsd,
        message: exec.roundupSave.reason ?? "The round-up didn't go through.",
      };
    }
    if (exec.roundupSave?.status === "settled") {
      return { status: "saved", savedUsd: saved, digest: exec.digest };
    }
    return { status: "pending", savedUsd: prep.netUsd, digest: exec.digest };
  } catch (e) {
    const message =
      e instanceof ApiError && e.message
        ? e.message
        : "The round-up didn't go through.";
    console.warn("[spend-save] round-up save failed:", message);
    return { status: "failed", savedUsd: plannedUsd, message };
  }
}

export function useSignAndSend() {
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  const send = useCallback(async (args: SendArgs): Promise<SendResult> => {
    if (inFlight.current) {
      throw new ApiError(0, "A send is already in progress.", "BUSY");
    }

    const eph = readEphemeralForT2000();
    if (!eph) {
      // No wallet key in this tab, bounce through Google and come back here.
      triggerOauthSignIn({ returnTo: typeof location !== "undefined" ? location.pathname : "/app" });
      throw new ApiError(401, "Sign in to continue.", "NOT_SIGNED_IN");
    }

    inFlight.current = true;
    setSending(true);
    try {
      const asset = args.asset ?? "USDsui";

      // 1) Server builds the sponsor-ready (or gasless) TransactionData bytes.
      const prep = await api<PrepareResponse>("/api/send/sponsor-prepare", {
        method: "POST",
        body: { to: args.to, amount: args.amountUsd, asset },
      });

      // 2) Sign the full bytes with the ephemeral key (the sender signature).
      const keypair = Ed25519Keypair.fromSecretKey(eph.ephemeralPrivateKey);
      const { signature: userSignature } = await keypair.signTransaction(
        fromBase64(prep.bytes)
      );

      // 3) Server wraps the zkLogin signature (+ sponsor sig for the sponsored
      //    path) and broadcasts. Gasless mode goes through gasless-submit.
      const executePath =
        prep.mode === "gasless" ? "/api/send/gasless-submit" : "/api/zk/sponsor-execute";

      const exec = await api<ExecuteResponse>(executePath, {
        method: "POST",
        body: {
          bytesB64: prep.bytes,
          ephemeralPubKeyB64: eph.ephemeralPubKeyB64,
          maxEpoch: eph.maxEpoch,
          randomness: eph.randomness,
          userSignature,
          cachedProof: eph.cachedProof,
          meta: { receiptNonce: prep.receiptNonce },
        },
      });

      // First successful tx this session returns a freshly-minted proof -
      // persist it so the next send skips the prover round trip.
      if (exec.freshProof) {
        try {
          writeCachedProof(exec.freshProof);
        } catch {
          /* non-fatal */
        }
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("talise:tx", { detail: { digest: exec.digest } }));
      }

      // Spend + Save: fire the round-up as its own sponsored transaction now
      // that the send has a digest. Kicked off here (not awaited) so the
      // success screen appears immediately; the receipt subscribes to the
      // promise and tells the truth about what the save actually did.
      const roundupUsd = prep.roundupUsd ?? 0;
      const save =
        roundupUsd > 0 && prep.roundupToken && exec.digest
          ? runRoundupSave(eph, prep.roundupToken, exec.digest, roundupUsd)
          : undefined;

      // Surface the server's rail + Save decisions from prepare alongside the
      // digest, the success UI derives its step list from these (never from
      // client guesses).
      return { digest: exec.digest, mode: prep.mode, roundupUsd, save };
    } catch (e) {
      // Expired signing session (server 401 / stale binding): tear down and
      // send the user straight back through Google so they can finish what
      // they started in a fresh session.
      if (isSessionExpiryError(e)) {
        void forceFreshSignIn({ reauthNow: true });
        throw new ApiError(401, "Your session expired, signing you in again…", "SESSION_EXPIRED");
      }
      throw e;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, []);

  return { send, sending };
}
