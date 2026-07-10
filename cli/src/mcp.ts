/**
 * `talise mcp` — a Model Context Protocol server exposing Talise as tools inside
 * Claude (Desktop / Code) and other MCP clients.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio spec).
 * Dependency-free: we speak the small subset of MCP that a tool server needs
 * (initialize, tools/list, tools/call, ping). STDOUT carries ONLY JSON-RPC
 * frames; anything human goes to stderr so the channel stays clean.
 *
 * It reuses the signed-in session (~/.talise) and the same API/intent layer the
 * CLI commands use. Money safety: `talise_send` refuses unless `confirm:true` is
 * passed, so the model has to be explicit and a stray call can't move funds.
 */
import { createInterface } from "node:readline";
import { makeApi } from "./http.js";
import { requireSession } from "./config.js";
import { executeSend, resolveRecipient } from "./intents.js";
import { collectReply, stripIntent } from "./stream.js";

const PROTOCOL_VERSION = "2024-11-05";

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: unknown };

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, baseUrl: string) => Promise<unknown>;
};

function apiFor(baseUrl: string) {
  return makeApi(baseUrl, requireSession());
}

const TOOLS: ToolDef[] = [
  {
    name: "talise_whoami",
    description: "The signed-in Talise identity: Sui address, @handle, email.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, baseUrl) => apiFor(baseUrl).get("/api/me"),
  },
  {
    name: "talise_balance",
    description: "The user's Talise balance: USDsui (US dollars), SUI, and total USD.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, baseUrl) => apiFor(baseUrl).get("/api/balances?fresh=1"),
  },
  {
    name: "talise_activity",
    description: "Recent Talise transactions (sends, receives, swaps, cash-outs).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "how many (default 10)" } },
    },
    handler: async (args, baseUrl) => {
      const limit = typeof args.limit === "number" ? args.limit : 10;
      return apiFor(baseUrl).get(`/api/activity?limit=${limit}`);
    },
  },
  {
    name: "talise_resolve",
    description: "Resolve a Talise @handle or SuiNS name to its 0x address.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "@handle, name.talise.sui, or 0x…" } },
      required: ["query"],
    },
    handler: async (args, baseUrl) => resolveRecipient(apiFor(baseUrl), String(args.query ?? "")),
  },
  {
    name: "talise_ask",
    description:
      "Ask the Talise assistant a natural-language question about the user's money (balance, where to save, activity). Returns the assistant's answer and, for money asks, the PROPOSED plan. It does NOT move money; use talise_send with confirm:true to actually send.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string", description: "what to ask, in plain English" } },
      required: ["prompt"],
    },
    handler: async (args, baseUrl) => {
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("prompt is required");
      const { text, intent } = await collectReply(apiFor(baseUrl), [{ role: "user", content: prompt }]);
      return { reply: stripIntent(text), proposedIntent: intent };
    },
  },
  {
    name: "talise_send",
    description:
      "Send USDsui (US dollars) to a Talise @handle, SuiNS name, or 0x address. IRREVERSIBLE and moves real money. Requires confirm:true; without it, returns the resolved plan for review and sends nothing.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "USD amount to send" },
        recipient: { type: "string", description: "@handle, name.talise.sui, or 0x address (passed verbatim)" },
        confirm: { type: "boolean", description: "must be true to actually send; otherwise a dry-run plan is returned" },
      },
      required: ["amount", "recipient"],
    },
    handler: async (args, baseUrl) => {
      const amount = Number(args.amount);
      const recipient = String(args.recipient ?? "").trim();
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
      if (!recipient) throw new Error("recipient is required");
      const session = requireSession();
      const api = makeApi(baseUrl, session);
      const resolved = await resolveRecipient(api, recipient);
      if (args.confirm !== true) {
        return {
          dryRun: true,
          wouldSend: { amount, to: resolved.address, recipient: resolved.label },
          note: "nothing sent. call again with confirm:true to actually send.",
        };
      }
      const r = await executeSend(api, session, { recipient: resolved.address, amount });
      return { sent: true, digest: r.digest, to: r.to, recipient: r.recipient, amount, suiscan: r.suiscan };
    },
  },
];

function send(msg: Rpc): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id: Rpc["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function err(id: Rpc["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function runMcp(baseUrl: string): Promise<void> {
  process.stderr.write("[talise mcp] server up (stdio)\n");
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: Rpc;
    try {
      req = JSON.parse(trimmed);
    } catch {
      continue; // ignore non-JSON noise
    }
    const { id, method } = req;

    // Notifications (no id) get no response.
    if (id === undefined || id === null) {
      continue;
    }

    try {
      switch (method) {
        case "initialize":
          ok(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "talise", version: "0.1.0" },
          });
          break;
        case "ping":
          ok(id, {});
          break;
        case "tools/list":
          ok(id, {
            tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          });
          break;
        case "tools/call": {
          const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
          const tool = TOOLS.find((t) => t.name === params.name);
          if (!tool) {
            err(id, -32602, `unknown tool: ${params.name}`);
            break;
          }
          try {
            const result = await tool.handler(params.arguments ?? {}, baseUrl);
            ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
          } catch (e) {
            // Tool-level failure: report as tool error content (not a protocol error)
            // so the model sees the message (e.g. "run talise login").
            ok(id, {
              content: [{ type: "text", text: `error: ${(e as Error).message}` }],
              isError: true,
            });
          }
          break;
        }
        default:
          err(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      err(id, -32603, (e as Error).message);
    }
  }
}
