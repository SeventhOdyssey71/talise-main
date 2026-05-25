import "server-only";

import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import { USDSUI_TYPE } from "./usdsui";
import { findTaliseSubnameForOwner } from "./suins-lookup";
import { formatHandle } from "./handle";
import { globalRegistryId, namespaceObjectId } from "./payment-kit";
import { parsePaymentKitNonce, type ParsedTaliseMemo } from "./intents/wrap-payment-kit";

/**
 * On-chain activity feed.
 *
 * We don't trust our local `tx_history` table as the source of truth —
 * inbound payments aren't recorded there at all, and outbound rows can be
 * lost across DB resets or failed write-backs. The chain has everything
 * we need: who sent what, to whom, when, in which coin.
 *
 * Approach per address:
 *   1. Query `suix_queryTransactionBlocks` twice — FromAddress + ToAddress
 *   2. Parse the `balanceChanges` block of each tx; isolate the user's
 *      net delta in USDsui (or SUI, for non-converted holdings).
 *   3. The counterparty is the other address with the inverse delta.
 *   4. Reverse-resolve the counterparty's `*.talise.sui` if they hold one,
 *      so the UI can render "from emma@talise" instead of `0xb9aa…866c`.
 *
 * Classification order per tx (most → least authoritative):
 *
 *   A. **Payment Kit PaymentRecord lookup** — if the tx created a
 *      `PaymentRecord<…>` dynamic field under the talise registry, we
 *      pull the nonce out of the `processRegistryPayment` MoveCall's
 *      arguments and parse it via `parsePaymentKitNonce`. A successful
 *      parse gives us the AUTHORITATIVE kind + venue + sender/receiver
 *      — the tx was originated by Talise and the on-chain memo carries
 *      everything we need.
 *
 *   B. **MoveCall package heuristic** — for pre-PK-wrapper txs (NAVI
 *      supply, DeepBook supply, etc. from before the wrapper landed),
 *      fall back to sniffing the venue's package id. Less authoritative
 *      but covers historical activity that doesn't have a PK record.
 *
 *   C. **Plain transfer** — direction from `balanceChanges` (the user's
 *      net USDsui/SUI delta is the sign).
 */

export type ActivityEntry = {
  digest: string;
  timestampMs: number;
  /**
   * Coarse motion direction — used by iOS for amount sign + tint.
   * `invest` and `withdraw` are direction-neutral (no counterparty
   * address), but iOS still wants a stable label for the History row.
   */
  direction: "sent" | "received" | "invest" | "withdraw";
  /** Net amount the user's address moved, in human units. Positive = received. */
  amountUsdsui: number | null;
  amountSui: number | null;
  /** Counterparty Sui address (or null for self / sponsor-only flows). */
  counterparty: string | null;
  /** Resolved `name@talise` display string, if the counterparty holds a Talise subname. */
  counterpartyName: string | null;
  /**
   * For invest/withdraw rows: which venue the tx interacted with —
   * e.g. "deepbook", "navi". Lets iOS show "Invested in DeepBook"
   * instead of just "Invested". Null for plain send/receive rows.
   */
  venue: string | null;
  /**
   * Compound spend+save flag. When a Send PTB included a round-up
   * NAVI supply leg (Phase 2 v2), the tx digest has BOTH a `send`
   * and an `invest` PK PaymentRecord. We collapse them into ONE
   * activity row — `direction: "sent"`, `amountUsdsui` = the send
   * leg, and `roundupUsdsui` = the auto-saved portion. iOS renders
   * a "Sent + saved" row with both numbers visible.
   * Null on non-compound rows.
   */
  roundupUsdsui: number | null;
};

/**
 * Package IDs we recognize as "yield venues" for the heuristic fallback
 * (path B). Anything calling these — that didn't already classify via
 * the PK PaymentRecord (path A) — gets tagged invest / withdraw.
 *
 * IDs were pulled directly from real mainnet user txs (mid-2026):
 *
 * - DeepBook margin: v1 anchor (0x97d9…fb86b — original type-anchor),
 *   the post-upgrade package (0x124b…ff2e — current), and an
 *   intermediate id (0xfbd3…1377). We match all three so neither
 *   pre-upgrade caps nor newly minted ones slip through unlabelled.
 *
 * - NAVI: lending v3 lives in `incentive_v3::*` (entry_deposit /
 *   withdraw_v2 etc.) under 0x1e4a13a0494d…. Oracle prelude
 *   (oracle_pro::update_single_price_v2) is noise we intentionally
 *   don't tag as a "venue" — the real NAVI call always follows it in
 *   the same PTB and is what we classify.
 */
const VENUE_PACKAGES: Array<{ pkg: string; venue: string }> = [
  // DeepBook margin protocol — original (v1) and upgraded ids.
  { pkg: "0x97d9473771b01f77b0940c589484184b49f6444627ec121314fae6a6d36fb86b", venue: "deepbook" },
  { pkg: "0xfbd322126f1452fd4c89aedbaeb9fd0c44df9b5cedbe70d76bf80dc086031377", venue: "deepbook" },
  { pkg: "0x124bb3d8105d6d301c0d40feaa54d65df6b301e4d8ddd5eb8475b0f8a18cff2e", venue: "deepbook" },
  // NAVI lending — incentive_v3 module.
  { pkg: "0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb", venue: "navi" },
];

/// Function-name substrings that flip a venue call into "withdraw".
/// Everything else under a venue package (entry_deposit, supply,
/// mint_supplier_cap, repay, …) folds into "invest" as the default —
/// better to over-tag as invest than mislabel as sent.
const WITHDRAW_FN_HINTS = ["withdraw", "redeem", "claim"];

function classifyVenue(tx: RawTx): { venue: string; kind: "invest" | "withdraw" } | null {
  const moveTxs = tx.transaction?.data?.transaction?.transactions ?? [];
  for (const t of moveTxs) {
    const call = t.MoveCall ?? t;
    const pkg = (call?.package ?? "").toLowerCase();
    const fn = (call?.function ?? "").toLowerCase();
    if (!pkg) continue;
    const hit = VENUE_PACKAGES.find((v) => v.pkg.toLowerCase() === pkg);
    if (!hit) continue;
    const isWithdraw = WITHDRAW_FN_HINTS.some((h) => fn.includes(h));
    return { venue: hit.venue, kind: isWithdraw ? "withdraw" : "invest" };
  }
  return null;
}

const SPONSOR_ADDRESSES = new Set<string>([
  "0x8a319488de2a8043a7b503d4a906ce5feedb793787bdb9a63bc6327d46310cdb",
]);

let _client: SuiJsonRpcClient | null = null;
function client(): SuiJsonRpcClient {
  if (_client) return _client;
  _client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl("mainnet"),
    network: "mainnet",
  });
  return _client;
}

type RawObjectChange = {
  type?: string;
  objectType?: string;
  objectId?: string;
  owner?:
    | { AddressOwner?: string; ObjectOwner?: string; Shared?: unknown }
    | string;
};

/**
 * SuiArgument shape — either "GasCoin" (literal string), or an object
 * with `Input`/`Result`/`NestedResult` referencing other PTB slots. We
 * only care about `Input` (which indexes into the tx's `inputs[]`).
 */
type RawSuiArgument =
  | "GasCoin"
  | { Input?: number; Result?: number; NestedResult?: [number, number] };

type RawMoveCall = {
  package?: string;
  module?: string;
  function?: string;
  arguments?: RawSuiArgument[];
  type_arguments?: string[];
};

type RawTransactionInput = {
  MoveCall?: RawMoveCall;
  kind?: string;
  package?: string;
  module?: string;
  function?: string;
};

/**
 * SuiCallArg — one entry in the PTB's `inputs[]` array. `pure` inputs
 * carry the actual primitive value (string, number, bool, address). We
 * only need to read the `value` field when the input type is "pure".
 */
type RawSuiCallArg = {
  type?: "object" | "pure" | "fundsWithdrawal";
  value?: unknown;
  valueType?: string | null;
  objectId?: string;
};

type RawTx = {
  digest?: string;
  timestampMs?: string;
  effects?: { status?: { status?: string } };
  balanceChanges?: Array<{
    owner?: { AddressOwner?: string } | string;
    coinType?: string;
    amount?: string;
  }>;
  objectChanges?: RawObjectChange[];
  transaction?: {
    data?: {
      transaction?: {
        kind?: string;
        inputs?: RawSuiCallArg[];
        transactions?: RawTransactionInput[];
      };
    };
  };
};

type RawBalanceChange = NonNullable<RawTx["balanceChanges"]>[number];

function ownerOf(b: RawBalanceChange): string | null {
  if (!b.owner) return null;
  if (typeof b.owner === "string") return null;
  return b.owner.AddressOwner ?? null;
}

/** Split balance changes into per-(address × coin) deltas, ignoring sponsor moves. */
function summarize(
  tx: RawTx,
  myAddress: string
): {
  myUsdsui: number;
  mySui: number;
  counterparty: string | null;
} {
  const me = myAddress.toLowerCase();
  let myUsdsui = 0;
  let mySui = 0;
  // pick the largest non-self, non-sponsor counterparty by absolute USDsui (then SUI) movement
  const others: Record<string, { usdsui: number; sui: number }> = {};

  for (const b of tx.balanceChanges ?? []) {
    const owner = (ownerOf(b) ?? "").toLowerCase();
    if (!owner) continue;
    const amt = Number(b.amount ?? "0");
    if (b.coinType === USDSUI_TYPE) {
      const human = amt / 1e6;
      if (owner === me) myUsdsui += human;
      else if (!SPONSOR_ADDRESSES.has(owner)) {
        others[owner] ??= { usdsui: 0, sui: 0 };
        others[owner].usdsui += human;
      }
    } else if (b.coinType === "0x2::sui::SUI") {
      const human = amt / 1e9;
      if (owner === me) mySui += human;
      else if (!SPONSOR_ADDRESSES.has(owner)) {
        others[owner] ??= { usdsui: 0, sui: 0 };
        others[owner].sui += human;
      }
    }
  }

  // Pick counterparty with the biggest opposing movement (largest abs USDsui, fallback SUI).
  let counterparty: string | null = null;
  let bestScore = 0;
  for (const [addr, d] of Object.entries(others)) {
    const score = Math.abs(d.usdsui) || Math.abs(d.sui);
    if (score > bestScore) {
      bestScore = score;
      counterparty = addr;
    }
  }

  return { myUsdsui, mySui, counterparty };
}

/**
 * True iff this transaction wrote a PaymentRecord dynamic field under the
 * Talise payment-kit registry. We detect this by inspecting `objectChanges`:
 * any object whose owner is `ObjectOwner == registryId` is a child dynamic
 * field of the registry — i.e. a PaymentRecord we minted. We also accept a
 * MoveCall against the payment-kit namespace package as a secondary signal,
 * which covers edge cases where the RPC elides the child object change
 * (e.g. when the registry is created inline in the same tx).
 */
function isTaliseTransaction(
  tx: RawTx,
  registryId: string,
  namespaceId: string
): boolean {
  const reg = registryId.toLowerCase();
  const ns = namespaceId.toLowerCase();
  for (const oc of tx.objectChanges ?? []) {
    const owner = oc.owner;
    if (owner && typeof owner !== "string") {
      const objOwner = owner.ObjectOwner;
      if (objOwner && objOwner.toLowerCase() === reg) return true;
    }
    // Also catch the registry itself being created/mutated in this tx, which
    // can happen on the first-ever payment that bootstraps the registry.
    if (oc.objectId && oc.objectId.toLowerCase() === reg) return true;
  }
  const moveTxs = tx.transaction?.data?.transaction?.transactions ?? [];
  for (const t of moveTxs) {
    const call = t.MoveCall ?? t;
    const pkg = (call?.package ?? "").toLowerCase();
    if (pkg && pkg === ns) return true;
  }
  return false;
}

/**
 * True iff `objectType` is a PaymentRecord under the payment-kit module
 * (any type-arg). Used to detect the authoritative PK-mint signal in
 * `objectChanges` without depending on a specific coin type-arg.
 *
 * On-chain shape: `<pkg>::payment_kit::PaymentRecord<<coinType>>`.
 */
function isPaymentRecordType(objectType: string | undefined): boolean {
  if (!objectType) return false;
  // The `<…>` strips type arg variance; we just match the module + name.
  return /::payment_kit::PaymentRecord</.test(objectType);
}

/**
 * AUTHORITATIVE PATH (A) — recover the Talise memo from a tx.
 *
 * Walks two layers of the tx in lockstep:
 *
 *   1. Confirm `objectChanges` has a PaymentRecord under `registryId`.
 *      Without this we don't trust the MoveCall path (a 3rd-party app
 *      could call the same PK package against a different registry).
 *
 *   2. Find the `processRegistryPayment` MoveCall (module=payment_kit,
 *      function=process_registry_payment). Its `arguments[1]` is the
 *      `nonce: String` — a pure input. We resolve the `Input: n` index
 *      into the PTB's `inputs[]` and read the pure `value` (a string).
 *
 *   3. Parse the string via `parsePaymentKitNonce`. If it returns null
 *      (e.g. the nonce is from a third-party invoice or a `v2` future
 *      format we don't understand), we fall through to the heuristic.
 *
 * Returns null when the tx isn't a Talise PK tx OR when we can find
 * the PaymentRecord object change but can't parse a v1 Talise memo
 * out of the nonce (rare — e.g. legacy invoice-slug payments).
 *
 * All data we read here is already in the `RawTx` that
 * `queryTransactionBlocks` returned (showObjectChanges + showInput) —
 * NO additional RPC round-trips per tx.
 */
/**
 * Parsed memo enriched with the on-chain USDsui amount extracted from
 * the same `processRegistryPayment` MoveCall's `paymentAmount` input.
 * Used to attribute amounts when a single tx has multiple PK legs (the
 * compound spend+save case from the Phase 2 v2 round-up flow).
 */
interface ParsedTaliseMemoWithAmount extends ParsedTaliseMemo {
  amountUsdsui: number;
}

/**
 * Read a `pure` input as a string OR a UTF-8 byte array (RPCs vary).
 * Returns null if neither form is present.
 */
function readPureString(input: RawSuiCallArg | undefined): string | null {
  if (!input || input.type !== "pure") return null;
  if (typeof input.value === "string") return input.value;
  if (Array.isArray(input.value)) {
    try {
      return Buffer.from(input.value as number[]).toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read a `pure` input as a u64 micro-USDsui amount and convert to
 * human USDsui (1:1 USD). Sui RPCs emit u64 as a JS string. Some
 * older fullnodes emit it as a number; handle both. Returns 0 on
 * failure rather than null — a zero-amount PK call should sort to
 * the back, not crash classification.
 */
function readU64AsUsdsui(input: RawSuiCallArg | undefined): number {
  if (!input || input.type !== "pure") return 0;
  const v = input.value;
  let micro = 0;
  if (typeof v === "string") {
    const n = Number(v);
    micro = Number.isFinite(n) ? n : 0;
  } else if (typeof v === "number") {
    micro = v;
  }
  return micro / 1e6;
}

/**
 * Walk EVERY `process_registry_payment` MoveCall in the tx and return
 * a parsed memo (with amount) for each one that's owned by the talise
 * registry. Used by the main classifier to detect the compound
 * spend+save case (a Send PTB built by `/api/send/prepare` when
 * round-up is on emits two PK calls in the same digest: one `send`,
 * one `invest`).
 *
 * Single-record txs hit this and the caller picks the only entry; the
 * structure is uniform so we don't branch.
 */
function parseAllTalisePaymentRecords(
  tx: RawTx,
  registryId: string
): ParsedTaliseMemoWithAmount[] {
  const reg = registryId.toLowerCase();

  // Gate on at least one PaymentRecord under the talise registry (so
  // third-party PK calls don't accidentally classify as Talise).
  let hasTalisePaymentRecord = false;
  for (const oc of tx.objectChanges ?? []) {
    const owner = oc.owner;
    if (!owner || typeof owner === "string") continue;
    const objOwner = owner.ObjectOwner;
    if (!objOwner || objOwner.toLowerCase() !== reg) continue;
    if (isPaymentRecordType(oc.objectType)) {
      hasTalisePaymentRecord = true;
      break;
    }
  }
  if (!hasTalisePaymentRecord) return [];

  const inputs = tx.transaction?.data?.transaction?.inputs ?? [];
  const moveTxs = tx.transaction?.data?.transaction?.transactions ?? [];

  const out: ParsedTaliseMemoWithAmount[] = [];
  for (const t of moveTxs) {
    const call = t.MoveCall;
    if (!call) continue;
    if (call.module !== "payment_kit") continue;
    if (call.function !== "process_registry_payment") continue;

    // process_registry_payment(registry, nonce, paymentAmount, coin, receiver)
    // args[1] = nonce (pure string), args[2] = paymentAmount (pure u64).
    const args = call.arguments ?? [];
    const nonceArg = args[1];
    const amountArg = args[2];
    if (!nonceArg || typeof nonceArg === "string") continue;
    const nonceIdx = nonceArg.Input;
    if (typeof nonceIdx !== "number") continue;
    const nonce = readPureString(inputs[nonceIdx]);
    if (!nonce) continue;
    const parsed = parsePaymentKitNonce(nonce);
    if (!parsed) continue;

    let amountUsdsui = 0;
    if (amountArg && typeof amountArg !== "string") {
      const amountIdx = amountArg.Input;
      if (typeof amountIdx === "number") {
        amountUsdsui = readU64AsUsdsui(inputs[amountIdx]);
      }
    }
    out.push({ ...parsed, amountUsdsui });
  }
  return out;
}

/** Back-compat wrapper — first memo only. Used by callers that don't
 *  care about the compound case (and to keep older code paths intact).
 */
function classifyFromPaymentRecord(
  tx: RawTx,
  registryId: string
): ParsedTaliseMemo | null {
  const all = parseAllTalisePaymentRecords(tx, registryId);
  return all[0] ?? null;
}

/**
 * Map a parsed Talise memo to the iOS-facing direction + venue. The
 * memo's `kind` is the canonical source of truth — the user explicitly
 * told us what this tx was when we built the nonce.
 *
 * Direction mapping:
 *   - send / split / recur / agent_pay → user's net delta sign (sent
 *     vs received from the user's POV — these are real transfers, so
 *     the user is either sender or receiver and direction follows from
 *     their balance change).
 *   - invest / swap → "invest" (yield-bound)
 *   - withdraw → "withdraw"
 */
function memoToClassification(
  memo: ParsedTaliseMemo,
  myUsdsui: number,
  mySui: number
): { direction: ActivityEntry["direction"]; venue: string | null } {
  switch (memo.kind) {
    case "invest":
      return { direction: "invest", venue: memo.refs.venue ?? null };
    case "withdraw":
      return { direction: "withdraw", venue: memo.refs.venue ?? null };
    case "swap":
      // Swap is value-conserving; for the activity row we treat it as
      // a generic non-transfer. iOS already special-cases swap when
      // we wire it up — fall back to "invest" tint for now (it's the
      // closest direction-neutral label we have).
      return { direction: "invest", venue: memo.refs.venue ?? null };
    case "send":
    case "split":
    case "recur":
    case "agent_pay":
    default: {
      const direction: ActivityEntry["direction"] =
        myUsdsui < 0 || mySui < 0 ? "sent" : "received";
      return { direction, venue: null };
    }
  }
}

/**
 * `includeNonTalise: true` shows every successful USDsui / SUI movement
 * the address has been involved in, regardless of whether the tx flowed
 * through Talise's payment-kit registry. Used by the iOS /api/activity
 * feed (users want to see "money I received" — they don't care about
 * which kit was used). The web feeds keep the curated default so the
 * Talise UI stays branded.
 */
export async function getRecentActivity(
  address: string,
  limit = 12,
  opts: { includeNonTalise?: boolean } = {}
): Promise<ActivityEntry[]> {
  const c = client();
  const options = {
    showEffects: true,
    showBalanceChanges: true,
    showObjectChanges: true,
    showInput: true,
  };
  type Resp = { data?: RawTx[]; nextCursor?: string | null; hasNextPage?: boolean };
  // We filter out non-Talise transactions client-side, so over-fetch by a
  // healthy margin to avoid an empty feed when a user has lots of unrelated
  // chain activity (NFT mints, random transfers, etc).
  const fetchLimit = Math.max(limit * 4, 50);
  let raw: RawTx[];
  try {
    const [from, to] = await Promise.all([
      (
        c as unknown as {
          queryTransactionBlocks: (a: unknown) => Promise<Resp>;
        }
      ).queryTransactionBlocks({
        filter: { FromAddress: address },
        options,
        limit: fetchLimit,
        order: "descending",
      }),
      (
        c as unknown as {
          queryTransactionBlocks: (a: unknown) => Promise<Resp>;
        }
      ).queryTransactionBlocks({
        filter: { ToAddress: address },
        options,
        limit: fetchLimit,
        order: "descending",
      }),
    ]);
    raw = [...(from.data ?? []), ...(to.data ?? [])];
  } catch {
    return [];
  }

  // Resolve the talise registry id once. If this throws (e.g. payment-kit
  // not initialized in this environment) we either show a fully-open feed
  // (mobile, opts.includeNonTalise=true) or degrade to empty (curated web).
  let registryId: string | null = null;
  let namespaceId: string | null = null;
  try {
    registryId = globalRegistryId();
    namespaceId = namespaceObjectId();
  } catch {
    if (!opts.includeNonTalise) return [];
  }

  // Dedupe by digest. A tx can appear in both filters (e.g. a self-send).
  const byDigest = new Map<string, RawTx>();
  for (const tx of raw) {
    if (tx.digest && !byDigest.has(tx.digest)) byDigest.set(tx.digest, tx);
  }

  const entries: ActivityEntry[] = [];
  for (const tx of byDigest.values()) {
    if (tx.effects?.status?.status !== "success") continue;
    // Web (default): only surface txs that flowed through Talise's
    // payment-kit registry — keeps the curated feed clean.
    // Mobile (includeNonTalise=true): surface every successful USDsui
    // / SUI movement the address was involved in, so the user sees
    // their funding txs and direct transfers from outside Talise.
    if (!opts.includeNonTalise) {
      if (!registryId || !namespaceId) continue;
      if (!isTaliseTransaction(tx, registryId, namespaceId)) continue;
    }
    const { myUsdsui, mySui, counterparty } = summarize(tx, address);
    // Ignore txs where the user's net movement is essentially zero (e.g.
    // sponsorship-only events, dust). Don't clutter the feed with noise.
    if (Math.abs(myUsdsui) < 0.0001 && Math.abs(mySui) < 0.0001) continue;

    // --- Classification ------------------------------------------------
    // A. Authoritative — the on-chain PaymentRecord memo(s), if any.
    //    Compound case detected here: a tx with both a `send` PK
    //    record AND an `invest` PK record is the round-up flow — we
    //    surface it as a single "Sent + saved" row with the send
    //    amount as primary + the invest amount as `roundupUsdsui`.
    // B. Heuristic — venue package sniff (covers pre-PK history).
    // C. Plain — direction from balance-change sign.
    let direction: ActivityEntry["direction"];
    let venue: string | null = null;
    let cpForRow: string | null = counterparty;
    // Compound state — when set, the row carries both amounts.
    let compoundSendUsdsui: number | null = null;
    let compoundRoundupUsdsui: number | null = null;

    const allMemos = registryId
      ? parseAllTalisePaymentRecords(tx, registryId)
      : [];
    const sendMemo = allMemos.find((m) => m.kind === "send");
    const investMemo = allMemos.find((m) => m.kind === "invest");

    if (sendMemo && investMemo) {
      // COMPOUND spend+save. Use the send memo for direction (the
      // user thinks of the action as "I sent money to jude"). The
      // invest leg is surfaced as the round-up sub-amount.
      direction = "sent";
      venue = null;
      cpForRow = counterparty;
      compoundSendUsdsui = sendMemo.amountUsdsui;
      compoundRoundupUsdsui = investMemo.amountUsdsui;
    } else if (allMemos.length > 0) {
      // Single PK record — existing path.
      const memo = allMemos[0];
      const m = memoToClassification(memo, myUsdsui, mySui);
      direction = m.direction;
      venue = m.venue;
      if (direction === "invest" || direction === "withdraw") {
        cpForRow = null;
      }
    } else {
      // B. heuristic — match VENUE_PACKAGES against the MoveCalls.
      const venueClass = classifyVenue(tx);
      if (venueClass) {
        direction = venueClass.kind;
        venue = venueClass.venue;
        cpForRow = null;
      } else {
        // C. plain transfer.
        direction = myUsdsui < 0 || mySui < 0 ? "sent" : "received";
      }
    }

    // For the compound case, override the amount with the send-leg
    // value rather than the user's total USDsui delta (which sums
    // send + roundup). The row needs to show "Sent ₦50" not "Sent ₦52".
    let entryAmountUsdsui: number | null;
    if (compoundSendUsdsui !== null) {
      entryAmountUsdsui = compoundSendUsdsui;
    } else {
      entryAmountUsdsui = myUsdsui === 0 ? null : Math.abs(myUsdsui);
    }

    entries.push({
      digest: tx.digest!,
      timestampMs: Number(tx.timestampMs ?? 0),
      direction,
      amountUsdsui: entryAmountUsdsui,
      amountSui: mySui === 0 ? null : Math.abs(mySui),
      counterparty: cpForRow,
      counterpartyName: null,
      venue,
      roundupUsdsui: compoundRoundupUsdsui,
    });
  }

  // Sort newest first, slice to limit.
  entries.sort((a, b) => b.timestampMs - a.timestampMs);
  const limited = entries.slice(0, limit);

  // Reverse-resolve unique counterparties to talise handles. One RPC per
  // unique address; cache within this render so we don't hit the same
  // address twice.
  const uniqueCounterparties = Array.from(
    new Set(limited.map((e) => e.counterparty).filter((x): x is string => !!x))
  );
  const nameCache = new Map<string, string | null>();
  await Promise.all(
    uniqueCounterparties.map(async (addr) => {
      const sub = await findTaliseSubnameForOwner(addr);
      nameCache.set(addr, sub ? formatHandle(sub.username) : null);
    })
  );
  for (const e of limited) {
    if (e.counterparty) e.counterpartyName = nameCache.get(e.counterparty) ?? null;
  }

  return limited;
}
