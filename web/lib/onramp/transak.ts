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
 * Transak on-ramp adapter — FALLBACK provider (card-supporting aggregator).
 *
 * Transak does NOT deliver USDsui. It delivers USDC on Sui; the existing
 * AutoConvertBanner / swap leg then converts USDC → USDsui. So this adapter
 * always reports `deliverAsset = USDC` and `requiresSwapToUsdsui = true`, and
 * the SWAP-TO-USDSUI step is the caller's responsibility (the on-chain leg is
 * NOT USDsui yet when Transak completes).
 *
 * STUB: with no `TRANSAK_API_KEY` set, every method returns deterministic,
 * typed mock data. Real call sites are marked `// TODO(live):`.
 *
 * Docs (for the live wiring): https://docs.transak.com
 */

const NAME: OnrampProviderName = "transak";
const DELIVER: DeliverAsset = "USDC";

function apiKey(): string | undefined {
  return process.env.TRANSAK_API_KEY || undefined;
}

function webhookSecret(): string | undefined {
  // Transak signs webhooks with a JWT secret / API secret in production.
  return process.env.TRANSAK_API_SECRET || process.env.TRANSAK_API_KEY || undefined;
}

export const transakAdapter: OnrampProvider = {
  name: NAME,
  displayName: "Transak (card → USDC on Sui, then swap to USDsui)",
  deliverAsset: DELIVER,

  async getRequirements(
    input: RequirementsInput
  ): Promise<RequirementsResult> {
    // Same tier ladder as Bridge. TODO(live): Transak surfaces KYC tiers via
    // its own API; reconcile if its thresholds differ from the local ladder.
    return computeRequirements(input);
  },

  async createOrUpdateCustomer(profile: KycProfile): Promise<CustomerResult> {
    const key = apiKey();
    if (!key) {
      const providerCustomerId = stubCustomerId(profile);
      const status: OnrampKycStatus = profile.governmentIdRef
        ? "pending"
        : "approved";
      return {
        providerCustomerId,
        status,
        dailyLimitCents: 1_000_00,
        monthlyLimitCents: 10_000_00,
      };
    }
    // TODO(live): Transak's KYC is widget-driven; if using their partner KYC
    // API, create/reference the user here and map the response.
    throw new Error(
      "transak: live createOrUpdateCustomer not implemented (TODO(live))"
    );
  },

  async createOnrampSession(input: SessionInput): Promise<SessionResult> {
    const key = apiKey();
    // Transak only delivers USDC — coerce regardless of what the caller asked.
    const deliverAsset: DeliverAsset = DELIVER;

    if (!key) {
      const params = new URLSearchParams({
        provider: NAME,
        customer: input.providerCustomerId,
        amountCents: String(input.amountCents),
        destination: input.destinationAddress,
        asset: deliverAsset,
        stub: "1",
      });
      return {
        provider: NAME,
        widgetUrl: `https://onramp.stub.local/transak?${params.toString()}`,
        deliverAsset,
        // Transak delivers USDC → a swap-to-USDsui step is still required.
        requiresSwapToUsdsui: true,
      };
    }

    // TODO(live): build a Transak widget URL (apiKey + walletAddress +
    // cryptoCurrencyCode=USDC + network=sui + fiatAmount). Return it as
    // `widgetUrl`. The USDC→USDsui swap is a SEPARATE on-chain step.
    throw new Error(
      "transak: live createOnrampSession not implemented (TODO(live))"
    );
  },

  async verifyWebhook(
    rawBody: string,
    headers: Headers | Record<string, string>
  ): Promise<OnrampWebhookEvent> {
    const secret = webhookSecret();
    const sig = headerGet(headers, "x-transak-signature");

    let verified = false;
    if (secret && sig) {
      // TODO(live): Transak signs with a JWT (HS256) of the payload. This
      // placeholder does an HMAC-SHA256 hex compare; replace with real JWT
      // verification against TRANSAK_API_SECRET before going live.
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sig, "utf8");
      verified = a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    let raw: unknown = {};
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = { _unparsed: rawBody };
    }

    const obj = (raw ?? {}) as Record<string, unknown>;
    const kind = mapKind(
      typeof obj.eventID === "string"
        ? obj.eventID
        : typeof obj.type === "string"
          ? obj.type
          : undefined
    );
    return {
      provider: NAME,
      verified,
      kind,
      providerCustomerId:
        typeof obj.partnerCustomerId === "string"
          ? obj.partnerCustomerId
          : typeof obj.customer_id === "string"
            ? obj.customer_id
            : undefined,
      status: mapStatus(obj.status),
      tier: mapTier(obj.kycTier ?? obj.kyc_tier),
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
  return `transak_stub_${h}`;
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
  const t = type.toLowerCase();
  if (t.includes("kyc") || t.includes("customer")) return "kyc.updated";
  if (t.includes("order") || t.includes("onramp")) return "onramp.completed";
  return "unknown";
}

function mapStatus(v: unknown): OnrampKycStatus | undefined {
  const s = typeof v === "string" ? v.toLowerCase() : undefined;
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
