/**
 * WaterX perpetuals integration (Sui mainnet).
 *
 * WaterX (https://github.com/WaterXProtocol) is a perps + prediction-markets
 * protocol on Sui. This module wraps `@waterx/sdk` for server-side reads and
 * transaction building, reusing Talise's own gRPC endpoint.
 *
 * Two settlement rails:
 *   - Sponsored (default): builders return a `Transaction`, we set the Onara
 *     sponsor + let the app sign with zkLogin. Same rail as profile/streams.
 *   - Local dev signer (prototype): when FEATURE_PERPS_LOCAL_SIGN=true and
 *     WATERX_DEV_PRIVATE_KEY is set, we sign + execute server-side so the whole
 *     create -> deposit -> trade loop runs on localhost with a funded key.
 *
 * Collateral is USDsui: WaterX native custody registers Talise's exact coin
 * type (verified against mainnet config — `usdsui::USDSUI`, 6 decimals).
 *
 * Gated behind FEATURE_PERPS — off by default.
 */
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64 } from "@mysten/sui/utils";
import {
  PerpClient,
  getMarketData,
  getSpendableCreditBalance,
  getAccountPositions,
  getPosition,
  buildPlaceOrderTx,
  buildClosePositionTx,
  rawPrice,
} from "@waterx/sdk/perp";
import {
  createAccount,
  mintCreditToAccount,
  routeNative,
  requestCreditWithdraw,
  enqueueWithdrawal,
} from "@waterx/sdk/account";
import { USDSUI_TYPE } from "./usdsui";
import { sui } from "./sui";
import { onara } from "./onara";
import { memoTtl } from "./perf-cache";
import { db } from "./db";
import { cachedSpotFor } from "./perp-cache";

const WATERX_CONFIG_URL =
  process.env.WATERX_CONFIG_URL ??
  "https://raw.githubusercontent.com/WaterXProtocol/waterx-config/main/mainnet.json";

/** Feature flag — perps are experimental and OFF unless set to "true". */
export const WATERX_ENABLED = process.env.FEATURE_PERPS === "true";
/** Local prototype: sign + execute server-side with a dev key instead of sponsoring. */
export const WATERX_LOCAL_SIGN = process.env.FEATURE_PERPS_LOCAL_SIGN === "true";

/** USDsui — the collateral asset WaterX native custody accepts (6 decimals). */
export const COLLATERAL_TYPE = USDSUI_TYPE;
const USDSUI_DECIMALS = 6;
const usdToBase = (usd: number) => BigInt(Math.round(usd * 10 ** USDSUI_DECIMALS));

// Talise closing fee: 2% of the closed position's collateral, taken in USDsui
// from the user's wallet → treasury, atomically in the close PTB.
const CLOSE_FEE_BPS = Number(process.env.PERP_CLOSE_FEE_BPS) || 200; // 2%
const TREASURY_WALLET =
  process.env.TALISE_TREASURY_WALLET?.trim() ||
  "0xc0bf1c51e44f8cfa4a06f16a2408effa3507ac4582744c7ead56078b5e251a48";

async function usdsuiWalletBalance(owner: string): Promise<bigint> {
  const rpc = process.env.SUI_JSONRPC_URL ?? "https://fullnode.mainnet.sui.io:443";
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getBalance", params: [owner, COLLATERAL_TYPE] }),
    });
    const j = (await r.json()) as { result?: { totalBalance?: string } };
    return BigInt(j?.result?.totalBalance ?? "0");
  } catch {
    return 0n;
  }
}

// waterx_account object type prefixes (from mainnet config) — used to spot the
// freshly created Account in a tx's object changes.
const WXA_PKG_IDS = [
  "0xe308bd40bd81aa42b9245e4b51b3fe63801c77c78a76be4ce5902aae549f7221",
  "0x6cb6f3be75d37cd2b7db0e9fdac11b72ff0669765382cc9e00441d178b58bdbe",
];

// Memoized mainnet client (config fetch + gRPC transport reused per process).
let _perp: Promise<PerpClient> | null = null;
export function perp(): Promise<PerpClient> {
  if (!_perp) {
    const grpcUrl = process.env.SUI_GRPC_URL ?? "https://fullnode.mainnet.sui.io:443";
    _perp = PerpClient.mainnet({ grpcUrl, waterxConfigUrl: WATERX_CONFIG_URL, cache: true }).catch(
      (e) => {
        _perp = null;
        throw e;
      },
    );
  }
  return _perp;
}

let _signer: Ed25519Keypair | null | undefined;
/** Local dev signer from WATERX_DEV_PRIVATE_KEY (`suiprivkey1…`), or null. */
export function localSigner(): Ed25519Keypair | null {
  if (_signer !== undefined) return _signer;
  const k = process.env.WATERX_DEV_PRIVATE_KEY?.trim();
  try {
    _signer = k ? Ed25519Keypair.fromSecretKey(k) : null;
  } catch {
    _signer = null;
  }
  return _signer;
}

// ── Reads ────────────────────────────────────────────────────────────────────
import { WATERX_TICKERS, assetMeta, type AssetCategory } from "./waterx-assets";
export { WATERX_TICKERS };
const PRICE_SCALE = 1e9;
const BPS = 1e4;

export type MarketSnapshot = {
  symbol: string;
  name: string;
  sym: string;
  category: AssetCategory;
  marketId: string;
  paused: boolean;
  refPriceUsd: number;
  maxLeverage: number;
  // Open interest + size limits, in token units (1e9-scaled on-chain → tokens).
  longOiTokens: number;
  shortOiTokens: number;
  maxLongSize: number;
  maxShortSize: number;
  availLongSize: number;
  availShortSize: number;
  // Risk params
  minCollUsd: number;
  maintenanceMarginPct: number;
  fundingRatePct: number; // per interval, %
  fundingIntervalHrs: number;
  tradingFeeBps: number;
};

const emptyMarket = (symbol: string): MarketSnapshot => ({
  symbol, name: assetMeta(symbol).name, sym: assetMeta(symbol).sym, category: assetMeta(symbol).cat,
  marketId: "", paused: true, refPriceUsd: 0, maxLeverage: 0,
  longOiTokens: 0, shortOiTokens: 0, maxLongSize: 0, maxShortSize: 0,
  availLongSize: 0, availShortSize: 0, minCollUsd: 0, maintenanceMarginPct: 0,
  fundingRatePct: 0, fundingIntervalHrs: 0, tradingFeeBps: 0,
});

export async function listMarkets(
  tickers: readonly string[] = WATERX_TICKERS,
): Promise<MarketSnapshot[]> {
  const client = await perp();
  return Promise.all(tickers.map((t) => getMarket(client, t)));
}

export async function getMarketOne(ticker: string): Promise<MarketSnapshot> {
  return getMarket(await perp(), ticker);
}

async function getMarket(client: PerpClient, symbol: string): Promise<MarketSnapshot> {
  try {
    const m = await getMarketData(client, { ticker: symbol });
    const longOi = Number(m.long_oi) / PRICE_SCALE;
    const shortOi = Number(m.short_oi) / PRICE_SCALE;
    const maxLong = Number(m.max_long_oi) / PRICE_SCALE;
    const maxShort = Number(m.max_short_oi) / PRICE_SCALE;
    const meta = assetMeta(symbol);
    return {
      symbol,
      name: meta.name,
      sym: meta.sym,
      category: meta.cat,
      marketId: m.market_id,
      paused: Boolean(m.is_paused),
      refPriceUsd: Number(m.long_avg_entry_price) / PRICE_SCALE,
      maxLeverage: Number(m.max_leverage_bps) / BPS,
      longOiTokens: longOi,
      shortOiTokens: shortOi,
      maxLongSize: maxLong,
      maxShortSize: maxShort,
      availLongSize: Math.max(0, maxLong - longOi),
      availShortSize: Math.max(0, maxShort - shortOi),
      minCollUsd: Number(m.min_coll_value) / PRICE_SCALE,
      maintenanceMarginPct: (Number(m.maintenance_margin) / PRICE_SCALE) * 100,
      fundingRatePct: (Number(m.basic_funding_rate) / PRICE_SCALE) * 100,
      fundingIntervalHrs: Number(m.funding_interval_ms) / 3_600_000,
      tradingFeeBps: Number(m.trading_fee) / (PRICE_SCALE / BPS),
    };
  } catch {
    return emptyMarket(symbol);
  }
}

// The user's waterx_account is remembered server-side (keyed to the Talise
// user id) so "you already have an account" holds across devices/sessions.
export async function getStoredAccount(userId: number): Promise<string | null> {
  try {
    const r = await db().execute({ sql: "SELECT v_text FROM global_kv WHERE k = ?", args: [`waterx_acct:${userId}`] });
    return ((r.rows[0] as { v_text?: string } | undefined)?.v_text as string) ?? null;
  } catch {
    return null;
  }
}
export async function storeAccount(userId: number, accountId: string): Promise<void> {
  try {
    await db().execute({
      sql: `INSERT INTO global_kv (k, v_text, refreshed_at) VALUES (?, ?, ?)
            ON CONFLICT (k) DO UPDATE SET v_text = EXCLUDED.v_text, refreshed_at = EXCLUDED.refreshed_at`,
      args: [`waterx_acct:${userId}`, accountId, Date.now()],
    });
  } catch {
    /* non-fatal — client keeps a localStorage copy too */
  }
}

// ── Trade history (recorded per user in global_kv) ───────────────────────────
export type TradeLogEntry = {
  ts: number;
  type: "open" | "close" | "deposit" | "withdraw";
  ticker?: string;
  side?: "long" | "short";
  sizeTokens?: number;
  priceUsd?: number;
  collateralUsd?: number;
  pnlUsd?: number;
  feeUsd?: number;
  digest?: string;
};

export async function getTrades(userId: number): Promise<TradeLogEntry[]> {
  try {
    const r = await db().execute({ sql: "SELECT v_text FROM global_kv WHERE k = ?", args: [`waterx_trades:${userId}`] });
    return JSON.parse(((r.rows[0] as { v_text?: string } | undefined)?.v_text as string) ?? "[]");
  } catch {
    return [];
  }
}
export async function addTrade(userId: number, e: TradeLogEntry): Promise<void> {
  try {
    const list = await getTrades(userId);
    list.unshift(e);
    await db().execute({
      sql: `INSERT INTO global_kv (k, v_text, refreshed_at) VALUES (?, ?, ?)
            ON CONFLICT (k) DO UPDATE SET v_text = EXCLUDED.v_text, refreshed_at = EXCLUDED.refreshed_at`,
      args: [`waterx_trades:${userId}`, JSON.stringify(list.slice(0, 100)), Date.now()],
    });
  } catch {
    /* non-fatal */
  }
}

export type PerpPosition = {
  ticker: string;
  positionId: string;
  isLong: boolean;
  sizeTokens: number;
  collateralUsd: number;
  entryPriceUsd: number; // position's average entry
  markPriceUsd: number; // on-chain oracle price at read time
  liqPriceUsd: number;
  leverage: number;
  pnlUsd: number; // contract-computed (fallback); UI recomputes live from mark
  hasTpSl: boolean;
};

/** Available (spendable) collateral in USD + open positions across all markets. */
export async function accountSnapshot(
  accountId: string,
): Promise<{ availableUsd: number; positions: PerpPosition[] }> {
  const client = await perp();
  const [availableUsd, positions] = await Promise.all([
    getSpendableCreditBalance(client, accountId)
      .then((b) => Number(b.totalRaw) / 10 ** USDSUI_DECIMALS)
      .catch(() => 0),
    getPositions(client, accountId).catch(() => [] as PerpPosition[]),
  ]);
  return { availableUsd, positions };
}

async function getPositions(client: PerpClient, accountId: string): Promise<PerpPosition[]> {
  const per = await Promise.all(
    WATERX_TICKERS.map(async (ticker): Promise<PerpPosition[]> => {
      try {
        const m = await getMarketData(client, { ticker });
        const priceUsd = Number(m.long_avg_entry_price) / PRICE_SCALE;
        const rows = await getAccountPositions(client, {
          ticker,
          accountObjectAddress: accountId,
          basePriceUsd: rawPrice(priceUsd),
          collateralPriceUsd: rawPrice(1),
        });
        if (!rows.length) return [];
        // Live mark from our warm price cache — the on-chain oracle_price uses a
        // higher-precision scale and can lag; our Pyth feed is the reliable mark.
        const spot = (await cachedSpotFor(ticker)) ?? priceUsd;
        return rows.map((p) => {
          const q = p as unknown as {
            collateral_decimal?: number; average_price?: string | number;
            linked_order_ids?: unknown[];
          };
          const dec = Number(q.collateral_decimal ?? USDSUI_DECIMALS);
          const isLong = Boolean(p.is_long);
          // average_price is 1e9-scaled USD; size is 1e9-scaled tokens.
          const entry = Number(q.average_price ?? 0) / PRICE_SCALE;
          const sizeTokens = Number(p.size) / PRICE_SCALE;
          const collateralUsd = Number(p.collateral_amount) / 10 ** dec;
          const mark = spot > 0 ? spot : entry;
          // Leverage the user set = entry notional / collateral (stable, not the
          // drifting on-chain leverage_bps which re-marks with price).
          const leverage = collateralUsd > 0 && entry > 0 ? (sizeTokens * entry) / collateralUsd : 0;
          // Unrealized PnL from our live mark (not the stale/odd-scaled chain pnl).
          const pnlUsd = (isLong ? 1 : -1) * sizeTokens * (mark - entry);
          const liqPriceUsd = leverage > 0
            ? (isLong ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage))
            : 0;
          return {
            ticker,
            positionId: String(p.position_id),
            isLong,
            sizeTokens,
            collateralUsd,
            entryPriceUsd: entry,
            markPriceUsd: mark,
            liqPriceUsd,
            leverage,
            pnlUsd,
            hasTpSl: Array.isArray(q.linked_order_ids) && q.linked_order_ids.length > 0,
          };
        });
      } catch {
        return [];
      }
    }),
  );
  return per.flat();
}

// ── Settlement (local execute OR sponsored bytes) ────────────────────────────
export type Settled =
  | { mode: "executed"; digest: string; sender: string }
  | { mode: "sponsored"; bytes: string };

// Onara's sponsor policy caps the gas budget at 100M MIST (0.1 SUI); a tx over
// that "matches no policy" and is refused. Perp/Pyth txs still settle well under
// this — 95M is the ceiling, sponsor pays only actual gas.
const GAS_BUDGET_MIST = 95_000_000n;

export async function settle(tx: Transaction, sender: string): Promise<Settled> {
  const client = await perp();
  const signer = localSigner();
  if (WATERX_LOCAL_SIGN && signer) {
    tx.setSender(signer.toSuiAddress());
    const res = (await client.signAndExecuteTransaction({
      transaction: tx,
      signer,
    })) as { digest?: string; effects?: { transactionDigest?: string } };
    const digest = res.digest ?? res.effects?.transactionDigest ?? "";
    return { mode: "executed", digest, sender: signer.toSuiAddress() };
  }
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) throw new Error("Set FEATURE_PERPS_LOCAL_SIGN + WATERX_DEV_PRIVATE_KEY, or ONARA_URL.");
  const suiClient = sui();
  const [{ address: sponsor }, gasPrice] = await Promise.all([
    memoTtl(`onara:status:${onaraUrl}`, 60_000, () => onara().status()),
    memoTtl(`sui:gas-price:perp`, 1_500, async () => (await suiClient.getReferenceGasPrice()).referenceGasPrice),
  ]);
  tx.setSender(sender);
  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));
  tx.setGasBudget(GAS_BUDGET_MIST);
  const bytes = await tx.build({ client: suiClient as never });
  return { mode: "sponsored", bytes: toBase64(bytes) };
}

/** After a local create-account execution, resolve the new Account object id. */
export async function findCreatedAccountId(digest: string): Promise<string | null> {
  if (!digest) return null;
  const rpc = process.env.SUI_JSONRPC_URL ?? "https://fullnode.mainnet.sui.io:443";
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "sui_getTransactionBlock",
        params: [digest, { showObjectChanges: true }],
      }),
    });
    const j = (await r.json()) as {
      result?: { objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> };
    };
    const created = j.result?.objectChanges ?? [];
    const acct = created.find(
      (c) => c.type === "created" && /::account::Account/.test(c.objectType ?? "") &&
        WXA_PKG_IDS.some((p) => (c.objectType ?? "").startsWith(p)),
    ) ?? created.find((c) => c.type === "created" && /::account::Account/.test(c.objectType ?? ""));
    return acct?.objectId ?? null;
  } catch {
    return null;
  }
}

// ── Builders ─────────────────────────────────────────────────────────────────
export async function buildCreateAccountTx(alias: string): Promise<Transaction> {
  const client = await perp();
  const tx = new Transaction();
  createAccount(client, tx, { alias: alias.slice(0, 32) || "Talise" });
  return tx;
}

export async function buildDepositTx(accountId: string, usd: number): Promise<Transaction> {
  const client = await perp();
  const tx = new Transaction();
  // coinWithBalance auto-selects/merges the user's USDsui coins at build time.
  const assetCoin = tx.add(coinWithBalance({ type: COLLATERAL_TYPE, balance: usdToBase(usd) }));
  mintCreditToAccount(client, tx, { accountId, assetCoin, assetType: COLLATERAL_TYPE });
  return tx;
}

export type OrderInput = {
  ticker: string;
  accountId: string;
  isLong: boolean;
  sizeTokens: number;
  collateralUsd: number;
  acceptablePriceUsd: number;
  /** Optional take-profit / stop-loss trigger prices (USD) → reduce-only stops. */
  tpPriceUsd?: number;
  slPriceUsd?: number;
};

export async function buildOrderTx(o: OrderInput): Promise<Transaction> {
  const client = await perp();
  // TP/SL are reduce-only stop orders in the CLOSING direction (opposite side),
  // sized to the position, that fire when price crosses the trigger.
  const closeSide = !o.isLong;
  const preOrders = [o.tpPriceUsd, o.slPriceUsd]
    .filter((p): p is number => typeof p === "number" && p > 0)
    .map((trigger) => ({
      isLong: closeSide,
      isStopOrder: true,
      reduceOnly: true,
      size: rawPrice(o.sizeTokens),
      triggerPrice: rawPrice(trigger),
      collateralAmount: 0n,
    }));
  return buildPlaceOrderTx(client, {
    ticker: o.ticker.toUpperCase(),
    accountId: o.accountId,
    collateralType: client.creditType(),
    main: {
      isLong: o.isLong,
      isStopOrder: false,
      reduceOnly: false,
      size: rawPrice(o.sizeTokens),
      acceptablePrice: rawPrice(o.acceptablePriceUsd),
      collateralAmount: usdToBase(o.collateralUsd),
    },
    preOrders,
  });
}

/**
 * Withdraw CREDIT back to USDsui: route (native) → request → enqueue. WaterX's
 * keeper drains the queue and delivers USDsui to `recipient` shortly after.
 */
export async function buildWithdrawTx(accountId: string, usd: number, recipient: string): Promise<Transaction> {
  const client = await perp();
  const tx = new Transaction();
  const route = routeNative(client, tx, { assetType: COLLATERAL_TYPE, minOutput: 0 });
  const request = requestCreditWithdraw(client, tx, {
    accountId,
    amount: usdToBase(usd),
    recipient,
    route,
  });
  enqueueWithdrawal(client, tx, { withdrawRequest: request });
  return tx;
}

/**
 * Close a position at market (±3% band) and, atomically, skim a 2% Talise fee
 * on the position's collateral (USDsui, from the user's wallet → treasury).
 * The fee is appended only when the user's wallet can cover it, so a close never
 * fails for lack of the fee. Returns the built tx + the fee actually charged.
 */
export async function buildCloseTx(
  ticker: string,
  accountId: string,
  positionId: string,
  isLong: boolean,
  owner: string,
): Promise<{ tx: Transaction; feeUsd: number }> {
  const client = await perp();
  const T = ticker.toUpperCase();
  const m = await getMarketData(client, { ticker: T });
  const priceUsd = Number(m.long_avg_entry_price) / PRICE_SCALE;

  // Fee = 2% of the position's actual collateral (read on-chain, not client-trusted).
  // Also capture the position's live oracle/mark price for the accept-price band —
  // long_avg_entry_price is a market aggregate, wrong-sided for shorts and stale
  // after moves; the position's own oracle_price is the correct band reference.
  let feeBase = 0n;
  let feeUsd = 0;
  let markUsd = priceUsd; // fallback only if the position can't be read
  try {
    const pos = await getPosition(client, {
      ticker: T,
      positionId: BigInt(positionId),
      basePriceUsd: rawPrice(priceUsd),
      collateralPriceUsd: rawPrice(1),
    });
    const dec = Number((pos as { collateral_decimal?: number }).collateral_decimal ?? USDSUI_DECIMALS);
    feeBase = (BigInt(pos.collateral_amount) * BigInt(CLOSE_FEE_BPS)) / 10_000n;
    feeUsd = Number(feeBase) / 10 ** dec;
    const oracle = Number((pos as { oracle_price?: string | number }).oracle_price ?? 0) / PRICE_SCALE;
    if (oracle > 0) markUsd = oracle;
  } catch {
    /* fee stays 0 if the position can't be read */
  }

  // Close is reduce-only: a long sells (accept down to −3%), a short buys back
  // (accept up to +3%) — a 3% slippage band around the live mark.
  const acceptable = isLong ? markUsd * 0.97 : markUsd * 1.03;
  const tx = await buildClosePositionTx(client, {
    ticker: T,
    accountId,
    collateralType: client.creditType(),
    positionId: BigInt(positionId),
    acceptablePrice: rawPrice(acceptable),
  });

  if (feeBase > 0n && (await usdsuiWalletBalance(owner)) >= feeBase) {
    const feeCoin = tx.add(coinWithBalance({ type: COLLATERAL_TYPE, balance: feeBase }));
    tx.transferObjects([feeCoin], TREASURY_WALLET);
  } else {
    feeUsd = 0; // wallet can't cover it — close without the fee this time
  }
  return { tx, feeUsd };
}
