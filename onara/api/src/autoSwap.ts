// Onara auto-swap executor — Path C off-chain side.
//
// This route is the worker-signed leg of the auto-swap flow described
// in move/talise/AUTOSWAP.md. The handler builds and submits a PTB that
// atomically extracts `Balance<Source>` from a TaliseVault, swaps it on
// Cetus, and deposits the resulting `Balance<Dest>` back into the same
// vault. The Move side (`vault::auto_swap_extract` → `validate_for_swap`)
// asserts the signer is the registry admin — which is the same sponsor
// keypair derived from SUI_MNEMONIC, so signing with that keypair as
// sender (not as additional sponsor sig) is what unlocks the cap.
//
// NOTE: the Cetus call is a clearly-marked STUB. A follow-up change has
// to replace `cetusSwap` with a real aggregator call (probably 7K or the
// Cetus SDK) — see the TODO inside the function. Until then, this route
// will simulate/submit a PTB that the chain rejects with a "function
// not found" error, which is fine for plumbing verification on testnet
// but obviously not for mainnet.

import type { Context } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from 'hono/adapter'
import { z } from 'zod'
import {
  Transaction,
  type TransactionObjectArgument,
} from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { isValidSuiObjectId } from '@mysten/sui/utils'
import pRetry from 'p-retry'
import pTimeout from 'p-timeout'

// ─── Env shape (subset — must match app.ts Bindings) ─────────────────────────

type Bindings = {
  SUI_GRPC_URL: string
  SUI_NETWORK: string
  SUI_MNEMONIC: string
  EXECUTION_TIMEOUT_MS?: string
  HAYABUSA?: { fetch: typeof fetch }
}

// ─── Request validation ──────────────────────────────────────────────────────

// Sui Move type tag — roughly `0x<hex>::module::Name` optionally with
// generic params. We deliberately keep this loose; the chain is the
// final arbiter of well-formedness.
const moveTypeRegex =
  /^0x[0-9a-fA-F]{1,64}::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_<>:,\s0-9a-fA-Fx]*$/

const u64String = z
  .string()
  .trim()
  .regex(/^\d+$/, 'amount must be a u64 decimal string')
  .refine((s) => {
    try {
      const v = BigInt(s)
      return v > 0n && v <= 18446744073709551615n
    } catch {
      return false
    }
  }, 'amount must fit in u64 and be > 0')

const objectIdField = z
  .string()
  .trim()
  .refine(isValidSuiObjectId, 'must be a 0x… Sui object id')

const autoSwapBodySchema = z.object({
  vaultId: objectIdField,
  capId: objectIdField,
  sourceType: z
    .string()
    .trim()
    .min(5, 'sourceType missing')
    .regex(moveTypeRegex, 'sourceType is not a valid Move type tag'),
  destType: z
    .string()
    .trim()
    .min(5, 'destType missing')
    .regex(moveTypeRegex, 'destType is not a valid Move type tag'),
  amount: u64String,
  packageId: objectIdField,
  registryId: objectIdField,
  pool: objectIdField.optional(),
})

export type AutoSwapRequest = z.infer<typeof autoSwapBodySchema>

// ─── Cetus swap STUB ─────────────────────────────────────────────────────────
//
// TODO(cetus-real): replace this with a real Cetus aggregator call.
// Right now it emits a single moveCall that takes the source balance and
// produces a dummy `Balance<Dest>` — the target string here is a
// PLACEHOLDER and does not resolve on chain. A follow-up commit should
// either:
//   (a) call `cetus_clmm::pool::swap_b2a` / `swap_a2b` directly on a
//       specific pool, then wrap the resulting Coin<Dest> into a Balance,
//       OR
//   (b) use 7K Aggregator's swap helper which already gives back
//       Balance<Dest> on the PTB.
//
// The function intentionally lives in this same file so the follow-up
// agent only has to touch one place.
function cetusSwap(
  tx: Transaction,
  sourceBalance: TransactionObjectArgument,
  sourceType: string,
  destType: string,
  pool: string | undefined,
): TransactionObjectArgument {
  // Encode the pool (if any) as an arg so the placeholder call shape is
  // closer to what the real Cetus call will look like. When pool is
  // omitted we pass a zero address — the real aggregator path would use
  // best-price routing instead.
  const poolArg = tx.pure.address(
    pool ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
  )

  // PLACEHOLDER move call — see TODO above. Returns the swap output as
  // `Balance<Dest>`. This target string is intentionally fake-but-shaped
  // like a real Cetus entrypoint so a TS reader notices the stub.
  const [swapped] = tx.moveCall({
    target:
      '0x0000000000000000000000000000000000000000000000000000000000000000::cetus_stub::swap',
    typeArguments: [sourceType, destType],
    arguments: [sourceBalance, poolArg],
  })
  if (!swapped) {
    throw new Error('Cetus stub did not return a result')
  }
  return swapped
}

// ─── PTB builder ─────────────────────────────────────────────────────────────

function buildAutoSwapTx(req: AutoSwapRequest, sender: string): Transaction {
  const tx = new Transaction()
  tx.setSender(sender)

  // 1. Extract source balance + SwapTicket hot-potato from the vault.
  //    Post-audit, `auto_swap_extract` returns `(Balance<Source>, SwapTicket)`
  //    where SwapTicket has no abilities — it MUST be consumed by
  //    `auto_swap_deposit` later in this same PTB. The destructuring
  //    here mirrors that Move return-tuple.
  const extractResult = tx.moveCall({
    target: `${req.packageId}::vault::auto_swap_extract`,
    typeArguments: [req.sourceType],
    arguments: [
      tx.object(req.vaultId),
      tx.object(req.registryId),
      tx.object(req.capId),
      tx.pure.u64(req.amount),
      tx.object.clock(),
    ],
  })
  const sourceBalance = extractResult[0]
  const swapTicket = extractResult[1]
  if (!sourceBalance || !swapTicket) {
    throw new Error('vault::auto_swap_extract did not return (balance, ticket)')
  }

  // 2. Swap through Cetus (STUB — see cetusSwap).
  const swappedBalance = cetusSwap(
    tx,
    sourceBalance,
    req.sourceType,
    req.destType,
    req.pool,
  )

  // 3. Deposit the swap output back into the same vault and consume
  //    the ticket. The Move side asserts `ticket.vault_id == vault.id`
  //    so funds can't be funneled to a different vault in the same PTB.
  tx.moveCall({
    target: `${req.packageId}::vault::auto_swap_deposit`,
    typeArguments: [req.destType],
    arguments: [
      tx.object(req.vaultId),
      swappedBalance,
      swapTicket,
      tx.object.clock(),
    ],
  })

  return tx
}

// ─── Client / keypair helpers ────────────────────────────────────────────────

let _grpc: SuiGrpcClient | null = null
let _grpcKey = ''
function getGrpc(bindings: Bindings): SuiGrpcClient {
  if (bindings.HAYABUSA) {
    // Hayabusa fetch isn't pinned here — auto-swap is one-shot so we
    // don't need the read-after-write pinning trick from /sponsor.
    return new SuiGrpcClient({
      network: bindings.SUI_NETWORK,
      baseUrl: bindings.SUI_GRPC_URL,
      fetch: ((input, init) => bindings.HAYABUSA!.fetch(input, init)) as typeof fetch,
    })
  }
  const key = `${bindings.SUI_NETWORK}:${bindings.SUI_GRPC_URL}`
  if (_grpc && _grpcKey === key) return _grpc
  _grpc = new SuiGrpcClient({
    network: bindings.SUI_NETWORK,
    baseUrl: bindings.SUI_GRPC_URL,
  })
  _grpcKey = key
  return _grpc
}

let _kp: Ed25519Keypair | null = null
let _kpMnemonic = ''
function getKeypair(mnemonic: string): Ed25519Keypair {
  if (_kp && _kpMnemonic === mnemonic) return _kp
  _kp = Ed25519Keypair.deriveKeypair(mnemonic)
  _kpMnemonic = mnemonic
  return _kp
}

// ─── Route ───────────────────────────────────────────────────────────────────

const DEFAULT_EXECUTION_TIMEOUT_MS = 45_000

async function handleAutoSwap(c: Context<{ Bindings: Bindings }>) {
  const bindings = env<Bindings>(c)

  // Body parse
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Request body must be valid JSON.' }, 400)
  }

  const parsed = autoSwapBodySchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request body.'
    return c.json({ ok: false, error: message }, 400)
  }
  const req = parsed.data

  // Sanity: source != dest is *probably* what the caller wants, but the
  // chain will accept a same-type "swap" — it just becomes a no-op route
  // through Cetus, which is harmless. So don't reject here.

  const keypair = getKeypair(bindings.SUI_MNEMONIC)
  const sender = keypair.toSuiAddress()
  const grpc = getGrpc(bindings)

  // Build PTB
  let txBytes: Uint8Array
  try {
    const tx = buildAutoSwapTx(req, sender)
    txBytes = await tx.build({ client: grpc })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to build auto-swap transaction.'
    return c.json({ ok: false, error: `Build failed: ${message}` }, 500)
  }

  // Execute
  const executionTimeoutMs = bindings.EXECUTION_TIMEOUT_MS
    ? Number(bindings.EXECUTION_TIMEOUT_MS)
    : DEFAULT_EXECUTION_TIMEOUT_MS

  try {
    const result = await pTimeout(
      pRetry(
        () =>
          grpc.signAndExecuteTransaction({
            signer: keypair,
            transaction: txBytes,
            include: { effects: true },
          }),
        { retries: 1 },
      ),
      {
        milliseconds: executionTimeoutMs,
        message: 'Auto-swap execution timed out.',
      },
    )

    const tx =
      result.$kind === 'Transaction'
        ? result.Transaction
        : result.FailedTransaction
    const digest = tx?.digest ?? ''

    if (result.$kind === 'FailedTransaction') {
      const errMsg =
        result.FailedTransaction?.effects?.status?.error ?? 'Transaction failed.'
      return c.json(
        {
          ok: false,
          error: errMsg,
          digest,
          vaultId: req.vaultId,
          sourceType: req.sourceType,
          amount: req.amount,
        },
        500,
      )
    }

    return c.json({
      ok: true,
      digest,
      vaultId: req.vaultId,
      sourceType: req.sourceType,
      destType: req.destType,
      amount: req.amount,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Auto-swap execution failed.'
    return c.json(
      {
        ok: false,
        error: message,
        vaultId: req.vaultId,
        sourceType: req.sourceType,
        amount: req.amount,
      },
      500,
    )
  }
}

// ─── Hono sub-app ────────────────────────────────────────────────────────────

const autoSwap = new Hono<{ Bindings: Bindings }>()
autoSwap.use(cors())
autoSwap.post('/', handleAutoSwap)

export default autoSwap
export { handleAutoSwap, buildAutoSwapTx, cetusSwap, autoSwapBodySchema }
