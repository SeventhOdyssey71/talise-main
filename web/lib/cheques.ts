import "server-only";

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { db, ensureSchema } from "@/lib/db";
import { sui, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { onara } from "@/lib/onara";
import { getChainIdentifier, getCurrentEpoch } from "@/lib/sui-epoch";
import { getNormalizedTransaction } from "@/lib/sui-shapes";
import { verifyTurnstile, turnstileConfigured } from "@/lib/turnstile";

/**
 * Talise Cheques — claimable USDsui links presented as real-life cheques.
 *
 * TWO interchangeable rails, picked at RUNTIME by an env flag:
 *
 *   1. ON-CHAIN (gated behind `CHEQUE_PACKAGE_ID` + `CHEQUE_REGISTRY_ID`):
 *      the funds live in a per-cheque shared `Cheque<USDSUI>` object held by
 *      the deployed `talise::cheque` Move module (see
 *      move/talise-pay/sources/cheque.move). The creator funds it with a
 *      ONE-SHOT Onara-SPONSORED `cheque::create` PTB (the user signs, Onara
 *      pays gas; a custom Move call is NOT gasless-eligible). The cheque
 *      worker key (`CHEQUE_ESCROW_SK`, registered on-chain as a worker) signs
 *      `cheque::claim(recipient)` AFTER the off-chain gates pass; the contract
 *      transfers the whole escrow to the claimer. The CREATOR signs a
 *      sponsored `cheque::reclaim` to pull an unclaimed cheque back. The
 *      contract's one-shot `claimed` flag is the on-chain double-claim guard.
 *
 *   2. ESCROW + SCHEDULER (the live fallback, when the package id is UNSET):
 *      a SERVER-CUSTODIED escrow keyed by a hashed claim secret. The creator
 *      funds a single Talise-controlled escrow address via the normal send
 *      pipeline; the claim API is the SOLE authority that can release the
 *      money. The escrow key (an Ed25519 operator key, same pattern as
 *      lib/suins-operator.ts) signs the escrow→claimer release; double-claim
 *      is locked by an atomic `UPDATE ... WHERE status='funded' RETURNING`.
 *
 * Both rails share the SAME off-chain gates (captcha + VPN block + optional
 * country allowlist) and the SAME `cheques` table. The on-chain path is
 * purely additive, behind the env flag — an unset `CHEQUE_PACKAGE_ID` leaves
 * the escrow path 100% unchanged.
 *
 * µUSDsui = BIGINT, 6 decimals.
 */

const CHEQUE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days default expiry

/** The shared Sui Clock object id (immutable, network-wide). */
const SUI_CLOCK_ID = "0x6";

export type ChequeStatus =
  | "draft"
  | "funded"
  | "claiming"
  | "claimed"
  | "voiding"
  | "voided"
  // On-chain reclaim terminal state (creator pulled an unclaimed cheque back).
  | "reclaimed"
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
  /** The on-chain shared `Cheque<USDSUI>` object id. Null on the escrow rail,
   *  and null on the on-chain rail until the funding tx is confirmed. */
  chequeObjectId: string | null;
  creatorUserId: number;
  /** The creator's Sui address (snapshotted at create, for reclaim auth + audit). */
  creatorAddress: string | null;
  amountMicros: bigint;
  asset: string;
  payeeLabel: string | null;
  memo: string | null;
  signatureName: string | null;
  status: ChequeStatus;
  fundDigest: string | null;
  claimDigest: string | null;
  reclaimDigest: string | null;
  claimedByUserId: number | null;
  claimedToAddress: string | null;
  claimerCountry: string | null;
  expiresAt: number;
  createdAt: number;
  fundedAt: number | null;
  claimedAt: number | null;
};

// ─── Schema ─────────────────────────────────────────────────────────────────

let _schemaReady: Promise<void> | null = null;
export function ensureChequesSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    await ensureSchema();
    const c = db();

    // ── cheques: the cheque state machine ────────────────────────────────
    //
    // One row per cheque. A clean state machine:
    //
    //   draft ──fund──▶ funded ──claim──▶ claimed        (recipient paid)
    //                     │  └──reclaim──▶ reclaimed      (creator pulled back, on-chain)
    //                     │  └──void─────▶ voided         (creator pulled back, escrow rail)
    //                     └──expire(cron)▶ expired        (refunded to creator past expiry)
    //                  (claiming/voiding are transient locks held mid-transfer)
    //
    // The funds live EITHER in a per-cheque on-chain `Cheque<USDSUI>` object
    // (`cheque_object_id`, set once the on-chain funding tx confirms) OR in
    // the server escrow address (escrow rail; `cheque_object_id` stays NULL).
    // Created with the full column set; the ALTERs below backfill any column
    // a pre-existing deployment is missing so this is forward- AND
    // backward-compatible.
    await c.execute(`
      CREATE TABLE IF NOT EXISTS cheques (
        id                 TEXT PRIMARY KEY,
        cheque_object_id   TEXT,
        creator_user_id    INTEGER NOT NULL REFERENCES users(id),
        creator_address    TEXT,
        amount_micros      BIGINT NOT NULL CHECK (amount_micros > 0),
        asset              TEXT NOT NULL DEFAULT 'USDsui',
        secret_hash        TEXT NOT NULL,
        payee_label        TEXT,
        memo               TEXT,
        signature_name     TEXT,
        status             TEXT NOT NULL DEFAULT 'draft',
        fund_digest        TEXT,
        release_digest     TEXT,
        claim_digest       TEXT,
        reclaim_digest     TEXT,
        claimed_by_user_id INTEGER REFERENCES users(id),
        claimed_to_address TEXT,
        claimer_country    TEXT,
        expires_at         BIGINT NOT NULL,
        created_at         BIGINT NOT NULL,
        funded_at          BIGINT,
        claimed_at         BIGINT,
        voided_at          BIGINT,
        reclaimed_at       BIGINT
      )
    `);

    // Backward-compatible column backfill for any pre-existing `cheques`
    // table that predates the on-chain rail. Postgres supports
    // `ADD COLUMN IF NOT EXISTS`; each is a no-op when the column exists.
    for (const col of [
      `cheque_object_id TEXT`,
      `creator_address  TEXT`,
      `claim_digest     TEXT`,
      `reclaim_digest   TEXT`,
      `claimer_country  TEXT`,
      `reclaimed_at     BIGINT`,
    ]) {
      await c.execute(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS ${col}`);
    }

    // Creator dashboard read (their cheques, newest first).
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_cheques_creator ON cheques(creator_user_id, created_at DESC)`
    );
    // Expiry sweep read: funded cheques ordered by expiry (status + expiry).
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_cheques_status_expiry ON cheques(status, expires_at)`
    );
    // Single-use funding digest (a reused deposit can't fund two cheques).
    await c.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cheques_fund_digest ON cheques(fund_digest) WHERE fund_digest IS NOT NULL`
    );
    // One DB row per on-chain Cheque object (a single object can't back two rows).
    await c.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cheques_object_id ON cheques(cheque_object_id) WHERE cheque_object_id IS NOT NULL`
    );

    // ── cheque_gates: per-cheque country allowlist ───────────────────────
    await c.execute(`
      CREATE TABLE IF NOT EXISTS cheque_gates (
        id         SERIAL PRIMARY KEY,
        cheque_id  TEXT NOT NULL REFERENCES cheques(id),
        kind       TEXT NOT NULL,
        params     TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL
      )
    `);
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_cheque_gates_cheque ON cheque_gates(cheque_id)`
    );

    // ── cheque_claim_attempts: ip/geo/vpn audit trail (already existed) ───
    await c.execute(`
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
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_cheque_attempts_cheque ON cheque_claim_attempts(cheque_id, created_at DESC)`
    );
  })().catch((err) => {
    // Reset so a transient DDL error retries on the next call (mirrors
    // ensureStreamsSchema / ensureLedgerSchema discipline).
    _schemaReady = null;
    throw err;
  });
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
/**
 * The cheque operator/worker key. On the escrow rail it is the custody key
 * that holds escrowed funds; on the on-chain rail it is the registered
 * `cheque::claim` worker (addr 0x39d4…ae7b, funded with SUI for gas). Same
 * pattern as lib/suins-operator.ts.
 */
function escrowKeypair(): Ed25519Keypair {
  if (_escrow) return _escrow;
  const k = process.env.CHEQUE_ESCROW_SK;
  if (!k) throw new Error("CHEQUE_ESCROW_SK missing — the cheque escrow/worker key");
  _escrow = Ed25519Keypair.fromSecretKey(k);
  return _escrow;
}
export function chequesEnabled(): boolean {
  return !!process.env.CHEQUE_ESCROW_SK;
}
/** The single Talise-controlled address cheques are funded into (escrow rail). */
export function escrowAddress(): string {
  return escrowKeypair().getPublicKey().toSuiAddress();
}

// ─── On-chain rail gating (additive, behind CHEQUE_PACKAGE_ID) ────────────────

/**
 * The published `talise::cheque` package id, when configured. Returns null
 * (on-chain rail gated off) when unset, so an absent id never breaks anything
 * — the escrow + scheduler rail keeps running.
 */
export function chequePackageId(): string | null {
  return process.env.CHEQUE_PACKAGE_ID ?? null;
}

/** The shared `ChequeRegistry` object id, when configured. */
export function chequeRegistryId(): string | null {
  return process.env.CHEQUE_REGISTRY_ID ?? null;
}

/**
 * True when the on-chain `talise::cheque` path is fully configured: package +
 * registry ids set AND the worker key is loadable. When false, the backend
 * uses the live escrow + scheduler rail. This is the ONE gate every on-chain
 * branch checks; a half-configured env (package id but no registry, or no
 * worker key) degrades to the escrow path instead of erroring.
 */
export function chequeOnchainEnabled(): boolean {
  return (
    !!process.env.CHEQUE_PACKAGE_ID &&
    !!process.env.CHEQUE_REGISTRY_ID &&
    !!process.env.CHEQUE_ESCROW_SK
  );
}

/** Fully-qualified on-chain Cheque object type prefix: `${PKG}::cheque::Cheque<`. */
function chequeObjectTypePrefix(pkg: string): string {
  return `${pkg}::cheque::Cheque<`;
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
  /** Snapshotted at create for reclaim auth + audit (the on-chain `creator`). */
  creatorAddress?: string | null;
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
            (id, creator_user_id, creator_address, amount_micros, asset,
             secret_hash, payee_label, memo, signature_name, status,
             expires_at, created_at)
          VALUES (?, ?, ?, ?, 'USDsui', ?, ?, ?, ?, 'draft', ?, ?)`,
    args: [
      id,
      input.creatorUserId,
      input.creatorAddress ?? null,
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
    sql: `SELECT id, cheque_object_id, creator_user_id, creator_address,
                 amount_micros, asset, payee_label, memo, signature_name,
                 status, fund_digest, claim_digest, reclaim_digest,
                 claimed_by_user_id, claimed_to_address, claimer_country,
                 expires_at, created_at, funded_at, claimed_at
          FROM cheques WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    chequeObjectId: (row.cheque_object_id as string | null) ?? null,
    creatorUserId: Number(row.creator_user_id),
    creatorAddress: (row.creator_address as string | null) ?? null,
    amountMicros: BigInt(String(row.amount_micros)),
    asset: String(row.asset ?? "USDsui"),
    payeeLabel: (row.payee_label as string | null) ?? null,
    memo: (row.memo as string | null) ?? null,
    signatureName: (row.signature_name as string | null) ?? null,
    status: String(row.status) as ChequeStatus,
    fundDigest: (row.fund_digest as string | null) ?? null,
    claimDigest: (row.claim_digest as string | null) ?? null,
    reclaimDigest: (row.reclaim_digest as string | null) ?? null,
    claimedByUserId:
      row.claimed_by_user_id == null ? null : Number(row.claimed_by_user_id),
    claimedToAddress: (row.claimed_to_address as string | null) ?? null,
    claimerCountry: (row.claimer_country as string | null) ?? null,
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    fundedAt: row.funded_at == null ? null : Number(row.funded_at),
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
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
 * Mark a draft cheque funded once its funding tx lands. Two rails:
 *
 *   • ON-CHAIN (CHEQUE_PACKAGE_ID set): the digest is the SPONSORED
 *     `cheque::create` tx. We parse its objectChanges for the CREATED
 *     `${PKG}::cheque::Cheque<…>` object (the on-chain cheque), verify the
 *     tx came from the creator + succeeded, then atomically flip draft→funded
 *     and store BOTH `fund_digest` and `cheque_object_id`.
 *
 *   • ESCROW (fallback): the digest moved `amountMicros` of USDsui from the
 *     creator into the server escrow address. We verify that balance change,
 *     then flip draft→funded.
 *
 * Either way the single-use `fund_digest` partial-unique index + the
 * `WHERE status='draft'` guard make this idempotent: a reused digest or a
 * double confirm loses the race. Returns false on any failure.
 */
export async function markFunded(input: {
  chequeId: string;
  digest: string;
  creatorAddress: string;
}): Promise<{ ok: boolean; reason?: string; chequeObjectId?: string }> {
  await ensureChequesSchema();
  const cq = await getCheque(input.chequeId);
  if (!cq) return { ok: false, reason: "not_found" };
  if (cq.status !== "draft") return { ok: false, reason: `not_draft:${cq.status}` };

  // ── On-chain rail: parse the created Cheque object id from the digest ──
  if (chequeOnchainEnabled()) {
    const parsed = await parseCreatedChequeObjectId(input.digest, {
      expectedSender: input.creatorAddress,
    });
    if (!parsed.ok || !parsed.chequeObjectId) {
      return { ok: false, reason: parsed.reason ?? "cheque_object_not_found" };
    }
    const r = await db().execute({
      sql: `UPDATE cheques
              SET status='funded', fund_digest=?, cheque_object_id=?, funded_at=?
            WHERE id=? AND status='draft' RETURNING id`,
      args: [input.digest, parsed.chequeObjectId, Date.now(), input.chequeId],
    });
    if (r.rows.length === 0) return { ok: false, reason: "race_lost" };
    return { ok: true, chequeObjectId: parsed.chequeObjectId };
  }

  // ── Escrow rail (fallback): verify the deposit credited the escrow ──
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
  /** Native app claims are already gated by App Attest + bearer auth, so the
   *  captcha (a web widget) is skipped for them and enforced for web claims. */
  skipCaptcha?: boolean;
}): Promise<ClaimEligibility> {
  // 1) Anti-bot captcha (web claims only; native is App-Attested).
  if (!input.skipCaptcha && turnstileConfigured()) {
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
 * move the funds to the claimer, then funded→claimed. Rolls back to funded if
 * the broadcast fails so a retry is safe. Caller MUST have already verified the
 * secret + re-evaluated all gates.
 *
 * Two rails:
 *   • ON-CHAIN: the cheque worker key signs `cheque::claim(recipient)` (pays
 *     its own SUI gas). The contract transfers the whole escrow to the
 *     claimer and flips its one-shot `claimed` flag — a second worker call
 *     would abort on chain (E_ALREADY_CLAIMED), so the DB lock + the on-chain
 *     flag are belt-and-braces.
 *   • ESCROW: a gasless escrow→claimer USDsui transfer signed by the escrow
 *     key (the existing fallback).
 *
 * Records `claim_digest`, the claimer, and (audit) their geolocated country.
 */
export async function releaseCheque(input: {
  chequeId: string;
  claimerUserId: number;
  claimerAddress: string;
  claimerCountry?: string | null;
}): Promise<{ ok: boolean; digest?: string; reason?: string }> {
  await ensureChequesSchema();
  const now = Date.now();
  const lock = await db().execute({
    sql: `UPDATE cheques SET status='claiming'
          WHERE id=? AND status='funded' AND expires_at > ?
          RETURNING amount_micros, cheque_object_id`,
    args: [input.chequeId, now],
  });
  if (lock.rows.length === 0) return { ok: false, reason: "not_claimable" };
  const micros = BigInt(String(lock.rows[0].amount_micros));
  const chequeObjectId = (lock.rows[0].cheque_object_id as string | null) ?? null;

  const onchain = chequeOnchainEnabled();
  if (onchain && !chequeObjectId) {
    // On-chain rail but no object id recorded — funding never confirmed
    // on-chain. Roll the lock back and refuse rather than fall back to an
    // escrow transfer that has no funds.
    await db().execute({
      sql: `UPDATE cheques SET status='funded' WHERE id=? AND status='claiming'`,
      args: [input.chequeId],
    });
    return { ok: false, reason: "missing_cheque_object" };
  }

  try {
    const digest = onchain
      ? await claimOnChain(chequeObjectId as string, input.claimerAddress)
      : await escrowTransfer(input.claimerAddress, micros);
    await db().execute({
      sql: `UPDATE cheques SET status='claimed', release_digest=?, claim_digest=?,
              claimed_by_user_id=?, claimed_to_address=?, claimer_country=?,
              claimed_at=? WHERE id=?`,
      args: [
        digest,
        digest,
        input.claimerUserId,
        input.claimerAddress,
        input.claimerCountry ?? null,
        Date.now(),
        input.chequeId,
      ],
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

// ─── On-chain rail: cheque::create / claim / reclaim builders ─────────────────

/**
 * Build the Onara-SPONSORED `cheque::create` funding PTB. The user signs it,
 * Onara pays gas (a custom Move call is NOT gasless-eligible — only
 * `0x2::balance::send_funds` is — so the create MUST be sponsored, mirroring
 * the SPONSORED branch of /api/send/sponsor-prepare).
 *
 * Funds source: `tx.balance({ type: USDSUI_TYPE, balance: amountMicros })` —
 * the SAME accumulator-withdrawal primitive the gasless branch hands to
 * `balance::send_funds`. Here it's passed straight as the `funds` arg of
 * `cheque::create<USDSUI>`, so the user's USDsui flows from their Address
 * Balance accumulator into the new on-chain `Cheque<USDSUI>` object in one
 * user-signed, Onara-sponsored tx.
 *
 *   cheque::create<T>(registry, funds: Balance<T>, expiry_ms, clock, ctx): ID
 *
 * Returns the base64 sponsor-ready bytes (the iOS client signs them, then
 * POSTs to /api/zk/sponsor-execute). Throws when the on-chain rail isn't
 * configured or the build fails (the caller surfaces the error).
 */
export async function buildChequeCreateSponsored(input: {
  creatorAddress: string;
  amountMicros: bigint;
  expiryMs: number;
}): Promise<{ bytes: string; sponsor: string }> {
  const pkg = chequePackageId();
  const registry = chequeRegistryId();
  if (!pkg || !registry) {
    throw new Error("cheque on-chain rail not configured (CHEQUE_PACKAGE_ID / CHEQUE_REGISTRY_ID)");
  }
  if (input.amountMicros <= 0n) throw new Error("non-positive cheque amount");

  const onaraClient = onara();
  const client = sui();

  // Sponsor address + reference gas price in parallel (same as sponsor-prepare).
  const [{ address: sponsor }, gasPrice] = await Promise.all([
    onaraClient.status(),
    client.getReferenceGasPrice().then((r) => r.referenceGasPrice),
  ]);

  const tx = new Transaction();
  tx.setSender(input.creatorAddress);

  tx.moveCall({
    target: `${pkg}::cheque::create`,
    typeArguments: [USDSUI_TYPE],
    arguments: [
      tx.object(registry),
      // Pull the Balance<USDSUI> straight from the creator's accumulator —
      // the same primitive the gasless send uses, here fed to cheque::create.
      tx.balance({ type: USDSUI_TYPE, balance: input.amountMicros }),
      tx.pure.u64(BigInt(Math.trunc(input.expiryMs))),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  // Onara sponsors gas: the user is the sender, Onara is the gas owner.
  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));

  const bytes = await tx.build({ client: client as never });
  return { bytes: toBase64(bytes), sponsor };
}

/**
 * Parse the CREATED on-chain `Cheque<…>` object id from a confirmed funding
 * tx digest. Reads the tx via the canonical normalizer, asserts success and
 * (optionally) that the sender matches the expected creator, then returns the
 * single created object whose type starts with `${PKG}::cheque::Cheque<`.
 *
 * Never throws — returns `{ ok:false, reason }` so the caller can decide.
 */
export async function parseCreatedChequeObjectId(
  digest: string,
  opts?: { expectedSender?: string | null }
): Promise<{ ok: boolean; chequeObjectId?: string; reason?: string }> {
  const pkg = chequePackageId();
  if (!pkg) return { ok: false, reason: "onchain_disabled" };
  if (!digest) return { ok: false, reason: "missing_digest" };
  try {
    const tx = await getNormalizedTransaction(digest);
    if (tx.status !== "success") {
      return { ok: false, reason: `tx_failed:${tx.errorMessage ?? "unknown"}` };
    }
    const expected = opts?.expectedSender?.toLowerCase();
    if (expected && tx.sender && tx.sender !== expected) {
      return { ok: false, reason: "sender_mismatch" };
    }
    const prefix = chequeObjectTypePrefix(pkg).toLowerCase();
    for (const ch of tx.objectChanges) {
      if (ch.kind !== "created") continue;
      const ty = (ch.objectType ?? "").toLowerCase();
      // Match `<pkg>::cheque::Cheque<…>` regardless of the coin type-arg.
      if (ty.startsWith(prefix) || ty.includes("::cheque::cheque<")) {
        return { ok: true, chequeObjectId: ch.objectId };
      }
    }
    return { ok: false, reason: "cheque_object_not_found" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message ?? "parse_failed" };
  }
}

/**
 * Worker-signed `cheque::claim(recipient)`. The cheque worker key
 * (`CHEQUE_ESCROW_SK`, registered on-chain as a worker) pays its OWN SUI gas.
 * The contract transfers the whole escrow to `recipientAddress` and flips the
 * one-shot `claimed` flag. Mirrors the worker-sign+execute pattern in
 * lib/suins-operator.ts / lib/streams.ts releaseTranche.
 *
 *   cheque::claim<T>(registry, cheque: &mut Cheque<T>, recipient, clock, ctx)
 *
 * Returns the tx digest on success; throws with the validator's reason on
 * failure (so releaseCheque rolls the DB lock back).
 */
export async function claimOnChain(
  chequeObjectId: string,
  recipientAddress: string
): Promise<string> {
  const pkg = chequePackageId();
  const registry = chequeRegistryId();
  if (!pkg || !registry) {
    throw new Error("cheque on-chain rail not configured");
  }
  const kp = escrowKeypair();
  const client = sui();

  const tx = new Transaction();
  tx.setSender(kp.getPublicKey().toSuiAddress());
  tx.moveCall({
    target: `${pkg}::cheque::claim`,
    typeArguments: [USDSUI_TYPE],
    arguments: [
      tx.object(registry),
      tx.object(chequeObjectId),
      tx.pure.address(recipientAddress),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  // Worker pays its own gas (it is funded) — the SDK auto-selects gas + budget.
  const bytes = await tx.build({ client: client as never });
  const { signature } = await kp.signTransaction(bytes);

  const result = (await client.executeTransaction({
    transaction: bytes,
    signatures: [signature],
    include: { effects: true },
  } as never)) as Record<string, unknown>;

  if ((result.$kind as string | undefined) === "FailedTransaction") {
    const failed = result.FailedTransaction as
      | { effects?: { status?: { error?: unknown } } }
      | undefined;
    throw new Error(`cheque::claim failed: ${extractStatusError(failed?.effects?.status)}`);
  }
  const txInner = result.Transaction as
    | { digest?: string; effects?: { status?: { success?: boolean; error?: unknown } } }
    | undefined;
  if (txInner?.effects?.status && txInner.effects.status.success === false) {
    throw new Error(`cheque::claim failed: ${extractStatusError(txInner.effects.status)}`);
  }
  const digest = txInner?.digest;
  if (!digest) throw new Error("cheque::claim produced no digest");
  return digest;
}

/**
 * Build the Onara-SPONSORED `cheque::reclaim` PTB. CREATOR-signed (the
 * contract asserts `ctx.sender() == cheque.creator`), Onara pays gas (a custom
 * Move call isn't gasless-eligible). The contract returns the `Coin<T>` to the
 * creator — we transfer it back to them in the same PTB.
 *
 *   cheque::reclaim<T>(cheque: &mut Cheque<T>, clock, ctx): Coin<T>
 *
 * The creator can reclaim any time the cheque is unclaimed (the contract
 * asserts `!claimed`). Returns the base64 sponsor-ready bytes the creator
 * signs (then POSTs to /api/zk/sponsor-execute). Throws on misconfig / build
 * failure.
 */
export async function reclaimChequeBuilder(input: {
  chequeObjectId: string;
  creatorAddress: string;
}): Promise<{ bytes: string; sponsor: string }> {
  const pkg = chequePackageId();
  if (!pkg) throw new Error("cheque on-chain rail not configured (CHEQUE_PACKAGE_ID)");

  const onaraClient = onara();
  const client = sui();
  const [{ address: sponsor }, gasPrice] = await Promise.all([
    onaraClient.status(),
    client.getReferenceGasPrice().then((r) => r.referenceGasPrice),
  ]);

  const tx = new Transaction();
  tx.setSender(input.creatorAddress);
  const coin = tx.moveCall({
    target: `${pkg}::cheque::reclaim`,
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(input.chequeObjectId), tx.object(SUI_CLOCK_ID)],
  });
  // The contract hands the Coin<T> back to the PTB; route it to the creator.
  tx.transferObjects([coin], input.creatorAddress);

  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));

  const bytes = await tx.build({ client: client as never });
  return { bytes: toBase64(bytes), sponsor };
}

/**
 * Mark a cheque reclaimed by the creator once the on-chain `cheque::reclaim`
 * tx confirms. CREATOR-only: the caller verifies `creator_user_id` before
 * calling. Atomically flips funded→reclaimed (guards against a double reclaim
 * or a claim/reclaim race — the matching on-chain `!claimed` assert is the
 * real guard, this is the DB mirror). `digest` is the reclaim tx, recorded
 * for audit.
 */
export async function recordReclaim(input: {
  chequeId: string;
  creatorUserId: number;
  digest: string;
}): Promise<{ ok: boolean; reason?: string }> {
  await ensureChequesSchema();
  const r = await db().execute({
    sql: `UPDATE cheques
            SET status='reclaimed', reclaim_digest=?, release_digest=?, reclaimed_at=?
          WHERE id=? AND creator_user_id=? AND status='funded'
          RETURNING id`,
    args: [input.digest, input.digest, Date.now(), input.chequeId, input.creatorUserId],
  });
  if (r.rows.length === 0) return { ok: false, reason: "not_reclaimable" };
  return { ok: true };
}

/** Flatten a gRPC/JSON-RPC status object into a human-readable error string. */
function extractStatusError(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object" && "error" in status) {
    const err = (status as { error?: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as { description?: string; message?: string };
      return e.description ?? e.message ?? "unknown failure";
    }
  }
  return "unknown failure";
}

/** Public base URL for claim links (e.g. https://www.talise.io). */
export function chequeBaseUrl(): string {
  return (process.env.TALISE_PUBLIC_URL ?? "https://www.talise.io").replace(/\/+$/, "");
}
export function claimUrl(id: string, secret: string): string {
  return `${chequeBaseUrl()}/c/${id}#${secret}`;
}
