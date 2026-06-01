import postgres, { type Sql } from "postgres";

/**
 * Talise database layer — Postgres.
 *
 * The application historically used libsql; this module preserves the
 * libsql-style API (`db().execute({sql, args})`, `db().batch([...], "write")`)
 * so the rest of the codebase didn't need to change during the migration.
 * Internally everything runs against Postgres via the `postgres` driver.
 *
 *   • `?` placeholders are auto-rewritten to `$1, $2, ...` at execute time
 *   • `execute()` returns `{ rows, rowsAffected }` — the shape callers expect
 *   • `batch()` runs the array of statements inside a single transaction
 *
 * Connection details come from `DATABASE_URL` (a standard
 * `postgres://USER:PASS@HOST:PORT/DB` URL). `DATABASE_AUTH_TOKEN` is ignored
 * for Postgres deployments; we keep the variable name in place so the libsql
 * fallback path can still be flipped on for local dev if needed later.
 */

/**
 * Table map (last updated 2026-05-29). One line each: what it stores +
 * primary writer. New tables: add a row here when you add to ensureSchema().
 *
 *   users               Canonical account row (zkLogin sub → Sui address,
 *                       profile, referral, points, vault id).
 *                       Primary writer: web/lib/db.ts (upsertUser).
 *
 *   tx_history          One row per on-chain tx surfaced in the activity
 *                       feed. Deduped by digest.
 *                       Primary writer: web/app/api/tx/record/route.ts.
 *
 *   invoices            Merchant-issued USDC invoices (B2C checkout).
 *                       Primary writer: web/app/api/invoices/route.ts.
 *
 *   rewards_events      Append-only ledger of points-awarding events
 *                       (referrals, sends, roundups, redemptions).
 *                       Primary writer: web/lib/rewards/earn.ts.
 *
 *   savings_goals       User-defined savings buckets w/ target + progress.
 *                       Primary writer: web/lib/rewards/goals.ts.
 *
 *   redemptions         Points-spending requests (gift cards, perks).
 *                       Primary writer: web/lib/rewards/redeem.ts.
 *
 *   waitlist            DEAD as of 2026-05-29. Original pre-launch email
 *                       capture; superseded by waitlist_signups. Kept so
 *                       prod rows are reachable for a future export.
 *                       Safe to drop in a P2 cleanup once exported.
 *
 *   waitlist_signups    Canonical waitlist + handle-claim. Email is PK;
 *                       claimed_handle reserves a *.talise.sui SuiNS name
 *                       bound to the user's wallet on first sign-in.
 *                       Primary writer: web/app/api/waitlist/route.ts +
 *                       web/lib/handle-claim.ts.
 *
 *   paga_offramps       Paga USDsui → NGN bank payout state machine.
 *                       Primary writer: web/app/api/offramp/paga/*.
 *
 *   kyc_upgrade_intents Append-only log of tier-upgrade requests + the
 *                       (mock) eKYC verdict. Never mutates users.kyc_tier.
 *                       Primary writer: web/app/api/kyc/route.ts.
 *                       Tier model: web/lib/kyc.ts; eKYC: web/lib/ekyc.ts.
 *
 *   transfers           Corridor-agnostic transfers state machine
 *                       (quoted → debited → onchain_settling →
 *                       onchain_settled → fiat_out_pending → settled,
 *                       + failed/refunded). Generalizes paga_offramps for
 *                       all corridors. Primary writer: web/lib/transfers.ts.
 *
 *   float_pools         Per-corridor, per-currency, per-leg treasury
 *                       float inventory (fiat_in / fiat_out / usdc) with
 *                       a `segregated` safeguarding flag and reconcile
 *                       timestamp. Master plan §6. MODEL ONLY — no live
 *                       money moves through it yet.
 *                       Primary writer: web/lib/treasury.ts.
 *
 *   mobile_sessions     Opaque bearer tokens for the iOS client.
 *                       Created in lib/mobile-sessions.ts; CREATE TABLE
 *                       lives there too, this file only widens its int4
 *                       timestamp columns.
 *
 *   travel_rule_records FATF Travel Rule (master plan §7) audit log of
 *                       above-threshold transfer metadata: route, obligation,
 *                       IVMS-101 payload, Travel Rule network transfer id.
 *                       Primary writer: web/lib/travel-rule.ts
 *                       (recordTravelRuleTransfer). Schema only — NOT yet
 *                       wired into the send path.
 */

// ───────────────────────────────────────────────────────────────────
// Adapter — libsql-shaped API on top of postgres.js

type ExecuteArg = string | { sql: string; args?: ReadonlyArray<unknown> };

type ExecuteResult = {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
};

type BatchStmt = { sql: string; args?: ReadonlyArray<unknown> };

interface DbAdapter {
  execute(arg: ExecuteArg): Promise<ExecuteResult>;
  batch(stmts: ReadonlyArray<BatchStmt>, mode?: "read" | "write"): Promise<ExecuteResult[]>;
}

let _sql: Sql | null = null;
let _adapter: DbAdapter | null = null;
let _schemaReadyP: Promise<void> | null = null;

function getSql(): Sql {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Expected a Postgres connection string like " +
        "`postgres://user:pass@host:port/db`."
    );
  }
  _sql = postgres(url, {
    // Be permissive about TLS so the same code path works whether the host
    // has STARTTLS configured or not. Behaviour:
    //   • URL has `sslmode=disable`            → no TLS
    //   • URL has `sslmode=require`            → require TLS, no cert pinning
    //   • everything else (incl. no override)  → prefer TLS, fall back to plain
    // The pxxl Postgres docker image (`postgres:16-alpine`) doesn't enable
    // TLS by default on its public endpoint; forcing TLS there closes the
    // socket mid-handshake ("Client network socket disconnected before
    // secure TLS connection was established"). `prefer` avoids that.
    ssl: (() => {
      const mode = new URL(url).searchParams.get("sslmode");
      if (mode === "disable") return false;
      if (mode === "require") return { rejectUnauthorized: false };
      return "prefer";
    })(),
    // Modest pool — keep headroom for parallel requests without hammering the
    // ~1G memory pxxl box. Adjust if function concurrency rises.
    max: 8,
    idle_timeout: 30,
    connect_timeout: 10,
    // Don't transform — keep snake_case column names exactly as queried.
    transform: { undefined: null },
    // Silence NOTICE chatter from idempotent migrations. CREATE TABLE
    // IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS each emit
    // a NOTICE on every cold start once the DB is migrated — useful
    // information once, pure log spam after that. Real warnings and
    // errors still propagate as exceptions on the query path.
    onnotice: () => {},
    // Parse BIGINT (oid 20) as a plain JS Number instead of postgres.js's
    // default (BigInt or string). Our BIGINT columns hold millisecond
    // timestamps (~1.78e12) — well under Number.MAX_SAFE_INTEGER (9e15) —
    // and downstream code (`new Date(row.created_at).toISOString()`,
    // formatLocal(), etc.) treats them as numbers. Returning strings was
    // surfacing as "Invalid time value" on /api/rewards/insights and the
    // /earn snapshot.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: number | bigint | string) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  });
  return _sql;
}

/**
 * Rewrite libsql-style `?` placeholders into `$1, $2, ...`. Quoted strings and
 * line/block comments are skipped so a literal `?` inside a string doesn't get
 * mistaken for a placeholder.
 */
function rewritePlaceholders(sql: string): string {
  let out = "";
  let i = 0;
  let n = 1;
  while (i < sql.length) {
    const ch = sql[i];
    // Single-quoted string — skip until the closing quote (handle doubled '').
    if (ch === "'") {
      out += ch;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { out += sql[++i]; i++; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Double-quoted identifier — skip until closing.
    if (ch === '"') {
      out += ch;
      i++;
      while (i < sql.length && sql[i] !== '"') { out += sql[i++]; }
      if (i < sql.length) { out += sql[i++]; }
      continue;
    }
    // Line comment.
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") { out += sql[i++]; }
      continue;
    }
    // Block comment.
    if (ch === "/" && sql[i + 1] === "*") {
      out += sql[i++]; out += sql[i++];
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += sql[i++];
      }
      if (i < sql.length) { out += sql[i++]; out += sql[i++]; }
      continue;
    }
    if (ch === "?") {
      out += `$${n++}`;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function buildAdapter(): DbAdapter {
  if (_adapter) return _adapter;
  const sql = getSql();

  const runOn = async (
    runner: Sql,
    arg: ExecuteArg
  ): Promise<ExecuteResult> => {
    const raw = typeof arg === "string" ? arg : arg.sql;
    const args = typeof arg === "string" ? [] : (arg.args ?? []);
    const rewritten = rewritePlaceholders(raw);
    // `postgres`'s `unsafe()` accepts a placeholder string + values array,
    // which is exactly what the libsql-style API gives us.
    // postgres.js's `unsafe()` types its parameter array as `ParameterOrJSON[]`;
    // libsql's adapter accepts `unknown[]`. The cast bridges the two.
    const result = await runner.unsafe(rewritten, args as never[]);
    const rows = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
    const rowsAffected =
      (result as unknown as { count?: number }).count ?? rows.length;
    return { rows, rowsAffected };
  };

  _adapter = {
    execute: (arg) => runOn(sql, arg),
    batch: async (stmts, _mode) => {
      void _mode;
      // libsql's batch is implicitly transactional. Mirror that with
      // postgres.js's transaction helper.
      return sql.begin(async (tx) => {
        const out: ExecuteResult[] = [];
        for (const s of stmts) {
          out.push(await runOn(tx as unknown as Sql, s));
        }
        return out;
      });
    },
  };
  return _adapter;
}

export function db(): DbAdapter {
  return buildAdapter();
}

// ───────────────────────────────────────────────────────────────────
// Schema migrations — Postgres flavor

export function ensureSchema(): Promise<void> {
  if (_schemaReadyP) return _schemaReadyP;
  _schemaReadyP = doEnsureSchema().catch((err) => {
    _schemaReadyP = null;
    throw err;
  });
  return _schemaReadyP;
}

async function doEnsureSchema(): Promise<void> {
  const c = db();

  // The schema below is grouped into sections. Within each section:
  //   1. CREATE TABLE IF NOT EXISTS for every table the section owns.
  //   2. ALTER TABLE ADD COLUMN IF NOT EXISTS in chronological order
  //      (each ALTER is harmless on a fresh DB because the CREATE above
  //      already includes the column — they exist for old deployments).
  //   3. CREATE INDEX IF NOT EXISTS, scoped to this section's tables.
  //
  // Every statement is idempotent — ensureSchema() is called on every
  // cold start and from dbHealth() repeatedly.
  const stmts: string[] = [
    // ─── auth / users ────────────────────────────────────────────────
    // Canonical account row. One per Google sub. `sui_address` is the
    // user's zkLogin-derived address; `salt` is fetched from Shinami on
    // mainnet and never leaves the server in plaintext. Profile and
    // monetization columns (referral, points, vault id) are bolted on
    // via ALTER — see below.
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      sui_address TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL,
      country TEXT,
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      notified_at BIGINT,
      account_type TEXT,
      business_name TEXT,
      business_handle TEXT UNIQUE,
      business_industry TEXT,
      talise_username TEXT UNIQUE
    )`,
    // Account-type + business profile.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_handle TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_industry TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_on_receive INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS spot_bm_id TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS talise_username TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_registry_id TEXT`,
    // Referral + points.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS points_total INTEGER DEFAULT 0`,
    // Round-up + lifetime tallies.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS roundup_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS roundup_percentage INTEGER DEFAULT 2`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_sent_usd DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_saved_usd DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS roundup_saved_usd DOUBLE PRECISION DEFAULT 0`,
    // AUDIT_PENDING (2026-05-29): the autoswap system was archived to
    // `web/_archive/autoswap-2026-05-29/`. The columns below are
    // dormant — no active code path writes them — but we keep them in
    // the schema so historical `talise_vault_id` values are preserved
    // for any future re-activation or data migration. Do not drop
    // without a separate audit + backup of populated rows.
    //
    // AUDIT_PENDING (vault-collapse, 2026-05-29): once
    // `scripts/drain-vault-to-admin.mjs --execute` finishes pulling
    // every vault's bag balances back to the single admin wallet, the
    // follow-up schema migration should: (1) NULL every
    // `users.talise_vault_id`, (2) drop `talise_vault_subname_repointed`,
    // (3) drop any vault-only dependent tables / indexes. Do not drop
    // in this commit — the drain must complete on-chain first so we
    // retain one revert window.
    //
    // Original purpose: TaliseVault + AutoSwap Path-C. `talise_vault_id`
    // was the user's shared-object vault id, set after they signed the
    // `vault::create()` tx. The repointed flag tracked whether their
    // `@talise` SuiNS subname target had been moved from their plain
    // wallet address to the vault id.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS talise_vault_id TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS talise_vault_subname_repointed INTEGER DEFAULT 0`,
    // KYC tier (master plan §7 compliance). 0 = email-only receive (the
    // implicit default for every existing + new row); 1..3 unlock higher
    // send/corridor limits as the user clears progressively stronger
    // identity checks. The tier model + limit table live in lib/kyc.ts;
    // getUserTier() reads this column and treats NULL as 0. Default 0 so
    // fresh inserts (which don't set it) land at the floor tier.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_tier INTEGER DEFAULT 0`,
    // Indexes on hot read paths. UNIQUE constraints above already cover
    // google_sub / sui_address / business_handle / talise_username
    // lookups; these add coverage for the non-unique reads.
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)`,
    // Unique on columns added via ALTER (CREATE TABLE can't mark them).
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_talise_username ON users(talise_username)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`,

    // ─── tx history / activity feed ──────────────────────────────────
    // One row per on-chain tx we surface in the activity feed. Deduped
    // by digest (UNIQUE). Hot reads: `userTxs()` (by user_id, recent
    // first).
    `CREATE TABLE IF NOT EXISTS tx_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      digest TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      amount TEXT,
      asset TEXT,
      recipient TEXT,
      memo TEXT,
      receipt_object_id TEXT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tx_user ON tx_history(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_created ON tx_history(created_at DESC)`,
    // Composite covers `WHERE user_id = ? ORDER BY created_at DESC` —
    // the only shape `userTxs()` and the activity routes issue. Without
    // it Postgres falls back to idx_tx_user + a sort.
    `CREATE INDEX IF NOT EXISTS idx_tx_user_created ON tx_history(user_id, created_at DESC)`,

    // ─── invoices (merchant B2C checkout) ────────────────────────────
    `CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      business_user_id INTEGER NOT NULL REFERENCES users(id),
      slug TEXT UNIQUE NOT NULL,
      amount_usdc TEXT NOT NULL,
      reference TEXT,
      customer_email TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at BIGINT NOT NULL,
      paid_at BIGINT,
      paid_digest TEXT,
      paid_by_address TEXT
    )`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_object_id TEXT`,
    // P1-3: explicit audit trail of the verified on-chain digest that
    // closed each invoice.
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_digest TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_by_address TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_biz ON invoices(business_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_slug ON invoices(slug)`,

    // ─── rewards: events / goals / redemptions ───────────────────────
    // Append-only ledger of points-awarding events. UI reads "20 most
    // recent for this user".
    `CREATE TABLE IF NOT EXISTS rewards_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      points INTEGER NOT NULL,
      metadata TEXT,
      created_at BIGINT NOT NULL
    )`,
    // User-defined savings buckets.
    `CREATE TABLE IF NOT EXISTS savings_goals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      target_usd DOUBLE PRECISION NOT NULL,
      current_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      deadline_ms BIGINT,
      color TEXT,
      created_at BIGINT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    )`,
    // Points-spending requests.
    `CREATE TABLE IF NOT EXISTS redemptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      sku TEXT NOT NULL,
      points_spent INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT,
      created_at BIGINT NOT NULL,
      fulfilled_at BIGINT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_rewards_user ON rewards_events(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rewards_created ON rewards_events(created_at DESC)`,
    // Covers `SELECT … FROM rewards_events WHERE user_id = ? ORDER BY
    // created_at DESC LIMIT 20` (rewards summary).
    `CREATE INDEX IF NOT EXISTS idx_rewards_user_created ON rewards_events(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_goals_user ON savings_goals(user_id, archived)`,
    `CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_id, created_at DESC)`,

    // ─── waitlist (legacy + canonical) ───────────────────────────────
    // DEAD as of 2026-05-29; superseded by `waitlist_signups` below.
    // No queries remain in web/app or web/lib (verified by grep). Kept
    // in ensureSchema() because pre-launch prod rows are still present —
    // safe to drop in a P2 cleanup once the export is taken.
    // AUDIT_PENDING: confirm zero new writes for 30 days, then DROP.
    `CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL,
      source TEXT,
      invited_at BIGINT
    )`,
    `ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS name TEXT`,
    `ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS country TEXT`,
    `ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS reason TEXT`,
    `ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS confirmation_sent_at BIGINT`,
    `ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS confirmation_message_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC)`,

    // Canonical waitlist. Email is the natural PK so dup detection is a
    // one-line `ON CONFLICT (email) DO NOTHING RETURNING email` in the
    // API route. `ip` / `user_agent` are captured for light abuse
    // triage. `confirmation_sent` flips true only after the Resend send
    // returns ok within the 4s timeout window.
    `CREATE TABLE IF NOT EXISTS waitlist_signups (
      email TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      confirmation_sent BOOLEAN NOT NULL DEFAULT false,
      confirmation_sent_at BIGINT
    )`,
    // Handle-claim columns — Strategy A (reserve-in-DB).
    // `suins-operator.ts` ships only `mintSubname()` (one PTB: mint +
    // set target + transfer to user). It does NOT have a "mint to
    // operator now, transfer later" helper, which would be needed for
    // Strategy B. So at claim time we reserve in DB; the actual
    // on-chain mint runs on first sign-in when we know the user's Sui
    // address — zero gas until users actually show up.
    `ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS claimed_handle TEXT`,
    `ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS handle_claimed_at BIGINT`,
    `ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS handle_object_id TEXT`,
    `ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS handle_bound_user_id TEXT`,
    `ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS handle_bound_at BIGINT`,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_signups_created ON waitlist_signups(created_at DESC)`,
    // Partial-unique on `claimed_handle` so the index ignores the NULL
    // rows (most signups won't claim a handle) but enforces "one handle
    // per claim" the moment a non-NULL value is written.
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_waitlist_claimed_handle
       ON waitlist_signups (claimed_handle) WHERE claimed_handle IS NOT NULL`,

    // ─── paga offramp (USDsui → NGN bank payouts) ────────────────────
    // One row per "USDsui → NGN bank account" payout. The row carries
    // the locked quote (fxRate, ngn/usdsui amounts), the user-provided
    // bank coordinates, the Paga reference once we hand off, and the
    // state-machine status. See `docs/offramp/paga-integration.md`.
    `CREATE TABLE IF NOT EXISTS paga_offramps (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      usdsui_amount NUMERIC NOT NULL,
      ngn_amount NUMERIC NOT NULL,
      fx_rate NUMERIC NOT NULL,
      bank_code TEXT NOT NULL,
      bank_account_number TEXT NOT NULL,
      bank_account_name TEXT,
      paga_reference TEXT,
      status TEXT NOT NULL,
      status_reason TEXT,
      created_at BIGINT NOT NULL,
      debited_at BIGINT,
      settled_at BIGINT,
      failed_at BIGINT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_paga_offramps_user ON paga_offramps(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_paga_offramps_status ON paga_offramps(status, created_at DESC)`,

    // ─── transfers (corridor-agnostic state machine) ─────────────────
    // One row per cross-border / on-ramp / off-ramp / internal transfer.
    // Generalizes paga_offramps: a TTL-locked quote that walks
    //   quoted → debited → onchain_settling → onchain_settled →
    //   fiat_out_pending → settled  (+ failed/refunded)
    // with the on-chain leg as the commit point. A post-commit fiat-out
    // failure sets `parked_funds=TRUE` (funds parked, never lost) so a
    // compensating action can reconcile later. See web/lib/transfers.ts;
    // the legacy Paga rows in paga_offramps are untouched (PAGA_STATE_MAP
    // documents the projection). `metadata` is a JSON blob of per-corridor
    // coordinates (bank, handle, memo).
    `CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      state TEXT NOT NULL,
      source_currency TEXT NOT NULL,
      dest_currency TEXT NOT NULL,
      usdsui_amount NUMERIC NOT NULL,
      source_amount NUMERIC NOT NULL,
      dest_amount NUMERIC NOT NULL,
      fx_rate NUMERIC NOT NULL,
      onchain_digest TEXT,
      provider_reference TEXT,
      state_reason TEXT,
      parked_funds BOOLEAN NOT NULL DEFAULT FALSE,
      metadata TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      debited_at BIGINT,
      onchain_settled_at BIGINT,
      settled_at BIGINT,
      failed_at BIGINT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_user ON transfers(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_state ON transfers(state, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_parked ON transfers(parked_funds, created_at DESC) WHERE parked_funds = TRUE`,

    // ─── roundup_queue (deferred spend-and-save) ─────────────────────
    // When a USDsui send takes the gasless rail (the only USDsui rail
    // now — see sponsor-prepare/route.ts), the round-up NAVI supply
    // leg can NOT be bundled atomically (gasless PTBs are restricted
    // to a single `0x2::coin::send_funds<T>` move call). Instead the
    // submit endpoint enqueues a row here and a cron drains the queue,
    // executing the supply as a separate (sponsored) tx.
    //
    // `processed_at` is NULL while pending; the partial index
    // `idx_roundup_queue_pending` covers the cron's hot read of
    // `WHERE processed_at IS NULL ORDER BY created_at`.
    `CREATE TABLE IF NOT EXISTS roundup_queue (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount_usd DOUBLE PRECISION NOT NULL,
      created_at BIGINT NOT NULL,
      processed_at BIGINT,
      tx_digest TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_roundup_queue_pending
       ON roundup_queue(created_at) WHERE processed_at IS NULL`,

    // ─── float_pools (treasury / corridor inventory) ─────────────────
    // Per-corridor, per-currency inventory balances for the treasury
    // float model (master plan §6). "instant" = pre-positioned float on
    // both legs of a directed corridor, drawn down on authorization and
    // reconciled async behind the user; the on-chain leg is the
    // net-settlement rail BETWEEN these pools.
    //
    // One row per (corridor, currency, leg). A pool tracks three
    // inventory buckets:
    //   • fiat_in_pool   — fiat collected on the send (funding) leg
    //   • fiat_out_pool  — fiat pre-positioned for the payout leg
    //   • usdc_pool      — native USDC inventory used for the on-chain
    //                      net-settlement hop between legs (master plan
    //                      §3: corridor inventory in native USDC, NOT
    //                      USDsui — caps de-peg exposure)
    //
    // `segregated` flags safeguarded CLIENT money. SG MAS MPI / JP FSA
    // safeguarding obligations mean client balances must be held in
    // segregated client-money accounts and — critically — CANNOT be
    // lent into NAVI (master plan §5/§6/§9). Only Talise's OWN operating
    // float (segregated=false) is NAVI-eligible. The treasury helper
    // `assertNotLendable()` enforces this invariant in code.
    //
    // `reconciled_at` is the wall-clock ms of the last reconciliation
    // pass; `needsRebalance()` reads it together with the inventory
    // buckets. Balances here are a MOCK model + invariants, not live
    // treasury ops — no real money moves through this table yet.
    //
    // Writers: web/lib/treasury.ts (recordInflow / recordOutflow /
    // getPoolState / needsRebalance). Mirrors the same idempotent
    // CREATE/ALTER/INDEX discipline as every other section here.
    `CREATE TABLE IF NOT EXISTS float_pools (
      id SERIAL PRIMARY KEY,
      corridor TEXT NOT NULL,
      currency TEXT NOT NULL,
      leg TEXT NOT NULL,
      fiat_in_pool NUMERIC NOT NULL DEFAULT 0,
      fiat_out_pool NUMERIC NOT NULL DEFAULT 0,
      usdc_pool NUMERIC NOT NULL DEFAULT 0,
      segregated BOOLEAN NOT NULL DEFAULT false,
      reconciled_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    // One canonical pool row per (corridor, currency, leg). The treasury
    // helpers upsert against this key, so it must be UNIQUE.
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_float_pools_key
       ON float_pools (corridor, currency, leg)`,
    // Hot read: "which pools are stale / under-funded?" scans by
    // reconciliation recency.
    `CREATE INDEX IF NOT EXISTS idx_float_pools_reconciled
       ON float_pools (reconciled_at)`,

    // ─── kyc_upgrade_intents (compliance §7 tier engine) ─────────────
    // Append-only log of "user asked to move up to tier N" events. One
    // row per POST /api/kyc. `ekyc_ref` is the opaque reference the
    // (mock) eKYC provider hands back; `ekyc_status` is the provider's
    // verdict at intent time (pending|approved|rejected). Recording an
    // intent NEVER mutates users.kyc_tier — promotion is a separate,
    // reviewed write (lib/kyc.ts setUserTier), so a self-service POST
    // can't grant itself a higher limit. The tier model lives in
    // lib/kyc.ts; the eKYC adapter in lib/ekyc.ts.
    `CREATE TABLE IF NOT EXISTS kyc_upgrade_intents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      from_tier INTEGER NOT NULL,
      requested_tier INTEGER NOT NULL,
      ekyc_provider TEXT,
      ekyc_ref TEXT,
      ekyc_status TEXT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_kyc_intents_user
       ON kyc_upgrade_intents(user_id, created_at DESC)`,

    // ─── travel_rule_records (FATF Travel Rule audit log) ────────────
    // Master plan §7: above the ~$1,000 Travel Rule threshold, external
    // transfers must exchange IVMS-101 originator/beneficiary data. This
    // table is the audit log of that compliance metadata — route
    // (INTERNAL / EXTERNAL_VASP / UNHOSTED), the obligation that applied,
    // the IVMS-101 payload (JSON), and the Travel Rule network transfer
    // id once a message has been submitted. Written by
    // `recordTravelRuleTransfer` in web/lib/travel-rule.ts. ADDITIVE only
    // — NOT yet wired into the send path (see TRAVEL_RULE_INTEGRATION_POINT
    // in that module).
    `CREATE TABLE IF NOT EXISTS travel_rule_records (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      route TEXT NOT NULL,
      obligation TEXT NOT NULL,
      amount_usd DOUBLE PRECISION NOT NULL,
      recipient_kind TEXT NOT NULL,
      beneficiary_address TEXT,
      ivms101_json TEXT,
      network_transfer_id TEXT,
      status TEXT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_travel_rule_user ON travel_rule_records(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_travel_rule_created ON travel_rule_records(created_at DESC)`,

    // ─── fast-load snapshot caches (display-only, stale-while-revalidate) ──
    // DURABLE, cross-instance caches that let the hot Home endpoints serve a
    // last-known value in one indexed PK read (~10-50ms) instead of a live
    // Sui chain read (USDsui balance ~600-1800ms, activity scan ~1-3s). The
    // perf-cache.ts memoTtl is in-process only, so cold/other serverless
    // instances re-pay full chain latency — these tables survive cold starts.
    //
    // HARD INVARIANT: these are DISPLAY-ONLY. Nothing here may be consulted
    // for a send/withdraw/sweep build or any limit/eligibility check — those
    // stay on the live chain + the authoritative send_limit ledger. A stale
    // snapshot can only ever mislead a pixel, never the bytes of a tx.
    // `*_refreshed_at` (epoch ms) drives staleness; `*_source` marks where
    // the row came from ('chain' = fresh live read, 'stale' = served past TTL).
    `CREATE TABLE IF NOT EXISTS user_balance_snapshot (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      sui_address TEXT NOT NULL,
      usdsui DOUBLE PRECISION NOT NULL DEFAULT 0,
      sui DOUBLE PRECISION NOT NULL DEFAULT 0,
      sui_price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      wallet_coins_json TEXT,
      source TEXT NOT NULL DEFAULT 'chain',
      refreshed_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    // entries_json mirrors the exact ActivityEntry[] the /api/activity route
    // already serialises, so serving from cache is a verbatim replay.
    `CREATE TABLE IF NOT EXISTS user_activity_snapshot (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      address TEXT NOT NULL,
      limit_n INTEGER NOT NULL DEFAULT 20,
      entries_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'chain',
      refreshed_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    // Tiny global key/value cache for values that are the SAME for every user
    // (e.g. the SUI/USDC spot price). Shared across instances so a cold
    // function never pays the 800-2000ms DeepBook quote on the hot path.
    `CREATE TABLE IF NOT EXISTS global_kv (
      k TEXT PRIMARY KEY,
      v_num DOUBLE PRECISION,
      v_text TEXT,
      refreshed_at BIGINT NOT NULL
    )`,
    // Cache the resolved on-chain *.talise.sui subname so /api/me and the
    // activity counterparty fan-out stop doing cold reverse-SuiNS walks for a
    // near-immutable name. NULL until first resolved.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS suins_subname TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS suins_subname_at BIGINT`,
  ];

  for (const stmt of stmts) {
    try {
      await c.execute(stmt);
    } catch {
      /* idempotent; ALTERs against missing tables on first cold start
         will throw harmlessly — the CREATE above eventually wins. */
    }
  }

  // ─── int4 → int8 widener (cross-section migration) ─────────────────
  // The original Postgres migration shipped briefly with `INTEGER` for
  // ms-precision timestamps; `Date.now()` is ~1.78 trillion today, well
  // beyond int4's ~2.15B limit, so inserts blow up with:
  //   ERROR: value "1779729508821" is out of range for type integer
  // `CREATE TABLE IF NOT EXISTS` won't fix an already-narrow column —
  // need an explicit ALTER. Gate each on `information_schema.columns`
  // so the migration is a no-op once columns are already int8.
  const tsColumns: Array<[string, string]> = [
    ["users", "created_at"],
    ["users", "last_seen_at"],
    ["users", "notified_at"],
    ["tx_history", "created_at"],
    ["invoices", "created_at"],
    ["invoices", "paid_at"],
    ["rewards_events", "created_at"],
    ["savings_goals", "created_at"],
    ["savings_goals", "deadline_ms"],
    ["redemptions", "created_at"],
    ["redemptions", "fulfilled_at"],
    // mobile_sessions is created out-of-band in lib/mobile-sessions.ts
    // but suffers from the same int4 issue — fold it in here so the
    // widener covers it on first cold start.
    ["mobile_sessions", "created_at"],
    ["mobile_sessions", "expires_at"],
    ["mobile_sessions", "max_epoch"],
  ];
  for (const [table, col] of tsColumns) {
    try {
      const r = await c.execute({
        sql: `SELECT data_type FROM information_schema.columns
              WHERE table_name = ? AND column_name = ?`,
        args: [table, col],
      });
      const dt = r.rows[0]?.data_type as string | undefined;
      if (dt === "integer") {
        await c.execute(
          `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE BIGINT USING ${col}::bigint`
        );
      }
    } catch {
      /* table not yet created — fresh DBs get BIGINT from CREATE above */
    }
  }
}

export async function dbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    await ensureSchema();
    await db().execute("SELECT 1");
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}

// ───────────────────────────────────────────────────────────────────
// Domain types + query helpers — unchanged from the libsql version

export type AccountType = "personal" | "business";

export type User = {
  id: number;
  google_sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  sui_address: string;
  salt: string;
  country: string | null;
  created_at: number;
  last_seen_at: number;
  notified_at: number | null;
  account_type: AccountType | null;
  business_name: string | null;
  business_handle: string | null;
  business_industry: string | null;
  talise_username: string | null;
  /** Cached resolved on-chain `<handle>.talise.sui` subname + when (epoch ms). */
  suins_subname?: string | null;
  suins_subname_at?: number | null;
  spot_bm_id?: string | null;
  interests?: string | null;
  notify_on_receive?: number | null;
  payment_registry_id?: string | null;
  referral_code?: string | null;
  referred_by_user_id?: number | null;
  referral_count?: number | null;
  points_total?: number | null;
  roundup_enabled?: number | null;
  roundup_percentage?: number | null;
  lifetime_sent_usd?: number | null;
  lifetime_saved_usd?: number | null;
  talise_vault_id?: string | null;
  talise_vault_subname_repointed?: number | null;
  kyc_tier?: number | null;
};

/**
 * Set the user's `talise_vault_id`. Called from `/api/vault/record` after
 * the user-signed `vault::create()` tx confirms on chain.
 *
 * Idempotent: a second call with the same vault id is a no-op. A second
 * call with a *different* id throws — we expect exactly one vault per
 * user. Callers can pass `{ force: true }` to bypass that check during
 * v1 mainnet migration (re-pointing legacy users to a fresh vault).
 */
export async function setTaliseVaultId(
  userId: number,
  vaultId: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  await ensureSchema();
  const c = db();
  const cur = await c.execute({
    sql: "SELECT talise_vault_id FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  const existing = cur.rows[0]?.talise_vault_id as string | null | undefined;
  if (existing && existing !== vaultId && !opts.force) {
    throw new Error(
      `user ${userId} already has talise_vault_id=${existing}; refusing to overwrite without force`
    );
  }
  await c.execute({
    sql: "UPDATE users SET talise_vault_id = ? WHERE id = ?",
    args: [vaultId, userId],
  });
}

/** Mark the user's SuiNS subname as having been repointed to the vault. */
export async function markVaultSubnameRepointed(userId: number): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE users SET talise_vault_subname_repointed = 1 WHERE id = ?",
    args: [userId],
  });
}

export type RewardsEventKind =
  | "referral_signup"
  | "referral_first_send"
  | "volume_milestone"
  | "first_send"
  | "first_claim"
  | "streak"
  | "send_earn"
  | "save_earn"
  | "roundup_save"
  | "withdraw_earn"
  | "goal_deposit"
  | "redeemed";

export type RewardsEvent = {
  id: number;
  user_id: number;
  kind: RewardsEventKind;
  points: number;
  metadata: string | null;
  created_at: number;
};

export function hasBusiness(user: User): boolean {
  return !!user.business_handle;
}

export async function switchActiveContext(
  userId: number,
  to: AccountType
): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE users SET account_type = ? WHERE id = ?",
    args: [to, userId],
  });
}

export async function addBusinessProfile(
  userId: number,
  input: {
    businessName: string;
    businessHandle: string;
    businessIndustry?: string | null;
  }
): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE users SET
      business_name = ?,
      business_handle = ?,
      business_industry = ?,
      account_type = 'business'
      WHERE id = ?`,
    args: [
      input.businessName,
      input.businessHandle.toLowerCase(),
      input.businessIndustry ?? null,
      userId,
    ],
  });
}

export async function setAccountType(
  userId: number,
  input: {
    accountType: AccountType;
    businessName?: string | null;
    businessHandle?: string | null;
    businessIndustry?: string | null;
    interests?: string[] | null;
    country?: string | null;
    notifyOnReceive?: boolean;
  }
) {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE users SET
      account_type = ?,
      business_name = ?,
      business_handle = ?,
      business_industry = ?,
      interests = ?,
      country = COALESCE(?, country),
      notify_on_receive = ?
      WHERE id = ?`,
    args: [
      input.accountType,
      input.businessName ?? null,
      input.businessHandle ?? null,
      input.businessIndustry ?? null,
      input.interests ? input.interests.join(",") : null,
      input.country ?? null,
      input.notifyOnReceive ? 1 : 0,
      userId,
    ],
  });
}

export async function isHandleTaken(handle: string): Promise<boolean> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT id FROM users WHERE business_handle = ? LIMIT 1",
    args: [handle],
  });
  return r.rows.length > 0;
}

export type TxRow = {
  id: number;
  user_id: number;
  digest: string;
  kind: string;
  amount: string | null;
  asset: string | null;
  recipient: string | null;
  memo: string | null;
  receipt_object_id: string | null;
  created_at: number;
};

export async function upsertUser(input: {
  googleSub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  suiAddress: string;
  salt: string;
  country?: string | null;
}): Promise<{ user: User; isNew: boolean }> {
  await ensureSchema();
  const c = db();
  const now = Date.now();

  const existing = await c.execute({
    sql: "SELECT * FROM users WHERE google_sub = ? LIMIT 1",
    args: [input.googleSub],
  });

  if (existing.rows.length > 0) {
    await c.execute({
      sql: "UPDATE users SET last_seen_at = ?, name = ?, picture = ? WHERE google_sub = ?",
      args: [
        now,
        input.name ?? null,
        input.picture ?? null,
        input.googleSub,
      ],
    });
    const row = await c.execute({
      sql: "SELECT * FROM users WHERE google_sub = ? LIMIT 1",
      args: [input.googleSub],
    });
    const u = row.rows[0] as unknown as User;
    await ensureReferralCode(u.id, input.name ?? input.email);
    const refreshed = await c.execute({
      sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
      args: [u.id],
    });
    return { user: refreshed.rows[0] as unknown as User, isNew: false };
  }

  await c.execute({
    sql: `INSERT INTO users
      (google_sub, email, name, picture, sui_address, salt, country, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.googleSub,
      input.email,
      input.name ?? null,
      input.picture ?? null,
      input.suiAddress,
      input.salt,
      input.country ?? null,
      now,
      now,
    ],
  });

  const row = await c.execute({
    sql: "SELECT * FROM users WHERE google_sub = ? LIMIT 1",
    args: [input.googleSub],
  });
  const created = row.rows[0] as unknown as User;
  await ensureReferralCode(created.id, input.name ?? input.email);
  const refreshed = await c.execute({
    sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
    args: [created.id],
  });
  return { user: refreshed.rows[0] as unknown as User, isNew: true };
}

export async function realignAddress(
  userId: number,
  suiAddress: string,
  salt: string
): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE users SET sui_address = ?, salt = ? WHERE id = ?",
    args: [suiAddress, salt, userId],
  });
}

export async function userById(id: number): Promise<User | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

export async function userByGoogleSub(sub: string): Promise<User | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM users WHERE google_sub = ? LIMIT 1",
    args: [sub],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

/**
 * Look up a user by their Sui address (UNIQUE). Case-insensitive — send
 * paths lowercase the recipient, but the stored address may be mixed case.
 * Used to resolve the RECIPIENT of an inbound transfer so we can notify them.
 * Returns null for an external (non-Talise) address.
 */
export async function userBySuiAddress(address: string): Promise<User | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM users WHERE LOWER(sui_address) = LOWER(?) LIMIT 1",
    args: [address],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

export async function userByBusinessHandle(
  handle: string
): Promise<User | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM users WHERE business_handle = ? LIMIT 1",
    args: [handle.toLowerCase()],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

export async function updateUserProfile(
  userId: number,
  input: {
    name?: string | null;
    businessName?: string | null;
    businessIndustry?: string | null;
    country?: string | null;
    notifyOnReceive?: boolean;
  }
) {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE users SET
      name = COALESCE(?, name),
      business_name = COALESCE(?, business_name),
      business_industry = COALESCE(?, business_industry),
      country = COALESCE(?, country),
      notify_on_receive = COALESCE(?, notify_on_receive)
      WHERE id = ?`,
    args: [
      input.name ?? null,
      input.businessName ?? null,
      input.businessIndustry ?? null,
      input.country ?? null,
      typeof input.notifyOnReceive === "boolean"
        ? input.notifyOnReceive
          ? 1
          : 0
        : null,
      userId,
    ],
  });
}

export async function setPaymentRegistry(
  userId: number,
  objectId: string
): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE users SET payment_registry_id = ? WHERE id = ?",
    args: [objectId, userId],
  });
}

export async function setInvoiceReceiptObjectId(
  slug: string,
  receiptObjectId: string
): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE invoices SET receipt_object_id = ? WHERE slug = ?",
    args: [receiptObjectId, slug],
  });
}

export async function setSpotBalanceManagerId(userId: number, bmId: string) {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE users SET spot_bm_id = ? WHERE id = ?",
    args: [bmId, userId],
  });
}

export async function userCount(): Promise<number> {
  await ensureSchema();
  const r = await db().execute("SELECT COUNT(*) AS n FROM users");
  const v = r.rows[0]?.n;
  return typeof v === "number" ? v : Number(v ?? 0);
}

export async function userPosition(id: number): Promise<number> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM users WHERE id <= ?",
    args: [id],
  });
  const v = r.rows[0]?.n;
  return typeof v === "number" ? v : Number(v ?? 0);
}

export async function markNotified(userId: number) {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE users SET notified_at = ? WHERE id = ?",
    args: [Date.now(), userId],
  });
}

export async function recordTx(input: {
  userId: number;
  digest: string;
  kind: string;
  amount?: string | null;
  asset?: string | null;
  recipient?: string | null;
  memo?: string | null;
  receiptObjectId?: string | null;
}): Promise<void> {
  await ensureSchema();
  try {
    await db().execute({
      sql: `INSERT INTO tx_history
        (user_id, digest, kind, amount, asset, recipient, memo, receipt_object_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.userId,
        input.digest,
        input.kind,
        input.amount ?? null,
        input.asset ?? null,
        input.recipient ?? null,
        input.memo ?? null,
        input.receiptObjectId ?? null,
        Date.now(),
      ],
    });
  } catch (e) {
    const msg = String((e as Error).message);
    // Postgres reports duplicate key violations as "duplicate key value violates
    // unique constraint"; libsql said "UNIQUE constraint failed". Swallow both.
    if (!msg.includes("UNIQUE") && !msg.toLowerCase().includes("duplicate key")) {
      throw e;
    }
  }
}

export type Invoice = {
  id: number;
  business_user_id: number;
  slug: string;
  amount_usdc: string;
  reference: string | null;
  customer_email: string | null;
  status: "open" | "paid" | "void";
  created_at: number;
  paid_at: number | null;
  paid_digest: string | null;
  paid_by_address: string | null;
  receipt_object_id?: string | null;
};

export async function createInvoice(input: {
  businessUserId: number;
  amountUsdc: string;
  reference: string | null;
  customerEmail: string | null;
}): Promise<Invoice> {
  await ensureSchema();
  const slug = invoiceSlug();
  const now = Date.now();
  const c = db();
  await c.execute({
    sql: `INSERT INTO invoices
      (business_user_id, slug, amount_usdc, reference, customer_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      input.businessUserId,
      slug,
      input.amountUsdc,
      input.reference,
      input.customerEmail,
      now,
    ],
  });
  const r = await c.execute({
    sql: "SELECT * FROM invoices WHERE slug = ? LIMIT 1",
    args: [slug],
  });
  return r.rows[0] as unknown as Invoice;
}

export async function invoicesFor(businessUserId: number): Promise<Invoice[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM invoices WHERE business_user_id = ? ORDER BY created_at DESC",
    args: [businessUserId],
  });
  return r.rows as unknown as Invoice[];
}

export async function invoiceBySlug(slug: string): Promise<Invoice | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM invoices WHERE slug = ? LIMIT 1",
    args: [slug],
  });
  return (r.rows[0] as unknown as Invoice) ?? null;
}

export async function markInvoicePaid(
  slug: string,
  digest: string,
  payerAddress: string
) {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE invoices SET status = 'paid', paid_at = ?, paid_digest = ?, paid_by_address = ?
      WHERE slug = ? AND status = 'open'`,
    args: [Date.now(), digest, payerAddress, slug],
  });
}

function invoiceSlug(): string {
  return Math.random().toString(36).slice(2, 6) +
    Math.random().toString(36).slice(2, 6);
}

export async function userTxs(userId: number, limit = 20): Promise<TxRow[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM tx_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    args: [userId, limit],
  });
  return r.rows as unknown as TxRow[];
}

// --- Referrals + Rewards ---------------------------------------------------

const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

function pickFromAlphabet(): string {
  const idx = Math.floor(Math.random() * REFERRAL_ALPHABET.length);
  return REFERRAL_ALPHABET[idx];
}

export function generateReferralCode(seed?: string | null): string {
  let prefix = "";
  if (seed) {
    const cleaned = seed
      .toUpperCase()
      .replace(/[O0]/g, "")
      .replace(/[IL1]/g, "")
      .split("")
      .filter((ch) => REFERRAL_ALPHABET.includes(ch))
      .join("");
    prefix = cleaned.slice(0, 4);
  }
  let code = prefix;
  while (code.length < 8) code += pickFromAlphabet();
  return code;
}

export async function ensureReferralCode(
  userId: number,
  seed?: string | null
): Promise<string> {
  await ensureSchema();
  const c = db();
  const existing = await c.execute({
    sql: "SELECT referral_code FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  const cur = existing.rows[0]?.referral_code;
  if (typeof cur === "string" && cur.length === 8) return cur;

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateReferralCode(attempt === 0 ? seed : null);
    try {
      const r = await c.execute({
        sql: "UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL",
        args: [code, userId],
      });
      if (r.rowsAffected && r.rowsAffected > 0) return code;
      const r2 = await c.execute({
        sql: "SELECT referral_code FROM users WHERE id = ? LIMIT 1",
        args: [userId],
      });
      const v = r2.rows[0]?.referral_code;
      if (typeof v === "string" && v.length === 8) return v;
    } catch (e) {
      const msg = String((e as Error).message).toUpperCase();
      if (!msg.includes("UNIQUE") && !msg.includes("DUPLICATE KEY")) throw e;
    }
  }
  throw new Error("could not allocate a referral code after 12 attempts");
}

export async function userByReferralCode(code: string): Promise<User | null> {
  await ensureSchema();
  const normalized = code.trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(normalized)) return null;
  const r = await db().execute({
    sql: "SELECT * FROM users WHERE referral_code = ? LIMIT 1",
    args: [normalized],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

export async function recordRewardsEvent(
  userId: number,
  kind: RewardsEventKind,
  points: number,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  await ensureSchema();
  const c = db();
  const now = Date.now();
  await c.batch(
    [
      {
        sql: `INSERT INTO rewards_events
          (user_id, kind, points, metadata, created_at)
          VALUES (?, ?, ?, ?, ?)`,
        args: [
          userId,
          kind,
          points,
          metadata ? JSON.stringify(metadata) : null,
          now,
        ],
      },
      {
        sql: "UPDATE users SET points_total = COALESCE(points_total, 0) + ? WHERE id = ?",
        args: [points, userId],
      },
    ],
    "write"
  );
}

export async function attributeReferral(
  newUserId: number,
  inviterCode: string,
  points: { referrer: number; referee: number }
): Promise<{ ok: boolean; reason?: string; inviterId?: number }> {
  await ensureSchema();
  const c = db();
  const me = await userById(newUserId);
  if (!me) return { ok: false, reason: "user not found" };
  if (me.referred_by_user_id) {
    return { ok: false, reason: "already referred" };
  }
  const inviter = await userByReferralCode(inviterCode);
  if (!inviter) return { ok: false, reason: "invalid code" };
  if (inviter.id === newUserId) return { ok: false, reason: "self referral" };

  await c.execute({
    sql: `UPDATE users SET referred_by_user_id = ?
          WHERE id = ? AND referred_by_user_id IS NULL`,
    args: [inviter.id, newUserId],
  });
  await c.execute({
    sql: "UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = ?",
    args: [inviter.id],
  });

  await recordRewardsEvent(inviter.id, "referral_signup", points.referrer, {
    referredUserId: newUserId,
  });
  await recordRewardsEvent(newUserId, "referral_signup", points.referee, {
    inviterUserId: inviter.id,
  });

  return { ok: true, inviterId: inviter.id };
}

export async function getRewardsSummary(userId: number): Promise<{
  code: string;
  referralCount: number;
  pointsTotal: number;
  recentEvents: RewardsEvent[];
}> {
  await ensureSchema();
  const c = db();
  const code = await ensureReferralCode(userId);

  const r = await c.execute({
    sql: "SELECT referral_count, points_total FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  const row = r.rows[0];
  const referralCount = Number(row?.referral_count ?? 0) || 0;
  const pointsTotal = Number(row?.points_total ?? 0) || 0;

  const ev = await c.execute({
    sql: `SELECT * FROM rewards_events WHERE user_id = ?
          ORDER BY created_at DESC LIMIT 20`,
    args: [userId],
  });

  return {
    code,
    referralCount,
    pointsTotal,
    recentEvents: ev.rows as unknown as RewardsEvent[],
  };
}

// ───────────────────────────────────────────────────────────────────
// roundup_queue helpers
//
// Used by `/api/send/gasless-submit` to fire-and-forget a NAVI supply
// for the rounded-up amount AFTER a gasless USDsui send lands. The
// gasless rail can't co-bundle the supply (PTB allowlist permits only
// `0x2::coin::send_funds<T>`), so we defer it to a cron drain.
//
// Reads happen exclusively from the cron worker
// (`/api/cron/process-roundup-queue`); we keep `markRoundupProcessed`
// here so the cron's update path is co-located with the insert.

export type RoundupQueueRow = {
  id: number;
  user_id: number;
  amount_usd: number;
  created_at: number;
  processed_at: number | null;
  tx_digest: string | null;
};

export async function enqueueRoundup(input: {
  userId: number;
  amountUsd: number;
}): Promise<void> {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) return;
  await ensureSchema();
  const c = db();
  await c.execute({
    sql: `INSERT INTO roundup_queue (user_id, amount_usd, created_at)
          VALUES (?, ?, ?)`,
    args: [input.userId, input.amountUsd, Date.now()],
  });
}

export async function pendingRoundups(
  limit = 50
): Promise<RoundupQueueRow[]> {
  await ensureSchema();
  const c = db();
  const r = await c.execute({
    sql: `SELECT id, user_id, amount_usd, created_at, processed_at, tx_digest
          FROM roundup_queue
          WHERE processed_at IS NULL
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [limit],
  });
  return r.rows as unknown as RoundupQueueRow[];
}

export async function markRoundupProcessed(
  id: number,
  txDigest: string
): Promise<void> {
  await ensureSchema();
  const c = db();
  await c.execute({
    sql: `UPDATE roundup_queue SET processed_at = ?, tx_digest = ? WHERE id = ?`,
    args: [Date.now(), txDigest, id],
  });
}
