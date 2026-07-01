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
  buildMessages,
  streamDeepSeek,
  deepSeekConfig,
  type ChatContext,
} from "@/lib/chat/ai";
import { defaultCurrency } from "@/lib/fx";
import { displayRatePerUsd } from "@/lib/display-fx";
import { recallMemories, rememberTurn } from "@/lib/memwal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Walrus Memory: recall the most relevant memories for this turn and fold
  // them into the system prompt. Best-effort — recallMemories never throws and
  // returns [] when the memory service is down or unconfigured, so chat is
  // unaffected either way. Touches no DB.
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.content ?? "";
  const recalled = await recallMemories(user.sui_address, lastUser);
  const messages = buildMessages(conversation, context);
  if (recalled.length > 0 && messages[0]?.role === "system") {
    messages[0].content +=
      `\n\n## what you remember about this user\n` +
      `(durable memories from past chats, most relevant first. use them naturally; never read them back verbatim.)\n` +
      recalled.map((m) => `- ${m}`).join("\n");
  }

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

  // ---- Real provider path: stream DeepSeek deltas through SSE ------
  //
  // The web `/api/chat` route uses Vercel AI SDK's `streamText` which
  // emits a UI-message-stream format (multi-part JSONL designed for
  // the `useChat` hook). iOS can't easily parse that, so we go one
  // level lower: call the 0G proxy's OpenAI-compatible streaming
  // endpoint directly via `streamDeepSeek()` and re-emit each delta
  // as a compact `{type:"text",value:"…"}` SSE event.
  //
  // Memory is applied here directly via `lib/memwal` (the MemWal client), not
  // the AI-SDK `withMemWal` middleware — recall injected into the prompt above,
  // and we persist this user turn after a successful reply (below). Both legs
  // are best-effort and namespaced per wallet.
  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of streamDeepSeek(messages, req.signal)) {
          if (delta) {
            controller.enqueue(
              encodeSse({ type: "text", value: delta })
            );
          }
        }
        controller.enqueue(encodeSse({ type: "done" }));
        // Persist the user's turn to memory (fire-and-forget, never blocks).
        rememberTurn(user.sui_address, lastUser);
      } catch (err) {
        console.error("[chat/stream] DeepSeek loop crashed:", err);
        controller.enqueue(
          encodeSse({
            type: "text",
            value:
              "\n\n(I lost the connection mid-thought — try that again.)",
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
