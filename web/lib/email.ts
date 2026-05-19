import { Resend } from "resend";
import {
  welcomeWithAddressHtml,
  welcomeEmailOnlyHtml,
  type WelcomeData,
} from "./emails/welcome";

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
      replyTo: process.env.EMAIL_REPLY_TO,
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
