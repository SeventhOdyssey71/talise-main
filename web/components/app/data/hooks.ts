"use client";

/**
 * Read-data hooks for the app. Each wraps an `/api/*` endpoint with simple
 * fetch-on-mount + revalidate semantics. The /api/balances and /api/activity
 * snapshots are DISPLAY-ONLY — pass `fresh` (refreshFresh / refresh) right
 * after a tx to bypass the snapshot caches.
 *
 * A global `talise:tx` window event (dispatched by useSignAndSend after a
 * successful send) triggers a fresh re-pull of balances + activity so the UI
 * reflects money movement without a manual refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

// ── Shared shapes ───────────────────────────────────────────────────────

export type Me = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  country: string | null;
  suiAddress: string;
  taliseHandle: string | null;
  accountType: string;
};

export type Balances = {
  address: string;
  usdsui: number;
  sui: number;
  suiPriceUsd: number;
  totalUsd: number;
  refreshedAt: number;
  stale: boolean;
};

export type ActivityEntry = {
  digest: string;
  timestampMs: number;
  direction: "sent" | "received";
  amountUsdsui: number;
  amountSui: number;
  counterparty: string;
  counterpartyName: string | null;
  venue: string | null;
  roundupUsdsui: number;
  otherCoin: string | null;
};

export type Contact = {
  address: string;
  name: string | null;
  lastSeenMs: number;
  sentCount: number;
  receivedCount: number;
};

// ── useMe ────────────────────────────────────────────────────────────────

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { me, loading, error, refresh };
}

// ── useBalances ────────────────────────────────────────────────────────────

export function useBalances() {
  const [data, setData] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    try {
      const b = await api<Balances>("/api/balances", { fresh });
      if (!mounted.current) return;
      setData(b);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(false), [load]);
  const refreshFresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    const onTx = () => void load(true);
    window.addEventListener("talise:tx", onTx);
    return () => {
      mounted.current = false;
      window.removeEventListener("talise:tx", onTx);
    };
  }, [load]);

  return { data, loading, error, refresh, refreshFresh };
}

// ── useActivity ────────────────────────────────────────────────────────────

export function useActivity(limit = 25) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);

  const load = useCallback(
    async (fresh: boolean) => {
      setLoading(true);
      try {
        const res = await api<{ entries: ActivityEntry[] }>("/api/activity", {
          query: { limit },
          fresh,
        });
        if (!mounted.current) return;
        setEntries(res.entries ?? []);
        setError(null);
      } catch (e) {
        if (!mounted.current) return;
        setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [limit]
  );

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    const onTx = () => void load(true);
    window.addEventListener("talise:tx", onTx);
    return () => {
      mounted.current = false;
      window.removeEventListener("talise:tx", onTx);
    };
  }, [load]);

  return { entries, loading, error, refresh };
}

// ── useContacts ────────────────────────────────────────────────────────────

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ contacts: Contact[] }>("/api/contacts");
        if (!cancelled) setContacts(res.contacts ?? []);
      } catch {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { contacts, loading };
}

// ── resolveRecipient ─────────────────────────────────────────────────────

export async function resolveRecipient(
  q: string
): Promise<{ address: string; displayName: string }> {
  return api<{ address: string; displayName: string }>("/api/recipient/resolve", {
    query: { q },
  });
}
