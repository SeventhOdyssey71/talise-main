/**
 * Browser-safe `SuiGraphQLClient` singleton.
 *
 * Why a separate module from `web/lib/sui-graphql.ts`:
 *   - `web/lib/sui-graphql.ts` is `import "server-only"` because it lives
 *     alongside the Sui gRPC client and the request-scoped read caches that
 *     route handlers depend on. Pulling it into a `"use client"` component
 *     throws at build time.
 *   - The browser only ever needs the GraphQL transport (no caches, no
 *     gRPC), and only for the one rare "Fix resolution" flow. Spinning up
 *     a hand-rolled fetch wrapper is overkill; the SDK's
 *     `SuiGraphQLClient` already implements `BaseClient` so it slots
 *     straight into `SuinsClient`.
 *
 * Network resolution mirrors `web/lib/sui-graphql.ts`:
 *   - `NEXT_PUBLIC_SUI_NETWORK` selects mainnet vs testnet (default mainnet).
 *   - `NEXT_PUBLIC_SUI_GRAPHQL_URL` (and on the server,
 *     `SUI_GRAPHQL_URL`) lets ops point at a private indexer without code
 *     changes. Only the `NEXT_PUBLIC_*` form reaches the browser bundle —
 *     the server-only var is silently ignored here, which is correct.
 *
 * One client per (network, url) pair is cached at module scope. Re-running
 * `suiGraphQLBrowser()` after an env flip rebuilds it.
 */
import { SuiGraphQLClient } from "@mysten/sui/graphql";

type BrowserNetwork = "mainnet" | "testnet";

function browserNetwork(): BrowserNetwork {
  const v = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet").toLowerCase();
  return v === "testnet" ? "testnet" : "mainnet";
}

function browserGraphQLUrl(net: BrowserNetwork): string {
  const fromEnv = process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return net === "mainnet"
    ? "https://graphql.mainnet.sui.io/graphql"
    : "https://graphql.testnet.sui.io/graphql";
}

let _client: SuiGraphQLClient | null = null;
let _clientKey = "";

/**
 * Cached `SuiGraphQLClient` for use in client components. Don't import this
 * from server modules — use `suiGraphQL()` in `web/lib/sui-graphql.ts`
 * instead.
 */
export function suiGraphQLBrowser(): SuiGraphQLClient {
  const net = browserNetwork();
  const url = browserGraphQLUrl(net);
  const key = `${net}:${url}`;
  if (_client && _clientKey === key) return _client;
  _client = new SuiGraphQLClient({ url, network: net });
  _clientKey = key;
  return _client;
}

/**
 * GraphQL query for a single SuiNS `NameRecord` — the precise read path that
 * `@mysten/suins`'s `SuinsClient.getNameRecord(...)` exposes, but exercised
 * via Sui's top-level `nameRecord(name)` GraphQL query.
 *
 * Confirmed against `https://graphql.mainnet.sui.io/graphql`:
 *   query R($n: String!) { nameRecord(name: $n) { domain target { address } } }
 *   variables: { "n": "sele.talise.sui" }
 *   →
 *   { "data": { "nameRecord": { "domain": "sele.talise.sui",
 *       "target": { "address": "0xb9aa…866c" } } } }
 *
 * `target` is null when the name has no `targetAddress` set — exactly the
 * "stale" condition the FixSubnameBanner repairs.
 */
export const NAME_RECORD_QUERY = /* GraphQL */ `
  query SuinsNameRecord($name: String!) {
    nameRecord(name: $name) {
      domain
      target {
        address
      }
    }
  }
`;

export type NameRecordResponse = {
  nameRecord: {
    domain: string;
    target: { address: string } | null;
  } | null;
};

/**
 * Resolve a SuiNS name's `targetAddress` directly via GraphQL — bypasses the
 * `@mysten/suins` SDK so the banner can pre-check resolution without
 * paying for the SDK's full registry-dynamic-field BCS roundtrip.
 *
 * Returns `null` if the name is unregistered OR if its target is unset.
 * Throws on network/GraphQL errors so callers can surface them.
 */
export async function resolveSuinsTargetAddress(
  name: string
): Promise<string | null> {
  const res = await suiGraphQLBrowser().query<NameRecordResponse>({
    query: NAME_RECORD_QUERY,
    variables: { name },
  });
  if (res.errors && res.errors.length > 0) {
    throw new Error(res.errors[0].message);
  }
  return res.data?.nameRecord?.target?.address ?? null;
}
