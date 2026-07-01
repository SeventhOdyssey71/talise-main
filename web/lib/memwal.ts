import "server-only";
import { MemWal } from "@mysten-incubation/memwal";

/**
 * Walrus Memory (Mysten's MemWal) — hosted, persistent agent memory.
 *
 * Model note (deliberate tradeoff, chosen 2026-07-01): this is NOT the
 * server-blind design. The Walrus Memory relayer embeds memory plaintext to
 * enable semantic recall, then encrypts it at rest on Walrus under the
 * account's key. Talise holds ONE MemWal account + delegate key; every user
 * gets an isolated `namespace`, so memories never bleed between users.
 *
 * SAFETY: this touches NO database and NO `ensureSchema` — it talks only to the
 * Walrus Memory service. If the account/key env is missing it silently no-ops,
 * so chat always works and this can never affect sign-in. Enabled by default;
 * set FEATURE_AGENT_MEMORY=false to hard-disable.
 *
 * Provision the account + delegate key at app.memwal.com (or `curl -sL
 * https://memory.walrus.xyz/skills/setup`) and set on Vercel:
 *   MEMWAL_ACCOUNT_ID, MEMWAL_DELEGATE_KEY, (optional) MEMWAL_SERVER_URL.
 */

// The API relayer (memory.walrus.xyz is the product landing page, not the API).
const SERVER_URL = process.env.MEMWAL_SERVER_URL?.trim() || "https://relayer.memwal.ai";
const ACCOUNT_ID = process.env.MEMWAL_ACCOUNT_ID?.trim() || "";
const DELEGATE_KEY = process.env.MEMWAL_DELEGATE_KEY?.trim() || "";
const DISABLED = process.env.FEATURE_AGENT_MEMORY?.trim().toLowerCase() === "false";

export function memwalConfigured(): boolean {
  return !DISABLED && Boolean(ACCOUNT_ID && DELEGATE_KEY);
}

/** Per-user isolation: one Talise account, a namespace per wallet address. */
function nsFor(address: string): string {
  return `talise:${address.toLowerCase()}`;
}

function clientFor(address: string): MemWal {
  return MemWal.create({
    accountId: ACCOUNT_ID,
    key: DELEGATE_KEY,
    serverUrl: SERVER_URL,
    namespace: nsFor(address),
  });
}

/** Recall the most relevant memories for this user's message. Never throws. */
export async function recallMemories(address: string, query: string, max = 5): Promise<string[]> {
  if (!memwalConfigured() || !query.trim()) return [];
  try {
    const r = await clientFor(address).recall(query.slice(0, 500));
    return (r.results ?? [])
      .slice()
      .sort((a, b) => a.distance - b.distance)
      .slice(0, max)
      .map((m) => m.text)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  } catch {
    return [];
  }
}

/** Persist a turn to memory (fire-and-forget; never blocks the reply or throws). */
export function rememberTurn(address: string, text: string): void {
  if (!memwalConfigured() || !text.trim()) return;
  try {
    void clientFor(address).remember(text.slice(0, 2000)).catch(() => {});
  } catch {
    /* memory is best-effort; never surface to the chat path */
  }
}
