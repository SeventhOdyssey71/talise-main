import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { sui, network } from "@/lib/sui";
import { onara } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";

/**
 * POST /api/zk/sponsor
 *
 * Trip 1 of the sponsored flow. Our gas station is Onara
 * (https://github.com/unconfirmedlabs/onara) — a Cloudflare-Workers policy
 * server that signs as gasOwner. Client sends the transaction-kind bytes;
 * we ask Onara for the sponsor address, build the full TransactionData with
 * the sponsor as gasOwner, and return the bytes for the user to sign.
 *
 * The actual sponsor signing happens server-side in Onara when we POST the
 * user-signed bytes to /sponsor — Onara enforces policy, signs, broadcasts.
 */
export async function POST(req: Request) {
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json(
      { error: "ONARA_URL not configured" },
      { status: 503 }
    );
  }

  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { transactionKindB64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.transactionKindB64) {
    return NextResponse.json(
      { error: "missing transactionKindB64" },
      { status: 400 }
    );
  }

  try {
    const t0 = Date.now();
    const onaraClient = onara();
    const client = sui();
    const net = network();

    // Parallelize the two cold round-trips. Both are cached for 60s — the
    // sponsor address rarely changes and reference gas price is
    // epoch-scoped (~24h). On cache hits each resolves in <1ms.
    const [{ address: sponsor }, gasPrice] = await Promise.all([
      memoTtl(`onara:status:${onaraUrl}`, 60_000, () => onaraClient.status()),
      memoTtl(`sui:gasPrice:${net}`, 60_000, () =>
        client.getReferenceGasPrice()
      ),
    ]);
    const tStatus = Date.now();

    const tx = Transaction.fromKind(fromBase64(body.transactionKindB64));
    tx.setSender(user.sui_address);
    tx.setGasOwner(sponsor);
    // Pre-set gas price so `tx.build()` skips the `getReferenceGasPrice`
    // RPC. Sponsor's gas coin lookup still happens — Onara doesn't expose
    // its coin objectRefs, so we can't skip that part.
    tx.setGasPrice(BigInt(gasPrice));

    const bytes = await tx.build({ client: client as never });
    const tBuild = Date.now();

    console.log(
      `[zk/sponsor] status+price(par)=${tStatus - t0}ms · tx.build=${tBuild - tStatus}ms · total=${tBuild - t0}ms`
    );
    return NextResponse.json({ bytes: toBase64(bytes) });
  } catch (err) {
    const msg = (err as Error).message ?? "sponsor failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
