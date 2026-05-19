import { getUsdsuiBalance } from "@/lib/sui";
import { SendForm } from "./SendForm";

/**
 * Server wrapper that fetches the payer's balances and pre-fills the SendForm
 * with the locked merchant recipient. Renders inside /p/[handle].
 */
export async function PayMerchantForm({
  senderAddress,
  recipientAddress,
  merchantName,
  presetAmount,
  presetMemo,
  invoiceSlug,
  paymentRegistryId,
}: {
  senderAddress: string;
  recipientAddress: string;
  merchantName: string;
  presetAmount: string;
  presetMemo: string;
  invoiceSlug?: string | null;
  /**
   * Merchant's PaymentRegistry object id (null in v1 — `lib/payment-kit.ts`
   * derives the global Talise registry deterministically).
   */
  paymentRegistryId?: string | null;
}) {
  const usdsui = await getUsdsuiBalance(senderAddress);

  return (
    <SendForm
      senderAddress={senderAddress}
      availableUsdsui={usdsui.usdsui}
      lockedRecipient={recipientAddress}
      merchantLabel={merchantName}
      presetAmount={presetAmount}
      presetMemo={presetMemo}
      invoiceSlug={invoiceSlug ?? undefined}
      paymentRegistryId={paymentRegistryId ?? null}
    />
  );
}
