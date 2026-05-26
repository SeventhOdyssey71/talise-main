import { NextResponse } from "next/server";
import { suiJsonRpc } from "@/lib/sui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the current Sui epoch. Used client-side to choose a sane maxEpoch
 * when generating the ephemeral key pair, without bundling the Sui SDK on
 * the public landing.
 */
export async function GET() {
  try {
    // `getLatestSuiSystemState` is JSON-RPC only — no gRPC equivalent.
    const state = await suiJsonRpc().getLatestSuiSystemState();
    return NextResponse.json({ epoch: state.epoch });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    );
  }
}
