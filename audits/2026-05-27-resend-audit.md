# Talise waitlist + Resend audit

Date: 2026-05-27
Auditor: Claude (read-only)
Repo: /Users/eromonseleodigie/Talise/web
Branch: main (commit b7508b5)

## 1. Executive summary

- BLOCKER: Resend is not configured for production. The `RESEND_API_KEY`
  value is empty in `web/.env.local`, Resend's `/v1/domains` rejects the
  key as invalid, and no Resend/email/waitlist env vars are set on
  Vercel production. No DKIM record exists in the public DNS for
  `resend._domainkey.talise.io`, so even with a key the talise.io domain
  cannot pass DKIM in Resend's eyes.
- Code path is structurally sound. `lib/email.ts` degrades to a
  `dev-noop` when the key is missing, the React Email template renders
  with the on-brand dark palette plus the `#79D96C` accent, and the
  route always 200s after the DB upsert so a Resend outage does not
  poison the funnel. Two P2 issues found (no retry on transient send
  failure, no retry on the `confirmation_sent_at` UPDATE).
- Operational hygiene is clean. `.env`, `.env.local`, and `.env.vercel`
  are all gitignored and not tracked in git. No leaked Resend keys
  found in tracked files or in a `_scratch/` directory (none exists).
  `resend` is on a caret range (`^4.8.0`); acceptable but flagged as P3
  to pin for a transactional-mail dependency.

## 2. Domain and DNS status

### Resend API check

Direct call to `https://api.resend.com/domains` using the value of
`RESEND_API_KEY` from `web/.env.local`:

```
{
    "statusCode": 400,
    "message": "API key is invalid",
    "name": "validation_error"
}
```

Inspecting the env file (without echoing the secret) confirms the value
is empty:

```
RESEND_API_KEY = <EMPTY>
```

So we cannot enumerate domains, records, region, or status via the
Resend API right now. BLOCKER P0: populate `RESEND_API_KEY` locally and
on Vercel production.

### Public DNS evidence (dig)

```
$ dig +short TXT talise.io
(empty)

$ dig +short CNAME resend._domainkey.talise.io
(empty)

$ dig +short TXT _dmarc.talise.io
"v=DMARC1; p=none;"

$ dig +short TXT _resend.talise.io
(empty)

$ dig +short MX send.talise.io
(empty)

$ dig +short TXT send.talise.io
(empty)

$ dig +short A talise.io
216.198.79.1
```

What this means:

- SPF: missing. `talise.io` has no `v=spf1` TXT record at the apex. Any
  mail sent through Resend from `@talise.io` will lack a passing SPF.
  BLOCKER P0.
- DKIM: missing. `resend._domainkey.talise.io` resolves to nothing.
  Resend cannot sign mail for `talise.io`, so messages will arrive
  unsigned, likely landing in spam or being rejected. BLOCKER P0.
- DMARC: present but `p=none` and no `rua`/`ruf` reporting addresses.
  Permissive enough to not bounce mail, but provides no enforcement and
  no visibility. P2.
- `_resend.talise.io` verification TXT (used by Resend's domain
  ownership check): missing. P0 if Resend currently expects it.

### Apparent FROM-domain mismatch

`lib/email.ts:21` defaults to `Talise <onboarding@resend.dev>` for
generic mail, but `lib/email.ts:99-100` uses `WAITLIST_FROM_EMAIL`
(default `Talise <waitlist@talise.io>`) for the waitlist confirmation.
With no DKIM/SPF for `talise.io`, the waitlist mail will fail DMARC
alignment at most receivers. BLOCKER P0.

## 3. Code-path findings

### `web/lib/email.ts`

- L10-L18: `client()` lazily instantiates Resend and returns `null`
  when `RESEND_API_KEY` is missing. Good.
- L31-L38: generic `send()` has a clean `dev-noop` path that logs and
  returns `{ ok: true, id: "dev-noop" }` instead of throwing. Good.
- L86-L125: `sendWaitlistConfirmation` mirrors the dev-noop path at
  L103-L109. Good. Returns `{ ok, id }` or `{ ok, reason }` for the
  caller to persist.
- L21: `from()` falls back to `Talise <onboarding@resend.dev>`. The
  generic helper is fine, but anything emitted from `onboarding@resend.dev`
  bypasses talise.io DKIM/SPF entirely. Acceptable for transactional
  user-facing welcome mail only if the founder is OK with the resend.dev
  reply-to surface area. P2.
- L45 and L117: `replyTo: process.env.EMAIL_REPLY_TO`. Good, but the
  waitlist path uses `EMAIL_REPLY_TO` rather than `WAITLIST_REPLY_TO`
  (which is set in `.env.local`). Inconsistency. The route never reads
  `WAITLIST_REPLY_TO` anywhere. P2 bug.
- No retry on transient 5xx from Resend. A single failure ends the
  send. P2.

### `web/emails/WaitlistConfirmation.tsx`

- Renders via `@react-email/components`. JSX is well-formed; no
  unresolved props or missing imports observed.
- Palette matches brand: bg `#0A0A0A`, surface `#111111`, accent
  `#79D96C` (L34-L42).
- Typography: system stack, 28px heading with `-0.02em` letter-spacing,
  15px body. On-brand.
- Hero image: `${appUrl}/coming-soon-hero.png` at L48 and L82. This is
  an absolute URL fetched from the public Next.js folder. Required for
  email rendering (CIDs are not used). Verify
  `https://talise.io/coming-soon-hero.png` is publicly reachable in
  production. P2 risk if the asset is moved or 404s.
- Litepaper CTA at L168-L185 links to `${appUrl}/litepaper`. Same
  caveat: confirm route exists in prod.
- No em-dashes in the template copy. Confirmed.
- One CTA only. Confirmed.
- The footer at L233 says "Reply to this email to remove yourself" but
  the send-path uses `EMAIL_REPLY_TO`, not `WAITLIST_REPLY_TO`. If the
  reply-to value is wrong or unset, the unsubscribe pathway breaks
  silently. P1 once mail is flowing.

### `web/app/api/waitlist/route.ts`

- L28: email regex is intentionally loose; OK for marketing capture.
- L60-L78: malformed JSON or invalid email returns 400. Good.
- L88-L102: UPSERT on `(email)` happens BEFORE the email send. Resend
  failure does NOT roll back the row. The row is captured no matter
  what, which is the right design.
- L106-L116: idempotency check on `confirmation_sent_at`. Good.
- L121-L150: fire-and-forget IIFE. The inner try/catch at L122-L149
  logs both the `{ ok: false }` path and the throw path via
  `console.warn`. Errors are NOT silently dropped, but they ARE
  unreachable to the client (correct for fire-and-forget).
- L128-L133: on success, UPDATEs `confirmation_sent_at` and
  `confirmation_message_id`. No retry on this UPDATE either. If the DB
  hiccups here, the row is marked-as-sent inside Resend but our DB
  still shows `confirmation_sent_at = NULL`, which means a re-POST
  would resend the email. P2 (duplicate-send risk on DB flap).
- L155-L161: 500 on DB failure with a generic message. Good.

### Hardcoded test addresses

None found in `lib/email.ts`, `emails/WaitlistConfirmation.tsx`, or
`app/api/waitlist/route.ts`.

## 4. Race conditions and error handling

- The `void (async () => {...})()` IIFE at `app/api/waitlist/route.ts:121`
  is properly wrapped in try/catch and uses `console.warn` for both
  failure modes. Errors are captured to the logs, not silently
  swallowed. OK.
- Race window: between the idempotency SELECT (L106) and the UPDATE on
  success (L128-L133), a concurrent POST for the same email could fire
  a second send. The UPSERT is single-row safe, but the
  fire-and-forget UPDATE is not transactional with the send. P2.
- No retry policy on:
  1. Resend transient 5xx (`lib/email.ts:40-52` and `:111-124` simply
     map any throw to `{ ok: false }`).
  2. The `UPDATE waitlist SET confirmation_sent_at` query
     (`route.ts:128-133`). A flake here causes the message to be sent
     successfully but the DB to forget, which permits a duplicate send
     on the next POST.
- Background task lifecycle on Vercel: a fire-and-forget IIFE inside a
  Node.js Vercel Function may be cut off when the response returns,
  unless `waitUntil` is used. Next.js 15 on Node runtime usually keeps
  the function alive long enough for short tasks, but a slow Resend
  call could be truncated. P2; consider `unstable_after` from
  Next.js 15 or `ctx.waitUntil` on Edge.

## 5. Vercel env state (snapshot)

Snapshot 1 at audit start, project `suilance-s-projects/talise-main`:
no `RESEND_API_KEY`, no `EMAIL_*`, no `WAITLIST_*` variables in any
environment. 29 other variables present (Google OAuth, Sui, Shinami,
Memwal, DB, session, ZG, etc).

Snapshot 2 after a 30s gap: identical. The parallel sender agent has
not (yet) pushed Resend env vars into Vercel production.

Implication: a production redeploy right now would take the `dev-noop`
code path at `lib/email.ts:32-38` and `:103-109`. No real mail would
be sent. BLOCKER P0 to fix before announcing the waitlist.

## 6. Operational hygiene checklist

- [x] `RESEND_API_KEY` not in `web/.env`. Confirmed (only NEXT_PUBLIC,
      Google, DB, session, Sui, Memwal vars there).
- [x] `web/.env.local` is gitignored. `git check-ignore .env.local`
      returns `.env.local`. Also not tracked
      (`git ls-files --error-unmatch` errors with `did not match any
      file(s)`).
- [x] `web/.env` and `web/.env.vercel` are also gitignored.
- [x] No `_scratch/` directory exists in `web/`.
- [x] No stale Resend keys found in tracked files. `grep` for
      `re_[a-zA-Z0-9_]{8,}` across `*.ts/tsx/json/md/.env*` returned
      only documentation placeholders (`re_...` in README).
- [ ] `resend` is pinned to `^4.8.0` in `package.json` (caret range).
      P3: consider exact pin or `~` for a security-sensitive dep.
- [ ] `RESEND_API_KEY` value in `.env.local` is empty. Either set it or
      remove the empty placeholder so the dev-noop path is taken
      explicitly.

## 7. Recommended fixes (priority order)

### P0 (blocks production launch)

1. Populate `RESEND_API_KEY` locally (`web/.env.local`) and on Vercel
   production: `vercel env add RESEND_API_KEY production`. Also add
   `WAITLIST_FROM_EMAIL`, `EMAIL_REPLY_TO`, `NEXT_PUBLIC_APP_URL`
   (per `RESEND-SETUP.md` steps 6-9).
2. Publish the Resend-issued DNS records for `talise.io` at the
   registrar:
   - SPF TXT at apex (or merge `include:_spf.resend.com` into existing
     SPF if any),
   - DKIM CNAME at `resend._domainkey.talise.io`,
   - Resend's verification TXT (typically `_resend.talise.io`),
   - MX/TXT for `send.talise.io` if Resend's onboarding requests them.
3. Verify the domain in the Resend dashboard. Until it shows
   "verified", any send from `@talise.io` will fail DMARC alignment.

### P1

4. Bring `WAITLIST_REPLY_TO` into the send. Either rename
   `lib/email.ts:117` to use `WAITLIST_REPLY_TO ?? EMAIL_REPLY_TO`, or
   drop `WAITLIST_REPLY_TO` from `.env.local`. Currently it is set but
   never read.
5. Confirm `https://talise.io/coming-soon-hero.png` and
   `https://talise.io/litepaper` are reachable in production. Both are
   referenced by the email template.

### P2

6. Add retry-with-backoff (e.g. 3 tries, 1s/3s/10s) around the Resend
   send for transient 5xx in both `send()` and
   `sendWaitlistConfirmation`.
7. Retry the post-send `UPDATE waitlist SET confirmation_sent_at`
   on transient DB errors, to avoid double-sends after a DB flap.
8. Wrap the fire-and-forget IIFE in `app/api/waitlist/route.ts:121`
   with `after()` from `next/server` (Next.js 15) so the runtime is
   guaranteed to wait for the Resend call before tearing the function
   down.
9. Tighten DMARC: move from `p=none` to at least `p=quarantine` once
   SPF + DKIM are green, and add `rua=mailto:dmarc@talise.io` so we
   actually see who is spoofing the domain.

### P3

10. Pin `resend` exactly (`"resend": "4.8.0"`) or use a narrow `~4.8`
    range. Same for `@react-email/components` and
    `@react-email/render`. A surprise minor in a transactional-mail
    SDK is a foot-gun we do not need.
11. Remove the empty `RESEND_API_KEY=` line from `.env.local` so the
    intent (dev-noop) is explicit and not "looks set but blank".

---

End of audit.
