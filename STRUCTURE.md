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

**Full detail + the build-safe reorg plan:** [`docs/architecture/codebase-structure.md`](docs/architecture/codebase-structure.md).
