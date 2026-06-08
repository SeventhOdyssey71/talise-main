import "server-only";

import { randomUUID } from "node:crypto";

import { db, ensureSchema } from "./db";
import { resolveLinqBank } from "./linq-banks";

/**
 * Linked NGN bank accounts — off-ramp Phase 2.
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

/** Raw DB row shape for `user_bank_accounts`. */
export interface BankAccountRow {
  id: string;
  user_id: string;
  bank_code: string;
  account_number: string;
  account_name: string | null;
  attestation_digest: string | null;
  created_at: number;
  updated_at: number;
}

/** Masked, API-safe view of a linked bank account. */
export interface LinkedBankAccount {
  id: string;
  bankCode: string;
  /** Resolved registry name, or the raw code if unknown. */
  bankName: string;
  accountName: string | null;
  /** Last 4 digits of the account number — we never return the full PAN. */
  last4: string;
  /** True once a consent attestation signature has been stored. */
  attested: boolean;
}

/** Last 4 digits of an account number (or fewer if shorter). */
export function last4(accountNumber: string): string {
  return accountNumber.slice(-4);
}

/** Map a raw row to the masked, API-safe shape. */
export function maskBankAccount(row: BankAccountRow): LinkedBankAccount {
  const bank = resolveLinqBank(row.bank_code);
  return {
    id: row.id,
    bankCode: row.bank_code,
    bankName: bank?.name ?? row.bank_code,
    accountName: row.account_name,
    last4: last4(row.account_number),
    attested: Boolean(row.attestation_digest),
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
                 attestation_digest, created_at, updated_at
          FROM user_bank_accounts
          WHERE user_id = ?
          ORDER BY created_at DESC`,
    args: [String(userId)],
  });
  return (res.rows as unknown as BankAccountRow[]).map(maskBankAccount);
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
                 attestation_digest, created_at, updated_at
          FROM user_bank_accounts
          WHERE id = ? AND user_id = ?
          LIMIT 1`,
    args: [id, String(userId)],
  });
  const row = (res.rows as unknown as BankAccountRow[])[0];
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
}): Promise<BankAccountRow> {
  await ensureSchema();
  const userId = String(input.userId);
  const now = Date.now();
  const id = randomUUID();

  // Postgres UPSERT keyed on the unique (user_id, bank_code, account_number)
  // index. On conflict we keep the original id + created_at and refresh the
  // mutable fields. RETURNING hands back the canonical stored row.
  const res = await db().execute({
    sql: `INSERT INTO user_bank_accounts
            (id, user_id, bank_code, account_number, account_name,
             attestation_digest, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, bank_code, account_number)
          DO UPDATE SET
            account_name = EXCLUDED.account_name,
            attestation_digest = EXCLUDED.attestation_digest,
            updated_at = EXCLUDED.updated_at
          RETURNING id, user_id, bank_code, account_number, account_name,
                    attestation_digest, created_at, updated_at`,
    args: [
      id,
      userId,
      input.bankCode,
      input.accountNumber,
      input.accountName,
      input.attestationDigest,
      now,
      now,
    ],
  });
  return (res.rows as unknown as BankAccountRow[])[0];
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
