import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import { USDSUI_TYPE } from "./usdsui";

export type Network = "testnet" | "mainnet";

/**
 * Re-export USDSUI_TYPE so callers can grab the coin type from the same
 * module they grab balance/network helpers from.
 */
export { USDSUI_TYPE };

/**
 * USDsui native decimals. The on-chain metadata reports 6 (verified against
 * `suix_getCoinMetadata` for `0x44f838…::usdsui::USDSUI`). Keep in sync if
 * the registry ever changes.
 * TODO: verify against `suix_getCoinMetadata` at runtime if/when the deploy
 * changes — defaulting to 6 to match every other Sui-native USD stable.
 */
export const USDSUI_DECIMALS = 6;

export function network(): Network {
  const v = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet").toLowerCase();
  return v === "testnet" ? "testnet" : "mainnet";
}

/**
 * Default gRPC endpoint for Sui mainnet. The same fullnode host serves both
 * JSON-RPC and gRPC-web (port 443, no special path). Mirrors the value
 * Onara wires through `SUI_GRPC_URL`.
 */
function defaultGrpcBaseUrl(net: Network): string {
  // env override lets us point at a private gRPC endpoint (Shinami, etc.)
  // without touching code. Falls back to the public fullnode.
  const fromEnv = process.env.SUI_GRPC_URL ?? process.env.NEXT_PUBLIC_SUI_GRPC_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return net === "mainnet"
    ? "https://fullnode.mainnet.sui.io:443"
    : "https://fullnode.testnet.sui.io:443";
}

// ─── gRPC (default) ───────────────────────────────────────────────────────────
// `sui()` is the canonical client. Reads that map cleanly onto the unified
// `BaseClient` surface (`getBalance`, `getCoinMetadata`, `getObject`,
// `listOwnedObjects`, `listCoins`, `getTransaction`, `listDynamicFields`,
// SDK pass-throughs that consume the same surface) use this.

let _grpc: SuiGrpcClient | null = null;
let _grpcKey = "";

export function sui(): SuiGrpcClient {
  const net = network();
  const baseUrl = defaultGrpcBaseUrl(net);
  const key = `${net}:${baseUrl}`;
  if (_grpc && _grpcKey === key) return _grpc;
  _grpc = new SuiGrpcClient({ network: net, baseUrl });
  _grpcKey = key;
  return _grpc;
}

// ─── JSON-RPC fallback ────────────────────────────────────────────────────────
// Some legacy reads have no gRPC equivalent or use a response shape we
// haven't migrated yet:
//   • `queryTransactionBlocks` — not exposed on `SuiGrpcClient` at all
//     (gRPC's analog is event-based subscription, not a paginated query).
//   • `getTransactionBlock` — JSON-RPC's shape (`transaction.data.sender`,
//     `objectChanges[]` with `type: "created"`, `effects.status.status`)
//     is what our verify paths walk. gRPC's `getTransaction` returns a
//     proto-shaped struct we'd have to re-map.
//   • `getOwnedObjects` — JSON-RPC version returns `data[].data.type` plus
//     `showContent` payload our code reads directly.
//   • `getDynamicFields` — JSON-RPC version returns `data[].name.value` as
//     UTF-8 byte arrays our code decodes inline.
//   • `getAllCoins`, `multiGetObjects`, `getLatestSuiSystemState` — also
//     no clean gRPC counterpart in the current `@mysten/sui` build.
//
// `suiJsonRpc()` is the escape hatch for these. Keep its use limited to
// the legacy call sites — new code should default to `sui()`.

let _jsonRpc: SuiJsonRpcClient | null = null;
let _jsonRpcKey = "";

export function suiJsonRpc(): SuiJsonRpcClient {
  const net = network();
  const url = getJsonRpcFullnodeUrl(net);
  const key = `${net}:${url}`;
  if (_jsonRpc && _jsonRpcKey === key) return _jsonRpc;
  _jsonRpc = new SuiJsonRpcClient({ url, network: net });
  _jsonRpcKey = key;
  return _jsonRpc;
}

/** Canonical coin types on Sui mainnet (and equivalents on testnet). */
export const COIN_TYPES = {
  SUI: "0x2::sui::SUI",
  // Native Circle USDC on Sui mainnet (verified against @mysten/deepbook-v3 constants)
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  // DEEP — DeepBook governance / fee discount
  DEEP: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
} as const;

export function suiscanAccountUrl(address: string): string {
  return `https://suiscan.xyz/${network()}/account/${address}`;
}
export function suiscanTxUrl(digest: string): string {
  return `https://suiscan.xyz/${network()}/tx/${digest}`;
}
export function suiscanObjectUrl(id: string): string {
  return `https://suiscan.xyz/${network()}/object/${id}`;
}

export async function getSuiBalance(address: string): Promise<{
  mist: string;
  sui: number;
}> {
  try {
    // gRPC `getBalance` returns `{ balance: { addressBalance, coinBalance,
    // balance, coinType } }`. `balance.balance` is the totalBalance.
    const res = await sui().getBalance({ owner: address });
    const mistStr = res.balance.balance;
    const suiNum = Number(BigInt(mistStr)) / 1e9;
    return { mist: mistStr, sui: suiNum };
  } catch {
    return { mist: "0", sui: 0 };
  }
}

export async function getUsdcBalance(address: string): Promise<{
  raw: string;
  usdc: number;
}> {
  try {
    const res = await sui().getBalance({
      owner: address,
      coinType: COIN_TYPES.USDC,
    });
    const raw = res.balance.balance;
    // Native USDC has 6 decimals
    const usdc = Number(BigInt(raw)) / 1e6;
    return { raw, usdc };
  } catch {
    return { raw: "0", usdc: 0 };
  }
}

/**
 * USDsui balance for an address. Mirrors `getUsdcBalance` but queries the
 * Sui-native USDsui coin type — our canonical settlement asset.
 */
export async function getUsdsuiBalance(address: string): Promise<{
  raw: string;
  usdsui: number;
}> {
  try {
    const res = await sui().getBalance({
      owner: address,
      coinType: USDSUI_TYPE,
    });
    const raw = res.balance.balance;
    const usdsui = Number(BigInt(raw)) / Math.pow(10, USDSUI_DECIMALS);
    return { raw, usdsui };
  } catch {
    return { raw: "0", usdsui: 0 };
  }
}

/** Format MIST string as human-readable SUI with up to 4 decimals. */
export function formatSui(mist: string | bigint): string {
  const n = typeof mist === "string" ? BigInt(mist) : mist;
  const whole = n / 1_000_000_000n;
  const frac = n % 1_000_000_000n;
  const fracStr = (Number(frac) / 1e9).toFixed(4).slice(2);
  return `${whole}.${fracStr}`;
}
