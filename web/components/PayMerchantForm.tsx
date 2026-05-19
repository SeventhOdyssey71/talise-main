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
}: {
  senderAddress: string;
  recipientAddress: string;
  merchantName: string;
  presetAmount: string;
  presetMemo: string;
  invoiceSlug?: string | null;
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
    />
  );
}
