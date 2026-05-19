# Talise — Web (waitlist phase)

Next.js 15 + Tailwind v4 + libSQL + Google OAuth + Sui zkLogin address derivation.

The landing page at `/` is a kyoso-style moodboard. Users sign in with Google → we derive a deterministic Sui address using `@mysten/zklogin` → we store `{google_sub, email, sui_address, salt, …}` in SQLite. On launch day, signing in with the same Google account regenerates the exact same Sui address.

## Quickstart

```bash
cd /Users/eromonseleodigie/Talise/web
pnpm install        # or: npm install / bun install
cp .env.example .env.local
# fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET
pnpm dev
# → http://localhost:3000
```

If you don't have pnpm: `npm i -g pnpm` or use `npm` / `bun`.

## Setting up Google OAuth (web client)

The Cible iOS client won't work here — iOS OAuth clients are bound to a bundle ID. Create a separate Web client:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized JavaScript origins:
   - `http://localhost:3000`
   - `https://talise.io` (once deployed)
5. Authorized redirect URIs:
   - `http://localhost:3000/auth/callback`
   - `https://talise.io/auth/callback`
6. Save → copy client ID and client secret into `.env.local`

Generate a session signing secret:

```bash
openssl rand -base64 32   # paste into SESSION_SECRET
```

## File map

```
web/
├── app/
│   ├── page.tsx                       Landing (moodboard + hero CTA)
│   ├── layout.tsx                     Fonts + global styles
│   ├── globals.css                    Tailwind v4 theme tokens
│   ├── joined/page.tsx                Post-signup: shows derived Sui address
│   ├── auth/
│   │   ├── login/route.ts             Redirects to Google with CSRF state
│   │   └── callback/route.ts          Exchanges code → derives address → writes DB
│   └── api/waitlist/
│       ├── count/route.ts             Public total counter
│       └── email/route.ts             Email-only fallback POST
├── components/
│   ├── Pill.tsx                       "742 already inside" counter pill
│   ├── MoodboardCollage.tsx           Scattered tile collage (kyoso-style)
│   ├── HeroCTA.tsx                    Google button + email fallback
│   └── CopyAddress.tsx                Copy-to-clipboard for Sui address
├── lib/
│   ├── db.ts                          libSQL client + waitlist schema
│   ├── auth.ts                        Google OAuth helpers + HMAC sign/verify
│   ├── session.ts                     Cookie-backed sessions
│   └── zklogin.ts                     Salt gen + jwtToAddress wrapper
└── .data/waitlist.db                  Local SQLite file (gitignored)
```

## How the signup flow works

1. User clicks **Continue with Google** → `GET /auth/login`
2. We generate a random CSRF state, set httpOnly cookie, redirect to Google
3. Google returns to `/auth/callback?code=…&state=…`
4. We verify state, exchange code for an `id_token` JWT via Google
5. We decode the JWT, generate a 16-byte salt
6. We call `jwtToAddress(jwt, salt)` from `@mysten/zklogin` → Sui address
7. We upsert `{google_sub, email, name, picture, sui_address, salt}` into SQLite (idempotent on `google_sub`)
8. We set a long-lived session cookie with the entry ID
9. Redirect to `/joined` which renders the derived Sui address

**Idempotency:** if the same Google account signs in twice, we return the existing row — the address is stable forever per Google account.

**Email-only fallback:** users without Google (China, parts of Russia) can drop a plain email via the inline form. Stored in a separate table; no address derived.

## Database

Local dev uses a SQLite file at `.data/waitlist.db` (auto-created on first request). The schema is created lazily on first DB access via `ensureSchema()`.

To inspect:
```bash
sqlite3 .data/waitlist.db ".tables"
sqlite3 .data/waitlist.db "SELECT id, email, sui_address FROM waitlist;"
```

To reset:
```bash
pnpm db:reset
```

### Production (Vercel + Turso)

Vercel functions are stateless, so the local SQLite file won't persist. Swap to Turso (zero code change):

1. `turso db create talise-waitlist`
2. `turso db show talise-waitlist --url` → set `DATABASE_URL=libsql://…`
3. `turso db tokens create talise-waitlist` → set `DATABASE_AUTH_TOKEN=…`
4. Push env vars to Vercel; redeploy.

## Counter pill anchoring

`app/page.tsx` adds `742` as a soft-start anchor on top of real counts:

```ts
const displayCount = count + 742;
```

Drop this to `+ 0` (or whatever real number) once organic joins are flowing.

## Moodboard images

`components/MoodboardCollage.tsx` exports a `TILES` array. Each tile has `src`, position, dimensions, and rotation. Currently using Unsplash CDN URLs as placeholders. To curate:

- Replace each `src` with a Higgsfield/Midjourney generation or a hand-picked Unsplash photo ID
- Aim for: gold textures, EM currencies, prism/refraction, market scenes, ledger/passbook
- Keep grayscale 25% + warm tint for cohesion (already applied via `.tile` CSS class)

See `docs/WAITLIST_DESIGN.md` (sibling doc, top-level) for the full image brief.

## Welcome emails (Resend)

Every successful signup triggers a transactional welcome email via [Resend](https://resend.com). Two templates live in `lib/emails/welcome.ts`:

| Template | Sent when | Content |
|---|---|---|
| `welcomeWithAddressHtml` | User finishes Google sign-in | Position #, Sui address, Suiscan link, share button |
| `welcomeEmailOnlyHtml` | User submits the email-only fallback | Position #, CTA to come back and "Claim your Sui address" |

### Setup

1. Sign up at [resend.com](https://resend.com), grab an API key.
2. Add to `.env.local`:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=Talise <onboarding@resend.dev>
   EMAIL_REPLY_TO=hello@talise.io
   ADMIN_TOKEN=$(openssl rand -hex 16)
   ```
3. Until you verify the `talise.io` domain at [resend.com/domains](https://resend.com/domains), keep `EMAIL_FROM` as `onboarding@resend.dev` (works out of the box). Once verified, change to `Talise <hello@talise.io>`.

### How it works

- Sends are **fire-and-forget** via Next.js `after()` — the response redirects/200s instantly; email goes out after.
- Each entry has a `notified_at` column; we only send once per entry.
- Without `RESEND_API_KEY` set, the lib logs to stdout in dev (no crash):
  ```
  [email/dev] would send to=sofia@x.test subject="…" (4904 bytes)
  ```

### Preview the templates

```bash
node --experimental-strip-types scripts/preview-emails.mjs
open .data/preview-welcome-with-address.html
open .data/preview-welcome-email-only.html
```

### Re-send manually

```bash
curl -X POST http://localhost:3000/api/admin/resend \
  -H "x-talise-admin: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table":"waitlist","id":1}'

# email-only path
curl -X POST http://localhost:3000/api/admin/resend \
  -H "x-talise-admin: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table":"waitlist_email_only","id":1}'
```

## Type-checking

```bash
pnpm exec tsc --noEmit
```

## Deploy to Vercel

```bash
vercel link
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REDIRECT_URI    # https://talise.io/auth/callback
vercel env add SESSION_SECRET
vercel env add DATABASE_URL           # libsql://… for prod
vercel env add DATABASE_AUTH_TOKEN
vercel --prod
```

Point `talise.io` apex DNS at Vercel (`A 76.76.21.21` or the recommended CNAME `cname.vercel-dns.com`).

## Security notes

- Session and OAuth state cookies are HMAC-signed; tampering invalidates them
- `secure: true` on cookies in production
- We never verify the JWT signature because we get it directly from Google's token endpoint over TLS — no user-submitted JWT path exists
- We verify `aud` matches our `GOOGLE_CLIENT_ID` to reject mismatched tokens
- CSRF protected via state cookie comparison
- Salts are random per-account; never reuse across users
- Production: swap `SESSION_SECRET` to a fresh value; rotate yearly
