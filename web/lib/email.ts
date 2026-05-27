import { Resend } from "resend";
import { render } from "@react-email/render";
import {
  welcomeWithAddressHtml,
  welcomeEmailOnlyHtml,
  type WelcomeData,
} from "./emails/welcome";
import { WaitlistConfirmation } from "../emails/WaitlistConfirmation";

let _resend: Resend | null = null;

function client(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

function from(): string {
  return process.env.EMAIL_FROM || "Talise <onboarding@resend.dev>";
}

type SendResult = { ok: true; id: string } | { ok: false; reason: string };

async function send(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const r = client();
  if (!r) {
    // Dev mode without Resend key — log and pretend success.
    console.log(
      `[email/dev] would send to=${opts.to} subject="${opts.subject}" (${opts.html.length} bytes)`
    );
    return { ok: true, id: "dev-noop" };
  }
  try {
    const res = await r.emails.send({
      from: from(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      replyTo: process.env.WAITLIST_REPLY_TO || process.env.EMAIL_REPLY_TO,
    });
    if (res.error) return { ok: false, reason: res.error.message };
    if (!res.data?.id) return { ok: false, reason: "no email id returned" };
    return { ok: true, id: res.data.id };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function sendWelcomeWithAddress(
  to: string,
  data: WelcomeData
): Promise<SendResult> {
  return send({
    to,
    subject: "You're in. Your Sui address is ready.",
    html: welcomeWithAddressHtml(data),
  });
}

export async function sendWelcomeEmailOnly(
  to: string,
  position: number
): Promise<SendResult> {
  return send({
    to,
    subject: "You're on the Talise waitlist.",
    html: welcomeEmailOnlyHtml(position),
  });
}

/**
 * Waitlist confirmation. Pulls `from` from WAITLIST_FROM_EMAIL (must be
 * a Resend-verified talise.io sender) and optionally BCCs ops via
 * WAITLIST_BCC_EMAIL. Renders the React Email template to HTML before
 * handing it to Resend.
 *
 * Returns the Resend message id on success so the caller can persist it
 * for traceability.
 */
export async function sendWaitlistConfirmation(opts: {
  to: string;
  name?: string | null;
}): Promise<SendResult> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "https://talise.io";

  const html = await render(
    WaitlistConfirmation({ name: opts.name ?? null, appUrl })
  );

  const fromAddr =
    process.env.WAITLIST_FROM_EMAIL || "Talise <waitlist@talise.io>";
  const bcc = process.env.WAITLIST_BCC_EMAIL?.trim();

  const r = client();
  if (!r) {
    console.log(
      `[email/dev] would send waitlist confirmation to=${opts.to} (${html.length} bytes)`
    );
    return { ok: true, id: "dev-noop" };
  }
  try {
    const res = await r.emails.send({
      from: fromAddr,
      to: [opts.to],
      ...(bcc ? { bcc: [bcc] } : {}),
      subject: "You are on the Talise waitlist.",
      html,
      replyTo: process.env.WAITLIST_REPLY_TO || process.env.EMAIL_REPLY_TO,
    });
    if (res.error) return { ok: false, reason: res.error.message };
    if (!res.data?.id) return { ok: false, reason: "no email id returned" };
    return { ok: true, id: res.data.id };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
