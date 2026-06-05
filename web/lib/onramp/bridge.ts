import "server-only";

import crypto from "node:crypto";
import {
  type CustomerResult,
  type DeliverAsset,
  type OnrampProvider,
  type OnrampProviderName,
  type OnrampWebhookEvent,
  type RequirementsInput,
  type RequirementsResult,
  type SessionInput,
  type SessionResult,
  type KycProfile,
  type OnrampKycStatus,
  type OnrampKycTier,
} from "./types";
import { computeRequirements } from "./requirements";

/**
 * Bridge on-ramp adapter — DEFAULT provider.
 *
 * Bridge (a Stripe company) is the issuer of USDsui ("Sui Dollar"), so this
 * adapter delivers USDSUI DIRECTLY on Sui — no swap step. It supports bank
 * + card funding.
 *
 * STUB: with no `BRIDGE_API_KEY` set, every method returns deterministic,
 * typed mock data so the routes + modal work end-to-end in dev. Each place a
 * real network call belongs is marked `// TODO(live):`.
 *
 * Docs (for the live wiring): https://apidocs.bridge.xyz
 */

const NAME: OnrampProviderName = "bridge";
const DELIVER: DeliverAsset = "USDSUI";

function apiKey(): string | undefined {
  return process.env.BRIDGE_API_KEY || undefined;
}

function webhookSecret(): string | undefined {
  return process.env.BRIDGE_WEBHOOK_SECRET || undefined;
}

export const bridgeAdapter: OnrampProvider = {
  name: NAME,
  displayName: "Bridge (Sui Dollar — USDsui)",
  deliverAsset: DELIVER,

  async getRequirements(
    input: RequirementsInput
  ): Promise<RequirementsResult> {
    // Tier ladder is provider-agnostic; Bridge uses the shared engine.
    // TODO(live): if Bridge exposes a per-country requirements endpoint,
    // call it here and reconcile with the local ladder.
    return computeRequirements(input);
  },

  async createOrUpdateCustomer(profile: KycProfile): Promise<CustomerResult> {
    const key = apiKey();
    if (!key) {
      // STUB: deterministic customer id derived from the profile so repeat
      // calls in dev are stable. Status mirrors a fresh applicant in review.
      const providerCustomerId = stubCustomerId(profile);
      const status: OnrampKycStatus = profile.governmentIdRef
        ? "pending"
        : "approved"; // lite-only (no doc) is auto-approved in the stub
      return {
        providerCustomerId,
        status,
        dailyLimitCents: 1_000_00,
        monthlyLimitCents: 10_000_00,
      };
    }

    // TODO(live): POST the customer/applicant to Bridge and map the response.
    //   const resp = await fetch("https://api.bridge.xyz/v0/customers", {
    //     method: "POST",
    //     headers: { "Api-Key": key, "Content-Type": "application/json" },
    //     body: JSON.stringify(toBridgeCustomer(profile)),
    //     signal: AbortSignal.timeout(8000),
    //   });
    //   const json = await resp.json();
    //   return { providerCustomerId: json.id, status: mapBridgeStatus(json.status), ... };
    throw new Error(
      "bridge: live createOrUpdateCustomer not implemented (TODO(live))"
    );
  },

  async createOnrampSession(input: SessionInput): Promise<SessionResult> {
    const key = apiKey();
    if (!key) {
      // STUB: a fake hosted widget URL that encodes the request so a dev can
      // eyeball that the right address/amount flowed through. No real money.
      const params = new URLSearchParams({
        provider: NAME,
        customer: input.providerCustomerId,
        amountCents: String(input.amountCents),
        destination: input.destinationAddress,
        asset: input.deliverAsset,
        stub: "1",
      });
      return {
        provider: NAME,
        widgetUrl: `https://onramp.stub.local/bridge?${params.toString()}`,
        deliverAsset: input.deliverAsset,
        requiresSwapToUsdsui: false, // Bridge delivers USDsui directly
      };
    }

    // TODO(live): create a Bridge on-ramp / transfer session that delivers
    // USDsui to `input.destinationAddress` on Sui, then return its hosted
    // `widgetUrl` (or `clientSecret` for an embedded flow).
    throw new Error(
      "bridge: live createOnrampSession not implemented (TODO(live))"
    );
  },

  async verifyWebhook(
    rawBody: string,
    headers: Headers | Record<string, string>
  ): Promise<OnrampWebhookEvent> {
    const secret = webhookSecret();
    const sig = headerGet(headers, "x-bridge-signature");

    let verified = false;
    if (secret && sig) {
      // TODO(live): confirm Bridge's exact signing scheme. This assumes a
      // hex HMAC-SHA256 of the raw body, compared constant-time.
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sig, "utf8");
      verified = a.length === b.length && crypto.timingSafeEqual(a, b);
    } else if (!secret) {
      // STUB: no secret configured (dev) — accept and mark unverified so the
      // route can no-op safely without failing closed during local testing.
      verified = false;
    }

    let raw: unknown = {};
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = { _unparsed: rawBody };
    }

    const obj = (raw ?? {}) as Record<string, unknown>;
    const kind = mapKind(typeof obj.type === "string" ? obj.type : undefined);
    return {
      provider: NAME,
      verified,
      kind,
      providerCustomerId:
        typeof obj.customer_id === "string" ? obj.customer_id : undefined,
      status: mapStatus(obj.status),
      tier: mapTier(obj.kyc_tier),
      country: typeof obj.country === "string" ? obj.country : undefined,
      dailyLimitCents: numOrNull(obj.daily_limit_cents),
      monthlyLimitCents: numOrNull(obj.monthly_limit_cents),
      raw,
    };
  },
};

// ── helpers ──────────────────────────────────────────────────────────

function stubCustomerId(profile: KycProfile): string {
  const h = crypto
    .createHash("sha256")
    .update(`${profile.email}|${profile.country}`)
    .digest("hex")
    .slice(0, 16);
  return `bridge_stub_${h}`;
}

function headerGet(
  headers: Headers | Record<string, string>,
  name: string
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  return headers[name] ?? headers[name.toLowerCase()] ?? undefined;
}

function mapKind(type?: string): OnrampWebhookEvent["kind"] {
  if (!type) return "unknown";
  if (type.includes("kyc") || type.includes("customer")) return "kyc.updated";
  if (type.includes("onramp") || type.includes("transfer"))
    return "onramp.completed";
  return "unknown";
}

function mapStatus(v: unknown): OnrampKycStatus | undefined {
  const s = typeof v === "string" ? v : undefined;
  if (!s) return undefined;
  const allowed: OnrampKycStatus[] = [
    "unverified",
    "pending",
    "approved",
    "rejected",
    "expired",
  ];
  return allowed.includes(s as OnrampKycStatus)
    ? (s as OnrampKycStatus)
    : undefined;
}

function mapTier(v: unknown): OnrampKycTier | undefined {
  const t = typeof v === "string" ? v : undefined;
  if (!t) return undefined;
  const allowed: OnrampKycTier[] = ["none", "lite", "standard", "enhanced"];
  return allowed.includes(t as OnrampKycTier)
    ? (t as OnrampKycTier)
    : undefined;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
