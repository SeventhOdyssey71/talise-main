/**
 * Is a historical mainnet transaction still retrievable?
 *
 * Several suites assert against specific real transactions — a shield
 * commitment at a known leaf, a payment the invoice verifier should reject.
 * Public fullnodes PRUNE history, so those fixtures eventually stop resolving
 * and the suite goes red while the code under test is fine:
 *
 *   9vdd9DPhGw6o9i… -> Transaction not found
 *   3stu52xPwLZDTt… -> Transaction not found
 *
 * A red CI that means "the chain forgot our fixture" trains people to ignore
 * CI. These tests skip instead — loudly, naming the digest, so a skip can never
 * be mistaken for a pass.
 */
import { SuiGrpcClient } from "@mysten/sui/grpc";

export async function mainnetTxAvailable(digest: string): Promise<boolean> {
  try {
    const client = new SuiGrpcClient({
      network: "mainnet",
      baseUrl: "https://fullnode.mainnet.sui.io:443",
    });
    await client.core.getTransaction({ digest });
    return true;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[fixture] mainnet tx ${digest} is no longer served (pruned) — ` +
        "skipping the tests that assert against it."
    );
    return false;
  }
}
