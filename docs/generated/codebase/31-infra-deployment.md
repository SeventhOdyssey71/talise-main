# 31. Deployment (Vercel)

The entire web app and API surface ships through one Vercel project:
`talise-main` (project id `prj_5kOQ2Td0BpgnxeS23q0lYYDGW6Jz`, org
`team_C4oGJktO81mI00L0yas9i9yz`, plan: Pro). The project root in the
repo is `web/`, linked via `.vercel/repo.json`.

## Local project linkage

`.vercel/repo.json` (committed at the repo root, NOT inside `web/`):

```json
{
  "remoteName": "origin",
  "projects": [
    { "id": "prj_5kOQ2Td0BpgnxeS23q0lYYDGW6Jz",
      "name": "talise-main",
      "directory": "web",
      "orgId": "team_C4oGJktO81mI00L0yas9i9yz" }
  ]
}
```

This is what tells `vercel` CLI invocations from any cwd inside the repo
which project to talk to. If you run `vercel` from `web/` directly, it
reads the same file via the parent-directory walk.

There is no `web/.vercel/project.json` checked in (it's gitignored). If
you need to relink on a fresh checkout: `cd web && vercel link`.

## Framework detection and build

- Framework: Next.js (auto-detected by Vercel from `web/next.config.ts`
  and `web/package.json`).
- Node version: `>= 22` (declared in `web/package.json` `engines.node`).
- Install command: default (`pnpm install`, since `pnpm-lock.yaml` is
  present).
- Build command: `next build` (via the `build` npm script).
- Output directory: default Next.js (`.next`).

No `buildCommand` or `outputDirectory` override in `vercel.json`. The
only thing `vercel.json` contains is the cron schedule:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/auto-swap-sweep", "schedule": "* * * * *" }
  ]
}
```

That's `web/vercel.json` (full file). See `34-infra-observability.md`
for what the cron does.

## Branches and previews

Default Vercel behaviour applies (we have not overridden it):

- Pushes to any non-production branch yield a Preview deployment at a
  generated `*.vercel.app` URL.
- Pull requests get a Preview deployment per commit.
- Pushes to `main` go to Production (`talise.io` and `app.talise.io`).
- Pull requests can be deployed to a specific env with the
  Environment Variable scope toggle ("Production / Preview /
  Development").

Mobile-only quirk: the `app.talise.io` alias is bound to Production.
Mobile sign-in tests against `app.talise.io` exercise prod code; for
mobile testing on a preview deployment, point the iOS build at the
preview's `*.vercel.app` host (the redirect URI is derived from the
request host at runtime, see `redirectUriFromRequest()` in
`web/lib/auth.ts:35`).

## Producing a production deploy

From a clean working tree:

```bash
cd /Users/eromonseleodigie/Talise/web
vercel --prod
```

That command:

1. Reads `.vercel/repo.json` (project + org).
2. Pulls the production env vars set on Vercel.
3. Runs `pnpm install` then `next build` against the linked project's
   config.
4. Uploads the build artifact and promotes it to `talise.io` +
   `app.talise.io`.

CI/CD: there is no `.github/workflows/` directory in the repo at the
time of writing. Deploys happen either by `vercel --prod` from a
maintainer's laptop or via Vercel's auto-deploy on push to `main`.

## Rollback procedure

Vercel keeps every prior production deployment. Two equivalent rollback
paths:

1. CLI:
   ```bash
   vercel rollback <deployment-url-or-id>
   ```
   Use the URL of the previous green deploy (visible in
   `vercel ls --prod`).

2. Dashboard: Vercel Project -> Deployments -> click the previous good
   deploy -> "Promote to Production".

Either path swaps the alias atomically; users see the change within
~30 seconds. Env var changes are tied to the active deployment, so a
rollback also reverts env vars that were edited as part of the bad
deploy ONLY if those env edits were captured in that deploy. Env vars
edited via `vercel env add` AFTER the bad deploy are NOT reverted by a
deploy rollback. The babysit playbook in `infra/prover/gpu/BABYSIT.md`
treats env var changes as the actual revert lever for the GPU rollout.

## Environment variable management

All env vars are stored in Vercel, scoped to one of three environments:
Production, Preview, Development. The canonical CLI commands:

```bash
# Inspect what's set
vercel env ls production
vercel env ls preview
vercel env ls development

# Add (interactive prompt for the value):
vercel env add NAME production

# Add with a piped value (preferred for scripted runbooks):
printf 'value' | vercel env add NAME production

# Remove:
vercel env rm NAME production --yes

# Pull into a local .env file:
vercel env pull --environment=development .env.vercel
```

A redacted local snapshot lives at `.env.vercel` at the repo root (it
contains every var name but blanked values; it's the output of
`vercel env pull`). Treat it as documentation only - real secrets are
in Vercel, not in the repo.

Single-env-var changes do NOT auto-redeploy. To pick up an env var
change you must redeploy: `vercel --prod` from `web/`. The babysit
playbook for the GPU rollout (`infra/prover/gpu/BABYSIT.md`) always
follows env edits with `vercel --prod`.

### What lives where

| Env                | Used for                                              |
| ------------------ | ----------------------------------------------------- |
| Production         | `talise.io` + `app.talise.io`. The real users.         |
| Preview            | Per-PR + per-branch deploys.                          |
| Development        | `vercel env pull` into local `.env.local`. Optional.   |

Local development reads `web/.env.local` directly (not Vercel-pulled),
so dev secrets are owned per-engineer. See `33-infra-env-vars.md` for
the full var inventory and which envs each one belongs in.

## Functions runtime config

- Default runtime: Node.js (the project does not pin Edge anywhere).
- Cron handler: `web/app/api/cron/auto-swap-sweep/route.ts` declares
  `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`
  to opt out of caching.
- Function timeout: default (60s Hobby, 300s Pro). We are on Pro, so 300s
  applies. The cron caps its work loop at 80 users/tick to stay well
  under that. See the `MAX_USERS_PER_TICK` constant in the cron handler.

## Deploy hooks

There is no formal deploy hook in `vercel.json`. The babysit playbook
mentions a possible `VERCEL_DEPLOY_HOOK_URL` for the GPU prover's
auto-stop-on-budget Lambda (referenced in
`infra/prover/gpu/RUNBOOK.md` Section i), but that Lambda is not
deployed today.
