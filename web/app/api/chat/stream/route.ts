/**
 * Talise agent — streaming chat for the iOS Chat tab.
 *
 * Wire format: Server-Sent Events. Each frame is `data: <json>\n\n`.
 * Event types (compact form for iOS):
 *   - `{"type":"text","value":"…"}` — incremental assistant text token(s)
 *   - `{"type":"done"}`             — terminal frame
 *
 * Provider stack — same brain the web `/api/chat` route uses, just
 * presented over the iOS-friendly SSE wire format:
 *   - System prompt + structured Payment-Intent rules from `lib/chat/ai.ts`
 *   - Live user context (USDsui + SUI balance, yield venues, subname) via
 *     `buildMessages()`
 *   - DeepSeek V4 Pro via the 0G Compute OpenAI-compatible proxy
 *     (`ZG_DEEPSEEK_V4_PROVIDER_URL` / `_API_KEY`)
 *   - Memwal per-wallet memory namespace (optional, degrades cleanly)
 *
 * Auth: bearer token via `readEntryIdFromRequest`. We never accept
 * anonymous requests. If the AI provider isn't configured we emit a
 * single-frame stub so the iOS UI loop can exercise the SSE parser
 * end-to-end in dev.
 */
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";
import { getSuiBalance, getUsdsuiBalance } from "@/lib/sui";
import { getYieldComparison } from "@/lib/yield";
import { getRecentActivity } from "@/lib/activity";
import {
  AI_MODEL,
  buildMessages,
  deepSeekConfig,
  type ChatContext,
} from "@/lib/chat/ai";
import { defaultCurrency } from "@/lib/fx";
import { displayRatePerUsd } from "@/lib/display-fx";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { withMemWal } from "@mysten-incubation/memwal/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Official Walrus Memory (MemWal). Configured in prod (MEMWAL_* env). The
// middleware recalls the user's relevant facts before each call and extracts +
// encrypts + stores new ones on Walrus after it — per-wallet namespace, no DB.
const MEMWAL_KEY = process.env.MEMWAL_DELEGATE_KEY || "";
const MEMWAL_ACCOUNT_ID = process.env.MEMWAL_ACCOUNT_ID || "";
const MEMWAL_SERVER_URL = process.env.MEMWAL_SERVER_URL || "https://relayer.memwal.ai";
const memwalConfigured = Boolean(MEMWAL_KEY && MEMWAL_ACCOUNT_ID);

/** createOpenAI appends `/chat/completions` itself — strip it if env includes it. */
function deepseekBaseURL(raw: string): string {
  return raw.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function encodeSse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function POST(req: Request) {
  // ---- Auth ---------------------------------------------------------
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const user = await userById(userId);
  if (!user) {
    return new Response(JSON.stringify({ error: "user not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // ---- Input --------------------------------------------------------
  let body: { messages?: IncomingMessage[] };
  try {
    body = (await req.json()) as { messages?: IncomingMessage[] };
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return new Response(JSON.stringify({ error: "empty messages" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (incoming.length > 40) {
    return new Response(JSON.stringify({ error: "history too long" }), {
      status: 413,
      headers: { "content-type": "application/json" },
    });
  }

  // ---- Hydrate the same live context the web /api/chat builds ------
  //
  // The Talise agent grounds every reply in the user's actual balance /
  // yield positions / recent activity. Doing this server-side rather
  // than letting the model "ask a tool" cuts a round-trip per chat
  // turn — we pay one bulk hydrate up front and stream the answer.
  const [bal, usd, yields, sub, recentTxs] = await Promise.all([
    getSuiBalance(user.sui_address).catch(() => ({ sui: 0, mist: "0" })),
    getUsdsuiBalance(user.sui_address).catch(() => ({ usdsui: 0, raw: "0" })),
    getYieldComparison(user.sui_address).catch(() => null),
    findTaliseSubnameForOwner(user.sui_address).catch(() => null),
    getRecentActivity(user.sui_address, 5, { includeNonTalise: true })
      .catch(() => []),
  ]);
  // The user's display currency (geo/settings later; NGN default for now) +
  // the SAME live rate the app shows, so "send 1000 naira" converts to a $ amount
  // that displays back as ~₦1000 (not the static FX snapshot, which drifted).
  const agentCurrency = defaultCurrency();
  const agentRate = await displayRatePerUsd(agentCurrency).catch(() => undefined);
  const context: ChatContext = {
    address: user.sui_address,
    usdsui: usd.usdsui,
    sui: bal.sui,
    username: sub?.username,
    yieldVenues: yields?.venues.map((v) => ({
      id: v.id,
      name: v.name,
      apy: v.apy,
      supplied: v.supplied,
    })),
    bestVenue: yields?.best?.id,
    recentTxDigests: recentTxs.map((e) => e.digest).slice(0, 5),
    // The live display rate so the agent never guesses when a user talks in
    // their local currency ("send 1000 naira").
    localCurrency: agentCurrency,
    localPerUsd: agentRate,
  };

  const conversation = incoming
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))
    .filter((m) => m.content.length > 0);

  // Memory is handled entirely by the official Walrus Memory middleware
  // (`withMemWal`, wired below): it recalls the user's relevant facts into the
  // prompt before the call and extract-saves new ones after — encrypted on
  // Walrus, per-wallet namespace. No manual recall/store here, no DB.
  const messages = buildMessages(conversation, context);

  // ---- Stub fallback (no DeepSeek key) -----------------------------
  //
  // Lets the iOS client exercise the SSE plumbing without a real
  // provider key. Used by the test-app.mts smoke suite + first-run
  // dev environments. Will not fire in prod since the env is set.
  if (!deepSeekConfig()) {
    const stub =
      "Chat is configured but the AI provider keys aren't set in this " +
      "environment — set DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL to enable " +
      "Talise's agent.";
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeSse({ type: "text", value: stub }));
        controller.enqueue(encodeSse({ type: "done" }));
        controller.close();
      },
    });
    return new Response(sseStream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  // ---- Real provider path: stream the model through SSE ------------
  //
  // We run the AI SDK's `streamText` (so the official `withMemWal` memory
  // middleware can wrap the model) but re-emit its `textStream` deltas as the
  // compact `{type:"text",value:"…"}` SSE frames the iOS client parses — rather
  // than the AI SDK's `useChat` UI-message-stream format.
  //
  // Build the DeepSeek model through the AI SDK, wrapped with the official
  // Walrus Memory middleware (per-wallet namespace). `withMemWal` recalls the
  // user's relevant memories into the prompt before the call and extract-saves
  // new facts (encrypted on Walrus) after it — fire-and-forget, never blocks.
  // Degrades cleanly to the bare model when MEMWAL_* isn't set.
  const cfg = deepSeekConfig()!; // non-null: the stub above returned if unset
  const provider = createOpenAI({
    apiKey: cfg.apiKey,
    baseURL: deepseekBaseURL(cfg.baseUrl),
  });
  const baseModel = provider.chat(AI_MODEL);
  const model = memwalConfigured
    ? withMemWal(baseModel, {
        key: MEMWAL_KEY,
        accountId: MEMWAL_ACCOUNT_ID,
        serverUrl: MEMWAL_SERVER_URL,
        namespace: `talise:${user.sui_address.toLowerCase()}`,
        maxMemories: 5,
        autoSave: true,
        minRelevance: 0.3,
      })
    : baseModel;

  const systemPrompt = messages[0]?.role === "system" ? messages[0].content : "";
  const convoOnly = messages.filter((m) => m.role !== "system") as Array<{
    role: "user" | "assistant";
    content: string;
  }>;

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = streamText({
          model,
          system: systemPrompt,
          messages: convoOnly,
          temperature: 0.4,
          maxOutputTokens: 4096,
          abortSignal: req.signal,
          onError: ({ error }) =>
            console.error("[chat/stream] streamText error:", error),
        });
        for await (const delta of result.textStream) {
          if (delta) controller.enqueue(encodeSse({ type: "text", value: delta }));
        }
        controller.enqueue(encodeSse({ type: "done" }));
      } catch (err) {
        console.error("[chat/stream] stream crashed:", err);
        controller.enqueue(
          encodeSse({
            type: "text",
            value: "\n\n(I lost the connection mid-thought — try that again.)",
          })
        );
        controller.enqueue(encodeSse({ type: "done" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
