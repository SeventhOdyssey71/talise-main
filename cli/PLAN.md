# Talise CLI — Plan

`talise` — the Talise wallet in your terminal. Everything the mobile app can do
(hold dollars, send to a name, earn, cash out), driven either by explicit
commands or by plain English through the same DeepSeek agent the app uses. Built
so that **autonomous agents can hold a Talise identity and pay each other**
without a human in the loop.

Same backend as iOS/Android/web: `https://app.talise.io`. Non-custodial by the
same zkLogin design — the signing key lives on your machine, never on a server.

---

## 1. Why a CLI

Three audiences, one tool:

1. **Power users / devs** — move money without opening the app; scriptable.
2. **CI / backends** — pay out programmatically (payroll runs, refunds) from a
   provisioned session, no browser.
3. **AI agents** — an agent with a Talise identity can pay another agent for a
   service (an API call, a compute job, a dataset) over real dollars on Sui,
   settling in under a second, gasless. This is the headline capability:
   **agent-to-agent payments**.

---

## 2. The hard constraints (from the backend)

The CLI is shaped by how Talise actually signs and authenticates. These are
facts read out of the codebase, not assumptions:

- **Non-custodial hybrid signing.** A send is: the client holds the **ephemeral
  Ed25519 key** and signs the transaction bytes; the server holds the OIDC
  **JWT + salt** (in `mobile_sessions`) and assembles the zkLogin proof, then
  broadcasts. Neither side alone can move funds.
  - Pipeline (plain USDsui, gasless): `POST /api/send/sponsor-prepare {to,amount,asset}`
    → `{ bytes }` → sign `bytes` locally with the ephemeral key → `POST
    /api/send/gasless-submit { bytesB64, ephemeralPubKeyB64, maxEpoch,
    randomness, userSignature }` → `{ digest }`.
- **The signing binding.** The zkLogin proof only verifies if the JWT's `nonce`
  equals `poseidon(ephemeralPubKey, maxEpoch, randomness)`. So the client must
  sign with the **exact** `(ephemeralPubKey, maxEpoch, randomness)` triple that
  was bound at sign-in. The CLI must capture and persist that triple at login.
- **Auth is a bearer token** issued by the mobile auth flow, sent as
  `Authorization: Bearer <token>` plus an `X-Talise-Mobile: 1` header so the
  server uses the mobile signing context (`mobileSigningContext`) rather than
  the web signing cookie.
- **App-access allowlist.** Every value-moving call runs `denyUnlessAppApproved`.
  A brand-new account can read but not send until allowlisted. The CLI surfaces
  that 403 clearly rather than looking broken.
- **The agent already speaks intents.** `POST /api/chat/stream` (DeepSeek, SSE)
  answers in natural language AND emits a single-line JSON **Payment Intent**:
  `{"steps":[{"kind":"send","amount":50,"recipient":"alice@talise"}],"rationale":"…"}`.
  Step kinds: `send`, `swap`, `save`, `withdraw`, `cash_out`, `request`. The CLI
  parses that intent and executes each step against the same APIs the app uses.

---

## 3. Auth: how the CLI logs in

Two paths, because humans have a browser and agents do not.

### 3a. Human login — browser loopback (like `gh auth login`)

1. CLI generates an ephemeral Ed25519 keypair; keeps the 32-byte secret local.
2. CLI starts a loopback HTTP server on `http://127.0.0.1:<port>` with a random
   CSRF token.
3. CLI opens the browser to `GET /api/auth/cli/start?ephemeralPubKey=<b64url>&port=<port>&csrf=<tok>`.
4. Backend `/api/auth/cli/start` (new, mirrors `/api/auth/mobile/start`):
   generates `maxEpoch` + `randomness`, computes the zkLogin nonce, stashes the
   binding, encodes `cli.<port>.<csrf>.<rand>` as the OAuth `state`, redirects to
   Google.
5. Google → `/auth/callback`. The callback sees the `cli.` state prefix (new
   branch, additive), completes sign-in (mints bearer, persists jwt+salt+binding
   to `mobile_sessions`), and redirects to
   `http://127.0.0.1:<port>/cb?token=…&userId=…&maxEpoch=…&randomness=…&csrf=…`.
6. CLI loopback validates `csrf`, writes the session to `~/.talise/session.json`
   (mode 0600): `{ bearer, userId, address, ephemeralSecretB64, ephemeralPubKeyB64,
   maxEpoch, randomness }`. Private key never leaves the machine.

Standard OAuth-for-CLI (loopback + state/CSRF). The bearer travels only to
localhost. Backend delta is small and additive: one new route + one new branch
in the existing callback. No money path touched.

### 3b. Agent / headless — provisioned session

An agent is just a headless CLI with a session already on disk:

- A human runs `talise login` once for the agent's account (or `talise session
  export` / `import` to move `session.json` to the agent host), OR sets the
  session via env for ephemeral runtimes (`TALISE_SESSION` = base64 of the JSON,
  or `TALISE_TOKEN` + companion binding vars).
- The agent then runs `talise pay …`, `talise agent pay …` fully
  non-interactively with `--json`. No browser, no prompts.

### 3c. (Phase 2, optional) Server-signed agent wallets

For agents that must run with **no local key at all**, add a server-side agent
signer: an `agent_session` where the backend also generates and custodies the
ephemeral key, exposing `POST /api/agent/pay` that does prepare→sign→submit
entirely server-side from a scoped, revocable agent API token. Custodial, so
gated behind explicit provisioning + per-token spend caps. Speced here, built
later — the local-key model (3b) covers agent-to-agent today without new money
endpoints.

---

## 4. Command surface

```
talise login                     browser loopback sign-in
talise logout                    wipe local session
talise whoami                    address, @handle, email
talise balance                   USDsui + SUI + total USD   [--json]
talise activity [--limit N]      recent transactions        [--json]
talise resolve <name|@handle>    resolve a recipient to a 0x address

talise send <amount> <recipient> money send                [--asset USDsui|SUI] [--yes] [--json]
talise pay …                     alias of send
talise swap <amount> <from> to <to>
talise save <amount> [--venue navi|deepbook]
talise withdraw <amount> [--venue …]
talise request <amount> [--note …]           mint a payment link
talise cashout <amount>                       to linked NGN bank

talise ask "<natural language>"  one-shot: agent answers, shows intent, runs on confirm   [--yes] [--json]
talise chat                      interactive REPL with the agent (streamed)

talise agent pay --to <r> --amount <n> [--memo …] --json    non-interactive a2a payment
talise agent recv --json         watch/print inbound settlements (poll activity)
talise agent whoami --json       machine identity block for discovery/handshake
talise session export|import     move a provisioned session between machines
```

Global flags: `--json` (machine output on stdout, logs on stderr), `--yes`
(skip confirmation — required for non-interactive money moves), `--base-url`
(override for staging), `--quiet`.

---

## 5. Natural language (DeepSeek)

`talise ask` / `talise chat` POST the conversation to `/api/chat/stream` and
render the streamed reply. The agent grounds itself in the caller's real
balance/activity/yield (server hydrates it) and, for money asks, emits the
intent JSON line. The CLI:

1. Streams and prints the human-readable reply.
2. Extracts the trailing `{"steps":[…]}` line.
3. Renders the plan ("sending $50 to alice@talise — proceed?").
4. On confirm (or `--yes`), runs each step through the **intent executor**
   (§6). Multi-step intents run in order; any failure stops and reports.

This is exactly the app's flow (answer + intent + Accept), so behavior matches.

---

## 6. Intent executor

One function maps an intent step to the real API call the app uses:

| step        | pipeline |
|-------------|----------|
| `send`      | resolve recipient → `sponsor-prepare` → local sign → `gasless-submit` → digest |
| `swap`      | `/api/wallet/sweep` (or swap-prepare) → sign → submit |
| `save`      | supply-prepare (NAVI/DeepBook) → sign → `zk/sponsor-execute` |
| `withdraw`  | withdraw-prepare → sign → execute |
| `cash_out`  | `sponsor-prepare {sponsorFallback:true}` → sign → submit → Linq off-ramp record |
| `request`   | `POST /api/requests` (no signing — mints a link) |

Recipient resolution accepts `@handle`, `handle`, `handle@talise`,
`name.sui`, `name.talise.sui`, or a raw `0x…` address, via `/api/recipient/resolve`
(verbatim — never rewrite the handle, per the agent rules).

Local currency: when the user speaks in NGN etc., the agent returns
`localAmount`+`localCurrency`; the executor trusts the agent's USD `amount`
(computed from the Talise rate the server injected) so it lands correctly.

---

## 7. Signing (local, non-custodial)

`@mysten/sui` `^2.16` (matches web). The ephemeral key is an `Ed25519Keypair`
rebuilt from the stored 32-byte secret. To sign a prepared tx:

```
const kp = Ed25519Keypair.fromSecretKey(secret);           // 32-byte seed
const { signature } = await kp.signTransaction(fromB64(bytes));  // = userSignature
const ephemeralPubKeyB64 = toB64(kp.getPublicKey().toRawBytes());
```

`signTransaction` applies the Sui intent prefix + Blake2b-256 exactly as the
app does. The server assembles `userSignature` + the zkLogin proof (minted from
its JWT+salt and the matching `maxEpoch`/`randomness`) and broadcasts. If the
server returns `session_rebind_required` (JWT can no longer prove), the CLI
tells the user to `talise login` again.

---

## 8. Agent-to-agent, concretely

Two agents, each a Talise account with a provisioned session:

- **Discovery/handshake**: `talise agent whoami --json` emits
  `{ address, handle, cli:"talise" }`. Agent A learns Agent B's `@handle` or
  `0x` address out of band (a registry, a service manifest, an MCP tool result).
- **Pay**: Agent A runs `talise agent pay --to @serviceB --amount 0.25 --memo
  "inference:req_123" --json` → `{ ok:true, digest, to, amount }`. Sub-second,
  gasless. The memo rides in the Payment Kit receipt nonce so B can reconcile.
- **Receive/verify**: Agent B runs `talise agent recv --json` (polls
  `/api/activity`, prints new inbound settlements) or checks the digest on
  Suiscan. B releases the paid-for resource once it sees the settlement.

Because settlement is real on-chain USDsui and final in under a second, this is
a clean primitive for metered, pay-per-call agent economies.

---

## 9. Security

- Session file `~/.talise/session.json` is mode 0600; never logged; `--json`
  never emits secrets. `talise logout` shreds it.
- The ephemeral key is per-install and expires with `maxEpoch` (~48h horizon);
  re-login re-binds. A leaked session can sign only until the epoch lapses and
  only within the account's send limits + app-access gate.
- Non-interactive money moves REQUIRE `--yes`; without it the CLI refuses in a
  non-TTY so a stray script can't drain a wallet.
- Respects the same server-side rails: rolling send limits, compliance
  screening, allowlist. The CLI is a client — it cannot bypass any of them.
- `--base-url` is validated to be a `talise.io` host (or explicit
  `TALISE_ALLOW_INSECURE=1` for local dev) so a poisoned env can't exfiltrate a
  bearer to a foreign host.

---

## 10. Build phases

- **Phase 0 — scaffold**: package, config/session store, HTTP client, output
  formatter, arg router. *(this repo)*
- **Phase 1 — read + identity**: `login` (loopback + new backend route),
  `logout`, `whoami`, `balance`, `activity`, `resolve`. *(this repo)*
- **Phase 2 — natural language**: `ask`, `chat` over `/api/chat/stream`;
  intent parser. *(this repo)*
- **Phase 3 — payments**: local signer; `send`/`pay`, intent executor for
  `send` (+ `request`); `--json` money output. *(this repo)*
- **Phase 4 — agent-to-agent**: `agent pay|recv|whoami`, `session export|import`,
  non-interactive guards. *(this repo)*
- **Phase 5 — full money parity**: `swap`, `save`, `withdraw`, `cashout`
  executors over the Onara-sponsored rail (kind → `/api/zk/sponsor` → local sign
  → `/api/zk/sponsor-execute`); direct commands + intent-executor wiring.
  *(this repo)*
- **Phase 6 — remaining parity**: streams / payroll batch; server-signed agent
  wallets (§3c).

---

## 11. Layout

```
cli/
  PLAN.md              this file
  README.md            install + usage
  package.json         @talise/cli, bin: talise
  tsconfig.json
  src/
    index.ts           entry + arg routing
    config.ts          ~/.talise session store, base-url resolution
    http.ts            fetch wrapper (bearer + mobile header, error mapping)
    signer.ts          ephemeral zkLogin signing
    auth.ts            login loopback flow, logout
    intents.ts         intent executor (step → api)
    format.ts          human + --json output, confirm prompt
    stream.ts          SSE reader for /api/chat/stream
    commands/*.ts      one file per command
web/app/api/auth/cli/start/route.ts    new CLI OAuth kickoff
web/app/auth/callback/route.ts         + additive `cli.` branch
```
