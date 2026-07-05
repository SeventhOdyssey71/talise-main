# Talise CLI

`talise` — the Talise wallet in your terminal. Hold dollars, send to a name,
earn, and cash out; drive it with explicit commands or plain English through the
same DeepSeek agent the app uses. Built so autonomous **agents can pay each
other** in real dollars on Sui, settling in under a second, gasless.

Same backend as the mobile app (`app.talise.io`), same non-custodial zkLogin —
your signing key lives on your machine, never on a server.

See **[PLAN.md](PLAN.md)** for the architecture and roadmap.

## Install

```bash
cd cli
npm install
npm run build
npm link          # puts `talise` on your PATH (or: node dist/index.js …)
```

Requires Node 22+.

## Sign in

```bash
talise login       # opens your browser, signs in with Google, stores a
                   # local session in ~/.talise/session.json (mode 0600)
talise whoami
```

## Money

```bash
talise balance
talise activity --limit 10
talise resolve @alice
talise send 5 @alice                 # confirm, then sign locally + submit
talise send 5 0xabc…def --asset SUI
talise request 20 --note "lunch"     # mint a shareable payment link
```

## Natural language (DeepSeek)

```bash
talise ask "send 5 dollars to alice and make me a link for 20"
talise chat                          # interactive assistant
```

The agent answers in plain English and, for money asks, proposes a plan you
confirm before anything signs — exactly like the app.

## Agent-to-agent

An agent is a headless install with a provisioned session. Provision once, then
run non-interactively:

```bash
# On the agent host — provision (either of these):
talise login                                   # interactive, once
export TALISE_SESSION="$(talise session export)"   # or inject via env

# Identity another agent can pay to:
talise agent whoami --json
# → {"cli":"talise","protocol":"talise-a2a/1","address":"0x…","handle":"svc","payTo":"@svc"}

# Pay another agent for a job (non-interactive needs --yes):
talise agent pay --to @serviceB --amount 0.25 --memo "inference:req_123" --yes --json
# → {"ok":true,"kind":"send","digest":"…","suiscan":"…","memo":"inference:req_123"}

# See who paid you:
talise agent recv --json
```

The memo rides in the on-chain payment receipt so the payee can reconcile the
payment against the job it settles.

## Flags

| flag | meaning |
|------|---------|
| `--json` | machine output on stdout, human logs on stderr |
| `--yes`, `-y` | skip confirmation (required to move money non-interactively) |
| `--base-url` | override the API host (must be a `talise.io` host) |
| `--quiet`, `-q` | suppress human chatter |

## Safety

- Session file is `0600`; secrets are never printed, even with `--json`.
- Moving money non-interactively **requires `--yes`** — a stray script can't
  drain a wallet.
- The CLI is a client: server-side send limits, compliance screening, and the
  private-beta allowlist all still apply. It can't bypass any of them.
- `--base-url` is restricted to `talise.io` hosts so a poisoned env can't
  exfiltrate your bearer.

## Backend

`talise login` uses a browser-loopback OAuth flow served by
`web/app/api/auth/cli/start` + the `cli.` branch in `web/app/auth/callback`.
Both reuse the existing zkLogin machinery; no money endpoint is touched.
