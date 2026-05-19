"use client";

import { useEffect } from "react";
import {
  hasEphemeralKey,
  readCachedProof,
  readEphemeralForT2000,
  writeCachedProof,
} from "@/lib/zkclient";

/**
 * Fires once on mount: if the user has a signed-in session but no cached
 * proof yet, POST /api/zk/proof in the background to warm the cache.
 * Subsequent transactions skip the 2-4s Shinami round trip entirely —
 * including the user's *first* send in this session.
 *
 * The first /home load after a fresh sign-in takes the Shinami hit ONCE,
 * here, while the user is reading the dashboard. By the time they click
 * Send, the proof is already in localStorage.
 *
 * Renders nothing.
 */
export function ProofWarmer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasEphemeralKey()) return;

    const eph = readEphemeralForT2000();
    const needsProof = !readCachedProof() && !!eph;

    // Defer slightly so we don't block the dashboard's initial paint.
    const id = window.setTimeout(() => {
      // Fire both warmups in parallel: zk proof for the client, and server
      // caches (Onara address + Sui ref gas price) for /api/zk/sponsor.
      // Together these kill the cold-start cost on the user's first send.
      //
      // Warmup also returns pkReady — when true we flip the localStorage
      // flag so subsequent sends start attaching Payment Kit receipts.
      // Without this gate, sends raced the registry mint and failed with
      // "Object 0xdad…908 does not exist".
      fetch("/api/zk/warmup", { method: "POST" })
        .then(async (r) => {
          if (!r.ok) return;
          const j = (await r.json()) as { pkReady?: boolean };
          if (j.pkReady) {
            try {
              window.localStorage.setItem("talise:pk:ready", "1");
            } catch {}
          }
        })
        .catch(() => {});

      if (needsProof && eph) {
        (async () => {
          try {
            const r = await fetch("/api/zk/proof", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ephemeralPubKeyB64: eph.ephemeralPubKeyB64,
                maxEpoch: eph.maxEpoch,
                randomness: eph.randomness,
              }),
            });
            if (!r.ok) return;
            const { proof } = (await r.json()) as {
              proof?: import("@/lib/zkclient").StoredZkProof;
            };
            if (proof) writeCachedProof(proof);
          } catch {
            /* non-blocking */
          }
        })();
      }
    }, 400);

    return () => window.clearTimeout(id);
  }, []);

  return null;
}
