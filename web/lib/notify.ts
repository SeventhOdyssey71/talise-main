import "server-only";

import { userBySuiAddress } from "@/lib/db";
import { sendInboundReceivedEmail } from "@/lib/email";

/**
 * Notify the RECIPIENT that an inbound transfer settled on chain.
 *
 * Fire-and-forget by contract: this NEVER throws — a notification failure
 * must never affect the send that already landed. Today it emails the
 * recipient via Resend; the push (APNs) leg hooks in here once device-token
 * registration + the Apple Push key are wired (see docs/hackathon/PLAN.md).
 *
 * The recipient is resolved from their Sui address; an external (non-Talise)
 * address resolves to null and is silently skipped.
 */
export async function notifyInboundSettlement(input: {
  recipientAddress: string;
  amountUsd: number;
  senderName: string;
}): Promise<void> {
  try {
    const recipient = await userBySuiAddress(input.recipientAddress);
    if (!recipient?.email) return; // external address, or no email on file

    const res = await sendInboundReceivedEmail({
      to: recipient.email,
      amountUsd: input.amountUsd,
      senderName: input.senderName,
    });
    if (!res.ok) {
      console.warn(
        `[notify] inbound email failed to=${recipient.email}: ${res.reason}`
      );
    }

    // TODO(push): once `device_token` registration (POST /api/devices/register)
    // and the APNs auth key (.p8 / key id / team id) are in env, look up this
    // recipient's device tokens and send an APNs push here.
  } catch (e) {
    console.warn(
      `[notify] inbound settlement notify failed: ${(e as Error).message}`
    );
  }
}
