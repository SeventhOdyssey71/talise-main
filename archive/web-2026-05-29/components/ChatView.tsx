"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp02FreeIcons,
  Loading03FreeIcons,
  SparklesFreeIcons,
} from "@hugeicons/core-free-icons";
import {
  parseAssistantMessage,
  stepLabel,
  type ChatIntent,
} from "@/lib/chat/intent";

/**
 * Full-page conversational view of the Talise agent.
 *
 * Powered by Vercel AI SDK + DeepSeek V4 Pro (via the 0G compute network
 * proxy). The server route also wraps the model with Memwal — facts the
 * user shares are encrypted + persisted to Walrus, and recalled
 * automatically on every turn.
 *
 * Renders as a centered chat column with a sticky composer at the bottom.
 * No floating button anymore — the sidebar "Talise" nav item is now the
 * one place to find the agent.
 */
export function ChatView() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  // Auto-scroll to the latest message whenever the conversation grows.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
  }

  const showGreeting = messages.length === 0;

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] w-full max-w-3xl flex-col md:h-[calc(100vh-180px)]">
      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-6">
        {showGreeting && (
          <Greeting onSuggestion={(s) => submit(s)} />
        )}

        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}

        {busy && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-[#8a8472]">
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

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error.message}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!inputRef.current) return;
          submit(inputRef.current.value);
          inputRef.current.value = "";
          inputRef.current.style.height = "auto";
        }}
        className="border-t border-[var(--color-line)] bg-[var(--color-bg)] pt-4"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-line)] bg-white px-3.5 py-2.5 shadow-[0_4px_24px_-16px_rgba(0,0,0,0.1)] focus-within:border-[#1a1a1a]">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="send $50 to mama, or move my savings into deepbook…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (inputRef.current) {
                  submit(inputRef.current.value);
                  inputRef.current.value = "";
                  inputRef.current.style.height = "auto";
                }
              }
            }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 160) + "px";
            }}
            className="min-h-[28px] max-h-40 w-full resize-none border-none bg-transparent text-[14px] leading-[1.5] text-[#111] placeholder-[#a09a8a] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
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
        <p className="mt-2 px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#a09a8a]">
          Powered by DeepSeek V4 Pro · Persistent memory via Memwal
        </p>
      </form>
    </div>
  );
}

function Greeting({
  onSuggestion,
}: {
  onSuggestion: (text: string) => void;
}) {
  const suggestions = [
    "what's my balance?",
    "what's the best place to save my dollars?",
    "send $50 to mama.talise",
    "move my savings into deepbook",
  ];
  return (
    <div className="rounded-3xl border border-[#e8e1cf] bg-[#fafaf7] p-8">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1a1a] text-white">
        <HugeiconsIcon
          icon={SparklesFreeIcons}
          size={16}
          strokeWidth={1.8}
          color="currentColor"
        />
      </span>
      <h2 className="mt-5 text-[24px] font-medium tracking-[-0.02em] text-[#111] md:text-[28px]">
        Hey — I&apos;m Talise.
      </h2>
      <p className="mt-2 max-w-md text-[14px] leading-[1.55] text-[#5a554a]">
        Ask me to send money, check your balance, or move funds into yield.
        One signature, no friction. I remember context across sessions.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestion(s)}
            className="rounded-full border border-[#e8e1cf] bg-white px-3.5 py-1.5 text-[12px] text-[#5a554a] transition hover:border-[#1a1a1a] hover:text-[#111]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

type ChatMessage = ReturnType<typeof useChat>["messages"][number];

function MessageRow({ message }: { message: ChatMessage }) {
  // Vercel UIMessages have `parts: [{type, text|...}]`. We render all text
  // parts joined for the assistant; intent parsing happens on the joined
  // text so the agent can interleave conversation + the ---INTENT--- block.
  const text = (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[#1a1a1a] px-3.5 py-2.5 text-[14px] leading-[1.5] text-white">
          {text}
        </div>
      </div>
    );
  }

  const parsed = parseAssistantMessage(text);
  return (
    <div className="space-y-2">
      {parsed.text && (
        <div className="max-w-[86%] rounded-2xl rounded-bl-md bg-[#fafaf7] px-4 py-2.5 text-[14px] leading-[1.55] text-[#111]">
          {parsed.text}
        </div>
      )}
      {parsed.intent && <IntentCard intent={parsed.intent} />}
    </div>
  );
}

function IntentCard({ intent }: { intent: ChatIntent }) {
  return (
    <div className="max-w-[86%] rounded-2xl border border-[#e8e1cf] bg-white p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8472]">
        Proposed
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {intent.steps.map((s, i) => (
          <li
            key={i}
            className="flex items-center gap-2.5 text-[13px] text-[#111]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#fafaf7] font-mono text-[10px] text-[#c08a3e]">
              {i + 1}
            </span>
            {stepLabel(s)}
          </li>
        ))}
      </ul>
      {intent.rationale && (
        <p className="mt-3 text-[12px] leading-[1.5] text-[#5a554a]">
          {intent.rationale}
        </p>
      )}
      {intent.steps[0] && <PrimaryCTA intent={intent} />}
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
      label =
        first.kind === "claim_rewards" ? "Open Earn (claim)" : "Open Earn";
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
      className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#1a1a1a] px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#2a2620]"
    >
      {label}
    </a>
  );
}
