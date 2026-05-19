import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
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

let _client: SuiJsonRpcClient | null = null;

export function sui(): SuiJsonRpcClient {
  if (_client) return _client;
  const net = network();
  _client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(net),
    network: net,
  });
  return _client;
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
    const b = await sui().getBalance({ owner: address });
    const mistStr = b.totalBalance;
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
    const b = await sui().getBalance({
      owner: address,
      coinType: COIN_TYPES.USDC,
    });
    const raw = b.totalBalance;
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
    const b = await sui().getBalance({
      owner: address,
      coinType: USDSUI_TYPE,
    });
    const raw = b.totalBalance;
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
