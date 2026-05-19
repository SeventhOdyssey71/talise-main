import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _client: Client | null = null;
let _schemaReady = false;

function ensureLocalDir(url: string) {
  if (url.startsWith("file:")) {
    const path = url.replace(/^file:/, "");
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {}
  }
}

export function db(): Client {
  if (_client) return _client;
  const url = process.env.DATABASE_URL || "file:./.data/talise.db";
  ensureLocalDir(url);
  _client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return _client;
}

export async function ensureSchema() {
  if (_schemaReady) return;
  const c = db();
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        sui_address TEXT UNIQUE NOT NULL,
        salt TEXT NOT NULL,
        country TEXT,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        notified_at INTEGER,
        account_type TEXT,
        business_name TEXT,
        business_handle TEXT UNIQUE,
        business_industry TEXT,
        talise_username TEXT UNIQUE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)`,
      `CREATE TABLE IF NOT EXISTS tx_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        digest TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,
        amount TEXT,
        asset TEXT,
        recipient TEXT,
        memo TEXT,
        receipt_object_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tx_user ON tx_history(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tx_created ON tx_history(created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_user_id INTEGER NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        amount_usdc TEXT NOT NULL,
        reference TEXT,
        customer_email TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL,
        paid_at INTEGER,
        paid_digest TEXT,
        paid_by_address TEXT,
        FOREIGN KEY(business_user_id) REFERENCES users(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_biz ON invoices(business_user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_slug ON invoices(slug)`,
    ],
    "write"
  );

  // Idempotent migrations for older DBs.
  for (const sql of [
    "ALTER TABLE users ADD COLUMN account_type TEXT",
    "ALTER TABLE users ADD COLUMN business_name TEXT",
    "ALTER TABLE users ADD COLUMN business_handle TEXT",
    "ALTER TABLE users ADD COLUMN business_industry TEXT",
    "ALTER TABLE users ADD COLUMN interests TEXT",
    "ALTER TABLE users ADD COLUMN notify_on_receive INTEGER",
    "ALTER TABLE users ADD COLUMN spot_bm_id TEXT",
    "ALTER TABLE users ADD COLUMN talise_username TEXT",
  ]) {
    try {
      await c.execute(sql);
    } catch {
      /* column already exists */
    }
  }

  // Race-safe UNIQUE on talise_username for old DBs that added the column via
  // ALTER (which can't introduce UNIQUE). Concurrent claim attempts collide
  // here, which the route maps to a 409.
  try {
    await c.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_talise_username ON users(talise_username)"
    );
  } catch {
    /* ignore */
  }

  _schemaReady = true;
}

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
};

/** Has the user finished business onboarding? Handle is the gate. */
export function hasBusiness(user: User): boolean {
  return !!user.business_handle;
}

/** Just swap which context the user is currently in. */
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

/** Add a business profile to an existing user and switch to business mode. */
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
    return { user: row.rows[0] as unknown as User, isNew: false };
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
  return { user: row.rows[0] as unknown as User, isNew: true };
}

/**
 * Realign a user's on-chain identity when the salt source changes (e.g.
 * migrating an existing row to Shinami-managed salts). Address + salt move
 * together — a stale pair leaves the account unsignable.
 */
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
    if (!String((e as Error).message).includes("UNIQUE")) throw e;
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
  // 8-char alphanum (lower) — collision risk is fine for this scale
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
