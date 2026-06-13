import "server-only";

import { userBySuiAddress, deviceTokensForUser } from "@/lib/db";
import { sendInboundReceivedEmail } from "@/lib/email";
import { sendApnsPush } from "@/lib/apns";
import { CC, formatLocal, type Currency } from "@/lib/fx";

/**
 * Map a recipient's stored country (ISO alpha-2) to their display currency,
 * so the credit notification reads in the SAME currency they see in-app
 * (a Nigerian user gets "₦8,100 received", not "$5.00"). Inverts the
 * currency→country `CC` map; unknown / unset country falls back to USD.
 */
function currencyForCountry(country: string | null | undefined): Currency {
  const cc = (country ?? "").trim().toLowerCase();
  if (!cc) return "USD";
  for (const [cur, code] of Object.entries(CC)) {
    if (code === cc) return cur as Currency;
  }
  return "USD";
}

/** "caleb" / "caleb.sui" → "caleb@talise"; leaves real display names alone. */
function senderLabel(raw: string): string {
  const s = raw.trim();
  if (!s) return "someone on Talise";
  if (/^[a-z0-9_.-]{3,}$/i.test(s) && !s.includes("@") && !s.includes(" ")) {
    return `${s.replace(/\.sui$/i, "").replace(/\.talise$/i, "")}@talise`;
  }
  return s;
}

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
        // Currency-aware, amount-forward copy matching what they see in-app.
        // The app NAME ("Talise") + app ICON render as the notification
        // header automatically, so the title leads with the money.
        const currency = currencyForCountry(recipient.country);
        const amountText = formatLocal(input.amountUsd, currency); // "₦8,100"
        const title = `${amountText} received`;
        const pbody = `from ${senderLabel(input.senderName)}`;
        await Promise.all(
          tokens.map((t) =>
            sendApnsPush(t, {
              title,
              body: pbody,
              threadId: "talise-credit",
              category: "TALISE_CREDIT",
              interruptionLevel: "active",
              relevanceScore: 1,
              mutableContent: true,
              data: { kind: "credit", route: "activity", amountUsd: input.amountUsd },
            }).then((r) => {
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
