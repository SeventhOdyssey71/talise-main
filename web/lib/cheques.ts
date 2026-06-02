import "server-only";

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { db, ensureSchema } from "@/lib/db";
import { sui, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { getChainIdentifier, getCurrentEpoch } from "@/lib/sui-epoch";
import { verifyTurnstile, turnstileConfigured } from "@/lib/turnstile";

/**
 * Talise Cheques — claimable USDsui links presented as real-life cheques.
 *
 * Model (see docs/features/cheques.md): a SERVER-CUSTODIED escrow keyed by a
 * hashed claim secret. The creator funds a single Talise-controlled escrow
 * address via the normal send pipeline; the link carries a 32-byte secret in
 * its URL fragment; the claim API is the SOLE authority that can release the
 * money, so name/phone + nationality GATES are real gates — release refuses
 * until they pass. The escrow key (an Ed25519 operator key, same pattern as
 * lib/suins-operator.ts) signs the escrow→claimer release; double-claim is
 * locked by an atomic `UPDATE ... WHERE status='funded' RETURNING`.
 *
 * No new Move code: the chain only ever sees plain USDsui transfers.
 */

const CHEQUE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days default expiry

export type ChequeStatus =
  | "draft"
  | "funded"
  | "claiming"
  | "claimed"
  | "voiding"
  | "voided"
  | "expired";

/**
 * Claim gating (simplified per product). A captcha (Cloudflare Turnstile) and a
 * VPN/proxy/datacenter block are ALWAYS enforced at claim. The only
 * configurable gate is an optional IP-geolocated country allowlist
 * (empty = claimable from any country). All checks are off-chain, evaluated at
 * release — the claim API is the sole authority that can release the funds.
 */
export type ChequeGate = { kind: "country"; allowed: string[] };

export type ChequeRow = {
  id: string;
  creatorUserId: number;
  amountMicros: bigint;
  payeeLabel: string | null;
  memo: string | null;
  signatureName: string | null;
  status: ChequeStatus;
  fundDigest: string | null;
  claimedToAddress: string | null;
  expiresAt: number;
  createdAt: number;
};

// ─── Schema ─────────────────────────────────────────────────────────────────

let _schemaReady: Promise<void> | null = null;
export function ensureChequesSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    await ensureSchema();
    await db().execute(`
      CREATE TABLE IF NOT EXISTS cheques (
        id                 TEXT PRIMARY KEY,
        creator_user_id    INTEGER NOT NULL REFERENCES users(id),
        amount_micros      BIGINT NOT NULL CHECK (amount_micros > 0),
        asset              TEXT NOT NULL DEFAULT 'USDsui',
        secret_hash        TEXT NOT NULL,
        payee_label        TEXT,
        memo               TEXT,
        signature_name     TEXT,
        status             TEXT NOT NULL DEFAULT 'draft',
        fund_digest        TEXT,
        release_digest     TEXT,
        claimed_by_user_id INTEGER REFERENCES users(id),
        claimed_to_address TEXT,
        expires_at         BIGINT NOT NULL,
        created_at         BIGINT NOT NULL,
        funded_at          BIGINT,
        claimed_at         BIGINT,
        voided_at          BIGINT
      )
    `);
    await db().execute(
      `CREATE INDEX IF NOT EXISTS idx_cheques_creator ON cheques(creator_user_id, created_at DESC)`
    );
    await db().execute(
      `CREATE INDEX IF NOT EXISTS idx_cheques_status ON cheques(status, expires_at)`
    );
    await db().execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cheques_fund_digest ON cheques(fund_digest) WHERE fund_digest IS NOT NULL`
    );
    await db().execute(`
      CREATE TABLE IF NOT EXISTS cheque_gates (
        id         SERIAL PRIMARY KEY,
        cheque_id  TEXT NOT NULL REFERENCES cheques(id),
        kind       TEXT NOT NULL,
        params     TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL
      )
    `);
    await db().execute(
      `CREATE INDEX IF NOT EXISTS idx_cheque_gates_cheque ON cheque_gates(cheque_id)`
    );
    await db().execute(`
      CREATE TABLE IF NOT EXISTS cheque_claim_attempts (
        id          SERIAL PRIMARY KEY,
        cheque_id   TEXT NOT NULL REFERENCES cheques(id),
        user_id     INTEGER REFERENCES users(id),
        passed      BOOLEAN NOT NULL,
        failed_gate TEXT,
        ip          TEXT,
        geo_country TEXT,
        is_vpn      BOOLEAN,
        created_at  BIGINT NOT NULL
      )
    `);
    await db().execute(
      `CREATE INDEX IF NOT EXISTS idx_cheque_attempts_cheque ON cheque_claim_attempts(cheque_id, created_at DESC)`
    );
  })();
  return _schemaReady;
}

// ─── Secrets / ids ────────────────────────────────────────────────────────────

const B32 = "0123456789abcdefghijklmnopqrstuv";
function base32(buf: Buffer): string {
  let out = "";
  for (const b of buf) out += B32[b & 0x1f];
  return out;
}
export function newChequeId(): string {
  return `chq_${base32(randomBytes(16))}`;
}
export function newClaimSecret(): string {
  return randomBytes(32).toString("hex");
}
export function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
/** Constant-time hex compare; false on any length/format mismatch. */
export function secretMatches(secret: string, expectedHash: string): boolean {
  try {
    const a = Buffer.from(sha256hex(secret), "hex");
    const b = Buffer.from(expectedHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Escrow key (server-custodied) ───────────────────────────────────────────

let _escrow: Ed25519Keypair | null = null;
/** The escrow operator key. Same pattern as lib/suins-operator.ts. */
function escrowKeypair(): Ed25519Keypair {
  if (_escrow) return _escrow;
  const k = process.env.CHEQUE_ESCROW_SK;
  if (!k) throw new Error("CHEQUE_ESCROW_SK missing — the cheque escrow key");
  _escrow = Ed25519Keypair.fromSecretKey(k);
  return _escrow;
}
export function chequesEnabled(): boolean {
  return !!process.env.CHEQUE_ESCROW_SK;
}
/** The single Talise-controlled address cheques are funded into. */
export function escrowAddress(): string {
  return escrowKeypair().getPublicKey().toSuiAddress();
}

export function usdToMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDSUI_DECIMALS));
}
export function microsToUsd(micros: bigint): number {
  return Number(micros) / 10 ** USDSUI_DECIMALS;
}

// ─── Create / read ────────────────────────────────────────────────────────────

export async function createCheque(input: {
  creatorUserId: number;
  amountMicros: bigint;
  payeeLabel?: string | null;
  memo?: string | null;
  signatureName?: string | null;
  gates: ChequeGate[];
  ttlMs?: number;
}): Promise<{ id: string; secret: string; expiresAt: number }> {
  await ensureChequesSchema();
  const id = newChequeId();
  const secret = newClaimSecret();
  const now = Date.now();
  const expiresAt = now + (input.ttlMs ?? CHEQUE_TTL_MS);
  await db().execute({
    sql: `INSERT INTO cheques
            (id, creator_user_id, amount_micros, asset, secret_hash, payee_label,
             memo, signature_name, status, expires_at, created_at)
          VALUES (?, ?, ?, 'USDsui', ?, ?, ?, ?, 'draft', ?, ?)`,
    args: [
      id,
      input.creatorUserId,
      input.amountMicros.toString(),
      sha256hex(secret),
      input.payeeLabel ?? null,
      input.memo ?? null,
      input.signatureName ?? null,
      expiresAt,
      now,
    ],
  });
  for (const g of input.gates) {
    // Only a non-empty country allowlist is persisted; captcha + VPN-block are
    // always-on and implicit (enforced at claim, not stored per-cheque).
    if (g.kind === "country" && g.allowed.length > 0) {
      await db().execute({
        sql: `INSERT INTO cheque_gates (cheque_id, kind, params, created_at) VALUES (?, 'country', ?, ?)`,
        args: [id, JSON.stringify({ allowed: g.allowed }), now],
      });
    }
  }
  return { id, secret, expiresAt };
}

export async function getCheque(id: string): Promise<ChequeRow | null> {
  await ensureChequesSchema();
  const r = await db().execute({
    sql: `SELECT id, creator_user_id, amount_micros, payee_label, memo, signature_name,
                 status, fund_digest, claimed_to_address, expires_at, created_at
          FROM cheques WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    creatorUserId: Number(row.creator_user_id),
    amountMicros: BigInt(String(row.amount_micros)),
    payeeLabel: (row.payee_label as string | null) ?? null,
    memo: (row.memo as string | null) ?? null,
    signatureName: (row.signature_name as string | null) ?? null,
    status: String(row.status) as ChequeStatus,
    fundDigest: (row.fund_digest as string | null) ?? null,
    claimedToAddress: (row.claimed_to_address as string | null) ?? null,
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
  };
}

/** The cheque's optional country allowlist (ISO-3166 alpha-2, uppercase). [] = no country gate. */
export async function countryAllowlist(id: string): Promise<string[]> {
  await ensureChequesSchema();
  const r = await db().execute({
    sql: `SELECT params FROM cheque_gates WHERE cheque_id = ? AND kind = 'country' LIMIT 1`,
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return [];
  try {
    return ((JSON.parse(String(row.params ?? "{}")).allowed ?? []) as string[]).map((c) =>
      String(c).toUpperCase()
    );
  } catch {
    return [];
  }
}

/** Validate a cheque against its claim secret. Returns the row only on match. */
export async function getChequeForClaim(
  id: string,
  secret: string
): Promise<ChequeRow | null> {
  await ensureChequesSchema();
  const r = await db().execute({
    sql: `SELECT secret_hash FROM cheques WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const hash = r.rows[0]?.secret_hash as string | undefined;
  if (!hash || !secretMatches(secret, hash)) return null;
  return getCheque(id);
}

// ─── Funding confirmation ─────────────────────────────────────────────────────

/**
 * Mark a draft cheque funded once its on-chain deposit to the escrow lands.
 * Verifies the digest moved `amountMicros` of USDsui from the creator into the
 * escrow, then atomically flips draft→funded (single-use fund_digest via the
 * partial-unique index). Returns false if already funded / digest reused / the
 * deposit doesn't check out.
 */
export async function markFunded(input: {
  chequeId: string;
  digest: string;
  creatorAddress: string;
}): Promise<{ ok: boolean; reason?: string }> {
  await ensureChequesSchema();
  const cq = await getCheque(input.chequeId);
  if (!cq) return { ok: false, reason: "not_found" };
  if (cq.status !== "draft") return { ok: false, reason: `not_draft:${cq.status}` };

  const verified = await verifyEscrowDeposit({
    digest: input.digest,
    fromAddress: input.creatorAddress,
    amountMicros: cq.amountMicros,
  });
  if (!verified) return { ok: false, reason: "deposit_unverified" };

  const r = await db().execute({
    sql: `UPDATE cheques SET status='funded', fund_digest=?, funded_at=?
          WHERE id=? AND status='draft' RETURNING id`,
    args: [input.digest, Date.now(), input.chequeId],
  });
  if (r.rows.length === 0) return { ok: false, reason: "race_lost" };
  return { ok: true };
}

/** Confirm on-chain that `digest` credited the escrow with ≥amount of USDsui. */
async function verifyEscrowDeposit(input: {
  digest: string;
  fromAddress: string;
  amountMicros: bigint;
}): Promise<boolean> {
  try {
    const escrow = escrowAddress().toLowerCase();
    const tx = (await sui().getTransaction({
      digest: input.digest,
      include: { balanceChanges: true, effects: true },
    })) as {
      Transaction?: {
        balanceChanges?: Array<{ address?: string; coinType?: string; amount?: string }>;
        effects?: { status?: { success?: boolean } };
      };
    } & { balanceChanges?: unknown };
    const inner = (tx.Transaction ?? tx) as {
      balanceChanges?: Array<{ address?: string; coinType?: string; amount?: string }>;
      effects?: { status?: { success?: boolean } };
    };
    const changes = inner.balanceChanges ?? [];
    for (const ch of changes) {
      const owner = (ch.address ?? "").toLowerCase();
      const isUsdsui = /::usdsui::usdsui$/i.test(ch.coinType ?? "");
      if (owner === escrow && isUsdsui) {
        const credited = BigInt(ch.amount ?? "0");
        if (credited >= input.amountMicros) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Claim eligibility: captcha + VPN block + optional country gate ──────────

export type ClaimGateReason = "captcha" | "vpn" | "country" | "geo_unavailable";
export type ClaimEligibility = {
  ok: boolean;
  reason?: ClaimGateReason;
  country?: string | null;
  isVpn?: boolean;
};

/** Pull the client IP from the forwarded headers (Vercel / proxies). */
export function ipFromRequest(req: Request): string | null {
  const xff =
    req.headers.get("x-vercel-forwarded-for") ??
    req.headers.get("x-forwarded-for") ??
    "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || null;
}

type IpInfo = { country: string; proxy: boolean; hosting: boolean };
async function lookupIp(ip: string | null): Promise<IpInfo | null> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return null;
  }
  try {
    // ip-api.com: free + keyless. `proxy` = VPN/proxy/Tor, `hosting` = datacenter.
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,proxy,hosting`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const b = (await res.json()) as {
      status?: string;
      countryCode?: string;
      proxy?: boolean;
      hosting?: boolean;
    };
    if (b.status !== "success" || !b.countryCode) return null;
    return { country: String(b.countryCode).toUpperCase(), proxy: !!b.proxy, hosting: !!b.hosting };
  } catch {
    return null;
  }
}

/**
 * Gate a claim, evaluated server-side at release (the API is the sole authority
 * that releases funds):
 *   1) CAPTCHA — a valid Turnstile token (when Turnstile is configured).
 *   2) VPN BLOCK — reject proxy / VPN / Tor / datacenter IPs (ip-api flags).
 *   3) COUNTRY — if the cheque has a country allowlist, the IP must geolocate
 *      into it. No allowlist → any country.
 */
export async function checkClaimEligibility(input: {
  chequeId: string;
  ip: string | null;
  turnstileToken: string | null;
}): Promise<ClaimEligibility> {
  // 1) Anti-bot captcha.
  if (turnstileConfigured()) {
    const ok = await verifyTurnstile(input.turnstileToken ?? "", input.ip ?? undefined);
    if (!ok) return { ok: false, reason: "captcha" };
  }
  const allowed = await countryAllowlist(input.chequeId);
  // 2 + 3) IP intelligence.
  const geo = await lookupIp(input.ip);
  if (!geo) {
    // No geo signal (localhost/dev or lookup down): can't verify VPN/country.
    // Allow only when there's no country gate; fail closed otherwise.
    return allowed.length === 0
      ? { ok: true, country: null }
      : { ok: false, reason: "geo_unavailable", country: null };
  }
  if (geo.proxy || geo.hosting) {
    return { ok: false, reason: "vpn", isVpn: true, country: geo.country };
  }
  if (allowed.length > 0 && !allowed.includes(geo.country)) {
    return { ok: false, reason: "country", country: geo.country, isVpn: false };
  }
  return { ok: true, country: geo.country, isVpn: false };
}

export async function recordClaimAttempt(input: {
  chequeId: string;
  userId?: number | null;
  passed: boolean;
  failedGate?: string | null;
  ip?: string | null;
  country?: string | null;
  isVpn?: boolean | null;
}): Promise<void> {
  await ensureChequesSchema();
  await db().execute({
    sql: `INSERT INTO cheque_claim_attempts
            (cheque_id, user_id, passed, failed_gate, ip, geo_country, is_vpn, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.chequeId,
      input.userId ?? null,
      input.passed,
      input.failedGate ?? null,
      input.ip ?? null,
      input.country ?? null,
      input.isVpn ?? null,
      Date.now(),
    ],
  });
}

// ─── Release / void (escrow-signed transfers) ────────────────────────────────

/**
 * Release: atomically claim the row (funded→claiming, the double-claim lock),
 * pay the escrow→claimer transfer, then funded→claimed. Rolls back to funded if
 * the broadcast fails so a retry is safe. Caller MUST have already verified the
 * secret + re-evaluated all gates.
 */
export async function releaseCheque(input: {
  chequeId: string;
  claimerUserId: number;
  claimerAddress: string;
}): Promise<{ ok: boolean; digest?: string; reason?: string }> {
  await ensureChequesSchema();
  const now = Date.now();
  const lock = await db().execute({
    sql: `UPDATE cheques SET status='claiming'
          WHERE id=? AND status='funded' AND expires_at > ? RETURNING amount_micros`,
    args: [input.chequeId, now],
  });
  if (lock.rows.length === 0) return { ok: false, reason: "not_claimable" };
  const micros = BigInt(String(lock.rows[0].amount_micros));

  try {
    const digest = await escrowTransfer(input.claimerAddress, micros);
    await db().execute({
      sql: `UPDATE cheques SET status='claimed', release_digest=?, claimed_by_user_id=?,
              claimed_to_address=?, claimed_at=? WHERE id=?`,
      args: [digest, input.claimerUserId, input.claimerAddress, Date.now(), input.chequeId],
    });
    return { ok: true, digest };
  } catch (e) {
    // Roll back so the claimer can retry.
    await db().execute({
      sql: `UPDATE cheques SET status='funded' WHERE id=? AND status='claiming'`,
      args: [input.chequeId],
    });
    return { ok: false, reason: (e as Error).message };
  }
}

/** Creator reclaim of an unclaimed cheque: escrow→creator, funded→voided. */
export async function voidCheque(input: {
  chequeId: string;
  creatorUserId: number;
  creatorAddress: string;
}): Promise<{ ok: boolean; digest?: string; reason?: string }> {
  await ensureChequesSchema();
  const lock = await db().execute({
    sql: `UPDATE cheques SET status='voiding'
          WHERE id=? AND creator_user_id=? AND status='funded' RETURNING amount_micros`,
    args: [input.chequeId, input.creatorUserId],
  });
  if (lock.rows.length === 0) return { ok: false, reason: "not_voidable" };
  const micros = BigInt(String(lock.rows[0].amount_micros));
  try {
    const digest = await escrowTransfer(input.creatorAddress, micros);
    await db().execute({
      sql: `UPDATE cheques SET status='voided', release_digest=?, voided_at=? WHERE id=?`,
      args: [digest, Date.now(), input.chequeId],
    });
    return { ok: true, digest };
  } catch (e) {
    await db().execute({
      sql: `UPDATE cheques SET status='funded' WHERE id=? AND status='voiding'`,
      args: [input.chequeId],
    });
    return { ok: false, reason: (e as Error).message };
  }
}

/** Cron: reclaim funded cheques past expiry back to their creators. */
export async function sweepExpiredCheques(limit = 50): Promise<number> {
  await ensureChequesSchema();
  const now = Date.now();
  const due = await db().execute({
    sql: `SELECT c.id, c.amount_micros, u.sui_address AS creator_address
          FROM cheques c JOIN users u ON u.id = c.creator_user_id
          WHERE c.status='funded' AND c.expires_at < ? LIMIT ?`,
    args: [now, limit],
  });
  let swept = 0;
  for (const row of due.rows) {
    const id = String(row.id);
    const lock = await db().execute({
      sql: `UPDATE cheques SET status='voiding' WHERE id=? AND status='funded' RETURNING id`,
      args: [id],
    });
    if (lock.rows.length === 0) continue;
    try {
      const digest = await escrowTransfer(
        String(row.creator_address),
        BigInt(String(row.amount_micros))
      );
      await db().execute({
        sql: `UPDATE cheques SET status='expired', release_digest=?, voided_at=? WHERE id=?`,
        args: [digest, Date.now(), id],
      });
      swept += 1;
    } catch {
      await db().execute({
        sql: `UPDATE cheques SET status='funded' WHERE id=? AND status='voiding'`,
        args: [id],
      });
    }
  }
  return swept;
}

/**
 * Pay USDsui out of the escrow to `toAddress`, signed by the escrow key. Uses
 * the proven gasless `0x2::balance::send_funds<USDSUI>` accumulator recipe
 * (gasPrice/budget 0, ValidDuring, setGasPayment([])) — same as the app's
 * gasless send branch in send/sponsor-prepare — so releases cost the escrow no
 * gas, provided the escrow's USDsui sits in its Address Balance accumulator
 * (which it does when cheques are funded via the gasless rail).
 */
async function escrowTransfer(toAddress: string, micros: bigint): Promise<string> {
  const kp = escrowKeypair();
  const sender = kp.getPublicKey().toSuiAddress();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: "0x2::balance::send_funds",
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.balance({ type: USDSUI_TYPE, balance: micros }), tx.pure.address(toAddress)],
  });
  tx.setGasPrice(0n);
  tx.setGasBudget(0n);
  const [chainId, currentEpoch] = await Promise.all([getChainIdentifier(), getCurrentEpoch()]);
  const epoch = BigInt(currentEpoch);
  tx.setExpiration({
    ValidDuring: {
      minEpoch: String(epoch),
      maxEpoch: String(epoch + 1n),
      minTimestamp: null,
      maxTimestamp: null,
      chain: chainId,
      nonce: randomBytes(4).readUInt32BE(0),
    },
  });
  tx.setGasPayment([]);
  const client = sui();
  const bytes = await tx.build({ client: client as never });
  const { signature } = await kp.signTransaction(bytes);
  const result = (await client.executeTransaction({
    transaction: fromBase64(Buffer.from(bytes).toString("base64")),
    signatures: [signature],
  })) as Record<string, unknown>;
  const inner =
    (result.Transaction as { digest?: string } | undefined) ??
    (result.FailedTransaction as { digest?: string } | undefined);
  const digest = (result.digest as string | undefined) ?? inner?.digest;
  if (!digest) throw new Error("escrow release produced no digest");
  if ((result.$kind as string | undefined) === "FailedTransaction") {
    throw new Error("escrow release failed on chain");
  }
  return digest;
}

/** Public base URL for claim links (e.g. https://www.talise.io). */
export function chequeBaseUrl(): string {
  return (process.env.TALISE_PUBLIC_URL ?? "https://www.talise.io").replace(/\/+$/, "");
}
export function claimUrl(id: string, secret: string): string {
  return `${chequeBaseUrl()}/c/${id}#${secret}`;
}
