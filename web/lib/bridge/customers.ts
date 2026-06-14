import "server-only";

import { bridgeFetch } from "./client";
import type { OnrampKycStatus } from "@/lib/onramp/types";

/**
 * Bridge Customers + KYC. Two ways to onboard:
 *
 *   1. Hosted KYC Link (preferred for Talise) — `createKycLink` returns a
 *      `kyc_link` URL we redirect the user to; Bridge runs the whole identity
 *      + ToS flow and creates the customer for us. We poll / webhook the
 *      status. No PII flows through Talise servers.
 *
 *   2. Direct customer create — `createCustomer` posts the applicant PII
 *      ourselves (needs a `signed_agreement_id` from the ToS flow to transact).
 *
 * Status strings are Bridge's; `mapBridgeKycStatus` collapses them onto
 * Talise's `OnrampKycStatus` ladder.
 */

// ── Bridge status enums (verbatim) ───────────────────────────────────
//   customer.status:  active | awaiting_questionnaire | awaiting_ubo |
//                     incomplete | not_started | offboarded | paused |
//                     rejected | under_review
//   kyc_link.kyc_status: not_started | incomplete | awaiting_questionnaire |
//                     awaiting_ubo | under_review | approved | rejected |
//                     paused | offboarded
export type BridgeCustomerStatus =
  | "active"
  | "awaiting_questionnaire"
  | "awaiting_ubo"
  | "incomplete"
  | "not_started"
  | "offboarded"
  | "paused"
  | "rejected"
  | "under_review";

export type BridgeKycStatus =
  | "not_started"
  | "incomplete"
  | "awaiting_questionnaire"
  | "awaiting_ubo"
  | "under_review"
  | "approved"
  | "rejected"
  | "paused"
  | "offboarded";

/** Collapse any Bridge customer/KYC status onto Talise's OnrampKycStatus. */
export function mapBridgeKycStatus(
  s: BridgeCustomerStatus | BridgeKycStatus | string | undefined
): OnrampKycStatus {
  switch (s) {
    case "active":
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "offboarded":
      return "expired";
    case "not_started":
    case undefined:
      return "unverified";
    // incomplete / under_review / awaiting_* / paused → still in flight
    default:
      return "pending";
  }
}

export type BridgeKycLink = {
  id: string;
  customer_id: string | null;
  full_name?: string;
  email: string;
  type: "individual" | "business";
  kyc_link: string;
  tos_link: string;
  kyc_status: BridgeKycStatus;
  tos_status: "pending" | "approved";
  created_at: string;
};

/**
 * Create a hosted KYC + ToS link. `endorsements` requests the products to
 * enable on approval (we don't need a specific one for plain on/off-ramp, but
 * Bridge accepts e.g. `["base"]`). `redirectUri` is where Bridge sends the
 * user back after completing the flow.
 */
export async function createKycLink(input: {
  email: string;
  fullName?: string;
  type?: "individual" | "business";
  redirectUri?: string;
  /** Stable Talise-owned key (e.g. `kyc-<userId>`) for idempotent retries. */
  idempotencyKey: string;
}): Promise<BridgeKycLink> {
  return bridgeFetch<BridgeKycLink>("kyc_links", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      email: input.email,
      type: input.type ?? "individual",
      ...(input.fullName ? { full_name: input.fullName } : {}),
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
    },
  });
}

/** Poll a KYC link's status (kyc_status + tos_status + linked customer_id). */
export async function getKycLink(id: string): Promise<BridgeKycLink> {
  return bridgeFetch<BridgeKycLink>(`kyc_links/${encodeURIComponent(id)}`);
}

export type BridgeCustomer = {
  id: string;
  status: BridgeCustomerStatus;
  type: "individual" | "business";
  email?: string;
  first_name?: string;
  last_name?: string;
  client_reference_id?: string;
  created_at?: string;
};

/** Fetch a customer (e.g. to refresh status after a webhook). */
export async function getCustomer(id: string): Promise<BridgeCustomer> {
  return bridgeFetch<BridgeCustomer>(`customers/${encodeURIComponent(id)}`);
}

/**
 * Direct individual-customer create. Requires a `signedAgreementId` from the
 * ToS flow before the customer can transact. Prefer `createKycLink` for the
 * hosted path; this exists for flows that collect PII in-app.
 */
export async function createCustomer(input: {
  firstName: string;
  lastName: string;
  email: string;
  signedAgreementId: string;
  /** ISO 3166-1 alpha-3 (Bridge uses 3-letter country codes). */
  residentialAddress?: {
    street_line_1: string;
    city: string;
    subdivision?: string;
    postal_code: string;
    country: string;
  };
  birthDate?: string;
  clientReferenceId?: string;
  idempotencyKey: string;
}): Promise<BridgeCustomer> {
  return bridgeFetch<BridgeCustomer>("customers", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      type: "individual",
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      signed_agreement_id: input.signedAgreementId,
      ...(input.birthDate ? { birth_date: input.birthDate } : {}),
      ...(input.residentialAddress ? { residential_address: input.residentialAddress } : {}),
      ...(input.clientReferenceId ? { client_reference_id: input.clientReferenceId } : {}),
    },
  });
}
