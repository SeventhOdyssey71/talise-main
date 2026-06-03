# Talise — repository structure

Talise sorts into five buckets. **`frontend` and `backend` are facets of the ONE Next.js app in
`web/`**, not separate directories: an App-Router app co-locates pages and API routes, and both
resolve the `@/*` alias — splitting them would break `next build` and every `@/lib`/`@/components`
import. So the split is documented, not physical.

| Bucket | Lives in |
|---|---|
| **frontend** | `web/app/`*(pages)* · `web/components/` · `web/emails/` · `web/public/` |
| **backend**  | `web/app/api/` · `web/lib/` · `web/middleware.ts` |
| **app**      | `ios/` — SwiftUI client (+ `ios/SuiGrpcKit/`) |
| **server**   | `onara/` — Cloudflare Worker gas sponsor · `infra/` — zkLogin prover ops |
| **docs**     | `docs/` — see `docs/architecture/codebase-structure.md` for the full map |

Other top-level: `move/talise/` (Sui Move on-chain package), `scripts/` (repo ops + `md-to-pdf.sh`),
`archive/` (relocated dead code), `.github/workflows/` (CI).

**On-chain (`move/talise/sources/`)** — the contract suite (each generic over the coin type `T`,
USDsui in production; in-house-hardened AdminCap + worker + paused idiom, not OZ — see Move.toml):
`send` (atomic transfer + receipt) · `receipt` (payment-proof NFT) · `cheque` (claimable money-links,
escrow + reclaim) · `stream` (streamed payroll) · `vault` + `auto_swap` (per-user balances + any-coin→
USDsui) · **`compliance`** (denylist/allowlist/kill-switch gate) · **`remit_escrow`** (trustless
off-ramp: commit/release + permissionless reclaim-on-timeout) · **`batch_pay`** (atomic N-recipient
payroll). Roadmap + audit: `docs/strategy/smart-contracts-roadmap.md`.

**Full detail + the build-safe reorg plan:** [`docs/architecture/codebase-structure.md`](docs/architecture/codebase-structure.md).
