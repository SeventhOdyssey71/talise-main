import { NextResponse } from "next/server";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { OnaraClient } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";

/**
 * POST /api/zk/warmup
 *
 * Pre-populates the server-side caches that `/api/zk/sponsor` consults on
 * every send: Onara sponsor address and Sui reference gas price. Both
 * round-trips otherwise add ~700ms each to the *first* send of a session.
 *
 * Called from <ProofWarmer/> on dashboard load — by the time the user
 * actually taps Send, both caches are hot and `tx.build` is roughly 3x
 * faster.
 *
 * No auth needed. The values are global, not per-user.
 */
export async function POST() {
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json({ ok: false, error: "no onara" }, { status: 503 });
  }
  const net = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet").toLowerCase();
  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(net === "mainnet" ? "mainnet" : "testnet"),
    network: net === "mainnet" ? "mainnet" : "testnet",
  });
  const onara = new OnaraClient(onaraUrl);

  const t0 = Date.now();
  try {
    await Promise.all([
      memoTtl(`onara:status:${onaraUrl}`, 60_000, () => onara.status()),
      memoTtl(`sui:gasPrice:${net}`, 60_000, () =>
        client.getReferenceGasPrice()
      ),
    ]);
    console.log(`[zk/warmup] caches warmed in ${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
