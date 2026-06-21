"use client";

import { useEffect } from "react";
import { deriveShieldKeypairFromSeed } from "@/lib/shield/sdk";
import {
  proveShieldDeposit,
  shieldWithdraw,
  spendExistingNote,
  type ShieldFlowConfig,
  type FlowInputNote,
} from "@/lib/shield/sdk/flow";

/**
 * Client harness for the native private-send bridge. Installs
 * `window.taliseShieldSend` and posts structured messages to the native host:
 *   { type: "progress", message }      — status line while working
 *   { type: "signDeposit", bytesB64 }  — ask native to zkLogin-sign the deposit
 *   { type: "result", digest }         — success (the withdraw digest)
 *   { type: "error", message }         — clean, user-facing failure
 *
 * Native answers the signDeposit request by calling
 * `window.__taliseDepositSigned(digest, errorMessage)` (one is non-empty).
 *
 * FLOW (a shielded send is two legs with two signers):
 *   1. derive the user's non-custodial shield key (seed never leaves the device)
 *   2. fetch the live pool root + PROVE the deposit in-page (note secrets stay client-side)
 *   3. POST proof → /api/shield/deposit/prepare → sponsor-ready DEPOSIT PTB bytes
 *   4. hand bytes to NATIVE → zkLogin-sign + Onara gas + submit → deposit digest
 *   5. wait for the deposit commitment to index (its leaf enters the tree)
 *   6. PROVE + relay the WITHDRAW to the recipient (relayer-signed → severs the link)
 *
 * If the in-app feature flag is off the prepare route 503s and we report the
 * honest "finalizing" status — never faking a success, never stranding funds.
 */
type Msg =
  | { type: "progress"; message: string }
  | { type: "signDeposit"; bytesB64: string }
  | { type: "result"; digest: string }
  | { type: "error"; message: string };

declare global {
  interface Window {
    taliseShieldSend?: (micros: string, recipient: string, seedHex: string) => void;
    __taliseDepositSigned?: (digest: string, error: string) => void;
    webkit?: { messageHandlers?: { shield?: { postMessage: (m: Msg) => void } } };
  }
}

function seedFromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function ShieldProveHarness({
  live,
  packageId,
  poolObjectId,
  coinType,
}: {
  live: boolean;
  packageId: string;
  poolObjectId: string;
  coinType: string;
}) {
  useEffect(() => {
    const post = (m: Msg) => {
      try {
        window.webkit?.messageHandlers?.shield?.postMessage(m);
      } catch {
        /* not in the native host */
      }
      // eslint-disable-next-line no-console
      console.log("[shield-prove]", m.type);
    };

    // Resolver for the native deposit-signing round-trip (step 4).
    let depositResolver: ((r: { digest?: string; error?: string }) => void) | null = null;
    window.__taliseDepositSigned = (digest: string, error: string) => {
      const r = depositResolver;
      depositResolver = null;
      r?.({ digest: digest || undefined, error: error || undefined });
    };

    /** Post the sponsor-ready bytes to native and await its zkLogin signature + submit. */
    const signDepositNative = (bytesB64: string) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (depositResolver) {
            depositResolver = null;
            reject(new Error("Signing timed out on this device."));
          }
        }, 90_000);
        depositResolver = ({ digest, error }) => {
          clearTimeout(timer);
          if (digest) resolve(digest);
          else reject(new Error(error || "Couldn’t sign the deposit on this device."));
        };
        post({ type: "signDeposit", bytesB64 });
      });

    const cfg: ShieldFlowConfig = {
      packageId,
      poolObjectId,
      coinType,
      // Same-origin requests carry the web-session cookie automatically.
      fetchInit: { credentials: "same-origin" },
    };

    /** POST helper that surfaces a structured error (never a raw HTML body). */
    const postJson = async (path: string, body: unknown) => {
      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let j: Record<string, unknown> = {};
      try {
        j = await res.json();
      } catch {
        /* non-JSON */
      }
      return { ok: res.ok, status: res.status, body: j };
    };

    window.taliseShieldSend = (micros: string, recipient: string, seedHex: string) => {
      void (async () => {
        try {
          post({ type: "progress", message: "Preparing your private send…" });

          if (!live || !packageId || !poolObjectId) {
            throw new Error("Private send isn’t switched on yet.");
          }
          // Require a CANONICAL full 32-byte address. Short/non-padded forms are
          // rejected (never auto-padded) so the unshielded funds can't land at an
          // unintended address — the withdraw is relayer-signed + irreversible.
          if (!/^0x[a-f0-9]{64}$/i.test(recipient)) throw new Error("Invalid recipient address.");
          const amount = BigInt(micros);
          if (amount <= 0n) throw new Error("Enter an amount.");
          if (!/^[0-9a-f]{32,128}$/i.test(seedHex)) {
            throw new Error("Couldn’t unlock your private key on this device.");
          }

          // 1. Derive the NON-CUSTODIAL shield keypair on-device (seed never leaves).
          post({ type: "progress", message: "Unlocking your private key…" });
          const keypair = await deriveShieldKeypairFromSeed(seedFromHex(seedHex));
          if (keypair.spendingKey <= 0n) throw new Error("Key derivation failed.");

          // 2. Fetch the live pool root (the deposit binds to a known root).
          post({ type: "progress", message: "Connecting to the shielded pool…" });
          const rootRes = await postJson("/api/shield/merkle-path", { coinType, dummy: true });
          if (!rootRes.ok) throw new Error("The shielded pool is busy. Try again shortly.");
          const currentRoot = rootRes.body.currentRoot as string | undefined;
          if (!currentRoot) throw new Error("The shielded pool is syncing. Try again shortly.");

          // 2b. SCAN-FIRST: a shielded note IS spendable balance. If an UNSPENT
          // note you already own covers this amount (e.g. a prior send whose
          // withdraw didn't fire — the funds are already in the pool), spend THAT
          // to the recipient and skip the deposit. Completes stranded sends + is
          // faster (no deposit/sign/index round-trip). Best-effort: any failure
          // falls through to the normal deposit flow.
          const relayerRes0 = await fetch("/api/shield/relayer", { credentials: "same-origin" });
          const relayer0 = (await relayerRes0.json().catch(() => ({}))) as { zeroCoinSourceId?: string };
          if (relayer0.zeroCoinSourceId) {
            post({ type: "progress", message: "Checking your shielded balance…" });
            const reused = await spendExistingNote({
              cfg,
              keypair,
              amount,
              exitAddress: recipient,
              zeroCoinSourceId: relayer0.zeroCoinSourceId,
              root: BigInt(currentRoot),
            }).catch(() => null);
            if (reused?.digest) {
              post({ type: "result", digest: reused.digest });
              return;
            }
          }

          // 3. PROVE the deposit in-page (Groth16, WASM) — note secrets stay here.
          post({ type: "progress", message: "Sealing your transfer…" });
          const prepared = await proveShieldDeposit({
            cfg,
            keypair,
            amount,
            root: BigInt(currentRoot),
          });

          // 4. Build the sponsor-ready deposit PTB server-side (sources the coin
          //    from the user's balance), then NATIVE zkLogin-signs + submits it.
          const prep = await postJson("/api/shield/deposit/prepare", {
            amountMicros: micros,
            proof: prepared.proof,
            enc0B64: prepared.enc0B64,
            enc1B64: prepared.enc1B64,
          });
          if (prep.status === 503 && prep.body.code === "SHIELD_INAPP_OFF") {
            // Feature flag off — honest, non-lossy status. Funds untouched.
            post({
              type: "error",
              message:
                "Your private key is set up on this device. One-tap private send is finalizing — your funds are untouched.",
            });
            return;
          }
          if (prep.status === 409 && prep.body.code === "ROOT_STALE") {
            throw new Error("The pool just updated — please try again.");
          }
          if (!prep.ok || typeof prep.body.bytes !== "string") {
            throw new Error((prep.body.error as string) || "Couldn’t prepare the private send.");
          }

          post({ type: "progress", message: "Confirm on your device…" });
          const depositDigest = await signDepositNative(prep.body.bytes as string);

          // 5. Wait for the deposit commitment to index (its leaf enters the tree
          //    so the withdraw can authenticate against it). Poll ~3 min.
          post({ type: "progress", message: "Funds shielded — completing your transfer…" });
          const commitment = prepared.outputNote.commitment;
          let leafIndex: number | null = null;
          let postDepositRoot: string | null = null;
          for (let i = 0; i < 90 && leafIndex === null; i++) {
            const p = await postJson("/api/shield/merkle-path", { coinType, commitment });
            if (p.ok && typeof p.body.leafIndex === "number") {
              leafIndex = p.body.leafIndex as number;
              postDepositRoot = (p.body.root as string) ?? null;
            } else {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
          if (leafIndex === null || !postDepositRoot) {
            // Non-lossy: the deposit landed (funds are shielded + the note is
            // recoverable from the seed); the transfer completes once indexed.
            post({
              type: "error",
              message:
                "Your funds are shielded. The private transfer will complete after the next confirmation — your money is safe (deposit " +
                depositDigest.slice(0, 10) +
                "…).",
            });
            return;
          }

          // 6. PROVE + relay the WITHDRAW to the recipient (relayer-signed).
          const relayerRes = await fetch("/api/shield/relayer", { credentials: "same-origin" });
          const relayer = (await relayerRes.json()) as { zeroCoinSourceId?: string };
          if (!relayer.zeroCoinSourceId) {
            post({
              type: "error",
              message:
                "Your funds are shielded. The private transfer is queued and will complete shortly — your money is safe.",
            });
            return;
          }
          const inputNote: FlowInputNote = {
            privateKey: keypair.spendingKey,
            amount,
            blinding: BigInt(prepared.outputNote.blinding),
            leafIndex,
            commitment: BigInt(commitment),
          };
          const { digest: withdrawDigest } = await shieldWithdraw({
            cfg,
            keypair,
            inputNotes: [inputNote],
            amount,
            exitAddress: recipient,
            zeroCoinSourceId: relayer.zeroCoinSourceId,
            root: BigInt(postDepositRoot),
          });

          post({ type: "result", digest: withdrawDigest });
        } catch (e) {
          post({ type: "error", message: (e as Error).message || "Private send failed." });
        }
      })();
    };

    return () => {
      delete window.taliseShieldSend;
      delete window.__taliseDepositSigned;
    };
  }, [live, packageId, poolObjectId, coinType]);

  // Invisible — the native side mounts this in a 0×0 web view.
  return <div data-shield-prove="ready" style={{ width: 1, height: 1, opacity: 0 }} />;
}
