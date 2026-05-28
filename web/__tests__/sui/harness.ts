/**
 * Integration-test harness for the Sui RPC migration.
 *
 * Provides cached, mainnet-pointed clients (gRPC + GraphQL) plus a couple of
 * well-known on-chain artifacts to query against. Tests here hit the real
 * mainnet fullnode — they are slow + network-dependent, and intentionally
 * excluded from the default test run. See `vitest.integration.config.ts` and
 * the `test:integration` script in `package.json`.
 *
 * Phase 4 will fill in concrete tests; this module just gives them a clean
 * place to live.
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiGraphQLClient } from "@mysten/sui/graphql";

const MAINNET_GRPC_URL = "https://fullnode.mainnet.sui.io:443";
const MAINNET_GRAPHQL_URL = "https://sui-mainnet.mystenlabs.com/graphql";

let _grpc: SuiGrpcClient | null = null;
let _graphql: SuiGraphQLClient | null = null;

/**
 * Cached SuiGrpcClient pointed at Sui mainnet (read-only). Fresh per process,
 * memoized for the lifetime of the test run.
 */
export function getGrpcClient(): SuiGrpcClient {
  if (_grpc) return _grpc;
  _grpc = new SuiGrpcClient({
    network: "mainnet",
    baseUrl: MAINNET_GRPC_URL,
  });
  return _grpc;
}

/**
 * Cached SuiGraphQLClient pointed at Sui mainnet. Fresh per process, memoized
 * for the lifetime of the test run.
 */
export function getGraphQLClient(): SuiGraphQLClient {
  if (_graphql) return _graphql;
  _graphql = new SuiGraphQLClient({
    url: MAINNET_GRAPHQL_URL,
    network: "mainnet",
  });
  return _graphql;
}

/**
 * A long-lived mainnet transaction digest. Used by tests that need to assert
 * `getTransaction`-style reads work end-to-end. If this ever pruned from the
 * network it should be replaced with another known-good mainnet digest.
 *
 * TODO(phase-4): verify this digest is still queryable; pin a digest from
 * `web/lib/activity.ts` test fixtures if/when those exist.
 */
export const KNOWN_MAINNET_DIGEST =
  "5LCB3JN6CcS3VppDDP9TVk1eyXkkzfXP49wQq7gFkbtL";

/**
 * The Sui system state object id (0x5). It always exists on every Sui network,
 * which makes it a safe canary for "does the client work at all?" smoke tests
 * — no risk of false negatives from a missing user account.
 */
export const KNOWN_MAINNET_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000005";
