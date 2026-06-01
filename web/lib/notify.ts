import "server-only";

import { userBySuiAddress, deviceTokensForUser } from "@/lib/db";
import { sendInboundReceivedEmail } from "@/lib/email";
import { sendApnsPush } from "@/lib/apns";

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

    // Push (APNs) — fire to every registered device. No-ops cleanly when APNs
    // isn't configured (sendApnsPush returns { skipped: true }).
    try {
      const tokens = await deviceTokensForUser(recipient.id);
      if (tokens.length > 0) {
        const title = "Money received";
        const pbody = `${input.senderName} sent you $${input.amountUsd.toFixed(2)}`;
        await Promise.all(
          tokens.map((t) =>
            sendApnsPush(t, { title, body: pbody }).then((r) => {
              if (!r.ok && !r.skipped) {
                console.warn(
                  `[notify] apns push failed token=${t.slice(0, 8)}…: ${r.reason}`
                );
              }
            })
          )
        );
      }
    } catch (e) {
      console.warn(`[notify] push leg failed: ${(e as Error).message}`);
    }
  } catch (e) {
    console.warn(
      `[notify] inbound settlement notify failed: ${(e as Error).message}`
    );
  }
}
