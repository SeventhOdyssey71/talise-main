"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SparklesFreeIcons,
  Cancel01FreeIcons,
  ArrowUp02FreeIcons,
  Loading03FreeIcons,
} from "@hugeicons/core-free-icons";
import { motion, AnimatePresence } from "framer-motion";
import { parseAssistantMessage, stepLabel, type ChatIntent } from "@/lib/chat/intent";

type Turn = {
  role: "user" | "assistant";
  content: string;
  /** Parsed intent for assistant turns. */
  intent?: ChatIntent | null;
};

const GREETING: Turn = {
  role: "assistant",
  content:
    "hey — i'm talise. ask me to send money, check your balance, or move funds into savings. one signature, no friction.",
};

/**
 * Floating agentic chat. Renders a discrete pill-shaped trigger in the
 * bottom-right of the dashboard; expanding it slides up a panel with the
 * conversation, an input, and a confirm card whenever the agent emits a
 * write intent.
 *
 * Conversation history is held in component state — refreshing the page
 * starts a fresh session (we'll persist via Memwal once the v2 env is
 * wired up). Posting `/api/chat` is stateless: we send the whole history
 * on every turn so the server doesn't need a session store.
 */
export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message whenever the conversation grows.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setBusy(true);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const j = (await r.json()) as { text?: string; intent?: ChatIntent | null };
      const reply: Turn = {
        role: "assistant",
        content: j.text ?? "(no reply)",
        intent: j.intent ?? null,
      };
      setTurns((t) => [...t, reply]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: `something went wrong: ${(err as Error).message}`,
          intent: null,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Trigger pill — bottom right, above the mobile bottom nav */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-[#1a1a1a] bg-[#1a1a1a] px-4 py-2.5 text-[13px] font-medium text-white shadow-lg shadow-black/10 transition hover:bg-[#2a2620] md:bottom-6 md:right-6"
        aria-expanded={open}
      >
        <HugeiconsIcon
          icon={SparklesFreeIcons}
          size={15}
          strokeWidth={1.8}
          color="currentColor"
        />
        Ask Talise
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed bottom-4 right-4 z-40 flex h-[min(640px,80vh)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#e8e1cf] bg-white shadow-2xl shadow-black/15 md:bottom-6 md:right-6"
          >
            {/* Header */}
            <header className="flex items-center justify-between border-b border-[#e8e1cf] bg-[#fafaf7] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1a1a1a] text-white">
                  <HugeiconsIcon
                    icon={SparklesFreeIcons}
                    size={13}
                    strokeWidth={1.8}
                    color="currentColor"
                  />
                </span>
                <div>
                  <div className="text-[13px] font-medium tracking-[-0.01em] text-[#111]">
                    Talise
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8472]">
                    your money agent
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[#5a554a] transition hover:bg-white"
              >
                <HugeiconsIcon
                  icon={Cancel01FreeIcons}
                  size={14}
                  strokeWidth={1.8}
                  color="currentColor"
                />
              </button>
            </header>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
            >
              {turns.map((t, i) => (
                <Message key={i} turn={t} />
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-[12px] text-[#8a8472]">
                  <span className="animate-spin">
                    <HugeiconsIcon
                      icon={Loading03FreeIcons}
                      size={13}
                      strokeWidth={1.8}
                      color="currentColor"
                    />
                  </span>
                  thinking…
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="border-t border-[#e8e1cf] bg-[#fafaf7] px-3 py-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="send $50 to mama, or save the rest…"
                  rows={1}
                  className="min-h-[36px] max-h-32 w-full resize-none rounded-xl border border-[#e8e1cf] bg-white px-3 py-2 text-[13px] leading-[1.4] text-[#111] placeholder-[#a09a8a] focus:border-[#1a1a1a] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a1a1a] text-white transition hover:bg-[#2a2620] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <HugeiconsIcon
                    icon={ArrowUp02FreeIcons}
                    size={14}
                    strokeWidth={2}
                    color="currentColor"
                  />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Message({ turn }: { turn: Turn }) {
  // Parse intent client-side too in case the server-side parse missed it
  // (e.g. an older cached reply from before we wired the API).
  const parsed =
    turn.role === "assistant" && !turn.intent
      ? parseAssistantMessage(turn.content)
      : { text: turn.content, intent: turn.intent ?? null };

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#1a1a1a] px-3.5 py-2 text-[13px] leading-[1.45] text-white">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {parsed.text && (
        <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[#fafaf7] px-3.5 py-2 text-[13px] leading-[1.5] text-[#111]">
          {parsed.text}
        </div>
      )}
      {parsed.intent && <IntentCard intent={parsed.intent} />}
    </div>
  );
}

function IntentCard({ intent }: { intent: ChatIntent }) {
  // Wire to /send / /earn / etc — we route the user to the actual
  // confirmation surface for each step rather than building a generic
  // multi-sign card. Less code, more familiar UX for the user.
  return (
    <div className="rounded-2xl border border-[#e8e1cf] bg-white p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8472]">
        Proposed
      </div>
      <ul className="mt-2 space-y-1.5">
        {intent.steps.map((s, i) => (
          <li
            key={i}
            className="flex items-center gap-2 text-[13px] text-[#111]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#fafaf7] font-mono text-[10px] text-[#c08a3e]">
              {i + 1}
            </span>
            {stepLabel(s)}
          </li>
        ))}
      </ul>
      {intent.rationale && (
        <p className="mt-2 text-[12px] leading-[1.45] text-[#5a554a]">
          {intent.rationale}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {/* Best-effort routing: pick the first non-readonly step to drive
            the CTA. UI rewrite to bundle into a single PTB confirm comes
            later, once we can co-sign multiple steps end to end. */}
        {intent.steps[0] && <PrimaryCTA intent={intent} />}
      </div>
    </div>
  );
}

function PrimaryCTA({ intent }: { intent: ChatIntent }) {
  const first = intent.steps[0];
  let href = "/home";
  let label = "Continue";
  switch (first.kind) {
    case "send":
      href = `/send?amount=${"amount" in first ? first.amount : ""}&to=${encodeURIComponent("recipient" in first ? first.recipient : "")}`;
      label = "Open Send";
      break;
    case "swap":
      href = "/send";
      label = "Open Swap";
      break;
    case "save":
    case "withdraw":
    case "claim_rewards":
    case "check_yield":
      href = "/earn";
      label = first.kind === "claim_rewards" ? "Open Earn (claim)" : "Open Earn";
      break;
    case "check_balance":
    case "show_activity":
      href = "/home";
      label = "Open Dashboard";
      break;
  }
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full bg-[#1a1a1a] px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#2a2620]"
    >
      {label}
    </a>
  );
}
