import { NextResponse } from "next/server";
import {
  shieldConfigured,
  shieldRelayerAddress,
  shieldMaxRelayerFee,
} from "@/lib/shield/relayer-config";

export const runtime = "nodejs";

/**
 * GET /api/shield/relayer
 *
 * Returns the relayer's Sui address so the client SDK can set
 * `ExtData.relayer` (and the fee recipient) to a value the relayer will
 * actually accept. The client builds the proof + ext_data with THIS address;
 * `/api/shield/relay` then re-asserts it matches before sponsoring.
 *
 * 503 when the shielded-pool relayer is not configured (no `SHIELD_PKG` /
 * `SHIELD_RELAYER_ADDRESS`) — the whole Workstream-C surface is dormant by
 * default.
 */
export async function GET() {
  if (!shieldConfigured()) {
    return NextResponse.json(
      { error: "shield relayer not configured" },
      { status: 503 }
    );
  }
  return NextResponse.json({
    address: shieldRelayerAddress(),
    maxRelayerFee: shieldMaxRelayerFee().toString(),
  });
}
