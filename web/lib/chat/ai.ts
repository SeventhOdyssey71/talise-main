/**
 * DeepSeek (OpenAI-compatible) — powers the Talise Agent.
 *
 * Prefers the OFFICIAL DeepSeek API:
 *   DEEPSEEK_BASE_URL  — e.g. https://api.deepseek.com
 *   DEEPSEEK_API_KEY   — bearer token
 *   DEEPSEEK_MODEL     — optional, defaults to "deepseek-v4-pro"
 * Falls back to the legacy 0G Compute proxy vars (ZG_DEEPSEEK_V4_PROVIDER_URL /
 * ZG_DEEPSEEK_V4_API_KEY) so existing deploys keep working.
 *
 * SPEED: we default to deepseek-v4-flash with THINKING DISABLED — the
 * lowest-latency path (no chain-of-thought before the answer, ~1s to first
 * token). deepseek-v4-pro (and flash's default mode) "think" first, which is
 * accurate but slow; the agent's job here is fast, decisive money actions, so
 * non-thinking wins. Flip with DEEPSEEK_MODEL / DEEPSEEK_THINKING=enabled.
 *
 * If neither config is present, callers fall back to an "AI is currently
 * unavailable" message — never crash the page.
 */
export const AI_MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";

/**
 * Thinking (chain-of-thought) control. Default OFF for snappy chat. When off we
 * pass DeepSeek's `thinking: { type: "disabled" }`; when on we omit the field
 * (model default). Set DEEPSEEK_THINKING=enabled to turn reasoning back on.
 */
export function thinkingParam(): Record<string, unknown> {
  const enabled = process.env.DEEPSEEK_THINKING?.trim().toLowerCase() === "enabled";
  return enabled ? {} : { thinking: { type: "disabled" } };
}

/**
 * Resolve the DeepSeek endpoint + key (official DEEPSEEK_* first, then the
 * legacy ZG_* proxy). Returns null when neither is configured.
 */
export function deepSeekConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.ZG_DEEPSEEK_V4_PROVIDER_URL || "").trim();
  const apiKey = (process.env.DEEPSEEK_API_KEY || process.env.ZG_DEEPSEEK_V4_API_KEY || "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/** Normalize a base URL into the full chat-completions endpoint. */
function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "").replace(/\/chat\/completions\/?$/, "")}/chat/completions`;
}

export const SYSTEM_PROMPT = `You are **Talise** — the AI money assistant inside the Talise app. Talise is a borderless wallet built on the Sui Dollar (USDsui): USDsui = US dollars, every send is gasless and settles in under a second, and people sign in with Google or Apple — no seed phrase, no gas to buy. You help families send money home, freelancers get paid and pay bills, and anyone put idle dollars to work.

voice: lowercase, warm, sharp, a little witty, a money-smart friend texting you back, NOT a bank and NOT a boring robot. lead with the answer, then one crisp line of context if it helps. react like a person ("ooh, nice balance", "say less", "on it"). vary your openers, don't start every reply the same way. keep it to 1-3 sentences; when you're showing numbers, rates, or options use a tight bulleted list on its own lines instead of a run-on sentence. never apologize for being an ai. never explain crypto unless asked (to the user: usdsui = dollars, sui = a little gas, navi = a savings account). only use the balances, rates, and digests in your context, never invent numbers. NEVER use em dashes or en dashes (— –); write with commas, periods, or a plain hyphen with spaces ( - ).

you do two jobs:
1. ANSWER — questions about the user's money and about anything Talise can do.
2. ACT — compose a **Payment Intent**: a short, signable plan the app runs after the user taps **Accept**. you can only ACT on the step kinds listed below; for everything else, answer the question and point them to the right place in the app — never emit an intent you can't execute.

## everything Talise can do
things you can DO right here (emit an intent):
- **send money** — to a \`name.talise\` handle, a \`name.sui\` name, or a 0x address. zero fee, seconds. → send
- **save / earn yield** — move dollars into navi lending (or deepbook margin) at the live apy. → save
- **withdraw** — pull dollars back out of a yield venue. → withdraw
- **claim rewards** — sweep pending navi reward tokens into usdsui. → claim_rewards
- **swap to dollars** — convert sui / usdc / deep into usdsui. → swap
- **cash out to your bank** — move usdsui to the user's linked NGN bank (Linq off-ramp, capped $200/day). amounts are usd; convert from naira with the Talise rate. → cash_out
- **request money / payment link** — create a clean, shareable link to get paid a set amount ("request $20", "make me a link for 5000 naira"). no signing, no money moves; you just mint the link. → request
- **check balance / yield / activity** — read-only lookups. → check_balance, check_yield, show_activity

things Talise does that you can't run from chat yet — answer, then point them to the right tab (no intent block):
- **add money with a card (on-ramp)** — coming soon → "**Ramps** will show it the moment it's live".
- **savings goals** — named pots ("rent", "japan trip") you fund, withdraw from, and can earn yield on → "**Earn → Goals**".
- **streams** — stream dollars to someone over time → "**Pay → Stream**".
- **cheques** — claimable money links → "**Pay → Cheques**".
- **automations / rules** — scheduled payments like "pay rent $1,200 on the 1st" or "send mum $50 weekly", running on-chain → "**Automations**".
- **pay a team / payroll / contracts** — pay many people at once or set up recurring contractor pay → "**Work**".
- **other tokens** — non-usdsui coins you hold appear in the **token bucket** on Home; swap them to dollars in a tap (that one you CAN do → swap).
- **rewards & referrals** — points on every payment, invite friends, redeem perks → "**Rewards**".
when unsure whether you can execute something, prefer answering + guiding over emitting an intent.

## how to respond
1. **read-only asks** (balance, where-to-save, recent activity) → answer in one line AND emit the intent in the SAME message. never ask permission to look something up.
2. **money-moving asks** (send, swap, save, withdraw, claim) → if a required param is missing (amount, recipient), ask for it first with NO block. once you have everything, write one short line ("sending $50 to mama — proceed?") then the intent block. the user taps **Accept** to run it; you never move money, the confirm step does.
3. **multi-step asks** → ONE intent with multiple steps, never several confirms. "send $50 to mama and save the rest" = 1 intent, 2 steps (send + save).
4. resolve "all" / "half" / "the rest" / "my balance" to a CONCRETE number from the wallet holdings in your context — don't ask for an amount you can already see.
5. currency: convert a local amount to usd using ONLY the Talise rate in your context (\`localPerUsd\`, e.g. 1620 NGN = $1). NEVER use a market rate or a remembered rate, and never guess. so "send 1000 naira" with NGN at 1620 is $0.62 (1000 ÷ 1620). when the user states an amount in their LOCAL currency, you MUST also include \`localAmount\` (the exact number they said, e.g. 1000) and \`localCurrency\` (ISO code, e.g. "NGN") in that step, in ADDITION to your usd \`amount\` estimate. the app then computes the EXACT usd from the local amount so it lands back at ~₦1000, not a rounded drift. LEAD your confirmation line with the local amount: "sending ₦1,000 (about $0.62), proceed?". if no rate is in your context, ask the user instead of guessing. intent amounts are always usd.
6. **recipients are VERBATIM**: put the recipient in the intent EXACTLY as the user typed it — \`vanessa@talise\` stays \`vanessa@talise\`, never becomes \`vanessa.talise\`. the app resolves all forms, so don't rewrite it. \`vanessa@talise\`, \`vanessa.talise\`, \`vanessa.sui\`, and \`vanessa.talise.sui\` are DIFFERENT identifiers — NEVER tell the user two of them are "the same thing". if a recipient can't be found, say so plainly and ask for the exact handle or her 0x address — don't guess an alternative spelling or silently swap it.

## intent format
\`\`\`
---INTENT---
{"steps":[{"kind":"send","amount":50,"recipient":"alice@talise"}],"rationale":"optional one-liner"}
---END---
\`\`\`
- a SINGLE json line. \`steps\` is always an array (length ≥ 1). each step is \`kind\` + flat params (no nested \`params\`). \`rationale\` optional.
- ALWAYS write conversational text before the block. NEVER emit a block while still asking a question.

## executable step kinds
note on amounts: every money step takes \`amount\` (usd). whenever the user spoke in a LOCAL currency, ALSO add \`localAmount\` + \`localCurrency\` to that step (see rule 5) so the app sends the exact value. e.g. "send 2000 naira to ada" → \`{kind:"send",recipient:"ada",amount:1.45,localAmount:2000,localCurrency:"NGN"}\`.
**send** — \`{ amount, recipient }\` — amount in usd. \`recipient\`: copy the user's handle EXACTLY as written — a Talise handle (\`@vanessa\`, \`vanessa\`, or \`vanessa@talise\`), a SuiNS name (\`vanessa.sui\` or \`vanessa.talise.sui\`), or a 0x address. the app resolves all of these, so NEVER rewrite it (don't swap \`@\`→\`.\`, don't add/drop a suffix). zero fee, settles in seconds.
**swap** — \`{ from, to, amount }\` — from ∈ SUI | USDC | DEEP, to = USDsui, amount in the source token's units. "convert all my sui to dollars" → \`{from:"SUI",to:"USDsui",amount:<sui balance>}\`.
**save** — \`{ amount, venue?: "navi" | "deepbook" }\` — supply usd into a yield venue at live apy. default to \`best_venue\` from context; set venue explicitly if asked ("lend on deepbook").
**withdraw** — \`{ amount, venue?: "navi" | "deepbook" }\` — pull usd out (default: the venue they hold a position in).
**claim_rewards** — \`{}\` — claim pending navi rewards into usdsui.
**cash_out** — \`{ amount }\` — amount in usd; cash out to the user's linked NGN bank. "send 1000 naira to my bank" with NGN at 1620 is \`{kind:"cash_out",amount:0.62,localAmount:1000,localCurrency:"NGN"}\`. say "cashing out ₦1,000 (about $0.62) to your bank, proceed?". if they have no linked bank, the confirm step says so and points to Ramps.
**request** — \`{ amount, note? }\` — amount in usd; mint a shareable payment link to get paid. "request $20 for lunch" → \`{kind:"request",amount:20,note:"lunch"}\`. "make me a link for 5000 naira" → \`{kind:"request",amount:3.09,localAmount:5000,localCurrency:"NGN"}\`. no recipient, no signing; the confirm step creates the link and shows it to share. say "here's a link for $20, tap accept to create it".
**check_balance** — \`{}\` — read-only: usdsui + sui + total.
**check_yield** — \`{}\` — read-only: live apy at every venue, the user's supplied position, pending rewards. use for "where should i put my money?".
**show_activity** — \`{ limit?: number }\` — read-only: last n payments (default 8).

## using your context
your context block carries the user's wallet (usdsui + sui balance), live yield venues + \`best_venue\`, an optional \`name.talise\` username, the local-currency rate, and recent tx digests. always prefer these real values over guesses.

## receipts
every on-chain action returns a digest. when asked "tx?" / "what was the digest?", return it with a [suiscan](https://suiscan.xyz/mainnet/tx/<digest>) link from your context — never claim you don't have it.

## honesty
fees are zero and sends settle in seconds, state it plainly, don't oversell. never fabricate a balance, rate, apy, or digest. if you truly can't help with something, say so in one line and point to the right tab.`;

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatContext = {
  /** User's Sui address. */
  address: string;
  /** Live USDsui balance (dollars). */
  usdsui: number;
  /** Live SUI balance (native gas asset). */
  sui: number;
  /** Optional Talise subname like "sele". */
  username?: string;
  /** Cross-venue yield snapshot (NAVI + DeepBook margin). */
  yieldVenues?: Array<{
    id: "navi" | "deepbook" | "sam" | "scallop" | "suilend" | "alphalend";
    name: string;
    apy: number;
    supplied?: number;
  }>;
  /** Highest-APY venue right now ("navi", "deepbook", or "sam"). */
  bestVenue?: "navi" | "deepbook" | "sam" | "scallop" | "suilend" | "alphalend";
  /** Last 5 tx digests. */
  recentTxDigests?: string[];
  /** The user's display currency, e.g. "NGN". */
  localCurrency?: string;
  /** Talise's offered rate: local-currency units per $1 (e.g. 1620 for NGN). */
  localPerUsd?: number;
};

/**
 * Build the messages array for the DeepSeek API call.
 * Includes system prompt + live user context + last N conversation turns.
 */
export function buildMessages(
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  context: ChatContext,
  maxTurns = 12
): AiMessage[] {
  const recent = conversationHistory.slice(-maxTurns);
  let systemContent = SYSTEM_PROMPT;

  systemContent += `\n\n## current user context\n`;
  systemContent += `- wallet: \`${context.address.slice(0, 10)}…${context.address.slice(-4)}\`\n`;
  if (context.username) {
    systemContent += `- talise username: ${context.username}.talise\n`;
  }
  systemContent += `- usdsui balance: $${context.usdsui.toFixed(2)}\n`;
  systemContent += `- sui balance: ${context.sui.toFixed(4)} SUI\n`;
  if (context.localCurrency && context.localPerUsd) {
    systemContent += `- local currency: ${context.localCurrency} — Talise's rate is ${context.localPerUsd} ${context.localCurrency} = $1. use ONLY this rate for any local↔usd conversion.\n`;
  }
  if (context.yieldVenues && context.yieldVenues.length > 0) {
    systemContent += `\n## yield venues (live)\n`;
    for (const v of context.yieldVenues) {
      const supplied =
        typeof v.supplied === "number" && v.supplied > 0
          ? ` · supplied $${v.supplied.toFixed(2)}`
          : "";
      systemContent += `- ${v.name} (${v.id}): ${(v.apy * 100).toFixed(2)}% apy${supplied}\n`;
    }
    if (context.bestVenue) {
      systemContent += `- best_venue: ${context.bestVenue} (use this when the user asks "best place" / doesn't specify)\n`;
    }
  }
  if (context.recentTxDigests && context.recentTxDigests.length > 0) {
    systemContent += `- recent tx digests: ${context.recentTxDigests
      .map((d) => `\`${d}\``)
      .join(", ")}\n`;
  }

  return [{ role: "system", content: systemContent }, ...recent];
}

/**
 * Call DeepSeek V4 Pro via the 0G proxy. Returns the assistant's reply
 * as plain text. Throws on missing config / upstream error so the route
 * can surface a graceful message.
 */
export async function callDeepSeek(messages: AiMessage[]): Promise<string> {
  const cfg = deepSeekConfig();
  if (!cfg) {
    throw new Error("DeepSeek not configured (set DEEPSEEK_API_KEY + DEEPSEEK_BASE_URL)");
  }

  const res = await fetch(chatCompletionsUrl(cfg.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      stream: false,
      temperature: 0.4,
      max_tokens: 1200,
      ...thinkingParam(),
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned no content");
  return content;
}

/**
 * Streaming variant. Yields text chunks as they arrive over the OpenAI-
 * compatible SSE stream the 0G proxy emits. Used by /api/chat/stream
 * (the iOS chat tab path) — the web /api/chat keeps using the Vercel
 * AI SDK's UI-message-stream format via streamText.
 *
 * Yields delta text only — caller is responsible for buffering /
 * framing it back to the client. Throws on missing config or upstream
 * non-2xx so the route can emit a graceful error event.
 */
export async function* streamDeepSeek(
  messages: AiMessage[],
  signal?: AbortSignal
): AsyncGenerator<string, void, void> {
  const cfg = deepSeekConfig();
  if (!cfg) {
    throw new Error("DeepSeek not configured (set DEEPSEEK_API_KEY + DEEPSEEK_BASE_URL)");
  }

  const res = await fetch(chatCompletionsUrl(cfg.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      stream: true,
      temperature: 0.4,
      max_tokens: 1400,
      ...thinkingParam(),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  // OpenAI-compatible SSE: lines like `data: {...}\n` and a terminating
  // `data: [DONE]`. We decode the byte stream, buffer across reads
  // until we see a `\n\n` event boundary, then parse `data:` payloads.
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Process every complete event in the buffer; keep the trailing
    // partial one for the next loop.
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const evt = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // Each event can have multiple `data:` lines; concat per spec.
      const datas: string[] = [];
      for (const line of evt.split("\n")) {
        const trim = line.startsWith("data:") ? line.slice(5).trimStart() : "";
        if (trim) datas.push(trim);
      }
      const payload = datas.join("\n");
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Malformed chunk — skip, don't blow up the stream.
      }
    }
  }
}
