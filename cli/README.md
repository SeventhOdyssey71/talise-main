# Talise CLI

`talise` — the Talise wallet in your terminal. Hold dollars, send to a name,
earn, and cash out; drive it with explicit commands or plain English through the
same assistant the app uses. Built so autonomous **agents can pay each other**
in real dollars on Sui, settling in under a second, gasless.

Same backend as the mobile app (`app.talise.io`), same non-custodial zkLogin —
your signing key lives on your machine, never on a server.

See **[PLAN.md](PLAN.md)** for the architecture and roadmap.

## Why a CLI

A wallet with a great app still can't be *scripted*. The CLI exists because
money should be programmable the way everything else in a terminal is:

- **Devs move money without leaving the shell** — check a balance, pay a
  contractor, mint a payment link, all pipeable and `--json`-friendly.
- **Backends pay out programmatically** — payroll runs, refunds, and rebates
  from a provisioned session, no browser, no human tapping Accept.
- **AI agents transact.** This is the headline: an agent with a Talise identity
  can pay another agent for a service — an API call, a compute job, a dataset —
  in real dollars that settle on Sui in under a second, gasless. That turns
  "agents that talk" into "agents that trade." The mobile app can't do this; a
  CLI is the natural home for machine-to-machine money.

Everything the app can do, the terminal can now do too — and a few things the
app can't.

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
talise swap 2 SUI                    # swap SUI/USDC/DEEP → USDsui
talise save 10 --venue navi          # supply to a yield venue
talise withdraw --venue navi         # pull your position (or: withdraw 5)
talise cashout 20                    # cash out to your linked NGN bank
```

Every money verb resolves + confirms, signs **locally** with your ephemeral
key, and submits through the sponsored rail — `send` uses the gasless rail,
`swap`/`save`/`withdraw`/`cashout` use the Onara-sponsored rail. The natural
language layer (`ask`/`chat`) runs the exact same executors.

## Natural language

```bash
talise ask "send 5 dollars to alice and make me a link for 20"
talise chat                          # interactive assistant
```

The assistant answers in plain English and, for money asks, proposes a plan you
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
