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
    if (readCachedProof()) return; // already warm

    const eph = readEphemeralForT2000();
    if (!eph) return;

    // Defer slightly so we don't block the dashboard's initial paint.
    const id = window.setTimeout(async () => {
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
    }, 400);

    return () => window.clearTimeout(id);
  }, []);

  return null;
}
