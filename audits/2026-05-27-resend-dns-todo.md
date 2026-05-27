# Resend DNS records to add for talise.io

Date: 2026-05-27
Owner: Talise founder
Registrar: wherever talise.io is hosted (see WHOIS)

The provided `RESEND_API_KEY` is restricted to send-only, so this agent
could not call `GET /domains` or `POST /domains` to fetch the exact
DNS records Resend wants. The records below are Resend's standard set
for a freshly added apex domain. Once you log into the Resend
dashboard at https://resend.com/domains and click "Add domain" for
`talise.io`, Resend will print the same records with concrete values
(specifically the DKIM CNAME target and the `_resend` verification TXT
token will be unique to your account). Copy those values from the
dashboard into your DNS provider verbatim. Hit "Verify" in Resend
after the records propagate (usually a few minutes, up to 24 hours).
Once `talise.io` shows as `verified`, change `WAITLIST_FROM_EMAIL` to
`waitlist@talise.io` in production and re-run the waitlist confirmation
send.

The waitlist confirmation email could NOT be delivered to
`rolandojude18@gmail.com` because the recipient is not the Resend
account owner (`odigie2004@gmail.com`) and the sender domain is
unverified. Resend's sandbox sender (`onboarding@resend.dev`) only
delivers to the account owner address while the workspace is in test
mode. Verify the domain to unblock sends to anyone.

## Records to add at your DNS provider

| Type  | Name (host)                          | Value                                                                 | Status   |
|-------|--------------------------------------|------------------------------------------------------------------------|----------|
| TXT   | `_resend.talise.io`                  | `resend-verify=<token-from-resend-dashboard>`                          | missing  |
| TXT   | `send.talise.io`                     | `v=spf1 include:amazonses.com ~all`                                    | missing  |
| MX    | `send.talise.io`                     | `feedback-smtp.us-east-1.amazonses.com` (priority `10`)                | missing  |
| CNAME | `resend._domainkey.talise.io`        | `resend._domainkey.<region>.amazonses.com` (region from dashboard)     | missing  |
| TXT   | `_dmarc.talise.io`                   | `v=DMARC1; p=none; rua=mailto:dmarc@talise.io`                         | present, weak |

Notes:

- The exact `_resend` token, the DKIM CNAME target, and the SES region
  (`us-east-1` vs `eu-west-1` etc) are all unique per Resend project.
  Pull them from the Resend dashboard, not from this file.
- If `talise.io` already has an SPF record at the apex (`v=spf1 ...`),
  do NOT add a second one. Instead, merge `include:_spf.resend.com`
  (or whatever Resend prints) into the existing apex record. Two SPF
  records at the same name make BOTH fail.
- `_dmarc.talise.io` already exists with `p=none`. Once SPF and DKIM
  are green, tighten it to `p=quarantine` and add a `rua=` reporting
  mailbox so you can see who is spoofing the domain.
- `https://talise.io/coming-soon-hero.png` and
  `https://talise.io/litepaper` must be reachable in production for
  the email to render and the CTA to land.

## Verification checks (run after adding records)

```bash
dig +short TXT _resend.talise.io
dig +short CNAME resend._domainkey.talise.io
dig +short TXT send.talise.io
dig +short MX send.talise.io
dig +short TXT _dmarc.talise.io
```

Each should resolve to the values Resend printed. Then in the Resend
dashboard, click "Verify DNS Records" against `talise.io`. Status
should flip from `pending` to `verified` within 5 minutes once the
records propagate.

## After verification

1. Confirm `WAITLIST_FROM_EMAIL=waitlist@talise.io` is set on Vercel
   production (it already is locally).
2. Manually re-run the test send to `rolandojude18@gmail.com` (script
   at `/tmp/talise-test-send.mjs`) but change the `FROM` constant from
   `Talise <onboarding@resend.dev>` to `Talise <waitlist@talise.io>`.
3. Update the waitlist row to record the new `confirmation_sent_at`
   and `confirmation_message_id`.
