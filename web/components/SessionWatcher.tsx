"use client";

import { useEffect, useRef, useState } from "react";
import { clearStored, hasEphemeralKey } from "@/lib/zkclient";

/**
 * Idle-session guard.
 *
 * The ephemeral zkLogin key lives in localStorage with a 55-minute TTL
 * (matches Google's id_token lifetime). If the user leaves a signed-in tab
 * open long enough for the key to lapse, every protected action would 401
 * with a confusing error. This component polls `hasEphemeralKey()` and,
 * the moment it returns false, clears any local zkLogin state, hits the
 * server logout to drop the session cookie, and bounces to the landing
 * page with a clear `err=session_expired` flag.
 *
 * Active-mid-transaction expiry is already handled by `SendForm.onSubmit`
 * (and the other forms), which auto-re-runs OAuth with `returnTo` so the
 * user lands back on the same page after re-auth. This watcher only
 * targets idle expiry.
 *
 * Optional UI: a small "session expires in N min" pill shows up in the
 * last 5 minutes so the user can preemptively re-auth without losing
 * their work.
 */

const POLL_MS = 30_000;
const STORAGE_KEY = "talise:zk:eph";
const WARN_MS = 5 * 60 * 1000; // 5 minutes
const EPHEMERAL_TTL_MS = 55 * 60 * 1000;

function readCreatedAt(): number | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { createdAt?: number };
    return parsed.createdAt ?? null;
  } catch {
    return null;
  }
}

export function SessionWatcher() {
  const expiredRef = useRef(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function expire(reason: "no_key" | "ttl") {
      if (expiredRef.current) return;
      expiredRef.current = true;
      clearStored();
      // Server logout drops the session cookie + the signing JWT cookie.
      await fetch("/api/auth/logout", {
        method: "POST",
        redirect: "manual", // we'll redirect ourselves with the right query
      }).catch(() => {});
      if (cancelled) return;
      window.location.href = `/?err=session_expired&reason=${reason}`;
    }

    function tick() {
      if (!hasEphemeralKey()) {
        expire("no_key");
        return;
      }
      const createdAt = readCreatedAt();
      if (createdAt) {
        const remaining = createdAt + EPHEMERAL_TTL_MS - Date.now();
        setRemainingMs(remaining);
        if (remaining <= 0) {
          expire("ttl");
          return;
        }
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    // Also re-check when the tab regains focus — common case: laptop wake.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Render the soft warning pill only in the last 5 minutes.
  if (remainingMs === null || remainingMs > WARN_MS || remainingMs <= 0) {
    return null;
  }

  const mins = Math.max(1, Math.ceil(remainingMs / 60_000));
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-[#d97706]/35 bg-[#d97706]/[0.08] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#92400e] shadow-sm"
    >
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#d97706]" />
      session expires in {mins} min
    </div>
  );
}
