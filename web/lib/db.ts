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
      `CREATE TABLE IF NOT EXISTS rewards_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        points INTEGER NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rewards_user ON rewards_events(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_rewards_created ON rewards_events(created_at DESC)`,
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
    "ALTER TABLE users ADD COLUMN payment_registry_id TEXT",
    "ALTER TABLE users ADD COLUMN referral_code TEXT",
    "ALTER TABLE users ADD COLUMN referred_by_user_id INTEGER",
    "ALTER TABLE users ADD COLUMN referral_count INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN points_total INTEGER DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN receipt_object_id TEXT",
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

  // Race-safe UNIQUE on referral_code — added via ALTER above which can't
  // introduce UNIQUE. Concurrent ensureReferralCode collisions retry.
  try {
    await c.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)"
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
  payment_registry_id?: string | null;
  referral_code?: string | null;
  referred_by_user_id?: number | null;
  referral_count?: number | null;
  points_total?: number | null;
};

export type RewardsEventKind =
  | "referral_signup"
  | "referral_first_send"
  | "volume_milestone"
  | "first_send"
  | "first_claim"
  | "streak";

export type RewardsEvent = {
  id: number;
  user_id: number;
  kind: RewardsEventKind;
  points: number;
  metadata: string | null;
  created_at: number;
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
    const u = row.rows[0] as unknown as User;
    // Backfill referral_code for legacy users.
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

/**
 * Persist the Sui Payment Kit `PaymentRegistry` object id for a merchant.
 * Called once per merchant at handle-creation time (or lazily on the first
 * paid invoice). The registry object is shared on-chain — only the id
 * needs to live in our DB so subsequent invoice payments can target it.
 */
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

// --- Referrals + Rewards ---------------------------------------------------

// 8-character codes: uppercase letters + digits, no ambiguous (O, 0, I, 1, L).
const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Strict format check used by client + server. */
export const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

function pickFromAlphabet(): string {
  const idx = Math.floor(Math.random() * REFERRAL_ALPHABET.length);
  return REFERRAL_ALPHABET[idx];
}

/**
 * Generate an 8-char referral code. Optionally seeded from a username/name
 * so it feels personal (e.g. `sele` → `SELE` + 4 random chars). Any chars
 * in the seed that aren't in the alphabet are dropped.
 */
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

/**
 * Give an existing user a referral code if they don't have one. Race-safe:
 * the UNIQUE index on `referral_code` will reject collisions, and we retry.
 */
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
      // Already populated by a concurrent writer — re-read.
      const r2 = await c.execute({
        sql: "SELECT referral_code FROM users WHERE id = ? LIMIT 1",
        args: [userId],
      });
      const v = r2.rows[0]?.referral_code;
      if (typeof v === "string" && v.length === 8) return v;
    } catch (e) {
      if (!String((e as Error).message).toUpperCase().includes("UNIQUE")) throw e;
      // Collision — loop and try a fresh code.
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

/**
 * Insert a rewards_events row and bump the user's denormalized points_total
 * in the same write so reads stay consistent.
 */
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

/**
 * Attribute a new user to an inviter. No-op when:
 *  - the new user already has an inviter
 *  - the code is invalid or unknown
 *  - the code belongs to the same user (self-referral)
 *
 * Awards `referrerPoints` to the inviter and `refereePoints` to the new user.
 */
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
  // Make sure a code exists. Cheap when it already does.
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
