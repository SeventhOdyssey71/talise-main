"use client";

/**
 * AgentHistory — the ChatGPT-style conversation sidebar for the Talise Agent.
 *
 * A slide-out LEFT drawer (overlay on every breakpoint, within the /app shell):
 * a "New chat" button, a searchable list of past conversations (title = first
 * user message, with relative time), and a per-row delete. Selecting a row
 * loads that transcript; "New chat" starts fresh. Backed entirely by the
 * localStorage `conversationsStore`.
 */

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Search01Icon,
  Delete02Icon,
  Cancel01Icon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import { EmptyState } from "@/components/app";
import {
  useConversations,
  deleteConversation,
  relativeTime,
  type Conversation,
} from "./conversationsStore";

export function AgentHistory({
  open,
  onClose,
  activeId,
  onSelect,
  onNew,
}: {
  open: boolean;
  onClose: () => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const conversations = useConversations();
  const [query, setQuery] = useState("");

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true;
      return c.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [conversations, query]);

  return (
    <>
      {/* Scrim */}
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-[90] backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ background: "rgba(21,48,12,0.35)" }}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Chat history"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-[91] flex w-[86vw] max-w-[320px] flex-col border-r border-[#15300c]/10 bg-[#f7fcf2] transition-transform duration-250 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ boxShadow: open ? "24px 0 60px -28px rgba(21,48,12,0.45)" : "none" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
            History
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="flex size-8 items-center justify-center rounded-full text-[#3a5230] transition-colors hover:bg-[#15300c]/5 hover:text-[#15300c]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
          </button>
        </div>

        {/* New chat */}
        <div className="px-4">
          <button
            type="button"
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex w-full items-center gap-2.5 rounded-full bg-[#15300c] px-4 py-2.5 text-[14px] font-semibold text-[#f7fcf2] transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <HugeiconsIcon icon={Add01Icon} size={17} strokeWidth={2.4} color="#CAFFB8" />
            New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 rounded-full border border-[#15300c]/12 bg-white/70 px-3.5 py-2">
            <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={2} color="#3d7a29" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[#15300c] outline-none placeholder:text-[#3a5230]/55"
            />
          </div>
        </div>

        {/* List */}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 ? (
            <EmptyState
              icon={
                <HugeiconsIcon
                  icon={MessageMultiple01Icon}
                  size={22}
                  strokeWidth={1.8}
                  color="#15300c"
                />
              }
              title={query ? "No matches" : "No chats yet"}
              subtitle={
                query ? "Try a different search." : "Your conversations will show up here."
              }
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              {results.map((c) => (
                <HistoryRow
                  key={c.id}
                  conv={c}
                  active={c.id === activeId}
                  onSelect={() => {
                    onSelect(c.id);
                    onClose();
                  }}
                  onDelete={() => deleteConversation(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function HistoryRow({
  conv,
  active,
  onSelect,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors ${
        active ? "bg-[#CAFFB8]/55" : "hover:bg-[#15300c]/5"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[14px] font-medium text-[#15300c]">{conv.title}</p>
        <p className="mt-0.5 text-[12px] text-[#3d7a29]">{relativeTime(conv.updatedAt)}</p>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete chat"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#3a5230]/0 transition-colors hover:bg-[#c0532f]/10 hover:text-[#c0532f] group-hover:text-[#3a5230]/70"
      >
        <HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={2} />
      </button>
    </div>
  );
}
