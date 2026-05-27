# archive/

Preserved-for-context material. Nothing in this tree should be deployed, depended on, or treated as current.

## What lives here

| Path | Why archived |
| --- | --- |
| `archive/legacy/zklogin/` | Older zkLogin bridge + iOS reference code. Contradicts the current iOS/web zkLogin flow (see `docs/generated/codebase/21-ios-auth-zklogin.md` and `web/lib/zklogin.ts`). The bridge in `bridge/server.js` sets `Access-Control-Allow-Origin: *` and exposes `/sponsor` with no auth, rate limit, or target allowlist. Kept for historical reference only. See `audits/codebase-audit.md` finding P1-1. |

## Rules

- Do not import code from `archive/` into any active package (`web/`, `ios/`, `move/`, `onara/`, `infra/`).
- Do not deploy anything in `archive/`. Bridges, scripts, and Dockerfiles in here are not maintained and may have known security issues.
- If you find yourself wanting to revive archived code, lift it back out into the active tree as a fresh module rather than reusing the archived path. The archived copy stays as a snapshot.
- Historical docs that explain abandoned designs or planning go in `docs/archive/`, not here. Use `archive/legacy/` only for code/config that was once runnable.
