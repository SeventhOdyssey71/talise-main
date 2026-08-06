import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { db, ensureSchema } from "./db";
import { resolveLinqBank } from "./linq-banks";
import { encryptAtRest, decryptAtRest } from "@/lib/crypto-at-rest";

/**
 * Linked NGN bank accounts, off-ramp Phase 2.
 *
 * A user links an NGN bank account to their Talise @handle. The account
 * name is resolved via Linq (verifyBank) and the user signs a
 * deterministic personal-message consent string with their zkLogin
 * identity; that signature is stored as `attestation_digest`. Phase 3
 * (the Send "to bank" toggle) reads a user's linked accounts via
 * `getLinkedBankAccounts()` so sending to @them can target the bank.
 *
 * The table is created in lib/db.ts doEnsureSchema (user_bank_accounts).
 * `user_id` is stored as TEXT (String(userId)) to mirror the sibling
 * linq_offramps table.
 */

/**
 * What a row is FOR. See the schema comment in lib/db.ts — the distinction
 * decides where money lands, so it is not cosmetic.
 */
export type BankAccountKind = "self" | "beneficiary";

/** Raw DB row shape for `user_bank_accounts`. */
export interface BankAccountRow {
  id: string;
  user_id: string;
  bank_code: string;
  account_number: string;
  account_name: string | null;
  attestation_digest: string | null;
  /** True for the single payout target a sender hits via "pay to bank". */
  is_primary: boolean;
  kind?: BankAccountKind | null;
  label?: string | null;
  account_fingerprint?: string | null;
  last_used_at?: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Deterministic identity for a bank account, used wherever we need to ask "is
 * this the same account?" without comparing ciphertext.
 *
 * `encryptAtRest` is AES-GCM with a per-call random IV, so the stored column
 * differs on every write for identical input. That is correct for secrecy and
 * useless for equality — which is why the unique index over it never fired and
 * users accumulated duplicate rows.
 *
 * HMAC rather than a plain hash: an NGN account number is 10 digits, a space
 * small enough to enumerate completely, so an unkeyed digest would be
 * reversible by anyone who got the column.
 */
export function bankAccountFingerprint(
  bankCode: string,
  accountNumber: string
): string {
  const secret = process.env.DB_ENCRYPTION_KEY ?? "talise-bank-fp-fallback";
  return createHmac("sha256", secret)
    .update(`${bankCode.trim()}|${accountNumber.trim()}`)
    .digest("hex");
}

/**
 * Collapse rows that describe the SAME account, newest-surviving.
 *
 * Applied at read time rather than by deleting rows: the duplicates are real
 * user history and a list that reads correctly does not justify destroying it.
 * Rows written before the fingerprint column existed have none, so they fall
 * back to their id and are never merged with anything by accident.
 */
function dedupeByAccount(rows: BankAccountRow[]): BankAccountRow[] {
  const byKey = new Map<string, BankAccountRow>();
  for (const r of rows) {
    const key = r.account_fingerprint || `id:${r.id}`;
    const seen = byKey.get(key);
    // Prefer the primary row, then the most recently touched, so collapsing
    // duplicates can never silently drop a user's primary payout target.
    if (
      !seen ||
      (toBool(r.is_primary) && !toBool(seen.is_primary)) ||
      (toBool(r.is_primary) === toBool(seen.is_primary) &&
        Number(r.updated_at ?? 0) > Number(seen.updated_at ?? 0))
    ) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values()];
}

/** Masked, API-safe view of a linked bank account. */
export interface LinkedBankAccount {
  id: string;
  bankCode: string;
  /** Resolved registry name, or the raw code if unknown. */
  bankName: string;
  accountName: string | null;
  /** Last 4 digits of the account number, we never return the full PAN. */
  last4: string;
  /** True once a consent attestation signature has been stored. */
  attested: boolean;
  /** True for the single payout target a sender hits via "pay to bank". */
  isPrimary: boolean;
  /** "self" = the user's own account, "beneficiary" = someone they pay. */
  kind: BankAccountKind;
  /** User-given nickname, if any. */
  label: string | null;
  /** Epoch-ms this target was last cashed out to. Null if never. */
  lastUsedAt: number | null;
}

/** Last 4 digits of an account number (or fewer if shorter). */
export function last4(accountNumber: string): string {
  return accountNumber.slice(-4);
}

/**
 * Coerce a Postgres BOOLEAN as it may surface through the libSQL-shaped
 * adapter: a real boolean, the integer 1/0, or the 't'/'f' text form.
 */
function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "t" || v === "true" || v === "1";
}

/** Map a raw row to the masked, API-safe shape. */
export function maskBankAccount(row: BankAccountRow): LinkedBankAccount {
  const bank = resolveLinqBank(row.bank_code);
  return {
    id: row.id,
    bankCode: row.bank_code,
    bankName: bank?.name ?? row.bank_code,
    accountName: row.account_name,
    last4: last4(decryptAtRest(row.account_number) ?? row.account_number),
    attested: Boolean(row.attestation_digest),
    isPrimary: toBool(row.is_primary),
    kind: row.kind === "beneficiary" ? "beneficiary" : "self",
    label: row.label ?? null,
    lastUsedAt: row.last_used_at != null ? Number(row.last_used_at) : null,
  };
}

/**
 * List a user's linked bank accounts (masked). Newest first.
 *
 * Exported for Phase 3 (the Send "to bank" toggle) and the iOS app:
 * given a recipient's user id, read their linked accounts to decide
 * whether a "send to bank" target is available.
 */
export async function getLinkedBankAccounts(
  userId: number | string
): Promise<LinkedBankAccount[]> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT id, user_id, bank_code, account_number, account_name,
                 attestation_digest, is_primary, kind, label,
                 account_fingerprint, last_used_at, created_at, updated_at
          FROM user_bank_accounts
          WHERE user_id = ? AND kind <> 'beneficiary'
          ORDER BY is_primary DESC, created_at DESC`,
    args: [String(userId)],
  });
  return dedupeByAccount(res.rows as unknown as BankAccountRow[]).map(
    maskBankAccount
  );
}

/**
 * The raw row for a user's PRIMARY bank account, or null if they have none.
 * Used by the recipient resolver + the "pay to bank" off-ramp to find the
 * single payout target a sender hits when paying a @handle. Returns the raw
 * row (account number included), CALLERS must mask before exposing it; the
 * sender must NEVER receive the recipient's full account number.
 *
 * BENEFICIARIES ARE EXCLUDED, and that exclusion is load-bearing. A saved
 * beneficiary is an account the user PAYS, often someone else's. If one could
 * become the target here, money a third party sent to this user's @handle
 * would land in that other account, and nothing in the payment would look
 * wrong to either party.
 */
export async function getPrimaryBankAccount(
  userId: number | string
): Promise<BankAccountRow | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT id, user_id, bank_code, account_number, account_name,
                 attestation_digest, is_primary, kind, label,
                 account_fingerprint, last_used_at, created_at, updated_at
          FROM user_bank_accounts
          WHERE user_id = ? AND is_primary = true AND kind <> 'beneficiary'
          ORDER BY updated_at DESC
          LIMIT 1`,
    args: [String(userId)],
  });
  const row = (res.rows as unknown as BankAccountRow[])[0];
  if (row && typeof row.account_number === "string") {
    row.account_number = decryptAtRest(row.account_number) ?? row.account_number;
  }
  return row ?? null;
}

/** Count a user's linked bank accounts (used to auto-primary the first one). */
export async function countBankAccounts(
  userId: number | string
): Promise<number> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM user_bank_accounts WHERE user_id = ?`,
    args: [String(userId)],
  });
  const n = (res.rows[0] as unknown as { n: number | string })?.n;
  return Number(n ?? 0);
}

/**
 * Make `id` the user's primary payout account and unset every other one,
 * in a single transaction. Returns false (and changes nothing) when the id
 * doesn't belong to the user, so callers can 404 without leaking existence.
 */
export async function setPrimaryBankAccount(
  userId: number | string,
  id: string
): Promise<boolean> {
  await ensureSchema();
  const owner = await getBankAccountById(userId, id);
  if (!owner) return false;
  const uid = String(userId);
  const now = Date.now();
  // Two statements as a logical transaction: clear all, then set the one.
  await db().execute({
    sql: `UPDATE user_bank_accounts
          SET is_primary = false, updated_at = ?
          WHERE user_id = ? AND id <> ?`,
    args: [now, uid, id],
  });
  await db().execute({
    sql: `UPDATE user_bank_accounts
          SET is_primary = true, updated_at = ?
          WHERE user_id = ? AND id = ?`,
    args: [now, uid, id],
  });
  return true;
}

/**
 * Set `id` primary for `userId` WITHOUT unsetting the others, used inside
 * link/confirm when the user has no account yet, so the first linked account
 * becomes the default payout target automatically.
 */
export async function markBankAccountPrimary(
  userId: number | string,
  id: string
): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE user_bank_accounts
          SET is_primary = true, updated_at = ?
          WHERE user_id = ? AND id = ?`,
    args: [Date.now(), String(userId), id],
  });
}

/**
 * Fetch a single linked account by id, scoped to its owner. Returns null
 * if the row doesn't exist OR isn't owned by `userId` (so callers can
 * 404 without leaking another user's row existence).
 */
export async function getBankAccountById(
  userId: number | string,
  id: string
): Promise<BankAccountRow | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT id, user_id, bank_code, account_number, account_name,
                 attestation_digest, is_primary, created_at, updated_at
          FROM user_bank_accounts
          WHERE id = ? AND user_id = ?
          LIMIT 1`,
    args: [id, String(userId)],
  });
  const row = (res.rows as unknown as BankAccountRow[])[0];
  if (row && typeof row.account_number === "string") {
    row.account_number = decryptAtRest(row.account_number) ?? row.account_number;
  }
  return row ?? null;
}

/**
 * Insert or update (UPSERT) a linked bank account. Idempotent on
 * (user_id, bank_code, account_number): re-linking the same account
 * refreshes the resolved name + attestation digest and bumps
 * `updated_at` instead of creating a duplicate. Returns the stored row.
 */
export async function upsertBankAccount(input: {
  userId: number | string;
  bankCode: string;
  accountNumber: string;
  accountName: string | null;
  attestationDigest: string | null;
  /** Defaults to "self" so every existing caller keeps its meaning. */
  kind?: BankAccountKind;
  label?: string | null;
}): Promise<BankAccountRow> {
  await ensureSchema();
  const userId = String(input.userId);
  const now = Date.now();
  const id = randomUUID();

  // Look the account up by FINGERPRINT and update in place, instead of the
  // ON CONFLICT this used to rely on. That conflict target was
  // (user_id, bank_code, account_number) over the encrypted column, which a
  // random IV makes unmatchable, so every re-link inserted another row.
  const fp = bankAccountFingerprint(input.bankCode, input.accountNumber);
  const kind: BankAccountKind = input.kind ?? "self";
  const RET = `RETURNING id, user_id, bank_code, account_number, account_name,
                    attestation_digest, is_primary, kind, label,
                    account_fingerprint, last_used_at, created_at, updated_at`;

  const existing = await db().execute({
    sql: `SELECT id FROM user_bank_accounts
          WHERE user_id = ? AND account_fingerprint = ? AND kind = ?
          ORDER BY updated_at DESC LIMIT 1`,
    args: [userId, fp, kind],
  });
  const hitId = (existing.rows[0] as unknown as { id?: string } | undefined)?.id;

  const res = hitId
    ? await db().execute({
        sql: `UPDATE user_bank_accounts
              SET account_name = COALESCE(?, account_name),
                  attestation_digest = COALESCE(?, attestation_digest),
                  label = COALESCE(?, label),
                  updated_at = ?
              WHERE id = ? ${RET}`,
        args: [
          input.accountName,
          input.attestationDigest,
          input.label ?? null,
          now,
          hitId,
        ],
      })
    : await db().execute({
        sql: `INSERT INTO user_bank_accounts
                (id, user_id, bank_code, account_number, account_name,
                 attestation_digest, kind, label, account_fingerprint,
                 created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${RET}`,
        args: [
          id,
          userId,
          input.bankCode,
          encryptAtRest(input.accountNumber),
          input.accountName,
          input.attestationDigest,
          kind,
          input.label ?? null,
          fp,
          now,
          now,
        ],
      });
  const row = (res.rows as unknown as BankAccountRow[])[0];
  if (row && typeof row.account_number === "string") {
    row.account_number = decryptAtRest(row.account_number) ?? row.account_number;
  }
  return row;
}

/**
 * Unlink a bank account, scoped to its owner. Returns true if a row was
 * deleted, false if nothing matched (not found OR not the caller's).
 */
export async function deleteBankAccount(
  userId: number | string,
  id: string
): Promise<boolean> {
  await ensureSchema();
  const res = await db().execute({
    sql: `DELETE FROM user_bank_accounts WHERE id = ? AND user_id = ?`,
    args: [id, String(userId)],
  });
  // The libSQL-shaped adapter exposes affected rows on `rowsAffected`.
  return res.rowsAffected > 0;
}

/**
 * The deterministic consent string the user signs (as a zkLogin personal
 * message) to attest they authorize linking this bank account to their
 * Talise @handle. The signature is stored as `attestation_digest`.
 *
 * Format mirrors the Talise memo convention:
 *   talise/v1|bank-link|<bankCode>|<last4>
 *
 * Deterministic so the client can reconstruct the exact bytes it must
 * sign from the prepare response, and so confirm could (optionally)
 * re-derive + verify it server-side later.
 */
export function bankLinkAttestMessage(input: {
  bankCode: string;
  accountNumber: string;
}): string {
  return `talise/v1|bank-link|${input.bankCode}|${last4(input.accountNumber)}`;
}

// ─── Payout targets (beneficiaries) ──────────────────────────────────────

/**
 * Everything a user can cash out TO: their own linked accounts and the
 * beneficiaries they've saved, most recently used first.
 *
 * The opposite direction to `getLinkedBankAccounts`, which answers "where can
 * money sent to this user land". This one answers "where can this user send
 * money", so it deliberately includes both kinds — cashing out to your own
 * account is the common case, paying someone else is the reason the feature
 * exists.
 */
export async function getPayoutTargets(
  userId: number | string
): Promise<LinkedBankAccount[]> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT id, user_id, bank_code, account_number, account_name,
                 attestation_digest, is_primary, kind, label,
                 account_fingerprint, last_used_at, created_at, updated_at
          FROM user_bank_accounts
          WHERE user_id = ?
          ORDER BY COALESCE(last_used_at, 0) DESC,
                   is_primary DESC,
                   created_at DESC`,
    args: [String(userId)],
  });
  return dedupeByAccount(res.rows as unknown as BankAccountRow[]).map(
    maskBankAccount
  );
}

/**
 * Resolve a saved target to the details a cash-out needs, by id and owner.
 *
 * Returns the FULL account number: the caller is the off-ramp, which has to
 * hand it to the payout provider. Never return this to a client.
 */
export async function getPayoutTarget(
  userId: number | string,
  id: string
): Promise<{ bankCode: string; accountNumber: string; accountName: string | null } | null> {
  const row = await getBankAccountById(userId, id);
  if (!row) return null;
  return {
    bankCode: row.bank_code,
    accountNumber: row.account_number,
    accountName: row.account_name,
  };
}

/**
 * Stamp a target as just used, so the picker surfaces what someone actually
 * pays rather than what they happened to save first. Never throws: failing to
 * record an ordering hint must not fail a cash-out that already moved money.
 */
export async function touchPayoutTarget(
  userId: number | string,
  id: string
): Promise<void> {
  try {
    await db().execute({
      sql: `UPDATE user_bank_accounts SET last_used_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [Date.now(), id, String(userId)],
    });
  } catch (e) {
    console.warn(`[bank-accounts] touch failed for ${id}: ${(e as Error).message}`);
  }
}

/**
 * Record a cash-out destination the user typed by hand, so it appears in the
 * picker next time without them having to think about saving it.
 *
 * `accountName` must be the name the PROVIDER returned from its name enquiry,
 * never anything a client supplied — the saved name is what the user reads
 * back when confirming a later payout.
 */
export async function rememberPayoutTarget(input: {
  userId: number | string;
  bankCode: string;
  accountNumber: string;
  accountName: string | null;
  label?: string | null;
}): Promise<LinkedBankAccount | null> {
  try {
    const row = await upsertBankAccount({
      userId: input.userId,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      attestationDigest: null,
      kind: "beneficiary",
      label: input.label ?? null,
    });
    await touchPayoutTarget(input.userId, row.id);
    return maskBankAccount(row);
  } catch (e) {
    console.warn(
      `[bank-accounts] remember failed for user=${input.userId}: ${(e as Error).message}`
    );
    return null;
  }
}
