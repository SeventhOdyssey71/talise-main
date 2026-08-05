import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { randomBytes } from "node:crypto";
import { sui, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { getChainIdentifier, getCurrentEpoch } from "@/lib/sui-epoch";

/**
 * The rewards treasury — its OWN wallet, deliberately.
 *
 * Rewards do not share custody with the off-ramp treasury or the cheque escrow.
 * The cheque escrow in particular holds money that already belongs to people
 * with unclaimed cheques, so an over-issued reward batch draining it would
 * leave those cheques unredeemable. Separate keys mean the blast radius of a
 * bug here is exactly the amount someone chose to fund for rewards.
 *
 *   REWARDS_TREASURY_SK       bech32 `suiprivkey1…` for the paying wallet
 *   TALISE_REWARDS_TREASURY   its address; asserted on every send, so a
 *                             mismatched paste fails loudly instead of paying
 *                             out of some other wallet
 *
 * Transfers use the gasless `send_funds` accumulator recipe (gasPrice/budget 0,
 * ValidDuring expiry, empty gas payment) — the same shape lib/cheques.ts and
 * lib/offramp-refund.ts use. The wallet therefore needs USDsui and NO SUI.
 */

let _kp: Ed25519Keypair | null = null;

export function rewardsTreasuryEnabled(): boolean {
  return !!process.env.REWARDS_TREASURY_SK;
}

function treasuryKeypair(): Ed25519Keypair {
  if (_kp) return _kp;
  const k = process.env.REWARDS_TREASURY_SK;
  if (!k) throw new Error("REWARDS_TREASURY_SK missing, the rewards treasury key");
  _kp = Ed25519Keypair.fromSecretKey(k.trim());
  return _kp;
}

/** Public address of the rewards wallet — this is what gets funded. */
export function rewardsTreasuryAddress(): string {
  return treasuryKeypair().getPublicKey().toSuiAddress();
}

function usdToMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDSUI_DECIMALS));
}

/**
 * Pay USDsui from the rewards treasury. Returns the settled digest.
 *
 * Throws rather than returning a falsy digest on failure: the caller releases
 * the claim on a throw, and a silent partial success would leave a gift marked
 * opened with no money behind it.
 */
export async function rewardsSendUsdsui(toAddress: string, usd: number): Promise<string> {
  const kp = treasuryKeypair();
  const sender = kp.getPublicKey().toSuiAddress();

  const expected = (process.env.TALISE_REWARDS_TREASURY ?? "").trim().toLowerCase();
  if (expected && sender.toLowerCase() !== expected) {
    throw new Error(
      `REWARDS_TREASURY_SK derives to ${sender}, expected ${expected}`
    );
  }

  const micros = usdToMicros(usd);
  if (micros <= 0n) throw new Error("rewardsSendUsdsui: amount must be positive");

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
  if ((result.$kind as string | undefined) === "FailedTransaction") {
    throw new Error("rewards payout failed on chain");
  }
  if (!digest) throw new Error("rewards payout produced no digest");
  return digest;
}
