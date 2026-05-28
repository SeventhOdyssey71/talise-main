/**
 * Sui mainnet gRPC endpoint registry + multi-provider fallback wrapper.
 *
 * Why this exists:
 *   Today's outage on `fullnode.mainnet.sui.io:443` (503 no_healthy_upstream)
 *   took down our iOS gRPC test run and 10/43 web integration tests. This
 *   module provides a fallback chain so a single Mysten node failure no
 *   longer takes the app offline.
 *
 * What this module is NOT:
 *   - It is NOT wired into `sui()` yet. Callers of `sui()` keep their
 *     current single-endpoint behavior. The substitution is the follow-up
 *     cohort once we've vetted per-endpoint compatibility.
 *
 * See: docs/sui-rpc-migration/endpoints.md
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

type Network = "testnet" | "mainnet";

/**
 * Local network() — copy of `./sui` so this module has no import cycle with
 * the canonical client wiring. Kept tiny on purpose; if the canonical
 * `sui()` ever changes its env-var contract, mirror that change here too.
 */
function network(): Network {
  const v = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet").toLowerCase();
  return v === "testnet" ? "testnet" : "mainnet";
}

// ─── Endpoint registry ────────────────────────────────────────────────────────

/**
 * One entry in the fallback chain. Ordered list lives in
 * `MAINNET_GRPC_ENDPOINTS`. Anything with `requiresAuth: true` reads the
 * key from the env var named in `apiKeyEnv`; if that env var is unset the
 * wrapper SKIPS the endpoint (does not throw).
 */
export type SuiGrpcEndpoint = {
  /** Full base URL (scheme + host + port). gRPC-Web speaks HTTPS. */
  readonly url: string;
  /** Human-readable provider name (used in telemetry). */
  readonly provider: string;
  /** Whether the wrapper should attempt this endpoint without an API key. */
  readonly requiresAuth: boolean;
  /** Env var name that holds the API key (only meaningful if requiresAuth). */
  readonly apiKeyEnv?: string;
  /** Header name to send the API key under (e.g. `x-api-key`). */
  readonly apiKeyHeader?: string;
};

/**
 * Ordered Sui MAINNET gRPC endpoints, preferred first.
 *
 * The ordering is biased toward (a) free + already-default and (b)
 * providers we already have a working key for. Anything paid-with-no-key
 * is included for completeness but is INERT until the relevant env var is
 * set — the wrapper skips it cleanly.
 */
export const MAINNET_GRPC_ENDPOINTS: ReadonlyArray<SuiGrpcEndpoint> = [
  {
    url: "https://fullnode.mainnet.sui.io:443",
    provider: "mysten-fullnode",
    requiresAuth: false,
  },
  {
    // Mysten's archival sibling. Mentioned in our internal sub-plan docs as
    // higher-retention. If it lives on the same upstream cluster as the
    // primary fullnode (which today's outage suggested), we'll demote it
    // below Shinami once we have outage correlation data.
    url: "https://archive.mainnet.sui.io:443",
    provider: "mysten-archive",
    requiresAuth: false,
  },
  {
    // Shinami — we already use them for zkLogin + gas station and have a
    // mainnet US1 key in .env.local under SHINAMI_API_KEY.
    url: "https://api.us1.shinami.com/sui/node/v1",
    provider: "shinami",
    requiresAuth: true,
    apiKeyEnv: "SHINAMI_API_KEY",
    apiKeyHeader: "X-Api-Key",
  },
  {
    // Dwellir — header auth via `x-api-key`. Requires DWELLIR_API_KEY.
    url: "https://api-sui-mainnet-full.n.dwellir.com:443",
    provider: "dwellir",
    requiresAuth: true,
    apiKeyEnv: "DWELLIR_API_KEY",
    apiKeyHeader: "x-api-key",
  },
  {
    // QuickNode — token is baked into the URL host (e.g.
    // `https://<token>.sui-mainnet.quiknode.pro:9000`). We expect the
    // operator to paste the FULL URL into QUICKNODE_SUI_GRPC_URL rather
    // than re-implementing token-in-URL composition here.
    url: process.env.QUICKNODE_SUI_GRPC_URL ?? "",
    provider: "quicknode",
    requiresAuth: true,
    apiKeyEnv: "QUICKNODE_SUI_GRPC_URL",
  },
];

// ─── Errors we should fall back on ────────────────────────────────────────────

/**
 * Returns true if an error from `SuiGrpcClient` is the kind we should retry
 * against the next endpoint in the chain.
 *
 * `@protobuf-ts/runtime-rpc` throws `RpcError` with a string `code` field
 * (e.g. `"UNAVAILABLE"`, `"DEADLINE_EXCEEDED"`). Fetch / network errors
 * surface as plain `Error` / `TypeError` whose message contains `503`,
 * `502`, `504`, or `fetch failed`. Be liberal about both — fallback is the
 * safe direction.
 */
export function isFallbackEligible(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  if (code === "unavailable" || code === "deadline_exceeded") return true;
  // Numeric gRPC codes: 14 = UNAVAILABLE, 4 = DEADLINE_EXCEEDED.
  if (typeof e.code === "number" && (e.code === 14 || e.code === 4)) return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    msg.includes("no_healthy_upstream") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("unavailable") ||
    msg.includes("deadline")
  ) {
    return true;
  }
  if (typeof e.name === "string" && e.name === "AbortError") return true;
  return false;
}

// ─── Per-endpoint client factory ──────────────────────────────────────────────

/**
 * Build a one-off `SuiGrpcClient` against a specific endpoint. Returns
 * `null` when the endpoint requires auth and the env var is unset (or the
 * URL itself is empty — QuickNode's case).
 *
 * The `meta` field is `@protobuf-ts/grpcweb-transport`'s metadata bag,
 * which translates to HTTP headers on the wire. Per-provider header
 * conventions:
 *   - Shinami: `X-Api-Key`
 *   - Dwellir: `x-api-key`
 *   - QuickNode: token baked into the URL, no header needed.
 */
export function buildClientForEndpoint(
  endpoint: SuiGrpcEndpoint,
  net: Network,
): SuiGrpcClient | null {
  if (!endpoint.url || endpoint.url.trim().length === 0) return null;

  let meta: Record<string, string> | undefined;
  if (endpoint.requiresAuth) {
    const envName = endpoint.apiKeyEnv;
    const key = envName ? process.env[envName] : undefined;
    if (!key || key.trim().length === 0) {
      // Endpoint declared paid but no key configured — skip it.
      return null;
    }
    if (endpoint.apiKeyHeader) {
      meta = { [endpoint.apiKeyHeader]: key };
    }
    // QuickNode's "key" IS the URL — no header to set in that path.
  }

  return new SuiGrpcClient({
    network: net,
    baseUrl: endpoint.url,
    ...(meta ? { meta } : {}),
  });
}

// ─── Fallback wrapper ─────────────────────────────────────────────────────────

/**
 * Run `fn` against the first reachable endpoint in `MAINNET_GRPC_ENDPOINTS`,
 * falling back on `UNAVAILABLE` / `DEADLINE_EXCEEDED` / 5xx-class errors.
 *
 * Returns the result of the first successful call. If every endpoint fails,
 * throws the LAST error so the caller sees the most-recent provider's
 * message (not the stale Mysten 503).
 *
 * Usage:
 *   const balance = await suiGrpcWithFallback((c) =>
 *     c.getBalance({ owner: address, coinType: COIN_TYPES.SUI }),
 *   );
 */
export async function suiGrpcWithFallback<T>(
  fn: (client: SuiGrpcClient) => Promise<T>,
): Promise<T> {
  const net = network();
  // Mainnet-only for now. Testnet path is a follow-up.
  if (net !== "mainnet") {
    throw new Error(
      `suiGrpcWithFallback: only mainnet is supported (got ${net})`,
    );
  }

  let lastErr: unknown = new Error("no endpoints attempted");
  let attempted = 0;
  for (const endpoint of MAINNET_GRPC_ENDPOINTS) {
    const client = buildClientForEndpoint(endpoint, net);
    if (!client) continue; // skipped (no key / empty URL)
    attempted += 1;
    try {
      return await fn(client);
    } catch (err) {
      lastErr = err;
      if (!isFallbackEligible(err)) {
        // Non-transient error — fail fast rather than blowing through every
        // provider with a bad request (e.g. caller's address is malformed).
        throw err;
      }
      // Transient — try the next endpoint.
      continue;
    }
  }

  if (attempted === 0) {
    throw new Error(
      "suiGrpcWithFallback: no endpoints were attempted (every paid endpoint missing its API key, and the public Mysten endpoint URL was empty)",
    );
  }
  throw lastErr;
}
