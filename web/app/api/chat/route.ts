import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";
import { getSuiBalance, getUsdsuiBalance } from "@/lib/sui";
import { getYieldComparison } from "@/lib/yield";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";
import {
  buildMessages,
  callDeepSeek,
  type ChatContext,
} from "@/lib/chat/ai";
import { parseAssistantMessage } from "@/lib/chat/intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat
 *
 * Body: { history: [{ role: "user" | "assistant", content: string }] }
 *
 * Stateless — the client owns conversation history and posts it whole on
 * every turn. The server tacks on the live user context (balances, yield,
 * username, recent tx digests) before calling DeepSeek so the model
 * always sees fresh on-chain state.
 *
 * Returns: { text: string, intent: ChatIntent | null }
 *   - `text` — what the UI renders as the assistant's message
 *   - `intent` — parsed from the ---INTENT--- block if present; the UI
 *     decides whether to render a confirm card (write steps) or run
 *     read-only steps inline.
 */
export async function POST(req: Request) {
  // Soft auth — if the user is signed in, we hydrate context. If not,
  // the agent still responds (with generic answers, no balances).
  const userId = await readSessionEntryId();
  const user = userId ? await userById(userId) : null;

  let body: {
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const history = Array.isArray(body.history) ? body.history : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "empty history" }, { status: 400 });
  }
  // Defensive: cap history length so a malicious client can't blow our
  // token budget. The model already truncates further inside buildMessages.
  if (history.length > 40) {
    return NextResponse.json({ error: "history too long" }, { status: 413 });
  }

  // Build context. Best-effort — if any lookup fails we still answer.
  let context: ChatContext = {
    address: user?.sui_address ?? "0x0",
    usdsui: 0,
    sui: 0,
  };
  if (user) {
    try {
      const [bal, usd, yields, sub] = await Promise.all([
        getSuiBalance(user.sui_address),
        getUsdsuiBalance(user.sui_address),
        getYieldComparison(user.sui_address).catch(() => null),
        findTaliseSubnameForOwner(user.sui_address).catch(() => null),
      ]);
      context = {
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
      };
    } catch {
      /* keep zero-state context */
    }
  }

  // Call the model.
  let reply: string;
  try {
    const messages = buildMessages(history, context);
    reply = await callDeepSeek(messages);
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[chat] DeepSeek call failed: ${msg}`);
    return NextResponse.json(
      {
        text:
          msg.includes("not configured")
            ? "The chat is offline. The DeepSeek provider isn't configured yet."
            : "Something went sideways calling the model. Try again in a sec.",
        intent: null,
      },
      { status: 200 }
    );
  }

  const parsed = parseAssistantMessage(reply);
  return NextResponse.json(parsed);
}
