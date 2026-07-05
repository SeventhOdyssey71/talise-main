/**
 * Reader for the agent's SSE stream (`POST /api/chat/stream`). Frames are
 * `data: {"type":"text","value":"…"}` and a terminal `{"type":"done"}` — the
 * same wire the mobile Chat tab consumes. Yields text deltas as they arrive.
 */
import type { Api } from "./http.js";

export type WireMessage = { role: "user" | "assistant"; content: string };

export async function* streamChat(
  api: Api,
  messages: WireMessage[],
): AsyncGenerator<string, void, unknown> {
  const res = await api.raw("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`chat failed (HTTP ${res.status})${t ? ": " + t.slice(0, 200) : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line; each carries `data:` lines.
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let frame: { type?: string; value?: string };
      try {
        frame = JSON.parse(payload);
      } catch {
        continue;
      }
      if (frame.type === "text" && frame.value) yield frame.value;
      else if (frame.type === "done") return;
    }
  }
}

/**
 * Collect the agent's full reply while streaming it out via `onDelta`. Returns
 * both the human text and any parsed Payment Intent found in it.
 */
export async function collectReply(
  api: Api,
  messages: WireMessage[],
  onDelta?: (s: string) => void,
): Promise<{ text: string; intent: Intent | null }> {
  let full = "";
  for await (const delta of streamChat(api, messages)) {
    full += delta;
    onDelta?.(delta);
  }
  return { text: full, intent: extractIntent(full) };
}

export type IntentStep = {
  kind: "send" | "swap" | "save" | "withdraw" | "cash_out" | "request";
  amount?: number;
  recipient?: string;
  from?: string;
  to?: string;
  venue?: string;
  note?: string;
  localAmount?: number;
  localCurrency?: string;
};

export type Intent = { steps: IntentStep[]; rationale?: string };

/**
 * Pull the single-line Payment Intent JSON out of the agent's reply. The agent
 * emits `{"steps":[…]}` as its own line; we scan lines for a JSON object with a
 * `steps` array and take the last valid one.
 */
export function extractIntent(text: string): Intent | null {
  const candidates = text.match(/\{[^\n]*"steps"[^\n]*\}/g);
  if (!candidates) return null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]!) as Intent;
      if (Array.isArray(parsed.steps) && parsed.steps.length > 0) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Strip the intent JSON line out of the reply so we only show the human prose. */
export function stripIntent(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/\{[^\n]*"steps"[^\n]*\}/.test(line))
    .join("\n")
    .trim();
}
