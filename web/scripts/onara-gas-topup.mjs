#!/usr/bin/env node
/**
 * Top up the Onara sponsor's GAS COINS from its own accumulator balance.
 *
 * ── Why this exists ──
 *
 * Gas on Sui can only be paid from Coin<SUI> OBJECTS. A balance held in the
 * address accumulator cannot pay for anything — it has to be withdrawn into a
 * coin first. The sponsor accrues into the accumulator (that is where Talise's
 * own gasless rail sends value) and spends only from coins, so its usable gas
 * drains in one direction while `/status` reports a healthy-looking total:
 *
 *     addressBalance 10.6300 SUI   accumulator — cannot pay gas
 *     coinBalance     0.4278 SUI   the single coin — the real headroom
 *
 * At a measured 0.0148 SUI per sponsored transaction that is ~29 transactions
 * of runway while the dashboard says ten SUI. This script moves the difference
 * across so the number that matters is the one that grows.
 *
 * ── Running it ──
 *
 *     ONARA_SPONSOR_SK=suiprivkey1... node scripts/onara-gas-topup.mjs
 *     ONARA_SPONSOR_SK=... node scripts/onara-gas-topup.mjs --target 5
 *     ONARA_SPONSOR_SK=... node scripts/onara-gas-topup.mjs --dry-run
 *
 * The key is the sponsor's, held as a secret in the Onara Cloudflare Worker.
 * It is read from the environment and never written anywhere.
 *
 * Gas for THIS transaction comes from the existing coin, so it works as long
 * as the sponsor has anything left at all. Run it before that stops being true.
 */

import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const SPONSOR = "0x8a319488de2a8043a7b503d4a906ce5feedb793787bdb9a63bc6327d46310cdb";
const SUI_TYPE = "0x2::sui::SUI";
const MIST = 1_000_000_000n;

/**
 * Target coin balance, in SUI. 3 SUI covers 50 sponsored transactions even if
 * every one of them burned its entire 60_000_000 MIST budget — which none do;
 * measured cost is ~0.0148 SUI, so in practice this is ~200 transactions. The
 * budget, not the spend, is what a build has to be able to reserve, so sizing
 * against it is what makes "50 transactions" a floor rather than an average.
 */
const DEFAULT_TARGET_SUI = 3;

/** Leave this much in the accumulator rather than draining it to nothing. */
const ACCUMULATOR_FLOOR_SUI = 0.5;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetIdx = args.indexOf("--target");
const targetSui = targetIdx >= 0 ? Number(args[targetIdx + 1]) : DEFAULT_TARGET_SUI;

if (!Number.isFinite(targetSui) || targetSui <= 0) {
  console.error("--target must be a positive number of SUI");
  process.exit(1);
}

const sk = process.env.ONARA_SPONSOR_SK;
if (!sk) {
  console.error(
    "ONARA_SPONSOR_SK is not set.\n" +
      "It's the sponsor's private key, stored as a Cloudflare Worker secret on talise-onara.\n" +
      "  ONARA_SPONSOR_SK=suiprivkey1... node scripts/onara-gas-topup.mjs"
  );
  process.exit(1);
}

const client = new SuiGrpcClient({
  network: "mainnet",
  baseUrl: "https://fullnode.mainnet.sui.io:443",
});

const keypair = Ed25519Keypair.fromSecretKey(sk.trim());
const address = keypair.toSuiAddress();

// Refuse to sign for anything but the sponsor. A key that derives elsewhere is
// the wrong key, and finding that out after broadcasting is too late.
if (address.toLowerCase() !== SPONSOR.toLowerCase()) {
  console.error(
    `ONARA_SPONSOR_SK derives to ${address}\n` +
      `but the Onara sponsor is        ${SPONSOR}\n` +
      "Refusing to sign — this is not the sponsor's key."
  );
  process.exit(1);
}

async function balances() {
  const res = await client.core.getBalance({ owner: SPONSOR, coinType: SUI_TYPE });
  const b = res.balance ?? res;
  return {
    coins: BigInt(b.coinBalance ?? "0"),
    accumulator: BigInt(b.addressBalance ?? "0"),
  };
}

const fmt = (mist) => `${(Number(mist) / 1e9).toFixed(4)} SUI`;
const txsAt = (mist) => Math.floor(Number(mist) / 1e9 / 0.0148);

const before = await balances();
console.log(`sponsor      ${SPONSOR}`);
console.log(`gas coins    ${fmt(before.coins)}   (~${txsAt(before.coins)} sponsored txs)`);
console.log(`accumulator  ${fmt(before.accumulator)}   (cannot pay gas)`);

const target = BigInt(Math.round(targetSui * 1e9));
if (before.coins >= target) {
  console.log(`\nAlready at or above the ${targetSui} SUI target. Nothing to do.`);
  process.exit(0);
}

const shortfall = target - before.coins;
const floor = BigInt(Math.round(ACCUMULATOR_FLOOR_SUI * 1e9));
const available = before.accumulator > floor ? before.accumulator - floor : 0n;
if (available === 0n) {
  console.error(
    `\nAccumulator holds ${fmt(before.accumulator)}, at or below the ` +
      `${ACCUMULATOR_FLOOR_SUI} SUI floor. Fund the sponsor externally instead:\n` +
      `  send SUI to ${SPONSOR} as a normal coin transfer.`
  );
  process.exit(1);
}
const move = shortfall < available ? shortfall : available;

console.log(`\nmoving ${fmt(move)} from the accumulator into a gas coin`);
console.log(`  -> coins would be ${fmt(before.coins + move)} (~${txsAt(before.coins + move)} txs)`);

const tx = new Transaction();
tx.setSender(SPONSOR);
// Accumulator -> Balance<SUI> -> Coin<SUI>, owned by the sponsor. Same
// primitive the wallet uses to source a coin from an accumulator balance.
const bal = tx.balance({ type: SUI_TYPE, balance: move });
const coin = tx.moveCall({
  target: "0x2::coin::from_balance",
  typeArguments: [SUI_TYPE],
  arguments: [bal],
});
tx.transferObjects([coin], SPONSOR);
// Gas comes from the coin that already exists — this is the bootstrap that
// makes the whole thing possible, and why it must run before that coin is gone.
tx.setGasBudget(20_000_000n);

const bytes = await tx.build({ client });
console.log(`\ntransaction built — ${bytes.length} bytes`);

if (dryRun) {
  console.log("--dry-run: not broadcasting.");
  process.exit(0);
}

const res = await client.core.executeTransaction({
  transaction: bytes,
  signatures: [(await keypair.signTransaction(bytes)).signature],
});
// gRPC wraps the result in a `{ $kind: "Transaction", Transaction: {...} }`
// envelope, the same shape getTransaction returns — reading `res.transaction`
// (lowercase) printed "broadcast undefined" on an execution that succeeded.
const digest =
  res.Transaction?.digest ?? res.transaction?.digest ?? res.digest ?? "(unknown)";
console.log(`broadcast ${digest}`);

// Confirm against chain state rather than trusting the response.
await new Promise((r) => setTimeout(r, 3000));
const after = await balances();
console.log(`\ngas coins    ${fmt(before.coins)} -> ${fmt(after.coins)}   (~${txsAt(after.coins)} sponsored txs)`);
console.log(`accumulator  ${fmt(before.accumulator)} -> ${fmt(after.accumulator)}`);
if (after.coins < target) {
  console.warn(`\nStill under the ${targetSui} SUI target — re-run, or fund externally.`);
}
