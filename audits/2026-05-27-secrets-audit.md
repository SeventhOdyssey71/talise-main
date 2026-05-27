# Talise Secrets Audit, 2026-05-27

Author: read-only sweep. No files modified.
Scope: working tree, git index, full reflog, and tracked content scan across
`/Users/eromonseleodigie/Talise`.
Tools available: `git`, ripgrep-via-grep. `gitleaks` is NOT installed on this
machine; regex sweep used in its place. See section 3.

---

## 1. Executive summary

Safe to push: YES, after one rotation (chat-exposed Resend key) and three
small `.gitignore` hardenings. There are NO live secrets in the working tree
that would get staged by `git add .`, and NO secrets anywhere in git history,
stash, or reflog.

| Question                                 | Answer                         |
| ---------------------------------------- | ------------------------------ |
| Secrets exposed in tracked working tree? | 0                              |
| Secrets exposed in untracked files?      | 0                              |
| Secrets in git history / stash / reflog? | 0                              |
| Files about to be staged that leak?      | 0                              |
| Files containing real secrets, on disk?  | 3 (all properly gitignored)    |
| Keys that MUST be rotated?               | 1 (`RESEND_API_KEY`, exposed in chat) |

---

## 2. Working-tree findings

Every candidate "secret file" found on disk was checked against
`git check-ignore` and `git ls-files`. Status legend:

- IGN = matches a `.gitignore` rule, will NOT be staged
- TRK = currently tracked in the index
- NEW = present on disk, would be picked up by `git add .` if not ignored

| Path                                              | check-ignore | tracked | Real values? | Verdict |
| ------------------------------------------------- | ------------ | ------- | ------------ | ------- |
| `/.env.vercel`                                    | IGN          | no      | empty-stubs only (`KEY=""`) plus 1 long `VERCEL_OIDC_TOKEN` | SAFE — gitignored |
| `/web/.env.local`                                 | IGN          | no      | YES (full prod-shape values: Google OAuth, Shinami, Resend, Session, SuiNS operator, Memwal, Database URL, Admin) | SAFE — gitignored |
| `/web/.env`                                       | IGN          | no      | content present | SAFE — gitignored |
| `/web/.env.vercel`                                | IGN          | no      | empty-stubs only | SAFE — gitignored |
| `/web/.env.example`                               | NOT IGN      | TRK     | placeholders only (`RESEND_API_KEY=`, `SESSION_SECRET=`, etc.) | SAFE |
| `/onara/api/.dev.vars`                            | IGN          | no      | YES — `SUI_MNEMONIC=<set>` for mainnet sponsor | SAFE — gitignored |
| `/onara/api/.dev.vars.example`                    | NOT IGN      | TRK     | placeholder string only | SAFE |
| `/archive/legacy/zklogin/bridge/.env.example`     | NOT IGN      | TRK     | placeholders only | SAFE |
| `/archive/legacy/zklogin/bridge/sponsor-key.example.txt` | NOT IGN | TRK     | placeholder text | SAFE |
| `/.secrets/talise-suins-operator.txt`             | IGN (via `.secrets/`) | no | YES — contains real SuiNS operator key material | SAFE — gitignored |
| `/.mcp.json`                                      | IGN          | no      | localhost-only Figma URL, no secret | SAFE — gitignored |
| `/.vercel/repo.json`                              | IGN          | no      | non-sensitive project IDs only | SAFE — gitignored |

Notes:

- The `.gitignore` rule `!*.example` correctly re-includes `.env.example` and
  `.dev.vars.example` files so they remain tracked.
- The pattern `.vercel` on line 75 of `.gitignore` matches `/.vercel/`
  (verified with `git check-ignore -v`). Note: it would NOT cover a nested
  `web/.vercel/` directory if one ever appears, because the entry is
  unanchored but `/web/.vercel/` does not currently exist. Adding `.vercel/`
  (with trailing slash) recursively-safe is recommended (see section 5).
- The `.secrets/` directory contains one file (`talise-suins-operator.txt`)
  whose first non-comment line is the SuiNS operator private key. Gitignored
  by the `.secrets/` rule on line 70.

---

## 3. Tracked-content scan (high-entropy tokens)

Command (paraphrased):

```
git ls-files | grep -v <binary exts> | xargs grep -lE \
  '(re_[A-Za-z0-9_]{20,}|sk_live_...|ghp_[A-Za-z0-9]{30,}|AIza...|suiprivkey1[a-z0-9]{50,}|nvapi-...|whsec_...|GOCSPX-...)'
```

Result: **0 matches**.

A second sweep for env-var assignment shapes with values
(`RESEND_API_KEY=re_...`, `SUI_MNEMONIC="<words>"`,
`postgres://user:pass@host`, `GOOGLE_CLIENT_SECRET=GOCSPX-...`, etc.) on every
tracked text file: **0 matches with real values**. All hits were variable
NAMES referenced from documentation, env templates, source code
(`process.env.RESEND_API_KEY`), or Cloudflare bindings (`env.SUI_MNEMONIC`).

`gitleaks` is not installed (`command not found: gitleaks`). The regex sweep
above is the substitute. If you want belt-and-suspenders before push,
`brew install gitleaks && gitleaks detect --source . --no-banner` is a
30-second job.

---

## 4. History scan (all refs, all commits)

Command:

```
git log --all -p --no-merges | grep -nE '<token regexes above>'
```

Result: **0 matches** for high-entropy tokens.

Targeted check for the three files most often committed by accident:

- `git log --all --full-history -- onara/api/.dev.vars` -> empty (never tracked)
- `git log --all --full-history -- web/.env.local web/.env web/.env.vercel .env.vercel` -> empty
- `git log --all --full-history -- .secrets/talise-suins-operator.txt` -> empty

`git stash list` -> empty.
`git reflog` shows clean commit-only history for the last 10 entries; no stash
applies and no destructive rewrites.

All `SUI_MNEMONIC` references in history are variable-name usages in source
files (e.g. `const { SUI_MNEMONIC } = env<Bindings>(c)` in
`onara/api/src/app.ts`). The string `RESEND_API_KEY=re_...` appears once in
history inside an env-example block as `RESEND_API_KEY=re_...` with literal
ellipsis, not an actual key.

---

## 5. `.gitignore` gap analysis

Current `.gitignore` (root) is in good shape. Coverage matrix:

| Concern                          | Covered? | By rule                                       |
| -------------------------------- | -------- | --------------------------------------------- |
| `.env`, `.env.local`             | yes      | lines 14, 15                                  |
| `.env.*.local`                   | yes      | line 16                                       |
| `.env.production`                | partial  | only via `.env.*.local`; bare `.env.production` would NOT be ignored |
| `.env.vercel`                    | yes      | line 76                                       |
| `.dev.vars`                      | yes      | line 17                                       |
| `*.pem`, `*.key`                 | yes      | lines 18-19, with `!*.example` exception      |
| `.vercel/`                       | yes-ish  | line 75 (`.vercel`, unanchored, matches `/.vercel/`); switch to `.vercel/` for clarity |
| `.wrangler/`                     | yes      | line 61                                       |
| `_scratch/`                      | yes      | line 79                                       |
| `.next/`, `dist/`, `build/`      | yes      | lines 7-10                                    |
| `node_modules/`                  | yes      | line 2                                        |
| `.secrets/`                      | yes      | line 70                                       |
| `.claude/`                       | yes      | line 39                                       |
| `.mcp.json`                      | yes      | line 40                                       |

### Recommended additions (3 lines)

Insert under the secrets block (around line 17):

```
.env.production
.env.development
.env.staging
```

(The current `.env.*.local` pattern only covers `.env.production.local` etc.,
not the bare `.env.production` form, which some tools write.)

And, for hygiene, tighten line 75 from:

```
.vercel
.env.vercel
```

to:

```
.vercel/
**/.vercel/
.env.vercel
**/.env.vercel
```

This makes the vercel rule recursive so any future `web/.vercel/` or
`onara/api/.env.vercel` is also ignored. Optional, since none exist today.

Total new lines if both adopted: **6**. Minimum-viable hardening: **3**.

---

## 6. Files NOT to stage in the imminent commit

None of these are listed as untracked by `git status -u`, so none of them
will be staged by `git add .`. They are listed here defensively so you have a
"do-not-touch" reference.

- `/.env.vercel`
- `/web/.env.local`
- `/web/.env`
- `/web/.env.vercel`
- `/onara/api/.dev.vars`
- `/.secrets/talise-suins-operator.txt`
- `/.mcp.json`
- `/.vercel/`
- `/.claude/`
- `/_scratch/`

If you ever use `git add -A` instead of `git add .`, the result is identical
here because every one of the above is gitignored.

---

## 7. Files SAFE to stage

All untracked files in `git status -u` are SAFE. They split into themed
groups:

- **chore (gitignore)**: edits to `.gitignore` (per section 5)
- **feat(email)**: `web/app/api/waitlist/route.ts`, `web/emails/WaitlistConfirmation.tsx`,
  `web/scripts/rasterize-symbol.mjs`, `web/RESEND-SETUP.md`, `web/public/symbol*`,
  `web/app/litepaper/route.ts`, `web/public/litepaper.pdf`, `symbol.svg`
- **feat(infra)**: `.github/workflows/build-gpu-prover.yml`,
  `infra/prover/gpu/BABYSIT.md`, `infra/prover/gpu/DEPLOYMENT-PLAN.md`
- **security**: `audits/2026-05-27-resend-audit.md`,
  `audits/2026-05-27-resend-dns-todo.md`, `audits/2026-05-27-security-fixes.md`,
  `audits/2026-05-27-db-status.md`, `audits/codebase-audit.md`,
  `audits/2026-05-27-secrets-audit.md` (this file),
  `onara/api/SECRETS-ROTATION.md`, `web/TODO-APPATTEST.md`,
  `web/lib/app-attest.ts`, `web/app/api/auth/attest/*` (modified)
- **docs**: `docs/generated/codebase/*.md` (24 files), `docs/product/BUSINESS-MODEL.md`,
  `docs/product/LITEPAPER.pdf`, `docs/archive/LITEPAPER.old.md`
- **refactor (repo reorg)**: the `R` and `RM` renames into
  `archive/legacy/zklogin/`, `docs/architecture/`, `docs/archive/`,
  `docs/product/`, `docs/security/`, `infra/prover/`. Plus `archive/README.md`.
- **move**: `move/talise/UPGRADE-DRY-RUN.md`, modifications to
  `move/talise/sources/auto_swap.move` and `move/talise/SECURITY-V7.md`
- **ios**: `ios/Talise/Auth/BiometricGate.swift` (new) plus modifications to
  `ZkLoginCoordinator.swift`, `EarnView.swift`, `VaultWithdrawSheet.swift`,
  `ProfileView.swift`, `SendFlowView.swift`, `SendReviewView.swift`,
  and the `M` set already in the working-tree status
- **web (misc)**: `web/components/Diamond.tsx`, `web/lib/economics.ts`,
  `web/scripts/recover-stranded.mjs`

All scanned for secret patterns: clean.

---

## 8. Rotation list

| Key                          | Reason                                                      | Priority |
| ---------------------------- | ----------------------------------------------------------- | -------- |
| `RESEND_API_KEY`             | User pasted the live key (`re_<redacted>`) into chat. Treat chat transcripts as eventually-leaked; rotate. | P0 |
| Anything else in history     | None found — no rotation needed                             | n/a      |

How to rotate: Resend dashboard -> API Keys -> revoke the exposed key, create
a new one named `talise-prod-2026-05-27`, paste into
`vercel env add RESEND_API_KEY production` (and `preview` / `development` if
they each have one), and into `web/.env.local`. Then redeploy.

No other key in `web/.env.local`, `onara/api/.dev.vars`, or `.env.vercel` has
been observed leaving the machine, so they do NOT require rotation as part of
this push. (They should rotate on a normal cadence, but that is outside this
audit.)

---

## 9. Recommended commit plan

Themed, in dependency order. Each is independently reviewable.

1. **chore(gitignore): close `.env.production` and recursive `.vercel/` gaps**
   - Edit `.gitignore` per section 5.
2. **feat(email): waitlist confirmation email + logo rasterization**
   - `web/app/api/waitlist/route.ts`, `web/emails/WaitlistConfirmation.tsx`,
     `web/scripts/rasterize-symbol.mjs`, `web/public/symbol*`,
     `web/RESEND-SETUP.md`, `web/.env.example` (modified), `symbol.svg`,
     `web/app/litepaper/route.ts`, `web/public/litepaper.pdf`
3. **feat(infra): GPU prover deployment plan + workflow + Caddy auth**
   - `.github/workflows/build-gpu-prover.yml`,
     `infra/prover/gpu/BABYSIT.md`, `infra/prover/gpu/DEPLOYMENT-PLAN.md`
4. **security: P0/P1 audit fixes (App Attest, attestation challenge, sponsor policy)**
   - `web/lib/app-attest.ts`, `web/app/api/auth/attest/challenge/route.ts`,
     `web/app/api/auth/attest/register/route.ts`,
     `web/app/api/onramp/session/route.ts`,
     `web/app/api/tx/record/route.ts`,
     `web/app/api/zk/sponsor-execute/route.ts`,
     `onara/api/src/app.ts`, `onara/api/policies/*.ts`,
     `onara/api/policies/talise.json`, `onara/api/wrangler.jsonc`,
     `onara/api/SECRETS-ROTATION.md`, `web/TODO-APPATTEST.md`,
     `audits/2026-05-27-*.md`, `audits/codebase-audit.md`,
     `audits/2026-05-27-secrets-audit.md`
5. **docs: codebase map + business model + zkLogin prover docs**
   - `docs/generated/codebase/*.md`, `docs/product/BUSINESS-MODEL.md`,
     `docs/product/LITEPAPER.pdf`, `docs/archive/LITEPAPER.old.md`
6. **refactor: repo reorganization (zklogin->archive, docs subfolders, prover->infra)**
   - All `R`/`RM` renames in `git status`. `archive/README.md`.
7. **move: auto_swap upgrade dry-run + SECURITY-V7 notes + lint cleanup**
   - `move/talise/UPGRADE-DRY-RUN.md`,
     `move/talise/sources/auto_swap.move`, `move/talise/SECURITY-V7.md`
8. **ios: BiometricGate + Send/Earn/Vault wraps + zkLogin coordinator fixes**
   - `ios/Talise/Auth/BiometricGate.swift` (new) and all `M` swift files in
     `ios/Talise/Features/*` and `ios/Talise/Auth/`

Run order: 1, then any order. If you prefer one bigger commit, the merged
diff still contains zero secret material.

---

## Appendix A: tooling notes

- `gitleaks` not installed on host; recommend installing
  (`brew install gitleaks`) for a second-opinion sweep before push.
- `git ls-files` count: 441 tracked files.
- Working tree contains 115 modified/untracked entries; all scanned.
