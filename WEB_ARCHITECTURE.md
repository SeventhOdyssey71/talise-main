# Talise — Web Architecture

How Talise compiles into a production-grade web app on Sui. Complements `ARCHITECTURE.md` (Move + iOS) and `research/market_research.md` (problem validation).

**Stack TL;DR:** Next.js 16 App Router · TypeScript · Tailwind + shadcn/ui · `@mysten/dapp-kit-react` · `@mysten/enoki` for zkLogin + sponsored gas · `@mysten/deepbook` SDK · `@mysten/codegen` for type-safe Move calls · TanStack Query · Vercel for staging, Walrus Sites for the "fully on-Sui" flex.

---

## 0. Design constraints (what the web app must satisfy)

1. **Three taps from URL to first PTB.** No wallet install. No seed phrase. Email-OAuth onboarding via zkLogin.
2. **Mobile-first PWA.** Android in Argentina/Lagos/Manila is the target device. Installable to home screen.
3. **Sub-second perceived latency.** Balance refresh < 800ms p95. PTB submit < 1.5s wall-clock.
4. **One transaction per user action.** No "approve, then send" two-step UX. Use PTBs + Enoki sponsorship.
5. **Receipts are shareable URLs.** `talise.app/r/<object-id>` opens to an on-chain-verified payment receipt page.
6. **Demo-able in 90 seconds.** Judges open URL → sign in → cross-asset send → see Suiscan → done.

---

## 1. Stack decisions, with rationale

### Framework: Next.js 16 (App Router)
- React 19; Server Components for receipt pages (SEO-friendly shareable links)
- Static export compatible (required for Walrus Sites deploy as fallback)
- Vercel deploys in <60s; preview URLs per branch
- Why not Vite/Astro: receipt pages benefit from SSR for OG previews when shared to WhatsApp/Telegram

### Wallet & auth: `@mysten/dapp-kit-react` + `@mysten/enoki`
- **dApp Kit** (split into `@mysten/dapp-kit-core` + `@mysten/dapp-kit-react` in 2026) gives us `ConnectButton`, `useCurrentAccount`, `useSuiClientQuery`, `useSignAndExecuteTransaction`
- **Enoki** wraps zkLogin (Google sign-in → ephemeral key → ZK proof → Sui address) and sponsored transactions in a single SDK + dashboard
- Why not raw zkLogin: proof generation, salt management, JWT verification — Enoki solves all of it. Free tier easily covers a hackathon demo.
- Fallback: traditional Sui Wallet / Slush / Suiet wallets via `ConnectButton` for power users

### On-chain SDK: `@mysten/sui` + `@mysten/deepbook`
- `Transaction` class for PTB construction
- `@mysten/deepbook` provides `swapExactBaseForQuote` / `swapExactQuoteForBase` that compose into our PTB
- Both packages support BCS encoding so we can build txns on the client and submit via Enoki sponsorship

### Type safety: `@mysten/codegen`
- Generates TS types for our Move package (Account, AgentPolicy, PaymentReceipt, SavingsBucket)
- Generates type-safe wrappers for entry functions (e.g., `talise.send.send_usdc(args)`)
- Avoids hand-written BCS plumbing that breaks silently on Move type changes
- Codegen runs as a `pnpm run codegen` script pinned to a specific package address per network

### Prices: Pyth Network
- Pyth shipped Sui Lazer SDK April 2026; supports XAU, USDC, BTC, ETH, SUI feeds
- Used for: (a) UI display of "$ value" on cards; (b) `mint_with_conversion` receipt to lock the conversion rate from chain-truth, not UI input

### State / data: TanStack Query (bundled with dApp Kit)
- Cache balances + receipts; invalidate on PTB confirmation
- Optimistic UI on sends (show "pending receipt" instantly)

### Styling: Tailwind 4 + shadcn/ui + Framer Motion
- shadcn for primitives (Dialog, Sheet, Form)
- Framer Motion for the **PTB visualizer** — the animated graph of the 5 Move calls during cross-asset send. This is the "infrastructure & tooling: flow visualizers" idea-bank hit.

### Deployment
- **Primary:** Vercel (talise.app) — fastest iteration, preview URLs for the demo video
- **Flex move:** Walrus Sites mirror at `talise.wal.app` — fully decentralized, censorship-resistant, hits the brief's "real-world applicability" + Sui ecosystem story
- Static export via `next build && next export` for Walrus; SSR receipt pages stay on Vercel

---

## 2. End-to-end user flow (the demo script, technical version)

```
[1] User opens https://talise.app on mobile Safari/Chrome
    └─> Next.js serves a static landing shell (~50KB initial)

[2] User taps "Get Started"
    └─> Enoki initiates OAuth: redirect to accounts.google.com
    └─> Google returns JWT to /auth/callback
    └─> EnokiFlow generates ephemeral key + ZK proof in background (~1-2s)
    └─> Sui address derived; stored client-side in IndexedDB
    └─> First sponsored tx (account init) submitted by Enoki Gas Pool

[3] Home renders
    └─> useSuiClientQuery: getOwnedObjects(address, { filter: TaliseAccount })
    └─> Pyth REST: batch price fetch for [USDC, XAUM, BTC, ETH, SUI]
    └─> Render 5 asset cards + total balance + 24h delta
    └─> Yield strip: 'Earning $0.18 today on DeepBook Margin'

[4] User taps "Send" → enters recipient + amount + (optional) target asset
    └─> Client builds Transaction:
         a) talise::yield_router::withdraw_usdc(&policy, amount)  → coin
         b) deepbook::pool::swap_exact_quote_for_base(usdc_xaum_pool, coin) → xaum_coin
         c) transfer::public_transfer(xaum_coin, recipient)
         d) talise::receipt::mint_with_conversion(amount, rate, recipient, memo)
    └─> Show ConfirmPTBSheet with the 4 steps visualized
    └─> Enoki sponsors gas; user signs with zkLogin

[5] PTB lands in 1 block (~500ms)
    └─> Receipt object ID returned in tx response
    └─> Optimistic balance update, then refetch
    └─> Toast: "Sent! View receipt → talise.app/r/0x..."

[6] User opens receipt URL on another device
    └─> Server Component fetches the PaymentReceipt object via Sui RPC
    └─> Renders proof card with: from, to, amount, conversion rate, Suiscan link
    └─> OG image rendered for WhatsApp/Telegram share preview
```

---

## 3. Repo layout (proposed)

```
Talise/
├── move/                          # (existing) Move package
├── ios/                           # (deferred) iOS app
├── web/                           # NEW
│   ├── next.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── codegen.config.ts          # @mysten/codegen config
│   ├── app/
│   │   ├── layout.tsx             # Root layout, providers
│   │   ├── page.tsx               # Landing / sign-in
│   │   ├── home/page.tsx          # Authenticated home
│   │   ├── send/page.tsx          # Send flow
│   │   ├── earn/page.tsx          # Strategy tiers
│   │   ├── agent/page.tsx         # NL → PTB chat
│   │   ├── activity/page.tsx      # Receipt history
│   │   ├── r/[id]/page.tsx        # Shareable receipt (Server Component)
│   │   ├── api/
│   │   │   ├── agent/plan/route.ts        # Claude API NL→PTB compiler
│   │   │   └── quote/cross-asset/route.ts # DeepBook quote endpoint
│   │   └── providers.tsx          # Client providers
│   ├── components/
│   │   ├── ui/                    # shadcn primitives
│   │   ├── AssetCard.tsx
│   │   ├── YieldStrip.tsx
│   │   ├── ConfirmPTBSheet.tsx    # The "5 calls, 1 signature" sheet
│   │   ├── PTBVisualizer.tsx      # Framer Motion graph of the calls
│   │   ├── ConnectGoogle.tsx
│   │   ├── AgentPolicyEditor.tsx
│   │   └── ReceiptCard.tsx
│   ├── lib/
│   │   ├── sui/
│   │   │   ├── client.ts          # SuiClient factory
│   │   │   ├── network.ts         # testnet/mainnet config + package IDs
│   │   │   ├── enoki.ts           # EnokiFlow instance + sponsored helper
│   │   │   └── pyth.ts            # Pyth price fetch helpers
│   │   ├── talise/                # Generated by codegen
│   │   │   ├── account/index.ts
│   │   │   ├── policy/index.ts
│   │   │   ├── yield_router/index.ts
│   │   │   ├── send/index.ts
│   │   │   ├── auto_convert/index.ts
│   │   │   ├── receipt/index.ts
│   │   │   ├── savings/index.ts
│   │   │   └── recurring/index.ts
│   │   ├── deepbook/              # Wrapped DeepBook calls
│   │   │   ├── pools.ts           # Pool IDs per network
│   │   │   └── swap.ts            # Spot swap helpers
│   │   ├── intents/               # NL intent schema (shared with Claude prompt)
│   │   │   ├── schema.ts
│   │   │   └── compiler.ts
│   │   └── format.ts              # MIST → human numbers
│   ├── hooks/
│   │   ├── useTaliseAccount.ts    # account object + AgentPolicy
│   │   ├── useAssetBalances.ts    # all asset balances + USD value
│   │   ├── useSendCrossAsset.ts   # the hero PTB builder
│   │   ├── useReceipts.ts         # paginated receipts
│   │   └── useAgentIntent.ts      # NL → planned PTB
│   ├── public/
│   │   ├── icon-512.png
│   │   ├── manifest.webmanifest   # PWA manifest
│   │   └── service-worker.js
│   └── styles/globals.css
├── ARCHITECTURE.md                # (existing — Move + iOS)
├── WEB_ARCHITECTURE.md            # THIS FILE
├── PLAN.md                        # (will be updated for web-first)
├── README.md
└── research/
    └── market_research.md
```

---

## 4. The hero PTB in TypeScript (this is the code that wins the demo)

```ts
// web/lib/talise/send.ts
import { Transaction } from "@mysten/sui/transactions"
import { SuiClient } from "@mysten/sui/client"
import { TALISE_PKG, DEEPBOOK, POOLS } from "@/lib/sui/network"

export type CrossAssetSendArgs = {
  accountObjId: string
  policyObjId: string
  amountUsdc: bigint          // in microUSDC (6 decimals)
  targetAsset: "XAUM" | "SUI" | "BTC" | "ETH"
  minOut: bigint              // slippage floor
  recipient: string
  memo: string
}

/**
 * Builds the killer PTB:
 *   1. talise::yield_router::withdraw_usdc — pull from DeepBook Margin position
 *   2. deepbook::pool::swap_exact_quote_for_base — spot-swap USDC → target asset
 *   3. transfer::public_transfer — send asset to recipient
 *   4. talise::receipt::mint_with_conversion — mint on-chain proof
 *
 * Atomic. Reverts if slippage breached. One signature.
 */
export function buildCrossAssetSend(args: CrossAssetSendArgs): Transaction {
  const tx = new Transaction()

  // 1) Withdraw USDC from yield position (validates AgentPolicy)
  const usdcCoin = tx.moveCall({
    target: `${TALISE_PKG}::yield_router::withdraw_usdc`,
    arguments: [
      tx.object(args.accountObjId),
      tx.object(args.policyObjId),
      tx.pure.u64(args.amountUsdc),
    ],
  })

  // 2) Spot swap USDC → target asset via DeepBook
  const poolId = POOLS[args.targetAsset]
  const targetCoin = tx.moveCall({
    target: `${DEEPBOOK}::pool::swap_exact_quote_for_base`,
    typeArguments: [TYPE_TAGS[args.targetAsset], TYPE_TAGS.USDC],
    arguments: [
      tx.object(poolId),
      usdcCoin,
      tx.pure.u64(args.minOut),
      tx.object("0x6"), // Clock
    ],
  })

  // 3) Transfer to recipient
  tx.transferObjects([targetCoin], tx.pure.address(args.recipient))

  // 4) Mint receipt with on-chain conversion proof
  tx.moveCall({
    target: `${TALISE_PKG}::receipt::mint_with_conversion`,
    arguments: [
      tx.pure.address(args.recipient),
      tx.pure.u64(args.amountUsdc),
      tx.pure.string(args.targetAsset),
      tx.pure.u64(args.minOut), // becomes the locked rate in the receipt
      tx.pure.string(args.memo),
    ],
  })

  return tx
}
```

### Executing with Enoki sponsorship

```ts
// web/hooks/useSendCrossAsset.ts
import { useEnokiFlow } from "@mysten/enoki/react"
import { useSuiClient } from "@mysten/dapp-kit-react"
import { useMutation } from "@tanstack/react-query"
import { buildCrossAssetSend, CrossAssetSendArgs } from "@/lib/talise/send"

export function useSendCrossAsset() {
  const client = useSuiClient()
  const flow = useEnokiFlow()

  return useMutation({
    mutationFn: async (args: CrossAssetSendArgs) => {
      const tx = buildCrossAssetSend(args)
      tx.setSenderIfNotSet(flow.$zkLoginState.value!.address)

      // Sponsor gas via Enoki Gas Pool — user pays $0 in SUI
      const sponsored = await flow.sponsorTransaction({
        network: "testnet",
        transactionKindBytes: await tx.build({ client, onlyTransactionKind: true }),
      })

      // User signs with zkLogin ephemeral key
      const sig = await flow.signTransaction({ bytes: sponsored.bytes })

      // Submit to chain
      const result = await client.executeTransactionBlock({
        transactionBlock: sponsored.bytes,
        signature: [sig.signature, sponsored.sponsorSignature],
        options: { showEffects: true, showObjectChanges: true },
      })

      // Find the newly-minted PaymentReceipt object ID
      const receiptId = result.objectChanges?.find(
        (c) => c.type === "created" && c.objectType.endsWith("::receipt::PaymentReceipt"),
      )?.objectId

      return { digest: result.digest, receiptId }
    },
  })
}
```

### Component wiring (the Send sheet)

```tsx
// web/components/SendSheet.tsx
"use client"
import { useSendCrossAsset } from "@/hooks/useSendCrossAsset"
import { useAccount } from "@/hooks/useTaliseAccount"
import { PTBVisualizer } from "./PTBVisualizer"

export function SendSheet({ recipient }: { recipient: string }) {
  const { account, policy } = useAccount()
  const send = useSendCrossAsset()

  const handleSend = () =>
    send.mutate({
      accountObjId: account!.id,
      policyObjId: policy!.id,
      amountUsdc: 50_000_000n,           // $50.00
      targetAsset: "XAUM",
      minOut: 23_000_000n,                // ~0.0231 oz at $2,160/oz, 2% slip
      recipient,
      memo: "for grandma",
    })

  return (
    <div>
      <PTBVisualizer steps={["Withdraw", "Swap to Gold", "Transfer", "Mint Receipt"]} />
      <button onClick={handleSend} disabled={send.isPending}>
        {send.isPending ? "Sending…" : "Send $50 in Gold"}
      </button>
      {send.data?.receiptId && (
        <a href={`/r/${send.data.receiptId}`}>View receipt →</a>
      )}
    </div>
  )
}
```

---

## 5. Provider setup (Next.js App Router)

```tsx
// web/app/providers.tsx
"use client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit-react"
import { EnokiFlowProvider } from "@mysten/enoki/react"
import { getFullnodeUrl } from "@mysten/sui/client"

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl("testnet") },
  mainnet: { url: getFullnodeUrl("mainnet") },
})

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <EnokiFlowProvider apiKey={process.env.NEXT_PUBLIC_ENOKI_PUBLIC_KEY!}>
            {children}
          </EnokiFlowProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
```

```tsx
// web/app/layout.tsx
import { Providers } from "./providers"
import "@mysten/dapp-kit-react/dist/index.css"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

---

## 6. Sign-in flow (Enoki + Google)

```tsx
// web/components/ConnectGoogle.tsx
"use client"
import { useEnokiFlow } from "@mysten/enoki/react"

export function ConnectGoogle() {
  const flow = useEnokiFlow()

  const handleConnect = async () => {
    const url = await flow.createAuthorizationURL({
      provider: "google",
      network: "testnet",
      clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      redirectUrl: `${window.location.origin}/auth/callback`,
      extraParams: { scope: ["openid", "email"] },
    })
    window.location.href = url
  }

  return <button onClick={handleConnect}>Continue with Google</button>
}
```

```tsx
// web/app/auth/callback/page.tsx
"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useEnokiFlow } from "@mysten/enoki/react"

export default function AuthCallback() {
  const flow = useEnokiFlow()
  const router = useRouter()

  useEffect(() => {
    flow.handleAuthCallback().then(() => router.replace("/home"))
  }, [flow, router])

  return <p>Signing you in…</p>
}
```

**Enoki dashboard setup (one-time):**
1. Sign in at `portal.enoki.mystenlabs.com`
2. Create two API keys: one *public* (zkLogin, used client-side) and one *secret* (sponsored gas, used in `/api/*` routes only)
3. Allow Google OAuth provider with your `GOOGLE_CLIENT_ID`
4. Whitelist Move call targets for sponsorship:
   - `<TALISE_PKG>::yield_router::*`
   - `<TALISE_PKG>::send::*`
   - `<TALISE_PKG>::auto_convert::*`
   - `<TALISE_PKG>::receipt::*`
   - `<DEEPBOOK>::pool::swap_exact_*`
5. Set per-user daily gas cap (e.g., 0.5 SUI/day) to prevent abuse

---

## 7. Move ↔ Web wire layer (codegen)

### `web/codegen.config.ts`
```ts
import { defineConfig } from "@mysten/codegen"

export default defineConfig({
  output: "./lib/talise",
  packages: [
    {
      package: "@local-pkg/talise",
      path: "../move/talise",
    },
  ],
  overrides: {
    testnet: {
      "@local-pkg/talise": process.env.TALISE_PKG_TESTNET!,
    },
    mainnet: {
      "@local-pkg/talise": process.env.TALISE_PKG_MAINNET!,
    },
  },
})
```

### Workflow
```bash
# After every Move change:
cd move/talise && sui move build && sui move summary
cd ../../web && pnpm codegen
```

This generates type-safe wrappers like:
```ts
import { send } from "@/lib/talise"

const usdcCoin = send.send_usdc({
  account: accountObj,
  policy: policyObj,
  amount: 50_000_000n,
  recipient: bobAddress,
  memo: "for groceries",
})
```

No hand-written BCS. Move type changes break the build instead of producing wrong txns at runtime.

---

## 8. Reading balances (the home page)

```ts
// web/hooks/useAssetBalances.ts
import { useQuery } from "@tanstack/react-query"
import { useSuiClient } from "@mysten/dapp-kit-react"
import { useCurrentAccount } from "@mysten/dapp-kit-react"
import { fetchPythPrices } from "@/lib/sui/pyth"
import { COIN_TYPES } from "@/lib/sui/network"

export function useAssetBalances() {
  const client = useSuiClient()
  const account = useCurrentAccount()

  return useQuery({
    queryKey: ["balances", account?.address],
    enabled: !!account,
    refetchInterval: 5_000, // pulse every 5s on home
    queryFn: async () => {
      const [usdc, sui, btc, eth, xaum, prices] = await Promise.all([
        client.getBalance({ owner: account!.address, coinType: COIN_TYPES.USDC }),
        client.getBalance({ owner: account!.address, coinType: COIN_TYPES.SUI }),
        client.getBalance({ owner: account!.address, coinType: COIN_TYPES.BTC }),
        client.getBalance({ owner: account!.address, coinType: COIN_TYPES.ETH }),
        client.getBalance({ owner: account!.address, coinType: COIN_TYPES.XAUM }),
        fetchPythPrices(["USDC", "SUI", "BTC", "ETH", "XAU"]),
      ])
      return { usdc, sui, btc, eth, xaum, prices }
    },
  })
}
```

---

## 9. The Receipt page (shareable, server-rendered)

```tsx
// web/app/r/[id]/page.tsx
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client"
import { ReceiptCard } from "@/components/ReceiptCard"
import { notFound } from "next/navigation"

export const revalidate = 60 // cache for a minute

export default async function ReceiptPage({ params }: { params: { id: string } }) {
  const client = new SuiClient({ url: getFullnodeUrl("testnet") })
  const obj = await client.getObject({
    id: params.id,
    options: { showContent: true, showType: true },
  })

  if (!obj.data?.content || obj.data.content.dataType !== "moveObject") notFound()
  const fields = (obj.data.content as any).fields

  return (
    <main className="max-w-md mx-auto py-12 px-4">
      <ReceiptCard
        from={fields.from}
        to={fields.to}
        amount={BigInt(fields.amount)}
        asset={fields.asset}
        conversionRate={BigInt(fields.conversion_rate ?? 0)}
        memo={fields.memo}
        digest={fields.tx_digest}
      />
    </main>
  )
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  // OG image for WhatsApp/Telegram share previews
  return {
    title: `Receipt · ${params.id.slice(0, 8)}…`,
    openGraph: {
      images: [`/r/${params.id}/og.png`],
    },
  }
}
```

A dynamic OG image route (`/r/[id]/og.png`) generates a rendered receipt card image via `next/og` — this is the viral primitive on WhatsApp.

---

## 10. The Agent page (NL → PTB)

```ts
// web/app/api/agent/plan/route.ts
import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { IntentSchema } from "@/lib/intents/schema"

const SYSTEM = `You are Talise's intent compiler.
Translate user requests into JSON conforming to this schema:
${JSON.stringify(IntentSchema, null, 2)}
Only output JSON. Caps in USDC microunits (6 decimals).
Examples:
- "send $50 to alice.sui in gold" → {kind:"send", amount:50000000, asset:"USDC", target_asset:"XAUM", recipient:"alice.sui"}
- "save 10% of every paycheck in rent" → {kind:"savings_rule", inflow_pct:10, label:"rent"}`

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const result = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  })
  const intent = JSON.parse((result.content[0] as any).text)
  return NextResponse.json({ intent })
}
```

The client receives the structured intent, validates against `IntentSchema` (Zod), and renders a `ConfirmPTBSheet` with the planned Move calls. **The LLM never builds a PTB directly** — it emits structured intent, the client compiles. Safer, deterministic, demonstrable.

---

## 11. PWA + share targets

```json
// web/public/manifest.webmanifest
{
  "name": "Talise",
  "short_name": "Talise",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0B1426",
  "theme_color": "#0B1426",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "share_target": {
    "action": "/send",
    "method": "GET",
    "params": { "title": "recipient", "text": "memo" }
  }
}
```

`share_target` makes Talise appear in Android's native Share sheet — share a contact name → opens directly to Send.

---

## 12. Deployment plan

### Phase 1 (Day 5–6): Vercel
- Push `web/` as a Vercel project. Auto-deploys per commit.
- `talise.app` apex → main; preview URLs per PR.
- Env vars in Vercel dashboard: `NEXT_PUBLIC_ENOKI_PUBLIC_KEY`, `ENOKI_SECRET_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `ANTHROPIC_API_KEY`, `TALISE_PKG_TESTNET`.
- Server Components for `/r/[id]` need SSR → Vercel is the right home.

### Phase 2 (optional flex, Day 6): Walrus Sites mirror
- `next build && next export` produces a static `out/`
- `site-builder publish ./out --epochs 5` uploads to Walrus
- Get a `talise.wal.app`-style subdomain or use an existing domain via SuiNS
- Note: the receipt page becomes a client-rendered fallback on Walrus (loses OG image SSR)
- **Why include this:** it's the only submission in the track that's fully on-Sui (frontend + contracts + assets). One slide in the deck.

### CDN / asset strategy
- Logo + asset icons via `next/image` (Vercel CDN)
- Font: Inter via `next/font` (self-hosted, no FOIT)
- Tree-shake Pyth feed list to just the 5 we use (~40KB savings)

---

## 13. Performance budgets

| Metric | Target | How |
|---|---|---|
| Initial JS payload | < 180KB gz | Code-split per route; lazy-load `@mysten/deepbook` only on `/send` |
| First Contentful Paint | < 1.5s on 4G | Static landing; defer Sui client until after auth |
| Balance refresh | < 800ms p95 | TanStack Query cache + 5s pulse |
| PTB submit → receipt visible | < 1.5s | Optimistic UI on submit |
| Lighthouse mobile score | > 90 | No client-side analytics on landing; image LQIP placeholders |

---

## 14. Security checklist

- [ ] All `tx.moveCall` targets validated against an allow-list before sign
- [ ] Slippage `minOut` always derived from a fresh DeepBook quote, not user input echo
- [ ] `AgentPolicy` daily caps enforced **on-chain**; web only mirrors for UX
- [ ] Enoki secret key only in API routes, never bundled to client
- [ ] Anthropic API key behind `/api/agent/plan`; client never sees it
- [ ] Origin lock on Google OAuth client (talise.app only)
- [ ] CSP: `script-src 'self' https://*.mystenlabs.com https://*.pyth.network`
- [ ] Receipt page sanitizes `memo` field (Move strings are arbitrary user input)
- [ ] No localStorage for sensitive state — IndexedDB only (Enoki manages this)

---

## 15. Updated 6-day plan (web-first edit)

Replacing iOS-only Day 4–5 with web-first.

### Day 1 — Sat 2026-05-17 ✅ in progress
- Move package skeleton (unchanged)
- **NEW:** scaffold `web/` with `pnpm create next-app@latest`, install `@mysten/dapp-kit-react`, `@mysten/enoki`, `@mysten/deepbook`, `@mysten/codegen`, Tailwind, shadcn
- Set up Enoki account, create API keys, configure Google OAuth client

### Day 2 — Sun 2026-05-18
- Move: `yield_router`, `send` working on testnet
- **NEW:** Web — providers + ConnectGoogle + first sponsored tx (anything; just prove the path)
- Codegen wired; first `talise.send.send_usdc()` call from web works

### Day 3 — Mon 2026-05-19
- Move: `auto_convert` + tests
- **NEW:** Web — Home page with 5 asset cards, balance fetching, Pyth price overlay

### Day 4 — Tue 2026-05-20 (was iOS Day 1)
- **REPLACED:** Web — SendSheet + cross-asset PTB + ConfirmPTBSheet + PTBVisualizer animation
- First end-to-end on testnet: open URL → Google → see balance → send $50 USDC → see Suiscan

### Day 5 — Wed 2026-05-21 (was iOS Day 2)
- **REPLACED:** Web — Receipt page (`/r/[id]`) with OG image; Agent page with Claude API; AgentPolicyEditor; Activity feed
- Polish + accessibility pass

### Day 6 — Thu 2026-05-22
- 90-sec demo recording (web replaces iOS in the script)
- Deploy `talise.app` on Vercel; verify share-link OG previews on WhatsApp
- Optional: Walrus Sites mirror
- Pitch deck final
- Suiscan hero screenshots (4 shots)

### Day 7 — Fri 2026-05-23
- Submit before 23:59 PT

**iOS:** Cut from v1 hackathon scope. Ship as v2 post-submission using the same Move package + `/api/agent/plan` endpoint (architecture already supports it).

---

## 16. Risks (web layer specific)

| Risk | Mitigation |
|---|---|
| Enoki sponsored tx rate-limit during demo | Pre-fund a backup gas-station via Shinami; warm up before recording |
| Google OAuth flow blocked in regions during judging | Add Apple OAuth as fallback in same Enoki flow |
| dApp Kit / Enoki API breaking change late in week | Pin exact versions; only upgrade if forced |
| Pyth price feed downtime | Cache last-good price 60s; display "stale" badge instead of crashing |
| DeepBook spot pool insufficient liquidity on testnet | Pre-seed our positions; have a fallback "demo mode" that simulates the swap leg |
| Walrus Sites blob retrieval slow during demo | Don't rely on Walrus URL for the live demo; use Vercel + show Walrus as a "bonus slide" |
| Mobile Safari quirks with WebAuthn / passkey | Test on real iOS Safari Day 4; degrade to Google OAuth only if needed |
| WhatsApp OG preview cached pre-fix | Use `?v=N` query param on share to force refresh |

---

## 17. Cost estimate (hackathon → first month live)

| Item | Cost | Notes |
|---|---|---|
| Vercel Hobby | $0 | Sufficient for hackathon traffic |
| Enoki | $0 | Free tier covers ~10k sponsored tx/mo |
| Anthropic API (agent) | ~$5–$20 | claude-sonnet-4-6, ~3¢/intent |
| Domain (talise.app) | $20/yr | Namecheap or Cloudflare |
| Sui testnet | $0 | DUSDC faucet covers tests |
| Walrus Sites blob | ~$2 | 5 epochs × ~$0.40 per blob |
| Pyth REST | $0 | Public endpoint |
| **Total Day-1 → demo** | **< $30** | |

Going live (1k MAU month):
- Vercel Pro: $20/mo (if needed for SSR scale)
- Enoki Pro tier (>10k tx/mo): pricing on request
- Sponsored gas: depends on tx volume (~$0.001/tx on Sui, ~$5/mo at 5k tx)
- **Estimated:** $50–$200/mo at 1k MAU

Yield-take revenue model (post-hackathon): 15% of yield generated. At $200M AUM with 6% blended yield = $1.8M ARR.

---

## 18. The screenshots judges will see (deck-ready)

1. **Home** — 5 asset cards, total balance, yield strip ticking "$0.18 today"
2. **Send confirm sheet** — 4 PTB steps visualized with the Framer animation paused mid-flow
3. **Suiscan tx** — 5 Move calls in one block (the hero artifact, this is THE screenshot)
4. **Receipt page** — `talise.app/r/0x…` rendering with on-chain proof + WhatsApp OG preview
5. **Agent chat** — "save 10% in rent bucket" → planned PTB confirmation
6. **Earn tab** — three tier cards with live APR pulled from DeepBook Margin

---

## 19. Why this stack wins the track (mapping back to the brief)

| Brief criteria | This architecture delivers |
|---|---|
| Novel use of PTBs | 5-call cross-asset send as one signed PTB, type-safe via codegen |
| Strong composability | Margin + Spot + Transfer + Receipt NFT in one block, type-safe in Move + TS |
| Excellent UX for complex financial actions | 3 taps from URL to first send; PTB visualizer; shareable receipts |
| Real-world applicability | PWA-installable in 95% of the world; Enoki sponsored tx removes the SUI-on-ramp moat |
| Working end-to-end | Vercel-deployed URL judges can open immediately |
| Thoughtful abstraction for users | NL agent → structured intent → confirmed PTB. No raw blockchain UX. |
| Infrastructure & tooling (bonus) | Codegen layer + PTB visualizer as developer artifacts |

---

## 20. Open decisions to lock

1. **Domain.** Buy `talise.app` today? ($20/yr)
2. **Walrus Sites mirror — yes/no?** (~1 hour to set up; adds a deck slide)
3. **Mainnet for demo URL or testnet?** Testnet ships safer; mainnet flexes harder.
4. **Apple OAuth alongside Google?** (China/Russia coverage; ~1 hour extra)
5. **PWA push notifications?** (Receipt-received pings — nice-to-have, defer to v2)
6. **Sponsored-gas budget per user.** Default suggested: 0.5 SUI/day cap.

Once locked, the codegen → scaffolding work for `web/` can start in parallel with Move Day 2.

---

## Sources used to compile this architecture

- [Sui dApp Kit — Mysten Labs TS SDK Docs](https://sdk.mystenlabs.com/dapp-kit)
- [Sui dApp Starter Next.js template — Sui Forum](https://forums.sui.io/t/sui-dapp-starter-now-has-next-js-template/47419)
- [Enoki Sponsored Transactions docs](https://docs.enoki.mystenlabs.com/ts-sdk/sponsored-transactions)
- [Enoki example app — Sui Foundation GitHub](https://github.com/sui-foundation/enoki-example-app)
- [DeepBookV3 SDK — Sui docs](https://docs.sui.io/standards/deepbookv3-sdk)
- [DeepBookV3 Swaps — Sui docs](https://docs.sui.io/standards/deepbookv3-sdk/swaps)
- [Building Transactions — Sui docs](https://docs.sui.io/guides/developer/sui-101/building-ptb)
- [Sui Programmable Transaction Basics — Mysten SDK](https://sdk.mystenlabs.com/typescript/transaction-building/basics)
- [@mysten/codegen — npm](https://www.npmjs.com/package/@mysten/codegen)
- [Sui TypeScript Codegen — Mysten SDK](https://sdk.mystenlabs.com/codegen)
- [Walrus Sites Components — Walrus docs](https://docs.wal.app/docs/sites/introduction/components)
- [Pyth on Sui — Pyth docs](https://docs.pyth.network/price-feeds/core/contract-addresses/sui)
- [Pyth real-time data in Sui contracts](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/sui)
- [Sui Gas Pool — Sui blog](https://blog.sui.io/sui-gas-pool-scaling-gas-payments/)
- [DeepBook Margin launch — Sui blog](https://blog.sui.io/deepbook-spot-margin-primitives-for-builders/)
