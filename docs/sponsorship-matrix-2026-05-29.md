# Sponsorship Matrix — 2026-05-29

Product directive (2026-05-29 evening): the canonical sponsorship rail for
every Talise operation. Codified here so future agents can verify routing
in production by grepping the log lines listed at the bottom of each
section.

## Matrix

| Operation                              | Sponsorship | Endpoint                                                     |
|----------------------------------------|-------------|--------------------------------------------------------------|
| Send USDsui (no SnS, no Coin objs)     | GASLESS     | `/api/send/sponsor-prepare` + `/api/send/gasless-submit`     |
| Send USDsui + SnS (or Coin-only)       | Onara       | `/api/send/sponsor-prepare` (sponsored branch) + `/api/zk/sponsor-execute` |
| Send SUI                               | Onara       | `/api/send/sponsor-prepare` (SUI branch) + `/api/zk/sponsor-execute`       |
| Earn — NAVI supply                     | Onara       | `/api/earn/supply/prepare` + `/api/zk/sponsor` + `/api/zk/sponsor-execute` |
| Earn — NAVI withdraw                   | Onara       | `/api/earn/withdraw/prepare` + `/api/zk/sponsor` + `/api/zk/sponsor-execute` |
| Earn — NAVI withdraw-earned            | Onara       | `/api/earn/withdraw-earned/prepare` + `/api/zk/sponsor` + `/api/zk/sponsor-execute` |
| Non-USDsui swap → USDsui               | Onara       | `/api/swap/prepare` (fused) → `/api/zk/sponsor-execute`      |
| Vault drain to admin                   | Onara       | one-shot script (Agent B)                                    |

---

## Per-row notes

### Send USDsui (plain — gasless)

- **What fires:** `/api/send/sponsor-prepare` builds a PTB consisting of
  one `0x2::balance::send_funds<USDSUI>` MoveCall. Both `tx.setGasPrice(0n)`
  AND `tx.setGasBudget(0n)` are explicitly set (the validator's gasless
  gate rejects auto-picked budgets even when price is 0). The bytes go
  back to iOS; iOS signs them and POSTs to `/api/send/gasless-submit`,
  which broadcasts. The validator clears the tx without any sponsor.
- **Gas cost:** 0 SUI. The user pays nothing; Talise pays nothing.
- **Fallback path:** if the gasless `tx.build()` throws and SnS is OFF,
  the route returns a 4xx (`ACCUMULATOR_UNDERFUNDED` or
  `GASLESS_NEEDS_ANCHOR` or `GASLESS_BUILD_FAILED`). It does **not**
  silently fall through to Onara — that would make Talise pay for a tx
  the user was told was free.
- **Verify in prod:**
  - `[send/sponsor-prepare gasless] total=<n>ms ... deferredRoundupUsd=<x>`
  - Response `mode=gasless`.

### Send USDsui + SnS (or Coin-only balance)

- **What fires:** same prepare route, but when SnS is on **and** the
  gasless build throws on a Coin-only balance state, the route falls
  through to the sponsored branch. The sponsored branch builds a single
  PTB containing: (a) Payment Kit receipt, (b) `coinWithBalance({type:
  USDSUI, balance, useGasCoin: false})` to source from Coin objects,
  (c) transfer to recipient, (d) NAVI supply leg (`appendNaviSupply`)
  for the round-up percentage, (e) second Payment Kit receipt for the
  invest leg. Onara is set as `gasOwner`, gas price from
  `getReferenceGasPrice()` (memo'd 1.5s).
- **Gas cost:** Onara pays the gas (~0.001 SUI / tx; <1 µSUI for the
  receipt). User pays 0.
- **Verify in prod:**
  - `[send/sponsor-prepare] ptb=<n>ms ... total=<n>ms`
  - Response `mode=sponsored` or `mode=sponsored-coin-fallback`.

### Send SUI

- **What fires:** prepare's SUI branch — clock-MoveCall + split +
  transfer. Onara sponsors.
- **Gas cost:** ~0.001 SUI to Onara.
- **Verify in prod:** prepare log + response `mode=sponsored`.

### Earn — NAVI supply

- **What fires:** `/api/earn/supply/prepare` builds the
  `appendNaviSupply` PTB and returns `transactionKindB64` (built with
  `client: sui(), onlyTransactionKind: true`). iOS then POSTs to
  `/api/zk/sponsor` which (1) resolves the Onara sponsor address via
  `onara().status()` (60s memo), (2) fetches the reference gas price
  via `client.getReferenceGasPrice()` (60s memo), (3) sets
  `tx.setSender`, `tx.setGasOwner(sponsor)`, `tx.setGasPrice(BigInt(gasPrice))`,
  (4) full `tx.build({client})`. iOS signs the bytes and POSTs to
  `/api/zk/sponsor-execute`.
- **Gas cost:** Onara pays (~0.005 SUI for a NAVI supply, more for the
  Pyth oracle refresh).
- **Verify in prod:**
  - `[earn/supply/prepare] mode=sponsored venue=<v> amount=<n>`
  - `[zk/sponsor] mode=sponsored sponsor=<addr> gasPrice=<n>`

### Earn — NAVI withdraw

- **What fires:** `/api/earn/withdraw/prepare` (NAVI branch) calls
  `appendNaviWithdraw`, which appends the Pyth oracle refresh and
  withdrawal entry. Returns `transactionKindB64`. Same downstream
  wrap via `/api/zk/sponsor` + `/api/zk/sponsor-execute`.
- **Gas cost:** Onara pays (~0.007 SUI — Pyth refresh dominates).
- **Verify in prod:**
  - `[earn/withdraw-prepare] mode=sponsored venue=navi amount=<n|all>`
  - `[zk/sponsor] mode=sponsored sponsor=<addr> gasPrice=<n>`

### Earn — NAVI withdraw-earned

- **What fires:** `/api/earn/withdraw-earned/prepare` computes the
  earned USDsui amount server-side (currentValue − principalSupplied),
  appends the Pyth refresh + NAVI withdraw for that exact amount.
  Returns `transactionKindB64`. Same downstream wrap.
- **Gas cost:** Onara pays (~0.007 SUI).
- **Verify in prod:**
  - `[earn/withdraw-earned-prepare] mode=sponsored venue=navi earned=<n>`
  - `[zk/sponsor] mode=sponsored sponsor=<addr> gasPrice=<n>`

### Non-USDsui swap → USDsui

- **What fires:** `/api/swap/prepare` builds a DeepBook v3 swap PTB from
  the user's `Coin<fromT>` objects via `coinWithBalance({useGasCoin: false})`,
  calls the DeepBook swap MoveCall (`swap_exact_base_for_quote` or
  `swap_exact_quote_for_base` depending on which side of the pool the
  input sits), then transfers the resulting `Coin<USDsui>` back to the
  user. Pool selection (mainnet, lowest-fee path):
  - SUI → USDsui: `SUI_USDSUI` (0x826eeacb…) — direct.
  - USDC → USDsui: `USDSUI_USDC` (0xa374264d…) — direct, quote→base.
  - DEEP → USDsui: two-hop `DEEP_USDC` (0xf948981b…) →
    `USDSUI_USDC` (0xa374264d…).
  The output USDsui is transferred back to the user's address — never
  to a third party. The combined "swap + send to recipient" flow is a
  follow-up. Sponsorship is fused into the same route (no separate
  `/api/zk/sponsor` hop): `onara().status()` (60s memo) +
  `getReferenceGasPrice()` (1.5s memo) run in parallel with the PTB
  build; `tx.setSender(userAddr)` + `tx.setGasOwner(sponsor)` +
  `tx.setGasPrice(gasPrice)` are stamped before `tx.build({client})`.
  Slippage cap defaults to 100 bps (1%), surfaced to iOS as
  `estimatedToMicros` so the UI can render "you'll receive ~$X".
- **Gas cost:** Onara pays. The swap is wallet-conditioning (like the
  consolidation tap), not a value transfer, so Onara sponsoring it is
  consistent with the matrix directive.
- **Verify in prod:**
  - `[swap/prepare] mode=sponsored from=<fromType> fromMicros=<n> estimatedTo=<m>`
  - `[zk/sponsor] mode=sponsored sponsor=<addr> gasPrice=<n>` (emitted
    by the fused wrap inside this route, mirroring the earn audit shape
    from commit `566111b`).

### Vault drain to admin

- **Status:** Owned by Agent B as a one-shot operational script. Uses
  Onara for sponsorship. Not invoked by user-facing routes.

---

## Verification log shapes (canonical)

Grep these in Vercel production logs to confirm routing:

```
[send/sponsor-prepare gasless] total=<n>ms ...                     ← gasless
[send/sponsor-prepare] ptb=<n>ms ... total=<n>ms                   ← sponsored / sponsored-coin-fallback
[earn/supply/prepare] mode=sponsored venue=<v> amount=<n>
[earn/withdraw-prepare] mode=sponsored venue=<v> amount=<n|all>
[earn/withdraw-earned-prepare] mode=sponsored venue=navi earned=<n>
[swap/prepare] mode=sponsored from=<fromType> fromMicros=<n> estimatedTo=<m>
[zk/sponsor] mode=sponsored sponsor=<addr> gasPrice=<n>            ← the authoritative wrap line
```

The `[zk/sponsor] mode=sponsored sponsor=<addr> gasPrice=<n>` line is the
single source of truth that an earn or swap tx took the Onara rail. Every
sponsored leg (except `send/sponsor-prepare`, which fuses prepare+wrap)
flows through this endpoint.

---

## Audit verdict (per route)

| Route                                  | Verdict | Notes |
|----------------------------------------|---------|-------|
| `/api/send/sponsor-prepare`            | ✓ correct (not touched — Agent A) |
| `/api/earn/supply/prepare`             | ✓ correct (added verification log) |
| `/api/earn/withdraw/prepare`           | ✓ correct (added verification log) |
| `/api/earn/withdraw-earned/prepare`    | ✓ correct (added verification log) |
| `/api/zk/sponsor` (the shared wrapper) | ✓ correct (added `mode=sponsored sponsor=<addr> gasPrice=<n>` line) |
| `/api/zk/sponsor-execute`              | ✓ correct (unchanged — forwards to Onara) |

All sponsored paths use `client: sui()` for `tx.build()`, set
`gasOwner` to the Onara sponsor address before `tx.build()`, and use
`getReferenceGasPrice()` for `gasPrice` (memoized 60s on the wrap, 1.5s
on the fused send-prepare). None set `gasBudget` — Onara picks it.
