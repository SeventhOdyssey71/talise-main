/**
 * `talise send <amount> <recipient>` and `talise request <amount>`.
 * Direct money commands (no agent) — resolve, confirm, sign, submit.
 */
import { makeApi } from "../http.js";
import { requireSession } from "../config.js";
import { executeSend, executeRequest, resolveRecipient } from "../intents.js";
import { emit, note, ok, confirm, money, dim, usd, type OutputMode } from "../format.js";

export async function send(
  baseUrl: string,
  mode: OutputMode,
  amountArg: string,
  recipient: string,
  asset: string,
): Promise<void> {
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountArg}`);
  if (!recipient) throw new Error("recipient required");

  const s = requireSession();
  const api = makeApi(baseUrl, s);

  // Resolve first so the confirm line shows who actually gets paid.
  const { address, label } = await resolveRecipient(api, recipient);
  const proceed = await confirm(
    mode,
    `Send ${money(usd(amount))} (${asset}) to ${label} ${dim(shorten(address))}?`,
  );
  if (!proceed) {
    note(mode, "cancelled");
    return;
  }

  const result = await executeSend(api, s, { recipient: address, amount, asset });
  emit(mode, result, () => {
    ok(mode, `sent ${money(usd(amount))} to ${label}`);
    note(mode, dim(result.suiscan));
  });
}

export async function request(
  baseUrl: string,
  mode: OutputMode,
  amountArg: string,
  noteText: string | undefined,
): Promise<void> {
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountArg}`);
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const result = await executeRequest(api, { amount, note: noteText });
  emit(mode, result, () => {
    ok(mode, `payment link for ${money(usd(amount))}`);
    note(mode, result.url);
  });
}

function shorten(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
