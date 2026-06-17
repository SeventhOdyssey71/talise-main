"use client";

import { useEffect } from "react";

/**
 * Client harness. Installs `window.taliseShieldSend` and posts structured
 * messages back to the native host:
 *   { type: "progress", message }   — status line while working
 *   { type: "result", digest }      — success
 *   { type: "error", message }      — clean, user-facing failure
 *
 * `post()` targets the iOS `shield` script-message handler when present, and
 * falls back to `console.log` so the page is also debuggable in a browser.
 */
type Msg =
  | { type: "progress"; message: string }
  | { type: "result"; digest: string }
  | { type: "error"; message: string };

declare global {
  interface Window {
    taliseShieldSend?: (micros: string, recipient: string) => void;
    webkit?: { messageHandlers?: { shield?: { postMessage: (m: Msg) => void } } };
  }
}

export function ShieldProveHarness({ live }: { live: boolean }) {
  useEffect(() => {
    const post = (m: Msg) => {
      try {
        window.webkit?.messageHandlers?.shield?.postMessage(m);
      } catch {
        /* not in the native host */
      }
      // eslint-disable-next-line no-console
      console.log("[shield-prove]", m);
    };

    window.taliseShieldSend = (micros: string, recipient: string) => {
      void (async () => {
        try {
          post({ type: "progress", message: "Preparing your private send…" });

          if (!live) {
            throw new Error("Private send isn’t switched on yet.");
          }
          if (!/^0x[a-f0-9]{1,64}$/i.test(recipient)) {
            throw new Error("Invalid recipient address.");
          }
          const amount = BigInt(micros);
          if (amount <= 0n) throw new Error("Enter an amount.");

          // Confirm the shielded-pool relayer is reachable before we begin
          // (proves the infra is live + the session is authenticated here).
          post({ type: "progress", message: "Connecting to the shielded pool…" });
          const r = await fetch("/api/shield/relayer", { method: "GET" });
          if (!r.ok) throw new Error("The shielded pool is busy. Try again shortly.");

          // ── Remaining last mile (Workstream D) ──────────────────────────
          // Here we: derive the user's non-custodial shield key, build the
          // 2-in/2-out witness (deposit → withdraw to `recipient`), run the
          // WASM Groth16 prove in this page, encrypt the change note, and
          // submit via /api/shield/relay — all client-side. That stack
          // (web/lib/shield/sdk/flow.ts) is wired; the piece still landing is
          // the stable, recoverable shield-key derivation for zkLogin users.
          // Until it does, do NOT fake a send or move funds — report honestly.
          post({
            type: "error",
            message:
              "Private send is finalizing for your account — your funds are untouched. We’ll switch it on shortly.",
          });
        } catch (e) {
          post({ type: "error", message: (e as Error).message || "Private send failed." });
        }
      })();
    };

    return () => {
      delete window.taliseShieldSend;
    };
  }, [live]);

  // Invisible — the native side mounts this in a 0×0 web view.
  return <div data-shield-prove="ready" style={{ width: 1, height: 1, opacity: 0 }} />;
}
