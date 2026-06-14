import "server-only";

import {
  bridgeFetch,
  BRIDGE_SUI_RAIL,
  BRIDGE_USDSUI_CURRENCY,
} from "./client";
import type { BridgeFiatCurrency, BridgeTransfer } from "./onramp";

/**
 * Bridge OFF-RAMP: USDsui on Sui → fiat to the user's bank.
 *
 * Two primitives:
 *   1. External Account — register the payout bank account (US ACH or
 *      SEPA/IBAN). Returns an `id` used below.
 *   2. Liquidation Address — a PERSISTENT Sui address bound to that external
 *      account. Any USDsui the user sends there is auto-converted and paid out
 *      as fiat. This is the clean cash-out UX: Talise shows the user one
 *      address; sending USDsui to it lands fiat in their bank. Settlement
 *      arrives as `liquidation_address.drain.*` webhooks.
 *
 * For a one-off cash-out without a persistent address, `createOfframpTransfer`
 * returns a single-use Sui deposit address instead.
 *
 * Fiat destinations: USD (ACH/wire), EUR (SEPA), GBP (Faster Payments). NOT
 * NGN — Nigerian payout stays on Linq.
 */

// ── External accounts (payout bank) ──────────────────────────────────

export type BridgeExternalAccount = {
  id: string;
  customer_id: string;
  currency: string;
  account_owner_name: string;
  account_type: string;
  active: boolean;
};

/** Register a US ACH payout account. */
export async function createUsAchExternalAccount(input: {
  customerId: string;
  accountOwnerName: string;
  accountNumber: string;
  routingNumber: string;
  checkingOrSavings?: "checking" | "savings";
  bankName?: string;
  address?: {
    street_line_1: string;
    city: string;
    state: string;
    postal_code: string;
    country: string; // ISO alpha-3, e.g. "USA"
  };
  idempotencyKey: string;
}): Promise<BridgeExternalAccount> {
  return bridgeFetch<BridgeExternalAccount>(
    `customers/${encodeURIComponent(input.customerId)}/external_accounts`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        currency: "usd",
        account_type: "us",
        account_owner_name: input.accountOwnerName,
        ...(input.bankName ? { bank_name: input.bankName } : {}),
        account: {
          account_number: input.accountNumber,
          routing_number: input.routingNumber,
          checking_or_savings: input.checkingOrSavings ?? "checking",
        },
        ...(input.address ? { address: input.address } : {}),
      },
    }
  );
}

/** Register a SEPA / IBAN payout account (EUR). */
export async function createIbanExternalAccount(input: {
  customerId: string;
  accountOwnerName: string;
  firstName: string;
  lastName: string;
  iban: string;
  bic: string;
  country: string; // ISO alpha-3
  bankName?: string;
  address?: {
    street_line_1: string;
    city: string;
    postal_code: string;
    country: string;
  };
  idempotencyKey: string;
}): Promise<BridgeExternalAccount> {
  return bridgeFetch<BridgeExternalAccount>(
    `customers/${encodeURIComponent(input.customerId)}/external_accounts`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        currency: "eur",
        account_type: "iban",
        account_owner_type: "individual",
        account_owner_name: input.accountOwnerName,
        first_name: input.firstName,
        last_name: input.lastName,
        ...(input.bankName ? { bank_name: input.bankName } : {}),
        iban: { account_number: input.iban, bic: input.bic, country: input.country },
        ...(input.address ? { address: input.address } : {}),
      },
    }
  );
}

// ── Liquidation address (persistent USDsui → fiat cash-out) ───────────

export type BridgeLiquidationAddress = {
  id: string;
  /** The persistent Sui address the user sends USDsui to. */
  address: string;
  chain: string;
  currency: string;
  state: string;
  destination_payment_rail?: string;
  destination_currency?: string;
  external_account_id?: string;
};

/**
 * Create a persistent USDsui-on-Sui liquidation address that pays out to
 * `externalAccountId` in `destinationCurrency` over `destinationPaymentRail`
 * (e.g. ach / sepa / faster_payments). The returned `address` is what Talise
 * shows the user to cash out — USDsui in, fiat to their bank out.
 */
export async function createSuiLiquidationAddress(input: {
  customerId: string;
  externalAccountId: string;
  destinationPaymentRail: string;
  destinationCurrency: BridgeFiatCurrency;
  /** Optional Talise fee override, string percent. */
  customDeveloperFeePercent?: string;
  idempotencyKey: string;
}): Promise<BridgeLiquidationAddress> {
  return bridgeFetch<BridgeLiquidationAddress>(
    `customers/${encodeURIComponent(input.customerId)}/liquidation_addresses`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        chain: BRIDGE_SUI_RAIL,
        currency: BRIDGE_USDSUI_CURRENCY,
        external_account_id: input.externalAccountId,
        destination_payment_rail: input.destinationPaymentRail,
        destination_currency: input.destinationCurrency,
        ...(input.customDeveloperFeePercent
          ? { custom_developer_fee_percent: input.customDeveloperFeePercent }
          : {}),
      },
    }
  );
}

/** List a customer's liquidation addresses (reuse an existing one per corridor). */
export async function listLiquidationAddresses(
  customerId: string
): Promise<{ data: BridgeLiquidationAddress[] }> {
  return bridgeFetch<{ data: BridgeLiquidationAddress[] }>(
    `customers/${encodeURIComponent(customerId)}/liquidation_addresses`
  );
}

/**
 * One-off off-ramp transfer: returns a single-use Sui deposit address
 * (`source_deposit_instructions.to_address`) the user sends `amount` USDsui to;
 * Bridge pays out fiat to `externalAccountId`. Use a liquidation address
 * instead for a persistent cash-out address.
 */
export async function createOfframpTransfer(input: {
  customerId: string;
  amount: string; // USDsui units, decimal string
  externalAccountId: string;
  destinationPaymentRail: string;
  destinationCurrency: BridgeFiatCurrency;
  developerFee?: string;
  idempotencyKey: string;
  dryRun?: boolean;
}): Promise<BridgeTransfer> {
  return bridgeFetch<BridgeTransfer>("transfers", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      on_behalf_of: input.customerId,
      amount: input.amount,
      ...(input.developerFee ? { developer_fee: input.developerFee } : {}),
      ...(input.dryRun ? { dry_run: true } : {}),
      source: { payment_rail: BRIDGE_SUI_RAIL, currency: BRIDGE_USDSUI_CURRENCY },
      destination: {
        payment_rail: input.destinationPaymentRail,
        currency: input.destinationCurrency,
        external_account_id: input.externalAccountId,
      },
    },
  });
}
