import "server-only";

import { USDSUI_TYPE } from "./usdsui";
import { findTaliseSubnameForOwner } from "./suins-lookup";
import { formatHandle } from "./handle";
import { globalRegistryId, namespaceObjectId } from "./payment-kit";
import { parsePaymentKitNonce, type ParsedTaliseMemo } from "./intents/wrap-payment-kit";
import { batchCoinMetadata, suiGraphQL } from "./sui-graphql";
import { vaultPackageIds, VaultNotDeployedError } from "./vault";

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
  direction: "sent" | "received" | "invest" | "withdraw" | "swap" | "autoswap";
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
  /**
   * Non-USDsui / non-SUI coin movement. Populated when the user
   * sent or received a coin we don't already represent via
   * `amountUsdsui` / `amountSui` (e.g. WAL, USDC, USDT, random
   * meme coin). `amount` is the raw u64 value as a string so very
   * large numbers survive without precision loss; iOS formats it
   * with `decimals` for display.
   */
  otherCoin: {
    coinType: string;
    symbol: string;
    amount: string;
    decimals: number;
  } | null;
};

/**
 * Per-process coin-info cache. CoinMetadata reads used to cost one RPC
 * round-trip per type; we now batch them via Sui GraphQL (one POST returns
 * every requested type via aliases). The cache still lives at module scope
 * so repeated refreshes of the activity feed avoid re-fetching even the
 * GraphQL batch.
 */
const coinInfoCache = new Map<string, { symbol: string; decimals: number }>();

/**
 * Resolve metadata for a set of coin types in one GraphQL hit, populating
 * the per-process cache. Already-cached types are skipped before the
 * network call — for steady-state refreshes this becomes a no-op.
 *
 * Falls back to a type-string symbol + 9 decimals on any error, matching
 * the legacy per-call behaviour.
 */
async function primeCoinInfo(coinTypes: string[]): Promise<void> {
  const missing = Array.from(
    new Set(coinTypes.filter((t) => t && !coinInfoCache.has(t)))
  );
  if (missing.length === 0) return;
  const batch = await batchCoinMetadata(missing);
  for (const t of missing) {
    const m = batch.get(t);
    coinInfoCache.set(
      t,
      m ?? { symbol: coinSymbolFromType(t), decimals: 9 }
    );
  }
}

function lookupCoinInfo(coinType: string): { symbol: string; decimals: number } {
  return (
    coinInfoCache.get(coinType) ?? {
      symbol: coinSymbolFromType(coinType),
      decimals: 9,
    }
  );
}

/** Last `::Name` segment of a Move type, uppercased. `WAL`, `USDC`. */
function coinSymbolFromType(coinType: string): string {
  const parts = coinType.split("::");
  const last = parts[parts.length - 1] || "COIN";
  return last.toUpperCase().slice(0, 12);
}

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

/**
 * Single GraphQL query that fetches the user's recent tx history
 * (both sent + received in ONE call, via `affectedAddress`).
 *
 * Pre-migration this site issued TWO `suix_queryTransactionBlocks`
 * calls in parallel (FromAddress + ToAddress) and unioned the results,
 * then merged in two more `suix_queryEvents` walks for vault deposits
 * / auto-swaps. GraphQL collapses the tx history into ONE round-trip;
 * the event walks each become ONE GraphQL paged loop instead of N
 * cursor-paged JSON-RPC calls.
 *
 * Field selection notes:
 *   - `effects.balanceChangesJson` and `transactionJson` return the
 *     same shape JSON-RPC emitted (balanceChanges[] and
 *     transaction.data.transaction.{inputs,transactions}), which lets
 *     the downstream classifier consume the result unchanged once we
 *     bolt the pieces back together into a `RawTx`.
 *   - `effects.objectChanges.nodes[].outputState.owner` is read as the
 *     `Owner` union — we project ObjectOwner / AddressOwner / Shared
 *     and an `objectType` via `asMoveObject.contents.type.repr`.
 */
const TX_HISTORY_QUERY = /* GraphQL */ `
  query ActivityHistory(
    $addr: SuiAddress!
    $first: Int!
    $after: String
  ) {
    transactionBlocks(
      filter: { affectedAddress: $addr }
      first: $first
      after: $after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        digest
        transactionJson
        effects {
          status
          timestamp
          balanceChangesJson
          objectChanges(first: 50) {
            nodes {
              idCreated
              idDeleted
              outputState {
                address
                owner {
                  __typename
                  ... on AddressOwner {
                    address {
                      address
                    }
                  }
                  ... on ObjectOwner {
                    address {
                      address
                    }
                  }
                }
                asMoveObject {
                  contents {
                    type {
                      repr
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type GraphQLActivityNode = {
  digest: string;
  transactionJson: unknown | null;
  effects: {
    status: string | null;
    timestamp: string | null;
    balanceChangesJson: unknown | null;
    objectChanges: {
      nodes: Array<{
        idCreated: boolean | null;
        idDeleted: boolean | null;
        outputState: {
          address: string;
          owner:
            | { __typename: "AddressOwner"; address: { address: string } | null }
            | { __typename: "ObjectOwner"; address: { address: string } | null }
            | { __typename: string }
            | null;
          asMoveObject: {
            contents: { type: { repr: string } | null } | null;
          } | null;
        } | null;
      }>;
    } | null;
  } | null;
};

type GraphQLActivityResponse = {
  transactionBlocks: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<GraphQLActivityNode>;
  } | null;
};

/**
 * One GraphQL query for paginated event history, used by the vault-
 * event walk to pull `VaultDeposit` and `VaultAutoSwap` rows.
 *
 * The Sui GraphQL filter `eventType` accepts a full
 * `0x<pkg>::module::Event` string and matches exactly — same precision
 * as JSON-RPC's `MoveEventType` filter, with one round-trip per page.
 */
const EVENTS_BY_TYPE_QUERY = /* GraphQL */ `
  query EventsByType(
    $eventType: String!
    $first: Int!
    $after: String
  ) {
    events(
      filter: { eventType: $eventType }
      first: $first
      after: $after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        timestamp
        contents {
          json
        }
        transaction {
          digest
        }
      }
    }
  }
`;

type GraphQLEventsResponse<P> = {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      timestamp: string | null;
      contents: { json: P | null } | null;
      transaction: { digest: string } | null;
    }>;
  } | null;
};

/**
 * Adapt a single `transactionBlocks` node into the legacy `RawTx` shape
 * the classifier downstream already understands. We deliberately keep
 * the existing `RawTx` contract so the (long, well-tested) classifier
 * code doesn't need to be ported — we just rebuild the input it
 * expects.
 *
 * Two notable mappings:
 *   - `effects.status` is the GraphQL enum (`"SUCCESS"`/`"FAILURE"`)
 *     vs JSON-RPC's lowercase `"success"`. Normalize back to the
 *     lowercase form the classifier compares against.
 *   - `effects.timestamp` is RFC3339; convert to epoch-ms string to
 *     match the legacy `timestampMs` shape.
 */
function adaptGraphQLNodeToRawTx(node: GraphQLActivityNode): RawTx {
  const txJson = (node.transactionJson ?? {}) as Record<string, unknown>;
  const balanceChangesJson = (node.effects?.balanceChangesJson ??
    []) as RawTx["balanceChanges"];

  const statusRaw = (node.effects?.status ?? "").toString().toLowerCase();
  const ts = node.effects?.timestamp ? Date.parse(node.effects.timestamp) : 0;
  const tsMs = Number.isFinite(ts) ? ts : 0;

  // Project objectChanges into the JSON-RPC-style shape:
  //   { objectType, objectId, owner: { AddressOwner | ObjectOwner } }
  const objectChanges: RawObjectChange[] = [];
  for (const oc of node.effects?.objectChanges?.nodes ?? []) {
    const out = oc.outputState;
    if (!out) continue;
    const objectId = out.address;
    const objectType = out.asMoveObject?.contents?.type?.repr ?? undefined;
    let owner: RawObjectChange["owner"] = undefined;
    if (out.owner && typeof out.owner === "object") {
      if (out.owner.__typename === "AddressOwner") {
        const a = (out.owner as { address: { address: string } | null }).address
          ?.address;
        if (a) owner = { AddressOwner: a };
      } else if (out.owner.__typename === "ObjectOwner") {
        const a = (out.owner as { address: { address: string } | null }).address
          ?.address;
        if (a) owner = { ObjectOwner: a };
      } else if (out.owner.__typename === "Shared") {
        owner = { Shared: {} };
      }
    }
    objectChanges.push({
      type: oc.idCreated ? "created" : oc.idDeleted ? "deleted" : "mutated",
      objectId,
      objectType,
      owner,
    });
  }

  // `transactionJson` comes back as the Sui GraphQL JSON
  // representation. The shape closely tracks JSON-RPC's
  // `transaction.data.transaction.{inputs, transactions}` but is
  // sometimes nested at the top level (no `.data` wrapper). Probe both
  // shapes so we work against either schema revision.
  type TxInner = {
    kind?: string;
    inputs?: RawSuiCallArg[];
    transactions?: RawTransactionInput[];
  };
  const txInner: TxInner =
    (txJson.transaction as TxInner | undefined) ?? (txJson as TxInner);

  return {
    digest: node.digest,
    timestampMs: tsMs ? String(tsMs) : "0",
    effects: { status: { status: statusRaw === "success" ? "success" : statusRaw } },
    balanceChanges: balanceChangesJson,
    objectChanges,
    transaction: {
      data: {
        transaction: {
          kind: typeof txInner?.kind === "string" ? txInner.kind : undefined,
          inputs: (txInner?.inputs ?? []) as RawSuiCallArg[],
          transactions: (txInner?.transactions ?? []) as RawTransactionInput[],
        },
      },
    },
  };
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
  /** Raw u64 deltas for non-USDsui / non-SUI coins. */
  myOtherRaw: Record<string, bigint>;
  counterparty: string | null;
} {
  const me = myAddress.toLowerCase();
  let myUsdsui = 0;
  let mySui = 0;
  // pick the largest non-self, non-sponsor counterparty by absolute USDsui (then SUI) movement
  const others: Record<string, { usdsui: number; sui: number }> = {};

  // Non-USDsui / non-SUI movements tracked separately so the feed can
  // surface "Received 10 WAL" rows. Keyed by coin type, value is raw
  // u64 string (signed by way of leading '-').
  const myOtherRaw: Record<string, bigint> = {};

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
    } else if (owner === me && b.coinType) {
      // Generic-coin tracking. We don't try to figure out a USD value;
      // iOS gets the raw amount + decimals and formats client-side.
      try {
        myOtherRaw[b.coinType] =
          (myOtherRaw[b.coinType] ?? 0n) + BigInt(b.amount ?? "0");
      } catch {
        /* skip non-numeric amounts — never expected, but defensive */
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

  return { myUsdsui, mySui, myOtherRaw, counterparty };
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
  // Two on-chain shapes both count as a PaymentRecord write:
  //   1. `<pkg>::payment_kit::PaymentRecord<<coinType>>` — the record
  //      object itself, with its USDsui type-arg, when it appears as
  //      a direct object change.
  //   2. `0x2::dynamic_field::Field<<pkg>::payment_kit::PaymentKey<...>,
  //       <pkg>::payment_kit::PaymentRecord>` — the dynamic field
  //      wrapper under the registry; here PaymentRecord appears WITHOUT
  //      its type-arg (the `<` is followed by another type, not USDSUI).
  //
  // The earlier regex `PaymentRecord</` only matched shape (1) — which
  // missed every real Navi supply tx because RPCs surface only the
  // dynamic-field wrapper. Now we accept BOTH shapes: PaymentRecord
  // followed by `<` (with type arg) OR `>` (no type arg, dynamic-field
  // close bracket).
  return /::payment_kit::PaymentRecord[<>]/.test(objectType);
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
 * Walk the `talise::vault::VaultDeposit` and `talise::vault::VaultAutoSwap`
 * event streams (most-recent first) and return the deposits/auto-swaps
 * for `vaultId` as `ActivityEntry` rows.
 *
 * Why this exists: the wallet-side `queryTransactionBlocks` feed only
 * surfaces transactions touching the user's address. Once a user has
 * pointed their @handle at their vault, payments TO the handle land
 * as coins owned by the vault object id (NOT the user's address) —
 * invisible to the wallet feed. Same for the cron-driven auto-swap:
 * the Onara admin signs the tx, the vault id moves, the user is
 * nowhere in the balanceChanges.
 *
 * Event discovery:
 *   • Query each MoveEventType filter (`vault::VaultDeposit`,
 *     `vault::VaultAutoSwap`) descending, page-bounded so a long-lived
 *     package doesn't blow our render budget.
 *   • Filter `parsedJson.vault_id == vaultId` to keep only this user's
 *     events (the package emits these across every user).
 *   • Translate parsedJson into the `ActivityEntry` shape iOS already
 *     understands — `direction: "received"` for deposits, `"autoswap"`
 *     for swaps. HistoryRow already maps both correctly.
 */
async function getVaultEventActivity(
  vaultId: string,
  limit: number,
  packageId: string
): Promise<ActivityEntry[]> {
  type DepositJson = {
    vault_id?: string;
    coin_type?: string | number[];
    amount?: string | number;
    from?: string;
  };
  type AutoSwapJson = {
    vault_id?: string;
    from_type?: string | number[];
    to_type?: string | number[];
    from_amount?: string | number;
    to_amount?: string | number;
    ts_ms?: string | number;
  };

  const vaultNormalized = vaultId.toLowerCase();

  // We scan a bounded recent window — fetching ~limit * 4 events per
  // type matches the wallet-feed over-fetch. The package is shared
  // across every user so the per-vault hit rate is sparse; cap at 100
  // events scanned per type to keep the cron budget intact.
  const FETCH_LIMIT = Math.max(limit * 4, 50);
  const MAX_SCAN = 200;

  /**
   * `vector<u8>` move arg arrives over JSON-RPC as either a UTF-8
   * encoded string or a number[] (the wire format varies between
   * fullnode versions). Decode both to a plain string.
   */
  function decodeBytes(v: string | number[] | undefined): string {
    if (!v) return "";
    if (typeof v === "string") return v;
    try {
      return Buffer.from(v).toString("utf8");
    } catch {
      return "";
    }
  }

  function toBigInt(v: string | number | undefined): bigint {
    if (v === undefined) return 0n;
    try {
      return typeof v === "bigint" ? v : BigInt(v);
    } catch {
      return 0n;
    }
  }

  async function walk<P>(
    moveEventType: string,
    accept: (p: P) => boolean
  ): Promise<Array<{ digest: string; timestampMs: number; parsedJson: P }>> {
    const out: Array<{ digest: string; timestampMs: number; parsedJson: P }> = [];
    let cursor: string | null = null;
    let scanned = 0;
    const c = suiGraphQL();
    while (scanned < MAX_SCAN) {
      const pageLimit = Math.min(FETCH_LIMIT, MAX_SCAN - scanned);
      const res: { data?: GraphQLEventsResponse<P> } = await c.query({
        query: EVENTS_BY_TYPE_QUERY,
        variables: { eventType: moveEventType, first: pageLimit, after: cursor },
      });
      const page = res.data?.events;
      if (!page) break;
      for (const ev of page.nodes ?? []) {
        scanned++;
        const parsed = ev.contents?.json;
        if (!parsed) continue;
        if (!accept(parsed)) continue;
        const digest = ev.transaction?.digest;
        if (!digest) continue;
        const tsMs = ev.timestamp ? Date.parse(ev.timestamp) : 0;
        out.push({
          digest,
          timestampMs: Number.isFinite(tsMs) ? tsMs : 0,
          parsedJson: parsed,
        });
      }
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
      cursor = page.pageInfo.endCursor;
    }
    return out;
  }

  let deposits: Array<{
    digest: string;
    timestampMs: number;
    parsedJson: DepositJson;
  }> = [];
  let autoSwaps: Array<{
    digest: string;
    timestampMs: number;
    parsedJson: AutoSwapJson;
  }> = [];
  try {
    [deposits, autoSwaps] = await Promise.all([
      walk<DepositJson>(`${packageId}::vault::VaultDeposit`, (p) =>
        (p.vault_id ?? "").toLowerCase() === vaultNormalized
      ),
      walk<AutoSwapJson>(`${packageId}::vault::VaultAutoSwap`, (p) =>
        (p.vault_id ?? "").toLowerCase() === vaultNormalized
      ),
    ]);
  } catch {
    return [];
  }

  // Resolve coin metadata for every non-USDsui/non-SUI coin that any
  // event references, in one GraphQL hit (`primeCoinInfo`'s cache is
  // shared with the wallet pass downstream).
  const otherTypes = new Set<string>();
  for (const d of deposits) {
    const t = decodeBytes(d.parsedJson.coin_type);
    if (t && t !== USDSUI_TYPE && t !== "0x2::sui::SUI") otherTypes.add(t);
  }
  for (const s of autoSwaps) {
    const f = decodeBytes(s.parsedJson.from_type);
    const to = decodeBytes(s.parsedJson.to_type);
    for (const t of [f, to]) {
      if (t && t !== USDSUI_TYPE && t !== "0x2::sui::SUI") otherTypes.add(t);
    }
  }
  if (otherTypes.size > 0) {
    await primeCoinInfo(Array.from(otherTypes));
  }

  const entries: ActivityEntry[] = [];

  for (const d of deposits) {
    const p = d.parsedJson;
    const coinType = decodeBytes(p.coin_type);
    const rawAmount = toBigInt(p.amount);
    if (rawAmount === 0n || !coinType) continue;

    let amountUsdsui: number | null = null;
    let amountSui: number | null = null;
    let otherCoin: ActivityEntry["otherCoin"] = null;
    if (coinType === USDSUI_TYPE) {
      amountUsdsui = Number(rawAmount) / 1e6;
    } else if (coinType === "0x2::sui::SUI") {
      amountSui = Number(rawAmount) / 1e9;
    } else {
      const info = lookupCoinInfo(coinType);
      otherCoin = {
        coinType,
        symbol: info.symbol,
        amount: rawAmount.toString(),
        decimals: info.decimals,
      };
    }

    entries.push({
      digest: d.digest,
      timestampMs: d.timestampMs,
      direction: "received",
      amountUsdsui,
      amountSui,
      counterparty: p.from ?? null,
      counterpartyName: null,
      // `venue: "@handle"` is a marker that the row is a vault-side
      // inbound transfer — HistoryRow already special-cases this so
      // the title reads "Received via @handle" instead of "Received".
      venue: "@handle",
      roundupUsdsui: null,
      otherCoin,
    });
  }

  for (const s of autoSwaps) {
    const p = s.parsedJson;
    const fromType = decodeBytes(p.from_type);
    const toType = decodeBytes(p.to_type);
    const fromAmount = toBigInt(p.from_amount);
    const toAmount = toBigInt(p.to_amount);
    if (fromAmount === 0n && toAmount === 0n) continue;

    // Compose the row so HistoryRow's "Swapped X → Y" path picks up
    // both legs. The source side fills `amountSui` (when it's SUI)
    // or `otherCoin` (anything else); the destination fills
    // `amountUsdsui` when the swap landed in USDsui, else `otherCoin`
    // — but the auto_swap path only ever produces USDsui today so
    // the common case is `(SUI|other) → USDsui`.
    let amountUsdsui: number | null = null;
    let amountSui: number | null = null;
    let otherCoin: ActivityEntry["otherCoin"] = null;
    let venue: string | null = null;

    if (fromType === "0x2::sui::SUI") {
      amountSui = Number(fromAmount) / 1e9;
    } else if (fromType && fromType !== USDSUI_TYPE) {
      const info = lookupCoinInfo(fromType);
      otherCoin = {
        coinType: fromType,
        symbol: info.symbol,
        amount: fromAmount.toString(),
        decimals: info.decimals,
      };
      // `venue` is the source coin symbol — HistoryRow renders
      // "Auto-swapped <SYMBOL>" when both legs aren't separately
      // formatted (rare, but the fallback exists in the iOS code).
      venue = info.symbol;
    } else if (fromType === USDSUI_TYPE) {
      // Reverse swap (USDsui → SUI / other) — populate the USDsui
      // leg with the FROM amount so the composer renders correctly.
      amountUsdsui = Number(fromAmount) / 1e6;
    }

    if (toType === USDSUI_TYPE) {
      // Common case: USDsui is the destination. Overwrite any
      // amountUsdsui set above (the auto_swap module never emits
      // USDsui → USDsui so this branch + the from-USDsui branch
      // are mutually exclusive in practice).
      amountUsdsui = Number(toAmount) / 1e6;
    } else if (toType === "0x2::sui::SUI" && amountSui === null) {
      amountSui = Number(toAmount) / 1e9;
    } else if (toType && toType !== USDSUI_TYPE && otherCoin === null) {
      const info = lookupCoinInfo(toType);
      otherCoin = {
        coinType: toType,
        symbol: info.symbol,
        amount: toAmount.toString(),
        decimals: info.decimals,
      };
    }

    entries.push({
      digest: s.digest,
      timestampMs: s.timestampMs,
      direction: "autoswap",
      amountUsdsui,
      amountSui,
      counterparty: null,
      counterpartyName: null,
      venue,
      roundupUsdsui: null,
      otherCoin,
    });
  }

  return entries;
}

/**
 * `includeNonTalise: true` shows every successful USDsui / SUI movement
 * the address has been involved in, regardless of whether the tx flowed
 * through Talise's payment-kit registry. Used by the iOS /api/activity
 * feed (users want to see "money I received" — they don't care about
 * which kit was used). The web feeds keep the curated default so the
 * Talise UI stays branded.
 *
 * `vaultId` opt: when set, we additionally walk the
 * `talise::vault::VaultDeposit` + `VaultAutoSwap` event streams for that
 * vault and merge the resulting rows into the wallet-side feed. Without
 * it, vault-side activity (auto-swap conversions, inbound payments to
 * @handle that land directly on the vault) would be invisible — the
 * wallet's tx history only sees txs touching the user's address.
 */
export async function getRecentActivity(
  address: string,
  limit = 12,
  opts: { includeNonTalise?: boolean; vaultId?: string | null } = {}
): Promise<ActivityEntry[]> {
  // We filter out non-Talise transactions client-side, so over-fetch by a
  // healthy margin to avoid an empty feed when a user has lots of unrelated
  // chain activity (NFT mints, random transfers, etc).
  const fetchLimit = Math.max(limit * 4, 50);
  let raw: RawTx[];
  try {
    // Pre-migration this site issued TWO `suix_queryTransactionBlocks`
    // calls in parallel (FromAddress + ToAddress) and unioned the
    // results client-side. Sui GraphQL's `affectedAddress` filter
    // returns BOTH sides in a single query — half the round-trips,
    // same coverage. The downstream classifier still consumes the
    // legacy `RawTx` shape; `adaptGraphQLNodeToRawTx` rebuilds it from
    // the `transactionJson` + `balanceChangesJson` + `objectChanges`
    // pieces.
    const res: { data?: GraphQLActivityResponse } = await suiGraphQL().query({
      query: TX_HISTORY_QUERY,
      variables: { addr: address, first: fetchLimit, after: null },
    });
    const nodes = res.data?.transactionBlocks?.nodes ?? [];
    raw = nodes.map(adaptGraphQLNodeToRawTx);
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

  // Pre-pass: collect every non-USDsui/non-SUI coin type that any candidate
  // tx moved on the user's address, then issue ONE GraphQL batch lookup for
  // their CoinMetadata. The main classification loop downstream then reads
  // from `coinInfoCache` synchronously via `lookupCoinInfo`. Collapses N
  // per-coin `suix_getCoinMetadata` RPCs into one round-trip.
  {
    const allOtherCoinTypes = new Set<string>();
    for (const tx of byDigest.values()) {
      if (tx.effects?.status?.status !== "success") continue;
      for (const b of tx.balanceChanges ?? []) {
        if (!b.coinType) continue;
        if (b.coinType === USDSUI_TYPE) continue;
        if (b.coinType === "0x2::sui::SUI") continue;
        const owner = (ownerOf(b) ?? "").toLowerCase();
        if (owner !== address.toLowerCase()) continue;
        allOtherCoinTypes.add(b.coinType);
      }
    }
    if (allOtherCoinTypes.size > 0) {
      await primeCoinInfo(Array.from(allOtherCoinTypes));
    }
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
    const { myUsdsui, mySui, myOtherRaw, counterparty } = summarize(tx, address);

    // Pick the dominant non-USDsui/non-SUI movement, if any. We pick the
    // single biggest by absolute raw value rather than emit one row per
    // coin type — multi-coin txs are dominated by one principal
    // transfer and a long tail of dust, so showing the big one keeps
    // the feed readable.
    const otherEntries = Object.entries(myOtherRaw).filter(
      ([, v]) => v !== 0n
    );
    otherEntries.sort((a, b) => {
      const aabs = a[1] < 0n ? -a[1] : a[1];
      const babs = b[1] < 0n ? -b[1] : b[1];
      return aabs < babs ? 1 : aabs > babs ? -1 : 0;
    });
    const dominantOther = otherEntries[0] ?? null;

    // Ignore txs where there is NO meaningful movement of any tracked
    // coin (sponsorship-only events, pure object reads, etc.).
    if (
      Math.abs(myUsdsui) < 0.0001 &&
      Math.abs(mySui) < 0.0001 &&
      !dominantOther
    ) {
      continue;
    }

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
        // C. plain transfer (or swap). Detect swap first: when the
        // tx moves two different coins for the user in OPPOSITE
        // directions, it's almost certainly a DEX swap — the
        // legacy Convert-banner sweep, a direct Cetus call, the
        // vault's auto-swap PTB, etc. We surface this as a single
        // "swap" row with BOTH amounts visible instead of
        // mis-labeling it "Sent ₦X" using whichever leg's USD
        // value happens to be larger.
        //
        // Detection rules (any one triggers swap):
        //   • USDsui ↑ AND SUI ↓ in same tx, or vice versa
        //   • USDsui ↑ AND a non-USDsui non-SUI coin ↓ (or vice versa)
        //   • SUI ↑ AND a non-SUI non-USDsui coin ↓ (or vice versa)
        const hasOppositeUsdsuiSui =
          (myUsdsui > 0 && mySui < 0) ||
          (myUsdsui < 0 && mySui > 0);
        const hasOppositeUsdsuiOther =
          dominantOther !== null &&
          ((myUsdsui > 0 && dominantOther[1] < 0n) ||
            (myUsdsui < 0 && dominantOther[1] > 0n));
        const hasOppositeSuiOther =
          dominantOther !== null &&
          ((mySui > 0 && dominantOther[1] < 0n) ||
            (mySui < 0 && dominantOther[1] > 0n));
        if (
          hasOppositeUsdsuiSui ||
          hasOppositeUsdsuiOther ||
          hasOppositeSuiOther
        ) {
          direction = "swap";
          cpForRow = null;
        } else if (myUsdsui !== 0 || mySui !== 0) {
          direction = myUsdsui < 0 || mySui < 0 ? "sent" : "received";
        } else if (dominantOther) {
          direction = dominantOther[1] < 0n ? "sent" : "received";
        } else {
          direction = "received";
        }
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

    // Build the otherCoin payload — only when (a) we tracked a non-
    // zero non-USDsui/non-SUI movement AND (b) USDsui/SUI didn't
    // already cover this row. Resolves coin metadata for the symbol +
    // decimals; falls back to last-segment-of-type if the chain has
    // no metadata registered for the coin.
    let otherCoin: ActivityEntry["otherCoin"] = null;
    if (dominantOther && entryAmountUsdsui === null && mySui === 0) {
      const [coinType, rawDelta] = dominantOther;
      const info = lookupCoinInfo(coinType);
      const absDelta = rawDelta < 0n ? -rawDelta : rawDelta;
      otherCoin = {
        coinType,
        symbol: info.symbol,
        amount: absDelta.toString(),
        decimals: info.decimals,
      };
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
      otherCoin,
    });
  }

  // Merge in vault-side events (deposits to the vault + auto-swap
  // conversions). These are emitted by the `talise::vault` Move module
  // and never appear in the user's wallet tx history — without this
  // pass the user can't see "money I received via @handle" nor the
  // cron-driven SUI→USDsui auto-swap.
  if (opts.vaultId) {
    try {
      const { packageId } = vaultPackageIds();
      const vaultEntries = await getVaultEventActivity(
        opts.vaultId,
        limit,
        packageId
      );
      for (const ve of vaultEntries) entries.push(ve);
    } catch (err) {
      if (!(err instanceof VaultNotDeployedError)) {
        // Soft-fail: vault module deployed but the event walk hiccuped.
        // Keep the wallet-side rows rather than failing the whole feed.
        console.warn(
          `[activity] vault-event walk failed: ${(err as Error).message}`
        );
      }
    }
  }

  // Sort newest first, then dedupe by digest. A single auto-swap tx
  // emits the `VaultAutoSwap` event AND moves coins on chain — if the
  // user's address is anywhere in the balanceChanges (e.g. fee rebate)
  // the same digest could appear on both the wallet-side and
  // vault-side pass. Vault rows win because their direction
  // ("autoswap"/"received via @handle") is more specific than the
  // generic wallet classification.
  entries.sort((a, b) => b.timestampMs - a.timestampMs);
  const seenDigests = new Set<string>();
  const merged: ActivityEntry[] = [];
  // Two-pass dedupe so a vault entry seen LATER in the sorted list (e.g.
  // identical timestampMs but stable sort kept the wallet row first)
  // still wins. Vault rows have direction "autoswap" or venue "@handle",
  // wallet duplicates of the same digest will not — so when we see a
  // duplicate digest, prefer the vault-flavored one.
  const vaultishFlavor = (e: ActivityEntry): boolean =>
    e.direction === "autoswap" || e.venue === "@handle";
  const byDigestPick = new Map<string, ActivityEntry>();
  for (const e of entries) {
    const prev = byDigestPick.get(e.digest);
    if (!prev) {
      byDigestPick.set(e.digest, e);
    } else if (vaultishFlavor(e) && !vaultishFlavor(prev)) {
      byDigestPick.set(e.digest, e);
    }
  }
  for (const e of entries) {
    if (seenDigests.has(e.digest)) continue;
    const winner = byDigestPick.get(e.digest);
    if (!winner) continue;
    seenDigests.add(e.digest);
    merged.push(winner);
  }
  const limited = merged.slice(0, limit);

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
