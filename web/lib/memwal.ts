import "server-only";
import { MemWal } from "@mysten-incubation/memwal";

/**
 * Walrus Memory (Mysten's MemWal) — hosted, persistent agent memory.
 *
 * Why a manual client (not the AI-SDK `withMemWal` middleware): that middleware
 * SAVES after the LLM call as fire-and-forget. In a Vercel serverless streaming
 * function the instance is frozen/killed once the response finishes, so the save
 * never lands and nothing persists across chats. Here we control both legs:
 *   • recall — awaited BEFORE the reply, injected into the prompt.
 *   • remember — awaited BEFORE the stream closes (the function stays alive while
 *     the stream is open), so the write to Walrus actually completes.
 *
 * Per-wallet namespace so memories never bleed between users. No DB. If the
 * account/key env is missing it silently no-ops. Set FEATURE_AGENT_MEMORY=false
 * to hard-disable.
 */

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

/**
 * Recalled memories are folded into the agent's system prompt, so treat their
 * text as untrusted: strip intent/memory control fences, control chars, and any
 * leading markdown heading/quote/bullet that could impersonate a prompt section.
 */
function sanitizeMemory(text: string): string {
  return text
    .replace(/---[A-Z_]{2,}---/g, " ")
    .replace(/[\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[>#*\-\s]+/, "")
    .trim()
    .slice(0, 400);
}

/** Recall the most relevant memories for this user's message. Never throws. */
export async function recallMemories(address: string, query: string, max = 6): Promise<string[]> {
  if (!memwalConfigured() || !query.trim()) return [];
  try {
    const r = await clientFor(address).recall(query.slice(0, 500));
    return (r.results ?? [])
      .slice()
      .sort((a, b) => a.distance - b.distance)
      .slice(0, max)
      .map((m) => (typeof m.text === "string" ? sanitizeMemory(m.text) : ""))
      .filter((t) => t.length > 0);
  } catch {
    return [];
  }
}

/**
 * Persist a memory and WAIT for it to be stored on Walrus (so a later chat can
 * recall it). Bounded so a slow write never hangs the request past `timeoutMs`;
 * the reply is already delivered by the time this runs. Never throws.
 */
export async function rememberFact(address: string, text: string, timeoutMs = 12_000): Promise<void> {
  if (!memwalConfigured() || !text.trim()) {
    console.log("[memwal] save skipped (configured=%s, empty=%s)", memwalConfigured(), !text.trim());
    return;
  }
  const t = text.slice(0, 1500);
  try {
    const r = (await Promise.race([
      clientFor(address).rememberAndWait(t, undefined, { timeoutMs }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs + 500)),
    ])) as { blob_id?: string } | undefined;
    console.log("[memwal] saved memory blob=%s ns=talise:%s", r?.blob_id ?? "(ok)", address.toLowerCase());
  } catch (e) {
    console.warn("[memwal] save FAILED:", (e as Error).message);
  }
}
