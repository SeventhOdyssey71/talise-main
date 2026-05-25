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
  const tables: string[] = [
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
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)`,
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
    `CREATE INDEX IF NOT EXISTS idx_invoice_biz ON invoices(business_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_slug ON invoices(slug)`,
    `CREATE TABLE IF NOT EXISTS rewards_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      points INTEGER NOT NULL,
      metadata TEXT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_rewards_user ON rewards_events(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rewards_created ON rewards_events(created_at DESC)`,
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
    `CREATE INDEX IF NOT EXISTS idx_goals_user ON savings_goals(user_id, archived)`,
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
    `CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_id, created_at DESC)`,
  ];
  for (const stmt of tables) {
    await c.execute(stmt);
  }

  // Idempotent column additions for older deployments. Postgres lacks the
  // `IF NOT EXISTS` clause on `ADD COLUMN` until 9.6+, but pxxl runs 16 so
  // we can rely on it. Keeps the migration narrative readable.
  for (const sql of [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS business_handle TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS business_industry TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_on_receive INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS spot_bm_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS talise_username TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_registry_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS points_total INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS roundup_enabled INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS roundup_percentage INTEGER DEFAULT 2",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_sent_usd DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_saved_usd DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS roundup_saved_usd DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_object_id TEXT",
  ]) {
    try {
      await c.execute(sql);
    } catch {
      /* idempotent; ignore */
    }
  }

  // Widen any int4 timestamp columns to int8. The original Postgres
  // migration shipped briefly with `INTEGER` for ms-precision timestamps;
  // `Date.now()` is ~1.78 trillion today, well beyond int4's ~2.15B limit,
  // so inserts blow up with
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

  // Unique indexes for columns added via ALTER. `CREATE UNIQUE INDEX IF NOT
  // EXISTS` is safe to call repeatedly.
  try {
    await c.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_talise_username ON users(talise_username)"
    );
  } catch {
    /* ignore */
  }
  try {
    await c.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)"
    );
  } catch {
    /* ignore */
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
};

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
