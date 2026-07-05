/**
 * Direct money verbs beyond send/request: swap, save, withdraw, cashout.
 * Each resolves nothing external (amounts/venues only), confirms, signs
 * locally, and submits through the sponsored rail.
 */
import { makeApi } from "../http.js";
import { requireSession } from "../config.js";
import { executeSwap, executeSave, executeWithdraw, executeCashOut } from "../intents.js";
import { emit, note, ok, confirm, money, dim, usd, type OutputMode } from "../format.js";

export async function swap(
  baseUrl: string,
  mode: OutputMode,
  amountArg: string,
  from: string,
): Promise<void> {
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountArg}`);
  if (!from) throw new Error("usage: talise swap <amount> <SUI|USDC|DEEP>");
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  if (!(await confirm(mode, `Swap ${amount} ${from.toUpperCase()} to USDsui?`))) {
    note(mode, "cancelled");
    return;
  }
  const r = await executeSwap(api, s, { from, amount });
  emit(mode, r, () => {
    ok(mode, `swapped ${amount} ${from.toUpperCase()} to USDsui`);
    note(mode, dim(r.suiscan));
  });
}

export async function save(
  baseUrl: string,
  mode: OutputMode,
  amountArg: string,
  venue: string | undefined,
): Promise<void> {
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountArg}`);
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  if (!(await confirm(mode, `Save ${money(usd(amount))}${venue ? ` on ${venue}` : ""} to earn yield?`))) {
    note(mode, "cancelled");
    return;
  }
  const r = await executeSave(api, s, { amount, venue });
  emit(mode, r, () => {
    ok(mode, `saved ${money(usd(amount))}${venue ? ` on ${venue}` : ""}`);
    note(mode, dim(r.suiscan));
  });
}

export async function withdraw(
  baseUrl: string,
  mode: OutputMode,
  amountArg: string | undefined,
  venue: string | undefined,
): Promise<void> {
  const amount = amountArg === undefined || amountArg === "all" ? undefined : Number(amountArg);
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error(`invalid amount: ${amountArg}`);
  }
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const label = amount === undefined ? "your full position" : money(usd(amount));
  if (!(await confirm(mode, `Withdraw ${label}${venue ? ` from ${venue}` : ""}?`))) {
    note(mode, "cancelled");
    return;
  }
  const r = await executeWithdraw(api, s, { amount, venue });
  emit(mode, r, () => {
    ok(mode, `withdrew ${label}`);
    note(mode, dim(r.suiscan));
  });
}

export async function cashout(baseUrl: string, mode: OutputMode, amountArg: string): Promise<void> {
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountArg}`);
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  if (!(await confirm(mode, `Cash out ${money(usd(amount))} to your linked bank?`))) {
    note(mode, "cancelled");
    return;
  }
  const r = await executeCashOut(api, s, { amount });
  emit(mode, r, () => {
    ok(mode, `cashing out ${money(usd(amount))}${r.amountNgn ? ` (~₦${r.amountNgn.toLocaleString()})` : ""}${r.bankLast4 ? ` to ••${r.bankLast4}` : ""}`);
    note(mode, dim(r.suiscan));
  });
}
