import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Stripe Crypto Onramp — server-side session creator.
 *
 * We forward the user's `sui_address` as a locked destination wallet so that
 * Stripe can only deliver to that exact address. The user's net effect is
 * "buy USDsui with a card" because the home page's AutoConvertBanner sweeps
 * any inbound USDC to USDsui automatically.
 *
 * We use `fetch` directly against Stripe's REST API to avoid pulling in the
 * `stripe` npm package — keeps the dependency footprint small and the
 * surface area minimal (one call, one shape).
 *
 * Docs: https://docs.stripe.com/crypto/onramp
 */
export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Stripe is not configured on this server." },
      { status: 500 }
    );
  }

  // Optional `{ amount }` override — UI may send a custom fiat amount later.
  // Default to $20 which is Stripe's sweet spot for first-time onramp.
  let body: { amount?: number } = {};
  try {
    const txt = await req.text();
    if (txt) body = JSON.parse(txt) as { amount?: number };
  } catch {
    // tolerate empty body
  }

  const amount =
    typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
      ? Math.round(body.amount * 100) / 100
      : 20;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  // Build form body. Stripe expects application/x-www-form-urlencoded with
  // bracketed keys for nested fields (e.g. `wallet_addresses[sui]`).
  // URLSearchParams handles the percent-encoding for us.
  const form = new URLSearchParams();
  form.set("destination_currency", "usdc");
  form.set("destination_network", "sui");
  form.set("wallet_addresses[sui]", user.sui_address);
  form.set("lock_wallet_address", "true");
  form.set("source_currency", "usd");
  form.set("source_amount", String(amount));
  form.set("success_url", `${baseUrl}/home?onramp=success`);
  form.set("cancel_url", `${baseUrl}/home?onramp=cancel`);

  let resp: Response;
  try {
    resp = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Could not reach Stripe: ${(e as Error).message ?? "unknown"}`,
      },
      { status: 502 }
    );
  }

  const json = (await resp.json().catch(() => ({}))) as {
    id?: string;
    client_secret?: string;
    redirect_url?: string;
    error?: { message?: string; code?: string; type?: string };
  };

  if (!resp.ok) {
    const message =
      json.error?.message ?? `Stripe request failed (HTTP ${resp.status})`;
    return NextResponse.json({ error: message }, { status: resp.status });
  }

  if (!json.redirect_url) {
    return NextResponse.json(
      { error: "Stripe did not return a redirect URL." },
      { status: 502 }
    );
  }

  return NextResponse.json({ redirectUrl: json.redirect_url });
}
