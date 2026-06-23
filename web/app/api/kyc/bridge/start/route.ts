import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById, ensureSchema } from "@/lib/db";
import { bridgeAdapter } from "@/lib/onramp/bridge";
import { upsertOnrampKyc } from "@/lib/onramp/kyc-store";
import { bridgeConfigured } from "@/lib/bridge/client";
import type { KycProfile } from "@/lib/onramp/types";

export const runtime = "nodejs";

/**
 * POST /api/kyc/bridge/start
 *
 * Begin (or resume) Bridge hosted KYC for the signed-in user. Idempotent:
 * Bridge returns the same KYC link for the same email within 24h, so re-calling
 * is safe (the client may poll start → status). Derives a minimal KycProfile
 * from the authenticated user — the client never supplies PII the server holds.
 *
 * 503 when Bridge isn't configured (env-gated, like every Talise ramp partner).
 * Does NOT move money or touch any balance/limit path.
 */
export async function POST(req: Request) {
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: "bridge_disabled" }, { status: 503 });
  }
  // Apply pending schema (the onramp_kyc.kyc_link_id column) before we read/
  // write it — otherwise the upsert throws undefined_column (42703) and 502s.
  await ensureSchema();
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // Derive a minimal profile from the signed-in user (same shape as the
  // onramp v2 session route): split name into first/last, normalize email +
  // country. Bridge runs hosted KYC from just an email + name.
  const parts = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  const profile: KycProfile = {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
    email: (user.email ?? "").toLowerCase(),
    country: (user.country ?? "").toUpperCase(),
  };
  if (!profile.email) {
    return NextResponse.json({ error: "email required for KYC" }, { status: 400 });
  }

  try {
    const customer = await bridgeAdapter.createOrUpdateCustomer(profile);
    // Best-effort persist (no-ops if the migration isn't applied).
    await upsertOnrampKyc(userId, {
      provider: "bridge",
      providerCustomerId: customer.providerCustomerId,
      kycLinkId: customer.kycLinkId ?? null,
      status: customer.status,
      country: profile.country,
    });
    return NextResponse.json({
      provider: "bridge",
      status: customer.status,
      kycUrl: customer.kycUrl,
      tosUrl: customer.tosUrl,
      kycLinkId: customer.kycLinkId,
      customerId: customer.providerCustomerId,
    });
  } catch (e) {
    // TEMP DIAGNOSTIC: surface the real underlying error (Bridge status/code +
    // message) so we can see WHY start fails in prod. Revert to a generic
    // message once the root cause is fixed.
    const err = e as { message?: string; status?: number; code?: string };
    const detail = [err.code, err.status, err.message].filter(Boolean).join(" · ");
    console.error(`[kyc/bridge/start] failed user=${userId}: ${detail}`);
    return NextResponse.json(
      { error: `start failed: ${detail || "unknown"}`, code: "BRIDGE_ERROR" },
      { status: 502 }
    );
  }
}
