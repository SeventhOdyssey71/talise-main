import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById, markVaultSubnameRepointed } from "@/lib/db";
import { getNormalizedTransaction } from "@/lib/sui-shapes";

export const runtime = "nodejs";

/**
 * POST /api/vault/repoint-confirm
 *
 * Companion to `/api/vault/record`. After iOS sponsor-executes the
 * `repoint` PTB returned by record, it POSTs the resulting digest here
 * so the server can verify on chain that the SuiNS `set_target_address`
 * tx actually landed before we flip the `talise_vault_subname_repointed`
 * flag.
 *
 * Body: { digest }
 * Returns: { ok: true }
 *
 * Verification rules:
 *   • Digest resolves via getNormalizedTransaction (gRPC core.getTransaction).
 *   • Sender matches the signed-in user's wallet.
 *   • Effects status == "success".
 *
 * We deliberately do NOT introspect the objectChanges for the SuiNS
 * NameRecord update — its on-chain shape varies across SuiNS package
 * versions and the sender+success pair is sufficient: only the NFT
 * owner can move its target, and a successful tx by the right sender
 * could only have done that for one of their owned NFTs.
 */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { digest?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const digest = (body.digest ?? "").trim();
  if (!digest) {
    return NextResponse.json({ error: "digest required" }, { status: 400 });
  }

  try {
    // gRPC: normalized shape from `getNormalizedTransaction`. Fields used
    // are `sender` (already lowercased) and `status`.
    const tx = await getNormalizedTransaction(digest);
    if (tx.sender !== user.sui_address.toLowerCase()) {
      return NextResponse.json(
        { error: "digest sender does not match user wallet" },
        { status: 400 }
      );
    }
    if (tx.status !== "success") {
      return NextResponse.json(
        { error: `tx status not success: ${tx.status}` },
        { status: 400 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: "digest verification failed: " + (err as Error).message },
      { status: 400 }
    );
  }

  await markVaultSubnameRepointed(userId);
  return NextResponse.json({ ok: true });
}
