import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getOnrampKyc } from "@/lib/onramp/kyc-store";
import { bridgeConfigured } from "@/lib/bridge/client";
import {
  createUsAchExternalAccount,
  createIbanExternalAccount,
  createSuiLiquidationAddress,
  listLiquidationAddresses,
} from "@/lib/bridge/offramp";
import type { BridgeFiatCurrency } from "@/lib/bridge/onramp";

export const runtime = "nodejs";

/**
 * POST /api/offramp/bridge/cashout-address
 *
 * Bridge off-ramp: register the user's payout bank account and return a
 * PERSISTENT Sui address. USDsui sent to that address is auto-converted and
 * paid out as fiat to their bank (USD via ACH, EUR via SEPA). The user simply
 * sends USDsui to the address to cash out.
 *
 * Reuses the Bridge customer minted during on-ramp KYC (`onramp_kyc`); the
 * customer must exist (KYC started) — Bridge off-ramp can't run for an
 * unverified user. 503 when Bridge isn't configured (env-gated, like every
 * Talise ramp partner). Does NOT touch any send/balance/limit path.
 *
 * Body (US ACH):
 *   { rail: "ach", currency: "usd", accountOwnerName, accountNumber,
 *     routingNumber, checkingOrSavings? }
 * Body (SEPA/IBAN):
 *   { rail: "sepa", currency: "eur", accountOwnerName, firstName, lastName,
 *     iban, bic, country }
 */
export async function POST(req: Request) {
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: "bridge_offramp_disabled" }, { status: 503 });
  }
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const user = await userById(userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // The Bridge customer is shared with the on-ramp; off-ramp requires it.
  const kyc = await getOnrampKyc(userId);
  const customerId = kyc?.providerCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { error: "complete identity verification first", code: "NO_BRIDGE_CUSTOMER" },
      { status: 409 }
    );
  }

  let body: {
    rail?: string;
    currency?: string;
    accountOwnerName?: string;
    accountNumber?: string;
    routingNumber?: string;
    checkingOrSavings?: "checking" | "savings";
    firstName?: string;
    lastName?: string;
    iban?: string;
    bic?: string;
    country?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const rail = String(body.rail ?? "").toLowerCase();
  const currency = String(body.currency ?? "").toLowerCase() as BridgeFiatCurrency;
  if (!body.accountOwnerName) {
    return NextResponse.json({ error: "accountOwnerName required" }, { status: 400 });
  }

  try {
    // 1. Register the payout bank account. Stable idempotency key per
    //    user+currency so repeat calls within Bridge's 24h window reuse it.
    let externalAccountId: string;
    if (rail === "ach" || currency === "usd") {
      if (!body.accountNumber || !body.routingNumber) {
        return NextResponse.json(
          { error: "accountNumber + routingNumber required for ACH" },
          { status: 400 }
        );
      }
      const ext = await createUsAchExternalAccount({
        customerId,
        accountOwnerName: body.accountOwnerName,
        accountNumber: body.accountNumber,
        routingNumber: body.routingNumber,
        checkingOrSavings: body.checkingOrSavings,
        idempotencyKey: `ext-${userId}-usd`,
      });
      externalAccountId = ext.id;
    } else if (rail === "sepa" || currency === "eur") {
      if (!body.iban || !body.bic || !body.firstName || !body.lastName || !body.country) {
        return NextResponse.json(
          { error: "iban, bic, firstName, lastName, country required for SEPA" },
          { status: 400 }
        );
      }
      const ext = await createIbanExternalAccount({
        customerId,
        accountOwnerName: body.accountOwnerName,
        firstName: body.firstName,
        lastName: body.lastName,
        iban: body.iban,
        bic: body.bic,
        country: body.country,
        idempotencyKey: `ext-${userId}-eur`,
      });
      externalAccountId = ext.id;
    } else {
      return NextResponse.json(
        { error: "unsupported rail (use ach/usd or sepa/eur)", code: "UNSUPPORTED_RAIL" },
        { status: 400 }
      );
    }

    const destinationPaymentRail = currency === "eur" ? "sepa" : "ach";

    // 2. Reuse an existing matching liquidation address if one exists for this
    //    corridor, else create one. (Idempotent without extra storage.)
    let address: string | undefined;
    try {
      const existing = await listLiquidationAddresses(customerId);
      const match = existing.data?.find(
        (la) =>
          la.currency?.toLowerCase() === "usdsui" &&
          la.destination_currency?.toLowerCase() === currency &&
          la.external_account_id === externalAccountId &&
          la.state === "active"
      );
      address = match?.address;
    } catch {
      /* list failed → fall through to create */
    }

    if (!address) {
      const la = await createSuiLiquidationAddress({
        customerId,
        externalAccountId,
        destinationPaymentRail,
        destinationCurrency: currency,
        idempotencyKey: `la-${userId}-${currency}`,
      });
      address = la.address;
    }

    return NextResponse.json({
      address, // the persistent Sui address to send USDsui to
      currency,
      destinationPaymentRail,
      note: "Send USDsui to this address to cash out to your bank.",
    });
  } catch (e) {
    const msg = (e as Error).message || "bridge_offramp_failed";
    console.error(`[offramp/bridge] cashout-address failed user=${userId}: ${msg}`);
    return NextResponse.json(
      { error: "Couldn't set up cash-out. Please try again.", code: "BRIDGE_ERROR" },
      { status: 502 }
    );
  }
}
