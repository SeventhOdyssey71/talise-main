/**
 * Natural language over the Talise assistant.
 *   talise ask "send 5 dollars to alice"   — one-shot: reply, show intent, run on confirm
 *   talise chat                             — interactive REPL, streamed replies
 *
 * Same brain as the app: the assistant answers AND emits a Payment Intent, which
 * the CLI parses and executes (with confirmation) through the intent executor.
 */
import { createInterface } from "node:readline";
import { makeApi } from "../http.js";
import { requireSession } from "../config.js";
import { collectReply, stripIntent, type WireMessage, type Intent } from "../stream.js";
import { executeStep, describeStep } from "../intents.js";
import { emit, note, ok, confirm, heading, dim, type OutputMode } from "../format.js";

export async function ask(baseUrl: string, mode: OutputMode, prompt: string): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const messages: WireMessage[] = [{ role: "user", content: prompt }];

  // Stream the reply live in human mode; suppressed in --json/--quiet so
  // stdout stays pure data for the final emit.
  const streamOut = (d: string) => {
    if (!mode.json && !mode.quiet) process.stdout.write(d);
  };
  const { text, intent } = await collectReply(api, messages, streamOut);
  if (!mode.json && !mode.quiet) process.stdout.write("\n");

  if (!intent) {
    emit(mode, { reply: stripIntent(text), intent: null, results: [] }, () => {});
    return;
  }

  const results = await runIntent(mode, intent, api, s);
  emit(mode, { reply: stripIntent(text), intent, results }, () => {});
}

export async function chat(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const history: WireMessage[] = [];

  note(mode, heading("Talise Copilot") + dim("  - ask about your money, or tell it to send. Ctrl+C to exit."));
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "› " });
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "/exit" || input === "/quit") break;
    history.push({ role: "user", content: input });
    try {
      const { text, intent } = await collectReply(api, history, (d) => process.stdout.write(d));
      process.stdout.write("\n");
      history.push({ role: "assistant", content: text });
      if (intent) await runIntent(mode, intent, api, s);
    } catch (e) {
      note(mode, dim("(error: " + (e as Error).message + ")"));
    }
    rl.prompt();
  }
  rl.close();
}

/** Present the agent's plan, confirm, and run each step in order. */
async function runIntent(
  mode: OutputMode,
  intent: Intent,
  api: ReturnType<typeof makeApi>,
  s: ReturnType<typeof requireSession>,
): Promise<unknown[]> {
  const plan = intent.steps.map(describeStep).join("; ");
  const proceed = await confirm(mode, `Run: ${plan}?`);
  if (!proceed) {
    note(mode, "cancelled");
    return [];
  }
  const results: unknown[] = [];
  for (const step of intent.steps) {
    const r = await executeStep(api, s, step);
    results.push(r);
    if (!mode.json) {
      if ("suiscan" in r) ok(mode, `${describeStep(step)} → ${dim((r as { suiscan: string }).suiscan)}`);
      else if ("url" in r) ok(mode, `${describeStep(step)} → ${(r as { url: string }).url}`);
      else ok(mode, describeStep(step));
    }
  }
  return results;
}
