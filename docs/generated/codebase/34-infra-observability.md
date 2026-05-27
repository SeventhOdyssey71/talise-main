# 34. Observability, Crons, and Health

What we collect, where it lives, what to watch.

## Logging

No Sentry, DataDog, or Axiom integration today. Server-side logs go to:

- `stdout` from Next.js API routes -> Vercel runtime logs
  (`vercel logs --prod --since 1h`).
- Onara worker -> Cloudflare Workers logs (separate dashboard).
- GPU prover (when running) -> Caddy access logs at
  `/var/log/caddy/zklogin-prover.log` (rotated 100MB, 7 files), plus
  `docker logs zklogin-prover` on the GPU box.

No log drain configured on Vercel. To centralise, install a Vercel log
integration (Axiom, BetterStack) and route the greppable lines into it.

Greppable conventions (intentionally low-cardinality):

- `[zk-prover] role=primary|fallback backend=gpu|shinami|mysten attempt=N status=NNN ms=NNN` from `web/lib/zksigner.ts:255-272`.
- `[auto-swap-sweep] users_with_vault=N ...` from the cron handler.
- `[auto-swap-sweep] caps: shared=N user_owned=N skipped_invalid=N` per tick.
- `[auto-swap-sweep] caps_v2: shared=N caps_v1_pending_migration=N swept_v2=N` per tick (v7).

## Cron jobs

Declared in `web/vercel.json`:

```json
{ "crons": [
    { "path": "/api/cron/auto-swap-sweep", "schedule": "* * * * *" }
] }
```

That's the only cron. It runs every minute. Handler:
`web/app/api/cron/auto-swap-sweep/route.ts`.

### What auto-swap-sweep does

Every minute, for up to 80 users per tick (`MAX_USERS_PER_TICK` at
line 52):

1. Reads users with a recorded `talise_vault_id` from the DB.
2. For each user, walks two cap-discovery streams: legacy v1
   `AutoSwapCap<T>` (owned objects) and v7 `AutoSwapCapV2<T>` (event-
   driven via `AutoSwapEnabled` and `CapUpgradedToV2` events).
3. For each `Coin<T>` or accumulator slot at the vault's address, if it
   matches an active v2 cap's source type, POSTs to Onara's
   `/receive-from-accumulator` (or `/receive-and-deposit` for true
   owned coins) to fold the balance into the vault's bag.
4. USDsui-typed slots take a faster path:
   `/receive-from-accumulator-to-owner` flushes them directly to the
   user's wallet without going through the bag.
5. After folding, walks the vault's bag balances and dispatches each
   non-USDsui balance with a matching active v2 cap to Onara's
   `/auto-swap` endpoint. Onara composes the PTB
   `vault::auto_swap_extract_v2 -> Cetus -> vault::auto_swap_deposit_to_owner_v2`,
   signs as the registered admin, and broadcasts.

The handler skips balances under `DUST_FLOOR_RAW = 100_000` (line 46):
$0.0001 USDC, 0.0001 SUI, 0.0001 USDsui. Below that, swap fees would
exceed proceeds.

Per-user errors are caught and logged; one bad user does not abort the
tick. The handler returns a JSON summary with `scanned`, `swept`,
`failed`, `claimed`, `caps_v2`, `caps_v1_pending_migration`, etc.

### Authentication

Cron handler at line 57-62:

```ts
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
```

Vercel auto-attaches `Authorization: Bearer <CRON_SECRET>` when invoking
declared crons. To manually invoke for testing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://talise.io/api/cron/auto-swap-sweep
```

### The CapUpgradedToV2 event gotcha

Critical operational detail. Sui pins event Move type tags to the
package id at which the struct was DEFINED, not the original-id of the
upgrade chain. The struct `CapUpgradedToV2` was first defined in v7,
so its event type tag is:

```
${packageIdLatest}::auto_swap::CapUpgradedToV2
```

NOT:

```
${packageId}::auto_swap::CapUpgradedToV2    // wrong, returns zero rows
```

This was verified empirically against mainnet. The cron's
`readActiveCapsV2` function (line 542 onward) uses
`packageIdLatest` for both the struct type prefix (line 557) and the
`CapUpgradedToV2` event query (line 609). The same applies to the v2
cap object type tag itself: `AutoSwapCapV2<T>` is also pinned to the
package version where it was first introduced.

By contrast, the `AutoSwapEnabled` event was defined in v1, so its
type tag uses the original `packageId`. The cron uses `packageId`
(not `packageIdLatest`) for that event query (line 620).

If you ever see `caps_v2: shared=0` on every tick despite users having
upgraded their caps, the most likely cause is querying the
`CapUpgradedToV2` event type tag with the original `packageId` prefix.
Fix by ensuring both `TALISE_AUTOSWAP_PACKAGE_ID` and
`TALISE_AUTOSWAP_PACKAGE_LATEST` are set correctly in Vercel and that
the code uses the right one per event.

## Health endpoints

| URL                                | Returns                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `https://talise.io/api/health`     | Web app liveness. Cheap.                              |
| `https://zk-prover.talise.io/healthz` | GPU prover container healthcheck. The Docker `HEALTHCHECK` in `infra/prover/gpu/Dockerfile.talise:44-45` hits this same path. |
| `https://zk-prover.talise.io/warmup` | Loads the zkey into VRAM. POST it after deploy to avoid the first end-user paying the ~15s cold-load. |
| Sui RPC: `https://fullnode.mainnet.sui.io` | External; relied on by every chain-reading handler. |
| Onara: `${ONARA_URL}/health`       | Sponsor service liveness. |

The web app does NOT do a startup health probe against Shinami, Onara,
or the GPU prover. Each first request on a cold function instance is
the de-facto canary.

## What to monitor in production

Stack-rank by impact:

1. **zkLogin sign-in success rate**. Aggregate `[zk-prover] role=primary`
   lines by `status`. A drop in 200s with a spike in `timeout` or `5xx`
   is the leading indicator of prover health.
2. **Fallback rate**. Count `[zk-prover] role=fallback` divided by
   `role=primary backend=gpu`. Steady-state target <1%; rollback
   threshold >5%.
3. **Cron health**. `[auto-swap-sweep] users_with_vault=N` per tick:
   should match the Postgres `users` table (previously libSQL/Turso).
   Drop to zero means DB connectivity broke. A spike in `failed` or
   `claim_failed` means Onara is wobbly.
4. **`caps_v1_pending_migration` drain**. Should fall over time as
   users sign the iOS migration banner. Plateau means the prompt isn't
   firing.
5. **Sui RPC latency**. The cron uses `fullnode.mainnet.sui.io` with
   8s timeouts; if slow, switch `SUI_RPC_URL` to a private RPC.
6. **GPU prover host** (when active). SSH in: `docker logs --tail 200
   zklogin-prover` for panics, `nvidia-smi` for GPU state, `systemctl
   status caddy` for cert health, `/var/log/caddy/zklogin-prover.log`
   for unusual request patterns.

## Error reporting

Today: `console.error` -> Vercel logs. There is no Sentry, no PagerDuty
wire-up, no on-call rotation tooling. If you want page-on-error, the
two reasonable shapes are:

- Wire a Vercel log drain to BetterStack/Axiom with an alert on
  `[zk-prover] ... status=5..` or `[auto-swap-sweep] ... read-error`.
- Add a tiny CloudWatch synthetic canary (the runbook
  `infra/prover/gpu/RUNBOOK.md` Section f sketches this) that
  runs a real proof every 5 minutes and pages on failure.

Neither is implemented in the repo today.

## Useful one-liners

```bash
# Tail GPU prover lines from Vercel logs
vercel logs --prod --since 1h | grep "\[zk-prover\]"

# Find cron failures in the last 24h
vercel logs --prod --since 24h | grep "\[auto-swap-sweep\].*failed"

# Confirm the cron is firing
vercel logs --prod --since 5m | grep "users_with_vault"

# Hit the GPU prover health from a laptop
curl -fsS https://zk-prover.talise.io/healthz

# Warm the GPU prover after a deploy
curl -fsS -X POST https://zk-prover.talise.io/warmup --data '{}' \
  -H 'content-type: application/json'

# Manually invoke the auto-swap-sweep (requires CRON_SECRET)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://talise.io/api/cron/auto-swap-sweep | jq
```
