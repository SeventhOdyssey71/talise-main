# Frontend + Design

## Design tokens

Tokens live in `app/globals.css` inside Tailwind v4's `@theme { … }` block. There is no `tailwind.config.*` file — Tailwind v4 reads everything from CSS.

```css
@import "tailwindcss";

@theme {
  --color-bg:         #0a0e0b;   /* page background, deep near-black */
  --color-surface:    #131815;   /* raised tiles + cards */
  --color-surface-2:  #1b221e;   /* pressable surfaces, slight lift */
  --color-line:       #ffffff12; /* hairline borders, 7% white */
  --color-fg:         #f2f4f2;   /* primary text */
  --color-fg-muted:   #b9c0bb;   /* secondary text */
  --color-fg-dim:     #6f7872;   /* tertiary, labels, time */
  --color-accent:     #79d96c;   /* Talise green */
  --color-accent-soft:#2a2a2a;
  --color-danger:     #e08d8a;

  --font-sans:    "Google Sans Variable", …;
  --font-display: "Google Sans Variable", …;
  --font-mono:    var(--font-mono), "JetBrains Mono", …;
  --font-serif:   var(--font-serif), "Instrument Serif", …;
}
```

The palette mirrors the iOS app's `DesignSystem/Tokens.swift` so a screenshot from native and a screenshot from web look like the same product. `html, body` inherit `--color-bg` / `--color-fg` from the same stylesheet.

## Dark mode only

Talise is dark-first and stays that way. A previous refactor introduced a light-mode track; it was reverted. The only surviving light-mode hook is the `.light-page` class:

```css
.light-page {
  --color-bg: #ffffff; --color-fg: #0a0a0a;
  --color-accent: #0a0a0a; …
}
```

It exists so an editorial / press page can opt in by adding `class="light-page"` to its root, but no current page uses it. There is no system preference detection, no `prefers-color-scheme` query, no `data-theme` toggle.

## Tailwind v4 specifics

- Imported via `@import "tailwindcss";` (single CSS line, no JS config).
- The PostCSS plugin is `@tailwindcss/postcss` (`postcss.config.mjs`).
- Custom utilities are defined as plain CSS classes in `globals.css` (`talise-glass`, `talise-top-glow`, `talise-app-shell`, `talise-app-column`, `talise-history-row`).
- Inline colors use the `bg-[var(--color-surface-2)]` arbitrary-value form throughout. Components never hardcode hex.
- Animation lives in three places: `framer-motion` for component-level transitions, `gsap` for the landing scroll-triggered reveals (see `LandingMotion.tsx`, currently disabled on `/`), and CSS `transition` for hover/press affordances.

## Reusable components

`web/components/` is flat-ish. Key components:

### Mobile-style shell (`components/talise-app/`)

`AppShell.tsx` is the mobile-style page wrapper for the authed surface:

```
┌─ TopGlow (green horizon wash) ──┐
│ ┌── 480px column ─────────────┐ │
│ │ page content                │ │
│ └────────────────────────────┘  │
│            floating BottomNav   │
└─────────────────────────────────┘
```

CSS lives in `globals.css`: `.talise-app-shell` (full-viewport bg), `.talise-app-column` (max-width 480px, centered, padded), `.talise-top-glow` (radial green wash at `y: -60%`), and the `taliseGlass()` recipe (`.talise-glass`) — a black-on-blur card mirroring iOS's `taliseGlass()` ViewModifier.

`BalanceCard.tsx`, `HistoryRow.tsx`, and `BottomNav.tsx` are the building blocks. `HistoryRow` applies a directional press tint via `data-direction="sent|received|invest|withdraw"` and `--row-tint` color-mix.

### Sign-in

`components/SignInButton.tsx` is the only client component that triggers the OAuth dance. It calls `triggerOauthSignIn()` (which provisions the ephemeral keypair) and shows a "Preparing your wallet…" preloader (`SigninPreloader`) until the redirect fires.

### Marketing / landing

`components/Hero.tsx`, `components/FeatureRow.tsx`, `components/PersonaCards.tsx`, `components/FinalCTA.tsx`, `components/PillarCards.tsx`, `components/StrategiesSection.tsx`, `components/Showcase.tsx`, `components/MoodboardCollage.tsx`, `components/MarketsSection.tsx`, `components/ProblemSection.tsx`. The current `app/page.tsx` only renders `<Hero>`, `<FeatureGrid>`, `<FinalCta>`, and `<SiteFooter>` — the rest are kept around for landing variants.

### Authed surface

`SendForm`, `ReceiveCard`, `EarnCard`, `EarnDashboard`, `EarnStrategyPicker`, `EarnSupplyForm`, `EarnStrip`, `EarnHero`, `EarnSection`, `RewardsPanel`, `RewardsHero`, `SettingsForm`, `ClaimForm`, `ChatView`, `OnboardingFlow`, `OnrampModal`, `OnrampSuccessToast`, `PayLookup`, `PayMerchantForm`, `PayrollForm`, `InvoiceForm`, `InvoiceList`, `AccountSwitcher`, `BusinessRevenueCard`, `BusinessStatsRow`, `PaymentLinkCard`, `PersonalBalanceCard`, `DashboardHero`, `DashboardSparkline`, `QuickActions`, `PaymentActions`, `IntentPreview`, `PTBDemo`, `SessionWatcher`, `ProofWarmer`, `TopUpButton`.

### Banners

`NetworkBanner` (warns when env is testnet), `FixSubnameBanner` (stale `name@talise` target), `AutoConvertBanner` (offers to sweep non-USDsui to USDsui), `ErrorBox`, `OnrampSuccessToast`.

### Primitives

`Button`, `Pill`, `Logo`, `Diamond`, `Nav`, `Reveal`, `AnimatedNumber`, `HeroNumber`, `HomeHeader`, `SubpageHeader`, `PageIntro`, `SiteFooter`, `StatStrip`, `WhySuiStrip`, `CopyAddress`.

## Waitlist form

`/waitlist` is a server component (`app/waitlist/page.tsx`) that renders a `<WaitlistForm>` client child. The form collects `email`, `name`, `country` (whitelisted), and `reason` (whitelisted), then POSTs to `/api/waitlist`. The route upserts on email, fires `sendWaitlistConfirmation` fire-and-forget, and records the Resend message id back to the row for traceability. The confirmation email body comes from `emails/WaitlistConfirmation.tsx`, rendered to HTML via `@react-email/render` server-side at send time.

```ts
// app/api/waitlist/route.ts
ON CONFLICT (email) DO UPDATE SET
  name = COALESCE(EXCLUDED.name, waitlist.name),
  country = COALESCE(EXCLUDED.country, waitlist.country),
  reason = COALESCE(EXCLUDED.reason, waitlist.reason)
```

Duplicate submissions return 200 and skip the email if `confirmation_sent_at` is already set.

## Landing page composition

`app/page.tsx:50-65` is short on purpose:

```tsx
<TopBar />
<main>
  <Hero err={params.err} />     // headline + dual CTAs + PhoneCollage + StatRow
  <FeatureGrid />               // 3 talise-glass cards: send / earn / stable
  <FinalCta />                  // "Send. Save. Earn. Always free." + waitlist CTA
</main>
<SiteFooter />
```

The deeper marketing sections (`DeepFeatures`, `PersonaStories`) are still in the file but unmounted — the founder kept them for a later marketing push. Every CTA on the landing while in private beta routes to `/waitlist`, not `<SignInButton>`. The "iOS · Coming soon" button next to the waitlist CTA is a non-interactive `<div role="img">` placeholder.

The Talise brand mark (`Diamond` component) inlines the SVG path data from `public/symbol.svg` so it can be tinted by `--color-accent`. The "for free" pull-quote uses `var(--font-serif)` italic — that one tonal contrast is the page's signature.
