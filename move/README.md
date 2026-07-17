# Talise Move packages

On-chain Move packages for Talise. Each subdirectory is a standalone package
with its own `Move.toml`. All packages publish with `[addresses] … = "0x0"`
(the address is bound at publish time), and their live package IDs are supplied
to the web app via environment variables (e.g. `CHEQUE_PACKAGE_ID`,
`STREAM_PACKAGE_ID`, `AUTOMATIONS_PACKAGE_ID`, `GOAL_VAULT_PACKAGE_ID`,
`PAYROLL_PACKAGE_ID`, `PROFILE_PACKAGE_ID`, `TALISE_YIELD_PACKAGE_ID`) rather
than hardcoded here — so the deployed IDs are not recorded in these directories.

## Packages

| Package | `Move.toml` name | Purpose | Key modules (`sources/`) | Network / Status |
|---|---|---|---|---|
| `talise/` | `talise` | Core money package: send, batch pay, compliance screening, receipts, vault, cheques, streams, cross-border remit escrow, and the v2 auto-swap throttle. | `send`, `batch_pay`, `compliance`, `receipt`, `vault`, `cheque`, `stream`, `remit_escrow`, `auto_swap` | In production (env-gated package IDs); network unknown / to confirm from this dir |
| `talise-automations/` | `talise_automations` | Standalone, non-custodial standing order ("money rule"): a `StandingOrder<T>` shared object holds a `Balance<T>`; a worker can only release the pre-authorized `amount_per` to the hardwired recipient once each `interval_ms` is due (Clock-gated). Owner can pause/resume/top-up/cancel-refund. | `standing_order` | Deployed (permissionless automations run on-chain; see memory "automations-permissionless"); network unknown / to confirm |
| `talise-goals/` | `talise_goals` | Standalone goal vault holding real funds for savings goals. Zero `talise::` deps, so per-goal custody risk is isolated from the core money package. | `goal_vault` | Activated via `GOAL_VAULT_PACKAGE_ID` (can be disabled with `GOAL_VAULT_DISABLED`); network unknown / to confirm |
| `talise-pay/` | `talise_pay` | Claimable money links (cheques) + streamed payments. Note: `Move.toml` name is `talise_pay` but the `[addresses]` key is `talise` (same address alias as the core package). | `cheque`, `stream` | Status unknown / to confirm |
| `talise-payroll/` | `talise_payroll` | Standalone payroll TEAM (roster) object. Holds NO money — paying a team still routes through the screened `talise::batch_pay::pay_many` path. It is only the on-chain saved roster ("who is on the team"). | `payroll` | Activated via `PAYROLL_PACKAGE_ID`; network unknown / to confirm |
| `talise-privacy/` | `talise_privacy` | Shielded pool: note-based private send with a Merkle tree, zk proof verification, external data, and a cross-package `talise::` compliance gate. | `shielded_pool`, `note_account`, `merkle`, `proof`, `ext_data`, `events`, `errors`, `constants` | Live on mainnet — first real $1 round-trip completed 2026-06-21 (see memory "privacy-mainnet-pilot"); in-app deposit bridge gated off |
| `talise-profile/` | `talise_profile` | Standalone profile object holding cosmetic avatar/config data only (no funds), zero `talise::` deps. | `profile` | Activated via `PROFILE_PACKAGE_ID`; network unknown / to confirm |
| `talise-yield/` | `talise_yield` | Yield router (used with goal vaults for yield-bearing balances). Relies on the implicit Sui-framework system dependency (no explicit git dep) to avoid a "multiple 0x2" resolver conflict. | `yield_router` | Activated via `TALISE_YIELD_PACKAGE_ID`; network unknown / to confirm |

## Known issue — duplicated cheque/stream modules

`talise-pay/sources/` and `talise/sources/` both contain `cheque.move` and
`stream.move`. The two copies are not obviously reconciled from these
directories, and `talise-pay`'s `Move.toml` reuses the `talise` address alias
while naming the package `talise_pay`. This duplication is documented here only,
not fixed — confirm which copy is the source of truth before editing either.

## Notes

- Network / deployed status above is inferred from `Move.toml`, `sources/`, and
  the env-var gating in the web app. Where a live package ID or target network
  could not be verified from these directories, it is marked
  "unknown / to confirm" rather than guessed.
- Several `Move.toml` files carry inline comments explaining why an explicit
  Sui-framework dependency is deliberately omitted (to avoid a "multiple
  versions of package 0x2" resolver conflict) — see `talise/Move.toml`,
  `talise-privacy/Move.toml`, and `talise-yield/Move.toml`.
